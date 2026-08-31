import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { ZipArchive } from "./zip-reader";
import { findCell } from "./sheet-patch";
import { resolveSheetTextCells } from "./sheet-text";
import { resolveSheetPart } from "./workbook-parts";
import {
  buildProductInfoLine,
  fillQuoteWorkbook,
  QUOTE_CELLS,
  QUOTE_SHEET_NAME,
  totalPartsCost,
  type QuoteInput,
} from "./quote-template";

/**
 * ============================================================================
 * 내자견적서 채우개
 * ============================================================================
 * 양식은 저장소에 두지 않는다(직인·계좌번호가 들어 있다). 경로가 설정돼 있을
 * 때만 도는 시험이 대부분이고, 순수 함수 몇 개만 양식 없이 돈다.
 *
 * 자리를 **머리글로 찾기** 때문에, 시험이 견주는 행 번호는 '코드가 그렇게 정해서'가
 * 아니라 '양식이 그래서'다 — 양식을 바꾸면 이 숫자들도 함께 바뀌어야 한다.
 * ============================================================================
 */

const templatePath = process.env.QUOTE_TEMPLATE_PATH;
const skip = templatePath ? false : "QUOTE_TEMPLATE_PATH 가 설정되지 않았습니다";

const BASE: QuoteInput = {
  quoteNumber: "DSS 2026-077",
  quoteDate: new Date(2026, 7, 28),
  customerName: "ICD Co.,Ltd",
  subject: "RFK300FH-IC2 수리 견적",
  modelName: "CFK300FH-IC2",
  serialNumber: "WU8042",
  lotNumber: "1612027",
  parts: [],
  workCost: 1_200_000,
};

function parts(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    name: `부품 ${index + 1}`,
    quantity: index + 1,
    unitPrice: (index + 1) * 10_000,
  }));
}

type Filled = {
  text: (ref: string) => string | undefined;
  formula: (ref: string) => string | undefined;
  sheetXml: string;
  workbookXml: string;
  archive: ZipArchive;
  buffer: Buffer;
};

function fill(input: QuoteInput): Filled {
  const buffer = fillQuoteWorkbook(readFileSync(templatePath as string), input);
  const archive = ZipArchive.fromBuffer(buffer);
  // 🔴 시트 파트를 이름으로 찾는다. 이 통합문서에는 시트가 셋이라, 파일 이름을
  // 박아 두면 엉뚱한 시트를 들여다보며 "값이 안 들어갔다"고 오판하게 된다.
  const sheetXml = archive.readText(resolveSheetPart(archive, QUOTE_SHEET_NAME));

  const refs: string[] = [];
  for (let row = 1; row <= 120; row += 1) {
    for (const column of ["B", "C", "D", "G", "H", "I"]) refs.push(`${column}${row}`);
  }
  const values = resolveSheetTextCells(archive, QUOTE_SHEET_NAME, refs);

  const formulas = new Map<string, string>();
  for (const cell of sheetXml.matchAll(/<c\s+r="([A-Z]+\d+)"[^>]*?(\/>|>(?:(?!<c\s)[\s\S])*?<\/c>)/g)) {
    const found = /<f[^>]*>([\s\S]*?)<\/f>/.exec(cell[2]);
    if (found && found[1]) formulas.set(cell[1], found[1]);
  }

  return {
    text: (ref) => values.get(ref),
    formula: (ref) => formulas.get(ref),
    sheetXml,
    workbookXml: archive.readText("xl/workbook.xml"),
    archive,
    buffer,
  };
}

/** 행 번호와 셀 주소가 어긋나거나 겹치면 Excel 이 파일 열기를 거부한다. */
function assertSheetIsSound(filled: Filled): void {
  const mismatches: string[] = [];
  for (const row of filled.sheetXml.matchAll(/<row\s[^>]*?r="(\d+)"[^>]*?(?:\/>|>[\s\S]*?<\/row>)/g)) {
    for (const cell of row[0].matchAll(/<c r="([A-Z]+)(\d+)"/g)) {
      if (cell[2] !== row[1]) mismatches.push(`${row[1]}행에 ${cell[1]}${cell[2]}`);
    }
  }
  assert.deepEqual(mismatches, [], "행 번호와 셀 주소가 어긋났다");

  const refs = [...filled.sheetXml.matchAll(/<c r="([A-Z]+\d+)"/g)].map((m) => m[1]);
  assert.equal(new Set(refs).size, refs.length, "같은 주소의 셀이 여러 개다");

  // 줄 수가 바뀌면 공유 수식의 ref 가 실제와 어긋난다. 남아 있으면 안 된다.
  assert.ok(!filled.sheetXml.includes('t="shared"'), "공유 수식이 남았다");
  assert.ok(!filled.archive.has("xl/calcChain.xml"), "calcChain 이 남았다");
  assert.ok(/fullCalcOnLoad="1"/.test(filled.workbookXml), "fullCalcOnLoad 가 꺼져 있다");
}

