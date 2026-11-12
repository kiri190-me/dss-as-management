import "server-only";

import { canOpenDetailTab, resolveDetailTabVisibility } from "./detail-tab-access";
import type { PermissionActor } from "./permission-resolver";
import {
  DOMESTIC_ORDER_DETAIL_TAB_PERMISSIONS,
  type DomesticOrderDetailTabKey,
  type DomesticOrderDetailTabVisibility,
} from "./domestic-order-detail-tab-permissions";

/**
 * ============================================================================
 * 기타건 상세의 탭을 열 수 있는가 — 화면과 서버가 함께 쓰는 창구 (2026-11-12, 둘째)
 * ============================================================================
 * 🔴 **화면과 서버가 둘 다 막아야 한다.** 레이아웃이 탭을 감추는 것은 눌러도
 * "권한이 없습니다"만 나오는 탭을 내밀지 않기 위해서일 뿐, 관문이 아니다 — 주소를
 * 직접 치면 그대로 들어와진다. 그래서 각 탭의 page.tsx 가 **서버에서 다시** 같은
 * 질문을 한다.
 *
 * 🔴 **이 파일에는 조건도 열쇠도 없다.** 수준을 읽어다 순수 판정에 넘기는 일은
 * 공용 창구(`detail-tab-access.ts`)가 하고, 어느 탭이 어느 잎을 보는지는 표
 * (`domestic-order-detail-tab-permissions.ts`)가 갖는다. 여기 남은 것은 **어느
 * 표를 쓰는가** 하나다 — 그래야 부르는 쪽이 표를 손에 들고 다니지 않는다(남의
 * 화면 표를 넘기는 실수는 아무 오류도 내지 않는다).
 *
 * 🔵 수리 건 상세의 같은 자리(`repair-case-detail-tab-access.ts`)와 **짝**이다.
 * 둘이 하는 일이 같아 보이는 것은 실제로 같기 때문이고, 그 같은 부분은 공용 창구
 * 하나에만 적혀 있다.
 * ============================================================================
 */

export async function canOpenDomesticOrderDetailTab(
  actor: PermissionActor | null,
  tab: DomesticOrderDetailTabKey
): Promise<boolean> {
  return canOpenDetailTab(actor, DOMESTIC_ORDER_DETAIL_TAB_PERMISSIONS, tab);
}

/**
 * 탭 줄이 그릴 것들. 레이아웃 한 곳에서만 부른다.
 *
 * 🔵 질의가 탭 수만큼 늘지 않는다 — `resolveEffectivePermissions` 가 `cache()` 로
 * 감싸여 있어 **요청당 한 번**만 읽는다(permission-resolver.ts).
 */
export async function resolveDomesticOrderDetailTabVisibility(
  actor: PermissionActor | null
): Promise<DomesticOrderDetailTabVisibility> {
  return resolveDetailTabVisibility(actor, DOMESTIC_ORDER_DETAIL_TAB_PERMISSIONS);
}
