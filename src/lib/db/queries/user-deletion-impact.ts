import "server-only";
import { and, asc, eq, inArray, ne, or, sql } from "drizzle-orm";
import { db } from "../client";
import {
  intakeMailRecipients,
  inventoryPartIssueApprovals,
  inventoryPartIssueRequests,
  inventoryPartRequests,
  procedureCaseExecutionNodes,
  procedureCaseExecutions,
  repairCaseApprovals,
  repairCases,
  shipmentApprovalDelegations,
  shipmentApprovalRouteSteps,
  users,
} from "../schema";
import { getCurrentShipmentApprovalRouteChain, getShipmentApprovalRouteSteps } from "./shipment-approval-routes";
import { approverBlockReason } from "../mutations/shipment-approval-routes";
import { INSPECTION_DECIDE_ELIGIBLE_ROLES } from "../mutations/repair-case-approvals";
import { actorHasAllowedRole } from "@/lib/auth/developer-promotion";
import { mayManageDeveloperFlag } from "@/lib/auth/developer-flag-authorization";
import {
  SHIPMENT_APPROVAL_ROUTE_SCOPES,
  SHIPMENT_APPROVAL_ROUTE_SCOPE_LABELS,
  type RouteStepAssignment,
  type ShipmentApprovalRouteScope,
} from "@/lib/domain/shipment-approval-route";
import {
  approvalSuccessorBlock,
  collectSuccessorExclusions,
  countPendingApprovalsAssignedTo,
  engineerSuccessorBlock,
  planOpenApproval,
  resolveUserDeletionRequirements,
  type OpenApprovalFacts,
  type OpenApprovalKind,
  type OpenApprovalPlan,
  type UserDeletionPendingApprovalCounts,
  type UserDeletionRequirements,
} from "@/lib/domain/user-deletion-rules";
import { isValidUuid } from "@/lib/validation/procedure-validation-resolution-input";
import type { Role } from "@/lib/domain/types";

/**
 * ============================================================================
 * 사용자 계정 삭제 — 영향 모으기 · 영향 미리보기
 * ============================================================================
 * 사용자 결정(2026-09-13): 삭제는 「목록에서 치우고 일을 넘기는 것」이다. 삭제 확인
 * 창(U2)이 무엇이 넘어가는지 · 어느 이어받을 사람이 필요한지 · 왜 지금은 지울 수
 * 없는지를 **누르기 전에** 보여 준다.
 *
 * ── 🔴 미리보기와 삭제가 같은 수집 함수를 쓴다 ──────────────────────────
 * collectUserDeletionImpact 하나가 「무엇이 걸려 있는가」를 모은다. 미리보기는 잠그지
 * 않고(lock: false) 부르고, 삭제 mutation 은 자기 트랜잭션에서 잠그며(lock: true)
 * 부른다. 두 곳이 각자 조회를 적으면 「미리보기는 대기 결재 0건이라는데 삭제는
 * 이어받을 사람을 요구한다」가 생긴다. 무엇이 필요한지의 판정도 둘이 같은 순수 규칙
 * (domain/user-deletion-rules.ts)을 부른다.
 *
 * 미리보기는 낡을 수 있다 — 누르기 전에 결재가 나아가거나 건이 출하될 수 있다. 그래서
 * 삭제는 미리보기 결과를 믿지 않고 잠근 뒤 **다시 모은다.**
 *
 * ── 잠금 순서 (lock: true 일 때) ────────────────────────────────────────
 * 결재 결정이 잡는 순서에 맞춘다 — 결재 행 → 위임 행 → 사용자 행
 * (mutations/repair-case-approvals.ts 의 decideRepairCaseApproval). 부품 불출은 신청
 * 헤더를 결재 행보다 먼저 잠근다(decidePartIssueRequestApproval · cancel 과 같은
 * 순서). 순서가 어긋나면 삭제와 결재가 서로를 기다리는 교착이 난다. 결재선 판은
 * 잠그지 않는다 — 부르는 쪽이 결재선 잠금(acquireShipmentApprovalRouteLock)을 먼저
 * 건다.
 *
 * ── 개인정보 ────────────────────────────────────────────────────────────
 * 이메일 · 전화 · sso_subject 는 싣지 않는다. 포털 연결 여부만 참/거짓으로 알린다
 * (queries/shipment-delegations.ts 의 isSsoManaged 와 같은 판단).
 * ============================================================================
 */

type Executor = Parameters<Parameters<typeof db.transaction>[0]>[0] | typeof db;

/**
 * 「아직 끝나지 않은」 절차 노드 — 삭제가 담당을 되돌리는 대상이다. 끝난(COMPLETED ·
 * SKIPPED) 노드의 담당은 「누가 했나」라는 기록이라 그대로 둔다.
 */
