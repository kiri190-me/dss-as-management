import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { sumQuoteLaborCost } from "./quote-labor-cost";
import {
  MAX_REPAIR_TASK_QUANTITY,
  MIN_REPAIR_TASK_QUANTITY,
  applyOverhaulQuantities,
  clampRepairTaskQuantity,
  expandRepairTaskLines,
  repairTaskQuantityOf,
  restoreRepairTaskQuantities,
  selectedRepairTaskNames,
  setRepairTaskChecked,
  setRepairTaskQuantity,
  type RepairTaskCatalogEntry,
} from "./quote-repair-task-selection";

/**
 * ============================================================================
 * 같은 수리 작업을 여러 번 — 수량은 줄로 펴지고, 문구는 그대로다
 * ============================================================================
 * 제너레이터 실제 값으로 셈한다: 시간당 10만원, 기본 350만원, `OH` 24시간.
 * ============================================================================
 */

const RATE = "100000";

const CATALOG: RepairTaskCatalogEntry[] = [
  { id: "t-oh", taskName: "OH", hours: 24, isOverhaul: true },
  { id: "t-fan", taskName: "FAN 교환", hours: 2, isOverhaul: false },
  { id: "t-rf", taskName: "RF 모듈 교체", hours: 8, isOverhaul: false },
  { id: "t-mcu", taskName: "MCU 기판 교환 작업", hours: 12, isOverhaul: false },
];

const q = (entries: [string, number][]) => new Map(entries);

/**
 * 🔴 예전 화면(`Set<id>`)이 하던 일을 **그대로 옮겨 적은 것.** 수량이 모두 1 일 때
 * 새 규칙이 이것과 한 글자도 다르지 않아야 한다 — 옛 견적서를 열어 그대로
 * 저장해도 아무것도 바뀌지 않는다는 약속이다.
 */
const legacy = {
  selectedTasks(tasks: RepairTaskCatalogEntry[], ids: Set<string>, hourlyRate: string) {
    return tasks
      .filter((task) => ids.has(task.id))
      .map((task) => ({ taskId: task.id, taskName: task.taskName, hours: task.hours, hourlyRate }));
  },
  taskNames(tasks: RepairTaskCatalogEntry[], ids: Set<string>) {
    return tasks.filter((task) => ids.has(task.id)).map((task) => task.taskName);
  },
  restore(saved: { taskId: string | null }[]) {
    return new Set(saved.map((task) => task.taskId).filter((id): id is string => id !== null));
  },
  applyOverhaul(tasks: RepairTaskCatalogEntry[], ids: Set<string>, isOverhaulQuote: boolean) {
    const overhaulIds = tasks.filter((task) => task.isOverhaul).map((task) => task.id);
    if (overhaulIds.length === 0) return null;
    const next = new Set(ids);
    for (const id of overhaulIds) {
      if (isOverhaulQuote) next.add(id);
      else next.delete(id);
    }
    return next;
  },
};

