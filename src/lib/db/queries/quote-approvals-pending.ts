import "server-only";
import { and, asc, eq, isNull } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "../client";
import { quoteApprovals, quotes, users } from "../schema";
import { mayDecideAssignedApproval } from "@/lib/auth/approval-assignment";

/**
 * ============================================================================
 * 내가 결재해야 할 견적서 — 종 알림 「견적서 결재 대기」의 원본
 * ============================================================================
 * 🔴 **이 파일은 아무것도 쓰지 않고, 아무 문도 여닫지 않는다.** 결재가 끝나기
 * 전에도 견적서는 발행된다(2026-09-18 사용자 결정 — schema/quote-approvals.ts ·
 * mutations/quote-approvals.ts 머리말). 여기서 하는 일은 「지금 누구 차례인가」를
 * 읽어 종에 한 줄을 세우는 것뿐이다.
 *
 * 🔴 **앞 조각의 조회(queries/quote-approvals.ts)를 고치지 않고 따로 둔다.** 그쪽은
 * 「이 견적서 한 장의 결재가 어디까지 왔나」를 답하고(화면 하나가 부른다), 여기는
 * 「이 사람이 결재할 견적서가 무엇무엇인가」를 여러 장에 걸쳐 가로로 훑는다 —
 * queries/repair-case-approvals.ts 와 repair-case-approvals-pending.ts 가 갈라져
 * 있는 것과 같은 갈림이다.
 *
 * ── 판정을 새로 만들지 않는다 ───────────────────────────────────────────
 * 「이 결재를 내가 처리할 수 있는가」는 출하 승인·부품 불출과 **같은 함수 하나**를
 * 본다 — auth/approval-assignment.ts 의 `mayDecideAssignedApproval`(지정된 사람,
 * 또는 최고관리자 비상구). 실제로 승인·반려를 막는 decideQuoteApproval 이 자기
 * 트랜잭션 안에서 부르는 바로 그 함수다. 여기서 한 벌 더 적으면 알림에는 뜨는데
 * 눌러도 거절되는(또는 그 반대의) 어긋남이 생기고, 후자는 화면에 아무 표시도
 * 남기지 않아 더 나쁘다.
 *
 * ── 🔴 최고관리자에게도 뜬다 — 기존 결재 알림 둘과 같다 ──────────────────
 * 비상구는 「지정된 사람이 자리를 비워 영영 막히는 것」을 막는 유일한 길이고,
 * REPAIR_CASE_APPROVAL · PART_ISSUE_APPROVAL_PENDING 이 이미 같은 함수로 같게
 * 동작한다. 여기서만 비상구를 닫으면 판정이 두 벌이 되고, 견적서 결재만 막혔을 때
 * 풀 사람이 없어진다.
 *
 * 다만 견적서는 두 알림보다 **좁다**: 견적서 결재 요청은 언제나 결재선을 타므로
 * (판이 없거나 단계가 0개면 요청 자체가 거절된다 —
 * domain/quote-approval-rules.ts 의 isQuoteApprovalRouteInForce) 지정이 NULL 인 행이
 * 생기지 않는다. 즉 「지정된 사람 + 최고관리자」 말고는 아무에게도 뜨지 않는다.
 *
 * ── 처리된 건은 뜨지 않는다 · 한 장에 한 줄이다 ─────────────────────────
 * 후보는 **아직 결정되지 않은 행**(`status = 'REQUESTED'`)뿐이다. 승인·반려된 행은
 * 다음 조회에서 저절로 빠지고, 다단계 결재선은 앞 행을 닫은 **뒤에** 다음 행을
 * 여는 사슬이라(mutations/quote-approvals.ts) 열린 행은 한 장에 언제나 하나다 —
 * 표의 부분 유니크(quote_approvals_one_active_request)가 그것을 지킨다. 그래서 한
 * 요청에 알림도 하나다.
 *
 * ── 견적서가 사라진 결재 ────────────────────────────────────────────────
 * `quotes` 에 INNER JOIN 하고 휴지통(`is_deleted`)을 뺀다. 견적서가 완전 삭제되면
 * `quote_id` 가 NULL 로 풀리는데(표의 ON DELETE SET NULL), 그 행은 조인에서 떨어진다.
 * 접수 건 결재 대기 조회가 같은 이유로 같게 처리한다 — 눌러도 갈 화면이 없는 알림을
 * 세우지 않는다.
 * ============================================================================
 */

const approvalRequester = alias(users, "quote_pending_approval_requester");

/** 지정 관문(mayDecideAssignedApproval)에 그대로 넘기는 최소 모양. */
type AssignmentActor = { id: string; role: string; isDeveloper: boolean };