export const OPEN_NODE_STATUSES = ["PENDING", "IN_PROGRESS", "BLOCKED"] as const;

/**
 * 지울 사람이 올린 것 중 아직 열려 있는 부품 요청 · 불출 신청 — **참고로 세기만
 * 한다**(사용자 결정 2026-09-14: 그대로 둔다). 재고 담당자가 반려 · 불출 · 실행할 수
 * 있어 막히지 않는다.
 */
const OPEN_PART_REQUEST_STATUSES = ["PENDING", "PARTIALLY_ISSUED", "ON_HOLD"] as const;
const OPEN_PART_ISSUE_REQUEST_STATUSES = ["PENDING_APPROVAL", "APPROVED"] as const;

export type UserDeletionTarget = {
  id: string;
  name: string;
  role: Role;
  /** 삭제 요청의 expectedVersion 으로 돌려받는다 — 사용자 목록은 이 값을 싣지 않는다. */
  version: number;
  isShipmentRepresentative: boolean;
  isDeveloper: boolean;
  /** 통합 로그인 포털에 연결된 계정인가. 포털 로그인으로 되살아날 수 있는 계정이다. */
  isSsoManaged: boolean;
};

/** 지울 사람이 올라 있는 **현재 판** 하나. */
export type UserDeletionRouteSlot = {
  scope: ShipmentApprovalRouteScope;
  routeId: string;
  routeVersion: number;
  /** 지울 사람의 자리. */
  stepOrder: number;
  /** 그 판의 단계 전부 — 새 판은 지울 사람 자리만 바꿔 이 목록으로 만든다. */
  steps: RouteStepAssignment[];
  /**
   * 같은 판의 **다른** 단계 중 지금 결재선에 올릴 수 없는 사람들. 새 판 저장이 그들을
   * 이유로 거절하므로(saveShipmentApprovalRouteInTx) 삭제도 막힌다.
   */
  ineligibleOtherSteps: { stepOrder: number; approverUserId: string; approverName: string; reason: string }[];
};

/** 삭제가 손대거나 막히는 진행 중 결재 행 하나. 관계없는 행(NONE)은 싣지 않는다. */
export type UserDeletionOpenApproval = {
  approvalId: string;
  facts: OpenApprovalFacts;
  plan: OpenApprovalPlan;
  subject: {
    repairCaseId: string | null;
    /** 부품 불출이면 그 신청. */
    issueRequestId: string | null;
    /** 사람이 알아보는 접수번호. 접수 건이 없거나 영구 삭제됐으면 null. */
    intakeNumber: string | null;
  };
  /** 사람이 알아볼 이름 — 「D260901 최종 출하 승인」 · 「부품 불출 신청 3f2a1b4c」. */
  label: string;
};

export type UserDeletionImpactSnapshot = {
  target: UserDeletionTarget;
  currentRouteIdByScope: Record<ShipmentApprovalRouteScope, string | null>;
  routeSlots: UserDeletionRouteSlot[];
  openApprovals: UserDeletionOpenApproval[];
  isLastRepresentative: boolean;
  activeDelegations: { id: string; representativeUserId: string; delegateUserId: string }[];
  /** 담당 이관 대상 — 휴지통에 없고 출하 완료로 잠기지 않은 접수 건. */
  openAssignedCaseIds: string[];
  /** 그대로 두는 담당 건(휴지통 · 출하 완료) — 안내용. */
  untouchedAssignedCaseCount: number;
  /** 담당을 NULL 로 되돌릴 열린 절차 노드. */
  openClaimedNodeIds: string[];
  ownOpenPartRequestCount: number;
  ownOpenPartIssueRequestCount: number;
  isIntakeMailRecipient: boolean;
};

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function nonNull<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}

function approvalLabel(kind: OpenApprovalKind, intakeNumber: string | null, issueRequestId: string | null): string {
  if (kind === "PART_ISSUE") {
    // 불출 신청에는 사람이 읽는 번호가 없다 — id 앞 여덟 자를 쓰고, 접수 건에 매인
    // 신청이면 접수번호를 곁들인다.
    const short = (issueRequestId ?? "").slice(0, 8);
    const base = `${SHIPMENT_APPROVAL_ROUTE_SCOPE_LABELS.PART_ISSUE} 신청 ${short}`;
    return intakeNumber ? `${base} (${intakeNumber})` : base;
  }
  const caseLabel = intakeNumber ?? "(영구 삭제된 접수 건)";
  return kind === "FINAL_SHIPMENT"
    ? `${caseLabel} ${SHIPMENT_APPROVAL_ROUTE_SCOPE_LABELS.FINAL_SHIPMENT}`
    : `${caseLabel} 수리 검수 승인`;
}

