import { test, describe } from "node:test";
import assert from "node:assert/strict";
import type { PartPickerRow } from "@dss/core/ui/inventory/part-picker-rows";
import type {
  InventoryResult,
  InventoryStockRequest,
  InventoryStockRequestLine,
} from "@/lib/domain/inventory-gateway";
import { buildFaultPartBreakdown, type RequestedPartRow, type UsedPartRow } from "@/lib/domain/product-model-breakdown";
import { issuedPartRowsOf, toFaultPartRows } from "@/lib/domain/product-model-fault-parts";
import { buildUsedPartNameIndex, type UsedPartNameIndex } from "@/lib/domain/used-part-display";

/**
 * ============================================================================
 * [고장 부품] 그래프 — 요청 · 사용 · 반출을 **한 글자로** 묶는다 (2026-10-29)
 * ============================================================================
 * 🔴 **2026-10-29 전까지 이 그래프에는 사용 부품이 한 줄도 안 들어왔다.** 그런데 그
 *    사실을 막는 단언이 어디에도 없어서, 옛 설계가 초록 ✔ 로 통과하고 있었다. 여기서
 *    못 박는 것은 「무엇을 세는가」다:
 *      · 사용 부품만 있는 모델에서 그래프가 **빈 게 아니라 그 부품들**을 보인다
 *      · 같은 부품이면 두 출처가 **한 조각**으로 묶인다
 *      · 겹치면 **둘 다** 센다
 *      · 재고 관리가 멈춰도(`unreachable`) 품번으로 묶이고 그래프가 **안 깨진다**
 *
 * 🔴 **같은 날 셋째 입력(반출 확인된 부품)이 들어왔다.** 같은 함정이 한 번 더 있었다 —
 *    2026-10-16 부터 반출 요청이 재고 관리로 올라가 A/S 옛 표에는 한 줄도 안 쌓이는데,
 *    그래프는 그 옛 표만 보고 있었다. 아래 마지막 두 묶음이 못 박는 것:
 *      · **실제로 나간 줄만** 센다(`issued >= 1`) — 🔴 **상태로는 거르지 않는다**
 *      · 칸 이름을 옮겨 적는다(`name2` → 품명2, `name` → 품명)
 *      · 세 입력이 같은 부품이면 **한 조각**이다
 *
 * 🔴 **같은 날 오후에 셈법이 한 번 더 바뀌었다 — 줄 수에서 수량으로.** 사용자가 운영
 *    화면 둘을 나란히 보여 줬다: 한 건에서 5+5+3+5 = **18개**가 나갔는데 그래프는
 *    「부품 4개」라고 적고 있었다. 맨 아래 묶음이 그 셋을 못 박는다 — 세 입력이 **각각
 *    어느 칸**을 수량으로 쓰는가, 비면 어떻게 되는가, 겹치면 더해지는가.
 *
 * 🔴 **부품 이름·품번·인수번호는 전부 가짜다**(`AA000111`·`D000111` 꼴). 실제 고객사명·
 *    품번을 적으면 공개 저장소에 박힌다.
 *
 * 🔵 맞대기 시험은 **표본이 비면 공짜로 통과한다** — 그래서 묶음마다 지도가 실제로
 *    무엇을 담고 있는지를 먼저 단언한다.
 * ============================================================================
 */

/** 재고 관리에서 받아 온 줄 하나. 안 적은 칸은 빈 글자다(저쪽도 그렇게 준다). */
function inventoryRow(row: Partial<PartPickerRow> & { id: string }): PartPickerRow {
  return {
    partName: "",
    partSpec: "",
    drawingNo: "",
    kyosanPartNo: "",
    customerPartName: "",
    ...row,
  };
}

function okIndex(rows: readonly PartPickerRow[]): UsedPartNameIndex {
  return buildUsedPartNameIndex({ status: "ok", value: rows });
}

/**
 * A/S 부품 표(`parts`)에서 읽은 요청 줄 하나. 🔴 고객사 품명 칸은 **없다.**
 * 🔵 수량의 기본값은 **1** 이다 — 「줄 하나가 한 개」였던 예전과 같은 수라, 묶는 규칙을
 *    보는 아래 시험들의 기대값이 그대로 참이다. 수량을 세는지는 맨 아래 묶음이 따로 본다.
 */
function requested(
  repairCaseId: string,
  fields: Partial<Omit<RequestedPartRow, "repairCaseId">> = {}
): RequestedPartRow {
  return {
    repairCaseId,
    quantity: 1,
    partName: "",
    partSpec: null,
    kyosanPartNo: null,
    drawingNo: null,
    ...fields,
  };
}

/**
 * 연락서에서 읽어 저장한 사용 부품 줄 하나. 🔴 적혀 있는 글자는 **품번**이다.
 * 🔵 수량은 안 적으면 1 — 위 `requested` 와 같은 까닭이다.
 */
