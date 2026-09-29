"use client";

import { useEffect, useRef } from "react";
import { describeOrientation, type ImageOrientation } from "@/lib/domain/image-orientation";

/**
 * ============================================================================
 * 「돌린 대로 저장」 확인 창 — 되돌릴 수 없다는 것을 분명히 말한다
 * ============================================================================
 * 이 저장소의 확인 창 관행을 그대로 따른다(DeleteAttachmentDialog ·
 * RestoreAttachmentDialog와 같은 `<dialog>` + `showModal()`). `window.confirm` 을
 * 쓰지 않는 까닭은 세 가지다 — 글자를 꾸밀 수 없어 「되돌릴 수 없습니다」가
 * 파묻히고, 폰에서 브라우저 UI 로 뜨며, 처리 중 상태를 보여 줄 자리가 없다.
 *
 * 🔴 **크게 보기(AttachmentViewer) 위에 뜬다.** 그 화면이 `fixed inset-0 z-50`
 * 이지만 `showModal()` 로 연 `<dialog>` 는 브라우저의 맨 위 층(top layer)에
 * 그려지므로 z-index 를 다투지 않는다.
 *
 * 무엇을 하는 것인지 **방향을 글자로** 보여 준다 — 「저장」만 있으면 자기가 무엇을
 * 돌려 놓았는지 확인 창에서 다시 볼 방법이 없다.
 *
 * ── 🔴 한 장일 때와 여러 장일 때(2026-09-29) ────────────────────────────
 * 여러 장을 골라 한꺼번에 저장하는 길이 생겼다. 그래서 대상이 **언제나 목록**
 * (`targets`)이고, 길이가 1이면 지금까지와 한 글자도 같은 문장을 쓴다. 여럿이면
 * **몇 장인지를 경고 문장 안에** 넣는다 — 「원본 파일을 덮어씁니다」만으로는 몇
 * 장이 걸린 일인지 알 수 없고, 되돌릴 수 없는 일에서 그 숫자가 제일 중요하다.
 *
 * ── 🔴 일부만 실패한 것을 숨기지 않는다 ─────────────────────────────────
 * 한 장씩 차례로 저장하므로 「5장 중 3장 저장, 2장 실패」가 실제로 일어난다.
 * 그 숫자와 **어느 사진이 왜 막혔는지**를 이 창이 그대로 보여 준다(outcome).
 * 실패한 것은 고른 채로 남아 있어 그대로 다시 누를 수 있다.
 * ============================================================================
 */

/** 저장할 사진 한 장 — 무엇을 어느 방향으로 바꾸는가. */
export type SaveRotationTarget = {
  id: string;
  displayName: string;
  orientation: ImageOrientation;
};

/** 여러 장을 저장하고 난 결과. 🔴 반만 된 것을 뭉뚱그리지 않는다. */
export type SaveRotationOutcome = {
  total: number;
  saved: number;
  failures: { name: string; message: string }[];
};

/**
 * 「5장 중 3장 저장, 2장 실패」. 🔴 **어디까지 됐는지**가 한 줄로 읽혀야 한다 —
 * 「저장에 실패했습니다」만 남으면 다시 눌러도 되는지조차 알 수 없다.
 */
export function formatSaveOutcome(outcome: SaveRotationOutcome): string {
  return `${outcome.total}장 중 ${outcome.saved}장 저장, ${outcome.failures.length}장 실패`;
}

type SaveRotationDialogProps = {
  isOpen: boolean;
  /** 저장할 것들. 길이가 1이면 지금까지와 같은 한 장짜리 문장이다. */
  targets: readonly SaveRotationTarget[];
  isSubmitting: boolean;
  /** 여러 장이라 시간이 걸린다 — 어디까지 갔는지 보여 준다. */
  progress?: { current: number; total: number } | null;
  /** 저장이 막혔을 때 서버가 준 문장. 창을 닫지 않고 여기 보여 준다. */
  errorMessage: string | null;
  /** 여러 장 가운데 일부만 실패했을 때의 결과. */
  outcome?: SaveRotationOutcome | null;
  onConfirm: () => void;
  onCancel: () => void;
};

