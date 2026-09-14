import "server-only";
import { and, eq, gt, inArray, lt, sql } from "drizzle-orm";
import { db } from "../client";
import { hasPermission } from "@/lib/auth/permission-resolver";
import { shipmentApprovalDelegations, users } from "../schema";
import type { ShipmentManagementResult, ShipmentManagementResultCode } from "@/lib/validation/shipment-delegation-input";

/**
 * shipment_approval_delegations create/revoke — authorization per the
 * task's preferred rule (no can_assign_shipment_delegation flag, see the
 * Phase-1 report): the representative may delegate their own authority;
 * SUPER_ADMIN may assign/revoke on behalf of any representative; nobody
 * else.
 */

class DelegationMutationError extends Error {
  result: ShipmentManagementResult & { ok: false };
  constructor(result: ShipmentManagementResult & { ok: false }) {
    super(result.message);
    this.result = result;
  }
}

function fail(code: ShipmentManagementResultCode, message: string): never {
  throw new DelegationMutationError({ ok: false, code, message });
}

type EligibleUser = {
  id: string;
  approvalStatus: string;
  isActive: boolean;
  lockedAt: Date | null;
  isDeleted: boolean;
};

function isEligibleActor(user: EligibleUser | undefined): user is EligibleUser {
  return !!user && !user.isDeleted && user.approvalStatus === "APPROVED" && user.isActive && user.lockedAt === null;
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * 아직 ACTIVE 인 위임들을 REVOKED 로 닫는다 — **부르는 쪽의 트랜잭션 안에서.**
 * 실제로 닫힌 행의 id 만 돌려준다(이미 닫힌 것·없는 것은 빠진다).
 *
 * 🔴 판정은 하지 않는다. 누가 철회할 수 있는가는 부르는 자리마다 다르다 — 화면의
 * [철회]는 revokeShipmentDelegation 이(대표 본인 또는 권한 있는 관리자), 사용자
 * 계정 삭제는 진짜 최고관리자 판정 뒤에 지울 사람이 대표이거나 대리인인 위임을
 * 전부 닫는다. 여기는 그 뒤의 **쓰기**만 한 곳에 모았다 — 철회 칸 셋(상태 ·
 * 철회자 · 철회 시각)이 표의 CHECK(revocation_metadata)대로 언제나 함께 채워지게.
 *
 * `status = 'ACTIVE'` 조건을 UPDATE 에 걸어 둔다 — 부르는 쪽이 행을 잠그고 읽었어도
 * 0행 쓰기를 조용히 성공으로 넘기지 않으려면 돌려받은 id 로 확인해야 한다.
 */
export async function revokeActiveDelegationsInTx(
  tx: Tx,
  params: { delegationIds: readonly string[]; actorUserId: string }
): Promise<string[]> {
  // 빈 IN 절은 드라이버마다 다르게 굴러 굳이 확인할 이유가 없다 — 닫을 것이
  // 없으면 질의 자체를 하지 않는다.
  if (params.delegationIds.length === 0) return [];

  const now = new Date();
  const revoked = await tx
    .update(shipmentApprovalDelegations)
    .set({
      status: "REVOKED",
      revokedByUserId: params.actorUserId,
      revokedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        inArray(shipmentApprovalDelegations.id, [...params.delegationIds]),
        eq(shipmentApprovalDelegations.status, "ACTIVE")
      )
    )
    .returning({ id: shipmentApprovalDelegations.id });

  return revoked.map((row) => row.id);
}

export async function createShipmentDelegation(
  representativeUserId: string,
  delegateUserId: string,
  startsAt: Date,
  endsAt: Date,
  actorUserId: string,
  reason: string | null
): Promise<ShipmentManagementResult> {
  if (representativeUserId === delegateUserId) {
    return { ok: false, code: "VALIDATION_ERROR", message: "대표 자신을 대리 승인자로 지정할 수 없습니다." };
  }
  // Defense in depth: the Server Action layer already runs
  // validateDelegationDateRange on the raw string input before this
  // function is ever called, but this mutation is also called/tested
  // directly — without this check, an invalid range reaches the DB and
  // surfaces as a raw CHECK-constraint PostgresError instead of a clean
  // result, same reasoning as decideRepairCaseApproval's own inline
  // REJECTED-reason check.
  if (endsAt.getTime() <= startsAt.getTime()) {
    return { ok: false, code: "INVALID_TIME_RANGE", message: "종료 일시는 시작 일시보다 이후여야 합니다." };
  }

  try {
    return await db.transaction(async (tx) => {
      const [actor] = await tx
        .select({ id: users.id, role: users.role, approvalStatus: users.approvalStatus, isActive: users.isActive, lockedAt: users.lockedAt, isDeleted: users.isDeleted, isDeveloper: users.isDeveloper })
        .from(users)
        .where(eq(users.id, actorUserId));
      if (!isEligibleActor(actor)) fail("FORBIDDEN", "사용자 정보를 확인할 수 없습니다.");
      const isSelfDelegating = actor.id === representativeUserId;
      // 본인 위임은 권한과 무관하게 열려 있다 — 설정으로 좁히더라도 대표가
      // 자기 위임을 못 하게 되면 대표 제도 자체가 멈춘다. 남을 대신할 때만
      // 권한을 본다.
      if (
        !isSelfDelegating &&
        !(await hasPermission(actor, "users.shipmentRepresentatives", "MANAGE"))
      ) {
        fail("FORBIDDEN", "대표 본인 또는 권한이 있는 관리자만 위임을 지정할 수 있습니다.");
      }

      const [representativeRow] = await tx
        .select({
          isShipmentRepresentative: users.isShipmentRepresentative,
          approvalStatus: users.approvalStatus,
          isActive: users.isActive,
          lockedAt: users.lockedAt,
          isDeleted: users.isDeleted,
        })
        .from(users)
        .where(eq(users.id, representativeUserId))
        // 🔴 FOR SHARE — 이 사람을 지우는 사용자 계정 삭제(FOR UPDATE)와 줄을 세운다.
        // 잠그지 않으면 삭제가 이 사람의 위임을 다 닫은 직후에 여기서 새 ACTIVE 위임이
        // 들어갈 수 있다. 삭제가 먼저면 여기서 기다렸다가 지워진 행을 읽어 거절하고,
        // 이쪽이 먼저면 삭제가 기다렸다가 이 위임까지 닫는다. 공유 잠금이라 같은 사람에
        // 대한 위임 생성끼리는 서로 막지 않는다.
        .for("share");
      if (
        !representativeRow ||
        representativeRow.isDeleted ||
        !representativeRow.isShipmentRepresentative ||
        representativeRow.approvalStatus !== "APPROVED" ||
        !representativeRow.isActive ||
        representativeRow.lockedAt !== null
      ) {
        fail("INVALID_USER", "대표로 지정된, 활성 상태의 계정만 위임의 근거가 될 수 있습니다.");
      }

      const [delegateRow] = await tx
        .select({ approvalStatus: users.approvalStatus, isActive: users.isActive, lockedAt: users.lockedAt, isDeleted: users.isDeleted })
        .from(users)
        .where(eq(users.id, delegateUserId))
        // 🔴 FOR SHARE — 대표 쪽과 같은 이유(바로 위 주석).
        .for("share");
      if (
        !delegateRow ||
        delegateRow.isDeleted ||
        delegateRow.approvalStatus !== "APPROVED" ||
        !delegateRow.isActive ||
        delegateRow.lockedAt !== null
      ) {
        fail("INVALID_USER", "활성 상태의 승인된 계정만 대리 승인자로 지정할 수 있습니다.");
      }

      // Advisory transaction lock keyed on the (representative, delegate)
      // pair — serializes concurrent create attempts for the SAME pair so
      // the overlap check below can never race (a plain SELECT-then-INSERT
      // has a phantom-row window: two concurrent transactions can both see
      // zero conflicting rows and both insert). Held only for this
      // transaction's duration, released automatically on commit/rollback.
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${representativeUserId} || ':' || ${delegateUserId}, 0))`
      );

      const overlapping = await tx
        .select({ id: shipmentApprovalDelegations.id })
        .from(shipmentApprovalDelegations)
        .where(
          and(
            eq(shipmentApprovalDelegations.representativeUserId, representativeUserId),
            eq(shipmentApprovalDelegations.delegateUserId, delegateUserId),
            eq(shipmentApprovalDelegations.status, "ACTIVE"),
            lt(shipmentApprovalDelegations.startsAt, endsAt),
            gt(shipmentApprovalDelegations.endsAt, startsAt)
          )
        )
        .limit(1);
      if (overlapping.length > 0) {
        fail("OVERLAPPING_DELEGATION", "동일한 대표-대리 승인자 조합에 대해 기간이 겹치는 위임이 이미 존재합니다.");
      }

      const [inserted] = await tx
        .insert(shipmentApprovalDelegations)
        .values({
          representativeUserId,
          delegateUserId,
          startsAt,
          endsAt,
          status: "ACTIVE",
          assignedByUserId: actorUserId,
          reason,
        })
        .returning({ id: shipmentApprovalDelegations.id });

      return { ok: true, id: inserted.id };
    });
  } catch (err) {
    if (err instanceof DelegationMutationError) return err.result;
    throw err;
  }
}

export async function revokeShipmentDelegation(
  delegationId: string,
  actorUserId: string
): Promise<ShipmentManagementResult> {
  try {
    return await db.transaction(async (tx) => {
      const [actor] = await tx
        .select({ id: users.id, role: users.role, approvalStatus: users.approvalStatus, isActive: users.isActive, lockedAt: users.lockedAt, isDeleted: users.isDeleted, isDeveloper: users.isDeveloper })
        .from(users)
        .where(eq(users.id, actorUserId));
      if (!isEligibleActor(actor)) fail("FORBIDDEN", "사용자 정보를 확인할 수 없습니다.");

      const [delegation] = await tx
        .select({
          id: shipmentApprovalDelegations.id,
          representativeUserId: shipmentApprovalDelegations.representativeUserId,
          status: shipmentApprovalDelegations.status,
        })
        .from(shipmentApprovalDelegations)
        .where(eq(shipmentApprovalDelegations.id, delegationId))
        .for("update");
      if (!delegation) fail("NOT_FOUND", "해당 위임을 찾을 수 없습니다.");
      if (delegation.status === "REVOKED") {
        fail("CONFLICT", "이미 철회된 위임입니다. 최신 정보를 다시 불러와 주세요.");
      }

      const isSelfRevoking = actor.id === delegation.representativeUserId;
      if (
        !isSelfRevoking &&
        !(await hasPermission(actor, "users.shipmentRepresentatives", "MANAGE"))
      ) {
        fail("FORBIDDEN", "대표 본인 또는 권한이 있는 관리자만 위임을 철회할 수 있습니다.");
      }

      const revoked = await revokeActiveDelegationsInTx(tx, {
        delegationIds: [delegationId],
        actorUserId,
      });

      if (revoked.length === 0) {
        fail("CONFLICT", "이미 철회된 위임입니다. 최신 정보를 다시 불러와 주세요.");
      }

      return { ok: true, id: revoked[0] };
    });
  } catch (err) {
    if (err instanceof DelegationMutationError) return err.result;
    throw err;
  }
}
