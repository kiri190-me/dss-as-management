import { parseSheetRows, type SheetRow } from "./sheet-rows";
import { createCellTextReader } from "./sheet-text";
import {
  resolveSheetDrawingPart,
  resolveSheetPart,
  SHARED_STRINGS_PART,
  STYLES_PART,
  WORKBOOK_PART,
} from "./workbook-parts";
import { ZipArchive } from "./zip-reader";

/**
 * ============================================================================
 * 채워진 시트를 **화면이 그릴 수 있는 표**로 바꾼다
 * ============================================================================
 * 검사·수리 보고서 미리보기가 쓰는 조각이다. 견적서 미리보기
 * (`components/quotes/QuotePrintView.tsx`)는 양식을 보고 HTML 로 **손수 다시
 * 그린 것**인데, 여기서는 그 방식을 따르지 않는다.
 *
 * 까닭은 두 양식의 생김새가 다르기 때문이다. 견적서는 «흐르는 문서»(제목 ·
 * 회사정보 · 품목표 · 합계)라 손으로 그리는 편이 낫다. **보고서는 격자 서식**이다
 * — 좁은 칸 48개에 병합이 221개고, 그 병합이 `colspan`/`rowspan` 과 1:1 로
 * 대응된다. 손으로 그리면 문서가 두 벌이 되어 언젠가 서로 달라지고, 그날
 * 미리보기와 실제 나가는 파일이 다른 말을 한다.
 *
 * 그래서 이렇게 만든다:
 *
 *     저장된 보고서 → fillServiceReportWorkbook()  ← 이미 있다. 그대로 쓴다
 *                   → **채워진 시트 XML** → 이 파일 → 표 자료 → 화면
 *
 * 미리보기와 xlsx 가 **같은 값 · 같은 자리**에서 나온다. 어긋날 방법이 없다.
 *
 * ── 🔴 무엇을 읽고 무엇을 안 읽나 ───────────────────────────────────────
 * **일반적인 xlsx 뷰어가 아니다.** 이 양식이 실제로 쓰는 것만 다룬다:
 *
 *   읽는다  인쇄 영역 · 병합 · 열 너비 · 행 높이 · 셀 글자 · 테두리 · 가로세로
 *           맞춤 · 줄바꿈 · 글꼴 크기와 굵기 · 그림 앵커 · 인쇄 설정
 *   안 읽는다  숫자 서식 코드 · 글자 색과 배경 · 기울임/밑줄 · 조건부 서식 ·
 *           회전된 글자 · 대각선 테두리 · 자동 필터 · 틀 고정
 *
 * 안 읽는 것들은 이 양식의 인쇄 영역(`B8:AV64`)에 **하나도 쓰이지 않는다**
 * (실측). 나중에 쓰이게 되면 그 칸이 밋밋하게 나올 뿐 화면은 살아 있다.
 *
 * ── 🔴 모르는 것을 만났을 때 — 던지는 자리와 넘어가는 자리를 갈랐다 ─────
 * 채우개(`service-report-template.ts`)는 라벨이 어긋나면 던진다. 엉뚱한 칸을
 * 채운 문서가 고객사로 나가는 것보다 멈추는 편이 낫기 때문이다. 여기는 **보여
 * 주는 화면**이라 판단이 한 칸 다르다:
 *
 *   · **구조를 못 읽으면 던진다** — 인쇄 영역, `<sheetData>`. 그릴 범위를
 *     모르면 그릴 것이 없고, 짐작해서 엉뚱한 범위를 그리면 사람은 그것을
 *     문서라고 믿는다(숨은 도우미 열이 딸려 나온 미리보기를 보고 "파일도
 *     이렇게 나가나 보다" 하게 된다).
 *   · **서식을 못 읽으면 그 부분만 밋밋하게 그리고 넘어간다** — 테두리·정렬·
 *     글꼴·그림. 도장 하나를 못 꺼냈다고 화면을 죽이면, 사람이 값을 확인하는
 *     일까지 함께 막힌다. 값은 여전히 제자리에 있고, 정본이 필요하면 Excel 을
 *     받으면 된다(`sheet-text.ts` 의 '못 찾은 칸은 조용히 건너뛴다'와 같은
 *     판단).
 *
 * ── 🔴 후리가나(`<rPh>`)를 걷어 낸다 ────────────────────────────────────
 * 이 양식의 공유문자열에는 일본어 후리가나가 딸려 있다. 그대로 읽으면 「비　고」가
 * 「비　고ソナエコウ」로, 「고　객」이 「고　객キャクサキ」로 온다. 화면에 없는 글자가
 * 미리보기에만 찍히면 그것이야말로 «미리보기와 파일이 다른 말을 하는» 상태다.
 * `service-report-choices.ts` 가 이미 같은 함정을 지나갔고 같은 방법으로 푼다 —
 * 원본을 고치는 것이 아니라 **읽으려고 만든 사본**에서 `<rPh>` 를 걷어 낸다.
 *
 * ── 🔴 셀 글자는 `createCellTextReader` 로 읽되 **행 하나씩** 넘긴다 ─────
 * 그 함수는 넘겨받은 XML 에서 `<c r="…">` 을 정규식으로 찾는다. 시트 전체를
 * 넘기면 셀 하나를 읽을 때마다 157KB 를 훑고, 인쇄 영역 안 3,772칸이면
 * **294ms** 다(실측). 행 하나의 XML 만 넘기면 답은 한 글자도 다르지 않으면서
 * **37ms** 로 떨어진다 — 어차피 셀은 자기 행 안에만 있기 때문이다.
 *
 * ── 🔴 병합 칸의 테두리는 **가장자리 셀들에서 모은다** ──────────────────
 * Excel 은 병합 범위의 테두리를 «범위의 가장자리에 놓인 셀들»에 나눠 담는다.
 * 본문 줄(`H31:AU31`)이 그 예다 — 왼쪽 테두리는 `H31` 의 서식에, **오른쪽
 * 테두리는 `AU31`(가려진 칸)의 서식에** 들어 있다(실측: H32 는 s=497,
 * AU32 는 s=471). 왼쪽 위 칸의 서식만 보면 본문 상자의 오른쪽 변이 통째로
 * 사라진다. 그래서 네 변을 각각 그 변에 놓인 칸들에서 훑어 모은다.
 * ============================================================================
 */

