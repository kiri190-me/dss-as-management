import "../../../../scripts/load-env";

import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db, pgClient } from "../connection";
import { workflowTemplates, workflowVersions } from "../schema";
import { findTransitionInRules, loadWorkflowRules } from "./workflow-rules";
import { findTransitionDefinition } from "@/lib/domain/local/workflow/transition-definitions";
import { getStepCategory } from "@/lib/domain/local/workflow/step-category";
import { getStepStatus } from "@/lib/domain/local/workflow/step-status-map";
import { ACTION_CODES } from "@/lib/domain/local/workflow/workflow-types";
import type { WorkflowType } from "@/lib/domain/types";

/**
 * ============================================================================
 * Phase 2 동등성 — DB로 계산한 답이 TS 표로 계산한 답과 같은가
 * ============================================================================
 * Phase 2는 런타임의 규칙 출처를 TS 표에서 DB로 바꾸는 작업이고, 그 전환이
 * 안전하다는 근거는 오직 하나다: **모든 조합에서 두 답이 같다.**
 *
 * parity 테스트(workflow-rules-parity)가 "DB의 행이 표의 행과 1:1인가"를
 * 데이터 수준에서 본다면, 여기서는 그 위에 얹힌 **조회 결과**가 같은지를 본다
 * — 로더가 행을 TransitionDefinition으로 되살리는 과정(단계 id → key 복원,
 * direction 파생, toStatus 파생)에서 값이 틀어질 수 있기 때문이다.
 *
 * 전이가 없는 조합(대부분)도 함께 확인한다. "없어야 할 곳에 생긴 전이"는
 * "있어야 할 곳에 없는 전이"만큼 위험하다 — 없던 이동 경로가 열린다.
 * ============================================================================
 */

after(async () => {
  await pgClient.end({ timeout: 5 });
});

describe("loadWorkflowRules ↔ transition-definitions.ts 동등성", () => {
  test("모든 (워크플로, 단계, 액션) 조합에서 두 출처의 답이 완전히 같다", async () => {
    const versions = await db
      .select({ id: workflowVersions.id, workflowType: workflowTemplates.code })
      .from(workflowVersions)
      .innerJoin(workflowTemplates, eq(workflowTemplates.id, workflowVersions.workflowTemplateId))
      .where(eq(workflowVersions.isCurrent, true));
    assert.ok(versions.length > 0, "current 워크플로 버전이 있어야 한다");

    const problems: string[] = [];
    let compared = 0;

    for (const version of versions) {
      const rules = await loadWorkflowRules(db as never, version.id);
      assert.ok(rules, `${version.workflowType}: 규칙을 읽지 못했다`);
      if (!rules) continue;

      const workflowType = version.workflowType as WorkflowType;

      for (const step of rules.steps) {
        // 단계에서 파생되는 값도 같은지 함께 본다 — 상태가 틀리면 그 단계의
        // 접수 건이 목록에서 잘못된 상태로 보이거나 읽기가 실패한다.
        const expectedStatus = getStepStatus(workflowType, step.key);
        if (step.status !== expectedStatus) {
          problems.push(`${workflowType}/${step.key} 상태: DB=${step.status} 표=${expectedStatus}`);
        }
        const expectedCategory = getStepCategory(workflowType, step.key) ?? null;
        if (step.category !== expectedCategory) {
          problems.push(`${workflowType}/${step.key} 분류: DB=${step.category} 표=${expectedCategory}`);
        }

        for (const actionCode of ACTION_CODES) {
          const fromDb = findTransitionInRules(rules, actionCode, step.key);
          const fromTs = findTransitionDefinition(workflowType, actionCode, step.key);
          compared++;

          if (!fromTs && !fromDb) continue;
          const where = `${workflowType}/${step.key}/${actionCode}`;
          if (!fromTs) {
            problems.push(`${where} — 표에는 없는데 DB에 있다 (없던 이동 경로가 열린다)`);
            continue;
          }
          if (!fromDb) {
            problems.push(`${where} — 표에는 있는데 DB에 없다`);
            continue;
          }
          if (fromDb.toStepKey !== fromTs.toStepKey) {
            problems.push(`${where} 도착: DB=${fromDb.toStepKey} 표=${fromTs.toStepKey}`);
          }
          if (fromDb.toStatus !== fromTs.toStatus) {
            problems.push(`${where} 도착 상태: DB=${fromDb.toStatus} 표=${fromTs.toStatus}`);
          }
          if (fromDb.direction !== fromTs.direction) {
            problems.push(`${where} 방향: DB=${fromDb.direction} 표=${fromTs.direction}`);
          }
          const dbRoles = [...fromDb.allowedRoles].sort().join(",");
          const tsRoles = [...fromTs.allowedRoles].sort().join(",");
          if (dbRoles !== tsRoles) problems.push(`${where} 역할: DB=[${dbRoles}] 표=[${tsRoles}]`);
          if (fromDb.requiresAssignedEngineer !== fromTs.requiresAssignedEngineer) {
            problems.push(`${where} 담당자 필수: DB=${fromDb.requiresAssignedEngineer} 표=${fromTs.requiresAssignedEngineer}`);
          }
          if (fromDb.requiresReason !== fromTs.requiresReason) {
            problems.push(`${where} 사유 필수: DB=${fromDb.requiresReason} 표=${fromTs.requiresReason}`);
          }
          if ((fromDb.requiredApprovalType ?? null) !== (fromTs.requiredApprovalType ?? null)) {
            problems.push(`${where} 승인: DB=${fromDb.requiredApprovalType} 표=${fromTs.requiredApprovalType}`);
          }
        }
      }
    }

    assert.ok(compared > 0, "비교한 조합이 하나도 없으면 이 테스트는 의미가 없다");
    assert.deepEqual(problems.slice(0, 25), [], `불일치 ${problems.length}건 / 비교 ${compared}조합`);
  });

  test("없는 버전을 요청하면 null을 돌려준다 (빈 규칙으로 통과시키지 않는다)", async () => {
    // 빈 규칙 객체를 돌려주면 호출부는 "전이가 하나도 없는 워크플로"로
    // 오해하고 모든 이동을 조용히 막는다. 그건 오류로 드러나야 한다.
    const missing = await loadWorkflowRules(db as never, "00000000-0000-4000-8000-000000000000");
    assert.equal(missing, null);
  });
});
