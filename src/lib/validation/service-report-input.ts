import {
  countServiceReportBodyRows,
  type ServiceReportBodyRowLayout,
} from "@/lib/domain/service-report-form";
import {
  SERVICE_REPORT_BODY_LABELS,
  SERVICE_REPORT_CAUSES,
  SERVICE_REPORT_CLOSING_GAP_ROWS,
  SERVICE_REPORT_CLOSING_TRAILING_ROWS,
  SERVICE_REPORT_MAX_BODY_ROWS,
  SERVICE_REPORT_SECTION_GAP_ROWS,
  type ServiceReportCause,
  type ServiceReportInput,
  type ServiceReportKind,
} from "@/lib/xlsx/service-report-template";

/**
 * ============================================================================
 * 검사·수리 보고서 입력 검증 — 화면이 보낸 JSON 을 채우개가 받는 모양으로
 * ============================================================================
 * `quote-input.ts` 와 같은 자리, 같은 규칙이다. **DB도 세션도 여기서 만지지
 * 않는다** — 순수 함수만 두어야 단위 테스트가 붙고, 그래야 "어떤 값을
 * 받아들이는가"가 실제로 검증된다. 접수 건이 있는지, 그 사람이 만들 수
 * 있는지는 라우트가 맡는다.
 *
 * ── 왜 채우개의 검사만으로는 모자라나 ───────────────────────────────────
 * 채우개(`xlsx/service-report-template.ts`)에도 `validateServiceReportInput` 이
 * 있고 그쪽이 마지막 방어선이다. 다만 그것은 **이미 타입이 맞는 값**을 받는
 * 자리라 `Date` 를 기대하고, JSON 으로 오는 `"2026-09-02"` 같은 글자는 모른다.
 * 여기가 그 사이를 잇는다: `unknown` 을 받아 좁혀 나가고, 어긋나면 화면이
 * 입력칸 밑에 붙일 수 있는 한국어 문장으로 돌려준다.
 *
 * ── 🔴 날짜는 로컬 Date 로 만든다 ───────────────────────────────────────
 * `new Date("2026-09-02")` 는 **UTC 자정**으로 읽힌다. 한국(UTC+9)에서는
 * 9월 2일 09시라 괜찮지만, 서버가 UTC 서쪽에 있으면 9월 1일로 밀린다. 글자를
 * 쪼개 로컬 Date 를 만들면 어느 시간대에서도 적은 그 날이 찍힌다
 * (견적서 라우트의 `parseDateOnly` 와 같은 처리).
 *
 * ── 🔴 「안 줌」과 「비움」은 다르다 ─────────────────────────────────────
 * 두 자리에서 이 구별이 문서를 바꾼다:
 *
 *   1. `body.findingsIntro` — 안 주면 정형 문구가 들어가고, `""` 를 주면
 *      아무것도 안 들어간다. 화면은 이 값을 미리 채운 칸으로 내놓고 사람이 그
 *      칸을 지울 수 있어야 한다. JSON 을 거치면서 `""` 가 `undefined` 로
 *      뭉개지면 **지운 문장이 되살아난다.**
 *   2. `disposition.goodsReceipt` · `disposition.completion` — **있기만 하면
 *      체크**다(채우개의 `goodsReceipt !== undefined`). 빈 객체 `{}` 를 보내는
 *      것은 "날짜는 모르지만 체크는 해 달라"는 뜻이라, 값이 비었다고 통째로
 *      버리면 체크가 사라진다.
 *
 * JSON 에는 `undefined` 가 없으므로 **키가 없는 것과 `null` 을 「안 줌」으로**
 * 본다. 화면이 `undefined` 를 담아 보내면 `JSON.stringify` 가 키를 지우거나
 * `null` 로 바꾸는데, 둘 다 같은 뜻이어야 한다.
 *
 * ── 앞 공백을 다듬지 않는 칸이 있다 ─────────────────────────────────────
 * 「상황」 두 칸(`H21`·`H23`)과 본문·비고 줄은 **다듬지 않는다.** 상황 목록의
 * 값은 `" ・ 수리의뢰"` 처럼 글머리표가 붙은 채고(양식의 드롭다운 원본이
 * 그렇다 — `xlsx/service-report-choices.ts`), 본문 줄의 들여쓰기는 사람이 뜻을
 * 담아 넣은 것이다. 채우개도 이 칸들만은 다듬지 않고 그대로 적는다.
 * ============================================================================
 */

