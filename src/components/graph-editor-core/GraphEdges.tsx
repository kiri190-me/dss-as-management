"use client";

import { useEffect, useRef } from "react";
import { BaseEdge, EdgeLabelRenderer, useReactFlow, getStraightPath, getSmoothStepPath, type EdgeProps, type Position } from "@xyflow/react";
import { releasePointerCaptureSafely, createCaptureBlurGuard } from "@/lib/graph-editor-core/pointer";
import { isAlignedHorizontalConnection, isAlignedVerticalConnection } from "@/lib/graph-editor-core/layout";
import type { RoutePoint } from "@/lib/graph-editor-core/routing";

/**
 * Generic graph-editor-core — the two domain-agnostic custom edge renderers
 * every graph adapter in this codebase needs (deterministic straight/
 * smoothstep, and explicit-waypoint manual routing). Extracted unchanged
 * from ProcedureFlowGraph.tsx in Phase 5C-6D, where it was the only caller
 * — CaseFlowchartGraph.tsx is the second. Neither component here knows
 * anything about procedure templates, repair cases, node types, or branch
 * types; both operate purely on RoutePoint arrays and the generic EdgeProps
 * geometry React Flow itself passes to a custom edge renderer.
 *
 * Deliberately does NOT include ProcedureOuterLaneEdge (the STAGE_SORTED
 * lane-routing edge) — that one is genuinely procedure/worksheet-specific
 * (Problem 1/D's outer-lane routing for cross-worksheet and LOOP_BACK
 * edges) and has no case-flowchart analog, so it stays in
 * ProcedureFlowGraph.tsx.
 */

/**
 * Given the exact EdgeProps geometry React Flow passes to a custom edge
 * renderer, decides straight-vs-smoothstep from `sourceX`/`targetX`
 * DIRECTLY — React Flow's own authoritative, live handle coordinates —
 * never from a caller's own node-position/width estimate, which can drift
 * from what's actually rendered.
 */
export function computeDefaultEdgePath(params: {
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
  sourcePosition: Position;
  targetPosition: Position;
}): [string, number, number] {
  const isStraight =
    isAlignedVerticalConnection(params.sourceX, params.targetX) ||
    // 가로로 나란히 놓인 노드끼리 옆면 핸들로 붙은 경우 — 세로와 같은 자격으로
    // 직선을 그린다(예전에는 세로 정렬만 직선이라, 가로 관계는 항상 계단이었다).
    isAlignedHorizontalConnection(params.sourceY, params.targetY);
  const [path, labelX, labelY] = isStraight
    ? getStraightPath({ sourceX: params.sourceX, sourceY: params.sourceY, targetX: params.targetX, targetY: params.targetY })
    : getSmoothStepPath(params);
  return [path, labelX, labelY];
}

/** The ordinary (no manual route, no lane-routed) edge type — straight when its endpoints are vertically aligned, smoothstep otherwise, decided fresh on every render from React Flow's own live coordinates. */
export function DefaultStraightOrStepEdge({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, style, markerEnd, label, labelStyle, labelBgStyle, labelBgPadding }: EdgeProps) {
  const [path, labelX, labelY] = computeDefaultEdgePath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  return (
    <BaseEdge path={path} labelX={labelX} labelY={labelY} style={style} markerEnd={markerEnd} label={label} labelStyle={labelStyle} labelBgStyle={labelBgStyle} labelBgPadding={labelBgPadding} />
  );
}

export type ManualRouteEdgeData = {
  points: RoutePoint[];
  /** Only the currently-selected edge, in an editable/interactive state, renders draggable handles — every other edge with a manual route still renders the correct polyline shape, just without the interactive overlay. */
  isInteractive: boolean;
  selectedWaypointIndex: number | null;
  onWaypointSelect?: (index: number | null) => void;
  onWaypointMove?: (index: number, point: RoutePoint) => void;
};

/**
 * Renders an edge as an explicit polyline through its manual waypoints
 * (source -> points... -> target). sourceX/Y and targetX/Y come from React
 * Flow itself (computed from the node's actual rendered position + this
 * edge's handles), already sharing one coordinate space with the waypoints
 * — no conversion needed to build the path.
 *
 * Dragging a handle uses setPointerCapture so pointermove/pointerup keep
 * firing on the same element regardless of where the cursor physically ends
 * up. Pointer-capture release is wired to onPointerUp, onPointerCancel,
 * onLostPointerCapture, AND a window-blur/tab-hidden guard
 * (createCaptureBlurGuard) — this combination is the hard-won fix for the
 * cursor-disappearing bug investigated against the procedure-template
 * editor; do not simplify it back down to onPointerUp alone.
 */
export function ManualRouteEdge({ id, sourceX, sourceY, targetX, targetY, style, markerEnd, label, labelStyle, labelBgStyle, labelBgPadding, data }: EdgeProps & { data?: ManualRouteEdgeData }) {
  const { screenToFlowPosition } = useReactFlow();
  const captureGuardRef = useRef<ReturnType<typeof createCaptureBlurGuard> | null>(null);
  useEffect(() => {
    const guard = createCaptureBlurGuard(window, document);
    captureGuardRef.current = guard;
    return () => {
      guard.dispose();
      captureGuardRef.current = null;
    };
  }, []);
  if (!data) return null;

  const chain = [{ x: sourceX, y: sourceY }, ...data.points, { x: targetX, y: targetY }];
  const path = chain.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
  const labelX = chain.reduce((sum, p) => sum + p.x, 0) / chain.length;
  const labelY = chain.reduce((sum, p) => sum + p.y, 0) / chain.length;

  return (
    <>
      <BaseEdge id={id} path={path} style={style} markerEnd={markerEnd} label={label} labelX={labelX} labelY={labelY} labelStyle={labelStyle} labelBgStyle={labelBgStyle} labelBgPadding={labelBgPadding} />
      {data.isInteractive && (
        <EdgeLabelRenderer>
          {data.points.map((p, index) => (
            <div
              key={index}
              className="nodrag nopan"
              onPointerDown={(e) => {
                e.stopPropagation();
                data.onWaypointSelect?.(index);
                const el = e.currentTarget as HTMLElement;
                el.setPointerCapture(e.pointerId);
                captureGuardRef.current?.track(el, e.pointerId);
              }}
              onPointerMove={(e) => {
                if (e.buttons !== 1) return;
                data.onWaypointMove?.(index, screenToFlowPosition({ x: e.clientX, y: e.clientY }));
              }}
              onPointerUp={(e) => {
                releasePointerCaptureSafely(e.currentTarget as HTMLElement, e.pointerId);
                captureGuardRef.current?.untrack();
              }}
              onPointerCancel={(e) => {
                releasePointerCaptureSafely(e.currentTarget as HTMLElement, e.pointerId);
                captureGuardRef.current?.untrack();
              }}
              onLostPointerCapture={() => captureGuardRef.current?.untrack()}
              style={{
                position: "absolute",
                transform: `translate(-50%, -50%) translate(${p.x}px, ${p.y}px)`,
                width: 10,
                height: 10,
                borderRadius: "9999px",
                background: index === data.selectedWaypointIndex ? "#2563eb" : "#ffffff",
                border: "2px solid #2563eb",
                cursor: "grab",
                pointerEvents: "all",
                zIndex: 20,
              }}
            />
          ))}
        </EdgeLabelRenderer>
      )}
    </>
  );
}
