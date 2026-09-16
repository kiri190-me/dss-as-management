import { isValidDateString } from "@/lib/domain/local/validation";
import { WORKFLOW_KIND_CODES, type WorkflowKind } from "@/lib/domain/workflow-kind";

function isWorkflowKind(value: unknown): value is WorkflowKind {
  return typeof value === "string" && (WORKFLOW_KIND_CODES as readonly string[]).includes(value);
}

/**
 * ============================================================================
 * 견적서 입력 검증 — 형식만 본다
 * ============================================================================
 * domestic-order-input.ts 와 같은 자리, 같은 규칙이다. **DB도 세션도 여기서
 * 만지지 않는다** — 순수 함수만 두어야 단위 테스트가 붙고, 그래야 "어떤 값을
 * 받아들이는가"가 실제로 검증된다. 존재 여부(그 수리 건이 있는가)와 동시
 * 수정(version), 번호 중복은 자료의 문제라 mutation 이, 누가 고칠 수 있는가는
 * 정책이라 서버 액션이 맡는다.
 *
 * ── 필수인 칸이 넷이다 ──────────────────────────────────────────────────
 * 발행번호 · 발행일자 · 공급처 · 품명. 이 넷은 xlsx 양식의 D11·D10·D12·D13 에
 * 그대로 찍혀 나가는 값이고, 비어 있으면 **빈 칸짜리 견적서가 고객사로 간다.**
 * 나머지는 전부 비워도 된다 — 모델명·L/N·S/N 이 없는 견적(수리 없이 부품만
 * 파는 경우)이 실제로 있다.
 *
 * 공급처를 **글자로도 받는 것**은 이 값이 스냅샷이기 때문이다
 * (schema/quotes.ts 의 '스냅샷이다'). customerId 는 나중에 이어 보기 위한
 * 연결일 뿐이고, 종이에 찍히는 것은 customerNameText 다. 마스터에 없는
 * 거래처로 한 장 내는 일이 있어서 id 는 비어도 된다.
 *
 * ── 유효기간·납기·결재조건은 비어 있는 것이 기본이다 ────────────────────
 * null 이면 양식에 이미 적힌 문구("발행일로부터 4주" 등)가 그대로 나간다
 * (quote-template.ts). 기본값을 여기서 채워 넣으면 양식의 문구를 고쳤을 때
 * 두 곳이 어긋난다. 그래서 이 검증은 빈 값을 오류로 보지 않는다.
 *
 * ── 은행계좌는 받지 않는다 ──────────────────────────────────────────────
 * 양식(D18)에 이미 적혀 있고, 계좌번호를 코드에도 DB 에도 두지 않는다.
 *
 * ── 오류는 칸 단위 한국어다 ─────────────────────────────────────────────
 * fieldErrors 의 키로 화면이 입력칸 밑에 문장을 붙인다. 부품 줄의 오류는
 * `items.2.quantity` 처럼 **줄 번호를 낀 키**라, 다섯째 줄이 틀렸는데 첫 줄에
 * 빨간 글씨가 붙는 일이 없다.
 * ============================================================================
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidQuoteId(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

/** 낙관적 잠금 토큰. version 은 1부터 시작하는 정수라 0 이하는 존재할 수 없다. */
export function isValidExpectedVersion(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

/** 발행번호·공급처·품명·모델명처럼 한 줄로 적는 칸. */
const MAX_SHORT_TEXT = 200;
/** 신고증상처럼 사람이 길게 적는 칸. */
const MAX_LONG_TEXT = 4000;

/**
 * numeric(15,2) — 정수부 13자리 + 소수부 2자리. 이 폭을 넘는 값을 그대로
 * 넘기면 Postgres 가 22003(numeric field overflow)으로 거절하고, 그 오류는
 * 사용자에게 아무것도 설명하지 못한다.
 */
const AMOUNT_PATTERN = /^\d{1,13}(?:\.\d{1,2})?$/;

/**
 * 한 장에 담을 수 있는 부품 줄의 상한.
 *
 * 양식의 부품 칸은 담을 만큼 줄이 늘어난다(xlsx/quote-sheet-layout.ts).
 * 그러니 여기서 줄 수로 막지
 * **않는다** — 상세를 시스템에 남기는 것이 그 규칙의 요점이다. 다만 상한이
 * 아예 없으면 잘못 만들어진 요청 하나가 한 장에 수천 행을 밀어 넣을 수 있고,
 * 그러면 목록의 합계 조회가 그 장 하나 때문에 느려진다. 쉰 줄을 넘는 부품
 * 목록은 실제 견적에 없다.
 */
export const MAX_QUOTE_ITEMS = 50;

/** 수량은 integer 컬럼이다. 자바스크립트에서 통과시켜 놓고 DB 에서 터지지 않게 자른다. */
const MAX_QUANTITY = 2_147_483_647;

export type QuoteItemInput = {
  /** 재고에서 고른 경우에만. 손으로 적은 줄은 null 이 정상이다. */
  partId: string | null;
  /** `2) OH 부품 비용` 칸에 들어가는 줄인가(schema/quotes.ts). */
  isOverhaulPart: boolean;
  partNameText: string;
  quantity: number;
  /** numeric 컬럼이라 문자열로 오간다(schema/quotes.ts 의 '금액은 numeric 이다'). */
  unitPrice: string;
};

/**
 * 견적서 종류. 두 양식이 실제로 다르다(schema/quotes.ts 의 quoteKindEnum).
 * **O/H 대상 판정과는 별개다** — 대상품이어도 둘 다 발행하므로 사람이 고른다.
 */
export const QUOTE_KINDS = ["DOMESTIC", "OVERHAUL"] as const;
export type QuoteKind = (typeof QUOTE_KINDS)[number];

/**
 * ============================================================================
 * 🔴 DB 에 들어 있을 수 있는 종류 — 위 QUOTE_KINDS 와 **일부러 다르다**
 * ============================================================================
 * 2026-09-16 에 스키마의 quote_kind 에 `CABLE` 이 생겼다(0101). 그런데 케이블
 * 견적서를 **만들고 고치는 화면 · 양식 · 검증은 아직 없다.** 그래서 이름을 둘로
 * 갈라 둔다:
 *
 *   QUOTE_KINDS        앱이 **다루는** 종류. 사람이 고르는 자리(새 견적서 대화상자 ·
 *                      수정 화면)와 검증(isQuoteKind)이 이것만 받는다.
 *                      **여기에 CABLE 을 더하는 것이 케이블 견적서를 여는 일**이고,
 *                      그것은 화면 · 라벨 · 양식 고르기가 함께 오는 뒤 조각의 몫이다.
 *   STORED_QUOTE_KINDS DB 가 **내줄 수 있는** 종류 전부. 읽어서 있는 그대로 보여
 *                      주기만 하는 자리(목록의 종류 딱지)가 이것을 쓴다.
 *
 * 하나로 합치면 둘 중 하나가 거짓말이 된다 — 좁히면 목록이 DB 에 있는 값을 못
 * 받고(그래서 셋째 값을 둘 중 하나로 접게 된다), 넓히면 지금 못 만드는 견적서를
 * 만들 수 있게 된다.
 * ============================================================================
 */
export const STORED_QUOTE_KINDS = ["DOMESTIC", "OVERHAUL", "CABLE"] as const;
export type StoredQuoteKind = (typeof STORED_QUOTE_KINDS)[number];

/**
 * 종류마다의 이름표. **DB 에 있을 수 있는 값을 전부 덮는다**(Record<StoredQuoteKind>) —
 * 목록이 읽어 온 값을 그대로 그리기 때문이다. 케이블 견적서를 아직 만들 수는 없지만,
 * 이름이 없으면 그 줄을 「종류를 알 수 없음」으로 그리거나 둘 중 하나로 접어야 한다.
 * 이름표가 있다고 만들 수 있게 되는 것은 아니다 — 고르는 자리는 위 QUOTE_KINDS 를 돈다.
 */
export const quoteKindLabels: Record<StoredQuoteKind, string> = {
  DOMESTIC: "내자 견적서",
  OVERHAUL: "OH 견적서",
  CABLE: "케이블 견적서",
};

export function isQuoteKind(value: unknown): value is QuoteKind {
  return typeof value === "string" && (QUOTE_KINDS as readonly string[]).includes(value);
}

export type QuoteFields = {
  quoteNumber: string;
  kind: QuoteKind;
  /** "YYYY-MM-DD". 실제 달력에 있는 날이어야 한다. */
  quoteDate: string;
  repairCaseId: string | null;
  intakeNumberText: string | null;
  customerId: string | null;
  customerNameText: string;
  modelNameText: string | null;
  lotNumberText: string | null;
  serialNumberText: string | null;
  faultDescriptionText: string | null;
  subject: string;
  validity: string | null;
  delivery: string | null;
  payment: string | null;
  workCost: string;
  /**
   * 작업비를 만든 근거. **양식으로 나가지 않는다** — 견적서에 찍히는 것은 합계
   * 하나이고, 이 셋은 "그 합계가 어떻게 나왔나"에 답하기 위해 저장한다.
   *
   * 셋 다 **그때 값의 사본**이다. 카탈로그를 보게 하면 나중에 단가가 오르는 순간
   * 이미 보낸 견적서의 근거가 소리 없이 달라진다(schema/repair-labor.ts).
   *
   * `laborEquipmentKind` 가 null 이면 **작업을 골라 본 적이 없는 견적서**다 —
   * 이 기능이 생기기 전에 만든 것들이 전부 그렇다.
   */
  laborEquipmentKind: WorkflowKind | null;
  laborBaseCost: string | null;
  /**
   * 「① 조사작업」을 문서에서 빼는가 — 사람이 조사 칸을 **손대서 비운** 장이다
   * (2026-09-15, domain/quote-work-scope-suppression.ts 의 isInvestigationScopeEmptied).
   * 보내지 않으면 `false` 다 — 이 칸이 생기기 전에 만든 요청이 그대로 동작해야 하고,
   * 빈 조사 칸만으로는 빼지 않는다(옛 견적서).
   */
  investigationExcluded: boolean;
  /**
   * 통전작업을 빼고 청구하는가 — **사람의 결정**이다. 보내지 않으면 `false` 다
   * (이 칸이 생기기 전에 만들어진 요청이 그대로 동작해야 하고, DB 기본값도
   * false 다).
   */
  powerTestExcluded: boolean;
  /**
   * 그때 실제로 뺀 금액. **화면이 셈해 보낸 값을 그대로 적는다** — 서버가
   * repair_labor_settings 를 다시 보고 계산하면, 통전 공수시간이 바뀌는 순간
   * 이미 보낸 견적서의 근거가 소리 없이 달라진다(schema/quotes.ts 의 그 항목).
   *
   * `null` 은 **"빼지 않았다"**이다 — 제외하기로 했으나 통전 공수시간이 없어
   * 빼지 못한 장이 여기에 해당한다. `"0"` 은 "빼기는 했는데 0원"이라 다르다.
   */
  laborPowerTestDeduction: string | null;
  /**
   * 서류작업을 빼고 청구하는가(2026-09-16) — 위 둘과 **같은 성격의 사람의 결정**이다.
   * 보내지 않으면 `false` 다(옛 요청이 그대로 동작하고, DB 기본값도 false 다).
   *
   * 🔴 **뺀 금액을 담는 칸이 없다** — 통전의 laborPowerTestDeduction 같은 짝이 조사에도
   * 서류에도 없다(domain/quote-labor-cost.ts 머리말). 뺀 사실은 이 칸이 말하고, 청구한
   * 금액은 사람이 적용한 workCost 그대로다.
   *
   * 🔴 **문서는 이 칸을 보지 않는다** — 견적서의 구역은 조사 · 수리 · 통전 셋뿐이라
   * 서류작업은 적히는 자리가 없다(사용자 결정 2026-09-16). 금액만 빠진다.
   */
  documentExcluded: boolean;
  /**
   * 엑셀 전용 견적서인가(2026-09-15 Q2 — schema/quotes.ts 의 is_excel_only). 켜지면 이
   * 장에는 부품 · 작업 내역 · 고른 수리 작업이 **하나도 없어야** 하고, 공급가액을
   * 아래 칸에 손으로 적는다. 보내지 않으면 `false` 다 — 옛 요청이 그대로 동작한다.
   */
  isExcelOnly: boolean;
  /**
   * 엑셀 전용 견적서의 공급가액(부가세 별도) — numeric 이라 문자열이다. **엑셀 전용일
   * 때만** 값이 있고 그때는 필수다. 엑셀 전용이 아니면 늘 null 이다(DB CHECK 와 같은 규칙).
   */
  manualSupplyAmount: string | null;
  repairTasks: QuoteRepairTaskInput[];
  /**
   * 견적서에 적히는 작업 내역(조사/수리/통전). 묶음 안의 **차례가 곧 배열
   * 순서**다 — 문서에 적히는 순서 그대로다.
   *
   * 빈 배열은 "작업 내역을 안 적는다"이고, 그것도 뜻이다(제너레이터 양식에는
   * 이 구역이 없다).
   */
  workScopeLines: QuoteWorkScopeLineInput[];
  items: QuoteItemInput[];
};

/** 작업 내역 묶음. 매쳐 양식의 `1) 2) 3)` 이 그대로 이 축이다. */
export const QUOTE_WORK_SCOPE_SECTIONS = ["INVESTIGATION", "REPAIR", "POWER_TEST"] as const;
export type QuoteWorkScopeSection = (typeof QUOTE_WORK_SCOPE_SECTIONS)[number];

export const quoteWorkScopeSectionLabels: Record<QuoteWorkScopeSection, string> = {
  INVESTIGATION: "조사작업",
  REPAIR: "수리작업",
  POWER_TEST: "통전작업",
};

export type QuoteWorkScopeLineInput = {
  section: QuoteWorkScopeSection;
  text: string;
};

/** 견적서가 고른 수리 작업 한 줄. 카탈로그의 줄이 아니라 그때 값의 사본이다. */
export type QuoteRepairTaskInput = {
  /** 카탈로그의 그 줄. 참고용이고 금액 계산에는 쓰지 않는다. */
  taskId: string | null;
  taskName: string;
  hours: number;
  hourlyRate: string;
};

export type ValidateQuoteResult =
  | { ok: true; data: QuoteFields }
  | { ok: false; fieldErrors: Record<string, string> };

const SHORT_TEXT_FIELDS = {
  intakeNumberText: "인수번호",
  modelNameText: "모델명",
  lotNumberText: "L/N",
  serialNumberText: "S/N",
  validity: "유효기간",
  delivery: "납기",
  payment: "결재조건",
} as const;

export function validateQuoteFields(raw: Record<string, unknown>): ValidateQuoteResult {
  const fieldErrors: Record<string, string> = {};

  /**
   * 비어 있음의 표준형은 null 하나다. undefined(키 없음), 빈 문자열, 공백만
   * 적힌 값은 전부 같은 뜻이고, 셋을 구분해 저장하면 목록에서 "-"로 보이는
   * 값이 세 종류가 된다.
   */
  function optionalText(key: string, label: string, maxLength: number): string | null {
    const value = raw[key];
    if (value === null || value === undefined) return null;
    if (typeof value !== "string") {
      fieldErrors[key] = `${label} 값을 확인할 수 없습니다.`;
      return null;
    }
    const trimmed = value.trim();
    if (trimmed === "") return null;
    if (trimmed.length > maxLength) {
      fieldErrors[key] = `${label}은(는) ${maxLength}자를 넘을 수 없습니다.`;
      return null;
    }
    return trimmed;
  }

  function requiredText(key: string, label: string, maxLength: number): string {
    const value = raw[key];
    if (typeof value !== "string" || value.trim() === "") {
      fieldErrors[key] = `${label}을(를) 입력해 주세요.`;
      return "";
    }
    const trimmed = value.trim();
    if (trimmed.length > maxLength) {
      fieldErrors[key] = `${label}은(는) ${maxLength}자를 넘을 수 없습니다.`;
      return "";
    }
    return trimmed;
  }

  function optionalId(key: string, label: string): string | null {
    const value = raw[key];
    if (value === null || value === undefined || value === "") return null;
    if (!isValidQuoteId(value)) {
      fieldErrors[key] = `${label} 값을 확인할 수 없습니다.`;
      return null;
    }
    return value;
  }

  // 종류. 보내지 않으면 내자로 본다 — 이 칸이 생기기 전에 만들어진 요청이
  // 그대로 동작해야 하고, DB 기본값도 DOMESTIC 이다.
  const rawKind = raw.kind;
  let kind: QuoteKind = "DOMESTIC";
  if (rawKind !== null && rawKind !== undefined && rawKind !== "") {
    if (!isQuoteKind(rawKind)) fieldErrors.kind = "견적서 종류를 확인할 수 없습니다.";
    else kind = rawKind;
  }

  const quoteNumber = requiredText("quoteNumber", "발행번호", MAX_SHORT_TEXT);
  const customerNameText = requiredText("customerNameText", "공급처", MAX_SHORT_TEXT);
  const subject = requiredText("subject", "품명", MAX_SHORT_TEXT);

  // 발행일자. 양식 D10 에 날짜로 찍히므로 실제 달력에 있는 날이어야 한다.
  const rawQuoteDate = raw.quoteDate;
  let quoteDate = "";
  if (typeof rawQuoteDate !== "string" || rawQuoteDate.trim() === "") {
    fieldErrors.quoteDate = "발행일자를 입력해 주세요.";
  } else if (!isValidDateString(rawQuoteDate.trim())) {
    fieldErrors.quoteDate = "발행일자를 YYYY-MM-DD 형식으로 입력해 주세요.";
  } else {
    quoteDate = rawQuoteDate.trim();
  }

  const shortTexts = {} as Record<keyof typeof SHORT_TEXT_FIELDS, string | null>;
  for (const [key, label] of Object.entries(SHORT_TEXT_FIELDS)) {
    shortTexts[key as keyof typeof SHORT_TEXT_FIELDS] = optionalText(key, label, MAX_SHORT_TEXT);
  }

  const faultDescriptionText = optionalText("faultDescriptionText", "신고증상", MAX_LONG_TEXT);
  const repairCaseId = optionalId("repairCaseId", "수리 건");
  const customerId = optionalId("customerId", "고객사");
  const workCost = normalizeAmount("workCost", "작업비", raw.workCost, fieldErrors) ?? "0";
  const items = normalizeItems(raw.items, fieldErrors);

  /**
   * 작업비의 근거. **형식만 본다** — 그 작업이 카탈로그에 실제로 있는지는 여기서
   * 확인하지 않는다(DB 를 만지지 않는 자리다). 어차피 값의 사본이라, 카탈로그에서
   * 지워진 뒤에도 이미 보낸 견적서는 그대로 남아야 한다.
   */
  const laborEquipmentKind = isWorkflowKind(raw.laborEquipmentKind) ? raw.laborEquipmentKind : null;
  const laborBaseCost = normalizeAmount("laborBaseCost", "기본 작업비", raw.laborBaseCost, fieldErrors);
  /**
   * 통전작업 제외. **켜졌다고 말한 것만 켜짐**으로 본다(items 의 isOverhaulPart
   * 와 같은 규칙) — `"false"` 나 `0` 같은 값이 참으로 읽혀 금액이 140만원
   * 줄어드는 일은 없어야 한다.
   */
  const powerTestExcluded = raw.powerTestExcluded === true;
  /**
   * 「① 조사작업」 뺌. 통전작업 제외와 같은 규칙 — **켜졌다고 말한 것만 켜짐**이다.
   * 잘못 읽혀 켜지면 표준 조사 목록이 문서에서 소리 없이 사라진다.
   */
  const investigationExcluded = raw.investigationExcluded === true;
  const laborPowerTestDeduction = normalizeAmount(
    "laborPowerTestDeduction",
    "통전작업 제외 금액",
    raw.laborPowerTestDeduction,
    fieldErrors
  );
  /**
   * 서류작업 제외(2026-09-16). 위 둘과 같은 규칙 — **켜졌다고 말한 것만 켜짐**이다.
   * 잘못 읽혀 켜지면 기본 작업비에서 서류 몫이 소리 없이 빠진 채 저장된다.
   */
  const documentExcluded = raw.documentExcluded === true;
  const repairTasks = normalizeRepairTasks(raw.repairTasks, fieldErrors);
  const workScopeLines = normalizeWorkScopeLines(raw.workScopeLines, fieldErrors);

  /**
   * 엑셀 전용 견적서(2026-09-15 Q2). 켜짐은 다른 두 스위치와 같은 규칙 — **켜졌다고 말한
   * 것만 켜짐**이다(잘못 읽혀 켜지면 품목이 있는 장이 저장을 거절당한다).
   *
   * 수기 공급가액은 다른 금액 칸과 **같은 규칙**으로 읽는다(normalizeAmount — 콤마를
   * 지우고, numeric(15,2) 폭 · 0 이상 · 소수 둘째 자리까지). 엑셀 전용 · 줄 · 금액의
   * 짝은 아래 quoteExcelOnlyFieldErrors 한 곳이 본다 — mutation 도 같은 함수를 마지막
   * 방어선으로 부른다.
   */
  const isExcelOnly = raw.isExcelOnly === true;
  const manualSupplyAmount = normalizeAmount("manualSupplyAmount", "공급가액", raw.manualSupplyAmount, fieldErrors);
  const excelOnlyErrors = quoteExcelOnlyFieldErrors({
    isExcelOnly,
    manualSupplyAmount,
    items,
    workScopeLines,
    repairTasks,
  });
  for (const [key, message] of Object.entries(excelOnlyErrors)) {
    // 형식 오류가 이미 붙은 칸은 덮지 않는다 — 「형식이 틀렸다」가 더 정확한 말이다
    // (형식이 틀린 금액은 null 로 오므로 여기서 「비었다」로 다시 읽힌다).
    if (!(key in fieldErrors)) fieldErrors[key] = message;
  }

  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };

  return {
    ok: true,
    data: {
      quoteNumber,
      kind,
      quoteDate,
      repairCaseId,
      intakeNumberText: shortTexts.intakeNumberText,
      customerId,
      customerNameText,
      modelNameText: shortTexts.modelNameText,
      lotNumberText: shortTexts.lotNumberText,
      serialNumberText: shortTexts.serialNumberText,
      faultDescriptionText,
      subject,
      validity: shortTexts.validity,
      delivery: shortTexts.delivery,
      payment: shortTexts.payment,
      workCost,
      laborEquipmentKind,
      laborBaseCost,
      investigationExcluded,
      powerTestExcluded,
      laborPowerTestDeduction,
      documentExcluded,
      repairTasks,
      workScopeLines,
      items,
      isExcelOnly,
      manualSupplyAmount,
    },
  };
}

