import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  fillMatcherQuoteWorkbook,
  MATCHER_QUOTE_CELLS,
  MATCHER_QUOTE_SHEET_NAME,
  type MatcherQuoteInput,
} from "./matcher-quote-template";
import { fillQuoteWorkbook, QUOTE_CELLS, QUOTE_SHEET_NAME, type GeneratorQuoteInput } from "./quote-template";
import {
  buildSheetPrintGrid,
  readSheetPrintGrid,
  SheetPrintGridError,
  type PrintGridCell,
  type SheetPrintGrid,
  type SheetPrintGridParts,
} from "./sheet-print-grid";
import { createCellTextReader } from "./sheet-text";
import {
  fillServiceReportWorkbook,
  SERVICE_REPORT_BODY_LABELS,
  SERVICE_REPORT_CELLS,
  SERVICE_REPORT_FINDINGS_INTRO,
  SERVICE_REPORT_SHEET_NAME,
  type ServiceReportInput,
} from "./service-report-template";
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
 * 채워진 시트 → 미리보기가 그릴 표
 * ============================================================================
 * 앞의 묶음은 **양식 없이도 도는 시험**이다 — 지어낸 시트로 규칙만 본다.
 *
 * 뒤의 묶음은 실제 양식 파일이 있어야 돈다(`REPAIR_REPORT_TEMPLATE_PATH`).
 * 없으면 건너뛴다 — 양식은 저장소에 두지 않는다(직인이 들어 있다).
 *
 * 🔴 **시험 자료는 전부 지어낸 것이다.** 양식 파일 자체가 실제로 발행된 보고서의
 * 사본이라 진짜 고객사 이름이 들어 있는데, 그것을 기대값으로 쓰면 시험이 통과하는
 * 것과 "우리가 그 값을 지웠는가"가 뒤섞인다(채우개 시험과 같은 규칙).
 * ============================================================================
 */

// ── 양식 없이 — 규칙만 ───────────────────────────────────────────────────

const SHEET_NAME = "시험 시트";

/** 인쇄 영역을 갈아 끼울 수 있게 만들어 주는 통합문서. */
function workbookXml(printArea: string): string {
  return (
    '<?xml version="1.0"?><workbook>' +
    `<sheets><sheet name="${SHEET_NAME}" sheetId="1" r:id="rId1"/></sheets>` +
    "<definedNames>" +
    `<definedName name="_xlnm.Print_Area" localSheetId="0">'${SHEET_NAME}'!${printArea}</definedName>` +
    // 다른 시트의 인쇄 영역이 섞여 있어도 우리 것만 골라야 한다.
    '<definedName name="_xlnm.Print_Area" localSheetId="1">다른시트!$A$1:$Z$99</definedName>' +
    "</definedNames></workbook>"
  );
}

const SHEET_XML =
  '<?xml version="1.0"?><worksheet>' +
  '<sheetFormatPr defaultRowHeight="12"/>' +
  '<cols><col min="1" max="4" width="10" customWidth="1"/><col min="5" max="5" width="10" hidden="1" customWidth="1"/></cols>' +
  "<sheetData>" +
  '<row r="2" ht="20" customHeight="1"><c r="B2" s="1" t="s"><v>0</v></c><c r="D2" s="2"/></row>' +
  '<row r="3"><c r="D3" s="0" t="inlineStr"><is><t>가운데</t></is></c></row>' +
  '<row r="4"><c r="B4" s="0" t="d"><v>2026-09-02</v></c></row>' +
  "</sheetData>" +
  // A1:A2 는 인쇄 영역 밖이라 안 그린다. A4:C4 는 걸쳐 있어 B4:C4 로 잘린다.
  '<mergeCells count="3"><mergeCell ref="B2:C3"/><mergeCell ref="A1:A2"/><mergeCell ref="A4:C4"/></mergeCells>' +
  '<printOptions horizontalCentered="1"/>' +
  '<pageMargins left="1" right="1" top="1" bottom="1"/>' +
  '<pageSetup paperSize="9" scale="80" orientation="portrait"/>' +
  "</worksheet>";

/** 🔴 후리가나(`<rPh>`)가 딸린 공유문자열 — 이 양식이 실제로 그렇다. */
const SHARED_STRINGS_XML =
  '<?xml version="1.0"?><sst count="1" uniqueCount="1">' +
  '<si><t>비　고</t><rPh sb="0" eb="1"><t>ソナエ</t></rPh><phoneticPr fontId="1"/></si>' +
  "</sst>";

/** 🔴 `conformance="strict"` 판이라 테두리 이름이 `start`/`end` 다 — 이 양식이 그렇다. */
const STYLES_XML =
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
  "</cellXfs></styleSheet>";

function buildSynthetic(printArea = "$B$2:$D$4"): SheetPrintGrid {
  return buildSheetPrintGrid({
    sheetName: SHEET_NAME,
    workbookXml: workbookXml(printArea),
    sheetXml: SHEET_XML,
    sharedStringsXml: SHARED_STRINGS_XML,
    stylesXml: STYLES_XML,
    drawingXml: null,
    drawingRelsXml: null,
  });
}

function cellAt(grid: SheetPrintGrid, row: number, column: number): PrintGridCell {
  const found = grid.rows.find((entry) => entry.row === row)?.cells.find((cell) => cell.column === column);
  assert.ok(found, `${row}행 ${column}열 칸이 없습니다`);
  return found;
}

test("🔴 그릴 범위는 양식의 인쇄 영역에서 온다 — 범위를 바꾸면 결과가 따라 바뀐다", () => {
  const wide = buildSynthetic("$B$2:$D$4");
  assert.deepEqual(
    { firstRow: wide.firstRow, lastRow: wide.lastRow, firstColumn: wide.firstColumn, lastColumn: wide.lastColumn },
    { firstRow: 2, lastRow: 4, firstColumn: 2, lastColumn: 4 }
  );

  const narrow = buildSynthetic("$C$3:$D$4");
  assert.deepEqual(
    { firstRow: narrow.firstRow, lastRow: narrow.lastRow, firstColumn: narrow.firstColumn, lastColumn: narrow.lastColumn },
    { firstRow: 3, lastRow: 4, firstColumn: 3, lastColumn: 4 }
  );
  assert.equal(narrow.rows.length, 2);
  assert.equal(narrow.columnWidthsPt.length, 2);
});

test("인쇄 영역이 여러 덩이면 첫 덩이만 그린다", () => {
  const grid = buildSynthetic("$B$2:$C$3,$D$4:$D$4");
  assert.equal(grid.lastRow, 3);
  assert.equal(grid.lastColumn, 3);
});

test("그 시트의 인쇄 영역이 없으면 던진다 — 짐작해서 엉뚱한 범위를 그리지 않는다", () => {
  assert.throws(
    () =>
      buildSheetPrintGrid({
        sheetName: "없는 시트",
        workbookXml: workbookXml("$B$2:$D$4"),
        sheetXml: SHEET_XML,
        sharedStringsXml: null,
        stylesXml: null,
        drawingXml: null,
        drawingRelsXml: null,
      }),
    SheetPrintGridError
  );
});

test("병합은 colspan/rowspan 이 되고, 가려진 칸은 안 그린다", () => {
  const grid = buildSynthetic();

  const merged = cellAt(grid, 2, 2);
  assert.equal(merged.colSpan, 2);
  assert.equal(merged.rowSpan, 2);

  // C2·B3·C3 은 가려졌다. 3행에 남는 것은 D3 하나뿐이다.
  assert.deepEqual(
    grid.rows.find((row) => row.row === 3)?.cells.map((cell) => cell.column),
    [4]
  );
});

test("인쇄 영역 밖의 병합은 무시하고, 걸친 병합은 잘라서 쓴다", () => {
  const grid = buildSynthetic();

  // A1:A2 는 통째로 밖 — 2행의 칸은 병합 하나(B2)와 D2 둘뿐이다.
  assert.deepEqual(
    grid.rows.find((row) => row.row === 2)?.cells.map((cell) => cell.column),
    [2, 4]
  );
  // A4:C4 는 B4:C4 로 잘린다.
  assert.equal(cellAt(grid, 4, 2).colSpan, 2);
});

/**
 * 🔴 인쇄 영역의 **모든 칸이 정확히 한 번씩** 덮이는가.
 *
 * HTML 표에서 이것이 어긋나면 브라우저가 줄을 제멋대로 늘리거나 칸을 밀어내고,
 * 그 순간 격자 서식인 보고서는 문서로 안 보인다. 병합을 잘못 세거나 가려진 칸을
 * 빠뜨리면 여기서 걸린다.
 */
function assertCoversRangeExactly(grid: SheetPrintGrid): void {
  const rows = grid.lastRow - grid.firstRow + 1;
  const columns = grid.lastColumn - grid.firstColumn + 1;
  const covered = new Uint8Array(rows * columns);

  for (const row of grid.rows) {
    for (const cell of row.cells) {
      for (let r = cell.row; r < cell.row + cell.rowSpan; r += 1) {
        for (let c = cell.column; c < cell.column + cell.colSpan; c += 1) {
          assert.ok(
            r >= grid.firstRow && r <= grid.lastRow && c >= grid.firstColumn && c <= grid.lastColumn,
            `${cell.row}행 ${cell.column}열의 병합이 인쇄 영역 밖으로 나갑니다`
          );
          const index = (r - grid.firstRow) * columns + (c - grid.firstColumn);
          assert.equal(covered[index], 0, `${r}행 ${c}열이 두 번 덮였습니다`);
          covered[index] = 1;
        }
      }
    }
  }

  const missing = covered.indexOf(0);
  assert.equal(
    missing,
    -1,
    missing === -1
      ? ""
      : `${grid.firstRow + Math.floor(missing / columns)}행 ${grid.firstColumn + (missing % columns)}열이 비어 있습니다`
  );
}

