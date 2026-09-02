import {
  serviceReportLines,
  type ServiceReportFormValues,
  type ServiceReportOccurredOnMode,
} from "@/lib/domain/service-report-form";
import type { ServiceReportCause } from "@/lib/xlsx/service-report-template";
import type {
  serviceReportLineSectionEnum,
  serviceReportOccurredOnModeEnum,
} from "@/lib/db/schema/service-reports";

/**
 * ============================================================================
 * 검사·수리 보고서 저장 — 폼 값과 칸 값 사이의 단 하나의 사전
 * ============================================================================
 * `quote-input.ts`·`service-report-input.ts` 와 같은 자리의 파일이다. **DB 도
 * 세션도 여기서 만지지 않는다** — 순수 함수만 두어야 단위 시험이 붙고, 그래야
 * "무엇이 어느 칸으로 가는가"가 실제로 검증된다.
 *
 * ── 🔴 왜 두 방향이 한 파일에 있나 ──────────────────────────────────────
 * 저장(`toServiceReportColumns`)과 불러오기(`toServiceReportSaveValues`)는
 * **서로의 역함수여야 한다.** 사람이 적어 둔 폼을 저장하고 다시 열면 적어 둔
 * 그대로 떠야 하고, 거기서 `buildServiceReportRequestBody()` 를 거치면 저장하기
 * 전과 똑같은 xlsx 가 나와야 한다. 두 방향을 다른 파일에 나눠 두면 한쪽만
 * 고쳐지는 날이 오고, 그때 증상은 오류가 아니라 **다시 열었을 때 값이 조금 다른
 * 문서**다 — 고객사로 나간 뒤에야 안다. 한 파일에 마주 놓아 두면 단위 시험이
 * 왕복 한 줄로 그것을 못 박는다.
 *
 * ── 🔴 폼 값을 그대로 담는다. 새 모양을 발명하지 않는다 ─────────────────
 * 저장하는 값은 `ServiceReportFormValues` 그 자체다. 중간에 모양을 한 번 더
 * 바꾸면 그 사이가 값이 새는 자리가 된다. 바꾸는 것은 **경계에서만**이다:
 *
 *   · 날짜   폼은 `"YYYY-MM-DD"` 글자, DB 는 `date` 칸 — 빈 글자는 `NULL`
 *   · 숫자   폼은 글자, DB 는 `integer`    — 빈 글자는 `NULL`
 *   · 본문   폼은 여러 줄 글자 하나, DB 는 줄 표 — `serviceReportLines()` 로 나눈다
 *   · 원인   폼은 배열, DB 는 표
 *
 * ── 🔴 종류와 어긋나는 값도 **지우지 않고 담는다** ──────────────────────
 * 검사 보고서인데 「정리」나 「조치 완료」가 적혀 있으면 그대로 저장한다. 화면이
 * 종류를 수리에서 검사로 바꿔도 적어 둔 글을 지우지 않기 때문이다 — 다시 수리로
 * 돌리면 그대로 있어야 한다(`buildServiceReportRequestBody` 의 같은 항목). 저장이
 * 그것을 버리면 **종류를 잘못 골랐다가 되돌린 사람의 글이 사라진다.**
 *
 * 문서에서 걸러 내는 일은 이미 `buildServiceReportRequestBody()` 가 한다 —
 * 검사 보고서에는 그 두 키를 아예 넣지 않는다. 그러니 저장해 둔 값이 문서를
 * 망가뜨리지 않는다.
 *
 * ── 다듬지 않는다 ───────────────────────────────────────────────────────
 * 어느 글자 칸도 `trim()` 하지 않는다. 「상황」 두 칸은 앞 공백이 글머리표이고
 * (`" ・ 수리의뢰"`), 본문 줄의 들여쓰기는 사람이 뜻을 담아 넣은 것이다
 * (`service-report-input.ts` 의 '앞 공백을 다듬지 않는 칸이 있다'). 비었는지는
 * **정확히 빈 글자인가**로만 본다 — 공백 한 칸을 「없음」으로 뭉개면 다시 열었을
 * 때 그 칸이 달라진다.
 * ============================================================================
 */

/** `service_report_lines.section`. 스키마에서 타입만 가져온다(값은 안 끌고 온다). */
export type ServiceReportLineSection =
  (typeof serviceReportLineSectionEnum)["enumValues"][number];

/** `service_reports.occurred_on_mode`. `NULL` 은 「아예 안 적음」이다. */
type ServiceReportOccurredOnModeColumn =
  (typeof serviceReportOccurredOnModeEnum)["enumValues"][number];