/**
 * ============================================================================
 * 엑셀 전용 견적서의 규칙 — 한 곳 (2026-09-15 Q2)
 * ============================================================================
 * 엑셀 전용 견적서는 손으로 만든 엑셀이 곧 보낸 문서다(schema/quotes.ts 의
 * is_excel_only). 그래서:
 *
 *  1. **부품 · 작업 내역 · 고른 수리 작업이 하나도 없어야 한다.** 있으면 오류다 —
 *     조용히 지우지 않는다. 사람이 적어 둔 줄이 저장 한 번에 사라지면, 그 장을 일반
 *     견적서로 되돌렸을 때 무엇을 적었는지 되찾을 길이 없다.
 *  2. **공급가액이 필수다.** 품목이 없으니 금액이 나올 곳이 이 칸뿐이다. 0 은 허용한다
 *     (무상 견적 — DB CHECK quotes_manual_supply_amount_not_negative 와 같은 규칙).
 *  3. 엑셀 전용이 **아니면** 공급가액은 비어 있어야 한다 — DB CHECK
 *     quotes_manual_supply_amount_excel_only 와 같은 규칙을 검증에서 먼저 본다. 거기서
 *     처음 걸리면 사람에게는 「일시적으로 저장할 수 없습니다」로만 보인다.
 *
 * 붙인 엑셀 파일이 있는지는 **여기서 보지 않는다** — 새 견적서는 저장한 뒤에야 파일을
 * 올릴 수 있다. 목록 조회의 hasExcel 로 화면이 알린다(queries/quotes.ts).
 *
 * 작업비 · 작업비의 근거 칸(labor_* · 통전/조사 스위치)은 막지 않는다 — 금액은 그 칸들을
 * 보지 않고(domain/quote-list.ts 의 quoteSupplyAmountOf), 막으면 일반 견적서에서 엑셀
 * 전용으로 바꾸는 사람이 보이지 않는 칸까지 비워야 한다.
 *
 * 검증(validateQuoteFields)과 mutation(createQuote · updateQuote 의 마지막 방어선)이
 * 이 함수 하나를 부른다. 두 곳에 따로 적으면 한쪽만 규칙이 바뀌는 날이 온다.
 * ============================================================================
 */
