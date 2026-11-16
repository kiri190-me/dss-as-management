import "server-only";
import { resolveActingApproverUserIds } from "@/lib/db/queries/approval-route-delegations";
import { getSsoSubjectForUser, listUserIdsBySsoSubjects } from "@/lib/db/queries/users";
import { resolvePortalRouteDelegations } from "@/lib/server/integration/portal-delegations";
import type { PortalRouteDelegations } from "@/lib/domain/portal-approval-delegation";

/**
 * ============================================================================
 * 🔴 **읽는 쪽이 포털까지 물어 만드는 「지금 누를 수 있는 자리들」** (2026-11-16)
 * ============================================================================
 * 조각 3a(커밋 4285c277)가 **결재를 실행하는 쪽**을 포털 위임에 이어 두었다. 그런데
 * **보여 주는 쪽**이 안 물어서 반쪽이었다 — 승인함에만 위임을 맡은 사람은 대기
 * 목록에 건이 안 뜨고 결재 화면에 단추도 안 그려졌다. **서버는 받아 주는데 누를
 * 자리가 없었다.** 이 파일이 그 길을 잇는다.
 *
 * ── 🔴 왜 조회(`db/queries/...`)가 스스로 묻지 않고 여기를 거치나 ───────────
 * 둘이다.
 *
 *  1. 🔴 **되돌아 부르는 길이 생긴다.** 대기 목록 조회 셋은 **포털이 되묻는 통로**
 *     둘(`app/api/integration/approvals/route.ts` · 같은 폴더의 `notifications`)에서도
 *     불린다. 그 통로를 부르는 쪽이 **포털 자신**이라, 거기서 또 포털에 물으면 포털이
 *     A/S 를 기다리는 동안 A/S 가 포털을 기다린다 — 상한이 양쪽에 있어 멈추지는 않지만
 *     결재함 한 번 여는 데 왕복이 사람 수만큼 는다. 🔴 **그래서 조회의 인자에 기본값이
 *     있고(「안 물었다」), 묻는 것은 부르는 쪽이 정한다**(queries/approval-route-
 *     delegations.ts 의 NO_PORTAL_DELEGATION_USER_IDS 주석이 같은 이야기를 한다).
 *  2. 🔴 **층 가르기가 한 방향이다.** `src/lib/db` 안에서 `@/lib/server/...` 를 끌어오는
 *     파일이 하나도 없다. 망 호출은 `server/` 쪽 일이고, 조회는 받은 목록을 쓸 뿐이다.
 *
 * ── 🔴 열쇠를 바꾸는 조회 둘을 **여기 한 곳에서만** 꽂는다 ──────────────────
 * `resolvePortalRouteDelegations` 는 `@/lib/db` 를 직접 끌어오지 않는다(그쪽
 * `PortalDelegationQueries` 주석 — 안 그러면 단위 시험이 통째로 못 돈다). 그래서 꽂는
 * 자리가 필요한데, 결재 **쓰기**는 서버 액션 셋이 각자 꽂고(조각 3a) **읽기**는 이
 * 파일 하나가 꽂는다. 🔴 읽는 자리마다 꽂게 두면 다섯 곳에 같은 두 줄이 생기고,
 * 그중 하나에 엉뚱한 함수를 꽂아도 타입이 안 막는다(둘 다 `users` 조회다).
 *
 * ── 🔴 여기서 **판정하지 않는다** ────────────────────────────────────────
 * 「누를 수 있나」의 뜻은 `domain/approval-route-delegation.ts` 의
 * `actingApproverUserIds` 하나가 쥔다(합집합 · 본인 맨 앞 · 중복 제거 · 이어 붙지
 * 않음). 이 파일이 하는 일은 **묻고 · 넘기고 · 「못 물었다」를 함께 내보내는** 것뿐이다.
 *
 * 🔴 **던지지 않는다.** 포털이 죽었든 느렸든 설정이 빠졌든 `resolvePortalRouteDelegations`
 * 가 전부 삼키고 「못 물었다」를 값으로 준다(설계 B-6). 그 사실은 버리지 않고 화면까지
 * 들고 간다 — 버리면 **대리인만 조용히 막힌다**(B-7, 이 저장소들에서 가장 비싼 결함 모양).
 * ============================================================================
 */

