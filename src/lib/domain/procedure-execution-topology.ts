/**
 * Phase 5A — repair-case procedure execution. Pure functions only: no DOM,
 * no React, no DB access. Two responsibilities:
 *
 *   1. isExecutableNodeType — which of the 9 real procedure_template_nodes
 *      node types get an independent execution-state row
 *      (procedure_case_execution_nodes) versus stay read-only satellite
 *      content joined from the immutable template. Grounded in a read-only
 *      audit of the real RFG/MB templates (see the Phase 5A plan): RFG's 2
 *      DOCUMENT_REFERENCE nodes sit inline with edges while MB's single
 *      DOCUMENT_REFERENCE has none, so "no edges" cannot be the rule —
 *      classification is by node type alone, never by a given instance's
 *      graph position.
 *
 *   2. computeSuggestedNextNodes — a guidance-only "실행 가능" sort/highlight
 *      hint, never a hard gate (any PENDING executable node can always be
 *      started directly). Deliberately conservative: multiple incoming
 *      edges are treated as alternative converging paths (ANY, not ALL,
 *      must be COMPLETED/SKIPPED), a DECISION's un-selected branches never
 *      count as available, and LOOP_BACK/RETRY edges need no special-casing
 *      since the same "source completed → target suggested" rule already
 *      makes a loop naturally resurface its target.
 */

import type { ProcedureNodeType } from "./procedure-template-types";
import type { ProcedureCaseExecutionNodeStatus } from "./procedure-case-execution-types";

const EXECUTABLE_NODE_TYPES: ReadonlySet<ProcedureNodeType> = new Set([
  "START",
  "TASK",
  "INSPECTION",
  "DECISION",
  "CORRECTIVE_ACTION",
  "CHECKLIST",
  "TROUBLESHOOTING",
  "END",
]);

/** DOCUMENT_REFERENCE is the only real stored node type excluded — always informational/satellite, regardless of whether a given instance has edges. */
export function isExecutableNodeType(nodeType: ProcedureNodeType): boolean {
  return EXECUTABLE_NODE_TYPES.has(nodeType);
}

/**
 * START is a system entry marker only — auto-completed the instant an
 * execution is created (see startProcedureExecution), never a task an
 * engineer starts/completes/skips/blocks/reopens. It still gets a real
 * procedure_case_execution_nodes row (isExecutableNodeType stays true for
 * it) purely so its outgoing edge participates in
 * computeSuggestedNextNodes and makes the real first task suggested — but
 * every user-facing list/progress calculation and every node-mutation
 * entry point must exclude it via this function. Appears only in
 * technical/audit contexts (template topology, the EXECUTION_STARTED
 * history row, internal debugging), never as engineer-facing work.
 */
export function isSystemEntryNodeType(nodeType: ProcedureNodeType): boolean {
  return nodeType === "START";
}

/** Executable AND not a system-managed entry marker — the actual "shows up as a task an engineer can act on" set. */
export function isUserFacingExecutionNodeType(nodeType: ProcedureNodeType): boolean {
  return isExecutableNodeType(nodeType) && !isSystemEntryNodeType(nodeType);
}

export type TopologyNode = {
  id: string;
  nodeType: ProcedureNodeType;
};

export type TopologyEdge = {
  id: string;
  fromNodeId: string;
  toNodeId: string;
};

export type TopologyExecutionNode = {
  /** procedure_case_execution_nodes.id — the identity returned in the suggested set. */
  id: string;
  /** null for a case-specific extra task (no template node, no edges). */
  procedureTemplateNodeId: string | null;
  status: ProcedureCaseExecutionNodeStatus;
  /** Only meaningful when the underlying template node is DECISION. */
  selectedOutgoingEdgeId: string | null;
};

/**
 * Returns the set of execution-node ids (procedure_case_execution_nodes.id)
 * that should be highlighted/sorted first in the "실행 가능" list. Purely
 * advisory — every PENDING executable node remains directly startable
 * regardless of membership in this set.
 */
export function computeSuggestedNextNodes(
  nodes: TopologyNode[],
  edges: TopologyEdge[],
  executionNodes: TopologyExecutionNode[]
): Set<string> {
  const nodeTypeByTemplateNodeId = new Map(nodes.map((n) => [n.id, n.nodeType]));
  const executionNodeByTemplateNodeId = new Map(
    executionNodes
      .filter((en): en is TopologyExecutionNode & { procedureTemplateNodeId: string } => en.procedureTemplateNodeId !== null)
      .map((en) => [en.procedureTemplateNodeId, en])
  );

  const incomingEdgesByTargetTemplateNodeId = new Map<string, TopologyEdge[]>();
  for (const edge of edges) {
    const list = incomingEdgesByTargetTemplateNodeId.get(edge.toNodeId) ?? [];
    list.push(edge);
    incomingEdgesByTargetTemplateNodeId.set(edge.toNodeId, list);
  }

  const suggested = new Set<string>();

  for (const en of executionNodes) {
    if (en.status !== "PENDING") continue;

    // Extra case-specific task — no template node, no edges, always suggested.
    if (en.procedureTemplateNodeId === null) {
      suggested.add(en.id);
      continue;
    }

    const incoming = incomingEdgesByTargetTemplateNodeId.get(en.procedureTemplateNodeId) ?? [];

    if (incoming.length === 0) {
      suggested.add(en.id);
      continue;
    }

    const anySourceReady = incoming.some((edge) => {
      const sourceExecutionNode = executionNodeByTemplateNodeId.get(edge.fromNodeId);
      if (!sourceExecutionNode) return false;
      if (sourceExecutionNode.status !== "COMPLETED" && sourceExecutionNode.status !== "SKIPPED") return false;

      const sourceNodeType = nodeTypeByTemplateNodeId.get(edge.fromNodeId);
      if (sourceNodeType === "DECISION") {
        // An unselected branch off a completed DECISION never counts as available.
        return sourceExecutionNode.selectedOutgoingEdgeId === edge.id;
      }
      return true;
    });

    if (anySourceReady) suggested.add(en.id);
  }

  return suggested;
}
