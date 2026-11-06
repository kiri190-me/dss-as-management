import "server-only";
import { desc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "../client";
import { domesticOrders, repairCaseApprovals, users } from "../schema";
import {
  resolveApprovalState,
  type ShipmentApprovalState,
} from "@/lib/domain/local/workflow/shipment-approval-checklist";

const requester = alias(users, "domestic_order_approval_requester");
const decider = alias(users, "domestic_order_approval_decider");
const assignedApprover = alias(users, "domestic_order_approval_assigned_approver");
/** 「누구 자리를 대신 눌렀나」의 그 사람 — queries/quote-approvals.ts 의 delegator 와 같은 자리다. */
const delegator = alias(users, "domestic_order_approval_delegator");

/**
 * ============================================================================
 * 기타건 최종 출하 승인 읽기 — 「이 줄의 결재가 지금 어디까지 왔나」
 * ============================================================================
 * queries/quote-approvals.ts 와 같은 결이다. [승인] 탭이 물어볼 것 셋에 답한다:
 *  1. 지금 결재 요청이 올라가 있는가, 어느 단계인가 → `getDomesticOrderApprovalProgress`
 *  2. 🔴 승인이 끝났는가, **그리고 그 승인이 지금 내용에 대한 것인가**
 *  3. 결재 이력(누가 언제 무엇을) → `getDomesticOrderApprovalHistory`
 *
 * ── 🔴 같은 표를 읽지만 접수 건 행은 한 줄도 섞이지 않는다 ──────────────
 * 기록은 `repair_case_approvals` 에 함께 쌓인다(2026-11-06 설계). 가르는 것은
 * **`domestic_order_id` 로 좁히는 것 하나**다 — 그 칸은 접수 건 행에서 언제나 NULL
 * 이고(표의 CHECK), 그래서 `= ?` 비교에 걸릴 수가 없다. 반대 방향도 같다: 접수 건
 * 조회들은 `repair_case_id` 로 좁히는데 기타건 행은 그 칸이 언제나 NULL 이다.
 *
 * 🔵 **승인 종류로 한 번 더 좁히지 않는다.** 좁혀도 같은 답이지만(그 칸이 찬 행은
 * 전부 'DOMESTIC_ORDER_FINAL_SHIPMENT' 다 — CHECK), 조건을 둘 두면 둘 중 하나만
 * 고쳐지는 날이 오고 그때 어느 쪽이 참인지 알 수 없다. 가르는 자리는 한 곳이다.
 *
 * ── 🔴 아무 문도 여닫지 않는다 ─────────────────────────────────────────
 * 여기서 돌려주는 값은 **표시**를 위한 것이다. 기타건의 완료 처리·납품은 이 함수들을
 * 부르지 않는다(domain/domestic-order-approval-rules.ts 머리말).
 *
 * ── 🔴 「낡은 승인」을 조용히 재사용하지 않는다 ─────────────────────────
 * 승인이 있어도 그 뒤에 그 줄이 바뀌었으면 「지금 이 내용에 대한 승인」이 아니다.
 * 그 갈림은 여기 적지 않고 **접수 건 승인 카드가 쓰는 그 함수**가 쥐고 있다
 * (resolveApprovalState). 승인 흐름을 그대로 쓴다는 것이 이 기능의 전제이므로
 * (2026-11-06 사용자 결정) 상태 어휘도 한 벌이어야 한다 — STALE 의 뜻이 두 화면에서
 * 달라지면 안 된다.
 * ============================================================================
 */

export type DomesticOrderApprovalRecordRow = {
  id: string;
  status: "REQUESTED" | "APPROVED" | "REJECTED";
  requestedByUserId: string;
  requestedByName: string;
  /** ISO 문자열 — 서버 컴포넌트 경계를 넘어야 하므로 Date 를 그대로 보내지 않는다. */
  requestedAt: string;
  requestReason: string | null;
  /**
   * 이 요청을 처리하도록 지정된 사람. 기타건 결재에는 **언제나 채워져 있다**(요청
   * 경로가 판과 지정을 함께 넣고, 판이 없으면 요청 자체가 거절된다). 화면이 이 값을
   * mayDecideAssignedApproval 에 그대로 넘겨 단추를 열지 말지 정한다.
   */
  assignedApproverUserId: string | null;
  /** 지정된 사람의 이름. 지정이 없으면 `null`. */
  assignedApproverName: string | null;
  /**
   * 🔴 **「현재 판」이 아니라 요청 시점에 붙잡아 둔 판**이다. 진행 중인 건은 관리자가
   * 절차를 바꿔도 이 판을 끝까지 따라간다. 「몇/몇 단계」를 그리려면 이 판으로 단계
   * 수를 세야 한다(queries/shipment-approval-routes.ts 의
   * listShipmentApprovalRouteSteps 가 그 자리다).
   */
  routeId: string | null;
  /** 그 판 안에서 몇 번째 단계인가(1부터). `routeId` 와 함께 있거나 함께 없다. */
  routeStepOrder: number | null;
  decidedByUserId: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
  decisionReason: string | null;
  /**
   * 「**누구 자리**를 대신 누른 것인가」 — 결재선 단계를 위임받아 대신 누른 줄에만
   * 값이 있다. `null` 은 「직접 눌렀다」이고 정상값이다: 결재권자 본인이 누른 줄과
   * **최고관리자 비상구**로 누른 줄이 그렇다.
   *
   * 🔴 `decidedByUserId` 와 **함께 읽어야** 「B 가 A 를 대신해 승인했다」가 복원된다
   * (2026-10-20 사용자 결정).
   */
  delegatedFromUserId: string | null;
  /** 그 자리 사람의 이름 — 화면이 그릴 글자다. 직접 누른 줄이면 `null`. */
  delegatedFromName: string | null;
  /**
   * 🔴 요청한 순간의 `domestic_orders.version`. 「지금 내용에 대한 승인인가」의
   * 근거다. 칸 이름이 `repairCase…` 인 까닭은 스키마의 그 칸 주석에 있다.
   */
  versionAtRequest: number;
};

const SELECT_COLUMNS = {
  id: repairCaseApprovals.id,
  status: repairCaseApprovals.status,
  requestedByUserId: repairCaseApprovals.requestedByUserId,
  requestedByName: requester.name,
  requestedAt: repairCaseApprovals.requestedAt,
  requestReason: repairCaseApprovals.requestReason,
  assignedApproverUserId: repairCaseApprovals.assignedApproverUserId,
  assignedApproverName: assignedApprover.name,
  routeId: repairCaseApprovals.routeId,
  routeStepOrder: repairCaseApprovals.routeStepOrder,
  decidedByUserId: repairCaseApprovals.decidedByUserId,
  decidedByName: decider.name,
  decidedAt: repairCaseApprovals.decidedAt,
  decisionReason: repairCaseApprovals.decisionReason,
  delegatedFromUserId: repairCaseApprovals.delegatedFromUserId,
  delegatedFromName: delegator.name,
  versionAtRequest: repairCaseApprovals.repairCaseVersionAtRequest,
};

function baseQuery() {
  return db
    .select(SELECT_COLUMNS)
    .from(repairCaseApprovals)
    .innerJoin(requester, eq(repairCaseApprovals.requestedByUserId, requester.id))
    // LEFT JOIN — 아직 결정되지 않은 행, **직접 누른 행**(위임이 아니라
    // `delegated_from_user_id` 가 NULL 인 쪽이 대부분이다)이 여기서 떨어지면 안 된다.
    .leftJoin(decider, eq(repairCaseApprovals.decidedByUserId, decider.id))
    .leftJoin(delegator, eq(repairCaseApprovals.delegatedFromUserId, delegator.id))
    .leftJoin(
      assignedApprover,
      eq(repairCaseApprovals.assignedApproverUserId, assignedApprover.id)
    );
}

function toRow(
  row: Awaited<ReturnType<typeof baseQuery>>[number]
): DomesticOrderApprovalRecordRow {
  return {
    ...row,
    requestedAt: row.requestedAt.toISOString(),
    decidedAt: row.decidedAt ? row.decidedAt.toISOString() : null,
  };
}

/**
 * 그 기타건의 결재 이력 전부 — **최신이 먼저**다.
 *
 * 줄은 고쳐 쓰지 않으므로(append 계열, 스키마 머리말) 이 한 번의 조회가 곧 완전한
 * 역사다. 단계마다 행이 하나씩이라 3단계 결재선이면 행이 셋이다.
 */
export async function getDomesticOrderApprovalHistory(
  domesticOrderId: string
): Promise<DomesticOrderApprovalRecordRow[]> {
  const rows = await baseQuery()
    .where(eq(repairCaseApprovals.domesticOrderId, domesticOrderId))
    .orderBy(desc(repairCaseApprovals.requestedAt));
  return rows.map(toRow);
}

export type DomesticOrderApprovalProgress = {
  /** 화면이 그릴 한 마디. 접수 건 승인 카드와 **같은 어휘**다. */
  state: ShipmentApprovalState;
  /** 지금 그 줄의 판 번호 — 위 상태를 정한 근거의 한쪽이다. */
  currentVersion: number;
  /**
   * 가장 최근 결재 행. 한 번도 올린 적이 없으면 `null`(= NOT_REQUESTED).
   *
   * 「어느 단계인가」·「누구 차례인가」는 이 행의 routeId · routeStepOrder ·
   * assignedApproverUserId 가 답한다.
   */
  latest: DomesticOrderApprovalRecordRow | null;
};

/**
 * 그 기타건의 결재가 지금 어디까지 왔나. 줄이 없거나 휴지통이면 `null` — 화면에 없는
 * 줄의 결재 상태를 말할 이유가 없다.
 *
 * 🔴 **판 번호를 부르는 쪽에서 받지 않고 여기서 함께 읽는다.** 받게 하면 낡은 값을
 * 넘기는 자리가 언젠가 생기고, 그때 이 함수는 바뀐 줄을 「승인 완료」로 답한다 —
 * 이 기능이 막으려는 바로 그 사고다.
 *
 * 🔴 **가장 최근 행 하나만 본다.** 다단계 결재선은 단계마다 행을 하나씩 잇는 구조라,
 * 사슬의 지금 상태는 언제나 마지막 행이 말한다. 「가장 최근」의 정의는 `requested_at`
 * 내림차순이고, 사슬을 잇는 저장 경로가 requested_at 을 물려받지 않는 이유가 바로 이
 * 조회를 정해지게 하기 위해서다.
 */
export async function getDomesticOrderApprovalProgress(
  domesticOrderId: string
): Promise<DomesticOrderApprovalProgress | null> {
  const [order] = await db
    .select({ version: domesticOrders.version, isDeleted: domesticOrders.isDeleted })
    .from(domesticOrders)
    .where(eq(domesticOrders.id, domesticOrderId))
    .limit(1);
  if (!order || order.isDeleted) return null;

  const [row] = await baseQuery()
    .where(eq(repairCaseApprovals.domesticOrderId, domesticOrderId))
    .orderBy(desc(repairCaseApprovals.requestedAt))
    .limit(1);

  const latest = row ? toRow(row) : null;
  return {
    // 🔴 판정을 여기 새로 적지 않는다 — 접수 건 승인 카드·결재 대기 조회가 쓰는
    // 그 함수 하나다. 받는 모양이 `repairCaseVersionAtRequest` 라서 칸 이름을 맞춰
    // 넘긴다(표의 칸 이름 그대로이고, 기타건 행에는 내자 줄의 판 번호가 들어 있다).
    state: resolveApprovalState(
      latest
        ? { status: latest.status, repairCaseVersionAtRequest: latest.versionAtRequest }
        : null,
      order.version
    ),
    currentVersion: order.version,
    latest,
  };
}