test("🔴 인쇄 영역의 모든 칸이 정확히 한 번씩 덮인다", () => {
  assertCoversRangeExactly(buildSynthetic());
  assertCoversRangeExactly(buildSynthetic("$C$3:$D$4"));
});

test("🔴 후리가나(rPh)가 글자에 섞이지 않는다", () => {
  assert.equal(cellAt(buildSynthetic(), 2, 2).text, "비　고");
});

/**
 * 🔴 양식의 날짜 서식은 `[$-F800]`(시스템 긴 날짜)이고, 사용자가 실제로 쓰는
 * 한국어 Windows 의 Excel 은 그것을 **요일까지** 그린다. 미리보기가 요일을 빼면
 * 같은 칸이 화면과 파일에서 다르게 보인다(2026-09-02 사용자 결정).
 */
test("🔴 ISO 날짜 칸은 요일까지 붙은 한국어 긴 날짜가 된다", () => {
  assert.equal(cellAt(buildSynthetic(), 4, 2).text, "2026년 9월 2일 수요일");
});

/** 시트 하나를 지어내 날짜 한 칸만 갈아 끼운다. */
function dateCellText(isoDate: string): string {
  const grid = buildSheetPrintGrid({
    sheetName: SHEET_NAME,
    workbookXml: workbookXml("$B$4:$B$4"),
    sheetXml: SHEET_XML.replace("2026-09-02", isoDate),
    sharedStringsXml: SHARED_STRINGS_XML,
    stylesXml: STYLES_XML,
    drawingXml: null,
    drawingRelsXml: null,
  });
  return cellAt(grid, 4, 2).text;
}

/**
 * 🔴 요일이 **실제로 맞는가.** 모양만 보면 늘 「일요일」을 붙여도 통과한다.
 * 알려진 날짜 일곱을 못 박아 이레가 한 바퀴 도는 것까지 본다.
 */
test("🔴 요일이 실제로 맞다 — 알려진 날짜로 못 박는다", () => {
  assert.equal(dateCellText("2026-09-02"), "2026년 9월 2일 수요일");
  assert.equal(dateCellText("2026-09-03"), "2026년 9월 3일 목요일");
  assert.equal(dateCellText("2026-09-04"), "2026년 9월 4일 금요일");
  assert.equal(dateCellText("2026-09-05"), "2026년 9월 5일 토요일");
  assert.equal(dateCellText("2026-09-06"), "2026년 9월 6일 일요일");
  assert.equal(dateCellText("2026-09-07"), "2026년 9월 7일 월요일");
  assert.equal(dateCellText("2026-09-08"), "2026년 9월 8일 화요일");

  // 달·해가 바뀌는 자리도 — 문자열을 잘라 셈하면 여기서 틀어진다.
  assert.equal(dateCellText("2026-02-28"), "2026년 2월 28일 토요일");
  assert.equal(dateCellText("2024-02-29"), "2024년 2월 29일 목요일");
  assert.equal(dateCellText("2027-01-01"), "2027년 1월 1일 금요일");
});

/**
 * 🔴 **요일 이름을 기기에 맡기지 않는다.** `toLocaleDateString()` 이나 기기 시간대를
 * 보는 `getDay()` 로 만들면, 같은 문서가 서버 설정에 따라 다른 요일로 인쇄된다 —
 * 고객사로 나가는 문서에서 그것은 사고이고, 오류가 안 나서 아무도 모른다.
 * (`date-only.ts` · `service-report-draft.ts` 가 KST 로 못 박은 것과 같은 판단.)
 *
 * ⚠️ 아래의 -11 시간대에서 `new Date("2026-09-02").getDay()` 는 **화요일**을
 * 돌려준다(실측). 그것이 이 시험이 막는 바로 그 어긋남이다.
 */
test("🔴 요일이 기기 시간대에 휘둘리지 않는다 — 같은 날짜면 늘 같은 요일", () => {
  /**
   * 🔴 **`delete process.env.TZ` 로는 안 돌아온다**(실측). 지우면 Node 는 시스템
   * 시간대로 되돌아가는 것이 아니라 **마지막에 설정된 시간대를 그대로 붙들고
   * 있는다.** 그대로 두면 이 파일의 **뒤에 오는 시험들이 딴 시간대에서 돌고**,
   * 실제로 그렇게 「실제 양식」 시험의 발행일이 하루 밀렸다. 그래서 지금 실제로
   * 쓰이는 시간대를 이름으로 받아 두었다가 그것으로 되돌린다.
   */
  const original = process.env.TZ ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  try {
    for (const timeZone of ["UTC", "Asia/Seoul", "Pacific/Kiritimati", "Pacific/Niue"]) {
      process.env.TZ = timeZone;
      assert.equal(dateCellText("2026-09-02"), "2026년 9월 2일 수요일", `${timeZone} 에서 어긋났다`);
    }
  } finally {
    process.env.TZ = original;
  }
});

test("🔴 병합 칸의 테두리를 가장자리 칸들에서 모은다", () => {
  const grid = buildSynthetic();

  // B2:C3 — 위는 B2 의 double, 왼쪽은 B2 의 thin(strict 판의 `start`).
  // 오른쪽·아래는 C2·C3·B3 에 칸이 없어 없다.
  assert.deepEqual(cellAt(grid, 2, 2).borders, {
    top: "double",
    right: null,
    bottom: null,
    left: "thin",
  });

  // D2 는 홀로 있는 칸 — strict 판의 `end`·`bottom` 을 그대로 읽는다.
  assert.deepEqual(cellAt(grid, 2, 4).borders, {
    top: null,
    right: "medium",
    bottom: "thin",
    left: null,
  });
});

test("맞춤·줄바꿈·글꼴은 서식에서 오고, 없으면 이름 있는 서식에서 물려받는다", () => {
  const grid = buildSynthetic();

  const styled = cellAt(grid, 2, 2);
  assert.equal(styled.align, "center");
  assert.equal(styled.wrap, true);
  assert.equal(styled.bold, true);
  assert.equal(styled.fontSizePt, 14);

  // s=0 은 `<alignment>` 가 없다 → cellStyleXfs 의 vertical="center" 를 물려받는다.
  const plain = cellAt(grid, 3, 4);
  assert.equal(plain.verticalAlign, "center");
  assert.equal(plain.align, null);
  assert.equal(plain.bold, false);
  assert.equal(plain.fontSizePt, 9);
});

test("서식을 못 읽어도 표는 나온다 — 값이 사라지지 않는다", () => {
  const grid = buildSheetPrintGrid({
    sheetName: SHEET_NAME,
    workbookXml: workbookXml("$B$2:$D$4"),
    sheetXml: SHEET_XML,
    sharedStringsXml: SHARED_STRINGS_XML,
    stylesXml: null,
    drawingXml: null,
    drawingRelsXml: null,
  });

  assert.equal(cellAt(grid, 2, 2).text, "비　고");
  assert.deepEqual(cellAt(grid, 2, 2).borders, { top: null, right: null, bottom: null, left: null });
  assert.equal(cellAt(grid, 2, 2).fontSizePt, null);
});

test("열 너비·행 높이·인쇄 설정을 양식에서 읽는다", () => {
  const grid = buildSynthetic();

  // width="10" → 규격 환산으로 80px = 60pt. 세 열이므로 180pt.
  assert.deepEqual(grid.columnWidthsPt, [60, 60, 60]);
  assert.equal(grid.widthPt, 180);
  // 2행은 ht="20", 3·4행은 defaultRowHeight="12".
  assert.deepEqual(
    grid.rows.map((row) => row.heightPt),
    [20, 12, 12]
  );
  assert.equal(grid.heightPt, 44);

  assert.equal(grid.page.paperSize, 9);
  assert.equal(grid.page.scale, 0.8);
  assert.equal(grid.page.orientation, "portrait");
  assert.deepEqual(grid.page.margins, { left: 1, right: 1, top: 1, bottom: 1 });
  assert.equal(grid.page.horizontallyCentered, true);
  assert.equal(grid.page.verticallyCentered, false);
});

test("숨긴 열은 너비가 0 이다 — 도우미 값이 문서에 나타나면 안 된다", () => {
  const grid = buildSynthetic("$D$2:$E$2");
  assert.deepEqual(grid.columnWidthsPt, [60, 0]);
});

// ── 실제 양식으로 ────────────────────────────────────────────────────────

const repairPath = process.env.REPAIR_REPORT_TEMPLATE_PATH;
const skipRepair = repairPath ? false : "REPAIR_REPORT_TEMPLATE_PATH 가 설정되지 않았습니다";