/**
 * 지울 사람에게 걸려 있는 것을 모두 모은다. 대상이 없거나 이미 삭제됐으면 null.
 *
 * @param options.lock 참이면 넘기거나 닫을 행을 잠근다(FOR UPDATE, 잠금 순서는 파일
 *   머리말). 부르는 쪽의 트랜잭션 안에서만 뜻이 있다.
 */
export async function collectUserDeletionImpact(
  executor: Executor,
  targetUserId: string,
  options: { lock: boolean }
): Promise<UserDeletionImpactSnapshot | null> {
  // 형식이 아닌 id 를 DB 까지 보내면 Postgres 가 오류를 던진다 — 없는 대상과 같게 닫는다.
  if (!isValidUuid(targetUserId)) return null;
  // uuid 비교는 DB 에서는 대소문자를 가리지 않지만 여기서의 === 는 가린다. 표에 적힌
  // 모양(소문자)으로 맞춰 둔다.
  const targetId = targetUserId.toLowerCase();
  const { lock } = options;

  // 0. 대상이 있는가 — 없으면 아래를 읽을 이유가 없다. 잠금은 순서의 마지막(8)에서 건다.
  const [exists] = await executor
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, targetId), eq(users.isDeleted, false)));
  if (!exists) return null;

  // 1. 용도별 지금 판 — 「현재 절차」의 정의는 queries/shipment-approval-routes.ts 하나다.
  const currentRouteIdByScope = {} as Record<ShipmentApprovalRouteScope, string | null>;
  const slotHeaders: Omit<UserDeletionRouteSlot, "ineligibleOtherSteps">[] = [];
  for (const scope of SHIPMENT_APPROVAL_ROUTE_SCOPES) {
    const chain = await getCurrentShipmentApprovalRouteChain(executor, scope);
    currentRouteIdByScope[scope] = chain?.routeId ?? null;
    const slot = chain?.steps.find((step) => step.approverUserId === targetId);
    if (chain && slot) {
      slotHeaders.push({
        scope,
        routeId: chain.routeId,
        routeVersion: chain.version,
        stepOrder: slot.stepOrder,
        steps: chain.steps,
      });
    }
  }

  // 2. 지울 사람이 올라 있는 판 — 옛 판까지. 진행 중인 결재는 옛 판을 붙잡고 있을 수 있다.
  const routeIdsWithTarget = unique(
    (
      await executor
        .select({ routeId: shipmentApprovalRouteSteps.routeId })
        .from(shipmentApprovalRouteSteps)
        .where(eq(shipmentApprovalRouteSteps.approverUserId, targetId))
    ).map((row) => row.routeId)
  );

  // 3. 접수 건 결재 대기 — 지울 사람에게 지정됐거나, 지울 사람이 있는 판을 따라가는 것.
  const repairCondition =
    routeIdsWithTarget.length > 0
      ? or(
          eq(repairCaseApprovals.assignedApproverUserId, targetId),
          inArray(repairCaseApprovals.routeId, routeIdsWithTarget)
        )
      : eq(repairCaseApprovals.assignedApproverUserId, targetId);
  const repairQuery = executor
    .select({
      id: repairCaseApprovals.id,
      approvalType: repairCaseApprovals.approvalType,
      repairCaseId: repairCaseApprovals.repairCaseId,
      assignedApproverUserId: repairCaseApprovals.assignedApproverUserId,
      requestedByUserId: repairCaseApprovals.requestedByUserId,
      routeId: repairCaseApprovals.routeId,
      routeStepOrder: repairCaseApprovals.routeStepOrder,
    })
    .from(repairCaseApprovals)
    .where(and(eq(repairCaseApprovals.status, "REQUESTED"), repairCondition));
  const repairRows = lock ? await repairQuery.for("update") : await repairQuery;

  // 4. 부품 불출 결재 대기 — 헤더를 먼저 잠그고(결재 · 취소와 같은 순서) 결재 행을 다시
  //    읽는다. 신청이 결재 대기(PENDING_APPROVAL)가 아닌 행은 넘길 것이 없다.
  const issueCondition =
    routeIdsWithTarget.length > 0
      ? or(
          eq(inventoryPartIssueApprovals.assignedApproverUserId, targetId),
          inArray(inventoryPartIssueApprovals.routeId, routeIdsWithTarget)
        )
      : eq(inventoryPartIssueApprovals.assignedApproverUserId, targetId);
  const issueCandidates = await executor
    .select({ id: inventoryPartIssueApprovals.id, issueRequestId: inventoryPartIssueApprovals.issueRequestId })
    .from(inventoryPartIssueApprovals)
    .where(and(eq(inventoryPartIssueApprovals.status, "REQUESTED"), issueCondition));

  const issueHeaders = await (async () => {
    const ids = unique(issueCandidates.map((row) => row.issueRequestId));
    if (ids.length === 0) return [];
    const query = executor
      .select({
        id: inventoryPartIssueRequests.id,
        status: inventoryPartIssueRequests.status,
        repairCaseId: inventoryPartIssueRequests.repairCaseId,
        partRequestId: inventoryPartIssueRequests.partRequestId,
      })
      .from(inventoryPartIssueRequests)
      .where(inArray(inventoryPartIssueRequests.id, ids));
    return lock ? await query.for("update") : await query;
  })();
  const headerById = new Map(issueHeaders.map((header) => [header.id, header]));

  const issueRows = await (async () => {
    const ids = issueCandidates.map((row) => row.id);
    if (ids.length === 0) return [];
    const query = executor
      .select({
        id: inventoryPartIssueApprovals.id,
        issueRequestId: inventoryPartIssueApprovals.issueRequestId,
        assignedApproverUserId: inventoryPartIssueApprovals.assignedApproverUserId,
        requestedByUserId: inventoryPartIssueApprovals.requestedByUserId,
        routeId: inventoryPartIssueApprovals.routeId,
        routeStepOrder: inventoryPartIssueApprovals.routeStepOrder,
      })
      .from(inventoryPartIssueApprovals)
      .where(and(inArray(inventoryPartIssueApprovals.id, ids), eq(inventoryPartIssueApprovals.status, "REQUESTED")));
    return lock ? await query.for("update") : await query;
  })();
  const awaitingIssueRows = issueRows.filter(
    (row) => headerById.get(row.issueRequestId)?.status === "PENDING_APPROVAL"
  );

  // 5. 붙잡은 판의 단계들 — 「현재 판」이 아니라 행에 적힌 판이다.
  const pinnedRouteIds = unique(
    [...repairRows.map((row) => row.routeId), ...awaitingIssueRows.map((row) => row.routeId)].filter(nonNull)
  );
  const stepsByRoute = new Map<string, RouteStepAssignment[]>();
  for (const routeId of pinnedRouteIds) {
    stepsByRoute.set(routeId, await getShipmentApprovalRouteSteps(executor, routeId));
  }

  // 6. 사람이 알아볼 식별자 — 접수번호. 요청 기반 불출은 부품 요청을 거쳐 접수 건을 찾는다.
  const partRequestIds = unique(
    awaitingIssueRows.map((row) => headerById.get(row.issueRequestId)?.partRequestId).filter(nonNull)
  );
  const partRequestCaseById = new Map<string, string | null>();
  if (partRequestIds.length > 0) {
    const rows = await executor
      .select({ id: inventoryPartRequests.id, repairCaseId: inventoryPartRequests.repairCaseId })
      .from(inventoryPartRequests)
      .where(inArray(inventoryPartRequests.id, partRequestIds));
    for (const row of rows) partRequestCaseById.set(row.id, row.repairCaseId);
  }
  const issueCaseId = (issueRequestId: string): string | null => {
    const header = headerById.get(issueRequestId);
    if (!header) return null;
    if (header.repairCaseId) return header.repairCaseId;
    return header.partRequestId ? (partRequestCaseById.get(header.partRequestId) ?? null) : null;
  };
  const caseIds = unique(
    [
      ...repairRows.map((row) => row.repairCaseId),
      ...awaitingIssueRows.map((row) => issueCaseId(row.issueRequestId)),
    ].filter(nonNull)
  );
  const intakeById = new Map<string, string>();
  if (caseIds.length > 0) {
    const rows = await executor
      .select({ id: repairCases.id, intakeNumber: repairCases.intakeNumber })
      .from(repairCases)
      .where(inArray(repairCases.id, caseIds));
    for (const row of rows) intakeById.set(row.id, row.intakeNumber);
  }

  const openApprovals: UserDeletionOpenApproval[] = [];
  const pushIfRelevant = (entry: Omit<UserDeletionOpenApproval, "plan">) => {
    const plan = planOpenApproval(entry.facts, { targetUserId: targetId, currentRouteIdByScope });
    if (plan.action !== "NONE") openApprovals.push({ ...entry, plan });
  };
  for (const row of repairRows) {
    const intakeNumber = row.repairCaseId ? (intakeById.get(row.repairCaseId) ?? null) : null;
    pushIfRelevant({
      approvalId: row.id,
      facts: {
        kind: row.approvalType,
        assignedApproverUserId: row.assignedApproverUserId,
        requestedByUserId: row.requestedByUserId,
        routeId: row.routeId,
        routeStepOrder: row.routeStepOrder,
        routeSteps: row.routeId ? (stepsByRoute.get(row.routeId) ?? []) : [],
      },
      subject: { repairCaseId: row.repairCaseId, issueRequestId: null, intakeNumber },
      label: approvalLabel(row.approvalType, intakeNumber, null),
    });
  }
  for (const row of awaitingIssueRows) {
    const repairCaseId = issueCaseId(row.issueRequestId);
    const intakeNumber = repairCaseId ? (intakeById.get(repairCaseId) ?? null) : null;
    pushIfRelevant({
      approvalId: row.id,
      facts: {
        kind: "PART_ISSUE",
        assignedApproverUserId: row.assignedApproverUserId,
        requestedByUserId: row.requestedByUserId,
        routeId: row.routeId,
        routeStepOrder: row.routeStepOrder,
        routeSteps: row.routeId ? (stepsByRoute.get(row.routeId) ?? []) : [],
      },
      subject: { repairCaseId, issueRequestId: row.issueRequestId, intakeNumber },
      label: approvalLabel("PART_ISSUE", intakeNumber, row.issueRequestId),
    });
  }

  // 7. 아직 ACTIVE 인 위임 — 대표로서든 위임받은 사람으로서든. 기간과 상관없이(미래 기간 포함).
  const delegationQuery = executor
    .select({
      id: shipmentApprovalDelegations.id,
      representativeUserId: shipmentApprovalDelegations.representativeUserId,
      delegateUserId: shipmentApprovalDelegations.delegateUserId,
    })
    .from(shipmentApprovalDelegations)
    .where(
      and(
        eq(shipmentApprovalDelegations.status, "ACTIVE"),
        or(
          eq(shipmentApprovalDelegations.representativeUserId, targetId),
          eq(shipmentApprovalDelegations.delegateUserId, targetId)
        )
      )
    );
  const activeDelegations = lock ? await delegationQuery.for("update") : await delegationQuery;

  // 8. 대상 행 — 잠금 순서의 마지막이다(파일 머리말).
  const targetQuery = executor
    .select({
      id: users.id,
      name: users.name,
      role: users.role,
      version: users.version,
      isShipmentRepresentative: users.isShipmentRepresentative,
      isDeveloper: users.isDeveloper,
      ssoSubject: users.ssoSubject,
      isDeleted: users.isDeleted,
    })
    .from(users)
    .where(eq(users.id, targetId));
  const [targetRow] = lock ? await targetQuery.for("update") : await targetQuery;
  // 0 과 8 사이에 지워졌을 수 있다(잠그기 전에는 막을 수 없다).
  if (!targetRow || targetRow.isDeleted) return null;

  // 9. 마지막 대표인가 — 「남은 대표」의 정의는 대표 해제의 가드와 글자 그대로 같다
  //    (mutations/shipment-representatives.ts: 대표 · 삭제 안 됨 · 활성, 자기 제외).
  let isLastRepresentative = false;
  if (targetRow.isShipmentRepresentative) {
    const [others] = await executor
      .select({ total: sql<number>`count(*)::int` })
      .from(users)
      .where(
        and(
          eq(users.isShipmentRepresentative, true),
          eq(users.isDeleted, false),
          eq(users.isActive, true),
          ne(users.id, targetId)
        )
      );
    isLastRepresentative = others.total === 0;
  }

  // 10. 담당 건 — 휴지통 · 출하 완료(is_locked)는 그대로 둔다.
  const assignedCases = await executor
    .select({ id: repairCases.id, isDeleted: repairCases.isDeleted, isLocked: repairCases.isLocked })
    .from(repairCases)
    .where(eq(repairCases.assignedEngineerId, targetId));
  const openAssignedCaseIds = assignedCases.filter((row) => !row.isDeleted && !row.isLocked).map((row) => row.id);

  // 11. 지울 사람이 잡은 열린 절차 노드 — 실행 · 접수 건이 살아 있고 잠기지 않은 것만.
  const openClaimedNodeIds = (
    await executor
      .select({ id: procedureCaseExecutionNodes.id })
      .from(procedureCaseExecutionNodes)
      .innerJoin(procedureCaseExecutions, eq(procedureCaseExecutions.id, procedureCaseExecutionNodes.executionId))
      .innerJoin(repairCases, eq(repairCases.id, procedureCaseExecutions.repairCaseId))
      .where(
        and(
          eq(procedureCaseExecutionNodes.assignedEngineerId, targetId),
          inArray(procedureCaseExecutionNodes.status, [...OPEN_NODE_STATUSES]),
          eq(procedureCaseExecutions.isDeleted, false),
          eq(repairCases.isDeleted, false),
          eq(repairCases.isLocked, false)
        )
      )
  ).map((row) => row.id);

  // 12 · 13. 참고로만 센다(그대로 둔다).
  const [partRequestCount] = await executor
    .select({ total: sql<number>`count(*)::int` })
    .from(inventoryPartRequests)
    .where(
      and(
        eq(inventoryPartRequests.requestedByUserId, targetId),
        inArray(inventoryPartRequests.status, [...OPEN_PART_REQUEST_STATUSES])
      )
    );
  const [partIssueRequestCount] = await executor
    .select({ total: sql<number>`count(*)::int` })
    .from(inventoryPartIssueRequests)
    .where(
      and(
        eq(inventoryPartIssueRequests.requestedByUserId, targetId),
        inArray(inventoryPartIssueRequests.status, [...OPEN_PART_ISSUE_REQUEST_STATUSES])
      )
    );

  // 14. 접수 메일 수신자인가 — 삭제 때 그 행을 지운다(사용자 결정 2026-09-14).
  const [recipient] = await executor
    .select({ id: intakeMailRecipients.id })
    .from(intakeMailRecipients)
    .where(eq(intakeMailRecipients.userId, targetId))
    .limit(1);

  // 15. 새 판 저장이 거절할 다른 단계 — 판정은 저장과 같은 approverBlockReason 이다.
  const otherApproverIds = unique(
    slotHeaders.flatMap((slot) => slot.steps.map((step) => step.approverUserId)).filter((id) => id !== targetId)
  );
  const approverById = new Map<
    string,
    { name: string; approvalStatus: string; isActive: boolean; lockedAt: Date | null; isDeleted: boolean }
  >();
  if (otherApproverIds.length > 0) {
    const rows = await executor
      .select({
        id: users.id,
        name: users.name,
        approvalStatus: users.approvalStatus,
        isActive: users.isActive,
        lockedAt: users.lockedAt,
        isDeleted: users.isDeleted,
      })
      .from(users)
      .where(inArray(users.id, otherApproverIds));
    for (const row of rows) approverById.set(row.id, row);
  }
  const routeSlots: UserDeletionRouteSlot[] = slotHeaders.map((slot) => ({
    ...slot,
    ineligibleOtherSteps: slot.steps.flatMap((step) => {
      if (step.approverUserId === targetId) return [];
      const approver = approverById.get(step.approverUserId);
      const reason = approver ? approverBlockReason(approver) : "찾을 수 없는 계정입니다";
      return reason === null
        ? []
        : [
            {
              stepOrder: step.stepOrder,
              approverUserId: step.approverUserId,
              approverName: approver?.name ?? "(알 수 없음)",
              reason,
            },
          ];
    }),
  }));

  return {
    target: {
      id: targetRow.id,
      name: targetRow.name,
      role: targetRow.role,
      version: targetRow.version,
      isShipmentRepresentative: targetRow.isShipmentRepresentative,
      isDeveloper: targetRow.isDeveloper,
      isSsoManaged: targetRow.ssoSubject !== null,
    },
    currentRouteIdByScope,
    routeSlots,
    openApprovals,
    isLastRepresentative,
    activeDelegations,
    openAssignedCaseIds,
    untouchedAssignedCaseCount: assignedCases.length - openAssignedCaseIds.length,
    openClaimedNodeIds,
    ownOpenPartRequestCount: partRequestCount.total,
    ownOpenPartIssueRequestCount: partIssueRequestCount.total,
    isIntakeMailRecipient: recipient !== undefined,
  };
}