/**
 * 저장·복원이 오가는 값.
 *
 * 🔴 `findingsIntro` 만 폼과 다르다 — 폼은 `string` 이지만(화면이 늘 정형 문구로
 * 미리 채워 준다) DB 칸은 nullable 이고, 그 `NULL` 에는 **뜻이 있다**:
 *
 *   · `null` = 안 줌      → 채우개가 정형 문구를 넣는다
 *   · `''`   = 일부러 비움 → 아무것도 안 들어간다
 *
 * 화면에서 오는 값은 언제나 `string` 이므로 `ServiceReportFormValues` 는 이 타입에
 * 그대로 대입된다. 「안 줌」을 만들 수 있는 것은 다른 길(가져오기·복원)뿐이고,
 * 그 자리를 타입에 남겨 두어야 두 값이 같아지지 않는다.
 */
export type ServiceReportSaveValues = Omit<ServiceReportFormValues, "findingsIntro"> & {
  findingsIntro: string | null;
};

/** `service_reports` 한 행에 실제로 쓰는 칸들. `id`·`version`·감사 칸은 mutation 이 붙인다. */
export type ServiceReportColumns = {
  kind: ServiceReportFormValues["kind"];
  reportNumberPrefix: string | null;
  reportNumberMiddle: string;
  reportNumberTail: string;
  issuedOn: string;
  customerNameText: string;
  customerText: string | null;
  receivedOn: string | null;
  occurrencePlace: string | null;
  occurrencePlaceDetail: string | null;
  occurredOnMode: ServiceReportOccurredOnModeColumn | null;
  occurredOnDate: string | null;
  occurredOnText: string | null;
  productName: string | null;
  productCategory: string | null;
  modelNameText: string | null;
  lotNumberText: string | null;
  serialNumberText: string | null;
  manufacturedYear: number | null;
  manufacturedMonth: number | null;
  usedYears: number | null;
  usedMonths: number | null;
  situationRequest: string | null;
  situationDetail: string | null;
  onSiteRepair: boolean;
  replacementDelivery: boolean;
  goodsReceiptChecked: boolean;
  goodsReceiptOn: string | null;
  goodsReceiptNumber: string | null;
  completionChecked: boolean;
  completionOn: string | null;
  repairNumber: string | null;
  /** 🔴 빈 글자를 `NULL` 로 정규화하지 않는다. 위 `ServiceReportSaveValues` 주석 참조. */
  findingsIntro: string | null;
};

/** `service_report_lines` 한 줄. 차례는 **구역 안에서** 1부터다. */
export type ServiceReportLineRow = {
  section: ServiceReportLineSection;
  lineNo: number;
  text: string;
};

/** 한 트랜잭션이 쓰는 것 전부 — 보고서 한 행 + 줄들 + 고른 원인들. */
export type ServiceReportRecord = {
  columns: ServiceReportColumns;
  lines: ServiceReportLineRow[];
  causes: ServiceReportCause[];
};

export type ServiceReportSaveResult =
  | { ok: true; data: ServiceReportRecord }
  | { ok: false; fieldErrors: Record<string, string> };

/**
 * 본문 넷과 그것이 앉을 구역. **순서가 곧 저장 순서**다.
 *
 * `REMARK`(비고)가 본문 셋과 한 표에 있는 까닭은 모양이 똑같기 때문이다 — 줄
 * 목록이고, 빈 줄이 뜻을 갖고, 통째로 저장된다(`schema/service-reports.ts`).
 */
const LINE_SECTIONS: readonly {
  section: ServiceReportLineSection;
  key: "findings" | "actions" | "summary" | "remark";
}[] = [
  { section: "FINDINGS", key: "findings" },
  { section: "ACTIONS", key: "actions" },
  { section: "SUMMARY", key: "summary" },
  { section: "REMARK", key: "remark" },
];

/** `"YYYY-MM-DD"` 인가 — 실제 달력에 있는 날까지 본다(2026-02-30 은 아니다). */
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;

function isCalendarDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

/** 빈 글자는 「없음」이다. 그 밖에는 **받은 글자 그대로** — 위 '다듬지 않는다' 참조. */
function textOrNull(value: string): string | null {
  return value === "" ? null : value;
}

function nullToText(value: string | null): string {
  return value ?? "";
}

// ── 폼 → 칸 ──────────────────────────────────────────────────────────────

