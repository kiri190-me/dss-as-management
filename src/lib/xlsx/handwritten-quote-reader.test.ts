import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

import type { QuoteTemplateKey } from "../domain/quote-template-variant";
import {
  parseQuoteDateText,
  readHandwrittenQuoteWorkbook,
  splitProductInfoLine,
  type HandwrittenQuoteFields,
  type HandwrittenQuoteKind,
  type HandwrittenQuoteReadFailureCode,
  type HandwrittenQuoteReadResult,
  type HandwrittenQuoteSheet,
} from "./handwritten-quote-reader";
import {
  fillMatcherQuoteWorkbook,
  MATCHER_OVERHAUL_WORK_LABEL,
  MATCHER_QUOTE_CELLS,
  MATCHER_QUOTE_SHEET_NAME,
  MATCHER_WORK_SCOPE_LABELS,
  type MatcherQuoteInput,
} from "./matcher-quote-template";
import {
  fillOhQuoteWorkbook,
  OH_QUOTE_CELLS,
  OH_QUOTE_OVERHAUL_PARTS_LABEL,
  OH_QUOTE_SHEET_NAME,
  OH_QUOTE_WORK_SCOPE_LABELS,
} from "./oh-quote-template";
import { findSpacedLabelRow, LAYOUT_COLUMNS } from "./quote-sheet-layout";
import {
  fillQuoteWorkbook,
  QUOTE_CELLS,
  QUOTE_SHEET_NAME,
  QUOTE_WORK_SCOPE_LABELS,
  type GeneratorQuoteInput,
} from "./quote-template";
import { parseSheetRows } from "./sheet-rows";
import { createCellTextReader } from "./sheet-text";
import { resolveSheetPart, SHARED_STRINGS_PART } from "./workbook-parts";
import { ZipArchive } from "./zip-reader";
import { writeZip, type ZipEntryInput } from "./zip-writer";

/**
 * ============================================================================
 * 수기 견적서 엑셀 읽개 (견적서 ①a)
 * ============================================================================
 * 앞의 묶음들은 zip-writer 로 만든 **가짜 통합문서**로 돈다 — 양식 없이도 돈다. 칸 주소는
 * 채우개의 칸 지도(QUOTE_CELLS 등)를 그대로 쓴다. 공급처 · 모델은 가짜 이름이다(저장소가
 * 공개다). 실제 고객 파일은 열지 않는다.
 *
 * 맨 뒤 「왕복」 묶음은 **실제 양식 넷**을 기존 채우개로 채운 뒤 읽는다(양식 경로가 없는
 * 환경에서는 건너뛴다 — xlsx 양식 시험들과 같은 규칙). 🔴 채우개는 수식의 계산값(`<v>`)을
 * 남기지 않는다(fullCalcOnLoad). 그래서 공급가액은 채운 파일의 공급가 칸에 계산값을 끼워
 * 넣어 **Excel 로 저장한 파일을 흉내 낸** 입력으로 따로 본다.
 * ============================================================================
 */

const MAIN_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PKG_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships";

/** 0 일반 · 1 기본 날짜(14) · 2 사용자 날짜(164 — 자식이 있는 xf) · 3 #,##0 */
const STYLES_XML =
  `<styleSheet xmlns="${MAIN_NS}">` +
  `<numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy&quot;년&quot; m&quot;월&quot; d&quot;일&quot;"/></numFmts>` +
  `<cellXfs count="4"><xf numFmtId="0" fontId="0"/><xf numFmtId="14" applyNumberFormat="1"/>` +
  `<xf numFmtId="164" applyNumberFormat="1"><alignment horizontal="left"/></xf>` +
  `<xf numFmtId="3" applyNumberFormat="1"/></cellXfs>` +
  `</styleSheet>`;
const STYLE = { general: 0, date: 1, customDate: 2, amount: 3 } as const;

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function str(ref: string, text: string): string {
  return `<c r="${ref}" t="inlineStr"><is><t>${escapeXml(text)}</t></is></c>`;
}

function num(ref: string, value: number, style: number = STYLE.amount): string {
  return `<c r="${ref}" s="${style}"><v>${value}</v></c>`;
}

/** 수식 칸. `cached` 를 주면 Excel 이 저장한 계산값(`<v>`)이 붙는다. */
function fml(ref: string, formula: string, cached?: number, style: number = STYLE.amount): string {
  const value = cached === undefined ? "" : `<v>${cached}</v>`;
  return `<c r="${ref}" s="${style}"><f>${escapeXml(formula)}</f>${value}</c>`;
}

/** 1900 체계 일련번호(UTC 로 셈한다). */
function serialOf(year: number, month: number, day: number): number {
  return (Date.UTC(year, month - 1, day) - Date.UTC(1899, 11, 30)) / 86_400_000;
}

function sheetXmlOf(cells: readonly string[]): string {
  const byRow = new Map<number, string[]>();
  for (const cell of cells) {
    const row = Number(/\sr="[A-Z]+(\d+)"/.exec(cell)?.[1]);
    byRow.set(row, [...(byRow.get(row) ?? []), cell]);
  }
  const rows = [...byRow.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([row, rowCells]) => `<row r="${row}">${rowCells.join("")}</row>`)
    .join("");
  return `<worksheet xmlns="${MAIN_NS}"><sheetData>${rows}</sheetData></worksheet>`;
}

type SheetSpec = { name: string; cells?: readonly string[]; xml?: string };

function workbookOf(options: {
  sheets: readonly SheetSpec[];
  activeTab?: number;
  /** null 이면 styles.xml 을 넣지 않는다. */
  styles?: string | null;
  date1904?: boolean;
  sharedStringsXml?: string;
  extraEntries?: readonly ZipEntryInput[];
}): Buffer {
  const sheetTags = options.sheets
    .map((sheet, index) => `<sheet name="${sheet.name}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`)
    .join("");
  const relTags = options.sheets
    .map(
      (_sheet, index) =>
        `<Relationship Id="rId${index + 1}" Type="${REL_NS}/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`
    )
    .join("");
  const bookView =
    options.activeTab === undefined ? "<workbookView/>" : `<workbookView activeTab="${options.activeTab}"/>`;
  const workbookPr = options.date1904 ? '<workbookPr date1904="1"/>' : "<workbookPr/>";

  const entries: ZipEntryInput[] = [
    {
      name: "xl/workbook.xml",
      data: Buffer.from(
        `<workbook xmlns="${MAIN_NS}" xmlns:r="${REL_NS}">${workbookPr}<bookViews>${bookView}</bookViews><sheets>${sheetTags}</sheets></workbook>`,
        "utf8"
      ),
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      data: Buffer.from(`<Relationships xmlns="${PKG_REL_NS}">${relTags}</Relationships>`, "utf8"),
    },
    ...options.sheets.map((sheet, index) => ({
      name: `xl/worksheets/sheet${index + 1}.xml`,
      data: Buffer.from(sheet.xml ?? sheetXmlOf(sheet.cells ?? []), "utf8"),
    })),
  ];
  const styles = options.styles === undefined ? STYLES_XML : options.styles;
  if (styles !== null) entries.push({ name: "xl/styles.xml", data: Buffer.from(styles, "utf8") });
  if (options.sharedStringsXml !== undefined) {
    entries.push({ name: "xl/sharedStrings.xml", data: Buffer.from(options.sharedStringsXml, "utf8") });
  }
  entries.push(...(options.extraEntries ?? []));
  return writeZip(entries);
}

const SAMPLE = {
  quoteNumber: "DSS 2096-001",
  customer: "가상상사 Co.,Ltd",
  subject: "TST-500X 수리 견적",
  model: "TST-500X",
  serial: "SN-0001",
  lot: "LN-0042",
  validity: "견적일로부터 30일",
  delivery: "발주 후 3주",
  payment: "납품 후 30일 현금",
} as const;

/** 가짜 시트의 「공 급 가」 줄. 양식마다 행은 다르지만 읽개는 머리글로 찾으므로 한 자리면 된다. */
const SUPPLY_ROW = 40;
const SUPPLY_REF = `${LAYOUT_COLUMNS.amount}${SUPPLY_ROW}`;

/** 「공 급 가」 머리글 + 공급가 칸(없으면 null) + 그 칸을 가리키는 요약 칸. */
function supplyBlock(summaryRef: string, supplyCell: string | null, summaryCached?: number): string[] {
  const cells = [str(`${LAYOUT_COLUMNS.unitPrice}${SUPPLY_ROW}`, "공 급 가"), fml(summaryRef, SUPPLY_REF, summaryCached)];
  if (supplyCell !== null) cells.push(supplyCell);
  return cells;
}

type GeneratorCells = typeof QUOTE_CELLS | typeof OH_QUOTE_CELLS;

/** 제너레이터 양식 자리에 SAMPLE 을 채운 칸들. 바꿀 칸만 덮어 준다(null 이면 그 칸을 뺀다). */
function generatorCells(
  cells: GeneratorCells,
  overrides: { date?: string | null; productLine?: string | null; supply?: readonly string[] } = {}
): string[] {
  const list = [
    str(cells.quoteNumber, SAMPLE.quoteNumber),
    str(cells.customerName, SAMPLE.customer),
    str(cells.subject, SAMPLE.subject),
    str(cells.validity, SAMPLE.validity),
    str(cells.delivery, SAMPLE.delivery),
    str(cells.payment, SAMPLE.payment),
  ];
  if (overrides.date !== null) {
    list.push(overrides.date ?? num(cells.quoteDate, serialOf(2026, 9, 15), STYLE.date));
  }
  if (overrides.productLine !== null) {
    list.push(
      str(cells.productInfo, overrides.productLine ?? `MODEL: ${SAMPLE.model}, S/N:${SAMPLE.serial}, L/N:${SAMPLE.lot}`)
    );
  }
  list.push(
    ...(overrides.supply ?? supplyBlock(cells.amount, fml(SUPPLY_REF, "SUM(I26:I39)", 3_500_000), 3_500_000))
  );
  return list;
}

function readGenerator(cells: readonly string[], options: { styles?: string | null; date1904?: boolean } = {}) {
  return expectOk(
    readHandwrittenQuoteWorkbook(workbookOf({ sheets: [{ name: QUOTE_SHEET_NAME, cells }], ...options }))
  );
}

