"use server";

import { readSession } from "@/lib/auth/session";
import { getAuthSource } from "@/lib/config/auth-source";
import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { canManageNotificationSettings } from "@/lib/auth/notification-settings-authorization";
import { actorMay } from "@/lib/auth/developer-promotion";
import { saveNotificationSettings } from "@/lib/db/mutations/notification-settings";

export type SaveNotificationSettingsActionInput = {
  /**
   * 종류별로 바뀐 값. 화면이 여러 종류를 한 표에서 편집하므로 한 번에 보낸다 —
   * 종류마다 따로 보내면 둘째에서 막혔을 때 첫째만 저장된다.
   */
  changes: { kind: string; enabled: boolean; roles: Record<string, boolean> }[];
};

export type SaveNotificationSettingsActionResult =
  | { ok: true; message: string }
  | { ok: false; message: string };

/**
 * Server Action: 알림 설정 저장.
 *
 * 다른 Server Action과 같은 층위의 일만 한다 — 모드 확인, 세션, 입력 형식
 * 검증, 오류 은닉. 최고관리자 보호·기본값 되돌리기·감사 기록은
 * saveNotificationSettings()가 DB를 다시 읽어 수행한다.
 *
 * 권한 검사를 여기서 한 번, mutation에서 또 한 번 한다. 중복이지만 "누가 밀린
 * 일을 보게 되는가"를 바꾸는 조작이라 겹쳐 두는 편이 맞다 — 한쪽이 무너져도
 * 다른 쪽이 남는다(role-permissions.ts와 같은 판단).
 */
export async function saveNotificationSettingsAction(
  input: SaveNotificationSettingsActionInput
): Promise<SaveNotificationSettingsActionResult> {
  if (getAuthSource() !== "database") {
    return { ok: false, message: "데이터베이스 인증 모드가 아닙니다." };
  }

  const session = await readSession();
  if (!session) return { ok: false, message: "로그인이 필요합니다." };
  const actingUser = await resolveActingUserForSession(session);
  if (!actingUser) return { ok: false, message: "로그인이 필요합니다." };
  if (actingUser.approvalStatus !== "APPROVED") {
    return { ok: false, message: "계정이 아직 승인되지 않았습니다." };
  }
  if (!actorMay(actingUser, canManageNotificationSettings)) {
    return { ok: false, message: "관리자 이상만 알림 설정을 바꿀 수 있습니다." };
  }

  if (!Array.isArray(input.changes)) {
    return { ok: false, message: "알림 설정 값을 확인할 수 없습니다." };
  }
  for (const change of input.changes) {
    if (!change || typeof change.kind !== "string") {
      return { ok: false, message: "알림 종류를 확인할 수 없습니다." };
    }
    if (typeof change.enabled !== "boolean") {
      return { ok: false, message: "알림 사용 여부를 확인할 수 없습니다." };
    }
    if (typeof change.roles !== "object" || change.roles === null || Array.isArray(change.roles)) {
      return { ok: false, message: "알림 대상 값을 확인할 수 없습니다." };
    }
  }

  try {
    const result = await saveNotificationSettings({
      changes: input.changes,
      actorUserId: actingUser.id,
    });
    if (!result.ok) return { ok: false, message: result.message };
    return {
      ok: true,
      message:
        result.changedCount === 0
          ? "변경된 내용이 없습니다."
          : `${result.changedCount}개 항목을 저장했습니다. 해당 역할 사용자는 다음 화면 이동부터 적용됩니다.`,
    };
  } catch (err) {
    const code = isPgErrorLike(err) ? err.code : undefined;
    console.error("saveNotificationSettingsAction: unexpected DB error", { code });
    return { ok: false, message: "일시적으로 처리할 수 없습니다. 잠시 후 다시 시도해 주세요." };
  }
}

function isPgErrorLike(err: unknown): err is { code?: string } {
  return typeof err === "object" && err !== null && "code" in err;
}
