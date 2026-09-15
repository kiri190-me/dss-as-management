"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  SAVE_POPUP_EVENT,
  SAVE_POPUP_NAVIGATION_TIMEOUT_MS,
  SAVE_POPUP_VISIBLE_MS,
  isAlreadyAtSavePopupTarget,
  normalizeSavePopupRequest,
  type SavePopupRequest,
} from "@/lib/domain/save-popup";

/**
 * 저장·등록이 끝났다고 알린다. 넘어갈 곳이 있으면 0.5초 뒤 팝업이 그리로 넘긴다.
 *
 * 부르는 쪽은 이것 하나로 끝난다 — 기다리지도, router.push 하지도 않는다
 * (까닭은 lib/domain/save-popup.ts 머리말).
 */
export function showSavePopup(request: SavePopupRequest): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(SAVE_POPUP_EVENT, { detail: request }));
}

type ActivePopup = {
  id: number;
  request: SavePopupRequest;
  /** 0.5초가 지나 목록으로 넘기기 시작했는가. */
  navigating: boolean;
};

/**
 * 팝업을 그리는 자리. (app)/layout.tsx 에 한 번만 붙는다.
 *
 * 레이아웃은 화면을 옮겨도 다시 만들어지지 않으므로, 폼이 있던 화면이
 * 사라져도 팝업은 목록이 그려질 때까지 남는다.
 */
export default function SavePopupHost() {
  const router = useRouter();
  const pathname = usePathname();
  const [active, setActive] = useState<ActivePopup | null>(null);
  const nextIdRef = useRef(0);

  useEffect(() => {
    function onRequest(event: Event) {
      const request = normalizeSavePopupRequest((event as CustomEvent<unknown>).detail);
      if (!request) return;
      nextIdRef.current += 1;
      setActive({ id: nextIdRef.current, request, navigating: false });
      // 떠 있는 0.5초 동안 목록을 미리 받아 둔다 — 넘어간 뒤 기다리는 시간이 준다.
      if (request.redirectTo) router.prefetch(request.redirectTo);
    }
    window.addEventListener(SAVE_POPUP_EVENT, onRequest);
    return () => window.removeEventListener(SAVE_POPUP_EVENT, onRequest);
  }, [router]);

  // 0.5초가 지나면: 넘길 곳이 없으면 닫고, 있으면 넘긴다.
  useEffect(() => {
    if (!active || active.navigating) return;
    const timer = window.setTimeout(() => {
      const { redirectTo } = active.request;
      if (!redirectTo) {
        setActive(null);
        return;
      }
      router.push(redirectTo);
      // 이미 그 화면이면 경로가 바뀌지 않아 도착을 알아챌 수 없다 — 바로 닫는다.
      setActive(isAlreadyAtSavePopupTarget(pathname, redirectTo) ? null : { ...active, navigating: true });
    }, SAVE_POPUP_VISIBLE_MS);
    return () => window.clearTimeout(timer);
  }, [active, pathname, router]);

  // 넘기기 시작했는데 도착하지 못해도 화면을 영영 막지 않는다.
  useEffect(() => {
    if (!active?.navigating) return;
    const id = active.id;
    const timer = window.setTimeout(() => {
      setActive((current) => (current?.id === id ? null : current));
    }, SAVE_POPUP_NAVIGATION_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [active]);

  // 경로가 바뀌면 목록에 도착한 것이다 — 그때 닫는다. 앞 렌더의 경로와
  // 견주어 렌더 중에 고치는 방식이다(React 문서의 「prop 이 바뀔 때 state 맞추기」).
  const [renderedPathname, setRenderedPathname] = useState(pathname);
  if (renderedPathname !== pathname) {
    setRenderedPathname(pathname);
    if (active?.navigating) setActive(null);
  }

  if (!active) return null;
  return <SavePopupView key={active.id} message={active.request.message} />;
}

/**
 * 팝업 한 장. 화면 가운데에 모달로 뜬다.
 *
 * 네이티브 `<dialog>` 의 showModal 을 쓰는 까닭: 이 앱의 대화상자들도 같은
 * 방식이라 **그 위에** 뜨고(최상위 층), 떠 있는 동안 뒤 화면이 눌리지 않아
 * 0.5초 사이에 저장을 한 번 더 누르는 일이 없다.
 */
export function SavePopupView({ message }: { message: string }) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  return (
    <dialog
      ref={dialogRef}
      aria-label={message}
      // Escape 로 닫혀도 넘기는 것은 그대로 일어나므로, 닫히는 척만 하지 않게 막는다.
      onCancel={(event) => event.preventDefault()}
      className="m-auto rounded-xl border border-zinc-200 bg-white px-6 py-4 shadow-xl outline-none backdrop:bg-black/20 dark:border-zinc-700 dark:bg-zinc-900"
    >
      <div role="status" className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-base font-bold text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300"
        >
          ✓
        </span>
        <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{message}</p>
      </div>
    </dialog>
  );
}
