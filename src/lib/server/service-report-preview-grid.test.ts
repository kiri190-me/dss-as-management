import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

import { SERVICE_REPORT_TITLES } from "@/lib/xlsx/service-report-template";
import type { SheetPrintGrid } from "@/lib/xlsx/sheet-print-grid";

import {
  buildServiceReportPreviewGrid,
  serviceReportScreenTitle,
  serviceReportTemplateImageBase,
} from "./service-report-preview-grid";

/**
 * ============================================================================
 * 🔴 **저장하지 않은 값으로 그린 문서** — 보낸 쪽이 나오는가 (2026-10-19)
 * ============================================================================
 * 사용자 요구: 「보고서 수정하고서 **저장을 누르지 않은 채** 저장 옆에 있는
 * 미리보기를 눌렀을 때에 수정한 내용이 반영되도록 해줘.」
 *
 * 그 요구가 지켜졌다는 말은 셋이다. 여기서 보는 것이 그 셋 중 둘이다:
 *
 *   ① 🔴 **보낸 값이 문서에 찍힌다** — 저장된 장과 **다른** 값을 넣었을 때 나오는
 *      것이 보낸 쪽이다. 이 함수는 저장된 장을 읽을 길 자체가 없으므로, 값이
 *      갈리면 결과도 갈려야 한다.
 *   ② 🔴 **저장이 일어나지 않는다** — 이 사슬은 DB 를 모른다(원본 글자로 본다).
 *      나머지 하나(통로의 인가 · 통로가 DB 를 안 건드림)는
 *      `app/api/repair-cases/*​/service-report/preview-grid/route-source.test.ts` 다.
 *
 * ⚠️ **양식 파일이 있어야 도는 시험이 섞여 있다**(양식은 저장소에 두지 않는다).
 * 설정이 없으면 그 시험만 건너뛴다 — 값만으로 보는 시험(막기 · 양식 고르기 실패)은
 * 언제나 돈다.
 * ============================================================================
 */

/** 통과하는 가장 작은 요청(`validation/service-report-input.test.ts` 와 같은 모양). */
function request(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: "REPAIR",
    customerName: "테스트상사",
    issuedOn: "2026-10-19",
    reportNumber: { prefix: "Z000", middle: "TEST1", tail: "0001" },
    body: { findings: ["외관 확인"], actions: ["청소"], summary: [] },
    ...overrides,
  };
}

/** 문서에 찍힌 글자 전부. 칸 자리는 여기서 볼 것이 아니라 **값이 들어갔는가**만 본다. */
function gridText(grid: SheetPrintGrid): string {
  return grid.rows.flatMap((row) => row.cells.map((cell) => cell.text)).join("\n");
}

/** 수리 양식이 설정돼 있는가 — 새 이름이 비면 옛 이름으로 물러선다(storage 쪽 규칙). */
function repairTemplateConfigured(productKindVariable: string): boolean {
  const configured =
    process.env[productKindVariable]?.trim() || process.env.REPAIR_REPORT_TEMPLATE_PATH?.trim();
  return Boolean(configured);
}

const skipMatcher = repairTemplateConfigured("MATCHER_REPAIR_REPORT_TEMPLATE_PATH")
  ? false
  : "매쳐 수리 양식이 설정되지 않았습니다";
const skipGenerator = repairTemplateConfigured("GENERATOR_REPAIR_REPORT_TEMPLATE_PATH")
  ? false
  : "제너레이터 수리 양식이 설정되지 않았습니다";

