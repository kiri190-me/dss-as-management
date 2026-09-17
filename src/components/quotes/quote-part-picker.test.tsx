import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";

import {
  MAX_PART_SUGGESTIONS,
  QuotePartSuggestionList,
  filterPartOptions,
  partOptionDetail,
  partPickPatch,
  partPickUnitPrice,
} from "./quote-part-picker";
import type { PartPickerPriceRow, PartPickerRow } from "@/lib/db/queries/inventory";

/**
 * ============================================================================
 * 견적서 품명 칸에서 부품을 찾아 고른다 (2026-09-17 사용자 요청)
 * ============================================================================
 * 거르기 · 고른 값 · 후보 목록의 생김새는 **실제로 돌려 본다**(quote-part-picker.tsx 는
 * 서버 것을 하나도 끌고 오지 않는다 — 형 선언만 빌려 쓴다). 폼과 두 페이지는 서버
 * 액션을 부르는 클라이언트 컴포넌트라 이 환경에서 그려 볼 수 없어서, 이웃 시험
 * (quote-edit-cable.test.ts · quote-attachment-screens.test.ts)과 같이 **원본 글자**를
 * 읽어 규칙이 제자리에 있는지 본다.
 *
 * 여기서 지키는 것 다섯:
 *
 *  ㉠ **네 가지로 거른다** — 품명 · 품명2(규격) · 도번 · 교산 품번. 재고 조회가 서버에서
 *     찾는 네 칸과 같아야 「재고에서 찾던 대로 치면 나온다」가 된다.
 *  ㉡ **고르면 붙고, 고쳐 쓰면 풀린다** — partId 가 붙어야 나중에 같은 부품을 묶어 셀 수
 *     있고, 이름을 고쳤는데도 붙어 있으면 글자와 통계가 서로 다른 것을 가리킨다.
 *  ㉢ 🔴 **재고 · 소유구분 · 내부 비고가 화면 쪽으로 가지 않는다** — 새 조회가 그 칸들을
 *     아예 담지 않는다(화면에서 안 그리는 것으로는 모자라다. 조회가 이미 실어 보낸 뒤다).
 *  ㉣ **마스터에 없는 이름도 그대로 적힌다** — 케이블 부속처럼 재고에 없는 것을 손으로
 *     적는 길이 사라지면 안 된다.
 *  ㉤ **두 페이지가 모두 목록을 넘긴다** — 새로 만들 때도 고칠 때도 되어야 한다.
 *  ㉥ 🔴 **고르면 단가도 채운다**(2026-09-17) — 금액이 고객사로 나가는 자리라 여기서
 *     못 박는 것이 넷이다: 적혀 있으면 덮지 않는다 · null 은 빈칸 · `"0"` 은 0 · O/H 줄은
 *     O/H 단가로만(없으면 안 채운다). 그리고 이 입력은 **선택**이라 안 줘도 돌아간다 —
 *     같은 고르개를 단가 칸 없는 화면이 쓴다.
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
const inventory = flat(read("src/lib/db/queries/inventory.ts"));
const newPage = flat(read("src/app/(app)/quotes/new/page.tsx"));
const editPage = flat(read("src/app/(app)/quotes/[id]/page.tsx"));

const rows: PartPickerRow[] = [
  { id: "p1", partName: "마그네트론", partSpec: "2M244-M1", drawingNo: "DWG-1001", kyosanPartNo: "KY-7788" },
  { id: "p2", partName: "서큘레이터", partSpec: null, drawingNo: null, kyosanPartNo: "ky-9900" },
  { id: "p3", partName: "케이블 어셈블리", partSpec: "RG-393 3m", drawingNo: "dwg-2002", kyosanPartNo: null },
];
const idsOf = (list: readonly PartPickerRow[]) => list.map((row) => row.id);

/**
 * 단가 목록. 부품 셋의 형편이 서로 다르다 — 이 셋으로 「없다 ≠ 0」과 O/H 규칙을 다 본다.
 *
 *  · p1 — 일반 · O/H 둘 다 있다
 *  · p2 — **일반은 "0"(무상)이고 O/H 는 없다** — 0 을 채우는 길과 O/H 를 안 채우는 길
 *  · p3 — 목록에 아예 없다(단가를 하나도 정하지 않은 부품. 일흔몇 중 예순몇이 이렇다)
 */
const prices: PartPickerPriceRow[] = [
  { partId: "p1", unitPrice: "125000.00", overhaulUnitPrice: "98000.00" },
  { partId: "p2", unitPrice: "0.00", overhaulUnitPrice: null },
];

