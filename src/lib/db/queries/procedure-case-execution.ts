import "server-only";
import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { db } from "../client";
import {
  procedureCaseExecutions,
  procedureCaseExecutionNodes,
  procedureCaseExecutionEdges,
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
import {
  resolveAddedTaskAnchors,
  sortByProcedureExecutionOrder,
  type AddedTaskAnchor,
} from "@/lib/domain/procedure-execution-order";
// 🔴 눈금은 도메인에 한 벌만 있다 — 화면도 같은 값으로 「고른 작업의 오른쪽」을
// 센다(procedure-execution-layout.ts 머리말).
import { resolveNextProcedureTarget } from "@/lib/domain/procedure-next-procedure-link";
import { ADDED_NODE_GAP_X, ADDED_NODE_GAP_Y } from "@/lib/domain/procedure-execution-layout";
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
    // 🔴 치운 추가 작업은 안 센다(2026-11-03, 조각 13). 안 거르면 「이 건의 다른
    // 절차」 줄의 분모만 커져서, 같은 실행인데 큰 카드는 「전체 22」인데 이 줄은
    // 「/ 23」이 된다 — 바로 아래 START 를 빼는 것과 같은 까닭이다.
    .where(
      and(
        inArray(procedureCaseExecutionNodes.executionId, executionIds),
        eq(procedureCaseExecutionNodes.isDeleted, false)
      )
    );

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
   * **그림 위 자리 id**(2026-11-03, 조각 13) — 템플릿에서 온 줄은
   * `procedureTemplateNodeId`, 이 건에서 더한 작업은 **제 실행 노드 id** 다.
   *
   * 🔴 도메인 함수들이 전부 이 열쇠로 그림을 걷는다(흐름 띠 · 최단 경로 · 자동
   * 전진 · 옮기기 딱지). 추가 작업에 자리를 안 주면 그 넷이 추가 작업 앞에서
   * 통째로 멈춘다 — 조각 12 까지가 그 상태였다.
   */
  graphNodeId: string;
  /** 이 건에서 더한 작업인가(= procedureTemplateNodeId 가 비었는가). 치울 수 있는 줄이 이것뿐이다. */
  isAddedInCase: boolean;
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
  /**
   * 🔵 2026-11-03(조각 13)부터 **추가 작업도 갈래를 가진다**(extra_task_node_type).
   * 읽는 차례는 「템플릿 노드의 갈래 → 추가 작업의 갈래」이고, 둘 다 없는 줄
   * (칸이 생기기 전에 등록된 옛 추가 작업)만 null 이다. 판단 노드인지 가리는
   * 자리가 이 값 하나를 본다 — 화면도(CurrentTaskCard) 쓰기 쪽도 같다.
   */
  nodeType: ProcedureNodeType | null;
  title: string;
  instructions: string | null;
  status: ProcedureCaseExecutionNodeStatus;
  selectedOutgoingEdgeId: string | null;
  /**
   * Only populated for DECISION nodes — the choices completeExecutionNode's
   * selectedOutgoingEdgeId accepts.
   *
   * 🔵 2026-11-03(조각 13) — **이 건에서 그은 갈래도 들어 있다.** 판단 노드에서
   * 나가는 선이면 템플릿 것이든 더한 것이든 고를 수 있어야, 「추가 작업으로
   * 가는 NG 갈래」가 단추로 선다.
   */
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
  /**
   * [종료]의 「다음 절차」 (2026-11-04, 줄기 B ④ 조각 ④).
   *
   * 🔵 **null 은 「안 가리킴」이다.** 가리켰는데 못 여는 경우는 null 이 아니라
   * `{ ok: false, reason }` 으로 온다 — 그 둘이 화면에서 같아 보이면, 지정해
   * 놓고 안 열린 것을 사람이 「원래 없는 기능」으로 읽는다.
   */
  nextProcedure: ExecutionNextProcedure | null;
};

/** [종료]에서 이어 열 절차 — 계열에서 지금 게시본을 푼 결과다. */
export type ExecutionNextProcedure =
  | { ok: true; templateId: string; name: string; version: number }
  | { ok: false; reason: string };

export type ExecutionReferenceNode = {
  id: string;
  nodeCode: string;
  title: string;
  instructions: string | null;
};

