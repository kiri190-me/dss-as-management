import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";

import {
  CUSTOMER_PART_NAME_REQUIRED_MESSAGE,
  MAX_PART_SUGGESTIONS,
  PartSuggestionList,
  canPickPartOption,
  filterPartOptions,
  partOptionDetail,
  partPickName,
  partPickPatch,
  partPickUnitPrice,
} from "@dss/core/ui/inventory/part-picker";
import type { PartPickerPriceRow, PartPickerRow } from "@dss/core/ui/inventory/part-picker-rows";
import { partFieldValue } from "@dss/core/ui/inventory/part-picker-rows";
import { quotePartNameEditPatch, quotePartPickPatch } from "@/components/quotes/quote-part-pick";
import {
  parseInventoryPartsResponse,
  toPartPickerOptions,
  toPartPickerPriceRows,
  toPartPickerRows,
  type InventoryPart,
} from "@/lib/domain/inventory-gateway";

/**
 * ============================================================================
 * 품명 칸에서 부품을 찾아 고른다 (2026-09-17 사용자 요청)
 * ============================================================================
 * 🔴 **재는 대상은 2026-09-22 부터 서브모듈(vendor/dss-core)의 파일이다.** 고르개를
 *    공용 묶음으로 옮겼다 — 견적서도 수리 건 상세도 쓰는 조각이라 A/S 안에 두면
 *    PO/내자가 붙이는 날 사본이 생긴다. **시험은 이 저장소에 남겨 둔다**: 그쪽 묶음에는
 *    시험 러너가 없고(그쪽 README 5절), A/S 의 시험 등록 검사가 최상위 `vendor/` 를
 *    건너뛰어 옮기면 아무 소리 없이 안 돌게 된다. 여기 두면 `npm run test:components`
 *    가 **이 사이트에서 실제로 도는 그 코드**를 본다(PO 의 responsive-list.test.ts 가
 *    먼저 쓴 방식이다). 형 선언을 이 파일에서 재수출로 가져오는 것도 같은 뜻이다 —
 *    A/S 조회가 내보내는 그 형으로 견준다.
 *
 * 거르기 · 고른 값 · 후보 목록의 생김새는 **실제로 돌려 본다**(part-picker.tsx 는
 * 서버 것을 하나도 끌고 오지 않는다 — 형 선언만 빌려 쓴다). 폼과 두 페이지는 서버
 * 액션을 부르는 클라이언트 컴포넌트라 이 환경에서 그려 볼 수 없어서, 이웃 시험
 * (quote-edit-cable.test.ts · quote-attachment-screens.test.ts)과 같이 **원본 글자**를
 * 읽어 규칙이 제자리에 있는지 본다.
 *
 * ── 🔴 2026-10-16 — **고르는 대상이 재고 관리의 부품으로 바뀌었다** ────────
 * 부품 마스터를 재고 관리 하나로 모으기로 한 2026-10-02 결정이다. A/S 의 부품 표는 다음
 * 조각에서 걷어내므로, 그때까지 고르개가 그 표를 보고 있으면 **견적서와 사용 부품이 함께
 * 멈춘다.** 바뀐 것은 **줄을 어디서 읽어 오는가** 하나이고(화면의 서버 쪽), 고르개는 여전히
 * 줄을 받아 그리기만 한다. 그래서 이 시험도 재는 자리를 옮겼다 — 조회(queries/inventory.ts)
 * 대신 **옮기는 함수**(domain/inventory-gateway.ts 의 toPartPickerRows)를 본다.
 *
 * ── 🔴 2026-10-27 — **이 폴더에 남은 유일한 파일이다** ─────────────────────
 * 그날 `components/inventory/` 의 옛 재고 화면 스물다섯과 `app/(app)/inventory/` 의 경로
 * 다섯이 지워졌다. **이 시험은 그 화면들을 하나도 재지 않는다** — 재는 것은 서브모듈의
 * 고르개(vendor/dss-core)와 견적서 폼 · 사용 부품 폼 · 견적서 두 페이지 · 수리 건 상세
 * 페이지이고, 그 전부가 **지금 돌고 있는 코드**다. 그래서 남겼다.
 *
 * 🔴 폴더 이름만 보고 함께 지우지 마라. 이름이 `inventory` 인 까닭은 재는 모듈의 자리가
 *    `@dss/core/ui/inventory/part-picker` 라서다 — A/S 의 옛 재고 기능과는 상관이 없다.
 *    이 파일이 여기 있어야 하는 까닭(그쪽 묶음에 시험 러너가 없다)은 위 2026-09-22 절에
 *    있고, vendor/dss-core/README.md 5절과 PO_DOMESTIC_SPLIT_DESIGN.md 도 이 자리를
 *    글자 그대로 가리키고 있다.
 *
 * 여기서 지키는 것 일곱:
 *
 *  ㉠ **다섯 가지로 거른다** — 품명 · 품명2(규격) · **고객사 품명** · 도번 · 교산 품번.
 *     재고 관리에서 찾던 대로 치면 여기서도 나와야 한다(저쪽 API.md 2절의 `q`).
 *  ㉡ **고른 결과를 어디에 적는가** — 🔴 재고 관리의 부품에는 A/S `parts.id` 가 없다.
 *     그래서 폼이 `part_id` 를 **비운다**. 이름을 고치면 풀리던 규칙은 그대로다.
 *  ㉢ 🔴 **재고 · 소유 · 비고가 화면 쪽으로 가지 않는다** — 옮기는 함수가 그 칸들을 아예
 *     담지 않는다(화면에서 안 그리는 것으로는 모자라다. props 는 이미 나간 뒤다).
 *  ㉣ **마스터에 없는 이름도 그대로 적힌다** — 케이블 부속처럼 재고에 없는 것을 손으로
 *     적는 길이 사라지면 안 된다.
 *  ㉤ **두 페이지가 모두 목록을 넘긴다** — 새로 만들 때도 고칠 때도 되어야 한다.
 *  ㉥ 🔴 **고르면 단가도 채운다**(2026-09-17, 값은 2026-10-16 부터 재고 관리의 견적가) —
 *     금액이 고객사로 나가는 자리라 여기서 못 박는 것이 넷이다: 적혀 있으면 덮지 않는다 ·
 *     null 은 빈칸 · `"0"` 은 0 · O/H 줄은 O/H 단가로만(없으면 안 채운다). 그리고 이 입력은
 *     **선택**이라 안 줘도 돌아간다 — 같은 고르개를 단가 칸 없는 화면이 쓴다.
 *  ㉦ 🔴 **못 받아 온 것을 「없다」로 그리지 않는다** — 갈래가 폼까지 그대로 가고, 화면은
 *     「확인하지 못했습니다」라고 말한다. 그래도 손으로 적는 길은 열려 있다.
 *  ㉧ 🔴 **견적서에 적히는 품명은 고객사 품명이다**(2026-10-16 사용자 요청 A) — 그리고 그
 *     이름이 **없는 부품은 고를 수 없다**(사용자 결정). 🔵 그 둘은 **견적서에서만**이다:
 *     사용 부품은 내부 기록이라 지금까지대로 우리 품명으로 적고 막지도 않는다. 🔴 고르개는
 *     PO/내자와 한 벌이라 그 사정이 **받는 값 하나**(`nameSource`)로만 들어온다 — 아무것도
 *     안 넘기는 사이트는 한 글자도 달라지지 않아야 한다.
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
/* 🔴 2026-10-16 부터 견적서는 고른 값을 **제 규칙 한 겹**을 거쳐 붓는다(요청 ①·②). 고르개에
   그 사정을 박지 않으려고 A/S 쪽에 둔 순수 모듈이다. */
