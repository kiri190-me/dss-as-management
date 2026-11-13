"use server";

import { readSession } from "@/lib/auth/session";
import { getAuthSource } from "@/lib/config/auth-source";
import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { mayManageBadgeVisibility } from "@/lib/auth/badge-visibility-authorization";
import {
  saveBadgeVisibilitySettings,
  type BadgeVisibilityPlacementInput,
} from "@/lib/db/mutations/badge-visibility-settings";

export type SaveBadgeVisibilityActionInput = {
  /**
   * 🔴 **사람이 만진 쌍만** 담는다. 33개를 통째로 되보내지 않는다 —
   * saveUiThemeTokensAction 과 같은 판단이다. 전부 보내면 ① 다른 관리자가 그 사이에
   * 다른 자리를 바꿔 놓은 것을 **내 화면의 옛 값으로 덮어쓰고**, ② 감사 기록을 읽는
   * 사람이 "이 사람이 33쌍을 다 만졌다"로 읽게 된다(저장 쪽이 같은 값은 거르지만,
   * 요청 자체에서 뜻이 사라지는 것은 되돌릴 수 없다).
   *
   * `isVisible: false` 가 "이 자리에서 숨겨라"이고, `true` 는 "되돌려라"(= 행 삭제)다.
   */
  placements: BadgeVisibilityPlacementInput[];
};

export type SaveBadgeVisibilityActionResult =
  | { ok: true; message: string }
  | { ok: false; message: string };

/**
 * Server Action: 배지 표시 설정 저장.
 *
 * 다른 Server Action 과 같은 층위의 일만 한다 — 모드 확인, 세션, 입력 **모양** 검증,
 * 오류 은닉. 등록부 대조·"끈 것만 행을 남긴다"·감사 기록은
 * saveBadgeVisibilitySettings() 가 DB 를 다시 읽어 수행한다.
 *
 * 🔴 값 검증 모듈(lib/validation/*)을 따로 두지 않았다. 화면 토큰에는 "#rrggbb 인가 ·
 * 스코프가 맞는가 · 기본값과 같은가" 같은 값 규칙이 있어 한 파일이 필요했지만, 여기서
 * 들어오는 값은 **불리언 하나**이고 진짜 관문은 등록부 대조(isBadgePlacementAllowed)다.
 * 그것을 여기로 옮겨 오면 관문이 두 곳이 되고, 액션을 거치지 않는 호출이 생기는 날
 * 한쪽만 지키게 된다.
 *
 * 권한 검사를 여기서 한 번, mutation 에서 또 한 번 한다. 중복이지만 겹쳐 두는 것이
 * 이 저장소의 관례다 — 한쪽이 무너져도 다른 쪽이 남는다
 * (ui-theme-tokens.ts · notification-settings.ts 와 같은 판단).
 *
 * ── 🔴 revalidatePath 를 부르지 않는다 ──────────────────────────────────
 * 본보기(saveUiThemeTokensAction)가 안 부르는 까닭은 "되살릴 특정 경로가 없다"였다.
 * 배지는 사정이 다르다 — 전체 A/S 현황·수리건 상세·내자 정리·기타건 **여러 화면**에
 * 걸쳐 있다. 그래도 부르지 않는다:
 *  ① 그 화면들은 전부 `dynamic = "force-dynamic"` 이거나 요청마다 DB 를 읽는다. 설정을
 *     읽는 조회가 React `cache()` 로만 감싸여 있어(queries/badge-visibility-settings.ts)
 *     캐시가 요청과 함께 사라지므로, **다음 요청부터 이미 새 값**이다. 되살릴 캐시가
 *     애초에 없는 자리에 revalidatePath 를 적으면, 읽는 사람은 여기에 프로세스 수명
 *     캐시가 있다고 믿게 된다.
 *  ② 🔴 조각 2에서는 배지를 그리는 쪽이 아직 이 설정을 **읽지도 않는다**(조각 3의 일).
 *     지금 경로를 나열해 두면 그 목록이 조각 3보다 먼저 굳고, 자리가 하나 늘거나
 *     줄 때 아무도 여기를 고치러 오지 않는다.
 * 편집 화면은 저장 뒤 router.refresh() 로 자기 화면만 다시 그린다.
 */
export async function saveBadgeVisibilityAction(
  input: SaveBadgeVisibilityActionInput
): Promise<SaveBadgeVisibilityActionResult> {
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
  if (!(await mayManageBadgeVisibility(actingUser))) {
    return { ok: false, message: "시스템 설정을 관리할 수 있는 사람만 배지 표시를 바꿀 수 있습니다." };
  }

  const placements = input?.placements;
  if (!Array.isArray(placements) || !placements.every(isPlacementShape)) {
    return { ok: false, message: "요청 형식이 올바르지 않습니다." };
  }

  try {
    const result = await saveBadgeVisibilitySettings({
      placements,
      actorUserId: actingUser.id,
    });
    if (!result.ok) return { ok: false, message: result.message };
    return {
      ok: true,
      message:
        result.changedCount === 0
          ? "변경된 내용이 없습니다."
          : `${result.changedCount}곳을 저장했습니다. 모든 사용자 화면에 다음 화면 이동부터 적용됩니다.`,
    };
  } catch (err) {
    const code = isPgErrorLike(err) ? err.code : undefined;
    console.error("saveBadgeVisibilityAction: unexpected DB error", { code });
    return { ok: false, message: "일시적으로 처리할 수 없습니다. 잠시 후 다시 시도해 주세요." };
  }
}

/**
 * 모양만 본다 — 어떤 쌍이 **있을 수 있는가**는 등록부가 알고 있고, 그 대조는
 * mutation 이 한다(위 머리말).
 */
function isPlacementShape(value: unknown): value is BadgeVisibilityPlacementInput {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.badgeKey === "string" &&
    typeof candidate.placeKey === "string" &&
    typeof candidate.isVisible === "boolean"
  );
}

function isPgErrorLike(err: unknown): err is { code?: string } {
  return typeof err === "object" && err !== null && "code" in err;
}
