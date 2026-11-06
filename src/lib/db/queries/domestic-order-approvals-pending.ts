import "server-only";
import { and, asc, eq, isNull } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "../client";
import { domesticOrders, products, repairCaseApprovals, repairCases, users } from "../schema";
import {
  approvalFollowsRoute,
  mayDecideAssignedApproval,
  NO_ROUTE_DELEGATIONS,
} from "@/lib/auth/approval-assignment";
import { resolveDomesticOrderValue } from "@/lib/domain/domestic-order-list";
import { resolveActingApproverUserIds } from "./approval-route-delegations";

/**
 * ============================================================================
 * 내가 결재해야 할 기타건 — 종 「기타건 결재 대기」와 통합 승인함의 원본
 * ============================================================================
 * 🔴 **이 파일은 아무것도 쓰지 않고, 아무 문도 여닫지 않는다.** 기타건 최종 출하
 * 승인은 완료 처리도 납품도 막지 않는다(domain/domestic-order-approval-rules.ts
 * 머리말 — 「남는 것은 기록뿐이다」). 여기서 하는 일은 「지금 누구 차례인가」를 읽어
 * 종에 한 줄을 세우고, 통합 승인함이 물어 올 때 그 줄을 내주는 것뿐이다.
 *
 * ── 🔴 왜 접수 건 조회(repair-case-approvals-pending.ts)를 넓히지 않았나 ──
 * 결재 행은 **같은 표**(`repair_case_approvals`)에 쌓인다. 그래도 그 조회를 넓히면
 * 접수 건 승인 종류 목록(`REPAIR_CASE_APPROVAL_TYPES`)에 기타건 값을 넣어야 하는데,
 * 그 목록이 **정확히 둘**이라는 것을 db/schema/domestic-order-approval-safety.test.ts
 * 가 못 박고 있다(「기타건 결재가 접수 건 승인 종류로 들어갔다 — 종·배지·승인함에
 * 섞인다」). 그 보증을 유지한 채 **나란히 새로** 세우는 쪽을 골랐다 — 견적서 결재가
 * 이미 그 모양이다(queries/quote-approvals-pending.ts). 그래서 2026-11-06 이후에도
 * 접수 건 쪽 조회·배지·승인함 줄은 **한 글자도 바뀌지 않는다.**
 *
 * ── 🔴 가르는 자리는 `domestic_order_id` 하나다 ─────────────────────────
 * `domesticOrders` 에 INNER JOIN 하는 것이 곧 「기타건 행만」이다 — 그 칸은 접수 건
 * 행에서 언제나 NULL 이고(표의 CHECK), NULL 은 조인에 걸릴 수가 없다. **승인 종류로
 * 한 번 더 좁히지 않는다**: 좁혀도 같은 답이지만(그 칸이 찬 행은 전부
 * 'DOMESTIC_ORDER_FINAL_SHIPMENT' 다 — CHECK) 조건을 둘 두면 둘 중 하나만 고쳐지는
 * 날이 오고 그때 어느 쪽이 참인지 알 수 없다. queries/domestic-order-approvals.ts 가
 * 같은 판단을 같은 말로 적어 두었다.
 *
 * ── 판정을 새로 만들지 않는다 ───────────────────────────────────────────
 * 「이 결재를 내가 처리할 수 있는가」는 출하 승인·견적서 결재와 **같은 함수 하나**를
 * 본다 — auth/approval-assignment.ts 의 `mayDecideAssignedApproval`(지정된 사람, 그
 * 단계를 위임받은 사람, 또는 최고관리자 비상구). 실제로 승인·반려를 막는
 * decideDomesticOrderApproval 이 자기 트랜잭션 안에서 부르는 바로 그 함수다. 여기서 한
 * 벌 더 적으면 알림에는 뜨는데 눌러도 거절되는(또는 그 반대의) 어긋남이 생기고,
 * 후자는 화면에 아무 표시도 남기지 않아 더 나쁘다.
 *
 * ── 🔴 기타건 결재는 **언제나 지정이 있다** ─────────────────────────────
 * 요청 경로가 판과 지정을 함께 넣고, 판이 없으면 요청 자체가 ROUTE_NOT_CONFIGURED 로
 * 거절된다(mutations/domestic-order-approvals.ts). 그래서 「지정된 사람 + 그 단계를
 * 위임받은 사람 + 최고관리자」 말고는 아무에게도 뜨지 않는다 — 견적서 결재와 같은
 * 모양이고, 접수 건 최종 출하 승인의 「대표·위임」 축은 여기에 **없다**(기타건에는
 * 출하 대표가 없다 — domain/domestic-order-approval-rules.ts 의 근거 셋).
 *
 * ── 처리된 건은 뜨지 않는다 · 한 줄에 한 줄이다 ─────────────────────────
 * 후보는 **아직 결정되지 않은 행**(`status = 'REQUESTED'`)뿐이다. 승인·반려된 행은
 * 다음 조회에서 저절로 빠지고, 다단계 결재선은 앞 행을 닫은 **뒤에** 다음 행을 여는
 * 사슬이라 열린 행은 한 줄에 언제나 하나다 — 표의 부분 유니크
 * (repair_case_approvals_one_active_domestic_request)가 그것을 지킨다.
 *
 * 🔵 **「요청 뒤에 줄이 바뀌었는가」(STALE)는 여기서 보지 않는다.** 그 판정
 * (resolveApprovalState)은 **결정된** 행에만 뜻이 있다 — REQUESTED 행은 판 번호와
 * 무관하게 PENDING 이다. 열려 있는 요청은 줄이 바뀌어도 여전히 누군가 눌러야 닫힌다.
 *
 * ── 휴지통에 간 줄 ──────────────────────────────────────────────────────
 * `domestic_orders.is_deleted = false` 만 본다. 휴지통 줄의 상세는 열리지 않으므로
 * (queries/domestic-orders.ts 의 getDomesticOrderDetail) 누르면 갈 화면이 없는 알림을
 * 세우지 않는다 — 접수 건·견적서 결재 대기 조회가 같은 이유로 같게 한다.
 * 🔵 **완료 처리(`completed_at`)된 줄은 빼지 않는다.** 그 칸은 잠금이 아니고, 저장
 * 경로도 보지 않는다(그 mutation 머리말 — 「완료된 줄에서도 올릴 수 있다」). 여기서
 * 빼면 「목록에는 없는데 눌러서 처리는 되는」 결재가 생긴다.
 * ============================================================================
 */

