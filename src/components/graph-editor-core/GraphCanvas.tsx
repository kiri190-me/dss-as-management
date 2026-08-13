"use client";

import { useEffect, useRef } from "react";
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
  /** Fires once at the start of a node drag gesture, before any movement — a caller wanting to capture a drag anchor (e.g. for an axis-constrained drag) reads shiftKey here, once, rather than re-deriving "was Shift held" from later frames. */
  onNodeDragStart?: (nodeId: string, position: { x: number; y: number }, shiftKey: boolean) => void;
  /** Fires on every pointer-move frame during an active node drag, with React Flow's own live (possibly since-corrected) position — a caller wanting to visually constrain the drag path (not just correct it after drop) uses this together with the underlying React Flow instance's own imperative update API, never anything this component wraps or restricts. */
  onNodeDrag?: (nodeId: string, position: { x: number; y: number }, shiftKey: boolean) => void;
  onNodeDragStop?: (nodeId: string, position: { x: number; y: number }) => void;
  /** Fires once, when the underlying React Flow instance becomes ready — lets the caller run its own one-shot logic (e.g. an initial camera fit) without this component needing to know why. */
  onInit?: (instance: ReactFlowInstance) => void;
  /** React Flow's own `selectionKeyCode` — the key that must be held during a pane-background drag to start a rectangle/box selection instead of panning. Omit to keep React Flow's own default ("Shift"); pass `null` to disable box-selection outright. A domain that reserves Shift for its own node-drag modifier (e.g. axis-locked dragging) needs this — by default, React Flow treats a Shift-held drag as a selection gesture even when it starts on a node, which pre-empts that node's own drag entirely. */
  selectionKeyCode?: string | string[] | null;
  /** React Flow's own `multiSelectionKeyCode` — the key that toggles a node into/out of the current selection on click. Omit to keep React Flow's own default. */
  multiSelectionKeyCode?: string | string[] | null;
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
  onNodeDragStart,
  onNodeDrag,
  onNodeDragStop,
  onInit,
  selectionKeyCode,
  multiSelectionKeyCode,
}: GraphCanvasProps) {
  const instanceRef = useRef<ReactFlowInstance | null>(null);

  // Cursor-disappearing bugfix (round 2) — React Flow's own node-drag/
  // pane-pan/connection-drag tracking (d3-drag, and its own manual
  // connection-line listener) attaches its move/end listeners as native
  // `mousemove`/`mouseup` on `window` at drag-start and only tears them
  // down again on its own `mouseup` handler — it has no blur/
  // visibilitychange handling of its own. If the window loses focus (or
  // the tab is hidden) mid-drag — Alt+Tab, a browser/system dialog, or
  // switching to another application — the real mouseup can be lost
  // entirely, leaving React Flow's internal dragging state (and the
  // `.dragging { cursor: grabbing }` CSS class it applies) stuck until
  // another full drag gesture completes. Dispatching a synthetic mouseup
  // on window lets that already-attached listener run its own normal
  // end-of-drag cleanup, exactly as if the button had been released
  // normally — a no-op whenever nothing is actually being dragged.
  useEffect(() => {
    function releaseStuckDrag() {
      window.dispatchEvent(new MouseEvent("mouseup"));
    }
    function handleVisibilityChange() {
      if (document.visibilityState === "hidden") releaseStuckDrag();
    }
    window.addEventListener("blur", releaseStuckDrag);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("blur", releaseStuckDrag);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

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
        onNodeDragStart={(event, node) => onNodeDragStart?.(node.id, { x: node.position.x, y: node.position.y }, event.shiftKey)}
        onNodeDrag={(event, node) => onNodeDrag?.(node.id, { x: node.position.x, y: node.position.y }, event.shiftKey)}
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
        selectionKeyCode={selectionKeyCode}
        multiSelectionKeyCode={multiSelectionKeyCode}
      >
        <Background gap={24} />
        <Controls showInteractive={false} />
        <MiniMap pannable zoomable className="!hidden sm:!block" />
      </ReactFlow>
    </div>
  );
}
