import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  BOTH_QUOTE_SHEETS_QUESTION,
  MATCHER_ONLY_HEADLINE,
  MATCHER_SHEET_LABEL,
  NO_QUOTE_SHEET_HEADLINE,
  QUOTE_EXCEL_SHEET_FORM_KINDS,
  SHEET_FILLED_NOTE,
  quoteExcelChosenSheetLine,
  quoteExcelSheetFormLabel,
  quoteExcelSheetIndexForKind,
  quoteExcelSheetKinds,
  quoteExcelSheetLine,
  quoteExcelSheetsHeadline,
  quoteExcelSuggestedKind,
} from "./new-quote-excel-sheets";
import type { QuoteExcelSheetInfo } from "./quote-excel-parse";
import { quoteKindLabels } from "@/lib/validation/quote-input";

/**
 * ============================================================================
 * 「새 견적서」 팝업이 엑셀을 읽고 나서 하는 말 — 값으로 본다 (견적서 ⑤b)
 * ============================================================================
 * 순수 규칙이라 브라우저 없이 전부 돌린다. 화면이 이 규칙을 제자리에서 부르는지는
 * NewQuoteDialog.test.tsx 가, 읽기 통로의 응답을 읽는 법은 quote-excel-parse.test.ts 가 본다.
 *
 * 불변식 셋: (a) 알아본 시트는 늘 다 싣는다(`filled` 로 빼지 않는다) (b) 한 종류만 들어 있을
 * 때만 맞춰 준다 (c) 고른 종류의 시트만 읽는다 — 짝이 없으면 지정하지 않는다.
 * ============================================================================
 */

function sheet(
  index: number,
  name: string,
  form: QuoteExcelSheetInfo["form"],
  filled = true
): QuoteExcelSheetInfo {
  return { index, name, form, recognizedBy: "header", filled };
}

const DOMESTIC = sheet(0, "내자견적서", "GENERATOR_DOMESTIC");
const OH = sheet(2, "OH견적서", "GENERATOR_OH");
const MATCHER = sheet(1, "견적서", "MATCHER", false);

describe("양식 → 종류 · 이름표", () => {
  test("🔴 매쳐만 종류가 정해지지 않는다 — 한 장을 내자로도 OH 로도 쓴다", () => {
    assert.deepEqual(QUOTE_EXCEL_SHEET_FORM_KINDS, {
      GENERATOR_DOMESTIC: "DOMESTIC",
      GENERATOR_OH: "OVERHAUL",
      MATCHER: null,
    });
  });

  test("이름표는 종류 이름표 그대로다 — 화면 두 곳이 같은 말을 쓴다", () => {
    assert.equal(quoteExcelSheetFormLabel("GENERATOR_DOMESTIC"), quoteKindLabels.DOMESTIC);
    assert.equal(quoteExcelSheetFormLabel("GENERATOR_OH"), quoteKindLabels.OVERHAUL);
    assert.equal(quoteExcelSheetFormLabel("MATCHER"), MATCHER_SHEET_LABEL);
  });

  test("시트 한 줄 — 탭 이름 · 양식 · 「작성된 것으로 보임」", () => {
    assert.equal(quoteExcelSheetLine(DOMESTIC), `내자견적서 — 내자 견적서 · ${SHEET_FILLED_NOTE}`);
    assert.equal(quoteExcelSheetLine(MATCHER), `견적서 — ${MATCHER_SHEET_LABEL}`);
  });
});

