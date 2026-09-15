import { formatAmountInput, parseAmountInput } from "@/lib/domain/amount-input";
import { quoteKindLabels, type QuoteKind } from "@/lib/validation/quote-input";
import type { QuoteExcelReadFields } from "./quote-excel-parse";
import type { QuoteIssueNoticeLine } from "./quote-issue-messages";

/**
 * ============================================================================
 * 수기 견적서 엑셀로 폼 칸 채우기 — 채울 계획과 알림 문장 (순수, 견적서 ①b)
 * ============================================================================
 * 엑셀 전용 견적서의 「수기 견적서 엑셀」 칸에 파일을 고르면 폼(QuoteEditForm)이 읽기 통로로 그
 * 엑셀을 읽고(quote-excel-parse.ts), **여기서 정한 대로** 칸을 채운다. DOM 도 fetch 도 모른다 —
 * 시험이 값으로 본다(quote-excel-autofill.test.ts).
 *
 * ── 🔴 채우는 방식 — 빈 칸만 채우고, 다른 칸은 제안한다 (2026-09-16 사용자 선택) ─────
 *  · 폼의 칸이 **비어 있으면**(앞뒤 공백뿐이면) 엑셀 값으로 곧바로 채운다 → `fills`.
 *  · 이미 적힌 칸이 엑셀과 **다르면 덮지 않는다** → `conflicts`. 폼이 「엑셀과 다른 칸」 목록과
 *    [엑셀 값으로 바꾸기]를 보인다. 목록은 폼이 그릴 때마다 지금 값으로 이 함수를 다시 불러
 *    얻는다 — 그래서 바꾼(또는 사람이 같게 고친) 칸은 저절로 목록에서 빠진다.
 *  · 같으면(앞뒤 공백 · 금액의 콤마 차이는 같은 것) 아무것도 하지 않는다 → `unchanged`.
 *  · 엑셀 값이 null(또는 공백뿐)인 칸은 건드리지 않고 어느 목록에도 넣지 않는다.
 *  · 🔴 **견적서 종류도 같다.** 종류는 폼에서 늘 값이 있다([새 견적서] 팝업에서 고른 값 · 기본
 *    내자) — 「이미 적힌 값」이라 **채우지 않고**, 엑셀과 다르면 제안만 한다. 읽은 종류가
 *    null(매쳐 — 시트로 내자 · OH 를 가를 수 없다)이면 어느 목록에도 넣지 않는다.
 *  · 발행일자도 같은 규칙이되 하나가 다르다 — 🔴 새 견적서에서 **손대지 않은 기본값(오늘)** 은
 *    빈 칸으로 본다(2026-09-16 사용자 결정 — quoteExcelPlanFormValues). 사람이 한 번이라도
 *    고쳤거나 · 채운 뒤이거나 · 저장된 견적서면 「적힌 값」이라 제안만 한다.
 *
 * ── 폼에 넣는 값의 모양 ─────────────────────────────────────────────────
 *  · 공급가액은 폼이 들고 있는 모양 그대로 — **콤마 없는** 숫자 글자다. 금액 칸
 *    (common/AmountInput.tsx)이 세 자리 콤마를 붙여 보여 준다. 사람이 칠 때 칸이 만드는 모양
 *    (domain/amount-input.ts 의 parseAmountInput)으로 한 번 더 고른다.
 *  · 발행일자는 `YYYY-MM-DD` 그대로(날짜 칸의 값 모양). 글자 칸은 앞뒤 공백을 걷은 값.
 *  · 종류는 `DOMESTIC` · `OVERHAUL` — 폼은 이것을 종류 select 와 **같은 함수**(changeKind)로 넣는다.
 *  · 🔴 신고증상은 채우지 않는다(어느 양식에도 칸이 없다 — 읽개 머리말).
 *
 * ── 알림 문장 ────────────────────────────────────────────────────────────
 * 채운 칸 · 다른 칸 · 읽개의 경고(warnings) · 실패 사유를 사람이 읽는 줄로 만드는 곳은
 * quoteExcelAutofillNoticeLines **하나**다. 줄의 모양은 [견적서 받기] 알림과 같다
 * (quote-issue-messages.ts 의 QuoteIssueNoticeLine — 그리는 쪽이 같은 조각을 쓴다).
 * ============================================================================
 */

