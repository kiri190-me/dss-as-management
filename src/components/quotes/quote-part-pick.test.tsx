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
  isPickedPartNameKept,
  isSamePickedPart,
  quotePartNameEditPatch,
  quotePartPickPatch,
  quotePickedPartDetail,
  quotePickedPartNo,
  quotePickedPartOf,
  quoteRestoredPickedPart,
  type QuotePartPickRow,
} from "@/components/quotes/quote-part-pick";
import QuotePrintView, { type QuotePrintData } from "@/components/quotes/QuotePrintView";
/* 🔴 **형만 빌린다** — 이 목록은 DB 에 붙는 모듈이고, 형은 컴파일에서 사라진다. */
import type { QuoteEditItemLine } from "@/lib/db/queries/quotes";
import type { QuoteTemplateHeader } from "@/lib/storage/quote-template";
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

/**
 * 품명 칸에 `nameText` 를 쳐 넣은 뒤의 줄 — 폼이 하는 그대로 `{ ...row, ...patch }` 로 붓는다.
 * 🔵 `pickedPart` 는 조각에 **키가 없어서** 줄의 것이 그대로 남는다. 그 사실 자체를 아래에서 잰다.
 */
function afterNameEdit(row: QuotePartPickRow, nameText: string): QuotePartPickRow {
  const patch = quotePartNameEditPatch(row, nameText);
  return {
    partNameText: patch.partNameText,
    unitPrice: patch.unitPrice ?? row.unitPrice,
    pickedPart: row.pickedPart,
  };
}

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
     * 🔴 셋 다 **기억을 통째로 만지지 않는다**(`row.pickedPart`). 저장만 그 안의 **번호
     *    하나**를 함수로 꺼내 가는데(2026-10-16 둘째 조각 — 아래 ④), 그 한 자리가 어디인지를
     *    이 시험이 못 박는다.
     */
    const blocks = {
      저장: sliceBetween(form, "items: items .filter((row) => row.partNameText.trim()", "}), };"),
      "미리보기 품목": sliceBetween(form, "items: items .filter((row) => row.lineKind === \"ITEM\")", "})),"),
      "미리보기 품목표": sliceBetween(form, "itemLines: items .filter((row) =>", "}), }}"),
    };
    for (const [name, block] of Object.entries(blocks)) {
      assert.ok(!block.includes("...row"), `${name} 가 줄을 통째로 붓는다`);
      assert.ok(!block.includes(".pickedPart"), `${name} 이 고른 부품의 기억을 통째로 만진다`);
      assert.ok(!block.includes("sourceKey"), `${name} 에 화면 전용 값이 실린다`);
      assert.ok(block.includes("partNameText: row.partNameText,"), `${name} 가 품명을 안 싣는다`);
    }
    // 🔴 저장만 번호를 싣는다 — 꺼내는 자리는 그 함수 하나다(줄을 통째로 넘기지 않는다).
    assert.ok(
      blocks.저장.includes("inventoryPartNo: isNote ? null : quotePickedPartNo(row),"),
      "저장이 번호를 안 싣거나 다른 식으로 꺼낸다"
    );
    // 🔴 미리보기 둘에는 그 번호가 **한 글자도** 없다 — 그쪽은 고객사가 볼 종이를 그린다.
    for (const name of ["미리보기 품목", "미리보기 품목표"] as const) {
      assert.ok(!blocks[name].includes("inventoryPartNo"), `${name} 에 재고 관리 번호가 실린다`);
      assert.ok(!blocks[name].includes("quotePickedPartNo"), `${name} 이 번호를 꺼내 간다`);
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
    /**
     * 🔴 `inventoryPartNo` **하나만** 늘었다(2026-10-16 둘째 조각 — 아래 ④). 상세도, 집어
     *    넣던 그때의 이름도 여전히 한 칸도 없다.
     */
    assert.deepEqual(Object.keys(result.data.items?.[0] ?? {}).sort(), [
      "inventoryPartNo",
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
    const typing = sliceBetween(form, "onChange={(e) => { updateItem(row.key, quotePartNameEditPatch(row,", "}}");
    assert.ok(!typing.includes("pickedPart"), "글자를 칠 때 고른 부품을 건드린다");
    // 🔴 조각 자체에도 그 칸이 없어야 한다 — 폼은 `{ ...row, ...patch }` 로 붓는다.
    for (const patch of [
      quotePartNameEditPatch(afterPick(blank(), FULL), "발진관 조립품"),
      quotePartNameEditPatch(afterPick(blank(), FULL), "딴 이름"),
      quotePartNameEditPatch(blank(), "손으로 적은 부품"),
    ]) {
      assert.ok(!("pickedPart" in patch), `조각이 고른 부품을 건드린다: ${JSON.stringify(patch)}`);
    }
  });
});

