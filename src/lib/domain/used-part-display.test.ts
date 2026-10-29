import { test, describe } from "node:test";
import assert from "node:assert/strict";
import type { PartPickerRow } from "@dss/core/ui/inventory/part-picker-rows";
import type { InventoryResult } from "@/lib/domain/inventory-gateway";
import {
  buildUsedPartNameIndex,
  partIdentityText,
  partRowDisplayName,
  usedPartCustomerName,
  usedPartDisplayName,
  usedPartDisplayNamesById,
  usedPartMatchKey,
  type UsedPartNameIndex,
} from "@/lib/domain/used-part-display";

/**
 * ============================================================================
 * 사용 부품을 「고객사 품명 (품번)」으로 보인다 — 값으로 못 박는다 (2026-10-28)
 * ============================================================================
 * 🔴 **갈래마다 「무엇이 보이는가」를 글자로** 적는다. 「함수를 불렀다」나 「빈 값이
 *    아니다」로 재면, 합치는 규칙이 통째로 되살아나거나 뒤집혀도 통과한다.
 *
 * 🔴 **부품 이름은 가짜다.** 실제 고객사·품번을 시험에 적으면 공개 저장소에 박힌다
 *    (이 저장소의 규칙이고, 실제로 한 번 걸렸다).
 *
 * 🔵 맞대기 시험은 **표본이 비면 공짜로 통과한다** — 「안 걸렸다」와 「애초에 담긴
 *    것이 없다」가 같은 결과를 낸다. 그래서 묶음마다 **지도가 실제로 무엇을 담고
 *    있는지**를 먼저 단언한다.
 * ============================================================================
 */

