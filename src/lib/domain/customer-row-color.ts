/**
 * ============================================================================
 * 고객사 줄 배경색 — 팔레트가 있는 단 한 곳
 * ============================================================================
 * 내자 정리 목록에서 고객사마다 줄을 다른 색으로 칠한다. 한 화면에 여러
 * 고객사의 줄이 순번 순서대로 섞여 있어서, 소제목만으로는 옆으로 스크롤하는
 * 동안 어느 고객사의 줄을 보고 있는지 놓치기 쉽다.
 *
 * ── DB 에는 색 코드가 아니라 **키**가 들어간다 ──────────────────────────
 * customers.row_color 에 담기는 값은 "amber" 같은 **팔레트 키**이지
 * "#FFE4B5" 같은 색 코드가 아니다. 이유는 세 가지다:
 *
 *  1. 나중에 "색이 너무 진하다"고 느껴질 때 **DB 를 한 줄도 건드리지 않고**
 *     이 파일의 클래스만 고치면 39개 고객사의 색이 한꺼번에 조절된다. 색
 *     코드를 저장해 두면 같은 일이 데이터 마이그레이션이 된다.
 *  2. 밝은 화면과 어두운 화면은 **같은 색을 쓸 수 없다.** 밝은 쪽에서 읽히는
 *     옅은 색은 어두운 쪽에서 눈을 찌르고, 그 반대도 마찬가지다. 값 하나에
 *     색조 두 벌을 매달 수 있는 것은 키뿐이다.
 *  3. 자유 색 고르개가 아니라 **정해진 색 중에서 고르는** 화면이라, 저장될 수
 *     있는 값의 범위가 애초에 이 목록으로 닫혀 있다. 검증도 그만큼 단순해진다
 *     (validation/customer-update-input.ts).
 *
 * ── 배경만 칠하고 글자색은 건드리지 않는다 ──────────────────────────────
 * 모든 색이 밝은 쪽은 `-100`, 어두운 쪽은 `-950/50` 이다. 이 정도로 옅으면
 * 화면이 이미 쓰고 있는 글자색 토큰(zinc-900 / zinc-50 계열)이 그대로 통해서,
 * 색을 더하는 일이 글자 대비를 건드리지 않는다. 글자색까지 색마다 정하기
 * 시작하면 열 가지 색 × 두 화면 = 스무 벌의 대비를 각각 책임져야 한다.
 *
 * ── 완료된 줄의 회색과 겹치지 않는다 ────────────────────────────────────
 * 완료 표시는 zinc 계열 회색이다(DomesticOrderListScreen). 그래서 이 팔레트에는
 * **무채색 계열(zinc·slate·gray·neutral·stone)을 하나도 넣지 않는다** — 넣으면
 * "완료된 줄"과 "회색을 고른 고객사의 줄"이 같은 모양이 된다. 열 가지 색은
 * 색상환을 고르게 도는 유채색뿐이다.
 *
 * ── 모르는 키는 조용히 "없음"이다 ───────────────────────────────────────
 * 나중에 이 목록에서 색 하나를 빼면 그 색을 골라 둔 고객사의 row_color 가
 * 팔레트에 없는 값으로 남는다. 그때 화면이 깨지거나 빈 클래스 문자열이
 * className 에 섞여 들어가면 안 된다 — resolveCustomerRowColor 가 null 을
 * 돌려주고, 그 고객사는 색을 칠하지 않은 것과 똑같이 보인다.
 *
 * ── 클래스 이름은 반드시 **온전한 글자 그대로** 적는다 ──────────────────
 * Tailwind 는 소스 파일에서 클래스 이름을 글자로 찾아 CSS 를 만든다.
 * `` `bg-${hue}-100` `` 처럼 조립하면 그 클래스는 빌드 결과에 존재하지 않아
 * 화면에서 색이 아예 나오지 않는다. 아래 표의 모든 값이 조각나지 않은 완성된
 * 문자열인 이유가 그것이다.
 * ============================================================================
 */

/** 저장될 수 있는 팔레트 키. 이 열 가지가 전부다. */
export type CustomerRowColorKey =
  | "rose"
  | "orange"
  | "amber"
  | "lime"
  | "emerald"
  | "teal"
  | "sky"
  | "indigo"
  | "violet"
  | "fuchsia";

export type CustomerRowColor = {
  /** DB(customers.row_color)에 그대로 들어가는 값. */
  key: CustomerRowColorKey;
  /** 색 고르개에 적히는 이름. 색을 구분하기 어려운 사람에게는 이 글자가 단서다. */
  label: string;
  /** 밝은 화면의 배경. */
  lightClass: string;
  /** 어두운 화면의 배경. 같은 색의 훨씬 어두운 색조라야 글자가 읽힌다. */
  darkClass: string;
  /** 밝은 화면에서 마우스를 얹었을 때. 누를 수 있는 줄이라는 표시를 색이 지우면 안 된다. */
  lightHoverClass: string;
  /** 어두운 화면에서 마우스를 얹었을 때. */
  darkHoverClass: string;
};

/**
 * 고를 수 있는 색 전부. 순서는 색상환을 도는 순서다 — 목록에서 위아래로 훑을
 * 때 비슷한 색끼리 붙어 있어야 "이 둘 중 어느 쪽이었지"를 눈으로 가릴 수 있다.
 */
