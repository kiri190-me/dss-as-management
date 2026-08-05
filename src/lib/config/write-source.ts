import "server-only";

/**
 * Server-only feature flag controlling whether new-intake submission writes
 * to the database or preserves the existing localStorage demo behavior.
 * Never exposed to the client (no NEXT_PUBLIC_ prefix, never logged) — same
 * discipline as REPAIR_CASE_READ_SOURCE (src/lib/config/read-source.ts).
 *
 * This is a SEPARATE flag from REPAIR_CASE_READ_SOURCE on purpose — a write
 * can be enabled independently of the read path, though
 * create-repair-case.ts additionally requires READ_SOURCE=database whenever
 * WRITE_SOURCE=database (fails clearly rather than creating a DB row that
 * would then 404 on a mock-mode detail page).
 *
 * Policy:
 *  - absent → defaults to "local" (current transition-stage default;
 *    identical to today's behavior until explicitly opted in).
 *  - "local" | "database" are the only accepted values.
 *  - anything else throws clearly — never silently falls back.
 */
export const REPAIR_CASE_WRITE_SOURCES = ["local", "database"] as const;
export type RepairCaseWriteSource = (typeof REPAIR_CASE_WRITE_SOURCES)[number];

export function getRepairCaseWriteSource(): RepairCaseWriteSource {
  const raw = process.env.REPAIR_CASE_WRITE_SOURCE;

  if (raw === undefined || raw === "") {
    return "local";
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
