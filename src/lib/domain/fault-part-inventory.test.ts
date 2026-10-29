import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { buildFaultPartBreakdown, type FaultPartRow } from "./product-model-breakdown";
import {
  buildFaultPartInventoryIndex,
  toFaultPartRows,
} from "./product-model-fault-parts";
import {
  FAULT_PART_INVENTORY_NOT_FOUND,
  FAULT_PART_INVENTORY_NO_KEY,
  faultPartInventoryUnreachableNotice,
  lookupFaultPartInventory,
  type FaultPartInventoryIndex,
} from "./fault-part-inventory";
import { toPartPickerOptions, type InventoryPart } from "./inventory-gateway";
import { buildUsedPartNameIndex, usedPartMatchKey } from "./used-part-display";
import { FAULT_SYMPTOM_UNSPECIFIED_LABEL } from "./fault-symptom-breakdown";
import type { PieSlice } from "./pie-slices";

/**
 * ============================================================================
 * [고장 부품] 조각을 누르면 그 부품의 **재고 관리 줄**이 펼쳐진다 (2026-10-29)
 * ============================================================================
 * 사용자 요청: 「고장 부품을 누르면 그 아랫부분에 **그 부품의 전체 이름과 현재 재고 등을**
 * 구체적으로 확인할 수 있도록 해줘.」 사용자 결정: 🔴 **소유구분을 나눠서 보여 준다.**
 *
 * ── 🔴 여기서 재는 것은 **열쇠가 맞는가**다 ────────────────────────────
 * 조각을 묶는 글자(「고객사 품명 (품번)」)와 재고 관리 줄을 찾는 열쇠는 **서로 다른 값**이라,
 * 따로 만들면 소리 없이 어긋난다 — 오류는 안 나고 **엉뚱한 부품의 재고가 뜰 뿐**이다.
 * 그래서 이 파일은 조각을 **화면이 보는 그 길 그대로** 만든다:
 *
 *     재고 관리 응답 → buildUsedPartNameIndex → toFaultPartRows → buildFaultPartBreakdown
 *                    → 조각의 detail.matchKey → buildFaultPartInventoryIndex → 줄
 *
 * 🔴 **일부러 어긋나게 만들어 보았다**: 아래 표본은 사용 부품에 적힌 품번과 재고 관리의
 *    도번이 **글자로는 다르다**(`dwg aa1001` ↔ `DWG-AA1001`). 눌러 적는 자
 *    (`usedPartMatchKey` — 붙임표·공백을 지우고 소문자로)를 안 쓰면 **한 줄도 안 나온다.**
 *    그 단언이 이 파일의 중심이다.
 *
 * ── 🔴 고객사명·품번은 **전부 가짜**다 ──────────────────────────────────
 * 이 저장소는 공개된다. 실제 고객사명·L/N·S/N 을 시험에 넣지 않는다.
 * ============================================================================
 */

/** 재고 관리 부품 한 줄. 🔴 칸이 열둘이라, 안 적은 칸은 전부 「없음」 쪽으로 눕힌다. */
function inventoryPart(overrides: Partial<InventoryPart> & { no: number }): InventoryPart {
  return {
    // 🔵 `no` 는 기본값을 두지 않는다 — 부르는 쪽이 반드시 적는 값이고(타입이 막는다),
    //    여기 0 을 적어 두면 「덮어쓰기」 경고가 난다.
    name: "",
    name2: "",
    customerName: "",
    kyosanPartNo: "",
    drawingNo: "",
    quantity: 0,
    note: "",
    owner: { code: "DSS", label: "DSS" },
    quotePrice: null,
    overhaulQuotePrice: null,
    ...overrides,
  };
}

/**
 * 🔴 **소유만 다른 같은 부품 둘** — 사용자가 보낸 실물의 모양이다(같은 도번에 1개 · 153개).
 * 재고 관리에서는 소유가 다르면 **부품 번호가 다르다**.
 */
