"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Stage F-1 전용. window.print()는 오직 이 컴포넌트의 버튼 클릭 핸들러
 * 안에서만, 실제 사용자 클릭에 대한 응답으로 호출한다 — useEffect,
 * 렌더링 중, props 변경에 대한 반응으로는 절대 호출하지 않는다. 이
 * 컴포넌트는 localStorage/세션을 읽지 않고, PDF 파일이나 감사 로그를
 * 만들지 않으며, generatedAt을 새로 만들거나 갱신하지 않는다 — 보고서
 * 데이터와 제안 파일명은 전부 호출부가 이미 준비해 props로 넘긴 값이다.
 *
 * 재클릭 방지 가드는 화면 전용 상태다: 새로고침 시 사라지고, 어떤 전역
 * 상태나 localStorage에도 쓰지 않는다.
 */

const REPEAT_CLICK_GUARD_MS = 1200;

const focusRingClass =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 dark:focus-visible:ring-zinc-500";

export type ReportPrintButtonProps = {
  proposedFilename: string;
  isReady: boolean;
  hasWarnings: boolean;
};

export default function ReportPrintButton({ proposedFilename, isReady, hasWarnings }: ReportPrintButtonProps) {
  const [isGuarded, setIsGuarded] = useState(false);
  const guardTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 언마운트 시 남아있는 가드 타이머를 정리한다 — 이 타이머는 UI 가드
  // 전용이며 하이드레이션/보고서 로딩과는 무관하다.
  useEffect(() => {
    return () => {
      if (guardTimeoutRef.current !== null) {
        clearTimeout(guardTimeoutRef.current);
      }
    };
  }, []);

  function handleClick() {
    if (!isReady || isGuarded) return;

    setIsGuarded(true);
    window.print();

    guardTimeoutRef.current = setTimeout(() => {
      setIsGuarded(false);
      guardTimeoutRef.current = null;
    }, REPEAT_CLICK_GUARD_MS);
  }

  const disabled = !isReady || isGuarded;
  const statusText = !isReady
    ? "보고서 데이터를 준비하는 중입니다."
    : isGuarded
      ? "인쇄 대화상자를 여는 중입니다."
      : "";

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-zinc-200 bg-white p-4 print:hidden dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-col gap-1">
        <p className="text-sm text-zinc-700 dark:text-zinc-300">브라우저의 인쇄 기능을 사용하는 데모입니다.</p>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          PDF 저장 여부와 파일 위치는 브라우저 설정에 따라 달라집니다.
        </p>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">실제 파일을 자동 생성하거나 저장하지 않습니다.</p>
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-xs text-zinc-500 dark:text-zinc-400">제안 파일명</span>
        <span className="font-mono text-xs break-all text-zinc-900 select-text sm:text-sm dark:text-zinc-50">
          {proposedFilename}
        </span>
      </div>

      {hasWarnings && (
        <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
          일부 데이터 경고가 포함되어 있습니다. 내용을 확인한 뒤 인쇄해 주세요.
        </p>
      )}

      <button
        type="button"
        onClick={handleClick}
        disabled={disabled}
        aria-disabled={disabled}
        className={`w-full rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto ${focusRingClass} dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200`}
      >
        인쇄 / PDF 저장
      </button>

      <p role="status" aria-live="polite" className="min-h-4 text-xs text-zinc-500 dark:text-zinc-400">
        {statusText}
      </p>
    </div>
  );
}