/** 🔴 지어낸 자료다 — 양식에 남아 있는 실제 발행본의 값과 섞이지 않게. */
const SAMPLE: ServiceReportInput = {
  kind: "REPAIR",
  customerName: "가나다 주식회사",
  issuedOn: new Date(Date.UTC(2026, 8, 2)),
  reportNumber: { prefix: "DSS", middle: "26", tail: "001" },
  customer: "가나다 공장",
  receivedOn: new Date(Date.UTC(2026, 7, 20)),
  modelName: "TEST-MODEL",
  lotNumber: "LN-1234",
  serialNumber: "SN12345",
  causes: ["PART_DEFECT"],
  remark: ["비고 첫 줄"],
  body: {
    findings: ["-외관 검사 실시", "-파라메타 확인"],
    actions: ["수리로써 이하의 작업을 실시하였습니다.", "• 휴즈 교환 : 8개"],
    summary: ["조치후, 이하의 항목을 확인하였습니다.", "• 정격출력 확인"],
  },
};

function filledGrid(input: ServiceReportInput = SAMPLE): {
  grid: SheetPrintGrid;
  archive: ZipArchive;
} {
  const workbook = fillServiceReportWorkbook(readFileSync(repairPath as string), input);
  return {
    grid: readSheetPrintGrid(workbook, SERVICE_REPORT_SHEET_NAME),
    archive: ZipArchive.fromBuffer(workbook),
  };
}

/** `A`=1 … `AA`=27. 시험이 셀 주소를 자리로 옮길 때 쓴다. */
function columnOf(letters: string): number {
  let value = 0;
  for (const letter of letters) value = value * 26 + (letter.charCodeAt(0) - 64);
  return value;
}

/**
 * 그 **주소를 덮고 있는 칸**의 글자. 양식의 날짜 칸은 전부 병합이라 왼쪽 위가
 * 라벨의 주소와 다를 수 있다 — `cellAt` 처럼 앵커를 정확히 맞히려 하면 병합 범위가
 * 한 칸 바뀌는 날 시험이 «값이 틀렸다»가 아니라 «칸이 없다»로 죽는다.
 */
function textCovering(grid: SheetPrintGrid, address: string): string {
  const parsed = /^([A-Z]+)(\d+)$/.exec(address);
  assert.ok(parsed, `셀 주소가 아닙니다: ${address}`);
  const column = columnOf(parsed[1]);
  const row = Number(parsed[2]);

  for (const gridRow of grid.rows) {
    for (const cell of gridRow.cells) {
      if (
        row >= cell.row &&
        row < cell.row + cell.rowSpan &&
        column >= cell.column &&
        column < cell.column + cell.colSpan
      ) {
        return cell.text;
      }
    }
  }
  assert.fail(`${address} 를 덮는 칸이 없습니다`);
}

/** 시험이 스스로 양식을 읽어 «인쇄 영역이 무엇인가» 를 따로 구한다. */
function printAreaFromWorkbook(archive: ZipArchive): {
  firstRow: number;
  lastRow: number;
  firstColumn: number;
  lastColumn: number;
} {
  const workbook = archive.readText(WORKBOOK_PART);
  const pattern = /<definedName[^>]*name="_xlnm\.Print_Area"[^>]*>([^<]*)<\/definedName>/g;

  for (const match of workbook.matchAll(pattern)) {
    if (!match[1].includes(SERVICE_REPORT_SHEET_NAME)) continue;
    const found = /\$([A-Z]+)\$(\d+):\$([A-Z]+)\$(\d+)/.exec(match[1]);
    assert.ok(found, "인쇄 영역을 읽지 못했습니다");
    const toNumber = (letters: string): number => {
      let value = 0;
      for (const letter of letters) value = value * 26 + (letter.charCodeAt(0) - 64);
      return value;
    };
    return {
      firstColumn: toNumber(found[1]),
      firstRow: Number(found[2]),
      lastColumn: toNumber(found[3]),
      lastRow: Number(found[4]),
    };
  }
  throw new Error("보고서 시트의 인쇄 영역을 찾지 못했습니다.");
}

test("🔴 실제 양식: 그리는 범위가 양식의 인쇄 영역과 같다", { skip: skipRepair }, () => {
  const { grid, archive } = filledGrid();
  // 🔴 기대값을 코드에 적지 않는다 — 양식에서 다시 읽어 견준다.
  assert.deepEqual(
    {
      firstRow: grid.firstRow,
      lastRow: grid.lastRow,
      firstColumn: grid.firstColumn,
      lastColumn: grid.lastColumn,
    },
    printAreaFromWorkbook(archive)
  );

  assert.equal(grid.columnWidthsPt.length, grid.lastColumn - grid.firstColumn + 1);
  assert.equal(grid.rows.length, grid.lastRow - grid.firstRow + 1);
  // 🔴 병합 221개짜리 양식이 표로 정확히 떨어지는가.
  assertCoversRangeExactly(grid);
});

test("🔴 실제 양식: 병합이 colspan/rowspan 으로 바뀐다", { skip: skipRepair }, () => {
  const { grid } = filledGrid();

  // `C13:G16` — 「고　객」 라벨 칸. C=3열, 5열 × 4행.
  const customerLabel = cellAt(grid, 13, 3);
  assert.equal(customerLabel.colSpan, 5);
  assert.equal(customerLabel.rowSpan, 4);
  assert.equal(customerLabel.text, "고　객");

  // `H32:AU32` — 본문 내용 칸. H=8열, 40열 × 1행.
  const bodyLine = cellAt(grid, 32, 8);
  assert.equal(bodyLine.colSpan, 40);
  assert.equal(bodyLine.rowSpan, 1);
});

test("🔴 실제 양식: 후리가나가 섞이지 않는다 — 「비　고」", { skip: skipRepair }, () => {
  const { grid } = filledGrid();

  const remarkLabel = cellAt(grid, 60, 3);
  assert.equal(remarkLabel.text, "비　고");
  // 「고　객」에도 `キャクサキ` 가 딸려 있다.
  assert.equal(cellAt(grid, 13, 3).text, "고　객");

  // 어느 칸에도 가타카나가 남으면 안 된다.
  for (const row of grid.rows) {
    for (const cell of row.cells) {
      assert.ok(
        !/[゠-ヿ]/.test(cell.text),
        `${cell.row}행 ${cell.column}열에 후리가나가 남았습니다: ${JSON.stringify(cell.text)}`
      );
    }
  }
});

test("🔴 실제 양식: 본문 세 구역이 채워진 자리에 그대로 나온다", { skip: skipRepair }, () => {
  const { grid } = filledGrid();

  // 채우개가 32·41·51행에 앉힌다(그 파일의 '세 구역은 각자 정해진 자리에서').
  assert.equal(cellAt(grid, 32, 3).text, SERVICE_REPORT_BODY_LABELS.findings[0]);
  assert.equal(cellAt(grid, 33, 3).text, SERVICE_REPORT_BODY_LABELS.findings[1]);
  assert.equal(cellAt(grid, 41, 3).text, SERVICE_REPORT_BODY_LABELS.actions[0]);
  assert.equal(cellAt(grid, 51, 3).text, SERVICE_REPORT_BODY_LABELS.summary[0]);

  assert.equal(cellAt(grid, 32, 8).text, SERVICE_REPORT_FINDINGS_INTRO);
  assert.equal(cellAt(grid, 33, 8).text, SAMPLE.body.findings[0]);
  assert.equal(cellAt(grid, 34, 8).text, SAMPLE.body.findings[1]);
  assert.equal(cellAt(grid, 41, 8).text, SAMPLE.body.actions[0]);
  assert.equal(cellAt(grid, 42, 8).text, SAMPLE.body.actions[1]);
  assert.equal(cellAt(grid, 51, 8).text, "조치후, 이하의 항목을 확인하였습니다.");
  assert.equal(cellAt(grid, 52, 8).text, "• 정격출력 확인");
});

test("🔴 실제 양식: 본문 상자의 오른쪽 변이 살아 있다", { skip: skipRepair }, () => {
  const { grid } = filledGrid();

  // 본문 내용 칸의 오른쪽 테두리는 **가려진 AU 칸**에 들어 있다. 왼쪽 위 칸의
  // 서식만 보면 상자의 오른쪽 변이 통째로 사라진다.
  const bodyLine = cellAt(grid, 32, 8);
  assert.ok(bodyLine.borders.left !== null, "본문 상자의 왼쪽 변이 없습니다");
  assert.ok(bodyLine.borders.right !== null, "본문 상자의 오른쪽 변이 없습니다");
});