function used(repairCaseId: string, partNameText: string, quantity = 1): UsedPartRow {
  return { repairCaseId, partNameText, quantity };
}

/**
 * 재고 관리가 돌려준 반출 신청 한 건. 🔴 **안 적은 칸은 저쪽 파서가 눕히는 값 그대로**다
 * (빈 글자 · 0 · null) — 시험이 저쪽보다 너그러운 모양을 만들면 거기서만 통과한다.
 * 🔴 `repairCaseId` 가 **없다**. 응답에는 인수번호만 있고, 짝은 부르는 쪽이 붙인다.
 */
function stockRequest(
  statusCode: string,
  lines: readonly Partial<InventoryStockRequestLine>[]
): InventoryStockRequest {
  return {
    requestKey: null,
    id: `req-${statusCode}`,
    intakeNumber: "D000111",
    status: { code: statusCode, label: statusCode },
    closed: false,
    requestedAt: "2026-10-29T01:00:00.000Z",
    note: "",
    lines: lines.map((line) => ({
      no: null,
      name: "",
      quantity: 0,
      issued: 0,
      customerName: "",
      name2: "",
      kyosanPartNo: "",
      drawingNo: "",
      owner: null,
      chargeType: null,
      fromOhTemplate: false,
      ...line,
    })),
    decision: null,
    hold: null,
    requester: null,
  };
}

function labelsOf(rows: readonly { displayName: string }[]): string[] {
  return rows.map((row) => row.displayName);
}

describe("고장 부품 — 사용 부품이 그래프에 들어온다", () => {
  test("🔴 사용 부품만 있는 모델도 그래프가 빈 게 아니라 그 부품들을 보인다", () => {
    const index = okIndex([
      inventoryRow({ id: "1", drawingNo: "AA000111", customerPartName: "전원 퓨즈" }),
    ]);
    assert.equal(index.byDrawingNo.size, 1, "지도가 비었으면 아래가 공짜로 통과한다");

    const rows = toFaultPartRows(
      { requested: [], used: [used("case-A", "AA000111"), used("case-B", "AA000222")], issued: [] },
      index
    );
    const breakdown = buildFaultPartBreakdown(rows);

    assert.equal(breakdown.total, 2, "🔴 2026-10-29 전에는 여기가 0 이었다");
    assert.equal(breakdown.caseWithPartRecordCount, 2);
    assert.deepEqual(labelsOf(rows), ["전원 퓨즈 (AA000111)", "AA000222"]);
    // 조각 차례는 건수 → 이름 오름차순(`localeCompare("ko")`)이다. 건수가 같아 이름이
    // 가르는데, 그 비교에서 한글이 라틴 글자보다 앞선다.
    assert.deepEqual(
      breakdown.slices.map((slice) => slice.label),
      ["전원 퓨즈 (AA000111)", "AA000222"]
    );
  });

  test("요청 부품도 「고객사 품명 (품번)」으로 바뀐다 — 품명만 적히던 자리다", () => {
    const index = okIndex([
      inventoryRow({ id: "1", drawingNo: "AA000111", customerPartName: "전원 퓨즈" }),
    ]);
    const rows = toFaultPartRows(
      {
        requested: [requested("case-A", { partName: "FUSE 1A", drawingNo: "AA000111" })],
        used: [],
        issued: [],
      },
      index
    );
    assert.deepEqual(labelsOf(rows), ["전원 퓨즈 (AA000111)"]);
  });

  test("셋 다 비면 빈 그래프다 — 조각을 지어내지 않는다", () => {
    const rows = toFaultPartRows({ requested: [], used: [], issued: [] }, okIndex([]));
    const breakdown = buildFaultPartBreakdown(rows);
    assert.deepEqual(rows, []);
    assert.equal(breakdown.total, 0);
    assert.deepEqual(breakdown.slices, []);
  });
});

