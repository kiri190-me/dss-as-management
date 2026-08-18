import "./load-env";

import { eq, sql } from "drizzle-orm";
import { db, pgClient } from "../src/lib/db/connection";
import { workflowSteps, workflowTemplates, workflowTransitions, workflowVersions } from "../src/lib/db/schema";
import { TRANSITION_DEFINITIONS } from "../src/lib/domain/local/workflow/transition-definitions";
import { getStepCategory } from "../src/lib/domain/local/workflow/step-category";
import { getStepStatus } from "../src/lib/domain/local/workflow/step-status-map";
import type { WorkflowType } from "../src/lib/domain/types";

/**
 * ============================================================================
 * Phase 1 이관 — TypeScript 규칙 표를 DB로 옮긴다
 * ============================================================================
 * 옮기는 것은 세 가지다(WORKFLOW_EDITOR_DESIGN.md §7 Phase 1):
 *   - step-status-map.ts  → workflow_steps.repair_status
 *   - step-category.ts    → workflow_steps.category
 *   - transition-definitions.ts(183행) → workflow_transitions
 *
 * **런타임은 이 스크립트 이후에도 여전히 TS 표를 읽는다.** 이 단계의 성공
 * 기준은 "새 기능이 동작한다"가 아니라 "이전과 완전히 똑같다"이며, DB에 넣은
 * 값이 표와 1:1인지가 전부다. 그 대조는 여기서 한 번 하고,
 * workflow-rules-parity.test.ts가 이후 계속 지킨다.
 *
 * 멱등하다 — 이미 이관된 DB에서 다시 실행하면 같은 결과로 수렴한다
 * (단계 컬럼은 덮어쓰기, 전이는 (버전, 동작, 출발단계) 유니크 키 기준 갱신).
 * APPLY=1이 없으면 계획과 대조 결과만 출력한다.
 *
 * 대상 범위가 두 가지로 갈린다(아래 allSteps 주석 참조):
 *   - 단계의 상태·분류 컬럼: **모든 버전**(ARCHIVED된 레거시 MATCHER 포함)
 *   - 전이: **is_current 버전만** — 아카이브된 워크플로에는 신규 접수가
 *     배정되지 않으므로 이동 규칙을 만들어 둘 이유가 없다.
 * ============================================================================
 */

const APPLY = process.env.APPLY === "1";

type StepRow = { id: string; key: string; workflowType: string; versionId: string };

