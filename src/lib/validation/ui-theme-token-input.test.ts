import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkUiThemeTokenChange,
  findDuplicateUiThemeChange,
  scopeFitsUiThemeToken,
  uiThemeDefaultFor,
  validateUiThemeTokenChanges,
} from "./ui-theme-token-input";
import { UI_THEME_TOKENS, type UiThemeToken } from "@/lib/domain/ui-theme-tokens";

/**
 * ============================================================================
 * 화면 토큰 입력 검증 — 순수 판정만
 * ============================================================================
 * 여기서 지키려는 것 하나: **모르는 것은 조용히 버리지 않고 거절한다.** 알림
 * 설정과 반대로 가는 자리이고, 이 판정이 무너지면 "저장했는데 화면이 안 바뀐다"가
 * 고장과 구별되지 않게 된다(모듈 머리말).
 *
 * DB 도 세션도 여기 들어오지 않는다 — 인가는 mutation 이, 대비 하한은 저장된 행
 * 전부를 봐야 알 수 있으므로 역시 mutation 이 본다.
 * ============================================================================
 */

function tokenOf(key: string): UiThemeToken {
  const token = UI_THEME_TOKENS.find((candidate) => candidate.key === key);
  assert.ok(token, `등록부에 ${key} 가 없다 — 이 시험의 전제가 사라졌다`);
  return token;
}

const zinc900 = tokenOf("zinc-900");
const background = tokenOf("background");
const radiusMd = tokenOf("radius-md");
const textSm = tokenOf("text-sm");

test("전제: 색은 스코프를 나누고, 모서리·글자 크기는 나누지 않는다", () => {
  assert.equal(zinc900.scoped, true);
  assert.equal(background.scoped, true);
  assert.equal(radiusMd.scoped, false);
  assert.equal(textSm.scoped, false);
});

// ─────────────────────────────────────────────────────── 정상 입력

test("정상 입력은 정규화된 값과 함께 통과한다", () => {
  const result = checkUiThemeTokenChange({ tokenKey: "zinc-900", scope: "light", value: "#112233" });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.change.token.key, "zinc-900");
  assert.equal(result.change.scope, "light");
  assert.equal(result.change.value, "#112233");
});

test("표기만 다른 값은 정규화되어 통과한다 — 대문자 hex·앞의 0 생략", () => {
  // <input type="color"> 가 브라우저에 따라 대문자를 준다. 그대로 저장하면
  // 기본값과 같은 색인데 문자열이 달라 "되돌렸는데 행이 안 지워지는" 상태가 된다.
  const upper = checkUiThemeTokenChange({ tokenKey: "background", scope: "dark", value: "#AABBCC" });
  assert.equal(upper.ok, true);
  if (upper.ok) assert.equal(upper.change.value, "#aabbcc");

  const shortLength = checkUiThemeTokenChange({ tokenKey: "radius-md", scope: "both", value: ".5rem" });
  assert.equal(shortLength.ok, true);
  if (shortLength.ok) assert.equal(shortLength.change.value, "0.5rem");

  const zero = checkUiThemeTokenChange({ tokenKey: "radius-md", scope: "both", value: "0px" });
  assert.equal(zero.ok, true);
  if (zero.ok) assert.equal(zero.change.value, "0");
});

test("value: null 은 기본값으로 되돌리라는 뜻이라 통과한다", () => {
  const result = checkUiThemeTokenChange({ tokenKey: "text-sm", scope: "both", value: null });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.change.value, null);
});

// ─────────────────────────────────────────────────────── 거절

test("🔴 등록부에 없는 키는 거절한다 — 조용히 버리지 않는다", () => {
  for (const tokenKey of ["nope-999", "zinc-1000", "--color-zinc-900", "zinc-900;}html{display:none"]) {
    const result = checkUiThemeTokenChange({ tokenKey, scope: "light", value: "#112233" });
    assert.equal(result.ok, false, `${tokenKey} 가 통과했다`);
  }
});

