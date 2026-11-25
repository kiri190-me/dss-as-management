import "server-only";

import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { db } from "../client";
import { repairCases, statusChangeHistories, workflowSteps } from "../schema";
import { loadWorkflowRules } from "../queries/workflow-rules";
import {
  checkPoIssuedDateRecorded,
  decidePoIssuedRepairWaiting,
  PO_ISSUED_REPAIR_WAITING_METADATA,
  PO_ISSUED_REPAIR_WAITING_REASON,
  type PoIssuedDateChange,
  type PoIssuedRepairWaitingDecision,
} from "@/lib/domain/po-issued-repair-waiting";

/**
 * ============================================================================
 * PO발행일이 적히면 단계가 저절로 [수리 대기]로 — **옮기는 쪽** (2026-11-26)
 * ============================================================================
 * 「옮기는가, 아니면 왜 안 옮기는가」는 여기서 한 줄도 정하지 않는다. 그 규칙은
 * domain/po-issued-repair-waiting.ts 하나에 있고(갈 단계를 **상태 칸으로** 찾는
 * 까닭 · 되돌리지 않는 까닭 · 무상 갈래가 정상인 까닭 전부 그 머리말이다), 이
 * 파일은 그 판정에 필요한 사실을 읽어다 주고 답이 「옮긴다」일 때 실제로 쓰기만
 * 한다.
 *
 * ── 🔴 **부르는 자리는 둘뿐이다 — A/S 가 PO발행일을 쓰는 통로 전부** ─────
 *  · mutations/domestic-order-issue-dates.ts — 수리 건 상세 「내자 정리 발행일」
 *    (줄을 새로 만드는 길 · 있던 줄을 고치는 길 둘 다)
 *  · mutations/domestic-orders.ts — 내자 정리의 행 추가(createDomesticOrder)와
 *    줄 수정·칸 하나 인라인 편집(updateDomesticOrder). 🔵 그 둘은 같은
 *    toColumnValues 로 모이지만 **전 값을 아는 자리는 저마다 다르므로** 두 곳에서
 *    각각 부른다.
 *
 * 🔴 **PO 시스템(dss-po)에서 적으면 안 걸린다 — 2026-11-26 에 그렇게 정했다**
 * (사용자: 「A/S에서 적을 때만」). `domestic_orders` 는 두 사이트가 같은 DB 에서
 * 함께 쓰는 표라 그쪽에도 같은 칸을 쓰는 저장이 있는데, 다른 저장소라 이 훅이
 * 닿지 않는다. **결함이 아니다. 줍는 야간 작업표를 짜지 마라** — 자세한 까닭은
 * 도메인 파일 머리말에 있다.
 *
 * ── 🔴 **낙관적 잠금을 쓰지 않는다 — 대신 단계를 조건으로 건다** ─────────
 * 부르는 쪽이 들고 있는 version 은 **내자 줄의 것**이지 수리 건의 것이 아니다.
 * 그래서 아래 UPDATE 는 `current_workflow_step_id` 가 **읽을 때 본 그 단계
 * 그대로일 때만** 바뀌도록 조건을 건다. 그 사이 누가 단계를 옮겼으면 0행이
 * 돌아오고, 그때는 아무것도 하지 않는다(이력도 남기지 않는다). 이웃
 * mutations/shipment-waiting-auto-advance.ts 가 쓰는 그 방식 그대로다.
 *
 * ── 🔴 **`repair_cases.version` 은 올린다** ─────────────────────────────
 * 🔴 이웃(shipment-waiting-auto-advance.ts)은 **안 올린다.** 그쪽은 결재가
 * 요청 당시의 version 에 묶여 있어서, 올리면 방금 끝난 최종 출하 승인이 그
 * 자리에서 무효(APPROVAL_STALE)가 되기 때문이다. **여기는 그 사정이 없다** —
 * PO발행일을 적는 때는 결재선이 열리기 한참 전이고, 이 저장은 승인과 아무
 * 관계가 없다.
 *
 * 올리는 쪽을 고른 까닭은 반대편 선례가 말한다 — mutations/domestic-orders.ts 의
 * applyRepairCaseDueDateLink·applyRepairCaseShipmentLink 가 둘 다 올린다:
 * 「안 올리면 **열려 있던 수리 건 상세**가 낡은 version 으로 저장해도 통과하고,
 * 그 저장이 방금 맞춘 값을 제 옛 값으로 되돌린다」. 단계는 날짜보다 더 되돌아가면
 * 안 되는 값이다. 🔵 그리고 **내자 저장이 수리 건 version 을 올리는 일은 이미
 * 일어나고 있다**(그 두 묶기) — 새로 생기는 위험이 아니다.
 *
 * ── 🔴 이력은 남기되 사람이 한 것처럼 적지 않는다 ───────────────────────
 * `action_type` 은 **새 값을 만들지 않고** `STEP_SET_MANUALLY` 를 쓴다. 그 칸은
 * enum 이라 값을 늘리려면 마이그레이션이 필요하고, 뜻이 맞는 값이 이미 있다 —
 * 이 이동은 전이표를 타는 정규 진행이 아니라 **단계를 직접 지정하는 것**이라
 * `STEP_ADVANCED` 보다 이쪽이 정확하다(주간보고의 `현 상태` 바꾸기가 같은 값을
 * 쓴다 — mutations/weekly-report-status.ts).
 *
 * 평범한 직접 변경과 가르는 열쇠는 `metadata` 에 붙이는 표시이며, 이것은 출하
 * 완료 되돌리기·출하 대기 자동 전환이 쓰는 방식과 **같은 관례**다.
 *
 * 🔴 `actor_user_id` 는 NOT NULL 이라 비울 수 없다 — **그 날짜를 적은 사람**이
 * 들어간다. 그 사람이 단계를 옮긴 것처럼 읽히면 안 되므로 `reason` 에 시스템이
 * 옮겼다는 문장을 함께 남긴다(워크플로 이력 화면이 그 문장을 그대로 그린다 —
 * components/repair-cases/workflow/DatabaseWorkflowHistoryList.tsx).
 *
 * ── 🔴 잠그는 차례: **내자 줄 먼저, 수리 건 나중** ──────────────────────
 * 부르는 쪽이 내자 줄을 이미 쥐고 있고(고치기는 `FOR UPDATE`, 만들기는 방금
 * INSERT 한 줄), 그다음에 여기서 수리 건을 잠근다. 같은 트랜잭션의 이웃 묶기 둘도
 * 전부 그 차례라서, 한 저장 안에서 세 함수가 같은 행을 차례로 잡아도 교착이 나지
 * 않는다(같은 트랜잭션이 같은 행을 다시 잡는 것은 그냥 통과한다).
 * ============================================================================
 */

