import "server-only";

/**
 * Server-only feature flag controlling where new-intake submission writes.
 * Never exposed to the client (no NEXT_PUBLIC_ prefix, never logged) — same
 * discipline as REPAIR_CASE_READ_SOURCE (src/lib/config/read-source.ts).
 *
 * This is a SEPARATE flag from REPAIR_CASE_READ_SOURCE on purpose — the read
 * path still has its own "mock" mode, and create-repair-case.ts additionally
 * requires READ_SOURCE=database whenever it writes (fails clearly rather than
 * creating a DB row that would then 404 on a mock-mode detail page).
 *
 * Policy:
 *  - "database" is the only accepted value, and the default when absent.
 *  - the former "local" browser-demo write path was removed, so "local" is
 *    now rejected exactly like any other invalid value — it must never be
 *    accepted-but-ignored, which would silently look like a working setting.
 *  - anything else throws clearly — never silently falls back.
 *
 * The callers that gate real mutations still re-check `!== "database"`
 * independently; keeping that check is deliberate even though only one value
 * remains.
 */
export const REPAIR_CASE_WRITE_SOURCES = ["database"] as const;
export type RepairCaseWriteSource = (typeof REPAIR_CASE_WRITE_SOURCES)[number];

export function getRepairCaseWriteSource(): RepairCaseWriteSource {
  const raw = process.env.REPAIR_CASE_WRITE_SOURCE;

  if (raw === undefined || raw === "") {
    return "database";
  }

  if ((REPAIR_CASE_WRITE_SOURCES as readonly string[]).includes(raw)) {
    return raw as RepairCaseWriteSource;
  }

  // Not a secret (unlike DATABASE_URL/POSTGRES_PASSWORD) — safe to include
  // the invalid value itself so the misconfiguration is easy to spot.
  throw new Error(
    `REPAIR_CASE_WRITE_SOURCE must be one of ${REPAIR_CASE_WRITE_SOURCES.join(
      " | "
    )}, got: "${raw}"`
  );
}
