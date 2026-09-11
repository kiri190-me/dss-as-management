/**
 * ============================================================================
 * 화면 토큰 — 등록부·검증기·직렬화
 * ============================================================================
 * 관리자가 코드를 고치지 않고 앱의 색·모서리·글자 크기(그리고 주간보고 한 화면의
 * 글자·상자 크기)를 바꿀 수 있게 하는 축의
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

/**
 * 값의 종류. 종류가 곧 검증 규칙이다(normalizeUiThemeValue).
 *
 * `spacing` 은 **주간보고 전용**이다 — 여백·간격·최소 높이. 앱 전체의 여백은
 * 배율(--spacing) 하나라 건드리면 모든 화면의 배치가 한꺼번에 움직이므로 열지
 * 않는다(HANDOFF Y11-5 결정 2). 이 종류의 토큰은 전부 `area` 가 붙어 있고,
 * 시험(ui-theme-tokens.test.ts)이 그것을 단언한다.
 */
export type UiThemeTokenKind = "color" | "radius" | "fontSize" | "spacing";
export type UiThemeScope = "light" | "dark" | "both";

/**
 * 한 화면에서만 쓰이는 토큰의 그 화면. 앱 전체에 걸리는 토큰에는 붙이지 않는다.
 *
 * 🔴 이 표시가 있는 토큰은 앱 전체용 편집 화면(색 · 모서리·글자 크기)에 나오지
 * 않는다(uiThemeTokenScreen). 표시 없이 들어오면 「모서리 · 글자 크기」 화면이
 * 자기 몫으로 세어, 그 화면의 「이 화면 전부 기본값으로」가 이 값까지 지운다 —
 * 누른 사람은 그 화면에 보이지도 않던 값이 지워졌다는 것을 알 수 없다.
 */