export default function SaveRotationDialog({
  isOpen,
  targets,
  isSubmitting,
  progress = null,
  errorMessage,
  outcome = null,
  onConfirm,
  onCancel,
}: SaveRotationDialogProps) {
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

  const count = targets.length;
  /** 한 장일 때는 그 한 장을 그대로 부른다 — 문장이 예전과 같아야 한다. */
  const single = count === 1 ? targets[0] : null;
  /** 진행을 보여 줄 때만 값이 있다 — 한 장짜리는 「저장 중...」 그대로다. */
  const busyProgress = isSubmitting && progress && progress.total > 1 ? progress : null;

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="save-rotation-dialog-title"
      onCancel={(event) => {
        // 저장 중에 Esc 로 닫히면 무엇이 저장됐는지 알 수 없게 된다.
        event.preventDefault();
        if (!isSubmitting) onCancel();
      }}
      className="w-full max-w-md rounded-lg border border-zinc-200 bg-white p-4 text-zinc-900 backdrop:bg-black/40 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50"
    >
      <h2 id="save-rotation-dialog-title" className="text-sm font-semibold">
        돌린 대로 원본에 저장
      </h2>

      {single ? (
        <>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            대상:{" "}
            <span className="font-medium text-zinc-900 dark:text-zinc-50">
              {single.displayName}
            </span>
          </p>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            바꿀 방향:{" "}
            <span className="font-medium text-zinc-900 dark:text-zinc-50">
              {describeOrientation(single.orientation)}
            </span>
          </p>
        </>
      ) : (
        <>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            대상: <span className="font-medium text-zinc-900 dark:text-zinc-50">{count}장</span>
          </p>
          {/*
            사진마다 방향이 다를 수 있다 — 「전부 가로로」는 이미 가로인 것을
            건드리지 않으므로 같은 묶음 안에서도 갈린다. 그래서 한 줄씩 적는다.
            길어지면 이 칸만 스크롤한다(창이 화면 밖으로 자라지 않게).
          */}
          <ul className="mt-1 max-h-40 overflow-y-auto text-xs text-zinc-600 dark:text-zinc-400">
            {targets.map((target) => (
              <li key={target.id} className="truncate">
                <span className="font-medium text-zinc-900 dark:text-zinc-50">
                  {target.displayName}
                </span>{" "}
                — {describeOrientation(target.orientation)}
              </li>
            ))}
          </ul>
        </>
      )}

      {/*
        🔴 이 문단이 이 창의 존재 이유다. 색과 굵기로 눈에 걸리게 두고, 무엇이
        함께 바뀌는지(목록의 작은 그림)도 함께 말한다 — 저장 뒤 목록이 달라 보이는
        것이 고장으로 오해되지 않게. 여러 장이면 **몇 장인지**가 이 문장에 든다.
      */}
      <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
        <strong className="font-semibold">
          {single
            ? "원본 파일을 덮어씁니다. 되돌릴 수 없습니다."
            : `${count}장의 원본을 덮어씁니다. 되돌릴 수 없습니다.`}
        </strong>
        <br />
        목록에 쓰는 작은 그림도 함께 새 방향으로 바뀝니다.
        {!single && (
          <>
            <br />한 장씩 차례로 저장합니다 — 도중에 막혀도 거기까지는 저장된 채로 남습니다.
          </>
        )}
      </p>

      {busyProgress && (
        <p role="status" className="mt-2 text-xs text-zinc-600 tabular-nums dark:text-zinc-400">
          저장 중… {busyProgress.current}/{busyProgress.total}장
        </p>
      )}

      {errorMessage && (
        <p
          role="alert"
          className="mt-2 rounded-md border border-red-200 bg-white px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-zinc-900 dark:text-red-400"
        >
          {errorMessage}
        </p>
      )}

      {outcome && (
        <div
          role="alert"
          className="mt-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200"
        >
          <p className="font-semibold tabular-nums">{formatSaveOutcome(outcome)}</p>
          <ul className="mt-1 list-disc pl-4">
            {outcome.failures.map((failure, position) => (
              <li key={`${failure.name}-${position}`}>
                <span className="font-medium">{failure.name}</span> — {failure.message}
              </li>
            ))}
          </ul>
          <p className="mt-1">실패한 사진은 고른 채로 남겨 두었습니다 — 그대로 다시 저장할 수 있습니다.</p>
          {/*
            🔴 예전에는 「이 창을 닫고 목록을 다시 열면 보입니다」였다. 크게
            보기의 두 주소에 파일의 지문이 붙으면서(attachmentFingerprintSuffix)
            저장된 사진은 **그 자리에서** 새 방향이 된다 — 안내가 사실과 어긋나
            있으면 사람이 멀쩡한 화면을 두고 닫았다 다시 연다.
          */}
          <p>이미 저장된 사진은 이 창을 닫으면 그 자리에서 새 방향으로 보입니다.</p>
        </div>
      )}

      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={isSubmitting}
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          {outcome ? "닫기" : "취소"}
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={isSubmitting || count === 0}
          className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
        >
          {isSubmitting
            ? busyProgress
              ? `저장 중… ${busyProgress.current}/${busyProgress.total}`
              : "저장 중..."
            : single
              ? "덮어쓰고 저장"
              : `${count}장 덮어쓰고 저장`}
        </button>
      </div>
    </dialog>
  );
}