/**
 * ============================================================================
 * ②b 🔴 **「고른 부품」 상세가 사라지면 단가도 사라진다** (2026-10-16 사용자 요청)
 * ============================================================================
 * 사용자가 한 말: 「선택된 부품이 없으면 단가도 사라지도록 해줘.」 그리고 **「선택된 부품」이
 * 무엇인지**를 사용자가 직접 짚어 주었다 — 「품목 칸의 **밑에 [고른 부품] 하고 작은 글씨가
 * 나오고 있는 상태**를 말한 거야.」 그래서 기준은 **「품명 칸이 비었는가」가 아니라 「그 작은
 * 글씨가 보일 수 있는 상태인가」**다. 품명을 통째로 지운 경우는 여기에 저절로 들어간다.
 *
 * 🔴 이 구역이 **가장 조심스럽게 재는 것**은 「비우지 **않아야** 하는 자리」다 —
 *  · 재고 관리 목록을 **못 받아 왔을 때**(통신 탓에 적어 둔 금액이 날아가면 안 된다)
 *  · 단가 칸을 **손으로 고칠 때**(이 규칙을 타지 않는다 — 손으로 적는 길이 그래서 산다)
 *  · 🔴 비울 때 **`0` 을 넣는 것**(`"0"` 은 **무상**이라는 실제 값이다)
 * ============================================================================
 */
