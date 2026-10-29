import { test, describe } from "node:test";
import assert from "node:assert/strict";
import type { PartPickerRow } from "@dss/core/ui/inventory/part-picker-rows";
import type { InventoryResult } from "@/lib/domain/inventory-gateway";
import { buildFaultPartBreakdown, type RequestedPartRow, type UsedPartRow } from "@/lib/domain/product-model-breakdown";
import { toFaultPartRows } from "@/lib/domain/product-model-fault-parts";
import { buildUsedPartNameIndex, type UsedPartNameIndex } from "@/lib/domain/used-part-display";

/**
 * ============================================================================
 * [고장 부품] 그래프 — 요청 부품 + 사용 부품을 **한 글자로** 묶는다 (2026-10-29)
 * ============================================================================
 * 🔴 **2026-10-29 전까지 이 그래프에는 사용 부품이 한 줄도 안 들어왔다.** 그런데 그
 *    사실을 막는 단언이 어디에도 없어서, 옛 설계가 초록 ✔ 로 통과하고 있었다. 여기서
 *    못 박는 것은 「무엇을 세는가」다:
 *      · 사용 부품만 있는 모델에서 그래프가 **빈 게 아니라 그 부품들**을 보인다
 *      · 같은 부품이면 두 출처가 **한 조각**으로 묶인다
 *      · 겹치면 **둘 다** 센다
 *      · 재고 관리가 멈춰도(`unreachable`) 품번으로 묶이고 그래프가 **안 깨진다**
 *
 * 🔴 **부품 이름·품번은 전부 가짜다**(`AA000111` 꼴). 실제 고객사명·품번을 적으면
 *    공개 저장소에 박힌다.
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

/** A/S 부품 표(`parts`)에서 읽은 요청 줄 하나. 🔴 고객사 품명 칸은 **없다.** */
function requested(
  repairCaseId: string,
  fields: Partial<Omit<RequestedPartRow, "repairCaseId">> = {}
): RequestedPartRow {
  return {
    repairCaseId,
    partName: "",
    partSpec: null,
    kyosanPartNo: null,
    drawingNo: null,
    ...fields,
  };
}

/** 연락서에서 읽어 저장한 사용 부품 줄 하나. 🔴 적혀 있는 글자는 **품번**이다. */
function used(repairCaseId: string, partNameText: string): UsedPartRow {
  return { repairCaseId, partNameText };
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
      { requested: [], used: [used("case-A", "AA000111"), used("case-B", "AA000222")] },
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
      { requested: [requested("case-A", { partName: "FUSE 1A", drawingNo: "AA000111" })], used: [] },
      index
    );
    assert.deepEqual(labelsOf(rows), ["전원 퓨즈 (AA000111)"]);
  });

  test("둘 다 비면 빈 그래프다 — 조각을 지어내지 않는다", () => {
    const rows = toFaultPartRows({ requested: [], used: [] }, okIndex([]));
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
   * 각각 일어난 일이고, 이 그래프의 셈법이 처음부터 「줄 하나가 한 개」다. 🔵 화면이
   * 한 건의 부품 출처를 둘로 쪼개지 않아 지금 실질적으로 겹치지 않지만(운영 실측
   * 2026-10-29, 백필 대상 463건 중 「부품 요청 있음」 0건), 앞으로 생길 수 있다.
   */
  test("🔴 같은 건에서 둘 다 나오면 2 로 센다 — 조용히 한쪽을 지우지 않는다", () => {
    const index = okIndex([
      inventoryRow({ id: "1", drawingNo: "AA000111", customerPartName: "전원 퓨즈" }),
    ]);
    const rows = toFaultPartRows(
      {
        requested: [requested("case-A", { partName: "FUSE 1A", drawingNo: "AA000111" })],
        used: [used("case-A", "AA000111")],
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
      },
      index
    );
    assert.deepEqual(labelsOf(rows), ["FUSE 1A"], "`-` 를 품번으로 보이면 조각 이름이 `-` 가 된다");
  });

  test("네 칸이 다 비면 빈 글자이고, 그래프가 미입력 조각으로 센다 — 버리지 않는다", () => {
    const rows = toFaultPartRows({ requested: [requested("case-A")], used: [] }, okIndex([]));
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

    const rows = toFaultPartRows({ requested: [requested("case-A", { partName: "FUSE 1A" })], used: [] }, index);
    assert.deepEqual(labelsOf(rows), ["전원 퓨즈 (FUSE 1A)"]);
  });
});
