import { navGroups, navItems } from "../navigation";
import { PERMISSION_AREAS, type PermissionArea } from "./permission-areas";

/**
 * ============================================================================
 * 권한 영역을 **실제 메뉴의 묶음과 차례대로** 늘어놓는다 (2026-11-12)
 * ============================================================================
 * 역할별 접근 권한 화면의 왼쪽 목록은 지금까지 PERMISSION_AREAS 를 적힌 차례
 * 그대로 평평하게 그렸다. 그래서 화면과 메뉴가 네 군데에서 어긋나 있었다 —
 * [사용자 관리]가 중간에 끼어 있고, [관리]가 [기술 / 자원]보다 앞서고, 메일
 * 설정과 시스템 설정이 뒤바뀌고, 묶음 머리말이 하나도 없었다. 권한을 정하는
 * 사람은 메뉴를 보면서 이 화면을 찾으므로, 두 차례가 다르면 매번 눈으로
 * 맞춰 읽어야 한다.
 *
 * ── 🔴 여기서 **정하지 않는 것** ─────────────────────────────────────────
 * 「무엇을 설정할 수 있는가」의 주인은 여전히 PERMISSION_AREAS 다. 이 파일은
 * 그 목록에 **묶음 소속과 차례만** 입힌다 — 영역을 더하지도 빼지도 않고
 * (아래 ③ 이 그것을 보장한다), 열쇠도 이름표도 손대지 않는다. 열쇠는 운영
 * DB 의 role_permissions 에 그 글자로 저장돼 있어서, 바뀌는 순간 저장된
 * 설정이 **오류 없이 조용히** 무효가 된다.
 *
 * ── 🔴 묶음과 차례를 navigation.ts 에서 **읽어 온다** ────────────────────
 * 손으로 한 벌 더 적지 않는다. 이 저장소에서 같은 말이 두 곳에 적혀 타입이
 * 같은 탓에 tsc 가 침묵한 적이 있고, 그때 증상은 「한 화면만 안 바뀌었다」라
 * 재시작 문제처럼 보였다. 여기서 읽어 오면 메뉴가 바뀔 때 이 화면이 **저절로**
 * 따라간다.
 *
 * ── 세 갈래로 나뉜다 ────────────────────────────────────────────────────
 *  ① 묶음 없이 단독으로 서는 줄 — 지금은 대시보드 하나이고, 그 아래 주간보고가
 *     **하위메뉴**로 들여써진다(navItems 의 parentKey). 사이드바가 그리는 모양
 *     그대로다.
 *  ② navGroups 의 묶음 다섯 — 머리말 글자도 차례도 그쪽 것을 그대로 쓴다.
 *  ③ 🔴 **메뉴에 없는 항목** — 메뉴에서 감췄거나(hiddenFromMenu) 메뉴에 아예
 *     없는 영역을 맨 아래에 따로 모은다. 조용히 빼지 않는 것이 요점이다:
 *     지금 관리자는 「재고 관리를 관리로 열었다」고 믿는데 메뉴가 안 떠서
 *     사이드바에서는 아무 일도 일어나지 않는다. 감추면 그 오해가 영영 안 풀리고,
 *     저장된 값을 되돌릴 길도 화면에서 사라진다.
 *
 * ── 🔴 반대 경우(메뉴에는 있는데 권한 영역이 없다)는 **줄을 만들지 않는다** ──
 * 개발자 모드 하나뿐이고, 일부러 없는 것이다 — PERMISSION_AREAS 에 넣으면
 * 최고관리자가 다른 역할에게 그 화면을 열어 줄 수 있게 된다
 * (auth/developer-mode-gate.ts · navigation.ts 의 그 항목 주석).
 * ============================================================================
 */

export type PermissionAreaNode = {
  area: PermissionArea;
  /**
   * 이 영역의 **하위메뉴**들 — 부모와 **다른 화면**이다(navItems 의 parentKey).
   *
   * 🔴 같은 화면 안의 **하위 기능**(permission-features.ts 의 잎)과 섞지 마라.
   * 둘은 뜻이 다르다: 주간보고는 대시보드와 별개의 화면이고, 「접수 건 조회」는
   * 전체 A/S 현황 **안**의 조작이다. 화면에서도 같은 모양으로 그리면 읽는
   * 사람이 둘을 같은 것으로 읽는다.
   */
  children: PermissionAreaNode[];
  /** 🔴 메뉴에 나오지 않는 항목. 화면이 그 사실을 드러내야 한다(아래 ③). */
  notInMenu?: true;
};

export type PermissionAreaGroup = {
  key: string;
  /**
   * 머리말. 🔴 **null 이면 머리말을 그리지 않는다** — 사이드바에서도 묶음 없이
   * 단독으로 서는 줄이라, 여기에만 없는 이름을 지어 붙이면 그것이 곧 두 벌로
   * 적힌 말이 된다.
   */
  label: string | null;
  /** 이 묶음이 ③(메뉴에 없는 항목)인가. 화면이 안내 문구를 붙이는 근거다. */
  notInMenu?: true;
  nodes: PermissionAreaNode[];
};

/** 머리말 없이 단독으로 서는 묶음. React key 로만 쓰인다. */
export const STANDALONE_GROUP_KEY = "standalone";

/**
 * 🔴 메뉴에 없는 항목을 모으는 묶음. 열쇠와 이름표를 상수로 둔 까닭은 화면과
 * 시험이 **같은 글자**를 봐야 하기 때문이다 — 머리말이 조용히 바뀌면 「드러나는가」를
 * 재는 시험이 그대로 통과한 채 화면에서만 사라진다.
 */
