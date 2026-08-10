import "server-only";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "../client";
import {
  procedureTemplates,
  procedureTemplateNodes,
  procedureTemplateEdges,
  procedureChecklistSections,
  procedureTroubleshootingEntries,
  procedureTemplateValidationIssues,
  procedureTemplateEditHistory,
  users,
} from "../schema";
import type {
  ProcedureBranchType,
  ProcedureNodeType,
  ProcedureTemplateStatus,
  ProcedureEquipmentType,
  ProcedureValidationSeverity,
  ProcedureValidationIssueType,
} from "@/lib/domain/procedure-template-types";
import { validateProcedureGraphStructure, countBySeverity } from "@/lib/domain/procedure-graph-structural-validation";
import { resolveEffectiveNodePosition } from "@/lib/graph-editor-core/layout";
import { compareDraftAndParentGraphs, type DraftParentComparison, type DiffNode, type DiffEdge } from "@/lib/domain/procedure-template-diff";

export type EditorNodeRow = {
  id: string;
  nodeCode: string;
  nodeType: ProcedureNodeType;
  title: string;
  description: string | null;
  instructions: string | null;
  objective: string | null;
  preparation: string | null;
  toolsAndEquipment: string | null;
  safetyCaution: string | null;
  expectedNormalResult: string | null;
  ngSymptoms: string | null;
  recommendedCorrectiveAction: string | null;
  acceptanceCriteria: string | null;
  workerMayAddNextTask: boolean;
  positionX: number;
  positionY: number;
  userPositionX: number | null;
  userPositionY: number | null;
  sortOrder: number;
  sourceWorksheet: string | null;
  sourceShapeId: string | null;
  sourceCellRange: string | null;
  isActive: boolean;
  /** Future-execution-content markers (Phase 4B groundwork) — never new columns, just what the existing model already distinguishes. */
  hasChecklistContent: boolean;
  hasTroubleshootingContent: boolean;
};

export type RoutePoint = { x: number; y: number };

export type EditorEdgeRow = {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  branchType: ProcedureBranchType;
  branchLabel: string | null;
  sortOrder: number;
  sourceConnectorId: string | null;
  clonedFromEdgeId: string | null;
  /** Phase 4B — 사용자 배치 manual-route override; null means "use deterministic routing." See resolveEffectiveEdgeRoute in procedure-edge-waypoints.ts. */
  userRoutePoints: RoutePoint[] | null;
};

export type EditorUnresolvedIssue = {
  id: string;
  severity: ProcedureValidationSeverity;
  issueType: ProcedureValidationIssueType;
  message: string;
  sourceWorksheet: string | null;
  sourceReference: string | null;
};

export type ProcedureTemplateForEditor = {
  id: string;
  code: string;
  name: string;
  equipmentType: ProcedureEquipmentType;
  description: string | null;
  status: ProcedureTemplateStatus;
  isReferenceOnly: boolean;
  version: number;
  supersedesTemplateId: string | null;
  /** ISO string — the optimistic-concurrency token every editor mutation expects back (procedure-template-editor.ts's expectedTemplateUpdatedAt). */
  updatedAt: string;
  createdByName: string;
  nodes: EditorNodeRow[];
  edges: EditorEdgeRow[];
  unresolvedIssues: EditorUnresolvedIssue[];
};