export function quoteExcelOnlyFieldErrors(fields: {
  isExcelOnly: boolean;
  /** 이미 읽어 낸 금액(문자열) — 비었거나 형식이 틀렸으면 null. */
  manualSupplyAmount: string | null;
  items: readonly unknown[];
  workScopeLines: readonly unknown[];
  repairTasks: readonly unknown[];
}): Record<string, string> {
  const errors: Record<string, string> = {};
  if (fields.isExcelOnly) {
    if (fields.items.length > 0) {
      errors.items = "엑셀 전용 견적서에는 부품 줄을 넣을 수 없습니다. 부품 줄을 모두 지운 뒤 저장해 주세요.";
    }
    if (fields.workScopeLines.length > 0) {
      errors.workScopeLines =
        "엑셀 전용 견적서에는 작업 내역을 적을 수 없습니다. 작업 내역을 모두 지운 뒤 저장해 주세요.";
    }
    if (fields.repairTasks.length > 0) {
      errors.repairTasks =
        "엑셀 전용 견적서에는 수리 작업을 고를 수 없습니다. 고른 수리 작업을 모두 뺀 뒤 저장해 주세요.";
    }
    if (fields.manualSupplyAmount === null) {
      errors.manualSupplyAmount = "엑셀 전용 견적서는 공급가액(부가세 별도)을 입력해 주세요.";
    }
  } else if (fields.manualSupplyAmount !== null) {
    errors.manualSupplyAmount =
      "공급가액은 엑셀 전용 견적서에만 손으로 적습니다. 엑셀 전용을 켜거나 공급가액을 비워 주세요.";
  }
  return errors;
}

