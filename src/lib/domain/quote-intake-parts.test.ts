import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { partFieldValue } from "@dss/core/ui/inventory/part-picker-rows";
import type {
  InventoryOhTemplate,
  InventoryPart,
  InventoryStockRequest,
} from "./inventory-gateway";
import {
  OH_TEMPLATE_PART_NOT_LINKED_MESSAGE,
  USED_PART_NOT_IN_INVENTORY_MESSAGE,
  toQuoteOhTemplate,
  toQuoteUsedParts,
} from "./quote-intake-parts";

/**
 * ============================================================================
 * 견적서가 불러오는 두 목록 — 🔴 **재고 관리에서 받아 온 것을 어떻게 읽는가** (2026-10-16)
 * ============================================================================
 * 이 시험이 보는 여섯 가지는 **옛 A/S 표를 세워 재던 그것 그대로**다
 * (`db/queries/quote-intake-lookup.integration.test.ts` 에 있었다). 부품 요청과 O/H 템플릿이
 * 2026-10 조각 10~12 에서 재고 관리로 옮겨갔으므로, 같은 규칙을 **저쪽에서 받아 온 자료**에
 * 대고 잰다 — 표가 없어졌다고 규칙까지 없어진 것이 아니다.
 *
 *  1. **출고된 것만 센다.** 요청만 하고 안 나간 부품을 견적에 올리면 쓰지도 않은 값을 청구한다.
 *  2. **묶는 축이 하나다.** 옛 질의는 (부품, 소유구분) 짝으로 묶었는데, 재고 관리에서는
 *     **소유가 다르면 부품 번호가 다르다** — 번호 하나가 곧 그 짝이다.
 *  3. **그 부품의 견적가가 따라온다.**
 *  4. 🔴 **정하지 않은 값은 null 이다.** 0 이 아니다 — 0 으로 오면 견적서가 정하지 않은 것을
 *     0원으로 청구한다.
 *  5. **0원(무상)은 그대로 온다** — 「정하지 않음」과 다른 값이다.
 *  6. 🔴 **O/H 견적가가 없을 때 일반 견적가로 때우지 않는다.**
 *
 * 그리고 이 조각에서 새로 지키는 것 둘 —
 *  7. 🔴 **되짚지 못한 줄을 목록에서 지우지 않는다**(담을 수 없을 뿐이다). 나간 부품이 목록에서
 *     사라지면 사람은 청구를 빠뜨린다.
 *  8. 🔴 **고객사 품명이 없어도 우리 품명으로 때우지 않는다** — 때우면 고객사가 모르는 이름이
 *     서류에 찍힌다. 그 값이 비었는지로 담기를 가르는 자리는 고르개 하나이고(`canPickPartOption`),
 *     여기서는 **날값을 그대로 실어 보내는가**만 본다(자를 두 벌로 만들지 않는다).
 *
 * 🔵 이름 · 번호는 전부 **지어낸 것**이다 — 공개 저장소에 실제 고객사 · 모델 · S/N 을 적지 않는다.
 * ============================================================================
 */

function part(over: Partial<InventoryPart> & { no: number }): InventoryPart {
  return {
    name: `부품-${over.no}`,
    name2: "",
    customerName: `고객사품명-${over.no}`,
    kyosanPartNo: "",
    drawingNo: "",
    quantity: 0,
    note: "",
    owner: { code: "DSS", label: "DSS" },
    quotePrice: null,
    overhaulQuotePrice: null,
    ...over,
  };
}

type Line = { no: number | null; name?: string; issued: number; quantity?: number };

