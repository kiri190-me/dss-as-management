import "server-only";
import { and, asc, desc, eq, gt, isNotNull, isNull, lte, or } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "../client";
import { hasPermission, type PermissionActor } from "@/lib/auth/permission-resolver";
import { approvalRouteDelegations, users } from "../schema";
import {
  actingApproverUserIds,
  actingDelegateUserIdsFor,
  type ActingApproverUserIds,
  type ApprovalRouteDelegationPeriod,
} from "@/lib/domain/approval-route-delegation";

/**
 * ============================================================================
 * 결재선 단계 위임 읽기 — 화면이 보는 둘, 판정이 보는 하나
 * ============================================================================
 * 표는 `approval_route_delegations` 다. 🔴 **옛 `shipment_approval_delegations`
 * (출하 대표 위임)와 다른 표**이고 쓰이는 때도 갈려 있다 — 어느 쪽 이야기인지
 * 가리는 방법은 표 머리말(vendor/dss-core/src/schema/approval-route-delegations.ts)에
 * 적어 두었다.
 *
 * 이 파일의 공개 함수는 성격이 둘로 갈린다. 섞지 말 것:
 *
 *  · `listApprovalRouteDelegationsForUser` — **사람에게 보여 줄 값**이다. 이름·사유·
 *    만든 사람까지 싣는다. 판정에 쓰지 마라(되돌림 여부를 글자로 다시 풀게 된다).
 *  · `listAllApprovalRouteDelegations` — 같은 모양이지만 **모두의 줄**이다. 🔴 이것만
 *    인가를 **제 손으로** 본다. 까닭은 그 함수 머리말에 있다.
 *  · `resolveActingApproverUserIds` — **판정이 쓰는 값**이다. id 목록 하나뿐이고,
 *    트랜잭션을 받는다. 화면에 쓰지 마라(이름이 없다).
 *  · `resolveActingDelegateUserIds` — 위와 **방향이 반대**인 id 목록이다(「나를 누가
 *    대신하나」). 🔴 **판정에 쓰지 마라** — 알림 받을 사람을 넓히는 자리 전용이다.
 * ============================================================================
 */

const delegator = alias(users, "route_delegation_delegator");
const delegate = alias(users, "route_delegation_delegate");
const createdBy = alias(users, "route_delegation_created_by");
const revokedBy = alias(users, "route_delegation_revoked_by");

/**
 * 화면이 한 줄을 그리는 데 필요한 전부.
 *
 * 🔴 시각을 ISO 글자로 바꾸지 않고 **`Date` 그대로** 내보낸다. 옛 위임 목록
 * (queries/shipment-delegations.ts)은 글자로 바꾸는데, 그쪽 화면 상태 함수가
 * `startsAt: string` 을 받기 때문이다. 이쪽 판정·딱지 함수는 `Date` 를 받고
 * (domain/approval-route-delegation.ts 의 🔵 주석이 그 결정과 까닭을 적어 두었다),
 * 글자로 바꿨다가 화면에서 다시 `new Date(...)` 하는 왕복은 틀릴 거리만 늘린다.
 *
 * 🔵 이름을 함께 싣는 까닭은 화면이 다시 묻지 않게 하려는 것이고, 그 이상은 싣지
 * 않는다 — 이메일·전화·포털 번호는 이 화면에 쓸 곳이 없다(옛 위임 목록이 포털
 * 번호 대신 참/거짓만 내보내는 것과 같은 판단).
 */
export type ApprovalRouteDelegationRow = {
  id: string;
  /** 결재권을 맡긴 사람 — 결재선 단계에 적힌 그 사람. */
  delegatorUserId: string;
  delegatorName: string;
  /** 대신 눌러 줄 사람. */
  delegateUserId: string;
  delegateName: string;
  startsAt: Date;
  /** 🔴 이 순간은 포함하지 않는다(반열린 구간). 표 쪽 주석 참조. */
  endsAt: Date;
  /** 선택 입력이라 **빈 글자**가 정상이다 — 널이 아니다. */
  reason: string;
  /**
   * 이 줄을 **만든** 사람. `delegatorUserId` 와 같으면 본인이 스스로 맡긴 것이고,
   * 다르면 권한 있는 관리자가 대신 세운 것이다 — 그 구분이 남는 칸은 여기뿐이다.
   */
  createdByUserId: string;
  createdByName: string;
  createdAt: Date;
  /** 되돌렸으면 그 시각. 아직 살아 있으면 null. 아래 둘과 **짝**이다(표의 CHECK). */
  revokedAt: Date | null;
  revokedByUserId: string | null;
  revokedByName: string | null;
};