/** 재고 관리에서 받아 온 줄 하나. 안 적은 칸은 빈 글자다(저쪽도 그렇게 준다). */
function part(row: Partial<PartPickerRow> & { id: string }): PartPickerRow {
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

describe("사용 부품 표시 — 열쇠 누르기", () => {
  test("🔴 `-` 만 적힌 칸은 맞댈 수 없는 값이다 — 빈 열쇠", () => {
    assert.equal(usedPartMatchKey("-"), "");
    assert.equal(usedPartMatchKey("－－－"), "");
    assert.equal(usedPartMatchKey("   "), "");
    assert.equal(usedPartMatchKey(""), "");
  });

  test("전각·공백·대소문자·붙임표를 눌러 같은 열쇠로 만든다", () => {
    const key = usedPartMatchKey("SCV-255P110");
    assert.notEqual(key, "", "눌러서 빈 글자가 되면 아래 비교가 공짜로 통과한다");
    assert.equal(usedPartMatchKey("scv-255p110"), key, "대소문자");
    assert.equal(usedPartMatchKey("SCV 255 P110"), key, "공백");
    assert.equal(usedPartMatchKey("ＳＣＶ－２５５Ｐ１１０"), key, "전각");
    assert.equal(usedPartMatchKey("SCV255P110"), key, "붙임표 — 🔴 품번은 넉넉하게 맞댄다");
  });

  test("다른 품번은 다른 열쇠다 — 눌러도 뭉개지지 않는다", () => {
    assert.notEqual(usedPartMatchKey("SCV-255P110"), usedPartMatchKey("SCV-255P120"));
  });
});

describe("사용 부품 표시 — 네 갈래", () => {
  const stored = "SCV-255P110";

  test("㉠ 고객사 품명이 차 있으면 「고객사 품명 (품번)」", () => {
    const index = okIndex([
      part({ id: "1", kyosanPartNo: "SCV-255P110", customerPartName: "전원 퓨즈" }),
    ]);
    assert.equal(index.byKyosanPartNo.size, 1, "지도가 비었으면 아래가 공짜로 통과한다");
    assert.equal(usedPartDisplayName(stored, index), "전원 퓨즈 (SCV-255P110)");
  });

  test("㉡ 고객사 품명이 비어 있으면 품번만", () => {
    const index = okIndex([part({ id: "1", kyosanPartNo: "SCV-255P110", customerPartName: "" })]);
    assert.equal(usedPartCustomerName(stored, index), "");
    assert.equal(usedPartDisplayName(stored, index), "SCV-255P110");
  });

  test("🔴 고객사 품명이 `-` 뿐이어도 빈 칸이다 — 품번만", () => {
    const index = okIndex([part({ id: "1", kyosanPartNo: "SCV-255P110", customerPartName: "-" })]);
    assert.equal(usedPartDisplayName(stored, index), "SCV-255P110");
  });

  test("㉢ 재고 관리에 그 품번이 없으면 품번만", () => {
    const index = okIndex([
      part({ id: "1", kyosanPartNo: "SCV-255P120", customerPartName: "다른 부품" }),
    ]);
    assert.equal(index.byKyosanPartNo.size, 1, "지도에 **다른** 품번은 담겨 있다");
    assert.equal(usedPartDisplayName(stored, index), "SCV-255P110");
  });

  test("㉣ 재고 관리에 못 물어봤으면 품번만 — 🔴 빈 칸도 「불러오지 못했습니다」도 아니다", () => {
    const unreachable: InventoryResult<readonly PartPickerRow[]> = {
      status: "unreachable",
      reason: "timeout",
    };
    const index = buildUsedPartNameIndex(unreachable);
    assert.equal(index.byDrawingNo.size, 0);
    assert.equal(index.byKyosanPartNo.size, 0);
    assert.equal(index.byPartSpec.size, 0);
    assert.equal(index.byPartName.size, 0);
    assert.equal(usedPartDisplayName(stored, index), "SCV-255P110");
  });

  test("🔴 통로가 200 으로 빈 목록을 줘도 품번만 — 「없다」와 「모른다」가 같은 글자다", () => {
    assert.equal(usedPartDisplayName(stored, okIndex([])), "SCV-255P110");
  });

  test("🔴 괄호 안은 저장된 글자 그대로다 — 눌러 적지 않는다", () => {
    const index = okIndex([
      part({ id: "1", kyosanPartNo: "SCV-255P110", customerPartName: "전원 퓨즈" }),
    ]);
    // 저장된 쪽은 전각·공백으로 적혀 있고 재고 관리 쪽은 반각이다. 묶이기는 하되
    // 보이는 품번은 **이 건에 적힌 글자**여야 사람이 연락서에서 되짚을 수 있다.
    assert.equal(usedPartDisplayName("ＳＣＶ－２５５Ｐ１１０", index), "전원 퓨즈 (ＳＣＶ－２５５Ｐ１１０)");
  });

  test("저장된 글자가 `-` 뿐이면 맞대지 않고 그대로 보인다", () => {
    const index = okIndex([part({ id: "1", kyosanPartNo: "-", customerPartName: "전원 퓨즈" })]);
    assert.equal(usedPartDisplayName("-", index), "-");
  });
});

/**
 * 🔴 **2026-10-29 에 맞추는 칸이 둘에서 넷으로 늘었다.** 운영 겹침 점검을 품번 백필
 *    **뒤에** 돌려 보니 연락서의 품번이 들어 있는 칸은 **도번**(30.3%)이었고, 「뜻으로
 *    보아 품번 자리는 교산 품번 하나」라던 2026-10-28 의 근거가 틀렸다(모듈 머리말).
 *    그래서 **「품명2·도번은 열쇠가 아니다」를 재던 옛 시험을 지우지 않고 뒤집어** 적는다
 *    — 그 이름이 초록 ✔ 옆에 남아 있으면 다음 사람이 틀린 설계를 사실로 읽는다.
 */
describe("사용 부품 표시 — 어느 칸으로 맞추나", () => {
  test("🔴 **도번** 칸에 품번이 적혀 있으면 걸린다 — 운영에서 가장 많이 맞는 칸(30.3%)", () => {
    const index = okIndex([
      part({ id: "1", drawingNo: "AA000111", customerPartName: "게이트 기판" }),
    ]);
    assert.equal(index.byDrawingNo.size, 1, "지도가 비었으면 아래가 공짜로 통과한다");
    assert.equal(index.byKyosanPartNo.size, 0, "교산 품번 칸은 비어 있다");
    assert.equal(usedPartDisplayName("AA000111", index), "게이트 기판 (AA000111)");
  });

  test("재고 관리의 **교산 품번** 칸에 적혀 있어도 걸린다", () => {
    const index = okIndex([
      part({ id: "1", kyosanPartNo: "AA000111", customerPartName: "게이트 기판" }),
    ]);
    assert.equal(index.byKyosanPartNo.size, 1);
    assert.equal(usedPartDisplayName("AA000111", index), "게이트 기판 (AA000111)");
  });

  test("재고 관리의 **품명2** 칸에 적혀 있어도 걸린다 — 14.6% 라 뺄 수 없다", () => {
    const index = okIndex([
      part({ id: "1", partSpec: "AA000111", customerPartName: "게이트 기판" }),
    ]);
    assert.equal(index.byPartSpec.size, 1);
    assert.equal(usedPartDisplayName("AA000111", index), "게이트 기판 (AA000111)");
  });

  test("재고 관리의 **품명** 칸에 품번이 적혀 있어도 걸린다", () => {
    const index = okIndex([
      part({ id: "1", partName: "SCV-255P110", customerPartName: "전원 퓨즈" }),
    ]);
    assert.equal(index.byKyosanPartNo.size, 0, "교산 품번 칸은 비어 있다");
    assert.equal(index.byPartName.size, 1);
    assert.equal(usedPartDisplayName("SCV-255P110", index), "전원 퓨즈 (SCV-255P110)");
  });

  test("🔴 교산 품번이 품명을 이긴다 — 차례가 뜻이다", () => {
    const index = okIndex([
      part({ id: "1", partName: "SCV-255P110", customerPartName: "엉뚱한 부품" }),
      part({ id: "2", kyosanPartNo: "SCV-255P110", customerPartName: "전원 퓨즈" }),
    ]);
    assert.equal(usedPartDisplayName("SCV-255P110", index), "전원 퓨즈 (SCV-255P110)");
  });

  test("🔴 네 칸이 한꺼번에 걸리면 **도번**이 이긴다 — 차례는 도번 → 교산 품번 → 품명2 → 품명", () => {
    // 🔵 줄을 **일부러 거꾸로** 넣는다. 담는 차례가 이기는 칸을 정한다면 여기서 품명이
    //    이겨야 하고, 시험이 바로 깨진다 — 차례를 정하는 곳이 한 군데임을 못 박는 표본이다.
    const rows = [
      part({ id: "1", partName: "AA000111", customerPartName: "품명 쪽 이름" }),
      part({ id: "2", partSpec: "AA000111", customerPartName: "품명2 쪽 이름" }),
      part({ id: "3", kyosanPartNo: "AA000111", customerPartName: "교산 품번 쪽 이름" }),
      part({ id: "4", drawingNo: "AA000111", customerPartName: "도번 쪽 이름" }),
    ];
    const index = okIndex(rows);
    assert.equal(index.byDrawingNo.size, 1, "네 지도가 다 차 있어야 차례를 잰 것이 된다");
    assert.equal(index.byKyosanPartNo.size, 1);
    assert.equal(index.byPartSpec.size, 1);
    assert.equal(index.byPartName.size, 1);
    assert.equal(usedPartCustomerName("AA000111", index), "도번 쪽 이름");

    // 앞 칸을 하나씩 걷어내면 그다음 칸이 이긴다 — 차례 전체를 잰다.
    assert.equal(usedPartCustomerName("AA000111", okIndex(rows.slice(0, 3))), "교산 품번 쪽 이름");
    assert.equal(usedPartCustomerName("AA000111", okIndex(rows.slice(0, 2))), "품명2 쪽 이름");
    assert.equal(usedPartCustomerName("AA000111", okIndex(rows.slice(0, 1))), "품명 쪽 이름");
  });

  test("🔴 도번에서 찾은 이름과 품명에서 찾은 이름이 달라도 **엇갈림이 아니다** — 도번 쪽을 보인다", () => {
    const index = okIndex([
      part({ id: "1", partName: "AA000111", customerPartName: "우연히 맞은 남의 부품" }),
      part({ id: "2", drawingNo: "AA000111", customerPartName: "게이트 기판" }),
    ]);
    // 🔴 칸끼리도 엇갈림으로 셌다면 여기서 품번만 남는다. 그러면 비상구 한 칸(3.0%)을
    //    더한 탓에 도번(30.3%)으로 찾아낸 이름이 지워진다 — 넓히려던 고침이 거꾸로 좁힌다.
    assert.equal(usedPartDisplayName("AA000111", index), "게이트 기판 (AA000111)");
  });

  test("🔵 앞 칸이 **엇갈려서** 비면 뒤 칸으로 내려간다 — 그 칸이 모를 뿐이다", () => {
    const index = okIndex([
      part({ id: "1", drawingNo: "AA000111", customerPartName: "도번 쪽 이름 하나" }),
      part({ id: "2", drawingNo: "AA000111", customerPartName: "도번 쪽 이름 둘" }),
      part({ id: "3", kyosanPartNo: "AA000111", customerPartName: "교산 품번 쪽 이름" }),
    ]);
    assert.equal(index.byDrawingNo.size, 0, "도번 지도는 엇갈려서 비어 있다");
    assert.equal(usedPartDisplayName("AA000111", index), "교산 품번 쪽 이름 (AA000111)");
  });

  test("🔴 고객사 품명 자체는 열쇠가 아니다 — 「휴즈 (휴즈)」가 되지 않는다", () => {
    const index = okIndex([part({ id: "1", customerPartName: "휴즈" })]);
    assert.equal(usedPartDisplayName("휴즈", index), "휴즈");
  });

  test("🔴 열쇠로 쓰는 칸이 넷으로 늘어도 **고객사 품명은 끝까지 열쇠가 아니다**", () => {
    // 칸을 늘린 2026-10-29 의 고침이 고객사 품명까지 쓸어 담지 않았는지 — 네 칸이 모두
    // 빈 줄이라 이 줄은 어느 지도에도 들어가지 않아야 한다.
    const index = okIndex([part({ id: "1", customerPartName: "AA000111" })]);
    assert.equal(index.byDrawingNo.size, 0);
    assert.equal(index.byKyosanPartNo.size, 0);
    assert.equal(index.byPartSpec.size, 0);
    assert.equal(index.byPartName.size, 0);
    assert.equal(usedPartDisplayName("AA000111", index), "AA000111");
  });
});

describe("사용 부품 표시 — 엇갈리면 품번", () => {
  test("🔴 한 품번에 서로 다른 고객사 품명이 걸리면 품번만 — 절반이 남의 이름이 된다", () => {
    const index = okIndex([
      part({ id: "1", kyosanPartNo: "SCV-255P110", customerPartName: "전원 퓨즈" }),
      part({ id: "2", kyosanPartNo: "SCV255P110", customerPartName: "제어 릴레이" }),
    ]);
    assert.equal(usedPartDisplayName("SCV-255P110", index), "SCV-255P110");
  });

  test("🔴 **도번** 한 값에 서로 다른 고객사 품명이 걸려도 품번만 — 새 칸에도 같은 자를 댄다", () => {
    const index = okIndex([
      part({ id: "1", drawingNo: "AA000111", customerPartName: "게이트 기판" }),
      part({ id: "2", drawingNo: "AA000111", customerPartName: "제어 릴레이" }),
    ]);
    assert.equal(index.byDrawingNo.size, 0, "엇갈린 열쇠는 지도에서 빠진다");
    assert.equal(usedPartDisplayName("AA000111", index), "AA000111");
  });

  test("🔴 엇갈린 뒤에 같은 이름이 또 와도 되살아나지 않는다", () => {
    const index = okIndex([
      part({ id: "1", kyosanPartNo: "SCV-255P110", customerPartName: "전원 퓨즈" }),
      part({ id: "2", kyosanPartNo: "SCV-255P110", customerPartName: "제어 릴레이" }),
      part({ id: "3", kyosanPartNo: "SCV-255P110", customerPartName: "전원 퓨즈" }),
    ]);
    assert.equal(usedPartDisplayName("SCV-255P110", index), "SCV-255P110");
  });

  test("🔵 같은 이름이 여러 줄에 걸리는 것은 엇갈림이 아니다 — 소유만 다른 같은 부품", () => {
    const index = okIndex([
      part({ id: "1", kyosanPartNo: "SCV-255P110", customerPartName: "전원 퓨즈" }),
      part({ id: "2", kyosanPartNo: "SCV-255P110", customerPartName: "전원 퓨즈" }),
    ]);
    assert.equal(usedPartDisplayName("SCV-255P110", index), "전원 퓨즈 (SCV-255P110)");
  });

  test("🔵 이름이 빈 줄은 엇갈림으로 세지 않는다 — 있는 이름을 지우면 안 된다", () => {
    const index = okIndex([
      part({ id: "1", kyosanPartNo: "SCV-255P110", customerPartName: "전원 퓨즈" }),
      part({ id: "2", kyosanPartNo: "SCV-255P110", customerPartName: "" }),
      part({ id: "3", kyosanPartNo: "SCV-255P110", customerPartName: "-" }),
    ]);
    assert.equal(usedPartDisplayName("SCV-255P110", index), "전원 퓨즈 (SCV-255P110)");
  });
});

describe("사용 부품 표시 — 줄마다의 글자", () => {
  const index = okIndex([
    part({ id: "1", kyosanPartNo: "SCV-255P110", customerPartName: "전원 퓨즈" }),
  ]);

  test("🔴 줄 id 로 적는다 — 차례로 적으면 거르는 날 한 칸씩 밀린다", () => {
    const names = usedPartDisplayNamesById(
      [
        { id: "row-a", partNameText: "SCV-255P110" },
        { id: "row-b", partNameText: "SCV-255P120" },
      ],
      index
    );
    assert.deepEqual(names, {
      "row-a": "전원 퓨즈 (SCV-255P110)",
      "row-b": "SCV-255P120",
    });
  });

  test("줄이 없으면 빈 묶음이다", () => {
    assert.deepEqual(usedPartDisplayNamesById([], index), {});
  });
});

/**
 * ============================================================================
 * 부품 **행 하나**에서 바로 만드는 길 (2026-10-29)
 * ============================================================================
 * [고장 부품] 그래프가 부품 요청 줄도 같은 글자로 보이게 되면서 생긴 두 함수다
 * (`domain/product-model-fault-parts.ts`). 🔴 **합성 규칙을 두 벌로 적지 않으려고**
 * 둔 것이라, 여기서 재는 것은 「그 행의 품번은 어느 칸인가」뿐이다.
 * ============================================================================
 */
describe("부품 행에서 바로 — 품번은 어느 칸인가", () => {
  test("🔴 차례는 도번 → 교산 품번 → 품명2 → 품명이다", () => {
    assert.equal(
      partIdentityText({
        drawingNo: "AA000111",
        kyosanPartNo: "KY000111",
        partSpec: "AC100V",
        partName: "FUSE 1A",
      }),
      "AA000111"
    );
    assert.equal(
      partIdentityText({ kyosanPartNo: "KY000111", partSpec: "AC100V", partName: "FUSE 1A" }),
      "KY000111"
    );
    assert.equal(partIdentityText({ partSpec: "AC100V", partName: "FUSE 1A" }), "AC100V");
    assert.equal(partIdentityText({ partName: "FUSE 1A" }), "FUSE 1A");
  });

  test("🔴 `-` 만 적힌 칸은 없는 칸이다 — 건너뛰고 다음 칸으로 간다", () => {
    assert.equal(partIdentityText({ drawingNo: "-", kyosanPartNo: "－", partName: "FUSE 1A" }), "FUSE 1A");
  });

  test("네 칸이 다 비면 빈 글자다 — 그래프가 미입력으로 센다", () => {
    assert.equal(partIdentityText({}), "");
    assert.equal(partIdentityText({ drawingNo: null, kyosanPartNo: "   ", partSpec: "", partName: "-" }), "");
  });

  test("🔴 합성 규칙은 빌려 쓴다 — 행에서 뽑은 글자를 그대로 「고객사 품명 (품번)」에 넣는다", () => {
    const index = okIndex([part({ id: "1", drawingNo: "AA000111", customerPartName: "전원 퓨즈" })]);
    assert.equal(index.byDrawingNo.size, 1, "지도가 비었으면 아래가 공짜로 통과한다");

    assert.equal(
      partRowDisplayName({ drawingNo: "AA000111", partName: "FUSE 1A" }, index),
      "전원 퓨즈 (AA000111)"
    );
    // 🔴 저장된 글자로 부른 것과 **같은 글자**여야 한 조각으로 묶인다.
    assert.equal(partRowDisplayName({ drawingNo: "AA000111" }, index), usedPartDisplayName("AA000111", index));
  });

  test("이름을 못 얻으면 품번 그대로이고, 칸이 다 비면 빈 글자다", () => {
    const index = okIndex([part({ id: "1", drawingNo: "AA000999", customerPartName: "다른 부품" })]);
    assert.equal(partRowDisplayName({ drawingNo: "AA000111" }, index), "AA000111");
    assert.equal(partRowDisplayName({}, index), "");
  });
});
