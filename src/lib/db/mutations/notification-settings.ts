import "server-only";

import { and, eq } from "drizzle-orm";
import { db } from "../client";
import { notificationKindSettings, notificationRoleSettings, users } from "../schema";
import { insertAuditLog } from "./audit-logs";
import {
  defaultNotificationKindEnabled,
  defaultRoleReceivesNotification,
  isNotificationKind,
  isRoleEditableInNotificationSettings,
  NOTIFICATION_KIND_META,
} from "@/lib/domain/notification-settings";
import type { NotificationKind } from "@/lib/domain/notifications";
import { ROLE_CODES, type Role } from "@/lib/domain/types";
import { actorMay } from "@/lib/auth/developer-promotion";
import { canManageNotificationSettings } from "@/lib/auth/notification-settings-authorization";

export type SaveNotificationSettingsResult =
  | { ok: true; changedCount: number }
  | { ok: false; code: "FORBIDDEN" | "INVALID_INPUT"; message: string };

/**
 * ============================================================================
 * 알림 설정 저장
 * ============================================================================
 * saveRolePermissions를 본보기로 삼았고, 거기서 이미 내려진 판단들을 그대로
 * 가져왔다. 화면이 보낸 값을 그대로 믿지 않는다 — 화면을 거치지 않고 이 액션을
 * 부를 수 있기 때문이다.
 *
 *  1) **한 트랜잭션.** 종류 둘을 한 화면에서 함께 편집하므로, 둘째 종류에서
 *     막혔는데 첫째만 저장되는 일은 없어야 한다. 알림이 반쯤 적용된 상태는
 *     누가 무엇을 받고 있는지 아무도 모른다.
 *  2) **같은 종류가 두 번 오면 거절한다.** 어느 쪽이 뜻인지 알 수 없고, 뒤엣것
 *     으로 덮어쓰면 화면에서 본 것과 다른 값이 저장될 수 있다.
 *  3) **트랜잭션 안에서 행위자를 다시 읽는다.** 세션이 만들어진 뒤 역할이
 *     내려갔거나 계정이 지워졌을 수 있다.
 *  4) **최고관리자가 받는 것은 끌 수 없다.** 권한 설정이 최고관리자 줄을 잠가
 *     두는 것과 같은 이유다 — 알림을 전부 꺼 버리면 밀린 일을 아무도 모르게
 *     된다. 화면에서도 막지만 여기서 다시 막는다.
 *  5) **기본값과 같은 값은 저장하지 않고 지운다.** "기본으로 되돌림"과 "기본과
 *     같은 값을 굳이 적어 둠"이 구별되면, 나중에 코드의 기본값이 바뀌었을 때
 *     후자만 옛 값에 묶여 따라오지 못한다.
 *  6) **모르는 종류·역할은 무시한다.** 거절하지 않는 이유는, 화면이 목록을
 *     그대로 되보내더라도 저장이 통째로 실패하면 안 되기 때문이다.
 *
 * 감사 로그는 role_permissions와 같은 규칙으로 남긴다 — 알림 대상을 바꾸는 것은
 * "누가 밀린 일을 보게 되는가"를 바꾸는 조작이라 추적할 수 있어야 한다. 표가
 * 둘이므로 target_entity도 둘로 나뉜다(어느 스위치가 움직였는지가 로그만 읽고
 * 구별돼야 한다).
 * ============================================================================
 */
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * 거절을 트랜잭션 밖으로 던지기 위한 신호. 콜백에서 그냥 반환하면 트랜잭션이
 * **커밋된다**(saveRolePermissions의 SaveRejected와 같은 이유).
 */
class SaveRejected extends Error {
  constructor(readonly result: Extract<SaveNotificationSettingsResult, { ok: false }>) {
    super(result.message);
    this.name = "SaveRejected";
  }
}

export type NotificationSettingsChange = {
  kind: string;
  /** 종류 자체를 켤 것인가. */
  enabled: boolean;
  /** 역할 코드 → 받을 것인가. 빠진 역할은 건드리지 않는다(= 지금 값 그대로). */
  roles: Record<string, boolean>;
};