const INVENTORY: InventoryPart[] = [
  inventoryPart({
    no: 101,
    drawingNo: "DWG-AA1001",
    customerName: "종단 증폭 기판",
    name: "AMP-XX(13M)",
    name2: "AC100V",
    kyosanPartNo: "KY-7001",
    quantity: 1,
    owner: { code: "KYOSAN", label: "KYOSAN" },
    note: "라인 가 전용\n둘째 줄은 안 보인다",
  }),
  inventoryPart({
    no: 102,
    drawingNo: "DWG-AA1001",
    customerName: "종단 증폭 기판",
    name: "AMP-XX(13M)",
    quantity: 153,
    owner: { code: "DSS", label: "DSS" },
  }),
  inventoryPart({ no: 103, drawingNo: "DWG-BB2002", name: "전원 퓨즈", quantity: 7 }),
];

const NAME_INDEX = buildUsedPartNameIndex(
  toPartPickerOptions({ status: "ok", value: INVENTORY })
);

/**
 * 화면이 쓰는 길 그대로 조각을 만든다 — `product-models/[id]/page.tsx` 가 하는 일과
 * 같은 차례다(이름표 지도 → 줄 → 조각 → 재고 지도).
 *
 * 🔴 **이름표 지도와 재고 지도를 같은 응답에서 만든다.** 화면이 그렇게 하고(통로를 한 번만
 *    두드린다), 따로 만들면 재고 관리가 멈춘 날의 모양이 **실제와 달라진다** — 그쪽은 이름이
 *    안 붙고 이쪽은 줄이 없다.
 */
function buildAll(input: {
  requested?: Parameters<typeof toFaultPartRows>[0]["requested"];
  used?: Parameters<typeof toFaultPartRows>[0]["used"];
  issued?: Parameters<typeof toFaultPartRows>[0]["issued"];
  inventory?: Parameters<typeof buildFaultPartInventoryIndex>[0];
}) {
  const inventory = input.inventory ?? { status: "ok" as const, value: INVENTORY };
  const rows = toFaultPartRows(
    { requested: input.requested ?? [], used: input.used ?? [], issued: input.issued ?? [] },
    buildUsedPartNameIndex(toPartPickerOptions(inventory))
  );
  const breakdown = buildFaultPartBreakdown(rows);
  const index = buildFaultPartInventoryIndex(inventory, rows);
  return { rows, breakdown, index };
}

/** 이름표로 조각 하나를 집는다. 🔴 못 집으면 **그 자리에서 실패**한다(표본이 비면 안 된다). */
function sliceNamed<T>(slices: readonly PieSlice<T>[], label: string): PieSlice<T> {
  const found = slices.find((slice) => slice.label === label);
  assert.ok(found, `이 시험의 표본이 비었다 — 「${label}」 조각이 없다: ${slices.map((s) => s.label).join(" / ")}`);
  return found;
}