/** 엑셀에서 폼으로 옮기는 칸 — 이름은 읽개 · 저장 쪽 QuoteFields · 폼 상태의 이름 그대로. */
export type QuoteExcelAutofillField = keyof QuoteExcelReadFields;

/** 칸 이름표 — 폼의 칸 이름 그대로. `Record` 라 읽개가 칸을 하나 늘리면 컴파일러가 여기를 짚는다. */
export const quoteExcelAutofillFieldLabels: Record<QuoteExcelAutofillField, string> = {
  kind: "견적서 종류",
  quoteNumber: "발행번호",
  quoteDate: "발행일자",
  customerNameText: "공급처",
  subject: "품명(건명)",
  modelNameText: "모델명",
  lotNumberText: "L/N",
  serialNumberText: "S/N",
  validity: "유효기간",
  delivery: "납기",
  payment: "결재조건",
  manualSupplyAmount: "공급가액",
};

/** 칸의 차례 — 폼에 놓인 차례와 같다. 알림 · 목록이 이 차례로 나온다. */
export const QUOTE_EXCEL_AUTOFILL_FIELDS: readonly QuoteExcelAutofillField[] = [
  "kind",
  "quoteNumber",
  "quoteDate",
  "customerNameText",
  "subject",
  "modelNameText",
  "lotNumberText",
  "serialNumberText",
  "validity",
  "delivery",
  "payment",
  "manualSupplyAmount",
];

/** 폼이 지금 들고 있는 값 — 칸 이름은 폼 상태 이름 그대로, 공급가액은 콤마 없는 값. */
export type QuoteExcelFormValues = { kind: QuoteKind } & Record<Exclude<QuoteExcelAutofillField, "kind">, string>;

/**
 * 계획에 넘길 폼 값 — 🔴 **새 견적서에서 손대지 않은 기본 발행일자(오늘)는 빈 칸으로 본다**
 * (2026-09-16 사용자 결정). 그래서 엑셀 날짜로 곧바로 채운다(제안으로 띄우지 않는다).
 *
 *  · 「손댐」은 값이 아니라 표시로 가른다 — 사람이 고쳤다가 우연히 오늘로 되돌려도 고친 것이다.
 *    날짜 칸에 친 것 · [엑셀 값으로 바꾸기] · 자동 채우기로 채운 것 모두 손댐이다(폼의
 *    editQuoteDate). 그래서 한 번 채운 뒤 다시 고른 엑셀의 날짜가 달라도 제안만 한다.
 *  · 저장된 견적서의 발행일자는 늘 「적힌 값」이다(`isNewQuote` 거짓).
 *  · 빈 칸처럼 보는 것은 이 **처음 기본값 하나**뿐이다 — 다른 칸은 그대로 넘긴다.
 */
export function quoteExcelPlanFormValues(
  values: QuoteExcelFormValues,
  quoteDate: { isNewQuote: boolean; touched: boolean }
): QuoteExcelFormValues {
  return quoteDate.isNewQuote && !quoteDate.touched ? { ...values, quoteDate: "" } : values;
}

/** 칸 하나의 바꿀 거리 — 채울 것이든 제안할 것이든 같은 모양이다. */
export type QuoteExcelFieldChange = {
  field: QuoteExcelAutofillField;
  label: string;
  /** 폼에 넣을 값 — 폼 상태의 모양(종류는 DOMESTIC · OVERHAUL, 공급가액은 콤마 없는 숫자 글자). */
  excelValue: string;
  /** 사람이 읽는 모양 — 종류는 이름표, 공급가액은 세 자리 콤마. */
  formDisplay: string;
  excelDisplay: string;
};