export type UiThemeTokenArea = "weeklyReport";

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
  /** 한 화면 전용이면 그 화면. 없으면 앱 전체에 걸리는 값이다(UiThemeTokenArea). */
  area?: UiThemeTokenArea;
  /**
   * 허용 범위(rem, 양 끝 포함). **`spacing` 종류만 읽고, 그 종류에는 반드시 있다.**
   *
   * 여백과 최소 높이는 자리마다 쓸 만한 폭이 크게 달라서(표 칸 여백 0.375rem ·
   * 상세표 최소 높이 8rem) 종류 하나에 범위 하나를 둘 수 없다. 다른 종류는 종류
   * 공통 범위를 쓰므로 적지 않는다 — 적어 두면 읽히지 않는 값이 읽히는 것처럼
   * 보인다(시험이 둘 다 단언한다). 빠진 spacing 토큰은 검증기가 모든 값을
   * 거절한다(열어 두는 쪽이 아니라 닫는 쪽으로 틀린다).
   */
  rangeRem?: { min: number; max: number };
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
 * 검증기가 받는 표기도 그것이다. `background`/`foreground`와 강조(primary)
 * 램프, 주간보고 전용 크기(`--text-wr-*` · `--spacing-wr-*`)는
 * src/app/globals.css에서 읽었다(이 저장소가 직접 정의하는 변수라서).
 * primary는 같은 단계의 zinc와 값이 같다 — 원래 zinc-900이던 주 버튼을 이름만
 * 바꿔 옮겨 온 것이고, 그때 화면이 하나도 바뀌지 않아야 했다(아래 램프 주석).
 *
 * ── 왜 라이트/다크 기본값이 대부분 같은가 ───────────────────────────────
 * zinc·primary·red는 **팔레트**이지 역할이 아니다. 라이트 화면은 zinc-900을 글자로,
 * 다크 화면은 같은 zinc-900을 카드 바탕으로 쓴다 — 색 자체는 한 벌이고 쓰는
 * 자리가 다를 뿐이다. 그래도 `scoped: true`로 둔 이유는, 다크에서만 한 단계를
 * 살짝 눕히고 싶은 요구가 실제로 생기기 때문이다(예: 다크의 zinc-400만 조금 더
 * 밝게). 반대로 `background`/`foreground` 둘은 애초에 두 값이 다르다.
 *
 * 모서리·글자 크기(주간보고 전용 크기 포함)는 `scoped: false`다. 다크에서만 모서리가 둥글어지거나 글자가
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

  // ── 강조(primary) — 주 버튼과 선택된 메뉴만 이 램프 위에 있다 ─────────
  //
  // 🔴 기본값이 같은 단계의 zinc 와 **글자 하나까지 같다.** 이 램프를 들여올 때
  // 화면이 하나도 바뀌지 않아야 했기 때문이다 — 원래 주 버튼이 `bg-zinc-900`
  // 이었고, 그 자리를 이름만 바꿔 옮겨 왔다. 값이 같다고 해서 zinc 를 var() 로
  // 가리키지는 않는다(globals.css 의 @theme 블록 주석 참조): 가리키면 톤
  // 템플릿이 중립을 바꿀 때 강조색이 딸려 움직여, "메인 컬러를 따로 고른다"가
  // 다시 불가능해진다. 두 램프가 같은 값에서 출발할 뿐 서로 묶여 있지는 않다.
  //
  // 램프에 구멍을 내지 않는 이유는 red-500 과 같다 — 지금 안 쓰는 단계라도
  // 빼면 편집 화면의 "50부터 950까지 한 줄"이 깨지고, 나중에 누가 그 단계를
  // 쓰기 시작하는 날 혼자만 못 바꾸는 색이 된다.
  {
    key: "primary-50",
    cssVar: "--color-primary-50",
    kind: "color",
    scoped: true,
    label: "가장 연한 강조색",
    usage: "다크 주 버튼 바탕(라이트의 900 자리를 다크에서는 이 단계가 맡는다)",
    defaultLight: "#fafafa",
    defaultDark: "#fafafa",
  },
  {
    key: "primary-100",
    cssVar: "--color-primary-100",
    kind: "color",
    scoped: true,
    label: "연한 강조색",
    usage: "라이트 선택된 메뉴 바탕 · 일부 화면의 다크 주 버튼 바탕",
    defaultLight: "#f4f4f5",
    defaultDark: "#f4f4f5",
  },
  {
    key: "primary-200",
    cssVar: "--color-primary-200",
    kind: "color",
    scoped: true,
    label: "옅은 강조색",
    usage: "다크 주 버튼에 마우스를 올렸을 때 바탕",
    defaultLight: "#e4e4e7",
    defaultDark: "#e4e4e7",
  },
  {
    key: "primary-300",
    cssVar: "--color-primary-300",
    kind: "color",
    scoped: true,
    label: "밝은 강조색",
    usage: "다크 주 버튼 마우스 올림의 변종(견적 목록)",
    defaultLight: "#d4d4d8",
    defaultDark: "#d4d4d8",
  },
  {
    key: "primary-400",
    cssVar: "--color-primary-400",
    kind: "color",
    scoped: true,
    label: "중간 밝은 강조색",
    usage: "강조 램프의 밝은 가운데 단계(지금은 쓰지 않지만 램프를 끊지 않으려고 둔다)",
    defaultLight: "#9f9fa9",
    defaultDark: "#9f9fa9",
  },
  {
    key: "primary-500",
    cssVar: "--color-primary-500",
    kind: "color",
    scoped: true,
    label: "중간 강조색",
    usage: "강조 램프의 가운데 단계(지금은 쓰지 않는다)",
    defaultLight: "#71717b",
    defaultDark: "#71717b",
  },
  {
    key: "primary-600",
    cssVar: "--color-primary-600",
    kind: "color",
    scoped: true,
    label: "중간 어두운 강조색",
    usage: "강조 램프의 어두운 가운데 단계(지금은 쓰지 않는다)",
    defaultLight: "#52525c",
    defaultDark: "#52525c",
  },
  {
    key: "primary-700",
    cssVar: "--color-primary-700",
    kind: "color",
    scoped: true,
    label: "어두운 강조색",
    usage: "라이트 주 버튼에 마우스를 올렸을 때 바탕의 변종(견적 목록)",
    defaultLight: "#3f3f46",
    defaultDark: "#3f3f46",
  },
  {
    key: "primary-800",
    cssVar: "--color-primary-800",
    kind: "color",
    scoped: true,
    label: "진한 강조색",
    usage: "라이트 주 버튼 마우스 올림 바탕 · 다크 선택된 메뉴 바탕",
    defaultLight: "#27272a",
    defaultDark: "#27272a",
  },
  {
    key: "primary-900",
    cssVar: "--color-primary-900",
    kind: "color",
    scoped: true,
    label: "가장 진한 강조색 (주 버튼)",
    usage: "라이트 주 버튼 바탕 · 선택된 메뉴 왼쪽 테두리 — 앱의 메인 컬러",
    defaultLight: "#18181b",
    defaultDark: "#18181b",
  },
  {
    key: "primary-950",
    cssVar: "--color-primary-950",
    kind: "color",
    scoped: true,
    label: "먹빛 강조색",
    usage: "강조 램프의 가장 깊은 단계(지금은 쓰지 않는다)",
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

  // ── 주간보고 전용 — 글자 8 · 상자 7 ──────────────────────────────────
  //
  // 주간보고 세 컴포넌트(WeeklyReportScreen · WeeklyReportGoalsPanel ·
  // WeeklyReportDeliveriesPanel)만 읽는 변수다. 그 화면의 글자·상자 크기만 따로
  // 고르고 싶다는 요청(2026-09-11)에서 나왔고, 전역 text-xs 나 여백 배율을 바꾸면
  // 앱 전체가 함께 움직이기 때문에 따로 둔다(globals.css 의 같은 블록 머리말).
  //
  // 🔴 전부 `area: "weeklyReport"` 다. 빠뜨리면 「모서리 · 글자 크기」 화면이 이
  // 값을 자기 몫으로 센다(UiThemeTokenArea 주석).
  //
  // 🔴 기본값은 globals.css `@theme` 의 값과 **글자까지 같아야** 한다. 어긋나면
  // 「기본값으로 되돌렸는데 크기가 안 돌아옴」이 된다 — 등록부가 "기본값과 같다"며
  // 행을 지우는데 실제로 그려지는 값은 globals.css 가 정하기 때문이다. 강조 램프와
  // 같은 사정이고, 시험이 파일을 직접 읽어 대조한다.
  //
  // 키는 CSS 변수 이름에서 `--` 만 뗀 것이다(`--text-sm` ↔ "text-sm" 과 같은 규칙).
  // 줄 높이 짝(`--text-wr-*--line-height`)은 여기 없다 — 비율(calc(1.75 / 1.25))로
  // 적혀 있어 글자 크기를 바꾸면 줄 높이가 따라 움직이고, 따로 고칠 값이 아니다.
  //
  // 글자 크기는 앱 전체 글자 크기와 같은 종류·같은 범위(0.625 ~ 1.5rem)를 쓴다.
  // 가장 큰 기본값(화면 제목 1.25rem)도 그 안에 든다. 「집계 칸 이름」은 기본값이
  // 이미 하한(0.625rem = 10px)이라 키울 수만 있다 — 하한은 읽기의 바닥이라
  // 이 화면이라고 내리지 않는다.
  {
    key: "text-wr-title",
    cssVar: "--text-wr-title",
    kind: "fontSize",
    scoped: false,
    label: "화면 제목 글자",
    usage: "주간보고 맨 위의 「주간보고」 제목",
    defaultLight: "1.25rem",
    defaultDark: "1.25rem",
    area: "weeklyReport",
  },
  {
    key: "text-wr-section",
    cssVar: "--text-wr-section",
    kind: "fontSize",
    scoped: false,
    label: "구역 제목 글자",
    usage: "종류별 총합 · PO 발행 현황 · 금주 목표 · 납입 예정 건 같은 구역 제목",
    defaultLight: "0.875rem",
    defaultDark: "0.875rem",
    area: "weeklyReport",
  },
  {
    key: "text-wr-heading",
    cssVar: "--text-wr-heading",
    kind: "fontSize",
    scoped: false,
    label: "소제목 글자",
    usage: "고객사 블록 · 금주 목표 상자 · 납입 예정 상자의 소제목",
    defaultLight: "0.875rem",
    defaultDark: "0.875rem",
    area: "weeklyReport",
  },
  {
    key: "text-wr-body",
    cssVar: "--text-wr-body",
    kind: "fontSize",
    scoped: false,
    label: "표 본문 글자",
    usage: "상세표 · 납입 예정 표의 본문과 금주 목표 줄",
    defaultLight: "0.75rem",
    defaultDark: "0.75rem",
    area: "weeklyReport",
  },
  {
    key: "text-wr-table-head",
    cssVar: "--text-wr-table-head",
    kind: "fontSize",
    scoped: false,
    label: "표 머리 글자",
    usage: "상세표 · 납입 예정 표의 머리 줄",
    defaultLight: "0.6875rem",
    defaultDark: "0.6875rem",
    area: "weeklyReport",
  },
  {
    key: "text-wr-label",
    cssVar: "--text-wr-label",
    kind: "fontSize",
    scoped: false,
    label: "집계 칸 이름 글자",
    usage: "집계 칸 이름 · 종류 배지 · PO 발행 현황의 고객사명",
    defaultLight: "0.625rem",
    defaultDark: "0.625rem",
    area: "weeklyReport",
  },
  {
    key: "text-wr-count",
    cssVar: "--text-wr-count",
    kind: "fontSize",
    scoped: false,
    label: "집계 숫자 글자",
    usage: "집계 칸 숫자 · 소제목 옆 총 대수 · 줄 수",
    defaultLight: "0.75rem",
    defaultDark: "0.75rem",
    area: "weeklyReport",
  },
  {
    key: "text-wr-meta",
    cssVar: "--text-wr-meta",
    kind: "fontSize",
    scoped: false,
    label: "보조 글자",
    usage: "종류 설명 · 줄 수 문장 · 「해당 없음」 안내",
    defaultLight: "0.6875rem",
    defaultDark: "0.6875rem",
    area: "weeklyReport",
  },

  // 상자 — rem 만, 항목마다 범위가 다르다(rangeRem 주석). 전부 여백·간격·
  // **최소** 높이다. 확정 높이는 만들지 않는다 — 주간보고의 세로 스크롤바 두 개
  // (HANDOFF U-1)를 다시 부를 수 있는 모양은 애초에 열지 않는다.
  //
  // 표 칸 여백의 상한을 1rem 으로 좁힌 이유: 표가 여덟~아홉 칸이고 줄바꿈을 하지
  // 않아서(whitespace-nowrap), 칸마다 양쪽으로 붙는 여백이 표 너비를 곧바로 늘린다.
  // 1rem 이면 기본값의 약 2.7배로, 넓혀 볼 여지는 충분하다.
  {
    key: "spacing-wr-block",
    cssVar: "--spacing-wr-block",
    kind: "spacing",
    scoped: false,
    label: "고객사 블록 안 여백",
    usage: "고객사마다 하나씩 놓이는 블록의 테두리와 내용 사이",
    defaultLight: "0.5rem",
    defaultDark: "0.5rem",
    area: "weeklyReport",
    rangeRem: { min: 0, max: 2 },
  },
  {
    key: "spacing-wr-section",
    cssVar: "--spacing-wr-section",
    kind: "spacing",
    scoped: false,
    label: "구역 안 여백",
    usage: "종류별 총합 · PO 발행 현황 · 금주 목표 · 납입 예정 건 구역의 테두리와 내용 사이",
    defaultLight: "0.75rem",
    defaultDark: "0.75rem",
    area: "weeklyReport",
    rangeRem: { min: 0, max: 2 },
  },
  {
    key: "spacing-wr-block-gap",
    cssVar: "--spacing-wr-block-gap",
    kind: "spacing",
    scoped: false,
    label: "블록 사이 간격",
    usage: "고객사 블록끼리, 그리고 좌우 두 단으로 놓일 때 두 단 사이",
    defaultLight: "0.75rem",
    defaultDark: "0.75rem",
    area: "weeklyReport",
    rangeRem: { min: 0, max: 2 },
  },
  {
    key: "spacing-wr-cell-x",
    cssVar: "--spacing-wr-cell-x",
    kind: "spacing",
    scoped: false,
    label: "표 칸 좌우 여백",
    usage: "상세표 · 납입 예정 표의 칸 안 왼쪽·오른쪽 여백",
    defaultLight: "0.375rem",
    defaultDark: "0.375rem",
    area: "weeklyReport",
    rangeRem: { min: 0, max: 1 },
  },
  {
    key: "spacing-wr-cell-y",
    cssVar: "--spacing-wr-cell-y",
    kind: "spacing",
    scoped: false,
    label: "표 칸 위아래 여백",
    usage: "상세표 · 납입 예정 표의 칸 안 위·아래 여백(줄 간격이 여기서 정해진다)",
    defaultLight: "0.25rem",
    defaultDark: "0.25rem",
    area: "weeklyReport",
    rangeRem: { min: 0, max: 1 },
  },
  {
    key: "spacing-wr-table-min",
    cssVar: "--spacing-wr-table-min",
    kind: "spacing",
    scoped: false,
    label: "상세표 최소 높이",
    usage: "고객사 블록 안 상세표의 최소 높이 — 줄이 적어도 이 높이는 차지한다",
    defaultLight: "8rem",
    defaultDark: "8rem",
    area: "weeklyReport",
    rangeRem: { min: 0, max: 20 },
  },
  {
    key: "spacing-wr-box-min",
    cssVar: "--spacing-wr-box-min",
    kind: "spacing",
    scoped: false,
    label: "목표 · 납입 상자 최소 높이",
    usage: "금주 목표 상자와 납입 예정 표 상자의 최소 높이",
    defaultLight: "4rem",
    defaultDark: "4rem",
    area: "weeklyReport",
    rangeRem: { min: 0, max: 16 },
  },
];