describe("저장하지 않은 보고서를 격자로 — 보낸 값이 그대로 나온다", () => {
  test(
    "🔴 저장된 장과 **다른** 값을 보내면 보낸 쪽이 문서에 찍힌다",
    { skip: skipMatcher },
    async () => {
      // 「저장돼 있던 것」이라고 치는 값.
      const stored = await buildServiceReportPreviewGrid(
        request({
          customerName: "저장된상사",
          modelName: "SAVED-1000",
          body: { findings: ["저장된 확인내용"], actions: ["저장된 조치"], summary: [] },
        }),
        "PAID_MATCHER"
      );
      // 사람이 화면에서 고쳤고 **아직 저장하지 않은** 값.
      const edited = await buildServiceReportPreviewGrid(
        request({
          customerName: "고친상사",
          modelName: "EDITED-2000",
          body: { findings: ["고친 확인내용"], actions: ["고친 조치"], summary: [] },
        }),
        "PAID_MATCHER"
      );

      assert.equal(stored.ok, true);
      assert.equal(edited.ok, true);
      if (!stored.ok || !edited.ok) throw new Error("unreachable");

      const storedText = gridText(stored.grid);
      const editedText = gridText(edited.grid);

      // 🔴 보낸 쪽이 나온다.
      for (const written of ["고친상사", "EDITED-2000", "고친 확인내용", "고친 조치"]) {
        assert.ok(editedText.includes(written), `고친 값 "${written}" 이 문서에 없다`);
      }
      // 🔴 **저장된 쪽은 섞이지 않는다.** 이 사슬이 DB 를 한 번이라도 읽으면 여기가 깨진다.
      for (const old of ["저장된상사", "SAVED-1000", "저장된 확인내용", "저장된 조치"]) {
        assert.equal(editedText.includes(old), false, `옛 값 "${old}" 이 문서에 남았다`);
      }
      // 같은 함수가 저장된 쪽 값으로는 저장된 쪽을 그린다 — 「늘 같은 문서」가 아니다.
      assert.ok(storedText.includes("저장된 확인내용"));
      assert.notEqual(editedText, storedText);
    }
  );

  test("🔴 보고서 종류 · 제목은 **양식의 제목**에서 온다", { skip: skipMatcher }, async () => {
    for (const kind of ["REPAIR", "INSPECTION"] as const) {
      const built = await buildServiceReportPreviewGrid(
        request({ kind, body: { findings: ["외관 확인"], actions: ["청소"] } }),
        "PAID_MATCHER"
      );
      if (!built.ok) {
        // 검사 양식만 설정이 빠져 있을 수 있다 — 그때는 이 종류를 건너뛴다.
        assert.equal(built.code, "TEMPLATE_UNAVAILABLE");
        continue;
      }
      assert.equal(built.kindLabel, serviceReportScreenTitle(SERVICE_REPORT_TITLES[kind]));
      // 전각 공백은 화면에서만 걷는다 — 문서 쪽 제목은 그대로다.
      assert.equal(built.kindLabel.includes("　"), false);
    }
  });
});

describe("🔴 도장은 **그 건이 쓰는 양식**에서 나온다", () => {
  test("매쳐 건과 제너레이터 건의 그림 주소가 다르다", { skip: skipMatcher || skipGenerator }, async () => {
    const matcher = await buildServiceReportPreviewGrid(request(), "PAID_MATCHER");
    const generator = await buildServiceReportPreviewGrid(request(), "PAID_GENERATOR");
    // T/C 는 제너레이터 양식이다(2026-10-18 사용자 결정).
    const controller = await buildServiceReportPreviewGrid(request(), "WARRANTY_TOTAL_CONTROLLER");

    assert.equal(matcher.ok, true);
    assert.equal(generator.ok, true);
    assert.equal(controller.ok, true);
    if (!matcher.ok || !generator.ok || !controller.ok) throw new Error("unreachable");

    assert.equal(matcher.templateImageBase, serviceReportTemplateImageBase("REPAIR", "MATCHER"));
    assert.equal(generator.templateImageBase, serviceReportTemplateImageBase("REPAIR", "GENERATOR"));
    assert.equal(controller.templateImageBase, generator.templateImageBase);
    assert.notEqual(matcher.templateImageBase, generator.templateImageBase);
    // 🔴 주소의 두 마디가 격자를 뽑은 그 양식을 가리킨다 — 그림 라우트가 이것으로 양식을 연다.
    assert.equal(matcher.templateImageBase, "/api/service-reports/template-image/REPAIR/MATCHER/");
  });
});

