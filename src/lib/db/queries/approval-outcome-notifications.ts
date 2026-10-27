import "server-only";
import { and, desc, eq, gt, gte, ne, notExists, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "../client";
import { quoteApprovals, quotes, repairCaseApprovals, repairCases, users } from "../schema";
import { approvalOutcomeNotificationWindowStart, type ApprovalOutcomeTarget } from "@/lib/domain/notifications";

/**
 * ============================================================================
 * 내가 요청한 결재의 결과 — 종 알림 「승인 완료」·「반려됨」의 원본
 * ============================================================================
 * 결재를 **요청한 사람**에게 그 결과를 알리는 조회 둘이다. 대상 결재는 세 가지고
 * 표는 둘이다:
 *   · repair_case_approvals           — 수리 검수 승인 · 최종 출하 승인
 *   · quote_approvals                 — 견적서 승인
 * 두 표 모두 「단계마다 요청 행 하나, 앞 행을 결정한 뒤 다음 행을 넣는」 사슬 모양이고
 * (mutations/repair-case-approvals.ts · mutations/quote-approvals.ts 의 사슬 잇는 자리),
 * 요청자(`requested_by_user_id`)는 사슬 내내 처음 올린 사람 그대로다.
 *
 * 🔴 **셋째 표(`inventory_part_issue_approvals`, 부품 불출 승인)를 읽던 갈래는
 * 2026-10-27(조각 13-C4)에 들어냈다.** 누르면 갈 주소가 13-A 에서 404 가 됐고,
 * 재고는 별도 시스템(dss-inventory)이 제 알림을 포털로 직접 보낸다. 그 갈래가
 * 혼자 지고 있던 두 가지(신청 상태로 승인/반려를 한 번 더 가르는 일,
 * isPartIssueApprovalClosedByRequester 로 「신청자가 스스로 취소해 닫힌 행」을
 * 빼는 일)도 함께 사라졌다 — 남은 두 표에는 그런 상태 칸이 없다.
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
 *    스스로 결정한 경우와, 엔지니어가 자기 검수 요청을 스스로 승인한 경우가 여기
 *    걸린다. 자기가 한 일을 자기에게 알릴 이유가 없다.
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
 * 로 가른다. 묶음은 접수 건 결재면 (접수 건, 결재 종류), 견적서면 그 한 장이다. 이것은
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
 * ── 접수 건이 없어진 결재 ────────────────────────────────────────────────
 *  · 접수 건 결재: 기존 「결재 대기」 조회(repair-case-approvals-pending.ts)와 같이
 *    접수 건에 INNER JOIN 하고 휴지통(`is_deleted`)을 뺀다. 영구 삭제로
 *    repair_case_id 가 NULL 이 된 행과 휴지통에 간 건은 알리지 않는다 — 누르면 갈
 *    검수/승인 화면이 없다. 출하 완료로 잠긴 건(`is_locked`)은 빼지 않는다 — 대기
 *    조회와 달리 이쪽은 결과를 알리는 것이고, 출하 승인이 끝난 건이 곧 잠기는 것이
 *    정상 흐름이라 빼면 출하 승인 완료가 거의 알려지지 않는다.
 *  · 견적서: 접수 건 결재와 같다 — `quotes` 에 INNER JOIN 하고 휴지통(`is_deleted`)을
 *    뺀다. 완전 삭제로 `quote_id` 가 NULL 이 된 행은 조인에서 떨어진다. 누르면 갈
 *    화면이 없는 결과를 알리지 않는다는 같은 이유다(queries/quote-approvals-pending.ts).
 *    🔴 견적서에는 접수 건의 `is_locked` 같은 잠금이 없다 — 결재는 발행을 막지 않고
 *    (2026-09-18 사용자 결정) 발행도 결재를 막지 않으므로, 뺄 상태가 애초에 없다.
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
const laterQuoteApproval = alias(quoteApprovals, "later_quote_approval");

/** 결재 결과 한 건 — 종 알림 한 줄의 원본. */
export type ApprovalOutcome = ApprovalOutcomeTarget & {
  /** 결정한 사람의 이름. 승인 완료 알림의 detail 에 적힌다. */
  decidedByName: string;
  decidedAt: Date;
  /** 결정 사유. 반려면 표 CHECK 가 NULL 을 막는다. */
  decisionReason: string | null;
};

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

// ────────────────────────────────────────────────────────────────── 견적서

/**
 * 견적서 승인의 결과. 접수 건 결재와 **같은 모양**이다 — 사슬이 같고, 견적서에
 * INNER JOIN 해 휴지통·완전 삭제를 뺀다.
 *
 * 🔴 「최종 승인」의 묶음은 **견적서 하나**다. 접수 건 결재는 (건, 결재 종류)로 묶지만
 * 이 표에는 승인 종류 칸이 없다 — 견적서에 붙는 결재가 한 가지뿐이라 가를 것이 없다고
 * 표가 정해 두었다(schema/quote-approvals.ts).
 *
 * 🔴 **낡은 승인(APPROVED_OUTDATED)을 여기서 가리지 않는다.** 승인 뒤 견적서가 바뀌어
 * 그 승인이 「지금 내용에 대한 것」이 아니게 되어도, 그 시각에 승인이 났다는 **사건**은
 * 일어난 그대로다. 이 알림은 할 일이 아니라 사건을 알리는 것이고, 창(7일) 안에서 한 번
 * 뜬 뒤 눌러 확인하면 사라진다. 「다시 올려야 한다」는 지금 상태는 그 장의 [견적서 결재]
 * 탭이 배지와 문장으로 말한다(components/quotes/quote-approval-texts.ts 의
 * QUOTE_APPROVAL_OUTDATED_NOTICE) — 견적서를 고칠 때마다 종에 줄이 하나 서는 쪽이
 * 아니라.
 */
async function listQuoteApprovalOutcomes(
  requesterUserId: string,
  status: CaseOutcomeStatus,
  since: Date
): Promise<ApprovalOutcome[]> {
  const rows = await db
    .select({
      approvalId: quoteApprovals.id,
      quoteId: quotes.id,
      quoteNumber: quotes.quoteNumber,
      decidedByName: decider.name,
      decidedAt: quoteApprovals.decidedAt,
      decisionReason: quoteApprovals.decisionReason,
    })
    .from(quoteApprovals)
    // INNER JOIN — quote_id 가 NULL 인(완전 삭제된 견적서의) 행이 여기서 떨어진다.
    .innerJoin(quotes, eq(quotes.id, quoteApprovals.quoteId))
    .leftJoin(decider, eq(decider.id, quoteApprovals.decidedByUserId))
    .where(
      and(
        // 🔴 요청자 본인 — 이 조건이 빠지면 남의 결재 결과가 내 종에 뜬다. 결재 행의
        // 요청자는 사슬 내내 처음 올린 사람 그대로다(mutations/quote-approvals.ts 가
        // 다음 단계 행에 물려준다).
        eq(quoteApprovals.requestedByUserId, requesterUserId),
        eq(quoteApprovals.status, status),
        // 🔴 결정자가 요청자 본인이면 알리지 않는다. 견적서 결재에서는 요청 경로가
        // 요청자 본인 단계를 건너뛰므로(findNextRouteStepToApprove) 정상적으로는
        // 최고관리자가 비상구로 자기 요청을 스스로 결정한 경우뿐이다.
        ne(quoteApprovals.decidedByUserId, requesterUserId),
        gte(quoteApprovals.decidedAt, since),
        eq(quotes.isDeleted, false),
        ...(status === "APPROVED"
          ? [
              // 🔴 최종 승인 — 같은 견적서에 이 행보다 늦게 요청된 행이 없다.
              // getQuoteApprovalProgress 의 「가장 최근 행」과 같은 정의다(그쪽은 한
              // 장을 requested_at 내림차순으로 읽어 맨 앞 행을 고른다).
              notExists(
                db
                  .select({ one: sql`1` })
                  .from(laterQuoteApproval)
                  .where(
                    and(
                      eq(laterQuoteApproval.quoteId, quoteApprovals.quoteId),
                      gt(laterQuoteApproval.requestedAt, quoteApprovals.requestedAt)
                    )
                  )
              ),
            ]
          : [])
      )
    )
    .orderBy(desc(quoteApprovals.decidedAt), desc(quoteApprovals.id));

  return rows.flatMap((row) =>
    // 결정된 행은 decided_at 이 언제나 있다(표 CHECK). 타입을 좁히려는 것뿐이다.
    row.decidedAt === null
      ? []
      : [
          {
            source: "QUOTE" as const,
            approvalId: row.approvalId,
            quoteId: row.quoteId,
            quoteNumber: row.quoteNumber,
            decidedByName: row.decidedByName ?? "",
            decidedAt: row.decidedAt,
            decisionReason: row.decisionReason,
          },
        ]
  );
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
  const [cases, quoteOutcomes] = await Promise.all([
    listRepairCaseApprovalOutcomes(requesterUserId, "APPROVED", since),
    listQuoteApprovalOutcomes(requesterUserId, "APPROVED", since),
  ]);
  return [...cases, ...quoteOutcomes].sort(byDecisionNewestFirst);
}

/**
 * 내가 요청한 결재 중 **최근 창 안에 반려된** 것 — 어느 단계에서든, 세 결재 모두,
 * 결정이 늦은 것부터. 내가 스스로 결정한 것은 빠진다.
 */
export async function listMyRejectedApprovalOutcomes(
  requesterUserId: string,
  options: OutcomeOptions = {}
): Promise<ApprovalOutcome[]> {
  const since = approvalOutcomeNotificationWindowStart(options.now ?? new Date());
  const [cases, quoteOutcomes] = await Promise.all([
    listRepairCaseApprovalOutcomes(requesterUserId, "REJECTED", since),
    listQuoteApprovalOutcomes(requesterUserId, "REJECTED", since),
  ]);
  return [...cases, ...quoteOutcomes].sort(byDecisionNewestFirst);
}
