import "server-only";

import { ROLE_CODES, type Role } from "@/lib/domain/types";
import { PERMISSION_AREAS, type PermissionLevel } from "./permission-areas";
import { baselinePermissionLevel } from "./permission-baseline";
import { resolveEffectivePermissions } from "./permission-resolver";

export type RolePermissionView = {
  effective: Record<string, PermissionLevel>;
  ceiling: Record<string, PermissionLevel>;
};

/**
 * 권한 설정 화면이 그릴 자료 — 역할마다 "지금 통하는 값"과 "가질 수 있는 최고
 * 수준" 두 벌.
 *
 * 상한을 화면에 함께 내려보내는 이유: 드롭다운 선택지를 화면이 직접 만들어야
 * 하는데, 그 계산에 필요한 것이 상한이기 때문이다. 상한 계산을 화면 쪽에
 * 옮겨 심으면 서버가 저장할 때 쓰는 값과 두 벌이 되고, 어긋나는 순간 "고를 수는
 * 있는데 저장하면 깎이는" 화면이 된다.
 */
export async function buildRolePermissionViews(): Promise<Record<Role, RolePermissionView>> {
  const entries = await Promise.all(
    ROLE_CODES.map(async (role) => {
      const resolved = await resolveEffectivePermissions(role);
      const ceiling: Record<string, PermissionLevel> = {};
      for (const area of PERMISSION_AREAS) {
        ceiling[area.key] = baselinePermissionLevel(area.key, role);
      }
      return [role, { effective: resolved.levels, ceiling }] as const;
    })
  );
  return Object.fromEntries(entries) as Record<Role, RolePermissionView>;
}
