import assert from "node:assert/strict";
import { test } from "node:test";

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
