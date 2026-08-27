import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

// Fixed 5-role set (DATABASE_DESIGN.md #6). DEVELOPER is intentionally not a
// role — it is represented separately by users.is_developer.
export const roleEnum = pgEnum("role_code", [
  "SUPER_ADMIN",
  "ADMIN",
  "AS_ENGINEER",
  "SALES",
  "INVENTORY_MANAGER",
]);

export const accountApprovalStatusEnum = pgEnum("account_approval_status", [
  "PENDING",
  "APPROVED",
]);

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    // Nullable for seeded/demo accounts that have no real credential yet.
    // Never read: SSO (dss-auth) proves identity instead, and a repo-wide
    // grep confirms zero references outside this definition. Left in place
    // rather than dropped — a column removal is awkward to reverse and buys
    // nothing here.
    passwordHash: text("password_hash"),
    // dss-auth users.id, delivered as the ID token's subject claim. This is
    // the only join key between this system and the login portal. Email is
    // deliberately not used for that: a Kakao account holder can change
    // their email, so it cannot anchor an identity.
    // Nullable — rows created before SSO are not linked yet.
    ssoSubject: text("sso_subject"),
    ssoLinkedAt: timestamp("sso_linked_at", { withTimezone: true }),
    /**
     * Sessions issued before this instant are no longer valid.
     *
     * This system's sessions are not stored server-side — they are signed
     * tokens, valid on their own once issued. So "revoke that one session"
     * has nothing to point at here. Raising this line invalidates every
     * token issued before it instead.
     *
     * Set to now() when the login portal reports a logout or a suspension
     * (api/auth/sso/backchannel-logout). Null means this account has never
     * been cut off, and nothing is invalidated.
     *
     * This cuts *all* of that person's sessions, not one. A revocation list
     * would be precise, but it adds a table that grows and needs its own
     * sweep — and on a shared PC "I left" usually does mean everywhere.
     */
    sessionsValidFrom: timestamp("sessions_valid_from", { withTimezone: true }),
    name: text("name").notNull(),
    role: roleEnum("role").notNull(),
    approvalStatus: accountApprovalStatusEnum("approval_status")
      .notNull()
      .default("PENDING"),
    isDeveloper: boolean("is_developer").notNull().default(false),
    // Gates FINAL_SHIPMENT approval decisions in database mode — the DB
    // equivalent of the local-demo layer's single hardcoded
    // FINAL_SHIPMENT_REPRESENTATIVE_USER_ID ("대표"), generalized to a real
    // user flag since a hardcoded mock id can't identify a production user.
    // Minimal stand-in for DATABASE_DESIGN.md §14's fuller
    // users.can_approve_shipment/can_assign_shipment_delegation +
    // shipment_approval_delegations model — that full delegation-period
    // subsystem (assignment UI, ACTIVE/EXPIRED/REVOKED lifecycle) is out of
    // scope here and left as a follow-up; this flag only supports direct
    // decisions, no delegation, in database mode. Defaults to false
    // (fail-closed): FINAL_SHIPMENT approval blocks in database mode until
    // an admin explicitly flags a representative.
    isShipmentRepresentative: boolean("is_shipment_representative")
      .notNull()
      .default(false),
    failedLoginCount: integer("failed_login_count").notNull().default(0),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    isActive: boolean("is_active").notNull().default(true),
    // Optimistic concurrency token.
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    // Soft-delete four-column convention (DATABASE_DESIGN.md #8).
    isDeleted: boolean("is_deleted").notNull().default(false),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: uuid("deleted_by").references((): AnyPgColumn => users.id, {
      onDelete: "restrict",
    }),
    deleteReason: text("delete_reason"),
  },
  (table) => [
    uniqueIndex("users_email_unique").on(table.email),
    // Partial unique — unlinked (null) rows never collide with each other,
    // but one DSS subject can never map to two accounts.
    uniqueIndex("users_sso_subject_unique")
      .on(table.ssoSubject)
      .where(sql`sso_subject is not null`),
    index("users_not_deleted_idx")
      .on(table.isDeleted)
      .where(sql`is_deleted = false`),
  ]
);
