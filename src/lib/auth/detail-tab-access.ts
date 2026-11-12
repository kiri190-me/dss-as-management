import "server-only";

import type { PermissionLevel } from "./permission-areas";
import { getPermissionLevel, type PermissionActor } from "./permission-resolver";
import {
  detailTabKeysOf,
  isDetailTabOpen,
  requiredKeysOfDetailTab,
  type DetailTabPermissionTable,
  type DetailTabVisibility,
} from "./detail-tab-permissions";

/**
 * ============================================================================
 * 상세 화면의 탭을 열 수 있는가 — 화면과 서버가 함께 쓰는 창구 (2026-11-12, 둘째)
 * ============================================================================
 * 🔴 **화면과 서버가 둘 다 막아야 한다.** 레이아웃이 탭을 감추는 것은 눌러도
 * "권한이 없습니다"만 나오는 탭을 내밀지 않기 위해서일 뿐, 관문이 아니다 —
 * 주소를 직접 치면 그대로 들어와진다. 그래서 각 탭의 page.tsx 가 **서버에서 다시**
 * 같은 질문을 한다.
 *
 * 판정 자체는 여기서 만들지 않는다 — `hasPermission` 을 부르고, 어떤 열쇠를
 * 물을지는 화면마다의 표가 정한다(`detail-tab-permissions.ts` 의 머리말).
 *
 * ── 🔴 조건을 여기에 적지 않는다 ────────────────────────────────────────
 * 수준만 읽어다 주고 판정은 `isDetailTabOpen` 하나가 한다. 탭 하나가 잎 여럿을
 * 보게 되면서(OR) 「어떻게 묶는가」가 생겼는데, 그것이 두 벌로 적히는 순간 화면과
 * 서버가 서로 다른 답을 낸다.
 *
 * ── 세션이 없으면 못 보는 것으로 본다 ───────────────────────────────────
 * 상위 (app) 레이아웃이 이미 로그인으로 돌려보내므로 정상적으로는 여기까지
 * `null` 이 오지 않는다. 그래도 **닫히는 쪽으로** 답한다 — 열리는 쪽으로 실패하면
 * 아무도 모른다.
 *
 * 🔵 **질의가 탭 수만큼 늘지 않는다** — `getPermissionLevel` 이 타고 들어가는
 * `resolveEffectivePermissions` 가 `cache()` 로 감싸여 있어 **요청당 한 번**만
 * 읽는다(permission-resolver.ts 의 '요청 한 번에 조회 한 번').
 * ============================================================================
 */

export async function canOpenDetailTab<TabKey extends string>(
  actor: PermissionActor | null,
  table: DetailTabPermissionTable<TabKey>,
  tab: TabKey
): Promise<boolean> {
  if (actor === null) return false;

  const levels = new Map<string, PermissionLevel>();
  for (const key of requiredKeysOfDetailTab(table, tab)) {
    levels.set(key, await getPermissionLevel(actor, key));
  }
  // 못 읽은 키는 '접근 불가'로 본다 — 닫히는 쪽으로 실패한다.
  return isDetailTabOpen(table, tab, (key) => levels.get(key) ?? "NONE");
}

/** 탭 줄이 그릴 것들. 화면마다 레이아웃 한 곳에서만 부른다. */
export async function resolveDetailTabVisibility<TabKey extends string>(
  actor: PermissionActor | null,
  table: DetailTabPermissionTable<TabKey>
): Promise<DetailTabVisibility<TabKey>> {
  const entries = await Promise.all(
    detailTabKeysOf(table).map(
      async (tab) => [tab, await canOpenDetailTab(actor, table, tab)] as const
    )
  );
  return Object.fromEntries(entries) as DetailTabVisibility<TabKey>;
}
