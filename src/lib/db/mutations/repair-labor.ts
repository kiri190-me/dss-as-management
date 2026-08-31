import "server-only";

import { and, eq, notInArray, sql } from "drizzle-orm";
import { db } from "../client";
import { repairLaborSettings, repairTaskCatalog } from "../schema";
import { insertAuditLog } from "./audit-logs";
import type { RepairLaborFields } from "@/lib/validation/repair-task-input";

/**
 * ============================================================================
 * 수리 작업 비용 — 저장
 * ============================================================================
 * 화면이 **장비 종류 하나분을 통째로** 편집한다(단가 설정 + 작업 목록). 그래서
 * 저장도 종류 하나가 단위이고, 전부 **한 트랜잭션**이다 — 목록은 저장됐는데
 * 단가는 안 된 반쪽 상태가 되면 그 사이에 뽑은 견적서가 틀린 금액으로 나간다.
 *
 * ── 🔴 목록에서 빠진 줄은 **소프트 삭제**다 ─────────────────────────────
 * 지운 작업을 하드 삭제하면, 그 작업으로 이미 뽑아 둔 견적서가 무엇을 청구한
 * 것인지 답할 수 없게 된다. 견적서는 고객사에 나간 문서라 나중에 반드시
 * 되짚어 보게 된다. 그래서 목록에서 사라져도 줄 자체는 남는다.
 *
 * ── 차례는 화면이 늘어놓은 순서다 ───────────────────────────────────────
 * 사진의 표 순서가 그대로 뜻을 갖는다(OH 가 맨 아래인 데는 이유가 있다).
 * 저장하는 쪽이 1부터 다시 매긴다 — oh_part_templates 의 replaceItems 와 같다.
 * ============================================================================
 */

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type SaveRepairLaborResult =
  | { ok: true; changedCount: number }
  | { ok: false; code: "NOT_FOUND"; message: string };

/**
 * 🔴 거절을 **트랜잭션 밖으로 던지기** 위한 신호.
 *
 * 콜백에서 그냥 `return` 하면 트랜잭션이 **커밋된다.** 아래 거절은 단가와 앞쪽
 * 작업 줄을 이미 고친 뒤에 나오므로, 반환해 버리면 "일부만 저장되고 오류 메시지가
 * 뜬" 최악의 상태가 된다 — 사람은 저장이 안 된 줄 알고 다시 누른다.
 * (part-overhaul-unit-prices.ts · oh-part-templates.ts 의 같은 장치.)
 */
class SaveRejected extends Error {
  constructor(readonly result: Extract<SaveRepairLaborResult, { ok: false }>) {
    super(result.message);
    this.name = "SaveRejected";
  }
}

/**
 * 장비 종류 하나분을 저장한다.
 *
 * 권한·행위자 판정은 **부르는 쪽(서버 액션)이 이미 마쳤다.** 이 계층은 기계다
 * (mutations/quotes.ts 와 같은 판단).
 */
