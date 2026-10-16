import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";

import { PartSuggestionList } from "@dss/core/ui/inventory/part-picker";
import {
  PART_FIELD_LABELS,
  PART_FIELD_ORDER,
  type PartPickerPriceRow,
  type PartPickerRow,
} from "@dss/core/ui/inventory/part-picker-rows";
import {
  QUOTE_PICKED_PART_PREFIX,
  isSamePickedPart,
  quotePartPickPatch,
  quotePickedPartDetail,
  quotePickedPartOf,
  type QuotePartPickRow,
} from "@/components/quotes/quote-part-pick";
import { validateQuoteFields } from "@/lib/validation/quote-input";

/**
 * ============================================================================
 * 견적서가 **고른 부품을 기억한다** (2026-10-16 사용자 요청 ①·②·③)
 * ============================================================================
 * 요청 셋이 이 파일에 함께 있는 까닭은 **같은 값 하나**(줄이 기억하는 부품)에 달려 있기
 * 때문이다. 규칙은 `quote-part-pick.ts` 에 있고 여기서는 **그 규칙이 지켜지는가**와
 * **화면이 그것을 실제로 쓰는가**를 함께 잰다(폼은 서버 액션을 부르는 클라이언트
 * 컴포넌트라 이 환경에서 그려 볼 수 없다 — 이웃 `part-picker.test.tsx` 와 같은 사정).
 *
 *  ① 🔴 **상세는 작성자만 본다** — 견적서 밖으로 나가는 길 셋 어디에도 없다.
 *  ② 🔴 **부품이 바뀐 때만** 단가가 따라간다 — 손으로 고친 금액은 다른 일로 안 덮인다.
 *  ③ 🔴 **차례가 다섯 자리에서 같다** — 고객사 품명 · 품명 · 품명2 · 교산 품번 · 도번.
 *
 * 🔴 **값은 전부 지어낸 것이다** — 실제 고객사 · 모델 · L/N · S/N 은 공개 저장소에 적지 않는다.
 * ============================================================================
 */

const repoUrl = new URL("../../../", import.meta.url);
const read = (relativePath: string) =>
  readFileSync(new URL(relativePath, repoUrl), "utf8").replace(/\r\n/g, "\n");
