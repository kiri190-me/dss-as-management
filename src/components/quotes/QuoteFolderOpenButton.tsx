"use client";

import { useState, useSyncExternalStore } from "react";
import { QuoteIssueNoticeLines } from "./QuoteIssueButton";
import type { QuoteIssueNoticeLine } from "./quote-issue-messages";
import {
  isWindowsDesktopClient,
  readQuoteFolderClientPlatform,
  runQuoteFolderHelperInstallCommandCopy,
  runQuoteFolderOpen,
  runQuoteFolderUncPathCopy,
  type QuoteFolderOpenOutcome,
} from "./quote-folder-open";

/**
 * ============================================================================
 * 편집 화면 머리의 [폴더 열기] 단추 · 결과 자리 (견적서 ④b)
 * ============================================================================
 * 🔴 **자리는 편집 화면 머리 한 곳**이다(사용자 결정 2026-09-16) — [견적서 받기] 곁. 받기 결과
 * 알림 · 목록 · 인쇄 미리보기에는 두지 않는다. 누른 뒤의 흐름은 runQuoteFolderOpen
 * (quote-folder-open.ts)이 전부 한다 — 이 파일은 단추와 결과 줄만 그린다.
 *
 * ── 🔴 Windows 가 아니면 단추가 없다 ─────────────────────────────────────────
 * 도우미는 Windows PC 에만 설치된다. 휴대폰 · Mac · Linux 에서는 눌러도 할 수 있는 일이 없다 —
 * 그래서 감춘다. 렌더 중에 navigator 를 만지면 서버 렌더와 첫 렌더가 어긋난다
 * (hydration). useSyncExternalStore 에 서버용 스냅샷(「아니다」)을 따로 주면 서버 · 첫 렌더는
 * 감춘 채 그리고, 마운트 뒤 실제 값으로 한 번 맞춰진다(EditSectionActions 의 복사 단추와 같은 방법).
 *
 * ── 잠금 ────────────────────────────────────────────────────────────────
 * 저장 중 · 충돌이면 잠근다(부르는 쪽의 disabled). 저장하지 않은 변경이 있어도 막지 않는다 —
 * 폴더를 열 뿐 파일을 만들지 않는다([견적서 받기]와 다르다).
 *
 * ── 결과 자리의 단추들은 링크가 아니다 ─────────────────────────────────────
 * `<a href="/api/…">` 는 서버가 409(공유폴더 주소 설정 없음)를 주면 그 JSON 페이지로 넘어가
 * 버린다 — 편집 화면의 저장하지 않은 변경이 사라진다. 그래서 fetch 로 받아 클립보드에 넣고,
 * 실패는 문장으로 알린다.
 *
 * 서버 액션을 부르지 않는다 — `server-only` 사슬 없이 그려 볼 수 있다(QuoteFolderOpenButton.test.tsx).
 * ============================================================================
 */

const subscribeToNothing = () => () => {};
const isWindowsDesktopNow = () =>
  typeof navigator !== "undefined" && isWindowsDesktopClient(readQuoteFolderClientPlatform(navigator));
const hiddenOnServer = () => false;

/** 단추에 마우스를 올리면 보이는 설명. */
export const QUOTE_FOLDER_OPEN_BUTTON_TITLE =
  "사내 공유폴더에서 이 견적서의 폴더를 탐색기로 엽니다 — 이 PC 에 폴더 열기 도우미가 없으면 설치 방법을 알려 드립니다";

type QuoteFolderOpenButtonProps = {
  quoteId: string;
  className: string;
  /** 저장 중 · 충돌. 🔴 저장하지 않은 변경은 여기에 넣지 않는다. */
  disabled?: boolean;
  /** 누르는 순간 null(지난 결과를 치운다), 끝나면 결과. */
  onOutcome: (outcome: QuoteFolderOpenOutcome | null) => void;
};

/** 단추 자체 — Windows 판단 없이. 화면에는 기본 내보내기(QuoteFolderOpenButton)를 쓴다. */
export function QuoteFolderOpenControl({ quoteId, className, disabled = false, onOutcome }: QuoteFolderOpenButtonProps) {
  const [busy, setBusy] = useState(false);

  async function handleClick() {
    if (busy) return;
    setBusy(true);
    onOutcome(null);
    try {
      onOutcome(await runQuoteFolderOpen({ quoteId }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={() => void handleClick()}
      disabled={disabled || busy}
      aria-busy={busy}
      title={QUOTE_FOLDER_OPEN_BUTTON_TITLE}
      data-quote-folder-open=""
      className={className}
    >
      {busy ? "여는 중…" : "폴더 열기"}
    </button>
  );
}

/** 🔴 Windows PC 에서만 그린다 — 서버 렌더 · 첫 렌더는 감춘 채. */
export default function QuoteFolderOpenButton(props: QuoteFolderOpenButtonProps) {
  const isWindows = useSyncExternalStore(subscribeToNothing, isWindowsDesktopNow, hiddenOnServer);
  if (!isWindows) return null;
  return <QuoteFolderOpenControl {...props} />;
}

/** 결과 줄 아래에 붙는 작은 단추 둘 — 같은 모양을 쓴다(링크가 아니다). */
const NOTICE_ACTION_CLASS =
  "underline underline-offset-2 hover:text-zinc-800 disabled:opacity-50 dark:hover:text-zinc-200";

/** 한 번에 하나만 돈다 — 어느 것이 도는지. */
type NoticeAction = "command" | "path";

/**
 * [폴더 열기] 결과 — 편집 화면이 [견적서 받기] 결과와 같은 자리(머리 아래)에 그린다.
 *
 * ── 🔴 화면은 설치 파일을 주지 않는다 (사용자 결정 2026-09-16) ──────────────
 * 설치 파일(.cmd)은 Windows 가 막아 [속성] › [차단 해제]를 거쳐야 열린다. 그 단계를 사람에게
 * 시키는 대신 **PowerShell 에 붙여넣는 길 하나로 모았다.** 그래서 이 화면에는 [설치 파일 다시
 * 받기]가 없고, 폴더를 찾았을 때 나오는 선택지는 아래 둘뿐이다.
 *  · [위치 복사] — 🔴 `outcome.uncPath` 가 **있을 때만**. 서버에 공유폴더 주소 설정이 없으면
 *    응답에 그 칸이 아예 없고, 그때는 단추도 없다. 붙여넣으면 도우미 없이도 폴더가 열린다.
 *  · [설치 명령 복사] — 폴더를 찾았으면 늘 낸다(`offerHelperInstall`). 도우미가 없어 보이는
 *    결과(NO_RESPONSE)에서는 결과 줄이 이 단추를 가리킨다.
 */
export function QuoteFolderOpenNotice({ outcome, className = "" }: { outcome: QuoteFolderOpenOutcome; className?: string }) {
  // 누른 결과는 어느 결과에 딸린 것인지 함께 든다 — 새로 누르면 지난 줄이 저절로 사라진다.
  const [answer, setAnswer] = useState<{ outcome: QuoteFolderOpenOutcome; lines: QuoteIssueNoticeLine[] } | null>(null);
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
    <div className={`flex flex-col gap-1 ${className}`}>
      <QuoteIssueNoticeLines lines={outcome.lines} />
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
                data-quote-folder-unc-path=""
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
            data-quote-folder-helper-install-command=""
            className={NOTICE_ACTION_CLASS}
          >
            {busy === "command" ? "복사하는 중…" : "설치 명령 복사"}
          </button>
        </p>
      )}
      <QuoteIssueNoticeLines lines={answerLines} />
    </div>
  );
}
