"use client";

import { useRef } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type Node,
  type Edge,
  type NodeTypes,
  type EdgeTypes,
  type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

/**
 * Generic graph-editor-core — the reusable React Flow canvas shell.
 * Extracted from the procedure domain's ProcedureFlowGraph.tsx in Phase
 * 5C-4. Knows only React Flow's own generic concepts (nodes/edges,
 * nodeTypes/edgeTypes supplied by the caller, viewport, fitView, selection/
 * drag/pointer callbacks) — it has no knowledge of procedure templates,
 * DRAFT/PUBLISHED status, node/branch business semantics, procedure
 * authorization, validation-issue links, or any persistence/save action. A
 * domain adapter (e.g. ProcedureFlowGraph) owns all of that and supplies
 * this component with already-fully-computed `nodes`/`edges` arrays whose
 * `data` payload stays opaque to this component, plus its own `nodeTypes`/
 * `edgeTypes` maps — React Flow's own extension model, never wrapped or
 * restricted here.
 *
 * A non-selectable node (`node.selectable === false`, e.g. a decorative
 * section header) never triggers `onNodeClick` — that is this component's
 * one piece of interaction policy, expressed purely through React Flow's
 * own generic `selectable` node property, never a domain-chosen node
 * `type` string.
 *
 * This component performs zero persistence and zero authorization — it
 * only ever emits change/interaction callbacks; a caller decides what (if
 * anything) to do with them.
 */
export type GraphCanvasProps = {
  /** Forces a full remount of the underlying React Flow instance when the caller's own view-mode state changes (e.g. a layout-mode or filter switch resets zoom/pan) — an opaque string the caller computes; no meaning is assigned to it here beyond React's own `key`. */
  remountKey: string;
  nodes: Node[];
  edges: Edge[];
  nodeTypes: NodeTypes;
  edgeTypes: EdgeTypes;
  nodesDraggable?: boolean;
  nodesConnectable?: boolean;
  elementsSelectable?: boolean;
  minZoom?: number;
  fitViewPadding?: number;
  height?: number;
  /** Never called for a node with `selectable === false`. */
  onNodeClick?: (nodeId: string) => void;
  onPaneClick?: () => void;
  onEdgeClick?: (edgeId: string) => void;
  /** Fires on any edge double-click, with the click position already converted to flow-space coordinates — the conversion requires the live React Flow instance, which only this component (the direct parent of `<ReactFlow>`) can access without a `<ReactFlowProvider>`. Always fires when provided; a caller that only wants this in certain interaction states gates its own handler body, not this prop. */
  onEdgeDoubleClick?: (edgeId: string, flowPoint: { x: number; y: number }) => void;
  onNodeDragStop?: (nodeId: string, position: { x: number; y: number }) => void;
  /** Fires once, when the underlying React Flow instance becomes ready — lets the caller run its own one-shot logic (e.g. an initial camera fit) without this component needing to know why. */
  onInit?: (instance: ReactFlowInstance) => void;
};

export default function GraphCanvas({
  remountKey,
  nodes,
  edges,
  nodeTypes,
  edgeTypes,
  nodesDraggable = false,
  nodesConnectable = false,
  elementsSelectable = true,
  minZoom = 0.02,
  fitViewPadding = 0.2,
  height = 600,
  onNodeClick,
  onPaneClick,
  onEdgeClick,
  onEdgeDoubleClick,
  onNodeDragStop,
  onInit,
}: GraphCanvasProps) {
  const instanceRef = useRef<ReactFlowInstance | null>(null);

  return (
    <div style={{ height }} className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
      <ReactFlow
        key={remountKey}
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        nodesDraggable={nodesDraggable}
        nodesConnectable={nodesConnectable}
        elementsSelectable={elementsSelectable}
        onlyRenderVisibleElements
        onNodeDragStop={(_, node) => onNodeDragStop?.(node.id, { x: node.position.x, y: node.position.y })}
        onEdgeClick={(_, edge) => onEdgeClick?.(edge.id)}
        onEdgeDoubleClick={(event, edge) => {
          if (!onEdgeDoubleClick || !instanceRef.current) return;
          const point = instanceRef.current.screenToFlowPosition({ x: event.clientX, y: event.clientY });
          onEdgeDoubleClick(edge.id, point);
        }}
        onInit={(instance) => {
          instanceRef.current = instance;
          onInit?.(instance);
        }}
        onNodeClick={(_, node) => {
          if (node.selectable === false) return;
          onNodeClick?.(node.id);
        }}
        onPaneClick={() => onPaneClick?.()}
        fitView
        fitViewOptions={{ padding: fitViewPadding }}
        minZoom={minZoom}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={24} />
        <Controls showInteractive={false} />
        <MiniMap pannable zoomable className="!hidden sm:!block" />
      </ReactFlow>
    </div>
  );
}