// ────────────────────────────────────────────────── 화면 가르기

/**
 * 토큰 하나를 맡는 편집 화면.
 *
 * 🔴 등록부를 **남김없이, 겹치지 않게** 셋으로 가른다. 편집 화면과 개발자 모드
 * 목차의 「N칸 바뀜」이 전부 이 함수 하나로 자기 몫을 정한다 — 화면마다 따로
 * `kind !== "color"` 같은 조건을 적으면, 등록부에 새 묶음이 들어온 날 한 화면만
 * 그 묶음을 자기 몫으로 세고, 그 화면의 「이 화면 전부 기본값으로」가 보이지도
 * 않는 값을 지운다(주간보고 토큰을 들일 때 실제로 그 자리였다).
 *
 * `weeklyReport` 화면은 아직 없다(다음 조각). 그 사이에는 이 묶음을 편집하는
 * 화면이 없을 뿐, 저장 경로·직렬화·구조선은 이미 이 토큰들을 다룬다.
 */
export type UiThemeTokenScreen = "colors" | "shapes" | "weeklyReport";

export function uiThemeTokenScreen(token: UiThemeToken): UiThemeTokenScreen {
  if (token.area === "weeklyReport") return "weeklyReport";
  return token.kind === "color" ? "colors" : "shapes";
}

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

    case "spacing": {
      // 여백·간격·최소 높이(주간보고 전용). 모서리와 같은 "숫자 + 정해진 단위"
      // 규칙이라 괄호·세미콜론·공백이 들어올 자리가 없다 — 이것이 이 종류의 주입
      // 방어선이다. 단위는 rem 하나뿐이다: 글자 크기와 같은 까닭으로, px 로 못
      // 박으면 글자를 키운 브라우저에서 글자만 커지고 상자는 그대로라 글자가
      // 상자를 뚫고 나온다. `0` 은 단위 없이 받는다(여백 없음은 뜻이 있는 값이다).
      //
      // 범위는 토큰마다 다르다(UiThemeToken.rangeRem). 🔴 적혀 있지 않으면 전부
      // 거절한다 — 범위를 모르는 채 통과시키면 상한이 없는 것과 같다.
      const range = token.rangeRem;
      if (!range) return null;
      return normalizeLengthValue(value, {
        allowPx: false,
        allowUnitlessZero: true,
        minPx: range.min * REM_IN_PX,
        maxPx: range.max * REM_IN_PX,
      });
    }

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
 * 색 35개를 전부 맞물려 재면 경고가 수백 줄 쏟아지는데, 그중 거의 전부가 앱에서
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
 * scoped:false 토큰(모서리·글자 크기·주간보고 크기)은 양쪽이 같으므로
 * `:root:root{}`에만 나오고, `:not(.dark)`를 붙이지 않는다 — 붙이면 다크에서만
 * 기본 크기로 돌아가는 값이 된다.
 *
 * 주간보고 크기가 여기서 이기는 근거: globals.css 의 `@theme` 기본값은 Tailwind 가
 * `@layer theme` 안의 `:root, :host` 로 내보내고, 이 블록은 레이어 밖에 있다 —
 * 레이어 밖 선언이 레이어 안 선언을 명시도와 무관하게 이긴다.
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