describe("[고장 부품] 조각 → 그 부품의 재고 관리 줄", () => {
  test("🔴 조각을 고르면 **그 부품의 줄들**이 나온다 — 소유가 둘이면 **두 줄**이다(합치지 않는다)", () => {
    const { breakdown, index } = buildAll({
      // 🔴 적혀 있는 글자가 재고 관리의 도번과 **다르다**(소문자 · 붙임표 대신 공백).
      //    눌러 적는 자를 안 쓰면 여기서 한 줄도 안 나온다.
      used: [{ repairCaseId: "case-01", partNameText: "dwg aa1001", quantity: 1 }],
    });

    const slice = sliceNamed(breakdown.slices, "종단 증폭 기판 (dwg aa1001)");
    assert.equal(slice.detail.parts.length, 1, "값 조각에는 부품이 하나다");

    const found = lookupFaultPartInventory(index, slice.detail.parts[0].matchKey);
    assert.equal(found.status, "rows", "줄을 못 찾았다 — 열쇠가 어긋났다");
    assert.ok(found.status === "rows");

    // 🔴 **소유별로 두 줄**이다. 154개로 합치지 않는다(재고 관리에서는 소유가 다르면
    //    부품 번호가 다르고, 반출 신청도 번호로 건다).
    assert.deepEqual(
      found.rows.map((row) => [row.ownerLabel, row.quantity, row.no]),
      [
        ["KYOSAN", 1, 101],
        ["DSS", 153, 102],
      ]
    );
    // 🔵 차례는 재고 관리가 준 차례 그대로다 — 여기서 다시 정렬하지 않는다.
  });

  test("🔴 **그래프 조각과 상세가 같은 부품을 가리킨다** — 이름표를 준 줄이 펼친 줄 안에 있다", () => {
    const { breakdown, index } = buildAll({
      used: [{ repairCaseId: "case-01", partNameText: "dwg aa1001", quantity: 1 }],
    });
    const slice = sliceNamed(breakdown.slices, "종단 증폭 기판 (dwg aa1001)");
    const found = lookupFaultPartInventory(index, slice.detail.parts[0].matchKey);
    assert.ok(found.status === "rows");

    // 🔴 조각 이름표의 **고객사 품명**은 재고 관리 어느 줄에선가 온 값이다. 펼친 줄
    //    가운데 그 이름을 가진 줄이 없으면, 이름과 재고가 **다른 부품**을 가리키는 것이다.
    assert.ok(
      found.rows.some((row) => slice.label.startsWith(`${row.customerName} (`)),
      `이름표(${slice.label})를 준 줄이 펼친 줄에 없다: ${found.rows.map((r) => r.customerName).join(" / ")}`
    );
    // 🔴 그리고 그 열쇠는 **품번을 눌러 적은 값**이다 — 이름표 글자가 아니다.
    assert.equal(slice.detail.parts[0].matchKey, usedPartMatchKey("DWG-AA1001"));
    assert.notEqual(slice.detail.parts[0].matchKey, slice.label);
  });

  test("🔴 열쇠가 어긋나면 깨진다 — 글자 그대로 맞대면 한 줄도 안 나온다", () => {
    const { breakdown, index } = buildAll({
      used: [{ repairCaseId: "case-01", partNameText: "dwg aa1001", quantity: 1 }],
    });
    const slice = sliceNamed(breakdown.slices, "종단 증폭 기판 (dwg aa1001)");
    const key = slice.detail.parts[0].matchKey;

    // 🔵 이 시험이 무는지 보여 주는 자리 — **눌러 적지 않은** 글자로는 지도에 없다.
    assert.ok(index.status === "ok");
    assert.equal(index.rowsByKey["dwg aa1001"], undefined, "다듬지 않은 글자가 열쇠가 되어 있다");
    assert.equal(index.rowsByKey["DWG-AA1001"], undefined, "저쪽 원형이 열쇠가 되어 있다");
    assert.ok(index.rowsByKey[key], "눌러 적은 열쇠로도 못 찾는다");
  });

  test("🔴 세 입력(요청 · 사용 · 반출)이 **같은 조각 · 같은 열쇠**가 된다", () => {
    const { breakdown } = buildAll({
      // 세 입력이 같은 부품을 서로 다른 칸·다른 표기로 들고 온다.
      requested: [
        {
          repairCaseId: "case-01",
          // 🔵 셋 다 1 개씩이라 조각의 수가 **입력 수(3)와 같다** — 이 시험이 보는 것은
          //    「한 조각으로 모이는가」지 수량이 아니다(수량은 product-model-breakdown
          //    .test.ts 가 값으로 본다).
          quantity: 1,
          partName: "AMP-XX(13M)",
          partSpec: null,
          kyosanPartNo: null,
          drawingNo: "DWG-AA1001",
        },
      ],
      used: [{ repairCaseId: "case-02", partNameText: "DWG-AA1001", quantity: 1 }],
      issued: [
        {
          repairCaseId: "case-03",
          quantity: 1,
          partName: "AMP-XX(13M)",
          partSpec: "",
          kyosanPartNo: "",
          drawingNo: "DWG-AA1001",
        },
      ],
    });

    const slice = sliceNamed(breakdown.slices, "종단 증폭 기판 (DWG-AA1001)");
    assert.equal(slice.count, 3, "세 입력이 한 조각으로 모이지 않았다");
    assert.equal(slice.detail.parts.length, 1);
    assert.equal(slice.detail.parts[0].count, 3);
    assert.equal(slice.detail.parts[0].matchKey, usedPartMatchKey("DWG-AA1001"));
  });

  test("🔴 **재고 관리에서 못 찾은 부품**도 깨지지 않는다 — 빈 칸이 아니라 그 사실을 말한다", () => {
    const { breakdown, index } = buildAll({
      used: [{ repairCaseId: "case-01", partNameText: "DWG-ZZ9999", quantity: 1 }],
    });

    // 이름을 못 얻었으니 품번 그대로가 조각 이름이다(used-part-display 의 네 길 중 ㉠).
    const slice = sliceNamed(breakdown.slices, "DWG-ZZ9999");
    const found = lookupFaultPartInventory(index, slice.detail.parts[0].matchKey);
    assert.equal(found.status, "notice");
    assert.ok(found.status === "notice");
    assert.equal(found.notice, FAULT_PART_INVENTORY_NOT_FOUND);
    // 🔴 「0개」로 읽히면 안 된다 — 문장이 그 말을 **직접 부정**한다.
    assert.ok(found.notice.includes("0개라는 뜻이 아닙니다"), found.notice);
  });

  test("🔴 **재고 관리가 멈췄으면** 그 사실이 드러난다 — 「재고 0」이 아니다", () => {
    const { breakdown, index } = buildAll({
      used: [{ repairCaseId: "case-01", partNameText: "DWG-AA1001", quantity: 1 }],
      inventory: { status: "unreachable", reason: "timeout" },
    });

    // 🔴 지도는 **빈 지도가 아니라 「못 물어봤다」**로 들어 있다.
    assert.equal(index.status, "unreachable");

    // 이름 지도도 함께 비므로 조각 이름은 품번 그대로다(그쪽은 일부러 눕힌다 — ㉢).
    const slice = sliceNamed(breakdown.slices, "DWG-AA1001");
    const found = lookupFaultPartInventory(index, slice.detail.parts[0].matchKey);
    assert.ok(found.status === "notice");
    assert.equal(found.notice, faultPartInventoryUnreachableNotice("timeout"));
    assert.ok(found.notice.includes("확인하지 못한 것입니다"), found.notice);
    assert.ok(found.notice.includes("재고 관리가 응답하지 않습니다"), "못 받아 온 까닭이 빠졌다");
    assert.equal(found.notice.includes("없습니다 — 재고가 0개"), false, "「없다」로 읽히는 말이 섞였다");
  });

  test("🔴 **품번이 아예 없는 줄**은 「미입력」 조각이고, 재고 관리 탓으로 돌리지 않는다", () => {
    const { breakdown, index } = buildAll({
      // 🔵 네 칸이 다 비거나 `-` 뿐인 부품 요청 줄 — partIdentityText 가 빈 글자를 내놓는다.
      requested: [
        {
          repairCaseId: "case-01",
          quantity: 1,
          partName: "-",
          partSpec: null,
          kyosanPartNo: null,
          drawingNo: "   ",
        },
      ],
    });

    const slice = sliceNamed(breakdown.slices, FAULT_SYMPTOM_UNSPECIFIED_LABEL);
    assert.equal(slice.detail.parts.length, 1);
    assert.equal(slice.detail.parts[0].matchKey, "", "맞댈 수 없는 줄인데 열쇠가 생겼다");

    const found = lookupFaultPartInventory(index, slice.detail.parts[0].matchKey);
    assert.ok(found.status === "notice");
    assert.equal(found.notice, FAULT_PART_INVENTORY_NO_KEY);
    // 🔴 세 문장이 서로 **다른 말**이어야 한다 — 고칠 자리가 다르다.
    assert.notEqual(found.notice, FAULT_PART_INVENTORY_NOT_FOUND);
    assert.notEqual(found.notice, faultPartInventoryUnreachableNotice("timeout"));
  });

  /**
   * 🔴 **실측으로 알게 된 것**(2026-10-29): 사용 부품 줄에 `-` 가 저장돼 있으면 조각은
   * `미입력` 이 **아니라** 「-」 라는 이름의 **값 조각**이 된다. `usedPartDisplayName` 이
   * 이름을 못 얻었을 때 **저장된 글자를 그대로** 내놓기 때문이고, 그것이 맞는 동작이다
   * (그 파일 머리말 — 괄호 안은 다듬지 않는다).
   * 🔵 부품 요청 · 반출 줄은 다르다 — `partIdentityText` 가 `-` 를 없는 칸으로 세어 빈
   *    글자를 내놓으므로 그쪽은 `미입력` 으로 간다(바로 위 시험).
   * 🔴 그래도 **열쇠는 빈 글자**라, 펼치면 「품번이 없다」고 말한다. 이름표가 「-」 인데
   *    「재고 관리에 없습니다」라고 적으면 멀쩡한 재고 관리를 뒤지게 된다.
   */
  test("🔴 사용 부품에 `-` 만 적혀 있으면 조각 이름은 「-」 지만 **열쇠는 비어 있다**", () => {
    const { breakdown, index } = buildAll({
      used: [{ repairCaseId: "case-01", partNameText: "-", quantity: 1 }],
    });

    const slice = sliceNamed(breakdown.slices, "-");
    assert.equal(slice.detail.parts[0].matchKey, "");
    const found = lookupFaultPartInventory(index, slice.detail.parts[0].matchKey);
    assert.ok(found.status === "notice");
    assert.equal(found.notice, FAULT_PART_INVENTORY_NO_KEY);
  });

  test("🔴 **못 물어본 날에도** 품번 없는 줄은 「품번이 없다」고 말한다 — 통로를 의심하게 두지 않는다", () => {
    const unreachable: FaultPartInventoryIndex = { status: "unreachable", reason: "timeout" };
    const found = lookupFaultPartInventory(unreachable, "");
    assert.ok(found.status === "notice");
    assert.equal(found.notice, FAULT_PART_INVENTORY_NO_KEY);
  });
});

