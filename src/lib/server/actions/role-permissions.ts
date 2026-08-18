"use server";

import { readSession } from "@/lib/auth/session";
import { getAuthSource } from "@/lib/config/auth-source";
import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { canManageRolePermissions } from "@/lib/auth/role-permission-authorization";
import { saveRolePermissions } from "@/lib/db/mutations/role-permissions";
import { ROLE_CODES, type Role } from "@/lib/domain/types";

export type SaveRolePermissionsActionInput = {
  role: string;
  levels: Record<string, string>;
};

export type SaveRolePermissionsActionResult =
  | { ok: true; message: string }
  | { ok: false; message: string };

/**
 * Server Action: 역할별 접근 권한 저장.
 *
 * 다른 Server Action과 같은 층위의 일만 한다 — 모드 확인, 세션, 입력 형식
 * 검증, 오류 은닉. 상한 적용·잠금 방지·감사 기록은 saveRolePermissions()가
 * DB를 다시 읽어 수행한다.
 *
 * 권한 검사를 여기서 한 번, mutation에서 또 한 번 한다. 중복이지만 권한 설정
 * 자체를 바꾸는 조작이라 겹쳐 두는 편이 맞다 — 한쪽이 무너져도 다른 쪽이
 * 남는다.
 */
export async function saveRolePermissionsAction(
  input: SaveRolePermissionsActionInput
): Promise<SaveRolePermissionsActionResult> {
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
  if (!canManageRolePermissions(actingUser.role)) {
    return { ok: false, message: "관리자 이상만 권한을 설정할 수 있습니다." };
  }

  if (!(ROLE_CODES as readonly string[]).includes(input.role)) {
    return { ok: false, message: "역할을 확인할 수 없습니다." };
  }
  if (typeof input.levels !== "object" || input.levels === null || Array.isArray(input.levels)) {
    return { ok: false, message: "권한 값을 확인할 수 없습니다." };
  }

  try {
    const result = await saveRolePermissions({
      role: input.role as Role,
      levels: input.levels,
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
    console.error("saveRolePermissionsAction: unexpected DB error", { code });
    return { ok: false, message: "일시적으로 처리할 수 없습니다. 잠시 후 다시 시도해 주세요." };
  }
}

function isPgErrorLike(err: unknown): err is { code?: string } {
  return typeof err === "object" && err !== null && "code" in err;
}