describe("②b 🔴 상세가 사라지면 단가도 사라진다", () => {
  test("🔵 고른 부품의 이름 **그대로면** 단가를 건드리지 않는다", () => {
    const picked = afterPick(blank(), FULL);
    assert.equal(picked.unitPrice, "125000");
    const patch = quotePartNameEditPatch(picked, "발진관 조립품");
    // 🔴 키가 아예 없어야 한다 — 빈 글자로 돌려주면 부어 넣는 쪽이 적힌 금액을 지운다.
    assert.ok(!("unitPrice" in patch), "이름이 그대로인데 단가 칸을 건드린다");
    assert.equal(afterNameEdit(picked, "발진관 조립품").unitPrice, "125000");
    // 🔵 앞뒤 공백만 붙은 것은 「고친 것」이 아니다 — 상세도 그대로 뜬다.
    assert.equal(afterNameEdit(picked, "  발진관 조립품 ").unitPrice, "125000");
  });

  test("🔴 품명을 손으로 고쳐 **상세가 사라지면** 단가가 빈 글자가 된다", () => {
    const picked = afterPick(blank(), FULL);
    // 상세를 그릴 수 있던 줄이 — 한 글자 고치는 순간 그릴 수 없게 된다.
    assert.equal(quotePickedPartOf(picked, [FULL, OTHER])?.id, "11");
    const edited = afterNameEdit(picked, "발진관 조립품(특주)");
    assert.equal(quotePickedPartOf(edited, [FULL, OTHER]), null, "상세가 아직 보인다");
    assert.equal(edited.unitPrice, "", "상세가 사라졌는데 단가가 남았다");
  });

  test("🔴 품명을 **통째로 지우면** 단가가 빈 글자가 된다 — 사용자가 처음 말한 그 경우", () => {
    const picked = afterPick(blank(), FULL);
    assert.equal(afterNameEdit(picked, "").unitPrice, "");
    // 🔵 공백만 남은 것도 지운 것이다.
    assert.equal(afterNameEdit(picked, "   ").unitPrice, "");
  });

  test("🔴 고른 적 없는 줄(`pickedPart === null`)은 품명을 칠 때마다 비운다", () => {
    // 저장돼 있던 줄을 펼친 것도 여기다 — `pickedPart` 는 **화면에만 사는 값**이라 없다.
    const typed = { ...blank({ partNameText: "손으로 적은 부품" }), unitPrice: "70000" };
    assert.equal(afterNameEdit(typed, "손으로 적은 부품2").unitPrice, "");
  });

  test("🔴 비우는 값은 **빈 글자**다 — `0` 이 아니다", () => {
    /**
     * 🔴 `"0"` 은 **무상**이라는 실제 값이다(@dss/core 의 part-price-field.ts). 0 으로 비우면
     *    그 줄이 0원으로 청구되고, 빈칸과 달리 그럴듯해 보여 아무도 되묻지 않는다.
     */
    for (const [row, nameText] of [
      [afterPick(blank(), FULL), ""],
      [afterPick(blank(), FULL), "딴 이름"],
      [blank({ unitPrice: "70000" }), "손으로 적은 부품"],
    ] as const) {
      const patch = quotePartNameEditPatch(row, nameText);
      assert.equal(patch.unitPrice, "", `비운 값이 빈 글자가 아니다: ${JSON.stringify(patch)}`);
      assert.notEqual(patch.unitPrice, "0", "무상(0원)으로 적어 버렸다");
    }
  });

  test("🔴 **`pickedPart` 는 그대로 남는다** — 같은 부품을 다시 고르는 길이 살아 있어야 한다", () => {
    const picked = afterPick(blank(), FULL);
    const edited = afterNameEdit(picked, "발진관 조립품(특주)");
    assert.deepEqual(edited.pickedPart, { id: "11", nameText: "발진관 조립품" });
    // 🔵 비운 단가는 **같은 부품을 다시 고르는 것만으로** 견적가가 들어온다(고르개의 「빈칸이면 채운다」).
    assert.equal(afterPick(edited, FULL).unitPrice, "125000");
    // 🔴 기억을 지웠다면 이 줄은 「다른 부품」이 되어 ㉡(조정해 둔 금액 지키기)이 무너진다.
    assert.equal(isSamePickedPart(edited.pickedPart, FULL), true);
  });

  test("🔵 고친 이름을 **되돌려도** 단가는 되살아나지 않는다 — 사라진 것이 돌아오면 못 믿는다", () => {
    const picked = afterPick(blank(), FULL);
    const edited = afterNameEdit(picked, "발진관 조립품(특주)");
    assert.equal(edited.unitPrice, "");
    const back = afterNameEdit(edited, "발진관 조립품");
    // 상세는 다시 뜨지만 단가는 비어 있는 그대로다.
    assert.equal(quotePickedPartOf(back, [FULL])?.id, "11");
    assert.equal(back.unitPrice, "");
  });

  test("🔴 재고 관리 목록을 **못 받아 와도** 단가를 건드리지 않는다 — 통신 탓에 금액이 날아가면 안 된다", () => {
    /**
     * 🔴 여기가 이 규칙에서 가장 위험한 자리다. 상세를 **그릴지**는 `quotePickedPartOf` 가
     *    정하고 그 함수는 목록을 못 받아 오면 null 을 돌려준다 — 그것으로 비울지를 정하면
     *    통신이 끊긴 날 품명을 한 글자 고칠 때마다 적어 둔 금액이 사라진다.
     */
    const picked = afterPick(blank(), FULL);
    assert.equal(quotePickedPartOf(picked, []), null, "그리기 판정이 바뀌었다 — 아래 전제가 무너진다");
    assert.equal(afterNameEdit(picked, "발진관 조립품").unitPrice, "125000");
    // 🔴 애초에 목록을 **받을 수 없는 함수**다 — 인자가 둘이다(줄 · 바뀐 글자).
    assert.equal(quotePartNameEditPatch.length, 2, "비우기 판정이 목록을 받는다");
  });

  test("🔴 이름을 견주는 잣대는 **한 곳**이다 — 그리기와 지우기가 갈리면 안 된다", () => {
    const picked = afterPick(blank(), FULL).pickedPart;
    assert.equal(isPickedPartNameKept(picked, "발진관 조립품"), true);
    assert.equal(isPickedPartNameKept(picked, "  발진관 조립품  "), true);
    assert.equal(isPickedPartNameKept(picked, "발진관 조립품(특주)"), false);
    assert.equal(isPickedPartNameKept(picked, ""), false);
    assert.equal(isPickedPartNameKept(null, ""), false);
    // 🔵 두 함수가 같은 잣대를 쓴다 — 원본에 그 이름이 둘 다에서 보여야 한다.
    const source = read("src/components/quotes/quote-part-pick.ts");
    assert.equal(
      source.split("isPickedPartNameKept(").length - 1,
      3,
      "정의 한 번 · 그리기 한 번 · 지우기 한 번이 아니다"
    );
  });

  test("🔵 **손으로 적는 길**은 그대로다 — 품명을 다 적은 뒤 단가를 적으면 남는다", () => {
    // 부품 마스터에 없는 것을 적는 줄. 품명을 치는 동안에는 단가가 빈 글자가 되지만,
    // 단가 칸을 고치는 것은 이 규칙을 타지 않는다 — 그래서 **차례**만 지키면 된다.
    let row = blank();
    for (const nameText of ["특", "특주", "특주 브래킷"]) row = afterNameEdit(row, nameText);
    assert.equal(row.unitPrice, "");
    row = { ...row, unitPrice: "45000" }; // 단가 칸의 onChange — 품명 규칙을 안 탄다
    assert.equal(row.unitPrice, "45000");
    // 🔴 단가 칸이 이 규칙을 타면 여기서 깨진다.
    assert.ok(
      form.includes("onValueChange={(raw) => updateItem(row.key, { unitPrice: raw })}"),
      "단가 칸이 품명 규칙을 타게 됐다"
    );
  });

  test("🔴 폼이 **그 함수로** 비운다 — 판정을 화면에 다시 적지 않는다", () => {
    assert.ok(
      form.includes("updateItem(row.key, quotePartNameEditPatch(row, e.target.value));"),
      "품명 칸이 그 판정을 쓰지 않는다"
    );
    // 화면이 제 잣대를 따로 적고 있으면 두 곳이 언젠가 갈린다.
    const typing = sliceBetween(form, "onChange={(e) => { updateItem(row.key, quotePartNameEditPatch(row,", "}}");
    for (const forbidden of ['unitPrice: ""', "trim()", "nameText"]) {
      assert.ok(!typing.includes(forbidden), `품명 칸이 판정을 제 안에 적고 있다: ${forbidden}`);
    }
  });

  test("🔴 사람이 부품을 고를 수 있는 품명 칸은 **한 벌**이다 — 종류를 바꿔도 같게 군다", () => {
    /**
     * 🔴 이 화면에는 견적서 종류가 셋이다(일반 · O/H · 케이블). 줄을 그리는 자리가 여러 벌이면
     *    한 벌만 고친 날 「종류를 바꾸면 다르게 구는」 화면이 된다. 지금은 `items.map` 한 벌이
     *    셋을 다 그리고, 종류는 칸 너비(grid)와 OH 표시만 가른다.
     */
    assert.equal(form.split("{items.map((row, index) =>").length - 1, 1, "줄을 그리는 자리가 여러 벌이다");
    assert.equal(
      form.split("quotePartNameEditPatch(").length - 1,
      1,
      "품명 칸이 여러 벌이다 — 전부 같은 규칙을 타는지 다시 봐야 한다"
    );
    /**
     * 🔵 **설명 줄(`lineKind === "NOTE"`)은 해당 없다** — 그 줄에는 단가 칸이 아예 없다
     *    (잠그는 것이 아니라 안 그린다 · DB 의 CHECK 가 거절한다). 그래서 그 칸의 onChange 는
     *    지금 그대로다.
     */
    const noteRow = sliceBetween(form, 'row.lineKind === "NOTE" ? (', ") : (");
    assert.ok(
      noteRow.includes("onChange={(e) => updateItem(row.key, { partNameText: e.target.value })}"),
      "설명 줄의 품명 칸이 바뀌었다"
    );
    assert.ok(!noteRow.includes("unitPrice"), "설명 줄에 단가 칸이 생겼다");
    assert.ok(!noteRow.includes("quotePartNameEditPatch"), "단가 칸도 없는 줄에 비우기 규칙이 걸렸다");
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

/**
 * ============================================================================
 * ④ 🔴 **줄이 번호를 저장한다 — 다시 열어도 그대로다** (2026-10-16 둘째 조각)
 * ============================================================================
 * 위 ①~③ 까지의 기억은 **화면에만 살았다.** 그래서 사용자가 겪은 일이 둘이다:
 *
 *  · 저장한 견적서를 고치려고 다시 열면 작성자용 상세가 **안 보인다**
 *  · 🔴 그 줄의 품명을 **한 글자만 고쳐도 단가가 비워진다**(기억이 없어 「고른 적 없는 줄」로
 *    읽힌다) — 기존 견적서를 손볼 때마다 겪는다
 *
 * 그래서 `quote_items.inventory_part_no` 한 칸에 **번호만** 적는다. 여기서 재는 것은 넷이다 —
 *  ㉠ 저장에 **번호 하나만** 실린다(상세도 · 집어 넣던 그때의 이름도 아니다)
 *  ㉡ 다시 열면 **기억이 되살아난다** — 상세가 보이고 단가가 살아남는다
 *  ㉢ 🔴 설명 줄에는 **실리지 않는다**(그 줄에는 부품이 없다)
 *  ㉣ 🔴 **문서로는 나가지 않는다** — 인쇄 화면 · 엑셀 어디에도 그 번호가 없다
 *
 * 🔴 **값은 전부 지어낸 것이다** — 실제 고객사 · 모델 · L/N · S/N 은 공개 저장소에 적지 않는다.
 * ============================================================================
 */
describe("④ 🔴 저장되는 것은 번호 하나 — 다시 열면 기억이 돌아온다", () => {
  /** 저장된 품목 줄의 모양(`QuoteItemInput`)에서 이 시험이 보는 것만. */
  type SavedItem = {
    kind?: string;
    partNameText: string;
    unitPrice: string | null;
    inventoryPartNo: number | null;
  };

  /**
   * 🔴 **한 바퀴를 실제로 돌린다** — 폼이 보내는 모양 그대로 검증에 넣고, 돌아온 값을
   * 저장된 줄로 본다. 「화면에서는 되는데 저장하면 사라진다」가 바로 이 사이에서 난다.
   */
  function save(rows: readonly { row: QuotePartPickRow; isNote?: boolean }[]): SavedItem[] {
    const result = validateQuoteFields({
      quoteNumber: "DSS 2026-902",
      quoteDate: "2026-10-16",
      customerNameText: "가상전자 주식회사",
      subject: "시험용 수리 견적",
      items: rows.map(({ row, isNote }) => ({
        kind: isNote ? "NOTE" : "ITEM",
        partNameText: row.partNameText,
        quantity: isNote ? null : 1,
        unitPrice: isNote ? null : row.unitPrice,
        // 🔴 폼의 `collectFields` 가 하는 그대로 — 줄이 아니라 **번호 하나**를 꺼내 보낸다.
        inventoryPartNo: isNote ? null : quotePickedPartNo(row),
      })),
    });
    assert.ok(result.ok, `저장이 거절됐다: ${JSON.stringify(result)}`);
    return (result.data.items ?? []) as unknown as SavedItem[];
  }

  /** 저장된 줄을 폼이 펴는 그대로 — 기억은 `quoteRestoredPickedPart` 한 곳이 되살린다. */
  function reopen(saved: SavedItem): QuotePartPickRow {
    return {
      partNameText: saved.partNameText,
      unitPrice: saved.unitPrice ?? "",
      pickedPart: quoteRestoredPickedPart({
        inventoryPartNo: saved.inventoryPartNo,
        partNameText: saved.partNameText,
      }),
    };
  }

  test("㉠ 🔴 저장에는 **번호 하나**뿐이다 — 상세도 그때의 이름도 가지 않는다", () => {
    const [saved] = save([{ row: afterPick(blank(), FULL) }]);
    assert.equal(saved?.inventoryPartNo, 11, "번호가 저장되지 않았다");
    const dumped = JSON.stringify(saved);
    for (const leaked of ["nameText", "마그네트론", "KY-7788", "DWG-1001", "2M244-M1"]) {
      assert.ok(!dumped.includes(leaked), `저장되는 줄에 '${leaked}' 이 남았다`);
    }
  });

  test("㉠ 🔵 **고른 적 없는 줄은 null** — 손으로 적은 줄이 그렇다", () => {
    assert.equal(quotePickedPartNo(blank({ partNameText: "손으로 적은 부품" })), null);
    const [saved] = save([{ row: { ...blank({ partNameText: "특주 브래킷" }), unitPrice: "45000" } }]);
    assert.equal(saved?.inventoryPartNo, null, "고른 적 없는 줄에 번호가 생겼다");
  });

  test("㉠ 🔴 이름을 손으로 고친 뒤에도 **번호는 간다** — 그 줄은 그 부품에서 왔다", () => {
    // 🔵 기억을 지우지 않는 규칙(②b)이 저장까지 이어지는가. 지우면 다시 열고 같은 부품을
    //    다시 고를 때 「다른 부품」이 되어 적어 둔 금액이 덮인다.
    const edited = afterNameEdit(afterPick(blank(), FULL), "발진관 조립품(특주)");
    assert.equal(quotePickedPartNo(edited), "11");
    const [saved] = save([{ row: { ...edited, unitPrice: "70000" } }]);
    assert.equal(saved?.inventoryPartNo, 11);
  });

  test("㉡ 🔴 다시 열면 **상세가 보인다** — 사용자가 신고한 첫째 증상", () => {
    const [saved] = save([{ row: afterPick(blank(), FULL) }]);
    const reopened = reopen(saved);
    assert.deepEqual(reopened.pickedPart, { id: "11", nameText: "발진관 조립품" });
    assert.equal(quotePickedPartOf(reopened, [FULL, OTHER])?.id, "11", "다시 연 줄에 상세가 안 보인다");
  });

  test("㉡ 🔴 다시 연 뒤 **품명을 고쳐도 단가가 안 날아간다** — 사용자가 신고한 둘째 증상", () => {
    const [saved] = save([{ row: afterPick(blank(), FULL) }]);
    const reopened = reopen(saved);
    assert.equal(reopened.unitPrice, "125000");
    // 🔴 적힌 이름 그대로면 단가 칸을 아예 건드리지 않는다(②b 의 그 규칙).
    assert.ok(!("unitPrice" in quotePartNameEditPatch(reopened, "발진관 조립품")));
    assert.equal(afterNameEdit(reopened, "  발진관 조립품 ").unitPrice, "125000");
    // 🔵 **정말 고치면** 그때는 지금까지처럼 비운다 — 되살린 줄도 같은 규칙을 탄다.
    assert.equal(afterNameEdit(reopened, "발진관 조립품(특주)").unitPrice, "");
  });

  test("㉡ 🔴 다시 연 줄에서 **같은 부품을 다시 골라도** 조정해 둔 금액이 그대로다", () => {
    const [saved] = save([{ row: { ...afterPick(blank(), FULL), unitPrice: "70000" } }]);
    const reopened = reopen(saved);
    assert.equal(isSamePickedPart(reopened.pickedPart, FULL), true);
    assert.ok(!("unitPrice" in quotePartPickPatch(reopened, FULL, { prices })), "다시 고르니 금액이 덮인다");
    // 🔵 **다른** 부품을 고르면 지금까지처럼 따라간다 — 그 금액은 앞 부품의 값이다.
    assert.equal(afterPick(reopened, OTHER).unitPrice, "0");
  });

  test("㉡ 🔵 번호가 없는 줄은 **지금까지 그대로** — 옛 견적서가 달라지지 않는다", () => {
    // 이 칸이 생기기 전에 저장된 줄은 전부 null 이다. 그 줄은 「고른 적 없음」으로 펴진다.
    const old = reopen({ partNameText: "옛 견적서의 줄", unitPrice: "30000", inventoryPartNo: null });
    assert.equal(old.pickedPart, null);
    assert.equal(quotePickedPartOf(old, [FULL, OTHER]), null);
  });

  test("㉡ 🔴 되살리는 규칙은 **한 곳**이다 — 폼이 손으로 짓지 않는다", () => {
    const restore = sliceBetween(form, "quote.itemLines.map((item) => ({", "}))");
    assert.ok(restore.includes("pickedPart: quoteRestoredPickedPart(item),"), "폼이 기억을 손으로 짓는다");
    /**
     * 🔴 이름을 **따로 지어 넣으면** 저장된 품명과 어긋나, 펴자마자 상세가 사라지고 품명을
     *    건드리는 순간 단가가 날아간다 — 고치려던 증상이 그대로 남는다.
     */
    assert.ok(!restore.includes("nameText"), "폼이 이름을 따로 지어 넣는다");
    assert.ok(!restore.includes("...item"), "저장된 줄을 통째로 붓는다 — 그러면 화면 전용 칸까지 섞인다");
  });

  test("㉢ 🔴 **설명 줄에는 안 실린다** — 그 줄에는 부품이 없다", () => {
    const sneaky = { ...afterPick(blank(), FULL), partNameText: "* 아래는 별도 주문품" };
    const [saved] = save([{ row: sneaky, isNote: true }]);
    assert.equal(saved?.inventoryPartNo, null, "설명 줄에 재고 관리 번호가 실렸다");
  });

  test("㉢ 🔴 검증이 **번호가 아닌 값**을 거절한다 — 0 으로 접지 않는다", () => {
    /** 번호 한 칸만 바꿔 가며 재는 장 — 나머지는 통과하는 값이다. */
    const withNo = (inventoryPartNo: unknown) =>
      validateQuoteFields({
        quoteNumber: "DSS 2026-903",
        quoteDate: "2026-10-16",
        customerNameText: "가상전자 주식회사",
        subject: "시험용 수리 견적",
        items: [{ partNameText: "발진관 조립품", quantity: 1, unitPrice: "1000", inventoryPartNo }],
      });

    for (const bad of [0, -1, 1.5, "아무 글자"]) {
      const result = withNo(bad);
      assert.ok(!result.ok, `'${bad}' 를 번호로 받아 버렸다`);
      if (!result.ok) {
        assert.ok(
          result.fieldErrors["items.0.inventoryPartNo"],
          `'${bad}' 를 거절은 했는데 어느 칸인지 안 알려 준다`
        );
      }
    }

    // 🔵 빈 값 셋은 **「없다」이지 오류가 아니다** — 손으로 적은 줄 · 옛 줄이 전부 그렇다.
    for (const empty of [null, undefined, ""]) {
      const result = withNo(empty);
      assert.ok(result.ok, `${String(empty)} 를 오류로 세웠다: ${JSON.stringify(result)}`);
      if (result.ok) assert.equal(result.data.items[0]?.inventoryPartNo, null);
    }

    // 🔵 글자로 온 번호는 받는다 — 화면은 고르개의 열쇠를 **글자로** 들고 다닌다.
    const asText = withNo("11");
    assert.ok(asText.ok, JSON.stringify(asText));
    if (asText.ok) assert.equal(asText.data.items[0]?.inventoryPartNo, 11);
  });
});

/**
 * ============================================================================
 * ④b 🔴 **그 번호는 문서로 나가지 않는다** (2026-10-16 둘째 조각)
 * ============================================================================
 * 저장되는 값이 되었으니 **조회가 그것을 되읽어 흘려보낼 길**이 생겼다. 견적서는 고객사로
 * 나가는 종이이고, 이 번호는 우리 쪽 열쇠다 — 한 번 찍혀 나가면 되돌릴 수 없다.
 *
 * 울타리가 셋이다 —
 *  ㉠ 조회가 **두 목록으로 갈라** 준다: 문서 쪽(`items`)에는 그 칸이 아예 없다.
 *  ㉡ 문서를 만드는 자리들이 그 칸의 이름을 **한 번도 적지 않는다**.
 *  ㉢ 🔴 값이 든 줄을 **실제로 그려 봐도** 종이에 그 번호가 없다 — 이름만 피해 가는 사고는
 *     글자로 못 잡는다(「겉이 아니라 결과를 본다」).
 * ============================================================================
 */
describe("④b 🔴 저장된 번호가 인쇄 · 엑셀로 나가지 않는다", () => {
  /** 🔵 다른 값과 섞일 수 없는 번호다 — 금액 · 수량 · 글자 어디에도 안 나오는 자리를 골랐다. */
  const SECRET_NO = 987654;

  /** 🔴 문서 쪽이 받는 줄의 형에는 이 칸이 **없다** — 뚫렸다고 치고 일부러 실어 보낸다. */
  const leaky = (over: Partial<QuoteEditItemLine> = {}): QuoteEditItemLine => ({
    partId: null,
    kind: "ITEM",
    partNameText: "발진관 조립품",
    partSpecText: "2M244-M1",
    isOverhaulPart: false,
    quantity: 1,
    unitPrice: "125000",
    inventoryPartNo: SECRET_NO,
    ...over,
  });

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

  const printable = (over: Partial<QuotePrintData> = {}): QuotePrintData => ({
    quoteNumber: "DSS 2026-904",
    quoteDate: "2026-10-16",
    customerNameText: "가상전자 주식회사",
    subject: "시험용 수리 견적",
    validity: null,
    delivery: null,
    payment: null,
    modelNameText: null,
    serialNumberText: null,
    lotNumberText: null,
    workCost: "0",
    items: [{ partId: null, partNameText: "발진관 조립품", isOverhaulPart: false, quantity: 1, unitPrice: "125000" }],
    ...over,
  });

  /** 태그를 걷어 낸 글자만 — **무엇이 종이에 그려졌나**를 본다. */
  const text = (html: string) =>
    html.replace(/<style>[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

  test("㉠ 🔴 조회가 **두 목록으로 가른다** — 문서 쪽 목록에 그 칸이 없다", () => {
    const queries = flat(read("src/lib/db/queries/quotes.ts"));
    // 고치는 쪽(itemLines)만 싣는다. 문서 쪽(items)에 한 줄이라도 생기면 그대로 나간다.
    assert.ok(queries.includes("const itemLines = itemRows.map((item) => ({"), "고치는 쪽 목록이 달라졌다");
    const forDocument = sliceBetween(queries, "const items = itemRows.filter(isQuoteAmountItemLine)", "const itemLines =");
    assert.ok(!forDocument.includes("inventoryPartNo"), "문서로 나가는 목록에 재고 관리 번호가 실린다");
    // 🔴 문서 쪽이 받는 형에도 그 칸이 없어야 한다 — 없어야 **읽는 일**이 컴파일에서 막힌다.
    const printableType = sliceBetween(queries, "export type QuotePrintableItemLine = {", "};");
    assert.ok(!printableType.includes("inventoryPartNo"), "문서 쪽 형에 그 칸이 들어갔다");
  });

  test("㉡ 🔴 문서를 만드는 자리들이 그 이름을 **한 번도 적지 않는다**", () => {
    for (const path of [
      "src/components/quotes/QuotePrintView.tsx",
      "src/lib/server/services/quote-workbook.ts",
      // 엑셀 네 양식 — 실제로 칸에 글자를 찍는 자리다.
      "src/lib/xlsx/quote-template.ts",
      "src/lib/xlsx/oh-quote-template.ts",
      "src/lib/xlsx/matcher-quote-template.ts",
      "src/lib/xlsx/cable-quote-template.ts",
    ]) {
      assert.ok(!read(path).includes("inventoryPartNo"), `${path} 가 재고 관리 번호를 읽는다`);
    }
  });

  test("㉢ 🔴 **케이블 종이**에 그 번호가 없다 — 값이 든 줄을 그대로 그려 봐도", () => {
    const body = text(
      renderToStaticMarkup(
        <QuotePrintView
          quote={printable({
            kind: "CABLE",
            remarks: null,
            itemLines: [leaky(), leaky({ kind: "NOTE", partNameText: "* 안내", quantity: null, unitPrice: null })],
          })}
          header={HEADER}
          quoteId={null}
        />
      )
    );
    assert.ok(body.includes("발진관 조립품"), "줄 자체가 안 그려졌다 — 아래 판정의 전제가 무너진다");
    assert.ok(!body.includes(String(SECRET_NO)), `케이블 종이에 ${SECRET_NO} 가 그려졌다`);
  });

  test("㉢ 🔴 **내자 종이**에도 없다 — 그쪽은 itemLines 를 보지도 않는다", () => {
    const body = text(
      renderToStaticMarkup(
        <QuotePrintView quote={printable({ itemLines: [leaky()] })} header={HEADER} quoteId={null} />
      )
    );
    assert.ok(body.includes("발진관 조립품"), "줄 자체가 안 그려졌다");
    assert.ok(!body.includes(String(SECRET_NO)), `내자 종이에 ${SECRET_NO} 가 그려졌다`);
  });
});
