import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../client";
import { insertAuditLog } from "./audit-logs";
import { customerStatusOptions, repairCaseCustomerStatus } from "../schema";

/**
 * ============================================================================
 * 고객 안내 창구 — 기록
 * ============================================================================
 *
 * 남은 것은 setCustomerStatus 하나다. 고객사 전용 주소를 발급·회수하고 밖에서
 * 당겨온 의뢰를 넣던 기록 넷(issueCustomerLink · revokeCustomerLink ·
 * insertPulledRequests · recordPortalSync)은 2026-10-04 에 걷어냈다 — 그 기능이
 * 운영에서 한 번도 돈 적이 없다. 🔴 표(`customer_repair_links` ·
 * `customer_repair_requests` · `customer_portal_sync_log`)와 그 안의 행은
 * 그대로 둔다(사용자 결정 2026-10-04).
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
 *
 * ■ 🔴 `formValues` 를 안 넘기는 것과 `{}` 를 넘기는 것은 다르다
 *
 * 고객사 양식 표에서 손으로 적는 값들이다. **넘기지 않으면(undefined) 있던
 * 값을 그대로 둔다.** 기본 9열 표의 저장은 이 값을 모르는 채로 오므로, 안
 * 넘긴 것을 "비우라"로 읽으면 담당자가 기본 보기에서 비고 한 줄을 고칠 때마다
 * 옆 보기에 적어 둔 값이 통째로 사라진다 — 아무 오류도 없이.
 * `{}` 를 넘기면 그때는 "다 지웠다"는 뜻이라 그대로 비운다.
 */
export async function setCustomerStatus(params: {
  repairCaseId: string;
  statusOptionId: string | null;
  note: string | null;
  /** 고객사 양식에서 손으로 적은 값들. `undefined` = 건드리지 않음. */
  formValues?: Record<string, string>;
  expectedVersion: number | null;
  actorUserId: string;
}): Promise<MutationResult<{ version: number }>> {
  const { repairCaseId, statusOptionId, note, formValues, expectedVersion, actorUserId } =
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
        .values({
          repairCaseId,
          statusOptionId,
          note,
          // 새로 만드는 줄에는 안 넘긴 것과 빈 것이 같다 — 어차피 없던 값이다.
          formValues: formValues ?? {},
          updatedBy: actorUserId,
        })
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
        newValue: { statusOptionId, note, formValues: formValues ?? {} },
      });

      return { ok: true as const, value: { version: inserted[0].version } };
    }

    const [previous] = await tx
      .select({
        statusOptionId: repairCaseCustomerStatus.statusOptionId,
        note: repairCaseCustomerStatus.note,
        formValues: repairCaseCustomerStatus.formValues,
      })
      .from(repairCaseCustomerStatus)
      .where(eq(repairCaseCustomerStatus.repairCaseId, repairCaseId));

    const updated = await tx
      .update(repairCaseCustomerStatus)
      .set({
        statusOptionId,
        note,
        // 🔴 안 넘겼으면 `.set()` 에 키 자체를 넣지 않는다. `formValues: undefined`
        //    를 넣어도 drizzle 이 빼 주기는 하지만, 그 사실에 기대면 다음 사람이
        //    `?? null` 한 글자를 붙이는 순간 남의 값이 지워진다.
        ...(formValues === undefined ? {} : { formValues }),
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
      // 안 넘긴 것은 안 바뀐 것이라 새 값에도 적지 않는다 — 적으면 감사 기록이
      // "이번에 비웠다"로 읽힌다.
      newValue: { statusOptionId, note, ...(formValues === undefined ? {} : { formValues }) },
    });

    return { ok: true as const, value: { version: updated[0].version } };
  });
}
