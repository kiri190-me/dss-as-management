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

/**
 * 제품 모델을 휴지통으로 보내고, 되살리고, 즉시 완전삭제하는 권한.
 *
 * canDeleteCustomers와 같은 판단이다 — 삭제·복원·완전삭제를 하나로 묶고
 * (셋을 나누면 "지울 수는 있는데 되돌릴 수는 없는" 역할이 생긴다), 수정
 * 권한과는 별도 함수로 둔다(권한 트리에서 productModels.edit와
 * productModels.lifecycle이 따로 여닫히기 때문).
 */
export function canDeleteProductModels(role: Role): boolean {
  return role === "SUPER_ADMIN" || role === "ADMIN";
}
