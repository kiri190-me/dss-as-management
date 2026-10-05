"use client";

import { useState, useSyncExternalStore } from "react";

import {
  isWindowsDesktopClient,
  readQuoteFolderClientPlatform,
  runQuoteFolderHelperInstallCommandCopy,
  runQuoteFolderUncPathCopy,
} from "@/components/quotes/quote-folder-open";
import type { QuoteIssueNoticeLine, QuoteIssueNoticeTone } from "@/components/quotes/quote-issue-messages";
import { runContactFolderOpen, type ContactFolderOpenOutcome } from "./contact-folder-open";

/**
 * ============================================================================
 * 수리 건 상세 「기본 정보」의 [폴더 열기] 단추 · 결과 줄 (연락서 조각 2)
 * ============================================================================
 * 누르면 그 수리 건의 **연락서 공유폴더**가 Windows 탐색기에서 열린다. 누른 뒤의 흐름은
 * runContactFolderOpen(contact-folder-open.ts)이 전부 한다 — 이 파일은 단추와 결과 줄만 그린다.
 *
 * 🔴 **이 조각은 폴더를 만들지 않는다.** 없으면 「아직 없습니다」로 끝난다(만들기는 뒤 조각).
 *
 * ── 🔴 인쇄에 안 찍힌다 ──────────────────────────────────────────────────
 * 이 저장소의 화면은 그대로 인쇄해 쓰는 일이 많다. 종이에 남을 이유가 없는 조작 단추라
 * 바깥 틀에 `print:hidden` 을 건다.
 *
 * ── 🔴 Windows 가 아니면 단추가 없다 ─────────────────────────────────────────
 * 도우미는 Windows PC 에만 설치된다. 휴대폰 · Mac · Linux 에서는 눌러도 할 수 있는 일이 없다.
 * 렌더 중에 navigator 를 만지면 서버 렌더와 첫 렌더가 어긋난다(hydration) —
 * useSyncExternalStore 에 서버용 스냅샷(「아니다」)을 따로 주면 서버 · 첫 렌더는 감춘 채
 * 그리고, 마운트 뒤 실제 값으로 한 번 맞춰진다(견적서 쪽 같은 단추와 같은 방법).
 *
 * ── 결과는 이 조각이 들고 있는다 ──────────────────────────────────────────
 * 머리 카드(DetailHeader)는 상태를 들지 않는 조각이라, 결과 줄을 끌어올리지 않고 여기서 쥔다.
 * 부르는 쪽은 수리 건 id 하나만 준다.
 *
 * ── 결과 자리의 단추들은 링크가 아니다 ─────────────────────────────────────
 * `<a href="/api/…">` 는 서버가 오류를 주면 그 JSON 페이지로 넘어가 버린다 — 상세 화면에는
 * 편집 중인 칸이 있을 수 있다. 그래서 fetch 로 받아 클립보드에 넣고, 실패는 문장으로 알린다.
 * 복사 두 길은 견적서 쪽 것을 **그대로 가져다 쓴다** — 설치되는 도우미가 똑같은 한 벌이고
 * (PC 당 하나), 복사 갈래도 공용 모듈 하나다(components/common/copy-text.ts — 운영은 사내
 * http 라 `navigator.clipboard` 가 없다).
 *
 * 서버 액션을 부르지 않는다 — `server-only` 사슬 없이 그려 볼 수 있다.
 * ============================================================================
 */

const subscribeToNothing = () => () => {};
const isWindowsDesktopNow = () =>
  typeof navigator !== "undefined" && isWindowsDesktopClient(readQuoteFolderClientPlatform(navigator));
const hiddenOnServer = () => false;

/** 단추에 마우스를 올리면 보이는 설명. */
export const CONTACT_FOLDER_OPEN_BUTTON_TITLE =
  "사내 공유폴더에서 이 수리 건의 연락서 폴더를 탐색기로 엽니다 — 이 PC 에 폴더 열기 도우미가 없으면 설치 방법을 알려 드립니다";

/** 🔴 `print:hidden` — 인쇄물에는 조작 단추가 남지 않는다. */
const BUTTON_CLASS =
  "print:hidden rounded border border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800";

/** 결과 줄 아래에 붙는 작은 단추 둘 — 같은 모양을 쓴다(링크가 아니다). */
const NOTICE_ACTION_CLASS =
  "underline underline-offset-2 hover:text-zinc-800 disabled:opacity-50 dark:hover:text-zinc-200";

const LINE_TONE_CLASS: Record<QuoteIssueNoticeTone, string> = {
  normal: "text-zinc-700 dark:text-zinc-300",
  muted: "text-zinc-400 dark:text-zinc-500",
  warning: "font-medium text-amber-700 dark:text-amber-400",
};

