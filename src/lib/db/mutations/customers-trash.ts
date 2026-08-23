import "server-only";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { db } from "../client";
import { customers, endUserContacts, endUsers, repairCases } from "../schema";
import { insertAuditLog } from "./audit-logs";
import { isExactNormalizedMatch } from "@/lib/domain/entity-name-match";

/**
 * ============================================================================
 * 고객사 삭제 — 휴지통 → 15일 → 완전삭제 (승인된 체크포인트)
 * ============================================================================
 * 접수 건 휴지통(repair-cases.ts의 softDelete/restore/permanentlyDelete)과
 * 같은 3단계이고, 같은 규율을 따른다: 대상 행을 잠그고, 기대값으로 낙관적
 * 동시성을 검사하고, 0행 쓰기를 조용히 성공으로 넘기지 않고, 같은 트랜잭션
 * 안에서 감사 로그를 남긴다.
 *
 * ── 접수 건이 하나라도 있으면 삭제하지 않는다 ───────────────────────────
 * repair_cases.customer_id는 ON DELETE RESTRICT다. 참조가 남은 채로
 * 휴지통에 넣으면 15일 뒤 완전삭제가 DB에서 거부되고, 그 고객사는 "지운 줄
 * 알았는데 영원히 휴지통에 남아 있는" 상태가 된다. 그래서 지울 수 없는
 * 것은 처음부터 휴지통에도 넣지 않는다 — 실패를 15일 뒤로 미루는 대신
 * 지금 이유를 말한다.
 *
 * 세는 대상은 삭제된 접수 건까지 포함한 전부다. FK는 is_deleted를 보지
 * 않으므로, 휴지통에 있는 접수 건 하나도 완전삭제를 막기에 충분하다.
 *
 * ── End-User와 담당자는 함께 딸려 간다 ──────────────────────────────────
 * End-User는 고객사 아래에서만 의미가 있고(end_users.customer_id는 NOT
 * NULL), 담당자는 다시 End-User 아래에서만 의미가 있다. 부모만 지우고
 * 자식을 남기면 어느 화면에서도 도달할 수 없는 행이 남는다. 그래서 삭제·
 * 복원·완전삭제 셋 다 담당자 → End-User → 고객사 순으로 함께 움직인다
 * (완전삭제의 이 순서는 취향이 아니라 FK RESTRICT가 강제하는 순서다).
 *
 * ── 복원은 '이번 삭제로 딸려 간 것'만 되살린다 ──────────────────────────
 * 고객사를 지우기 전에 이미 따로 삭제돼 있던 End-User는 복원 대상이 아니다.
 * 그걸 구분하는 방법이 deleted_at이다 — 한 트랜잭션에서 고객사와 딸려 가는
 * 자식들에게 같은 순간을 찍고, 복원은 고객사의 deleted_at과 정확히 같은
 * 자식만 되살린다. '어떻게 지워졌는지'를 담는 컬럼을 새로 만들지 않고 이미
 * 있는 값으로 답할 수 있는 질문이다.
 *
 * ── 복원은 이름 자리가 다시 비어 있을 때만 된다 ─────────────────────────
 * customers_normalized_name_unique는 is_deleted = false인 행에만 걸리는
 * 부분 인덱스다. 즉 휴지통에 있는 동안 같은 이름의 고객사가 새로 생길 수
 * 있고, 그 상태로 복원하면 유니크 위반이 난다. 복원 전에 검사하고, 그
 * 사이의 경쟁까지 잡도록 23505도 함께 받는다 — updateCustomer가 이름 수정에
 * 대해 이미 쓰고 있는 두 겹 방어와 같다.
 *
 * ── 감사 로그에 연락처는 넣지 않는다 ────────────────────────────────────
 * customers.contact_name/contact_email/contact_phone과 담당자
 * (end_user_contacts)의 이름·이메일은 개인정보다. repair_cases의 연락처
 * 스냅샷이 audit_logs.previous_value에 절대 들어가지 않는 것과 같은 규칙으로
 * 여기서도 스냅샷에서 뺀다. 그래서 담당자는 행별 감사 로그를 남기지
 * 않는다 — 남길 수 있는 것이 id뿐이라 기록으로서 의미가 없다. 대신 몇 건이
 * 함께 움직였는지를 고객사 쪽 감사 로그에 적는다.
 * ============================================================================
 */

