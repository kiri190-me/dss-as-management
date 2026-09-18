import type { QuoteApprovalState } from "@/lib/domain/quote-approval-rules";

/**
 * ============================================================================
 * 견적서 결재 화면의 **말**
 * ============================================================================
 * 「견적서 결재」 탭이 그리는 문장을 한곳에 모은다. 배지·안내 상자·확인 창이
 * 같은 상태를 서로 다른 말로 부르면 사람은 어느 쪽이 맞는지 알 수 없다
 * (repair-cases/approval/approval-texts.ts 가 승인 화면에서 지키는 것과 같은
 * 규약이다).
 *
 * 🔴 이 파일은 **아무것도 물지 않는다** — `import type` 한 줄뿐이고 그것은
 * 컴파일 뒤에 사라진다. 클라이언트 경계 지시문("use client")도, 서버 전용
 * 표시를 타는 모듈도, 화면 라이브러리도 부르지 않는다. 그래야 화면 시험이
 * `server-only` 사슬에 걸리지 않고 이 문구들을 그대로 읽어 볼 수 있다.
 *
 * 🔴 여기에는 **문자열만** 둔다. 판정이나 서식이 끼어들면 이 파일이 무언가를
 * 부르게 되고, 위의 약속이 그대로 깨진다.
 * ============================================================================
 */

/**
 * 상태 한 마디. 🔴 **`APPROVED` 와 `APPROVED_OUTDATED` 는 서로 다른 말이어야
 * 한다.** 그 갈림이 이 상태가 존재하는 이유다 — 승인을 받은 뒤 금액을 고쳐도
 * 「승인 완료」가 그대로 남아 보이는 일을 막으려고 서버가 굳이 둘로 나눠 답한다
 * (domain/quote-approval-rules.ts 의 resolveQuoteApprovalState).
 *
 * 🔴 **Record 로 둔다** — 상태가 하나 늘면 빠진 자리를 컴파일러가 바로 잡는다.
 */
export const QUOTE_APPROVAL_STATE_LABELS: Record<QuoteApprovalState, string> = {
  NOT_REQUESTED: "결재 전",
  PENDING: "결재 진행 중",
  APPROVED: "승인 완료",
  APPROVED_OUTDATED: "재승인 필요",
  REJECTED: "반려",
};

/** 배지 옆에 붙는 한 줄 — 「그래서 지금 무슨 뜻인가」. */
export const QUOTE_APPROVAL_STATE_DESCRIPTIONS: Record<QuoteApprovalState, string> = {
  NOT_REQUESTED: "아직 결재를 올리지 않았습니다.",
  PENDING: "결재를 기다리고 있습니다.",
  APPROVED: "지금 이 내용 그대로 승인되었습니다.",
  APPROVED_OUTDATED: "승인을 받은 뒤 견적서 내용이 바뀌었습니다.",
  REJECTED: "반려되었습니다. 내용을 고쳐 다시 올릴 수 있습니다.",
};

/**
 * 🔴 `APPROVED_OUTDATED` 일 때 상태 상자 안에 크게 적는 말.
 *
 * 배지 글자(「재승인 필요」)만으로는 **왜** 그런지가 남지 않는다. 이 문장이
 * 하는 일은 「지난 승인이 무효가 됐다」와 「그래서 무엇을 해야 하는가」를 한
 * 번에 말하는 것이다 — 승인 기록 자체는 이력에 그대로 남아 있으므로, 이 말이
 * 없으면 이력의 「승인」 줄을 보고 아직 승인이 살아 있다고 읽게 된다.
 */
export const QUOTE_APPROVAL_OUTDATED_NOTICE =
  "승인 이후 견적서가 수정되어 그 승인은 지금 내용에 대한 것이 아닙니다. 다시 결재를 올려 주세요.";

/**
 * 🔴 결재선이 없을 때(`ROUTE_NOT_CONFIGURED`) 「무엇을 해야 하는가」.
 *
 * 서버는 요청을 거절하면서 이유를 한 줄 돌려주지만(mutations/quote-approvals.ts),
 * 화면은 **누르기 전에** 말해 줘야 한다 — 누를 수 없는 단추를 두고 눌러 봐야
 * 알게 하는 것은 이 저장소의 방식이 아니다. 「실패했습니다」로 끝내지 않고 고칠
 * 자리(사용자 관리 > 승인 절차)와 고칠 사람(최고관리자·관리자)을 함께 적는다.
 *
 * 🔴 절차가 비어 있어도 **견적서 발행은 그대로 된다**는 사실을 같은 문단에
 * 적는다. 그 말이 없으면 이 안내가 「발행이 막혔다」로 읽힌다 —
 * domain/shipment-approval-route.ts 의 SHIPMENT_APPROVAL_ROUTE_EMPTY_NOTICES.QUOTE
 * 가 관리자 화면에서 같은 사실을 말한다.
 */
export const QUOTE_APPROVAL_ROUTE_MISSING_NOTICE =
  "견적서 승인 절차(결재선)가 아직 없어 결재를 올릴 수 없습니다. 최고관리자·관리자가 [사용자 관리 > 승인 절차]에서 용도를 「견적서 승인」으로 고르고 결재할 사람을 순서대로 넣어 저장하면 이 자리에서 결재를 올릴 수 있습니다. 절차가 없는 동안에도 견적서 발행은 그대로 됩니다 — 승인 기록만 남지 않습니다.";

/**
 * 🔴 **결재는 발행을 막지 않는다**(2026-09-18 사용자 결정). 이 탭에 온 사람이
 * 가장 먼저 오해하는 것이 그것이라 맨 위에 한 줄로 적어 둔다. 서버 쪽 세 파일
 * (actions · mutations · queries)의 머리말이 같은 말을 코드 쪽에 적어 두고,
 * 이 문장은 그것을 사람 쪽에 적은 것이다.
 */
export const QUOTE_APPROVAL_DOES_NOT_BLOCK_ISSUE_NOTICE =
  "결재는 「누가 언제 승인했나」를 남기는 기록입니다. 결재 상태와 상관없이 견적서는 [견적서 수정] 탭에서 그대로 발행할 수 있습니다.";

/** 반려 사유 칸이 비어 있을 때 창 안에 뜨는 말. 🔴 서버도 같은 이유로 거절한다. */
export const QUOTE_APPROVAL_REASON_REQUIRED_MESSAGE = "반려 사유를 입력해 주세요.";

/** 결재 이력이 한 줄도 없을 때. */
export const QUOTE_APPROVAL_EMPTY_HISTORY_TEXT = "아직 결재 기록이 없습니다.";
