import "server-only";

import { and, asc, desc, eq, isNull, ne, sql } from "drizzle-orm";
import { db } from "../client";
import {
  customers,
  domesticOrderDueDates,
  domesticOrders,
  repairCaseApprovals,
  repairCases,
  users,
} from "../schema";
import { hasPermission, type PermissionActor } from "@/lib/auth/permission-resolver";
import {
  DOMESTIC_ORDER_APPROVAL_ROUTE_SCOPE,
  foldDomesticOrderApprovalStates,
  isDomesticOrderApprovalRouteInForce,
  resolveMiscCaseCompletionGate,
} from "@/lib/domain/domestic-order-approval-rules";
import {
  domesticOrderDueDateUnits,
  type DomesticOrderDueDateUnit,
} from "@/lib/domain/domestic-order-due-date-label";
import {
  resolveApprovalState,
  type ShipmentApprovalState,
} from "@/lib/domain/local/workflow/shipment-approval-checklist";
import {
  resolveRepairCaseDueDateWriteThrough,
  type RequestedDueDateLinkOutcome,
} from "@/lib/domain/requested-due-date-link";
import {
  resolveDueDateRowCompletionDeliveredPlan,
  resolveRepairCaseShipmentWriteThrough,
  type DeliveredDateLinkOutcome,
} from "@/lib/domain/delivered-date-link";
import { toKstDateOnly } from "@/lib/domain/date-only";
import { foldBlankToNull } from "@/lib/domain/domestic-order-list";
import { checkDomesticOrderDueDateRows } from "@/lib/domain/domestic-order-due-date-rows";
import { getCurrentShipmentApprovalRouteChain } from "../queries/shipment-approval-routes";
import { applyPoIssuedRepairWaitingInTx } from "./po-issued-repair-waiting";
import type { DomesticOrderFields } from "@/lib/validation/domestic-order-input";

/**
 * ============================================================================
 * 내자 정리 — 행 추가·수정 (2단계)
 * ============================================================================
 * 이 계층은 대체로 **기계**다. 「이 화면에 들어올 수 있는가 · 저장 단추를 누를 수
 * 있는가」는 여기서 묻지 않는다 — 세션·역할·설정은 서버 액션
 * (server/actions/domestic-orders.ts)이 보고, 이 파일은 자료의 규칙을 지킨다
 * (존재하는가 · 지워졌는가 · 그 사이 누가 고쳤는가). 이 저장소가 queries/mutations 를
 * mechanism, Server Actions/pages 를 policy 로 나눠 온 방식 그대로이고, 통합 테스트가
 * 인가를 흉내 내지 않고도 자료 규칙을 그대로 검증할 수 있는 이유이기도 하다.
 *
 * ── 🔴 **예외 하나 — 완료된 줄** (2026-11-19) ───────────────────────────
 * 「완료 시 수정」 권한만은 **이 파일이 트랜잭션 안에서 직접 묻는다**
 * (canEditCompletedDomesticOrder). 까닭은 그 판정이 **줄의 지금 상태**(completed_at)에
 * 달려 있기 때문이다 — 액션에 걸면 줄을 한 번 더 읽어 **같은 판정을 두 곳에서** 하게
 * 되고, 그 사이에 남이 완료를 누르면 두 답이 갈린다. 게다가 완료를 누르는 자리는
 * 화면 둘 · 서버 액션 하나 · PO 가 부르는 통로 하나인데 **그 넷이 전부 이 파일로
 * 모인다**(아래 setDomesticOrderCompletion 머리말의 같은 문단). 승인 관문을 여기 둔
 * 것과 똑같은 판단이다.
 * 🔵 **완료되지 않은 줄에서는 한 글자도 달라지지 않는다** — 관문이 그 조건 안에만 선다.
 *
 * ── 동시 수정은 version 으로 막는다 ─────────────────────────────────────
 * 가장 가까운 선례는 mutations/customers.ts 지만, **그쪽은 updated_at 문자열을
 * 대조한다** — customers 표에 version 컬럼이 없어서 어쩔 수 없이 고른 방식이다.
 * domestic_orders 에는 version integer 가 처음부터 있으므로(1단계가 이번을 위해
 * 미리 넣어 두었다) repair_cases 와 같은 정수 대조를 쓴다. 타임스탬프 대조는
 * 같은 밀리초 안에 두 번 저장되면 어긋남을 놓칠 수 있지만, 정수는 그 틈이 없다.
 *
 * 순서는 repair_cases 의 되돌리기 어려운 조작들과 같다:
 *  1. 트랜잭션을 열고 대상 행을 `.for("update")` 로 잠근다.
 *  2. 없거나 이미 지워진 행이면 NOT_FOUND.
 *  3. version 이 어긋나면 CONFLICT — 화면은 폼을 얼리고 다시 불러오게 한다.
 *  4. 값과 함께 version + 1, updated_at, updated_by 를 쓴다.
 *
 * 잠금을 먼저 잡는 이유: 읽고 나서 쓰기까지 사이에 남이 끼어들면 "둘 다
 * 성공했는데 한쪽 내용이 사라진" 상태가 만들어진다. 이 표에는 세금계산서
 * 발행일과 입금 사실이 들어 있어서 조용히 덮이면 안 되는 종류의 값이다.
 *
 * ── 납기 요청일은 딸린 표에 있다 ────────────────────────────────────────
 * 한 줄에 날짜가 여럿일 수 있어서 domestic_order_due_dates 로 나갔다
 * (그 스키마 파일 헤더). 저장은 **그 줄의 날짜를 전부 지우고 받은 목록으로
 * 다시 넣는 것**이고(replaceDueDates), 그 일은 위 4단계에서 **version 대조를
 * 통과한 뒤에만** 일어난다 — 같은 트랜잭션 안이므로 CONFLICT 로 끝난 저장은
 * 날짜를 한 건도 건드리지 않는다.
 *
 * domestic_orders.requested_due_date 는 **이제 쓰지 않는다.** 칸은 아직
 * 남아 있지만 toColumnValues 에 없다 — 그 이유는 그 자리의 주석에 있다.
 *
 * ── 🔴 납기 요청일을 고치면 **수리 건의 고객 요청 납기일도 바뀐다** (2026-10-30)
 * 사용자 결정이다 — 「어느 쪽에서 수정하든 같은 날짜를 보고 있을 수 있도록」.
 * 이 파일이 고치는 표가 하나 늘었다는 뜻이라, 아래 applyRepairCaseDueDateLink 의
 * 머리말을 함께 읽어야 한다. 묶지 않는 자리와 그 까닭은 전부
 * domain/requested-due-date-link.ts 머리말에 있고, **판정은 그 파일 하나가**
 * 가진다(거울 방향인 mutations/repair-cases.ts 도 같은 파일을 부른다).
 *
 * ── 🔴 납품일·납품자도 **그 딸린 표에 있다** (2026-11-08) ─────────────────
 * 사용자 결정 1(「납기요청일 1번 줄 ↔ 납품일 1번 줄, 행이 묶인다」)로 납품 둘이
 * domestic_order_due_dates 의 칼럼이 되었다. 그래서 이 파일이 하는 일이 둘 늘었다:
 *
 *  · **울타리 둘**(사용자 결정 5 · 9) — 납품 기록이 달린 행을 지우는 저장과, 수리
 *    건이 붙은 줄의 납기요청일을 둘 이상으로 늘리는 저장을 거절한다. 판정은
 *    domain/domestic-order-due-date-rows.ts 하나가 갖고, 여기서는 **저장돼 있던
 *    모양과 보내온 모양**을 그 판정에 넘긴다(checkDueDateRowGuard).
 *  · **묶기 하나 더** — 납품일을 고치면 수리 건의 실제 출하일도 같은 날짜가 된다
 *    (applyRepairCaseShipmentLink). 바로 위 납기요청일 묶기와 **같은 잠금 차례**다.
 *
 * 🔴 **옛 칼럼 `domestic_orders.delivered_date`·`delivered_by` 는 toColumnValues 에
 * 그대로 있다.** `requested_due_date` 때와 다른 점인데, 까닭이 있다: 그 칸을 PO
 * 시스템(dss-po)이 같은 DB 에서 쓰고 있어(사용자 결정 11) **A/S 가 안 쓴다고 비워도
 * 되는 값이 아니다.** 저장이 하는 일은 읽어 온 값을 한 글자도 안 바꾸고 되돌려
 * 놓는 것뿐이고, A/S 화면은 그 칸을 그리지도 고치지도 않는다.
 *
 * ── 지워진 행은 고칠 수 없다 ────────────────────────────────────────────
 * is_deleted = true 인 행은 조회 목록에 없다(queries/domestic-orders.ts).
 * 화면에 없는 행을 고치려는 요청은 "찾을 수 없다"가 정확한 답이다 — 휴지통에서
 * 되살리는 일은 별도 조작이고, 수정이 그 일을 겸하면 지운 기록이 조용히
 * 되살아난다.
 *
 * ── 🔴 **PO발행일을 적으면 수리 건의 단계가 [수리 대기]로** (2026-11-26) ───
 * 사용자 요구다 — 「PO발행일이 기록되면 현재 작업 상태를 자동으로 [수리 대기]로
 * 바꿔 줘」. 이 파일이 고치는 표가 **또 하나 늘었다**(repair_cases 의 단계). 바로 위
 * 묶기 둘과 **같은 모양·같은 잠금 차례**이고, 판정도 쓰기도 전부
 * mutations/po-issued-repair-waiting.ts 한 곳에 있다.
 *
 * 🔴 **연결을 갈아 끼운 저장은 여기서도 건드리지 않는다** — 위 두 묶기와 똑같은
 * 까닭이다(사람이 고른 적 없는 사실이 새 수리 건에 번지고, 옛 건에서는 아무 일도
 * 안 일어나 둘이 동시에 어긋난다).
 *
 * 🔵 **PO 시스템(dss-po)에서 적으면 안 걸린다** — 그 저장소에도 같은 칸을 쓰는
 * 저장이 있지만 이 훅이 닿지 않는다. 2026-11-26 에 「A/S에서 적을 때만」으로
 * 정했다. 결함이 아니다(그 파일 머리말).
 *
 * ── PII ─────────────────────────────────────────────────────────────────
 * progress_note · history_note · etc_note · delivered_by 는 사람이 자유롭게
 * 적는 값이라 담당자 이름이 섞일 수 있다(schema 헤더). 이 파일은 실패해도 그
 * 값들을 오류 메시지에 담지 않는다.
 * ============================================================================
 */

/** 트랜잭션 핸들. 아래 도우미들이 같은 트랜잭션 안에서 읽도록 못 박는다. */
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type DomesticOrderMutationResultCode = "NOT_FOUND" | "CONFLICT" | "VALIDATION_ERROR";

/**
 * 🔴 **완료된 줄을 건드리려 했는데 「완료 시 수정」이 없다**(2026-11-19 사용자 요청).
 *
 * 🔴 **행 추가(createDomesticOrder)에는 없다** — 막 태어난 줄은 완료일 수 없다. 그래서
 * 위 묶음에 끼워 넣지 않고 수정·완료 쪽에만 잇는다(바로 아래 APPROVAL_REQUIRED 와
 * 같은 판단이다). 끼워 넣으면 「행을 추가했는데 권한이 없다고 거절당했다」가 타입상
 * 말이 되어 버리고, 그 가능성을 부르는 쪽들이 저마다 가려내야 한다.
 */
export type DomesticOrderUpdateMutationResultCode = DomesticOrderMutationResultCode | "FORBIDDEN";

/**
 * 완료 처리에만 있는 거절. 🔴 **추가에는 없다** — 그래서 맨 위 묶음에 끼워 넣지
 * 않고 따로 잇는다. 끼워 넣으면 「행을 추가했는데 승인이 없다고 거절당했다」가
 * 타입상 말이 되어 버리고, 그 가능성을 부르는 쪽들이 저마다 가려내야 한다.
 *
 * 🔵 `FORBIDDEN` 은 바로 위 수정 쪽 묶음에서 따라온다 — **완료 해제도 「완료된 줄을
 * 건드리는 일」**이라 같은 열쇠가 선다(2026-11-19).
 */
export type DomesticOrderCompletionMutationResultCode =
  | DomesticOrderUpdateMutationResultCode
  /**
   * 🔴 **기타건(수리 건이 붙지 않은 줄)인데 [기타건 최종 출하 승인]이 유효하지 않다**
   * (2026-11-07 사용자 결정). `message` 가 어느 상태라서 막혔는지까지 말한다 —
   * 가르는 것은 **코드**이고(글자를 견주지 않는다), 보여 주는 것은 message 다.
   */
  | "APPROVAL_REQUIRED";

export type DomesticOrderCompletionMutationResult =
  | { ok: true; id: string; version: number }
  | { ok: false; code: DomesticOrderCompletionMutationResultCode; message: string };

export type DomesticOrderMutationResult =
  | {
      ok: true;
      id: string;
      version: number;
      /**
       * 🔴 이번 저장이 **수리 건의 고객 요청 납기일까지 맞췄는가**(2026-10-30).
       * 없으면 맞출 일이 없었다는 뜻이다(날짜가 안 바뀌었거나, 수리 건 쪽이 비어
       * 있어 이 줄의 날짜를 빌려 그리는 중이라 보이는 날짜가 이미 같다).
       *
       * `linked: false` 는 **이 줄은 저장됐는데 수리 건이 안 따라갔다**는 뜻이다.
       * 화면은 그 까닭을 읽어야 닫히는 알림으로 띄운다
       * (domain/requested-due-date-link.ts 머리말 ④).
       */
      requestedDueDateLink?: RequestedDueDateLinkOutcome;
      /**
       * 🔴 이번 저장이 **수리 건의 실제 출하일까지 맞췄는가**(2026-11-08). 없으면
       * 맞출 일이 없었다는 뜻이다(납품일이 안 바뀌었거나, 행에 아무것도 없어 이
       * 줄이 그 건의 출하일을 빌려 그리는 중이라 보이는 날짜가 이미 같다).
       *
       * 🔴 **바로 위 짝과 함께 올 수 있다** — 한 저장이 납기요청일과 납품일을 함께
       * 고칠 수 있기 때문이다. 화면은 둘을 **모아서** 띄운다(하나만 보면 나머지
       * 하나가 조용히 사라진다 — domain/delivered-date-link.ts 머리말).
       */
      deliveredDateLink?: DeliveredDateLinkOutcome;
    }
  | {
      ok: false;
      code: DomesticOrderMutationResultCode;
      fieldErrors?: Record<string, string>;
      message: string;
    };

