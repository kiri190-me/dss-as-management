import { addCalendarDays, isKstMidnight, kstMidnightInstant, toKstDateOnly } from "./date-only";
import type { ShipmentDelegationDisplayStatus } from "./shipment-delegation-status";

/**
 * ============================================================================
 * 결재선 단계 위임 — 순수 규칙
 * ============================================================================
 * DB 도 서버도 여기서 만지지 않는다. **받은 값을 보고 답만 한다.** 그래서
 * `server-only` 를 물지 않고, 화면 묶음이 그대로 끌어와도 postgres 클라이언트가
 * 브라우저 번들에 딸려 들어가지 않는다(옆의 `shipment-delegation-status.ts` 가 같은
 * 까닭으로 같은 자리에 있다).
 *
 * 표는 `approval_route_delegations`(vendor/dss-core/src/schema/
 * approval-route-delegations.ts)다. 🔴 **옛 `shipment_approval_delegations`(출하
 * 대표 위임)와 다른 표다** — 무엇이 어떻게 다른지는 그 표 머리말에 적어 두었다.
 * 한 줄로 줄이면: 옛것은 **결재선을 안 짰을 때만** 쓰이고, 이쪽은 **결재선을 쓸 때**
 * 단계를 대신 누른다.
 *
 * ── 🔴 열쇠는 `users.id`(uuid) 다 ───────────────────────────────────────
 * 결재선 단계가 가리키는 것(`shipment_approval_route_steps.approver_user_id`)과
 * 같은 열쇠다. 재고관리(dss-inventory)의 같은 기능은 포털 번호(`sub`)로 도는데,
 * 그쪽은 남의 시스템 사람을 FK 없이 가리켜야 해서 그런 것이지 그 모양이 더 나아서가
 * 아니다. **여기에 포털 번호를 넘기면 이 함수들은 오류 없이 영원히 빈 답을 준다.**
 *
 * ── 🔴 방향이 둘이다. 어느 쪽을 묻는지 먼저 가려라 ──────────────────────
 * 「누를 수 있나」(인가)는 `actingApproverUserIds` **하나**가 정한다 — 두 벌로 적히지
 * 않게 하려는 것이고, 결재 mutation·목록·화면이 전부 그것을 쓴다(2026-10-26 연결 완료).
 * 그 반대 방향인 `actingDelegateUserIdsFor`(「나를 누가 대신하나」)는 **인가가 아니다.**
 * 결재가 생겼을 때 **알림을 받을 사람**을 넓히는 데만 쓴다. 두 함수는 같은 규칙을
 * 공유하지만 하는 일이 다르니, 고칠 때 어느 쪽 이야기인지 먼저 가릴 것.
 *
 * ── 🔴 2026-11-16 부터 위임을 맡기는 고지가 **둘**이다 ──────────────────
 * 이 표(A/S 제 것) 말고 **포털(dss-auth)에 맡긴 위임**이 생겼다(설계 B-1·B-4 —
 * dss-approvals/DELEGATION_DESIGN.md). 둘 다 인정하고 **합집합**으로 판정한다.
 *
 * 🔴 **포털 줄도 이 파일의 규칙으로 가린다.** 그날 저녁에 방식이 뒤집혀(설계 B-12),
 * 결재할 때마다 포털에 묻던 것이 **포털이 지정·철회할 때 각 시스템에 전파하는** 쪽으로
 * 바뀌었다. 그래서 포털 위임도 이제 **A/S 안의 표**(`portal_approval_delegations`)에
 * 줄로 앉아 있고, 칸 모양이 이 표와 같다(반열린 구간 · `revoked_at` 널이면 살아 있음).
 * 🔴 **그 표를 위해 판정을 한 벌 더 적지 마라** — `isActiveRouteDelegation` 하나가 두
 * 표의 줄을 똑같이 가린다. 두 벌이 되면 한쪽만 고쳐지는 날 「승인함에서는 끝난 위임인데
 * 여기서는 아직 듣는다」가 되고, 그 어긋남은 오류를 한 줄도 내지 않는다.
 *
 * 🔴 **합치는 자리는 방향마다 하나씩, 모두 둘이다**(2026-11-17). 「누를 수 있나」는
 * `actingApproverUserIds` 가, 「나를 누가 대신하나」는 `actingDelegateUserIdsFor` 가
 * 두 고지를 합친다. 🔵 뒤쪽은 2026-11-17 까지 **A/S 제 표만** 보고 있었다 — 그래서
 * 승인함에서 맡긴 위임의 대리인은 결재 단추도 눌리고 승인함에도 뜨는데 **생길 때
 * 나가는 메일만** 못 받았다(설계 D-8 ①). 방향 하나만 고지 둘을 보면 그렇게 된다.
 * 🔴 **두 고지를 갈아타며 두 겹이 되지 않게 막는 자리도 그 둘**이다 — 한쪽에만
 * 막음을 적으면 다른 방향으로 새는데, 새는 쪽은 아무 표시도 안 남긴다.
 * ============================================================================
 */

