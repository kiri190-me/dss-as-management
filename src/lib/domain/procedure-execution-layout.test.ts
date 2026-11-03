import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  ADDED_NODE_GAP_X,
  ADDED_NODE_GAP_Y,
  EXTRA_TASK_DIRECTION_CODES,
  EXTRA_TASK_POSITION_LIMIT,
  extraTaskDirectionLabels,
  isExtraTaskDirection,
  isUsableGraphCoordinate,
  isUsableGraphPoint,
  placeExtraTaskByDirection,
  type GraphPoint,
} from "./procedure-execution-layout";

/**
 * 「고른 작업을 기준으로 상·하·좌·우」(2026-11-03, 조각 14).
 *
 * 🔵 재는 것은 **방향과 겹침**이다. 「보기 좋은가」는 눈으로만 잡히므로 여기서
 * 안 센다(이 저장소의 「세는 화면의 결함은 눈으로만 잡힌다」) — 대신 **사람이
 * 고른 쪽으로 갔는가**와 **포개지지 않는가**를 못 박는다.
 */

const BASE: GraphPoint = { x: 1000, y: 500 };

describe("🔵 먼저 — 무엇을 재는지부터(공짜 통과 막기)", () => {
  test("방향은 넷이고 이름표가 다 붙어 있다", () => {
    assert.equal(EXTRA_TASK_DIRECTION_CODES.length, 4);
    assert.deepEqual([...EXTRA_TASK_DIRECTION_CODES], ["RIGHT", "LEFT", "DOWN", "UP"]);
    for (const code of EXTRA_TASK_DIRECTION_CODES) {
      assert.ok(extraTaskDirectionLabels[code].length > 0, `${code} 의 이름표가 비었다`);
    }
  });

  test("🔴 눈금은 조각 13 이 쓰던 그 값 그대로다 — 새 숫자를 만들지 않았다", () => {
    assert.equal(ADDED_NODE_GAP_X, 300);
    assert.equal(ADDED_NODE_GAP_Y, 150);
  });

  test("맨 앞이 「오른쪽」이다 — 조각 13 까지의 동작이 기본값이어야 한다", () => {
    assert.equal(EXTRA_TASK_DIRECTION_CODES[0], "RIGHT");
  });
});

describe("방향 — 고른 쪽으로 한 걸음", () => {
  const EMPTY: GraphPoint[] = [];

  test("오른쪽은 x 만 는다", () => {
    assert.deepEqual(placeExtraTaskByDirection({ base: BASE, direction: "RIGHT", occupied: EMPTY }), {
      x: 1000 + ADDED_NODE_GAP_X,
      y: 500,
    });
  });

  test("왼쪽은 x 만 준다", () => {
    assert.deepEqual(placeExtraTaskByDirection({ base: BASE, direction: "LEFT", occupied: EMPTY }), {
      x: 1000 - ADDED_NODE_GAP_X,
      y: 500,
    });
  });

  test("🔴 아래는 y 가 **는다** — 화면 좌표라 아래로 갈수록 커진다", () => {
    assert.deepEqual(placeExtraTaskByDirection({ base: BASE, direction: "DOWN", occupied: EMPTY }), {
      x: 1000,
      y: 500 + ADDED_NODE_GAP_Y,
    });
  });

  test("🔴 위는 y 가 **준다**", () => {
    assert.deepEqual(placeExtraTaskByDirection({ base: BASE, direction: "UP", occupied: EMPTY }), {
      x: 1000,
      y: 500 - ADDED_NODE_GAP_Y,
    });
  });

  test("네 방향이 서로 다른 자리를 준다 — 한 칸에 넷을 붙여도 안 겹친다", () => {
    const seen = new Set(
      EXTRA_TASK_DIRECTION_CODES.map((direction) => {
        const p = placeExtraTaskByDirection({ base: BASE, direction, occupied: EMPTY });
        return `${p.x},${p.y}`;
      })
    );
    assert.equal(seen.size, 4);
  });
});