async function loadNodesWithContentMarkers(templateId: string): Promise<EditorNodeRow[]> {
  const nodes = await db.select().from(procedureTemplateNodes).where(eq(procedureTemplateNodes.procedureTemplateId, templateId));
  const nodeIds = nodes.map((n) => n.id);

  const checklistNodeIds = new Set<string>();
  const troubleshootingNodeIds = new Set<string>();
  if (nodeIds.length > 0) {
    const sections = await db.select({ nodeId: procedureChecklistSections.nodeId }).from(procedureChecklistSections).where(inArray(procedureChecklistSections.nodeId, nodeIds));
    for (const s of sections) checklistNodeIds.add(s.nodeId);
    const entries = await db.select({ nodeId: procedureTroubleshootingEntries.nodeId }).from(procedureTroubleshootingEntries).where(inArray(procedureTroubleshootingEntries.nodeId, nodeIds));
    for (const e of entries) troubleshootingNodeIds.add(e.nodeId);
  }

  return nodes.map((n) => ({
    id: n.id,
    nodeCode: n.nodeCode,
    nodeType: n.nodeType,
    title: n.title,
    description: n.description,
    instructions: n.instructions,
    objective: n.objective,
    preparation: n.preparation,
    toolsAndEquipment: n.toolsAndEquipment,
    safetyCaution: n.safetyCaution,
    expectedNormalResult: n.expectedNormalResult,
    ngSymptoms: n.ngSymptoms,
    recommendedCorrectiveAction: n.recommendedCorrectiveAction,
    acceptanceCriteria: n.acceptanceCriteria,
    workerMayAddNextTask: n.workerMayAddNextTask,
    positionX: n.positionX,
    positionY: n.positionY,
    userPositionX: n.userPositionX,
    userPositionY: n.userPositionY,
    sortOrder: n.sortOrder,
    sourceWorksheet: n.sourceWorksheet,
    sourceShapeId: n.sourceShapeId,
    sourceCellRange: n.sourceCellRange,
    isActive: n.isActive,
    hasChecklistContent: checklistNodeIds.has(n.id),
    hasTroubleshootingContent: troubleshootingNodeIds.has(n.id),
  }));
}

export async function getProcedureTemplateForEditor(templateId: string): Promise<ProcedureTemplateForEditor | null> {
  const [template] = await db.select().from(procedureTemplates).where(eq(procedureTemplates.id, templateId));
  if (!template) return null;

  const [creator] = await db.select({ name: users.name }).from(users).where(eq(users.id, template.createdByUserId));

  const nodes = await loadNodesWithContentMarkers(templateId);
  const edgeRows = await db.select().from(procedureTemplateEdges).where(eq(procedureTemplateEdges.procedureTemplateId, templateId));
  const edges: EditorEdgeRow[] = edgeRows.map((e) => ({
    id: e.id,
    fromNodeId: e.fromNodeId,
    toNodeId: e.toNodeId,
    branchType: e.branchType,
    branchLabel: e.branchLabel,
    sortOrder: e.sortOrder,
    sourceConnectorId: e.sourceConnectorId,
    clonedFromEdgeId: e.clonedFromEdgeId,
    userRoutePoints: e.userRoutePoints ?? null,
  }));

  const unresolvedIssueRows = await db
    .select({
      id: procedureTemplateValidationIssues.id,
      severity: procedureTemplateValidationIssues.severity,
      issueType: procedureTemplateValidationIssues.issueType,
      message: procedureTemplateValidationIssues.message,
      sourceWorksheet: procedureTemplateValidationIssues.sourceWorksheet,
      sourceReference: procedureTemplateValidationIssues.sourceReference,
    })
    .from(procedureTemplateValidationIssues)
    .where(
      and(
        eq(procedureTemplateValidationIssues.procedureTemplateId, templateId),
        inArray(procedureTemplateValidationIssues.resolutionStatus, ["UNRESOLVED", "DEFERRED"])
      )
    );

  return {
    id: template.id,
    code: template.code,
    name: template.name,
    equipmentType: template.equipmentType,
    description: template.description,
    status: template.status,
    isReferenceOnly: template.isReferenceOnly,
    version: template.version,
    supersedesTemplateId: template.supersedesTemplateId,
    updatedAt: template.updatedAt.toISOString(),
    createdByName: creator?.name ?? "-",
    nodes,
    edges,
    unresolvedIssues: unresolvedIssueRows.map((i) => ({ ...i, issueType: i.issueType as ProcedureValidationIssueType })),
  };
}

export type EditHistoryRow = {
  id: string;
  actionType: string;
  nodeId: string | null;
  edgeId: string | null;
  beforeState: unknown;
  afterState: unknown;
  reason: string | null;
  relatedValidationIssueId: string | null;
  actorName: string;
  createdAt: string;
};

/** Newest first — append-only, same read convention as Phase 3A's getValidationResolutionHistory. */
export async function getProcedureTemplateEditHistory(templateId: string): Promise<EditHistoryRow[]> {
  const rows = await db
    .select({
      id: procedureTemplateEditHistory.id,
      actionType: procedureTemplateEditHistory.actionType,
      nodeId: procedureTemplateEditHistory.nodeId,
      edgeId: procedureTemplateEditHistory.edgeId,
      beforeState: procedureTemplateEditHistory.beforeState,
      afterState: procedureTemplateEditHistory.afterState,
      reason: procedureTemplateEditHistory.reason,
      relatedValidationIssueId: procedureTemplateEditHistory.relatedValidationIssueId,
      createdAt: procedureTemplateEditHistory.createdAt,
      actorName: users.name,
    })
    .from(procedureTemplateEditHistory)
    .innerJoin(users, eq(procedureTemplateEditHistory.actorUserId, users.id))
    .where(eq(procedureTemplateEditHistory.procedureTemplateId, templateId))
    .orderBy(desc(procedureTemplateEditHistory.createdAt));

  return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
}

