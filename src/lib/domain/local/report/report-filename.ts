import type { ReportType } from "./report-types";

/**
 * Stage F-1 전용 순수 파일명 빌더다. React 훅을 쓰지 않고, 브라우저 API(예:
 * window/document/Blob)나 localStorage, 파일시스템에 접근하지 않는다.
 * buildReportFilename은 동일한 인자(특히 동일한 generatedAt 문자열)에 대해
 * 항상 동일한 문자열을 반환한다 — 내부에서 인자 없는 new Date()를 호출해
 * "현재 시각"에 기대는 숨은 비결정적 fallback을 두지 않는다.
 */

export const REPORT_FILE_EXTENSIONS = ["pdf", "xlsx"] as const;
export type ReportFileExtension = (typeof REPORT_FILE_EXTENSIONS)[number];

const FILENAME_PREFIX = "AS_Report";

/**
 * 리포트 종류별 파일명 접두어 매핑. Stage F-1 시점에는 종류를 구분하는
 * 안전한(ASCII) 코드가 별도로 승인되지 않았으므로 전 종류가 동일하게
 * "AS_Report"를 쓴다. 한글 라벨(reportTypeLabels)은 파일명에 절대 쓰지 않는다.
 * 향후 종류별로 다른 접두어가 승인되면 이 표 하나만 바꾸면 된다 — Record라서
 * ReportType에 새 코드가 추가되면 컴파일 타임에 이 표 갱신이 강제된다.
 */
const REPORT_TYPE_FILENAME_PREFIXES: Record<ReportType, string> = {
  SERVICE_SUMMARY: FILENAME_PREFIX,
  INSPECTION_REPORT: FILENAME_PREFIX,
  REPAIR_REPORT: FILENAME_PREFIX,
  SHIPMENT_REPORT: FILENAME_PREFIX,
};

const UNKNOWN_INTAKE_SEGMENT = "UNKNOWN";
const MAX_INTAKE_SEGMENT_LENGTH = 40;
const MAX_FILENAME_LENGTH = 180;

const KST_TIME_ZONE = "Asia/Seoul";

/**
 * generatedAt이 Date로 파싱되지 않을 때 쓰는 고정 fallback 세그먼트다.
 * 호출자가 넘긴 값(=현재 리포트 세션의 generatedAt) 외에 내부적으로
 * new Date()를 호출해 "지금"을 대체값으로 쓰지 않는다 — 그러면 같은 잘못된
 * 입력이라도 호출 시점마다 다른 파일명이 나와 비결정적이 되기 때문이다.
 * 대신 실제로는 절대 발생할 수 없는 1970-01-01 00:00:00을 그대로 고정
 * fallback으로 써서, 파일명만 보고도 "이 리포트는 generatedAt이 깨졌던
 * 상태에서 생성됐다"는 것을 알아볼 수 있게 한다.
 */
const INVALID_DATE_FALLBACK_SEGMENT = "19700101_000000";

const kstPartsFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: KST_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

/** generatedAt(ISO 문자열, +09:00 고정 오프셋 또는 Z 둘 다 허용)을 사용자에게
 * 보이는 한국 로컬 시각(Asia/Seoul) 기준 "YYYYMMDD_HHmmss"로 변환한다.
 * UTC 구성요소를 직접 쓰지 않고 Intl.DateTimeFormat에 timeZone을 명시적으로
 * 고정하므로, 이 함수를 실행하는 호스트(브라우저/서버)의 로컬 시간대와
 * 무관하게 항상 같은 결과를 낸다. */
function buildKstTimestampSegment(generatedAt: string): string {
  const parsed = new Date(generatedAt);
  if (Number.isNaN(parsed.getTime())) {
    return INVALID_DATE_FALLBACK_SEGMENT;
  }

  const parts: Partial<Record<string, string>> = {};
  for (const part of kstPartsFormatter.formatToParts(parsed)) {
    parts[part.type] = part.value;
  }

  // hour12:false인 Intl 구현 일부(예: 구형 Chromium)는 자정을 "24"로 내보낸다.
  const hour = parts.hour === "24" ? "00" : (parts.hour ?? "00");
  const year = parts.year ?? "1970";
  const month = parts.month ?? "01";
  const day = parts.day ?? "01";
  const minute = parts.minute ?? "00";
  const second = parts.second ?? "00";

  return `${year}${month}${day}_${hour}${minute}${second}`;
}

/** intakeNumber를 파일명 세그먼트로 안전하게 정제한다.
 * - A-Z, a-z, 0-9, '-', '_'만 남긴다.
 * - 그 외 문자(공백, '.', 한글/비ASCII, Windows 금지 문자 '/','\\',':','*','?','"','<','>','|' 포함)는
 *   전부 하나의 '_'로 치환한다(연속된 금지 문자도 '_' 하나로 축소된다).
 * - 원본에 이미 있던 연속 구분자('--', '__', '-_' 등)도 '_' 하나로 축소한다.
 * - 앞뒤 구분자를 제거하고, 길이를 MAX_INTAKE_SEGMENT_LENGTH로 제한한다.
 * - 결과가 빈 문자열이면 절대 빈 세그먼트를 만들지 않고 "UNKNOWN"을 쓴다.
 * - 고객사/End-User 등 다른 데이터는 이 함수에 절대 넘기지 않는다(호출부 책임). */