/**
 * 작업 내역 줄들.
 *
 * **빈 줄은 조용히 버린다** — 부품 줄과 같은 판단이다(사람이 `+ 줄 추가`를
 * 눌러 두고 안 채운 자리가 저장을 막으면, 어디가 문제인지 찾느라 폼을 다시
 * 훑게 된다). 부품 줄과 다른 점은 **버려도 잃는 것이 없다**는 것이다: 빈
 * 문장은 문서에 적힐 것이 아무것도 없다.
 */
function normalizeWorkScopeLines(
  raw: unknown,
  fieldErrors: Record<string, string>
): QuoteWorkScopeLineInput[] {
  if (raw === null || raw === undefined) return [];
  if (!Array.isArray(raw)) {
    fieldErrors.workScopeLines = "작업 내역을 확인할 수 없습니다.";
    return [];
  }

  const lines: QuoteWorkScopeLineInput[] = [];
  raw.forEach((entry, index) => {
    if (typeof entry !== "object" || entry === null) {
      fieldErrors[`workScopeLines.${index}`] = `${index + 1}번째 작업 내역을 확인할 수 없습니다.`;
      return;
    }
    const row = entry as Record<string, unknown>;

    const section = row.section;
    if (
      typeof section !== "string" ||
      !(QUOTE_WORK_SCOPE_SECTIONS as readonly string[]).includes(section)
    ) {
      // 어느 묶음인지 모르면 문서의 어디에 적을지 알 수 없다. 조용히 버리면
      // 사람은 그 줄까지 적힌 줄 안다.
      fieldErrors[`workScopeLines.${index}`] = `${index + 1}번째 작업 내역의 구분을 확인할 수 없습니다.`;
      return;
    }

    const text = typeof row.text === "string" ? row.text.trim() : "";
    if (text === "") return;
    if (text.length > MAX_SHORT_TEXT) {
      fieldErrors[`workScopeLines.${index}`] =
        `${index + 1}번째 작업 내역은 ${MAX_SHORT_TEXT}자를 넘을 수 없습니다.`;
      return;
    }

    lines.push({ section: section as QuoteWorkScopeSection, text });
  });

  return lines;
}

