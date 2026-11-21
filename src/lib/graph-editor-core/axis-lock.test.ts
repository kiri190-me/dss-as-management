import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { resolveDragAxis, applyAxisLock, applyAxisLockToMoves, AXIS_LOCK_THRESHOLD, type AxisLockMove, type Point } from "./axis-lock";

test("horizontal-dominant delta locks the Y axis (movement stays horizontal)", () => {
  assert.equal(resolveDragAxis({ x: 500, y: 300 }, { x: 700, y: 330 }), "horizontal");
});

test("vertical-dominant delta locks the X axis (movement stays vertical)", () => {
  assert.equal(resolveDragAxis({ x: 500, y: 300 }, { x: 520, y: 500 }), "vertical");
});

test("exact tie (|deltaX| === |deltaY|) deterministically resolves to vertical", () => {
  // Math.abs(deltaX) > Math.abs(deltaY) is the only comparison — a tie
  // fails that check and falls through to vertical, always, not "whichever
  // came first" or any other non-deterministic tie-break.
  assert.equal(resolveDragAxis({ x: 0, y: 0 }, { x: 10, y: 10 }), "vertical");
  assert.equal(resolveDragAxis({ x: 0, y: 0 }, { x: -10, y: 10 }), "vertical");
  assert.equal(resolveDragAxis({ x: 0, y: 0 }, { x: 10, y: -10 }), "vertical");
});

test("movement below the threshold in both dimensions commits to no axis yet", () => {
  const start = { x: 100, y: 100 };
  assert.equal(resolveDragAxis(start, { x: 100 + AXIS_LOCK_THRESHOLD - 1, y: 100 }), null);
  assert.equal(resolveDragAxis(start, { x: 100, y: 100 + AXIS_LOCK_THRESHOLD - 1 }), null);
  assert.equal(resolveDragAxis(start, { x: 100 + AXIS_LOCK_THRESHOLD - 1, y: 100 - (AXIS_LOCK_THRESHOLD - 1) }), null);
});

test("movement exactly at the threshold commits (>= threshold, not only >)", () => {
  const start = { x: 100, y: 100 };
  assert.equal(resolveDragAxis(start, { x: 100 + AXIS_LOCK_THRESHOLD, y: 100 }), "horizontal");
});

test("applyAxisLock: horizontal keeps current.x, pins y to start.y", () => {
  const start: Point = { x: 500, y: 300 };
  const current: Point = { x: 700, y: 330 };
  assert.deepEqual(applyAxisLock(start, current, "horizontal"), { x: 700, y: 300 });
});

test("applyAxisLock: vertical keeps current.y, pins x to start.x", () => {
  const start: Point = { x: 500, y: 300 };
  const current: Point = { x: 520, y: 500 };
  assert.deepEqual(applyAxisLock(start, current, "vertical"), { x: 500, y: 500 });
});

test("applyAxisLock: null axis passes current through unchanged", () => {
  const current: Point = { x: 42, y: 84 };
  assert.deepEqual(applyAxisLock({ x: 0, y: 0 }, current, null), { x: 42, y: 84 });
});

test("the worked examples from the task spec produce the exact expected coordinates", () => {
  const start: Point = { x: 500, y: 300 };
  const horizontalTarget: Point = { x: 700, y: 330 };
  const horizontalAxis = resolveDragAxis(start, horizontalTarget);
  assert.deepEqual(applyAxisLock(start, horizontalTarget, horizontalAxis), { x: 700, y: 300 });

  const verticalTarget: Point = { x: 520, y: 500 };
  const verticalAxis = resolveDragAxis(start, verticalTarget);
  assert.deepEqual(applyAxisLock(start, verticalTarget, verticalAxis), { x: 500, y: 500 });
});

test("neither function mutates its input points", () => {
  const start: Point = { x: 500, y: 300 };
  const current: Point = { x: 700, y: 330 };
  const startCopy = { ...start };
  const currentCopy = { ...current };
  resolveDragAxis(start, current);
  applyAxisLock(start, current, "horizontal");
  assert.deepEqual(start, startCopy);
  assert.deepEqual(current, currentCopy);
});

/**
 * 🔴 **여러 칸을 함께 끌 때** — 2026-11-21 복수 선택 밑자락(조각 B1).
 *
 * 표본: 칸 셋이 서로 다른 자리에서 시작하고, **셋 다 같은 거리**(+200, +30)를
 * 움직였다. 함께 끌리는 칸은 늘 같은 포인터 거리를 받기 때문이다(@xyflow/system
 * 의 XYDrag 가 칸마다 고정된 `distance` 를 쓴다).
 */
