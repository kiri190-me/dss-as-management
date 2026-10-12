"use client";

import { useState, useSyncExternalStore } from "react";

import {
  isWindowsDesktopClient,
  readQuoteFolderClientPlatform,
  runQuoteFolderHelperInstallCommandCopy,
} from "@/components/quotes/quote-folder-open";
import type { QuoteIssueNoticeLine, QuoteIssueNoticeTone } from "@/components/quotes/quote-issue-messages";
import type { ServiceReportKind } from "@/lib/xlsx/service-report-template";
import {
  SERVICE_REPORT_EXCEL_OPEN_BUTTON_TITLE,
  runServiceReportExcelOpen,
  type ServiceReportExcelOpenOutcome,
} from "./service-report-excel-open";

/**
 * ============================================================================
 * 보고서 목록 한 줄의 [Excel 보기] 단추 (2026-10-12)
 * ============================================================================
 * 누르면 그 보고서의 엑셀이 **공유폴더에서 찾아져** 이 PC 의 Excel 로 열린다. 누른 뒤의
 * 세 걸음(맨 위 칸 읽기 → 분류 폴더 안에서 그 장 고르기 → 여는 장치에 넘기기)은 전부
 * service-report-excel-open.ts 가 한다 — 이 조각은 **단추와 결과 줄만** 그린다.
 *
 * 🔴 **생김새는 부르는 쪽이 준다**(`className`). 같은 줄에 선 [미리보기 · PDF]와 **나란히
 * 서는 둘**이라 한쪽만 바뀌면 그 자리에서 바로 어긋나 보인다 — 그래서 목록 조각이 쥔
 * 한 벌을 그대로 받는다(ServiceReportList 의 `ACTION_LINK_CLASS`). 🔴 상수를 여기서
 * 내보여 목록이 가져가게 하면 안 된다: 목록은 **서버 컴포넌트**라 "use client" 모듈의
 * 값을 가져가면 글자가 아니라 클라이언트 참조를 받는다.
 *
 * ── 🔴 Windows 가 아니면 단추가 없다 ────────────────────────────────────
 * 도우미는 Windows PC 에만 설치된다. 렌더 중에 navigator 를 만지면 서버 렌더와 첫 렌더가
 * 어긋나므로(hydration) useSyncExternalStore 에 서버용 스냅샷(「아니다」)을 따로 준다 —
 * 공유폴더 구역의 줄 [열기] · 견적서 [Excel 보기]와 **같은 방법**이다.
 * 🔴 그 결과 **Windows 가 아닌 기기에서는 이 줄에서 엑셀을 볼 길이 없다** — 알고 하는
 * 일이다(ServiceReportList 머리말).
 *
 * ── 🔴 두 번 눌러도 두 번 열리지 않는다 ─────────────────────────────────
 * 찾는 동안 단추를 잠그고(busy) 글자를 「여는 중…」으로 바꾼다. 공유폴더가 느릴 수 있어
 * 눌린 것이 보이지 않으면 사람이 한 번 더 누른다.
 *
 * ── 🔴 어디에 알리나 — 그 줄 옆이다 ─────────────────────────────────────
 * 줄마다 있는 단추라 화면 위의 띠에 적으면 어느 보고서 이야기인지 알 수 없다. 공유폴더
 * 구역의 줄 [열기]가 이미 그 줄 옆에 결과를 적고 있어 그 결을 그대로 따른다.
 *
 * 🔴 결과 줄에 따라오는 「열리지 않으면 도우미를 다시 설치해 주세요」와 [설치 명령 복사]는
 * 여는 장치가 제 결과로 내는 것이다 — 여기서 끄지 않는다.
 *
 * ── 🔴 인쇄에 안 찍힌다 ─────────────────────────────────────────────────
 * 종이에 남을 이유가 없는 조작 단추라 바깥 틀에 `print:hidden` 을 건다.
 * ============================================================================
 */

