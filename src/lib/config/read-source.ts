import "server-only";

/**
 * Server-only feature flag controlling where repair-case read paths get
 * their base data from. Never exposed to the client (no NEXT_PUBLIC_
 * prefix, never passed through page props) and never logged/printed —
 * same discipline as every other secret-adjacent value in this project.
 *
 * Policy (approved for Stage G-2):
 *  - absent → defaults to "mock" (current PC-development stage only; this
 *    default is expected to change once PC staging/NAS deployment requires
 *    the database explicitly — that enforcement is deferred, not decided
 *    here).
 *  - "mock" | "database" are the only accepted values.
 *  - anything else throws clearly — never silently falls back.
 *  - NODE_ENV=production does NOT by itself require "database" yet.
 */
export const REPAIR_CASE_READ_SOURCES = ["mock", "database"] as const;
export type RepairCaseReadSource = (typeof REPAIR_CASE_READ_SOURCES)[number];

export function getRepairCaseReadSource(): RepairCaseReadSource {
  const raw = process.env.REPAIR_CASE_READ_SOURCE;

  if (raw === undefined || raw === "") {
    return "mock";
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
