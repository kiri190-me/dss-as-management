import "server-only";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "../client";
import {
  procedureTemplates,
  procedureTemplateNodes,
  procedureTemplateEdges,
  procedureTemplateValidationIssues,
  procedureValidationResolutionHistory,
  users,
} from "../schema";
import type {
  ProcedureBranchType,
  ProcedureNodeType,
  ProcedureTemplateStatus,
  ProcedureValidationIssueType,
  ProcedureValidationResolutionActionType,
  ProcedureValidationResolutionStatus,
  ProcedureValidationSeverity,
} from "@/lib/domain/procedure-template-types";
import {
  classifyKnownValidationIssue,
  type KnownIssueClassification,
} from "@/lib/domain/procedure-validation-known-issues";
import type { ExtractedValidationIssueRawEvidence } from "../../../../scripts/lib/xlsx/types";

export type ValidationIssueListRow = {
  id: string;
  procedureTemplateId: string;
  severity: ProcedureValidationSeverity;
  issueType: ProcedureValidationIssueType;
  message: string;
  sourceWorksheet: string | null;
  sourceReference: string | null;
  resolutionStatus: ProcedureValidationResolutionStatus;
  resolvedAt: string | null;
  resolvedByName: string | null;
  resolutionNote: string | null;
  createdAt: string;
  classification: KnownIssueClassification | undefined;
};

export type ValidationIssueProgressSummary = {
  totalErrorCount: number;
  unresolvedErrorCount: number;
  resolvedErrorCount: number;
  publicationBlockingErrorCount: number;
};

export type ValidationIssueListResult = {
  template: { id: string; code: string; name: string; status: ProcedureTemplateStatus };
  issues: ValidationIssueListRow[];
  summary: ValidationIssueProgressSummary;
};

/**
 * Fetches every validation issue for one template, unfiltered — filtering
 * (unresolved-only / worksheet / issue type / confidence / status) is done
 * client-side in ValidationIssueListScreen.tsx, since "confidence" isn't a
 * database column at all (it comes from the classifier below) and each
 * template's issue count is small enough (≤ ~40) that a second server
 * round-trip per filter change would be pure overhead.
 */
export async function listValidationIssuesForTemplate(templateId: string): Promise<ValidationIssueListResult | null> {
  const [template] = await db
    .select({
      id: procedureTemplates.id,
      code: procedureTemplates.code,
      name: procedureTemplates.name,
      status: procedureTemplates.status,
    })
    .from(procedureTemplates)
    .where(and(eq(procedureTemplates.id, templateId), eq(procedureTemplates.isDeleted, false)));
  if (!template) return null;

  const rows = await db
    .select({
      id: procedureTemplateValidationIssues.id,
      procedureTemplateId: procedureTemplateValidationIssues.procedureTemplateId,
      severity: procedureTemplateValidationIssues.severity,
      issueType: procedureTemplateValidationIssues.issueType,
      message: procedureTemplateValidationIssues.message,
      sourceWorksheet: procedureTemplateValidationIssues.sourceWorksheet,
      sourceReference: procedureTemplateValidationIssues.sourceReference,
      resolutionStatus: procedureTemplateValidationIssues.resolutionStatus,
      resolvedAt: procedureTemplateValidationIssues.resolvedAt,
      resolutionNote: procedureTemplateValidationIssues.resolutionNote,
      createdAt: procedureTemplateValidationIssues.createdAt,
      resolvedByUserId: procedureTemplateValidationIssues.resolvedByUserId,
    })
    .from(procedureTemplateValidationIssues)
    .where(eq(procedureTemplateValidationIssues.procedureTemplateId, templateId))
    .orderBy(desc(procedureTemplateValidationIssues.severity), procedureTemplateValidationIssues.createdAt);

  const resolverIds = [...new Set(rows.map((r) => r.resolvedByUserId).filter((v): v is string => v !== null))];
  const resolverNameById = new Map<string, string>();
  if (resolverIds.length > 0) {
    const resolvers = await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, resolverIds));
    for (const r of resolvers) resolverNameById.set(r.id, r.name);
  }

  const issues: ValidationIssueListRow[] = rows.map((r) => ({
    id: r.id,
    procedureTemplateId: r.procedureTemplateId,
    severity: r.severity,
    issueType: r.issueType as ProcedureValidationIssueType,
    message: r.message,
    sourceWorksheet: r.sourceWorksheet,
    sourceReference: r.sourceReference,
    resolutionStatus: r.resolutionStatus,
    resolvedAt: r.resolvedAt ? r.resolvedAt.toISOString() : null,
    resolvedByName: r.resolvedByUserId ? resolverNameById.get(r.resolvedByUserId) ?? null : null,
    resolutionNote: r.resolutionNote,
    createdAt: r.createdAt.toISOString(),
    classification: classifyKnownValidationIssue({
      templateCode: template.code,
      sourceWorksheet: r.sourceWorksheet ?? "",
      issueType: r.issueType,
      sourceReference: r.sourceReference ?? "",
    }),
  }));

  const errorIssues = issues.filter((i) => i.severity === "ERROR");
  const summary: ValidationIssueProgressSummary = {
    totalErrorCount: errorIssues.length,
    unresolvedErrorCount: errorIssues.filter((i) => i.resolutionStatus === "UNRESOLVED").length,
    resolvedErrorCount: errorIssues.filter(
      (i) => i.resolutionStatus === "RESOLVED_WITH_GRAPH_CHANGE" || i.resolutionStatus === "RESOLVED_NO_CHANGE"
    ).length,
    publicationBlockingErrorCount: errorIssues.filter((i) => i.resolutionStatus === "UNRESOLVED" || i.resolutionStatus === "DEFERRED")
      .length,
  };

  return { template, issues, summary };
}