// ─────────────────────────────────────────────────────── 구조선(lifeboat)

/**
 * 편집 화면을 감싸는 컨테이너의 id. 페이지가 `<div id={…}>` 로 걸고, 아래
 * 생성기가 같은 이름으로 선택자를 만든다.
 *
 * 🔴 문자열을 두 곳에 적지 않는 이유는 우회 쿠키 상수와 같다 — 한쪽만 고쳐지는
 * 날 구조선이 조용히 풀리고, 그 증상은 **오버라이드로 화면이 안 보이게 된
 * 바로 그 순간에만** 드러난다. 그때는 이미 고치러 들어갈 화면이 없다.
 */
export const UI_THEME_LIFEBOAT_ID = "ui-theme-lifeboat";

/** 라이트 기본값 블록. 명시도 (1,0,0). */
const UI_THEME_LIFEBOAT_SELECTOR = `#${UI_THEME_LIFEBOAT_ID}`;

/** 다크 기본값 블록. 명시도 (1,1,0) — 위 블록을 순서와 무관하게 이긴다. */
const UI_THEME_LIFEBOAT_DARK_SELECTOR = `.dark #${UI_THEME_LIFEBOAT_ID}`;

/**
 * 되돌리러 온 화면만은 항상 기본색이게 하는 CSS.
 *
 * ── 왜 이 한 장이 필요한가 ──────────────────────────────────────────────
 * 저장된 값은 `:root` 에 얹히고 커스텀 프로퍼티는 상속되므로, 편집 화면도
 * 그 값을 그대로 뒤집어쓴다. 대비 하한이 "아예 안 보임"은 막지만 "읽을 수는
 * 있는데 못 쓰겠는" 조합은 얼마든지 만들어진다. 그때 되돌릴 화면 자체가 그
 * 상태이면 고칠 수 있는 사람이 고칠 화면에 닿지 못한다. 우회 쿠키가 **그
 * 브라우저 전체**를 오버라이드 이전으로 되돌리는 탈출구라면, 이쪽은 **이 화면
 * 하나**를 항상 기본값에 묶어 두는 탈출구다. 서버에서 렌더되고, JS 가 필요
 * 없고, 깜빡임이 없다.
 *
 * ── 상속값을 이기는 근거는 명시도가 아니다 ──────────────────────────────
 * `:root:root:not(.dark)` 는 **루트 요소**를 겨냥한 선언이고, 여기 두 블록은
 * **컨테이너 자신**을 겨냥한 선언이다. 명시도 비교는 같은 요소를 두고 다투는
 * 선언들 사이에서만 일어나므로, 컨테이너에 직접 걸린 선언은 조상에게서
 * 물려받는 값을 언제나 이긴다 — 저장된 값이 무엇이든 상관없다. 두 블록 사이의
 * 명시도 순서(다크가 강하다)만 이 파일이 책임진다.
 *
 * ── 🔴 `!important` 를 쓰지 않는다 ──────────────────────────────────────
 * 쓰는 순간 미리보기가 인라인 style 로 같은 변수를 덮는 **정당한 길**이 막힌다.
 * 편집 중인 색을 견본에 걸 수 없게 되면 이 화면은 "저장해 보고 확인하는" 화면이
 * 되고, 그것이 정확히 이 기능에서 가장 위험한 사용법이다.
 *
 * 저장된 값을 인자로 받지 않는다 — 언제나 **코드 기본값**만 쏟아낸다. 그래서
 * 출력은 등록부가 같으면 늘 같은 문자열이고, DB 를 읽지 못하는 상황에서도
 * 이 화면은 읽힌다.
 */
