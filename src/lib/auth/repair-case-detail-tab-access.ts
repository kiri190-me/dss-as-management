import "server-only";

import type { PermissionLevel } from "./permission-areas";
import { getPermissionLevel, type PermissionActor } from "./permission-resolver";
import {
  REPAIR_CASE_DETAIL_TAB_KEYS,
  isRepairCaseDetailTabOpen,
  requiredKeysOfRepairCaseDetailTab,
  type RepairCaseDetailTabKey,
  type RepairCaseDetailTabVisibility,
} from "./repair-case-detail-tab-permissions";

/**
 * ============================================================================
 * 수리 건 상세의 탭을 열 수 있는가 — 화면과 서버가 함께 쓰는 창구 (2026-11-12)
 * ============================================================================
 * 🔴 **화면과 서버가 둘 다 막아야 한다.** 레이아웃이 탭을 감추는 것은 눌러도
 * "권한이 없습니다"만 나오는 탭을 내밀지 않기 위해서일 뿐, 관문이 아니다 —
 * 주소를 직접 치면 그대로 들어와진다. 그래서 각 탭의 page.tsx 가 **서버에서 다시**
 * 같은 질문을 한다. [견적서] 탭이 2026-08 부터 그 모양이었고, 이 창구는 그 패턴을
 * 아홉 탭으로 넓히면서 **열쇠가 두 벌이 되지 않게** 묶은 것이다.
 *
 * 판정 자체는 새로 만들지 않는다 — `hasPermission` 하나를 부르고, 어떤 열쇠를
 * 물을지는 repair-case-detail-tab-permissions.ts 의 표가 정한다.
 *
 * ── 세션이 없으면 못 보는 것으로 본다 ───────────────────────────────────
 * 상위 (app) 레이아웃이 이미 로그인으로 돌려보내므로 정상적으로는 여기까지
 * `null` 이 오지 않는다. 그래도 **닫히는 쪽으로** 답한다(형제 탭들의 방어적 처리와
 * 같은 모양) — 열리는 쪽으로 실패하면 아무도 모른다.
 * ============================================================================
 */

export async function canOpenRepairCaseDetailTab(
  actor: PermissionActor | null,
  tab: RepairCaseDetailTabKey
): Promise<boolean> {
  if (actor === null) return false;

  /**
   * 🔴 **조건을 여기서 적지 않는다** — 수준만 읽어다 주고 판정은
   * `isRepairCaseDetailTabOpen` 하나가 한다. 탭 하나가 잎 여럿을 보게 되면서
   * (OR — [작업내용]이 그렇다) 「어떻게 묶는가」가 생겼는데, 그것이 두 벌로 적히는
   * 순간 화면과 서버가 서로 다른 답을 낸다.
   *
   * 🔵 잎을 여럿 읽어도 질의는 늘지 않는다 — `getPermissionLevel` 이 타고 들어가는
   * `resolveEffectivePermissions` 가 `cache()` 로 요청당 한 번이다.
   */
  const levels = new Map<string, PermissionLevel>();
  for (const key of requiredKeysOfRepairCaseDetailTab(tab)) {
    levels.set(key, await getPermissionLevel(actor, key));
  }
  // 못 읽은 키는 '접근 불가'로 본다 — 닫히는 쪽으로 실패한다.
  return isRepairCaseDetailTabOpen(tab, (key) => levels.get(key) ?? "NONE");
}

/**
 * 탭 줄이 그릴 것들. 레이아웃 한 곳에서만 부른다.
 *
 * 🔴 질의가 탭 수만큼 늘지 않는다 — `hasPermission` 이 타고 들어가는
 * `resolveEffectivePermissions` 가 `cache()` 로 감싸여 있어 **요청당 한 번**만
 * 읽는다(permission-resolver.ts 의 '요청 한 번에 조회 한 번').
 */
export async function resolveRepairCaseDetailTabVisibility(
  actor: PermissionActor | null
): Promise<RepairCaseDetailTabVisibility> {
  const entries = await Promise.all(
    REPAIR_CASE_DETAIL_TAB_KEYS.map(
      async (tab) => [tab, await canOpenRepairCaseDetailTab(actor, tab)] as const
    )
  );
  return Object.fromEntries(entries) as RepairCaseDetailTabVisibility;
}