export type DraftParentComparisonResult =
  | { ok: true; parentTemplateId: string; parentVersion: number; comparison: DraftParentComparison; draftUnresolvedCount: { errorCount: number; warningCount: number }; parentUnresolvedCount: { errorCount: number; warningCount: number } }
  | { ok: false; code: "NOT_FOUND" | "NO_PARENT" };

function toDiffNode(n: EditorNodeRow): DiffNode {
  const { x, y } = resolveEffectiveNodePosition(n, "USER");
  return {
    id: n.id,
    nodeCode: n.nodeCode,
    title: n.title,
    nodeType: n.nodeType,
    description: n.description,
    instructions: n.instructions,
    sortOrder: n.sortOrder,
    isActive: n.isActive,
    effectiveX: x,
    effectiveY: y,
  };
}

function toDiffEdges(edges: EditorEdgeRow[], nodeCodeById: Map<string, string>): DiffEdge[] {
  return edges
    .map((e) => {
      const fromNodeCode = nodeCodeById.get(e.fromNodeId);
      const toNodeCode = nodeCodeById.get(e.toNodeId);
      if (!fromNodeCode || !toNodeCode) return null;
      return { id: e.id, clonedFromEdgeId: e.clonedFromEdgeId, fromNodeCode, toNodeCode, branchType: e.branchType, branchLabel: e.branchLabel, userRoutePoints: e.userRoutePoints };
    })
    .filter((e): e is DiffEdge => e !== null);
}

/**
 * DRAFT-vs-parent comparison (this task's requirement 11) — the "parent"
 * is always the exact PUBLISHED row supersedes_template_id points at, the
 * one this DRAFT was cloned from. draftUnresolvedCount is computed live
 * from the structural validator (a DRAFT never carries copied
 * procedure_template_validation_issues rows — see createNewDraftVersion's
 * own doc comment: "a new draft starts with a clean validation slate"), so
 * this is a deliberate, documented approximation: it compares the parent's
 * *stored* Phase 3A issue count against the draft's *live* Phase 4A
 * structural-issue count, not the same category of issue on both sides.
 */
export async function compareDraftWithParent(draftTemplateId: string): Promise<DraftParentComparisonResult> {
  const draft = await getProcedureTemplateForEditor(draftTemplateId);
  if (!draft) return { ok: false, code: "NOT_FOUND" };
  if (!draft.supersedesTemplateId) return { ok: false, code: "NO_PARENT" };

  const parent = await getProcedureTemplateForEditor(draft.supersedesTemplateId);
  if (!parent) return { ok: false, code: "NOT_FOUND" };

  const draftNodeCodeById = new Map(draft.nodes.map((n) => [n.id, n.nodeCode]));
  const parentNodeCodeById = new Map(parent.nodes.map((n) => [n.id, n.nodeCode]));

  const comparison = compareDraftAndParentGraphs(
    draft.nodes.map(toDiffNode),
    toDiffEdges(draft.edges, draftNodeCodeById),
    parent.nodes.map(toDiffNode),
    toDiffEdges(parent.edges, parentNodeCodeById)
  );

  const draftStructural = countBySeverity(validateProcedureGraphStructure(draft.nodes, draft.edges));
  const parentUnresolvedError = parent.unresolvedIssues.filter((i) => i.severity === "ERROR").length;
  const parentUnresolvedWarning = parent.unresolvedIssues.filter((i) => i.severity === "WARNING").length;

  return {
    ok: true,
    parentTemplateId: parent.id,
    parentVersion: parent.version,
    comparison,
    draftUnresolvedCount: { errorCount: draftStructural.errorCount, warningCount: draftStructural.warningCount },
    parentUnresolvedCount: { errorCount: parentUnresolvedError, warningCount: parentUnresolvedWarning },
  };
}
