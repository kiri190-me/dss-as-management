import "server-only";
import { and, asc, desc, eq, gt, isNotNull, isNull, lte, or } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "../client";
import { portalApprovalDelegations, users } from "../schema";
import { FINISHED_DELEGATION_LIMIT } from "./approval-route-delegations";

/**
 * ============================================================================
 * 통합 승인함에서 맡긴 결재권 위임 읽기 — **화면에 보여 줄 값**과 **점검이 맞댈 값**
 * ============================================================================
 * 🔴 **이 파일의 조회는 쓰임이 둘이고 섞으면 안 된다**(아래 각 절의 머리말):
 *  · `listPortalApprovalDelegationsForUser` — **화면**이 읽는 쪽. 보는 사람의 줄만,
 *    사람 이름을 실어서, 「살아 있다/끝났다」로 나눠 준다.
 *  · 🔴 `listPortalApprovalDelegationsForAudit` — 포털의 **어긋남 점검**이 읽는 쪽
 *    (2026-11-17, 조각 9a · 설계 B-14). **거르개가 하나도 없고** 사람 칸을 **한 개도
 *    안 고른다.**
 *
 * 표는 `portal_approval_delegations` 다. 🔴 **옆의 `approval_route_delegations`
 * (A/S 화면에서 사람이 맡기는 위임)와 다른 표**이고, 이 파일은 그 표를 읽지
 * 않는다 — 둘이 어떻게 갈리는지는 표 머리말의 비교표에 있다(설계 B-4: 둘 다
 * 살려 둔다).
 *
 * ── 왜 이 조회가 따로 필요한가 (2026-11-17) ──────────────────────────────
 * 판정은 2026-11-16 에 이미 두 표를 함께 읽게 됐다
 * (queries/approval-route-delegations.ts 의 `resolveActingApproverUserIds`) —
 * 승인함에서 맡긴 위임으로 **결재 단추를 실제로 누를 수 있다.** 🔴 그런데
 * **[결재권 위임] 화면은 A/S 자신의 표만 그렸다.** 그래서 사용자가 승인함에서
 * 위임을 맡기고 A/S 를 열면 「위임되었다는 내용이 안 뜬다」가 됐다 — 줄은
 * 전파돼 살아 있고 판정도 듣는데, **보여 주는 코드가 없었다.**
 *
 * ── 🔴 읽기 전용이다. 이 표에 쓰는 자리는 통로 하나뿐 ────────────────────
 * 되돌리기는 **통합 승인함에서만** 한다(표 머리말 · 설계 B-12 의 3번). 여기서
 * `revoked_at` 을 적으면 포털은 모르므로 다음 전파 한 번에 되살아나고, 사람은
 * **거뒀다고 믿는데 안 거둬진** 상태가 된다. 그래서 이 파일에는 조회만 있고,
 * 화면도 [되돌리기]를 그리지 않는다.
 *
 * ── 🔴 인가를 보지 않는다. 보는 사람의 줄만 내준다 ───────────────────────
 * 옆 표의 `listAllApprovalRouteDelegations` 는 **남의 줄**을 내주므로 제 손으로
 * 권한을 묻는데, 이 조회가 내주는 것은 **부른 사람이 맡겼거나 맡은 줄**뿐이라
 * 물을 것이 없다(옆 표의 `listApprovalRouteDelegationsForUser` 와 같은 자리,
 * 같은 판단). 🔴 그래서 `userId` 에 **반드시 보는 사람의 `users.id`** 를 넘겨라 —
 * 포털 번호(sub)를 넘기면 오류 없이 영원히 0건이 된다.
 * ============================================================================
 */

const delegator = alias(users, "portal_delegation_delegator");
const delegate = alias(users, "portal_delegation_delegate");

/**
 * 화면이 한 줄을 그리는 데 필요한 전부.
 *
 * 🔴 시각을 ISO 글자로 바꾸지 않고 **`Date` 그대로** 내보낸다 — 상태 딱지를
 * 가리는 도메인 함수가 `Date` 를 받고, 이 줄도 **옆 표의 줄과 같은 함수**로
 * 딱지를 받는다(`deriveApprovalRouteDelegationDisplayStatus`). 두 출처의 줄이
 * 한 화면에 나란히 서는데 딱지를 가리는 자가 갈리면, 같은 날짜가 묶음마다
 * 다른 상태로 보인다.
 *
 * 🔴 **`createdByUserId`·`revokedByUserId` 짝이 없다. 빠뜨린 것이 아니다** —
 * 이 표에 그 칸이 **없다**(표 머리말: 누가 지정하고 누가 거뒀는지는 포털이
 * 쥐고 있고, 그 사람은 A/S 계정이 아예 없을 수도 있다). 그래서 화면도 「지정자」
 * 칸을 그리지 않는다. 빈 칸을 만들어 두면 「비어 있다」가 「본인이 했다」로
 * 읽히는 날이 온다.
 */