/**
 * ============================================================================
 * 영향 미리보기 — 확인 창(U2)이 보일 것
 * ============================================================================
 */

export type UserDeletionBlocker =
  | {
      /** 옛 판을 따라가는 진행 중 결재에 지울 사람의 단계가 남아 있다(사용자 결정 2026-09-14). */
      code: "IN_FLIGHT_ON_OLD_ROUTE";
      message: string;
      kind: OpenApprovalKind;
      /** 사람이 알아볼 이름 — 접수번호나 불출 신청 식별자가 들어 있다. */
      label: string;
      intakeNumber: string | null;
      issueRequestId: string | null;
    }
  | {
      /** 새 판 저장이 거절할 사람이 같은 판의 다른 단계에 있다. */
      code: "ROUTE_UPDATE_REJECTED";
      message: string;
      scope: ShipmentApprovalRouteScope;
      stepOrder: number;
      approverName: string;
    };

export type UserDeletionPreviewImpact = {
  routeSlots: { scope: ShipmentApprovalRouteScope; routeVersion: number; stepOrder: number }[];
  /** 지울 사람에게 **지정된** 결재 대기 — 이어받을 사람에게 넘어간다. */
  pendingApprovals: UserDeletionPendingApprovalCounts;
  /** 지울 사람이 현재 판의 뒤 단계에 있어 새 판으로 옮길 진행 중 결재. */
  chainsToRepin: number;
  isRepresentative: boolean;
  isLastRepresentative: boolean;
  activeDelegations: { asRepresentative: number; asDelegate: number };
  openAssignedCases: number;
  untouchedAssignedCases: number;
  openClaimedNodes: number;
  ownOpenPartRequests: number;
  ownOpenPartIssueRequests: number;
  isDeveloper: boolean;
  isIntakeMailRecipient: boolean;
};