/**
 * 🔴 **수정 전용 결과**(2026-11-19). 성공 모양은 위와 **글자 그대로 같고**(그래서
 * 베껴 적지 않고 `Extract` 로 그 가지를 그대로 가져온다 — 칸이 하나 늘 때 한쪽만
 * 고쳐지는 날을 만들지 않는다), 거절 코드에만 `FORBIDDEN` 이 하나 더 있다.
 */
export type DomesticOrderUpdateMutationResult =
  | Extract<DomesticOrderMutationResult, { ok: true }>
  | {
      ok: false;
      code: DomesticOrderUpdateMutationResultCode;
      fieldErrors?: Record<string, string>;
      message: string;
    };

/**
 * 충돌했을 때 사람에게 보이는 말.
 *
 * `export` 인 이유는 **같은 표를 고치는 다른 경로가 같은 문장을 써야 하기**
 * 때문이다(mutations/domestic-order-issue-dates.ts — 수리 건 상세에서 두 날짜만
 * 고치는 길). 한 글자라도 다르게 적으면 같은 일이 화면마다 다른 말로 설명된다.
 * 🔵 같은 까닭으로 아래 「완료 시 수정」 관문의 문장과 판정 함수도 내보낸다.
 */
export const VERSION_CONFLICT_MESSAGE =
  "다른 사용자가 이 항목을 먼저 수정했습니다. 최신 정보를 다시 불러온 뒤 시도해 주세요.";

const NOT_FOUND_MESSAGE = "해당 내자 정리 항목을 찾을 수 없습니다.";

const UNKNOWN_REFERENCE_MESSAGE = "입력값을 확인해 주세요.";

/**
 * 완료된 줄을 건드리려다 막혔을 때 사람에게 보이는 말(2026-11-19).
 *
 * `export` 인 까닭은 위 VERSION_CONFLICT_MESSAGE 와 같다 — 수리 건 상세에서 발행일
 * 둘만 고치는 길도 **같은 관문에 같은 문장**을 써야 한다
 * (mutations/domestic-order-issue-dates.ts).
 *
 * 🔴 **다음에 할 일을 말한다.** 「권한이 없습니다」만 적으면 사람은 무엇을 받아야
 * 하는지 모른 채 같은 단추를 계속 누른다 — 권한 화면의 칸 이름을 그대로 적는다.
 */
export const COMPLETED_DOMESTIC_ORDER_EDIT_FORBIDDEN_MESSAGE =
  "완료 처리된 항목입니다. 「완료 시 수정」 권한이 있어야 고치거나 완료를 해제할 수 있습니다.";

/**
 * 트랜잭션 안에서 계정을 다시 읽었는데 없거나 승인 상태가 아니다.
 *
 * `export` 인 까닭은 위 둘과 같다 — **같은 관문을 한 겹 앞에서 또 세우는 자리**가
 * 같은 문장을 써야 한다(server/services/release-domestic-order.ts 의 0단계).
 */
export const DOMESTIC_ORDER_ACTOR_UNKNOWN_MESSAGE = "사용자 정보를 확인할 수 없습니다.";

/**
 * 🔴 **완료된 줄을 건드릴 수 있는가** — 잎 **둘을 AND 로** 묻는다(2026-11-19).
 *
 * 🔴 **AND 인 까닭.** 두 잎은 `role_permissions` 에 따로 저장되므로 「내자 정리 수정은
 * 접근 불가인데 완료 시 수정은 쓰기」라는 앞뒤 안 맞는 조합을 관리자가 만들 수 있다.
 * 둘 다 있어야 통과하게 두면 그 조합은 **아무 힘도 못 갖는다** — 수정 자체가 막히므로
 * 완료된 줄도 당연히 못 고친다. 거꾸로(OR 로) 두면 그 조합이 **수정을 닫아 둔 사람에게
 * 완료된 줄만 열어 주는** 이상한 문이 된다.
 *
 * 🔵 `edit` 을 여기서 또 묻는 것이 네 통로의 바깥 관문과 겹쳐 보이지만, 겹치는 것이
 * 목적이다 — 바깥 관문이 어느 날 한 곳만 바뀌어도 이 AND 는 깨지지 않는다.
 *
 * 🔴 **판정을 여기 한 곳에만 적는다.** 저장 경로 넷이 전부 이 함수를 부른다(이 파일의
 * 셋 · mutations/domestic-order-issue-dates.ts 의 하나). 글자를 나눠 적으면 그중
 * 하나만 고쳐지는 날이 오고, 그때 증상은 「목록에서는 막히는데 수리 건 상세에서는
 * 되는」 뒷문이다.
 */
export async function canEditCompletedDomesticOrder(actor: PermissionActor): Promise<boolean> {
  return (
    (await hasPermission(actor, "domesticOrders.edit", "WRITE")) &&
    (await hasPermission(actor, "domesticOrders.completedEdit", "WRITE"))
  );
}

/**
 * 위 판정을 **트랜잭션 안에서** 세우고, 막혔으면 거절을 통과면 `null` 을 돌려준다.
 *
 * 🔴 **계정을 트랜잭션 안에서 다시 읽는다.** 세션을 읽은 뒤 강등·정지된 계정이 그
 * 사이에 저장하는 구멍을 막는다 — mutations/domestic-order-issue-dates.ts 가 쓰는
 * 그 모양 그대로다(소프트 삭제된 계정도 거른다).
 */
async function checkCompletedDomesticOrderEdit(
  tx: Tx,
  actorUserId: string
): Promise<{ ok: false; code: "FORBIDDEN"; message: string } | null> {
  const [actor] = await tx
    .select({
      id: users.id,
      role: users.role,
      approvalStatus: users.approvalStatus,
      isDeveloper: users.isDeveloper,
    })
    .from(users)
    .where(and(eq(users.id, actorUserId), eq(users.isDeleted, false)));
  if (!actor || actor.approvalStatus !== "APPROVED") {
    return { ok: false, code: "FORBIDDEN", message: DOMESTIC_ORDER_ACTOR_UNKNOWN_MESSAGE };
  }
  if (await canEditCompletedDomesticOrder(actor)) return null;
  return {
    ok: false,
    code: "FORBIDDEN",
    message: COMPLETED_DOMESTIC_ORDER_EDIT_FORBIDDEN_MESSAGE,
  };
}

/**
 * domestic_orders 에 실제로 쓰는 컬럼 묶음. 추가와 수정이 **같은 표**를 쓰도록
 * 한 함수로 뽑아 둔다 — 두 곳에 나눠 적으면 칸이 하나 늘어날 때 한쪽만 고쳐지고,
 * 그때 생기는 증상은 "추가하면 들어가는데 수정하면 안 들어가는 칸"이다.
 *
 * customer_id 와 형식·L/N·S/N·고장내역도 여기 있다. 폼이 그 다섯을 직접 받기
 * 시작했고(schema/domestic-orders.ts 의 '여기에도 있다'), 빈 값은 null 로
 * 들어와 "연결된 수리 건의 값을 따른다"는 뜻이 된다 — 그러니 이 표에 빠지면
 * 사용자가 고객사를 골라도 저장되지 않는 칸이 된다.
 */
function toColumnValues(fields: DomesticOrderFields) {
  return {
    repairCaseId: fields.repairCaseId,
    intakeNumberText: fields.intakeNumberText,
    customerId: fields.customerId,
    modelNameText: fields.modelNameText,
    lotNumberText: fields.lotNumberText,
    serialNumberText: fields.serialNumberText,
    faultDescriptionText: fields.faultDescriptionText,
    displayOrder: fields.displayOrder,
    purchaseOrderNumber: fields.purchaseOrderNumber,
    projectName: fields.projectName,
    orderIssuedDate: fields.orderIssuedDate,
    // requested_due_date 는 **일부러 여기 없다.** 납기 요청일은 이제
    // domestic_order_due_dates 에 산다(아래 replaceDueDates). 그 칸을 여기 두면
    // 새 폼이 보내지 않는 값이 저장할 때마다 NULL 로 덮여, 아직 남겨 둔 원본이
    // 지워진다 — 칸을 남겨 두기로 한 이유가 바로 그 원본이다
    // (schema/domestic-orders.ts 의 requested_due_date 주석).
    quoteIssuedDate: fields.quoteIssuedDate,
    quoteNumber: fields.quoteNumber,
    // 연결된 견적서. 여기 빠지면 사용자가 골라도 저장되지 않는 칸이 된다.
    quoteId: fields.quoteId,
    progressNote: fields.progressNote,
    deliveredDate: fields.deliveredDate,
    deliveredBy: fields.deliveredBy,
    taxInvoiceDate: fields.taxInvoiceDate,
    amountExcludingVat: fields.amountExcludingVat,
    paymentCompleted: fields.paymentCompleted,
    japanRemittanceNote: fields.japanRemittanceNote,
    historyNote: fields.historyNote,
    etcNote: fields.etcNote,
  };
}

/**
 * 고르려는 수리 건이 실제로 있는가. 없으면 FK 위반(23503)이 나는데, 그 오류는
 * 사용자에게 아무것도 설명하지 못한다 — 어느 칸이 문제인지 말해 주는 편이 낫다.
 *
 * **is_deleted 를 보지 않는 것은 일부러다.** 휴지통에 있는 수리 건이라도 그
 * 건에 대한 정산 기록은 남아야 하고(schema 의 'ON DELETE SET NULL' 항목),
 * 조회 목록도 그런 줄을 그대로 보여 준다. 여기서 막으면 화면에 보이는 연결을
 * 저장할 수 없는 상태가 만들어진다.
 */
async function repairCaseExists(tx: Tx, repairCaseId: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: repairCases.id })
    .from(repairCases)
    .where(eq(repairCases.id, repairCaseId))
    .limit(1);
  return Boolean(row);
}

/**
 * 고르려는 고객사가 실제로 있는가. 수리 건과 같은 이유로 미리 본다 —
 * customer_id 는 customers 를 RESTRICT 로 가리키므로 없는 id 를 넣으면 23503 이
 * 나고, 그 오류는 사용자에게 아무것도 설명하지 못한다.
 *
 * 여기서도 is_deleted 를 보지 않는다. 휴지통에 있는 고객사가 이미 적혀 있는
 * 줄은 목록에 그대로 보이는데, 그 줄의 다른 칸을 고치려 할 때 고객사 때문에
 * 저장이 막히면 화면에 보이는 값을 저장할 수 없는 상태가 된다. 새로 고르는
 * 목록에서 빼는 일은 조회 쪽이 한다(queries 의 listCustomerOptions).
 */
async function customerExists(tx: Tx, customerId: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: customers.id })
    .from(customers)
    .where(eq(customers.id, customerId))
    .limit(1);
  return Boolean(row);
}

/**
 * 이 행이 가리키는 두 곳(수리 건 · 고객사)이 실제로 있는지 한 번에 본다.
 * 문제가 없으면 null 이다.
 *
 * 추가와 수정이 같은 검사를 쓰게 묶어 둔다 — toColumnValues 를 한 곳에 둔 것과
 * 같은 이유다. 나눠 적으면 "추가할 때는 걸러지는데 수정할 때는 FK 오류가 나는"
 * 차이가 생긴다.
 */
async function checkReferences(
  tx: Tx,
  fields: DomesticOrderFields
): Promise<DomesticOrderMutationResult | null> {
  if (fields.repairCaseId && !(await repairCaseExists(tx, fields.repairCaseId))) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      fieldErrors: { repairCaseId: "선택한 수리 건을 찾을 수 없습니다." },
      message: UNKNOWN_REFERENCE_MESSAGE,
    };
  }
  if (fields.customerId && !(await customerExists(tx, fields.customerId))) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      fieldErrors: { customerId: "선택한 고객사를 찾을 수 없습니다." },
      message: UNKNOWN_REFERENCE_MESSAGE,
    };
  }
  return null;
}

/**
 * 이 줄의 납기 요청일을 **받은 목록 그대로** 만든다 — 전부 지우고 다시 넣는다.
 *
 * ── 왜 지우고 다시 넣는가 ───────────────────────────────────────────────
 * 폼은 목록을 통째로 편집한다(줄을 더하고, 빼고, 순서대로 늘어놓는다). 그러니
 * 저장이 받는 것은 "이 줄의 납기일은 지금부터 이것이 전부"라는 말이고, 그
 * 말을 그대로 옮기는 방법이 이것이다. 하나씩 대조해 넣고 빼는 방식은 같은
 * 결과를 훨씬 어렵게 만들 뿐이고, 그 어려움은 "폼에서 지웠는데 남아 있는 날짜"
 * 같은 모양으로 드러난다.
 *
 * ⚠️ **반드시 domestic_order_id 로 좁힌다.** 조건 없는 delete 는 이 표를
 * 통째로 비운다 — 이 줄의 날짜를 고치는 일이 다른 모든 줄의 날짜를 지우는
 * 일이 되어서는 안 된다.
 *
 * ⚠️ **반드시 부르는 쪽의 트랜잭션 안에서만** 부른다(tx 를 받는 이유). 부모
 * 저장이 CONFLICT 로 끝나는 길에서는 아예 불리지 않아야 하고, 그 순서는 부르는
 * 쪽이 지킨다.
 *
 * 차례(display_order)는 배열 index + 1 이다. 폼에 늘어놓은 순서가 곧 차례라서
 * (validation 의 DomesticOrderDueDateInput 주석), 조회가 그 차례로 다시 읽으면
 * 사람이 보던 순서가 그대로 돌아온다.
 */