describe("🔴 못 채울 값이 있으면 그리지 않는다 — 반쪽짜리 문서를 보여 주지 않는다", () => {
  test("본문이 한 줄도 없으면 INVALID_INPUT 이고 막힌 칸을 말한다", async () => {
    const built = await buildServiceReportPreviewGrid(
      request({ body: { findings: [], actions: [], summary: [] } }),
      "PAID_MATCHER"
    );
    assert.equal(built.ok, false);
    if (built.ok) throw new Error("unreachable");
    assert.equal(built.code, "INVALID_INPUT");
    assert.ok(built.message.length > 0, "막힌 까닭을 한 줄도 말하지 않았다");
    assert.ok(Object.keys(built.fieldErrors ?? {}).length > 0, "칸별 오류가 비었다");
  });

  test("본문이 객체가 아니어도 통째로 막는다 — 그리다 터지지 않는다", async () => {
    for (const payload of [null, "보고서", 3, []]) {
      const built = await buildServiceReportPreviewGrid(payload, "PAID_MATCHER");
      assert.equal(built.ok, false);
      if (built.ok) throw new Error("unreachable");
      assert.equal(built.code, "INVALID_INPUT");
    }
  });

  test("🔴 접수 건의 종류를 모르면 그리지 않는다 — 엉뚱한 사람 도장보다 낫다", async () => {
    const built = await buildServiceReportPreviewGrid(request(), "NOPE_WHATEVER");
    assert.equal(built.ok, false);
    if (built.ok) throw new Error("unreachable");
    assert.equal(built.code, "TEMPLATE_UNAVAILABLE");
    // 🔴 사람에게 보여 줄 말에 경로가 없다.
    for (const forbidden of ["\\", "/", ".xlsx"]) {
      assert.equal(built.message.includes(forbidden), false, `경로가 섞였다: ${built.message}`);
    }
  });
});

/**
 * ============================================================================
 * 🔴 **저장이 일어나지 않는다** — 이 사슬은 DB 를 모른다
 * ============================================================================
 * 값으로는 「저장이 없었다」를 증명할 수 없다(없는 일을 세는 셈이다). 그래서 원본
 * 글자로 본다 — 저장할 수 있는 연장을 **하나도 들고 있지 않다**.
 * ============================================================================
 */
describe("🔴 미리보기 사슬은 저장하지 않는다", () => {
  const source = readFileSync(new URL("./service-report-preview-grid.ts", import.meta.url), "utf8");
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  test("DB 를 가져오지 않는다 — 표도 조회도 mutation 도 없다", () => {
    for (const forbidden of [
      "@/lib/db/",
      "drizzle",
      "getServiceReportForEdit",
      "recordServiceReportExport",
      "createServiceReportAction",
      "updateServiceReportAction",
      "@/lib/server/actions/",
    ]) {
      assert.equal(code.includes(forbidden), false, `저장으로 가는 길이 생겼다: ${forbidden}`);
    }
  });

  test("디스크에 쓰지 않는다 — 양식을 **읽기만** 한다", () => {
    for (const forbidden of [/\bwriteFile\b/, /\bmkdir\b/, /\bunlink\b/, /\brename\b/, /node:fs/]) {
      assert.equal(forbidden.test(code), false, `쓰는 길이 생겼다: ${forbidden}`);
    }
    assert.ok(code.includes("readServiceReportTemplate("), "양식을 읽는 길이 사라졌다");
  });

  test("🔴 양식 고르기를 우회하지 않는다 — 경로를 손으로 짓지 않는다", () => {
    assert.ok(code.includes("serviceReportTemplateProductKindOf("), "제품 축을 storage 에서 안 고른다");
    for (const forbidden of ["TEMPLATE_PATH", "path.resolve", "process.env"]) {
      assert.equal(code.includes(forbidden), false, `양식 경로를 직접 만진다: ${forbidden}`);
    }
  });
});