export type UserDeletionPreviewFailureCode = "FORBIDDEN" | "NOT_FOUND" | "SELF_DELETE_FORBIDDEN";

export type UserDeletionPreview =
  | { ok: false; code: UserDeletionPreviewFailureCode; message: string }
  | {
      ok: true;
      target: UserDeletionTarget;
      impact: UserDeletionPreviewImpact;
      requires: UserDeletionRequirements;
      candidates: {
        approvalSuccessors: { id: string; name: string; role: Role }[];
        engineerSuccessors: { id: string; name: string }[];
      };
      blockers: UserDeletionBlocker[];
    };

const FORBIDDEN_MESSAGE = "사용자 계정을 삭제할 권한이 없습니다.";

/**
 * 멈춤 사유 문장 — 미리보기와 삭제 mutation 이 **같은 말**을 하도록 여기 한 곳에 둔다.
 * 확인 창에서 본 사유와 [삭제]를 누른 뒤의 거절 사유가 다르면 사람은 둘이 같은
 * 문제인지 알 수 없다.
 */
export function inFlightOnOldRouteMessage(targetName: string, labels: readonly string[]): string {
  return `바뀌기 전 승인 절차를 따라가는 진행 중 결재에 ${targetName} 님의 단계가 아직 남아 있어 삭제할 수 없습니다(${labels.join(", ")}). 그 결재가 끝나거나 반려된 뒤 다시 시도해 주세요.`;
}

