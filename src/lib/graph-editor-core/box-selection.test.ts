import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  selectionBoxFromPoints,
  selectionBoxOverlapArea,
  selectionOverlayRect,
  toggleNodeInSelection,
  removeNodesFromSelection,
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

/**
 * 🔴 **그린 네모와 고른 네모가 갈리지 않는가**(2026-11-21, 조각 B2).
 *
 * 화면에 그리는 네모는 px 이고 고르는 네모는 그림 좌표다. 두 셈이 따로 적히면
 * 「분명히 네모로 덮었는데 안 골라진다」가 되고, 그것은 오류가 안 나 눈으로만
 * 잡힌다. 그래서 그리는 쪽도 위 `selectionBoxFromPoints` 를 거치게 했고,
 * 여기서 **같은 두 점이 같은 모양을 낸다**는 것을 값으로 잰다.
 */
describe("selectionOverlayRect — 그리는 네모", () => {
  const paneOrigin = { x: 40, y: 120 };

  test("바탕 왼쪽 위를 0,0 으로 옮긴다", () => {
    assert.deepEqual(selectionOverlayRect({ x: 140, y: 220 }, { x: 240, y: 280 }, paneOrigin), {
      left: 100,
      top: 100,
      width: 100,
      height: 60,
    });
  });

  test("🔴 어느 방향으로 끌든 같은 네모다 — 고르는 쪽과 같은 정규화를 쓴다", () => {
    const downRight = selectionOverlayRect({ x: 140, y: 220 }, { x: 240, y: 280 }, paneOrigin);
    for (const [start, end] of [
      [
        { x: 240, y: 280 },
        { x: 140, y: 220 },
      ],
      [
        { x: 240, y: 220 },
        { x: 140, y: 280 },
      ],
      [
        { x: 140, y: 280 },
        { x: 240, y: 220 },
      ],
    ]) {
      assert.deepEqual(selectionOverlayRect(start, end, paneOrigin), downRight);
    }
  });

  test("🔴 폭·높이가 고르는 네모의 것과 **같은 값**이다 — 여기가 갈리면 그린 것과 골라진 것이 달라진다", () => {
    const start = { x: 140, y: 220 };
    const end = { x: 90, y: 400 };
    const drawn = selectionOverlayRect(start, end, paneOrigin);
    const picked = selectionBoxFromPoints(start, end);
    assert.equal(drawn.width, picked.width);
    assert.equal(drawn.height, picked.height);
    assert.equal(drawn.left, picked.x - paneOrigin.x);
    assert.equal(drawn.top, picked.y - paneOrigin.y);
  });

  test("누르기만 하면 넓이 0 — 그려도 아무것도 안 덮는다", () => {
    assert.deepEqual(selectionOverlayRect({ x: 60, y: 130 }, { x: 60, y: 130 }, paneOrigin), { left: 20, top: 10, width: 0, height: 0 });
  });
});

/**
 * 🔴 **두 번 누르면 빠진다**(2026-11-21, 조각 B2). 점선 네모 모드에서 칸을
 * 누르는 것이 곧 넣기/빼기다. 「넣기만 되고 빼기가 안 되는」 결함은 쓰다 보면
 * 선택이 영영 안 줄어드는 것으로 드러나는데, 그 사이에 엉뚱한 칸이 함께 끌린다.
 */
describe("toggleNodeInSelection — 누르면 넣고, 다시 누르면 뺀다", () => {
  test("없던 칸은 들어간다", () => {
    assert.deepEqual([...toggleNodeInSelection(new Set(["a"]), "b")].sort(), ["a", "b"]);
  });

  test("있던 칸은 빠진다", () => {
    assert.deepEqual([...toggleNodeInSelection(new Set(["a", "b"]), "a")].sort(), ["b"]);
  });

  test("두 번 누르면 처음으로 돌아온다", () => {
    const once = toggleNodeInSelection(new Set<string>(), "a");
    assert.deepEqual([...once], ["a"]);
    assert.equal(toggleNodeInSelection(once, "a").size, 0);
  });

  test("🔴 받은 집합을 안 고친다 — 고쳐서 돌려주면 화면이 안 다시 그려진다", () => {
    const before = new Set(["a"]);
    const after = toggleNodeInSelection(before, "b");
    assert.notEqual(after, before, "같은 집합을 그대로 돌려줬다");
    assert.deepEqual([...before], ["a"], "받은 집합이 바뀌었다");
  });
});

/**
 * 🔴 **지운 칸만 뺀다 — 비우는 것이 아니다**(2026-11-21, 조각 B3). 여럿을 골라
 * [Delete] 로 지울 때 못 지우는 칸이 섞여 있으면 그 칸은 **골라진 채 남아야** 한다.
 * 통째로 비우면 무엇이 안 지워졌는지가 화면에서 사라진다(이 편집기에는 상시 안내
 * 줄이 없어서, 남은 테두리와 「N개 선택」 숫자가 사람이 보는 유일한 답이다).
 */
describe("removeNodesFromSelection — 지운 칸만 뺀다", () => {
  test("🔵 먼저 표본 — 넷을 골라 둔 집합으로 잰다(비면 아래가 전부 공짜로 통과한다)", () => {
    const selected = new Set(["a", "b", "c", "d"]);
    assert.equal(selected.size, 4);
    assert.deepEqual([...removeNodesFromSelection(selected, ["b", "c"])].sort(), ["a", "d"]);
  });

  test("🔴 **못 지운 칸은 남는다** — 「하나라도 막히면 전부 비운다」가 아니다", () => {
    // 🔴 다섯을 골랐는데 하나가 체크리스트 노드라 못 지웠다 — 넷이 빠지고 그 하나만 남는다.
    const selected = new Set(["a", "b", "c", "d", "blocked"]);
    const after = removeNodesFromSelection(selected, ["a", "b", "c", "d"]);
    assert.deepEqual([...after], ["blocked"]);
    assert.equal(after.size, 1, "「N개 선택」이 1 로 줄어 멈춰야 사람이 무엇이 안 지워졌는지 안다");
  });

  test("🔵 없는 id 는 그냥 지나간다", () => {
    assert.deepEqual([...removeNodesFromSelection(new Set(["a"]), ["zzz"])], ["a"]);
  });

  test("🔵 빈 목록을 빼면 그대로고, 전부 빼면 빈 집합이다", () => {
    assert.deepEqual([...removeNodesFromSelection(new Set(["a", "b"]), [])].sort(), ["a", "b"]);
    assert.equal(removeNodesFromSelection(new Set(["a", "b"]), ["a", "b"]).size, 0);
  });

  test("🔴 받은 집합을 안 고친다 — 고쳐서 돌려주면 화면이 안 다시 그려진다", () => {
    const before = new Set(["a", "b"]);
    const after = removeNodesFromSelection(before, ["a"]);
    assert.notEqual(after, before, "같은 집합을 그대로 돌려줬다");
    assert.deepEqual([...before].sort(), ["a", "b"], "받은 집합이 바뀌었다");
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
