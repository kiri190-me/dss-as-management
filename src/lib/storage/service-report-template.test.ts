import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";

import { WORKFLOW_TYPE_CODES } from "@/lib/domain/types";
import {
  isServiceReportTemplateProductKind,
  resolveServiceReportTemplatePath,
  SERVICE_REPORT_TEMPLATE_PRODUCT_KINDS,
  ServiceReportTemplateError,
  serviceReportTemplateProductKindOf,
} from "./service-report-template";

/**
 * ============================================================================
 * 보고서 양식 넷 중 하나를 고르는 규칙
 * ============================================================================
 * 🔴 이 묶음이 지키는 것은 **엉뚱한 사람 도장이 찍힌 보고서가 나가지 않는 것**
 * 하나다. 네 양식의 칸 구조는 같고 다른 것은 담당 엔지니어의 도장뿐이라
 * (2026-10-18 실측), 양식을 잘못 고르면 **문서는 멀쩡해 보이는데 결재란의 사람만
 * 틀린다** — 아무 오류도 나지 않고, 받는 쪽에서 알려 주기 전에는 아무도 모른다.
 *
 * 디스크를 읽지 않는다. 보는 것은 **어느 설정을 고르는가**까지다(경로를 고르는
 * `resolveServiceReportTemplatePath` 는 파일이 없어도 돈다). 양식 파일을 실제로
 * 채워 보는 쪽은 `src/lib/xlsx/service-report-template.test.ts` 다.
 *
 * ⚠️ 환경변수를 건드리므로 **쓰기 전 값을 되돌려 놓는다.** 같은 이름을 보는
 * 시험이 이웃에 있다(그 파일의 「실제 양식」 묶음).
 * ============================================================================
 */

const ENV_NAMES = [
  "MATCHER_INSPECTION_REPORT_TEMPLATE_PATH",
  "GENERATOR_INSPECTION_REPORT_TEMPLATE_PATH",
  "MATCHER_REPAIR_REPORT_TEMPLATE_PATH",
  "GENERATOR_REPAIR_REPORT_TEMPLATE_PATH",
  "INSPECTION_REPORT_TEMPLATE_PATH",
  "REPAIR_REPORT_TEMPLATE_PATH",
] as const;

