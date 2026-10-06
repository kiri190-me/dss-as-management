import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

import {
  PRODUCT_MODEL_KIND_CODES,
  PRODUCT_MODEL_KIND_LABELS,
  PRODUCT_MODEL_KIND_UNSPECIFIED_LABEL,
  isProductModelKind,
  productModelKindLabel,
  productModelKindOfWorkflowKind,
} from "./product-model-kind";
import { WORKFLOW_KIND_CODES, workflowKindLabels, workflowKindOf } from "./workflow-kind";

/**
 * ============================================================================
 * 제품 종류 이름표를 한 자리로 모았다 — **보이는 글자가 안 바뀌었는가**
 * ============================================================================
 * 2026-10-06 이전에는 같은 세 줄이 네 화면에 따로 있었다 — ProductModelListScreen ·
 * ProductModelDetailScreen · ProductModelEditForm · CustomerDetailScreen. 세
 * 화면의 주석이 「형제 화면과 같은 말을 돌려준다」고 서로를 가리키고 있었지만,
 * 가리키는 것은 한 곳만 고쳐지는 날을 막지 못한다(그때 아무 오류도 나지 않는다).
 *
 * 이 시험이 못 박는 것은 넷이다:
 *  1. 🔴 **글자가 한 글자도 안 바뀌었다** — 옮기기 전 네 화면이 보이던 그 값이다.
 *  2. 🔴 **네 화면에 이름표가 남아 있지 않다** — 옮겼다면서 한 벌 더 두면 모은
 *     뜻이 없다. 원본을 글자로 읽어 확인한다.
 *  3. 🔴 **「매쳐」 축과 섞이지 않았다** — domain/workflow-kind.ts 의
 *     workflowKindLabels 는 **수리 건의 워크플로 종류**를 한국어로 적는 다른
 *     축이고, 스키마 주석이 두 축을 일부러 안 섞는다고 못 박고 있다.
 *  4. 셋 중 하나가 아닌 값은 종류로 인정되지 않는다 — 서류함 화면(404)과
 *     올리기 통로(400)가 이 판정 하나로 막는다.
 * ============================================================================
 */

const repoUrl = new URL("../../../", import.meta.url);
/** CRLF 로 받아 둔 저장소에서도 표지가 맞도록 LF 로 맞춘다. */
const read = (relativePath: string) =>
  readFileSync(new URL(relativePath, repoUrl), "utf8").replace(/\r\n/g, "\n");
/** "이 글자가 남아 있으면 안 된다" 를 볼 때 쓴다 — 주석에 적힌 까닭에 걸리지 않게. */
const code = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");

const SCREENS: readonly [string, string][] = [
  ["모델 목록", "src/components/product-models/ProductModelListScreen.tsx"],
  ["모델 상세", "src/components/product-models/ProductModelDetailScreen.tsx"],
  ["모델 수정 폼", "src/components/product-models/ProductModelEditForm.tsx"],
  ["고객사 상세", "src/components/customers/CustomerDetailScreen.tsx"],
];

