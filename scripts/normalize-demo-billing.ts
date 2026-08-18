import "./load-env";

import { and, eq, isNull, sql } from "drizzle-orm";
import { db, pgClient } from "../src/lib/db/connection";
import {
  repairCases,
  users,
  workflowSteps,
  workflowTemplates,
  workflowVersions,
} from "../src/lib/db/schema";
import { insertAuditLog } from "../src/lib/db/mutations/audit-logs";
import { resolveRepairCaseBillingDecision } from "../src/lib/db/mutations/repair-case-billing-decision";

/**
 * ============================================================================
 * 개발 DB 데모 데이터의 유·무상 상태 정리 (2026-08-18 사용자 승인)
 * ============================================================================
 * 세 가지를 한다.
 *
 *  1. billing_type이 NULL인 레거시 행을 워크플로 종류에 맞춰 채운다.
 *     NULL은 "추후결정"과도 다른 제3의 상태였고, 진행 게이트가
 *     PENDING_DECISION만 검사하므로 **확정된 것처럼 조용히 통과**하고 있었다.
 *     화면에는 유·무상 칸이 비어 보인다. 변경 이력을 남기지 않는 이유는 이것이
 *     "값의 변경"이 아니라 처음부터 있었어야 할 값의 보정이기 때문이다
 *     (이력 테이블의 previous_billing_type은 NOT NULL이라 애초에 기록할 수도 없다).
 *
 *  2. DEMO 시드의 추후결정 건 대부분을 확정한다. 종류당 KEEP_PENDING_PER_KIND
 *     건만 추후결정으로 남긴다 — 전부 없애면 추후결정 워크플로와
 *     BILLING_DECISION_REQUIRED 가드를 시연할 수 없게 된다. 확정은 직접 UPDATE가
 *     아니라 실제 mutation을 호출한다. 그래야 워크플로 재배정·변경 이력·감사
 *     로그가 앱이 만든 것과 동일하게 남는다.
 *
 *  3. 레거시 MATCHER 워크플로를 비운다. 남은 접수 건을 PAID_MATCHER의 같은 key
 *     단계로 옮기고(19단계가 모두 대응됨을 사전 확인), 그 버전을 ARCHIVED로
 *     내려 목록·편집기·필터에서 사라지게 한다. 템플릿 행 자체는 지우지 않는다 —
 *     과거 이력이 FK로 참조하므로 삭제하면 이력이 깨진다.
 *
 * 멱등하다. 이미 정리된 DB에서 다시 실행하면 아무것도 바꾸지 않는다.
 * APPLY=1 환경변수가 없으면 계획만 출력하고 쓰기는 하지 않는다.
 * ============================================================================
 */

const KEEP_PENDING_PER_KIND = 3;
const APPLY = process.env.APPLY === "1";

/** 확정 값을 순환 배분한다. 일부유상이 데모 데이터에 하나도 없어 함께 섞는다. */
const DECISION_CYCLE = ["PAID", "WARRANTY", "PARTIAL_PAID"] as const;

function log(...args: unknown[]) {
  console.log(...args);
}

