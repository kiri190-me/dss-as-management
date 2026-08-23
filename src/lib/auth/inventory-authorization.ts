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
 * AS_ENGINEER only — a repair case is required (there is no destination-only
 * request in Phase 5B-3), but assignment to that specific case is NOT
 * required (Parts Request permission checkpoint — any AS_ENGINEER may
 * submit a request for any repair case, not just their own assigned ones,
 * shipped or not per the shipment-lock removal policy). No on-behalf
 * creation (ADMIN/SUPER_ADMIN do not create a request for an engineer) —
 * deferred, out of scope.
 */
export function canCreatePartRequest(role: Role, ctx: { isCaseLocked: boolean }): boolean {
  void ctx.isCaseLocked;
  return role === "AS_ENGINEER";
}

/** AS_ENGINEER only, and only their own request, and only while it is still PENDING (zero issued) — allowed even if the case has since become locked, because cancelling never deducts stock. */
export function canCancelOwnRequest(role: Role, ctx: { isOwnRequest: boolean; status: InventoryPartRequestStatus }): boolean {
  return role === "AS_ENGINEER" && isRequestCancellable(ctx);
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