function expectOk(result: HandwrittenQuoteReadResult) {
  if (!result.ok) assert.fail(`읽기가 실패했다: ${result.code}`);
  return result;
}

function expectFailure(result: HandwrittenQuoteReadResult, code: HandwrittenQuoteReadFailureCode): void {
  assert.equal(result.ok, false, "실패여야 한다");
  if (!result.ok) {
    assert.equal(result.code, code);
    assert.ok(result.message.length > 0, "사람이 읽는 까닭이 있어야 한다");
  }
}

/** 🔴 **갈래 없는** 매쳐(이름표를 읽지 못한 시트)를 읽었을 때만 실리는 경고. */
const MATCHER_KIND_WARNING =
  "매쳐 양식인데 작업 구역 이름표를 읽지 못해 내자 · OH 를 가를 수 없어 견적서 종류를 비워 둡니다 — 종류를 직접 골라 주세요.";

const EMPTY_FIELDS: Omit<HandwrittenQuoteFields, "kind"> = {
  quoteNumber: null,
  quoteDate: null,
  customerNameText: null,
  subject: null,
  modelNameText: null,
  lotNumberText: null,
  serialNumberText: null,
  validity: null,
  delivery: null,
  payment: null,
  manualSupplyAmount: null,
};

// ─────────────────────────────────────────────── 거절 — 읽지 않는 파일

describe("거절 — 읽지 않는 파일", () => {
  test("🔴 옛 .xls(OLE2 머리 8바이트) → 사람이 읽는 까닭", () => {
    const xls = Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(504)]);
    const result = readHandwrittenQuoteWorkbook(xls);
    expectFailure(result, "XLS_LEGACY");
    assert.ok(!result.ok);
    assert.equal(
      result.message,
      "옛 엑셀 형식(.xls)입니다 — 엑셀에서 [다른 이름으로 저장] › Excel 통합 문서(.xlsx)로 저장해 다시 올려 주세요"
    );
  });

  test("zip 이 아니면 거절한다 — 글자 · 빈 파일 · PDF 머리", () => {
    for (const bytes of [Buffer.from("hello", "utf8"), Buffer.alloc(0), Buffer.from("%PDF-1.7\n%", "utf8")]) {
      expectFailure(readHandwrittenQuoteWorkbook(bytes), "NOT_XLSX");
    }
  });

  test("zip 머리지만 몸이 깨졌다 → NOT_XLSX", () => {
    const broken = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(200, 7)]);
    expectFailure(readHandwrittenQuoteWorkbook(broken), "NOT_XLSX");
  });

  test("zip 이지만 통합문서가 아니다(workbook.xml 없음 — docx 따위) → NOT_XLSX", () => {
    const docx = writeZip([{ name: "word/document.xml", data: Buffer.from("<document/>", "utf8") }]);
    expectFailure(readHandwrittenQuoteWorkbook(docx), "NOT_XLSX");
  });

  test("알아보는 시트 이름이 없다 → NO_QUOTE_SHEET", () => {
    const workbook = workbookOf({
      sheets: [
        { name: "Sheet1", cells: [str("D11", "DSS 2096-001")] },
        { name: "견적서(2)", cells: [str("D11", "DSS 2096-002")] },
      ],
    });
    expectFailure(readHandwrittenQuoteWorkbook(workbook), "NO_QUOTE_SHEET");
  });

  test("🔴 무엇을 넣어도 던지지 않는다 — 잘린 파일 · 한 바이트씩 뒤집은 파일", () => {
    const base = workbookOf({ sheets: [{ name: QUOTE_SHEET_NAME, cells: generatorCells(QUOTE_CELLS) }] });
    for (let cut = 0; cut <= base.length; cut += 7) {
      const result = readHandwrittenQuoteWorkbook(base.subarray(0, cut));
      assert.equal(typeof result.ok, "boolean", `${cut}바이트에서 잘린 파일`);
    }
    for (let index = 0; index < base.length; index += 5) {
      const flipped = Buffer.from(base);
      flipped[index] ^= 0xff;
      const result = readHandwrittenQuoteWorkbook(flipped);
      assert.equal(typeof result.ok, "boolean", `${index}번째 바이트를 뒤집은 파일`);
    }
  });
});

// ─────────────────────────────────────────────── 안전 상한

describe("안전 상한 — zip 에 적힌 크기가 아니라 실제로 풀린 바이트로 잰다", () => {
  test("🔴 기본 상한: 몇 KB 로 압축된 9MB workbook.xml(압축 폭탄) → CONTENT_TOO_LARGE", () => {
    const bomb = writeZip([
      { name: "xl/workbook.xml", data: Buffer.alloc(9 * 1024 * 1024, 0x20) },
      { name: "xl/_rels/workbook.xml.rels", data: Buffer.from("<Relationships/>", "utf8") },
    ]);
    assert.ok(bomb.length < 64 * 1024, `압축본이 작아야 폭탄이다: ${bomb.length}`);
    expectFailure(readHandwrittenQuoteWorkbook(bomb), "CONTENT_TOO_LARGE");
  });

  test("파트 하나의 상한 — 시트가 크면 거절", () => {
    const padding = Array.from({ length: 200 }, (_, index) => str(`A${100 + index}`, "가나다라마바사")).join("");
    const workbook = workbookOf({
      sheets: [{ name: QUOTE_SHEET_NAME, xml: `<worksheet xmlns="${MAIN_NS}"><sheetData>${padding}</sheetData></worksheet>` }],
    });
    expectFailure(readHandwrittenQuoteWorkbook(workbook, { limits: { maxPartBytes: 2048 } }), "CONTENT_TOO_LARGE");
    // 같은 파일이 기본 상한에서는 읽힌다 — 거절이 상한 때문이라는 증거.
    assert.equal(readHandwrittenQuoteWorkbook(workbook).ok, true);
  });

  test("무압축(stored) 파트도 같은 상한에 걸린다", () => {
    const workbook = workbookOf({
      sheets: [{ name: QUOTE_SHEET_NAME, cells: [] }],
      // 무작위 바이트는 압축해도 줄지 않아 zip-writer 가 그대로 담는다(method 0).
      sharedStringsXml: randomBytes(4096).toString("latin1"),
    });
    expectFailure(readHandwrittenQuoteWorkbook(workbook, { limits: { maxPartBytes: 2048 } }), "CONTENT_TOO_LARGE");
  });

  test("푼 파트들의 합계 상한", () => {
    const workbook = workbookOf({ sheets: [{ name: QUOTE_SHEET_NAME, cells: generatorCells(QUOTE_CELLS) }] });
    expectFailure(readHandwrittenQuoteWorkbook(workbook, { limits: { maxTotalPartBytes: 600 } }), "CONTENT_TOO_LARGE");
  });

  test("엔트리 수 상한", () => {
    const workbook = workbookOf({ sheets: [{ name: QUOTE_SHEET_NAME, cells: [] }] });
    expectFailure(readHandwrittenQuoteWorkbook(workbook, { limits: { maxZipEntries: 3 } }), "CONTENT_TOO_LARGE");
  });

  test("값을 로그에 찍지 않는다 — 읽개에 console 이 없다", () => {
    const source = readFileSync(new URL("./handwritten-quote-reader.ts", import.meta.url), "utf8");
    assert.equal(/\bconsole\./.test(source), false);
  });
});

// ─────────────────────────────────────────────── 빈 양식

describe("빈 양식 — 칸이 비면 null 들", () => {
  test("내자견적서 시트에 칸이 하나도 없다 → 종류만 있고 나머지는 null, 경고 없음", () => {
    const result = readGenerator([]);
    assert.equal(result.sheet, "GENERATOR_DOMESTIC");
    assert.deepEqual(result.fields, { kind: "DOMESTIC", ...EMPTY_FIELDS });
    assert.deepEqual(result.warnings, []);
  });

  test("sheetData 가 아예 없는 시트도 같다", () => {
    const result = expectOk(
      readHandwrittenQuoteWorkbook(
        workbookOf({ sheets: [{ name: OH_QUOTE_SHEET_NAME, xml: `<worksheet xmlns="${MAIN_NS}"/>` }] })
      )
    );
    assert.equal(result.sheet, "GENERATOR_OH");
    assert.deepEqual(result.fields, { kind: "OVERHAUL", ...EMPTY_FIELDS });
    assert.deepEqual(result.warnings, []);
  });

  test("양식 모양 그대로(머리글만 있고 값 칸은 서식만 남은 빈 칸) → null 들, 경고 없음", () => {
    const result = readGenerator([
      str("C10", "발행일자 :"),
      `<c r="${QUOTE_CELLS.quoteDate}" s="${STYLE.date}"/>`,
      str("C11", "발행번호 :"),
      `<c r="${QUOTE_CELLS.quoteNumber}" s="${STYLE.general}"/>`,
      `<c r="${QUOTE_CELLS.productInfo}" s="${STYLE.general}"/>`,
      str(`H${SUPPLY_ROW}`, "공 급 가"),
      `<c r="${SUPPLY_REF}" s="${STYLE.amount}"/>`,
    ]);
    assert.deepEqual(result.fields, { kind: "DOMESTIC", ...EMPTY_FIELDS });
    assert.deepEqual(result.warnings, []);
  });
});

// ─────────────────────────────────────────────── 시트 고르기

