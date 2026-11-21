"use client";

import { useEffect, useRef, useState } from "react";
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
import {
  selectionBoxFromPoints,
  selectionOverlayRect,
  type SelectionBox,
  type SelectionOverlayRect,
} from "@/lib/graph-editor-core/box-selection";

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
/**
 * 한 번의 끌기로 **함께 움직이는** 칸 하나 — id 와 그 순간의 자리.
 *
 * 🔴 React Flow 는 **`selected === true` 인 칸을 전부 함께 끈다** — 우리가
 * 만든 기능이 아니라 엔진이 원래 그렇다(@xyflow/system v0.0.79 의
 * `getDragItems`: `node.selected || node.id === nodeId` 인 칸을 전부 끌 거리에
 * 넣는다). 그리고 `onNodeDragStart`/`onNodeDrag`/`onNodeDragStop` 은 **손짓 한
 * 번에 한 번씩**(드래그만 프레임마다) 불리면서 **세 번째 인자로 움직이는 칸
 * 전부**를 넘긴다(`OnNodeDrag<NodeType> = (event, node, nodes) => void`).
 *
 * 🔴 **전에는 이 컴포넌트가 그 세 번째 인자를 버렸다.** 그래서 여러 칸을
 * 골라 끌면 **화면은 전부 움직이는데 위로 올라가는 것은 하나뿐**이었다 —
 * 오류가 안 나고 끌리는 모습도 멀쩡해서 아무도 못 알아챈다. 2026-11-21 에
 * 그 인자를 그대로 흘려보내도록 고쳤다.
 *
 * 🔵 이 배열에는 **끄는 칸 자신도 들어 있다**(`getDragItems` 가 `node.id ===
 * nodeId` 를 함께 넣는다). 아무것도 안 골라 둔 평소에는 **길이가 1** 이고,
 * 그래서 이 인자를 안 쓰는 쪽은 전과 동작이 한 치도 다르지 않다.
 */
export type GraphCanvasDragMove = { nodeId: string; position: { x: number; y: number } };

/**
 * 빈 바탕을 끌어 **점선 네모로 여럿 고르는** 손짓(2026-11-21, 조각 B2).
 * 안 넘기면(기본) 이 컴포넌트는 전과 한 치도 다르지 않다 — [진단 Flowchart] 가
 * 그쪽이다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 🔴 **React Flow 제 선택 상자를 못 쓴다**(`selectionOnDrag`·`selectionKeyCode`).
 * 이 저장소의 두 그림은 칸 목록을 통째로 제가 만들어 넘기고(controlled)
 * `onNodesChange` 를 안 붙였다. 그래서 바탕 안에서 일어난 선택 변화는
 * `triggerNodeChanges` 에서 **갈 곳이 없어 조용히 버려지고**, `onSelectionChange`
 * 통지도 안 온다(v12.11.2 의 store 에서 값으로 확인: `hasDefaultNodes` 가 거짓이고
 * `onNodesChange` 가 없으면 아무 일도 안 한다). 즉 바탕의 선택 상자를 켜 봐야
 * 네모만 그려지고 **아무것도 안 골라진다.** 그래서 네모를 직접 그린다.
 *
 * 🔴 `active` 인 동안 **빈 바탕 끌기가 「화면 옮기기」를 대신한다**(아래에서
 * `panOnDrag` 를 끈다). 둘을 한 손짓에 겹칠 수는 없다 — 바탕이 따라 움직이면
 * 네모를 그리는 자리와 칸이 서 있는 자리가 함께 흘러간다.
 * 🔵 **칸 위에서 시작한 끌기는 그대로 칸 끌기**다. 여기서는 손대지 않는다.
 * ──────────────────────────────────────────────────────────────────────
 */
