import "server-only";

import { db } from "../client";
import { rolePermissions } from "../schema";
import { isPermissionAreaKey, type PermissionLevel } from "@/lib/auth/permission-areas";
import type { Role } from "@/lib/domain/types";

/** 저장된 설정만 담는다 — 행이 없는 (역할, 영역)은 여기 나오지 않는다(= 상한 그대로). */
export type StoredRolePermissions = Record<Role, Record<string, PermissionLevel>>;

const EMPTY: StoredRolePermissions = {
  SUPER_ADMIN: {},
  ADMIN: {},
  AS_ENGINEER: {},
  SALES: {},
  INVENTORY_MANAGER: {},
};

/**
 * 저장된 역할 권한 설정 전부.
 *
 * PERMISSION_AREAS에서 사라진 영역의 행은 걸러 낸다 — 메뉴가 없어진 뒤 남은
 * 행이 조회 결과에 섞이면, 화면에는 나오지 않는 설정이 판정에만 관여하는
 * 상태가 된다.
 */
export async function loadStoredRolePermissions(): Promise<StoredRolePermissions> {
  const rows = await db
    .select({ role: rolePermissions.role, areaKey: rolePermissions.areaKey, level: rolePermissions.level })
    .from(rolePermissions);

  const result: StoredRolePermissions = {
    SUPER_ADMIN: {},
    ADMIN: {},
    AS_ENGINEER: {},
    SALES: {},
    INVENTORY_MANAGER: {},
  };
  for (const row of rows) {
    if (!isPermissionAreaKey(row.areaKey)) continue;
    result[row.role][row.areaKey] = row.level;
  }
  return result;
}

/** 역할 하나만. 요청마다 부르는 경로(권한 판정)가 전체를 읽지 않게 한다. */
export async function loadStoredRolePermissionsFor(role: Role): Promise<Record<string, PermissionLevel>> {
  const all = await loadStoredRolePermissions();
  return all[role] ?? {};
}

export function emptyStoredRolePermissions(): StoredRolePermissions {
  return { ...EMPTY, SUPER_ADMIN: {}, ADMIN: {}, AS_ENGINEER: {}, SALES: {}, INVENTORY_MANAGER: {} };
}
