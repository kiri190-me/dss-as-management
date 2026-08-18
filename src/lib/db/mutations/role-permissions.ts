import "server-only";

import { and, eq } from "drizzle-orm";
import { db } from "../client";
import { rolePermissions, users } from "../schema";
import { insertAuditLog } from "./audit-logs";
import {
  PERMISSION_AREAS,
  isPermissionLevel,
  isRoleEditableInPermissionSettings,
  meetsPermissionLevel,
  permissionLevelRank,
  type PermissionLevel,
} from "@/lib/auth/permission-areas";
import { baselinePermissionLevel } from "@/lib/auth/permission-baseline";
import type { Role } from "@/lib/domain/types";

export type SaveRolePermissionsResult =
  | { ok: true; changedCount: number }
  | { ok: false; code: "FORBIDDEN" | "INVALID_INPUT" | "LOCKOUT"; message: string };

/**
 * ============================================================================
 * 역할 권한 설정 저장
 * ============================================================================
 * 화면이 보낸 값을 그대로 믿지 않는다. 특히 아래 세 가지는 화면에서도 막지만
 * 여기서 다시 막는다 — 화면을 거치지 않고 이 액션을 부를 수 있기 때문이다.
 *
 *  1) 상한을 넘는 수준: 조용히 상한으로 깎는다. 거절하지 않는 이유는, 코드의
 *     정책이 나중에 좁아지면 예전에 저장해 둔 값이 자동으로 상한을 넘게 되는데
 *     그때마다 저장이 실패하면 화면을 아예 쓸 수 없게 되기 때문이다.
 *  2) 최고관리자 줄 편집: 거절한다. 되돌릴 사람을 남겨 두기 위한 것이다.
 *  3) 스스로를 잠그는 저장: 거절한다(아래 assertNoLockout).
 * ============================================================================
 */
export async function saveRolePermissions(params: {
  role: Role;
  levels: Record<string, string>;
  actorUserId: string;
}): Promise<SaveRolePermissionsResult> {
  if (!isRoleEditableInPermissionSettings(params.role)) {
    return {
      ok: false,
      code: "FORBIDDEN",
      message: "최고관리자의 권한은 바꿀 수 없습니다. 모두를 잠그면 되돌릴 사람이 남지 않습니다.",
    };
  }

  return db.transaction(async (tx): Promise<SaveRolePermissionsResult> => {
    const [actor] = await tx
      .select({ id: users.id, role: users.role, approvalStatus: users.approvalStatus })
      .from(users)
      .where(and(eq(users.id, params.actorUserId), eq(users.isDeleted, false)));
    if (!actor || actor.approvalStatus !== "APPROVED") {
      return { ok: false, code: "FORBIDDEN", message: "사용자 정보를 확인할 수 없습니다." };
    }
    if (actor.role !== "SUPER_ADMIN" && actor.role !== "ADMIN") {
      return { ok: false, code: "FORBIDDEN", message: "관리자 이상만 권한을 설정할 수 있습니다." };
    }

    // 화면이 보낸 값을 영역 목록 기준으로 정규화한다. 목록에 없는 키는 버리고,
    // 빠진 영역은 상한(= 설정 없음)으로 둔다.
    const normalized: { areaKey: string; level: PermissionLevel }[] = [];
    for (const area of PERMISSION_AREAS) {
      const raw = params.levels[area.key];
      if (raw === undefined) continue;
      if (typeof raw !== "string" || !isPermissionLevel(raw)) {
        return { ok: false, code: "INVALID_INPUT", message: `권한 수준을 확인할 수 없습니다: ${area.label}` };
      }
      const ceiling = baselinePermissionLevel(area.key, params.role);
      const clamped: PermissionLevel =
        permissionLevelRank(raw) > permissionLevelRank(ceiling) ? ceiling : raw;
      normalized.push({ areaKey: area.key, level: clamped });
    }

    const lockout = assertNoLockout({
      role: params.role,
      actorRole: actor.role,
      levels: new Map(normalized.map((entry) => [entry.areaKey, entry.level])),
    });
    if (lockout) return lockout;

    // 지금 저장된 값을 먼저 읽어 둔다 — 감사 로그의 "이전 값"이자, 실제로 몇
    // 건이 달라졌는지 세기 위한 것이다.
    const existing = await tx
      .select({ id: rolePermissions.id, areaKey: rolePermissions.areaKey, level: rolePermissions.level })
      .from(rolePermissions)
      .where(eq(rolePermissions.role, params.role));
    const existingByArea = new Map(existing.map((row) => [row.areaKey, row]));

    let changedCount = 0;
    for (const entry of normalized) {
      const previous = existingByArea.get(entry.areaKey);
      const ceiling = baselinePermissionLevel(entry.areaKey, params.role);

      // 상한과 같은 값은 저장하지 않고 지운다. 설정을 "기본으로 되돌림"과
      // "기본과 같은 값을 굳이 적어 둠"이 구별되면, 나중에 코드의 정책이
      // 넓어졌을 때 후자만 옛 값에 묶여 따라오지 못한다.
      if (entry.level === ceiling) {
        if (!previous) continue;
        await tx.delete(rolePermissions).where(eq(rolePermissions.id, previous.id));
        await insertAuditLog(tx, {
          actorUserId: actor.id,
          // 설정 행은 지우지만 권한 자체가 사라지는 것이 아니라 기본값으로
          // 돌아가는 것이므로 UPDATE로 남긴다(SOFT_DELETE/PURGE는 자료가
          // 없어졌다는 뜻이라 여기서는 오해를 만든다).
          actionType: "UPDATE",
          targetEntity: "role_permissions",
          targetRecordId: previous.id,
          previousValue: { role: params.role, areaKey: entry.areaKey, level: previous.level },
          newValue: { role: params.role, areaKey: entry.areaKey, level: ceiling, revertedToDefault: true },
        });
        changedCount += 1;
        continue;
      }

      if (previous?.level === entry.level) continue;

      const [saved] = await tx
        .insert(rolePermissions)
        .values({
          role: params.role,
          areaKey: entry.areaKey,
          level: entry.level,
          updatedBy: actor.id,
        })
        .onConflictDoUpdate({
          target: [rolePermissions.role, rolePermissions.areaKey],
          set: { level: entry.level, updatedBy: actor.id, updatedAt: new Date() },
        })
        .returning({ id: rolePermissions.id });

      await insertAuditLog(tx, {
        actorUserId: actor.id,
        actionType: previous ? "UPDATE" : "CREATE",
        targetEntity: "role_permissions",
        targetRecordId: saved.id,
        // 설정이 없던 상태의 "이전 값"은 상한이다 — 실제로 그때 통하던 값이
        // 그것이므로, 로그를 읽는 사람이 무엇에서 무엇으로 바뀌었는지 알 수 있다.
        previousValue: { role: params.role, areaKey: entry.areaKey, level: previous?.level ?? ceiling },
        newValue: { role: params.role, areaKey: entry.areaKey, level: entry.level },
      });
      changedCount += 1;
    }

    return { ok: true, changedCount };
  });
}

