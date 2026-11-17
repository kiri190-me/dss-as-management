import "server-only";
import { and, desc, eq, gte, isNotNull, lt, or, type SQL } from "drizzle-orm";
import { alias, type PgColumn } from "drizzle-orm/pg-core";
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
  buildApprovalHistoryEntry,
  compareApprovalHistoryNewestFirst,
  type ApprovalHistoryDecision,
  type ApprovalHistoryEntry,
} from "@/lib/domain/approval-history";
import { isValidApprovalType } from "@/lib/validation/repair-case-approval-input";

/**
 * ============================================================================
 * 결재 내역 — 「이 사람이 이 기간에 한/대신한 결재」
 * ============================================================================
 * 사용자 요구(2026-11-17): 「내가 했던 결재나 **나를 대신해서** 어떤 결재를 했는지도
 * 확인할 수 있도록 (특정 날짜 혹은 기간을 선택해서)」. 설계는 `dss-approvals` 의
 * DELEGATION_DESIGN.md C-4 다.
 *
 * 🔵 **화면은 이 집에 없다**(2026-11-17 사용자) — 통합 승인함 한 곳에 둔다. 이
 * 조회는 다음 조각이 열 통로(`api/integration/*`)가 쓴다. 통로가 할 일 둘:
 *  · 대상 사람을 **토큰에서만** 집는다(쿼리 문자열로 받으면 토큰 하나로 아무의
 *    내역이나 보는 문이 된다 — api/integration/approvals/route.ts 의 같은 경고).
 *  · `href` 를 absoluteNotificationHref 로 감싼다(domain/approval-history.ts 머리말).
 *
 * ── 🔴 지금까지 있던 것은 전부 「건 하나당 이력」이었다 ──────────────────
 * getApprovalHistoryForCase · getQuoteApprovalHistory · getDomesticOrderApprovalHistory
 * 는 한 건을 열어 그 건의 결재 줄을 보여 준다. **기간·사람으로 가로지르는** 조회는
 * 여기가 처음이고, 그래서 색인도 여기 와서야 생겼다(마이그레이션 0130 — 세 칸 어디
 * 에도 없었다).
 *
 * ── 🔴 무엇을 「내 내역」으로 보는가 ─────────────────────────────────────
 *     decided_by_user_id = 나   OR   delegated_from_user_id = 나
 * 앞이 「내가 눌렀다」(직접이든 남을 대신해서든), 뒤가 「내 자리를 남이 눌렀다」다.
 * 🔴 **A/S 는 이것을 미리 계산해 칸에 적어 둔다 — 세 집 가운데 여기뿐이다.**
 * 재고관리·휴가에는 그 칸이 없어 「그 단계의 주인」과 「누른 사람」을 견준다
 * (설계 C-4 보충의 표). **그쪽 코드를 베끼지도, 이쪽을 그쪽에 베끼지도 마라.**
 *
 * ── 🔴 결재가 **안 된** 줄은 내역이 아니다 ──────────────────────────────
 * `decided_at IS NULL`(아직 REQUESTED)인 줄은 뺀다. 기간 조건만으로도 빠지지만
 * (NULL 과의 비교는 참이 되지 않는다) 조건으로 적어 둔다 — 기간이 선택 인자가 되는
 * 날 「아직 안 누른 결재」가 내역에 조용히 섞인다.
 *
 * ── 🔴 없어진 건의 결재는 빼고, 없어진 **계정**은 빼지 않는다 ───────────
 *  · 건 — 세 갈래 모두 그 건(접수 건 · 견적서 · 내자 줄)에 INNER JOIN 하고 휴지통
 *    (`is_deleted`)을 뺀다. 결과 알림과 **같은 처리**다
 *    (queries/approval-outcome-notifications.ts 머리말): 누르면 갈 화면이 없는 줄은
 *    제목도 주소도 지을 수 없고, 제목이 비면 승인함은 그 줄을 통째로 버린다
 *    (포털 lib/approvals/screen-inbox.ts 의 계약).
 *    🔵 **대가**: 휴지통에 들어간 건에 대해 내가 한 결재는 내역에서 사라진다.
 *    「내가 무엇을 눌렀나」를 되짚는 쪽으로 보면 아쉬운 자리지만, 제목도 주소도 없는
 *    줄을 세우는 쪽이 더 나쁘다고 보았다(결과 알림이 이미 같은 선택을 해 두었다).
 *  · 사람 — `users` 는 LEFT JOIN 이고 `is_deleted` 를 **보지 않는다.** 계정은
 *    소프트삭제라 행이 남고, 옛 결재를 설명하려면 그 이름이 필요하다. 건별 이력
 *    조회 셋이 이미 그렇게 한다.
 *
 * ── 순서 ────────────────────────────────────────────────────────────────
 * 결정이 늦은 것부터. 세 갈래를 합친 뒤 한 번 더 세운다 — 세우는 규칙은 여기 적지
 * 않는다(domain/approval-history.ts 의 compareApprovalHistoryNewestFirst).
 * ============================================================================
 */

