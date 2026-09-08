import "server-only";

import { cache } from "react";
import { db } from "../client";
import { uiTextOverrides } from "../schema";
import { getAuthSource } from "@/lib/config/auth-source";
import {
  NO_UI_TEXT_OVERRIDES,
  type UiTextOverrideRow,
} from "@/lib/domain/ui-text-overrides";

/**
 * ============================================================================
 * 화면 문구 오버라이드 읽기
 * ============================================================================
 * 저장된 것만 담아 돌려준다 — 행이 없는 (묶음, 항목)은 결과에 나오지 않고, 그
 * 빈자리를 코드의 기본 문구가 채운다(domain/ui-text-overrides.ts 의
 * resolveUiText). 그래서 표가 비어 있는 동안에는 이 기능을 넣기 전과 화면이
 * 완전히 같다.
 *
 * ── 등록부와 대조하지 않는다 ────────────────────────────────────────────
 * 여기서는 group_key·item_key 가 등록부에 있는지, 값이 유효한지를 보지 않는다.
 * 그 판정은 resolveUiText 가 이미 하고 있고(등록부에 없는 키·검증 실패 값은
 * 병합에서 전부 걸러진다), 두 자리에서 같은 판정을 하면 둘이 어긋나는 날 어느
 * 쪽이 옳은지 알 수 없게 된다. 읽기는 읽기만 한다.
 *
 * ── 요청 한 번에 조회 한 번 ─────────────────────────────────────────────
 * ui-theme-tokens.ts · notification-settings.ts 와 같은 이유로 React 의 cache()
 * 로 감쌌다. 요청이 끝나면 캐시도 사라지므로 값을 바꾼 직후 다음 요청부터 바로
 * 반영된다.
 *
 * 🔴 프로세스 수명 캐시(unstable_cache 등)를 쓰지 않는다. 이 기능에서는
 * "저장했는데 화면이 안 바뀐다"가 곧 고장으로 읽힌다 — 관리자는 캐시가 도는
 * 중인지 저장이 실패한 것인지 구별할 방법이 없고, 되돌리려고 같은 값을 몇 번 더
 * 저장하게 된다. 행 수가 최대 46 남짓이라 비용보다 정확함이 훨씬 크다.
 * ============================================================================
 */

/** Postgres: 관계(테이블)가 존재하지 않음. */
const UNDEFINED_TABLE = "42P01";

/** 저장된 행만 그대로 읽는다. 기본 문구를 섞지 않는다. */
export async function loadStoredUiTextOverrides(): Promise<UiTextOverrideRow[]> {
  return db
    .select({
      groupKey: uiTextOverrides.groupKey,
      itemKey: uiTextOverrides.itemKey,
      value: uiTextOverrides.value,
    })
    .from(uiTextOverrides);
}

/**
 * 화면이 쓰는 읽기. 표가 아직 없어도 죽지 않는다.
 *
 * 🔴 다음 판에서 이 조회가 **읽는 쪽 37개 파일 전부**에 붙는다 — 수리 목록도,
 * 사용자 관리도, 사이드바도 그 아래에 있다. 마이그레이션을 아직 적용하지 않은
 * DB(다른 개발자 PC, NAS 첫 배포)에서 여기서 예외를 그대로 던지면 **그 화면들이
 * 한꺼번에 죽고**, 고치러 들어갈 화면조차 안 뜬다. 표가 없다는 것은 오버라이드가
 * 존재할 수 없다는 뜻이고, 오버라이드가 없는 동작은 정확히 이 기능을 넣기 전의
 * 동작이다 — 삼켜도 잃는 것이 없다. permission-resolver.ts 가 role_permissions
 * 에, ui-theme-tokens.ts 가 ui_theme_tokens 에 하는 것과 같은 처리다.
 *
 * 이 예외는 "표 없음" 하나만 삼킨다. 연결 실패·권한 오류까지 조용히 넘기면, 문구를
 * 바꿔 둔 운영 환경에서 DB 가 잠깐 흔들리는 사이 앱 전체가 기본 문구로 돌아갔다
 * 오는 상태가 되고, 그 깜빡임의 원인을 로그에서 찾을 길이 없다.
 *
 * AUTH_SOURCE 가 database 가 아니면 DB 를 아예 읽지 않는다 — 로컬 데모 모드에는
 * 이 표가 없을 수 있고, 없다고 해서 화면이 죽으면 안 된다.
 */
export const loadUiTextOverrides = cache(async (): Promise<readonly UiTextOverrideRow[]> => {
  if (getAuthSource() !== "database") return NO_UI_TEXT_OVERRIDES;
  try {
    return await loadStoredUiTextOverrides();
  } catch (err) {
    if (isUndefinedTableError(err)) {
      console.warn(
        "ui_text_overrides 테이블이 없습니다 — 마이그레이션 적용 전까지 코드의 기본 문구로 동작합니다."
      );
      return NO_UI_TEXT_OVERRIDES;
    }
    throw err;
  }
});

function isUndefinedTableError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === UNDEFINED_TABLE
  );
}

/**
 * 문구 편집 화면(다음다음 판)이 그릴 자료.
 *
 * 🔴 여기서는 표가 없을 때를 **삼키지 않는다** — 값을 **바꾸러 온 화면**이 표가
 * 없다는 사실을 감추면, 저장을 눌렀을 때에야 터진다. 화면을 그리는 경로(위)와
 * 값을 다루는 경로(여기)의 요구가 다르다. buildUiThemeView ·
 * buildNotificationSettingsView 와 같은 자리다.
 *
 * 돌려주는 것은 **저장된 행 목록 그대로**다. 기본 문구와의 병합을 여기 붙이지
 * 않은 이유는 편집 화면의 성질 때문이다 — 병합 결과는 "지금 편집 중인 값"을
 * 대상으로 매 글자마다 다시 계산돼야 하고, 그 값은 서버가 알 수 없다. 편집기는
 * 등록부와 순수 함수(resolveUiText · normalizeUiTextValue)로 클라이언트에서
 * 계산하고, 여기서 받은 행은 "지금 저장돼 있는 값"의 기준선으로만 쓴다.
 */
export async function buildUiTextView(): Promise<UiTextOverrideRow[]> {
  return loadStoredUiTextOverrides();
}
