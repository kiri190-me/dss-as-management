import "server-only";
import { and, desc, eq, inArray, isNull, ne } from "drizzle-orm";
import { db } from "../client";
import {
  procedureTemplates,
  procedureTemplateNodes,
  procedureTemplateEdges,
  procedureChecklistSections,
  procedureTroubleshootingEntries,
  procedureTemplateValidationIssues,
  procedureTemplateEditHistory,
  procedureCaseExecutions,
  procedureCaseExecutionNodes,
  procedureCaseExecutionEdges,
  procedureCaseExecutionHistory,
  repairCases,
  users,
} from "../schema";
import type {
  ProcedureBranchType,
  ProcedureNodeType,
  ProcedureTemplateCategory,
  ProcedureTemplateStatus,
  ProcedureEquipmentType,
  ProcedureValidationSeverity,
  ProcedureValidationIssueType,
} from "@/lib/domain/procedure-template-types";
import {
  fieldStepNodeCode,
  type FieldAddedStep,
  type FieldStepNeighbor,
} from "@/lib/domain/procedure-field-added-steps";
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
  category: ProcedureTemplateCategory;
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
  // 휴지통에 있는 절차는 편집기에서도 열리지 않는다.
  const [template] = await db
    .select()
    .from(procedureTemplates)
    .where(and(eq(procedureTemplates.id, templateId), eq(procedureTemplates.isDeleted, false)));
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
    category: template.category,
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

/**
 * ──────────────────────────────────────────────────────────────────────────
 * 현장에서 더한 단계 모으기 (2026-11-03, 줄기 B-⑧)
 * ──────────────────────────────────────────────────────────────────────────
 * 사용자 결정 — 「원본 절차를 편집할 때, 이번에 만들었던 단계를 희미하게
 * 표시해주고, 적용할 것인지 묻도록 하자」.
 *
 * 🔴 **같은 `code` 의 모든 판본에서 긁는다**(2026-11-03 사용자 결정). 부모 한
 * 판본만 보면 **v1 을 돌리다 현장이 만든 단계가 v3 초안에서 영영 안 보인다** —
 * 실측(2026-11-03) 개발 DB 에 판본이 셋까지 쌓인 줄기가 있다(code "7": PUBLISHED
 * 둘 + DRAFT 하나). `code` 가 이 저장소의 줄기 열쇠다(createNewDraftVersion 의
 * 「이미 초안이 있나」 검사가 같은 칸을 본다).
 *
 * 🔵 자기 자신은 뺀다 — 초안으로는 실행을 시작할 수 없으므로 실제로는 한 줄도
 * 안 걸리지만, 빼 두면 나중에 그 규칙이 바뀌어도 「제 초안의 현장 단계를 제
 * 초안에 넣겠냐」는 되묻기가 생기지 않는다.
 *
 * ── 🔴 걸러야 하는 곳이 넷이다 ──────────────────────────────────────────
 * 소프트 삭제가 네 겹으로 겹쳐 있다. 하나라도 빠뜨리면 **치운 것이 되살아나
 * 제안으로 뜬다** — 오류가 아니라 「지웠는데 그대로 있다」로만 드러난다.
 *   ① 절차 판본(procedure_templates.is_deleted)
 *   ② 실행(procedure_case_executions.is_deleted — [실행 그만두기])
 *   ③ 추가 작업(procedure_case_execution_nodes.is_deleted — 「작업 치우기」)
 *   ④ 이 건에서 그은 선(procedure_case_execution_edges.is_deleted)
 * 실측 2026-11-03: 개발 DB 의 현장 추가 4줄·선 2줄이 **전부 ③④ 로 치워져 있어**
 * 살아 있는 것이 0건이다. 거르지 않으면 그 여섯이 그대로 올라온다.
 *
 * ── 이웃을 초안 쪽으로 옮기는 길 ────────────────────────────────────────
 * 실행 간선의 양끝은 **실행 노드**다. 템플릿에서 온 실행 노드는 그 판본의 절차
 * 노드를 가리키는데, 초안은 판본을 복제한 **다른 행**이라 id 가 다르다. 둘을 잇는
 * 것은 node_code 하나뿐이다(createNewDraftVersion 이 옛 id → 새 id 를 그 값으로
 * 맞춘다). 그래서 여기서도 node_code 로 건너간다.
 */
