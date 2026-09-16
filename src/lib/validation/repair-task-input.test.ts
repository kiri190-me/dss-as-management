import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

import {
  parseRepairLaborHours,
  REPAIR_LABOR_SCOPES,
  validateRepairLaborFields,
} from "./repair-task-input";

/**
 * ============================================================================
 * 수리 작업 비용 입력 검증
 * ============================================================================
 * 먼저 못 박는 것은 넷이다(갈래 **목록** 셋은 이 파일 아래쪽에 따로 있다).
 *
 *  1. **갈래 공수시간의 빈 칸은 `0` 이 아니라 `null` 이다.** 기본 작업비 안에
 *     이미 들어 있는 몫이라, 이 값이 0 으로 접히면 그 갈래를 빼는 견적서가
 *     "빼야 할 것이 없다"고 판단해 버린다. 서류는 세 장비 모두, 통전은 T/C 가
 *     실제로 아직 모른다.
 *  2. **🔴 서류만 `0` 을 받는다.** 조사·통전은 `> 0`, 서류는 `>= 0` 이고, 이 잣대가
 *     schema/repair-labor.ts 의 세 CHECK 와 **글자 그대로 짝**이어야 한다 — 여기서
 *     통과한 값이 DB 에서 터지면 사람은 "일시적으로 처리할 수 없습니다"를 듣는다.
 *  3. **🔴 기본 작업비(base_cost)는 이제 이 검증을 지나지 않는다.** 2026-09-16 부터
 *     기본 작업비는 사람이 적는 값이 아니라 세 공수시간의 합이다. 칸과 값은 DB 에
 *     그대로 남지만 저장 입력에는 없다.
 *  4. **새 칸을 끼우면서 옛 규칙이 그대로다.** 시간당 작업비는 여전히 비울 수 없고,
 *     작업 목록의 공수시간은 여전히 0 을 받지 않는다 — 검증 하나를 더하다 그것들이
 *     뒤집히면 견적서 금액이 조용히 어긋난다.
 * ============================================================================
 */

/** 보는 칸만 남기고 나머지가 전부 정상인 입력 한 벌. */
function fieldsWith(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    equipmentKind: "GENERATOR",
    hourlyRate: "100000",
    tasks: [{ id: null, taskName: "OH", hours: 24, isOverhaul: true }],
    ...overrides,
  };
}

test("세 갈래의 공수시간을 비우면 null 로 통과한다 — 아직 모르는 장비가 실제로 있다", () => {
  for (const empty of ["", "   ", null, undefined]) {
    const result = validateRepairLaborFields(
      fieldsWith({ investigationHours: empty, powerTestHours: empty, documentHours: empty })
    );
    assert.ok(result.ok, `${JSON.stringify(empty)} 가 거절됐다`);
    assert.equal(result.data.investigationHours, null, "조사는 0 이 아니라 null 이어야 한다");
    assert.equal(result.data.powerTestHours, null, "통전은 0 이 아니라 null 이어야 한다");
    assert.equal(result.data.documentHours, null, "서류는 0 이 아니라 null 이어야 한다");
  }
});

test("칸 자체가 안 와도 셋 다 null 로 통과한다", () => {
  const result = validateRepairLaborFields(fieldsWith());
  assert.ok(result.ok);
  assert.equal(result.data.investigationHours, null);
  assert.equal(result.data.powerTestHours, null);
  assert.equal(result.data.documentHours, null);
});

test("개발 DB 의 값이 그대로 통과한다 — 제너레이터 조사 21 · 통전 14", () => {
  for (const input of [14, "14", " 14 "] as const) {
    const result = validateRepairLaborFields(fieldsWith({ powerTestHours: input }));
    assert.ok(result.ok, `${JSON.stringify(input)} 가 거절됐다`);
    assert.equal(result.data.powerTestHours, 14);
  }
  const both = validateRepairLaborFields(
    fieldsWith({ investigationHours: "21", powerTestHours: "14" })
  );
  assert.ok(both.ok);
  assert.equal(both.data.investigationHours, 21);
  assert.equal(both.data.powerTestHours, 14);
});

