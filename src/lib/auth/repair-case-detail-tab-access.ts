import "server-only";

import { canOpenDetailTab, resolveDetailTabVisibility } from "./detail-tab-access";
import type { PermissionActor } from "./permission-resolver";
import {
  REPAIR_CASE_DETAIL_TAB_PERMISSIONS,
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
 * ── 🔴 이 파일에는 **조건도 열쇠도 없다** (2026-11-12, 같은 날 둘째) ───────
 * 하던 일(수준을 읽어다 순수 판정에 넘기기)은 그대로인데, 그 일이 같은 날 오후
 * 기타건 상세에도 필요해지면서 **몸이 `detail-tab-access.ts` 로 옮겨 갔다.**
 * 여기 남은 것은 **어느 표를 쓰는가** 하나다 — 그 한 가지를 이 파일이 쥐고 있어야
 * 부르는 쪽(열두 페이지와 레이아웃)이 표를 손에 들고 다니지 않는다. 표를 넘기게
 * 두면 언젠가 **남의 화면 표**가 넘어가고, 그 실수는 아무 오류도 내지 않는다.
 *
 * ── 세션이 없으면 못 보는 것으로 본다 ───────────────────────────────────
 * 상위 (app) 레이아웃이 이미 로그인으로 돌려보내므로 정상적으로는 여기까지
 * `null` 이 오지 않는다. 그래도 **닫히는 쪽으로** 답한다(형제 탭들의 방어적 처리와
 * 같은 모양) — 열리는 쪽으로 실패하면 아무도 모른다. 그 처리는 공용 창구가 한다.
 * ============================================================================
 */

export async function canOpenRepairCaseDetailTab(
  actor: PermissionActor | null,
  tab: RepairCaseDetailTabKey
): Promise<boolean> {
  return canOpenDetailTab(actor, REPAIR_CASE_DETAIL_TAB_PERMISSIONS, tab);
}

/**
 * 탭 줄이 그릴 것들. 레이아웃 한 곳에서만 부른다.
 *
 * 🔵 질의가 탭 수만큼 늘지 않는다 — `resolveEffectivePermissions` 가 `cache()` 로
 * 감싸여 있어 **요청당 한 번**만 읽는다(permission-resolver.ts).
 */
export async function resolveRepairCaseDetailTabVisibility(
  actor: PermissionActor | null
): Promise<RepairCaseDetailTabVisibility> {
  return resolveDetailTabVisibility(actor, REPAIR_CASE_DETAIL_TAB_PERMISSIONS);
}
