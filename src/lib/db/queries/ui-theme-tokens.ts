import "server-only";

import { cache } from "react";
import { db } from "../client";
import { uiThemeTokens } from "../schema";
import { getAuthSource } from "@/lib/config/auth-source";
import {
  NO_UI_THEME_OVERRIDES,
  type UiThemeOverrideRow,
  type UiThemeScope,
} from "@/lib/domain/ui-theme-tokens";

/**
 * ============================================================================
 * 화면 토큰 오버라이드 읽기
 * ============================================================================
 * 저장된 것만 담아 돌려준다 — 행이 없는 (토큰, 스코프)는 결과에 나오지 않고,
 * 그 빈자리를 코드의 기본값이 채운다(domain/ui-theme-tokens.ts의
 * resolveUiTheme). 그래서 표가 비어 있는 동안에는 이 기능을 넣기 전과 화면이
 * 완전히 같다 — 루트 레이아웃이 심을 CSS가 빈 문자열이라 <style> 태그조차
 * 나오지 않는다.
 *
 * ── 등록부와 대조하지 않는다 ────────────────────────────────────────────
 * 여기서는 token_key가 등록부에 있는지, 값이 유효한지, 스코프가 토큰의 성격과
 * 맞는지를 보지 않는다. 그 판정은 resolveUiTheme·serializeUiThemeCss가 이미
 * 하고 있고(등록부에 없는 키·검증 실패 값·기본값과 같은 값은 출력에서 전부
 * 걸러진다), 두 자리에서 같은 판정을 하면 둘이 어긋나는 날 어느 쪽이 옳은지
 * 알 수 없게 된다. 읽기는 읽기만 한다.
 *
 * ── 요청 한 번에 조회 한 번 ─────────────────────────────────────────────
 * notification-settings.ts와 같은 이유로 React의 cache()로 감쌌다. 요청이
 * 끝나면 캐시도 사라지므로 값을 바꾼 직후 다음 요청부터 바로 반영된다.
 *
 * 🔴 프로세스 수명 캐시(unstable_cache 등)를 쓰지 않는다. 이 기능에서는
 * "저장했는데 화면이 안 바뀐다"가 곧 고장으로 읽힌다 — 관리자는 캐시가 도는
 * 중인지 저장이 실패한 것인지 구별할 방법이 없고, 되돌리려고 같은 값을 몇 번
 * 더 저장하게 된다. 매 요청 한 번 읽는 값이므로(행 수 최대 35 남짓, 인덱스 없이
 * 전량 조회) 비용보다 정확함이 훨씬 크다.
 * ============================================================================
 */

/** Postgres: 관계(테이블)가 존재하지 않음. */
const UNDEFINED_TABLE = "42P01";

/** 저장된 행만 그대로 읽는다. 기본값을 섞지 않는다. */
export async function loadStoredUiThemeTokens(): Promise<UiThemeOverrideRow[]> {
  const rows = await db
    .select({
      tokenKey: uiThemeTokens.tokenKey,
      scope: uiThemeTokens.scope,
      value: uiThemeTokens.value,
    })
    .from(uiThemeTokens);

  // scope 칸은 text다(enum을 쓰지 않은 이유는 스키마 주석에 있다). 여기서
  // 좁히는 것은 타입뿐이고 값을 거르지는 않는다 — 알 수 없는 스코프의 행은
  // resolveUiTheme이 조용히 버리므로, 읽기 쪽에서 미리 지워 버리면 5단계
  // 편집 화면이 "DB에는 있는데 아무 데도 안 보이는 행"을 영영 못 보게 된다.
  return rows.map((row) => ({ ...row, scope: row.scope as UiThemeScope }));
}

/**
 * 루트 레이아웃이 쓰는 읽기. 표가 아직 없어도 죽지 않는다.
 *
 * 🔴 이 조회는 app/layout.tsx가 **모든 요청마다** 부른다 — 로그인 화면도,
 * 승인 대기 화면도, 오류 화면도 그 아래에 있다. 마이그레이션을 아직 적용하지
 * 않은 DB(다른 개발자 PC, NAS 첫 배포)에서 여기서 예외를 그대로 던지면
 * **앱의 모든 화면이 한꺼번에 죽고**, 고치러 들어갈 화면조차 안 뜬다.
 * 표가 없다는 것은 오버라이드가 존재할 수 없다는 뜻이고, 오버라이드가 없는
 * 동작은 정확히 이 기능을 넣기 전의 동작이다 — 삼켜도 잃는 것이 없다.
 * permission-resolver.ts가 role_permissions에, notification-settings.ts가
 * notification_*_settings에 하는 것과 같은 처리다.
 *
 * 이 예외는 "표 없음" 하나만 삼킨다. 연결 실패·권한 오류까지 조용히 넘기면,
 * 값을 저장해 둔 운영 환경에서 DB가 잠깐 흔들리는 사이 앱 전체가 기본 팔레트로
 * 돌아갔다 오는 상태가 되고, 그 깜빡임의 원인을 로그에서 찾을 길이 없다.
 *
 * AUTH_SOURCE가 database가 아니면 DB를 아예 읽지 않는다 — 로컬 데모 모드에는
 * 이 표가 없을 수 있고, 없다고 해서 화면이 죽으면 안 된다.
 */
export const loadUiThemeTokens = cache(async (): Promise<readonly UiThemeOverrideRow[]> => {
  if (getAuthSource() !== "database") return NO_UI_THEME_OVERRIDES;
  try {
    return await loadStoredUiThemeTokens();
  } catch (err) {
    if (isUndefinedTableError(err)) {
      console.warn(
        "ui_theme_tokens 테이블이 없습니다 — 마이그레이션 적용 전까지 기본 팔레트로 동작합니다."
      );
      return NO_UI_THEME_OVERRIDES;
    }
    throw err;
  }
});

function isUndefinedTableError(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code?: string }).code === UNDEFINED_TABLE;
}

/**
 * 화면 토큰 편집 화면(5단계)이 그릴 자료.
 *
 * 여기서는 표가 없을 때를 삼키지 않는다 — 값을 **바꾸러 온 화면**이 표가
 * 없다는 사실을 감추면, 저장을 눌렀을 때에야 터진다. 화면을 그리는 경로(위)와
 * 값을 다루는 경로(여기)의 요구가 다르다. notification-settings.ts의
 * buildNotificationSettingsView와 같은 자리다.
 *
 * 돌려주는 것은 **저장된 행 목록 그대로**다. 기본값과의 병합·대비 판정·화면
 * 묶음을 여기 붙이지 않은 이유는 편집 화면의 성질 때문이다 — 그 셋은 전부
 * "지금 편집 중인 값"을 대상으로 매 글자마다 다시 계산돼야 하고(미리보기와
 * 대비 표가 저장 전에 움직인다), 그 값은 서버가 알 수 없다. 그래서 편집기가
 * 등록부와 순수 함수(resolveUiTheme·normalizeUiThemeValue·contrastRatio)로
 * 클라이언트에서 계산한다. 서버가 같은 계산을 한 벌 더 갖고 있으면 둘이
 * 어긋나는 날 어느 쪽이 옳은지 알 수 없어진다.
 *
 * 편집기는 여기서 받은 행을 "지금 저장돼 있는 값"의 기준선으로만 쓴다 —
 * 무엇이 바뀌었는지를 그 기준선과 견주어 정하고, 바뀐 것만 서버로 보낸다.
 */
export async function buildUiThemeView(): Promise<UiThemeOverrideRow[]> {
  return loadStoredUiThemeTokens();
}