/**
 * 폼 값을 그대로 칸 값으로 옮긴다.
 *
 * 막는 것은 **두 가지뿐**이다. 둘 다 그냥 넘기면 Postgres 가 사람에게 아무것도
 * 설명하지 못하는 오류를 던지거나, 값이 조용히 사라지는 자리다:
 *
 *   1. **날짜 모양이 아닌 날짜** — 발행일은 NOT NULL 이라 빈 채로는 저장 자체가
 *      안 되고, 나머지 날짜도 `"2026-02-30"` 같은 오타가 그대로 들어가면 안 된다.
 *   2. **숫자가 아닌 숫자 칸** — `NULL` 로 떨어뜨려 조용히 버리지 않는다. 사람이
 *      제조년월에 적어 둔 것이 다시 열었을 때 사라지면 그 까닭을 알 길이 없다.
 *
 * 그 밖의 규칙(고객사명이 있어야 하는가, 본문이 몇 줄까지인가)은 여기서 보지
 * 않는다 — 문서로 나갈 때 `validateServiceReportFields` 가 이미 본다. 저장까지
 * 같은 규칙으로 막으면 **적다 만 보고서를 저장해 둘 수 없게 된다.**
 */
export function toServiceReportColumns(values: ServiceReportSaveValues): ServiceReportSaveResult {
  const fieldErrors: Record<string, string> = {};

  /** 비어 있으면 `null`, 날짜 모양이면 그대로, 아니면 칸 오류. */
  function optionalDate(value: string, fieldKey: string, label: string): string | null {
    if (value === "") return null;
    if (!isCalendarDate(value)) {
      fieldErrors[fieldKey] = `${label}을(를) YYYY-MM-DD 형식으로 입력해 주세요.`;
      return null;
    }
    return value;
  }

  /** 0 이상의 정수만. `service-report-input.ts` 의 `optionalWholeNumber` 와 같은 규칙이다. */
  function optionalWholeNumber(value: string, fieldKey: string, label: string): number | null {
    const digits = value.trim();
    if (digits === "") return null;
    if (!/^\d+$/u.test(digits)) {
      fieldErrors[fieldKey] = `${label}은(는) 0 이상의 정수여야 합니다.`;
      return null;
    }
    return Number(digits);
  }

  const issuedOn = values.issuedOn === "" ? null : optionalDate(values.issuedOn, "issuedOn", "발행일");
  if (issuedOn === null && fieldErrors.issuedOn === undefined) {
    fieldErrors.issuedOn = "발행일을 입력해 주세요.";
  }

  const occurredOnDate = optionalDate(values.occurredOnDate, "occurredOnDate", "발생 년월일");
  const occurredOnText = textOrNull(values.occurredOnText);

  const columns: ServiceReportColumns = {
    kind: values.kind,

    reportNumberPrefix: textOrNull(values.reportNumberPrefix),
    reportNumberMiddle: values.reportNumberMiddle,
    reportNumberTail: values.reportNumberTail,
    // 위에서 없으면 오류를 담았으므로 여기 오면 반드시 있다.
    issuedOn: issuedOn ?? "",

    customerNameText: values.customerName,
    customerText: textOrNull(values.customer),
    receivedOn: optionalDate(values.receivedOn, "receivedOn", "접수일"),
    occurrencePlace: textOrNull(values.occurrencePlace),
    occurrencePlaceDetail: textOrNull(values.occurrencePlaceDetail),

    /**
     * 🔴 **날짜도 글자도 없으면 mode 를 `NULL` 로 둔다** — 「발생 년월일」을 아예
     * 적지 않은 보고서다(`schema/service-reports.ts` 의 같은 항목). 화면은 늘 둘 중
     * 하나를 골라 두지만, 아무것도 안 적었을 때 그 고름은 문서에 아무 영향이 없다.
     * 억지로 `DATE` 를 적어 두면 "날짜로 적었는데 비어 있다"와 "아예 안 적었다"가
     * 같아진다.
     *
     * 반대로 한쪽이라도 적혀 있으면 **폼이 고른 쪽을 그대로** 담는다 — 되짚어
     * 짐작하지 않는다. 사람이 글자 칸에 `―――` 를 적어 두고 날짜 쪽을 펴 두었을
     * 수도 있고, 그 상태도 다시 열었을 때 그대로여야 한다.
     */
    occurredOnMode:
      occurredOnDate === null && occurredOnText === null
        ? null
        : occurredOnModeColumn(values.occurredOnMode),
    occurredOnDate,
    occurredOnText,

    productName: textOrNull(values.productName),
    productCategory: textOrNull(values.productCategory),
    modelNameText: textOrNull(values.modelName),
    lotNumberText: textOrNull(values.lotNumber),
    serialNumberText: textOrNull(values.serialNumber),
    manufacturedYear: optionalWholeNumber(values.manufacturedYear, "manufacturedYear", "제조 년"),
    manufacturedMonth: optionalWholeNumber(values.manufacturedMonth, "manufacturedMonth", "제조 월"),
    usedYears: optionalWholeNumber(values.usedYears, "usedYears", "사용 년수"),
    usedMonths: optionalWholeNumber(values.usedMonths, "usedMonths", "사용 개월수"),

    situationRequest: textOrNull(values.situationRequest),
    situationDetail: textOrNull(values.situationDetail),

    onSiteRepair: values.onSiteRepair,
    replacementDelivery: values.replacementDelivery,
    // 🔴 체크와 날짜는 따로다 — "날짜는 모르지만 현품은 받았다"가 실제로 있다.
    goodsReceiptChecked: values.goodsReceiptChecked,
    goodsReceiptOn: optionalDate(values.goodsReceiptOn, "goodsReceiptOn", "현품 인수 날짜"),
    goodsReceiptNumber: textOrNull(values.goodsReceiptNumber),
    completionChecked: values.completionChecked,
    completionOn: optionalDate(values.completionOn, "completionOn", "조치 완료 날짜"),
    repairNumber: textOrNull(values.repairNumber),

    // 🔴 빈 글자를 `NULL` 로 바꾸지 않는다. 사람이 지운 문장이 되살아난다.
    findingsIntro: values.findingsIntro,
  };

  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };

  return { ok: true, data: { columns, lines: toLineRows(values), causes: dedupeCauses(values.causes) } };
}

