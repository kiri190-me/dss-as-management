import "server-only";

import { db } from "../client";
import { rolePermissions } from "../schema";
import type { PermissionLevel } from "@/lib/auth/permission-areas";
import { isPermissionLeafKey } from "@/lib/auth/permission-features";
import type { Role } from "@/lib/domain/types";

/** 저장된 설정만 담는다 — 행이 없는 (역할, 잎)은 여기 나오지 않는다(= 기본값 그대로). */
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
 * 지금 트리에 없는 키의 행은 걸러 낸다 — 없어진 메뉴/기능의 행이나, 하위 기능
 * 도입 전에 저장된 메뉴 단위 행("inventory" 같은)이 여기 섞이면, 화면에는
 * 나오지 않는 설정이 판정에만 관여하는 상태가 된다.
 *
 * 이 걸러 내기가 곧 옛 메뉴 단위 행의 처리 방식이다: 무시하면 그 역할은 기본
 * 정책으로 돌아간다. 자동으로 하위 기능에 퍼뜨리지 않는 이유는, 메뉴 하나의
 * 수준을 하위 여러 칸에 복제하면 그중 어느 칸이 관리자의 뜻이었는지 알 수 없고,
 * 그 추측이 권한을 넓히는 쪽으로 틀리면 되돌릴 방법이 없기 때문이다.
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
    if (!isPermissionLeafKey(row.areaKey)) continue;
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
