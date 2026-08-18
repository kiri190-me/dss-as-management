import "../../../scripts/load-env";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db, pgClient } from "./connection";
import { workflowSteps, workflowTemplates, workflowTransitions, workflowVersions } from "./schema";
import { TRANSITION_DEFINITIONS } from "@/lib/domain/local/workflow/transition-definitions";
import { getStepCategory } from "@/lib/domain/local/workflow/step-category";
import { getStepStatus } from "@/lib/domain/local/workflow/step-status-map";
import type { WorkflowType } from "@/lib/domain/types";

/**
 * ============================================================================
 * Phase 1 안전망 — DB의 워크플로 규칙이 TypeScript 표와 1:1인지 지킨다
 * ============================================================================
 * Phase 1에서 규칙을 DB로 옮겼지만 런타임은 아직 TS 표를 읽는다. 즉 같은
 * 규칙이 두 곳에 존재하며, 한쪽만 고치면 아무 에러 없이 조용히 갈라진다.
 * 그 상태로 Phase 2(런타임을 DB로 전환)에 들어가면 "왜 갑자기 이 전이가
 * 막히지"를 런타임에서 디버깅하게 된다.
 *
 * 이 파일이 그 갈라짐을 커밋 시점에 잡는다. 읽기 전용이며 아무것도 쓰지
 * 않는다 — 실패하면 둘 중 하나를 고쳐야 한다는 뜻이다:
 *   - TS 표를 고쳤다면 scripts/migrate-workflow-rules-to-db.ts를 다시 실행
 *   - DB를 직접 고쳤다면 그 변경이 의도된 것인지 재확인
 *
 * Phase 2에서 런타임이 DB만 보게 되면 TS 표는 로컬 데모 전용 기본값으로
 * 역할이 바뀌고, 그때 이 테스트의 의미도 함께 재정의해야 한다.
 * ============================================================================
 */

type StepRow = {
  id: string;
  key: string;
  workflowType: string;
  versionId: string;
  repairStatus: string | null;
  category: string | null;
};

let currentSteps: StepRow[] = [];
let allSteps: StepRow[] = [];
let currentTypes = new Set<string>();

before(async () => {
  allSteps = (await db
    .select({
      id: workflowSteps.id,
      key: workflowSteps.key,
      workflowType: workflowTemplates.code,
      versionId: workflowVersions.id,
      repairStatus: workflowSteps.repairStatus,
      category: workflowSteps.category,
      isCurrent: workflowVersions.isCurrent,
    })
    .from(workflowSteps)
    .innerJoin(workflowVersions, eq(workflowVersions.id, workflowSteps.workflowVersionId))
    .innerJoin(
      workflowTemplates,
      eq(workflowTemplates.id, workflowVersions.workflowTemplateId)
    )) as (StepRow & { isCurrent: boolean })[];

  currentSteps = allSteps.filter((s) => (s as StepRow & { isCurrent: boolean }).isCurrent);
  currentTypes = new Set(currentSteps.map((s) => s.workflowType));
  assert.ok(allSteps.length > 0, "workflow_steps가 비어 있으면 이 테스트는 의미가 없다");
});

after(async () => {
  await pgClient.end({ timeout: 5 });
});

