"use client";

import { useEffect, useState } from "react";
import { createFileDropHandlers, installFileDropGuard } from "./file-drop";

/**
 * ============================================================================
 * 끌어다 놓기 — 파일을 올리는 자리를 감싸는 조각 하나
 * ============================================================================
 * 규칙과 문구는 전부 file-drop.ts 에 있다(그 파일 머리말을 먼저 읽을 것). 여기는
 * 그것을 화면에 붙이기만 한다 — 끌어오는 중임을 보이고, 못 받은 까닭을 한 줄 적는다.
 *
 * 🔴 **검사하지 않는다.** 받은 파일은 `onFiles` 로 그대로 넘기고, 부르는 쪽이 지금
 * 고르기 칸(`<input type="file">`)의 onChange 가 하던 그 자리에 태운다. 떨구기 전용
 * 검사를 새로 짜면 고르기와 두 길이 갈린다.
 *
 * 기존 고르기 칸은 **그대로 둔다** — 이 조각은 더하기만 한다.
 * ============================================================================
 */

export const DEFAULT_FILE_DROP_HINT = "여기에 파일을 놓으세요";

export function FileDropZone({
  name,
  onFiles,
  multiple,
  disabled = false,
  hint = DEFAULT_FILE_DROP_HINT,
  className = "",
  children,
}: {
  /** 어느 자리인가 — `data-file-drop` 으로 남는다(시험과 디버깅이 짚는 이름). */
  name: string;
  onFiles: (files: File[]) => void;
  /** 고르기 칸의 같은 이름 속성과 **같은 값**. 하나만 받는 자리는 false. */
  multiple: boolean;
  disabled?: boolean;
  /** 끌어오는 중에 보일 한 줄. */
  hint?: string;
  className?: string;
  children: React.ReactNode;
}) {
  /**
   * 끌기가 몇 겹 들어와 있는가(file-drop.ts 의 depth). useRef 가 아니라 state 의
   * 첫 값으로 든 그릇이다 — ref 를 그릴 때 함수에 넘기는 것은 lint(react-hooks/refs)
   * 가 막는다. 그리는 값이 아니라 다시 그릴 일도 없으므로 그릇만 계속 들고 있으면 된다.
   */
  const [depth] = useState(() => ({ current: 0 }));
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // 떨구는 자리가 하나라도 떠 있는 동안 창 전체의 기본 동작을 막는다 — 빗나간
  // 자리에 떨궈도 브라우저가 파일을 열지 않게(file-drop.ts 의 installFileDropGuard).
  useEffect(() => installFileDropGuard(window), []);

  const handlers = createFileDropHandlers({
    depth,
    disabled,
    multiple,
    onFiles,
    onNotice: setNotice,
    setDragging,
  });

  return (
    <div
      data-file-drop={name}
      data-dragging={dragging ? "true" : undefined}
      onDragEnter={handlers.onDragEnter}
      onDragOver={handlers.onDragOver}
      onDragLeave={handlers.onDragLeave}
      onDrop={handlers.onDrop}
      className={`relative ${className}`}
    >
      {children}

      {/*
        끌어오는 중에만 덮는다 — 어디에 놓아야 하는지 보이게. pointer-events-none 이
        없으면 이 덮개가 dragleave 를 일으켜 표시가 깜빡인다.
      */}
      {dragging ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-md border-2 border-dashed border-sky-500 bg-sky-50/90 px-3 text-center text-sm font-medium text-sky-900 dark:border-sky-400 dark:bg-sky-950/90 dark:text-sky-100"
        >
          {hint}
        </span>
      ) : null}

      {notice ? (
        <p role="alert" className="mt-2 text-xs text-red-600 dark:text-red-400">
          {notice}
        </p>
      ) : null}
    </div>
  );
}

/**
 * 떨군 파일을 **고르기 칸에 그대로 담는다.** 올릴 때 칸의 `files` 를 읽는 자리
 * (제품 모델 사진·도면 · 접수 건 파일 올리기)가 쓴다 — 떨구기용 상태를 따로 두면
 * 「올리기」 단추가 보는 것이 둘이 되고, 두 길이 갈린다.
 *
 * 담고 나면 화면에도 「N개 파일」로 보이므로, 고르기 칸으로 고른 것과 구분되지 않는다.
 */
export function putFilesInPicker(input: HTMLInputElement | null, files: readonly File[]): boolean {
  if (!input || files.length === 0) return false;
  const transfer = new DataTransfer();
  for (const file of files) transfer.items.add(file);
  input.files = transfer.files;
  return true;
}
