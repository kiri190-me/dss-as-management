import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  buildPortalExportRows,
  findPortalExportSpec,
  type PortalExportItem,
} from "@/lib/domain/customer-portal-export";
import { findPortalFormById, type CustomerPortalForm } from "@/lib/domain/customer-portal-forms";

import {
  buildCustomerPortalExportWorkbook,
  CustomerPortalExportError,
  parseWorkbookSheets,
  readDateStyleIndexes,
} from "./customer-portal-export-workbook";
import { buildSheetGrid, parseSharedStringsWithoutPhonetics } from "./sheet-grid";
import { SHARED_STRINGS_PART, WORKBOOK_PART, WORKBOOK_RELS_PART } from "./workbook-parts";
import { ZipArchive } from "./zip-reader";
import { writeZip, type ZipEntryInput } from "./zip-writer";

/*
 * 🔴 시험용 통합문서는 전부 zip-writer 로 만든 **가짜**다. 공유폴더의 실제 고객사 파일을
 * 열지 않는다. 대신 그 파일들의 **모양**(머리글 줄 · 시작 열 · 탭 차례 · 날짜 칸)은 실측
 * (2026-09-30)을 따른다 — 모양이 어긋나면 시험이 통과해도 실제로는 깨지기 때문이다.
 */

const MAIN_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PKG_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships";
const WORKSHEET_TYPE = `${REL_NS}/worksheet`;

/** 날짜 서식 하나(numFmtId 14)와 글자 서식 하나. 0 = 보통, 1 = 날짜. */
const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="${MAIN_NS}"><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="14" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy&quot;년&quot;"/></numFmts></styleSheet>`;

type FixtureSheet = { name: string; sheetId: number; xml: string };

function textCell(reference: string, style: number, value: string): string {
  return `<c r="${reference}" s="${style}" t="inlineStr"><is><t>${value}</t></is></c>`;
}

/**
 * 고객사 파일 한 장의 모양 — 머리글 줄 하나와 자료 줄들, 그리고 자동 필터.
 * `dateColumns` 에 든 열은 날짜 서식(s=1)을 가진 빈 칸으로 둔다.
 */
