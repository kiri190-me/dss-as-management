import "server-only";
import { and, eq, ne } from "drizzle-orm";
import { db } from "../client";
import { customers, endUserContacts, endUsers } from "../schema";
import { isExactNormalizedMatch } from "@/lib/domain/entity-name-match";

function hasPgCode(err: unknown, code: string): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === code
  );
}

/** Same reasoning/precedent as customers.ts's own isUniqueViolation. */
function isUniqueViolation(err: unknown): boolean {
  if (hasPgCode(err, "23505")) return true;
  const cause = err instanceof Error ? err.cause : undefined;
  return hasPgCode(cause, "23505");
}

export type CreateEndUserResultCode = "NOT_FOUND" | "VALIDATION_ERROR";

export type CreateEndUserResult =
  | { ok: true; id: string; name: string; updatedAt: string }
  | { ok: false; code: CreateEndUserResultCode; fieldErrors?: Record<string, string>; message: string };

/**
 * Direct End-User creation from /customers/[id] (Customer Management —
 * End-User + multi-contact management checkpoint). A second entry point to
 * the exact same duplicate-protection rule resolveOrCreateEndUserByName
 * (repair-cases.ts, intake/edit's free-entry combobox) already enforces —
 * both a pre-insert JS scan via isExactNormalizedMatch, scoped to this
 * customer, and a catch-unique-violation fallback for the race where two
 * concurrent creates under the same customer collide on the same
 * normalized name (end_users_customer_normalized_name_unique).
 */
export async function createEndUser(params: {
  customerId: string;
  name: string;
}): Promise<CreateEndUserResult> {
  return db.transaction(async (tx) => {
    const [customer] = await tx
      .select({ id: customers.id })
      .from(customers)
      .where(and(eq(customers.id, params.customerId), eq(customers.isDeleted, false)));
    if (!customer) {
      return { ok: false, code: "NOT_FOUND", message: "해당 고객사를 찾을 수 없습니다." };
    }

    const active = await tx
      .select({ id: endUsers.id, name: endUsers.name })
      .from(endUsers)
      .where(and(eq(endUsers.customerId, params.customerId), eq(endUsers.isDeleted, false)));
    const duplicate = active.find((eu) => isExactNormalizedMatch(eu.name, params.name));
    if (duplicate) {
      return {
        ok: false,
        code: "VALIDATION_ERROR",
        fieldErrors: { name: "이미 존재하는 End-User명입니다." },
        message: "입력값을 확인해 주세요.",
      };
    }

    try {
      const [created] = await tx
        .insert(endUsers)
        .values({ customerId: params.customerId, name: params.name })
        .returning({ id: endUsers.id, name: endUsers.name, updatedAt: endUsers.updatedAt });
      return { ok: true, id: created.id, name: created.name, updatedAt: created.updatedAt.toISOString() };
    } catch (err) {
      if (isUniqueViolation(err)) {
        return {
          ok: false,
          code: "VALIDATION_ERROR",
          fieldErrors: { name: "이미 존재하는 End-User명입니다." },
          message: "입력값을 확인해 주세요.",
        };
      }
      throw err;
    }
  });
}

export type RenameEndUserResultCode = "NOT_FOUND" | "CONFLICT" | "VALIDATION_ERROR";

export type RenameEndUserResult =
  | { ok: true; id: string; name: string; updatedAt: string }
  | { ok: false; code: RenameEndUserResultCode; fieldErrors?: Record<string, string>; message: string };

/**
 * Rename an existing End-User (SUPER_ADMIN/ADMIN only — enforced by the
 * caller, this mutation itself only knows data rules). Same
 * row-lock + expectedUpdatedAt concurrency pattern as updateCustomer, and
 * the same normalized duplicate-name check as createEndUser above, scoped
 * to the same customer and excluding this End-User's own current row.
 */
export async function renameEndUser(params: {
  endUserId: string;
  expectedUpdatedAt: string;
  name: string;
}): Promise<RenameEndUserResult> {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(endUsers)
      .where(and(eq(endUsers.id, params.endUserId), eq(endUsers.isDeleted, false)))
      .for("update");
    if (!current) {
      return { ok: false, code: "NOT_FOUND", message: "해당 End-User를 찾을 수 없습니다." };
    }
    if (current.updatedAt.toISOString() !== params.expectedUpdatedAt) {
      return {
        ok: false,
        code: "CONFLICT",
        message: "다른 사용자가 이 End-User 정보를 수정했습니다. 새로고침 후 다시 시도하세요.",
      };
    }

    const others = await tx
      .select({ id: endUsers.id, name: endUsers.name })
      .from(endUsers)
      .where(
        and(
          eq(endUsers.customerId, current.customerId),
          eq(endUsers.isDeleted, false),
          ne(endUsers.id, params.endUserId)
        )
      );
    const duplicate = others.find((eu) => isExactNormalizedMatch(eu.name, params.name));
    if (duplicate) {
      return {
        ok: false,
        code: "VALIDATION_ERROR",
        fieldErrors: { name: "이미 존재하는 End-User명입니다." },
        message: "입력값을 확인해 주세요.",
      };
    }

    try {
      const [updated] = await tx
        .update(endUsers)
        .set({ name: params.name, updatedAt: new Date() })
        .where(eq(endUsers.id, params.endUserId))
        .returning({ id: endUsers.id, name: endUsers.name, updatedAt: endUsers.updatedAt });
      return { ok: true, id: updated.id, name: updated.name, updatedAt: updated.updatedAt.toISOString() };
    } catch (err) {
      if (isUniqueViolation(err)) {
        return {
          ok: false,
          code: "VALIDATION_ERROR",
          fieldErrors: { name: "이미 존재하는 End-User명입니다." },
          message: "입력값을 확인해 주세요.",
        };
      }
      throw err;
    }
  });
}