test("🔴 실제 양식: 열 너비 환산이 양식의 그림 앵커와 맞는다", { skip: skipRepair }, () => {
  const { grid, archive } = filledGrid();

  const sheetPart = resolveSheetPart(archive, SERVICE_REPORT_SHEET_NAME);
  const drawingPart = resolveSheetDrawingPart(archive, sheetPart);
  assert.ok(drawingPart, "그림 파트를 찾지 못했습니다");
  const drawing = archive.readText(drawingPart);

  /**
   * 그림 앵커에는 «몇 열째 + 몇 EMU»(`<xdr:from>`)와 «절대 x»(`<a:off>`)가 함께
   * 적혀 있다. 두 그림의 차이를 빼면 그 사이 열들의 실제 너비(px)가 나온다 —
   * **양식 스스로가 알려 주는 값**이라 우리 환산식의 근거가 된다
   * (`MAX_DIGIT_WIDTH_PX` 주석).
   */
  const anchors: { column: number; columnOffsetEmu: number; xEmu: number }[] = [];
  for (const match of drawing.matchAll(
    /<xdr:twoCellAnchor\b[^>]*>([\s\S]*?)<\/xdr:twoCellAnchor>/g
  )) {
    const block = match[1];
    if (!block.includes("<xdr:pic>")) continue;
    const from = /<xdr:from>([\s\S]*?)<\/xdr:from>/.exec(block)?.[1];
    const x = /<a:off\b[^>]*\sx="(\d+)"/.exec(block)?.[1];
    if (from === undefined || x === undefined) continue;
    const column = /<xdr:col>(\d+)<\/xdr:col>/.exec(from)?.[1];
    if (column === undefined) continue;
    anchors.push({
      column: Number(column),
      columnOffsetEmu: Number(/<xdr:colOff>(\d+)<\/xdr:colOff>/.exec(from)?.[1] ?? "0"),
      xEmu: Number(x),
    });
  }

  // 인쇄 영역 안의 앵커만 쓴다 — 이 양식은 같은 도장을 숨은 도우미 열(68열)에도
  // 한 장 더 붙여 두었고, 그것은 표에 없다.
  const pair = anchors
    .filter((anchor) => anchor.column + 1 >= grid.firstColumn && anchor.column + 1 <= grid.lastColumn)
    .sort((a, b) => a.column - b.column);
  assert.ok(pair.length >= 2, "견줄 그림 앵커가 두 개 이상 있어야 합니다");
  const [left, right] = [pair[0], pair[pair.length - 1]];

  const EMU_PER_PIXEL = 9525;
  const measuredPx =
    (right.xEmu - right.columnOffsetEmu - (left.xEmu - left.columnOffsetEmu)) / EMU_PER_PIXEL;

  // 앵커의 열은 0부터 센다 — 1부터 세는 열 번호로 옮기면 `column + 1` 이다.
  // 그 사이 열들을 우리 표에서 더한다(표는 인쇄 영역만 담으므로 자리를 옮긴다).
  let ourPx = 0;
  for (let column = left.column + 1; column <= right.column; column += 1) {
    const index = column - grid.firstColumn;
    assert.ok(index >= 0 && index < grid.columnWidthsPt.length, "그림이 인쇄 영역 밖입니다");
    ourPx += grid.columnWidthsPt[index] / 0.75;
  }

  assert.equal(ourPx, measuredPx);
});

test("🔴 실제 양식: 그림은 도장 둘뿐이고 ActiveX 의 EMF 는 안 딸려 온다", { skip: skipRepair }, () => {
  const { grid } = filledGrid();

  assert.ok(grid.pictures.length > 0, "도장을 하나도 못 찾았습니다");
  for (const picture of grid.pictures) {
    assert.ok(
      /\.(png|jpe?g|gif)$/i.test(picture.name),
      `브라우저가 못 읽는 그림이 딸려 왔습니다: ${picture.name}`
    );
    // 인쇄 영역 안에 앉아 있어야 한다 — 숨은 도우미 열의 사본은 걸러진다.
    assert.ok(picture.leftPt >= 0 && picture.leftPt < grid.widthPt, `${picture.name} 의 가로 자리가 밖입니다`);
    assert.ok(picture.topPt >= 0 && picture.topPt < grid.heightPt, `${picture.name} 의 세로 자리가 밖입니다`);
    assert.ok(picture.widthPt > 0 && picture.heightPt > 0, `${picture.name} 의 크기가 0 입니다`);
  }
});

/**
 * 🔴 **날짜 칸 넷이 전부 요일까지 붙는다.**
 *
 * 양식의 `AO8`(발행) · `AK14`(접수) · `AF27`(현품 인수) · `AF28`(조치 완료)은
 * **같은 서식**(`[$-F800]` 시스템 긴 날짜)을 쓴다. 사용자가 짚은 것은 접수 하나
 * 였지만 넷이 같은 서식이므로 하나만 다르면 그것이 더 이상하다 — 그래서 넷을 다
 * 본다.
 *
 * 자리를 코드에 적는 대신 **채우개가 쓰는 주소표(`SERVICE_REPORT_CELLS`)에서
 * 가져온다.** 양식이 바뀌어 칸이 옮겨 가면 채우개와 이 시험이 함께 따라간다.
 */
test("🔴 실제 양식: 날짜 칸 넷이 전부 요일까지 그려진다", { skip: skipRepair }, () => {
  const { grid } = filledGrid({
    ...SAMPLE,
    disposition: {
      onSiteRepair: false,
      replacementDelivery: false,
      goodsReceipt: { on: new Date(Date.UTC(2026, 7, 21)), number: "IN-001" },
      completion: { on: new Date(Date.UTC(2026, 8, 1)) },
    },
  });

  assert.equal(textCovering(grid, SERVICE_REPORT_CELLS.issuedOn), "2026년 9월 2일 수요일");
  assert.equal(textCovering(grid, SERVICE_REPORT_CELLS.receivedOn), "2026년 8월 20일 목요일");
  assert.equal(textCovering(grid, SERVICE_REPORT_CELLS.goodsReceivedOn), "2026년 8월 21일 금요일");
  assert.equal(textCovering(grid, SERVICE_REPORT_CELLS.completedOn), "2026년 9월 1일 화요일");
});

test("🔴 실제 양식: 인쇄 설정이 양식 그대로다", { skip: skipRepair }, () => {
  const { grid, archive } = filledGrid();

  const sheet = archive.readText(resolveSheetPart(archive, SERVICE_REPORT_SHEET_NAME));
  const setup = /<pageSetup\b[^>]*\/?>/.exec(sheet)?.[0] ?? "";
  const margins = /<pageMargins\b[^>]*\/?>/.exec(sheet)?.[0] ?? "";

  assert.equal(grid.page.scale, Number(/\sscale="(\d+)"/.exec(setup)?.[1]) / 100);
  assert.equal(grid.page.paperSize, Number(/\spaperSize="(\d+)"/.exec(setup)?.[1]));
  assert.equal(grid.page.orientation, "portrait");
  assert.equal(grid.page.margins.left, Number(/\sleft="([\d.]+)"/.exec(margins)?.[1]));
  assert.equal(grid.page.margins.bottom, Number(/\sbottom="([\d.]+)"/.exec(margins)?.[1]));
  assert.equal(grid.page.horizontallyCentered, true);
});

// ── 사람이 손으로 만든 견적서 엑셀 (견적서 ②a) — 양식 없이 ────────────────────

/**
 * 사람이 Excel 에서 만든 견적서를 본뜬 시트. 금액 칸에 숫자 서식, 발행일자 칸에
 * 날짜 서식, 머리글에 색이 걸려 있다. 🔴 **인쇄 영역이 없다** — 사람이 만든 파일은
 * 그럴 수 있다. 서식 코드 둘은 이 저장소 견적서 양식의 것을 그대로 옮겼다(실측).
 */
const HANDMADE_WORKBOOK_XML =
  '<?xml version="1.0"?><workbook><workbookPr/>' +
  `<sheets><sheet name="${SHEET_NAME}" sheetId="1" r:id="rId1"/></sheets></workbook>`;

const HANDMADE_SHEET_XML =
  '<?xml version="1.0"?><worksheet>' +
  '<dimension ref="A1:C4"/>' +
  "<sheetData>" +
  '<row r="1"><c r="A1" s="1" t="inlineStr"><is><t>견 적 서</t></is></c>' +
  '<c r="B1" s="4" t="inlineStr"><is><t>가나다</t></is></c></row>' +
  '<row r="2"><c r="A2" s="2"><v>46262</v></c><c r="B2" s="5"><v>46262</v></c></row>' +
  '<row r="3"><c r="A3" s="3"><v>3500000</v></c><c r="B3" s="6"><v>3500000</v></c>' +
  '<c r="C3" s="3"><f>B3</f></c></row>' +
  '<row r="4"><c r="A4" s="7"><v>1234.5</v></c><c r="B4" s="0"><v>0.30000000000000004</v></c>' +
  '<c r="C4"><v>2019</v></c></row>' +
  "</sheetData></worksheet>";

/**
 * 서식 번호(`s`)가 가리키는 것:
 *   0 General · 1 머리글(rgb 글자 · 노란 배경) · 2 기본 제공 14(날짜) ·
 *   3 기본 제공 3(`#,##0`) + 테마 배경 · 4 글자 구역(`@" 귀하"`) + 틴트 글자 + 무늬 채움 ·
 *   5 견적서 발행일자 서식 · 6 견적서 금액 서식 · 7 기본 제공 4(`#,##0.00`)
 */
const HANDMADE_STYLES_XML =
  '<?xml version="1.0"?><styleSheet>' +
  '<numFmts count="3">' +
  '<numFmt numFmtId="176" formatCode="&quot;₩&quot;#,##0_);\\(&quot;₩&quot;#,##0\\)"/>' +
  '<numFmt numFmtId="177" formatCode="yyyy&quot;년&quot;\\ m&quot;월&quot;\\ d&quot;일&quot;;@"/>' +
  '<numFmt numFmtId="178" formatCode="@&quot; 귀하&quot;"/>' +
  "</numFmts>" +
  '<fonts count="3">' +
  '<font><sz val="11"/><color theme="1"/><name val="맑은 고딕"/></font>' +
  '<font><b/><sz val="20"/><color rgb="FF1F4E79"/><name val="맑은 고딕"/></font>' +
  '<font><sz val="11"/><color rgb="FFFF0000" tint="0.39997558519241921"/><name val="맑은 고딕"/></font>' +
  "</fonts>" +
  '<fills count="5">' +
  '<fill><patternFill patternType="none"/></fill>' +
  '<fill><patternFill patternType="gray125"/></fill>' +
  '<fill><patternFill patternType="solid"><fgColor rgb="FFFFFF00"/><bgColor indexed="64"/></patternFill></fill>' +
  '<fill><patternFill patternType="solid"><fgColor theme="4" tint="0.79998168889431442"/><bgColor indexed="64"/></patternFill></fill>' +
  '<fill><patternFill patternType="lightGray"><fgColor rgb="FF00FF00"/></patternFill></fill>' +
  "</fills>" +
  '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
  '<cellXfs count="8">' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>' +
  '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" applyFont="1" applyFill="1"/>' +
  '<xf numFmtId="14" fontId="0" fillId="0" borderId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="3" fontId="0" fillId="3" borderId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="178" fontId="2" fillId="4" borderId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="177" fontId="0" fillId="0" borderId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="176" fontId="0" fillId="0" borderId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="4" fontId="0" fillId="0" borderId="0" applyNumberFormat="1"/>' +
  "</cellXfs></styleSheet>";

