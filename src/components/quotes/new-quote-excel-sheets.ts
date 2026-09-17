import type { HandwrittenQuoteSheet } from "@/lib/xlsx/handwritten-quote-reader";
import { quoteKindLabels, type QuoteKind } from "@/lib/validation/quote-input";
import type { QuoteExcelSheetInfo } from "./quote-excel-parse";

/**
 * ============================================================================
 * 「새 견적서」 팝업이 엑셀을 읽고 나서 하는 말 — 순수 규칙 (견적서 ⑤b)
 * ============================================================================
 * 팝업에서 [엑셀 전용 견적서]를 켜고 엑셀을 올리면 읽기 통로가 **알아본 시트 전부**를
 * 돌려준다(quote-excel-parse.ts 의 `sheets`). 이 파일은 그 목록 하나로 세 가지를 정한다:
 *  ① 사람에게 할 말(무엇이 들어 있나)
 *  ② 종류 라디오를 맞춰 줄까(들어 있는 견적서가 한 종류뿐일 때만)
 *  ③ 고른 종류에 짝지어지는 **시트 차례**(그 탭만 읽는다)
 *
 * DOM 도 fetch 도 만지지 않는다 — 시험이 값으로 본다(new-quote-excel-sheets.test.ts).
 *
 * ── 🔴 `filled`(작성된 것으로 보이나)는 거르는 막이 아니다 ──────────────────
 * 제너레이터 내자 양식 **파일 자체에 OH 탭이 들어 있고**, 거기 작업비가 인쇄돼 있어
 * `filled: true` 로 나온다(2026-09-17 A 조각이 실제 양식을 떠 보고 확인). 규칙이 틀린 것이
 * 아니라 진짜 인쇄된 금액이다. 그러니 **알아본 시트는 늘 다 싣고**, `filled` 는 「작성된
 * 것으로 보임」 한마디로만 말한다. 이 값으로 목록에서 줄을 빼지 않는다.
 *
 * ── 🔴 매쳐 시트도 이제 종류가 정해진다 (2026-09-17) ─────────────────────
 * 매쳐 양식 한 장을 내자로도 OH 로도 쓰지만, **OH 양식에만 「OH작업」 이름표가 인쇄돼 있다**
 * — 읽개가 그 글자로 갈라 `MATCHER_DOMESTIC` · `MATCHER_OH` 로 돌려준다. 그래서 매쳐 파일
 * 하나만 올려도 라디오를 맞춰 준다(🔴 맞춰 주기만 하고 잠그지 않는다 — 아래 (b)).
 *
 * 남은 `MATCHER` 는 **그 이름표를 읽지 못한 시트**다(탭 이름으로만 알아본 경우). 그때는
 * 지금까지처럼 종류를 맞춰 주지 않고 **있는 그대로 알린 뒤 사람이 고르게** 한다.
 * ============================================================================
 */

/**
 * 양식 → 견적서 종류. 🔴 갈래 없는 매쳐만 null 이다(머리말). `Record` 라 읽개에 양식이
 * 하나 늘면 컴파일러가 여기를 짚는다.
 */
export const QUOTE_EXCEL_SHEET_FORM_KINDS: Record<HandwrittenQuoteSheet, QuoteKind | null> = {
  GENERATOR_DOMESTIC: "DOMESTIC",
  GENERATOR_OH: "OVERHAUL",
  MATCHER_DOMESTIC: "DOMESTIC",
  MATCHER_OH: "OVERHAUL",
  MATCHER: null,
};

/** 갈래 없는 매쳐의 이름표 — 종류 이름표가 없는 유일한 양식이다. */
export const MATCHER_SHEET_LABEL = "매쳐 견적서";

/** 양식 하나의 이름표. 종류가 있는 양식은 **종류 이름표 그대로**다(화면이 같은 말을 쓴다). */
export function quoteExcelSheetFormLabel(form: HandwrittenQuoteSheet): string {
  const kind = QUOTE_EXCEL_SHEET_FORM_KINDS[form];
  return kind === null ? MATCHER_SHEET_LABEL : quoteKindLabels[kind];
}

/** 「작성된 것으로 보임」 — filled 를 사람 말로. 거르는 막이 아니라 곁말이다(머리말). */
export const SHEET_FILLED_NOTE = "작성된 것으로 보임";

/** 시트 한 줄 — `탭이름 — 양식이름 · 작성된 것으로 보임`. */
export function quoteExcelSheetLine(sheet: QuoteExcelSheetInfo): string {
  const note = sheet.filled ? ` · ${SHEET_FILLED_NOTE}` : "";
  return `${sheet.name} — ${quoteExcelSheetFormLabel(sheet.form)}${note}`;
}

