/**
 * ============================================================================
 * [사용자 관리]의 탭 다섯 — 누구에게 몇 개가 보이는가
 * ============================================================================
 * 2026-10-26: 「결재권 위임」 탭이 **역할별 접근 권한 설정 밖의 길**로 열리면서
 * (auth/users-area-access.ts) 이 화면에 **탭이 하나뿐인 사람**이 생겼다. 그
 * 사람에게 「출하 대표자 / 위임」·「승인 절차」가 보이면 안 된다 — 그 둘은
 * 관리자의 화면이고, 서버 페이지는 애초에 그 자료를 읽지도 않는다.
 *
 * 🔴 **조건을 JSX 에 흩어 두지 않고 여기 한 번만 적는다.** 흩어 두면 탭 단추와
 * 탭 내용과 「첫 탭은 무엇인가」가 각자 따지게 되고, 그때 생기는 어긋남이
 * 「단추는 없는데 그 내용이 그려진다」(또는 그 반대)다. 순수 함수라 값으로 잴 수
 * 있는 것도 그래서다 — 화면 본체는 서버 액션을 가져오는 클라이언트 컴포넌트라
 * 시험에서 렌더할 수 없다.
 * ============================================================================
 */

/** 🔴 **차례가 곧 탭 줄의 차례**다. 아래 함수가 이 순서대로 돌려준다. */
export const USERS_TAB_KEYS = [
  "representatives",
  "approvalRoute",
  "routeDelegation",
  "permissions",
  "developer",
] as const;

export type UsersTabKey = (typeof USERS_TAB_KEYS)[number];

export type UsersTabFlags = {
  /**
   * 역할별 접근 권한(`users.view`)으로 들어온 사람인가. 🔴 거짓이면 **결재선에
   * 올라 있어 열린 사람**이고, 그에게는 관리 탭이 없다.
   */
  canViewUsersAdminTabs: boolean;
  /** 역할별 권한 설정 자료가 내려왔는가(관리자 이상일 때만 내려온다). */
  hasRolePermissions: boolean;
  /** 개발자 표시를 켜고 끌 수 있는가 — **진짜 최고관리자만** 참이다. */
  canManageDeveloperFlag: boolean;
};

/**
 * 지금 이 사람에게 보이는 탭들. 차례는 `USERS_TAB_KEYS` 그대로다.
 *
 * 🔴 **`routeDelegation` 은 어떤 조합에서도 빠지지 않는다.** 누구나 자기 결재권은
 * 맡길 수 있다는 결정(2026-10-26)이 화면에서 지켜지는 자리가 여기다 — 아래
 * 시험이 모든 조합을 돌며 그것을 단언한다.
 */
export function visibleUsersTabKeys(flags: UsersTabFlags): UsersTabKey[] {
  return USERS_TAB_KEYS.filter((key) => {
    switch (key) {
      // 둘은 관리자의 탭이다. 2026-10-26 전에는 **조건이 없었다** — 그때는 이
      // 화면에 들어오는 사람이 곧 `users.view` 를 가진 사람이었기 때문이다.
      case "representatives":
      case "approvalRoute":
        return flags.canViewUsersAdminTabs;
      case "permissions":
        return flags.hasRolePermissions;
      case "developer":
        return flags.canManageDeveloperFlag;
      // 🔴 조건 없이 늘 보인다.
      case "routeDelegation":
        return true;
    }
  });
}

/**
 * 화면을 열었을 때 처음 보여 줄 탭 — **보이는 것 가운데 첫째**다.
 *
 * 🔴 「언제나 representatives」로 두면, 관리 탭이 없는 사람은 **아무것도 없는
 * 화면**을 본다(그 탭의 내용은 그 사람에게 그려지지 않는다). 탭 줄에도 그 단추가
 * 없으니 옮겨 갈 길조차 없다.
 *
 * 🔵 빈 목록은 나올 수 없다 — `routeDelegation` 이 늘 들어 있다. 그래도 타입이
 * `undefined` 를 허락하지 않도록 못을 박아 둔다: 위 함수가 언젠가 그 줄을 조건
 * 뒤로 옮기면 여기서 바로 드러나야 한다.
 */
export function initialUsersTab(flags: UsersTabFlags): UsersTabKey {
  return visibleUsersTabKeys(flags)[0] ?? "routeDelegation";
}
