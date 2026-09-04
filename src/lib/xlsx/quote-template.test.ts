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
  type GeneratorQuoteInput,
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

const BASE: GeneratorQuoteInput = {
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

function fill(input: GeneratorQuoteInput): Filled {
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

/**
 * 그 글자가 적힌 줄을 전부 모은다.
 *
 * 「사라졌다」를 확인할 때 행 번호를 짚으면, 그 줄이 한 칸 옮겨 갔을 뿐인 경우를
 * 놓친다. 문서 어느 줄에도 없다는 것을 봐야 한다.
 */
function rowsWithText(filled: Filled, column: string, wanted: string): number[] {
  const found: number[] = [];
  for (let row = 1; row <= 120; row += 1) {
    if (filled.text(`${column}${row}`) === wanted) found.push(row);
  }
  return found;
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

// ── 작업 내역 세 묶음 ───────────────────────────────────────────────────

/** 양식의 「③ 통전검사[출하검사]」 아래 일곱 줄. 실측값이다. */
const TEMPLATE_POWER_TEST = [
  "절연저항치・내압시험",
  "각 AMP기판의 전압・전류치 확인",
  "정격출력시험",
  "스크리닝시험",
  "오픈・쇼트시험",
  "출력의 직선성 확인",
  "에이징 시험 (정격연속출력:1시간)",
];

/**
 * 🔴 「② 수리 작업」 은 양식에 **줄이 0개**다. 복제할 본이 그 구간 안에 없어서
 * 예전에는 이 구역이 통째로 비어 나갔다 — 화면에는 편집 가능한 세 칸이 떠 있는데
 * 파일에는 무슨 수리를 했는지가 한 줄도 안 적혔다.
 */
test("작업 내역: 준 대로 채워지고, 0줄짜리 ② 에도 줄이 들어간다", { skip }, () => {
  const filled = fill({
    ...BASE,
    parts: parts(3),
    workScope: {
      INVESTIGATION: ["조사 하나", "조사 둘"],
      REPAIR: ["수리 하나", "수리 둘", "수리 셋"],
      POWER_TEST: ["통전 하나"],
    },
  });
  assertSheetIsSound(filled);

  // ① 세 줄 → 두 줄.
  assert.equal(filled.text("D34"), "인수 조사", "머리글이 항목으로 덮어써졌다");
  assert.equal(filled.text("D35"), "조사 하나");
  assert.equal(filled.text("D36"), "조사 둘");
  assert.equal(filled.text("D37"), undefined, "세 번째 조사 줄이 남았다");

  // ② 0줄 → 세 줄. 복제된 줄에 줄임표까지 들어가야 한다.
  assert.equal(filled.text("D38"), "수리 작업", "머리글이 항목으로 덮어써졌다");
  assert.equal(filled.text("C39"), "-", "복제한 줄에 줄임표가 없다");
  assert.equal(filled.text("D39"), "수리 하나");
  assert.equal(filled.text("D40"), "수리 둘");
  assert.equal(filled.text("D41"), "수리 셋");

  // ③ 일곱 줄 → 한 줄.
  assert.equal(filled.text("D43"), "통전검사[출하검사]");
  assert.equal(filled.text("D44"), "통전 하나");
  assert.equal(filled.text("D45"), undefined, "두 번째 통전 줄이 남았다");

  // ④ 서류작업은 손대지 않는다.
  assert.equal(filled.text("D46"), "서류작업");

  // 아래 묶음과 합계가 늘고 준 만큼 따라 움직인다(부품 -2, ① -1, ② +3, ③ -6).
  assert.equal(filled.text("H49"), "공 급 가");
  assert.equal(filled.formula("I49"), "SUM(I26:I48)");
  assert.equal(filled.formula("I50"), "I49*0.1");
  assert.equal(filled.formula("I51"), "I49+I50");
  assert.equal(printAreaLastRow(filled.workbookXml, QUOTE_SHEET_NAME), 51);
});

/**
 * 🔴 이 파일에서 가장 조용히 망가지는 자리.
 *
 * 지금까지 저장된 제너레이터 견적서는 작업 내역이 **전부 비어 있다.** 빈 배열을
 * "0줄로 줄여라"로 읽으면, 예전 견적서를 다시 내려받는 순간 표준 통전검사 7줄이
 * 통째로 사라진 문서가 고객사로 나간다.
 */
test("🔴 빈 묶음은 양식 그대로 남는다 — 표준 문구가 사라지지 않는다", { skip }, () => {
  const empty = fill({
    ...BASE,
    parts: parts(3),
    workScope: { INVESTIGATION: [], REPAIR: [], POWER_TEST: [] },
  });
  assertSheetIsSound(empty);

  // ① 양식의 세 줄 그대로.
  assert.equal(empty.text("D34"), "인수 조사");
  assert.equal(empty.text("D35"), "외관검사");
  assert.equal(empty.text("D36"), "파라메타 체크");
  assert.equal(empty.text("D37"), "내부확인(각 보드 별 상태 확인 및 기타)");

  // ② 양식대로 0줄. 억지로 빈 줄을 만들지 않는다.
  assert.equal(empty.text("D39"), "수리 작업");
  assert.equal(empty.text("C40"), undefined, "빈 ② 에 줄이 생겼다");

  // ③ 표준 일곱 줄이 한 줄도 빠짐없이.
  assert.equal(empty.text("D41"), "통전검사[출하검사]");
  TEMPLATE_POWER_TEST.forEach((line, index) => {
    assert.equal(empty.text(`D${42 + index}`), line, `통전검사 ${index + 1}번째 줄이 사라졌다`);
  });
  assert.equal(empty.text("D50"), "서류작업");

  // 통째로 안 주는 것과 셋 다 빈 배열로 주는 것이 같은 뜻이다.
  const omitted = fill({ ...BASE, parts: parts(3) });
  assert.deepEqual(omitted.buffer, empty.buffer);
});

// ── 통전검사 제외 ───────────────────────────────────────────────────────

/** 양식에 적혀 있는 ③ 의 머리글. 뒤에 `[출하검사]` 가 붙어 있다. */
const POWER_TEST_HEADER = "통전검사[출하검사]";

/**
 * 🔴 통전작업을 하지 않으면 작업비에서 그 몫을 뺀다. 그때 문서에 통전검사 구역이
 * 그대로 남으면 **하지 않은 시험을 했다고 적어 보내는** 셈이다.
 *
 * 머리글 한 줄이 함께 사라지므로 아래가 그만큼 더 당겨 올라온다. 그 한 줄을
 * 이동량에서 빠뜨리면 공급가·부가세·합계가 엉뚱한 칸에 박힌다 — 이 시험의 중심은
 * 그 세 줄이다.
 */
test("🔴 통전검사 제외: 머리글까지 사라지고 합계 세 줄이 제자리에 온다", { skip }, () => {
  const scope = {
    INVESTIGATION: ["조사 하나", "조사 둘"],
    REPAIR: ["수리 하나", "수리 둘", "수리 셋"],
    POWER_TEST: ["통전 하나"],
  };
  const filled = fill({ ...BASE, parts: parts(3), workScope: scope, powerTestExcluded: true });
  assertSheetIsSound(filled);

  // 1) 머리글이 문서 어느 줄에도 없다.
  assert.deepEqual(rowsWithText(filled, "D", POWER_TEST_HEADER), []);
  // 2) 그 아래 항목 줄도 없다 — 준 줄도, 양식의 표준 문구도.
  assert.deepEqual(rowsWithText(filled, "D", "통전 하나"), []);
  assert.deepEqual(rowsWithText(filled, "D", "에이징 시험 (정격연속출력:1시간)"), []);

  // 5) ①·② 는 제외와 무관하게 그대로다.
  assert.equal(filled.text("D34"), "인수 조사");
  assert.equal(filled.text("D35"), "조사 하나");
  assert.equal(filled.text("D36"), "조사 둘");
  assert.equal(filled.text("D38"), "수리 작업");
  assert.equal(filled.text("C39"), "-", "복제한 줄에 줄임표가 없다");
  assert.equal(filled.text("D39"), "수리 하나");
  assert.equal(filled.text("D41"), "수리 셋");
  // ④ 서류작업도 손대지 않는다 — 통전검사 두 줄만큼(머리글 1 + 항목 1) 올라왔다.
  assert.equal(filled.text("D44"), "서류작업");

  // 3) 🔴 공급가·부가세·합계가 제자리에. 제외 안 했을 때 49·50·51 이던 것이
  //    머리글 한 줄과 항목 한 줄만큼 올라와 47·48·49 다.
  assert.equal(filled.text("H47"), "공 급 가");
  assert.equal(filled.formula("I47"), "SUM(I26:I46)");
  assert.equal(filled.text("H48"), "부 가 세");
  assert.equal(filled.formula("I48"), "I47*0.1");
  assert.equal(filled.text("H49"), "합     계");
  assert.equal(filled.formula("I49"), "I47+I48");
  assert.equal(filled.formula(QUOTE_CELLS.amount), "I47");

  // 인쇄 영역도 그만큼 올라온다. 안 밀면 합계 세 줄이 인쇄에서 잘린다.
  assert.equal(printAreaLastRow(filled.workbookXml, QUOTE_SHEET_NAME), 49);
});

/**
 * 🔴 제외는 **줄 수와 별개의 신호**다. 작업 내역을 통째로 안 주어도(= 세 묶음이
 * 빈 목록이라 양식 그대로 나가는 경우) 켜면 ③ 만 사라지고 ①·② 는 양식의 표준
 * 문구를 그대로 유지해야 한다.
 */
test("🔴 통전검사 제외: 작업 내역을 안 줘도 ③ 만 사라진다", { skip }, () => {
  const filled = fill({ ...BASE, parts: parts(3), powerTestExcluded: true });
  assertSheetIsSound(filled);

  // ①·② 는 양식 그대로.
  assert.equal(filled.text("D34"), "인수 조사");
  assert.equal(filled.text("D35"), "외관검사");
  assert.equal(filled.text("D37"), "내부확인(각 보드 별 상태 확인 및 기타)");
  assert.equal(filled.text("D39"), "수리 작업");

  // ③ 은 머리글도 항목도 없다.
  assert.deepEqual(rowsWithText(filled, "D", POWER_TEST_HEADER), []);
  for (const line of TEMPLATE_POWER_TEST) {
    assert.deepEqual(rowsWithText(filled, "D", line), [], `${line} 이 남았다`);
  }

  // 양식의 여덟 줄(머리글 1 + 항목 7)이 통째로 빠진 자리에서 합계가 제자리에.
  assert.equal(filled.text("H45"), "공 급 가");
  assert.equal(filled.formula("I45"), "SUM(I26:I44)");
  assert.equal(filled.text("H46"), "부 가 세");
  assert.equal(filled.formula("I46"), "I45*0.1");
  assert.equal(filled.text("H47"), "합     계");
  assert.equal(filled.formula("I47"), "I45+I46");
  assert.equal(printAreaLastRow(filled.workbookXml, QUOTE_SHEET_NAME), 47);
});

/**
 * 🔴 신호는 **기본이 꺼짐**이다. 주지 않은 것과 꺼서 준 것이 같아야 하고, 둘 다
 * 통전검사 구역을 그대로 내보내야 한다.
 */
test("🔴 제외하지 않으면 통전검사 구역이 그대로다 — 바이트까지 같다", { skip }, () => {
  const scope = {
    INVESTIGATION: ["조사 하나", "조사 둘"],
    REPAIR: ["수리 하나", "수리 둘", "수리 셋"],
    POWER_TEST: ["통전 하나"],
  };
  const omitted = fill({ ...BASE, parts: parts(3), workScope: scope });
  const off = fill({ ...BASE, parts: parts(3), workScope: scope, powerTestExcluded: false });

  assert.deepEqual(off.buffer, omitted.buffer, "신호를 꺼서 주면 결과가 달라졌다");

  assert.equal(omitted.text("D43"), POWER_TEST_HEADER);
  assert.equal(omitted.text("D44"), "통전 하나");
  assert.equal(omitted.text("H49"), "공 급 가");
  assert.equal(omitted.formula("I49"), "SUM(I26:I48)");
  assert.equal(printAreaLastRow(omitted.workbookXml, QUOTE_SHEET_NAME), 51);
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