/** 그 시트의 인쇄 영역 마지막 행. 다른 시트 것을 잘못 읽지 않도록 이름으로 고른다. */
function printAreaLastRow(workbookXml: string, sheetName: string): number | null {
  for (const found of workbookXml.matchAll(
    /<definedName[^>]*name="_xlnm\.Print_Area"[^>]*>([^<]*)<\/definedName>/g
  )) {
    const reference = found[1];
    if (!reference.startsWith(`${sheetName}!`)) continue;
    return Number(/\$([A-Z]+)\$(\d+)\s*$/.exec(reference)?.[2]);
  }
  return null;
}

// ── 양식 없이 도는 순수 함수 ────────────────────────────────────────────

test("buildProductInfoLine: 원본에 박혀 있던 형식 그대로", () => {
  assert.equal(
    buildProductInfoLine({ modelName: "RFK200FH-IC2", serialNumber: "WU2576", lotNumber: "1508009" }),
    "MODEL: RFK200FH-IC2, S/N:WU2576, L/N:1508009"
  );
});

test("buildProductInfoLine: 없는 조각은 빈 껍데기를 남기지 않고 통째로 뺀다", () => {
  assert.equal(buildProductInfoLine({ modelName: "RFK200FH-IC2" }), "MODEL: RFK200FH-IC2");
  assert.equal(buildProductInfoLine({ serialNumber: "WU2576" }), "S/N:WU2576");
  assert.equal(buildProductInfoLine({ modelName: "  ", serialNumber: "" }), "");
});

test("totalPartsCost: 수량 × 단가의 합", () => {
  assert.equal(
    totalPartsCost([
      { name: "가", quantity: 2, unitPrice: 1_000 },
      { name: "나", quantity: 3, unitPrice: 500 },
    ]),
    3_500
  );
});

// ── 실제 양식 ───────────────────────────────────────────────────────────

test("상단 정보가 입력대로 들어간다", { skip }, () => {
  const filled = fill({ ...BASE, parts: parts(3) });

  assert.equal(filled.text(QUOTE_CELLS.quoteNumber), "DSS 2026-077");
  assert.equal(filled.text(QUOTE_CELLS.customerName), "ICD Co.,Ltd");
  assert.equal(filled.text(QUOTE_CELLS.subject), "RFK300FH-IC2 수리 견적");
  assert.equal(filled.text(QUOTE_CELLS.productInfo), "MODEL: CFK300FH-IC2, S/N:WU8042, L/N:1612027");
});

test("발행일자: TODAY() 가 사라지고 날짜값이 박힌다", { skip }, () => {
  const filled = fill({ ...BASE, parts: parts(1) });
  const cell = findCell(filled.sheetXml, QUOTE_CELLS.quoteDate);

  assert.ok(!cell.raw.includes("TODAY"), "TODAY() 가 남았다");
  assert.equal(filled.text(QUOTE_CELLS.quoteDate), "46262"); // 2026-08-28
  // 서식(날짜 표시)은 승계해야 한다.
  assert.equal(cell.style, "65");
});

/**
 * 🔴 예전에는 부품 칸이 다섯 줄로 고정이라 여섯째부터 한 줄로 합쳐 내보냈다.
 * 이제 담을 만큼 늘어나고, **아래가 그만큼 밀린다.**
 */
test("부품 8개: 다섯 줄짜리 칸이 여덟 줄로 늘고 아래가 밀린다", { skip }, () => {
  const filled = fill({ ...BASE, parts: parts(8) });
  assertSheetIsSound(filled);

  assert.equal(filled.text("D27"), "부품 1");
  assert.equal(filled.text("D34"), "부품 8");
  assert.equal(filled.text("C34"), "-", "늘어난 줄에도 줄임표가 있어야 한다");
  assert.equal(filled.text("G34"), "8");
  assert.equal(filled.text("H34"), "80000");
  assert.equal(filled.formula("I34"), "H34*G34");
  // 아홉 번째 줄은 없다.
  assert.equal(filled.text("D35"), undefined);

  // 작업비와 합계가 세 줄 아래로.
  assert.equal(filled.text("H36"), "1200000");
  assert.equal(filled.formula("I36"), "H36*G36");
  assert.equal(filled.text("H58"), "공 급 가");
  assert.equal(filled.formula("I58"), "SUM(I26:I57)");
  assert.equal(filled.formula("I59"), "I58*0.1");
  assert.equal(filled.formula("I60"), "I58+I59");
  assert.equal(filled.formula(QUOTE_CELLS.amount), "I58");

  // 🔴 인쇄 영역도 함께. 안 밀면 합계 세 줄이 인쇄에서 잘린다.
  assert.equal(printAreaLastRow(filled.workbookXml, QUOTE_SHEET_NAME), 60);
});