/**
 * 이 층이 위임 한 줄에서 보는 것. 표를 읽는 층이 돌려주는 줄이 이 모양을 이미
 * 만족하므로 그대로 넘기면 된다.
 *
 * 🔴 **도메인 층은 db 층을 가져오지 않는다.** 같은 모양을 여기 한 벌 적어 두는 것이
 * 이 저장소의 관례다(`shipment-approval-route.ts` 와 같은 자리). 두 벌이 갈라지지
 * 않는지는 `approval-route-delegations-safety.test.ts` 가 표의 칸 이름으로 맞대어 본다.
 *
 * 🔵 사유(`reason`)·만든 사람(`created_by_user_id`)은 여기 없다 — **판정에 쓰이지
 * 않기** 때문이다. 사람에게 보여 줄 값과 판정에 필요한 값을 한 타입에 섞으면,
 * 판정만 필요한 조회가 쓰지도 않을 칸을 함께 끌고 다니게 된다.
 */
export type ApprovalRouteDelegationPeriod = {
  /** 결재권을 맡긴 사람 — **결재선 단계에 적힌 사람**의 `users.id`. */
  delegatorUserId: string;
  /** 대신 눌러 줄 사람의 `users.id`. */
  delegateUserId: string;
  startsAt: Date;
  endsAt: Date;
  /**
   * 되돌렸으면 그 시각. 아직 살아 있으면 `null`. 🔴 줄을 지우는 길은 없다(표 쪽 주석).
   *
   * 🔴 **되돌린 사람(`revoked_by_user_id`)은 여기 없다.** 판정에 쓰이지 않기 때문이고,
   * 없어도 안전한 까닭은 **표가 두 칸을 짝으로 묶어 두기** 때문이다
   * (`approval_route_delegations_revocation_metadata` CHECK, 2026-10-26). 둘 중 하나만
   * 적힌 줄은 DB 가 아예 받아 주지 않으므로, 이 층은 시각 한 칸만 보고도 「되돌렸나」에
   * 틀리지 않게 답할 수 있다.
   */
  revokedAt: Date | null;
};

/**
 * 이 위임이 **지금 살아 있는가** — 되돌리지 않았고, 지금이 그 기간 안인가.
 *
 * ── 🔴 끝은 포함하지 않는다 (반열린 구간 `[starts_at, ends_at)`) ─────────
 * `starts_at <= now < ends_at` 이다. 끝을 포함하면 **한 위임이 끝나는 바로 그 순간에
 * 다음 위임이 시작할 때 둘 다 유효한 순간**이 생긴다. 그 1밀리초에 결재가 들어오면
 * 「누구의 권한으로 눌렀나」가 둘이 되고, 나중에 그 건을 설명할 수 없다. 기간을
 * 잇대어 적는 것은 사람이 실제로 하는 일이라(출장이 끝나는 날 다른 사람에게 다시
 * 맡긴다) 드문 경우도 아니다.
 *
 * 🔵 그래서 「9월 30일까지」를 적을 때 `ends_at` 은 **10월 1일 0시**다. 그 환산은
 * 2026-11-17 부터 이 파일 아래쪽의 `delegationPeriodFromDateOnly` 가 맡는다(화면은
 * 날짜 두 칸만 받는다). 이 함수는 여전히 **받은 시각을 그대로 믿는다.**
 *
 * 🔴 **되돌린 줄은 기간 안이어도 거짓이다.** 되돌리기가 기간을 줄여 적는 것이 아니라
 * 칸 하나에 시각을 적는 것이라서, 기간만 보면 되돌린 뒤에도 계속 참이 된다.
 *
 * ── 🔴 되돌림은 **한 칸만** 본다. 일부러 그렇게 둔다 ────────────────────
 * 표에는 되돌림 칸이 둘이지만(`revoked_at` · `revoked_by_user_id`) 여기서 보는 것은
 * 시각 하나다. 표의 `…_revocation_metadata` CHECK 가 **둘을 짝으로 묶어** 한쪽만 적힌
 * 줄을 아예 만들지 못하게 하므로, 한 칸으로 갈라도 답이 틀리지 않는다(2026-10-26
 * 사용자 승인). 두 칸을 다 보게 고치면 「둘이 어긋난 줄」이라는 **DB 가 만들 수 없는
 * 모양**을 읽는 쪽마다 다시 처리해야 하고, 그 가지는 영영 한 번도 안 돈다.
 * 🔵 그러니 CHECK 를 걷어내는 날이 오면 **이 함수부터 다시 보라.**
 */
