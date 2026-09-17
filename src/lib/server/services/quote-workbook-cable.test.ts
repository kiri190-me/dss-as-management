import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

import { cableQuoteInputOf } from "./quote-workbook";
import { CABLE_QUOTE_MAX_LINES, totalCableQuoteAmount } from "@/lib/xlsx/cable-quote-template";
import { sumQuoteSupplyAmount } from "@/lib/domain/quote-list";
import type { QuoteEditData } from "@/lib/db/queries/quotes";

/**
 * ============================================================================
 * 케이블 견적서의 받기 — 케이블 양식으로 나가는가 (2026-09-17 케이블 ④)
 * ============================================================================
 * 앞 조각까지 케이블 견적서는 **적고 저장할 수만** 있었다. 받기 통로를 여는 순간, 그
 * 장이 내자 양식으로 채워져 나가면 **케이블 값이 내자 서식에 앉은 문서**가 고객사로
 * 간다 — domain/quote-document-support.ts 머리말이 "이 저장소에서 가장 나쁜 고장"이라
 * 부른 그것이다. 그래서 두 가지를 본다:
 *
 *  ㉠ **값을 옮기는 규칙** — 순수 함수 `cableQuoteInputOf` 를 직접 불러 본다. 설명 줄이
 *     차례 그대로 넘어가는지, 규격 · 특이사항 · 날짜가 맞는지, 합계에 설명 줄이 섞이지
 *     않는지.
 *  ㉡ **갈림길이 제자리에 있는가** — `renderQuoteWorkbook` 은 디스크에서 양식을 읽어
 *     시험에서 부를 수 없으므로(그 파일에는 직인과 계좌가 들어 있어 저장소에 없다),
 *     형제 시험들과 같은 방법으로 **원본 글자를 읽어** 본다
 *     (quote-document-support.test.ts · *-source.test.ts 와 같은 방식).
 * ============================================================================
 */

const repoUrl = new URL("../../../../", import.meta.url);
const read = (relativePath: string) => readFileSync(new URL(relativePath, repoUrl), "utf8").replace(/\r\n/g, "\n");
const flat = (source: string) => source.replace(/\s+/g, " ");

const source = flat(read("src/lib/server/services/quote-workbook.ts"));

type ItemLine = QuoteEditData["itemLines"][number];

function itemLine(over: Partial<ItemLine> = {}): ItemLine {
  return {
    partId: null,
    kind: "ITEM",
    partNameText: "RG-393 동축케이블",
    partSpecText: "3m, N(M)-N(M)",
    isOverhaulPart: false,
    quantity: 2,
    unitPrice: "150000",
    ...over,
  };
}

function noteLine(text: string): ItemLine {
  return {
    partId: null,
    kind: "NOTE",
    partNameText: text,
    partSpecText: null,
    isOverhaulPart: false,
    quantity: null,
    unitPrice: null,
  };
}

/** 케이블 장 한 개. 작업 값은 화면이 비워 보내므로(케이블 ③) 전부 빈 자리다. */
function cableQuote(over: Partial<QuoteEditData> = {}): QuoteEditData {
  return {
    id: "8f1c0a20-0000-4000-8000-000000000001",
    version: 1,
    quoteNumber: "DSS 2026-101",
    kind: "CABLE",
    quoteDate: "2026-09-17",
    repairCaseId: null,
    intakeNumberText: null,
    customerId: null,
    customerNameText: "주성 엔지니어링",
    modelNameText: null,
    lotNumberText: null,
    serialNumberText: null,
    faultDescriptionText: null,
    subject: "20kW RFG 부속케이블",
    validity: null,
    delivery: null,
    payment: null,
    remarks: null,
    workCost: "0",
    laborEquipmentKind: null,
    laborBaseCost: null,
    powerTestExcluded: false,
    laborPowerTestDeduction: null,
    investigationExcluded: false,
    documentExcluded: false,
    isExcelOnly: false,
    manualSupplyAmount: null,
    repairTasks: [],
    workScopeLines: [],
    items: [],
    itemLines: [],
    ...over,
  };
}