export function serializeUiThemeLifeboatCss(): string {
  const light: CssDeclaration[] = [];
  const dark: CssDeclaration[] = [];

  for (const token of UI_THEME_TOKENS) {
    // 등록부의 **모든** 토큰이 라이트 블록에 나와야 한다. 하나라도 빠지면 그
    // 값만 조용히 오버라이드를 뒤집어쓴다 — 눈으로는 절대 못 찾는 구멍이다.
    light.push({ cssVar: token.cssVar, value: token.defaultLight });

    // 주간보고 전용 크기도 여기 나온다. 개발자 모드 화면 안에는 주간보고가
    // 없으므로 지금은 아무것도 바꾸지 않고, 다음 조각의 주간보고 미리보기는
    // 인라인 style 로 이 선언을 이긴다(아래 !important 를 쓰지 않는 이유와 같다).
    //
    // scoped:false 토큰(모서리·글자 크기·주간보고 크기)은 라이트/다크가 같은 값이라 다크
    // 블록에 넣을 것이 없다. 넣어 봐야 같은 값을 두 번 적는 것뿐이고,
    // 나중에 한쪽만 고쳐지는 길만 열린다.
    if (token.scoped) {
      dark.push({ cssVar: token.cssVar, value: token.defaultDark });
    }
  }

  return [
    renderBlock(UI_THEME_LIFEBOAT_SELECTOR, light),
    renderBlock(UI_THEME_LIFEBOAT_DARK_SELECTOR, dark),
  ]
    .filter((block) => block.length > 0)
    .join("\n");
}