export type GraphCanvasBoxSelection = {
  /** true 인 동안만 빈 바탕 끌기가 선택 상자가 된다. */
  active: boolean;
  /**
   * 손을 떼는 순간 **한 번**. 네모는 **그림 좌표계**다(`screenToFlowPosition` 으로
   * 옮긴 뒤 정규화) — 받는 쪽이 칸 자리를 재는 그 좌표계와 같다.
   * 🔵 끌지 않고 누르기만 한 것(넓이 0)은 **아예 안 부른다.** 그 자리는
   *    `onPaneClick` 이 맡는다(빈 바탕 누르기 = 선택 비우기).
   */
  onSelect: (box: SelectionBox) => void;
};

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
  /** Fires once at the start of a node drag gesture, before any movement — a caller wanting to capture a drag anchor (e.g. for an axis-constrained drag) reads shiftKey here, once, rather than re-deriving "was Shift held" from later frames. `movingNodes` carries EVERY node this gesture moves (see GraphCanvasDragMove). */
  onNodeDragStart?: (nodeId: string, position: { x: number; y: number }, shiftKey: boolean, movingNodes: readonly GraphCanvasDragMove[]) => void;
  /** Fires on every pointer-move frame during an active node drag, with React Flow's own live (possibly since-corrected) position — a caller wanting to visually constrain the drag path (not just correct it after drop) uses this together with the underlying React Flow instance's own imperative update API, never anything this component wraps or restricts. `movingNodes` carries EVERY node this gesture moves (see GraphCanvasDragMove). */
  onNodeDrag?: (nodeId: string, position: { x: number; y: number }, shiftKey: boolean, movingNodes: readonly GraphCanvasDragMove[]) => void;
  /** `movingNodes` carries EVERY node this gesture moved (see GraphCanvasDragMove) — a caller that persists drag results reads THAT, not just the single `nodeId`/`position` pair. */
  onNodeDragStop?: (nodeId: string, position: { x: number; y: number }, movingNodes: readonly GraphCanvasDragMove[]) => void;
  /** Fires once, when the underlying React Flow instance becomes ready — lets the caller run its own one-shot logic (e.g. an initial camera fit) without this component needing to know why. */
  onInit?: (instance: ReactFlowInstance) => void;
  /** React Flow's own `selectionKeyCode` — the key that must be held during a pane-background drag to start a rectangle/box selection instead of panning. Omit to keep React Flow's own default ("Shift"); pass `null` to disable box-selection outright. A domain that reserves Shift for its own node-drag modifier (e.g. axis-locked dragging) needs this — by default, React Flow treats a Shift-held drag as a selection gesture even when it starts on a node, which pre-empts that node's own drag entirely. */
  selectionKeyCode?: string | string[] | null;
  /** React Flow's own `multiSelectionKeyCode` — the key that toggles a node into/out of the current selection on click. Omit to keep React Flow's own default. */
  multiSelectionKeyCode?: string | string[] | null;
  /** 점선 네모(박스) 선택 상자 — 안 넘기면 이 컴포넌트는 전과 똑같이 돈다. 까닭과 한계는 GraphCanvasBoxSelection 의 머리말에. */
  boxSelection?: GraphCanvasBoxSelection;
};

/**
 * React Flow 의 `Node[]` 를 이 컴포넌트의 최소 모양으로 줄인다 — 위로는
 * React Flow 타입을 안 내보낸다는 이 파일의 기존 규약 그대로다(편집기 화면은
 * React Flow 를 몰라야 한다).
 *
 * 🔴 **끄는 칸이 반드시 들어 있게 한다.** 평소에는 React Flow 가 이미 넣어
 * 주지만(`getDragItems` 가 `node.id === nodeId` 를 함께 담는다), 만에 하나
 * 빠지면 **끌어 놓은 자리가 통째로 안 저장된다** — 오류 없이 「저장을 눌렀는데
 * 안 움직여 있다」가 된다. 한 줄로 막아 둔다.
 */
