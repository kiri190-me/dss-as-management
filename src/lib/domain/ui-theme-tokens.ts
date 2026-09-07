/**
 * ============================================================================
 * 화면 토큰 — 등록부·검증기·직렬화
 * ============================================================================
 * 관리자가 코드를 고치지 않고 앱의 색·모서리·글자 크기를 바꿀 수 있게 하는 축의
 * 맨 아래 조각이다. DB도, server-only도 여기 들어오지 않는다 —
 * notification-settings.ts가 알림 쪽에서 하는 일과 같은 자리다. 화면(나중에 붙을
 * 편집기)과 서버(나중에 붙을 저장·조회)와 루트 레이아웃이 **같은 규칙**을 쓰게
 * 하려고 가운데에 두었고, 그래서 Node 단위 테스트로 그대로 돈다.
 *
 * ── 왜 변수를 덮어쓰는 것만으로 화면이 바뀌는가 ─────────────────────────
 * Tailwind v4는 CSS-first다(이 저장소에 tailwind.config 파일이 없다). 컴파일된
 * CSS를 열어 보면 유틸리티 클래스가 전부 변수를 한 번 거친다:
 *
 *     .text-zinc-400 { color: var(--color-zinc-400); }
 *     .rounded-md    { border-radius: var(--radius-md); }
 *     .text-sm       { font-size: var(--text-sm); }
 *
 * 즉 앱 전체의 색 클래스 약 9,900회가 이미 변수를 거치고 있다. 컴포넌트를 한 줄도
 * 고치지 않고 변수만 덮어쓰면 화면이 바뀐다. 라이트/다크도 **같은 변수를 쓰되
 * 단계 번호가 다를 뿐**이다(`text-zinc-900 dark:text-zinc-50`) — 그래서 팔레트
 * 자체는 한 벌이고, 스코프는 "그 단계를 어느 쪽에서 쓰는가"의 문제가 된다.
 *
 * ── 논리 키만 저장하고 CSS 변수 이름은 코드 상수로만 둔다 ───────────────
 * DB에 들어가는 것은 `key`("zinc-900")뿐이고 `cssVar`("--color-zinc-900")는 이
 * 파일의 상수로만 존재한다. 저장된 문자열이 그대로 변수 이름이 되는 길을 아예
 * 만들지 않기 위해서다 — 이름을 문자열 연결로 조립하면(`"--color-" + key`) DB에
 * 들어간 아무 문자열이나 선택자 안으로 흘러 들어간다. 등록부에서 찾지 못한 키는
 * 병합에서도 직렬화에서도 조용히 버려진다.
 *
 * ── 색을 hex 6자리로만 받는 것이 곧 CSS 주입 차단이다 ───────────────────
 * 검증기가 색에 허용하는 문자는 `#`과 `0-9a-f` 여섯 자뿐이다. 그러면 `;` `}` `(`
 * `<` `\` 공백이 애초에 값 안으로 들어올 수 없고, 규칙을 탈출해 새 선택자나
 * `</style>`을 여는 일이 **문법적으로 불가능**해진다. 이것이 이 축의 유일한
 * 주입 방어선이므로 나중에 편해 보인다는 이유로 넓히면 안 된다 —
 * `oklch()` · `var()` · `color-mix()` · 8자리 알파 hex · 3자리 축약형은 전부
 * 거절한다. 길이·모서리 쪽도 같은 이유로 "숫자 + 정해진 단위"만 받는다.
 *
 * ── 대문자를 소문자로 정규화하는 이유 ───────────────────────────────────
 * `<input type="color">`는 브라우저에 따라 `#FFFFFF`를 돌려준다. 그대로 저장하면
 * 기본값 `#ffffff`와 **같은 색인데 문자열이 다르다**. 그러면 "기본값으로
 * 되돌렸는데 오버라이드 행이 안 지워지는" 상태가 생기고, 저장된 행 수가 화면의
 * "바꾼 것" 표시와 어긋나기 시작한다. 값을 받는 첫 자리에서 소문자로 눕혀 둔다.
 *
 * ── 라이트 블록의 `:not(.dark)`가 이 설계에서 가장 깨지기 쉬운 자리다 ───
 * globals.css의 `:root{--background}`와 `.dark{--background}`는 **레이어 밖**에
 * 있어서 레이어 규칙이 둘을 갈라 주지 않는다. 라이트 오버라이드를
 * `:root:root`(0,2,0)로만 적으면 `.dark`(0,1,0)를 **다크 모드에서도** 이겨
 * 다크 배경이 흰색이 된다. `:not(.dark)`를 붙이면 (0,3,0)이 되고, 다크 블록
 * `:root:root.dark`도 (0,3,0)이라 **상호 배타 + 같은 명시도**가 되어 순서 다툼
 * 자체가 사라진다. `!important`는 쓰지 않는다 — 한 번 쓰면 그 뒤로 무엇으로도
 * 못 이기고, 인쇄 규칙(globals.css의 `@media print`)이 실제로 그 자리를 쓰고 있다.
 * ============================================================================
 */