const approvalRequester = alias(users, "domestic_pending_approval_requester");

/** 지정 관문(mayDecideAssignedApproval)에 그대로 넘기는 최소 모양. */
type AssignmentActor = { id: string; role: string; isDeveloper: boolean };

/**
 * 결재선 단계를 맡을 수 있는 계정인가 — 조건은 「결재선에 올릴 수 있는 사람」
 * (queries/shipment-approval-routes.ts 의 listSelectableApproverCandidates)과 글자
 * 그대로 같다: 승인됨 · 활성 · 잠기지 않음 · 삭제 안 됨. 역할 제한은 없다(결재선
 * 지정에도 없고, 그래서 decideDomesticOrderApproval 도 권한 영역을 묻지 않는다).
 *
 * 🔴 여기서 사람을 더 좁히지 않는 것이 의도다. 넓게 물어도 아래에서 지정 관문이 그
 * 단계의 승인자(와 최고관리자)로 좁힌다. 반대로 여기서 좁히면 **최고관리자 비상구가
 * 함께 닫힌다** — 자기 단계가 아니면 물어보지도 않게 되므로.
 *
 * 🔵 **`domesticOrders` 권한 영역을 묻지 않는다.** 그것은 결재를 **올리는** 쪽의
 * 열쇠다(mutations/domestic-order-approvals.ts 의 「인가」). 여기서 그것까지 요구하면
 * 결재선에 올릴 수 있는 사람과 알림을 받는 사람이 갈라져, 관리자가 「지정은 됐는데
 * 알림은 못 받는」 결재자를 만들 수 있게 된다.
 */