const quotePartPick = flat(read("src/components/quotes/quote-part-pick.ts"));
const usedPartsForm = flat(read("src/components/repair-cases/detail/edit/UsedPartsEditForm.tsx"));
const inventory = flat(read("src/lib/db/queries/inventory.ts"));
/* 🔴 줄의 모양(형 둘)은 2026-09-22 부터 고르개 곁 — 서브모듈에 있다. 값을 실어 오는 일은
   2026-10-16 부터 재고 관리 쪽이고(domain/inventory-gateway.ts), 아래 ㉢ 은 그 **옮기는
   함수**를 실제로 돌려 본다. */
const pickerRows = flat(read("vendor/dss-core/src/ui/inventory/part-picker-rows.ts"));
const newPage = flat(read("src/app/(app)/quotes/new/page.tsx"));
const editPage = flat(read("src/app/(app)/quotes/[id]/page.tsx"));
const casePage = flat(read("src/app/(app)/repair-cases/[id]/page.tsx"));

const rows: PartPickerRow[] = [
  {
    id: "11",
    partName: "마그네트론",
    partSpec: "2M244-M1",
    customerPartName: "발진관 조립품",
    drawingNo: "DWG-1001",
    kyosanPartNo: "KY-7788",
  },
  { id: "12", partName: "서큘레이터", partSpec: null, customerPartName: "", drawingNo: null, kyosanPartNo: "ky-9900" },
  {
    id: "13",
    partName: "케이블 어셈블리",
    partSpec: "RG-393 3m",
    customerPartName: "",
    drawingNo: "dwg-2002",
    kyosanPartNo: null,
  },
];
const idsOf = (list: readonly PartPickerRow[]) => list.map((row) => row.id);

/**
 * 재고 관리가 돌려주는 부품 줄(저쪽 API.md 2절의 모양). 🔴 **값은 전부 지어낸 것이다** —
 * 실제 고객사 · 모델 · L/N · S/N 은 공개 저장소에 적지 않는다.
 *
 *  · 11 — 다 들어 있다(견적가 · O/H 견적가 둘 다)
 *  · 12 — **견적가가 `0`(무상)이고 O/H 는 `null`**(정하지 않았다)
 *  · 13 — 둘 다 `null` — 단가 줄에 아예 오르지 않는다
 */
const INVENTORY_PARTS: InventoryPart[] = parseInventoryPartsResponse({
  parts: [
    {
      no: 11,
      name: "마그네트론",
      name2: "2M244-M1",
      customerName: "발진관 조립품",
      kyosanPartNo: "KY-7788",
      drawingNo: "DWG-1001",
      quantity: 7,
      note: "수리소 관리용\n두 번째 줄",
      owner: { code: "SERVICE_SPARE", label: "보수부재" },
      quotePrice: 125000,
      overhaulQuotePrice: 98000,
    },
    {
      no: 12,
      name: "서큘레이터",
      name2: "",
      customerName: "",
      kyosanPartNo: "ky-9900",
      drawingNo: "",
      quantity: 0,
      note: "",
      owner: { code: "DSS", label: "DSS" },
      quotePrice: 0,
      overhaulQuotePrice: null,
    },
    {
      no: 13,
      name: "케이블 어셈블리",
      name2: "RG-393 3m",
      customerName: "",
      kyosanPartNo: "",
      drawingNo: "dwg-2002",
      quantity: 3,
      note: "",
      owner: { code: "KYOSAN", label: "교산 보유" },
      quotePrice: null,
      overhaulQuotePrice: null,
    },
  ],
}) as InventoryPart[];

/**
 * 단가 목록 — 🔴 **손으로 적지 않고 옮기는 함수에게 만들게 한다.** 화면이 실제로 받는 값과
 * 같아야 「0 과 없음」이 어디서 뒤집혀도 여기서 붉어진다.
 *
 *  · 11 — 견적가 · O/H 견적가 둘 다 있다
 *  · 12 — **견적가가 `"0"`(무상)이고 O/H 는 없다** — 0 을 채우는 길과 O/H 를 안 채우는 길
 *  · 13 — 목록에 아예 없다(단가를 하나도 정하지 않은 부품)
 */
const prices: PartPickerPriceRow[] = toPartPickerPriceRows(INVENTORY_PARTS);

