"use client";

import { useEffect, useId, useRef } from "react";

import { UNSAVED_LEAVE_CONFIRM_TITLE } from "@/lib/domain/unsaved-leave-guard";

/**
 * ============================================================================
 * 🔴 **저장 안 된 내용을 두고 나가려 할 때 묻는 창** (2026-11-01)
 * ============================================================================
 * 사용자 요구: 「… [저장되지 않는 내용이 있습니다. 저장하시겠습니까?] 라는 팝업이
 * 뜨면서 … 선택할 수 있도록 해줘.」 단추 셋도 사용자가 정했다 —
 * **[저장] · [저장없이 나가기] · [취소]**.
 *
 * ── 🔴 왜 **공용**인가 ──────────────────────────────────────────────────
 * 이 저장소의 관례는 「확인 창은 화면마다 제 것을 만든다」이다. 창마다 할 말이
 * 다르기 때문이다 — 무엇을 지우는지, 무엇이 함께 사라지는지(`MasterDataDeleteDialog`
 * 가 `names` · `cascadeNote` 를 받는 그 까닭).
 *
 * 🔴 **여기는 그 관례의 예외다.** 이 창이 할 말은 화면마다 다르지 않다: 글자도 단추
 * 셋도 **사용자가 두 화면에 대해 한 번에 정한 것**이다. 두 벌로 두면 글자를 한쪽만
 * 고치는 날이 오고, 그때 「견적서에서는 이렇게 묻는데 보고서에서는 저렇게 묻는」
 * 화면이 된다 — 사람은 화면마다 다른 규칙이 있다고 배운다. 그래서 한 벌이다.
 * 🔵 그러면서도 **화면 쪽 말은 한 줄 받는다**(`destinationLabel`) — 어디로 나가는지는
 * 화면마다 다르고, 그것까지 공용으로 못 박으면 「목록으로」 같은 뭉개진 말이 된다.
 *
 * ── 🔴 [저장]이 **없을 때**가 있다 ──────────────────────────────────────
 * 저장할 수 없는 상태가 실제로 있다: 저장 충돌로 폼이 얼었을 때 · 양식을 못 읽었을 때 ·
 * 고칠 권한이 없을 때 · 이미 저장이 도는 중일 때. 그때 [저장]을 **잠긴 채로 두지 않고
 * 아예 그리지 않는다** — 못 하는 일을 잠긴 단추로 두면 「왜 안 눌리지」가 된다(이
 * 저장소의 규칙 — QuoteEditForm 의 [미리보기 · PDF] 가 같은 판단이다). 대신 그
 * 자리에 **왜 지금 저장할 수 없는지**를 한 줄 적는다.
 *
 * ── 창의 모양은 이 저장소의 것이다 ──────────────────────────────────────
 * 브라우저 기본 `confirm()` 을 쓰지 않는다(`master-data-trash-dialogs.tsx` 머리말).
 * 같은 native `<dialog>`/`showModal()`, 같은 색, **되돌릴 수 없는 쪽이 붉은 단추**.
 *
 * 🔴 **처음 초점은 [취소]다.** `showModal()` 은 첫 초점 가능한 것을 잡으므로 그냥 두면
 * [저장]에 초점이 간다 — 뒤로가기를 누른 손이 Enter 를 한 번 더 치면 그대로 저장이
 * 돈다. 단추 **차례는 사용자가 정한 그대로** 두고(저장 · 저장없이 나가기 · 취소),
 * 초점만 가장 안전한 쪽으로 옮긴다.
 *
 * 창은 자기 상태를 갖지 않는다 — 열림 여부는 부모가 소유한다.
 * ============================================================================
 */

export default function UnsavedLeaveConfirmDialog({
  isOpen,
  canSave,
  cannotSaveReason = null,
  destinationLabel,
  onSave,
  onLeave,
  onCancel,
}: {
  isOpen: boolean;
  /**
   * 🔴 지금 [저장]을 눌러 **실제로 저장이 도는가**. 거짓이면 그 단추를 그리지 않는다
   * (얼린 폼 · 못 읽은 양식 · 권한 없음 · 저장 중).
   */
  canSave: boolean;
  /** [저장]이 없을 때 그 자리에 적을 한 줄. 없으면 기본 문구. */
  cannotSaveReason?: string | null;
  /** 「저장없이 나가면 어디로 가는가」 — 예: `「보고서」 탭`. */
  destinationLabel: string;
  /** [저장] — 🔴 **창을 닫고 지금 화면의 저장 흐름을 그대로 탄다.** 실패하면 나가지 않는다. */
  onSave: () => void;
  /** [저장없이 나가기] — 적던 글을 버리고 나간다. */
  onLeave: () => void;
  /** [취소] — 🔴 나가기를 그만둔다. **적던 글은 한 글자도 건드리지 않는다.** */
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
        // Esc 로 닫는 것도 같은 길을 지난다 — 그래야 부모의 상태와 창의 열림 여부가
        // 갈라지지 않는다(휴지통 창들과 같은 규칙). Esc 는 **그만두기**다.
        event.preventDefault();
        onCancel();
      }}
      className="w-full max-w-md rounded-lg border border-red-300 bg-white p-4 text-left text-zinc-900 backdrop:bg-black/40 dark:border-red-900 dark:bg-zinc-900 dark:text-zinc-50"
    >
      <h2 id={titleId} className="text-sm font-semibold text-red-700 dark:text-red-400">
        {UNSAVED_LEAVE_CONFIRM_TITLE}
      </h2>
      {/* 🔴 「사라진다」를 돌려 말하지 않는다 — "저장되지 않습니다" 는 사라진다는 뜻을
          알려 주지 않는다(사람은 「어딘가 남아 있겠지」로 읽는다). 두 화면 다 적던 글이
          어디에도 임시보관되지 않는다. */}
      <p className="mt-2 text-sm font-medium text-red-700 dark:text-red-400">
        [저장없이 나가기]를 누르면 지금 적은 내용이 사라집니다. 다시 돌아와도 되살릴 수 없습니다.
      </p>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        [저장]을 누르면 저장한 뒤 {destinationLabel}(으)로 나갑니다. [취소]를 누르면 적던 자리로
        돌아갑니다.
      </p>
      {!canSave && (
        <p className="mt-2 text-sm text-amber-700 dark:text-amber-400">
          {cannotSaveReason ?? "지금은 저장할 수 없습니다. [취소]를 눌러 화면의 안내를 확인해 주세요."}
        </p>
      )}

      {/* 🔴 차례는 사용자가 정한 그대로다 — [저장] · [저장없이 나가기] · [취소]. */}
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        {canSave && (
          <button
            type="button"
            onClick={onSave}
            className="rounded-md bg-primary-900 px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 dark:bg-primary-100 dark:text-zinc-900"
          >
            저장
          </button>
        )}
        <button
          type="button"
          onClick={onLeave}
          className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700"
        >
          저장없이 나가기
        </button>
        {/* 🔴 autoFocus 는 **가장 안전한 쪽**에 둔다(위 머리말). */}
        <button
          type="button"
          autoFocus
          onClick={onCancel}
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          취소
        </button>
      </div>
    </dialog>
  );
}
