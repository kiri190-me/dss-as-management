import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { ZipArchive } from "./zip-reader";
import { findCell } from "./sheet-patch";
import { resolveSheetTextCells } from "./sheet-text";
import { resolveSheetPart } from "./workbook-parts";
import {
  fillOhQuoteWorkbook,
  OH_QUOTE_CELLS,
  OH_QUOTE_SHEET_NAME,
  type OhQuoteInput,
} from "./oh-quote-template";

/**
 * ============================================================================
 * O/H 견적서 채우개
 * ============================================================================
 * 이 양식에만 있는 것 둘을 집중해서 본다:
 *
 *  1. `2) OH 부품 비용` 칸 — 일반 부품 칸과 **따로** 늘고 준다.
 *  2. 만원 단위 내림 사슬 — 절사 줄이 합계 범위 안에 들어가면 **순환 참조**가
 *     된다. 그것을 막는 것이 이 파일에서 가장 중요한 시험이다.
 * ============================================================================
 */

const templatePath = process.env.OH_QUOTE_TEMPLATE_PATH;
const skip = templatePath ? false : "OH_QUOTE_TEMPLATE_PATH 가 설정되지 않았습니다";

const BASE: OhQuoteInput = {
  quoteNumber: "DSS 2026-079-1",
  quoteDate: new Date(2026, 7, 26),
  customerName: "INVENIA Co.,Ltd.",
  subject: "KYOSAN 30/60kW Source RFG 수리 件 + OH",
  modelName: "RFK300FH-AD1",
  serialNumber: "WT7350",
  lotNumber: "1601001",
  parts: [],
  overhaulParts: [],
  workCost: 1_000_000,
};

