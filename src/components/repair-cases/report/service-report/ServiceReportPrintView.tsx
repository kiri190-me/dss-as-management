"use client";

import Link from "next/link";

import PrintFitFrame from "@/components/common/print-fit-frame";
import type {
  PrintGridBorderStyle,
  PrintGridCell,
  SheetPrintGrid,
} from "@/lib/xlsx/sheet-print-grid";

/**
 * ============================================================================
 * 검사·수리 보고서 미리보기 — 브라우저의 「PDF로 저장」이 곧 내려받기다
 * ============================================================================
 * 🔴 **PDF 라이브러리를 쓰지 않는다. 서버에 변환 프로그램을 깔지 않는다.**
 * `window.print()` 와 `@media print` 로 만든다 — 견적서 미리보기가 이미 내린
 * 판단이고(`components/quotes/QuotePrintView.tsx`), 곧 NAS 로 옮길 예정이라
 * 서버에 짐을 더하지 않는다.
 *
 * ── 🔴 여기서 «그리는» 것은 하나도 없다 ─────────────────────────────────
 * 견적서 미리보기는 양식을 보고 HTML 로 손수 다시 그린 것이다. 이 화면은 그
 * 방식을 따르지 않는다 — **채우개가 만든 그 시트**를 표 자료로 읽어
 * (`lib/xlsx/sheet-print-grid.ts`) 그대로 옮긴다. 그래서 이 파일에는 보고서의
 * 문구도, 칸 주소도, 줄 수도 하나도 없다. 양식이 바뀌면 미리보기가 저절로
 * 따라가고, 미리보기와 내려받는 xlsx 가 어긋날 방법이 없다.
 *
 * 이 파일이 하는 일은 셋뿐이다: **자리를 pt 로 바꾸고, 종이에 맞추고, 인쇄할 때
 * 앱 껍데기를 감춘다.**
 *
 * ── 🔴 배율은 CSS transform 이 아니라 수치에 미리 곱한다 ────────────────
 * `transform: scale()` 은 인쇄에서 브라우저마다 다르게 처리돼 자리가 틀어진다
 * (견적서 미리보기가 같은 자리에서 같은 판단을 했다). 열 너비·행 높이·글꼴
 * 크기·그림 자리에 미리 곱해 둔다.
 *
 * ── 🔴 배율은 양식의 94% 를 쓰되, 넘치면 더 줄인다 ──────────────────────
 * 양식은 A4 세로 94% 다. 실측하면 그 배율에서 문서가 인쇄 영역을 **거의 정확히
 * 채운다**(184.7×292.4mm × 94% = 173.6×274.9mm, 여백을 뺀 자리는 176×274mm).
 * 세로가 0.9mm 넘친다 — Excel 은 이것을 한 장에 앉히지만 브라우저는 **한 장을
 * 더 뽑는다.** 그 둘째 장에는 마지막 한 줄의 윗부분만 실린 채 고객사로 나간다.
 *
 * 그래서 «양식의 배율»과 «넘치지 않을 배율» 중 작은 쪽을 쓴다. 대개는 양식의
 * 배율이 그대로 쓰이고, 이 양식처럼 빠듯할 때만 몇 % 더 줄어든다.
 * ============================================================================
 */

/**
 * 브라우저가 pt 를 픽셀로 반올림하면서 쌓이는 오차만큼의 여유.
 *
 * 행이 57개면 반올림이 한두 픽셀 쌓이고, 그 한두 픽셀이 「한 장이냐 두 장이냐」를
 * 가른다. 0.3% 는 A4 세로에서 0.8mm 다 — 눈으로는 안 보이고 종이는 한 장으로
 * 남는다.
 */
const PRINT_SAFETY = 0.997;

const MM_PER_POINT = 25.4 / 72;
const MM_PER_INCH = 25.4;