/**
 * 고른 수리 작업 줄들. 화면이 카탈로그에서 골라 보내지만, 화면을 거치지 않고
 * 부를 수 있으므로 여기서 한 번 더 형식을 본다.
 *
 * 잘못된 줄은 **조용히 버리지 않고 오류로 세운다** — 버리면 사람은 그 작업까지
 * 청구된 줄 알고, 견적서에는 빠진 채로 나간다.
 */
function normalizeRepairTasks(
  raw: unknown,
  fieldErrors: Record<string, string>
): QuoteRepairTaskInput[] {
  if (raw === null || raw === undefined) return [];
  if (!Array.isArray(raw)) {
    fieldErrors.repairTasks = "고른 수리 작업을 확인할 수 없습니다.";
    return [];
  }

  const tasks: QuoteRepairTaskInput[] = [];
  raw.forEach((entry, index) => {
    const line = index + 1;
    if (typeof entry !== "object" || entry === null) {
      fieldErrors[`repairTasks.${index}`] = `${line}번째 작업을 확인할 수 없습니다.`;
      return;
    }
    const row = entry as Record<string, unknown>;

    const taskName = typeof row.taskName === "string" ? row.taskName.trim() : "";
    if (taskName === "") {
      fieldErrors[`repairTasks.${index}.taskName`] = `${line}번째 작업의 건명이 비어 있습니다.`;
      return;
    }

    const hours = typeof row.hours === "number" ? row.hours : Number(row.hours);
    if (!Number.isInteger(hours) || hours <= 0) {
      fieldErrors[`repairTasks.${index}.hours`] = `${line}번째 작업의 공수시간을 확인할 수 없습니다.`;
      return;
    }

    const hourlyRate = normalizeAmount(
      `repairTasks.${index}.hourlyRate`,
      `${line}번째 작업의 시간당 작업비`,
      row.hourlyRate,
      fieldErrors
    );
    if (hourlyRate === null) {
      fieldErrors[`repairTasks.${index}.hourlyRate`] =
        `${line}번째 작업의 시간당 작업비가 비어 있습니다.`;
      return;
    }

    const taskId = typeof row.taskId === "string" && row.taskId !== "" ? row.taskId : null;
    tasks.push({ taskId, taskName, hours, hourlyRate });
  });

  return tasks;
}

