import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

import { QUOTE_EXCEL_PREVIEW_TEXT } from "../../../components/quotes/quote-print-excel-preview";
import { MATCHER_QUOTE_CELLS, MATCHER_QUOTE_SHEET_NAME } from "../../xlsx/matcher-quote-template";
import { OH_QUOTE_CELLS, OH_QUOTE_SHEET_NAME } from "../../xlsx/oh-quote-template";
import { fillQuoteWorkbook, QUOTE_CELLS, QUOTE_SHEET_NAME, type GeneratorQuoteInput } from "../../xlsx/quote-template";
import { readSheetPrintGrid } from "../../xlsx/sheet-print-grid";
import { resolveSheetPart } from "../../xlsx/workbook-parts";
import { ZipArchive } from "../../xlsx/zip-reader";
import { writeZip, type ZipEntryInput } from "../../xlsx/zip-writer";
import {
  buildQuoteExcelPreview,
  QUOTE_EXCEL_PREVIEW_FAILURE_MESSAGES,
  QUOTE_EXCEL_PREVIEW_LIMITS,
  readAttachmentBytesWithinLimit,
  type QuoteExcelPreviewGrid,
  type QuoteExcelPreviewResult,
} from "./quote-excel-preview";

/**
 * ============================================================================
 * 붙인 수기 견적서 엑셀 → 인쇄 모양의 격자 (견적서 ②b)
 * ============================================================================
 * 앞의 묶음은 zip-writer 로 만든 **가짜 통합문서**로 돈다 — 칸 주소는 채우개의 칸 지도
 * (QUOTE_CELLS 등)를 그대로 쓰고, 값은 지어낸 것이다(저장소가 공개다). 실제 고객 파일은 열지
 * 않는다. 「실제 양식」 묶음은 앱 양식을 기존 채우개로 채운 파일을 그린다(양식 경로가 없는
 * 환경에서는 건너뛴다 — xlsx 양식 시험들과 같은 규칙).
 * ============================================================================
 */

const MAIN_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PKG_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships";
const XDR_NS = "http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing";
const A_NS = "http://schemas.openxmlformats.org/drawingml/2006/main";

/** 0 일반 · 1 날짜(`yyyy"년" m"월" d"일"`) · 2 금액(`"₩"#,##0`) · 3 머리글(rgb 글자 · 노란 배경) */
const STYLES_XML =
  `<styleSheet xmlns="${MAIN_NS}">` +
  '<numFmts count="2"><numFmt numFmtId="176" formatCode="&quot;₩&quot;#,##0"/>' +
  '<numFmt numFmtId="177" formatCode="yyyy&quot;년&quot; m&quot;월&quot; d&quot;일&quot;"/></numFmts>' +
  '<fonts count="2"><font><sz val="11"/></font><font><b/><sz val="20"/><color rgb="FF1F4E79"/></font></fonts>' +
  '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' +
  '<fill><patternFill patternType="solid"><fgColor rgb="FFFFFF00"/></patternFill></fill></fills>' +
  '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
  '<cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>' +
  '<xf numFmtId="177" fontId="0" fillId="0" borderId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="176" fontId="0" fillId="0" borderId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" applyFont="1" applyFill="1"/></cellXfs>' +
  // 조건부 서식의 서식 — 0 : 테마 0(lt1 · 흰색) 글자. 앱 제너레이터 내자 양식의 도우미 칸 규칙과 같다(실측).
  '<dxfs count="1"><dxf><font><color theme="0"/></font></dxf></dxfs>' +
  "</styleSheet>";

/** 테마 — lt1 흰색 · dk1 검정(시스템 색), 나머지는 Office 기본. */
const THEME_XML =
  `<a:theme xmlns:a="${"http://schemas.openxmlformats.org/drawingml/2006/main"}" name="시험"><a:themeElements><a:clrScheme name="시험">` +
  '<a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>' +
  '<a:dk2><a:srgbClr val="1F497D"/></a:dk2><a:lt2><a:srgbClr val="EEECE1"/></a:lt2>' +
  '<a:accent1><a:srgbClr val="4F81BD"/></a:accent1><a:accent2><a:srgbClr val="C0504D"/></a:accent2>' +
  '<a:accent3><a:srgbClr val="9BBB59"/></a:accent3><a:accent4><a:srgbClr val="8064A2"/></a:accent4>' +
  '<a:accent5><a:srgbClr val="4BACC6"/></a:accent5><a:accent6><a:srgbClr val="F79646"/></a:accent6>' +
  '<a:hlink><a:srgbClr val="0000FF"/></a:hlink><a:folHlink><a:srgbClr val="800080"/></a:folHlink>' +
  "</a:clrScheme></a:themeElements></a:theme>";

/** 「값이 0 이면 흰 글자」 — 앱 제너레이터 내자 양식이 공급가 위 도우미 칸에 건 규칙 그대로. */
function zeroIsWhite(sqref: string): string {
  return `<conditionalFormatting sqref="${sqref}"><cfRule type="cellIs" dxfId="0" priority="1" operator="equal"><formula>0</formula></cfRule></conditionalFormatting>`;
}
const STYLE = { general: 0, date: 1, amount: 2, heading: 3 } as const;

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function str(ref: string, text: string, style: number = STYLE.general): string {
  return `<c r="${ref}" s="${style}" t="inlineStr"><is><t>${escapeXml(text)}</t></is></c>`;
}