export const NOT_IN_MENU_GROUP_KEY = "notInMenu";
export const NOT_IN_MENU_GROUP_LABEL = "메뉴에 없는 항목";

const AREA_BY_KEY = new Map(PERMISSION_AREAS.map((area) => [area.key, area]));
const HIDDEN_FROM_MENU_KEYS = new Set(
  navItems.filter((item) => item.hiddenFromMenu).map((item) => item.key)
);
const GROUPED_KEYS = new Set(navGroups.flatMap((group) => group.itemKeys));

function buildPermissionAreaGroups(): PermissionAreaGroup[] {
  /** 이미 어느 묶음에 들어간 영역. 남은 것이 곧 ③ 이다. */
  const claimed = new Set<string>();

  function nodeFor(key: string): PermissionAreaNode | undefined {
    const area = AREA_BY_KEY.get(key);
    // 메뉴에는 있는데 권한 영역이 없는 열쇠(개발자 모드). 위 머리말 참조.
    if (!area) return undefined;
    // 감춘 항목은 여기서 집지 않는다 — 아래 ③ 이 맨 끝에서 집는다. 여기서 집으면
    // 「메뉴에 있는 것」과 한 줄에 서게 되어 감춰졌다는 사실이 사라진다.
    if (HIDDEN_FROM_MENU_KEYS.has(key)) return undefined;
    claimed.add(key);
    const children = navItems
      .filter((item) => item.parentKey === key)
      .map((item) => nodeFor(item.key))
      .filter((node): node is PermissionAreaNode => node !== undefined);
    return { area, children };
  }

  const groups: PermissionAreaGroup[] = [];

  // ① 묶음 밖에 단독으로 서는 줄 + 그 하위메뉴. 「대시보드」를 글자로 적지 않고
  //    「어느 묶음에도 들어가지 않은 항목」으로 고르는 까닭: navigation.test.ts 가
  //    「대시보드와 그 하위메뉴를 뺀 모든 열쇠는 정확히 한 묶음에」를 지키므로,
  //    이 조건은 그 불변식의 뒷면이다. 둘째 단독 항목이 생기면 저절로 따라온다.
  const standaloneNodes = navItems
    .filter((item) => item.parentKey === undefined && !GROUPED_KEYS.has(item.key))
    .map((item) => nodeFor(item.key))
    .filter((node): node is PermissionAreaNode => node !== undefined);
  if (standaloneNodes.length > 0) {
    groups.push({ key: STANDALONE_GROUP_KEY, label: null, nodes: standaloneNodes });
  }

  // ② 메뉴의 묶음 — 차례도 이름표도 navGroups 그대로다. 그 묶음의 항목이 하나도
  //    권한 영역이 아니면 머리말만 남으므로 묶음째 거른다(지금 그런 묶음은 없다).
  for (const group of navGroups) {
    const nodes = group.itemKeys
      .map((key) => nodeFor(key))
      .filter((node): node is PermissionAreaNode => node !== undefined);
    if (nodes.length === 0) continue;
    groups.push({ key: group.key, label: group.label, nodes });
  }

  // ③ 🔴 남은 영역 전부. 「감춘 것」과 「메뉴에 아예 없는 것」을 한 자리에서 집는
  //    까닭은 하나다 — 어느 쪽이든 **화면에서 사라지면 안 된다.** 차례는
  //    PERMISSION_AREAS 에 적힌 그대로 둔다(메뉴 차례를 빌려 올 데가 없다).
  const orphanNodes = PERMISSION_AREAS.filter((area) => !claimed.has(area.key)).map(
    (area): PermissionAreaNode => ({ area, children: [], notInMenu: true })
  );
  if (orphanNodes.length > 0) {
    groups.push({
      key: NOT_IN_MENU_GROUP_KEY,
      label: NOT_IN_MENU_GROUP_LABEL,
      notInMenu: true,
      nodes: orphanNodes,
    });
  }

  return groups;
}

export const PERMISSION_AREA_GROUPS: readonly PermissionAreaGroup[] = buildPermissionAreaGroups();

/**
 * 화면에 그려지는 차례 그대로의 영역 열쇠 전부 — 하위메뉴도 제자리에 들어간다.
 *
 * 🔴 이 값이 있는 까닭은 **수를 세기 위해서**다. 재배치하다 한 줄을 빠뜨리면
 * 오류 없이 그 영역만 화면에서 사라지고, 그러면 저장된 값을 되돌릴 길이 없어진다.
 * 시험이 PERMISSION_AREAS 와 이 목록을 맞대어 본다.
 */
export const PERMISSION_AREA_KEYS_IN_SCREEN_ORDER: readonly string[] = PERMISSION_AREA_GROUPS.flatMap(
  (group) => group.nodes.flatMap(flattenNodeKeys)
);

function flattenNodeKeys(node: PermissionAreaNode): string[] {
  return [node.area.key, ...node.children.flatMap(flattenNodeKeys)];
}

/**
 * 메뉴에는 있는데 권한 영역이 **없는** 열쇠.
 *
 * 🔵 지금은 개발자 모드 하나이고, 그것이 사실로 남아야 한다 — 시험이 이 값을
 * 그대로 맞대어 본다. 둘째가 생기면 「설정으로 열 수 없는 화면」이 하나 더
 * 생겼다는 뜻이므로 사람이 한 번 보고 들여야 한다.
 */
export const MENU_KEYS_WITHOUT_PERMISSION_AREA: readonly string[] = navItems
  .map((item) => item.key)
  .filter((key) => !AREA_BY_KEY.has(key));
