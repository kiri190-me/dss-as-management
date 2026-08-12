-- Hand-edited (Phase 5C-5B): drizzle-kit generated the DROP CONSTRAINT
-- statements using the full, untruncated logical constraint names
-- ("...procedure_template_nodes_id_fk" / "...procedure_template_edges_id_fk",
-- 70 characters) that Drizzle's own snapshot bookkeeping has always used for
-- these two constraints. Postgres has a 63-byte identifier limit and
-- silently truncated both names to exactly 63 characters when they were
-- originally created (confirmed live via pg_constraint:
-- procedure_template_edit_history_node_id_procedure_template_node and
-- procedure_template_edit_history_edge_id_procedure_template_edge) — the
-- as-generated DROP CONSTRAINT statements would have failed against the
-- real DB, since no constraint by the untruncated 70-character name exists.
-- The DROP statements below use the exact live (truncated) names instead.
-- The ADD CONSTRAINT statements are left exactly as generated: Postgres
-- re-truncates the same 70-character logical name to the identical
-- 63-character name shown above, so the recreated constraint ends up named
-- the same either way, and stays consistent with Drizzle's own snapshot.
ALTER TABLE "procedure_template_edit_history" DROP CONSTRAINT "procedure_template_edit_history_node_id_procedure_template_node";
--> statement-breakpoint
ALTER TABLE "procedure_template_edit_history" DROP CONSTRAINT "procedure_template_edit_history_edge_id_procedure_template_edge";
--> statement-breakpoint
ALTER TABLE "procedure_template_edit_history" ADD CONSTRAINT "procedure_template_edit_history_node_id_procedure_template_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."procedure_template_nodes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procedure_template_edit_history" ADD CONSTRAINT "procedure_template_edit_history_edge_id_procedure_template_edges_id_fk" FOREIGN KEY ("edge_id") REFERENCES "public"."procedure_template_edges"("id") ON DELETE set null ON UPDATE no action;