async function main() {
  const identity = await db.execute(sql`select current_database() as name`);
  const dbName = (identity[0] as { name?: string } | undefined)?.name;
  if (dbName !== "dss_as_dev" && dbName !== "dss_as_test") {
    throw new Error(`안전 게이트: dss_as_dev / dss_as_test 에서만 실행할 수 있습니다 (현재: ${String(dbName)})`);
  }
  console.log(`대상 DB: ${dbName} / 모드: ${APPLY ? "APPLY (쓰기)" : "DRY RUN"}\n`);

  /**
   * 상태·분류 컬럼은 **모든 버전의 모든 단계**에 채운다(아카이브된 버전 포함).
   * 그 값은 단계 자체의 성질이고, 아카이브된 버전에도 과거 접수 건의 이력이
   * 걸려 있다. 무엇보다 나중에 repair_status를 NOT NULL로 올릴 때 비어 있는
   * 행이 하나라도 있으면 그 마이그레이션이 실패한다.
   *
   * 반면 전이는 current 버전에만 넣는다 — 아카이브된 워크플로에는 새 접수 건이
   * 배정되지 않으므로 이동 규칙을 만들어 둘 이유가 없다.
   */
  const allSteps = (await db
    .select({
      id: workflowSteps.id,
      key: workflowSteps.key,
      workflowType: workflowTemplates.code,
      versionId: workflowVersions.id,
      isCurrent: workflowVersions.isCurrent,
    })
    .from(workflowSteps)
    .innerJoin(workflowVersions, eq(workflowVersions.id, workflowSteps.workflowVersionId))
    .innerJoin(workflowTemplates, eq(workflowTemplates.id, workflowVersions.workflowTemplateId))) as (StepRow & {
    isCurrent: boolean;
  })[];
  const steps = allSteps.filter((s) => s.isCurrent);

  const stepByTypeAndKey = new Map<string, StepRow>();
  for (const step of steps) stepByTypeAndKey.set(`${step.workflowType}::${step.key}`, step);

  // ── 1. 단계의 상태/분류 ───────────────────────────────────────────────
  const stepUpdates = allSteps.map((step) => ({
    step,
    repairStatus: getStepStatus(step.workflowType as WorkflowType, step.key) ?? null,
    category: getStepCategory(step.workflowType as WorkflowType, step.key) ?? null,
  }));
  const missingStatus = stepUpdates.filter((u) => u.repairStatus === null);
  console.log(
    `[1] 단계 ${allSteps.length}개(current ${steps.length} + 아카이브 ${allSteps.length - steps.length}) — 상태 매핑 없는 단계 ${missingStatus.length}개`
  );
  if (missingStatus.length > 0) {
    // 상태가 없으면 그 단계에 놓인 접수 건은 읽을 때마다 화면이 깨진다.
    // 조용히 NULL로 남기지 않고 즉시 멈춘다.
    throw new Error(
      `상태 매핑이 없는 단계가 있어 중단합니다: ${missingStatus.map((u) => `${u.step.workflowType}/${u.step.key}`).join(", ")}`
    );
  }
  const noCategory = stepUpdates.filter((u) => u.category === null);
  console.log(`    분류 없는 단계 ${noCategory.length}개 (도달 불가/종료 단계 — 정상)`);
  if (APPLY) {
    for (const u of stepUpdates) {
      await db
        .update(workflowSteps)
        .set({ repairStatus: u.repairStatus, category: u.category, updatedAt: new Date() })
        .where(eq(workflowSteps.id, u.step.id));
    }
    console.log(`    → ${stepUpdates.length}개 갱신 완료\n`);
  } else {
    console.log("");
  }

  // ── 2. 전이 ───────────────────────────────────────────────────────────
  const currentTypes = new Set(steps.map((s) => s.workflowType));
  const applicable = TRANSITION_DEFINITIONS.filter((d) => currentTypes.has(d.workflowType));
  const skipped = TRANSITION_DEFINITIONS.length - applicable.length;
  console.log(`[2] 전이 표 ${TRANSITION_DEFINITIONS.length}행 중 대상 ${applicable.length}행 (제외 ${skipped}행: current 버전이 없는 워크플로)`);

  const rows = applicable.map((d) => {
    const from = stepByTypeAndKey.get(`${d.workflowType}::${d.fromStepKey}`);
    const to = stepByTypeAndKey.get(`${d.workflowType}::${d.toStepKey}`);
    if (!from || !to) {
      throw new Error(`DB에 없는 단계를 참조하는 전이가 있어 중단합니다: ${d.id} (${d.fromStepKey} → ${d.toStepKey})`);
    }
    return {
      workflowVersionId: from.versionId,
      actionCode: d.actionCode as "STEP_ADVANCED" | "STEP_RETURNED" | "SHIPMENT_COMPLETED",
      fromStepId: from.id,
      toStepId: to.id,
      allowedRoles: [...d.allowedRoles],
      requiresAssignedEngineer: d.requiresAssignedEngineer,
      requiresReason: d.requiresReason,
      requiredApprovalType: d.requiredApprovalType,
    };
  });

  if (APPLY) {
    await db.transaction(async (tx) => {
      for (const row of rows) {
        await tx
          .insert(workflowTransitions)
          .values(row)
          .onConflictDoUpdate({
            target: [
              workflowTransitions.workflowVersionId,
              workflowTransitions.actionCode,
              workflowTransitions.fromStepId,
            ],
            set: {
              toStepId: row.toStepId,
              allowedRoles: row.allowedRoles,
              requiresAssignedEngineer: row.requiresAssignedEngineer,
              requiresReason: row.requiresReason,
              requiredApprovalType: row.requiredApprovalType,
              updatedAt: new Date(),
            },
          });
      }
    });
    console.log(`    → ${rows.length}행 반영 완료\n`);
  } else {
    console.log("");
  }

  // ── 3. 1:1 대조 ───────────────────────────────────────────────────────
  const dbRows = await db
    .select({
      workflowType: workflowTemplates.code,
      actionCode: workflowTransitions.actionCode,
      fromStepId: workflowTransitions.fromStepId,
      toStepId: workflowTransitions.toStepId,
      allowedRoles: workflowTransitions.allowedRoles,
      requiresAssignedEngineer: workflowTransitions.requiresAssignedEngineer,
      requiresReason: workflowTransitions.requiresReason,
      requiredApprovalType: workflowTransitions.requiredApprovalType,
    })
    .from(workflowTransitions)
    .innerJoin(workflowVersions, eq(workflowVersions.id, workflowTransitions.workflowVersionId))
    .innerJoin(workflowTemplates, eq(workflowTemplates.id, workflowVersions.workflowTemplateId));

  const stepIdToKey = new Map(allSteps.map((s) => [s.id, s.key]));
  const dbByKey = new Map(
    dbRows.map((r) => [`${r.workflowType}::${r.actionCode}::${stepIdToKey.get(r.fromStepId)}`, r])
  );

  const mismatches: string[] = [];
  for (const d of applicable) {
    const key = `${d.workflowType}::${d.actionCode}::${d.fromStepKey}`;
    const row = dbByKey.get(key);
    if (!row) {
      mismatches.push(`${key} — DB에 없음`);
      continue;
    }
    if (stepIdToKey.get(row.toStepId) !== d.toStepKey) mismatches.push(`${key} — 도착 단계 불일치`);
    if ([...row.allowedRoles].sort().join(",") !== [...d.allowedRoles].sort().join(","))
      mismatches.push(`${key} — 허용 역할 불일치 (DB ${row.allowedRoles} / 표 ${d.allowedRoles})`);
    if (row.requiresAssignedEngineer !== d.requiresAssignedEngineer) mismatches.push(`${key} — 담당자 필수 불일치`);
    if (row.requiresReason !== d.requiresReason) mismatches.push(`${key} — 사유 필수 불일치`);
    if ((row.requiredApprovalType ?? null) !== (d.requiredApprovalType ?? null))
      mismatches.push(`${key} — 승인 종류 불일치`);
  }
  const extra = dbRows.length - applicable.length;

  console.log("=== 1:1 대조 ===");
  console.log(`표 ${applicable.length}행 / DB ${dbRows.length}행 (차이 ${extra})`);
  console.log(`불일치 ${mismatches.length}건`);
  for (const m of mismatches.slice(0, 20)) console.log(`  ${m}`);
  if (mismatches.length > 20) console.log(`  ... 외 ${mismatches.length - 20}건`);

  const statusFilled = await db.execute(
    sql`select count(*)::int as n from workflow_steps where repair_status is null`
  );
  console.log(`repair_status가 비어 있는 단계: ${JSON.stringify(statusFilled)}`);

  await pgClient.end({ timeout: 5 });
  if (APPLY && (mismatches.length > 0 || extra !== 0)) process.exitCode = 1;
}

main();
