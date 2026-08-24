"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { countNotificationTargets, type NotificationItem } from "@/lib/domain/notifications";

/**
 * ============================================================================
 * 헤더의 종 알림
 * ============================================================================
 * 사이드바의 결재 배지는 **숫자 하나**라 "3건 있다"까지만 말한다. 무엇인지
 * 보려면 목록 페이지를 열어서 다시 찾아야 한다. 종은 건별로 펼쳐 보여 주고
 * 그 건의 상세로 바로 보낸다.
 *
 * ── 종류를 모른다 ───────────────────────────────────────────────────────
 * 이 컴포넌트에는 "결재"라는 말이 한 군데도 없다. NotificationItem 한 모양만
 * 그리므로, 알림 종류가 늘어도 여기는 고치지 않는다 — 종류는
 * db/queries/notifications.ts의 레지스트리에 등록한다.
 *
 * ── 모바일 폭 ───────────────────────────────────────────────────────────
 * TopBar.tsx의 주석에 적힌 사고(오른쪽 묶음이 폰에서 헤더를 가로로 넘치게
 * 만들어 햄버거조차 누르기 어려웠던 일) 때문에, 종은 햄버거와 같은 h-9 w-9
 * 아이콘 버튼 하나를 넘지 않는다. 펼침 패널도 화면 밖으로 나가지 않게 폭을
 * `min(20rem, 100vw - 2rem)`로 잡는다 — 오른쪽 끝에 붙어 왼쪽으로 펼쳐지므로
 * 좁은 화면에서는 뷰포트 안쪽에 좌우 여백을 남기고 멈춘다.
 * ============================================================================
 */

/**
 * 패널 안의 목록. 펼침 상태와 무관하게 정적 렌더로 검사할 수 있도록 따로
 * 두었다(이 저장소의 컴포넌트 테스트는 renderToStaticMarkup만 쓴다).
 */
export function NotificationList({
  items,
  onNavigate,
}: {
  items: readonly NotificationItem[];
  onNavigate: () => void;
}) {
  if (items.length === 0) {
    return (
      <p className="px-3 py-6 text-center text-sm text-zinc-500 dark:text-zinc-400">
        처리할 알림이 없습니다.
      </p>
    );
  }

  return (
    <ul className="max-h-[60vh] overflow-y-auto py-1">
      {items.map((item) => (
        <li key={item.id}>
          <Link
            href={item.href}
            onClick={onNavigate}
            className="flex items-baseline gap-1.5 px-3 py-2 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <span className="shrink-0 text-sm font-medium text-zinc-900 dark:text-zinc-50">{item.subject}</span>
            <span aria-hidden="true" className="text-zinc-400 dark:text-zinc-600">
              ·
            </span>
            <span className="truncate text-sm text-zinc-600 dark:text-zinc-400">{item.detail}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export default function NotificationBell({ items = [] }: { items?: readonly NotificationItem[] }) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  // 세는 규칙은 여기서 정하지 않는다 — 사이드바 배지와 같은 순수 헬퍼를 쓴다.
  const count = countNotificationTargets(items.map((item) => item.targetKey));

  useEffect(() => {
    if (!isOpen) return;

    function handlePointerDown(event: PointerEvent) {
      // 종 버튼 자체를 다시 누른 것은 아래 onClick 토글이 처리한다.
      if (event.target instanceof Node && containerRef.current?.contains(event.target)) return;
      setIsOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setIsOpen(false);
      // 키보드로 닫았으면 포커스가 사라진 패널 안에 남지 않게 종으로 돌려준다.
      buttonRef.current?.focus();
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  return (
    <div ref={containerRef} className="relative ml-auto shrink-0">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-label={count > 0 ? `알림 ${count}건` : "알림"}
        aria-expanded={isOpen}
        aria-haspopup="menu"
        aria-controls={isOpen ? panelId : undefined}
        className="relative flex h-9 w-9 items-center justify-center rounded-md text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
      >
        <svg
          viewBox="0 0 24 24"
          width="20"
          height="20"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {/* 0건이면 배지를 그리지 않는다 — "0"이라고 적힌 배지는 할 일이 있는
            것처럼 눈에 띄기만 한다(사이드바 배지와 같은 규칙). */}
        {count > 0 && (
          <span className="absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-amber-500 px-1 text-center text-[10px] font-semibold leading-4 text-white tabular-nums dark:bg-amber-600">
            {count}
          </span>
        )}
      </button>

      {isOpen && (
        <div
          id={panelId}
          className="absolute right-0 top-full z-30 mt-1 w-[min(20rem,calc(100vw-2rem))] overflow-hidden rounded-md border border-zinc-200 bg-white shadow-lg dark:border-zinc-800 dark:bg-zinc-900"
        >
          <div className="border-b border-zinc-200 px-3 py-2 text-xs font-semibold text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
            알림
          </div>
          <NotificationList items={items} onNavigate={() => setIsOpen(false)} />
        </div>
      )}
    </div>
  );
}