export class SheetPrintGridError extends Error {}

/** `thin` · `medium` · `double` … OOXML 이 적어 둔 이름 그대로. 없으면 null. */
export type PrintGridBorderStyle = string | null;

export type PrintGridBorders = {
  top: PrintGridBorderStyle;
  right: PrintGridBorderStyle;
  bottom: PrintGridBorderStyle;
  left: PrintGridBorderStyle;
};

export type PrintGridCell = {
  /** 1부터. 인쇄 영역 밖으로는 안 나간다. */
  row: number;
  column: number;
  colSpan: number;
  rowSpan: number;
  /** 이미 다 풀린 글자. 줄바꿈은 `\n` 하나로 고른다. 빈 칸은 `""`. */
  text: string;
  /** `left` · `center` · `right` … 양식이 안 적었으면 null. */
  align: string | null;
  /** `top` · `center` · `bottom`. 양식이 안 적었으면 null. */
  verticalAlign: string | null;
  wrap: boolean;
  bold: boolean;
  /** pt. 못 읽었으면 null — 화면이 자기 기본값을 쓴다. */
  fontSizePt: number | null;
  borders: PrintGridBorders;
};

export type PrintGridRow = {
  row: number;
  heightPt: number;
  cells: PrintGridCell[];
};

/**
 * 양식 안에 박힌 그림 한 장의 자리. **인쇄 영역의 왼쪽 위가 원점**이고 단위는 pt.
 *
 * `name` 은 `xl/media/` 안의 파일 이름(`image3.png`)이다 — 그림 바이트는 여기서
 * 나르지 않는다. 미리보기는 서버 컴포넌트가 그린 HTML 이라 바이트를 실으면
 * 문서 전체가 base64 로 부풀고, 그림에는 **법인 직인**이 들어 있어 로그인 없이
 * 흘러도 안 된다. 화면은 이 이름으로 인가가 걸린 라우트에 물어본다.
 */
export type PrintGridPicture = {
  name: string;
  leftPt: number;
  topPt: number;
  widthPt: number;
  heightPt: number;
};

/** 양식이 정해 둔 인쇄 설정. 화면이 `@page` 와 배율에 그대로 쓴다. */
export type PrintGridPageSetup = {
  /** `<pageSetup paperSize>`. 9 = A4. 못 읽으면 null. */
  paperSize: number | null;
  /** 1 = 100%. `<pageSetup scale>` ÷ 100. 없으면 1. */
  scale: number;
  orientation: "portrait" | "landscape";
  /** 인치. `<pageMargins>` 그대로. */
  margins: { left: number; right: number; top: number; bottom: number };
  horizontallyCentered: boolean;
  verticallyCentered: boolean;
};

export type SheetPrintGrid = {
  /** 인쇄 영역. 🔴 **양식에서 읽은 것**이다 — 코드에 박힌 값이 아니다. */
  firstRow: number;
  lastRow: number;
  firstColumn: number;
  lastColumn: number;
  /** 인쇄 영역 안 열들의 너비(pt), 왼쪽부터. `lastColumn - firstColumn + 1` 개. */
  columnWidthsPt: number[];
  /** 배율을 먹이기 **전**의 크기(pt). */
  widthPt: number;
  heightPt: number;
  rows: PrintGridRow[];
  pictures: PrintGridPicture[];
  page: PrintGridPageSetup;
};

export type SheetPrintGridParts = {
  sheetName: string;
  workbookXml: string;
  sheetXml: string;
  sharedStringsXml: string | null;
  /** 없으면 테두리·정렬·글꼴 없이 그린다(위 '밋밋하게 그리고 넘어간다'). */
  stylesXml: string | null;
  /** 없으면 그림 없이 그린다. */
  drawingXml: string | null;
  drawingRelsXml: string | null;
};

// ── 단위 ─────────────────────────────────────────────────────────────────

/**
 * OOXML 의 길이 단위. `1pt = 12700 EMU` 이고 96dpi 에서 `1px = 0.75pt` 다.
 *
 * 그림 앵커의 «칸 안쪽 치우침»만 EMU 로 오고 나머지는 열 너비(px)·행 높이(pt)라,
 * 모두 pt 로 모아 셈한다.
 */
const EMU_PER_POINT = 12700;
const POINTS_PER_PIXEL = 0.75;

/**
 * 🔴 열 너비의 «문자 단위»를 픽셀로 바꿀 때 쓰는 **최대 숫자 폭**.
 *
 * OOXML 의 환산식은 규격에 있다:
 *
 *     pixels = Truncate(((256 × width + Truncate(128 ÷ MDW)) ÷ 256) × MDW)
 *
 * `MDW` 는 통합문서 기본 글꼴에서 숫자 한 자가 차지하는 픽셀 수다. 규격은 값을
 * 파일에 적어 두지 않으므로 어딘가에서 알아내야 한다.
 *
 * **이 양식의 값은 8이고, 양식 스스로가 그것을 알려 준다.** 그림 앵커에는 셀
 * 좌표(`<xdr:from>`)와 절대 좌표(`<a:off>`)가 함께 적혀 있어서 둘을 견주면
 * 열 너비의 실제 픽셀 값이 나온다(실측):
 *
 *   · 「그림 4」 from = 33열 + 11px, a:off.x = 484px → 1~32열 = 473px
 *   · 「그림 6」 from = 43열 +  9px, a:off.x = 632px → 1~42열 = 623px
 *   → 33~42열(너비 1.875) 10칸 = 150px → 15px/칸,  너비 1.75 는 14px/칸
 *   → 위 식에 MDW=8 을 넣으면 정확히 15 와 14 가 나온다(MDW=7 이면 13 과 12).
 *
 * 시험(`sheet-print-grid.test.ts`)이 이 셈을 양식의 앵커로 다시 확인한다 —
 * 숫자가 코드에만 있고 근거가 사라지는 것을 막기 위해서다.
 *
 * ⚠️ 글꼴이 바뀐 양식이 오면 폭이 몇 % 어긋난다. 그래도 **비율은 열끼리 그대로**
 * 유지되고(같은 식을 모든 열에 쓰므로) 화면은 종이에 맞춰 다시 줄이므로,
 * 어긋나 봐야 문서가 조금 좁거나 넓게 보일 뿐 자리가 무너지지는 않는다.
 */
