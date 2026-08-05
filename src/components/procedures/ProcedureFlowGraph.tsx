"use client";

import { useMemo } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  MarkerType,
  Handle,
  Position,
  type Node,
  type Edge,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  procedureNodeTypeLabels,
  procedureBranchTypeLabels,
  type ProcedureNodeType,
  type ProcedureBranchType,
} from "@/lib/domain/procedure-template-types";
import type { ProcedureTemplateEdgeRow, ProcedureTemplateNodeRow } from "@/lib/db/queries/procedure-templates";

const NODE_TYPE_COLORS: Record<ProcedureNodeType, { bg: string; border: string; text: string }> = {
  START: { bg: "#ECFDF5", border: "#10B981", text: "#065F46" },
  END: { bg: "#F4F4F5", border: "#71717A", text: "#3F3F46" },
  DECISION: { bg: "#FFFBEB", border: "#D97706", text: "#92400E" },
  CORRECTIVE_ACTION: { bg: "#FEF2F2", border: "#DC2626", text: "#991B1B" },
  INSPECTION: { bg: "#EFF6FF", border: "#2563EB", text: "#1E40AF" },
  TASK: { bg: "#FAFAFA", border: "#A1A1AA", text: "#27272A" },
  CHECKLIST: { bg: "#F5F3FF", border: "#7C3AED", text: "#5B21B6" },
  TROUBLESHOOTING: { bg: "#EEF2FF", border: "#4F46E5", text: "#3730A3" },
  DOCUMENT_REFERENCE: { bg: "#F8FAFC", border: "#64748B", text: "#334155" },
};

const BRANCH_TYPE_COLORS: Record<ProcedureBranchType, string> = {
  DEFAULT: "#A1A1AA",
  NORMAL: "#10B981",
  NG: "#DC2626",
  YES: "#2563EB",
  NO: "#71717A",
  RETRY: "#EA580C",
  LOOP_BACK: "#7C3AED",
  CUSTOM: "#0EA5E9",
};

type ProcedureNodeData = {
  title: string;
  nodeType: ProcedureNodeType;
  sourceWorksheet: string | null;
  sourceShapeId: string | null;
};

function ProcedureNode({ data }: NodeProps & { data: ProcedureNodeData }) {
  const colors = NODE_TYPE_COLORS[data.nodeType];
  return (
    <div
      style={{
        background: colors.bg,
        border: `1.5px solid ${colors.border}`,
        borderRadius: 8,
        padding: "6px 10px",
        minWidth: 160,
        maxWidth: 240,
        fontSize: 12,
        color: colors.text,
      }}
    >
      <Handle type="target" position={Position.Top} style={{ background: colors.border }} />
      <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: 0.4, opacity: 0.75, marginBottom: 2 }}>
        {procedureNodeTypeLabels[data.nodeType]}
      </div>
      <div style={{ fontWeight: 600, lineHeight: 1.3 }}>{data.title}</div>
      {data.sourceShapeId && (
        <div style={{ fontSize: 9, opacity: 0.55, marginTop: 3 }}>
          {data.sourceWorksheet} · shape#{data.sourceShapeId}
        </div>
      )}
      <Handle type="source" position={Position.Bottom} style={{ background: colors.border }} />
    </div>
  );
}

const nodeTypes = { procedureNode: ProcedureNode };

/**
 * Read-only flowchart viewer — no editing in Phase 2 (no onNodesChange/
 * onEdgesChange wired up, nodes/edges are not draggable-and-persisted).
 * Node fill/border color encodes node_type; edge color + label encodes
 * branch_type, matching the same red=NG/blue=YES convention the source
 * workbook itself uses (Phase 1 report §5) so the rendering reads
 * naturally to QC staff already used to the paper diagrams.
 */
export default function ProcedureFlowGraph({
  nodes: nodeRows,
  edges: edgeRows,
}: {
  nodes: ProcedureTemplateNodeRow[];
  edges: ProcedureTemplateEdgeRow[];
}) {
  const flowNodes = useMemo<Node[]>(
    () =>
      nodeRows.map((n) => ({
        id: n.id,
        type: "procedureNode",
        position: { x: n.positionX, y: n.positionY },
        data: {
          title: n.title,
          nodeType: n.nodeType,
          sourceWorksheet: n.sourceWorksheet,
          sourceShapeId: n.sourceShapeId,
        } satisfies ProcedureNodeData,
      })),
    [nodeRows]
  );

  const flowEdges = useMemo<Edge[]>(
    () =>
      edgeRows.map((e) => {
        const color = BRANCH_TYPE_COLORS[e.branchType];
        const isLoopBack = e.branchType === "LOOP_BACK";
        return {
          id: e.id,
          source: e.fromNodeId,
          target: e.toNodeId,
          label: e.branchLabel ?? (e.branchType === "DEFAULT" ? undefined : procedureBranchTypeLabels[e.branchType]),
          labelStyle: { fill: color, fontWeight: 700, fontSize: 10 },
          labelBgStyle: { fill: "#ffffff", fillOpacity: 0.85 },
          style: { stroke: color, strokeWidth: e.branchType === "DEFAULT" ? 1.25 : 1.75, strokeDasharray: isLoopBack || e.branchType === "RETRY" ? "6 4" : undefined },
          markerEnd: { type: MarkerType.ArrowClosed, color },
          animated: isLoopBack,
        } satisfies Edge;
      }),
    [edgeRows]
  );

  if (nodeRows.length === 0) return null;

  return (
    <div style={{ height: 600 }} className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        nodeTypes={nodeTypes}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={true}
        fitView
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={24} />
        <Controls showInteractive={false} />
        <MiniMap pannable zoomable className="!hidden sm:!block" />
      </ReactFlow>
    </div>
  );
}
