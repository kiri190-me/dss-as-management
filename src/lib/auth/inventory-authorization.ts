import type { Role } from "@/lib/domain/types";
import type { InventoryPartRequestStatus } from "@/lib/domain/inventory-types";

/**
 * Centralized, server-side authorization for inventory mutations (Phase
 * 5B-2 core ledger + Phase 5B-3 Parts Request & Issue Workflow). Same
 * convention as procedure-case-execution-authorization.ts: pure functions
 * of `Role` (plus live context where needed), used both by UI components
 * (to decide what to render) and re-checked independently by every mutation
 * in db/mutations/inventory.ts and db/mutations/inventory-part-requests.ts
 * — a hidden button here is a UX convenience only, never the enforcement
 * boundary.
 *
 * Policy:
 *  - View stock/transaction history: all 5 roles.
 *  - Create/edit part, receive stock, return stock: SUPER_ADMIN/ADMIN/
 *    INVENTORY_MANAGER only.
 *  - Direct stock USE (Phase 5B-2's consumeStock): SUPER_ADMIN/ADMIN/
 *    INVENTORY_MANAGER only, as of Phase 5B-3 — AS_ENGINEER no longer has
 *    any path to a direct USE. Their only path to consuming stock is the
 *    request/issue workflow below.
 *  - Shipment-lock removal policy: `ctx.isCaseLocked` is intentionally
 *    still accepted by canUseStock/canCreatePartRequest/canIssuePartRequest
 *    below (every call site keeps passing the real repair_cases.is_locked
 *    value, unchanged) but is no longer read by any of them — a shipped
 *    case's stock USE and part requests stay fully available. Cancel/
 *    reject/partial-close never took a lock-state parameter at all (they
 *    never deduct stock), so they are unaffected by this change. See
 *    isBlockedByShipmentLock (repair-case-edit-authorization.ts) for the
 *    full policy-change rationale.
 *  - Create/cancel a part request: AS_ENGINEER, and SUPER_ADMIN
 *    (2026-08-28). 다른 역할은 코드가 아니라 역할별 접근 권한 화면에서 연다 —
 *    최고관리자만 그 화면에서 고칠 수 없어서 여기 적혀 있다
 *    (canCreatePartRequest 주석 참조).
 *  - SALES has zero access to the request screens/actions in Phase 5B-3 —
 *    confirmed, not an oversight: read-only inventory access only (part
 *    list, balances, transaction history), same as before.
 */

export function canViewInventory(role: Role): boolean {
  return role === "SUPER_ADMIN" || role === "ADMIN" || role === "AS_ENGINEER" || role === "SALES" || role === "INVENTORY_MANAGER";
}

export function canCreateOrEditPart(role: Role): boolean {
  return role === "SUPER_ADMIN" || role === "ADMIN" || role === "INVENTORY_MANAGER";
}

export function canReceiveStock(role: Role): boolean {
  return role === "SUPER_ADMIN" || role === "ADMIN" || role === "INVENTORY_MANAGER";
}

export function canReturnStock(role: Role): boolean {
  return role === "SUPER_ADMIN" || role === "ADMIN" || role === "INVENTORY_MANAGER";
}

export function canViewTransactionHistory(role: Role): boolean {
  return canViewInventory(role);
}

/**
 * UI-visibility helper only, for the direct 사용 button on /inventory/[id].
 * As of Phase 5B-3, this is the exact same three-role list as
 * canReceiveStock/canReturnStock — AS_ENGINEER no longer sees this button
 * at all (their part-consumption path is the request workflow, surfaced
 * separately on their repair-case detail page).
 */
export function canSeeUseStockButton(role: Role): boolean {
  return role === "SUPER_ADMIN" || role === "ADMIN" || role === "INVENTORY_MANAGER";
}

/**
 * Stock USE authorization context — every field must be computed fresh
 * inside the same DB transaction as the mutation itself, never trusted from
 * the client.
 */
export type UseStockAuthorizationContext = {
  hasRepairCase: boolean;
  isCaseLocked: boolean;
};

/**
 * Direct USE (Phase 5B-2's consumeStock / Phase 5B-3-revised): SUPER_ADMIN /
 * ADMIN / INVENTORY_MANAGER may USE against any repair case (shipped or
 * not, per the shipment-lock removal policy), and may also USE with only a
 * destination_note (no repair case at all). AS_ENGINEER (and any other
 * role) is never authorized for a direct USE — their only path to
 * consuming stock is a confirmed parts-request issue (see
 * canIssuePartRequest below, which is itself also SUPER_ADMIN/ADMIN/
 * INVENTORY_MANAGER only — AS_ENGINEER never creates a USE row directly or
 * indirectly).
 */