test("🔴 조사·통전은 0 을 받지 않는다 — DB CHECK(> 0)과 같은 잣대여야 한다", () => {
  for (const scope of ["investigationHours", "powerTestHours"] as const) {
    for (const bad of [0, "0", -1, "-3", 14.5, "14.5", "abc", "열네시간", true, {}]) {
      const result = validateRepairLaborFields(fieldsWith({ [scope]: bad }));
      assert.equal(result.ok, false, `${scope} 에 ${JSON.stringify(bad)} 가 통과했다`);
      if (result.ok) continue;
      // 🔴 오류 키가 이 이름이어야 화면이 그 칸 밑에 문장을 붙인다.
      assert.ok(result.fieldErrors[scope], `${scope} 의 ${JSON.stringify(bad)} 에 오류가 안 붙었다`);
    }
  }
});

test("🔴 서류만 0 을 받는다 — 「서류작업이 없는 장비」는 정하지 않은 것이 아니다", () => {
  for (const zero of [0, "0", " 0 "] as const) {
    const result = validateRepairLaborFields(fieldsWith({ documentHours: zero }));
    assert.ok(result.ok, `${JSON.stringify(zero)} 가 거절됐다`);
    // 🔴 0 이지 null 이 아니다 — null 은 "모른다"이고 0 은 "없다"이다.
    assert.equal(result.data.documentHours, 0);
  }

  // 음수·소수·글자는 서류에서도 막힌다.
  for (const bad of [-1, "-3", 2.5, "abc", true, {}]) {
    const result = validateRepairLaborFields(fieldsWith({ documentHours: bad }));
    assert.equal(result.ok, false, `${JSON.stringify(bad)} 가 통과했다`);
    if (result.ok) continue;
    assert.ok(result.fieldErrors.documentHours);
  }
});

