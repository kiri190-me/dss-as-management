"use client";

import { useState, useTransition } from "react";

import { copyText } from "@/components/common/copy-text";
import PrintFitFrame from "@/components/common/print-fit-frame";
import { PX_PER_MM, SheetPrintGridView, planPaper } from "@/components/print-grid/SheetPrintGridView";
import { runQuoteFolderHelperInstallCommandCopy } from "@/components/quotes/quote-folder-open";
import {
  customerFormExportFolderAction,
  previewCustomerFormExportAction,
  saveCustomerFormExportAction,
} from "@/lib/server/actions/customer-portal-export";

/**
 * 미리보기가 받아 오는 것. 🔴 통로의 타입을 **이름으로 가져오지 않고 되짚는다** — 저쪽은
 * `"use server"` 파일이고, 그 파일에서 가져오는 이름은 값이든 타입이든 하나하나 통로가
 * 된다. 되짚으면 통로는 부르는 함수 셋뿐이고, 모양이 바뀌면 여기서 바로 깨진다.
 */
type CustomerFormExportPreview = Extract<
  Awaited<ReturnType<typeof previewCustomerFormExportAction>>,
  { ok: true }
>;

/**
 * ============================================================================
 * 고객사 양식 표를 **엑셀로** — [미리보기] · [공유폴더에 저장] · [폴더 열기]
 * ============================================================================
 * 「고객 안내 현황」의 양식 보기에서만 보인다. 서버가 공유폴더의 **직전 파일**을 바탕으로
 * 통합문서를 만들고, 이 조각은 그 결과를 보여 주고 저장을 시킨다.
 *
 * ── 🔴 미리보기는 저장될 그 파일이다 ─────────────────────────────────────
 * 보여 주는 격자는 서버가 만든 **그 통합문서**를 다시 읽어 그린 것이다(보고서 · 수기
 * 견적서 미리보기와 같은 조각 — components/print-grid/SheetPrintGridView).
 * 미리보기용으로 따로 그리지 않는다.
 *
 * ── 🔴 저장은 같은 이름을 덮어쓴다 (사용자 결정 2026-09-30) ────────────────
 * 언제나 **오늘 날짜가 붙은 이름**으로 쓴다. 그 이름의 파일이 이미 있으면 덮어쓴다 —
 * 예전처럼 ` (2)` 로 넘어가지 않는다. 덮어쓰면 사람이 그 파일을 손으로 고쳐 둔 내용이
 * 사라지므로, **「새로 만듦」 · 「덮어씀」 · 「내용이 같아 그대로 둠」을 다른 문장으로**
 * 내고 덮어쓴 경우만 경고 결(호박색)로 낸다. 조용히 넘어가지 않는다.
 *
 * ── [폴더 열기]는 **이미 설치된 도우미**를 쓴다 · 설치도 여기서 한다 ───────
 * 견적서 화면의 그 도우미다(레지스트리 `dss-folder`). PC 마다 한 벌뿐이라 **새 도우미를
 * 만들지 않는다** — 여기서 내미는 [설치 명령 복사]는 견적서 화면과 **똑같은 한 벌**을
 * 설치한다(components/quotes/quote-folder-open.ts 의 runQuoteFolderHelperInstallCommandCopy).
 * 🔴 그 한 벌에 현황표 공유폴더의 루트도 함께 심긴다(2026-09-30 — 현황표 폴더는 견적서
 * 루트 아래가 아니다). 루트는 **설치할 때 박히므로**, 그 설정이 생기기 전에 설치한 PC 는
 * 설치를 한 번 더 해야 이 단추가 동작한다 — 아래 안내 문장이 그 말을 한다.
 * 🔴 설치가 늘려 주는 것은 **누가 설치 파일을 받을 수 있나**뿐이다 — 도우미가 열 수 있는
 * 폴더는 설치할 때 박힌 루트 아래 그대로다(api/quote-folder-helper/*).
 * ============================================================================
 */

type NoticeTone = "normal" | "warning" | "muted";
type Notice = { text: string; tone: NoticeTone };

const NOTICE_CLASS: Record<NoticeTone, string> = {
  normal: "text-zinc-700",
  warning: "text-amber-800",
  muted: "text-zinc-500",
};

/** 견적서 쪽 설치 흐름이 돌려주는 줄. 타입도 **되짚어** 쓴다(미리보기와 같은 방법). */
type HelperNoticeLine = Awaited<ReturnType<typeof runQuoteFolderHelperInstallCommandCopy>>[number];

