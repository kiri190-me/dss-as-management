import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import QuotePrintView, { type QuotePrintData } from "./QuotePrintView";
import type { QuoteTemplateHeader } from "@/lib/storage/quote-template";

/**
 * ============================================================================
 * 케이블 견적서의 미리보기 — 다른 종이를 그리지 않는가 (2026-09-17 케이블 ④)
 * ============================================================================
 * 이 화면 하나가 종류 셋을 그린다. 케이블 장을 내자 · OH 모양으로 그리면 **그 양식에
 * 없는 작업 범위 · 작업비 구역**이 화면에만 뜨고, 받아 본 xlsx 에는 없다 — 둘이 다른
 * 문서로 읽힌다. 그래서 여기서 못 박는 것은 넷이다:
 *
 *  ㉠ 케이블이면 작업 범위 · 작업비를 **한 줄도** 그리지 않는다.
 *  ㉡ 품목 표에 규격 칸이 있고, **설명 줄이 차례 그대로** 낀다(번호 · 수량 · 단가 없이).
 *  ㉢ 합계에 설명 줄이 섞이지 않는다.
 *  ㉣ 내자 · OH 는 **한 줄도 달라지지 않는다** — 종류를 안 넘긴 장도 예전 그대로다.
 *
 * 그리기는 `renderToStaticMarkup` 으로 본다(형제 시험들과 같은 방식).
 * ============================================================================
 */

const repoUrl = new URL("../../../", import.meta.url);
const read = (relativePath: string) => readFileSync(new URL(relativePath, repoUrl), "utf8").replace(/\r\n/g, "\n");

/** 양식에서 읽어 오는 값 — 시험에서는 비워 둔다(🔴 계좌번호는 코드에 두지 않는다). */
const HEADER: QuoteTemplateHeader = {
  companyName: null,
  ceoLine: null,
  address: null,
  tel: null,
  fax: null,
  email: null,
  homepage: null,
  defaultValidity: null,
  defaultDelivery: null,
  defaultPayment: null,
  bankAccount: null,
};

type ItemLine = NonNullable<QuotePrintData["itemLines"]>[number];

function item(name: string, spec: string | null, quantity: number, unitPrice: string): ItemLine {
  return {
    partId: null,
    kind: "ITEM",
    partNameText: name,
    partSpecText: spec,
    isOverhaulPart: false,
    quantity,
    unitPrice,
  };
}

