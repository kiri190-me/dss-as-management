import { createHash } from "node:crypto";
import type { InventoryPartRequestIdempotencyOperation } from "./inventory-types";
import type { NormalizedRequestItem, MergedIssueAllocation } from "./inventory-part-request-rules";

/**
 * Phase 5B-3 idempotency payload fingerprinting. The existing repair-case
 * idempotency table (db/schema/idempotency-keys.ts) has no equivalent —
 * confirmed by inspection: it replays a SUCCEEDED key unconditionally,
 * never comparing the resubmitted input against what was originally
 * claimed. This module closes that gap for the request workflow, where a
 * same-key-different-input retry (e.g. issue 3 vs. issue 5) must never be
 * silently treated as the same intent.
 *
 * Always computed server-side from the already-validated/normalized
 * payload (see inventory-part-request-rules.ts) — never trusted from the
 * client. Uses Node's synchronous crypto.createHash (this module is only
 * ever reached from server-only mutation code, unlike
 * domain/local/attachments/checksum.ts's Web-Crypto choice, which exists
 * specifically to also run in a browser-side demo context).
 *
 * Fixed, explicit key order in every object literal below — JSON.stringify
 * preserves object-insertion order, so this alone is a sufficient canonical
 * form for these fixed, well-known shapes (no general-purpose recursive
 * canonicalizer needed).
 */

export type CreateRequestFingerprintPayload = {
  repairCaseId: string;
  note: string | null;
  items: NormalizedRequestItem[]; // must already be merged + sorted by partId
};

export type IssueFingerprintPayload = {
  requestId: string;
  allocations: MergedIssueAllocation[]; // must already be merged + sorted by requestItemId, partStockBalanceId
  note: string | null;
};

export type RequestActionFingerprintPayload = {
  requestId: string;
  reason: string; // already trimmed, already validated non-blank
};

export type FingerprintPayload =
  | { operationType: "CREATE_REQUEST"; payload: CreateRequestFingerprintPayload }
  | { operationType: "ISSUE"; payload: IssueFingerprintPayload }
  | { operationType: "CANCEL" | "REJECT" | "PARTIALLY_CLOSE"; payload: RequestActionFingerprintPayload };

function canonicalJson(input: FingerprintPayload): string {
  switch (input.operationType) {
    case "CREATE_REQUEST":
      return JSON.stringify({
        operationType: input.operationType,
        repairCaseId: input.payload.repairCaseId,
        note: input.payload.note,
        items: input.payload.items.map((i) => ({ partId: i.partId, quantity: i.quantity, note: i.note })),
      });
    case "ISSUE":
      return JSON.stringify({
        operationType: input.operationType,
        requestId: input.payload.requestId,
        allocations: input.payload.allocations.map((a) => ({
          requestItemId: a.requestItemId,
          partStockBalanceId: a.partStockBalanceId,
          quantity: a.quantity,
        })),
        note: input.payload.note,
      });
    case "CANCEL":
    case "REJECT":
    case "PARTIALLY_CLOSE":
      return JSON.stringify({
        operationType: input.operationType,
        requestId: input.payload.requestId,
        reason: input.payload.reason,
      });
  }
}

/** SHA-256 hex digest of the canonical payload. Deterministic: same normalized input -> same fingerprint, regardless of original submission order. */
export function computeRequestFingerprint(input: FingerprintPayload): string {
  return createHash("sha256").update(canonicalJson(input)).digest("hex");
}

/** Type-only helper so callers don't need to re-derive this union at call sites. */
export type { InventoryPartRequestIdempotencyOperation };