function request(id: string, lines: Line[]): InventoryStockRequest {
  return {
    requestKey: null,
    id,
    intakeNumber: "D260101",
    status: { code: "CONFIRMED", label: "확인" },
    closed: false,
    requestedAt: "2096-03-05T01:00:00.000Z",
    /* 🔵 요청 비고(2026-10-22). 이 시험이 재는 것은 **출고 부품을 합치는 일**이라 쓰지 않는다 —
       「안 적었다」 쪽으로 둔다(빈 글자가 그 말이다). 읽는 규칙은 `inventory-gateway.test.ts` 가 잰다. */
    note: "",
    lines: lines.map((line) => ({
      no: line.no,
      name: line.name ?? `부품-${line.no}`,
      quantity: line.quantity ?? line.issued,
      issued: line.issued,
      /* 🔵 2026-10-21 에 줄이 넓어졌다(그 부품을 알아보는 값들 · 딱지 둘). 이 시험이 재는 것은
         **출고 부품을 합치는 일**이라 그 칸들을 쓰지 않는다 — 「없음」 쪽으로 둔다. 그리는 규칙은
         `inventory-gateway.test.ts` 가 따로 잰다. */
      customerName: "",
      name2: "",
      kyosanPartNo: "",
      drawingNo: "",
      owner: null,
      chargeType: null,
      /* 🔵 2026-10-22 에 O/H 표시가 더해졌다. 이 시험이 재는 것은 **출고 부품을 합치는 일**이라
         쓰지 않는다 — 「O/H 로 담긴 줄이 아니다」 쪽으로 둔다. */
      fromOhTemplate: false,
    })),
    decision: null,
    hold: null,
    requester: null,
  };
}

function template(
  items: { no: number | null; name: string; quantity?: number; linked?: boolean }[]
): InventoryOhTemplate {
  return {
    id: "tpl-1",
    name: "시험용 O/H 템플릿",
    note: "",
    items: items.map((item, index) => ({
      displayOrder: index + 1,
      no: item.no,
      name: item.name,
      partName: item.no === null ? null : `부품-${item.no}`,
      quantity: item.quantity ?? 1,
      linked: item.linked ?? item.no !== null,
    })),
  };
}

describe("출고된 부품 — 「반출이 확인된」만 센다", () => {
  test("🔴 나간 수량이 0 인 줄은 세지 않는다 — 쓰지도 않은 값을 청구하면 안 된다", () => {
    const rows = toQuoteUsedParts(
      [request("r1", [{ no: 11, issued: 0, quantity: 5 }, { no: 12, issued: 2 }])],
      [part({ no: 11 }), part({ no: 12 })]
    );

    assert.deepEqual(
      rows.map((row) => row.option?.id),
      ["12"]
    );
  });

  test("같은 부품이 여러 신청에 걸쳐 나가면 합쳐서 한 줄이다", () => {
    const rows = toQuoteUsedParts(
      [request("r1", [{ no: 11, issued: 1 }]), request("r2", [{ no: 11, issued: 3 }])],
      [part({ no: 11 })]
    );

    assert.equal(rows.length, 1, "두 줄로 갈라졌다");
    assert.equal(rows[0].quantity, 4);
  });

  test("🔵 묶는 축이 **부품 번호 하나**다 — 소유가 다르면 애초에 번호가 다르다", () => {
    // 옛 A/S 표에서는 (부품, 소유구분) 짝이었다. 재고 관리에서는 소유가 다르면 **다른 부품
    // 번호**라, 축을 하나 줄여도 DSS 것과 교산 것이 여전히 두 줄로 남는다.
    const rows = toQuoteUsedParts(
      [request("r1", [{ no: 11, issued: 1 }, { no: 12, issued: 3 }])],
      [
        part({ no: 11, name: "같은이름부품", owner: { code: "DSS", label: "DSS" } }),
        part({ no: 12, name: "같은이름부품", owner: { code: "KYOSAN", label: "교산" } }),
      ]
    );

    assert.equal(rows.length, 2);
    assert.deepEqual(
      rows.map((row) => [row.option?.id, row.ownerLabel, row.quantity]).sort(),
      [
        ["11", "DSS", 1],
        ["12", "교산", 3],
      ]
    );
  });

  test("담긴 줄을 다시 안 담게 하는 열쇠가 **부품 번호 기준**이다", () => {
    const rows = toQuoteUsedParts([request("r1", [{ no: 11, issued: 1 }])], [part({ no: 11 })]);
    assert.equal(rows[0].sourceKey, "issued:11");
  });

  test("차례는 품명순이다 — 불러올 때마다 목록이 뒤섞이지 않게", () => {
    const rows = toQuoteUsedParts(
      [request("r1", [{ no: 11, issued: 1 }, { no: 12, issued: 1 }])],
      [part({ no: 11, name: "ㄴ부품" }), part({ no: 12, name: "ㄱ부품" })]
    );
    assert.deepEqual(
      rows.map((row) => row.option?.partName),
      ["ㄱ부품", "ㄴ부품"]
    );
  });
});

