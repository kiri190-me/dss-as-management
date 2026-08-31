import assert from "node:assert/strict";
import { test } from "node:test";

import {
  parseSheetRows,
  writeSheetRows,
  renumberRow,
  resizeRowBlock,
  findRowByCellText,
  syncDimension,
} from "./sheet-rows";
import {
  clearCell,
  escapeXmlText,
  findCell,
  readCellInner,
  setFormula,
  setInlineString,
  setNumber,
  toExcelSerialDate,
} from "./sheet-patch";

/**
 * 원본 양식에서 실제로 나오는 네 가지 모양을 그대로 옮겨 왔다.
 * 자체닫힘 / 공유문자열 / 수식+캐시값 / 접두사가 겹치는 셀 주소(D13 vs D130).
 */
const SAMPLE = [
  '<row r="13">',
  '<c r="D13" s="62"/>',
  '<c r="D130" s="99" t="s"><v>7</v></c>',
  '<c r="D10" s="65"><f ca="1">TODAY()</f><v>46262</v></c>',
  '<c r="D27" s="79" t="s"><v>98</v></c>',
  '<c r="I55" s="35"><f>M45</f><v>0</v></c>',
  "<c r=\"H27\" s=\"77\"/>",
  "</row>",
].join("");

test("findCell: 접두사가 겹치는 주소를 잘못 잡지 않는다", () => {
  assert.equal(findCell(SAMPLE, "D13").raw, '<c r="D13" s="62"/>');
  assert.equal(findCell(SAMPLE, "D130").raw, '<c r="D130" s="99" t="s"><v>7</v></c>');
});

test("findCell: 스타일 인덱스를 읽는다", () => {
  assert.equal(findCell(SAMPLE, "D13").style, "62");
  assert.equal(findCell(SAMPLE, "D10").style, "65");
});

test("findCell: 없는 셀과 중복 셀은 던진다 — 조용히 넘어가면 빈 견적서가 나간다", () => {
  assert.throws(() => findCell(SAMPLE, "Z99"), /찾지 못했습니다/);
  const duplicated = SAMPLE + '<c r="D13" s="62"/>';
  assert.throws(() => findCell(duplicated, "D13"), /2번 나옵니다/);
});

test("setInlineString: 스타일을 승계하고 sharedStrings 를 건드리지 않는다", () => {
  const out = setInlineString(SAMPLE, "D27", "MB 보드");
  assert.equal(
    findCell(out, "D27").raw,
    '<c r="D27" s="79" t="inlineStr"><is><t xml:space="preserve">MB 보드</t></is></c>'
  );
  // 다른 셀은 글자 하나 안 바뀐다.
  assert.equal(findCell(out, "D13").raw, findCell(SAMPLE, "D13").raw);
});

test("setInlineString: 빈 문자열은 값을 비운다 — 빈 <is> 를 남기지 않는다", () => {
  assert.equal(findCell(setInlineString(SAMPLE, "D27", ""), "D27").raw, '<c r="D27" s="79"/>');
});

test("setNumber / clearCell: 값과 서식", () => {
  assert.equal(findCell(setNumber(SAMPLE, "H27", 125000), "H27").raw, '<c r="H27" s="77"><v>125000</v></c>');
  assert.equal(findCell(clearCell(SAMPLE, "D27"), "D27").raw, '<c r="D27" s="79"/>');
});

test("setNumber: 지수 표기가 되는 크기는 거부한다", () => {
  assert.throws(() => setNumber(SAMPLE, "H27", 1e21), /너무 큰 숫자/);
  assert.throws(() => setNumber(SAMPLE, "H27", Number.NaN), /넣을 수 없는 숫자/);
});

test("setFormula: 캐시값을 남기지 않는다 (Excel 이 다시 계산한다)", () => {
  const out = setFormula(SAMPLE, "I55", "SUM(I26:I53)");
  assert.equal(findCell(out, "I55").raw, '<c r="I55" s="35"><f>SUM(I26:I53)</f></c>');
  assert.equal(readCellInner(out, "I55"), "<f>SUM(I26:I53)</f>");
});

