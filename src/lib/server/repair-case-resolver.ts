import "server-only";
import { cache } from "react";
import { getRepairCaseReadSource } from "@/lib/config/read-source";
import { resolveMockRepairCaseById, type ResolvedRepairCase } from "@/lib/domain/local/resolved-repair-case";
import { getRepairCaseById } from "@/lib/db/queries/repair-cases";

/**
 * Single, read-source-aware, non-local repair-case resolver for server
 * code. [id]/layout.tsx, [id]/page.tsx, and the other detail tabs (work-
 * history/files/approval/report) all resolve the *same* id during one
 * request — wrapped in React's cache(), so the underlying resolution
 * (a real SQL query in database mode) runs at most once per request, no
 * matter how many of those files call this function. This is request-level
 * memoization only: React's cache() is scoped to a single render/request in
 * the App Router (a fresh cache is created per request) — it is not
 * unstable_cache, not ISR, and not a module-level map that could leak state
 * across requests or go stale.
 *
 * Never resolves local- ids — callers must branch on isLocalId() themselves
 * before calling this, exactly as they already do today.
 *
 * A genuine database failure (e.g. connection refused) is NOT caught here —
 * it propagates so the nearest repair-cases/error.tsx boundary renders it,
 * keeping "not found" (null) and "failure" (thrown) distinguishable.
 */
export const resolveRepairCaseForServer = cache(
  async (id: string): Promise<ResolvedRepairCase | null> => {
    const readSource = getRepairCaseReadSource();

    if (readSource === "mock") {
      return resolveMockRepairCaseById(id);
    }

    return getRepairCaseById(id);
  }
);