const MAX_DIGIT_WIDTH_PX = 8;

/** `<sheetFormatPr defaultRowHeight>` 가 없을 때의 규격 기본값(pt). */
const DEFAULT_ROW_HEIGHT_PT = 15;

/** `<col>` 이 없는 열의 규격 기본 너비(문자 단위). */
const DEFAULT_COLUMN_WIDTH_CHARS = 8.43;

/**
 * 한 번에 그릴 수 있는 칸 수의 상한.
 *
 * 상한이 아니라 **폭주 방지**다. 인쇄 영역이 통째로 시트 전체(`A1:XFD1048576`)로
 * 잡힌 양식이 오면 셀 수십억 개를 만들다 서버가 멎는다. 이 양식의 인쇄 영역은
 * 47열 × 57행 = 2,679칸이다.
 */
const MAX_GRID_CELLS = 200_000;

// ── 들어가는 문 ──────────────────────────────────────────────────────────

/**
 * 채워진 통합문서(버퍼)에서 그 시트의 인쇄 영역을 표 자료로 읽는다.
 *
 * 🔴 **채우개가 만든 버퍼를 그대로 받는다.** 채우개 안을 들여다보거나 고쳐서
 * 중간 결과를 얻지 않는다 — 그러면 내려받는 파일과 미리보기가 서로 다른 길로
 * 만들어지고, 언젠가 한쪽만 바뀐다. zip 을 한 번 더 여는 값(수십 ms)은 그
 * 보증을 사는 값이다.
 */
export function readSheetPrintGrid(workbookXlsx: Buffer, sheetName: string): SheetPrintGrid {
  const archive = ZipArchive.fromBuffer(workbookXlsx);
  const sheetPart = resolveSheetPart(archive, sheetName);
  const drawingPart = resolveSheetDrawingPart(archive, sheetPart);

  return buildSheetPrintGrid({
    sheetName,
    workbookXml: archive.readText(WORKBOOK_PART),
    sheetXml: archive.readText(sheetPart),
    sharedStringsXml: archive.readTextOrNull(SHARED_STRINGS_PART),
    stylesXml: archive.readTextOrNull(STYLES_PART),
    drawingXml: drawingPart === null ? null : archive.readTextOrNull(drawingPart),
    drawingRelsXml:
      drawingPart === null
        ? null
        : archive.readTextOrNull(drawingPart.replace(/([^/]+)$/, "_rels/$1.rels")),
  });
}

/**
 * 부품(XML 문자열)만 받아 표 자료를 만든다 — **파일을 만지지 않는다.**
 * 시험이 지어낸 시트로 규칙을 확인할 수 있게 이쪽을 갈라 두었다.
 */