export type UiThemeTokenKind = "color" | "radius" | "fontSize";
export type UiThemeScope = "light" | "dark" | "both";

export type UiThemeToken = {
  /** 논리 키. DB에 저장되는 값. 예: "zinc-900" */
  key: string;
  /** 실제 CSS 변수 이름. DB에는 절대 저장하지 않는다 — 코드 상수로만 존재한다. 예: "--color-zinc-900" */
  cssVar: string;
  kind: UiThemeTokenKind;
  /** true면 라이트/다크를 따로 저장한다. false면 "both" 하나만 허용한다. */
  scoped: boolean;
  /** 화면에 보일 한글 이름 */
  label: string;
  /** 어디에 쓰이는지 한 줄 */
  usage: string;
  defaultLight: string;
  /** scoped:false 이면 defaultLight 와 반드시 같아야 한다 */
  defaultDark: string;
};

/**
 * 관리자가 만질 수 있는 값 전부.
 *
 * ── 기본값은 어디서 왔는가 ──────────────────────────────────────────────
 * 추측해서 적은 값이 하나도 없다. zinc·red 램프와 모서리·글자 크기는 컴파일된
 * CSS 청크(.next/dev/static/chunks/src_app_globals_css_*.single.css)의
 * `@layer theme { :root, :host { … } }`에서 실제 방출값을 읽었고,
 * node_modules/tailwindcss/theme.css로 교차 확인했다. 그 청크에는
 * `@supports (color: lab(...))` 상위 분기가 있어 같은 변수가 두 번 나오는데
 * **hex 쪽을 적었다** — `<input type="color">`가 주고받는 표기가 그것이고,
 * 검증기가 받는 표기도 그것이다. `background`/`foreground` 둘만
 * src/app/globals.css에서 읽었다(이 저장소가 직접 정의하는 변수라서).
 *
 * ── 왜 라이트/다크 기본값이 대부분 같은가 ───────────────────────────────
 * zinc·red는 **팔레트**이지 역할이 아니다. 라이트 화면은 zinc-900을 글자로,
 * 다크 화면은 같은 zinc-900을 카드 바탕으로 쓴다 — 색 자체는 한 벌이고 쓰는
 * 자리가 다를 뿐이다. 그래도 `scoped: true`로 둔 이유는, 다크에서만 한 단계를
 * 살짝 눕히고 싶은 요구가 실제로 생기기 때문이다(예: 다크의 zinc-400만 조금 더
 * 밝게). 반대로 `background`/`foreground` 둘은 애초에 두 값이 다르다.
 *
 * 모서리·글자 크기는 `scoped: false`다. 다크에서만 모서리가 둥글어지거나 글자가
 * 커질 이유가 없고, 나눠 두면 한쪽만 고쳐진 채로 남는 길만 열린다.
 *
 * red-500은 지금 앱에서 거의 쓰이지 않지만 넣었다 — 램프에 구멍을 내면 "50부터
 * 950까지 한 줄"이라는 편집 화면의 모양이 깨지고, 나중에 누가 그 단계를 쓰기
 * 시작하는 날 혼자만 못 바꾸는 색이 된다.
 */
