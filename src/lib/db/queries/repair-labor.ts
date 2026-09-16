import "server-only";

import { asc, eq } from "drizzle-orm";
import { db } from "../client";
import { powerTestTasks, repairLaborSettings, repairTaskCatalog } from "../schema";
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

/**
 * 통전 작업 한 줄. **공수시간이 없다** — 통전작업의 금액은 목록이 아니라
 * `powerTestHours` 하나가 정한다(schema/repair-labor.ts 의 그 표 머리말).
 */
export type PowerTestTaskRow = {
  id: string;
  taskName: string;
  displayOrder: number;
};

export type RepairLaborKindRow = {
  equipmentKind: WorkflowKind;
  /** 시간당 작업비(원). numeric 은 Drizzle 이 문자열로 읽는다. */
  hourlyRate: string;
  /**
   * 넘어오기 전의 기본 작업비(원). **null 이면 정하지 않은 것**이다.
   *
   * 🔴 **2026-09-16 부터 이 값으로 작업비를 셈하지 않는다** — 기본 작업비는 아래 세
   * 공수시간의 합 × 시간당 단가다(domain/quote-labor-cost.ts). 그때의 금액을 되짚을
   * 근거로만 싣는다(schema/repair-labor.ts 의 base_cost 주석).
   */
  baseCost: string | null;
  /**
   * 조사작업 공수시간. **null 이면 정하지 않은 것**이다.
   * 예전에는 칸이 아니라 「기본 작업비 − 통전 몫」이라는 나머지였다 —
   * schema/repair-labor.ts 의 그 항목.
   */
  investigationHours: number | null;
  /**
   * 통전작업 공수시간. **null 이면 정하지 않은 것**이다(T/C 는 아직 모른다).
   * 기본 작업비를 이루는 세 몫 중 하나다 — schema/repair-labor.ts 의 그 항목.
   */
  powerTestHours: number | null;
  /**
   * 서류작업 공수시간. **null 이면 정하지 않은 것**이고 `0` 은 「서류작업이 없는
   * 장비」라는 실제 값이다(셋 중 여기만 0 을 받는다 — schema/repair-labor.ts).
   * 지금 세 장비 모두 null 이다.
   */
  documentHours: number | null;
  tasks: RepairTaskRow[];
  /**
   * 그 장비의 통전 작업 건명 목록. 하나도 없으면 **빈 배열**이다(`null` 이 아니다) —
   * T/C 는 아직 아무것도 없고, 그건 "정하지 않음"이 아니라 그냥 빈 목록이다.
   */
  powerTestTasks: PowerTestTaskRow[];
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
 * 질의 세 번으로 끝낸다 — 종류마다 읽으면 N+1 이고, 셋뿐이라 통째로 걷어 와
 * 메모리에서 가르는 편이 단순하다.
 *
 * 설정 줄이 없는 종류는 **시간당 단가를 알 수 없다.** 그때는 0 으로 채우지 않고
 * `"0"` 도 아닌, 시드가 넣어 둔 값이 없다는 뜻으로 hourlyRate 를 `"0"` 으로 두지
 * 않는다 — 대신 화면이 "단가를 정해 주세요"를 그리도록 baseCost 와 함께
 * 있는 그대로 넘긴다. (시드가 셋 다 만들므로 실제로는 비지 않는다.)
 */
export async function listRepairLabor(): Promise<RepairLaborKindRow[]> {
  const [settings, tasks, powerTests] = await Promise.all([
    db
      .select({
        equipmentKind: repairLaborSettings.equipmentKind,
        hourlyRate: repairLaborSettings.hourlyRate,
        baseCost: repairLaborSettings.baseCost,
        investigationHours: repairLaborSettings.investigationHours,
        powerTestHours: repairLaborSettings.powerTestHours,
        documentHours: repairLaborSettings.documentHours,
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
    db
      .select({
        id: powerTestTasks.id,
        equipmentKind: powerTestTasks.equipmentKind,
        taskName: powerTestTasks.taskName,
        displayOrder: powerTestTasks.displayOrder,
      })
      .from(powerTestTasks)
      .where(eq(powerTestTasks.isDeleted, false))
      .orderBy(asc(powerTestTasks.displayOrder)),
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
      // 설정 줄이 없으면 세 공수시간도 **정하지 않은 것**이다. 0 으로 두면
      // "그 작업이 0시간"이라는 실제 값처럼 보이고(서류는 실제로 그 값이 있다),
      // 기본 작업비가 0원으로 셈된다 — 정하지 않은 것은 더하지도 빼지도 않는다.
      investigationHours: setting?.investigationHours ?? null,
      powerTestHours: setting?.powerTestHours ?? null,
      documentHours: setting?.documentHours ?? null,
      tasks: tasks
        .filter((task) => task.equipmentKind === kind)
        .map(({ id, taskName, hours, displayOrder, isOverhaul }) => ({
          id,
          taskName,
          hours,
          displayOrder,
          isOverhaul,
        })),
      // 없는 종류는 빈 배열이다. 통전 목록이 비어 있는 것은 정상이고(T/C),
      // "정하지 않음"을 뜻하는 powerTestHours 의 null 과는 다른 이야기다.
      powerTestTasks: powerTests
        .filter((task) => task.equipmentKind === kind)
        .map(({ id, taskName, displayOrder }) => ({ id, taskName, displayOrder })),
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