export async function getFieldAddedStepsForDraft(draftTemplateId: string): Promise<FieldAddedStep[]> {
  const [draft] = await db
    .select({ id: procedureTemplates.id, code: procedureTemplates.code, status: procedureTemplates.status })
    .from(procedureTemplates)
    .where(and(eq(procedureTemplates.id, draftTemplateId), eq(procedureTemplates.isDeleted, false)));
  // 🔴 초안이 아니면 빈 목록이다. 게시된 절차에 단계를 더하는 길은 없고(노드·간선이
  //    읽기 전용이다), 여기서 안 막으면 화면이 「넣을까요?」를 물어 놓고 서버가
  //    NOT_DRAFT 로 거절하는 단추가 된다.
  if (!draft || draft.status !== "DRAFT") return [];

  const lineageTemplates = await db
    .select({ id: procedureTemplates.id, version: procedureTemplates.version })
    .from(procedureTemplates)
    .where(
      and(
        eq(procedureTemplates.code, draft.code),
        eq(procedureTemplates.isDeleted, false),
        ne(procedureTemplates.id, draft.id)
      )
    );
  if (lineageTemplates.length === 0) return [];
  const versionByTemplateId = new Map(lineageTemplates.map((t) => [t.id, t.version]));

  const executions = await db
    .select({
      id: procedureCaseExecutions.id,
      templateId: procedureCaseExecutions.procedureTemplateId,
      repairCaseId: procedureCaseExecutions.repairCaseId,
    })
    .from(procedureCaseExecutions)
    .where(
      and(
        inArray(procedureCaseExecutions.procedureTemplateId, [...versionByTemplateId.keys()]),
        eq(procedureCaseExecutions.isDeleted, false)
      )
    );
  if (executions.length === 0) return [];
  const executionIds = executions.map((e) => e.id);
  const executionById = new Map(executions.map((e) => [e.id, e]));

  const extraNodeRows = await db
    .select({
      id: procedureCaseExecutionNodes.id,
      executionId: procedureCaseExecutionNodes.executionId,
      title: procedureCaseExecutionNodes.extraTaskTitle,
      instructions: procedureCaseExecutionNodes.extraTaskInstructions,
      nodeType: procedureCaseExecutionNodes.extraTaskNodeType,
      userPositionX: procedureCaseExecutionNodes.userPositionX,
      userPositionY: procedureCaseExecutionNodes.userPositionY,
      createdAt: procedureCaseExecutionNodes.createdAt,
    })
    .from(procedureCaseExecutionNodes)
    .where(
      and(
        inArray(procedureCaseExecutionNodes.executionId, executionIds),
        isNull(procedureCaseExecutionNodes.procedureTemplateNodeId),
        eq(procedureCaseExecutionNodes.isDeleted, false)
      )
    );
  if (extraNodeRows.length === 0) return [];
  const extraNodeIds = new Set(extraNodeRows.map((n) => n.id));

  // 이 건에서 그은 선 — 양끝 가운데 **하나라도** 현장 단계인 것만 쓸모가 있다.
  const executionEdgeRows = await db
    .select({
      fromNodeId: procedureCaseExecutionEdges.fromNodeId,
      toNodeId: procedureCaseExecutionEdges.toNodeId,
      branchType: procedureCaseExecutionEdges.branchType,
      branchLabel: procedureCaseExecutionEdges.branchLabel,
    })
    .from(procedureCaseExecutionEdges)
    .where(
      and(
        inArray(procedureCaseExecutionEdges.executionId, executionIds),
        eq(procedureCaseExecutionEdges.isDeleted, false)
      )
    );
  const relevantEdges = executionEdgeRows.filter((e) => extraNodeIds.has(e.fromNodeId) || extraNodeIds.has(e.toNodeId));

  // 선의 양끝 가운데 **템플릿에서 온** 실행 노드를 절차 노드 코드로 바꾼다.
  const counterpartExecutionNodeIds = [
    ...new Set(
      relevantEdges
        .flatMap((e) => [e.fromNodeId, e.toNodeId])
        .filter((id) => !extraNodeIds.has(id))
    ),
  ];
  const templateNodeCodeByExecutionNodeId = new Map<string, string>();
  if (counterpartExecutionNodeIds.length > 0) {
    const counterpartRows = await db
      .select({ id: procedureCaseExecutionNodes.id, nodeCode: procedureTemplateNodes.nodeCode })
      .from(procedureCaseExecutionNodes)
      .innerJoin(procedureTemplateNodes, eq(procedureCaseExecutionNodes.procedureTemplateNodeId, procedureTemplateNodes.id))
      .where(
        and(
          inArray(procedureCaseExecutionNodes.id, counterpartExecutionNodeIds),
          eq(procedureCaseExecutionNodes.isDeleted, false)
        )
      );
    for (const row of counterpartRows) templateNodeCodeByExecutionNodeId.set(row.id, row.nodeCode);
  }

  // 이 초안의 노드 — node_code 로 찾는다(이웃 잇기와 「이미 넣었나」 둘 다 쓴다).
  const draftNodeRows = await db
    .select({ id: procedureTemplateNodes.id, nodeCode: procedureTemplateNodes.nodeCode })
    .from(procedureTemplateNodes)
    .where(eq(procedureTemplateNodes.procedureTemplateId, draft.id));
  const draftNodeIdByCode = new Map(draftNodeRows.map((n) => [n.nodeCode, n.id]));

  // 접수 번호 · 더한 사람 이름 — 사람이 「이것을 절차에 넣을까」를 판단할 근거다.
  // 🔵 고객 이름은 안 싣는다. 이 화면은 절차를 고치는 자리이고, 거기에 고객이
  //    보일 까닭이 없다(접수 번호는 사내 번호라 그 자체로 사람을 가리키지 않는다).
  const repairCaseIds = [...new Set(executions.map((e) => e.repairCaseId).filter((id): id is string => id !== null))];
  const intakeNumberByCaseId = new Map<string, string>();
  if (repairCaseIds.length > 0) {
    const caseRows = await db
      .select({ id: repairCases.id, intakeNumber: repairCases.intakeNumber })
      .from(repairCases)
      .where(inArray(repairCases.id, repairCaseIds));
    for (const row of caseRows) intakeNumberByCaseId.set(row.id, row.intakeNumber);
  }

  /**
   * 🔴 **더한 사람은 실행 노드 행에 없다.** `started_by` 는 「그 작업을 시작한
   * 사람」이라 등록 직후에는 비어 있고, 다른 사람이 시작하면 엉뚱한 이름이 된다
   * (addExecutionExtraTask 는 그 칸을 안 쓴다). 등록한 사람이 적히는 자리는
   * NODE_ADDED 이력 한 줄뿐이다.
   */
  const addedByNameByExecutionNodeId = new Map<string, string>();
  const addedHistoryRows = await db
    .select({ executionNodeId: procedureCaseExecutionHistory.executionNodeId, actorName: users.name })
    .from(procedureCaseExecutionHistory)
    .innerJoin(users, eq(procedureCaseExecutionHistory.actorUserId, users.id))
    .where(
      and(
        inArray(procedureCaseExecutionHistory.executionNodeId, [...extraNodeIds]),
        eq(procedureCaseExecutionHistory.actionType, "NODE_ADDED")
      )
    );
  for (const row of addedHistoryRows) {
    if (row.executionNodeId) addedByNameByExecutionNodeId.set(row.executionNodeId, row.actorName);
  }

  /** 실행 노드 하나를 **초안 쪽 이웃**으로 옮긴다. 셋 중 하나가 된다(FieldStepNeighbor 머리말). */
  const toNeighbor = (executionNodeId: string, branchType: ProcedureBranchType, branchLabel: string | null): FieldStepNeighbor => {
    if (extraNodeIds.has(executionNodeId)) {
      return { draftNodeId: null, fieldStepExecutionNodeId: executionNodeId, branchType, branchLabel };
    }
    const nodeCode = templateNodeCodeByExecutionNodeId.get(executionNodeId);
    const draftNodeId = nodeCode ? (draftNodeIdByCode.get(nodeCode) ?? null) : null;
    return { draftNodeId, fieldStepExecutionNodeId: null, branchType, branchLabel };
  };

  const steps: FieldAddedStep[] = extraNodeRows.map((row) => {
    const execution = executionById.get(row.executionId)!;
    const nodeCode = fieldStepNodeCode(row.id);
    return {
      executionNodeId: row.id,
      nodeCode,
      title: row.title ?? "-",
      instructions: row.instructions,
      // 🔵 칸이 생기기 전에 등록된 옛 추가 작업은 갈래가 비어 있다 — 실행 화면이
      //    그것을 작업(TASK)으로 읽는 것과 **같은 접기**다(placeAddedGraphNodes).
      //    두 자리가 달리 읽으면 그림에서 모양이 다른 칸이 된다.
      nodeType: (row.nodeType ?? "TASK") as ProcedureNodeType,
      userPositionX: row.userPositionX,
      userPositionY: row.userPositionY,
      adoptedNodeId: draftNodeIdByCode.get(nodeCode) ?? null,
      incoming: relevantEdges.filter((e) => e.toNodeId === row.id).map((e) => toNeighbor(e.fromNodeId, e.branchType, e.branchLabel)),
      outgoing: relevantEdges.filter((e) => e.fromNodeId === row.id).map((e) => toNeighbor(e.toNodeId, e.branchType, e.branchLabel)),
      intakeNumber: execution.repairCaseId ? (intakeNumberByCaseId.get(execution.repairCaseId) ?? null) : null,
      sourceTemplateVersion: versionByTemplateId.get(execution.templateId) ?? 0,
      addedAt: row.createdAt.toISOString(),
      addedByName: addedByNameByExecutionNodeId.get(row.id) ?? null,
    };
  });

  // 오래된 것부터 — 패널의 줄 차례와 유령 칸의 자리 계산이 **같은 차례**를 본다.
  return steps.sort((a, b) => (a.addedAt === b.addedAt ? (a.executionNodeId < b.executionNodeId ? -1 : 1) : a.addedAt < b.addedAt ? -1 : 1));
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