const subscribeToNothing = () => () => {};
const isWindowsDesktopNow = () =>
  typeof navigator !== "undefined" && isWindowsDesktopClient(readQuoteFolderClientPlatform(navigator));
const hiddenOnServer = () => false;

const NOTICE_TONE_CLASS: Record<QuoteIssueNoticeTone, string> = {
  normal: "text-zinc-700 dark:text-zinc-300",
  muted: "text-zinc-400 dark:text-zinc-500",
  warning: "font-medium text-amber-700 dark:text-amber-400",
};

/** 결과 줄들. 🔴 `<span>` 으로 적는다 — 이 조각은 목록 한 줄 안(인라인 자리)에 들어간다. */
function NoticeLines({ lines }: { lines: readonly QuoteIssueNoticeLine[] }) {
  if (lines.length === 0) return null;
  return (
    <>
      {lines.map((line, index) => (
        <span key={`${index}-${line.text}`} className={`block break-words ${NOTICE_TONE_CLASS[line.tone]}`}>
          {line.text}
        </span>
      ))}
    </>
  );
}

export type ServiceReportExcelOpenButtonProps = {
  repairCaseId: string;
  /** 🔴 검사냐 수리냐 — 분류 폴더를 가르는 값이다. */
  reportKind: ServiceReportKind;
  /**
   * 그 보고서의 엑셀이 연락서 폴더에 들어간 이름. 🔴 **페이지가 이름 규칙 두 함수로 지어
   * 넘긴다** — 이 조각도 흐름도 이름을 짓지 않는다.
   */
  fileName: string;
  /** 한 줄에 나란히 선 [미리보기 · PDF]와 같은 생김새(머리말). */
  className: string;
  /** 보조기술에 읽히는 이름 — 한 화면에 같은 글자가 여럿이라 무엇의 것인지 밝힌다. */
  ariaLabel: string;
};

/** 단추와 결과 줄 — Windows 판단 없이. 화면에는 기본 내보내기를 쓴다. */
export function ServiceReportExcelOpenControl({
  repairCaseId,
  reportKind,
  fileName,
  className,
  ariaLabel,
}: ServiceReportExcelOpenButtonProps) {
  const [busy, setBusy] = useState(false);
  const [copyBusy, setCopyBusy] = useState(false);
  const [outcome, setOutcome] = useState<ServiceReportExcelOpenOutcome | null>(null);
  const [copyLines, setCopyLines] = useState<QuoteIssueNoticeLine[]>([]);

  async function handleOpen() {
    // 🔴 찾는 중에는 다시 눌리지 않는다 — 단추도 잠그지만 여기서도 한 번 더 막는다.
    if (busy) return;
    setBusy(true);
    setOutcome(null);
    setCopyLines([]);
    try {
      setOutcome(await runServiceReportExcelOpen({ repairCaseId, reportKind, fileName }));
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
    <span className="print:hidden flex min-w-0 max-w-[16rem] flex-col items-end gap-0.5 whitespace-normal text-right">
      <button
        type="button"
        onClick={() => void handleOpen()}
        disabled={busy}
        aria-busy={busy}
        aria-label={ariaLabel}
        title={SERVICE_REPORT_EXCEL_OPEN_BUTTON_TITLE}
        data-service-report-excel-open=""
        className={`shrink-0 disabled:opacity-50 ${className}`}
      >
        {busy ? "여는 중…" : "Excel 보기"}
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
              data-service-report-excel-helper-install-command=""
              className="text-xs text-zinc-500 underline underline-offset-2 hover:text-zinc-800 disabled:opacity-50 dark:text-zinc-400 dark:hover:text-zinc-200"
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

/** 🔴 Windows PC 에서만 그린다 — 서버 렌더 · 첫 렌더는 감춘 채. */
export default function ServiceReportExcelOpenButton(props: ServiceReportExcelOpenButtonProps) {
  const isWindows = useSyncExternalStore(subscribeToNothing, isWindowsDesktopNow, hiddenOnServer);
  if (!isWindows) return null;
  return <ServiceReportExcelOpenControl {...props} />;
}
