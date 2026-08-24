import type { AttachmentCategory } from "./attachment-category";

/**
 * ============================================================================
 * 첨부 목록 거르기 — 종류·분류·이름
 * ============================================================================
 * 한 접수 건에 사진과 문서가 섞여 쌓인다. 파형 사진을 찾는데 견적서와 로그
 * 파일이 사이에 끼어 있으면 눈으로 훑어야 한다.
 *
 * ── 두 가지 "분류"가 있다 ────────────────────────────────────────────────
 *  - **종류**: 사진인가 문서인가. 화면에서 그대로 볼 수 있는지가 갈린다.
 *  - **분류**: 인수 사진·회로도·펌웨어… 업무상의 갈래(attachment-category.ts).
 *
 * 이름이 비슷해 헷갈리기 쉬워 여기서 갈라 둔다. 화면도 두 칸으로 나눠 보여 준다.
 *
 * ── 종류는 MIME으로 정한다 ───────────────────────────────────────────────
 * 확장자가 아니라 저장된 mime_type을 본다. 업로드할 때 서버가 파일 앞머리를
 * 실제로 읽어 확인한 값이라(업로드 라우트), 이름만 바꾼 파일에 속지 않는다.
 *
 * "사진"의 범위는 **화면에서 그대로 볼 수 있는 것**과 같다(JPG·PNG). 크게 보기와
 * 줄여서 받기가 그 범위에서만 되므로, 목록에서 "사진"으로 걸러 낸 것이 곧 그
 * 기능들을 쓸 수 있는 것이 된다 — 걸러 놓고 눌렀는데 안 되는 일이 없다.
 * ============================================================================
 */

export type AttachmentKind = "image" | "file";

export const ATTACHMENT_KIND_LABELS: Record<AttachmentKind, string> = {
  image: "사진",
  file: "문서",
};

/** 화면에서 그대로 볼 수 있는 형식 — 서버의 inline 허용 목록과 같은 범위다. */
export function attachmentKindOf(mimeType: string): AttachmentKind {
  return mimeType === "image/jpeg" || mimeType === "image/png" ? "image" : "file";
}

export type AttachmentListFilters = {
  kind: AttachmentKind | "all";
  category: AttachmentCategory | "all";
  /** 파일명과 설명에서 찾는다. 앞뒤 공백은 무시한다. */
  query: string;
};

export const DEFAULT_ATTACHMENT_LIST_FILTERS: AttachmentListFilters = {
  kind: "all",
  category: "all",
  query: "",
};

/** 거르는 데 필요한 것만 요구한다 — 목록 항목의 나머지 필드와 무관하게 쓸 수 있다. */
type Filterable = {
  mimeType: string;
  category: AttachmentCategory;
  originalFileName: string;
  description: string | null;
};

export function applyAttachmentListFilters<T extends Filterable>(
  items: readonly T[],
  filters: AttachmentListFilters
): T[] {
  const query = filters.query.trim().toLowerCase();

  return items.filter((item) => {
    if (filters.kind !== "all" && attachmentKindOf(item.mimeType) !== filters.kind) return false;
    if (filters.category !== "all" && item.category !== filters.category) return false;
    if (query.length === 0) return true;

    // 설명까지 함께 찾는다 — "반입 당시 전면 패널"처럼 적어 둔 말로 찾는 것이
    // 파일명보다 빠른 경우가 많다(폰이 붙인 이름은 기억에 남지 않는다).
    const haystack = `${item.originalFileName} ${item.description ?? ""}`.toLowerCase();
    return haystack.includes(query);
  });
}

/** 거르는 조건이 하나라도 켜져 있는가 — 화면이 "조건 지우기"를 보일지 정한다. */
export function hasActiveFilters(filters: AttachmentListFilters): boolean {
  return filters.kind !== "all" || filters.category !== "all" || filters.query.trim().length > 0;
}

/** 종류별로 몇 건인지 — 거르기 칸에 숫자를 함께 보여 주기 위한 것이다. */
export function countByKind<T extends Filterable>(
  items: readonly T[]
): Record<AttachmentKind, number> {
  const counts: Record<AttachmentKind, number> = { image: 0, file: 0 };
  for (const item of items) {
    counts[attachmentKindOf(item.mimeType)] += 1;
  }
  return counts;
}
