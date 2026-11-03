import "server-only";

import { and, desc, eq, inArray } from "drizzle-orm";
import type { db } from "../client";
import { repairCases, statusChangeHistories, workflowSteps } from "../schema";
import { loadWorkflowRules } from "../queries/workflow-rules";
import {
  checkShipmentApprovalChainCompleted,
  decideShipmentWaitingAutoAdvance,
  type ShipmentApprovalOutcome,
  type ShipmentWaitingAutoAdvanceDecision,
} from "@/lib/domain/shipment-waiting-auto-advance";

/**
 * ============================================================================
 * 출하 승인이 모두 끝나면 단계를 [출하 대기]로 — **옮기는 쪽** (2026-11-03)
 * ============================================================================
 * 「옮기는가, 아니면 왜 안 옮기는가」는 여기서 한 줄도 정하지 않는다. 그 규칙은
 * domain/shipment-waiting-auto-advance.ts 하나에 있고, 이 파일은 그 판정에 필요한
 * 사실을 읽어다 주고 답이 「옮긴다」일 때 실제로 쓰기만 한다.
 *
 * ── 🔴 **버전(repair_cases.version)을 올리지 않는다** ───────────────────
 * 이 조각에서 가장 중요한 줄이다. 승인은 요청 당시의 version 에 묶여 있고
 * (repair_case_approvals.repair_case_version_at_request), 출하 완료 전이는 그
 * version 이 **지금 값과 같을 때만** 통과한다(mutations/workflow-transitions.ts 의
 * 승인 검사 · queries/repair-case-approvals.ts 의 resolveApprovalValidity).
 *
 * 그래서 여기서 version 을 올리면 **방금 끝난 그 최종 출하 승인이 그 자리에서
 * 무효(APPROVAL_STALE)가 된다.** 자동 전환이 호의로 한 일 때문에 [출하 완료] 가
 * 영영 막히고, 사람은 검수 승인부터 전부 다시 받아야 한다. 같은 함정이 이미
 * 문서로 적혀 있다 — local/workflow/shipment-approval-checklist.ts 의 「승인 사이에
 * 단계를 진행하지 말 것」.
 *
 * 🔴 **그 대신 낙관적 잠금을 쓰지 않는다** — 쓸 수 없다. 그래서 아래 UPDATE 는
 * `current_workflow_step_id` 가 **읽을 때 본 그 단계 그대로일 때만** 바뀌도록
 * 조건을 건다. 그 사이 누가 단계를 옮겼으면 0행이 돌아오고, 그때는 아무것도 하지
 * 않는다(이력도 남기지 않는다). 버전을 올리지 않아 생길 수 있는 어긋남은
 * 「낡은 화면이 [다음 단계] 를 눌렀을 때」인데, 전이는 언제나 **지금 단계를 다시
 * 읽어** 규칙을 찾으므로 엉뚱한 전이가 성립하지 않는다.
 *
 * ── 🔴 이력은 남기되 사람이 한 것처럼 적지 않는다 ───────────────────────
 * action_type 은 **새 값을 만들지 않고** STEP_ADVANCED 를 쓴다. 그 칸은 enum 이라
 * 값을 늘리려면 마이그레이션이 필요하고, 뜻이 맞는 값이 이미 있다(정규 진행 전이를
 * 그대로 탄 것이다). 평범한 진행과 가르는 열쇠는 `metadata` 에 붙이는 표시이며,
 * 이것은 출하 완료 되돌리기가 쓰는 방식과 **같은 관례**다
 * (workflow-transitions.ts 의 SHIPMENT_COMPLETION_REVERT_METADATA).
 *
 * 🔴 `actor_user_id` 는 NOT NULL 이라 비울 수 없다 — 마지막으로 결재를 누른 사람이
 * 들어간다. 그 사람이 단계를 옮긴 것처럼 읽히면 안 되므로 `reason` 에 **시스템이
 * 옮겼다는 문장**을 함께 남긴다. 워크플로 이력 화면이 그 문장을 그대로 그린다
 * (components/repair-cases/workflow/DatabaseWorkflowHistoryList.tsx).
 * ============================================================================
 */

/**
 * 트랜잭션 핸들과 최상위 db 양쪽을 받는다 — queries/workflow-rules.ts 와 같은 모양
 * 이다. 실제로는 결재 트랜잭션 안에서만 불린다.
 */
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0] | typeof db;

/**
 * 이력에 붙는 표시. 🔴 이력을 읽는 쪽이 **사람이 누른 진행과 가르는 열쇠**다 —
 * action_type 은 둘 다 STEP_ADVANCED 라 그것만으로는 구분되지 않는다. 글자를
 * 비교하는 대신 이 상수를 가져다 쓴다.
 */
export const SHIPMENT_WAITING_AUTO_ADVANCE_METADATA = {
  autoAdvancedOnShipmentApproval: true,
} as const;

/**
 * 이력에 남는 사유 문장. 화면이 이 글자를 그대로 보여 준다(파일 머리말) —
 * 「처리자」 칸에는 마지막 결재자의 이름이 서 있으므로, 이 한 줄이 없으면 그 사람이
 * 손으로 단계를 옮긴 것으로 읽힌다.
 */
export const SHIPMENT_WAITING_AUTO_ADVANCE_REASON =
  "최종 출하 승인이 모두 끝나 시스템이 [출하 대기]로 옮겼습니다.";