export function isActiveRouteDelegation(
  delegation: ApprovalRouteDelegationPeriod,
  now: Date
): boolean {
  if (delegation.revokedAt !== null) return false;
  const at = now.getTime();
  return delegation.startsAt.getTime() <= at && at < delegation.endsAt.getTime();
}

/**
 * 이 사람이 **지금 누구를 대신할 수 있나** — 쓸 수 있는 결재권자들의 `users.id`.
 *
 * @param delegations 볼 위임 줄들. 순서가 뒤섞여 있어도 되고, 이 사람과 상관없는 줄이
 *   섞여 있어도 된다 — 걸러 내는 일을 부르는 쪽에 떠넘기지 않는다.
 * @param delegateUserId 「지금 누르려는 사람」의 `users.id`.
 * @param now 지금 시각.
 *
 * ── 🔴 이어 붙이지 않는다. 위임은 **한 겹**이다 ─────────────────────────
 * A→B 와 B→C 가 둘 다 살아 있어도 **C 는 A 의 결재권을 얻지 못한다.** 이 함수는 받은
 * 목록을 한 번 훑을 뿐, 자기가 돌려준 id 를 다시 `delegateUserId` 로 넣어 되풀이하지
 * 않는다.
 *
 * 까닭이 둘이다:
 *  1. **A 는 C 를 모른다.** A 가 맡긴 사람은 B 뿐인데, B 가 또 맡기는 순간 A 의
 *     결재권이 A 가 동의한 적 없는 사람에게 넘어간다. 결재는 「누가 승인했나」가 곧
 *     근거라, 그 근거가 무너진다.
 *  2. **고리가 생긴다.** A→B, B→A 가 함께 있으면 이어 붙이기는 끝나지 않는다. 깊이
 *     제한을 두는 길도 있지만, 그 숫자에 뜻을 붙일 방법이 없다(왜 2단계는 되고
 *     3단계는 안 되는가).
 *
 * 🔵 **한 사람이 둘 이상에게서 위임받는 것은 막지 않는다** — 두 사람이 동시에 자리를
 * 비울 수 있다. 그때는 결재권자 id 가 여럿 돌아오고, 그 사람은 그 여럿의 차례를 모두
 * 누를 수 있다.
 *
 * 🔵 같은 결재권자가 **겹치는 기간으로 여러 줄** 적혀 있어도 id 는 **한 번만**
 * 돌려준다(표가 겹침을 막지 않는다 — 표 쪽 주석). 부르는 쪽이 이 값을 「누구의 차례를
 * 볼까」의 조건으로 쓰므로, 겹친 채 넘기면 같은 건이 목록에 두 번 뜬다. 차례는
 * **목록에서 처음 나온 순서**다 — 값이 달라지지 않게 정해 둘 뿐, 뜻은 없다.
 */
export function delegatorUserIdsFor(
  delegations: readonly ApprovalRouteDelegationPeriod[],
  delegateUserId: string,
  now: Date
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const delegation of delegations) {
    if (delegation.delegateUserId !== delegateUserId) continue;
    if (!isActiveRouteDelegation(delegation, now)) continue;
    if (seen.has(delegation.delegatorUserId)) continue;
    seen.add(delegation.delegatorUserId);
    out.push(delegation.delegatorUserId);
  }
  return out;
}

/**
 * **한 고지 안에서** 이 결재권자를 대신할 수 있는 사람들. 🔴 위
 * `delegatorUserIdsFor` 의 **거울**이고(거르는 칸만 반대다), 둘 다 「살아 있나」를
 * `isActiveRouteDelegation` 하나에 맡긴다 — 규칙이 두 벌로 적히면 한쪽만 고쳐지는
 * 날이 온다.
 *
 * 🔵 **내보내지 않는다.** 바깥이 쓰는 것은 두 고지를 합치는 아래
 * `actingDelegateUserIdsFor` 뿐이어야 한다. 이것이 함께 보이면 「한 고지만 보는 답」을
 * 집어 가기 쉽고, 그렇게 고른 답은 **오류 없이 승인함 쪽 대리인만 빠진다**(2026-11-17
 * 에 실제로 그 모양이었다).
 */
function delegateUserIdsInOneSource(
  delegations: readonly ApprovalRouteDelegationPeriod[],
  delegatorUserId: string,
  now: Date
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const delegation of delegations) {
    if (delegation.delegatorUserId !== delegatorUserId) continue;
    if (!isActiveRouteDelegation(delegation, now)) continue;
    if (seen.has(delegation.delegateUserId)) continue;
    seen.add(delegation.delegateUserId);
    out.push(delegation.delegateUserId);
  }
  return out;
}

