import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import QuotePrintView, { type QuotePrintData } from "./QuotePrintView";

/**
 * ============================================================================
 * 미리보기의 금액 묶음 — `1) 부품 비용` · `2) OH 부품 비용` · `3) 작업비 …`
 * ============================================================================
 * 2026-10-31 사용자 지적: **O/H 견적서의 OH 부품이 미리보기에서만 한 칸에 뭉쳐 있었다.**
 * 파일(xlsx)은 처음부터 두 칸으로 가르고 작업비를 `3)` 으로 적어 나갔는데
 * (server/services/quote-workbook.ts 의 `overhaulParts`, xlsx/oh-quote-template.ts 의
 * `2) OH 부품 비용` 칸), 이 화면은 `quote.items` 를 통째로 한 칸에 그리고 작업비에
 * `2)` 를 **글자로 박아** 두고 있었다. 같은 견적서인데 화면과 받아 본 문서의 칸과
 * 번호가 달랐다.
 *
 * 그 자리를 못 박는 시험이 하나도 없었다(2026-10-31 확인). 그래서 여기서 세운다.
 *
 * ── 🔴 무엇을 재는가 ────────────────────────────────────────────────────────
 *   · OH 표시가 붙은 줄이 **「2) OH 부품 비용」 밑에** 그려지는가 · 일반 부품은 「1)」
 *     밑에 남는가(섞이지 않는가).
 *   · 작업비가 **「3)」** 인가.
 *   · 🔴 **내자는 「1) 부품 비용 / 2) 작업비」 그대로인가** — 줄에 OH 표시가 남아 있어도
 *     갈리지 않는가. 파일 쪽이 **견적서 종류**로만 가르기 때문이다.
 *   · OH 부품이 한 줄도 없을 때 **머리글은 남는가**(파일이 그 모양이다 — 아래 그 시험).
 *   · 번호가 **자리에서 뽑히는가** — 글자로 박혀 있지 않은가.
 *   · 갈라 그려도 **공급가 · 부가세 · 합계가 한 글자도 안 달라지는가.**
 *
 * 🔴 표본에 **OH 부품과 일반 부품을 둘 다** 넣는다. 한쪽만 넣으면 「가른다」와
 * 「안 가른다」가 같은 답을 내서, 갈래를 통째로 지워도 시험이 통과한다.
 * ============================================================================
 */

type Props = Parameters<typeof QuotePrintView>[0];