/**
 * 한 줄을 그리는 데 필요한 칸·조인을 **한 곳에서만** 적는다. 아래 두 조회가 같은
 * 모양을 돌려주어야 화면이 같은 부품으로 두 목록을 그릴 수 있는데, 칸 목록을 두 벌
 * 적어 두면 한쪽에만 칸이 늘어나는 날이 오고 그때 `tsc` 는 아무 말도 하지 않는다
 * (돌려주는 타입이 넓어질 뿐이다).
 *
 * `.where()` 와 `.orderBy()` 는 부르는 쪽이 붙인다.
 */
function delegationRowsBase() {
  return db
    .select({
      id: approvalRouteDelegations.id,
      delegatorUserId: approvalRouteDelegations.delegatorUserId,
      delegatorName: delegator.name,
      delegateUserId: approvalRouteDelegations.delegateUserId,
      delegateName: delegate.name,
      startsAt: approvalRouteDelegations.startsAt,
      endsAt: approvalRouteDelegations.endsAt,
      reason: approvalRouteDelegations.reason,
      createdByUserId: approvalRouteDelegations.createdByUserId,
      createdByName: createdBy.name,
      createdAt: approvalRouteDelegations.createdAt,
      revokedAt: approvalRouteDelegations.revokedAt,
      revokedByUserId: approvalRouteDelegations.revokedByUserId,
      revokedByName: revokedBy.name,
    })
    .from(approvalRouteDelegations)
    // 사람 참조가 전부 RESTRICT 이고 이 저장소의 사용자는 소프트삭제만 하므로,
    // 참조된 users 행은 언제나 실재한다 — innerJoin 이어도 줄을 잃지 않는다
    // (queries/shipment-approval-routes.ts 가 같은 근거로 innerJoin 을 쓴다).
    // 🔴 소프트삭제된 사람의 줄도 빼지 않는다. 조용히 빼면 「분명히 맡겼는데
    // 목록에 없다」가 되고, 화면에서 까닭을 알 길이 없다.
    .innerJoin(delegator, eq(approvalRouteDelegations.delegatorUserId, delegator.id))
    .innerJoin(delegate, eq(approvalRouteDelegations.delegateUserId, delegate.id))
    .innerJoin(createdBy, eq(approvalRouteDelegations.createdByUserId, createdBy.id))
    // 되돌린 사람만 널을 허락하는 칸이라 여기만 leftJoin 이다.
    .leftJoin(revokedBy, eq(approvalRouteDelegations.revokedByUserId, revokedBy.id));
}

/**
 * 「내가 맡긴 것」과 「내가 대신하고 있는 것」. 둘 다 **되돌린 줄·끝난 줄까지**
 * 돌려준다 — 화면이 네 딱지(활성·예정·만료·철회됨)를 그리려면 죽은 줄도 보여야
 * 하고, 상태는 저장되지 않고 읽을 때 계산되기 때문이다
 * (deriveApprovalRouteDelegationDisplayStatus).
 *
 * 🔵 한 줄이 양쪽에 동시에 들어가는 일은 없다 — 그러려면 맡긴 사람과 대신하는
 * 사람이 같아야 하는데, 표의 `…_different_users` CHECK 가 그런 줄을 못 만들게 한다.
 *
 * 🔵 질의를 한 번만 던진다(`OR`). 두 번 나눠 던지면 두 목록의 「지금」이 미세하게
 * 어긋나, 같은 화면에서 한쪽에만 보이는 줄이 생길 수 있다.
 */
export async function listApprovalRouteDelegationsForUser(userId: string): Promise<{
  given: ApprovalRouteDelegationRow[];
  received: ApprovalRouteDelegationRow[];
}> {
  const rows = await delegationRowsBase()
    .where(
      or(
        eq(approvalRouteDelegations.delegatorUserId, userId),
        eq(approvalRouteDelegations.delegateUserId, userId)
      )
    )
    .orderBy(desc(approvalRouteDelegations.createdAt));

  return {
    given: rows.filter((row) => row.delegatorUserId === userId),
    received: rows.filter((row) => row.delegateUserId === userId),
  };
}