describe("고장 부품 — 같은 부품이면 한 조각", () => {
  test("🔴 요청 줄과 사용 줄이 같은 부품이면 조각 하나로 묶인다(표시 이름이 같으니까)", () => {
    const index = okIndex([
      inventoryRow({ id: "1", drawingNo: "AA000111", customerPartName: "전원 퓨즈" }),
    ]);
    const rows = toFaultPartRows(
      {
        requested: [requested("case-A", { partName: "FUSE 1A", drawingNo: "AA000111" })],
        used: [used("case-B", "AA000111")],
        issued: [],
      },
      index
    );
    assert.deepEqual(labelsOf(rows), ["전원 퓨즈 (AA000111)", "전원 퓨즈 (AA000111)"]);

    const breakdown = buildFaultPartBreakdown(rows);
    assert.equal(breakdown.slices.length, 1, "🔴 두 조각으로 갈리면 안 된다");
    assert.equal(breakdown.slices[0].label, "전원 퓨즈 (AA000111)");
    assert.equal(breakdown.slices[0].count, 2);
    assert.equal(breakdown.caseWithPartRecordCount, 2);
  });

  test("이름을 못 얻어도 품번이 같으면 한 조각이다 — 품번 글자가 곧 열쇠다", () => {
    // 재고 관리에 그 품번이 없다(이름을 못 얻는 길 ㉠).
    const index = okIndex([
      inventoryRow({ id: "1", drawingNo: "AA000999", customerPartName: "다른 부품" }),
    ]);
    assert.equal(index.byDrawingNo.size, 1, "지도에 **다른** 품번은 담겨 있다");

    const rows = toFaultPartRows(
      {
        requested: [requested("case-A", { partName: "FUSE 1A", drawingNo: "AA000111" })],
        used: [used("case-B", "AA000111")],
        issued: [],
      },
      index
    );
    const breakdown = buildFaultPartBreakdown(rows);
    assert.deepEqual(labelsOf(rows), ["AA000111", "AA000111"]);
    assert.equal(breakdown.slices.length, 1);
    assert.equal(breakdown.slices[0].count, 2);
  });

  test("🔴 괄호 안은 저장된 글자 그대로라, 품번 표기가 다르면 조각이 갈린다", () => {
    // 🔵 알고 감수하는 자리다. 맞대는 열쇠는 붙임표를 지우고 보지만(이름은 둘 다
    //    붙는다), **보여 주는 글자**는 각자 적힌 그대로여서 조각이 둘이 된다.
    const index = okIndex([
      inventoryRow({ id: "1", drawingNo: "AA-000111", customerPartName: "전원 퓨즈" }),
    ]);
    const rows = toFaultPartRows(
      {
        requested: [requested("case-A", { drawingNo: "AA-000111" })],
        used: [used("case-B", "AA000111")],
        issued: [],
      },
      index
    );
    assert.deepEqual(labelsOf(rows), ["전원 퓨즈 (AA-000111)", "전원 퓨즈 (AA000111)"]);
    assert.equal(buildFaultPartBreakdown(rows).slices.length, 2);
  });
});

describe("고장 부품 — 겹치면 둘 다 센다", () => {
  /**
   * 🔴 **한 건에서 같은 부품이 요청 줄에도 있고 사용 부품 줄에도 있으면 2 다.**
   *
   * 지우지 않는 까닭은 `product-model-fault-parts.ts` 머리말에 적어 두었다 — 두 줄이
   * 각각 일어난 일이고, 이 그래프의 셈법이 처음부터 「줄 하나가 한 개」다. 🔵 요청 줄과
   * 사용 줄 사이는 화면이 한 건의 부품 출처를 둘로 쪼개지 않아 지금 실질적으로 겹치지
   * 않지만(운영 실측 2026-10-29, 백필 대상 463건 중 「부품 요청 있음」 0건), 🔴 **반출
   * 줄과는 지금도 겹친다**(그 울타리가 보는 표가 2026-10-16 부터 멈춘 A/S 옛 표다).
   */
  test("🔴 같은 건에서 둘 다 나오면 2 로 센다 — 조용히 한쪽을 지우지 않는다", () => {
    const index = okIndex([
      inventoryRow({ id: "1", drawingNo: "AA000111", customerPartName: "전원 퓨즈" }),
    ]);
    const rows = toFaultPartRows(
      {
        requested: [requested("case-A", { partName: "FUSE 1A", drawingNo: "AA000111" })],
        used: [used("case-A", "AA000111")],
        issued: [],
      },
      index
    );
    const breakdown = buildFaultPartBreakdown(rows);

    assert.equal(breakdown.total, 2, "🔴 겹친 줄을 지우면 1 이 된다");
    assert.equal(breakdown.slices.length, 1);
    assert.equal(breakdown.slices[0].count, 2);
    assert.equal(breakdown.caseWithPartRecordCount, 1, "건은 하나다 — 줄이 둘일 뿐이다");
  });
});

describe("고장 부품 — 재고 관리가 멈춰도 선다", () => {
  test("🔴 못 물어봤으면 품번으로 묶이고 그래프가 안 깨진다 — 빈 칸도 오류도 아니다", () => {
    const unreachable: InventoryResult<readonly PartPickerRow[]> = {
      status: "unreachable",
      reason: "timeout",
    };
    const index = buildUsedPartNameIndex(unreachable);
    assert.equal(index.byDrawingNo.size, 0);
    assert.equal(index.byPartName.size, 0);

    const rows = toFaultPartRows(
      {
        requested: [requested("case-A", { partName: "FUSE 1A", drawingNo: "AA000111" })],
        used: [used("case-B", "AA000111"), used("case-C", "AA000222")],
        issued: [],
      },
      index
    );
    const breakdown = buildFaultPartBreakdown(rows);

    assert.deepEqual(labelsOf(rows), ["AA000111", "AA000111", "AA000222"]);
    assert.equal(breakdown.total, 3, "🔴 한 줄도 사라지지 않는다");
    assert.deepEqual(
      breakdown.slices.map((slice) => [slice.label, slice.count]),
      [
        ["AA000111", 2],
        ["AA000222", 1],
      ]
    );
  });
});

