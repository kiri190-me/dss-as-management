import "./load-env";

import { and, eq, sql } from "drizzle-orm";
import { db, pgClient } from "../src/lib/db/connection";
import { repairCases, users, workflowSteps, workflowVersions } from "../src/lib/db/schema";
import { permanentlyDeleteRepairCase } from "../src/lib/db/mutations/repair-cases";
import { insertAuditLog } from "../src/lib/db/mutations/audit-logs";

/**
 * ============================================================================
 * "제품 인수(product_intake)" 단계에 갇힌 접수 건 정리 (2026-08-18 승인)
 * ============================================================================
 * 발견 경위: Phase 4의 발행 검증 규칙을 운영 중인 워크플로에 실제로 대보다가
 * 모든 워크플로에서 "제품 인수 단계에 도달할 방법이 없습니다" 경고가 떴고,
 * 확인해 보니 그 단계에 접수 건이 59건(활성 44 + 휴지통 15) 놓여 있었다.
 *
 * product_intake는 전이 그래프에서 의도적으로 제외된 단계다
 * (transition-definitions.ts 헤더 주석). 들어오는 규칙도 나가는 규칙도 없다.
 * 즉 그 단계에 놓인 접수 건은 **진행도 되돌리기도 불가능한 상태로 갇힌다.**
 * 원인은 DEMO 시드(seed-realistic-demo.ts)가 단계를 순환 배분하면서 이 단계에까지
 * 접수 건을 놓은 것이다 — 시드 쪽도 함께 고쳤다.
 *
 * 세 가지를 한다.
 *   1. 활성 44건을 인수점검(intake_inspection)으로 옮긴다. 신규 접수가
 *      배치되는 단계이고, 모든 워크플로에 존재하며, 나가는 규칙도 있다.
 *   2. 휴지통 15건은 영구 삭제한다(사용자 결정). 복원하면 갇힌 채로 살아나기
 *      때문이다. 앱의 permanentlyDeleteRepairCase를 쓰므로 관련 기록 처리와
 *      감사 로그가 화면에서 지운 것과 동일하다.
 *   3. product_intake 단계를 비활성으로 바꾼다. 1·2가 끝나면 정말로 아무도
 *      쓰지 않는 단계가 되므로, 그 사실을 데이터에 남긴다.
 *
 * 순서가 중요하다 — 먼저 비활성으로 바꾸면 경고만 사라지고 접수 건은 그대로
 * 갇힌다(문제를 가리는 셈이다).
 *
 * 멱등하다. dss_as_dev가 아니면 즉시 중단하며, APPLY=1 없이는 계획만 출력한다.
 *
 * 영구 삭제는 되돌릴 수 없지만, 이 데이터에 한해서는 시드를 다시 돌리면
 * (npm run db:seed) 같은 ID로 재생성된다 — 결정론적 UUID를 쓰기 때문이다.
 * ============================================================================
 */

const STRANDED_STEP_KEY = "product_intake";
const TARGET_STEP_KEY = "intake_inspection";
const APPLY = process.env.APPLY === "1";

