import { QuoteIssueNoticeLines } from "./QuoteIssueButton";
import type { QuoteIssueNoticeLine } from "./quote-issue-messages";

/**
 * ============================================================================
 * [저장] 뒤 PDF 변환 결과 한 칸 (2026-10-08)
 * ============================================================================
 * 흐름은 quote-save-pdf-convert.ts 가 값으로 끝내고, 이 조각은 **그 줄을 그리기만** 한다.
 * 줄 자체는 결재 PDF · [폴더 열기]가 쓰는 조각(QuoteIssueNoticeLines)을 그대로 쓴다.
 *
 * ── 🔴 두 가지 꼴 ────────────────────────────────────────────────────────
 *  · **도는 중**(`busy`) — 흐릿한 칸. 사람이 「저장이 안 끝났나」 하고 다시 누르지 않게
 *    「저장은 끝났고 지금은 PDF 를 만드는 중」이라고 적는다.
 *  · **끝남** — 노란 칸. 🔴 **저장은 이미 끝났다**는 것이 첫 줄에 있고(흐름이 넣는다),
 *    곁에 [목록으로]를 둔다 — 못 올린 첨부를 알릴 때와 **같은 모양**이다(QuoteEditForm).
 *
 * 🔴 줄에는 경로도 파일 이름도 없다 — 넣는 쪽(흐름)이 지키고, 그 시험이 글자로 못 박는다.
 * ============================================================================
 */

/** 도는 중에 보이는 한 줄. 🔴 **저장은 끝났다**가 먼저다. */
export const QUOTE_SAVE_PDF_RUNNING_TEXT = "견적서는 저장되었습니다 — 엑셀을 PDF 로 바꾸는 중입니다…";

export default function QuoteSavePdfNotice({
  lines,
  busy = false,
  onLeave,
  leaveLabel = "목록으로",
}: {
  lines: readonly QuoteIssueNoticeLine[];
  /** 아직 도는 중인가 — 그때는 [목록으로]를 내지 않는다(변환이 끝나지 않았다). */
  busy?: boolean;
  /** 있으면 곁에 단추를 그린다. 없으면 줄만 그린다. */
  onLeave?: () => void;
  leaveLabel?: string;
}) {
  if (lines.length === 0) return null;
  return (
    <div
      className={
        busy
          ? "rounded-md border border-zinc-300 bg-zinc-50 p-3 text-sm text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
          : "rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200"
      }
    >
      <QuoteIssueNoticeLines lines={lines} />
      {!busy && onLeave && (
        <button
          type="button"
          onClick={onLeave}
          className="mt-2 rounded-md border border-amber-400 px-2 py-1 text-xs dark:border-amber-700"
        >
          {leaveLabel}
        </button>
      )}
    </div>
  );
}