export const UI_THEME_TOKENS: readonly UiThemeToken[] = [
  // ── 중립(zinc) — 글자·바탕·테두리 전부가 이 램프 위에 있다 ────────────
  {
    key: "zinc-50",
    cssVar: "--color-zinc-50",
    kind: "color",
    scoped: true,
    label: "가장 연한 중립",
    usage: "라이트 표 머리·연한 바탕 · 다크 제목 글자",
    defaultLight: "#fafafa",
    defaultDark: "#fafafa",
  },
  {
    key: "zinc-100",
    cssVar: "--color-zinc-100",
    kind: "color",
    scoped: true,
    label: "연한 중립",
    usage: "라이트 마우스 올린 줄 바탕 · 비활성 칸 바탕",
    defaultLight: "#f4f4f5",
    defaultDark: "#f4f4f5",
  },
  {
    key: "zinc-200",
    cssVar: "--color-zinc-200",
    kind: "color",
    scoped: true,
    label: "옅은 중립",
    usage: "라이트 카드 테두리·표 구분선",
    defaultLight: "#e4e4e7",
    defaultDark: "#e4e4e7",
  },
  {
    key: "zinc-300",
    cssVar: "--color-zinc-300",
    kind: "color",
    scoped: true,
    label: "밝은 중립",
    usage: "라이트 입력칸·단추 테두리 · 다크 단추 글자",
    defaultLight: "#d4d4d8",
    defaultDark: "#d4d4d8",
  },
  {
    key: "zinc-400",
    cssVar: "--color-zinc-400",
    kind: "color",
    scoped: true,
    label: "중간 밝은 중립",
    usage: "다크 보조 설명 글자 · 라이트 흐린 아이콘",
    defaultLight: "#9f9fa9",
    defaultDark: "#9f9fa9",
  },
  {
    key: "zinc-500",
    cssVar: "--color-zinc-500",
    kind: "color",
    scoped: true,
    label: "중간 중립",
    usage: "라이트 흐린 설명 글자·안내 문구",
    defaultLight: "#71717b",
    defaultDark: "#71717b",
  },
  {
    key: "zinc-600",
    cssVar: "--color-zinc-600",
    kind: "color",
    scoped: true,
    label: "중간 어두운 중립",
    usage: "라이트 본문 보조 글자 · 다크 흐린 구분 표시",
    defaultLight: "#52525c",
    defaultDark: "#52525c",
  },
  {
    key: "zinc-700",
    cssVar: "--color-zinc-700",
    kind: "color",
    scoped: true,
    label: "어두운 중립",
    usage: "라이트 단추·아이콘 글자 · 다크 입력칸 테두리",
    defaultLight: "#3f3f46",
    defaultDark: "#3f3f46",
  },
  {
    key: "zinc-800",
    cssVar: "--color-zinc-800",
    kind: "color",
    scoped: true,
    label: "진한 중립",
    usage: "다크 카드 테두리·마우스 올린 줄 바탕",
    defaultLight: "#27272a",
    defaultDark: "#27272a",
  },
  {
    key: "zinc-900",
    cssVar: "--color-zinc-900",
    kind: "color",
    scoped: true,
    label: "가장 진한 중립",
    usage: "라이트 제목 글자 · 다크 카드 바탕",
    defaultLight: "#18181b",
    defaultDark: "#18181b",
  },
  {
    key: "zinc-950",
    cssVar: "--color-zinc-950",
    kind: "color",
    scoped: true,
    label: "먹빛 중립",
    usage: "다크에서 가장 깊은 바탕(패널 뒤·표 머리)",
    defaultLight: "#09090b",
    defaultDark: "#09090b",
  },

  // ── 경고(red) — 삭제·오류·기한 초과가 전부 이 램프 위에 있다 ──────────
  {
    key: "red-50",
    cssVar: "--color-red-50",
    kind: "color",
    scoped: true,
    label: "가장 연한 경고",
    usage: "라이트 경고 상자·삭제 확인 창 바탕",
    defaultLight: "#fef2f2",
    defaultDark: "#fef2f2",
  },
  {
    key: "red-100",
    cssVar: "--color-red-100",
    kind: "color",
    scoped: true,
    label: "연한 경고",
    usage: "라이트 경고 배지 바탕",
    defaultLight: "#ffe2e2",
    defaultDark: "#ffe2e2",
  },
  {
    key: "red-200",
    cssVar: "--color-red-200",
    kind: "color",
    scoped: true,
    label: "옅은 경고",
    usage: "라이트 경고 상자 테두리",
    defaultLight: "#ffcaca",
    defaultDark: "#ffcaca",
  },
  {
    key: "red-300",
    cssVar: "--color-red-300",
    kind: "color",
    scoped: true,
    label: "밝은 경고",
    usage: "다크 경고 상자 테두리 · 라이트 위험 단추 테두리",
    defaultLight: "#ffa3a3",
    defaultDark: "#ffa3a3",
  },
  {
    key: "red-400",
    cssVar: "--color-red-400",
    kind: "color",
    scoped: true,
    label: "중간 밝은 경고",
    usage: "다크 경고 글자·기한 초과 표시",
    defaultLight: "#ff6568",
    defaultDark: "#ff6568",
  },
  {
    key: "red-500",
    cssVar: "--color-red-500",
    kind: "color",
    scoped: true,
    label: "중간 경고",
    usage: "경고 램프의 가운데 단계(지금은 거의 쓰지 않지만 램프를 끊지 않으려고 둔다)",
    defaultLight: "#fb2c36",
    defaultDark: "#fb2c36",
  },
  {
    key: "red-600",
    cssVar: "--color-red-600",
    kind: "color",
    scoped: true,
    label: "중간 진한 경고",
    usage: "라이트 위험 단추 바탕",
    defaultLight: "#e40014",
    defaultDark: "#e40014",
  },
  {
    key: "red-700",
    cssVar: "--color-red-700",
    kind: "color",
    scoped: true,
    label: "진한 경고",
    usage: "라이트 경고 글자·삭제 안내 문구",
    defaultLight: "#bf000f",
    defaultDark: "#bf000f",
  },
  {
    key: "red-800",
    cssVar: "--color-red-800",
    kind: "color",
    scoped: true,
    label: "더 진한 경고",
    usage: "라이트 위험 단추 누른 상태",
    defaultLight: "#9f0712",
    defaultDark: "#9f0712",
  },
  {
    key: "red-900",
    cssVar: "--color-red-900",
    kind: "color",
    scoped: true,
    label: "가장 진한 경고",
    usage: "다크 경고 상자 테두리·위험 단추 바탕",
    defaultLight: "#82181a",
    defaultDark: "#82181a",
  },
  {
    key: "red-950",
    cssVar: "--color-red-950",
    kind: "color",
    scoped: true,
    label: "먹빛 경고",
    usage: "다크 경고 상자 바탕",
    defaultLight: "#460809",
    defaultDark: "#460809",
  },

  // ── 페이지 바탕과 본문 글자 — 이 둘만 라이트/다크 기본값이 다르다 ─────
  {
    key: "background",
    cssVar: "--background",
    kind: "color",
    scoped: true,
    label: "페이지 바탕",
    usage: "모든 화면의 가장 뒤 바탕색(body)",
    defaultLight: "#ffffff",
    defaultDark: "#0a0a0a",
  },
  {
    key: "foreground",
    cssVar: "--foreground",
    kind: "color",
    scoped: true,
    label: "본문 글자",
    usage: "따로 색을 정하지 않은 모든 글자(body)",
    defaultLight: "#171717",
    defaultDark: "#ededed",
  },

  // ── 모서리 — 라이트/다크를 나누지 않는다 ──────────────────────────────
  {
    key: "radius-sm",
    cssVar: "--radius-sm",
    kind: "radius",
    scoped: false,
    label: "작은 모서리",
    usage: "배지·작은 표식의 둥글기",
    defaultLight: "0.25rem",
    defaultDark: "0.25rem",
  },
  {
    key: "radius-md",
    cssVar: "--radius-md",
    kind: "radius",
    scoped: false,
    label: "기본 모서리",
    usage: "단추·입력칸의 둥글기(앱에서 가장 많이 쓰인다)",
    defaultLight: "0.375rem",
    defaultDark: "0.375rem",
  },
  {
    key: "radius-lg",
    cssVar: "--radius-lg",
    kind: "radius",
    scoped: false,
    label: "큰 모서리",
    usage: "카드·패널의 둥글기",
    defaultLight: "0.5rem",
    defaultDark: "0.5rem",
  },
  {
    key: "radius-xl",
    cssVar: "--radius-xl",
    kind: "radius",
    scoped: false,
    label: "더 큰 모서리",
    usage: "확인 창·큰 상자의 둥글기",
    defaultLight: "0.75rem",
    defaultDark: "0.75rem",
  },
  {
    key: "radius-2xl",
    cssVar: "--radius-2xl",
    kind: "radius",
    scoped: false,
    label: "가장 큰 모서리",
    usage: "전면 패널·큰 그림 상자의 둥글기",
    defaultLight: "1rem",
    defaultDark: "1rem",
  },

  // ── 글자 크기 — 역시 라이트/다크를 나누지 않는다 ──────────────────────
  {
    key: "text-xs",
    cssVar: "--text-xs",
    kind: "fontSize",
    scoped: false,
    label: "아주 작은 글자",
    usage: "배지·꼬리말·보조 안내 문구",
    defaultLight: "0.75rem",
    defaultDark: "0.75rem",
  },
  {
    key: "text-sm",
    cssVar: "--text-sm",
    kind: "fontSize",
    scoped: false,
    label: "작은 글자",
    usage: "표 내용·목록 본문(앱에서 가장 많이 쓰인다)",
    defaultLight: "0.875rem",
    defaultDark: "0.875rem",
  },
  {
    key: "text-base",
    cssVar: "--text-base",
    kind: "fontSize",
    scoped: false,
    label: "기본 글자",
    usage: "본문 문단·입력칸 글자",
    defaultLight: "1rem",
    defaultDark: "1rem",
  },
  {
    key: "text-lg",
    cssVar: "--text-lg",
    kind: "fontSize",
    scoped: false,
    label: "큰 글자",
    usage: "카드 제목·구역 소제목",
    defaultLight: "1.125rem",
    defaultDark: "1.125rem",
  },
  {
    key: "text-xl",
    cssVar: "--text-xl",
    kind: "fontSize",
    scoped: false,
    label: "더 큰 글자",
    usage: "화면 제목",
    defaultLight: "1.25rem",
    defaultDark: "1.25rem",
  },
  {
    key: "text-2xl",
    cssVar: "--text-2xl",
    kind: "fontSize",
    scoped: false,
    label: "가장 큰 글자",
    usage: "대시보드 큰 숫자·강조 제목",
    defaultLight: "1.5rem",
    defaultDark: "1.5rem",
  },
];