function formSheetXml(params: {
  headerRow: number;
  headers: readonly string[];
  dataRowCount: number;
  dateColumns?: readonly string[];
  /** 머리글 위에 둘 칸들(JUSUNG 의 N1 · N2 자리). */
  aboveHeader?: readonly { reference: string; style: number; value?: string }[];
  merges?: readonly string[];
  autoFilter?: boolean;
  lastColumn: string;
}): string {
  const dateColumns = new Set(params.dateColumns ?? []);
  const rows: string[] = [];

  for (const cell of params.aboveHeader ?? []) {
    const row = Number(/\d+$/.exec(cell.reference)?.[0] ?? "1");
    rows.push(
      `<row r="${row}">${
        cell.value === undefined
          ? `<c r="${cell.reference}" s="${cell.style}"/>`
          : textCell(cell.reference, cell.style, cell.value)
      }</row>`
    );
  }

  const headerCells = params.headers
    .map((label, index) => textCell(`${columnAt(index)}${params.headerRow}`, 0, label))
    .join("");
  rows.push(`<row r="${params.headerRow}" spans="2:${params.headers.length + 1}">${headerCells}</row>`);

  for (let index = 0; index < params.dataRowCount; index += 1) {
    const rowNumber = params.headerRow + 1 + index;
    const cells = params.headers
      .map((_label, column) => {
        const letters = columnAt(column);
        const style = dateColumns.has(letters) ? 1 : 0;
        // 첫 열은 줄 번호(숫자), 나머지는 글자. 마지막 열은 일부러 빈 칸으로 둔다
        // (본 줄에 칸이 없어도 값이 들어가는지 보려는 것이다).
        if (column === 0) return `<c r="${letters}${rowNumber}" s="0"><v>${index + 1}</v></c>`;
        if (column === params.headers.length - 1) return "";
        return textCell(`${letters}${rowNumber}`, style, `옛값${index + 1}`);
      })
      .join("");
    rows.push(`<row r="${rowNumber}" ht="20" customHeight="1">${cells}</row>`);
  }

  const lastRow = params.headerRow + params.dataRowCount;
  const merges =
    params.merges && params.merges.length > 0
      ? `<mergeCells count="${params.merges.length}">${params.merges
          .map((reference) => `<mergeCell ref="${reference}"/>`)
          .join("")}</mergeCells>`
      : "";
  const autoFilter =
    params.autoFilter === false
      ? ""
      : `<autoFilter ref="B${params.headerRow}:${params.lastColumn}${lastRow - 1}"/>`;

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="${MAIN_NS}" xmlns:r="${REL_NS}"><dimension ref="B1:${params.lastColumn}${lastRow}"/><sheetViews><sheetView tabSelected="1" workbookViewId="0"/></sheetViews><sheetData>${rows.join(
    ""
  )}</sheetData>${autoFilter}${merges}<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/></worksheet>`;
}

/** 0 → "B", 1 → "C" … 표는 B 열부터다. */
function columnAt(index: number): string {
  let number = index + 2;
  let letters = "";
  while (number > 0) {
    const remainder = (number - 1) % 26;
    letters = String.fromCharCode(65 + remainder) + letters;
    number = Math.floor((number - 1) / 26);
  }
  return letters;
}

function buildFixtureWorkbook(params: {
  sheets: readonly FixtureSheet[];
  definedNames?: string;
  activeTab?: number;
}): Buffer {
  const sheetTags = params.sheets
    .map((sheet, index) => `<sheet name="${sheet.name}" sheetId="${sheet.sheetId}" r:id="rId${index + 1}"/>`)
    .join("");
  const workbookViews = `<bookViews><workbookView${
    params.activeTab === undefined ? "" : ` activeTab="${params.activeTab}"`
  }/></bookViews>`;
  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="${MAIN_NS}" xmlns:r="${REL_NS}">${workbookViews}<sheets>${sheetTags}</sheets>${
    params.definedNames ?? ""
  }</workbook>`;

  const relationships = params.sheets
    .map(
      (_sheet, index) =>
        `<Relationship Id="rId${index + 1}" Type="${WORKSHEET_TYPE}" Target="worksheets/sheet${index + 1}.xml"/>`
    )
    .join("");
  const stylesRelId = params.sheets.length + 1;

  const overrides = params.sheets
    .map(
      (_sheet, index) =>
        `<Override PartName="/xl/worksheets/sheet${
          index + 1
        }.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
    )
    .join("");

  const entries: ZipEntryInput[] = [
    {
      name: "[Content_Types].xml",
      data: Buffer.from(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${overrides}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
        "utf8"
      ),
    },
    {
      name: "_rels/.rels",
      data: Buffer.from(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${PKG_REL_NS}"><Relationship Id="rId1" Type="${REL_NS}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
        "utf8"
      ),
    },
    { name: WORKBOOK_PART, data: Buffer.from(workbookXml, "utf8") },
    {
      name: WORKBOOK_RELS_PART,
      data: Buffer.from(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${PKG_REL_NS}">${relationships}<Relationship Id="rId${stylesRelId}" Type="${REL_NS}/styles" Target="styles.xml"/></Relationships>`,
        "utf8"
      ),
    },
    { name: STYLES_PART_NAME, data: Buffer.from(STYLES_XML, "utf8") },
    ...params.sheets.map((sheet, index) => ({
      name: `xl/worksheets/sheet${index + 1}.xml`,
      data: Buffer.from(sheet.xml, "utf8"),
    })),
  ];
  return writeZip(entries);
}

const STYLES_PART_NAME = "xl/styles.xml";

function labelsOf(form: CustomerPortalForm): string[] {
  return form.columns.map((column) => column.label);
}

function item(overrides: Partial<PortalExportItem> = {}): PortalExportItem {
  return {
    intakeNumber: "AS-2026-0001",
    endUserName: "가상 사이트",
    modelName: "MBK300M-AD2",
    lotNumber: "WU0001",
    serialNumber: "0016020",
    receivedAt: "2026-09-15",
    quoteNumber: "DSS2026-001",
    quoteIssuedDate: "2026-09-18",
    orderIssuedDate: "2026-09-20",
    customerRequestedDueDate: "2026-10-10",
    statusLabel: "수리 진행 중",
    statusNote: "비고",
    formValues: {},
    ...overrides,
  };
}

