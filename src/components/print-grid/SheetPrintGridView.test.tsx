import { describe, test } from "node:test";
import assert from "node:assert/strict";
import type { CSSProperties } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Link from "next/link";

import PrintFitFrame from "@/components/common/print-fit-frame";
import ServiceReportPrintView from "@/components/repair-cases/report/service-report/ServiceReportPrintView";
import {
  buildSheetPrintGrid,
  type PrintGridBorderStyle,
  type PrintGridCell,
  type PrintGridPicture,
  type SheetPrintGrid,
} from "@/lib/xlsx/sheet-print-grid";
import { SheetPrintGridView, planPaper } from "./SheetPrintGridView";

/**
 * ============================================================================
 * 🔴 보고서 미리보기 불변 — 격자 그리기를 공용 조각으로 떼기 전과 렌더 HTML 이 같다 (견적서 ②b)
 * ============================================================================
 * 검사·수리 보고서 미리보기(ServiceReportPrintView)는 **실사용 중**이다. 그 안에 붙박이로 있던
 * 격자 그리기(칸 · 테두리 · 그림 · 종이 셈)를 `SheetPrintGridView.tsx` 로 떼어 엑셀 전용 견적서
 * 미리보기와 나눠 쓰게 했다. 이 파일은 떼기 **전**(커밋 261972f)의 ServiceReportPrintView 를
 * 아래 `LegacyServiceReportPrintView` 로 **글자 그대로 얼려 두고**, 지금의 화면과 같은 격자를
 * 그려 마크업이 한 글자도 다르지 않은지 견준다.
 *
 * 격자는 갈래를 두루 짚도록 지어낸다 — 테두리 이름 전부(모르는 이름 포함) · 가로세로 맞춤 전부 ·
 * 병합 · 줄바꿈 · 굵게 · 글꼴 크기 유무 · 숨긴 열(너비 0) · 그림(이름에 공백 · 같은 그림 두 번) ·
 * 종이(A4 · A3 가로 · A5 · 모르는 번호 · 없음) · 배율(넘치면 줄이기) · 빈 격자. 그리고
 * `buildSheetPrintGrid` 로 읽은 격자(strict 판 테두리 이름 · 후리가나 · 이름 있는 서식)도.
 *
 * ⚠️ 실제 보고서 양식(직인이 든 파일)은 이 목록(components)에서 열 수 없다(환경변수가 없다).
 * 실제 수리 · 검사 양식을 채운 격자로도 떼기 전후를 견줘 같음을 확인했다(작업 보고 참고).
 * ============================================================================
 */

// ─────────────────────────────── 떼기 전(261972f)의 ServiceReportPrintView — 얼린 사본
// 🔴 고치지 말 것. 이 사본이 곧 «떼기 전»의 정의다. `React.CSSProperties` 를 이름 있는
// 가져오기(`CSSProperties`)로 바꾼 것 말고는 원본 그대로다(타입은 마크업에 닿지 않는다).

const PRINT_SAFETY = 0.997;

const MM_PER_POINT = 25.4 / 72;
const MM_PER_INCH = 25.4;

const PX_PER_MM = 96 / 25.4;

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
  scale: number;
};