function num(ref: string, value: number, style: number): string {
  return `<c r="${ref}" s="${style}"><v>${value}</v></c>`;
}

function serialOf(year: number, month: number, day: number): number {
  return (Date.UTC(year, month - 1, day) - Date.UTC(1899, 11, 30)) / 86_400_000;
}

function columnNumber(letters: string): number {
  let value = 0;
  for (const letter of letters) value = value * 26 + (letter.charCodeAt(0) - 64);
  return value;
}

/** 칸들 → `<sheetData>`. 행 안의 칸은 열 순서로 늘어놓는다. */
function sheetXmlOf(
  cells: readonly string[],
  options: { dimension?: string; drawing?: boolean; afterSheetData?: string } = {}
): string {
  const byRow = new Map<number, string[]>();
  for (const one of cells) {
    const row = Number(/\sr="[A-Z]+(\d+)"/.exec(one)?.[1]);
    byRow.set(row, [...(byRow.get(row) ?? []), one]);
  }
  const rows = [...byRow.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([row, rowCells]) => {
      const sorted = [...rowCells].sort(
        (a, b) => columnNumber(/\sr="([A-Z]+)/.exec(a)?.[1] ?? "A") - columnNumber(/\sr="([A-Z]+)/.exec(b)?.[1] ?? "A")
      );
      return `<row r="${row}">${sorted.join("")}</row>`;
    })
    .join("");
  const dimension = options.dimension === undefined ? "" : `<dimension ref="${options.dimension}"/>`;
  const drawing = options.drawing ? '<drawing r:id="rId1"/>' : "";
  return (
    `<worksheet xmlns="${MAIN_NS}" xmlns:r="${REL_NS}">${dimension}<sheetData>${rows}</sheetData>${options.afterSheetData ?? ""}` +
    `<pageMargins left="0.4" right="0.4" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>` +
    `<pageSetup paperSize="9" scale="92" orientation="portrait"/>${drawing}</worksheet>`
  );
}

type Picture = { relId: string; col: number; row: number };

function drawingXmlOf(pictures: readonly Picture[]): string {
  const anchors = pictures
    .map(
      (picture) =>
        "<xdr:twoCellAnchor>" +
        `<xdr:from><xdr:col>${picture.col}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${picture.row}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>` +
        `<xdr:to><xdr:col>${picture.col + 1}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${picture.row + 1}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>` +
        `<xdr:pic><xdr:blipFill><a:blip r:embed="${picture.relId}"/></xdr:blipFill></xdr:pic><xdr:clientData/>` +
        "</xdr:twoCellAnchor>"
    )
    .join("");
  return `<xdr:wsDr xmlns:xdr="${XDR_NS}" xmlns:a="${A_NS}" xmlns:r="${REL_NS}">${anchors}</xdr:wsDr>`;
}

type SheetSpec = {
  name: string;
  cells?: readonly string[];
  xml?: string;
  state?: "hidden";
  dimension?: string;
  /** `</sheetData>` 바로 뒤에 넣을 XML(조건부 서식 따위). */
  afterSheetData?: string;
  /** 이 시트에 그림 파트를 단다 — rId → Target(`TargetMode` 까지 적은 속성 글자 그대로). */
  drawing?: { pictures: readonly Picture[]; rels: readonly { id: string; target: string; external?: boolean }[] };
};