export type ValidateServiceReportResult =
  | { ok: true; data: ServiceReportInput }
  | { ok: false; fieldErrors: Record<string, string> };

/** 발행번호 조각·고객사명·모델명처럼 한 줄로 적는 칸. */
const MAX_SHORT_TEXT = 200;
/** 「상황」 아랫칸처럼 사람이 여러 줄로 적는 칸. */
const MAX_LONG_TEXT = 4000;
/** 본문·비고 한 줄. 폭을 넘으면 채우개가 나누므로 줄 자체는 넉넉히 받는다. */
const MAX_BODY_LINE = 1000;

/**
 * 비고 줄 수의 상한.
 *
 * 🔴 **진짜 상한은 양식이 갖고 있다** — 「비　고」 라벨의 병합 칸(`C60:G63`)이
 * 4줄이고, 채우개가 그것을 읽어 다시 확인한다. 여기 4를 적어 두는 것은 화면이
 * 5줄째를 적는 순간 알려 주기 위해서지, 양식을 대신하려는 것이 아니다. 양식이
 * 늘어나면 채우개는 따라가고 이 값만 뒤처진다 — 그때는 이 값을 고친다.
 */
export const SERVICE_REPORT_MAX_REMARK_ROWS = 4;

/**
 * 본문 줄 수를 세는 데 드는 **문서 쪽 상수 한 벌.**
 *
 * 🔴 셈 자체는 `domain/service-report-form.ts` 의 `countServiceReportBodyRows`
 * 하나뿐이고(화면도 그것을 부른다), 그 함수는 **브라우저에서도 도는 파일**에
 * 살아서 채우개를 값으로 가져올 수 없다. 그래서 상수는 인자로 받는다 — 여기가
 * 그 인자를 만드는 유일한 자리다.
 *
 * 이 모듈은 서버 전용이라 채우개에서 **직접** 읽는다(위의
 * `SERVICE_REPORT_MAX_BODY_ROWS` 와 같은 길). 화면에는 서버 페이지가 이 값을
 * props 로 넘긴다(`ServiceReportFormLimits.bodyLayout`) — 숫자를 화면 코드에
 * 베끼면 양식이 바뀐 날 화면만 뒤처지고, 증상은 "왜 안 되는지 모르겠는 400"이다.
 *
 * ⚠️ 라벨 줄 수는 **세어서** 넣는다. 「확인내용」이 두 줄이라고 2를 적어 두면,
 * 양식의 라벨이 한 줄로 바뀐 날 이 값만 남는다.
 */
export const SERVICE_REPORT_BODY_ROW_LAYOUT: ServiceReportBodyRowLayout = {
  sectionGapRows: SERVICE_REPORT_SECTION_GAP_ROWS,
  closingGapRows: SERVICE_REPORT_CLOSING_GAP_ROWS,
  closingTrailingRows: SERVICE_REPORT_CLOSING_TRAILING_ROWS,
  labelRows: {
    findings: SERVICE_REPORT_BODY_LABELS.findings.length,
    actions: SERVICE_REPORT_BODY_LABELS.actions.length,
    summary: SERVICE_REPORT_BODY_LABELS.summary.length,
  },
};

const KIND_LABELS: Record<ServiceReportKind, string> = {
  INSPECTION: "검사 보고서",
  REPAIR: "수리 보고서",
};

function isServiceReportKind(value: unknown): value is ServiceReportKind {
  return value === "INSPECTION" || value === "REPAIR";
}

