import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  buildSheetPrintGrid,
  readSheetPrintGrid,
  SheetPrintGridError,
  type PrintGridCell,
  type SheetPrintGrid,
} from "./sheet-print-grid";
import {
  fillServiceReportWorkbook,
  SERVICE_REPORT_BODY_LABELS,
  SERVICE_REPORT_CELLS,
  SERVICE_REPORT_FINDINGS_INTRO,
  SERVICE_REPORT_SHEET_NAME,
  type ServiceReportInput,
} from "./service-report-template";
import { resolveSheetDrawingPart, resolveSheetPart, WORKBOOK_PART } from "./workbook-parts";
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