function workbookOf(options: {
  sheets: readonly SheetSpec[];
  printAreas?: Record<string, string>;
  activeTab?: number;
  media?: readonly ZipEntryInput[];
  /** 주면 `xl/theme/theme1.xml` 과 그 관계를 싣는다. */
  themeXml?: string;
}): Buffer {
  const sheetTags = options.sheets
    .map(
      (sheet, index) =>
        `<sheet name="${escapeXml(sheet.name)}" sheetId="${index + 1}"${sheet.state ? ` state="${sheet.state}"` : ""} r:id="rId${index + 1}"/>`
    )
    .join("");
  const relTags = options.sheets
    .map(
      (_sheet, index) =>
        `<Relationship Id="rId${index + 1}" Type="${REL_NS}/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`
    )
    .join("");
  const definedNames = Object.entries(options.printAreas ?? {})
    .map(
      ([sheetName, range]) =>
        `<definedName name="_xlnm.Print_Area" localSheetId="${options.sheets.findIndex((sheet) => sheet.name === sheetName)}">${escapeXml(sheetName)}!${range}</definedName>`
    )
    .join("");
  const bookView = options.activeTab === undefined ? "<workbookView/>" : `<workbookView activeTab="${options.activeTab}"/>`;

  const entries: ZipEntryInput[] = [
    {
      name: "xl/workbook.xml",
      data: Buffer.from(
        `<workbook xmlns="${MAIN_NS}" xmlns:r="${REL_NS}"><workbookPr/><bookViews>${bookView}</bookViews>` +
          `<sheets>${sheetTags}</sheets>${definedNames === "" ? "" : `<definedNames>${definedNames}</definedNames>`}</workbook>`,
        "utf8"
      ),
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      data: Buffer.from(
        `<Relationships xmlns="${PKG_REL_NS}">${relTags}` +
          (options.themeXml === undefined
            ? ""
            : `<Relationship Id="rIdTheme" Type="${REL_NS}/theme" Target="theme/theme1.xml"/>`) +
          "</Relationships>",
        "utf8"
      ),
    },
    { name: "xl/styles.xml", data: Buffer.from(STYLES_XML, "utf8") },
  ];
  if (options.themeXml !== undefined) {
    entries.push({ name: "xl/theme/theme1.xml", data: Buffer.from(options.themeXml, "utf8") });
  }

  options.sheets.forEach((sheet, index) => {
    const n = index + 1;
    entries.push({
      name: `xl/worksheets/sheet${n}.xml`,
      data: Buffer.from(
        sheet.xml ??
          sheetXmlOf(sheet.cells ?? [], {
            dimension: sheet.dimension,
            drawing: sheet.drawing !== undefined,
            afterSheetData: sheet.afterSheetData,
          }),
        "utf8"
      ),
    });
    if (sheet.drawing) {
      entries.push(
        {
          name: `xl/worksheets/_rels/sheet${n}.xml.rels`,
          data: Buffer.from(
            `<Relationships xmlns="${PKG_REL_NS}"><Relationship Id="rId1" Type="${REL_NS}/drawing" Target="../drawings/drawing${n}.xml"/></Relationships>`,
            "utf8"
          ),
        },
        { name: `xl/drawings/drawing${n}.xml`, data: Buffer.from(drawingXmlOf(sheet.drawing.pictures), "utf8") },
        {
          name: `xl/drawings/_rels/drawing${n}.xml.rels`,
          data: Buffer.from(
            `<Relationships xmlns="${PKG_REL_NS}">` +
              sheet.drawing.rels
                .map(
                  (rel) =>
                    `<Relationship Id="${rel.id}" Type="${REL_NS}/image" Target="${rel.target}"${rel.external ? ' TargetMode="External"' : ""}/>`
                )
                .join("") +
              "</Relationships>",
            "utf8"
          ),
        }
      );
    }
  });
  entries.push(...(options.media ?? []));
  return writeZip(entries);
}

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64"
);
const GIF = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9]);
const EMF = Buffer.from([0x01, 0x00, 0x00, 0x00, 0x6c, 0x00, 0x00, 0x00, 0x20, 0x45, 0x4d, 0x46]);
/** 🔴 Excel 97-2003(.xls) 의 OLE2 앞머리. */
const XLS = Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(504)]);

/** 🔴 지어낸 값 — 앱 양식 칸 지도 그대로의 가짜 내자 견적서. */
function generatorCells(quoteNumber = "DSS 2096-001"): string[] {
  return [
    str("A1", "견 적 서", STYLE.heading),
    str(QUOTE_CELLS.quoteNumber, quoteNumber),
    num(QUOTE_CELLS.quoteDate, serialOf(2026, 9, 15), STYLE.date),
    str(QUOTE_CELLS.customerName, "가상상사 Co.,Ltd"),
    str(QUOTE_CELLS.subject, "TST-500X 수리 견적"),
    num(QUOTE_CELLS.amount, 3_500_000, STYLE.amount),
  ];
}

function expectOk(result: QuoteExcelPreviewResult): { grid: QuoteExcelPreviewGrid; warnings: string[] } {
  if (!result.ok) assert.fail(`미리보기가 실패했다: ${result.code}`);
  return result;
}

function texts(grid: QuoteExcelPreviewGrid): string[] {
  return grid.rows.flatMap((row) => row.cells.map((one) => one.text));
}

function cellText(grid: QuoteExcelPreviewGrid, ref: string): string | undefined {
  const [, letters, digits] = /^([A-Z]+)(\d+)$/.exec(ref) ?? [];
  return grid.rows
    .find((row) => row.row === Number(digits))
    ?.cells.find((one) => one.column === columnNumber(letters ?? ""))?.text;
}

describe("앱 양식 칸 지도의 견적서 → 격자", () => {
  const workbook = workbookOf({
    sheets: [{ name: QUOTE_SHEET_NAME, cells: generatorCells() }],
    printAreas: { [QUOTE_SHEET_NAME]: "$A$1:$L$70" },
  });

  test("🔴 금액은 콤마 서식, 발행일자는 날짜로 — 날 값(3500000 · 46280)이 찍히지 않는다", () => {
    const { grid, warnings } = expectOk(buildQuoteExcelPreview(workbook));
    assert.equal(cellText(grid, QUOTE_CELLS.amount), "₩3,500,000");
    assert.equal(cellText(grid, QUOTE_CELLS.quoteDate), "2026년 9월 15일");
    assert.equal(cellText(grid, QUOTE_CELLS.quoteNumber), "DSS 2096-001");
    assert.ok(!texts(grid).includes("3500000"));
    assert.deepEqual(warnings, []);
  });

  test("인쇄 영역 그대로 · 인쇄 설정 · 글자 색 · 배경", () => {
    const { grid } = expectOk(buildQuoteExcelPreview(workbook));
    assert.deepEqual([grid.firstRow, grid.lastRow, grid.firstColumn, grid.lastColumn], [1, 70, 1, 12]);
    assert.equal(grid.page.scale, 0.92);
    assert.equal(grid.page.paperSize, 9);
    const heading = grid.rows[0].cells[0];
    assert.equal(heading.text, "견 적 서");
    assert.equal(heading.fontColor, "#1F4E79");
    assert.equal(heading.backgroundColor, "#FFFF00");
    assert.deepEqual(grid.pictures, []);
  });

  test("🔴 인쇄 영역이 없으면 쓰인 범위(`<dimension>`)로 그린다", () => {
    const noPrintArea = workbookOf({ sheets: [{ name: QUOTE_SHEET_NAME, cells: generatorCells(), dimension: "A1:L30" }] });
    const { grid } = expectOk(buildQuoteExcelPreview(noPrintArea));
    assert.deepEqual([grid.firstRow, grid.lastRow, grid.firstColumn, grid.lastColumn], [1, 30, 1, 12]);
    assert.equal(cellText(grid, QUOTE_CELLS.amount), "₩3,500,000");
  });
});