/**
 * 이 결재권자를 **지금 누가 대신할 수 있나** — 살아 있는 대리인들의 `users.id`.
 *
 * 🔴 **`delegatorUserIdsFor` 와 방향이 반대다.** 그쪽은 「내가 누구를 대신하나」
 * (대리인으로 좁혀 결재권자를 준다)이고, 이쪽은 「나를 누가 대신하나」(결재권자로
 * 좁혀 대리인을 준다)다. 같은 줄을 같은 규칙으로 읽지만 **거르는 칸이 반대**라,
 * 섞어 쓰면 오류 없이 빈 목록이 돌아온다 — 그래서 이름에 방향을 적어 둔다.
 *
 * 2026-10-26 에 더했다. 쓰는 자리는 **결재가 생겼을 때 나가는 즉시 알림**이다
 * (server/integration/approval-created-notice.ts). 그 전에는 단계에 적힌 한 사람에게만
 * 가서, **자리를 비운 사람이 메일을 받고 대신 눌러야 할 사람은 못 받았다.**
 *
 * 규칙 넷은 `delegatorUserIdsFor` 와 **글자 그대로 같다**: 되돌린 줄 제외 · 끝은
 * 포함하지 않음 · 중복 없음 · 이어 붙지 않음. 그래서 「살아 있나」는 베껴 적지 않고
 * `isActiveRouteDelegation` 하나에 맡기고, 여기서는 **방향만** 바꾼다.
 *
 * ── 🔴 고지가 **둘**이다. 합집합이고, 이어 붙지는 않는다 (2026-11-17) ────
 * 아래 `actingApproverUserIds`(정방향)가 2026-11-16 부터 두 고지를 합쳤는데, **이쪽은
 * 제 표만 보고 있었다.** 그래서 승인함에서 맡긴 위임의 대리인은 결재를 **누를 수는
 * 있는데**(정방향이 인정한다) **생길 때 나가는 메일만 못 받았다** — 화면에도 로그에도
 * 아무 표시가 안 남아, 그 사람이 말해 주기 전에는 드러나지 않는 종류의 구멍이다
 * (설계 D-8 ①).
 *
 * 🔴 **두 묶음을 각각 「한 겹」으로만 쓴다.** A/S 위임으로 A→B 이고 포털 위임으로
 * B→C 여도 **A 를 대신하는 사람에 C 는 없다** — 어느 쪽이 돌려준 id 도 다시
 * `delegatorUserId` 로 넣어 되풀이하지 않기 때문이다. 알림 쪽에서 이어 붙이면 더
 * 나쁘다: C 는 A 의 단계를 누를 수 없는데(정방향이 막는다) **A 에게 결재 차례가 왔다는
 * 사실만 먼저 알게 된다.** 자격은 없고 알림만 가는 꼴이다.
 *
 * 🔵 차례에는 뜻이 없다 — A/S 위임이 먼저, 포털 위임이 그다음이고, 겹치면 **먼저 나온
 *    쪽 한 번만** 남는다(정방향의 합치기와 같은 자). 한 사람이 두 표 양쪽에 대리인으로
 *    적혀 있는 일은 실제로 생기고, 그때 메일이 두 통 가면 안 된다.
 *
 * ── 🔴 결재권자 본인은 **여기 넣지 않는다** ─────────────────────────────
 * 아래 `actingApproverUserIds` 가 본인을 맨 앞에 끼워 주는 것과 일부러 다르다. 그쪽은
 * 돌려준 값이 그대로 `inArray` 에 들어가서 비면 안 되는 목록이고, 이쪽은 **「대리인이
 * 있나」를 묻는 값**이다. 부르는 쪽은 결재권자 본인을 이미 손에 들고 있으므로 여기서
 * 한 번 더 주면 그 쪽이 중복을 걷어 내야 한다.
 *
 * 🔴 **빈 목록이 정상이고, 그 뜻은 「지금 대신할 사람이 없다」다.** 그래서 아래 타입
 * (`ActingApproverUserIds`)을 쓰지 않고 그냥 `string[]` 이다.
 *
 * @param portalDelegations 🔴 **선택 인자가 아니다.** 정방향과 같은 까닭이다 —
 *   기본값을 두면 빠뜨린 자리에서만 포털 위임이 조용히 안 걸리고, 그것이 2026-11-17
 *   까지 이 함수에 실제로 있던 구멍이다. 포털 위임을 볼 까닭이 없는 자리는 **빈 묶음을
 *   글자로 넘겨** 그 뜻을 드러낸다.
 */
