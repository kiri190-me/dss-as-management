import "server-only";
import { and, eq, gt, inArray, isNull } from "drizzle-orm";
import { db } from "../client";
import { hasPermission } from "@/lib/auth/permission-resolver";
import { approvalRouteDelegations, users } from "../schema";
import { insertAuditLog } from "./audit-logs";
import type {
  ApprovalRouteDelegationResult,
  ApprovalRouteDelegationResultCode,
} from "@/lib/validation/approval-route-delegation-input";

/**
 * ============================================================================
 * 결재선 단계 위임 — 만들기와 되돌리기
 * ============================================================================
 * 표는 `approval_route_delegations` 다. 🔴 **옛 `shipment_approval_delegations`
 * (출하 대표 위임)와 다른 표**이고, 이 파일은 그 표를 한 글자도 건드리지 않는다.
 * 둘이 어떻게 갈리는지는 표 머리말에 적혀 있다 — 고칠 일이 생기면 **어느 쪽
 * 이야기인지 먼저 가린 뒤에** 손대라.
 *
 * ── 🔴 인가는 「출하 대표」 지정과 **같은 열쇠·같은 수준**이다 ──────────────
 * 영역 열쇠 `users.shipmentRepresentatives`, 수준 MANAGE. **새 권한 영역을 만들지
 * 않는다**(2026-10-26 사용자 결정). 까닭이 둘이다:
 *
 *  1. 새 영역을 만들면 운영 DB 의 `role_permissions` 에 그 영역의 행이 **한 줄도
 *     없다.** 기본 정책이 받쳐 주더라도 「넓혀 둔 설정」은 새 영역만 비어 있는 채로
 *     남고, 배포한 날 아무도 이 화면을 못 쓰는 일이 실제로 일어난다.
 *  2. 「누가 최종 결재를 하는가」라는 한 물음의 두 얼굴이다. 결재선을 고칠 수 있는
 *     사람과 그 단계를 대신 누를 사람을 정할 수 있는 사람이 갈려서는 안 된다
 *     (결재선 저장이 같은 열쇠를 쓰는 것과 같은 판단 —
 *     mutations/shipment-approval-routes.ts).
 *
 * 🔵 같은 열쇠로 판정하는 자리가 몇인지는 `auth/developer-flag.test.ts` 가 파일
 * 목록과 개수로 지킨다. 여기에 판정을 하나 더하거나 빼면 그 시험이 걸린다 —
 * 일부러 그렇게 두었다.
 *
 * ── 🔴 「관리자가 자기를 대리인으로 세우는 것」을 막지 않는다 ───────────────
 * 2026-10-26 사용자 결정이다(표 머리말에도 같은 문장이 있다). 막을 자리는
 * `created_by_user_id` 가 남기는 **기록**이지 제약이 아니다 — 누가 세웠는지가
 * 줄마다 남으므로 나중에 전부 추려 볼 수 있다. 🔵 표의 `…_different_users` CHECK 는
 * 다른 이야기다. 그쪽은 「A 가 A 를 대신한다」는 뜻 없는 줄을 막는다.
 *
 * ── 🔴 겹치는 기간을 막지 않는다 ────────────────────────────────────────
 * 옛 위임은 같은 (대표, 대리인) 짝의 기간이 겹치면 거절하고, 그 경쟁을 advisory
 * lock 으로 줄 세운다. **이 표는 겹침이 정상이다**(표 머리말: 두 사람이 동시에
 * 자리를 비울 수 있다). 그래서 겹침 검사도, 그 검사를 지키려고 거는 잠금도 여기엔
 * 없다 — 겹친 줄에서 결재권자가 두 번 나오는 일은 판정 함수가 거른다.
 * 본보기를 옮겨 적다 그 두 조각이 따라 들어오지 않게 할 것.
 *
 * ── 줄을 지우는 길은 없다 ───────────────────────────────────────────────
 * 되돌리기는 `revoked_at` · `revoked_by_user_id` **두 칸을 함께** 적는 UPDATE 다.
 * 한쪽만 적으면 표의 `…_revocation_metadata` CHECK 가 거절한다 — 판정 함수가 시각
 * 한 칸만 보기 때문에 DB 쪽에서 짝을 묶어 둔 것이다.
 * ============================================================================
 */

