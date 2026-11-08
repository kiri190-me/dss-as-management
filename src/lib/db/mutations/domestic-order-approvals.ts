import "server-only";
import { and, count, desc, eq } from "drizzle-orm";
import { db } from "../client";
import { domesticOrderDueDates, domesticOrders, repairCaseApprovals, users } from "../schema";
import {
  approvalFollowsRoute,
  delegatedFromUserIdFor,
  mayDecideAssignedApproval,
  NO_ROUTE_DELEGATIONS,
} from "@/lib/auth/approval-assignment";
import { hasPermission } from "@/lib/auth/permission-resolver";
import { resolveActingApproverUserIds } from "../queries/approval-route-delegations";
import {
  DOMESTIC_ORDER_APPROVAL_ROUTE_MISSING_NOTICE,
  DOMESTIC_ORDER_APPROVAL_ROUTE_SCOPE,
  DOMESTIC_ORDER_APPROVAL_TYPE,
  isDomesticOrderApprovalRouteInForce,
  isDomesticOrderApprovalUnit,
} from "@/lib/domain/domestic-order-approval-rules";
import { findNextRouteStepToApprove } from "@/lib/domain/shipment-approval-route";
import {
  getCurrentShipmentApprovalRouteChain,
  getShipmentApprovalRouteSteps,
} from "../queries/shipment-approval-routes";
import { resolveEligibleActor } from "./procedure-templates";
import { acquireShipmentApprovalRouteSharedLock } from "./shipment-approval-routes";

