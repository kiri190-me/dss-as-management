import type { ReactNode } from "react";
import type {
  ExecutionHistoryFeed,
  ExecutionHistoryFeedRow,
  HistoryFeedNode,
} from "@/lib/domain/procedure-execution-history-feed";
import { procedureCaseExecutionNodeStatusLabels } from "@/lib/domain/procedure-case-execution-types";

/**
 * 「실행 이력」 — **시간순으로 쌓이는 한 목록**(2026-11-03, 조각 12).
 *
 * ──────────────────────────────────────────────────────────────────────
 * 무엇이 바뀌었나 (사용자 말 그대로)
 * ──────────────────────────────────────────────────────────────────────
 * 「[실행 이력]이 시간순서대로 누적될 수 있도록 해줘. 지금은 노드 번호대로
 *  정렬되어 있어.(이미 [완료]했던 노드에 다시 돌아오더라도 [실행 이력]이 남을 수
 *  있도록)」 · 「[시각 기록]을 없애줘.」
 *
 * 전에는 이 묶음 안에 둘이 있었다 — 노드 카드 목록(「완료 / 건너뜀」)과 시각
 * 기록(ExecutionHistoryTimeline). 카드 쪽은 **노드 행 하나당 한 장**이라 다시 밟은
 * 기록을 적을 자리가 없었고, 시각 기록은 그 일을 이미 시간순으로 적고 있었다.
 * 그래서 **이력 표 한 벌**로 합쳤다 — 줄마다 그때의 일을, 같은 노드가 여러 줄로.
 *
 * 🔴 **버린 것은 하나도 없다.** 카드가 가지고 있던 넷(작업 메모 · 최근 사유 ·
 * 시작/완료한 사람과 시각 · [재개(되돌림)])은 **그 작업의 가장 최근 줄**에 붙어
 * 있다(아래 footerNode). 어느 줄에 붙는지는 도메인이 정한다
 * (buildExecutionHistoryFeed) — 화면이 다시 고르면 단추가 두 줄에 뜨거나 한 줄도
 * 안 뜨는 날이 온다.
 *
 * 🔴 단추와 메모 칸은 **슬롯으로 받는다**(renderNodeActions). 둘 다 서버 액션을
 * 직접 부르는 부품이라, 이 묶음이 그것을 물면 그려서 재는 시험이 import 에서 바로
 * 던진다(「이 건의 다른 절차」의 renderRowAction 과 같은 수법).
 */
export default function ExecutionHistoryList({
  feed,
  renderNodeActions,
}: {
  feed: ExecutionHistoryFeed;
  /** 끝난 작업의 **가장 최근 줄**에 설 것 — 작업 메모 칸과 [재개(되돌림)]. */
  renderNodeActions: (node: HistoryFeedNode) => ReactNode;
}) {
  if (feed.totalCount === 0) {
    return <p className="text-sm text-zinc-500 dark:text-zinc-400">실행 이력이 없습니다.</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      {/* 🔵 차례와 **같은 작업이 여러 번 나오는 까닭**을 한 줄로 적는다. 안 적으면
          같은 이름이 거듭 뜨는 것을 「목록이 잘못됐다」로 읽는다 — 그것이 이
          목록의 요점인데도. */}
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        최근 것이 위입니다. 같은 작업이 여러 번 나올 수 있습니다 — 그 작업으로 다시 돌아온 기록입니다.
      </p>

      <ol className="flex flex-col gap-2">
        {feed.recent.map((row) => (
          <FeedRow key={row.id} row={row} renderNodeActions={renderNodeActions} />
        ))}
      </ol>

      {/* 🔴 오래된 줄은 **버리지 않고** 한 겹 더 접는다. 실측(2026-11-03)에서 한
          실행의 이력이 90줄이었고, 옮기기 한 번이 1 + N 줄을 적으므로 앞으로도
          는다. 몇 줄이 접혀 있는지는 줄에 적는다 — 적지 않으면 목록이 잘린 줄
          모른다. */}
      {feed.older.length > 0 && (
        <details data-history-older className="rounded-md border border-dashed border-zinc-300 dark:border-zinc-700">
          <summary className="cursor-pointer p-2 text-xs text-zinc-600 dark:text-zinc-400">
            더 오래된 {feed.older.length}줄 보기
          </summary>
          <ol className="flex flex-col gap-2 border-t border-zinc-200 p-2 dark:border-zinc-800">
            {feed.older.map((row) => (
              <FeedRow key={row.id} row={row} renderNodeActions={renderNodeActions} />
            ))}
          </ol>
        </details>
      )}
    </div>
  );
}