test("setDate 자리: TODAY() 수식이 사라지고 날짜값만 남는다", () => {
  const out = setNumber(SAMPLE, "D10", toExcelSerialDate(new Date(2026, 7, 28)));
  assert.equal(findCell(out, "D10").raw, '<c r="D10" s="65"><v>46262</v></c>');
  assert.ok(!findCell(out, "D10").raw.includes("TODAY"));
});

test("toExcelSerialDate: 원본 양식의 캐시값과 맞는다", () => {
  // 원본 D10 에 Excel 이 적어 둔 값이 46262 이고, 그 파일을 만든 날이 2026-08-28 이다.
  assert.equal(toExcelSerialDate(new Date(2026, 7, 28)), 46262);
  assert.equal(toExcelSerialDate(new Date(1899, 11, 31)), 1);
  assert.equal(toExcelSerialDate(new Date(2026, 0, 1)), 46023);
  assert.throws(() => toExcelSerialDate(new Date("아무말")), /유효하지 않은 날짜/);
});

test("escapeXmlText: XML 특수문자와 줄바꿈", () => {
  assert.equal(escapeXmlText('R&D <보드> "A"'), "R&amp;D &lt;보드&gt; &quot;A&quot;");
  assert.equal(escapeXmlText("첫 줄\r\n둘째 줄"), "첫 줄&#10;둘째 줄");
});

test("escapeXmlText: Excel 이 손상으로 보는 제어문자는 뺀다", () => {
  assert.equal(escapeXmlText("A\u0000B\u0007C"), "ABC");
  // 탭은 XML 1.0 에서 정상이라 남긴다.
  assert.equal(escapeXmlText("A\tB"), "A\tB");
});

test("특수문자가 든 값도 왕복한다", () => {
  const out = setInlineString(SAMPLE, "D27", '㈜디에스에스 & "RF" <60kW>');
  assert.equal(
    readCellInner(out, "D27"),
    '<is><t xml:space="preserve">㈜디에스에스 &amp; &quot;RF&quot; &lt;60kW&gt;</t></is>'
  );
});

/**
 * ============================================================================
 * 줄을 늘리고 줄이기 (sheet-rows.ts)
 * ============================================================================
 * 🔴 여기가 틀리면 **깨진 견적서가 고객사로 나간다.** 행 번호와 셀 주소가 어긋난
 * 시트는 엑셀이 "복구할 수 없는 내용" 대화상자를 띄우고, 운이 나쁘면 열리기는
 * 하는데 값이 엉뚱한 칸에 앉는다. 그래서 엑셀을 띄우지 않고도 검증할 수 있도록
 * 순수 문자열 함수로 두고, 여기서 그 규칙들을 못 박는다.
 * ============================================================================
 */

/** 최소한의 시트. 행마다 D열 한 칸씩. */
function sheet(rows: readonly (readonly [number, string])[]): string {
  const body = rows
    .map(([r, text]) => `<row r="${r}" spans="1:9" ht="15"><c r="D${r}" s="7" t="inlineStr"><is><t>${text}</t></is></c></row>`)
    .join("");
  return `<worksheet><dimension ref="A1:I${rows[rows.length - 1][0]}"/><sheetData>${body}</sheetData></worksheet>`;
}

test("행을 읽고 그대로 다시 쓰면 원본과 같다 — 손대지 않은 것은 바뀌지 않는다", () => {
  const xml = sheet([[1, "가"], [2, "나"], [3, "다"]]);
  assert.equal(writeSheetRows(xml, parseSheetRows(xml)), xml);
});

test("자기 닫힘 행도 잃지 않는다 — 빈 줄에도 높이가 있어 지우면 세로 자리가 달라진다", () => {
  const xml = `<worksheet><sheetData><row r="1" ht="15"/><row r="2"><c r="D2"/></row></sheetData></worksheet>`;
  const rows = parseSheetRows(xml);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => r.rowNumber), [1, 2]);
});