function handmadeParts(overrides: Partial<SheetPrintGridParts> = {}): SheetPrintGridParts {
  return {
    sheetName: SHEET_NAME,
    workbookXml: HANDMADE_WORKBOOK_XML,
    sheetXml: HANDMADE_SHEET_XML,
    sharedStringsXml: null,
    stylesXml: HANDMADE_STYLES_XML,
    drawingXml: null,
    drawingRelsXml: null,
    ...overrides,
  };
}

const USED_RANGE = { printArea: "fallback-to-used-range" } as const;

function rangeOf(grid: SheetPrintGrid): { firstRow: number; lastRow: number; firstColumn: number; lastColumn: number } {
  return {
    firstRow: grid.firstRow,
    lastRow: grid.lastRow,
    firstColumn: grid.firstColumn,
    lastColumn: grid.lastColumn,
  };
}

/**
 * 🔴 **인자가 없으면 예전과 똑같이 던진다.** 보고서 쪽 판단(인쇄 영역이 없는 양식은
 * 그리지 않는다)이 그대로 살아 있는지를 본다 — 보고서 호출부는 인자를 주지 않는다.
 */
test("🔴 인쇄 영역이 없으면 — 인자가 없으면 예전처럼 던지고, 인자를 주면 쓰인 범위로 그린다", () => {
  assert.throws(() => buildSheetPrintGrid(handmadeParts()), {
    name: "Error",
    message: `양식의 "${SHEET_NAME}" 시트에 인쇄 영역이 없습니다.`,
  });
  assert.throws(() => buildSheetPrintGrid(handmadeParts()), SheetPrintGridError);
  assert.throws(() => buildSheetPrintGrid(handmadeParts(), { printArea: "required" }), SheetPrintGridError);

  const grid = buildSheetPrintGrid(handmadeParts(), USED_RANGE);
  assert.deepEqual(rangeOf(grid), { firstRow: 1, lastRow: 4, firstColumn: 1, lastColumn: 3 });
  assertCoversRangeExactly(grid);
});

test("쓰인 범위 — `<dimension>` 이 없으면 실제 칸과 병합으로 모은다", () => {
  const sheetXml = HANDMADE_SHEET_XML.replace('<dimension ref="A1:C4"/>', "").replace(
    "</sheetData>",
    '</sheetData><mergeCells count="1"><mergeCell ref="B5:D6"/></mergeCells>'
  );
  const grid = buildSheetPrintGrid(handmadeParts({ sheetXml }), USED_RANGE);
  assert.deepEqual(rangeOf(grid), { firstRow: 1, lastRow: 6, firstColumn: 1, lastColumn: 4 });
  assertCoversRangeExactly(grid);

  // 칸도 병합도 없으면 그릴 것이 없다 — 짐작하지 않고 던진다.
  const empty = '<?xml version="1.0"?><worksheet><sheetData></sheetData></worksheet>';
  assert.throws(() => buildSheetPrintGrid(handmadeParts({ sheetXml: empty }), USED_RANGE), SheetPrintGridError);
});

test("🔴 인쇄 영역이 있으면 인자와 상관없이 인쇄 영역을 그린다 — 못 읽으면 인자를 줘도 던진다", () => {
  const grid = buildSheetPrintGrid(handmadeParts({ workbookXml: workbookXml("$A$2:$B$3") }), USED_RANGE);
  assert.deepEqual(rangeOf(grid), { firstRow: 2, lastRow: 3, firstColumn: 1, lastColumn: 2 });

  assert.throws(
    () => buildSheetPrintGrid(handmadeParts({ workbookXml: workbookXml("#REF!") }), USED_RANGE),
    SheetPrintGridError
  );
});

test("숫자 서식 — 금액 · 날짜 · 기본 제공 번호 · General · 글자 구역", () => {
  const grid = buildSheetPrintGrid(handmadeParts(), USED_RANGE);

  assert.equal(cellAt(grid, 2, 1).text, "2026-08-28", "기본 제공 14(날짜)");
  assert.equal(cellAt(grid, 2, 2).text, "2026년 8월 28일", "견적서 발행일자 서식");
  assert.equal(cellAt(grid, 3, 1).text, "3,500,000", "기본 제공 3(#,##0)");
  // `_)` 는 괄호 폭의 빈자리 — 공백 한 칸이다.
  assert.equal(cellAt(grid, 3, 2).text, "₩3,500,000 ", "견적서 금액 서식");
  assert.equal(cellAt(grid, 4, 1).text, "1,234.50", "기본 제공 4(#,##0.00)");
  assert.equal(cellAt(grid, 4, 2).text, "0.3", "General — 찌꺼기만 걷는다");
  assert.equal(cellAt(grid, 4, 3).text, "2019", "서식 번호가 없는 칸");
  assert.equal(cellAt(grid, 1, 2).text, "가나다 귀하", "글자 구역");
  // 🔴 계산값(`<v>`)이 없는 수식 칸은 빈칸이다 — 짐작해서 셈하지 않는다.
  assert.equal(cellAt(grid, 3, 3).text, "");
});

test("🔴 모르는 숫자 서식은 날 값 그대로다 — 던지지 않는다", () => {
  const stylesXml = HANDMADE_STYLES_XML.replace(
    /numFmtId="176" formatCode="[^"]*"/,
    'numFmtId="176" formatCode="0.00E+00"'
  ).replace('<xf numFmtId="4" ', '<xf numFmtId="11" ');
  const grid = buildSheetPrintGrid(handmadeParts({ stylesXml }), USED_RANGE);

  assert.equal(cellAt(grid, 3, 2).text, "3500000", "모르는 사용자 서식(지수)");
  assert.equal(cellAt(grid, 4, 1).text, "1234.5", "모르는 기본 제공 번호(11)");
  // 다른 칸은 멀쩡하다.
  assert.equal(cellAt(grid, 3, 1).text, "3,500,000");
});

test("🔴 1904 날짜 체계를 통합문서에서 읽는다 — 안 읽으면 4년 어긋난다", () => {
  const workbook1904 = HANDMADE_WORKBOOK_XML.replace("<workbookPr/>", '<workbookPr date1904="1"/>');
  const grid = buildSheetPrintGrid(handmadeParts({ workbookXml: workbook1904 }), USED_RANGE);
  // 같은 번호가 1904 체계에서는 1462 일 뒤다.
  assert.equal(cellAt(grid, 2, 1).text, "2030-08-29");
  assert.equal(cellAt(grid, 2, 2).text, "2030년 8월 29일");
});

test("글자 색 · 칸 배경 — rgb 로 적힌 것만, 모르는 색은 null", () => {
  const grid = buildSheetPrintGrid(handmadeParts(), USED_RANGE);

  const header = cellAt(grid, 1, 1);
  assert.equal(header.fontColor, "#1F4E79");
  assert.equal(header.backgroundColor, "#FFFF00");

  // 테마 색 글자(s=0) · 테마 배경(s=3) — 모른다.
  assert.equal(cellAt(grid, 4, 2).fontColor, null);
  assert.equal(cellAt(grid, 3, 1).backgroundColor, null);
  // 틴트가 걸린 rgb 글자 · 무늬 채움(s=4) — 모른다.
  assert.equal(cellAt(grid, 1, 2).fontColor, null);
  assert.equal(cellAt(grid, 1, 2).backgroundColor, null);
  // 서식 번호가 없는 칸 · 시트에 없는 칸.
  assert.equal(cellAt(grid, 4, 3).fontColor, null);
  assert.equal(cellAt(grid, 1, 3).backgroundColor, null);

  // 서식 파일이 없으면 색도 서식도 없다 — 숫자는 날 값 그대로(밋밋하게 넘어간다).
  const plain = buildSheetPrintGrid(handmadeParts({ stylesXml: null }), USED_RANGE);
  assert.equal(cellAt(plain, 1, 1).fontColor, null);
  assert.equal(cellAt(plain, 1, 1).backgroundColor, null);
  assert.equal(cellAt(plain, 3, 2).text, "3500000");
});

// ── 실제 견적서 양식으로 (견적서 ②a) ─────────────────────────────────────────

const generatorQuotePath = process.env.QUOTE_TEMPLATE_PATH;
const skipGeneratorQuote = generatorQuotePath ? false : "QUOTE_TEMPLATE_PATH 가 설정되지 않았습니다";
const matcherQuotePath = process.env.MATCHER_QUOTE_TEMPLATE_PATH;
const skipMatcherQuote = matcherQuotePath ? false : "MATCHER_QUOTE_TEMPLATE_PATH 가 설정되지 않았습니다";

