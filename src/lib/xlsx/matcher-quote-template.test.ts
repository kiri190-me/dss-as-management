import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { ZipArchive } from "./zip-reader";
import { resolveSheetTextCells } from "./sheet-text";
import { blankRow, parseSheetRows, resizeRowBlock, writeSheetRows } from "./sheet-rows";
import {
  fillMatcherQuoteWorkbook,
  MATCHER_QUOTE_CELLS,
  MATCHER_QUOTE_SHEET_NAME,
  type MatcherQuoteInput,
} from "./matcher-quote-template";

/**
 * ============================================================================
 * 매쳐 견적서 채우개
 * ============================================================================
 * 앞의 두 묶음은 **양식 없이도 도는 시험**이다. 실제 양식으로 처음 돌렸을 때
 * 터진 결함 두 개를 그 자리에 못 박아 둔다 — 둘 다 '행 배열은 멀쩡한데 XML 만
 * 망가지는' 종류라, 행 번호 배열만 견주는 시험으로는 잡히지 않았다.
 *
 * 뒤의 묶음은 실제 양식 파일이 있어야 돈다(`MATCHER_*_QUOTE_TEMPLATE_PATH`).
 * 없으면 건너뛴다 — 양식은 저장소에 두지 않는다(직인이 들어 있다).
 * ============================================================================
 */

/** 실제 양식의 한 줄을 그대로 본뜬 것. 빈 칸(자기 닫힘)이 섞여 있는 것이 핵심이다. */
const ITEM_ROW =
  '<row r="29" spans="1:9" s="13" customFormat="1" ht="15">' +
  '<c r="A29" s="80"/>' +
  '<c r="B29" s="105"/>' +
  '<c r="C29" s="78" t="s"><v>35</v></c>' +
  '<c r="D29" s="66" t="s"><v>76</v></c>' +
  '<c r="E29" s="83"/>' +
  '<c r="F29" s="106"/>' +
  '<c r="G29" s="80"><v>1</v></c>' +
  '<c r="H29" s="69"/>' +
  '<c r="I29" s="70"><f>H29*G29</f><v>0</v></c>' +
  "</row>";

const SHEET =
  '<?xml version="1.0"?><worksheet><dimension ref="A1:I31"/><sheetData>' +
  '<row r="28" spans="1:9" ht="15"><c r="A28" s="80"/><c r="D28" s="66" t="s"><v>75</v></c></row>' +
  ITEM_ROW +
  '<row r="30" spans="1:9" ht="4.5"><c r="A30" s="80"/></row>' +
  '<row r="31" spans="1:9" ht="15"><c r="D31" s="66" t="s"><v>51</v></c></row>' +
  "</sheetData></worksheet>";

/** 한 행 안에서 `<row r>` 과 모든 `<c r>` 의 숫자가 같아야 한다. 어긋나면 Excel 이 파일을 거부한다. */
function rowAddressMismatches(sheetXml: string): string[] {
  const problems: string[] = [];
  for (const row of sheetXml.matchAll(/<row\s[^>]*?r="(\d+)"[^>]*?(?:\/>|>[\s\S]*?<\/row>)/g)) {
    for (const cell of row[0].matchAll(/<c r="([A-Z]+)(\d+)"/g)) {
      if (cell[2] !== row[1]) problems.push(`${row[1]}행에 ${cell[1]}${cell[2]}`);
    }
  }
  return problems;
}

function duplicateCellRefs(sheetXml: string): string[] {
  const seen = new Set<string>();
  const duplicates: string[] = [];
  for (const cell of sheetXml.matchAll(/<c r="([A-Z]+\d+)"/g)) {
    if (seen.has(cell[1])) duplicates.push(cell[1]);
    seen.add(cell[1]);
  }
  return duplicates;
}

// ── 되돌아옴 방지 1: 자기 닫힘 셀을 여는 태그로 읽어 뒤 칸을 먹었다 ──────

