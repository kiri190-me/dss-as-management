"use client";

import { useState, useSyncExternalStore } from "react";

import { isWindowsDesktopClient, readQuoteFolderClientPlatform } from "@/components/quotes/quote-folder-open";
import { ContactFolderOpenNotice } from "@/components/repair-cases/detail/ContactFolderOpenButton";
import type { ContactFolderOpenOutcome } from "@/components/repair-cases/detail/contact-folder-open";
import { runContactFolderPlaceOpen } from "./contact-folder-place-open";

/**
 * ============================================================================
 * 공유폴더 구역의 [폴더 열기] — **하위 폴더에 들어가 있을 때** (연락서 조각 10)
 * ============================================================================
 * 맨 위 폴더를 보고 있을 때는 조각 2 의 단추(ContactFolderOpenButton)가 그대로 선다 —
 * 그 단추에는 폴더가 없을 때 [폴더 만들고 열기]가 달려 있다. 🔴 **하위 폴더에 들어가 있을
 * 때만** 이 단추가 대신 서서 **보고 있는 그 자리**를 연다(contact-folder-place-open.ts 머리말).
 *
 * ── 🔴 그려지는 것은 조각 2 의 결과 조각을 그대로 쓴다 ──────────────────────
 * 결과 줄 · [설치 명령 복사]는 ContactFolderOpenNotice 한 벌이다 — 말이 갈라지지 않게.
 * [폴더 만들고 열기]는 여기서 내밀지 않는다(onCreate 를 주지 않으면 그려지지 않는다).
 *
 * ── 🔴 Windows 가 아니면 단추가 없다 · 인쇄에 안 찍힌다 ───────────────────
 * 도우미는 Windows PC 에만 설치된다. 서버 렌더 · 첫 렌더는 감춘 채 그린다
 * (useSyncExternalStore — 조각 2 · 4 의 단추와 **같은 방법**).
 * ============================================================================
 */

const subscribeToNothing = () => () => {};
const isWindowsDesktopNow = () =>
  typeof navigator !== "undefined" && isWindowsDesktopClient(readQuoteFolderClientPlatform(navigator));
const hiddenOnServer = () => false;

export const CONTACT_FOLDER_PLACE_OPEN_BUTTON_TEXT = "폴더 열기";

/** 🔴 맨 위 폴더가 아니라 **지금 자리**를 연다는 것을 설명에 적는다. */
export const CONTACT_FOLDER_PLACE_OPEN_BUTTON_TITLE =
  "지금 보고 있는 하위 폴더를 탐색기로 엽니다 — 이 PC 에 폴더 열기 도우미가 없으면 설치 방법을 알려 드립니다";

/** 🔴 `print:hidden` — 인쇄물에는 조작 단추가 남지 않는다. */
const BUTTON_CLASS =
  "print:hidden rounded border border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800";

type ContactFolderPlaceOpenButtonProps = {
  /**
   * 🔴 공유폴더 루트 아래의 상대 경로 — `연락서 폴더/사진/2026`. 폴더 이름과 지금 자리를
   * 이어 부르는 쪽이 만든다(ContactFolderSection).
   */
  relativePath: string;
};

/** 단추와 결과 줄 — Windows 판단 없이. 화면에는 기본 내보내기를 쓴다. */
export function ContactFolderPlaceOpenControl({ relativePath }: ContactFolderPlaceOpenButtonProps) {
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ContactFolderOpenOutcome | null>(null);

  async function handleOpen() {
    if (busy) return;
    setBusy(true);
    setOutcome(null);
    try {
      setOutcome(await runContactFolderPlaceOpen({ relativePath }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="print:hidden flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={() => void handleOpen()}
        disabled={busy}
        aria-busy={busy}
        title={CONTACT_FOLDER_PLACE_OPEN_BUTTON_TITLE}
        data-contact-folder-place-open=""
        className={BUTTON_CLASS}
      >
        {busy ? "여는 중…" : CONTACT_FOLDER_PLACE_OPEN_BUTTON_TEXT}
      </button>
      {outcome && <ContactFolderOpenNotice outcome={outcome} />}
    </div>
  );
}

/** 🔴 Windows PC 에서만 그린다 — 서버 렌더 · 첫 렌더는 감춘 채. */
export default function ContactFolderPlaceOpenButton(props: ContactFolderPlaceOpenButtonProps) {
  const isWindows = useSyncExternalStore(subscribeToNothing, isWindowsDesktopNow, hiddenOnServer);
  if (!isWindows) return null;
  return <ContactFolderPlaceOpenControl {...props} />;
}