/** 키로 토큰을 찾는 표. 등록부에 없는 키는 어디서도 통과하지 못한다. */
const UI_THEME_TOKEN_BY_KEY: ReadonlyMap<string, UiThemeToken> = new Map(
  UI_THEME_TOKENS.map((token) => [token.key, token])
);

// ─────────────────────────────────────────────────────────────── 검증기

/** 1rem이 몇 px인가. 상·하한을 한 자로 비교하려고만 쓴다(브라우저 설정과 무관). */
const REM_IN_PX = 16;

/** 모서리 하한/상한. 0 ~ 2rem. */
const RADIUS_MIN_PX = 0;
const RADIUS_MAX_PX = 2 * REM_IN_PX;

/**
 * 글자 크기 하한/상한. 0.625rem ~ 1.5rem.
 *
 * 아래로 열어 두면 표 내용이 읽을 수 없게 되고, 위로 열어 두면 사이드바·표
 * 머리가 줄바꿈되며 화면이 무너진다. 되돌릴 화면 자체를 못 읽게 만드는 값은
 * 애초에 받지 않는다 — 대비 하한(UI_THEME_CONTRAST_FLOOR)과 같은 성격의 방어다.
 */
const FONT_SIZE_MIN_PX = 0.625 * REM_IN_PX;
const FONT_SIZE_MAX_PX = 1.5 * REM_IN_PX;

