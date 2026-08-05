import { sql } from "drizzle-orm";
import {
  check,
  index,
  jsonb,
  pgEnum,
  pgTable,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { repairCases } from "./repair-cases";
import { users } from "./users";

export const idempotencyKeyStatusEnum = pgEnum("idempotency_key_status", [
  "PROCESSING",
  "SUCCEEDED",
  "FAILED",
]);

/**
 * Server-validated idempotency guard for repair-case creation. One row per
 * client-generated key (crypto.randomUUID(), minted once per intake draft —
 * see src/lib/domain/local/intake-idempotency-key.ts). Never derived from
 * business fields (customer/model/serial/date) — an opaque token only.
 *
 * `response_snapshot` deliberately carries only { repairCaseId, intakeNumber
 * } (see idempotency-keys.ts mutation module) — no contact/PII fields — so
 * this table needs no redaction discipline beyond its short retention
 * window (SECURITY_POLICY.md's "Idempotency Key Retention" section).
 *
 * Deliberately NOT soft-delete (no is_deleted/deleted_at/deleted_by/
 * delete_reason): this is a short-lived operational table (2h TTL), not a
 * business record. Hard delete via a documented, separately-implemented
 * retention job is the intended lifecycle — this task adds the schema and
 * the 2h expires_at column only, not the sweep job itself.
 */
export const repairCaseIdempotencyKeys = pgTable(
  "repair_case_idempotency_keys",
  {
    idempotencyKey: uuid("idempotency_key").primaryKey(),
    requesterUserId: uuid("requester_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    status: idempotencyKeyStatusEnum("status").notNull().default("PROCESSING"),
    repairCaseId: uuid("repair_case_id").references(() => repairCases.id, {
      onDelete: "restrict",
    }),
    responseSnapshot: jsonb("response_snapshot"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("repair_case_idempotency_keys_requester_user_id_idx").on(
      table.requesterUserId
    ),
    index("repair_case_idempotency_keys_expires_at_idx").on(table.expiresAt),
    // DB-level backstop matching the app-level invariant in
    // markIdempotencyKeySucceeded: a SUCCEEDED row must always carry the
    // repair case it created.
    check(
      "repair_case_idempotency_keys_succeeded_has_repair_case",
      sql`status <> 'SUCCEEDED' OR repair_case_id IS NOT NULL`
    ),
  ]
);
