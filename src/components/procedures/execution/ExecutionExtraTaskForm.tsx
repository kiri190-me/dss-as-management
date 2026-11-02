"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { showSavePopup } from "@/components/common/SavePopup";
import { addExecutionExtraTaskAction } from "@/lib/server/actions/procedure-case-execution";

/**
 * 🔵 2026-11-02(조각 10) — **폼 자체는 그대로**이고 사는 자리만 바뀌었다. 전에는
 * 화면 아래에 점선 상자로 늘 펼쳐져 있었고, 이제 「절차 흐름」 상자의
 * [추가 작업 등록] 단추가 여는 창 안에 들어간다(ExecutionExtraTaskDialog).
 *
 * 🔴 그래서 `onSaved` 하나가 늘었다. 모달 창은 브라우저의 top layer 에 서기
 * 때문에, 등록이 끝나고 뜨는 저장 팝업이 **창 뒤로 가려진다** — 창을 닫아야
 * 사람이 그 글자를 본다. 부르는 쪽이 안 넘기면 지금까지와 똑같이 동작한다.
 */
export default function ExecutionExtraTaskForm({
  executionId,
  eligible,
  onSaved,
}: {
  executionId: string;
  eligible: boolean;
  onSaved?: () => void;
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
    // 🔴 저장 팝업보다 **먼저** 닫는다 — 모달 창이 떠 있으면 그 위의 팝업이
    // 가려져서, 등록은 됐는데 아무 말도 못 본 화면이 된다.
    onSaved?.();
    router.refresh();
    showSavePopup({ message: "추가 작업을 등록했습니다.", redirectTo: null });
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