describe("applyAxisLockToMoves — 함께 끌리는 칸 전부에 같은 축을 건다", () => {
  const STARTS = new Map<string, Point>([
    ["n1", { x: 500, y: 300 }],
    ["n2", { x: 100, y: 700 }],
    ["n3", { x: 900, y: 50 }],
  ]);
  const DELTA = { x: 200, y: 30 };
  const MOVES: AxisLockMove[] = [...STARTS].map(([nodeId, start]) => ({
    nodeId,
    position: { x: start.x + DELTA.x, y: start.y + DELTA.y },
  }));

  test("🔵 먼저 — 표본이 무엇인지(셋, 서로 다른 자리, 같은 거리)", () => {
    assert.equal(MOVES.length, 3);
    assert.equal(new Set(MOVES.map((m) => m.position.y)).size, 3, "세 칸의 y 가 서로 달라야 「제 y 로 돌아간다」를 잴 수 있다");
    for (const m of MOVES) {
      const start = STARTS.get(m.nodeId)!;
      assert.deepEqual({ x: m.position.x - start.x, y: m.position.y - start.y }, DELTA);
    }
  });

  test("🔴 가로로 잠그면 **세 칸 모두** 제 y 로 돌아간다 — 끄는 칸의 y 로 모이지 않는다", () => {
    const locked = applyAxisLockToMoves(MOVES, STARTS, "horizontal");
    assert.deepEqual(locked, [
      { nodeId: "n1", position: { x: 700, y: 300 } },
      { nodeId: "n2", position: { x: 300, y: 700 } },
      { nodeId: "n3", position: { x: 1100, y: 50 } },
    ]);
  });

  test("🔴 세로로 잠그면 **세 칸 모두** 제 x 로 돌아간다", () => {
    const locked = applyAxisLockToMoves(MOVES, STARTS, "vertical");
    assert.deepEqual(locked, [
      { nodeId: "n1", position: { x: 500, y: 330 } },
      { nodeId: "n2", position: { x: 100, y: 730 } },
      { nodeId: "n3", position: { x: 900, y: 80 } },
    ]);
  });

  test("🔴 묶음 간격이 그대로다 — 축을 걸어도 칸끼리의 거리는 안 바뀐다", () => {
    for (const axis of ["horizontal", "vertical"] as const) {
      const locked = applyAxisLockToMoves(MOVES, STARTS, axis);
      const gap = (a: Point, b: Point) => ({ x: b.x - a.x, y: b.y - a.y });
      assert.deepEqual(
        gap(locked[0].position, locked[1].position),
        gap(STARTS.get("n1")!, STARTS.get("n2")!),
        `${axis}: 칸 사이가 벌어지거나 겹쳤다`
      );
    }
  });

  test("🔴 축이 null 이면 아무것도 안 바꾼다 — 문턱을 못 넘은 동안은 자유롭게 움직인다", () => {
    assert.deepEqual(applyAxisLockToMoves(MOVES, STARTS, null), MOVES);
  });

  test("🔴 **칸이 하나면 전과 한 치도 다르지 않다** — 지금 동작이 바뀌면 안 된다", () => {
    const start = STARTS.get("n1")!;
    const current: Point = { x: 700, y: 330 };
    for (const axis of ["horizontal", "vertical", null] as const) {
      const single = applyAxisLockToMoves([{ nodeId: "n1", position: current }], STARTS, axis);
      assert.equal(single.length, 1);
      assert.deepEqual(single[0].position, applyAxisLock(start, current, axis), `axis=${axis} 에서 하나짜리 답이 옛 함수와 다르다`);
    }
  });

  test("시작 자리를 모르는 칸은 그대로 통과한다", () => {
    const locked = applyAxisLockToMoves([{ nodeId: "모르는칸", position: { x: 11, y: 22 } }], STARTS, "horizontal");
    assert.deepEqual(locked, [{ nodeId: "모르는칸", position: { x: 11, y: 22 } }]);
  });

  test("입력(moves·startById)을 건드리지 않고 늘 새 점을 돌려준다", () => {
    const before = JSON.stringify(MOVES);
    const locked = applyAxisLockToMoves(MOVES, STARTS, "horizontal");
    assert.equal(JSON.stringify(MOVES), before);
    assert.notEqual(locked[0].position, MOVES[0].position, "같은 객체를 그대로 돌려주면 부르는 쪽이 원본을 고칠 수 있다");
    assert.equal(STARTS.get("n1")!.y, 300);
  });

  test("빈 목록이면 빈 배열", () => {
    assert.deepEqual(applyAxisLockToMoves([], STARTS, "horizontal"), []);
  });
});