/** 🔴 지어낸 자료다 — 양식에 남은 실제 발행본의 값과 섞이지 않게. */
const GENERATOR_QUOTE: GeneratorQuoteInput = {
  quoteNumber: "DSS 2026-077",
  quoteDate: new Date(2026, 7, 28),
  customerName: "시험 고객사",
  subject: "시험 품명 수리 견적",
  modelName: "TEST-MODEL",
  serialNumber: "SN0001",
  lotNumber: "LN0001",
  parts: [
    { name: "부품 1", quantity: 1, unitPrice: 10_000 },
    { name: "부품 2", quantity: 2, unitPrice: 1_234_500 },
  ],
  workCost: 1_200_000,
};

const MATCHER_QUOTE: MatcherQuoteInput = {
  quoteNumber: "DSS 2026-999",
  quoteDate: new Date(2026, 7, 31),
  customerName: "시험 고객사",
  subject: "시험 품명 수리 件",
  parts: [{ name: "부품 1", quantity: 1, unitPrice: 2_050_000 }],
  workCost: 3_500_000,
  workScope: { INVESTIGATION: ["조사"], REPAIR: ["수리"], POWER_TEST: ["통전"] },
};

/** 채운 통합문서의 부품들 — 시험이 시트 XML 을 손봐 다시 그릴 수 있게. */
function workbookParts(workbook: Buffer, sheetName: string): SheetPrintGridParts {
  const archive = ZipArchive.fromBuffer(workbook);
  return {
    sheetName,
    workbookXml: archive.readText(WORKBOOK_PART),
    sheetXml: archive.readText(resolveSheetPart(archive, sheetName)),
    sharedStringsXml: archive.readTextOrNull(SHARED_STRINGS_PART),
    stylesXml: archive.readTextOrNull(STYLES_PART),
    drawingXml: null,
    drawingRelsXml: null,
  };
}

/**
 * 🔴 수식 칸에 **계산값을 넣는다** — Excel 이 저장한 파일을 흉내 낸다.
 *
 * 채우개가 만든 파일은 `fullCalcOnLoad` 라 수식의 계산값(`<v>`)이 없다(Excel 이 열 때
 * 다시 셈한다). 사람이 Excel 에서 저장한 견적서에는 있다 — 미리보기가 그리는 것은
 * 그쪽이다. 수식(`<f>`)은 그대로 두고 그 뒤에 `<v>` 만 붙인다(`<f>` 가 앞이 규격).
 */
function withCachedValue(sheetXml: string, ref: string, value: number): string {
  const found = new RegExp(`<c r="${ref}"([^>]*?)(?:/>|>([\\s\\S]*?)</c>)`).exec(sheetXml);
  assert.ok(found, `${ref} 칸이 없습니다`);
  const attributes = found[1].replace(/\st="[^"]*"/, "");
  const inner = (found[2] ?? "").replace(/<v>[\s\S]*?<\/v>/, "");
  return sheetXml.replace(found[0], `<c r="${ref}"${attributes}>${inner}<v>${value}</v></c>`);
}

function gridTexts(grid: SheetPrintGrid): string[] {
  return grid.rows.flatMap((row) => row.cells.map((cell) => cell.text));
}

test("🔴 실제 견적서(제너레이터 내자): 금액 칸은 콤마 서식으로, 발행일자는 날짜로 나온다", { skip: skipGeneratorQuote }, () => {
  const workbook = fillQuoteWorkbook(readFileSync(generatorQuotePath as string), GENERATOR_QUOTE);

  // 채운 파일을 그대로 — 발행일자와 단가는 채우개가 **값**으로 넣으므로 계산값이 필요 없다.
  const direct = readSheetPrintGrid(workbook, QUOTE_SHEET_NAME);
  assert.equal(textCovering(direct, QUOTE_CELLS.quoteDate), "2026년 8월 28일");
  const texts = gridTexts(direct);
  assert.ok(texts.some((text) => text.includes("1,234,500")), "단가가 콤마 서식으로 안 나왔습니다");
  assert.ok(!texts.includes("46262"), "발행일자가 일련번호로 나왔습니다");
  assert.ok(!texts.includes("1234500"), "단가가 날 값으로 나왔습니다");

  // 금액 칸은 수식이다 — Excel 이 저장한 것처럼 계산값을 넣은 입력으로.
  const parts = workbookParts(workbook, QUOTE_SHEET_NAME);
  const grid = buildSheetPrintGrid({
    ...parts,
    sheetXml: withCachedValue(parts.sheetXml, QUOTE_CELLS.amount, 3_500_000),
  });
  const amount = textCovering(grid, QUOTE_CELLS.amount);
  assert.match(amount, /3,500,000/);
  assert.ok(!amount.includes("3500000"), `금액이 날 값으로 나왔습니다: ${JSON.stringify(amount)}`);
  // 계산값을 안 넣으면 빈칸이다 — 짐작해서 셈하지 않는다.
  assert.equal(textCovering(direct, QUOTE_CELLS.amount), "");
});

test("🔴 실제 견적서(매쳐 내자): 금액 칸은 콤마 서식으로, 발행일자는 날짜로 나온다", { skip: skipMatcherQuote }, () => {
  const workbook = fillMatcherQuoteWorkbook(readFileSync(matcherQuotePath as string), MATCHER_QUOTE);

  const direct = readSheetPrintGrid(workbook, MATCHER_QUOTE_SHEET_NAME);
  assert.equal(textCovering(direct, MATCHER_QUOTE_CELLS.quoteDate), "2026년 8월 31일");
  const texts = gridTexts(direct);
  assert.ok(texts.some((text) => text.includes("2,050,000")), "단가가 콤마 서식으로 안 나왔습니다");
  assert.ok(!texts.includes("46265"), "발행일자가 일련번호로 나왔습니다");

  const parts = workbookParts(workbook, MATCHER_QUOTE_SHEET_NAME);
  const grid = buildSheetPrintGrid({
    ...parts,
    sheetXml: withCachedValue(parts.sheetXml, MATCHER_QUOTE_CELLS.amount, 5_550_000),
  });
  const amount = textCovering(grid, MATCHER_QUOTE_CELLS.amount);
  assert.match(amount, /5,550,000/);
  assert.ok(!amount.includes("5550000"), `금액이 날 값으로 나왔습니다: ${JSON.stringify(amount)}`);
});

test("🔴 실제 견적서: 인쇄 영역을 지운 파일 — 인자가 없으면 던지고, 인자를 주면 쓰인 범위로 그린다", { skip: skipGeneratorQuote }, () => {
  const workbook = fillQuoteWorkbook(readFileSync(generatorQuotePath as string), GENERATOR_QUOTE);
  const parts = workbookParts(workbook, QUOTE_SHEET_NAME);
  const printArea = buildSheetPrintGrid(parts);

  const withoutPrintArea = {
    ...parts,
    workbookXml: parts.workbookXml.replace(
      /<definedName[^>]*name="_xlnm\.Print_Area"[^>]*>[^<]*<\/definedName>/g,
      ""
    ),
  };
  assert.throws(() => buildSheetPrintGrid(withoutPrintArea), SheetPrintGridError);

  const grid = buildSheetPrintGrid(withoutPrintArea, USED_RANGE);
  assertCoversRangeExactly(grid);
  // 쓰인 범위는 인쇄 영역을 품는다 — 문서의 어느 칸도 잘려 나가지 않는다.
  assert.ok(grid.firstRow <= printArea.firstRow && grid.lastRow >= printArea.lastRow, "쓰인 범위가 문서의 행을 자릅니다");
  assert.ok(
    grid.firstColumn <= printArea.firstColumn && grid.lastColumn >= printArea.lastColumn,
    "쓰인 범위가 문서의 열을 자릅니다"
  );
  // `<dimension>` 이 있으면 그것이 곧 쓰인 범위다 — 시험이 스스로 읽어 견준다.
  const dimension = /<dimension\b[^>]*\sref="([A-Z]+)(\d+):([A-Z]+)(\d+)"/.exec(parts.sheetXml);
  if (dimension) {
    assert.deepEqual(rangeOf(grid), {
      firstRow: Number(dimension[2]),
      lastRow: Number(dimension[4]),
      firstColumn: columnOf(dimension[1]),
      lastColumn: columnOf(dimension[3]),
    });
  }
  assert.equal(textCovering(grid, QUOTE_CELLS.quoteDate), "2026년 8월 28일");
});

// ── 조건부 서식 · 값의 종류 (견적서 ②b 재작업, 2026-09-16) ─────────────────────

/** 테마 — lt1 흰색 · dk1 검정(시스템 색), 나머지는 Office 기본. */
const CF_THEME_XML =
  '<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="시험"><a:themeElements><a:clrScheme name="시험">' +
  '<a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>' +
  '<a:dk2><a:srgbClr val="1F497D"/></a:dk2><a:lt2><a:srgbClr val="EEECE1"/></a:lt2>' +
  '<a:accent1><a:srgbClr val="4F81BD"/></a:accent1><a:accent2><a:srgbClr val="C0504D"/></a:accent2>' +
  '<a:accent3><a:srgbClr val="9BBB59"/></a:accent3><a:accent4><a:srgbClr val="8064A2"/></a:accent4>' +
  '<a:accent5><a:srgbClr val="4BACC6"/></a:accent5><a:accent6><a:srgbClr val="F79646"/></a:accent6>' +
  '<a:hlink><a:srgbClr val="0000FF"/></a:hlink><a:folHlink><a:srgbClr val="800080"/></a:folHlink>' +
  "</a:clrScheme></a:themeElements></a:theme>";

