import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { ZipArchive } from "./zip-reader";
import { findCell, readCellInner } from "./sheet-patch";
import {
  buildProductInfoLine,
  fillQuoteWorkbook,
  PARTS_ROLLUP_LABEL,
  QUOTE_CELLS,
  SUPPLY_TOTAL_FORMULA,
  totalPartsCost,
  type QuoteInput,
} from "./quote-template";

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

// ── 순수 함수 (양식 없이도 돈다) ─────────────────────────────────────────

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
      { name: "a", quantity: 2, unitPrice: 30_000 },
      { name: "b", quantity: 1, unitPrice: 5_500 },
    ]),
    65_500
  );
});

// ── 원본 양식이 있어야 도는 것들 ─────────────────────────────────────────

function generate(overrides: Partial<QuoteInput> = {}): ZipArchive {
  assert.ok(templatePath);
  return ZipArchive.fromBuffer(
    fillQuoteWorkbook(readFileSync(templatePath), { ...BASE, ...overrides })
  );
}

/** 시트 파트는 이름으로 찾는다(구현과 같은 이유 — 탭 순서에 기대지 않는다). */
function sheetXml(archive: ZipArchive): string {
  const workbook = archive.readText("xl/workbook.xml");
  const relId = /<sheet[^>]*name="내자견적서"[^>]*r:id="([^"]+)"/.exec(workbook)?.[1];
  assert.ok(relId, "내자견적서 시트를 찾지 못했습니다");
  const rels = archive.readText("xl/_rels/workbook.xml.rels");
  const target = new RegExp(`<Relationship[^>]*Id="${relId}"[^>]*Target="([^"]+)"`).exec(rels)?.[1];
  assert.ok(target);
  return archive.readText(`xl/${target}`);
}

function inlineText(xml: string, ref: string): string {
  const inner = readCellInner(xml, ref);
  return /<t[^>]*>([\s\S]*?)<\/t>/.exec(inner)?.[1] ?? "";
}

test("상단 정보가 입력대로 들어간다", { skip }, () => {
  const xml = sheetXml(generate());
  assert.equal(inlineText(xml, QUOTE_CELLS.quoteNumber), "DSS 2026-077");
  assert.equal(inlineText(xml, QUOTE_CELLS.customerName), "ICD Co.,Ltd");
  assert.equal(inlineText(xml, QUOTE_CELLS.subject), "RFK300FH-IC2 수리 견적");
  assert.equal(inlineText(xml, QUOTE_CELLS.productInfo), "MODEL: CFK300FH-IC2, S/N:WU8042, L/N:1612027");
  assert.equal(readCellInner(xml, QUOTE_CELLS.workCost), "<v>1200000</v>");
});

test("발행일자: TODAY() 가 사라지고 날짜값이 박힌다", { skip }, () => {
  const xml = sheetXml(generate());
  assert.equal(readCellInner(xml, QUOTE_CELLS.quoteDate), "<v>46262</v>");
  assert.ok(!findCell(xml, QUOTE_CELLS.quoteDate).raw.includes("TODAY"));
  // 스타일(날짜 서식)은 원본 것을 승계한다.
  assert.equal(findCell(xml, QUOTE_CELLS.quoteDate).style, "65");
});

test("고장난 공급가 수식을 실제 합계로 바꾼다", { skip }, () => {
  const xml = sheetXml(generate());
  assert.equal(readCellInner(xml, QUOTE_CELLS.supplyTotal), `<f>${SUPPLY_TOTAL_FORMULA}</f>`);
  // 부가세·합계는 손대지 않는다.
  assert.equal(readCellInner(xml, "I56"), "<f>I55*0.1</f><v>0</v>");
  assert.equal(readCellInner(xml, "I57"), "<f>I55+I56</f><v>0</v>");
});

test("부품 3개: 채워진 줄과 비워진 줄", { skip }, () => {
  const xml = sheetXml(
    generate({
      parts: [
        { name: "MB 보드", quantity: 1, unitPrice: 850_000 },
        { name: "RF AMP 모듈", quantity: 2, unitPrice: 1_100_000 },
        { name: "냉각 팬", quantity: 1, unitPrice: 45_000 },
      ],
    })
  );

  assert.equal(inlineText(xml, "D27"), "MB 보드");
  assert.equal(readCellInner(xml, "G28"), "<v>2</v>");
  assert.equal(readCellInner(xml, "H29"), "<v>45000</v>");

  // 원본의 "4번 부품"·"5번 부품" 예시 문구가 남으면 안 된다.
  for (const row of [30, 31]) {
    for (const col of ["D", "G", "H"]) {
      assert.equal(readCellInner(xml, `${col}${row}`), "", `${col}${row} 가 비어 있어야 한다`);
    }
  }
});

