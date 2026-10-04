import "server-only";

import { and, eq } from "drizzle-orm";
import { db } from "../client";
import { repairCases, workflowSteps } from "../schema";
import {
  listManuallySelectableStepsFromRules,
  loadWorkflowRules,
} from "../queries/workflow-rules";
import { transitionWorkflow, type TransitionMutationResult } from "./workflow-transitions";
import { pickNearestStepForWeeklyReportStatus } from "@/lib/domain/weekly-report-status-step";
import { weeklyReportStatusLabels, type WeeklyReportStatus } from "@/lib/domain/weekly-report";

/**
 * ============================================================================
 * 주간보고 상세표의 `현 상태` 를 바꾼다 — **분류 하나를 받아 단계로 옮긴다**
 * ============================================================================
 * 화면이 보내는 것은 단계 키가 아니라 **주간보고 분류 6칸 중 하나**다. 그 칸은
 * 저장되는 값이 아니라 지금 서 있는 단계에서 계산되는 값이라(domain/
 * weekly-report.ts), 바꾸려면 **그 분류로 계산되는 단계로 옮기는 수밖에** 없다.
 * 이 파일이 하는 일은 딱 그 번역이다: 분류 → 갈 단계.
 *
 * ── 🔴 쓰기는 한 글자도 하지 않는다 ─────────────────────────────────────
 * 여기에는 UPDATE 도 INSERT 도 없다. 읽어서 갈 단계를 정한 뒤
 * **transitionWorkflow(... "STEP_SET_MANUALLY" ...)** 에 그대로 넘긴다 — 작업내용
 * 탭의 「현재 단계 직접 변경」이 타는 바로 그 길이다. 권한(checkManualStepSet-
 * Eligibility) · 보류 중 여부 · 출하 완료 잠금 · 유무상 미확정 · 버전 충돌 ·
 * 승인 게이트 단계 재검증 · status_change_histories 기록이 전부 거기 있고,
 * 비슷한 것을 여기 새로 짜면 규칙이 두 벌이 되어 한쪽만 고쳐지는 날이 온다.
 *
 * 사유는 **null** 로 넘긴다. 단계 직접 변경의 사유는 2026-10-04 사용자 결정으로
 * 선택 입력이 되었고(commit 96aa5f5), 이 화면에는 사유를 적을 자리가 없다.
 * 사유가 없어도 누가·언제·어느 단계에서 어느 단계로 옮겼는지는 그대로 남는다.
 *
 * ── 어느 단계로 가는가 ──────────────────────────────────────────────────
 * **지금 단계에서 step_order 가 가장 가까운 단계**다(사용자 결정 2026-10-04).
 * 규칙과 그 까닭은 domain/weekly-report-status-step.ts 에 있고, 여기서는 그
 * 순수 함수를 부르기만 한다 — 화면 없이 시험할 수 있는 자리에 두기 위해서다.
 *
 * 후보는 **listManuallySelectableStepsFromRules 가 추린 것**이다. 승인 게이트가
 * 걸린 단계를 빼 주는 함수이고, 이것을 안 쓰면 '출하 대기'를 골라 출하 승인을
 * 건너뛴 단계에 가 앉을 수 있다. 같은 목록을 transitionWorkflow 가 트랜잭션
 * 안에서 **다시** 평가하므로, 여기서 고른 값이 낡았더라도 실제로 통과하지는
 * 못한다(그래서 이 읽기는 트랜잭션 밖이어도 안전하다).
 *
 * ── 갈 곳이 없으면 분명히 말한다 ────────────────────────────────────────
 * 그 워크플로에 해당 분류의 단계가 하나도 없을 수 있다. 조용히 아무 일도 하지
 * 않으면 사람이 두 번 세 번 누르므로, 어느 분류가 없는지 적어 돌려준다.
 * ============================================================================
 */
export async function setWeeklyReportStatus(
  repairCaseId: string,
  expectedVersion: number,
  targetStatus: WeeklyReportStatus,
  actorUserId: string
): Promise<TransitionMutationResult> {
  // 지금 서 있는 단계의 **순서**가 거리의 기준이다. 상태는 보지 않는다 —
  // 분류 안 된 건(상태가 비어 그 단계가 rules.steps 에 들어오지 못하는 건)도
  // 고칠 수 있어야 하고, 오히려 고쳐야 할 줄이다.
  const [current] = await db
    .select({
      workflowVersionId: repairCases.workflowVersionId,
      currentStepOrder: workflowSteps.stepOrder,
    })
    .from(repairCases)
    .innerJoin(workflowSteps, eq(repairCases.currentWorkflowStepId, workflowSteps.id))
    .where(and(eq(repairCases.id, repairCaseId), eq(repairCases.isDeleted, false)));

  if (!current) {
    return { ok: false, code: "NOT_FOUND", message: "해당 접수 건을 찾을 수 없습니다." };
  }

  const rules = await loadWorkflowRules(db, current.workflowVersionId);
  if (!rules) {
    return {
      ok: false,
      code: "INVALID_TRANSITION",
      message: "이 접수 건의 워크플로 규칙을 확인할 수 없습니다.",
    };
  }

  const target = pickNearestStepForWeeklyReportStatus(
    listManuallySelectableStepsFromRules(rules),
    current.currentStepOrder,
    targetStatus
  );
  if (!target) {
    return {
      ok: false,
      code: "INVALID_TRANSITION",
      message: `이 워크플로에는 '${weeklyReportStatusLabels[targetStatus]}'에 해당하는 단계가 없습니다.`,
    };
  }

  return transitionWorkflow(
    repairCaseId,
    expectedVersion,
    "STEP_SET_MANUALLY",
    actorUserId,
    // 사유는 선택 입력이고 이 화면에는 적을 자리가 없다(파일 헤더).
    null,
    target.key
  );
}
