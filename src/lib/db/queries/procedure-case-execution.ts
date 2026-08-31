import "server-only";
import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { db } from "../client";
import {
  procedureCaseExecutions,
  procedureCaseExecutionNodes,
  procedureCaseExecutionHistory,
  procedureTemplates,
  procedureTemplateNodes,
  procedureTemplateEdges,
  repairCases,
  products,
  users,
} from "../schema";
import {
  computeSuggestedNextNodes,
  isSystemEntryNodeType,
  type TopologyNode,
  type TopologyEdge,
  type TopologyExecutionNode,
} from "@/lib/domain/procedure-execution-topology";
import { classifyProductRelation, type ProductIdentity } from "@/lib/domain/product-relation";
import type { ProcedureNodeType, ProcedureBranchType, ProcedureEquipmentType } from "@/lib/domain/procedure-template-types";
import type { ProcedureCaseExecutionNodeStatus, ProcedureCaseExecutionActionType } from "@/lib/domain/procedure-case-execution-types";

/**
 * Phase 5A — read queries for repair-case procedure execution. Same
 * convention as procedure-template-editor.ts's query layer: content
 * (title/instructions/edges) is always read live via the FK to the
 * immutable template, never copied — the execution-node row only ever
 * carries state (status/assignment/memo), matching the reference-based
 * binding design (plan §5).
 */

// ---- 실행 시작 화면 (template selection) ----

export type ExecutableTemplateOption = {
  id: string;
  code: string;
  name: string;
  equipmentType: ProcedureEquipmentType;
};

/** PUBLISHED, non-reference-only templates only — the same "executable workflow source" filter DATABASE_DESIGN.md's isReferenceOnly comment anticipates. */
export async function getExecutableTemplateOptions(): Promise<ExecutableTemplateOption[]> {
  return db
    .select({
      id: procedureTemplates.id,
      code: procedureTemplates.code,
      name: procedureTemplates.name,
      equipmentType: procedureTemplates.equipmentType,
    })
    .from(procedureTemplates)
    // 실행에 붙일 수 있는 절차 목록 — 휴지통에 있는 절차는 고를 수 없다.
    .where(
      and(
        eq(procedureTemplates.status, "PUBLISHED"),
        eq(procedureTemplates.isReferenceOnly, false),
        eq(procedureTemplates.isDeleted, false)
      )
    );
}

export async function getActiveExecutionForCase(repairCaseId: string): Promise<{ id: string; procedureTemplateId: string } | null> {
  const [row] = await db
    .select({ id: procedureCaseExecutions.id, procedureTemplateId: procedureCaseExecutions.procedureTemplateId })
    .from(procedureCaseExecutions)
    .where(and(eq(procedureCaseExecutions.repairCaseId, repairCaseId), eq(procedureCaseExecutions.isDeleted, false)));
  return row ?? null;
}

// ---- 실행 상세 (execution detail — the primary list-based UI's data source) ----

export type ExecutionOutgoingEdgeOption = {
  edgeId: string;
  toNodeId: string;
  toNodeTitle: string;
  branchType: ProcedureBranchType;
  branchLabel: string | null;
};

export type ExecutionNodeDetail = {
  id: string;
  procedureTemplateNodeId: string | null;
  nodeCode: string | null;
  nodeType: ProcedureNodeType | null;
  title: string;
  instructions: string | null;
  status: ProcedureCaseExecutionNodeStatus;
  selectedOutgoingEdgeId: string | null;
  /** Only populated for DECISION nodes — the choices completeExecutionNode's selectedOutgoingEdgeId accepts. */
  outgoingEdgeOptions: ExecutionOutgoingEdgeOption[];
  effectiveAssigneeId: string | null;
  effectiveAssigneeName: string | null;
  startedByName: string | null;
  startedAt: string | null;
  completedByName: string | null;
  completedAt: string | null;
  workMemo: string | null;
  lastActionReason: string | null;
  version: number;
  isSuggestedNext: boolean;
};

export type ExecutionReferenceNode = {
  id: string;
  nodeCode: string;
  title: string;
  instructions: string | null;
};