/* ------------------------------------------------------------------ */
/* 대리 결재자로 세울 수 있는 사람 — 이름까지만                          */
/* ------------------------------------------------------------------ */

/**
 * 🔴 **이 목록은 `users.view` 권한이 없는 사람에게도 내려간다.** 결재선에 박힌
 * 엔지니어가 자기 결재권을 맡기려면 「누구에게」를 골라야 하고, 그 고르개가 없으면
 * 기능 자체가 없는 것과 같다(auth/users-area-access.ts 머리말).
 *
 * 그래서 **싣는 칸이 셋뿐**이다. `listSelectableApproverCandidates`(결재선 편집용)가
 * 역할과 포털 번호(`sso_subject`)까지 싣는 것과 일부러 다르다 — 그 목록을 돌려쓰면
 * 사내 전원의 역할과 포털 번호가 엔지니어의 HTML 에 그대로 실려 나간다.
 *
 * 🔴 **이메일은 여기서 거르지 않는다.** 누구에게 내릴지는 **부르는 쪽**이 정한다
 * (app/(app)/users/page.tsx 가 권한에 따라 `null` 로 바꾼다) — 이름이 같은 사람을
 * 가려야 하는 관리자에게는 필요하고, 권한 없이 들어온 사람에게는 필요 없다. 조회가
 * 세션을 들여다보고 알아서 가리면 「왜 어떤 때는 이메일이 없나」를 설명할 자리가
 * 사라진다.
 *
 * 🔴 **자격 넷은 쓰기 쪽과 글자 그대로 같다**(mutations/approval-route-delegations.ts
 * 의 isEligibleUser): 안 지워졌고 · 승인됐고 · 활성이고 · 안 잠겼다. 넓히면 고를 수는
 * 있는데 저장이 거절되고, 좁히면 세울 수 있는 사람이 목록에 없다.
 */
export type ApprovalRouteDelegateCandidate = {
  id: string;
  name: string;
  /** 🔴 권한 없이 들어온 사람에게는 부르는 쪽이 `null` 로 바꿔 내린다. */
  email: string | null;
};

export async function listApprovalRouteDelegateCandidates(): Promise<
  ApprovalRouteDelegateCandidate[]
> {
  return db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(
      and(
        eq(users.isDeleted, false),
        eq(users.approvalStatus, "APPROVED"),
        eq(users.isActive, true),
        isNull(users.lockedAt)
      )
    )
    .orderBy(asc(users.name));
}

/* ------------------------------------------------------------------ */
/* 모두의 결재권 위임 — 관리 권한이 있는 사람만                          */
/* ------------------------------------------------------------------ */

/**
 * 🔴 **끝난 줄을 몇 개까지 가져올까.** 살아 있는 줄에는 상한을 두지 않는다(그 집합은
 * 「지금 자리를 비운 사람 수」라 본질적으로 작고, 상한에 밀려 **되돌려야 할 줄**이
 * 안 보이는 것이 이 기능에서 가장 나쁜 일이다). 상한이 필요한 쪽은 끝난 줄뿐이다 —
 * 줄을 지우는 길이 없어(표 머리말) 해가 갈수록 쌓이기만 한다.
 *
 * 🔵 50 에 깊은 뜻은 없다. 「한 화면에서 훑을 수 있는 양」이고, 더 뒤까지 찾아야 하면
 * 감사 로그가 영구 기록이다(위임을 만들 때도 되돌릴 때도 한 줄씩 남는다 —
 * mutations/approval-route-delegations.ts). 잘렸다는 사실은 화면이 말해 준다.
 */
const FINISHED_DELEGATION_LIMIT = 50;

export type AllApprovalRouteDelegationsView = {
  /**
   * 아직 되돌리지 않았고 아직 안 끝난 줄 — **전부**. 🔴 이 집합은 되돌리기 mutation 이
   * 받아 주는 집합과 **정확히 같다**(`revoked_at IS NULL AND ends_at > now`). 그래서
   * 이 목록의 모든 줄에는 [되돌리기]가 붙고, 눌러도 거절당하는 줄이 섞이지 않는다.
   */
  live: ApprovalRouteDelegationRow[];
  /** 되돌렸거나 기간이 끝난 줄 — 최근 것부터 `FINISHED_DELEGATION_LIMIT` 건까지. */
  finished: ApprovalRouteDelegationRow[];
  /** 끝난 줄이 상한보다 많았다. 화면이 「최근 N건만 보여 준다」를 말해 줘야 한다. */
  finishedTruncated: boolean;
  /** 화면이 「최근 N건」의 N 을 글자로 박지 않게 함께 내보낸다. */
  finishedLimit: number;
};

