"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { reopenValidationIssueAction, rollbackValidationIssueEdgeAction } from "@/lib/server/actions/procedure-validation-resolutions";

/**
 * Reopen and rollback are always two separate explicit actions (Phase 3A
 * requirement) — reopening alone never removes an edge. This component
 * only ever shows the rollback button once the issue is UNRESOLVED again
 * (i.e. after a reopen), never as an alternative to it.
 */
export default function ReopenRollbackControls({
  issueId,
  resolutionStatus,
  hasGraphChangeToRollback,
}: {
  issueId: string;
  resolutionStatus: string;
  hasGraphChangeToRollback: boolean;
}) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [mode, setMode] = useState<"REOPEN" | "ROLLBACK" | null>(null);

  async function handleReopen() {
    if (note.trim().length === 0) {
      setErrorMessage("재검토 재개 사유는 필수입니다.");
      return;
    }
    setIsSubmitting(true);
    setErrorMessage(null);
    const result = await reopenValidationIssueAction({ issueId, note: note.trim() });
    setIsSubmitting(false);
    if (!result.ok) {
      setErrorMessage(result.message);
      return;
    }
    setMode(null);
    setNote("");
    router.refresh();
  }

  async function handleRollback() {
    if (note.trim().length === 0) {
      setErrorMessage("되돌리기 사유는 필수입니다.");
      return;
    }
    setIsSubmitting(true);
    setErrorMessage(null);
    const result = await rollbackValidationIssueEdgeAction({ issueId, note: note.trim() });
    setIsSubmitting(false);
    if (!result.ok) {
      setErrorMessage(result.message);
      return;
    }
    setMode(null);
    setNote("");
    router.refresh();
  }

  if (resolutionStatus === "UNRESOLVED") {
    if (!hasGraphChangeToRollback) return null;
    return (
      <div className="flex flex-col gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs dark:border-amber-900 dark:bg-amber-950">
        <p className="text-amber-800 dark:text-amber-300">
          이 이슈는 재검토를 위해 다시 열렸습니다. 이전에 추가된 분기는 자동으로 제거되지 않았습니다 — 되돌리려면 별도로 명시적으로 실행해야 합니다.
        </p>
        {mode === "ROLLBACK" ? (
          <div className="flex flex-col gap-2">
            <textarea
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="되돌리기 사유 (필수)"
              className="w-full rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
            />
            {errorMessage && <p className="text-red-600 dark:text-red-400">{errorMessage}</p>}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void handleRollback()}
                disabled={isSubmitting}
                className="rounded-md bg-red-600 px-3 py-1.5 text-white hover:bg-red-700 disabled:opacity-50"
              >
                {isSubmitting ? "처리 중..." : "분기 되돌리기 확정"}
              </button>
              <button type="button" onClick={() => setMode(null)} disabled={isSubmitting} className="rounded-md border border-zinc-300 px-3 py-1.5 dark:border-zinc-700">
                취소
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setMode("ROLLBACK")}
            className="self-start rounded-md border border-red-300 px-3 py-1.5 text-red-700 hover:bg-red-100 dark:border-red-800 dark:text-red-400"
          >
            분기 되돌리기 (별도 명시적 작업)
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {mode === "REOPEN" ? (
        <div className="flex flex-col gap-2 rounded-lg border border-zinc-200 bg-white p-3 text-xs dark:border-zinc-800 dark:bg-zinc-900">
          <textarea
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="재검토 재개 사유 (필수)"
            className="w-full rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
          />
          {errorMessage && <p className="text-red-600 dark:text-red-400">{errorMessage}</p>}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void handleReopen()}
              disabled={isSubmitting}
              className="rounded-md bg-zinc-900 px-3 py-1.5 text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900"
            >
              {isSubmitting ? "처리 중..." : "재검토 재개 확정"}
            </button>
            <button type="button" onClick={() => setMode(null)} disabled={isSubmitting} className="rounded-md border border-zinc-300 px-3 py-1.5 dark:border-zinc-700">
              취소
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setMode("REOPEN")}
          className="self-start rounded-md border border-zinc-300 px-3 py-1.5 text-xs text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          재검토 재개 (Reopen)
        </button>
      )}
    </div>
  );
}