export type ExecutionDetail = {
  executionId: string;
  repairCaseId: string;
  procedureTemplateId: string;
  templateCode: string;
  templateName: string;
  startedByName: string;
  startedAt: string;
  isCaseLocked: boolean;
  nodes: ExecutionNodeDetail[];
  referenceNodes: ExecutionReferenceNode[];
};

export async function getExecutionDetail(executionId: string): Promise<ExecutionDetail | null> {
  const [execution] = await db
    .select({
      id: procedureCaseExecutions.id,
      repairCaseId: procedureCaseExecutions.repairCaseId,
      procedureTemplateId: procedureCaseExecutions.procedureTemplateId,
      startedAt: procedureCaseExecutions.startedAt,
      startedBy: procedureCaseExecutions.startedBy,
      templateCode: procedureTemplates.code,
      templateName: procedureTemplates.name,
      isCaseLocked: repairCases.isLocked,
      caseAssignedEngineerId: repairCases.assignedEngineerId,
    })
    .from(procedureCaseExecutions)
    .innerJoin(procedureTemplates, eq(procedureCaseExecutions.procedureTemplateId, procedureTemplates.id))
    .innerJoin(repairCases, eq(procedureCaseExecutions.repairCaseId, repairCases.id))
    .where(and(eq(procedureCaseExecutions.id, executionId), eq(procedureCaseExecutions.isDeleted, false)));
  if (!execution) return null;

  // repair_case_id is nullable (repair-case permanent-delete schema
  // foundation checkpoint), but the INNER JOIN to repairCases above
  // guarantees it's non-null for any row that actually comes back (a NULL
  // FK can never satisfy a join equality) — this guard only documents/
  // enforces that invariant for TypeScript, which can't infer nullability
  // across a join. It should never actually trigger: this function is only
  // ever reached from the live case's own /repair-cases/[id]/execution
  // route, which already 404s on a purged (or merely soft-deleted) case
  // before getExecutionDetail is called at all — see that page's own
  // getRepairCaseById gate.
  if (!execution.repairCaseId) return null;

  const execNodes = await db
    .select()
    .from(procedureCaseExecutionNodes)
    .where(eq(procedureCaseExecutionNodes.executionId, executionId));

  const templateNodes = await db
    .select({
      id: procedureTemplateNodes.id,
      nodeCode: procedureTemplateNodes.nodeCode,
      nodeType: procedureTemplateNodes.nodeType,
      title: procedureTemplateNodes.title,
      instructions: procedureTemplateNodes.instructions,
    })
    .from(procedureTemplateNodes)
    .where(eq(procedureTemplateNodes.procedureTemplateId, execution.procedureTemplateId));
  const templateNodeById = new Map(templateNodes.map((n) => [n.id, n]));

  const templateEdges = await db
    .select({
      id: procedureTemplateEdges.id,
      fromNodeId: procedureTemplateEdges.fromNodeId,
      toNodeId: procedureTemplateEdges.toNodeId,
      branchType: procedureTemplateEdges.branchType,
      branchLabel: procedureTemplateEdges.branchLabel,
    })
    .from(procedureTemplateEdges)
    .where(eq(procedureTemplateEdges.procedureTemplateId, execution.procedureTemplateId));
  const outgoingEdgesByFromNodeId = new Map<string, typeof templateEdges>();
  for (const edge of templateEdges) {
    const list = outgoingEdgesByFromNodeId.get(edge.fromNodeId) ?? [];
    list.push(edge);
    outgoingEdgesByFromNodeId.set(edge.fromNodeId, list);
  }

  // Batch-resolve every user name this detail view needs in one query,
  // rather than one lookup per node.
  const userIds = new Set<string>([execution.startedBy]);
  if (execution.caseAssignedEngineerId) userIds.add(execution.caseAssignedEngineerId);
  for (const n of execNodes) {
    if (n.assignedEngineerId) userIds.add(n.assignedEngineerId);
    if (n.startedBy) userIds.add(n.startedBy);
    if (n.completedBy) userIds.add(n.completedBy);
  }
  const userRows = userIds.size > 0 ? await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, [...userIds])) : [];
  const nameById = new Map(userRows.map((u) => [u.id, u.name]));

  // Suggested-next computation (plan §7) — guidance only, never a gate.
  const topologyNodes: TopologyNode[] = templateNodes.map((n) => ({ id: n.id, nodeType: n.nodeType }));
  const topologyEdges: TopologyEdge[] = templateEdges.map((e) => ({ id: e.id, fromNodeId: e.fromNodeId, toNodeId: e.toNodeId }));
  const topologyExecutionNodes: TopologyExecutionNode[] = execNodes.map((n) => ({
    id: n.id,
    procedureTemplateNodeId: n.procedureTemplateNodeId,
    status: n.status,
    selectedOutgoingEdgeId: n.selectedOutgoingEdgeId,
  }));
  const suggestedNextIds = computeSuggestedNextNodes(topologyNodes, topologyEdges, topologyExecutionNodes);

  // START is a system entry marker (auto-completed at execution creation,
  // plan-revision fix from browser verification) — it still participated
  // in topologyExecutionNodes/suggestedNextIds above so its outgoing edge
  // could make the real first task suggested, but it must never reach any
  // user-facing list or progress count, so it's excluded here before the
  // rest of the mapping.
  const nodes: ExecutionNodeDetail[] = execNodes
    .filter((n) => {
      const templateNode = n.procedureTemplateNodeId ? templateNodeById.get(n.procedureTemplateNodeId) : undefined;
      return !templateNode || !isSystemEntryNodeType(templateNode.nodeType);
    })
    .map((n) => {
      const templateNode = n.procedureTemplateNodeId ? templateNodeById.get(n.procedureTemplateNodeId) : undefined;
      const effectiveAssigneeId = n.assignedEngineerId ?? execution.caseAssignedEngineerId;
      const outgoingEdgeOptions: ExecutionOutgoingEdgeOption[] =
        templateNode?.nodeType === "DECISION"
          ? (outgoingEdgesByFromNodeId.get(templateNode.id) ?? []).map((e) => ({
              edgeId: e.id,
              toNodeId: e.toNodeId,
              toNodeTitle: templateNodeById.get(e.toNodeId)?.title ?? "-",
              branchType: e.branchType,
              branchLabel: e.branchLabel,
            }))
          : [];

      return {
        id: n.id,
        procedureTemplateNodeId: n.procedureTemplateNodeId,
        nodeCode: templateNode?.nodeCode ?? null,
        nodeType: templateNode?.nodeType ?? null,
        title: templateNode?.title ?? n.extraTaskTitle ?? "-",
        instructions: templateNode?.instructions ?? n.extraTaskInstructions,
        status: n.status,
        selectedOutgoingEdgeId: n.selectedOutgoingEdgeId,
        outgoingEdgeOptions,
        effectiveAssigneeId,
        effectiveAssigneeName: effectiveAssigneeId ? (nameById.get(effectiveAssigneeId) ?? "-") : null,
        startedByName: n.startedBy ? (nameById.get(n.startedBy) ?? "-") : null,
        startedAt: n.startedAt ? n.startedAt.toISOString() : null,
        completedByName: n.completedBy ? (nameById.get(n.completedBy) ?? "-") : null,
        completedAt: n.completedAt ? n.completedAt.toISOString() : null,
        workMemo: n.workMemo,
        lastActionReason: n.lastActionReason,
        version: n.version,
        isSuggestedNext: suggestedNextIds.has(n.id),
      };
    });

  const referenceNodes: ExecutionReferenceNode[] = templateNodes
    .filter((n) => n.nodeType === "DOCUMENT_REFERENCE")
    .map((n) => ({ id: n.id, nodeCode: n.nodeCode, title: n.title, instructions: n.instructions }));

  return {
    executionId: execution.id,
    repairCaseId: execution.repairCaseId,
    procedureTemplateId: execution.procedureTemplateId,
    templateCode: execution.templateCode,
    templateName: execution.templateName,
    startedByName: nameById.get(execution.startedBy) ?? "-",
    startedAt: execution.startedAt.toISOString(),
    isCaseLocked: execution.isCaseLocked,
    nodes,
    referenceNodes,
  };
}