function occurredOnModeColumn(mode: ServiceReportOccurredOnMode): ServiceReportOccurredOnModeColumn {
  return mode;
}

/**
 * 본문 넷 → 줄 표.
 *
 * 🔴 **빈 줄을 걸러내지 않는다.** `text` 가 빈 글자인 줄은 "문서에서 한 줄
 * 띄우라"는 뜻이다(사람이 Enter 를 두 번 친 것). `text !== ""` 로 거르면 문단
 * 나누기가 통째로 사라지는데, 오류가 아니라 모양이 달라지는 것이라 아무도 못
 * 알아챈다(`schema/service-reports.ts` 의 '빈 줄을 버리면 안 된다').
 *
 * ⚠️ 끝의 빈 줄만 `serviceReportLines()` 가 버린다 — 마지막에 Enter 를 한 번 치는
 * 것은 버릇이지 뜻이 아니다. 문서로 나가는 값과 **같은 규칙**이라, 저장이 문서를
 * 바꾸지 않는다.
 */
function toLineRows(values: ServiceReportSaveValues): ServiceReportLineRow[] {
  const rows: ServiceReportLineRow[] = [];
  for (const { section, key } of LINE_SECTIONS) {
    // 차례는 **구역 안에서** 1부터다. 넷이 하나의 번호를 나눠 쓰면 한 구역의 줄을
    // 지웠을 때 다른 구역의 번호까지 흔들린다(견적서 작업 내역과 같은 규칙).
    serviceReportLines(values[key]).forEach((text, index) => {
      rows.push({ section, lineNo: index + 1, text });
    });
  }
  return rows;
}

/**
 * 같은 원인을 두 번 담지 않는다 — 체크는 하나뿐이라 두 행은 뜻이 없고, 집계할 때
 * 한 건이 두 번 세어진다. 표의 unique 인덱스가 최종 관문이지만, 그 23505 는 사람에게
 * 아무것도 설명하지 못한다(`service-report-input.ts` 도 중복을 조용히 하나로 본다).
 */
function dedupeCauses(causes: readonly ServiceReportCause[]): ServiceReportCause[] {
  return [...new Set(causes)];
}

// ── 칸 → 폼 ──────────────────────────────────────────────────────────────

/**
 * 저장해 둔 것을 폼 값으로 되돌린다. `toServiceReportColumns` 의 역함수다 —
 * 위 머리말의 '왜 두 방향이 한 파일에 있나' 참조.
 *
 * 🔴 `findingsIntro` 는 **`null` 을 그대로 내보낸다.** 여기서 `''` 로 바꾸면
 * 「안 줌」과 「일부러 비움」이 같아지고, 그 순간 정형 문구가 영영 안 들어간다.
 * 화면에 부을 때 `null` 을 무엇으로 볼지는 `serviceReportFormValues()` 가 정한다.
 */
