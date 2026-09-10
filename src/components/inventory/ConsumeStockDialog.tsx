"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { consumeStockAction } from "@/lib/server/actions/inventory";
import { createPartIssueRequestAction } from "@/lib/server/actions/inventory-part-issue-requests";
import {
  PART_ISSUE_REQUEST_BUTTON_LABEL,
  PART_ISSUE_REQUEST_DIALOG_NOTICE,
  PART_ISSUE_REQUEST_SUBMIT_LABEL,
} from "./part-issue-approval-texts";

export type RepairCaseOption = { id: string; intakeNumber: string; assignedEngineerId: string | null };

/**
 * 사용 (USE) dialog. AS_ENGINEER can never submit a destination-only USE in
 * Phase 5B-2 (plan §9) — the mode toggle still offers it for other roles,
 * but the server re-checks role/assignment/lock independently regardless
 * of what this dialog allows through, so hiding it here is a UX
 * convenience only, never the enforcement boundary.
 *
 * 🔴 **「부품 불출」 승인 절차가 있으면 이 창은 신청서가 된다** — 적는 칸은 한
 * 글자도 달라지지 않고(수리 건이나 사용처 · 수량 · 사유), 끝에서 재고를 빼는
 * 대신 결재를 올린다. 판이 없으면 지금까지와 완전히 같다.
 *
 * 🔴 판이 있는지 **여기서 판정하지 않는다.** 서버가 문을 다는 데 쓰는 그 판정을
 * 서버 컴포넌트가 계산해 프롭으로 내려보낸다(inventory/[id]/page.tsx).
 */