class RouteDelegationMutationError extends Error {
  result: ApprovalRouteDelegationResult & { ok: false };
  constructor(result: ApprovalRouteDelegationResult & { ok: false }) {
    super(result.message);
    this.result = result;
  }
}

function fail(code: ApprovalRouteDelegationResultCode, message: string): never {
  throw new RouteDelegationMutationError({ ok: false, code, message });
}

type EligibleUser = {
  id: string;
  name: string;
  role: string;
  isDeveloper: boolean;
  approvalStatus: string;
  isActive: boolean;
  lockedAt: Date | null;
  isDeleted: boolean;
};

/**
 * 「지금 쓸 수 있는 계정인가」 — 🔴 **옛 위임 코드가 쓰는 기준 그대로**다
 * (mutations/shipment-delegations.ts 의 isEligibleActor). 지워지지 않았고, 승인됐고,
 * 활성이고, 잠기지 않았다. 네 조건을 여기서 새로 짓지 않는 것이 중요하다 — 두 위임이
 * 「쓸 수 있는 계정」을 다르게 보면, 같은 사람이 한쪽에서는 되고 다른 쪽에서는 안 되는
 * 일이 생기고 그 까닭을 화면이 설명할 수 없다.
 *
 * 🔴 **출하 대표 표시(`is_shipment_representative`)는 보지 않는다.** 이 표에는
 * 「대표」라는 개념이 없다(표 머리말) — 결재선 단계에 적힌 사람이면 누구나 맡기는
 * 쪽이 될 수 있고, 맡는 쪽도 대표일 필요가 없다. 옛 코드가 대표 쪽에만 그 검사를
 * 더하는 것은 그쪽 기능이 **대표의 권한**을 넘기는 것이기 때문이다.
 */
function isEligibleUser(user: EligibleUser | undefined): user is EligibleUser {
  return (
    !!user &&
    !user.isDeleted &&
    user.approvalStatus === "APPROVED" &&
    user.isActive &&
    user.lockedAt === null
  );
}

const USER_FIELDS = {
  id: users.id,
  name: users.name,
  role: users.role,
  isDeveloper: users.isDeveloper,
  approvalStatus: users.approvalStatus,
  isActive: users.isActive,
  lockedAt: users.lockedAt,
  isDeleted: users.isDeleted,
} as const;

/** 감사 기록의 targetEntity — **표 이름 그대로**(이 저장소의 규약). */
const AUDIT_ENTITY = "approval_route_delegations";

export type CreateApprovalRouteDelegationParams = {
  /** 🔴 **누구의 결재권인가** — 결재선 단계에 적힌 사람의 `users.id`. */
  delegatorUserId: string;
  /** 대신 눌러 줄 사람의 `users.id`. */
  delegateUserId: string;
  startsAt: Date;
  /** 🔴 이 순간은 포함하지 않는다(반열린 구간). 「9월 30일까지」는 10월 1일 0시다. */
  endsAt: Date;
  /** 선택 입력. 안 적었으면 **빈 글자**다 — 이 칸은 널을 받지 않는다. */
  reason: string;
  /** 🔴 **실제로 누른 사람.** 본인인지 관리자가 대신한 것인지가 이 값으로 갈린다. */
  actorUserId: string;
};

/**
 * 위임 한 줄을 만든다.
 *
 * 🔴 인자를 **이름 있는 객체로 받는다.** 옛 위임의 같은 함수는 자리로 받는데
 * (`(representativeUserId, delegateUserId, startsAt, endsAt, actorUserId, reason)`),
 * uuid 세 개가 줄줄이 늘어선 모양이라 둘을 바꿔 넣어도 `tsc` 가 아무 말도 하지
 * 않는다. 바꿔 넣으면 「남의 결재권을 내가 맡는」 줄이 조용히 만들어진다.
 *
 * 🔴 `created_by_user_id` 에는 **actor** 가 들어간다. 본인이 스스로 맡겼는지 관리자가
 * 대신 세웠는지는 그 칸에만 남는다(`delegator_user_id` 와 같으면 본인).
 */
