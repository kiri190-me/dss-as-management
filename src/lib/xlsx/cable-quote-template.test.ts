import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

import { ZipArchive } from "./zip-reader";
import { writeZip, type ZipEntryInput } from "./zip-writer";
import { createCellTextReader } from "./sheet-text";
import { toExcelSerialDate } from "./sheet-patch";
import {
  CABLE_QUOTE_CELLS,
  CABLE_QUOTE_COLUMNS,
  CABLE_QUOTE_ITEM_ROWS,
  CABLE_QUOTE_MAX_LINES,
  CABLE_QUOTE_SHEET_NAME,
  fillCableQuoteWorkbook,
  totalCableQuoteAmount,
  validateCableQuoteInput,
  type CableQuoteInput,
  type CableQuoteLine,
} from "./cable-quote-template";

/**
 * ============================================================================
 * 케이블 견적서 채우개
 * ============================================================================
 * 🔴 **실제 양식 파일을 읽지 않는다.** 그 파일에는 법인 직인과 계좌번호가 들어
 * 있어 저장소에 없고, 경로도 이 PC 에만 있다. 대신 실측한 배치를 그대로 본뜬
 * **가짜 통합문서**를 zip-writer 로 만들어 돌린다(sheet-grid.test.ts 와 같은 방식).
 *
 * 본뜬 것은 다음과 같다:
 *   · 엄격(strict) OOXML — `conformance="strict"` · `dateCompatibility="0"`
 *   · 머리말 B열 이름 · C열 값, `C16` 은 `=H44` 수식
 *   · 품목 표 몸통 26~43행, 합계 `H44=SUM(H26:H43)` · `H45` · `H46`
 *   · `calcChain.xml` 과 그 참조 두 곳
 *
 * 맨 뒤 한 묶음만 실제 양식이 있을 때 돈다(`CABLE_QUOTE_TEMPLATE_PATH`).
 * 없으면 건너뛴다.
 * ============================================================================
 */

const STRICT_MAIN_NS = "http://purl.oclc.org/ooxml/spreadsheetml/main";
const STRICT_REL_NS = "http://purl.oclc.org/ooxml/officeDocument/relationships";
const PKG_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships";
const CT_NS = "http://schemas.openxmlformats.org/package/2006/content-types";

/** 양식에 박혀 있는 글자들. 실제 양식의 공유문자열에서 본뜬 것이다. */
const SHARED = [
  "발행일자 :", // 0
  "발행번호 :", // 1
  "공 급 처 :", // 2
  "품     명  :", // 3
  "금      액  :", // 4
  "유효기간 :", // 5
  "납     기  :", // 6
  "결재조건 :", // 7
  "은행계좌:", // 8
  "특이사항 :", // 9
  "발행일로 부터 4 주", // 10 ← 유효기간 기본값
  "납입 후 결제 조건", // 11 ← 결재조건 기본값
  "기업은행(동수원지점) :  000-000000-00000.,  예금주 : ㈜디에스에스", // 12 ← 고정 문구
  "번호", // 13
  "품명", // 14
  "규격", // 15
  "수량", // 16
  "단가", // 17
  "합계", // 18
  "공 급 가", // 19
  "부 가 세", // 20
  "합     계", // 21
] as const;

function shared(index: number): string {
  return `t="s"><v>${index}</v>`;
}

/** 머리말 한 줄 — B 에 이름, C 에 값(없으면 빈 칸). */
function headerRow(row: number, labelIndex: number, value: string): string {
  const cell = value === "" ? `<c r="C${row}" s="20"/>` : `<c r="C${row}" s="20" ${value}</c>`;
  return (
    `<row r="${row}" spans="1:8">` +
    `<c r="B${row}" s="24" ${shared(labelIndex)}</c>` +
    cell +
    `<c r="D${row}" s="20"/>` +
    `</row>`
  );
}

/** 품목 표 몸통 한 줄. 여섯 칸이 전부 있고 값은 비어 있다(실제 양식 그대로). */
function bodyRow(row: number, values: Record<string, string> = {}): string {
  const columns: [string, string][] = [
    ["B", "49"],
    ["C", "47"],
    ["D", "48"],
    ["F", "57"],
    ["G", "52"],
    ["H", "53"],
  ];
  const cells = columns
    .map(([column, style]) => {
      const inner = values[column];
      return inner === undefined
        ? `<c r="${column}${row}" s="${style}"/>`
        : `<c r="${column}${row}" s="${style}">${inner}</c>`;
    })
    .join("");
  return `<row r="${row}" spans="1:8">${cells}</row>`;
}