function sanitizeIntakeNumber(intakeNumber: string): string {
  const replaced = intakeNumber.replace(/[^A-Za-z0-9_-]+/g, "_");
  const collapsed = replaced.replace(/[-_]{2,}/g, "_");
  const trimmed = collapsed.replace(/^[-_]+|[-_]+$/g, "");
  const limited = trimmed.slice(0, MAX_INTAKE_SEGMENT_LENGTH).replace(/^[-_]+|[-_]+$/g, "");
  return limited.length > 0 ? limited : UNKNOWN_INTAKE_SEGMENT;
}

/** 호출자가 ReportFileExtension 타입 계약을 어기고(런타임에 검증되지 않은
 * 문자열을 캐스팅해서 등) 앞에 점을 붙이거나 대문자를 섞어 넘기는 경우까지
 * 방어한다. 정상적인 타입 사용 시에는 그대로 통과한다. */
function normalizeExtension(extension: ReportFileExtension): ReportFileExtension {
  const lower = String(extension).trim().toLowerCase();
  const withoutLeadingDot = lower.startsWith(".") ? lower.slice(1) : lower;

  if (!(REPORT_FILE_EXTENSIONS as readonly string[]).includes(withoutLeadingDot)) {
    throw new RangeError(`지원하지 않는 보고서 확장자입니다: ${extension}`);
  }

  return withoutLeadingDot as ReportFileExtension;
}

const WINDOWS_INVALID_CHARS_PATTERN = /[<>:"/\\|?*\x00-\x1f]/g;

const WINDOWS_RESERVED_NAMES = new Set([
  "CON",
  "PRN",
  "AUX",
  "NUL",
  "COM1",
  "COM2",
  "COM3",
  "COM4",
  "COM5",
  "COM6",
  "COM7",
  "COM8",
  "COM9",
  "LPT1",
  "LPT2",
  "LPT3",
  "LPT4",
  "LPT5",
  "LPT6",
  "LPT7",
  "LPT8",
  "LPT9",
]);

/** 확장자를 뺀 파일명(base name)에 대한 Windows 안전성 방어선이다. 실제로는
 * prefix가 항상 "AS_Report_"로 시작하고 각 세그먼트가 이미 정제되어 있어
 * 이 단계에서 걸릴 일이 없어야 하지만, 향후 prefix 매핑이 바뀌는 등의
 * 변경에 대비한 마지막 안전망으로 둔다. */
function enforceWindowsSafeBaseName(baseName: string): string {
  const withoutInvalidChars = baseName.replace(WINDOWS_INVALID_CHARS_PATTERN, "_");
  const withoutTrailingDotsOrSpaces = withoutInvalidChars.replace(/[.\s]+$/g, "");
  const nonEmpty = withoutTrailingDotsOrSpaces.length > 0 ? withoutTrailingDotsOrSpaces : `${FILENAME_PREFIX}_${UNKNOWN_INTAKE_SEGMENT}`;

  return WINDOWS_RESERVED_NAMES.has(nonEmpty.toUpperCase()) ? `${nonEmpty}_R` : nonEmpty;
}

/** 확장자를 포함한 전체 길이가 MAX_FILENAME_LENGTH를 넘지 않도록 base name을
 * 뒤에서부터 자른다. 정상 입력에서는 절대 발동하지 않는 안전망이다(prefix +
 * intake 세그먼트 상한 + 고정 길이 타임스탬프를 더해도 100자를 넘지 않는다). */
function truncateBaseName(baseName: string, extension: ReportFileExtension): string {
  const maxBaseLength = MAX_FILENAME_LENGTH - extension.length - 1;
  if (baseName.length <= maxBaseLength) {
    return baseName;
  }

  const truncated = baseName.slice(0, maxBaseLength).replace(/[._-\s]+$/g, "");
  return truncated.length > 0 ? truncated : `${FILENAME_PREFIX}_${UNKNOWN_INTAKE_SEGMENT}`;
}

/**
 * 리포트 다운로드 파일명을 만든다: `AS_Report_{정제된 접수번호}_{YYYYMMDD}_{HHmmss}.{확장자}`
 * (예: `AS_Report_D260809_20260804_194200.pdf`).
 *
 * - 시각은 generatedAt을 한국 로컬 시각(Asia/Seoul)으로 변환해 쓴다. 같은
 *   generatedAt은 언제, 어떤 환경(브라우저/서버, 어떤 시스템 시간대)에서
 *   호출하든 항상 같은 결과를 낸다.
 * - generatedAt이 Date로 파싱되지 않으면 예외를 던지지 않고 고정 fallback
 *   세그먼트("19700101_000000")를 쓴다 — 상세: buildKstTimestampSegment 주석.
 * - intakeNumber는 A-Z/a-z/0-9/-/_ 만 남기고 나머지는 제거·치환하며, 그
 *   결과가 비면 "UNKNOWN"을 쓴다. 고객사/End-User 등 다른 개인정보성 값은
 *   이 함수에 넘기지 않는다.
 * - extension은 "pdf" | "xlsx"만 허용한다(다른 확장자는 RangeError).
 */
export function buildReportFilename(
  reportType: ReportType,
  intakeNumber: string,
  generatedAt: string,
  extension: ReportFileExtension
): string {
  const safeExtension = normalizeExtension(extension);
  const prefix = REPORT_TYPE_FILENAME_PREFIXES[reportType];
  const intakeSegment = sanitizeIntakeNumber(intakeNumber);
  const timestampSegment = buildKstTimestampSegment(generatedAt);

  const baseName = `${prefix}_${intakeSegment}_${timestampSegment}`;
  const safeBaseName = enforceWindowsSafeBaseName(baseName);
  const finalBaseName = truncateBaseName(safeBaseName, safeExtension);

  return `${finalBaseName}.${safeExtension}`;
}