/**
 * 결재선 단계를 맡을 수 있는 계정인가 — 조건은 「결재선에 올릴 수 있는 사람」
 * (queries/shipment-approval-routes.ts 의 listSelectableApproverCandidates)과 글자
 * 그대로 같다: 승인됨 · 활성 · 잠기지 않음 · 삭제 안 됨. 역할 제한은 없다(결재선
 * 지정에도 없고, 그래서 decideQuoteApproval 도 권한 영역을 묻지 않는다).
 *
 * 🔴 여기서 사람을 더 좁히지 않는 것이 의도다. 넓게 물어도 아래에서 지정 관문이 그
 * 단계의 승인자(와 최고관리자)로 좁힌다. 반대로 여기서 좁히면 **최고관리자 비상구가
 * 함께 닫힌다** — 자기 단계가 아니면 물어보지도 않게 되므로.
 */
async function resolveQuoteApprovalActor(actorUserId: string): Promise<AssignmentActor | null> {
  const [actor] = await db
    .select({
      id: users.id,
      role: users.role,
      isDeveloper: users.isDeveloper,
    })
    .from(users)
    .where(
      and(
        eq(users.id, actorUserId),
        eq(users.isDeleted, false),
        eq(users.approvalStatus, "APPROVED"),
        eq(users.isActive, true),
        isNull(users.lockedAt)
      )
    );

  return actor ?? null;
}

export type PendingQuoteApprovalItem = {
  quoteId: string;
  /** 그 장의 발행번호 — 알림이 굵게 적는 값이다. */
  quoteNumber: string;
  /** 지금 열려 있는 결재 행. 한 장에 하나뿐이다(파일 머리말). */
  approvalId: string;
  /** 그 행이 판의 몇 번째 단계인가(1부터). 결재선을 타지 않는 행이면 `null`. */
  routeStepOrder: number | null;
  requestedByUserId: string;
  requestedByName: string;
  /** ISO 문자열 — 서버 컴포넌트 경계를 넘을 수 있게 Date 를 그대로 보내지 않는다. */
  requestedAt: string;
};

/**
 * 내가 지금 결재해야 할 견적서들 — 오래 기다린 것부터.
 *
 * ⚠️ **실패하는 방향이 조용하다.** 잘못 좁히면 처리해야 할 사람이 알림을 못 받는데,
 * 그 실패는 화면에 아무 표시도 남기지 않는다(그냥 안 뜬다). 그래서 좁히는 자리를
 * 하나로 모아 두고(`mayDecideAssignedApproval`) 통합 시험이 그 경로를 못 박는다.
 *
 * 읽기 전용이고 최종 판정도 아니다 — 실제 승인·반려는 decideQuoteApproval 이 자기
 * 트랜잭션 안에서 전부 다시 확인한다.
 */
export async function listQuoteApprovalsPendingMyApproval(
  actorUserId: string
): Promise<PendingQuoteApprovalItem[]> {
  const actor = await resolveQuoteApprovalActor(actorUserId);
  if (!actor) return [];

  const rows = await db
    .select({
      quoteId: quotes.id,
      quoteNumber: quotes.quoteNumber,
      approvalId: quoteApprovals.id,
      routeStepOrder: quoteApprovals.routeStepOrder,
      assignedApproverUserId: quoteApprovals.assignedApproverUserId,
      requestedByUserId: quoteApprovals.requestedByUserId,
      requestedByName: approvalRequester.name,
      requestedAt: quoteApprovals.requestedAt,
    })
    .from(quoteApprovals)
    // INNER JOIN — 완전 삭제로 quote_id 가 NULL 이 된 행이 여기서 떨어진다.
    .innerJoin(quotes, eq(quotes.id, quoteApprovals.quoteId))
    // 요청자는 NOT NULL + RESTRICT 라 언제나 실재하지만, 조인 하나가 잘못돼 줄이
    // 통째로 사라지는 실패 방식이 알림에서 가장 알아채기 어려워 LEFT JOIN 이다
    // (queries/inventory-part-issue-requests.ts 가 같은 이유로 같게 한다).
    .leftJoin(approvalRequester, eq(approvalRequester.id, quoteApprovals.requestedByUserId))
    .where(and(eq(quoteApprovals.status, "REQUESTED"), eq(quotes.isDeleted, false)))
    // 오래 기다린 것부터. 같은 시각이면 행 id 로 동점을 깬다 — 순서가 실행마다
    // 흔들리면 종 패널의 줄이 새로고침할 때마다 자리를 바꾼다.
    .orderBy(asc(quoteApprovals.requestedAt), asc(quoteApprovals.id));

  return rows
    // 🔴 지정이 걸린 건은 **그 사람과 최고관리자에게만** 보인다. 판정은 여기서 새로
    // 적지 않고 출하 승인·부품 불출·결재 mutation 과 같은 함수 하나를 부른다.
    .filter((row) => mayDecideAssignedApproval(row.assignedApproverUserId, actor))
    .map((row) => ({
      quoteId: row.quoteId,
      quoteNumber: row.quoteNumber,
      approvalId: row.approvalId,
      routeStepOrder: row.routeStepOrder,
      requestedByUserId: row.requestedByUserId,
      requestedByName: row.requestedByName ?? "",
      requestedAt: row.requestedAt.toISOString(),
    }));
}
