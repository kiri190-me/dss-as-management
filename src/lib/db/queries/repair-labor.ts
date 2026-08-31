import "server-only";

import { asc, eq } from "drizzle-orm";
import { db } from "../client";
import { repairLaborSettings, repairTaskCatalog } from "../schema";
import type { WorkflowKind } from "@/lib/domain/workflow-kind";

/**
 * ============================================================================
 * 수리 작업 비용 — 읽는 쪽
 * ============================================================================
 * **읽기 전용이다.** 만들고 고치는 일은 mutations/repair-labor.ts 가 맡는다.
 *
 * 장비 종류 셋을 **언제나 셋 다** 돌려준다. 목록이 빈 종류(T/C)도 화면에 자리가
 * 있어야 사람이 거기 채워 넣을 수 있다 — 없는 것을 안 보여 주면 "어디에 넣지"가
 * 된다.
 * ============================================================================
 */

export type RepairTaskRow = {
  id: string;
  taskName: string;
  hours: number;
  displayOrder: number;
  /**
   * 오버홀 작업인가. 견적서 종류를 O/H 로 고르면 자동으로 체크되는 줄이다.
   * **이름으로 맞히지 않는다**(schema/repair-labor.ts 의 그 항목).
   */
  isOverhaul: boolean;
};

export type RepairLaborKindRow = {
  equipmentKind: WorkflowKind;
  /** 시간당 작업비(원). numeric 은 Drizzle 이 문자열로 읽는다. */
  hourlyRate: string;
  /** 기본 작업비(원). **null 이면 정하지 않은 것**이고 합계에 더하지 않는다. */
  baseCost: string | null;
  tasks: RepairTaskRow[];
};

/** 화면이 늘어놓는 차례. 사람이 이 순서로 기억한다. */
export const REPAIR_LABOR_KINDS: readonly WorkflowKind[] = [
  "GENERATOR",
  "MATCHER",
  "TOTAL_CONTROLLER",
];

/**
 * 장비 종류 셋 × (단가 설정 + 작업 목록).
 *
 * 질의 두 번으로 끝낸다 — 종류마다 읽으면 N+1 이고, 셋뿐이라 통째로 걷어 와
 * 메모리에서 가르는 편이 단순하다.
 *
 * 설정 줄이 없는 종류는 **시간당 단가를 알 수 없다.** 그때는 0 으로 채우지 않고
 * `"0"` 도 아닌, 시드가 넣어 둔 값이 없다는 뜻으로 hourlyRate 를 `"0"` 으로 두지
 * 않는다 — 대신 화면이 "단가를 정해 주세요"를 그리도록 baseCost 와 함께
 * 있는 그대로 넘긴다. (시드가 셋 다 만들므로 실제로는 비지 않는다.)
 */
export async function listRepairLabor(): Promise<RepairLaborKindRow[]> {
  const [settings, tasks] = await Promise.all([
    db
      .select({
        equipmentKind: repairLaborSettings.equipmentKind,
        hourlyRate: repairLaborSettings.hourlyRate,
        baseCost: repairLaborSettings.baseCost,
      })
      .from(repairLaborSettings),
    db
      .select({
        id: repairTaskCatalog.id,
        equipmentKind: repairTaskCatalog.equipmentKind,
        taskName: repairTaskCatalog.taskName,
        hours: repairTaskCatalog.hours,
        displayOrder: repairTaskCatalog.displayOrder,
        isOverhaul: repairTaskCatalog.isOverhaul,
      })
      .from(repairTaskCatalog)
      .where(eq(repairTaskCatalog.isDeleted, false))
      .orderBy(asc(repairTaskCatalog.displayOrder)),
  ]);

  return REPAIR_LABOR_KINDS.map((kind) => {
    const setting = settings.find((row) => row.equipmentKind === kind);
    return {
      equipmentKind: kind,
      // 설정 줄이 아직 없는 종류는 시간당 단가가 없다. 0 으로 두면 고른 작업이
      // 전부 0원이 되어 "계산이 됐는데 값이 0"으로 보인다 — 그보다는 사람이
      // 채워야 한다는 것이 드러나는 편이 낫다. 화면이 그 상태를 알린다.
      hourlyRate: setting?.hourlyRate ?? "0",
      baseCost: setting?.baseCost ?? null,
      tasks: tasks
        .filter((task) => task.equipmentKind === kind)
        .map(({ id, taskName, hours, displayOrder, isOverhaul }) => ({
          id,
          taskName,
          hours,
          displayOrder,
          isOverhaul,
        })),
    };
  });
}

/**
 * 견적서가 쓸 한 종류분. 목록과 단가를 함께 준다 — 견적서 화면이 그 둘로
 * 작업비를 계산한다(domain/repair-labor-cost.ts).
 */
export async function getRepairLaborForKind(kind: WorkflowKind): Promise<RepairLaborKindRow> {
  const all = await listRepairLabor();
  // REPAIR_LABOR_KINDS 가 셋을 모두 담으므로 못 찾을 수 없다.
  return all.find((row) => row.equipmentKind === kind) as RepairLaborKindRow;
}
