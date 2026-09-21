import { sql } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import { db } from "./connection";

/**
 * Test-only guard for the invariant every self-cleaning integration suite
 * has to prove: **its cleanup must never delete a row it did not create.**
 *
 * The original form of that proof read every pre-existing id into memory in
 * `before()` and replayed the whole list back through
 * `where(inArray(table.id, ids))` in `after()`. That is correct but it does
 * not scale: postgres.js binds one query parameter per id and refuses at
 * 65,534 (`MAX_PARAMETERS_EXCEEDED`), so the proof itself started failing
 * once `audit_logs` in the test DB grew past that — a false red that says
 * nothing about the mutation under test.
 *
 * This keeps the same invariant and inverts the bookkeeping. The set of
 * pre-existing rows is pinned by a server-side timestamp boundary taken in
 * the same statement that fingerprints them (`now()` — a transaction start
 * time, so every row a test inserts afterwards is strictly newer), and the
 * fingerprint is a row count plus an md5 over the sorted ids, both computed
 * inside Postgres. `current()` re-reads exactly that window after cleanup.
 * One bound parameter, regardless of how many rows the table holds.
 *
 * Equal fingerprints mean no pre-existing row was deleted (a deletion moves
 * both the count and the digest) and none was added behind the boundary, so
 * this is at least as strict as the id-list comparison it replaces — a
 * cleanup that over-deletes still fails, which is the whole point.
 *
 * Deliberately NOT a general-purpose query helper: nothing outside the
 * integration suites should depend on wall-clock windows like this.
 */

export type PreexistingRowsTarget = {
  /** Human-readable table name, surfaced in the assertion diff. */
  readonly label: string;
  readonly table: PgTable;
  /** Primary key column, used for the digest. */
  readonly idColumn: PgColumn;
  /** `created_at`, used to separate pre-existing rows from test-made ones. */
  readonly createdAtColumn: PgColumn;
};

export type PreexistingRowsFingerprint = {
  readonly label: string;
  readonly boundary: string;
  readonly rowCount: number;
  readonly idDigest: string;
};

export type PreexistingRowsGuard = {
  /** Fingerprint taken before the suite created anything. */
  readonly baseline: PreexistingRowsFingerprint;
  /** Fingerprint of the same window right now — compare it to `baseline`. */
  current(): Promise<PreexistingRowsFingerprint>;
};

function fingerprintFields(target: PreexistingRowsTarget) {
  return {
    rowCount: sql<number>`count(*)::int`,
    idDigest: sql<string>`coalesce(md5(string_agg(${target.idColumn}::text, ',' order by ${target.idColumn}::text)), '')`,
  };
}

/**
 * Call once in `before()`, before the suite inserts anything of its own.
 */
export async function guardPreexistingRows(
  target: PreexistingRowsTarget
): Promise<PreexistingRowsGuard> {
  const [row] = await db
    .select({ boundary: sql<string>`now()::text`, ...fingerprintFields(target) })
    .from(target.table);

  const baseline: PreexistingRowsFingerprint = {
    label: target.label,
    boundary: row.boundary,
    rowCount: row.rowCount,
    idDigest: row.idDigest,
  };

  return {
    baseline,
    async current(): Promise<PreexistingRowsFingerprint> {
      const [now] = await db
        .select(fingerprintFields(target))
        .from(target.table)
        .where(sql`${target.createdAtColumn} <= ${baseline.boundary}::timestamptz`);
      return {
        label: baseline.label,
        boundary: baseline.boundary,
        rowCount: now.rowCount,
        idDigest: now.idDigest,
      };
    },
  };
}