describe("수량 → 줄 펴기", () => {
  test("수량만큼 같은 작업이 여러 줄이 된다 — 카탈로그 차례대로, 같은 작업은 붙어서", () => {
    // 일부러 Map 에 넣는 순서를 카탈로그와 다르게 한다 — 줄의 차례는 넣은 순서가
    // 아니라 카탈로그 차례다(문서와 저장 줄의 차례가 그것이다).
    const lines = expandRepairTaskLines(CATALOG, q([["t-mcu", 1], ["t-rf", 3], ["t-oh", 2]]), RATE);
    assert.deepEqual(
      lines.map((line) => line.taskId),
      ["t-oh", "t-oh", "t-rf", "t-rf", "t-rf", "t-mcu"]
    );
    // 줄마다 그때 단가를 들고 간다(저장 스냅샷).
    assert.ok(lines.every((line) => line.hourlyRate === RATE));
  });

  test("줄의 모양이 예전 selectedTasks 와 같다 — 키와 키 차례까지", () => {
    const [line] = expandRepairTaskLines(CATALOG, q([["t-fan", 1]]), RATE);
    assert.deepEqual(Object.keys(line), ["taskId", "taskName", "hours", "hourlyRate"]);
    assert.deepEqual(line, { taskId: "t-fan", taskName: "FAN 교환", hours: 2, hourlyRate: RATE });
  });

  test("카탈로그에 없는 id 는 줄이 되지 않는다", () => {
    const lines = expandRepairTaskLines(CATALOG, q([["gone", 2], ["t-fan", 1]]), RATE);
    assert.deepEqual(lines.map((line) => line.taskId), ["t-fan"]);
  });

  test("아무것도 안 고르면 줄이 없다", () => {
    assert.deepEqual(expandRepairTaskLines(CATALOG, new Map(), RATE), []);
  });

  test("🔴 펴진 줄을 sumQuoteLaborCost 에 넣으면 수량만큼 더해진다 — OH × 2 = 350만 + 480만", () => {
    const lines = expandRepairTaskLines(CATALOG, q([["t-oh", 2], ["t-fan", 3]]), RATE);
    const result = sumQuoteLaborCost(lines, "3500000");
    assert.equal(result.tasksTotal, 24 * 100000 * 2 + 2 * 100000 * 3);
    assert.equal(result.tasksTotal, 5400000);
    assert.equal(result.total, 8900000);
  });

  test("수량이 늘면 통전작업 차감은 그대로다 — 차감은 기본 작업비에서만 나간다", () => {
    const lines = expandRepairTaskLines(CATALOG, q([["t-oh", 2]]), RATE);
    const result = sumQuoteLaborCost(lines, "3500000", { excluded: true, hours: 14, hourlyRate: RATE });
    assert.equal(result.powerTestDeduction, 1400000);
    assert.equal(result.total, 4800000 + 2100000);
  });
});

describe("저장된 줄 → 수량 되살리기", () => {
  test("같은 task_id 가 여러 줄이면 그 수만큼 수량이 된다", () => {
    const restored = restoreRepairTaskQuantities([
      { taskId: "t-oh" },
      { taskId: "t-oh" },
      { taskId: "t-rf" },
      { taskId: "t-oh" },
    ]);
    assert.deepEqual([...restored.entries()].sort(), [["t-oh", 3], ["t-rf", 1]]);
  });

  test("task_id 가 없는 줄은 셀 수 없어 건너뛴다", () => {
    const restored = restoreRepairTaskQuantities([{ taskId: null }, { taskId: "t-fan" }, { taskId: null }]);
    assert.deepEqual([...restored.entries()], [["t-fan", 1]]);
  });

  test("카탈로그에 지금은 없는 id 도 세어 두지만 줄로 펴지지는 않는다 — 예전 Set 과 같다", () => {
    const restored = restoreRepairTaskQuantities([{ taskId: "gone" }, { taskId: "gone" }, { taskId: "t-rf" }]);
    assert.equal(repairTaskQuantityOf(restored, "gone"), 2);
    assert.deepEqual(
      expandRepairTaskLines(CATALOG, restored, RATE).map((line) => line.taskId),
      ["t-rf"]
    );
  });

  test("되살린 뒤 다시 펴면 저장돼 있던 줄과 같다 — 열어서 그대로 저장해도 바뀌지 않는다", () => {
    const saved = expandRepairTaskLines(CATALOG, q([["t-oh", 2], ["t-rf", 1], ["t-mcu", 4]]), RATE);
    const again = expandRepairTaskLines(CATALOG, restoreRepairTaskQuantities(saved), RATE);
    assert.deepEqual(again, saved);
  });

  test("🔴 상한으로 자르지 않는다 — 저장된 줄은 이미 보낸 견적서의 근거다", () => {
    const saved = Array.from({ length: MAX_REPAIR_TASK_QUANTITY + 1 }, () => ({ taskId: "t-fan" }));
    assert.equal(repairTaskQuantityOf(restoreRepairTaskQuantities(saved), "t-fan"), 100);
  });
});