test("blankRow: 빈 칸(자기 닫힘)이 섞여 있어도 나머지 칸을 먹지 않는다", () => {
  const [row] = parseSheetRows(`<sheetData>${ITEM_ROW}</sheetData>`);
  const blanked = blankRow(row);

  const columns = [...blanked.xml.matchAll(/<c r="([A-Z]+)29"/g)].map((m) => m[1]);
  assert.deepEqual(columns, ["A", "B", "C", "D", "E", "F", "G", "H", "I"]);

  // 값은 사라지고 서식은 남는다.
  assert.ok(!blanked.xml.includes("<v>"), "값이 남았다");
  assert.ok(!blanked.xml.includes("<f>"), "수식이 남았다");
  assert.ok(blanked.xml.includes('s="70"'), "서식이 사라졌다");
  // 자기 닫힘 셀을 잘못 열어 `//>` 같은 것을 만들지 않는다.
  assert.ok(!blanked.xml.includes("//>"), "태그가 깨졌다");
});

// ── 되돌아옴 방지 2: 복제본의 메타 번호와 XML 의 r= 이 어긋났다 ──────────

test("resizeRowBlock: 늘린 줄의 XML 행 번호가 실제와 같다", () => {
  const rows = parseSheetRows(SHEET);
  const { rows: grown, delta } = resizeRowBlock(rows, {
    firstRow: 29,
    currentCount: 1,
    targetCount: 4,
  });
  assert.equal(delta, 3);

  // 배열의 번호만이 아니라 **XML 안의 번호**를 본다. 여기가 어긋난 채로 있었다.
  for (const row of grown) {
    const inXml = /<row\s[^>]*?r="(\d+)"/.exec(row.xml)?.[1];
    assert.equal(inXml, String(row.rowNumber), `${row.rowNumber}행의 XML 이 ${inXml} 을 가리킨다`);
  }

  const sheet = writeSheetRows(SHEET, grown);
  assert.deepEqual(rowAddressMismatches(sheet), []);
  assert.deepEqual(duplicateCellRefs(sheet), []);
  assert.deepEqual(
    grown.map((row) => row.rowNumber),
    [28, 29, 30, 31, 32, 33, 34]
  );
});

test("resizeRowBlock: 줄여도 주소가 어긋나거나 겹치지 않는다", () => {
  const rows = parseSheetRows(SHEET);
  const { rows: grown } = resizeRowBlock(rows, { firstRow: 29, currentCount: 1, targetCount: 3 });
  const { rows: shrunk, delta } = resizeRowBlock(grown, {
    firstRow: 29,
    currentCount: 3,
    targetCount: 1,
  });

  assert.equal(delta, -2);
  const sheet = writeSheetRows(SHEET, shrunk);
  assert.deepEqual(rowAddressMismatches(sheet), []);
  assert.deepEqual(duplicateCellRefs(sheet), []);
  assert.deepEqual(
    shrunk.map((row) => row.rowNumber),
    [28, 29, 30, 31]
  );
});

// ── 실제 양식 ───────────────────────────────────────────────────────────

const domesticPath = process.env.MATCHER_QUOTE_TEMPLATE_PATH;
const overhaulPath = process.env.MATCHER_OH_QUOTE_TEMPLATE_PATH;
const skipDomestic = domesticPath ? false : "MATCHER_QUOTE_TEMPLATE_PATH 가 설정되지 않았습니다";
const skipOverhaul = overhaulPath ? false : "MATCHER_OH_QUOTE_TEMPLATE_PATH 가 설정되지 않았습니다";

/** 양식에 적혀 있던 조사작업 여섯 줄. */
const INVESTIGATION_SIX = [
  "외관 및 내부 검사",
  "파라메타 체크",
  "내부 호스 누수 검사",
  "Match,Tune VVC 성능 검사",
  "유량 및 차압 검사",
  "알람기능 작동 여부 확인",
];

/** 통전작업 여섯 줄. 조사작업과 **다른 목록**이라야 두 묶음이 섞이지 않는 것이 보인다. */
const POWER_TEST_SIX = [
  "정격 출력 시험",
  "VDC 정격 확인 시험",
  "VPP 정격 확인 시험",
  "RPI확인 시험",
  "4방향 정합 동작 확인 시험",
  "에이징시험",
];