describe("㉠ 네 가지로 거른다 — 품명 · 품명2(규격) · 도번 · 교산 품번", () => {
  test("품명으로 찾는다", () => {
    assert.deepEqual(idsOf(filterPartOptions(rows, "마그네")), ["p1"]);
  });

  test("품명2(규격)로 찾는다 — 대소문자를 가리지 않는다", () => {
    assert.deepEqual(idsOf(filterPartOptions(rows, "2M244")), ["p1"]);
    assert.deepEqual(idsOf(filterPartOptions(rows, "2m244")), ["p1"]);
  });

  test("도번으로 찾는다 — 적힌 것이 소문자여도 대문자로 쳐서 찾는다", () => {
    assert.deepEqual(idsOf(filterPartOptions(rows, "DWG-2002")), ["p3"]);
  });

  test("교산 품번으로 찾는다", () => {
    assert.deepEqual(idsOf(filterPartOptions(rows, "ky-77")), ["p1"]);
    assert.deepEqual(idsOf(filterPartOptions(rows, "KY-9900")), ["p2"]);
  });

  test("🔴 빈 글자에는 아무것도 뜨지 않는다 — 칸을 누르자마자 목록이 밑줄을 가리면 안 된다", () => {
    assert.deepEqual(filterPartOptions(rows, ""), []);
    assert.deepEqual(filterPartOptions(rows, "   "), []);
  });

  test("비어 있는 칸(null)이 섞여 있어도 터지지 않는다 — 규격 · 도번 · 교산 품번은 없을 수 있다", () => {
    assert.deepEqual(idsOf(filterPartOptions(rows, "서큘")), ["p2"]);
    assert.deepEqual(filterPartOptions(rows, "없는글자"), []);
  });

  test("후보는 상한까지만 — 수십 줄이 뜨면 밑이 가려 오히려 못 고른다", () => {
    const many: PartPickerRow[] = Array.from({ length: MAX_PART_SUGGESTIONS + 12 }, (_unused, i) => ({
      id: `m${i}`,
      partName: `부품 ${i}`,
      partSpec: null,
      drawingNo: null,
      kyosanPartNo: null,
    }));
    assert.equal(filterPartOptions(many, "부품").length, MAX_PART_SUGGESTIONS);
  });
});

describe("㉡ 고르면 붙고, 고쳐 쓰면 풀린다", () => {
  test("🔴 고르면 partId 가 채워진다 — 품명과 함께", () => {
    assert.deepEqual(partPickPatch(rows[0]), { partNameText: "마그네트론", partId: "p1" });
  });

  test("고른다고 수량 · 단가 · 규격까지 건드리지 않는다 — 채우는 것은 두 칸뿐이다", () => {
    assert.deepEqual(Object.keys(partPickPatch(rows[2])).sort(), ["partId", "partNameText"]);
  });

  test("🔴 폼은 고른 값을 한 번에 넣고 목록을 닫는다", () => {
    assert.ok(form.includes("updateItem( row.key, partPickPatch(option, {"), "고른 값을 줄에 넣는 곳이 없다");
    assert.ok(form.includes("}) ); setPartPickerKey(null); }}"), "고른 뒤 목록을 닫지 않는다");
  });

  test("🔴 손으로 고치면 partId 가 풀린다 — 그 규칙을 한 글자도 바꾸지 않았다", () => {
    assert.ok(
      form.includes("updateItem(row.key, { partNameText: e.target.value, partId: null });"),
      "글자를 칠 때 재고 연결을 푸는 곳이 없다"
    );
  });

  test("후보 목록은 **제 줄**에서만 펴진다 — 여러 줄이 한꺼번에 뜨면 서로를 가린다", () => {
    assert.ok(form.includes("{partPickerKey === row.key && !disabled && ( <QuotePartSuggestionList"));
    assert.ok(form.includes("options={filterPartOptions(partOptions, row.partNameText)}"));
  });

  test("🔴 자리표시 · 이름표의 번호 규칙은 그대로다 — 종류별로 세는 그 번호를 쓴다", () => {
    assert.ok(
      form.includes('placeholder={`${lineOrdinals[index]}번째 ${isCable ? "품목 품명" : "부품 품명"}`}'),
      "품명 칸의 자리표시가 바뀌었다"
    );
    assert.ok(
      form.includes('listLabel={`${lineOrdinals[index]}번째 ${isCable ? "품목" : "부품"} 후보`}'),
      "후보 목록의 이름표가 종류별 번호를 쓰지 않는다"
    );
  });
});