/**
 * 서식 번호(`s`): 0 General · 1 견적서 금액 서식(`"₩"#,##0;[Red]"₩"#,##0`) · 2 글자(`@`).
 * 조건부 서식의 서식(dxf): 0 테마 0(흰) 글자 · 1 빨간 배경(rgb) · 2 색 번호 41 배경 · 3 rgb+틴트
 * 글자 · 4 테마 1(검정) 글자 · 5 테마 0 + 틴트 -0.5 글자.
 */
const CF_STYLES_XML =
  '<?xml version="1.0"?><styleSheet>' +
  '<numFmts count="1"><numFmt numFmtId="176" formatCode="&quot;₩&quot;#,##0;[Red]&quot;₩&quot;#,##0"/></numFmts>' +
  '<fonts count="1"><font><sz val="10"/></font></fonts>' +
  '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
  '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
  '<cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>' +
  '<xf numFmtId="176" fontId="0" fillId="0" borderId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="49" fontId="0" fillId="0" borderId="0" applyNumberFormat="1"/></cellXfs>' +
  '<dxfs count="6">' +
  '<dxf><font><color theme="0"/></font></dxf>' +
  '<dxf><fill><patternFill><bgColor rgb="FFFF0000"/></patternFill></fill></dxf>' +
  '<dxf><fill><patternFill><bgColor indexed="41"/></patternFill></fill></dxf>' +
  '<dxf><font><color rgb="FFFF0000" tint="0.5"/></font></dxf>' +
  '<dxf><font><color theme="1"/></font></dxf>' +
  '<dxf><font><color theme="0" tint="-0.5"/></font></dxf>' +
  "</dxfs></styleSheet>";

const CF_SHEET_XML =
  '<?xml version="1.0"?><worksheet>' +
  '<dimension ref="A1:C4"/>' +
  "<sheetData>" +
  '<row r="1"><c r="A1" s="1"><v>0</v></c><c r="B1"/><c r="C1" t="inlineStr"><is><t>가</t></is></c></row>' +
  '<row r="2"><c r="A2" s="1"><v>5</v></c><c r="B2" t="inlineStr"><is><t>값</t></is></c><c r="C2" s="2"><v>7</v></c></row>' +
  '<row r="3"><c r="A3" t="b"><v>1</v></c><c r="B3" t="e"><v>#DIV/0!</v></c><c r="C3" t="d"><v>2026-09-02</v></c></row>' +
  '<row r="4"><c r="A4" s="1"><v>0</v></c><c r="B4"><v>2</v></c><c r="C4" t="inlineStr"><is><t xml:space="preserve">  </t></is></c></row>' +
  "</sheetData>" +
  // 0 이면 흰 글자 — 빈 칸(B1)도 0 으로 읽힌다.
  '<conditionalFormatting sqref="A1:A2 B1"><cfRule type="cellIs" dxfId="0" priority="3" operator="equal"><formula>0</formula></cfRule></conditionalFormatting>' +
  // 사이 — 두 값의 순서를 가리지 않는다.
  '<conditionalFormatting sqref="A2"><cfRule type="cellIs" dxfId="1" priority="4" operator="between"><formula>10</formula><formula>1</formula></cfRule></conditionalFormatting>' +
  // 공백 포함 — 빈 칸과 공백뿐인 글자.
  '<conditionalFormatting sqref="B1:B2 C4"><cfRule type="containsBlanks" dxfId="2" priority="5"><formula>LEN(TRIM(B1))=0</formula></cfRule></conditionalFormatting>' +
  // 따옴표 글자와 같음 — rgb + 틴트.
  '<conditionalFormatting sqref="B2"><cfRule type="cellIs" dxfId="3" priority="6" operator="equal"><formula>"값"</formula></cfRule></conditionalFormatting>' +
  // 우선순위와 stopIfTrue — 1 번이 맞으면 2 번(빨간 배경)은 안 본다.
  '<conditionalFormatting sqref="A4"><cfRule type="cellIs" dxfId="4" priority="1" stopIfTrue="1" operator="lessThan"><formula>1</formula></cfRule>' +
  '<cfRule type="cellIs" dxfId="1" priority="2" operator="equal"><formula>0</formula></cfRule></conditionalFormatting>' +
  // 수식 규칙 · 칸 참조 비교는 모른다 — 셋째만 맞는다.
  '<conditionalFormatting sqref="B4"><cfRule type="expression" dxfId="1" priority="7"><formula>B4&gt;1</formula></cfRule>' +
  '<cfRule type="cellIs" dxfId="1" priority="8" operator="greaterThan"><formula>A4</formula></cfRule>' +
  '<cfRule type="cellIs" dxfId="5" priority="9" operator="greaterThanOrEqual"><formula>2</formula></cfRule></conditionalFormatting>' +
  // Excel 의 값 순서 — 글자는 어떤 수보다 크다.
  '<conditionalFormatting sqref="C1"><cfRule type="cellIs" dxfId="1" priority="10" operator="greaterThan"><formula>100</formula></cfRule></conditionalFormatting>' +
  // ISO 날짜 칸은 견주지 않는다.
  '<conditionalFormatting sqref="C3"><cfRule type="cellIs" dxfId="1" priority="11" operator="notEqual"><formula>0</formula></cfRule></conditionalFormatting>' +
  "</worksheet>";

function conditionalParts(overrides: Partial<SheetPrintGridParts> = {}): SheetPrintGridParts {
  return {
    sheetName: SHEET_NAME,
    workbookXml: HANDMADE_WORKBOOK_XML,
    sheetXml: CF_SHEET_XML,
    sharedStringsXml: null,
    stylesXml: CF_STYLES_XML,
    drawingXml: null,
    drawingRelsXml: null,
    themeXml: CF_THEME_XML,
    ...overrides,
  };
}

const APPLY_CF = { printArea: "fallback-to-used-range", conditionalFormatting: "apply" } as const;

function colorsOf(grid: SheetPrintGrid, row: number, column: number): { fontColor: string | null; backgroundColor: string | null } {
  const found = cellAt(grid, row, column);
  return { fontColor: found.fontColor, backgroundColor: found.backgroundColor };
}

test("🔴 조건부 서식 — 인자가 없으면 예전처럼 안 읽는다(보고서 호출부가 이 길이다)", () => {
  const grid = buildSheetPrintGrid(conditionalParts(), USED_RANGE);
  for (const row of grid.rows) {
    for (const found of row.cells) {
      assert.equal(found.fontColor, null, `${found.row}:${found.column}`);
      assert.equal(found.backgroundColor, null, `${found.row}:${found.column}`);
    }
  }
});

test("🔴 조건부 서식 — 0 이면 흰 글자(테마 0 = lt1) · 빈 칸은 0 으로 읽힌다 · 글자는 그대로 둔다", () => {
  const grid = buildSheetPrintGrid(conditionalParts(), APPLY_CF);
  assert.deepEqual(colorsOf(grid, 1, 1), { fontColor: "#FFFFFF", backgroundColor: null });
  assert.equal(cellAt(grid, 1, 1).text, "₩0", "글자를 지우지 않고 색으로 감춘다 — Excel 과 같다");
  assert.equal(colorsOf(grid, 1, 2).fontColor, "#FFFFFF", "빈 칸은 「0 과 같음」에 걸린다(Excel 규칙)");
  assert.equal(colorsOf(grid, 2, 1).fontColor, null, "5 는 0 이 아니다");
});

test("조건부 서식 — 사이 · 공백 포함 · 따옴표 글자 · 색 번호 · 틴트", () => {
  const grid = buildSheetPrintGrid(conditionalParts(), APPLY_CF);
  assert.equal(colorsOf(grid, 2, 1).backgroundColor, "#FF0000", "5 는 10 과 1 사이(순서를 가리지 않는다)");
  assert.equal(colorsOf(grid, 1, 2).backgroundColor, "#CCFFFF", "빈 칸 — 색 번호 41");
  assert.equal(colorsOf(grid, 4, 3).backgroundColor, "#CCFFFF", "공백뿐인 글자도 빈 칸이다");
  assert.deepEqual(colorsOf(grid, 2, 2), { fontColor: "#FF8080", backgroundColor: null }, "「값」과 같음 — 빨강에 틴트 0.5");
});

test("조건부 서식 — 우선순위 · stopIfTrue · 모르는 규칙 · 값의 순서 · 날짜 칸", () => {
  const grid = buildSheetPrintGrid(conditionalParts(), APPLY_CF);
  assert.deepEqual(colorsOf(grid, 4, 1), { fontColor: "#000000", backgroundColor: null }, "stopIfTrue 뒤의 빨간 배경이 안 걸린다");
  assert.deepEqual(colorsOf(grid, 4, 2), { fontColor: "#808080", backgroundColor: null }, "수식 · 칸 참조 규칙은 건너뛰고 셋째만");
  assert.equal(colorsOf(grid, 1, 3).backgroundColor, "#FF0000", "글자는 어떤 수보다 크다");
  assert.deepEqual(colorsOf(grid, 3, 3), { fontColor: null, backgroundColor: null }, "ISO 날짜 칸은 견주지 않는다");
});

