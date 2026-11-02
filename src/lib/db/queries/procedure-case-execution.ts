import "server-only";
import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
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
import { sortByProcedureExecutionOrder } from "@/lib/domain/procedure-execution-order";
import type { PastExecutionCandidate } from "@/lib/domain/procedure-execution-past-runs";
import { classifyProductRelation, type ProductIdentity } from "@/lib/domain/product-relation";
import type {
  ProcedureNodeType,
  ProcedureBranchType,
  ProcedureEquipmentType,
  ProcedureTemplateCategory,
} from "@/lib/domain/procedure-template-types";
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

/**
 * 불러오기 창의 플로우차트가 쓰는 **한 노드**. ProcedureFlowGraph 가 실제로 읽는
 * 칸만 담는다 — 전체 행에 딸린 instructions·ngSymptoms 같은 긴 글은 그림에 안
 * 쓰이면서 화면으로 내려가는 짐만 된다(실측 2026-11-02: 게시된 둘만 해도 57KB →
 * 28KB). 자세한 까닭은 ProcedureFlowGraph 의 ProcedureFlowGraphNode 주석.
 */
export type ExecutableTemplateNode = {
  id: string;
  nodeCode: string;
  nodeType: ProcedureNodeType;
  title: string;
  positionX: number;
  positionY: number;
  userPositionX: number | null;
  userPositionY: number | null;
  sortOrder: number;
  sourceWorksheet: string | null;
  sourceShapeId: string | null;
};

export type ExecutableTemplateEdge = {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  branchType: ProcedureBranchType;
  branchLabel: string | null;
  sortOrder: number;
  sourceConnectorId: string | null;
};

export type ExecutableTemplateOption = {
  id: string;
  code: string;
  name: string;
  equipmentType: ProcedureEquipmentType;
  category: ProcedureTemplateCategory;
};

/**
 * 목록 한 줄 + **그 절차의 그림 재료 전부**(2026-11-02, 조각 7).
 *
 * 🔴 노드·간선을 함께 싣는 까닭: 불러오기 창의 기본값이 「모든 절차」이고, 그
 * 상태에서 **게시된 절차 전부의 노드 이름**을 한 번에 찾을 수 있어야 한다. 절차를
 * 고를 때마다 서버를 다시 부르는 길로는 그 검색 자체가 성립하지 않는다.
 *
 * 🔵 **그리다 만 절차도 그대로 싣는다.** 실측 「원복 검사 및 개선 작업 (3상 입력)」은
 * 노드 23개에 간선이 8개뿐이고 15개가 아무 선에도 안 닿아 있다. 걸러 내면 그
 * 절차에서는 그 노드들부터 시작할 길이 사라진다 — 절차가 미완성인 것과 그
 * 작업부터 시작하고 싶은 것은 별개다.
 */
export type ExecutableTemplateGraph = ExecutableTemplateOption & {
  nodes: ExecutableTemplateNode[];
  edges: ExecutableTemplateEdge[];
};

