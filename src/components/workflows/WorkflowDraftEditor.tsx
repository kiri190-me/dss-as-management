"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { REPAIR_STATUS_CODES, repairStatusLabels } from "@/lib/domain/types";
import { STEP_CATEGORY_CODES } from "@/lib/domain/local/workflow/step-category";
import type { DraftValidationResult } from "@/lib/domain/workflow-draft-validation";
import type {
  WorkflowDraftStepView,
  WorkflowDraftTransitionView,
} from "@/lib/db/queries/workflow-templates";
import WorkflowDraftTransitionEditor from "./WorkflowDraftTransitionEditor";
import WorkflowDraftConfirmDialog, { type WorkflowDraftConfirmKind } from "./WorkflowDraftConfirmDialog";
import {
  addWorkflowDraftStepAction,
  discardWorkflowDraftAction,
  publishWorkflowDraftAction,
  removeWorkflowDraftStepAction,
  removeWorkflowDraftTransitionAction,
  reorderWorkflowDraftStepsAction,
  updateWorkflowDraftStepAction,
  upsertWorkflowDraftTransitionAction,
} from "@/lib/server/actions/workflow-drafts";

const CATEGORY_LABELS: Record<string, string> = {
  TECHNICAL: "기술",
  BUSINESS: "영업",
  PARTS_SHIPMENT: "부품·출하",
};

/**
 * 초안 편집기. 저장은 조작 하나당 즉시 서버에 반영하고 router.refresh()로
 * 다시 읽는다 — 편집 중 상태를 클라이언트에 쌓아 두었다가 한꺼번에 저장하면
 * "화면에는 저장된 것처럼 보이는데 서버에는 없는" 구간이 생기고, 무엇보다
 * 검증 결과가 실제 저장 내용과 어긋난다.
 *
 * 검증 결과는 서버가 계산해 내려준 것을 그대로 보여 준다. 여기서 다시
 * 계산하지 않는 이유는 발행 mutation과 판정이 갈라지지 않게 하기 위해서다.
 */
