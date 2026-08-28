import { isValidDateString } from "@/lib/domain/local/validation";

/**
 * ============================================================================
 * 내자 정리 입력 검증 — 형식만 본다
 * ============================================================================
 * customer-update-input.ts 와 같은 자리에 있는 파일이다. **DB도 세션도 여기서
 * 만지지 않는다** — 순수 함수만 두어야 단위 테스트가 붙고, 그래야 "어떤 값을
 * 받아들이는가"라는 규칙이 실제로 검증된다. 존재 여부(그 수리 건이 있는가)와
 * 동시 수정(version)은 자료의 문제라 mutation 이, 누가 고칠 수 있는가는 정책이라
 * 서버 액션이 맡는다.
 *
 * ── 한 행을 통째로 받는다 ───────────────────────────────────────────────
 * 접수 건 구간 편집(repair-case-update-input.ts)은 부분 제출이다 — 역할마다
 * 고칠 수 있는 칸이 달라서 보내온 키만 본다. 내자 정리는 그렇지 않다.
 * canEditDomesticOrders 가 폼 전체를 한 번에 열고 닫으므로, 칸마다 "이번에
 * 보냈는가"를 따질 이유가 없다. customer-update-input.ts 와 같은 이유로 전체
 * 제출이고, 빠진 키는 "비웠다"로 읽는다.
 *
 * ── 고객사·형식·L/N·S/N·고장내역도 여기서 받는다 ────────────────────────
 * 그 다섯은 원래 이 검증에 없었다 — 수리 건에서 조인해 따라오는 값이라 저장할
 * 자리가 없었기 때문이다. 지금은 domestic_orders 에 자기 칸이 있고
 * (schema/domestic-orders.ts 의 '여기에도 있다'), **수리 건 연결이 없는 줄에는
 * 그 칸이 유일한 자리**다.
 *
 * 비워 두는 것이 기본이다. 빈 값은 여기서 null 로 접히고, 그러면 조회가 연결된
 * 수리 건의 값을 대신 쓴다. 그래서 이 검증은 "적지 않았다"와 "일부러 지웠다"를
 * 구분하지 않는다 — 둘 다 "수리 건 쪽을 따른다"는 같은 뜻이다.
 *
 * ── 오류는 칸 단위 한국어다 ─────────────────────────────────────────────
 * fieldErrors 의 키는 필드명 그대로이고, 화면은 그 키로 입력칸 밑에 문장을
 * 붙인다. "입력값을 확인해 주세요" 한 줄만 돌려주면 사용자는 스무 칸 남짓 중 어디가
 * 틀렸는지 찾지 못한다.
 * ============================================================================
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidDomesticOrderId(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

/**
 * 낙관적 잠금 토큰. repair-case-update-input.ts 의 isValidExpectedVersion 과
 * 같은 규칙이다 — version 은 1부터 시작하는 정수라서 0 이하는 애초에 존재할 수
 * 없는 값이다.
 */