export async function createApprovalRouteDelegation(
  params: CreateApprovalRouteDelegationParams
): Promise<ApprovalRouteDelegationResult> {
  // 표의 CHECK 둘을 **여기서 먼저** 거른다. 이 함수는 서버 액션을 거치지 않고
  // 직접 불리기도 하는데(시험이 그렇게 부른다), 걸러 내지 않으면 날것의
  // PostgresError 가 사람에게 그대로 나간다 — 옛 위임의 같은 자리와 같은 판단이다.
  if (params.delegatorUserId === params.delegateUserId) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      message: "자기 자신을 대리 결재자로 지정할 수 없습니다.",
    };
  }
  if (params.endsAt.getTime() <= params.startsAt.getTime()) {
    return {
      ok: false,
      code: "INVALID_TIME_RANGE",
      message: "종료 일시는 시작 일시보다 이후여야 합니다.",
    };
  }

  try {
    return await db.transaction(async (tx) => {
      const [actor] = await tx.select(USER_FIELDS).from(users).where(eq(users.id, params.actorUserId));
      if (!isEligibleUser(actor)) fail("FORBIDDEN", "사용자 정보를 확인할 수 없습니다.");

      // 본인 위임은 권한과 무관하게 열려 있다 — 설정으로 좁히더라도 결재권자가
      // 자기 자리를 못 맡기게 되면 이 기능 자체가 멈춘다(자리를 비우는 사람이
      // 관리자에게 부탁해야만 한다). 남을 대신할 때만 권한을 본다.
      const isSelfDelegating = actor.id === params.delegatorUserId;
      if (
        !isSelfDelegating &&
        !(await hasPermission(actor, "users.shipmentRepresentatives", "MANAGE"))
      ) {
        fail("FORBIDDEN", "결재권자 본인 또는 권한이 있는 관리자만 결재 위임을 지정할 수 있습니다.");
      }

      const [delegatorRow] = await tx
        .select(USER_FIELDS)
        .from(users)
        .where(eq(users.id, params.delegatorUserId))
        // 🔴 FOR SHARE — 이 사람을 지우는 사용자 계정 삭제(FOR UPDATE)와 줄을 세운다.
        // 잠그지 않으면 삭제가 끝난 직후에 지워진 사람 앞으로 새 위임이 들어갈 수
        // 있다. 삭제가 먼저면 여기서 기다렸다가 지워진 행을 읽어 거절하고, 이쪽이
        // 먼저면 삭제가 기다린다. 공유 잠금이라 같은 사람에 대한 위임 생성끼리는
        // 서로 막지 않는다(옛 위임이 같은 까닭으로 같은 잠금을 쓴다).
        .for("share");
      if (!isEligibleUser(delegatorRow)) {
        fail("INVALID_USER", "활성 상태의 승인된 계정의 결재권만 위임할 수 있습니다.");
      }

      const [delegateRow] = await tx
        .select(USER_FIELDS)
        .from(users)
        .where(eq(users.id, params.delegateUserId))
        // 🔴 FOR SHARE — 맡기는 쪽과 같은 이유(바로 위 주석).
        .for("share");
      if (!isEligibleUser(delegateRow)) {
        fail("INVALID_USER", "활성 상태의 승인된 계정만 대리 결재자로 지정할 수 있습니다.");
      }

      const [inserted] = await tx
        .insert(approvalRouteDelegations)
        .values({
          delegatorUserId: params.delegatorUserId,
          delegateUserId: params.delegateUserId,
          startsAt: params.startsAt,
          endsAt: params.endsAt,
          reason: params.reason,
          createdByUserId: actor.id,
        })
        .returning({ id: approvalRouteDelegations.id });

      await insertAuditLog(tx, {
        actorUserId: actor.id,
        actionType: "CREATE",
        targetEntity: AUDIT_ENTITY,
        targetRecordId: inserted.id,
        previousValue: null,
        // 🔴 id 만이 아니라 **이름도** 적는다. 나중에 그 사람이 소프트삭제돼도 로그만
        // 읽고 누구였는지 알 수 있어야 한다 — id 만 남기면 로그가 스스로를 설명하지
        // 못한다(결재선 저장의 감사 기록과 같은 규율).
        //
        // 🔴 `createdBy` 를 따로 적는다. 「본인이 맡겼나, 관리자가 세웠나」는 이 값과
        // `delegator` 를 맞대어야만 나오고, 그 구분이 이 기능에서 가장 나중에 문제가
        // 될 값이다(막지 않기로 한 「자기를 대리인으로」가 여기서 드러난다).
        newValue: {
          delegator: { id: delegatorRow.id, name: delegatorRow.name },
          delegate: { id: delegateRow.id, name: delegateRow.name },
          startsAt: params.startsAt.toISOString(),
          endsAt: params.endsAt.toISOString(),
          reason: params.reason,
          createdBy: { id: actor.id, name: actor.name },
          selfAssigned: isSelfDelegating,
        },
      });

      return { ok: true, id: inserted.id };
    });
  } catch (err) {
    if (err instanceof RouteDelegationMutationError) return err.result;
    throw err;
  }
}

