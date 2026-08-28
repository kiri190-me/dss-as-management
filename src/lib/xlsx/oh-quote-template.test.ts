import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { ZipArchive } from "./zip-reader";
import { findCell, readCellInner } from "./sheet-patch";
import {
  OH_OVERHAUL_ROWS,
  OH_QUOTE_CELLS,
  fillOhQuoteWorkbook,
  type OhQuoteInput,
} from "./oh-quote-template";

const templatePath = process.env.OH_QUOTE_TEMPLATE_PATH;
const skip = templatePath ? false : "OH_QUOTE_TEMPLATE_PATH 가 설정되지 않았습니다";

const BASE: OhQuoteInput = {
  quoteNumber: "DSS 2026-079-1",
  quoteDate: new Date(2026, 7, 26),
  customerName: "INVENIA Co.,Ltd.",
  subject: "KYOSAN 30/60kW Source RFG 수리 件 + OH",
  modelName: "RFK300FH-AD1",
  serialNumber: "WT7351",
  lotNumber: "2111171",
  parts: [{ name: "종단 AMP 입력 보호 휴즈", quantity: 14, unitPrice: 30000 }],
  workCost: 2_400_000,
  overhaulParts: [
    { name: "스위칭 전원 48V", quantity: 1, unitPrice: 250000 },
    { name: "RF 컨트롤 판넬", quantity: 1, unitPrice: 480000 },
  ],
};

function generate(overrides: Partial<OhQuoteInput> = {}): ZipArchive {
  assert.ok(templatePath);
  return ZipArchive.fromBuffer(fillOhQuoteWorkbook(readFileSync(templatePath), { ...BASE, ...overrides }));
}

function sheetXml(archive: ZipArchive): string {
  const workbook = archive.readText("xl/workbook.xml");
  const relId = /<sheet[^>]*name="OH견적서"[^>]*r:id="([^"]+)"/.exec(workbook)?.[1];
  assert.ok(relId, "OH견적서 시트를 찾지 못했습니다");
  const rels = archive.readText("xl/_rels/workbook.xml.rels");
  const target = new RegExp(`<Relationship[^>]*Id="${relId}"[^>]*Target="([^"]+)"`).exec(rels)?.[1];
  assert.ok(target);
  return archive.readText(`xl/${target}`);
}

function inlineText(xml: string, ref: string): string {
  return /<t[^>]*>([\s\S]*?)<\/t>/.exec(readCellInner(xml, ref))?.[1] ?? "";
}

test("상단 정보가 들어간다", { skip }, () => {
  const xml = sheetXml(generate());
  assert.equal(inlineText(xml, OH_QUOTE_CELLS.quoteNumber), "DSS 2026-079-1");
  assert.equal(inlineText(xml, OH_QUOTE_CELLS.customerName), "INVENIA Co.,Ltd.");
  assert.equal(inlineText(xml, OH_QUOTE_CELLS.subject), "KYOSAN 30/60kW Source RFG 수리 件 + OH");
  assert.equal(
    inlineText(xml, OH_QUOTE_CELLS.productInfo),
    "MODEL: RFK300FH-AD1, S/N:WT7351, L/N:2111171"
  );
});

test("🔴 외부 통합문서를 참조하는 수식이 한 개도 남지 않는다", { skip }, () => {
  // 남으면 받아 본 쪽에 "다른 데이터 원본 링크" 경고가 뜨고 값이 갱신되지 않는다.
  const archive = generate();
  const xml = sheetXml(archive);
  assert.ok(!xml.includes("[1]"), "시트에 외부 참조가 남아 있다");
  assert.equal(
    archive.list().some((name) => name.startsWith("xl/externalLinks/")),
    false,
    "externalLinks 파트가 남아 있다"
  );
  assert.ok(!archive.readText("xl/workbook.xml").includes("externalReferences"));
  assert.ok(!archive.readText("xl/workbook.xml.rels".replace("xl/", "xl/_rels/")).includes("externalLink"));
  assert.ok(!archive.readText("[Content_Types].xml").includes("externalLink"));
});

test("작업비는 받은 값 그대로다 — 240만을 조용히 더하지 않는다", { skip }, () => {
  const xml = sheetXml(generate({ workCost: 1_000_000 }));
  assert.equal(readCellInner(xml, OH_QUOTE_CELLS.workCost), "<v>1000000</v>");
});

test("OH 부품이 34행부터 들어가고 남는 줄은 비워진다", { skip }, () => {
  const xml = sheetXml(generate());
  assert.equal(inlineText(xml, "D34"), "스위칭 전원 48V");
  assert.equal(readCellInner(xml, "G34"), "<v>1</v>");
  assert.equal(readCellInner(xml, "H35"), "<v>480000</v>");
  // 셋째 줄부터는 비어 있어야 한다 — 양식의 IFS 수식이 남으면 쓰지도 않은
  // 부품이 견적서에 찍힌다.
  for (const row of OH_OVERHAUL_ROWS.slice(2)) {
    assert.equal(readCellInner(xml, `D${row}`), "", `D${row} 가 비어 있어야 한다`);
  }
});

test("🔴 I46 의 조건 수식이 다른 줄과 같아진다", { skip }, () => {
  // 원본은 `IF(D46="유량계", …)` 라, 다른 부품을 그 자리에 쓰면 금액이 ""가 되어
  // 합계에서 통째로 빠진다.
  const xml = sheetXml(generate());
  assert.equal(readCellInner(xml, "I46"), "<f>H46*G46</f>");
  assert.ok(!readCellInner(xml, "I46").includes("유량계"));
});

test("합계 사슬(만원 단위 내림)은 손대지 않는다", { skip }, () => {
  const xml = sheetXml(generate());
  // I70 = H77 = ROUNDDOWN(H76,0)*10000, H76 = G76/10000, G76 = SUM(I26:I65)
  assert.match(readCellInner(xml, "I70"), /<f>H77<\/f>/);
  assert.match(readCellInner(xml, "H77"), /ROUNDDOWN/);
  assert.match(readCellInner(xml, "G76"), /SUM\(I26:I65\)/);
  assert.match(readCellInner(xml, "I71"), /I70\*0\.1/);
  assert.match(readCellInner(xml, "I72"), /I70\+I71/);
});

test("직인·로고·서식은 원본과 바이트 동일하다", { skip }, () => {
  assert.ok(templatePath);
  const source = ZipArchive.fromBuffer(readFileSync(templatePath));
  const result = generate();
  const untouched = source
    .list()
    .filter((n) => n.startsWith("xl/media/") || n.startsWith("xl/drawings/") || n === "xl/styles.xml");
  assert.ok(untouched.length >= 3);
  for (const name of untouched) {
    assert.deepEqual(result.readEntry(name), source.readEntry(name), `파트가 바뀌었습니다: ${name}`);
  }
});

test("OH 부품이 13줄을 넘으면 자르지 않고 던진다", { skip }, () => {
  const overhaulParts = Array.from({ length: 14 }, (_, i) => ({
    name: `부품 ${i + 1}`,
    quantity: 1,
    unitPrice: 1000,
  }));
  assert.throws(() => generate({ overhaulParts }), /13줄까지/);
});

test("발행일자에 TODAY() 나 외부 참조가 남지 않는다", { skip }, () => {
  const xml = sheetXml(generate());
  const raw = findCell(xml, OH_QUOTE_CELLS.quoteDate).raw;
  assert.ok(!raw.includes("<f>"), "수식이 남아 있다");
  assert.equal(readCellInner(xml, OH_QUOTE_CELLS.quoteDate), "<v>46260</v>"); // 2026-08-26
});