const BASE: MatcherQuoteInput = {
  quoteNumber: "DSS 2026-999",
  quoteDate: new Date(2026, 7, 31),
  customerName: "테스트 고객사",
  subject: "MBK300-JS3 Bias Fwd Drop 수리 件",
  parts: [],
  workCost: 3_500_000,
  workScope: { INVESTIGATION: INVESTIGATION_SIX, REPAIR: [], POWER_TEST: POWER_TEST_SIX },
};

type Filled = {
  text: (ref: string) => string | undefined;
  formula: (ref: string) => string | undefined;
  sheetXml: string;
  workbookXml: string;
  archive: ZipArchive;
};

function fill(path: string, input: MatcherQuoteInput): Filled {
  const archive = ZipArchive.fromBuffer(
    fillMatcherQuoteWorkbook(readFileSync(path), input)
  );

  const refs: string[] = [];
  for (let row = 1; row <= 120; row += 1) {
    for (const column of ["B", "C", "D", "G", "H", "I"]) refs.push(`${column}${row}`);
  }
  const values = resolveSheetTextCells(archive, MATCHER_QUOTE_SHEET_NAME, refs);
  const sheetXml = archive.readText("xl/worksheets/sheet1.xml");
  const formulas = new Map<string, string>();
  for (const cell of sheetXml.matchAll(/<c r="([A-Z]+\d+)"[^>]*><f>([^<]*)<\/f>/g)) {
    formulas.set(cell[1], cell[2]);
  }

  return {
    text: (ref) => values.get(ref),
    formula: (ref) => formulas.get(ref),
    sheetXml,
    workbookXml: archive.readText("xl/workbook.xml"),
    archive,
  };
}

/** 줄이 어디로 갔든, 문서가 깨지지 않았는지는 늘 같은 방식으로 본다. */
function assertSheetIsSound(filled: Filled): void {
  assert.deepEqual(rowAddressMismatches(filled.sheetXml), [], "행 번호와 셀 주소가 어긋났다");
  assert.deepEqual(duplicateCellRefs(filled.sheetXml), [], "같은 주소의 셀이 여러 개다");

  const numbers = [...filled.sheetXml.matchAll(/<row\s[^>]*?r="(\d+)"/g)].map((m) => Number(m[1]));
  const ascending = numbers.every((value, index) => index === 0 || value > numbers[index - 1]);
  assert.ok(ascending, "행 번호가 오름차순이 아니다");

  // 줄 수가 바뀌면 공유 수식의 `ref` 가 실제와 어긋난다. 남아 있으면 안 된다.
  assert.ok(!filled.sheetXml.includes('t="shared"'), "공유 수식이 남았다");

  // 낡은 계산 캐시가 화면에 먼저 보이면 안 된다.
  assert.ok(!filled.archive.has("xl/calcChain.xml"), "calcChain 이 남았다");
  assert.ok(/fullCalcOnLoad="1"/.test(filled.workbookXml), "fullCalcOnLoad 가 꺼져 있다");
}

/**
 * 그 글자가 적힌 줄을 전부 모은다. 「사라졌다」를 행 번호로 짚으면 한 칸 옮겨 갔을
 * 뿐인 경우를 놓친다 — 문서 어느 줄에도 없다는 것을 봐야 한다.
 */
function rowsWithText(filled: Filled, column: string, wanted: string): number[] {
  const found: number[] = [];
  for (let row = 1; row <= 120; row += 1) {
    if (filled.text(`${column}${row}`) === wanted) found.push(row);
  }
  return found;
}

function printAreaLastRow(workbookXml: string): number {
  const found = /name="_xlnm\.Print_Area"[^>]*>[^<]*\$[A-Z]+\$(\d+)</.exec(workbookXml);
  assert.ok(found, "인쇄 영역을 찾지 못했다");
  return Number(found[1]);
}