describe("시트 고르기 — 발행번호 → 활성 시트 → 탭 순서", () => {
  function twoFilled(activeTab?: number): Buffer {
    return workbookOf({
      sheets: [
        { name: QUOTE_SHEET_NAME, cells: [str(QUOTE_CELLS.quoteNumber, "DSS 2096-010")] },
        { name: OH_QUOTE_SHEET_NAME, cells: [str(OH_QUOTE_CELLS.quoteNumber, "DSS 2096-010-1")] },
        { name: "Sheet1", cells: [] },
      ],
      activeTab,
    });
  }

  test("🔴 두 시트 모두 발행번호가 채워짐 → 활성 시트(OH견적서)", () => {
    const result = expectOk(readHandwrittenQuoteWorkbook(twoFilled(1)));
    assert.equal(result.sheet, "GENERATOR_OH");
    assert.equal(result.fields.kind, "OVERHAUL");
    assert.equal(result.fields.quoteNumber, "DSS 2096-010-1");
    assert.deepEqual(result.warnings, []);
  });

  test("두 시트 모두 채워짐 · activeTab 이 없다 → 0(첫 탭, 내자견적서)", () => {
    const result = expectOk(readHandwrittenQuoteWorkbook(twoFilled()));
    assert.equal(result.sheet, "GENERATOR_DOMESTIC");
    assert.equal(result.fields.kind, "DOMESTIC");
    assert.equal(result.fields.quoteNumber, "DSS 2096-010");
    assert.deepEqual(result.warnings, []);
  });

  test("🔴 두 시트 모두 채워짐 · 활성 시트가 견적서 시트가 아니다 → 탭 순서의 첫 시트 + 경고", () => {
    const result = expectOk(readHandwrittenQuoteWorkbook(twoFilled(2)));
    assert.equal(result.sheet, "GENERATOR_DOMESTIC");
    assert.equal(result.warnings.length, 1);
    assert.match(result.warnings[0], /탭 순서의 첫 시트 「내자견적서」/);
  });

  test("발행번호가 채워진 시트가 하나면 활성 시트가 아니어도 그것", () => {
    const workbook = workbookOf({
      sheets: [
        { name: QUOTE_SHEET_NAME, cells: [str(QUOTE_CELLS.customerName, SAMPLE.customer)] },
        { name: OH_QUOTE_SHEET_NAME, cells: [str(OH_QUOTE_CELLS.quoteNumber, "DSS 2096-011-1")] },
      ],
      activeTab: 0,
    });
    const result = expectOk(readHandwrittenQuoteWorkbook(workbook));
    assert.equal(result.sheet, "GENERATOR_OH");
    assert.equal(result.fields.quoteNumber, "DSS 2096-011-1");
    assert.deepEqual(result.warnings, []);
  });

  test("둘 다 비었고 활성 시트가 OH견적서 → 그것, 경고 없음", () => {
    const workbook = workbookOf({
      sheets: [
        { name: QUOTE_SHEET_NAME, cells: [] },
        { name: OH_QUOTE_SHEET_NAME, cells: [] },
      ],
      activeTab: 1,
    });
    const result = expectOk(readHandwrittenQuoteWorkbook(workbook));
    assert.equal(result.sheet, "GENERATOR_OH");
    assert.deepEqual(result.warnings, []);
  });

  test("둘 다 비었고 활성 시트가 견적서 시트가 아니다 → 첫 견적서 시트 + 경고", () => {
    const workbook = workbookOf({
      sheets: [
        { name: "Sheet1", cells: [] },
        { name: OH_QUOTE_SHEET_NAME, cells: [] },
        { name: QUOTE_SHEET_NAME, cells: [] },
      ],
      activeTab: 0,
    });
    const result = expectOk(readHandwrittenQuoteWorkbook(workbook));
    assert.equal(result.sheet, "GENERATOR_OH");
    assert.equal(result.warnings.length, 1);
    assert.match(result.warnings[0], /발행번호가 모두 비어/);
  });

  test("🔴 매쳐 시트(견적서) → MATCHER, 견적서 종류는 null(내자 · OH 를 가를 수 없다) + 경고", () => {
    const workbook = workbookOf({
      sheets: [
        { name: "Sheet1", cells: [] },
        { name: MATCHER_QUOTE_SHEET_NAME, cells: [str(MATCHER_QUOTE_CELLS.quoteNumber, "DSS 2096-020")] },
      ],
    });
    const result = expectOk(readHandwrittenQuoteWorkbook(workbook));
    assert.equal(result.sheet, "MATCHER");
    assert.equal(result.fields.kind, null);
    assert.equal(result.fields.quoteNumber, "DSS 2096-020");
    assert.deepEqual(result.warnings, [MATCHER_KIND_WARNING]);
  });
});

// ─────────────────────────────── 무엇이 들어 있나 · 어느 시트를 읽나

/**
 * 🔴 사용자의 실제 파일(내자 · OH 가 한 문서에 든 견적서)은 저장소에 두지 않는다 — 고객
 * 내용이다. 대신 **같은 짜임**을 zip-writer 로 흉내 낸다:
 *  · 탭 셋 — 내자견적서 · OH견적서 · 알아보지 못하는 이름(Sheet1)
 *  · OH 시트의 발행번호 · 공급처 · 건명은 내자 칸을 따라가는 수식(`내자견적서!D11&"-1"`)이고
 *    Excel 이 저장한 계산값이 붙어 있어 **빈 양식에서도 채워져 보인다**
 *  · `activeTab` 이 없다 — 그래서 읽개가 혼자 고르면 늘 첫 시트(내자)로 떨어진다
 *
 * 머리글 · 품목 줄의 자리는 실제 양식에서 읽은 행 번호 그대로다(2026-09-17 실측). 🔴 빈
 * 양식에도 부품 이름 예시 · 수량 1 · 모델 예시가 인쇄돼 있다 — 「작성됐나」를 단가 · 금액
 * 으로만 가르는 까닭이 이것이다.
 */
const DUPLEX = {
  quoteNumber: "DSS 2096-100",
  ohQuoteNumber: "DSS 2096-100-1",
  subject: "TST-500X 수리 견적",
  ohSubject: "TST-500X 수리 견적 + OH",
} as const;

/** 글자를 돌려주는 수식 칸(`t="str"`). Excel 로 저장한 파일에는 계산값이 함께 있다. */
function fmlText(ref: string, formula: string, cached: string): string {
  return `<c r="${ref}" t="str"><f>${escapeXml(formula)}</f><v>${escapeXml(cached)}</v></c>`;
}

/** 행 → D열 머리글. 실제 양식의 자리다(내자 26·33·36·41·43 / OH 26·36·50·53·58·60). */
const DOMESTIC_FORM_HEADERS: readonly (readonly [number, string])[] = [
  [26, "부품 비용"],
  [33, "작업비 (조사,수리,개조,통전,출하검사)"],
  [36, "인수 조사"],
  [41, "수리 작업"],
  [43, "통전검사[출하검사]"],
];
const OH_FORM_HEADERS: readonly (readonly [number, string])[] = [
  [26, "부품 비용"],
  [36, "OH 부품 비용"],
  [50, "작업비 (조사,수리,개조,통전,출하검사)"],
  [53, "인수 조사"],
  [58, "OH 및 수리 작업"],
  [60, "통전검사[출하검사]"],
];

/** 표 머리글 · 부품 한 줄 · 작업비 줄 · 합계 줄. `filled` 면 단가 · 금액이 든다. */
function formSheetCells(options: {
  headers: readonly (readonly [number, string])[];
  partRow: number;
  laborRow: number;
  supplyRow: number;
  summaryRef: string;
  filled: boolean;
}): string[] {
  const { partRow, laborRow, supplyRow, filled } = options;
  const at = (column: string, row: number) => `${column}${row}`;
  const supplyRef = at(LAYOUT_COLUMNS.amount, supplyRow);
  const total = filled ? 1_500_000 : 0;

  return [
    // 표 머리글 — 빈 양식에도 있다. H · I 에 **글자**가 든 줄이라 금액으로 세면 안 된다.
    str(at(LAYOUT_COLUMNS.name, 20), "품 명"),
    str(at(LAYOUT_COLUMNS.quantity, 20), "수 량"),
    str(at(LAYOUT_COLUMNS.unitPrice, 20), "단 가"),
    str(at(LAYOUT_COLUMNS.amount, 20), "합 계"),
    ...options.headers.map(([row, label]) => str(at(LAYOUT_COLUMNS.name, row), label)),
    // 부품 한 줄 — 🔴 줄임표 · 이름 · 수량 1 은 빈 양식에도 인쇄돼 있다.
    str(at(LAYOUT_COLUMNS.marker, partRow), "-"),
    str(at(LAYOUT_COLUMNS.name, partRow), "1번 부품"),
    num(at(LAYOUT_COLUMNS.quantity, partRow), 1, STYLE.general),
    num(at(LAYOUT_COLUMNS.unitPrice, partRow), filled ? 150_000 : 0),
    fml(at(LAYOUT_COLUMNS.amount, partRow), `G${partRow}*H${partRow}`, filled ? 300_000 : 0),
    // 작업비 줄
    num(at(LAYOUT_COLUMNS.quantity, laborRow), 1, STYLE.general),
    num(at(LAYOUT_COLUMNS.unitPrice, laborRow), filled ? 1_200_000 : 0),
    fml(at(LAYOUT_COLUMNS.amount, laborRow), `H${laborRow}*G${laborRow}`, filled ? 1_200_000 : 0),
    // 합계 줄
    str(at(LAYOUT_COLUMNS.unitPrice, supplyRow), "공 급 가"),
    fml(supplyRef, `SUM(I${partRow}:I${supplyRow - 1})`, total),
    fml(options.summaryRef, supplyRef, total),
  ];
}

function domesticSheetCells(filled: boolean): string[] {
  return [
    str(QUOTE_CELLS.validity, SAMPLE.validity),
    str(QUOTE_CELLS.delivery, SAMPLE.delivery),
    str(QUOTE_CELLS.payment, SAMPLE.payment),
    // 🔴 빈 양식에도 인쇄돼 있는 예시다.
    str(QUOTE_CELLS.productInfo, `MODEL: ${SAMPLE.model}, S/N:${SAMPLE.serial}, L/N:${SAMPLE.lot}`),
    ...(filled
      ? [
          num(QUOTE_CELLS.quoteDate, serialOf(2026, 9, 15), STYLE.date),
          str(QUOTE_CELLS.quoteNumber, DUPLEX.quoteNumber),
          str(QUOTE_CELLS.customerName, SAMPLE.customer),
          str(QUOTE_CELLS.subject, DUPLEX.subject),
        ]
      : []),
    ...formSheetCells({
      headers: DOMESTIC_FORM_HEADERS,
      partRow: 27,
      laborRow: 33,
      supplyRow: 55,
      summaryRef: QUOTE_CELLS.amount,
      filled,
    }),
  ];
}