export type AllApprovalRouteDelegationsResult =
  | { ok: true; view: AllApprovalRouteDelegationsView }
  | { ok: false; reason: "FORBIDDEN" };

/**
 * **모든 사람의** 결재권 위임. 관리 권한이 있는 사람만 받을 수 있다.
 *
 * ── 🔴 인가를 **이 함수가** 본다. 화면·페이지에 맡기지 않는다 ───────────────
 * 이 파일의 다른 조회들과 달리 여기만 제 손으로 `hasPermission` 을 부른다. 까닭은
 * 돌려주는 것이 **남의 줄**이라서다 — 페이지가 가리는 데 그치면 이 함수를 부르는
 * 새 자리(다음에 생길 API 통로·스크립트)가 생기는 날 조용히 다 새어 나간다. 그리고
 * 2026-10-26 에 실제로 겪었다: 「화면에서 가린다」로 시작한 자리가 늘 그렇게 된다.
 *
 * 🔴 **열쇠와 수준은 쓰기와 같은 것**이다(`users.shipmentRepresentatives` / MANAGE).
 * 새 권한 영역을 만들지 않는 까닭은 mutations/approval-route-delegations.ts 머리말에
 * 있다 — 새 영역은 운영 DB 의 `role_permissions` 에 행이 한 줄도 없어서, 배포한 날
 * 아무도 그 화면을 못 쓴다. 읽기를 쓰기보다 **느슨하게** 열지 않는 것도 중요하다:
 * 되돌릴 수 없는 사람에게 남의 위임 목록을 보여 줄 까닭이 없다.
 *
 * 🔴 거절은 **빈 목록이 아니라 `ok: false`** 다. 빈 목록으로 돌려주면 「권한이 없다」와
 * 「아직 아무도 안 맡겼다」가 같은 값이 되고, 화면은 둘을 구별해 말할 수 없다.
 * 거절한 값에는 `view` 칸 자체가 없어서, 부르는 쪽이 `ok` 를 안 보고 꺼내려 하면
 * `tsc` 가 멈춘다.
 *
 * ── 왜 두 질의인가, 그리고 왜 겹치지 않는가 ────────────────────────────────
 * 상한이 필요한 쪽이 한쪽뿐이라 한 질의로는 표현되지 않는다(위 상수 주석). 두 질의의
 * 조건은 **서로 정확한 여집합**이고, 🔴 **「지금」을 TS 에서 한 번 만들어 둘 다에 같은
 * 값으로 넘긴다** — 각자 `now()` 를 쓰면 두 질의 사이에 끝난 줄이 양쪽에서 빠지거나
 * 양쪽에 들어간다.
 */
export async function listAllApprovalRouteDelegations(
  actor: PermissionActor,
  now: Date = new Date()
): Promise<AllApprovalRouteDelegationsResult> {
  if (!(await hasPermission(actor, "users.shipmentRepresentatives", "MANAGE"))) {
    return { ok: false, reason: "FORBIDDEN" };
  }

  const isLive = and(
    isNull(approvalRouteDelegations.revokedAt),
    gt(approvalRouteDelegations.endsAt, now)
  );
  // 위의 정확한 여집합: 되돌렸거나(기간과 무관하다) 기간이 끝났거나.
  const isFinished = or(
    isNotNull(approvalRouteDelegations.revokedAt),
    lte(approvalRouteDelegations.endsAt, now)
  );

  const [live, finishedPage] = await Promise.all([
    delegationRowsBase().where(isLive).orderBy(desc(approvalRouteDelegations.createdAt)),
    delegationRowsBase()
      .where(isFinished)
      .orderBy(desc(approvalRouteDelegations.createdAt))
      // 🔵 한 건 더 받아 「더 있다」를 센다. 따로 COUNT 를 던지면 그 사이에 줄이 늘어
      // 「더 있다는데 다 보인다」가 될 수 있고, 질의가 하나 더 는다.
      .limit(FINISHED_DELEGATION_LIMIT + 1),
  ]);

  const finishedTruncated = finishedPage.length > FINISHED_DELEGATION_LIMIT;
  return {
    ok: true,
    view: {
      live,
      finished: finishedTruncated ? finishedPage.slice(0, FINISHED_DELEGATION_LIMIT) : finishedPage,
      finishedTruncated,
      finishedLimit: FINISHED_DELEGATION_LIMIT,
    },
  };
}