describe("제품 종류 이름표 — 한 자리로 모았다", () => {
  test("🔴 보이는 글자가 옮기기 전과 한 글자도 같다", () => {
    assert.deepEqual(PRODUCT_MODEL_KIND_LABELS, {
      GENERATOR: "Generator",
      MATCHER: "Matcher",
      TOTAL_CONTROLLER: "Total Controller (T/C)",
    });
    assert.equal(PRODUCT_MODEL_KIND_UNSPECIFIED_LABEL, "미지정");
  });

  test("코드 셋 전부에 이름표가 있고, 그 셋뿐이다", () => {
    assert.deepEqual([...PRODUCT_MODEL_KIND_CODES], ["GENERATOR", "MATCHER", "TOTAL_CONTROLLER"]);
    assert.equal(Object.keys(PRODUCT_MODEL_KIND_LABELS).length, PRODUCT_MODEL_KIND_CODES.length);
    for (const codeName of PRODUCT_MODEL_KIND_CODES) {
      assert.ok(PRODUCT_MODEL_KIND_LABELS[codeName].trim().length > 0, `${codeName} 에 이름표가 없다`);
    }
  });

  test("미지정은 빈 값이다 — null · undefined · 빈 문자열이 모두 같은 글자다", () => {
    assert.equal(productModelKindLabel(null), "미지정");
    assert.equal(productModelKindLabel(undefined), "미지정");
    assert.equal(productModelKindLabel(""), "미지정");
  });

  test("목록 밖의 값은 그 값을 그대로 보인다 — 네 화면이 하던 그대로다", () => {
    // 빈 칸으로 두면 "열이 한 칸 밀렸나"와 구별되지 않는다. 옮기기 전 네 화면의
    // `KIND_LABELS[kind] ?? kind` 와 같은 동작이다.
    assert.equal(productModelKindLabel("RECTIFIER"), "RECTIFIER");
    assert.equal(productModelKindLabel("generator"), "generator");
  });

  test("🔴 셋 중 하나가 아니면 종류가 아니다 — 서류함 404 · 통로 400 이 이것 하나를 본다", () => {
    for (const codeName of PRODUCT_MODEL_KIND_CODES) {
      assert.equal(isProductModelKind(codeName), true, codeName);
    }
    for (const bogus of [
      "",
      " ",
      "generator", // 소문자는 enum 코드가 아니다
      "GENERATOR ", // 공백이 붙으면 다른 값이다(통로는 trim 하지 않는다)
      "제너레이터", // 한글은 주소에 쓰지 않는다
      "RECTIFIER",
      "../../etc/passwd",
      "GENERATOR,MATCHER",
    ]) {
      assert.equal(isProductModelKind(bogus), false, JSON.stringify(bogus));
    }
    for (const notAString of [null, undefined, 0, 1, {}, [], true]) {
      assert.equal(isProductModelKind(notAString), false, String(notAString));
    }
  });

  test("🔴 워크플로 종류 이름표와 섞이지 않았다 — 다른 축이다", () => {
    // 한국어로 적는 자리의 철자는 「매쳐」다(「메쳐」가 아니다).
    assert.equal(workflowKindLabels.MATCHER, "매쳐");
    assert.equal(workflowKindLabels.GENERATOR, "제너레이터");
    // 모델 마스터 쪽은 영문 표기다 — 두 축의 글자가 서로 달라야 섞이지 않았다는 뜻이다.
    assert.notEqual(PRODUCT_MODEL_KIND_LABELS.MATCHER, workflowKindLabels.MATCHER);
    assert.notEqual(PRODUCT_MODEL_KIND_LABELS.GENERATOR, workflowKindLabels.GENERATOR);
  });
});

