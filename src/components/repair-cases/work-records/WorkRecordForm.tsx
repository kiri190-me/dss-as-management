"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createWorkRecordAction } from "@/lib/server/actions/repair-case-work-records";

export default function WorkRecordForm({
  repairCaseId,
  currentStepLabel,
  currentStepOrder,
  inProgressNodes,
  disabledReason,
}: {
  repairCaseId: string;
  currentStepLabel: string;
  currentStepOrder: number | null;
  inProgressNodes: { id: string; title: string }[];
  /** Non-null when creation is currently disallowed (e.g. locked case, not the assigned engineer) — the form still renders, but input/submit are disabled and this reason is shown. Server re-checks regardless. */
  disabledReason: string | null;
}) {
  const router = useRouter();
  const [memo, setMemo] = useState("");
  const [selectedNodeId, setSelectedNodeId] = useState("");
  const [clientRequestId, setClientRequestId] = useState(() => crypto.randomUUID());
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const disabled = disabledReason !== null;

  async function handleSubmit() {
    if (disabled || isSubmitting) return;
    if (memo.trim().length === 0) {
      setErrorMessage("작업 기록 내용을 입력해 주세요.");
      return;
    }
    setIsSubmitting(true);
    setErrorMessage(null);
    const result = await createWorkRecordAction({
      repairCaseId,
      memo,
      relatedProcedureExecutionNodeId: selectedNodeId || null,
      clientRequestId,
    });
    setIsSubmitting(false);
    if (!result.ok) {
      setErrorMessage(result.message);
      return;
    }
    setMemo("");
    setSelectedNodeId("");
    setClientRequestId(crypto.randomUUID());
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        현재 단계: {currentStepOrder !== null ? `${currentStepOrder}. ` : ""}
        {currentStepLabel}
      </p>

      <textarea
        rows={4}
        value={memo}
        onChange={(event) => setMemo(event.target.value)}
        disabled={disabled || isSubmitting}
        placeholder="점검 내용, 고객 증상 재현, 확인한 원인, 분해/조립 내용, 부품 교체 내용, 테스트 결과, 일본 본사 지시 반영, 다음 작업 계획 등 실제 작업한 내용을 입력하세요."
        className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
      />

      {inProgressNodes.length > 0 && (
        <div className="flex flex-col gap-1">
          <label htmlFor="work-record-node-select" className="text-xs text-zinc-500 dark:text-zinc-400">
            관련 절차 항목 (선택)
          </label>
          <select
            id="work-record-node-select"
            value={selectedNodeId}
            onChange={(event) => setSelectedNodeId(event.target.value)}
            disabled={disabled || isSubmitting}
            className="w-full max-w-sm rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-900 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
          >
            <option value="">연결 안 함</option>
            {inProgressNodes.map((node) => (
              <option key={node.id} value={node.id}>
                {node.title}
              </option>
            ))}
          </select>
        </div>
      )}

      {disabled && <p className="text-xs text-zinc-500 dark:text-zinc-400">{disabledReason}</p>}
      {errorMessage && <p className="text-xs text-red-600 dark:text-red-400">{errorMessage}</p>}

      <button
        type="button"
        onClick={() => void handleSubmit()}
        disabled={disabled || isSubmitting}
        className="self-start rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
      >
        {isSubmitting ? "저장하는 중..." : "작업 기록 추가"}
      </button>
    </div>
  );
}