/** 색: `#` + hex 6자리. 이 좁음이 곧 주입 차단이다(파일 머리말). */
const COLOR_PATTERN = /^#[0-9a-f]{6}$/;

/** 길이: 숫자 + 선택적 단위. 괄호·공백·연산자가 들어올 자리가 없다. */
const LENGTH_PATTERN = /^(\d+(?:\.\d+)?|\.\d+)(rem|px)?$/;

function normalizeColorValue(value: string): string | null {
  const lowered = value.toLowerCase();
  return COLOR_PATTERN.test(lowered) ? lowered : null;
}

/**
 * 길이 값을 정규화한다. 숫자 부분을 다시 찍어 내는 이유는 색의 대소문자와 같다 —
 * `.5rem`·`0.50rem`·`0.5rem`이 같은 값인데 문자열이 다르면 "기본값으로 되돌렸는데
 * 행이 안 지워지는" 상태가 생긴다. 0은 단위를 떼고 `"0"` 하나로 모은다.
 */
function normalizeLengthValue(
  value: string,
  options: { allowPx: boolean; allowUnitlessZero: boolean; minPx: number; maxPx: number }
): string | null {
  const match = LENGTH_PATTERN.exec(value);
  if (!match) return null;

  const unit = match[2];
  if (unit === "px" && !options.allowPx) return null;

  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return null;

  // 단위를 생략할 수 있는 길이는 0뿐이다. `6` 같은 맨숫자는 CSS가 무효로 보고
  // 선언을 통째로 버려서, 저장은 됐는데 화면은 그대로인 상태가 된다 —
  // 관리자에게는 기능이 고장 난 것과 구별되지 않는다.
  if (unit === undefined && (!options.allowUnitlessZero || amount !== 0)) return null;

  const px = unit === "px" ? amount : amount * REM_IN_PX;
  if (px < options.minPx || px > options.maxPx) return null;

  if (px === 0) return "0";
  return `${String(amount)}${unit ?? ""}`;
}

/**
 * 값이 유효하면 정규화된 값을, 아니면 null 을 돌려준다.
 *
 * 저장 경로와 출력 경로가 **둘 다** 이 함수를 부른다. 저장 쪽이 언젠가 뚫리거나
 * DB를 손으로 고친 행이 들어와도, 직렬화가 한 번 더 이 문을 통과시킨다.
 */