describe("체크와 수량", () => {
  test("켜면 수량 1, 끄면 빠진다", () => {
    const on = setRepairTaskChecked(new Map(), "t-rf", true);
    assert.equal(repairTaskQuantityOf(on, "t-rf"), 1);
    const off = setRepairTaskChecked(on, "t-rf", false);
    assert.equal(off.has("t-rf"), false);
  });

  test("이미 켜진 작업을 다시 켜도 수량을 되돌리지 않는다", () => {
    const next = setRepairTaskChecked(q([["t-rf", 3]]), "t-rf", true);
    assert.equal(repairTaskQuantityOf(next, "t-rf"), 3);
  });

  test("수량을 바꾼다 — 하한 1, 상한 99", () => {
    const start = q([["t-rf", 1]]);
    assert.equal(repairTaskQuantityOf(setRepairTaskQuantity(start, "t-rf", 2), "t-rf"), 2);
    // − 로 0 이 되지 않는다 — 빼려면 체크를 푼다.
    assert.equal(repairTaskQuantityOf(setRepairTaskQuantity(start, "t-rf", 0), "t-rf"), 1);
    assert.equal(repairTaskQuantityOf(setRepairTaskQuantity(start, "t-rf", -5), "t-rf"), 1);
    assert.equal(
      repairTaskQuantityOf(setRepairTaskQuantity(start, "t-rf", MAX_REPAIR_TASK_QUANTITY + 1), "t-rf"),
      MAX_REPAIR_TASK_QUANTITY
    );
  });

  test("고르지 않은 작업의 수량은 바꾸지 않는다 — 수량이 체크를 켜는 길이 되지 않는다", () => {
    const next = setRepairTaskQuantity(new Map(), "t-rf", 3);
    assert.equal(next.has("t-rf"), false);
  });

  test("상태를 제자리에서 고치지 않는다 — 늘 새 Map 이다", () => {
    const start = q([["t-rf", 1]]);
    setRepairTaskChecked(start, "t-fan", true);
    setRepairTaskChecked(start, "t-rf", false);
    setRepairTaskQuantity(start, "t-rf", 5);
    applyOverhaulQuantities(CATALOG, start, true);
    assert.deepEqual([...start.entries()], [["t-rf", 1]]);
  });

  test("clampRepairTaskQuantity — 정수로, 범위 안으로, 못 읽으면 하한", () => {
    assert.equal(MIN_REPAIR_TASK_QUANTITY, 1);
    assert.equal(MAX_REPAIR_TASK_QUANTITY, 99);
    assert.equal(clampRepairTaskQuantity(1), 1);
    assert.equal(clampRepairTaskQuantity(2.7), 2);
    assert.equal(clampRepairTaskQuantity(0), 1);
    assert.equal(clampRepairTaskQuantity(99), 99);
    assert.equal(clampRepairTaskQuantity(1000), 99);
    assert.equal(clampRepairTaskQuantity(Number.NaN), 1);
    assert.equal(clampRepairTaskQuantity(Number.POSITIVE_INFINITY), 1);
  });
});

describe("O/H 규칙", () => {
  test("O/H 로 바꾸면 오버홀 작업이 없을 때 수량 1 로 들어간다", () => {
    const next = applyOverhaulQuantities(CATALOG, q([["t-fan", 2]]), true);
    assert.ok(next);
    assert.deepEqual([...next.entries()].sort(), [["t-fan", 2], ["t-oh", 1]]);
  });

  test("🔴 이미 있으면 수량을 건드리지 않는다 — 2 로 올려 둔 것을 1 로 되돌리지 않는다", () => {
    const next = applyOverhaulQuantities(CATALOG, q([["t-oh", 2]]), true);
    assert.equal(next && repairTaskQuantityOf(next, "t-oh"), 2);
  });

  test("O/H 가 아니면 수량이 몇이든 뺀다", () => {
    const next = applyOverhaulQuantities(CATALOG, q([["t-oh", 3], ["t-rf", 1]]), false);
    assert.ok(next);
    assert.deepEqual([...next.entries()], [["t-rf", 1]]);
  });

  test("오버홀로 표시된 작업이 없는 장비면 null — 따라 움직일 줄이 없다", () => {
    const plain = CATALOG.map((task) => ({ ...task, isOverhaul: false }));
    assert.equal(applyOverhaulQuantities(plain, q([["t-rf", 1]]), true), null);
  });
});

