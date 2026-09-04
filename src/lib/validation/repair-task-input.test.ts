import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

import { validateRepairLaborFields } from "./repair-task-input";

/**
 * ============================================================================
 * 수리 작업 비용 입력 검증
 * ============================================================================
 * 먼저 못 박는 것은 둘이다(통전 작업 **목록**은 이 파일 아래쪽에 따로 있다).
 *
 *  1. **통전작업 공수시간의 빈 칸은 `0` 이 아니라 `null` 이다.** 기본 작업비 안에
 *     이미 들어 있는 몫이라, 이 값이 0 으로 접히면 통전작업을 빼는 견적서가
 *     "빼야 할 것이 없다"고 판단해 버린다. T/C 는 실제로 아직 모른다.
 *  2. **새 칸을 끼우면서 옛 규칙이 그대로다.** 시간당 작업비는 여전히 비울 수 없고,
 *     기본 작업비는 여전히 비울 수 있다 — 검증 하나를 더하다 그 둘이 뒤집히면
 *     견적서 금액이 조용히 어긋난다.
 * ============================================================================
 */

/** 통전작업 칸만 보는 시험들이 쓰는, 나머지가 전부 정상인 입력 한 벌. */
function fieldsWith(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    equipmentKind: "GENERATOR",
    hourlyRate: "100000",
    baseCost: "3500000",
    tasks: [{ id: null, taskName: "OH", hours: 24, isOverhaul: true }],
    ...overrides,
  };
}

test("통전작업 공수시간을 비우면 null 로 통과한다 — T/C 는 아직 모른다", () => {
  for (const empty of ["", "   ", null, undefined]) {
    const result = validateRepairLaborFields(fieldsWith({ powerTestHours: empty }));
    assert.ok(result.ok, `${JSON.stringify(empty)} 가 거절됐다`);
    assert.equal(
      result.data.powerTestHours,
      null,
      `${JSON.stringify(empty)} 는 0 이 아니라 null 이어야 한다`
    );
  }
});

test("칸 자체가 안 와도 null 로 통과한다 — 수리 작업 탭이 보내지 않는 경우다", () => {
  const raw = fieldsWith();
  delete raw.powerTestHours;
  const result = validateRepairLaborFields(raw);
  assert.ok(result.ok);
  assert.equal(result.data.powerTestHours, null);
});

test("14 는 그대로 통과한다 — 기본 작업비 350만원 안의 140만원이 이 값이다", () => {
  for (const input of [14, "14", " 14 "] as const) {
    const result = validateRepairLaborFields(fieldsWith({ powerTestHours: input }));
    assert.ok(result.ok, `${JSON.stringify(input)} 가 거절됐다`);
    assert.equal(result.data.powerTestHours, 14);
  }
});

test("0 · 음수 · 소수 · 글자는 powerTestHours 키로 막는다", () => {
  for (const bad of [0, "0", -1, "-3", 14.5, "14.5", "abc", "열네시간", true, {}]) {
    const result = validateRepairLaborFields(fieldsWith({ powerTestHours: bad }));
    assert.equal(result.ok, false, `${JSON.stringify(bad)} 가 통과했다`);
    if (result.ok) continue;
    // 🔴 오류 키가 이 이름이어야 화면이 그 칸 밑에 문장을 붙인다.
    assert.ok(result.fieldErrors.powerTestHours, `${JSON.stringify(bad)} 에 오류가 안 붙었다`);
  }
});

test("상한을 넘으면 막는다 — 작업 목록의 공수시간과 같은 잣대다", () => {
  const over = validateRepairLaborFields(fieldsWith({ powerTestHours: 1000 }));
  assert.equal(over.ok, false);
  if (!over.ok) assert.match(over.fieldErrors.powerTestHours, /999/);

  // 경계값 — 999 까지는 통과한다.
  const edge = validateRepairLaborFields(fieldsWith({ powerTestHours: 999 }));
  assert.ok(edge.ok);
  assert.equal(edge.data.powerTestHours, 999);
});

test("통전작업 칸이 틀려도 나머지 칸에는 오류가 붙지 않는다", () => {
  const result = validateRepairLaborFields(fieldsWith({ powerTestHours: "-1" }));
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(!result.fieldErrors.hourlyRate, "정상인 시간당 작업비에 오류가 붙었다");
  assert.ok(!result.fieldErrors.baseCost, "정상인 기본 작업비에 오류가 붙었다");
});

/**
 * ── 여기부터는 옛 규칙이 그대로인지 본다 ────────────────────────────────
 * 새 검증을 끼우다 아래 둘이 뒤집히면 견적서 금액이 조용히 어긋난다.
 */

