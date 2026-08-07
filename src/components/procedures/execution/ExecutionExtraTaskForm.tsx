"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { addExecutionExtraTaskAction } from "@/lib/server/actions/procedure-case-execution";

export default function ExecutionExtraTaskForm({
  executionId,
  eligible,
}: {
  executionId: string;
  eligible: boolean;
}) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [instructions, setInstructions] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (!eligible) return null;

  async function handleSubmit() {
    if (!title.trim() || isSubmitting) return;
    setIsSubmitting(true);
    setErrorMessage(null);
    const result = await addExecutionExtraTaskAction({ executionId, title, instructions: instructions || null });
    setIsSubmitting(false);
    if (!result.ok) {
      setErrorMessage(result.message);
      return;
    }
    setTitle("");
    setInstructions("");
    router.refresh();
  }

  return (
    <div className="rounded-lg border border-dashed border-zinc-300 p-3 dark:border-zinc-700">
      <h3 className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">추가 작업 등록</h3>
      <div className="mt-2 flex flex-col gap-2">
        <input
          type="text"
          placeholder="작업 제목"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          className="w-full rounded-md border border-zinc-200 bg-white px-2 py-1 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
        />
        <textarea
          placeholder="작업 내용 (선택)"
          rows={2}
          value={instructions}
          onChange={(event) => setInstructions(event.target.value)}
          className="w-full rounded-md border border-zinc-200 bg-white px-2 py-1 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
        />
        <button
          type="button"
          onClick={() => void handleSubmit()}
          disabled={isSubmitting || !title.trim()}
          className="w-fit rounded-md border border-zinc-300 px-2.5 py-1 text-xs text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          {isSubmitting ? "등록하는 중..." : "추가 작업 등록"}
        </button>
        {errorMessage && <p className="text-xs text-red-600 dark:text-red-400">{errorMessage}</p>}
      </div>
    </div>
  );
}
