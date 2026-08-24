"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { repairStatusLabels } from "@/lib/domain/types";
import type { ActingUser } from "@/lib/domain/local/approval/transitions";
import { checkManualStepSetEligibility } from "@/lib/domain/local/workflow/permissions";
import type { WorkflowRuleStep } from "@/lib/domain/workflow-rules-view";
import type { HoldState } from "@/lib/domain/local/workflow/workflow-types";
import { setWorkflowStepAction } from "@/lib/server/actions/set-workflow-step";

/**
 * 작업내용 탭의 "현재 단계 직접 변경" 섹션 (2026-08-18 승인).
 *
 * 기존 "실행 가능 작업"(DatabaseWorkflowControlPanel)은 그대로 두고 그 옆에
 * 별도로 놓는다 — 정규 워크플로 진행과 규칙 우회는 화면에서도 구분되어야
 * 한다는 요구다. 그래서 이 컴포넌트는 그 패널을 수정하지 않고 형제로 렌더된다.
 *
 * 여기서 계산하는 자격(checkManualStepSetEligibility)과 후보 목록(options)은
 * 전부 UI 힌트일 뿐이다 — Server Action과 mutation이 DB 상태로 같은 판정을
 * 처음부터 다시 한다. 이 프로젝트의 다른 모든 권한 표시와 같은 규율이다.
 */