describe("출고된 부품 — 금액", () => {
  test("그 부품의 **견적가**가 따라온다", () => {
    const rows = toQuoteUsedParts(
      [request("r1", [{ no: 11, issued: 2 }])],
      [part({ no: 11, quotePrice: 125000 })]
    );
    assert.equal(rows[0].unitPrice, "125000");
  });

  test("🔴 정해 두지 않은 견적가는 null 이다 — 0 이 아니다", () => {
    const rows = toQuoteUsedParts(
      [request("r1", [{ no: 11, issued: 1 }])],
      [part({ no: 11, quotePrice: null })]
    );
    assert.equal(rows[0].unitPrice, null, "정하지 않은 값이 0 으로 바뀌면 0원으로 청구된다");
  });

  test("0원(무상)으로 정해 둔 값은 그대로 온다 — 「정하지 않음」과 다르다", () => {
    const rows = toQuoteUsedParts(
      [request("r1", [{ no: 11, issued: 1 }])],
      [part({ no: 11, quotePrice: 0 })]
    );
    assert.equal(rows[0].unitPrice, "0");
  });

  test("🔴 출고 줄에 **O/H 견적가를 쓰지 않는다** — 실제로 나간 물건이다", () => {
    const rows = toQuoteUsedParts(
      [request("r1", [{ no: 11, issued: 1 }])],
      [part({ no: 11, quotePrice: 1000, overhaulQuotePrice: 9999 })]
    );
    assert.equal(rows[0].unitPrice, "1000");
  });
});

describe("🔴 되짚지 못한 줄도 목록에 남는다 — 담을 수 없을 뿐이다", () => {
  test("재고 마스터에 없는 부품도 줄로 남고, 담을 근거(option)는 비어 있다", () => {
    const rows = toQuoteUsedParts(
      [request("r1", [{ no: 404, name: "사라진부품", issued: 2 }])],
      [part({ no: 11 })]
    );

    assert.equal(rows.length, 1, "나간 부품이 목록에서 사라지면 청구를 빠뜨린다");
    assert.equal(rows[0].option, null);
    assert.equal(rows[0].requestedName, "사라진부품", "보여 줄 이름이 없다");
    assert.equal(rows[0].quantity, 2);
    assert.equal(rows[0].unitPrice, null, "되짚지 못한 줄에 금액을 지어냈다");
  });

  test("번호가 없는 줄(저쪽에서 지워진 부품)도 같은 규칙이다", () => {
    const rows = toQuoteUsedParts(
      [request("r1", [{ no: null, name: "(지워진 부품)", issued: 1 }])],
      [part({ no: 11 })]
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].option, null);
    assert.equal(rows[0].sourceKey, "issued:gone:(지워진 부품)");
  });

  test("못 담는 까닭이 「고객사 품명을 채우세요」와 **다른 말**이다 — 할 일이 다르다", () => {
    assert.notEqual(USED_PART_NOT_IN_INVENTORY_MESSAGE, OH_TEMPLATE_PART_NOT_LINKED_MESSAGE);
    for (const message of [USED_PART_NOT_IN_INVENTORY_MESSAGE, OH_TEMPLATE_PART_NOT_LINKED_MESSAGE]) {
      assert.doesNotMatch(message, /고객사 품명/);
    }
  });
});

describe("🔴 고객사 품명을 우리 품명으로 때우지 않는다", () => {
  test("비어 있으면 **빈 채로** 실린다 — 고를 수 있는지는 고르개가 그 값으로 가른다", () => {
    const rows = toQuoteUsedParts(
      [request("r1", [{ no: 11, issued: 1 }])],
      [part({ no: 11, name: "우리품명", customerName: "" })]
    );

    assert.equal(rows[0].option?.customerPartName, "");
    assert.equal(rows[0].option?.partName, "우리품명", "우리 품명까지 지워졌다");
    // 🔴 때우면 고객사가 모르는 이름이 서류에 찍히고, 빈칸과 달리 아무도 되묻지 않는다.
    assert.notEqual(rows[0].option?.customerPartName, "우리품명");
  });

  test("🔴 `-` 만 적힌 칸도 **없는 칸**이다 — 날값을 그대로 실어 같은 자로 재게 한다", () => {
    const rows = toQuoteUsedParts(
      [request("r1", [{ no: 11, issued: 1 }])],
      [part({ no: 11, customerName: "-" })]
    );
    // 날값은 그대로 오고(`-`), 「값이 있는가」를 재는 자는 한 벌(partFieldValue)이다.
    assert.equal(rows[0].option?.customerPartName, "-");
    assert.equal(partFieldValue(rows[0].option?.customerPartName), "");
  });
});

