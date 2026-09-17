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
 * 옮길 때 값은 **데모 파일과 정확히 같았다.** 새로 만들거나 뺀 분류가 하나도
 * 없었다 — 그 단계는 저장 바닥을 놓는 일이지 분류 정책을 바꾸는 일이 아니었다.
 *
 * ── 데모 파일과의 관계 — 주인 전용 분류 셋만 다르다 ───────────────────────
 * 2026-09-13 SCREENSHOT(「스크린샷」)이 더해졌다. 이 분류는 **여기와 DB enum에만
 * 있고 데모 파일에는 없다.** 데모는 접수 건 파일 탭의 localStorage 화면이고, 데모
 * 계층(src/lib/domain/local/attachments/*)은 손대지 않는 것이 지금까지의
 * 규칙이다. 2026-09-15 견적서 첨부의 두 칸(SIGNED_QUOTE_PDF · QUOTE_EXCEL)도
 * 같은 까닭으로 데모에 없다. 그래서 attachment-category.test.ts 는 「데모 목록 =
 * 이 목록에서 그 셋을 뺀 것」을 순서까지 대조한다 — 다른 한 줄이라도 어긋나면
 * 여전히 걸린다.
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
  "IN_REPAIR",
  "AFTER_REPAIR",
  "SHIPMENT_PHOTO",
  "INSPECTION_REPORT",
  "REPAIR_REPORT",
  // 우리가 만들어 고객에게 보내는 문서끼리 모은 자리다(검사·수리 보고서 뒤).
  // 코드가 QUOTE 인 것은 이 저장소가 견적서를 그렇게 부르기 때문이고
  // (quotes 표·quote-*.ts), 견적서 기능 자체와는 아무 관계가 없다 — 여기 것은
  // 파일에 붙는 분류 이름 하나다.
  "QUOTE",
  "KYOSAN_DOCUMENT",
  "CUSTOMER_DOCUMENT",
  "OSCILLOSCOPE_DATA",
  "LOG_FILE",
  "FIRMWARE",
  "CIRCUIT_DIAGRAM",
  // 화면 사진(2026-09-13). 지금은 **어느 주인에게도 붙지 않는다**(아래
  // OWNERLESS_ATTACHMENT_CATEGORIES) — 값은 DB enum과 이미 저장된 행에 남아 있어
  // 지우지 않는다. 기타 **앞**에 둔다 — 기타는 언제나 목록의 맨 끝이다
  // (attachment-category.test.ts). 데모 파일(local/attachments/attachment-types.ts)에는
  // 없다 — 파일 헤더의 '데모 파일과의 관계' 참조.
  "SCREENSHOT",
  // 견적서(quotes)에 붙는 두 칸이다(2026-09-15) — 결재 사인이 들어간 PDF 와 손으로
  // 만든 엑셀 견적서. 둘 다 **견적서 주인 전용**이다(아래 isAttachmentCategoryAllowedForOwner).
  // 위 QUOTE(「견적서」)와는 다른 것이다 — 그쪽은 수리 건 파일 탭의 분류 이름이고 뜻을
  // 바꾸지 않는다. 기타 **앞**에 둔다(기타는 언제나 맨 끝). 데모 파일에는 없다.
  "SIGNED_QUOTE_PDF",
  "QUOTE_EXCEL",
  "OTHER",
] as const;

export type AttachmentCategory = (typeof ATTACHMENT_CATEGORY_CODES)[number];

export const attachmentCategoryLabels: Record<AttachmentCategory, string> = {
  INTAKE_PHOTO: "인수 사진",
  EXTERNAL_CONDITION: "외관 상태",
  IN_REPAIR: "수리 중",
  AFTER_REPAIR: "수리 후",
  SHIPMENT_PHOTO: "출하 사진",
  // 이름표만 '점검'에서 '검사'로 바꿨다. 코드(INSPECTION_REPORT)는 그대로다 —
  // 이미 올라간 파일들의 category 컬럼에 그 값이 적혀 있어서, 코드를 바꾸면
  // 그 파일들의 분류가 통째로 깨진다.
  INSPECTION_REPORT: "검사 보고서",
  REPAIR_REPORT: "수리 보고서",
  QUOTE: "견적서",
  KYOSAN_DOCUMENT: "교산 문서",
  CUSTOMER_DOCUMENT: "고객사 문서",
  OSCILLOSCOPE_DATA: "오실로스코프 데이터",
  LOG_FILE: "로그 파일",
  FIRMWARE: "펌웨어",
  CIRCUIT_DIAGRAM: "회로도",
  SCREENSHOT: "스크린샷",
  SIGNED_QUOTE_PDF: "결재 견적서 PDF",
  QUOTE_EXCEL: "수기 견적서 엑셀",
  OTHER: "기타",
};

export function isAttachmentCategory(value: string): value is AttachmentCategory {
  return (ATTACHMENT_CATEGORY_CODES as readonly string[]).includes(value);
}

/**
 * ── 분류는 주인을 가린다 ──────────────────────────────────────────────────
 * 첨부의 주인은 셋이다(schema/attachments.ts — 접수 건 · 제품 모델 · 견적서).
 * 분류 목록은 하나라서, 목록을 그대로 도는 화면·통로에는 모든 분류가 보이고
 * 받아진다. 주인마다 쓸 수 있는 분류를 여기 한 자리에서 정한다 — 접수 건·제품
 * 모델 파일 화면의 분류 선택지, 올리기 통로들의 거절, 그리고
 * createAttachmentRecord 의 마지막 방어선이 모두 이 함수를 본다. 규칙을 세 곳에
 * 따로 적으면 화면은 내놓는데 통로가 거절하는(또는 그 반대) 날이 온다.
 *
 * ── 셋째 주인 — 견적서 (2026-09-15) ────────────────────────────────────
 * 견적서(quotes)에 결재 사인이 들어간 PDF 와 손으로 만든 엑셀 견적서를 붙인다.
 * 견적서에는 SIGNED_QUOTE_PDF · QUOTE_EXCEL **둘만** 붙고, 그 둘은 **견적서에만**
 * 붙는다. 수리 건 파일 탭의 QUOTE(「견적서」) 분류는 이 짝과 관계없이 그대로
 * 수리 건 · 모델에 쓰인다(뜻을 바꾸지 않는다).
 */
export const ATTACHMENT_OWNER_KINDS = ["REPAIR_CASE", "PRODUCT_MODEL", "QUOTE"] as const;

export type AttachmentOwnerKind = (typeof ATTACHMENT_OWNER_KINDS)[number];

/**
 * 이제 어느 주인에게도 붙지 않는 분류. 걷어낸 기능이 쓰던 자리이고, 값 자체는
 * **지우지 않는다** — DB enum(attachment_category)에 남아 있고 이미 그 값으로
 * 저장된 행이 있다. 목록에서 값을 빼면 그 행들의 분류가 읽히지 않는다.
 * 새 파일이 이 분류로 들어오는 길만 아래 함수가 막는다.
 */
const OWNERLESS_ATTACHMENT_CATEGORIES: readonly AttachmentCategory[] = ["SCREENSHOT"];

/**
 * 견적서에 붙는 첨부의 칸 — **분류 하나가 칸 하나**이고, 칸마다 파일은 하나다
 * (2026-09-15 사용자: 견적서마다 결재 PDF 1개 + 엑셀 1개). 차례가 곧 화면의 칸 차례다.
 * 같은 칸에 새 파일을 올리면 앞의 파일을 바꾸는 것이 규칙이고(아래
 * quoteAttachmentIdsDisplacedBy), 실제로 바꾸는 통로는 다음 조각이 만든다.
 */
export const QUOTE_ATTACHMENT_SLOT_CATEGORIES = ["SIGNED_QUOTE_PDF", "QUOTE_EXCEL"] as const satisfies readonly AttachmentCategory[];

export type QuoteAttachmentSlotCategory = (typeof QUOTE_ATTACHMENT_SLOT_CATEGORIES)[number];

/** 한 견적서의 한 칸에 둘 수 있는 파일 수(휴지통에 있는 것은 세지 않는다). */
export const QUOTE_ATTACHMENT_FILES_PER_SLOT = 1;

export function isQuoteAttachmentSlotCategory(category: AttachmentCategory): category is QuoteAttachmentSlotCategory {
  return (QUOTE_ATTACHMENT_SLOT_CATEGORIES as readonly AttachmentCategory[]).includes(category);
}

/** 이 분류를 이 주인의 첨부에 쓸 수 있는가. */
export function isAttachmentCategoryAllowedForOwner(
  category: AttachmentCategory,
  ownerKind: AttachmentOwnerKind
): boolean {
  if (ownerKind === "QUOTE") return isQuoteAttachmentSlotCategory(category);
  // 접수 건 · 제품 모델 — 주인 없는 분류(스크린샷)와 견적서 전용 두 칸만 빠진다.
  return !OWNERLESS_ATTACHMENT_CATEGORIES.includes(category) && !isQuoteAttachmentSlotCategory(category);
}

/**
 * 견적서의 한 칸에 새 파일이 들어올 때 **밀려나는 기존 첨부의 ID** — 칸마다 파일 하나
 * 규칙(QUOTE_ATTACHMENT_FILES_PER_SLOT)을 순수하게 적은 것이다. 같은 칸(분류)에 있고
 * 휴지통에 없는 것만 밀려난다 — 다른 칸의 파일과 이미 지워진 파일은 그대로 둔다.
 * 부르는 쪽은 그 견적서의 첨부만 넘긴다. 밀려난 파일을 어떻게 치우는지(휴지통 · 감사)는
 * 다음 조각의 올리기 통로가 정한다.
 */
export function quoteAttachmentIdsDisplacedBy(
  existing: readonly { id: string; category: AttachmentCategory; isDeleted: boolean }[],
  incoming: QuoteAttachmentSlotCategory
): string[] {
  return existing.filter((item) => !item.isDeleted && item.category === incoming).map((item) => item.id);
}

/**
 * 견적서의 한 칸에 **지금 붙어 있는 파일** — 휴지통에 없고 그 칸(분류)인 것
 * (2026-09-15 Q2). 칸마다 하나라는 규칙은 올리기 통로가 지키므로(칸 교체) 보통은 많아야
 * 하나다. 규칙을 거치지 않은 행이 겹쳐 있으면 **가장 나중에 올린 것**을 고른다 — 사람이
 * 마지막으로 올린 파일이 그 칸의 파일이라는 뜻과 같다(시각이 같으면 id 로 가른다 —
 * 부를 때마다 같은 답을 내야 한다).
 *
 * 견적서 수정 화면의 칸 조회(queries/attachments.ts)와 견적서 받기의 파일 고르기
 * (api/quotes/[id]/xlsx/download-source.ts)가 이것 하나를 본다. 없으면 null.
 */
export function liveQuoteAttachmentInSlot<
  T extends { id: string; category: AttachmentCategory; isDeleted: boolean; uploadedAt: Date | string },
>(existing: readonly T[], slot: QuoteAttachmentSlotCategory): T | null {
  let picked: T | null = null;
  for (const item of existing) {
    if (item.isDeleted || item.category !== slot) continue;
    if (picked === null) {
      picked = item;
      continue;
    }
    const itemTime = new Date(item.uploadedAt).getTime();
    const pickedTime = new Date(picked.uploadedAt).getTime();
    if (itemTime > pickedTime || (itemTime === pickedTime && item.id > picked.id)) picked = item;
  }
  return picked;
}

/** 이 주인의 올리기 칸에 내놓을 분류 — ATTACHMENT_CATEGORY_CODES 의 차례 그대로. */
export function attachmentCategoriesForOwner(ownerKind: AttachmentOwnerKind): AttachmentCategory[] {
  return ATTACHMENT_CATEGORY_CODES.filter((code) => isAttachmentCategoryAllowedForOwner(code, ownerKind));
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