/**
 * 흐름 그림의 선 하나 — 실행 화면의 작은 흐름 띠
 * (procedure-execution-minimap.ts), 「전체 단계 보기」 팝업의 플로우차트, 최단
 * 경로, 자동 전진이 **전부 이 한 목록**을 쓴다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 🔴 **합치는 자리가 여기 한 곳**이다(2026-11-03, 조각 13)
 * ──────────────────────────────────────────────────────────────────────
 * procedure_template_edges(원본 절차의 선)와 procedure_case_execution_edges
 * (이 건에서 그은 선)를 getExecutionDetail 이 **한 배열로** 내려보낸다. 받는
 * 쪽 넷은 두 표가 있다는 것을 몰라도 되고, 그래서 「추가 간선을 어디에 더
 * 반영해야 하나」를 자리마다 다시 묻지 않아도 된다 — 그중 하나를 빠뜨리면
 * 「흐름 띠에는 보이는데 진행률에는 안 세는」 식의 어긋남이 조용히 생긴다.
 *
 * 🔴 노드마다 달린 outgoingEdgeOptions 로는 그림을 못 그린다. 그쪽은 **판단
 * 노드에만** 채워지고(비판단 노드는 빈 배열), 들어오는 선은 아예 없다 —
 * 「어디서 왔는가」가 그림의 절반인데 그 절반이 비어 있다.
 *
 * 양끝은 **그림 위 자리 id** 다(ExecutionNodeDetail.graphNodeId 와 같은 열쇠).
 * START·참고 문서처럼 실행 행이 없는 노드로 가는 선도 섞여 있고, 거르는 것은
 * 받는 쪽 몫이다 — 여기서 미리 걸러 두면 「왜 간선 수가 편집 화면과 다른가」를
 * 나중에 아무도 설명하지 못한다.
 */
