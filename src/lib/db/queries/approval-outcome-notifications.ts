import "server-only";
import { and, desc, eq, gt, gte, ne, notExists, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "../client";
import {
  domesticOrders,
  products,
  quoteApprovals,
  quotes,
  repairCaseApprovals,
  repairCases,
  users,
} from "../schema";
import { resolveDomesticOrderValue } from "@/lib/domain/domestic-order-list";
import {
  approvalOutcomeNotificationWindowStart,
  receivesOthersApprovalGrantedOutcomes,
  type ApprovalOutcomeTarget,
} from "@/lib/domain/notifications";
import type { Role } from "@/lib/domain/types";
import { isValidApprovalType } from "@/lib/validation/repair-case-approval-input";

/**
 * ============================================================================
 * 결재의 결과 — 종 알림 「승인 완료」·「반려됨」의 원본
 * ============================================================================
 * 결재가 끝났다는 것을 알리는 조회 둘이다. 🔴 **받는 사람은 둘이 서로 다르다**
 * (2026-11-12 — 아래 「누구에게 가는가」). 대상 결재는 네 가지고 표는 둘이다:
 *   · repair_case_approvals           — 수리 검수 승인 · 최종 출하 승인
 *   · repair_case_approvals (기타건)  — 기타건 최종 출하 승인 (2026-11-06)
 *   · quote_approvals                 — 견적서 승인
 * 두 표 모두 「단계마다 요청 행 하나, 앞 행을 결정한 뒤 다음 행을 넣는」 사슬 모양이고
 * (mutations/repair-case-approvals.ts · mutations/quote-approvals.ts ·
 * mutations/domestic-order-approvals.ts 의 사슬 잇는 자리), 요청자
 * (`requested_by_user_id`)는 사슬 내내 처음 올린 사람 그대로다.
 *
 * 🔴 **접수 건과 기타건은 같은 표인데 조회가 둘이다.** 한 조회에 담지 않은 까닭은
 * 조인이 갈리기 때문이다 — 접수 건은 `repair_cases` 에, 기타건은 `domestic_orders` 에
 * INNER JOIN 한다. 그 조인이 곧 「어느 갈래인가」이고, 누르면 갈 화면도 거기서 갈린다
 * (`/repair-cases/{id}/approval` ↔ `/domestic-orders/{id}/approval`). 한 조회에
 * LEFT JOIN 둘로 담으면 갈래를 행마다 다시 가려야 하고, 그 가름이 한 번 틀리면
 * **포털 화면에서만** 404 가 난다.
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
 * ── 누구에게 가는가 — 🔴 **승인 완료와 반려됨이 갈린다**(2026-11-12) ──────
 *  · **반려됨** — 종전 그대로 **요청자 본인뿐**이다. WHERE 에
 *    `requested_by_user_id = 나` 가 언제나 있고, listMyRejectedApprovalOutcomes 는
 *    역할을 **인자로 받지도 않는다** — 넓힐 길이 코드에 없다.
 *  · **승인 완료** — 요청자 본인 **또는** 영업·관리자·최고관리자다(사용자 요구 —
 *    「승인 요청을 한 사람 외에도 [영업, 관리자]인 사람들에게도 뜨도록」). 조건이 OR
 *    이라 영업인 사람이 **자기가 올린 것을 두 번 받지 않는다** — 행이 하나면 줄도
 *    하나다. 셋 중 하나이면 요청자 조건을 아예 걸지 않는다(OR 의 한쪽이 언제나
 *    참이면 전체가 참이다). 명단을 쥔 곳은 한 곳이다:
 *    domain/notifications.ts 의 receivesOthersApprovalGrantedOutcomes.
 *
 * 🔴 **둘이 다른 것은 빠뜨린 것이 아니다.** 2026-11-12 사용자 결정이 승인 완료
 * 하나였고, 반려는 「고쳐서 다시 올릴 사람」에게 사유와 함께 가는 할 일 알림이라
 * 명단을 넓히면 성격이 달라진다. **맞추지 마라.**
 *
 * ── 🔴 정보가 새는가 — 넓히기 전에 재어 보았다(2026-11-12) ───────────────
 * 승인 완료 한 줄이 싣는 것은 제목(접수 건의 인수번호 · 견적서 발행번호 · 기타건
 * 품명)과 상세(결재 이름 · 결정한 사람 이름)뿐이고, 누르면 가는 화면이 셋이다.
 * 영업·관리자는 그 셋을 **이미 연다**:
 *  · 전체 A/S 현황(`repairCases`) — 역할 검사가 아예 없다. 로그인한 사람은 모두
 *    목록과 그 건의 검수/승인 화면을 본다(auth/permission-baseline.ts 의
 *    `repairCases.view` 는 역할을 묻지 않고 READ 를 돌려준다).
 *  · 견적서(`quotes`) — canViewQuotes 가 canViewDomesticOrders 를 그대로 부른다:
 *    최고관리자·관리자·영업·엔지니어(auth/quote-authorization.ts).
 *  · 기타건 현황(`miscCases`)과 그 줄의 [승인] 탭 — 같은 canViewDomesticOrders 다
 *    (auth/permission-baseline.ts · app/(app)/domestic-orders/[id]/approval/page.tsx).
 * 그래서 이 변경이 **새로 보여 주는 값은 없다** — 이미 볼 수 있는 자료가 종에도
 * 서는 것뿐이다.
 * 🔵 다만 관리자가 역할별 접근 권한에서 그 역할의 `quotes`·`domesticOrders` 를
 *    따로 닫아 둔 경우에는 제목(발행번호·품명)이 종에 서면서 화면은 막힌다. 이
 *    저장소의 다른 종류들도 같은 모양이다 — 납기 임박·납기 지연·납기 역전은
 *    인수번호를 싣고 역할별 접근 권한을 보지 않는다(domain/notification-settings.ts
 *    의 그 case 주석: 「싣는 것이 인수번호와 날짜뿐이라 인가 경계가 아니다」). 그
 *    자리에서 좁히는 손잡이는 알림 설정의 **역할 스위치**다.
 *
 * ── 언제 알리나 — 「결과 사건」 ─────────────────────────────────────────
 *  · 결정 시각이 최근 창(APPROVAL_OUTCOME_NOTIFICATION_WINDOW_DAYS) 안인 것만. 그보다
 *    오래된 것은 확인하지 않아도 뜨지 않는다 — 기능을 켜는 순간 옛 결재가 쏟아지지
 *    않게 하려는 것이다.
 *  · 🔴 **결정자가 보는 사람 본인이면 알리지 않는다.** 최고관리자가 비상구로 자기
 *    요청을 스스로 결정한 경우와, 엔지니어가 자기 검수 요청을 스스로 승인한 경우가
 *    여기 걸린다. 자기가 한 일을 자기에게 알릴 이유가 없다.
 *    🔵 이 조건이 보는 것은 **지금 종을 여는 사람**이지 요청자 칸이 아니다. 2026-11-12
 *    에 승인 완료의 명단이 넓어지면서 뜻이 한 겹 늘었다 — 요청자에게는 종전 그대로
 *    「내가 스스로 결정한 것은 안 뜬다」이고, 넓어진 영업·관리자에게는 「내가 결재한
 *    건은 내 종에 안 뜬다」가 된다. 둘 다 같은 말의 두 모습이다.
 *    🔴 **그래서 요청자와 결정자가 같은 남의 건은 이제 영업·관리자에게는 뜬다**(전에는
 *    아무에게도 뜨지 않았다). 일어난 사건 자체는 참이고, 가려야 할 까닭이 「자기 일」
 *    하나뿐이었기 때문이다.
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
const laterDomesticApproval = alias(repairCaseApprovals, "later_domestic_approval");

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

/**
 * 세 조회가 똑같이 받는 넷째 인자 — **요청자 조건을 거는가**.
 *
 * `true` 면 `requested_by_user_id = 나` 를 **걸지 않는다.** 「요청자 본인 OR 영업·
 * 관리자·최고관리자」에서 오른쪽이 참이면 왼쪽을 볼 것이 없기 때문이다(파일 머리말).
 *
 * 🔴 **판정은 여기서 하지 않는다 — 넘겨받기만 한다.** 역할을 푸는 자리는 아래 바깥
 * 입구 하나뿐이다. 세 조회가 각자 역할을 보면 같은 판정이 세 벌이 되고, 그중 하나만
 * 고쳐지는 날 **한 갈래에서만** 명단이 어긋난다 — 그 어긋남은 화면에 아무 표시도
 * 남기지 않는다.
 */
type OutcomeScope = {
  /** 반려됨은 언제나 false 다 — 그쪽은 요청자 본인뿐이다(파일 머리말). */
  includeOtherRequesters: boolean;
};

async function listRepairCaseApprovalOutcomes(
  viewerUserId: string,
  status: CaseOutcomeStatus,
  since: Date,
  scope: OutcomeScope
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
        // 🔴 요청자 본인 — 이 조건을 **거는 경우에만** 남의 결재 결과가 내 종에서
        // 빠진다. 거는가 마는가는 바깥 입구가 역할을 보고 정한다(파일 머리말의
        // 「누구에게 가는가」). 반려됨은 언제나 건다.
        ...(scope.includeOtherRequesters ? [] : [eq(repairCaseApprovals.requestedByUserId, viewerUserId)]),
        eq(repairCaseApprovals.status, status),
        // 🔴 결정자가 보는 사람 본인이면 알리지 않는다. 결정된 행은 표 CHECK 가
        // decided_by 를 요구하므로 NULL 비교로 조용히 빠지는 행은 없다.
        ne(repairCaseApprovals.decidedByUserId, viewerUserId),
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
    //
    // 🔴 승인 종류도 함께 좁힌다 — 2026-11-06 부터 같은 표에 **기타건** 결재 행이
    // 섞여 있다('DOMESTIC_ORDER_FINAL_SHIPMENT'). 그 행은 repair_case_id 가 언제나
    // NULL 이라 위 INNER JOIN 에서 이미 떨어지므로 여기 올 수 없지만, 조인 하나가
    // 바뀌는 날 **접수 건 알림 자리에 기타건 결재가 조용히 섞이지 않게** 타입으로도
    // 못 박는다. 🔵 기타건 결과는 이 아래 listDomesticOrderApprovalOutcomes 가 따로
    // 내놓는다 — 누르면 갈 화면이 달라서 갈래를 나눴다(파일 머리말).
    row.decidedAt === null || !isValidApprovalType(row.approvalType)
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
  viewerUserId: string,
  status: CaseOutcomeStatus,
  since: Date,
  scope: OutcomeScope
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
        // 🔴 요청자 본인 — 거는가 마는가는 바깥 입구가 역할을 보고 정한다(파일
        // 머리말). 결재 행의 요청자는 사슬 내내 처음 올린 사람 그대로다
        // (mutations/quote-approvals.ts 가 다음 단계 행에 물려준다).
        ...(scope.includeOtherRequesters ? [] : [eq(quoteApprovals.requestedByUserId, viewerUserId)]),
        eq(quoteApprovals.status, status),
        // 🔴 결정자가 보는 사람 본인이면 알리지 않는다. 견적서 결재에서는 요청 경로가
        // 요청자 본인 단계를 건너뛰므로(findNextRouteStepToApprove) 요청자 쪽에서는
        // 최고관리자가 비상구로 자기 요청을 스스로 결정한 경우뿐이고, 넓어진
        // 영업·관리자 쪽에서는 「내가 결재한 견적서」가 여기 걸린다.
        ne(quoteApprovals.decidedByUserId, viewerUserId),
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

// ─────────────────────────────────────────────────────────────────── 기타건

/**
 * 기타건 최종 출하 승인의 결과(2026-11-06). 접수 건 결재와 **같은 표의 행**이지만
 * 조인이 다르다 — `domestic_orders` 에 INNER JOIN 하고 휴지통(`is_deleted`)을 뺀다.
 *
 * 🔴 **그 조인 하나가 갈래를 정한다.** `domestic_order_id` 는 접수 건 행에서 언제나
 * NULL 이고(표의 CHECK) NULL 은 조인에 걸릴 수 없다. 그래서 승인 종류로 한 번 더
 * 좁히지 않는다 — 조건을 둘 두면 둘 중 하나만 고쳐지는 날이 온다
 * (queries/domestic-order-approvals.ts 가 같은 판단을 같은 말로 적어 두었다).
 *
 * 🔴 「최종 승인」의 묶음은 **내자 줄 하나**다. 접수 건 결재는 (건, 결재 종류)로
 * 묶지만 기타건은 그 줄에 붙는 결재가 한 가지뿐이라 가를 것이 없다 — 견적서 쪽과
 * 같은 모양이고, 표의 부분 유니크도 줄 단위다
 * (repair_case_approvals_one_active_domestic_request).
 *
 * 🔴 **완료 처리(`completed_at`)된 줄도 빼지 않는다.** 그 칸은 접수 건의 `is_locked`
 * 같은 잠금이 아니고(완료한 뒤에도 고칠 수 있다), 납품을 마치고 나서 승인 기록을
 * 남기는 것이 정상 업무라 빼면 기타건 승인 완료가 거의 알려지지 않는다 — 접수 건
 * 쪽에서 `is_locked` 를 빼지 않는 것과 같은 까닭이다(파일 머리말).
 *
 * 🔵 **품명은 비어 올 수 있다.** 굵게 그릴 글자를 메우는 자리는 알림 빌더 하나다
 * (domain/notifications.ts 의 domesticOrderApprovalSubject) — 여기서 메우면 같은
 * 규칙이 두 벌이 된다.
 */
async function listDomesticOrderApprovalOutcomes(
  viewerUserId: string,
  status: CaseOutcomeStatus,
  since: Date,
  scope: OutcomeScope
): Promise<ApprovalOutcome[]> {
  const rows = await db
    .select({
      approvalId: repairCaseApprovals.id,
      domesticOrderId: domesticOrders.id,
      // 「이 줄에 적힌 값이 먼저, 없으면 연결된 수리 건의 값」 — 목록·상세·대기
      // 알림이 쓰는 그 규칙 그대로다(queries/domestic-order-approvals-pending.ts).
      modelNameText: domesticOrders.modelNameText,
      repairCaseModelName: products.modelName,
      decidedByName: decider.name,
      decidedAt: repairCaseApprovals.decidedAt,
      decisionReason: repairCaseApprovals.decisionReason,
    })
    .from(repairCaseApprovals)
    // INNER JOIN — 이 한 줄이 「기타건 행만」이다. 접수 건 행과 완전 삭제로
    // domestic_order_id 가 NULL 이 된 행이 여기서 떨어진다.
    .innerJoin(domesticOrders, eq(domesticOrders.id, repairCaseApprovals.domesticOrderId))
    .leftJoin(repairCases, eq(repairCases.id, domesticOrders.repairCaseId))
    .leftJoin(products, eq(products.id, repairCases.productId))
    .leftJoin(decider, eq(decider.id, repairCaseApprovals.decidedByUserId))
    .where(
      and(
        // 🔴 요청자 본인 — 거는가 마는가는 바깥 입구가 역할을 보고 정한다(파일
        // 머리말). 결재 행의 요청자는 사슬 내내 처음 올린 사람 그대로다
        // (mutations/domestic-order-approvals.ts 가 다음 단계 행에 물려준다).
        ...(scope.includeOtherRequesters ? [] : [eq(repairCaseApprovals.requestedByUserId, viewerUserId)]),
        eq(repairCaseApprovals.status, status),
        // 🔴 결정자가 보는 사람 본인이면 알리지 않는다. 기타건 결재에서는 요청 경로가
        // 요청자 본인 단계를 건너뛰므로(findNextRouteStepToApprove) 요청자 쪽에서는
        // 최고관리자가 비상구로 자기 요청을 스스로 결정한 경우뿐이고, 넓어진
        // 영업·관리자 쪽에서는 「내가 결재한 기타건」이 여기 걸린다.
        ne(repairCaseApprovals.decidedByUserId, viewerUserId),
        gte(repairCaseApprovals.decidedAt, since),
        eq(domesticOrders.isDeleted, false),
        ...(status === "APPROVED"
          ? [
              // 🔴 최종 승인 — 같은 내자 줄에 이 행보다 늦게 요청된 행이 없다.
              // getDomesticOrderApprovalProgress 의 「가장 최근 행」과 같은 정의다
              // (그쪽은 한 줄을 requested_at 내림차순으로 읽어 맨 앞 행을 고른다).
              notExists(
                db
                  .select({ one: sql`1` })
                  .from(laterDomesticApproval)
                  .where(
                    and(
                      eq(laterDomesticApproval.domesticOrderId, repairCaseApprovals.domesticOrderId),
                      gt(laterDomesticApproval.requestedAt, repairCaseApprovals.requestedAt)
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
            source: "DOMESTIC_ORDER" as const,
            approvalId: row.approvalId,
            domesticOrderId: row.domesticOrderId,
            modelName: resolveDomesticOrderValue(row.modelNameText, row.repairCaseModelName),
            decidedByName: row.decidedByName ?? "",
            decidedAt: row.decidedAt,
            decisionReason: row.decisionReason,
          },
        ]
  );
}

// ──────────────────────────────────────────────────────────────── 바깥 입구

/**
 * **최근 창 안에 최종 승인된** 결재 — 세 갈래 모두, 결정이 늦은 것부터.
 *
 * 🔴 **역할을 받는다(2026-11-12).** 이 사람이 영업·관리자·최고관리자면 **남이 올린**
 * 결재의 승인 완료도 함께 돌려준다(파일 머리말의 「누구에게 가는가」). 역할을 푸는
 * 자리는 여기 한 곳이고, 세 조회는 그 답(`includeOtherRequesters`)만 받는다.
 *
 * 🔴 **역할을 선택 인자로 두지 않았다.** 기본값을 두면 부르는 자리가 한 곳만 늘어도
 * 조용히 「요청자 본인뿐」으로 떨어지거나(기능이 반만 서고 아무 오류도 없다) 반대로
 * 조용히 넓어진다. 필수 인자라 빠뜨리면 tsc 가 멈춘다.
 *
 * 🔵 역할은 부르는 쪽이 넘겨 주지만, 그 값은 (app)/layout.tsx 가 세션 토큰이 아니라
 *    **살아 있는 계정**에서 다시 푼 것이다(resolveActingUserForSession) — 토큰에 박힌
 *    옛 역할이 아니다(db/queries/notifications.ts 의 listMyNotifications 머리말).
 */
export async function listMyGrantedApprovalOutcomes(
  viewerUserId: string,
  viewerRole: Role,
  options: OutcomeOptions = {}
): Promise<ApprovalOutcome[]> {
  const since = approvalOutcomeNotificationWindowStart(options.now ?? new Date());
  const scope: OutcomeScope = { includeOtherRequesters: receivesOthersApprovalGrantedOutcomes(viewerRole) };
  const [cases, quoteOutcomes, domesticOutcomes] = await Promise.all([
    listRepairCaseApprovalOutcomes(viewerUserId, "APPROVED", since, scope),
    listQuoteApprovalOutcomes(viewerUserId, "APPROVED", since, scope),
    listDomesticOrderApprovalOutcomes(viewerUserId, "APPROVED", since, scope),
  ]);
  return [...cases, ...quoteOutcomes, ...domesticOutcomes].sort(byDecisionNewestFirst);
}

/**
 * 내가 요청한 결재 중 **최근 창 안에 반려된** 것 — 어느 단계에서든, 세 갈래 모두,
 * 결정이 늦은 것부터. 내가 스스로 결정한 것은 빠진다.
 *
 * 🔴 **역할을 받지 않는다 — 일부러다.** 2026-11-12 에 승인 완료만 영업·관리자까지
 * 넓어졌고 반려는 **요청자 본인 그대로**다(파일 머리말). 인자에 역할이 없으면 「반만
 * 넓히는」 실수가 애초에 코드에 적히지 않는다. 바로 위 함수와 모양이 달라 보인다고
 * 맞추지 마라.
 */
export async function listMyRejectedApprovalOutcomes(
  requesterUserId: string,
  options: OutcomeOptions = {}
): Promise<ApprovalOutcome[]> {
  const since = approvalOutcomeNotificationWindowStart(options.now ?? new Date());
  const scope: OutcomeScope = { includeOtherRequesters: false };
  const [cases, quoteOutcomes, domesticOutcomes] = await Promise.all([
    listRepairCaseApprovalOutcomes(requesterUserId, "REJECTED", since, scope),
    listQuoteApprovalOutcomes(requesterUserId, "REJECTED", since, scope),
    listDomesticOrderApprovalOutcomes(requesterUserId, "REJECTED", since, scope),
  ]);
  return [...cases, ...quoteOutcomes, ...domesticOutcomes].sort(byDecisionNewestFirst);
}
