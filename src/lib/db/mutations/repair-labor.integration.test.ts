import "../../../../scripts/load-env";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { db, pgClient } from "../connection";
import {
  auditLogs,
  powerTestTasks,
  repairLaborSettings,
  repairTaskCatalog,
  users,
} from "../schema";
import { saveRepairLabor, STAGED_TASK_NAME_PREFIX } from "./repair-labor";
import { getRepairLaborForKind } from "../queries/repair-labor";
import type {
  PowerTestTaskInput,
  RepairTaskInput,
} from "@/lib/validation/repair-task-input";
import type { WorkflowKind } from "@/lib/domain/workflow-kind";
import type { Role } from "@/lib/domain/types";

/**
 * ============================================================================
 * 수리 작업 비용 저장 — 통합 시험
 * ============================================================================
 * 견적서의 **작업비**가 이 표들에서 나온다. `saveRepairLabor()` 는 장비 종류
 * 하나분을 **통째로 갈아 쓰는** 함수라, 잘못 부르면 금액의 근거가 소리 없이
 * 사라진다. 여기서 못 박는 것은 여섯이다.
 *
 *  1. **🔴 두 목록은 서로를 지우지 않는다.** 수리 작업 목록과 통전 작업 목록을
 *     한 벌로 보내면 서로 멀쩡하다 — 지금 화면이 어느 탭에서 눌러도 한 벌 전부를
 *     보내는 이유가 이것이다(RepairLaborScreen.tsx 의 🔴 주석).
 *  2. **🔴 한쪽을 빈 배열로 보내면 그쪽이 통째로 소프트 삭제되고, 그런데도
 *     `ok: true` 가 돌아온다.** 이것이 이 함수의 **지금 계약**이다. 오류가 아니라
 *     정상 반환이라 부르는 쪽이 목록 한 줄을 빠뜨려도 아무도 알아채지 못하고,
 *     다음 견적서부터 작업비가 0원으로 나간다. 아래 시험이 깨진다면 계약이 바뀐
 *     것이고, **부르는 쪽 전부를 다시 봐야 한다는 신호다.**
 *  3. **소프트 삭제다.** 목록에서 빠진 줄은 `is_deleted=true` 로 남는다 — 하드
 *     삭제하면 이미 뽑아 둔 견적서가 무엇을 청구한 것인지 답할 수 없다.
 *  4. **차례를 1부터 다시 매긴다.** 줄을 빼도 남은 줄에 구멍이 없어야 한다.
 *  5. **🔴 거절은 트랜잭션째 되돌린다.** 없는 id 가 섞이면 그 앞에서 이미 바꾼
 *     단가·작업 줄·소프트 삭제까지 전부 되돌아가야 한다. 이 함수가 거절을
 *     `return` 이 아니라 **예외**로 만들어 둔 이유가 그것이다(SaveRejected).
 *  6. **감사 기록이 통전 건명을 그대로 남긴다.** 견적서 문서에 적히는 글이라
 *     "누가 언제 무슨 문구로 바꿨나"에 답해야 한다.
 *
 * ── 격리 규약 ───────────────────────────────────────────────────────────────
 * 이 세 표는 **장비 종류마다 한 벌**뿐이라, 부품 시험처럼 시험용 열쇠(접두사 붙은
 * 부품)를 새로 만들 수가 없다. 대신 시험 DB 시드가 이 표들을 **하나도 채우지
 * 않는다**(scripts/seed-test-db.ts · scripts/seed-dev-db.ts — 수리 작업 시드는
 * scripts/seed-repair-tasks.ts 로 따로 있고 시험 준비 과정에 들어 있지 않다).
 * 그래서 이 스위트는 자기가 쓰는 종류의 줄을 **시험마다 비우고 시작하고**,
 * after() 가 만졌던 종류를 다시 비워 원래의 빈 상태로 되돌린다.
 * 감사 로그는 append-only 라 지우지 않는다(test-cleanup-static-safety.test.ts).
 * ============================================================================
 */

const HOURLY_RATE = "100000";
/** numeric(15,2) 로 들어가 문자열로 읽힌다 — 위 값이 DB 에서 갖는 모습. */
const HOURLY_RATE_STORED = "100000.00";

let superAdminId: string;
let secondActorId: string;

/** 이 스위트가 건드린 장비 종류. after() 가 이만큼만 되돌린다. */
const touchedKinds = new Set<WorkflowKind>();

async function findUserId(role: Role): Promise<string> {
  const [row] = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.role, role),
        eq(users.approvalStatus, "APPROVED"),
        eq(users.isDeleted, false),
        eq(users.isActive, true)
      )
    )
    .limit(1);
  assert.ok(row, `expected an approved ${role} in the test DB`);
  return row.id;
}

/** 그 장비의 세 표를 통째로 비운다 — 시험마다 같은 자리에서 시작한다. */
async function resetKind(kind: WorkflowKind): Promise<void> {
  touchedKinds.add(kind);
  await db.delete(repairTaskCatalog).where(eq(repairTaskCatalog.equipmentKind, kind));
  await db.delete(powerTestTasks).where(eq(powerTestTasks.equipmentKind, kind));
  await db.delete(repairLaborSettings).where(eq(repairLaborSettings.equipmentKind, kind));
}

/** 화면이 보내는 한 벌. 안 적은 칸은 이 시험들의 기본값으로 채운다. */
function save(params: {
  kind: WorkflowKind;
  hourlyRate?: string;
  baseCost?: string | null;
  powerTestHours?: number | null;
  tasks: RepairTaskInput[];
  powerTestTasks: PowerTestTaskInput[];
  actorUserId: string;
}) {
  return saveRepairLabor({
    fields: {
      equipmentKind: params.kind,
      hourlyRate: params.hourlyRate ?? HOURLY_RATE,
      baseCost: params.baseCost ?? null,
      powerTestHours: params.powerTestHours ?? null,
      tasks: params.tasks,
      powerTestTasks: params.powerTestTasks,
    },
    actorUserId: params.actorUserId,
  });
}

/** 새 줄 한 개분. 화면이 막 더한 줄에는 id 가 없다. */
function newTask(taskName: string, hours: number, isOverhaul = false): RepairTaskInput {
  return { id: null, taskName, hours, isOverhaul };
}

/** 지금 살아 있는 수리 작업 줄 — 화면과 견적서가 보는 것이 이것이다. */
async function liveTasks(kind: WorkflowKind) {
  return db
    .select({
      id: repairTaskCatalog.id,
      taskName: repairTaskCatalog.taskName,
      hours: repairTaskCatalog.hours,
      isOverhaul: repairTaskCatalog.isOverhaul,
      displayOrder: repairTaskCatalog.displayOrder,
      createdBy: repairTaskCatalog.createdBy,
      updatedBy: repairTaskCatalog.updatedBy,
    })
    .from(repairTaskCatalog)
    .where(
      and(eq(repairTaskCatalog.equipmentKind, kind), eq(repairTaskCatalog.isDeleted, false))
    )
    .orderBy(asc(repairTaskCatalog.displayOrder));
}

/** 지운 줄까지 포함한 전부 — "정말 남아 있는가"를 보는 자리다. */
async function allTasks(kind: WorkflowKind) {
  return db
    .select({
      id: repairTaskCatalog.id,
      taskName: repairTaskCatalog.taskName,
      isDeleted: repairTaskCatalog.isDeleted,
      deletedAt: repairTaskCatalog.deletedAt,
      deletedBy: repairTaskCatalog.deletedBy,
    })
    .from(repairTaskCatalog)
    .where(eq(repairTaskCatalog.equipmentKind, kind))
    .orderBy(asc(repairTaskCatalog.taskName));
}

