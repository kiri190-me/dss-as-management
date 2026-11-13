import "server-only";

import { cache } from "react";
import { db } from "../client";
import { badgeVisibilitySettings } from "../schema";
import { getAuthSource } from "@/lib/config/auth-source";
import {
  NO_BADGE_VISIBILITY_SETTINGS,
  type BadgeVisibilityRow,
} from "@/lib/domain/badge-visibility";

/**
 * ============================================================================
 * 배지 표시 설정 읽기
 * ============================================================================
 * 저장된 것만 담아 돌려준다 — 행이 없는 (배지, 자리)는 결과에 나오지 않고, 그
 * 빈자리는 "보임"이다(domain/badge-visibility.ts 의 isBadgeVisible). 그래서 표가
 * 비어 있는 동안에는 이 기능을 넣기 전과 화면이 완전히 같다.
 *
 * ── 🔴 등록부와 대조하지 않는다 — 모르는 키도 그대로 들고 온다 ──────────
 * 여기서는 badge_key·place_key 가 등록부에 있는지, 허용된 쌍인지를 보지 않는다.
 * 그 판정은 isBadgeVisible 이 이미 하고 있고(등록부에 없는 키·허용되지 않는 쌍은
 * 전부 "보임"으로 떨어진다), 두 자리에서 같은 판정을 하면 둘이 어긋나는 날 어느
 * 쪽이 옳은지 알 수 없게 된다. 거르면 손해도 하나 더 생긴다 — 설정 화면(조각 2)이
 * "DB 에는 있는데 아무 데도 안 보이는 행"을 영영 못 보게 된다.
 * ui-theme-tokens.ts · ui-text-overrides.ts 와 같은 규율이다. 읽기는 읽기만 한다.
 *
 * ── 요청 한 번에 조회 한 번 ─────────────────────────────────────────────
 * ui-theme-tokens.ts · ui-text-overrides.ts 와 같은 이유로 React 의 cache() 로
 * 감쌌다. 요청이 끝나면 캐시도 사라지므로 값을 바꾼 직후 다음 요청부터 바로
 * 반영된다.
 *
 * 🔴 프로세스 수명 캐시(unstable_cache 등)를 쓰지 않는다. 이 기능에서는
 * "껐는데 배지가 그대로 있다"가 곧 고장으로 읽힌다 — 관리자는 캐시가 도는 중인지
 * 저장이 실패한 것인지 구별할 방법이 없고, 되돌리려고 같은 스위치를 몇 번 더
 * 누르게 된다. 행 수가 **최대 33**이라(설정할 수 있는 쌍 전부를 꺼도 그렇다)
 * 비용보다 정확함이 훨씬 크다.
 *
 * 🔵 값을 **바꾸러 온 화면**이 쓸 읽기(표가 없을 때를 삼키지 않는 쪽 —
 * buildUiThemeView · buildUiTextView 자리)는 설정 화면과 함께 조각 2에서 만든다.
 * 여기 미리 두면 아무도 부르지 않는 채로 남는다.
 * ============================================================================
 */

/** Postgres: 관계(테이블)가 존재하지 않음. */
const UNDEFINED_TABLE = "42P01";

/**
 * 저장된 행만 그대로 읽는다. 등록부와 대조하지 않는다.
 *
 * 🔴 `isVisible` 이 true 인 행도 그대로 싣는다. 설정 화면이 "한 번 껐다가 다시
 * 켠 자리"와 "한 번도 만진 적 없는 자리"를 구별해야 하고, 끄기를 되돌리는 길이
 * 두 가지(행을 지우기 · true 로 되돌리기)라 뒤엣것이 결과에서 사라지면 안 된다.
 */
export async function loadStoredBadgeVisibilitySettings(): Promise<BadgeVisibilityRow[]> {
  return db
    .select({
      badgeKey: badgeVisibilitySettings.badgeKey,
      placeKey: badgeVisibilitySettings.placeKey,
      isVisible: badgeVisibilitySettings.isVisible,
    })
    .from(badgeVisibilitySettings);
}

/**
 * 배지를 그리는 화면들이 쓰는 읽기. 표가 아직 없어도 죽지 않는다.
 *
 * 🔴 조각 3에서 이 조회가 배지를 그리는 화면 전부에 붙는다 — 전체 A/S 현황도,
 * 수리건 상세도, 내자 정리도, 기타건 현황도 그 아래에 있다. 마이그레이션을 아직
 * 적용하지 않은 DB(다른 개발자 PC, NAS 첫 배포)에서 여기서 예외를 그대로 던지면
 * **그 화면들이 한꺼번에 죽고**, 고치러 들어갈 화면조차 안 뜬다. 표가 없다는 것은
 * 숨김 설정이 존재할 수 없다는 뜻이고, 숨김이 없는 동작은 정확히 이 기능을 넣기
 * 전의 동작이다 — 삼켜도 잃는 것이 없다. permission-resolver.ts 가
 * role_permissions 에, ui-theme-tokens.ts 가 ui_theme_tokens 에 하는 것과 같은
 * 처리다.
 *
 * 🔴 이 예외는 "표 없음" 하나만 삼킨다. 연결 실패·권한 오류까지 조용히 넘기면,
 * 배지를 꺼 둔 운영 환경에서 DB 가 잠깐 흔들리는 사이 껐던 배지가 되살아났다
 * 돌아가는 상태가 되고, 그 깜빡임의 원인을 로그에서 찾을 길이 없다.
 *
 * AUTH_SOURCE 가 database 가 아니면 DB 를 아예 읽지 않는다 — 로컬 데모 모드에는
 * 이 표가 없을 수 있고, 없다고 해서 화면이 죽으면 안 된다.
 */
export const loadBadgeVisibilitySettings = cache(
  async (): Promise<readonly BadgeVisibilityRow[]> => {
    if (getAuthSource() !== "database") return NO_BADGE_VISIBILITY_SETTINGS;
    try {
      return await loadStoredBadgeVisibilitySettings();
    } catch (err) {
      if (isUndefinedTableError(err)) {
        console.warn(
          "badge_visibility_settings 테이블이 없습니다 — 마이그레이션 적용 전까지 배지가 전부 보입니다."
        );
        return NO_BADGE_VISIBILITY_SETTINGS;
      }
      throw err;
    }
  }
);

function isUndefinedTableError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === UNDEFINED_TABLE
  );
}