describe("고장 부품 — 요청 줄의 품번은 어느 칸인가", () => {
  test("🔴 도번이 먼저다 — 교산 품번·품명2·품명이 함께 있어도 도번을 쓴다", () => {
    const index = okIndex([]);
    const rows = toFaultPartRows(
      {
        requested: [
          requested("case-A", {
            partName: "FUSE 1A",
            partSpec: "AC100V",
            kyosanPartNo: "KY000111",
            drawingNo: "AA000111",
          }),
        ],
        used: [],
        issued: [],
      },
      index
    );
    assert.deepEqual(labelsOf(rows), ["AA000111"]);
  });

  test("도번이 없으면 교산 품번 → 품명2 → 품명 차례로 내려간다", () => {
    const index = okIndex([]);
    const rows = toFaultPartRows(
      {
        requested: [
          requested("case-A", { partName: "FUSE 1A", partSpec: "AC100V", kyosanPartNo: "KY000111" }),
          requested("case-B", { partName: "FUSE 1A", partSpec: "AC100V" }),
          requested("case-C", { partName: "FUSE 1A" }),
        ],
        used: [],
        issued: [],
      },
      index
    );
    assert.deepEqual(labelsOf(rows), ["KY000111", "AC100V", "FUSE 1A"]);
  });

  test("🔴 `-` 만 적힌 칸은 없는 칸이다 — 그 줄을 건너뛰고 다음 칸으로 간다", () => {
    const index = okIndex([]);
    const rows = toFaultPartRows(
      {
        requested: [requested("case-A", { partName: "FUSE 1A", drawingNo: "-", kyosanPartNo: "－" })],
        used: [],
        issued: [],
      },
      index
    );
    assert.deepEqual(labelsOf(rows), ["FUSE 1A"], "`-` 를 품번으로 보이면 조각 이름이 `-` 가 된다");
  });

  test("네 칸이 다 비면 빈 글자이고, 그래프가 미입력 조각으로 센다 — 버리지 않는다", () => {
    const rows = toFaultPartRows(
      { requested: [requested("case-A")], used: [], issued: [] },
      okIndex([])
    );
    assert.deepEqual(labelsOf(rows), [""]);

    const breakdown = buildFaultPartBreakdown(rows);
    assert.equal(breakdown.total, 1);
    assert.equal(breakdown.slices.length, 1);
    assert.equal(breakdown.slices[0].sliceKind, "UNSPECIFIED");
  });

  test("요청 줄도 품명2·품명 칸으로 이름을 얻는다 — 지도 넷을 다 본다", () => {
    const index = okIndex([
      inventoryRow({ id: "1", partName: "FUSE 1A", customerPartName: "전원 퓨즈" }),
    ]);
    assert.equal(index.byPartName.size, 1, "지도가 비었으면 아래가 공짜로 통과한다");

    const rows = toFaultPartRows(
      { requested: [requested("case-A", { partName: "FUSE 1A" })], used: [], issued: [] },
      index
    );
    assert.deepEqual(labelsOf(rows), ["전원 퓨즈 (FUSE 1A)"]);
  });
});

/**
 * ============================================================================
 * 🔴 반출 확인된 부품 — **실제로 나간 줄만** (2026-10-29 사용자 결정)
 * ============================================================================
 * 「반출 확인된」은 **물건이 실제로 나갔다**는 뜻이다. 🔴 상태로 거르지 않고 줄의
 * `issued` 로 가른다 — `PARTIAL` 한 건 안에서도 나간 줄과 안 나간 줄이 섞여 있다.
 * ============================================================================
 */
