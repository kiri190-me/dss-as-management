import "server-only";
import { asc, desc, eq, inArray } from "drizzle-orm";
import { cache } from "react";
import { alias } from "drizzle-orm/pg-core";
import { db } from "../client";
import { domesticOrders, repairCaseApprovals, users } from "../schema";
import {
  resolveApprovalState,
  type ShipmentApprovalState,
} from "@/lib/domain/local/workflow/shipment-approval-checklist";
import {
  domesticOrderApprovalUnitCount,
  foldDomesticOrderApprovalStates,
} from "@/lib/domain/domestic-order-approval-rules";
import {
  domesticOrderDueDateUnits,
  type DomesticOrderDueDateUnit,
} from "@/lib/domain/domestic-order-due-date-label";
import { domesticOrderDueDates } from "../schema";

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
 *  1. 지금 결재 요청이 올라가 있는가, 어느 단계인가
 *  2. 🔴 승인이 끝났는가, **그리고 그 승인이 지금 내용에 대한 것인가**
 *  3. 결재 이력(누가 언제 무엇을) → `getDomesticOrderApprovalHistory`
 *
 * ── 🔴 **앞의 둘에 답하는 함수가 둘이다 — 바꿔 쓰면 안 된다** (2026-11-08) ──
 * 승인의 단위가 **납기요청일 회차**로 내려오면서(사용자 결정 12) 같은 물음에 답하는
 * 자리가 갈라졌다:
 *  · `getDomesticOrderApprovalProgress` — **줄 전체에서 가장 최근 한 줄.** 포털에
 *    결재 메일을 찌르는 자리가 쓴다(「방금 열린 요청이 누구 차례인가」).
 *  · `getDomesticOrderApprovalUnits` — **회차마다 하나씩, 그리고 접은 값 하나.**
 *    [승인] 탭의 카드들과 머리 카드·목록의 배지가 쓴다.
 * 🔴 저쪽을 이것으로 바꾸면 **2차를 올렸는데 1차의 결재자에게 메일이 간다**(접는
 * 규칙이 1차를 먼저 고르기 때문이다). 그 함수들의 머리말에 전문이 있다.
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
 * ── 🔴 여기서 돌려주는 값은 **표시**를 위한 것이다 ──────────────────────
 * 기타건의 완료 처리는 2026-11-07 부터 승인을 요구하지만(사용자 결정), **이 함수들을
 * 부르지 않는다.** 그 관문은 저장 트랜잭션 안에서 **잠근 행을 보고** 판정해야 하므로
 * 결재 행을 거기서 직접 읽는다(mutations/domestic-orders.ts 의
 * checkMiscCaseCompletionApproval).
 *
 * 🔴 **그래서 「가장 최근 한 건」의 정의가 양쪽에서 같아야 한다** — `requested_at`
 * 내림차순의 첫 행. 갈리면 화면은 「승인 완료」라는데 저장은 거절하는 상태가 된다.
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
  /**
   * 🔴 **몇 번째 납기요청일 회차에 대한 승인인가**(1부터, 2026-11-08 사용자 결정 12).
   *
   * 기타건 행에는 언제나 값이 있다(표의 CHECK). `null` 로 열어 둔 것은 타입이 그
   * CHECK 을 모르기 때문이고, 이력 화면은 **값이 있을 때만** 회차를 적는다.
   */
  dueDateRowOrder: number | null;
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
  dueDateRowOrder: repairCaseApprovals.dueDateRowOrder,
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
 * 여러 기타건의 **지금 승인 상태**를 한 번에 — 「기타건 현황」 목록의 상태 배지가
 * 쓴다(2026-11-06).
 *
 * 🔴 **줄마다 getDomesticOrderApprovalProgress 를 부르지 않는다.** 그러면 줄 수만큼
 * 질의가 두 번씩 돈다(N+1). 여기서는 **질의 하나**로 그 줄들의 결재 행을 통째로 걷어
 * 와 각 줄의 최신 한 건만 남긴다.
 *
 * 🔴 **「최신」의 정의가 저쪽과 같아야 한다** — `requested_at` 내림차순의 첫 행이다.
 * 갈리면 같은 줄이 목록과 상세에서 다른 상태로 보인다. 그래서 정렬을 SQL 에 걸고
 * **먼저 온 것이 이기게** 담는다(아래 `if (map.has(...)) continue`).
 *
 * 🔴 **판 번호는 부르는 쪽이 준다.** 목록이 이미 그 줄들을 읽어 왔고(`version` 이
 * 거기 실려 있다), 여기서 다시 읽으면 같은 표를 한 요청에 두 번 훑는다. 낡은 값을
 * 넘길 위험은 같은 요청 안에서 방금 읽은 줄을 그대로 넘기는 한 없다.
 *
 * 결재 기록이 한 줄도 없는 기타건은 **지도에 넣지 않는다** — 「없음」을 돌려주지
 * 않고 아예 빼므로, 받는 쪽이 `?? null` 로 메우면 그것이 곧 NOT_REQUESTED 다
 * (domain/misc-case-status.ts 가 그 둘을 같게 다룬다).
 */
