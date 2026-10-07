"use client";

import { useState, useSyncExternalStore } from "react";

import {
  QUOTE_ARCHIVE_EXCEL_OPEN_BUTTON_TITLE,
  runQuoteArchiveExcelOpen,
  type QuoteArchiveExcelOpenOutcome,
} from "./quote-archive-excel-open";
import {
  isWindowsDesktopClient,
  readQuoteFolderClientPlatform,
  runQuoteFolderHelperInstallCommandCopy,
} from "./quote-folder-open";
import type { QuoteIssueNoticeLine, QuoteIssueNoticeTone } from "./quote-issue-messages";

/**
 * ============================================================================
 * [Excel 보기] — 그 줄의 엑셀을 공유폴더에서 찾아 이 PC 의 엑셀로 연다 (2026-10-06)
 * ============================================================================
 * 사용자 지시: 「견적서 목록에서 [미리보기 · PDF] 옆에 [Excel 보기]를 만들어서 폴더에 있는
 * 해당 견적서를 바로 열 수 있도록 해줘.」 자리는 [미리보기 · PDF] **바로 오른쪽**이다 —
 * 그 줄의 서류를 보는 두 길이 나란히 서고, 지우는 단추는 끝에 그대로 남는다.
 *
 * 🔴 **2026-10-07 에 이 조각이 제 파일로 나왔다** — 글자는 한 자도 안 바뀌었다.
 * 그때까지는 목록 화면 원본(`QuoteListScreen.tsx` 의 742~868줄) 안에 박혀 있었는데, 그
 * 화면이 **공용 묶음(`@dss/core/ui/quotes/QuoteListScreen`)의 것**으로 바뀌면서 박아 둘
 * 자리가 없어졌다. 공용 화면은 PO/내자 사이트와 함께 쓰는 한 벌이라 A/S 에만 있는 조각을
 * 그 안에 넣을 수 없다(서브모듈이기도 하다). 그래서 그 화면이 열어 둔 `renderRowActions`
 * 슬롯에 이 조각을 끼운다(QuoteListSlots.tsx). PO 도 같은 이름 · 같은 자리에 같은 파일을
 * 두고 있다(`dss-po/src/components/quotes/QuoteArchiveExcelOpenButton.tsx`).
 *
 * 누른 뒤의 세 걸음(폴더 안 목록 받기 → 번호가 맞는 엑셀 고르기 → 여는 장치에 넘기기)은
 * 전부 quote-archive-excel-open.ts 가 한다. 이 조각은 **단추와 결과 줄만** 그린다.
 *
 * ── 🔴 누를 때 찾는다 ───────────────────────────────────────────────────
 * 목록을 그릴 때는 공유폴더를 읽지 않는다. 줄이 열한 개면 화면을 여는 것만으로 공유폴더를
 * 열한 번 때리게 된다 — NAS 가 느린 날 목록 자체가 늦어진다.
 *
 * ── 🔴 두 번 눌러도 두 번 열리지 않는다 ─────────────────────────────────
 * 찾는 동안 단추를 잠그고(busy) 글자를 「여는 중…」으로 바꾼다. 공유폴더가 느릴 수 있어
 * 눌린 것이 보이지 않으면 사람이 한 번 더 누른다.
 *
 * ── 🔴 어디에 알리나 — 그 줄 옆이다 ─────────────────────────────────────
 * 화면 위의 띠(목록 화면의 trashError)는 **한 번에 하나**뿐인 조작(지우기 · 되살리기)의
 * 자리다. 이 단추는 줄마다 있어 띠에 적으면 어느 견적서 이야기인지 알 수 없다. 공유폴더
 * 구역의 줄 [열기]가 이미 **그 줄 아래에** 결과를 적고 있어 그 결을 그대로 따른다.
 *
 * ── 🔴 안 그리는 경우는 Windows 가 아닐 때뿐이다 ────────────────────────
 * 도우미는 Windows PC 에만 설치된다 — 그 밖의 기기에서는 누를 수 있어도 열리지 않는다.
 * 공유폴더 설정이 꺼져 있는지(disabled), 그 종류의 엑셀이 만들어지는지(엑셀 전용 장은
 * 저장이 공유폴더를 건너뛴다)는 **누르기 전에 알 수 없고**, 알더라도 사람이 손으로 넣어 둔
 * 엑셀이 그 폴더에 있을 수 있다. 그래서 줄마다 그냥 그리고, 누르면 사실대로 알린다.
 *
 * 🔴 결과 줄에 따라오는 「열리지 않으면 도우미를 다시 설치해 주세요」와 [설치 명령 복사]는
 * 여는 장치가 제 결과로 내는 것이다 — 여기서 끄지 않는다.
 * ============================================================================
 */
