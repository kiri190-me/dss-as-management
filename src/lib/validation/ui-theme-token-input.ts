import {
  normalizeUiThemeValue,
  UI_THEME_TOKENS,
  type UiThemeScope,
  type UiThemeToken,
} from "@/lib/domain/ui-theme-tokens";

/**
 * ============================================================================
 * 화면 토큰 입력 검증 — 형식만 본다
 * ============================================================================
 * part-minimum-quantity-input.ts · weekly-report-goal-input.ts 와 같은 자리다.
 * **DB 도 세션도 여기서 만지지 않는다** — 순수 함수만 두어야 단위 테스트가 붙고,
 * 그래야 "어떤 값을 받아들이는가"라는 규칙이 실제로 검증된다. 누가 적을 수 있는가
 * (인가)와 저장했을 때 화면이 읽히는가(대비 하한)는 자료를 봐야 알 수 있으므로
 * mutation 이 맡는다.
 *
 * ── 🔴 모르는 것은 무시하지 않고 거절한다 ───────────────────────────────
 * notification-settings.ts 는 등록되지 않은 알림 종류를 조용히 무시한다. 여기서는
 * **반대로 간다.** 까닭은 화면이 보내는 것의 성격이 다르기 때문이다 —
 * 알림 설정 화면은 목록을 통째로 되보내므로, 그중 한 줄이 등록부에서 사라졌다고
 * 저장 전체가 실패하면 화면을 쓸 수 없다. 반면 토큰 편집기는 **사람이 만진 것만**
 * 보낸다. 그 몇 줄 중 하나를 여기서 조용히 버리면 "저장했는데 화면이 안 바뀐다"가
 * 되고, 관리자에게 그것은 고장과 구별되지 않는다 — 되돌리려고 같은 값을 몇 번 더
 * 저장하게 되고, 그래도 아무 일도 일어나지 않는다.
 *
 * 읽기 쪽 resolveUiTheme 이 모르는 키를 **무시하는** 것은 이와 모순이 아니다.
 * 저쪽의 요구는 다르다 — "등록부에서 토큰을 뺀 날, DB 에 남은 옛 행 하나 때문에
 * 앱 전체가 멈추면 안 된다". 들어오는 값(여기)은 좁게 받고, 이미 저장된 값(저쪽)은
 * 너그럽게 흘려보낸다.
 *
 * ── 받아들이는 값 ───────────────────────────────────────────────────────
 *   · tokenKey  — 등록부(UI_THEME_TOKENS)에 있는 논리 키만
 *   · scope     — "light" | "dark" | "both", 그리고 **토큰의 성격과 맞아야 한다**
 *                 (scoped:true 는 light/dark, scoped:false 는 both 하나뿐)
 *   · value     — normalizeUiThemeValue 를 지나는 문자열, 또는 null(기본값 복귀)
 *
 * value 가 `undefined` 인 것은 받지 않는다. 되돌리려는 뜻이면 `null` 을 명시해야
 * 한다 — 칸을 빠뜨린 요청과 되돌리려는 요청이 같은 모양이면, 화면의 버그 하나가
 * 조용히 오버라이드를 지우는 조작이 된다.
 * ============================================================================
 */

/** 서버 액션과 mutation 이 주고받는 입력 한 줄. */
export type UiThemeTokenChange = {
  tokenKey: string;
  scope: string;
  /** null 이면 기본값으로 되돌린다(= 저장된 행을 지운다). */
  value: string | null;
};

/** 검증을 지난 한 줄. 값은 이미 정규화돼 있다. */
export type CheckedUiThemeTokenChange = {
  token: UiThemeToken;
  scope: UiThemeScope;
  /** 정규화된 값. null 이면 기본값 복귀. */
  value: string | null;
};

export type CheckUiThemeTokenChangeResult =
  | { ok: true; change: CheckedUiThemeTokenChange }
  | { ok: false; message: string };

export type ValidateUiThemeTokenChangesResult =
  | { ok: true; data: CheckedUiThemeTokenChange[] }
  | { ok: false; message: string };

/** 키로 토큰을 찾는 표. 등록부에 없는 키는 여기서 걸린다. */
const TOKEN_BY_KEY: ReadonlyMap<string, UiThemeToken> = new Map(
  UI_THEME_TOKENS.map((token) => [token.key, token])
);

const UI_THEME_SCOPES: readonly UiThemeScope[] = ["light", "dark", "both"];

/** 오류 문장에 쓰는 스코프 이름. */
const SCOPE_LABELS: Record<UiThemeScope, string> = {
  light: "라이트",
  dark: "다크",
  both: "공용",
};

/**
 * 오류 문장에 되싣는 값의 길이 한계. 화면이 보낸 것이 아니라 손으로 만든 요청일
 * 때 여기 들어오는 문자열은 얼마든지 길 수 있고, 그것을 통째로 되돌려주면 오류
 * 상자가 화면을 밀어낸다.
 */
const ECHO_LIMIT = 40;

function echo(raw: unknown): string {
  const text = typeof raw === "string" ? raw : String(raw);
  return text.length > ECHO_LIMIT ? `${text.slice(0, ECHO_LIMIT)}…` : text;
}

export function isUiThemeScope(value: unknown): value is UiThemeScope {
  return typeof value === "string" && (UI_THEME_SCOPES as readonly string[]).includes(value);
}