async function replaceDueDates(
  tx: Tx,
  domesticOrderId: string,
  fields: DomesticOrderFields,
  /**
   * 🔴 **지우기 전에 읽어 둔 행들** — 차례대로다(readDueDateRows). 회차별 완료 표시를
   * 되얹는 재료다(아래 '완료 표시를 되얹는다'). 새로 만드는 줄이면 빈 목록이다.
   */
  storedRows: readonly StoredDueDateRow[]
) {
  await tx
    .delete(domesticOrderDueDates)
    .where(eq(domesticOrderDueDates.domesticOrderId, domesticOrderId));

  if (fields.dueDates.length === 0) return;

  await tx.insert(domesticOrderDueDates).values(
    fields.dueDates.map((dueDate, index) => ({
      domesticOrderId,
      dueDate: dueDate.dueDate,
      note: dueDate.note,
      // 🔴 납품 둘도 이 목록이 정한다(2026-11-08). **보내온 목록이 전부**이므로,
      // 부르는 쪽이 이 값을 안 실어 보내면 그 줄의 납품 기록이 함께 사라진다 —
      // 그것을 막는 울타리가 아래 checkDomesticOrderDueDateRows 이고, 보내는
      // 모양을 정하는 자리는 domain/domestic-order-cell-edit.ts 하나다.
      deliveredDate: dueDate.deliveredDate,
      deliveredBy: dueDate.deliveredBy,
      // ── 🔴 **완료 표시를 되얹는다** (2026-11-08) ─────────────────────────
      // 회차별 완료(사용자 결정 7)는 **보내온 목록에 없는 값**이다. 넣게 두면 줄
      // 수정 payload 하나로 승인 없이 완료를 찍을 수 있어서, 폼이 보내는 네 칸에
      // 일부러 넣지 않았다(validation 의 DomesticOrderDueDateInput).
      //
      // 그래서 서버가 제 손으로 다시 적는다 — **같은 차례의 옛 행**에서 가져온다.
      // 🔴 자리로 가져오는 것이 엉뚱한 회차로 밀릴 자리는 울타리가 막는다: 완료된
      // 회차가 있으면 줄 수를 줄이는 저장이 통째로 거절된다
      // (domain/domestic-order-due-date-rows.ts 의 셋째 울타리). 그래서 여기 오는
      // 목록은 **옛 목록보다 짧지 않고**, index 가 그대로 회차 번호를 가리킨다.
      // 🔵 뒤에 새로 더한 회차는 옛 행이 없으므로 `?? null` 로 비워진다 — 새 회차가
      //    완료로 태어나는 길은 없다.
      completedAt: storedRows[index]?.completedAt ?? null,
      completedBy: storedRows[index]?.completedBy ?? null,
      // ── 🔴 **확정 표시도 똑같이 되얹는다** (2026-11-25) ───────────────────
      // 회차별 [납기일 확정]도 **보내온 목록에 없는 값**이라(위 완료 둘과 같은 까닭)
      // 서버가 제 손으로 같은 자리에 다시 적는다. 안 되얹으면 사람이 그 줄의 비고나
      // 납품일을 고친 순간 확정이 **조용히 풀리고**, 오류도 로그도 남지 않는다.
      //
      // 🔴 **날짜를 견주지 않는다 — 완료와 한 글자도 다르지 않다.** 「확정된 회차의
      // 날짜가 바뀌면 어쩌나」는 여기서 풀 문제가 아니다: 그런 저장은 **울타리가
      // 통째로 거절한다**(domain/domestic-order-due-date-rows.ts 의 넷째 울타리 —
      // 사용자 결정 2026-11-25 「[확정 해제]를 해야만 날짜를 고칠 수 있도록」).
      // 여기서 또 재면 같은 규칙이 두 벌이 되고, 한쪽만 고쳐지는 날 둘이 어긋난다.
      // 🔵 그래서 이 자리에 오는 목록은 **확정된 자리의 날짜가 그대로인** 목록이다.
      confirmedAt: storedRows[index]?.confirmedAt ?? null,
      confirmedBy: storedRows[index]?.confirmedBy ?? null,
      displayOrder: index + 1,
    }))
  );
}

/**
 * 그 줄에 **지금 적혀 있는** 납기요청일 행들 — 날짜와 납품 둘. 비고도 차례도 읽지
 * 않는다(묶기 판정이 보는 것은 날짜뿐이다 — domain/requested-due-date-link.ts 의
 * '차례와 비고는 보지 않는다').
 *
 * 🔴 **replaceDueDates 보다 먼저** 불러야 한다. 그 뒤에 부르면 방금 쓴 값이 나와
 * 「안 바뀌었다」가 되고, 묶기가 영영 일어나지 않는다. 울타리(결정 5)도 같은
 * 까닭으로 이 값을 먼저 쥐고 있어야 한다 — 지운 뒤에는 무엇이 있었는지 알 길이
 * 없다.
 */
type StoredDueDateRow = {
  dueDate: string;
  note: string | null;
  deliveredDate: string | null;
  deliveredBy: string | null;
  /**
   * 🔴 그 회차의 완료 시각(2026-11-08). 셋을 함께 읽는 까닭이 셋이다 — 울타리가
   * 「완료된 회차가 있는가」를 보고, replaceDueDates 가 그 값을 되얹고, 완료 관문이
   * 「어느 회차가 아직인가」를 센다.
   */
  completedAt: Date | null;
  completedBy: string | null;
  /**
   * 🔴 그 회차의 **납기일 확정 시각**(2026-11-25). 완료 둘과 **같은 까닭으로** 함께
   * 읽는다 — 울타리가 「확정된 회차가 있는가 · 그 자리의 날짜가 바뀌었는가」를 보고,
   * replaceDueDates 가 그 값을 되얹는다.
   */
  confirmedAt: Date | null;
  confirmedBy: string | null;
};

/**
 * 🔴 **차례대로 읽는다**(display_order → due_date). 조회가 화면에 내려보내는 차례와
 * **같아야 한다**(queries/domestic-orders.ts 의 loadDueDates) — 갈리면 사람이 「2차」로
 * 본 회차와 서버가 2번으로 센 회차가 달라진다. 그 번호가 곧 승인이 가리키는 값이다.
 */
async function readDueDateRows(tx: Tx, domesticOrderId: string): Promise<StoredDueDateRow[]> {
  return tx
    .select({
      dueDate: domesticOrderDueDates.dueDate,
      note: domesticOrderDueDates.note,
      deliveredDate: domesticOrderDueDates.deliveredDate,
      deliveredBy: domesticOrderDueDates.deliveredBy,
      completedAt: domesticOrderDueDates.completedAt,
      completedBy: domesticOrderDueDates.completedBy,
      confirmedAt: domesticOrderDueDates.confirmedAt,
      confirmedBy: domesticOrderDueDates.confirmedBy,
    })
    .from(domesticOrderDueDates)
    .where(eq(domesticOrderDueDates.domesticOrderId, domesticOrderId))
    .orderBy(asc(domesticOrderDueDates.displayOrder), asc(domesticOrderDueDates.dueDate));
}

/** 그 행에 **납품 기록이 있는가** — 날짜든 사람이든 하나라도 적혀 있으면 참이다. */
function hasDeliveryRecord(row: {
  deliveredDate: string | null;
  deliveredBy: string | null;
}): boolean {
  return row.deliveredDate !== null || row.deliveredBy !== null;
}

/** 그 줄의 납품일만 차례 없이 — 묶기 판정이 보는 값이다(값만, 빈 것은 뺀다). */
function deliveredDatesOf(rows: readonly { deliveredDate: string | null }[]): string[] {
  return rows
    .map((row) => row.deliveredDate)
    .filter((value): value is string => value !== null);
}

/**
 * 🔴 납기요청일 행을 **더하고 지우고 고치는 울타리 넷**(사용자 결정 5 · 9 · 13 의 짝 ·
 * 2026-11-25 의 확정 잠금). 막히면 검증 오류를, 통과면 null 을 돌려준다.
 *
 * 🔴 **판정은 여기 적지 않는다** — domain/domestic-order-due-date-rows.ts 하나가
 * 가진다(화면도 같은 함수로 단추를 미리 막는다). 이 함수가 하는 일은 **저장돼
 * 있던 모양과 보내온 모양을 그 판정에 넘기는 것**뿐이다.
 *
 * 🔴 **replaceDueDates 보다 먼저, 그리고 UPDATE 보다 먼저** 불러야 한다. 거절로
 * 끝나는 저장이 줄의 다른 칸을 이미 바꿔 놓으면 「거절됐는데 반은 저장된」 상태가
 * 남는다.
 */
function checkDueDateRowGuard(params: {
  storedRows: readonly StoredDueDateRow[];
  storedRepairCaseId: string | null;
  fields: DomesticOrderFields;
}): DomesticOrderMutationResult | null {
  const guard = checkDomesticOrderDueDateRows({
    storedRows: params.storedRows.map((row) => ({
      hasDelivery: hasDeliveryRecord(row),
      // 🔴 판정은 completed_at 하나로만 한다(그 표의 칸 주석과 같은 규칙).
      isCompleted: row.completedAt !== null,
      // 🔴 넷째 울타리가 **자리마다 견주는** 두 값(2026-11-25). 날짜는 `date` 칼럼이라
      //    언제나 "YYYY-MM-DD" 문자열로 오고, 확정 판정도 confirmed_at 하나로만 한다.
      dueDate: row.dueDate,
      isConfirmed: row.confirmedAt !== null,
    })),
    // 🔴 **보내온 목록에는 완료 표시도 확정 표시도 없다** — 그래서 둘 다 거짓으로
    //    넘긴다. 셋째·넷째 울타리가 「보내온 쪽」이 아니라 **「저장돼 있던 쪽에 있는가」**
    //    만 보는 것이 그 까닭이다(그 파일의 '완료 표시는 자리로 따라간다').
    // 🔵 **날짜는 보내온 값 그대로** 넘긴다 — 넷째 울타리가 견줄 바로 그 값이다.
    nextRows: params.fields.dueDates.map((row) => ({
      hasDelivery: hasDeliveryRecord(row),
      isCompleted: false,
      dueDate: row.dueDate,
      isConfirmed: false,
    })),
    storedRepairCaseId: params.storedRepairCaseId,
    nextRepairCaseId: params.fields.repairCaseId,
  });
  if (guard.ok) return null;
  return {
    ok: false,
    code: "VALIDATION_ERROR",
    fieldErrors: { [guard.field]: guard.message },
    message: guard.message,
  };
}

/**
 * ============================================================================
 * 🔴 납기요청일을 고치면 **수리 건의 고객 요청 납기일도 함께** (2026-10-30)
 * ============================================================================
 * 거울 방향(수리 건 → 내자)은 mutations/repair-cases.ts 에 있고, **무엇을 할지
 * 정하는 규칙은 두 방향이 같은 파일 하나를 부른다**
 * (domain/requested-due-date-link.ts 의 resolveRepairCaseDueDateWriteThrough).
 * 이 함수가 하는 일은 재료를 읽어 와 넘기고, WRITE 면 그 한 칸을 고치는 것뿐이다.
 *
 * ── 🔴 잠그는 차례 ──────────────────────────────────────────────────────
 * 부르는 쪽이 **이 줄을 이미 쥐고 있다**(고치기는 `FOR UPDATE` 로 잡아 두었고,
 * 만들기는 방금 INSERT 한 줄이라 그 트랜잭션의 것이다). 그다음에 여기서 수리 건을
 * 잠근다 — 거울 방향도 「내자 줄 먼저, 수리 건 나중」이라 차례가 같다. 반대로 적으면
 * 두 사람이 같은 건을 동시에 고칠 때 교착이 난다.
 *
 * 🔵 **같은 건의 다른 줄들은 잠그지 않는다.** 거기서 읽는 것은 「날짜가 몇 개인가」
 * 하나뿐이고, 그 줄들까지 잡으면 서로 다른 줄을 고치는 두 저장이 반대 차례로 잠그게
 * 되어 교착이 생긴다.
 *
 * ── 🔴 수리 건을 **갈아 끼운 저장**은 묶지 않는다 ───────────────────────
 * `줄 수정` 폼은 이 줄이 가리키는 수리 건 자체를 바꿀 수 있다. 그때 이 줄의 날짜를
 * 새 수리 건에 밀어 넣으면, 사람이 고른 적 없는 날짜가 그 건에 적힌다(그리고 옛
 * 건에서는 아무 일도 일어나지 않아 두 건이 동시에 어긋난다). 연결을 바꾼 저장은
 * 날짜를 건드리지 않고, 다음에 날짜를 고칠 때 비로소 묶인다.
 *
 * ── 🔴 「완료 시 수정」과의 관계 (2026-11-19) ───────────────────────────
 * **이 방향은 따로 물을 것이 없다.** 이 함수는 create·update 안에서만 불리고, 그
 * 둘 중 완료된 줄을 건드리는 쪽(updateDomesticOrder)에는 이미 관문이 서 있다 —
 * 즉 완료된 줄의 날짜가 수리 건으로 번지려면 그 관문을 먼저 지나야 한다.
 *
 * 🔴 **거울 방향(수리 건 → 내자)은 다르다. 거기는 권한을 아예 안 묻고, 그대로
 * 두기로 했다.** 수리 건에서 출하를 찍거나 실제 출하일을 고치면 **완료된 내자 줄의
 * 납품일·납기요청일이 권한 검사 없이 덮인다**
 * (mutations/domestic-order-delivered-link.ts · mutations/repair-cases.ts 의
 * requestedDueDateLink). 🔴 **구멍이 아니라 정한 모양이다** — 그것은 「내자 줄을
 * 고치는 일」이 아니라 **수리 건에서 일어난 사실이 번진 것**이고, 그 사실 기록이 내자
 * 권한에 막히면 전이가 반쪽만 성공한 채 끝난다(두 표가 서로 다른 날짜를 들게 된다).
 * 막지 마라. 자세한 까닭은 그 파일 머리말에 있다.
 *
 * ── 🔴 **그 「막지 마라」에 예외가 하나 생겼다** (2026-11-25) ─────────────
 * 🔴 **바로 위 문단을 지우지 마라 — 지금도 그대로 유효하다.** 더해진 것은 **딱 한
 * 가지 경우**이고, 위가 가리키는 「권한 때문에 막지 마라」와는 **다른 까닭**이다:
 *
 *   · 위가 말하는 것은 **권한**이다. 내자 줄을 고칠 권한이 없는 사람이 수리 건에서
 *     출하를 찍었다고 해서 그 사실이 내자에 안 적히면 안 된다 — 그것은 「고치는 일」이
 *     아니라 **일어난 사실이 번진 것**이고, 막으면 두 표가 갈라진다.
 *   · 🔴 새 예외가 말하는 것은 **그 회차의 [납기일 확정]** 이다(사용자 결정 2026-11-25).
 *     확정은 「이 날짜가 더 이상 안 바뀐다」는 **사람이 건 잠금**이고, 그 잠금을 두고도
 *     날짜가 번지면 **확정된 적 없는 날짜에 확정 표시가 얹힌다** — 두 표가 갈라지는
 *     것이 아니라 **한 표가 거짓말을 하게 된다.** 그래서 거기서는 **수리 건 저장
 *     자체를 거절하고** 까닭을 말한다(mutations/repair-cases.ts 의
 *     planDomesticOrderDueDateLink 머리말 — 「거절하되 왜 거절되는지 팝업으로」).
 *
 * 🔵 **막다른 길이 아니다**: [내자 정리]에서 [확정 해제]를 누르면 그다음 저장은 예전과
 * 똑같이 번진다. 그래서 거절 문장이 그 차례를 그대로 말한다.
 * 🔵 **납품일·실제 출하일 묶기는 이 예외와 상관없다** — 확정은 **납기요청일**에 거는
 * 잠금이고, 거기까지 넓히면 확정한 줄에 출하 사실을 적을 길이 사라진다.
 * ============================================================================
 */