/** 🔴 머리 칸이 내자 시트를 따라가는 수식이다 — 빈 양식에서도 「-1」 이 채워져 보인다. */
function ohSheetCells(filled: boolean): string[] {
  const from = (ref: string) => `${QUOTE_SHEET_NAME}!${ref}`;
  return [
    str(OH_QUOTE_CELLS.validity, SAMPLE.validity),
    str(OH_QUOTE_CELLS.delivery, SAMPLE.delivery),
    str(OH_QUOTE_CELLS.payment, SAMPLE.payment),
    str(OH_QUOTE_CELLS.productInfo, `MODEL: ${SAMPLE.model}, S/N:${SAMPLE.serial}, L/N:${SAMPLE.lot}`),
    fml(OH_QUOTE_CELLS.quoteDate, from(QUOTE_CELLS.quoteDate), serialOf(2026, 9, 15), STYLE.date),
    fmlText(
      OH_QUOTE_CELLS.quoteNumber,
      `${from(QUOTE_CELLS.quoteNumber)}&"-1"`,
      filled ? DUPLEX.ohQuoteNumber : "-1"
    ),
    fmlText(OH_QUOTE_CELLS.customerName, from(QUOTE_CELLS.customerName), filled ? SAMPLE.customer : ""),
    fmlText(
      OH_QUOTE_CELLS.subject,
      `${from(QUOTE_CELLS.subject)}&" + OH"`,
      filled ? DUPLEX.ohSubject : " + OH"
    ),
    ...formSheetCells({
      headers: OH_FORM_HEADERS,
      partRow: 27,
      laborRow: 50,
      supplyRow: 72,
      summaryRef: OH_QUOTE_CELLS.amount,
      filled,
    }),
  ];
}

function duplexWorkbook(
  options: { names?: readonly [string, string]; domesticFilled?: boolean; ohFilled?: boolean } = {}
): Buffer {
  const [domesticName, ohName] = options.names ?? [QUOTE_SHEET_NAME, OH_QUOTE_SHEET_NAME];
  return workbookOf({
    // 🔴 activeTab 을 주지 않는다 — 사용자의 파일이 그렇다.
    sheets: [
      { name: domesticName, cells: domesticSheetCells(options.domesticFilled ?? true) },
      { name: ohName, cells: ohSheetCells(options.ohFilled ?? true) },
      { name: "Sheet1", cells: [str("A1", "메모")] },
    ],
  });
}

describe("무엇이 들어 있나 — 내자 · OH 가 한 문서에 든 견적서", () => {
  test("🔴 두 시트가 다 「있다」고 나온다 — 양식은 머리글로, 작성 여부는 금액으로", () => {
    const result = expectOk(readHandwrittenQuoteWorkbook(duplexWorkbook()));
    assert.deepEqual(result.sheets, [
      { index: 0, name: QUOTE_SHEET_NAME, form: "GENERATOR_DOMESTIC", recognizedBy: "header", filled: true },
      { index: 1, name: OH_QUOTE_SHEET_NAME, form: "GENERATOR_OH", recognizedBy: "header", filled: true },
    ]);
  });

  test("🔴 지정 없이 부르면 지금까지와 똑같다 — 첫 시트(내자)를 읽는다", () => {
    const result = expectOk(readHandwrittenQuoteWorkbook(duplexWorkbook()));
    assert.equal(result.sheet, "GENERATOR_DOMESTIC");
    assert.equal(result.sheetIndex, 0);
    assert.equal(result.sheetName, QUOTE_SHEET_NAME);
    assert.equal(result.fields.kind, "DOMESTIC");
    assert.equal(result.fields.quoteNumber, DUPLEX.quoteNumber);
    assert.equal(result.fields.subject, DUPLEX.subject);
    assert.deepEqual(result.warnings, []);
  });

  test("🔴 OH 를 지정하면 OH 시트를 읽는다 — 지금까지는 길이 없던 일이다", () => {
    const result = expectOk(readHandwrittenQuoteWorkbook(duplexWorkbook(), { sheetIndex: 1 }));
    assert.equal(result.sheet, "GENERATOR_OH");
    assert.equal(result.sheetIndex, 1);
    assert.equal(result.sheetName, OH_QUOTE_SHEET_NAME);
    assert.equal(result.fields.kind, "OVERHAUL");
    assert.equal(result.fields.quoteNumber, DUPLEX.ohQuoteNumber);
    assert.equal(result.fields.subject, DUPLEX.ohSubject);
    assert.equal(result.fields.quoteDate, "2026-09-15");
    assert.equal(result.fields.manualSupplyAmount, "1500000");
    assert.deepEqual(result.warnings, []);
  });

  test("🔴 양식은 탭 이름이 아니라 머리글로 가른다 — 두 탭의 이름을 맞바꿔도 같은 답", () => {
    const swapped = duplexWorkbook({ names: [OH_QUOTE_SHEET_NAME, QUOTE_SHEET_NAME] });
    const result = expectOk(readHandwrittenQuoteWorkbook(swapped, { sheetIndex: 1 }));
    assert.deepEqual(
      result.sheets.map((sheet) => [sheet.name, sheet.form, sheet.recognizedBy]),
      [
        [OH_QUOTE_SHEET_NAME, "GENERATOR_DOMESTIC", "header"],
        [QUOTE_SHEET_NAME, "GENERATOR_OH", "header"],
      ]
    );
    // 탭 이름은 「내자견적서」인데 읽은 것은 O/H 견적서다.
    assert.equal(result.sheetName, QUOTE_SHEET_NAME);
    assert.equal(result.sheet, "GENERATOR_OH");
    assert.equal(result.fields.kind, "OVERHAUL");
    assert.equal(result.fields.quoteNumber, DUPLEX.ohQuoteNumber);
  });

  test("🔴 빈 양식은 「작성됨」이 아니다 — 발행번호가 수식이라 차 있어도(「-1」) 세지 않는다", () => {
    const workbook = duplexWorkbook({ domesticFilled: false, ohFilled: false });
    const result = expectOk(readHandwrittenQuoteWorkbook(workbook));
    assert.deepEqual(
      result.sheets.map((sheet) => sheet.filled),
      [false, false]
    );
    // 그 시트의 발행번호 칸은 비어 있지 않다 — 그래서 발행번호로 가르면 안 된다.
    const oh = expectOk(readHandwrittenQuoteWorkbook(workbook, { sheetIndex: 1 }));
    assert.equal(oh.fields.quoteNumber, "-1");
  });

  test("한쪽만 작성한 문서 — 작성된 쪽만 「있다」", () => {
    const result = expectOk(readHandwrittenQuoteWorkbook(duplexWorkbook({ domesticFilled: false })));
    assert.deepEqual(
      result.sheets.map((sheet) => [sheet.form, sheet.filled]),
      [
        ["GENERATOR_DOMESTIC", false],
        ["GENERATOR_OH", true],
      ]
    );
  });

  test("🔴 지정한 시트가 없으면 까닭 있는 실패 — 조용히 딴 시트를 읽지 않는다", () => {
    // 2번 탭은 「Sheet1」이다 — 알아보는 견적서 시트가 아니다.
    for (const sheetIndex of [2, 3, -1, 1.5, Number.NaN]) {
      expectFailure(readHandwrittenQuoteWorkbook(duplexWorkbook(), { sheetIndex }), "SHEET_NOT_FOUND");
    }
  });

  test("작성됐나 — 글자로 적은 금액도 세고, 양식에 인쇄된 머리글 · 수량은 세지 않는다", () => {
    const blank = [
      str(`${LAYOUT_COLUMNS.unitPrice}20`, "단 가"),
      str(`${LAYOUT_COLUMNS.amount}20`, "합 계"),
      str(`${LAYOUT_COLUMNS.unitPrice}55`, "공 급 가"),
      num(`${LAYOUT_COLUMNS.quantity}27`, 1, STYLE.general),
      num(`${LAYOUT_COLUMNS.amount}27`, 0),
    ];
    const filledOf = (cells: readonly string[]) =>
      expectOk(readHandwrittenQuoteWorkbook(workbookOf({ sheets: [{ name: QUOTE_SHEET_NAME, cells }] }))).sheets[0]
        .filled;

    assert.equal(filledOf(blank), false);
    assert.equal(filledOf([...blank, str(`${LAYOUT_COLUMNS.unitPrice}27`, "150,000")]), true);
    assert.equal(filledOf([...blank, num(`${LAYOUT_COLUMNS.amount}27`, 300_000)]), true);
  });

  test("머리글로 가르지 못하면 탭 이름으로 간다 — recognizedBy 가 말해 준다", () => {
    const workbook = workbookOf({
      sheets: [{ name: OH_QUOTE_SHEET_NAME, cells: [str(OH_QUOTE_CELLS.quoteNumber, "DSS 2096-010-1")] }],
    });
    const result = expectOk(readHandwrittenQuoteWorkbook(workbook));
    assert.deepEqual(result.sheets, [
      { index: 0, name: OH_QUOTE_SHEET_NAME, form: "GENERATOR_OH", recognizedBy: "name", filled: false },
    ]);
  });

  test("🔴 매쳐 머리글이면 탭 이름이 「내자견적서」여도 매쳐 양식의 칸 지도로 읽는다", () => {
    const workbook = workbookOf({
      sheets: [
        {
          name: QUOTE_SHEET_NAME,
          cells: [
            str("D34", "조사작업"),
            str(MATCHER_QUOTE_CELLS.quoteNumber, "DSS 2096-020"),
            // 제너레이터는 건명이 D13, 매쳐는 D14 다 — 어느 지도로 읽었는지 여기서 갈린다.
            str(MATCHER_QUOTE_CELLS.subject, "매쳐 건명"),
            str(QUOTE_CELLS.subject, "제너레이터 건명"),
          ],
        },
      ],
    });
    const result = expectOk(readHandwrittenQuoteWorkbook(workbook));
    // 매쳐 머리글로 알아본 시트라 「OH작업」이 없으면 내자다(2026-09-17).
    assert.equal(result.sheet, "MATCHER_DOMESTIC");
    assert.equal(result.sheets[0].recognizedBy, "header");
    assert.equal(result.fields.subject, "매쳐 건명");
    assert.equal(result.fields.kind, "DOMESTIC");
    assert.deepEqual(result.warnings, []);
  });

  test("🔴 두 양식의 머리글이 한 시트에 같이 보이면 가르지 않는다 — 탭 이름으로 간다", () => {
    // 매쳐 견적서의 수리작업 항목을 사람이 「수리 작업」(내자 양식의 머리글)이라고 적었다.
    // 짐작으로 내자 지도를 쓰면 건명을 D13 에서 읽어 딴 값을 채운다.
    const workbook = workbookOf({
      sheets: [
        {
          name: MATCHER_QUOTE_SHEET_NAME,
          cells: [
            str("D34", "조사작업"),
            str("D41", "수리작업"),
            str(`${LAYOUT_COLUMNS.marker}42`, "-"),
            str("D42", "수리 작업"),
            str(MATCHER_QUOTE_CELLS.subject, "매쳐 건명"),
            str(QUOTE_CELLS.subject, "제너레이터 건명"),
          ],
        },
      ],
    });
    const result = expectOk(readHandwrittenQuoteWorkbook(workbook));
    assert.equal(result.sheets[0].recognizedBy, "name");
    assert.equal(result.sheet, "MATCHER");
    assert.equal(result.fields.subject, "매쳐 건명");
  });

  test("가르는 머리글은 채우개가 들고 있는 글자 그대로다", () => {
    assert.equal(OH_QUOTE_OVERHAUL_PARTS_LABEL, "OH 부품 비용");
    assert.equal(OH_QUOTE_WORK_SCOPE_LABELS.REPAIR.label, "OH 및 수리 작업");
    assert.equal(QUOTE_WORK_SCOPE_LABELS.REPAIR.label, "수리 작업");
    assert.deepEqual(
      [
        MATCHER_WORK_SCOPE_LABELS.INVESTIGATION.label,
        MATCHER_WORK_SCOPE_LABELS.REPAIR.label,
        MATCHER_WORK_SCOPE_LABELS.POWER_TEST.label,
      ],
      ["조사작업", "수리작업", "통전작업"]
    );
    // 🔴 매쳐 내자 · OH 를 가르는 이름표도 채우개(matcher-quote-template.ts)의 것이다.
    assert.equal(MATCHER_OVERHAUL_WORK_LABEL, "OH작업");
  });

  test("🔴 읽개는 가르는 글자를 스스로 적지 않는다 — 채우개 상수만 쓴다", () => {
    const source = readFileSync(new URL("./handwritten-quote-reader.ts", import.meta.url), "utf8");
    const code = source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, ""); // 머리말 · 주석의 설명 글자는 뺀다
    for (const label of [MATCHER_OVERHAUL_WORK_LABEL, OH_QUOTE_OVERHAUL_PARTS_LABEL, "수리작업"]) {
      assert.equal(code.includes(`"${label}"`), false, `읽개가 「${label}」를 직접 적고 있다`);
    }
  });
});

