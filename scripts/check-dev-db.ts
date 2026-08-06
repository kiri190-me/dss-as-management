import "./load-env";

import { sql } from "drizzle-orm";
import { db } from "../src/lib/db/connection";
import {
  users,
  customers,
  endUsers,
  products,
  workflowTemplates,
  workflowVersions,
  workflowSteps,
  exceptionStatuses,
  repairCases,
  procedureTemplates,
  procedureTemplateNodes,
  procedureTemplateEdges,
  procedureChecklistSections,
  procedureChecklistItems,
  procedureTroubleshootingEntries,
  procedureTemplateValidationIssues,
  procedureReferenceItems,
} from "../src/lib/db/schema";

/**
 * Read-only connectivity + row-count check. Never mutates data, never
 * prints DATABASE_URL or any row contents — counts only.
 */
const tables = [
  { name: "users", table: users },
  { name: "customers", table: customers },
  { name: "end_users", table: endUsers },
  { name: "products", table: products },
  { name: "workflow_templates", table: workflowTemplates },
  { name: "workflow_versions", table: workflowVersions },
  { name: "workflow_steps", table: workflowSteps },
  { name: "exception_statuses", table: exceptionStatuses },
  { name: "repair_cases", table: repairCases },
  { name: "procedure_templates", table: procedureTemplates },
  { name: "procedure_template_nodes", table: procedureTemplateNodes },
  { name: "procedure_template_edges", table: procedureTemplateEdges },
  { name: "procedure_checklist_sections", table: procedureChecklistSections },
  { name: "procedure_checklist_items", table: procedureChecklistItems },
  { name: "procedure_troubleshooting_entries", table: procedureTroubleshootingEntries },
  { name: "procedure_template_validation_issues", table: procedureTemplateValidationIssues },
  { name: "procedure_reference_items", table: procedureReferenceItems },
] as const;

async function main() {
  console.log("Checking dev database connectivity and row counts...");
  for (const { name, table } of tables) {
    const [row] = await db.select({ count: sql<number>`count(*)::int` }).from(table);
    console.log(`  ${name}: ${row?.count ?? 0}`);
  }
  console.log("Check complete.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Check failed:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
