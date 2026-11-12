import type { PermissionLevel } from "./permission-areas";
import {
  detailTabKeysOf,
  isDetailTabOpen,
  requiredKeysOfDetailTab,
  type DetailTabPermissionTable,
  type DetailTabVisibility,
} from "./detail-tab-permissions";

/**
 * ============================================================================
 * 기타건 상세의 탭 ↔ 권한 잎 짝 (2026-11-12, 같은 날 둘째)
 * ============================================================================
 * 사용자 요구: 「수리건 상세나 기타건 상세 등 **안에 탭이 있는 화면의 탭들**에 대한
 * 접근 권한도 세세하게 설정할 수 있도록」. 오전에 수리 건 상세를 끝냈고
 * (`repair-case-detail-tab-permissions.ts`), 이 파일은 그 나머지다.
 *
 * ── 🔴 그 전까지 이 화면의 탭 단위 검사는 [견적서] 하나뿐이었다 ───────────
 * [발주서] · [승인]에는 **탭 자체를 가리는 검사가 0건**이었다. 두 페이지가 각각
 * `requireAreaAccessForCurrentUser("domesticOrders")` 를 걸고 있었지만 **그것은
 * 이 화면에 들어올 수 있는가**이고(레이아웃이 이미 같은 줄을 건다), 들어온 사람
 * 사이를 가르지 못한다 — 같은 열쇠를 한 번 더 물으면 **언제나 참**이라 아무것도
 * 재지 않는 검사가 된다. 2026-11-06 의 주석들이 이미 그렇게 적고 있었다.
 *
 * ── 🔴 그래서 먼저 메뉴를 쪼갰다 ────────────────────────────────────────
 * 가를 수 있으려면 **입장권과 다른 열쇠**가 있어야 하는데, 그 전까지 `domesticOrders`
 * 는 하위 기능이 없어 메뉴 키 자체가 유일한 잎이었다. 그래서 같은 날 그 메뉴를
 * 잎 넷으로 쪼갰다(조회 · 수정 · 삭제·복원 · 승인 — permission-features.ts).
 *
 * 🔵 **이제 입장권은 「잎 넷 중 하나라도 열려 있는가」**(메뉴 수준 = 잎들의 최대값)
 * 이고, 각 탭은 그보다 좁은 잎 하나를 본다. 그래서 가름이 실제로 선다:
 *   · 조회만 닫으면 → 들어오기는 하고 [발주서]만 사라진다
 *   · 승인만 닫으면 → 들어오기는 하고 [승인]만 사라진다
 * 두 경우 다 메뉴 수준은 여전히 READ 이상이라 **상세 화면 자체는 열린다.**
 *
 * ── 🔴 [기본정보]는 이 표에 **없다** ────────────────────────────────────
 * 빠뜨린 것이 아니라 **가리지 않기로 한 것**이다(2026-11-12 사용자 결정 ③ — 수리 건
 * 상세와 같은 까닭). 들어왔는데 첫 탭이 없는 상태를 만들지 않는다. 키 집합에서 아예
 * 빼 둔 것은 그 결정을 **타입이 지키게** 하려는 것이다. 🔵 덕분에 셋을 전부 닫아도
 * 탭이 하나도 없는 사람은 생기지 않는다.
 *
 * ============================================================================
 * 🔵 이번에 **손대지 않은 탭 화면 둘** — 빠뜨린 것이 아니다
 * ============================================================================
 * 저장소에서 주소로 가르는 탭 줄은 셋뿐이다(수리 건 상세 · 기타건 상세 · 내 담당
 * 제품). 셋째를 비롯해 아래 둘은 **일부러** 두었다. 적어 두지 않으면 다음 사람이
 * 「빠뜨렸네」 하고 다시 판다.
 *
 * ── 「내 담당 제품」(`/repair-cases/mine` · MineTabs.tsx) ────────────────
 * 탭 둘(진행 중인 담당 건 / 내 작업기록)은 **「내 것」을 가르는 것이지 권한을 가르는
 * 것이 아니다.** 둘 다 로그인한 그 사람의 자료만 보여 주고, 메뉴 자체는
 * `myActiveWork` 가 이미 통째로 막는다. 탭마다 잎을 두면 **설정만 늘고 뜻이 없다** —
 * 이 저장소가 minMeaningfulLevel 을 두는 그 까닭이다.
 * 🔴 **「브라우저 상태라서 못 막는다」가 아니다**(2026-11-12 실측). 그 탭은 주소로
 * 가른다(`/repair-cases/mine` ↔ `/repair-cases/mine/work-records`) — 막으려면 막을
 * 수 있다. 안 하는 까닭은 위의 「가를 것이 없다」 하나다.
 *
 * ── 견적서 상세의 [견적서 수정] · [견적서 결재](QuoteEditTabs.tsx) ───────
 * 🔴 **「서버에서 막을 자리가 없다」가 아니다**(2026-11-12 실측). 정확히는 둘이다:
 *   · 탭이 **주소에 없다** — `?tab=approval` 은 `useState` 의 초깃값으로만 쓰이고,
 *     그 뒤 탭 전환은 요청 없이 브라우저에서 일어난다. 그래서 「그 탭의 주소로
 *     들어오는 요청을 막는」 모양의 관문은 세울 자리가 없다.
 *   · 다만 두 칸 다 **서버가 그려 넘기는 슬롯**이라(`editForm` · `approvalPanel`),
 *     서버가 결재 칸을 아예 안 그리는 길은 **있다.** 화면에서 숨기는 것과 다르다.
 * 그 길로 가려면 「탭 단추는 무엇을 보고 사라지는가」를 새로 정해야 하고(지금 그
 * 조각은 두 칸을 **언제나** 그린다 — 떼어내면 적던 품목·금액이 사라지기 때문이다),
 * 그것은 이 조각과 다른 일이다. 2026-11-12 에 **안 하기로 정했다.**
 * ============================================================================
 */