/**
 * ============================================================================
 * 기타건 최종 출하 승인 — 요청 · 승인 · 반려
 * ============================================================================
 * mutations/quote-approvals.ts 를 **그대로 본떴다**(그쪽이 mutations/repair-case-
 * approvals.ts 의 결재선 분기를 본뜬 것이다). 네 결재가 **같은 결재선 표**를 쓰므로
 * 사슬을 잇는 방식도 한 벌이어야 한다 — 단계마다 요청 행을 하나씩 만들고, 그 행의
 * 지정된 사람이 그 단계의 승인자가 된다(auth/approval-assignment.ts 머리말).
 *
 * 🔴 **2026-11-06 사용자 결정: 「기존에 만들어놨던 승인절차를 그대로 사용」.** 그래서
 * 아래에 새 규칙이 없다 — 지정 관문 · 결재선 단계 위임 · 요청자 본인 단계 건너뛰기 ·
 * 「요청 뒤에 바뀌면 무효」가 전부 이미 있는 함수 그대로다. 갈라진 것은 **결재선
 * 갈래 하나**뿐이다('DOMESTIC_ORDER_FINAL_SHIPMENT').
 *
 * ── 🔴 왜 `repair_case_approvals` 에 쓰는가 ─────────────────────────────
 * 표 이름은 `repair_case_…` 인데 기타건 행이 들어간다. 사용자 승인을 받은 설계다
 * (2026-11-06, 「㉮ 그 표에 칸을 더한다」) — 위 규칙들이 접수 건 출하 승인과 **글자
 * 그대로 같아서** 표를 따로 두면 그 규칙이 두 벌이 된다.
 *
 * 🔴 **접수 건 쪽 조회는 한 줄도 바뀌지 않았다.** 기타건 행은 `repair_case_id` 가
 * 언제나 NULL 이고(표의 CHECK), 접수 건 조회는 전부 그 칸으로 좁히거나 repair_cases
 * 와 INNER JOIN 한다. 승인 종류까지 따로 둔 것이 그 보증의 두 번째 겹이다.
 *
 * ── 🔴 이 파일은 단계를 옮기지 않는다 — 그러나 결과는 문 하나를 연다 ────
 * 기타건에는 워크플로가 없다. 접수 건 출하 승인은 사슬이 끝나면 단계를 [출하 대기]로
 * 옮기지만(autoAdvanceToShipmentWaitingInTx), **옮길 단계 자체가 없으므로 그 함수를
 * 부르지 않는다.** 이 파일이 하는 일은 결재 행을 잇는 것뿐이다.
 *
 * 🔴 **다만 2026-11-07 부터 그 행이 [완료] 처리의 열쇠가 됐다**(사용자 결정). 내자 줄의
 * [완료 처리]는 이제 기타건의 최신 결재 행을 읽고, 「승인 완료 + 지금 version」이
 * 아니면 거절한다(mutations/domestic-orders.ts 의 setDomesticOrderCompletion).
 * 🔵 **이 파일에서 바뀐 줄은 없다** — 읽는 쪽이 생겼을 뿐이다. 특히 아래 「완료된
 * 줄에서도 올릴 수 있다」는 그대로다: 막는 방향은 한쪽뿐이다.
 *
 * ── 🔴 완료된 줄에서도 올릴 수 있다 ────────────────────────────────────
 * 접수 건 쪽은 `repair_cases.is_locked` 를 보고 거절하는데, 내자 줄의 `completed_at`
 * 은 **그런 잠금이 아니다** — 완료한 뒤에도 값을 고칠 수 있고([완료 해제]도 있다)
 * updateDomesticOrder 는 그 칸을 보지 않는다. 그래서 여기서도 보지 않는다. 막으면
 * 「납품을 마치고 나서 승인 기록을 남기는」 정상 업무가 막힌다.
 *
 * ── 인가 ────────────────────────────────────────────────────────────────
 * 🔴 **새 권한 영역을 만들지 않는다.**
 *  · **요청**은 `domesticOrders` WRITE 다 — 내자 줄을 만들고 고치는 그 자리의
 *    행동이고(server/actions/domestic-orders.ts 와 같은 영역·같은 수준), 올리는
 *    사람은 언제나 그 줄을 손에 쥔 사람이다.
 *  · **승인·반려**는 권한 영역을 보지 않는다 — 계정 자격(승인됨·활성·잠기지 않음·
 *    삭제 안 됨)과 **지정 관문** 둘뿐이다. 결재선에 올라간 사람이 곧 그 단계의
 *    결재자라는 것이 이 기능의 설계이고, 이미 있는 세 결재선 경로가 똑같이 권한
 *    영역을 묻지 않는다. 여기서만 `domesticOrders` 를 요구하면 결재선에 올릴 수 있는
 *    사람(역할 제한이 없다)과 결재할 수 있는 사람이 갈라져 **관리자가 아무도 처리할
 *    수 없는 절차를 만들 수 있게 된다.**
 *  🔵 다만 결재 **화면**은 `domesticOrders` READ 로 막혀 있다([id]/layout.tsx) —
 *     결재선에 세울 사람은 내자를 볼 수 있어야 한다. 접수 건 출하 승인도 같은 모양이다
 *     (`repairCases` READ 가 있어야 그 화면이 열린다).
 *
 * ── 🔴 자격 검사(먼저) → 지정 관문(나중) ───────────────────────────────
 * 순서가 뒤집히면 **지정이 권한을 만들어 낸다**(auth/approval-assignment.ts 머리말).
 * 지정은 「자격 있는 사람들 중 누구」를 좁히는 것이지 자격을 주는 것이 아니다.
 * ============================================================================
 */