export type PortalApprovalDelegationRow = {
  /** 🔴 **포털이 정한 번호**다. 되돌리기도 어긋남 점검도 이 값으로 맞댄다. */
  id: string;
  delegatorUserId: string;
  delegatorName: string;
  delegateUserId: string;
  delegateName: string;
  startsAt: Date;
  /** 🔴 이 순간은 포함하지 않는다(반열린 구간). 표 쪽 주석 참조. */
  endsAt: Date;
  /** 포털에서 안 적었으면 **빈 글자**가 온다 — 널이 아니다. */
  reason: string;
  /** 승인함에서 거뒀으면 그 시각. 아직 살아 있으면 null. */
  revokedAt: Date | null;
};

/**
 * 한 줄을 그리는 데 필요한 칸·조인을 **한 곳에서만** 적는다. 아래 두 질의가 같은
 * 모양을 돌려주어야 화면이 같은 부품으로 그릴 수 있는데, 칸 목록을 두 벌 적어
 * 두면 한쪽에만 칸이 늘어나는 날이 오고 그때 `tsc` 는 아무 말도 하지 않는다.
 *
 * `.where()` 와 `.orderBy()` 는 부르는 쪽이 붙인다.
 */
function portalDelegationRowsBase() {
  return db
    .select({
      id: portalApprovalDelegations.id,
      delegatorUserId: portalApprovalDelegations.delegatorUserId,
      delegatorName: delegator.name,
      delegateUserId: portalApprovalDelegations.delegateUserId,
      delegateName: delegate.name,
      startsAt: portalApprovalDelegations.startsAt,
      endsAt: portalApprovalDelegations.endsAt,
      reason: portalApprovalDelegations.reason,
      revokedAt: portalApprovalDelegations.revokedAt,
    })
    .from(portalApprovalDelegations)
    // 두 사람 참조가 둘 다 RESTRICT 이고 이 저장소의 사용자는 소프트삭제만
    // 하므로, 참조된 users 행은 언제나 실재한다 — innerJoin 이어도 줄을 잃지
    // 않는다(옆 표의 같은 자리와 같은 근거).
    .innerJoin(delegator, eq(portalApprovalDelegations.delegatorUserId, delegator.id))
    .innerJoin(delegate, eq(portalApprovalDelegations.delegateUserId, delegate.id));
}

export type PortalApprovalDelegationsView = {
  /**
   * 내가 맡긴 것 — 승인함에서 **내 결재권**을 남에게 맡겨 둔 줄.
   * 🔴 **살아 있는 줄만** 들어 있다(아직 안 거뒀고 아직 안 끝난 것). 끝난 줄은
   * 방향을 가리지 않고 아래 `finished` 한 곳에 모인다.
   */
  given: PortalApprovalDelegationRow[];
  /**
   * 내가 대신하고 있는 것 — 승인함에서 **남이 나에게** 맡긴 줄. 위와 같이
   * **살아 있는 줄만**이다.
   *
   * 🔵 위 `given` 과 **같은 줄이 양쪽에 들어가는 일은 없다** — 그러려면 맡긴
   * 사람과 맡은 사람이 같아야 하는데 표의 `…_different_users` CHECK 가 막는다.
   */
  received: PortalApprovalDelegationRow[];
  /**
   * 거뒀거나 기간이 끝난 줄 — **두 방향을 한 목록에** 담는다. 최근 것부터
   * `FINISHED_DELEGATION_LIMIT` 건까지.
   *
   * 🔵 방향으로 더 쪼개지 않는 까닭: 끝난 줄에는 **할 수 있는 일이 없고**
   * (여기서도 승인함에서도 다시 손댈 것이 없다) 화면이 결재권자와 대리 결재자를
   * 두 칸으로 나란히 보여 주므로 방향은 줄만 봐도 읽힌다. 「모두의 결재권 위임」의
   * 끝난 목록이 같은 모양이다. 쪼개면 상한이 목록마다 따로 걸려 「최근 N건」의
   * 뜻이 묶음마다 달라진다.
   */
  finished: PortalApprovalDelegationRow[];
  /** 끝난 줄이 상한보다 많았다. 화면이 「최근 N건만 보여 준다」를 말해 줘야 한다. */
  finishedTruncated: boolean;
  /** 화면이 「최근 N건」의 N 을 글자로 박지 않게 함께 내보낸다. */
  finishedLimit: number;
};

