import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "../client";
import { repairCaseFlowcharts, repairCaseFlowchartNodes, repairCaseFlowchartEdges } from "../schema";
import type { RepairCaseFlowchartNodeType, RepairCaseFlowchartBranchType } from "@/lib/domain/repair-case-flowchart-types";

export type RepairCaseFlowchartGraphNode = {
  id: string;
  nodeType: RepairCaseFlowchartNodeType;
  title: string;
  description: string | null;
  instructions: string | null;
  /**
   * 🔴 이 노드가 가리키는 공유폴더 속 파일 한 자리(2026-11-25) — 「수리 관련」 폴더
   * 루트 기준 **상대 경로**다. 안 가리킨 노드가 보통이라 `null` 이 기본이다.
   * 🔴 **읽어 오지 않으면 저장은 되는데 화면에 안 돌아온다**: 편집기는 서버가 준 이
   * 값을 받침으로 더러움을 재므로(editor-save-state 의 isNodeDraftDirty), 칸이 빠지면
   * 새로 고칠 때마다 「가리킨 적 없음」으로 되돌아간 것처럼 보이고 **지우는 쪽으로**
   * 다시 저장된다. 통로는 **경로 글자만** 나른다 — 루트도 전체 경로도 응답에 없다.
   */
  shareDocRelativePath: string | null;
  positionX: number;
  positionY: number;
};

export type RepairCaseFlowchartGraphEdge = {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  branchType: RepairCaseFlowchartBranchType;
  branchLabel: string | null;
  routePoints: { x: number; y: number }[] | null;
};

export type RepairCaseFlowchartGraph = {
  /** faultTags 는 **늘 배열**이다 — DB 의 NULL(칸이 생기기 전에 만들어진 줄)을 여기서 []로 맞춰 내보낸다. 화면마다 `?? []` 를 적게 두면 한 군데만 빠뜨려도 그 화면에서 터진다. */
  flowchart: { id: string; repairCaseId: string; title: string; description: string | null; faultTags: string[]; updatedAt: string };
  nodes: RepairCaseFlowchartGraphNode[];
  edges: RepairCaseFlowchartGraphEdge[];
};

/**
 * The smallest read model needed for 6D/UI to eventually render a case
 * flowchart — plain domain data only, never a React Flow node/edge object
 * (that adapter belongs to the UI layer, not this query). Scoped by BOTH
 * repairCaseId and flowchartId in the same WHERE clause (same IDOR-defense
 * convention as getRepairCaseFlowchart in repair-case-flowcharts.ts's query
 * module) and excludes a soft-deleted flowchart.
 */
export async function getRepairCaseFlowchartGraph(params: {
  repairCaseId: string;
  flowchartId: string;
}): Promise<RepairCaseFlowchartGraph | null> {
  const [flowchart] = await db
    .select({
      id: repairCaseFlowcharts.id,
      repairCaseId: repairCaseFlowcharts.repairCaseId,
      title: repairCaseFlowcharts.title,
      description: repairCaseFlowcharts.description,
      faultTags: repairCaseFlowcharts.faultTags,
      updatedAt: repairCaseFlowcharts.updatedAt,
    })
    .from(repairCaseFlowcharts)
    .where(
      and(
        eq(repairCaseFlowcharts.id, params.flowchartId),
        eq(repairCaseFlowcharts.repairCaseId, params.repairCaseId),
        eq(repairCaseFlowcharts.isDeleted, false)
      )
    );
  if (!flowchart) return null;

  const [nodes, edges] = await Promise.all([
    db
      .select({
        id: repairCaseFlowchartNodes.id,
        nodeType: repairCaseFlowchartNodes.nodeType,
        title: repairCaseFlowchartNodes.title,
        description: repairCaseFlowchartNodes.description,
        instructions: repairCaseFlowchartNodes.instructions,
        shareDocRelativePath: repairCaseFlowchartNodes.shareDocRelativePath,
        positionX: repairCaseFlowchartNodes.positionX,
        positionY: repairCaseFlowchartNodes.positionY,
      })
      .from(repairCaseFlowchartNodes)
      .where(eq(repairCaseFlowchartNodes.flowchartId, flowchart.id))
      // 추가된 순서(오래된 것 → 최근 것)로 고정한다. 정렬이 없으면 Postgres가
      // 돌려주는 순서는 보장되지 않아 노드 선택 목록의 순서가 새로고침마다
      // 달라질 수 있고, "새 연결 추가"의 대상 노드 기본값(가장 최근에 추가한
      // 노드 = 마지막 원소)도 성립하지 않는다. createdAt이 같은 극단적인
      // 경우를 위해 id를 2차 정렬 키로 둔다.
      .orderBy(repairCaseFlowchartNodes.createdAt, repairCaseFlowchartNodes.id),
    db
      .select({
        id: repairCaseFlowchartEdges.id,
        fromNodeId: repairCaseFlowchartEdges.fromNodeId,
        toNodeId: repairCaseFlowchartEdges.toNodeId,
        branchType: repairCaseFlowchartEdges.branchType,
        branchLabel: repairCaseFlowchartEdges.branchLabel,
        routePoints: repairCaseFlowchartEdges.routePoints,
      })
      .from(repairCaseFlowchartEdges)
      .where(eq(repairCaseFlowchartEdges.flowchartId, flowchart.id)),
  ]);

  return {
    flowchart: {
      id: flowchart.id,
      repairCaseId: flowchart.repairCaseId,
      title: flowchart.title,
      description: flowchart.description,
      faultTags: flowchart.faultTags ?? [],
      updatedAt: flowchart.updatedAt.toISOString(),
    },
    nodes,
    edges: edges.map((e) => ({ ...e, routePoints: e.routePoints ?? null })),
  };
}