/**
 * 그쪽 결을 이 화면의 결로 옮긴다. 지금은 두 이름이 같지만 손으로 가른다 — 저쪽에 결이
 * 하나 늘면 **여기서 tsc 가 멈춘다**(조용히 다른 색으로 새지 않게).
 */
function noticeToneOf(tone: HelperNoticeLine["tone"]): NoticeTone {
  switch (tone) {
    case "warning":
      return "warning";
    case "muted":
      return "muted";
    case "normal":
      return "normal";
  }
}

/**
 * 도우미가 없을 때 · **옛 설치본일 때** 사람이 할 수 있는 일 — 이제 이 화면에서 바로 설치한다
 * (사용자 요청 2026-09-30: 「[폴더 열기] 버튼이 있는 곳 어디서든 설치할 수 있도록」).
 *
 * 🔴 「이미 설치했더라도 한 번 더」를 함께 적는 까닭: 도우미는 설치될 때 루트가 박힌다(그 값이
 * 저장소에 남지 않게 요청마다 만든다). 그래서 현황표 폴더의 루트를 관리자가 뒤에 설정했다면,
 * 그 전에 설치한 PC 의 도우미는 그 폴더를 **모른 채** "폴더를 찾을 수 없습니다"로 끝난다 —
 * 설치를 한 번 더 해야 알게 된다. 이 문장이 없으면 사람은 「도우미는 깔았는데 왜 안 되지」에서
 * 멈춘다. 견적서 화면의 같은 자리 문장(QUOTE_FOLDER_HELPER_MISSING_TEXT)과 뜻이 어긋나지 않게
 * 「관리자 권한은 필요 없습니다」까지 같은 말로 맞춘다 — 설치되는 것이 **똑같은 한 벌**이다.
 */
export const PORTAL_FOLDER_HELPER_HINT_TEXT =
  "탐색기가 열리지 않으면 이 PC 에 폴더 열기 도우미가 없거나 예전 설치본입니다 — [설치 명령 복사]를 눌러 PowerShell 창에 붙여넣어 주세요(이미 설치했더라도 한 번 더 하면 이 폴더까지 알게 됩니다). 관리자 권한은 필요 없습니다.";

/** 설치 단추에 마우스를 올리면 보이는 설명 — 새 도우미가 아니라는 것을 분명히 한다. */
export const PORTAL_FOLDER_HELPER_INSTALL_BUTTON_TITLE =
  "견적서 화면과 같은 폴더 열기 도우미 한 벌을 이 PC 에 설치하는 명령을 복사합니다 — PowerShell 창에 붙여넣으면 됩니다";

export const PORTAL_FOLDER_UNC_COPIED_TEXT =
  "폴더 위치를 복사했습니다 — 탐색기 주소창에 붙여넣고 Enter 를 눌러 주세요.";

export const PORTAL_FOLDER_UNC_COPY_BLOCKED_TEXT =
  "이 브라우저에서는 자동 복사가 막혀 있습니다 — 아래 주소를 직접 긁어 복사해 주세요.";

/** 숨은 iframe 을 늦게 치운다 — 곧바로 떼면 주소 넘기기가 취소될 수 있다. */
const HIDDEN_FRAME_RELEASE_MS = 10_000;

/**
 * 도우미 주소를 **페이지를 떠나지 않고** 연다. `location.assign` 은 도우미가 없는 PC 에서
 * 오류 페이지로 넘어갈 수 있다 — 이 화면에는 저장하지 않은 줄이 있을 수 있다.
 */
function openHelperLink(link: string): void {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.tabIndex = -1;
  frame.style.cssText = "position:absolute;width:0;height:0;border:0;visibility:hidden";
  frame.src = link;
  document.body.appendChild(frame);
  window.setTimeout(() => frame.remove(), HIDDEN_FRAME_RELEASE_MS);
}