describe("「2) 수리작업」 이름 목록 — 문구는 수량과 무관하다", () => {
  test("🔴 수량이 2 이상이어도 이름은 한 번씩, 꼬리(× N)가 없다", () => {
    const names = selectedRepairTaskNames(CATALOG, q([["t-rf", 2], ["t-oh", 1], ["t-mcu", 99]]));
    assert.deepEqual(names, ["OH", "RF 모듈 교체", "MCU 기판 교환 작업"]);
    assert.ok(names.every((name) => !name.includes("×")));
  });

  test("수량만 바꾸면 이름 목록이 한 글자도 바뀌지 않는다", () => {
    const one = q([["t-rf", 1], ["t-fan", 1]]);
    const many = setRepairTaskQuantity(setRepairTaskQuantity(one, "t-rf", 5), "t-fan", 2);
    assert.deepEqual(selectedRepairTaskNames(CATALOG, many), selectedRepairTaskNames(CATALOG, one));
  });

  test("카탈로그에 없는 id 는 이름이 되지 않는다", () => {
    assert.deepEqual(selectedRepairTaskNames(CATALOG, q([["gone", 1]])), []);
  });
});

describe("🔴 수량이 모두 1 이면 예전 동작과 한 글자도 같다", () => {
  const cases: { label: string; ids: string[] }[] = [
    { label: "아무것도 안 고름", ids: [] },
    { label: "하나", ids: ["t-oh"] },
    { label: "여럿(넣은 순서가 카탈로그와 다름)", ids: ["t-mcu", "t-fan", "t-oh"] },
    { label: "전부", ids: CATALOG.map((task) => task.id) },
    { label: "카탈로그에 없는 id 섞임", ids: ["gone", "t-rf"] },
  ];

  for (const { label, ids } of cases) {
    test(`${label} — 저장 줄 · 합계 · 이름`, () => {
      const set = new Set(ids);
      const quantities = new Map(ids.map((id) => [id, 1] as [string, number]));

      const lines = expandRepairTaskLines(CATALOG, quantities, RATE);
      const legacyLines = legacy.selectedTasks(CATALOG, set, RATE);
      assert.deepEqual(lines, legacyLines, "저장 줄");
      assert.equal(JSON.stringify(lines), JSON.stringify(legacyLines), "직렬화한 글자까지");

      assert.deepEqual(
        sumQuoteLaborCost(lines, "3500000"),
        sumQuoteLaborCost(legacyLines, "3500000"),
        "합계"
      );
      assert.deepEqual(
        selectedRepairTaskNames(CATALOG, quantities),
        legacy.taskNames(CATALOG, set),
        "이름"
      );
    });
  }

  test("되살리기 — 중복이 없는 옛 견적서는 예전 Set 과 같은 작업들이 수량 1 로 살아난다", () => {
    const saved = [{ taskId: "t-oh" }, { taskId: null }, { taskId: "t-rf" }, { taskId: "gone" }];
    const restored = restoreRepairTaskQuantities(saved);
    assert.deepEqual([...restored.keys()].sort(), [...legacy.restore(saved)].sort());
    assert.ok([...restored.values()].every((quantity) => quantity === 1));
  });

  test("O/H 규칙 — 켜고 끈 결과가 예전과 같은 작업들이다", () => {
    for (const isOverhaulQuote of [true, false]) {
      for (const ids of [[], ["t-oh"], ["t-fan"], ["t-oh", "t-rf"]]) {
        const next = applyOverhaulQuantities(CATALOG, new Map(ids.map((id) => [id, 1])), isOverhaulQuote);
        const legacyNext = legacy.applyOverhaul(CATALOG, new Set(ids), isOverhaulQuote);
        assert.ok(next && legacyNext);
        assert.deepEqual([...next.keys()].sort(), [...legacyNext].sort());
        assert.ok([...next.values()].every((quantity) => quantity === 1));
      }
    }
  });
});