async function applyRepairCaseDueDateLink(
  tx: Tx,
  params: {
    /** 이 줄이 가리키는 수리 건. 연결이 없으면 null 이고 할 일도 없다. */
    repairCaseId: string | null;
    domesticOrderId: string;
    previousDueDates: readonly string[];
    nextDueDates: readonly string[];
  }
): Promise<RequestedDueDateLinkOutcome | null> {
  if (params.repairCaseId === null) return null;

  // 🔴 수리 건을 잠근 채 읽는다 — 읽고 쓰는 사이에 남이 그 칸을 고치면 낡은 값으로
  // 판정한 저장이 남의 날짜를 덮는다. 휴지통에 든 건은 건드리지 않는다(화면 어디에도
  // 없는 건의 칸을 이 저장이 바꾸면 안 된다).
  const [target] = await tx
    .select({
      id: repairCases.id,
      customerRequestedDueDate: repairCases.customerRequestedDueDate,
      receivedAt: repairCases.receivedAt,
    })
    .from(repairCases)
    .where(and(eq(repairCases.id, params.repairCaseId), eq(repairCases.isDeleted, false)))
    .for("update");
  if (!target) return null;

  // 같은 건에 붙은 **다른** 살아 있는 줄들 — 날짜가 몇 개인지만 센다.
  const otherLines = await tx
    .select({
      id: domesticOrders.id,
      dueDateCount: sql<number>`(
        select count(*) from ${domesticOrderDueDates}
        where ${domesticOrderDueDates.domesticOrderId} = ${domesticOrders.id}
      )`,
    })
    .from(domesticOrders)
    .where(
      and(
        eq(domesticOrders.repairCaseId, params.repairCaseId),
        eq(domesticOrders.isDeleted, false),
        ne(domesticOrders.id, params.domesticOrderId)
      )
    );

  const plan = resolveRepairCaseDueDateWriteThrough({
    editedLine: {
      previousDueDates: params.previousDueDates,
      nextDueDates: params.nextDueDates,
    },
    // count(*) 는 드라이버에 따라 글자로 온다 — 숫자로 못 박아 넘긴다.
    otherLines: otherLines.map((line) => ({ dueDateCount: Number(line.dueDateCount) })),
    customerRequestedDueDate: target.customerRequestedDueDate,
    receivedAt: target.receivedAt,
  });

  if (plan.kind === "NONE") return null;
  if (plan.kind === "NOT_LINKED") return plan.outcome;

  await tx
    .update(repairCases)
    .set({
      customerRequestedDueDate: plan.dueDate,
      // 🔴 version 을 올린다. 안 올리면 **열려 있던 수리 건 상세**가 낡은 version 으로
      // 저장해도 통과하고, 그 저장이 방금 맞춘 날짜를 제 옛 값으로 되돌린다.
      version: sql`${repairCases.version} + 1`,
      updatedAt: sql`now()`,
    })
    .where(eq(repairCases.id, params.repairCaseId));
  return { linked: true };
}

/**
 * ============================================================================
 * 🔴 납품일을 고치면 **수리 건의 실제 출하일도 함께** (2026-11-08)
 * ============================================================================
 * 바로 위 applyRepairCaseDueDateLink 와 **같은 모양의 거울**이고, 규칙은 역시
 * 도메인 파일 하나가 가진다(domain/delivered-date-link.ts 의
 * resolveRepairCaseShipmentWriteThrough). 이 함수가 하는 일은 재료를 읽어 와
 * 넘기고, WRITE 면 그 한 칸을 고치는 것뿐이다.
 *
 * ── 🔴 잠그는 차례는 위와 **똑같다** ────────────────────────────────────
 * 부르는 쪽이 이 줄을 이미 쥐고 있고(고치기는 `FOR UPDATE`, 만들기는 방금 INSERT
 * 한 줄), 그다음에 여기서 수리 건을 잠근다 — **내자 줄 먼저, 수리 건 나중.**
 * 거울 방향(mutations/repair-cases.ts · mutations/workflow-transitions.ts)도 전부
 * 그 차례다. 하나라도 거꾸로 적으면 두 사람이 같은 건을 동시에 고칠 때 교착이
 * 난다.
 *
 * 🔵 같은 저장에서 위 묶기가 이미 같은 수리 건 행을 `FOR UPDATE` 로 잡았을 수
 * 있다. 같은 트랜잭션이 같은 행을 다시 잡는 것은 **그냥 통과한다**(이미 제 것이다)
 * — 그래서 둘을 한 함수로 합치지 않았다: 합치면 「납기요청일 묶기」와 「납품일
 * 묶기」의 멈추는 자리가 한 덩어리가 되어, 한쪽을 고칠 때 다른 쪽이 따라 움직인다.
 *
 * ── 🔴 **같은 건의 다른 줄들은 잠그지 않는다** ──────────────────────────
 * 거기서 읽는 것은 「납품 기록이 몇인가」 하나뿐이고, 그 줄들까지 잡으면 서로 다른
 * 줄을 고치는 두 저장이 반대 차례로 잠그게 되어 교착이 생긴다(위와 같다).
 *
 * ── 🔴 수리 건을 **갈아 끼운 저장**은 묶지 않는다 ───────────────────────
 * 위와 같다 — 부르는 쪽이 연결이 그대로일 때만 이 함수를 부른다.
 * ============================================================================
 */
async function applyRepairCaseShipmentLink(
  tx: Tx,
  params: {
    repairCaseId: string | null;
    domesticOrderId: string;
    previousDeliveredDates: readonly string[];
    nextDeliveredDates: readonly string[];
  }
): Promise<DeliveredDateLinkOutcome | null> {
  if (params.repairCaseId === null) return null;

  // 🔴 수리 건을 잠근 채 읽는다 — 읽고 쓰는 사이에 남이 그 칸을 고치면 낡은 값으로
  // 판정한 저장이 남의 날짜를 덮는다. 휴지통에 든 건은 건드리지 않는다.
  const [target] = await tx
    .select({
      id: repairCases.id,
      actualShipmentDate: repairCases.actualShipmentDate,
      receivedAt: repairCases.receivedAt,
    })
    .from(repairCases)
    .where(and(eq(repairCases.id, params.repairCaseId), eq(repairCases.isDeleted, false)))
    .for("update");
  if (!target) return null;

  // 같은 건에 붙은 **다른** 살아 있는 줄들 — 납품 기록이 몇인지만 센다.
  const otherLines = await tx
    .select({
      id: domesticOrders.id,
      deliveredCount: sql<number>`(
        select count(*) from ${domesticOrderDueDates}
        where ${domesticOrderDueDates.domesticOrderId} = ${domesticOrders.id}
          and ${domesticOrderDueDates.deliveredDate} is not null
      )`,
    })
    .from(domesticOrders)
    .where(
      and(
        eq(domesticOrders.repairCaseId, params.repairCaseId),
        eq(domesticOrders.isDeleted, false),
        ne(domesticOrders.id, params.domesticOrderId)
      )
    );

  const plan = resolveRepairCaseShipmentWriteThrough({
    editedLine: {
      previousDeliveredDates: params.previousDeliveredDates,
      nextDeliveredDates: params.nextDeliveredDates,
    },
    // count(*) 는 드라이버에 따라 글자로 온다 — 숫자로 못 박아 넘긴다.
    otherLines: otherLines.map((line) => ({ deliveredCount: Number(line.deliveredCount) })),
    repairCaseActualShipmentDate: target.actualShipmentDate,
    receivedAt: target.receivedAt,
  });

  if (plan.kind === "NONE") return null;
  if (plan.kind === "NOT_LINKED") return plan.outcome;

  await tx
    .update(repairCases)
    .set({
      actualShipmentDate: plan.date,
      // 🔴 version 을 올린다. 안 올리면 **열려 있던 수리 건 상세**가 낡은 version 으로
      // 저장해도 통과하고, 그 저장이 방금 맞춘 날짜를 제 옛 값으로 되돌린다.
      version: sql`${repairCases.version} + 1`,
      updatedAt: sql`now()`,
    })
    .where(eq(repairCases.id, params.repairCaseId));
  return { linked: true };
}

/** 새 줄 하나. version 은 스키마 기본값 1로 시작한다. */
export async function createDomesticOrder(params: {
  fields: DomesticOrderFields;
  actorUserId: string;
}): Promise<DomesticOrderMutationResult> {
  return db.transaction(async (tx): Promise<DomesticOrderMutationResult> => {
    const badReference = await checkReferences(tx, params.fields);
    if (badReference) return badReference;

    // 🔴 새 줄에는 저장돼 있던 행이 없다(빈 목록). 그래서 결정 5 는 걸릴 일이 없고,
    //    걸리는 것은 결정 9 뿐이다 — **수리 건을 붙이면서 납기요청일을 둘 이상 달고
    //    들어오는 줄**은 여기서 거절된다(그 함수의 「늘리는가」).
    const badRows = checkDueDateRowGuard({
      storedRows: [],
      storedRepairCaseId: null,
      fields: params.fields,
    });
    if (badRows) return badRows;

    const [inserted] = await tx
      .insert(domesticOrders)
      .values({
        ...toColumnValues(params.fields),
        createdBy: params.actorUserId,
        // 만든 사람이 곧 마지막으로 고친 사람이다. 여기를 비워 두면 목록에서
        // "누가 마지막으로 손댔는가"가 첫 수정 전까지 빈칸으로 남는다.
        updatedBy: params.actorUserId,
      })
      .returning({ id: domesticOrders.id, version: domesticOrders.version });

    // 같은 트랜잭션 안이다 — 날짜를 넣다 실패하면 방금 만든 줄도 함께 없던
    // 일이 된다. 날짜만 빠진 줄이 남는 편이 더 나쁘다: 화면에는 정상으로
    // 보이는데 사람이 적은 납기일만 사라진 상태다.
    // 🔴 방금 만든 줄이라 **되얹을 옛 행이 없다**(빈 목록). 새 회차가 완료로 태어나는
    //    길은 그래서 아예 없다.
    await replaceDueDates(tx, inserted.id, params.fields, []);

    // 🔴 새 줄에 적은 납기요청일도 수리 건과 묶는다(2026-10-30). 앞 값은 빈 목록이다
    // — 방금 생긴 줄이라 「고치기 전」이 없다. 수리 건 쪽이 비어 있으면 아무 일도
    // 일어나지 않는다(그 건은 이 줄의 날짜를 빌려 그린다).
    const link = await applyRepairCaseDueDateLink(tx, {
      repairCaseId: params.fields.repairCaseId,
      domesticOrderId: inserted.id,
      previousDueDates: [],
      nextDueDates: params.fields.dueDates.map((entry) => entry.dueDate),
    });

    // 🔴 새 줄에 적은 납품일도 수리 건과 묶는다(2026-11-08). 앞 값은 빈 목록이다.
    // 아직 출하 전인 건이면 **밀어 넣지 않고 말한다**(그 도메인 파일 머리말 ⑤ —
    // 그 칸은 종 알림 넷의 침묵 스위치다).
    const deliveredLink = await applyRepairCaseShipmentLink(tx, {
      repairCaseId: params.fields.repairCaseId,
      domesticOrderId: inserted.id,
      previousDeliveredDates: [],
      nextDeliveredDates: deliveredDatesOf(params.fields.dueDates),
    });

    // 🔴 새 줄에 적은 PO발행일도 수리 건의 단계를 [수리 대기]로 옮긴다(2026-11-26).
    // 앞 값은 null 이다 — 방금 생긴 줄이라 「고치기 전」이 없다. 그 건이 이미 그
    // 단계이거나 더 뒤에 있으면 아무 일도 일어나지 않는다(그 파일의 판정).
    await applyPoIssuedRepairWaitingInTx(tx, {
      repairCaseId: params.fields.repairCaseId,
      previousOrderIssuedDate: null,
      nextOrderIssuedDate: params.fields.orderIssuedDate,
      actorUserId: params.actorUserId,
    });

    return {
      ok: true,
      id: inserted.id,
      version: inserted.version,
      ...(link ? { requestedDueDateLink: link } : {}),
      ...(deliveredLink ? { deliveredDateLink: deliveredLink } : {}),
    };
  });
}

/**
 * 한 줄을 통째로 고친다. 칸 하나씩 고치는 경로는 없다(파일 헤더 참조).
 *
 * 🔴 **완료된 줄에는 관문이 하나 더 선다**(2026-11-19) — 아래 그 자리의 주석.
 */