export type DomesticOrderApprovalFailureCode =
  /** 기타건 줄이 없다 · 휴지통이다 / 결재 요청이 없다. */
  | "NOT_FOUND"
  /** 이 사람은 이 일을 할 수 없다(권한·계정 자격·지정 관문). */
  | "FORBIDDEN"
  /** 반려인데 사유가 비어 있다 / 🔴 그 줄에 없는 회차 번호를 보냈다(2026-11-08). */
  | "VALIDATION_ERROR"
  /**
   * 🔴 **한 회차에** 살아 있는 요청은 하나다
   * (repair_case_approvals_one_active_domestic_request). 2026-11-08 까지는 「한
   * 기타건에 하나」였고, 그 보증이 바로 회차마다 승인을 올리는 길을 막고 있었다 —
   * 단위가 회차로 내려오면서 색인의 칸이 하나 늘었다.
   */
  | "ALREADY_REQUESTED"
  /**
   * 🔴 기타건 최종 출하 승인 절차(결재선)가 없거나 단계가 0개다. 기타건에는 대신할
   * 결재자(「출하 대표」)가 없어서 그때는 요청 자체를 거절한다 —
   * domain/domestic-order-approval-rules.ts 의 isDomesticOrderApprovalRouteInForce 에
   * 근거 셋이 적혀 있다. FORBIDDEN 과 가르는 이유는 사람이 해야 할 다음 행동이 다르기
   * 때문이다 — 고쳐야 할 것은 이 사람의 권한이 아니라 **승인 절차 그 자체**다.
   */
  | "ROUTE_NOT_CONFIGURED"
  /** 단계는 있는데 전부 요청자 본인이라 보낼 곳이 없다. */
  | "ROUTE_HAS_NO_OTHER_APPROVER"
  /** 그 사이 남이 먼저 처리했다. */
  | "CONFLICT";

export type DomesticOrderApprovalFailure = {
  ok: false;
  code: DomesticOrderApprovalFailureCode;
  message: string;
};

export type RequestDomesticOrderApprovalResult =
  | { ok: true; id: string }
  | DomesticOrderApprovalFailure;

export type DecideDomesticOrderApprovalResult =
  | {
      ok: true;
      /** 방금 결정된 행. */
      id: string;
      /** 사슬이 이어졌으면 새로 열린 행, 끝났으면 `null`. */
      nextApprovalId: string | null;
    }
  | DomesticOrderApprovalFailure;

class DomesticOrderApprovalMutationError extends Error {
  result: DomesticOrderApprovalFailure;
  constructor(result: DomesticOrderApprovalFailure) {
    super(result.message);
    this.result = result;
  }
}

function fail(code: DomesticOrderApprovalFailureCode, message: string): never {
  throw new DomesticOrderApprovalMutationError({ ok: false, code, message });
}

/**
 * postgres-js 는 진짜 오류를 `.cause` 아래 싸서 올린다 — 겉 오류의 `.code` 는
 * 언제나 undefined 다(mutations/quote-approvals.ts 와 같은 규약).
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
 * 행위자를 **이 트랜잭션 안에서 다시 읽는다** — 세션이 만들어진 뒤 역할이 내려갔거나
 * 계정이 잠겼을 수 있다. 조건(승인됨·활성·잠기지 않음·삭제 안 됨)을 여기 한 벌 더
 * 적지 않고 이미 있는 함수를 부른다.
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

export type RequestDomesticOrderApprovalInput = {
  domesticOrderId: string;
  actorUserId: string;
  /** 올리며 적는 말. 없어도 된다. */
  requestReason: string | null;
  /**
   * 🔴 **어느 회차에 대한 승인인가**(1부터, 2026-11-08 사용자 결정 12). 화면은 회차가
   * 둘 이상일 때 드롭다운으로 고르게 하고, 하나뿐이면 묻지 않고 1을 보낸다.
   *
   * 🔴 **필수다.** 「안 보내면 1」로 두면 드롭다운이 고장난 날 모든 요청이 조용히
   * 1차로 쏠리고, 그 어긋남은 완료를 눌러 보기 전에는 드러나지 않는다.
   */
  dueDateRowOrder: number;
};

/**
 * 그 줄의 납기요청일 행이 몇인가 — **승인 단위 수를 세는 재료**다.
 *
 * 🔴 **잠근 줄 안에서 읽는다**(부르는 쪽이 `FOR UPDATE` 로 그 줄을 쥐고 있다). 줄의
 * 납기요청일을 바꾸는 저장도 같은 행을 잠그므로(updateDomesticOrder) 둘이 줄을 선다 —
 * 그래서 「세고 나서 넣기」 사이에 회차가 사라지는 틈이 없다.
 */
async function countDueDateRows(tx: Tx, domesticOrderId: string): Promise<number> {
  const [row] = await tx
    .select({ value: count() })
    .from(domesticOrderDueDates)
    .where(eq(domesticOrderDueDates.domesticOrderId, domesticOrderId));
  return Number(row?.value ?? 0);
}