describe("🔴 워크플로 종류 → 제품 종류 — 옮기는 자리는 한 곳뿐이다 (2026-10-06)", () => {
  test("워크플로 축의 값 셋이 전부 제품 종류로 옮겨진다", () => {
    assert.equal(productModelKindOfWorkflowKind("GENERATOR"), "GENERATOR");
    assert.equal(productModelKindOfWorkflowKind("MATCHER"), "MATCHER");
    assert.equal(productModelKindOfWorkflowKind("TOTAL_CONTROLLER"), "TOTAL_CONTROLLER");
  });

  test("🔴 어느 워크플로 종류를 넣어도 제품 종류 목록 안의 값이 나온다", () => {
    for (const kind of WORKFLOW_KIND_CODES) {
      const mapped = productModelKindOfWorkflowKind(kind);
      assert.equal(isProductModelKind(mapped), true, `${kind} → ${mapped} 가 종류 목록 밖이다`);
    }
    // 두 축의 값 **집합**이 지금 같다. 한쪽에 값이 하나 느는 날 이 줄이 걸려야 한다 —
    // 그때 위 표(PRODUCT_MODEL_KIND_BY_WORKFLOW_KIND)에 짝을 적어야 컴파일이 된다.
    assert.deepEqual([...WORKFLOW_KIND_CODES].sort(), [...PRODUCT_MODEL_KIND_CODES].sort());
  });

  test("🔴 접수 건의 종류는 **접수할 때 고른 워크플로**에서 나온다 — 모델 마스터가 아니다", () => {
    // 접수 폼이 만들 수 있는 workflowType 전부가 제 종류로 풀린다.
    const cases: readonly [string, string][] = [
      ["PAID_GENERATOR", "GENERATOR"],
      ["WARRANTY_GENERATOR", "GENERATOR"],
      ["PENDING_GENERATOR", "GENERATOR"],
      ["PAID_MATCHER", "MATCHER"],
      ["WARRANTY_MATCHER", "MATCHER"],
      ["PENDING_MATCHER", "MATCHER"],
      ["PAID_TOTAL_CONTROLLER", "TOTAL_CONTROLLER"],
      ["WARRANTY_TOTAL_CONTROLLER", "TOTAL_CONTROLLER"],
      ["PENDING_TOTAL_CONTROLLER", "TOTAL_CONTROLLER"],
    ];
    for (const [workflowType, expected] of cases) {
      assert.equal(
        productModelKindOfWorkflowKind(workflowKindOf(workflowType as Parameters<typeof workflowKindOf>[0])),
        expected,
        workflowType
      );
    }
  });

  test("🔴 함정 — 레거시 `MATCHER` 는 제너레이터로 읽힌다", () => {
    // DB enum 에 유·무상 접미사 없는 레거시 값이 아직 남아 있고, workflowKindOf 는
    // 접미사를 못 찾으면 조용히 GENERATOR 를 돌려준다. 새 접수에는 그 값이 들어오지
    // 않지만(접수 검증이 허용 목록으로 막는다), 지난 건을 이 길에 태우면 매쳐 건에
    // 제너레이터 서류가 붙는다 — 소급 적용을 하지 않는 까닭 가운데 하나다.
    assert.equal(workflowKindOf("MATCHER" as Parameters<typeof workflowKindOf>[0]), "GENERATOR");
    assert.equal(
      productModelKindOfWorkflowKind(workflowKindOf("MATCHER" as Parameters<typeof workflowKindOf>[0])),
      "GENERATOR"
    );
  });

  test("🔴 옮기는 자리가 저장소에 하나뿐이다 — 부르는 쪽이 제 손으로 캐스팅하지 않는다", () => {
    const home = code(read("src/lib/domain/product-model-kind.ts"));
    assert.ok(home.includes("productModelKindOfWorkflowKind"), "옮기는 함수가 사라졌다");
    // 종류 공통 서류를 고르는 자리(접수 서비스)는 이 함수를 거친다 — `as ProductModelKind`
    // 같은 바꿔치기를 제 손으로 적으면 한쪽 축에 값이 느는 날 조용히 틀린다.
    const intake = code(read("src/lib/server/services/create-repair-case.ts"));
    assert.ok(intake.includes("productModelKindOfWorkflowKind("), "접수 서비스가 옮기는 함수를 쓰지 않는다");
    assert.equal(
      intake.includes("as ProductModelKind"),
      false,
      "🔴 접수 서비스가 종류 축을 제 손으로 바꿔치기한다"
    );
  });
});

describe("네 화면에 이름표가 남아 있지 않다 — 원본을 글자로 읽는다", () => {
  test("🔴 화면 어디에도 이름표 목록이 한 벌 더 있지 않다", () => {
    for (const [name, relativePath] of SCREENS) {
      const source = code(read(relativePath));
      // 세 글자 중 어느 하나라도 화면 코드에 직접 적혀 있으면 베낀 것이다.
      for (const label of Object.values(PRODUCT_MODEL_KIND_LABELS)) {
        assert.ok(
          !source.includes(`"${label}"`),
          `${name} 에 이름표가 직접 적혀 있다: ${label}`
        );
      }
      // 옮기기 전의 상수 이름이 남아 있으면 지우다 만 것이다.
      assert.ok(!source.includes("KIND_LABELS"), `${name} 에 KIND_LABELS 가 남아 있다`);
    }
  });

  test("🔴 네 화면이 모두 공용 자리에서 가져다 쓴다", () => {
    for (const [name, relativePath] of SCREENS) {
      const source = read(relativePath);
      assert.match(
        source,
        /from "@\/lib\/domain\/product-model-kind"/,
        `${name} 이 공용 이름표를 가져오지 않는다`
      );
    }
  });

  test("🔴 종류 코드 목록도 화면이 손으로 적지 않는다 — 수정 폼의 고르개", () => {
    const form = code(read("src/components/product-models/ProductModelEditForm.tsx"));
    // 고르개 선택지가 PRODUCT_MODEL_KIND_CODES 를 돈다. 세 줄을 직접 적어 두면
    // 종류가 늘어나는 날 고르개만 옛 목록으로 남는다.
    assert.ok(form.includes("PRODUCT_MODEL_KIND_CODES.map"), "고르개가 코드 목록을 돌지 않는다");
    assert.ok(!form.includes('value: "GENERATOR"'), "고르개에 코드가 직접 적혀 있다");
  });
});
