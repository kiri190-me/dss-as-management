"use client";

import { useEffect, useRef } from "react";

/**
 * ============================================================================
 * 읽어야 하는 알림 — **사람이 닫아야 닫힌다.**
 * ============================================================================
 * 🔴 **이것을 SavePopup 과 바꿔 끼우지 마라.** SavePopup(showSavePopup)은 저장이
 * 끝났다는 **성공 알림 전용**이고 `SAVE_POPUP_VISIBLE_MS`(0.5초) 뒤에 저절로
 * 닫힌다. 읽어야 하는 경고를 그것으로 띄우면 사람이 글을 다 읽기 전에 사라진다 —
 * 이 저장소에서 실제로 겪은 일이다.
 *
 * 🔴 브라우저 기본 `alert()` · `confirm()` 도 쓰지 않는다. 그 둘은 페이지를
 * 통째로 멈춰 세우고, 글꼴도 말투도 이 앱의 것이 아니다.
 *
 * ── 왜 네이티브 `<dialog>` 인가 ────────────────────────────────────────
 * 이 앱의 다른 대화상자들과 같은 방식이라 **그 위에** 뜨고(최상위 층), 떠 있는
 * 동안 뒤 화면이 눌리지 않는다. `showModal()` 이 초점을 팝업 안으로 옮겨 주므로
 * 키보드만 쓰는 사람도 바로 닫을 수 있고, `Esc` 는 `onCancel` 로 받는다.
 *
 * 스스로 닫는 타이머가 **없다.** 닫는 길은 [닫기] 와 `Esc` 둘뿐이다.
 * ============================================================================
 */
export default function NoticePopup({
  title,
  lines,
  onClose,
  closeLabel = "닫기",
}: {
  title: string;
  /** 문단들. 줄마다 한 문장씩 적는다. */
  lines: string[];
  /** 닫을 때 부른다 — 띄운 쪽이 그리기를 멈춘다(열림 여부의 주인은 React 상태다). */
  onClose: () => void;
  closeLabel?: string;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  return (
    <dialog
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      // Esc. 기본 동작으로 닫으면 React 는 아직 열려 있다고 알아 다시 못 연다.
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      className="m-auto max-w-md rounded-xl border border-amber-300 bg-white px-6 py-5 text-left shadow-xl outline-none backdrop:bg-black/30"
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-100 text-base font-bold text-amber-700"
        >
          !
        </span>
        <div className="flex flex-col gap-2">
          <h2 className="text-sm font-bold text-zinc-900">{title}</h2>
          {lines.map((line) => (
            <p key={line} className="text-sm leading-relaxed text-zinc-700">
              {line}
            </p>
          ))}
        </div>
      </div>
      <div className="mt-4 flex justify-end">
        <button
          type="button"
          autoFocus
          onClick={onClose}
          className="rounded-lg border border-zinc-300 bg-white px-4 py-2 text-xs font-semibold text-zinc-800 hover:border-zinc-900"
        >
          {closeLabel}
        </button>
      </div>
    </dialog>
  );
}