/**
 * 금액 문자열. **숫자로 바꾸지 않고 문자열 그대로 둔다** — Number 를 거치면
 * 0.1 을 더하는 것만으로도 오차가 쌓이고, 그 오차가 견적서 합계와 세금계산서
 * 사이의 1원 차이가 된다(schema/quotes.ts 의 '금액은 numeric 이다').
 */
function normalizeAmount(
  key: string,
  label: string,
  value: unknown,
  fieldErrors: Record<string, string>
): string | null {
  if (value === null || value === undefined || value === "") return null;
  const text = typeof value === "number" ? String(value) : value;
  if (typeof text !== "string") {
    fieldErrors[key] = `${label} 값을 확인할 수 없습니다.`;
    return null;
  }
  const trimmed = text.trim().replace(/,/g, "");
  if (trimmed === "") return null;
  if (!AMOUNT_PATTERN.test(trimmed)) {
    fieldErrors[key] = `${label}은(는) 0 이상의 금액(소수점 두 자리까지)이어야 합니다.`;
    return null;
  }
  return trimmed;
}

/**
 * 부품 줄들. 차례(line_no)는 여기서 받지 않는다 — **폼에 늘어놓은 순서가 곧
 * 차례**라서 저장하는 쪽이 배열 index 로 1부터 매긴다(mutations/quotes.ts).
 * 따로 받으면 화면의 차례와 저장된 차례가 어긋날 수 있고, 그때 어느 쪽이
 * 맞는지 답할 방법이 없다.
 *
 * 빈 배열이 정상이다 — 작업비만 있는 견적(부품 교체 없이 조정만 한 경우)이 있다.
 */