async function livePowerTests(kind: WorkflowKind) {
  return db
    .select({
      id: powerTestTasks.id,
      taskName: powerTestTasks.taskName,
      displayOrder: powerTestTasks.displayOrder,
      updatedBy: powerTestTasks.updatedBy,
    })
    .from(powerTestTasks)
    .where(and(eq(powerTestTasks.equipmentKind, kind), eq(powerTestTasks.isDeleted, false)))
    .orderBy(asc(powerTestTasks.displayOrder));
}

async function allPowerTests(kind: WorkflowKind) {
  return db
    .select({
      id: powerTestTasks.id,
      taskName: powerTestTasks.taskName,
      isDeleted: powerTestTasks.isDeleted,
      deletedBy: powerTestTasks.deletedBy,
    })
    .from(powerTestTasks)
    .where(eq(powerTestTasks.equipmentKind, kind))
    .orderBy(asc(powerTestTasks.taskName));
}

/** 장비 종류마다 한 줄. 없으면 undefined 다. */
async function storedSetting(kind: WorkflowKind) {
  const [row] = await db
    .select({
      id: repairLaborSettings.id,
      hourlyRate: repairLaborSettings.hourlyRate,
      baseCost: repairLaborSettings.baseCost,
      powerTestHours: repairLaborSettings.powerTestHours,
      updatedBy: repairLaborSettings.updatedBy,
      updatedAt: repairLaborSettings.updatedAt,
    })
    .from(repairLaborSettings)
    .where(eq(repairLaborSettings.equipmentKind, kind));
  return row;
}

/** 그 설정 줄에 대해 남은 감사 기록. 오래된 것부터. */
async function settingsAudit(recordId: string) {
  return db
    .select({
      actionType: auditLogs.actionType,
      actorUserId: auditLogs.actorUserId,
      previousValue: auditLogs.previousValue,
      newValue: auditLogs.newValue,
    })
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.targetEntity, "repair_labor_settings"),
        eq(auditLogs.targetRecordId, recordId)
      )
    )
    .orderBy(asc(auditLogs.createdAt));
}

/**
 * 드라이버 오류에서 오류 코드와 색인 이름을 꺼낸다.
 *
 * 🔴 drizzle 이 드라이버 오류를 **자기 오류로 감싸므로** cause 까지 본다.
 * mutations/repair-labor.ts 의 색인 위반 판정이 보는 자리와 같아야 한다 — 여기가
 * 갈라지면 그 판정이 조용히 안 켜지는데도 이 시험은 통과한다.
 */
function pgFields(err: unknown): { code?: unknown; constraintName?: unknown } {
  for (const candidate of [err, err instanceof Error ? err.cause : undefined]) {
    if (typeof candidate !== "object" || candidate === null) continue;
    const fields = candidate as { code?: unknown; constraint_name?: unknown };
    if (fields.code === undefined) continue;
    return { code: fields.code, constraintName: fields.constraint_name };
  }
  return {};
}

before(async () => {
  superAdminId = await findUserId("SUPER_ADMIN");
  // 두 번째 행위자. "누가 고쳤나 / 누가 지웠나"가 실제로 갱신되는지 보려면
  // 서로 다른 사람이 두 번 저장해야 한다.
  secondActorId = await findUserId("INVENTORY_MANAGER");
});

after(async () => {
  for (const kind of touchedKinds) {
    await db.delete(repairTaskCatalog).where(eq(repairTaskCatalog.equipmentKind, kind));
    await db.delete(powerTestTasks).where(eq(powerTestTasks.equipmentKind, kind));
    await db.delete(repairLaborSettings).where(eq(repairLaborSettings.equipmentKind, kind));
  }
  await pgClient.end({ timeout: 5 });
});

describe("단가 설정", () => {
  test("없던 장비 종류도 저장된다 — 시드를 안 돌린 채로 화면에서 먼저 저장할 수 있다", async () => {
    await resetKind("TOTAL_CONTROLLER");
    assert.equal(await storedSetting("TOTAL_CONTROLLER"), undefined, "줄이 없는 데서 시작한다");

    const result = await save({
      kind: "TOTAL_CONTROLLER",
      hourlyRate: HOURLY_RATE,
      baseCost: "2200000",
      powerTestHours: 8,
      tasks: [],
      powerTestTasks: [],
      actorUserId: superAdminId,
    });
    assert.equal(result.ok, true, JSON.stringify(result));

    const setting = await storedSetting("TOTAL_CONTROLLER");
    assert.ok(setting, "onConflictDoUpdate 의 insert 쪽이 줄을 만들어야 한다");
    assert.equal(setting.hourlyRate, HOURLY_RATE_STORED);
    assert.equal(setting.baseCost, "2200000.00");
    assert.equal(setting.powerTestHours, 8);
    assert.equal(setting.updatedBy, superAdminId, "정한 사람이 기록된다");
  });

  test("다시 저장해도 줄이 늘지 않는다 — 종류마다 한 줄이다", async () => {
    await resetKind("MATCHER");
    await save({ kind: "MATCHER", tasks: [], powerTestTasks: [], actorUserId: superAdminId });
    const created = await storedSetting("MATCHER");
    assert.ok(created);

    const result = await save({
      kind: "MATCHER",
      hourlyRate: "120000",
      baseCost: "1500000",
      powerTestHours: 3,
      tasks: [],
      powerTestTasks: [],
      actorUserId: secondActorId,
    });
    assert.equal(result.ok, true, JSON.stringify(result));

    const rows = await db
      .select({ id: repairLaborSettings.id })
      .from(repairLaborSettings)
      .where(eq(repairLaborSettings.equipmentKind, "MATCHER"));
    assert.equal(rows.length, 1, "줄이 늘어나면 안 된다");

    const updated = await storedSetting("MATCHER");
    assert.ok(updated);
    assert.equal(updated.id, created.id, "같은 줄이 갱신돼야 한다");
    assert.equal(updated.hourlyRate, "120000.00");
    assert.equal(updated.baseCost, "1500000.00");
    assert.equal(updated.powerTestHours, 3);
    assert.equal(updated.updatedBy, secondActorId, "마지막에 고친 사람이 남는다");
  });

  test("기본 작업비와 통전 공수시간은 비울 수 있다 — null 은 '정하지 않음'이고 0 이 아니다", async () => {
    await resetKind("MATCHER");
    await save({
      kind: "MATCHER",
      baseCost: "3500000",
      powerTestHours: 14,
      tasks: [],
      powerTestTasks: [],
      actorUserId: superAdminId,
    });

    const result = await save({
      kind: "MATCHER",
      baseCost: null,
      powerTestHours: null,
      tasks: [],
      powerTestTasks: [],
      actorUserId: superAdminId,
    });
    assert.equal(result.ok, true, JSON.stringify(result));

    const setting = await storedSetting("MATCHER");
    assert.ok(setting);
    assert.equal(setting.baseCost, null, "0 으로 접히면 안 된다");
    assert.equal(setting.powerTestHours, null, "T/C 처럼 '아직 모른다'가 담겨야 한다");
  });
});