describe("🔴 (a) 무엇이 들어 있나 — 알아본 시트는 늘 다 싣는다", () => {
  test("🔴 둘 다 있으면 어느 것으로 저장할지 묻는다(사용자 문장 그대로)", () => {
    assert.equal(quoteExcelSheetsHeadline([DOMESTIC, MATCHER, OH]), BOTH_QUOTE_SHEETS_QUESTION);
    assert.deepEqual(quoteExcelSheetKinds([DOMESTIC, MATCHER, OH]), ["DOMESTIC", "OVERHAUL"]);
  });

  test("🔴 OH 가 비어 보여도(`filled` 거짓) 「둘 다 있다」는 그대로다 — 거르는 막이 아니다", () => {
    const emptyOh = sheet(1, "OH견적서", "GENERATOR_OH", false);
    assert.equal(quoteExcelSheetsHeadline([DOMESTIC, emptyOh]), BOTH_QUOTE_SHEETS_QUESTION);
    assert.deepEqual(quoteExcelSheetKinds([DOMESTIC, emptyOh]), ["DOMESTIC", "OVERHAUL"]);
  });

  test("한 종류만 있으면 그 종류를 말하고, 바꿀 수 있다고 알린다", () => {
    const only = quoteExcelSheetsHeadline([DOMESTIC]);
    assert.ok(only.startsWith("내자 견적서만 들어 있습니다"), only);
    assert.ok(only.includes("바꿀 수 있습니다"), only);
    assert.ok(quoteExcelSheetsHeadline([OH]).startsWith("OH 견적서만 들어 있습니다"));
  });

  test("매쳐뿐이면 종류가 정해지지 않는다고 말한다 · 하나도 못 알아보면 그 말을 한다", () => {
    assert.equal(quoteExcelSheetsHeadline([MATCHER]), MATCHER_ONLY_HEADLINE);
    assert.equal(quoteExcelSheetsHeadline([]), NO_QUOTE_SHEET_HEADLINE);
  });
});

describe("🔴 (b) 종류 라디오를 맞춰 줄까 — 한 종류뿐일 때만", () => {
  test("한 종류만 있으면 그 종류", () => {
    assert.equal(quoteExcelSuggestedKind([DOMESTIC]), "DOMESTIC");
    assert.equal(quoteExcelSuggestedKind([OH, MATCHER]), "OVERHAUL");
  });

  test("🔴 둘 다 있으면 맞춰 주지 않는다 — 사람이 고른다", () => {
    assert.equal(quoteExcelSuggestedKind([DOMESTIC, OH]), null);
  });

  test("🔴 매쳐뿐 · 아무것도 없음도 맞춰 주지 않는다", () => {
    assert.equal(quoteExcelSuggestedKind([MATCHER]), null);
    assert.equal(quoteExcelSuggestedKind([]), null);
  });
});

describe("🔴 (c) 고른 종류의 시트만 읽는다", () => {
  test("🔴 내자 → 내자 탭, OH → OH 탭", () => {
    const sheets = [DOMESTIC, MATCHER, OH];
    assert.equal(quoteExcelSheetIndexForKind(sheets, "DOMESTIC"), 0);
    assert.equal(quoteExcelSheetIndexForKind(sheets, "OVERHAUL"), 2);
  });

  test("🔴 짝지어지는 시트가 없으면 지정하지 않는다(null) — 조용히 딴 종류를 읽지 않는다", () => {
    assert.equal(quoteExcelSheetIndexForKind([DOMESTIC], "OVERHAUL"), null);
    assert.equal(quoteExcelSheetIndexForKind([MATCHER], "DOMESTIC"), null);
    assert.equal(quoteExcelSheetIndexForKind([DOMESTIC, OH], "CABLE"), null);
    assert.equal(quoteExcelSheetIndexForKind([], "DOMESTIC"), null);
  });

  test("같은 양식이 두 탭이면 앞의 것 — 탭 차례 그대로다", () => {
    const first = sheet(1, "내자견적서", "GENERATOR_DOMESTIC");
    const second = sheet(4, "내자견적서(2)", "GENERATOR_DOMESTIC");
    assert.equal(quoteExcelSheetIndexForKind([first, second], "DOMESTIC"), 1);
  });

  test("어느 탭으로 채우는지 한 줄로 짚어 준다 · 짝이 없으면 그 사실을 말한다", () => {
    assert.equal(
      quoteExcelChosenSheetLine([DOMESTIC, OH], "OVERHAUL"),
      "[만들기]를 누르면 「OH견적서」 시트로 폼을 채웁니다."
    );
    const none = quoteExcelChosenSheetLine([MATCHER], "OVERHAUL");
    assert.ok(none?.includes("엑셀이 알아본 시트로 채웁니다"), String(none));
    assert.equal(quoteExcelChosenSheetLine([], "DOMESTIC"), null);
  });
});
