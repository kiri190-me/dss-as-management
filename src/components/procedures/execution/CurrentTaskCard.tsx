"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import ReasonPromptDialog from "./ReasonPromptDialog";
import ExecutionMemoField from "./ExecutionMemoField";
import {
  startExecutionNodeAction,
  completeExecutionNodeAction,
  skipExecutionNodeAction,
  blockExecutionNodeAction,
} from "@/lib/server/actions/procedure-case-execution";
import type { ExecutionNodeDetail } from "@/lib/db/queries/procedure-case-execution";
import { procedureCaseExecutionNodeStatusLabels } from "@/lib/domain/procedure-case-execution-types";
import { procedureNodeTypeLabels } from "@/lib/domain/procedure-template-types";
import { formatBranchChoiceLabel } from "./execution-branch-choice";
import { isOrdinaryActionEligible, type ExecutionActor } from "./execution-node-eligibility";

/**
 * 「지금 할 일」 한 장. 아래 네 구역 목록 위에 크게 선다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 무엇이 아팠는가 (2026-11-02 실제 화면 실측)
 * ──────────────────────────────────────────────────────────────────────
 *  1. 카드 22장이 **전부 「대기」 + 「추천」**으로 똑같이 생겨서 어디서부터
 *     할지 알 수 없었다.
 *  2. [시작]을 누르면 그 카드가 「실행 가능」에서 「진행 중」 구역으로 옮겨가
 *     **목록에서 사라졌다.** 방금 시작한 일을 다시 찾아야 했다.
 *  3. 🔴 노드에 **제목만** 보이고 `instructions`(무엇을 어떻게 하는지)가
 *     화면에 없었다. 작은 카드도 지시문을 그리기는 하지만 11px 회색 글자라
 *     읽히지 않았다 — 여기서는 본문 크기로 **펼쳐서** 보여 준다.
 *  4. 판단 노드는 [완료]를 눌러야 갈래 창이 떴다. 여기서는 **갈래 단추가
 *     처음부터 보인다** — 고르는 것이 곧 완료다.
 *
 * 어느 노드를 띄울지는 이 컴포넌트가 정하지 않는다. 고르는 규칙은
 * `@/lib/domain/procedure-execution-focus` 의 pickCurrentTask 에 있고, 화면은
 * 받은 하나를 그리기만 한다.
 *
 * 단추가 부르는 곳은 작은 카드(ExecutionNodeCard)와 **같은 서버 액션**이다.
 * 새 통로를 만들지 않았다 — 통로가 둘이면 권한·동시성 검사도 둘이 된다.
 */