describe("수리 작업 목록 갈아 쓰기", () => {
  test("id 없이 온 줄은 새로 만들어지고, 차례가 화면 순서대로 1부터 매겨진다", async () => {
    await resetKind("MATCHER");

    const result = await save({
      kind: "MATCHER",
      tasks: [newTask("바리콘 교환 작업", 8), newTask("O/H 작업", 16, true)],
      powerTestTasks: [],
      actorUserId: superAdminId,
    });
    assert.equal(result.ok, true, JSON.stringify(result));

    const rows = await liveTasks("MATCHER");
    assert.deepEqual(
      rows.map((row) => [row.taskName, row.hours, row.isOverhaul, row.displayOrder]),
      [
        ["바리콘 교환 작업", 8, false, 1],
        ["O/H 작업", 16, true, 2],
      ]
    );
    assert.equal(rows[0].createdBy, superAdminId, "만든 사람이 기록된다");
    assert.equal(rows[0].updatedBy, superAdminId);
  });

  test("id 로 온 줄은 같은 줄이 갱신된다 — 건명·공수시간·오버홀 표시가 바뀐다", async () => {
    await resetKind("MATCHER");
    await save({
      kind: "MATCHER",
      tasks: [newTask("바리콘 교환 작업", 8), newTask("기판 교환 작업", 6)],
      powerTestTasks: [],
      actorUserId: superAdminId,
    });
    const before = await liveTasks("MATCHER");

    const result = await save({
      kind: "MATCHER",
      tasks: [
        { id: before[0].id, taskName: "바리콘 교환 작업(개정)", hours: 9, isOverhaul: true },
        { id: before[1].id, taskName: "기판 교환 작업", hours: 6, isOverhaul: false },
      ],
      powerTestTasks: [],
      actorUserId: secondActorId,
    });
    assert.equal(result.ok, true, JSON.stringify(result));

    const rows = await liveTasks("MATCHER");
    assert.equal(rows.length, 2, "줄이 늘어나면 안 된다 — 같은 줄을 고친 것이다");
    assert.deepEqual(
      rows.map((row) => [row.id, row.taskName, row.hours, row.isOverhaul]),
      [
        [before[0].id, "바리콘 교환 작업(개정)", 9, true],
        [before[1].id, "기판 교환 작업", 6, false],
      ]
    );
    assert.equal(rows[0].updatedBy, secondActorId, "고친 사람이 갱신된다");
    assert.equal(rows[0].createdBy, superAdminId, "만든 사람은 그대로다");
  });

  test("🔴 목록에서 빠진 줄은 지워지지 않고 소프트 삭제로 남는다 — 이미 뽑아 둔 견적서의 근거다", async () => {
    await resetKind("MATCHER");
    await save({
      kind: "MATCHER",
      tasks: [newTask("작업 A", 2), newTask("작업 B", 3), newTask("작업 C", 4)],
      powerTestTasks: [],
      actorUserId: superAdminId,
    });
    const before = await liveTasks("MATCHER");
    const gone = before[1];

    const result = await save({
      kind: "MATCHER",
      tasks: [
        { id: before[0].id, taskName: "작업 A", hours: 2, isOverhaul: false },
        { id: before[2].id, taskName: "작업 C", hours: 4, isOverhaul: false },
      ],
      powerTestTasks: [],
      actorUserId: secondActorId,
    });
    assert.equal(result.ok, true, JSON.stringify(result));

    assert.deepEqual(
      (await liveTasks("MATCHER")).map((row) => row.taskName),
      ["작업 A", "작업 C"],
      "화면에서는 사라져야 한다"
    );

    const all = await allTasks("MATCHER");
    assert.equal(all.length, 3, "줄 자체는 세 개 다 남아 있어야 한다 — 하드 삭제가 아니다");
    const deleted = all.find((row) => row.id === gone.id);
    assert.ok(deleted, "빠진 줄이 표에서 사라지면 안 된다");
    assert.equal(deleted.isDeleted, true);
    assert.ok(deleted.deletedAt, "언제 지웠는지가 남아야 한다");
    assert.equal(deleted.deletedBy, secondActorId, "누가 지웠는지가 남아야 한다");
  });

  test("남은 줄의 차례를 1부터 다시 매긴다 — 구멍도 없고, 화면이 늘어놓은 순서 그대로다", async () => {
    await resetKind("MATCHER");
    await save({
      kind: "MATCHER",
      tasks: [newTask("작업 A", 2), newTask("작업 B", 3), newTask("작업 C", 4)],
      powerTestTasks: [],
      actorUserId: superAdminId,
    });
    const before = await liveTasks("MATCHER");

    // 가운데를 빼고, 남은 둘의 순서를 뒤집어 보낸다.
    const result = await save({
      kind: "MATCHER",
      tasks: [
        { id: before[2].id, taskName: "작업 C", hours: 4, isOverhaul: false },
        { id: before[0].id, taskName: "작업 A", hours: 2, isOverhaul: false },
      ],
      powerTestTasks: [],
      actorUserId: superAdminId,
    });
    assert.equal(result.ok, true, JSON.stringify(result));

    assert.deepEqual(
      (await liveTasks("MATCHER")).map((row) => [row.taskName, row.displayOrder]),
      [
        ["작업 C", 1],
        ["작업 A", 2],
      ],
      "3번이 그대로 남아 구멍이 생기면 안 된다"
    );
  });

  test("지운 건명은 다시 쓸 수 있다 — 부분 unique 색인이 지운 줄을 세지 않는다", async () => {
    await resetKind("MATCHER");
    await save({
      kind: "MATCHER",
      tasks: [newTask("작업 A", 2), newTask("작업 B", 3)],
      powerTestTasks: [],
      actorUserId: superAdminId,
    });
    const before = await liveTasks("MATCHER");

    // 「작업 A」를 뺀다 — 소프트 삭제로 남는다.
    await save({
      kind: "MATCHER",
      tasks: [{ id: before[1].id, taskName: "작업 B", hours: 3, isOverhaul: false }],
      powerTestTasks: [],
      actorUserId: superAdminId,
    });

    // 같은 이름으로 새 줄을 다시 만든다.
    const result = await save({
      kind: "MATCHER",
      tasks: [
        { id: before[1].id, taskName: "작업 B", hours: 3, isOverhaul: false },
        newTask("작업 A", 5),
      ],
      powerTestTasks: [],
      actorUserId: superAdminId,
    });
    assert.equal(result.ok, true, JSON.stringify(result));

    const live = await liveTasks("MATCHER");
    assert.deepEqual(
      live.map((row) => [row.taskName, row.hours]),
      [
        ["작업 B", 3],
        ["작업 A", 5],
      ]
    );
    const revived = live.find((row) => row.taskName === "작업 A");
    assert.ok(revived);
    assert.notEqual(revived.id, before[0].id, "지운 줄이 되살아난 것이 아니라 새 줄이다");
    assert.equal((await allTasks("MATCHER")).length, 3, "지운 줄은 그대로 남아 있다");
  });
});

describe("통전 작업 목록", () => {
  test("통전 목록도 같은 방식이다 — 새 줄이 만들어지고 차례가 1부터 매겨진다", async () => {
    await resetKind("GENERATOR");

    const result = await save({
      kind: "GENERATOR",
      powerTestHours: 14,
      tasks: [],
      powerTestTasks: [
        { id: null, taskName: "전원 인가 확인" },
        { id: null, taskName: "출력 파형 확인" },
      ],
      actorUserId: superAdminId,
    });
    assert.equal(result.ok, true, JSON.stringify(result));

    assert.deepEqual(
      (await livePowerTests("GENERATOR")).map((row) => [row.taskName, row.displayOrder]),
      [
        ["전원 인가 확인", 1],
        ["출력 파형 확인", 2],
      ]
    );
  });

  test("🔴 통전 목록에서 빠진 줄도 소프트 삭제로 남고, 남은 줄의 차례가 다시 매겨진다", async () => {
    await resetKind("GENERATOR");
    await save({
      kind: "GENERATOR",
      tasks: [],
      powerTestTasks: [
        { id: null, taskName: "통전 A" },
        { id: null, taskName: "통전 B" },
        { id: null, taskName: "통전 C" },
      ],
      actorUserId: superAdminId,
    });
    const before = await livePowerTests("GENERATOR");

    const result = await save({
      kind: "GENERATOR",
      tasks: [],
      powerTestTasks: [
        { id: before[2].id, taskName: "통전 C" },
        { id: before[0].id, taskName: "통전 A" },
      ],
      actorUserId: secondActorId,
    });
    assert.equal(result.ok, true, JSON.stringify(result));

    assert.deepEqual(
      (await livePowerTests("GENERATOR")).map((row) => [row.taskName, row.displayOrder]),
      [
        ["통전 C", 1],
        ["통전 A", 2],
      ]
    );

    const all = await allPowerTests("GENERATOR");
    assert.equal(all.length, 3, "줄 자체는 남아 있어야 한다");
    const deleted = all.find((row) => row.id === before[1].id);
    assert.ok(deleted);
    assert.equal(deleted.isDeleted, true);
    assert.equal(deleted.deletedBy, secondActorId);
  });

  test("통전 목록이 처음부터 비어 있는 것은 정상이다 — T/C 는 아직 하나도 없다", async () => {
    await resetKind("TOTAL_CONTROLLER");

    const result = await save({
      kind: "TOTAL_CONTROLLER",
      tasks: [newTask("T/C 작업", 4)],
      powerTestTasks: [],
      actorUserId: superAdminId,
    });
    assert.equal(result.ok, true, JSON.stringify(result));

    assert.deepEqual(await allPowerTests("TOTAL_CONTROLLER"), [], "빈 목록은 오류가 아니다");
    assert.equal((await liveTasks("TOTAL_CONTROLLER")).length, 1, "수리 목록은 저장돼야 한다");
  });
});

