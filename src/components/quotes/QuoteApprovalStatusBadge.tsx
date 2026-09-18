import type { QuoteApprovalState } from "@/lib/domain/quote-approval-rules";
import { QUOTE_APPROVAL_STATE_LABELS } from "./quote-approval-texts";

/**
 * 견적서 결재 상태 배지.
 *
 * 🔴 **`APPROVED` 와 `APPROVED_OUTDATED` 는 말도 색도 다르다.** 수리 건 쪽
 * 배지(repair-cases/approval/DatabaseApprovalStatusBadge)가 STALE 을 따로 둔
 * 것과 같은 이유다 — 전에는 그것도 「승인 완료」 초록으로 보였고, 그래서 화면과
 * 서버가 서로 다른 말을 했다. 견적서는 승인을 받은 **뒤에도 금액을 고칠 수
 * 있으므로**(발행이 막히지 않는다) 이 갈림이 더 자주 눈에 띈다.
 *
 * 색만으로 가르지 않는다 — 글자가 먼저 다르고 색은 거들 뿐이다. 색으로만
 * 갈라 두면 흑백 인쇄와 색각 이상에서 같은 배지가 된다.
 */
const baseBadgeClass =
  "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap";

const toneByState: Record<QuoteApprovalState, string> = {
  NOT_REQUESTED: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  PENDING: "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-400",
  APPROVED: "bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-400",
  // 🔴 초록이 아니다. 「승인됨」과 한눈에 갈라져야 하는 상태다.
  APPROVED_OUTDATED: "bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  REJECTED: "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-400",
};

export default function QuoteApprovalStatusBadge({ state }: { state: QuoteApprovalState }) {
  return (
    <span className={`${baseBadgeClass} ${toneByState[state]}`}>
      {QUOTE_APPROVAL_STATE_LABELS[state]}
    </span>
  );
}
