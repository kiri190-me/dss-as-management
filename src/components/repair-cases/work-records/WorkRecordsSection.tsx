"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { invalidateWorkRecordAction } from "@/lib/server/actions/repair-case-work-records";
import type { WorkRecordRow } from "@/lib/db/queries/repair-case-work-records";
import WorkRecordForm from "./WorkRecordForm";
import WorkRecordList from "./WorkRecordList";
import InvalidateWorkRecordDialog from "./InvalidateWorkRecordDialog";

/**
 * Phase 5C-2 — "작업 기록" + "최근 작업 기록" (작업내용 sections 3-4). One
 * composed component (not two independent ones) because they share state:
 * a successful create or invalidate both need to refresh the same recent-
 * records list (via router.refresh(), same convention as
 * DatabaseWorkflowControlPanel/ExecutionStartCard).
 */
export default function WorkRecordsSection({
  repairCaseId,
  currentStepLabel,
  currentStepOrder,
  inProgressNodes,
  createDisabledReason,
  canInvalidate,
  recentRecords,
}: {
  repairCaseId: string;
  currentStepLabel: string;
  currentStepOrder: number | null;
  inProgressNodes: { id: string; title: string }[];
  createDisabledReason: string | null;
  canInvalidate: boolean;
  recentRecords: WorkRecordRow[];
}) {
  const router = useRouter();
  const [invalidateTargetId, setInvalidateTargetId] = useState<string | null>(null);
  const [isSubmittingInvalidate, setIsSubmittingInvalidate] = useState(false);
  const [invalidateError, setInvalidateError] = useState<string | null>(null);

  async function handleInvalidateConfirm(reason: string) {
    if (!invalidateTargetId || isSubmittingInvalidate) return;
    setIsSubmittingInvalidate(true);
    setInvalidateError(null);
    const result = await invalidateWorkRecordAction({ workRecordId: invalidateTargetId, reason });
    setIsSubmittingInvalidate(false);
    if (!result.ok) {
      setInvalidateError(result.message);
      return;
    }
    setInvalidateTargetId(null);
    router.refresh();
  }

  return (
    <>
      <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">작업 기록</h2>
        <div className="mt-3">
          <WorkRecordForm
            repairCaseId={repairCaseId}
            currentStepLabel={currentStepLabel}
            currentStepOrder={currentStepOrder}
            inProgressNodes={inProgressNodes}
            disabledReason={createDisabledReason}
          />
        </div>
      </section>

      <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">최근 작업 기록</h2>
        {invalidateError && (
          <p className="mt-2 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-400">
            {invalidateError}
          </p>
        )}
        <div className="mt-3">
          <WorkRecordList
            records={recentRecords}
            canInvalidate={canInvalidate}
            onInvalidate={canInvalidate ? (id) => setInvalidateTargetId(id) : undefined}
            emptyMessage="아직 작업 기록이 없습니다."
          />
        </div>
      </section>

      <InvalidateWorkRecordDialog
        isOpen={invalidateTargetId !== null}
        isSubmitting={isSubmittingInvalidate}
        onConfirm={(reason) => void handleInvalidateConfirm(reason)}
        onCancel={() => setInvalidateTargetId(null)}
      />
    </>
  );
}
