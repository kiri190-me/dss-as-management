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
import {
  PERMISSION_LEAF_KEYS,
  areaLevelFromLeaves,
  findPermissionFeature,
  maxMeaningfulLevelOfLeaf,
  minMeaningfulLevelOfLeaf,
} from "@/lib/auth/permission-features";
import { baselineLeafLevel } from "@/lib/auth/permission-baseline";
import { actorMay } from "@/lib/auth/developer-promotion";
import { canManageRolePermissions } from "@/lib/auth/role-permission-authorization";
import type { Role } from "@/lib/domain/types";

export type SaveRolePermissionsResult =
  | { ok: true; changedCount: number }
  | { ok: false; code: "FORBIDDEN" | "INVALID_INPUT" | "LOCKOUT"; message: string };

/**
 * ============================================================================
 * 역할 권한 설정 저장
 * ============================================================================
 * 화면이 보낸 값을 그대로 믿지 않는다. 아래는 화면에서도 막지만 여기서 다시
 * 막는다 — 화면을 거치지 않고 이 액션을 부를 수 있기 때문이다.
 *
 *  1) **기본 정책보다 높은 수준: 최고관리자만 저장할 수 있다.** 관리자가 보낸
 *     것이면 조용히 기본 정책으로 깎는다. 이것이 넓히기의 유일한 관문이다 —
 *     이게 없으면 관리자 계정 하나가 자기 역할에 없던 권한을 스스로 만들어
 *     최고관리자까지 올라갈 수 있다.
 *  2) 의미 없는 수준: 그 기능에서 고를 수 없는 값(예: '삭제·복원'의 읽기)은
 *     접근 불가 또는 최소 의미 수준으로 정규화한다.
 *  3) 최고관리자 줄 편집: 거절한다. 되돌릴 사람을 남겨 두기 위한 것이다.
 *  4) 고정 노드: 무시한다. '역할별 접근 권한 설정'은 설정보다 위에 있어야 한다.
 *  5) 스스로를 잠그는 저장: 거절한다(아래 assertNoLockout).
 *
 * 1번에서 깎기만 하고 거절하지 않는 이유는, 코드의 정책이 나중에 좁아지면
 * 예전에 저장해 둔 값이 자동으로 기본 정책을 넘게 되는데 그때마다 저장이
 * 실패하면 화면을 아예 쓸 수 없게 되기 때문이다.
 * ============================================================================
 */
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * 거절을 트랜잭션 밖으로 던지기 위한 신호.
 *
 * 콜백에서 그냥 반환하면 트랜잭션이 **커밋된다**. 여러 역할을 한 번에 저장하는
 * 이상, 세 번째 역할에서 잠금이 걸렸는데 앞의 두 역할만 저장되는 일은 없어야
 * 한다 — 권한이 반쯤 적용된 상태는 무엇이 통하는지 아무도 모른다.
 */
class SaveRejected extends Error {
  constructor(readonly result: Extract<SaveRolePermissionsResult, { ok: false }>) {
    super(result.message);
    this.name = "SaveRejected";
  }
}