/** CSS 의 1in = 96px 이다. 종이 폭(mm)을 «화면에서 몇 픽셀인가»로 옮길 때 쓴다. */
const PX_PER_MM = 96 / 25.4;

/**
 * `<pageSetup paperSize>` → 종이 크기(mm, 세로 기준).
 *
 * 이 양식은 9(A4)다. 목록을 짧게 두는 것은 **모르는 종이를 지어내지 않기**
 * 위해서다 — 못 알아본 값은 A4 로 그리고, 그때 넘치면 위의 «넘치면 더 줄인다»가
 * 받아 준다.
 */
const PAPER_SIZES_MM: Record<number, { width: number; height: number }> = {
  8: { width: 297, height: 420 }, // A3
  9: { width: 210, height: 297 }, // A4
  11: { width: 148, height: 210 }, // A5
};

const DEFAULT_PAPER_SIZE = 9;

type PaperPlan = {
  paperWidthMm: number;
  paperHeightMm: number;
  marginsMm: { top: number; right: number; bottom: number; left: number };
  /** 양식의 배율과 «넘치지 않을 배율» 중 작은 쪽. */
  scale: number;
};

function planPaper(grid: SheetPrintGrid): PaperPlan {
  const paper = PAPER_SIZES_MM[grid.page.paperSize ?? DEFAULT_PAPER_SIZE] ?? PAPER_SIZES_MM[DEFAULT_PAPER_SIZE];
  const landscape = grid.page.orientation === "landscape";
  const paperWidthMm = landscape ? paper.height : paper.width;
  const paperHeightMm = landscape ? paper.width : paper.height;

  const marginsMm = {
    top: grid.page.margins.top * MM_PER_INCH,
    right: grid.page.margins.right * MM_PER_INCH,
    bottom: grid.page.margins.bottom * MM_PER_INCH,
    left: grid.page.margins.left * MM_PER_INCH,
  };

  const printableWidthMm = Math.max(paperWidthMm - marginsMm.left - marginsMm.right, 1);
  const printableHeightMm = Math.max(paperHeightMm - marginsMm.top - marginsMm.bottom, 1);
  const naturalWidthMm = grid.widthPt * MM_PER_POINT;
  const naturalHeightMm = grid.heightPt * MM_PER_POINT;

  const fitted = Math.min(
    grid.page.scale,
    naturalWidthMm > 0 ? printableWidthMm / naturalWidthMm : grid.page.scale,
    naturalHeightMm > 0 ? printableHeightMm / naturalHeightMm : grid.page.scale
  );

  return { paperWidthMm, paperHeightMm, marginsMm, scale: fitted * PRINT_SAFETY };
}

/**
 * OOXML 의 테두리 이름 → CSS.
 *
 * 못 알아본 이름은 **가는 실선**으로 그린다. 격자 서식에서 «있어야 할 선이 안
 * 보이는 것»이 «굵기가 조금 다른 것»보다 훨씬 나쁘다 — 앞은 문서가 표로 안
 * 보이고, 뒤는 아무도 눈치채지 못한다.
 */
function borderCss(style: PrintGridBorderStyle): string {
  if (style === null || style === "none") return "0";
  switch (style) {
    case "hair":
      return "0.5pt solid #000";
    case "medium":
    case "mediumDashed":
    case "mediumDashDot":
    case "mediumDashDotDot":
      return "1.5pt solid #000";
    case "thick":
      return "2.25pt solid #000";
    case "double":
      return "2.5pt double #000";
    case "dashed":
    case "dashDot":
    case "dashDotDot":
      return "0.75pt dashed #000";
    case "dotted":
      return "0.75pt dotted #000";
    default:
      return "0.75pt solid #000";
  }
}

/** Excel 의 세로 맞춤 이름은 `center` 인데 CSS 는 `middle` 이다. */
function verticalAlignCss(value: string | null): string {
  if (value === "top" || value === "bottom") return value;
  return "middle";
}

