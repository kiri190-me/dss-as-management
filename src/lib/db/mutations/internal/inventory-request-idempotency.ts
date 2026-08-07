import "server-only";
import { eq } from "drizzle-orm";
import { inventoryPartRequestIdempotencyKeys } from "../../schema";
import type { Tx } from "../procedure-templates";
import { IDEMPOTENCY_KEY_TTL_MS } from "../idempotency-keys";
import type { InventoryPartRequestIdempotencyOperation } from "@/lib/domain/inventory-types";

/**
 * Phase 5B-3's atomic idempotency claim — transaction-aware, unlike
 * db/mutations/idempotency-keys.ts's claimIdempotencyKey/
 * markIdempotencyKeySucceeded/markIdempotencyKeyFailed, which all execute
 * directly against the module-level `db` and therefore cannot participate
 * in a caller-owned transaction. That existing repair-case pattern is left
 * entirely unchanged by this file.
 *
 * The whole point here: claim + business writes + success-finalize all
 * happen in ONE transaction (see inventory-part-requests.ts's five
 * mutations), so there is no possible window where business rows are
 * durable but the idempotency record isn't (or vice versa). A direct
 * consequence: under this design, a row in inventory_part_request_idempotency_keys
 * is only ever durably observable as SUCCEEDED, or not present at all.
 * PROCESSING only ever exists inside the owning (not-yet-committed)
 * transaction — no other transaction can see it (standard READ COMMITTED
 * visibility), and FAILED is never written at all: any failure (a thrown
 * business-validation error, or a hard crash) rolls back the ENTIRE
 * transaction, including this claim row's own INSERT, so nothing is left
 * behind to "reclaim" — the key is simply free again for an immediate
 * retry. This is a deliberately stronger guarantee than the existing
 * repair-case table (which can leave a row genuinely stuck in PROCESSING
 * forever if the process dies between claim and markSucceeded/
 * markIdempotencyKeyFailed — confirmed by inspection, see the Phase 5B-3
 * design report).
 *
 * Concurrency: `INSERT ... ON CONFLICT (idempotency_key) DO NOTHING` makes
 * a second concurrent inserter of the same key WAIT for the first to
 * commit or roll back before resolving the conflict — this is what gives
 * "one executes, the other observes the committed result" for free, no
 * extra locking required. By the time this function's INSERT returns 0
 * rows, whatever row exists (if any) is already fully committed and
 * terminal, so the fallback SELECT below needs no lock.
 */

export type IdempotencyClaimOrReplayResult<TSnapshot> =
  | { state: "CLAIMED" }
  | { state: "REPLAY"; snapshot: TSnapshot }
  | { state: "USER_MISMATCH" }
  | { state: "OPERATION_MISMATCH" }
  | { state: "PAYLOAD_MISMATCH" }
  | { state: "UNRESOLVED" };

const MAX_CLAIM_ATTEMPTS = 3;

export async function claimOrReplayIdempotency<TSnapshot = unknown>(
  tx: Tx,
  params: {
    idempotencyKey: string;
    actorUserId: string;
    operationType: InventoryPartRequestIdempotencyOperation;
    fingerprint: string;
  }
): Promise<IdempotencyClaimOrReplayResult<TSnapshot>> {
  for (let attempt = 0; attempt < MAX_CLAIM_ATTEMPTS; attempt++) {
    const expiresAt = new Date(Date.now() + IDEMPOTENCY_KEY_TTL_MS);

    const inserted = await tx
      .insert(inventoryPartRequestIdempotencyKeys)
      .values({
        idempotencyKey: params.idempotencyKey,
        requesterUserId: params.actorUserId,
        operationType: params.operationType,
        status: "PROCESSING",
        requestFingerprint: params.fingerprint,
        expiresAt,
      })
      .onConflictDoNothing({ target: inventoryPartRequestIdempotencyKeys.idempotencyKey })
      .returning({ idempotencyKey: inventoryPartRequestIdempotencyKeys.idempotencyKey });

    if (inserted.length > 0) {
      return { state: "CLAIMED" };
    }

    const [existing] = await tx
      .select()
      .from(inventoryPartRequestIdempotencyKeys)
      .where(eq(inventoryPartRequestIdempotencyKeys.idempotencyKey, params.idempotencyKey));

    if (!existing) {
      // The conflicting attempt's transaction rolled back between our
      // INSERT and this SELECT — under Postgres's own conflict-wait
      // semantics this is not expected to happen (a losing rollback would
      // have let our own INSERT through instead), but loop and retry
      // defensively rather than assume a claim without ever inserting.
      continue;
    }

    if (existing.requesterUserId !== params.actorUserId) return { state: "USER_MISMATCH" };
    if (existing.operationType !== params.operationType) return { state: "OPERATION_MISMATCH" };
    if (existing.requestFingerprint !== params.fingerprint) return { state: "PAYLOAD_MISMATCH" };

    // User/operation/fingerprint all match — under the atomic design this
    // row can only ever be durably SUCCEEDED (see module doc comment).
    return { state: "REPLAY", snapshot: existing.responseSnapshot as TSnapshot };
  }

  // Exhausted retries on a narrow, repeated race — fail safe rather than
  // risk a duplicate business execution.
  return { state: "UNRESOLVED" };
}

/** Same transaction as claimOrReplayIdempotency and every business write — never a separate commit. */
export async function finalizeIdempotencySuccess(tx: Tx, idempotencyKey: string, requestId: string, snapshot: unknown): Promise<void> {
  await tx
    .update(inventoryPartRequestIdempotencyKeys)
    .set({ status: "SUCCEEDED", requestId, responseSnapshot: snapshot, updatedAt: new Date() })
    .where(eq(inventoryPartRequestIdempotencyKeys.idempotencyKey, idempotencyKey));
}
