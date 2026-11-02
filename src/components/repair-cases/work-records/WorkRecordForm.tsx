"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { showSavePopup } from "@/components/common/SavePopup";
import { createWorkRecordAction } from "@/lib/server/actions/repair-case-work-records";
import { WORK_RECORD_KIND_CODES, type WorkRecordKind } from "@/lib/domain/types";
import { useUiText } from "@/components/providers/UiTextProvider";
import { generateClientUuid } from "@/lib/client-uuid";

export default function WorkRecordForm({
  repairCaseId,
  currentStepLabel,
  currentStepOrder,
  procedureNodeOptions,
  defaultProcedureNodeId,
  disabledReason,
}: {
  repairCaseId: string;
  currentStepLabel: string;
  currentStepOrder: number | null;
  /**
   * 붙일 수 있는 절차 항목들. 줄에 뜨는 글자까지 도메인이 만들어 온다
   * (buildWorkRecordProcedureLink) — 번호·상태를 여기서 다시 꾸미지 않는다.
   */
  procedureNodeOptions: { id: string; label: string }[];
  /**
   * 처음 골라져 있을 것 = 「지금 할 일」 노드. null 이면 「연결 안 함」.
   *
   * 🔴 전에는 언제나 「연결 안 함」이 기본이라, 사람이 매번 손으로 바꿔야 이어졌고
   * **대부분 안 이어졌다.** 절차를 밟으며 적은 기록인데 무엇을 하다 적었는지가
   * 안 남았다.
   */
  defaultProcedureNodeId: string | null;
  /** Non-null when creation is currently disallowed (e.g. locked case, not the assigned engineer) — the form still renders, but input/submit are disabled and this reason is shown. Server re-checks regardless. */
  disabledReason: string | null;
}) {
  const router = useRouter();
  // 고르는 값은 코드(WORK_RECORD_KIND_CODES)로 두고 보여 줄 문구만 갈아 끼운다.
  const uiText = useUiText();
  const [recordKind, setRecordKind] = useState<WorkRecordKind>("GENERAL");
  const [memo, setMemo] = useState("");
  const [selectedNodeId, setSelectedNodeId] = useState(defaultProcedureNodeId ?? "");
  const [clientRequestId, setClientRequestId] = useState(() => generateClientUuid());
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
      recordKind,
      relatedProcedureExecutionNodeId: selectedNodeId || null,
      clientRequestId,
    });
    setIsSubmitting(false);
    if (!result.ok) {
      setErrorMessage(result.message);
      return;
    }
    setRecordKind("GENERAL");
    setMemo("");
    // 🔴 저장한 뒤에도 기본값으로 **되돌린다** — 빈 값("연결 안 함")으로 비우면
    // 둘째 기록부터 다시 손으로 골라야 하고, 그것이 바로 고치려던 증상이다.
    // (router.refresh() 가 서버에서 새 「지금 할 일」을 받아 오면 이 칸은 폼이
    // 다시 마운트될 때 그 값으로 선다.)
    setSelectedNodeId(defaultProcedureNodeId ?? "");
    setClientRequestId(generateClientUuid());
    router.refresh();
    showSavePopup({ message: "작업 기록을 등록했습니다.", redirectTo: null });
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        현재 단계: {currentStepOrder !== null ? `${currentStepOrder}. ` : ""}
        {currentStepLabel}
      </p>

      <div className="flex flex-col gap-1">
        <label htmlFor="work-record-kind-select" className="text-xs text-zinc-500 dark:text-zinc-400">
          기록 구분
        </label>
        <select
          id="work-record-kind-select"
          value={recordKind}
          onChange={(event) => setRecordKind(event.target.value as WorkRecordKind)}
          disabled={disabled || isSubmitting}
          className="w-full max-w-sm rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-900 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
        >
          {WORK_RECORD_KIND_CODES.map((code) => (
            <option key={code} value={code}>
              {uiText.workRecordKind[code]}
            </option>
          ))}
        </select>
      </div>

      <textarea
        rows={4}
        value={memo}
        onChange={(event) => setMemo(event.target.value)}
        disabled={disabled || isSubmitting}
        placeholder="점검 내용, 고객 증상 재현, 확인한 원인, 분해/조립 내용, 부품 교체 내용, 테스트 결과, 일본 본사 지시 반영, 다음 작업 계획 등 실제 작업한 내용을 입력하세요."
        className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
      />

      {procedureNodeOptions.length > 0 && (
        <div className="flex flex-col gap-1">
          <label htmlFor="work-record-node-select" className="text-xs text-zinc-500 dark:text-zinc-400">
            관련 절차 항목
          </label>
          <select
            id="work-record-node-select"
            value={selectedNodeId}
            onChange={(event) => setSelectedNodeId(event.target.value)}
            disabled={disabled || isSubmitting}
            className="w-full max-w-sm rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-900 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
          >
            {/* 🔴 「연결 안 함」은 **남겨 둔다** — 절차와 무관한 기록이 있다
                (고객 통화, 입고 확인 같은 것). 없애면 그런 기록이 엉뚱한 노드에
                붙고, 그쪽이 안 붙은 것보다 나쁘다. */}
            <option value="">연결 안 함</option>
            {procedureNodeOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
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
        className="self-start rounded-md bg-primary-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-800 disabled:opacity-50 dark:bg-primary-50 dark:text-zinc-900 dark:hover:bg-primary-200"
      >
        {isSubmitting ? "저장하는 중..." : "작업 기록 추가"}
      </button>
    </div>
  );
}