/**
 * 기타건 한 줄의 최종 출하 승인을 올린다 — **첫 단계 행 하나만** 만든다.
 *
 * 🔴 요청 시점의 `domestic_orders.version` 을 반드시 싣는다. 표의
 * `repair_case_version_at_request` 는 NOT NULL 이고 기본값이 없다 — 그것이 의도다
 * (기본값이 있으면 version 을 싣지 않은 요청이 조용히 「1판에 대한 승인」이 된다).
 */
export async function requestDomesticOrderApproval(
  input: RequestDomesticOrderApprovalInput
): Promise<RequestDomesticOrderApprovalResult> {
  try {
    return await db.transaction(async (tx): Promise<RequestDomesticOrderApprovalResult> => {
      // 🔴 결재선 공유 잠금 — 이 트랜잭션의 **첫 잠금**이다. 판을 읽어 첫 단계
      // 승인자를 지정하는 동안 결재선 저장 · 사용자 계정 삭제(배타 잠금)가
      // 끼어들지 못하게 한다(mutations/shipment-approval-routes.ts 의 도우미 주석).
      await acquireShipmentApprovalRouteSharedLock(tx);

      const actor = await requireActor(tx, input.actorUserId);

      // 인가 — 내자 줄을 고칠 수 있는 사람이 올린다(파일 머리말의 「인가」).
      if (!(await hasPermission(actor, "domesticOrders", "WRITE"))) {
        fail("FORBIDDEN", "이 작업을 수행할 권한이 없습니다.");
      }

      // 🔴 판 번호를 **잠근 행에서** 읽는다. 잠그지 않으면 방금 읽은 version 이
      // 커밋 직전에 updateDomesticOrder 로 올라가, 처음부터 낡은 승인이 되어 버린다
      // (그 mutation 도 같은 행을 FOR UPDATE 로 잡는다 — 둘이 줄을 선다).
      const [order] = await tx
        .select({
          id: domesticOrders.id,
          version: domesticOrders.version,
          isDeleted: domesticOrders.isDeleted,
        })
        .from(domesticOrders)
        .where(eq(domesticOrders.id, input.domesticOrderId))
        .limit(1)
        .for("update");
      if (!order || order.isDeleted) {
        // 휴지통의 줄은 목록에도 상세에도 없다 — 화면에 없는 것에 결재를 올릴 수 없다.
        fail("NOT_FOUND", "해당 기타건을 찾을 수 없습니다.");
      }

      // 🔴 **보내온 회차가 그 줄에 실제로 있는 번호인가**(2026-11-08). 화면이 보낸
      // 값은 형식 말고는 아무것도 믿지 않는다 — 막지 않으면 「3차에 대한 승인」이
      // 회차가 둘뿐인 줄에 붙고, 그 승인은 관문이 보지 않아 **영영 쓰이지 않는다**
      // (사람에게는 「승인했는데 완료가 안 된다」로만 보인다).
      // 🔵 회차가 0개인 줄도 단위는 하나다 — 그 판정은 도메인 함수가 가진다.
      const dueDateRowCount = await countDueDateRows(tx, order.id);
      if (!isDomesticOrderApprovalUnit(input.dueDateRowOrder, dueDateRowCount)) {
        fail(
          "VALIDATION_ERROR",
          "그 납기요청일 회차를 찾을 수 없습니다. 최신 정보를 다시 불러와 주세요."
        );
      }

      // 트랜잭션 안 재확인이 앞단이고, 부분 유니크 색인이 DB 쪽 최종 방어선이다
      // (아래 catch 의 23505). 둘 다 있어야 동시에 두 사람이 올릴 때 결재선이 둘로
      // 갈라지지 않는다.
      //
      // 🔴 **회차까지 좁힌다**(2026-11-08). 안 좁히면 1차가 열려 있는 동안 2차를 올릴
      // 수 없고, 그것이 바로 이 조각이 푸는 문제다.
      const [existingActive] = await tx
        .select({ id: repairCaseApprovals.id })
        .from(repairCaseApprovals)
        .where(
          and(
            eq(repairCaseApprovals.domesticOrderId, input.domesticOrderId),
            eq(repairCaseApprovals.dueDateRowOrder, input.dueDateRowOrder),
            eq(repairCaseApprovals.status, "REQUESTED")
          )
        );
      if (existingActive) {
        fail("ALREADY_REQUESTED", "이미 처리 대기 중인 결재 요청이 있습니다.");
      }

      // 🔴 「현재 판」의 정의는 여기 적지 않는다 — 그 용도 안에서 version 이 가장 큰
      // 판 하나이고, 그 정의가 적힌 곳은 queries/shipment-approval-routes.ts 하나다.
      // 용도 문자열도 글자로 적지 않는다(도메인 상수 하나).
      const route = await getCurrentShipmentApprovalRouteChain(
        tx,
        DOMESTIC_ORDER_APPROVAL_ROUTE_SCOPE
      );
      if (!isDomesticOrderApprovalRouteInForce(route)) {
        // 판이 없는 것도 단계가 0개인 것도 「절차를 쓰지 않겠다」는 같은 뜻이고,
        // 기타건에는 대신할 결재자가 없어 그 뜻이 곧 「올릴 수 없다」다.
        // 🔴 화면이 **누르기 전에** 하는 말과 **같은 한 줄**을 쓴다 — 둘이 다르면
        // 둘 다 본 사람은 어느 쪽이 참인지 모른다.
        fail("ROUTE_NOT_CONFIGURED", DOMESTIC_ORDER_APPROVAL_ROUTE_MISSING_NOTICE);
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
        .insert(repairCaseApprovals)
        .values({
          // 🔴 `repairCaseId` 를 싣지 않는다(기본값 NULL). 표의 CHECK
          // (`…_domestic_type_has_no_repair_case`)이 그것을 강제하고, 그 NULL 이
          // 접수 건 조회들이 이 행을 집어 들지 않게 하는 보증이다.
          domesticOrderId: order.id,
          // 🔴 **어느 회차인가**(2026-11-08). 표의 CHECK 이 기타건 행에 이 값을
          // 요구하므로, 빠뜨리면 INSERT 자체가 거절된다 — 조용히 통과하는 길이 없다.
          dueDateRowOrder: input.dueDateRowOrder,
          approvalType: DOMESTIC_ORDER_APPROVAL_TYPE,
          status: "REQUESTED",
          requestedByUserId: actor.id,
          requestReason: input.requestReason,
          assignedApproverUserId: firstStep.approverUserId,
          // 🔴 판과 단계는 **한 쌍**으로 넣는다(CHECK 이 그것을 지킨다). 요청 시점의
          // 판을 붙잡아 두어, 관리자가 절차를 바꿔도 이미 올라간 건은 옛 판을 끝까지
          // 따라간다.
          routeId: route.routeId,
          // 🔴 **건너뛴 뒤의 실제 번호**를 적는다(예: 2). 1로 고쳐 적으면 이 번호로
          // 옛 판의 다음 단계를 찾을 때 이미 지나온 단계로 되돌아간다.
          routeStepOrder: firstStep.stepOrder,
          // 🔴 「승인 뒤 내용이 바뀌면 그 승인은 무효」가 이 한 칸에 걸려 있다.
          // 칸 이름은 `repair_case_…` 지만 기타건 행에는 내자 줄의 판 번호가 들어간다
          // (스키마의 그 칸 주석에 까닭이 있다).
          repairCaseVersionAtRequest: order.version,
        })
        .returning({ id: repairCaseApprovals.id });

      return { ok: true, id: inserted.id };
    });
  } catch (err) {
    if (err instanceof DomesticOrderApprovalMutationError) return err.result;
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

export type DecideDomesticOrderApprovalInput = {
  domesticOrderId: string;
  decision: "APPROVED" | "REJECTED";
  actorUserId: string;
  /** 🔴 반려에는 **필수**다(표의 repair_case_approvals_decision_metadata CHECK). */
  decisionReason: string | null;
  /**
   * 🔴 **어느 회차의 결재를 처리하는가**(1부터, 2026-11-08). 한 기타건에 열린 요청이
   * 회차마다 하나씩 **여럿일 수 있게** 되었으므로, 이 값 없이는 「가장 최근 행」이
   * 남의 회차를 집어 든다 — 1차를 승인하려고 눌렀는데 2차가 승인되는 모양이다.
   */
  dueDateRowOrder: number;
};

/**
 * 한 단계를 승인하거나 반려한다 — 그리고 승인이면 **다음 단계를 이어 연다.**
 *
 * 반려면 사슬이 거기서 끊긴다. 다시 받으려면 **새 요청**을 올린다 — 상태에
 * `CHANGES_REQUESTED` 를 두지 않은 이유가 그것이다(schema/repair-case-approvals.ts).
 */
export async function decideDomesticOrderApproval(
  input: DecideDomesticOrderApprovalInput
): Promise<DecideDomesticOrderApprovalResult> {
  try {
    return await db.transaction(async (tx): Promise<DecideDomesticOrderApprovalResult> => {
      // 🔴 결재선 공유 잠금 — 요청 경로와 같은 이유로 **첫 잠금**이다. 아래에서 사슬을
      // 이을 때 판의 다음 단계 승인자를 지정하는데, 그 사이 사용자 계정 삭제가
      // 커밋되면 지워진 사람에게 다음 행이 간다. 결정할 행을 FOR UPDATE 로 잠그기
      // **전에** 건다 — 뒤에 걸면 삭제(배타 잠금 → 결재 행)와 교착한다.
      await acquireShipmentApprovalRouteSharedLock(tx);

      const actor = await requireActor(tx, input.actorUserId);

      // 🔴 여기서는 내자 줄을 잠그지 않는다. 판 번호를 새로 찍지 않고 앞 행에서
      // 물려받기 때문이다(아래) — 잠글 이유가 없는 행을 잠그면 결재가 내자 수정과
      // 쓸데없이 줄을 서게 된다.
      const [order] = await tx
        .select({ id: domesticOrders.id, isDeleted: domesticOrders.isDeleted })
        .from(domesticOrders)
        .where(eq(domesticOrders.id, input.domesticOrderId))
        .limit(1);
      if (!order || order.isDeleted) {
        fail("NOT_FOUND", "해당 기타건을 찾을 수 없습니다.");
      }

      // 가장 최근 행을 **잠그고** 읽는다 — 같은 행을 동시에 결재하려는 트랜잭션이
      // 여기서 줄을 선다. 뒤에 온 쪽은 커밋 뒤의 상태를 다시 읽고 CONFLICT 다.
      const [latest] = await tx
        .select({
          id: repairCaseApprovals.id,
          status: repairCaseApprovals.status,
          assignedApproverUserId: repairCaseApprovals.assignedApproverUserId,
          routeId: repairCaseApprovals.routeId,
          routeStepOrder: repairCaseApprovals.routeStepOrder,
          requestedByUserId: repairCaseApprovals.requestedByUserId,
          requestReason: repairCaseApprovals.requestReason,
          repairCaseVersionAtRequest: repairCaseApprovals.repairCaseVersionAtRequest,
        })
        .from(repairCaseApprovals)
        // 🔴 **회차까지 좁힌다**(2026-11-08). 한 기타건에 열린 요청이 여럿일 수 있으므로
        // 줄만으로 좁히면 「가장 최근 행」이 남의 회차가 된다.
        .where(
          and(
            eq(repairCaseApprovals.domesticOrderId, order.id),
            eq(repairCaseApprovals.dueDateRowOrder, input.dueDateRowOrder)
          )
        )
        .orderBy(desc(repairCaseApprovals.requestedAt))
        .limit(1)
        .for("update");
      if (!latest) fail("NOT_FOUND", "관련 결재 요청을 찾을 수 없습니다.");

      // 🔴 잠근 행에서 상태를 **다시 확인**한다. 화면이 무엇을 보여 줬든 상관없다.
      if (latest.status !== "REQUESTED") {
        fail("CONFLICT", "이미 처리된 결재입니다. 최신 정보를 다시 불러와 주세요.");
      }

      // 🔴 「지금 이 사람이 대신할 수 있는 자리들」 — **이 트랜잭션 안에서** 읽는다.
      // 바깥에서 읽으면 읽은 직후 되돌려진 위임으로 결재가 통과하고, 그 어긋남은
      // 오류를 내지 않는다(resolveActingApproverUserIds 의 🔴 주석).
      //
      // 🔵 조건을 다는 것은 모양을 다른 셋과 **한 벌로 두기 위해서**다 — 위임이
      // 걸리는 것은 결재선 **단계**이고, 그 판정은 공용 함수 하나(approvalFollowsRoute)만
      // 본다. 기타건 결재는 언제나 결재선을 타므로(판이 없으면 요청 자체가
      // ROUTE_NOT_CONFIGURED 로 거절된다) 실제로는 언제나 참이다. 거짓인 행이 있다면
      // 저장 경로가 깨진 것이고, 그때는 위임을 붙이지 않는 쪽(좁은 쪽)으로 넘어간다.
      const actingApproverUserIds = approvalFollowsRoute(latest)
        ? await resolveActingApproverUserIds(actor.id, new Date(), tx)
        : NO_ROUTE_DELEGATIONS;

      // 🔴 지정 관문 — 계정 자격(requireActor)을 본 **뒤에** 얹는다. 순서가 뒤집히면
      // 지정이 권한을 만들어 낸다. 판정은 여기서 새로 적지 않고 출하 승인·견적서
      // 결재·알림 조회와 **같은 함수 하나**를 부른다. 최고관리자 비상구도 그 함수
      // 안에 있다 — 지정된 사람이 자리를 비워 영영 막히는 것을 막는 유일한 길이다.
      if (
        !mayDecideAssignedApproval(
          latest.assignedApproverUserId,
          {
            id: actor.id,
            role: actor.role,
            isDeveloper: actor.isDeveloper,
          },
          actingApproverUserIds
        )
      ) {
        await failAssignmentGate(tx, latest.assignedApproverUserId);
      }

      // 🔴 **누구 자리를 대신 누른 것인가** — 관문을 통과한 **뒤에** 정한다. 위임으로
      // 통과한 것이 아니면(본인 차례 · 최고관리자 비상구) null 이고, 그것이 「직접
      // 눌렀다」라는 정상값이다(표의 delegated_from_user_id 주석).
      const delegatedFromUserId = delegatedFromUserIdFor(
        latest.assignedApproverUserId,
        actor.id,
        actingApproverUserIds
      );

      if (input.decision === "REJECTED" && !input.decisionReason) {
        // 표의 CHECK 이 최종적으로 막지만, 여기서 먼저 사람 말로 말한다 — 거기서
        // 걸리면 사람에게는 「알 수 없는 오류」로만 보인다.
        fail("VALIDATION_ERROR", "반려 시에는 사유를 입력해야 합니다.");
      }

      const decided = await tx
        .update(repairCaseApprovals)
        .set({
          status: input.decision,
          decidedByUserId: actor.id,
          decidedAt: new Date(),
          decisionReason: input.decisionReason,
          // 🔴 **누가 눌렀는가**와 **누구 자리였는가**가 둘 다 남는다(2026-10-20
          // 사용자 결정). 대리인 이름으로 누른 사람 칸을 덮으면 「본인이 눌렀다」와
          // 구분이 사라지고, 거꾸로 맡긴 사람 이름만 남기면 실제로 손을 댄 사람을
          // 영영 못 찾는다.
          delegatedFromUserId,
          updatedAt: new Date(),
        })
        .where(
          and(eq(repairCaseApprovals.id, latest.id), eq(repairCaseApprovals.status, "REQUESTED"))
        )
        .returning({ id: repairCaseApprovals.id });
      if (decided.length === 0) {
        fail("CONFLICT", "이미 처리된 결재입니다. 최신 정보를 다시 불러와 주세요.");
      }

      if (input.decision === "REJECTED") {
        // 사슬이 끊긴다 — 다음 행을 만들지 않는다. 다시 받으려면 새 요청을 올린다
        // (그때 1단계부터 다시 시작한다).
        return { ok: true, id: latest.id, nextApprovalId: null };
      }

      // 🔴 사슬을 잇는다 — 반드시 위의 UPDATE **뒤**다. 앞 행이 아직 REQUESTED 인
      // 채로 INSERT 하면 repair_case_approvals_one_active_domestic_request(부분
      // 유니크)에 걸린다. 그 인덱스가 곧 「한 번에 한 단계」의 보증이므로 우회하지
      // 않고 순서로 푼다.
      let nextApprovalId: string | null = null;
      if (latest.routeId !== null && latest.routeStepOrder !== null) {
        // 「현재 판」이 아니라 **이 행에 적힌 판**으로 다음 단계를 찾는다 — 진행 중인
        // 건은 관리자가 절차를 바꿔도 옛 판을 끝까지 따라간다.
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
            .insert(repairCaseApprovals)
            .values({
              domesticOrderId: order.id,
              // 🔴 회차도 물려받는다 — 사슬은 **그 회차의** 사슬이다. 여기서 빠뜨리면
              // 표의 CHECK 이 거절하므로 조용히 어긋날 자리는 없지만, 다른 번호를
              // 적으면 2단계부터 남의 회차로 넘어간다.
              dueDateRowOrder: input.dueDateRowOrder,
              approvalType: DOMESTIC_ORDER_APPROVAL_TYPE,
              status: "REQUESTED",
              // 요청은 여전히 그 사람이 한 것이다 — 사슬이 나아갈 뿐이라 요청자·사유를
              // 물려받는다.
              requestedByUserId: latest.requestedByUserId,
              requestReason: latest.requestReason,
              assignedApproverUserId: nextStep.approverUserId,
              routeId: latest.routeId,
              routeStepOrder: nextStep.stepOrder,
              // 🔴 판 번호도 물려받는다. 단계마다 새로 찍으면 내자 줄이 중간에
              // 바뀌었을 때 1단계는 무효인데 3단계만 멀쩡해 보인다 — 줄이 바뀌면
              // 결재선 **전체**가 무효여야 한다.
              repairCaseVersionAtRequest: latest.repairCaseVersionAtRequest,
              // 🔴 requested_at 은 물려받지 않는다(표 기본값 now()). 앞 행과 같은
              // 시각이 되면 「가장 최근 행」을 고르는 조회가 어느 행을 고를지 정해지지
              // 않는다.
              // 🔴 delegatedFromUserId 도 싣지 않는다(기본값 NULL) — 이 칸은 **결재할
              // 때** 채워지는 것이지 요청을 열 때 정해지는 값이 아니다.
            })
            .returning({ id: repairCaseApprovals.id });
          nextApprovalId = next.id;
        }
      }

      // 다음 단계가 없으면 거기서 끝이다 — 마지막 단계였거나, 남은 단계가 전부
      // 요청자 본인이었다. 둘 다 정상이고, 그때 가장 최근 행이 APPROVED 로 남아
      // 조회가 「승인 완료」라고 답한다(queries/domestic-order-approvals.ts).
      //
      // 🔴 **여기서 워크플로 단계를 옮기지 않는다.** 접수 건 쪽은 이 자리에서
      // autoAdvanceToShipmentWaitingInTx 를 부르는데, 기타건에는 옮길 단계 자체가
      // 없다(파일 머리말). 빠뜨린 것이 아니라 정해진 것이다.
      return { ok: true, id: latest.id, nextApprovalId };
    });
  } catch (err) {
    if (err instanceof DomesticOrderApprovalMutationError) return err.result;
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