test("부품 3개: 줄이 줄고 아래가 당겨 올라온다", { skip }, () => {
  const filled = fill({ ...BASE, parts: parts(3) });
  assertSheetIsSound(filled);

  assert.equal(filled.text("D29"), "부품 3");
  assert.equal(filled.text("D30"), undefined, "네 번째 줄이 남았다");
  assert.equal(filled.text("H31"), "1200000", "작업비가 두 줄 올라와야 한다");
  assert.equal(filled.text("H53"), "공 급 가");
  assert.equal(filled.formula("I53"), "SUM(I26:I52)");
  assert.equal(printAreaLastRow(filled.workbookXml, QUOTE_SHEET_NAME), 55);
});

/**
 * 양식의 공급가 수식은 빈 칸(`=M45`)을 물고 있어 늘 0 이었다. 실제 합계로 바꾼다.
 * 그 사이에 남아 있던 낡은 수식(`=N45`)도 치운다 — 합계 범위 안이라서다.
 */
test("고장난 공급가 수식이 실제 합계로 바뀌고, 사이의 낡은 수식은 치워진다", { skip }, () => {
  const filled = fill({ ...BASE, parts: parts(5) });

  const supply = filled.formula("I55");
  assert.ok(supply?.startsWith("SUM(I26:"), `공급가가 합계 수식이 아니다: ${supply}`);

  // 작업비 아래부터 공급가 위까지 금액 칸에 남은 수식이 없어야 한다.
  for (let row = 34; row < 55; row += 1) {
    assert.equal(filled.formula(`I${row}`), undefined, `${row}행에 낡은 수식이 남았다`);
  }
});

test("유효기간·납기·결재조건: 안 주면 양식의 기본 문구가 남는다", { skip }, () => {
  const untouched = fill({ ...BASE, parts: parts(1) });
  assert.equal(untouched.text(QUOTE_CELLS.validity), "발행일로부터 4주");
  assert.equal(untouched.text(QUOTE_CELLS.delivery), "발주일로부터 3주 이내");

  const replaced = fill({ ...BASE, parts: parts(1), validity: "발행일로부터 8주" });
  assert.equal(replaced.text(QUOTE_CELLS.validity), "발행일로부터 8주");
});

test("직인·로고·서식은 원본과 바이트 동일하다", { skip }, () => {
  const source = ZipArchive.fromBuffer(readFileSync(templatePath as string));
  const filled = fill({ ...BASE, parts: parts(8) });
  const sheetPart = resolveSheetPart(filled.archive, QUOTE_SHEET_NAME);

  /**
   * 우리가 손대는 파트만 뺀다. calcChain 을 들어내면 그 참조를 담은 두 파트도
   * 함께 바뀐다 — 안 바꾸면 Excel 이 "복구할 수 없는 내용" 대화상자를 띄운다.
   */
  const ours = new Set([
    sheetPart,
    "xl/workbook.xml",
    "[Content_Types].xml",
    "xl/_rels/workbook.xml.rels",
  ]);
  const untouched = filled.archive.list().filter((name) => !ours.has(name));

  for (const name of untouched) {
    assert.deepEqual(
      filled.archive.readEntry(name),
      source.readEntry(name),
      `${name} 이 바뀌었다`
    );
  }
});

test("같은 입력이면 같은 바이트가 나온다", { skip }, () => {
  const first = fillQuoteWorkbook(readFileSync(templatePath as string), { ...BASE, parts: parts(4) });
  const second = fillQuoteWorkbook(readFileSync(templatePath as string), { ...BASE, parts: parts(4) });
  assert.deepEqual(first, second);
});

test("잘못된 입력은 파일을 만들기 전에 던진다", { skip }, () => {
  assert.throws(() => fill({ ...BASE, subject: "  ", parts: parts(1) }), /품명이 비어 있습니다/);
  assert.throws(() => fill({ ...BASE, workCost: -1, parts: parts(1) }), /작업비는 0 이상/);
  assert.throws(
    () => fill({ ...BASE, parts: [{ name: "가", quantity: 0, unitPrice: 1 }] }),
    /수량은 0보다 커야 합니다/
  );
});