/**
 * 결과 줄들. 없으면 아무것도 그리지 않는다. 긴 폴더 이름도 줄바꿈한다(break-all).
 *
 * 견적서 쪽 같은 조각(QuoteIssueNoticeLines)을 가져오지 않은 까닭: 그 조각은 [견적서 받기]
 * 흐름까지 든 파일에 있어, 가져오면 수리 건 상세 묶음에 그 흐름이 통째로 딸려 온다. 결은
 * 같은 타입(QuoteIssueNoticeLine)을 그대로 쓰므로 말이 갈라지지는 않는다.
 */
function ContactFolderNoticeLines({ lines }: { lines: readonly QuoteIssueNoticeLine[] }) {
  if (lines.length === 0) return null;
  return (
    <ul role="status" className="flex flex-col gap-0.5 text-xs">
      {lines.map((line, index) => (
        <li key={`${index}-${line.text}`} className={`break-all ${LINE_TONE_CLASS[line.tone]}`}>
          {line.text}
        </li>
      ))}
    </ul>
  );
}

/** 한 번에 하나만 돈다 — 어느 것이 도는지. */
type NoticeAction = "command" | "path";

/**
 * [폴더 열기] 결과 — 폴더를 찾아 연 뒤에만 아래 두 길을 함께 내민다.
 *  · [위치 복사] — 🔴 `outcome.uncPath` 가 **있을 때만**. 서버에 주소 설정이 없으면 응답에
 *    그 칸이 아예 없고, 그때는 단추도 없다. 붙여넣으면 도우미 없이도 폴더가 열린다.
 *  · [설치 명령 복사] — 폴더를 찾았으면 늘 낸다(`offerHelperInstall`).
 */
export function ContactFolderOpenNotice({ outcome }: { outcome: ContactFolderOpenOutcome }) {
  // 누른 결과는 어느 결과에 딸린 것인지 함께 든다 — 새로 누르면 지난 줄이 저절로 사라진다.
  const [answer, setAnswer] = useState<{ outcome: ContactFolderOpenOutcome; lines: QuoteIssueNoticeLine[] } | null>(null);
  const [busy, setBusy] = useState<NoticeAction | null>(null);
  const answerLines = answer?.outcome === outcome ? answer.lines : [];

  async function run(action: NoticeAction, work: () => Promise<QuoteIssueNoticeLine[]>) {
    if (busy !== null) return;
    setBusy(action);
    try {
      setAnswer({ outcome, lines: await work() });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <ContactFolderNoticeLines lines={outcome.lines} />
      {outcome.offerHelperInstall && (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          탐색기가 열리지 않았다면{" "}
          {outcome.uncPath !== undefined && (
            <>
              <button
                type="button"
                onClick={() => void run("path", () => runQuoteFolderUncPathCopy({ uncPath: outcome.uncPath ?? "" }))}
                disabled={busy !== null}
                aria-busy={busy === "path"}
                data-contact-folder-unc-path=""
                className={NOTICE_ACTION_CLASS}
              >
                {busy === "path" ? "복사하는 중…" : "위치 복사"}
              </button>
              {" 또는 "}
            </>
          )}
          <button
            type="button"
            onClick={() => void run("command", () => runQuoteFolderHelperInstallCommandCopy())}
            disabled={busy !== null}
            aria-busy={busy === "command"}
            data-contact-folder-helper-install-command=""
            className={NOTICE_ACTION_CLASS}
          >
            {busy === "command" ? "복사하는 중…" : "설치 명령 복사"}
          </button>
        </p>
      )}
      <ContactFolderNoticeLines lines={answerLines} />
    </div>
  );
}

type ContactFolderOpenButtonProps = {
  repairCaseId: string;
};

/** 단추와 결과 줄 — Windows 판단 없이. 화면에는 기본 내보내기를 쓴다. */
export function ContactFolderOpenControl({ repairCaseId }: ContactFolderOpenButtonProps) {
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ContactFolderOpenOutcome | null>(null);

  async function handleClick() {
    if (busy) return;
    setBusy(true);
    setOutcome(null);
    try {
      setOutcome(await runContactFolderOpen({ repairCaseId }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="print:hidden flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={() => void handleClick()}
        disabled={busy}
        aria-busy={busy}
        title={CONTACT_FOLDER_OPEN_BUTTON_TITLE}
        data-contact-folder-open=""
        className={BUTTON_CLASS}
      >
        {busy ? "여는 중…" : "폴더 열기"}
      </button>
      {outcome && <ContactFolderOpenNotice outcome={outcome} />}
    </div>
  );
}

/** 🔴 Windows PC 에서만 그린다 — 서버 렌더 · 첫 렌더는 감춘 채. */
export default function ContactFolderOpenButton(props: ContactFolderOpenButtonProps) {
  const isWindows = useSyncExternalStore(subscribeToNothing, isWindowsDesktopNow, hiddenOnServer);
  if (!isWindows) return null;
  return <ContactFolderOpenControl {...props} />;
}