describe("㉢ 🔴 재고 · 소유구분 · 내부 비고가 화면 쪽으로 가지 않는다", () => {
  const pickerType = sliceBetween(inventory, "export type PartPickerRow = {", "};");
  const pickerQuery = sliceBetween(
    inventory,
    "export async function getPartPickerList(",
    "export type PartPickerPriceRow = {"
  );

  test("돌려주는 줄은 다섯 칸뿐이다 — id + 네 가지", () => {
    for (const field of ["id:", "partName:", "partSpec:", "drawingNo:", "kyosanPartNo:"]) {
      assert.ok(pickerType.includes(field), `${field} 가 없다`);
    }
    assert.equal(pickerType.split(":").length - 1, 5, `칸이 다섯이 아니다 — ${pickerType}`);
  });

  test("🔴 재고를 조인하지 않는다 — 실어 보낼 길 자체를 두지 않는다", () => {
    for (const forbidden of ["partStockBalances", "leftJoin", "innerJoin", "currentQuantity", "totalQuantity"]) {
      assert.ok(!pickerQuery.includes(forbidden), `새 조회에 '${forbidden}' 이 있다`);
    }
  });

  test("🔴 소유구분 · 내부 비고를 담지 않는다", () => {
    for (const forbidden of ["owner", "notes", "laborCost"]) {
      assert.ok(!pickerQuery.includes(forbidden), `새 조회에 '${forbidden}' 이 있다`);
    }
    assert.ok(!pickerType.includes("owner"), "줄에 소유구분이 있다");
    assert.ok(!pickerType.includes("notes"), "줄에 내부 비고가 있다");
  });

  test("지워진 부품은 빼고 읽는다", () => {
    assert.ok(pickerQuery.includes("eq(parts.isDeleted, false)"));
  });

  test("🔴 getPartList 는 그대로다 — 형제를 더했을 뿐이다", () => {
    // 재고 화면이 쓰는 그 조회는 여전히 잔량을 조인하고 합계를 싣는다.
    assert.ok(inventory.includes("export async function getPartList(filters: PartListFilters = {})"));
    const legacy = sliceBetween(inventory, "export async function getPartList(", "// ---- 부품 고르기 목록");
    assert.ok(legacy.includes(".leftJoin( partStockBalances,"), "getPartList 의 재고 조인이 사라졌다");
    assert.ok(legacy.includes("hasLedgerHistory: withHistory.has(row.id)"), "getPartList 의 결과가 바뀌었다");
  });

  test("🔴 그려 본 후보 목록에 재고 · 소유구분 · 비고가 없다", () => {
    const html = renderToStaticMarkup(
      <QuotePartSuggestionList options={rows} onPick={() => {}} listLabel="1번째 부품 후보" />
    );
    // 있어야 할 것 — 네 가지가 눈에 보인다.
    for (const shown of ["마그네트론", "2M244-M1", "DWG-1001", "KY-7788", "서큘레이터", "RG-393 3m"]) {
      assert.ok(html.includes(shown), `${shown} 이 후보에 안 보인다`);
    }
    // 없어야 할 것 — 재고 담당의 정보다.
    for (const hidden of ["재고", "가용", "소유", "비고", "DSS", "교산 보유"]) {
      assert.ok(!html.includes(hidden), `후보에 '${hidden}' 이 보인다`);
    }
  });

  test("후보가 없으면 아무것도 그리지 않는다 — 빈 상자가 칸 밑에 남지 않게", () => {
    assert.equal(
      renderToStaticMarkup(<QuotePartSuggestionList options={[]} onPick={() => {}} listLabel="1번째 부품 후보" />),
      ""
    );
  });

  test("꼬리표는 빈 칸을 건너뛰고 잇는다 — 무엇으로 찾았는지가 보여야 고를 수 있다", () => {
    assert.equal(partOptionDetail(rows[0]), "2M244-M1 · DWG-1001 · KY-7788");
    assert.equal(partOptionDetail(rows[1]), "ky-9900");
    assert.equal(partOptionDetail(rows[2]), "RG-393 3m · dwg-2002");
  });
});