/** 양식에서 읽어 오는 값들 — 여기서 보는 것이 아니라 전부 비운다(계좌번호는 코드에 두지 않는다). */
const HEADER: Props["header"] = {
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

/** 🔴 실제 고객사 · S/N · L/N 을 적지 않는다(공개 저장소). 전부 지어낸 값이다. */
const PLAIN_PART = {
  partId: null,
  partNameText: "일반 부품 가",
  isOverhaulPart: false,
  quantity: 2,
  unitPrice: "12000",
};
const OH_PART = {
  partId: null,
  partNameText: "오버홀 부품 나",
  isOverhaulPart: true,
  quantity: 1,
  unitPrice: "5000",
};

const QUOTE: QuotePrintData = {
  /**
   * 🔴 **장비 종류가 금액 칸을 가른다** — 여기 기본값은 「안 고름」이고 그것은 제너레이터
   * 양식이다(domain/quote-template-variant.ts). 매쳐를 보는 시험은 아래에서 이 값을 덮는다.
   */
  laborEquipmentKind: null,
  quoteNumber: "Q-2026-0001",
  quoteDate: "2026-09-01",
  customerNameText: "가나다 주식회사",
  subject: "시험용 수리",
  validity: null,
  delivery: null,
  payment: null,
  modelNameText: "MODEL-TEST",
  serialNumberText: "SN-TEST",
  lotNumberText: null,
  workCost: "300000",
  items: [PLAIN_PART, OH_PART],
};

function render(quote: QuotePrintData): string {
  return renderToStaticMarkup(
    <QuotePrintView quote={quote} header={HEADER} quoteId="q-1" onClose={() => {}} />
  );
}

/**
 * 그려진 **금액 묶음 머리글**들을 차례대로.
 *
 * 🔴 **번호 모양으로는 작업 내역과 못 가른다**(2026-10-31). 예전에는 작업 내역이 동그라미
 * (①②③④)라 글자만으로 걸러졌는데, 매쳐 양식은 작업 내역도 `1) 2) 3)` 이라 같은 모양이
 * 된다 — 그대로 두면 작업 내역 셋이 금액 묶음으로 세어진다(실제로 그렇게 틀렸다).
 *
 * 그래서 **자리로 가른다**: 금액 묶음의 끝은 작업비 아래 `*` 안내 줄(`qp-c-fine`)이고,
 * 작업 내역은 전부 그 아래다. 요소 나무의 차례가 곧 종이의 차례다.
 */
function costGroupHeads(html: string): { mark: string; label: string; at: number }[] {
  // 🔴 class 이름만 찾으면 **맨 위 `<style>` 의 CSS 규칙**이 먼저 걸려 구역이 통째로 비고,
  // 그러면 「묶음이 하나도 없다」가 「다르다」로 보여 엉뚱한 자리를 의심하게 된다(겪었다).
  // 칸의 속성까지 붙여 그 줄만 집는다.
  const end = html.indexOf('qp-c-fine" colSpan');
  assert.notEqual(end, -1, "작업비 아래 `*` 안내 줄이 없다 — 금액 묶음의 끝을 못 찾는다");

  const costArea = html.slice(0, end);
  const found: { mark: string; label: string; at: number }[] = [];
  // 🔴 번호 모양이 양식마다 다르다 — 제너레이터는 `1)`, 매쳐는 `1.` 이다(실측).
  const pattern = /qp-c-group" colSpan="\d">(\d[).])　([^<]*)</g;
  for (let hit = pattern.exec(costArea); hit !== null; hit = pattern.exec(costArea)) {
    found.push({ mark: hit[1], label: hit[2], at: hit.index });
  }
  return found;
}

/** 그 품명 줄이 **어느 금액 묶음 밑에** 그려졌나. 바로 위 머리글의 이름을 돌려준다. */
function groupOf(html: string, partName: string): string {
  const at = html.indexOf(`>${partName}<`);
  assert.notEqual(at, -1, `품명 "${partName}" 이 종이에 없다 — 표본이 안 그려졌다`);
  assert.equal(
    html.indexOf(`>${partName}<`, at + 1),
    -1,
    `품명 "${partName}" 이 두 번 그려졌다 — 양쪽 칸에 다 들어갔다는 뜻이다`
  );
  const above = costGroupHeads(html).filter((head) => head.at < at);
  assert.ok(above.length > 0, "품목 줄 위에 금액 묶음 머리글이 하나도 없다");
  return above[above.length - 1].label;
}

/** 아래 합계 셋(공급가 · 부가세 · 합계). */
function totals(html: string): string[] {
  return [...html.matchAll(/qp-total-value">([^<]*)</g)].map((hit) => hit[1]);
}

/** 저장소 뿌리에서 본 그 파일. 못 읽으면 던진다 — 빈 글자를 훑어 공짜로 통과하지 않도록. */
function readSource(relative: string): string {
  const source = fs.readFileSync(path.join(process.cwd(), relative), "utf8");
  assert.ok(source.length > 0, `${relative} 가 비어 있다`);
  return source;
}

/**
 * 🔴 **주석을 걷어낸다.** 이 저장소는 주석이 길고, 소스 글자로 재는 검사가 주석에 적힌
 * 낱말 때문에 거짓으로 통과하거나 실패한 적이 여러 번 있다. 「있어야 한다」 쪽은 주석만으로
 * 영영 통과하므로 특히 위험하다.
 */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

// ───────────────────────────── 🔴 OH 견적서 — 부품 칸이 둘이다

test("🔴 OH 견적서: OH 표시가 붙은 줄은 「2) OH 부품 비용」 밑에, 일반 부품은 「1) 부품 비용」 밑에", () => {
  const html = render({ ...QUOTE, kind: "OVERHAUL" });

  // 🔵 먼저 「무엇을 재는지」 — 표본의 두 줄이 다 그려졌고 칸이 둘이다.
  const heads = costGroupHeads(html);
  assert.deepEqual(
    heads.map((head) => `${head.mark} ${head.label}`),
    ["1) 부품 비용", "2) OH 부품 비용", "3) 작업비 (조사,수리,개조,통전,출하검사)"],
    "O/H 견적서의 금액 묶음은 셋이다(xlsx/oh-quote-template.ts 의 양식 그대로)"
  );

  assert.equal(groupOf(html, PLAIN_PART.partNameText), "부품 비용");
  assert.equal(groupOf(html, OH_PART.partNameText), "OH 부품 비용");
});

test("🔴 OH 견적서: 작업비가 3) 이다 — 파일이 그 번호로 나간다", () => {
  const html = render({ ...QUOTE, kind: "OVERHAUL" });
  assert.ok(
    html.includes("3)　작업비 (조사,수리,개조,통전,출하검사)"),
    "작업비의 번호가 안 밀렸다"
  );
  assert.ok(
    !html.includes("2)　작업비"),
    "옛 번호가 남았다 — 미리보기와 받아 본 문서의 번호가 어긋난다"
  );
});

test("OH 부품 줄도 수량 · 단가 · 합계를 그대로 그린다", () => {
  const html = render({ ...QUOTE, kind: "OVERHAUL" });
  const at = html.indexOf(`>${OH_PART.partNameText}<`);
  const row = html.slice(at, html.indexOf("</tr>", at));
  assert.ok(row.includes('qp-c-qty">1<'), row);
  assert.ok(row.includes("₩5,000"), row);
  // 수량 1 × 5,000 — 단가와 합계가 둘 다 그려진다.
  assert.equal(row.split("₩5,000").length - 1, 2, row);
});

// ───────────────────────────── 🔴 내자 견적서는 한 글자도 안 바뀐다

test("🔴 내자 견적서: 「1) 부품 비용 / 2) 작업비」 둘뿐이다 — OH 칸도 3) 도 없다", () => {
  const html = render({ ...QUOTE, kind: "DOMESTIC" });

  assert.deepEqual(
    costGroupHeads(html).map((head) => `${head.mark} ${head.label}`),
    ["1) 부품 비용", "2) 작업비 (조사,수리,개조,통전,출하검사)"],
    "내자 양식에는 OH 부품 칸이 없다"
  );
  assert.ok(!html.includes("OH 부품 비용"), "내자 종이에 없는 칸이 화면에 생겼다");
  assert.ok(!html.includes("3)　"), "내자 금액 묶음에 3) 은 없다");
});

/**
 * 🔴 **가르는 기준은 줄에 붙은 표시가 아니라 견적서 종류**다 — 파일을 만드는 쪽이
 * `kind === "OVERHAUL"` 일 때만 가른다(server/services/quote-workbook.ts). 종류를 OH 로
 * 적다가 내자로 바꾼 장에는 표시가 붙은 줄이 그대로 남아 있을 수 있는데, 그 문서에는
 * 「2) OH 부품 비용」 칸 자체가 없다.
 */
test("🔴 내자 견적서: OH 표시가 붙은 줄이 섞여 있어도 갈리지 않는다 — 한 칸에 둘 다 그린다", () => {
  const html = render({ ...QUOTE, kind: "DOMESTIC" });
  assert.equal(groupOf(html, PLAIN_PART.partNameText), "부품 비용");
  assert.equal(groupOf(html, OH_PART.partNameText), "부품 비용");
});

test("🔴 종류를 안 넘긴 미리보기(옛 길)도 내자 모양 그대로다", () => {
  assert.equal(render(QUOTE), render({ ...QUOTE, kind: "DOMESTIC" }));
});

// ───────────────────────────── 🔴 매쳐 양식에는 OH 부품 칸이 없다 (2026-10-31)

/**
 * ============================================================================
 * 매쳐 견적서 — 🔴 금액 묶음이 **글자부터 번호까지** 다르다
 * ============================================================================
 * 사용자 요구(2026-10-31): 「매쳐도 사용하고 있으니까 미리보기를 매쳐엑셀에 맞게
 * 맞춰줘」 · 「다 고쳐」. 양식 넷을 열어 A~D열을 실측한 결과 금액 묶음이 이렇게 갈린다:
 *
 *                   제너레이터                              매쳐
 *   번호            `1)` `2)` `3)`                         `1.` `2.`
 *   부품 칸         `부품 비용` (+O/H 는 `OH 부품 비용`)     `부품 비용` 하나
 *   작업비 머리글   `작업비 (조사,수리,개조,통전,출하검사)`   `작업 비용`
 *   `*` 안내        인건비·유지관리비·소모품… 긴 문장         「인건비 및 부대비용」 한 문장
 *
 * 🔴 **가르는 자가 견적서 종류 하나면 틀린다** — 매쳐 O/H 장은 `kind` 가 `OVERHAUL` 이라
 * 앞선 시험들을 그대로 통과하면서 화면에만 있는 칸을 그린다. 그래서 **장비 종류까지**
 * 넘겨 양식으로 가른다.
 *
 * 🔵 표본은 위 QUOTE 그대로다 — OH 표시가 붙은 줄이 들어 있어야 「합쳐 그리는가」가
 * 보인다. 그 줄까지 사라지면 종이에서 부품 하나가 통째로 빠진다.
 * ============================================================================
 */

/** 매쳐 양식으로 그린 종이. 기본은 O/H 장이다(사용자가 짚은 그 장). */
function matcher(over: Partial<QuotePrintData> = {}): string {
  return render({ ...QUOTE, kind: "OVERHAUL", laborEquipmentKind: "MATCHER", ...over });
}

test("🔴 매쳐 O/H: 금액 묶음이 「1. 부품 비용 / 2. 작업 비용」 둘뿐이다 — 양식 글자 그대로", () => {
  const html = matcher();

  assert.deepEqual(
    costGroupHeads(html).map((head) => `${head.mark} ${head.label}`),
    ["1. 부품 비용", "2. 작업 비용"],
    "매쳐 양식에는 OH 부품 칸이 없고 번호가 `1.` `2.` 다(양식 실측)"
  );
  assert.ok(!html.includes("OH 부품 비용"), "매쳐 종이에 없는 칸이 화면에 생겼다");
  assert.ok(
    !html.includes("작업비 (조사,수리,개조,통전,출하검사)"),
    "제너레이터 머리글이 매쳐 종이에 남았다"
  );
});

test("🔴 매쳐 O/H: 작업비 아래 `*` 안내도 양식 문장이다 — 제너레이터의 긴 문장이 아니다", () => {
  const html = matcher();
  assert.ok(
    html.includes("수리에 필요한 인건비 및 부대비용이 포함되어 책정된 가격입니다."),
    "매쳐 양식의 안내 문장이 안 그려졌다"
  );
  assert.ok(!html.includes("유지관리비"), "제너레이터의 긴 안내문이 매쳐 종이에 남았다");
});

test("🔴 매쳐 O/H: OH 표시가 붙은 줄도 「1. 부품 비용」 밑에 그대로 그려진다 — 사라지지 않는다", () => {
  const html = matcher();
  assert.equal(groupOf(html, PLAIN_PART.partNameText), "부품 비용");
  assert.equal(groupOf(html, OH_PART.partNameText), "부품 비용");
});

test("🔴 매쳐 O/H 와 제너레이터 O/H 는 같은 값이라도 다른 종이다 — 갈래가 실제로 돈다", () => {
  const byMatcher = matcher();
  const byGenerator = render({ ...QUOTE, kind: "OVERHAUL", laborEquipmentKind: "GENERATOR" });
  assert.notEqual(byMatcher, byGenerator, "장비 종류가 아무 일도 하지 않는다");
  assert.equal(costGroupHeads(byMatcher).length, 2);
  assert.equal(costGroupHeads(byGenerator).length, 3);
});

/**
 * 🔴 **매쳐 내자와 O/H 는 같은 판이다**(xlsx/matcher-quote-template.ts 머리말 — 줄 수만
 * 다르다). 그래서 종이 모양이 한 글자도 갈리지 않아야 한다. O/H 쪽만 고치면 매쳐 내자
 * 미리보기에 제너레이터 모양이 그대로 남는다.
 */
test("🔴 매쳐 내자와 매쳐 O/H 는 같은 종이다 — 두 양식이 같은 판이다", () => {
  assert.equal(matcher({ kind: "DOMESTIC" }), matcher({ kind: "OVERHAUL" }));
});

// ───────────────────────────── 🔴 품목 표 머리 — 품명 줄과 제품 줄

/**
 * 🔴 양식 실측: 제너레이터는 품명 줄 앞 B열에 `1.` 이 있고 그 아래 `MODEL: …, S/N:…` 줄이
 * 있다(내자 23 · 24행). **매쳐 양식에는 둘 다 없다** — 그 정보는 품명 칸에 이미 들어 있고,
 * 파일을 만드는 쪽도 매쳐에는 모델 · S/N · L/N 을 넘기지 않는다
 * (xlsx/matcher-quote-template.ts 의 `MatcherQuoteInput` 머리말).
 */
test("🔴 매쳐: 품명 줄 앞의 번호와 `MODEL:` 줄이 없다 — 품명 자체는 그대로다", () => {
  const html = matcher();

  // 🔵 무엇을 재는지 — 품명 줄 자체는 그려져 있다.
  assert.ok(html.includes(`qp-c-title" colSpan="7">${QUOTE.subject}<`), "품명 줄이 사라졌다");

  assert.ok(html.includes('qp-c-no" colSpan="2"></td>'), "품명 줄 앞 번호 칸이 안 비었다");
  assert.ok(!html.includes("MODEL:"), "매쳐 종이에 없는 제품 줄이 그려졌다");
  assert.ok(!html.includes(QUOTE.serialNumberText as string), "S/N 이 종이에 남았다");
});

test("🔴 제너레이터는 `1.` 과 `MODEL:` 줄 그대로다 — 매쳐일 때만 빠진다", () => {
  for (const laborEquipmentKind of ["GENERATOR", "TOTAL_CONTROLLER", null] as const) {
    const html = render({ ...QUOTE, kind: "OVERHAUL", laborEquipmentKind });
    assert.ok(html.includes('qp-c-no" colSpan="2">1.<'), `${laborEquipmentKind}: 품명 번호가 사라졌다`);
    assert.ok(html.includes("MODEL: "), `${laborEquipmentKind}: 제품 줄이 사라졌다`);
  }
});

/**
 * 🔴 **매쳐가 아닌 것은 전부 제너레이터 양식이다** — T/C 전용 양식을 아직 받지 못했고,
 * 장비 종류를 아직 안 고른 옛 견적서도 제너레이터로 읽는다(domain/quote-template-variant.ts).
 * 「매쳐면 안 그린다」가 아니라 **양식을 고르는 함수**로 가르는지 보는 자리다.
 */
test("🔴 T/C · 안 고름의 O/H 는 제너레이터 양식이라 OH 칸이 그대로 있다", () => {
  for (const laborEquipmentKind of ["TOTAL_CONTROLLER", "GENERATOR", null] as const) {
    const heads = costGroupHeads(render({ ...QUOTE, kind: "OVERHAUL", laborEquipmentKind }));
    assert.deepEqual(
      heads.map((head) => `${head.mark} ${head.label}`),
      ["1) 부품 비용", "2) OH 부품 비용", "3) 작업비 (조사,수리,개조,통전,출하검사)"],
      `${laborEquipmentKind}: 제너레이터 양식의 칸이 사라졌다`
    );
  }
});

test("🔴 매쳐로 합쳐 그려도 공급가 · 부가세 · 합계가 한 글자도 다르지 않다", () => {
  const byMatcher = totals(matcher());
  assert.deepEqual(byMatcher, ["₩329,000", "₩32,900", "₩361,900"], "표본의 셈이 달라졌다");
  assert.deepEqual(
    byMatcher,
    totals(render({ ...QUOTE, kind: "OVERHAUL", laborEquipmentKind: "GENERATOR" })),
    "양식이 달라졌다고 금액이 달라졌다"
  );
});

/**
 * ── 🔴 양식을 나르는 길이 끊기지 않았는가 ───────────────────────────────────
 * 값이 미리보기까지 **닿지 않으면** 위 시험들은 전부 통과하면서 화면만 틀린다 — 타입이
 * 막아 주긴 하지만, 넘기는 자리가 「안 고름」을 적어 버리면 컴파일도 통과한다. 그래서
 * 부르는 자리 둘을 글자로 본다.
 *
 * 🔴 **주석을 먼저 걷어낸다** — 이 저장소는 주석이 길어서, 주석에 적힌 낱말로 소스 검사가
 * 거짓 통과한 적이 있다. 걷어낸 뒤에도 그 호출이 남아 있는지 먼저 단언한다.
 */
test("🔴 편집 폼의 겹친 미리보기가 장비 종류를 싣는다", () => {
  const form = withoutComments(readSource("src/components/quotes/QuoteEditForm.tsx"));
  const at = form.indexOf("<QuotePrintView");
  assert.notEqual(at, -1, "주석을 걷어내니 미리보기를 부르는 자리가 없다");
  const call = form.slice(at, form.indexOf("quoteNumber,", at));
  /**
   * 🔴 **이름만 있는지가 아니라 「그 값」인지 본다.** `laborEquipmentKind: null` 로 적어도
   * 타입은 통과하고 화면은 조용히 제너레이터 모양이 된다 — 바로 옆 머리말 · 작업 내역이
   * `quoteTemplateKey(laborKind, kind)` 로 고르는 그 값과 같아야 한 종이가 된다.
   */
  assert.ok(
    call.includes("laborEquipmentKind: laborKind"),
    "장비 종류를 안 넘기거나 다른 값을 넘긴다 — 매쳐가 제너레이터 모양으로 그려진다"
  );
  assert.ok(
    form.includes("quoteTemplateKey(laborKind, kind)"),
    "머리말 · 작업 내역을 고르는 값이 바뀌었다 — 미리보기가 두 양식을 섞어 그린다"
  );
});

test("🔴 인쇄 페이지는 읽어 온 견적서를 통째로 넘긴다 — 장비 종류가 그 안에 실려 온다", () => {
  const page = withoutComments(readSource("src/app/(app)/quotes/[id]/print/page.tsx"));
  assert.ok(page.includes("<QuotePrintView"), "주석을 걷어내니 미리보기를 부르는 자리가 없다");
  assert.ok(
    page.includes("quote={{ ...quote,"),
    "값을 손으로 골라 적기 시작했다 — 그날 장비 종류가 빠진다"
  );
});

// ───────────────────────────── 🔴 OH 부품이 한 줄도 없을 때

/**
 * 🔴 **엑셀을 재서 맞췄다.** 파일 쪽은 줄 수를 맞출 때 머리글 **바로 아래부터** 지운다
 * (xlsx/oh-quote-template.ts 의 `resizeRowBlock({ firstRow: overhaul.firstRow, targetCount:
 * input.overhaulParts.length })` — `firstRow` 는 `headerRow + 1`, quote-sheet-layout.ts 의
 * findItemBlock). 그래서 OH 부품이 0개여도 **머리글 `2) OH 부품 비용` 은 그대로 나간다.**
 * 부품 없이 작업비만 받는 O/H 견적이 실제로 있다(OhQuoteInput 의 overhaulParts 주석).
 *
 * 화면에서 그 칸을 숨기면 그 장에서만 작업비가 2) 가 되어 문서(3))와 어긋난다.
 */
test("🔴 OH 부품이 0건이어도 「2) OH 부품 비용」 칸은 남는다 — 엑셀이 머리글을 안 지운다", () => {
  const html = render({ ...QUOTE, kind: "OVERHAUL", items: [PLAIN_PART] });

  assert.deepEqual(
    costGroupHeads(html).map((head) => `${head.mark} ${head.label}`),
    ["1) 부품 비용", "2) OH 부품 비용", "3) 작업비 (조사,수리,개조,통전,출하검사)"],
    "칸이 사라지면 그 장만 작업비 번호가 어긋난다"
  );
  // 🔵 「(부품 없음)」은 `1) 부품 비용` 칸에만 있던 화면 쪽 표시다 — 파일에는 안 적힌다.
  assert.ok(!html.includes("(부품 없음)"), "파일에 없는 글자가 OH 칸 밑에 생겼다");
});

test("일반 부품이 0건이면 「1) 부품 비용」 밑의 (부품 없음)은 그대로다", () => {
  const html = render({ ...QUOTE, kind: "OVERHAUL", items: [OH_PART] });
  assert.ok(html.includes("(부품 없음)"), "옛 표시가 사라졌다");
  assert.equal(groupOf(html, OH_PART.partNameText), "OH 부품 비용");
});

// ───────────────────────────── 🔴 번호는 자리에서 뽑는다

test("🔴 금액 묶음 번호는 언제나 자리 순서다 — 1 부터 하나씩, 모양은 양식이 정한다", () => {
  for (const laborEquipmentKind of [null, "MATCHER"] as const) {
    // 매쳐는 `1.` `2.`, 제너레이터는 `1)` `2)` `3)` — 모양만 다르고 **차례는 같다**.
    const tail = laborEquipmentKind === "MATCHER" ? "." : ")";
    for (const kind of ["DOMESTIC", "OVERHAUL"] as const) {
      const heads = costGroupHeads(render({ ...QUOTE, kind, laborEquipmentKind }));
      assert.ok(heads.length >= 2, `${laborEquipmentKind}/${kind}: 금액 묶음이 안 그려졌다`);
      assert.deepEqual(
        heads.map((head) => head.mark),
        heads.map((_head, index) => `${index + 1}${tail}`),
        `${laborEquipmentKind}/${kind}: 번호가 자리와 어긋났다`
      );
    }
  }
});

/**
 * 🔴 **번호를 글자로 박지 않았는가** — 같은 라벨이 종류에 따라 다른 번호를 받아야 하므로
 * (작업비는 내자에서 2), OH 에서 3)) 번호와 이름을 한 리터럴로 적어 두면 두 벌이 된다.
 *
 * 🔴 **주석을 먼저 걷어낸다.** 이 저장소는 주석이 길고, 주석에 적힌 글자 때문에 소스 글자
 * 검사가 거짓으로 실패하거나(또는 거짓으로 통과하거나) 한 적이 여러 번 있다. 걷어낸 뒤에도
 * 그리는 코드가 남아 있는지 먼저 단언한다 — 전부 지워 놓고 「없다」로 통과하지 않도록.
 */
test("🔴 번호 + 묶음 이름이 한 글자 덩어리로 박혀 있지 않다(주석을 걷어내고 본다)", () => {
  const code = withoutComments(readSource("src/components/quotes/QuotePrintView.tsx"));

  // 🔵 무엇을 재는지 — 걷어낸 뒤에도 금액 묶음을 그리는 코드가 여기 있다.
  assert.ok(code.includes("costGroupMarks"), "주석을 걷어내니 잴 코드가 없다");
  assert.ok(code.includes("{group.mark}　{group.label}"), "번호와 이름을 자리에서 붙이는 곳이 없다");
  assert.ok(code.includes("{section.mark}　{section.label}"), "작업 내역도 자리에서 붙여야 한다");

  // 종이에 찍히는 모양은 `1)　부품 비용` · `1.　부품 비용` · `①　인수 조사`(사이가 전각
  // 공백)다. 그 덩어리가 코드에 있으면 번호를 손으로 적었다는 뜻이다 — 🔴 양식마다 번호
  // 모양이 달라진 뒤로 더 위험하다(한 양식에만 맞는 글자가 네 양식에 다 나간다).
  const baked = code.match(/(\d[.)]|[①②③④])　\S+/g);
  assert.equal(baked, null, `번호가 글자로 박혀 있다: ${baked?.join(" · ")}`);
});

// ───────────────────────────── 🔴 갈라 그려도 금액은 그대로

/**
 * 🔴 공급가는 **서버가 금액을 셈하는 그 함수 하나**로 낸다(domain/quote-list.ts 의
 * quoteSupplyAmountOf). 부품을 두 칸으로 갈라 **그리는** 일이 그 셈에 닿으면 안 된다 —
 * 닿으면 목록 · 편집 화면과 이 종이의 금액이 갈린다.
 */
test("🔴 OH 로 갈라 그려도 공급가 · 부가세 · 합계가 내자와 한 글자도 다르지 않다", () => {
  const domestic = totals(render({ ...QUOTE, kind: "DOMESTIC" }));
  const overhaul = totals(render({ ...QUOTE, kind: "OVERHAUL" }));

  // 2 × 12,000 + 1 × 5,000 + 작업비 300,000 = 329,000.
  assert.deepEqual(domestic, ["₩329,000", "₩32,900", "₩361,900"], "표본의 셈이 달라졌다");
  assert.deepEqual(overhaul, domestic, "가르면서 합계가 달라졌다");
});

test("🔴 표 위 요약 금액(5. 금 액)도 갈래에 따라 달라지지 않는다", () => {
  for (const kind of ["DOMESTIC", "OVERHAUL"] as const) {
    assert.ok(
      render({ ...QUOTE, kind }).includes("₩329,000　(V.A.T. 별도)"),
      `${kind}: 요약 금액이 달라졌다`
    );
  }
});
