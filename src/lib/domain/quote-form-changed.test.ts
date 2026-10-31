import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  quoteFormValuesChanged,
  type QuoteComparableFields,
} from "./quote-form-changed";

/**
 * ============================================================================
 * 🔴 **견적서에 저장 안 된 고침이 남아 있는가** (2026-11-01)
 * ============================================================================
 * 이 값 하나가 「저장되지 않는 내용이 있습니다」 창을 띄울지 말지를 가른다.
 *
 * 🔴 **표본에 바뀐 것과 안 바뀐 것을 둘 다** 넣는다. 「바뀜」만 재면 늘 참을 돌려주는
 * 함수도 통과하고, 그 증상은 «아무것도 안 했는데 나갈 때마다 창이 뜬다»이다 — 사람은
 * 읽지 않고 누르는 손을 배운다.
 * 🔵 표본의 글자는 전부 **가짜**다 — 실제 고객사 · L/N · S/N 을 시험에 넣지 않는다.
 * ============================================================================
 */

/**
 * 🔴 **부를 때마다 새 배열 · 새 객체**를 만든다. 화면이 렌더마다 `collectFields()` 를
 * 새로 부르는 것과 같은 모양이라, 참조로 견주는 구현은 이 표본에서 바로 걸린다.
 */
function sample(): QuoteComparableFields {
  return {
    quoteNumber: "Q-0001",
    kind: "DOMESTIC",
    quoteDate: "2026-11-01",
    repairCaseId: "rc-1",
    intakeNumberText: "D260101",
    customerId: "cust-1",
    customerNameText: "보기 고객사",
    modelNameText: "MODEL-X",
    lotNumberText: "LN-0000",
    serialNumberText: "SN-0000",
    faultDescriptionText: "동작하지 않음",
    subject: "MODEL-X 수리 견적",
    validity: "견적 후 30일",
    delivery: "협의",
    payment: "현금",
    remarks: null,
    workCost: "350000",
    laborEquipmentKind: "GENERATOR",
    laborBaseCost: "200000",
    powerTestExcluded: false,
    laborPowerTestDeduction: null,
    investigationExcluded: false,
    documentExcluded: false,
    isExcelOnly: false,
    manualSupplyAmount: null,
    repairTasks: [
      { taskId: "t-1", taskName: "분해 점검", hours: 2, hourlyRate: "50000" },
      { taskId: "t-2", taskName: "조립", hours: 1, hourlyRate: "50000" },
    ],
    workScopeLines: [
      { section: "INVESTIGATION", text: "인수 조사" },
      { section: "REPAIR", text: "기판 교체" },
    ],
    items: [
      {
        partId: "p-1",
        isOverhaulPart: false,
        kind: "ITEM",
        partNameText: "보기 부품",
        partSpecText: null,
        quantity: 2,
        unitPrice: "10000",
        inventoryPartNo: "1234",
      },
      {
        partId: null,
        isOverhaulPart: false,
        kind: "NOTE",
        partNameText: "※ 부가세 별도",
        partSpecText: null,
        quantity: null,
        unitPrice: null,
        inventoryPartNo: null,
      },
    ],
  };
}

describe("🔴 안 바뀌었으면 「안 바뀜」이다 — 그래야 괜히 묻지 않는다", () => {
  test("🔴 **새 배열 · 새 객체**여도 내용이 같으면 안 바뀜이다", () => {
    // 🔴 이 한 줄이 「줄 묶음을 참조로 견주는」 구현을 잡는다. 참조로 재면 화면이
    //    렌더될 때마다 「바뀜」이라, 빈 폼을 열었다 나가도 창이 뜬다.
    assert.equal(quoteFormValuesChanged(sample(), sample()), false);
  });

  test("줄이 하나도 없는 장(엑셀 전용 꼴)도 안 바뀜이다", () => {
    const empty = (): QuoteComparableFields => ({
      ...sample(),
      isExcelOnly: true,
      manualSupplyAmount: "1000000",
      repairTasks: [],
      workScopeLines: [],
      items: [],
    });
    assert.equal(quoteFormValuesChanged(empty(), empty()), false);
  });
});

describe("🔴 한 칸이라도 바뀌면 「바뀜」이다 — 칸마다 하나씩", () => {
  /**
   * 🔴 **칸 이름을 손으로 적지 않는다.** 표본의 열쇠를 돌며 값을 하나씩 흔들어, 재는
   * 칸이 **빠짐없이** 비교에 들어 있는지 본다. 칸이 늘었는데 비교에서 빠지면 여기서
   * 터진다(그 증상은 「고쳤는데 묻지도 않고 나가 버린다」 — 글이 말없이 사라진다).
   */
  const base = sample();
  for (const key of Object.keys(base) as (keyof QuoteComparableFields)[]) {
    test(`${key} 를 흔들면 바뀜이다`, () => {
      const after = sample();
      const value = after[key];
      if (Array.isArray(value)) {
        // 줄 묶음은 **한 줄을 덜어** 흔든다 — 길이가 곧 뜻인 칸이다.
        (after as Record<string, unknown>)[key] = value.slice(1);
      } else if (typeof value === "boolean") {
        (after as Record<string, unknown>)[key] = !value;
      } else if (typeof value === "string") {
        (after as Record<string, unknown>)[key] = `${value} `;
      } else {
        // null 인 칸 — 글자를 넣는다.
        (after as Record<string, unknown>)[key] = "흔든 값";
      }
      assert.equal(quoteFormValuesChanged(base, after), true, `${key} 가 비교에서 빠져 있다`);
    });
  }
});

describe("🔴 줄 묶음은 **속까지** 본다", () => {
  test("품목 줄의 수량 한 칸만 달라도 바뀜이다", () => {
    const after = sample();
    after.items = [{ ...after.items[0], quantity: 3 }, after.items[1]];
    assert.equal(quoteFormValuesChanged(sample(), after), true);
  });

  test("🔴 품목 줄의 **차례**가 바뀌어도 바뀜이다 — 문서에 적히는 순서 그대로 저장된다", () => {
    const after = sample();
    after.items = [after.items[1], after.items[0]];
    assert.equal(quoteFormValuesChanged(sample(), after), true);
  });

  test("작업 내역 줄의 글자 한 칸", () => {
    const after = sample();
    after.workScopeLines = [after.workScopeLines[0], { section: "REPAIR", text: "기판 교체 2" }];
    assert.equal(quoteFormValuesChanged(sample(), after), true);
  });

  test("고른 수리 작업의 수량(= 펴진 줄 수)", () => {
    const after = sample();
    after.repairTasks = [...after.repairTasks, after.repairTasks[0]];
    assert.equal(quoteFormValuesChanged(sample(), after), true);
  });

  test("🔴 부품 번호만 달라도 바뀜이다 — 저장되는 값이다", () => {
    const after = sample();
    after.items = [{ ...after.items[0], inventoryPartNo: "9999" }, after.items[1]];
    assert.equal(quoteFormValuesChanged(sample(), after), true);
  });
});