/** 그 설정들만 주어진 값으로 세워 두고 돌린다. 끝나면 원래대로 돌려놓는다. */
function withEnv(values: Partial<Record<(typeof ENV_NAMES)[number], string>>, run: () => void): void {
  const saved = new Map<string, string | undefined>();
  for (const name of ENV_NAMES) {
    saved.set(name, process.env[name]);
    const next = values[name];
    if (next === undefined) delete process.env[name];
    else process.env[name] = next;
  }
  try {
    run();
  } finally {
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

/** 경로는 `path.resolve` 를 거쳐 나오므로 기대값도 같은 함수로 만든다. */
function resolved(value: string): string {
  return path.resolve(value);
}

// ── 고르기 — 종류 셋 × 문서 둘 ──────────────────────────────────────────

/**
 * 🔴 여섯 조합이 각각 어느 설정에서 오는가. 기대값에 **설정 이름이 아니라 경로**를
 * 적는 것은, 이름만 보면 「매쳐 칸에 제너레이터 파일을 적어 둔」 경우를 못 잡기
 * 때문이다.
 */
const PICKS = [
  { workflowType: "PAID_MATCHER", kind: "INSPECTION", expect: "/t/검사_매쳐" },
  { workflowType: "PAID_MATCHER", kind: "REPAIR", expect: "/t/수리_매쳐" },
  { workflowType: "WARRANTY_GENERATOR", kind: "INSPECTION", expect: "/t/검사_제너" },
  { workflowType: "WARRANTY_GENERATOR", kind: "REPAIR", expect: "/t/수리_제너" },
  // 🔴 T/C 는 **제너레이터 양식**이다 — 2026-10-18 사용자 결정. 바로 아래 시험이
  //    그 둘이 같은 파일로 가는 것을 한 번 더 못 박는다.
  { workflowType: "PENDING_TOTAL_CONTROLLER", kind: "INSPECTION", expect: "/t/검사_제너" },
  { workflowType: "PENDING_TOTAL_CONTROLLER", kind: "REPAIR", expect: "/t/수리_제너" },
] as const;

const FOUR_PATHS = {
  MATCHER_INSPECTION_REPORT_TEMPLATE_PATH: "/t/검사_매쳐",
  GENERATOR_INSPECTION_REPORT_TEMPLATE_PATH: "/t/검사_제너",
  MATCHER_REPAIR_REPORT_TEMPLATE_PATH: "/t/수리_매쳐",
  GENERATOR_REPAIR_REPORT_TEMPLATE_PATH: "/t/수리_제너",
} as const;

test("🔴 종류 셋 × 문서 둘 — 여섯 조합이 각각 제 양식을 고른다", () => {
  withEnv(FOUR_PATHS, () => {
    for (const pick of PICKS) {
      assert.equal(
        resolveServiceReportTemplatePath(
          pick.kind,
          serviceReportTemplateProductKindOf(pick.workflowType)
        ),
        resolved(pick.expect),
        `${pick.workflowType} / ${pick.kind} 가 엉뚱한 양식을 골랐다`
      );
    }
  });
});

test("🔴 T/C 는 제너레이터 양식이다 — 매쳐 쪽으로 새지 않는다", () => {
  for (const suffix of ["PAID", "WARRANTY", "PENDING"]) {
    assert.equal(
      serviceReportTemplateProductKindOf(`${suffix}_TOTAL_CONTROLLER`),
      "GENERATOR",
      `${suffix}_TOTAL_CONTROLLER 가 제너레이터로 가지 않는다`
    );
    // 같은 접미사의 제너레이터 건과 **같은 값**이어야 한다.
    assert.equal(
      serviceReportTemplateProductKindOf(`${suffix}_TOTAL_CONTROLLER`),
      serviceReportTemplateProductKindOf(`${suffix}_GENERATOR`)
    );
  }
});

test("🔴 유·무상·추후결정은 양식을 가르지 않는다 — 가르는 것은 제품 종류뿐이다", () => {
  for (const product of ["MATCHER", "GENERATOR", "TOTAL_CONTROLLER"]) {
    const kinds = ["PAID", "WARRANTY", "PENDING"].map((billing) =>
      serviceReportTemplateProductKindOf(`${billing}_${product}`)
    );
    assert.equal(new Set(kinds).size, 1, `${product} 가 유·무상에 따라 다른 양식을 쓴다`);
  }
});

test("🔴 워크플로 유형 전부가 양식을 고를 수 있다 — 하나가 늘면 여기가 깨진다", () => {
  for (const code of WORKFLOW_TYPE_CODES) {
    const productKind = serviceReportTemplateProductKindOf(code);
    assert.ok(
      isServiceReportTemplateProductKind(productKind),
      `${code} 가 양식을 고르지 못한다`
    );
  }
  // 양식은 둘이다 — 제품 종류 셋이 둘로 접힌다(T/C → 제너레이터).
  assert.deepEqual([...SERVICE_REPORT_TEMPLATE_PRODUCT_KINDS], ["MATCHER", "GENERATOR"]);
});

// ── 모르는 종류 ─────────────────────────────────────────────────────────

/**
 * 🔴 **조용히 아무 양식이나 쓰지 않는다.** `workflowKindOf` 는 접미사를 못 찾으면
 * `GENERATOR` 를 돌려주므로, 거르지 않으면 DB 에 남아 있는 레거시 `MATCHER` 가
 * 제너레이터 담당자의 도장을 달고 나간다 — 이 변경이 막으려던 바로 그 사고다.
 */
test("🔴 모르는 종류는 제너레이터로 떨어지지 않고 던진다", () => {
  for (const unknown of ["MATCHER", "", "GENERATOR", "PAID_matcher", "constructor", "__proto__"]) {
    assert.throws(
      () => serviceReportTemplateProductKindOf(unknown),
      ServiceReportTemplateError,
      `「${unknown}」 를 그냥 받아 줬다`
    );
  }
  // 🔴 레거시 `MATCHER` 가 **제너레이터로 읽히지 않는다**는 것이 핵심이다.
  assert.throws(() => serviceReportTemplateProductKindOf("MATCHER"), /종류.*알 수 없/u);
});

test("주소 마디는 목록으로 거른다 — 프로토타입 이름도 통과하지 못한다", () => {
  assert.equal(isServiceReportTemplateProductKind("MATCHER"), true);
  assert.equal(isServiceReportTemplateProductKind("GENERATOR"), true);
  for (const bad of ["TOTAL_CONTROLLER", "matcher", "", "constructor", "toString", 1, null]) {
    assert.equal(isServiceReportTemplateProductKind(bad), false, `${String(bad)} 가 통과했다`);
  }
});

// ── 🔴 물러서기 — 새 설정이 비면 옛 설정을 쓴다 ─────────────────────────

/**
 * 운영 환경변수에 새 이름 넷을 넣기 **전에** 이 코드가 배포될 수 있다. 그때
 * 보고서가 통째로 멈추면 안 된다 — 옛 설정 둘로 물러서서, 2026-10-18 이전과
 * 똑같은 문서가 나간다.
 */
test("🔴 새 설정이 비면 옛 설정으로 물러선다 — 여섯 조합 모두", () => {
  withEnv(
    {
      INSPECTION_REPORT_TEMPLATE_PATH: "/t/옛검사",
      REPAIR_REPORT_TEMPLATE_PATH: "/t/옛수리",
    },
    () => {
      for (const pick of PICKS) {
        assert.equal(
          resolveServiceReportTemplatePath(
            pick.kind,
            serviceReportTemplateProductKindOf(pick.workflowType)
          ),
          resolved(pick.kind === "INSPECTION" ? "/t/옛검사" : "/t/옛수리"),
          `${pick.workflowType} / ${pick.kind} 가 물러서지 않았다`
        );
      }
    }
  );
});

test("🔴 공백만 적힌 새 설정도 「비었다」로 본다", () => {
  withEnv(
    {
      MATCHER_REPAIR_REPORT_TEMPLATE_PATH: "   ",
      REPAIR_REPORT_TEMPLATE_PATH: "/t/옛수리",
    },
    () => {
      assert.equal(
        resolveServiceReportTemplatePath("REPAIR", "MATCHER"),
        resolved("/t/옛수리")
      );
    }
  );
});

test("🔴 반만 채워도 채운 쪽은 새 양식으로 간다 — 섞여 있어도 된다", () => {
  withEnv(
    {
      MATCHER_REPAIR_REPORT_TEMPLATE_PATH: "/t/수리_매쳐",
      INSPECTION_REPORT_TEMPLATE_PATH: "/t/옛검사",
      REPAIR_REPORT_TEMPLATE_PATH: "/t/옛수리",
    },
    () => {
      // 채운 칸은 새것.
      assert.equal(
        resolveServiceReportTemplatePath("REPAIR", "MATCHER"),
        resolved("/t/수리_매쳐")
      );
      // 안 채운 칸은 옛것.
      assert.equal(
        resolveServiceReportTemplatePath("REPAIR", "GENERATOR"),
        resolved("/t/옛수리")
      );
      assert.equal(
        resolveServiceReportTemplatePath("INSPECTION", "MATCHER"),
        resolved("/t/옛검사")
      );
    }
  );
});

test("🔴 새것도 옛것도 없으면 던진다 — 경로를 지어내지 않는다", () => {
  withEnv({}, () => {
    assert.throws(
      () => resolveServiceReportTemplatePath("REPAIR", "MATCHER"),
      /MATCHER_REPAIR_REPORT_TEMPLATE_PATH가 설정되지 않았습니다/u
    );
    assert.throws(
      () => resolveServiceReportTemplatePath("INSPECTION", "GENERATOR"),
      /GENERATOR_INSPECTION_REPORT_TEMPLATE_PATH가 설정되지 않았습니다/u
    );
  });
});

/**
 * 🔴 **설정 이름 넷을 못 박는다.** 이름을 바꾸면 운영 환경변수와 조용히
 * 어긋나고, 그때 증상은 「배포한 날부터 매쳐 보고서에 제너레이터 도장」이다.
 */
test("🔴 설정 이름 넷 — 바꾸면 운영 설정과 어긋난다", () => {
  for (const [name, value] of Object.entries(FOUR_PATHS)) {
    withEnv({ [name]: value } as Partial<Record<(typeof ENV_NAMES)[number], string>>, () => {
      const kind = name.includes("INSPECTION") ? "INSPECTION" : "REPAIR";
      const productKind = name.startsWith("MATCHER") ? "MATCHER" : "GENERATOR";
      assert.equal(
        resolveServiceReportTemplatePath(kind, productKind),
        resolved(value),
        `${name} 를 아무도 안 읽는다`
      );
    });
  }
});