export default function ManualStepSetPanel({
  repairCaseId,
  version,
  currentStepKey,
  options,
  actingUser,
  assignedEngineerId,
  holdState,
  isCaseLocked,
}: {
  repairCaseId: string;
  version: number;
  currentStepKey: string;
  /** 승인 게이트 단계가 제외된 후보 목록 — db/queries/workflow-rules.ts의
   *  listManuallySelectableStepsFromRules가 산출한다. */
  options: WorkflowRuleStep[];
  actingUser: ActingUser | null;
  /** 접수 건의 담당 엔지니어(없으면 null). AS_ENGINEER 본인 확인용 UI 힌트이며,
   *  최종 판정은 서버가 DB 값으로 다시 한다. */
  assignedEngineerId: string | null;
  holdState: HoldState;
  isCaseLocked: boolean;
}) {
  const router = useRouter();
  const [selectedStepKey, setSelectedStepKey] = useState(currentStepKey);
  const [reason, setReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // 잠금은 자격 검사보다 먼저, 무조건 확인한다(전이 패널과 같은 순서 —
  // permissions.ts의 checkManualStepSetEligibility 주석 참고).
  const unavailableReason = isCaseLocked
    ? "출하 완료 후 잠금된 접수 건입니다."
    : !actingUser
      ? "사용자 정보를 확인할 수 없습니다."
      : (() => {
          const eligibility = checkManualStepSetEligibility(actingUser, assignedEngineerId, holdState);
          return eligibility.allowed ? null : eligibility.reason;
        })();

  const isUnchanged = selectedStepKey === currentStepKey;
  const isReasonEmpty = reason.trim() === "";
  const canSubmit = !unavailableReason && !isUnchanged && !isReasonEmpty && !isSubmitting;

  async function handleSubmit() {
    if (!canSubmit) return;
    setIsSubmitting(true);
    setMessage(null);
    try {
      const result = await setWorkflowStepAction({
        repairCaseId,
        expectedVersion: version,
        toStepKey: selectedStepKey,
        reason: reason.trim(),
      });
      if (!result.ok) {
        setMessage({ type: "error", text: result.message });
        return;
      }
      setReason("");
      setMessage({ type: "success", text: "현재 단계를 변경했습니다." });
      router.refresh();
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    /*
      기본 접힘 상태다(<details>에 open 속성을 주지 않는다 — 2026-08-18 요구).
      정규 워크플로를 벗어나는 예외 조작이라 평소 화면에서는 눈에 띄지 않는
      편이 맞고, 바로 위 "실행 가능 작업"이 늘 우선해서 보여야 한다.

      useState 토글 대신 네이티브 <details>를 쓴 것은 이 앱의 기존 관례를
      따른 것이다(작업내용/작업 이력 화면의 "워크플로 변경 이력"이 같은 방식).
      상태를 하나도 늘리지 않고, 키보드 조작·접근성도 브라우저가 처리한다.

      접힌 동안 내부 입력은 렌더는 되지만 화면에 없다. 제출 버튼이 details
      바깥에 있지 않으므로 접힌 채로 실수로 제출되는 경로는 없다.
    */
    <details className="group rounded-lg border border-amber-200 bg-amber-50/40 dark:border-amber-900 dark:bg-amber-950/20">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 p-4 text-sm font-semibold text-zinc-900 dark:text-zinc-50">
        <span>현재 단계 직접 변경</span>
        {/* 펼침 여부에 따라 문구를 바꾼다 — 네이티브 삼각형 마커를 list-none으로
            숨겼으므로 이 문구가 유일한 상태 표시가 된다. */}
        <span className="text-xs font-normal text-zinc-600 dark:text-zinc-400">
          <span className="group-open:hidden">더보기</span>
          <span className="hidden group-open:inline">접기</span>
        </span>
      </summary>

      <div className="flex flex-col gap-3 border-t border-amber-200 p-4 dark:border-amber-900">
        <p className="text-xs text-zinc-600 dark:text-zinc-400">
          정규 워크플로 순서를 따르지 않고 현재 단계를 바로 지정합니다. 변경 이력에 &ldquo;단계 직접
          변경&rdquo;으로 따로 기록되며, 사유는 반드시 남겨야 합니다. 승인이 필요한 단계(출하 완료 등)는
          목록에 나오지 않습니다 — 승인 절차를 거쳐 진행해 주세요.
        </p>

      {unavailableReason && (
        <p className="rounded-md border border-zinc-200 bg-white p-2 text-xs text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400">
          {unavailableReason}
        </p>
      )}

      <div className="flex flex-col gap-1">
        <label htmlFor="manual-step-select" className="text-xs text-zinc-500 dark:text-zinc-400">
          변경할 단계
        </label>
        <select
          id="manual-step-select"
          value={selectedStepKey}
          disabled={Boolean(unavailableReason) || isSubmitting}
          onChange={(event) => setSelectedStepKey(event.target.value)}
          className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-900 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
        >
          {options.map((option) => (
            <option key={option.key} value={option.key}>
              {option.order}. {option.label} ({repairStatusLabels[option.status]})
              {option.key === currentStepKey ? " — 현재" : ""}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="manual-step-reason" className="text-xs text-zinc-500 dark:text-zinc-400">
          변경 사유 *
        </label>
        <textarea
          id="manual-step-reason"
          rows={2}
          value={reason}
          disabled={Boolean(unavailableReason) || isSubmitting}
          onChange={(event) => setReason(event.target.value)}
          className="w-full rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-900 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
        />
      </div>

      {message && (
        <p
          role={message.type === "error" ? "alert" : "status"}
          aria-live="polite"
          className={
            message.type === "error"
              ? "rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-400"
              : "rounded-md border border-green-200 bg-green-50 p-2 text-xs text-green-700 dark:border-green-900 dark:bg-green-950 dark:text-green-400"
          }
        >
          {message.text}
        </p>
      )}

      <div className="flex items-center justify-end gap-2">
        {!unavailableReason && isUnchanged && (
          <span className="text-xs text-zinc-500 dark:text-zinc-400">현재와 다른 단계를 선택해 주세요.</span>
        )}
        {!unavailableReason && !isUnchanged && isReasonEmpty && (
          <span className="text-xs text-zinc-500 dark:text-zinc-400">변경 사유를 입력해 주세요.</span>
        )}
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!canSubmit}
          className="rounded-md bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {isSubmitting ? "변경 중..." : "단계 변경"}
        </button>
      </div>
      </div>
    </details>
  );
}