export type CustomerTrashResultCode = "NOT_FOUND" | "CONFLICT" | "REFERENCED" | "NAME_TAKEN";

export type CustomerTrashResult =
  | { ok: true; id: string; endUserCount: number }
  | { ok: false; code: CustomerTrashResultCode; message: string };

const CONFLICT_MESSAGE = "다른 사용자가 이 고객사 정보를 수정했습니다. 새로고침 후 다시 시도하세요.";
const NOT_FOUND_MESSAGE = "해당 고객사를 찾을 수 없습니다.";

function nameTakenMessage(name: string): string {
  return `같은 이름의 고객사(${name})가 이미 있어 복원할 수 없습니다. 기존 고객사의 이름을 바꾼 뒤 다시 시도하세요.`;
}

function referencedMessage(count: number): string {
  return `이 고객사에 연결된 A/S 접수 건이 ${count}건 있어 삭제할 수 없습니다. 휴지통에 있는 접수 건도 포함됩니다.`;
}

function hasPgCode(err: unknown, code: string): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code?: unknown }).code === code;
}

/** drizzle이 드라이버 오류를 자기 클래스로 감싸므로 cause까지 본다(customers.ts와 동일). */
function isUniqueViolation(err: unknown): boolean {
  if (hasPgCode(err, "23505")) return true;
  const cause = err instanceof Error ? err.cause : undefined;
  return hasPgCode(cause, "23505");
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * 이 고객사를 붙잡고 있는 A/S 접수 건 수 — 삭제된 접수 건도 포함한다.
 *
 * customer_id로 직접 걸린 것과, 이 고객사의 End-User를 통해 걸린 것을 모두
 * 센다. 정상 데이터라면 뒤쪽은 앞쪽의 부분집합이지만, 완전삭제가 실패할 수
 * 있는 경로를 하나라도 검사에서 빠뜨리면 그 실패는 15일 뒤에 아무도 보지
 * 않는 자동 정리 로그 안에서 일어난다.
 */
async function countReferencingRepairCases(tx: Tx, customerId: string, endUserIds: string[]): Promise<number> {
  const [direct] = await tx
    .select({ total: sql<number>`count(*)::int` })
    .from(repairCases)
    .where(eq(repairCases.customerId, customerId));

  if (endUserIds.length === 0) return direct.total;

  const [viaEndUser] = await tx
    .select({ total: sql<number>`count(*)::int` })
    .from(repairCases)
    .where(and(inArray(repairCases.endUserId, endUserIds), ne(repairCases.customerId, customerId)));

  return direct.total + viaEndUser.total;
}

/**
 * 고객사를 휴지통으로 보낸다. End-User와 그 담당자도 같은 순간으로 함께
 * 잠긴다. 접수 건이 하나라도 걸려 있으면 아무것도 바꾸지 않고 REFERENCED로
 * 돌려준다.
 */
export async function softDeleteCustomer(params: {
  customerId: string;
  expectedUpdatedAt: string;
  actorUserId: string;
  reason: string | null;
}): Promise<CustomerTrashResult> {
  return db.transaction(async (tx): Promise<CustomerTrashResult> => {
    const [current] = await tx
      .select({
        id: customers.id,
        name: customers.name,
        createdAt: customers.createdAt,
        updatedAt: customers.updatedAt,
        // contact_name/contact_email/contact_phone은 일부러 고르지 않는다 —
        // 개인정보이므로 audit_logs.previous_value에 닿으면 안 된다.
      })
      .from(customers)
      .where(and(eq(customers.id, params.customerId), eq(customers.isDeleted, false)))
      .for("update");

    if (!current) return { ok: false, code: "NOT_FOUND", message: NOT_FOUND_MESSAGE };
    if (current.updatedAt.toISOString() !== params.expectedUpdatedAt) {
      return { ok: false, code: "CONFLICT", message: CONFLICT_MESSAGE };
    }

    const ownEndUsers = await tx
      .select({ id: endUsers.id, name: endUsers.name, isDeleted: endUsers.isDeleted })
      .from(endUsers)
      .where(eq(endUsers.customerId, params.customerId))
      .for("update");

    const referencing = await countReferencingRepairCases(
      tx,
      params.customerId,
      ownEndUsers.map((endUser) => endUser.id)
    );
    if (referencing > 0) {
      return { ok: false, code: "REFERENCED", message: referencedMessage(referencing) };
    }

    // 고객사와 딸려 가는 자식 전부가 이 한 순간을 공유한다 — 복원이 '이번
    // 삭제로 딸려 간 것'을 알아보는 유일한 근거다(파일 상단 주석 참조).
    const deletedAt = new Date();
    const deletion = {
      isDeleted: true as const,
      deletedAt,
      deletedBy: params.actorUserId,
      deleteReason: params.reason,
      updatedAt: deletedAt,
    };

    const cascaded = ownEndUsers.filter((endUser) => !endUser.isDeleted);
    const cascadedIds = cascaded.map((endUser) => endUser.id);

    let contactCount = 0;
    if (cascadedIds.length > 0) {
      const contactRows = await tx
        .update(endUserContacts)
        .set(deletion)
        .where(and(inArray(endUserContacts.endUserId, cascadedIds), eq(endUserContacts.isDeleted, false)))
        .returning({ id: endUserContacts.id });
      contactCount = contactRows.length;

      await tx.update(endUsers).set(deletion).where(inArray(endUsers.id, cascadedIds));

      for (const endUser of cascaded) {
        await insertAuditLog(tx, {
          actorUserId: params.actorUserId,
          actionType: "SOFT_DELETE",
          targetEntity: "end_users",
          targetRecordId: endUser.id,
          previousValue: { id: endUser.id, customerId: params.customerId, name: endUser.name },
          newValue: {
            isDeleted: true,
            deletedAt: deletedAt.toISOString(),
            cascadedFromCustomerId: params.customerId,
          },
        });
      }
    }

    const updated = await tx
      .update(customers)
      .set(deletion)
      .where(and(eq(customers.id, params.customerId), eq(customers.isDeleted, false)))
      .returning({ id: customers.id });

    if (updated.length === 0) {
      // SELECT ... FOR UPDATE로 행을 잡고 있어 실제로는 닿지 않는 가지지만,
      // 0행 쓰기를 조용히 성공으로 넘기지 않는다는 규율은 그대로 지킨다.
      return { ok: false, code: "NOT_FOUND", message: NOT_FOUND_MESSAGE };
    }

    await insertAuditLog(tx, {
      actorUserId: params.actorUserId,
      actionType: "SOFT_DELETE",
      targetEntity: "customers",
      targetRecordId: params.customerId,
      previousValue: { id: current.id, name: current.name, createdAt: current.createdAt.toISOString() },
      newValue: {
        isDeleted: true,
        deletedAt: deletedAt.toISOString(),
        deleteReason: params.reason,
        // 함께 딸려 간 것들. 담당자는 개인정보라 행별 로그를 남기지 않으므로
        // (파일 상단 주석) 이 숫자가 그 사실의 유일한 기록이다.
        cascadedEndUserIds: cascadedIds,
        cascadedContactCount: contactCount,
      },
    });

    return { ok: true, id: params.customerId, endUserCount: cascadedIds.length };
  });
}

/**
 * 휴지통의 고객사를 되살린다. 같은 순간에 딸려 갔던 End-User·담당자도 같이
 * 돌아온다. 그 사이 같은 이름의 고객사가 새로 생겼으면 NAME_TAKEN이다.
 */
export async function restoreCustomer(params: {
  customerId: string;
  expectedUpdatedAt: string;
  actorUserId: string;
}): Promise<CustomerTrashResult> {
  return db.transaction(async (tx): Promise<CustomerTrashResult> => {
    const [current] = await tx
      .select({
        id: customers.id,
        name: customers.name,
        updatedAt: customers.updatedAt,
        deletedAt: customers.deletedAt,
      })
      .from(customers)
      .where(and(eq(customers.id, params.customerId), eq(customers.isDeleted, true)))
      .for("update");

    if (!current) return { ok: false, code: "NOT_FOUND", message: NOT_FOUND_MESSAGE };
    if (current.updatedAt.toISOString() !== params.expectedUpdatedAt) {
      return { ok: false, code: "CONFLICT", message: CONFLICT_MESSAGE };
    }

    const others = await tx
      .select({ id: customers.id, name: customers.name })
      .from(customers)
      .where(eq(customers.isDeleted, false));
    if (others.some((other) => isExactNormalizedMatch(other.name, current.name))) {
      return { ok: false, code: "NAME_TAKEN", message: nameTakenMessage(current.name) };
    }

    // deleted_at을 지우기 전에 대상을 먼저 확정한다 — 지운 뒤에는 '이번
    // 삭제로 딸려 간 것'을 알아볼 근거가 사라진다.
    const cascadedEndUsers = current.deletedAt
      ? await tx
          .select({ id: endUsers.id, name: endUsers.name })
          .from(endUsers)
          .where(
            and(
              eq(endUsers.customerId, params.customerId),
              eq(endUsers.isDeleted, true),
              eq(endUsers.deletedAt, current.deletedAt)
            )
          )
          .for("update")
      : [];

    const restoration = {
      isDeleted: false as const,
      deletedAt: null,
      deletedBy: null,
      deleteReason: null,
      updatedAt: new Date(),
    };

    try {
      if (cascadedEndUsers.length > 0 && current.deletedAt) {
        const cascadedIds = cascadedEndUsers.map((endUser) => endUser.id);
        await tx
          .update(endUserContacts)
          .set(restoration)
          .where(
            and(
              inArray(endUserContacts.endUserId, cascadedIds),
              eq(endUserContacts.isDeleted, true),
              eq(endUserContacts.deletedAt, current.deletedAt)
            )
          );
        await tx.update(endUsers).set(restoration).where(inArray(endUsers.id, cascadedIds));

        for (const endUser of cascadedEndUsers) {
          await insertAuditLog(tx, {
            actorUserId: params.actorUserId,
            actionType: "RESTORE",
            targetEntity: "end_users",
            targetRecordId: endUser.id,
            previousValue: null,
            newValue: { id: endUser.id, customerId: params.customerId, name: endUser.name, isDeleted: false },
          });
        }
      }

      const updated = await tx
        .update(customers)
        .set(restoration)
        .where(and(eq(customers.id, params.customerId), eq(customers.isDeleted, true)))
        .returning({ id: customers.id });

      if (updated.length === 0) return { ok: false, code: "NOT_FOUND", message: NOT_FOUND_MESSAGE };

      await insertAuditLog(tx, {
        actorUserId: params.actorUserId,
        actionType: "RESTORE",
        targetEntity: "customers",
        targetRecordId: params.customerId,
        previousValue: null,
        newValue: {
          id: current.id,
          name: current.name,
          isDeleted: false,
          restoredEndUserIds: cascadedEndUsers.map((endUser) => endUser.id),
        },
      });

      return { ok: true, id: params.customerId, endUserCount: cascadedEndUsers.length };
    } catch (err) {
      // 위의 사전 검사와 이 UPDATE 사이에 같은 이름이 활성으로 들어온 경쟁.
      // 부분 유니크 인덱스가 최종 방어선이고, 여기서 사람이 읽을 수 있는
      // 말로 바꿔 준다.
      if (isUniqueViolation(err)) {
        return { ok: false, code: "NAME_TAKEN", message: nameTakenMessage(current.name) };
      }
      throw err;
    }
  });
}

/**
 * 휴지통의 고객사를 15일을 기다리지 않고 즉시 완전삭제한다. 자동 정리
 * (master-data-purge.ts)와 같은 일을 하되 사람이 행위자다.
 *
 * 삭제 순서는 취향이 아니라 FK RESTRICT가 강제한다: 담당자 → End-User →
 * 고객사.
 */
export async function permanentlyDeleteCustomer(params: {
  customerId: string;
  expectedUpdatedAt: string;
  actorUserId: string;
  reason: string;
}): Promise<CustomerTrashResult> {
  return db.transaction(async (tx): Promise<CustomerTrashResult> => {
    const [current] = await tx
      .select({
        id: customers.id,
        name: customers.name,
        createdAt: customers.createdAt,
        updatedAt: customers.updatedAt,
        deletedAt: customers.deletedAt,
        deletedBy: customers.deletedBy,
        deleteReason: customers.deleteReason,
      })
      .from(customers)
      .where(and(eq(customers.id, params.customerId), eq(customers.isDeleted, true)))
      .for("update");

    if (!current) return { ok: false, code: "NOT_FOUND", message: NOT_FOUND_MESSAGE };
    if (current.updatedAt.toISOString() !== params.expectedUpdatedAt) {
      return { ok: false, code: "CONFLICT", message: CONFLICT_MESSAGE };
    }

    const ownEndUsers = await tx
      .select({ id: endUsers.id, name: endUsers.name })
      .from(endUsers)
      .where(eq(endUsers.customerId, params.customerId))
      .for("update");
    const endUserIds = ownEndUsers.map((endUser) => endUser.id);

    // 휴지통에 넣을 때 이미 막았지만 여기서 다시 센다 — 그 사이에 이 고객사로
    // 접수 건이 새로 들어왔을 수 있고, 그때는 DB 오류로 터지는 대신 이유를
    // 말해야 한다.
    const referencing = await countReferencingRepairCases(tx, params.customerId, endUserIds);
    if (referencing > 0) {
      return { ok: false, code: "REFERENCED", message: referencedMessage(referencing) };
    }

    if (endUserIds.length > 0) {
      await tx.delete(endUserContacts).where(inArray(endUserContacts.endUserId, endUserIds));
      await tx.delete(endUsers).where(inArray(endUsers.id, endUserIds));

      for (const endUser of ownEndUsers) {
        await insertAuditLog(tx, {
          actorUserId: params.actorUserId,
          actionType: "PURGE",
          targetEntity: "end_users",
          targetRecordId: endUser.id,
          previousValue: { id: endUser.id, customerId: params.customerId, name: endUser.name },
          newValue: null,
        });
      }
    }

    const deleted = await tx
      .delete(customers)
      .where(and(eq(customers.id, params.customerId), eq(customers.isDeleted, true)))
      .returning({ id: customers.id });

    if (deleted.length === 0) return { ok: false, code: "NOT_FOUND", message: NOT_FOUND_MESSAGE };

    await insertAuditLog(tx, {
      actorUserId: params.actorUserId,
      actionType: "PURGE",
      targetEntity: "customers",
      targetRecordId: params.customerId,
      previousValue: {
        id: current.id,
        name: current.name,
        createdAt: current.createdAt.toISOString(),
        deletedAt: current.deletedAt ? current.deletedAt.toISOString() : null,
        deletedBy: current.deletedBy,
        deleteReason: current.deleteReason,
        purgedEndUserIds: endUserIds,
      },
      newValue: null,
    });

    return { ok: true, id: params.customerId, endUserCount: endUserIds.length };
  });
}