describe("🔴 두 목록이 서로를 지우는가 — 이 함수의 가장 위험한 자리", () => {
  test("두 목록을 다 보내면 서로를 지우지 않는다 — 지금 화면이 하는 일이 안전하다", async () => {
    await resetKind("GENERATOR");
    await save({
      kind: "GENERATOR",
      tasks: [newTask("작업 A", 2), newTask("작업 B", 3)],
      powerTestTasks: [
        { id: null, taskName: "통전 A" },
        { id: null, taskName: "통전 B" },
      ],
      actorUserId: superAdminId,
    });
    const tasksBefore = await liveTasks("GENERATOR");
    const powerBefore = await livePowerTests("GENERATOR");

    // RepairLaborScreen.save() 가 보내는 모양 — 어느 탭에서 눌렀든 한 벌 전부다.
    const result = await save({
      kind: "GENERATOR",
      hourlyRate: "110000",
      tasks: tasksBefore.map((row) => ({
        id: row.id,
        taskName: row.taskName,
        hours: row.hours,
        isOverhaul: row.isOverhaul,
      })),
      powerTestTasks: powerBefore.map((row) => ({ id: row.id, taskName: row.taskName })),
      actorUserId: superAdminId,
    });
    assert.equal(result.ok, true, JSON.stringify(result));

    assert.equal((await liveTasks("GENERATOR")).length, 2, "수리 목록이 살아 있어야 한다");
    assert.equal((await livePowerTests("GENERATOR")).length, 2, "통전 목록이 살아 있어야 한다");
    assert.ok(
      (await allTasks("GENERATOR")).every((row) => row.isDeleted === false),
      "한 줄도 지워지면 안 된다"
    );
    assert.ok((await allPowerTests("GENERATOR")).every((row) => row.isDeleted === false));
  });

  test("🔴 위험한 계약 — 수리 작업 목록을 빈 배열로 보내면 그 장비의 작업 목록이 통째로 소프트 삭제되고, 그런데도 ok:true 가 돌아온다", async () => {
    await resetKind("GENERATOR");
    await save({
      kind: "GENERATOR",
      tasks: [newTask("작업 A", 2), newTask("작업 B", 3), newTask("작업 C", 4)],
      powerTestTasks: [
        { id: null, taskName: "통전 A" },
        { id: null, taskName: "통전 B" },
      ],
      actorUserId: superAdminId,
    });
    const powerBefore = await livePowerTests("GENERATOR");

    // 🔴 통전 탭이 자기 목록만 보내는 payload 가 되면 이 모양이 된다.
    const result = await save({
      kind: "GENERATOR",
      tasks: [],
      powerTestTasks: powerBefore.map((row) => ({ id: row.id, taskName: row.taskName })),
      actorUserId: secondActorId,
    });

    // 🔴 오류가 아니다. 사람은 저장이 잘 된 줄 안다 — 이것이 지금의 계약이다.
    assert.equal(result.ok, true, "빈 목록은 거절되지 않는다(지금 계약)");
    if (result.ok) assert.equal(result.changedCount, 0);

    assert.deepEqual(await liveTasks("GENERATOR"), [], "🔴 수리 작업 목록이 통째로 사라진다");
    const all = await allTasks("GENERATOR");
    assert.equal(all.length, 3, "소프트 삭제라 줄 자체는 남는다");
    assert.ok(
      all.every((row) => row.isDeleted === true && row.deletedBy === secondActorId),
      "세 줄 모두 지워진 것으로 표시된다"
    );

    assert.equal(
      (await livePowerTests("GENERATOR")).length,
      2,
      "함께 보낸 통전 목록은 멀쩡하다 — 지워지는 것은 안 보낸 쪽뿐이다"
    );
  });

  test("🔴 위험한 계약 — 통전 작업 목록을 빈 배열로 보내면 통전 목록이 통째로 소프트 삭제되고, 그런데도 ok:true 가 돌아온다", async () => {
    await resetKind("GENERATOR");
    await save({
      kind: "GENERATOR",
      tasks: [newTask("작업 A", 2), newTask("작업 B", 3)],
      powerTestTasks: [
        { id: null, taskName: "통전 A" },
        { id: null, taskName: "통전 B" },
      ],
      actorUserId: superAdminId,
    });
    const tasksBefore = await liveTasks("GENERATOR");

    const result = await save({
      kind: "GENERATOR",
      tasks: tasksBefore.map((row) => ({
        id: row.id,
        taskName: row.taskName,
        hours: row.hours,
        isOverhaul: row.isOverhaul,
      })),
      powerTestTasks: [],
      actorUserId: secondActorId,
    });

    assert.equal(result.ok, true, "빈 목록은 거절되지 않는다(지금 계약)");
    if (result.ok) assert.equal(result.changedCount, 2, "changedCount 는 수리 작업 건수다");

    assert.deepEqual(await livePowerTests("GENERATOR"), [], "🔴 통전 목록이 통째로 사라진다");
    const all = await allPowerTests("GENERATOR");
    assert.equal(all.length, 2);
    assert.ok(all.every((row) => row.isDeleted === true && row.deletedBy === secondActorId));

    assert.equal((await liveTasks("GENERATOR")).length, 2, "함께 보낸 수리 목록은 멀쩡하다");
  });

  test("🔴 위험한 계약 — 두 목록을 다 비워 보내면 그 장비의 작업비 근거가 통째로 없어지고, 견적서 화면이 빈 목록을 본다", async () => {
    await resetKind("GENERATOR");
    await save({
      kind: "GENERATOR",
      hourlyRate: HOURLY_RATE,
      tasks: [newTask("작업 A", 2), newTask("작업 B", 3)],
      powerTestTasks: [{ id: null, taskName: "통전 A" }],
      actorUserId: superAdminId,
    });

    const result = await save({
      kind: "GENERATOR",
      tasks: [],
      powerTestTasks: [],
      actorUserId: superAdminId,
    });
    assert.equal(result.ok, true, "오류가 나지 않는다 — 아무도 알아채지 못하는 이유다");

    // 견적서와 「작업 비용」 화면이 읽는 길로도 확인한다 — 사람이 실제로 보게 되는 것.
    const forQuote = await getRepairLaborForKind("GENERATOR");
    assert.deepEqual(forQuote.tasks, [], "🔴 고를 수리 작업이 하나도 남지 않는다");
    assert.deepEqual(forQuote.powerTestTasks, []);
    assert.equal(forQuote.hourlyRate, HOURLY_RATE_STORED, "단가 설정만 남는다");
  });
});