export function buildSheetPrintGrid(parts: SheetPrintGridParts): SheetPrintGrid {
  const range = readPrintArea(parts.workbookXml, parts.sheetName);

  const cellCount = (range.lastRow - range.firstRow + 1) * (range.lastColumn - range.firstColumn + 1);
  if (cellCount > MAX_GRID_CELLS) {
    throw new SheetPrintGridError(
      `인쇄 영역이 ${cellCount}칸입니다. ${MAX_GRID_CELLS}칸까지만 그립니다.`
    );
  }

  /**
   * 🔴 행은 **한 번만** 훑는다. `parseSheetRows` 가 `<sheetData>` 를 못 찾으면
   * 던지는데(`SheetRowError`), 그것은 구조를 못 읽은 것이므로 이 파일의 오류로
   * 바꿔 올린다 — 부르는 쪽이 잡아야 할 것이 한 가지이면 된다.
   */
  let sheetRows: SheetRow[];
  try {
    sheetRows = parseSheetRows(parts.sheetXml);
  } catch (err) {
    throw new SheetPrintGridError(
      `양식의 시트를 읽을 수 없습니다: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  const columnWidthsPx = readColumnWidths(parts.sheetXml);
  const rowHeightsPt = readRowHeights(parts.sheetXml, sheetRows);
  const styles = readStyles(parts.stylesXml);
  const sheetCells = readSheetCells(sheetRows, parts.sharedStringsXml, range);
  const merges = readMerges(parts.sheetXml, range);

  // 가려진 칸(병합의 왼쪽 위가 아닌 칸)은 그리지 않는다.
  const covered = new Set<string>();
  const anchors = new Map<string, MergeRange>();
  for (const merge of merges) {
    anchors.set(cellKey(merge.firstRow, merge.firstColumn), merge);
    for (let row = merge.firstRow; row <= merge.lastRow; row += 1) {
      for (let column = merge.firstColumn; column <= merge.lastColumn; column += 1) {
        if (row === merge.firstRow && column === merge.firstColumn) continue;
        covered.add(cellKey(row, column));
      }
    }
  }

  const rows: PrintGridRow[] = [];
  for (let row = range.firstRow; row <= range.lastRow; row += 1) {
    const heightPt = rowHeightsPt.get(row) ?? rowHeightsPt.get(0) ?? DEFAULT_ROW_HEIGHT_PT;
    const cells: PrintGridCell[] = [];

    for (let column = range.firstColumn; column <= range.lastColumn; column += 1) {
      const key = cellKey(row, column);
      if (covered.has(key)) continue;

      const merge = anchors.get(key);
      const lastRow = merge ? merge.lastRow : row;
      const lastColumn = merge ? merge.lastColumn : column;
      const found = sheetCells.get(key);

      cells.push({
        row,
        column,
        colSpan: lastColumn - column + 1,
        rowSpan: lastRow - row + 1,
        text: found?.text ?? "",
        align: styles.alignOf(found?.styleIndex),
        verticalAlign: styles.verticalAlignOf(found?.styleIndex),
        wrap: styles.wrapOf(found?.styleIndex),
        bold: styles.boldOf(found?.styleIndex),
        fontSizePt: styles.fontSizeOf(found?.styleIndex),
        // 🔴 네 변을 각각 그 변에 놓인 칸들에서 모은다(위 머리말).
        borders: collectBorders(sheetCells, styles, row, column, lastRow, lastColumn),
      });
    }

    rows.push({ row, heightPt, cells });
  }

  const columnWidthsPt: number[] = [];
  for (let column = range.firstColumn; column <= range.lastColumn; column += 1) {
    columnWidthsPt.push(columnWidthPx(columnWidthsPx, column) * POINTS_PER_PIXEL);
  }

  return {
    firstRow: range.firstRow,
    lastRow: range.lastRow,
    firstColumn: range.firstColumn,
    lastColumn: range.lastColumn,
    columnWidthsPt,
    widthPt: columnWidthsPt.reduce((sum, width) => sum + width, 0),
    heightPt: rows.reduce((sum, row) => sum + row.heightPt, 0),
    rows,
    pictures: readPictures(parts, range, columnWidthsPx, rowHeightsPt),
    page: readPageSetup(parts.sheetXml),
  };
}

// ── 인쇄 영역 ────────────────────────────────────────────────────────────

type CellRange = { firstRow: number; lastRow: number; firstColumn: number; lastColumn: number };
type MergeRange = CellRange;

/**
 * 🔴 그릴 범위는 **양식의 인쇄 영역**이다 — `B8:AV64` 를 코드에 박지 않는다.
 *
 * 한 통합문서에 인쇄 영역이 여럿일 수 있어서(이 파일은 `Repair_Record` 것과
 * `Repair_Report (한글)` 것 둘을 갖고 있다) 시트 이름을 견줘 고른다 —
 * `workbook-parts.ts` 의 `shiftPrintArea` 와 같은 판단이고, 채우개가 줄을 늘릴 때
 * 미는 것도 바로 이 값이다. 그래서 본문이 길어져 행이 늘어난 문서도 늘어난 채로
 * 그려진다.
 *
 * 인쇄 영역은 쉼표로 여러 덩이일 수 있다. 그때는 **첫 덩이만** 그린다 — 두
 * 덩이는 종이 두 장이라는 뜻이고, 그것을 한 장에 이어 붙여 그리면 있지도 않은
 * 문서를 보여 주게 된다. 이 양식은 한 덩이다.
 */
function readPrintArea(workbookXml: string, sheetName: string): CellRange {
  const pattern = /<definedName[^>]*name="_xlnm\.Print_Area"[^>]*>([^<]*)<\/definedName>/g;

  for (const match of workbookXml.matchAll(pattern)) {
    const reference = unescapeXml(match[1]);
    if (referencedSheetName(reference) !== sheetName) continue;

    const bang = reference.lastIndexOf("!");
    const first = reference.slice(bang + 1).split(",")[0];
    const range = parseRange(first);
    if (!range) {
      throw new SheetPrintGridError(`양식의 인쇄 영역을 읽을 수 없습니다: "${first}"`);
    }
    return range;
  }

  throw new SheetPrintGridError(`양식의 "${sheetName}" 시트에 인쇄 영역이 없습니다.`);
}

/** `견적서!$A$1:$I$60` 또는 `'내 시트'!$A$1` → 시트 이름. 없으면 null. */
function referencedSheetName(reference: string): string | null {
  const found = /^\s*(?:'((?:[^']|'')*)'|([^!']+))!/.exec(reference);
  if (!found) return null;
  return found[1] !== undefined ? found[1].replace(/''/g, "'") : (found[2] ?? null);
}

/** `$B$8:$AV$64` · `B8` 둘 다. 절대참조 표시는 자리와 상관이 없다. */
function parseRange(text: string): CellRange | null {
  const [rawStart, rawEnd] = text.trim().split(":");
  const start = parseCellAddress(rawStart);
  const end = parseCellAddress(rawEnd ?? rawStart);
  if (!start || !end) return null;

  return {
    firstRow: Math.min(start.row, end.row),
    lastRow: Math.max(start.row, end.row),
    firstColumn: Math.min(start.column, end.column),
    lastColumn: Math.max(start.column, end.column),
  };
}

function parseCellAddress(value: string | undefined): { column: number; row: number } | null {
  if (value === undefined) return null;
  const match = /^\$?([A-Za-z]+)\$?(\d+)$/.exec(value.trim());
  if (!match) return null;
  return { column: columnToNumber(match[1]), row: Number(match[2]) };
}

/** `A`=1 … `Z`=26, `AA`=27. 26진수인데 0이 없다. */
function columnToNumber(letters: string): number {
  let value = 0;
  for (const letter of letters.toUpperCase()) value = value * 26 + (letter.charCodeAt(0) - 64);
  return value;
}

// ── 열 너비 · 행 높이 ────────────────────────────────────────────────────

type ColumnWidths = { spans: { min: number; max: number; px: number }[]; defaultPx: number };

/**
 * 🔴 열 너비는 **양식의 `<cols>` 에서 읽는다** — 채우개가 본문 줄을 나눌 때
 * 같은 곳을 읽는 것과 같은 이유다(`readColumnRangeWidth`). 사람이 Excel 에서 열
 * 너비를 고치는 날 화면이 따라가야 한다.
 *
 * 숨긴 열(`hidden="1"`)은 0 이다. 이 양식은 63열부터 숨겨 두었는데, 그것이
 * 인쇄 영역 안에 들어오는 날 도우미 값이 문서에 나타나면 안 된다.
 */
function readColumnWidths(sheetXml: string): ColumnWidths {
  const spans: { min: number; max: number; px: number }[] = [];

  for (const match of sheetXml.matchAll(/<col\b[^>]*\/>/g)) {
    const tag = match[0];
    const min = Number(/\smin="(\d+)"/.exec(tag)?.[1]);
    const max = Number(/\smax="(\d+)"/.exec(tag)?.[1]);
    if (!Number.isInteger(min) || !Number.isInteger(max)) continue;

    const hidden = /\shidden="(?:1|true)"/.test(tag);
    const width = Number(/\swidth="([\d.]+)"/.exec(tag)?.[1]);
    spans.push({
      min,
      max,
      px: hidden ? 0 : charsToPixels(Number.isFinite(width) ? width : DEFAULT_COLUMN_WIDTH_CHARS),
    });
  }

  const defaultChars = Number(/<sheetFormatPr[^>]*\sdefaultColWidth="([\d.]+)"/.exec(sheetXml)?.[1]);
  return {
    spans,
    defaultPx: charsToPixels(Number.isFinite(defaultChars) ? defaultChars : DEFAULT_COLUMN_WIDTH_CHARS),
  };
}

/** 위 `MAX_DIGIT_WIDTH_PX` 의 환산식. */
function charsToPixels(chars: number): number {
  const mdw = MAX_DIGIT_WIDTH_PX;
  return Math.trunc(((256 * chars + Math.trunc(128 / mdw)) / 256) * mdw);
}

function columnWidthPx(widths: ColumnWidths, column: number): number {
  for (const span of widths.spans) {
    if (column >= span.min && column <= span.max) return span.px;
  }
  return widths.defaultPx;
}

/**
 * 행 번호 → 높이(pt). **0번 자리에 기본 높이**를 담아 둔다 — 시트에 `<row>` 가
 * 아예 없는 행(값도 서식도 없는 빈 줄)이 인쇄 영역 안에 있을 수 있다.
 *
 * 높이는 이미 pt 단위다(OOXML `ht`). 숨긴 행은 0 이다.
 */
function readRowHeights(sheetXml: string, sheetRows: readonly SheetRow[]): Map<number, number> {
  const declared = Number(/<sheetFormatPr[^>]*\sdefaultRowHeight="([\d.]+)"/.exec(sheetXml)?.[1]);
  const fallback = Number.isFinite(declared) ? declared : DEFAULT_ROW_HEIGHT_PT;

  const heights = new Map<number, number>([[0, fallback]]);
  for (const row of sheetRows) {
    const openTag = row.xml.slice(0, row.xml.indexOf(">") + 1);
    if (/\shidden="(?:1|true)"/.test(openTag)) {
      heights.set(row.rowNumber, 0);
      continue;
    }
    const height = Number(/\sht="([\d.]+)"/.exec(openTag)?.[1]);
    heights.set(row.rowNumber, Number.isFinite(height) ? height : fallback);
  }
  return heights;
}

// ── 셀 ───────────────────────────────────────────────────────────────────

type SheetCell = { text: string; styleIndex: number | null };

function cellKey(row: number, column: number): string {
  return `${row}:${column}`;
}

/**
 * 인쇄 영역 안에서 시트가 실제로 갖고 있는 칸들.
 *
 * 🔴 후리가나를 걷어 낸 공유문자열을 `createCellTextReader` 에 넘긴다(머리말).
 * 🔴 리더에는 **행 하나의 XML** 만 넘긴다(머리말의 실측).
 */
function readSheetCells(
  sheetRows: readonly SheetRow[],
  sharedStringsXml: string | null,
  range: CellRange
): Map<string, SheetCell> {
  const shared = stripPhoneticRuns(sharedStringsXml);
  const cells = new Map<string, SheetCell>();

  for (const row of sheetRows) {
    if (row.rowNumber < range.firstRow || row.rowNumber > range.lastRow) continue;
    const read = createCellTextReader(row.xml, shared);

    // 주소(`r`)는 늘 첫 속성이다 — `sheet-patch.ts` 의 `findCell` 이 이미 그것을
    // 전제로 셀을 찾고 있고, 이 파일이 읽는 시트는 그 함수가 손본 것이다.
    for (const match of row.xml.matchAll(/<c\s+r="([A-Z]+)(\d+)"([^>]*)>/g)) {
      const column = columnToNumber(match[1]);
      if (column < range.firstColumn || column > range.lastColumn) continue;

      const ref = `${match[1]}${match[2]}`;
      const attributes = match[3];
      const rawStyle = /\ss="(\d+)"/.exec(attributes)?.[1];
      const type = /\st="([^"]*)"/.exec(attributes)?.[1] ?? null;

      cells.set(cellKey(Number(match[2]), column), {
        text: displayText(read(ref), type),
        styleIndex: rawStyle === undefined ? null : Number(rawStyle),
      });
    }
  }

  return cells;
}

/**
 * 셀에 찍히는 글자.
 *
 * 🔴 **숫자 서식 코드를 읽지 않는다.** 손보는 것은 날짜 하나뿐이다: 이 통합문서는
 * `dateCompatibility="0"` 이라 날짜가 일련번호가 아니라 ISO 8601(`t="d"`)로 들어
 * 있고(채우개의 `setIsoDate`), 그대로 두면 「2026-09-02」로 나온다.
 *
 * ⚠️ 양식이 쓰는 날짜 서식은 `[$-F800]`(시스템 긴 날짜) 하나인데, 그것이 무엇으로
 * 보이는지는 **파일을 여는 사람의 OS 설정**을 따른다 — 한국어 Windows 에서는
 * 요일까지 붙는다. 여기서는 알 수 없으므로 요일을 지어내지 않고 「2026년 9월 2일」
 * 까지만 적는다. 값은 같고 꾸밈만 다르다.
 *
 * ⚠️ 양식이 언젠가 보통(transitional) 통합문서로 다시 저장되면 날짜가 일련번호로
 * 바뀐다(`usesIsoDates` 참조). 그때 이 칸은 「46265」처럼 보인다 — 그때 고칠 일이고,
 * 지금 없는 경우를 위해 서식 코드 해석기를 만들지 않는다.
 */
function displayText(raw: string | null, type: string | null): string {
  if (raw === null) return "";
  const text = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (type !== "d") return text;

  const date = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (!date) return text;
  return `${date[1]}년 ${Number(date[2])}월 ${Number(date[3])}일`;
}

/**
 * 후리가나(`<rPh>`)를 걷어 낸 공유문자열 — **읽으려고 만든 사본**이다. 원본은
 * 손대지 않고, 이 결과는 파일로 다시 나가지 않는다
 * (`service-report-choices.ts` 의 같은 함수와 같은 판단).
 */
function stripPhoneticRuns(sharedStringsXml: string | null): string | null {
  if (sharedStringsXml === null) return null;
  return sharedStringsXml
    .replace(/<rPh\b[^>]*\/>/g, "")
    .replace(/<rPh\b[^>]*>[\s\S]*?<\/rPh>/g, "");
}

/** 인쇄 영역과 겹치는 병합들. 삐져나온 쪽은 **잘라서** 담는다. */
function readMerges(sheetXml: string, range: CellRange): MergeRange[] {
  const merges: MergeRange[] = [];

  for (const match of sheetXml.matchAll(/<mergeCell\b[^>]*\sref="([^"]+)"[^>]*\/>/g)) {
    const parsed = parseRange(match[1]);
    if (!parsed) continue;

    const clipped: MergeRange = {
      firstRow: Math.max(parsed.firstRow, range.firstRow),
      lastRow: Math.min(parsed.lastRow, range.lastRow),
      firstColumn: Math.max(parsed.firstColumn, range.firstColumn),
      lastColumn: Math.min(parsed.lastColumn, range.lastColumn),
    };
    // 인쇄 영역 밖의 병합(이 양식은 `BK10:DC10` 같은 도우미가 있다)은 안 그린다.
    if (clipped.firstRow > clipped.lastRow || clipped.firstColumn > clipped.lastColumn) continue;
    merges.push(clipped);
  }

  return merges;
}

// ── 서식 ─────────────────────────────────────────────────────────────────

type XfStyle = {
  borderId: number | null;
  fontId: number | null;
  parentXfId: number | null;
  align: string | null;
  verticalAlign: string | null;
  wrap: boolean | null;
};

type StyleTable = {
  alignOf(styleIndex: number | null | undefined): string | null;
  verticalAlignOf(styleIndex: number | null | undefined): string | null;
  wrapOf(styleIndex: number | null | undefined): boolean;
  boldOf(styleIndex: number | null | undefined): boolean;
  fontSizeOf(styleIndex: number | null | undefined): number | null;
  bordersOf(styleIndex: number | null | undefined): PrintGridBorders;
};

const EMPTY_BORDERS: PrintGridBorders = { top: null, right: null, bottom: null, left: null };

/**
 * 🔴 `<xf>` 하나를 잡는 정규식. `[^>]*` 를 **탐욕적으로** 쓰면 자체닫힘의 `/` 를
 * 삼킨 뒤 다음 `xf` 까지 한 덩이가 되어 **번호가 밀린다** — 그러면 문서 전체의
 * 서식이 어긋난다(`workbook-parts.ts` 의 `CELL_XF` 가 같은 자리에서 같은 것을
 * 겪었다. 그 상수는 내보내지 않으므로 같은 판단을 여기 다시 적는다).
 */
const XF_PATTERN = /<xf\b[^>]*?(?:\/>|>[\s\S]*?<\/xf>)/g;
const BORDER_PATTERN = /<border\b[^>]*?(?:\/>|>[\s\S]*?<\/border>)/g;
const FONT_PATTERN = /<font\b[^>]*?(?:\/>|>[\s\S]*?<\/font>)/g;

/**
 * `styles.xml` 을 읽어 «서식 번호 → 실제 모양» 을 답해 주는 표.
 *
 * 못 읽으면 **전부 null 을 답하는 표**를 돌려준다 — 테두리도 정렬도 없는 밋밋한
 * 표가 나오지만 값은 제자리에 있다(머리말의 '서식을 못 읽으면 넘어간다').
 */
function readStyles(stylesXml: string | null): StyleTable {
  const blank: StyleTable = {
    alignOf: () => null,
    verticalAlignOf: () => null,
    wrapOf: () => false,
    boldOf: () => false,
    fontSizeOf: () => null,
    bordersOf: () => EMPTY_BORDERS,
  };
  if (stylesXml === null) return blank;

  const cellXfs = readXfBlock(stylesXml, "cellXfs");
  const cellStyleXfs = readXfBlock(stylesXml, "cellStyleXfs");
  if (cellXfs.length === 0) return blank;

  const borders = readBorders(stylesXml);
  const fonts = readFonts(stylesXml);

  const xfOf = (styleIndex: number | null | undefined): XfStyle | null =>
    styleIndex === null || styleIndex === undefined ? null : (cellXfs[styleIndex] ?? null);

  /**
   * 맞춤은 `<xf>` 에 없으면 **이름 있는 서식**(`xfId` → `cellStyleXfs`)에서
   * 물려받는다. 한 칸만 물려받는다 — 그 위로 더 올라가는 통합문서는 이 양식에
   * 없고, 없는 경우를 위해 상속 사슬을 만들면 그것이 또 하나의 짐작이 된다.
   */
  const alignSource = (xf: XfStyle | null): XfStyle | null => {
    if (xf === null) return null;
    if (xf.align !== null || xf.verticalAlign !== null || xf.wrap !== null) return xf;
    if (xf.parentXfId === null) return xf;
    return cellStyleXfs[xf.parentXfId] ?? xf;
  };

  return {
    alignOf: (index) => alignSource(xfOf(index))?.align ?? null,
    verticalAlignOf: (index) => alignSource(xfOf(index))?.verticalAlign ?? null,
    wrapOf: (index) => alignSource(xfOf(index))?.wrap === true,
    boldOf: (index) => {
      const fontId = xfOf(index)?.fontId;
      return fontId === null || fontId === undefined ? false : (fonts[fontId]?.bold ?? false);
    },
    fontSizeOf: (index) => {
      const fontId = xfOf(index)?.fontId;
      return fontId === null || fontId === undefined ? null : (fonts[fontId]?.sizePt ?? null);
    },
    bordersOf: (index) => {
      const borderId = xfOf(index)?.borderId;
      if (borderId === null || borderId === undefined) return EMPTY_BORDERS;
      return borders[borderId] ?? EMPTY_BORDERS;
    },
  };
}

function readXfBlock(stylesXml: string, tag: "cellXfs" | "cellStyleXfs"): XfStyle[] {
  const block = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`).exec(stylesXml);
  if (!block) return [];

  return [...block[1].matchAll(XF_PATTERN)].map((match) => {
    const xf = match[0];
    const openTag = xf.slice(0, xf.indexOf(">") + 1);
    const alignment = /<alignment\b[^>]*\/?>/.exec(xf)?.[0] ?? null;

    return {
      borderId: numberAttribute(openTag, "borderId"),
      fontId: numberAttribute(openTag, "fontId"),
      parentXfId: numberAttribute(openTag, "xfId"),
      align: alignment === null ? null : (/\shorizontal="([^"]*)"/.exec(alignment)?.[1] ?? null),
      verticalAlign: alignment === null ? null : (/\svertical="([^"]*)"/.exec(alignment)?.[1] ?? null),
      wrap: alignment === null ? null : /\swrapText="(?:1|true)"/.test(alignment),
    };
  });
}