describe("반출 확인된 부품 — issued 로 가른다", () => {
  test("🔴 issued 가 0 인 줄은 안 센다 — 신청만 하고 안 나간 부품은 고장 부품이 아니다", () => {
    const rows = issuedPartRowsOf("case-A", [
      stockRequest("PENDING", [
        { drawingNo: "AA000111", issued: 0 },
        { drawingNo: "AA000222", issued: 0 },
      ]),
    ]);
    assert.deepEqual(rows, [], "🔴 대기 중인 신청의 줄이 한 줄이라도 세어지면 안 된다");
  });

  test("🔴 issued 가 1 이상이면 **상태가 무엇이든** 센다 — 여덟 상태를 다 본다", () => {
    for (const statusCode of [
      "PENDING",
      "IN_APPROVAL",
      "CONFIRMING",
      "PARTIAL",
      "CONFIRMED",
      "REJECTED",
      "CANCELLED",
      "ON_HOLD",
    ]) {
      const rows = issuedPartRowsOf("case-A", [
        stockRequest(statusCode, [{ drawingNo: "AA000111", issued: 1 }]),
      ]);
      assert.equal(rows.length, 1, `${statusCode} 에서 나간 줄이 빠졌다`);
      assert.equal(rows[0].drawingNo, "AA000111");
    }
  });

  test("🔴 PARTIAL 한 건 안에서 나간 줄만 센다 — 신청 단위로 가리면 반드시 한쪽을 틀린다", () => {
    const rows = issuedPartRowsOf("case-A", [
      stockRequest("PARTIAL", [
        { drawingNo: "AA000111", quantity: 2, issued: 2 },
        { drawingNo: "AA000222", quantity: 3, issued: 0 },
        { drawingNo: "AA000333", quantity: 1, issued: 1 },
      ]),
    ]);
    assert.deepEqual(
      rows.map((row) => row.drawingNo),
      ["AA000111", "AA000333"]
    );
  });

  test("🔵 반려·취소는 **따로 빼지 않아도** 빠진다 — 나간 것이 없기 때문이다", () => {
    const rows = issuedPartRowsOf("case-A", [
      stockRequest("REJECTED", [{ drawingNo: "AA000111", quantity: 2, issued: 0 }]),
      stockRequest("CANCELLED", [{ drawingNo: "AA000222", quantity: 1, issued: 0 }]),
    ]);
    assert.deepEqual(rows, []);
  });

  /**
   * 🔴 **제목을 뒤집었다**(2026-10-29 오후). 같은 날 오전의 제목은 이랬다 —
   *
   *   > "🔴 수량은 안 쓴다 — 5개가 나간 줄도 그래프에서는 한 개다"
   *   > (단언: `assert.equal(rows.length, 1, "🔴 issued 를 수로 쓰면 여기가 5 가 된다")`)
   *
   * 단언은 맞았지만 **그 설계가 사용자 신고의 원인**이었다. 운영에서 한 건에 5+5+3+5 가
   * 나갔는데 그래프에 「부품 4개」가 떠 있었고, 사용자 말이 「그러지 말고 **실제로 사용된
   * 부품의 수**를 표시해줘」다. 🔵 줄 수는 그대로 1 이다 — 바뀐 것은 **그 줄을 몇으로
   * 세는가**이고, 그 수가 `quantity` 칸에 실려 나간다.
   */
  test("🔴 5개가 나간 줄은 **5개**다 — 줄 수(1)가 아니라 그 수를 싣는다", () => {
    const rows = issuedPartRowsOf("case-A", [
      stockRequest("CONFIRMED", [{ drawingNo: "AA000111", quantity: 5, issued: 5 }]),
    ]);
    assert.equal(rows.length, 1, "줄은 하나다 — 줄을 쪼개는 것이 아니다");
    assert.equal(rows[0].quantity, 5, "🔴 여기가 1 이면 18개가 나간 건이 4개로 뜬다");
  });

  test("🔴 **요청 수가 아니라 나간 수**다 — 5개 요청하고 2개 나갔으면 2 다", () => {
    const rows = issuedPartRowsOf("case-A", [
      stockRequest("PARTIAL", [{ drawingNo: "AA000111", quantity: 5, issued: 2 }]),
    ]);
    assert.equal(rows[0].quantity, 2, "🔴 `quantity` 를 쓰면 안 나간 3개가 고장 부품이 된다");
  });

  test("🔵 수량이 깨져 와도 **1 로는 선다** — 0 으로 세면 줄이 조용히 사라진다", () => {
    /**
     * 🔴 저쪽 파서는 `typeof === "number"` 만 본다(`domain/inventory-gateway.ts`) — 소수가
     *    글자 그대로 들어온다. 부품은 2.5개가 나갈 수 없으니 **버려서** 2 로 센다.
     * 🔵 `issued` 가 1 미만인 줄은 애초에 안 오므로(바로 위 묶음) 0·음수는 이 자를 거치지
     *    않는다. 그래도 눕히는 자는 세 입력이 **같은 문**을 쓴다(`faultPartQuantity`).
     */
    const rows = issuedPartRowsOf("case-A", [
      stockRequest("CONFIRMED", [{ drawingNo: "AA000111", issued: 2.5 }]),
    ]);
    assert.equal(rows[0].quantity, 2, "소수는 버린다 — 올리면 안 나간 것을 센다");
  });

  test("신청이 여러 건이면 전부 모은다 — 건 하나에 신청이 여럿일 수 있다", () => {
    const rows = issuedPartRowsOf("case-A", [
      stockRequest("CONFIRMED", [{ drawingNo: "AA000111", issued: 1 }]),
      stockRequest("PARTIAL", [{ drawingNo: "AA000222", issued: 1 }]),
    ]);
    assert.deepEqual(
      rows.map((row) => row.drawingNo),
      ["AA000111", "AA000222"]
    );
  });

  test("🔴 repairCaseId 는 **부르는 쪽이 붙인다** — 응답에는 그 칸이 없다", () => {
    const rows = issuedPartRowsOf("case-Z", [
      stockRequest("CONFIRMED", [{ drawingNo: "AA000111", issued: 1 }]),
    ]);
    assert.deepEqual(
      rows.map((row) => row.repairCaseId),
      ["case-Z"]
    );
  });

  test("신청이 하나도 없으면 빈 배열 — 「없다」와 「못 받아 왔다」는 부르는 쪽이 가른다", () => {
    assert.deepEqual(issuedPartRowsOf("case-A", []), []);
  });
});