/**
 * 트랜잭션 핸들과 최상위 db 를 둘 다 받는다 — 결재를 집는 쓰기는 **자기 트랜잭션
 * 안에서** 물어야 하고, 목록·알림은 트랜잭션 없이 묻는다. 읽기 전용이라 둘 중
 * 무엇으로 실행하든 뜻이 같다(queries/shipment-approval-routes.ts 의 같은 자리).
 */
type Executor = Parameters<Parameters<typeof db.transaction>[0]>[0] | typeof db;

/**
 * 🔴 **「지금 이 사람의 자격으로 누를 수 있는 결재자 id」 전부.** 맨 앞은 언제나
 * 본인이고, 뒤에 지금 살아 있는 위임의 결재권자들이 붙는다.
 *
 * 판정 자체는 하지 않는다 — 줄을 읽어 순수 함수(`actingApproverUserIds`)에 넘길 뿐이다.
 * 「누를 수 있나」가 SQL 과 TS 두 벌로 적히지 않게 하려는 것이고, 그 까닭은 그 함수
 * 주석에 길게 적혀 있다.
 *
 * ── 🔴 `executor` 를 꼭 넘겨라. 기본값은 **읽기 전용 자리에서만** 쓴다 ────────
 * 결재를 집는 쓰기와 **같은 트랜잭션**으로 읽지 않으면, 읽은 직후 되돌려진 위임으로
 * 결재가 통과한다. 그 어긋남은 오류를 내지 않고, 나중에 로그를 봐도 「되돌린 뒤에
 * 눌렸다」는 사실만 남아 설명할 수 없다. 기본값(`db`)은 목록·알림처럼 그 순간의
 * 답이면 충분한 자리를 위한 것이다.
 *
 * ── SQL 로 좁히는 셋은 전부 순수 함수가 **또** 거르는 조건이다 ───────────────
 * 대리인(`delegate_user_id`) · 안 되돌림(`revoked_at IS NULL`) · 안 끝남
 * (`ends_at > now`). 색인 칸 순서가 그대로 이 셋이다. 좁히기가 지우는 줄은 순수
 * 함수가 어차피 버리는 줄뿐이라 답이 달라지지 않는다 — **시작 시각은 일부러 SQL 에서
 * 보지 않는다.** 한 사람에게 걸린 위임은 많아야 몇 줄이고, 색인에도 그 칸은 없다
 * (표 쪽 🔵 주석). 아직 시작 안 한 줄은 순수 함수가 버린다.
 *
 * 🔴 **맡긴 사람이 지금 쓸 수 있는 계정인지는 보지 않는다.** 위임을 만들 때 검사하고
 * (mutations/approval-route-delegations.ts), 그 뒤에 그 사람이 잠기거나 비활성이
 * 되어도 **대리인의 자격은 그대로 둔다** — 결재선 단계는 그 사람 이름으로 남아 있고,
 * 자리를 비운 사이 그 단계를 넘겨 주는 것이 이 기능이 있는 까닭이기 때문이다.
 * 여기에 「맡긴 사람이 활성인가」를 더하면, 사람이 자리를 비운 바로 그 상황에서
 * 위임이 함께 죽는다.
 */
export async function resolveActingApproverUserIds(
  actorUserId: string,
  now: Date,
  executor: Executor = db
): Promise<ActingApproverUserIds> {
  const rows: ApprovalRouteDelegationPeriod[] = await executor
    .select({
      delegatorUserId: approvalRouteDelegations.delegatorUserId,
      delegateUserId: approvalRouteDelegations.delegateUserId,
      startsAt: approvalRouteDelegations.startsAt,
      endsAt: approvalRouteDelegations.endsAt,
      revokedAt: approvalRouteDelegations.revokedAt,
    })
    .from(approvalRouteDelegations)
    .where(
      and(
        eq(approvalRouteDelegations.delegateUserId, actorUserId),
        isNull(approvalRouteDelegations.revokedAt),
        gt(approvalRouteDelegations.endsAt, now)
      )
    );

  return actingApproverUserIds(rows, actorUserId, now);
}

