import type { Role } from "@/lib/domain/types";

/**
 * Centralized, server-side authorization for Product Model Management
 * (/product-models, /product-models/[id]) — pure functions of `Role`, used
 * both by the nav item / page gate and independently re-checked by
 * updateProductModelAction regardless of what the UI happened to render.
 *
 * Policy (approved scope):
 *  - View: SUPER_ADMIN/ADMIN/AS_ENGINEER/SALES, same role set as
 *    canViewCustomers. INVENTORY_MANAGER cannot access at all.
 *  - Edit (model_name/kind/manufacturer/description on the master row):
 *    SUPER_ADMIN/ADMIN only, mirroring canEditCustomers' "admin-narrow"
 *    shape for master/catalog data.
 */
export function canViewProductModels(role: Role): boolean {
  return role === "SUPER_ADMIN" || role === "ADMIN" || role === "AS_ENGINEER" || role === "SALES";
}

export function canEditProductModels(role: Role): boolean {
  return role === "SUPER_ADMIN" || role === "ADMIN";
}