export function normalizeUiThemeValue(token: UiThemeToken, raw: unknown): string | null {
  if (typeof raw !== "string") return null;

  const value = raw.trim();
  if (value.length === 0) return null;

  switch (token.kind) {
    case "color":
      return normalizeColorValue(value);

    case "radius":
      // 단위 없는 값은 `0` 하나만 받는다 — CSS에서 길이 0만 단위를 생략할 수 있다.
      return normalizeLengthValue(value, {
        allowPx: true,
        allowUnitlessZero: true,
        minPx: RADIUS_MIN_PX,
        maxPx: RADIUS_MAX_PX,
      });

    case "fontSize":
      // px를 받지 않는다. 글자 크기를 px로 못 박으면 브라우저·OS의 글자 확대
      // 설정이 통하지 않아, 눈이 불편한 사람에게 앱이 그대로 안 보이게 된다.
      return normalizeLengthValue(value, {
        allowPx: false,
        allowUnitlessZero: false,
        minPx: FONT_SIZE_MIN_PX,
        maxPx: FONT_SIZE_MAX_PX,
      });

    default:
      // 종류만 늘리고 여기를 빠뜨리면 조용히 통과시키는 것보다 거절하는 편이
      // 낫다. (타입상 여기 닿을 수 없다 — switch가 종류를 남김없이 덮는다.)
      return null;
  }
}

// ─────────────────────────────────────────────────────────────── 대비

/**
 * WCAG 상대휘도로 잰 두 색의 대비비(1 ~ 21).
 *
 * 색 라이브러리를 쓰지 않는다 — 이 저장소는 clsx조차 안 쓴다. 계산식은
 * WCAG 2.1의 relative luminance 정의 그대로다.
 *
 * 소수 두 자리에서 반올림해 돌려준다. 부동소수 찌꺼기가 남으면 검은색/흰색이
 * 21이 아니라 21.000000000000004가 되어, 화면에 그대로 찍히고 시험도 어림수로만
 * 쓸 수 있게 된다. 대비비는 사람이 읽는 숫자이고 임계값도 4.5·3처럼 두 자리다.
 *
 * 형식이 어긋난 색은 던진다 — 여기 오는 값은 이미 normalizeUiThemeValue를 지난
 * 값이어야 하고, 아니라면 그것은 판정할 대상이 아니라 고쳐야 할 버그다.
 */
export function contrastRatio(hexA: string, hexB: string): number {
  const luminanceA = relativeLuminance(hexA);
  const luminanceB = relativeLuminance(hexB);
  const lighter = Math.max(luminanceA, luminanceB);
  const darker = Math.min(luminanceA, luminanceB);
  return Math.round(((lighter + 0.05) / (darker + 0.05)) * 100) / 100;
}