const TODAY = new Date(2026, 8, 30);
const STAMP = "260930";

function gridOf(bytes: Buffer, sheetName: string) {
  const archive = ZipArchive.fromBuffer(bytes);
  const workbookXml = archive.readText(WORKBOOK_PART);
  const sheets = parseWorkbookSheets(workbookXml);
  const sheet = sheets.find((candidate) => candidate.name === sheetName);
  assert.notEqual(sheet, undefined, `${sheetName} 탭이 없다`);
  const rels = archive.readText(WORKBOOK_RELS_PART);
  const target = new RegExp(`Id="${sheet!.relId}"[^>]*Target="([^"]+)"`).exec(rels)?.[1];
  assert.notEqual(target, undefined);
  const part = target!.startsWith("/") ? target!.slice(1) : `xl/${target}`;
  const sheetXml = archive.readText(part);
  return {
    archive,
    sheetXml,
    grid: buildSheetGrid(
      sheetXml,
      parseSharedStringsWithoutPhonetics(archive.readTextOrNull(SHARED_STRINGS_PART)),
      false
    ),
  };
}

// ── ICD — 탭 하나를 덮어쓴다 ─────────────────────────────────────────────

const ICD_FORM = findPortalFormById("ICD")!;
const ICD_SPEC = findPortalExportSpec("ICD")!;
const ICD_SHEET_NAME = "수리 Parts (ICD)";

function icdWorkbook(dataRowCount = 4): Buffer {
  return buildFixtureWorkbook({
    sheets: [
      {
        name: ICD_SHEET_NAME,
        sheetId: 1,
        xml: formSheetXml({
          headerRow: 5,
          // 🔴 마지막 머리글은 실제 파일처럼 여러 줄이다.
          headers: labelsOf(ICD_FORM).map((label, index) =>
            index === ICD_FORM.columns.length - 1 ? `${label}&#10;* 아래 날짜를 참고해 주세요.` : label
          ),
          dataRowCount,
          dateColumns: ["H", "I"],
          merges: ["B2:M2"],
          lastColumn: "M",
        }),
      },
    ],
    definedNames: `<definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">'수리 Parts (ICD)'!$B$5:$M$8</definedName></definedNames>`,
  });
}

describe("ICD — 탭 하나를 덮어쓴다", () => {
  test("탭이 늘지 않고 이름도 그대로다", () => {
    const built = buildCustomerPortalExportWorkbook({
      previousBytes: icdWorkbook(),
      form: ICD_FORM,
      spec: ICD_SPEC,
      rows: buildPortalExportRows(ICD_FORM, [item(), item()]),
      stamp: STAMP,
      today: TODAY,
    });
    const sheets = parseWorkbookSheets(ZipArchive.fromBuffer(built.bytes).readText(WORKBOOK_PART));
    assert.equal(sheets.length, 1);
    assert.equal(sheets[0].name, ICD_SHEET_NAME);
    assert.equal(built.sheetName, ICD_SHEET_NAME);
  });

  test("🔴 여러 줄짜리 머리글이어도 첫 줄이 같으면 통과한다", () => {
    assert.doesNotThrow(() =>
      buildCustomerPortalExportWorkbook({
        previousBytes: icdWorkbook(),
        form: ICD_FORM,
        spec: ICD_SPEC,
        rows: buildPortalExportRows(ICD_FORM, [item()]),
        stamp: STAMP,
        today: TODAY,
      })
    );
  });

  test("머리글 위의 제목 병합은 그대로 남는다", () => {
    const built = buildCustomerPortalExportWorkbook({
      previousBytes: icdWorkbook(),
      form: ICD_FORM,
      spec: ICD_SPEC,
      rows: buildPortalExportRows(ICD_FORM, [item()]),
      stamp: STAMP,
      today: TODAY,
    });
    assert.match(gridOf(built.bytes, ICD_SHEET_NAME).sheetXml, /<mergeCell ref="B2:M2"\/>/);
  });
});

// ── INVENIA — 탭 하나, 이름만 오늘 날짜로 ────────────────────────────────

const INVENIA_FORM = findPortalFormById("INVENIA")!;
const INVENIA_SPEC = findPortalExportSpec("INVENIA")!;