// ───────────────────────────────────────────────────────── 우회(탈출구)

/**
 * ── 화면이 안 보이게 됐을 때의 탈출구 ───────────────────────────────────
 * 저장 경로에 대비 하한(UI_THEME_CONTRAST_FLOOR)이 있어도 "읽을 수는 있는데
 * 못 쓰겠는" 조합은 얼마든지 만들어진다 — 글자 크기를 하한까지 줄이거나
 * 테두리 색이 바탕과 붙어 버리는 식이다. 그때 되돌릴 편집 화면 자체가 그
 * 오버라이드를 뒤집어쓰고 있으면, 고칠 수 있는 사람이 고칠 화면에 닿지
 * 못한다. 이 쿠키가 붙은 브라우저에는 루트 레이아웃이 <style>을 아예 심지
 * 않아서, 그 한 대만 오버라이드 이전의 화면을 본다.
 *
 * 이름·값·수명을 여기 상수로 둔 이유는, 굽는 쪽(api/theme/bypass)과 보는
 * 쪽(app/layout.tsx)이 서로 다른 파일이기 때문이다. 문자열을 두 번 적으면
 * 한쪽만 고쳐지는 날 우회가 조용히 안 걸리고, 그 증상은 "정말 화면이 안
 * 보이는" 순간에만 드러난다. 이 파일은 DB도 server-only도 들어오지 않는
 * 순수 모듈이라 양쪽에서 그대로 가져다 쓸 수 있다.
 */
