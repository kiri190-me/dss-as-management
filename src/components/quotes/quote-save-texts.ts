import type { QuoteSaveOutcome } from "@/lib/domain/quote-save-outcome";

/**
 * ============================================================================
 * 🔴 견적서 [저장]이 끝난 뒤 **읽고 닫아야 하는 알림 둘** (2026-10-31)
 * ============================================================================
 * 저장이 지금까지와 다르게 끝나는 두 갈래에 붙는 말이다
 * (lib/domain/quote-save-outcome.ts 의 `UNCHANGED` · `APPROVAL_AUTO_REJECTED`).
 *
 * 🔴 **0.5초 뒤 사라지는 저장 팝업으로는 전할 수 없다.** 둘 다 사람이 모르고
 * 있던 사실을 알리는 글이고, 읽기 전에 사라지면 모르는 채로 넘어간다
 * (common/NoticePopup.tsx 머리말 — 이 저장소에서 실제로 겪은 일이다).
 *
 * ── 🔴 왜 quote-approval-texts.ts 가 아니라 **따로** 인가 ────────────────
 * 그 파일은 [견적서 결재] **탭이 그리는 말**의 자리이고, 수정 폼은 그 이름을
 * 하나도 물지 않기로 되어 있다 — 「편집 폼이 결재를 아예 모른다」가 시험으로
 * 못 박혀 있다(quote-approval-screen.test.tsx). 🔴 그 규율은 「발행이 결재
 * 상태에 잠기지 않는다」(2026-09-18 사용자 결정)를 지키는 울타리이므로, 글자
 * 두 줄을 두자고 느슨하게 만들지 않는다.
 *
 * 🔵 폼이 보는 것은 결재 상태가 아니라 **서버가 돌려준 낱말 하나**다. 그 낱말에
 * 붙는 말이므로 자리도 저장 쪽에 둔다.
 *
 * ── 🔴 이력에 남는 반려 사유와 **다른 글**이다 ──────────────────────────
 * 그쪽은 lib/domain/quote-approval-rules.ts 의
 * `QUOTE_APPROVAL_AUTO_REJECT_REASON` 이고, 종 알림의 「사유: …」로 **다른
 * 사람에게** 나간다. 이 글은 저장을 누른 그 사람이 그 자리에서 한 번 읽고 닫는
 * 말이다. 한 글자로 합치면 둘 중 하나를 고치는 일이 다른 하나를 말없이 바꾼다 —
 * lib/domain/quote-save-outcome.test.ts 가 둘이 다른 글자인지 본다.
 *
 * 🔴 이 파일은 **아무것도 물지 않는다** — `import type` 한 줄뿐이고 그것은
 * 컴파일 뒤에 사라진다(quote-approval-texts.ts 가 지키는 것과 같은 규약).
 * ============================================================================
 */

/**
 * 저장 결과 중 **읽고 닫아야 하는 알림이 붙는** 갈래들. 🔴 목록을 글자로 베껴
 * 적지 않는다 — 갈래가 하나 늘면 아래 두 표의 빠진 자리를 컴파일러가 바로 잡는다
 * (quoteSaveOutcomeNeedsNotice 와 같은 갈림).
 */
export type QuoteSaveNoticeKind = Exclude<QuoteSaveOutcome, "SAVED">;

/** 팝업의 머리. 🔴 `Record` 라 갈래가 늘면 빠진 자리가 컴파일에서 드러난다. */
export const QUOTE_SAVE_NOTICE_TITLES: Record<QuoteSaveNoticeKind, string> = {
  UNCHANGED: "바뀐 내용이 없습니다",
  APPROVAL_AUTO_REJECTED: "승인요청이 반려되었습니다",
};

/**
 * 팝업 본문 한 줄.
 *
 * 🔴 `APPROVAL_AUTO_REJECTED` 는 **사용자가 준 글자 그대로**다(2026-10-31 —
 * 「[견적서가 수정되었습니다. 승인요청이 반려되었습니다.] 라는 팝업이 뜨고」).
 * 다듬지 말 것.
 *
 * 🔵 `UNCHANGED` 는 「반려하지 않는다」는 결정을 사람에게 보이게 하는 말이다 —
 * 아무 말도 없으면 [저장]을 누른 사람은 저장이 된 줄 알고, 결재가 그대로인
 * 까닭을 설명할 길이 없다. 🔴 **「저장하지 않았습니다」가 참이어야 한다** —
 * 저장 경로가 그때 정말로 한 글자도 쓰지 않는다(lib/db/mutations/quotes.ts).
 */
export const QUOTE_SAVE_NOTICE_LINES: Record<QuoteSaveNoticeKind, string> = {
  UNCHANGED: "바뀐 내용이 없어 저장하지 않았습니다.",
  APPROVAL_AUTO_REJECTED: "견적서가 수정되었습니다. 승인요청이 반려되었습니다.",
};
