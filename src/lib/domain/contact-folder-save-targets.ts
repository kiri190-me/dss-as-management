import { attachmentCategoryLabels, type AttachmentCategory } from "./attachment-category";
import { CONTACT_FOLDER_COMMON_FOLDER_NAME } from "./contact-folder-naming";

/**
 * ============================================================================
 * [연락서 폴더에 저장] — **어느 폴더에 넣을 것인가** (2026-11-18)
 * ============================================================================
 * 수리 건 상세 「파일 관리」의 [그 종류 공통 서류] · [이 제품 모델 전용 서류] 구역에서
 * 한 줄의 [연락서 폴더에 저장]을 누르면, 2026-10-08 부터 **곧바로 `공통` 에** 꽂혔다.
 * 2026-11-18 사용자 결정으로 그 사이에 **고르는 창**이 하나 들어간다 — 사람이 넣을 폴더를
 * 고른 뒤에 꽂는다.
 *
 * ── 🔴 고를 거리는 **「공통」 + 서류 분류 열둘**이다 ──────────────────────
 * 분류 스물셋(domain/attachment-category.ts) 전부를 내놓지 않는다. 사용자가 세 안 중에서
 * 「공통 + 서류 분류만」을 골랐다(2026-11-18):
 *  · **사진 분류 다섯**(인수 사진 · 외관 상태 · 수리 중 · 수리 후 · 출하 사진)과
 *    **데이터류 넷**(오실로스코프 데이터 · 로그 파일 · 펌웨어 · 파라미터), 그리고
 *    스크린샷 · 통전검사는 **뺀다.**
 *  · 까닭은 **부르는 자리**다 — 이 단추는 [공통서류] · [전용서류] 구역에서만 서고, 그 줄이
 *    가리키는 것은 점검표 · 회로도 같은 **서류**다. 사진 분류를 섞으면 목록이 스물셋이 되어
 *    사람이 고르기 어렵고, 실제로 고를 일이 없는 칸이 대부분을 차지한다.
 *
 * 🔴 **빠진 분류가 사라진 것은 아니다.** 올리기 통로는 여전히 분류 스물셋을 다 받고
 * (isAttachmentCategoryAllowedForOwner), 그쪽으로 올린 파일은 그대로 제 분류 폴더로 간다.
 * 여기서 좁힌 것은 **이 단추가 내미는 선택지**뿐이다.
 *
 * ── 🔴 보일 글자를 여기 적지 않는다 ─────────────────────────────────────
 * 이름표는 domain/attachment-category.ts 의 `attachmentCategoryLabels` 한 자리에만 있다.
 * 베껴 적으면 이름표가 바뀌는 날 **이 창만 옛 글자**로 남고, 그 어긋남은 오류 없이 화면에서만
 * 드러난다. 여기서 새로 정하는 것은 **고를 코드 열둘과 그 차례**뿐이다.
 *
 * ── 🔴 차례는 전체 분류 목록의 차례 그대로다 ────────────────────────────
 * 손으로 적되 `ATTACHMENT_CATEGORY_CODES` 를 거른 결과와 **같아야 한다**(아래 시험이 잰다).
 * 그래야 「기타는 언제나 맨 끝」 같은 그 목록의 규율이 이 창에서도 지켜지고, 올리기 칸의
 * 차례와 이 창의 차례가 갈라지지 않는다.
 *
 * ── 🔴 서버도 이 목록을 **제 손으로** 본다 ──────────────────────────────
 * 고른 값은 브라우저가 보낸다 — 주소는 아무 웹페이지나 만든다. 「화면에서 열둘만 보여
 * 주니까」는 울타리가 아니므로, 통로가 아래 readContactFolderSaveTarget 으로 다시 가른다
 * (app/api/repair-cases/[id]/share-docs/contact-folder/route.ts).
 *
 * 순수 파일이다 — server-only · React · drizzle 을 물지 않는다(창과 통로가 함께 쓴다).
 * ============================================================================
 */

/**
 * 고를 수 있는 **서류 분류 열둘**. 차례가 곧 창에 서는 차례다(위 머리말).
 *
 * 🔴 `공통` 은 여기 없다 — 분류가 아니라 **지금까지의 자리**이고, 고르는 창에서는 맨 위에
 * 따로 선다(아래 CONTACT_FOLDER_SAVE_TARGET_OPTIONS).
 */
export const CONTACT_FOLDER_SAVE_TARGET_CATEGORIES = [
  "INSPECTION_REPORT",
  "REPAIR_REPORT",
  "QUOTE",
  "KYOSAN_DOCUMENT",
  "CUSTOMER_DOCUMENT",
  "CIRCUIT_DIAGRAM",
  "SIGNED_QUOTE_PDF",
  "QUOTE_EXCEL",
  "CHECKLIST",
  "PASS_SLIP",
  "REPAIR_REQUEST",
  "OTHER",
] as const satisfies readonly AttachmentCategory[];