export function isValidExpectedVersion(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

/** 발주서번호·PJT·견적서번호·납품자처럼 한 줄로 적는 칸. */
const MAX_SHORT_TEXT = 200;
/** 현황·이력·기타처럼 사람이 길게 적는 칸. */
const MAX_LONG_TEXT = 4000;

/**
 * display_order 는 integer 컬럼이다. 자바스크립트에서 통과시켜 놓고 DB 에서
 * 터지면 사용자에게는 "저장할 수 없습니다"만 보이므로 여기서 잘라 준다.
 */
const MAX_DISPLAY_ORDER = 2_147_483_647;

/**
 * numeric(15,2) — 정수부 13자리 + 소수부 2자리. 이 폭을 넘는 값을 그대로
 * 넘기면 Postgres 가 22003(numeric field overflow)으로 거절하고, 그 오류는
 * 사용자에게 아무것도 설명하지 못한다.
 */
const AMOUNT_PATTERN = /^\d{1,13}(?:\.\d{1,2})?$/;

/**
 * 한 줄에 담을 수 있는 납기 요청일의 개수 상한.
 *
 * 분할 납품이라도 스무 번을 넘게 나눠 보내는 발주는 없다. 상한이 없으면 잘못
 * 만들어진 요청 하나가 한 줄에 수천 행을 밀어 넣을 수 있고, 그때 목록 조회는
 * 그 줄 하나 때문에 느려진다 — 이 칸에는 상한이 곧 안전장치다.
 */
const MAX_DUE_DATES = 20;

/** 납기일 메모("1차분")는 사람이 문장을 적는 칸이 아니라 짧은 한 줄이다. */
const MAX_DUE_DATE_NOTE = MAX_SHORT_TEXT;

/**
 * 납기 요청일 한 개. 차례(display_order)는 여기 없다 — **폼에 늘어놓은 순서가
 * 곧 차례**라서, 저장하는 쪽이 배열 index 로 1부터 매긴다
 * (mutations/domestic-orders.ts). 따로 받으면 화면의 차례와 저장된 차례가
 * 어긋날 수 있고, 그때 어느 쪽이 맞는지 답할 방법이 없다.
 */
export type DomesticOrderDueDateInput = {
  /** "YYYY-MM-DD". 실제 달력에 있는 날이어야 한다. */
  dueDate: string;
  note: string | null;
};

export type DomesticOrderFields = {
  /** 연결된 수리 건. 없는 줄이 정상이다(schema 헤더의 '비어 있어도 된다'). */
  repairCaseId: string | null;
  intakeNumberText: string | null;
  /**
   * 청구 상대. null 은 "정하지 않았다"이지 오류가 아니다 — 연결된 수리 건이
   * 있으면 그쪽 고객사를 따르고, 없으면 목록에서 '(고객사 미지정)' 묶음에
   * 들어간다.
   */
  customerId: string | null;
  /** 형식 · L/N · S/N · 고장내역. 비어 있으면 수리 건의 값을 따른다(파일 헤더). */
  modelNameText: string | null;
  lotNumberText: string | null;
  serialNumberText: string | null;
  faultDescriptionText: string | null;
  displayOrder: number | null;
  purchaseOrderNumber: string | null;
  projectName: string | null;
  orderIssuedDate: string | null;
  /**
   * 납기 요청일 **목록**. 빈 배열이 정상이다(납기일이 아직 없는 줄).
   *
   * 예전에는 `requestedDueDate` 칸 하나였다. 분할 납품이면 한 건에 날짜가
   * 여럿이라 칸 하나로는 담을 수 없어서 딸린 표로 옮겼다
   * (schema/domestic-order-due-dates.ts). **그래서 이 검증은 더 이상
   * requestedDueDate 를 받지 않는다** — 받아 두면 새 폼이 보내지 않는 그 칸이
   * 저장할 때마다 NULL 로 덮여, 아직 남겨 둔 원본이 지워진다.
   */
  dueDates: DomesticOrderDueDateInput[];
  quoteIssuedDate: string | null;
  quoteNumber: string | null;
  /**
   * 연결된 견적서. null 이 정상이다 — 견적서 없이 발주만 들어온 줄이 있다.
   * 연결하면 견적서번호·견적발행일·금액이 견적서를 따른다
   * (schema/domestic-orders.ts 의 quote_id 주석). 손으로 적은 값은 지우지
   * 않으므로, 연결을 풀면 그 값이 다시 보인다.
   */
  quoteId: string | null;
  progressNote: string | null;
  deliveredDate: string | null;
  deliveredBy: string | null;
  taxInvoiceDate: string | null;
  /** numeric 컬럼이라 문자열로 오간다(schema 의 '금액은 numeric 이다'). */
  amountExcludingVat: string | null;
  paymentCompleted: boolean;
  japanRemittanceNote: string | null;
  historyNote: string | null;
  etcNote: string | null;
};

export type ValidateDomesticOrderResult =
  | { ok: true; data: DomesticOrderFields }
  | { ok: false; fieldErrors: Record<string, string> };

/** 화면에 붙는 이름표. 오류 문장이 칸 이름을 그대로 부르게 하기 위한 표다. */
const SHORT_TEXT_FIELDS = {
  intakeNumberText: "인수번호",
  purchaseOrderNumber: "발주서번호",
  projectName: "PJT",
  quoteNumber: "견적서번호",
  deliveredBy: "납품자",
  japanRemittanceNote: "일본 송금",
  // 형식·L/N·S/N 은 제품에 찍혀 있는 짧은 식별자다. 사람이 문장을 적는 칸이
  // 아니라 다른 한 줄짜리 칸들과 같은 상한을 쓴다.
  modelNameText: "형식",
  lotNumberText: "L/N",
  serialNumberText: "S/N",
} as const;

const LONG_TEXT_FIELDS = {
  progressNote: "현황",
  historyNote: "이력",
  etcNote: "기타",
  // 고장내역은 "전원 안 들어옴" 한 줄일 때도 있지만 증상을 길게 적는 칸이다 —
  // 접수 건의 reported_symptom 을 마주 보는 값이라 긴 쪽으로 둔다.
  faultDescriptionText: "고장내역",
} as const;

/**
 * 칸 하나로 오는 날짜들. **납기요청일은 여기 없다** — 목록이라 아래
 * normalizeDueDates 가 따로 본다(위 dueDates 주석).
 */
const DATE_FIELDS = {
  orderIssuedDate: "발주발행일",
  quoteIssuedDate: "견적발행일",
  deliveredDate: "납품일",
  taxInvoiceDate: "세금계산서발행일",
} as const;

export function validateDomesticOrderFields(
  raw: Record<string, unknown>
): ValidateDomesticOrderResult {
  const fieldErrors: Record<string, string> = {};

  /**
   * 비어 있음의 표준형은 null 하나다. undefined(키 없음), 빈 문자열, 공백만
   * 적힌 값은 전부 같은 뜻이고, 셋을 구분해 저장하면 목록에서 "-"로 보이는
   * 값이 세 종류가 된다.
   */
  function normalizeText(key: string, label: string, maxLength: number): string | null {
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

  function normalizeDate(key: string, label: string): string | null {
    const value = raw[key];
    if (value === null || value === undefined) return null;
    if (typeof value !== "string") {
      fieldErrors[key] = `${label} 값을 확인할 수 없습니다.`;
      return null;
    }
    const trimmed = value.trim();
    if (trimmed === "") return null;
    // 형식만 보지 않고 **실제로 있는 날짜인지**까지 본다 — 2026-02-31 은
    // 형식은 맞지만 존재하지 않는 날이고, 그대로 넘기면 Postgres 가
    // 22008 로 거절해 사용자에게는 이유 없는 실패만 남는다.
    if (!isValidDateString(trimmed)) {
      fieldErrors[key] = `${label}은(는) YYYY-MM-DD 형식의 실제 날짜여야 합니다.`;
      return null;
    }
    return trimmed;
  }

  /**
   * 납기 요청일 목록.
   *
   * ── 빈 목록은 정상이다 ────────────────────────────────────────────────
   * 납기일이 아직 없는 줄이 실제로 있다(발주는 받았는데 일정이 안 잡힌 줄).
   * 키가 아예 없어도 같은 뜻이라 빈 배열로 접는다.
   *
   * ── 완전히 빈 줄은 거절하지 않고 뺀다 ─────────────────────────────────
   * 폼의 '추가' 버튼은 빈 줄을 하나 만든다. 사람이 그 줄을 채우지 않고
   * 저장했다면 뜻은 "안 쓰겠다"이지 "틀렸다"가 아니다. 날짜도 메모도 없는 줄만
   * 조용히 뺀다 — 메모만 적힌 줄은 뺄 수 없다(날짜 없는 납기일은 저장할 자리
   * 자체가 없고, 조용히 버리면 적은 글이 말없이 사라진다).
   *
   * ── 오류는 줄 번호까지 말한다 ─────────────────────────────────────────
   * 키가 `dueDates.0` 처럼 index 를 달고 나가서, 폼이 **그 줄 밑에** 문장을
   * 붙일 수 있다. 목록 전체가 잘못된 경우(배열이 아니다 · 개수 상한 초과)만
   * `dueDates` 키를 쓴다.
   */
  function normalizeDueDates(): DomesticOrderDueDateInput[] {
    const value = raw.dueDates;
    if (value === null || value === undefined) return [];
    if (!Array.isArray(value)) {
      fieldErrors.dueDates = "납기요청일 목록을 확인할 수 없습니다.";
      return [];
    }
    if (value.length > MAX_DUE_DATES) {
      fieldErrors.dueDates = `납기요청일은 ${MAX_DUE_DATES}개까지 넣을 수 있습니다.`;
      return [];
    }

    const parsed: DomesticOrderDueDateInput[] = [];
    value.forEach((entry, index) => {
      const key = `dueDates.${index}`;
      if (entry === null || entry === undefined) return;
      if (typeof entry !== "object" || Array.isArray(entry)) {
        fieldErrors[key] = "납기요청일 값을 확인할 수 없습니다.";
        return;
      }
      const record = entry as Record<string, unknown>;

      let dueDate = "";
      if (typeof record.dueDate === "string") {
        dueDate = record.dueDate.trim();
      } else if (record.dueDate !== null && record.dueDate !== undefined) {
        fieldErrors[key] = "납기요청일 값을 확인할 수 없습니다.";
        return;
      }

      let note: string | null = null;
      if (typeof record.note === "string") {
        const trimmed = record.note.trim();
        note = trimmed === "" ? null : trimmed;
      } else if (record.note !== null && record.note !== undefined) {
        fieldErrors[key] = "납기요청일 메모 값을 확인할 수 없습니다.";
        return;
      }

      // 아무것도 안 적은 줄 — 위 '완전히 빈 줄은 거절하지 않고 뺀다'.
      if (dueDate === "" && note === null) return;

      if (dueDate === "") {
        fieldErrors[key] = "납기요청일을 입력하거나 그 줄을 지워 주세요.";
        return;
      }
      if (!isValidDateString(dueDate)) {
        fieldErrors[key] = "납기요청일은 YYYY-MM-DD 형식의 실제 날짜여야 합니다.";
        return;
      }
      if (note !== null && note.length > MAX_DUE_DATE_NOTE) {
        fieldErrors[key] = `납기요청일 메모는 ${MAX_DUE_DATE_NOTE}자를 넘을 수 없습니다.`;
        return;
      }

      parsed.push({ dueDate, note });
    });
    return parsed;
  }

  const text: Record<string, string | null> = {};
  for (const [key, label] of Object.entries(SHORT_TEXT_FIELDS)) {
    text[key] = normalizeText(key, label, MAX_SHORT_TEXT);
  }
  for (const [key, label] of Object.entries(LONG_TEXT_FIELDS)) {
    text[key] = normalizeText(key, label, MAX_LONG_TEXT);
  }

  const dates: Record<string, string | null> = {};
  for (const [key, label] of Object.entries(DATE_FIELDS)) {
    dates[key] = normalizeDate(key, label);
  }

  const dueDates = normalizeDueDates();

  // ── 수리 건 연결 ─────────────────────────────────────────────────────
  // 화면에서 고르는 값이라 사람이 손으로 치지 않는다. 그래도 UUID 인지 보는
  // 이유는 이 함수가 서버 액션의 유일한 형식 관문이기 때문이다 — 실제로 그
  // 건이 있는지는 mutation 이 확인한다.
  let repairCaseId: string | null = null;
  const repairCaseIdRaw = raw.repairCaseId;
  if (repairCaseIdRaw === null || repairCaseIdRaw === undefined || repairCaseIdRaw === "") {
    repairCaseId = null;
  } else if (!isValidDomesticOrderId(repairCaseIdRaw)) {
    fieldErrors.repairCaseId = "수리 건을 확인할 수 없습니다.";
  } else {
    repairCaseId = repairCaseIdRaw;
  }

  // ── 견적서 연결 ──────────────────────────────────────────────────────
  // 수리 건 연결과 같은 모양이다. 그 견적서가 실제로 있는지는 mutation 이 본다.
  let quoteId: string | null = null;
  const quoteIdRaw = raw.quoteId;
  if (quoteIdRaw === null || quoteIdRaw === undefined || quoteIdRaw === "") {
    quoteId = null;
  } else if (!isValidDomesticOrderId(quoteIdRaw)) {
    fieldErrors.quoteId = "견적서를 확인할 수 없습니다.";
  } else {
    quoteId = quoteIdRaw;
  }

  // ── 고객사 ───────────────────────────────────────────────────────────
  // 수리 건 연결과 같은 모양이다 — 드롭다운에서 고르는 UUID 이고, 비워 두는
  // 것("연결 없음")이 정상이다. 그 고객사가 실제로 있는지는 mutation 이 본다.
  let customerId: string | null = null;
  const customerIdRaw = raw.customerId;
  if (customerIdRaw === null || customerIdRaw === undefined || customerIdRaw === "") {
    customerId = null;
  } else if (!isValidDomesticOrderId(customerIdRaw)) {
    fieldErrors.customerId = "고객사를 확인할 수 없습니다.";
  } else {
    customerId = customerIdRaw;
  }

  // ── 순번 ─────────────────────────────────────────────────────────────
  // 사람이 시트에 적던 표시 순서다. 문자열로 오는 것은 <input> 에서 온
  // 값이기 때문이고, 숫자로 오는 것은 이미 파싱된 값이 다시 들어오는 경우다.
  let displayOrder: number | null = null;
  const displayOrderRaw = raw.displayOrder;
  if (displayOrderRaw === null || displayOrderRaw === undefined || displayOrderRaw === "") {
    displayOrder = null;
  } else {
    const parsed =
      typeof displayOrderRaw === "number"
        ? displayOrderRaw
        : typeof displayOrderRaw === "string" && /^\d+$/.test(displayOrderRaw.trim())
          ? Number(displayOrderRaw.trim())
          : Number.NaN;
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_DISPLAY_ORDER) {
      fieldErrors.displayOrder = "순번은 1 이상의 정수여야 합니다.";
    } else {
      displayOrder = parsed;
    }
  }

  // ── 금액(VAT별도) ────────────────────────────────────────────────────
  // 목록이 자릿수를 끊어 보여 주므로(1,234,567) 사용자가 그 모양 그대로 다시
  // 붙여 넣는 일이 실제로 생긴다. 쉼표는 표시용이라 여기서 걷어 낸다 —
  // 걷어 내지 않으면 화면에 보이던 값을 그대로 넣었는데 거절당한다.
  let amountExcludingVat: string | null = null;
  const amountRaw = raw.amountExcludingVat;
  if (amountRaw === null || amountRaw === undefined || amountRaw === "") {
    amountExcludingVat = null;
  } else if (typeof amountRaw !== "string" && typeof amountRaw !== "number") {
    fieldErrors.amountExcludingVat = "금액 값을 확인할 수 없습니다.";
  } else {
    const cleaned = String(amountRaw).trim().replace(/,/g, "");
    if (cleaned === "") {
      amountExcludingVat = null;
    } else if (cleaned.startsWith("-")) {
      // 음수를 막는 것은 규칙이자 안전장치다. 목록의 합계는 이 칸을 그대로
      // 더하므로, 음수가 한 줄 섞이면 합계가 세금계산서와 어긋난 채로
      // "맞는 것처럼" 보인다.
      fieldErrors.amountExcludingVat = "금액은 음수일 수 없습니다.";
    } else if (!AMOUNT_PATTERN.test(cleaned)) {
      fieldErrors.amountExcludingVat = "금액은 소수점 둘째 자리까지의 숫자여야 합니다.";
    } else {
      amountExcludingVat = cleaned;
    }
  }

  // ── 입금완료 여부 ────────────────────────────────────────────────────
  // 시트에서 비어 있는 칸은 "아직 안 들어왔다"는 뜻이다(schema 주석). 그래서
  // 값이 없으면 false 이고, NULL 이라는 세 번째 상태를 만들지 않는다.
  let paymentCompleted = false;
  const paymentRaw = raw.paymentCompleted;
  if (paymentRaw === null || paymentRaw === undefined) {
    paymentCompleted = false;
  } else if (typeof paymentRaw !== "boolean") {
    fieldErrors.paymentCompleted = "입금완료 여부 값을 확인할 수 없습니다.";
  } else {
    paymentCompleted = paymentRaw;
  }

  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };

  return {
    ok: true,
    data: {
      repairCaseId,
      quoteId,
      intakeNumberText: text.intakeNumberText,
      customerId,
      modelNameText: text.modelNameText,
      lotNumberText: text.lotNumberText,
      serialNumberText: text.serialNumberText,
      faultDescriptionText: text.faultDescriptionText,
      displayOrder,
      purchaseOrderNumber: text.purchaseOrderNumber,
      projectName: text.projectName,
      orderIssuedDate: dates.orderIssuedDate,
      dueDates,
      quoteIssuedDate: dates.quoteIssuedDate,
      quoteNumber: text.quoteNumber,
      progressNote: text.progressNote,
      deliveredDate: dates.deliveredDate,
      deliveredBy: text.deliveredBy,
      taxInvoiceDate: dates.taxInvoiceDate,
      amountExcludingVat,
      paymentCompleted,
      japanRemittanceNote: text.japanRemittanceNote,
      historyNote: text.historyNote,
      etcNote: text.etcNote,
    },
  };
}