/** 이 목록에 들어 있는 견적서 종류들(매쳐는 세지 않는다), 탭 차례 그대로 · 중복 없이. */
export function quoteExcelSheetKinds(sheets: readonly QuoteExcelSheetInfo[]): QuoteKind[] {
  const kinds: QuoteKind[] = [];
  for (const sheet of sheets) {
    const kind = QUOTE_EXCEL_SHEET_FORM_KINDS[sheet.form];
    if (kind !== null && !kinds.includes(kind)) kinds.push(kind);
  }
  return kinds;
}

/**
 * 고른 종류로 읽을 **탭 차례**. 짝지어지는 시트가 없으면 null 이다 — 그때는 시트를 지정하지
 * 않고 통로가 혼자 고르게 둔다(매쳐만 든 파일 · 케이블을 고른 경우). 🔴 조용히 딴 종류의
 * 시트를 고르지 않는다.
 */
export function quoteExcelSheetIndexForKind(
  sheets: readonly QuoteExcelSheetInfo[],
  kind: QuoteKind
): number | null {
  const found = sheets.find((sheet) => QUOTE_EXCEL_SHEET_FORM_KINDS[sheet.form] === kind);
  return found ? found.index : null;
}

/**
 * 종류 라디오를 맞춰 줄까 — 들어 있는 견적서가 **한 종류뿐일 때만** 그 종류다. 둘 다 들어
 * 있으면(또는 매쳐뿐이면) null 이다: 그때는 사람이 고른다. 🔴 맞춰 주기만 하고 **라디오를
 * 잠그지 않는다** — 사람이 곧바로 바꿀 수 있어야 한다.
 */
export function quoteExcelSuggestedKind(sheets: readonly QuoteExcelSheetInfo[]): QuoteKind | null {
  const kinds = quoteExcelSheetKinds(sheets);
  return kinds.length === 1 ? kinds[0] : null;
}

/** 둘 다 든 파일에 하는 물음 — 사용자가 준 문장 그대로다(2026-09-17). */
export const BOTH_QUOTE_SHEETS_QUESTION =
  "내자 견적서와 OH 견적서가 모두 작성된 파일입니다. 어떤 견적서로 저장하시겠습니까?";

/** 알아본 시트가 하나도 없을 때 — 보통은 통로가 먼저 거절한다(NO_QUOTE_SHEET). */
export const NO_QUOTE_SHEET_HEADLINE = "이 엑셀에서 견적서 시트를 알아보지 못했습니다.";

/** 매쳐만 든 파일 — 종류가 정해지지 않으니 사람이 고른다. */
export const MATCHER_ONLY_HEADLINE = `${MATCHER_SHEET_LABEL} 시트만 들어 있습니다 — 종류가 정해지지 않으니 아래에서 골라 주세요.`;

/**
 * 「무엇이 들어 있는지」 한 줄. 아래에 시트 목록이 그대로 붙으므로 여기서는 **어느 갈래인지**만
 * 말한다.
 */
export function quoteExcelSheetsHeadline(sheets: readonly QuoteExcelSheetInfo[]): string {
  if (sheets.length === 0) return NO_QUOTE_SHEET_HEADLINE;
  const kinds = quoteExcelSheetKinds(sheets);
  if (kinds.length === 0) return MATCHER_ONLY_HEADLINE;
  if (kinds.length > 1) return BOTH_QUOTE_SHEETS_QUESTION;
  const label = quoteKindLabels[kinds[0]];
  return `${label}만 들어 있습니다 — 견적서 종류를 ${label}로 맞췄습니다. 아래에서 바꿀 수 있습니다.`;
}

/**
 * [만들기]를 누르면 **어느 탭으로** 폼을 채우는지 한 줄. 짝지어지는 시트가 없으면 통로가
 * 혼자 고른다는 것을 말한다 — 말없이 딴 탭의 값이 들어오는 것처럼 보이지 않게.
 */
export function quoteExcelChosenSheetLine(
  sheets: readonly QuoteExcelSheetInfo[],
  kind: QuoteKind
): string | null {
  if (sheets.length === 0) return null;
  const index = quoteExcelSheetIndexForKind(sheets, kind);
  if (index === null) {
    return `고르신 ${quoteKindLabels[kind]}의 시트가 이 엑셀에 없습니다 — 엑셀이 알아본 시트로 채웁니다.`;
  }
  const name = sheets.find((sheet) => sheet.index === index)?.name ?? "";
  return `[만들기]를 누르면 「${name}」 시트로 폼을 채웁니다.`;
}