const historyRequester = alias(users, "history_requester");
const historyDecider = alias(users, "history_decider");
const historyDelegator = alias(users, "history_delegator");

/**
 * 재는 기간. 🔴 **반열린 구간 `[from, to)`** 다 — 시작 그 순간은 들고, 끝 그 순간은
 * 들지 않는다.
 *
 * 🔴 **선택 인자로 두지 않는다.** 기본값을 두면 기간을 안 넘긴 부르는 자리가 조용히
 * **전 기간**을 열고, 그 실수는 「줄이 좀 많네」로만 보인다. 넓게 보고 싶으면 넓은
 * 기간을 **적어서** 넘긴다.
 *
 * 🔵 반열린으로 고른 까닭: 위임 기간이 이미 `[starts_at, ends_at)` 이라(설계 C-5 —
 * 「끝난 위임의 기간을 눌러 그 기간 결재 보기」가 이 조회를 그 두 값으로 부른다)
 * 양 끝을 다 무는 구간으로 두면 **경계의 1밀리초가 두 위임에 겹쳐** 센다.
 */
export type ApprovalHistoryPeriod = {
  /** 🔴 이 순간을 **포함한다.** */
  from: Date;
  /** 🔴 이 순간을 **포함하지 않는다.** */
  to: Date;
};

/** 내역에 설 수 있는 상태 둘. 🔵 요청 상태는 위 머리말대로 애초에 걸러진다. */
const DECIDED_STATUSES: readonly string[] = ["APPROVED", "REJECTED"];

/**
 * 세 조회가 **글자 그대로 같이** 쓰는 조건 — 「내 결재인가」와 「그 기간인가」.
 *
 * 🔴 **한 곳에 두는 까닭**: 이 조건이 갈리는 순간 한 갈래에서만 남의 결재가 보이거나
 * (권한 구멍) 내 결재가 사라진다. 어느 쪽도 화면에 표시가 남지 않는다.
 *
 * 🔵 표가 아니라 **칸 셋만** 받는다. 결재가 쌓이는 표가 둘이고(`repair_case_approvals`
 * · `quote_approvals`) 둘은 서로 다른 타입이라 「표 하나를 받는」 모양으로는 함께 쓸 수
 * 없다. 부르는 쪽은 표를 그대로 넘기면 된다 — 이 셋을 들고 있는 것이 조건의 전부다.
 */
function decidedByOrForViewer(
  columns: {
    decidedByUserId: PgColumn;
    delegatedFromUserId: PgColumn;
    decidedAt: PgColumn;
  },
  viewerUserId: string,
  period: ApprovalHistoryPeriod
): SQL | undefined {
  return and(
    // 🔴 앞이 「내가 눌렀다」, 뒤가 「내 자리를 남이 눌렀다」. 둘을 가르는 일은
    //    도메인이 한다(resolveApprovalHistoryRelation) — 여기서는 모아 오기만 한다.
    or(eq(columns.decidedByUserId, viewerUserId), eq(columns.delegatedFromUserId, viewerUserId)),
    // 아직 안 누른 줄은 내역이 아니다(파일 머리말).
    isNotNull(columns.decidedAt),
    gte(columns.decidedAt, period.from),
    lt(columns.decidedAt, period.to)
  );
}

