import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  selectionBoxFromPoints,
  selectionBoxOverlapArea,
  findNodeIdsInSelectionBox,
  type BoxSelectableNode,
} from "./box-selection";

/**
 * 🔴 **무엇을 재는지부터 못 박는다.** 아래 셈들은 표본이 비면 전부 공짜로
 * 통과한다(「골라진 게 없다」가 늘 참이 되니까). 그래서 표본의 모양 —
 * 칸 다섯이 어디에 어떤 크기로 서 있는가 — 을 먼저 단언한다.
 *
 * 표본 배치(흐름 좌표계, y 는 아래로 자란다):
 *
 *        0    100   200   300   400
 *    0   ┌─────┐
 *        │  a  │ 0,0  100×60
 *   60   └─────┘
 *  100         ┌─────┐
 *              │  b  │ 150,100  100×60
 *  160         └─────┘
 *  200   ┌─────┐
 *        │  c  │ 20,200  100×60
 *  260   └─────┘
 *  300                 ┌─────┐
 *                      │  d  │ 300,300  100×60
 *  360                 └─────┘
 *   — e 는 크기가 아직 안 잡힌 칸(0×0)이고, a 와 같은 자리에 둔다.
 */
const SAMPLE_NODES: BoxSelectableNode[] = [
  { id: "a", x: 0, y: 0, width: 100, height: 60 },
  { id: "b", x: 150, y: 100, width: 100, height: 60 },
  { id: "c", x: 20, y: 200, width: 100, height: 60 },
  { id: "d", x: 300, y: 300, width: 100, height: 60 },
  { id: "e", x: 10, y: 10, width: 0, height: 0 },
];

describe("표본이 무엇인지 먼저 — 공짜 통과 막기", () => {
  test("칸이 다섯이고, 겹쳐 놓은 칸은 하나도 없다", () => {
    assert.equal(SAMPLE_NODES.length, 5);
    const sized = SAMPLE_NODES.filter((n) => n.width > 0 && n.height > 0);
    assert.equal(sized.length, 4, "크기가 잡힌 칸이 넷이어야 아래 셈이 뜻을 가진다");
    for (const one of sized) {
      for (const other of sized) {
        if (one.id === other.id) continue;
        assert.equal(
          selectionBoxOverlapArea(one, other),
          0,
          `표본의 ${one.id} 와 ${other.id} 가 서로 겹친다 — 「몇 개 골랐나」로는 아무것도 못 가린다`
        );
      }
    }
  });

  test("네모를 통째로 덮으면 다섯 가운데 넷이 골라진다 — 「아무것도 안 골라진다」로 통과하지 않는다", () => {
    const all = findNodeIdsInSelectionBox({ x: -1000, y: -1000, width: 5000, height: 5000 }, SAMPLE_NODES);
    assert.deepEqual([...all].sort(), ["a", "b", "c", "d"]);
  });
});

describe("selectionBoxFromPoints — 어느 방향으로 끌든 같은 네모", () => {
  test("오른쪽 아래로 끌기", () => {
    assert.deepEqual(selectionBoxFromPoints({ x: 10, y: 20 }, { x: 110, y: 80 }), { x: 10, y: 20, width: 100, height: 60 });
  });

  test("🔴 왼쪽 위로 끌어도 같은 네모다 — 폭이 음수가 되면 조용히 아무것도 안 골라진다", () => {
    const downRight = selectionBoxFromPoints({ x: 10, y: 20 }, { x: 110, y: 80 });
    const upLeft = selectionBoxFromPoints({ x: 110, y: 80 }, { x: 10, y: 20 });
    assert.deepEqual(upLeft, downRight);
    const mixedOne = selectionBoxFromPoints({ x: 110, y: 20 }, { x: 10, y: 80 });
    const mixedTwo = selectionBoxFromPoints({ x: 10, y: 80 }, { x: 110, y: 20 });
    assert.deepEqual(mixedOne, downRight);
    assert.deepEqual(mixedTwo, downRight);
  });

  test("네 방향 모두 같은 칸들을 고른다 — 네모 만들기와 고르기를 이어서 잰다", () => {
    const corners = [
      { x: -10, y: -10 },
      { x: 260, y: 170 },
    ];
    const expected = ["a", "b"];
    for (const [start, end] of [
      [corners[0], corners[1]],
      [corners[1], corners[0]],
      [{ x: corners[1].x, y: corners[0].y }, { x: corners[0].x, y: corners[1].y }],
      [{ x: corners[0].x, y: corners[1].y }, { x: corners[1].x, y: corners[0].y }],
    ]) {
      const ids = findNodeIdsInSelectionBox(selectionBoxFromPoints(start, end), SAMPLE_NODES);
      assert.deepEqual([...ids].sort(), expected);
    }
  });

  test("끌지 않고 누르기만 하면 넓이 0 짜리 네모가 된다", () => {
    assert.deepEqual(selectionBoxFromPoints({ x: 50, y: 30 }, { x: 50, y: 30 }), { x: 50, y: 30, width: 0, height: 0 });
  });
});

