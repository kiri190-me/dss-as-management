import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./users";

/**
 * Product Model Master (canonical model-level identity) — introduced
 * separately from `products` (the existing per-PHYSICAL-UNIT table, one row
 * per S/N+L/N+model triple, unchanged). Approved canonical mapping: every
 * currently distinct `products.model_name` string becomes exactly one
 * `product_models` row via an exact-string backfill — no normalization-based
 * merging, no exclusions (D1-MODEL/MBK200-JS2/TEST-MODEL-A all preserved
 * regardless of their ambiguous origin).
 *
 * `kind` is deliberately NOT derived from `repair_cases`' workflow_type —
 * the canonicalization audit found a real same-physical-unit conflict
 * (TG-350's one unit was serviced once as WARRANTY_GENERATOR and once as
 * MATCHER), proving workflow_type is not a reliable per-model hardware fact
 * in the current data. `kind` starts NULL for every backfilled row and is
 * only ever set later by an authorized user through a real model-master
 * edit action (not part of this migration).
 *
 * This is a genuinely separate "kind" enum from workflow_type_code
 * (MATCHER/PAID_GENERATOR/WARRANTY_GENERATOR, a billing-aware workflow
 * concept) and from procedure_equipment_type (RFG/MB/COMMON) — deliberately
 * not reused from either.
 */
export const productModelKindEnum = pgEnum("product_model_kind", [
  "GENERATOR",
  "MATCHER",
  "TOTAL_CONTROLLER",
]);

export const productModels = pgTable(
  "product_models",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    modelName: text("model_name").notNull(),
    // Nullable — never backfilled from workflow_type (see file comment
    // above). Stays NULL until an authorized user explicitly assigns it.
    kind: productModelKindEnum("kind"),
    manufacturer: text("manufacturer"),
    description: text("description"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    // Soft-delete four-column convention (DATABASE_DESIGN.md #8).
    isDeleted: boolean("is_deleted").notNull().default(false),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: uuid("deleted_by").references(() => users.id, { onDelete: "restrict" }),
    deleteReason: text("delete_reason"),
  },
  (table) => [
    index("product_models_not_deleted_idx")
      .on(table.isDeleted)
      .where(sql`is_deleted = false`),
    // Same normalization expression as customers_normalized_name_unique /
    // end_users_customer_normalized_name_unique — forward-looking only
    // (prevents a FUTURE insert like "tg-100" from silently coexisting with
    // an existing "TG-100" master row). Verified against live data before
    // this migration was generated: 0 collisions among the 9 backfilled
    // rows under this exact expression.
    uniqueIndex("product_models_normalized_name_unique")
      .on(sql`lower(regexp_replace(btrim(${table.modelName}), '\\s+', ' ', 'g'))`)
      .where(sql`is_deleted = false`),
  ]
);
