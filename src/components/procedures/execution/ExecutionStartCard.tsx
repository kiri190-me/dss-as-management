"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { startProcedureExecutionAction } from "@/lib/server/actions/procedure-case-execution";
import type { ExecutableTemplateOption } from "@/lib/db/queries/procedure-case-execution";

const START_ELIGIBLE_ROLES = ["SUPER_ADMIN", "ADMIN", "AS_ENGINEER"] as const;

/**
 * Phase 5C-1 — compact replacement for the former full-width "표준 절차 실행
 * 시작" card: a `[+ 기술 절차 불러오기]` trigger that opens the same
 * template-selection flow in a dialog. Presentation-only change — role
 * eligibility, published/non-reference-only template filtering (computed by
 * the caller via getExecutableTemplateOptions), and the
 * startProcedureExecutionAction call are all identical to before.
 *
 * 이름에서 "표준" 을 뺐다 — 여기 뜨는 것은 [기술/지원] > 기술 작업 절차에서
 * 만들어 **게시한** 절차이지, 따로 있는 "표준" 묶음이 아니다. 이름이 그렇게
 * 읽히면 목록이 비었을 때 사람이 엉뚱한 데를 찾게 된다.
 */
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
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState(templateOptions[0]?.id ?? "");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const eligible = (START_ELIGIBLE_ROLES as readonly string[]).includes(actingUserRole);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (isOpen && !dialog.open) dialog.showModal();
    else if (!isOpen && dialog.open) dialog.close();
  }, [isOpen]);

  function openDialog() {
    setErrorMessage(null);
    setSelectedTemplateId(templateOptions[0]?.id ?? "");
    setIsOpen(true);
  }

  function closeDialog() {
    if (isSubmitting) return;
    setIsOpen(false);
  }

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
    setIsOpen(false);
    router.refresh();
  }

  return (
    <>
      <button
        type="button"
        onClick={openDialog}
        className="self-start rounded-md border border-dashed border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
      >
        + 기술 절차 불러오기
      </button>

      <dialog
        ref={dialogRef}
        aria-labelledby="execution-start-dialog-title"
        onCancel={(event) => {
          event.preventDefault();
          closeDialog();
        }}
        className="w-full max-w-md rounded-lg border border-zinc-200 bg-white p-4 text-zinc-900 backdrop:bg-black/40 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50"
      >
        <h2 id="execution-start-dialog-title" className="text-sm font-semibold">
          기술 절차 불러오기
        </h2>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          게시된 절차 템플릿을 선택하여 이 접수 건에 대한 절차 실행을 시작합니다.
        </p>

        {templateOptions.length === 0 ? (
          // 비었을 때 "없습니다" 한 줄만 두면 사람이 고장으로 읽는다. 왜
          // 비었는지(게시된 것만 온다)와 어디서 채우는지([기술/지원] > 기술
          // 작업 절차의 [게시])를 함께 말해 준다.
          <div className="mt-3 flex flex-col gap-1 text-sm text-zinc-500 dark:text-zinc-400">
            <p>불러올 수 있는 기술 절차가 없습니다.</p>
            <p className="text-xs">
              이 목록에는 <span className="font-medium">게시된</span> 절차만 나타납니다. 절차를 게시하려면{" "}
              <span className="font-medium">[기술/지원] &gt; 기술 작업 절차</span> 에서 해당 절차를 열고{" "}
              <span className="font-medium">[게시]</span> 를 누르세요. 초안(DRAFT) 상태이거나 참고용으로 표시된
              절차는 여기에 나타나지 않습니다.
            </p>
          </div>
        ) : !eligible ? (
          <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">최고관리자·관리자·담당 A/S 엔지니어만 실행을 시작할 수 있습니다.</p>
        ) : (
          <div className="mt-3 flex flex-col gap-1">
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
        )}

        {errorMessage && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{errorMessage}</p>}

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={closeDialog}
            disabled={isSubmitting}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            취소
          </button>
          {eligible && templateOptions.length > 0 && (
            <button
              type="button"
              onClick={() => void handleStart()}
              disabled={isSubmitting || !selectedTemplateId}
              className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
            >
              {isSubmitting ? "시작하는 중..." : "실행 시작"}
            </button>
          )}
        </div>
      </dialog>
    </>
  );
}
