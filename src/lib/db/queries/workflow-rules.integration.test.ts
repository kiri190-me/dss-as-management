import "../../../../scripts/load-env";

import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db, pgClient } from "../connection";
import { workflowSteps, workflowTemplates, workflowVersions } from "../schema";
import { findTransitionInRules, loadWorkflowRules } from "./workflow-rules";
import { findTransitionDefinition } from "@/lib/domain/local/workflow/transition-definitions";
import { getStepStatus } from "@/lib/domain/local/workflow/step-status-map";
import { ACTION_CODES } from "@/lib/domain/local/workflow/workflow-types";
import { WORKFLOW_TYPE_CODES, type WorkflowType } from "@/lib/domain/types";

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
 *
 * 🔴 **단계 분류(category)만 이 대조에서 빠졌다**(2026-11-03). 그 값은 운영에서
 * [워크플로 관리]로 바뀌므로 TS 표와 같을 이유가 없어졌다 — 대신 "로더가 DB 값을
 * 그대로 싣는가"를 아래 별도 시험이 본다. 까닭은 그 시험의 주석에 적었다.
 * ============================================================================
 */

after(async () => {
  await pgClient.end({ timeout: 5 });
});

describe("loadWorkflowRules ↔ transition-definitions.ts 동등성", () => {
  test("모든 (워크플로, 단계, 액션) 조합에서 두 출처의 답이 완전히 같다", async () => {
    const allVersions = await db
      .select({ id: workflowVersions.id, workflowType: workflowTemplates.code })
      .from(workflowVersions)
      .innerJoin(workflowTemplates, eq(workflowTemplates.id, workflowVersions.workflowTemplateId))
      .where(eq(workflowVersions.isCurrent, true));
    // 서비스가 더 이상 모르는 워크플로(레거시 MATCHER)는 TS 표에도 없으므로
    // 비교 대상이 아니다 — workflow-rules-parity.integration.test.ts와 같은 기준.
    const versions = allVersions.filter((v) => (WORKFLOW_TYPE_CODES as readonly string[]).includes(v.workflowType));
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
        // 🔴 분류(category)는 여기서 표와 맞대어 보지 않는다(2026-11-03).
        // [워크플로 관리]가 단계의 담당 분류를 고쳐 새 판으로 게시할 수 있게 된
        // 뒤로 **표가 아니라 DB 가 답**이고, 실제로 개발 DB 의 현행 판 98단계 중
        // 35개가 표와 다르다. 여기서 계속 1:1을 요구하면 「사람이 고친 것」이
        // 불일치로 보고된다. 대신 로더가 DB 값을 그대로 싣는지를 아래 별도
        // 시험이 본다 — 이 파일이 원래 지키려던 것(행 → 객체로 되살리는 과정에서
        // 값이 틀어지는 것)은 분류에서도 그대로 남는다.

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

  /**
   * 분류는 위 대조에서 빠졌다 — 표가 아니라 DB 가 답이기 때문이다. 그래서 그
   * 값을 지키는 자리가 여기다: **로더가 DB 행의 분류를 그대로 싣는가.**
   *
   * 이 값 하나로 화면이 두 가지를 만든다(DatabaseWorkflowControlPanel) —
   * 「담당: 관리자 또는 …」 글자와, 보류 시작/해제 단추의 표시 판정, 그리고
   * 2026-11-03 부터는 그 밑의 안내 배너까지. 로더가 분류를 null 로 떨어뜨리면
   * 화면은 「담당: 관리자(SUPER_ADMIN/ADMIN)」로 바뀌고 담당자가 제 단계에서
   * 보류를 못 하게 된다 — 서버는 DB 를 직접 읽으므로 허용하는데 단추만 잠긴다.
   * 오류가 나지 않는 종류의 고장이라 시험으로만 잡힌다.
   */
  test("로더가 단계의 category 를 DB 행 그대로 싣는다 (표가 아니라 DB 가 답이다)", async () => {
    // 위 시험과 같은 기준으로 고른다 — current 판, 서비스가 아는 워크플로만.
    const allVersions = await db
      .select({ id: workflowVersions.id, workflowType: workflowTemplates.code })
      .from(workflowVersions)
      .innerJoin(workflowTemplates, eq(workflowTemplates.id, workflowVersions.workflowTemplateId))
      .where(eq(workflowVersions.isCurrent, true));
    const versions = allVersions.filter((v) => (WORKFLOW_TYPE_CODES as readonly string[]).includes(v.workflowType));
    assert.ok(versions.length > 0, "current 워크플로 버전이 있어야 한다");

    const problems: string[] = [];
    let compared = 0;
    let withCategory = 0;

    for (const version of versions) {
      const rules = await loadWorkflowRules(db as never, version.id);
      assert.ok(rules, `${version.workflowType}: 규칙을 읽지 못했다`);
      if (!rules) continue;

      const rows = await db
        .select({ key: workflowSteps.key, category: workflowSteps.category })
        .from(workflowSteps)
        .where(eq(workflowSteps.workflowVersionId, version.id));
      const rawByKey = new Map(rows.map((row) => [row.key, row.category ?? null]));

      for (const step of rules.steps) {
        const raw = rawByKey.get(step.key);
        if (raw === undefined) {
          problems.push(`${version.workflowType}/${step.key} — 로더가 DB 에 없는 단계를 만들어 냈다`);
          continue;
        }
        compared++;
        if (raw !== null) withCategory++;
        if (step.category !== raw) {
          problems.push(`${version.workflowType}/${step.key} 분류: 로더=${step.category} DB행=${raw}`);
        }
      }
    }

    assert.ok(compared > 0, "비교한 단계가 하나도 없으면 이 시험은 의미가 없다");
    // 🔵 분류가 전부 비어 있으면 null 끼리 맞춰 보고 통과한다 — 그건 재는 게 아니다.
    assert.ok(withCategory > 0, `분류가 들어 있는 단계를 하나도 못 봤다 (비교 ${compared}개)`);
    assert.deepEqual(problems.slice(0, 25), [], `불일치 ${problems.length}건 / 비교 ${compared}단계`);
  });

  test("없는 버전을 요청하면 null을 돌려준다 (빈 규칙으로 통과시키지 않는다)", async () => {
    // 빈 규칙 객체를 돌려주면 호출부는 "전이가 하나도 없는 워크플로"로
    // 오해하고 모든 이동을 조용히 막는다. 그건 오류로 드러나야 한다.
    const missing = await loadWorkflowRules(db as never, "00000000-0000-4000-8000-000000000000");
    assert.equal(missing, null);
  });
});