function FeedRow({
  row,
  renderNodeActions,
}: {
  row: ExecutionHistoryFeedRow;
  renderNodeActions: (node: HistoryFeedNode) => ReactNode;
}) {
  return (
    <li data-history-row className="rounded-md border border-zinc-200 p-2 text-xs dark:border-zinc-800">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium text-zinc-800 dark:text-zinc-200">
          {row.task === null ? (
            // 노드에 안 붙은 줄 — 실행을 시작하거나 다시 이은 기록이다.
            "이 실행"
          ) : (
            <>
              {row.task.orderIndex > 0 && <span className="tabular-nums">{row.task.orderIndex}. </span>}
              {row.task.title}
            </>
          )}
        </span>
        <span className="text-zinc-500 dark:text-zinc-400">
          {/* 🔴 시각을 **지어내지 않는다** — 모르는 줄은 그렇다고 적는다(도메인의
              syntheticRow 주석). 「시각 모름」이 「방금」으로 읽히면 안 된다. */}
          {row.createdAt === null ? "시각 모름" : new Date(row.createdAt).toLocaleString("ko-KR")}
        </span>
      </div>

      <div className="mt-1 text-zinc-600 dark:text-zinc-300">
        <span className="font-medium">{row.actionLabel}</span>
        <span className="text-zinc-500 dark:text-zinc-400"> · {row.actorName}</span>
      </div>

      {row.via && <div className="mt-1 text-zinc-500 dark:text-zinc-400">{row.via}</div>}

      {row.notes.map((note) => (
        <div
          key={note.kind}
          // 🔵 조각 11 이 더한 「되돌리면서 지운 작업 메모」 줄의 표식은 그대로
          //    둔다 — 그 글이 화면에 **정말로** 그려지는지를 시험이 이것으로 잰다.
          data-cleared-work-memo={note.kind === "CLEARED_MEMO" ? "" : undefined}
          className="mt-1 whitespace-pre-wrap text-zinc-600 dark:text-zinc-300"
        >
          {note.label}: {note.text}
        </div>
      ))}

      {row.footerNode && (
        // 🔴 **그 작업의 지금 모습**이 여기 선다 — 전에 완료·건너뜀 카드가 적던
        //    것 그대로(담당 · 시작 · 완료 · 최근 사유)와, 작업 메모 칸 · [재개
        //    (되돌림)]. 줄 하나에만 붙으므로 같은 작업에 단추가 여럿 뜨지 않는다.
        <div
          data-history-node-footer
          className="mt-2 flex flex-col gap-2 border-t border-dashed border-zinc-300 pt-2 dark:border-zinc-700"
        >
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-zinc-500 dark:text-zinc-400">
            <span>지금 상태: {procedureCaseExecutionNodeStatusLabels[row.footerNode.status]}</span>
            {row.footerNode.effectiveAssigneeName && <span>담당: {row.footerNode.effectiveAssigneeName}</span>}
            {row.footerNode.startedAt && (
              <span>
                시작: {row.footerNode.startedByName} / {new Date(row.footerNode.startedAt).toLocaleString("ko-KR")}
              </span>
            )}
            {row.footerNode.completedAt && (
              <span>
                완료: {row.footerNode.completedByName} / {new Date(row.footerNode.completedAt).toLocaleString("ko-KR")}
              </span>
            )}
            {row.footerNode.lastActionReason && <span>최근 사유: {row.footerNode.lastActionReason}</span>}
          </div>
          {renderNodeActions(row.footerNode)}
        </div>
      )}
    </li>
  );
}