/**
 * 가릴 수 있는 탭. 🔴 [기본정보](`root`)는 일부러 없다 — 위 머리말 참조.
 *
 * 이름은 `domain/domestic-order-detail-tabs.ts` 의 주소 키와 **같은 글자**다. 둘이
 * 어긋나면 「막은 탭과 안 보이는 탭이 다른」 일이 생긴다.
 */
export type DomesticOrderDetailTabKey = "quotes" | "purchaseOrders" | "approval";

export const DOMESTIC_ORDER_DETAIL_TAB_PERMISSIONS: DetailTabPermissionTable<DomesticOrderDetailTabKey> =
  {
    /**
     * 🔴 **다른 메뉴의 열쇠다 — 2026-11-06 부터 그랬고 바꾸지 않았다.** 견적서에는
     * 우리가 고객사에 부른 값이 통째로 있어서, 내자는 볼 수 있지만 견적서는 못 보는
     * 사람에게 이 탭이 열리면 그것이 곧 금액이 새는 구멍이다. 수리 건 상세의 같은
     * 탭이 쓰는 열쇠 그대로이고, 탭 전용 키를 새로 만들지 않는다.
     */
    quotes: { anyOf: [{ key: "quotes", level: "READ" }] },
    /**
     * 🔴 **조회 잎이다** — 수리 건 상세의 같은 탭과 **한 열쇠**다(그쪽도 같은 날
     * `domesticOrders` 메뉴 키에서 이 잎으로 내려왔다). 두 화면이 보여 주는 것이
     * 같은 서류함이라 정책이 둘이 되면 안 된다.
     *
     * 🔴 **입장권과 다른 열쇠여야 뜻이 있다.** 이 화면의 입장권은 메뉴 수준(잎 넷의
     * 최대값)이고 이 탭은 그중 조회 잎 하나를 본다 — 조회만 닫힌 사람은 들어는 오고
     * 이 탭만 못 본다. 2026-11-06 에 이것을 가리지 못한 까닭이 바로 「입장권과 같은
     * 열쇠뿐」이었다.
     */
    purchaseOrders: { anyOf: [{ key: "domesticOrders.view", level: "READ" }] },
    /**
     * 🔴 **결재권이 아니다.** 누가 승인·반려를 누를 수 있는가는 결재선과 그 단계
     * 위임이 정하고, 승인을 **올리는** 문턱은 `domesticOrders.edit`(WRITE)이다.
     * 이 열쇠는 「그 탭에 들어갈 수 있는가」 하나만 답한다 — 수리 건 상세의
     * `repairCases.approval` 과 같은 결이다.
     *
     * 🔴 기본값은 **지금 이 탭을 볼 수 있는 역할 전부**다(permission-baseline.ts).
     * 닫아 두고 시작하면 배포 즉시 아무도 못 본다.
     */
    approval: { anyOf: [{ key: "domesticOrders.approval", level: "READ" }] },
  };

/**
 * 이 탭이 열리는가 — **순수** 판정. 잎마다 이미 구한 수준을 받아 답한다.
 *
 * 🔴 **화면과 서버가 같은 함수에 닿는다.** 탭 줄을 그리는 레이아웃도, 주소를 직접
 * 친 사람을 막는 각 page.tsx 도 결국 여기로 온다(`detail-tab-access.ts` 를 거친
 * `domestic-order-detail-tab-access.ts` 가 수준을 읽어 와 넘긴다).
 */
export function isDomesticOrderDetailTabOpen(
  tab: DomesticOrderDetailTabKey,
  levelOf: (key: string) => PermissionLevel
): boolean {
  return isDetailTabOpen(DOMESTIC_ORDER_DETAIL_TAB_PERMISSIONS, tab, levelOf);
}

/** 이 탭이 보는 잎들. 수준을 미리 읽어 올 때 쓴다. */
export function requiredKeysOfDomesticOrderDetailTab(
  tab: DomesticOrderDetailTabKey
): readonly string[] {
  return requiredKeysOfDetailTab(DOMESTIC_ORDER_DETAIL_TAB_PERMISSIONS, tab);
}

/** 표에 적힌 차례 그대로. 탭 줄의 차례가 아니라 **훑는 차례**다(탭 차례는 화면이 정한다). */
export const DOMESTIC_ORDER_DETAIL_TAB_KEYS = detailTabKeysOf(
  DOMESTIC_ORDER_DETAIL_TAB_PERMISSIONS
);

/**
 * 어느 탭을 그릴까. 🔴 [기본정보]가 이 꾸러미에 없는 것이 결정 그 자체다 —
 * 그 탭은 언제나 그려진다.
 */
export type DomesticOrderDetailTabVisibility = DetailTabVisibility<DomesticOrderDetailTabKey>;