// ───────────────────────────────── 매쳐 — 내자 · OH 가르기

/**
 * 🔴 사용자의 실제 매쳐 견적서는 저장소에 두지 않는다 — 고객 내용이다. 대신 **빈 양식 둘의
 * 짜임**을 흉내 낸다. D열 이름표의 행 번호는 2026-09-17 에 양식 둘을 열어 읽은 자리 그대로다:
 *
 *              내자   OH
 *   부품 비용    27    27
 *   작업 비용    31    36
 *   조사작업     34    39
 *   수리작업     41    46
 *   OH작업       —     49   ← 🔴 OH 양식에만 인쇄돼 있다
 *   통전작업     44    50
 *
 * 🔴 **머리 칸(D10~D19)은 둘이 같은 자리다** — 줄 수가 달라 아래 구역만 어긋난다. 그래서
 * 갈래가 갈려도 읽어 오는 값은 한 글자도 달라지면 안 된다(아래 셋째 시험).
 */
const MATCHER_FORM_HEADERS = {
  DOMESTIC: [
    [27, "부품 비용"],
    [31, "작업 비용"],
    [34, MATCHER_WORK_SCOPE_LABELS.INVESTIGATION.label],
    [41, MATCHER_WORK_SCOPE_LABELS.REPAIR.label],
    [44, MATCHER_WORK_SCOPE_LABELS.POWER_TEST.label],
  ],
  OVERHAUL: [
    [27, "부품 비용"],
    [36, "작업 비용"],
    [39, MATCHER_WORK_SCOPE_LABELS.INVESTIGATION.label],
    [46, MATCHER_WORK_SCOPE_LABELS.REPAIR.label],
    [49, MATCHER_OVERHAUL_WORK_LABEL],
    [50, MATCHER_WORK_SCOPE_LABELS.POWER_TEST.label],
  ],
} as const satisfies Record<string, readonly (readonly [number, string])[]>;

/** 머리 칸은 둘이 똑같이 채우고, D열 이름표와 합계 줄만 양식대로 놓는다. */
function matcherSheetCells(variant: keyof typeof MATCHER_FORM_HEADERS): string[] {
  const cells = MATCHER_QUOTE_CELLS;
  const laborRow = variant === "DOMESTIC" ? 31 : 36;
  return [
    num(cells.quoteDate, serialOf(2026, 9, 15), STYLE.date),
    str(cells.quoteNumber, SAMPLE.quoteNumber),
    str(cells.customerName, SAMPLE.customer),
    str(cells.subject, SAMPLE.subject),
    str(cells.validity, SAMPLE.validity),
    str(cells.delivery, SAMPLE.delivery),
    str(cells.payment, SAMPLE.payment),
    ...formSheetCells({
      headers: MATCHER_FORM_HEADERS[variant],
      partRow: 28,
      laborRow,
      supplyRow: laborRow + 21,
      summaryRef: cells.amount,
      filled: true,
    }),
  ];
}

function readMatcher(cells: readonly string[]) {
  return expectOk(
    readHandwrittenQuoteWorkbook(workbookOf({ sheets: [{ name: MATCHER_QUOTE_SHEET_NAME, cells }] }))
  );
}

/** 매쳐 양식에서 읽히는 값 — 갈래가 무엇이든 이 값이어야 한다(칸 지도가 한 벌이다). */
const MATCHER_FIELDS: Omit<HandwrittenQuoteFields, "kind"> = {
  quoteNumber: SAMPLE.quoteNumber,
  quoteDate: "2026-09-15",
  customerNameText: SAMPLE.customer,
  subject: SAMPLE.subject,
  // 매쳐 양식에는 `MODEL: …` 줄이 없다.
  modelNameText: null,
  lotNumberText: null,
  serialNumberText: null,
  validity: SAMPLE.validity,
  delivery: SAMPLE.delivery,
  payment: SAMPLE.payment,
  manualSupplyAmount: "1500000",
};

describe("매쳐 — D열의 「OH작업」 이름표로 내자 · OH 를 가른다", () => {
  test("🔴 「OH작업」이 있으면 OH 견적서다 — 종류가 OVERHAUL, 경고 없음", () => {
    const result = readMatcher(matcherSheetCells("OVERHAUL"));
    assert.equal(result.sheet, "MATCHER_OH");
    assert.equal(result.fields.kind, "OVERHAUL");
    assert.deepEqual(result.sheets, [
      { index: 0, name: MATCHER_QUOTE_SHEET_NAME, form: "MATCHER_OH", recognizedBy: "header", filled: true },
    ]);
    assert.deepEqual(result.warnings, []);
  });

  test("🔴 없으면 내자 견적서다 — 종류가 DOMESTIC, 경고 없음", () => {
    const result = readMatcher(matcherSheetCells("DOMESTIC"));
    assert.equal(result.sheet, "MATCHER_DOMESTIC");
    assert.equal(result.fields.kind, "DOMESTIC");
    assert.deepEqual(result.sheets, [
      { index: 0, name: MATCHER_QUOTE_SHEET_NAME, form: "MATCHER_DOMESTIC", recognizedBy: "header", filled: true },
    ]);
    assert.deepEqual(result.warnings, []);
  });

  test("🔴 갈래가 갈려도 읽어 오는 값은 같다 — 칸 지도를 잘못 고르지 않았다", () => {
    const domestic = readMatcher(matcherSheetCells("DOMESTIC"));
    const overhaul = readMatcher(matcherSheetCells("OVERHAUL"));
    assert.deepEqual(domestic.fields, { kind: "DOMESTIC", ...MATCHER_FIELDS });
    assert.deepEqual(overhaul.fields, { kind: "OVERHAUL", ...MATCHER_FIELDS });
  });

  test("🔴 갈래 없는 매쳐도 값은 그대로다 — 달라지는 것은 종류뿐이다", () => {
    // 이름표를 하나도 못 읽어(탭 이름으로만 알아봐) 갈래가 없는 시트.
    const bare = matcherSheetCells("DOMESTIC").filter(
      (cell) => !/\sr="D(?:27|31|34|41|44)"/.test(cell)
    );
    const result = readMatcher(bare);
    assert.equal(result.sheet, "MATCHER");
    assert.equal(result.sheets[0].recognizedBy, "name");
    assert.deepEqual(result.fields, { kind: null, ...MATCHER_FIELDS });
    assert.deepEqual(result.warnings, [MATCHER_KIND_WARNING]);
  });

  test("🔴 탭 이름으로만 알아봤어도 「OH작업」이 보이면 OH 다 — 있다는 것 자체가 근거", () => {
    // 사람이 수리작업 항목을 「수리 작업」(내자 양식의 머리글)으로 적어 두 양식이 함께 걸린다.
    const result = readMatcher([
      ...matcherSheetCells("OVERHAUL"),
      str(`${LAYOUT_COLUMNS.marker}47`, "-"),
      str("D47", QUOTE_WORK_SCOPE_LABELS.REPAIR.label),
    ]);
    assert.equal(result.sheets[0].recognizedBy, "name");
    assert.equal(result.sheet, "MATCHER_OH");
    assert.deepEqual(result.fields, { kind: "OVERHAUL", ...MATCHER_FIELDS });
    assert.deepEqual(result.warnings, []);
  });
});

// ─────────────────────────────────────────────── 칸 읽기