export async function saveRolePermissions(params: {
  changes: { role: Role; levels: Record<string, string> }[];
  actorUserId: string;
}): Promise<SaveRolePermissionsResult> {
  const seen = new Set<Role>();
  for (const change of params.changes) {
    if (!isRoleEditableInPermissionSettings(change.role)) {
      return {
        ok: false,
        code: "FORBIDDEN",
        message: "최고관리자의 권한은 바꿀 수 없습니다. 모두를 잠그면 되돌릴 사람이 남지 않습니다.",
      };
    }
    // 같은 역할이 두 번 오면 어느 쪽이 뜻인지 알 수 없다. 뒤엣것으로 덮어쓰면
    // 화면에서 본 것과 다른 값이 저장될 수 있으므로 거절한다.
    if (seen.has(change.role)) {
      return { ok: false, code: "INVALID_INPUT", message: "같은 역할이 두 번 들어왔습니다." };
    }
    seen.add(change.role);
  }
  if (params.changes.length === 0) return { ok: true, changedCount: 0 };

  try {
    return await db.transaction(async (tx): Promise<SaveRolePermissionsResult> => {
      const [actor] = await tx
        .select({ id: users.id, role: users.role, approvalStatus: users.approvalStatus, isDeveloper: users.isDeveloper })
        .from(users)
        .where(and(eq(users.id, params.actorUserId), eq(users.isDeleted, false)));
      if (!actor || actor.approvalStatus !== "APPROVED") {
        throw new SaveRejected({ ok: false, code: "FORBIDDEN", message: "사용자 정보를 확인할 수 없습니다." });
      }
      // 개발자 승격이 여기까지 닿아야 한다 — 액션 층(actions/role-permissions.ts)이
      // 승격된 판정으로 통과시킨 요청을 이 층이 다시 막으면, 개발자는 화면은
      // 열고 저장은 못 하는 상태가 된다. 정책 함수는 그대로 부르고 넘기는
      // 행위자만 바꾼다(developer-promotion.ts).
      if (!actorMay(actor, canManageRolePermissions)) {
        throw new SaveRejected({
          ok: false,
          code: "FORBIDDEN",
          message: "관리자 이상만 권한을 설정할 수 있습니다.",
        });
      }

      let changedCount = 0;
      for (const change of params.changes) {
        changedCount += await applyOneRole(tx, {
          role: change.role,
          levels: change.levels,
          actor: { id: actor.id, role: actor.role, isDeveloper: actor.isDeveloper },
        });
      }
      return { ok: true, changedCount };
    });
  } catch (err) {
    if (err instanceof SaveRejected) return err.result;
    throw err;
  }
}