describe("🔴 겹치면 **같은 방향으로** 더 간다 — 비키지 않는다", () => {
  test("그 자리에 칸이 있으면 한 걸음 더", () => {
    const taken: GraphPoint[] = [{ x: 1000 + ADDED_NODE_GAP_X, y: 500 }];
    assert.deepEqual(placeExtraTaskByDirection({ base: BASE, direction: "RIGHT", occupied: taken }), {
      x: 1000 + ADDED_NODE_GAP_X * 2,
      y: 500,
    });
  });

  test("둘이 막혀 있으면 두 걸음 더 — y 는 안 움직인다(고른 쪽을 지킨다)", () => {
    const taken: GraphPoint[] = [
      { x: 1000 + ADDED_NODE_GAP_X, y: 500 },
      { x: 1000 + ADDED_NODE_GAP_X * 2, y: 500 },
    ];
    const placed = placeExtraTaskByDirection({ base: BASE, direction: "RIGHT", occupied: taken });
    assert.deepEqual(placed, { x: 1000 + ADDED_NODE_GAP_X * 3, y: 500 });
  });

  test("🔴 **딱 겹친 자리만** 세는 것이 아니다 — 조금 어긋나 있어도 포개진 것으로 본다", () => {
    // 원본 절차의 좌표는 엑셀 도형 자리 그대로라 눈금에 안 맞는다. 「x 가 1
    // 다르다」만으로 빈 자리로 치면 두 칸이 거의 완전히 겹친 그림이 나온다.
    const taken: GraphPoint[] = [{ x: 1000 + ADDED_NODE_GAP_X + 1, y: 501 }];
    const placed = placeExtraTaskByDirection({ base: BASE, direction: "RIGHT", occupied: taken });
    assert.equal(placed.x, 1000 + ADDED_NODE_GAP_X * 2);
  });

  test("한 걸음 떨어진 칸은 막는 것이 아니다 — 두 걸음째가 비어 있으면 거기로 안 간다", () => {
    const taken: GraphPoint[] = [{ x: 1000 + ADDED_NODE_GAP_X * 2, y: 500 }];
    assert.deepEqual(placeExtraTaskByDirection({ base: BASE, direction: "RIGHT", occupied: taken }), {
      x: 1000 + ADDED_NODE_GAP_X,
      y: 500,
    });
  });

  test("다른 줄(y 가 충분히 먼 칸)은 가로막지 않는다", () => {
    const taken: GraphPoint[] = [{ x: 1000 + ADDED_NODE_GAP_X, y: 500 + ADDED_NODE_GAP_Y }];
    assert.deepEqual(placeExtraTaskByDirection({ base: BASE, direction: "RIGHT", occupied: taken }), {
      x: 1000 + ADDED_NODE_GAP_X,
      y: 500,
    });
  });

  test("🔴 안 멈추는 고리가 없다 — 같은 자리를 수백 번 막아도 답을 돌려준다", () => {
    const wall: GraphPoint[] = [];
    for (let step = 1; step <= 500; step += 1) wall.push({ x: 1000 + ADDED_NODE_GAP_X * step, y: 500 });
    const placed = placeExtraTaskByDirection({ base: BASE, direction: "RIGHT", occupied: wall });
    assert.ok(Number.isFinite(placed.x) && Number.isFinite(placed.y), "유한한 좌표를 돌려줘야 한다");
    assert.ok(placed.x > BASE.x, "그래도 고른 쪽으로는 가 있어야 한다");
  });

  test("위·왼쪽도 같은 규칙 — 막히면 음의 방향으로 더 간다", () => {
    const takenUp: GraphPoint[] = [{ x: 1000, y: 500 - ADDED_NODE_GAP_Y }];
    assert.deepEqual(placeExtraTaskByDirection({ base: BASE, direction: "UP", occupied: takenUp }), {
      x: 1000,
      y: 500 - ADDED_NODE_GAP_Y * 2,
    });

    const takenLeft: GraphPoint[] = [{ x: 1000 - ADDED_NODE_GAP_X, y: 500 }];
    assert.deepEqual(placeExtraTaskByDirection({ base: BASE, direction: "LEFT", occupied: takenLeft }), {
      x: 1000 - ADDED_NODE_GAP_X * 2,
      y: 500,
    });
  });
});

describe("🔴 화면에서 온 수를 믿지 않는다", () => {
  test("유한한 수만 쓴다", () => {
    assert.equal(isUsableGraphCoordinate(0), true);
    assert.equal(isUsableGraphCoordinate(-1234.5), true);
    assert.equal(isUsableGraphCoordinate(Number.NaN), false);
    assert.equal(isUsableGraphCoordinate(Number.POSITIVE_INFINITY), false);
    assert.equal(isUsableGraphCoordinate("300"), false);
    assert.equal(isUsableGraphCoordinate(null), false);
    assert.equal(isUsableGraphCoordinate(undefined), false);
  });

  test("울타리 밖은 거절한다 — 그림이 한 점으로 쪼그라들면 되돌릴 길이 없다", () => {
    assert.equal(isUsableGraphCoordinate(EXTRA_TASK_POSITION_LIMIT), true);
    assert.equal(isUsableGraphCoordinate(EXTRA_TASK_POSITION_LIMIT + 1), false);
    assert.equal(isUsableGraphCoordinate(-EXTRA_TASK_POSITION_LIMIT - 1), false);
  });

  test("점은 **두 칸이 다** 성해야 한다 — 반쪽은 자리가 아니다", () => {
    assert.equal(isUsableGraphPoint({ x: 1, y: 2 }), true);
    assert.equal(isUsableGraphPoint({ x: 1 }), false);
    assert.equal(isUsableGraphPoint({ x: 1, y: Number.NaN }), false);
    assert.equal(isUsableGraphPoint(null), false);
    assert.equal(isUsableGraphPoint("1,2"), false);
    assert.equal(isUsableGraphPoint([1, 2]), false);
  });

  test("방향 글자도 허용 목록 안인가만 본다", () => {
    assert.equal(isExtraTaskDirection("RIGHT"), true);
    assert.equal(isExtraTaskDirection("right"), false);
    assert.equal(isExtraTaskDirection("DIAGONAL"), false);
    assert.equal(isExtraTaskDirection(null), false);
  });
});