/** `"YYYY-MM-DD"` 인가 — 실제 달력에 있는 날까지 본다(2026-02-30 은 아니다). */
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function validateServiceReportFields(raw: unknown): ValidateServiceReportResult {
  const fieldErrors: Record<string, string> = {};
  const parsed = asRecord(raw);
  if (!parsed) {
    return { ok: false, fieldErrors: { _: "보고서 내용을 확인할 수 없습니다." } };
  }
  // 좁힌 값을 따로 받아 둔다 — 아래 도우미들은 함수 선언이라 끌어올려지고,
  // 그러면 위 검사가 아직 안 돈 자리에서도 불릴 수 있다고 본다(TS18047).
  const root: Record<string, unknown> = parsed;

  // ── 도우미 ────────────────────────────────────────────────────────────

  /** 없는 값의 표준형은 `undefined` 하나다. 키 없음·`null`·빈 문자열이 모두 같은 뜻이다. */
  function optionalText(
    source: Record<string, unknown>,
    key: string,
    fieldKey: string,
    label: string,
    maxLength = MAX_SHORT_TEXT
  ): string | undefined {
    const value = source[key];
    if (value === null || value === undefined) return undefined;
    if (typeof value !== "string") {
      fieldErrors[fieldKey] = `${label} 값을 확인할 수 없습니다.`;
      return undefined;
    }
    if (value.length > maxLength) {
      fieldErrors[fieldKey] = `${label}은(는) ${maxLength}자를 넘을 수 없습니다.`;
      return undefined;
    }
    const trimmed = value.trim();
    return trimmed === "" ? undefined : trimmed;
  }

  /**
   * 다듬지 않는 칸. 「상황」 두 칸이 그렇다 — 앞 공백이 글머리표다.
   * 빈 값의 판정만 `trim()` 으로 하고, 돌려주는 것은 **받은 그대로**다.
   */
  function optionalRawText(
    source: Record<string, unknown>,
    key: string,
    fieldKey: string,
    label: string,
    maxLength: number
  ): string | undefined {
    const value = source[key];
    if (value === null || value === undefined) return undefined;
    if (typeof value !== "string") {
      fieldErrors[fieldKey] = `${label} 값을 확인할 수 없습니다.`;
      return undefined;
    }
    if (value.length > maxLength) {
      fieldErrors[fieldKey] = `${label}은(는) ${maxLength}자를 넘을 수 없습니다.`;
      return undefined;
    }
    return value.trim() === "" ? undefined : value;
  }

  function requiredText(key: string, fieldKey: string, label: string): string {
    const value = root[key];
    if (typeof value !== "string" || value.trim() === "") {
      fieldErrors[fieldKey] = `${label}을(를) 입력해 주세요.`;
      return "";
    }
    if (value.length > MAX_SHORT_TEXT) {
      fieldErrors[fieldKey] = `${label}은(는) ${MAX_SHORT_TEXT}자를 넘을 수 없습니다.`;
      return "";
    }
    return value.trim();
  }

  function optionalDate(
    source: Record<string, unknown>,
    key: string,
    fieldKey: string,
    label: string
  ): Date | undefined {
    const value = source[key];
    if (value === null || value === undefined || value === "") return undefined;
    if (typeof value !== "string" || !isCalendarDate(value.trim())) {
      fieldErrors[fieldKey] = `${label}을(를) YYYY-MM-DD 형식으로 입력해 주세요.`;
      return undefined;
    }
    return parseDateOnly(value.trim());
  }

  /** 제조 년·월, 사용 년수·개월수. 채우개가 0 이상의 정수만 받는다. */
  function optionalWholeNumber(key: string, label: string): number | undefined {
    const value = root[key];
    if (value === null || value === undefined || value === "") return undefined;
    const numeric = typeof value === "string" ? Number(value) : value;
    if (typeof numeric !== "number" || !Number.isInteger(numeric) || numeric < 0) {
      fieldErrors[key] = `${label}은(는) 0 이상의 정수여야 합니다.`;
      return undefined;
    }
    return numeric;
  }

  /**
   * 본문·비고 줄 목록. **빈 줄을 버리지 않는다** — 채우개가 "줄 사이를 띄우고
   * 싶으면 빈 문자열을 한 줄 넣는다"로 정해 두었고, 그것이 문서의 모양이다.
   */
  function textLines(
    source: Record<string, unknown>,
    key: string,
    fieldKey: string,
    label: string
  ): string[] {
    const value = source[key];
    if (value === null || value === undefined) return [];
    if (!Array.isArray(value)) {
      fieldErrors[fieldKey] = `${label}은(는) 줄 목록이어야 합니다.`;
      return [];
    }
    const lines: string[] = [];
    for (const [index, line] of value.entries()) {
      if (typeof line !== "string") {
        fieldErrors[`${fieldKey}.${index}`] = `${label} ${index + 1}번째 줄을 확인할 수 없습니다.`;
        continue;
      }
      if (line.length > MAX_BODY_LINE) {
        fieldErrors[`${fieldKey}.${index}`] =
          `${label} ${index + 1}번째 줄이 ${MAX_BODY_LINE}자를 넘습니다.`;
        continue;
      }
      lines.push(line);
    }
    return lines;
  }

  // ── 종류 ──────────────────────────────────────────────────────────────

  const rawKind = root.kind;
  if (!isServiceReportKind(rawKind)) {
    // 종류를 모르면 나머지 검사의 뜻이 달라진다(정리·조치 완료가 갈린다).
    // 다른 오류를 함께 늘어놓는 대신 여기서 끝낸다.
    return { ok: false, fieldErrors: { kind: "보고서 종류를 확인할 수 없습니다." } };
  }
  const kind: ServiceReportKind = rawKind;

  // ── 머리 ──────────────────────────────────────────────────────────────

  const customerName = requiredText("customerName", "customerName", "고객사명");
  const issuedOn = optionalDate(root, "issuedOn", "issuedOn", "발행일");
  if (issuedOn === undefined && fieldErrors.issuedOn === undefined) {
    fieldErrors.issuedOn = "발행일을 입력해 주세요.";
  }

  const reportNumberRecord = asRecord(root.reportNumber) ?? {};
  if (root.reportNumber !== undefined && root.reportNumber !== null && asRecord(root.reportNumber) === null) {
    fieldErrors.reportNumber = "보고서 번호를 확인할 수 없습니다.";
  }
  const reportPrefix = optionalText(reportNumberRecord, "prefix", "reportNumber.prefix", "보고서 번호(앞)");
  const reportMiddle = reportNumberRecord.middle;
  const reportTail = reportNumberRecord.tail;
  if (typeof reportMiddle !== "string" || reportMiddle.trim() === "") {
    fieldErrors["reportNumber.middle"] = "보고서 번호(중간)를 입력해 주세요.";
  } else if (reportMiddle.length > MAX_SHORT_TEXT) {
    fieldErrors["reportNumber.middle"] = `보고서 번호(중간)는 ${MAX_SHORT_TEXT}자를 넘을 수 없습니다.`;
  }
  if (typeof reportTail !== "string" || reportTail.trim() === "") {
    fieldErrors["reportNumber.tail"] = "보고서 번호(뒤)를 입력해 주세요.";
  } else if (reportTail.length > MAX_SHORT_TEXT) {
    fieldErrors["reportNumber.tail"] = `보고서 번호(뒤)는 ${MAX_SHORT_TEXT}자를 넘을 수 없습니다.`;
  }

  const customer = optionalText(root, "customer", "customer", "고객");
  const receivedOn = optionalDate(root, "receivedOn", "receivedOn", "접수일");
  const occurrencePlace = optionalText(root, "occurrencePlace", "occurrencePlace", "발생 장소");
  const occurrencePlaceDetail = optionalText(
    root,
    "occurrencePlaceDetail",
    "occurrencePlaceDetail",
    "발생 장소 상세"
  );
  const occurredOn = normalizeOccurredOn(root.occurredOn, fieldErrors);

  const productName = optionalText(root, "productName", "productName", "품명");
  const productCategory = optionalText(root, "productCategory", "productCategory", "품명 구분");
  const modelName = optionalText(root, "modelName", "modelName", "형식");
  const manufacturedYear = optionalWholeNumber("manufacturedYear", "제조 년");
  const manufacturedMonth = optionalWholeNumber("manufacturedMonth", "제조 월");
  const lotNumber = optionalText(root, "lotNumber", "lotNumber", "L/N");
  const serialNumber = optionalText(root, "serialNumber", "serialNumber", "S/N");
  const usedYears = optionalWholeNumber("usedYears", "사용 년수");
  const usedMonths = optionalWholeNumber("usedMonths", "사용 개월수");
  const repairNumber = optionalText(root, "repairNumber", "repairNumber", "수리 번호");

  // 🔴 「상황」 두 칸은 다듬지 않는다 — 앞 공백이 글머리표다.
  const situationRecord = asRecord(root.situation);
  if (root.situation !== undefined && root.situation !== null && situationRecord === null) {
    fieldErrors.situation = "상황 값을 확인할 수 없습니다.";
  }
  let situation: { request?: string; detail?: string } | undefined;
  if (situationRecord) {
    const request = optionalRawText(situationRecord, "request", "situation.request", "상황(의뢰 종류)", MAX_SHORT_TEXT);
    const detail = optionalRawText(situationRecord, "detail", "situation.detail", "상황(내용)", MAX_LONG_TEXT);
    situation = { request, detail };
  }

  const causes = normalizeCauses(root.causes, fieldErrors);
  const remark = textLines(root, "remark", "remark", "비고");
  if (remark.length > SERVICE_REPORT_MAX_REMARK_ROWS) {
    fieldErrors.remark = `비고는 ${SERVICE_REPORT_MAX_REMARK_ROWS}줄까지만 적을 수 있습니다. 지금 ${remark.length}줄입니다.`;
  }

  // ── 조치 ──────────────────────────────────────────────────────────────

  const dispositionRecord = asRecord(root.disposition);
  if (root.disposition !== undefined && root.disposition !== null && dispositionRecord === null) {
    fieldErrors.disposition = "조치 값을 확인할 수 없습니다.";
  }
  const source = dispositionRecord ?? {};

  const onSiteRepair = optionalBoolean(source.onSiteRepair, "disposition.onSiteRepair", "현지수리", fieldErrors);
  const replacementDelivery = optionalBoolean(
    source.replacementDelivery,
    "disposition.replacementDelivery",
    "대품납입",
    fieldErrors
  );

  /**
   * 🔴 **있기만 하면 체크된다.** 빈 객체 `{}` 도 그대로 넘긴다 — "날짜는 모르지만
   * 현품은 받았다"가 실제로 있는 상태이고, 값이 비었다고 버리면 체크가 사라진다.
   */
  const goodsReceiptRecord = asRecord(source.goodsReceipt);
  if (source.goodsReceipt !== undefined && source.goodsReceipt !== null && goodsReceiptRecord === null) {
    fieldErrors["disposition.goodsReceipt"] = "현품 인수 값을 확인할 수 없습니다.";
  }
  const goodsReceipt = goodsReceiptRecord
    ? {
        on: optionalDate(goodsReceiptRecord, "on", "disposition.goodsReceipt.on", "현품 인수 날짜"),
        number: optionalText(goodsReceiptRecord, "number", "disposition.goodsReceipt.number", "현품 인수 번호"),
      }
    : undefined;

  const completionRecord = asRecord(source.completion);
  if (source.completion !== undefined && source.completion !== null && completionRecord === null) {
    fieldErrors["disposition.completion"] = "조치 완료 값을 확인할 수 없습니다.";
  }
  const hasCompletion = source.completion !== undefined && source.completion !== null;
  const completion = completionRecord
    ? { on: optionalDate(completionRecord, "on", "disposition.completion.on", "조치 완료 날짜") }
    : undefined;

  // ── 본문 ──────────────────────────────────────────────────────────────

  const bodyRecord = asRecord(root.body);
  if (!bodyRecord) {
    fieldErrors.body = "본문을 확인할 수 없습니다.";
  }
  const body = bodyRecord ?? {};

  const findings = textLines(body, "findings", "body.findings", "확인내용");
  const actions = textLines(body, "actions", "body.actions", "조치");
  const hasSummary = body.summary !== undefined && body.summary !== null;
  const summary = hasSummary ? textLines(body, "summary", "body.summary", "정리") : [];

  /**
   * 🔴 「안 줌」과 「명시적으로 비움」을 가른다. JSON 에 `undefined` 가 없으므로
   * **키 없음과 `null` 이 「안 줌」**이고, `""` 는 「비움」이다.
   */
  const rawIntro = body.findingsIntro;
  let findingsIntro: string | undefined;
  if (rawIntro !== undefined && rawIntro !== null) {
    if (typeof rawIntro !== "string") {
      fieldErrors["body.findingsIntro"] = "확인내용 머리글을 확인할 수 없습니다.";
    } else if (rawIntro.length > MAX_BODY_LINE) {
      fieldErrors["body.findingsIntro"] = `확인내용 머리글이 ${MAX_BODY_LINE}자를 넘습니다.`;
    } else {
      findingsIntro = rawIntro;
    }
  }

  // ── 종류와 어긋나는 값 ────────────────────────────────────────────────

  if (kind === "INSPECTION") {
    if (hasSummary) {
      fieldErrors["body.summary"] =
        `${KIND_LABELS.INSPECTION}에는 「정리」 구역이 없습니다. ${KIND_LABELS.REPAIR}로 만들어 주세요.`;
    }
    if (hasCompletion) {
      fieldErrors["disposition.completion"] =
        `${KIND_LABELS.INSPECTION}에는 「조치 완료」를 적을 수 없습니다. ${KIND_LABELS.REPAIR}로 만들어 주세요.`;
    }
  }

  // ── 본문 줄 수 ────────────────────────────────────────────────────────

  /**
   * 채우개가 던지기 전에 사람이 알아들을 말로 막는다.
   *
   * 🔴 **셈은 화면과 한 벌이다** — `countServiceReportBodyRows` 하나를 양쪽이
   * 부른다. 예전에는 같은 식을 두 벌로 들고 있었고, 그러면 한쪽만 고쳐지는 날
   * 화면은 "아직 여유가 있다"고 말하는데 서버가 400 을 돌려준다.
   *
   * ⚠️ **여기 셈도 어림값이다.** 구역이 양식의 어느 행에서 시작하는지는 양식
   * 파일이 갖고 있고, 채우개는 그것까지 읽어 자리를 잡는다(`planBodyLayout`) —
   * 그쪽 줄 수는 늘 이 값보다 크거나 같다. 게다가 여기 셈은 **나누기 전의** 줄
   * 수라, 칸의 가로폭을 넘는 줄을 채우개가 나누면 또 커진다. 마지막 방어선은
   * 여전히 채우개다(자세한 것은 `countServiceReportBodyRows` 머리말).
   */
  const bodyRows = countServiceReportBodyRows(
    { findings, findingsIntro, actions, summary },
    SERVICE_REPORT_BODY_ROW_LAYOUT
  );
  if (bodyRows > SERVICE_REPORT_MAX_BODY_ROWS) {
    fieldErrors.body =
      `본문이 ${bodyRows}줄입니다. 한 보고서에 ${SERVICE_REPORT_MAX_BODY_ROWS}줄까지만 담을 수 있습니다. 줄을 줄이거나 보고서를 나눠 주세요.`;
  }
  if (findings.length === 0 && actions.length === 0 && summary.length === 0) {
    fieldErrors.body = "본문이 한 줄도 없습니다. 확인내용이나 조치를 적어 주세요.";
  }

  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };

  const common = {
    customerName,
    // 위에서 없으면 오류를 담았으므로 여기 오면 반드시 있다.
    issuedOn: issuedOn as Date,
    reportNumber: {
      prefix: reportPrefix,
      middle: (reportMiddle as string).trim(),
      tail: (reportTail as string).trim(),
    },
    customer,
    receivedOn,
    occurrencePlace,
    occurrencePlaceDetail,
    occurredOn,
    productName,
    productCategory,
    modelName,
    manufacturedYear,
    manufacturedMonth,
    lotNumber,
    serialNumber,
    usedYears,
    usedMonths,
    situation,
    causes,
    repairNumber,
    remark,
  };

  if (kind === "REPAIR") {
    return {
      ok: true,
      data: {
        ...common,
        kind: "REPAIR",
        disposition: { onSiteRepair, replacementDelivery, goodsReceipt, completion },
        // 「정리」는 수리 보고서에 반드시 있어야 한다(비어 있어도 된다).
        body: { findings, findingsIntro, actions, summary },
      },
    };
  }

  return {
    ok: true,
    data: {
      ...common,
      kind: "INSPECTION",
      disposition: { onSiteRepair, replacementDelivery, goodsReceipt },
      body: { findings, findingsIntro, actions },
    },
  };
}

