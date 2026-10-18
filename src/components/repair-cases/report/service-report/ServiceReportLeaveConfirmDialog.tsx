"use client";

import { useEffect, useId, useRef } from "react";

/**
 * ============================================================================
 * 🔴 [취소] — **저장하지 않고 나가기 전에 묻는 창** (2026-10-19)
 * ============================================================================
 * 사용자 요구: 「[저장] 왼쪽에 [취소] 버튼을 만들어줘. 그 버튼을 누르면 지금 내용이
 * 저장되지 않은 채 보고서 탭으로 빠져나오게 해줘.」
 *
 * ── 🔴 왜 묻는가 ────────────────────────────────────────────────────────
 * 같은 날 **브라우저 임시보관을 걷어냈다**(`domain/service-report-draft.ts` 머리말).
 * 예전에는 저장하지 않고 나가도 적던 글이 그 브라우저에 남아 다시 들어오면
 * 되살아났다 — 이제 **돌아올 길이 없다.** 나가는 순간 사라진다. 그 사실이 사람에게
 * 보이지 않으면, 임시보관을 없앤 것이 그대로 사고가 된다.
 *
 * 그래서 글에 「나가면 적은 내용이 사라집니다」가 **그대로** 들어 있다. 돌려 말하지
 * 않는다("저장되지 않습니다"는 사라진다는 뜻을 알려 주지 않는다 — 사람은 「어딘가
 * 남아 있겠지」로 읽는다).
 *
 * ── 🔴 고친 것이 있을 때만 뜬다 ─────────────────────────────────────────
 * 띄울지 말지는 부르는 쪽이 정한다(`ServiceReportForm` 의 `serviceReportValuesChanged`).
 * 늘 물으면 사람은 읽지 않고 누르는 손을 배우고, 그러면 정작 글이 사라질 때도 그냥
 * 넘긴다.
 *
 * ── 창의 모양은 이 저장소의 것이다 ──────────────────────────────────────
 * 브라우저 기본 `confirm()` 을 쓰지 않는다 — 화면마다 확인 창의 생김새가 다르면
 * 사람은 화면마다 다른 규칙이 있다고 배운다(`common/master-data-trash-dialogs.tsx`
 * 머리말). 같은 native `<dialog>`/`showModal()`, 같은 색, 같은 단추 자리를 쓴다.
 * **되돌릴 수 없는 쪽이 붉은 단추**인 것도 그 파일의 규칙 그대로다.
 *
 * 창은 자기 상태를 갖지 않는다 — 열림 여부는 부모가 소유한다.
 * ============================================================================
 */

export default function ServiceReportLeaveConfirmDialog({
  isOpen,
  onConfirm,
  onCancel,
}: {
  isOpen: boolean;
  /** 저장하지 않고 「보고서」 탭으로 나간다. */
  onConfirm: () => void;
  /** 🔴 나가기를 그만둔다 — **적던 글은 한 글자도 건드리지 않는다.** */
  onCancel: () => void;
}) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (isOpen && !dialog.open) {
      dialog.showModal();
    } else if (!isOpen && dialog.open) {
      dialog.close();
    }
  }, [isOpen]);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onCancel={(event) => {
        // Esc 로 닫는 것도 같은 길을 지난다 — 그래야 부모의 상태와 창의 열림
        // 여부가 갈라지지 않는다(휴지통 창들과 같은 규칙).
        event.preventDefault();
        onCancel();
      }}
      className="w-full max-w-md rounded-lg border border-red-300 bg-white p-4 text-zinc-900 backdrop:bg-black/40 dark:border-red-900 dark:bg-zinc-900 dark:text-zinc-50"
    >
      <h2 id={titleId} className="text-sm font-semibold text-red-700 dark:text-red-400">
        저장하지 않고 「보고서」 탭으로 나가시겠습니까?
      </h2>
      <p className="mt-2 text-sm font-medium text-red-700 dark:text-red-400">
        지금 나가면 적은 내용이 사라집니다. 다시 돌아와도 되살릴 수 없습니다.
      </p>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        남기려면 창을 닫고 [저장]을 눌러 주세요. 마지막으로 저장한 내용은 그대로 남아 있습니다.
      </p>

      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          돌아가서 계속 적기
        </button>
        <button
          type="button"
          onClick={onConfirm}
          className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700"
        >
          저장하지 않고 나가기
        </button>
      </div>
    </dialog>
  );
}