const flat = (source: string) => source.replace(/\s+/g, " ");
const indexOrFail = (source: string, marker: string) => {
  const at = source.indexOf(marker);
  assert.ok(at >= 0, `원본에서 '${marker}' 를 찾지 못했다`);
  return at;
};
const sliceBetween = (source: string, startMarker: string, endMarker: string) => {
  const start = indexOrFail(source, startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(end > start, `원본에서 '${endMarker}' 를 찾지 못했다`);
  return source.slice(start, end);
};

const form = flat(read("src/components/quotes/QuoteEditForm.tsx"));
const partRequest = flat(read("src/components/inventory/PartRequestSection.tsx"));

/** 다 들어 있는 줄 하나 — 다섯 칸이 **서로 다른 글자**라 차례를 자리로 잴 수 있다. */
const FULL: PartPickerRow = {
  id: "11",
  partName: "마그네트론",
  partSpec: "2M244-M1",
  customerPartName: "발진관 조립품",
  drawingNo: "DWG-1001",
  kyosanPartNo: "KY-7788",
};
/** 고객사 품명이 **있고** 견적가도 둘 다 있는 다른 부품 — 「바꿔 골랐다」를 재는 짝이다. */
const OTHER: PartPickerRow = {
  id: "12",
  partName: "서큘레이터",
  partSpec: null,
  customerPartName: "순환기 조립품",
  drawingNo: null,
  kyosanPartNo: "KY-9900",
};
/** 🔵 **견적가를 하나도 정하지 않은** 부품 — 단가 목록에 아예 오르지 않는다. */
const NO_PRICE: PartPickerRow = {
  id: "13",
  partName: "케이블 어셈블리",
  partSpec: "RG-393 3m",
  customerPartName: "연결 케이블",
  drawingNo: "DWG-2002",
  kyosanPartNo: null,
};

const prices: PartPickerPriceRow[] = [
  { partId: "11", unitPrice: "125000", overhaulUnitPrice: "98000" },
  // 🔵 `"0"` 은 **무상**이라는 실제 값이다(null 과 다르다). O/H 는 정하지 않았다.
  { partId: "12", unitPrice: "0", overhaulUnitPrice: null },
];

/** 고른 적 없는 빈 줄. */
const blank = (over: Partial<QuotePartPickRow> = {}): QuotePartPickRow => ({
  partNameText: "",
  unitPrice: "",
  pickedPart: null,
  ...over,
});

/** `option` 을 한 번 고른 뒤의 줄 — 폼이 하는 그대로 `{ ...row, ...patch }` 로 붓는다. */
function afterPick(
  row: QuotePartPickRow,
  option: PartPickerRow,
  context: Parameters<typeof quotePartPickPatch>[2] = { prices }
): QuotePartPickRow {
  const patch = quotePartPickPatch(row, option, context);
  return {
    partNameText: patch.partNameText,
    unitPrice: patch.unitPrice ?? row.unitPrice,
    pickedPart: patch.pickedPart,
  };
}

/**
 * ============================================================================
 * ① 🔴 상세는 **작성자만** 본다 — 밖으로 나가는 길에 없다
 * ============================================================================
 * 사용자 요청: 「견적서에 나가지는 않더라도 **작성자에게는** 어떤 부품을 고른 건지 작은
 * 글씨로 상세하게.」 🔴 견적서는 **고객사로 나가는 종이**다. 우리 품명 · 교산 품번 · 도번이
 * 거기 찍히면 되돌릴 수 없고, 나간 뒤에야 알게 된다.
 *
 * ── 나가는 길을 **어떻게 다 찾았는가** ──────────────────────────────────────
 * 줄의 글자가 흐르는 길을 `partNameText` 로 훑어(`git grep`) 시험이 아닌 파일만 남겼다.
 * 견적서 줄이 닿는 곳은 넷이고, 아래 `OUTBOUND` 가 그 목록이다 —
 *  · **저장** → 폼의 `collectFields` → `validation/quote-input.ts` → `db/mutations/quotes.ts`
 *  · **다시 읽기** → `db/queries/quotes.ts`(저장된 줄을 폼 · 인쇄 · 엑셀로 되돌려 준다)
 *  · **인쇄 화면 · 미리보기** → `QuotePrintView.tsx`
 *  · **엑셀** → `server/services/quote-workbook.ts`(네 양식 전부 여기를 지난다)
 * 🔵 고객 포털은 **견적서 줄을 그리지 않는다** — `src/components/customer-portal/` 은 고객사
 *    정보를 다루는 사내 화면이고 `partNameText` 가 한 번도 나오지 않는다.
 *
 * ── 🔴 **울타리가 셋**이다 ────────────────────────────────────────────────
 *  ㉠ 나가는 길 넷에 이 값의 이름이 **한 번도 없다**(아래 첫 시험)
 *  ㉡ 폼이 나가는 쪽으로 옮기는 자리 셋이 **칸을 하나씩 적는다** — `{ ...row }` 가 없다
 *  ㉢ 🔴 서버가 **모르는 칸을 버린다** — ㉠㉡ 이 뚫려도 DB 에는 안 닿는다(마지막 시험)
 * ============================================================================
 */
describe("① 🔴 고른 부품의 상세는 작성자만 본다 — 밖으로 나가는 길에 없다", () => {
  /** 🔴 견적서 줄이 **밖으로 나가는** 길 전부. 늘어나면 여기 적어야 한다. */
  const OUTBOUND = [
    "src/components/quotes/QuotePrintView.tsx",
    "src/lib/server/services/quote-workbook.ts",
    "src/lib/validation/quote-input.ts",
    "src/lib/db/mutations/quotes.ts",
    "src/lib/db/queries/quotes.ts",
  ];

  test("㉠ 🔴 나가는 길 어디에도 **고른 부품**이라는 값이 없다", () => {
    for (const path of OUTBOUND) {
      const source = read(path);
      for (const forbidden of [
        "pickedPart",
        "quote-part-pick",
        "quotePickedPartDetail",
        QUOTE_PICKED_PART_PREFIX,
      ]) {
        assert.ok(
          !source.includes(forbidden),
          `${path} 에 '${forbidden}' 이 있다 — 작성자만 볼 값이 고객사에 나가는 길로 들어갔다`
        );
      }
    }
  });

  test("㉠ 🔴 나가는 길 어디에도 **우리 쪽 품번 이름표**가 없다", () => {
    // 상세를 「직접 적어서」 내보내는 길도 같은 사고다 — 값의 이름만 피해 가면 못 잡는다.
    for (const path of OUTBOUND) {
      const source = read(path);
      for (const label of [PART_FIELD_LABELS.kyosanPartNo, PART_FIELD_LABELS.drawingNo]) {
        assert.ok(!source.includes(label), `${path} 에 '${label}' 이 있다`);
      }
    }
  });

  test("㉡ 🔴 폼이 옮기는 자리 셋이 **칸을 하나씩 적는다** — 줄을 통째로 붓지 않는다", () => {
    /**
     * 🔴 `{ ...row }` 한 줄이면 줄에 더해진 칸이 **전부** 따라 나간다. 지금은 셋 다 칸을
     *    하나씩 적고 있고, 그것이 이 기능이 기대는 울타리다.
     */
    const blocks = {
      저장: sliceBetween(form, "items: items .filter((row) => row.partNameText.trim()", "}), };"),
      "미리보기 품목": sliceBetween(form, "items: items .filter((row) => row.lineKind === \"ITEM\")", "})),"),
      "미리보기 품목표": sliceBetween(form, "itemLines: items .filter((row) =>", "}), }}"),
    };
    for (const [name, block] of Object.entries(blocks)) {
      assert.ok(!block.includes("...row"), `${name} 가 줄을 통째로 붓는다`);
      assert.ok(!block.includes("pickedPart"), `${name} 에 고른 부품이 실린다`);
      assert.ok(!block.includes("sourceKey"), `${name} 에 화면 전용 값이 실린다`);
      assert.ok(block.includes("partNameText: row.partNameText,"), `${name} 가 품명을 안 싣는다`);
    }
  });

  test("㉡ 🔴 고르개가 돌려주는 조각에도 상세가 섞이지 않는다 — 칸 넷뿐이다", () => {
    assert.deepEqual(Object.keys(quotePartPickPatch(blank(), FULL, { prices })).sort(), [
      "partId",
      "partNameText",
      "pickedPart",
      "unitPrice",
    ]);
    // 🔴 줄에 적히는 이름은 **고객사 품명 하나**다 — 상세가 품명 칸으로 새면 그대로 나간다.
    assert.equal(quotePartPickPatch(blank(), FULL, { prices }).partNameText, "발진관 조립품");
  });

  test("㉢ 🔴 서버가 **모르는 칸을 버린다** — 앞 울타리가 뚫려도 DB 에는 안 닿는다", () => {
    const detail = quotePickedPartDetail(FULL);
    const result = validateQuoteFields({
      quoteNumber: "DSS 2026-901",
      quoteDate: "2026-10-16",
      customerNameText: "가상전자 주식회사",
      subject: "시험용 수리 견적",
      items: [
        {
          partNameText: "발진관 조립품",
          quantity: 1,
          unitPrice: "125000",
          // 🔴 뚫렸다고 치고 **일부러** 실어 보낸다.
          pickedPart: { id: "11", nameText: "발진관 조립품" },
          pickedPartDetail: detail,
        },
      ],
    });
    assert.ok(result.ok, `통과할 줄 알았는데 실패: ${JSON.stringify(result)}`);
    assert.deepEqual(Object.keys(result.data.items?.[0] ?? {}).sort(), [
      "isOverhaulPart",
      "kind",
      "partId",
      "partNameText",
      "partSpecText",
      "quantity",
      "unitPrice",
    ]);
    const saved = JSON.stringify(result.data);
    for (const leaked of ["pickedPart", "마그네트론", "KY-7788", "DWG-1001", "2M244-M1"]) {
      assert.ok(!saved.includes(leaked), `저장되는 값에 '${leaked}' 이 남았다`);
    }
  });

  test("🔴 화면에는 **보인다** — 울타리가 「아무 데도 안 보인다」가 되면 안 된다", () => {
    // ① 은 **감추는** 요청이 아니라 **작성자에게 보이는** 요청이다. 나가는 길만 막고
    // 화면에도 안 그리면 사용자가 본 그 문제가 그대로 남는다.
    assert.ok(form.includes("quotePickedPartOf(row, partOptionRows)"), "폼이 상세를 찾지 않는다");
    assert.ok(form.includes("{quotePickedPartDetail(picked)}"), "폼이 상세를 그리지 않는다");
    assert.ok(form.includes("{QUOTE_PICKED_PART_PREFIX} —"), "무슨 글자인지 적어 주지 않는다");
  });

  test("🔵 고른 적이 없거나 이름을 손으로 고쳤으면 **안 그린다** — 지어내지 않는다", () => {
    const options = [FULL, OTHER];
    assert.equal(quotePickedPartOf(blank({ partNameText: "손으로 적은 부품" }), options), null);

    const picked = afterPick(blank(), FULL);
    assert.equal(quotePickedPartOf(picked, options)?.id, "11");
    // 🔴 이름을 고치면 그 상세는 이 줄의 설명이 아니다 — 딴 부품의 품번을 이 줄 것으로 읽는다.
    assert.equal(quotePickedPartOf({ ...picked, partNameText: "발진관 조립품 (개조)" }, options), null);
    // 🔵 앞뒤 공백만 다른 것은 고친 것이 아니다.
    assert.equal(quotePickedPartOf({ ...picked, partNameText: "  발진관 조립품  " }, options)?.id, "11");
    // 🔵 재고 관리에서 목록을 못 받아 왔으면(빈 목록) 그릴 것이 없다 — 지어내지 않는다.
    assert.equal(quotePickedPartOf(picked, []), null);
  });
});

/**
 * ============================================================================
 * ② 🔴 **부품이 바뀐 때만** 단가가 따라간다
 * ============================================================================
 * 사용자 요청: 「그 부품 이름을 지우고 **다른 부품을 같은 자리에 넣으면 단가도** 바뀐
 * 부품의 견적가를 따라가게.」 🔴 그러면서 **「적혀 있으면 덮지 않는다」를 버리지 않는다** —
 * 사람이 조정해 둔 금액이 **다른 일로** 덮이면 바뀐 줄 모르고 그대로 나간다.
 *
 * 🔴 **「바뀌었다」를 무엇으로 아는가**가 이 구역의 핵심이다. **글자를 견주지 않는다** —
 * 줄의 품명은 사람이 손으로도 고치는 자유 글자라, 글자만 보면 「다른 부품을 골랐다」와
 * 「같은 부품인데 이름을 손봤다」가 구별되지 않는다. **고른 그 순간의 부품 번호**를 줄에
 * 적어 두고 번호끼리 견준다.
 * ============================================================================
 */
describe("② 🔴 부품이 바뀌면 단가가 따라간다", () => {
  test("🔴 「바뀌었다」는 **번호**로 잰다 — 글자가 아니다", () => {
    const picked = afterPick(blank(), FULL);
    assert.equal(isSamePickedPart(picked.pickedPart, FULL), true);
    assert.equal(isSamePickedPart(picked.pickedPart, OTHER), false);
    // 🔴 이름을 손으로 고쳐도 **같은 부품**이다 — 글자로 쟀다면 여기서 뒤집힌다.
    assert.equal(isSamePickedPart({ ...picked.pickedPart!, nameText: "아무 글자" }, FULL), true);
    // 🔵 고른 적이 없는 줄은 「다른 부품」이다 — 그 금액이 이 부품의 값이라는 근거가 없다.
    assert.equal(isSamePickedPart(null, FULL), false);
  });

  test("🔴 다른 부품을 고르면 **새 부품의 견적가**로 따라간다", () => {
    const first = afterPick(blank(), FULL);
    assert.equal(first.unitPrice, "125000");
    const second = afterPick(first, OTHER);
    // 🔵 12번은 견적가가 `"0"`(무상)이다 — null 이 아니라 **실제 값**이라 그대로 들어간다.
    assert.equal(second.unitPrice, "0");
    assert.equal(second.partNameText, "순환기 조립품");
  });

  test("🔴 **손으로 고쳐 둔 금액이어도** 부품이 바뀌면 따라간다 — 앞 부품의 값이기 때문이다", () => {
    const edited = { ...afterPick(blank(), FULL), unitPrice: "70000" };
    assert.equal(afterPick(edited, OTHER).unitPrice, "0");
  });

  test("🔴 **같은 부품을 다시 고르면 안 덮는다** — 조정해 둔 금액을 날리지 않는다", () => {
    const edited = { ...afterPick(blank(), FULL), unitPrice: "70000" };
    const again = quotePartPickPatch(edited, FULL, { prices });
    // 🔴 키가 아예 없어야 한다 — 빈 글자로 돌려주면 부어 넣는 쪽이 적힌 금액을 지운다.
    assert.ok(!("unitPrice" in again), "같은 부품을 다시 골랐는데 단가 칸을 건드린다");
    assert.equal(afterPick(edited, FULL).unitPrice, "70000");
  });

  test("🔵 같은 부품인데 단가 칸이 **비어 있으면** 채운다 — 지금까지 그대로다", () => {
    const emptied = { ...afterPick(blank(), FULL), unitPrice: "" };
    assert.equal(afterPick(emptied, FULL).unitPrice, "125000");
  });

  test("🔴 이름을 손으로 고친 뒤 **같은 부품**을 다시 골라도 금액은 그대로다", () => {
    // 🔴 여기가 「글자로 재지 않는다」의 값어치다 — 글자로 쟀다면 이 금액이 날아간다.
    const edited = { ...afterPick(blank(), FULL), partNameText: "발진관 조립품(특주)", unitPrice: "70000" };
    assert.equal(afterPick(edited, FULL).unitPrice, "70000");
  });

  test("🔵 새 부품에 단가가 **없으면 비운다** — 0 을 넣지 않는다", () => {
    /**
     * 🔴 `0` 은 **무상**이라는 실제 값이다. 「정하지 않았다」를 0 으로 채우면 그 부품이
     *    0원으로 청구되고, 빈칸과 달리 아무도 눈치채지 못한다. 🔴 앞 부품의 금액을 남겨
     *    두는 것도 안 된다 — **다른 부품의 값**으로 청구하게 된다.
     */
    const first = afterPick(blank(), FULL);
    assert.equal(first.unitPrice, "125000");
    const switched = quotePartPickPatch(first, NO_PRICE, { prices });
    assert.equal(switched.unitPrice, "", "새 부품에 단가가 없는데 앞 금액이 남거나 0 이 들어갔다");
  });

  test("🔵 단가 목록을 **못 받아 왔어도** 바뀐 줄은 비운다 — 앞 부품의 값을 남기지 않는다", () => {
    const first = afterPick(blank(), FULL);
    assert.equal(quotePartPickPatch(first, OTHER, { prices: [] }).unitPrice, "");
    // 🔵 같은 부품이면 그대로 둔다 — 못 받아 온 것이 금액을 지울 까닭은 아니다.
    assert.ok(!("unitPrice" in quotePartPickPatch(first, FULL, { prices: [] })));
  });

  test("🔴 OH 줄은 **O/H 견적가**를 따라간다 — 없으면 일반 단가로 때우지 않는다", () => {
    const oh = afterPick(blank(), FULL, { prices, isOverhaulPart: true });
    assert.equal(oh.unitPrice, "98000");
    // 12번은 일반 `"0"` · O/H 없음 — 일반으로 때우면 0원이 찍히고 아무도 못 알아본다.
    assert.equal(quotePartPickPatch(oh, OTHER, { prices, isOverhaulPart: true }).unitPrice, "");
  });

  test("🔴 `part_id` 는 **언제나 비운다** — 재고 관리 번호는 A/S 의 UUID 가 아니다", () => {
    assert.equal(quotePartPickPatch(blank(), FULL, { prices }).partId, null);
    assert.equal(quotePartPickPatch(afterPick(blank(), FULL), OTHER, { prices }).partId, null);
  });

  test("🔴 폼이 **글자를 칠 때 기억을 지우지 않는다** — 지우면 위 규칙이 통째로 무너진다", () => {
    // 지우면 「이름만 손보고 같은 부품을 다시 고른」 사람의 금액이 덮인다.
    assert.ok(
      form.includes("updateItem(row.key, { partNameText: e.target.value, partId: null });"),
      "글자를 칠 때 하는 일이 바뀌었다"
    );
    const typing = sliceBetween(form, "onChange={(e) => { updateItem(row.key, { partNameText: e.target.value", "}}");
    assert.ok(!typing.includes("pickedPart"), "글자를 칠 때 고른 부품을 건드린다");
  });
});

/**
 * ============================================================================
 * ③ 🔴 차례가 **다섯 자리에서 같다**
 * ============================================================================
 * 사용자 요청: 「**어디서든** 부품 검색 결과는 **고객사 품명 · 품명 · 품명2 · 교산 품번 ·
 * 도번** 순서로 보이게.」 그리는 자리가 다섯이다 —
 *  ㉠ 견적서 줄의 **고른 부품 상세**(요청 ①)
 *  ㉡ **견적서 고르개**의 후보 줄(`nameSource="customer"`)
 *  ㉢ **사용 부품 고르개**의 후보 줄(기본값)
 *  ㉣ **부품 요청**의 찾은 줄
 *  ㉤ **부품 요청**의 담은 줄
 *
 * 🔴 **차례를 적는 자리는 한 곳**이다 — `@dss/core` 의 `PART_FIELD_ORDER`. 다섯 군데에
 *    적어 두면 언젠가 갈리고, 갈린 날 아무도 모른다.
 * 🔵 **못 고치는 자리** — 재고 관리 쪽 화면(`/requests` 등)은 **다른 저장소**라 여기서 못
 *    맞춘다. 사람에게 보고만 한다.
 * ============================================================================
 */
describe("③ 🔴 검색 결과의 차례 — 다섯 자리에서 같다", () => {
  /** 다섯 칸의 값. 🔵 서로 다른 글자라 **자리**로 차례를 잴 수 있다. */
  const VALUES = [
    FULL.customerPartName as string,
    FULL.partName,
    FULL.partSpec as string,
    FULL.kyosanPartNo as string,
    FULL.drawingNo as string,
  ];

  /** 그 글자들이 **적힌 차례대로** 나오는가. 하나라도 빠지면 그 자리를 짚어 말한다. */
  function assertOrdered(text: string, where: string) {
    let previous = -1;
    for (const [index, value] of VALUES.entries()) {
      const at = text.indexOf(value);
      assert.ok(at >= 0, `${where}: '${value}' 가 안 보인다`);
      assert.ok(
        at > previous,
        `${where}: '${value}' 가 '${VALUES[index - 1] ?? ""}' 보다 앞에 있다 — 차례가 다르다`
      );
      previous = at;
    }
  }

  test("🔴 차례를 적는 자리가 **한 곳**이다", () => {
    assert.deepEqual(
      [...PART_FIELD_ORDER],
      ["customerPartName", "partName", "partSpec", "kyosanPartNo", "drawingNo"],
      "정한 차례가 바뀌었다"
    );
    assert.deepEqual(
      PART_FIELD_ORDER.map((key) => PART_FIELD_LABELS[key]),
      ["고객사 품명", "품명", "품명2", "교산 품번", "도번"]
    );
    // 🔴 쓰는 쪽이 제 차례를 또 적고 있으면 안 된다 — 이 목록을 보고 그려야 한다.
    for (const path of [
      "vendor/dss-core/src/ui/inventory/part-picker.tsx",
      "src/lib/domain/inventory-gateway.ts",
      "src/components/quotes/quote-part-pick.ts",
    ]) {
      assert.ok(
        read(path).includes("partFieldEntries"),
        `${path} 가 정해 둔 차례를 쓰지 않는다 — 제 차례를 따로 적고 있다`
      );
    }
  });

  test("㉠ 견적서 줄의 **고른 부품 상세**가 그 차례다", () => {
    const detail = quotePickedPartDetail(FULL);
    assertOrdered(detail, "견적서 상세");
    // 🔴 이름표를 단다 — 줄이 하나뿐이라 값만 이으면 어느 것이 품번이고 도번인지 모른다.
    assert.equal(
      detail,
      "고객사 품명 발진관 조립품 · 품명 마그네트론 · 품명2 2M244-M1 · 교산 품번 KY-7788 · 도번 DWG-1001"
    );
    // 🔵 값이 없는 칸은 빠진다 — 「없음」을 줄줄이 적으면 정작 있는 값이 묻힌다.
    assert.equal(quotePickedPartDetail(OTHER), "고객사 품명 순환기 조립품 · 품명 서큘레이터 · 교산 품번 KY-9900");
  });

  test("㉡ **견적서 고르개**의 후보 줄이 그 차례다", () => {
    assertOrdered(
      renderToStaticMarkup(
        <PartSuggestionList options={[FULL]} onPick={() => {}} listLabel="1번째 부품 후보" nameSource="customer" />
      ),
      "견적서 고르개"
    );
  });

  test("㉢ **사용 부품 고르개**의 후보 줄도 같은 차례다 — 적는 이름만 다르다", () => {
    assertOrdered(
      renderToStaticMarkup(<PartSuggestionList options={[FULL]} onPick={() => {}} listLabel="1번째 부품 후보" />),
      "사용 부품 고르개"
    );
  });

  test("㉣㉤ **부품 요청**의 찾은 줄 · 담은 줄이 같은 차례다", () => {
    /**
     * 🔵 이 칸은 서버 액션을 부르는 클라이언트 컴포넌트라 그려 볼 수 없다 — **원본 글자**의
     *    차례를 본다(이웃 part-request-section-wiring.test.ts 와 같은 사정). 그리는 조각
     *    셋의 **나오는 차례**가 곧 화면의 차례다.
     */
    const rows = [
      {
        where: "찾은 줄",
        block: sliceBetween(partRequest, "{filteredParts.map((part) => {", "추가 </button>"),
        name: "{part.name}",
        /* 🔵 찾은 줄은 품명2 를 줄 위에서 한 번 재어 두고 쓴다(`const spec = …`) — 그리는
           자리는 그 값을 쓰는 이 자리다. 재어 두는 줄로 재면 차례가 거꾸로 보인다. */
        spec: '{spec !== ""',
      },
      {
        where: "담은 줄",
        block: sliceBetween(partRequest, "{cart.map((line) => {", "</tr> ); })}"),
        name: "{line.name}",
        spec: 'inventoryPartSpec(part) !== ""',
      },
    ];
    for (const { where, block, name, spec } of rows) {
      const customerAt = indexOrFail(block, "renderCustomerNameLine(part");
      const nameAt = indexOrFail(block, name);
      const labelsAt = indexOrFail(block, "renderIdLabels(part)");
      assert.ok(customerAt < nameAt, `${where}: 고객사 품명이 품명보다 뒤에 있다`);
      assert.ok(nameAt < labelsAt, `${where}: 품명이 교산 품번 · 도번보다 뒤에 있다`);
      // 품명2 는 품명 바로 뒤다 — 둘은 한 줄의 머리다.
      const specAt = indexOrFail(block, spec);
      assert.ok(nameAt < specAt && specAt < labelsAt, `${where}: 품명2 가 제자리에 없다`);
    }
  });

  test("🔴 교산 품번 · 도번의 차례도 **그 한 곳**에서 온다 — 화면이 손으로 적지 않는다", () => {
    const gateway = flat(read("src/lib/domain/inventory-gateway.ts"));
    const labels = sliceBetween(gateway, "export function inventoryPartIdLabels(", "}");
    assert.ok(labels.includes("partFieldEntries({"), "정해 둔 차례를 쓰지 않는다");
    assert.ok(!labels.includes('"교산 품번"'), "이름표를 화면 쪽에서 다시 적고 있다");
  });
});