describe("[고장 부품] 재고 지도 — 무엇을 담고 무엇을 뺐나", () => {
  test("🔴 **그래프에 뜬 열쇠만** 담는다 — 지도가 브라우저까지 나간다", () => {
    const { index } = buildAll({
      used: [{ repairCaseId: "case-01", partNameText: "DWG-BB2002", quantity: 1 }],
    });
    assert.ok(index.status === "ok");
    assert.deepEqual(Object.keys(index.rowsByKey), [usedPartMatchKey("DWG-BB2002")]);
    // 🔵 재고 관리에는 부품이 셋 있지만 그래프에 뜬 것은 하나뿐이다.
    assert.equal(INVENTORY.length, 3, "이 시험의 전제가 깨졌다 — 안 쓰는 부품이 있어야 한다");
  });

  test("🔴 **돈은 안 싣는다** — 이 화면의 문은 productModels.view 하나다", () => {
    const priced = [inventoryPart({ no: 201, drawingNo: "DWG-CC3003", quotePrice: 125000, overhaulQuotePrice: 98000 })];
    const rows = toFaultPartRows(
      { requested: [], used: [{ repairCaseId: "case-01", partNameText: "DWG-CC3003", quantity: 1 }], issued: [] },
      NAME_INDEX
    );
    const index = buildFaultPartInventoryIndex({ status: "ok", value: priced }, rows);
    assert.ok(index.status === "ok");
    const row = index.rowsByKey[usedPartMatchKey("DWG-CC3003")]?.[0];
    assert.ok(row, "이 시험의 표본이 비었다 — 줄을 찾았어야 한다");
    // 🔴 글자로 샅샅이 본다. 칸 이름을 바꿔 다시 실으면 여기서 걸린다.
    const serialized = JSON.stringify(row);
    assert.equal(serialized.includes("125000"), false, `견적가가 실려 나간다: ${serialized}`);
    assert.equal(serialized.includes("98000"), false, `O/H 견적가가 실려 나간다: ${serialized}`);
    assert.equal("quotePrice" in row, false);
    assert.equal("overhaulQuotePrice" in row, false);
  });

  test("🔴 비고는 **첫 줄만** 싣는다 — 재고 담당이 적는 칸이라 전문을 내보내지 않는다", () => {
    const { index } = buildAll({ used: [{ repairCaseId: "case-01", partNameText: "DWG-AA1001", quantity: 1 }] });
    assert.ok(index.status === "ok");
    const rows = index.rowsByKey[usedPartMatchKey("DWG-AA1001")];
    assert.ok(rows, "이 시험의 표본이 비었다");
    assert.equal(rows[0].noteFirstLine, "라인 가 전용");
    assert.equal(JSON.stringify(rows).includes("둘째 줄은 안 보인다"), false, "비고 전문이 실려 나간다");
  });

  test("🔵 소유는 **글자**로 눕혀 싣는다 — 화면이 하는 일이 `label || code` 하나뿐이다", () => {
    const codeOnly = [inventoryPart({ no: 301, drawingNo: "DWG-DD4004", owner: { code: "ETC", label: "" } })];
    const rows = toFaultPartRows(
      { requested: [], used: [{ repairCaseId: "case-01", partNameText: "DWG-DD4004", quantity: 1 }], issued: [] },
      NAME_INDEX
    );
    const index = buildFaultPartInventoryIndex({ status: "ok", value: codeOnly }, rows);
    assert.ok(index.status === "ok");
    assert.equal(index.rowsByKey[usedPartMatchKey("DWG-DD4004")]?.[0].ownerLabel, "ETC");
  });
});