export async function updateDomesticOrder(params: {
  id: string;
  expectedVersion: number;
  fields: DomesticOrderFields;
  actorUserId: string;
}): Promise<DomesticOrderUpdateMutationResult> {
  return db.transaction(async (tx): Promise<DomesticOrderUpdateMutationResult> => {
    const [current] = await tx
      .select({
        id: domesticOrders.id,
        version: domesticOrders.version,
        // 🔴 묶기가 본다 — 이 저장이 **가리키는 수리 건 자체를 바꾸는 중**이면
        // 날짜를 밀어 넣지 않는다(applyRepairCaseDueDateLink 머리말).
        repairCaseId: domesticOrders.repairCaseId,
        // 🔴 **2026-11-26 에 더했다.** 「PO발행일이 적히면 [수리 대기]로」가 보는 한
        // 칸이다(파일 머리말). **저장 전 값**이라야 「이번 저장이 그 날짜를 바꿨는가」를
        // 가를 수 있다 — 아래 UPDATE 뒤에 읽으면 언제나 「안 바뀜」이고, 그러면 그
        // 기능이 **오류 하나 없이 영영 안 돈다**(납기요청일 묶기가 전·후를 가르는
        // 그 까닭과 같다).
        orderIssuedDate: domesticOrders.orderIssuedDate,
        // 🔴 **2026-11-19 에 더했다.** 「완료 시 수정」 관문이 보는 한 칸이다 — 이 칸을
        // 안 읽으면 지금 고치려는 줄이 완료된 줄인지 알 수 없어 관문을 세울 수가 없다.
        // 판정은 completed_at 하나로만 한다(schema/domestic-orders.ts 의 그 칸 주석).
        completedAt: domesticOrders.completedAt,
      })
      .from(domesticOrders)
      .where(and(eq(domesticOrders.id, params.id), eq(domesticOrders.isDeleted, false)))
      .for("update");

    // 없는 id 와 이미 지워진 행을 같은 답으로 묶는다. 둘을 구분해 알려 주면
    // "그 id 는 존재하지만 지워졌다"는 사실이 새어 나간다.
    if (!current) {
      return { ok: false, code: "NOT_FOUND", message: NOT_FOUND_MESSAGE };
    }

    if (current.version !== params.expectedVersion) {
      return { ok: false, code: "CONFLICT", message: VERSION_CONFLICT_MESSAGE };
    }

    // ── 🔴 **완료된 줄은 「완료 시 수정」이 있어야 고쳐진다** (2026-11-19) ──
    // 사용자 요청: 「수정권한을 가진 사람만 완료된 건에 대한 수정, 완료해제를 할 수
    // 있어야 해」. 칸 하나를 고치는 길도 줄 수정 폼도 전부 이 함수로 모인다.
    //
    // 🔴 **완료되지 않은 줄은 한 글자도 달라지지 않는다** — 관문이 이 조건 안에만 선다.
    // 🔴 **version 대조 뒤**다. 앞에 두면 낡은 화면에서 누른 저장이 CONFLICT 대신
    //    「권한이 없다」로 답한다 — 사람은 권한을 받으러 가지만 진짜 문제는 그 사이
    //    남이 그 줄을 완료한 것이고, 권한을 받아 와도 같은 자리에서 또 막힌다
    //    (setDomesticOrderCompletion 의 승인 관문이 같은 차례를 쓰는 그 까닭).
    // 🔴 **UPDATE 보다 앞**이다 — 거절로 끝나는 저장이 이 줄을 이미 바꿔 놓으면
    //    「거절됐는데 반은 저장된」 상태가 남는다(아래 울타리와 같은 규칙).
    if (current.completedAt !== null) {
      const denied = await checkCompletedDomesticOrderEdit(tx, params.actorUserId);
      if (denied) return denied;
    }

    const badReference = await checkReferences(tx, params.fields);
    if (badReference) return badReference;

    // 🔴 **replaceDueDates 보다 먼저** 읽는다 — 묶기는 「이 저장이 날짜를 실제로
    // 바꿨는가」를 전·후로 가른다(그 함수 머리말). 뒤에 읽으면 언제나 「안 바뀜」이다.
    // 🔴 울타리(결정 5)도 이 값을 쥐고 있어야 한다 — 지운 뒤에는 무엇이 있었는지
    // 알 길이 없다.
    const previousRows = await readDueDateRows(tx, params.id);
    const previousDueDates = previousRows.map((row) => row.dueDate);

    // 🔴 **UPDATE 보다 먼저** 막는다 — 거절로 끝나는 저장이 이 줄의 다른 칸을 이미
    // 바꿔 놓으면 「거절됐는데 반은 저장된」 상태가 남는다.
    const badRows = checkDueDateRowGuard({
      storedRows: previousRows,
      storedRepairCaseId: current.repairCaseId,
      fields: params.fields,
    });
    if (badRows) return badRows;

    const [updated] = await tx
      .update(domesticOrders)
      .set({
        ...toColumnValues(params.fields),
        version: sql`${domesticOrders.version} + 1`,
        updatedAt: new Date(),
        updatedBy: params.actorUserId,
      })
      // 잠금을 쥐고 있으므로 version 조건 없이도 안전하지만, 그대로 한 번 더
      // 적는다 — 이 저장소의 다른 mutation 들이 0행 갱신을 마지막 안전망으로
      // 쓰는 방식과 같고, 잠금 방식을 나중에 바꿔도 이 조건은 남는다.
      .where(and(eq(domesticOrders.id, params.id), eq(domesticOrders.version, params.expectedVersion)))
      .returning({ id: domesticOrders.id, version: domesticOrders.version });

    if (!updated) {
      return { ok: false, code: "CONFLICT", message: VERSION_CONFLICT_MESSAGE };
    }

    // **여기까지 와야 날짜를 손댄다.** 위의 NOT_FOUND · CONFLICT ·
    // VALIDATION_ERROR 는 전부 이 줄 앞에서 돌아가므로, 그 길로 끝난 저장은
    // 날짜를 한 건도 바꾸지 않는다. 순서가 곧 그 보장이다 — 먼저 지워 놓고
    // version 을 보면, 충돌한 저장이 남의 날짜를 지운 채로 실패한다.
    // 🔴 **아까 읽어 둔 옛 행들을 그대로 넘긴다** — 회차별 완료 표시는 그 안에만
    //    있고, 지운 뒤에는 무엇이 있었는지 알 길이 없다.
    await replaceDueDates(tx, params.id, params.fields, previousRows);

    // 🔴 수리 건의 고객 요청 납기일도 같은 날짜로 맞춘다(2026-10-30). 같은 트랜잭션
    // 안이라 **한쪽만 써지는 일이 없다** — 수리 건 쪽이 실패하면 이 줄의 날짜도 함께
    // 없던 일이 된다. 연결을 갈아 끼우는 저장이면 건드리지 않는다(아래 current 비교).
    const sameLink = current.repairCaseId === params.fields.repairCaseId;
    const link = sameLink
      ? await applyRepairCaseDueDateLink(tx, {
          repairCaseId: params.fields.repairCaseId,
          domesticOrderId: params.id,
          previousDueDates,
          nextDueDates: params.fields.dueDates.map((entry) => entry.dueDate),
        })
      : null;

    // 🔴 납품일도 같은 트랜잭션 안에서 수리 건의 실제 출하일과 맞춘다(2026-11-08).
    // 연결을 갈아 끼우는 저장이면 건드리지 않는 것도 위와 같다 — 사람이 고른 적 없는
    // 날짜가 새 수리 건에 적히고, 옛 건에서는 아무 일도 안 일어나 두 건이 동시에
    // 어긋난다.
    const deliveredLink = sameLink
      ? await applyRepairCaseShipmentLink(tx, {
          repairCaseId: params.fields.repairCaseId,
          domesticOrderId: params.id,
          previousDeliveredDates: deliveredDatesOf(previousRows),
          nextDeliveredDates: deliveredDatesOf(params.fields.dueDates),
        })
      : null;

    // 🔴 PO발행일이 이번 저장에서 적혔으면 단계를 [수리 대기]로 옮긴다(2026-11-26).
    // 연결을 갈아 끼우는 저장이면 건드리지 않는 것도 위 둘과 같다(머리말).
    // 🔵 날짜가 안 바뀐 저장(금액·비고만 고친 저장)은 그 함수의 첫 줄에서 끝나므로
    //    수리 건을 읽는 질의조차 일어나지 않는다.
    if (sameLink) {
      await applyPoIssuedRepairWaitingInTx(tx, {
        repairCaseId: params.fields.repairCaseId,
        previousOrderIssuedDate: current.orderIssuedDate,
        nextOrderIssuedDate: params.fields.orderIssuedDate,
        actorUserId: params.actorUserId,
      });
    }

    return {
      ok: true,
      id: updated.id,
      version: updated.version,
      ...(link ? { requestedDueDateLink: link } : {}),
      ...(deliveredLink ? { deliveredDateLink: deliveredLink } : {}),
    };
  });
}

/**
 * 한 줄을 완료로 표시하거나 그 표시를 거둔다.
 *
 * ── 완료와 해제가 한 함수인 이유 ────────────────────────────────────────
 * 둘로 나누면 잠금·version 대조·updated_by 기록이 두 벌이 되고, 나중에 한쪽만
 * 고쳐지는 날이 온다. 실제로 다른 것은 두 칸에 무엇을 쓰느냐뿐이라
 * 불리언 하나로 가른다.
 *
 * ── 두 칸은 언제나 함께 움직인다 ────────────────────────────────────────
 * 완료면 completed_at 과 completed_by 를 함께 쓰고, 해제면 **둘 다 NULL** 이다.
 * 한쪽만 남기면 "완료 시각은 없는데 완료한 사람은 있는" 행이 생기고, 그때
 * 그 행이 완료인지 아닌지 답할 방법이 없다. 판정은 completed_at 하나로만 한다
 * (schema/domestic-orders.ts 의 completed_at 주석).
 *
 * 그 밖은 updateDomesticOrder 와 같다 — 트랜잭션 + 행 잠금 + version 대조.
 * 완료는 되돌릴 수 있는 조작이지만 그렇다고 남의 저장을 덮어써도 되는 것은
 * 아니다. 낡은 화면에서 누른 '완료'가 그 사이 바뀐 금액·입금 사실과 같은
 * version 을 들고 들어오면, 그 화면은 이미 사실과 다른 것을 보고 있다.
 *
 * ── 🔴 **기타건은 승인이 있어야 완료된다** (2026-11-07) ─────────────────
 * 사용자 결정이다: 「기타건의 경우도 [기타건 최종 출하 승인]이 되야 [내자정리]에서
 * [완료]처리를 할 수 있도록」. 규칙 자체는 여기 적지 않는다 —
 * domain/domestic-order-approval-rules.ts 의 resolveMiscCaseCompletionGate 하나다.
 *
 * ── 🔴 **그 관문이 회차마다 선다** (2026-11-08, 사용자 결정 13) ──────────
 * 「납기 요청일에 대한 최종출하승인이 완료되지 않으면 납기 요청일에 대한 [완료 처리]가
 * 안 되도록」. 이 함수는 **줄 전체를 끝내는 길**이라, 회차 **전부**의 승인을 본다 —
 * 하나라도 아직이면 거절하고 **어느 회차가 막혔는지** 이름을 말한다.
 * 🔵 회차가 0개·1개인 기타건에서는 단위가 하나뿐이라 2026-11-07 과 글자 그대로 같다.
 *
 * 🔴 **통과하면 회차 행에도 완료를 찍는다**(해제면 함께 지운다). 안 찍으면 「줄은
 * 완료인데 회차는 미완료」인 상태가 남아, 회차별 단추가 완료된 줄에서 「아직」이라고
 * 말한다. 🔴 **수리 건이 붙은 줄은 건드리지 않는다** — 그쪽에는 회차 개념이 없고,
 * 찍어 두면 셋째 울타리(완료된 회차가 있으면 줄을 못 지운다)가 수리 건 줄까지
 * 조용히 묶는다. 「수리 건 붙은 줄은 지금과 똑같다」가 이 조각의 완료 기준이다.
 *
 * 🔴 **왜 서버의 울타리가 여기인가.** 완료를 누르는 자리는 화면 둘(표·카드) ·
 * 서버 액션 하나 · PO 가 부르는 통로 하나인데, 그 넷이 전부 이 함수 한 곳으로
 * 모인다(서비스 둘을 거쳐서 온다). 화면이나 서비스에서 막으면 그 층을 거치지 않는
 * 길이 생기는 날 조용히 뚫린다. 접수 건 쪽도 같은 모양이다 — 출하 완료 전이의 승인
 * 관문은 화면이 아니라 mutations/workflow-transitions.ts 안에 있다.
 *
 * 🔴 **잠근 행에서 본다.** 승인의 유효함은 「요청 때의 version == 지금 version」이고,
 * 결재 요청 경로도 같은 행을 `FOR UPDATE` 로 잡는다
 * (mutations/domestic-order-approvals.ts) — 둘이 줄을 서므로 「읽고 나서 쓰기까지」
 * 사이에 승인이 생기거나 낡아지는 틈이 없다.
 *
 * 🔵 **막히는 줄은 셋 중 하나도 아니어야 한다**(아래 셋은 전부 **승인 관문** 이야기다
 * — 2026-11-19 에 생긴 「완료 시 수정」 관문은 서는 자리가 다르다):
 *  · 완료 **해제**(completed === false)는 **승인으로** 막지 않는다 — 잠그는 조작이
 *    아니고, 막으면 승인 없이 완료된 옛 줄을 되돌릴 길이 사라진다.
 *    🔴 **그렇다고 아무나 푸는 것은 아니다**(2026-11-19): 해제는 「완료 시 수정」이
 *    있어야 한다. 묻는 것이 **승인이 아니라 사람의 권한**이라 위 까닭과 부딪히지
 *    않는다 — 그 권한을 가진 사람은 옛 줄도 그대로 되돌릴 수 있다.
 *  · **수리 건이 붙은 줄**은 막지 않는다 — 그쪽은 이미 전이가 승인을 요구한다
 *    (services/complete-domestic-order.ts). 여기서 또 보면 **기타건 갈래의 승인**을
 *    접수 건에까지 요구하게 되고, 그 결재선은 애초에 다른 갈래다.
 *  · **이미 완료된 줄**은 막지 않는다 — 운영에 승인 없이 완료된 기타건이 있고
 *    (2026-11-07 개발 DB 실측 1건), 같은 요청이 그 줄들을 오류로 만들면 안 된다.
 *    이 관문은 「지금 완료로 넘어가는 줄」에만 선다.
 */