/**
 * 스코프가 토큰의 성격과 맞는가.
 *
 * scoped:true 인 토큰(색)은 라이트·다크 행을 따로 갖고, scoped:false 인 토큰
 * (모서리·글자 크기)은 "both" 행 하나만 갖는다. 어긋난 행은 조회가 조용히
 * 버리므로(resolveUiTheme), 저장을 허용하면 "DB 에는 있는데 아무 화면도 안
 * 바뀌는" 행이 남는다.
 */
export function scopeFitsUiThemeToken(token: UiThemeToken, scope: UiThemeScope): boolean {
  return token.scoped ? scope === "light" || scope === "dark" : scope === "both";
}

/**
 * 이 (토큰, 스코프) 자리에서 통하는 코드의 기본값.
 *
 * scoped:false 인 토큰은 defaultLight 로 본다 — 등록부가 defaultLight ===
 * defaultDark 를 보장하고, ui-theme-tokens.test.ts 가 그것을 단언한다.
 */
export function uiThemeDefaultFor(token: UiThemeToken, scope: UiThemeScope): string {
  return scope === "dark" ? token.defaultDark : token.defaultLight;
}

/**
 * 한 줄분의 검증.
 *
 * mutation 이 트랜잭션 안에서 **한 줄씩** 부른다(그래서 앞줄이 이미 저장된 뒤에
 * 뒷줄이 막히는 길이 실제로 열리고, 그때 트랜잭션째 되돌아가는 것이 통합 시험의
 * 확인 대상이다). 서버 액션은 아래의 배열 단위 함수로 같은 규칙을 한 번 먼저
 * 본다 — 규칙 자체는 이 함수 하나에만 있다.
 */
export function checkUiThemeTokenChange(raw: unknown): CheckUiThemeTokenChangeResult {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, message: "화면 토큰 입력을 확인할 수 없습니다." };
  }

  const { tokenKey, scope, value } = raw as {
    tokenKey?: unknown;
    scope?: unknown;
    value?: unknown;
  };

  if (typeof tokenKey !== "string" || tokenKey.length === 0) {
    return { ok: false, message: "화면 토큰 이름을 확인할 수 없습니다." };
  }
  const token = TOKEN_BY_KEY.get(tokenKey);
  if (!token) {
    return { ok: false, message: `등록되지 않은 화면 토큰입니다: ${echo(tokenKey)}` };
  }

  if (!isUiThemeScope(scope)) {
    return { ok: false, message: `화면 토큰의 적용 범위를 확인할 수 없습니다: ${echo(scope)}` };
  }
  if (!scopeFitsUiThemeToken(token, scope)) {
    return {
      ok: false,
      message: token.scoped
        ? `${token.label}은(는) 라이트·다크를 따로 저장합니다. 공용으로는 저장할 수 없습니다.`
        : `${token.label}은(는) 라이트·다크를 나누지 않습니다. ${SCOPE_LABELS[scope]}로는 저장할 수 없습니다.`,
    };
  }

  // 기본값 복귀. 이 한 값만 문자열이 아닌 채로 통과한다.
  if (value === null) return { ok: true, change: { token, scope, value: null } };

  if (typeof value !== "string") {
    return { ok: false, message: `${token.label} 값을 확인할 수 없습니다.` };
  }

  const normalized = normalizeUiThemeValue(token, value);
  if (normalized === null) {
    return { ok: false, message: `${token.label}에 넣을 수 없는 값입니다: ${echo(value)}` };
  }

  return { ok: true, change: { token, scope, value: normalized } };
}

/**
 * 같은 (토큰, 스코프)가 두 번 들어왔는가. 있으면 그 사실을 알리는 문장을,
 * 없으면 null 을 돌려준다.
 *
 * 어느 쪽이 뜻인지 알 수 없고, 뒤엣것으로 덮어쓰면 화면에서 본 것과 다른 값이
 * 저장될 수 있다(saveNotificationSettings 가 같은 판단을 한다). 이 검사는 값이
 * 유효한지와 무관하므로 배열 전체를 한 번 훑는 자리에 따로 둔다.
 */
export function findDuplicateUiThemeChange(
  changes: readonly UiThemeTokenChange[]
): string | null {
  const seen = new Set<string>();
  for (const change of changes) {
    const key = `${String(change?.tokenKey)}:${String(change?.scope)}`;
    if (seen.has(key)) {
      return `같은 값이 두 번 들어왔습니다: ${echo(change?.tokenKey)} (${echo(change?.scope)})`;
    }
    seen.add(key);
  }
  return null;
}

/**
 * 서버 액션이 부르는 배열 단위 검증. 하나라도 막히면 전부 거절한다 — 반쯤
 * 저장되면 어느 값이 살아 있는지 화면과 DB 가 달라진다.
 */
export function validateUiThemeTokenChanges(raw: unknown): ValidateUiThemeTokenChangesResult {
  if (!Array.isArray(raw)) {
    return { ok: false, message: "화면 토큰 입력을 확인할 수 없습니다." };
  }

  const data: CheckedUiThemeTokenChange[] = [];
  for (const item of raw) {
    const checked = checkUiThemeTokenChange(item);
    if (!checked.ok) return { ok: false, message: checked.message };
    data.push(checked.change);
  }

  const duplicate = findDuplicateUiThemeChange(raw as UiThemeTokenChange[]);
  if (duplicate) return { ok: false, message: duplicate };

  return { ok: true, data };
}