function parts(count: number, prefix: string) {
  return Array.from({ length: count }, (_, index) => ({
    name: `${prefix} ${index + 1}`,
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
};

function fill(input: OhQuoteInput): Filled {
  const archive = ZipArchive.fromBuffer(
    fillOhQuoteWorkbook(readFileSync(templatePath as string), input)
  );
  const sheetXml = archive.readText(resolveSheetPart(archive, OH_QUOTE_SHEET_NAME));

  const refs: string[] = [];
  for (let row = 1; row <= 120; row += 1) {
    for (const column of ["B", "C", "D", "G", "H", "I"]) refs.push(`${column}${row}`);
  }
  const values = resolveSheetTextCells(archive, OH_QUOTE_SHEET_NAME, refs);

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
  };
}

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

  assert.ok(!filled.sheetXml.includes('t="shared"'), "공유 수식이 남았다");
  assert.ok(!filled.archive.has("xl/calcChain.xml"), "calcChain 이 남았다");
  assert.ok(/fullCalcOnLoad="1"/.test(filled.workbookXml), "fullCalcOnLoad 가 꺼져 있다");
}

function printAreaLastRow(workbookXml: string, sheetName: string): number | null {
  for (const found of workbookXml.matchAll(
    /<definedName[^>]*name="_xlnm\.Print_Area"[^>]*>([^<]*)<\/definedName>/g
  )) {
    if (!found[1].startsWith(`${sheetName}!`)) continue;
    return Number(/\$([A-Z]+)\$(\d+)\s*$/.exec(found[1])?.[2]);
  }
  return null;
}

// ── 실제 양식 ───────────────────────────────────────────────────────────

test("상단 정보가 들어간다", { skip }, () => {
  const filled = fill({ ...BASE, parts: parts(2, "부품"), overhaulParts: parts(2, "OH부품") });

  assert.equal(filled.text(OH_QUOTE_CELLS.quoteNumber), "DSS 2026-079-1");
  assert.equal(filled.text(OH_QUOTE_CELLS.customerName), "INVENIA Co.,Ltd.");
  assert.equal(filled.text(OH_QUOTE_CELLS.subject), "KYOSAN 30/60kW Source RFG 수리 件 + OH");
  assert.equal(
    filled.text(OH_QUOTE_CELLS.productInfo),
    "MODEL: RFK300FH-AD1, S/N:WT7350, L/N:1601001"
  );
});

test("발행일자에 TODAY() 나 외부 참조가 남지 않는다", { skip }, () => {
  const filled = fill({ ...BASE, parts: parts(1, "부품"), overhaulParts: [] });
  const raw = findCell(filled.sheetXml, OH_QUOTE_CELLS.quoteDate).raw;

  assert.ok(!raw.includes("TODAY"), "TODAY() 가 남았다");
  assert.ok(!raw.includes("["), "외부 통합문서 참조가 남았다");
  assert.equal(filled.text(OH_QUOTE_CELLS.quoteDate), "46260"); // 2026-08-26
});

test("부품 칸과 O/H 부품 칸이 따로 줄고, 아래가 그만큼 당겨진다", { skip }, () => {
  const filled = fill({ ...BASE, parts: parts(3, "부품"), overhaulParts: parts(2, "OH부품") });
  assertSheetIsSound(filled);

  // 부품 여덟 줄짜리 칸에 셋.
  assert.equal(filled.text("D27"), "부품 1");
  assert.equal(filled.text("D29"), "부품 3");
  assert.equal(filled.formula("I29"), "H29*G29");

  // O/H 부품 열두 줄짜리 칸에 둘. 머리글이 살아 있어야 한다.
  assert.equal(filled.text("D31"), "OH 부품 비용", "머리글이 부품 이름으로 덮어써졌다");
  assert.equal(filled.text("D32"), "OH부품 1");
  assert.equal(filled.text("D33"), "OH부품 2");
  assert.equal(filled.text("D34"), undefined, "세 번째 O/H 부품 줄이 남았다");

  // 작업비.
  assert.equal(filled.text("H35"), "1000000");
  assert.equal(filled.formula("I35"), "H35*G35");

  assert.equal(printAreaLastRow(filled.workbookXml, OH_QUOTE_SHEET_NAME), 59);
});

/**
 * 🔴 이 파일에서 가장 중요한 시험.
 *
 * 절사 줄(`I{공급가-1}`)은 내림 계산의 결과를 받아 적는 자리다. 합계 범위를
 * '공급가 바로 윗줄까지'로 잡으면 자기 자신을 더하게 되어 **순환 참조**가 되고,
 * Excel 은 그 파일을 열면서 경고를 띄우며 합계를 0 으로 만든다.
 */
test("만원 단위 내림 사슬 — 절사 줄이 합계 범위 밖이다", { skip }, () => {
  const filled = fill({ ...BASE, parts: parts(3, "부품"), overhaulParts: parts(2, "OH부품") });

  // 사슬이 옮겨진 자리에서 그대로 돈다.
  assert.equal(filled.formula("G63"), "SUM(I26:I52)");
  assert.equal(filled.formula("H63"), "G63/10000");
  assert.equal(filled.formula("H64"), "ROUNDDOWN(H63,0)*10000");
  assert.equal(filled.formula("I64"), "H64-G63");

  assert.equal(filled.formula("I56"), "I64", "절사 줄이 내림 결과를 받아야 한다");
  assert.equal(filled.formula("I57"), "H64", "공급가는 내린 값이다");
  assert.equal(filled.formula("I58"), "I57*0.1");
  assert.equal(filled.formula("I59"), "I57+I58");
  assert.equal(filled.formula(OH_QUOTE_CELLS.amount), "I57");

  // 🔴 합계 범위의 끝(52)이 절사 줄(56)보다 위여야 한다.
  const range = /SUM\(I\d+:I(\d+)\)/.exec(filled.formula("G63") ?? "");
  assert.ok(range, "합계 수식을 찾지 못했다");
  assert.ok(
    Number(range[1]) < 56,
    `합계 범위가 절사 줄까지 삼켰다 — 순환 참조가 된다 (끝: ${range[1]}행)`
  );
});

test("내림 규칙 자체는 손대지 않는다 — 우리가 셈해 적지 않는다", { skip }, () => {
  const filled = fill({ ...BASE, parts: parts(3, "부품"), overhaulParts: parts(2, "OH부품") });

  // 합계 칸에는 수식만 있고 우리가 셈한 캐시값이 없어야 한다. 어긋난 캐시가
  // 화면에 먼저 보이는 일이 없어야 한다.
  for (const ref of ["I57", "I58", "I59", "G63", "H63", "H64", "I64"]) {
    const raw = findCell(filled.sheetXml, ref).raw;
    assert.ok(raw.includes("<f>"), `${ref} 에 수식이 없다`);
    assert.ok(!raw.includes("<v>"), `${ref} 에 캐시값이 남았다`);
  }
});

/**
 * 이 양식은 다른 통합문서를 참조하다가 링크가 끊긴 채로 저장돼, 스무 칸 남짓이
 * `#REF!` 였다. 줄을 실제 개수에 맞추면서 그 칸들이 전부 덮이거나 사라진다.
 */
test("🔴 #REF! 가 한 칸도 남지 않는다", { skip }, () => {
  const filled = fill({ ...BASE, parts: parts(3, "부품"), overhaulParts: parts(2, "OH부품") });
  assert.equal(
    (filled.sheetXml.match(/#REF!/g) ?? []).length,
    0,
    "#REF! 가 남았다 — 받아 본 쪽에 그대로 보인다"
  );
});

test("부품이 없어도 무너지지 않는다 — 작업비만 받는 O/H 견적", { skip }, () => {
  const filled = fill({ ...BASE, parts: [], overhaulParts: [] });
  assertSheetIsSound(filled);

  // 머리글은 남고 그 아래 줄만 사라진다.
  assert.equal(filled.text("D26"), "부품 비용");
  assert.equal(filled.text("C27"), undefined, "부품 줄이 남았다");

  // 부품 8줄·O/H 12줄이 통째로 사라져 스무 줄이 당겨 올라온다.
  assert.equal(filled.text("H52"), "공 급 가");
  assert.equal(filled.formula("I52"), "H59", "공급가는 내린 값을 받는다");
  assert.equal(filled.formula("G58"), "SUM(I26:I47)");
  assert.equal(printAreaLastRow(filled.workbookXml, OH_QUOTE_SHEET_NAME), 54);
});

test("O/H 부품이 늘어나면 아래가 밀린다", { skip }, () => {
  const filled = fill({ ...BASE, parts: parts(2, "부품"), overhaulParts: parts(15, "OH부품") });
  assertSheetIsSound(filled);

  // 부품 8→2 (-6), O/H 12→15 (+3) → 통틀어 -3.
  assert.equal(filled.text("D28"), "부품 2");
  assert.equal(filled.text("D30"), "OH 부품 비용");
  assert.equal(filled.text("D45"), "OH부품 15");
  assert.equal(filled.text("D46"), undefined);
  assert.equal(printAreaLastRow(filled.workbookXml, OH_QUOTE_SHEET_NAME), 71);
});

test("잘못된 입력은 파일을 만들기 전에 던진다", { skip }, () => {
  assert.throws(() => fill({ ...BASE, subject: "  " }), /품명이 비어 있습니다/);
});