describe("O/H 템플릿", () => {
  test("이어 둔 템플릿이 없으면 null 이다 — 오류가 아니다", () => {
    assert.equal(toQuoteOhTemplate(null, [part({ no: 11 })]), null);
  });

  test("차례는 템플릿에 늘어놓은 **순서 그대로**다 — 양식의 부품 순서가 뜻을 갖는다", () => {
    const result = toQuoteOhTemplate(
      template([
        { no: 13, name: "셋째" },
        { no: 11, name: "첫째" },
        { no: 12, name: "둘째" },
      ]),
      [part({ no: 11 }), part({ no: 12 }), part({ no: 13 })]
    );

    assert.deepEqual(result?.parts.map((row) => row.templateName), ["셋째", "첫째", "둘째"]);
    assert.deepEqual(result?.parts.map((row) => row.sourceKey), ["ohtpl:0", "ohtpl:1", "ohtpl:2"]);
  });

  test("그 부품의 **O/H 견적가**가 따라온다", () => {
    const result = toQuoteOhTemplate(
      template([{ no: 11, name: "휴즈" }]),
      [part({ no: 11, quotePrice: 1000, overhaulQuotePrice: 700 })]
    );
    assert.equal(result?.parts[0].overhaulUnitPrice, "700");
  });

  test("🔴 O/H 견적가가 없으면 **빈칸이다 — 일반 견적가로 때우지 않는다**", () => {
    const result = toQuoteOhTemplate(
      template([{ no: 11, name: "휴즈" }]),
      [part({ no: 11, quotePrice: 1000, overhaulQuotePrice: null })]
    );
    assert.equal(
      result?.parts[0].overhaulUnitPrice,
      null,
      "일반 견적가가 O/H 줄에 들어가면 틀린 금액이 견적서에 박힌다"
    );
  });

  test("0원(무상) O/H 견적가는 그대로 온다", () => {
    const result = toQuoteOhTemplate(
      template([{ no: 11, name: "휴즈" }]),
      [part({ no: 11, overhaulQuotePrice: 0 })]
    );
    assert.equal(result?.parts[0].overhaulUnitPrice, "0");
  });

  test("🔴 재고에 **안 이어진 줄**도 목록에 남는다 — 담을 근거만 없다", () => {
    const result = toQuoteOhTemplate(
      template([
        { no: null, name: "양식에서 옮겨 온 이름", linked: false },
        { no: 11, name: "이어진 줄" },
      ]),
      [part({ no: 11 })]
    );

    assert.equal(result?.parts.length, 2, "안 이어진 줄을 조용히 뺐다");
    assert.equal(result?.parts[0].option, null);
    assert.equal(result?.parts[0].templateName, "양식에서 옮겨 온 이름", "보여 줄 이름이 없다");
    assert.equal(result?.parts[0].overhaulUnitPrice, null);
    assert.ok(result?.parts[1].option, "이어진 줄까지 못 되짚었다");
  });

  test("🔴 `linked` 가 거짓이면 번호가 있어도 되짚지 않는다 — 한쪽 약속이 깨져도 안전하게", () => {
    const result = toQuoteOhTemplate(
      template([{ no: 11, name: "거짓으로 이어진 줄", linked: false }]),
      [part({ no: 11 })]
    );
    assert.equal(result?.parts[0].option, null);
  });

  test("템플릿 이름은 저쪽이 적어 둔 그대로 온다", () => {
    const result = toQuoteOhTemplate(template([{ no: 11, name: "휴즈" }]), [part({ no: 11 })]);
    assert.equal(result?.name, "시험용 O/H 템플릿");
  });
});