describe("반출 확인된 부품 — 칸 이름을 옮겨 적는다", () => {
  test("🔴 저쪽 `name2` 가 품명2, `name` 이 품명이다 — 넷이 그대로 넘어온다", () => {
    const rows = issuedPartRowsOf("case-A", [
      stockRequest("CONFIRMED", [
        {
          issued: 1,
          name: "FUSE 1A",
          name2: "AC100V",
          kyosanPartNo: "KY000111",
          drawingNo: "AA000111",
        },
      ]),
    ]);
    assert.deepEqual(rows, [
      {
        repairCaseId: "case-A",
        // 🔴 나간 수가 **칸 하나로** 실려 나간다(2026-10-29). 이 칸이 없으면 그래프가
        //    줄 수를 센다 — 그 설계가 사용자 신고의 원인이었다.
        quantity: 1,
        partName: "FUSE 1A",
        partSpec: "AC100V",
        kyosanPartNo: "KY000111",
        drawingNo: "AA000111",
      },
    ]);
  });

  test("🔴 품번 고르는 차례는 요청 줄과 **같은 자**다 — 도번이 먼저", () => {
    const rows = toFaultPartRows(
      {
        requested: [],
        used: [],
        issued: issuedPartRowsOf("case-A", [
          stockRequest("CONFIRMED", [
            {
              issued: 1,
              name: "FUSE 1A",
              name2: "AC100V",
              kyosanPartNo: "KY000111",
              drawingNo: "AA000111",
            },
          ]),
        ]),
      },
      okIndex([])
    );
    assert.deepEqual(labelsOf(rows), ["AA000111"]);
  });

  test("도번이 비면 교산 품번 → 품명2 → 품명 차례로 내려간다 — 빈 글자는 없는 칸이다", () => {
    const rows = toFaultPartRows(
      {
        requested: [],
        used: [],
        issued: issuedPartRowsOf("case-A", [
          stockRequest("CONFIRMED", [
            { issued: 1, name: "FUSE 1A", name2: "AC100V", kyosanPartNo: "KY000111" },
            { issued: 1, name: "FUSE 1A", name2: "AC100V" },
            { issued: 1, name: "FUSE 1A" },
          ]),
        ]),
      },
      okIndex([])
    );
    assert.deepEqual(labelsOf(rows), ["KY000111", "AC100V", "FUSE 1A"]);
  });

  test("반출 줄도 「고객사 품명 (품번)」이 된다 — 이름은 재고 관리에서 온다", () => {
    const index = okIndex([
      inventoryRow({ id: "1", drawingNo: "AA000111", customerPartName: "전원 퓨즈" }),
    ]);
    assert.equal(index.byDrawingNo.size, 1, "지도가 비었으면 아래가 공짜로 통과한다");

    const rows = toFaultPartRows(
      {
        requested: [],
        used: [],
        issued: issuedPartRowsOf("case-A", [
          stockRequest("CONFIRMED", [{ issued: 1, drawingNo: "AA000111" }]),
        ]),
      },
      index
    );
    assert.deepEqual(labelsOf(rows), ["전원 퓨즈 (AA000111)"]);
  });
});