test("긴 키를 되싣지 않는다 — 오류 문장이 화면을 밀어내면 안 된다", () => {
  const result = checkUiThemeTokenChange({ tokenKey: "x".repeat(500), scope: "light", value: "#112233" });
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.message.length < 100, `오류 문장이 너무 길다: ${result.message.length}`);
});

test("🔴 토큰 성격과 안 맞는 스코프는 거절한다", () => {
  // 색은 라이트/다크를 따로 갖는다 — "both" 로 저장하면 조회가 그 행을 버려서
  // DB 에는 있는데 아무 화면도 안 바뀐다.
  assert.equal(checkUiThemeTokenChange({ tokenKey: "zinc-900", scope: "both", value: "#112233" }).ok, false);
  // 모서리·글자 크기는 나누지 않는다.
  assert.equal(checkUiThemeTokenChange({ tokenKey: "radius-md", scope: "light", value: "0.5rem" }).ok, false);
  assert.equal(checkUiThemeTokenChange({ tokenKey: "text-sm", scope: "dark", value: "1rem" }).ok, false);
});

test("셋 중 하나가 아닌 스코프는 거절한다", () => {
  for (const scope of ["print", "LIGHT", "", null, 1, undefined]) {
    const result = checkUiThemeTokenChange({ tokenKey: "zinc-900", scope, value: "#112233" });
    assert.equal(result.ok, false, `${String(scope)} 가 통과했다`);
  }
});

test("🔴 형식이 틀린 값은 거절한다 — 이 좁음이 이 축의 CSS 주입 방어선이다", () => {
  const rejected: { tokenKey: string; scope: string; value: unknown }[] = [
    { tokenKey: "zinc-900", scope: "light", value: "#fff" }, // 3자리 축약
    { tokenKey: "zinc-900", scope: "light", value: "#11223344" }, // 8자리 알파
    { tokenKey: "zinc-900", scope: "light", value: "oklch(0.5 0.1 200)" },
    { tokenKey: "zinc-900", scope: "light", value: "var(--evil)" },
    { tokenKey: "zinc-900", scope: "light", value: "#112233;}body{display:none}" },
    { tokenKey: "zinc-900", scope: "light", value: "red" },
    { tokenKey: "zinc-900", scope: "light", value: "" },
    { tokenKey: "radius-md", scope: "both", value: "6" }, // 단위 없는 맨숫자
    { tokenKey: "radius-md", scope: "both", value: "3rem" }, // 상한(2rem) 밖
    { tokenKey: "radius-md", scope: "both", value: "calc(1rem + 2px)" },
    { tokenKey: "text-sm", scope: "both", value: "14px" }, // 글자 크기는 px 를 받지 않는다
    { tokenKey: "text-sm", scope: "both", value: "0.5rem" }, // 하한 밖
    { tokenKey: "text-sm", scope: "both", value: "2rem" }, // 상한 밖
  ];

  for (const change of rejected) {
    const result = checkUiThemeTokenChange(change);
    assert.equal(result.ok, false, `${change.tokenKey} = ${String(change.value)} 가 통과했다`);
  }
});

test("value 를 빠뜨린 요청은 거절한다 — 되돌리려면 null 을 명시해야 한다", () => {
  // 칸을 빠뜨린 요청과 되돌리려는 요청이 같은 모양이면, 화면의 버그 하나가
  // 조용히 오버라이드를 지우는 조작이 된다.
  assert.equal(checkUiThemeTokenChange({ tokenKey: "zinc-900", scope: "light" }).ok, false);
  assert.equal(
    checkUiThemeTokenChange({ tokenKey: "zinc-900", scope: "light", value: undefined }).ok,
    false
  );
  assert.equal(checkUiThemeTokenChange({ tokenKey: "zinc-900", scope: "light", value: 16 }).ok, false);
});

