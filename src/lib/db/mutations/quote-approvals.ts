import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { db } from "../client";
import { quoteApprovals, quotes, users } from "../schema";
import { mayDecideAssignedApproval } from "@/lib/auth/approval-assignment";
import { hasPermission } from "@/lib/auth/permission-resolver";
import {
  QUOTE_APPROVAL_ROUTE_SCOPE,
  isQuoteApprovalRouteInForce,
} from "@/lib/domain/quote-approval-rules";
import { findNextRouteStepToApprove } from "@/lib/domain/shipment-approval-route";
import {
  getCurrentShipmentApprovalRouteChain,
  getShipmentApprovalRouteSteps,
} from "../queries/shipment-approval-routes";
import { resolveEligibleActor } from "./procedure-templates";
import { acquireShipmentApprovalRouteSharedLock } from "./shipment-approval-routes";

/**
 * ============================================================================
 * 견적서 결재 — 요청 · 승인 · 반려
 * ============================================================================
 * mutations/inventory-part-issue-requests.ts 의 결재 두 함수를 그대로 본떴다
 * (그쪽이 mutations/repair-case-approvals.ts 를 본뜬 것이다). 세 결재가 **같은
 * 결재선 표**를 쓰므로 사슬을 잇는 방식도 한 벌이어야 한다 — 단계마다 요청 행을
 * 하나씩 만들고, 그 행의 지정된 사람이 그 단계의 승인자가 된다
 * (auth/approval-assignment.ts 머리말이 적어 둔 방식이다).
 *
 * ── 🔴 이 파일은 아무 문도 닫지 않는다 ──────────────────────────────────
 * **결재가 끝나기 전에도 견적서를 발행할 수 있다**(2026-09-18 사용자 결정).
 * 최종 출하 승인·부품 불출은 절차가 켜져 있으면 그 문이 닫히지만, 견적서는
 * 그렇지 않다 — 여기 쌓이는 것은 **기록**이다(schema/quote-approvals.ts 머리말).
 * 발행 통로(server/services/quote-issue.ts · api/quotes/[id]/xlsx ·
 * api/quotes/[id]/issue)는 이 표를 한 번도 읽지 않고, 그래야 한다. 막아야 할
 * 필요가 생기면 코드를 고치기 전에 사용자에게 먼저 묻는다.
 *
 * ── 인가 ────────────────────────────────────────────────────────────────
 * 🔴 **새 권한 영역을 만들지 않는다.** 견적서 화면이 지금 쓰는 열쇠 그대로다
 * (server/actions/quotes.ts 의 `quotes` 사다리 — READ/WRITE/MANAGE).
 *
 *  · **요청**은 `quotes` WRITE 다. 견적서를 만들고 고치는 그 자리의 행동이고,
 *    올리는 사람은 언제나 그 장을 손에 쥔 사람이다.
 *  · **승인·반려**는 권한 영역을 보지 않는다 — 계정 자격(승인됨·활성·잠기지
 *    않음·삭제 안 됨)과 **지정 관문** 둘뿐이다. 🔴 결재선에 올라간 사람이 곧
 *    그 단계의 결재자라는 것이 이 기능의 설계이고, 이미 있는 두 결재선 경로
 *    (repair-case-approvals.ts 의 결재선 분기 · inventory-part-issue-requests.ts
 *    의 decide)가 **똑같이 권한 영역을 묻지 않는다.** 여기서만 `quotes` READ 를
 *    요구하면, 결재선에 올릴 수 있는 사람(역할 제한이 없다 —
 *    listSelectableApproverCandidates)과 결재할 수 있는 사람이 갈라져 **관리자가
 *    아무도 처리할 수 없는 절차를 만들 수 있게 된다.**
 *
 * ── 🔴 자격 검사(먼저) → 지정 관문(나중) ───────────────────────────────
 * 순서가 뒤집히면 **지정이 권한을 만들어 낸다**(auth/approval-assignment.ts 의
 * 머리말). 지정은 「자격 있는 사람들 중 누구」를 좁히는 것이지 자격을 주는 것이
 * 아니다. 판정 자체는 여기 새로 적지 않고 그 파일의 함수 하나를 부른다.
 * ============================================================================
 */

