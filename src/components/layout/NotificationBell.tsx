"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { countNotificationTargets, type NotificationItem } from "@/lib/domain/notifications";
import { NOTIFICATION_KIND_META } from "@/lib/domain/notification-settings";
import {
  NOTIFICATION_PERMISSION_CHANGED_EVENT,
  describeBrowserNotificationStatus,
  resolveBrowserNotificationStatus,
  type BrowserNotificationStatus,
} from "@/lib/domain/notification-toast";

/**
 * ============================================================================
 * 헤더의 종 알림
 * ============================================================================
 * 사이드바의 결재 배지는 **숫자 하나**라 "3건 있다"까지만 말한다. 무엇인지
 * 보려면 목록 페이지를 열어서 다시 찾아야 한다. 종은 건별로 펼쳐 보여 주고
 * 그 건의 상세로 바로 보낸다.
 *
 * ── 종류를 모른다 ───────────────────────────────────────────────────────
 * 이 컴포넌트에는 "결재"라는 말이 한 군데도 없고, 종류를 보고 갈라지는 분기도
 * 없다. NotificationItem 한 모양만 그리므로, 알림 종류가 늘어도 여기는 고치지
 * 않는다 — 종류는 db/queries/notifications.ts의 레지스트리에 등록한다.
 *
 * 그 규칙은 NotificationBell.test.tsx가 이 파일의 소스를 직접 읽어 지킨다.
 *
 * 종류마다 다른 **이름과 색**은 화면이 정하지 않고 도메인의
 * NOTIFICATION_KIND_META를 **읽기만** 한다(표 조회이지 분기가 아니다). 종류가
 * 늘면 그 표를 채우는 것으로 끝나고, 빠뜨리면 notification-settings.test.ts가
 * 잡는다.
 *
 * ── 색만으로 구분하지 않는다 ────────────────────────────────────────────
 * 색약이신 분에게는 색 차이가 사라지고 흑백 인쇄에는 아무것도 남지 않는다.
 * 그래서 종류 **이름을 글자로도** 한 줄 위에 함께 적는다. 이름을 지금 줄
 * (`대상 · 상세`) 안에 끼워 넣지 않고 윗줄로 올린 이유는 truncate 때문이다 —
 * 상세가 이미 잘릴 수 있는 자리라, 같은 줄에 글자를 더하면 그만큼 상세가 먼저
 * 잘린다. 윗줄로 올리면 지금 줄의 폭이 한 글자도 줄지 않는다.
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
      {items.map((item) => {
        // 종류별 분기가 아니라 표 조회다 — 종류가 늘어도 이 줄은 그대로다.
        const meta = NOTIFICATION_KIND_META[item.kind];
        return (
          <li key={item.id}>
            <Link
              href={item.href}
              onClick={onNavigate}
              className="block px-3 py-2 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              <span className={`block truncate text-[11px] font-medium ${meta.toneClassName}`}>
                {meta.label}
              </span>
              <span className="flex items-baseline gap-1.5">
                <span className="shrink-0 text-sm font-medium text-zinc-900 dark:text-zinc-50">{item.subject}</span>
                <span aria-hidden="true" className="text-zinc-400 dark:text-zinc-600">
                  ·
                </span>
                <span className="truncate text-sm text-zinc-600 dark:text-zinc-400">{item.detail}</span>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * 패널 맨 아래 — 컴퓨터·폰 알림창을 쓸 수 있는지, 못 쓴다면 왜인지.
 *
 * 상태 → 문구/단추 판정은 도메인(notification-toast.ts)에 있고 여기는 그대로
 * 그린다. 그래서 정적 렌더로 상태마다 따로 검사할 수 있다.
 *
 * 아무 말도 안 하는 상태가 둘이다 — 이미 허락받았을 때(정상이라 할 말이 없다)와
 * 아직 브라우저에 물어보기 전(UNKNOWN, 서버 렌더)이다. 서버에서 그리지 않는
 * 것이 중요하다: 서버는 이 기기가 보안 접속인지 알 수 없어서, 미리 무언가를
 * 적어 두면 하이드레이션 뒤에 글자가 바뀐다.
 */
