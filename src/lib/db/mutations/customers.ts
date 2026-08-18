import "server-only";
import { and, eq, ne } from "drizzle-orm";
import { db } from "../client";
import { customers } from "../schema";
import { isExactNormalizedMatch } from "@/lib/domain/entity-name-match";

function hasPgCode(err: unknown, code: string): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === code
  );
}

/**
 * drizzle-orm wraps the driver's PostgresError in its own error class (the
 * original is on `.cause`), so the Postgres error `code` is not always on
 * the caught error itself — check both. Same reasoning/precedent as
 * repair-cases.ts's own isUniqueViolation.
 */
function isUniqueViolation(err: unknown): boolean {
  if (hasPgCode(err, "23505")) return true;
  const cause = err instanceof Error ? err.cause : undefined;
  return hasPgCode(cause, "23505");
}

export type UpdateCustomerResultCode = "NOT_FOUND" | "CONFLICT" | "VALIDATION_ERROR";

export type UpdateCustomerResult =
  | { ok: true; id: string; updatedAt: string }
  | { ok: false; code: UpdateCustomerResultCode; fieldErrors?: Record<string, string>; message: string };

/**
 * Customer master edit (Customer Management phase 1). Row-locks the target
 * (`for("update")`, same convention as repair-case-flowchart mutations),
 * re-checks `expectedUpdatedAt` for optimistic concurrency — customers has
 * no integer `version` column (unlike repair_cases), so this reuses the
 * updated_at-timestamp-comparison pattern already established for
 * repair_case_flowcharts' edit actions rather than adding a new column.
 *
 * Duplicate-name protection mirrors resolveOrCreateCustomerByName
 * (repair-cases.ts): a pre-update JS scan over active customers (excluding
 * self) using the same isExactNormalizedMatch normalization the DB's own
 * unique index (customers_normalized_name_unique) uses, PLUS a
 * catch-unique-violation fallback for the race where two edits rename
 * different customers to the same normalized name concurrently — the
 * second one to commit gets a clean VALIDATION_ERROR instead of an
 * uncaught 23505.
 *
 * repair_cases.contact*_snapshot columns are never touched here — this
 * mutation only ever writes to the customers table itself, so existing
 * per-intake contact snapshots stay exactly as recorded regardless of any
 * later customer-master contact edit (see repair-cases.ts schema comment).
 */
export async function updateCustomer(params: {
  customerId: string;
  expectedUpdatedAt: string;
  name: string;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
}): Promise<UpdateCustomerResult> {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(customers)
      .where(and(eq(customers.id, params.customerId), eq(customers.isDeleted, false)))
      .for("update");

    if (!current) {
      return { ok: false, code: "NOT_FOUND", message: "해당 고객사를 찾을 수 없습니다." };
    }

    if (current.updatedAt.toISOString() !== params.expectedUpdatedAt) {
      return {
        ok: false,
        code: "CONFLICT",
        message: "다른 사용자가 이 고객사 정보를 수정했습니다. 새로고침 후 다시 시도하세요.",
      };
    }

    const others = await tx
      .select({ id: customers.id, name: customers.name })
      .from(customers)
      .where(and(eq(customers.isDeleted, false), ne(customers.id, params.customerId)));
    const duplicate = others.find((c) => isExactNormalizedMatch(c.name, params.name));
    if (duplicate) {
      return {
        ok: false,
        code: "VALIDATION_ERROR",
        fieldErrors: { name: "이미 존재하는 고객사명입니다." },
        message: "입력값을 확인해 주세요.",
      };
    }

    try {
      const [updated] = await tx
        .update(customers)
        .set({
          name: params.name,
          contactName: params.contactName,
          contactEmail: params.contactEmail,
          contactPhone: params.contactPhone,
          updatedAt: new Date(),
        })
        .where(eq(customers.id, params.customerId))
        .returning({ id: customers.id, updatedAt: customers.updatedAt });

      return { ok: true, id: updated.id, updatedAt: updated.updatedAt.toISOString() };
    } catch (err) {
      if (isUniqueViolation(err)) {
        return {
          ok: false,
          code: "VALIDATION_ERROR",
          fieldErrors: { name: "이미 존재하는 고객사명입니다." },
          message: "입력값을 확인해 주세요.",
        };
      }
      throw err;
    }
  });
}