export type ExecutionFlowEdge = {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  branchType: ProcedureBranchType;
  branchLabel: string | null;
  /**
   * 이 건에서 그은 선인가. 🔴 **지울 수 있는 선이 이것뿐**이라 창이 이 값으로
   * 단추를 가른다(템플릿 선을 고르면 까닭이 적힌다). 쓰기 쪽도 같은 사실을
   * 제 손으로 다시 확인한다 — 화면 값을 믿고 지우지 않는다.
   */
  isAddedInCase: boolean;
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

/**
 * 그림의 한 칸. 불러오기 창이 쓰는 ExecutableTemplateNode 와 **같은 열한
 * 칸**에, 이 건에서 더한 작업인지 한 칸만 보탠 모양이다.
 *
 * 🔴 더한 작업에는 저장된 칸이 없다 — 아래 값들은 조회가 **만들어** 넣는다:
 *  - `id`        … 그 작업의 실행 노드 id(= 그림 위 자리 id).
 *  - `nodeCode`  … `extra-<실행 노드 id>`. 손으로 만든 절차 노드가 쓰는
 *                  `manual-<uuid>` 와 같은 꼴이라 눈으로도 갈린다.
 *  - `nodeType`  … 사람이 고른 갈래(extra_task_node_type). 칸이 생기기 전에
 *                  등록된 옛 줄은 비어 있어 TASK 로 읽는다.
 *  - 좌표        … **바로 앞 칸의 오른쪽**에 세운다(아래 placeAddedGraphNodes).
 *                  저장하지 않는다 — 다음에 열어도 같은 규칙으로 같은 자리다.
 */
export type ExecutionGraphNode = ExecutableTemplateNode & {
  isAddedInCase: boolean;
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
   * **그림 재료**로서의 칸 — 「전체 단계 보기」 팝업과 「추가 작업 등록」 창의
   * 플로우차트가 그린다.
   *
   * 🔴 2026-11-03(조각 13)에 이름이 `templateNodes` 에서 바뀌었다. 이제 **이
   * 건에서 더한 작업도 한 칸**이라 「템플릿 노드」라는 이름이 거짓이 됐기
   * 때문이다 — 이 저장소가 「주석이 실측과 어긋나면 안 된다」로 적어 둔 그것이다.
   *
   * 🔴 위의 `nodes`(실행 노드)와 **다른 것**이다. 이쪽은 START 와 참고 문서까지
   * 전부 들어 있고(그림은 절차 전체를 그린다) 실행 상태가 없다. 상태는 실행
   * 노드의 graphNodeId 로 맞물려 그림에 얹는다(buildJumpStatusMarks).
   *
   * 🔵 받는 칸은 불러오기 창과 **같은 열한 개 + 하나**다 — 그 그림이 실제로 읽는
   * 칸에 `isAddedInCase` 만 보탰다. instructions 같은 긴 글은 실행 노드 쪽에 이미
   * 실려 있으므로 여기 또 실으면 같은 글이 두 번 내려간다.
   */
  graphNodes: ExecutionGraphNode[];
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

  // 🔴 치운 추가 작업은 **읽지 않는다**(2026-11-03, 조각 13). 행은 그대로 남는다 —
  // 감사 이력이 그 행을 가리키고 있어서 진짜로 지울 수 없기 때문이다(스키마의
  // is_deleted 주석). 여기서 안 거르면 「지웠는데 그대로 있다」가 되고, 그것은
  // 오류를 하나도 안 내므로 눈으로만 드러난다.
  const execNodes = await db
    .select()
    .from(procedureCaseExecutionNodes)
    .where(and(eq(procedureCaseExecutionNodes.executionId, executionId), eq(procedureCaseExecutionNodes.isDeleted, false)));

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
      // 2026-11-04(줄기 B ④ 조각 ④) — [종료]의 「다음 절차」. 이미 읽는 줄에
      // 칸만 보탠다.
      nextProcedureTemplateId: procedureTemplateNodes.nextProcedureTemplateId,
    })
    .from(procedureTemplateNodes)
    .where(eq(procedureTemplateNodes.procedureTemplateId, execution.procedureTemplateId))
    .orderBy(procedureTemplateNodes.sortOrder, procedureTemplateNodes.nodeCode);
  const templateNodeById = new Map(templateNodes.map((n) => [n.id, n]));

  /**
   * ── [종료]의 「다음 절차」 풀기 (2026-11-04, 줄기 B ④ 조각 ④) ──────────
   *
   * 🔴 **가리킨 판을 그대로 열지 않는다.** 그 판의 계열(code)에서 **지금
   * 게시본**을 찾아 연다 — 절차는 계속 개정되고, 판을 콕 집으면 그 판이
   * 만료되는 날 이어가기가 통째로 막힌다(사용자 결정, 2026-11-04).
   * 푸는 규칙은 domain/procedure-next-procedure-link.ts 한 곳에 있다.
   *
   * 🔵 **못 열 때도 null 로 넘기지 않는다.** 「원래 안 가리킴」과 「가리켜 놨는데
   * 못 엶」은 화면에서 구별되지 않는다 — 뒤쪽은 까닭을 적어 사람에게 보인다.
   *
   * 🔵 지정이 하나도 없으면 바깥 조회를 아예 안 한다(지금 운영의 END 전부가
   * 그 자리다).
   */
  const pointedIds = [
    ...new Set(templateNodes.map((n) => n.nextProcedureTemplateId).filter((id): id is string => id !== null)),
  ];
  const nextProcedureByTemplateNodeId = new Map<string, ExecutionNextProcedure>();
  if (pointedIds.length > 0) {
    const pointedRows = await db
      .select({ id: procedureTemplates.id, code: procedureTemplates.code })
      .from(procedureTemplates)
      .where(inArray(procedureTemplates.id, pointedIds));
    const pointedCodes = [...new Set(pointedRows.map((r) => r.code))];

    // 그 계열들의 **살아 있는 판 전부**. 지워진 행은 여기서 걸러 넘긴다 —
    // resolveNextProcedureTarget 은 받은 후보를 다시 거르지 않는다.
    const seriesRows =
      pointedCodes.length === 0
        ? []
        : await db
            .select({
              id: procedureTemplates.id,
              code: procedureTemplates.code,
              name: procedureTemplates.name,
              version: procedureTemplates.version,
              status: procedureTemplates.status,
            })
            .from(procedureTemplates)
            .where(and(inArray(procedureTemplates.code, pointedCodes), eq(procedureTemplates.isDeleted, false)));
    const seriesById = new Map(seriesRows.map((r) => [r.id, r]));

    for (const templateNode of templateNodes) {
      const pointedId = templateNode.nextProcedureTemplateId;
      if (pointedId === null) continue;
      const resolved = resolveNextProcedureTarget({
        pointedTemplate: seriesById.get(pointedId) ?? null,
        candidates: seriesRows,
      });
      nextProcedureByTemplateNodeId.set(
        templateNode.id,
        resolved.ok
          ? {
              ok: true,
              templateId: resolved.templateId,
              version: resolved.version,
              name: seriesById.get(resolved.templateId)?.name ?? "-",
            }
          : { ok: false, reason: resolved.reason }
      );
    }
  }

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
  // ────────────────────────────────────────────────────────────────────
  // 🔴 **두 표를 여기서 한 목록으로 합친다**(2026-11-03, 조각 13)
  // ────────────────────────────────────────────────────────────────────
  // 이 건에서 그은 선(procedure_case_execution_edges)의 양끝은 **실행 노드**
  // id 다. 그림·경로·띠·자동 전진은 전부 **그림 위 자리 id** 로 걷게 되어
  // 있으므로, 여기서 한 번만 옮겨 적는다 — 템플릿에서 온 줄은 그 템플릿 노드
  // id, 더한 작업은 제 실행 노드 id.
  //
  // 🔵 합치는 자리를 하나로 둔 덕에 앞 조각 다섯(차례 · 자동 전진 · 흐름 띠 ·
  // 최단 경로 · 옮기기 팝업)이 **고칠 것 없이** 추가 간선을 따라간다.
  const executionEdgeRows = await db
    .select({
      id: procedureCaseExecutionEdges.id,
      fromNodeId: procedureCaseExecutionEdges.fromNodeId,
      toNodeId: procedureCaseExecutionEdges.toNodeId,
      branchType: procedureCaseExecutionEdges.branchType,
      branchLabel: procedureCaseExecutionEdges.branchLabel,
      sortOrder: procedureCaseExecutionEdges.sortOrder,
    })
    .from(procedureCaseExecutionEdges)
    .where(
      and(eq(procedureCaseExecutionEdges.executionId, executionId), eq(procedureCaseExecutionEdges.isDeleted, false))
    )
    // 템플릿 간선과 같은 잣대로 줄 세운다 — 판단 노드의 갈래 단추 차례가 이것이다.
    .orderBy(procedureCaseExecutionEdges.sortOrder, procedureCaseExecutionEdges.createdAt);

  const execNodeById = new Map(execNodes.map((n) => [n.id, n]));
  /** 실행 줄 하나의 **그림 위 자리 id**. 이 규칙이 이 파일에 단 한 번만 적힌다. */
  const graphNodeIdOf = (n: { id: string; procedureTemplateNodeId: string | null }): string =>
    n.procedureTemplateNodeId ?? n.id;

  const addedNodeRows = execNodes.filter((n) => n.procedureTemplateNodeId === null);

  const flowEdges: ExecutionFlowEdge[] = [
    // 간선 차례는 위 orderBy(sortOrder) 가 정한 그대로다 — 흐름 그림의 갈래
    // 차례가 「지금 할 일」 카드의 갈래 단추 차례와 같아야 한다.
    ...templateEdges.map((e) => ({
      id: e.id,
      fromNodeId: e.fromNodeId,
      toNodeId: e.toNodeId,
      branchType: e.branchType,
      branchLabel: e.branchLabel,
      isAddedInCase: false,
      sortOrder: e.sortOrder,
      sourceConnectorId: e.sourceConnectorId,
    })),
    ...executionEdgeRows
      // 🔴 치운 작업에 걸린 선은 뺀다. 치우기가 제 선도 함께 치우므로 보통은
      // 걸릴 것이 없지만, 걸러 두지 않으면 한쪽만 남은 선이 그림에 **끝이 없는
      // 화살표**로 그려진다(ReactFlow 는 모르는 노드를 가리키는 선을 그냥 버린다 —
      // 버려진다는 사실이 화면 어디에도 안 적힌다).
      .filter((e) => execNodeById.has(e.fromNodeId) && execNodeById.has(e.toNodeId))
      .map((e) => ({
        id: e.id,
        fromNodeId: graphNodeIdOf(execNodeById.get(e.fromNodeId)!),
        toNodeId: graphNodeIdOf(execNodeById.get(e.toNodeId)!),
        branchType: e.branchType,
        branchLabel: e.branchLabel,
        isAddedInCase: true,
        sortOrder: e.sortOrder,
        // 엑셀 도형 연결자는 원본 절차에만 있는 것이다 — 손으로 그은 선에는 없다.
        sourceConnectorId: null,
      })),
  ];

  // 🔵 **이어 붙인 작업이 목록의 어디에 서는가.** 그림을 걸어 앞 칸을 찾는 일은
  // 도메인이 한다(resolveAddedTaskAnchors) — 차례도 그림의 자리도 같은 답에서
  // 나와야 목록과 플로우차트가 같은 「앞 작업」을 가리킨다.
  const anchorByGraphNodeId: ReadonlyMap<string, AddedTaskAnchor> = resolveAddedTaskAnchors({
    templateNodes: templateNodes.map((n) => ({ graphNodeId: n.id, sortOrder: n.sortOrder })),
    addedGraphNodeIds: addedNodeRows.map((n) => n.id),
    edges: flowEdges,
  });

  const outgoingEdgesByFromNodeId = new Map<string, ExecutionFlowEdge[]>();
  for (const edge of flowEdges) {
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

  // ────────────────────────────────────────────────────────────────────
  // 그림 재료 — 템플릿 칸 + 이 건에서 더한 칸
  // ────────────────────────────────────────────────────────────────────
  // 🔴 **거르지 않는다.** 그림은 절차 전체를 그리므로 START 도 참고 문서도
  // 그대로 들어간다 — 아래 `nodes`(실행 노드)가 START 를 빼는 것과 잣대가 다른
  // 까닭이 그것이다. 그 둘을 못 고르게 막는 것은 판정 쪽의 일이다
  // (classifyJumpTarget 이 실행 행이 없는 칸을 NOT_IN_EXECUTION 으로 가른다).
  const graphNodes: ExecutionGraphNode[] = templateNodes.map((n) => ({
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
    isAddedInCase: false,
  }));
  graphNodes.push(...placeAddedGraphNodes(addedNodeRows, graphNodes, anchorByGraphNodeId));

  // Suggested-next computation (plan §7) — guidance only, never a gate.
  //
  // 🔵 2026-11-03(조각 13) — 합친 그림을 그대로 넘긴다. 더한 작업이 「들어오는
  // 선이 없어 무조건 추천」이던 가지가 사라지고, 이은 작업은 템플릿 노드와 같은
  // 잣대로 판정된다(computeSuggestedNextNodes 의 그 자리 주석).
  const topologyNodes: TopologyNode[] = graphNodes.map((n) => ({ id: n.id, nodeType: n.nodeType }));
  const topologyEdges: TopologyEdge[] = flowEdges.map((e) => ({ id: e.id, fromNodeId: e.fromNodeId, toNodeId: e.toNodeId }));
  const topologyExecutionNodes: TopologyExecutionNode[] = execNodes.map((n) => ({
    id: n.id,
    graphNodeId: graphNodeIdOf(n),
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
  // 🔵 2026-11-03(조각 13) — 이어 붙인 추가 작업은 **맨 뒤가 아니라 그 앞 작업
  // 바로 뒤**에 선다(anchorByGraphNodeId). 아무 선에도 안 닿은 추가 작업은
  // 전처럼 맨 뒤다.
  const graphNodeTitleById = new Map(graphNodes.map((n) => [n.id, n.title]));
  const orderedEntries = sortByProcedureExecutionOrder(
    execNodes
      .map((n) => {
        const templateNode = n.procedureTemplateNodeId ? templateNodeById.get(n.procedureTemplateNodeId) : undefined;
        const anchor = anchorByGraphNodeId.get(n.id);
        return {
          id: n.id,
          procedureSortOrder: templateNode?.sortOrder ?? anchor?.procedureSortOrder ?? null,
          insertionDepth: anchor?.insertionDepth ?? 0,
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
      const graphNodeId = graphNodeIdOf(n);
      // 🔴 갈래는 「템플릿 노드 → 추가 작업」 차례로 한 번만 읽는다. 화면도 쓰기
      // 쪽도 이 값을 보고 판단 노드인지 가르므로, 자리마다 다시 ?? 로 이으면
      // 한쪽만 고치는 날이 온다(타입이 같아 컴파일러는 침묵한다).
      const nodeType = templateNode?.nodeType ?? n.extraTaskNodeType;
      const effectiveAssigneeId = n.assignedEngineerId ?? execution.caseAssignedEngineerId;
      const outgoingEdgeOptions: ExecutionOutgoingEdgeOption[] =
        nodeType === "DECISION"
          ? (outgoingEdgesByFromNodeId.get(graphNodeId) ?? []).map((e) => ({
              edgeId: e.id,
              toNodeId: e.toNodeId,
              toNodeTitle: graphNodeTitleById.get(e.toNodeId) ?? "-",
              branchType: e.branchType,
              branchLabel: e.branchLabel,
            }))
          : [];

      return {
        id: n.id,
        procedureTemplateNodeId: n.procedureTemplateNodeId,
        graphNodeId,
        isAddedInCase: n.procedureTemplateNodeId === null,
        // START 와 참고 문서가 이미 빠진 뒤의 1-based 번호 — 사람이 할 일만
        // 센다. 그래서 요약의 「N번째 / 전체 N」과 자가 정확히 같다.
        orderIndex: index + 1,
        nodeCode: templateNode?.nodeCode ?? null,
        nodeType,
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
        // 🔵 이 건에서 더한 작업(템플릿 노드가 없는 줄)에는 지정이 있을 수 없다 —
        //    칸이 템플릿 노드에만 있기 때문이다. 그래서 자연히 null 이 된다.
        nextProcedure: templateNode ? (nextProcedureByTemplateNodeId.get(templateNode.id) ?? null) : null,
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
    flowEdges,
    templateCategory: execution.templateCategory,
    graphNodes,
  };
}

// ---- 더한 작업을 그림의 **어디에** 그리는가 ----

/**
 * 이 건에서 더한 작업의 **그림 좌표**를 정한다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 🔵 2026-11-03(조각 14) — **사람이 정한 자리가 있으면 그것이 이긴다**
 * ──────────────────────────────────────────────────────────────────────
 * user_position_x/y 가 찬 줄은 사람이 끌어다 놓았거나 등록할 때 방향을 고른
 * 줄이다. 그 자리를 그대로 쓰고 **아무것도 다시 세지 않는다** — 다시 세면
 * 새로고침할 때마다 칸이 원래 자리로 돌아가고, 사람은 「드래그가 저장이 안
 * 된다」고 읽는다.
 *
 * 🔴 **비어 있는 줄은 조각 13 까지와 글자 하나 다르지 않게** 센다. 칸이 생기기
 * 전에 등록된 추가 작업이 그대로 남아 있고(개발 DB 실측 2026-11-03: 실행 노드
 * 250줄), 그 줄들의 자리가 이 판에서 움직이면 안 된다. 규칙은 그대로 둘이다:
 *  - 앞 칸이 있으면 **그 칸 오른쪽**, 같은 앞 칸에 여럿이면 아래로 쌓는다.
 *  - 앞 칸이 없으면(아무 선에도 안 닿은 작업) 그림 **오른쪽 바깥**에 한 줄로
 *    세운다. 겹쳐 놓으면 칸 하나처럼 보여서 「등록했는데 안 생겼다」가 된다.
 *
 * 🔵 **형제 자리는 저절로 센 줄끼리만 센다.** 한 앞 칸에 둘이 붙었는데 하나를
 * 사람이 끌어갔다면, 남은 하나는 비워진 첫 칸을 쓴다 — 끌려간 줄이 자리를 계속
 * 잡고 있으면 아무도 안 쓰는 빈칸이 그림에 생긴다.
 *
 * 🔴 **깊이 차례로** 센다. 사슬(앞 칸도 더한 작업인 경우)에서 부모 자리가 먼저
 * 정해져 있어야 자식이 그 옆에 선다 — 차례를 안 지키면 부모가 아직 (0,0) 일 때
 * 자식이 (300,0) 에 서고, 나중에 부모가 옮겨 가 둘이 멀어진다.
 *
 * 🔵 좌표는 **보이는 것**이라 시험으로 지키지 않는다(이 저장소의 「세는 화면의
 * 결함은 눈으로만 잡힌다」). 대신 겹치거나 사라지지 않을 근거를 규칙으로 못 박아
 * 둔다 — 같은 앞 칸의 형제는 서로 다른 y 를, 앞 칸 없는 것은 서로 다른 y 를 받는다.
 */
function placeAddedGraphNodes(
  addedRows: readonly (typeof procedureCaseExecutionNodes.$inferSelect)[],
  placedNodes: readonly ExecutionGraphNode[],
  anchorByGraphNodeId: ReadonlyMap<string, AddedTaskAnchor>
): ExecutionGraphNode[] {
  const effectivePosition = new Map<string, { x: number; y: number }>();
  let rightmostX = 0;
  let maxSortOrder = 0;
  for (const node of placedNodes) {
    const x = node.userPositionX ?? node.positionX;
    const y = node.userPositionY ?? node.positionY;
    effectivePosition.set(node.id, { x, y });
    if (x > rightmostX) rightmostX = x;
    if (node.sortOrder > maxSortOrder) maxSortOrder = node.sortOrder;
  }

  const siblingCountByAnchor = new Map<string, number>();
  let floatingCount = 0;

  // 깊이 오름차순, 같으면 만들어진 차례 — 같은 입력이면 언제나 같은 자리다.
  const ordered = [...addedRows].sort((a, b) => {
    const da = anchorByGraphNodeId.get(a.id)?.insertionDepth ?? Number.MAX_SAFE_INTEGER;
    const db2 = anchorByGraphNodeId.get(b.id)?.insertionDepth ?? Number.MAX_SAFE_INTEGER;
    if (da !== db2) return da - db2;
    const ta = a.createdAt.getTime();
    const tb = b.createdAt.getTime();
    if (ta !== tb) return ta - tb;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  const made: ExecutionGraphNode[] = [];
  for (const row of ordered) {
    const anchor = anchorByGraphNodeId.get(row.id);
    let x: number;
    let y: number;
    // 🔴 사람이 정한 자리가 먼저다 — 있으면 세지 않는다(이 함수 머리말).
    //    두 칸을 **함께** 봐야 한다: 한쪽만 찬 줄은 자리가 아니라 반쪽이라
    //    그릴 수 없다(절차 노드 쪽의 hasUserLayoutOverride 와 같은 잣대).
    if (row.userPositionX !== null && row.userPositionY !== null) {
      x = row.userPositionX;
      y = row.userPositionY;
    } else if (anchor) {
      const base = effectivePosition.get(anchor.anchorGraphNodeId) ?? { x: rightmostX, y: 0 };
      const sibling = siblingCountByAnchor.get(anchor.anchorGraphNodeId) ?? 0;
      siblingCountByAnchor.set(anchor.anchorGraphNodeId, sibling + 1);
      x = base.x + ADDED_NODE_GAP_X;
      y = base.y + sibling * ADDED_NODE_GAP_Y;
    } else {
      x = rightmostX + ADDED_NODE_GAP_X;
      y = floatingCount * ADDED_NODE_GAP_Y;
      floatingCount += 1;
    }
    effectivePosition.set(row.id, { x, y });

    made.push({
      id: row.id,
      // 손으로 만든 절차 노드가 쓰는 `manual-<uuid>` 와 같은 꼴 — 눈으로도 갈린다.
      nodeCode: `extra-${row.id}`,
      // 🔵 칸이 생기기 전에 등록된 옛 추가 작업은 갈래가 비어 있다. 그림은 갈래가
      //    있어야 모양을 고르므로 작업(TASK)으로 읽는다 — 그 줄들이 실제로 하던
      //    일이 그것이다(단추도 완료 하나뿐이었다).
      nodeType: row.extraTaskNodeType ?? "TASK",
      title: row.extraTaskTitle ?? "-",
      positionX: x,
      positionY: y,
      // 🔴 사용자 배치로도 **같은 값**을 적어 둔다. 그림은 사용자 배치가 있으면
      //    그쪽을 쓰고(resolveEffectiveNodePosition), 없으면 절차 갈래에 따라
      //    자동 배치로 흘러갈 수 있다 — 그러면 방금 센 자리가 버려진다.
      userPositionX: x,
      userPositionY: y,
      sortOrder: anchor ? anchor.procedureSortOrder : maxSortOrder + 1,
      sourceWorksheet: null,
      sourceShapeId: null,
      isAddedInCase: true,
    });
  }
  return made;
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

/**
 * ============================================================================
 * 이 실행 노드([종료])에서 **이어 열 절차**를 서버가 다시 푼다 (2026-11-04, 줄기 B ④ 조각 ④)
 * ============================================================================
 * 🔴 **화면이 보낸 templateId 를 믿지 않는다.** 화면에도 같은 값이 가 있지만
 * (ExecutionNodeDetail.nextProcedure), 그 값은 화면이 그려진 뒤로 낡았을 수
 * 있고 — 그 사이에 새 판이 게시되었거나 가리킨 절차가 지워졌을 수 있다 —
 * 무엇보다 **보내는 쪽이 고칠 수 있는 값**이다. 그래서 시작하기 직전에 서버가
 * 제 눈으로 다시 읽는다.
 *
 * 🔵 「못 연다」를 빈손이 아니라 **까닭으로** 돌려준다. 빈손이면 부르는 쪽이
 * 「원래 안 가리킴」과 구별할 수 없고, 사람에게는 아무 일도 안 일어난 것으로 보인다.
 * ============================================================================
 */
export async function resolveNextProcedureForExecutionNode(
  executionNodeId: string
): Promise<{ ok: true; repairCaseId: string; templateId: string } | { ok: false; reason: string }> {
  const [row] = await db
    .select({
      repairCaseId: procedureCaseExecutions.repairCaseId,
      isExecutionDeleted: procedureCaseExecutions.isDeleted,
      nextProcedureTemplateId: procedureTemplateNodes.nextProcedureTemplateId,
    })
    .from(procedureCaseExecutionNodes)
    .innerJoin(
      procedureCaseExecutions,
      eq(procedureCaseExecutionNodes.executionId, procedureCaseExecutions.id)
    )
    .innerJoin(
      procedureTemplateNodes,
      eq(procedureCaseExecutionNodes.procedureTemplateNodeId, procedureTemplateNodes.id)
    )
    .where(eq(procedureCaseExecutionNodes.id, executionNodeId));

  if (!row || row.isExecutionDeleted) {
    return { ok: false, reason: "해당 단계를 찾을 수 없습니다." };
  }
  // 🔴 접수 건이 지워지면 이 칸이 비워진다(FK 가 ON DELETE SET NULL). 그러면
  //    이어 열 자리 자체가 없다 — 타입을 맞추려고 넘기면 아래가 빈 건에
  //    실행을 만든다.
  if (row.repairCaseId === null) {
    return { ok: false, reason: "이 실행이 속한 접수 건을 찾을 수 없습니다." };
  }
  if (row.nextProcedureTemplateId === null) {
    return { ok: false, reason: "이 단계에는 이어갈 절차가 지정되어 있지 않습니다." };
  }

  const [pointed] = await db
    .select({ code: procedureTemplates.code })
    .from(procedureTemplates)
    .where(eq(procedureTemplates.id, row.nextProcedureTemplateId));
  if (!pointed) {
    return { ok: false, reason: "이어갈 절차를 찾을 수 없습니다 — 가리킨 절차가 삭제되었을 수 있습니다." };
  }

  const seriesRows = await db
    .select({
      id: procedureTemplates.id,
      code: procedureTemplates.code,
      version: procedureTemplates.version,
      status: procedureTemplates.status,
    })
    .from(procedureTemplates)
    .where(and(eq(procedureTemplates.code, pointed.code), eq(procedureTemplates.isDeleted, false)));

  const resolved = resolveNextProcedureTarget({
    pointedTemplate: seriesRows.find((r) => r.id === row.nextProcedureTemplateId) ?? null,
    candidates: seriesRows,
  });
  if (!resolved.ok) return { ok: false, reason: resolved.reason };

  // 🔵 여기까지 왔으면 가리킨 값이 null 이 아님은 위에서 걸렀다 — 그 사실을
  //    타입에도 적어 둔다(아래 find 가 null 을 받을 수 있는 모양이라서).
  return { ok: true, repairCaseId: row.repairCaseId, templateId: resolved.templateId };
}