/** 새 판 저장이 거절할 사람이 같은 판에 있을 때의 사유 — 미리보기 · 삭제 공용. */
export function routeUpdateRejectedMessage(
  scope: ShipmentApprovalRouteScope,
  step: { stepOrder: number; approverName: string; reason: string }
): string {
  return `${SHIPMENT_APPROVAL_ROUTE_SCOPE_LABELS[scope]} 절차 ${step.stepOrder}번째 단계의 ${step.approverName} 님은 ${step.reason}. 승인 절차를 먼저 정리한 뒤 삭제해 주세요.`;
}

/**
 * 이 사람을 지우면 무엇이 넘어가는가.
 *
 * 🔴 판정 순서: 행위자(진짜 최고관리자인가) → 자기 자신 → 대상. 권한이 없는 사람에게는
 * 대상이 있는지조차 말하지 않는다 — 그래서 FORBIDDEN 이 NOT_FOUND 보다 먼저다.
 *
 * 행위자는 살아 있는 행을 다시 읽어 mayManageDeveloperFlag 로 판정한다 — 개발자
 * 표시를 켜고 끄는 사람과 같다(사용자 결정 2026-09-13: 개발자 승격으로 최고관리자가 된
 * 사람은 지울 수 없다). 행위자의 개발자 표시는 읽지 않는다.
 *
 * 후보 목록은 화면이 고를 것일 뿐 최종 판정이 아니다 — 삭제는 잠근 뒤 같은 규칙으로
 * 다시 본다.
 */
