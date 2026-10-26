import "server-only";
import { and, desc, eq, gt, isNull, or } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "../client";
import { approvalRouteDelegations, users } from "../schema";
import {
  actingApproverUserIds,
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
 *  · `resolveActingApproverUserIds` — **판정이 쓰는 값**이다. id 목록 하나뿐이고,
 *    트랜잭션을 받는다. 화면에 쓰지 마라(이름이 없다).
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
  const rows = await db
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
    .leftJoin(revokedBy, eq(approvalRouteDelegations.revokedByUserId, revokedBy.id))
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