function legacyPlanPaper(grid: SheetPrintGrid): PaperPlan {
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

function verticalAlignCss(value: string | null): string {
  if (value === "top" || value === "bottom") return value;
  return "middle";
}

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

function pt(value: number, scale: number): string {
  return `${(value * scale).toFixed(3)}pt`;
}

function LegacyServiceReportPrintView({
  grid,
  backHref,
  kindLabel,
  templateImageBase,
}: {
  grid: SheetPrintGrid;
  backHref: string;
  kindLabel: string;
  templateImageBase: string;
}) {
  const plan = legacyPlanPaper(grid);
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
                      <LegacyCell key={`${cell.row}:${cell.column}`} cell={cell} scale={scale} />
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>

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

function LegacyCell({ cell, scale }: { cell: PrintGridCell; scale: number }) {
  return (
    <td
      colSpan={cell.colSpan === 1 ? undefined : cell.colSpan}
      rowSpan={cell.rowSpan === 1 ? undefined : cell.rowSpan}
      style={{
        borderTop: borderCss(cell.borders.top),
        borderRight: borderCss(cell.borders.right),
        borderBottom: borderCss(cell.borders.bottom),
        borderLeft: borderCss(cell.borders.left),
        textAlign: horizontalAlignCss(cell.align) as CSSProperties["textAlign"],
        verticalAlign: verticalAlignCss(cell.verticalAlign),
        whiteSpace: cell.wrap ? "pre-wrap" : "pre",
        fontWeight: cell.bold ? 700 : undefined,
        fontSize: cell.fontSizePt === null ? undefined : pt(cell.fontSizePt, scale),
      }}
    >
      {cell.text}
    </td>
  );
}

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

// ─────────────────────────────── 견줄 격자들

function cell(row: number, column: number, overrides: Partial<PrintGridCell> = {}): PrintGridCell {
  return {
    row,
    column,
    colSpan: 1,
    rowSpan: 1,
    text: "",
    align: null,
    verticalAlign: null,
    wrap: false,
    bold: false,
    fontSizePt: null,
    borders: { top: null, right: null, bottom: null, left: null },
    fontColor: null,
    backgroundColor: null,
    valueKind: null,
    ...overrides,
  };
}

const BORDER_NAMES: PrintGridBorderStyle[] = [
  null,
  "none",
  "hair",
  "thin",
  "medium",
  "mediumDashed",
  "mediumDashDot",
  "mediumDashDotDot",
  "thick",
  "double",
  "dashed",
  "dashDot",
  "dashDotDot",
  "dotted",
  "slantDashDot",
  "모르는이름",
];
const ALIGNS = [null, "left", "center", "right", "justify", "centerContinuous", "distributed", "general", "fill"];
const VERTICALS = [null, "top", "center", "bottom", "justify"];

/** 테두리 · 맞춤 · 병합 · 글꼴 갈래를 두루 짚는 지어낸 격자. 색은 보고서 격자처럼 늘 null. */
function syntheticGrid(page: Partial<SheetPrintGrid["page"]> = {}, pictures?: PrintGridPicture[]): SheetPrintGrid {
  const rows: SheetPrintGrid["rows"] = [];
  for (let r = 1; r <= 8; r += 1) {
    const cells: PrintGridCell[] = [];
    for (let c = 1; c <= 6; c += 1) {
      const i = r * 7 + c;
      if (r === 2 && c === 2) {
        cells.push(
          cell(r, c, {
            colSpan: 2,
            rowSpan: 2,
            text: "병합 칸\n둘째 줄",
            wrap: true,
            bold: true,
            fontSizePt: 14,
            align: "center",
            verticalAlign: "center",
            borders: { top: "double", right: "medium", bottom: "thin", left: "hair" },
          })
        );
        continue;
      }
      if ((r === 2 || r === 3) && c === 3) continue;
      if (r === 3 && c === 2) continue;
      cells.push(
        cell(r, c, {
          text: i % 3 === 0 ? "" : ` 칸 ${r}-${c} ₩3,500,000 <&"> `,
          align: ALIGNS[i % ALIGNS.length],
          verticalAlign: VERTICALS[i % VERTICALS.length],
          wrap: i % 2 === 0,
          bold: i % 5 === 0,
          fontSizePt: i % 4 === 0 ? null : 8 + (i % 6),
          borders: {
            top: BORDER_NAMES[i % BORDER_NAMES.length],
            right: BORDER_NAMES[(i + 3) % BORDER_NAMES.length],
            bottom: BORDER_NAMES[(i + 7) % BORDER_NAMES.length],
            left: BORDER_NAMES[(i + 11) % BORDER_NAMES.length],
          },
        })
      );
    }
    rows.push({ row: r, heightPt: 12 + r, cells });
  }
  const columnWidthsPt = [30, 45.5, 60.25, 12, 0, 80];
  return {
    firstRow: 1,
    lastRow: 8,
    firstColumn: 1,
    lastColumn: 6,
    columnWidthsPt,
    widthPt: columnWidthsPt.reduce((sum, width) => sum + width, 0),
    heightPt: rows.reduce((sum, row) => sum + row.heightPt, 0),
    rows,
    pictures: pictures ?? [
      { name: "image3.png", leftPt: 10.5, topPt: 20.25, widthPt: 40, heightPt: 38 },
      { name: "이름 공백 (1)#?.jpeg", leftPt: 0, topPt: 0, widthPt: 0, heightPt: 0 },
      { name: "image3.png", leftPt: 100, topPt: 50, widthPt: 10, heightPt: 10 },
    ],
    page: {
      paperSize: 9,
      scale: 0.94,
      orientation: "portrait",
      margins: { left: 0.787, right: 0.551, top: 0.512, bottom: 0.394 },
      horizontallyCentered: true,
      verticallyCentered: true,
      ...page,
    },
  };
}

/** `buildSheetPrintGrid` 가 읽은 격자 — strict 판 테두리 이름(start/end) · 후리가나 · 이름 있는 서식. */
function builtGrid(): SheetPrintGrid {
  const sheetName = "시험 시트";
  return buildSheetPrintGrid({
    sheetName,
    workbookXml:
      '<?xml version="1.0"?><workbook>' +
      `<sheets><sheet name="${sheetName}" sheetId="1" r:id="rId1"/></sheets>` +
      `<definedNames><definedName name="_xlnm.Print_Area" localSheetId="0">'${sheetName}'!$B$2:$D$4</definedName></definedNames>` +
      "</workbook>",
    sheetXml:
      '<?xml version="1.0"?><worksheet>' +
      '<sheetFormatPr defaultRowHeight="12"/>' +
      '<cols><col min="1" max="4" width="10" customWidth="1"/><col min="5" max="5" width="10" hidden="1" customWidth="1"/></cols>' +
      "<sheetData>" +
      '<row r="2" ht="20" customHeight="1"><c r="B2" s="1" t="s"><v>0</v></c><c r="D2" s="2"/></row>' +
      '<row r="3"><c r="D3" s="0" t="inlineStr"><is><t>가운데</t></is></c></row>' +
      '<row r="4"><c r="B4" s="0" t="d"><v>2026-09-02</v></c></row>' +
      "</sheetData>" +
      '<mergeCells count="3"><mergeCell ref="B2:C3"/><mergeCell ref="A1:A2"/><mergeCell ref="A4:C4"/></mergeCells>' +
      '<printOptions horizontalCentered="1"/>' +
      '<pageMargins left="1" right="1" top="1" bottom="1"/>' +
      '<pageSetup paperSize="9" scale="80" orientation="portrait"/>' +
      "</worksheet>",
    sharedStringsXml:
      '<?xml version="1.0"?><sst count="1" uniqueCount="1">' +
      '<si><t>비　고</t><rPh sb="0" eb="1"><t>ソナエ</t></rPh><phoneticPr fontId="1"/></si>' +
      "</sst>",
    stylesXml:
      '<?xml version="1.0"?><styleSheet>' +
      '<fonts count="2"><font><sz val="9"/><name val="맑은 고딕"/></font>' +
      '<font><b/><sz val="14"/><name val="맑은 고딕"/></font></fonts>' +
      '<borders count="3">' +
      "<border><start/><end/><top/><bottom/><diagonal/></border>" +
      '<border><start style="thin"><color indexed="64"/></start><end/>' +
      '<top style="double"><color indexed="64"/></top><bottom/><diagonal/></border>' +
      '<border><start/><end style="medium"><color indexed="64"/></end><top/>' +
      '<bottom style="thin"><color indexed="64"/></bottom><diagonal/></border>' +
      "</borders>" +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" borderId="0"><alignment vertical="center"/></xf></cellStyleXfs>' +
      '<cellXfs count="3">' +
      '<xf numFmtId="0" fontId="0" borderId="0" xfId="0"/>' +
      '<xf numFmtId="0" fontId="1" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" wrapText="1"/></xf>' +
      '<xf numFmtId="0" fontId="0" borderId="2" xfId="0"/>' +
      "</cellXfs></styleSheet>",
    drawingXml: null,
    drawingRelsXml: null,
  });
}

const GRIDS: Record<string, SheetPrintGrid> = {
  "A4 세로 94%(보고서 양식의 설정)": syntheticGrid(),
  "A3 가로 100%": syntheticGrid({ paperSize: 8, orientation: "landscape", scale: 1 }),
  "모르는 종이 · 배율 200% · 여백 0": syntheticGrid({
    paperSize: 99,
    scale: 2,
    margins: { left: 0, right: 0, top: 0, bottom: 0 },
  }),
  "종이 번호 없음": syntheticGrid({ paperSize: null }),
  "A5 가로 · 그림 없음": syntheticGrid({ paperSize: 11, orientation: "landscape" }, []),
  "넘쳐서 줄이는 격자": { ...syntheticGrid(), heightPt: 5000 },
  "빈 격자": { ...syntheticGrid(), rows: [], columnWidthsPt: [], widthPt: 0, heightPt: 0, pictures: [] },
};

function renderBoth(grid: SheetPrintGrid, templateImageBase = "/api/service-reports/template-image/") {
  const props = {
    grid,
    backHref: "/repair-cases/r-1/report/service-report?id=s-1",
    kindLabel: "수리보고서",
    templateImageBase,
  };
  return {
    now: renderToStaticMarkup(<ServiceReportPrintView {...props} />),
    before: renderToStaticMarkup(<LegacyServiceReportPrintView {...props} />),
  };
}

describe("🔴 보고서 미리보기 — 떼기 전과 렌더 HTML 이 한 글자도 같다", () => {
  for (const [name, grid] of Object.entries(GRIDS)) {
    test(name, () => {
      const { now, before } = renderBoth(grid);
      assert.ok(before.includes("srp-table") || grid.rows.length === 0, "견줄 사본이 격자를 안 그렸다");
      assert.equal(now, before);
    });
  }

  /**
   * `buildSheetPrintGrid` 로 읽은 격자에는 맞춤을 안 적은 ISO 날짜 칸(B4)이 있다. 2026-09-16(견적서 ②b
   * 재작업)부터 그런 칸은 Excel 의 「일반」 맞춤대로 오른쪽이다 — 🔴 **다른 것은 그 한 곳뿐**이어야
   * 한다. 실제 보고서 양식의 날짜 칸은 맞춤을 적어 두어 이 갈래에 들지 않는다(sheet-print-grid.test.ts
   * 의 보고서 불변 시험이 수리 · 검사 양식의 모든 칸에서 확인한다).
   */
  test("buildSheetPrintGrid 로 읽은 격자 — 맞춤 없는 날짜 칸의 오른쪽 맞춤 한 곳 말고는 같다", () => {
    const grid = builtGrid();
    const general = grid.rows
      .flatMap((row) => row.cells)
      .filter((one) => (one.align === null || one.align === "general") && one.valueKind === "number");
    assert.deepEqual(
      general.map((one) => [one.row, one.column, one.text]),
      [[4, 2, "2026년 9월 2일 수요일"]]
    );

    const { now, before } = renderBoth(grid);
    assert.equal(now.split("text-align:right").length - 1, 1, now);
    assert.equal(now.replace(";text-align:right", ""), before);
  });

  test("🔴 떼기 전과 견준 격자들은 「일반」 맞춤의 수 칸이 없다 — 보고서 격자와 같은 성질", () => {
    for (const [name, grid] of Object.entries(GRIDS)) {
      for (const one of grid.rows.flatMap((row) => row.cells)) {
        assert.ok(
          !((one.align === null || one.align === "general") && one.valueKind !== null && one.valueKind !== "text"),
          `${name} ${one.row}:${one.column}`
        );
      }
    }
  });

  test("그림 주소의 앞부분을 바꿔도 같다 — 주소는 서버가 넘긴 그대로, 이름은 인코딩", () => {
    const { now, before } = renderBoth(syntheticGrid(), "/다른/주소/");
    assert.equal(now, before);
    assert.ok(now.includes(`src="/다른/주소/${encodeURIComponent("이름 공백 (1)#?.jpeg")}"`), now);
  });

  test("종이 셈(planPaper)도 떼기 전과 같다", () => {
    for (const grid of Object.values(GRIDS)) {
      assert.deepEqual(planPaper(grid), legacyPlanPaper(grid));
    }
  });
});

describe("🔴 「일반」 가로 맞춤 — 맞춤을 안 적은 칸은 값의 종류로(2026-09-16, 견적서 ②b 재작업)", () => {
  const cases: { name: string; align: string | null; valueKind: PrintGridCell["valueKind"]; expected: string | null }[] = [
    { name: "수 · 날짜는 오른쪽", align: null, valueKind: "number", expected: "right" },
    { name: "`general` 이라 적혀 있어도 같다", align: "general", valueKind: "number", expected: "right" },
    { name: "참/거짓은 가운데", align: null, valueKind: "boolean", expected: "center" },
    { name: "오류는 가운데", align: null, valueKind: "error", expected: "center" },
    { name: "글자는 왼쪽 — 브라우저 기본이라 싣지 않는다", align: null, valueKind: "text", expected: null },
    { name: "빈 칸은 싣지 않는다", align: null, valueKind: null, expected: null },
    { name: "적어 둔 맞춤이 이긴다 — 수라도 왼쪽", align: "left", valueKind: "number", expected: "left" },
    { name: "적어 둔 가운데 그대로", align: "center", valueKind: "text", expected: "center" },
  ];

  for (const { name, align, valueKind, expected } of cases) {
    test(name, () => {
      const grid: SheetPrintGrid = {
        ...syntheticGrid(),
        rows: [{ row: 1, heightPt: 20, cells: [cell(1, 1, { text: "값", align, valueKind })] }],
        pictures: [],
      };
      const html = renderToStaticMarkup(<SheetPrintGridView grid={grid} scale={1} classPrefix="qxp" pictureSrc={() => ""} />);
      if (expected === null) assert.ok(!html.includes("text-align"), html);
      else assert.ok(html.includes(`text-align:${expected}`), html);
    });
  }
});

describe("공용 조각 — 새로 그리는 것은 글자 색 · 배경뿐", () => {
  const colored: SheetPrintGrid = {
    ...syntheticGrid(),
    rows: [
      {
        row: 1,
        heightPt: 20,
        cells: [
          cell(1, 1, { text: "머리글", fontColor: "#1F4E79", backgroundColor: "#FFFF00" }),
          cell(1, 2, { text: "글자만", fontColor: "#FF0000" }),
          cell(1, 3, { text: "밋밋", fontSizePt: 11 }),
        ],
      },
    ],
    pictures: [],
  };
  const html = renderToStaticMarkup(
    <SheetPrintGridView grid={colored} scale={1} classPrefix="qxp" pictureSrc={() => "data:,"} />
  );

  test("글자 색은 color, 배경은 background-color — 칸의 style 끝에", () => {
    assert.ok(html.includes("font-size:11.000pt\"") || html.includes("font-size:11.000pt"), html);
    assert.ok(html.includes(";color:#1F4E79;background-color:#FFFF00\">머리글<"), html);
    assert.ok(html.includes(";color:#FF0000\">글자만<"), html);
  });

  test("🔴 둘 다 null 이면 아무것도 싣지 않는다 — 보고서 격자가 이 경우다", () => {
    const plain = html.slice(html.indexOf("글자만"));
    assert.ok(!plain.includes("color:#") && !plain.includes("background-color"), plain);
  });

  test("클래스 앞말과 그림 주소는 쓰는 쪽이 정한다", () => {
    const withPicture = renderToStaticMarkup(
      <SheetPrintGridView
        grid={{ ...colored, pictures: [{ name: "a.png", leftPt: 1, topPt: 2, widthPt: 3, heightPt: 4, src: "data:image/png;base64,AAAA" }] }}
        scale={2}
        classPrefix="qxp"
        pictureSrc={(picture) => picture.src}
      />
    );
    assert.ok(withPicture.includes('class="qxp-sheet"') && withPicture.includes('class="qxp-table"'), withPicture);
    assert.ok(
      withPicture.includes(
        '<img class="qxp-picture" src="data:image/png;base64,AAAA" alt="" style="left:2.000pt;top:4.000pt;width:6.000pt;height:8.000pt"/>'
      ),
      withPicture
    );
  });
});