/**
 * 보는 사람이 승인함에서 맡겼거나 맡은 위임 — **두 방향 다**.
 *
 * ── 🔴 「끝났다」의 자가 옆 표와 **글자 그대로 같다** ─────────────────────
 * `revoked_at IS NOT NULL OR ends_at <= now` 이고, 상한도 같은 상수를
 * **빌려 쓴다**(`FINISHED_DELEGATION_LIMIT` — 그래서 `export` 가 붙었다).
 * 두 출처의 줄이 한 화면에 나란히 서는데 자가 갈리면, 같은 날짜의 두 줄이
 * 한쪽 묶음에서는 「만료」로 접히고 다른 쪽에서는 「활성」으로 펴진다. 숫자를
 * 여기 다시 적지 않는 것도 같은 까닭이다 — 한쪽만 고쳐지는 날이 온다.
 *
 * 🔵 상한이 필요한 쪽이 끝난 줄뿐인 것도 같다. 살아 있는 줄은 「지금 자리를
 * 비운 사람 수」라 본질적으로 작고, 상한에 밀려 안 보이는 것이 가장 나쁘다.
 * 끝난 줄은 지우는 길이 없어 해가 갈수록 쌓이기만 한다.
 *
 * ── 왜 두 질의이고 왜 겹치지 않는가 ─────────────────────────────────────
 * 상한이 필요한 쪽이 한쪽뿐이라 한 질의로는 표현되지 않는다. 두 질의의 조건은
 * **서로 정확한 여집합**이고, 🔴 **「지금」을 TS 에서 한 번 만들어 둘 다에 같은
 * 값으로 넘긴다** — 각자 `now()` 를 쓰면 두 질의 사이에 끝난 줄이 양쪽에서
 * 빠지거나 양쪽에 들어간다.
 *
 * 🔵 방향으로 나누는 것은 **받아 온 뒤 TS 에서** 한다. 한 사람에게 걸린 줄은
 * 많아야 몇 줄이라 질의를 둘로 더 쪼갤 값어치가 없고, 쪼개면 네 질의의 「지금」이
 * 또 갈린다. 🔵 한 줄이 양쪽에 동시에 들어가는 일은 없다 — 그러려면 맡긴 사람과
 * 맡은 사람이 같아야 하는데 표의 `…_different_users` CHECK 가 그런 줄을 막는다.
 *
 * ── 🔴 차례를 `synced_at` 으로 세우지 않는다 ─────────────────────────────
 * 이 표에는 **`created_at` 이 없다**(표 머리말 — 줄이 「받아 적은 사본」이라
 * 처음 만들어진 때는 포털 줄이 쥐고 있다). 남은 후보가 `synced_at` 인데 그 값은
 * **거둘 때도 새로 찍힌다** — 그것으로 세우면 거둔 줄이 목록 맨 위로 올라와,
 * 위임 자체와 아무 상관 없는 까닭으로 차례가 뒤바뀐다. 그래서 `starts_at` 내림차
 * 순으로 세우고, 같은 시각이 둘일 때를 위해 `id` 를 덧붙인다(상한에 자르려면
 * 차례가 결정적이어야 한다 — 안 그러면 새로고침마다 잘리는 줄이 달라진다).
 */
export async function listPortalApprovalDelegationsForUser(
  userId: string,
  now: Date = new Date()
): Promise<PortalApprovalDelegationsView> {
  const mine = or(
    eq(portalApprovalDelegations.delegatorUserId, userId),
    eq(portalApprovalDelegations.delegateUserId, userId)
  );
  const isLive = and(
    isNull(portalApprovalDelegations.revokedAt),
    gt(portalApprovalDelegations.endsAt, now)
  );
  // 위의 정확한 여집합: 거뒀거나(기간과 무관하다) 기간이 끝났거나.
  const isFinished = or(
    isNotNull(portalApprovalDelegations.revokedAt),
    lte(portalApprovalDelegations.endsAt, now)
  );

  const [live, finishedPage] = await Promise.all([
    portalDelegationRowsBase()
      .where(and(mine, isLive))
      .orderBy(desc(portalApprovalDelegations.startsAt), desc(portalApprovalDelegations.id)),
    portalDelegationRowsBase()
      .where(and(mine, isFinished))
      .orderBy(desc(portalApprovalDelegations.startsAt), desc(portalApprovalDelegations.id))
      // 🔵 한 건 더 받아 「더 있다」를 센다. 따로 COUNT 를 던지면 그 사이에 줄이
      // 늘어 「더 있다는데 다 보인다」가 될 수 있고, 질의가 하나 더 는다.
      .limit(FINISHED_DELEGATION_LIMIT + 1),
  ]);

  const finishedTruncated = finishedPage.length > FINISHED_DELEGATION_LIMIT;

  return {
    // 🔵 방향 나누기는 **살아 있는 줄에만** 쓴다. 끝난 줄은 한 목록으로 둔다(타입 주석).
    given: live.filter((row) => row.delegatorUserId === userId),
    received: live.filter((row) => row.delegateUserId === userId),
    finished: finishedTruncated
      ? finishedPage.slice(0, FINISHED_DELEGATION_LIMIT)
      : finishedPage,
    finishedTruncated,
    finishedLimit: FINISHED_DELEGATION_LIMIT,
  };
}