describe("🔴 거절은 트랜잭션째 되돌린다", () => {
  test("🔴 없는 작업 id 를 보내면 NOT_FOUND 이고, 함께 보낸 단가와 앞줄 수정까지 되돌아간다", async () => {
    await resetKind("MATCHER");
    await save({
      kind: "MATCHER",
      hourlyRate: HOURLY_RATE,
      baseCost: "3500000",
      powerTestHours: 14,
      tasks: [newTask("작업 A", 2), newTask("작업 B", 3)],
      powerTestTasks: [{ id: null, taskName: "통전 A" }],
      actorUserId: superAdminId,
    });
    const before = await liveTasks("MATCHER");

    const result = await save({
      kind: "MATCHER",
      hourlyRate: "999999",
      baseCost: "1",
      powerTestHours: 1,
      tasks: [
        // 앞줄은 멀쩡하다 — 여기까지는 실제로 쓰인 뒤에 다음 줄에서 거절된다.
        { id: before[0].id, taskName: "작업 A(바뀜)", hours: 9, isOverhaul: true },
        { id: randomUUID(), taskName: "없는 줄", hours: 5, isOverhaul: false },
      ],
      powerTestTasks: [{ id: null, taskName: "통전 B" }],
      actorUserId: secondActorId,
    });

    assert.equal(result.ok, false, JSON.stringify(result));
    if (result.ok) return;
    assert.equal(result.code, "NOT_FOUND");

    const setting = await storedSetting("MATCHER");
    assert.ok(setting);
    assert.equal(setting.hourlyRate, HOURLY_RATE_STORED, "🔴 단가가 바뀌면 안 된다");
    assert.equal(setting.baseCost, "3500000.00", "🔴 기본 작업비도 그대로여야 한다");
    assert.equal(setting.powerTestHours, 14);
    assert.equal(setting.updatedBy, superAdminId, "고친 사람도 그대로다");

    assert.deepEqual(
      (await liveTasks("MATCHER")).map((row) => [row.taskName, row.hours, row.isOverhaul]),
      [
        ["작업 A", 2, false],
        ["작업 B", 3, false],
      ],
      "🔴 거절 앞에서 이미 고친 줄도 되돌아가야 한다"
    );
    assert.deepEqual(
      (await livePowerTests("MATCHER")).map((row) => row.taskName),
      ["통전 A"],
      "통전 목록도 손대지 않은 것이 된다"
    );
  });

  test("🔴 없는 통전 작업 id 를 보내면, 앞서 끝난 수리 목록의 소프트 삭제까지 되돌아간다", async () => {
    await resetKind("MATCHER");
    await save({
      kind: "MATCHER",
      hourlyRate: HOURLY_RATE,
      tasks: [newTask("작업 A", 2), newTask("작업 B", 3)],
      powerTestTasks: [{ id: null, taskName: "통전 A" }],
      actorUserId: superAdminId,
    });
    const before = await liveTasks("MATCHER");

    const result = await save({
      kind: "MATCHER",
      hourlyRate: "999999",
      // 「작업 B」를 뺀다 — 통전에서 거절되기 전에 소프트 삭제가 이미 일어난다.
      tasks: [{ id: before[0].id, taskName: "작업 A", hours: 2, isOverhaul: false }],
      powerTestTasks: [{ id: randomUUID(), taskName: "없는 통전 줄" }],
      actorUserId: secondActorId,
    });

    assert.equal(result.ok, false, JSON.stringify(result));
    if (result.ok) return;
    assert.equal(result.code, "NOT_FOUND");

    const setting = await storedSetting("MATCHER");
    assert.ok(setting);
    assert.equal(setting.hourlyRate, HOURLY_RATE_STORED, "단가가 바뀌면 안 된다");
    assert.deepEqual(
      (await liveTasks("MATCHER")).map((row) => row.taskName),
      ["작업 A", "작업 B"],
      "🔴 소프트 삭제까지 되돌아가야 한다 — 반쪽 저장이 남으면 안 된다"
    );
    assert.ok(
      (await allTasks("MATCHER")).every((row) => row.isDeleted === false),
      "지워진 것으로 표시된 줄이 있으면 안 된다"
    );
  });

  test("다른 장비 종류의 작업 id 는 NOT_FOUND — 종류가 섞이지 않는다", async () => {
    await resetKind("GENERATOR");
    await resetKind("MATCHER");
    await save({
      kind: "GENERATOR",
      tasks: [newTask("제너레이터 작업", 6)],
      powerTestTasks: [],
      actorUserId: superAdminId,
    });
    const [generatorTask] = await liveTasks("GENERATOR");

    const result = await save({
      kind: "MATCHER",
      tasks: [{ id: generatorTask.id, taskName: "훔쳐 온 줄", hours: 6, isOverhaul: false }],
      powerTestTasks: [],
      actorUserId: superAdminId,
    });
    assert.equal(result.ok, false, JSON.stringify(result));
    if (result.ok) return;
    assert.equal(result.code, "NOT_FOUND");

    assert.deepEqual(
      (await liveTasks("GENERATOR")).map((row) => row.taskName),
      ["제너레이터 작업"],
      "남의 종류 줄이 끌려가면 안 된다"
    );
    assert.equal(
      await storedSetting("MATCHER"),
      undefined,
      "거절됐으므로 매쳐 설정 줄도 만들어지지 않는다 — 트랜잭션이 통째로 되돌아간다"
    );
  });

  test("이미 소프트 삭제된 줄의 id 는 NOT_FOUND — 지운 줄이 되살아나지 않는다", async () => {
    await resetKind("MATCHER");
    await save({
      kind: "MATCHER",
      tasks: [newTask("작업 A", 2), newTask("작업 B", 3)],
      powerTestTasks: [],
      actorUserId: superAdminId,
    });
    const before = await liveTasks("MATCHER");

    await save({
      kind: "MATCHER",
      tasks: [{ id: before[0].id, taskName: "작업 A", hours: 2, isOverhaul: false }],
      powerTestTasks: [],
      actorUserId: superAdminId,
    });

    const result = await save({
      kind: "MATCHER",
      tasks: [
        { id: before[0].id, taskName: "작업 A", hours: 2, isOverhaul: false },
        { id: before[1].id, taskName: "작업 B", hours: 3, isOverhaul: false },
      ],
      powerTestTasks: [],
      actorUserId: superAdminId,
    });
    assert.equal(result.ok, false, JSON.stringify(result));
    if (result.ok) return;
    assert.equal(result.code, "NOT_FOUND");

    const revived = (await allTasks("MATCHER")).find((row) => row.id === before[1].id);
    assert.ok(revived);
    assert.equal(revived.isDeleted, true, "지운 줄은 지운 채로 남는다");
  });
});