/** 역할 하나분의 저장. 거절할 일이 생기면 SaveRejected를 던져 전체를 되돌린다. */
async function applyOneRole(
  tx: Tx,
  params: { role: Role; levels: Record<string, string>; actor: { id: string; role: Role; isDeveloper: boolean } }
): Promise<number> {
  // 기본 정책보다 높게 올릴 수 있는 사람. 이 한 줄이 넓히기의 관문이다.
  // 개발자는 최고관리자 동급이므로 더하기로 통과한다 — 화면의 canWiden
  // (role-permission-views.ts)과 같은 판정이라야 어긋나지 않는다.
  const mayWiden = actorMay(params.actor, (role) => role === "SUPER_ADMIN");

  // 화면이 보낸 값을 잎 목록 기준으로 정규화한다. 목록에 없는 키는 버리고,
  // 빠진 잎은 기본 정책(= 설정 없음)으로 둔다.
  const normalized: { areaKey: string; level: PermissionLevel }[] = [];
  for (const leafKey of PERMISSION_LEAF_KEYS) {
    const raw = params.levels[leafKey];
    if (raw === undefined) continue;

    // 고정 노드는 설정 대상이 아니다. 거절하지 않고 무시하는 이유는, 화면이
    // 전체 목록을 그대로 되보내더라도 저장이 통째로 실패하면 안 되기 때문이다.
    if (findPermissionFeature(leafKey)?.fixed) continue;

    if (typeof raw !== "string" || !isPermissionLevel(raw)) {
      throw new SaveRejected({
        ok: false,
        code: "INVALID_INPUT",
        message: `권한 수준을 확인할 수 없습니다: ${labelOf(leafKey)}`,
      });
    }

    normalized.push({
      areaKey: leafKey,
      level: normalizeLevel({ leafKey, raw, role: params.role, mayWiden }),
    });
  }

  const lockout = assertNoLockout({
    role: params.role,
    actorRole: params.actor.role,
    levels: new Map(normalized.map((entry) => [entry.areaKey, entry.level])),
  });
  if (lockout) throw new SaveRejected(lockout);

  // 지금 저장된 값을 먼저 읽어 둔다 — 감사 로그의 "이전 값"이자, 실제로 몇
  // 건이 달라졌는지 세기 위한 것이다.
  const existing = await tx
    .select({ id: rolePermissions.id, areaKey: rolePermissions.areaKey, level: rolePermissions.level })
    .from(rolePermissions)
    .where(eq(rolePermissions.role, params.role));
  const existingByArea = new Map(existing.map((row) => [row.areaKey, row]));
  const actor = params.actor;

  {
    let changedCount = 0;
    for (const entry of normalized) {
      const previous = existingByArea.get(entry.areaKey);
      const ceiling = baselineLeafLevel(entry.areaKey, params.role);

      // 기본 정책과 같은 값은 저장하지 않고 지운다. 설정을 "기본으로 되돌림"과
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

    return changedCount;
  }
}

/** 화면에 보여 줄 이름. 오류 문구가 "inventory.parts"로 나가지 않게 한다. */
function labelOf(leafKey: string): string {
  const feature = findPermissionFeature(leafKey);
  if (feature) {
    const area = PERMISSION_AREAS.find((candidate) => candidate.key === feature.areaKey);
    return area ? `${area.label} › ${feature.label}` : feature.label;
  }
  return PERMISSION_AREAS.find((candidate) => candidate.key === leafKey)?.label ?? leafKey;
}

/**
 * 보내온 수준을 저장 가능한 값으로 정규화한다.
 *
 * 순서가 중요하다. 먼저 그 기능에서 의미 있는 구간으로 자르고(고를 수 없는 값이
 * 저장되면 화면이 빈 드롭다운을 그리게 된다), 그다음에 넓히기 관문을 통과시킨다.
 * 반대로 하면 관리자가 보낸 '관리'가 최고 수준으로 잘린 뒤 기본 정책과 비교되어,
 * 막혀야 할 값이 통과하는 경우가 생긴다.
 */
function normalizeLevel(params: {
  leafKey: string;
  raw: PermissionLevel;
  role: Role;
  mayWiden: boolean;
}): PermissionLevel {
  const max = maxMeaningfulLevelOfLeaf(params.leafKey);
  const min = minMeaningfulLevelOfLeaf(params.leafKey);

  let level: PermissionLevel = params.raw;
  if (permissionLevelRank(level) > permissionLevelRank(max)) level = max;
  // 최소 의미 수준에 못 미치면 '접근 불가'다. 중간으로 올려 주면 관리자가 끄려던
  // 기능이 켜진 채로 저장된다 — 권한에서 틀리면 안 되는 방향이다.
  if (level !== "NONE" && permissionLevelRank(level) < permissionLevelRank(min)) level = "NONE";

  const baseline = baselineLeafLevel(params.leafKey, params.role);
  if (!params.mayWiden && permissionLevelRank(level) > permissionLevelRank(baseline)) {
    return baseline;
  }
  return level;
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
type SaveRejection = Extract<SaveRolePermissionsResult, { ok: false }>;

function assertNoLockout(params: {
  role: Role;
  actorRole: Role;
  levels: Map<string, PermissionLevel>;
}): SaveRejection | null {
  /** 저장 후 이 잎의 수준. 보내지 않은 잎은 기본 정책 그대로다. */
  const leafLevel = (leafKey: string): PermissionLevel =>
    params.levels.get(leafKey) ?? baselineLeafLevel(leafKey, params.role);

  /** 저장 후 이 메뉴의 수준. resolver·화면과 같은 함수를 쓴다. */
  const areaLevel = (areaKey: string): PermissionLevel => areaLevelFromLeaves(areaKey, leafLevel);

  if (params.role === params.actorRole && !meetsPermissionLevel(areaLevel("users"), "MANAGE")) {
    return {
      ok: false,
      code: "LOCKOUT",
      message:
        "지금 사용 중인 역할의 '사용자 관리' 권한을 관리 미만으로 낮출 수 없습니다. 저장하는 순간 이 화면에 다시 들어올 수 없습니다.",
    };
  }

  if (!PERMISSION_AREAS.some((area) => areaLevel(area.key) !== "NONE")) {
    return {
      ok: false,
      code: "LOCKOUT",
      message: "접근 가능한 메뉴를 하나도 남기지 않으면 그 역할은 로그인해도 갈 곳이 없습니다.",
    };
  }

  return null;
}
