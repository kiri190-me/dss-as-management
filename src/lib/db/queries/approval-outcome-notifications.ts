import "server-only";
import { and, desc, eq, gt, gte, inArray, ne, notExists, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "../client";
import {
  inventoryPartIssueApprovals,
  inventoryPartIssueRequests,
  inventoryPartRequests,
  repairCaseApprovals,
  repairCases,
  users,
} from "../schema";
import { isPartIssueApprovalClosedByRequester, type InventoryPartIssueRequestStatus } from "@/lib/domain/inventory-part-issue-rules";
import { approvalOutcomeNotificationWindowStart, type ApprovalOutcomeTarget } from "@/lib/domain/notifications";

/**
 * ============================================================================
 * 내가 요청한 결재의 결과 — 종 알림 「승인 완료」·「반려됨」의 원본
 * ============================================================================
 * 결재를 **요청한 사람**에게 그 결과를 알리는 조회 둘이다. 대상 결재는 세 가지고
 * 표는 둘이다:
 *   · repair_case_approvals           — 수리 검수 승인 · 최종 출하 승인
 *   · inventory_part_issue_approvals  — 부품 불출 승인
 * 두 표 모두 「단계마다 요청 행 하나, 앞 행을 결정한 뒤 다음 행을 넣는」 사슬 모양이고
 * (mutations/repair-case-approvals.ts · mutations/inventory-part-issue-requests.ts 의
 * 사슬 잇는 자리), 요청자(`requested_by_user_id`)는 사슬 내내 처음 올린 사람 그대로다.
 *
 * 🔴 **이 파일은 아무것도 쓰지 않는다.** 결재·출하·불출 mutation 을 한 줄도 건드리지
 * 않고, 이미 쌓인 결재 기록에서 결과 사건을 골라 읽기만 한다.
 *
 * ── 누구에게 가는가 — 요청자 본인뿐 ────────────────────────────────────
 * 두 조회 모두 WHERE 에 `requested_by_user_id = 나` 가 언제나 있다. 인자는 서버가
 * 세션에서 푼 사용자 id 하나뿐이고(db/queries/notifications.ts), 역할을 보지 않는다
 * — 사람 단위 알림이라 역할로 막을 것이 없고, 남의 결재 결과를 요구할 입구도 없다.
 *
 * ── 언제 알리나 — 「결과 사건」 ─────────────────────────────────────────
 *  · 결정 시각이 최근 창(APPROVAL_OUTCOME_NOTIFICATION_WINDOW_DAYS) 안인 것만. 그보다
 *    오래된 것은 확인하지 않아도 뜨지 않는다 — 기능을 켜는 순간 옛 결재가 쏟아지지
 *    않게 하려는 것이다.
 *  · 🔴 **결정자가 요청자 본인이면 알리지 않는다.** 최고관리자가 비상구로 자기 요청을
 *    스스로 결정한 경우, 엔지니어가 자기 검수 요청을 스스로 승인한 경우, 그리고
 *    신청자가 불출 신청을 취소해 열린 결재 행이 REJECTED 로 닫힌 경우가 여기 걸린다
 *    (cancelPartIssueRequest 머리말). 자기가 한 일을 자기에게 알릴 이유가 없다.
 *  · 승인 완료는 **최종 승인일 때만**이다(아래 「최종」 절).
 *  · 반려는 어느 단계에서든 알린다 — 반려되면 사슬이 거기서 끝나므로 그 행이 곧
 *    결과다.
 *
 * ── 「최종」 승인을 어떻게 가르는가 ──────────────────────────────────────
 * 순차 결재선에서 한 단계가 승인되면 **다음 단계의 새 REQUESTED 행**이 생기고, 그
 * 행의 requested_at 은 표 기본값(now())이라 앞 행보다 늦다. 마지막 단계가 승인되면
 * 새 행이 생기지 않아 **그 행이 가장 늦은 행으로 남는다.** 그래서 「최종 승인」은
 *
 *     그 행이 APPROVED 이고, 같은 묶음에 requested_at 이 더 늦은 행이 없다
 *
 * 로 가른다. 묶음은 접수 건 결재면 (접수 건, 결재 종류), 불출이면 신청 하나다. 이것은
 * queries/repair-case-approvals.ts 의 getCurrentApprovalsForCase(와 출하 문
 * resolveApprovalValidity)가 쓰는 「가장 최근 행」과 같은 정의다 — 그 함수들은 한 건을
 * requested_at 내림차순으로 읽어 맨 앞 행을 고르고, 여기서는 여러 건을 한 번에 읽으려고
 * 같은 말을 `NOT EXISTS (더 늦은 행)` 으로 적었다. 두 정의가 같은 행을 고르는지는
 * 통합 시험(approval-outcome-notifications.integration.test.ts)이 getCurrentApprovalsForCase
 * 와 직접 맞춰 본다.
 *
 * 중간 단계 승인은 다음 단계 행이 더 늦으므로 저절로 빠진다. 반대로 한때 최종이던
 * 승인도 뒤에 새 요청이 들어오면(접수 건이 바뀌어 다시 요청하는 경우) 최신이 아니게
 * 되어 빠진다 — 그 뒤의 결과가 새로 알림이 된다.
 *
 * 불출은 여기에 **신청 상태**를 하나 더 본다: APPROVED(실행 대기) 또는 EXECUTED(이미
 * 나감)일 때만 승인 완료다. 승인 뒤에 신청자가 스스로 취소한(CANCELLED) 신청은 알릴
 * 결과가 남아 있지 않다.
 *
 * ── 접수 건이 없어진 결재 ────────────────────────────────────────────────
 *  · 접수 건 결재: 기존 「결재 대기」 조회(repair-case-approvals-pending.ts)와 같이
 *    접수 건에 INNER JOIN 하고 휴지통(`is_deleted`)을 뺀다. 영구 삭제로
 *    repair_case_id 가 NULL 이 된 행과 휴지통에 간 건은 알리지 않는다 — 누르면 갈
 *    검수/승인 화면이 없다. 출하 완료로 잠긴 건(`is_locked`)은 빼지 않는다 — 대기
 *    조회와 달리 이쪽은 결과를 알리는 것이고, 출하 승인이 끝난 건이 곧 잠기는 것이
 *    정상 흐름이라 빼면 출하 승인 완료가 거의 알려지지 않는다.
 *  · 부품 불출: 기존 「불출 승인 대기」 조회(inventory-part-issue-requests.ts)와 같이
 *    접수 건을 LEFT JOIN 으로만 붙여 거르지 않는다. 불출 신청은 재고 기록이라 접수
 *    건보다 오래 살고, 누르면 가는 곳도 재고 화면이다. 인수번호가 없으면 사용처,
 *    둘 다 없으면 「삭제된 접수 건」으로 적는다(domain/notifications.ts).
 *
 * ── 순서 ────────────────────────────────────────────────────────────────
 * 결정이 늦은 것부터(같은 시각이면 행 id 로 동점을 깬다 — 실행마다 흔들리지 않게).
 * 종 패널은 종류를 섞어 다시 세우지 않는다 — 레지스트리 순서대로 종류별 묶음이 이어
 * 붙는다(db/queries/notifications.ts). 그래서 이 순서는 「승인 완료」 묶음·「반려됨」
 * 묶음 각각 안에서의 순서다.
 * ============================================================================
 */

const decider = alias(users, "outcome_decider");
const laterCaseApproval = alias(repairCaseApprovals, "later_case_approval");
const laterIssueApproval = alias(inventoryPartIssueApprovals, "later_issue_approval");
/** 헤더가 가리키는 접수 건과, 부품 요청이 가리키는 접수 건을 따로 읽는다(불출 조회와 같다). */
const directCase = alias(repairCases, "outcome_direct_repair_case");
const requestCase = alias(repairCases, "outcome_part_request_repair_case");

/** 결재 결과 한 건 — 종 알림 한 줄의 원본. */
export type ApprovalOutcome = ApprovalOutcomeTarget & {
  /** 결정한 사람의 이름. 승인 완료 알림의 detail 에 적힌다. */
  decidedByName: string;
  decidedAt: Date;
  /** 결정 사유. 반려면 표 CHECK 가 NULL 을 막는다. */
  decisionReason: string | null;
};

/**
 * 불출 신청이 이 상태일 때만 「승인 완료」다 — 결재가 끝나 실행을 기다리거나, 이미
 * 나갔다. 결재 중·반려·취소는 알릴 승인 결과가 없다.
 */
const PART_ISSUE_GRANTED_REQUEST_STATUSES: readonly InventoryPartIssueRequestStatus[] = ["APPROVED", "EXECUTED"];

type OutcomeOptions = {
  /** 창을 잴 기준 시각. 시험이 창의 경계를 보려고 넘긴다. 기본은 지금이다. */
  now?: Date;
};

/** 결정 시각 내림차순, 같으면 결재 행 id 내림차순. */
function byDecisionNewestFirst(a: ApprovalOutcome, b: ApprovalOutcome): number {
  const diff = b.decidedAt.getTime() - a.decidedAt.getTime();
  if (diff !== 0) return diff;
  return a.approvalId < b.approvalId ? 1 : a.approvalId > b.approvalId ? -1 : 0;
}

// ──────────────────────────────────────────────── 접수 건 결재 (검수 · 출하)

type CaseOutcomeStatus = "APPROVED" | "REJECTED";

async function listRepairCaseApprovalOutcomes(
  requesterUserId: string,
  status: CaseOutcomeStatus,
  since: Date
): Promise<ApprovalOutcome[]> {
  const rows = await db
    .select({
      approvalId: repairCaseApprovals.id,
      repairCaseId: repairCases.id,
      intakeNumber: repairCases.intakeNumber,
      approvalType: repairCaseApprovals.approvalType,
      decidedByName: decider.name,
      decidedAt: repairCaseApprovals.decidedAt,
      decisionReason: repairCaseApprovals.decisionReason,
    })
    .from(repairCaseApprovals)
    // INNER JOIN — repair_case_id 가 NULL 인(영구 삭제된 접수 건의) 행이 여기서
    // 떨어진다. 결재 대기 조회와 같은 처리다(파일 머리말).
    .innerJoin(repairCases, eq(repairCases.id, repairCaseApprovals.repairCaseId))
    .leftJoin(decider, eq(decider.id, repairCaseApprovals.decidedByUserId))
    .where(
      and(
        // 🔴 요청자 본인 — 이 조건이 빠지면 남의 결재 결과가 내 종에 뜬다.
        eq(repairCaseApprovals.requestedByUserId, requesterUserId),
        eq(repairCaseApprovals.status, status),
        // 🔴 결정자가 요청자 본인이면 알리지 않는다. 결정된 행은 표 CHECK 가
        // decided_by 를 요구하므로 NULL 비교로 조용히 빠지는 행은 없다.
        ne(repairCaseApprovals.decidedByUserId, requesterUserId),
        gte(repairCaseApprovals.decidedAt, since),
        eq(repairCases.isDeleted, false),
        ...(status === "APPROVED"
          ? [
              // 🔴 최종 승인 — 같은 (접수 건, 결재 종류)에 이 행보다 늦게 요청된 행이
              // 없다. getCurrentApprovalsForCase 의 「가장 최근 행」과 같은 정의다
              // (파일 머리말 「최종」 절).
              notExists(
                db
                  .select({ one: sql`1` })
                  .from(laterCaseApproval)
                  .where(
                    and(
                      eq(laterCaseApproval.repairCaseId, repairCaseApprovals.repairCaseId),
                      eq(laterCaseApproval.approvalType, repairCaseApprovals.approvalType),
                      gt(laterCaseApproval.requestedAt, repairCaseApprovals.requestedAt)
                    )
                  )
              ),
            ]
          : [])
      )
    )
    .orderBy(desc(repairCaseApprovals.decidedAt), desc(repairCaseApprovals.id));

  return rows.flatMap((row) =>
    // 결정된 행은 decided_at 이 언제나 있다(표 CHECK). 타입을 좁히려는 것뿐이다.
    row.decidedAt === null
      ? []
      : [
          {
            source: "REPAIR_CASE" as const,
            approvalId: row.approvalId,
            repairCaseId: row.repairCaseId,
            intakeNumber: row.intakeNumber,
            approvalType: row.approvalType,
            decidedByName: row.decidedByName ?? "",
            decidedAt: row.decidedAt,
            decisionReason: row.decisionReason,
          },
        ]
  );
}

// ──────────────────────────────────────────────────────────────── 부품 불출

async function listPartIssueApprovalOutcomes(
  requesterUserId: string,
  status: CaseOutcomeStatus,
  since: Date
): Promise<ApprovalOutcome[]> {
  const rows = await db
    .select({
      approvalId: inventoryPartIssueApprovals.id,
      requestedByUserId: inventoryPartIssueApprovals.requestedByUserId,
      decidedByUserId: inventoryPartIssueApprovals.decidedByUserId,
      status: inventoryPartIssueApprovals.status,
      partRequestId: inventoryPartIssueRequests.partRequestId,
      directIntakeNumber: directCase.intakeNumber,
      partRequestIntakeNumber: requestCase.intakeNumber,
      destinationNote: inventoryPartIssueRequests.destinationNote,
      decidedByName: decider.name,
      decidedAt: inventoryPartIssueApprovals.decidedAt,
      decisionReason: inventoryPartIssueApprovals.decisionReason,
    })
    .from(inventoryPartIssueApprovals)
    .innerJoin(
      inventoryPartIssueRequests,
      eq(inventoryPartIssueRequests.id, inventoryPartIssueApprovals.issueRequestId)
    )
    // 무엇에 대한 신청인가 — 불출 승인 대기 조회와 같은 두 갈래 조인이다. 셋 다
    // 상대의 기본키에 붙는 LEFT JOIN 이라 행이 늘지도 줄지도 않는다.
    .leftJoin(directCase, eq(directCase.id, inventoryPartIssueRequests.repairCaseId))
    .leftJoin(inventoryPartRequests, eq(inventoryPartRequests.id, inventoryPartIssueRequests.partRequestId))
    .leftJoin(requestCase, eq(requestCase.id, inventoryPartRequests.repairCaseId))
    .leftJoin(decider, eq(decider.id, inventoryPartIssueApprovals.decidedByUserId))
    .where(
      and(
        // 🔴 요청자 본인. 결재 행의 요청자는 사슬 내내 신청을 올린 사람이다.
        eq(inventoryPartIssueApprovals.requestedByUserId, requesterUserId),
        eq(inventoryPartIssueApprovals.status, status),
        // 🔴 결정자가 요청자 본인이면 알리지 않는다 — 신청 취소로 닫힌 행이 여기서
        // 빠진다(아래 isPartIssueApprovalClosedByRequester 가 한 번 더 본다).
        ne(inventoryPartIssueApprovals.decidedByUserId, requesterUserId),
        gte(inventoryPartIssueApprovals.decidedAt, since),
        ...(status === "APPROVED"
          ? [
              // 결재가 끝나 실행을 기다리거나 이미 나간 신청만.
              inArray(inventoryPartIssueRequests.status, PART_ISSUE_GRANTED_REQUEST_STATUSES),
              // 🔴 최종 승인 — 같은 신청에 이 행보다 늦게 요청된 행이 없다.
              notExists(
                db
                  .select({ one: sql`1` })
                  .from(laterIssueApproval)
                  .where(
                    and(
                      eq(laterIssueApproval.issueRequestId, inventoryPartIssueApprovals.issueRequestId),
                      gt(laterIssueApproval.requestedAt, inventoryPartIssueApprovals.requestedAt)
                    )
                  )
              ),
            ]
          : [
              // 반려로 끝난 신청만 — 취소(CANCELLED)로 닫힌 신청의 결재 행은 표에
              // REJECTED 로 남지만 신청 상태가 다르다.
              eq(inventoryPartIssueRequests.status, "REJECTED"),
            ])
      )
    )
    .orderBy(desc(inventoryPartIssueApprovals.decidedAt), desc(inventoryPartIssueApprovals.id));

  return rows.flatMap((row) => {
    if (row.decidedAt === null) return [];
    // 취소로 닫힌 행을 가리는 판정은 순수 규칙 하나가 쥐고 있다 — 재고 화면의 결재
    // 이력이 「신청자가 취소함」으로 그리는 바로 그 판정이다. SQL 이 이미 같은 것을
    // 걸렀지만, 판정이 두 벌로 갈라지지 않게 여기서도 그 함수를 거친다.
    if (isPartIssueApprovalClosedByRequester(row)) return [];
    return [
      {
        source: "PART_ISSUE" as const,
        approvalId: row.approvalId,
        partRequestId: row.partRequestId,
        intakeNumber: row.directIntakeNumber ?? row.partRequestIntakeNumber,
        destinationNote: row.destinationNote,
        decidedByName: row.decidedByName ?? "",
        decidedAt: row.decidedAt,
        decisionReason: row.decisionReason,
      },
    ];
  });
}

// ──────────────────────────────────────────────────────────────── 바깥 입구

/**
 * 내가 요청한 결재 중 **최근 창 안에 최종 승인된** 것 — 세 결재 모두, 결정이 늦은
 * 것부터.
 */
export async function listMyGrantedApprovalOutcomes(
  requesterUserId: string,
  options: OutcomeOptions = {}
): Promise<ApprovalOutcome[]> {
  const since = approvalOutcomeNotificationWindowStart(options.now ?? new Date());
  const [cases, partIssues] = await Promise.all([
    listRepairCaseApprovalOutcomes(requesterUserId, "APPROVED", since),
    listPartIssueApprovalOutcomes(requesterUserId, "APPROVED", since),
  ]);
  return [...cases, ...partIssues].sort(byDecisionNewestFirst);
}

/**
 * 내가 요청한 결재 중 **최근 창 안에 반려된** 것 — 어느 단계에서든, 세 결재 모두,
 * 결정이 늦은 것부터. 내가 스스로 닫은 것(취소·자기 결정)은 빠진다.
 */
export async function listMyRejectedApprovalOutcomes(
  requesterUserId: string,
  options: OutcomeOptions = {}
): Promise<ApprovalOutcome[]> {
  const since = approvalOutcomeNotificationWindowStart(options.now ?? new Date());
  const [cases, partIssues] = await Promise.all([
    listRepairCaseApprovalOutcomes(requesterUserId, "REJECTED", since),
    listPartIssueApprovalOutcomes(requesterUserId, "REJECTED", since),
  ]);
  return [...cases, ...partIssues].sort(byDecisionNewestFirst);
}