type TemplateOptions = {
  /** 몸통 칸에 미리 박아 둘 값. `{ "H30": "<v>999</v>" }` 꼴. */
  leftovers?: Record<string, string>;
  /** 끄면 1900 일련번호 체계를 쓰는 보통(transitional) 통합문서가 된다. */
  strict?: boolean;
  /** 끄면 `calcChain.xml` 이 없는 양식이 된다. */
  calcChain?: boolean;
};

function sheetXml(options: TemplateOptions): string {
  const leftovers = options.leftovers ?? {};
  const rows: string[] = [];

  rows.push(`<row r="1" spans="1:8"><c r="A1" s="63" t="s"><v>13</v></c></row>`);
  rows.push(
    headerRow(12, 0, ""),
    headerRow(13, 1, ""),
    headerRow(14, 2, ""),
    headerRow(15, 3, "")
  );
  // 금액 — 양식이 합계를 받아 쓰는 수식이다. 우리는 손대지 않는다.
  rows.push(
    `<row r="16" spans="1:8">` +
      `<c r="B16" s="24" ${shared(4)}</c>` +
      `<c r="C16" s="33"><f>H44</f><v>0</v></c>` +
      `</row>`
  );
  rows.push(
    headerRow(17, 5, shared(10)),
    headerRow(18, 6, ""),
    headerRow(19, 7, shared(11)),
    headerRow(20, 8, shared(12)),
    headerRow(21, 9, "")
  );
  // 표 머리글.
  rows.push(
    `<row r="22" spans="1:8">` +
      `<c r="B22" s="8" ${shared(13)}</c>` +
      `<c r="C22" s="8" ${shared(14)}</c>` +
      `<c r="D22" s="8" ${shared(15)}</c>` +
      `<c r="F22" s="8" ${shared(16)}</c>` +
      `<c r="G22" s="8" ${shared(17)}</c>` +
      `<c r="H22" s="8" ${shared(18)}</c>` +
      `</row>`
  );

  for (let row = 23; row <= 43; row += 1) {
    const values: Record<string, string> = {};
    for (const [ref, inner] of Object.entries(leftovers)) {
      const found = /^([A-Z]+)(\d+)$/.exec(ref);
      if (found && Number(found[2]) === row) values[found[1]] = inner;
    }
    rows.push(bodyRow(row, values));
  }

  rows.push(
    `<row r="44" spans="1:8">` +
      `<c r="G44" s="17" ${shared(19)}</c>` +
      `<c r="H44" s="34"><f>SUM(H26:H43)</f><v>0</v></c>` +
      `</row>`,
    `<row r="45" spans="1:8">` +
      `<c r="G45" s="18" ${shared(20)}</c>` +
      `<c r="H45" s="35"><f>H44*10%</f><v>0</v></c>` +
      `</row>`,
    `<row r="46" spans="1:8">` +
      `<c r="G46" s="19" ${shared(21)}</c>` +
      `<c r="H46" s="36"><f>H44+H45</f><v>0</v></c>` +
      `</row>`
  );

  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="${STRICT_MAIN_NS}" xmlns:r="${STRICT_REL_NS}">` +
    `<dimension ref="A1:I48"/>` +
    `<sheetData>${rows.join("")}</sheetData>` +
    `<mergeCells count="2"><mergeCell ref="C12:D12"/><mergeCell ref="A1:H1"/></mergeCells>` +
    `</worksheet>`
  );
}

function templateBuffer(options: TemplateOptions = {}): Buffer {
  const strict = options.strict !== false;
  const withCalcChain = options.calcChain !== false;

  const workbookPr = strict
    ? `<workbookPr dateCompatibility="0" defaultThemeVersion="124226"/>`
    : `<workbookPr defaultThemeVersion="124226"/>`;
  const conformance = strict ? ` conformance="strict"` : "";

  const entries: ZipEntryInput[] = [
    {
      name: "[Content_Types].xml",
      data: Buffer.from(
        `<Types xmlns="${CT_NS}">` +
          `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
          `<Default Extension="xml" ContentType="application/xml"/>` +
          `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
          `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
          (withCalcChain
            ? `<Override PartName="/xl/calcChain.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.calcChain+xml"/>`
            : "") +
          `</Types>`,
        "utf8"
      ),
    },
    {
      name: "xl/workbook.xml",
      data: Buffer.from(
        `<workbook xmlns="${STRICT_MAIN_NS}" xmlns:r="${STRICT_REL_NS}"${conformance}>` +
          workbookPr +
          `<sheets><sheet name="${CABLE_QUOTE_SHEET_NAME}" sheetId="1" r:id="rId1"/>` +
          `<sheet name="Sheet2" sheetId="2" r:id="rId2"/></sheets>` +
          `<calcPr calcId="191029"/></workbook>`,
        "utf8"
      ),
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      data: Buffer.from(
        `<Relationships xmlns="${PKG_REL_NS}">` +
          `<Relationship Id="rId1" Type="${STRICT_REL_NS}/worksheet" Target="worksheets/sheet1.xml"/>` +
          `<Relationship Id="rId2" Type="${STRICT_REL_NS}/worksheet" Target="worksheets/sheet2.xml"/>` +
          `<Relationship Id="rId6" Type="${STRICT_REL_NS}/sharedStrings" Target="sharedStrings.xml"/>` +
          (withCalcChain
            ? `<Relationship Id="rId7" Type="${STRICT_REL_NS}/calcChain" Target="calcChain.xml"/>`
            : "") +
          `</Relationships>`,
        "utf8"
      ),
    },
    { name: "xl/worksheets/sheet1.xml", data: Buffer.from(sheetXml(options), "utf8") },
    {
      name: "xl/worksheets/sheet2.xml",
      data: Buffer.from(`<worksheet xmlns="${STRICT_MAIN_NS}"><sheetData/></worksheet>`, "utf8"),
    },
    {
      name: "xl/sharedStrings.xml",
      data: Buffer.from(
        `<sst xmlns="${STRICT_MAIN_NS}" count="${SHARED.length}" uniqueCount="${SHARED.length}">` +
          SHARED.map((text) => `<si><t>${text}</t></si>`).join("") +
          `</sst>`,
        "utf8"
      ),
    },
    // 그림·직인은 흉내 내지 않는다. 우리가 손대지 않는 파트라 그대로 실려 나가는
    // 것만 보면 된다 — 아무 바이트나 든 파트 하나로 그것을 본다.
    { name: "xl/media/image1.png", data: Buffer.from([0x89, 0x50, 0x4e, 0x47]) },
  ];

  if (withCalcChain) {
    entries.push({
      name: "xl/calcChain.xml",
      data: Buffer.from(
        `<calcChain xmlns="${STRICT_MAIN_NS}"><c r="H44" i="1"/><c r="C16" i="1"/></calcChain>`,
        "utf8"
      ),
    });
  }

  return writeZip(entries);
}