describe("실패 — 던지지 않고 까닭을", () => {
  test("🔴 옛 .xls 는 사용자 결정 1 의 문장 — 화면의 문장과 같다", () => {
    const result = buildQuoteExcelPreview(XLS);
    assert.deepEqual(result, {
      ok: false,
      code: "XLS_LEGACY",
      message:
        "옛 엑셀 형식(.xls)이라 미리보기를 그릴 수 없습니다 — xlsx 로 다시 저장해 올리거나 [견적서 받기]로 받아 보세요",
    });
    assert.equal(QUOTE_EXCEL_PREVIEW_FAILURE_MESSAGES.XLS_LEGACY, QUOTE_EXCEL_PREVIEW_TEXT.XLS_LEGACY);
  });

  test("zip 이 아니면 NOT_XLSX", () => {
    const result = buildQuoteExcelPreview(Buffer.from("그냥 글자 파일"));
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "NOT_XLSX");
  });

  test("상한 — 파트가 너무 크게 풀리면 CONTENT_TOO_LARGE", () => {
    const workbook = workbookOf({ sheets: [{ name: QUOTE_SHEET_NAME, cells: generatorCells() }] });
    const result = buildQuoteExcelPreview(workbook, { limits: { maxPartBytes: 64 } });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "CONTENT_TOO_LARGE");
  });

  test("그리는 칸이 상한을 넘으면 SHEET_TOO_LARGE", () => {
    const workbook = workbookOf({
      sheets: [{ name: QUOTE_SHEET_NAME, cells: generatorCells() }],
      printAreas: { [QUOTE_SHEET_NAME]: "$A$1:$L$70" },
    });
    const result = buildQuoteExcelPreview(workbook, { limits: { maxCells: 12 * 70 - 1 } });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "SHEET_TOO_LARGE");
    assert.ok(buildQuoteExcelPreview(workbook, { limits: { maxCells: 12 * 70 } }).ok, "딱 상한이면 그린다");
    assert.ok(QUOTE_EXCEL_PREVIEW_LIMITS.maxCells >= 12 * 70);
  });

  test("시트 구조를 못 읽으면 SHEET_UNREADABLE(`<sheetData>` 없음)", () => {
    const workbook = workbookOf({ sheets: [{ name: "차트", xml: `<worksheet xmlns="${MAIN_NS}"/>` }] });
    const result = buildQuoteExcelPreview(workbook);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "SHEET_UNREADABLE");
  });
});

describe("시트 고르기 — ①a 그대로, 없으면 첫 시트", () => {
  test("🔴 알아볼 견적서 시트가 없으면 통합문서의 첫 시트(숨긴 시트는 건너뛴다) + 경고", () => {
    const workbook = workbookOf({
      sheets: [
        { name: "숨긴 도우미", state: "hidden", cells: [str("A1", "숨은 값")] },
        { name: "내 견적", cells: [str("A1", "손으로 만든 견적"), num("B2", 1_234_500, STYLE.amount)] },
      ],
    });
    const { grid, warnings } = expectOk(buildQuoteExcelPreview(workbook));
    assert.ok(texts(grid).includes("손으로 만든 견적"), "첫 보이는 시트를 그리지 않았다");
    assert.ok(texts(grid).includes("₩1,234,500"));
    assert.ok(!texts(grid).includes("숨은 값"), "숨긴 시트를 그렸다");
    assert.deepEqual(warnings, [
      "견적서 시트(내자견적서 · OH견적서 · 견적서)를 찾지 못해 통합문서의 첫 시트 「내 견적」를 그렸습니다 — 앱 양식을 바탕으로 만든 견적서 엑셀인지 확인해 주세요.",
    ]);
  });

  test("🔴 ①a 의 경고 가운데 시트를 고른 까닭만 옮긴다 — 가를 수 없으면 탭 순서의 첫 시트", () => {
    const workbook = workbookOf({
      sheets: [
        { name: QUOTE_SHEET_NAME, cells: [str(QUOTE_CELLS.quoteNumber, "내자-001")] },
        { name: OH_QUOTE_SHEET_NAME, cells: [str(OH_QUOTE_CELLS.quoteNumber, "OH-001")] },
        { name: "Sheet1", cells: [str("A1", "메모")] },
      ],
      activeTab: 2,
    });
    const { grid, warnings } = expectOk(buildQuoteExcelPreview(workbook));
    assert.ok(texts(grid).includes("내자-001") && !texts(grid).includes("OH-001"), "①a 가 고른 시트가 아니다");
    assert.equal(warnings.length, 1, JSON.stringify(warnings));
    assert.ok(warnings[0].includes("탭 순서의 첫 시트 「내자견적서」"), warnings[0]);
  });

  test("활성 시트로 가를 수 있으면 그 시트 · 경고 없음", () => {
    const workbook = workbookOf({
      sheets: [
        { name: QUOTE_SHEET_NAME, cells: [str(QUOTE_CELLS.quoteNumber, "내자-001")] },
        { name: OH_QUOTE_SHEET_NAME, cells: [str(OH_QUOTE_CELLS.quoteNumber, "OH-001")] },
      ],
      activeTab: 1,
    });
    const { grid, warnings } = expectOk(buildQuoteExcelPreview(workbook));
    assert.ok(texts(grid).includes("OH-001"));
    assert.deepEqual(warnings, []);
  });

  test("폼에 채울 때의 경고(매쳐의 견적서 종류 등)는 미리보기에 싣지 않는다", () => {
    const workbook = workbookOf({
      sheets: [{ name: MATCHER_QUOTE_SHEET_NAME, cells: [str(MATCHER_QUOTE_CELLS.quoteNumber, "M-001")] }],
    });
    const { grid, warnings } = expectOk(buildQuoteExcelPreview(workbook));
    assert.ok(texts(grid).includes("M-001"));
    assert.deepEqual(warnings, []);
  });
});