/**
 * 🔴 **「이 결재권자를 지금 대신할 수 있는 사람」 전부.** 바로 위 함수와 **방향이
 * 반대**이고, 그것 말고는 같은 함수다 — 같은 표를 같은 셋으로 좁히고, 판정은 순수
 * 함수(`actingDelegateUserIdsFor`)에 맡긴다.
 *
 * 2026-10-26 에 더했다. 쓰는 자리는 **결재가 생겼을 때 나가는 즉시 알림**이다
 * (server/integration/approval-created-notice.ts). 그 전에는 결재선 단계에 적힌 한
 * 사람에게만 가서, **자리를 비운 사람이 메일을 받고 대신 눌러야 할 사람은 못 받았다.**
 *
 * ── 🔴 이것은 **인가가 아니다** ─────────────────────────────────────────
 * 「누를 수 있나」는 지금도 위 `resolveActingApproverUserIds` 하나가 정하고, 결재
 * mutation 이 자기 트랜잭션 안에서 그것을 묻는다. 여기에 한 사람이 더 들어와도 그
 * 사람이 누를 수 있게 되지는 **않는다** — 늘어나는 것은 메일 받을 사람뿐이다.
 * 🔵 두 함수가 같은 표를 같은 규칙으로 읽으므로 실제로는 답이 짝을 이룬다. 한쪽만
 * 고치면 「메일은 오는데 눌리지 않는다」(또는 그 반대)가 되고 그 어긋남은 조용하니,
 * 조건을 손댈 때는 **둘을 함께** 본다.
 *
 * ── 🔴 돌려주는 목록은 **빌 수 있다** ───────────────────────────────────
 * 위 함수가 빈 적이 없는 꼴(`[string, ...string[]]`)인 것은 그 값이 `inArray` 에 그대로
 * 들어가기 때문이고, 이 값은 거기 안 들어간다. 빈 목록은 오류가 아니라 **「지금 대신할
 * 사람이 없다」** 는 정상적인 답이고, 그때 알림은 지정된 한 사람에게만 간다.
 *
 * ── 🔵 이 방향에는 색인이 없다. 알고 그대로 둔다 ────────────────────────
 * 표의 색인은 `(delegate_user_id, revoked_at, ends_at)` 하나뿐이라(표 쪽 주석) 맡긴
 * 사람으로 좁히는 이 조회는 타지 못한다. 그래도 두는 까닭은 이 표가 **「지금 자리를
 * 비운 사람 수」만큼만** 자라기 때문이다 — 통째로 훑어도 몇 줄이고, 부르는 자리는
 * 결재가 생기는 순간 한 번뿐이다. 색인을 더하려면 마이그레이션이 필요하니, 느려진
 * 뒤에 **재어 보고** 더해라.
 */
export async function resolveActingDelegateUserIds(
  delegatorUserId: string,
  now: Date,
  executor: Executor = db
): Promise<string[]> {
  const rows: ApprovalRouteDelegationPeriod[] = await executor
    .select({
      delegatorUserId: approvalRouteDelegations.delegatorUserId,
      delegateUserId: approvalRouteDelegations.delegateUserId,
      startsAt: approvalRouteDelegations.startsAt,
      endsAt: approvalRouteDelegations.endsAt,
      revokedAt: approvalRouteDelegations.revokedAt,
    })
    .from(approvalRouteDelegations)
    .where(
      and(
        // 🔴 위 함수가 `delegateUserId` 로 좁히는 그 자리에서 **칸만 바뀐다.** 나머지
        //    둘은 같고, 시작 시각을 일부러 SQL 에서 안 보는 것도 같다(위 주석).
        eq(approvalRouteDelegations.delegatorUserId, delegatorUserId),
        isNull(approvalRouteDelegations.revokedAt),
        gt(approvalRouteDelegations.endsAt, now)
      )
    );

  return actingDelegateUserIdsFor(rows, delegatorUserId, now);
}