export function BrowserNotificationNotice({
  status,
  onAsk,
}: {
  status: BrowserNotificationStatus;
  onAsk: () => void;
}) {
  const notice = describeBrowserNotificationStatus(status);
  if (notice.message === null && !notice.canAsk) return null;

  return (
    <div className="border-t border-zinc-200 px-3 py-2 dark:border-zinc-800">
      {notice.canAsk ? (
        <>
          <button
            type="button"
            onClick={onAsk}
            className="rounded-md border border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            알림 받기
          </button>
          <p className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
            새 알림이 생기면 컴퓨터·폰 알림창에 띄웁니다.
          </p>
        </>
      ) : (
        <p className="text-[11px] text-zinc-500 dark:text-zinc-400">{notice.message}</p>
      )}
    </div>
  );
}

/**
 * 이 브라우저가 지금 알림을 띄울 수 있는가 — 서버 렌더와 어긋나지 않게 알아내는 방법.
 *
 * 렌더 중에 `Notification`을 직접 만지면 서버에서 터진다(이 파일은 클라이언트
 * 컴포넌트지만 서버에서 한 번 그려진다). useSyncExternalStore에 서버용
 * 스냅샷("모른다")과 브라우저용 스냅샷을 따로 주면, 서버·하이드레이션 때는
 * 모르는 것으로 그리고 그 뒤에 실제 값으로 한 번 맞춰진다 —
 * EditSectionActions.tsx가 클립보드 유무에 쓰는 그 방법 그대로다.
 *
 * 돌려주는 값이 문자열 하나라서 렌더마다 새 객체가 생기지 않는다(객체를
 * 돌려주면 참조가 매번 달라져 무한 렌더가 된다). 세 함수 모두 모듈 수준에 두어
 * 렌더마다 새로 만들지 않는다.
 */
const subscribeToNothing = () => () => {};

function readBrowserNotificationStatus(): BrowserNotificationStatus {
  if (typeof window === "undefined") return "UNKNOWN";
  const hasNotificationApi = typeof window.Notification !== "undefined";
  return resolveBrowserNotificationStatus({
    isSecureContext: window.isSecureContext === true,
    hasNotificationApi,
    permission: hasNotificationApi ? window.Notification.permission : null,
  });
}

const unknownOnServer = (): BrowserNotificationStatus => "UNKNOWN";

export default function NotificationBell({ items = [] }: { items?: readonly NotificationItem[] }) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  const detectedStatus = useSyncExternalStore(
    subscribeToNothing,
    readBrowserNotificationStatus,
    unknownOnServer
  );
  /**
   * 방금 물어보고 알게 된 답. 위 스냅샷에는 구독할 것이 없어서(권한이 바뀌었다고
   * 알려 주는 표준 신호가 모든 브라우저에 있지는 않다) 물어본 직후의 답만
   * 여기에 따로 담아 덮어쓴다.
   */
  const [statusAfterAsking, setStatusAfterAsking] = useState<BrowserNotificationStatus | null>(null);
  const notificationStatus = statusAfterAsking ?? detectedStatus;

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

  /**
   * 🔴 권한은 **사람이 이 단추를 눌렀을 때만** 묻는다.
   *
   * 페이지가 열리자마자 예고 없이 물으면 대개 거절당하고, 한 번 거절하면
   * 브라우저 설정을 뒤져야 되돌릴 수 있다. 단추는 물어볼 수 있는 상태에서만
   * 그려지므로(describeBrowserNotificationStatus) 여기 닿는 것은 사람이 실제로
   * 누른 경우뿐이다.
   */
  async function handleAskForNotificationPermission() {
    try {
      await window.Notification.requestPermission();
    } catch {
      // 요청 자체가 조용히 막히는 브라우저가 있다. 아래에서 지금 상태를 다시
      // 읽어 화면에 반영한다 — 눌렀는데 아무 일도 없는 것처럼 보이지 않게.
    }

    const status = readBrowserNotificationStatus();
    setStatusAfterAsking(status);

    if (status === "GRANTED") {
      // 실제로 알림창을 띄우는 쪽(BrowserNotifications)은 화면의 다른 가지에
      // 있어서 이 state가 닿지 않는다. 알려 주지 않으면 방금 허락했는데도
      // 다음 주기(1분)까지 모른다.
      try {
        window.dispatchEvent(new Event(NOTIFICATION_PERMISSION_CHANGED_EVENT));
      } catch {
        // 신호를 못 보내도 저쪽이 다음 주기에 스스로 알아챈다.
      }
    }
  }

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
          <BrowserNotificationNotice
            status={notificationStatus}
            onAsk={() => void handleAskForNotificationPermission()}
          />
        </div>
      )}
    </div>
  );
}