export function actingDelegateUserIdsFor(
  delegations: readonly ApprovalRouteDelegationPeriod[],
  delegatorUserId: string,
  now: Date,
  portalDelegations: readonly ApprovalRouteDelegationPeriod[]
): string[] {
  return [
    ...new Set([
      ...delegateUserIdsInOneSource(delegations, delegatorUserId, now),
      ...delegateUserIdsInOneSource(portalDelegations, delegatorUserId, now),
    ]),
  ];
}

/**
 * 「지금 이 사람의 자격으로 누를 수 있는 결재자 id」 전부.
 *
 * 🔴 **빈 적이 없다** — 맨 앞은 언제나 본인이다. 그래서 타입이 **빈 목록을 허락하지
 * 않는 꼴**(`[string, ...string[]]`)이다. 빈 목록이 나올 수 있으면 DB 쪽에서
 * `inArray(…, [])` 가 되고, drizzle 은 그것을 `false` 로 굽는다 — **아무도 아무것도 못
 * 누르는데 오류는 나지 않는** 자리가 된다.
 */
export type ActingApproverUserIds = readonly [string, ...string[]];

/**
 * 🔴 **「누를 수 있나」가 두 벌로 적히는 것을 막는 자리다.**
 *
 * 다음 조각에서 이 판정이 필요한 곳은 적어도 셋이다 — 집행(결재 mutation 의 조건절) ·
 * 「내가 결재할 건」 목록 · 알림. 앞 둘은 SQL 이고 나머지는 TS 라 **같은 코드를 쓸 수
 * 없다.** 그래서 둘이 보는 **id 목록을 이 함수 하나가 만든다**: DB 쪽은 이 목록을
 * `inArray` 에 그대로 넣고, 순수 쪽은 「이 목록에 들어 있나」를 본다.
 *
 * 규칙을 두 벌 적으면 「목록에는 뜨는데 눌리지 않는」(또는 그 반대의) 짝이 생기고, 그
 * 어긋남은 오류가 아니라 **사람이 포기할 때까지 조용하다.**
 *
 * ── 🔴 위임은 **넘기는 것이 아니라 늘리는 것**이다 ──────────────────────
 * 본인 id 가 언제나 맨 앞에 남는다. 자리를 비우며 맡겨 둔 사람이 중간에 들어와 직접
 * 눌러도 막히지 않는다 — 막으면 「맡겼더니 내가 못 누른다」가 되고, 그것은 아무도
 * 바란 적 없는 일이다.
 *
 * ── 🔴 늘어나는 것은 **대리인 자격뿐**이다 ──────────────────────────────
 * 이 목록에 들어오는 id 는 **지금 살아 있는 위임의 결재권자**뿐이다
 * (`delegatorUserIdsFor`). 관리자라고 남의 id 가 여기 들어오지 않고, 그래서 「관리자라고
 * 남의 단계를 대신 누를 수 없다」는 울타리가 그대로 선다. 두 겹(A→B·B→C)이 안 이어지는
 * 것도 그 함수가 지킨다.
 *
 * ── 🔴 고지가 **둘**이다. 합집합이고, 이어 붙지는 않는다 (2026-11-16) ────
 * 2026-11-13 결정(설계 B-4)으로 **포털에 맡긴 위임과 A/S 제 표의 위임을 둘 다 살려
 * 두기로** 했다. 그래서 이 함수는 **줄 묶음 둘**을 받아 **합집합**을 만든다:
 *  · `delegations` — A/S 의 `approval_route_delegations` 를 읽은 줄들.
 *  · `portalDelegations` — 승인함에서 맡겨 **포털이 전파해 준** 줄들
 *    (`portal_approval_delegations`, 설계 B-12). 열쇠는 받는 통로가 이미 A/S
 *    `users.id` 로 바꿔 두었다.
 *
 * 🔴 **둘을 같은 규칙으로 가린다**(`delegatorUserIdsFor` → `isActiveRouteDelegation`).
 * 한때는 포털 쪽만 기간·되돌림 판정이 **포털에서 끝나** 결재권자 목록만 넘어왔는데,
 * 2026-11-16 저녁에 묻는 방식이 전파 방식으로 뒤집히면서(B-12) 그 줄도 이 집의 표에
 * 앉았다. 🔴 **그 표를 위해 「살아 있나」를 한 벌 더 적지 마라** — 두 벌이 갈리면
 * 한쪽 표의 위임만 끝난 뒤에도 계속 듣는다.
 *
 * 🔴 **둘을 이어 붙이지 않는다.** A/S 위임으로 A→B 이고 포털 위임으로 B→C 여도
 * **C 는 A 를 얻지 못한다.** 두 묶음을 각각 **「한 겹」으로만** 쓰고, 어느 쪽이
 * 돌려준 id 도 다시 `delegateUserId` 로 넣어 되풀이하지 않기 때문이다 — 까닭은 바로
 * 위 `delegatorUserIdsFor` 의 둘(A 는 C 를 모른다 · 고리가 생긴다)과 같다. 고지가
 * 둘이 되면서 **한 고지 안에서는 막히던 두 겹이 고지를 갈아타며 생길** 수 있게
 * 됐으므로, 여기가 그것을 막는 유일한 자리다.
 *
 * 🔵 차례에는 뜻이 없다 — 본인이 맨 앞인 것만 정해 두고(값이 달라지지 않게), 그다음이
 *    A/S 위임, 그다음이 포털 위임이다. 겹치면 **먼저 나온 쪽 한 번만** 남는다.
 *
 * @param actorUserId 「지금 누르려는 사람」의 `users.id`. 🔴 포털 번호(`sub`)를 넘기면
 *   위임은 하나도 안 붙고 **그 틀린 값 하나짜리 목록**이 돌아간다 — 오류 없이 영원히
 *   0건이 된다.
 * @param portalDelegations 🔴 **선택 인자가 아니다.** 기본값을 두면 빠뜨린 자리에서만
 *   포털 위임이 조용히 안 걸린다 — 오류가 나지 않고 「어떤 결재에서만 대리 결재가 안
 *   된다」가 되며, 그 화면에는 아무 표시도 남지 않는다(같은 까닭으로
 *   auth/approval-assignment.ts 의 `mayDecideAssignedApproval` 도 필수로 받는다).
 *   포털 위임을 볼 까닭이 없는 자리는 **빈 묶음을 글자로 넘겨** 그 뜻을 드러낸다.
 */