export async function loadDomesticOrderApprovalStates(
  orders: readonly {
    id: string;
    version: number;
    /**
     * 🔴 그 줄의 납기요청일 행들 — **길이만 쓴다**(2026-11-08). 승인이 회차마다 서므로
     * 「이 줄의 상태」는 회차 수를 알아야 접을 수 있다: 회차가 둘인데 1차만 승인됐으면
     * 그 줄은 아직 승인 완료가 아니다.
     *
     * 🔵 목록이 이미 읽어 온 값을 그대로 넘긴다(DomesticOrderListItem.dueDates) —
     * 여기서 다시 세면 같은 표를 한 요청에 두 번 훑는다.
     */
    dueDates: readonly unknown[];
  }[]
): Promise<Map<string, ShipmentApprovalState>> {
  const states = new Map<string, ShipmentApprovalState>();
  if (orders.length === 0) return states;

  const byId = new Map(orders.map((order) => [order.id, order]));

  const rows = await db
    .select({
      domesticOrderId: repairCaseApprovals.domesticOrderId,
      dueDateRowOrder: repairCaseApprovals.dueDateRowOrder,
      status: repairCaseApprovals.status,
      versionAtRequest: repairCaseApprovals.repairCaseVersionAtRequest,
    })
    .from(repairCaseApprovals)
    .where(inArray(repairCaseApprovals.domesticOrderId, [...byId.keys()]))
    .orderBy(desc(repairCaseApprovals.requestedAt));

  /** 줄 → (회차 번호 → 그 회차의 최신 상태). */
  const perRow = new Map<string, Map<number, ShipmentApprovalState>>();
  for (const row of rows) {
    // 이 칸이 찬 행만 걸러 왔으므로 null 일 수 없지만, 타입이 그것을 모른다.
    if (row.domesticOrderId === null) continue;
    // 기타건 행에는 언제나 회차가 있다(표의 CHECK). 역시 타입이 모른다.
    if (row.dueDateRowOrder === null) continue;
    const order = byId.get(row.domesticOrderId);
    if (order === undefined) continue;
    let bucket = perRow.get(row.domesticOrderId);
    if (!bucket) {
      bucket = new Map();
      perRow.set(row.domesticOrderId, bucket);
    }
    // 🔴 **먼저 온 것이 이긴다** — 위 정렬이 최신을 맨 앞에 둔다.
    if (bucket.has(row.dueDateRowOrder)) continue;
    bucket.set(
      row.dueDateRowOrder,
      // 🔴 판정은 여기 새로 적지 않는다 — 상세가 쓰는 그 함수 하나다.
      resolveApprovalState(
        { status: row.status, repairCaseVersionAtRequest: row.versionAtRequest },
        order.version
      )
    );
  }

  for (const [orderId, bucket] of perRow) {
    const order = byId.get(orderId);
    if (order === undefined) continue;
    // 🔴 **회차 전부를 차례대로** 본다 — 승인 행이 한 줄도 없는 회차는 NOT_REQUESTED
    //    이고, 그 하나 때문에 줄이 승인 완료가 아니게 된다.
    const unitCount = domesticOrderApprovalUnitCount(order.dueDates.length);
    const perUnit: ShipmentApprovalState[] = [];
    for (let rowOrder = 1; rowOrder <= unitCount; rowOrder += 1) {
      perUnit.push(bucket.get(rowOrder) ?? "NOT_REQUESTED");
    }
    // 🔴 접는 규칙도 여기 새로 적지 않는다 — 머리 카드 배지·완료 관문과 같은 함수다.
    states.set(orderId, foldDomesticOrderApprovalStates(perUnit));
  }

  return states;
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
 *
 * 🔵 **cache() 로 감쌌다**(2026-11-06). 상세의 머리 카드가 상태 배지를 그리면서 이
 * 함수를 부르게 되어(사용자 요구), 레이아웃과 [승인] 탭이 한 요청 안에서 같은 id 를
 * 두 번 묻는 자리가 생겼다 — 감싸지 않으면 화면 한 장에 질의가 네 벌 돈다. 요청
 * 하나에만 걸리는 메모라 요청 사이로 새지 않고, 승인을 누른 직후의 다음 요청은 새
 * 값을 읽는다(queries/domestic-orders.ts 의 getDomesticOrderDetail 과 같은 장치).
 */
export const getDomesticOrderApprovalProgress = cache(async function getDomesticOrderApprovalProgress(
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
});

/** 한 **회차**의 결재가 지금 어디까지 왔나 — [승인] 탭의 카드 한 장이 쓰는 값. */
export type DomesticOrderApprovalUnitProgress = DomesticOrderDueDateUnit & {
  /** 화면이 그릴 한 마디. 접수 건 승인 카드와 **같은 어휘**다. */
  state: ShipmentApprovalState;
  /** 그 회차의 가장 최근 결재 행. 한 번도 올린 적이 없으면 `null`. */
  latest: DomesticOrderApprovalRecordRow | null;
};

export type DomesticOrderApprovalUnitsProgress = {
  /** 지금 그 줄의 판 번호 — 아래 상태들을 정한 근거의 한쪽이다. */
  currentVersion: number;
  /**
   * 🔴 **줄 하나로 접은 상태** — 머리 카드 배지와 기타건 현황 목록이 쓰는 그 값이다.
   * 접는 규칙은 여기 적지 않고 도메인 함수 하나를 부른다
   * (foldDomesticOrderApprovalStates).
   */
  state: ShipmentApprovalState;
  /** 🔴 **차례대로**다. 회차가 0개인 줄에도 단위는 하나 있다(도메인 함수). */
  units: DomesticOrderApprovalUnitProgress[];
};

/**
 * ============================================================================
 * 🔴 그 기타건의 **회차별** 결재 진행 (2026-11-08)
 * ============================================================================
 * [승인] 탭이 회차마다 카드 한 장을 세우고, 머리 카드가 접은 배지 하나를 그린다.
 *
 * ── 🔴 위 `getDomesticOrderApprovalProgress` 와 **무엇이 다른가** ────────
 * 저쪽은 **「방금 생긴 행」**을 돌려준다(줄 전체에서 가장 최근 한 줄). 포털에 결재
 * 메일을 찌르는 자리가 쓰는 값이고, 그 자리는 **지금 막 열린 요청**이 누구 차례인지만
 * 알면 된다 — 회차가 여럿이어도 방금 만든 행이 언제나 가장 최근이라 뜻이 그대로다.
 * 🔴 **그 함수를 이 함수로 바꾸지 말 것** — 바꾸면 2차를 올렸는데 1차의 결재자에게
 * 메일이 가는 날이 온다(접는 규칙이 1차를 먼저 고르기 때문이다).
 *
 * 이 함수는 **「각 회차가 지금 어디까지 왔나」**를 돌려준다. 카드 셋을 그리고 완료
 * 단추 셋을 열고 닫는 데 쓴다.
 *
 * ── 🔴 「가장 최근」의 정의가 세 곳에서 같아야 한다 ─────────────────────
 * `(domestic_order_id, due_date_row_order)` 마다 `requested_at` 내림차순의 첫 행.
 * 완료 관문(mutations/domestic-orders.ts)과 목록 배지
 * (loadDomesticOrderApprovalStates)가 같은 정의를 쓴다 — 갈리면 화면은 「승인 완료」
 * 라는데 저장은 거절한다.
 *
 * 🔵 **cache() 로 감쌌다** — 상세 레이아웃의 머리 카드와 [승인] 탭이 한 요청 안에서
 * 같은 id 를 두 번 묻는다(위 getDomesticOrderApprovalProgress 와 같은 사정).
 * ============================================================================
 */
export const getDomesticOrderApprovalUnits = cache(async function getDomesticOrderApprovalUnits(
  domesticOrderId: string
): Promise<DomesticOrderApprovalUnitsProgress | null> {
  const [order] = await db
    .select({ version: domesticOrders.version, isDeleted: domesticOrders.isDeleted })
    .from(domesticOrders)
    .where(eq(domesticOrders.id, domesticOrderId))
    .limit(1);
  if (!order || order.isDeleted) return null;

  // 🔴 회차 이름표는 **그 표의 값**으로 만든다 — 번호만으로는 사람이 어느 회차인지
  //    알 수 없다(domain/domestic-order-due-date-label.ts 의 머리말).
  //    차례는 화면이 그리는 차례와 **같아야 한다**(queries/domestic-orders.ts 의 loadDueDates).
  const dueDateRows = await db
    .select({
      dueDate: domesticOrderDueDates.dueDate,
      note: domesticOrderDueDates.note,
    })
    .from(domesticOrderDueDates)
    .where(eq(domesticOrderDueDates.domesticOrderId, domesticOrderId))
    .orderBy(asc(domesticOrderDueDates.displayOrder), asc(domesticOrderDueDates.dueDate));

  const rows = await baseQuery()
    .where(eq(repairCaseApprovals.domesticOrderId, domesticOrderId))
    .orderBy(desc(repairCaseApprovals.requestedAt));

  const latestByRow = new Map<number, DomesticOrderApprovalRecordRow>();
  for (const row of rows) {
    if (row.dueDateRowOrder === null) continue;
    // 🔴 먼저 온 것이 이긴다 — 위 정렬이 최신을 맨 앞에 둔다.
    if (latestByRow.has(row.dueDateRowOrder)) continue;
    latestByRow.set(row.dueDateRowOrder, toRow(row));
  }

  const units = domesticOrderDueDateUnits(dueDateRows).map((unit) => {
    const latest = latestByRow.get(unit.rowOrder) ?? null;
    return {
      ...unit,
      state: resolveApprovalState(
        latest
          ? { status: latest.status, repairCaseVersionAtRequest: latest.versionAtRequest }
          : null,
        order.version
      ),
      latest,
    };
  });

  return {
    currentVersion: order.version,
    state: foldDomesticOrderApprovalStates(units.map((unit) => unit.state)),
    units,
  };
});