export function canUseStock(role: Role, ctx: UseStockAuthorizationContext): boolean {
  void ctx.isCaseLocked;
  return role === "SUPER_ADMIN" || role === "ADMIN" || role === "INVENTORY_MANAGER";
}

// ---- Phase 5B-3: Parts Request & Issue Workflow ----

/**
 * AS_ENGINEER, 그리고 최고관리자. 수리 건이 반드시 있어야 하고(목적지만 적는
 * 요청은 없다), 그 건의 담당자일 필요는 없다(Parts Request permission
 * checkpoint — 출하된 건도 막지 않는다: shipment-lock removal policy).
 * **대리 작성은 여전히 없다** — 최고관리자가 올려도 자기 이름으로 올라간다.
 *
 * ── 🔴 최고관리자가 왜 코드에 적혀 있는가 ──────────────────────────────
 * inventory 는 설정이 최종 판정인 메뉴다(permission-features.ts 의
 * SETTINGS_ENFORCED_AREAS). 그래서 다른 역할에게 부품 요청을 열어 주는 일은
 * 코드를 고치지 않고 사용자 관리 > 역할별 접근 권한 > 재고 관리 > 부품 요청
 * 에서 한다 — 여기에 역할을 더 적지 말 것.
 *
 * **최고관리자 줄은 설정 화면에서 고칠 수 없다**(permission-areas.ts 의
 * isRoleEditableInPermissionSettings, 저장 액션도 거절한다 — 모두를 잠그면
 * 되돌릴 사람이 남지 않기 때문이다). 최고관리자에게는 이 기본 정책이 곧
 * 실효 권한이라, 열어 줄 자리가 여기밖에 없다(2026-08-28 사용자 요청).
 *
 * ── 자기가 올리고 자기가 출고하게 되지 않는가 ──────────────────────────
 * 된다. 다만 **새로 생기는 힘이 아니다** — 최고관리자는 이미 canUseStock 으로
 * 재고를 바로 뺄 수 있다. 요청서를 거치면 오히려 누가 무엇을 왜 가져갔는지
 * 기록이 남는 쪽이다.
 */
export function canCreatePartRequest(role: Role, ctx: { isCaseLocked: boolean }): boolean {
  void ctx.isCaseLocked;
  return role === "AS_ENGINEER" || role === "SUPER_ADMIN";
}

/**
 * 올린 사람만, 자기 요청만, 아직 아무것도 나가지 않았을 때만 — 잠긴 건이어도
 * 된다(취소는 재고를 차감하지 않는다).
 *
 * 역할 명단은 canCreatePartRequest 와 **같이 움직인다.** 올릴 수는 있는데 무를
 * 수는 없는 역할을 만들면, 잘못 올린 요청을 남에게 거부해 달라고 부탁해야 한다.
 */
export function canCancelOwnRequest(role: Role, ctx: { isOwnRequest: boolean; status: InventoryPartRequestStatus }): boolean {
  return (role === "AS_ENGINEER" || role === "SUPER_ADMIN") && isRequestCancellable(ctx);
}

/** Gates the manager request-list/management screen and "view all requests." SALES is deliberately excluded — no access to request screens in Phase 5B-3. */
export function canProcessPartRequests(role: Role): boolean {
  return role === "SUPER_ADMIN" || role === "ADMIN" || role === "INVENTORY_MANAGER";
}

/** AS_ENGINEER sees only their own requests (never SALES); the three privileged roles see all requests via canProcessPartRequests. */
export function canViewPartRequests(role: Role): boolean {
  return canProcessPartRequests(role) || role === "AS_ENGINEER";
}

/** Issue (the only action that ever deducts stock in this workflow): same three privileged roles, and only while the request is still in an issuable status — shipped or not, per the shipment-lock removal policy. */
export function canIssuePartRequest(role: Role, ctx: { isCaseLocked: boolean; status: InventoryPartRequestStatus }): boolean {
  void ctx.isCaseLocked;
  if (!isRequestIssuable(ctx)) return false;
  return role === "SUPER_ADMIN" || role === "ADMIN" || role === "INVENTORY_MANAGER";
}