const BASE: CableQuoteInput = {
  quoteNumber: "DSS 2026-999",
  quoteDate: new Date(2026, 8, 16),
  customerName: "테스트 고객사",
  subject: "20kW RFG 부속케이블",
  lines: [],
};

type Filled = {
  text: (ref: string) => string | null;
  formula: (ref: string) => string | undefined;
  /** 그 칸이 비어 있는가(자기 닫힘). 칸 자체가 없어도 참이다. */
  isEmpty: (ref: string) => boolean;
  sheetXml: string;
  workbookXml: string;
  archive: ZipArchive;
};

function fill(input: CableQuoteInput, options: TemplateOptions = {}): Filled {
  const archive = ZipArchive.fromBuffer(fillCableQuoteWorkbook(templateBuffer(options), input));
  const xml = archive.readText("xl/worksheets/sheet1.xml");
  const read = createCellTextReader(xml, archive.readTextOrNull("xl/sharedStrings.xml"));

  const formulas = new Map<string, string>();
  for (const cell of xml.matchAll(/<c r="([A-Z]+\d+)"[^>]*><f>([^<]*)<\/f>/g)) {
    formulas.set(cell[1], cell[2]);
  }

  return {
    text: read,
    formula: (ref) => formulas.get(ref),
    isEmpty: (ref) => {
      const found = new RegExp(`<c r="${ref}"[^>]*?(/>|>)`).exec(xml);
      return found === null || found[1] === "/>";
    },
    sheetXml: xml,
    workbookXml: archive.readText("xl/workbook.xml"),
    archive,
  };
}

