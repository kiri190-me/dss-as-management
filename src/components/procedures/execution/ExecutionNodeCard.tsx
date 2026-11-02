"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import ReasonPromptDialog from "./ReasonPromptDialog";
import DecisionCompleteDialog from "./DecisionCompleteDialog";
import ExecutionMemoField from "./ExecutionMemoField";
import ExecutionNodeReopenButton from "./ExecutionNodeReopenButton";
import {
  startExecutionNodeAction,
  completeExecutionNodeAction,
  skipExecutionNodeAction,
  blockExecutionNodeAction,
} from "@/lib/server/actions/procedure-case-execution";
import type { ExecutionNodeDetail } from "@/lib/db/queries/procedure-case-execution";
import { procedureCaseExecutionNodeStatusLabels } from "@/lib/domain/procedure-case-execution-types";
import { procedureNodeTypeLabels } from "@/lib/domain/procedure-template-types";
import { isOrdinaryActionEligible, isReopenEligible } from "./execution-node-eligibility";

type DialogState = "SKIP" | "BLOCK" | "DECISION_COMPLETE" | null;

export default function ExecutionNodeCard({
  node,
  actingUser,
}: {
  node: ExecutionNodeDetail;
  actingUser: { id: string; role: string; isDeveloper: boolean };
}) {
  const router = useRouter();
  const [dialogState, setDialogState] = useState<DialogState>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Shipment-lock removal policy: eligibility is role/assignment-only now —
  // see isBlockedByCaseLock (procedure-case-execution-authorization.ts),
  // which the server independently enforces regardless of this UI hint.
  //
  // 판정은 execution-node-eligibility.ts 한 곳에 있다 — 「지금 할 일」 큰
  // 카드(CurrentTaskCard)가 같은 노드를 같은 규칙으로 그려야 하기 때문이다.
  const ordinaryEligible = isOrdinaryActionEligible(actingUser, node.effectiveAssigneeId);
  const reopenEligible = isReopenEligible(actingUser, node.status, node.effectiveAssigneeId);

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
    if (node.nodeType === "DECISION") {
      setDialogState("DECISION_COMPLETE");
      return;
    }
    void runAction(() => completeExecutionNodeAction({ executionNodeId: node.id, expectedVersion: node.version }));
  }

  function handleDecisionConfirm(selectedOutgoingEdgeId: string) {
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
    <div className="rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            {/* 절차상 번호. 카드가 네 구역(실행 가능·진행 중·차단됨·완료)으로
                나뉘어 있어서, 번호가 없으면 지금 보는 카드가 절차의 어디쯤인지
                알 길이 없다. 제목을 가리지 않도록 테두리만 두른 작은 칸으로
                둔다. 번호가 안 매겨진 줄(0)은 자리를 비운다 — 「-」 같은 글자를
                만들어 내지 않는다. */}
            {node.orderIndex > 0 && (
              <span className="shrink-0 rounded border border-zinc-300 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
                {node.orderIndex}
              </span>
            )}
            <span className="text-sm font-medium text-zinc-900 dark:text-zinc-50">{node.title}</span>
            {node.nodeType && (
              <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                {procedureNodeTypeLabels[node.nodeType]}
              </span>
            )}
            {node.isSuggestedNext && (
              <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[11px] text-blue-700 dark:bg-blue-950 dark:text-blue-400">
                추천
              </span>
            )}
          </div>
          {node.instructions && <p className="mt-1 whitespace-pre-wrap text-xs text-zinc-500 dark:text-zinc-400">{node.instructions}</p>}
        </div>
        <span className="whitespace-nowrap text-xs text-zinc-500 dark:text-zinc-400">
          {procedureCaseExecutionNodeStatusLabels[node.status]}
        </span>
      </div>

      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500 dark:text-zinc-400">
        {node.effectiveAssigneeName && <span>담당: {node.effectiveAssigneeName}</span>}
        {node.startedAt && <span>시작: {node.startedByName} / {new Date(node.startedAt).toLocaleString("ko-KR")}</span>}
        {node.completedAt && <span>완료: {node.completedByName} / {new Date(node.completedAt).toLocaleString("ko-KR")}</span>}
        {node.lastActionReason && <span>최근 사유: {node.lastActionReason}</span>}
      </div>

      {(node.status === "PENDING" || node.status === "IN_PROGRESS") && ordinaryEligible && (
        <div className="mt-3 flex flex-wrap gap-2">
          {node.status === "PENDING" && (
            <button
              type="button"
              onClick={handleStart}
              disabled={isSubmitting}
              className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              시작
            </button>
          )}
          <button
            type="button"
            onClick={handleComplete}
            disabled={isSubmitting}
            className="rounded-md bg-primary-900 px-2.5 py-1 text-xs font-medium text-white hover:bg-primary-800 disabled:opacity-50 dark:bg-primary-50 dark:text-zinc-900 dark:hover:bg-primary-200"
          >
            완료
          </button>
          <button
            type="button"
            onClick={() => setDialogState("SKIP")}
            disabled={isSubmitting}
            className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            건너뛰기
          </button>
          <button
            type="button"
            onClick={() => setDialogState("BLOCK")}
            disabled={isSubmitting}
            className="rounded-md border border-amber-300 px-2.5 py-1 text-xs text-amber-700 hover:bg-amber-50 disabled:opacity-50 dark:border-amber-800 dark:text-amber-400 dark:hover:bg-amber-950"
          >
            차단
          </button>
        </div>
      )}

      {/* 🔴 단추도 메모 칸도 **한 벌을 나눠 쓴다**(2026-11-03, 조각 12). 같은 둘이
          「실행 이력」에서 끝난 작업의 마지막 줄에도 서기 때문이다 — 두 벌로 두면
          한쪽만 고치는 날이 오고, 타입이 같아 컴파일러는 아무 말도 안 한다. */}
      {(node.status === "COMPLETED" || node.status === "SKIPPED" || node.status === "BLOCKED") && reopenEligible && (
        <div className="mt-3">
          <ExecutionNodeReopenButton
            executionNodeId={node.id}
            executionNodeVersion={node.version}
            nodeTitle={node.title}
          />
        </div>
      )}

      {ordinaryEligible && (
        <div className="mt-3">
          <ExecutionMemoField
            executionNodeId={node.id}
            executionNodeVersion={node.version}
            savedMemo={node.workMemo}
            eligible={ordinaryEligible}
            size="SM"
          />
        </div>
      )}

      {errorMessage && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{errorMessage}</p>}

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
      <DecisionCompleteDialog
        isOpen={dialogState === "DECISION_COMPLETE"}
        nodeTitle={node.title}
        outgoingEdgeOptions={node.outgoingEdgeOptions}
        isSubmitting={isSubmitting}
        onConfirm={handleDecisionConfirm}
        onCancel={() => setDialogState(null)}
      />
    </div>
  );
}
