import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../client";
import { repairCaseIdempotencyKeys } from "../schema";

/**
 * Retention window (SECURITY_POLICY.md "Idempotency Key Retention"): long
 * enough to cover double-click/network-retry/refresh, short enough to bound
 * how long response_snapshot's { repairCaseId, intakeNumber } lingers. No
 * automated sweep job exists yet — expires_at is written so one can be
 * added later without a schema change (out of scope for this task).
 */
const IDEMPOTENCY_KEY_TTL_MS = 2 * 60 * 60 * 1000;

/** Never store more than this — see the schema file's PII note. */
export type IdempotencyResponseSnapshot = {
  repairCaseId: string;
  intakeNumber: string;
};

export type IdempotencyClaimResult =
  | { state: "CLAIMED" }
  | { state: "IN_PROGRESS" }
  | { state: "SUCCEEDED"; repairCaseId: string; intakeNumber: string }
  | { state: "USER_MISMATCH" };

const MAX_CLAIM_ATTEMPTS = 3;

/**
 * Race-safe claim: three short, independent statements (not one held-open
 * transaction) so a claim survives even if the business transaction that
 * follows it fails — see resolveIdempotencyKey for the FAILED path this
 * enables. Each call either:
 *  - wins the claim (fresh key, or a FAILED key successfully reclaimed) and
 *    the caller must go on to run the actual repair-case creation, or
 *  - observes another outcome (still processing / already succeeded /
 *    belongs to a different user) and must NOT create anything.
 *
 * Bounded retry loop (not recursion) covers the narrow window where a
 * FAILED→PROCESSING reclaim race is lost to a concurrent retry; after
 * MAX_CLAIM_ATTEMPTS it fails safe by reporting IN_PROGRESS rather than
 * risking a duplicate create.
 */
export async function claimIdempotencyKey(
  idempotencyKey: string,
  requesterUserId: string
): Promise<IdempotencyClaimResult> {
  for (let attempt = 0; attempt < MAX_CLAIM_ATTEMPTS; attempt++) {
    const expiresAt = new Date(Date.now() + IDEMPOTENCY_KEY_TTL_MS);

    const inserted = await db
      .insert(repairCaseIdempotencyKeys)
      .values({
        idempotencyKey,
        requesterUserId,
        status: "PROCESSING",
        expiresAt,
      })
      .onConflictDoNothing({ target: repairCaseIdempotencyKeys.idempotencyKey })
      .returning({ idempotencyKey: repairCaseIdempotencyKeys.idempotencyKey });

    if (inserted.length > 0) {
      return { state: "CLAIMED" };
    }

    const [existing] = await db
      .select()
      .from(repairCaseIdempotencyKeys)
      .where(eq(repairCaseIdempotencyKeys.idempotencyKey, idempotencyKey));

    if (!existing) {
      // No delete path exists yet, so this should never happen — but if it
      // ever does (e.g. a future retention job raced us), retry the claim.
      continue;
    }

    if (existing.requesterUserId !== requesterUserId) {
      return { state: "USER_MISMATCH" };
    }

    if (existing.status === "PROCESSING") {
      return { state: "IN_PROGRESS" };
    }

    if (existing.status === "SUCCEEDED") {
      const snapshot = existing.responseSnapshot as IdempotencyResponseSnapshot | null;
      if (snapshot) {
        return {
          state: "SUCCEEDED",
          repairCaseId: snapshot.repairCaseId,
          intakeNumber: snapshot.intakeNumber,
        };
      }
      // Defensive only — the DB CHECK constraint means a SUCCEEDED row
      // always has repair_case_id set, and markIdempotencyKeySucceeded
      // always writes a snapshot alongside it. Fail safe if this is ever
      // violated: never treat it as claimable.
      return { state: "IN_PROGRESS" };
    }

    // status === "FAILED": attempt an atomic reclaim so a genuine retry
    // (corrected input, transient DB error, etc.) can proceed under the
    // same key.
    const reclaimed = await db
      .update(repairCaseIdempotencyKeys)
      .set({ status: "PROCESSING", updatedAt: sql`now()`, expiresAt })
      .where(
        and(
          eq(repairCaseIdempotencyKeys.idempotencyKey, idempotencyKey),
          eq(repairCaseIdempotencyKeys.status, "FAILED")
        )
      )
      .returning({ idempotencyKey: repairCaseIdempotencyKeys.idempotencyKey });

    if (reclaimed.length > 0) {
      return { state: "CLAIMED" };
    }
    // Lost the reclaim race to a concurrent retry — loop and observe its
    // (now PROCESSING, or later SUCCEEDED/FAILED) status.
  }

  return { state: "IN_PROGRESS" };
}

/**
 * Only { repairCaseId, intakeNumber } is ever stored — no contact/PII
 * fields, per SECURITY_POLICY.md.
 */
export async function markIdempotencyKeySucceeded(
  idempotencyKey: string,
  repairCaseId: string,
  intakeNumber: string
): Promise<void> {
  const snapshot: IdempotencyResponseSnapshot = { repairCaseId, intakeNumber };
  await db
    .update(repairCaseIdempotencyKeys)
    .set({
      status: "SUCCEEDED",
      repairCaseId,
      responseSnapshot: snapshot,
      updatedAt: sql`now()`,
    })
    .where(eq(repairCaseIdempotencyKeys.idempotencyKey, idempotencyKey));
}

export async function markIdempotencyKeyFailed(idempotencyKey: string): Promise<void> {
  await db
    .update(repairCaseIdempotencyKeys)
    .set({ status: "FAILED", updatedAt: sql`now()` })
    .where(eq(repairCaseIdempotencyKeys.idempotencyKey, idempotencyKey));
}