export type RevokeApprovalRouteDelegationParams = {
  delegationId: string;
  /** 🔴 실제로 누른 사람. `revoked_by_user_id` 에 그대로 들어간다. */
  actorUserId: string;
};

/**
 * 위임 한 줄을 되돌린다 — 줄은 남고 되돌림 두 칸이 함께 채워진다.
 *
 * ── 🔴 인가가 **UPDATE 의 조건절에도** 들어간다 ─────────────────────────
 * 아래에서 읽어 확인한 뒤 같은 트랜잭션 안에서 다시 쓰는데, 조건절에 한 번 더
 * 적는다. 읽기와 쓰기 사이에 끼어들 수 있는 것을 막으려는 것이고(행은 FOR UPDATE 로
 * 잡아 두지만, 조건을 글로 적어 두면 나중에 잠금을 손대는 사람이 무엇을 지켜야
 * 하는지 코드에서 바로 본다), 0행이면 성공으로 넘기지 않고 거절한다.
 *
 * 되돌릴 수 있는 줄은 **아직 안 되돌렸고 아직 안 끝난** 것뿐이다. 이미 끝난 기간의
 * 위임을 되돌리는 것은 아무것도 바꾸지 않으면서 「철회됨」 딱지만 붙이는 일이고,
 * 그러면 그 줄이 **왜 끝났는지**(기간이 다 돼서인지 사람이 거둬들여서인지)를 나중에
 * 구별할 수 없다.
 */