/**
 * 🔴 이 통합문서는 `conformance="strict"` 라 테두리 이름이 **`start`/`end`** 다
 * (보통 판은 `left`/`right`). 둘 다 알아듣는다 — 한쪽만 보면 이 양식에서는
 * 세로 테두리가 통째로 사라지고, 격자 서식인 보고서는 그 순간 표로 안 보인다.
 * 가로쓰기 문서라 `start` = 왼쪽이다.
 */
function readBorders(stylesXml: string): PrintGridBorders[] {
  const block = /<borders\b[^>]*>([\s\S]*?)<\/borders>/.exec(stylesXml);
  if (!block) return [];

  return [...block[1].matchAll(BORDER_PATTERN)].map((match) => ({
    top: borderSide(match[0], "top"),
    bottom: borderSide(match[0], "bottom"),
    left: borderSide(match[0], "left") ?? borderSide(match[0], "start"),
    right: borderSide(match[0], "right") ?? borderSide(match[0], "end"),
  }));
}

function borderSide(border: string, side: string): PrintGridBorderStyle {
  const tag = new RegExp(`<${side}\\b[^>]*?(?:/>|>)`).exec(border)?.[0];
  if (tag === undefined) return null;
  return /\sstyle="([^"]*)"/.exec(tag)?.[1] ?? null;
}

