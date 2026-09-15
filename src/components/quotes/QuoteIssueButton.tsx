"use client";

import { useState } from "react";
import { runQuoteIssue, type QuoteIssueRunOutcome } from "./quote-issue-download";
import type { QuoteIssueNoticeLine, QuoteIssueNoticeTone } from "./quote-issue-messages";

/**
 * ============================================================================
 * 수정 권한자의 [견적서 받기] 단추 · 결과 줄 (견적서 B1c)
 * ============================================================================
 * 세 화면(목록 표 · 카드, 편집 화면, 인쇄 미리보기)이 이 단추 하나를 쓴다 — 두 벌이면 한쪽만
 * 결과를 알리거나 한쪽만 저장하지 않은 변경을 막는 날이 온다. 누르면 runQuoteIssue
 * (quote-issue-download.ts)가 발행 통로를 부르고, 파일을 저장하고, 무엇이 됐는지 줄로 돌려준다.
 *
 * 🔴 **수정 권한자 화면에만 그린다.** 보기 권한자는 지금까지의 링크(GET …/xlsx) 그대로다 —
 * 부르는 쪽이 권한으로 가른다(목록의 canEdit · 인쇄 화면의 canIssue · 편집 화면은 수정
 * 권한자만 들어온다). 서버 통로도 quotes WRITE 를 스스로 다시 본다.
 *
 * 결과 줄은 단추 아래에 그리거나(showNotice 기본), 부르는 쪽이 onOutcome 으로 받아 제자리에
 * 그린다(목록은 화면 위 · 편집 화면은 머리 아래).
 *
 * 앱 양식 미리보기는 다크 모드에서도 흰 종이다(QuotePrintView 의 .qp-root) — `onPaper` 면
 * dark: 색을 쓰지 않는다. 안 그러면 흰 바탕에 밝은 회색 글자가 된다.
 *
 * 서버 액션을 부르지 않는다 — `server-only` 사슬 없이 그려 볼 수 있다(QuoteIssueButton.test.tsx).
 * ============================================================================
 */

const LINE_TONE_CLASS: Record<QuoteIssueNoticeTone, string> = {
  normal: "text-zinc-700 dark:text-zinc-300",
  muted: "text-zinc-400 dark:text-zinc-500",
  warning: "font-medium text-amber-700 dark:text-amber-400",
};

const PAPER_LINE_TONE_CLASS: Record<QuoteIssueNoticeTone, string> = {
  normal: "text-zinc-700",
  muted: "text-zinc-400",
  warning: "font-medium text-amber-700",
};

/** 결과 줄들. 없으면 아무것도 그리지 않는다. 긴 경로도 줄바꿈한다(break-all). */
export function QuoteIssueNoticeLines({
  lines,
  onPaper = false,
  className = "",
}: {
  lines: readonly QuoteIssueNoticeLine[];
  onPaper?: boolean;
  className?: string;
}) {
  if (lines.length === 0) return null;
  const tones = onPaper ? PAPER_LINE_TONE_CLASS : LINE_TONE_CLASS;
  return (
    <ul role="status" className={`flex flex-col gap-0.5 text-xs ${className}`}>
      {lines.map((line, index) => (
        <li key={`${index}-${line.text}`} className={`break-all ${tones[line.tone]}`}>
          {line.text}
        </li>
      ))}
    </ul>
  );
}

/** 단추에 마우스를 올리면 보이는 설명 — 링크(보기 권한자)와 하는 일이 다르다는 것. */
export const QUOTE_ISSUE_BUTTON_TITLE = "내려받으면서 사내 공유폴더에 저장하고, 수기 견적서 엑셀 칸에도 넣습니다";

export default function QuoteIssueButton({
  quoteId,
  label,
  className,
  title = QUOTE_ISSUE_BUTTON_TITLE,
  hasUnsavedChanges = false,
  disabled = false,
  showNotice = true,
  onPaper = false,
  onOutcome,
}: {
  quoteId: string;
  label: string;
  className: string;
  title?: string;
  /** 🔴 편집 화면 — 마지막 저장값과 지금 폼 값이 다르다. 참이면 통로를 부르지 않는다. */
  hasUnsavedChanges?: boolean;
  disabled?: boolean;
  /** 결과 줄을 단추 아래에 그린다. 부르는 쪽이 제자리에 그리면 거짓. */
  showNotice?: boolean;
  onPaper?: boolean;
  onOutcome?: (outcome: QuoteIssueRunOutcome) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [lines, setLines] = useState<QuoteIssueNoticeLine[]>([]);

  async function handleClick() {
    if (busy) return;
    setBusy(true);
    setLines([]);
    try {
      // 저장하지 않은 변경이 있으면 runQuoteIssue 가 통로를 부르지 않고 「먼저 [저장]」을 돌려준다.
      const outcome = await runQuoteIssue({ quoteId, hasUnsavedChanges });
      setLines(outcome.lines);
      onOutcome?.(outcome);
    } finally {
      setBusy(false);
    }
  }

  const button = (
    <button
      type="button"
      onClick={() => void handleClick()}
      disabled={disabled || busy}
      aria-busy={busy}
      title={title}
      data-quote-issue=""
      className={className}
    >
      {busy ? "받는 중…" : label}
    </button>
  );

  if (!showNotice) return button;
  return (
    <div className="inline-flex max-w-[22rem] flex-col items-end gap-1">
      {button}
      <QuoteIssueNoticeLines lines={lines} onPaper={onPaper} className="text-right" />
    </div>
  );
}