// ---- 실행 이력 (execution history timeline) ----

export type ExecutionHistoryRow = {
  id: string;
  executionNodeId: string | null;
  actionType: ProcedureCaseExecutionActionType;
  beforeState: unknown;
  afterState: unknown;
  reason: string | null;
  actorName: string;
  createdAt: string;
};

/** Newest first — same append-only read convention as getProcedureTemplateEditHistory. */
export async function getExecutionHistory(executionId: string): Promise<ExecutionHistoryRow[]> {
  const rows = await db
    .select({
      id: procedureCaseExecutionHistory.id,
      executionNodeId: procedureCaseExecutionHistory.executionNodeId,
      actionType: procedureCaseExecutionHistory.actionType,
      beforeState: procedureCaseExecutionHistory.beforeState,
      afterState: procedureCaseExecutionHistory.afterState,
      reason: procedureCaseExecutionHistory.reason,
      createdAt: procedureCaseExecutionHistory.createdAt,
      actorName: users.name,
    })
    .from(procedureCaseExecutionHistory)
    .innerJoin(users, eq(procedureCaseExecutionHistory.actorUserId, users.id))
    .where(eq(procedureCaseExecutionHistory.executionId, executionId))
    .orderBy(desc(procedureCaseExecutionHistory.createdAt));

  return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
}