/** PUBLISHED, non-reference-only templates only — the same "executable workflow source" filter DATABASE_DESIGN.md's isReferenceOnly comment anticipates. */
export async function getExecutableTemplateOptions(): Promise<ExecutableTemplateGraph[]> {
  const templates = await db
    .select({
      id: procedureTemplates.id,
      code: procedureTemplates.code,
      name: procedureTemplates.name,
      equipmentType: procedureTemplates.equipmentType,
      category: procedureTemplates.category,
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
  if (templates.length === 0) return [];

  const templateIds = templates.map((t) => t.id);

  // 절차 수만큼 조회를 반복하지 않는다 — 두 번만 읽고 id 로 나눈다.
  const nodeRows = await db
    .select({
      procedureTemplateId: procedureTemplateNodes.procedureTemplateId,
      id: procedureTemplateNodes.id,
      nodeCode: procedureTemplateNodes.nodeCode,
      nodeType: procedureTemplateNodes.nodeType,
      title: procedureTemplateNodes.title,
      positionX: procedureTemplateNodes.positionX,
      positionY: procedureTemplateNodes.positionY,
      userPositionX: procedureTemplateNodes.userPositionX,
      userPositionY: procedureTemplateNodes.userPositionY,
      sortOrder: procedureTemplateNodes.sortOrder,
      sourceWorksheet: procedureTemplateNodes.sourceWorksheet,
      sourceShapeId: procedureTemplateNodes.sourceShapeId,
    })
    .from(procedureTemplateNodes)
    .where(inArray(procedureTemplateNodes.procedureTemplateId, templateIds))
    // 차례는 여기서 한 번만 정한다 — 창의 번호(indexStartPickerNodes)와 같은 열쇠다.
    .orderBy(procedureTemplateNodes.sortOrder, procedureTemplateNodes.nodeCode);

  const edgeRows = await db
    .select({
      procedureTemplateId: procedureTemplateEdges.procedureTemplateId,
      id: procedureTemplateEdges.id,
      fromNodeId: procedureTemplateEdges.fromNodeId,
      toNodeId: procedureTemplateEdges.toNodeId,
      branchType: procedureTemplateEdges.branchType,
      branchLabel: procedureTemplateEdges.branchLabel,
      sortOrder: procedureTemplateEdges.sortOrder,
      sourceConnectorId: procedureTemplateEdges.sourceConnectorId,
    })
    .from(procedureTemplateEdges)
    .where(inArray(procedureTemplateEdges.procedureTemplateId, templateIds))
    .orderBy(procedureTemplateEdges.sortOrder);

  const nodesByTemplateId = new Map<string, ExecutableTemplateNode[]>();
  for (const { procedureTemplateId, ...node } of nodeRows) {
    const list = nodesByTemplateId.get(procedureTemplateId) ?? [];
    list.push(node);
    nodesByTemplateId.set(procedureTemplateId, list);
  }
  const edgesByTemplateId = new Map<string, ExecutableTemplateEdge[]>();
  for (const { procedureTemplateId, ...edge } of edgeRows) {
    const list = edgesByTemplateId.get(procedureTemplateId) ?? [];
    list.push(edge);
    edgesByTemplateId.set(procedureTemplateId, list);
  }

  return templates.map((t) => ({
    ...t,
    nodes: nodesByTemplateId.get(t.id) ?? [],
    edges: edgesByTemplateId.get(t.id) ?? [],
  }));
}

export type ActiveExecutionSummary = {
  id: string;
  procedureTemplateId: string;
  /**
   * 끝낸 실행이면 그 시각. 아직 돌고 있으면 null.
   *
   * 🔴 **끝났다고 여기서 걸러내지 않는다.** 걸러내면 「절차를 마쳤습니다」를
   * 그릴 재료가 사라져서, 다 끝낸 화면이 한 번도 실행한 적 없는 화면과 똑같이
   * 보인다. 끝낸 뒤 화면이 무엇을 그리는지는 받는 쪽이 이 값으로 정한다.
   */
  completedAt: string | null;
};

/**
 * 그만둔(is_deleted) 실행은 없는 것으로 친다 — 그래야 그만둔 뒤에 「+ 기술 절차
 * 불러오기」가 다시 서고 다른 절차를 고를 수 있다(abandonProcedureExecution).
 *
 * ──────────────────────────────────────────────────────────────────────
 * 🔴 차례를 못 박는다 — 한 접수 건에 **안 치운 실행이 둘**일 수 있다
 * ──────────────────────────────────────────────────────────────────────
 * 「한 건에 하나」를 지키는 유니크 색인은 FULL_SERVICE 에만 걸려 있고,
 * TECHNICAL_TASK 는 여러 건이 나란히 있어도 된다(스키마 주석). 전에는 화면이
 * 실행이 **없을 때만** 불러오기 카드를 보여 줘서 둘째가 생길 길이 사실상
 * 없었는데, 2026-11-02 부터 **끝낸 실행에서도 카드가 다시 선다.** 그러면
 * 「끝낸 것 + 새로 불러온 것」 둘이 함께 남는다.
 *
 * 차례가 없으면 그때 DB 가 주는 대로 아무거나 하나가 뽑혀서, 새로 불러온 절차
 * 대신 **아까 끝낸 절차가 다시 뜨는** 화면이 된다(오류가 아니라 「왜 안 바뀌지」로
 * 나타나는 종류다). 그래서 **아직 안 끝난 것을 먼저**, 그중에서도 **나중에 시작한
 * 것**을 고른다 — 사람이 방금 불러온 그것이다.
 */
export async function getActiveExecutionForCase(repairCaseId: string): Promise<ActiveExecutionSummary | null> {
  const [row] = await db
    .select({
      id: procedureCaseExecutions.id,
      procedureTemplateId: procedureCaseExecutions.procedureTemplateId,
      completedAt: procedureCaseExecutions.completedAt,
    })
    .from(procedureCaseExecutions)
    .where(and(eq(procedureCaseExecutions.repairCaseId, repairCaseId), eq(procedureCaseExecutions.isDeleted, false)))
    .orderBy(sql`(${procedureCaseExecutions.completedAt} is null) desc`, desc(procedureCaseExecutions.startedAt))
    .limit(1);
  return row ? { ...row, completedAt: row.completedAt ? row.completedAt.toISOString() : null } : null;
}

/**
 * 이 접수 건의 실행 가운데 **지금 화면에 선 것 말고 전부** — 「이 건의 다른
 * 절차」 묶음의 재료다(2026-11-02, 조각 6).
 *
 * ──────────────────────────────────────────────────────────────────────
 * 🔴 왜 getActiveExecutionForCase 를 고치지 않고 **새 조회**를 두는가
 * ──────────────────────────────────────────────────────────────────────
 * 위 조회의 `is_deleted = false` 를 풀면 그만둔 실행이 **「도는 것」으로
 * 되살아난다.** 화면이 그 실행의 큰 카드와 단추를 다시 그리고, 치운 뒤 다시
 * 서야 할 「+ 기술 절차 불러오기」가 안 선다 — 그만두기가 통째로 무력해진다.
 * 그래서 거르기는 그대로 두고, **읽기 전용으로 한 줄씩 적는** 길을 따로 낸다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 🔴 **거르지 않고** 실어 보낸다
 * ──────────────────────────────────────────────────────────────────────
 * 「이 실행을 어느 배지로 그리는가」는 도메인 한 곳에서 정한다
 * (classifyPastExecution — 완주 · 중단 마침 · 그만둠 · 진행 중). 상태로 미리
 * 걸러 두면 같은 판정이 SQL 과 도메인 두 벌이 되고, 배지 규칙을 고치는 날 한쪽만
 * 고치게 된다. 한 건의 실행은 많아야 몇 줄이라 다 읽어도 싸다.
 *
 * 🔴 **아직 도는 실행도 그대로 싣는다.** 기술 작업 절차는 한 건에 여럿을 나란히
 * 돌릴 수 있는데 큰 카드는 하나뿐이라, 여기서 거르면 둘째로 불러온 절차가 화면
 * 어디에도 안 떠서 사람 눈에는 「불러왔는데 사라졌다」가 된다.
 *
 * `excludeExecutionId` 만 SQL 에서 뺀다 — 그것은 「판정」이 아니라 **화면이 이미
 * 그리고 있는 행**이라는 사실이고, 빼지 않으면 마친 실행이 큰 카드와 아래 줄에
 * 두 번 뜬다.
 */
export async function getOtherExecutionsForCase(
  repairCaseId: string,
  excludeExecutionId: string | null
): Promise<PastExecutionCandidate[]> {
  const executions = await db
    .select({
      id: procedureCaseExecutions.id,
      templateName: procedureTemplates.name,
      templateCode: procedureTemplates.code,
      startedAt: procedureCaseExecutions.startedAt,
      startedBy: procedureCaseExecutions.startedBy,
      completedAt: procedureCaseExecutions.completedAt,
      // 🔴 줄마다 [실행 그만두기]가 붙으면서 필요해졌다(2026-11-02, 조각 8 보완).
      // 낙관적 잠금이 **실행 행 자신의** version 을 expectedVersion 으로 받는데,
      // 줄이 여럿일 때 한 값을 돌려 쓰면 남의 version 으로 남의 실행을 그만두려
      // 들거나(엉뚱한 CONFLICT) 맞아떨어져 버린다. 줄마다 제 것을 싣는다.
      version: procedureCaseExecutions.version,
      isDeleted: procedureCaseExecutions.isDeleted,
      deletedAt: procedureCaseExecutions.deletedAt,
      deletedBy: procedureCaseExecutions.deletedBy,
      deleteReason: procedureCaseExecutions.deleteReason,
    })
    .from(procedureCaseExecutions)
    .innerJoin(procedureTemplates, eq(procedureCaseExecutions.procedureTemplateId, procedureTemplates.id))
    .where(
      and(
        eq(procedureCaseExecutions.repairCaseId, repairCaseId),
        excludeExecutionId ? ne(procedureCaseExecutions.id, excludeExecutionId) : undefined
      )
    );
  if (executions.length === 0) return [];

  const executionIds = executions.map((e) => e.id);

  // 노드는 **상태만** 센다. 지나간 줄은 읽기 전용이라 제목도 메모도 안 그린다 —
  // 실행마다 getExecutionDetail 을 다시 부르면 조회가 줄 수만큼 늘어난다.
  const nodeRows = await db
    .select({
      executionId: procedureCaseExecutionNodes.executionId,
      status: procedureCaseExecutionNodes.status,
      nodeType: procedureTemplateNodes.nodeType,
    })
    .from(procedureCaseExecutionNodes)
    .leftJoin(procedureTemplateNodes, eq(procedureCaseExecutionNodes.procedureTemplateNodeId, procedureTemplateNodes.id))
    .where(inArray(procedureCaseExecutionNodes.executionId, executionIds));

  const nodesByExecutionId = new Map<string, { status: ProcedureCaseExecutionNodeStatus }[]>();
  for (const row of nodeRows) {
    // 🔴 START 를 뺀다 — getExecutionDetail 이 목록·번호·요약을 만들 때 쓰는 것과
    // **같은 잣대**(isSystemEntryNodeType). 안 빼면 지나간 줄의 분모만 1 이 더
    // 커져서, 같은 실행인데 큰 카드는 「전체 22」인데 지나간 줄은 「/ 23」이 된다.
    // 추가 작업(템플릿 노드가 없는 행)은 사람이 할 일이므로 그대로 센다.
    if (row.nodeType && isSystemEntryNodeType(row.nodeType)) continue;
    const list = nodesByExecutionId.get(row.executionId) ?? [];
    list.push({ status: row.status });
    nodesByExecutionId.set(row.executionId, list);
  }

  const userIds = new Set<string>();
  for (const e of executions) {
    userIds.add(e.startedBy);
    if (e.deletedBy) userIds.add(e.deletedBy);
  }
  const userRows =
    userIds.size > 0 ? await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, [...userIds])) : [];
  const nameById = new Map(userRows.map((u) => [u.id, u.name]));

  return executions.map((e) => ({
    executionId: e.id,
    templateName: e.templateName,
    templateCode: e.templateCode,
    nodes: nodesByExecutionId.get(e.id) ?? [],
    startedAt: e.startedAt.toISOString(),
    startedByName: nameById.get(e.startedBy) ?? null,
    completedAt: e.completedAt ? e.completedAt.toISOString() : null,
    version: e.version,
    isDeleted: e.isDeleted,
    deletedAt: e.deletedAt ? e.deletedAt.toISOString() : null,
    // 🔴 마친 사람은 여기 없다 — 이 표에 completed_by 칸이 아예 없다
    // (finishProcedureExecution 의 ⚠️ 주석). 시작한 사람을 그 자리에 빌려 쓰지
    // 않는다. 그러면 화면이 「이 사람이 마쳤다」로 읽히는 거짓을 적게 된다.
    deletedByName: e.deletedBy ? (nameById.get(e.deletedBy) ?? null) : null,
    deleteReason: e.deleteReason,
  }));
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
  /**
   * 1 부터 매긴 **절차상 번호** — 이 배열이 늘어선 차례 그대로다. 화면이
   * 카드에 그리는 번호가 이것이고, 요약의 「N번째 / 전체」와 같은 자를 쓴다.
   *
   * 🔴 node_code 가 아니다. node_code 는 들여올 때의 도형 식별자
   * (`s11-14`)이거나 손으로 만든 절차의 난수(`manual-<uuid>`)라 사람에게는
   * 아무 뜻이 없다 — 자세한 까닭은 procedure-execution-order.ts 머리말에 있다.
   */
  orderIndex: number;
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

/**
 * 템플릿 간선을 **그대로** 실은 것 — 실행 화면의 작은 흐름 그림이 쓴다
 * (procedure-execution-minimap.ts).
 *
 * 🔴 노드마다 달린 outgoingEdgeOptions 로는 그림을 못 그린다. 그쪽은 **판단
 * 노드에만** 채워지고(비판단 노드는 빈 배열), 들어오는 선은 아예 없다 —
 * 「어디서 왔는가」가 그림의 절반인데 그 절반이 비어 있다.
 *
 * 양끝은 procedure_template_nodes.id 다. START·참고 문서처럼 실행 행이 없는
 * 노드로 가는 선도 섞여 있고, 거르는 것은 받는 쪽 몫이다 — 여기서 미리 걸러
 * 두면 「왜 간선 수가 편집 화면과 다른가」를 나중에 아무도 설명하지 못한다.
 */
export type ExecutionFlowEdge = {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  branchType: ProcedureBranchType;
  branchLabel: string | null;
  /**
   * 🔵 2026-11-02(조각 10)에 칸 둘이 늘었다 — sortOrder · sourceConnectorId.
   * 「전체 단계 보기」 팝업의 플로우차트가 ProcedureFlowGraph 를 그대로 쓰는데,
   * 그 그림이 받는 간선 모양(ProcedureTemplateEdgeRow)에 이 둘이 들어 있다.
   *
   * 간선을 **두 벌로 내려보내지 않으려고** 여기에 더했다 — 흐름 띠(minimap)가
   * 쓰는 것과 같은 배열이고, 띠 쪽은 이 둘을 안 읽으므로 하는 일이 안 바뀐다.
   */
  sortOrder: number;
  sourceConnectorId: string | null;
};

export type ExecutionDetail = {
  executionId: string;
  repairCaseId: string;
  procedureTemplateId: string;
  templateCode: string;
  templateName: string;
  startedByName: string;
  startedAt: string;
  /** 끝낸 실행이면 그 시각(ISO). 아직 돌고 있으면 null. */
  completedAt: string | null;
  /**
   * 실행 **행 자신의** 낙관적 동시성 토큰 — 노드마다 따로 있는 version 과 다른
   * 값이다. 끝내기·그만두기가 이것을 보고 다툼을 가른다.
   */
  version: number;
  isCaseLocked: boolean;
  nodes: ExecutionNodeDetail[];
  referenceNodes: ExecutionReferenceNode[];
  flowEdges: ExecutionFlowEdge[];
  /**
   * 이 실행이 붙어 있는 절차의 **갈래**(2026-11-02, 조각 10). 「전체 단계 보기」
   * 팝업의 그림이 배치를 고를 때 쓴다 — 손으로 만든(TECHNICAL_TASK) 절차의
   * position_x/y 는 만든 차례대로 쌓은 값이라 배치로서 뜻이 없다(불러오기 창의
   * 그림이 쓰는 것과 **같은 조건**이다 — ProcedureStartPickerGraph).
   */
  templateCategory: ProcedureTemplateCategory;
  /**
   * 절차 **그림 재료**로서의 노드 — 「전체 단계 보기」 팝업의 플로우차트가
   * 그린다(2026-11-02, 조각 10).
   *
   * 🔴 위의 `nodes`(실행 노드)와 **다른 것**이다. 이쪽은 START 와 참고 문서까지
   * 전부 들어 있고(그림은 절차 전체를 그린다) 실행 상태가 없다. 상태는 실행
   * 노드의 procedureTemplateNodeId 로 맞물려 그림에 얹는다
   * (buildJumpStatusMarks).
   *
   * 🔵 받는 칸은 불러오기 창과 **같은 열한 개**다(ExecutableTemplateNode) —
   * 그 그림이 실제로 읽는 칸만. instructions 같은 긴 글은 실행 노드 쪽에 이미
   * 실려 있으므로 여기 또 실으면 같은 글이 두 번 내려간다.
   */
  templateNodes: ExecutableTemplateNode[];
};

export async function getExecutionDetail(executionId: string): Promise<ExecutionDetail | null> {
  const [execution] = await db
    .select({
      id: procedureCaseExecutions.id,
      repairCaseId: procedureCaseExecutions.repairCaseId,
      procedureTemplateId: procedureCaseExecutions.procedureTemplateId,
      startedAt: procedureCaseExecutions.startedAt,
      startedBy: procedureCaseExecutions.startedBy,
      completedAt: procedureCaseExecutions.completedAt,
      version: procedureCaseExecutions.version,
      templateCode: procedureTemplates.code,
      templateName: procedureTemplates.name,
      // 그림의 배치 규칙이 이 값으로 갈린다 — 조각 10 의 팝업이 쓴다.
      templateCategory: procedureTemplates.category,
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

  // sortOrder 가 여기 끼어든 까닭은 아래 정렬이 쓰기 때문이다. ORDER BY 는
  // 참고 문서 목록(referenceNodes)이 이 배열 차례를 그대로 쓰므로 함께 건다 —
  // 그쪽도 전에는 DB 가 주는 대로였다.
  //
  // 🔵 2026-11-02(조각 10)에 **배치 칸 넷과 출처 칸 둘**이 늘었다. 「전체 단계
  // 보기」 팝업이 이 목록으로 플로우차트를 그린다 — 조회를 하나 더 두지 않고
  // 이미 읽는 이 줄에 칸만 보탠다(노드 수가 실측 23·28 이라 거의 공짜다).
  const templateNodes = await db
    .select({
      id: procedureTemplateNodes.id,
      nodeCode: procedureTemplateNodes.nodeCode,
      nodeType: procedureTemplateNodes.nodeType,
      title: procedureTemplateNodes.title,
      instructions: procedureTemplateNodes.instructions,
      sortOrder: procedureTemplateNodes.sortOrder,
      positionX: procedureTemplateNodes.positionX,
      positionY: procedureTemplateNodes.positionY,
      userPositionX: procedureTemplateNodes.userPositionX,
      userPositionY: procedureTemplateNodes.userPositionY,
      sourceWorksheet: procedureTemplateNodes.sourceWorksheet,
      sourceShapeId: procedureTemplateNodes.sourceShapeId,
    })
    .from(procedureTemplateNodes)
    .where(eq(procedureTemplateNodes.procedureTemplateId, execution.procedureTemplateId))
    .orderBy(procedureTemplateNodes.sortOrder, procedureTemplateNodes.nodeCode);
  const templateNodeById = new Map(templateNodes.map((n) => [n.id, n]));

  const templateEdges = await db
    .select({
      id: procedureTemplateEdges.id,
      fromNodeId: procedureTemplateEdges.fromNodeId,
      toNodeId: procedureTemplateEdges.toNodeId,
      branchType: procedureTemplateEdges.branchType,
      branchLabel: procedureTemplateEdges.branchLabel,
      // 🔵 2026-11-02(조각 10) — 팝업의 플로우차트가 받는 간선 모양에 이 둘이
      // 들어 있다. 간선을 두 벌로 내려보내지 않으려고 같은 배열에 실어 보낸다.
      sortOrder: procedureTemplateEdges.sortOrder,
      sourceConnectorId: procedureTemplateEdges.sourceConnectorId,
    })
    .from(procedureTemplateEdges)
    .where(eq(procedureTemplateEdges.procedureTemplateId, execution.procedureTemplateId))
    // 판단 노드의 갈래 단추가 이 차례로 늘어선다(DecisionCompleteDialog).
    // 전에는 DB 가 주는 대로라 새로고침할 때마다 「정상 / NG」가 자리를
    // 바꿀 수 있었다 — sort_order 는 절차를 만든 사람이 매긴 차례다.
    .orderBy(procedureTemplateEdges.sortOrder);
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
  //
  // 🔴 차례는 **여기 한 곳에서만** 정한다. 화면이 저마다 다시 정렬하면 같은
  // 절차가 화면마다 다른 차례로 보인다(이 저장소에서 실제로 겪었다). 무엇으로
  // 정렬하는지와 왜 그것인지는 procedure-execution-order.ts 머리말에 있다 —
  // 요지는 node_code 에도 그래프에도 차례가 없고, 템플릿의 sort_order 만이
  // 사람이 적은 차례라는 것.
  //
  const orderedEntries = sortByProcedureExecutionOrder(
    execNodes
      .map((n) => {
        const templateNode = n.procedureTemplateNodeId ? templateNodeById.get(n.procedureTemplateNodeId) : undefined;
        return {
          id: n.id,
          procedureSortOrder: templateNode?.sortOrder ?? null,
          nodeCode: templateNode?.nodeCode ?? null,
          addedAt: n.createdAt.toISOString(),
          row: n,
          templateNode,
        };
      })
      .filter((entry) => !entry.templateNode || !isSystemEntryNodeType(entry.templateNode.nodeType))
  );

  const nodes: ExecutionNodeDetail[] = orderedEntries
    .map((entry, index) => {
      const n = entry.row;
      const templateNode = entry.templateNode;
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
        // START 와 참고 문서가 이미 빠진 뒤의 1-based 번호 — 사람이 할 일만
        // 센다. 그래서 요약의 「N번째 / 전체 N」과 자가 정확히 같다.
        orderIndex: index + 1,
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
    completedAt: execution.completedAt ? execution.completedAt.toISOString() : null,
    version: execution.version,
    isCaseLocked: execution.isCaseLocked,
    nodes,
    referenceNodes,
    // 간선 차례는 위 orderBy(sortOrder) 가 정한 그대로 내려보낸다 — 흐름 그림의
    // 갈래 차례가 「지금 할 일」 카드의 갈래 단추 차례와 같아야 한다.
    flowEdges: templateEdges.map((e) => ({
      id: e.id,
      fromNodeId: e.fromNodeId,
      toNodeId: e.toNodeId,
      branchType: e.branchType,
      branchLabel: e.branchLabel,
      sortOrder: e.sortOrder,
      sourceConnectorId: e.sourceConnectorId,
    })),
    templateCategory: execution.templateCategory,
    // 🔴 **거르지 않는다.** 그림은 절차 전체를 그리므로 START 도 참고 문서도
    // 그대로 들어간다 — 위의 `nodes`(실행 노드)가 START 를 빼는 것과 잣대가
    // 다른 까닭이 그것이다. 그 둘을 못 고르게 막는 것은 판정 쪽의 일이다
    // (classifyJumpTarget 이 실행 행이 없는 칸을 NOT_IN_EXECUTION 으로 가른다).
    templateNodes: templateNodes.map((n) => ({
      id: n.id,
      nodeCode: n.nodeCode,
      nodeType: n.nodeType,
      title: n.title,
      positionX: n.positionX,
      positionY: n.positionY,
      userPositionX: n.userPositionX,
      userPositionY: n.userPositionY,
      sortOrder: n.sortOrder,
      sourceWorksheet: n.sourceWorksheet,
      sourceShapeId: n.sourceShapeId,
    })),
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
