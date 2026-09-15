import { isValidDateString } from "@/lib/domain/local/validation";
import type { HandwrittenQuoteFields } from "@/lib/xlsx/handwritten-quote-reader";

/**
 * ============================================================================
 * 수기 견적서 엑셀 읽기 — 읽기 통로(POST /api/quotes/parse-excel)를 부르는 곳 하나 (견적서 ①b)
 * ============================================================================
 * 엑셀 전용 견적서의 「수기 견적서 엑셀」 칸에 파일을 고르면 편집 폼(QuoteEditForm)이 이 파일을
 * 불러 그 엑셀에서 견적서 칸의 값을 받는다. 받은 값을 폼에 채우는 규칙은 quote-excel-autofill.ts
 * 에 있다. 통로의 요청 · 응답 모양은 api/quotes/parse-excel/route.ts 머리말 그대로다(본문 = 파일
 * 바이트, 성공 200 `{ sheet, fields, warnings }`, 실패 `{ error, code }`).
 *
 * ── 🔴 올리기와 따로 간다 ────────────────────────────────────────────────
 * 읽기 통로는 파일을 어디에도 두지 않는다(메모리에서 읽고 버린다). 파일을 칸에 붙이는 일은
 * 여전히 올리기(quote-attachment-upload.ts)가 한다 — 읽기가 실패해도 붙이기는 그대로다.
 *
 * ── 던지지 않는다 ────────────────────────────────────────────────────────
 * 네트워크가 끊겨도, JSON 이 아닌 응답이 와도, 칸 모양이 이상해도 까닭을 돌려준다. fetch 는
 * 부르는 쪽이 바꿔 끼울 수 있다(quote-excel-parse.test.ts) — 올리기 클라이언트와 같은 모양이다.
 *
 * ── 응답을 믿지 않는다 ────────────────────────────────────────────────────
 * 칸마다 모양을 다시 본다 — 글자가 아니면 null, 종류는 DOMESTIC · OVERHAUL 만, 발행일자는 달력에
 * 있는 `YYYY-MM-DD` 만, 공급가액은 콤마 없는 0 이상 · 소수 둘째 자리까지의 숫자 글자만(읽개가
 * 돌려주는 모양 · 저장 검증의 금액 모양). 모르는 모양은 **그 칸만** 버린다 — 폼에 이상한 값이
 * 들어가는 것보다 비어 있는 편이 낫다. `fields` 가 통째로 객체가 아니면 읽지 못한 것으로 본다.
 *
 * ── 옛 .xls ──────────────────────────────────────────────────────────────
 * 읽을 수 있는 것은 .xlsx 뿐이다(2026-09-16 사용자 결정). 이름이 .xls 면 **보내지 않는다**(20MB 를
 * 올려 놓고 거절당할 까닭이 없다). 이름은 .xlsx 인데 속이 옛 형식이면 통로가 415 XLS_LEGACY 로
 * 돌려준다 — 둘 다 같은 문장(QUOTE_EXCEL_LEGACY_XLS_TEXT)이다.
 *
 * ── 마지막에 고른 파일만 ───────────────────────────────────────────────────
 * 두 번 고르면 앞 요청의 늦은 응답이 뒤를 덮으면 안 된다. createLatestQuoteExcelReader 가 차례를
 * 세고, 새로 읽기 시작했거나 멈춘(cancel) 뒤에 온 결과는 null 로 돌려준다 — 부르는 쪽은 버린다.
 *
 * 🔴 파일의 값을 console 에 싣지 않는다 — 고객 정보다.
 * ============================================================================
 */

type ParseResponse = { ok: boolean; status: number; json(): Promise<unknown> };

/** 부르는 쪽이 바꿔 끼울 수 있는 fetch — 쓰는 것만 적었다. 기본은 브라우저의 fetch. */
export type QuoteExcelParseFetch = (url: string, init: { method: "POST"; body: Blob }) => Promise<ParseResponse>;

const browserFetch: QuoteExcelParseFetch = (url, init) => fetch(url, init);

export const QUOTE_EXCEL_PARSE_URL = "/api/quotes/parse-excel";

/** 읽은 값 — 이름 · 모양은 읽개(xlsx/handwritten-quote-reader.ts)의 것 그대로다. 모두 null 일 수 있다. */
export type QuoteExcelReadFields = HandwrittenQuoteFields;

export type QuoteExcelParseResult =
  | { ok: true; fields: QuoteExcelReadFields; warnings: string[] }
  | { ok: false; reason: string; status: number | null; code: string | null };

/** 옛 .xls 를 골랐을 때 — 파일은 그대로 붙고, 칸만 채우지 못했다(2026-09-16 사용자 결정 문장). */
export const QUOTE_EXCEL_LEGACY_XLS_TEXT =
  "옛 엑셀 형식이라 칸을 채우지 못했습니다 — 엑셀에서 xlsx 로 다시 저장해 올리면 채워집니다";

export const QUOTE_EXCEL_LEGACY_XLS_CODE = "XLS_LEGACY";

const NETWORK_FAILED_REASON = "서버에 닿지 못했습니다(네트워크 상태를 확인해 주세요)";
const UNREADABLE_RESPONSE_REASON = "서버의 응답을 알아보지 못했습니다";

function rejectedReason(status: number): string {
  return `서버가 요청을 처리하지 못했습니다(HTTP ${status})`;
}

