import { boolean, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./users";

/**
 * Narrow, immutable audit trail for users.is_shipment_representative flag
 * changes only — not a general-purpose audit_logs table (out of scope for
 * this task; DATABASE_DESIGN.md's polymorphic audit_logs design is a much
 * larger, separate undertaking). Satisfies PROJECT_REQUIREMENTS.md §"역할
 * 기반 권한과 별개로... 사용자별 예외 권한의 부여·회수는 감사 로그에
 * 기록한다" for this one specific flag without pulling in that broader
 * system. Append-only: no soft-delete columns, no update path anywhere in
 * the mutation layer.
 */
export const representativeChangeHistory = pgTable(
  "representative_change_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    targetUserId: uuid("target_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    previousValue: boolean("previous_value").notNull(),
    newValue: boolean("new_value").notNull(),
    changedByUserId: uuid("changed_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("representative_change_history_target_user_id_idx").on(table.targetUserId),
  ]
);