function inveniaWorkbook(dataRowCount = 6): Buffer {
  return buildFixtureWorkbook({
    sheets: [
      {
        name: "260929",
        sheetId: 1,
        xml: formSheetXml({
          headerRow: 3,
          headers: labelsOf(INVENIA_FORM),
          dataRowCount,
          dateColumns: ["G"],
          aboveHeader: [{ reference: "J1", style: 0, value: "협력사 명 : 디에스에스" }],
          // 실제 파일처럼 비고가 두 칸 병합이고, 표 아래에도 남은 병합이 있다.
          // 줄을 줄이면 K11 이 K6 자리로 밀려 이미 있는 K6:L6 과 겹친다 — 그 자리를 시험한다.
          merges: ["J1:K2", "K3:L3", "K4:L4", "K5:L5", "K6:L6", "K11:L11", "K12:L12"],
          lastColumn: "L",
        }),
      },
    ],
    definedNames: `<definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">'260929'!$B$3:$L$8</definedName></definedNames>`,
  });
}

describe("INVENIA — 탭 하나, 이름만 오늘 날짜로", () => {
  test("탭이 늘지 않고 이름이 오늘 날짜가 된다", () => {
    const built = buildCustomerPortalExportWorkbook({
      previousBytes: inveniaWorkbook(),
      form: INVENIA_FORM,
      spec: INVENIA_SPEC,
      rows: buildPortalExportRows(INVENIA_FORM, [item(), item()]),
      stamp: STAMP,
      today: TODAY,
    });
    const sheets = parseWorkbookSheets(ZipArchive.fromBuffer(built.bytes).readText(WORKBOOK_PART));
    assert.equal(sheets.length, 1);
    assert.equal(sheets[0].name, STAMP);
    assert.equal(built.sheetName, STAMP);
    assert.equal(built.modelSheetName, "260929");
  });

  test("🔴 이름이 바뀌면 그 이름을 부르던 숨은 이름도 함께 바뀐다", () => {
    const built = buildCustomerPortalExportWorkbook({
      previousBytes: inveniaWorkbook(),
      form: INVENIA_FORM,
      spec: INVENIA_SPEC,
      rows: buildPortalExportRows(INVENIA_FORM, [item(), item()]),
      stamp: STAMP,
      today: TODAY,
    });
    const workbookXml = ZipArchive.fromBuffer(built.bytes).readText(WORKBOOK_PART);
    assert.match(workbookXml, /_xlnm\._FilterDatabase[^>]*>'260930'!\$B\$3:\$L\$5</);
    assert.equal(workbookXml.includes("'260929'!"), false);
  });

  test("🔴 줄이 줄어도 겹치는 병합이 남지 않는다", () => {
    const built = buildCustomerPortalExportWorkbook({
      previousBytes: inveniaWorkbook(6),
      form: INVENIA_FORM,
      spec: INVENIA_SPEC,
      rows: buildPortalExportRows(INVENIA_FORM, [item()]),
      stamp: STAMP,
      today: TODAY,
    });
    const refs = [...gridOf(built.bytes, STAMP).sheetXml.matchAll(/<mergeCell ref="([^"]+)"\/>/g)].map(
      (match) => match[1]
    );
    assert.equal(new Set(refs).size, refs.length, `같은 병합이 둘 있다: ${refs.join(" ")}`);
    const boxes = refs.map(parseBox);
    for (let left = 0; left < boxes.length; left += 1) {
      for (let right = left + 1; right < boxes.length; right += 1) {
        assert.equal(overlaps(boxes[left], boxes[right]), false, `병합이 겹친다: ${refs[left]} / ${refs[right]}`);
      }
    }
  });

  test("줄이 늘면 새 줄에도 한 줄짜리 병합이 생긴다", () => {
    const built = buildCustomerPortalExportWorkbook({
      previousBytes: inveniaWorkbook(2),
      form: INVENIA_FORM,
      spec: INVENIA_SPEC,
      rows: buildPortalExportRows(INVENIA_FORM, [item(), item(), item(), item()]),
      stamp: STAMP,
      today: TODAY,
    });
    const sheetXml = gridOf(built.bytes, STAMP).sheetXml;
    // 자료 줄은 4~7행 — 본 줄(5행)의 K:L 병합이 새 줄에도 복제된다.
    assert.match(sheetXml, /<mergeCell ref="K6:L6"\/>/);
    assert.match(sheetXml, /<mergeCell ref="K7:L7"\/>/);
  });
});