function readFonts(stylesXml: string): { sizePt: number | null; bold: boolean }[] {
  const block = /<fonts\b[^>]*>([\s\S]*?)<\/fonts>/.exec(stylesXml);
  if (!block) return [];

  return [...block[1].matchAll(FONT_PATTERN)].map((match) => {
    const size = Number(/<sz\b[^>]*\sval="([\d.]+)"/.exec(match[0])?.[1]);
    return {
      sizePt: Number.isFinite(size) ? size : null,
      // `<b/>` 와 `<b val="1"/>` 둘 다 굵게다. `<b val="0"/>` 은 아니다.
      bold: /<b\b(?![^>]*\sval="(?:0|false)")[^>]*\/?>/.test(match[0]),
    };
  });
}

function numberAttribute(tag: string, name: string): number | null {
  const value = Number(new RegExp(`\\s${name}="(\\d+)"`).exec(tag)?.[1]);
  return Number.isInteger(value) ? value : null;
}

/**
 * 병합 칸 하나의 네 변. 각 변에 **실제로 놓인 칸들**을 훑어 처음 만나는 테두리를
 * 쓴다(머리말의 '병합 칸의 테두리는 가장자리 셀들에서 모은다').
 *
 * 병합이 아니면 범위가 한 칸이라 자기 자신의 네 변이 그대로 나온다.
 */