/**
 * 되돌릴 수 없는 상태로 저장하려는 것을 막는다.
 *
 * 관리자가 자기 역할의 "사용자 관리"를 관리 미만으로 낮추면, 저장한 그 순간부터
 * 이 화면에 들어올 수 없다 — 최고관리자를 불러오는 것 말고는 방법이 없어진다.
 * 최고관리자는 이 화면에서 건드릴 수 없으므로 시스템 전체가 잠기지는 않지만,
 * 실수 한 번에 관리자 전원이 밖에 서 있게 되는 상황은 막을 가치가 있다.
 *
 * 접근 가능한 메뉴가 하나도 남지 않는 저장도 막는다. 로그인은 되는데 갈 곳이
 * 없는 계정은 고장과 구별되지 않는다.
 */
function assertNoLockout(params: {
  role: Role;
  actorRole: Role;
  levels: Map<string, PermissionLevel>;
}): SaveRolePermissionsResult | null {
  if (params.role === params.actorRole) {
    const usersLevel = params.levels.get("users");
    if (usersLevel && !meetsPermissionLevel(usersLevel, "MANAGE")) {
      return {
        ok: false,
        code: "LOCKOUT",
        message:
          "지금 사용 중인 역할의 '사용자 관리' 권한을 관리 미만으로 낮출 수 없습니다. 저장하는 순간 이 화면에 다시 들어올 수 없습니다.",
      };
    }
  }

  const anyAccessible = PERMISSION_AREAS.some((area) => {
    const chosen = params.levels.get(area.key);
    if (chosen !== undefined) return chosen !== "NONE";
    // 보내지 않은 영역은 상한 그대로다.
    return baselinePermissionLevel(area.key, params.role) !== "NONE";
  });
  if (!anyAccessible) {
    return {
      ok: false,
      code: "LOCKOUT",
      message: "접근 가능한 메뉴를 하나도 남기지 않으면 그 역할은 로그인해도 갈 곳이 없습니다.",
    };
  }

  return null;
}