export type QuoteApprovalFailureCode =
  /** 견적서가 없다 · 휴지통이다 / 결재 요청이 없다. */
  | "NOT_FOUND"
  /** 이 사람은 이 일을 할 수 없다(권한·계정 자격·지정 관문). */
  | "FORBIDDEN"
  /** 반려인데 사유가 비어 있다. */
  | "VALIDATION_ERROR"
  /** 🔴 한 견적서에 살아 있는 요청은 하나다(quote_approvals_one_active_request). */
  | "ALREADY_REQUESTED"
  /**
   * 🔴 견적서 승인 절차(결재선)가 없거나 단계가 0개다. 단계 0개는 「절차를 쓰지
   * 않겠다」는 정상적인 뜻이고, 그때 견적서는 **결재 없이 그냥 발행한다** —
   * 승인 기록도 남지 않는다(domain/quote-approval-rules.ts 의
   * isQuoteApprovalRouteInForce 주석에 그 근거가 적혀 있다). 그래서 요청 자체를
   * 거절한다. FORBIDDEN 과 가르는 이유는 사람이 해야 할 다음 행동이 다르기
   * 때문이다 — 고쳐야 할 것은 이 사람의 권한이 아니라 **승인 절차 그 자체**다.
   */
  | "ROUTE_NOT_CONFIGURED"
  /** 단계는 있는데 전부 요청자 본인이라 보낼 곳이 없다. */
  | "ROUTE_HAS_NO_OTHER_APPROVER"
  /** 그 사이 남이 먼저 처리했다. */
  | "CONFLICT";

export type QuoteApprovalFailure = {
  ok: false;
  code: QuoteApprovalFailureCode;
  message: string;
};

export type RequestQuoteApprovalResult = { ok: true; id: string } | QuoteApprovalFailure;

export type DecideQuoteApprovalResult =
  | {
      ok: true;
      /** 방금 결정된 행. */
      id: string;
      /** 사슬이 이어졌으면 새로 열린 행, 끝났으면 `null`. */
      nextApprovalId: string | null;
    }
  | QuoteApprovalFailure;

class QuoteApprovalMutationError extends Error {
  result: QuoteApprovalFailure;
  constructor(result: QuoteApprovalFailure) {
    super(result.message);
    this.result = result;
  }
}

function fail(code: QuoteApprovalFailureCode, message: string): never {
  throw new QuoteApprovalMutationError({ ok: false, code, message });
}

/**
 * postgres-js 는 진짜 오류를 `.cause` 아래 싸서 올린다 — 겉 오류의 `.code` 는
 * 언제나 undefined 다(procedure-templates.ts 의 isPgUniqueViolation 과 같은 규약).
 */
function hasPgCode(err: unknown, code: string): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code?: unknown }).code === code;
}