/**
 * Excel 의 가로 맞춤 이름 중 CSS 가 그대로 알아듣는 것만 넘긴다.
 *
 * `centerContinuous`(선택 영역 가운데)와 `distributed`(양쪽 균등)는 CSS 에 같은
 * 것이 없다. 흉내 내는 대신 **가운데**로 둔다 — 둘 다 «가운데로 보이는» 서식이라
 * 눈으로는 거의 같고, 잘못 흉내 낸 자리보다 낫다. `general` 은 «정하지 않음»
 * 이므로 브라우저에 맡긴다.
 */
function horizontalAlignCss(value: string | null): string | undefined {
  switch (value) {
    case "left":
    case "center":
    case "right":
    case "justify":
      return value;
    case "centerContinuous":
    case "distributed":
      return "center";
    default:
      return undefined;
  }
}

/** pt 값 하나 — 배율을 먹인 뒤 CSS 로. */
function pt(value: number, scale: number): string {
  return `${(value * scale).toFixed(3)}pt`;
}

export default function ServiceReportPrintView({
  grid,
  backHref,
  kindLabel,
  templateImageBase,
}: {
  /** 채워진 시트를 그대로 읽어 온 표 자료. 이 화면은 여기 담긴 것만 그린다. */
  grid: SheetPrintGrid;
  /** 돌아갈 자리 — 이 보고서를 고치는 화면. */
  backHref: string;
  /** 「수리보고서」·「검사보고서」. 화면 위 안내에만 쓴다 — 문서에는 양식의 제목이 이미 들어 있다. */
  kindLabel: string;
  /**
   * 양식 안의 그림을 꺼내 주는 라우트의 앞부분. 뒤에 그림 파일 이름이 붙는다.
   *
   * 🔴 주소를 이 파일에 적지 않고 **서버가 넘긴다** — 그림 라우트와 화면이 각자
   * 주소를 들고 있으면 폴더 이름을 바꾸는 날 한쪽만 고쳐지고, 그때 증상은 «도장만
   * 안 나오는 미리보기»라 아무 오류도 나지 않는다.
   */
  templateImageBase: string;
}) {
  const plan = planPaper(grid);
  const scale = plan.scale;
  const sheetWidthPt = grid.widthPt * scale;

  return (
    <div className="srp-root">
      <style>{styleSheet(plan, sheetWidthPt)}</style>

      <div className="srp-toolbar">
        <Link href={backHref} className="srp-btn">
          ← 보고서로 돌아가기
        </Link>
        <button
          type="button"
          // 🔴 `window.print()` 는 **사람이 누른 클릭 핸들러 안에서만** 부른다.
          //    effect 나 렌더 중에 부르면 화면이 뜨자마자 인쇄 창이 열리고,
          //    되돌아왔을 때 다시 열린다.
          onClick={() => window.print()}
          className="srp-btn srp-btn-primary"
        >
          인쇄 · PDF로 저장
        </button>
      </div>

      <p className="srp-note">
        저장된 {kindLabel}를 <b>양식 그대로</b> 그린 것입니다. 내려받는 Excel 파일과 같은 값이 같은
        자리에 들어갑니다. 고친 내용은 <b>저장한 뒤에</b> 여기에 반영됩니다.
        <br />
        인쇄 창에서 대상 <b>&ldquo;PDF로 저장&rdquo;</b>, 용지 <b>A4</b>, 배율{" "}
        <b>기본(100%)</b>, 여백 <b>기본</b>으로 두세요. 양식의 배율은 이미 반영되어 있으니 인쇄
        창에서 또 줄이지 마세요. 머리글·바닥글(주소·날짜)은 인쇄 창의{" "}
        <b>&ldquo;머리글 및 바닥글&rdquo;</b> 체크를 해제하면 사라집니다.
      </p>

      {/* 좁은 화면에서 종이를 폭에 맞춰 줄여 «보여 주는» 상자. 인쇄에는 닿지
          않는다 — `print-fit-frame.tsx` 머리말과 아래 `@media screen` 블록. */}
      <PrintFitFrame
        naturalWidthPx={plan.paperWidthMm * PX_PER_MM}
        cssVariable="--srp-fit"
        className="srp-viewport"
      >
        <div className="srp-page">
          <div className="srp-sheet" style={{ width: `${sheetWidthPt.toFixed(3)}pt` }}>
            <table className="srp-table">
              <colgroup>
                {grid.columnWidthsPt.map((width, index) => (
                  <col key={index} style={{ width: pt(width, scale) }} />
                ))}
              </colgroup>
              <tbody>
                {grid.rows.map((row) => (
                  <tr key={row.row} style={{ height: pt(row.heightPt, scale) }}>
                    {row.cells.map((cell) => (
                      <Cell key={`${cell.row}:${cell.column}`} cell={cell} scale={scale} />
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>

            {/* 양식 안에 박힌 도장. next/image 를 쓰지 않는다: 인쇄 화면이라 지연
                로딩이 오히려 방해가 되고(아직 안 뜬 그림이 빈칸으로 나간다),
                인증이 걸린 API 라우트에서 온다. 못 꺼내도 화면은 살아 있다. */}
            {grid.pictures.map((picture, index) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={`${picture.name}-${index}`}
                className="srp-picture"
                src={`${templateImageBase}${encodeURIComponent(picture.name)}`}
                alt=""
                style={{
                  left: pt(picture.leftPt, scale),
                  top: pt(picture.topPt, scale),
                  width: pt(picture.widthPt, scale),
                  height: pt(picture.heightPt, scale),
                }}
              />
            ))}
          </div>
        </div>
      </PrintFitFrame>
    </div>
  );
}

function Cell({ cell, scale }: { cell: PrintGridCell; scale: number }) {
  return (
    <td
      colSpan={cell.colSpan === 1 ? undefined : cell.colSpan}
      rowSpan={cell.rowSpan === 1 ? undefined : cell.rowSpan}
      style={{
        borderTop: borderCss(cell.borders.top),
        borderRight: borderCss(cell.borders.right),
        borderBottom: borderCss(cell.borders.bottom),
        borderLeft: borderCss(cell.borders.left),
        textAlign: horizontalAlignCss(cell.align) as React.CSSProperties["textAlign"],
        verticalAlign: verticalAlignCss(cell.verticalAlign),
        // 🔴 줄바꿈은 `wrapText` 를 따른다. 본문 줄은 채우개가 이미 칸 너비에
        //    맞춰 나눠 두었으므로(`domain/text-wrap.ts`) 여기서 또 나누면 안 된다
        //    — 그러면 미리보기만 한 줄이 더 생긴다.
        whiteSpace: cell.wrap ? "pre-wrap" : "pre",
        fontWeight: cell.bold ? 700 : undefined,
        fontSize: cell.fontSizePt === null ? undefined : pt(cell.fontSizePt, scale),
      }}
    >
      {cell.text}
    </td>
  );
}

/**
 * 이 화면의 CSS. **`@page` 의 여백까지 양식에서 온다** — 종이·여백·배율을 화면에
 * 적어 두면 양식을 고친 날 미리보기만 옛 설정으로 남는다.
 *
 * ⚠️ `globals.css` 에도 `@page` 가 있다(`margin: 15mm 12mm`). 이 `<style>` 이 문서
 * 뒤쪽에 오므로 같은 속성은 여기 것이 이긴다 — 견적서 미리보기가 이미 같은
 * 방식으로 자기 여백을 쓰고 있다.
 *
 * 앱 껍데기(사이드바·상단바·탭 줄)는 이미 각자 `print:hidden` 을 달고 있어서
 * 여기서 감추지 않는다(`globals.css` 의 '어떤 크롬도 직접 숨기지 않는다').
 */
function styleSheet(plan: PaperPlan, sheetWidthPt: number): string {
  const margins = `${plan.marginsMm.top.toFixed(2)}mm ${plan.marginsMm.right.toFixed(
    2
  )}mm ${plan.marginsMm.bottom.toFixed(2)}mm ${plan.marginsMm.left.toFixed(2)}mm`;

  return `
.srp-root { background: #fff; color: #000; }
.srp-toolbar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: .75rem; margin-bottom: .5rem; }
.srp-btn { border: 1px solid #d4d4d8; border-radius: .375rem; padding: .375rem .75rem; font-size: .875rem; text-decoration: none; color: #3f3f46; background: #fff; cursor: pointer; }
.srp-btn-primary { border-color: #18181b; background: #18181b; color: #fff; }
.srp-note { margin-bottom: 1rem; font-size: .75rem; line-height: 1.7; color: #71717a; }

/* 화면에서는 종이처럼 보인다 — 흰 바탕에 그림자, 양식의 여백만큼 안쪽 여백. */
.srp-page {
  background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,.12), 0 8px 24px rgba(0,0,0,.08);
  width: ${plan.paperWidthMm.toFixed(2)}mm; min-height: ${plan.paperHeightMm.toFixed(2)}mm;
  padding: ${margins}; margin: 0 auto; box-sizing: border-box; overflow: hidden;
}

.srp-sheet {
  position: relative;
  /* 🔴 가로 가운데. 양식의 printOptions horizontalCentered 가 그렇게 되어 있다. */
  margin: 0 auto;
  /* 양식의 본문 글꼴은 맑은 고딕이다(styles.xml). 없는 환경에서도 자간이 크게
     달라지지 않도록 같은 계열로 물려 둔다. */
  font-family: "Malgun Gothic", "맑은 고딕", "Apple SD Gothic Neo", "Noto Sans KR", sans-serif;
  color: #000;
  line-height: 1.15;
}

.srp-table { width: ${sheetWidthPt.toFixed(3)}pt; table-layout: fixed; border-collapse: collapse; }
.srp-table td { padding: 0 1px; overflow: visible; word-break: keep-all; }

.srp-picture { position: absolute; object-fit: contain; }

/* ── 좁은 화면: 종이를 폭에 맞춰 줄여 «보여 준다» ──────────────────────────
   🔴 이 블록은 통째로 @media screen 안에 있다 — 인쇄에는 규칙 자체가 적용되지
   않으므로 나가는 문서는 한 픽셀도 달라지지 않는다. 까닭과 원리는
   components/common/print-fit-frame.tsx 머리말에 있다.
   ⚠️ 이 글은 템플릿 리터럴 안이다 — 백틱을 쓰면 문자열이 거기서 끊긴다. */
@media screen {
  /* 스크롤 상자의 최소 너비는 0 이라, 210mm 짜리 종이가 앱 껍데기를 옆으로
     밀어내지 못한다. 배율이 1 로 남더라도 문서는 «이 상자 안에서만» 밀린다. */
  .srp-viewport { overflow-x: auto; }
  /* 배율은 상자가 재어 변수로 내려 준다. 다 들어가는 화면에서는 1 이다. */
  .srp-page { zoom: var(--srp-fit, 1); }
}

@media print {
  @page { size: ${plan.paperWidthMm.toFixed(2)}mm ${plan.paperHeightMm.toFixed(2)}mm; margin: ${margins}; }
  .srp-toolbar, .srp-note { display: none !important; }
  .srp-page { box-shadow: none; padding: 0; margin: 0; width: auto; min-height: 0; overflow: visible; }
  /* 한 장으로 앉힌다 — 위 '넘치면 더 줄인다' 가 크기를 이미 맞춰 두었다. */
  .srp-sheet { break-inside: avoid; page-break-inside: avoid; }
}
`;
}