export async function setDomesticOrderCompletion(params: {
  id: string;
  expectedVersion: number;
  /** true 면 완료 처리, false 면 완료 해제. */
  completed: boolean;
  actorUserId: string;
}): Promise<DomesticOrderCompletionMutationResult> {
  return db.transaction(async (tx): Promise<DomesticOrderCompletionMutationResult> => {
    const [current] = await tx
      .select({
        id: domesticOrders.id,
        version: domesticOrders.version,
        // 🔴 승인 관문이 보는 둘 — 「기타건인가」와 「이미 완료인가」.
        repairCaseId: domesticOrders.repairCaseId,
        completedAt: domesticOrders.completedAt,
      })
      .from(domesticOrders)
      .where(and(eq(domesticOrders.id, params.id), eq(domesticOrders.isDeleted, false)))
      .for("update");

    if (!current) {
      return { ok: false, code: "NOT_FOUND", message: NOT_FOUND_MESSAGE };
    }

    if (current.version !== params.expectedVersion) {
      return { ok: false, code: "CONFLICT", message: VERSION_CONFLICT_MESSAGE };
    }

    // ── 🔴 **완료 해제는 「완료 시 수정」이 있어야 한다** (2026-11-19) ──────
    // 사용자 요청의 두 조작 중 하나다(다른 하나는 완료된 줄의 수정 —
    // updateDomesticOrder). 🔴 **완료 처리 쪽은 막지 않는다**: 그 일은 예전 그대로
    // `domesticOrders.edit` 하나가 정한다. 새 권한이 평소 일을 막으면 안 된다.
    //
    // 🔵 `completed_at` 이 이미 비어 있는 줄에 온 해제 요청(아무것도 안 바뀌는 저장)도
    //    함께 막힌다. **일부러다** — 막히느냐 아니냐가 그 순간의 경합 결과로 갈리면
    //    같은 단추가 어떤 때는 되고 어떤 때는 안 되는 것처럼 보인다.
    // 🔴 version 대조 **뒤**인 것은 아래 승인 관문과 같은 까닭이다.
    if (!params.completed) {
      const denied = await checkCompletedDomesticOrderEdit(tx, params.actorUserId);
      if (denied) return denied;
    }

    // 🔴 기타건인가. 이 한 값이 아래 셋을 함께 가른다 — 승인 관문을 세울지, 회차
    //    행에 완료를 찍을지, 회차별 완료를 아예 쓰는 줄인지.
    const isMiscCase = current.repairCaseId === null;

    // 🔴 **version 대조 뒤**다. 앞에 두면 낡은 화면에서 누른 완료가 CONFLICT 대신
    //    「승인이 없다」로 답한다 — 사람은 승인을 받으러 가지만 진짜 문제는 그 사이
    //    남이 줄을 고친 것이고, 승인을 받아 와도 같은 자리에서 또 막힌다.
    if (params.completed && isMiscCase && current.completedAt === null) {
      // 🔴 **회차 전부**를 본다(2026-11-08, 사용자 결정 13). 이 길은 줄 전체를 끝내는
      //    길이라, 하나라도 승인이 아직이면 거절이다.
      const rows = await readDueDateRows(tx, current.id);
      const blocked = await checkMiscCaseCompletionApproval(
        tx,
        current.id,
        current.version,
        domesticOrderDueDateUnits(rows),
        // 🔴 그 줄에 회차가 여럿일 때만 이름을 댄다(그 함수의 nameTheRow 주석).
        rows.length > 1
      );
      if (blocked) return blocked;
    }

    // 완료 시각과 수정 시각이 같은 한 순간을 가리키게 한다 — 두 번 읽으면
    // 같은 저장인데 두 시각이 미세하게 어긋난다.
    const now = new Date();
    const [updated] = await tx
      .update(domesticOrders)
      .set({
        completedAt: params.completed ? now : null,
        completedBy: params.completed ? params.actorUserId : null,
        version: sql`${domesticOrders.version} + 1`,
        updatedAt: now,
        updatedBy: params.actorUserId,
      })
      .where(
        and(eq(domesticOrders.id, params.id), eq(domesticOrders.version, params.expectedVersion))
      )
      .returning({ id: domesticOrders.id, version: domesticOrders.version });

    if (!updated) {
      return { ok: false, code: "CONFLICT", message: VERSION_CONFLICT_MESSAGE };
    }

    // 🔴 회차 행도 줄과 **같은 방향으로** 움직인다(2026-11-08). 안 맞추면 「줄은
    //    완료인데 회차는 아직」인 상태가 남고, 회차별 단추가 완료된 줄에서 「아직」을
    //    말한다. 🔴 **수리 건이 붙은 줄은 건드리지 않는다** — 그쪽에 회차 개념이 없고,
    //    찍어 두면 셋째 울타리가 수리 건 줄의 납기요청일 편집까지 조용히 묶는다.
    if (isMiscCase) {
      if (params.completed) {
        // 이미 찍힌 회차는 **그 시각과 그 사람을 그대로 둔다** — 누가 언제 그 회차를
        // 끝냈는지가 이 줄의 유일한 기록이고, 줄 전체를 끝내는 조작이 그것을 덮을
        // 까닭이 없다.
        await tx
          .update(domesticOrderDueDates)
          .set({ completedAt: now, completedBy: params.actorUserId, updatedAt: now })
          .where(
            and(
              eq(domesticOrderDueDates.domesticOrderId, params.id),
              isNull(domesticOrderDueDates.completedAt)
            )
          );
      } else {
        await tx
          .update(domesticOrderDueDates)
          .set({ completedAt: null, completedBy: null, updatedAt: now })
          .where(eq(domesticOrderDueDates.domesticOrderId, params.id));
      }
    }

    return { ok: true, id: updated.id, version: updated.version };
  });
}

/**
 * ============================================================================
 * 🔴 **회차 하나를 완료로 표시하거나 그 표시를 거둔다** (2026-11-08)
 * ============================================================================
 * 사용자 결정 7: 「납품일이 여러개라면 **각각에 [완료처리]버튼**을 만들어줘」.
 * 결정 8: 「**마지막 분할분이 찍히면 자동으로**」 내자 줄이 완료된다.
 * 결정 13: 「납기 요청일에 대한 최종출하승인이 완료되지 않으면 납기 요청일에 대한
 * [완료 처리]가 안 되도록」.
 *
 * ── 🔴 **기타건 전용이다** ──────────────────────────────────────────────
 * 수리 건이 붙은 줄은 납기요청일을 하나만 가질 수 있고(결정 9 울타리) 완료가 수리
 * 건의 출하 완료까지 함께 움직이는 다른 흐름이다(services/complete-domestic-order.ts).
 * 그 줄에 이 길을 열면 **수리 건을 건드리지 않고 내자 줄만 완료되는 뒷문**이 생긴다.
 *
 * ── 🔴 **`version` 을 올리지 않는다 — 이 함수에서 가장 중요한 한 줄** ────
 * 올리면 이 기능이 **스스로를 먹는다.** 승인의 유효함은 「요청 때의 version == 지금
 * version」이고(resolveApprovalState), 회차마다 승인이 따로 서 있다. 1차를 완료하며
 * version 을 올리면 **그 순간 2차·3차의 승인이 전부 STALE** 이 되어, 사람은 1차를
 * 끝낼 때마다 남은 회차의 승인을 다시 받아야 한다. 그 어긋남은 오류를 내지 않고
 * 「승인했는데 왜 또 승인하라는가」로만 보인다.
 *
 * 🔵 **낙관적 잠금이 약해지지 않는다.** 들어온 `expectedVersion` 은 여전히 대조하고,
 * 줄의 내용을 바꾸는 저장(updateDomesticOrder)은 그대로 version 을 올린다 — 그
 * 사이에 누가 줄을 고쳤으면 여기서 CONFLICT 다. 올리지 않는 것은 **이 조작이 줄의
 * 내용을 한 글자도 바꾸지 않기 때문**이고(회차 행의 완료 두 칸뿐이다), 그래서
 * 「요청 뒤에 내용이 바뀌었는가」라는 물음의 답을 바꿀 이유가 없다.
 * 🔴 줄 전체를 끝내는 setDomesticOrderCompletion 은 **그대로 올린다** — 그쪽은 줄의
 * 칸(completed_at)을 바꾸는 조작이고, 끝난 뒤에 더 받을 승인도 없다.
 *
 * ── 🔴 **마지막 회차가 찍히면 줄이 자동으로 완료된다** (결정 8) ──────────
 * 「마지막」의 뜻을 **「모든 회차가 완료된 순간」**으로 읽었다. 「모든 회차에 납품일이
 * 찍힌 순간」이 아니다 — 그렇게 읽으면 승인을 받지 않은 회차까지 끌고 줄이 완료되어
 * 결정 13 과 정면으로 부딪힌다. 이 읽기에서는 **모든 회차 완료 = 모든 회차 승인됨**
 * 이므로(각 회차가 이 함수를 통과해야 완료된다) 자동 완료가 관문에 막힐 일이 없고,
 * 그래서 여기서 줄 단위 관문을 **다시 세우지 않는다.**
 *
 * ── 🔵 해제는 위로도 번진다 ─────────────────────────────────────────────
 * 회차 하나를 풀면 「모든 회차 완료」가 깨지므로 줄의 완료도 함께 거둔다. 안 그러면
 * 줄은 완료인데 회차는 아닌 상태가 남고, 그 줄은 **다시 완료할 길이 없다**(이미
 * 완료라 줄 단추가 [완료 해제]로 바뀐다).
 *
 * ── 🔴 **완료를 누르면 그 회차의 납품일에 오늘이 찍힌다** (2026-11-08) ────
 * 사용자 요구: 「**1차완료 2차 완료를 누를 때 그 날짜로 납품일이 찍히도록** 해줘.」
 * 출하 완료 전이가 연결된 내자 줄에 같은 일을 하는 것(사용자 결정 6)의 **기타건
 * 판**이고, 규칙도 그 한 벌을 그대로 쓴다(domain/delivered-date-link.ts).
 *
 *  · 🔴 **이미 적힌 납품일은 덮지 않는다.** 사람이 적은 날짜가 이긴다.
 *  · 🔴 **[완료 해제]는 납품일을 지우지 않는다.** 그래서 「완료는 풀렸는데 납품일은
 *    남은」 회차가 생긴다 — **고장이 아니라 정한 모양**이다. 지우려면 납품 편집칸에서
 *    사람이 지운다.
 *  · 🔵 **건드리는 것은 그 회차 한 줄뿐**이다 — `display_order = dueDateRowOrder`
 *    하나를 집어 쓴다(아래 WHERE). 2차 줄은 1차를 완료해도 그대로다.
 *  · 🔵 **version 은 여기서도 안 올라간다**(위 그 한 줄). 납품일을 함께 찍는다고
 *    「요청 뒤에 내용이 바뀌었는가」의 답이 달라질 이유가 없다 — 올리면 남은 회차의
 *    승인이 전부 STALE 이 되어 기능이 스스로를 먹는다.
 * ============================================================================
 */
export async function setDomesticOrderDueDateRowCompletion(params: {
  id: string;
  expectedVersion: number;
  /** 몇 번째 회차인가(1부터). `display_order` 와 같은 번호다. */
  dueDateRowOrder: number;
  /** true 면 그 회차를 완료 처리, false 면 완료 해제. */
  completed: boolean;
  actorUserId: string;
}): Promise<DomesticOrderCompletionMutationResult> {
  return db.transaction(async (tx): Promise<DomesticOrderCompletionMutationResult> => {
    const [current] = await tx
      .select({
        id: domesticOrders.id,
        version: domesticOrders.version,
        repairCaseId: domesticOrders.repairCaseId,
        completedAt: domesticOrders.completedAt,
      })
      .from(domesticOrders)
      .where(and(eq(domesticOrders.id, params.id), eq(domesticOrders.isDeleted, false)))
      .for("update");

    if (!current) {
      return { ok: false, code: "NOT_FOUND", message: NOT_FOUND_MESSAGE };
    }
    if (current.version !== params.expectedVersion) {
      return { ok: false, code: "CONFLICT", message: VERSION_CONFLICT_MESSAGE };
    }
    if (current.repairCaseId !== null) {
      // 🔴 기타건 전용이다(머리말). 화면은 이 단추를 그리지도 않지만, 막는 자리는
      //    화면이 아니라 여기다.
      return {
        ok: false,
        code: "VALIDATION_ERROR",
        message: "수리 건이 연결된 줄은 회차별 완료 처리를 쓰지 않습니다. 줄의 [완료 처리]를 눌러 주세요.",
      };
    }

    // 🔴 **잠근 줄에서 다시 읽는다.** 화면이 보낸 회차 번호가 지금도 있는 번호인지는
    //    여기서만 알 수 있다 — 그 사이 남이 납기요청일을 줄였을 수 있고, 그랬다면
    //    위 version 대조에서 이미 걸린다(줄을 고치는 저장은 version 을 올린다).
    const rows = await readDueDateRows(tx, current.id);
    if (rows.length === 0) {
      return {
        ok: false,
        code: "VALIDATION_ERROR",
        message: "납기요청일 줄이 없어 회차별 완료 처리를 할 수 없습니다. 먼저 납기요청일을 적어 주세요.",
      };
    }
    const index = params.dueDateRowOrder - 1;
    if (!Number.isInteger(params.dueDateRowOrder) || index < 0 || index >= rows.length) {
      return {
        ok: false,
        code: "VALIDATION_ERROR",
        message: "그 회차를 찾을 수 없습니다. 최신 정보를 다시 불러와 주세요.",
      };
    }

    // ── 🔴 **회차 완료 해제도 「완료 시 수정」이 있어야 한다** (2026-11-19) ──
    // 줄 단위 해제와 **같은 열쇠**다. 갈리면 「줄은 못 푸는데 회차는 푸는」 사람이
    // 생기고, 회차를 풀면 아래 '해제는 위로도 번진다'로 **줄의 완료까지 함께 거둬진다**
    // — 즉 그 사람은 회차 단추로 줄 단위 해제를 하게 된다.
    // 🔴 **완료 처리 쪽은 막지 않는다**(줄 단위와 같다). 바로 아래 승인 관문만 선다.
    if (!params.completed) {
      const denied = await checkCompletedDomesticOrderEdit(tx, params.actorUserId);
      if (denied) return denied;
    }

    const units = domesticOrderDueDateUnits(rows);
    const now = new Date();

    if (params.completed) {
      // 🔴 **그 회차의 승인 하나만** 본다(결정 13). 다른 회차가 아직이어도 이 회차는
      //    끝낼 수 있다 — 그것이 회차별 완료의 뜻이다.
      const blocked = await checkMiscCaseCompletionApproval(
        tx,
        current.id,
        current.version,
        [units[index]],
        // 🔴 **단위 하나만 넘기므로 길이로는 가릴 수 없다**(그 함수의 nameTheRow 주석).
        //    묻는 것은 「그 줄에 회차가 여럿인가」다 — 여럿이면 어느 회차가 막혔는지
        //    말해야 단추 셋이 전부 같은 말을 하는 일이 없다.
        rows.length > 1
      );
      if (blocked) return blocked;
    }

    // ── 🔴 **완료를 누르면 그 회차의 납품일에 오늘이 찍힌다** (2026-11-08) ──
    // 사용자 요구: 「1차완료 2차 완료를 누를 때 그 날짜로 납품일이 찍히도록」.
    //
    // 🔴 **규칙을 여기 적지 않는다** — 출하 완료 전이가 연결된 내자 줄에 쓰는 그
    //    규칙과 **한 벌**이다(domain/delivered-date-link.ts). 요점은 하나뿐이다:
    //    **이미 적힌 납품일은 덮지 않는다.** 사람이 적어 둔 날짜는 「실제로 보낸 날」
    //    이고 완료를 누른 날과 며칠 어긋나는 것이 정상이라, 자동 처리가 덮으면 그
    //    사실이 말없이 사라진다.
    //
    // 🔴 **[완료 해제] 때는 묻지도 않는다** — 보낸 사실은 완료를 풀었다고 사라지지
    //    않는다(그 파일의 「지우는 쪽은 안 묶는다」). 그래서 「완료는 풀렸는데 납품일은
    //    남은」 회차가 생기고, **그것이 정한 모양**이다.
    //
    // 🔵 「오늘」은 출하 완료 자동 기록과 **같은 방식으로** 만든다
    //    (mutations/workflow-transitions.ts 의 `shippedOn`). 두 자동 기록이 서로 다른
    //    방식으로 날짜를 만들면 같은 날 찍힌 두 값이 하루 어긋날 수 있다.
    // 🔵 **수리 건 쪽으로 밀지 않는다** — 이 길은 기타건 전용이라(바로 위 울타리)
    //    맞출 수리 건이 애초에 없다.
    const deliveredStamp = params.completed
      ? resolveDueDateRowCompletionDeliveredPlan({
          currentDeliveredDate: rows[index].deliveredDate,
          // 🔴 **`toKstDateOnly` 다**(2026-11-09 고침). 전에는 `toISOString().slice(0, 10)`
          //    이었는데 그것은 **UTC 날짜**라, 한국 시간 00:00~09:00 사이에 [N차 완료]를
          //    누르면 **어제 날짜가 납품일로 찍혔다.**
          // 🔴 **출하 완료 전이와 같은 값이어야 한다**(mutations/workflow-transitions.ts).
          //    둘은 같은 사실을 두 표에 적는다 — 한쪽만 고치면 하루 어긋난다.
          today: toKstDateOnly(new Date()),
        })
      : { kind: "NONE" as const };

    // 🔴 차례(display_order)로 집는다 — 승인이 회차를 가리키는 값과 **같은 번호**다
    //    (schema/repair-case-approvals.ts 의 due_date_row_order 주석).
    // 🔵 납품일은 **쓸 때만** 목록에 넣는다 — `undefined` 를 섞으면 drizzle 이 그
    //    칸을 SET 에서 빼므로 동작은 같지만, 조건을 눈에 보이게 적어 둔다.
    await tx
      .update(domesticOrderDueDates)
      .set({
        completedAt: params.completed ? now : null,
        completedBy: params.completed ? params.actorUserId : null,
        ...(deliveredStamp.kind === "WRITE" ? { deliveredDate: deliveredStamp.date } : {}),
        updatedAt: now,
      })
      .where(
        and(
          eq(domesticOrderDueDates.domesticOrderId, current.id),
          eq(domesticOrderDueDates.displayOrder, params.dueDateRowOrder)
        )
      );

    // ── 🔴 줄의 완료를 **회차들의 결과에 맞춘다** (결정 8) ──────────────
    // 방금 쓴 값을 포함해 다시 센다 — 손으로 셈을 맞추면 「막 지운 회차」 같은 자리에서
    // 어긋난다.
    const allCompleted = rows.every(
      (row, rowIndex) => (rowIndex === index ? params.completed : row.completedAt !== null)
    );
    const nextLineCompleted = allCompleted;
    const lineIsCompleted = current.completedAt !== null;
    if (nextLineCompleted !== lineIsCompleted) {
      await tx
        .update(domesticOrders)
        .set({
          completedAt: nextLineCompleted ? now : null,
          completedBy: nextLineCompleted ? params.actorUserId : null,
          // 🔴 **version 을 올리지 않는다**(머리말의 그 한 줄). 올리면 남은 회차의
          //    승인이 전부 STALE 이 된다.
          updatedAt: now,
          updatedBy: params.actorUserId,
        })
        .where(eq(domesticOrders.id, current.id));
    }

    return { ok: true, id: current.id, version: current.version };
  });
}

