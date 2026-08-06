"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { resolveValidationIssueWithoutGraphChangeAction } from "@/lib/server/actions/procedure-validation-resolutions";

const PRESETS: { label: string; outcome: "RESOLVED_NO_CHANGE" | "DEFERRED"; note: string }[] = [
  { label: "문제없음으로 확인", outcome: "RESOLVED_NO_CHANGE", note: "문제없음으로 확인함." },
  { label: "원본 절차가 단일 경로임", outcome: "RESOLVED_NO_CHANGE", note: "원본 절차가 단일 경로임을 확인함 — 추가 분기가 필요하지 않음." },
  { label: "장식 도형으로 확인", outcome: "RESOLVED_NO_CHANGE", note: "원본 도면 상 장식용 도형으로 확인됨 — 실제 분기가 아님." },
  { label: "업무 확인 필요로 보류", outcome: "DEFERRED", note: "업무 담당자 확인이 필요하여 보류함." },
];

/**
 * Resolve (or defer) a validation issue without touching the graph
 * (Phase 3A). The 4 preset buttons are canned starting text for the
 * required note, not separate machine-readable outcomes — only
 * RESOLVED_NO_CHANGE and DEFERRED exist as resolution_status values here;
 * DEFERRED keeps blocking publication, RESOLVED_NO_CHANGE does not (see
 * the outcome hint rendered below the radio group).
 */
export default function NoChangeResolutionForm({ issueId }: { issueId: string }) {
  const router = useRouter();
  const [outcome, setOutcome] = useState<"RESOLVED_NO_CHANGE" | "DEFERRED">("RESOLVED_NO_CHANGE");
  const [note, setNote] = useState("");
  const [businessConfirmationReference, setBusinessConfirmationReference] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleSubmit() {
    if (note.trim().length === 0) {
      setErrorMessage("해결 메모는 필수입니다.");
      return;
    }
    setIsSubmitting(true);
    setErrorMessage(null);
    const result = await resolveValidationIssueWithoutGraphChangeAction({
      issueId,
      outcome,
      resolutionNote: note.trim(),
      businessConfirmationReference: businessConfirmationReference.trim() || null,
    });
    setIsSubmitting(false);
    if (!result.ok) {
      setErrorMessage(result.message);
      return;
    }
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">변경 없이 처리</h3>

      <div className="flex flex-wrap gap-2">
        {PRESETS.map((p) => (
          <button
            key={p.label}
            type="button"
            onClick={() => {
              setOutcome(p.outcome);
              setNote(p.note);
            }}
            className="rounded-full border border-zinc-300 px-3 py-1 text-xs text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            {p.label}
          </button>
        ))}
      </div>

      <fieldset className="flex gap-4 text-xs text-zinc-600 dark:text-zinc-400">
        <legend className="sr-only">처리 결과</legend>
        <label className="flex items-center gap-1.5">
          <input type="radio" checked={outcome === "RESOLVED_NO_CHANGE"} onChange={() => setOutcome("RESOLVED_NO_CHANGE")} />
          해결됨 (변경 없음) — 게시 차단 해제됨
        </label>
        <label className="flex items-center gap-1.5">
          <input type="radio" checked={outcome === "DEFERRED"} onChange={() => setOutcome("DEFERRED")} />
          보류 — 게시는 계속 차단됨
        </label>
      </fieldset>

      <label className="flex flex-col gap-1 text-xs text-zinc-500 dark:text-zinc-400">
        해결 메모 (필수)
        <textarea
          rows={3}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="w-full rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
        />
      </label>

      <label className="flex flex-col gap-1 text-xs text-zinc-500 dark:text-zinc-400">
        업무 확인 참조 (선택 — 예: 담당자 확인 일자/대화 참조)
        <input
          type="text"
          value={businessConfirmationReference}
          onChange={(e) => setBusinessConfirmationReference(e.target.value)}
          className="rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
        />
      </label>

      {errorMessage && <p className="text-xs text-red-600 dark:text-red-400">{errorMessage}</p>}

      <div>
        <button
          type="button"
          disabled={isSubmitting || note.trim().length === 0}
          onClick={() => void handleSubmit()}
          className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          {isSubmitting ? "처리 중..." : "적용"}
        </button>
      </div>
    </div>
  );
}
