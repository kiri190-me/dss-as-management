import "server-only";

/**
 * Server-only feature flag controlling where repair-case read paths get
 * their base data from. Never exposed to the client (no NEXT_PUBLIC_
 * prefix, never passed through page props) and never logged/printed —
 * same discipline as every other secret-adjacent value in this project.
 *
 * Policy:
 *  - "database" is the only accepted value, and the default when absent.
 *    An environment that simply forgets the line (NAS deployment, a fresh
 *    .env) now reads the real database instead of silently serving demo
 *    rows that look like production data.
 *  - the former "mock" demo read path was removed, so "mock" is now
 *    rejected exactly like any other invalid value — it must never be
 *    accepted-but-ignored, which would silently look like a working setting.
 *  - anything else throws clearly — never silently falls back.
 *
 * The callers that gate real mutations still re-check `!== "database"`
 * independently; keeping that check is deliberate even though only one value
 * remains.
 */
export const REPAIR_CASE_READ_SOURCES = ["database"] as const;
export type RepairCaseReadSource = (typeof REPAIR_CASE_READ_SOURCES)[number];

export function getRepairCaseReadSource(): RepairCaseReadSource {
  const raw = process.env.REPAIR_CASE_READ_SOURCE;

  if (raw === undefined || raw === "") {
    return "database";
  }

  if ((REPAIR_CASE_READ_SOURCES as readonly string[]).includes(raw)) {
    return raw as RepairCaseReadSource;
  }

  // REPAIR_CASE_READ_SOURCE is a config flag, not a secret (unlike
  // DATABASE_URL/POSTGRES_PASSWORD) — including the invalid value itself in
  // the error is safe and makes the misconfiguration easy to spot.
  throw new Error(
    `REPAIR_CASE_READ_SOURCE must be one of ${REPAIR_CASE_READ_SOURCES.join(
      " | "
    )}, got: "${raw}"`
  );
}