function isUniqueViolation(err: unknown): boolean {
  if (hasPgCode(err, "23505")) return true;
  const cause = err instanceof Error ? err.cause : undefined;
  return hasPgCode(cause, "23505");
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * 행위자를 **이 트랜잭션 안에서 다시 읽는다** — 세션이 만들어진 뒤 역할이
 * 내려갔거나 계정이 잠겼을 수 있다. 조건(승인됨·활성·잠기지 않음·삭제 안 됨)을
 * 여기 한 벌 더 적지 않고 이미 있는 함수를 부른다.
 */
async function requireActor(tx: Tx, actorUserId: string) {
  try {
    return await resolveEligibleActor(tx, actorUserId);
  } catch {
    return fail("FORBIDDEN", "사용자 정보를 확인할 수 없습니다.");
  }
}

/**
 * 지정 관문에 막혔을 때 **누구에게 지정되어 있는지 이름을 넣어** 거절한다.
 * 「권한이 없습니다」만 돌려주면 사람은 무엇을 해야 할지 모른다.
 */
async function failAssignmentGate(tx: Tx, assignedApproverUserId: string | null): Promise<never> {
  const [assignee] = assignedApproverUserId
    ? await tx.select({ name: users.name }).from(users).where(eq(users.id, assignedApproverUserId))
    : [];
  return fail(
    "FORBIDDEN",
    assignee
      ? `이 결재는 ${assignee.name} 님에게 지정되어 있어 다른 사람은 처리할 수 없습니다.`
      : "이 결재는 지정된 승인자만 처리할 수 있습니다."
  );
}

export type RequestQuoteApprovalInput = {
  quoteId: string;
  actorUserId: string;
  /** 올리며 적는 말. 없어도 된다. */
  requestReason: string | null;
};

/**
 * 견적서 한 장의 결재를 올린다 — **첫 단계 행 하나만** 만든다.
 *
 * 🔴 요청 시점의 `quotes.version` 을 반드시 싣는다. 표에 기본값이 없으므로 안
 * 실으면 DB 가 거절하고, 그것이 의도다 — 기본값이 있으면 version 을 싣지 않은
 * 요청이 조용히 「1판에 대한 승인」이 된다(schema/quote-approvals.ts).
 */
export async function requestQuoteApproval(
  input: RequestQuoteApprovalInput
): Promise<RequestQuoteApprovalResult> {
  try {
    return await db.transaction(async (tx): Promise<RequestQuoteApprovalResult> => {
      // 🔴 결재선 공유 잠금 — 이 트랜잭션의 **첫 잠금**이다. 판을 읽어 첫 단계
      // 승인자를 지정하는 동안 결재선 저장 · 사용자 계정 삭제(배타 잠금)가
      // 끼어들지 못하게 한다(mutations/shipment-approval-routes.ts 의 도우미 주석).
      await acquireShipmentApprovalRouteSharedLock(tx);

      const actor = await requireActor(tx, input.actorUserId);

      // 인가 — 견적서를 고칠 수 있는 사람이 올린다(파일 머리말의 「인가」).
      if (!(await hasPermission(actor, "quotes", "WRITE"))) {
        fail("FORBIDDEN", "이 작업을 수행할 권한이 없습니다.");
      }

      // 🔴 판 번호를 **잠근 행에서** 읽는다. 잠그지 않으면 방금 읽은 version 이
      // 커밋 직전에 updateQuote 로 올라가, 처음부터 낡은 승인이 되어 버린다
      // (updateQuote 도 같은 행을 FOR UPDATE 로 잡는다 — 둘이 줄을 선다).
      const [quote] = await tx
        .select({ id: quotes.id, version: quotes.version, isDeleted: quotes.isDeleted })
        .from(quotes)
        .where(eq(quotes.id, input.quoteId))
        .limit(1)
        .for("update");
      if (!quote || quote.isDeleted) {
        // 휴지통의 장은 목록에 없다 — 화면에 없는 것에 결재를 올릴 수는 없다.
        fail("NOT_FOUND", "해당 견적서를 찾을 수 없습니다.");
      }

      // 트랜잭션 안 재확인이 앞단이고, 부분 유니크 색인이 DB 쪽 최종 방어선이다
      // (아래 catch 의 23505). 둘 다 있어야 동시에 두 사람이 올릴 때 결재선이
      // 둘로 갈라지지 않는다.
      const [existingActive] = await tx
        .select({ id: quoteApprovals.id })
        .from(quoteApprovals)
        .where(
          and(eq(quoteApprovals.quoteId, input.quoteId), eq(quoteApprovals.status, "REQUESTED"))
        );
      if (existingActive) {
        fail("ALREADY_REQUESTED", "이미 처리 대기 중인 결재 요청이 있습니다.");
      }

      // 🔴 「현재 판」의 정의는 여기 적지 않는다 — 그 용도 안에서 version 이 가장
      // 큰 판 하나이고, 그 정의가 적힌 곳은 queries/shipment-approval-routes.ts
      // 하나다. 용도 문자열도 글자로 적지 않는다(도메인 상수 하나).
      const route = await getCurrentShipmentApprovalRouteChain(tx, QUOTE_APPROVAL_ROUTE_SCOPE);
      if (!isQuoteApprovalRouteInForce(route)) {
        // 판이 없는 것도 단계가 0개인 것도 「절차를 쓰지 않겠다」는 같은 뜻이다.
        // 그때는 결재 없이 발행하며 승인 기록도 남지 않는다 — 그 근거는
        // domain/quote-approval-rules.ts 의 isQuoteApprovalRouteInForce 주석.
        fail(
          "ROUTE_NOT_CONFIGURED",
          "견적서 승인 절차가 아직 설정되지 않았습니다. 사용자 관리 > 승인 절차에서 견적서 승인 절차를 먼저 만들어 주세요."
        );
      }

      // 🔴 고르는 규칙을 여기 적지 않는다 — 아래 사슬 잇는 자리가 **같은 함수**를
      // 부른다. 두 곳에 적으면 「요청할 때는 건너뛰는데 사슬에서는 안 건너뛴다」가
      // 되고, 그때 요청자는 자기 차례를 받아 자기가 올린 것을 결재하게 된다.
      const firstStep = findNextRouteStepToApprove(route.steps, 0, actor.id);
      if (!firstStep) {
        fail(
          "ROUTE_HAS_NO_OTHER_APPROVER",
          "승인 절차의 모든 단계가 요청자 본인으로 지정되어 있어 결재를 요청할 수 없습니다. 승인 절차에 다른 사람을 넣어 주세요."
        );
      }

      const [inserted] = await tx
        .insert(quoteApprovals)
        .values({
          quoteId: quote.id,
          status: "REQUESTED",
          requestedByUserId: actor.id,
          requestReason: input.requestReason,
          assignedApproverUserId: firstStep.approverUserId,
          // 🔴 판과 단계는 **한 쌍**으로 넣는다(CHECK 이 그것을 지킨다). 요청
          // 시점의 판을 붙잡아 두어, 관리자가 절차를 바꿔도 이미 올라간 건은 옛
          // 판을 끝까지 따라간다.
          routeId: route.routeId,
          // 🔴 **건너뛴 뒤의 실제 번호**를 적는다(예: 2). 1로 고쳐 적으면 이
          // 번호로 옛 판의 다음 단계를 찾을 때 이미 지나온 단계로 되돌아간다.
          routeStepOrder: firstStep.stepOrder,
          // 🔴 「승인 뒤 내용이 바뀌면 그 승인은 무효」가 이 한 칸에 걸려 있다.
          quoteVersionAtRequest: quote.version,
        })
        .returning({ id: quoteApprovals.id });

      return { ok: true, id: inserted.id };
    });
  } catch (err) {
    if (err instanceof QuoteApprovalMutationError) return err.result;
    if (isUniqueViolation(err)) {
      return {
        ok: false,
        code: "ALREADY_REQUESTED",
        message: "이미 처리 대기 중인 결재 요청이 있습니다.",
      };
    }
    throw err;
  }
}

export type DecideQuoteApprovalInput = {
  quoteId: string;
  decision: "APPROVED" | "REJECTED";
  actorUserId: string;
  /** 🔴 반려에는 **필수**다(표의 quote_approvals_decision_metadata CHECK). */
  decisionReason: string | null;
};

/**
 * 한 단계를 승인하거나 반려한다 — 그리고 승인이면 **다음 단계를 이어 연다.**
 *
 * 반려면 사슬이 거기서 끊긴다. 다시 받으려면 **새 요청**을 올린다 — 상태에
 * `CHANGES_REQUESTED` 를 두지 않은 이유가 그것이다(schema/quote-approvals.ts).
 */
export async function decideQuoteApproval(
  input: DecideQuoteApprovalInput
): Promise<DecideQuoteApprovalResult> {
  try {
    return await db.transaction(async (tx): Promise<DecideQuoteApprovalResult> => {
      // 🔴 결재선 공유 잠금 — 요청 경로와 같은 이유로 **첫 잠금**이다. 아래에서
      // 사슬을 이을 때 판의 다음 단계 승인자를 지정하는데, 그 사이 사용자 계정
      // 삭제가 커밋되면 지워진 사람에게 다음 행이 간다. 결정할 행을 FOR UPDATE 로
      // 잠그기 **전에** 건다 — 뒤에 걸면 삭제(배타 잠금 → 결재 행)와 교착한다.
      await acquireShipmentApprovalRouteSharedLock(tx);

      const actor = await requireActor(tx, input.actorUserId);

      // 🔴 여기서는 견적서 행을 잠그지 않는다. 판 번호를 새로 찍지 않고 앞 행에서
      // 물려받기 때문이다(아래) — 잠글 이유가 없는 행을 잠그면 결재가 견적서
      // 수정과 쓸데없이 줄을 서게 된다.
      const [quote] = await tx
        .select({ id: quotes.id, isDeleted: quotes.isDeleted })
        .from(quotes)
        .where(eq(quotes.id, input.quoteId))
        .limit(1);
      if (!quote || quote.isDeleted) {
        fail("NOT_FOUND", "해당 견적서를 찾을 수 없습니다.");
      }

      // 가장 최근 행을 **잠그고** 읽는다 — 같은 행을 동시에 결재하려는 트랜잭션이
      // 여기서 줄을 선다. 뒤에 온 쪽은 커밋 뒤의 상태를 다시 읽고 CONFLICT 다.
      const [latest] = await tx
        .select({
          id: quoteApprovals.id,
          status: quoteApprovals.status,
          assignedApproverUserId: quoteApprovals.assignedApproverUserId,
          routeId: quoteApprovals.routeId,
          routeStepOrder: quoteApprovals.routeStepOrder,
          requestedByUserId: quoteApprovals.requestedByUserId,
          requestReason: quoteApprovals.requestReason,
          quoteVersionAtRequest: quoteApprovals.quoteVersionAtRequest,
        })
        .from(quoteApprovals)
        .where(eq(quoteApprovals.quoteId, quote.id))
        .orderBy(desc(quoteApprovals.requestedAt))
        .limit(1)
        .for("update");
      if (!latest) fail("NOT_FOUND", "관련 결재 요청을 찾을 수 없습니다.");

      // 🔴 잠근 행에서 상태를 **다시 확인**한다. 화면이 무엇을 보여 줬든 상관없다.
      if (latest.status !== "REQUESTED") {
        fail("CONFLICT", "이미 처리된 결재입니다. 최신 정보를 다시 불러와 주세요.");
      }

      // 🔴 지정 관문 — 계정 자격(requireActor)을 본 **뒤에** 얹는다. 순서가
      // 뒤집히면 지정이 권한을 만들어 낸다. 판정은 여기서 새로 적지 않고 출하
      // 승인·부품 불출·알림 조회와 **같은 함수 하나**를 부른다. 최고관리자
      // 비상구도 그 함수 안에 있다 — 지정된 사람이 자리를 비워 영영 막히는 것을
      // 막는 유일한 길이다.
      if (
        !mayDecideAssignedApproval(latest.assignedApproverUserId, {
          id: actor.id,
          role: actor.role,
          isDeveloper: actor.isDeveloper,
        })
      ) {
        await failAssignmentGate(tx, latest.assignedApproverUserId);
      }

      if (input.decision === "REJECTED" && !input.decisionReason) {
        // 표의 CHECK 이 최종적으로 막지만, 여기서 먼저 사람 말로 말한다 — 거기서
        // 걸리면 사람에게는 「알 수 없는 오류」로만 보인다.
        fail("VALIDATION_ERROR", "반려 시에는 사유를 입력해야 합니다.");
      }

      const decided = await tx
        .update(quoteApprovals)
        .set({
          status: input.decision,
          decidedByUserId: actor.id,
          decidedAt: new Date(),
          decisionReason: input.decisionReason,
          updatedAt: new Date(),
        })
        .where(and(eq(quoteApprovals.id, latest.id), eq(quoteApprovals.status, "REQUESTED")))
        .returning({ id: quoteApprovals.id });
      if (decided.length === 0) {
        fail("CONFLICT", "이미 처리된 결재입니다. 최신 정보를 다시 불러와 주세요.");
      }

      if (input.decision === "REJECTED") {
        // 사슬이 끊긴다 — 다음 행을 만들지 않는다. 다시 받으려면 새 요청을
        // 올린다(그때 1단계부터 다시 시작한다).
        return { ok: true, id: latest.id, nextApprovalId: null };
      }

      // 🔴 사슬을 잇는다 — 반드시 위의 UPDATE **뒤**다. 앞 행이 아직 REQUESTED 인
      // 채로 INSERT 하면 quote_approvals_one_active_request(부분 유니크)에 걸린다.
      // 그 인덱스가 곧 「한 번에 한 단계」의 보증이므로 우회하지 않고 순서로 푼다.
      let nextApprovalId: string | null = null;
      if (latest.routeId !== null && latest.routeStepOrder !== null) {
        // 「현재 판」이 아니라 **이 행에 적힌 판**으로 다음 단계를 찾는다 —
        // 진행 중인 건은 관리자가 절차를 바꿔도 옛 판을 끝까지 따라간다.
        //
        // 🔴 요청자는 **이 사슬을 올린 사람**(latest.requestedByUserId)이지 방금
        // 결재한 사람이 아니다. 사슬이 나아가도 요청자는 그대로이고, 그 값이 다음
        // 행에 그대로 물려 내려간다.
        const steps = await getShipmentApprovalRouteSteps(tx, latest.routeId);
        const nextStep = findNextRouteStepToApprove(
          steps,
          latest.routeStepOrder,
          latest.requestedByUserId
        );
        if (nextStep) {
          const [next] = await tx
            .insert(quoteApprovals)
            .values({
              quoteId: quote.id,
              status: "REQUESTED",
              // 요청은 여전히 그 사람이 한 것이다 — 사슬이 나아갈 뿐이라
              // 요청자·사유를 물려받는다.
              requestedByUserId: latest.requestedByUserId,
              requestReason: latest.requestReason,
              assignedApproverUserId: nextStep.approverUserId,
              routeId: latest.routeId,
              routeStepOrder: nextStep.stepOrder,
              // 🔴 판 번호도 물려받는다. 단계마다 새로 찍으면 견적서가 중간에
              // 바뀌었을 때 1단계는 무효인데 3단계만 멀쩡해 보인다 — 견적서가
              // 바뀌면 결재선 **전체**가 무효여야 한다.
              quoteVersionAtRequest: latest.quoteVersionAtRequest,
              // 🔴 requested_at 은 물려받지 않는다(표 기본값 now()). 앞 행과 같은
              // 시각이 되면 「가장 최근 행」을 고르는 조회가 어느 행을 고를지
              // 정해지지 않는다.
            })
            .returning({ id: quoteApprovals.id });
          nextApprovalId = next.id;
        }
      }

      // 다음 단계가 없으면 거기서 끝이다 — 마지막 단계였거나, 남은 단계가 전부
      // 요청자 본인이었다. 둘 다 정상이고, 그때 가장 최근 행이 APPROVED 로 남아
      // 조회가 「승인 완료」라고 답한다(queries/quote-approvals.ts).
      return { ok: true, id: latest.id, nextApprovalId };
    });
  } catch (err) {
    if (err instanceof QuoteApprovalMutationError) return err.result;
    if (isUniqueViolation(err)) {
      return {
        ok: false,
        code: "CONFLICT",
        message: "이미 처리 대기 중인 결재가 있습니다. 최신 정보를 다시 불러와 주세요.",
      };
    }
    throw err;
  }
}