export function actingApproverUserIds(
  delegations: readonly ApprovalRouteDelegationPeriod[],
  actorUserId: string,
  now: Date,
  portalDelegations: readonly ApprovalRouteDelegationPeriod[]
): ActingApproverUserIds {
  const merged = new Set<string>([
    ...delegatorUserIdsFor(delegations, actorUserId, now),
    ...delegatorUserIdsFor(portalDelegations, actorUserId, now),
  ]);
  // 🔴 본인은 맨 앞에 이미 있다 — 여기 남겨 두면 목록에 두 번 들어간다. 두 표의
  //    CHECK(`delegate <> delegator`)가 「자기가 자기를 대신하는」 줄을 못 만들게
  //    막고 있지만, 그 제약이 걷히는 날 이 함수가 틀리지 않게 한 줄로 끊어 둔다.
  merged.delete(actorUserId);
  return [actorUserId, ...merged];
}

/* ------------------------------------------------------------------ */
/* 화면에 보여 줄 상태 — 저장하지 않고 읽을 때 계산한다                 */
/* ------------------------------------------------------------------ */

/**
 * 🔴 **낱말을 옛 위임 화면과 맞춘다.** 그래서 새 이름을 짓지 않고 옆 파일의 타입을
 * 그대로 끌어와 별명만 붙인다(`shipment-delegation-status.ts`). 두 화면이 같은 것을
 * 다른 말로 부르면 쓰는 사람이 헷갈리고, 낱말을 각자 적어 두면 한쪽만 늘어나는 날이
 * 온다 — 여기서는 타입이 하나라 그 날이 오지 않는다. 한국어 딱지(활성·예정·만료·
 * 철회됨)는 지금 `components/users/DelegationSection.tsx` 가 들고 있다.
 */
export type ApprovalRouteDelegationDisplayStatus = ShipmentDelegationDisplayStatus;

/**
 * 네 갈래가 **정말 넷인지**를 타입으로 못 박는 자리. 옆 파일의 타입에 값이 하나
 * 늘어나면 이 객체에 키가 빠져 `tsc` 가 멈춘다 — 배열로만 적어 두면 그때 아무 일도
 * 일어나지 않고, 새 값이 화면에서만 빠진 채로 남는다.
 */
const DISPLAY_STATUS_KEYS: Record<ApprovalRouteDelegationDisplayStatus, true> = {
  ACTIVE: true,
  SCHEDULED: true,
  EXPIRED: true,
  REVOKED: true,
};

/** 화면이 딱지·정렬을 만들 때 쓰는 전부. 위 객체의 키 순서 그대로다. */
export const APPROVAL_ROUTE_DELEGATION_DISPLAY_STATUSES = Object.keys(
  DISPLAY_STATUS_KEYS
) as ApprovalRouteDelegationDisplayStatus[];