function collectBorders(
  cells: Map<string, SheetCell>,
  styles: StyleTable,
  firstRow: number,
  firstColumn: number,
  lastRow: number,
  lastColumn: number
): PrintGridBorders {
  const sideOf = (row: number, column: number): PrintGridBorders =>
    styles.bordersOf(cells.get(cellKey(row, column))?.styleIndex);

  let top: PrintGridBorderStyle = null;
  let bottom: PrintGridBorderStyle = null;
  for (let column = firstColumn; column <= lastColumn; column += 1) {
    top ??= sideOf(firstRow, column).top;
    bottom ??= sideOf(lastRow, column).bottom;
  }

  let left: PrintGridBorderStyle = null;
  let right: PrintGridBorderStyle = null;
  for (let row = firstRow; row <= lastRow; row += 1) {
    left ??= sideOf(row, firstColumn).left;
    right ??= sideOf(row, lastColumn).right;
  }

  return { top, right, bottom, left };
}

// ── 그림 ─────────────────────────────────────────────────────────────────

/**
 * 양식 안에 박힌 그림들의 자리.
 *
 * 🔴 **그림 파일만 담는다.** 이 양식에는 `image1.emf`·`image2.emf` 도 있지만 그것은
 * **엑셀 단추(ActiveX)** 에 붙은 것이고 인쇄에 나오지 않는다. 게다가 브라우저는
 * EMF 를 못 읽는다. 걸러 내는 방법은 이름을 견주는 것이 아니라 **어느 파트가
 * 가리키는가**다 — 시트의 그림 파트(`drawing2.xml`)가 가리키는 것은 도장 두 장
 * 뿐이고, EMF 는 도형 파트(`vmlDrawing2.vml`)가 따로 가리킨다.
 *
 * `twoCellAnchor` 만 읽는다 — 이 양식이 쓰는 것이 그것뿐이다. 다른 앵커
 * (`oneCellAnchor`·`absoluteAnchor`)를 만나면 그 그림만 건너뛴다.
 */