describe("㉠ 다섯 가지로 거른다 — 품명 · 품명2(규격) · 고객사 품명 · 도번 · 교산 품번", () => {
  test("품명으로 찾는다", () => {
    assert.deepEqual(idsOf(filterPartOptions(rows, "마그네")), ["11"]);
  });

  test("품명2(규격)로 찾는다 — 대소문자를 가리지 않는다", () => {
    assert.deepEqual(idsOf(filterPartOptions(rows, "2M244")), ["11"]);
    assert.deepEqual(idsOf(filterPartOptions(rows, "2m244")), ["11"]);
  });

  test("🔴 고객사 품명으로 찾는다 — 2026-10-16 에 더한 그 칸이다", () => {
    // 고객사에 나가는 서류에 쓰는 이름이라 사람이 그 글자로 찾는데, 지금까지는 아무것도
    // 나오지 않았다. 우리 품명(마그네트론)과 다른 글자로 같은 줄이 나와야 한다.
    assert.deepEqual(idsOf(filterPartOptions(rows, "발진관")), ["11"]);
    assert.deepEqual(idsOf(filterPartOptions(rows, "조립품")), ["11"]);
  });

  test("🔴 재고 관리에서 받아 온 줄도 고객사 품명으로 찾아진다 — 옮기는 자리까지 이어진다", () => {
    // 옮기는 함수가 그 칸을 빠뜨리면 거르기는 멀쩡한데 화면에서만 안 나온다.
    const picked = filterPartOptions(toPartPickerRows(INVENTORY_PARTS), "발진관");
    assert.deepEqual(picked.map((row) => row.partName), ["마그네트론"]);
  });

  test("도번으로 찾는다 — 적힌 것이 소문자여도 대문자로 쳐서 찾는다", () => {
    assert.deepEqual(idsOf(filterPartOptions(rows, "DWG-2002")), ["13"]);
  });

  test("교산 품번으로 찾는다", () => {
    assert.deepEqual(idsOf(filterPartOptions(rows, "ky-77")), ["11"]);
    assert.deepEqual(idsOf(filterPartOptions(rows, "KY-9900")), ["12"]);
  });

  test("🔴 빈 글자에는 아무것도 뜨지 않는다 — 칸을 누르자마자 목록이 밑줄을 가리면 안 된다", () => {
    assert.deepEqual(filterPartOptions(rows, ""), []);
    assert.deepEqual(filterPartOptions(rows, "   "), []);
  });

  test("비어 있는 칸(null)이 섞여 있어도 터지지 않는다 — 규격 · 도번 · 교산 품번은 없을 수 있다", () => {
    assert.deepEqual(idsOf(filterPartOptions(rows, "서큘")), ["12"]);
    assert.deepEqual(filterPartOptions(rows, "없는글자"), []);
  });

  test("🔴 고객사 품명 칸이 아예 없는 줄도 그대로 걸린다 — 제 표에서 읽는 사이트가 그렇다", () => {
    // 서브모듈을 함께 쓰는 PO/내자는 이 칸을 주지 않는다. 선택이 아니게 되면 그쪽이 깨진다.
    const withoutCustomerName: PartPickerRow[] = [
      { id: "x1", partName: "전원 모듈", partSpec: null, drawingNo: null, kyosanPartNo: null },
    ];
    assert.deepEqual(idsOf(filterPartOptions(withoutCustomerName, "전원")), ["x1"]);
  });

  test("후보는 상한까지만 — 수십 줄이 뜨면 밑이 가려 오히려 못 고른다", () => {
    const many: PartPickerRow[] = Array.from({ length: MAX_PART_SUGGESTIONS + 12 }, (_unused, i) => ({
      id: `m${i}`,
      partName: `부품 ${i}`,
      partSpec: null,
      customerPartName: null,
      drawingNo: null,
      kyosanPartNo: null,
    }));
    assert.equal(filterPartOptions(many, "부품").length, MAX_PART_SUGGESTIONS);
  });
});