function toDragMoves(draggedNode: Node, nodes: readonly Node[]): GraphCanvasDragMove[] {
  const moves = nodes.map((n) => ({ nodeId: n.id, position: { x: n.position.x, y: n.position.y } }));
  if (!moves.some((m) => m.nodeId === draggedNode.id)) {
    moves.push({ nodeId: draggedNode.id, position: { x: draggedNode.position.x, y: draggedNode.position.y } });
  }
  return moves;
}

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
  boxSelection,
}: GraphCanvasProps) {
  const instanceRef = useRef<ReactFlowInstance | null>(null);

  // ──────────────────────────────────────────────────────────────────────
  // 점선 네모 선택 상자 (2026-11-21, 조각 B2) — 켜는 쪽은 boxSelection 프롭 하나다.
  //
  // 🔵 손짓이 도는 동안의 값은 **ref** 에, 프레임마다 다시 그려야 하는 네모
  //    하나만 state 에 둔다.
  // 🔴 **포인터를 붙잡는다**(setPointerCapture). 끌다가 그림 밖으로 나가도
  //    끝까지 따라오고, window 에 듣는 사람을 새로 세우지 않아도 된다 — 이
  //    컴포넌트는 [진단 Flowchart] 도 함께 쓰므로 그쪽에 쓰지도 않을 전역
  //    listener 가 붙는 일이 없어야 한다.
  // ──────────────────────────────────────────────────────────────────────
  const boxGestureRef = useRef<{ startClient: { x: number; y: number }; startFlow: { x: number; y: number }; paneOrigin: { x: number; y: number } } | null>(null);
  const [boxOverlay, setBoxOverlay] = useState<SelectionOverlayRect | null>(null);
  // 🔴 네모를 다 그리고 손을 떼면 브라우저가 **click 도 함께** 쏜다(누른 곳과 뗀
  //    곳이 같은 요소면 그렇다 — 빈 바탕 안에서 끝낸 네모가 늘 그렇다). 그대로
  //    두면 `onPaneClick` 이 **방금 고른 것을 즉시 비운다**: 「네모로 골랐는데
  //    아무것도 안 골라져 있다」가 되고, 오류는 안 난다.
  const suppressPaneClickRef = useRef(false);
  const boxSelectActive = boxSelection?.active === true;

  function handleBoxPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    // 손짓이 새로 시작하면 깃발부터 내린다 — 앞선 네모의 click 이 끝내 안 왔을
    // 수 있고(손을 뗀 자리가 칸 위였다면 그렇다), 남아 있으면 **다음번** 빈 바탕
    // 누르기가 조용히 먹힌다.
    suppressPaneClickRef.current = false;
    if (!boxSelectActive || event.button !== 0) return;
    const target = event.target as HTMLElement;
    // 🔴 **빈 바탕에서 시작한 것만** 네모가 된다. 칸·연결선·조작 단추 위에서
    //    시작한 끌기는 전과 똑같이 그쪽 것이다. 바탕 요소는 제 클래스 이름으로
    //    가린다 — 칸은 이 요소의 자식이 아니라 형제라, 칸을 눌렀을 때 이 이름이
    //    달린 요소가 target 이 되는 일은 없다.
    if (!target.classList.contains("react-flow__pane")) return;
    const instance = instanceRef.current;
    if (!instance) return;
    const paneRect = target.getBoundingClientRect();
    const startClient = { x: event.clientX, y: event.clientY };
    const paneOrigin = { x: paneRect.left, y: paneRect.top };
    boxGestureRef.current = { startClient, startFlow: instance.screenToFlowPosition(startClient), paneOrigin };
    setBoxOverlay(selectionOverlayRect(startClient, startClient, paneOrigin));
    target.setPointerCapture?.(event.pointerId);
  }

  function handleBoxPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const gesture = boxGestureRef.current;
    if (!gesture) return;
    setBoxOverlay(selectionOverlayRect(gesture.startClient, { x: event.clientX, y: event.clientY }, gesture.paneOrigin));
  }

  function handleBoxPointerUp(event: React.PointerEvent<HTMLDivElement>) {
    const gesture = boxGestureRef.current;
    if (!gesture) return;
    boxGestureRef.current = null;
    setBoxOverlay(null);
    const instance = instanceRef.current;
    if (!instance) return;
    // 🔴 **고르는 네모는 그림 좌표로 잰다.** 그리는 네모(위)는 화면 px 이고,
    //    둘은 끈 **같은 두 점**에서 나온다 — 같은 정규화를 쓰는 까닭은
    //    box-selection.ts 의 selectionOverlayRect 머리말에.
    const box = selectionBoxFromPoints(gesture.startFlow, instance.screenToFlowPosition({ x: event.clientX, y: event.clientY }));
    // 🔵 넓이 0 — 끌지 않고 누르기만 했다. 고르지도 않고 click 을 막지도 않는다:
    //    빈 바탕 누르기는 `onPaneClick` 이 맡는다(선택 비우기).
    if (box.width === 0 || box.height === 0) return;
    suppressPaneClickRef.current = true;
    boxSelection?.onSelect(box);
  }

  /** 끌던 중에 창이 포커스를 잃거나 포인터를 뺏기면 그리던 네모만 조용히 거둔다. 평소에는 위 pointerup 이 먼저 치워서 아무 일도 안 한다. */
  function handleBoxLostPointerCapture() {
    if (!boxGestureRef.current) return;
    boxGestureRef.current = null;
    setBoxOverlay(null);
  }

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
    // 🔵 커서: 점선 네모 모드에서는 십자로 바뀐다. React Flow 의 바탕은
    //    `cursor: grab` 을 **panOnDrag 가 켜져 있을 때만** 입는다
    //    (`.react-flow__pane.draggable`), 그래서 아래에서 panOnDrag 를 끄는 동안은
    //    바탕에 제 커서 규칙이 없고 여기 적은 것이 그대로 내려간다. 칸은 제
    //    규칙(`.react-flow__node.draggable { cursor: grab }`)을 그대로 쓴다.
    <div
      style={{ height, cursor: boxSelectActive ? "crosshair" : undefined }}
      className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800"
      // 🔵 끄는 셋은 **켜져 있을 때만** 달린다 — 안 넘기는 호출부([진단
      //    Flowchart])에는 아무 손잡이도 안 붙는다.
      // 🔴 누르기 하나는 **늘** 달려 있어야 한다: 그 첫 줄이 위 깃발을 내리는
      //    자리라, 네모를 그린 뒤 도구를 마우스로 바꾸면 깃발이 선 채로 남아
      //    **그 다음 빈 바탕 누르기 한 번이 조용히 먹힌다.**
      onPointerDown={handleBoxPointerDown}
      onPointerMove={boxSelectActive ? handleBoxPointerMove : undefined}
      onPointerUp={boxSelectActive ? handleBoxPointerUp : undefined}
      onLostPointerCapture={boxSelectActive ? handleBoxLostPointerCapture : undefined}
    >
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
        onNodeDragStart={(event, node, nodes) => onNodeDragStart?.(node.id, { x: node.position.x, y: node.position.y }, event.shiftKey, toDragMoves(node, nodes))}
        onNodeDrag={(event, node, nodes) => onNodeDrag?.(node.id, { x: node.position.x, y: node.position.y }, event.shiftKey, toDragMoves(node, nodes))}
        onNodeDragStop={(_, node, nodes) => onNodeDragStop?.(node.id, { x: node.position.x, y: node.position.y }, toDragMoves(node, nodes))}
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
        onPaneClick={() => {
          // 방금 네모를 그리고 끝낸 손짓이면 그 뒤에 딸려 오는 click 은 버린다
          // (위 suppressPaneClickRef 의 까닭). 그 한 번만 먹고 바로 내린다.
          if (suppressPaneClickRef.current) {
            suppressPaneClickRef.current = false;
            return;
          }
          onPaneClick?.();
        }}
        // 🔴 점선 네모 모드에서는 **빈 바탕 끌기를 바탕에서 뺏어 온다** — 그
        //    손짓이 선택 상자가 돼야 하기 때문이다. 안 넘기는 쪽(=
        //    boxSelection 이 없는 호출부)은 true 이고, 그것이 React Flow 의 제
        //    기본값이라 전과 한 치도 다르지 않다.
        panOnDrag={!boxSelectActive}
        fitView
        fitViewOptions={{ padding: fitViewPadding }}
        minZoom={minZoom}
        proOptions={{ hideAttribution: true }}
        selectionKeyCode={selectionKeyCode}
        multiSelectionKeyCode={multiSelectionKeyCode}
      >
        {boxOverlay && (
          /*
            🔵 **그림 바탕과 같은 상자 안에** 얹는다. React Flow 의 children 은
            `.react-flow`(inline style 로 position: relative) 바로 아래로 들어가고,
            바탕(pane)은 그 안에 inset 0 으로 깔려 있어 두 상자가 완전히 같다 —
            그래서 위에서 잰 바탕의 왼쪽 위를 빼기만 하면 자리가 정확히 맞는다.
            React Flow 제 선택 상자(`.react-flow__selection`)도 같은 자리에 같은
            방식으로 그린다.
            🔵 z-index 5 — 칸·선을 그리는 층(`.react-flow__renderer`, 4)보다 위이고,
            뒤에 오는 조작 단추·미니맵(`.react-flow__panel`, 5)보다는 아래다
            (같은 값이면 뒤에 선 것이 위로 온다).
            🔴 `pointer-events-none` — 네모가 손짓을 가로채면 끌던 도중에 포인터
            아래의 요소가 바뀌어 붙잡기가 풀린다.
          */
          <div
            className="pointer-events-none absolute rounded-[2px] border border-dashed border-blue-500 bg-blue-500/10 dark:border-blue-400 dark:bg-blue-400/10"
            style={{ left: boxOverlay.left, top: boxOverlay.top, width: boxOverlay.width, height: boxOverlay.height, zIndex: 5 }}
          />
        )}
        <Background gap={24} />
        <Controls showInteractive={false} />
        <MiniMap pannable zoomable className="!hidden sm:!block" />
      </ReactFlow>
    </div>
  );
}
