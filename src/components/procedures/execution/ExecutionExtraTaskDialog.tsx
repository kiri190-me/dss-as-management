"use client";

import { useEffect, useRef, useState } from "react";
import ExecutionExtraTaskForm from "./ExecutionExtraTaskForm";

/**
 * **[추가 작업 등록]** — 「절차 흐름」 상자의 단추와 그것이 여는 창
 * (2026-11-02, 조각 10).
 *
 * ──────────────────────────────────────────────────────────────────────
 * 🔴 **자리만 옮겼다** — 폼의 속은 한 줄도 안 건드렸다
 * ──────────────────────────────────────────────────────────────────────
 * 전에는 같은 폼이 화면 아래쪽에 점선 상자로 **늘 펼쳐져** 있었다. 쓰는 때는
 * 드문데 자리는 늘 차지했고, 짝인 [전체 단계 보기]와 멀리 떨어져 있어서 둘을
 * 한 상자에 모으라는 요구가 나왔다(사용자 결정 — 「[전체 단계 보기]와 [추가 작업
 * 등록]은 [절차 흐름] 상자에 버튼으로 만들어줘」).
 *
 * 🔵 안에 들어가는 것은 **지금 그 폼 그대로**다(ExecutionExtraTaskForm) — 노드
 * 갈래를 고르고 그림에 잇는 일은 **다음 조각**의 몫이다.
 *
 * 🔴 창에 제목을 따로 안 적는다. 폼이 제 제목(「추가 작업 등록」)을 이미 들고
 * 있어서, 여기 또 적으면 같은 글자가 두 줄로 겹친다 — 읽는 이름은 aria-label 로만
 * 준다.
 *
 * 🔴 등록이 끝나면 **창을 닫는다**. 모달 창은 브라우저의 top layer 에 서므로,
 * 닫지 않으면 등록 성공을 알리는 저장 팝업이 창 뒤로 가려진다(폼의 onSaved 주석).
 */
export default function ExecutionExtraTaskDialog({
  executionId,
  eligible,
}: {
  executionId: string;
  /** 🔴 못 쓰는 사람에게는 단추 자체가 안 선다 — 폼이 전부터 같은 잣대로 null 을 돌려줬다. */
  eligible: boolean;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (isOpen && !dialog.open) dialog.showModal();
    else if (!isOpen && dialog.open) dialog.close();
  }, [isOpen]);

  if (!eligible) return null;

  return (
    <>
      <button
        type="button"
        data-execution-extra-task-trigger
        onClick={() => setIsOpen(true)}
        className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
      >
        추가 작업 등록
      </button>

      <dialog
        ref={dialogRef}
        aria-label="추가 작업 등록"
        onCancel={(event) => {
          event.preventDefault();
          setIsOpen(false);
        }}
        className="w-[min(32rem,95vw)] rounded-lg border border-zinc-200 bg-white p-4 text-zinc-900 backdrop:bg-black/40 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50"
      >
        <ExecutionExtraTaskForm executionId={executionId} eligible={eligible} onSaved={() => setIsOpen(false)} />
        <div className="mt-3 flex justify-end">
          <button
            type="button"
            onClick={() => setIsOpen(false)}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            닫기
          </button>
        </div>
      </dialog>
    </>
  );
}
