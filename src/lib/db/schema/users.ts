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
    passwordHash: text("password_hash"),
    name: text("name").notNull(),
    role: roleEnum("role").notNull(),
    approvalStatus: accountApprovalStatusEnum("approval_status")
      .notNull()
      .default("PENDING"),
    isDeveloper: boolean("is_developer").notNull().default(false),
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
    index("users_not_deleted_idx")
      .on(table.isDeleted)
      .where(sql`is_deleted = false`),
  ]
);
