"use client";

import { useState, useSyncExternalStore } from "react";

import {
  isWindowsDesktopClient,
  readQuoteFolderClientPlatform,
  runQuoteFolderHelperInstallCommandCopy,
} from "@/components/quotes/quote-folder-open";
import type { QuoteIssueNoticeLine, QuoteIssueNoticeTone } from "@/components/quotes/quote-issue-messages";
import { runContactFolderFileOpen, type ContactFolderFileOpenOutcome } from "./contact-folder-file-open";

/**
 * ============================================================================
 * 공유폴더 목록 한 줄의 [열기] 단추 (연락서 조각 4)
 * ============================================================================
 * 누르면 그 파일이 이 PC 의 연결 프로그램으로 열린다. 누른 뒤의 흐름은
 * runContactFolderFileOpen(contact-folder-file-open.ts)이 전부 한다 — 이 파일은 단추와 결과
 * 줄만 그린다.
 *
 * ── 🔴 누를 수 있는 줄에만 그린다 ───────────────────────────────────────
 * 허용 목록 밖 확장자 · 확장자 없는 이름 · **폴더 줄**에는 이 단추가 **아예 그려지지 않는다.**
 * 그 판단은 부르는 쪽(ContactFolderSection)이 순수 함수 하나로 한다
 * (domain/quote-folder-file-link.ts 의 isOpenableQuoteFolderFileName). 눌러서 거절당하는 것보다
 * 누를 단추가 없는 것이 낫다 — `.exe` 가 목록에 섞여 있어도 손이 갈 곳이 없다.
 *
 * ── 🔴 Windows 가 아니면 단추가 없다 ────────────────────────────────────
 * 도우미는 Windows PC 에만 설치된다. 렌더 중에 navigator 를 만지면 서버 렌더와 첫 렌더가
 * 어긋나므로(hydration) useSyncExternalStore 에 서버용 스냅샷(「아니다」)을 따로 준다 —
 * 조각 2 의 [폴더 열기] 단추와 **같은 방법**이다.
 *
 * ── 🔴 인쇄에 안 찍힌다 ─────────────────────────────────────────────────
 * 종이에 남을 이유가 없는 조작 단추라 바깥 틀에 `print:hidden` 을 건다.
 *
 * ── 🔴 늘 [설치 명령 복사]를 곁에 둔다 ──────────────────────────────────
 * 예전 도우미는 `openfile` 주소를 받으면 조용히 끝난다(exit 2). 화면은 그것을 알 수 없다 —
 * 그래서 한 번이라도 열어 본 결과에는 늘 설치로 가는 길을 함께 낸다
 * (contact-folder-file-open.ts 머리말). 복사 갈래는 견적서 쪽 것을 **그대로 가져다 쓴다** —
 * 설치되는 도우미가 똑같은 한 벌이고(PC 당 하나), 복사 갈래도 공용 모듈 하나다.
 *
 * 서버 액션을 부르지 않는다 — `server-only` 사슬 없이 그려 볼 수 있다.
 * ============================================================================
 */

const subscribeToNothing = () => () => {};
const isWindowsDesktopNow = () =>
  typeof navigator !== "undefined" && isWindowsDesktopClient(readQuoteFolderClientPlatform(navigator));
const hiddenOnServer = () => false;

/** 단추에 마우스를 올리면 보이는 설명. */
export const CONTACT_FOLDER_ENTRY_OPEN_BUTTON_TITLE =
  "이 파일을 이 PC 의 연결 프로그램으로 엽니다 — 열리지 않으면 폴더 열기 도우미를 다시 설치해 주세요";

const BUTTON_CLASS =
  "rounded border border-zinc-300 px-1.5 py-0.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800";

const NOTICE_ACTION_CLASS =
  "underline underline-offset-2 hover:text-zinc-800 disabled:opacity-50 dark:hover:text-zinc-200";

const LINE_TONE_CLASS: Record<QuoteIssueNoticeTone, string> = {
  normal: "text-zinc-700 dark:text-zinc-300",
  muted: "text-zinc-400 dark:text-zinc-500",
  warning: "font-medium text-amber-700 dark:text-amber-400",
};