/**
 * 이 줄을 사람에게 뭐라고 보여 줄까.
 *
 * 🔴 **저장하지 않는다.** 「만료」는 시간이 지나면 저절로 되는 것이라 칸에 적어 두면
 * 언젠가 낡는다(표 쪽 주석). 되돌림만 표에 남고, 나머지 셋은 언제나 여기서 계산한다.
 *
 * ── 🔴 옛 함수와 **경계가 다르다. 베껴 오지 마라** ──────────────────────
 * `deriveDelegationDisplayStatus`(출하 대표 위임)는 `nowMs > ends` 일 때 만료로 본다 —
 * 끝나는 **그 순간**은 아직 활성이라는 뜻이다. 이 표는 반열린 구간이라 그 순간이 이미
 * 죽은 것이고, 그래서 여기는 `>=` 다. 글자 하나 차이지만 옛 쪽을 그대로 베끼면 화면은
 * 「활성」이라 적어 놓고 `isActiveRouteDelegation` 은 거짓을 주는, **설명할 수 없는 한
 * 순간**이 생긴다. 두 함수가 어긋나지 않는 것은 시험이 지킨다.
 *
 * 🔵 옛 함수가 `startsAt: string` 을 받는 것과 달리 여기는 `Date` 다 — 이 층을 부르는
 * 첫 자리가 다음 조각의 **서버 판정**이고, 거기서 `Date` 를 글자로 바꿨다가 다시
 * 읽는 왕복은 틀릴 거리만 늘린다. 화면은 받은 줄의 `Date` 를 그대로 넘기면 된다.
 */
export function deriveApprovalRouteDelegationDisplayStatus(
  delegation: Pick<ApprovalRouteDelegationPeriod, "startsAt" | "endsAt" | "revokedAt">,
  now: Date
): ApprovalRouteDelegationDisplayStatus {
  if (delegation.revokedAt !== null) return "REVOKED";
  const at = now.getTime();
  if (at < delegation.startsAt.getTime()) return "SCHEDULED";
  if (at >= delegation.endsAt.getTime()) return "EXPIRED";
  return "ACTIVE";
}

/* ------------------------------------------------------------------ */
/* 기간 — 사람은 **날짜**로 적고, 표에는 **시각**으로 앉는다            */
/* ------------------------------------------------------------------ */

/**
 * ============================================================================
 * 날짜 두 칸 ↔ 시각 두 칸 (2026-11-17 사용자 요구)
 * ============================================================================
 * 「결재권을 위임할 때 **시간까지** 적도록 되어 있는데, **날짜까지만** 적도록 해라
 * (끝나는 날 24:00 까지로)」.
 *
 * 🔴 **표는 그대로다.** `starts_at` · `ends_at` 은 여전히 timestamptz 이고, 바뀐 것은
 * **화면이 거기 무엇을 굽느냐**뿐이다. 마이그레이션이 없는 것은 그래서다.
 *
 * 🔴 **「끝나는 날 24:00」은 그 날을 포함한다 = 다음 날 00:00 이다.** 이 표가 반열린
 * 구간(`[starts_at, ends_at)`)이기 때문이고(위 `isActiveRouteDelegation` 머리말),
 * 그래야 「11월 18일까지」가 18일 하루를 **온전히** 포함한다. 끝을 18일 00:00 으로
 * 구우면 18일은 단 한순간도 안 들어가고, 적은 사람은 그날 하루를 맡겼다고 믿는다.
 *
 * 🔴 **한국시간 자정이다.** `new Date("2026-11-18")` 은 UTC 자정이라 한국에서는 그날
 * 아침 9시다 — 그렇게 구우면 기간이 하루 중 아홉 시간만큼 어긋나고, 그 어긋남은
 * 00:00~09:00 에만 드러나서 낮에 눌러 보면 내내 멀쩡해 보인다. 그래서 환산을 여기서
 * 적지 않고 `domain/date-only.ts` 의 한국시간 함수들에 맡긴다.
 *
 * 🔴 **굽는 쪽과 읽는 쪽이 한 쌍으로 여기 있다**(`…FromDateOnly` · `…DateText`).
 * 한쪽이 하루를 더하고 다른 쪽이 하루를 빼므로, 둘이 갈리면 화면에 적히는 날짜가
 * 저장된 기간과 하루씩 어긋난다 — 오류는 한 줄도 안 난다. 나누어 두면 고치는 사람이
 * 한쪽만 찾는다.
 * ============================================================================
 */