/**
 * Reject never deducts stock — no lock check, allowed even on a
 * since-locked case. Only permitted for a still-PENDING request with zero
 * issued (both checked explicitly, not just inferred from one another —
 * defense-in-depth for a security-relevant check even though, by
 * construction, a request can never reach non-zero issued while still
 * PENDING). A partially issued request that will never complete uses
 * PARTIALLY_CLOSED instead.
 */
export function canRejectPartRequest(role: Role, ctx: { status: InventoryPartRequestStatus; issuedQuantityAcrossItems: number }): boolean {
  if (!isRequestRejectable(ctx)) return false;
  return role === "SUPER_ADMIN" || role === "ADMIN" || role === "INVENTORY_MANAGER";
}

/** Partial-close never deducts stock — no lock check, allowed even on a since-locked case. Requires the request to currently be PARTIALLY_ISSUED, with something already issued and something still remaining unfulfilled. */
export function canPartiallyCloseRequest(
  role: Role,
  ctx: { status: InventoryPartRequestStatus; issuedQuantityAcrossItems: number; remainingQuantityAcrossItems: number }
): boolean {
  if (!isRequestPartiallyClosable(ctx)) return false;
  return role === "SUPER_ADMIN" || role === "ADMIN" || role === "INVENTORY_MANAGER";
}

/**
 * ============================================================================
 * 맥락 조건만 따로 — "언제" 되는가
 * ============================================================================
 * 위의 can*() 함수들은 "언제"(요청이 아직 PENDING인가, 내 요청인가)와
 * "누가"(역할)를 한 몸에 담고 있었다. 역할 판정이 role_permissions 설정으로
 * 넘어가면서(permission-resolver.ts) 부르는 쪽은 둘을 따로 물어야 한다.
 *
 * 그래서 맥락 조건을 여기로 뽑고, 위의 can*() 함수들이 **이것을 불러서** 쓰도록
 * 했다. 조건을 복사해 두 벌로 만들면 한쪽만 고쳐지는 날이 오고, 권한 검사에서
 * 그런 어긋남은 조용히 뚫리는 쪽으로 기운다.
 *
 * can*() 함수들은 사라지지 않는다 — 이제 '지금 정책의 기본값'을 정하는
 * 자리이고(permission-baseline.ts가 부른다), 설정이 없을 때의 답이 된다.
 * ============================================================================
 */

/** 취소할 수 있는 상태인가 — 내 요청이고 아직 아무것도 나가지 않았을 때만. */
export function isRequestCancellable(ctx: { isOwnRequest: boolean; status: InventoryPartRequestStatus }): boolean {
  return ctx.isOwnRequest && ctx.status === "PENDING";
}

/** 출고할 수 있는 상태인가. 출고는 이 흐름에서 재고를 실제로 차감하는 유일한 조작이다. */
export function isRequestIssuable(ctx: { status: InventoryPartRequestStatus }): boolean {
  return ctx.status === "PENDING" || ctx.status === "PARTIALLY_ISSUED";
}

/** 거부할 수 있는 상태인가 — 아직 PENDING이고 나간 수량이 0일 때만. */
export function isRequestRejectable(ctx: {
  status: InventoryPartRequestStatus;
  issuedQuantityAcrossItems: number;
}): boolean {
  return ctx.status === "PENDING" && ctx.issuedQuantityAcrossItems === 0;
}

/**
 * 보류할 수 있는 상태인가 — 아직 끝나지 않았고, 이미 보류 중도 아닐 때만.
 *
 * 보류는 "지금은 처리하지 않는다"는 표시다. 이미 끝난 요청에는 걸 것이 없고,
 * 보류 중인 것을 또 보류하는 것도 뜻이 없다.
 */
export function isRequestHoldable(ctx: { status: InventoryPartRequestStatus }): boolean {
  return ctx.status === "PENDING" || ctx.status === "PARTIALLY_ISSUED";
}

/** 보류를 풀 수 있는 상태인가 — 보류 중일 때만. */
export function isRequestHoldReleasable(ctx: { status: InventoryPartRequestStatus }): boolean {
  return ctx.status === "ON_HOLD";
}