export default function CustomerFormExportPanel({
  customerId,
  formLabel,
  canSave,
}: {
  customerId: string;
  formLabel: string;
  /** `customerPortal` WRITE 가 있는가. 없으면 [공유폴더에 저장]이 잠긴다. */
  canSave: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [notices, setNotices] = useState<Notice[]>([]);
  const [uncPath, setUncPath] = useState<string | null>(null);
  /**
   * [폴더 열기]가 한 번이라도 통한 뒤에만 설치 안내를 낸다 — 견적서 화면의
   * `offerHelperInstall` 과 같은 결이다. 공유폴더 설정이 없어 열 수조차 없을 때
   * 설치부터 시키면 사람이 헛일을 한다.
   */
  const [offerHelperInstall, setOfferHelperInstall] = useState(false);
  const [preview, setPreview] = useState<CustomerFormExportPreview | null>(null);

  const run = (work: () => Promise<Notice[]>) => {
    startTransition(async () => {
      setNotices(await work());
    });
  };

  const handlePreview = () =>
    run(async () => {
      const result = await previewCustomerFormExportAction({ customerId });
      if (!result.ok) {
        setPreview(null);
        return [{ text: result.message, tone: "warning" as const }];
      }
      setPreview(result);
      return [
        {
          text: `${result.rowCount}줄로 만들었습니다 — 저장하면 「${result.fileName}」 이 됩니다.`,
          tone: "normal" as const,
        },
        {
          text: result.addsTab
            ? `바탕: ${result.previousFileName}(${result.previousRowCount}줄) — 「${result.sheetName}」 탭이 새로 하나 더해집니다.`
            : `바탕: ${result.previousFileName}(${result.previousRowCount}줄) — 「${result.sheetName}」 탭의 내용이 바뀝니다.`,
          tone: "muted" as const,
        },
      ];
    });

  const handleSave = () =>
    run(async () => {
      const result = await saveCustomerFormExportAction({ customerId });
      // 🔴 덮어썼을 때는 경고 결로 낸다 — 사람이 손으로 고쳐 둔 내용이 사라졌을 수 있다.
      if (!result.ok) return [{ text: result.message, tone: "warning" as const }];
      return [{ text: result.message, tone: result.status === "replaced" ? "warning" : "normal" }];
    });

  const handleOpenFolder = () =>
    run(async () => {
      const result = await customerFormExportFolderAction();
      if (!result.ok) {
        setUncPath(null);
        setOfferHelperInstall(false);
        return [{ text: result.message, tone: "warning" as const }];
      }
      setUncPath(result.uncPath ?? null);
      setOfferHelperInstall(true);
      try {
        openHelperLink(result.link);
      } catch {
        return [{ text: "브라우저가 폴더 열기 주소를 열지 못했습니다.", tone: "warning" as const }];
      }
      return [
        { text: "탐색기로 공유폴더를 엽니다.", tone: "normal" as const },
        { text: PORTAL_FOLDER_HELPER_HINT_TEXT, tone: "muted" as const },
      ];
    });

  const handleCopyUncPath = () =>
    run(async () => {
      if (uncPath === null) return [];
      const copied = await copyText(uncPath).catch(() => false);
      return copied
        ? [{ text: PORTAL_FOLDER_UNC_COPIED_TEXT, tone: "normal" as const }]
        : [
            { text: PORTAL_FOLDER_UNC_COPY_BLOCKED_TEXT, tone: "warning" as const },
            { text: uncPath, tone: "muted" as const },
          ];
    });

  /**
   * [설치 명령 복사] — 견적서 화면과 **같은 흐름 · 같은 문장**을 그대로 쓴다
   * (runQuoteFolderHelperInstallCommandCopy). 🔴 설치 명령 본문은 어디에도 싣지 않는다 —
   * 사내 공유폴더 주소가 들어 있고 길이도 약 10,300자다.
   */
  const handleCopyInstallCommand = () =>
    run(async () => {
      const lines = await runQuoteFolderHelperInstallCommandCopy();
      return lines.map((line) => ({ text: line.text, tone: noticeToneOf(line.tone) }));
    });

  return (
    <section aria-label={`${formLabel} 엑셀 내보내기`} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={handlePreview}
          className="rounded-lg border border-zinc-300 px-4 py-2 text-xs font-semibold text-zinc-700 hover:border-zinc-900 hover:text-zinc-900 disabled:opacity-50"
        >
          엑셀 미리보기
        </button>
        <button
          type="button"
          disabled={pending || !canSave}
          onClick={handleSave}
          className="rounded-lg bg-primary-900 px-4 py-2 text-xs font-semibold text-white hover:bg-primary-800 disabled:opacity-50"
        >
          공유폴더에 저장
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={handleOpenFolder}
          className="rounded-lg border border-zinc-300 px-4 py-2 text-xs font-semibold text-zinc-700 hover:border-zinc-900 hover:text-zinc-900 disabled:opacity-50"
        >
          폴더 열기
        </button>
        {uncPath !== null ? (
          <button
            type="button"
            disabled={pending}
            onClick={handleCopyUncPath}
            className="rounded-lg border border-zinc-300 px-4 py-2 text-xs text-zinc-600 hover:border-zinc-900 hover:text-zinc-900 disabled:opacity-50"
          >
            위치 복사
          </button>
        ) : null}
        {offerHelperInstall ? (
          <button
            type="button"
            disabled={pending}
            onClick={handleCopyInstallCommand}
            title={PORTAL_FOLDER_HELPER_INSTALL_BUTTON_TITLE}
            data-portal-folder-helper-install-command=""
            className="rounded-lg border border-zinc-300 px-4 py-2 text-xs text-zinc-600 hover:border-zinc-900 hover:text-zinc-900 disabled:opacity-50"
          >
            설치 명령 복사
          </button>
        ) : null}
        {preview !== null ? (
          <button
            type="button"
            onClick={() => setPreview(null)}
            className="rounded-lg border border-zinc-300 px-4 py-2 text-xs text-zinc-600 hover:border-zinc-900 hover:text-zinc-900"
          >
            미리보기 닫기
          </button>
        ) : null}
      </div>

      {notices.length > 0 ? (
        <ul className="flex flex-col gap-1 text-xs">
          {notices.map((notice, index) => (
            <li key={index} className={NOTICE_CLASS[notice.tone]}>
              {notice.text}
            </li>
          ))}
        </ul>
      ) : null}

      {preview !== null ? <ExportPreviewSheet preview={preview} /> : null}
    </section>
  );
}

/**
 * 만들어진 통합문서의 그 탭을 **인쇄 모양 그대로** 그린다. 종이 셈(`planPaper`)과 칸
 * 그리기(`SheetPrintGridView`)는 보고서 · 수기 견적서 미리보기와 같은 조각이다.
 */
function ExportPreviewSheet({ preview }: { preview: CustomerFormExportPreview }) {
  const plan = planPaper(preview.grid);

  return (
    <div className="flex flex-col gap-2">
      <style>{previewStyles(plan.paperWidthMm, plan.paperHeightMm, preview.grid.widthPt * plan.scale)}</style>
      <p className="text-xs leading-relaxed text-zinc-500">
        저장될 파일의 <b>「{preview.sheetName}」 탭</b>을 인쇄 모양으로 그린 것입니다 — 칸의 글꼴 · 테마 색은 그리지
        않습니다. 정본은 공유폴더에 저장되는 엑셀입니다.
      </p>
      <PrintFitFrame naturalWidthPx={plan.paperWidthMm * PX_PER_MM} cssVariable="--cpx-fit" className="cpx-viewport">
        <div className="cpx-page">
          <SheetPrintGridView grid={preview.grid} scale={plan.scale} classPrefix="cpx" pictureSrc={() => ""} />
        </div>
      </PrintFitFrame>
    </div>
  );
}

/**
 * 미리보기 한 장의 CSS — 견적서 엑셀 미리보기(`qxp`)와 같은 틀이고 앞말만 `cpx` 다.
 * ⚠️ 이 글은 템플릿 리터럴 안이다 — 백틱을 쓰면 문자열이 거기서 끊긴다.
 * 🔴 인쇄 규칙을 두지 않는다. 이 화면은 인쇄하는 화면이 아니다(정본은 엑셀 파일이다).
 */
function previewStyles(paperWidthMm: number, paperHeightMm: number, sheetWidthPt: number): string {
  return `
.cpx-viewport { overflow-x: auto; }
.cpx-page {
  background: #fff; color: #000; box-shadow: 0 1px 3px rgba(0,0,0,.12), 0 8px 24px rgba(0,0,0,.08);
  width: ${paperWidthMm.toFixed(2)}mm; min-height: ${paperHeightMm.toFixed(2)}mm;
  padding: 6mm; margin: 0 auto; box-sizing: border-box; overflow: hidden;
  zoom: var(--cpx-fit, 1);
}
.cpx-sheet { position: relative; font-family: "Malgun Gothic", "맑은 고딕", "Apple SD Gothic Neo", sans-serif; color: #000; line-height: 1.15; }
.cpx-table { width: ${sheetWidthPt.toFixed(3)}pt; table-layout: fixed; border-collapse: collapse; }
.cpx-table td { padding: 0 1px; overflow: hidden; word-break: keep-all; }
.cpx-picture { position: absolute; object-fit: contain; }
`;
}
