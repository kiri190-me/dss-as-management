import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

import {
  PRODUCT_MODEL_KIND_CODES,
  PRODUCT_MODEL_KIND_LABELS,
  PRODUCT_MODEL_KIND_UNSPECIFIED_LABEL,
  isProductModelKind,
  productModelKindLabel,
} from "./product-model-kind";
import { workflowKindLabels } from "./workflow-kind";

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