async function resolveDomesticOrderApprovalActor(
  actorUserId: string
): Promise<AssignmentActor | null> {
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

export type PendingDomesticOrderApprovalItem = {
  domesticOrderId: string;
  /**
   * 그 줄의 품명 — 알림이 굵게 적는 값이다. 🔴 **`null` 일 수 있다.**
   *
   * 기타건은 손으로 [행 추가] 한 줄이 많아 품명이 비어 올 수 있고(개발 DB 실측
   * 2026-11-06 — 13건 중 2건만 적혀 있다), 빈 글자를 그대로 내보내면 통합 승인함이
   * 그 줄을 통째로 뺀다. 메우는 자리는 알림 빌더 하나다
   * (domain/notifications.ts 의 domesticOrderApprovalSubject).
   */
  modelName: string | null;
  /** 지금 열려 있는 결재 행. 한 줄에 하나뿐이다(파일 머리말). */
  approvalId: string;
  /** 그 행이 판의 몇 번째 단계인가(1부터). 결재선을 타지 않는 행이면 `null`. */
  routeStepOrder: number | null;
  requestedByUserId: string;
  requestedByName: string;
  /** ISO 문자열 — 서버 컴포넌트 경계를 넘을 수 있게 Date 를 그대로 보내지 않는다. */
  requestedAt: string;
};

/**
 * 내가 지금 결재해야 할 기타건들 — 오래 기다린 것부터.
 *
 * ⚠️ **실패하는 방향이 조용하다.** 잘못 좁히면 처리해야 할 사람이 알림을 못 받는데,
 * 그 실패는 화면에 아무 표시도 남기지 않는다(그냥 안 뜬다). 그래서 좁히는 자리를
 * 하나로 모아 두고(`mayDecideAssignedApproval`) 통합 시험이 그 경로를 못 박는다.
 *
 * 읽기 전용이고 최종 판정도 아니다 — 실제 승인·반려는 decideDomesticOrderApproval 이
 * 자기 트랜잭션 안에서 전부 다시 확인한다.
 */
export async function listDomesticOrderApprovalsPendingMyApproval(
  actorUserId: string
): Promise<PendingDomesticOrderApprovalItem[]> {
  const actor = await resolveDomesticOrderApprovalActor(actorUserId);
  if (!actor) return [];

  // 🔴 「지금 이 사람이 대신할 수 있는 자리들」 — 위임받은 단계도 **내 차례로
  // 보여야** 한다. 맡긴 사람은 자리를 비운 사람이라, 목록에 안 뜨면 대리인은 결재할
  // 것이 있다는 사실 자체를 모른다. 트랜잭션을 넘기지 않는 것이 맞다: 읽기 전용이고
  // 최종 판정도 아니라 그 순간의 답이면 충분하다.
  const actingApproverUserIds = await resolveActingApproverUserIds(actor.id, new Date());

  const rows = await db
    .select({
      domesticOrderId: domesticOrders.id,
      // 「이 줄에 적힌 값이 먼저, 없으면 연결된 수리 건의 값」 — 목록·상세가 쓰는
      // 그 규칙 그대로다(아래 resolveDomesticOrderValue). 기타건은 정의상 수리 건이
      // 안 붙은 줄이라 실제로는 거의 언제나 왼쪽이지만, 규칙을 여기서 바꾸면 종에
      // 뜬 글자와 눌러서 들어간 화면의 글자가 달라질 수 있다.
      modelNameText: domesticOrders.modelNameText,
      repairCaseModelName: products.modelName,
      approvalId: repairCaseApprovals.id,
      routeStepOrder: repairCaseApprovals.routeStepOrder,
      // 「이 행이 결재선 단계인가」를 가르는 나머지 한 칸 — 위임은 단계에만 걸린다.
      // 같은 표의 칸이라 조인도 조건도 늘지 않는다.
      routeId: repairCaseApprovals.routeId,
      assignedApproverUserId: repairCaseApprovals.assignedApproverUserId,
      requestedByUserId: repairCaseApprovals.requestedByUserId,
      requestedByName: approvalRequester.name,
      requestedAt: repairCaseApprovals.requestedAt,
    })
    .from(repairCaseApprovals)
    // 🔴 INNER JOIN — 이 한 줄이 「기타건 행만」이다(파일 머리말). 접수 건 행은
    // domestic_order_id 가 언제나 NULL 이라 여기서 떨어지고, 완전 삭제로 그 칸이
    // NULL 로 풀린 행도 함께 떨어진다.
    .innerJoin(domesticOrders, eq(domesticOrders.id, repairCaseApprovals.domesticOrderId))
    // 품명을 메울 두 조인. 기타건은 repair_case_id 가 비어 있어 거의 언제나 NULL 쪽
    // 이고, 그래서 LEFT JOIN 이다 — INNER 로 걸면 줄이 통째로 사라진다.
    .leftJoin(repairCases, eq(repairCases.id, domesticOrders.repairCaseId))
    .leftJoin(products, eq(products.id, repairCases.productId))
    // 요청자는 NOT NULL + RESTRICT 라 언제나 실재하지만, 조인 하나가 잘못돼 줄이
    // 통째로 사라지는 실패 방식이 알림에서 가장 알아채기 어려워 LEFT JOIN 이다
    // (queries/quote-approvals-pending.ts 가 같은 이유로 같게 한다).
    .leftJoin(approvalRequester, eq(approvalRequester.id, repairCaseApprovals.requestedByUserId))
    .where(
      and(eq(repairCaseApprovals.status, "REQUESTED"), eq(domesticOrders.isDeleted, false))
    )
    // 오래 기다린 것부터. 같은 시각이면 행 id 로 동점을 깬다 — 순서가 실행마다
    // 흔들리면 종 패널의 줄이 새로고침할 때마다 자리를 바꾼다.
    .orderBy(asc(repairCaseApprovals.requestedAt), asc(repairCaseApprovals.id));

  return rows
    // 🔴 지정이 걸린 건은 **그 사람 · 그 단계를 위임받은 사람 · 최고관리자에게만**
    // 보인다. 판정은 여기서 새로 적지 않고 출하 승인·견적서 결재·결재 mutation 과 같은
    // 함수 하나를 부른다. 위임 목록을 거는 조건도 decideDomesticOrderApproval 과 **같은
    // 함수**(approvalFollowsRoute)다 — 조건이 갈리면 「목록에는 뜨는데 눌러도 거절」이
    // 되고, 그 어긋남은 화면에 아무 표시도 남기지 않는다.
    .filter((row) =>
      mayDecideAssignedApproval(
        row.assignedApproverUserId,
        actor,
        approvalFollowsRoute(row) ? actingApproverUserIds : NO_ROUTE_DELEGATIONS
      )
    )
    .map((row) => ({
      domesticOrderId: row.domesticOrderId,
      modelName: resolveDomesticOrderValue(row.modelNameText, row.repairCaseModelName),
      approvalId: row.approvalId,
      routeStepOrder: row.routeStepOrder,
      requestedByUserId: row.requestedByUserId,
      requestedByName: row.requestedByName ?? "",
      requestedAt: row.requestedAt.toISOString(),
    }));
}