describe("workflow rules parity (DB ↔ transition-definitions.ts)", () => {
  test("모든 단계의 repair_status가 step-status-map.ts와 일치한다", () => {
    const wrong: string[] = [];
    for (const step of allSteps) {
      const expected = getStepStatus(step.workflowType as WorkflowType, step.key) ?? null;
      if (step.repairStatus !== expected) {
        wrong.push(`${step.workflowType}/${step.key}: DB=${step.repairStatus} 표=${expected}`);
      }
    }
    assert.deepEqual(wrong, [], "이관 스크립트를 다시 실행해야 할 수 있다");
  });

  test("repair_status가 비어 있는 단계가 없다", () => {
    // 비어 있으면 그 단계에 놓인 접수 건은 목록·대시보드를 읽을 때마다
    // UnmappedWorkflowStepError로 실패한다 — 화면 하나가 아니라 전체가 깨진다.
    const empty = allSteps.filter((s) => s.repairStatus === null);
    assert.deepEqual(
      empty.map((s) => `${s.workflowType}/${s.key}`),
      []
    );
  });

  test("모든 단계의 category가 step-category.ts와 일치한다 (분류 없음도 그대로)", () => {
    const wrong: string[] = [];
    for (const step of allSteps) {
      const expected = getStepCategory(step.workflowType as WorkflowType, step.key) ?? null;
      if (step.category !== expected) {
        wrong.push(`${step.workflowType}/${step.key}: DB=${step.category} 표=${expected}`);
      }
    }
    assert.deepEqual(wrong, []);
  });

  test("current 버전의 전이가 표와 개수·내용 모두 1:1이다", async () => {
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

    // current 버전이 없는 워크플로(예: 아카이브된 레거시 MATCHER)의 표 행은
    // 애초에 이관 대상이 아니다 — 그쪽에는 신규 접수가 배정되지 않는다.
    const expected = TRANSITION_DEFINITIONS.filter((d) => currentTypes.has(d.workflowType));
    assert.equal(dbRows.length, expected.length, "행 수가 다르면 이관이 뒤처졌거나 DB에 군더더기가 있다");

    const stepIdToKey = new Map(allSteps.map((s) => [s.id, s.key]));
    const dbByKey = new Map(
      dbRows.map((r) => [`${r.workflowType}::${r.actionCode}::${stepIdToKey.get(r.fromStepId)}`, r])
    );

    const problems: string[] = [];
    for (const d of expected) {
      const key = `${d.workflowType}::${d.actionCode}::${d.fromStepKey}`;
      const row = dbByKey.get(key);
      if (!row) {
        problems.push(`${key} — DB에 없음`);
        continue;
      }
      if (stepIdToKey.get(row.toStepId) !== d.toStepKey) {
        problems.push(`${key} — 도착 단계 DB=${stepIdToKey.get(row.toStepId)} 표=${d.toStepKey}`);
      }
      const dbRoles = [...row.allowedRoles].sort().join(",");
      const tsRoles = [...d.allowedRoles].sort().join(",");
      if (dbRoles !== tsRoles) problems.push(`${key} — 허용 역할 DB=[${dbRoles}] 표=[${tsRoles}]`);
      if (row.requiresAssignedEngineer !== d.requiresAssignedEngineer) {
        problems.push(`${key} — 담당자 필수 DB=${row.requiresAssignedEngineer} 표=${d.requiresAssignedEngineer}`);
      }
      if (row.requiresReason !== d.requiresReason) {
        problems.push(`${key} — 사유 필수 DB=${row.requiresReason} 표=${d.requiresReason}`);
      }
      if ((row.requiredApprovalType ?? null) !== (d.requiredApprovalType ?? null)) {
        problems.push(`${key} — 승인 종류 DB=${row.requiredApprovalType} 표=${d.requiredApprovalType}`);
      }
    }
    assert.deepEqual(problems.slice(0, 20), [], `불일치 ${problems.length}건`);
  });

  test("전이의 출발·도착 단계가 모두 같은 워크플로 버전에 속한다", async () => {
    // FK만으로는 "다른 버전의 단계를 가리키는 전이"를 막지 못한다. 그런 행이
    // 생기면 접수 건이 자기 워크플로 밖의 단계로 이동해 버린다.
    const crossVersion = await db
      .select({ id: workflowTransitions.id })
      .from(workflowTransitions)
      .innerJoin(workflowSteps, eq(workflowSteps.id, workflowTransitions.fromStepId))
      .where(eq(workflowSteps.workflowVersionId, workflowTransitions.workflowVersionId));
    const total = await db.select({ id: workflowTransitions.id }).from(workflowTransitions);
    assert.equal(crossVersion.length, total.length, "from_step이 다른 버전에 속한 전이가 있다");
  });
});