describe("🔴 그림 — 격자가 가리키는 이미지 파트만, png · jpeg · gif 만 data URI 로", () => {
  function pictureWorkbook(
    rels: { id: string; target: string; external?: boolean }[],
    media: ZipEntryInput[],
    pictures: Picture[] = rels.map((rel, index) => ({ relId: rel.id, col: index, row: 0 }))
  ): Buffer {
    return workbookOf({
      sheets: [{ name: QUOTE_SHEET_NAME, cells: generatorCells(), drawing: { pictures, rels } }],
      printAreas: { [QUOTE_SHEET_NAME]: "$A$1:$L$70" },
      media,
    });
  }

  test("png · jpeg · gif — 바이트 그대로의 data URI", () => {
    const workbook = pictureWorkbook(
      [
        { id: "rId1", target: "../media/image1.png" },
        { id: "rId2", target: "../media/image2.jpeg" },
        { id: "rId3", target: "/xl/media/image3.gif" },
      ],
      [
        { name: "xl/media/image1.png", data: PNG },
        { name: "xl/media/image2.jpeg", data: JPEG },
        { name: "xl/media/image3.gif", data: GIF },
      ]
    );
    const { grid, warnings } = expectOk(buildQuoteExcelPreview(workbook));
    assert.deepEqual(
      grid.pictures.map((picture) => [picture.name, picture.src]),
      [
        ["image1.png", `data:image/png;base64,${PNG.toString("base64")}`],
        ["image2.jpeg", `data:image/jpeg;base64,${JPEG.toString("base64")}`],
        ["image3.gif", `data:image/gif;base64,${GIF.toString("base64")}`],
      ]
    );
    assert.ok(grid.pictures.every((picture) => picture.widthPt > 0 && picture.heightPt > 0));
    assert.deepEqual(warnings, []);
  });

  test("🔴 emf · 확장자만 png 인 것 · 외부 링크 · 없는 파트는 빼고 그 수를 알린다", () => {
    const workbook = pictureWorkbook(
      [
        { id: "rId1", target: "../media/image1.png" },
        { id: "rId2", target: "../media/image2.emf" },
        { id: "rId3", target: "../media/fake.png" },
        { id: "rId4", target: "https://example.invalid/seal.png", external: true },
        { id: "rId5", target: "../media/missing.png" },
      ],
      [
        { name: "xl/media/image1.png", data: PNG },
        { name: "xl/media/image2.emf", data: EMF },
        { name: "xl/media/fake.png", data: Buffer.from("not a png at all") },
      ]
    );
    const { grid, warnings } = expectOk(buildQuoteExcelPreview(workbook));
    assert.deepEqual(
      grid.pictures.map((picture) => picture.name),
      ["image1.png"]
    );
    assert.deepEqual(warnings, [
      "그림 4장은 브라우저가 그릴 수 없는 형식(emf 등)이거나 파일 안에서 꺼낼 수 없어 빼고 그렸습니다.",
    ]);
  });

  test("🔴 관계의 Target 이 zip 밖을 가리켜도 zip 안의 이름일 뿐이다 — 없는 파트로 빠진다", () => {
    const workbook = pictureWorkbook(
      [{ id: "rId1", target: "../../../../../../Windows/win.png" }],
      [{ name: "xl/media/win.png", data: PNG }]
    );
    const { grid, warnings } = expectOk(buildQuoteExcelPreview(workbook));
    assert.deepEqual(grid.pictures, []);
    assert.equal(warnings.length, 1);
  });

  test("같은 그림을 두 자리에 쓰면 한 번만 꺼내 둘 다 싣는다", () => {
    const workbook = pictureWorkbook(
      [{ id: "rId1", target: "../media/image1.png" }],
      [{ name: "xl/media/image1.png", data: PNG }],
      [
        { relId: "rId1", col: 0, row: 0 },
        { relId: "rId1", col: 3, row: 5 },
      ]
    );
    const { grid } = expectOk(buildQuoteExcelPreview(workbook, { limits: { maxPictureBytes: PNG.length } }));
    assert.equal(grid.pictures.length, 2);
    assert.ok(grid.pictures.every((picture) => picture.src.startsWith("data:image/png;base64,")));
  });

  test("🔴 그림 합계가 상한을 넘으면 그림을 전부 빼고 경고", () => {
    const workbook = pictureWorkbook(
      [
        { id: "rId1", target: "../media/image1.png" },
        { id: "rId2", target: "../media/image2.png" },
      ],
      [
        { name: "xl/media/image1.png", data: PNG },
        { name: "xl/media/image2.png", data: Buffer.concat([PNG, Buffer.alloc(16)]) },
      ]
    );
    // 한 장씩은 들어가도 둘을 합하면 넘는다.
    const { grid, warnings } = expectOk(
      buildQuoteExcelPreview(workbook, { limits: { maxPictureBytes: PNG.length + 10 } })
    );
    assert.deepEqual(grid.pictures, []);
    assert.equal(warnings.length, 1);
    assert.ok(warnings[0].includes("그림(직인 · 로고 등) 없이 그렸습니다"), warnings[0]);
    // 넉넉하면 둘 다.
    assert.equal(expectOk(buildQuoteExcelPreview(workbook)).grid.pictures.length, 2);
    assert.equal(QUOTE_EXCEL_PREVIEW_LIMITS.maxPictureBytes, 4 * 1024 * 1024);
  });

  test("🔴 상한 없이 푸는 파트는 전부 먼저 상한 안에서 풀어 본 것이다", () => {
    const workbook = workbookOf({
      sheets: [
        {
          name: QUOTE_SHEET_NAME,
          cells: generatorCells(),
          drawing: { pictures: [{ relId: "rId1", col: 0, row: 0 }], rels: [{ id: "rId1", target: "../media/image1.png" }] },
          afterSheetData: zeroIsWhite("A1"),
        },
      ],
      printAreas: { [QUOTE_SHEET_NAME]: "$A$1:$L$70" },
      media: [{ name: "xl/media/image1.png", data: PNG }],
      themeXml: THEME_XML,
    });
    const reads: { name: string; bounded: boolean }[] = [];
    const original = ZipArchive.prototype.readEntry;
    ZipArchive.prototype.readEntry = function (this: ZipArchive, name: string, maxOutputLength?: number) {
      // 없는 파트(이 통합문서의 sharedStrings.xml 따위)는 아무것도 풀지 않으므로 세지 않는다.
      if (this.has(name)) reads.push({ name, bounded: maxOutputLength !== undefined });
      return original.call(this, name, maxOutputLength);
    };
    try {
      expectOk(buildQuoteExcelPreview(workbook));
    } finally {
      ZipArchive.prototype.readEntry = original;
    }

    const boundedSoFar = new Set<string>();
    const unbounded: string[] = [];
    for (const read of reads) {
      if (read.bounded) boundedSoFar.add(read.name);
      else {
        unbounded.push(read.name);
        assert.ok(boundedSoFar.has(read.name), `상한 없이 먼저 풀렸다: ${read.name}`);
      }
    }
    // 격자가 실제로 상한 없이 푸는 파트들이 있다 — 이 시험이 헛돌지 않는다.
    for (const part of [
      "xl/workbook.xml",
      "xl/worksheets/sheet1.xml",
      "xl/drawings/drawing1.xml",
      "xl/styles.xml",
      "xl/theme/theme1.xml",
    ]) {
      assert.ok(unbounded.includes(part), `readSheetPrintGrid 가 ${part} 를 읽지 않았다`);
    }
    // 그림은 상한을 걸고만 푼다.
    assert.ok(reads.filter((read) => read.name === "xl/media/image1.png").every((read) => read.bounded));
  });
});