/**
 * 보류를 풀면 돌아갈 상태.
 *
 * 보류 직전 상태를 따로 저장하지 않는다. 저장해 두면 그 사이 불출이 일어났을 때
 * 옛 상태로 되돌아가 실제와 어긋난다 — 나간 수량에서 다시 구하는 편이 언제나
 * 맞다(불출된 것이 있으면 일부 불출, 없으면 요청 대기).
 */
export function statusAfterHoldRelease(ctx: { issuedQuantityAcrossItems: number }): InventoryPartRequestStatus {
  return ctx.issuedQuantityAcrossItems > 0 ? "PARTIALLY_ISSUED" : "PENDING";
}

/** 부분 마감할 수 있는 상태인가 — 일부는 나갔고 일부는 남아 있을 때만. */
export function isRequestPartiallyClosable(ctx: {
  status: InventoryPartRequestStatus;
  issuedQuantityAcrossItems: number;
  remainingQuantityAcrossItems: number;
}): boolean {
  return (
    ctx.status === "PARTIALLY_ISSUED" &&
    ctx.issuedQuantityAcrossItems > 0 &&
    ctx.remainingQuantityAcrossItems > 0
  );
}

/**
 * 부품 마스터를 휴지통으로 보내고, 되살리고, 즉시 완전삭제하는 권한.
 *
 * **등록·수정보다 좁다** — 만들고 고치는 것은 재고 담당자까지지만, 지우는
 * 것은 관리자 이상이다. 이 프로젝트가 이미 여러 번 같은 결론을 냈다:
 * End-User는 영업도 만들지만 이름 변경은 관리자만이고(customer-authorization.ts),
 * 담당자는 영업도 추가하지만 삭제는 관리자만이다. "한 일을 되돌리는 권한은
 * 그 일을 하는 권한보다 좁다"가 그 규칙이고, 여기서도 같다.
 *
 * 재고 담당자에게 열어 줘야 한다면 코드를 고치지 않아도 된다 — 최고관리자가
 * 사용자 관리 > 역할별 접근 권한에서 '부품 삭제·복원'을 열 수 있다
 * (inventory는 설정이 최종 판정인 메뉴다).
 *
 * 삭제·복원·완전삭제를 한 함수로 묶은 것도 다른 화면과 같은 이유다 — 셋을
 * 나누면 "지울 수는 있는데 되돌릴 수는 없는" 역할이 만들어진다.
 */
export function canDeleteParts(role: Role): boolean {
  return role === "SUPER_ADMIN" || role === "ADMIN";
}

// ---- 알림 (종 알림 1단계 — 처리 대기 중인 부품 요청) ----

/**
 * 처리 대기 중인 부품 요청을 종 알림으로 받는 역할.
 *
 * 왜 이 셋인가 — 부품을 실제로 불출하는 사람(INVENTORY_MANAGER)과, 그것이
 * 밀려 있을 때 나서야 하는 사람(ADMIN·SUPER_ADMIN)이다. 요청을 올리는 쪽인
 * AS_ENGINEER는 자기 요청의 진행을 접수 건 상세에서 이미 보고 있고(내 요청
 * 목록), 남이 올린 요청까지 종으로 받을 이유가 없다. SALES는 부품 요청 화면
 * 자체에 접근하지 않는다(canProcessPartRequests / canViewPartRequests와 같은
 * 판단).
 *
 * **명단으로 적는 이유**는 이 시스템의 역할에 순서가 없기 때문이다. 요청은
 * "재고 관리자 이상"이었지만 다섯 역할(SUPER_ADMIN·ADMIN·AS_ENGINEER·SALES·
 * INVENTORY_MANAGER)은 평평해서 "이상"을 계산할 기준선이 없다 — 등급으로
 * 적으면 AS_ENGINEER·SALES가 어느 쪽에 붙는지가 코드에 안 남는다.
 *
 * canProcessPartRequests와 지금은 같은 세 역할이지만 **일부러 따로 둔다** —
 * 저쪽은 "처리해도 되는가"(인가 경계)이고 이쪽은 "끼어들어 알려도 되는가"
 * (알림 대상)다. 알림 설정 화면이 붙는 다음 단계에서 이 함수의 답이 설정의
 * **기본값**이 되고, 그때 설정으로 알림을 끈 사람이 처리 권한까지 잃으면 안
 * 된다.
 */
export function canReceivePartRequestNotifications(role: Role): boolean {
  return role === "SUPER_ADMIN" || role === "ADMIN" || role === "INVENTORY_MANAGER";
}