function duplicateCellRefs(xml: string): string[] {
  const seen = new Set<string>();
  const duplicates: string[] = [];
  for (const cell of xml.matchAll(/<c r="([A-Z]+\d+)"/g)) {
    if (seen.has(cell[1])) duplicates.push(cell[1]);
    seen.add(cell[1]);
  }
  return duplicates;
}

/** 어떤 입력이든 늘 같은 방식으로 본다 — 문서가 깨지지 않았는지. */
function assertSheetIsSound(filled: Filled): void {
  assert.deepEqual(duplicateCellRefs(filled.sheetXml), [], "같은 주소의 셀이 여러 개다");

  // 🔴 양식의 수식 넷은 한 글자도 달라지지 않는다.
  assert.equal(filled.formula("C16"), "H44", "표 위 요약 금액 수식이 바뀌었다");
  assert.equal(filled.formula("H44"), "SUM(H26:H43)", "공급가 수식이 바뀌었다");
  assert.equal(filled.formula("H45"), "H44*10%", "부가세 수식이 바뀌었다");
  assert.equal(filled.formula("H46"), "H44+H45", "합계 수식이 바뀌었다");

  // 고정 문구도 그대로.
  assert.equal(
    filled.text("C20"),
    "기업은행(동수원지점) :  000-000000-00000.,  예금주 : ㈜디에스에스",
    "은행계좌 문구가 바뀌었다"
  );

  // 낡은 계산 캐시가 화면에 먼저 보이면 안 된다.
  assert.ok(!filled.archive.has("xl/calcChain.xml"), "calcChain 이 남았다");
  assert.ok(/fullCalcOnLoad="1"/.test(filled.workbookXml), "fullCalcOnLoad 가 꺼져 있다");

  // 손대지 않는 파트는 그대로 실려 나간다.
  assert.ok(filled.archive.has("xl/media/image1.png"), "그림 파트가 사라졌다");
  assert.ok(filled.archive.has("xl/worksheets/sheet2.xml"), "다른 시트가 사라졌다");
}

const ITEM = (name: string, spec: string | null, quantity: number, unitPrice: number): CableQuoteLine => ({
  kind: "ITEM",
  name,
  spec,
  quantity,
  unitPrice,
});

// ── 머리말 ───────────────────────────────────────────────────────────────

describe("케이블 견적서 머리말", () => {
  test("여덟 자리가 채워진다", () => {
    const filled = fill({
      ...BASE,
      validity: "발행일로 부터 8 주",
      delivery: "발주 후 2주",
      payment: "선금 50%",
      remarks: "케이블 길이는 현장 실측 기준입니다.",
    });

    // 🔴 엄격 통합문서라 날짜는 ISO 글자다. 일련번호를 적으면 `46276` 이 찍힌다.
    assert.equal(filled.text(CABLE_QUOTE_CELLS.quoteDate), "2026-09-16");
    assert.ok(/<c r="C12"[^>]*t="d"/.test(filled.sheetXml), "t=\"d\" 로 적히지 않았다");

    assert.equal(filled.text(CABLE_QUOTE_CELLS.quoteNumber), "DSS 2026-999");
    assert.equal(filled.text(CABLE_QUOTE_CELLS.customerName), "테스트 고객사");
    assert.equal(filled.text(CABLE_QUOTE_CELLS.subject), "20kW RFG 부속케이블");
    assert.equal(filled.text(CABLE_QUOTE_CELLS.validity), "발행일로 부터 8 주");
    assert.equal(filled.text(CABLE_QUOTE_CELLS.delivery), "발주 후 2주");
    assert.equal(filled.text(CABLE_QUOTE_CELLS.payment), "선금 50%");
    assert.equal(filled.text(CABLE_QUOTE_CELLS.remarks), "케이블 길이는 현장 실측 기준입니다.");

    // 값 칸의 서식은 양식 것을 그대로 물려받는다.
    assert.ok(/<c r="C13" s="20"/.test(filled.sheetXml), "발행번호 칸의 서식이 사라졌다");
    assertSheetIsSound(filled);
  });

  test("안 준 문구는 양식의 기본값이 그대로 남는다", () => {
    const filled = fill(BASE);

    assert.equal(filled.text(CABLE_QUOTE_CELLS.validity), "발행일로 부터 4 주");
    assert.equal(filled.text(CABLE_QUOTE_CELLS.payment), "납입 후 결제 조건");
    // 양식이 비워 둔 두 칸은 비운 채로 나간다.
    assert.ok(filled.isEmpty(CABLE_QUOTE_CELLS.delivery), "납기 칸에 무언가 들어갔다");
    assert.ok(filled.isEmpty(CABLE_QUOTE_CELLS.remarks), "특이사항 칸에 무언가 들어갔다");
    assertSheetIsSound(filled);
  });

  test("일련번호 체계를 쓰는 양식이면 날짜를 숫자로 적는다", () => {
    const filled = fill(BASE, { strict: false });

    assert.equal(
      filled.text(CABLE_QUOTE_CELLS.quoteDate),
      String(toExcelSerialDate(BASE.quoteDate))
    );
    assert.ok(!/<c r="C12"[^>]*t="d"/.test(filled.sheetXml), "ISO 날짜로 적혔다");
  });
});