describe("저장소에서 읽기 — 20MB 상한", () => {
  function streamOf(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
    return new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      },
    });
  }

  test("상한 안이면 바이트 그대로", async () => {
    const result = await readAttachmentBytesWithinLimit(streamOf([Buffer.from("ab"), Buffer.from("cd")]), 4);
    assert.ok(result.ok);
    if (result.ok) assert.equal(result.bytes.toString(), "abcd");
  });

  test("넘는 순간 멈춘다", async () => {
    const result = await readAttachmentBytesWithinLimit(streamOf([Buffer.from("ab"), Buffer.from("cde")]), 4);
    assert.deepEqual(result, { ok: false });
  });
});

// ── 실제 양식 — 앱 양식을 채운 파일 ────────────────────────────────────────

const generatorQuotePath = process.env.QUOTE_TEMPLATE_PATH;
const skipGeneratorQuote = generatorQuotePath ? false : "QUOTE_TEMPLATE_PATH 가 설정되지 않았습니다";

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

/** 수식 칸에 계산값을 넣는다 — Excel 이 저장한 파일을 흉내 낸다(sheet-print-grid.test.ts 의 같은 도우미). */
function withCachedValue(sheetXml: string, ref: string, value: number): string {
  const found = new RegExp(`<c r="${ref}"([^>]*?)(?:/>|>([\\s\\S]*?)</c>)`).exec(sheetXml);
  assert.ok(found, `${ref} 칸이 없습니다`);
  const attributes = found[1].replace(/\st="[^"]*"/, "");
  const inner = (found[2] ?? "").replace(/<v>[\s\S]*?<\/v>/, "");
  return sheetXml.replace(found[0], `<c r="${ref}"${attributes}>${inner}<v>${value}</v></c>`);
}

