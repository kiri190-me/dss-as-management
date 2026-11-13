import "server-only";

import { cache } from "react";
import { db } from "../client";
import { badgeVisibilitySettings } from "../schema";
import { getAuthSource } from "@/lib/config/auth-source";
import {
  BADGES,
  NO_BADGE_VISIBILITY_SETTINGS,
  findBadgePlace,
  isBadgeVisible,
  type BadgeKey,
  type BadgePlaceKey,
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
 * 누르게 된다. 행 수가 **최대 29**라(설정할 수 있는 쌍 전부를 꺼도 그렇다)
 * 비용보다 정확함이 훨씬 크다.
 *
 * 🔵 값을 **바꾸러 온 화면**이 쓸 읽기는 이 파일 맨 아래 buildBadgeVisibilityView 다
 * (2026-11-13, 조각 2에서 더했다 — buildUiThemeView · buildUiTextView 가 선 자리).
 * 표가 없을 때를 **삼키지 않는** 쪽이고, 까닭은 그 함수 주석에 있다.
 * ============================================================================
 */

/** Postgres: 관계(테이블)가 존재하지 않음. */
const UNDEFINED_TABLE = "42P01";

/**
 * 저장된 행만 그대로 읽는다. 등록부와 대조하지 않는다.
 *
 * 🔴 `isVisible` 이 true 인 행도 그대로 싣는다 — **설정 화면이 그런 행을 만들지
 * 않는데도** 그렇다. 2026-11-13(조각 2)에 저장 규칙이 「끈 것만 행을 남긴다」로
 * 정해졌다: 체크를 푼 쌍은 false 행이 되고, 다시 켜는 것은 **그 행을 지우는** 일이다
 * (db/mutations/badge-visibility-settings.ts). 그래서 앱이 쓰는 동안에는 true 행이
 * 생기지 않고, "껐다 켠 자리"와 "한 번도 안 만진 자리"는 **구별되지 않는다** —
 * 구별할 필요가 없다는 것이 그 결정의 요점이다(빈 표 = 전부 보임이라야 "아무것도
 * 안 건드린 시스템"과 "전부 켜 둔 시스템"이 같아진다).
 *
 * 🔴 그런데도 true 행을 걸러 내지 않는 까닭은 **DB 에 손으로 넣은 행**이다. 운영에서
 * psql 로 넣었거나, 옛 판이 남겼거나, 다른 도구가 적은 true 행이 있을 수 있다. 여기서
 * 지워 버리면 판정(isBadgeVisible)이 그 행을 못 보고 "행 없음 = 보임"으로 떨어지는데,
 * 그것은 우연히 같은 답이라 **거르는 쪽이 안전해 보이지만 실제로는 두 번째 판정**이다.
 * 읽기는 읽기만 한다 — 이 파일 머리말의 규율 그대로다.
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

/**
 * ============================================================================
 * 설정 화면이 그릴 자료 (2026-11-13, 조각 2)
 * ============================================================================
 * 등록부(domain/badge-visibility.ts)와 저장된 행을 **합쳐**, [배지 표시] 탭이
 * 그대로 늘어놓기만 하면 되는 모양으로 돌려준다.
 *
 * 🔴 **차례도 글자도 등록부가 정한다.** 배지는 BADGES 차례, 자리는 각 배지의
 * places 차례(= BADGE_PLACES 차례)다. 화면이 제 손으로 정렬하거나 이름을 지으면
 * 배지를 하나 더 그리는 날 **두 곳을 고쳐야** 하고, 둘 다 문자열이라 tsc 가
 * 침묵한다(badge-visibility.ts 가 쌍을 손으로 적지 않는 것과 같은 까닭).
 *
 * 🔴 **그 배지가 실제로 뜨는 자리만** 담는다 — 곱으로 펼치지 않는다. 체크상자
 * 총수가 29 인 것이 그 결과이고, 그 수를 시험이 센다. 「수리 건 요청일」에 「전체
 * A/S 현황」 칸을 만들면, 꺼도 아무 일이 안 일어나 끈 사람은 기능이 고장 난 것으로
 * 읽는다.
 *
 * ── 🔴 여기서는 "표 없음"을 삼키지 않는다 ───────────────────────────────
 * 위의 loadBadgeVisibilitySettings 와 **일부러 다르다**. 그쪽은 배지를 그리는 화면
 * 전부가 쓰므로 마이그레이션 전 DB 에서 화면이 한꺼번에 죽지 않게 42P01 을 삼키지만,
 * 여기는 값을 **바꾸러 온 화면**이다. 표가 없다는 사실을 감추면 체크상자를 다 그려
 * 놓고 [저장]을 눌렀을 때에야 터진다 — buildUiThemeView · buildNotificationSettingsView
 * 와 같은 자리의 같은 판단이다.
 * ============================================================================
 */

/** 설정 화면의 체크상자 한 칸. */
export type BadgeVisibilityPlaceView = {
  placeKey: BadgePlaceKey;
  /** 등록부의 자리 이름. 화면이 다시 짓지 않는다. */
  label: string;
  /** 지금 이 자리에서 보이는가 — 곧 체크 상태다(체크 = 보임). */
  visible: boolean;
};

/** 설정 화면의 한 덩이 — 배지 하나와 그 배지가 뜨는 자리들. */
export type BadgeVisibilityBadgeView = {
  badgeKey: BadgeKey;
  label: string;
  description: string;
  places: BadgeVisibilityPlaceView[];
};

/**
 * 저장된 행을 등록부에 얹는다. DB 를 읽지 않는 순수 함수라 값으로 잴 수 있다.
 *
 * 🔴 보임 판정을 여기서 새로 적지 않고 **isBadgeVisible 을 부른다.** 규칙이 두
 * 벌이 되면 설정 화면이 보여 주는 체크 상태와 실제 화면의 배지가 갈리는 날이 오고,
 * 그때 관리자는 자기가 끈 것이 왜 그대로인지 알 길이 없다.
 */
export function mergeBadgeVisibilityView(
  rows: readonly BadgeVisibilityRow[]
): BadgeVisibilityBadgeView[] {
  return BADGES.map((badge) => ({
    badgeKey: badge.key,
    label: badge.label,
    description: badge.description,
    places: badge.places.map((placeKey) => {
      const place = findBadgePlace(placeKey);
      // 등록부 안에서 어긋난 것이다(배지의 places 에 BADGE_PLACES 에 없는 키가 적혀
      // 있다). 🔴 조용히 건너뛰지 않는다 — 그러면 체크상자 하나가 소리 없이 사라지고,
      // 그 자리의 배지는 영영 끌 수 없는 채로 남는다. 코드로만 생길 수 있는 어긋남이라
      // 여기서 터뜨리는 편이 싸다.
      if (!place) {
        throw new Error(
          `badge-visibility: 등록부에 없는 자리입니다 — ${badge.key} / ${placeKey}`
        );
      }
      return {
        placeKey,
        label: place.label,
        visible: isBadgeVisible(rows, badge.key, placeKey),
      };
    }),
  }));
}

/** 설정 화면이 쓰는 읽기. 표가 없으면 **그대로 터진다**(위 머리말). */
export async function buildBadgeVisibilityView(): Promise<BadgeVisibilityBadgeView[]> {
  return mergeBadgeVisibilityView(await loadStoredBadgeVisibilitySettings());
}