async function main() {
  const identity = await db.execute(sql`select current_database() as name`);
  const dbName = (identity[0] as { name?: string } | undefined)?.name;
  if (dbName !== "dss_as_dev") {
    throw new Error(`안전 게이트: dss_as_dev에서만 실행할 수 있습니다 (현재: ${String(dbName)})`);
  }
  console.log(`대상 DB: ${dbName} / 모드: ${APPLY ? "APPLY (쓰기)" : "DRY RUN"}\n`);

  const [actor] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, "SUPER_ADMIN"), eq(users.approvalStatus, "APPROVED"), eq(users.isDeleted, false)))
    .limit(1);
  if (!actor) throw new Error("승인된 SUPER_ADMIN 사용자가 필요합니다.");

  const stranded = await db
    .select({
      id: repairCases.id,
      intakeNumber: repairCases.intakeNumber,
      version: repairCases.version,
      isDeleted: repairCases.isDeleted,
      versionId: repairCases.workflowVersionId,
      stepId: repairCases.currentWorkflowStepId,
    })
    .from(repairCases)
    .innerJoin(workflowSteps, eq(workflowSteps.id, repairCases.currentWorkflowStepId))
    .where(eq(workflowSteps.key, STRANDED_STEP_KEY));

  const active = stranded.filter((c) => !c.isDeleted);
  const trashed = stranded.filter((c) => c.isDeleted);
  console.log(`[1] 갇힌 접수 건: 활성 ${active.length} / 휴지통 ${trashed.length}`);

  // ── 1. 활성 건 이동 ───────────────────────────────────────────────────
  const targetSteps = await db
    .select({ id: workflowSteps.id, versionId: workflowSteps.workflowVersionId })
    .from(workflowSteps)
    .where(eq(workflowSteps.key, TARGET_STEP_KEY));
  const targetByVersion = new Map(targetSteps.map((s) => [s.versionId, s.id]));

  const missingTarget = active.filter((c) => !targetByVersion.has(c.versionId));
  if (missingTarget.length > 0) {
    throw new Error(
      `대상 단계(${TARGET_STEP_KEY})가 없는 워크플로 버전이 있어 중단합니다: ${missingTarget.map((c) => c.intakeNumber).join(", ")}`
    );
  }

  if (APPLY) {
    for (const c of active) {
      const nextStepId = targetByVersion.get(c.versionId)!;
      await db
        .update(repairCases)
        .set({
          currentWorkflowStepId: nextStepId,
          version: sql`${repairCases.version} + 1`,
          updatedAt: sql`now()`,
        })
        .where(eq(repairCases.id, c.id));
      await db.transaction(async (tx) =>
        insertAuditLog(tx, {
          actorUserId: actor.id,
          actionType: "UPDATE",
          targetEntity: "repair_cases",
          targetRecordId: c.id,
          previousValue: { workflowStepId: c.stepId, stepKey: STRANDED_STEP_KEY },
          newValue: { workflowStepId: nextStepId, stepKey: TARGET_STEP_KEY },
        })
      );
    }
    console.log(`    → 활성 ${active.length}건을 ${TARGET_STEP_KEY}(으)로 이동 완료`);
  } else {
    console.log(`    → 활성 ${active.length}건 이동 예정`);
  }

  // ── 2. 휴지통 영구 삭제 ───────────────────────────────────────────────
  console.log(`[2] 휴지통 ${trashed.length}건 영구 삭제${APPLY ? "" : " 예정"}`);
  let deleted = 0;
  let failed = 0;
  if (APPLY) {
    for (const c of trashed) {
      const result = await permanentlyDeleteRepairCase({
        id: c.id,
        expectedVersion: c.version,
        actorUserId: actor.id,
        reason: "제품 인수 단계에 갇힌 데모 데이터 정리(2026-08-18)",
      });
      if (result.ok) deleted++;
      else {
        failed++;
        console.log(`    실패 ${c.intakeNumber}: ${result.code}`);
      }
    }
    console.log(`    → 삭제 ${deleted}건, 실패 ${failed}건`);
  }

  // ── 3. 단계 비활성 ────────────────────────────────────────────────────
  const stillThere = await db
    .select({ id: repairCases.id })
    .from(repairCases)
    .innerJoin(workflowSteps, eq(workflowSteps.id, repairCases.currentWorkflowStepId))
    .where(eq(workflowSteps.key, STRANDED_STEP_KEY));
  console.log(`[3] 비활성 처리 전 잔여 접수 건: ${stillThere.length}`);
  if (APPLY && stillThere.length > 0) {
    throw new Error("아직 이 단계에 접수 건이 남아 있어 비활성으로 바꾸지 않습니다.");
  }
  if (APPLY) {
    const result = await db
      .update(workflowSteps)
      .set({ isActive: false, updatedAt: new Date() })
      .where(and(eq(workflowSteps.key, STRANDED_STEP_KEY), eq(workflowSteps.isActive, true)))
      .returning({ id: workflowSteps.id });
    console.log(`    → ${result.length}개 단계를 비활성으로 변경`);
  } else {
    const target = await db
      .select({ id: workflowSteps.id })
      .from(workflowSteps)
      .where(and(eq(workflowSteps.key, STRANDED_STEP_KEY), eq(workflowSteps.isActive, true)));
    console.log(`    → ${target.length}개 단계 비활성 예정`);
  }

  console.log("\n=== 결과 ===");
  const summary = await db.execute(sql`
    select
      (select count(*)::int from repair_cases rc join workflow_steps ws on ws.id = rc.current_workflow_step_id
        where ws.key = ${STRANDED_STEP_KEY}) as stranded_cases,
      (select count(*)::int from workflow_steps where key = ${STRANDED_STEP_KEY} and is_active) as active_steps,
      (select count(*)::int from repair_cases where is_deleted) as trashed_cases,
      (select count(*)::int from repair_cases where not is_deleted) as active_cases
  `);
  console.log(JSON.stringify(summary[0]));

  await pgClient.end({ timeout: 5 });
}

main();
