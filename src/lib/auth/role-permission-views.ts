import "server-only";

import { ROLE_CODES, type Role } from "@/lib/domain/types";
import { PERMISSION_AREAS, type PermissionLevel } from "./permission-areas";
import { PERMISSION_LEAF_KEYS } from "./permission-features";
import { baselineLeafLevel } from "./permission-baseline";
import { resolveEffectivePermissions, roleOnlyActor } from "./permission-resolver";

export type RolePermissionView = {
  /** 잎 키 → 지금 통하는 값. */
  effective: Record<string, PermissionLevel>;
  /**
   * 잎 키 → 기본 정책 값(지금 코드가 이 역할에게 허용하는 것).
   *
   * 화면이 "기본에서 바뀐 칸"을 표시하고, 최고관리자에게만 이 값 위의 선택지를
   * 여는 데 쓴다. 서버에서 계산해 내려보내는 이유: 화면에서 다시 계산하면
   * 저장할 때 쓰는 값과 두 벌이 되고, 어긋나는 순간 "고를 수는 있는데 저장하면
   * 깎이는" 화면이 된다.
   */
  baseline: Record<string, PermissionLevel>;
  /** 메뉴 키 → 지금 통하는 메뉴 수준(하위 기능의 최대값). 메뉴가 열려 있는지 표시용. */
  areaEffective: Record<string, PermissionLevel>;
};

export type RolePermissionScreenData = {
  roles: Record<Role, RolePermissionView>;
  /**
   * 기본 정책보다 높은 수준을 저장할 수 있는가 — 최고관리자만이다.
   *
   * 관리자에게는 기본 정책 위의 선택지를 아예 만들지 않는다. 고를 수는 있는데
   * 저장하면 깎이는 화면은, 고른 사람에게 무언가 됐다고 믿게 한다.
   */
  canWiden: boolean;
};

/**
 * 권한 설정 화면이 그릴 자료.
 *
 * 잎(하위 기능) 단위로 내려보낸다 — 저장·판정이 그 단위이므로, 화면도 같은
 * 단위로 다뤄야 "화면에서 본 것"과 "저장된 것"이 어긋나지 않는다. 메뉴 수준은
 * 계산 결과일 뿐이라 편집 대상이 아니고, 메뉴가 열려 있는지 보여 주는 데만 쓴다.
 *
 * ── 개발자 승격이 닿지 않는 자리 ────────────────────────────────────────
 * 이 표는 **역할 자체의 권한**을 보여 준다. 보는 사람이 개발자든 아니든 같은
 * 표여야 한다 — 그래서 roleOnlyActor()로 부른다. 여기서 승격이 일어나면
 * 개발자가 이 화면을 열 때만 다섯 역할이 전부 「모든 권한 있음」으로 보이고,
 * 관리자는 그 표를 보고 권한을 판단한다.
 *
 * 개발자 표시는 이 화면에서 켤 수 없다 — 역할별 설정과 무관한 사람 단위 칸이다.
 */
export async function buildRolePermissionViews(params: {
  actorRole: Role;
}): Promise<RolePermissionScreenData> {
  const entries = await Promise.all(
    ROLE_CODES.map(async (role) => {
      const resolved = await resolveEffectivePermissions(roleOnlyActor(role));

      const baseline: Record<string, PermissionLevel> = {};
      for (const leafKey of PERMISSION_LEAF_KEYS) {
        baseline[leafKey] = baselineLeafLevel(leafKey, role);
      }

      const areaEffective: Record<string, PermissionLevel> = {};
      for (const area of PERMISSION_AREAS) {
        areaEffective[area.key] = resolved.levels[area.key] ?? "NONE";
      }

      return [role, { effective: resolved.leafLevels, baseline, areaEffective }] as const;
    })
  );

  return {
    roles: Object.fromEntries(entries) as Record<Role, RolePermissionView>,
    canWiden: params.actorRole === "SUPER_ADMIN",
  };
}