export async function getUserDeletionPreview(
  targetUserId: string,
  actorUserId: string
): Promise<UserDeletionPreview> {
  if (!isValidUuid(actorUserId)) return { ok: false, code: "FORBIDDEN", message: FORBIDDEN_MESSAGE };
  const [actor] = await db
    .select({ id: users.id, role: users.role, approvalStatus: users.approvalStatus })
    .from(users)
    .where(and(eq(users.id, actorUserId), eq(users.isDeleted, false)));
  if (!actor || !mayManageDeveloperFlag(actor)) {
    return { ok: false, code: "FORBIDDEN", message: FORBIDDEN_MESSAGE };
  }

  if (typeof targetUserId === "string" && targetUserId.toLowerCase() === actor.id) {
    return { ok: false, code: "SELF_DELETE_FORBIDDEN", message: "자기 자신의 계정은 삭제할 수 없습니다." };
  }

  const snapshot = await collectUserDeletionImpact(db, targetUserId, { lock: false });
  if (!snapshot) return { ok: false, code: "NOT_FOUND", message: "대상 사용자를 찾을 수 없습니다." };

  const targetId = snapshot.target.id;
  const pendingApprovals = countPendingApprovalsAssignedTo(
    snapshot.openApprovals.map((entry) => entry.facts),
    targetId
  );
  const requires = resolveUserDeletionRequirements({
    routeSlotCount: snapshot.routeSlots.length,
    pendingApprovals,
    isLastRepresentative: snapshot.isLastRepresentative,
    openAssignedCaseCount: snapshot.openAssignedCaseIds.length,
  });

  // 후보 — 이어받을 사람의 자격은 삭제가 쓸 것과 같은 규칙으로 거른다.
  const people = await db
    .select({
      id: users.id,
      name: users.name,
      role: users.role,
      isDeveloper: users.isDeveloper,
      approvalStatus: users.approvalStatus,
      isActive: users.isActive,
      lockedAt: users.lockedAt,
      isDeleted: users.isDeleted,
    })
    .from(users)
    .where(eq(users.isDeleted, false))
    .orderBy(asc(users.name), asc(users.id));
  const exclusions = collectSuccessorExclusions({
    targetUserId: targetId,
    routeSlotSteps: snapshot.routeSlots.map((slot) => slot.steps),
    openApprovals: snapshot.openApprovals,
  });
  const approvalContext = {
    targetUserId: targetId,
    mustInspect: requires.approvalSuccessorMustInspect,
    routeMemberIds: exclusions.routeMemberIds,
    requesterIds: exclusions.requesterIds,
  };
  const approvalSuccessors = people
    .filter(
      (person) =>
        approvalSuccessorBlock(
          {
            id: person.id,
            name: person.name,
            accountBlockReason: approverBlockReason(person),
            canDecideInspection: actorHasAllowedRole(person, INSPECTION_DECIDE_ELIGIBLE_ROLES),
          },
          approvalContext
        ) === null
    )
    .map((person) => ({ id: person.id, name: person.name, role: person.role }));
  const engineerSuccessors = people
    .filter(
      (person) =>
        engineerSuccessorBlock(
          { id: person.id, name: person.name, role: person.role, accountBlockReason: approverBlockReason(person) },
          { targetUserId: targetId }
        ) === null
    )
    .map((person) => ({ id: person.id, name: person.name }));

  const blockers: UserDeletionBlocker[] = [];
  for (const entry of snapshot.openApprovals) {
    if (entry.plan.action !== "STOP") continue;
    blockers.push({
      code: "IN_FLIGHT_ON_OLD_ROUTE",
      message: inFlightOnOldRouteMessage(snapshot.target.name, [entry.label]),
      kind: entry.facts.kind,
      label: entry.label,
      intakeNumber: entry.subject.intakeNumber,
      issueRequestId: entry.subject.issueRequestId,
    });
  }
  for (const slot of snapshot.routeSlots) {
    for (const step of slot.ineligibleOtherSteps) {
      blockers.push({
        code: "ROUTE_UPDATE_REJECTED",
        message: routeUpdateRejectedMessage(slot.scope, step),
        scope: slot.scope,
        stepOrder: step.stepOrder,
        approverName: step.approverName,
      });
    }
  }

  return {
    ok: true,
    target: snapshot.target,
    impact: {
      routeSlots: snapshot.routeSlots.map((slot) => ({
        scope: slot.scope,
        routeVersion: slot.routeVersion,
        stepOrder: slot.stepOrder,
      })),
      pendingApprovals,
      chainsToRepin: snapshot.openApprovals.filter((entry) => entry.plan.action === "REPIN").length,
      isRepresentative: snapshot.target.isShipmentRepresentative,
      isLastRepresentative: snapshot.isLastRepresentative,
      activeDelegations: {
        asRepresentative: snapshot.activeDelegations.filter((row) => row.representativeUserId === targetId).length,
        asDelegate: snapshot.activeDelegations.filter((row) => row.delegateUserId === targetId).length,
      },
      openAssignedCases: snapshot.openAssignedCaseIds.length,
      untouchedAssignedCases: snapshot.untouchedAssignedCaseCount,
      openClaimedNodes: snapshot.openClaimedNodeIds.length,
      ownOpenPartRequests: snapshot.ownOpenPartRequestCount,
      ownOpenPartIssueRequests: snapshot.ownOpenPartIssueRequestCount,
      isDeveloper: snapshot.target.isDeveloper,
      isIntakeMailRecipient: snapshot.isIntakeMailRecipient,
    },
    requires,
    candidates: { approvalSuccessors, engineerSuccessors },
    blockers,
  };
}