test("🔴 번호를 바꾸면 행과 셀 주소가 **함께** 간다 — 하나만 고치면 엑셀이 파일을 거부한다", () => {
  const rows = parseSheetRows(sheet([[5, "값"]]));
  const moved = renumberRow(rows[0], 9);
  assert.match(moved.xml, /<row r="9"/);
  assert.match(moved.xml, /<c r="D9"/);
  assert.doesNotMatch(moved.xml, /r="D5"/, "옛 셀 주소가 남아 있으면 규격 위반이다");
});

test("구간을 늘리면 마지막 줄이 복제되고, 복제된 줄은 비어 있다", () => {
  const xml = sheet([[1, "머리"], [2, "가"], [3, "나"], [4, "꼬리"]]);
  const { rows, delta } = resizeRowBlock(parseSheetRows(xml), {
    firstRow: 2,
    currentCount: 2,
    targetCount: 4,
  });
  assert.equal(delta, 2);
  assert.deepEqual(rows.map((r) => r.rowNumber), [1, 2, 3, 4, 5, 6]);

  // 복제본은 서식을 그대로 물려받되 값은 없다 — 사람이 입힌 모양이 유지돼야 한다.
  const cloned = rows.find((r) => r.rowNumber === 4)!;
  assert.match(cloned.xml, /s="7"/, "서식이 사라졌다");
  assert.doesNotMatch(cloned.xml, /<is>/, "복제본에 옛 값이 남아 있다");

  // 아래 줄은 밀렸고 글자는 그대로다.
  assert.match(rows.find((r) => r.rowNumber === 6)!.xml, /꼬리/);
});

test("구간을 줄이면 뒤에서부터 사라지고 아래가 당겨진다", () => {
  const xml = sheet([[1, "머리"], [2, "가"], [3, "나"], [4, "다"], [5, "꼬리"]]);
  const { rows, delta } = resizeRowBlock(parseSheetRows(xml), {
    firstRow: 2,
    currentCount: 3,
    targetCount: 1,
  });
  assert.equal(delta, -2);
  assert.deepEqual(rows.map((r) => r.rowNumber), [1, 2, 3]);
  assert.match(rows[1].xml, /가/, "남는 것은 앞에서부터다");
  assert.match(rows[2].xml, /꼬리/);
});

test("줄 수가 같으면 아무것도 바뀌지 않는다", () => {
  const xml = sheet([[1, "가"], [2, "나"]]);
  const { rows, delta } = resizeRowBlock(parseSheetRows(xml), {
    firstRow: 1,
    currentCount: 2,
    targetCount: 2,
  });
  assert.equal(delta, 0);
  assert.equal(writeSheetRows(xml, rows), xml);
});

test("🔴 늘릴 본이 없으면 조용히 넘어가지 않고 던진다", () => {
  const xml = sheet([[1, "머리"], [2, "꼬리"]]);
  assert.throws(
    () => resizeRowBlock(parseSheetRows(xml), { firstRow: 5, currentCount: 0, targetCount: 2 }),
    /본이 없습니다/,
    "서식 없는 줄을 만들면 그 줄만 모양이 다른 문서가 나간다"
  );
});

test("머리글로 자리를 찾는다 — 행 번호를 코드에 박지 않기 위한 것이다", () => {
  const xml = sheet([[10, "부품 비용"], [11, "-"], [20, "작업 비용"]]);
  const rows = parseSheetRows(xml);
  const text = (ref: string) => ({ D10: "부품 비용", D11: "-", D20: "작업 비용" })[ref] ?? null;
  assert.equal(findRowByCellText(rows, "D", "작업 비용", text), 20);
  assert.equal(findRowByCellText(rows, "D", "없는 머리글", text), null);
});

test("dimension 의 마지막 행이 실제와 맞춰진다", () => {
  const xml = sheet([[1, "가"], [2, "나"]]);
  const { rows } = resizeRowBlock(parseSheetRows(xml), {
    firstRow: 1,
    currentCount: 2,
    targetCount: 5,
  });
  assert.match(syncDimension(xml, rows), /ref="A1:I5"/);
});