/* ------------------------------------------------------------------ */
/* 🔴 포털의 어긋남 점검이 읽는다 — **거르개가 없는** 자리 (조각 9a)      */
/* ------------------------------------------------------------------ */

/**
 * 점검이 보는 줄. 🔴 **사람 칸이 없다.** 표에서 고르는 칸도 이것뿐이어야 한다 — 고른
 * 뒤에 안 싣는 것이 아니라 **애초에 안 읽는다**(내주는 모양은
 * server/integration/portal-delegation-list.ts 가 쥔다 — 두 겹으로 막아 둔 것은, 한 겹만
 * 있으면 다음 사람이 「조회는 다 읽어 두고 고를 때 가리자」로 쉽게 무너뜨리기 때문이다).
 */
export type PortalApprovalDelegationAuditRow = {
  /** 🔴 **포털이 정한 번호**다. 점검은 이 값 하나로 양쪽 줄의 짝을 맞춘다. */
  id: string;
  startsAt: Date;
  endsAt: Date;
  /** 비어 있으면 살아 있는 줄. 🔴 **거둔 줄도 반드시 함께 내준다.** */
  revokedAt: Date | null;
};

/**
 * 「이 집이 지금 가진 위임 전부」. 🔴 **`.where()` 가 한 줄도 없는 것이 이 조회의
 * 전부다.** 살아 있는 것·끝난 것·**거둔 것**을 다 준다 — 포털과 맞대어 볼 때 「포털은
 * 거뒀는데 집에서는 살아 있는」 줄이 가장 위험한 어긋남인데(설계 B-13), 거른 목록으로는
 * 그 줄이 **양쪽에서 똑같이 안 보인다.**
 *
 * 🔴 **차례를 못 박는다**(번호 오름차순). 상한에 걸려 잘릴 때 **어느 줄이 잘리는가**가
 * 호출마다 달라지면, 점검이 돌 때마다 다른 줄을 「집에 없다」로 읽는다.
 *
 * 🔴 **상한보다 한 줄 더 묻는다**(`limit + 1`). 그 한 줄이 「넘쳤다」를 가리는 유일한
 * 길이고, 딱 상한만큼 읽으면 **정확히 상한만큼 있는 날**과 **넘친 날**이 같은 답이 된다.
 * 세어서 잘라내는 것은 몸통을 짓는 쪽이다(`buildDelegationListReply`) — 🔴 **그러니 이
 * 조회가 돌려주는 줄을 그대로 내보내면 안 된다.**
 *
 * 🔴 **상한 값을 여기서 정하지 않는다.** 그 숫자는 **통로 규약**이라
 * `server/integration/portal-delegation-list.ts` 가 쥐고 있는데, 이 집의 저장 계층은
 * `@/lib/server/` 를 끌어오지 않는다(층 규칙 — server/portal-delegation-read-wiring.test.ts
 * 가 지킨다). 그래서 통로가 **같은 상수를 조회와 몸통 짓는 쪽에 함께** 넘긴다.
 *
 * 🔵 **질의를 만들기만 하고 돌리지 않는다.** 시험이 `.toSQL()` 로 구워 「사람 칸을 안
 * 고르는가」·「거르개가 없는가」·「한 줄 더 묻는가」를 글자가 아니라 **구워진 SQL** 로 본다.
 */
export function portalDelegationsForAuditQuery(limit: number) {
  return db
    .select({
      id: portalApprovalDelegations.id,
      startsAt: portalApprovalDelegations.startsAt,
      endsAt: portalApprovalDelegations.endsAt,
      revokedAt: portalApprovalDelegations.revokedAt,
    })
    .from(portalApprovalDelegations)
    .orderBy(asc(portalApprovalDelegations.id))
    .limit(limit + 1);
}

/**
 * 🔴 **읽기 갈래의 입구.** 부르는 곳은 `api/integration/delegations` 하나다.
 *
 * 🔴 **던지는 것을 삼키지 않는다** — 못 읽은 것을 빈 목록으로 답하면 점검이 그것을 「이
 * 집에 위임이 하나도 없다」로 읽고, **DB 가 앓는 날 모든 위임이 어긋난 것으로 보고된다.**
 * 통로가 그 던짐을 받아 500 으로 답한다.
 */
export async function listPortalApprovalDelegationsForAudit(
  limit: number
): Promise<PortalApprovalDelegationAuditRow[]> {
  return portalDelegationsForAuditQuery(limit);
}