// ── 품목 표 ──────────────────────────────────────────────────────────────

describe("케이블 견적서 품목 표", () => {
  test("아홉 줄이 한 줄씩 띄워 앉는다", () => {
    const lines = Array.from({ length: CABLE_QUOTE_MAX_LINES }, (_value, index) =>
      ITEM(`품목 ${index + 1}`, `규격 ${index + 1}`, index + 1, (index + 1) * 1000)
    );
    const filled = fill({ ...BASE, lines });

    CABLE_QUOTE_ITEM_ROWS.forEach((row, index) => {
      assert.equal(filled.text(`B${row}`), `${index + 1})`, `${row}행의 번호`);
      assert.equal(filled.text(`C${row}`), `품목 ${index + 1}`, `${row}행의 품명`);
      assert.equal(filled.text(`D${row}`), `규격 ${index + 1}`, `${row}행의 규격`);
      assert.equal(filled.text(`F${row}`), String(index + 1), `${row}행의 수량`);
      assert.equal(filled.text(`G${row}`), String((index + 1) * 1000), `${row}행의 단가`);
      assert.equal(filled.formula(`H${row}`), `F${row}*G${row}`, `${row}행의 합계 수식`);
    });

    // 사이의 빈 줄에는 아무것도 앉지 않는다.
    for (const row of [26, 28, 30, 32, 34, 36, 38, 40, 42]) {
      assert.ok(filled.isEmpty(`C${row}`), `${row}행(빈 줄)에 품명이 앉았다`);
      assert.ok(filled.isEmpty(`H${row}`), `${row}행(빈 줄)에 금액이 앉았다`);
    }
    assertSheetIsSound(filled);
  });

  test("규격이 없으면 `-` 를 적는다", () => {
    const filled = fill({
      ...BASE,
      lines: [ITEM("Interfnector", null, 4, 50), { kind: "ITEM", name: "MB-SIG", quantity: 2, unitPrice: 2500 }, ITEM("빈칸", "   ", 1, 10)],
    });

    assert.equal(filled.text("D27"), "-");
    assert.equal(filled.text("D29"), "-");
    assert.equal(filled.text("D31"), "-");
    assertSheetIsSound(filled);
  });

  test("설명 줄은 품명 칸에 글자만 앉고 번호를 받지 않는다", () => {
    const filled = fill({
      ...BASE,
      lines: [
        { kind: "NOTE", text: "* 20kW RFG 부속케이블 Parts 3종" },
        ITEM("INPUT C)", "KR16840YA", 2, 13_000),
        { kind: "NOTE", text: "* 아래는 별도 견적" },
        ITEM("MB-SIG", "KR168", 2, 2_500),
      ],
    });

    // 27행 — 설명 줄.
    assert.equal(filled.text("C27"), "* 20kW RFG 부속케이블 Parts 3종");
    for (const column of ["B", "D", "F", "G", "H"]) {
      assert.ok(filled.isEmpty(`${column}27`), `설명 줄의 ${column}27 이 비어 있지 않다`);
    }

    // 29행 — 첫 품목. 설명 줄을 건너뛰고 `1)` 부터 센다.
    assert.equal(filled.text("B29"), "1)");
    assert.equal(filled.text("C29"), "INPUT C)");
    assert.equal(filled.text("D29"), "KR16840YA");

    // 31행 — 두 번째 설명 줄.
    assert.equal(filled.text("C31"), "* 아래는 별도 견적");
    assert.ok(filled.isEmpty("H31"), "설명 줄에 합계 수식이 남았다");

    // 33행 — 두 번째 품목. 번호가 `2)` 로 이어진다.
    assert.equal(filled.text("B33"), "2)");
    assert.equal(filled.text("C33"), "MB-SIG");
    assertSheetIsSound(filled);
  });

  test("품목이 하나도 없으면 표가 통째로 빈 채로 나간다", () => {
    const filled = fill(BASE);

    for (const row of CABLE_QUOTE_ITEM_ROWS) {
      for (const column of Object.values(CABLE_QUOTE_COLUMNS)) {
        assert.ok(filled.isEmpty(`${column}${row}`), `${column}${row} 에 무언가 앉았다`);
      }
    }
    assertSheetIsSound(filled);
  });

  test("설명 줄만 있는 견적서도 만들어진다", () => {
    const filled = fill({ ...BASE, lines: [{ kind: "NOTE", text: "* 별도 협의" }] });

    assert.equal(filled.text("C27"), "* 별도 협의");
    assert.ok(filled.isEmpty("B27"), "설명 줄에 번호가 붙었다");
    assertSheetIsSound(filled);
  });

  test("🔴 합계 구간에 남아 있던 값은 지워진다 — 어디서 왔는지 모를 돈이 얹히지 않게", () => {
    const filled = fill(
      { ...BASE, lines: [ITEM("INPUT C)", "KR16840YA", 2, 13_000)] },
      {
        leftovers: {
          // 사이의 빈 줄 · 안 쓴 품목 자리 · 표 첫 줄에 손으로 적어 둔 값.
          H30: "<v>-6000</v>",
          H41: "<v>77777</v>",
          C41: "<is><t>지난번 품목</t></is>",
          H26: "<v>12345</v>",
        },
      }
    );

    assert.ok(filled.isEmpty("H30"), "빈 줄의 금액이 남았다");
    assert.ok(filled.isEmpty("H41"), "안 쓴 품목 자리의 금액이 남았다");
    assert.ok(filled.isEmpty("C41"), "안 쓴 품목 자리의 품명이 남았다");
    assert.ok(filled.isEmpty("H26"), "표 첫 줄의 금액이 남았다");
    assert.equal(filled.formula("H27"), "F27*G27");
    assertSheetIsSound(filled);
  });

  test("calcChain 이 없는 양식도 그대로 돈다", () => {
    const filled = fill(BASE, { calcChain: false });

    assert.ok(!filled.archive.has("xl/calcChain.xml"));
    // 참조를 지우려 들지 않는다 — 없는 것을 지우려 하면 던지게 되어 있다.
    assert.ok(
      filled.archive.readText("[Content_Types].xml").includes("/xl/worksheets/sheet1.xml"),
      "Content_Types 가 망가졌다"
    );
  });

  test("calcChain 참조 세 곳이 함께 사라진다", () => {
    const filled = fill(BASE);

    assert.ok(!filled.archive.readText("[Content_Types].xml").includes("calcChain"));
    assert.ok(!filled.archive.readText("xl/_rels/workbook.xml.rels").includes("calcChain"));
  });
});

