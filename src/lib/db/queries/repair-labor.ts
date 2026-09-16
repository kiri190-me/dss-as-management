import "server-only";

import { asc, eq } from "drizzle-orm";
import { db } from "../client";
import { powerTestTasks, repairLaborSettings, repairTaskCatalog } from "../schema";
import {
  REPAIR_LABOR_SCOPES,
  type RepairLaborScope,
} from "@/lib/validation/repair-task-input";
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
 *
 * ── 🔴 `power_test_tasks` 는 이제 세 갈래를 담는다 ──────────────────────
 * 표 이름은 통전으로 시작했지만 2026-09-16 부터 조사 · 통전 · 서류가 한 표에
 * 산다(schema/repair-labor.ts). **그래서 읽을 때 반드시 scope 로 갈라야 한다** —
 * 안 가르면 통전 탭에 조사·서류 건명이 섞여 나온다.
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
 * 조사 · 통전 · 서류 목록의 한 줄. **공수시간이 없다** — 갈래의 금액은 목록이 아니라
 * 그 갈래의 공수시간 하나가 정한다(schema/repair-labor.ts 의 그 표 머리말).
 */
export type LaborScopeTaskRow = {
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
   * 근거로만 싣는다(schema/repair-labor.ts 의 base_cost 주석). 화면은 이 값을 고칠 수
   * 없고, 저장도 이 칸을 건드리지 않는다.
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
   * 갈래별 작업 건명 목록. **세 갈래가 언제나 다 있다** — 하나도 없는 갈래는
   * **빈 배열**이고(`null` 이 아니다), 그건 "정하지 않음"이 아니라 그냥 빈 목록이다.
   *
   * 🔴 화면의 저장이 이 세 목록을 **한 벌로 함께 보낸다.** 한 갈래를 빠뜨리면 그
   * 목록이 통째로 소프트 삭제된다(mutations/repair-labor.ts 의 계약).
   */
  scopeTasks: Record<RepairLaborScope, LaborScopeTaskRow[]>;
};

/** 화면이 늘어놓는 차례. 사람이 이 순서로 기억한다. */
export const REPAIR_LABOR_KINDS: readonly WorkflowKind[] = [
  "GENERATOR",
  "MATCHER",
  "TOTAL_CONTROLLER",
];

/**
 * 장비 종류 셋 × (단가 설정 + 수리 작업 목록 + 갈래 목록 셋).
 *
 * 질의 세 번으로 끝낸다 — 종류마다 읽으면 N+1 이고, 셋뿐이라 통째로 걷어 와
 * 메모리에서 가르는 편이 단순하다. 갈래도 같은 자리에서 가른다.
 *
 * 설정 줄이 없는 종류는 **시간당 단가를 알 수 없다.** 그때는 0 으로 채우지 않고
 * 있는 그대로 넘겨 화면이 "단가를 정해 주세요"를 그리게 한다.
 * (시드가 셋 다 만들므로 실제로는 비지 않는다.)
 */
export async function listRepairLabor(): Promise<RepairLaborKindRow[]> {
  const [settings, tasks, scopeRows] = await Promise.all([
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
        // 🔴 갈래를 함께 읽는다 — 이 칸 없이 걷어 오면 세 목록이 한 덩어리로 섞인다.
        scope: powerTestTasks.scope,
        taskName: powerTestTasks.taskName,
        displayOrder: powerTestTasks.displayOrder,
      })
      .from(powerTestTasks)
      .where(eq(powerTestTasks.isDeleted, false))
      .orderBy(asc(powerTestTasks.displayOrder)),
  ]);

  return REPAIR_LABOR_KINDS.map((kind) => {
    const setting = settings.find((row) => row.equipmentKind === kind);
    // 갈래 셋을 **언제나 셋 다** 만든다. 줄이 하나도 없는 갈래도 빈 배열로 자리가
    // 있어야 화면에 탭이 서고, 저장이 그 갈래를 빠뜨리지 않는다.
    const scopeTasks = Object.fromEntries(
      REPAIR_LABOR_SCOPES.map((scope) => [
        scope,
        scopeRows
          .filter((row) => row.equipmentKind === kind && row.scope === scope)
          .map(({ id, taskName, displayOrder }) => ({ id, taskName, displayOrder })),
      ])
    ) as Record<RepairLaborScope, LaborScopeTaskRow[]>;

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
      scopeTasks,
    };
  });
}

/**
 * 견적서가 쓸 한 종류분. 목록과 단가를 함께 준다 — 견적서 화면이 그 둘로
 * 작업비를 계산한다(domain/quote-labor-cost.ts).
 */
export async function getRepairLaborForKind(kind: WorkflowKind): Promise<RepairLaborKindRow> {
  const all = await listRepairLabor();
  // REPAIR_LABOR_KINDS 가 셋을 모두 담으므로 못 찾을 수 없다.
  return all.find((row) => row.equipmentKind === kind) as RepairLaborKindRow;
}