export async function saveNotificationSettings(params: {
  changes: NotificationSettingsChange[];
  actorUserId: string;
}): Promise<SaveNotificationSettingsResult> {
  const seen = new Set<string>();
  for (const change of params.changes) {
    if (seen.has(change.kind)) {
      return { ok: false, code: "INVALID_INPUT", message: "같은 알림 종류가 두 번 들어왔습니다." };
    }
    seen.add(change.kind);

    if (typeof change.enabled !== "boolean") {
      return { ok: false, code: "INVALID_INPUT", message: "알림 사용 여부를 확인할 수 없습니다." };
    }

    // 최고관리자 줄은 화면에서도 잠겨 있다. 여기서 거절하는 것은 화면을 거치지
    // 않고 부른 경우다 — 조용히 참으로 고쳐 주지 않는다. 고쳐 주면 부른 쪽은
    // 자기가 끈 줄로 알고, 실제로는 켜져 있는 상태가 된다.
    if (change.roles?.SUPER_ADMIN === false) {
      return {
        ok: false,
        code: "FORBIDDEN",
        message: "최고관리자가 받는 알림은 끌 수 없습니다. 알림을 전부 꺼 버리면 밀린 일을 아무도 모르게 됩니다.",
      };
    }
  }
  if (params.changes.length === 0) return { ok: true, changedCount: 0 };

  try {
    return await db.transaction(async (tx): Promise<SaveNotificationSettingsResult> => {
      const [actor] = await tx
        .select({ id: users.id, role: users.role, approvalStatus: users.approvalStatus, isDeveloper: users.isDeveloper })
        .from(users)
        .where(and(eq(users.id, params.actorUserId), eq(users.isDeleted, false)));
      if (!actor || actor.approvalStatus !== "APPROVED") {
        throw new SaveRejected({ ok: false, code: "FORBIDDEN", message: "사용자 정보를 확인할 수 없습니다." });
      }
      // 권한 설정 쪽과 같은 이유로 승격이 여기까지 닿아야 한다 —
      // 액션 층이 통과시킨 요청을 이 층이 다시 막으면 화면과 서버가 어긋난다.
      if (!actorMay(actor, canManageNotificationSettings)) {
        throw new SaveRejected({
          ok: false,
          code: "FORBIDDEN",
          message: "관리자 이상만 알림 설정을 바꿀 수 있습니다.",
        });
      }

      let changedCount = 0;
      for (const change of params.changes) {
        // 등록되지 않은 종류는 무시한다. 그 종류를 무엇으로부터 계산할지가
        // 코드에 없으므로, 저장해 봐야 아무 알림도 걸러지지 않는 껍데기 행이 된다.
        if (!isNotificationKind(change.kind)) continue;
        changedCount += await applyOneKind(tx, {
          kind: change.kind,
          change,
          actorUserId: actor.id,
        });
      }
      return { ok: true, changedCount };
    });
  } catch (err) {
    if (err instanceof SaveRejected) return err.result;
    throw err;
  }
}

/** 종류 하나분의 저장 — 종류 스위치 한 줄 + 역할 다섯 줄. */
async function applyOneKind(
  tx: Tx,
  params: { kind: NotificationKind; change: NotificationSettingsChange; actorUserId: string }
): Promise<number> {
  let changedCount = 0;
  changedCount += await applyKindSwitch(tx, params);

  for (const role of ROLE_CODES) {
    const raw = params.change.roles?.[role];
    // 보내지 않은 역할은 건드리지 않는다.
    if (raw === undefined) continue;
    if (typeof raw !== "boolean") {
      throw new SaveRejected({
        ok: false,
        code: "INVALID_INPUT",
        message: `알림 대상 값을 확인할 수 없습니다: ${NOTIFICATION_KIND_META[params.kind].label}`,
      });
    }
    // 최고관리자 줄은 저장하지 않는다. 위에서 false를 이미 거절했으므로 여기
    // 오는 값은 참뿐이고, 참은 곧 기본값이라 어차피 남길 행이 없다.
    if (!isRoleEditableInNotificationSettings(role)) continue;

    changedCount += await applyRoleCell(tx, {
      kind: params.kind,
      role,
      receives: raw,
      actorUserId: params.actorUserId,
    });
  }

  return changedCount;
}