/**
 * 🔴 그 줄이 **화면에 빌려 그리고 있는 날짜** — 연결된 수리 건의 고객 요청 납기일
 * (2026-11-25). 빌릴 것이 없으면 null 이다.
 *
 * 🔴 **화면이 보는 그 칸을 그대로 읽는다**(requested-due-date-link.ts 의
 * resolveDomesticOrderDueDateDisplay 가 보는 값). 공백만 적힌 값을 없는 것으로 접는
 * 것도 그쪽과 같은 함수로 한다 — 다르게 접으면 화면에는 안 보이는 날짜가 회차로
 * 태어난다.
 *
 * 🔴 **휴지통에 든 건을 거르지 않는다.** 이 파일의 묶기 둘은 `is_deleted = false` 를
 * 걸지만(그쪽은 **쓰는** 일이라 화면 어디에도 없는 건의 칸을 바꾸면 안 된다), 이쪽은
 * **읽는** 일이고 기준은 「사람이 그 줄에서 보고 있는 날짜가 무엇인가」다. 목록 조회가
 * 수리 건을 지워짐 여부로 거르지 않으므로(queries/domestic-orders.ts 의 leftJoin),
 * 여기서만 거르면 **화면에는 날짜와 단추가 보이는데 누르면 「날짜가 없다」고 답하는**
 * 줄이 생긴다.
 *
 * 🔴 **잠근 채 읽는다.** 잠그는 차례는 이 파일의 묶기 둘과 같다 — **내자 줄 먼저,
 * 수리 건 나중**(부르는 쪽이 이미 그 줄을 `FOR UPDATE` 로 쥐고 있다). 거꾸로 적으면
 * 두 사람이 같은 건을 동시에 고칠 때 교착이 난다. 읽기만 하는데도 잠그는 까닭은,
 * 읽은 뒤 커밋까지 사이에 수리 건 쪽이 그 날짜를 고치면 **아무도 본 적 없는 날짜**가
 * 확정된 회차로 남기 때문이다.
 */
async function readBorrowedDueDate(tx: Tx, repairCaseId: string | null): Promise<string | null> {
  if (repairCaseId === null) return null;
  const [target] = await tx
    .select({ customerRequestedDueDate: repairCases.customerRequestedDueDate })
    .from(repairCases)
    .where(eq(repairCases.id, repairCaseId))
    .for("update");
  if (!target) return null;
  return foldBlankToNull(target.customerRequestedDueDate);
}

/**
 * 회차별 [납기일 확정]의 결과. 🔴 **완료 쪽 타입을 쓰지 않는다** — 그쪽에는
 * `APPROVAL_REQUIRED` 가 들어 있는데, 확정은 **승인과 아무 상관이 없다**(승인은
 * 「내보내도 되는가」이고 확정은 「이 날짜가 더 이상 안 바뀐다」이다). 끼워 두면
 * 「확정하려는데 승인이 없다고 거절당했다」가 타입상 말이 되어 버리고, 그 가능성을
 * 부르는 쪽들이 저마다 가려내야 한다(이 파일의 다른 코드 묶음들과 같은 판단).
 *
 * 🔵 `FORBIDDEN` 은 들어 있다 — **완료된 줄을 건드리는 일**이라 그 관문이 선다
 * (아래 setDomesticOrderDueDateRowConfirmation 의 그 자리).
 */
export type DomesticOrderDueDateRowConfirmationMutationResult =
  | { ok: true; id: string; version: number }
  | { ok: false; code: DomesticOrderUpdateMutationResultCode; message: string };

/**
 * ============================================================================
 * 🔴 **회차 하나의 납기일을 확정하거나 그 확정을 거둔다** (2026-11-25)
 * ============================================================================
 * 사용자 요구 원문: 「납기 요청일 옆에 **[납기일 확정] 버튼**을 만들어줘 … 이 버튼을
 * 누르면 포털의 알림 중에 **[납기 임박] 알림이 뜨지 않도록** 해줘.」
 *
 * 🔴 **[확정 해제]가 함께 있는 까닭**: 사용자 요구에는 「확정」만 있지만, 화면에서
 * 뺄 수 없는 값으로 문을 열면 **잘못 누른 것을 되돌릴 길이 없다.** 게다가 확정은
 * 날짜를 잠그므로(아래), 해제가 없으면 **그 회차의 납기요청일을 영영 못 고친다.**
 *
 * ── 🔴 **기타건 전용이 아니다** — 회차 완료와 갈리는 자리 ────────────────
 * 회차별 [완료 처리]는 기타건 전용이다(수리 건이 붙은 줄의 완료는 출하 완료와 함께
 * 움직이는 다른 흐름이라, 그 줄에 회차 단위 길을 열면 뒷문이 된다). 확정에는 그런
 * 짝이 **없다** — 수리 건 쪽에 「납기일을 확정했다」에 해당하는 상태가 없고, 끄는
 * 것도 종 하나뿐이라 함께 움직일 전이가 없다. 사용자 결정도 **모든 줄**이다
 * (「모든 줄에 단추(기타건 포함)」). 그래서 `repair_case_id` 를 보지 않는다.
 * 🔵 수리 건이 제 날짜를 가진 줄(빌려 그리는 줄)에서도 끈다 — 같은 결정의 ⑤.
 *
 * ── 🔴 **`version` 을 올리지 않는다** — 회차 완료와 같은 한 줄 ────────────
 * 올리면 그 줄에 걸려 있는 회차별 승인이 **전부 STALE** 이 된다(승인의 유효함은
 * 「요청 때의 version == 지금 version」이다 — resolveApprovalState). 납기일을
 * 확정했다고 「요청 뒤에 내용이 바뀌었는가」의 답이 달라질 이유가 없다.
 * 🔵 낙관적 잠금은 그대로다 — 들어온 `expectedVersion` 은 여전히 대조한다.
 *
 * ── 🔵 **끊긴 요청을 다시 보내도 안전하다** ─────────────────────────────
 * 이 조작은 **같은 값을 두 번 써도 결과가 같다**(확정 → 확정은 시각만 다시 찍힌다).
 * version 을 올리지 않으므로 두 번째 요청이 CONFLICT 로 떨어지지도 않는다 — 응답을
 * 못 받은 사람이 다시 누르면 그대로 성공한다. 회차 완료가 쓰는 그 성질 그대로이고,
 * 이 저장소가 따로 두는 멱등 열쇠(idempotency-keys)는 **돈이 움직이는 길**의 것이다.
 *
 * ── 🔴 **완료된 줄에는 관문이 하나 더 선다** (「완료 시 수정」) ────────────
 * 🔴 여기서 **회차 완료와 다르게 갔다.** 회차 완료는 그 관문을 `!completed`(해제)
 * 에만 세우는데, 그쪽은 「회차 해제가 줄 단위 해제의 뒷문이 되는 것」을 막는 관문이라
 * 방향이 열쇠였다. 확정에는 그런 뒷문이 없고, 대신 **줄 수정과 같은 성질**이 있다:
 * 확정도 해제도 **완료된 줄의 칸을 바꾸는 일**이다. 그래서 조건을 updateDomesticOrder
 * 와 **한 글자도 같게** 두었다 — 「그 줄이 완료되었는가」. 갈라 두면 완료된 줄을 못
 * 고치는 사람이 **확정 단추로 그 줄의 납기일을 잠그고 풀 수 있다.**
 * 🔵 **완료되지 않은 줄은 한 글자도 달라지지 않는다**(관문이 그 조건 안에만 선다).
 * 🔵 화면도 같은 판정으로 단추를 감춘다(canEditDomesticOrderWhenCompleted — 목록의
 * `rowCanEdit` 과 같은 값이다).
 *
 * ── 🔴 **빌려 온 날짜에서도 확정한다 — 그때는 회차를 만든다** (2026-11-25) ──
 * 납기요청일 행이 **하나도 없는** 줄은 연결된 수리 건의 고객 요청 납기일을 화면에
 * 대신 그린다(domain/requested-due-date-link.ts 의 resolveDomesticOrderDueDateDisplay).
 * 날짜는 보이는데 **적을 자리가 없어** 확정이 안 됐다. 사용자 결정이 그것을 뒤집었다:
 * 「[내자정리]에서 **[수리건 요청일]도** 내자정리에서 작성한 [납기요청일]과 **같은
 * 취급**을 해줘.」 그래서 그 줄에서 확정을 누르면 **그 날짜로 1차 회차를 만들어
 * 확정까지 한다.**
 *
 * 🔴 **날짜는 서버가 제 손으로 읽는다** — 화면이 보낸 날짜를 받지 않는다. 받으면
 * 「발주서에 적힌 날짜」 자리에 브라우저가 보낸 아무 날짜나 박을 수 있다. 읽는 곳은
 * 화면이 빌려 그릴 때와 **같은 칸**(repair_cases.customer_requested_due_date)이라,
 * 생긴 회차의 날짜는 **사람이 그 줄에서 보고 있던 바로 그 날짜**다.
 *
 * 🔴 **「수리 건 요청일」 꼬리표가 사라지는 것은 받아들인 결과다**(사용자 결정
 * 2026-11-25): 「난 애초에 [수리 건 요청일] 표시가 필요 없다고 생각했어. 난 [수리건
 * 상세]와 [내자정리]의 [납기 요청일]이 **완벽히 동기화** 되는 걸 바랬어.」 그 꼬리표가
 * 뜨는 조건은 「이 줄에 회차가 0개다」 하나뿐이라, 회차가 생기면 저절로 사라진다.
 * 🔴 **출처 칸을 만들지 않았다** — 칸을 만들면 표를 고치는 일(마이그레이션)이고,
 * 사용자가 바란 것은 출처 표시가 아니라 **두 화면이 같은 날짜를 드는 것**이다.
 *
 * 🔴 **줄 저장 통로(updateDomesticOrder)를 태우지 않는다.** 그 길은 ① 줄의 version 을
 * 올려 그 줄의 회차별 승인을 **전부 STALE** 로 만들고(바로 위 문단), ② 묶기를 깨워
 * 수리 건을 다시 보게 하는데 — 그 건에 내자 줄이 여럿이면 **「어느 날짜인지 몰라 못
 * 맞췄다」 알림**이 뜬다(domain/requested-due-date-link.ts 머리말 ④). 아무것도 바꾸지
 * 않는 저장에 경고가 뜨는 셈이다. 여기서 직접 넣으면 둘 다 일어나지 않는다.
 * 🔵 **묶기를 건너뛰어도 두 표는 안 어긋난다** — 넣는 값이 **수리 건 쪽 값 그대로**라
 * 수리 건에 고칠 것이 애초에 없다(그 길을 태웠어도 그 판정은 NONE 이다).
 *
 * ── 🔴 **이 조각은 종을 끄지 않는다** ───────────────────────────────────
 * 확정 두 칸이 차는 것이 전부다. 「납기 임박」 알림이 그 값을 보고 빠지는 일은 **다음
 * 조각**이 한다(domain/notifications.ts · queries/domestic-order-due-date-near-
 * notifications.ts). 그래서 지금은 **확정해도 종이 울리는 것이 맞다.**
 * ============================================================================
 */
