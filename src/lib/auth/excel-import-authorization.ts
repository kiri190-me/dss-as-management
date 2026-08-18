import type { Role } from "@/lib/domain/types";

/** Excel Import is an administrative data-migration capability. */
export function canManageExcelImports(role: Role): boolean {
  return role === "SUPER_ADMIN" || role === "ADMIN";
}
