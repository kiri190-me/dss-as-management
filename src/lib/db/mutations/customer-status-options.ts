import "server-only";
import { and, eq, ne, sql } from "drizzle-orm";
import { db } from "../client";
import { insertAuditLog } from "./audit-logs";
import { customerStatusOptions, repairCaseCustomerStatus } from "../schema";

/**
 * 고객 안내 상태 목록 관리.
 *
 * ■ 지우지 않는다
 *
 * 이미 그 상태를 쓴 접수가 있다. 지우면 그 접수의 안내가 사라지거나 FK 가
 * 막는다. 비활성은 **"앞으로 고르지 못한다"**이지 "지난 것을 없앤다"가
 * 아니다 — 이 저장소의 exception_statuses 가 같은 판단을 하고 있다.
 */

export type OptionResult =
  | { ok: true }
  | { ok: false; code: "DUPLICATE" | "NOT_FOUND" | "IN_USE"; message: string };

export async function createStatusOption(params: {
  label: string;
  actorUserId: string;
}): Promise<OptionResult> {
  return db.transaction(async (tx) => {
    // 살아 있는 것 중 같은 이름이 있으면 막는다. 부분 unique 가 DB 에서도
    // 막지만, 오류 문구를 사람이 읽을 수 있게 여기서 먼저 본다.
    const [duplicate] = await tx
      .select({ id: customerStatusOptions.id })
      .from(customerStatusOptions)
      .where(
        and(
          eq(customerStatusOptions.label, params.label),
          eq(customerStatusOptions.isActive, true)
        )
      );

    if (duplicate) {
      return {
        ok: false as const,
        code: "DUPLICATE" as const,
        message: "같은 이름의 상태가 이미 있습니다.",
      };
    }

    // 맨 뒤에 놓는다. 순서는 나중에 화면에서 고친다.
    const [{ maxOrder }] = await tx
      .select({
        maxOrder: sql<number>`coalesce(max(${customerStatusOptions.displayOrder}), 0)`,
      })
      .from(customerStatusOptions);

    const [created] = await tx
      .insert(customerStatusOptions)
      .values({
        label: params.label,
        displayOrder: maxOrder + 10,
        createdBy: params.actorUserId,
        updatedBy: params.actorUserId,
      })
      .returning({ id: customerStatusOptions.id });

    await insertAuditLog(tx, {
      actorUserId: params.actorUserId,
      actionType: "CREATE",
      targetEntity: "customer_status_options",
      targetRecordId: created.id,
      newValue: { label: params.label },
    });

    return { ok: true as const };
  });
}

export async function updateStatusOption(params: {
  id: string;
  label?: string;
  isActive?: boolean;
  displayOrder?: number;
  actorUserId: string;
}): Promise<OptionResult> {
  return db.transaction(async (tx) => {
    const [previous] = await tx
      .select({
        label: customerStatusOptions.label,
        isActive: customerStatusOptions.isActive,
        displayOrder: customerStatusOptions.displayOrder,
      })
      .from(customerStatusOptions)
      .where(eq(customerStatusOptions.id, params.id));

    if (!previous) {
      return {
        ok: false as const,
        code: "NOT_FOUND" as const,
        message: "해당 상태를 찾을 수 없습니다.",
      };
    }

    const nextLabel = params.label ?? previous.label;
    const nextActive = params.isActive ?? previous.isActive;

    // 살아 있는 이름끼리만 겹치면 안 된다. 비활성으로 내린 이름은 다시 쓸 수
    // 있어야 한다.
    if (nextActive) {
      const [duplicate] = await tx
        .select({ id: customerStatusOptions.id })
        .from(customerStatusOptions)
        .where(
          and(
            eq(customerStatusOptions.label, nextLabel),
            eq(customerStatusOptions.isActive, true),
            ne(customerStatusOptions.id, params.id)
          )
        );
      if (duplicate) {
        return {
          ok: false as const,
          code: "DUPLICATE" as const,
          message: "같은 이름의 상태가 이미 있습니다.",
        };
      }
    }

    await tx
      .update(customerStatusOptions)
      .set({
        label: nextLabel,
        isActive: nextActive,
        displayOrder: params.displayOrder ?? previous.displayOrder,
        updatedBy: params.actorUserId,
        updatedAt: sql`now()`,
      })
      .where(eq(customerStatusOptions.id, params.id));

    await insertAuditLog(tx, {
      actorUserId: params.actorUserId,
      actionType: "UPDATE",
      targetEntity: "customer_status_options",
      targetRecordId: params.id,
      previousValue: previous,
      newValue: { label: nextLabel, isActive: nextActive },
    });

    return { ok: true as const };
  });
}

/**
 * 지금 이 상태를 쓰고 있는 접수가 몇 건인가 — 설정 화면이 비활성 단추 옆에
 * 보여 준다.
 *
 * 비활성으로 내려도 그 건들의 안내는 그대로 남는다. 사람이 그 사실을 알고
 * 누를 수 있어야 "왜 아직 저 말이 보이지?"가 생기지 않는다.
 */
export async function countCasesUsingStatusOption(
  optionId: string
): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(repairCaseCustomerStatus)
    .where(eq(repairCaseCustomerStatus.statusOptionId, optionId));
  return row?.count ?? 0;
}