function normalizeItems(
  value: unknown,
  fieldErrors: Record<string, string>
): QuoteItemInput[] {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) {
    fieldErrors.items = "부품 목록을 확인할 수 없습니다.";
    return [];
  }
  if (value.length > MAX_QUOTE_ITEMS) {
    fieldErrors.items = `부품은 ${MAX_QUOTE_ITEMS}줄까지 넣을 수 있습니다.`;
    return [];
  }

  const items: QuoteItemInput[] = [];
  value.forEach((entry, index) => {
    const at = (field: string) => `items.${index}.${field}`;
    const line = index + 1;
    if (typeof entry !== "object" || entry === null) {
      fieldErrors[`items.${index}`] = `${line}번째 부품 줄을 확인할 수 없습니다.`;
      return;
    }
    const row = entry as Record<string, unknown>;

    const name = typeof row.partNameText === "string" ? row.partNameText.trim() : "";
    if (name === "") {
      fieldErrors[at("partNameText")] = `${line}번째 부품의 품명을 입력해 주세요.`;
    } else if (name.length > MAX_SHORT_TEXT) {
      fieldErrors[at("partNameText")] = `${line}번째 부품의 품명은 ${MAX_SHORT_TEXT}자를 넘을 수 없습니다.`;
    }

    // CHECK 제약이 quantity > 0 이다. 여기서 걸러야 사용자가 이유를 안다.
    const quantity = typeof row.quantity === "number" ? row.quantity : Number(row.quantity);
    if (!Number.isInteger(quantity) || quantity <= 0 || quantity > MAX_QUANTITY) {
      fieldErrors[at("quantity")] = `${line}번째 부품의 수량은 1 이상의 정수여야 합니다.`;
    }

    const unitPrice = normalizeAmount(at("unitPrice"), `${line}번째 부품의 단가`, row.unitPrice, fieldErrors);

    let partId: string | null = null;
    if (row.partId !== null && row.partId !== undefined && row.partId !== "") {
      if (!isValidQuoteId(row.partId)) {
        fieldErrors[at("partId")] = `${line}번째 부품의 재고 연결을 확인할 수 없습니다.`;
      } else {
        partId = row.partId as string;
      }
    }

    items.push({
      partId,
      isOverhaulPart: row.isOverhaulPart === true,
      partNameText: name,
      quantity,
      unitPrice: unitPrice ?? "0",
    });
  });

  return items;
}