export const UI_THEME_BYPASS_COOKIE = "ui-theme-bypass";

/** 우회를 켜는 유일한 값. 이 값이 아니면 우회가 아니다. */
export const UI_THEME_BYPASS_VALUE = "1";

/**
 * 우회 쿠키의 수명(초). 24시간.
 *
 * 세션 쿠키로 두지 않는 이유: 브라우저가 세션 복원을 켜 두면 창을 닫아도 안
 * 지워져서, 우회를 켠 사람이 그 사실을 잊은 채 "나만 색이 안 바뀐다"를 계속
 * 겪는다. 반대로 영구 쿠키로 두면 그 상태에 영영 갇힌다. 하루면 화면을
 * 되돌리기에 충분하고, 잊어버려도 저절로 풀린다.
 */
export const UI_THEME_BYPASS_MAX_AGE_SECONDS = 86400;

/**
 * 이 브라우저가 오버라이드를 무시해야 하는가.
 *
 * 쿠키가 없을 때(undefined)와 다른 값일 때를 한자리에서 판정한다 — 레이아웃이
 * `=== "1"`을 직접 적으면 상수를 둔 뜻이 사라진다.
 */
export function isUiThemeBypassed(cookieValue: string | undefined): boolean {
  return cookieValue === UI_THEME_BYPASS_VALUE;
}