export async function setDomesticOrderDueDateRowConfirmation(params: {
  id: string;
  expectedVersion: number;
  /** 몇 번째 회차인가(1부터). `display_order` 와 같은 번호다. */
  dueDateRowOrder: number;
  /** true 면 그 회차의 납기일을 확정, false 면 확정 해제. */
  confirmed: boolean;
  actorUserId: string;
}): Promise<DomesticOrderDueDateRowConfirmationMutationResult> {
  return db.transaction(
    async (tx): Promise<DomesticOrderDueDateRowConfirmationMutationResult> => {
      const [current] = await tx
        .select({
          id: domesticOrders.id,
          version: domesticOrders.version,
          // 🔴 「완료 시 수정」 관문이 보는 한 칸(머리말). 판정은 completed_at 하나로만
          //    한다(schema/domestic-orders.ts 의 그 칸 주석).
          completedAt: domesticOrders.completedAt,
          // 🔴 **빌려 온 날짜를 읽으러 갈 길**(2026-11-25, 머리말). 연결이 없으면
          //    빌릴 곳도 없다.
          repairCaseId: domesticOrders.repairCaseId,
        })
        .from(domesticOrders)
        .where(and(eq(domesticOrders.id, params.id), eq(domesticOrders.isDeleted, false)))
        .for("update");

      if (!current) {
        return { ok: false, code: "NOT_FOUND", message: NOT_FOUND_MESSAGE };
      }
      if (current.version !== params.expectedVersion) {
        return { ok: false, code: "CONFLICT", message: VERSION_CONFLICT_MESSAGE };
      }

      // 🔴 **version 대조 뒤**다 — 앞에 두면 낡은 화면에서 누른 요청이 CONFLICT 대신
      //    「권한이 없다」로 답한다(updateDomesticOrder 가 같은 차례를 쓰는 그 까닭).
      if (current.completedAt !== null) {
        const denied = await checkCompletedDomesticOrderEdit(tx, params.actorUserId);
        if (denied) return denied;
      }

      // 🔴 **잠근 줄에서 다시 읽는다.** 화면이 보낸 회차 번호가 지금도 있는 번호인지는
      //    여기서만 알 수 있다(회차 완료와 같은 까닭·같은 차례).
      const rows = await readDueDateRows(tx, current.id);
      if (rows.length === 0) {
        // ── 🔴 **빌려 온 날짜에서 누른 것이다** (2026-11-25, 머리말) ───────────
        // 적어 둔 회차가 없을 때만 오는 길이다. 화면은 이때 연결된 수리 건의 고객
        // 요청 납기일을 대신 그리고 있고, 그 날짜로 **1차 회차를 만들어 확정한다.**
        //
        // 🔴 **해제는 이 길로 오지 않는다** — 없는 회차의 확정을 푼다는 말이 성립하지
        //    않는다. 회차 번호가 1 이 아닌 것도 같다(만들 자리는 1차 하나뿐이다).
        //    둘 다 「그 회차가 없다」이므로 아래 번호 검사와 **같은 말**을 쓴다.
        if (!params.confirmed || params.dueDateRowOrder !== 1) {
          return {
            ok: false,
            code: "VALIDATION_ERROR",
            message: "그 회차를 찾을 수 없습니다. 최신 정보를 다시 불러와 주세요.",
          };
        }
        const borrowed = await readBorrowedDueDate(tx, current.repairCaseId);
        // 🔴 빌릴 날짜도 없으면 **적을 날짜 자체가 없다** — 화면에도 "-" 만 보이고
        //    단추가 안 선다. 여기 오는 것은 낡은 화면뿐이라 하던 말을 그대로 한다.
        if (borrowed === null) {
          return {
            ok: false,
            code: "VALIDATION_ERROR",
            message:
              "납기요청일 줄이 없어 납기일을 확정할 수 없습니다. 먼저 납기요청일을 적어 주세요.",
          };
        }
        // 🔴 **비고는 비워 둔다.** 아무도 적은 적 없는 글을 지어내면, 다음에 그 줄을
        //    보는 사람이 자기가 적은 메모로 읽는다. 🔵 납품 두 칸도 같다.
        const createdAt = new Date();
        await tx.insert(domesticOrderDueDates).values({
          domesticOrderId: current.id,
          dueDate: borrowed,
          displayOrder: 1,
          confirmedAt: createdAt,
          confirmedBy: params.actorUserId,
        });
        // 🔴 **줄(domestic_orders)은 여기서도 한 글자도 안 건드린다** — 아래 평범한
        //    확정과 같은 까닭이다(그 자리의 주석). 🔵 그래서 **열려 있던 내자 정리
        //    화면**은 낡은 version 으로도 저장할 수 있는데, 그 저장은 회차를 0개로
        //    되돌리려 하므로 **넷째 울타리가 거절한다**(확정된 회차가 있는데 줄이
        //    줄어드는 저장 — domain/domestic-order-due-date-rows.ts). 조용히 덮이지
        //    않는다.
        return { ok: true, id: current.id, version: current.version };
      }
      const index = params.dueDateRowOrder - 1;
      if (!Number.isInteger(params.dueDateRowOrder) || index < 0 || index >= rows.length) {
        return {
          ok: false,
          code: "VALIDATION_ERROR",
          message: "그 회차를 찾을 수 없습니다. 최신 정보를 다시 불러와 주세요.",
        };
      }

      // 🔴 **두 칸은 언제나 함께 움직인다** — 표의 CHECK 가 그것을 지킨다
      //    (domestic_order_due_dates_confirmed_columns_together). 한쪽만 쓰면 저장이
      //    통째로 깨지고, 깨지지 않더라도 「확정한 사람은 있는데 시각은 없는」 행에서는
      //    그 회차가 확정인지 아닌지 답할 방법이 없다(판정은 confirmed_at 하나다).
      // 🔵 차례(display_order)로 집는다 — 화면의 「N차」와 같은 번호다.
      const now = new Date();
      await tx
        .update(domesticOrderDueDates)
        .set({
          confirmedAt: params.confirmed ? now : null,
          confirmedBy: params.confirmed ? params.actorUserId : null,
          updatedAt: now,
        })
        .where(
          and(
            eq(domesticOrderDueDates.domesticOrderId, current.id),
            eq(domesticOrderDueDates.displayOrder, params.dueDateRowOrder)
          )
        );

      // 🔴 **줄(domestic_orders)은 한 글자도 안 건드린다.** 회차 완료는 「모든 회차가
      //    끝나면 줄도 완료」라는 결정이 있어 줄까지 고쳤지만(결정 8), 확정에는 그런
      //    짝이 없다 — 「모든 회차가 확정되면 줄이 무엇이 되는가」는 아무도 정한 적이
      //    없고, 지어내면 그 뜻을 아무도 설명할 수 없다. updated_at 도 올리지 않는다:
      //    이 조작은 줄의 값을 바꾸지 않았다.
      return { ok: true, id: current.id, version: current.version };
    }
  );
}

/**
 * 기타건의 [완료] 관문 — 막혔으면 거절을, 통과면 `null` 을 돌려준다.
 *
 * 🔴 **판정을 여기 적지 않는다.** 「어느 상태가 통과인가」는 도메인 함수 하나이고
 * (resolveMiscCaseCompletionGate), 「승인이 지금 내용에 유효한가」는 접수 건 승인
 * 카드·결재 대기 조회가 쓰는 그 함수 하나다(resolveApprovalState). 여기서 하는 일은
 * **그 둘이 볼 자료를 트랜잭션 안에서 읽어다 주는 것**뿐이다.
 *
 * 🔴 **회차마다 가장 최근 결재 행 하나씩**(2026-11-08). 다단계 결재선은 단계마다 행을
 * 하나씩 잇는 구조라 **그 회차**의 지금 상태는 언제나 그 회차의 마지막 행이 말한다.
 * 「가장 최근」의 정의(`requested_at` 내림차순)는 상세 [승인] 탭이 쓰는 조회와 **같아야
 * 한다**(queries/domestic-order-approvals.ts) — 갈리면 화면은 「승인 완료」라는데 저장은
 * 거절하는 상태가 된다. 🔴 **회차를 가르는 칸도 같아야 한다**(`due_date_row_order`).
 *
 * 🔴 **보는 회차는 부르는 쪽이 정한다**(`units`). 줄 전체를 끝내는 길은 전부를 넘기고,
 * 회차 하나를 끝내는 길은 그 하나만 넘긴다 — 여기서 「무엇을 봐야 하는가」까지 정하면
 * 두 길이 같은 함수를 부르면서 서로 다른 뜻을 갖게 된다.
 * 🔴 **먼저 막히는 회차를 말한다** — 차례대로 보고 처음 걸린 것에서 멈춘다. 전부
 * 모아서 말하면 문장이 길어지고, 사람이 해야 할 다음 행동은 어차피 하나씩이다.
 *
 * 🔴 **「회차 이름을 말할까」도 부르는 쪽이 정한다**(`nameTheRow`). 넘긴 `units` 의
 * 길이로 가리면 **회차 하나를 끝내는 길에서 영영 이름이 안 나온다** — 그 길은 언제나
 * 단위 하나만 넘기기 때문이다. 묻는 것은 「몇 개를 보고 있나」가 아니라 **「그 줄에
 * 회차가 여럿인가」**이고, 그 답은 줄을 읽은 부르는 쪽만 안다.
 *
 * 🔵 결재선 판은 **막힌 뒤에만** 읽는다. 통과하는 줄에서는 질의가 한 벌 덜 돈다.
 */
async function checkMiscCaseCompletionApproval(
  tx: Tx,
  domesticOrderId: string,
  currentVersion: number,
  units: readonly DomesticOrderDueDateUnit[],
  /**
   * 🔴 막힌 회차의 **이름을 문장에 넣을까.** 그 줄에 회차가 여럿일 때만 참이다 —
   * 하나뿐이면 붙일 말이 없고, 붙이면 2026-11-07 부터 쓰던 문장이 까닭 없이 길어진다
   * (그 문장을 글자로 재는 시험도 그대로 남는다).
   */
  nameTheRow: boolean
): Promise<{ ok: false; code: "APPROVAL_REQUIRED"; message: string } | null> {
  // 🔴 질의 하나로 그 줄의 결재 행을 통째로 걷어 온다 — 회차마다 질의를 던지면 회차가
  //    늘어날수록 질의가 늘고(N+1), 그 사이 트랜잭션이 잡는 시간도 함께 는다.
  const rows = await tx
    .select({
      dueDateRowOrder: repairCaseApprovals.dueDateRowOrder,
      status: repairCaseApprovals.status,
      versionAtRequest: repairCaseApprovals.repairCaseVersionAtRequest,
    })
    .from(repairCaseApprovals)
    .where(eq(repairCaseApprovals.domesticOrderId, domesticOrderId))
    .orderBy(desc(repairCaseApprovals.requestedAt));

  // 🔴 **먼저 온 것이 이긴다** — 위 정렬이 최신을 맨 앞에 둔다(조회 쪽
  //    loadDomesticOrderApprovalStates 와 같은 담기 방식이다).
  const latestByRow = new Map<number, { status: "REQUESTED" | "APPROVED" | "REJECTED"; versionAtRequest: number }>();
  for (const row of rows) {
    // 기타건 행에는 언제나 값이 있다(표의 CHECK). 타입이 그것을 모를 뿐이다.
    if (row.dueDateRowOrder === null) continue;
    if (latestByRow.has(row.dueDateRowOrder)) continue;
    latestByRow.set(row.dueDateRowOrder, {
      status: row.status,
      versionAtRequest: row.versionAtRequest,
    });
  }

  const states: ShipmentApprovalState[] = units.map((unit) => {
    const latest = latestByRow.get(unit.rowOrder) ?? null;
    return resolveApprovalState(
      // 칸 이름이 `repairCase…` 인 까닭은 표의 그 칸 주석에 있다 — 기타건 행에는 내자
      // 줄의 판 번호가 들어 있다.
      latest ? { status: latest.status, repairCaseVersionAtRequest: latest.versionAtRequest } : null,
      currentVersion
    );
  });

  // 🔴 **접는 규칙을 여기 적지 않는다** — 목록 배지·머리 카드 배지가 쓰는 그 함수
  //    하나다(foldDomesticOrderApprovalStates). 두 곳에 적으면 같은 줄이 목록에서는
  //    「출하 대기」인데 눌러 보면 거절되는 상태가 된다.
  if (foldDomesticOrderApprovalStates(states) === "APPROVED") return null;
  const blockedIndex = states.findIndex((state) => state !== "APPROVED");
  const approvalState = states[blockedIndex];
  const blockedLabel = nameTheRow ? units[blockedIndex].label : null;

  // 🔴 **공유 잠금을 잡지 않는다.** 결재 요청 경로는 「판 잠금 → 줄 잠금」 차례로
  //    잡는데(mutations/domestic-order-approvals.ts), 여기는 줄을 이미 잡고 있다 —
  //    같은 잠금을 여기서 또 잡으면 차례가 뒤집혀 두 트랜잭션이 서로를 기다린다.
  //    이 읽기는 **무슨 말을 할지**만 정하므로 그 보증이 필요하지 않다.
  const route = await getCurrentShipmentApprovalRouteChain(tx, DOMESTIC_ORDER_APPROVAL_ROUTE_SCOPE);
  const gate = resolveMiscCaseCompletionGate({
    approvalState,
    routeInForce: isDomesticOrderApprovalRouteInForce(route),
    // 🔴 회차가 하나뿐이면 `null` 이고, 그때 문장은 2026-11-07 의 것과 한 글자도
    //    다르지 않다(위 nameTheRow).
    dueDateRowLabel: blockedLabel,
  });
  // 🔵 APPROVED 는 위에서 이미 돌아갔으므로 여기서 통과가 나오는 길은 없다. 그래도
  //    `allowed` 를 보고 가른다 — 통과 조건이 도메인 한 곳에만 적혀 있어야 한다.
  if (gate.allowed) return null;
  return { ok: false, code: "APPROVAL_REQUIRED", message: gate.message };
}
