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
  return role === "AS_ENGINEER" && ctx.isOwnRequest && ctx.status === "PENDING";
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
  if (ctx.status !== "PENDING" && ctx.status !== "PARTIALLY_ISSUED") return false;
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
  if (ctx.status !== "PENDING" || ctx.issuedQuantityAcrossItems !== 0) return false;
  return role === "SUPER_ADMIN" || role === "ADMIN" || role === "INVENTORY_MANAGER";
}

/** Partial-close never deducts stock — no lock check, allowed even on a since-locked case. Requires the request to currently be PARTIALLY_ISSUED, with something already issued and something still remaining unfulfilled. */
export function canPartiallyCloseRequest(
  role: Role,
  ctx: { status: InventoryPartRequestStatus; issuedQuantityAcrossItems: number; remainingQuantityAcrossItems: number }
): boolean {
  if (ctx.status !== "PARTIALLY_ISSUED" || ctx.issuedQuantityAcrossItems <= 0 || ctx.remainingQuantityAcrossItems <= 0) return false;
  return role === "SUPER_ADMIN" || role === "ADMIN" || role === "INVENTORY_MANAGER";
}
