import type { CSSProperties } from "react";

import type {
  PrintGridBorderStyle,
  PrintGridCell,
  PrintGridPicture,
  PrintGridValueKind,
  SheetPrintGrid,
} from "@/lib/xlsx/sheet-print-grid";

/**
 * ============================================================================
 * 시트 인쇄 격자를 그리는 조각 — 보고서 미리보기와 엑셀 전용 견적서 미리보기가 함께 쓴다
 * ============================================================================
 * `lib/xlsx/sheet-print-grid.ts` 가 읽어 낸 표 자료(칸 · 병합 · 테두리 · 그림 자리 ·
 * 인쇄 설정)를 **pt 단위의 표**로 옮기고, 종이에 맞출 배율을 셈한다.
 *
 * ── 🔴 보고서 화면에서 떼어 온 것이다 (2026-09-16, 견적서 ②b) ────────────────
 * 이 파일의 코드는 원래 `ServiceReportPrintView.tsx` 안에 붙박이로 있었다(칸 그리기 ·
 * 테두리 이름 → CSS · 종이 셈). 엑셀 전용 견적서의 미리보기가 **붙인 수기 엑셀을 인쇄
 * 모양으로** 그리게 되면서 같은 그리기가 필요해졌고, 두 벌로 두면 언젠가 한쪽만
 * 고쳐진다. 그래서 떼어 냈다.
 *
 *   · 🔴 **옮기기만 했다.** 보고서 미리보기의 렌더 HTML 은 떼기 전과 한 글자도 같다 —
 *     `SheetPrintGridView.test.tsx` 가 떼기 전 모습을 얼려 둔 사본과 견준다. 판단의
 *     근거(배율 94% · 넘치면 줄이기 · 모르는 테두리는 가는 실선 …)도 그대로 옮겼다.
 *   · 새로 그리는 것은 둘뿐이다 — 칸의 **글자 색**(`fontColor`)과 **배경**
 *     (`backgroundColor`). 둘 다 null 이면 style 에 아무것도 싣지 않는다. 보고서 양식의
 *     격자는 둘 다 늘 null 이라(실측: 수리 · 검사 양식 각 415칸 전부) 보고서 화면은
 *     달라지지 않는다.
 *   · 클래스 이름은 쓰는 쪽이 앞말(`classPrefix`)로 정한다 — 보고서는 `srp`(→ `srp-sheet`
 *     · `srp-table` · `srp-picture`), 견적서는 `qxp`. 각 화면의 CSS 가 그 이름을 읽는다.
 *   · 그림 주소는 쓰는 쪽이 정한다(`pictureSrc`) — 보고서는 인가가 걸린 그림 라우트,
 *     견적서는 통로가 실어 준 data URI 다.
 *
 * ── 🔴 배율은 CSS transform 이 아니라 수치에 미리 곱한다 ────────────────
 * `transform: scale()` 은 인쇄에서 브라우저마다 다르게 처리돼 자리가 틀어진다
 * (견적서 미리보기가 같은 자리에서 같은 판단을 했다). 열 너비·행 높이·글꼴
 * 크기·그림 자리에 미리 곱해 둔다.
 *
 * ── 🔴 배율은 양식의 배율을 쓰되, 넘치면 더 줄인다 ──────────────────────
 * 보고서 양식은 A4 세로 94% 다. 실측하면 그 배율에서 문서가 인쇄 영역을 **거의 정확히
 * 채운다**(184.7×292.4mm × 94% = 173.6×274.9mm, 여백을 뺀 자리는 176×274mm).
 * 세로가 0.9mm 넘친다 — Excel 은 이것을 한 장에 앉히지만 브라우저는 **한 장을
 * 더 뽑는다.** 그 둘째 장에는 마지막 한 줄의 윗부분만 실린 채 고객사로 나간다.
 *
 * 그래서 «양식의 배율»과 «넘치지 않을 배율» 중 작은 쪽을 쓴다. 대개는 양식의
 * 배율이 그대로 쓰이고, 빠듯할 때만 몇 % 더 줄어든다.
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
export const PX_PER_MM = 96 / 25.4;

/**
 * `<pageSetup paperSize>` → 종이 크기(mm, 세로 기준).
 *
 * 보고서 양식은 9(A4)다. 목록을 짧게 두는 것은 **모르는 종이를 지어내지 않기**
 * 위해서다 — 못 알아본 값은 A4 로 그리고, 그때 넘치면 위의 «넘치면 더 줄인다»가
 * 받아 준다.
 */
const PAPER_SIZES_MM: Record<number, { width: number; height: number }> = {
  8: { width: 297, height: 420 }, // A3
  9: { width: 210, height: 297 }, // A4
  11: { width: 148, height: 210 }, // A5
};

const DEFAULT_PAPER_SIZE = 9;

export type PaperPlan = {
  paperWidthMm: number;
  paperHeightMm: number;
  marginsMm: { top: number; right: number; bottom: number; left: number };
  /** 양식의 배율과 «넘치지 않을 배율» 중 작은 쪽. */
  scale: number;
};