describe("반출 확인된 부품 — 세 입력이 한 그래프에 모인다", () => {
  test("🔴 세 출처가 같은 부품이면 **조각 하나**로 묶이고 3 으로 센다", () => {
    const index = okIndex([
      inventoryRow({ id: "1", drawingNo: "AA000111", customerPartName: "전원 퓨즈" }),
    ]);
    assert.equal(index.byDrawingNo.size, 1, "지도가 비었으면 아래가 공짜로 통과한다");

    const rows = toFaultPartRows(
      {
        requested: [requested("case-A", { partName: "FUSE 1A", drawingNo: "AA000111" })],
        used: [used("case-B", "AA000111")],
        issued: issuedPartRowsOf("case-C", [
          stockRequest("CONFIRMED", [{ issued: 1, name: "FUSE 1A", drawingNo: "AA000111" }]),
        ]),
      },
      index
    );
    const breakdown = buildFaultPartBreakdown(rows);

    assert.deepEqual(labelsOf(rows), [
      "전원 퓨즈 (AA000111)",
      "전원 퓨즈 (AA000111)",
      "전원 퓨즈 (AA000111)",
    ]);
    assert.equal(breakdown.slices.length, 1, "🔴 세 조각으로 갈리면 안 된다");
    assert.equal(breakdown.slices[0].count, 3);
    assert.equal(breakdown.caseWithPartRecordCount, 3);
  });

  test("🔴 차례는 요청 → 사용 → 반출 — 같은 입력에 같은 배열이 나온다", () => {
    const rows = toFaultPartRows(
      {
        requested: [requested("case-A", { drawingNo: "AA000111" })],
        used: [used("case-B", "AA000222")],
        issued: issuedPartRowsOf("case-C", [
          stockRequest("CONFIRMED", [{ issued: 1, drawingNo: "AA000333" }]),
        ]),
      },
      okIndex([])
    );
    assert.deepEqual(labelsOf(rows), ["AA000111", "AA000222", "AA000333"]);
  });

  test("🔴 반출 줄이 같은 건에서 사용 부품과 겹쳐도 **둘 다** 센다 (2026-10-16 뒤의 모양)", () => {
    // 🔴 사용 부품 칸을 잠그는 판정이 보는 표는 A/S 옛 표라, 2026-10-16 뒤의 건은
    //    **칸이 열려 있고 재고 관리에도 반출 기록이 있다.** 겹침이 가정이 아니다.
    const rows = toFaultPartRows(
      {
        requested: [],
        used: [used("case-A", "AA000111")],
        issued: issuedPartRowsOf("case-A", [
          stockRequest("CONFIRMED", [{ issued: 1, drawingNo: "AA000111" }]),
        ]),
      },
      okIndex([])
    );
    const breakdown = buildFaultPartBreakdown(rows);

    assert.equal(breakdown.total, 2, "🔴 겹친 줄을 지우면 1 이 된다");
    assert.equal(breakdown.slices.length, 1);
    assert.equal(breakdown.slices[0].count, 2);
    assert.equal(breakdown.caseWithPartRecordCount, 1, "건은 하나다 — 줄이 둘일 뿐이다");
  });
});

/**
 * ============================================================================
 * 🔴 **세 입력의 수량이 각각 제 칸에서 온다** (2026-10-29 사용자 요청)
 * ============================================================================
 * 사용자 말: 「각 부품이 들어있는 수리건의 수 말고 **실제로 사용된 부품의 수**를
 * 표시해줘.」 운영 실측으로 한 건에 「요청 5 / 불출 5」가 넷(= 18개)인데 그래프는
 * **부품 4개**라고 적고 있었다.
 *
 * 🔴 여기서 못 박는 것은 **어느 칸을 수량으로 쓰는가**다 — 입력마다 다르다:
 *   · 요청 줄 — 요청한 수(`requested_quantity`). 🔴 나간 수가 **아니다**(대기 중인
 *     줄이 전부 0 이 되어 조용히 사라진다).
 *   · 사용 부품 줄 — 연락서에서 읽어 저장한 수(`quantity`).
 *   · 반출 줄 — **실제로 나간 수**(`issued`). 요청 수가 아니다(위 묶음).
 * ============================================================================
 */
