import { sql } from "drizzle-orm";
import {
  check,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./users";

/**
 * Deliberately two-valued, unlike DATABASE_DESIGN.md §14's ACTIVE/EXPIRED/
 * REVOKED sketch: EXPIRED is never persisted here. Validity (including
 * "has the window passed") is always computed at read/decision time from
 * starts_at/ends_at vs now(), the same isDelegationValidAt-style philosophy
 * the local-demo layer already uses (delegation-types.ts) — the design
 * doc itself calls its own auto-expiry mechanism "TBD (scheduled job or
 * read-time calculation)"; read-time calculation is what this project
 * implements, so a stored EXPIRED value would just be redundant,
 * eventually-stale derived data.
 */
export const shipmentDelegationStatusEnum = pgEnum("shipment_delegation_status", [
  "ACTIVE",
  "REVOKED",
]);

/**
 * Time-bounded FINAL_SHIPMENT approval authority delegated from a
 * representative (users.is_shipment_representative = true) to another user
 * — not scoped to any single repair case (DATABASE_DESIGN.md §14: "위임은
 * 특정 A/S 건에 종속되지 않는 기간 기반 권한"). No soft-delete columns: a
 * delegation is either still ACTIVE or was REVOKED (a permanent, immutable
 * fact, same append-style convention as status_change_histories) — it is
 * never deleted.
 *
 * Deliberately does NOT duplicate anything already on `users`
 * (representative eligibility is always re-checked live against
 * users.is_shipment_representative at decision time, never snapshotted
 * here).
 *
 * Overlap prevention (no two simultaneously-ACTIVE windows for the same
 * representative+delegate pair) is enforced by the mutation layer via a
 * pg_advisory_xact_lock keyed on the pair, not a DB-level EXCLUDE
 * constraint — avoids adding the btree_gist extension for what is, at this
 * project's current scale, an admin-only, low-frequency write path; see
 * shipment-delegations.ts mutation comments.
 */
export const shipmentApprovalDelegations = pgTable(
  "shipment_approval_delegations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    representativeUserId: uuid("representative_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    delegateUserId: uuid("delegate_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    status: shipmentDelegationStatusEnum("status").notNull().default("ACTIVE"),
    assignedByUserId: uuid("assigned_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    revokedByUserId: uuid("revoked_by_user_id").references(() => users.id, {
      onDelete: "restrict",
    }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("shipment_approval_delegations_representative_id_idx").on(
      table.representativeUserId
    ),
    index("shipment_approval_delegations_delegate_id_idx").on(table.delegateUserId),
    // Speeds up "is this delegate currently valid for any representative"
    // lookups at decision time (status + window range scan).
    index("shipment_approval_delegations_status_period_idx").on(
      table.status,
      table.startsAt,
      table.endsAt
    ),
    check(
      "shipment_approval_delegations_different_users",
      sql`representative_user_id <> delegate_user_id`
    ),
    check("shipment_approval_delegations_valid_range", sql`ends_at > starts_at`),
    check(
      "shipment_approval_delegations_revocation_metadata",
      sql`
        (status = 'ACTIVE' AND revoked_by_user_id IS NULL AND revoked_at IS NULL)
        OR
        (status = 'REVOKED' AND revoked_by_user_id IS NOT NULL AND revoked_at IS NOT NULL)
      `
    ),
  ]
);
