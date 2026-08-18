"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import ReasonPromptDialog from "./ReasonPromptDialog";
import DecisionCompleteDialog from "./DecisionCompleteDialog";
import {
  startExecutionNodeAction,
  completeExecutionNodeAction,
  skipExecutionNodeAction,
  blockExecutionNodeAction,
  reopenExecutionNodeAction,
  updateExecutionNodeMemoAction,
} from "@/lib/server/actions/procedure-case-execution";
import type { ExecutionNodeDetail } from "@/lib/db/queries/procedure-case-execution";
import { procedureCaseExecutionNodeStatusLabels } from "@/lib/domain/procedure-case-execution-types";
import { procedureNodeTypeLabels } from "@/lib/domain/procedure-template-types";

type DialogState = "SKIP" | "BLOCK" | "REOPEN" | "DECISION_COMPLETE" | null;

function canActOrdinary(role: string, actorId: string, effectiveAssigneeId: string | null): boolean {
  if (role === "SUPER_ADMIN" || role === "ADMIN") return true;
  if (role === "AS_ENGINEER") return effectiveAssigneeId === actorId;
  return false;
}

function canReopenCompletedOrSkipped(role: string): boolean {
  return role === "SUPER_ADMIN" || role === "ADMIN";
}

function canReopenBlocked(role: string, actorId: string, effectiveAssigneeId: string | null): boolean {
  if (role === "SUPER_ADMIN" || role === "ADMIN") return true;
  if (role === "AS_ENGINEER") return effectiveAssigneeId === actorId;
  return false;
}

export default function ExecutionNodeCard({
  node,
  actingUser,
}: {
  node: ExecutionNodeDetail;
  actingUser: { id: string; role: string };
}) {
  const router = useRouter();
  const [dialogState, setDialogState] = useState<DialogState>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [memoDraft, setMemoDraft] = useState(node.workMemo ?? "");
  const [isMemoDirty, setIsMemoDirty] = useState(false);

  // Shipment-lock removal policy: eligibility is role/assignment-only now —
  // see isBlockedByCaseLock (procedure-case-execution-authorization.ts),
  // which the server independently enforces regardless of this UI hint.
  const ordinaryEligible = canActOrdinary(actingUser.role, actingUser.id, node.effectiveAssigneeId);
  const reopenEligible =
    node.status === "BLOCKED"
      ? canReopenBlocked(actingUser.role, actingUser.id, node.effectiveAssigneeId)
      : canReopenCompletedOrSkipped(actingUser.role);

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

  function handleReopenConfirm(reason: string) {
    void runAction(() => reopenExecutionNodeAction({ executionNodeId: node.id, expectedVersion: node.version, reason }));
  }

  async function handleMemoSave() {
    setIsSubmitting(true);
    setErrorMessage(null);
    const result = await updateExecutionNodeMemoAction({
      executionNodeId: node.id,
      expectedVersion: node.version,
      memo: memoDraft.trim() || null,
    });
    setIsSubmitting(false);
    if (!result.ok) {
      setErrorMessage(result.message);
      return;
    }
    setIsMemoDirty(false);
    router.refresh();
  }

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
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
            className="rounded-md bg-zinc-900 px-2.5 py-1 text-xs font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
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

      {(node.status === "COMPLETED" || node.status === "SKIPPED" || node.status === "BLOCKED") && reopenEligible && (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => setDialogState("REOPEN")}
            disabled={isSubmitting}
            className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            재개(되돌림)
          </button>
        </div>
      )}

      {ordinaryEligible && (
        <div className="mt-3 flex flex-col gap-1">
          <label htmlFor={`memo-${node.id}`} className="text-[11px] text-zinc-500 dark:text-zinc-400">
            작업 메모
          </label>
          <textarea
            id={`memo-${node.id}`}
            rows={2}
            value={memoDraft}
            onChange={(event) => {
              setMemoDraft(event.target.value);
              setIsMemoDirty(true);
            }}
            className="w-full rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
          />
          {isMemoDirty && (
            <button
              type="button"
              onClick={() => void handleMemoSave()}
              disabled={isSubmitting}
              className="w-fit rounded-md border border-zinc-300 px-2.5 py-1 text-xs text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              메모 저장
            </button>
          )}
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
      <ReasonPromptDialog
        isOpen={dialogState === "REOPEN"}
        title={`재개(되돌림): ${node.title}`}
        warningNote="이후 완료된 다른 작업들은 자동으로 되돌아가지 않습니다."
        isSubmitting={isSubmitting}
        onConfirm={handleReopenConfirm}
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