test("갈래마다 하한이 문구에 그대로 드러난다 — 화면이 이 말을 그대로 보인다", () => {
  const investigation = validateRepairLaborFields(fieldsWith({ investigationHours: 0 }));
  assert.equal(investigation.ok, false);
  if (!investigation.ok) {
    assert.equal(
      investigation.fieldErrors.investigationHours,
      "조사작업 공수시간은 1 이상 999 이하의 정수여야 합니다."
    );
  }
  const document = validateRepairLaborFields(fieldsWith({ documentHours: -1 }));
  assert.equal(document.ok, false);
  if (!document.ok) {
    assert.equal(
      document.fieldErrors.documentHours,
      "서류작업 공수시간은 0 이상 999 이하의 정수여야 합니다."
    );
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

test("한 갈래의 칸이 틀려도 나머지 칸에는 오류가 붙지 않는다", () => {
  const result = validateRepairLaborFields(
    fieldsWith({ powerTestHours: "-1", investigationHours: 21, documentHours: 0 })
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(result.fieldErrors.powerTestHours);
  assert.ok(!result.fieldErrors.hourlyRate, "정상인 시간당 작업비에 오류가 붙었다");
  assert.ok(!result.fieldErrors.investigationHours, "정상인 조사 공수시간에 오류가 붙었다");
  assert.ok(!result.fieldErrors.documentHours, "정상인 서류 공수시간에 오류가 붙었다");
});

/**
 * 🔴 화면과 서버가 **같은 함수**로 공수시간을 본다. 잣대가 갈리면 화면에서 통과한
 * 값이 서버에서, 심하면 DB CHECK 에서 터진다 — 그때 사람이 듣는 말은 "칸을 고쳐
 * 주세요"가 아니다(RepairLaborScreen.tsx 의 hoursErrors).
 */
test("parseRepairLaborHours 가 화면이 쓰는 잣대 그대로다", () => {
  assert.deepEqual(parseRepairLaborHours("INVESTIGATION", ""), { ok: true, value: null });
  assert.deepEqual(parseRepairLaborHours("INVESTIGATION", "21"), { ok: true, value: 21 });
  assert.equal(parseRepairLaborHours("INVESTIGATION", "0").ok, false);
  assert.deepEqual(parseRepairLaborHours("DOCUMENT", "0"), { ok: true, value: 0 });
  assert.equal(parseRepairLaborHours("DOCUMENT", "-1").ok, false);
  assert.equal(parseRepairLaborHours("POWER_TEST", "0").ok, false);
});

/**
 * ── 여기부터는 옛 규칙이 그대로인지 본다 ────────────────────────────────
 * 새 검증을 끼우다 아래 셋이 뒤집히면 견적서 금액이 조용히 어긋난다.
 */

test("시간당 작업비는 여전히 비울 수 없다 — 비면 고른 작업이 전부 0원이 된다", () => {
  for (const empty of ["", "   ", null, undefined]) {
    const result = validateRepairLaborFields(fieldsWith({ hourlyRate: empty }));
    assert.equal(result.ok, false, `${JSON.stringify(empty)} 가 통과했다`);
    if (result.ok) continue;
    assert.ok(result.fieldErrors.hourlyRate);
  }
});

test("🔴 기본 작업비는 저장 입력에 없다 — 보내와도 담지 않는다", () => {
  // 2026-09-16 부터 기본 작업비는 사람이 적는 값이 아니라 세 공수시간의 합이다.
  // 🔴 DB 의 base_cost 칸은 그대로 남는다 — 저장이 그 칸을 건드리지 않을 뿐이고,
  // 그 약속은 mutations 통합 시험이 값으로 못 박는다.
  const result = validateRepairLaborFields(fieldsWith({ baseCost: "3500000" }));
  assert.ok(result.ok, "옛 칸이 섞여 와도 거절하지는 않는다");
  assert.equal("baseCost" in result.data, false, "옛 칸이 조용히 딸려 들어가면 안 된다");
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

test("정상인 한 벌 전체 — 세 공수시간과 세 목록이 나란히 담긴다", () => {
  const taskId = randomUUID();
  const result = validateRepairLaborFields({
    equipmentKind: "MATCHER",
    hourlyRate: "100,000",
    investigationHours: "21",
    powerTestHours: "14",
    documentHours: "",
    tasks: [{ id: taskId, taskName: "바리콘 교환 작업", hours: 8, isOverhaul: false }],
    investigationTasks: [{ id: null, taskName: "외관 및 내부 검사" }],
  });
  assert.ok(result.ok);
  assert.deepEqual(result.data, {
    equipmentKind: "MATCHER",
    hourlyRate: "100000",
    investigationHours: 21,
    powerTestHours: 14,
    documentHours: null,
    tasks: [{ id: taskId, taskName: "바리콘 교환 작업", hours: 8, isOverhaul: false }],
    // 🔴 세 갈래가 언제나 셋 다 있다 — 안 온 갈래는 빈 목록이지 없는 칸이 아니다.
    scopeTasks: {
      INVESTIGATION: [{ id: null, taskName: "외관 및 내부 검사" }],
      POWER_TEST: [],
      DOCUMENT: [],
    },
  });
});

/**
 * ============================================================================
 * 갈래 작업 목록 셋 — 건명만 있고 **공수시간이 없다**
 * ============================================================================
 * 못 박는 것은 넷이다.
 *
 *  1. **빈 목록이 정상이다.** 조사·서류는 아직 하나도 없다. 여기서 오류를 내면 그
 *     장비는 시간당 단가조차 저장할 수 없게 된다.
 *  2. **차례가 뜻을 갖는다.** 순서대로 하는 일이라, 검증이 목록을 흔들면 화면에서
 *     옮긴 차례가 저장되지 않는다.
 *  3. **시간을 요구하지 않는다.** 갈래의 금액은 그 갈래 공수시간 하나가 정한다 —
 *     줄마다 시간을 두면 두 숫자가 같은 금액을 주장한다(2026-09-04 사용자 결정).
 *  4. **🔴 갈래가 다르면 같은 건명을 쓸 수 있다.** 표의 유니크가 `(장비, scope, 건명)`
 *     이라, 「외관 및 내부 검사」처럼 두 갈래에 다 있을 법한 이름이 막히면 안 된다.
 * ============================================================================
 */

/** 갈래마다의 칸 이름 — 화면이 보내는 이름이자 오류 열쇠의 앞부분이다. */
const LIST_FIELDS = {
  INVESTIGATION: "investigationTasks",
  POWER_TEST: "powerTestTasks",
  DOCUMENT: "documentTasks",
} as const;

test("세 목록이 비어 있어도 통과한다 — 조사·서류는 아직 하나도 없다", () => {
  for (const scope of REPAIR_LABOR_SCOPES) {
    for (const empty of [[], null, undefined]) {
      const result = validateRepairLaborFields(fieldsWith({ [LIST_FIELDS[scope]]: empty }));
      assert.ok(result.ok, `${scope} 에 ${JSON.stringify(empty)} 가 거절됐다`);
      assert.deepEqual(result.data.scopeTasks[scope], []);
    }
  }
});

test("정상인 갈래 목록은 그대로 통과하고 차례가 보존된다", () => {
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
  assert.deepEqual(result.data.scopeTasks.POWER_TEST, [
    { id: existingId, taskName: "전원 인가 확인" },
    { id: null, taskName: "출력 파형 확인" },
    { id: null, taskName: "냉각수 누수 확인" },
  ]);
});

test("🔴 세 목록이 한 번에 실려도 서로 섞이지 않는다 — 저장이 셋을 함께 보낸다", () => {
  const result = validateRepairLaborFields(
    fieldsWith({
      investigationTasks: [{ id: null, taskName: "조사 A" }, { id: null, taskName: "조사 B" }],
      powerTestTasks: [{ id: null, taskName: "통전 A" }],
      documentTasks: [{ id: null, taskName: "서류 A" }],
    })
  );
  assert.ok(result.ok);
  assert.deepEqual(
    {
      INVESTIGATION: result.data.scopeTasks.INVESTIGATION.map((row) => row.taskName),
      POWER_TEST: result.data.scopeTasks.POWER_TEST.map((row) => row.taskName),
      DOCUMENT: result.data.scopeTasks.DOCUMENT.map((row) => row.taskName),
    },
    { INVESTIGATION: ["조사 A", "조사 B"], POWER_TEST: ["통전 A"], DOCUMENT: ["서류 A"] }
  );
});

test("🔴 갈래가 다르면 같은 건명을 쓸 수 있다 — 유니크가 (장비, scope, 건명)이다", () => {
  const result = validateRepairLaborFields(
    fieldsWith({
      investigationTasks: [{ id: null, taskName: "외관 및 내부 검사" }],
      powerTestTasks: [{ id: null, taskName: "외관 및 내부 검사" }],
      documentTasks: [{ id: null, taskName: "외관 및 내부 검사" }],
    })
  );
  assert.ok(result.ok, "두 갈래에 다 있을 법한 이름이 막히면 안 된다");
  for (const scope of REPAIR_LABOR_SCOPES) {
    assert.deepEqual(result.data.scopeTasks[scope], [{ id: null, taskName: "외관 및 내부 검사" }]);
  }
});

test("건명이 비면 <칸이름>.<index> 키로 막는다 — 갈래마다 제 키다", () => {
  for (const scope of REPAIR_LABOR_SCOPES) {
    const field = LIST_FIELDS[scope];
    for (const blank of ["", "   ", null, undefined, 7]) {
      const result = validateRepairLaborFields(
        fieldsWith({ [field]: [{ id: null, taskName: "첫 줄" }, { id: null, taskName: blank }] })
      );
      assert.equal(result.ok, false, `${field} 에 ${JSON.stringify(blank)} 가 통과했다`);
      if (result.ok) continue;
      // 🔴 오류 키가 이 이름이어야 화면이 그 줄 옆에 문장을 붙인다.
      assert.ok(
        result.fieldErrors[`${field}.1.taskName`],
        `${field} 의 ${JSON.stringify(blank)} 에 오류가 안 붙었다`
      );
      // 멀쩡한 첫 줄에는 오류가 붙지 않는다.
      assert.ok(!result.fieldErrors[`${field}.0.taskName`]);
    }
  }
});

test("같은 갈래 안에서 건명이 두 줄이면 막는다 — 표의 부분 unique 색인과 짝이다", () => {
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
    fieldsWith({ documentTasks: [{ id: null, taskName: "가".repeat(201) }] })
  );
  assert.equal(over.ok, false);
  if (!over.ok) assert.match(over.fieldErrors["documentTasks.0.taskName"], /200/);

  // 경계값 — 200자까지는 통과한다.
  const edge = validateRepairLaborFields(
    fieldsWith({ documentTasks: [{ id: null, taskName: "가".repeat(200) }] })
  );
  assert.ok(edge.ok);
});

test("줄 수 상한을 넘으면 그 갈래의 칸 이름으로 막는다", () => {
  const rows = (count: number) =>
    Array.from({ length: count }, (_, i) => ({ id: null, taskName: `점검 ${i + 1}` }));

  const over = validateRepairLaborFields(fieldsWith({ investigationTasks: rows(101) }));
  assert.equal(over.ok, false);
  if (!over.ok) assert.ok(over.fieldErrors.investigationTasks);

  // 경계값 — 100줄까지는 통과한다.
  const edge = validateRepairLaborFields(fieldsWith({ investigationTasks: rows(100) }));
  assert.ok(edge.ok);
  assert.equal(edge.data.scopeTasks.INVESTIGATION.length, 100);
});

test("배열이 아니면 막는다 — 목록이 아닌 것을 목록처럼 저장하지 않는다", () => {
  for (const bad of ["전원 인가 확인", 3, {}, true]) {
    const result = validateRepairLaborFields(fieldsWith({ powerTestTasks: bad }));
    assert.equal(result.ok, false, `${JSON.stringify(bad)} 가 통과했다`);
    if (result.ok) continue;
    assert.ok(result.fieldErrors.powerTestTasks);
  }
});

test("갈래 목록에 공수시간을 요구하지 않는다 — 시간 없이도 통과한다", () => {
  const result = validateRepairLaborFields(
    fieldsWith({
      // 🔴 hours 를 아예 안 보낸다. 이 목록의 금액은 그 갈래 공수시간 하나가 정한다.
      documentTasks: [{ id: null, taskName: "성적서 작성" }],
      documentHours: 3,
    })
  );
  assert.ok(result.ok);
  assert.deepEqual(result.data.scopeTasks.DOCUMENT, [{ id: null, taskName: "성적서 작성" }]);
  assert.equal(result.data.documentHours, 3);
});

test("한 갈래 목록이 틀려도 다른 갈래와 나머지 칸에는 오류가 붙지 않는다", () => {
  const result = validateRepairLaborFields(
    fieldsWith({
      powerTestHours: 14,
      investigationTasks: [{ id: null, taskName: "조사 A" }],
      powerTestTasks: [{ id: null, taskName: "" }],
      documentTasks: [{ id: null, taskName: "서류 A" }],
    })
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(result.fieldErrors["powerTestTasks.0.taskName"]);
  assert.ok(!result.fieldErrors["investigationTasks.0.taskName"], "정상인 조사 줄에 오류가 붙었다");
  assert.ok(!result.fieldErrors["documentTasks.0.taskName"], "정상인 서류 줄에 오류가 붙었다");
  assert.ok(!result.fieldErrors.hourlyRate, "정상인 시간당 작업비에 오류가 붙었다");
  assert.ok(!result.fieldErrors.powerTestHours, "정상인 통전작업 공수시간에 오류가 붙었다");
  assert.ok(!result.fieldErrors.tasks, "정상인 수리 작업 목록에 오류가 붙었다");
  assert.ok(!result.fieldErrors["tasks.0.taskName"], "정상인 수리 작업 줄에 오류가 붙었다");
  assert.ok(!result.fieldErrors["tasks.0.hours"], "정상인 수리 작업 줄에 오류가 붙었다");
});