export async function revokeApprovalRouteDelegation(
  params: RevokeApprovalRouteDelegationParams
): Promise<ApprovalRouteDelegationResult> {
  try {
    return await db.transaction(async (tx) => {
      const now = new Date();

      const [actor] = await tx.select(USER_FIELDS).from(users).where(eq(users.id, params.actorUserId));
      if (!isEligibleUser(actor)) fail("FORBIDDEN", "사용자 정보를 확인할 수 없습니다.");

      const [delegation] = await tx
        .select({
          id: approvalRouteDelegations.id,
          delegatorUserId: approvalRouteDelegations.delegatorUserId,
          delegateUserId: approvalRouteDelegations.delegateUserId,
          endsAt: approvalRouteDelegations.endsAt,
          revokedAt: approvalRouteDelegations.revokedAt,
        })
        .from(approvalRouteDelegations)
        .where(eq(approvalRouteDelegations.id, params.delegationId))
        // 🔴 위임 줄만 잠근다 — 이름을 얻으려고 users 를 조인한 채로 FOR UPDATE 를
        // 걸면 사람 행까지 배타 잠금이 걸려 사용자 계정 삭제와 교착할 수 있다.
        // 이름은 아래에서 따로 읽는다.
        .for("update");
      if (!delegation) fail("NOT_FOUND", "해당 위임을 찾을 수 없습니다.");
      if (delegation.revokedAt !== null) {
        fail("CONFLICT", "이미 철회된 위임입니다. 최신 정보를 다시 불러와 주세요.");
      }
      if (delegation.endsAt.getTime() <= now.getTime()) {
        fail("DELEGATION_EXPIRED", "이미 기간이 끝난 위임입니다. 철회할 것이 남아 있지 않습니다.");
      }

      // 맡긴 본인은 언제나 거둬들일 수 있다. 남의 위임을 거둬들이는 것만 권한을 본다.
      // 🔵 **대리인은 거둬들일 수 없다** — 맡은 사람이 스스로 자격을 버리는 길을 두면,
      // 맡긴 사람이 모르는 사이에 그 단계가 다시 멈춘다. 대리인이 못 하겠다고 하면
      // 맡긴 사람이나 관리자가 거둔다.
      const isSelfRevoking = actor.id === delegation.delegatorUserId;
      // 🔵 본인이면 권한을 **묻지 않는다**(짧은 회로). 그래서 변수에 담기는 것은
      // 「권한이 있나」가 아니라 「**남의 것까지** 거둘 수 있나」다 — 아래 조건절이
      // 그 뜻 그대로 쓰인다.
      const mayRevokeOthers =
        !isSelfRevoking && (await hasPermission(actor, "users.shipmentRepresentatives", "MANAGE"));
      if (!isSelfRevoking && !mayRevokeOthers) {
        fail("FORBIDDEN", "결재권자 본인 또는 권한이 있는 관리자만 결재 위임을 철회할 수 있습니다.");
      }

      const revoked = await tx
        .update(approvalRouteDelegations)
        .set({
          // 🔴 **두 칸을 함께** 적는다. 한쪽만 적힌 줄은 표의
          // `…_revocation_metadata` CHECK 가 아예 받아 주지 않는다 — 판정 함수가
          // `revoked_at` 한 칸만 보기 때문에 DB 가 짝을 묶어 둔 것이다.
          revokedAt: now,
          revokedByUserId: actor.id,
        })
        .where(
          and(
            eq(approvalRouteDelegations.id, params.delegationId),
            isNull(approvalRouteDelegations.revokedAt),
            gt(approvalRouteDelegations.endsAt, now),
            // 🔴 인가 조건. 남의 것까지 거둘 수 있는 사람에게는 조건을 더하지 않고,
            // 아니면 **자기 결재권의 줄만** 고를 수 있다.
            mayRevokeOthers ? undefined : eq(approvalRouteDelegations.delegatorUserId, actor.id)
          )
        )
        .returning({ id: approvalRouteDelegations.id });
      if (revoked.length === 0) {
        fail("CONFLICT", "이미 철회된 위임입니다. 최신 정보를 다시 불러와 주세요.");
      }

      // 이름은 잠그지 않고 읽는다(위 FOR UPDATE 주석). 사람 참조가 RESTRICT 라
      // 두 줄은 언제나 실재한다.
      const names = await tx
        .select({ id: users.id, name: users.name })
        .from(users)
        .where(inArray(users.id, [delegation.delegatorUserId, delegation.delegateUserId]));
      const nameOf = (id: string) => names.find((row) => row.id === id)?.name ?? null;

      await insertAuditLog(tx, {
        actorUserId: actor.id,
        // 🔴 SOFT_DELETE 가 아니라 UPDATE 다. 줄은 지워지지 않고 칸 둘이 채워질 뿐이며,
        // 로그를 읽는 사람이 찾는 것은 「살아 있던 위임이 이때 거둬졌다」이다. 그것을
        // 보여 주는 것은 previousValue/newValue 한 쌍이다.
        actionType: "UPDATE",
        targetEntity: AUDIT_ENTITY,
        targetRecordId: delegation.id,
        previousValue: { revokedAt: null, revokedBy: null },
        newValue: {
          delegator: { id: delegation.delegatorUserId, name: nameOf(delegation.delegatorUserId) },
          delegate: { id: delegation.delegateUserId, name: nameOf(delegation.delegateUserId) },
          revokedAt: now.toISOString(),
          revokedBy: { id: actor.id, name: actor.name },
          selfRevoked: isSelfRevoking,
        },
      });

      return { ok: true, id: revoked[0].id };
    });
  } catch (err) {
    if (err instanceof RouteDelegationMutationError) return err.result;
    throw err;
  }
}
