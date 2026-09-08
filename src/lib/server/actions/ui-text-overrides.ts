"use server";

import { readSession } from "@/lib/auth/session";
import { getAuthSource } from "@/lib/config/auth-source";
import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { mayEditUiText } from "@/lib/auth/ui-text-authorization";
import { validateUiTextOverrideChanges } from "@/lib/validation/ui-text-override-input";
import { saveUiTextOverrides } from "@/lib/db/mutations/ui-text-overrides";

export type SaveUiTextOverridesActionInput = {
  /**
   * 사람이 만진 문구만 담는다. 알림 설정 화면과 달리 목록을 통째로 되보내지
   * 않는다 — 문구가 46개이고, 안 만진 것까지 실어 보내면 "행이 없다 = 기본
   * 문구"라는 뜻이 요청 모양에서 사라진다.
   *
   * `value: null` 은 그 자리를 코드의 기본 문구로 되돌리라는 뜻이다.
   */
  changes: { groupKey: string; itemKey: string; value: string | null }[];
};

export type SaveUiTextOverridesActionResult =
  | { ok: true; message: string }
  | { ok: false; message: string };

/**
 * Server Action: 화면 문구 저장.
 *
 * 다른 Server Action 과 같은 층위의 일만 한다 — 모드 확인, 세션, 입력 형식 검증,
 * 오류 은닉. 기본값 되돌리기·감사 기록은 saveUiTextOverrides()가 DB 를 다시 읽어
 * 수행한다.
 *
 * 권한 검사를 여기서 한 번, mutation 에서 또 한 번 한다. 중복이지만 겹쳐 두는
 * 것이 이 저장소의 관례다 — 한쪽이 무너져도 다른 쪽이 남는다
 * (ui-theme-tokens.ts · notification-settings.ts 와 같은 판단).
 *
 * 🔴 revalidatePath 를 부르지 않는다. 이 값은 다음 판에서 화면들이 요청마다 읽게
 * 될 것이라 되살릴 특정 경로가 없고, 편집 화면은 저장 뒤 router.refresh() 로
 * 자기 화면만 다시 그린다.
 *
 * 🔴 이 판에서는 저장해도 **화면이 바뀌지 않는다.** 읽는 쪽(37개 파일)이 아직
 * 코드 표를 직접 읽기 때문이다 — 값만 쌓인다. 그래서 성공 문장도 "다음 화면
 * 이동부터 적용됩니다" 같은 약속을 하지 않는다.
 */
export async function saveUiTextOverridesAction(
  input: SaveUiTextOverridesActionInput
): Promise<SaveUiTextOverridesActionResult> {
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
  if (!mayEditUiText(actingUser)) {
    return {
      ok: false,
      message: "개발자 모드에 들어갈 수 있는 사람만 화면 문구를 바꿀 수 있습니다.",
    };
  }

  const validated = validateUiTextOverrideChanges(input?.changes);
  if (!validated.ok) return { ok: false, message: validated.message };

  try {
    const result = await saveUiTextOverrides({
      changes: input.changes,
      actorUserId: actingUser.id,
    });
    if (!result.ok) return { ok: false, message: result.message };
    return {
      ok: true,
      message:
        result.changedCount === 0
          ? "변경된 내용이 없습니다."
          : `${result.changedCount}개 문구를 저장했습니다.`,
    };
  } catch (err) {
    const code = isPgErrorLike(err) ? err.code : undefined;
    console.error("saveUiTextOverridesAction: unexpected DB error", { code });
    return { ok: false, message: "일시적으로 처리할 수 없습니다. 잠시 후 다시 시도해 주세요." };
  }
}

function isPgErrorLike(err: unknown): err is { code?: string } {
  return typeof err === "object" && err !== null && "code" in err;
}
