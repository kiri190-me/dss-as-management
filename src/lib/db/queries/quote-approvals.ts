import "server-only";
import { desc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "../client";
import { quoteApprovals, quotes, users } from "../schema";
import {
  resolveQuoteApprovalState,
  type QuoteApprovalState,
  type QuoteApprovalStatus,
} from "@/lib/domain/quote-approval-rules";

const requester = alias(users, "quote_approval_requester");
const decider = alias(users, "quote_approval_decider");
const assignedApprover = alias(users, "quote_approval_assigned_approver");

/**
 * ============================================================================
 * 견적서 결재 읽기 — 「이 견적서의 결재가 지금 어디까지 왔나」
 * ============================================================================
 * queries/repair-case-approvals.ts 와 같은 결이다. 다음 조각의 화면이 물어볼
 * 것 셋에 답한다:
 *  1. 지금 결재 요청이 올라가 있는가, 어느 단계인가 → `getQuoteApprovalProgress`
 *  2. 🔴 승인이 끝났는가, **그리고 그 승인이 지금 내용에 대한 것인가**
 *  3. 결재 이력(누가 언제 무엇을) → `getQuoteApprovalHistory`
 *
 * ── 🔴 아무 문도 여닫지 않는다 ─────────────────────────────────────────
 * **결재가 끝나기 전에도 견적서를 발행할 수 있다**(2026-09-18 사용자 결정).
 * 여기서 돌려주는 값은 **표시**를 위한 것이다. 발행 통로
 * (server/services/quote-issue.ts · api/quotes/[id]/…)에서 이 함수들을 부르지
 * 말 것 — 그것은 빠뜨린 것이 아니라 정해진 것이다.
 *
 * ── 🔴 「낡은 승인」을 조용히 재사용하지 않는다 ─────────────────────────
 * 승인이 있어도 그 뒤에 견적서가 바뀌었으면 「지금 이 내용에 대한 승인」이
 * 아니다. 그 갈림은 여기 적지 않고 순수 함수 하나가 쥐고 있다
 * (domain/quote-approval-rules.ts 의 resolveQuoteApprovalState). 화면도 같은
 * 함수를 부를 수 있어야 하기 때문이다 — 두 곳에 적으면 화면은 「승인 완료」라는데
 * 기록은 「낡았다」고 답하는 날이 온다.
 * ============================================================================
 */

export type QuoteApprovalRecordRow = {
  id: string;
  status: QuoteApprovalStatus;
  requestedByUserId: string;
  requestedByName: string;
  /** ISO 문자열 — 서버 컴포넌트 경계를 넘어야 하므로 Date 를 그대로 보내지 않는다. */
  requestedAt: string;
  requestReason: string | null;
  /**
   * 이 요청을 처리하도록 지정된 사람. 결재선을 타는 요청에는 언제나 채워져
   * 있다(요청 경로가 판과 지정을 함께 넣는다). 화면이 이 값을
   * mayDecideAssignedApproval 에 그대로 넘겨 단추를 열지 말지 정한다.
   */
  assignedApproverUserId: string | null;
  /** 지정된 사람의 이름. 지정이 없으면 `null`. */
  assignedApproverName: string | null;
  /**
   * 🔴 **「현재 판」이 아니라 요청 시점에 붙잡아 둔 판**이다. 진행 중인 건은
   * 관리자가 절차를 바꿔도 이 판을 끝까지 따라간다. 「몇/몇 단계」를 그리려면
   * 이 판으로 단계 수를 세야 한다(queries/shipment-approval-routes.ts 의
   * listShipmentApprovalRouteSteps 가 그 자리다).
   */
  routeId: string | null;
  /** 그 판 안에서 몇 번째 단계인가(1부터). `routeId` 와 함께 있거나 함께 없다. */
  routeStepOrder: number | null;
  decidedByUserId: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
  decisionReason: string | null;
  /** 🔴 요청한 순간의 `quotes.version`. 「지금 내용에 대한 승인인가」의 근거다. */
  quoteVersionAtRequest: number;
};

const SELECT_COLUMNS = {
  id: quoteApprovals.id,
  status: quoteApprovals.status,
  requestedByUserId: quoteApprovals.requestedByUserId,
  requestedByName: requester.name,
  requestedAt: quoteApprovals.requestedAt,
  requestReason: quoteApprovals.requestReason,
  assignedApproverUserId: quoteApprovals.assignedApproverUserId,
  assignedApproverName: assignedApprover.name,
  routeId: quoteApprovals.routeId,
  routeStepOrder: quoteApprovals.routeStepOrder,
  decidedByUserId: quoteApprovals.decidedByUserId,
  decidedByName: decider.name,
  decidedAt: quoteApprovals.decidedAt,
  decisionReason: quoteApprovals.decisionReason,
  quoteVersionAtRequest: quoteApprovals.quoteVersionAtRequest,
};

function baseQuery() {
  return db
    .select(SELECT_COLUMNS)
    .from(quoteApprovals)
    .innerJoin(requester, eq(quoteApprovals.requestedByUserId, requester.id))
    // LEFT JOIN — 아직 결정되지 않은 행, 지정이 없는 행이 여기서 떨어지면 안 된다.
    .leftJoin(decider, eq(quoteApprovals.decidedByUserId, decider.id))
    .leftJoin(assignedApprover, eq(quoteApprovals.assignedApproverUserId, assignedApprover.id));
}

function toRow(row: Awaited<ReturnType<typeof baseQuery>>[number]): QuoteApprovalRecordRow {
  return {
    ...row,
    requestedAt: row.requestedAt.toISOString(),
    decidedAt: row.decidedAt ? row.decidedAt.toISOString() : null,
  };
}

/**
 * 그 견적서의 결재 이력 전부 — **최신이 먼저**다.
 *
 * 줄은 고쳐 쓰지 않으므로(append 계열, 스키마 머리말) 이 한 번의 조회가 곧
 * 완전한 역사다. 단계마다 행이 하나씩이라 3단계 결재선이면 행이 셋이다.
 */
export async function getQuoteApprovalHistory(quoteId: string): Promise<QuoteApprovalRecordRow[]> {
  const rows = await baseQuery()
    .where(eq(quoteApprovals.quoteId, quoteId))
    .orderBy(desc(quoteApprovals.requestedAt));
  return rows.map(toRow);
}

export type QuoteApprovalProgress = {
  /** 화면이 그릴 한 마디. 뜻은 domain/quote-approval-rules.ts 에 적혀 있다. */
  state: QuoteApprovalState;
  /** 지금 견적서의 판 번호 — 위 상태를 정한 근거의 한쪽이다. */
  currentQuoteVersion: number;
  /**
   * 가장 최근 결재 행. 한 번도 올린 적이 없으면 `null`(= NOT_REQUESTED).
   *
   * 「어느 단계인가」·「누구 차례인가」는 이 행의 routeId · routeStepOrder ·
   * assignedApproverUserId 가 답한다.
   */
  latest: QuoteApprovalRecordRow | null;
};

/**
 * 그 견적서의 결재가 지금 어디까지 왔나. 견적서가 없거나 휴지통이면 `null` —
 * 화면에 없는 장의 결재 상태를 말할 이유가 없다.
 *
 * 🔴 **판 번호를 부르는 쪽에서 받지 않고 여기서 함께 읽는다.** 받게 하면 낡은
 * 값을 넘기는 자리가 언젠가 생기고, 그때 이 함수는 바뀐 견적서를 「승인 완료」로
 * 답한다 — 이 기능이 막으려는 바로 그 사고다.
 *
 * 🔴 **가장 최근 행 하나만 본다.** 다단계 결재선은 단계마다 행을 하나씩 잇는
 * 구조라, 사슬의 지금 상태는 언제나 마지막 행이 말한다. 「가장 최근」의 정의는
 * `requested_at` 내림차순이고, 사슬을 잇는 저장 경로가 requested_at 을 물려받지
 * 않는 이유가 바로 이 조회를 정해지게 하기 위해서다.
 */
export async function getQuoteApprovalProgress(
  quoteId: string
): Promise<QuoteApprovalProgress | null> {
  const [quote] = await db
    .select({ version: quotes.version, isDeleted: quotes.isDeleted })
    .from(quotes)
    .where(eq(quotes.id, quoteId))
    .limit(1);
  if (!quote || quote.isDeleted) return null;

  const [row] = await baseQuery()
    .where(eq(quoteApprovals.quoteId, quoteId))
    .orderBy(desc(quoteApprovals.requestedAt))
    .limit(1);

  const latest = row ? toRow(row) : null;
  return {
    state: resolveQuoteApprovalState(latest, quote.version),
    currentQuoteVersion: quote.version,
    latest,
  };
}