export async function saveRepairLabor(params: {
  fields: RepairLaborFields;
  actorUserId: string;
}): Promise<SaveRepairLaborResult> {
  const { equipmentKind, hourlyRate, baseCost, tasks } = params.fields;

  return db.transaction(async (tx): Promise<SaveRepairLaborResult> => {
    const previous = await readKind(tx, equipmentKind);

    // ── 단가 설정 ────────────────────────────────────────────────────────
    // 종류마다 한 줄이므로 충돌 대상도 그 칸 하나다. 줄이 없으면 만든다 —
    // 시드를 안 돌린 채로 화면에서 먼저 저장하는 길도 막히지 않아야 한다.
    await tx
      .insert(repairLaborSettings)
      .values({ equipmentKind, hourlyRate, baseCost, updatedBy: params.actorUserId })
      .onConflictDoUpdate({
        target: repairLaborSettings.equipmentKind,
        set: { hourlyRate, baseCost, updatedBy: params.actorUserId, updatedAt: new Date() },
      });

    // ── 작업 목록 ────────────────────────────────────────────────────────
    const keptIds: string[] = [];
    for (const [index, task] of tasks.entries()) {
      const displayOrder = index + 1;
      if (task.id) {
        const [updated] = await tx
          .update(repairTaskCatalog)
          .set({
            taskName: task.taskName,
            hours: task.hours,
            isOverhaul: task.isOverhaul,
            displayOrder,
            updatedAt: new Date(),
            updatedBy: params.actorUserId,
          })
          .where(
            and(
              eq(repairTaskCatalog.id, task.id),
              eq(repairTaskCatalog.equipmentKind, equipmentKind),
              eq(repairTaskCatalog.isDeleted, false)
            )
          )
          .returning({ id: repairTaskCatalog.id });
        // 화면이 보낸 id 가 이 종류에 없다. 조용히 새로 만들면 사람이 고친 줄이
        // 아니라 딴 줄이 하나 생긴다 — 거절하고 다시 불러오게 한다.
        // 🔴 반환이 아니라 **던진다** — 여기서 반환하면 위의 쓰기가 커밋된다
        // (SaveRejected 주석).
        if (!updated) {
          throw new SaveRejected({
            ok: false,
            code: "NOT_FOUND",
            message: "이미 지워진 작업이 있습니다. 최신 정보를 다시 불러온 뒤 시도해 주세요.",
          });
        }
        keptIds.push(updated.id);
        continue;
      }

      const [created] = await tx
        .insert(repairTaskCatalog)
        .values({
          equipmentKind,
          taskName: task.taskName,
          hours: task.hours,
          isOverhaul: task.isOverhaul,
          displayOrder,
          createdBy: params.actorUserId,
          updatedBy: params.actorUserId,
        })
        .returning({ id: repairTaskCatalog.id });
      keptIds.push(created.id);
    }

    // 목록에서 빠진 줄을 소프트 삭제한다(위 머리말). keptIds 가 비면
    // notInArray 에 빈 배열이 가므로 조건을 나눈다.
    const gone = and(
      eq(repairTaskCatalog.equipmentKind, equipmentKind),
      eq(repairTaskCatalog.isDeleted, false),
      keptIds.length > 0 ? notInArray(repairTaskCatalog.id, keptIds) : sql`true`
    );
    await tx
      .update(repairTaskCatalog)
      .set({ isDeleted: true, deletedAt: new Date(), deletedBy: params.actorUserId })
      .where(gone);

    await insertAuditLog(tx, {
      actorUserId: params.actorUserId,
      actionType: "UPDATE",
      targetEntity: "repair_labor_settings",
      // 이 표는 장비 종류마다 한 줄이라 그 줄의 id 가 곧 대상이다. 아직 없던
      // 종류였다면 방금 만들어졌으므로 반드시 찾힌다.
      targetRecordId: await kindRowId(tx, equipmentKind),
      previousValue: previous,
      newValue: {
        equipmentKind,
        hourlyRate,
        baseCost,
        taskCount: tasks.length,
        // 시간 합계를 함께 남긴다 — 나중에 "그때 작업비가 왜 그 값이었나"를
        // 물을 때 목록 전체를 복원하지 않고도 크기를 가늠할 수 있다.
        totalHours: tasks.reduce((sum, task) => sum + task.hours, 0),
      },
    });

    return { ok: true, changedCount: tasks.length };
  }).catch((err: unknown) => {
    if (err instanceof SaveRejected) return err.result;
    throw err;
  });
}

/** 감사의 previousValue 에 실을, 바꾸기 전 상태. */
async function readKind(tx: Tx, equipmentKind: RepairLaborFields["equipmentKind"]) {
  const [setting] = await tx
    .select({ hourlyRate: repairLaborSettings.hourlyRate, baseCost: repairLaborSettings.baseCost })
    .from(repairLaborSettings)
    .where(eq(repairLaborSettings.equipmentKind, equipmentKind));

  const tasks = await tx
    .select({ hours: repairTaskCatalog.hours })
    .from(repairTaskCatalog)
    .where(
      and(
        eq(repairTaskCatalog.equipmentKind, equipmentKind),
        eq(repairTaskCatalog.isDeleted, false)
      )
    );

  return {
    equipmentKind,
    hourlyRate: setting?.hourlyRate ?? null,
    baseCost: setting?.baseCost ?? null,
    taskCount: tasks.length,
    totalHours: tasks.reduce((sum, task) => sum + task.hours, 0),
  };
}

async function kindRowId(tx: Tx, equipmentKind: RepairLaborFields["equipmentKind"]): Promise<string> {
  const [row] = await tx
    .select({ id: repairLaborSettings.id })
    .from(repairLaborSettings)
    .where(eq(repairLaborSettings.equipmentKind, equipmentKind));
  return row.id;
}