/** 공급가액 — 콤마 없는 0 이상, 정수부 13자리 · 소수 둘째 자리까지(validation/quote-input.ts 의 금액 모양). */
const AMOUNT_PATTERN = /^\d{1,13}(?:\.\d{1,2})?$/;

const TEXT_FIELDS = [
  "quoteNumber",
  "customerNameText",
  "subject",
  "modelNameText",
  "lotNumberText",
  "serialNumberText",
  "validity",
  "delivery",
  "payment",
] as const satisfies readonly (keyof QuoteExcelReadFields)[];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 이름이 옛 .xls 인가(대소문자 무관). */
export function isLegacyXlsFileName(name: string): boolean {
  return /\.xls$/i.test(name.trim());
}

/** 글자면 앞뒤 공백을 걷은 값, 비었거나 글자가 아니면 null. */
function textOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * 응답의 `fields` → 읽은 값. 객체가 아니면 null(읽지 못했다). 칸마다 모양이 틀리면 그 칸만 null.
 */
export function parseQuoteExcelFields(value: unknown): QuoteExcelReadFields | null {
  if (!isRecord(value)) return null;
  const quoteDate = textOrNull(value.quoteDate);
  const amount = textOrNull(value.manualSupplyAmount);
  const fields: QuoteExcelReadFields = {
    kind: value.kind === "DOMESTIC" || value.kind === "OVERHAUL" ? value.kind : null,
    quoteNumber: null,
    quoteDate: quoteDate !== null && isValidDateString(quoteDate) ? quoteDate : null,
    customerNameText: null,
    subject: null,
    modelNameText: null,
    lotNumberText: null,
    serialNumberText: null,
    validity: null,
    delivery: null,
    payment: null,
    manualSupplyAmount: amount !== null && AMOUNT_PATTERN.test(amount) ? amount : null,
  };
  for (const field of TEXT_FIELDS) fields[field] = textOrNull(value[field]);
  return fields;
}

/** 응답의 `warnings` → 사람이 읽는 문장들. 배열이 아니면 빈 배열, 글자가 아닌 것은 버린다. */
function parseWarnings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((warning): warning is string => typeof warning === "string" && warning.trim() !== "");
}

/**
 * 수기 견적서 엑셀 하나를 읽기 통로로 보내 칸의 값을 받는다. 던지지 않는다.
 * 옛 .xls(이름)는 보내지 않고 곧바로 XLS_LEGACY 를 돌려준다.
 */
export async function readHandwrittenQuoteExcel(
  file: File,
  fetchImpl: QuoteExcelParseFetch = browserFetch
): Promise<QuoteExcelParseResult> {
  if (isLegacyXlsFileName(file.name)) {
    return { ok: false, reason: QUOTE_EXCEL_LEGACY_XLS_TEXT, status: null, code: QUOTE_EXCEL_LEGACY_XLS_CODE };
  }

  let response: ParseResponse;
  try {
    response = await fetchImpl(QUOTE_EXCEL_PARSE_URL, { method: "POST", body: file });
  } catch {
    return { ok: false, reason: NETWORK_FAILED_REASON, status: null, code: null };
  }

  // JSON 이 아닌 응답(프록시 · 게이트웨이의 HTML)도 있다 — 던지지 않고 null 로 읽는다.
  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  const record = isRecord(payload) ? payload : null;

  if (!response.ok) {
    const code = typeof record?.code === "string" ? record.code : null;
    if (code === QUOTE_EXCEL_LEGACY_XLS_CODE) {
      return { ok: false, reason: QUOTE_EXCEL_LEGACY_XLS_TEXT, status: response.status, code };
    }
    const error = typeof record?.error === "string" && record.error.trim() !== "" ? record.error.trim() : null;
    return { ok: false, reason: error ?? rejectedReason(response.status), status: response.status, code };
  }

  const fields = parseQuoteExcelFields(record?.fields);
  if (fields === null) {
    return { ok: false, reason: UNREADABLE_RESPONSE_REASON, status: response.status, code: null };
  }
  return { ok: true, fields, warnings: parseWarnings(record?.warnings) };
}

export type LatestQuoteExcelReader = {
  /**
   * 읽는다. 기다리는 사이 다른 파일을 읽기 시작했거나 cancel 됐으면 **null** — 늦게 온 옛 결과다,
   * 부르는 쪽은 버린다.
   */
  read(file: File): Promise<QuoteExcelParseResult | null>;
  /** 읽고 있는 것의 결과를 버린다(엑셀 전용을 껐다). */
  cancel(): void;
};

/**
 * 마지막에 고른 파일의 결과만 돌려주는 읽개. 폼이 하나를 들고 있는다(useState 로 한 번 만든다).
 * `readImpl` 은 시험이 바꿔 끼운다 — 기본은 브라우저 fetch 로 읽기 통로를 부르는 것.
 */
export function createLatestQuoteExcelReader(
  readImpl: (file: File) => Promise<QuoteExcelParseResult> = (file) => readHandwrittenQuoteExcel(file)
): LatestQuoteExcelReader {
  let latest = 0;
  return {
    async read(file) {
      latest += 1;
      const ticket = latest;
      const result = await readImpl(file);
      return ticket === latest ? result : null;
    },
    cancel() {
      latest += 1;
    },
  };
}