// ──────────────────────────────────────────────── 접수 건 결재 (검수 · 출하)

async function listRepairCaseApprovalHistory(
  viewerUserId: string,
  period: ApprovalHistoryPeriod
): Promise<ApprovalHistoryEntry[]> {
  const rows = await db
    .select({
      approvalId: repairCaseApprovals.id,
      repairCaseId: repairCases.id,
      intakeNumber: repairCases.intakeNumber,
      approvalType: repairCaseApprovals.approvalType,
      status: repairCaseApprovals.status,
      decidedAt: repairCaseApprovals.decidedAt,
      decidedByUserId: repairCaseApprovals.decidedByUserId,
      decidedByName: historyDecider.name,
      delegatedFromUserId: repairCaseApprovals.delegatedFromUserId,
      delegatedFromName: historyDelegator.name,
      requestedByName: historyRequester.name,
      requestReason: repairCaseApprovals.requestReason,
      decisionReason: repairCaseApprovals.decisionReason,
    })
    .from(repairCaseApprovals)
    // INNER JOIN — 휴지통·영구 삭제된 접수 건의 행이 여기서 떨어진다(파일 머리말).
    .innerJoin(repairCases, eq(repairCases.id, repairCaseApprovals.repairCaseId))
    .innerJoin(historyRequester, eq(historyRequester.id, repairCaseApprovals.requestedByUserId))
    .leftJoin(historyDecider, eq(historyDecider.id, repairCaseApprovals.decidedByUserId))
    .leftJoin(historyDelegator, eq(historyDelegator.id, repairCaseApprovals.delegatedFromUserId))
    .where(
      and(
        decidedByOrForViewer(repairCaseApprovals, viewerUserId, period),
        eq(repairCases.isDeleted, false)
      )
    )
    .orderBy(desc(repairCaseApprovals.decidedAt), desc(repairCaseApprovals.id));

  return rows.flatMap((row) =>
    // 🔴 **접수 건 결재 행만** 남긴다. 2026-11-06 부터 같은 표에 기타건 결재 행이
    //    섞여 있고('DOMESTIC_ORDER_FINAL_SHIPMENT'), 그 행은 repair_case_id 가
    //    언제나 NULL 이라 위 INNER JOIN 에서 이미 떨어진다 — 그래도 타입으로 한 겹을
    //    두는 것은 그 조인이 바뀌는 날 **접수 건 자리에 기타건이 조용히 서지 않게**
    //    하려는 것이다(queries/repair-case-approvals.ts 의 같은 겹).
    // 🔵 아래 네 겹은 **타입을 좁히는 일**이 전부다 — 거르는 조건은 위 WHERE 와 표의
    //    CHECK 이 이미 걸었다(결정된 행에는 decided_at·decided_by 가 언제나 있다).
    row.decidedAt === null ||
    row.decidedByUserId === null ||
    !isDecidedStatus(row.status) ||
    !isValidApprovalType(row.approvalType)
      ? []
      : [
          buildApprovalHistoryEntry({
            target: {
              source: "REPAIR_CASE",
              approvalId: row.approvalId,
              repairCaseId: row.repairCaseId,
              intakeNumber: row.intakeNumber,
              approvalType: row.approvalType,
            },
            viewerUserId,
            status: row.status,
            decidedAt: row.decidedAt,
            decidedByUserId: row.decidedByUserId,
            decidedByName: row.decidedByName ?? "",
            delegatedFromUserId: row.delegatedFromUserId,
            delegatedFromName: row.delegatedFromName,
            requestedByName: row.requestedByName,
            requestReason: row.requestReason,
            decisionReason: row.decisionReason,
          }),
        ]
  );
}

// ────────────────────────────────────────────────────────────────── 견적서