export const CUSTOMER_ROW_COLORS: readonly CustomerRowColor[] = [
  {
    key: "rose",
    label: "분홍",
    lightClass: "bg-rose-100",
    darkClass: "dark:bg-rose-950/50",
    lightHoverClass: "hover:bg-rose-200",
    darkHoverClass: "dark:hover:bg-rose-900/50",
  },
  {
    key: "orange",
    label: "주황",
    lightClass: "bg-orange-100",
    darkClass: "dark:bg-orange-950/50",
    lightHoverClass: "hover:bg-orange-200",
    darkHoverClass: "dark:hover:bg-orange-900/50",
  },
  {
    key: "amber",
    label: "노랑",
    lightClass: "bg-amber-100",
    darkClass: "dark:bg-amber-950/50",
    lightHoverClass: "hover:bg-amber-200",
    darkHoverClass: "dark:hover:bg-amber-900/50",
  },
  {
    key: "lime",
    label: "연두",
    lightClass: "bg-lime-100",
    darkClass: "dark:bg-lime-950/50",
    lightHoverClass: "hover:bg-lime-200",
    darkHoverClass: "dark:hover:bg-lime-900/50",
  },
  {
    key: "emerald",
    label: "초록",
    lightClass: "bg-emerald-100",
    darkClass: "dark:bg-emerald-950/50",
    lightHoverClass: "hover:bg-emerald-200",
    darkHoverClass: "dark:hover:bg-emerald-900/50",
  },
  {
    key: "teal",
    label: "청록",
    lightClass: "bg-teal-100",
    darkClass: "dark:bg-teal-950/50",
    lightHoverClass: "hover:bg-teal-200",
    darkHoverClass: "dark:hover:bg-teal-900/50",
  },
  {
    key: "sky",
    label: "하늘",
    lightClass: "bg-sky-100",
    darkClass: "dark:bg-sky-950/50",
    lightHoverClass: "hover:bg-sky-200",
    darkHoverClass: "dark:hover:bg-sky-900/50",
  },
  {
    key: "indigo",
    label: "남색",
    lightClass: "bg-indigo-100",
    darkClass: "dark:bg-indigo-950/50",
    lightHoverClass: "hover:bg-indigo-200",
    darkHoverClass: "dark:hover:bg-indigo-900/50",
  },
  {
    key: "violet",
    label: "보라",
    lightClass: "bg-violet-100",
    darkClass: "dark:bg-violet-950/50",
    lightHoverClass: "hover:bg-violet-200",
    darkHoverClass: "dark:hover:bg-violet-900/50",
  },
  {
    key: "fuchsia",
    label: "자주",
    lightClass: "bg-fuchsia-100",
    darkClass: "dark:bg-fuchsia-950/50",
    lightHoverClass: "hover:bg-fuchsia-200",
    darkHoverClass: "dark:hover:bg-fuchsia-900/50",
  },
];

/**
 * "색 없음"을 나타내는 값. 화면의 고르개가 쓰는 값이고, 저장될 때는 null 이
 * 된다 — 빈 문자열과 null 두 가지 모양의 "없음"이 DB 에 섞이지 않게 검증이
 * 한 가지로 접는다(validation/customer-update-input.ts).
 */
export const NO_CUSTOMER_ROW_COLOR_KEY = "";

/** "없음"을 고르는 자리에 적히는 글자. 화면과 시험이 같은 글자를 쓴다. */
export const NO_CUSTOMER_ROW_COLOR_LABEL = "없음";

const BY_KEY = new Map<string, CustomerRowColor>(
  CUSTOMER_ROW_COLORS.map((color) => [color.key, color])
);

/** 저장해도 되는 값인가. 검증이 이 함수 하나로 팔레트 밖의 값을 거절한다. */
export function isCustomerRowColorKey(value: unknown): value is CustomerRowColorKey {
  return typeof value === "string" && BY_KEY.has(value);
}

/**
 * 키 → 색. **없음이거나 모르는 키면 null 이다**(파일 헤더의 '모르는 키는
 * 조용히 없음이다'). 부르는 쪽은 null 을 "색을 칠하지 않는다"로만 읽으면 된다.
 */
export function resolveCustomerRowColor(
  key: string | null | undefined
): CustomerRowColor | null {
  if (key === null || key === undefined) return null;
  return BY_KEY.get(key) ?? null;
}

/**
 * 칠할 배경 클래스. 색이 없으면 **빈 문자열**이다 — 부르는 쪽이 className 에
 * 그대로 이어 붙여도 아무 일도 일어나지 않는다.
 *
 * 누를 수 없는 자리(묶음 소제목)가 쓴다. 누를 수 있는 줄은 아래 쪽이다.
 */
export function customerRowColorClass(key: string | null | undefined): string {
  const color = resolveCustomerRowColor(key);
  return color === null ? "" : `${color.lightClass} ${color.darkClass}`;
}

/**
 * 누를 수 있는 줄이 쓰는 배경 클래스 — 위 배경에 hover 색조까지 함께.
 *
 * hover 를 함께 주는 이유: 이 표의 줄은 눌러서 수정 폼을 여는 줄이고, 그 사실을
 * 알리는 것이 hover 색이다. 고객사 색만 칠하고 기존 회색 hover 를 그대로 두면
 * 마우스를 얹는 순간 고객사 색이 사라져 다른 줄처럼 보인다.
 */
export function customerRowColorInteractiveClass(key: string | null | undefined): string {
  const color = resolveCustomerRowColor(key);
  if (color === null) return "";
  return `${color.lightClass} ${color.darkClass} ${color.lightHoverClass} ${color.darkHoverClass}`;
}