function readPictures(
  parts: SheetPrintGridParts,
  range: CellRange,
  columnWidths: ColumnWidths,
  rowHeights: Map<number, number>
): PrintGridPicture[] {
  if (parts.drawingXml === null || parts.drawingRelsXml === null) return [];

  const media = readDrawingImageTargets(parts.drawingRelsXml);
  if (media.size === 0) return [];

  // 인쇄 영역의 왼쪽 위(원점).
  const originPx = columnLeftPx(columnWidths, range.firstColumn);
  const originPt = rowTopPt(rowHeights, range.firstRow);
  const widthPt = columnLeftPx(columnWidths, range.lastColumn + 1) * POINTS_PER_PIXEL - originPx * POINTS_PER_PIXEL;
  const heightPt = rowTopPt(rowHeights, range.lastRow + 1) - originPt;

  const pictures: PrintGridPicture[] = [];
  const anchors = parts.drawingXml.matchAll(
    /<xdr:twoCellAnchor\b[^>]*>([\s\S]*?)<\/xdr:twoCellAnchor>/g
  );

  for (const anchor of anchors) {
    const block = anchor[1];
    if (!block.includes("<xdr:pic>")) continue;

    const relId = /<a:blip\b[^>]*\sr:embed="([^"]+)"/.exec(block)?.[1];
    const name = relId === undefined ? undefined : media.get(relId);
    if (name === undefined) continue;

    const from = parseAnchorPoint(block, "from");
    const to = parseAnchorPoint(block, "to");
    if (!from || !to) continue;

    // 앵커의 열·행은 **0부터** 센다(`shiftDrawingAnchorRows` 와 같은 규칙).
    const leftPt =
      (columnLeftPx(columnWidths, from.column + 1) - originPx) * POINTS_PER_PIXEL +
      from.columnOffset / EMU_PER_POINT;
    const rightPt =
      (columnLeftPx(columnWidths, to.column + 1) - originPx) * POINTS_PER_PIXEL +
      to.columnOffset / EMU_PER_POINT;
    const topPt = rowTopPt(rowHeights, from.row + 1) - originPt + from.rowOffset / EMU_PER_POINT;
    const bottomPt = rowTopPt(rowHeights, to.row + 1) - originPt + to.rowOffset / EMU_PER_POINT;

    // 인쇄 영역 밖에 있는 그림은 안 그린다 — 이 양식은 같은 도장을 숨은 도우미
    // 열(68열)에도 한 장 더 붙여 두었다.
    if (rightPt <= 0 || bottomPt <= 0 || leftPt >= widthPt || topPt >= heightPt) continue;

    pictures.push({
      name,
      leftPt,
      topPt,
      widthPt: Math.max(rightPt - leftPt, 0),
      heightPt: Math.max(bottomPt - topPt, 0),
    });
  }

  return pictures;
}

/** 그림 파트의 관계 파일에서 «rId → 파일 이름». 그림이 아닌 관계는 안 담는다. */
function readDrawingImageTargets(relsXml: string): Map<string, string> {
  const targets = new Map<string, string>();

  for (const match of relsXml.matchAll(/<Relationship\b[^>]*\/>/g)) {
    const tag = match[0];
    if (!/\/relationships\/image"/.test(tag)) continue;

    const id = /\sId="([^"]+)"/.exec(tag)?.[1];
    const target = /\sTarget="([^"]+)"/.exec(tag)?.[1];
    if (id === undefined || target === undefined) continue;

    const name = target.split("/").pop();
    if (name === undefined || name === "") continue;
    targets.set(id, name);
  }

  return targets;
}

function parseAnchorPoint(
  block: string,
  side: "from" | "to"
): { column: number; columnOffset: number; row: number; rowOffset: number } | null {
  const inner = new RegExp(`<xdr:${side}>([\\s\\S]*?)</xdr:${side}>`).exec(block)?.[1];
  if (inner === undefined) return null;

  const value = (tag: string): number | null => {
    const found = new RegExp(`<xdr:${tag}>(-?\\d+)</xdr:${tag}>`).exec(inner)?.[1];
    return found === undefined ? null : Number(found);
  };

  const column = value("col");
  const row = value("row");
  if (column === null || row === null) return null;
  return { column, columnOffset: value("colOff") ?? 0, row, rowOffset: value("rowOff") ?? 0 };
}

/** 1열부터 `column` 바로 앞까지의 너비 합(px). */
function columnLeftPx(widths: ColumnWidths, column: number): number {
  let total = 0;
  for (let index = 1; index < column; index += 1) total += columnWidthPx(widths, index);
  return total;
}

/** 1행부터 `row` 바로 앞까지의 높이 합(pt). */
function rowTopPt(heights: Map<number, number>, row: number): number {
  const fallback = heights.get(0) ?? DEFAULT_ROW_HEIGHT_PT;
  let total = 0;
  for (let index = 1; index < row; index += 1) total += heights.get(index) ?? fallback;
  return total;
}

// ── 인쇄 설정 ────────────────────────────────────────────────────────────

/**
 * 🔴 종이·여백·배율도 **양식에서 읽는다.** 이 양식은 A4 세로 94%, 여백은 좌
 * 0.787in · 우 0.551in · 위 0.512in · 아래 0.394in 이고 가로세로 가운데다. 값을
 * 화면에 적어 두면 양식을 고친 날 미리보기만 옛 배율로 남는다.
 */
function readPageSetup(sheetXml: string): PrintGridPageSetup {
  const setup = /<pageSetup\b[^>]*\/?>/.exec(sheetXml)?.[0] ?? "";
  const margins = /<pageMargins\b[^>]*\/?>/.exec(sheetXml)?.[0] ?? "";
  const options = /<printOptions\b[^>]*\/?>/.exec(sheetXml)?.[0] ?? "";

  const scale = Number(/\sscale="(\d+)"/.exec(setup)?.[1]);
  const paperSize = Number(/\spaperSize="(\d+)"/.exec(setup)?.[1]);
  const margin = (name: string, fallback: number): number => {
    const value = Number(new RegExp(`\\s${name}="([\\d.]+)"`).exec(margins)?.[1]);
    return Number.isFinite(value) ? value : fallback;
  };

  return {
    paperSize: Number.isInteger(paperSize) ? paperSize : null,
    // 배율이 없으면 100% 다. `fitToPage` 는 이 양식이 안 쓰므로 읽지 않는다.
    scale: Number.isFinite(scale) && scale > 0 ? scale / 100 : 1,
    orientation: /\sorientation="landscape"/.test(setup) ? "landscape" : "portrait",
    // 없을 때의 값은 Excel 의 기본 여백(인치)이다.
    margins: {
      left: margin("left", 0.7),
      right: margin("right", 0.7),
      top: margin("top", 0.75),
      bottom: margin("bottom", 0.75),
    },
    horizontallyCentered: /\shorizontalCentered="(?:1|true)"/.test(options),
    verticallyCentered: /\sverticalCentered="(?:1|true)"/.test(options),
  };
}

function unescapeXml(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    // & 는 마지막이다 — 먼저 풀면 `&amp;lt;` 가 `<` 로 잘못 풀린다.
    .replace(/&amp;/g, "&");
}
