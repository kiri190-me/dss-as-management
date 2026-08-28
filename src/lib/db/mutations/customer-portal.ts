import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "../client";
import { insertAuditLog } from "./audit-logs";
import {
  customerPortalSyncLog,
  customerRepairLinks,
  customerRepairRequests,
  customerStatusOptions,
  repairCaseCustomerStatus,
} from "../schema";

/**
 * ============================================================================
 * 고객 안내 창구 — 기록
 * ============================================================================
 */

export type MutationResult<T = void> =
  | { ok: true; value: T }
  | { ok: false; code: "NOT_FOUND" | "CONFLICT" | "INVALID"; message: string };

const VERSION_CONFLICT_MESSAGE =
  "다른 사람이 먼저 고쳤습니다. 다시 불러온 뒤 고쳐 주세요.";

/**
 * 접수 한 건의 고객 안내 상태를 정한다.
 *
 * ■ 낙관적 잠금
 *
 * 담당자 둘이 같은 건을 동시에 고칠 때 뒤엣것이 앞엣것을 조용히 덮으면 안 된다.
 * 이 저장소가 접수 수정에서 쓰는 방식과 같다 — `WHERE id = ? AND version = ?`로
 * 고치면서 version 을 올리고, 0행이면 없어진 것인지 남이 먼저 고친 것인지를
 * 한 번 더 물어 구분한다.
 *
 * `expectedVersion`이 null 이면 "아직 행이 없다"는 뜻이라 새로 만든다. 그
 * 순간에 다른 사람이 먼저 만들었다면 unique 가 막고 CONFLICT 로 돌려준다.
 */
export async function setCustomerStatus(params: {
  repairCaseId: string;
  statusOptionId: string | null;
  note: string | null;
  expectedVersion: number | null;
  actorUserId: string;
}): Promise<MutationResult<{ version: number }>> {
  const { repairCaseId, statusOptionId, note, expectedVersion, actorUserId } =
    params;

  if (statusOptionId) {
    const [option] = await db
      .select({ id: customerStatusOptions.id })
      .from(customerStatusOptions)
      .where(
        and(
          eq(customerStatusOptions.id, statusOptionId),
          eq(customerStatusOptions.isActive, true)
        )
      );
    // 비활성으로 내린 상태를 새로 고를 수는 없다. 이미 그 값을 쓰고 있는
    // 건은 그대로 두되(비활성은 "앞으로 고르지 못한다"이다), 새로 고르는
    // 길은 막는다.
    if (!option) {
      return { ok: false, code: "INVALID", message: "사용할 수 없는 상태입니다." };
    }
  }

  return db.transaction(async (tx) => {
    if (expectedVersion === null) {
      const inserted = await tx
        .insert(repairCaseCustomerStatus)
        .values({ repairCaseId, statusOptionId, note, updatedBy: actorUserId })
        // 그사이 남이 먼저 만들었으면 조용히 넘어가고 아래에서 0행으로 잡힌다.
        .onConflictDoNothing({ target: repairCaseCustomerStatus.repairCaseId })
        .returning({ version: repairCaseCustomerStatus.version });

      if (inserted.length === 0) {
        return {
          ok: false as const,
          code: "CONFLICT" as const,
          message: VERSION_CONFLICT_MESSAGE,
        };
      }

      await insertAuditLog(tx, {
        actorUserId,
        actionType: "CREATE",
        targetEntity: "repair_case_customer_status",
        targetRecordId: repairCaseId,
        newValue: { statusOptionId, note },
      });

      return { ok: true as const, value: { version: inserted[0].version } };
    }

    const [previous] = await tx
      .select({
        statusOptionId: repairCaseCustomerStatus.statusOptionId,
        note: repairCaseCustomerStatus.note,
      })
      .from(repairCaseCustomerStatus)
      .where(eq(repairCaseCustomerStatus.repairCaseId, repairCaseId));

    const updated = await tx
      .update(repairCaseCustomerStatus)
      .set({
        statusOptionId,
        note,
        updatedBy: actorUserId,
        updatedAt: sql`now()`,
        version: sql`${repairCaseCustomerStatus.version} + 1`,
      })
      .where(
        and(
          eq(repairCaseCustomerStatus.repairCaseId, repairCaseId),
          eq(repairCaseCustomerStatus.version, expectedVersion)
        )
      )
      .returning({ version: repairCaseCustomerStatus.version });

    if (updated.length === 0) {
      // 0행은 두 가지다 — 행이 없어졌거나, 남이 먼저 고쳐 version 이 올라갔거나.
      // 구분하지 않으면 사람이 무엇을 해야 할지 모른다.
      const [stillExists] = await tx
        .select({ id: repairCaseCustomerStatus.id })
        .from(repairCaseCustomerStatus)
        .where(eq(repairCaseCustomerStatus.repairCaseId, repairCaseId));

      return {
        ok: false as const,
        code: stillExists ? ("CONFLICT" as const) : ("NOT_FOUND" as const),
        message: stillExists
          ? VERSION_CONFLICT_MESSAGE
          : "해당 기록을 찾을 수 없습니다.",
      };
    }

    await insertAuditLog(tx, {
      actorUserId,
      actionType: "UPDATE",
      targetEntity: "repair_case_customer_status",
      targetRecordId: repairCaseId,
      previousValue: previous ?? null,
      newValue: { statusOptionId, note },
    });

    return { ok: true as const, value: { version: updated[0].version } };
  });
}

