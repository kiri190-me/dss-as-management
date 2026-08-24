/**
 * ============================================================================
 * 첨부 파일 분류 — 화면과 DB가 함께 쓰는 단 하나의 목록
 * ============================================================================
 * 지금까지 이 목록은 데모 화면 전용 파일
 * (src/lib/domain/local/attachments/attachment-types.ts) 안에만 있었다. 그
 * 파일은 브라우저 localStorage에 메타데이터만 담는 "실제 저장 없음" 데모라,
 * 거기 있는 목록을 DB enum이 그대로 참조할 수는 없다 — 그 파일은 언제든
 * 데모가 걷히면서 사라질 수 있다.
 *
 * 그래서 실제 저장(attachments 테이블)이 기준으로 삼을 목록을 여기로 옮긴다.
 * 값은 **데모 파일과 정확히 같다.** 새로 만들거나 뺀 분류가 하나도 없다 —
 * 이번 단계는 저장 바닥을 놓는 일이지 분류 정책을 바꾸는 일이 아니다.
 *
 * ── 순수 파일이다 ─────────────────────────────────────────────────────────
 * server-only / drizzle / React 를 import 하지 않는다. DB 스키마
 * (src/lib/db/schema/attachments.ts)도 이 파일을 import 하지 않고 값을 그대로
 * 복제해 둔다 — 이 저장소의 스키마 레이어는 도메인 레이어를 import 하지 않는
 * 규칙이기 때문이다(repair-cases.ts의 billingTypeEnum/priorityEnum 주석 참조).
 * 대신 attachment-category.test.ts가 세 목록(여기 · 데모 파일 · DB enum)이
 * 어긋나지 않는지 검사한다.
 * ============================================================================
 */

export const ATTACHMENT_CATEGORY_CODES = [
  "INTAKE_PHOTO",
  "EXTERNAL_CONDITION",
  "INSPECTION_REPORT",
  "REPAIR_REPORT",
  "KYOSAN_DOCUMENT",
  "CUSTOMER_DOCUMENT",
  "OSCILLOSCOPE_DATA",
  "LOG_FILE",
  "FIRMWARE",
  "CIRCUIT_DIAGRAM",
  "OTHER",
] as const;

export type AttachmentCategory = (typeof ATTACHMENT_CATEGORY_CODES)[number];

export const attachmentCategoryLabels: Record<AttachmentCategory, string> = {
  INTAKE_PHOTO: "인수 사진",
  EXTERNAL_CONDITION: "외관 상태",
  INSPECTION_REPORT: "점검 보고서",
  REPAIR_REPORT: "수리 보고서",
  KYOSAN_DOCUMENT: "교산 문서",
  CUSTOMER_DOCUMENT: "고객사 문서",
  OSCILLOSCOPE_DATA: "오실로스코프 데이터",
  LOG_FILE: "로그 파일",
  FIRMWARE: "펌웨어",
  CIRCUIT_DIAGRAM: "회로도",
  OTHER: "기타",
};

export function isAttachmentCategory(value: string): value is AttachmentCategory {
  return (ATTACHMENT_CATEGORY_CODES as readonly string[]).includes(value);
}

/**
 * ── 악성코드 검사 상태 ────────────────────────────────────────────────────
 * 검사 엔진은 아직 없다. 이번 단계에서 만드는 것은 **상태를 적을 자리**뿐이고,
 * 모든 행은 NOT_SCANNED 로 시작한다.
 *
 * 자리를 지금 만들어 두는 이유: 나중에 엔진을 붙일 때 컬럼을 새로 만들면 이미
 * 저장된 파일 전부가 "검사한 적 있는지 없는지 알 수 없는" 상태가 된다. 처음부터
 * NOT_SCANNED 로 남겨 두면 그 파일들은 "검사 안 함"이 사실로 기록된 것이다.
 *
 * 데모 파일의 LocalMalwareScanStatus 와 값이 다르다(BLOCKED/ERROR 대신
 * INFECTED/FAILED). 데모 쪽 값을 따라가지 않은 것은 승인된 설계가
 * INFECTED/FAILED 이기 때문이고, 두 목록을 섞어 쓰지 않는다 — 데모는 데모대로
 * 남고 이 목록만 DB enum이 된다.
 */
export const MALWARE_SCAN_STATUS_CODES = [
  "NOT_SCANNED",
  "PENDING",
  "CLEAN",
  "INFECTED",
  "FAILED",
] as const;

export type MalwareScanStatus = (typeof MALWARE_SCAN_STATUS_CODES)[number];

export const malwareScanStatusLabels: Record<MalwareScanStatus, string> = {
  NOT_SCANNED: "미검사",
  PENDING: "검사 대기",
  CLEAN: "이상 없음",
  INFECTED: "감염 확인",
  FAILED: "검사 실패",
};

/** 새 첨부 행이 갖는 초기 검사 상태. DB 기본값과 같아야 한다. */
export const DEFAULT_MALWARE_SCAN_STATUS: MalwareScanStatus = "NOT_SCANNED";

export function isMalwareScanStatus(value: string): value is MalwareScanStatus {
  return (MALWARE_SCAN_STATUS_CODES as readonly string[]).includes(value);
}