describe("칸 읽기 — 채우개의 칸 지도 자리에서", () => {
  test("제너레이터 내자: 모든 칸이 제자리에서 나온다", () => {
    const result = readGenerator(generatorCells(QUOTE_CELLS));
    assert.equal(result.sheet, "GENERATOR_DOMESTIC");
    assert.deepEqual(result.fields, {
      kind: "DOMESTIC",
      quoteNumber: SAMPLE.quoteNumber,
      quoteDate: "2026-09-15",
      customerNameText: SAMPLE.customer,
      subject: SAMPLE.subject,
      modelNameText: SAMPLE.model,
      lotNumberText: SAMPLE.lot,
      serialNumberText: SAMPLE.serial,
      validity: SAMPLE.validity,
      delivery: SAMPLE.delivery,
      payment: SAMPLE.payment,
      manualSupplyAmount: "3500000",
    } satisfies HandwrittenQuoteFields);
    assert.deepEqual(result.warnings, []);
  });

  test("매쳐: 품명 D14 · 요약 D15 · 유효기간 D17~ 자리에서, 모델 칸은 없다", () => {
    const cells = MATCHER_QUOTE_CELLS;
    const workbook = workbookOf({
      sheets: [
        {
          name: MATCHER_QUOTE_SHEET_NAME,
          cells: [
            num(cells.quoteDate, serialOf(2026, 9, 15), STYLE.date),
            str(cells.quoteNumber, SAMPLE.quoteNumber),
            str(cells.customerName, SAMPLE.customer),
            str(cells.subject, SAMPLE.subject),
            str(cells.validity, SAMPLE.validity),
            str(cells.delivery, SAMPLE.delivery),
            str(cells.payment, SAMPLE.payment),
            // 제너레이터의 D24 자리에 무엇이 있어도 매쳐에서는 읽지 않는다.
            str("D24", `MODEL: ${SAMPLE.model}`),
            ...supplyBlock(cells.amount, fml(SUPPLY_REF, "SUM(I28:I39)"), 2_050_000),
          ],
        },
      ],
    });
    const result = expectOk(readHandwrittenQuoteWorkbook(workbook));
    assert.deepEqual(result.fields, {
      kind: null,
      quoteNumber: SAMPLE.quoteNumber,
      quoteDate: "2026-09-15",
      customerNameText: SAMPLE.customer,
      subject: SAMPLE.subject,
      modelNameText: null,
      lotNumberText: null,
      serialNumberText: null,
      validity: SAMPLE.validity,
      delivery: SAMPLE.delivery,
      payment: SAMPLE.payment,
      manualSupplyAmount: "2050000",
    } satisfies HandwrittenQuoteFields);
    // 매쳐 종류 경고 하나뿐 — 모델 칸 경고가 없다.
    assert.deepEqual(result.warnings, [MATCHER_KIND_WARNING]);
  });

  test("🔴 후리가나(<rPh>)가 붙은 공유문자열은 걷고 읽는다", () => {
    const sharedStringsXml =
      `<sst xmlns="${MAIN_NS}" count="1" uniqueCount="1">` +
      `<si><t>가상상사</t><rPh sb="0" eb="2"><t>カソウ</t></rPh><phoneticPr fontId="1"/></si></sst>`;
    const workbook = workbookOf({
      sheets: [{ name: QUOTE_SHEET_NAME, cells: [`<c r="${QUOTE_CELLS.customerName}" t="s"><v>0</v></c>`] }],
      sharedStringsXml,
    });
    assert.equal(expectOk(readHandwrittenQuoteWorkbook(workbook)).fields.customerNameText, "가상상사");
  });

  test("숫자로 친 발행번호는 글자로, 앞뒤 공백은 걷는다", () => {
    const result = readGenerator([num(QUOTE_CELLS.quoteNumber, 2096001, STYLE.general), str(QUOTE_CELLS.subject, "  품명  ")]);
    assert.equal(result.fields.quoteNumber, "2096001");
    assert.equal(result.fields.subject, "품명");
  });

  test("XML 엔티티를 풀어 읽는다", () => {
    const result = readGenerator([str(QUOTE_CELLS.customerName, "A&B <가상>")]);
    assert.equal(result.fields.customerNameText, "A&B <가상>");
  });
});

// ─────────────────────────────────────────────── 모델 · L/N · S/N

describe("모델 · L/N · S/N — D24 한 줄", () => {
  const FULL = { modelNameText: "TST-500X", serialNumberText: "SN-0001", lotNumberText: "LN-0042" };

  test("채우개가 만드는 모양 그대로", () => {
    assert.deepEqual(splitProductInfoLine("MODEL: TST-500X, S/N:SN-0001, L/N:LN-0042"), FULL);
  });

  test("순서가 바뀌어도", () => {
    assert.deepEqual(splitProductInfoLine("L/N:LN-0042, MODEL: TST-500X, S/N:SN-0001"), FULL);
  });

  test("대소문자 · 콜론 앞뒤 공백 · 전각 콜론 · 전각 쉼표 · 전각 빗금", () => {
    assert.deepEqual(splitProductInfoLine("model ： TST-500X ， s／n : SN-0001,l / N：LN-0042"), FULL);
  });

  test("없는 조각 · 값이 빈 조각은 null", () => {
    assert.deepEqual(splitProductInfoLine("MODEL: TST-500X"), {
      modelNameText: "TST-500X",
      serialNumberText: null,
      lotNumberText: null,
    });
    assert.deepEqual(splitProductInfoLine("MODEL: TST-500X, S/N:, L/N:LN-0042"), {
      modelNameText: "TST-500X",
      serialNumberText: null,
      lotNumberText: "LN-0042",
    });
  });

  test("🔴 모양이 아니면 null — 모르는 조각 · 같은 이름 두 번 · 그냥 글자", () => {
    for (const line of [
      "MODEL: TST-500X, 비고: 급함",
      "MODEL: TST-500X, MODEL: TST-600",
      "TST-500X",
      "MODEL TST-500X",
      "S/N SN-0001",
      "   ",
    ]) {
      assert.equal(splitProductInfoLine(line), null, line);
    }
  });

  test("시트에서: 모양이 아니면 셋 다 비우고 원문을 경고로 싣는다", () => {
    const result = readGenerator(generatorCells(QUOTE_CELLS, { productLine: "TST-500X / SN-0001" }));
    assert.equal(result.fields.modelNameText, null);
    assert.equal(result.fields.lotNumberText, null);
    assert.equal(result.fields.serialNumberText, null);
    assert.equal(result.warnings.length, 1);
    assert.ok(result.warnings[0].includes(`모델 칸(${QUOTE_CELLS.productInfo})`), result.warnings[0]);
    assert.ok(result.warnings[0].includes("원문: 「TST-500X / SN-0001」"), result.warnings[0]);
  });
});

// ─────────────────────────────────────────────── 발행일자

describe("발행일자", () => {
  test("글자 — 알아보는 모양", () => {
    for (const text of [
      "2026-09-15",
      "2026.09.15",
      "2026.9.15.",
      "2026. 9. 15.",
      "2026/9/15",
      "2026년 9월 15일",
      "2026년9월15일",
      "2026-09-15T00:00:00",
      "2026-09-15T00:00:00.000Z",
    ]) {
      assert.deepEqual(parseQuoteDateText(text), { kind: "date", date: "2026-09-15" }, text);
    }
    assert.deepEqual(parseQuoteDateText("2024-02-29"), { kind: "date", date: "2024-02-29" });
  });

  test("글자 — 달력에 없는 날", () => {
    for (const text of ["2026-02-30", "2025-02-29", "2026-13-01", "2026-00-10", "2026.04.31", "2026년 6월 31일"]) {
      assert.deepEqual(parseQuoteDateText(text), { kind: "not-a-calendar-day" }, text);
    }
  });

  test("글자 — 모르는 모양", () => {
    for (const text of ["15/09/2026", "2026-09", "내일", "2026-09.15", "26.09.15", "0026-09-15", "2026-09-15 10:00"]) {
      assert.deepEqual(parseQuoteDateText(text), { kind: "unrecognized" }, text);
    }
  });

  test("일련번호(기본 날짜 서식) → YYYY-MM-DD", () => {
    const result = readGenerator([num(QUOTE_CELLS.quoteDate, serialOf(2026, 9, 15), STYLE.date)]);
    assert.equal(result.fields.quoteDate, "2026-09-15");
    assert.deepEqual(result.warnings, []);
  });

  test("일련번호(사용자 정의 날짜 서식 yyyy\"년\" m\"월\" d\"일\")", () => {
    const result = readGenerator([num(QUOTE_CELLS.quoteDate, serialOf(2026, 9, 15), STYLE.customDate)]);
    assert.equal(result.fields.quoteDate, "2026-09-15");
  });

  test("🔴 날짜 서식이 아닌 숫자(일반 · #,##0) → null + 경고", () => {
    for (const style of [STYLE.general, STYLE.amount]) {
      const result = readGenerator([num(QUOTE_CELLS.quoteDate, serialOf(2026, 9, 15), style)]);
      assert.equal(result.fields.quoteDate, null);
      assert.equal(result.warnings.length, 1);
      assert.match(result.warnings[0], /날짜 서식이 아니라/);
    }
  });

  test("서식표(styles.xml)가 없으면 일련번호를 날짜로 읽는다", () => {
    const result = readGenerator([num(QUOTE_CELLS.quoteDate, serialOf(2026, 9, 15), STYLE.general)], { styles: null });
    assert.equal(result.fields.quoteDate, "2026-09-15");
  });

  test("글자로 적은 날짜 칸", () => {
    const result = readGenerator([str(QUOTE_CELLS.quoteDate, "2026. 9. 15.")]);
    assert.equal(result.fields.quoteDate, "2026-09-15");
  });

  test("t=\"d\" 칸(ISO 글자 — 매쳐 양식이 이렇게 적는다)", () => {
    const result = readGenerator([`<c r="${QUOTE_CELLS.quoteDate}" s="${STYLE.date}" t="d"><v>2026-09-15T00:00:00</v></c>`]);
    assert.equal(result.fields.quoteDate, "2026-09-15");
  });

  test("🔴 달력에 없는 날 → null + 경고", () => {
    const text = readGenerator([str(QUOTE_CELLS.quoteDate, "2026-02-30")]);
    assert.equal(text.fields.quoteDate, null);
    assert.match(text.warnings[0], /달력에 없는 날/);

    // 1900 체계의 가짜 2월 29일(일련번호 60).
    const serial = readGenerator([num(QUOTE_CELLS.quoteDate, 60, STYLE.date)]);
    assert.equal(serial.fields.quoteDate, null);
    assert.match(serial.warnings[0], /달력에 없는 날/);
  });

  test("모르는 모양의 글자 → null + 경고(알아보는 모양을 알려 준다)", () => {
    const result = readGenerator([str(QUOTE_CELLS.quoteDate, "9월 15일")]);
    assert.equal(result.fields.quoteDate, null);
    assert.match(result.warnings[0], /알아보는 모양/);
  });

  test("1904 체계 통합문서", () => {
    const result = readGenerator([num(QUOTE_CELLS.quoteDate, serialOf(2026, 9, 15) - 1462, STYLE.date)], {
      date1904: true,
    });
    assert.equal(result.fields.quoteDate, "2026-09-15");
  });

  test("🔴 TODAY() 수식 — 저장된 계산값은 읽되 경고한다", () => {
    const result = readGenerator([fml(QUOTE_CELLS.quoteDate, "TODAY()", serialOf(2026, 9, 15), STYLE.date)]);
    assert.equal(result.fields.quoteDate, "2026-09-15");
    assert.equal(result.warnings.length, 1);
    assert.match(result.warnings[0], /TODAY\(\)/);
  });

  test("수식에 저장된 계산값이 없으면 null + 경고", () => {
    const result = readGenerator([fml(QUOTE_CELLS.quoteDate, "내자견적서!D10", undefined, STYLE.date)]);
    assert.equal(result.fields.quoteDate, null);
    assert.match(result.warnings[0], /저장된 계산값이 없어/);
  });

  test("🔴 서버 시간대가 바뀌어도 하루 밀리지 않는다 — UTC 산술만", () => {
    const original = process.env.TZ;
    const systemZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    try {
      for (const zone of ["Pacific/Kiritimati", "Pacific/Pago_Pago", "Asia/Seoul", "America/Los_Angeles", "UTC"]) {
        process.env.TZ = zone;
        const serial = readGenerator([num(QUOTE_CELLS.quoteDate, serialOf(2026, 9, 15), STYLE.date)]);
        assert.equal(serial.fields.quoteDate, "2026-09-15", `${zone} 일련번호`);
        const text = readGenerator([str(QUOTE_CELLS.quoteDate, "2026-09-15")]);
        assert.equal(text.fields.quoteDate, "2026-09-15", `${zone} 글자`);
      }
    } finally {
      // 🔴 되돌릴 때도 **대입**한다 — delete 만으로는 V8 이 마지막 시간대(UTC)를 쥐고 남아,
      // 뒤따르는 시험의 로컬 날짜가 하루 밀린다(실제로 왕복 시험이 그렇게 깨졌다).
      process.env.TZ = original ?? systemZone;
      if (original === undefined) delete process.env.TZ;
    }
  });
});