export type QuoteExcelAutofillPlan = {
  /** 폼이 비어 있어 곧바로 채울 칸. */
  fills: QuoteExcelFieldChange[];
  /** 폼에 이미 다른 값이 적혀 있어 덮지 않고 제안만 할 칸. */
  conflicts: QuoteExcelFieldChange[];
  /** 엑셀 값과 폼 값이 이미 같은 칸. */
  unchanged: QuoteExcelAutofillField[];
};

/** 폼의 칸이 비어 있는가 — 앞뒤 공백뿐이면 빈 칸이다(저장 검증도 그렇게 걷는다). */
export function isBlankFormValue(value: string): boolean {
  return value.trim() === "";
}

function cleanExcelText(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function amountDigits(value: string): string {
  return value.replace(/[\s,]/g, "");
}

/** 금액이 같은가 — 콤마 · 공백을 걷고 견준다. `3500000` 과 `3500000.00` 도 같다. */
function sameAmount(formValue: string, excelValue: string): boolean {
  const a = amountDigits(formValue);
  const b = amountDigits(excelValue);
  if (a === b) return true;
  if (a === "" || b === "") return false;
  const x = Number(a);
  const y = Number(b);
  return Number.isFinite(x) && Number.isFinite(y) && x === y;
}

type Candidate = { excelValue: string; formBlank: boolean; same: boolean; formDisplay: string; excelDisplay: string };

/** 칸 하나를 견준다. 엑셀에 값이 없으면 null(건드리지 않는다). */
function candidateFor(
  field: QuoteExcelAutofillField,
  form: QuoteExcelFormValues,
  fields: QuoteExcelReadFields
): Candidate | null {
  if (field === "kind") {
    const excelKind = fields.kind;
    if (excelKind === null) return null;
    // 폼의 종류는 늘 값이 있다 — 비어 있는 일이 없어 채우지 않는다(머리말 🔴).
    return {
      excelValue: excelKind,
      formBlank: false,
      same: excelKind === form.kind,
      formDisplay: quoteKindLabels[form.kind],
      excelDisplay: quoteKindLabels[excelKind],
    };
  }

  const excelText = cleanExcelText(fields[field]);
  if (excelText === null) return null;
  const formValue = form[field];

  if (field === "manualSupplyAmount") {
    const excelValue = parseAmountInput(excelText);
    if (excelValue === "") return null;
    return {
      excelValue,
      formBlank: isBlankFormValue(formValue),
      same: sameAmount(formValue, excelValue),
      formDisplay: formatAmountInput(parseAmountInput(formValue)),
      excelDisplay: formatAmountInput(excelValue),
    };
  }

  return {
    excelValue: excelText,
    formBlank: isBlankFormValue(formValue),
    same: formValue.trim() === excelText,
    formDisplay: formValue.trim(),
    excelDisplay: excelText,
  };
}

/**
 * (지금 폼 값, 읽은 값) → { 채울 칸, 다른 칸, 같은 칸 }. 머리말 「채우는 방식」 그대로다.
 * 폼은 결과가 온 순간 `fills` 를 넣고, 그릴 때마다 다시 불러 `conflicts` 를 목록으로 보인다.
 */
export function planQuoteExcelAutofill(form: QuoteExcelFormValues, fields: QuoteExcelReadFields): QuoteExcelAutofillPlan {
  const plan: QuoteExcelAutofillPlan = { fills: [], conflicts: [], unchanged: [] };
  for (const field of QUOTE_EXCEL_AUTOFILL_FIELDS) {
    const candidate = candidateFor(field, form, fields);
    if (candidate === null) continue;
    if (candidate.same) {
      plan.unchanged.push(field);
      continue;
    }
    const change: QuoteExcelFieldChange = {
      field,
      label: quoteExcelAutofillFieldLabels[field],
      excelValue: candidate.excelValue,
      formDisplay: candidate.formDisplay,
      excelDisplay: candidate.excelDisplay,
    };
    if (candidate.formBlank) plan.fills.push(change);
    else plan.conflicts.push(change);
  }
  return plan;
}

// ────────────────────────────────────────────────── 알림 문장

/** 읽는 동안 「수기 견적서 엑셀」 칸 곁에 보이는 한 줄. */
export const QUOTE_EXCEL_READING_TEXT = "엑셀을 읽는 중…";

/** 「엑셀과 다른 칸」 목록의 머리. */
export const QUOTE_EXCEL_CONFLICTS_TITLE = "엑셀과 다른 칸 — 폼에 적힌 값을 덮지 않았습니다";

export type QuoteExcelAutofillOutcome =
  /** 읽지 못했다 — 사유는 읽기 클라이언트(quote-excel-parse.ts)가 준 것. */
  | { kind: "failed"; reason: string; code: string | null }
  | {
      kind: "read";
      /** 결과가 온 순간 채운 칸. */
      filled: readonly QuoteExcelAutofillField[];
      /** 엑셀에서 값이 있던 칸의 수(채운 · 다른 · 같은 칸을 모두 더한 것). 0 이면 읽은 값이 없다. */
      readCount: number;
      /** **지금** 엑셀과 다른 칸의 수 — 바꾸면 줄어든다. */
      conflictCount: number;
      /** 읽개의 경고 — 사람이 읽는 문장 그대로. */
      warnings: readonly string[];
    };

/** 사유를 괄호 · 줄표 뒤에 이을 때 — 끝의 마침표만 뗀다(quote-issue-messages.ts 와 같은 손질). */
function reasonText(reason: string): string {
  const trimmed = reason.trim().replace(/\.+$/, "").trim();
  return trimmed === "" ? "까닭을 알 수 없습니다" : trimmed;
}

/** 채운 칸 · 다른 칸 · 경고 · 실패를 사람이 읽는 줄로. 알림 문장은 여기 하나다. */
export function quoteExcelAutofillNoticeLines(outcome: QuoteExcelAutofillOutcome): QuoteIssueNoticeLine[] {
  if (outcome.kind === "failed") {
    // 옛 .xls 는 사용자가 정한 문장 그대로(읽기 클라이언트가 이미 그 문장을 싣는다).
    if (outcome.code === "XLS_LEGACY") return [{ text: outcome.reason, tone: "warning" }];
    return [{ text: `엑셀을 읽지 못해 칸을 채우지 못했습니다 — ${reasonText(outcome.reason)}`, tone: "warning" }];
  }

  const lines: QuoteIssueNoticeLine[] = [];
  if (outcome.readCount === 0) {
    lines.push({ text: "엑셀에서 읽은 값이 없어 칸을 채우지 않았습니다", tone: "warning" });
  } else {
    if (outcome.filled.length > 0) {
      const labels = outcome.filled.map((field) => quoteExcelAutofillFieldLabels[field]).join(" · ");
      lines.push({ text: `엑셀에서 빈 칸 ${outcome.filled.length}개를 채웠습니다: ${labels}`, tone: "normal" });
    }
    if (outcome.conflictCount > 0) {
      lines.push({
        text: `폼에 이미 적힌 값과 다른 칸 ${outcome.conflictCount}개는 덮지 않았습니다 — 아래 목록에서 엑셀 값으로 바꿀 수 있습니다`,
        tone: "warning",
      });
    }
    if (outcome.filled.length === 0 && outcome.conflictCount === 0) {
      lines.push({ text: "폼의 칸이 엑셀과 같습니다 — 채울 칸이 없습니다", tone: "normal" });
    }
  }
  for (const warning of outcome.warnings) lines.push({ text: warning, tone: "warning" });
  return lines;
}

/** 「엑셀과 다른 칸」 목록의 한 줄 — `공급처(폼: A / 엑셀: B)`. */
export function quoteExcelConflictText(change: QuoteExcelFieldChange): string {
  return `${change.label}(폼: ${change.formDisplay} / 엑셀: ${change.excelDisplay})`;
}