test("🔴 실제 양식(제너레이터 내자)을 채운 xlsx — 금액 콤마 · 날짜 · 그림은 data URI 만", { skip: skipGeneratorQuote }, () => {
  const filled = fillQuoteWorkbook(readFileSync(generatorQuotePath as string), GENERATOR_QUOTE);
  const archive = ZipArchive.fromBuffer(filled);
  const sheetPart = resolveSheetPart(archive, QUOTE_SHEET_NAME);
  const sheetXml = withCachedValue(archive.readText(sheetPart), QUOTE_CELLS.amount, 3_500_000);
  const workbook = writeZip(
    archive.list().map((name) => ({
      name,
      data: name === sheetPart ? Buffer.from(sheetXml, "utf8") : (archive.readEntry(name) as Buffer),
    }))
  );

  const { grid, warnings } = expectOk(buildQuoteExcelPreview(workbook));
  const all = texts(grid);
  assert.ok(all.some((text) => text.includes("1,234,500")), "단가가 콤마 서식으로 안 나왔다");
  assert.ok(all.some((text) => text.includes("2026년 8월 28일")), "발행일자가 날짜로 안 나왔다");
  assert.ok(all.some((text) => /3,500,000/.test(text)), "금액이 콤마 서식으로 안 나왔다");
  assert.ok(!all.includes("1234500") && !all.includes("3500000"), "날 값이 찍혔다");
  assert.ok(all.includes("DSS 2026-077"));
  assert.ok(
    grid.pictures.every((picture) => /^data:image\/(?:png|jpeg|gif);base64,/.test(picture.src)),
    "브라우저가 못 그리는 그림이 실렸다"
  );
  assert.ok(
    warnings.every((warning) => !warning.includes("첫 시트")),
    `채운 앱 양식인데 시트를 대신 골랐다: ${JSON.stringify(warnings)}`
  );
});

// ── 🔴 사용자가 본 차이 (2026-09-16) — 공급가 위의 「₩0」 · 왼쪽에 붙은 금액 ──────────────

describe("🔴 조건부 서식 — 「0 이면 흰 글자」 도우미 칸의 ₩0 을 Excel 처럼 감춘다", () => {
  function helperWorkbook(themeXml: string | undefined): Buffer {
    return workbookOf({
      sheets: [
        {
          name: QUOTE_SHEET_NAME,
          cells: [...generatorCells(), num("I39", 0, STYLE.amount), num("I40", 3_500_000, STYLE.amount)],
          afterSheetData: zeroIsWhite("I39:I40"),
        },
      ],
      printAreas: { [QUOTE_SHEET_NAME]: "$A$1:$L$70" },
      themeXml,
    });
  }

  test("0 인 칸은 테마 0(lt1 · 흰색) 글자 — 글자는 그대로 두고 색으로 감춘다(Excel 과 같다)", () => {
    const { grid } = expectOk(buildQuoteExcelPreview(helperWorkbook(THEME_XML)));
    const helper = grid.rows.find((row) => row.row === 39)?.cells.find((one) => one.column === 9);
    const supply = grid.rows.find((row) => row.row === 40)?.cells.find((one) => one.column === 9);
    assert.equal(helper?.text, "₩0");
    assert.equal(helper?.fontColor, "#FFFFFF", "Excel 은 이 ₩0 을 흰 글자로 그린다");
    assert.equal(supply?.text, "₩3,500,000");
    assert.equal(supply?.fontColor, null, "0 이 아닌 칸은 규칙이 안 걸린다");
  });

  test("테마 파트가 없으면 테마 색은 모르는 색(null) — 짐작해 칠하지 않는다", () => {
    const { grid } = expectOk(buildQuoteExcelPreview(helperWorkbook(undefined)));
    const helper = grid.rows.find((row) => row.row === 39)?.cells.find((one) => one.column === 9);
    assert.equal(helper?.fontColor, null);
  });

  test("🔴 금액 칸은 값의 종류가 수다 — 맞춤을 안 적었으면 화면이 오른쪽에 붙인다", () => {
    const { grid } = expectOk(buildQuoteExcelPreview(helperWorkbook(THEME_XML)));
    const amount = grid.rows.find((row) => row.row === 40)?.cells.find((one) => one.column === 9);
    assert.equal(amount?.valueKind, "number");
    assert.equal(amount?.align, null, "맞춤을 안 적은 칸 — 「일반」 맞춤");
    const subject = cellText(grid, QUOTE_CELLS.subject);
    assert.equal(subject, "TST-500X 수리 견적");
    const subjectCell = grid.rows.flatMap((row) => row.cells).find((one) => one.text === subject);
    assert.equal(subjectCell?.valueKind, "text");
  });
});

/** 칸 하나를 인라인 글자로 바꾼다(서식 번호는 둔다) — 원본 양식에 남은 예시 값을 지어낸 값으로 덮는다. */
function withInlineText(sheetXml: string, ref: string, text: string): string {
  const found = new RegExp(`<c r="${ref}"([^>]*?)(?:/>|>([\\s\\S]*?)</c>)`).exec(sheetXml);
  assert.ok(found, `${ref} 칸이 없습니다`);
  const style = /\ss="\d+"/.exec(found[1])?.[0] ?? "";
  return sheetXml.replace(found[0], `<c r="${ref}"${style} t="inlineStr"><is><t>${escapeXml(text)}</t></is></c>`);
}