async function listQuoteApprovalHistory(
  viewerUserId: string,
  period: ApprovalHistoryPeriod
): Promise<ApprovalHistoryEntry[]> {
  const rows = await db
    .select({
      approvalId: quoteApprovals.id,
      quoteId: quotes.id,
      quoteNumber: quotes.quoteNumber,
      status: quoteApprovals.status,
      decidedAt: quoteApprovals.decidedAt,
      decidedByUserId: quoteApprovals.decidedByUserId,
      decidedByName: historyDecider.name,
      delegatedFromUserId: quoteApprovals.delegatedFromUserId,
      delegatedFromName: historyDelegator.name,
      requestedByName: historyRequester.name,
      requestReason: quoteApprovals.requestReason,
      decisionReason: quoteApprovals.decisionReason,
    })
    .from(quoteApprovals)
    // INNER JOIN — 휴지통·완전 삭제된 견적서의 행이 여기서 떨어진다.
    .innerJoin(quotes, eq(quotes.id, quoteApprovals.quoteId))
    .innerJoin(historyRequester, eq(historyRequester.id, quoteApprovals.requestedByUserId))
    .leftJoin(historyDecider, eq(historyDecider.id, quoteApprovals.decidedByUserId))
    .leftJoin(historyDelegator, eq(historyDelegator.id, quoteApprovals.delegatedFromUserId))
    .where(
      and(decidedByOrForViewer(quoteApprovals, viewerUserId, period), eq(quotes.isDeleted, false))
    )
    .orderBy(desc(quoteApprovals.decidedAt), desc(quoteApprovals.id));

  return rows.flatMap((row) =>
    row.decidedAt === null || row.decidedByUserId === null || !isDecidedStatus(row.status)
      ? []
      : [
          buildApprovalHistoryEntry({
            target: {
              source: "QUOTE",
              approvalId: row.approvalId,
              quoteId: row.quoteId,
              quoteNumber: row.quoteNumber,
            },
            viewerUserId,
            status: row.status,
            decidedAt: row.decidedAt,
            decidedByUserId: row.decidedByUserId,
            decidedByName: row.decidedByName ?? "",
            delegatedFromUserId: row.delegatedFromUserId,
            delegatedFromName: row.delegatedFromName,
            requestedByName: row.requestedByName,
            requestReason: row.requestReason,
            decisionReason: row.decisionReason,
          }),
        ]
  );
}

// ─────────────────────────────────────────────────────────────────── 기타건

/**
 * 기타건(내자 정리의 한 줄) 최종 출하 승인의 내역. 접수 건 결재와 **같은 표의 행**
 * 인데 조인이 다르다 — `domestic_orders` 에 INNER JOIN 한다.
 *
 * 🔴 **그 조인 하나가 갈래를 정한다.** `domestic_order_id` 는 접수 건 행에서 언제나
 * NULL 이고(표의 CHECK) NULL 은 조인에 걸릴 수 없다. 그래서 승인 종류로 한 번 더
 * 좁히지 않는다 — 조건을 둘 두면 둘 중 하나만 고쳐지는 날이 온다
 * (queries/approval-outcome-notifications.ts 가 같은 판단을 같은 말로 적어 두었다).
 *
 * 🔵 **회차(`due_date_row_order`)는 싣지 않는다.** 기타건 승인의 단위는 납기요청일
 * 회차이고(2026-11-08) 한 줄에 회차가 여럿이면 내역에 **제목이 같은 줄이 여럿** 설
 * 수 있다. 결정 시각이 달라 줄이 뭉개지지는 않지만, 승인함이 「몇 차분인가」를
 * 그려야 한다면 그때 칸 하나(SELECT + 내역 줄)를 더하면 된다 — 결과 알림도 지금
 * 같은 모양이다.
 */
