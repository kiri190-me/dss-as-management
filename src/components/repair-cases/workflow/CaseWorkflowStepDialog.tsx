"use client";

import { useEffect, useRef, useState } from "react";

import { STEP_CATEGORY_CODES } from "@/lib/domain/local/workflow/step-category";
import { REPAIR_STATUS_CODES, repairStatusLabels } from "@/lib/domain/types";

const CATEGORY_LABELS: Record<string, string> = {
  TECHNICAL: "기술",
  BUSINESS: "영업",
  PARTS_SHIPMENT: "부품·출하",
};

/**
 * "이 건에만 단계 추가" 입력 창.
 *
 * 다른 확인 창들과 같은 네이티브 <dialog>/showModal() 패턴을 쓴다
 * (TransitionDialog, HoldDialog, WorkflowDraftConfirmDialog 등).
 *
 * 키 입력란이 없는 것은 의도적이다 — 서버가 case_step_N으로 만든다. 워크플로
 * 초안 편집기(템플릿 편집)에서는 키를 직접 받지만, 그곳의 키는 앱이 의미로 읽는
 * 이름이고 여기의 단계는 이 접수 건에만 있는 이름 없는 단계다.
 *
 * 아래 경고는 사용자 결정("C는 경고만")에 따른 것이다. 무상 ↔ 유상처럼 워크플로
 * 자체가 바뀌는 변경을 하면 접수 건이 대상 템플릿의 현재 버전으로 재배정되면서
 * 이 변주가 버려진다. 그래도 막지는 않는다 — "유·무상은 언제든, 어느 단계에서든
 * 변경 가능한게 원칙"이기 때문이다.
 *
 * 유상 ↔ 일부유상은 워크플로가 같아(resolveBillingWorkflowTarget의
 * workflowUnchanged) 변주가 그대로 남는다. 이 구분을 문구에 적어 둔 것은,
 * "유·무상을 건드리면 무조건 날아간다"고 알면 바꿔도 되는 변경까지 피하게 되기
 * 때문이다.
 */
export default function CaseWorkflowStepDialog({
  isOpen,
  currentStepLabel,
  nextStepLabel,
  isSubmitting,
  onConfirm,
  onCancel,
}: {
  isOpen: boolean;
  currentStepLabel: string;
  /** 현재 단계의 원래 다음 단계. 없으면(막다른 단계) 흐름 미리보기에서 생략한다. */
  nextStepLabel: string | null;
  isSubmitting: boolean;
  onConfirm: (input: { label: string; status: string; category: string | null }) => void;
  onCancel: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [label, setLabel] = useState("");
  const [status, setStatus] = useState<string>("IN_REPAIR");
  const [category, setCategory] = useState<string>("TECHNICAL");

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (isOpen && !dialog.open) {
      setLabel("");
      setStatus("IN_REPAIR");
      setCategory("TECHNICAL");
      dialog.showModal();
    } else if (!isOpen && dialog.open) {
      dialog.close();
    }
  }, [isOpen]);

  const trimmed = label.trim();

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="case-workflow-step-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!isSubmitting) onCancel();
      }}
      className="w-full max-w-md rounded-lg border border-zinc-200 bg-white p-4 text-zinc-900 backdrop:bg-black/40 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50"
    >
      <h2 id="case-workflow-step-title" className="text-sm font-semibold">
        이 접수 건에만 단계 추가
      </h2>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        현재 단계 <strong>{currentStepLabel}</strong> 바로 다음에 들어갑니다. 이 접수 건에만 적용되며 다른 건이나
        워크플로 템플릿은 그대로입니다.
      </p>

      <div className="mt-3 flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-xs text-zinc-500 dark:text-zinc-400">
          단계 이름
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            maxLength={60}
            disabled={isSubmitting}
            placeholder="예: 고객 요청 추가 절연 시험"
            className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
          />
        </label>

        <div className="flex flex-wrap gap-3">
          <label className="flex flex-1 flex-col gap-1 text-xs text-zinc-500 dark:text-zinc-400">
            진행 상태
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              disabled={isSubmitting}
              className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
            >
              {REPAIR_STATUS_CODES.map((code) => (
                <option key={code} value={code}>
                  {repairStatusLabels[code]}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-1 flex-col gap-1 text-xs text-zinc-500 dark:text-zinc-400">
            담당 구분
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              disabled={isSubmitting}
              className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
            >
              <option value="">담당 없음(관리자만)</option>
              {STEP_CATEGORY_CODES.map((code) => (
                <option key={code} value={code}>
                  {CATEGORY_LABELS[code]}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="mt-3 rounded-md border border-zinc-200 bg-zinc-50 p-2.5 text-xs text-zinc-600 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400">
        <p className="font-medium text-zinc-700 dark:text-zinc-300">추가 후 흐름</p>
        <p className="mt-1">
          {currentStepLabel} → <strong className="text-zinc-900 dark:text-zinc-50">{trimmed || "새 단계"}</strong>
          {nextStepLabel ? ` → ${nextStepLabel}` : ""}
        </p>
        <p className="mt-1">새 단계에서 {currentStepLabel}(으)로 되돌릴 수도 있습니다.</p>
      </div>

      <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
        <strong>주의:</strong> 이후 <strong>무상 ↔ 유상</strong>으로 바꾸면 워크플로가 해당 구분의 기본
        워크플로로 다시 배정되면서 여기서 추가한 단계는 사라집니다. 유·무상이 아직 정해지지 않았다면 먼저 정하고
        추가하세요. (유상 ↔ 일부유상은 같은 워크플로를 쓰므로 그대로 유지됩니다.)
      </p>

      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={isSubmitting}
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          취소
        </button>
        <button
          type="button"
          onClick={() => onConfirm({ label: trimmed, status, category: category === "" ? null : category })}
          disabled={isSubmitting || !trimmed}
          aria-busy={isSubmitting}
          className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900"
        >
          {isSubmitting ? "추가 중..." : "추가"}
        </button>
      </div>
    </dialog>
  );
}