describe("감사 기록", () => {
  test("저장마다 UPDATE / repair_labor_settings 한 줄이 남고, 바꾸기 전과 뒤가 함께 들어간다", async () => {
    await resetKind("MATCHER");
    await save({
      kind: "MATCHER",
      hourlyRate: HOURLY_RATE,
      tasks: [newTask("작업 A", 2)],
      powerTestTasks: [{ id: null, taskName: "통전 A" }],
      actorUserId: superAdminId,
    });
    const setting = await storedSetting("MATCHER");
    assert.ok(setting);
    const first = await settingsAudit(setting.id);
    assert.equal(first.length, 1, "저장 한 번에 한 줄이다");
    // 없던 종류를 처음 만든 저장도 UPDATE 로 남는다 — 이 표는 종류마다 한 줄이라
    // 만드는 것과 고치는 것이 같은 동작이다(onConflictDoUpdate).
    assert.equal(first[0].actionType, "UPDATE");
    assert.equal(first[0].actorUserId, superAdminId);
    assert.deepEqual(first[0].previousValue, {
      equipmentKind: "MATCHER",
      hourlyRate: null,
      baseCost: null,
      powerTestHours: null,
      taskCount: 0,
      totalHours: 0,
      powerTestTaskCount: 0,
      powerTestTaskNames: [],
    });

    const before = await liveTasks("MATCHER");
    const result = await save({
      kind: "MATCHER",
      hourlyRate: "120000",
      tasks: [{ id: before[0].id, taskName: "작업 A", hours: 8, isOverhaul: false }],
      powerTestTasks: [{ id: null, taskName: "통전 B" }],
      actorUserId: secondActorId,
    });
    assert.equal(result.ok, true, JSON.stringify(result));

    const trail = await settingsAudit(setting.id);
    assert.equal(trail.length, 2, "고친 기록이 차례로 쌓인다");
    assert.equal(trail[1].actorUserId, secondActorId);
    assert.deepEqual(
      trail[1].previousValue,
      {
        equipmentKind: "MATCHER",
        // 바꾸기 전 값은 DB 에서 읽으므로 numeric 의 모습 그대로다.
        hourlyRate: HOURLY_RATE_STORED,
        baseCost: null,
        powerTestHours: null,
        taskCount: 1,
        totalHours: 2,
        powerTestTaskCount: 1,
        powerTestTaskNames: ["통전 A"],
      },
      "바꾸기 전 상태가 그대로 남아야 한다"
    );
    assert.deepEqual(
      trail[1].newValue,
      {
        equipmentKind: "MATCHER",
        // 바꾼 뒤 값은 **화면이 보낸 글자 그대로**다 — 위와 모양이 다르다.
        hourlyRate: "120000",
        baseCost: null,
        powerTestHours: null,
        taskCount: 1,
        totalHours: 8,
        powerTestTaskCount: 1,
        powerTestTaskNames: ["통전 B"],
      },
      "바꾼 뒤 상태도 함께 남아야 한다"
    );
  });

  test("🔴 통전 목록은 건명을 그대로 남긴다 — 견적서 문서에 적힐 글이라 문구가 답이 되어야 한다", async () => {
    await resetKind("GENERATOR");
    await save({
      kind: "GENERATOR",
      tasks: [newTask("작업 A", 2), newTask("작업 B", 3)],
      powerTestTasks: [
        { id: null, taskName: "전원 인가 확인" },
        { id: null, taskName: "출력 파형 확인" },
      ],
      actorUserId: superAdminId,
    });
    const setting = await storedSetting("GENERATOR");
    assert.ok(setting);

    const [entry] = await settingsAudit(setting.id);
    const newValue = entry.newValue as Record<string, unknown>;
    assert.deepEqual(
      newValue.powerTestTaskNames,
      ["전원 인가 확인", "출력 파형 확인"],
      "건명이 차례까지 그대로 남아야 한다"
    );
    // 수리 작업 목록은 반대로 **건명을 남기지 않는다.** 줄마다 공수시간이 있어
    // 건수와 시간 합계로 크기를 가늠할 수 있기 때문이다(mutations 의 그 주석).
    assert.equal(newValue.taskCount, 2);
    assert.equal(newValue.totalHours, 5);
    assert.equal("taskNames" in newValue, false, "수리 건명은 감사에 남지 않는다");
  });

  test("저장이 거절되면 감사 기록도 남지 않는다", async () => {
    await resetKind("MATCHER");
    await save({
      kind: "MATCHER",
      tasks: [newTask("작업 A", 2)],
      powerTestTasks: [],
      actorUserId: superAdminId,
    });
    const setting = await storedSetting("MATCHER");
    assert.ok(setting);
    const before = await settingsAudit(setting.id);

    const result = await save({
      kind: "MATCHER",
      tasks: [{ id: randomUUID(), taskName: "없는 줄", hours: 5, isOverhaul: false }],
      powerTestTasks: [],
      actorUserId: secondActorId,
    });
    assert.equal(result.ok, false);

    assert.equal(
      (await settingsAudit(setting.id)).length,
      before.length,
      "되돌아간 저장이 감사에 남으면 '바뀌었다'는 거짓 기록이 된다"
    );
  });
});