function parseBox(reference: string) {
  const found = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(reference)!;
  const letters = (value: string) => [...value].reduce((total, character) => total * 26 + character.charCodeAt(0) - 64, 0);
  return { left: letters(found[1]), top: Number(found[2]), right: letters(found[3]), bottom: Number(found[4]) };
}

function overlaps(a: ReturnType<typeof parseBox>, b: ReturnType<typeof parseBox>): boolean {
  return a.left <= b.right && b.left <= a.right && a.top <= b.bottom && b.top <= a.bottom;
}

// ── JUSUNG — 탭을 하나 더한다 ────────────────────────────────────────────

const JUSUNG_FORM = findPortalFormById("JUSUNG")!;
const JUSUNG_SPEC = findPortalExportSpec("JUSUNG")!;

/** 실제 파일처럼 **최신이 앞**이다. */
function jusungWorkbook(dataRowCount = 5): Buffer {
  const older = (name: string, sheetId: number): FixtureSheet => ({
    name,
    sheetId,
    xml: formSheetXml({
      headerRow: 4,
      headers: labelsOf(JUSUNG_FORM),
      dataRowCount,
      dateColumns: ["J", "K", "L"],
      aboveHeader: [
        { reference: "N1", style: 1 },
        { reference: "N2", style: 0, value: "협력사 명 : 디에스에스" },
      ],
      lastColumn: "N",
    }),
  });
  return buildFixtureWorkbook({
    sheets: [older("260929", 88), older("260922", 87), older("260915", 86)],
    definedNames: `<definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="2" hidden="1">'260915'!$B$4:$N$9</definedName></definedNames>`,
    activeTab: 0,
  });
}