/**
 * 고객사 링크를 발급한다.
 *
 * **평문 토큰은 돌려주기만 하고 저장하지 않는다.** 부르는 쪽이 화면에 한 번
 * 띄우고 밖으로 밀어 넣는다. 우리 DB에는 sha256 만 남으므로, 잃어버리면
 * 재발급뿐이고 복구는 원리상 불가능하다.
 *
 * 같은 고객사에 살아 있는 링크가 이미 있으면 그것을 먼저 회수한다 — 재발급이
 * 곧 "옛 주소를 못 쓰게 만들기"여야 유출됐을 때 한 번의 조작으로 끝난다.
 */
export async function issueCustomerLink(params: {
  customerId: string;
  tokenHash: string;
  label: string | null;
  actorUserId: string;
}): Promise<{ linkId: string; revokedPreviousId: string | null }> {
  return db.transaction(async (tx) => {
    const [previous] = await tx
      .update(customerRepairLinks)
      .set({ revokedAt: sql`now()`, revokedBy: params.actorUserId })
      .where(
        and(
          eq(customerRepairLinks.customerId, params.customerId),
          isNull(customerRepairLinks.revokedAt)
        )
      )
      .returning({ id: customerRepairLinks.id });

    const [created] = await tx
      .insert(customerRepairLinks)
      .values({
        customerId: params.customerId,
        tokenHash: params.tokenHash,
        label: params.label,
        createdBy: params.actorUserId,
      })
      .returning({ id: customerRepairLinks.id });

    await insertAuditLog(tx, {
      actorUserId: params.actorUserId,
      actionType: "CREATE",
      targetEntity: "customer_repair_links",
      targetRecordId: created.id,
      // 토큰은 남기지 않는다. 감사 로그에 남으면 저장하지 않기로 한 의미가
      // 사라진다 — 로그를 읽을 수 있는 사람이 곧 주소를 아는 사람이 된다.
      newValue: { customerId: params.customerId, label: params.label },
      previousValue: previous ? { revokedLinkId: previous.id } : null,
    });

    return { linkId: created.id, revokedPreviousId: previous?.id ?? null };
  });
}

export async function revokeCustomerLink(params: {
  linkId: string;
  actorUserId: string;
}): Promise<MutationResult> {
  return db.transaction(async (tx) => {
    const revoked = await tx
      .update(customerRepairLinks)
      .set({ revokedAt: sql`now()`, revokedBy: params.actorUserId })
      .where(
        and(
          eq(customerRepairLinks.id, params.linkId),
          isNull(customerRepairLinks.revokedAt)
        )
      )
      .returning({ id: customerRepairLinks.id });

    if (revoked.length === 0) {
      return {
        ok: false as const,
        code: "NOT_FOUND" as const,
        message: "이미 회수되었거나 없는 링크입니다.",
      };
    }

    await insertAuditLog(tx, {
      actorUserId: params.actorUserId,
      actionType: "UPDATE",
      targetEntity: "customer_repair_links",
      targetRecordId: params.linkId,
      newValue: { revoked: true },
    });

    return { ok: true as const, value: undefined };
  });
}

/**
 * 밖에서 당겨온 의뢰를 넣는다.
 *
 * 이미 있는 `sourceId`는 조용히 넘어간다 — 당겨오기는 "받았다"고 알려주기 전에
 * 죽으면 같은 건을 다시 받게 만들어져 있고(잃는 것보다 겹치는 편이 낫다),
 * 그 겹침을 여기서 흡수한다. 그래서 스크립트를 몇 번을 돌려도 안전하다.
 *
 * 넣은 개수가 아니라 **실제로 새로 들어간 id 목록**을 돌려준다. 부르는 쪽이
 * "몇 건이 새로 왔다"를 정확히 말할 수 있어야 하기 때문이다.
 */
export async function insertPulledRequests(
  rows: (typeof customerRepairRequests.$inferInsert)[]
): Promise<string[]> {
  if (rows.length === 0) return [];

  const inserted = await db
    .insert(customerRepairRequests)
    .values(rows)
    .onConflictDoNothing({ target: customerRepairRequests.sourceId })
    .returning({ sourceId: customerRepairRequests.sourceId });

  return inserted.map((row) => row.sourceId);
}

/** 밖으로 내보낸 기록. 화면이 "마지막으로 언제 나갔나"를 보여주는 데 쓴다. */
export async function recordPortalSync(params: {
  customerLinkId: string;
  itemCount: number;
}): Promise<void> {
  await db.insert(customerPortalSyncLog).values(params);
}