test("매쳐 내자: 부품과 수리작업이 늘어나고 아래가 그만큼 밀린다", { skip: skipDomestic }, () => {
  const filled = fill(domesticPath as string, {
    ...BASE,
    parts: [
      { name: "출력측 고정 콘덴서", quantity: 1, unitPrice: 2_050_000 },
      { name: "VDC_VPP기판", quantity: 2, unitPrice: 300_000 },
      { name: "세 번째 부품", quantity: 1, unitPrice: 111_111 },
      { name: "네 번째 부품", quantity: 3, unitPrice: 22_222 },
      { name: "다섯 번째 부품", quantity: 1, unitPrice: 5_000 },
    ],
    workScope: { ...BASE.workScope, REPAIR: ["고정 콘덴서 교환", "VDC 개조작업", "추가 작업"] },
  });

  assertSheetIsSound(filled);

  // 머리 칸 — 제너레이터 양식과 한 줄씩 어긋난다.
  assert.equal(filled.text(MATCHER_QUOTE_CELLS.quoteNumber), "DSS 2026-999");
  assert.equal(filled.text(MATCHER_QUOTE_CELLS.customerName), "테스트 고객사");
  assert.equal(filled.text(MATCHER_QUOTE_CELLS.subject), "MBK300-JS3 Bias Fwd Drop 수리 件");

  // 부품 두 줄짜리 양식에 다섯 줄. 늘어난 줄도 서식과 줄임표(`-`)를 갖춘다.
  assert.equal(filled.text("D28"), "출력측 고정 콘덴서");
  assert.equal(filled.text("D32"), "다섯 번째 부품");
  assert.equal(filled.text("C32"), "-");
  assert.equal(filled.text("G32"), "1");
  assert.equal(filled.text("H32"), "5000");
  assert.equal(filled.formula("I32"), "H32*G32");
  // 여섯 번째 줄은 없다 — 늘린 만큼만.
  assert.equal(filled.text("D33"), undefined);

  // 세 묶음이 각자의 자리에.
  assert.equal(filled.text("D37"), "조사작업");
  assert.equal(filled.text("D38"), "외관 및 내부 검사");
  assert.equal(filled.text("D44"), "수리작업");
  assert.equal(filled.text("D47"), "추가 작업");
  assert.equal(filled.text("D48"), "통전작업");
  assert.equal(filled.text("D49"), "정격 출력 시험");
  assert.equal(filled.text("D54"), "에이징시험");

  // 합계 세 줄과 그 수식이 옮겨진 자리를 가리킨다.
  assert.equal(filled.text("H58"), "공 급 가");
  assert.equal(filled.formula("I58"), "SUM(I28:I57)");
  assert.equal(filled.formula("I59"), "I58*0.1");
  assert.equal(filled.formula("I60"), "SUM(I58:I59)");
  assert.equal(filled.formula(MATCHER_QUOTE_CELLS.amount), "I58");

  // 🔴 인쇄 영역도 함께 밀렸다. 안 밀면 합계가 인쇄에서 잘린다.
  assert.equal(printAreaLastRow(filled.workbookXml), 64);
});

test("매쳐 OH: 줄어들면 아래가 당겨 올라온다", { skip: skipOverhaul }, () => {
  const filled = fill(overhaulPath as string, {
    ...BASE,
    subject: "MBK600M-IC1 수리 件 + OH",
    parts: [
      { name: "MATCH 바리콘", quantity: 1, unitPrice: 1_200_000 },
      { name: "TUNE 바리콘", quantity: 1, unitPrice: 1_200_000 },
      { name: "스위칭 전원", quantity: 1, unitPrice: 250_000 },
    ],
    workScope: {
      INVESTIGATION: INVESTIGATION_SIX,
      REPAIR: ["바리콘 교환"],
      POWER_TEST: ["정격 출력 시험"],
    },
  });

  assertSheetIsSound(filled);

  // 부품 일곱 줄짜리 양식에 세 줄.
  assert.equal(filled.text("D30"), "스위칭 전원");
  assert.equal(filled.text("D31"), undefined);
  assert.equal(filled.text("D32"), "작업 비용");
  assert.equal(filled.text("H32"), "3500000");
  assert.equal(filled.formula("I32"), "H32");

  assert.equal(filled.text("D43"), "바리콘 교환");
  assert.equal(filled.text("D45"), "정격 출력 시험");
  assert.equal(filled.text("D46"), undefined);

  assert.equal(filled.text("H49"), "공 급 가");
  assert.equal(filled.formula("I49"), "SUM(I28:I48)");

  /**
   * 🔴 이 양식의 견본에는 통전작업 아래 여유 줄에 손으로 적은 조정액(-6,000)이
   * 남아 있었고, 그 줄은 합계 범위 안이다. 지우지 않으면 우리 자료에 없는 돈이
   * 고객사로 나가는 견적서에 섞인다.
   */
  for (let row = 46; row < 49; row += 1) {
    assert.equal(filled.text(`I${row}`), undefined, `${row}행에 남은 값이 있다`);
  }

  assert.equal(printAreaLastRow(filled.workbookXml), 55);
});

