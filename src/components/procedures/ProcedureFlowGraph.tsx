"use client";

import { useMemo, useState } from "react";
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
const ALL_WORKSHEETS = "ALL";

export default function ProcedureFlowGraph({
  nodes: nodeRows,
  edges: edgeRows,
}: {
  nodes: ProcedureTemplateNodeRow[];
  edges: ProcedureTemplateEdgeRow[];
}) {
  // Worksheet filter (Phase 2.5 read-only perf work) — a combined
  // multi-sheet template (e.g. rfg-full-lifecycle, ~10 source sheets) can
  // have hundreds of nodes; letting a reviewer isolate one source sheet at
  // a time is a pure client-side view filter, no editing capability.
  const worksheets = useMemo(() => {
    const seen = new Set<string>();
    const ordered: string[] = [];
    for (const n of nodeRows) {
      if (n.sourceWorksheet && !seen.has(n.sourceWorksheet)) {
        seen.add(n.sourceWorksheet);
        ordered.push(n.sourceWorksheet);
      }
    }
    return ordered;
  }, [nodeRows]);

  const [worksheetFilter, setWorksheetFilter] = useState<string>(ALL_WORKSHEETS);

  const filteredNodeRows = useMemo(
    () => (worksheetFilter === ALL_WORKSHEETS ? nodeRows : nodeRows.filter((n) => n.sourceWorksheet === worksheetFilter)),
    [nodeRows, worksheetFilter]
  );

  // Grouping by worksheet (Phase 2.5 read-only perf work) — a combined
  // multi-sheet template's node positions each come from that node's own
  // sheet-local shape coordinates (extract-shape-graph.ts), with no offset
  // applied between sheets, so different sheets' node clusters land on top
  // of each other once combined into one template. Stacking each
  // worksheet into its own vertical band here is purely a view-layer
  // translation — it never touches the stored position_x/position_y
  // (still the source-traceable original coordinates), it only changes
  // where this read-only viewer draws them.
  const worksheetYOffset = useMemo(() => {
    const offsets = new Map<string, number>();
    const margin = 150;
    let cursorY = 0;
    for (const ws of worksheets) {
      const wsNodes = nodeRows.filter((n) => n.sourceWorksheet === ws);
      if (wsNodes.length === 0) continue;
      const minY = Math.min(...wsNodes.map((n) => n.positionY));
      const maxY = Math.max(...wsNodes.map((n) => n.positionY));
      offsets.set(ws, cursorY - minY);
      cursorY += maxY - minY + margin;
    }
    return offsets;
  }, [nodeRows, worksheets]);

  const flowNodes = useMemo<Node[]>(
    () =>
      filteredNodeRows.map((n) => ({
        id: n.id,
        type: "procedureNode",
        position: { x: n.positionX, y: n.positionY + (n.sourceWorksheet ? worksheetYOffset.get(n.sourceWorksheet) ?? 0 : 0) },
        data: {
          title: n.title,
          nodeType: n.nodeType,
          sourceWorksheet: n.sourceWorksheet,
          sourceShapeId: n.sourceShapeId,
        } satisfies ProcedureNodeData,
      })),
    [filteredNodeRows, worksheetYOffset]
  );

  const flowEdges = useMemo<Edge[]>(() => {
    const visibleNodeIds = new Set(filteredNodeRows.map((n) => n.id));
    return edgeRows
      .filter((e) => visibleNodeIds.has(e.fromNodeId) && visibleNodeIds.has(e.toNodeId))
      .map((e) => {
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
      });
  }, [edgeRows, filteredNodeRows]);

  if (nodeRows.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      {worksheets.length > 1 && (
        <div className="flex items-center gap-2 text-xs">
          <label htmlFor="procedure-flow-worksheet-filter" className="text-zinc-500 dark:text-zinc-400">
            원본 시트로 보기 필터:
          </label>
          <select
            id="procedure-flow-worksheet-filter"
            value={worksheetFilter}
            onChange={(e) => setWorksheetFilter(e.target.value)}
            className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
          >
            <option value={ALL_WORKSHEETS}>전체 ({nodeRows.length}개 노드)</option>
            {worksheets.map((ws) => (
              <option key={ws} value={ws}>
                {ws} ({nodeRows.filter((n) => n.sourceWorksheet === ws).length}개 노드)
              </option>
            ))}
          </select>
          {worksheetFilter !== ALL_WORKSHEETS && (
            <span className="text-zinc-400 dark:text-zinc-600">
              — 다른 시트로 이어지는 재진행(LOOP_BACK) 분기는 이 필터에서 숨겨질 수 있습니다.
            </span>
          )}
        </div>
      )}
      <div style={{ height: 600 }} className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
        <ReactFlow
          key={worksheetFilter}
          nodes={flowNodes}
          edges={flowEdges}
          nodeTypes={nodeTypes}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={true}
          onlyRenderVisibleElements
          fitView
          fitViewOptions={{ padding: 0.2 }}
          minZoom={0.02}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={24} />
          <Controls showInteractive={false} />
          <MiniMap pannable zoomable className="!hidden sm:!block" />
        </ReactFlow>
      </div>
    </div>
  );
}