// ── 🔴 아홉 줄을 넘으면 ─────────────────────────────────────────────────

describe("케이블 견적서 줄 수 한계", () => {
  const tenLines = Array.from({ length: CABLE_QUOTE_MAX_LINES + 1 }, (_value, index) =>
    ITEM(`품목 ${index + 1}`, null, 1, 1000)
  );

  test("열 줄이면 문서를 만들지 않고 던진다", () => {
    assert.throws(
      () => fillCableQuoteWorkbook(templateBuffer(), { ...BASE, lines: tenLines }),
      /10줄/
    );
  });

  test("설명 줄도 자리를 차지한다", () => {
    const mixed: CableQuoteLine[] = [
      ...Array.from({ length: CABLE_QUOTE_MAX_LINES }, (_value, index) =>
        ITEM(`품목 ${index + 1}`, null, 1, 1000)
      ),
      { kind: "NOTE", text: "* 한 줄 더" },
    ];
    assert.throws(() => validateCableQuoteInput({ ...BASE, lines: mixed }), /10줄/);
  });

  test("딱 아홉 줄은 통과한다", () => {
    assert.doesNotThrow(() =>
      validateCableQuoteInput({ ...BASE, lines: tenLines.slice(0, CABLE_QUOTE_MAX_LINES) })
    );
  });
});