function note(text: string): ItemLine {
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

const ITEM_LINES: ItemLine[] = [
  note("* 20kW RFG 부속케이블 Parts 3종"),
  item("RF 케이블", "3m, N(M)-N(M)", 2, "150000"),
  item("DC 케이블", null, 1, "80000"),
  note("* 아래는 별도 주문품"),
  item("제어 케이블", "5m", 3, "20000"),
];

function cableQuote(over: Partial<QuotePrintData> = {}): QuotePrintData {
  return {
    kind: "CABLE",
    quoteNumber: "DSS 2026-101",
    quoteDate: "2026-09-17",
    customerNameText: "주성 엔지니어링",
    subject: "20kW RFG 부속케이블",
    validity: null,
    delivery: null,
    payment: null,
    modelNameText: null,
    serialNumberText: null,
    lotNumberText: null,
    // 케이블 장은 작업비를 비워 저장한다(케이블 ③의 collectFields).
    workCost: "0",
    items: [],
    remarks: null,
    itemLines: ITEM_LINES,
    ...over,
  };
}

function markup(quote: QuotePrintData, quoteId: string | null = "8f1c0a20-0000-4000-8000-000000000001"): string {
  return renderToStaticMarkup(<QuotePrintView quote={quote} header={HEADER} quoteId={quoteId} />);
}

/** 태그를 걷어 낸 글자만 — 무엇이 그려졌나를 본다. */
function text(html: string): string {
  return html.replace(/<style>[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
}

describe("㉠ 작업 범위 · 작업비를 그리지 않는다", () => {
  const body = text(markup(cableQuote()));

  test("🔴 네 묶음(조사 · 수리 · 통전 · 서류)이 한 줄도 없다 — 그 양식에 없는 구역이다", () => {
    for (const marker of [
      "인수 조사",
      "수리 작업",
      "통전검사",
      "서류작업",
      "①",
      "②",
      "③",
      "④",
    ]) {
      assert.ok(!body.includes(marker), `케이블 종이에 「${marker}」 가 그려졌다`);
    }
  });

  test("🔴 「작업비」 줄과 그 아래 안내 문구도 없다 — 케이블에는 작업비가 없다", () => {
    assert.ok(!body.includes("작업비"), "작업비 줄이 그려졌다");
    assert.ok(!body.includes("부품 비용"), "「1) 부품 비용」 줄이 그려졌다");
    assert.ok(!body.includes("유지관리비"), "작업비 설명 문구가 그려졌다");
  });

  test("모델 · S/N · L/N 줄도 없다 — 수리품과 이어지지 않는 견적서다", () => {
    const withProduct = text(
      markup(cableQuote({ modelNameText: "MBK200-JS3", serialNumberText: "1708075", lotNumberText: "WU8042" }))
    );
    assert.ok(!withProduct.includes("MODEL:"), "모델 줄이 그려졌다");
    assert.ok(!withProduct.includes("S/N:"), "S/N 줄이 그려졌다");
  });
});

describe("㉡ 품목 표 — 규격 · 설명 줄 · 차례", () => {
  const html = markup(cableQuote());
  const body = text(html);

  test("머리글이 여섯 칸이다 — 번호 · 품명 · 규격 · 수량 · 단가 · 합계", () => {
    for (const head of ["번 호", "품 명", "규 격", "수 량", "단 가", "합 계"]) {
      assert.ok(body.includes(head), `표 머리글에 「${head}」 가 없다`);
    }
  });

  test("🔴 설명 줄이 **적힌 차례 그대로** 품목 사이에 낀다", () => {
    const order = [
      "* 20kW RFG 부속케이블 Parts 3종",
      "RF 케이블",
      "DC 케이블",
      "* 아래는 별도 주문품",
      "제어 케이블",
    ];
    let at = -1;
    for (const piece of order) {
      const next = body.indexOf(piece, at + 1);
      assert.ok(next > at, `「${piece}」 가 차례를 벗어났다 — 차례가 곧 뜻이다`);
      at = next;
    }
  });

  test("🔴 번호는 품목 줄만 센다 — 설명 줄이 껴도 1) 2) 3) 으로 이어진다", () => {
    assert.ok(body.includes("1)") && body.includes("2)") && body.includes("3)"), body);
    assert.ok(!body.includes("4)"), "설명 줄에도 번호가 붙었다");
  });

  test("🔴 설명 줄에는 금액이 붙지 않는다 — ₩0 이 찍히면 0원짜리 품목으로 읽힌다", () => {
    const noteRow = html.slice(html.indexOf("* 아래는 별도 주문품"));
    const rowEnd = noteRow.indexOf("</tr>");
    assert.ok(rowEnd > 0, noteRow.slice(0, 200));
    assert.ok(!noteRow.slice(0, rowEnd).includes("₩"), "설명 줄에 금액이 그려졌다");
  });

  test("규격이 없는 품목은 양식과 같은 `-` 로 — 빈 칸은 「안 적었다」로 읽힌다", () => {
    assert.ok(body.includes("3m, N(M)-N(M)"), "적어 둔 규격이 안 보인다");
    const dcRow = html.slice(html.indexOf("DC 케이블"));
    assert.ok(dcRow.slice(0, dcRow.indexOf("</tr>")).includes(">-<"), "규격 없는 줄이 비어 있다");
  });

  test("특이사항이 머리말에 그려진다 — 양식에서도 품목 표 **위**(C21)다", () => {
    const withRemarks = markup(cableQuote({ remarks: "포장비 별도\n납기는 발주 후 협의" }));
    const plain = text(withRemarks);
    assert.ok(plain.includes("특이사항"), "특이사항 이름표가 없다");
    assert.ok(plain.includes("포장비 별도"), "적어 둔 특이사항이 안 보인다");
    assert.ok(
      plain.indexOf("특이사항") < plain.indexOf("번 호"),
      "특이사항이 품목 표 아래로 갔다 — 양식과 자리가 다르다"
    );
  });
});

describe("㉢ 합계 — 설명 줄은 들어가지 않는다", () => {
  test("🔴 품목 줄만 더한다", () => {
    const body = text(markup(cableQuote()));
    // 2×150,000 + 1×80,000 + 3×20,000 = 440,000
    assert.ok(body.includes("₩440,000"), "공급가가 다르다");
    assert.ok(body.includes("₩44,000"), "부가세가 다르다");
    assert.ok(body.includes("₩484,000"), "합계가 다르다");
  });

  test("품목이 하나도 없으면 「(품목 없음)」 — 표가 통째로 사라지지 않는다", () => {
    const body = text(markup(cableQuote({ itemLines: [] })));
    assert.ok(body.includes("(품목 없음)"), body);
    assert.ok(body.includes("₩0"), "합계 줄이 없다");
  });

  test("🔴 화면이 합계를 다시 짜지 않는다 — 서버가 쓰는 그 함수 하나를 부른다", () => {
    /**
     * 🔴 `quoteSupplyAmountOf` 다 — 내자 · OH 갈래와 **같은 함수**이고, 설명 줄을 빼는 일은
     * 그 안쪽 sumQuoteSupplyAmount 에서 일어난다(domain/quote-list.ts). 여기서 직접 더하면
     * 목록 · 편집 화면과 이 종이의 금액이 갈리는 날이 온다.
     */
    const source = read("src/components/quotes/QuotePrintView.tsx");
    const sheet = source.slice(source.indexOf("function CableQuoteSheet("));
    assert.ok(sheet.includes("quoteSupplyAmountOf({"), "케이블 합계를 도메인 함수로 셈하지 않는다");
    assert.ok(!sheet.includes("reduce("), "케이블 종이가 합계를 다시 짠다");
  });
});

describe("㉣ 도구모음 · 내자 · OH 는 그대로", () => {
  test("받기 · 인쇄 단추가 케이블에도 있다 — 열린 통로다", () => {
    const html = markup(cableQuote());
    assert.ok(html.includes("/api/quotes/8f1c0a20-0000-4000-8000-000000000001/xlsx"), "받기 링크가 없다");
    assert.ok(text(html).includes("인쇄 · PDF로 저장"), "인쇄 단추가 없다");
  });

  test("저장 전(새 견적서)에는 받기 대신 까닭을 적는다 — 위 갈래와 같은 규칙", () => {
    const body = text(markup(cableQuote(), null));
    assert.ok(body.includes("Excel 은 저장한 뒤에 받을 수 있습니다"), body);
  });

  test("🔴 종류를 안 넘긴 장은 예전 그대로다 — 내자 · OH 미리보기가 달라지면 안 된다", () => {
    const domestic: QuotePrintData = {
      quoteNumber: "DSS 2026-077",
      quoteDate: "2026-09-01",
      customerNameText: "ICD",
      subject: "CFK300FH-IC2 수리",
      validity: null,
      delivery: null,
      payment: null,
      modelNameText: "CFK300FH-IC2",
      serialNumberText: "1612027",
      lotNumberText: "WU8042",
      workCost: "300000",
      items: [{ partId: null, partNameText: "커넥터 SMA", isOverhaulPart: false, quantity: 2, unitPrice: "12000" }],
    };
    const body = text(markup(domestic));
    // 작업 범위 네 묶음과 작업비 줄이 그대로 있다.
    assert.ok(body.includes("인수 조사"), "작업 내역이 사라졌다");
    assert.ok(body.includes("서류작업"), "서류작업이 사라졌다");
    assert.ok(body.includes("작업비"), "작업비 줄이 사라졌다");
    assert.ok(body.includes("부품 비용"), "부품 비용 줄이 사라졌다");
    // 공급가 = 2×12,000 + 300,000
    assert.ok(body.includes("₩324,000"), "공급가가 달라졌다");
    // 케이블 종류를 넘겨야만 갈린다 — 종류가 없으면 예전 갈래다.
    assert.ok(!body.includes("규 격"), "내자 종이에 규격 칸이 생겼다");
  });
});