describe("[고장 부품] 재고 지도 — 어느 칸으로 맞추나", () => {
  /**
   * 🔴 **이름을 찾는 차례와 같은 차례**여야 한다(도번 → 교산 품번 → 품명2 → 품명).
   *    차례가 갈리면 **이름은 A 부품인데 펼친 재고는 B 부품**이 된다.
   */
  const CROSSED: InventoryPart[] = [
    inventoryPart({ no: 401, drawingNo: "SAME-0001", customerName: "도번으로 찾은 부품", quantity: 11 }),
    inventoryPart({ no: 402, name: "SAME-0001", customerName: "품명으로 찾은 부품", quantity: 22 }),
  ];

  test("🔴 **도번이 품명을 이긴다** — 앞 칸에서 찾으면 뒤 칸은 보지 않는다", () => {
    const nameIndex = buildUsedPartNameIndex(toPartPickerOptions({ status: "ok", value: CROSSED }));
    const rows = toFaultPartRows(
      { requested: [], used: [{ repairCaseId: "case-01", partNameText: "SAME-0001", quantity: 1 }], issued: [] },
      nameIndex
    );
    const index = buildFaultPartInventoryIndex({ status: "ok", value: CROSSED }, rows);
    const breakdown = buildFaultPartBreakdown(rows);

    // 이름표도 도번 쪽에서 왔다(usedPartCustomerName 의 차례).
    const slice = sliceNamed(breakdown.slices, "도번으로 찾은 부품 (SAME-0001)");
    const found = lookupFaultPartInventory(index, slice.detail.parts[0].matchKey);
    assert.ok(found.status === "rows");
    // 🔴 펼친 줄도 **도번 쪽 하나**다. 두 줄이 나오면 차례가 안 걸린 것이고, 402 가
    //    나오면 이름과 재고가 다른 부품을 가리키는 것이다.
    assert.deepEqual(found.rows.map((row) => row.no), [401]);
  });

  test("🔴 **이름이 엇갈려 품번으로 떨어진 부품도 줄은 나온다** — 모르는 것은 이름이지 부품이 아니다", () => {
    // 같은 도번에 서로 다른 고객사 품명 → 이름 지도는 그 열쇠를 버린다(㉣).
    const conflicting: InventoryPart[] = [
      inventoryPart({ no: 501, drawingNo: "DWG-EE5005", customerName: "이름 가", quantity: 3 }),
      inventoryPart({ no: 502, drawingNo: "DWG-EE5005", customerName: "이름 나", quantity: 4 }),
    ];
    const nameIndex = buildUsedPartNameIndex(toPartPickerOptions({ status: "ok", value: conflicting }));
    const rows = toFaultPartRows(
      { requested: [], used: [{ repairCaseId: "case-01", partNameText: "DWG-EE5005", quantity: 1 }], issued: [] },
      nameIndex
    );
    const breakdown = buildFaultPartBreakdown(rows);
    const index = buildFaultPartInventoryIndex({ status: "ok", value: conflicting }, rows);

    // 이름을 못 골랐으니 조각 이름은 품번 그대로다.
    const slice = sliceNamed(breakdown.slices, "DWG-EE5005");
    const found = lookupFaultPartInventory(index, slice.detail.parts[0].matchKey);
    assert.ok(found.status === "rows", "이름을 못 골랐다고 줄까지 지우면 안 된다");
    assert.deepEqual(found.rows.map((row) => row.no), [501, 502]);
  });
});