// ── 통전작업 제외 ───────────────────────────────────────────────────────

/**
 * 🔴 통전작업을 하지 않으면 작업비에서 그 몫을 뺀다. 그때 문서에 통전작업 구역이
 * 그대로 남으면 **하지 않은 시험을 했다고 적어 보내는** 셈이다.
 *
 * 머리글 한 줄이 함께 사라지므로 아래가 그만큼 더 당겨 올라온다. 그 한 줄을
 * 이동량에서 빠뜨리면 공급가·부가세·합계가 엉뚱한 칸에 박힌다.
 */
test("🔴 통전작업 제외: 머리글까지 사라지고 합계 세 줄이 제자리에 온다", { skip: skipDomestic }, () => {
  const filled = fill(domesticPath as string, {
    ...BASE,
    parts: [
      { name: "출력측 고정 콘덴서", quantity: 1, unitPrice: 2_050_000 },
      { name: "VDC_VPP기판", quantity: 2, unitPrice: 300_000 },
      { name: "세 번째 부품", quantity: 1, unitPrice: 111_111 },
      { name: "네 번째 부품", quantity: 3, unitPrice: 22_222 },
      { name: "다섯 번째 부품", quantity: 1, unitPrice: 5_000 },
    ],
    workScope: { ...BASE.workScope, REPAIR: ["고정 콘덴서 교환", "VDC 개조작업", "추가 작업"] },
    powerTestExcluded: true,
  });

  assertSheetIsSound(filled);

  // 1) 머리글이 문서 어느 줄에도 없다. 2) 항목 줄도 한 줄도 없다.
  assert.deepEqual(rowsWithText(filled, "D", "통전작업"), []);
  for (const line of POWER_TEST_SIX) {
    assert.deepEqual(rowsWithText(filled, "D", line), [], `${line} 이 남았다`);
  }

  // 5) 조사작업·수리작업은 제외와 무관하게 그대로다.
  assert.equal(filled.text("D37"), "조사작업");
  assert.equal(filled.text("D38"), "외관 및 내부 검사");
  assert.equal(filled.text("D43"), "알람기능 작동 여부 확인");
  assert.equal(filled.text("D44"), "수리작업");
  assert.equal(filled.text("D47"), "추가 작업");

  // 3) 🔴 공급가·부가세·합계. 제외 안 했을 때 58·59·60 이던 것이 일곱 줄
  //    (머리글 1 + 항목 6) 올라와 51·52·53 이다.
  assert.equal(filled.text("H51"), "공 급 가");
  assert.equal(filled.formula("I51"), "SUM(I28:I50)");
  assert.equal(filled.text("H52"), "부 가 세");
  assert.equal(filled.formula("I52"), "I51*0.1");
  assert.equal(filled.text("H53"), "합     계");
  assert.equal(filled.formula("I53"), "SUM(I51:I52)");
  assert.equal(filled.formula(MATCHER_QUOTE_CELLS.amount), "I51");

  // 밀려 올라온 여유 줄에 금액이 남아 있으면 합계 범위 안에 든다.
  for (let row = 48; row < 51; row += 1) {
    assert.equal(filled.text(`I${row}`), undefined, `${row}행에 남은 값이 있다`);
  }

  assert.equal(printAreaLastRow(filled.workbookXml), 57);
});

/**
 * 🔴 신호는 **기본이 꺼짐**이다. 주지 않은 것과 꺼서 준 것이 같은 시트여야 하고,
 * 둘 다 통전작업 구역을 그대로 내보내야 한다.
 */