// ─────────────────────────────────────────────── 공급가액

describe("공급가액 — 「공 급 가」 줄 → 요약 칸", () => {
  const readSupply = (supply: readonly string[]) => readGenerator(generatorCells(QUOTE_CELLS, { supply }));

  test("「공 급 가」 줄의 계산값 → 숫자 문자열", () => {
    const result = readSupply(supplyBlock(QUOTE_CELLS.amount, fml(SUPPLY_REF, "SUM(I26:I39)", 3_500_000), 3_500_000));
    assert.equal(result.fields.manualSupplyAmount, "3500000");
    assert.deepEqual(result.warnings, []);
  });

  test("공급가 칸에 계산값이 없으면 요약 칸의 계산값", () => {
    const result = readSupply(supplyBlock(QUOTE_CELLS.amount, fml(SUPPLY_REF, "SUM(I26:I39)"), 2_000_000));
    assert.equal(result.fields.manualSupplyAmount, "2000000");
    assert.deepEqual(result.warnings, []);
  });

  test("「공 급 가」 줄이 없으면 요약 칸만 본다", () => {
    const result = readSupply([fml(QUOTE_CELLS.amount, SUPPLY_REF, 1_200_000)]);
    assert.equal(result.fields.manualSupplyAmount, "1200000");
  });

  test("🔴 둘 다 계산값이 없으면 null + 경고(엑셀에서 열어 저장)", () => {
    const result = readSupply(supplyBlock(QUOTE_CELLS.amount, fml(SUPPLY_REF, "SUM(I26:I39)")));
    assert.equal(result.fields.manualSupplyAmount, null);
    assert.equal(result.warnings.length, 1);
    assert.ok(result.warnings[0].includes(`${SUPPLY_REF} · ${QUOTE_CELLS.amount}`), result.warnings[0]);
    assert.match(result.warnings[0], /저장된 계산값이 없어/);
  });

  test("🔴 음수 → null + 경고, 요약 칸으로 넘어가지 않는다", () => {
    const result = readSupply(supplyBlock(QUOTE_CELLS.amount, fml(SUPPLY_REF, "SUM(I26:I39)", -6_000), 5_000));
    assert.equal(result.fields.manualSupplyAmount, null);
    assert.equal(result.warnings.length, 1);
    assert.match(result.warnings[0], /음수/);
  });

  test("글자 금액 — 흔한 모양은 숫자로 읽되, 확인하라는 경고를 한 줄 싣는다", () => {
    const cases: [string, string][] = [
      ["3,500,000", "3500000"],
      ["₩3,500,000", "3500000"],
      ["￦ 3,500,000", "3500000"],
      ["3,500,000원", "3500000"],
      ["3,500,000 원", "3500000"],
      [" 3500000.5 ", "3500000.5"],
      ["1,234.05", "1234.05"],
      ["1,234.50", "1234.5"],
      ["3500000.00", "3500000"],
      ["0", "0"],
      ["007", "7"],
    ];
    for (const [text, expected] of cases) {
      const result = readSupply(supplyBlock(QUOTE_CELLS.amount, str(SUPPLY_REF, text)));
      assert.equal(result.fields.manualSupplyAmount, expected, text);
      assert.equal(result.warnings.length, 1, text);
      assert.match(result.warnings[0], /글자로 적혀 있어 숫자로 읽었습니다/, text);
      assert.ok(result.warnings[0].includes(`「${text}」`), text);
    }
  });

  test("🔴 글자 금액 — 받지 않는 모양은 null + 경고(요약 칸으로 넘어가지 않는다)", () => {
    for (const text of [
      "3,50,000",
      "35,00,000원",
      "3500,000",
      "-3,500,000",
      "₩-3,500,000",
      "(3,500,000)",
      "약 350만",
      "350만원",
      "3,500,000원정",
      "3,500,000.123",
      "3.500.000",
      "USD 3,500",
      "1,00",
    ]) {
      const result = readSupply(supplyBlock(QUOTE_CELLS.amount, str(SUPPLY_REF, text), 3_500_000));
      assert.equal(result.fields.manualSupplyAmount, null, text);
      assert.equal(result.warnings.length, 1, text);
      assert.match(result.warnings[0], /숫자가 아니라/, text);
      assert.ok(result.warnings[0].includes(`원문: 「${text}」`), text);
    }
  });

  test("글자 금액도 저장 쪽 규칙(정수 13자리)을 넘으면 null + 경고", () => {
    const result = readSupply(supplyBlock(QUOTE_CELLS.amount, str(SUPPLY_REF, "12,345,678,901,234")));
    assert.equal(result.fields.manualSupplyAmount, null);
    assert.equal(result.warnings.length, 1);
    assert.match(result.warnings[0], /너무 커서/);
  });

  test("소수 — 둘째 자리까지. 합계 수식의 부동소수 찌꺼기는 말없이 걷는다", () => {
    const cases: [number, string, boolean][] = [
      [0, "0", false],
      [1234.5, "1234.5", false],
      [1234.05, "1234.05", false],
      [2_050_000.0000001, "2050000", false],
      [1234.567, "1234.57", true],
    ];
    for (const [value, expected, warns] of cases) {
      const result = readSupply(supplyBlock(QUOTE_CELLS.amount, num(SUPPLY_REF, value)));
      assert.equal(result.fields.manualSupplyAmount, expected, String(value));
      assert.equal(result.warnings.length, warns ? 1 : 0, String(value));
    }
  });

  test("저장 쪽 금액 규칙(정수 13자리)을 넘는 값 → null + 경고", () => {
    const result = readSupply(supplyBlock(QUOTE_CELLS.amount, num(SUPPLY_REF, 1e14)));
    assert.equal(result.fields.manualSupplyAmount, null);
    assert.match(result.warnings[0], /너무 커서/);
  });
});

// ─────────────────────────────────────────────── 왕복 — 실제 양식 넷

const ROUND_TRIP_VALUES: Omit<GeneratorQuoteInput, "quoteDate"> = {
  quoteNumber: "DSS 2096-901",
  customerName: SAMPLE.customer,
  subject: SAMPLE.subject,
  modelName: SAMPLE.model,
  serialNumber: SAMPLE.serial,
  lotNumber: SAMPLE.lot,
  validity: SAMPLE.validity,
  delivery: SAMPLE.delivery,
  payment: SAMPLE.payment,
  parts: [{ name: "가상 부품", quantity: 2, unitPrice: 150_000 }],
  workCost: 1_200_000,
};

/**
 * 채우개는 **로컬** 날짜로 일련번호를 적는다(sheet-patch.ts 의 toExcelSerialDate). 그래서 Date 는
 * 채우는 순간에 만든다 — 모듈을 읽을 때 만들어 두면 그 사이 시간대가 바뀌었을 때 하루 밀린다.
 */
function roundTripBase(): GeneratorQuoteInput {
  return { ...ROUND_TRIP_VALUES, quoteDate: new Date(2026, 8, 15) };
}

function matcherRoundTrip(): MatcherQuoteInput {
  return {
    ...roundTripBase(),
    workScope: { INVESTIGATION: ["외관 점검"], REPAIR: ["부품 교체"], POWER_TEST: ["출력 확인"] },
  };
}

type RoundTrip = {
  key: QuoteTemplateKey;
  envKey: string;
  fill: (template: Buffer) => Buffer;
  sheet: HandwrittenQuoteSheet;
  sheetName: string;
  kind: HandwrittenQuoteKind | null;
  hasProductLine: boolean;
};