describe("[고장 부품] 기타 조각 — 접힌 부품이 전부 들어 있다", () => {
  test("🔴 접힌 종류만큼 부품이 담기고, 그 건수의 합이 조각 건수다", () => {
    const rows: FaultPartRow[] = [];
    // 10종 → 상위 8 + 기타(2종).
    for (let i = 1; i <= 10; i += 1) {
      for (let n = 0; n < 20 - i; n += 1) {
        // 🔵 줄마다 1 개 — 이 시험이 보는 것은 「접힌 부품이 다 들어 있는가」라, 수량을
        //    1 로 두어야 조각 수가 곧 줄 수여서 기대값을 눈으로 셀 수 있다.
        rows.push({ repairCaseId: `case-${i}`, quantity: 1, displayName: `부품 ${i}`, matchKey: `key-${i}` });
      }
    }
    const breakdown = buildFaultPartBreakdown(rows);
    const other = breakdown.slices[breakdown.slices.length - 1];
    assert.equal(other.sliceKind, "OTHER", "이 시험의 전제가 깨졌다 — 기타 조각이 없다");
    assert.equal(other.foldedGroupCount, 2);

    assert.deepEqual(
      other.detail.parts.map((entry) => entry.displayName),
      ["부품 9", "부품 10"],
      "접힌 부품이 통째로 사라졌다 — 기타 조각을 펼치면 아무것도 안 나온다"
    );
    assert.deepEqual(other.detail.parts.map((entry) => entry.matchKey), ["key-9", "key-10"]);
    assert.equal(
      other.detail.parts.reduce((sum, entry) => sum + entry.count, 0),
      other.count,
      "접힌 부품 건수의 합이 조각 건수와 다르다"
    );
  });

  test("🔴 값 조각의 부품 건수도 조각 건수와 같다 — 줄을 흘리지 않는다", () => {
    const { breakdown } = buildAll({
      used: [
        { repairCaseId: "case-01", partNameText: "DWG-BB2002", quantity: 1 },
        { repairCaseId: "case-02", partNameText: "DWG-BB2002", quantity: 1 },
      ],
    });
    const slice = sliceNamed(breakdown.slices, "DWG-BB2002");
    assert.equal(slice.count, 2);
    assert.deepEqual(slice.detail.parts.map((entry) => entry.count), [2]);
  });
});