async function applyKindSwitch(
  tx: Tx,
  params: { kind: NotificationKind; change: NotificationSettingsChange; actorUserId: string }
): Promise<number> {
  const desired = params.change.enabled;
  const fallback = defaultNotificationKindEnabled(params.kind);

  const [previous] = await tx
    .select({ id: notificationKindSettings.id, isEnabled: notificationKindSettings.isEnabled })
    .from(notificationKindSettings)
    .where(eq(notificationKindSettings.kindKey, params.kind));

  if (desired === fallback) {
    if (!previous) return 0;
    await tx.delete(notificationKindSettings).where(eq(notificationKindSettings.id, previous.id));
    await insertAuditLog(tx, {
      actorUserId: params.actorUserId,
      // 설정 행은 지우지만 알림이 사라지는 것이 아니라 기본값으로 돌아가는
      // 것이므로 UPDATE로 남긴다(SOFT_DELETE/PURGE는 자료가 없어졌다는 뜻이라
      // 여기서는 오해를 만든다) — role_permissions와 같은 판단이다.
      actionType: "UPDATE",
      targetEntity: "notification_kind_settings",
      targetRecordId: previous.id,
      previousValue: { kind: params.kind, isEnabled: previous.isEnabled },
      newValue: { kind: params.kind, isEnabled: fallback, revertedToDefault: true },
    });
    return 1;
  }

  if (previous?.isEnabled === desired) return 0;

  const [saved] = await tx
    .insert(notificationKindSettings)
    .values({ kindKey: params.kind, isEnabled: desired, updatedBy: params.actorUserId })
    .onConflictDoUpdate({
      target: [notificationKindSettings.kindKey],
      set: { isEnabled: desired, updatedBy: params.actorUserId, updatedAt: new Date() },
    })
    .returning({ id: notificationKindSettings.id });

  await insertAuditLog(tx, {
    actorUserId: params.actorUserId,
    actionType: previous ? "UPDATE" : "CREATE",
    targetEntity: "notification_kind_settings",
    targetRecordId: saved.id,
    // 설정이 없던 상태의 "이전 값"은 기본값이다 — 실제로 그때 통하던 값이
    // 그것이므로, 로그를 읽는 사람이 무엇에서 무엇으로 바뀌었는지 알 수 있다.
    previousValue: { kind: params.kind, isEnabled: previous?.isEnabled ?? fallback },
    newValue: { kind: params.kind, isEnabled: desired },
  });
  return 1;
}

async function applyRoleCell(
  tx: Tx,
  params: { kind: NotificationKind; role: Role; receives: boolean; actorUserId: string }
): Promise<number> {
  const fallback = defaultRoleReceivesNotification(params.kind, params.role);

  const [previous] = await tx
    .select({ id: notificationRoleSettings.id, receives: notificationRoleSettings.receives })
    .from(notificationRoleSettings)
    .where(
      and(eq(notificationRoleSettings.kindKey, params.kind), eq(notificationRoleSettings.role, params.role))
    );

  if (params.receives === fallback) {
    if (!previous) return 0;
    await tx.delete(notificationRoleSettings).where(eq(notificationRoleSettings.id, previous.id));
    await insertAuditLog(tx, {
      actorUserId: params.actorUserId,
      actionType: "UPDATE",
      targetEntity: "notification_role_settings",
      targetRecordId: previous.id,
      previousValue: { kind: params.kind, role: params.role, receives: previous.receives },
      newValue: { kind: params.kind, role: params.role, receives: fallback, revertedToDefault: true },
    });
    return 1;
  }

  if (previous?.receives === params.receives) return 0;

  const [saved] = await tx
    .insert(notificationRoleSettings)
    .values({
      kindKey: params.kind,
      role: params.role,
      receives: params.receives,
      updatedBy: params.actorUserId,
    })
    .onConflictDoUpdate({
      target: [notificationRoleSettings.kindKey, notificationRoleSettings.role],
      set: { receives: params.receives, updatedBy: params.actorUserId, updatedAt: new Date() },
    })
    .returning({ id: notificationRoleSettings.id });

  await insertAuditLog(tx, {
    actorUserId: params.actorUserId,
    actionType: previous ? "UPDATE" : "CREATE",
    targetEntity: "notification_role_settings",
    targetRecordId: saved.id,
    previousValue: { kind: params.kind, role: params.role, receives: previous?.receives ?? fallback },
    newValue: { kind: params.kind, role: params.role, receives: params.receives },
  });
  return 1;
}