async function main() {
  const identity = await db.execute(sql`select current_database() as name`);
  const dbName = (identity[0] as { name?: string } | undefined)?.name;
  if (dbName !== "dss_as_dev") {
    throw new Error(`DEV safety gate failed: expected dss_as_dev, connected to ${String(dbName)}`);
  }
  log(`대상 DB: ${dbName} / 모드: ${APPLY ? "APPLY (쓰기)" : "DRY RUN (조회만)"}\n`);

  const [actor] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, "SUPER_ADMIN"), eq(users.approvalStatus, "APPROVED"), eq(users.isDeleted, false)))
    .limit(1);
  if (!actor) throw new Error("승인된 SUPER_ADMIN 사용자가 필요합니다.");

  // ── 1. NULL 유·무상 보정 ───────────────────────────────────────────────
  const nullRows = await db
    .select({ id: repairCases.id, workflowType: workflowTemplates.code })
    .from(repairCases)
    .innerJoin(workflowVersions, eq(workflowVersions.id, repairCases.workflowVersionId))
    .innerJoin(workflowTemplates, eq(workflowTemplates.id, workflowVersions.workflowTemplateId))
    .where(isNull(repairCases.billingType));

  log(`[1] billing_type NULL: ${nullRows.length}건`);
  const backfill = nullRows.map((row) => ({
    id: row.id,
    // 워크플로가 이미 유·무상을 말해 준다. 레거시 MATCHER는 유·무상 개념이
    // 생기기 전 것이라 유상으로 둔다(사용자 결정).
    billingType: row.workflowType.startsWith("WARRANTY_") ? ("WARRANTY" as const) : ("PAID" as const),
  }));
  for (const item of backfill) {
    if (APPLY) {
      await db.update(repairCases).set({ billingType: item.billingType }).where(eq(repairCases.id, item.id));
    }
  }
  log(
    `    → 유상 ${backfill.filter((b) => b.billingType === "PAID").length}건, ` +
      `무상 ${backfill.filter((b) => b.billingType === "WARRANTY").length}건 보정${APPLY ? " 완료" : " 예정"}\n`
  );

  // ── 2. 추후결정 확정 ──────────────────────────────────────────────────
  const pendingRows = await db
    .select({
      id: repairCases.id,
      version: repairCases.version,
      intakeNumber: repairCases.intakeNumber,
      workflowType: workflowTemplates.code,
      isDeleted: repairCases.isDeleted,
    })
    .from(repairCases)
    .innerJoin(workflowVersions, eq(workflowVersions.id, repairCases.workflowVersionId))
    .innerJoin(workflowTemplates, eq(workflowTemplates.id, workflowVersions.workflowTemplateId))
    .where(eq(repairCases.billingType, "PENDING_DECISION"))
    .orderBy(repairCases.intakeNumber);

  const byKind = new Map<string, typeof pendingRows>();
  for (const row of pendingRows) {
    byKind.set(row.workflowType, [...(byKind.get(row.workflowType) ?? []), row]);
  }

  log(`[2] 추후결정: ${pendingRows.length}건 (종류당 ${KEEP_PENDING_PER_KIND}건은 남김)`);
  let decided = 0;
  let failed = 0;
  let cycle = 0;
  for (const [kind, rows] of byKind) {
    // 삭제된 행은 mutation이 찾지 못하므로 애초에 대상에서 제외한다.
    const targets = rows.filter((r) => !r.isDeleted).slice(KEEP_PENDING_PER_KIND);
    log(`    ${kind}: 전체 ${rows.length} → 확정 대상 ${targets.length}`);
    for (const row of targets) {
      const nextBillingType = DECISION_CYCLE[cycle++ % DECISION_CYCLE.length];
      if (!APPLY) continue;
      const result = await resolveRepairCaseBillingDecision({
        repairCaseId: row.id,
        expectedVersion: row.version,
        nextBillingType,
        actorUserId: actor.id,
      });
      if (result.ok) decided++;
      else {
        failed++;
        log(`      실패 ${row.intakeNumber}: ${result.code} ${result.message}`);
      }
    }
  }
  if (APPLY) log(`    → 확정 ${decided}건, 실패 ${failed}건\n`);
  else log("");

  // ── 3. 레거시 MATCHER 비우기 ──────────────────────────────────────────
  const [legacyVersion] = await db
    .select({ id: workflowVersions.id })
    .from(workflowVersions)
    .innerJoin(workflowTemplates, eq(workflowTemplates.id, workflowVersions.workflowTemplateId))
    .where(and(eq(workflowTemplates.code, "MATCHER"), eq(workflowVersions.isCurrent, true)));

  if (!legacyVersion) {
    log("[3] 레거시 MATCHER: 이미 정리됨 (current 버전 없음)");
  } else {
    const [targetVersion] = await db
      .select({ id: workflowVersions.id })
      .from(workflowVersions)
      .innerJoin(workflowTemplates, eq(workflowTemplates.id, workflowVersions.workflowTemplateId))
      .where(
        and(
          eq(workflowTemplates.code, "PAID_MATCHER"),
          eq(workflowVersions.status, "PUBLISHED"),
          eq(workflowVersions.isCurrent, true)
        )
      );
    if (!targetVersion) throw new Error("PAID_MATCHER의 current 버전을 찾을 수 없습니다.");

    const targetSteps = await db
      .select({ id: workflowSteps.id, key: workflowSteps.key })
      .from(workflowSteps)
      .where(eq(workflowSteps.workflowVersionId, targetVersion.id));
    const targetByKey = new Map(targetSteps.map((s) => [s.key, s.id]));

    const legacyCases = await db
      .select({ id: repairCases.id, stepKey: workflowSteps.key, stepId: repairCases.currentWorkflowStepId })
      .from(repairCases)
      .innerJoin(workflowSteps, eq(workflowSteps.id, repairCases.currentWorkflowStepId))
      .where(eq(repairCases.workflowVersionId, legacyVersion.id));

    const unmapped = legacyCases.filter((c) => !targetByKey.has(c.stepKey));
    log(`[3] 레거시 MATCHER: 접수 건 ${legacyCases.length}건, 대응 단계 없는 건 ${unmapped.length}건`);
    if (unmapped.length > 0) {
      throw new Error(`대응 단계가 없는 접수 건이 있어 중단합니다: ${unmapped.map((u) => u.stepKey).join(", ")}`);
    }

    if (APPLY) {
      for (const c of legacyCases) {
        const nextStepId = targetByKey.get(c.stepKey)!;
        await db
          .update(repairCases)
          .set({
            workflowVersionId: targetVersion.id,
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
            previousValue: { workflowVersionId: legacyVersion.id, workflowStepId: c.stepId },
            newValue: { workflowVersionId: targetVersion.id, workflowStepId: nextStepId },
          })
        );
      }
      // 템플릿 행은 지우지 않는다(이력이 FK로 참조). 버전을 ARCHIVED로 내려
      // 어떤 신규 접수도 이 워크플로에 배정되지 않게 한다.
      await db
        .update(workflowVersions)
        .set({ status: "ARCHIVED", isCurrent: false })
        .where(eq(workflowVersions.id, legacyVersion.id));
      log(`    → ${legacyCases.length}건 PAID_MATCHER로 이관, 레거시 버전 ARCHIVED 처리 완료`);
    } else {
      log(`    → ${legacyCases.length}건 이관 + 버전 ARCHIVED 예정`);
    }
  }

  log("\n=== 결과 ===");
  const summary = await db.execute(sql`
    select coalesce(rc.billing_type::text, '(NULL)') as billing, count(*)::int as n
    from repair_cases rc group by 1 order by 2 desc
  `);
  log(JSON.stringify(summary));
  const legacyLeft = await db.execute(sql`
    select count(*)::int as n from repair_cases rc
    join workflow_versions wv on wv.id = rc.workflow_version_id
    join workflow_templates wt on wt.id = wv.workflow_template_id
    where wt.code = 'MATCHER'
  `);
  log(`레거시 MATCHER 잔여 접수 건: ${JSON.stringify(legacyLeft)}`);

  await pgClient.end({ timeout: 5 });
}

main();