/**
 * 🔴 **사람이 만든 견적서 엑셀을 흉내 낸다** — 앱의 제너레이터 내자 양식 **원본**(채우개를 거치지
 * 않은 것)은 Excel 로 저장된 파일이라 수식마다 계산값이 있고, 공급가 줄 바로 위 금액 열에
 * 도우미 칸(`=N45`, 계산값 0)과 「0 이면 흰 글자」 규칙이 그대로 있다. 사용자의 수기 엑셀이 이
 * 원본을 바탕으로 만든 것이다. 보이는 값(발행번호 · 공급처 · 품명)은 지어낸 값으로 덮고, 공급가와
 * 발행일자에 계산값을 넣는다. 실제 고객 파일은 열지 않는다.
 */
test("🔴 실제 양식 원본(수기 엑셀과 같은 모양): 공급가 위 ₩0 은 흰 글자, 금액은 수, 발행일자는 저장된 계산값", { skip: skipGeneratorQuote }, () => {
  const original = readFileSync(generatorQuotePath as string);
  const archive = ZipArchive.fromBuffer(original);
  const sheetPart = resolveSheetPart(archive, QUOTE_SHEET_NAME);
  let sheetXml = archive.readText(sheetPart);
  sheetXml = withInlineText(sheetXml, QUOTE_CELLS.quoteNumber, "DSS 2096-001");
  sheetXml = withInlineText(sheetXml, QUOTE_CELLS.customerName, "가상상사 Co.,Ltd");
  sheetXml = withInlineText(sheetXml, QUOTE_CELLS.subject, "TST-500X 수리 견적");
  // 발행일자 칸은 `TODAY()` 수식이다 — 파일을 마지막으로 계산한 날(2026-08-31)이 계산값으로 남아 있다고 친다.
  assert.match(sheetXml, new RegExp(`<c r="${QUOTE_CELLS.quoteDate}"[^>]*>\\s*<f[^>]*>TODAY\\(\\)</f>`), "발행일자 칸이 TODAY() 가 아니다");
  sheetXml = withCachedValue(sheetXml, QUOTE_CELLS.quoteDate, serialOf(2026, 8, 31));

  // 「공 급 가」 줄 — H 열의 머리글로 찾는다(채우개와 같은 방법).
  const supplyRow = Number(
    [...sheetXml.matchAll(/<c r="H(\d+)"[^>]*t="s"[^>]*><v>(\d+)<\/v>/g)].find((match) => {
      const shared = archive.readText("xl/sharedStrings.xml");
      const item = [...shared.matchAll(/<si>([\s\S]*?)<\/si>/g)][Number(match[2])]?.[1] ?? "";
      return item.replace(/<rPh[\s\S]*?<\/rPh>/g, "").replace(/<[^>]+>/g, "").replace(/\s/g, "") === "공급가";
    })?.[1]
  );
  assert.ok(supplyRow > 0, "공급가 줄을 못 찾았다");
  sheetXml = withCachedValue(sheetXml, `I${supplyRow}`, 3_500_000);

  const workbook = writeZip(
    archive.list().map((name) => ({
      name,
      data: name === sheetPart ? Buffer.from(sheetXml, "utf8") : (archive.readEntry(name) as Buffer),
    }))
  );
  const { grid } = expectOk(buildQuoteExcelPreview(workbook));
  const at = (row: number, column: number) =>
    grid.rows.find((one) => one.row === row)?.cells.find((one) => one.column === column);

  // 1) 공급가 줄 바로 위 금액 열 — 도우미 칸의 ₩0 은 조건부 서식으로 흰 글자.
  const helper = at(supplyRow - 1, 9);
  assert.equal(helper?.text, "₩0", "재현 전제: 도우미 칸의 계산값 0 이 ₩0 으로 찍힌다");
  assert.equal(helper?.fontColor, "#FFFFFF", "Excel 은 이 ₩0 을 흰 글자로 감춘다");
  // 조건부 서식을 안 읽는 호출(보고서와 같은 길)은 예전 그대로 — 색이 없다.
  const plain = readSheetPrintGrid(workbook, QUOTE_SHEET_NAME);
  assert.equal(
    plain.rows.find((one) => one.row === supplyRow - 1)?.cells.find((one) => one.column === 9)?.fontColor,
    null
  );

  // 2) 금액 칸은 수 — 맞춤을 안 적은 칸(단가 · 합계)은 화면이 오른쪽에 붙인다.
  assert.equal(at(supplyRow, 9)?.text, "₩3,500,000");
  assert.equal(at(supplyRow, 9)?.valueKind, "number");
  const unaligned = grid.rows.flatMap((row) => row.cells).filter((one) => one.column >= 8 && one.valueKind === "number" && one.align === null);
  assert.ok(unaligned.length > 0, "맞춤을 안 적은 금액 칸이 없다 — 재현이 되지 않았다");

  // 3) 발행일자 — 미리보기는 파일에 저장된 계산값을 그린다(Excel 은 열 때 TODAY() 를 다시 셈한다).
  assert.equal(cellText(grid, QUOTE_CELLS.quoteDate), "2026년 8월 31일");
});