test("시간당 작업비는 여전히 비울 수 없다 — 비면 고른 작업이 전부 0원이 된다", () => {
  for (const empty of ["", "   ", null, undefined]) {
    const result = validateRepairLaborFields(fieldsWith({ hourlyRate: empty }));
    assert.equal(result.ok, false, `${JSON.stringify(empty)} 가 통과했다`);
    if (result.ok) continue;
    assert.ok(result.fieldErrors.hourlyRate);
  }
});

test("기본 작업비는 여전히 비울 수 있고, 빈 칸은 null 이다", () => {
  const result = validateRepairLaborFields(
    fieldsWith({ baseCost: "", powerTestHours: 14 })
  );
  assert.ok(result.ok);
  assert.equal(result.data.baseCost, null);
  // 두 칸이 서로를 물들이지 않는다 — 하나가 비어도 다른 하나는 그대로다.
  assert.equal(result.data.powerTestHours, 14);
});

test("금액 형식은 여전히 part-unit-price 규칙 그대로다", () => {
  const ok = validateRepairLaborFields(fieldsWith({ hourlyRate: "1,000.50" }));
  assert.ok(ok.ok);
  assert.equal(ok.data.hourlyRate, "1000.50");

  const bad = validateRepairLaborFields(fieldsWith({ hourlyRate: "1e3" }));
  assert.equal(bad.ok, false);
});