test("조건부 서식 — 테마가 없으면 테마 색은 모르는 색(null), rgb 는 그대로", () => {
  const grid = buildSheetPrintGrid(conditionalParts({ themeXml: null }), APPLY_CF);
  assert.equal(colorsOf(grid, 1, 1).fontColor, null);
  assert.equal(colorsOf(grid, 2, 1).backgroundColor, "#FF0000");
});

test("🔴 값의 종류 — 수 · 날짜는 수, 서식이 @ 면 글자, 참/거짓 · 오류, 빈 칸은 null", () => {
  const grid = buildSheetPrintGrid(conditionalParts(), USED_RANGE);
  const kind = (row: number, column: number) => cellAt(grid, row, column).valueKind;
  assert.equal(kind(1, 1), "number");
  assert.equal(kind(1, 2), null, "빈 칸");
  assert.equal(kind(1, 3), "text");
  assert.equal(kind(2, 3), "text", "7 이어도 서식이 @ 면 글자 — 보고서의 숫자 칸이 이렇다");
  assert.equal(kind(3, 1), "boolean");
  assert.equal(kind(3, 2), "error");
  assert.equal(kind(3, 3), "number", "ISO 날짜도 Excel 안에서는 수다");
  assert.equal(kind(4, 3), "text");
  // 수식의 글자 결과 · 공유문자열도 글자.
  const shared = buildSheetPrintGrid(
    conditionalParts({
      sheetXml:
        '<?xml version="1.0"?><worksheet><dimension ref="A1:B1"/><sheetData><row r="1">' +
        '<c r="A1" t="s"><v>0</v></c><c r="B1" t="str"><f>A1</f><v>비고</v></c></row></sheetData></worksheet>',
      sharedStringsXml: '<?xml version="1.0"?><sst count="1" uniqueCount="1"><si><t>비고</t></si></sst>',
    }),
    USED_RANGE
  );
  assert.equal(cellAt(shared, 1, 1).valueKind, "text");
  assert.equal(cellAt(shared, 1, 2).valueKind, "text");
});

// ── 🔴 보고서 불변 (견적서 ②a) ──────────────────────────────────────────────

/** 1 → `A`, 27 → `AA`. */
function columnLetters(column: number): string {
  let letters = "";
  for (let rest = column; rest > 0; rest = Math.floor((rest - 1) / 26)) {
    letters = String.fromCharCode(65 + ((rest - 1) % 26)) + letters;
  }
  return letters;
}

const REPORT_CELL_KEYS = [
  "align",
  "backgroundColor",
  "bold",
  "borders",
  "colSpan",
  "column",
  "fontColor",
  "fontSizePt",
  "row",
  "rowSpan",
  "text",
  "valueKind",
  "verticalAlign",
  "wrap",
];

/**
 * 🔴 **보고서 칸의 글자가 숫자 서식을 읽기 전과 한 글자도 다르지 않다.**
 *
 * 숫자 서식을 읽게 되면서 셀 글자가 서식을 지나가게 되었다. 보고서 양식의 숫자 칸이
 * 서식 때문에 다른 글자로 찍히면 매일 쓰는 보고서 미리보기가 소리 없이 바뀐다.
 * 그래서 **서식을 읽기 전의 규칙** — 셀의 날 글자(후리가나를 걷은 공유문자열) ·
 * 줄바꿈 고르기 — 으로 이 시험이 모든 칸을 스스로 다시 읽어 견준다. ISO 날짜 칸
 * (`t="d"`)은 예전 길 그대로이고 위 「날짜 칸 넷」 시험이 따로 본다.
 *
 * 돌려주는 값은 견준 칸 중 **숫자 칸**의 수다 — 0 이면 이 시험이 숫자 칸을 하나도
 * 안 본 것이다.
 */
function assertReportTextUnchanged(grid: SheetPrintGrid, workbook: Buffer): number {
  const archive = ZipArchive.fromBuffer(workbook);
  const sheetXml = archive.readText(resolveSheetPart(archive, SERVICE_REPORT_SHEET_NAME));
  const shared = archive.readTextOrNull(SHARED_STRINGS_PART);
  const read = createCellTextReader(
    sheetXml,
    shared === null
      ? null
      : shared.replace(/<rPh\b[^>]*\/>/g, "").replace(/<rPh\b[^>]*>[\s\S]*?<\/rPh>/g, "")
  );

  const types = new Map<string, string | null>();
  for (const match of sheetXml.matchAll(/<c r="([A-Z]+\d+)"([^>]*?)\/?>/g)) {
    types.set(match[1], /\st="([^"]*)"/.exec(match[2])?.[1] ?? null);
  }

  let numericCells = 0;
  for (const row of grid.rows) {
    for (const cell of row.cells) {
      const ref = `${columnLetters(cell.column)}${cell.row}`;
      const type = types.get(ref) ?? null;
      // 🔴 「일반」 맞춤이 값의 종류로 바뀌는 칸이 없다(견적서 ②b 재작업) — 보고서 칸은 맞춤을 적어
      // 두었거나 글자다. 이 단언이 깨지면 보고서 화면의 맞춤이 달라진다는 뜻이다.
      if (cell.align === null || cell.align === "general") {
        assert.ok(
          cell.valueKind === null || cell.valueKind === "text",
          `${ref} 가 「일반」 맞춤의 ${cell.valueKind} 칸이다 — 보고서 화면의 맞춤이 달라진다`
        );
      }
      if (type === "d") continue;

      const raw = read(ref);
      const before = raw === null ? "" : raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
      assert.equal(cell.text, before, `${ref} 의 글자가 서식 때문에 달라졌습니다`);
      if (types.has(ref) && (type === null || type === "n") && raw !== null) numericCells += 1;

      // 결과 모양은 **더하기만** 했다 — 옛 칸은 그대로고 새 칸은 셋(글자색 · 배경 · 값의 종류)뿐이다.
      assert.deepEqual(Object.keys(cell).sort(), REPORT_CELL_KEYS, `${ref} 칸의 모양이 달라졌습니다`);
    }
  }
  return numericCells;
}

/** 숫자가 들어가는 칸(제조년월 · 사용기간)까지 채운 수리 보고서. 🔴 지어낸 자료다. */
const FULL_REPAIR_SAMPLE: ServiceReportInput = {
  ...SAMPLE,
  occurrencePlace: "라인 3",
  occurredOn: new Date(Date.UTC(2026, 7, 10)),
  productName: "13.56MHz 30kW",
  productCategory: "RF제네레이터",
  manufacturedYear: 2019,
  manufacturedMonth: 7,
  usedYears: 5,
  usedMonths: 3,
  situation: { request: " 요청", detail: " 상세" },
  repairNumber: "R-001",
  disposition: {
    onSiteRepair: false,
    replacementDelivery: false,
    goodsReceipt: { on: new Date(Date.UTC(2026, 7, 21)), number: "IN-001" },
    completion: { on: new Date(Date.UTC(2026, 8, 1)) },
  },
};

test("🔴 실제 양식(수리 보고서): 칸의 글자가 숫자 서식을 읽기 전과 한 글자도 다르지 않다", { skip: skipRepair }, () => {
  const workbook = fillServiceReportWorkbook(readFileSync(repairPath as string), FULL_REPAIR_SAMPLE);
  const grid = readSheetPrintGrid(workbook, SERVICE_REPORT_SHEET_NAME);

  const numericCells = assertReportTextUnchanged(grid, workbook);
  assert.ok(numericCells > 0, "숫자 칸을 하나도 견주지 못했습니다 — 입력에 숫자 칸이 빠졌습니다");
  // 날짜 칸은 예전 모양 그대로다.
  assert.equal(textCovering(grid, SERVICE_REPORT_CELLS.issuedOn), "2026년 9월 2일 수요일");
});

const inspectionPath = process.env.INSPECTION_REPORT_TEMPLATE_PATH;
const skipInspection = inspectionPath ? false : "INSPECTION_REPORT_TEMPLATE_PATH 가 설정되지 않았습니다";

test("🔴 실제 양식(검사 보고서): 칸의 글자가 숫자 서식을 읽기 전과 한 글자도 다르지 않다", { skip: skipInspection }, () => {
  const input: ServiceReportInput = {
    kind: "INSPECTION",
    customerName: "가나다 주식회사",
    issuedOn: new Date(Date.UTC(2026, 8, 2)),
    reportNumber: { prefix: "DSS", middle: "26", tail: "002" },
    customer: "가나다 공장",
    receivedOn: new Date(Date.UTC(2026, 7, 20)),
    modelName: "TEST-MODEL",
    manufacturedYear: 2019,
    manufacturedMonth: 7,
    usedYears: 5,
    usedMonths: 3,
    lotNumber: "LN-1234",
    serialNumber: "SN12345",
    causes: ["PART_DEFECT"],
    remark: ["비고 첫 줄"],
    disposition: {
      onSiteRepair: true,
      replacementDelivery: false,
      goodsReceipt: { on: new Date(Date.UTC(2026, 7, 21)), number: "IN-002" },
    },
    body: { findings: ["-외관 검사 실시"], actions: ["점검 실시"] },
  };
  const workbook = fillServiceReportWorkbook(readFileSync(inspectionPath as string), input);
  const grid = readSheetPrintGrid(workbook, SERVICE_REPORT_SHEET_NAME);

  const numericCells = assertReportTextUnchanged(grid, workbook);
  assert.ok(numericCells > 0, "숫자 칸을 하나도 견주지 못했습니다 — 입력에 숫자 칸이 빠졌습니다");
});
