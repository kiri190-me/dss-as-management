import { meetsPermissionLevel, type PermissionLevel } from "./permission-areas";

/**
 * ============================================================================
 * 상세 화면의 탭 ↔ 권한 잎 — 두 화면이 함께 쓰는 **모양** (2026-11-12, 같은 날 둘째)
 * ============================================================================
 * 2026-11-12 오전에 수리 건 상세의 탭 아홉에 관문을 붙이면서 이 모양이 태어났고
 * (`repair-case-detail-tab-permissions.ts`), 같은 날 오후 기타건 상세에 같은 일을
 * 하게 되면서 **같은 글이 두 벌**이 됐다. 그래서 「탭 키마다 요구사항 목록을 두고
 * OR 로 읽는다」는 부분만 여기로 끌어올렸다.
 *
 * 🔴 **표 자체는 여기 없다.** 어느 탭이 어느 잎을 보는지는 화면마다 다르고, 그
 * 짝은 각 화면의 파일 한 곳에만 있어야 한다. 여기 있는 것은 **읽는 방법**뿐이다 —
 * 표를 여기로 모으면 「수리 건의 탭을 고치려다 기타건을 깨뜨리는」 자리가 생긴다.
 *
 * ── 🔴 왜 요구사항이 **목록**(OR)인가 ───────────────────────────────────
 * 탭 하나에 기능이 여럿 사는 경우가 실재한다. 수리 건의 [작업내용] 탭에는 셋이
 * 산다 — 작업 기록 작성 · 워크플로 단계 변경 · 작업 절차 수행. 그중 한 기능의
 * 잎으로 탭 전체를 닫으면 나머지가 **길을 잃는다**(절차 수행으로 가는 입구는
 * 저장소에 그 탭 하나뿐이다). 관리자는 「작업 기록을 막겠다」고 닫는데 실제로는
 * 다른 기능까지 사라지고, 닫은 사람은 자기가 무엇을 껐는지 모른다.
 *
 * 그래서 **하나라도** 읽기 이상이면 열고, **전부 [접근 불가]일 때만** 숨는다.
 *
 * 🔴 **빈 목록은 만들 수 없다** — 타입이 「적어도 하나」를 요구한다. 빈 목록이면
 * `some()` 이 거짓이 되어 **아무에게도 안 열리는 탭**이 조용히 생긴다.
 *
 * ── 🔴 판정이 사는 자리는 하나다 ────────────────────────────────────────
 * 탭 하나를 막는 데에는 자리가 둘이다 — 탭 줄을 그리는 레이아웃(화면)과, 주소를
 * 직접 쳤을 때 막는 각 페이지(서버). 두 자리가 서로 다른 조건을 보게 되는 날
 * 증상은 「탭은 보이는데 누르면 권한이 없다」 또는 그보다 나쁜 「탭은 없는데
 * 주소로는 들어와진다」이고, 둘 다 아무 오류를 내지 않는다. 그래서 양쪽이 결국
 * 이 함수 하나에 닿는다(`detail-tab-access.ts` 가 수준을 읽어다 넘기는 창구다).
 *
 * 🔵 순수 함수라 **값으로 시험할 수 있다** — 「잎 하나만 닫으면 탭이 그대로
 * 보인다」 같은 OR 동작을 DB 없이 그대로 재는 자리가 이것이다.
 * ============================================================================
 */

export type DetailTabRequirement = {
  /** 저장되는 잎(또는 하위 기능이 없는 메뉴)의 키. role_permissions.area_key 의 그 글자다. */
  key: string;
  /** 탭에 들어가는 데 필요한 수준. 지금은 두 화면 다 전부 읽기다. */
  level: PermissionLevel;
};

export type DetailTabPermission = {
  /** 🔴 **하나라도** 만족하면 탭이 열린다(OR). 전부 못 미칠 때만 숨는다. */
  anyOf: readonly [DetailTabRequirement, ...DetailTabRequirement[]];
};

/**
 * 탭 키 → 요구사항. 🔴 **가리지 않기로 한 탭은 이 표에 넣지 않는다** — 두 화면 다
 * 첫 탭([기본 정보] · [기본정보])이 그렇고, 키 집합에서 아예 빼 두는 것이 그 결정을
 * **타입이 지키게** 하는 방법이다. 덕분에 탭이 하나도 없는 사람이 생기지 않는다.
 */
export type DetailTabPermissionTable<TabKey extends string> = Record<TabKey, DetailTabPermission>;

/** 어느 탭을 그릴까. 🔴 가리지 않는 첫 탭이 이 꾸러미에 없는 것이 결정 그 자체다. */
export type DetailTabVisibility<TabKey extends string> = Record<TabKey, boolean>;

/**
 * 이 탭이 열리는가 — **순수** 판정. 잎마다 이미 구한 수준을 받아 답한다.
 *
 * 🔵 못 읽은 키를 `levelOf` 가 어떻게 돌려줄지는 부르는 쪽이 정한다. 창구
 * (`detail-tab-access.ts`)는 **닫히는 쪽**으로 답한다 — 열리는 쪽으로 실패하면
 * 아무도 모른다.
 */
export function isDetailTabOpen<TabKey extends string>(
  table: DetailTabPermissionTable<TabKey>,
  tab: TabKey,
  levelOf: (key: string) => PermissionLevel
): boolean {
  return table[tab].anyOf.some((requirement) =>
    meetsPermissionLevel(levelOf(requirement.key), requirement.level)
  );
}

/** 이 탭이 보는 잎들. 수준을 미리 읽어 올 때 쓴다. */
export function requiredKeysOfDetailTab<TabKey extends string>(
  table: DetailTabPermissionTable<TabKey>,
  tab: TabKey
): readonly string[] {
  return table[tab].anyOf.map((requirement) => requirement.key);
}

/**
 * 표에 적힌 차례 그대로. 🔴 탭 줄의 차례가 아니라 **훑는 차례**다 — 탭이 늘어서는
 * 순서는 화면이 정한다(각 화면의 `*-detail-tabs-list.ts`).
 */
export function detailTabKeysOf<TabKey extends string>(
  table: DetailTabPermissionTable<TabKey>
): TabKey[] {
  return Object.keys(table) as TabKey[];
}