function relativeLuminance(hex: string): number {
  const lowered = hex.trim().toLowerCase();
  if (!COLOR_PATTERN.test(lowered)) {
    throw new Error(`대비를 잴 수 없는 색이다(#rrggbb 여섯 자리만 받는다): ${hex}`);
  }
  const channels = [
    Number.parseInt(lowered.slice(1, 3), 16),
    Number.parseInt(lowered.slice(3, 5), 16),
    Number.parseInt(lowered.slice(5, 7), 16),
  ].map((raw) => {
    const value = raw / 255;
    return value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

export type UiThemeContrastPair = {
  scope: "light" | "dark";
  fgKey: string;
  bgKey: string;
  label: string;
};

/**
 * 대비를 실제로 재는 조합.
 *
 * ── 전 조합을 재지 않는 이유 ────────────────────────────────────────────
 * 색 24개를 전부 맞물려 재면 경고가 수백 줄 쏟아지는데, 그중 거의 전부가 앱에서
 * 절대 겹치지 않는 조합이다. 아무도 안 읽는 경고는 없는 것과 같고, 진짜 문제
 * 하나가 그 안에 묻힌다. 그래서 **화면에서 실제로 겹쳐 놓이는 짝만** 적는다.
 *
 * ── 스코프마다 짝이 다르다는 것이 요점이다 ──────────────────────────────
 * zinc-400은 다크의 보조 문구이지 라이트의 보조 문구가 아니다(라이트에서 그 자리는
 * zinc-500·zinc-600이다). 같은 램프를 양쪽이 다른 자리에 쓰기 때문에, 한 벌의
 * 짝 목록으로는 어느 쪽도 제대로 재지 못한다.
 */
export const UI_THEME_CONTRAST_PAIRS: readonly UiThemeContrastPair[] = [
  {
    scope: "light",
    fgKey: "foreground",
    bgKey: "background",
    label: "라이트 · 본문 글자 / 페이지 바탕",
  },
  {
    scope: "light",
    fgKey: "zinc-900",
    bgKey: "background",
    label: "라이트 · 제목 글자 / 페이지 바탕",
  },
  {
    scope: "light",
    fgKey: "zinc-600",
    bgKey: "background",
    label: "라이트 · 보조 설명 글자 / 페이지 바탕",
  },
  {
    scope: "light",
    fgKey: "zinc-500",
    bgKey: "zinc-50",
    label: "라이트 · 흐린 글자 / 연한 바탕",
  },
  {
    scope: "light",
    fgKey: "zinc-700",
    bgKey: "zinc-50",
    label: "라이트 · 단추 글자 / 연한 바탕",
  },
  {
    scope: "light",
    fgKey: "red-700",
    bgKey: "red-50",
    label: "라이트 · 경고 글자 / 경고 상자 바탕",
  },
  {
    scope: "dark",
    fgKey: "foreground",
    bgKey: "background",
    label: "다크 · 본문 글자 / 페이지 바탕",
  },
  {
    scope: "dark",
    fgKey: "zinc-50",
    bgKey: "background",
    label: "다크 · 제목 글자 / 페이지 바탕",
  },
  {
    scope: "dark",
    fgKey: "zinc-400",
    bgKey: "background",
    label: "다크 · 보조 설명 글자 / 페이지 바탕",
  },
  {
    scope: "dark",
    fgKey: "zinc-300",
    bgKey: "zinc-900",
    label: "다크 · 단추 글자 / 카드 바탕",
  },
  {
    scope: "dark",
    fgKey: "red-400",
    bgKey: "red-950",
    label: "다크 · 경고 글자 / 경고 상자 바탕",
  },
];

/** 미만이면 화면이 경고한다. WCAG AA 본문 기준. */
export const UI_THEME_CONTRAST_WARN = 4.5;

/**
 * 미만이면 서버가 저장 자체를 거절한다.
 *
 * 경고선(4.5)과 따로 두는 이유: 4.5를 저장 조건으로 걸면 "조금 흐린 회색"조차
 * 못 쓰게 되어 이 기능이 사실상 잠긴다. 3:1은 큰 글자 AA 기준이자 "읽기 불편"과
 * "아예 안 보임"을 가르는 자리다. 판단은 관리자에게 맡기고, 되돌릴 화면 자체가
 * 안 보이게 되는 선만 서버가 막는다.
 */
export const UI_THEME_CONTRAST_FLOOR = 3;

/** 저장 거절선을 강제하는 짝의 키. 아래에서 이 집합으로 PAIRS를 걸러 낸다. */
const BLOCKING_PAIR_KEYS: ReadonlySet<string> = new Set([
  "light:foreground:background",
  "dark:foreground:background",
  "light:zinc-900:background",
  "dark:zinc-50:background",
]);

/**
 * 저장을 거절시키는 최소 집합.
 *
 * 이 넷만 고른 이유는 하나다 — "화면이 통째로 안 보인다"의 직접 원인이기
 * 때문이다. 본문 글자와 페이지 바탕이 같은 색이 되면 되돌릴 편집기 자체를 읽을
 * 수 없고, 제목 글자까지 사라지면 어느 화면에 있는지도 알 수 없다. 나머지 짝은
 * 불편하지만 되돌릴 길이 남아 있으므로 경고에 그친다.
 *
 * PAIRS에서 골라 내는 방식이라, 목록을 손보다가 두 벌이 어긋날 수 없다.
 */
export const UI_THEME_CONTRAST_BLOCKING: readonly UiThemeContrastPair[] =
  UI_THEME_CONTRAST_PAIRS.filter((pair) =>
    BLOCKING_PAIR_KEYS.has(`${pair.scope}:${pair.fgKey}:${pair.bgKey}`)
  );

// ─────────────────────────────────────────────── 저장된 값과 기본값의 병합

/**
 * 저장된 오버라이드 한 줄. **기본값과 다른 것만** 행으로 남는다 — 기본값과 같은
 * 값을 굳이 저장하면, 나중에 기본 팔레트를 손볼 때 옛 기본값이 오버라이드로
 * 굳어 버려 아무 화면도 따라 바뀌지 않는다.
 */
export type UiThemeOverrideRow = { tokenKey: string; scope: UiThemeScope; value: string };

/** 라이트/다크 각각의 최종 값. 키는 토큰의 논리 키(cssVar가 아니다). */
export type ResolvedUiTheme = { light: Record<string, string>; dark: Record<string, string> };

/** 오버라이드가 하나도 없는 상태. 표가 아직 없는 DB에서도 이 값으로 답한다. */
export const NO_UI_THEME_OVERRIDES: readonly UiThemeOverrideRow[] = [];

/**
 * 저장된 행을 기본값 위에 얹는다.
 *
 * 등록부에 없는 키는 **무시한다(거절이 아니라)**. 토큰을 등록부에서 빼는 날이
 * 오면 그 키의 옛 행이 DB에 남아 있을 텐데, 그때 조회가 통째로 실패하면 화면이
 * 안 뜬다. 모르는 키 하나 때문에 앱이 멈추는 것보다 그 한 줄을 흘려보내는 편이
 * 언제나 낫다 — 검증을 통과하지 못하는 값도 같은 이유로 버린다.
 *
 * 스코프가 토큰의 성격과 맞지 않는 행(scoped:false인데 "light", scoped:true인데
 * "both")도 버린다. 어느 한쪽으로 짐작해 얹으면, 저장한 사람이 의도하지 않은
 * 쪽 화면이 조용히 바뀐다.
 */
export function resolveUiTheme(rows: readonly UiThemeOverrideRow[]): ResolvedUiTheme {
  const light: Record<string, string> = {};
  const dark: Record<string, string> = {};
  for (const token of UI_THEME_TOKENS) {
    light[token.key] = token.defaultLight;
    dark[token.key] = token.defaultDark;
  }

  for (const row of rows) {
    const token = UI_THEME_TOKEN_BY_KEY.get(row.tokenKey);
    if (!token) continue;

    const value = normalizeUiThemeValue(token, row.value);
    if (value === null) continue;

    if (token.scoped) {
      if (row.scope === "light") light[token.key] = value;
      else if (row.scope === "dark") dark[token.key] = value;
      continue;
    }

    if (row.scope === "both") {
      light[token.key] = value;
      dark[token.key] = value;
    }
  }

  return { light, dark };
}

// ─────────────────────────────────────────────────────────────── 직렬화

type CssDeclaration = { cssVar: string; value: string };

function renderBlock(selector: string, declarations: readonly CssDeclaration[]): string {
  if (declarations.length === 0) return "";
  const body = declarations.map(({ cssVar, value }) => `${cssVar}:${value}`).join(";");
  return `${selector}{${body}}`;
}

/**
 * <head>에 심을 CSS. 오버라이드가 하나도 없으면 빈 문자열이다.
 *
 * ── 이중 방어 ───────────────────────────────────────────────────────────
 * ① 변수 이름은 **등록부의 cssVar 상수**를 그대로 쓴다. 저장된 키로 이름을
 *    조립하지 않으므로, DB에 무엇이 들어 있든 선택자 안으로 흘러들 수 없다.
 * ② 값은 normalizeUiThemeValue를 **한 번 더** 통과한 것만 붙인다. 저장 경로가
 *    뚫려도 출력 경로가 다시 막는다.
 * 그래서 등록부에 없는 키·검증에 실패한 값·기본값과 같은 값은 출력에 아예
 * 나타나지 않는다.
 *
 * ── 선택자가 정확히 이 모양이어야 하는 이유는 파일 머리말에 있다 ────────
 * 라이트 블록의 `:not(.dark)`를 빼면 다크 모드에서 배경이 흰색이 된다.
 * scoped:false 토큰(모서리·글자 크기)은 양쪽이 같으므로 `:root:root{}`에만
 * 나오고, `:not(.dark)`를 붙이지 않는다 — 붙이면 다크에서만 기본 크기로
 * 돌아가는 값이 된다.
 */
export function serializeUiThemeCss(rows: readonly UiThemeOverrideRow[]): string {
  const resolved = resolveUiTheme(rows);

  const lightOnly: CssDeclaration[] = [];
  const darkOnly: CssDeclaration[] = [];
  const shared: CssDeclaration[] = [];

  for (const token of UI_THEME_TOKENS) {
    if (token.scoped) {
      const light = normalizeUiThemeValue(token, resolved.light[token.key]);
      if (light !== null && light !== token.defaultLight) {
        lightOnly.push({ cssVar: token.cssVar, value: light });
      }
      const dark = normalizeUiThemeValue(token, resolved.dark[token.key]);
      if (dark !== null && dark !== token.defaultDark) {
        darkOnly.push({ cssVar: token.cssVar, value: dark });
      }
      continue;
    }

    const value = normalizeUiThemeValue(token, resolved.light[token.key]);
    if (value !== null && value !== token.defaultLight) {
      shared.push({ cssVar: token.cssVar, value });
    }
  }

  return [
    renderBlock(":root:root:not(.dark)", lightOnly),
    renderBlock(":root:root.dark", darkOnly),
    renderBlock(":root:root", shared),
  ]
    .filter((block) => block.length > 0)
    .join("\n");
}