/**
 * 포털에 묻는다 — **A/S `users.id` 로 바뀐 목록**과 「못 물었다」가 함께 온다.
 *
 * 쓰는 자리는 둘이다: 아래 `resolveActingApproversForScreen`(결재 화면 셋)과, 대기
 * 목록 조회 셋을 부르는 **A/S 자신의 화면**(종 · 접수 건 목록). 🔴 포털이 되묻는 통로
 * 둘에서는 **부르지 마라**(파일 머리말 1번).
 */
export async function readPortalRouteDelegations(
  actorUserId: string
): Promise<PortalRouteDelegations> {
  return resolvePortalRouteDelegations(actorUserId, {
    readPortalSubject: getSsoSubjectForUser,
    readUserIdsBySubjects: listUserIdsBySsoSubjects,
  });
}

/**
 * 결재 화면이 받아 가는 값 한 쌍.
 *
 * 🔴 **두 칸을 한 칸으로 줄이지 마라.** 빈 목록과 「못 물었다」가 갈려 있어야 화면이
 * 「없습니다」와 「지금 확인할 수 없습니다」를 다르게 말할 수 있다
 * (domain/portal-approval-delegation.ts 머리말).
 */
export type ActingApproversForScreen = {
  /**
   * 🔴 **맨 앞은 언제나 본인**이고, 뒤에 A/S 제 위임과 포털 위임이 합쳐 붙는다.
   * 화면은 이 목록을 공용 관문(`mayDecideAssignedApproval`)에 **그대로 넘기기만** 한다.
   */
  userIds: readonly string[];
  /** 🔴 포털에 못 물었다 — 화면이 안내를 띄우는 조건이다(설계 B-7). */
  portalDelegationUnavailable: boolean;
};

/**
 * 🔴 **로그인 사용자를 못 읽은 화면의 답.** 그때는 단추를 아예 그리지 않으므로 목록이
 * 비고, **안내도 뜨지 않는다** — 묻지 않은 것은 장애가 아니다.
 */
export const NO_ACTING_APPROVERS: ActingApproversForScreen = {
  userIds: [],
  portalDelegationUnavailable: false,
};

/**
 * 🔴 **결재 화면 셋이 부르는 입구**(접수 건 검수/승인 · 견적서 결재 · 기타건 승인).
 *
 * 🔵 화면에 주는 것은 **힌트**다. 실제 승인·반려는 결재 mutation 이 **자기 트랜잭션
 * 안에서** 같은 규칙으로 다시 판정한다 — 읽은 직후 되돌려진 위임으로 결재가 통과하지
 * 않게 하려면 그 길밖에 없다. 그래서 여기서는 트랜잭션을 넘기지 않는다(조회의 기본값
 * 그대로다).
 *
 * 🔴 **포털을 먼저 묻고 그 답을 조회에 넘긴다.** 순서를 뒤집어 조회를 먼저 돌리면
 * 포털 목록이 판정에 못 들어가고, 그 어긋남은 오류를 한 줄도 내지 않는다 —
 * 「단추가 안 보인다」로만 드러난다.
 */
export async function resolveActingApproversForScreen(
  actorUserId: string,
  now: Date = new Date()
): Promise<ActingApproversForScreen> {
  const portal = await readPortalRouteDelegations(actorUserId);
  const userIds = await resolveActingApproverUserIds(
    actorUserId,
    now,
    // 🔵 트랜잭션이 없다 — 읽기 전용이고 최종 판정도 아니다(위 주석). 기본값을 쓰려고
    //    `undefined` 를 적는다: 넷째 인자만 주려면 셋째 자리를 비워 둘 수 없다.
    undefined,
    portal.delegatorUserIds
  );
  return { userIds, portalDelegationUnavailable: portal.unavailable };
}