// ---- 이전 수리 이력 (previous repair history — plan §12, conservative tiered matching) ----

export type RelatedRepairHistoryRow = {
  id: string;
  intakeNumber: string;
  receivedAt: string;
  actualShipmentDate: string | null;
  /**
   * 그때는 무슨 문제로 들어왔는가. 접수 알림 메일이 과거 이력을 적을 때
   * 쓴다 — 인수번호와 날짜만으로는 "전에도 왔던 물건" 이상을 알 수 없다.
   */
  reportedSymptom: string | null;
};

export type RelatedRepairHistory = {
  sameProduct: RelatedRepairHistoryRow[];
  sameModelReference: RelatedRepairHistoryRow[];
};

/**
 * Buckets other repair cases by classifyProductRelation (plan §12) —
 * "동일 제품 이력" (SAME_PRODUCT) is kept strictly separate from "동일 모델
 * 참고 이력" (SAME_MODEL_REFERENCE) in the returned shape so the UI can
 * never conflate the two. Excludes the current case and anything without a
 * matching model. Sorted newest-received-first within each bucket.
 */
export async function getRelatedRepairHistory(currentRepairCaseId: string, currentProductId: string): Promise<RelatedRepairHistory> {
  const [currentProduct] = await db
    .select({ modelName: products.modelName, serialNumber: products.serialNumber, lotNumber: products.lotNumber })
    .from(products)
    .where(eq(products.id, currentProductId));
  if (!currentProduct) return { sameProduct: [], sameModelReference: [] };

  const currentIdentity: ProductIdentity = currentProduct;

  const candidates = await db
    .select({
      id: repairCases.id,
      intakeNumber: repairCases.intakeNumber,
      receivedAt: repairCases.receivedAt,
      actualShipmentDate: repairCases.actualShipmentDate,
      reportedSymptom: repairCases.reportedSymptom,
      modelName: products.modelName,
      serialNumber: products.serialNumber,
      lotNumber: products.lotNumber,
    })
    .from(repairCases)
    .innerJoin(products, eq(repairCases.productId, products.id))
    .where(and(eq(repairCases.isDeleted, false), ne(repairCases.id, currentRepairCaseId)));

  const sameProduct: RelatedRepairHistoryRow[] = [];
  const sameModelReference: RelatedRepairHistoryRow[] = [];

  for (const candidate of candidates) {
    const relation = classifyProductRelation(currentIdentity, candidate);
    if (relation === "NONE") continue;
    const row: RelatedRepairHistoryRow = {
      id: candidate.id,
      intakeNumber: candidate.intakeNumber,
      receivedAt: candidate.receivedAt,
      actualShipmentDate: candidate.actualShipmentDate,
      reportedSymptom: candidate.reportedSymptom,
    };
    if (relation === "SAME_PRODUCT") sameProduct.push(row);
    else sameModelReference.push(row);
  }

  sameProduct.sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
  sameModelReference.sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));

  return { sameProduct, sameModelReference };
}
