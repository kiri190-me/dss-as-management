import "server-only";
import { and, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "../client";
import {
  procedureTemplates,
  procedureTemplateNodes,
  procedureTemplateEdges,
  procedureChecklistSections,
  procedureChecklistItems,
  procedureTroubleshootingEntries,
  procedureTemplateValidationIssues,
  procedureReferenceItems,
  procedureCaseExecutions,
  users,
} from "../schema";
import type {
  ProcedureBranchType,
  ProcedureEquipmentType,
  ProcedureNodeType,
  ProcedureReferenceItemType,
  ProcedureTemplateCategory,
  ProcedureTemplateSourceType,
  ProcedureTemplateStatus,
  ProcedureValidationIssueType,
  ProcedureValidationSeverity,
} from "@/lib/domain/procedure-template-types";
import { parseSourceReference } from "@/lib/domain/procedure-graph-navigation";

export type ProcedureTemplateListRow = {
  id: string;
  code: string;
  name: string;
  equipmentType: ProcedureEquipmentType;
  category: ProcedureTemplateCategory;
  version: number;
  status: ProcedureTemplateStatus;
  sourceType: ProcedureTemplateSourceType;
  sourceFileName: string | null;
  isReferenceOnly: boolean;
  sourceWorksheetCount: number;
  nodeCount: number;
  checklistItemCount: number;
  referenceItemCount: number;
  validationWarningCount: number;
  validationErrorCount: number;
  createdAt: string;
  publishedAt: string | null;
};

/**
 * List for /procedures. `includeAllStatuses` gates DRAFT/ARCHIVED
 * visibility — the caller (the page) decides this from the acting user's
 * role via canViewAllProcedureTemplateStatuses, never from a client-passed
 * flag, so this function's own default (published-only) is the safe one
 * if a caller ever forgets to pass it explicitly.
 */
export async function listProcedureTemplates(
  includeAllStatuses: boolean
): Promise<ProcedureTemplateListRow[]> {
  const templates = await db
    .select()
    .from(procedureTemplates)
    .where(
      and(
        // 휴지통에 있는 절차는 어느 목록에도 나오지 않는다 — 기술 절차
        // 휴지통 체크포인트. 이 한 줄이 빠지면 지운 절차가 계속 보인다.
        eq(procedureTemplates.isDeleted, false),
        includeAllStatuses ? undefined : eq(procedureTemplates.status, "PUBLISHED")
      )
    )
    .orderBy(desc(procedureTemplates.createdAt));
  if (templates.length === 0) return [];

  const templateIds = templates.map((t) => t.id);

  const nodeAgg = await db
    .select({
      templateId: procedureTemplateNodes.procedureTemplateId,
      nodeCount: sql<number>`count(*)::int`,
      worksheetCount: sql<number>`count(distinct ${procedureTemplateNodes.sourceWorksheet})::int`,
    })
    .from(procedureTemplateNodes)
    .where(inArray(procedureTemplateNodes.procedureTemplateId, templateIds))
    .groupBy(procedureTemplateNodes.procedureTemplateId);
  const nodeAggByTemplate = new Map(nodeAgg.map((r) => [r.templateId, r]));

  const referenceAgg = await db
    .select({
      templateId: procedureReferenceItems.procedureTemplateId,
      itemCount: sql<number>`count(*)::int`,
      worksheetCount: sql<number>`count(distinct ${procedureReferenceItems.sourceWorksheet})::int`,
    })
    .from(procedureReferenceItems)
    .where(inArray(procedureReferenceItems.procedureTemplateId, templateIds))
    .groupBy(procedureReferenceItems.procedureTemplateId);
  const referenceAggByTemplate = new Map(referenceAgg.map((r) => [r.templateId, r]));

  const checklistAgg = await db
    .select({
      templateId: procedureTemplateNodes.procedureTemplateId,
      itemCount: sql<number>`count(${procedureChecklistItems.id})::int`,
    })
    .from(procedureChecklistItems)
    .innerJoin(procedureChecklistSections, eq(procedureChecklistItems.sectionId, procedureChecklistSections.id))
    .innerJoin(procedureTemplateNodes, eq(procedureChecklistSections.nodeId, procedureTemplateNodes.id))
    .where(inArray(procedureTemplateNodes.procedureTemplateId, templateIds))
    .groupBy(procedureTemplateNodes.procedureTemplateId);
  const checklistCountByTemplate = new Map(checklistAgg.map((r) => [r.templateId, r.itemCount]));

  const issueAgg = await db
    .select({
      templateId: procedureTemplateValidationIssues.procedureTemplateId,
      severity: procedureTemplateValidationIssues.severity,
      count: sql<number>`count(*)::int`,
    })
    .from(procedureTemplateValidationIssues)
    .where(
      and(
        inArray(procedureTemplateValidationIssues.procedureTemplateId, templateIds),
        isNull(procedureTemplateValidationIssues.resolvedAt)
      )
    )
    .groupBy(procedureTemplateValidationIssues.procedureTemplateId, procedureTemplateValidationIssues.severity);
  const warningCountByTemplate = new Map<string, number>();
  const errorCountByTemplate = new Map<string, number>();
  for (const row of issueAgg) {
    if (row.severity === "WARNING") warningCountByTemplate.set(row.templateId, row.count);
    if (row.severity === "ERROR") errorCountByTemplate.set(row.templateId, row.count);
  }

  return templates.map((t) => ({
    id: t.id,
    code: t.code,
    name: t.name,
    equipmentType: t.equipmentType,
    category: t.category,
    version: t.version,
    status: t.status,
    sourceType: t.sourceType,
    sourceFileName: t.sourceFileName,
    isReferenceOnly: t.isReferenceOnly,
    sourceWorksheetCount:
      nodeAggByTemplate.get(t.id)?.worksheetCount ?? referenceAggByTemplate.get(t.id)?.worksheetCount ?? 0,
    nodeCount: nodeAggByTemplate.get(t.id)?.nodeCount ?? 0,
    checklistItemCount: checklistCountByTemplate.get(t.id) ?? 0,
    referenceItemCount: referenceAggByTemplate.get(t.id)?.itemCount ?? 0,
    validationWarningCount: warningCountByTemplate.get(t.id) ?? 0,
    validationErrorCount: errorCountByTemplate.get(t.id) ?? 0,
    createdAt: t.createdAt.toISOString(),
    publishedAt: t.publishedAt ? t.publishedAt.toISOString() : null,
  }));
}

export type TechnicalProcedureTemplateListRow = {
  id: string;
  code: string;
  name: string;
  equipmentType: ProcedureEquipmentType;
  version: number;
  status: ProcedureTemplateStatus;
  nodeCount: number;
  edgeCount: number;
  createdAt: string;
  publishedAt: string | null;
};

/**
 * Phase 5C-5B — a deliberately separate, lighter-weight list query for the
 * new technical-template library, rather than reusing listProcedureTemplates
 * (whose checklist/reference-item/import-validation-issue aggregates are
 * all always-empty for TECHNICAL_TASK rows today — no importer, no manual
 * checklist authoring yet). `includeAllStatuses` gates DRAFT/ARCHIVED
 * visibility exactly like listProcedureTemplates' own parameter — the
 * caller (the page) decides this from canViewAllTechnicalTemplateStatuses,
 * never from a client-passed flag.
 */
export async function listTechnicalProcedureTemplates(includeAllStatuses: boolean): Promise<TechnicalProcedureTemplateListRow[]> {
  const templates = await db
    .select()
    .from(procedureTemplates)
    .where(
      and(
        eq(procedureTemplates.category, "TECHNICAL_TASK"),
        // 휴지통에 있는 절차는 사용중 목록에 나오지 않는다.
        eq(procedureTemplates.isDeleted, false),
        includeAllStatuses ? undefined : eq(procedureTemplates.status, "PUBLISHED")
      )
    )
    .orderBy(desc(procedureTemplates.createdAt));
  if (templates.length === 0) return [];

  const templateIds = templates.map((t) => t.id);
  const nodeAgg = await db
    .select({ templateId: procedureTemplateNodes.procedureTemplateId, nodeCount: sql<number>`count(*)::int` })
    .from(procedureTemplateNodes)
    .where(inArray(procedureTemplateNodes.procedureTemplateId, templateIds))
    .groupBy(procedureTemplateNodes.procedureTemplateId);
  const edgeAgg = await db
    .select({ templateId: procedureTemplateEdges.procedureTemplateId, edgeCount: sql<number>`count(*)::int` })
    .from(procedureTemplateEdges)
    .where(inArray(procedureTemplateEdges.procedureTemplateId, templateIds))
    .groupBy(procedureTemplateEdges.procedureTemplateId);
  const nodeCountByTemplate = new Map(nodeAgg.map((r) => [r.templateId, r.nodeCount]));
  const edgeCountByTemplate = new Map(edgeAgg.map((r) => [r.templateId, r.edgeCount]));

  return templates.map((t) => ({
    id: t.id,
    code: t.code,
    name: t.name,
    equipmentType: t.equipmentType,
    version: t.version,
    status: t.status,
    nodeCount: nodeCountByTemplate.get(t.id) ?? 0,
    edgeCount: edgeCountByTemplate.get(t.id) ?? 0,
    createdAt: t.createdAt.toISOString(),
    publishedAt: t.publishedAt ? t.publishedAt.toISOString() : null,
  }));
}

export type ProcedureTemplateNodeRow = {
  id: string;
  nodeCode: string;
  nodeType: ProcedureNodeType;
  title: string;
  description: string | null;
  objective: string | null;
  preparation: string | null;
  toolsAndEquipment: string | null;
  safetyCaution: string | null;
  instructions: string | null;
  expectedNormalResult: string | null;
  ngSymptoms: string | null;
  recommendedCorrectiveAction: string | null;
  acceptanceCriteria: string | null;
  workerMayAddNextTask: boolean;
  positionX: number;
  positionY: number;
  /** Phase 5C-5B fix — previously dropped by this read model entirely, so the read-only detail view could never reflect a saved 사용자 배치 override (from either the FULL_SERVICE editor's drag-to-reposition or the technical editor's relative-position/drag/route-split actions), only the editor screen (a separate query, getProcedureTemplateForEditor) could. Null means "never repositioned" — same override-vs-fallback contract as EditorNodeRow's own fields. */
  userPositionX: number | null;
  userPositionY: number | null;
  sortOrder: number;
  sourceWorksheet: string | null;
  sourceShapeId: string | null;
  sourceCellRange: string | null;
};

export type ProcedureTemplateEdgeRow = {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  branchType: ProcedureBranchType;
  branchLabel: string | null;
  sortOrder: number;
  sourceConnectorId: string | null;
};

export type ProcedureChecklistItemRow = {
  id: string;
  itemCode: string;
  title: string;
  instructions: string | null;
  measurementType: string | null;
  measurementUnit: string | null;
  minValue: string | null;
  maxValue: string | null;
  expectedText: string | null;
  acceptanceRule: string | null;
  required: boolean;
  sortOrder: number;
  sourceCellRange: string | null;
};

export type ProcedureChecklistSectionRow = {
  id: string;
  nodeId: string;
  title: string;
  sortOrder: number;
  sourceWorksheet: string | null;
  sourceCellRange: string | null;
  items: ProcedureChecklistItemRow[];
};

export type ProcedureTroubleshootingEntryRow = {
  id: string;
  nodeId: string;
  symptom: string;
  inspectionAction: string | null;
  normalNextAction: string | null;
  ngAction: string | null;
  retryInstruction: string | null;
  sortOrder: number;
  sourceCellRange: string | null;
};

export type ProcedureValidationIssueRow = {
  id: string;
  severity: ProcedureValidationSeverity;
  issueType: ProcedureValidationIssueType;
  message: string;
  sourceWorksheet: string | null;
  sourceReference: string | null;
  resolvedAt: string | null;
  resolvedByName: string | null;
  resolutionNote: string | null;
  createdAt: string;
};

export type ProcedureReferenceItemRow = {
  id: string;
  itemType: ProcedureReferenceItemType;
  label: string;
  sourceWorksheet: string;
  sourceCellRange: string | null;
  hyperlinkTarget: string | null;
  crossReferenceNumber: string | null;
  sortOrder: number;
};

export type ProcedureTemplateDetail = {
  id: string;
  code: string;
  name: string;
  equipmentType: ProcedureEquipmentType;
  category: ProcedureTemplateCategory;
  description: string | null;
  status: ProcedureTemplateStatus;
  version: number;
  sourceType: ProcedureTemplateSourceType;
  sourceFileName: string | null;
  sourceFileHash: string | null;
  isReferenceOnly: boolean;
  createdByName: string;
  publishedByName: string | null;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  archivedAt: string | null;
  nodes: ProcedureTemplateNodeRow[];
  edges: ProcedureTemplateEdgeRow[];
  checklistSections: ProcedureChecklistSectionRow[];
  troubleshootingEntries: ProcedureTroubleshootingEntryRow[];
  referenceItems: ProcedureReferenceItemRow[];
  validationIssues: ProcedureValidationIssueRow[];
  /**
   * Phase 3B: per-node open (UNRESOLVED or DEFERRED — the same predicate the
   * publish gate uses) ERROR/WARNING validation issue, for the graph's
   * warning badge and its click-to-issue link. Matched by sourceWorksheet +
   * the shape id parsed out of the issue's sourceReference, the same
   * sourceWorksheet::sourceShapeId technique Phase 3A's
   * getValidationIssueDetail already uses — not a guess, and not a new
   * column. When a node has more than one open issue, the most severe
   * (ERROR over WARNING) wins; INFO-severity issues never produce a badge.
   */
  openIssuesByNodeId: { nodeId: string; issueId: string; severity: "ERROR" | "WARNING" }[];
};

export async function getProcedureTemplateDetail(id: string): Promise<ProcedureTemplateDetail | null> {
  const createdBy = users;
  const [row] = await db
    .select({
      id: procedureTemplates.id,
      code: procedureTemplates.code,
      name: procedureTemplates.name,
      equipmentType: procedureTemplates.equipmentType,
      category: procedureTemplates.category,
      description: procedureTemplates.description,
      status: procedureTemplates.status,
      version: procedureTemplates.version,
      sourceType: procedureTemplates.sourceType,
      sourceFileName: procedureTemplates.sourceFileName,
      sourceFileHash: procedureTemplates.sourceFileHash,
      isReferenceOnly: procedureTemplates.isReferenceOnly,
      createdByName: createdBy.name,
      createdAt: procedureTemplates.createdAt,
      updatedAt: procedureTemplates.updatedAt,
      publishedAt: procedureTemplates.publishedAt,
      archivedAt: procedureTemplates.archivedAt,
      publishedByUserId: procedureTemplates.publishedByUserId,
    })
    .from(procedureTemplates)
    .innerJoin(createdBy, eq(procedureTemplates.createdByUserId, createdBy.id))
    // 휴지통에 있는 절차는 상세도 열리지 않는다 — 목록에서만 감추면
    // 주소를 직접 친 사람에게는 지워지지 않은 것처럼 보인다.
    .where(and(eq(procedureTemplates.id, id), eq(procedureTemplates.isDeleted, false)));
  if (!row) return null;

  let publishedByName: string | null = null;
  if (row.publishedByUserId) {
    const [publisher] = await db.select({ name: users.name }).from(users).where(eq(users.id, row.publishedByUserId));
    publishedByName = publisher?.name ?? null;
  }

  const nodes = await db
    .select()
    .from(procedureTemplateNodes)
    .where(eq(procedureTemplateNodes.procedureTemplateId, id))
    .orderBy(procedureTemplateNodes.sortOrder);

  const edges = await db
    .select()
    .from(procedureTemplateEdges)
    .where(eq(procedureTemplateEdges.procedureTemplateId, id))
    .orderBy(procedureTemplateEdges.sortOrder);

  const nodeIds = nodes.map((n) => n.id);

  const sections =
    nodeIds.length > 0
      ? await db
          .select()
          .from(procedureChecklistSections)
          .where(inArray(procedureChecklistSections.nodeId, nodeIds))
          .orderBy(procedureChecklistSections.sortOrder)
      : [];
  const sectionIds = sections.map((s) => s.id);
  const items =
    sectionIds.length > 0
      ? await db
          .select()
          .from(procedureChecklistItems)
          .where(inArray(procedureChecklistItems.sectionId, sectionIds))
          .orderBy(procedureChecklistItems.sortOrder)
      : [];
  const itemsBySection = new Map<string, ProcedureChecklistItemRow[]>();
  for (const item of items) {
    const list = itemsBySection.get(item.sectionId) ?? [];
    list.push({
      id: item.id,
      itemCode: item.itemCode,
      title: item.title,
      instructions: item.instructions,
      measurementType: item.measurementType,
      measurementUnit: item.measurementUnit,
      minValue: item.minValue,
      maxValue: item.maxValue,
      expectedText: item.expectedText,
      acceptanceRule: item.acceptanceRule,
      required: item.required,
      sortOrder: item.sortOrder,
      sourceCellRange: item.sourceCellRange,
    });
    itemsBySection.set(item.sectionId, list);
  }

  const troubleshootingEntries =
    nodeIds.length > 0
      ? await db
          .select()
          .from(procedureTroubleshootingEntries)
          .where(inArray(procedureTroubleshootingEntries.nodeId, nodeIds))
          .orderBy(procedureTroubleshootingEntries.sortOrder)
      : [];

  const referenceItems = await db
    .select()
    .from(procedureReferenceItems)
    .where(eq(procedureReferenceItems.procedureTemplateId, id))
    .orderBy(procedureReferenceItems.sortOrder);

  const issues = await db
    .select({
      id: procedureTemplateValidationIssues.id,
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
    .where(eq(procedureTemplateValidationIssues.procedureTemplateId, id))
    .orderBy(desc(procedureTemplateValidationIssues.severity), procedureTemplateValidationIssues.createdAt);

  const resolverIds = [...new Set(issues.map((i) => i.resolvedByUserId).filter((v): v is string => v !== null))];
  const resolverNameById = new Map<string, string>();
  if (resolverIds.length > 0) {
    const resolvers = await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, resolverIds));
    for (const r of resolvers) resolverNameById.set(r.id, r.name);
  }

  // Phase 3B: which nodes have an open (UNRESOLVED/DEFERRED), ERROR/WARNING
  // issue — matched by sourceWorksheet + the shape id parsed from
  // sourceReference (e.g. "shape#50"), same pattern Phase 3A's
  // getValidationIssueDetail already uses. When a node has more than one
  // open issue, ERROR wins over WARNING so the badge always reflects the
  // most severe unresolved state.
  const nodeByShapeAndSheetForIssues = new Map<string, string>();
  for (const n of nodes) {
    if (n.sourceShapeId && n.sourceWorksheet) nodeByShapeAndSheetForIssues.set(`${n.sourceWorksheet}::${n.sourceShapeId}`, n.id);
  }
  const openIssueByNodeId = new Map<string, { issueId: string; severity: "ERROR" | "WARNING" }>();
  for (const issue of issues) {
    if (issue.resolutionStatus !== "UNRESOLVED" && issue.resolutionStatus !== "DEFERRED") continue;
    if (issue.severity !== "ERROR" && issue.severity !== "WARNING") continue;
    const { shapeId } = parseSourceReference(issue.sourceReference);
    if (!shapeId || !issue.sourceWorksheet) continue;
    const nodeId = nodeByShapeAndSheetForIssues.get(`${issue.sourceWorksheet}::${shapeId}`);
    if (!nodeId) continue;
    const existing = openIssueByNodeId.get(nodeId);
    if (!existing || (existing.severity === "WARNING" && issue.severity === "ERROR")) {
      openIssueByNodeId.set(nodeId, { issueId: issue.id, severity: issue.severity });
    }
  }

  return {
    id: row.id,
    code: row.code,
    name: row.name,
    equipmentType: row.equipmentType,
    category: row.category,
    description: row.description,
    status: row.status,
    version: row.version,
    sourceType: row.sourceType,
    sourceFileName: row.sourceFileName,
    sourceFileHash: row.sourceFileHash,
    isReferenceOnly: row.isReferenceOnly,
    createdByName: row.createdByName,
    publishedByName,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    publishedAt: row.publishedAt ? row.publishedAt.toISOString() : null,
    archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null,
    nodes: nodes.map((n) => ({
      id: n.id,
      nodeCode: n.nodeCode,
      nodeType: n.nodeType,
      title: n.title,
      description: n.description,
      objective: n.objective,
      preparation: n.preparation,
      toolsAndEquipment: n.toolsAndEquipment,
      safetyCaution: n.safetyCaution,
      instructions: n.instructions,
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
    })),
    edges: edges.map((e) => ({
      id: e.id,
      fromNodeId: e.fromNodeId,
      toNodeId: e.toNodeId,
      branchType: e.branchType,
      branchLabel: e.branchLabel,
      sortOrder: e.sortOrder,
      sourceConnectorId: e.sourceConnectorId,
    })),
    checklistSections: sections.map((s) => ({
      id: s.id,
      nodeId: s.nodeId,
      title: s.title,
      sortOrder: s.sortOrder,
      sourceWorksheet: s.sourceWorksheet,
      sourceCellRange: s.sourceCellRange,
      items: itemsBySection.get(s.id) ?? [],
    })),
    troubleshootingEntries: troubleshootingEntries.map((t) => ({
      id: t.id,
      nodeId: t.nodeId,
      symptom: t.symptom,
      inspectionAction: t.inspectionAction,
      normalNextAction: t.normalNextAction,
      ngAction: t.ngAction,
      retryInstruction: t.retryInstruction,
      sortOrder: t.sortOrder,
      sourceCellRange: t.sourceCellRange,
    })),
    referenceItems: referenceItems.map((r) => ({
      id: r.id,
      itemType: r.itemType,
      label: r.label,
      sourceWorksheet: r.sourceWorksheet,
      sourceCellRange: r.sourceCellRange,
      hyperlinkTarget: r.hyperlinkTarget,
      crossReferenceNumber: r.crossReferenceNumber,
      sortOrder: r.sortOrder,
    })),
    validationIssues: issues.map((i) => ({
      id: i.id,
      severity: i.severity,
      issueType: i.issueType as ProcedureValidationIssueType,
      message: i.message,
      sourceWorksheet: i.sourceWorksheet,
      sourceReference: i.sourceReference,
      resolvedAt: i.resolvedAt ? i.resolvedAt.toISOString() : null,
      resolvedByName: i.resolvedByUserId ? resolverNameById.get(i.resolvedByUserId) ?? null : null,
      resolutionNote: i.resolutionNote,
      createdAt: i.createdAt.toISOString(),
    })),
    openIssuesByNodeId: [...openIssueByNodeId].map(([nodeId, v]) => ({ nodeId, issueId: v.issueId, severity: v.severity })),
  };
}

export type DeletedProcedureTemplateRow = {
  id: string;
  code: string;
  name: string;
  equipmentType: ProcedureEquipmentType;
  version: number;
  /** 삭제 당시의 상태. 초안이었는지 발행본이었는지가 복원 판단의 첫 정보다. */
  status: ProcedureTemplateStatus;
  nodeCount: number;
  deletedAt: string;
  deletedByUserName: string | null;
  deleteReason: string | null;
};

/**
 * 기술 작업 절차 휴지통 목록. 삭제 권한이 있는 세션에서만 호출된다 — 페이지가
 * 그것을 판정하고, 이 함수는 권한을 보지 않는다(다른 휴지통 조회와 같은 역할
 * 분담).
 *
 * TECHNICAL_TASK만 돌려준다. 전체 서비스·참고자료 절차는 애초에 삭제할 수
 * 없으므로(canDeleteTechnicalTemplates가 분류로 막는다) 휴지통에 있을 수도
 * 없지만, 조회에서도 분류를 걸어 두면 나중에 다른 경로로 들어온 행이 이
 * 화면에 새어 나오지 않는다.
 */
export async function listDeletedTechnicalProcedureTemplates(): Promise<DeletedProcedureTemplateRow[]> {
  const deletedBy = alias(users, "deleted_by_user");

  const templates = await db
    .select({
      id: procedureTemplates.id,
      code: procedureTemplates.code,
      name: procedureTemplates.name,
      equipmentType: procedureTemplates.equipmentType,
      version: procedureTemplates.version,
      status: procedureTemplates.status,
      deletedAt: procedureTemplates.deletedAt,
      deleteReason: procedureTemplates.deleteReason,
      deletedByUserName: deletedBy.name,
    })
    .from(procedureTemplates)
    // leftJoin이어야 한다 — deleted_by는 nullable이고, inner join이면 삭제자를
    // 알 수 없는 행이 휴지통에서 통째로 사라진다.
    .leftJoin(deletedBy, eq(procedureTemplates.deletedBy, deletedBy.id))
    .where(and(eq(procedureTemplates.category, "TECHNICAL_TASK"), eq(procedureTemplates.isDeleted, true)))
    .orderBy(desc(procedureTemplates.deletedAt));

  if (templates.length === 0) return [];

  const templateIds = templates.map((template) => template.id);
  const nodeAgg = await db
    .select({
      templateId: procedureTemplateNodes.procedureTemplateId,
      total: sql<number>`count(*)::int`,
    })
    .from(procedureTemplateNodes)
    .where(inArray(procedureTemplateNodes.procedureTemplateId, templateIds))
    .groupBy(procedureTemplateNodes.procedureTemplateId);
  const nodeCounts = new Map(nodeAgg.map((row) => [row.templateId, row.total]));

  return templates.map((template) => ({
    id: template.id,
    code: template.code,
    name: template.name,
    equipmentType: template.equipmentType,
    version: template.version,
    status: template.status,
    nodeCount: nodeCounts.get(template.id) ?? 0,
    // is_deleted = true인 행만 여기 온다. softDeleteProcedureTemplate은 같은
    // UPDATE에서 deleted_at을 반드시 채운다(다른 휴지통 조회와 같은 근거).
    deletedAt: template.deletedAt!.toISOString(),
    deletedByUserName: template.deletedByUserName,
    deleteReason: template.deleteReason,
  }));
}

/**
 * 지금 삭제할 수 없는 기술 절차의 id — 수행 기록이 있거나 후속 버전이
 * 이어받은 것.
 *
 * 목록에서 체크박스를 비활성으로 만드는 근거다. 서버도 같은 기준으로 다시
 * 막지만(softDeleteProcedureTemplate), 고를 수 있게 해 놓고 나중에 거절하는
 * 것은 "왜 안 되는지"를 한 번 더 눌러 봐야 알게 만드는 일이다.
 *
 * 두 질의 모두 절차 단위로 접어서 읽으므로, 수행 기록이 아무리 쌓여도 결과
 * 크기가 절차 수를 넘지 않는다.
 */
export async function listUndeletableProcedureTemplateIds(): Promise<Set<string>> {
  const successor = alias(procedureTemplates, "successor_template");

  const [executed, superseded] = await Promise.all([
    db
      .select({ templateId: procedureCaseExecutions.procedureTemplateId })
      .from(procedureCaseExecutions)
      .groupBy(procedureCaseExecutions.procedureTemplateId),
    db
      .select({ templateId: successor.supersedesTemplateId })
      .from(successor)
      .where(isNotNull(successor.supersedesTemplateId))
      .groupBy(successor.supersedesTemplateId),
  ]);

  return new Set(
    [...executed, ...superseded]
      .map((row) => row.templateId)
      .filter((id): id is string => id !== null)
  );
}
