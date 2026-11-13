import "server-only";

import { hasPermission, type PermissionActor } from "./permission-resolver";

/**
 * ============================================================================
 * 배지 표시 설정을 바꿀 수 있는가 (2026-11-13)
 * ============================================================================
 * [설정] → [시스템 설정] → [배지 표시] 를 **저장**할 수 있는 사람인가를 묻는 한
 * 줄이다. 보기는 이 함수가 가르지 않는다 — 그 화면에 들어오는 일은 메뉴 관문
 * (`requireAreaAccessForCurrentUser("settings")`)이 읽기 수준으로 이미 가른다.
 *
 * ── 왜 이름을 따로 두면서 답은 빌려 오는가 ──────────────────────────────
 * ui-theme-authorization.ts 가 선 자리와 같은 모양이다. 이것은 「시스템 설정 메뉴에
 * 들어갈 수 있는가」와 **다른 질문**이다 — 「누가 모든 사람의 화면에서 배지를
 * 지우는가」다. 지금은 두 답이 한 열쇠(`settings`)의 두 수준으로 갈리지만, 질문마다
 * 이름이 있어야 나중에 한쪽만 바뀔 때 고칠 자리가 어디인지 알 수 있다. 그날 고칠
 * 것은 이 함수 한 줄이다.
 *
 * ── 🔴 왜 순수 함수(Role → boolean)가 아닌가 ───────────────────────────
 * 이웃한 *-authorization.ts 대부분은 Role 만 보는 순수 함수인데 이 파일은 비동기이고
 * `server-only` 다. `settings` 가 **설정이 최종 판정인 영역**이기 때문이다
 * (permission-features.ts 의 SETTINGS_ENFORCED_LEAVES 에 그 열쇠가 있다) — 여기에
 * 역할 목록을 적어 AND 로 걸면, 권한 설정 화면이 「넓히면 실제로 열립니다」라고
 * 말해 두고 실제로는 안 열리는 상태가 만들어진다. 관리자가 역할별 접근 권한에서
 * 「시스템 설정 = 관리」를 준 사람은 **정말로** 저장할 수 있어야 한다.
 * permission-baseline.ts 의 `case "settings"` 가 정하는 것은 그 설정을 아무도 만지지
 * 않았을 때의 **기본값**이고, 관문은 이 함수 하나다.
 *
 * 🔵 질의가 늘지 않는다 — `resolveEffectivePermissions` 가 `cache()` 로 감싸여 있어
 * 요청당 한 번만 읽는다(permission-resolver.ts).
 *
 * ── 실제로 무엇이 막히는가 ──────────────────────────────────────────────
 * 부르는 자리가 셋이고, 셋이 **같은 열쇠·같은 수준**을 본다:
 *   · app/(app)/settings/page.tsx — 체크상자를 비활성으로 그릴지, [저장]을 그릴지
 *   · server/actions/badge-visibility-settings.ts — 저장 요청을 받을지
 *   · db/mutations/badge-visibility-settings.ts — 트랜잭션 안에서 한 번 더
 * 화면에서 단추를 감추는 것은 막은 것이 아니다(서버 액션은 주소를 몰라도 부를 수
 * 있다). 겹쳐 두는 것은 이 저장소의 관례다 — 한쪽이 무너져도 다른 쪽이 남는다.
 * ============================================================================
 */

/**
 * 🔴 영역 열쇠. 세 자리가 이 상수를 가져다 쓴다 — 글자를 세 벌로 적으면 그중
 * 하나만 고쳐지는 날 「화면은 잠겼는데 서버는 통과」(또는 그 반대)가 된다.
 */
export const BADGE_VISIBILITY_AREA_KEY = "settings";

/**
 * 이 사람이 배지 표시 설정을 저장할 수 있는가.
 *
 * 🔴 세션이 없으면 **거짓**이다 — 닫히는 쪽으로 실패한다. 열리는 쪽으로 틀리면
 * 아무도 모르는 채로 모든 사람의 배지가 꺼질 수 있다.
 *
 * ⚠️ 개발자 표시가 켜진 계정은 최고관리자 권한이 **더해져** 들어온다
 * (permission-resolver.ts). 역할의 권한을 닫아 두어도 이 함수가 참을 돌려주는
 * 경우가 그것이고, 「닫으면 막히는가」를 재는 시험은 표본 계정의 `isDeveloper` 가
 * 꺼져 있는지 먼저 확인해야 한다.
 */
export async function mayManageBadgeVisibility(actor: PermissionActor | null): Promise<boolean> {
  if (!actor) return false;
  return hasPermission(actor, BADGE_VISIBILITY_AREA_KEY, "MANAGE");
}
