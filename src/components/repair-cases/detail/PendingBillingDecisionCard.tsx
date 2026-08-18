"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { resolveRepairCaseBillingAction } from "@/lib/server/actions/resolve-repair-case-billing";
import type { FinalBillingDecision } from "@/lib/db/mutations/repair-case-billing-decision";

const OPTIONS: readonly { value: FinalBillingDecision; label: string }[] = [
  { value: "PAID", label: "유상" },
  { value: "PARTIAL_PAID", label: "일부유상" },
  { value: "WARRANTY", label: "무상" },
];

export default function PendingBillingDecisionCard({
  repairCaseId,
  expectedVersion,
  canResolve,
}: {
  repairCaseId: string;
  expectedVersion: number;
  canResolve: boolean;
}) {
  const router = useRouter();
  const [selection, setSelection] = useState<FinalBillingDecision>("PAID");
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function submit() {
    setMessage(null);
    startTransition(async () => {
      const result = await resolveRepairCaseBillingAction({
        repairCaseId,
        expectedVersion,
        nextBillingType: selection,
      });
      if (!result.ok) {
        setMessage(result.message);
        return;
      }
      router.refresh();
    });
  }

  return (
    <section className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-950">
      <h2 className="text-base font-semibold">유·무상 결정 필요</h2>
      <p className="mt-1 text-sm">
        현재 접수 건은 추후결정 상태입니다. 유·무상을 확정하기 전에는 수리 단계 진행, 승인,
        작업 기록, Procedure 및 Case Flowchart 작업을 수행할 수 없습니다.
      </p>
      {canResolve ? (
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
          <label className="flex min-w-44 flex-col gap-1 text-sm font-medium">
            확정 값
            <select
              className="rounded-md border border-amber-400 bg-white px-3 py-2"
              value={selection}
              disabled={isPending}
              onChange={(event) => setSelection(event.target.value as FinalBillingDecision)}
            >
              {OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="rounded-md bg-amber-800 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            disabled={isPending}
            onClick={submit}
          >
            {isPending ? "확정 중…" : "유·무상 확정"}
          </button>
        </div>
      ) : (
        <p className="mt-3 text-sm font-medium">확정 권한이 있는 담당자에게 요청해 주세요.</p>
      )}
      {message && <p className="mt-2 text-sm font-medium" role="alert">{message}</p>}
    </section>
  );
}