export type ContactFolderSaveTargetCategory = (typeof CONTACT_FOLDER_SAVE_TARGET_CATEGORIES)[number];

/** 이 값이 고를 수 있는 분류인가. 🔴 **통로가 쓰는 울타리**다(화면이 아니라). */
export function isContactFolderSaveTargetCategory(value: string): value is ContactFolderSaveTargetCategory {
  return (CONTACT_FOLDER_SAVE_TARGET_CATEGORIES as readonly string[]).includes(value);
}

/**
 * 창에서 `공통` 칸이 쓰는 값. 🔴 **분류 코드가 아니다** — 분류 목록에 없는 글자여야 한다
 * (아래 시험이 겹치지 않는지 잰다). 화면은 `공통` 일 때 통로에 이 값을 **보내지 않는다**
 * (주소가 2026-10-08 과 한 글자도 달라지지 않게). 그래도 통로는 이 값을 받아 주는데,
 * 나중에 화면이 명시적으로 보내게 바뀌어도 조용히 400 이 되지 않게 하려는 것이다.
 */
export const CONTACT_FOLDER_SAVE_TARGET_COMMON_VALUE = "COMMON";

export type ContactFolderSaveTargetOption = {
  /** 라디오의 값 — 분류 코드이거나 `공통` 의 값이다. */
  value: string;
  /** 사람이 보는 글자. 🔴 이름표 표에서 그대로 온다(여기서 짓지 않는다). */
  label: string;
  /** 🔴 `null` 이면 `공통` — 지금까지의 자리이고, 창의 **기본 선택**이다. */
  category: ContactFolderSaveTargetCategory | null;
};

/**
 * 창에 서는 **열셋**: 맨 위가 `공통`(기본 선택), 그 뒤로 서류 분류 열둘.
 *
 * 🔴 `공통` 의 글자도 베끼지 않는다 — 폴더 이름을 정한 상수를 그대로 쓴다
 * (domain/contact-folder-naming.ts 의 CONTACT_FOLDER_COMMON_FOLDER_NAME). 사람이 탐색기에서
 * 보게 될 폴더 이름과 창의 글자가 같아야 한다.
 */
export const CONTACT_FOLDER_SAVE_TARGET_OPTIONS: readonly ContactFolderSaveTargetOption[] = [
  { value: CONTACT_FOLDER_SAVE_TARGET_COMMON_VALUE, label: CONTACT_FOLDER_COMMON_FOLDER_NAME, category: null },
  ...CONTACT_FOLDER_SAVE_TARGET_CATEGORIES.map((category) => ({
    value: category,
    label: attachmentCategoryLabels[category],
    category,
  })),
];

/**
 * 고른 자리의 **폴더 이름** — 화면이 「어디에 넣었는가」를 말할 때 쓴다.
 *
 * 🔴 분류 쪽은 이름표 그대로이고, 서버가 만드는 폴더 이름도 같은 이름표에서 나온다
 * (contactFolderCategoryFolderName 이 그 이름표를 다듬는다). 열둘이 다듬기를 지나도 글자가
 * 바뀌지 않는다는 사실은 아래 시험이 **둘을 맞대어** 재므로, 금지 글자가 섞인 이름표가
 * 생기는 날 조용히 어긋나지 않고 시험이 걸린다.
 */
export function contactFolderSaveTargetLabel(category: ContactFolderSaveTargetCategory | null): string {
  return category === null ? CONTACT_FOLDER_COMMON_FOLDER_NAME : attachmentCategoryLabels[category];
}

/** 통로가 받은 값을 가른 결과. 🔴 `null` 은 **거절**이다(「공통」이 아니다). */
export type ContactFolderSaveTarget =
  | { kind: "common" }
  | { kind: "category"; category: ContactFolderSaveTargetCategory };

/**
 * 통로가 받은 `?category=` 를 가른다. **던지지 않는다.**
 *
 *  · 칸이 아예 없거나 빈 글자 → 🔴 **`공통`**. 2026-10-08 부터의 동작 그대로다 — 아무것도
 *    고르지 않은 사람에게 예전과 다른 일이 일어나면 안 된다.
 *  · 창의 `공통` 값 → 같은 자리(위 상수 주석).
 *  · 고를 수 있는 분류 열둘 → 그 분류.
 *  · 그 밖의 모든 것(사진 분류 · 없는 코드 · 소문자 · 폴더 이름) → **null = 거절.**
 *    🔴 「모르면 공통」으로 삼키지 않는다 — 삼키면 틀린 값을 보낸 쪽이 그 사실을 영영
 *    모르고, 사람은 고른 적 없는 폴더에서 파일을 찾게 된다.
 */
export function readContactFolderSaveTarget(value: string | null | undefined): ContactFolderSaveTarget | null {
  const picked = typeof value === "string" ? value.trim() : "";
  if (picked === "" || picked === CONTACT_FOLDER_SAVE_TARGET_COMMON_VALUE) return { kind: "common" };
  return isContactFolderSaveTargetCategory(picked) ? { kind: "category", category: picked } : null;
}
