"use client";

import { useEffect } from "react";

import PrintFitFrame from "@/components/common/print-fit-frame";
import { PX_PER_MM, SheetPrintGridView, planPaper } from "@/components/print-grid/SheetPrintGridView";
import type { SheetPrintGrid } from "@/lib/xlsx/sheet-print-grid";

import { serviceReportPaperStyleSheet } from "./ServiceReportPrintView";

/**
 * ============================================================================
 * 🔴 **저장하지 않은 보고서**를 문서 전체로 보여 주는 창 (2026-10-19)
 * ============================================================================
 * 사용자 요구: 「보고서 수정하고서 저장을 누르지 않은 채 저장 옆에 있는 미리보기를
 * 눌렀을 때에 수정한 내용이 반영되도록 해줘.」
 *
 * 격자는 **서버가 그때 만들어 준다**(`POST …/service-report/preview-grid`). 화면이
 * 하는 일은 받은 격자를 종이 모양으로 그리는 것뿐이고, 그리는 코드도 CSS 도 저장된
 * 장의 미리보기 화면과 **같은 것**이다(`ServiceReportPrintView` 의
 * `serviceReportPaperStyleSheet` · 공용 `SheetPrintGridView`). 베끼면 두 미리보기가
 * 같은 문서를 다르게 보여 주는 날이 온다.
 *
 * ── 🔴 옆의 **본문 미리보기**와 역할이 다르다 ──────────────────────────
 * 작성 화면 오른쪽에는 이미 실시간 미리보기가 있다(`ServiceReportBodyPreview` —
 * 머리에 「문서에서 이렇게 나옵니다」라고 적혀 있다). 그쪽은 **본문 세 구역이 어디서
 * 줄바꿈되는지**를 타자와 함께 보여 주고 서버를 부르지 않는다. 이 창은 **머리 항목 ·
 * 처리 · 원인 체크 · 비고 · 도장까지 든 문서 한 장 전체**이고, 사람이 **눌렀을
 * 때만** 서버가 양식을 채워 만든다(채우고 zip 을 다시 여는 일은 가볍지 않다).
 * 그래서 단추 이름도 「전체 미리보기」로 갈라 두었다.
 *
 * ── 🔴 저장하지 않았다는 것을 머리에 적는다 ─────────────────────────────
 * 이 창에 보이는 것은 **DB 에 없는 문서**다. 그 사실을 적어 두지 않으면 사람이
 * 「미리보기에서 봤으니 저장됐겠지」로 읽는다 — 이 조각이 막으려는 바로 그 오해다.
 *
 * ── 🔴 인쇄 단추를 두지 않는다 ──────────────────────────────────────────
 * `window.print()` 를 여기서 부르면 **뒤에 깔린 작성 화면까지** 함께 인쇄된다(저장된
 * 장의 미리보기 화면은 그 화면 하나뿐이라 괜찮았다). 게다가 저장하지 않은 문서를
 * 종이·PDF 로 뽑으면 그것이 결과물로 믿긴다. 인쇄 · PDF 는 저장한 뒤 [저장본 인쇄 ·
 * PDF]에서 하고, 머리글이 그 길을 말한다.
 *
 * ── Esc 로 닫힌다 ───────────────────────────────────────────────────────
 * 문서를 덮는 창이라 「닫기」가 어디 있는지 몰라 갇히면 안 된다. 바깥을 눌러도
 * 닫히게 하지는 **않는다** — 문서를 훑다가 종이 밖을 짚는 일이 잦고, 그때 창이
 * 사라지면 다시 서버를 부르게 된다.
 * ============================================================================
 */

export default function ServiceReportDocumentPreviewDialog({
  grid,
  kindLabel,
  templateImageBase,
  onClose,
}: {
  /** 서버가 **지금 화면의 값으로** 채워 읽어 온 표 자료. 이 창은 여기 담긴 것만 그린다. */
  grid: SheetPrintGrid;
  /** 「수리보고서」·「검사보고서」. 머리글에만 쓴다 — 문서에는 양식의 제목이 이미 들어 있다. */
  kindLabel: string;
  /**
   * 양식 안의 그림(도장)을 꺼내 주는 라우트의 앞부분. 🔴 **격자를 뽑아낸 그 양식**을
   * 가리킨다 — 서버가 정해 넘긴다(`lib/server/service-report-preview-grid.ts`).
   */
  templateImageBase: string;
  onClose: () => void;
}) {
  // Esc 로 닫는다. 🔴 창이 떠 있는 동안만 듣는다 — 떼지 않으면 닫힌 뒤에도 남는다.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const plan = planPaper(grid);
  const sheetWidthPt = grid.widthPt * plan.scale;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${kindLabel} 전체 미리보기 — 저장하지 않은 내용`}
      className="fixed inset-0 z-50 flex flex-col bg-zinc-900/80"
    >
      {/* 종이와 같은 CSS. 🔴 저장된 장의 미리보기 화면이 쓰는 그것이다. */}
      <style>{serviceReportPaperStyleSheet(plan, sheetWidthPt)}</style>

      <div className="flex shrink-0 items-start justify-between gap-3 bg-zinc-900 px-4 py-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-white">
            {kindLabel} 전체 미리보기 — 아직 저장하지 않은 내용입니다
          </p>
          <p className="mt-0.5 text-xs text-white/70">
            지금 화면에 적혀 있는 값 그대로 양식에 채워 그린 것입니다. 이 창을 열어도{" "}
            <b>저장되지 않습니다</b> — 남기려면 창을 닫고 [저장]을 눌러 주세요. 인쇄 · PDF로
            저장은 저장한 뒤 [저장본 인쇄 · PDF]에서 할 수 있습니다.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded-md border border-white/30 px-3 py-1.5 text-sm font-medium text-white hover:bg-white/10"
        >
          닫기
        </button>
      </div>

      {/* 종이 — 세로로 넘치면 이 칸이 스크롤한다. 가로는 PrintFitFrame 이 맞춘다. */}
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <PrintFitFrame
          naturalWidthPx={plan.paperWidthMm * PX_PER_MM}
          cssVariable="--srp-fit"
          className="srp-viewport"
        >
          <div className="srp-page">
            <SheetPrintGridView
              grid={grid}
              scale={plan.scale}
              classPrefix="srp"
              pictureSrc={(picture) => `${templateImageBase}${encodeURIComponent(picture.name)}`}
            />
          </div>
        </PrintFitFrame>
      </div>
    </div>
  );
}
