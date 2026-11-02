import type { ExecutionHistoryRow } from "@/lib/db/queries/procedure-case-execution";
import { procedureCaseExecutionActionTypeLabels } from "@/lib/domain/procedure-case-execution-types";
import { readJumpResetWorkMemo } from "@/lib/domain/procedure-execution-jump";

/**
 * Newest-first, append-only history — same read-only presentation convention as
 * DatabaseWorkflowHistoryList.
 *
 * 🔴 2026-11-02(조각 11)에 줄 하나가 늘었다 — **되돌리면서 비운 작업 메모**다.
 * 옮기기가 경로 밖의 완료를 대기로 되돌릴 때 그 노드를 「새로 밟는 것처럼」 비우는데
 * (사용자 결정), 같은 결정의 앞부분이 「이전 기록(메모 등)은 **실행 이력에
 * 남겠지만**」이다. 쓰기 쪽이 beforeState 에 옮겨 적어도 **여기서 안 그리면 남았다는
 * 말이 거짓**이 된다 — 사람이 쓴 글이 화면 어디에도 없게 된다.
 *
 * 🔵 JSON 칸을 화면에서 풀어 읽지 않는다. 무엇을 꺼낼지는 도메인 함수 하나가
 * 정한다(readJumpResetWorkMemo) — 표시 조건이 두 벌이 되지 않게.
 */
export default function ExecutionHistoryTimeline({ history }: { history: ExecutionHistoryRow[] }) {
  if (history.length === 0) {
    return <p className="text-sm text-zinc-500 dark:text-zinc-400">실행 이력이 없습니다.</p>;
  }

  return (
    <ol className="flex flex-col gap-2">
      {history.map((row) => {
        const clearedWorkMemo = readJumpResetWorkMemo(row.beforeState);
        return (
          <li key={row.id} className="rounded-md border border-zinc-200 p-2 text-xs dark:border-zinc-800">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium text-zinc-800 dark:text-zinc-200">
                {procedureCaseExecutionActionTypeLabels[row.actionType]}
              </span>
              <span className="text-zinc-500 dark:text-zinc-400">{new Date(row.createdAt).toLocaleString("ko-KR")}</span>
            </div>
            <div className="mt-1 text-zinc-500 dark:text-zinc-400">{row.actorName}</div>
            {row.reason && <div className="mt-1 text-zinc-600 dark:text-zinc-300">사유: {row.reason}</div>}
            {clearedWorkMemo && (
              // 🔵 줄바꿈을 지켜 그린다 — 작업 메모는 여러 줄로 적힌다(노드 카드의
              //    메모 칸과 같은 잣대). 이 자리가 그 글의 **마지막 집**이다.
              <div
                data-cleared-work-memo
                className="mt-1 whitespace-pre-wrap text-zinc-600 dark:text-zinc-300"
              >
                되돌리면서 지운 작업 메모: {clearedWorkMemo}
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