describe("🔴 「들었다」는 닿으면 — 완전히 들어올 필요는 없다", () => {
  test("모서리만 걸쳐도 골라진다", () => {
    // a(0,0 ~ 100,60) 의 오른쪽 아래 귀퉁이 10×10 만 덮는다.
    const ids = findNodeIdsInSelectionBox({ x: 90, y: 50, width: 60, height: 60 }, SAMPLE_NODES);
    assert.deepEqual([...ids].sort(), ["a"], "귀퉁이만 걸친 칸이 안 골라졌다면 「완전히 들어와야」로 돈 것이다");
  });

  test("🔴 「완전히 들어와야」였다면 골라졌을 리 없는 짝 — 세로로 반만 덮는 긴 네모", () => {
    // y 가 0~400 이라 a·c 를 세로로는 다 덮지만, x 는 0~60 이라 둘 다 폭의
    // 일부만 덮는다. 둘이 함께 골라져야 「닿으면」이 맞다.
    const ids = findNodeIdsInSelectionBox({ x: 0, y: 0, width: 60, height: 400 }, SAMPLE_NODES);
    assert.deepEqual([...ids].sort(), ["a", "c"]);
  });

  test("네모가 칸 안에 통째로 들어가도 골라진다 — 「칸이 네모를 품은」 반대 경우", () => {
    const ids = findNodeIdsInSelectionBox({ x: 180, y: 120, width: 10, height: 10 }, SAMPLE_NODES);
    assert.deepEqual([...ids].sort(), ["b"]);
  });

  test("닿지 않으면 안 골라진다", () => {
    const ids = findNodeIdsInSelectionBox({ x: 500, y: 500, width: 100, height: 100 }, SAMPLE_NODES);
    assert.equal(ids.size, 0);
  });
});

describe("🔴 변끼리 딱 맞닿기만 한 것은 안 고른다 — React Flow 의 partially 와 같은 잣대", () => {
  test("오른쪽 변에 정확히 붙은 네모", () => {
    // a 의 오른쪽 변은 x = 100. 네모가 거기서 시작하면 겹침 넓이가 0 이다.
    assert.equal(selectionBoxOverlapArea({ x: 0, y: 0, width: 100, height: 60 }, { x: 100, y: 0, width: 50, height: 60 }), 0);
    const ids = findNodeIdsInSelectionBox({ x: 100, y: 0, width: 50, height: 60 }, SAMPLE_NODES);
    assert.equal(ids.size, 0);
  });

  test("1 만큼이라도 파고들면 골라진다 — 경계가 정말 거기인지 양쪽으로 잰다", () => {
    const ids = findNodeIdsInSelectionBox({ x: 99, y: 0, width: 50, height: 60 }, SAMPLE_NODES);
    assert.deepEqual([...ids].sort(), ["a"]);
  });

  test("한 축만 겹치고 다른 축은 맞닿기만 한 경우도 안 고른다", () => {
    // 아래 변(y = 60)에 정확히 붙고 x 는 가운데를 가로지른다.
    assert.equal(selectionBoxOverlapArea({ x: 0, y: 0, width: 100, height: 60 }, { x: 20, y: 60, width: 40, height: 40 }), 0);
  });
});

describe("🔴 크기가 아직 안 잡힌 칸(0×0)은 안 골라진다", () => {
  test("그 칸이 한가운데 있어도 고르지 않는다", () => {
    const ids = findNodeIdsInSelectionBox({ x: -50, y: -50, width: 200, height: 200 }, SAMPLE_NODES);
    assert.ok(!ids.has("e"), "크기를 모르는 칸이 끌려 들어가면 화면에 없는 것이 함께 움직인다");
    assert.deepEqual([...ids].sort(), ["a"]);
  });

  test("음수 크기도 마찬가지로 안 골라진다", () => {
    const broken: BoxSelectableNode[] = [{ id: "x", x: 0, y: 0, width: -100, height: -60 }];
    assert.equal(findNodeIdsInSelectionBox({ x: -1000, y: -1000, width: 5000, height: 5000 }, broken).size, 0);
  });
});

describe("넓이 0 짜리 네모(누르기만 한 것)는 아무것도 안 고른다", () => {
  test("칸 한가운데를 눌러도 네모 길로는 안 골라진다 — 누르기는 칸을 직접 누르는 길이다", () => {
    const ids = findNodeIdsInSelectionBox(selectionBoxFromPoints({ x: 50, y: 30 }, { x: 50, y: 30 }), SAMPLE_NODES);
    assert.equal(ids.size, 0);
  });
});

describe("입력을 건드리지 않는다", () => {
  test("고르고 난 뒤에도 표본이 한 글자도 안 바뀐다", () => {
    const before = JSON.stringify(SAMPLE_NODES);
    findNodeIdsInSelectionBox({ x: -1000, y: -1000, width: 5000, height: 5000 }, SAMPLE_NODES);
    assert.equal(JSON.stringify(SAMPLE_NODES), before);
  });

  test("빈 목록이면 빈 집합", () => {
    assert.equal(findNodeIdsInSelectionBox({ x: 0, y: 0, width: 100, height: 100 }, []).size, 0);
  });
});