export function toServiceReportSaveValues(record: ServiceReportRecord): ServiceReportSaveValues {
  const { columns } = record;
  const body = joinLineRows(record.lines);

  return {
    kind: columns.kind,

    customerName: columns.customerNameText,
    issuedOn: columns.issuedOn,
    reportNumberPrefix: nullToText(columns.reportNumberPrefix),
    reportNumberMiddle: columns.reportNumberMiddle,
    reportNumberTail: columns.reportNumberTail,
    customer: nullToText(columns.customerText),
    receivedOn: nullToText(columns.receivedOn),
    occurrencePlace: nullToText(columns.occurrencePlace),
    occurrencePlaceDetail: nullToText(columns.occurrencePlaceDetail),
    /**
     * mode 가 `NULL` 이면 「아예 안 적음」이다. 그때 화면이 어느 칸을 펴야 하는지는
     * 저장된 값이 답할 수 없으므로 **폼의 기본값(`DATE`)으로 연다** —
     * `createServiceReportFormValues` 가 새 보고서를 여는 것과 같은 상태다.
     * 두 칸이 모두 비어 있으니 문서에 나가는 값은 어느 쪽이든 같다.
     */
    occurredOnMode: columns.occurredOnMode ?? "DATE",
    occurredOnDate: nullToText(columns.occurredOnDate),
    occurredOnText: nullToText(columns.occurredOnText),
    productName: nullToText(columns.productName),
    productCategory: nullToText(columns.productCategory),
    modelName: nullToText(columns.modelNameText),
    manufacturedYear: numberToText(columns.manufacturedYear),
    manufacturedMonth: numberToText(columns.manufacturedMonth),
    lotNumber: nullToText(columns.lotNumberText),
    serialNumber: nullToText(columns.serialNumberText),
    usedYears: numberToText(columns.usedYears),
    usedMonths: numberToText(columns.usedMonths),
    situationRequest: nullToText(columns.situationRequest),
    situationDetail: nullToText(columns.situationDetail),

    onSiteRepair: columns.onSiteRepair,
    replacementDelivery: columns.replacementDelivery,
    goodsReceiptChecked: columns.goodsReceiptChecked,
    goodsReceiptOn: nullToText(columns.goodsReceiptOn),
    goodsReceiptNumber: nullToText(columns.goodsReceiptNumber),
    completionChecked: columns.completionChecked,
    completionOn: nullToText(columns.completionOn),
    repairNumber: nullToText(columns.repairNumber),
    causes: record.causes,

    findingsIntro: columns.findingsIntro,
    findings: body.FINDINGS,
    actions: body.ACTIONS,
    summary: body.SUMMARY,

    remark: body.REMARK,
  };
}

function numberToText(value: number | null): string {
  return value === null ? "" : String(value);
}

/**
 * 줄 표 → 여러 줄 글자 넷.
 *
 * 🔴 **읽은 차례 그대로 이어 붙인다.** 빈 줄도 한 줄을 차지하므로 사람이 띄워 둔
 * 문단이 그대로 돌아온다. 부르는 쪽이 `line_no` 순으로 읽어 오는 것을 전제한다
 * (`queries/service-reports.ts`).
 */
function joinLineRows(
  lines: readonly ServiceReportLineRow[]
): Record<ServiceReportLineSection, string> {
  const buckets: Record<ServiceReportLineSection, string[]> = {
    FINDINGS: [],
    ACTIONS: [],
    SUMMARY: [],
    REMARK: [],
  };
  for (const line of lines) buckets[line.section].push(line.text);

  return {
    FINDINGS: buckets.FINDINGS.join("\n"),
    ACTIONS: buckets.ACTIONS.join("\n"),
    SUMMARY: buckets.SUMMARY.join("\n"),
    REMARK: buckets.REMARK.join("\n"),
  };
}

/**
 * 화면에 그대로 부을 폼 값.
 *
 * 🔴 **`findingsIntro` 의 `null` 을 여기서, 한 번만 푼다.** 「안 줌」은 "채우개가
 * 정형 문구를 넣는다"는 뜻이고, 화면에서 그것과 같은 상태는 **그 문구가 미리
 * 채워진 칸**이다. 그래서 `null` 은 넘겨받은 정형 문구가 되고, `''` 는 `''` 로
 * 남는다 — 사람이 지운 문장은 다시 열어도 지워진 채다.
 *
 * 문구를 **인자로 받는** 까닭은 `service-report-form.ts` 와 같다: 상수가 있는
 * 모듈(`xlsx/service-report-template.ts`)이 `node:fs` 를 끌고 오고, 이 파일은
 * 화면 쪽에서도 읽힐 수 있어야 한다. 서버 페이지가 이미 그 값을 넘겨주고 있다.
 */
export function serviceReportFormValues(
  values: ServiceReportSaveValues,
  findingsIntro: string
): ServiceReportFormValues {
  return { ...values, findingsIntro: values.findingsIntro ?? findingsIntro };
}