/**
 * 결과 줄들. 🔴 `<span>` 으로 적는다 — 이 조각은 목록 한 줄 안(인라인 자리)에 들어간다.
 */
function NoticeLines({ lines }: { lines: readonly QuoteIssueNoticeLine[] }) {
  if (lines.length === 0) return null;
  return (
    <>
      {lines.map((line, index) => (
        <span key={`${index}-${line.text}`} className={`block break-all ${LINE_TONE_CLASS[line.tone]}`}>
          {line.text}
        </span>
      ))}
    </>
  );
}

/** 단추와 결과 줄 — Windows 판단 없이. 화면에는 기본 내보내기를 쓴다. */
export function ContactFolderEntryOpenControl({ folderName, fileName }: ContactFolderEntryOpenButtonProps) {
  const [busy, setBusy] = useState(false);
  const [copyBusy, setCopyBusy] = useState(false);
  const [outcome, setOutcome] = useState<ContactFolderFileOpenOutcome | null>(null);
  const [copyLines, setCopyLines] = useState<QuoteIssueNoticeLine[]>([]);

  async function handleOpen() {
    if (busy) return;
    setBusy(true);
    setOutcome(null);
    setCopyLines([]);
    try {
      setOutcome(await runContactFolderFileOpen({ folderName, fileName }));
    } finally {
      setBusy(false);
    }
  }

  async function handleCopy() {
    if (copyBusy) return;
    setCopyBusy(true);
    try {
      setCopyLines(await runQuoteFolderHelperInstallCommandCopy());
    } finally {
      setCopyBusy(false);
    }
  }

  return (
    <span className="print:hidden flex min-w-0 flex-col items-end gap-0.5 text-right">
      <button
        type="button"
        onClick={() => void handleOpen()}
        disabled={busy}
        aria-busy={busy}
        title={CONTACT_FOLDER_ENTRY_OPEN_BUTTON_TITLE}
        data-contact-folder-entry-open=""
        className={BUTTON_CLASS}
      >
        {busy ? "여는 중…" : "열기"}
      </button>
      {outcome && (
        <span role="status" className="flex min-w-0 flex-col items-end gap-0.5 text-xs">
          <NoticeLines lines={outcome.lines} />
          {outcome.offerHelperInstall && (
            <button
              type="button"
              onClick={() => void handleCopy()}
              disabled={copyBusy}
              aria-busy={copyBusy}
              data-contact-folder-entry-helper-install-command=""
              className={`${NOTICE_ACTION_CLASS} text-xs text-zinc-500 dark:text-zinc-400`}
            >
              {copyBusy ? "복사하는 중…" : "설치 명령 복사"}
            </button>
          )}
          <NoticeLines lines={copyLines} />
        </span>
      )}
    </span>
  );
}

type ContactFolderEntryOpenButtonProps = {
  /**
   * 공유폴더 루트 아래의 **폴더 경로**. 맨 위 칸을 보고 있으면 연락서 폴더 이름 하나이고,
   * 하위 폴더에 들어가 있으면 그 자리까지 이어진 경로다(조각 10 — 부르는 쪽이 잇는다).
   * 🔴 주소 모양은 바뀌지 않았다 — 도우미는 전부터 여러 마디 경로를 받는다.
   */
  folderName: string;
  /** 그 폴더 안에서의 파일 이름 — 🔴 **마디 하나**다(아래 흐름이 그것을 본다). */
  fileName: string;
};

/** 🔴 Windows PC 에서만 그린다 — 서버 렌더 · 첫 렌더는 감춘 채. */
export default function ContactFolderEntryOpenButton(props: ContactFolderEntryOpenButtonProps) {
  const isWindows = useSyncExternalStore(subscribeToNothing, isWindowsDesktopNow, hiddenOnServer);
  if (!isWindows) return null;
  return <ContactFolderEntryOpenControl {...props} />;
}