test("한 줄 자체가 객체가 아니면 거절한다", () => {
  for (const raw of [null, undefined, "zinc-900", 1, [], true]) {
    assert.equal(checkUiThemeTokenChange(raw).ok, false, `${String(raw)} 가 통과했다`);
  }
});

// ────────────────────────────────────────────────── 배열 단위 판정

test("🔴 같은 (토큰, 스코프)가 두 번 오면 거절한다", () => {
  const duplicated = [
    { tokenKey: "zinc-900", scope: "light", value: "#112233" },
    { tokenKey: "zinc-900", scope: "light", value: "#332211" },
  ];
  assert.notEqual(findDuplicateUiThemeChange(duplicated), null);
  assert.equal(validateUiThemeTokenChanges(duplicated).ok, false);

  // 스코프가 다르면 중복이 아니다 — 라이트와 다크는 서로 다른 행이다.
  const bothScopes = [
    { tokenKey: "zinc-900", scope: "light", value: "#112233" },
    { tokenKey: "zinc-900", scope: "dark", value: "#332211" },
  ];
  assert.equal(findDuplicateUiThemeChange(bothScopes), null);
  assert.equal(validateUiThemeTokenChanges(bothScopes).ok, true);
});

test("🔴 한 줄이 막히면 배열 전체가 거절된다", () => {
  const result = validateUiThemeTokenChanges([
    { tokenKey: "zinc-900", scope: "light", value: "#112233" }, // 그 자체로는 정상
    { tokenKey: "zinc-900", scope: "dark", value: "oklch(0.5 0.1 200)" }, // 여기서 전체가 막힌다
  ]);
  assert.equal(result.ok, false);
});

test("배열이 아니면 거절한다", () => {
  for (const raw of [null, undefined, {}, "changes", 1]) {
    assert.equal(validateUiThemeTokenChanges(raw).ok, false, `${String(raw)} 가 통과했다`);
  }
});

test("빈 배열은 통과한다 — 바꿀 것이 없는 것은 오류가 아니다", () => {
  const result = validateUiThemeTokenChanges([]);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.data.length, 0);
});

test("여러 줄이 정규화된 값과 함께 통과한다", () => {
  const result = validateUiThemeTokenChanges([
    { tokenKey: "background", scope: "light", value: "#FFFFFE" },
    { tokenKey: "radius-md", scope: "both", value: ".5rem" },
    { tokenKey: "text-sm", scope: "both", value: null },
  ]);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(
    result.data.map((change) => [change.token.key, change.scope, change.value]),
    [
      ["background", "light", "#fffffe"],
      ["radius-md", "both", "0.5rem"],
      ["text-sm", "both", null],
    ]
  );
});

// ────────────────────────────────────────────────────────── 도우미

test("스코프 적합성 판정", () => {
  assert.equal(scopeFitsUiThemeToken(zinc900, "light"), true);
  assert.equal(scopeFitsUiThemeToken(zinc900, "dark"), true);
  assert.equal(scopeFitsUiThemeToken(zinc900, "both"), false);
  assert.equal(scopeFitsUiThemeToken(radiusMd, "both"), true);
  assert.equal(scopeFitsUiThemeToken(radiusMd, "light"), false);
  assert.equal(scopeFitsUiThemeToken(radiusMd, "dark"), false);
});

test("스코프별 기본값 — scoped:false 는 defaultLight 로 본다", () => {
  assert.equal(uiThemeDefaultFor(background, "light"), background.defaultLight);
  assert.equal(uiThemeDefaultFor(background, "dark"), background.defaultDark);
  assert.notEqual(background.defaultLight, background.defaultDark, "이 시험의 전제가 사라졌다");

  // 등록부가 scoped:false 토큰의 두 기본값이 같음을 보장한다(1단계 시험이 단언한다).
  assert.equal(radiusMd.defaultLight, radiusMd.defaultDark);
  assert.equal(uiThemeDefaultFor(radiusMd, "both"), radiusMd.defaultLight);
});