/** 구워진 기간. 서버 액션이 ISO 글자로 받아 가므로 `Date` 그대로 돌려준다. */
export type ApprovalRouteDelegationPeriodInstants = {
  startsAt: Date;
  endsAt: Date;
};

/**
 * 「시작일」·「종료일」(둘 다 "YYYY-MM-DD", 한국시간 달력 날짜) → 표에 앉힐 시각 둘.
 *
 * · 시작 = 그 날 **한국시간 00:00**
 * · 끝   = **종료일 다음 날 한국시간 00:00** (= 종료일 당일 24:00)
 *
 * 🔵 **같은 날 둘을 고르면 그 하루다** — 시작 18일 00:00, 끝 19일 00:00. 반열린
 * 구간이라 18일 23:59:59 까지 살아 있고 19일 00:00 에 딱 끝난다.
 *
 * 🔵 하루 더하는 일은 `addCalendarDays` 에 맡긴다. 밀리초를 더하면 맞지만, 달·해
 * 넘김(11월 30일 → 12월 1일, 12월 31일 → 1월 1일)을 이 파일이 또 알아야 한다.
 *
 * 🔵 「거꾸로인 기간」은 **여기서 막지 않는다.** 막는 자리는 서버 하나뿐이어야 한다
 * (validation/approval-route-delegation-input.ts 의 `validateDelegationPeriod` ·
 * 표의 `…_valid_range` CHECK). 여기서 한 벌 더 보면 같은 규칙이 두 곳에 적히고,
 * 화면에서만 거절되는 값이 생기면 그 까닭이 어디에도 안 남는다.
 */
export function delegationPeriodFromDateOnly(
  startDateOnly: string,
  endDateOnly: string
): ApprovalRouteDelegationPeriodInstants {
  return {
    startsAt: kstMidnightInstant(startDateOnly),
    endsAt: kstMidnightInstant(addCalendarDays(endDateOnly, 1)),
  };
}

/**
 * 이 줄의 기간을 **날짜만으로** 적을 수 있으면 그 글자, 아니면 `null`.
 *
 * ── 🔴 왜 `null` 갈래가 필요한가 ────────────────────────────────────────
 * 날짜 입력으로 바뀌기 **전에 만들어진 줄**에는 `21:25` 같은 어중간한 끝 시각이 들어
 * 있다. 그런 줄을 날짜만으로 적으면 **화면이 거짓말을 한다** — 「11월 18일까지」라고
 * 적어 두고 실제로는 그날 21:25 에 끊긴다. 되돌릴 수 없는 어긋남이라(줄을 고치는 길도
 * 지우는 길도 없다) 그런 줄은 **저장된 시각 그대로** 보여 주는 쪽을 골랐다.
 *
 * 🔴 **옛 줄만의 이야기가 아니다.** 통합 승인함에서 전파돼 오는 줄
 * (`portal_approval_delegations`)은 저쪽 화면이 정한 시각으로 들어오므로 **앞으로도**
 * 자정이 아닐 수 있다. 같은 화면이 두 표를 함께 그리니(ApprovalRouteDelegationSection)
 * 이 갈래는 영영 살아 있는 갈래다.
 *
 * ── 🔵 왜 글자가 아니라 `null` 을 돌려주는가 ────────────────────────────
 * 시각까지 적는 글자는 `toLocaleString("ko-KR")` 로 **보는 사람의 시간대**에서 그린다
 * (화면이 하던 그대로다). 그 글자를 여기서 만들면 이 순수 층이 실행 환경의 시간대에
 * 따라 다른 답을 주게 되고, 시험이 도는 기계마다 결과가 갈린다. 그래서 **날짜로 적을
 * 수 있는 줄만** 여기서 글자를 만들고, 나머지는 화면에 돌려보낸다.
 *
 * ── 🔴 끝은 **하루를 빼서** 적는다 ──────────────────────────────────────
 * 저장된 `endsAt` 은 포함하지 않는 경계(종료일 **다음 날** 00:00)다. 그대로 적으면
 * 사람이 고른 날짜보다 하루 뒤가 화면에 뜬다 — 고른 값과 보이는 값이 어긋나면 다음에
 * 고칠 때 또 하루가 밀린다. 그래서 `delegationPeriodFromDateOnly` 가 더한 하루를
 * 여기서 정확히 되돌린다.
 */
export function delegationPeriodDateText(
  period: Pick<ApprovalRouteDelegationPeriod, "startsAt" | "endsAt">
): string | null {
  if (!isKstMidnight(period.startsAt) || !isKstMidnight(period.endsAt)) return null;
  const lastDay = addCalendarDays(toKstDateOnly(period.endsAt), -1);
  return `${toKstDateOnly(period.startsAt)} ~ ${lastDay}`;
}
