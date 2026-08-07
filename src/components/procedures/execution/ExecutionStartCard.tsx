"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { startProcedureExecutionAction } from "@/lib/server/actions/procedure-case-execution";
import type { ExecutableTemplateOption } from "@/lib/db/queries/procedure-case-execution";

const START_ELIGIBLE_ROLES = ["SUPER_ADMIN", "ADMIN", "AS_ENGINEER"] as const;

export default function ExecutionStartCard({
  repairCaseId,
  actingUserRole,
  templateOptions,
}: {
  repairCaseId: string;
  actingUserRole: string;
  templateOptions: ExecutableTemplateOption[];
}) {
  const router = useRouter();
  const [selectedTemplateId, setSelectedTemplateId] = useState(templateOptions[0]?.id ?? "");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const eligible = (START_ELIGIBLE_ROLES as readonly string[]).includes(actingUserRole);

  async function handleStart() {
    if (!selectedTemplateId || isSubmitting) return;
    setIsSubmitting(true);
    setErrorMessage(null);
    const result = await startProcedureExecutionAction({ repairCaseId, procedureTemplateId: selectedTemplateId });
    setIsSubmitting(false);
    if (!result.ok) {
      setErrorMessage(result.message);
      return;
    }
    router.refresh();
  }

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">표준 절차 실행 시작</h2>
      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
        게시된 절차 템플릿을 선택하여 이 접수 건에 대한 절차 실행을 시작합니다.
      </p>

      {templateOptions.length === 0 ? (
        <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">실행 가능한 게시된 절차 템플릿이 없습니다.</p>
      ) : !eligible ? (
        <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">최고관리자·관리자·담당 A/S 엔지니어만 실행을 시작할 수 있습니다.</p>
      ) : (
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="flex flex-1 flex-col gap-1">
            <label htmlFor="execution-template-select" className="text-xs text-zinc-500 dark:text-zinc-400">
              절차 템플릿
            </label>
            <select
              id="execution-template-select"
              value={selectedTemplateId}
              onChange={(event) => setSelectedTemplateId(event.target.value)}
              className="w-full rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
            >
              {templateOptions.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.code})
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            onClick={() => void handleStart()}
            disabled={isSubmitting}
            className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            {isSubmitting ? "시작하는 중..." : "실행 시작"}
          </button>
        </div>
      )}

      {errorMessage && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{errorMessage}</p>}
    </div>
  );
}