test("작업 목록의 공수시간 규칙도 그대로다 — 0 과 소수는 막힌다", () => {
  const result = validateRepairLaborFields(
    fieldsWith({
      powerTestHours: 14,
      tasks: [{ id: null, taskName: "OH", hours: 0, isOverhaul: true }],
    })
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(result.fieldErrors["tasks.0.hours"]);
});

test("정상인 한 벌 전체 — 통전작업 시간이 다른 칸과 나란히 담긴다", () => {
  const taskId = randomUUID();
  const result = validateRepairLaborFields({
    equipmentKind: "MATCHER",
    hourlyRate: "100,000",
    baseCost: "3,500,000",
    powerTestHours: "14",
    tasks: [{ id: taskId, taskName: "바리콘 교환 작업", hours: 8, isOverhaul: false }],
  });
  assert.ok(result.ok);
  assert.deepEqual(result.data, {
    equipmentKind: "MATCHER",
    hourlyRate: "100000",
    baseCost: "3500000",
    powerTestHours: 14,
    tasks: [{ id: taskId, taskName: "바리콘 교환 작업", hours: 8, isOverhaul: false }],
    // 통전 목록 칸이 안 왔다 — 빈 목록이지 오류가 아니다(아래 시험들).
    powerTestTasks: [],
  });
});

/**
 * ============================================================================
 * 통전 작업 목록 — 건명만 있고 **공수시간이 없다**
 * ============================================================================
 * 못 박는 것은 셋이다.
 *
 *  1. **빈 목록이 정상이다.** T/C 는 아직 하나도 없다. 여기서 오류를 내면 T/C 는
 *     시간당 단가조차 저장할 수 없게 된다.
 *  2. **차례가 뜻을 갖는다.** 통전작업은 순서대로 하는 일이라, 검증이 목록을
 *     흔들면 화면에서 옮긴 차례가 저장되지 않는다.
 *  3. **시간을 요구하지 않는다.** 이 목록의 금액은 powerTestHours 하나가 정한다 —
 *     줄마다 시간을 두면 두 숫자가 같은 금액을 주장한다(2026-09-04 사용자 결정).
 * ============================================================================
 */

test("통전 작업 목록이 비어 있어도 통과한다 — T/C 는 아직 하나도 없다", () => {
  for (const empty of [[], null, undefined]) {
    const result = validateRepairLaborFields(fieldsWith({ powerTestTasks: empty }));
    assert.ok(result.ok, `${JSON.stringify(empty)} 가 거절됐다`);
    assert.deepEqual(result.data.powerTestTasks, []);
  }
});

test("정상인 통전 목록은 그대로 통과하고 차례가 보존된다", () => {
  const existingId = randomUUID();
  const result = validateRepairLaborFields(
    fieldsWith({
      powerTestTasks: [
        { id: existingId, taskName: "전원 인가 확인" },
        { id: null, taskName: "출력 파형 확인" },
        { taskName: "냉각수 누수 확인" },
      ],
    })
  );
  assert.ok(result.ok);
  // 🔴 순서가 곧 displayOrder 다 — 저장하는 쪽이 이 차례대로 1부터 매긴다.
  assert.deepEqual(result.data.powerTestTasks, [
    { id: existingId, taskName: "전원 인가 확인" },
    { id: null, taskName: "출력 파형 확인" },
    { id: null, taskName: "냉각수 누수 확인" },
  ]);
});

test("통전 작업의 건명이 비면 powerTestTasks.<index> 키로 막는다", () => {
  for (const blank of ["", "   ", null, undefined, 7]) {
    const result = validateRepairLaborFields(
      fieldsWith({
        powerTestTasks: [{ id: null, taskName: "전원 인가 확인" }, { id: null, taskName: blank }],
      })
    );
    assert.equal(result.ok, false, `${JSON.stringify(blank)} 가 통과했다`);
    if (result.ok) continue;
    // 🔴 오류 키가 이 이름이어야 화면이 그 줄 옆에 문장을 붙인다.
    assert.ok(
      result.fieldErrors["powerTestTasks.1.taskName"],
      `${JSON.stringify(blank)} 에 오류가 안 붙었다`
    );
    // 멀쩡한 첫 줄에는 오류가 붙지 않는다.
    assert.ok(!result.fieldErrors["powerTestTasks.0.taskName"]);
  }
});

test("같은 건명이 두 줄이면 막는다 — 표의 부분 unique 색인과 짝이다", () => {
  const result = validateRepairLaborFields(
    fieldsWith({
      powerTestTasks: [
        { id: null, taskName: "전원 인가 확인" },
        // 앞뒤 공백만 다른 것도 같은 이름이다(둘 다 trim 한 뒤 견준다).
        { id: null, taskName: "  전원 인가 확인  " },
      ],
    })
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.fieldErrors["powerTestTasks.1.taskName"], /겹칩니다/);
});

test("건명이 200자를 넘으면 막는다 — 수리 작업 목록과 같은 잣대다", () => {
  const over = validateRepairLaborFields(
    fieldsWith({ powerTestTasks: [{ id: null, taskName: "가".repeat(201) }] })
  );
  assert.equal(over.ok, false);
  if (!over.ok) assert.match(over.fieldErrors["powerTestTasks.0.taskName"], /200/);

  // 경계값 — 200자까지는 통과한다.
  const edge = validateRepairLaborFields(
    fieldsWith({ powerTestTasks: [{ id: null, taskName: "가".repeat(200) }] })
  );
  assert.ok(edge.ok);
});

test("줄 수 상한을 넘으면 powerTestTasks 키로 막는다", () => {
  const rows = (count: number) =>
    Array.from({ length: count }, (_, i) => ({ id: null, taskName: `점검 ${i + 1}` }));

  const over = validateRepairLaborFields(fieldsWith({ powerTestTasks: rows(101) }));
  assert.equal(over.ok, false);
  if (!over.ok) assert.ok(over.fieldErrors.powerTestTasks);

  // 경계값 — 100줄까지는 통과한다.
  const edge = validateRepairLaborFields(fieldsWith({ powerTestTasks: rows(100) }));
  assert.ok(edge.ok);
  assert.equal(edge.data.powerTestTasks.length, 100);
});

test("배열이 아니면 막는다 — 목록이 아닌 것을 목록처럼 저장하지 않는다", () => {
  for (const bad of ["전원 인가 확인", 3, {}, true]) {
    const result = validateRepairLaborFields(fieldsWith({ powerTestTasks: bad }));
    assert.equal(result.ok, false, `${JSON.stringify(bad)} 가 통과했다`);
    if (result.ok) continue;
    assert.ok(result.fieldErrors.powerTestTasks);
  }
});

test("통전 목록에 공수시간을 요구하지 않는다 — 시간 없이도 통과한다", () => {
  const result = validateRepairLaborFields(
    fieldsWith({
      // 🔴 hours 를 아예 안 보낸다. 이 목록의 금액은 powerTestHours 하나가 정한다.
      powerTestTasks: [{ id: null, taskName: "전원 인가 확인" }],
      powerTestHours: 14,
    })
  );
  assert.ok(result.ok);
  assert.deepEqual(result.data.powerTestTasks, [{ id: null, taskName: "전원 인가 확인" }]);
  assert.equal(result.data.powerTestHours, 14);
});

test("통전 목록이 틀려도 나머지 칸과 수리 작업 목록에는 오류가 붙지 않는다", () => {
  const result = validateRepairLaborFields(
    fieldsWith({
      powerTestHours: 14,
      powerTestTasks: [{ id: null, taskName: "" }],
    })
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(result.fieldErrors["powerTestTasks.0.taskName"]);
  assert.ok(!result.fieldErrors.hourlyRate, "정상인 시간당 작업비에 오류가 붙었다");
  assert.ok(!result.fieldErrors.baseCost, "정상인 기본 작업비에 오류가 붙었다");
  assert.ok(!result.fieldErrors.powerTestHours, "정상인 통전작업 공수시간에 오류가 붙었다");
  assert.ok(!result.fieldErrors.tasks, "정상인 수리 작업 목록에 오류가 붙었다");
  assert.ok(!result.fieldErrors["tasks.0.taskName"], "정상인 수리 작업 줄에 오류가 붙었다");
  assert.ok(!result.fieldErrors["tasks.0.hours"], "정상인 수리 작업 줄에 오류가 붙었다");
});