describe("㉠ 값을 옮기는 규칙 — cableQuoteInputOf", () => {
  test("🔴 설명 줄이 **차례 그대로** 넘어간다 — 종류로 나누지 않는다", () => {
    const input = cableQuoteInputOf(
      cableQuote({
        itemLines: [
          noteLine("* 20kW RFG 부속케이블 Parts 3종"),
          itemLine({ partNameText: "RF 케이블" }),
          itemLine({ partNameText: "DC 케이블" }),
          noteLine("* 아래는 별도 주문품"),
          itemLine({ partNameText: "제어 케이블" }),
        ],
      })
    );

    assert.deepEqual(
      input.lines.map((line) => (line.kind === "NOTE" ? `NOTE:${line.text}` : `ITEM:${line.name}`)),
      [
        "NOTE:* 20kW RFG 부속케이블 Parts 3종",
        "ITEM:RF 케이블",
        "ITEM:DC 케이블",
        "NOTE:* 아래는 별도 주문품",
        "ITEM:제어 케이블",
      ]
    );
  });

  test("🔴 설명 줄에는 수량 · 단가가 아예 없다 — DB 의 CHECK 와 같은 모양이다", () => {
    const [line] = cableQuoteInputOf(cableQuote({ itemLines: [noteLine("* 안내")] })).lines;
    assert.deepEqual(line, { kind: "NOTE", text: "* 안내" });
  });

  test("품목 줄은 이름 · 규격 · 수량 · 단가를 그대로 — 단가는 여기서 숫자가 된다", () => {
    const [line] = cableQuoteInputOf(
      cableQuote({ itemLines: [itemLine({ quantity: 3, unitPrice: "150000.00" })] })
    ).lines;
    assert.deepEqual(line, {
      kind: "ITEM",
      name: "RG-393 동축케이블",
      spec: "3m, N(M)-N(M)",
      quantity: 3,
      unitPrice: 150000,
    });
  });

  test("규격이 없는 줄은 null 로 넘긴다 — `-` 를 적는 일은 채우개 한 곳이다", () => {
    const [line] = cableQuoteInputOf(cableQuote({ itemLines: [itemLine({ partSpecText: null })] })).lines;
    assert.equal(line.kind === "ITEM" && line.spec, null);
  });

  test("🔴 합계에 설명 줄이 섞이지 않는다 — 도메인의 셈과 같은 값이다", () => {
    const itemLines = [
      noteLine("* 20kW RFG 부속케이블 Parts 3종"),
      itemLine({ quantity: 2, unitPrice: "150000" }),
      noteLine("* 아래는 별도 주문품"),
      itemLine({ quantity: 1, unitPrice: "80000" }),
    ];
    const quote = cableQuote({ itemLines });

    const total = totalCableQuoteAmount(cableQuoteInputOf(quote).lines);
    assert.equal(total, 2 * 150000 + 80000);
    // 화면(미리보기 · 목록)이 보는 셈과 같은 값이어야 한다 — 다르면 문서와 화면이 갈린다.
    assert.equal(total, sumQuoteSupplyAmount(itemLines, quote.workCost));
  });

  test("🔴 발행일자는 로컬 날짜다 — `new Date(문자열)` 이면 시간대에 따라 하루가 밀린다", () => {
    const { quoteDate } = cableQuoteInputOf(cableQuote({ quoteDate: "2026-01-01" }));
    assert.equal(quoteDate.getFullYear(), 2026);
    assert.equal(quoteDate.getMonth(), 0);
    assert.equal(quoteDate.getDate(), 1);
  });

  test("안 적은 문구는 undefined — 양식의 기본 문구를 덮어쓰지 않는다", () => {
    const input = cableQuoteInputOf(cableQuote());
    assert.equal(input.validity, undefined);
    assert.equal(input.delivery, undefined);
    assert.equal(input.payment, undefined);
    assert.equal(input.remarks, undefined);
  });

  test("특이사항 · 유효기간은 적은 그대로 — 케이블에만 있는 칸이다", () => {
    const input = cableQuoteInputOf(
      cableQuote({ remarks: "납기는 발주 후 협의\n포장비 별도", validity: "발행일로 부터 2 주" })
    );
    assert.equal(input.remarks, "납기는 발주 후 협의\n포장비 별도");
    assert.equal(input.validity, "발행일로 부터 2 주");
  });

  test("🔴 아홉 줄을 넘겨도 여기서 자르지 않는다 — 막는 곳은 채우개 한 곳이다", () => {
    const many = Array.from({ length: CABLE_QUOTE_MAX_LINES + 2 }, () => itemLine());
    assert.equal(cableQuoteInputOf(cableQuote({ itemLines: many })).lines.length, CABLE_QUOTE_MAX_LINES + 2);
  });
});

describe("㉡ 갈림길 — 케이블은 케이블 채우개로 간다", () => {
  test("🔴 케이블 양식을 읽어 케이블 채우개에 넘긴다 — 내자 채우개가 아니다", () => {
    assert.ok(
      source.includes(
        'if (templateKey === "CABLE") { return fillCableQuoteWorkbook(await readQuoteTemplateFor("CABLE"), cableQuoteInputOf(quote)); }'
      ),
      "케이블 갈래가 없거나 달라졌다"
    );
  });

  test("🔴 되돌림이 앞선 셋보다 **앞**이다 — 그 뒤로는 내자 · OH 코드가 돈다", () => {
    const at = source.indexOf('if (templateKey === "CABLE")');
    assert.ok(at >= 0, "케이블 갈래가 없다");
    for (const marker of [
      'templateKey.startsWith("MATCHER:")',
      "fillMatcherQuoteWorkbook(",
      "fillOhQuoteWorkbook(",
      "fillQuoteWorkbook(",
    ]) {
      assert.ok(source.indexOf(marker) > at, `${marker} 가 케이블 되돌림보다 앞이다`);
    }
  });

  test("🔴 앞선 셋의 갈래는 그대로다 — 한 바이트도 달라지면 안 되는 자리다", () => {
    assert.ok(source.includes("return fillMatcherQuoteWorkbook(await readQuoteTemplateFor(templateKey), {"));
    assert.ok(source.includes("? fillOhQuoteWorkbook(await readOhQuoteTemplate(), {"));
    assert.ok(source.includes(": fillQuoteWorkbook(await readQuoteTemplate(), common);"));
  });

  test("🔴 케이블은 `items` 를 보지 않는다 — 그 목록에는 설명 줄도 규격도 없다", () => {
    const mapping = source.slice(source.indexOf("export function cableQuoteInputOf("));
    assert.ok(mapping.includes("lines: quote.itemLines.map(toCableQuoteLine),"), "품목 표를 itemLines 로 옮기지 않는다");
    assert.ok(!mapping.includes("quote.items"), "케이블 갈래가 items 를 읽는다 — 설명 줄이 사라진다");
  });
});