describe("㉡ 고른 결과를 어디에 적는가 — 고쳐 쓰면 풀리는 규칙은 그대로다", () => {
  test("고르개는 고른 줄의 id 와 품명을 돌려준다 — 어디에 적을지는 폼이 정한다", () => {
    assert.deepEqual(partPickPatch(rows[0]), { partNameText: "마그네트론", partId: "11" });
  });

  test("고른다고 수량 · 단가 · 규격까지 건드리지 않는다 — 채우는 것은 두 칸뿐이다", () => {
    assert.deepEqual(Object.keys(partPickPatch(rows[2])).sort(), ["partId", "partNameText"]);
  });

  test("🔴 폼 둘 다 part_id 를 **비운다** — 재고 관리 부품에는 A/S 부품 번호가 없다", () => {
    /**
     * 🔴 재고 관리의 부품 번호(No.)를 `part_id` 에 넣으면 저장이 거절된다 — 그 칸을 보는
     *    검사기가 UUID 를 요구한다(validation/quote-input.ts ·
     *    validation/repair-case-used-parts-input.ts). 비어도 되는 칸이고, 품명은 글자로
     *    따로 저장되므로 화면 · 인쇄 · 옛 줄은 그대로다.
     */
    assert.ok(
      form.includes("updateItem( row.key, quotePartPickPatch(row, option, {"),
      "견적서 폼이 고른 값을 줄에 넣는 곳이 없다"
    );
    assert.ok(
      form.includes("}) ); setPartPickerKey(null); }}"),
      "견적서 폼이 고른 뒤 목록을 닫지 않는다"
    );
    /* 🔴 2026-10-16 부터 견적서는 고른 값을 **제 규칙 한 겹**을 거쳐 붓는다(요청 ②) —
       `part_id` 를 비우는 일도 그 함수가 한다. 형에서부터 `null` 뿐이라 다른 값이 들어갈
       길이 없고(`partId: null` 리터럴 형), 아래 시험이 실제로 돌려 보고 확인한다. */
    assert.deepEqual(
      quotePartPickPatch({ partNameText: "", unitPrice: "", pickedPart: null }, rows[0]).partId,
      null,
      "견적서 쪽 규칙이 part_id 를 비우지 않는다"
    );
    assert.ok(
      usedPartsForm.includes("updateLine(line.key, { ...partPickPatch(option),"),
      "사용 부품 폼이 고른 값을 줄에 넣는 곳이 없다"
    );
    assert.ok(
      usedPartsForm.includes("partId: null, }); setPickerKey(null); }}"),
      "사용 부품 폼이 part_id 를 비우지 않거나 고른 뒤 목록을 닫지 않는다"
    );
  });

  test("🔴 손으로 고치면 partId 가 풀린다 — 그 규칙을 한 글자도 바꾸지 않았다", () => {
    /**
     * 🔵 2026-10-16 부터 품명 칸의 onChange 는 **조각 하나를 받아** 붓는다
     * (`quotePartNameEditPatch` — 상세가 사라지면 단가도 비우는 규칙이 붙었다). 🔴 그래도
     * **재고 연결을 푸는 일은 그대로**여야 한다 — 형에서부터 `partId: null` 뿐이고, 아래가
     * 실제로 돌려 보고 확인한다.
     */
    assert.ok(
      form.includes("updateItem(row.key, quotePartNameEditPatch(row, e.target.value));"),
      "글자를 칠 때 줄에 붓는 곳이 없다"
    );
    for (const row of [
      { partNameText: "", unitPrice: "", pickedPart: null },
      { partNameText: "발진관 조립품", unitPrice: "125000", pickedPart: { id: "11", nameText: "발진관 조립품" } },
    ]) {
      assert.equal(
        quotePartNameEditPatch(row, "손으로 고친 이름").partId,
        null,
        "글자를 칠 때 재고 연결이 풀리지 않는다"
      );
    }
  });

  test("후보 목록은 **제 줄**에서만 펴진다 — 여러 줄이 한꺼번에 뜨면 서로를 가린다", () => {
    assert.ok(form.includes("{partPickerKey === row.key && !disabled && ( <PartSuggestionList"));
    assert.ok(form.includes("options={filterPartOptions(partOptionRows, row.partNameText)}"));
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

describe("㉢ 🔴 재고 · 소유 · 비고가 화면 쪽으로 가지 않는다", () => {
  const pickerType = sliceBetween(pickerRows, "export type PartPickerRow = {", "};");

  test("돌려주는 줄은 여섯 칸뿐이다 — id + 다섯 가지", () => {
    for (const field of ["id:", "partName:", "partSpec:", "customerPartName?:", "drawingNo:", "kyosanPartNo:"]) {
      assert.ok(pickerType.includes(field), `${field} 가 없다`);
    }
    assert.equal(pickerType.split(":").length - 1, 6, `칸이 여섯이 아니다 — ${pickerType}`);
  });

  test("🔴 옮기는 함수가 재고 · 소유 · 비고를 **아예 담지 않는다** — props 는 브라우저로 나간다", () => {
    // 받아 온 쪽(InventoryPart)에는 그 셋이 들어 있다. 화면에서 안 그리는 것으로는
    // 모자라다 — 여기서 떼어 내야 나가지 않는다.
    const mapped = toPartPickerRows(INVENTORY_PARTS);
    assert.deepEqual(
      Object.keys(mapped[0]).sort(),
      ["customerPartName", "drawingNo", "id", "kyosanPartNo", "partName", "partSpec"],
      "칸이 늘었다 — 재고 담당의 정보가 견적서 화면으로 흘러간다"
    );
    const asText = JSON.stringify(mapped);
    for (const forbidden of ["보수부재", "교산 보유", "수리소 관리용", "quantity", "owner", "note"]) {
      assert.ok(!asText.includes(forbidden), `옮긴 줄에 '${forbidden}' 이 있다`);
    }
  });

  test("🔴 단가 줄에도 재고 · 소유 · 비고가 없다 — 열쇠와 값 둘뿐이다", () => {
    assert.deepEqual(
      Object.keys(toPartPickerPriceRows(INVENTORY_PARTS)[0]).sort(),
      ["overhaulUnitPrice", "partId", "unitPrice"]
    );
  });

  test("🔴 열쇠는 재고 관리의 부품 번호(No.)다 — A/S 의 UUID 가 아니다", () => {
    // 저쪽이 바깥에 내주는 값이 그것이다(API.md 2절). 줄과 단가의 열쇠가 같아야 짝이 맞는다.
    assert.deepEqual(toPartPickerRows(INVENTORY_PARTS).map((row) => row.id), ["11", "12", "13"]);
    assert.deepEqual(toPartPickerPriceRows(INVENTORY_PARTS).map((row) => row.partId), ["11", "12"]);
  });

  test("🔴 getPartList 는 그대로다 — 재고 화면이 쓰는 조회는 건드리지 않았다", () => {
    // 재고 화면이 쓰는 그 조회는 여전히 잔량을 조인하고 합계를 싣는다.
    assert.ok(inventory.includes("export async function getPartList(filters: PartListFilters = {})"));
    const legacy = sliceBetween(inventory, "export async function getPartList(", "// ---- 부품 고르기 목록");
    assert.ok(legacy.includes(".leftJoin( partStockBalances,"), "getPartList 의 재고 조인이 사라졌다");
    assert.ok(legacy.includes("hasLedgerHistory: withHistory.has(row.id)"), "getPartList 의 결과가 바뀌었다");
  });

  test("🔴 그려 본 후보 목록에 재고 · 소유구분 · 비고가 없다", () => {
    const html = renderToStaticMarkup(
      <PartSuggestionList
        options={toPartPickerRows(INVENTORY_PARTS)}
        onPick={() => {}}
        listLabel="1번째 부품 후보"
      />
    );
    // 있어야 할 것 — 다섯 가지가 눈에 보인다(고객사 품명까지. 그 글자로 찾은 줄이라
    // 꼬리표에 없으면 사람은 왜 이 줄이 떴는지 모른다).
    for (const shown of ["마그네트론", "2M244-M1", "발진관 조립품", "DWG-1001", "KY-7788", "서큘레이터"]) {
      assert.ok(html.includes(shown), `${shown} 이 후보에 안 보인다`);
    }
    // 없어야 할 것 — 재고 담당의 정보다.
    for (const hidden of ["재고", "가용", "소유", "비고", "보수부재", "교산 보유", "수리소 관리용"]) {
      assert.ok(!html.includes(hidden), `후보에 '${hidden}' 이 보인다`);
    }
  });

  test("후보가 없으면 아무것도 그리지 않는다 — 빈 상자가 칸 밑에 남지 않게", () => {
    assert.equal(
      renderToStaticMarkup(<PartSuggestionList options={[]} onPick={() => {}} listLabel="1번째 부품 후보" />),
      ""
    );
  });

  test("꼬리표는 빈 칸을 건너뛰고 잇는다 — 무엇으로 찾았는지가 보여야 고를 수 있다", () => {
    /* 🔴 2026-10-16 요청 ③ 으로 차례가 **품명2 · 교산 품번 · 도번**이 되었다(고객사 품명과
       품명은 줄의 머리라 꼬리표에 오지 않는다 — 아래 ㉩ 이 다섯 자리를 함께 잰다). */
    assert.equal(partOptionDetail(rows[0]), "2M244-M1 · KY-7788 · DWG-1001");
    assert.equal(partOptionDetail(rows[1]), "ky-9900");
    assert.equal(partOptionDetail(rows[2]), "RG-393 3m · dwg-2002");
  });
});

describe("㉣ 마스터에 없는 이름도 그대로 적고 저장된다", () => {
  test("🔴 품명 칸은 여전히 자유 글자다 — 고르기만 되는 칸으로 바뀌지 않았다", () => {
    const nameField = sliceBetween(form, "value={row.partNameText} /** * 🔴 글자를 치면", "placeholder={`${lineOrdinals");
    assert.ok(!nameField.includes("readOnly"), "품명 칸이 읽기 전용이 되었다");
    assert.ok(!nameField.includes("disabled={true}"), "품명 칸이 잠겼다");
    /**
     * 🔵 2026-10-16 부터 친 글자는 조각(`quotePartNameEditPatch`)을 거쳐 줄에 들어간다. 🔴 그
     * 조각은 글자를 **손질하지 않는다** — 다듬거나 자르면 사람이 적는 이름이 제 글자가 아니게
     * 된다(앞뒤 공백은 「같은 이름인가」를 **잴 때만** 무시하고, 적히는 값은 친 그대로다).
     */
    assert.ok(nameField.includes("quotePartNameEditPatch(row, e.target.value)"), "친 글자가 줄로 안 간다");
    for (const typed of ["마", "마그", "  앞뒤 공백 ", ""]) {
      assert.equal(
        quotePartNameEditPatch({ partNameText: "앞 글자", unitPrice: "", pickedPart: null }, typed).partNameText,
        typed,
        "친 글자가 그대로 들어가지 않는다"
      );
    }
  });

  test("저장에는 적힌 글자와 연결(null 일 수 있다)이 그대로 실린다", () => {
    const collect = sliceBetween(form, "items: items .filter((row) =>", "}), };");
    assert.ok(collect.includes("partId: row.partId,"), "연결을 그대로 보내지 않는다");
    assert.ok(collect.includes("partNameText: row.partNameText,"), "적힌 글자를 그대로 보내지 않는다");
  });

  test("설명 줄(케이블)에는 부품 후보를 달지 않는다 — 그 줄은 부품이 아니라 머리글이다", () => {
    const noteRow = sliceBetween(form, "> 설명 줄 </span>", "번째 설명 줄 지우기");
    assert.ok(!noteRow.includes("PartSuggestionList"), "설명 줄에 부품 후보가 붙었다");
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
    test(`🔴 ${name} 화면이 **재고 관리**에서 부품을 받아 폼에 넘긴다`, () => {
      assert.ok(
        page.includes('import { fetchInventoryParts } from "@/lib/server/inventory-gateway";'),
        "재고 관리를 부르는 그 자리를 쓰지 않는다 — 새로 만들지 않기로 한 통로다"
      );
      assert.ok(!page.includes("getPartPickerList("), "A/S 부품 표를 아직 읽는다");
      assert.ok(!page.includes("getPartList("), "재고가 딸려 오는 조회를 부른다");
      assert.ok(page.includes("partOptions={partOptions}"), "폼에 목록을 넘기지 않는다");
      assert.ok(
        page.includes("const partOptions = toPartPickerOptions(inventoryParts);"),
        "고르개의 줄로 옮기지 않는다"
      );
    });

    test(`${name} 화면은 이미 도는 Promise.all 에 태운다 — 왕복을 늘리지 않는다`, () => {
      const parallel = sliceBetween(page, "await Promise.all([", "]);");
      assert.ok(parallel.includes("fetchInventoryParts(),"), "따로 기다린다");
      assert.equal(page.match(/fetchInventoryParts\(/g)?.length, 1, "통로를 두 번 두드린다");
    });

    test(`🔴 ${name} 화면이 단가도 **같은 응답**에서 뽑아 넘긴다 — 통로를 또 부르지 않는다`, () => {
      assert.ok(
        page.includes(
          'const partPrices = inventoryParts.status === "ok" ? toPartPickerPriceRows(inventoryParts.value) : [];'
        ),
        "단가를 같은 응답에서 뽑지 않는다"
      );
      assert.ok(page.includes("partPrices={partPrices}"), "폼에 단가 목록을 넘기지 않는다");
    });

    test(`🔴 ${name} 화면이 **못 받아 온 것을 빈 목록으로 바꾸지 않는다**`, () => {
      // 갈래째 넘겨야 폼이 「없습니다」와 「확인하지 못했습니다」를 가를 수 있다.
      assert.ok(
        !/partOptions = .{0,80}status === "ok" \? .{0,60} : \[\]/.test(page),
        "부품 목록을 빈 목록으로 접는 줄이 있다"
      );
    });
  }

  test("🔴 수리 건 상세도 재고 관리에서 받아 「사용 부품」 칸에 넘긴다", () => {
    assert.ok(
      casePage.includes('import { fetchInventoryParts } from "@/lib/server/inventory-gateway";'),
      "수리 건 상세가 재고 관리를 부르지 않는다"
    );
    assert.ok(!casePage.includes("getPartPickerList("), "A/S 부품 표를 아직 읽는다");
    // 🔵 부품 요청 칸이 이미 받아 왔으면 그 목록을 그대로 쓴다 — 한 화면에서 같은 통로를
    //    두 번 두드리지 않는다. 그 칸이 없는 사람에게는 여기서 한 번 부른다.
    assert.ok(
      casePage.includes("partRequestData?.parts ?? fetchInventoryParts()"),
      "받아 둔 목록을 두고 또 부르거나, 아예 안 부른다"
    );
    assert.ok(
      casePage.includes("const usedPartOptions = toPartPickerOptions(usedPartInventory);"),
      "고르개의 줄로 옮기지 않는다"
    );
    assert.ok(casePage.includes("usedPartOptions={usedPartOptions}"), "화면에 넘기지 않는다");
  });
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
      partId: "11",
      unitPrice: "125000",
    });
  });

  test("🔴 단가를 정하지 않은 부품이면 **품명만** 채운다 — 빈칸이 곧 '미정'이다", () => {
    // 13번은 단가 목록에 아예 없다. 0 으로 채우면 그 부품이 0원으로 청구된다.
    assert.deepEqual(partPickPatch(rows[2], { prices }), {
      partNameText: "케이블 어셈블리",
      partId: "13",
    });
    assert.equal(partPickUnitPrice("13", { prices }), null);
  });

  test('🔴 `"0"` 은 0 으로 채운다 — 무상 부품이라는 실제 값이다(비우지 않는다)', () => {
    assert.equal(partPickUnitPrice("12", { prices }), "0");
    assert.equal(partPickPatch(rows[1], { prices }).unitPrice, "0");
  });

  test("🔴 이미 값이 있으면 덮지 않는다 — 사람이 조정해 둔 금액이다", () => {
    assert.equal(partPickUnitPrice("11", { prices, currentUnitPrice: "70000" }), null);
    const patch = partPickPatch(rows[0], { prices, currentUnitPrice: "70000" });
    assert.deepEqual(Object.keys(patch).sort(), ["partId", "partNameText"]);
    // 🔴 키가 아예 없어야 한다 — 빈 글자로 돌려주면 부어 넣는 쪽이 적힌 금액을 지운다.
    assert.ok(!("unitPrice" in patch), "단가 칸을 건드리는 값이 섞여 있다");
  });

  test("적힌 것이 공백뿐이면 빈칸으로 본다 — 그때는 채운다", () => {
    assert.equal(partPickUnitPrice("11", { prices, currentUnitPrice: "   " }), "125000");
  });

  test("🔴 OH 줄은 O/H 단가를 쓴다 — 일반 단가가 있어도 그쪽을 보지 않는다", () => {
    assert.equal(partPickUnitPrice("11", { prices, isOverhaulPart: true }), "98000");
    assert.equal(partPickPatch(rows[0], { prices, isOverhaulPart: true }).unitPrice, "98000");
  });

  test("🔴 OH 줄인데 O/H 단가가 없으면 **일반 단가로 때우지 않는다**", () => {
    // 12번은 일반 "0" · O/H 없음. 일반으로 때우면 0원이 찍히고, 아무도 못 알아본다.
    assert.equal(partPickUnitPrice("12", { prices, isOverhaulPart: true }), null);
    assert.ok(!("unitPrice" in partPickPatch(rows[1], { prices, isOverhaulPart: true })));
  });

  test("🔴 단가 목록을 안 주면 지금까지 그대로다 — 선택이라는 뜻이다", () => {
    assert.deepEqual(partPickPatch(rows[0]), { partNameText: "마그네트론", partId: "11" });
    assert.deepEqual(partPickPatch(rows[0], {}), { partNameText: "마그네트론", partId: "11" });
    assert.equal(partPickUnitPrice("11", {}), null);
    assert.equal(partPickUnitPrice("11"), null);
  });

  test("🔴 고르개의 단가 입력 셋이 모두 물음표(선택)다 — 단가 칸 없는 화면도 같은 고르개를 쓴다", () => {
    const picker = flat(read("vendor/dss-core/src/ui/inventory/part-picker.tsx"));
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
    /**
     * 🔴 「적혀 있는 금액」은 2026-10-16 부터 **폼이 아니라 견적서 쪽 규칙**이 건넨다 —
     *    줄이 기억하는 부품과 견주어야 「덮지 않는다」와 「따라간다」가 갈리기 때문이다
     *    (요청 ② · quote-part-pick.ts). 🔵 고르개의 그 입력(`currentUnitPrice`)이 사라진
     *    것이 아니다: 그 함수가 제 안에서 건넨다. 여기서는 **두 곳에 흩어지지 않았는지**만 본다.
     */
    assert.ok(
      !form.includes("currentUnitPrice:"),
      "폼이 적힌 금액을 직접 건넨다 — 「바뀌면 따라간다」 판단이 두 곳으로 갈렸다"
    );
    assert.ok(
      quotePartPick.includes("currentUnitPrice: same ? row.unitPrice : \"\","),
      "견적서 쪽 규칙이 적힌 금액을 고르개에 건네지 않는다"
    );
  });

  test("🔴 옮기는 자리에서 `null` 과 `0` 이 뒤집히지 않는다 — 여기가 틀리면 아무도 못 알아본다", () => {
    /**
     * 🔴 저쪽이 둘을 갈라 적어 보낸다(API.md 2절): 숫자는 그 금액, `0` 은 **무상**,
     *    `null` 은 **아직 정하지 않음**. `?? 0` 으로 뭉개면 정하지 않은 부품이 0원으로
     *    청구되고, `|| null` 로 뭉개면 무상으로 정해 둔 0 이 「안 정함」으로 뒤집힌다.
     */
    const byNo = new Map(toPartPickerPriceRows(INVENTORY_PARTS).map((row) => [row.partId, row]));
    assert.deepEqual(byNo.get("11"), { partId: "11", unitPrice: "125000", overhaulUnitPrice: "98000" });
    assert.deepEqual(byNo.get("12"), { partId: "12", unitPrice: "0", overhaulUnitPrice: null });
    // 둘 다 없는 부품은 아예 빠진다 — 고르개는 「줄이 없다 = 정하지 않았다」로 읽는다.
    assert.equal(byNo.has("13"), false, "단가를 하나도 정하지 않은 부품까지 실어 보낸다");
  });

  test("돌려주는 단가 줄은 세 칸뿐이다 — 부품 id + 값 둘", () => {
    const priceType = sliceBetween(pickerRows, "export type PartPickerPriceRow = {", "};");
    for (const field of ["partId:", "unitPrice:", "overhaulUnitPrice:"]) {
      assert.ok(priceType.includes(field), `${field} 가 없다`);
    }
    // 🔴 둘 다 null 일 수 있다 — "정하지 않았다"를 형에서부터 남겨 둔다.
    assert.equal(priceType.match(/string \| null/g)?.length, 2, `값 둘이 null 을 받지 않는다 — ${priceType}`);
  });

  test("🔴 못 받아 왔으면 단가를 채우지 않는다 — 빈 목록이 곧 「정하지 않았다」다", () => {
    // 페이지가 못 받아 왔을 때 넘기는 값이 빈 목록이다. 그때 0 이 부어지면 0원짜리
    // 견적서가 조용히 나간다.
    assert.equal(partPickUnitPrice("11", { prices: [] }), null);
    assert.ok(!("unitPrice" in partPickPatch(rows[0], { prices: [] })));
  });
});

/**
 * ============================================================================
 * ㉦ 🔴 못 받아 온 것을 「없다」로 그리지 않는다
 * ============================================================================
 * 재고 관리가 꺼져 있거나 늦거나 토큰이 틀리면 고를 부품이 없다. 그때 화면이 「부품이
 * 없습니다」라고 말하면 **사람은 그 말을 믿고 넘어간다** — 멀쩡히 있는 부품을 두고.
 * 그래서 갈래를 폼까지 그대로 나르고, 폼은 **까닭을 적는다.**
 * 🔵 그러면서도 **손으로 적는 길은 막지 않는다** — 재고 관리가 꺼져 있다고 견적서를 못
 *    쓰게 되면 그것이 더 큰 사고다(그 길은 ㉣ 이 지킨다).
 * ============================================================================
 */
describe("㉦ 못 받아 왔을 때 — 「없음」이 아니라 「확인 못 함」", () => {
  test("🔴 옮기는 함수가 실패 갈래를 **그대로** 넘긴다 — 빈 목록으로 바꾸지 않는다", () => {
    assert.deepEqual(toPartPickerOptions({ status: "unreachable", reason: "timeout" }), {
      status: "unreachable",
      reason: "timeout",
    });
    // 🔵 200 에 빈 목록이 온 것은 **사실**이다 — 이것만 ok 다.
    assert.deepEqual(toPartPickerOptions({ status: "ok", value: [] }), { status: "ok", value: [] });
  });

  for (const [name, source] of [
    ["견적서", form],
    ["사용 부품", usedPartsForm],
  ] as const) {
    test(`🔴 ${name} 폼이 까닭을 적는다 — 「없습니다」라고 말하지 않는다`, () => {
      assert.ok(source.includes('{partOptions.status !== "ok" && ('), "못 받아 온 갈래를 그리지 않는다");
      assert.ok(
        source.includes("재고 관리의 부품 목록을 불러오지 못했습니다 — {inventoryUnreachableMessage(partOptions.reason)}"),
        "까닭(저쪽이 왜 안 됐는지)을 적지 않는다"
      );
      assert.ok(
        source.includes("<b>없는 것이 아니라 확인하지 못한 것</b>입니다."),
        "「없다」와 「모른다」를 가르는 문장이 없다"
      );
    });

    test(`🔴 ${name} 폼은 빈 목록으로 접는 자리가 **한 곳**뿐이다 — 후보가 받는 값`, () => {
      assert.ok(
        source.includes('partOptions.status === "ok" ? partOptions.value : []'),
        "후보 목록에 넘길 줄을 고르는 자리가 없다"
      );
      assert.equal(
        source.match(/partOptions\.status === "ok" \? partOptions\.value : \[\]/g)?.length,
        1,
        "빈 목록으로 접는 자리가 둘이다 — 한 곳은 까닭을 잃는다"
      );
    });
  }

  test("🔴 사용 부품 칸에는 단가를 **아예 넘기지 않는다** — 금액이 나갈 자리가 아니다", () => {
    assert.ok(!usedPartsForm.includes("partPrices"), "사용 부품 폼으로 단가가 흘러간다");
    assert.ok(!usedPartsForm.includes("prices:"), "사용 부품 폼이 고르개에 단가를 건넨다");
  });
});

/**
 * ============================================================================
 * ㉧ 🔴 견적서의 품명 = **고객사 품명**, 없으면 **못 고른다** (2026-10-16)
 * ============================================================================
 * 사용자 요청 A 와 그날의 결정이다. 견적서는 **고객사로 나가는 종이**이고, 고객사는 제 이름으로
 * 부품을 부른다 — 우리 품명을 적어 보내면 받는 쪽이 무엇인지 모른다. 그 이름이 비어 있으면
 * 고를 수 없게 막고 「고객사 품명을 설정해 주세요」를 그 줄에 적는다.
 *
 * 여기서 못 박는 것 다섯:
 *  ㉠ **줄에 채워지는 품명이 고객사 품명이다** — 우리 품명이 슬쩍 대신 들어가면 그럴듯해
 *     보여서 아무도 되묻지 않는다.
 *  ㉡ **빈 고객사 품명은 못 고른다** — 그런데 **목록에서 감추지는 않는다**(있는데 못 고르는
 *     것과 아예 없는 것은 다른 말이다).
 *  ㉢ 🔵 **사용 부품에서는 고를 수 있다** — 내부 기록까지 막으면 수리 기록 자체가 막히고,
 *     채워 넣는 길(부품 요청 칸)도 함께 막힌다.
 *  ㉣ 🔴 **PO/내자는 한 글자도 달라지지 않는다** — 안 넘기면 지금까지 그대로다.
 *  ㉤ 🔴 **`-` 만 적힌 칸은 「없음」이다** — 재고 관리도 같은 자를 쓴다(저쪽 `DASH_ONLY`).
 *     값으로 세면 고객사에 나가는 서류에 `-` 가 이름으로 찍힌다.
 * ============================================================================
 */
describe("㉧ 견적서의 품명 = 고객사 품명 · 없으면 못 고른다", () => {
  /** 고객사 품명이 **있는** 줄 · **빈** 줄 · **`-` 만 적힌** 줄. */
  const quoteRows: PartPickerRow[] = [
    rows[0], // 발진관 조립품
    rows[1], // 고객사 품명이 "" 이다
    { id: "14", partName: "전원 모듈", partSpec: null, customerPartName: "-", drawingNo: null, kyosanPartNo: null },
  ];

  test("㉠ 🔴 줄에 채워지는 품명이 **고객사 품명**이다 — 우리 품명이 아니다", () => {
    assert.equal(partPickName(rows[0], "customer"), "발진관 조립품");
    assert.deepEqual(partPickPatch(rows[0], {}, "customer"), {
      partNameText: "발진관 조립품",
      partId: "11",
    });
  });

  test("㉠ 단가는 그대로 함께 채워진다 — 이름만 바뀌었다", () => {
    assert.deepEqual(partPickPatch(rows[0], { prices }, "customer"), {
      partNameText: "발진관 조립품",
      partId: "11",
      unitPrice: "125000",
    });
  });

  test("㉡ 🔴 고객사 품명이 비면 **고를 수 없다**", () => {
    assert.equal(canPickPartOption(rows[1], "customer"), false);
    assert.equal(partPickName(rows[1], "customer"), "");
  });

  test("㉤ 🔴 `-` 만 적힌 칸도 **없는 것**이다 — 값으로 세면 서류에 `-` 가 이름으로 찍힌다", () => {
    assert.equal(canPickPartOption(quoteRows[2], "customer"), false);
    // 🔴 재고 관리가 빈 값으로 보는 글자들과 **같은 자**여야 한다(저쪽 lib/parts/form.ts).
    for (const dash of ["-", "--", "–", "—", "－", "ㅡ", " - "]) {
      assert.equal(partFieldValue(dash), "", `'${dash}' 를 값으로 세고 있다`);
    }
    assert.equal(partFieldValue(" 발진관 조립품 "), "발진관 조립품");
    assert.equal(partFieldValue(null), "");
  });

  test("㉡ 🔴 못 고르는 줄도 **목록에는 그대로 뜬다** — 감추면 「아예 없다」로 읽힌다", () => {
    const html = renderToStaticMarkup(
      <PartSuggestionList options={quoteRows} onPick={() => {}} listLabel="1번째 부품 후보" nameSource="customer" />
    );
    // 셋 다 보인다 — 고를 수 없는 둘까지.
    for (const shown of ["마그네트론", "서큘레이터", "전원 모듈"]) {
      assert.ok(html.includes(shown), `${shown} 이 목록에서 사라졌다`);
    }
    // 고를 수 있는 줄에는 **적힐 이름**이 보이고, 못 고르는 줄에는 **까닭**이 보인다.
    assert.ok(html.includes("고객사 품명 · 발진관 조립품"), "적힐 이름이 안 보인다");
    assert.equal(
      html.split(CUSTOMER_PART_NAME_REQUIRED_MESSAGE).length - 1,
      2,
      "안내가 못 고르는 줄 둘에 뜨지 않는다"
    );
    // 🔴 눌리지 않아야 한다 — 막는 자리는 `disabled` 다.
    assert.equal(html.split("disabled=").length - 1, 2, "못 고르는 줄의 단추가 잠기지 않았다");
  });

  test("㉡ 🔴 눌러도 고르지 않는다 — `disabled` 가 빠져도 빈 이름이 줄에 들어가지 않게", () => {
    // 그려 본 HTML 로는 눌러 볼 수 없어서, 고르개가 부르는 그 판정을 직접 잰다.
    // 🔵 둘이 **같은 자**(partPickName)로 재는지가 핵심이다 — 자가 둘이면 「고를 수는 있는데
    //    빈 이름이 들어가는」 줄이 생기고, 그러면 적어 둔 품명이 지워진다.
    for (const row of quoteRows) {
      assert.equal(
        canPickPartOption(row, "customer"),
        partPickName(row, "customer") !== "",
        `${row.partName} 에서 「고를 수 있나」와 「적을 이름이 있나」가 어긋난다`
      );
    }
  });

  test("㉢ 🔵 사용 부품(기본값)에서는 **같은 부품을 고를 수 있다**", () => {
    // 🔴 여기까지 막으면 수리 기록도 부품 요청도 못 하게 되고, 채워 넣을 길까지 막힌다.
    for (const row of quoteRows) {
      assert.equal(canPickPartOption(row), true, `${row.partName} 을 사용 부품에서 못 고른다`);
    }
    assert.deepEqual(partPickPatch(rows[1]), { partNameText: "서큘레이터", partId: "12" });
  });

  test("㉣ 🔴 안 넘기면 지금까지 그대로다 — PO/내자의 줄은 한 글자도 안 바뀐다", () => {
    /**
     * 🔴 **PO/내자의 줄로 잰다** — 그쪽 조회는 `customerPartName` 을 **아예 싣지 않는다**
     *    (그 칸은 선택이다 — part-picker-rows.ts). 2026-10-16 요청 ③ 으로 고객사 품명이
     *    줄의 맨 위로 올라왔지만, **값이 없으면 그 줄은 그려지지 않으므로** 그쪽 화면은
     *    여전히 한 글자도 달라지지 않는다. 그쪽에서 달라지는 것은 꼬리표 안의 교산 품번 ·
     *    도번 **차례**뿐이고, 그것이 ③ 이 맞추라고 한 바로 그 차례다.
     */
    const poRows: PartPickerRow[] = quoteRows.map((row) => ({
      id: row.id,
      partName: row.partName,
      partSpec: row.partSpec,
      drawingNo: row.drawingNo,
      kyosanPartNo: row.kyosanPartNo,
    }));
    const plain = renderToStaticMarkup(
      <PartSuggestionList options={poRows} onPick={() => {}} listLabel="1번째 부품 후보" />
    );
    assert.ok(!plain.includes(CUSTOMER_PART_NAME_REQUIRED_MESSAGE), "안 넘긴 사이트에 안내가 떴다");
    assert.ok(!plain.includes("고객사 품명"), "그 칸이 없는 사이트에 이름표 줄이 생겼다");
    // 🔵 `disabled=""` 로 본다 — 꾸밈 글자(`disabled:bg-…`)에도 그 낱말이 들어 있다.
    assert.ok(!plain.includes('disabled=""'), "안 넘긴 사이트에서 줄이 잠겼다");

    /**
     * 🔴 **그 칸이 **있는** 줄에서도 「못 고른다」는 말은 `"customer"` 화면에만 뜬다** —
     *    기본 화면에서는 비어도 고를 수 있으니 까닭을 적을 일이 없다(적으면 고르지 말라는
     *    말로 읽힌다). 값이 있으면 이름표를 달고 보인다 — 그것이 ③ 이 말한 그 차례다.
     */
    const withCustomerName = renderToStaticMarkup(
      <PartSuggestionList options={quoteRows} onPick={() => {}} listLabel="1번째 부품 후보" />
    );
    assert.ok(!withCustomerName.includes(CUSTOMER_PART_NAME_REQUIRED_MESSAGE), "기본 화면에 까닭이 떴다");
    assert.ok(!withCustomerName.includes('disabled=""'), "기본 화면에서 줄이 잠겼다");
    assert.ok(withCustomerName.includes("고객사 품명 · 발진관 조립품"), "값이 있는데 안 보인다");
  });

  test("🔴 견적서 폼이 **목록과 고른 값 둘 다** 고객사 품명으로 넘긴다", () => {
    // 한쪽만 넘기면 「보인 이름」과 「적힌 이름」이 어긋난다 — 보기엔 막혔는데 적히거나 그 반대다.
    assert.ok(form.includes('nameSource="customer"'), "목록에 고객사 품명을 넘기지 않는다");
    /* 🔴 고른 값 쪽은 견적서 규칙이 **제 안에** 들고 있다 — 폼이 두 번 적지 않게(요청 ②). */
    assert.ok(
      quotePartPick.includes('"customer" );'),
      "견적서 쪽 규칙이 고른 값에 고객사 품명을 넘기지 않는다"
    );
    assert.deepEqual(
      quotePartPickPatch({ partNameText: "", unitPrice: "", pickedPart: null }, rows[0]).partNameText,
      "발진관 조립품",
      "줄에 적히는 이름이 고객사 품명이 아니다"
    );
  });

  test("🔵 사용 부품 폼은 그 값을 **넘기지 않는다** — 내부 기록이라 막지 않는다", () => {
    assert.ok(!usedPartsForm.includes("nameSource"), "사용 부품 폼이 견적서 사정을 따라갔다");
  });

  test("🔴 고르개 안에 **견적서 사정이 박혀 있지 않다** — 쓰는 쪽이 정해 넘기는 값이다", () => {
    const picker = flat(read("vendor/dss-core/src/ui/inventory/part-picker.tsx"));
    // 기본값이 "part" 여야 안 넘기는 사이트가 지금까지 그대로 돈다.
    assert.ok(picker.includes('nameSource: PartNameSource = "part"'), "함수의 기본값이 없다");
    assert.ok(picker.includes('nameSource = "part",'), "목록의 기본값이 없다");
    // 🔴 고르개가 **스스로** 고객사 품명으로 갈아타는 자리가 하나도 없어야 한다 — 한 줄이라도
    //    박히면 PO/내자가 포인터를 올리는 날 그쪽 품명이 통째로 바뀐다.
    assert.ok(!picker.includes('nameSource="customer"'), "고르개가 제 줄에서 고객사 품명을 켠다");
    assert.ok(!/nameSource\s*=\s*"customer"/.test(picker), "고르개 안에 기본값을 바꾸는 자리가 있다");
  });
});
