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
  flowchart: { id: string; repairCaseId: string; title: string; description: string | null; updatedAt: string };
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
        positionX: repairCaseFlowchartNodes.positionX,
        positionY: repairCaseFlowchartNodes.positionY,
      })
      .from(repairCaseFlowchartNodes)
      .where(eq(repairCaseFlowchartNodes.flowchartId, flowchart.id)),
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
      updatedAt: flowchart.updatedAt.toISOString(),
    },
    nodes,
    edges: edges.map((e) => ({ ...e, routePoints: e.routePoints ?? null })),
  };
}