test("🔴 제외하지 않으면 통전작업 구역이 그대로다 — 시트가 한 글자도 다르지 않다", { skip: skipDomestic }, () => {
  const input: MatcherQuoteInput = {
    ...BASE,
    parts: [{ name: "출력측 고정 콘덴서", quantity: 1, unitPrice: 2_050_000 }],
    workScope: { ...BASE.workScope, REPAIR: ["고정 콘덴서 교환"] },
  };
  const omitted = fill(domesticPath as string, input);
  const off = fill(domesticPath as string, { ...input, powerTestExcluded: false });

  assert.equal(off.sheetXml, omitted.sheetXml, "신호를 꺼서 주면 결과가 달라졌다");

  const header = rowsWithText(omitted, "D", "통전작업");
  assert.equal(header.length, 1, "통전작업 머리글이 사라졌다");
  POWER_TEST_SIX.forEach((line, index) => {
    assert.equal(omitted.text(`D${header[0] + 1 + index}`), line, `${line} 이 사라졌다`);
  });
});

/**
 * 🔴 **매쳐 양식에는 당길 번호가 없다.**
 *
 * 제너레이터 양식은 세 묶음 아래에 「④ 서류작업」이 하나 더 있어서, ③ 을 지우면
 * 그 ④ 를 ③ 으로 당겨야 번호가 `① ② ④` 로 건너뛰지 않는다
 * (xlsx/quote-sheet-layout.ts 의 `renumberPaperworkBlock`). 매쳐 양식 둘은
 * `1) 조사작업 · 2) 수리작업 · 3) 통전작업` 에서 끝나므로 맨 뒤인 3) 이 빠지면
 * `1) 2)` 로 그대로 이어진다.
 *
 * 이 시험이 지키는 것은 **없는 것을 지어내지 않았다**는 사실이다. 언젠가 이
 * 양식에 서류작업 줄이 들어오면 여기서 걸리고, 그때 번호를 함께 손봐야 한다.
 */
test("🔴 매쳐: 서류작업 묶음이 없어 당길 번호도 없다", { skip: skipDomestic }, () => {
  const input: MatcherQuoteInput = {
    ...BASE,
    parts: [{ name: "출력측 고정 콘덴서", quantity: 1, unitPrice: 2_050_000 }],
    workScope: { ...BASE.workScope, REPAIR: ["고정 콘덴서 교환"] },
  };

  const kept = fill(domesticPath as string, input);
  assert.deepEqual(rowsWithText(kept, "D", "서류작업"), [], "이 양식에 없던 묶음이다");
  assert.deepEqual(rowsWithText(kept, "B", "④"), [], "매쳐 양식은 ①②③④ 를 쓰지 않는다");
  // 양식 그대로면 세 묶음이 1) 2) 3) 이다.
  for (const [mark, label] of [
    ["1)", "조사작업"],
    ["2)", "수리작업"],
    ["3)", "통전작업"],
  ] as const) {
    const rows = rowsWithText(kept, "B", mark);
    assert.equal(rows.length, 1, `${mark} 이 하나가 아니다`);
    assert.equal(kept.text(`D${rows[0]}`), label);
  }

  // 통전작업을 없애면 맨 뒤가 빠진다 — 1) 2) 는 그대로고 3) 은 사라진다.
  const excluded = fill(domesticPath as string, { ...input, powerTestExcluded: true });
  assert.deepEqual(rowsWithText(excluded, "D", "서류작업"), [], "없던 묶음을 지어냈다");
  assert.deepEqual(rowsWithText(excluded, "B", "3)"), [], "통전작업과 함께 사라져야 한다");
  for (const [mark, label] of [
    ["1)", "조사작업"],
    ["2)", "수리작업"],
  ] as const) {
    const rows = rowsWithText(excluded, "B", mark);
    assert.equal(rows.length, 1, `${mark} 이 하나가 아니다`);
    assert.equal(excluded.text(`D${rows[0]}`), label);
  }
});

test("매쳐: 값이 모자라면 빈 칸짜리 견적서를 만드는 대신 던진다", { skip: skipDomestic }, () => {
  assert.throws(
    () => fillMatcherQuoteWorkbook(readFileSync(domesticPath as string), { ...BASE, subject: "" }),
    /품명이 비어 있습니다/
  );
});
