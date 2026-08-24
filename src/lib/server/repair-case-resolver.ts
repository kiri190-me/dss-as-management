import "server-only";
import { cache } from "react";
import { getRepairCaseReadSource } from "@/lib/config/read-source";
import { resolveMockRepairCaseById, type ResolvedRepairCase } from "@/lib/domain/local/resolved-repair-case";
import { getRepairCaseById } from "@/lib/db/queries/repair-cases";

/**
 * Single, read-source-aware repair-case resolver for server code.
 * [id]/layout.tsx, [id]/page.tsx, and the other detail tabs (work-
 * history/files/approval/report) all resolve the *same* id during one
 * request — wrapped in React's cache(), so the underlying resolution
 * (a real SQL query in database mode) runs at most once per request, no
 * matter how many of those files call this function. This is request-level
 * memoization only: React's cache() is scoped to a single render/request in
 * the App Router (a fresh cache is created per request) — it is not
 * unstable_cache, not ISR, and not a module-level map that could leak state
 * across requests or go stale.
 *
 * A `local-` id (the removed browser-storage demo prefix) resolves to null
 * like any other unknown id: mock mode finds no matching mockRepairCases
 * entry, and database mode rejects it at getRepairCaseById's UUID guard
 * before any query runs. Callers get the same "not found" they already
 * handle — no separate demo branch exists any more.
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
