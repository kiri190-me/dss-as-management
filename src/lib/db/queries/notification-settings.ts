import "server-only";

import { cache } from "react";
import { db } from "../client";
import { notificationKindSettings, notificationRoleSettings } from "../schema";
import { getAuthSource } from "@/lib/config/auth-source";
import {
  NO_NOTIFICATION_SETTINGS,
  buildNotificationSettingsScreenData,
  isNotificationKind,
  type NotificationSettingsOverrides,
  type NotificationSettingsScreenData,
} from "@/lib/domain/notification-settings";

/**
 * ============================================================================
 * 알림 설정 읽기
 * ============================================================================
 * 저장된 것만 담아 돌려준다 — 행이 없는 종류·역할은 결과에 나오지 않고, 그
 * 빈자리를 코드의 기본값이 채운다(domain/notification-settings.ts). 그래서
 * 아무도 설정을 만지지 않은 상태에서는 이 기능을 넣기 전과 동작이 완전히 같다.
 *
 * ── 요청 한 번에 조회 한 번 ─────────────────────────────────────────────
 * permission-resolver.ts와 같은 이유로 React의 cache()로 감쌌다. 한 페이지를
 * 그리는 동안 레이아웃의 종 알림과 알림 설정 화면이 각각 물어봐도 DB는 한 번만
 * 읽는다. 특히 listMyNotifications는 이 함수를 **종류마다가 아니라 한 번만**
 * 부른다 — 종류마다 부르면 종류가 늘어날수록 같은 조회가 그만큼 늘어난다
 * (queries/notifications.ts 머리말의 "같은 조회를 한 화면에서 두 번 돌리지
 * 않는다"와 같은 규율이다).
 *
 * 요청이 끝나면 캐시도 사라지므로 설정을 바꾼 직후 다음 요청부터 바로
 * 반영된다.
 * ============================================================================
 */

/** Postgres: 관계(테이블)가 존재하지 않음. */
const UNDEFINED_TABLE = "42P01";

/** 저장된 행만 그대로 읽는다. 기본값을 섞지 않는다. */
export async function loadStoredNotificationSettings(): Promise<NotificationSettingsOverrides> {
  const [kindRows, roleRows] = await Promise.all([
    db
      .select({ kindKey: notificationKindSettings.kindKey, isEnabled: notificationKindSettings.isEnabled })
      .from(notificationKindSettings),
    db
      .select({
        kindKey: notificationRoleSettings.kindKey,
        role: notificationRoleSettings.role,
        receives: notificationRoleSettings.receives,
      })
      .from(notificationRoleSettings),
  ]);

  const overrides: NotificationSettingsOverrides = { kindEnabled: {}, roleReceives: {} };

  // 지금 등록돼 있지 않은 종류의 행은 걸러 낸다 — 없어진 종류의 남은 행이
  // 판정에 관여하면, 화면에는 나오지 않는 설정이 알림을 막고 있는 상태가 된다
  // (queries/role-permissions.ts가 옛 area_key를 무시하는 것과 같은 판단이다).
  for (const row of kindRows) {
    if (!isNotificationKind(row.kindKey)) continue;
    overrides.kindEnabled[row.kindKey] = row.isEnabled;
  }
  for (const row of roleRows) {
    if (!isNotificationKind(row.kindKey)) continue;
    const forKind = overrides.roleReceives[row.kindKey] ?? {};
    forKind[row.role] = row.receives;
    overrides.roleReceives[row.kindKey] = forKind;
  }

  return overrides;
}

/**
 * 알림을 거르는 쪽이 쓰는 읽기. 표가 아직 없어도 죽지 않는다.
 *
 * 종 알림은 (app)/layout.tsx가 모든 화면을 그릴 때마다 계산한다. 마이그레이션을
 * 아직 적용하지 않은 DB에서 여기서 예외를 그대로 던지면 **모든 화면이 한꺼번에
 * 죽는다**. 아직 설정이 존재할 수 없는 상태이므로, 기본값을 그대로 쓰는 것이
 * 정확히 이 기능을 넣기 전의 동작이다 — 알림이 넓어지지도 좁아지지도 않는다.
 * permission-resolver.ts가 role_permissions에 대해 하는 것과 같은 처리다.
 *
 * 이 예외는 "표 없음" 하나만 삼킨다. 연결 실패·권한 오류까지 조용히 넘기면,
 * 설정을 저장해 둔 운영 환경에서 관리자가 꺼 둔 알림이 슬그머니 다시 켜진 채로
 * 돌아가게 된다.
 *
 * AUTH_SOURCE가 database가 아니면 DB를 읽지 않는다 — 로컬 데모 모드에는 이
 * 표가 없을 수 있고, 없다고 해서 알림이 사라지면 안 된다.
 */
export const loadNotificationSettings = cache(async (): Promise<NotificationSettingsOverrides> => {
  if (getAuthSource() !== "database") return NO_NOTIFICATION_SETTINGS;
  try {
    return await loadStoredNotificationSettings();
  } catch (err) {
    if (isUndefinedTableError(err)) {
      console.warn(
        "notification_kind_settings / notification_role_settings 테이블이 없습니다 — 마이그레이션 적용 전까지 기본값으로 동작합니다."
      );
      return NO_NOTIFICATION_SETTINGS;
    }
    throw err;
  }
});

function isUndefinedTableError(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code?: string }).code === UNDEFINED_TABLE;
}

/**
 * 알림 설정 화면이 그릴 자료.
 *
 * 여기서는 표가 없을 때를 삼키지 않는다 — 설정을 **바꾸러 온 화면**이 표가
 * 없다는 사실을 감추면, 저장을 눌렀을 때에야 터진다. 알림을 거르는 경로(위)와
 * 설정을 다루는 경로(여기)의 요구가 다르다.
 */
export async function buildNotificationSettingsView(): Promise<NotificationSettingsScreenData> {
  return buildNotificationSettingsScreenData(await loadStoredNotificationSettings());
}