// ── 값 검사 ──────────────────────────────────────────────────────────────

describe("케이블 견적서 값 검사", () => {
  test("머리말이 비면 던진다", () => {
    assert.throws(
      () => validateCableQuoteInput({ ...BASE, quoteNumber: " ", customerName: "", subject: "" }),
      /발행번호가 비어 있습니다[\s\S]*공급처가 비어 있습니다[\s\S]*품명이 비어 있습니다/
    );
  });

  test("발행일자가 유효하지 않으면 던진다", () => {
    assert.throws(
      () => validateCableQuoteInput({ ...BASE, quoteDate: new Date("깨진 날짜") }),
      /발행일자/
    );
  });

  test("수량 0 · 음수 단가 · 빈 품명은 몇 번째 줄인지와 함께 던진다", () => {
    assert.throws(
      () =>
        validateCableQuoteInput({
          ...BASE,
          lines: [ITEM("정상", null, 1, 0), ITEM("", null, 0, -1)],
        }),
      /2번째 줄: 품명이 비어 있습니다[\s\S]*2번째 줄: 수량[\s\S]*2번째 줄: 단가/
    );
  });

  test("설명 줄의 글자가 비면 던진다", () => {
    assert.throws(
      () => validateCableQuoteInput({ ...BASE, lines: [{ kind: "NOTE", text: "   " }] }),
      /1번째 줄: 설명 줄의 글자가 비어 있습니다/
    );
  });

  test("알 수 없는 줄 종류는 던진다", () => {
    assert.throws(
      () =>
        validateCableQuoteInput({
          ...BASE,
          lines: [{ kind: "LABOR" } as unknown as CableQuoteLine],
        }),
      /알 수 없는 줄 종류/
    );
  });
});

describe("totalCableQuoteAmount", () => {
  test("품목 줄만 더한다", () => {
    assert.equal(
      totalCableQuoteAmount([
        ITEM("a", null, 2, 13_000),
        { kind: "NOTE", text: "* 설명" },
        ITEM("b", null, 4, 50),
      ]),
      26_200
    );
  });
});

// ── 실제 양식 ───────────────────────────────────────────────────────────

const templatePath = process.env.CABLE_QUOTE_TEMPLATE_PATH;
const skip = templatePath ? false : "CABLE_QUOTE_TEMPLATE_PATH 가 설정되지 않았습니다";

describe("실제 케이블 견적서 양식", { skip }, () => {
  test("머리말 · 품목 · 특이사항이 자리에 앉고 수식은 그대로다", () => {
    const archive = ZipArchive.fromBuffer(
      fillCableQuoteWorkbook(readFileSync(templatePath as string), {
        ...BASE,
        remarks: "케이블 길이는 현장 실측 기준입니다.",
        lines: [
          { kind: "NOTE", text: "* 20kW RFG 부속케이블 Parts 3종" },
          ITEM("INPUT C)", "KR16840YA", 2, 13_000),
          ITEM("MB-SIG", "KR168", 2, 2_500),
          ITEM("Interfnector", null, 4, 50),
        ],
      })
    );

    const xml = archive.readText("xl/worksheets/sheet1.xml");
    const read = createCellTextReader(xml, archive.readTextOrNull("xl/sharedStrings.xml"));

    assert.equal(read(CABLE_QUOTE_CELLS.quoteNumber), "DSS 2026-999");
    assert.equal(read(CABLE_QUOTE_CELLS.remarks), "케이블 길이는 현장 실측 기준입니다.");
    assert.equal(read("C27"), "* 20kW RFG 부속케이블 Parts 3종");
    assert.equal(read("B29"), "1)");
    assert.equal(read("D33"), "-");

    assert.ok(xml.includes("<f>SUM(H26:H43)</f>"), "합계 수식이 바뀌었다");
    assert.ok(xml.includes("<f>H44*10%</f>"), "부가세 수식이 바뀌었다");
    assert.ok(xml.includes("<f>H44+H45</f>"), "합계 수식이 바뀌었다");
    assert.ok(xml.includes("<f>H44</f>"), "표 위 요약 금액 수식이 바뀌었다");
    assert.deepEqual(duplicateCellRefs(xml), []);
    assert.ok(!archive.has("xl/calcChain.xml"), "calcChain 이 남았다");
  });
});