export type ValidationIssueCandidateRow = {
  shapeId: string;
  nodeId: string | null;
  title: string | null;
  nodeType: ProcedureNodeType | null;
  sourceWorksheet: string;
  distance: number;
  alreadyConnected: boolean;
  whyCandidate: "bound_endpoint" | "proximity";
};

export type ValidationIssueDetailNodeSummary = {
  id: string;
  nodeCode: string;
  nodeType: ProcedureNodeType;
  title: string;
  sourceWorksheet: string | null;
  sourceShapeId: string | null;
};

export type ValidationIssueEdgeSummary = {
  id: string;
  branchType: ProcedureBranchType;
  branchLabel: string | null;
  otherNode: ValidationIssueDetailNodeSummary;
};

export type ValidationIssueDetail = {
  id: string;
  procedureTemplateId: string;
  templateCode: string;
  templateStatus: ProcedureTemplateStatus;
  severity: ProcedureValidationSeverity;
  issueType: ProcedureValidationIssueType;
  message: string;
  sourceWorksheet: string | null;
  sourceReference: string | null;
  resolutionStatus: ProcedureValidationResolutionStatus;
  resolvedAt: string | null;
  resolvedByName: string | null;
  resolutionNote: string | null;
  rawEvidence: ExtractedValidationIssueRawEvidence | null;
  classification: KnownIssueClassification | undefined;
  currentNode: ValidationIssueDetailNodeSummary | null;
  outgoingEdges: ValidationIssueEdgeSummary[];
  incomingEdges: ValidationIssueEdgeSummary[];
  fromCandidates: ValidationIssueCandidateRow[];
  toCandidates: ValidationIssueCandidateRow[];
  candidates: ValidationIssueCandidateRow[];
  /**
   * Phase 3B: the best already-imported node to center the graph on when
   * `currentNode` is null (an unbound-connector issue with no single
   * "current node" field) — the nearest ranked candidate that is already a
   * real, connected node, falling back to the single nearest candidate
   * regardless of connection state. Null when there is truly no candidate
   * at all. Never set when `currentNode` is already known — that is always
   * the exact match, not an approximation.
   */
  fallbackNodeId: string | null;
};

