import { index, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";
import { repairCases, billingTypeEnum } from "./repair-cases";
import { users } from "./users";
import { workflowSteps, workflowVersions } from "./workflow";

/**
 * Immutable record of resolving an imported Repair Case from
 * PENDING_DECISION to a final billing/workflow. The parent uses CASCADE so
 * the established Repair Case permanent-delete lifecycle can remove this
 * case-owned history without weakening the RESTRICT policy on workflow and
 * user reference rows. No Excel source text or customer/product PII is
 * copied here.
 */
export const repairCaseBillingDecisionHistories = pgTable(
  "repair_case_billing_decision_histories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    repairCaseId: uuid("repair_case_id")
      .notNull()
      .references(() => repairCases.id, { onDelete: "cascade" }),
    previousBillingType: billingTypeEnum("previous_billing_type").notNull(),
    nextBillingType: billingTypeEnum("next_billing_type").notNull(),
    previousWorkflowVersionId: uuid("previous_workflow_version_id")
      .notNull()
      .references(() => workflowVersions.id, { onDelete: "restrict" }),
    nextWorkflowVersionId: uuid("next_workflow_version_id")
      .notNull()
      .references(() => workflowVersions.id, { onDelete: "restrict" }),
    previousWorkflowStepId: uuid("previous_workflow_step_id")
      .notNull()
      .references(() => workflowSteps.id, { onDelete: "restrict" }),
    nextWorkflowStepId: uuid("next_workflow_step_id")
      .notNull()
      .references(() => workflowSteps.id, { onDelete: "restrict" }),
    decidedBy: uuid("decided_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    decidedAt: timestamp("decided_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("repair_case_billing_decision_history_case_decided_at_idx").on(
      table.repairCaseId,
      table.decidedAt
    ),
    index("repair_case_billing_decision_history_actor_idx").on(table.decidedBy),
  ]
);