describe("㉣ 마스터에 없는 이름도 그대로 적고 저장된다", () => {
  test("🔴 품명 칸은 여전히 자유 글자다 — 고르기만 되는 칸으로 바뀌지 않았다", () => {
    const nameField = sliceBetween(form, "value={row.partNameText} /** * 🔴 글자를 치면", "placeholder={`${lineOrdinals");
    assert.ok(!nameField.includes("readOnly"), "품명 칸이 읽기 전용이 되었다");
    assert.ok(!nameField.includes("disabled={true}"), "품명 칸이 잠겼다");
    assert.ok(nameField.includes("partNameText: e.target.value"), "친 글자가 그대로 들어가지 않는다");
  });

  test("저장에는 적힌 글자와 연결(null 일 수 있다)이 그대로 실린다", () => {
    const collect = sliceBetween(form, "items: items .filter((row) =>", "}), };");
    assert.ok(collect.includes("partId: row.partId,"), "연결을 그대로 보내지 않는다");
    assert.ok(collect.includes("partNameText: row.partNameText,"), "적힌 글자를 그대로 보내지 않는다");
  });

  test("설명 줄(케이블)에는 부품 후보를 달지 않는다 — 그 줄은 부품이 아니라 머리글이다", () => {
    const noteRow = sliceBetween(form, "> 설명 줄 </span>", "번째 설명 줄 지우기");
    assert.ok(!noteRow.includes("QuotePartSuggestionList"), "설명 줄에 부품 후보가 붙었다");
    assert.ok(
      noteRow.includes("onChange={(e) => updateItem(row.key, { partNameText: e.target.value })}"),
      "설명 줄의 입력이 바뀌었다"
    );
  });
});

describe("㉤ 두 페이지가 모두 목록을 넘긴다", () => {
  for (const [name, page] of [
    ["새 견적서", newPage],
    ["견적서 수정", editPage],
  ] as const) {
    test(`🔴 ${name} 화면이 가벼운 형제 조회를 읽어 폼에 넘긴다`, () => {
      assert.ok(
        page.includes(
          'import { getPartPickerList, getPartPickerUnitPrices } from "@/lib/db/queries/inventory";'
        ),
        "가벼운 형제 조회를 부르지 않는다"
      );
      assert.ok(!page.includes("getPartList("), "재고가 딸려 오는 조회를 부른다");
      assert.ok(page.includes("partOptions={partOptions}"), "폼에 목록을 넘기지 않는다");
    });

    test(`${name} 화면은 이미 도는 Promise.all 에 태운다 — 왕복을 늘리지 않는다`, () => {
      const parallel = sliceBetween(page, "await Promise.all([", "]);");
      assert.ok(parallel.includes("getPartPickerList(),"), "따로 기다린다");
    });

    test(`🔴 ${name} 화면이 단가 목록도 같은 묶음에서 읽어 넘긴다`, () => {
      const parallel = sliceBetween(page, "await Promise.all([", "]);");
      assert.ok(parallel.includes("getPartPickerUnitPrices(),"), "단가를 따로 기다린다 — 왕복이 늘었다");
      assert.ok(page.includes("partPrices={partPrices}"), "폼에 단가 목록을 넘기지 않는다");
    });
  }
});

/**
 * ============================================================================
 * ㉥ 🔴 고르면 단가도 채운다 — 틀린 금액이 나가지 않게
 * ============================================================================
 * 여기가 이 파일에서 가장 조심스러운 구역이다. 나머지는 잘못돼도 사람이 화면에서
 * 알아보지만, **단가는 잘못 채워져도 그럴듯해 보인다.** 그래서 「안 채운다」쪽을 다섯
 * 갈래로 나눠 못 박는다.
 * ============================================================================
 */