async function listDomesticOrderApprovalHistory(
  viewerUserId: string,
  period: ApprovalHistoryPeriod
): Promise<ApprovalHistoryEntry[]> {
  const rows = await db
    .select({
      approvalId: repairCaseApprovals.id,
      domesticOrderId: domesticOrders.id,
      // 「이 줄에 적힌 값이 먼저, 없으면 연결된 수리 건의 값」 — 목록·상세·대기 알림·
      // 결과 알림이 쓰는 그 규칙 그대로다.
      modelNameText: domesticOrders.modelNameText,
      repairCaseModelName: products.modelName,
      status: repairCaseApprovals.status,
      decidedAt: repairCaseApprovals.decidedAt,
      decidedByUserId: repairCaseApprovals.decidedByUserId,
      decidedByName: historyDecider.name,
      delegatedFromUserId: repairCaseApprovals.delegatedFromUserId,
      delegatedFromName: historyDelegator.name,
      requestedByName: historyRequester.name,
      requestReason: repairCaseApprovals.requestReason,
      decisionReason: repairCaseApprovals.decisionReason,
    })
    .from(repairCaseApprovals)
    // INNER JOIN — 이 한 줄이 「기타건 행만」이다.
    .innerJoin(domesticOrders, eq(domesticOrders.id, repairCaseApprovals.domesticOrderId))
    .leftJoin(repairCases, eq(repairCases.id, domesticOrders.repairCaseId))
    .leftJoin(products, eq(products.id, repairCases.productId))
    .innerJoin(historyRequester, eq(historyRequester.id, repairCaseApprovals.requestedByUserId))
    .leftJoin(historyDecider, eq(historyDecider.id, repairCaseApprovals.decidedByUserId))
    .leftJoin(historyDelegator, eq(historyDelegator.id, repairCaseApprovals.delegatedFromUserId))
    .where(
      and(
        decidedByOrForViewer(repairCaseApprovals, viewerUserId, period),
        eq(domesticOrders.isDeleted, false)
      )
    )
    .orderBy(desc(repairCaseApprovals.decidedAt), desc(repairCaseApprovals.id));

  return rows.flatMap((row) =>
    row.decidedAt === null || row.decidedByUserId === null || !isDecidedStatus(row.status)
      ? []
      : [
          buildApprovalHistoryEntry({
            target: {
              source: "DOMESTIC_ORDER",
              approvalId: row.approvalId,
              domesticOrderId: row.domesticOrderId,
              // 🔵 비어 올 수 있다. 굵게 그릴 글자를 메우는 자리는 한 곳이다
              //    (domain/notifications.ts 의 domesticOrderApprovalSubject).
              modelName: resolveDomesticOrderValue(row.modelNameText, row.repairCaseModelName),
            },
            viewerUserId,
            status: row.status,
            decidedAt: row.decidedAt,
            decidedByUserId: row.decidedByUserId,
            decidedByName: row.decidedByName ?? "",
            delegatedFromUserId: row.delegatedFromUserId,
            delegatedFromName: row.delegatedFromName,
            requestedByName: row.requestedByName,
            requestReason: row.requestReason,
            decisionReason: row.decisionReason,
          }),
        ]
  );
}

/** 표가 들고 온 상태 글자가 「끝난 결재」인가. 🔵 타입을 좁히는 일이 전부다. */
function isDecidedStatus(status: string): status is ApprovalHistoryDecision {
  return DECIDED_STATUSES.includes(status);
}

// ──────────────────────────────────────────────────────────────── 바깥 입구

/**
 * **이 사람이 이 기간에 한(또는 제 자리를 맡겨 남이 한) 결재** 전부 — 세 갈래를
 * 한 목록으로, 결정이 늦은 것부터.
 *
 * 🔴 **대상 사람은 인자 하나로만 정해진다.** 「영업·관리자면 남의 것도」 같은 넓힘이
 * 여기에는 없다 — 결재 내역은 할 일이 아니라 **내 행적**이고, 넓히면 남이 누른
 * 결재가 내 내역에 선다. 넓혀야 할 일이 생기면 그때 사용자에게 먼저 묻는다.
 *
 * 🔴 **세 갈래를 각자 합치지 마라.** 부르는 쪽이 셋을 따로 불러 제 손으로 이어
 * 붙이면 차례와 모양이 자리마다 갈린다. 합치는 자리는 이 함수 하나다.
 */
export async function listApprovalHistoryForUser(
  viewerUserId: string,
  period: ApprovalHistoryPeriod
): Promise<ApprovalHistoryEntry[]> {
  // 서로를 모르는 세 조회라 나란히 보낸다.
  const [cases, quoteEntries, domesticEntries] = await Promise.all([
    listRepairCaseApprovalHistory(viewerUserId, period),
    listQuoteApprovalHistory(viewerUserId, period),
    listDomesticOrderApprovalHistory(viewerUserId, period),
  ]);
  return [...cases, ...quoteEntries, ...domesticEntries].sort(compareApprovalHistoryNewestFirst);
}