// ── 조각들 ───────────────────────────────────────────────────────────────

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function optionalBoolean(
  value: unknown,
  fieldKey: string,
  label: string,
  fieldErrors: Record<string, string>
): boolean | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value !== "boolean") {
    fieldErrors[fieldKey] = `${label} 값을 확인할 수 없습니다.`;
    return undefined;
  }
  return value;
}

/**
 * `AK17` 「발생 년월일」.
 *
 * 🔴 채우개가 `Date | string` 둘 다 받는다 — **날짜를 모르는 건이 흔해서**
 * 양식이 `―――` 를 적어 두었다. 날짜 모양이면 날짜로, 아니면 적힌 글자
 * 그대로 넘긴다. 여기서 날짜만 받게 하면 그 성질이 죽는다.
 */
function normalizeOccurredOn(
  value: unknown,
  fieldErrors: Record<string, string>
): Date | string | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  if (typeof value !== "string") {
    fieldErrors.occurredOn = "발생 년월일 값을 확인할 수 없습니다.";
    return undefined;
  }
  if (value.length > MAX_SHORT_TEXT) {
    fieldErrors.occurredOn = `발생 년월일은 ${MAX_SHORT_TEXT}자를 넘을 수 없습니다.`;
    return undefined;
  }
  const trimmed = value.trim();
  if (trimmed === "") return undefined;

  /**
   * 🔴 날짜 **모양**이면 실제 달력에 있는 날이어야 한다. `"2026-02-30"` 을
   * 글자로 흘려보내면 문서에 그대로 찍힌다 — 사람이 오타를 낸 것이지 `―――`
   * 처럼 일부러 적은 글자가 아니다.
   */
  if (DATE_PATTERN.test(trimmed)) {
    if (!isCalendarDate(trimmed)) {
      fieldErrors.occurredOn = "발생 년월일이 달력에 없는 날짜입니다.";
      return undefined;
    }
    return parseDateOnly(trimmed);
  }
  return trimmed;
}