export default function CurrentTaskCard({
  node,
  actingUser,
}: {
  node: ExecutionNodeDetail;
  actingUser: ExecutionActor;
}) {
  const router = useRouter();
  const [dialogState, setDialogState] = useState<"SKIP" | "BLOCK" | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // 판정은 작은 카드와 한 곳에서 나온다(execution-node-eligibility.ts).
  // 서버가 같은 모양으로 다시 검사하므로 이것은 화면 편의일 뿐이다.
  const eligible = isOrdinaryActionEligible(actingUser, node.effectiveAssigneeId);

  const isDecision = node.nodeType === "DECISION";
  // 🔴 판단인데 갈래가 하나도 안 그려진 노드가 실제로 있다 — 게시된 절차 하나가
  // 노드 23개에 간선 8개뿐인 「그리다 만」 상태다. 그런 노드는 [완료]를 눌러도
  // 서버가 DECISION_SELECTION_REQUIRED 로 거절하므로, 눌리지 않는 단추를
  // 그리는 대신 **왜 완료할 수 없는지**를 적는다.
  const decisionHasNoBranch = isDecision && node.outgoingEdgeOptions.length === 0;

  async function runAction<T extends { ok: boolean; message?: string }>(run: () => Promise<T>) {
    setIsSubmitting(true);
    setErrorMessage(null);
    const result = await run();
    setIsSubmitting(false);
    if (!result.ok) {
      setErrorMessage("message" in result ? (result.message as string) : "처리에 실패했습니다.");
      return;
    }
    setDialogState(null);
    router.refresh();
  }

  function handleStart() {
    void runAction(() => startExecutionNodeAction({ executionNodeId: node.id, expectedVersion: node.version }));
  }

  function handleComplete() {
    void runAction(() => completeExecutionNodeAction({ executionNodeId: node.id, expectedVersion: node.version }));
  }

  function handleBranchComplete(selectedOutgoingEdgeId: string) {
    void runAction(() =>
      completeExecutionNodeAction({ executionNodeId: node.id, expectedVersion: node.version, selectedOutgoingEdgeId })
    );
  }

  function handleSkipConfirm(reason: string) {
    void runAction(() => skipExecutionNodeAction({ executionNodeId: node.id, expectedVersion: node.version, reason }));
  }

  function handleBlockConfirm(reason: string) {
    void runAction(() => blockExecutionNodeAction({ executionNodeId: node.id, expectedVersion: node.version, reason }));
  }

  return (
    <section
      data-current-task-card
      className="rounded-lg border-2 border-primary-900 bg-white p-4 dark:border-primary-50 dark:bg-zinc-900"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-primary-900 dark:text-primary-50">지금 할 일</span>
        <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
          {procedureCaseExecutionNodeStatusLabels[node.status]}
        </span>
      </div>

      <div className="mt-2 flex items-start gap-3">
        {/* 번호는 요약의 「N번째 / 전체」와 같은 자다(getExecutionDetail 의
            orderIndex). 번호가 안 매겨진 줄(0)은 자리를 비운다. */}
        {node.orderIndex > 0 && (
          <span className="mt-0.5 shrink-0 rounded-md border border-zinc-300 px-2 py-1 text-sm font-semibold tabular-nums text-zinc-700 dark:border-zinc-700 dark:text-zinc-300">
            {node.orderIndex}
          </span>
        )}
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-lg font-semibold leading-snug text-zinc-900 dark:text-zinc-50">{node.title}</h3>
            {node.nodeType && (
              <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                {procedureNodeTypeLabels[node.nodeType]}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* 🔴 지시문은 접지 않는다. 이 화면의 가장 큰 결핍이 「무엇을 어떻게
          하는지가 안 보인다」였다. 줄바꿈은 절차를 적은 사람이 나눠 놓은
          것이므로 그대로 살린다. */}
      {node.instructions ? (
        <p className="mt-3 whitespace-pre-wrap rounded-md bg-zinc-50 p-3 text-sm leading-relaxed text-zinc-800 dark:bg-zinc-800/60 dark:text-zinc-200">
          {node.instructions}
        </p>
      ) : (
        <p className="mt-3 rounded-md bg-zinc-50 p-3 text-sm text-zinc-500 dark:bg-zinc-800/60 dark:text-zinc-400">
          이 작업에는 절차에 적힌 지시문이 없습니다. 제목과 이전 수리 이력을 보고 판단해 주세요.
        </p>
      )}

      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500 dark:text-zinc-400">
        {node.effectiveAssigneeName && <span>담당: {node.effectiveAssigneeName}</span>}
        {node.startedAt && (
          <span>
            시작: {node.startedByName} / {new Date(node.startedAt).toLocaleString("ko-KR")}
          </span>
        )}
        {node.lastActionReason && <span>최근 사유: {node.lastActionReason}</span>}
      </div>

      {eligible && (
        <div className="mt-4 flex flex-col gap-3">
          {isDecision && !decisionHasNoBranch && (
            <div className="flex flex-col gap-2">
              <p className="text-xs text-zinc-600 dark:text-zinc-400">
                결과를 고르면 이 작업이 완료되고, 고른 갈래가 가리키는 작업이 바로 진행 중이 됩니다.
              </p>
              <div className="flex flex-wrap gap-2">
                {node.outgoingEdgeOptions.map((edge) => (
                  <button
                    key={edge.edgeId}
                    type="button"
                    onClick={() => handleBranchComplete(edge.edgeId)}
                    disabled={isSubmitting}
                    className="flex flex-col items-start rounded-md border border-primary-900 px-3 py-2 text-left hover:bg-zinc-50 disabled:opacity-50 dark:border-primary-50 dark:hover:bg-zinc-800"
                  >
                    <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                      {formatBranchChoiceLabel(edge)}
                    </span>
                    {/* 갈래 이름만으로는 어디로 가는지 알 수 없다 — 「NG」가
                        무엇으로 이어지는지가 고르는 판단의 절반이다. */}
                    <span className="text-xs text-zinc-500 dark:text-zinc-400">→ {edge.toNodeTitle}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {decisionHasNoBranch && (
            <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
              {/* 🔵 2026-11-03(조각 13)에 **고칠 길이 하나 늘어** 글자를 고쳤다.
                  전에는 「절차 편집에서 갈래를 이어 주거나」뿐이었는데, 이제
                  [추가 작업 등록] 창에서 이 건에만 쓰는 연결을 그을 수 있다 —
                  판단 작업을 **이 건에서 더했으면** 절차 편집으로는 애초에 못
                  고친다(원본에 없는 작업이다). */}
              이 판단 작업에는 갈래가 그려져 있지 않아 완료할 수 없습니다. [추가 작업 등록]에서 이 건에 쓸 연결을 긋거나,
              절차 편집에서 갈래를 이어 주거나, 아래 [건너뛰기]·[차단]으로 사유를 남겨 주세요.
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            {node.status === "PENDING" && (
              <button
                type="button"
                onClick={handleStart}
                disabled={isSubmitting}
                className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                시작
              </button>
            )}
            {!isDecision && (
              <button
                type="button"
                onClick={handleComplete}
                disabled={isSubmitting}
                className="rounded-md bg-primary-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-800 disabled:opacity-50 dark:bg-primary-50 dark:text-zinc-900 dark:hover:bg-primary-200"
              >
                완료
              </button>
            )}
            <button
              type="button"
              onClick={() => setDialogState("SKIP")}
              disabled={isSubmitting}
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              건너뛰기
            </button>
            <button
              type="button"
              onClick={() => setDialogState("BLOCK")}
              disabled={isSubmitting}
              className="rounded-md border border-amber-300 px-3 py-1.5 text-sm text-amber-700 hover:bg-amber-50 disabled:opacity-50 dark:border-amber-800 dark:text-amber-400 dark:hover:bg-amber-950"
            >
              차단
            </button>
          </div>

          {/* 🔴 메모 칸은 **한 벌을 나눠 쓴다**(2026-11-03, 조각 12 —
              ExecutionMemoField). 전에는 이 카드가 제 상태로 칸을 들고 있어서,
              다른 노드로 옮겨도 **앞 노드에 적던 글자가 그대로 남았다**(사용자
              지적). 그 규칙은 이제 값으로 옮겨 가 세 자리가 같은 함수를 쓴다. */}
          <ExecutionMemoField
            executionNodeId={node.id}
            executionNodeVersion={node.version}
            savedMemo={node.workMemo}
            eligible={eligible}
            size="MD"
          />
        </div>
      )}

      {!eligible && (
        <p className="mt-4 text-xs text-zinc-500 dark:text-zinc-400">
          담당 엔지니어 또는 관리자만 이 작업을 진행할 수 있습니다.
        </p>
      )}

      {errorMessage && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{errorMessage}</p>}

      <ReasonPromptDialog
        isOpen={dialogState === "SKIP"}
        title={`건너뛰기: ${node.title}`}
        isSubmitting={isSubmitting}
        onConfirm={handleSkipConfirm}
        onCancel={() => setDialogState(null)}
      />
      <ReasonPromptDialog
        isOpen={dialogState === "BLOCK"}
        title={`차단: ${node.title}`}
        isSubmitting={isSubmitting}
        onConfirm={handleBlockConfirm}
        onCancel={() => setDialogState(null)}
      />
    </section>
  );
}
