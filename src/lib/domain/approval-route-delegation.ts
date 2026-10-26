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
 * 🔵 이 조각은 **표와 판정까지**다. 실제 결재 판정·화면 연결은 다음 조각이고, 그때
 * 쓰는 자리는 아래 `actingApproverUserIds` 하나다 — 「누를 수 있나」가 두 벌로
 * 적히지 않게 하려는 것이다.
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
 * 🔵 그래서 「9월 30일까지」를 적을 때 `ends_at` 은 **10월 1일 0시**다. 화면이 그
 * 환산을 맡는 것은 다음 조각의 일이고, 이 층은 받은 시각을 그대로 믿는다.
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
 * 🔵 차례에는 뜻이 없다 — 본인이 맨 앞인 것만 정해 두고(값이 달라지지 않게), 나머지는
 *    `delegatorUserIdsFor` 가 준 차례 그대로다.
 *
 * @param actorUserId 「지금 누르려는 사람」의 `users.id`. 🔴 포털 번호(`sub`)를 넘기면
 *   위임은 하나도 안 붙고 **그 틀린 값 하나짜리 목록**이 돌아간다 — 오류 없이 영원히
 *   0건이 된다.
 */
export function actingApproverUserIds(
  delegations: readonly ApprovalRouteDelegationPeriod[],
  actorUserId: string,
  now: Date
): ActingApproverUserIds {
  return [actorUserId, ...delegatorUserIdsFor(delegations, actorUserId, now)];
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
