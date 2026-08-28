import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../client";
import { insertAuditLog } from "./audit-logs";
import { customerRepairRequests } from "../schema";

/**
 * 의뢰 → 접수 전환의 **자리 선점과 마무리**.
 *
 * ■ 왜 상태를 먼저 잡고 시작하는가
 *
 * "status 가 NEW 인지 보고 → 접수를 만들고 → CONVERTED 로 바꾼다"로 하면,
 * 두 담당자가 거의 동시에 「접수 만들기」를 눌렀을 때 **둘 다 NEW 를 보고**
 * 각자 접수를 만든다. 같은 물건에 접수번호가 둘 생기고, 그 뒤는 사람이
 * 손으로 지워야 한다(접수는 지우기 어려운 자료다).
 *
 * 그래서 만들기 전에 `WHERE status='NEW'` 로 **한 번의 UPDATE 로 자리를
 * 잡는다.** 이긴 쪽만 1행을 받고, 진 쪽은 0행을 받아 곧바로 멈춘다.
 * 이 저장소가 접수 생성에서 쓰는 idempotency key 의 claim/resolve 와 같은
 * 모양이다.
 *
 * ■ 실패하면 되돌린다
 *
 * 접수 만들기가 실패했는데 CONVERTING 으로 남으면 그 의뢰는 아무도 손댈 수
 * 없는 상태로 굳는다. 되돌려 두면 사람이 원인을 고치고 다시 누를 수 있다.
 */

export type ClaimResult =
  | { ok: true; request: typeof customerRepairRequests.$inferSelect }
  | { ok: false; code: "NOT_FOUND" | "ALREADY_TAKEN"; message: string };

export async function claimRequestForConversion(
  requestId: string
): Promise<ClaimResult> {
  const claimed = await db
    .update(customerRepairRequests)
    .set({ status: "CONVERTING" })
    .where(
      and(
        eq(customerRepairRequests.id, requestId),
        eq(customerRepairRequests.status, "NEW")
      )
    )
    .returning();

  if (claimed.length === 1) {
    return { ok: true, request: claimed[0] };
  }

  // 0행이다 — 없는 의뢰이거나, 이미 누군가 잡았거나 처리를 끝냈다.
  const [existing] = await db
    .select({ status: customerRepairRequests.status })
    .from(customerRepairRequests)
    .where(eq(customerRepairRequests.id, requestId));

  if (!existing) {
    return { ok: false, code: "NOT_FOUND", message: "해당 의뢰를 찾을 수 없습니다." };
  }

  const message =
    existing.status === "CONVERTING"
      ? "다른 사람이 지금 접수로 만들고 있습니다."
      : existing.status === "CONVERTED"
        ? "이미 접수로 만들어진 의뢰입니다."
        : "이미 반려된 의뢰입니다.";

  return { ok: false, code: "ALREADY_TAKEN", message };
}

/**
 * 접수가 만들어졌다. 의뢰를 그 접수에 묶고 끝낸다.
 *
 * **아직 처리되지 않은 의뢰만 바꾼다.** 그사이 다른 사람이 접수로 만들었거나
 * 반려했다면 그 결정이 이긴다 — 덮어쓰면 먼저 만든 접수와의 연결이 조용히
 * 끊기고, 그 접수는 어느 의뢰에서 왔는지 알 수 없게 된다.
 */
export async function markRequestConverted(params: {
  requestId: string;
  repairCaseId: string;
  actorUserId: string;
}): Promise<{ ok: boolean; message?: string }> {
  return db.transaction(async (tx) => {
    const updated = await tx
      .update(customerRepairRequests)
      .set({
        status: "CONVERTED",
        convertedRepairCaseId: params.repairCaseId,
        convertedAt: sql`now()`,
        convertedBy: params.actorUserId,
      })
      .where(
        and(
          eq(customerRepairRequests.id, params.requestId),
          // CONVERTING 도 받는다 — 자리를 잡아 둔 뒤 접수를 만든 정상 흐름이다.
          sql`${customerRepairRequests.status} IN ('NEW', 'CONVERTING')`
        )
      )
      .returning({ id: customerRepairRequests.id });

    if (updated.length === 0) {
      const [existing] = await tx
        .select({ status: customerRepairRequests.status })
        .from(customerRepairRequests)
        .where(eq(customerRepairRequests.id, params.requestId));

      return {
        ok: false,
        message: !existing
          ? "해당 의뢰를 찾을 수 없습니다."
          : existing.status === "CONVERTED"
            ? "이미 다른 접수로 연결된 의뢰입니다."
            : "이미 반려된 의뢰입니다.",
      };
    }

    await insertAuditLog(tx, {
      actorUserId: params.actorUserId,
      actionType: "UPDATE",
      targetEntity: "customer_repair_requests",
      targetRecordId: params.requestId,
      newValue: { status: "CONVERTED", repairCaseId: params.repairCaseId },
    });

    return { ok: true };
  });
}

/**
 * 접수 만들기가 실패했다. 잡아 둔 자리를 놓아 준다.
 *
 * `WHERE status='CONVERTING'` 을 붙이는 이유: 그사이 누군가 반려했다면 그
 * 결정을 덮어쓰면 안 된다.
 */
export async function releaseRequestClaim(requestId: string): Promise<void> {
  await db
    .update(customerRepairRequests)
    .set({ status: "NEW" })
    .where(
      and(
        eq(customerRepairRequests.id, requestId),
        eq(customerRepairRequests.status, "CONVERTING")
      )
    );
}

/** 접수로 만들지 않기로 했다. 지우지 않고 사유와 함께 남긴다. */
export async function rejectRequest(params: {
  requestId: string;
  reason: string;
  actorUserId: string;
}): Promise<{ ok: boolean; message?: string }> {
  return db.transaction(async (tx) => {
    const rejected = await tx
      .update(customerRepairRequests)
      .set({
        status: "REJECTED",
        rejectedAt: sql`now()`,
        rejectedBy: params.actorUserId,
        rejectReason: params.reason,
      })
      .where(
        and(
          eq(customerRepairRequests.id, params.requestId),
          // 이미 접수가 된 것을 반려로 되돌리지 않는다 — 접수는 남아 있는데
          // 의뢰만 반려로 바뀌면 둘의 말이 어긋난다.
          eq(customerRepairRequests.status, "NEW")
        )
      )
      .returning({ id: customerRepairRequests.id });

    if (rejected.length === 0) {
      return { ok: false, message: "이미 처리된 의뢰입니다." };
    }

    await insertAuditLog(tx, {
      actorUserId: params.actorUserId,
      actionType: "UPDATE",
      targetEntity: "customer_repair_requests",
      targetRecordId: params.requestId,
      newValue: { status: "REJECTED", reason: params.reason },
    });

    return { ok: true };
  });
}