describe("changedCount 와 종류 격리", () => {
  test("🔴 changedCount 는 수리 작업 건수다 — 통전 건수를 더하지 않는다", async () => {
    await resetKind("GENERATOR");

    const result = await save({
      kind: "GENERATOR",
      tasks: [newTask("작업 A", 2), newTask("작업 B", 3)],
      powerTestTasks: [
        { id: null, taskName: "통전 A" },
        { id: null, taskName: "통전 B" },
        { id: null, taskName: "통전 C" },
      ],
      actorUserId: superAdminId,
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    // 화면이 이 숫자를 "작업 N건을 저장했습니다"에 그대로 쓴다. 5 가 되면 사람이
    // 보고 있는 표의 줄 수와 어긋난다.
    if (result.ok) assert.equal(result.changedCount, 2);
  });

  test("한 종류를 통째로 비워도 다른 종류는 한 줄도 안 바뀐다 — 지우기가 장비 종류 안에서만 돈다", async () => {
    await resetKind("GENERATOR");
    await resetKind("MATCHER");
    await save({
      kind: "GENERATOR",
      hourlyRate: HOURLY_RATE,
      tasks: [newTask("제너레이터 작업 A", 6), newTask("제너레이터 작업 B", 4)],
      powerTestTasks: [{ id: null, taskName: "제너레이터 통전" }],
      actorUserId: superAdminId,
    });
    await save({
      kind: "MATCHER",
      tasks: [newTask("매쳐 작업", 8)],
      powerTestTasks: [{ id: null, taskName: "매쳐 통전" }],
      actorUserId: superAdminId,
    });

    // 매쳐만 통째로 비운다.
    const result = await save({
      kind: "MATCHER",
      tasks: [],
      powerTestTasks: [],
      actorUserId: superAdminId,
    });
    assert.equal(result.ok, true, JSON.stringify(result));

    assert.deepEqual(await liveTasks("MATCHER"), []);
    assert.deepEqual(
      (await liveTasks("GENERATOR")).map((row) => row.taskName),
      ["제너레이터 작업 A", "제너레이터 작업 B"],
      "다른 종류의 목록이 휩쓸리면 안 된다"
    );
    assert.deepEqual(
      (await livePowerTests("GENERATOR")).map((row) => row.taskName),
      ["제너레이터 통전"]
    );
    const generatorSetting = await storedSetting("GENERATOR");
    assert.ok(generatorSetting);
    assert.equal(generatorSetting.hourlyRate, HOURLY_RATE_STORED);
  });
});

/**
 * ============================================================================
 * 이름을 맞바꾸거나 되쓰는 저장 — 부분 unique 색인과 부딪히던 자리
 * ============================================================================
 * 두 목록 표에는 `(equipment_kind, task_name) WHERE is_deleted = false` 부분
 * unique 색인이 걸려 있다. 사람이 화면에서 당연히 하는 두 가지 조작이 그 색인과
 * **찰나에** 부딪힌다.
 *
 *  - 작업 두 개의 **이름을 맞바꾼다.** 순환이라 어느 쪽을 먼저 써도 상대가 아직
 *    그 이름을 쥐고 있다.
 *  - 줄을 빼면서 **그 이름을 같은 저장에서 새 줄에** 쓴다. 새 줄이 들어갈 때 옛
 *    줄이 아직 살아 있다.
 *
 * 둘 다 자료를 깨뜨리지는 않았다(트랜잭션이 통째로 되돌아간다). 대신 정당한
 * 조작이 막혔고, 화면에는 "잠시 후 다시 시도해 주세요"가 떴다 — 구조적인 문제라
 * 다시 눌러도 영원히 안 되는데도.
 *
 * 아래 시험들이 못 박는 것은 **한 번의 저장으로 된다**는 것이다. 위 「지운 건명은
 * 다시 쓸 수 있다」 시험이 일부러 저장 두 번으로 짜여 있는데, 그것도 여전히
 * 되어야 하므로 그대로 두고 여기에 한 번짜리를 따로 더한다.
 * ============================================================================
 */
describe("🔴 이름 맞바꾸기와 이름 되쓰기 — 한 번의 저장으로 된다", () => {
  test("🔴 두 작업의 이름을 한 번에 맞바꾼다 — 같은 두 줄의 이름만 서로 바뀐다", async () => {
    await resetKind("MATCHER");
    await save({
      kind: "MATCHER",
      tasks: [newTask("작업 A", 2), newTask("작업 B", 3)],
      powerTestTasks: [],
      actorUserId: superAdminId,
    });
    const before = await liveTasks("MATCHER");

    // 공수시간은 줄에 그대로 두고 **이름만** 서로 바꾼다.
    const result = await save({
      kind: "MATCHER",
      tasks: [
        { id: before[0].id, taskName: "작업 B", hours: 2, isOverhaul: false },
        { id: before[1].id, taskName: "작업 A", hours: 3, isOverhaul: false },
      ],
      powerTestTasks: [],
      actorUserId: secondActorId,
    });
    assert.equal(result.ok, true, JSON.stringify(result));

    assert.deepEqual(
      (await liveTasks("MATCHER")).map((row) => [row.id, row.taskName, row.hours]),
      [
        [before[0].id, "작업 B", 2],
        [before[1].id, "작업 A", 3],
      ],
      "🔴 id 가 유지된 채로 이름만 바뀌어야 한다 — 지우고 새로 만든 것이 아니다"
    );
    const all = await allTasks("MATCHER");
    assert.equal(all.length, 2, "줄이 늘어나면 안 된다");
    assert.ok(
      all.every((row) => row.isDeleted === false),
      "맞바꾸기는 아무것도 지우지 않는다"
    );
  });

  test("🔴 줄을 빼면서 그 이름으로 새 줄을 만든다 — 저장을 두 번으로 나누지 않아도 된다", async () => {
    await resetKind("MATCHER");
    await save({
      kind: "MATCHER",
      tasks: [newTask("작업 A", 2), newTask("작업 B", 3)],
      powerTestTasks: [],
      actorUserId: superAdminId,
    });
    const before = await liveTasks("MATCHER");

    // 「작업 A」를 빼고, **같은 저장에서** 그 이름의 새 줄을 만든다.
    const result = await save({
      kind: "MATCHER",
      tasks: [
        { id: before[1].id, taskName: "작업 B", hours: 3, isOverhaul: false },
        newTask("작업 A", 7),
      ],
      powerTestTasks: [],
      actorUserId: secondActorId,
    });
    assert.equal(result.ok, true, JSON.stringify(result));

    const live = await liveTasks("MATCHER");
    assert.deepEqual(
      live.map((row) => [row.taskName, row.hours, row.displayOrder]),
      [
        ["작업 B", 3, 1],
        ["작업 A", 7, 2],
      ]
    );
    const created = live.find((row) => row.taskName === "작업 A");
    assert.ok(created);
    assert.notEqual(created.id, before[0].id, "옛 줄이 되살아난 것이 아니라 새 id 의 새 줄이다");

    const all = await allTasks("MATCHER");
    assert.equal(all.length, 3, "옛 줄은 소프트 삭제로 남는다");
    const removed = all.find((row) => row.id === before[0].id);
    assert.ok(removed, "빠진 줄이 표에서 사라지면 안 된다");
    assert.equal(removed.isDeleted, true);
    assert.equal(removed.deletedBy, secondActorId, "누가 지웠는지가 남는다");
  });

  test("통전 목록도 이름을 한 번에 맞바꿀 수 있다 — 두 표에 같이 적용됐다", async () => {
    await resetKind("GENERATOR");
    await save({
      kind: "GENERATOR",
      tasks: [],
      powerTestTasks: [
        { id: null, taskName: "통전 A" },
        { id: null, taskName: "통전 B" },
      ],
      actorUserId: superAdminId,
    });
    const before = await livePowerTests("GENERATOR");

    const result = await save({
      kind: "GENERATOR",
      tasks: [],
      powerTestTasks: [
        { id: before[0].id, taskName: "통전 B" },
        { id: before[1].id, taskName: "통전 A" },
      ],
      actorUserId: secondActorId,
    });
    assert.equal(result.ok, true, JSON.stringify(result));

    assert.deepEqual(
      (await livePowerTests("GENERATOR")).map((row) => [row.id, row.taskName]),
      [
        [before[0].id, "통전 B"],
        [before[1].id, "통전 A"],
      ]
    );
    const all = await allPowerTests("GENERATOR");
    assert.equal(all.length, 2);
    assert.ok(all.every((row) => row.isDeleted === false));
  });

  test("통전 목록도 줄을 빼면서 그 이름으로 새 줄을 만들 수 있다", async () => {
    await resetKind("GENERATOR");
    await save({
      kind: "GENERATOR",
      tasks: [],
      powerTestTasks: [
        { id: null, taskName: "통전 A" },
        { id: null, taskName: "통전 B" },
      ],
      actorUserId: superAdminId,
    });
    const before = await livePowerTests("GENERATOR");

    const result = await save({
      kind: "GENERATOR",
      tasks: [],
      powerTestTasks: [
        { id: before[1].id, taskName: "통전 B" },
        { id: null, taskName: "통전 A" },
      ],
      actorUserId: secondActorId,
    });
    assert.equal(result.ok, true, JSON.stringify(result));

    const live = await livePowerTests("GENERATOR");
    assert.deepEqual(
      live.map((row) => [row.taskName, row.displayOrder]),
      [
        ["통전 B", 1],
        ["통전 A", 2],
      ]
    );
    const created = live.find((row) => row.taskName === "통전 A");
    assert.ok(created);
    assert.notEqual(created.id, before[0].id, "옛 줄이 되살아난 것이 아니라 새 줄이다");
    assert.equal((await allPowerTests("GENERATOR")).length, 3, "옛 줄은 남아 있다");
  });

  test("세 줄을 돌려 바꿔도 된다 — 순환이 두 줄짜리만 풀리는 게 아니다", async () => {
    await resetKind("MATCHER");
    await save({
      kind: "MATCHER",
      tasks: [newTask("작업 A", 2), newTask("작업 B", 3), newTask("작업 C", 4)],
      powerTestTasks: [],
      actorUserId: superAdminId,
    });
    const before = await liveTasks("MATCHER");

    // A→B, B→C, C→A. 어느 줄을 먼저 써도 상대가 그 이름을 쥐고 있다.
    const result = await save({
      kind: "MATCHER",
      tasks: [
        { id: before[0].id, taskName: "작업 B", hours: 2, isOverhaul: false },
        { id: before[1].id, taskName: "작업 C", hours: 3, isOverhaul: false },
        { id: before[2].id, taskName: "작업 A", hours: 4, isOverhaul: false },
      ],
      powerTestTasks: [],
      actorUserId: superAdminId,
    });
    assert.equal(result.ok, true, JSON.stringify(result));

    assert.deepEqual(
      (await liveTasks("MATCHER")).map((row) => [row.id, row.taskName, row.hours]),
      [
        [before[0].id, "작업 B", 2],
        [before[1].id, "작업 C", 3],
        [before[2].id, "작업 A", 4],
      ]
    );
    assert.equal((await allTasks("MATCHER")).length, 3, "줄이 늘거나 지워지면 안 된다");
  });

  test("이름을 안 바꾸고 다른 값만 고쳐도 멀쩡하다 — 임시값 단계가 감사 기록까지 흐리지 않는다", async () => {
    await resetKind("MATCHER");
    await save({
      kind: "MATCHER",
      hourlyRate: HOURLY_RATE,
      tasks: [newTask("작업 A", 2), newTask("작업 B", 3)],
      powerTestTasks: [{ id: null, taskName: "통전 A" }],
      actorUserId: superAdminId,
    });
    const before = await liveTasks("MATCHER");
    const powerBefore = await livePowerTests("MATCHER");
    const setting = await storedSetting("MATCHER");
    assert.ok(setting);
    const trailBefore = await settingsAudit(setting.id);

    const result = await save({
      kind: "MATCHER",
      hourlyRate: HOURLY_RATE,
      tasks: [
        { id: before[0].id, taskName: "작업 A", hours: 9, isOverhaul: true },
        { id: before[1].id, taskName: "작업 B", hours: 3, isOverhaul: false },
      ],
      powerTestTasks: powerBefore.map((row) => ({ id: row.id, taskName: row.taskName })),
      actorUserId: secondActorId,
    });
    assert.equal(result.ok, true, JSON.stringify(result));

    assert.deepEqual(
      (await liveTasks("MATCHER")).map((row) => [
        row.id,
        row.taskName,
        row.hours,
        row.isOverhaul,
        row.displayOrder,
      ]),
      [
        [before[0].id, "작업 A", 9, true, 1],
        [before[1].id, "작업 B", 3, false, 2],
      ],
      "이름은 그대로고 값만 바뀐다"
    );
    assert.ok(
      (await allTasks("MATCHER")).every((row) => row.isDeleted === false),
      "한 줄도 지워지면 안 된다"
    );

    // 🔴 감사에 임시값이 새어 나가면 안 된다 — previousValue 는 저장 전에 읽고,
    // newValue 는 화면이 보낸 글자다. 둘 다 사람이 적은 이름이어야 한다.
    const trail = await settingsAudit(setting.id);
    assert.equal(trail.length, trailBefore.length + 1, "저장 한 번에 한 줄이다");
    const entry = trail[trail.length - 1];
    assert.deepEqual(entry.previousValue, {
      equipmentKind: "MATCHER",
      hourlyRate: HOURLY_RATE_STORED,
      baseCost: null,
      powerTestHours: null,
      taskCount: 2,
      totalHours: 5,
      powerTestTaskCount: 1,
      powerTestTaskNames: ["통전 A"],
    });
    assert.deepEqual(entry.newValue, {
      equipmentKind: "MATCHER",
      hourlyRate: HOURLY_RATE,
      baseCost: null,
      powerTestHours: null,
      taskCount: 2,
      totalHours: 12,
      powerTestTaskCount: 1,
      powerTestTaskNames: ["통전 A"],
    });
  });

  test("🔴 임시값이 남지 않는다 — 저장이 끝나면 어떤 줄의 이름도 그 모양이 아니다", async () => {
    await resetKind("GENERATOR");
    await save({
      kind: "GENERATOR",
      tasks: [newTask("작업 A", 2), newTask("작업 B", 3)],
      powerTestTasks: [
        { id: null, taskName: "통전 A" },
        { id: null, taskName: "통전 B" },
      ],
      actorUserId: superAdminId,
    });
    const before = await liveTasks("GENERATOR");
    const powerBefore = await livePowerTests("GENERATOR");

    const result = await save({
      kind: "GENERATOR",
      tasks: [
        { id: before[0].id, taskName: "작업 B", hours: 2, isOverhaul: false },
        { id: before[1].id, taskName: "작업 A", hours: 3, isOverhaul: false },
      ],
      powerTestTasks: [
        { id: powerBefore[0].id, taskName: "통전 B" },
        { id: powerBefore[1].id, taskName: "통전 A" },
      ],
      actorUserId: superAdminId,
    });
    assert.equal(result.ok, true, JSON.stringify(result));

    // 지운 줄까지 포함해서 본다 — 임시값을 쥔 채 소프트 삭제된 줄이 남는 사고도
    // 여기서 걸려야 한다.
    const names = [
      ...(await allTasks("GENERATOR")).map((row) => row.taskName),
      ...(await allPowerTests("GENERATOR")).map((row) => row.taskName),
    ];
    assert.deepEqual(
      names.filter((name) => name.includes(STAGED_TASK_NAME_PREFIX)),
      [],
      "🔴 이름을 옮겨 담던 임시값이 한 줄도 남으면 안 된다"
    );
    assert.deepEqual(
      new Set(names),
      new Set(["작업 A", "작업 B", "통전 A", "통전 B"]),
      "사람이 적은 이름만 남는다"
    );
  });

  test("🔴 잘못된 id 와 이름 맞바꾸기를 함께 보내면 NOT_FOUND 이고, 이름이 하나도 안 바뀐다", async () => {
    await resetKind("MATCHER");
    await save({
      kind: "MATCHER",
      hourlyRate: HOURLY_RATE,
      tasks: [newTask("작업 A", 2), newTask("작업 B", 3)],
      powerTestTasks: [],
      actorUserId: superAdminId,
    });
    const before = await liveTasks("MATCHER");

    const result = await save({
      kind: "MATCHER",
      hourlyRate: "999999",
      tasks: [
        { id: before[0].id, taskName: "작업 B", hours: 2, isOverhaul: false },
        { id: before[1].id, taskName: "작업 A", hours: 3, isOverhaul: false },
        { id: randomUUID(), taskName: "없는 줄", hours: 5, isOverhaul: false },
      ],
      powerTestTasks: [],
      actorUserId: secondActorId,
    });
    assert.equal(result.ok, false, JSON.stringify(result));
    if (result.ok) return;
    assert.equal(result.code, "NOT_FOUND");

    assert.deepEqual(
      (await liveTasks("MATCHER")).map((row) => [row.id, row.taskName]),
      [
        [before[0].id, "작업 A"],
        [before[1].id, "작업 B"],
      ],
      "🔴 이름을 임시값으로 밀어 두던 단계까지 되돌아가야 한다"
    );
    const all = await allTasks("MATCHER");
    assert.equal(all.length, 2, "줄이 늘거나 지워지면 안 된다");
    assert.ok(all.every((row) => row.isDeleted === false));
    const setting = await storedSetting("MATCHER");
    assert.ok(setting);
    assert.equal(setting.hourlyRate, HOURLY_RATE_STORED, "단가도 되돌아간다");
  });

  test("🔴 색인 위반은 23505 와 색인 이름을 들고 온다 — 남은 충돌을 알아보는 근거다", async () => {
    // saveRepairLabor 는 이제 이 충돌을 스스로 만들지 않는다. 그래도 다른 쓰는
    // 쪽(scripts/seed-repair-tasks.ts)이나 같은 순간의 저장이 부딪힐 수 있어
    // 그 오류를 알아보는 갈래가 남아 있다. **그 갈래가 무엇을 보고 판정하는지**를
    // 여기서 못 박는다 — 오류의 모양이 바뀌면 그 판정이 조용히 죽고, 사람은 다시
    // "잠시 후 다시 시도해 주세요"를 듣게 된다.
    await resetKind("TOTAL_CONTROLLER");
    await save({
      kind: "TOTAL_CONTROLLER",
      tasks: [newTask("겹칠 작업", 4)],
      powerTestTasks: [{ id: null, taskName: "겹칠 통전 작업" }],
      actorUserId: superAdminId,
    });

    const taskError = await db
      .insert(repairTaskCatalog)
      .values({
        equipmentKind: "TOTAL_CONTROLLER",
        taskName: "겹칠 작업",
        hours: 4,
        displayOrder: 2,
        createdBy: superAdminId,
        updatedBy: superAdminId,
      })
      .then(
        () => null,
        (err: unknown) => err
      );
    assert.ok(taskError, "부분 unique 색인이 막아야 한다");
    // 🔴 drizzle 이 드라이버 오류를 자기 오류로 **감싼다.** 코드도 색인 이름도
    // 바깥 오류에는 없고 cause 에 있다 — 바깥만 보고 판정하면 그 갈래는 영원히
    // 안 켜진다.
    assert.deepEqual(pgFields(taskError), {
      code: "23505",
      constraintName: "repair_task_catalog_kind_name_not_deleted_unique",
    });

    const powerError = await db
      .insert(powerTestTasks)
      .values({
        equipmentKind: "TOTAL_CONTROLLER",
        taskName: "겹칠 통전 작업",
        displayOrder: 2,
        createdBy: superAdminId,
        updatedBy: superAdminId,
      })
      .then(
        () => null,
        (err: unknown) => err
      );
    assert.ok(powerError, "통전 표에도 같은 색인이 있다");
    assert.deepEqual(pgFields(powerError), {
      code: "23505",
      constraintName: "power_test_tasks_kind_name_not_deleted_unique",
    });
  });
});