export type AutoAdvanceToShipmentWaitingInput = ShipmentApprovalOutcome & {
  repairCaseId: string;
  /** 마지막으로 결재를 누른 사람. 이력의 actor_user_id 로 들어간다. */
  actorUserId: string;
};

/**
 * 결재가 **커밋되기 전 같은 트랜잭션 안에서** 불린다. 결재와 단계 이동이 한 덩어리
 * 라야 「승인은 됐는데 단계는 안 움직였다」가 존재할 수 없다.
 *
 * 🔴 던지지 않고 **결정을 돌려준다.** 부르는 쪽은 그 값을 쓰지 않아도 되지만,
 * 시험이 「왜 안 옮겼나」를 값으로 확인할 수 있어야 한다.
 */
export async function autoAdvanceToShipmentWaitingInTx(
  tx: Tx,
  input: AutoAdvanceToShipmentWaitingInput
): Promise<ShipmentWaitingAutoAdvanceDecision> {
  // 🔴 접수 건을 읽기 전에 결재 쪽부터 가린다 — 수리 검수 승인과 사슬 중간 결재는
  // 여기서 끝나고, 아래 질의 셋이 아예 일어나지 않는다.
  const chain = checkShipmentApprovalChainCompleted(input);
  if (!chain.completed) return { move: false, reason: chain.reason };

  const [current] = await tx
    .select({
      workflowVersionId: repairCases.workflowVersionId,
      currentWorkflowStepId: repairCases.currentWorkflowStepId,
      currentStepKey: workflowSteps.key,
      isLocked: repairCases.isLocked,
    })
    .from(repairCases)
    .innerJoin(workflowSteps, eq(repairCases.currentWorkflowStepId, workflowSteps.id))
    .where(and(eq(repairCases.id, input.repairCaseId), eq(repairCases.isDeleted, false)));

  // 건이 없거나 지워졌으면 옮길 것이 없다. 결재 쪽은 이미 같은 건을 찾아 둔 뒤라
  // 정상 경로로는 오지 않는다.
  if (!current) return { move: false, reason: "NOT_AT_PRECEDING_STEP" };

  const rules = await loadWorkflowRules(tx, current.workflowVersionId);
  // 규칙을 못 읽으면 갈 길을 지어내지 않는다 — 결재는 그대로 끝나고 단계만 남는다.
  if (!rules) return { move: false, reason: "NO_SHIPMENT_WAITING_STEP" };

  const decision = decideShipmentWaitingAutoAdvance({
    ...input,
    isCaseLocked: current.isLocked,
    isOnHold: await readIsOnHold(tx, input.repairCaseId),
    currentStepKey: current.currentStepKey,
    transitions: rules.transitions,
  });
  if (!decision.move) return decision;

  const toStep = rules.stepByKey.get(decision.toStepKey);
  // 전이가 가리키는 단계를 못 찾는 경우는 FK 가 막아 정상적으로는 없다.
  if (!toStep) return { move: false, reason: "NO_SHIPMENT_WAITING_STEP" };

  // 🔴 version 은 건드리지 않는다(파일 머리말). 대신 **읽을 때 본 그 단계일 때만**
  // 바꾼다 — 그 사이 누가 옮겼으면 0행이고, 그때는 이력도 남기지 않는다.
  const updated = await tx
    .update(repairCases)
    .set({ currentWorkflowStepId: toStep.id, updatedAt: new Date() })
    .where(
      and(
        eq(repairCases.id, input.repairCaseId),
        eq(repairCases.currentWorkflowStepId, current.currentWorkflowStepId)
      )
    )
    .returning({ id: repairCases.id });
  if (updated.length === 0) return { move: false, reason: "NOT_AT_PRECEDING_STEP" };

  await tx.insert(statusChangeHistories).values({
    repairCaseId: input.repairCaseId,
    workflowVersionId: current.workflowVersionId,
    fromStepId: current.currentWorkflowStepId,
    toStepId: toStep.id,
    actionType: "STEP_ADVANCED",
    actorUserId: input.actorUserId,
    reason: SHIPMENT_WAITING_AUTO_ADVANCE_REASON,
    metadata: SHIPMENT_WAITING_AUTO_ADVANCE_METADATA,
  });

  return decision;
}

/**
 * 지금 보류 중인가 — 전용 칸이 없어 사건 기록에서 되살린다.
 *
 * ⚠️ 같은 읽기가 mutations/workflow-transitions.ts 안에 **둘** 더 있다
 * (transitionWorkflow 본문 · readHoldStateForRevert). 그쪽 두 벌은 HoldState 통째를
 * 만들어야 하고 이쪽은 불리언 하나면 되는데다, 셋을 합치려면 결재 트랜잭션이 전이
 * 쪽 모듈을 물게 된다. 합칠 때는 **셋을 함께** 본다.
 */
async function readIsOnHold(tx: Tx, repairCaseId: string): Promise<boolean> {
  const [latestHold] = await tx
    .select({ actionType: statusChangeHistories.actionType })
    .from(statusChangeHistories)
    .where(
      and(
        eq(statusChangeHistories.repairCaseId, repairCaseId),
        inArray(statusChangeHistories.actionType, ["HOLD_STARTED", "HOLD_RELEASED"])
      )
    )
    .orderBy(desc(statusChangeHistories.createdAt))
    .limit(1);
  return latestHold?.actionType === "HOLD_STARTED";
}