const subscribeToNothing = () => () => {};
const isWindowsDesktopNow = () =>
  typeof navigator !== "undefined" && isWindowsDesktopClient(readQuoteFolderClientPlatform(navigator));
const hiddenOnServer = () => false;

const EXCEL_NOTICE_TONE_CLASS: Record<QuoteIssueNoticeTone, string> = {
  normal: "text-zinc-700 dark:text-zinc-300",
  muted: "text-zinc-400 dark:text-zinc-500",
  warning: "font-medium text-amber-700 dark:text-amber-400",
};

/** 결과 줄들. 목록 한 줄 안(인라인 자리)에 들어가므로 span 으로 적는다. */
function ExcelNoticeLines({ lines }: { lines: readonly QuoteIssueNoticeLine[] }) {
  if (lines.length === 0) return null;
  return (
    <>
      {lines.map((line, index) => (
        <span key={`${index}-${line.text}`} className={`block break-words ${EXCEL_NOTICE_TONE_CLASS[line.tone]}`}>
          {line.text}
        </span>
      ))}
    </>
  );
}

/**
 * 🔴 줄 하나를 받는다 — 쓰는 칸은 **id 와 발행번호 둘뿐**이다. 목록 줄 타입을 통째로 받지
 * 않는 까닭 둘:
 *  · 이 조각이 그 타입의 다른 칸(엑셀 전용 여부 · 금액 …)을 보기 시작하면 「누르기 전에
 *    아는 척」하는 갈래가 생긴다(위 머리말).
 *  · 목록 줄의 타입은 이제 **공용 묶음의 것**이다(@dss/core/ui/quotes/quote-list-rows).
 *    여기서 그것을 들여오면 이 조각이 그 묶음에 묶인다 — 쓰는 칸 둘만 적으면 그럴 일이 없다.
 */
export type QuoteArchiveExcelOpenRow = { id: string; quoteNumber: string };

export default function QuoteArchiveExcelOpenButton({ row }: { row: QuoteArchiveExcelOpenRow }) {
  // 렌더 중에 navigator 를 만지면 서버 렌더와 첫 렌더가 어긋난다(hydration) — 서버용
  // 스냅샷을 따로 준다. 공유폴더 구역의 줄 [열기]와 같은 방법이다.
  const isWindows = useSyncExternalStore(subscribeToNothing, isWindowsDesktopNow, hiddenOnServer);
  const [busy, setBusy] = useState(false);
  const [copyBusy, setCopyBusy] = useState(false);
  const [outcome, setOutcome] = useState<QuoteArchiveExcelOpenOutcome | null>(null);
  const [copyLines, setCopyLines] = useState<QuoteIssueNoticeLine[]>([]);

  async function handleOpen() {
    // 🔴 찾는 중에는 다시 눌리지 않는다 — 단추도 잠그지만 여기서도 한 번 더 막는다.
    if (busy) return;
    setBusy(true);
    setOutcome(null);
    setCopyLines([]);
    try {
      setOutcome(await runQuoteArchiveExcelOpen({ quoteId: row.id, quoteNumber: row.quoteNumber }));
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

  if (!isWindows) return null;

  return (
    <span className="print:hidden flex min-w-0 max-w-[16rem] flex-col items-start gap-0.5 whitespace-normal">
      <button
        type="button"
        onClick={() => void handleOpen()}
        disabled={busy}
        aria-busy={busy}
        title={QUOTE_ARCHIVE_EXCEL_OPEN_BUTTON_TITLE}
        data-quote-archive-excel-open=""
        className="shrink-0 rounded-md border border-zinc-300 px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
      >
        {busy ? "여는 중…" : "Excel 보기"}
      </button>
      {outcome && (
        <span role="status" className="flex min-w-0 flex-col items-start gap-0.5 text-xs">
          <ExcelNoticeLines lines={outcome.lines} />
          {outcome.offerHelperInstall && (
            <button
              type="button"
              onClick={() => void handleCopy()}
              disabled={copyBusy}
              aria-busy={copyBusy}
              data-quote-archive-excel-helper-install-command=""
              className="text-xs text-zinc-500 underline underline-offset-2 hover:text-zinc-800 disabled:opacity-50 dark:text-zinc-400 dark:hover:text-zinc-200"
            >
              {copyBusy ? "복사하는 중…" : "설치 명령 복사"}
            </button>
          )}
          <ExcelNoticeLines lines={copyLines} />
        </span>
      )}
    </span>
  );
}