const ROUND_TRIPS: readonly RoundTrip[] = [
  {
    key: "GENERATOR:DOMESTIC",
    envKey: "QUOTE_TEMPLATE_PATH",
    fill: (template) => fillQuoteWorkbook(template, roundTripBase()),
    sheet: "GENERATOR_DOMESTIC",
    sheetName: QUOTE_SHEET_NAME,
    kind: "DOMESTIC",
    hasProductLine: true,
  },
  {
    key: "GENERATOR:OVERHAUL",
    envKey: "OH_QUOTE_TEMPLATE_PATH",
    fill: (template) => fillOhQuoteWorkbook(template, { ...roundTripBase(), overhaulParts: [] }),
    sheet: "GENERATOR_OH",
    sheetName: OH_QUOTE_SHEET_NAME,
    kind: "OVERHAUL",
    hasProductLine: true,
  },
  {
    key: "MATCHER:DOMESTIC",
    envKey: "MATCHER_QUOTE_TEMPLATE_PATH",
    fill: (template) => fillMatcherQuoteWorkbook(template, matcherRoundTrip()),
    // 🔴 매쳐 내자 양식에는 「OH작업」 이름표가 없다 — 그래서 내자로 갈린다(읽개 머리말).
    sheet: "MATCHER_DOMESTIC",
    sheetName: MATCHER_QUOTE_SHEET_NAME,
    kind: "DOMESTIC",
    hasProductLine: false,
  },
  {
    key: "MATCHER:OVERHAUL",
    envKey: "MATCHER_OH_QUOTE_TEMPLATE_PATH",
    fill: (template) => fillMatcherQuoteWorkbook(template, matcherRoundTrip()),
    /**
     * 🔴 **채워 놓고 나면 내자와 구별할 수 없다 — 그래서 여기만 내자로 읽힌다.**
     * 빈 OH 양식의 「OH작업」(D49)은 `2) 수리작업` 아래의 **항목 줄**(C49 = `-`)이라,
     * 채우개가 수리작업 목록을 넣을 때 그 줄을 덮어쓴다. 채운 매쳐 둘의 D열 이름표는
     * 그러고 나면 한 글자도 다르지 않다(2026-09-17 실측) — 어떤 읽개도 가를 수 없다.
     * 사람이 손으로 쓴 견적서에는 그 줄이 남아 있어 갈린다(아래 「빈 양식 파일 그대로」).
     */
    sheet: "MATCHER_DOMESTIC",
    sheetName: MATCHER_QUOTE_SHEET_NAME,
    kind: "DOMESTIC",
    hasProductLine: false,
  },
];

/**
 * 채운 파일의 「공 급 가」 칸 수식에 계산값(`<v>`)을 끼워 넣는다 — Excel 로 열어 저장한 파일을
 * 흉내 낸다. 칸의 자리는 채운 시트에서 머리글로 다시 찾는다(채우개가 줄을 밀었다).
 */
function withCachedSupply(filled: Buffer, sheetName: string, value: number): Buffer {
  const archive = ZipArchive.fromBuffer(filled);
  const part = resolveSheetPart(archive, sheetName);
  const sheetXml = archive.readText(part);
  const read = createCellTextReader(sheetXml, archive.readTextOrNull(SHARED_STRINGS_PART));
  const row = findSpacedLabelRow(parseSheetRows(sheetXml), read, LAYOUT_COLUMNS.unitPrice, "공급가");
  const ref = `${LAYOUT_COLUMNS.amount}${row}`;

  const pattern = new RegExp(`(<c r="${ref}"[^>]*>)(<f>[^<]*</f>)(</c>)`);
  assert.ok(pattern.test(sheetXml), `${ref} 는 계산값 없는 수식 칸이어야 한다`);
  const patched = sheetXml.replace(pattern, `$1$2<v>${value}</v>$3`);

  return writeZip(
    archive.list().map((name) => ({
      name,
      data: name === part ? Buffer.from(patched, "utf8") : archive.readEntry(name) ?? Buffer.alloc(0),
    }))
  );
}

for (const roundTrip of ROUND_TRIPS) {
  const templatePath = process.env[roundTrip.envKey];
  const skip = templatePath ? false : `${roundTrip.envKey} 가 설정되지 않았습니다`;

  describe(`왕복 — ${roundTrip.key} 양식을 채우개로 채워 읽는다`, { skip }, () => {
    const filled = () => roundTrip.fill(readFileSync(templatePath as string));

    test("채운 값이 그대로 나온다(공급가액은 계산값이 없어 null + 경고)", () => {
      const result = expectOk(readHandwrittenQuoteWorkbook(filled()));
      assert.equal(result.sheet, roundTrip.sheet);
      assert.deepEqual(result.fields, {
        kind: roundTrip.kind,
        quoteNumber: ROUND_TRIP_VALUES.quoteNumber,
        quoteDate: "2026-09-15",
        customerNameText: ROUND_TRIP_VALUES.customerName,
        subject: ROUND_TRIP_VALUES.subject,
        modelNameText: roundTrip.hasProductLine ? SAMPLE.model : null,
        lotNumberText: roundTrip.hasProductLine ? SAMPLE.lot : null,
        serialNumberText: roundTrip.hasProductLine ? SAMPLE.serial : null,
        validity: SAMPLE.validity,
        delivery: SAMPLE.delivery,
        payment: SAMPLE.payment,
        manualSupplyAmount: null,
      } satisfies HandwrittenQuoteFields);

      // 채우개는 fullCalcOnLoad 로 계산을 Excel 에 맡긴다 — 공급가 칸에 계산값이 없다.
      assert.ok(
        result.warnings.some((warning) => warning.includes("저장된 계산값이 없어 공급가액을")),
        result.warnings.join("\n")
      );
      // 🔴 양식 넷 다 종류가 갈린다 — 매쳐 둘도 이름표로 갈려 그 경고가 실리지 않는다.
      assert.equal(result.warnings.includes(MATCHER_KIND_WARNING), false, result.warnings.join("\n"));
      // 날짜 · 모델 칸에 대한 경고가 없다 — 제자리에서 제 모양으로 읽혔다.
      assert.equal(result.warnings.some((warning) => warning.includes("발행일자")), false, result.warnings.join("\n"));
      assert.equal(result.warnings.some((warning) => warning.includes("모델 칸")), false, result.warnings.join("\n"));
    });

    test("공급가액 — 공급가 칸에 계산값이 있는 파일(Excel 로 저장한 것을 흉내)", () => {
      const result = expectOk(readHandwrittenQuoteWorkbook(withCachedSupply(filled(), roundTrip.sheetName, 3_500_000)));
      assert.equal(result.fields.manualSupplyAmount, "3500000");
      assert.equal(result.warnings.some((warning) => warning.includes("공급가")), false, result.warnings.join("\n"));
    });

    test("🔴 양식을 **머리글로** 갈랐고, 값이 든 견적서로 보인다", () => {
      const result = expectOk(readHandwrittenQuoteWorkbook(filled()));
      assert.deepEqual(
        result.sheets.find((sheet) => sheet.index === result.sheetIndex),
        {
          index: result.sheetIndex,
          name: roundTrip.sheetName,
          form: roundTrip.sheet,
          recognizedBy: "header",
          filled: true,
        }
      );
    });
  });
}

/**
 * 🔴 **빈 양식 그대로** 읽는다 — 「작성됨」으로 세면 안 되는 것들이 실제로 인쇄돼 있다
 * (내자 양식의 「1번 부품」 · 수량 1 · 모델 예시, O/H 양식의 O/H 부품 목록).
 */
const BLANK_TEMPLATE_KEYS = [
  "QUOTE_TEMPLATE_PATH",
  "OH_QUOTE_TEMPLATE_PATH",
  "MATCHER_QUOTE_TEMPLATE_PATH",
  "MATCHER_OH_QUOTE_TEMPLATE_PATH",
] as const;
const blankSkip = BLANK_TEMPLATE_KEYS.every((key) => process.env[key])
  ? false
  : `${BLANK_TEMPLATE_KEYS.join(" · ")} 가 설정되지 않았습니다`;

describe("빈 양식 파일 그대로 — 실제 양식", { skip: blankSkip }, () => {
  const read = (envKey: (typeof BLANK_TEMPLATE_KEYS)[number]) =>
    expectOk(readHandwrittenQuoteWorkbook(readFileSync(process.env[envKey] as string)));

  test("🔴 제너레이터 O/H 빈 양식 — 부품 이름 예시가 인쇄돼 있어도 「작성됨」이 아니다", () => {
    assert.deepEqual(read("OH_QUOTE_TEMPLATE_PATH").sheets, [
      { index: 0, name: OH_QUOTE_SHEET_NAME, form: "GENERATOR_OH", recognizedBy: "header", filled: false },
    ]);
  });

  test("제너레이터 내자 양식 파일에는 내자 · OH 두 시트가 들어 있다 — 둘 다 머리글로 갈린다", () => {
    const result = read("QUOTE_TEMPLATE_PATH");
    assert.deepEqual(
      result.sheets.map((sheet) => [sheet.name, sheet.form, sheet.recognizedBy]),
      [
        [QUOTE_SHEET_NAME, "GENERATOR_DOMESTIC", "header"],
        [OH_QUOTE_SHEET_NAME, "GENERATOR_OH", "header"],
      ]
    );
    // 내자 시트는 비어 있다. ⚠️ 함께 든 O/H 시트는 양식에 작업비 240만이 인쇄돼 있어
    // 「작성됨」으로 나온다 — 읽개 머리말의 경고 그대로다.
    assert.equal(result.sheets[0].filled, false);
  });

  test("🔴 매쳐 양식 둘 — 시트 이름이 똑같은데도 「OH작업」 이름표로 갈린다", () => {
    const domestic = read("MATCHER_QUOTE_TEMPLATE_PATH");
    const overhaul = read("MATCHER_OH_QUOTE_TEMPLATE_PATH");
    // 탭 이름은 둘 다 「견적서」다 — 이름으로는 가를 수 없다는 것이 이 시험의 전제다.
    assert.deepEqual(
      [domestic.sheetName, overhaul.sheetName],
      [MATCHER_QUOTE_SHEET_NAME, MATCHER_QUOTE_SHEET_NAME]
    );
    assert.deepEqual(
      [domestic.sheet, domestic.fields.kind, domestic.sheets[0].recognizedBy],
      ["MATCHER_DOMESTIC", "DOMESTIC", "header"]
    );
    assert.deepEqual(
      [overhaul.sheet, overhaul.fields.kind, overhaul.sheets[0].recognizedBy],
      ["MATCHER_OH", "OVERHAUL", "header"]
    );
    // 종류를 가렸으니 「가를 수 없다」는 경고가 없다.
    for (const result of [domestic, overhaul]) {
      assert.equal(result.warnings.includes(MATCHER_KIND_WARNING), false, result.warnings.join("\n"));
    }
  });
});