describe("고장 부품 — 줄 수가 아니라 수량을 센다", () => {
  test("🔴 사용 부품의 수량이 3이면 **3** 으로 센다 — 줄 수로 세면 1 이다", () => {
    const rows = toFaultPartRows(
      { requested: [], used: [used("case-A", "AA000111", 3)], issued: [] },
      okIndex([])
    );
    const breakdown = buildFaultPartBreakdown(rows);

    assert.equal(breakdown.total, 3, "🔴 2026-10-29 오전까지 여기가 1 이었다");
    assert.equal(breakdown.slices[0].count, 3);
    // 🔴 펼친 자리의 수도 같은 자다 — 다르면 조각 제목과 그 안의 수가 어긋난다.
    assert.deepEqual(breakdown.slices[0].detail.parts.map((entry) => entry.count), [3]);
    assert.equal(breakdown.caseWithPartRecordCount, 1, "🔵 건수는 수량을 안 탄다");
  });

  test("🔴 요청 줄은 **요청한 수**로 센다", () => {
    const rows = toFaultPartRows(
      {
        requested: [requested("case-A", { drawingNo: "AA000111", quantity: 4 })],
        used: [],
        issued: [],
      },
      okIndex([])
    );
    assert.equal(buildFaultPartBreakdown(rows).total, 4);
  });

  test("🔴 반출 줄은 **실제로 나간 수**로 센다 — 운영 실측(5+5+3+5 = 18)", () => {
    // 🔵 사용자가 보낸 화면 그대로의 모양이다(품번은 가짜). 한 건의 한 신청에 네 줄.
    const rows = toFaultPartRows(
      {
        requested: [],
        used: [],
        issued: issuedPartRowsOf("case-A", [
          stockRequest("CONFIRMED", [
            { drawingNo: "AA000111", quantity: 5, issued: 5 },
            { drawingNo: "AA000222", quantity: 5, issued: 5 },
            { drawingNo: "AA000333", quantity: 3, issued: 3 },
            { drawingNo: "AA000444", quantity: 5, issued: 5 },
          ]),
        ]),
      },
      okIndex([])
    );
    const breakdown = buildFaultPartBreakdown(rows);

    assert.equal(rows.length, 4, "이 시험의 표본이 비었다 — 줄은 넷이어야 한다");
    assert.equal(breakdown.total, 18, "🔴 신고된 그 수다 — 줄 수로 세면 4 가 된다");
    assert.deepEqual(
      breakdown.slices.map((slice) => [slice.label, slice.count]),
      [
        ["AA000111", 5],
        ["AA000222", 5],
        ["AA000444", 5],
        ["AA000333", 3],
      ],
      "조각 차례는 수량 많은 순 → 이름 오름차순이다"
    );
    // 🔵 그래도 「부품 기록이 있는 건」은 **1건**이다 — 한 건에서 나온 18개다.
    assert.equal(breakdown.caseWithPartRecordCount, 1);
  });

  test("🔴 같은 부품이 여러 입력에 있으면 **수량이 더해진다**", () => {
    const index = okIndex([
      inventoryRow({ id: "1", drawingNo: "AA000111", customerPartName: "전원 퓨즈" }),
    ]);
    assert.equal(index.byDrawingNo.size, 1, "지도가 비었으면 아래가 공짜로 통과한다");

    const rows = toFaultPartRows(
      {
        requested: [requested("case-A", { drawingNo: "AA000111", quantity: 2 })],
        used: [used("case-B", "AA000111", 3)],
        issued: issuedPartRowsOf("case-C", [
          stockRequest("CONFIRMED", [{ drawingNo: "AA000111", quantity: 9, issued: 4 }]),
        ]),
      },
      index
    );
    const breakdown = buildFaultPartBreakdown(rows);

    assert.equal(breakdown.slices.length, 1, "🔴 세 조각으로 갈리면 안 된다");
    assert.equal(breakdown.slices[0].count, 9, "2 + 3 + 4 — 반출의 요청 수 9 를 쓰면 14 가 된다");
    assert.equal(breakdown.total, 9);
    assert.deepEqual(breakdown.slices[0].detail.parts.map((entry) => entry.count), [9]);
    assert.equal(breakdown.caseWithPartRecordCount, 3, "🔵 건은 셋이다 — 수량과 다른 자다");
  });

  test("🔵 수량이 **비어 있으면 1** 로 센다 — 줄이 조용히 사라지면 안 된다", () => {
    /**
     * 🔴 **타입이 막는 값을 일부러 만든다.** 세 입력 다 지금은 1 이상을 보장받는다
     *    (DB 체크 둘 · `issued >= 1` 거르기 하나 — `faultPartQuantity` 머리말). 하지만 그
     *    보장은 전부 **저쪽이 지키는 것**이고, 깨진 날 이 줄이 0 으로 세어지면 조각이
     *    통째로 사라져 **「그 부품은 안 나왔다」**는 거짓말이 된다. 줄이 있다는 사실 자체가
     *    「한 개 이상 나왔다」라, 1 로 서는 편이 참에 가깝다.
     * 🔵 이 저장소의 기존 규칙과 같은 모양이다(연락서 이식의 `?? 1`).
     */
    const broken = [
      { repairCaseId: "case-A", partNameText: "AA000111", quantity: null },
      { repairCaseId: "case-B", partNameText: "AA000222", quantity: 0 },
      { repairCaseId: "case-C", partNameText: "AA000333" },
    ] as unknown as UsedPartRow[];

    const breakdown = buildFaultPartBreakdown(
      toFaultPartRows({ requested: [], used: broken, issued: [] }, okIndex([]))
    );
    assert.equal(breakdown.total, 3, "세 줄이 1 개씩 — 0 으로 세면 조각이 사라진다");
    assert.deepEqual(
      breakdown.slices.map((slice) => slice.count),
      [1, 1, 1]
    );
  });
});