export default function WorkflowDraftEditor({
  versionId,
  versionNumber,
  templateCode,
  steps,
  validation,
  transitions,
}: {
  versionId: string;
  versionNumber: number;
  templateCode: string;
  steps: WorkflowDraftStepView[];
  validation: DraftValidationResult;
  transitions: WorkflowDraftTransitionView[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ type: "error" | "success"; text: string } | null>(null);
  const [newLabel, setNewLabel] = useState("");
  const [newStatus, setNewStatus] = useState<string>(REPAIR_STATUS_CODES[0]);
  const [newCategory, setNewCategory] = useState<string>("");
  /**
   * 브라우저 기본 confirm() 대신 앱의 다이얼로그를 쓴다. 열려 있는 확인 창의
   * 종류를 상태로 들고 있고, 실제 실행은 다이얼로그의 onConfirm에서 한다.
   */
  const [confirming, setConfirming] = useState<WorkflowDraftConfirmKind | null>(null);

  /**
   * options.navigateTo가 있으면 이동만 하고 refresh는 하지 않는다.
   *
   * 이 구분이 없으면 폐기·발행 직후 404가 뜬다: push로 목록 화면으로 떠나는
   * 동시에 refresh가 **방금 사라진 초안 페이지**를 다시 그리려 하고, 그
   * 페이지는 초안이 없으면 notFound()이기 때문이다. 이동하는 경우에는 목적지
   * 화면이 알아서 새로 읽으므로 refresh 자체가 불필요하다.
   */
  function run(
    action: () => Promise<{ ok: boolean; message?: string }>,
    options?: { navigateTo?: string }
  ) {
    setMessage(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        setMessage({ type: "error", text: result.message ?? "처리하지 못했습니다." });
        return;
      }
      if (options?.navigateTo) {
        router.push(options.navigateTo);
        return;
      }
      if (result.message) setMessage({ type: "success", text: result.message });
      router.refresh();
    });
  }

  function move(index: number, direction: -1 | 1) {
    const next = [...steps];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    run(() => reorderWorkflowDraftStepsAction({ versionId, orderedStepIds: next.map((s) => s.id) }));
  }

  const blocking = validation.errors;

  return (
    <div className="flex flex-col gap-5">
      {message && (
        <p
          role={message.type === "error" ? "alert" : "status"}
          className={
            message.type === "error"
              ? "rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-400"
              : "rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-700 dark:border-green-900 dark:bg-green-950 dark:text-green-400"
          }
        >
          {message.text}
        </p>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">발행 전 점검</h2>
        {blocking.length === 0 && validation.warnings.length === 0 ? (
          <p className="rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-700 dark:border-green-900 dark:bg-green-950 dark:text-green-400">
            문제 없습니다. 발행할 수 있습니다.
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {blocking.map((issue, i) => (
              <li
                key={`e${i}`}
                className="rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-400"
              >
                <span className="font-semibold">발행 불가</span> · {issue.message}
              </li>
            ))}
            {validation.warnings.map((issue, i) => (
              <li
                key={`w${i}`}
                className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-400"
              >
                <span className="font-semibold">확인</span> · {issue.message}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">단계 {steps.length}개</h2>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">이동 규칙 {transitions.length}개</p>
        </div>

        <ul className="flex flex-col gap-2">
          {steps.map((step, index) => (
            <li
              key={step.id}
              className="flex flex-col gap-2 rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900"
            >
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs tabular-nums text-zinc-400 dark:text-zinc-500">
                  {String(step.order).padStart(2, "0")}
                </span>
                <input
                  defaultValue={step.label}
                  disabled={isPending}
                  onBlur={(e) => {
                    const value = e.target.value.trim();
                    if (value && value !== step.label) {
                      run(() => updateWorkflowDraftStepAction({ stepId: step.id, label: value }));
                    }
                  }}
                  className="min-w-0 flex-1 rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
                  aria-label={`${step.label} 이름`}
                />
                <span className="font-mono text-xs text-zinc-400 dark:text-zinc-500">{step.key}</span>
              </div>

              <div className="flex flex-wrap items-center gap-2 text-xs">
                <select
                  value={step.status ?? ""}
                  disabled={isPending}
                  onChange={(e) => run(() => updateWorkflowDraftStepAction({ stepId: step.id, status: e.target.value }))}
                  className="rounded-md border border-zinc-300 bg-white px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
                  aria-label={`${step.label} 상태`}
                >
                  <option value="" disabled>
                    상태 선택
                  </option>
                  {REPAIR_STATUS_CODES.map((code) => (
                    <option key={code} value={code}>
                      {repairStatusLabels[code]}
                    </option>
                  ))}
                </select>

                <select
                  value={step.category ?? ""}
                  disabled={isPending}
                  onChange={(e) =>
                    run(() =>
                      updateWorkflowDraftStepAction({
                        stepId: step.id,
                        category: e.target.value === "" ? null : e.target.value,
                      })
                    )
                  }
                  className="rounded-md border border-zinc-300 bg-white px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
                  aria-label={`${step.label} 담당`}
                >
                  <option value="">담당 없음</option>
                  {STEP_CATEGORY_CODES.map((code) => (
                    <option key={code} value={code}>
                      {CATEGORY_LABELS[code]}
                    </option>
                  ))}
                </select>

                <label className="flex items-center gap-1 text-zinc-600 dark:text-zinc-400">
                  <input
                    type="checkbox"
                    checked={step.isActive}
                    disabled={isPending}
                    onChange={(e) =>
                      run(() => updateWorkflowDraftStepAction({ stepId: step.id, isActive: e.target.checked }))
                    }
                  />
                  사용
                </label>

                <div className="ml-auto flex items-center gap-1">
                  <button
                    type="button"
                    disabled={isPending || index === 0}
                    onClick={() => move(index, -1)}
                    className="rounded-md border border-zinc-300 px-2 py-1 disabled:opacity-30 dark:border-zinc-700"
                    aria-label="위로"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    disabled={isPending || index === steps.length - 1}
                    onClick={() => move(index, 1)}
                    className="rounded-md border border-zinc-300 px-2 py-1 disabled:opacity-30 dark:border-zinc-700"
                    aria-label="아래로"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() => run(() => removeWorkflowDraftStepAction(step.id))}
                    className="rounded-md border border-red-300 px-2 py-1 text-red-700 disabled:opacity-40 dark:border-red-900 dark:text-red-400"
                  >
                    삭제
                  </button>
                </div>
              </div>

              <WorkflowDraftTransitionEditor
                step={step}
                steps={steps}
                transitions={transitions}
                disabled={isPending}
                onSave={(actionCode, form) =>
                  run(() =>
                    upsertWorkflowDraftTransitionAction({
                      versionId,
                      actionCode,
                      fromStepId: step.id,
                      toStepId: form.toStepId,
                      allowedRoles: form.allowedRoles,
                      requiresAssignedEngineer: form.requiresAssignedEngineer,
                      requiresReason: form.requiresReason,
                      requiredApprovalType: form.requiredApprovalType,
                    })
                  )
                }
                onRemove={(transitionId) => run(() => removeWorkflowDraftTransitionAction(transitionId))}
              />
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-2 rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">단계 추가</h2>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          맨 뒤에 추가됩니다. 키는 자동으로 붙습니다 — 앱이 의미로 읽는 키는 이미 정해져 있어,
          새 단계가 그것을 실수로 가로채지 않도록 직접 묻지 않습니다.
        </p>
        <div className="flex flex-wrap gap-2">
          <input
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            placeholder="이름 (예: 최종 확인)"
            disabled={isPending}
            className="w-48 rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
          />
          <select
            value={newStatus}
            onChange={(e) => setNewStatus(e.target.value)}
            disabled={isPending}
            className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
          >
            {REPAIR_STATUS_CODES.map((code) => (
              <option key={code} value={code}>
                {repairStatusLabels[code]}
              </option>
            ))}
          </select>
          <select
            value={newCategory}
            onChange={(e) => setNewCategory(e.target.value)}
            disabled={isPending}
            className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
          >
            <option value="">담당 없음</option>
            {STEP_CATEGORY_CODES.map((code) => (
              <option key={code} value={code}>
                {CATEGORY_LABELS[code]}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={isPending || !newLabel.trim()}
            onClick={() =>
              run(() => {
                const promise = addWorkflowDraftStepAction({
                  versionId,
                  label: newLabel,
                  status: newStatus,
                  category: newCategory === "" ? null : newCategory,
                });
                setNewLabel("");
                return promise;
              })
            }
            className="rounded-md bg-zinc-900 px-3 py-1 text-sm font-medium text-white disabled:opacity-40 dark:bg-zinc-50 dark:text-zinc-900"
          >
            추가
          </button>
        </div>
      </section>

      <section className="flex flex-wrap items-center justify-between gap-2 border-t border-zinc-200 pt-4 dark:border-zinc-800">
        <button
          type="button"
          disabled={isPending}
          onClick={() => setConfirming("discard")}
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300"
        >
          초안 폐기
        </button>

        <div className="flex items-center gap-2">
          {blocking.length > 0 && (
            <span className="text-xs text-red-700 dark:text-red-400">발행을 막는 문제 {blocking.length}건</span>
          )}
          <button
            type="button"
            disabled={isPending || blocking.length > 0}
            onClick={() => setConfirming("publish")}
            className="rounded-md bg-green-700 px-3 py-1.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            {isPending ? "처리 중..." : "발행"}
          </button>
        </div>
      </section>

      <WorkflowDraftConfirmDialog
        isOpen={confirming !== null}
        kind={confirming ?? "discard"}
        versionNumber={versionNumber}
        isSubmitting={isPending}
        onCancel={() => setConfirming(null)}
        onConfirm={() => {
          const kind = confirming;
          setConfirming(null);
          if (kind === "publish") {
            run(() => publishWorkflowDraftAction(versionId), {
              navigateTo: `/workflows/${templateCode}?done=published`,
            });
          } else if (kind === "discard") {
            run(() => discardWorkflowDraftAction(versionId), {
              navigateTo: `/workflows/${templateCode}?done=discarded`,
            });
          }
        }}
      />
    </div>
  );
}
