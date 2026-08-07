import type { ProcedureBranchType, ProcedureNodeType, ProcedureValidationIssueType, ProcedureValidationSeverity } from "./procedure-template-types";

/**
 * Phase 4A — deterministic structural validation over an already-imported
 * node/edge graph (never raw workbook shapes/connectors — that's the
 * importer's job in scripts/lib/xlsx/extract-shape-graph.ts). This is what
 * the editor's "Validate" action and the publish gate both run after a
 * graph edit, so a reviewer never has to re-import a workbook just to find
 * out a retarget or type change broke the flow's structure.
 *
 * Pure, no DOM/DB/React — a plain function of the graph itself (plus two
 * optional presence sets for the checklist/troubleshooting-reference
 * check). Never mutates its inputs, never writes to
 * procedure_template_validation_issues (that table is Phase 3A's
 * import-time issue queue with its own resolution workflow) — findings
 * here are always freshly computed, shown to the reviewer, and (for ERROR
 * severity) checked again independently by the publish gate.
 */

export type StructuralValidationNode = {
  id: string;
  nodeType: ProcedureNodeType;
};

export type StructuralValidationEdge = {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  branchType: ProcedureBranchType;
};

export type StructuralValidationContext = {
  /** node ids that already have at least one procedure_checklist_sections row — only CHECKLIST nodes are checked against this. */
  nodeIdsWithChecklistContent?: Set<string>;
  /** node ids that already have at least one procedure_troubleshooting_entries row — only TROUBLESHOOTING nodes are checked against this. */
  nodeIdsWithTroubleshootingContent?: Set<string>;
};

export type StructuralValidationIssue = {
  severity: ProcedureValidationSeverity;
  issueType: ProcedureValidationIssueType;
  message: string;
  nodeId?: string;
  edgeId?: string;
};

/** Branch types that only make sense as a DECISION node's outcome — YES/NO/NG read as "the answer to a question," which only a DECISION node poses. RETRY/LOOP_BACK/DEFAULT/CUSTOM/NORMAL carry no such restriction (the two real RFG LOOP_BACK edges both originate from an ordinary TASK-family node, not a DECISION). */
const DECISION_ONLY_BRANCH_TYPES: ReadonlySet<ProcedureBranchType> = new Set(["YES", "NO", "NG", "NORMAL"]);
/** A DECISION node's outgoing set must include at least one of these "continue" outcomes — mirrors the importer's existing MISSING_OUTGOING_PATH rule (Phase 1). */
const DECISION_CONTINUE_BRANCH_TYPES: ReadonlySet<ProcedureBranchType> = new Set(["DEFAULT", "NORMAL", "YES"]);
const LOOPBACK_BRANCH_TYPES: ReadonlySet<ProcedureBranchType> = new Set(["RETRY", "LOOP_BACK"]);