export type CreateEndUserContactResult =
  | { ok: true; id: string; contactName: string; contactEmail: string | null; updatedAt: string }
  | { ok: false; code: "NOT_FOUND"; message: string };

/** No duplicate-name protection here, unlike customers/end_users — multiple contacts sharing a name (e.g. a common name) is not the "same master identity" concern that motivates the customer/End-User unique index; no such constraint was part of the approved design. */
export async function createEndUserContact(params: {
  endUserId: string;
  contactName: string;
  contactEmail: string | null;
}): Promise<CreateEndUserContactResult> {
  return db.transaction(async (tx) => {
    const [endUser] = await tx
      .select({ id: endUsers.id })
      .from(endUsers)
      .where(and(eq(endUsers.id, params.endUserId), eq(endUsers.isDeleted, false)));
    if (!endUser) {
      return { ok: false, code: "NOT_FOUND", message: "해당 End-User를 찾을 수 없습니다." };
    }

    const [created] = await tx
      .insert(endUserContacts)
      .values({ endUserId: params.endUserId, contactName: params.contactName, contactEmail: params.contactEmail })
      .returning({
        id: endUserContacts.id,
        contactName: endUserContacts.contactName,
        contactEmail: endUserContacts.contactEmail,
        updatedAt: endUserContacts.updatedAt,
      });
    return {
      ok: true,
      id: created.id,
      contactName: created.contactName,
      contactEmail: created.contactEmail,
      updatedAt: created.updatedAt.toISOString(),
    };
  });
}

export type UpdateEndUserContactResultCode = "NOT_FOUND" | "CONFLICT";

export type UpdateEndUserContactResult =
  | { ok: true; id: string; contactName: string; contactEmail: string | null; updatedAt: string }
  | { ok: false; code: UpdateEndUserContactResultCode; message: string };

export async function updateEndUserContact(params: {
  contactId: string;
  expectedUpdatedAt: string;
  contactName: string;
  contactEmail: string | null;
}): Promise<UpdateEndUserContactResult> {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(endUserContacts)
      .where(and(eq(endUserContacts.id, params.contactId), eq(endUserContacts.isDeleted, false)))
      .for("update");
    if (!current) {
      return { ok: false, code: "NOT_FOUND", message: "해당 담당자를 찾을 수 없습니다." };
    }
    if (current.updatedAt.toISOString() !== params.expectedUpdatedAt) {
      return {
        ok: false,
        code: "CONFLICT",
        message: "다른 사용자가 이 담당자 정보를 수정했습니다. 새로고침 후 다시 시도하세요.",
      };
    }

    const [updated] = await tx
      .update(endUserContacts)
      .set({ contactName: params.contactName, contactEmail: params.contactEmail, updatedAt: new Date() })
      .where(eq(endUserContacts.id, params.contactId))
      .returning({
        id: endUserContacts.id,
        contactName: endUserContacts.contactName,
        contactEmail: endUserContacts.contactEmail,
        updatedAt: endUserContacts.updatedAt,
      });
    return {
      ok: true,
      id: updated.id,
      contactName: updated.contactName,
      contactEmail: updated.contactEmail,
      updatedAt: updated.updatedAt.toISOString(),
    };
  });
}

export type RemoveEndUserContactResultCode = "NOT_FOUND" | "CONFLICT";

export type RemoveEndUserContactResult =
  | { ok: true }
  | { ok: false; code: RemoveEndUserContactResultCode; message: string };

/**
 * Soft-delete only (SUPER_ADMIN/ADMIN only — enforced by the caller) — no
 * restore/trash UI ships in this checkpoint, same "schema-ready, UI
 * deferred" state customers/end_users are already in. Never touches
 * repair_cases.contact*_snapshot — this table has no relationship to
 * repair_cases at all.
 */
export async function removeEndUserContact(params: {
  contactId: string;
  expectedUpdatedAt: string;
  actorUserId: string;
}): Promise<RemoveEndUserContactResult> {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(endUserContacts)
      .where(and(eq(endUserContacts.id, params.contactId), eq(endUserContacts.isDeleted, false)))
      .for("update");
    if (!current) {
      return { ok: false, code: "NOT_FOUND", message: "해당 담당자를 찾을 수 없습니다." };
    }
    if (current.updatedAt.toISOString() !== params.expectedUpdatedAt) {
      return {
        ok: false,
        code: "CONFLICT",
        message: "다른 사용자가 이 담당자 정보를 수정했습니다. 새로고침 후 다시 시도하세요.",
      };
    }

    await tx
      .update(endUserContacts)
      .set({ isDeleted: true, deletedAt: new Date(), deletedBy: params.actorUserId, updatedAt: new Date() })
      .where(eq(endUserContacts.id, params.contactId));
    return { ok: true };
  });
}
