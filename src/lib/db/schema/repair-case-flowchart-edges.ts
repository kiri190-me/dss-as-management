import {
  foreignKey,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  uuid,
} from "drizzle-orm/pg-core";
import { repairCaseFlowcharts } from "./repair-case-flowcharts";
import { repairCaseFlowchartNodes } from "./repair-case-flowchart-nodes";

/**
 * Phase 5C-6A — full behavioral parity with procedure_template_branch_type's
 * value set (approved: RETRY/LOOP_BACK are valid real-world diagnostic-flow
 * concepts, not just Excel-import artifacts, so the set is not narrowed).
 * Independently owned Postgres enum — never the same type object as
 * procedure_template_branch_type, so the two domains' schemas can evolve
 * without touching a shared type.
 */
export const repairCaseFlowchartBranchTypeEnum = pgEnum(
  "repair_case_flowchart_branch_type",
  ["DEFAULT", "NORMAL", "NG", "YES", "NO", "RETRY", "LOOP_BACK", "CUSTOM"]
);

/**
 * No createdAt/updatedAt on this table — mirrors procedure_template_edges'
 * own convention (that table has no timestamp columns either); the owning
 * flowchart's updated_at is the concurrency/audit anchor. No sortOrder,
 * conditionDefinition, sourceConnectorId, clonedFromEdgeId — those are
 * Excel-import-ordering / version-cloning artifacts with no case-flowchart
 * analog (a case flowchart is never imported and never cloned into a new
 * version).
 *
 * Cross-flowchart ownership backstop (the reason from_node_id/to_node_id
 * are NOT plain FKs to repair_case_flowchart_nodes.id): a bare
 * `from_node_id -> nodes.id` FK cannot stop an edge belonging to flowchart A
 * from pointing at a node that belongs to flowchart B. Instead, both
 * endpoints are enforced via a COMPOSITE foreign key against
 * repair_case_flowchart_nodes' own (flowchart_id, id) unique constraint:
 * Postgres can only satisfy `(flowchart_id, from_node_id) REFERENCES
 * repair_case_flowchart_nodes (flowchart_id, id)` when a node row exists
 * whose flowchart_id equals THIS edge's own flowchart_id — a cross-
 * flowchart reference has no matching row and is rejected at the database
 * level, independent of (and in addition to) any application-level
 * ownership check the mutation layer performs. No redundant plain
 * from_node_id/to_node_id -> id FK is declared — the composite FK already
 * covers identity.
 *
 * ON DELETE RESTRICT on both composite FKs (not CASCADE): deleting a node
 * that still has a connected edge must be rejected explicitly by the
 * database — the application must delete the edge first (with its own
 * history row), then the node (with its own history row). A node delete
 * must never silently cascade-delete edges, so each structural deletion
 * stays individually auditable and reversible.
 */
export const repairCaseFlowchartEdges = pgTable(
  "repair_case_flowchart_edges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    flowchartId: uuid("flowchart_id")
      .notNull()
      .references(() => repairCaseFlowcharts.id, { onDelete: "cascade" }),
    fromNodeId: uuid("from_node_id").notNull(),
    toNodeId: uuid("to_node_id").notNull(),
    branchType: repairCaseFlowchartBranchTypeEnum("branch_type").notNull(),
    branchLabel: text("branch_label"),
    // Null = auto-routed (graph-editor-core's routing.ts); a non-empty
    // ordered array of {x,y} points means the edge renders as an explicit
    // polyline instead — same semantics as
    // procedure_template_edges.user_route_points, just without the "user_"
    // prefix (there is no separate "source-imported route" concept here to
    // distinguish it from).
    routePoints: jsonb("route_points").$type<{ x: number; y: number }[]>(),
  },
  (table) => [
    index("repair_case_flowchart_edges_flowchart_id_idx").on(table.flowchartId),
    index("repair_case_flowchart_edges_from_node_id_idx").on(table.fromNodeId),
    index("repair_case_flowchart_edges_to_node_id_idx").on(table.toNodeId),
    foreignKey({
      name: "repair_case_flowchart_edges_from_node_ownership_fk",
      columns: [table.flowchartId, table.fromNodeId],
      foreignColumns: [
        repairCaseFlowchartNodes.flowchartId,
        repairCaseFlowchartNodes.id,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "repair_case_flowchart_edges_to_node_ownership_fk",
      columns: [table.flowchartId, table.toNodeId],
      foreignColumns: [
        repairCaseFlowchartNodes.flowchartId,
        repairCaseFlowchartNodes.id,
      ],
    }).onDelete("restrict"),
  ]
);