export default function ConsumeStockDialog({
  isOpen,
  onClose,
  partStockBalanceId,
  expectedVersion,
  repairCaseOptions,
  actingUserRole,
  approvalRequired,
}: {
  isOpen: boolean;
  onClose: () => void;
  partStockBalanceId: string;
  expectedVersion: number;
  repairCaseOptions: RepairCaseOption[];
  actingUserRole: string;
  /** 참이면 이 창은 재고를 빼지 않고 **불출 승인 요청**을 올린다. */
  approvalRequired: boolean;
}) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const canUseDestinationOnly = actingUserRole !== "AS_ENGINEER";
  const [mode, setMode] = useState<"CASE" | "DESTINATION">("CASE");
  const [repairCaseId, setRepairCaseId] = useState("");
  const [destinationNote, setDestinationNote] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [reason, setReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (isOpen && !dialog.open) {
      setMode("CASE");
      setRepairCaseId(repairCaseOptions[0]?.id ?? "");
      setDestinationNote("");
      setQuantity("1");
      setReason("");
      setErrorMessage(null);
      dialog.showModal();
    } else if (!isOpen && dialog.open) {
      dialog.close();
    }
  }, [isOpen, repairCaseOptions]);

  async function handleSubmit() {
    const parsedQuantity = Number(quantity);
    if (!Number.isInteger(parsedQuantity) || parsedQuantity <= 0) {
      setErrorMessage("수량은 1 이상의 정수여야 합니다.");
      return;
    }
    if (mode === "CASE" && !repairCaseId) {
      setErrorMessage("수리 건을 선택해 주세요.");
      return;
    }
    if (mode === "DESTINATION" && !destinationNote.trim()) {
      setErrorMessage("사용처를 입력해 주세요.");
      return;
    }
    setIsSubmitting(true);
    setErrorMessage(null);
    const result = approvalRequired
      ? await createPartIssueRequestAction({
          kind: "DIRECT_USE",
          partStockBalanceId,
          quantity: parsedQuantity,
          repairCaseId: mode === "CASE" ? repairCaseId : null,
          destinationNote: mode === "DESTINATION" ? destinationNote : null,
          // 절차 실행에서 올라온 사용이 아니다 — 그 길은 따로 있다.
          procedureExecutionNodeId: null,
          requestReason: reason || null,
          // 🔴 expectedVersion 을 보내지 않는다. 신청은 재고를 건드리지 않으므로
          // 「지금 이 잔량 행이 그대로인가」를 물을 이유가 없고, 물으면 결재를
          // 기다리는 동안 남이 입고만 해도 신청이 막힌다. 그 검사는 **실행**이
          // 자기 트랜잭션 안에서 잠그고 한다.
        })
      : await consumeStockAction({
          partStockBalanceId,
          quantity: parsedQuantity,
          expectedVersion,
          repairCaseId: mode === "CASE" ? repairCaseId : null,
          destinationNote: mode === "DESTINATION" ? destinationNote : null,
          reason: reason || null,
        });
    setIsSubmitting(false);
    if (!result.ok) {
      // 서버가 준 이유를 그대로 보여 준다 — 뭉개면 사람은 승인 절차를 만들어야
      // 하는지, 재고를 기다려야 하는지 알 수 없다.
      setErrorMessage(result.message);
      return;
    }
    onClose();
    router.refresh();
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="consume-stock-dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!isSubmitting) onClose();
      }}
      className="w-full max-w-md rounded-lg border border-zinc-200 bg-white p-4 text-zinc-900 backdrop:bg-black/40 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50"
    >
      <h2 id="consume-stock-dialog-title" className="text-sm font-semibold">
        {approvalRequired ? PART_ISSUE_REQUEST_BUTTON_LABEL : "사용"}
      </h2>
      {approvalRequired && (
        <p className="mt-2 break-keep rounded-md bg-amber-50 px-2 py-1 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
          {PART_ISSUE_REQUEST_DIALOG_NOTICE}
        </p>
      )}

      {canUseDestinationOnly && (
        <div className="mt-3 flex gap-3 text-xs text-zinc-600 dark:text-zinc-300">
          <label className="flex items-center gap-1">
            <input type="radio" name="consume-mode" checked={mode === "CASE"} onChange={() => setMode("CASE")} />
            수리 건 연결
          </label>
          <label className="flex items-center gap-1">
            <input type="radio" name="consume-mode" checked={mode === "DESTINATION"} onChange={() => setMode("DESTINATION")} />
            사용처 직접 입력
          </label>
        </div>
      )}

      <div className="mt-3 flex flex-col gap-2">
        {mode === "CASE" ? (
          <label className="flex flex-col gap-1 text-xs text-zinc-500 dark:text-zinc-400">
            수리 건
            <select
              value={repairCaseId}
              onChange={(event) => setRepairCaseId(event.target.value)}
              className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
            >
              <option value="">선택하세요</option>
              {repairCaseOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.intakeNumber}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <label className="flex flex-col gap-1 text-xs text-zinc-500 dark:text-zinc-400">
            사용처
            <input
              type="text"
              placeholder="예: 상해수리소"
              value={destinationNote}
              onChange={(event) => setDestinationNote(event.target.value)}
              className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
            />
          </label>
        )}
        <label className="flex flex-col gap-1 text-xs text-zinc-500 dark:text-zinc-400">
          수량
          <input
            type="number"
            min={1}
            step={1}
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
            className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-zinc-500 dark:text-zinc-400">
          사유 (선택)
          <textarea
            rows={2}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
          />
        </label>
      </div>

      {errorMessage && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{errorMessage}</p>}

      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          disabled={isSubmitting}
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          취소
        </button>
        <button
          type="button"
          onClick={() => void handleSubmit()}
          disabled={isSubmitting}
          className="rounded-md bg-primary-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-800 disabled:opacity-50 dark:bg-primary-50 dark:text-zinc-900 dark:hover:bg-primary-200"
        >
          {isSubmitting ? "처리 중..." : approvalRequired ? PART_ISSUE_REQUEST_SUBMIT_LABEL : "사용"}
        </button>
      </div>
    </dialog>
  );
}