function normalizeCauses(
  value: unknown,
  fieldErrors: Record<string, string>
): ServiceReportCause[] | undefined {
  if (value === null || value === undefined) return undefined;
  if (!Array.isArray(value)) {
    fieldErrors.causes = "원인 목록을 확인할 수 없습니다.";
    return undefined;
  }
  const known = SERVICE_REPORT_CAUSES as readonly string[];
  const causes: ServiceReportCause[] = [];
  for (const [index, cause] of value.entries()) {
    if (typeof cause !== "string" || !known.includes(cause)) {
      fieldErrors[`causes.${index}`] = "알 수 없는 원인 항목입니다.";
      continue;
    }
    // 같은 원인을 두 번 보내도 체크는 하나다 — 조용히 하나로 본다.
    if (!causes.includes(cause as ServiceReportCause)) causes.push(cause as ServiceReportCause);
  }
  return causes;
}

/** `"YYYY-MM-DD"` 가 실제 달력에 있는 날인가. `2026-02-30` 은 아니다. */
function isCalendarDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

/**
 * `"YYYY-MM-DD"` → 그 날짜의 **로컬** Date.
 *
 * 🔴 `new Date(문자열)` 을 쓰지 않는다 — UTC 자정으로 읽혀 시간대에 따라
 * 하루가 밀린다. 견적서 라우트의 `parseDateOnly` 와 같은 처리다.
 */
export function parseDateOnly(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}
