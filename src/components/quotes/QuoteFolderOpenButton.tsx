"use client";

import { useState, useSyncExternalStore } from "react";
import { QuoteIssueNoticeLines } from "./QuoteIssueButton";
import type { QuoteIssueNoticeLine } from "./quote-issue-messages";
import {
  isWindowsDesktopClient,
  readQuoteFolderClientPlatform,
  runQuoteFolderHelperInstallerDownload,
  runQuoteFolderOpen,
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
 * 도우미는 Windows PC 에만 설치된다. 휴대폰 · Mac · Linux 에서 누르면 설치 파일(.cmd)만 받게
 * 된다 — 그래서 감춘다. 렌더 중에 navigator 를 만지면 서버 렌더와 첫 렌더가 어긋난다
 * (hydration). useSyncExternalStore 에 서버용 스냅샷(「아니다」)을 따로 주면 서버 · 첫 렌더는
 * 감춘 채 그리고, 마운트 뒤 실제 값으로 한 번 맞춰진다(EditSectionActions 의 복사 단추와 같은 방법).
 *
 * ── 잠금 ────────────────────────────────────────────────────────────────
 * 저장 중 · 충돌이면 잠근다(부르는 쪽의 disabled). 저장하지 않은 변경이 있어도 막지 않는다 —
 * 폴더를 열 뿐 파일을 만들지 않는다([견적서 받기]와 다르다).
 *
 * ── [설치 파일 다시 받기]는 링크가 아니라 단추다 ─────────────────────────────
 * `<a href="/api/quote-folder-helper/installer">` 는 서버가 409(공유폴더 주소 설정 없음)를 주면
 * 그 JSON 페이지로 넘어가 버린다 — 편집 화면의 저장하지 않은 변경이 사라진다. 그래서 fetch 로
 * 받아 저장하고, 실패는 문장으로 알린다(runQuoteFolderHelperInstallerDownload).
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
  "사내 공유폴더에서 이 견적서의 폴더를 탐색기로 엽니다 — 이 PC 에 폴더 열기 도우미가 없으면 설치 파일을 받습니다";

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

/**
 * [폴더 열기] 결과 — 편집 화면이 [견적서 받기] 결과와 같은 자리(머리 아래)에 그린다.
 * 도우미가 반응했거나 이 브라우저에서 반응한 적이 있으면 「탐색기가 열리지 않았다면
 * [설치 파일 다시 받기]」를 덧붙인다.
 */
export function QuoteFolderOpenNotice({ outcome, className = "" }: { outcome: QuoteFolderOpenOutcome; className?: string }) {
  // 다시 받은 결과는 어느 결과에 딸린 것인지 함께 든다 — 새로 누르면 지난 줄이 저절로 사라진다.
  const [redownload, setRedownload] = useState<{ outcome: QuoteFolderOpenOutcome; lines: QuoteIssueNoticeLine[] } | null>(
    null
  );
  const [downloading, setDownloading] = useState(false);
  const redownloadLines = redownload?.outcome === outcome ? redownload.lines : [];

  async function handleRedownload() {
    if (downloading) return;
    setDownloading(true);
    try {
      const lines = await runQuoteFolderHelperInstallerDownload();
      setRedownload({ outcome, lines });
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <QuoteIssueNoticeLines lines={outcome.lines} />
      {outcome.offerInstallerDownload && (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          탐색기가 열리지 않았다면{" "}
          <button
            type="button"
            onClick={() => void handleRedownload()}
            disabled={downloading}
            aria-busy={downloading}
            data-quote-folder-helper-installer=""
            className="underline underline-offset-2 hover:text-zinc-800 disabled:opacity-50 dark:hover:text-zinc-200"
          >
            {downloading ? "받는 중…" : "설치 파일 다시 받기"}
          </button>
        </p>
      )}
      <QuoteIssueNoticeLines lines={redownloadLines} />
    </div>
  );
}