/**
 * 트랜잭션 핸들과 최상위 db 양쪽을 받는다 — queries/workflow-rules.ts 와 같은
 * 모양이다. 실제로는 내자 저장 트랜잭션 안에서만 불린다.
 */
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0] | typeof db;

export type ApplyPoIssuedRepairWaitingInput = PoIssuedDateChange & {
  /** 이 내자 줄이 가리키는 수리 건. 안 붙어 있으면(기타건) null 이고 할 일도 없다. */
  repairCaseId: string | null;
  /** 그 날짜를 적은 사람. 이력의 actor_user_id 로 들어간다(머리말). */
  actorUserId: string;
};

/**
 * 같은 트랜잭션 안에서 불린다 — 내자 줄 저장과 단계 이동이 한 덩어리라야
 * 「날짜는 적혔는데 단계는 안 움직였다」가 존재할 수 없다.
 *
 * 🔴 **던지지 않고 결정을 돌려준다.** 부르는 쪽 넷은 이 값을 쓰지 않지만(저장
 * 결과의 모양을 바꾸지 않으려고 — 화면은 이 일을 몰라도 된다), 시험이 「왜 안
 * 옮겼나」를 값으로 확인할 수 있어야 한다.
 */
export async function applyPoIssuedRepairWaitingInTx(
  tx: Tx,
  input: ApplyPoIssuedRepairWaitingInput
): Promise<PoIssuedRepairWaitingDecision> {
  // 🔴 접수 건을 읽기 전에 날짜부터 가린다 — 저장 대부분은 금액·비고처럼 다른
  //    칸을 고치는 일이라 여기서 끝나고, 그때는 아래 질의 셋이 아예 일어나지
  //    않는다. 이 한 줄이 「내자 정리의 모든 저장이 느려졌다」를 막는다.
  const recorded = checkPoIssuedDateRecorded(input);
  if (!recorded.recorded) return { move: false, reason: recorded.reason };

  // 수리 건이 안 붙은 줄(기타건)은 옮길 대상이 없다. 날짜 판정 **뒤**에 묻는 것은
  // 위와 같은 까닭이다 — 기타건의 평범한 저장도 질의를 일으키지 않는다.
  if (input.repairCaseId === null) return { move: false, reason: "NOT_LINKED" };

  // 🔴 수리 건을 잠근 채 읽는다 — 읽고 쓰는 사이에 남이 단계를 옮기면 낡은 값으로
  //    판정한 저장이 그 사람의 이동을 덮는다. 휴지통에 든 건은 건드리지 않는다
  //    (화면 어디에도 없는 건의 단계를 이 저장이 바꾸면 안 된다). 이웃 묶기 둘과
  //    같은 조건·같은 차례다.
  const [current] = await tx
    .select({
      workflowVersionId: repairCases.workflowVersionId,
      currentWorkflowStepId: repairCases.currentWorkflowStepId,
      currentStepOrder: workflowSteps.stepOrder,
      currentStepStatus: workflowSteps.repairStatus,
      isLocked: repairCases.isLocked,
    })
    .from(repairCases)
    .innerJoin(workflowSteps, eq(repairCases.currentWorkflowStepId, workflowSteps.id))
    .where(and(eq(repairCases.id, input.repairCaseId), eq(repairCases.isDeleted, false)))
    .for("update", { of: repairCases });
  if (!current) return { move: false, reason: "CASE_NOT_FOUND" };

  const rules = await loadWorkflowRules(tx, current.workflowVersionId);
  // 규칙을 못 읽으면 갈 길을 지어내지 않는다 — 내자 저장은 그대로 끝나고 단계만
  // 남는다. 「그 상태의 단계가 없다」와 같은 자리로 보낸다(둘 다 갈 곳이 없다).
  if (!rules) return { move: false, reason: "NO_WAITING_REPAIR_STEP" };

  const decision = decidePoIssuedRepairWaiting({
    ...input,
    isCaseLocked: current.isLocked,
    isOnHold: await readIsOnHold(tx, input.repairCaseId),
    currentStepOrder: current.currentStepOrder,
    currentStepStatus: current.currentStepStatus,
    // 🔴 **그 건이 지금 쓰는 버전**의 단계들이다. 운영에는 같은 템플릿의 버전이
    //    여럿 있고(건 전용 변주 포함) 단계도 그만큼 여러 벌이라, 버전으로 좁히지
    //    않으면 남의 버전 단계로 보내게 된다. loadWorkflowRules 가 이미 그 건의
    //    workflow_version_id 하나로만 읽는다.
    steps: rules.steps,
  });
  if (!decision.move) return decision;

  const toStep = rules.stepByKey.get(decision.toStepKey);
  // 방금 그 목록에서 고른 키라 정상적으로는 반드시 있다.
  if (!toStep) return { move: false, reason: "NO_WAITING_REPAIR_STEP" };

  // 🔴 **읽을 때 본 그 단계일 때만** 바꾼다 — 그 사이 누가 옮겼으면 0행이고,
  //    그때는 이력도 남기지 않는다(머리말).
  const updated = await tx
    .update(repairCases)
    .set({
      currentWorkflowStepId: toStep.id,
      // 🔴 version 을 올린다 — 까닭은 머리말에 있다(이웃과 반대 방향이다).
      version: sql`${repairCases.version} + 1`,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(repairCases.id, input.repairCaseId),
        eq(repairCases.currentWorkflowStepId, current.currentWorkflowStepId)
      )
    )
    .returning({ id: repairCases.id });
  if (updated.length === 0) return { move: false, reason: "ALREADY_PAST" };

  await tx.insert(statusChangeHistories).values({
    repairCaseId: input.repairCaseId,
    workflowVersionId: current.workflowVersionId,
    fromStepId: current.currentWorkflowStepId,
    toStepId: toStep.id,
    actionType: "STEP_SET_MANUALLY",
    actorUserId: input.actorUserId,
    reason: PO_ISSUED_REPAIR_WAITING_REASON,
    metadata: PO_ISSUED_REPAIR_WAITING_METADATA,
  });

  return decision;
}

/**
 * 지금 보류 중인가 — 전용 칸이 없어 사건 기록에서 되살린다.
 *
 * ⚠️ 같은 읽기가 이 저장소에 **셋** 더 있다(mutations/workflow-transitions.ts 안에
 * 둘 · mutations/shipment-waiting-auto-advance.ts 에 하나). 합치려면 **넷을 함께**
 * 본다 — 저쪽 둘은 HoldState 통째를 만들어야 하고 이쪽 둘은 불리언 하나면 된다.
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
