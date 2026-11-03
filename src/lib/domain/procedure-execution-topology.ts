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
  /**
   * **그림 위 자리 id** — 템플릿에서 온 줄은 그 템플릿 노드 id, 이 건에서 더한
   * 작업은 **제 실행 노드 id** 다(2026-11-03, 조각 13). 전에는 추가 작업이
   * null 이었고 그것이 「그림에 자리도 선도 없다」는 뜻이었다.
   */
  graphNodeId: string;
  status: ProcedureCaseExecutionNodeStatus;
  /** Only meaningful when the underlying node is DECISION. */
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
  const nodeTypeByGraphNodeId = new Map(nodes.map((n) => [n.id, n.nodeType]));
  const executionNodeByGraphNodeId = new Map(executionNodes.map((en) => [en.graphNodeId, en]));

  const incomingEdgesByTargetGraphNodeId = new Map<string, TopologyEdge[]>();
  for (const edge of edges) {
    const list = incomingEdgesByTargetGraphNodeId.get(edge.toNodeId) ?? [];
    list.push(edge);
    incomingEdgesByTargetGraphNodeId.set(edge.toNodeId, list);
  }

  const suggested = new Set<string>();

  for (const en of executionNodes) {
    if (en.status !== "PENDING") continue;

    // 🔵 2026-11-03(조각 13)에 **가지 하나가 사라졌다.** 전에는 「추가 작업은
    //    간선이 없으니 무조건 추천」이라는 줄이 따로 있었는데, 이제 추가 작업도
    //    들어오는 선을 가질 수 있어서 **아래 규칙에 그대로 들어맞는다** — 선이
    //    없으면 incoming.length === 0 으로 추천되고(결과가 전과 같다), 선이
    //    있으면 템플릿 노드와 똑같은 잣대로 판정된다.
    const incoming = incomingEdgesByTargetGraphNodeId.get(en.graphNodeId) ?? [];

    if (incoming.length === 0) {
      suggested.add(en.id);
      continue;
    }

    const anySourceReady = incoming.some((edge) => {
      const sourceExecutionNode = executionNodeByGraphNodeId.get(edge.fromNodeId);
      if (!sourceExecutionNode) return false;
      if (sourceExecutionNode.status !== "COMPLETED" && sourceExecutionNode.status !== "SKIPPED") return false;

      const sourceNodeType = nodeTypeByGraphNodeId.get(edge.fromNodeId);
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