/** 종이 · 여백 · 배율 — 전부 격자가 읽어 온 `page`(양식의 인쇄 설정)에서 온다. */
export function planPaper(grid: Pick<SheetPrintGrid, "page" | "widthPt" | "heightPt">): PaperPlan {
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
 * 눈으로는 거의 같고, 잘못 흉내 낸 자리보다 낫다.
 *
 * ── 「일반」(정하지 않음) — 값의 종류로 (2026-09-16, 견적서 ②b 재작업) ──────────
 * 맞춤을 안 적은 칸(`null` · `general`)은 Excel 이 **값의 종류로** 맞춘다: 수 · 날짜는 오른쪽,
 * 참/거짓 · 오류는 가운데, 글자는 왼쪽. 글자(왼쪽)는 브라우저 기본이라 싣지 않는다 — 그래서
 * 글자 칸 · 빈 칸의 마크업은 예전 그대로다. 🔴 보고서 격자는 이 갈래에 드는 칸이 없다(숫자 칸이
 * 전부 `@` 서식이고 날짜 칸은 맞춤을 적어 두었다 — 실측, SheetPrintGridView.test.tsx).
 */
function horizontalAlignCss(value: string | null, valueKind: PrintGridValueKind | null): string | undefined {
  switch (value) {
    case "left":
    case "center":
    case "right":
    case "justify":
      return value;
    case "centerContinuous":
    case "distributed":
      return "center";
    case null:
    case "general":
      if (valueKind === "number") return "right";
      if (valueKind === "boolean" || valueKind === "error") return "center";
      return undefined;
    default:
      return undefined;
  }
}

/** pt 값 하나 — 배율을 먹인 뒤 CSS 로. */
function pt(value: number, scale: number): string {
  return `${(value * scale).toFixed(3)}pt`;
}

/**
 * 그릴 격자. 그림은 쓰는 쪽의 모양(`P`)을 그대로 받는다 — 견적서는 그림마다 data URI 를
 * 달고 오고, 보고서는 이름만 있다.
 */
export type SheetPrintGridViewGrid<P extends PrintGridPicture> = Pick<
  SheetPrintGrid,
  "columnWidthsPt" | "rows" | "widthPt"
> & { pictures: readonly P[] };

/**
 * 격자 한 장 — `<div {앞말}-sheet>` 안에 표와 그림. 종이 · 여백 · 인쇄 CSS 는 쓰는 쪽이
 * 둘러싼다(각 화면의 `@page` 와 도구모음이 서로 다르다).
 */
export function SheetPrintGridView<P extends PrintGridPicture>({
  grid,
  scale,
  classPrefix,
  pictureSrc,
}: {
  grid: SheetPrintGridViewGrid<P>;
  /** `planPaper(grid).scale` — 열 너비·행 높이·글꼴·그림 자리에 미리 곱한다. */
  scale: number;
  /** 클래스 이름의 앞말. `srp` → `srp-sheet` · `srp-table` · `srp-picture`. */
  classPrefix: string;
  /** 그림 한 장의 주소. */
  pictureSrc: (picture: P) => string;
}) {
  const sheetWidthPt = grid.widthPt * scale;

  return (
    <div className={`${classPrefix}-sheet`} style={{ width: `${sheetWidthPt.toFixed(3)}pt` }}>
      <table className={`${classPrefix}-table`}>
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

      {/* 양식 안에 박힌 그림(도장 · 로고). next/image 를 쓰지 않는다: 인쇄 화면이라 지연
          로딩이 오히려 방해가 되고(아직 안 뜬 그림이 빈칸으로 나간다), 인증이 걸린 API
          라우트나 data URI 에서 온다. 못 꺼내도 화면은 살아 있다. */}
      {grid.pictures.map((picture, index) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={`${picture.name}-${index}`}
          className={`${classPrefix}-picture`}
          src={pictureSrc(picture)}
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
        textAlign: horizontalAlignCss(cell.align, cell.valueKind) as CSSProperties["textAlign"],
        verticalAlign: verticalAlignCss(cell.verticalAlign),
        // 🔴 줄바꿈은 `wrapText` 를 따른다. 보고서 본문 줄은 채우개가 이미 칸 너비에
        //    맞춰 나눠 두었으므로(`domain/text-wrap.ts`) 여기서 또 나누면 안 된다
        //    — 그러면 미리보기만 한 줄이 더 생긴다.
        //    칸 글자의 앞뒤 공백도 그대로 둔다. 회계 서식의 `_x`(한 칸)가 만든 것이고
        //    (「₩3,500,000 」) Excel 도 인쇄에서 같은 자리를 비운다. `*x` 채움은
        //    읽을 때 이미 빠져서(number-format.ts) 공백이 한 칸을 넘지 않는다.
        whiteSpace: cell.wrap ? "pre-wrap" : "pre",
        fontWeight: cell.bold ? 700 : undefined,
        fontSize: cell.fontSizePt === null ? undefined : pt(cell.fontSizePt, scale),
        // 2026-09-16(견적서 ②b)에 더했다. null 이면 아무것도 싣지 않는다 — 보고서 격자는
        // 늘 null 이라 보고서 화면의 마크업이 달라지지 않는다(머리말).
        color: cell.fontColor ?? undefined,
        backgroundColor: cell.backgroundColor ?? undefined,
      }}
    >
      {cell.text}
    </td>
  );
}