test("부품 7개: 한 줄로 합산하고 나머지를 비운다", { skip }, () => {
  const parts = Array.from({ length: 7 }, (_, i) => ({
    name: `부품 ${i + 1}`,
    quantity: 2,
    unitPrice: 10_000,
  }));
  const xml = sheetXml(generate({ parts }));

  assert.equal(inlineText(xml, "D27"), PARTS_ROLLUP_LABEL);
  assert.equal(readCellInner(xml, "G27"), "<v>1</v>");
  assert.equal(readCellInner(xml, "H27"), `<v>${totalPartsCost(parts)}</v>`);
  for (const row of [28, 29, 30, 31]) {
    assert.equal(readCellInner(xml, `D${row}`), "", `D${row} 가 비어 있어야 한다`);
  }
});

test("유효기간·납기·결재조건: 안 주면 양식의 기본 문구가 남는다", { skip }, () => {
  const untouched = sheetXml(generate());
  assert.equal(inlineText(untouched, QUOTE_CELLS.validity), "");
  assert.ok(findCell(untouched, QUOTE_CELLS.validity).raw.includes('t="s"'), "원본 공유문자열 그대로여야 한다");

  const replaced = sheetXml(generate({ validity: "발행일로부터 8주" }));
  assert.equal(inlineText(replaced, QUOTE_CELLS.validity), "발행일로부터 8주");
});

test("직인·로고·서식·기타 시트는 원본과 바이트 동일하다", { skip }, () => {
  assert.ok(templatePath);
  const source = ZipArchive.fromBuffer(readFileSync(templatePath));
  const result = generate();

  const untouched = source
    .list()
    .filter(
      (name) =>
        name.startsWith("xl/media/") ||
        name.startsWith("xl/drawings/") ||
        name.startsWith("xl/theme/") ||
        name.startsWith("xl/printerSettings/") ||
        name === "xl/styles.xml" ||
        name === "xl/sharedStrings.xml" ||
        name === "xl/worksheets/sheet2.xml" ||
        name === "xl/worksheets/sheet3.xml"
    );
  assert.ok(untouched.length >= 8, "확인할 파트가 너무 적습니다");

  for (const name of untouched) {
    assert.deepEqual(result.readEntry(name), source.readEntry(name), `파트가 바뀌었습니다: ${name}`);
  }
});

test("calcChain 을 들어내고 참조도 함께 지운다", { skip }, () => {
  const archive = generate();
  assert.equal(archive.has("xl/calcChain.xml"), false);
  assert.ok(!archive.readText("[Content_Types].xml").includes("calcChain"));
  assert.ok(!archive.readText("xl/_rels/workbook.xml.rels").includes("calcChain"));
});

test("workbook 에 fullCalcOnLoad 가 켜진다", { skip }, () => {
  const workbook = generate().readText("xl/workbook.xml");
  assert.match(workbook, /<calcPr[^>]*fullCalcOnLoad="1"/);
  // 시트 목록은 그대로여야 한다.
  assert.ok(workbook.includes('name="내자견적서"'));
  assert.ok(workbook.includes('name="OH견적서"'));
});

test("잘못된 입력은 파일을 만들기 전에 던진다", { skip }, () => {
  assert.throws(() => generate({ quoteNumber: "  " }), /발행번호/);
  assert.throws(() => generate({ customerName: "" }), /공급처/);
  assert.throws(() => generate({ workCost: -1 }), /작업비/);
  assert.throws(
    () => generate({ parts: [{ name: "MB 보드", quantity: 0, unitPrice: 100 }] }),
    /수량/
  );
});

test("같은 입력이면 같은 바이트가 나온다", { skip }, () => {
  assert.ok(templatePath);
  const template = readFileSync(templatePath);
  assert.deepEqual(fillQuoteWorkbook(template, BASE), fillQuoteWorkbook(template, BASE));
});