export function validateProcedureGraphStructure(
  nodes: StructuralValidationNode[],
  edges: StructuralValidationEdge[],
  context: StructuralValidationContext = {}
): StructuralValidationIssue[] {
  const issues: StructuralValidationIssue[] = [];
  const nodeById = new Map(nodes.map((n) => [n.id, n]));

  const incomingByNode = new Map<string, StructuralValidationEdge[]>();
  const outgoingByNode = new Map<string, StructuralValidationEdge[]>();
  for (const n of nodes) {
    incomingByNode.set(n.id, []);
    outgoingByNode.set(n.id, []);
  }

  const seenEdgeKeys = new Set<string>();
  for (const e of edges) {
    if (e.fromNodeId === e.toNodeId) {
      issues.push({ severity: "ERROR", issueType: "INVALID_SELF_EDGE", message: "분기의 시작과 대상 노드가 동일합니다.", edgeId: e.id, nodeId: e.fromNodeId });
    }

    const fromExists = nodeById.has(e.fromNodeId);
    const toExists = nodeById.has(e.toNodeId);
    if (!fromExists || !toExists) {
      issues.push({
        severity: "ERROR",
        issueType: "CROSS_TEMPLATE_REFERENCE",
        message: "분기가 이 템플릿에 속하지 않은 노드를 참조합니다.",
        edgeId: e.id,
      });
      // Can't safely reason about reachability/branch rules for an edge
      // pointing outside this template's own node set.
      continue;
    }

    const key = `${e.fromNodeId}::${e.toNodeId}::${e.branchType}`;
    if (seenEdgeKeys.has(key)) {
      issues.push({ severity: "ERROR", issueType: "DUPLICATE_EDGE", message: "동일한 시작/대상/분기 유형을 가진 분기가 이미 존재합니다.", edgeId: e.id });
    }
    seenEdgeKeys.add(key);

    outgoingByNode.get(e.fromNodeId)!.push(e);
    incomingByNode.get(e.toNodeId)!.push(e);

    const fromNode = nodeById.get(e.fromNodeId)!;
    const toNode = nodeById.get(e.toNodeId)!;

    if (DECISION_ONLY_BRANCH_TYPES.has(e.branchType) && fromNode.nodeType !== "DECISION") {
      issues.push({
        severity: "ERROR",
        issueType: "INVALID_BRANCH_TYPE_FOR_NODE",
        message: `"${e.branchType}" 분기 유형은 판단(DECISION) 노드에서만 사용할 수 있습니다.`,
        edgeId: e.id,
        nodeId: e.fromNodeId,
      });
    }

    if (LOOPBACK_BRANCH_TYPES.has(e.branchType) && toNode.nodeType === "END") {
      issues.push({
        severity: "ERROR",
        issueType: "INVALID_LOOP_BACK_TARGET",
        message: "재측정/재진행 분기는 종료(END) 노드를 대상으로 할 수 없습니다.",
        edgeId: e.id,
        nodeId: e.toNodeId,
      });
    }
  }

  for (const n of nodes) {
    const incoming = incomingByNode.get(n.id) ?? [];
    const outgoing = outgoingByNode.get(n.id) ?? [];

    if (n.nodeType === "START") {
      if (incoming.length > 0) {
        issues.push({ severity: "ERROR", issueType: "INVALID_START_STRUCTURE", message: "시작(START) 노드는 들어오는 분기를 가질 수 없습니다.", nodeId: n.id });
      }
      if (outgoing.length === 0) {
        issues.push({ severity: "ERROR", issueType: "INVALID_START_STRUCTURE", message: "시작(START) 노드는 최소 하나의 나가는 분기가 있어야 합니다.", nodeId: n.id });
      }
    }

    if (n.nodeType === "END") {
      if (outgoing.length > 0) {
        issues.push({ severity: "ERROR", issueType: "INVALID_END_STRUCTURE", message: "종료(END) 노드는 나가는 분기를 가질 수 없습니다.", nodeId: n.id });
      }
      if (incoming.length === 0) {
        issues.push({ severity: "ERROR", issueType: "INVALID_END_STRUCTURE", message: "종료(END) 노드는 최소 하나의 들어오는 분기가 있어야 합니다.", nodeId: n.id });
      }
    }

    if (n.nodeType === "DECISION" && outgoing.length > 0) {
      const hasContinuePath = outgoing.some((e) => DECISION_CONTINUE_BRANCH_TYPES.has(e.branchType));
      if (!hasContinuePath) {
        issues.push({
          severity: "ERROR",
          issueType: "MISSING_OUTGOING_PATH",
          message: "판단 노드에 정상/기본 진행 경로가 없습니다.",
          nodeId: n.id,
        });
      }
    }

    if (n.nodeType === "DOCUMENT_REFERENCE" && outgoing.length > 0) {
      issues.push({
        severity: "WARNING",
        issueType: "REFERENCE_NODE_IN_EXECUTABLE_PATH",
        message: "참조(DOCUMENT_REFERENCE) 노드가 실행 경로의 일부로 사용되고 있습니다 (나가는 분기 존재).",
        nodeId: n.id,
      });
    }

    if (incoming.length === 0 && outgoing.length === 0 && n.nodeType !== "CHECKLIST" && n.nodeType !== "TROUBLESHOOTING") {
      issues.push({ severity: "WARNING", issueType: "ORPHAN_NODE", message: "다른 노드와 연결되지 않은 고립된 노드입니다.", nodeId: n.id });
    }

    if (n.nodeType === "CHECKLIST" && context.nodeIdsWithChecklistContent && !context.nodeIdsWithChecklistContent.has(n.id)) {
      issues.push({
        severity: "WARNING",
        issueType: "INVALID_CHECKLIST_OR_TROUBLESHOOTING_REFERENCE",
        message: "체크리스트 노드에 연결된 체크리스트 섹션이 없습니다.",
        nodeId: n.id,
      });
    }
    if (
      n.nodeType === "TROUBLESHOOTING" &&
      context.nodeIdsWithTroubleshootingContent &&
      !context.nodeIdsWithTroubleshootingContent.has(n.id)
    ) {
      issues.push({
        severity: "WARNING",
        issueType: "INVALID_CHECKLIST_OR_TROUBLESHOOTING_REFERENCE",
        message: "고장 진단표 노드에 연결된 진단 항목이 없습니다.",
        nodeId: n.id,
      });
    }
  }

  // Reachability (BFS from every START node, over outgoing edges) — only
  // flags a node as UNREACHABLE when it actually has at least one edge
  // (an edge-less node is ORPHAN_NODE above instead, a distinct condition).
  const startIds = nodes.filter((n) => n.nodeType === "START").map((n) => n.id);
  const reachable = new Set<string>(startIds);
  const queue = [...startIds];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const e of outgoingByNode.get(current) ?? []) {
      if (!reachable.has(e.toNodeId)) {
        reachable.add(e.toNodeId);
        queue.push(e.toNodeId);
      }
    }
  }
  for (const n of nodes) {
    const hasAnyEdge = (incomingByNode.get(n.id)?.length ?? 0) > 0 || (outgoingByNode.get(n.id)?.length ?? 0) > 0;
    if (hasAnyEdge && !reachable.has(n.id)) {
      issues.push({ severity: "WARNING", issueType: "UNREACHABLE_NODE", message: "시작 노드로부터 도달할 수 없는 노드입니다.", nodeId: n.id });
    }
  }

  return issues;
}

export function countBySeverity(issues: StructuralValidationIssue[]): { errorCount: number; warningCount: number; infoCount: number } {
  let errorCount = 0;
  let warningCount = 0;
  let infoCount = 0;
  for (const i of issues) {
    if (i.severity === "ERROR") errorCount++;
    else if (i.severity === "WARNING") warningCount++;
    else infoCount++;
  }
  return { errorCount, warningCount, infoCount };
}