describe("JUSUNG — 탭을 하나 더한다", () => {
  const built = () =>
    buildCustomerPortalExportWorkbook({
      previousBytes: jusungWorkbook(),
      form: JUSUNG_FORM,
      spec: JUSUNG_SPEC,
      rows: buildPortalExportRows(JUSUNG_FORM, [item(), item(), item()]),
      stamp: STAMP,
      today: TODAY,
    });

  test("🔴 탭이 하나 늘고, 새 탭이 맨 앞이다", () => {
    const sheets = parseWorkbookSheets(ZipArchive.fromBuffer(built().bytes).readText(WORKBOOK_PART));
    assert.equal(sheets.length, 4);
    assert.deepEqual(
      sheets.map((sheet) => sheet.name),
      [STAMP, "260929", "260922", "260915"]
    );
  });

  test("🔴 옛 탭의 파트가 **한 바이트도** 바뀌지 않는다", () => {
    const previousBytes = jusungWorkbook();
    const before = ZipArchive.fromBuffer(previousBytes);
    const after = ZipArchive.fromBuffer(
      buildCustomerPortalExportWorkbook({
        previousBytes,
        form: JUSUNG_FORM,
        spec: JUSUNG_SPEC,
        rows: buildPortalExportRows(JUSUNG_FORM, [item()]),
        stamp: STAMP,
        today: TODAY,
      }).bytes
    );

    const worksheetParts = before.list().filter((name) => name.startsWith("xl/worksheets/"));
    assert.equal(worksheetParts.length, 3);
    for (const part of worksheetParts) {
      const original = before.readEntry(part);
      const now = after.readEntry(part);
      assert.notEqual(now, null, `${part} 가 사라졌다`);
      assert.equal(original!.equals(now!), true, `${part} 가 바뀌었다`);
    }
  });

  test("새 탭은 새 파트에 들어가고 내용 형식 · 관계도 함께 늘어난다", () => {
    const after = ZipArchive.fromBuffer(built().bytes);
    assert.equal(after.list().filter((name) => name.startsWith("xl/worksheets/")).length, 4);
    assert.equal(
      [...after.readText("[Content_Types].xml").matchAll(/spreadsheetml\.worksheet\+xml/g)].length,
      4
    );
    assert.equal([...after.readText(WORKBOOK_RELS_PART).matchAll(/relationships\/worksheet"/g)].length, 4);
    assert.equal(after.hasDuplicateEntryNames(), false);
  });

  test("🔴 탭을 앞에 끼운 만큼 숨은 이름의 시트 자리번호가 밀린다", () => {
    const workbookXml = ZipArchive.fromBuffer(built().bytes).readText(WORKBOOK_PART);
    assert.match(workbookXml, /_xlnm\._FilterDatabase"[^>]*localSheetId="3"/);
    assert.match(workbookXml, /<workbookView[^>]*activeTab="1"/);
  });

  test("🔴 4) 그 주의 날짜가 N1 에 들어간다", () => {
    const { grid, sheetXml } = gridOf(built().bytes, STAMP);
    const cell = grid.cells(1).get("N");
    assert.equal(cell?.kind, "number");
    // 2026-09-30 의 엑셀 일련번호.
    assert.equal(cell?.kind === "number" ? cell.value : null, 46295);
    // 서식 번호는 본 탭의 것을 그대로 물려받는다(날짜 서식이 유지된다).
    assert.match(sheetXml, /<c r="N1" s="1"><v>46295<\/v><\/c>/);
  });

  test("베낀 탭에서는 「고른 탭」 표시를 뗀다", () => {
    assert.equal(gridOf(built().bytes, STAMP).sheetXml.includes("tabSelected"), false);
    // 옛 탭은 그대로다.
    assert.equal(gridOf(built().bytes, "260929").sheetXml.includes('tabSelected="1"'), true);
  });
});

// ── 공통 — 값 · 머리글 · 자동 필터 ───────────────────────────────────────

describe("값이 제자리에 들어간다", () => {
  test("🔴 8) 손으로 적은 값이 그 열의 칸에 들어간다", () => {
    const rows = buildPortalExportRows(JUSUNG_FORM, [
      item({
        formValues: {
          prvNumber: "R2405-2246391",
          qCode: "Q1",
          qLevel: "L2",
          passNumber: "EP2406030019",
          repairRequestDate: "2026-09-22",
        },
      }),
    ]);
    const bytes = buildCustomerPortalExportWorkbook({
      previousBytes: jusungWorkbook(),
      form: JUSUNG_FORM,
      spec: JUSUNG_SPEC,
      rows,
      stamp: STAMP,
      today: TODAY,
    }).bytes;

    const { grid } = gridOf(bytes, STAMP);
    const cells = grid.cells(5);
    // B..N — 양식의 열 차례 그대로다.
    assert.deepEqual(cells.get("D"), { kind: "text", text: "R2405-2246391" });
    assert.deepEqual(cells.get("E"), { kind: "text", text: "Q1" });
    assert.deepEqual(cells.get("F"), { kind: "text", text: "L2" });
    assert.deepEqual(cells.get("I"), { kind: "text", text: "EP2406030019" });
    // 수리 요청일은 날짜 서식 칸이라 날짜(일련번호)로 들어간다.
    assert.deepEqual(cells.get("L"), { kind: "number", value: 46287 });
  });

  test("본 줄에 칸이 없던 자리에도 값이 들어간다(비고 열)", () => {
    const bytes = buildCustomerPortalExportWorkbook({
      previousBytes: jusungWorkbook(),
      form: JUSUNG_FORM,
      spec: JUSUNG_SPEC,
      rows: buildPortalExportRows(JUSUNG_FORM, [item({ statusNote: "마지막 열" })]),
      stamp: STAMP,
      today: TODAY,
    }).bytes;
    assert.deepEqual(gridOf(bytes, STAMP).grid.cells(5).get("N"), { kind: "text", text: "마지막 열" });
  });

  test("🔴 숫자처럼 보이는 글자를 숫자로 바꾸지 않는다(앞의 0 이 사라지지 않게)", () => {
    const bytes = buildCustomerPortalExportWorkbook({
      previousBytes: jusungWorkbook(),
      form: JUSUNG_FORM,
      spec: JUSUNG_SPEC,
      rows: buildPortalExportRows(JUSUNG_FORM, [item({ serialNumber: "0012345" })]),
      stamp: STAMP,
      today: TODAY,
    }).bytes;
    assert.deepEqual(gridOf(bytes, STAMP).grid.cells(5).get("H"), { kind: "text", text: "0012345" });
  });

  test("날짜 서식이 아닌 칸의 날짜는 글자로 적힌다(일련번호가 찍히지 않게)", () => {
    // ICD 의 「중국 재 수출 마감 일자」 칸은 본 파일에서 날짜 서식이 아니다.
    const bytes = buildCustomerPortalExportWorkbook({
      previousBytes: icdWorkbook(),
      form: ICD_FORM,
      spec: ICD_SPEC,
      rows: buildPortalExportRows(ICD_FORM, [item({ formValues: { chinaReExportDeadline: "2026-12-01" } })]),
      stamp: STAMP,
      today: TODAY,
    }).bytes;
    assert.deepEqual(gridOf(bytes, ICD_SHEET_NAME).grid.cells(6).get("M"), {
      kind: "text",
      text: "2026-12-01",
    });
  });

  test("줄이 줄면 옛 줄이 남지 않는다", () => {
    const bytes = buildCustomerPortalExportWorkbook({
      previousBytes: icdWorkbook(6),
      form: ICD_FORM,
      spec: ICD_SPEC,
      rows: buildPortalExportRows(ICD_FORM, [item()]),
      stamp: STAMP,
      today: TODAY,
    }).bytes;
    const { grid } = gridOf(bytes, ICD_SHEET_NAME);
    assert.notEqual(grid.cells(6).get("B"), undefined);
    assert.equal(grid.cells(7).get("B"), undefined, "지워졌어야 할 줄이 남아 있다");
  });

  test("줄이 하나도 없으면 표가 비고 머리글은 남는다", () => {
    const bytes = buildCustomerPortalExportWorkbook({
      previousBytes: icdWorkbook(3),
      form: ICD_FORM,
      spec: ICD_SPEC,
      rows: [],
      stamp: STAMP,
      today: TODAY,
    }).bytes;
    const { grid } = gridOf(bytes, ICD_SHEET_NAME);
    assert.notEqual(grid.cells(5).get("B"), undefined);
    assert.equal(grid.cells(6).get("B"), undefined);
  });
});

describe("🔴 5) 머리글이 다르면 적지 않는다", () => {
  test("열 하나의 이름이 다르면 던진다", () => {
    const broken = buildFixtureWorkbook({
      sheets: [
        {
          name: "260929",
          sheetId: 1,
          xml: formSheetXml({
            headerRow: 4,
            headers: labelsOf(JUSUNG_FORM).map((label, index) => (index === 9 ? "수리 예정일" : label)),
            dataRowCount: 3,
            aboveHeader: [{ reference: "N1", style: 1 }],
            lastColumn: "N",
          }),
        },
      ],
    });
    assert.throws(
      () =>
        buildCustomerPortalExportWorkbook({
          previousBytes: broken,
          form: JUSUNG_FORM,
          spec: JUSUNG_SPEC,
          rows: buildPortalExportRows(JUSUNG_FORM, [item()]),
          stamp: STAMP,
          today: TODAY,
        }),
      (error: unknown) =>
        error instanceof CustomerPortalExportError &&
        error.message.includes("납품 요청일") &&
        error.message.includes("수리 예정일")
    );
  });

  test("열이 하나 밀려 있으면 던진다 — 값이 옆 칸에 앉지 않게", () => {
    const shifted = buildFixtureWorkbook({
      sheets: [
        {
          name: "260929",
          sheetId: 1,
          xml: formSheetXml({
            headerRow: 3,
            headers: ["끼워 넣은 열", ...labelsOf(INVENIA_FORM)],
            dataRowCount: 3,
            lastColumn: "L",
          }),
        },
      ],
    });
    assert.throws(
      () =>
        buildCustomerPortalExportWorkbook({
          previousBytes: shifted,
          form: INVENIA_FORM,
          spec: INVENIA_SPEC,
          rows: buildPortalExportRows(INVENIA_FORM, [item()]),
          stamp: STAMP,
          today: TODAY,
        }),
      CustomerPortalExportError
    );
  });

  test("ICD 의 고정 탭이 없으면 다른 탭을 짐작하지 않는다", () => {
    const wrongName = buildFixtureWorkbook({
      sheets: [
        {
          name: "다른 이름",
          sheetId: 1,
          xml: formSheetXml({ headerRow: 5, headers: labelsOf(ICD_FORM), dataRowCount: 2, lastColumn: "M" }),
        },
      ],
    });
    assert.throws(
      () =>
        buildCustomerPortalExportWorkbook({
          previousBytes: wrongName,
          form: ICD_FORM,
          spec: ICD_SPEC,
          rows: buildPortalExportRows(ICD_FORM, [item()]),
          stamp: STAMP,
          today: TODAY,
        }),
      (error: unknown) => error instanceof CustomerPortalExportError && error.message.includes("수리 Parts (ICD)")
    );
  });
});

describe("🔴 6) 자동 필터 범위가 실제 줄 수와 맞는다", () => {
  test("줄이 늘어도 줄어도 마지막 줄까지 덮는다", () => {
    for (const rowCount of [1, 3, 9]) {
      const bytes = buildCustomerPortalExportWorkbook({
        previousBytes: icdWorkbook(4),
        form: ICD_FORM,
        spec: ICD_SPEC,
        rows: buildPortalExportRows(ICD_FORM, Array.from({ length: rowCount }, () => item())),
        stamp: STAMP,
        today: TODAY,
      }).bytes;
      const sheetXml = gridOf(bytes, ICD_SHEET_NAME).sheetXml;
      assert.match(
        sheetXml,
        new RegExp(`<autoFilter ref="B5:M${5 + rowCount}"`),
        `${rowCount}줄일 때 필터 범위가 어긋난다`
      );
      // 표의 마지막 줄이 실제로 그 줄이다.
      const grid = gridOf(bytes, ICD_SHEET_NAME).grid;
      assert.notEqual(grid.cells(5 + rowCount).get("B"), undefined);
      assert.equal(grid.cells(6 + rowCount).get("B"), undefined);
    }
  });

  test("열 범위는 우리가 넓히지 않는다", () => {
    const bytes = buildCustomerPortalExportWorkbook({
      previousBytes: inveniaWorkbook(),
      form: INVENIA_FORM,
      spec: INVENIA_SPEC,
      rows: buildPortalExportRows(INVENIA_FORM, [item(), item()]),
      stamp: STAMP,
      today: TODAY,
    }).bytes;
    assert.match(gridOf(bytes, STAMP).sheetXml, /<autoFilter ref="B3:L5"/);
  });

  test("필터가 없던 시트에는 만들어 주지 않는다", () => {
    const noFilter = buildFixtureWorkbook({
      sheets: [
        {
          name: "260929",
          sheetId: 1,
          xml: formSheetXml({
            headerRow: 3,
            headers: labelsOf(INVENIA_FORM),
            dataRowCount: 2,
            autoFilter: false,
            lastColumn: "L",
          }),
        },
      ],
    });
    const bytes = buildCustomerPortalExportWorkbook({
      previousBytes: noFilter,
      form: INVENIA_FORM,
      spec: INVENIA_SPEC,
      rows: buildPortalExportRows(INVENIA_FORM, [item()]),
      stamp: STAMP,
      today: TODAY,
    }).bytes;
    assert.equal(gridOf(bytes, STAMP).sheetXml.includes("<autoFilter"), false);
  });
});

describe("서식이 날짜인가", () => {
  test("규격의 날짜 번호와 스스로 만든 날짜 서식을 알아본다", () => {
    const indexes = readDateStyleIndexes(STYLES_XML);
    assert.equal(indexes.has(0), false);
    assert.equal(indexes.has(1), true);
    assert.equal(indexes.has(2), true);
  });

  test("서식이 없으면 아무것도 날짜가 아니다", () => {
    assert.equal(readDateStyleIndexes(null).size, 0);
  });
});

describe("망가진 파일", () => {
  test("엑셀이 아니면 사람이 읽는 사유로 끝난다", () => {
    assert.throws(
      () =>
        buildCustomerPortalExportWorkbook({
          previousBytes: Buffer.from("엑셀이 아니다"),
          form: ICD_FORM,
          spec: ICD_SPEC,
          rows: [],
          stamp: STAMP,
          today: TODAY,
        }),
      CustomerPortalExportError
    );
  });
});