describe("㉥ 고르면 단가도 채운다", () => {
  test("단가가 있으면 채운다 — 소수점 두 자리는 지우고 넣는다", () => {
    assert.deepEqual(partPickPatch(rows[0], { prices }), {
      partNameText: "마그네트론",
      partId: "p1",
      unitPrice: "125000",
    });
  });

  test("🔴 단가를 정하지 않은 부품이면 **품명만** 채운다 — 빈칸이 곧 '미정'이다", () => {
    // p3 는 단가 목록에 아예 없다. 0 으로 채우면 그 부품이 0원으로 청구된다.
    assert.deepEqual(partPickPatch(rows[2], { prices }), {
      partNameText: "케이블 어셈블리",
      partId: "p3",
    });
    assert.equal(partPickUnitPrice("p3", { prices }), null);
  });

  test('🔴 `"0"` 은 0 으로 채운다 — 무상 부품이라는 실제 값이다(비우지 않는다)', () => {
    assert.equal(partPickUnitPrice("p2", { prices }), "0");
    assert.equal(partPickPatch(rows[1], { prices }).unitPrice, "0");
  });

  test("🔴 이미 값이 있으면 덮지 않는다 — 사람이 조정해 둔 금액이다", () => {
    assert.equal(partPickUnitPrice("p1", { prices, currentUnitPrice: "70000" }), null);
    const patch = partPickPatch(rows[0], { prices, currentUnitPrice: "70000" });
    assert.deepEqual(Object.keys(patch).sort(), ["partId", "partNameText"]);
    // 🔴 키가 아예 없어야 한다 — 빈 글자로 돌려주면 부어 넣는 쪽이 적힌 금액을 지운다.
    assert.ok(!("unitPrice" in patch), "단가 칸을 건드리는 값이 섞여 있다");
  });

  test("적힌 것이 공백뿐이면 빈칸으로 본다 — 그때는 채운다", () => {
    assert.equal(partPickUnitPrice("p1", { prices, currentUnitPrice: "   " }), "125000");
  });

  test("🔴 OH 줄은 O/H 단가를 쓴다 — 일반 단가가 있어도 그쪽을 보지 않는다", () => {
    assert.equal(partPickUnitPrice("p1", { prices, isOverhaulPart: true }), "98000");
    assert.equal(partPickPatch(rows[0], { prices, isOverhaulPart: true }).unitPrice, "98000");
  });

  test("🔴 OH 줄인데 O/H 단가가 없으면 **일반 단가로 때우지 않는다**", () => {
    // p2 는 일반 "0" · O/H 없음. 일반으로 때우면 0원이 찍히고, 아무도 못 알아본다.
    assert.equal(partPickUnitPrice("p2", { prices, isOverhaulPart: true }), null);
    assert.ok(!("unitPrice" in partPickPatch(rows[1], { prices, isOverhaulPart: true })));
  });

  test("🔴 단가 목록을 안 주면 지금까지 그대로다 — 선택이라는 뜻이다", () => {
    assert.deepEqual(partPickPatch(rows[0]), { partNameText: "마그네트론", partId: "p1" });
    assert.deepEqual(partPickPatch(rows[0], {}), { partNameText: "마그네트론", partId: "p1" });
    assert.equal(partPickUnitPrice("p1", {}), null);
    assert.equal(partPickUnitPrice("p1"), null);
  });

  test("🔴 고르개의 단가 입력 셋이 모두 물음표(선택)다 — 단가 칸 없는 화면도 같은 고르개를 쓴다", () => {
    const picker = flat(read("src/components/quotes/quote-part-picker.tsx"));
    const context = sliceBetween(picker, "export type PartPickPriceContext = {", "};");
    for (const optional of ["prices?:", "isOverhaulPart?:", "currentUnitPrice?:"]) {
      assert.ok(context.includes(optional), `${optional} 가 선택이 아니다`);
    }
    assert.ok(
      picker.includes("context: PartPickPriceContext = {}"),
      "두 번째 인자를 안 줘도 되게 두지 않았다"
    );
  });

  test("🔴 폼이 그 셋을 제대로 건넨다 — OH 표시 · 적힌 금액 · 단가 목록", () => {
    assert.ok(form.includes("prices: partPrices,"), "단가 목록을 안 건넨다");
    assert.ok(
      form.includes('isOverhaulPart: kind === "OVERHAUL" && row.isOverhaulPart,'),
      "OH 칸으로 갈 줄인지를 저장하는 규칙과 같은 식으로 보지 않는다"
    );
    assert.ok(form.includes("currentUnitPrice: row.unitPrice,"), "적혀 있는 금액을 안 건넨다");
  });

  test("🔴 단가 조회에도 재고 · 소유구분 · 비고가 없다", () => {
    const priceQuery = sliceBetween(
      inventory,
      "export async function getPartPickerUnitPrices(",
      "export async function listPartIdsWithLedgerHistory("
    );
    for (const forbidden of ["partStockBalances", "currentQuantity", "totalQuantity", "owner", "notes"]) {
      assert.ok(!priceQuery.includes(forbidden), `단가 조회에 '${forbidden}' 이 있다`);
    }
    assert.ok(priceQuery.includes("eq(parts.isDeleted, false)"), "지워진 부품이 섞인다");
    // 단가가 하나라도 있는 부품만 — 없는 것을 "0" 으로 채워 돌려주지 않는다.
    assert.ok(
      priceQuery.includes("or(isNotNull(partUnitPrices.unitPrice), isNotNull(partOverhaulUnitPrices.unitPrice))"),
      "단가 없는 부품까지 실어 보낸다"
    );
  });

  test("돌려주는 단가 줄은 세 칸뿐이다 — 부품 id + 값 둘", () => {
    const priceType = sliceBetween(inventory, "export type PartPickerPriceRow = {", "};");
    for (const field of ["partId:", "unitPrice:", "overhaulUnitPrice:"]) {
      assert.ok(priceType.includes(field), `${field} 가 없다`);
    }
    // 🔴 둘 다 null 일 수 있다 — "정하지 않았다"를 형에서부터 남겨 둔다.
    assert.equal(priceType.match(/string \| null/g)?.length, 2, `값 둘이 null 을 받지 않는다 — ${priceType}`);
  });
});
