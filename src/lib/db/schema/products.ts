import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./users";
import { productModels } from "./product-models";

/**
 * Uniqueness strategy (revised in the Gate 4 correction batch):
 *
 * serial_number is NOT globally unique by documented design. The only
 * documented/implemented "same product" matching logic in this codebase is
 * src/lib/domain/local/product-history-match.ts's `matchesNormalizedTriple`,
 * which treats two products as the same unit only when normalized
 * modelName + lotNumber + serialNumber ALL match — never serial number
 * alone. Neither DATABASE_DESIGN.md, PROJECT_REQUIREMENTS.md nor
 * API_SPECIFICATION.md states or implies serial numbers are globally unique
 * across models. mock-data.ts's 9 sample products happen to all have
 * distinct serial numbers, but that is sample-data coincidence, not a
 * documented invariant — so this does not prove global uniqueness (answer:
 * C — not guaranteed unique; the only documented identity key is the
 * Model + Lot + Serial triple, i.e. "unique only within a model+lot", a
 * narrower case of B). The constraint below is therefore a composite unique
 * index on (model_name, lot_number, serial_number), mirroring the app's own
 * product-identity definition exactly, instead of unique(serial_number).
 *
 * Exact PostgreSQL behavior of this composite unique index:
 * Postgres unique indexes use "NULLS DISTINCT" by default (pre-PG15 there is
 * no other mode) — every NULL is treated as unequal to every other NULL,
 * including within a multi-column index. So:
 *   - Two rows with the same model_name but lot_number/serial_number both
 *     NULL are NOT flagged as duplicates (multiple "unidentified" units of
 *     the same model remain insertable) — satisfies the "multiple null
 *     serial-number rows must remain allowed" requirement.
 *   - A genuine duplicate is only rejected when model_name, lot_number AND
 *     serial_number are all non-NULL and all three are literally equal
 *     across two rows.
 *   - A known limitation: a row with a known serial_number but a NULL
 *     lot_number is NOT protected against a duplicate insert of the same
 *     model_name + serial_number (still NULL lot_number) — because NULL
 *     never equals NULL, the index does not catch that case. Closing that
 *     gap would need either a partial unique index (e.g.
 *     `WHERE lot_number IS NOT NULL AND serial_number IS NOT NULL`) or a
 *     `NULLS NOT DISTINCT` index (PG15+). Per this correction's explicit
 *     instruction not to introduce a partial unique index until Drizzle's
 *     generated SQL for it has been verified (migration generation is not
 *     yet approved), neither is added here — this remains an app-level
 *     validation responsibility for now.
 *
 * model_name remains NOT NULL as the minimum identifying attribute for any
 * product row. serial_number and lot_number are nullable even though the
 * current demo Product type marks them required: real intake data
 * (including the ~600-record legacy Excel migration, DATABASE_DESIGN.md
 * #12) will include units without a captured serial/lot at intake time.
 * part_number is not part of the current approved domain/design (not
 * present in mock-data.ts's Product type) and is added here as a nullable,
 * non-unique column for forward compatibility only.
 */
export const products = pgTable(
  "products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    modelName: text("model_name").notNull(),
    // Nullable — added for Product Model Master phase 1 (backfilled by
    // exact model_name match for every existing row; left NULL for any new
    // row created via the still-unchanged resolveProduct() flow until a
    // later checkpoint teaches it to resolve/create the master too).
    // products.model_name itself is untouched — it remains the per-unit's
    // own recorded free-text string, unaffected by this column's presence.
    productModelId: uuid("product_model_id").references(() => productModels.id, { onDelete: "restrict" }),
    serialNumber: text("serial_number"),
    lotNumber: text("lot_number"),
    partNumber: text("part_number"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    // Soft-delete four-column convention (DATABASE_DESIGN.md #8).
    isDeleted: boolean("is_deleted").notNull().default(false),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: uuid("deleted_by").references(() => users.id, {
      onDelete: "restrict",
    }),
    deleteReason: text("delete_reason"),
  },
  (table) => [
    uniqueIndex("products_model_lot_serial_unique").on(
      table.modelName,
      table.lotNumber,
      table.serialNumber
    ),
    index("products_model_name_idx").on(table.modelName),
    index("products_not_deleted_idx")
      .on(table.isDeleted)
      .where(sql`is_deleted = false`),
  ]
);