function shapeRefFromSourceReference(sourceReference: string | null): string | null {
  const m = sourceReference?.match(/shape#(\w+)/);
  return m ? m[1] : null;
}

export async function getValidationIssueDetail(issueId: string): Promise<ValidationIssueDetail | null> {
  const [issue] = await db.select().from(procedureTemplateValidationIssues).where(eq(procedureTemplateValidationIssues.id, issueId));
  if (!issue) return null;

  const [template] = await db
    .select()
    .from(procedureTemplates)
    .where(and(eq(procedureTemplates.id, issue.procedureTemplateId), eq(procedureTemplates.isDeleted, false)));
  if (!template) return null;

  let resolvedByName: string | null = null;
  if (issue.resolvedByUserId) {
    const [resolver] = await db.select({ name: users.name }).from(users).where(eq(users.id, issue.resolvedByUserId));
    resolvedByName = resolver?.name ?? null;
  }

  const allNodes = await db
    .select()
    .from(procedureTemplateNodes)
    .where(eq(procedureTemplateNodes.procedureTemplateId, issue.procedureTemplateId));
  const allEdges = await db
    .select()
    .from(procedureTemplateEdges)
    .where(eq(procedureTemplateEdges.procedureTemplateId, issue.procedureTemplateId));

  const nodeByShapeAndSheet = new Map<string, (typeof allNodes)[number]>();
  for (const n of allNodes) {
    if (n.sourceShapeId && n.sourceWorksheet) nodeByShapeAndSheet.set(`${n.sourceWorksheet}::${n.sourceShapeId}`, n);
  }
  const nodeById = new Map(allNodes.map((n) => [n.id, n]));

  const rawEvidence = (issue.rawEvidence as ExtractedValidationIssueRawEvidence | null) ?? null;
  // For a MISSING_OUTGOING_PATH issue, rawEvidence.shapeId *is* the current
  // node. For a DANGLING_CONNECTOR/MISSING_SOURCE_NODE issue there's no
  // single "current node" field — fall back to whichever endpoint the
  // connector still has bound (stCxnId, else endCxnId), and only then to
  // parsing sourceReference (covers the rare case with no rawEvidence at
  // all, e.g. an issue imported before this column existed).
  const issueShapeId =
    rawEvidence?.shapeId ?? rawEvidence?.stCxnId ?? rawEvidence?.endCxnId ?? shapeRefFromSourceReference(issue.sourceReference);
  const currentNodeRow = issueShapeId && issue.sourceWorksheet ? nodeByShapeAndSheet.get(`${issue.sourceWorksheet}::${issueShapeId}`) : null;

  const toSummary = (n: (typeof allNodes)[number]): ValidationIssueDetailNodeSummary => ({
    id: n.id,
    nodeCode: n.nodeCode,
    nodeType: n.nodeType,
    title: n.title,
    sourceWorksheet: n.sourceWorksheet,
    sourceShapeId: n.sourceShapeId,
  });

  const outgoingEdges: ValidationIssueEdgeSummary[] = currentNodeRow
    ? allEdges
        .filter((e) => e.fromNodeId === currentNodeRow.id)
        .map((e) => ({ id: e.id, branchType: e.branchType, branchLabel: e.branchLabel, otherNode: toSummary(nodeById.get(e.toNodeId)!) }))
    : [];
  const incomingEdges: ValidationIssueEdgeSummary[] = currentNodeRow
    ? allEdges
        .filter((e) => e.toNodeId === currentNodeRow.id)
        .map((e) => ({ id: e.id, branchType: e.branchType, branchLabel: e.branchLabel, otherNode: toSummary(nodeById.get(e.fromNodeId)!) }))
    : [];

  const connectedShapeIds = new Set<string>();
  for (const e of allEdges) {
    const from = nodeById.get(e.fromNodeId);
    const to = nodeById.get(e.toNodeId);
    if (from?.sourceShapeId) connectedShapeIds.add(from.sourceShapeId);
    if (to?.sourceShapeId) connectedShapeIds.add(to.sourceShapeId);
  }

  function annotateCandidates(
    candidates: { shapeId: string; text: string; distance: number }[] | undefined,
    boundEndpointShapeId: string | null | undefined
  ): ValidationIssueCandidateRow[] {
    if (!candidates) return [];
    return candidates.map((c) => {
      const node = issue.sourceWorksheet ? nodeByShapeAndSheet.get(`${issue.sourceWorksheet}::${c.shapeId}`) : undefined;
      return {
        shapeId: c.shapeId,
        nodeId: node?.id ?? null,
        title: node?.title ?? c.text,
        nodeType: node?.nodeType ?? null,
        sourceWorksheet: issue.sourceWorksheet ?? "",
        distance: c.distance,
        alreadyConnected: connectedShapeIds.has(c.shapeId),
        whyCandidate: boundEndpointShapeId === c.shapeId ? "bound_endpoint" : "proximity",
      };
    });
  }

  const fromCandidates = annotateCandidates(rawEvidence?.fromCandidates, rawEvidence?.stCxnId);
  const toCandidates = annotateCandidates(rawEvidence?.toCandidates, rawEvidence?.endCxnId);
  const candidates = annotateCandidates(rawEvidence?.candidates, null);

  // "center on the nearest bound source or target node" for an issue with
  // no single current node — prefer a ranked candidate that is already a
  // real, connected node over one that was merely proximity-ranked, since
  // an already-connected shape is a genuine existing node in the graph.
  const fallbackNodeId = currentNodeRow
    ? null
    : ([...fromCandidates, ...toCandidates, ...candidates].find((c) => c.alreadyConnected && c.nodeId)?.nodeId ??
      [...fromCandidates, ...toCandidates, ...candidates].find((c) => c.nodeId)?.nodeId ??
      null);

  return {
    id: issue.id,
    procedureTemplateId: issue.procedureTemplateId,
    templateCode: template.code,
    templateStatus: template.status,
    severity: issue.severity,
    issueType: issue.issueType as ProcedureValidationIssueType,
    message: issue.message,
    sourceWorksheet: issue.sourceWorksheet,
    sourceReference: issue.sourceReference,
    resolutionStatus: issue.resolutionStatus,
    resolvedAt: issue.resolvedAt ? issue.resolvedAt.toISOString() : null,
    resolvedByName,
    resolutionNote: issue.resolutionNote,
    rawEvidence,
    classification: classifyKnownValidationIssue({
      templateCode: template.code,
      sourceWorksheet: issue.sourceWorksheet ?? "",
      issueType: issue.issueType,
      sourceReference: issue.sourceReference ?? "",
    }),
    currentNode: currentNodeRow ? toSummary(currentNodeRow) : null,
    outgoingEdges,
    incomingEdges,
    fromCandidates,
    toCandidates,
    candidates,
    fallbackNodeId,
  };
}

export type ValidationResolutionHistoryRow = {
  id: string;
  actionType: ProcedureValidationResolutionActionType;
  beforeState: unknown;
  afterState: unknown;
  selectedNodeId: string | null;
  affectedEdgeId: string | null;
  branchType: ProcedureBranchType | null;
  note: string | null;
  actorName: string;
  createdAt: string;
};

export async function getValidationResolutionHistory(issueId: string): Promise<ValidationResolutionHistoryRow[]> {
  const rows = await db
    .select({
      id: procedureValidationResolutionHistory.id,
      actionType: procedureValidationResolutionHistory.actionType,
      beforeState: procedureValidationResolutionHistory.beforeState,
      afterState: procedureValidationResolutionHistory.afterState,
      selectedNodeId: procedureValidationResolutionHistory.selectedNodeId,
      affectedEdgeId: procedureValidationResolutionHistory.affectedEdgeId,
      branchType: procedureValidationResolutionHistory.branchType,
      note: procedureValidationResolutionHistory.note,
      createdAt: procedureValidationResolutionHistory.createdAt,
      actorName: users.name,
    })
    .from(procedureValidationResolutionHistory)
    .innerJoin(users, eq(procedureValidationResolutionHistory.actorUserId, users.id))
    .where(eq(procedureValidationResolutionHistory.validationIssueId, issueId))
    .orderBy(desc(procedureValidationResolutionHistory.createdAt));

  return rows.map((r) => ({
    id: r.id,
    actionType: r.actionType,
    beforeState: r.beforeState,
    afterState: r.afterState,
    selectedNodeId: r.selectedNodeId,
    affectedEdgeId: r.affectedEdgeId,
    branchType: r.branchType,
    note: r.note,
    actorName: r.actorName,
    createdAt: r.createdAt.toISOString(),
  }));
}

/** Every distinct node this issue's template belongs to — used by BindConnectorForm's node pickers, scoped to the issue's own template (never cross-template). */
export async function listTemplateNodesForBinding(
  templateId: string
): Promise<{ id: string; nodeCode: string; title: string; nodeType: ProcedureNodeType; sourceWorksheet: string | null }[]> {
  const rows = await db
    .select({
      id: procedureTemplateNodes.id,
      nodeCode: procedureTemplateNodes.nodeCode,
      title: procedureTemplateNodes.title,
      nodeType: procedureTemplateNodes.nodeType,
      sourceWorksheet: procedureTemplateNodes.sourceWorksheet,
    })
    .from(procedureTemplateNodes)
    .where(and(eq(procedureTemplateNodes.procedureTemplateId, templateId)))
    .orderBy(procedureTemplateNodes.sortOrder);
  return rows;
}
