"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  addExecutionEdgeAction,
  addExecutionExtraTaskAction,
  moveExecutionExtraTaskAction,
  removeExecutionEdgeAction,
  removeExecutionExtraTaskAction,
} from "@/lib/server/actions/procedure-case-execution";
import {
  buildCaseEditEdgeRows,
  findCaseEditNodeByGraphNodeId,
  type CaseEditEdge,
  type CaseEditNode,
} from "@/lib/domain/procedure-execution-case-edit";
import {
  placeExtraTaskByDirection,
  type ExtraTaskDirection,
  type GraphPoint,
} from "@/lib/domain/procedure-execution-layout";
import { buildJumpStatusMarks, type JumpCandidateNode } from "@/lib/domain/procedure-execution-jump";
import ExecutionTaskEditorPanel from "./ExecutionTaskEditorPanel";
import ExecutionStepsGraph from "./ExecutionStepsGraph";
import type { ExecutionDetail } from "@/lib/db/queries/procedure-case-execution";

/**
 * **[추가 작업 등록]** — 「절차 흐름」 상자의 단추와 그것이 여는 창.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 무엇이 바뀌었나 (2026-11-03, 조각 13)
 * ──────────────────────────────────────────────────────────────────────
 * 조각 10 까지 이 창 안에는 **제목·내용 두 칸짜리 폼** 하나가 있었다. 사용자가
 * 정했다 — 「[추가 작업 등록]에서의 팝업은 플로우차트 편집화면에서처럼 노드종류를
 * 선택하고, 만들고, 잇는 기능들이 포함되도록 해줘.」 · 「[기술작업절차]편집기에
 * 있는 노드 추가/제거, 연결선 추가/제거 ui대로.」
 *
 * 그래서 창 안이 셋이 됐다: **지금 지도** · 더하는 상자 둘 · 지우는 상자 하나.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 🔴 이 파일은 **상태와 통로만** 들고 있다
 * ──────────────────────────────────────────────────────────────────────
 * 그려지는 모습은 ExecutionTaskEditorPanel, 그림은 ExecutionStepsGraph 다 —
 * 그림 쪽은 @xyflow/react 의 .css 를 끌고 와서 test:components 에서 import 가
 * 던지므로, 그 둘을 가른 덕에 창의 글자를 **그려서** 잴 수 있다(조각 10 의
 * 「전체 단계 보기」 창과 같은 모양).
 *
 * 🔴 **지도는 조각 10 의 것을 그대로 쓴다**(ExecutionStepsGraph). 그쪽이 이미
 * 「읽기 + 칸 하나 고르기 + 상태 딱지」인데 이 창에 필요한 것이 정확히 그것이다 —
 * 새로 감싸개를 만들면 같은 절차가 두 창에서 다르게 보이게 된다. 다만 **검색은
 * 안 쓴다**(highlightedNodeIds 를 null 로 둔다) — 여기서 찾는 일은 고른 작업
 * 드롭다운이 맡는다.
 *
 * 🔴 **저장 팝업을 안 띄운다.** 모달 창은 브라우저의 top layer 에 서므로 그 위에
 * 뜨는 저장 팝업이 창 뒤로 가려진다 — 대신 `router.refresh()` 로 창 안의 지도와
 * 목록이 **그 자리에서** 바뀐다. 그것이 저장됐다는 증거다(조각 10 의 같은 판단).
 *
 * ──────────────────────────────────────────────────────────────────────
 * 🔵 2026-11-03(조각 14) — 자리를 사람이 정한다
 * ──────────────────────────────────────────────────────────────────────
 * 셋이 늘었고 전부 이 파일이 맡는다:
 *  - **상·하·좌·우**로 새 작업을 놓는다(resolveNewNodePosition). 자리를 화면이
 *    세는 까닭은 그 함수 주석에.
 *  - **끌어서 옮긴다**(handleNodeDragStop → saveDroppedPosition). 🔴 **놓는 순간
 *    저장**이고, 성공하면 다시 읽지 않는다.
 *  - 연결의 **대상을 지도에서** 고른다(handleNodeClickIntercept). 시작과 대상을
 *    가르는 길이 거기 적혀 있다.
 */
export default function ExecutionExtraTaskDialog({
  executionId,
  procedureTemplateId,
  templateCategory,
  nodes,
  graphNodes,
  flowEdges,
  currentTaskNodeId,
  eligible,
}: {
  executionId: string;
  procedureTemplateId: string;
  templateCategory: ExecutionDetail["templateCategory"];
  /** 이 실행의 작업 줄 전부 — 절차 차례 그대로다. */
  nodes: readonly (CaseEditNode & JumpCandidateNode)[];
  /** 그림 재료 — START·참고 문서·이 건에서 더한 작업까지 전부. */
  graphNodes: ExecutionDetail["graphNodes"];
  /** 템플릿 간선과 이 건에서 그은 간선을 **합친** 한 목록. */
  flowEdges: readonly CaseEditEdge[] & ExecutionDetail["flowEdges"];
  /** 창을 열었을 때 골라져 있을 작업. 🔴 화면이 다시 고르지 않는다 — pickCurrentTask 의 답이다. */
  currentTaskNodeId: string | null;
  /** 🔴 못 쓰는 사람에게는 단추 자체가 안 선다 — 서버도 같은 문턱으로 다시 판정한다. */
  eligible: boolean;
}) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  /**
   * 그림을 **다시 태어나게** 하는 번호. 고른 칸이 바뀔 때마다 올려 카메라가
   * 그쪽으로 간다 — 같은 칸을 두 번 골라도 움직여야 하므로 id 가 아니라 번호다
   * (조각 7·10 의 같은 주석).
   */
  const [focusSeq, setFocusSeq] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  /** 연결의 **대상**. 🔴 시작은 고른 작업이 정하고, 이것은 따로 둔다(아래 pick 모드). */
  const [edgeTargetNodeId, setEdgeTargetNodeId] = useState<string | null>(null);
  /** 켜져 있는 동안 지도 누름이 **대상 고르기**가 된다 — 고름은 안 바뀐다. */
  const [isPickingEdgeTarget, setIsPickingEdgeTarget] = useState(false);
  /**
   * 방금 끌어다 놓은 자리(실행 노드 id → 좌표).
   *
   * ──────────────────────────────────────────────────────────────────
   * 🔴 이것이 없으면 **놓자마자 칸이 제자리로 튄다**
   * ──────────────────────────────────────────────────────────────────
   * 그림은 받은 `nodes` 배열의 좌표를 그대로 그린다. 놓는 순간 저장은 되지만
   * 서버에서 새 값을 다시 받아오기 전까지 배열은 **옛 자리**를 들고 있고, 그
   * 사이에 무엇이든 다시 그려지면(단추 하나만 눌러도) 칸이 되돌아간다. 그래서
   * 놓은 자리를 여기 적어 두고 그림에 넘기는 배열에 덧씌운다 — 절차 편집기가
   * 끌어 놓은 값을 제 상태에 모아 두는 것과 같은 길이다(그쪽은 [저장]까지 모으고,
   * 여기는 바로 보낸다).
   *
   * 🔵 저장에 성공해도 `router.refresh()` 를 **안 부른다.** 화면에 이미 그
   * 자리로 그려져 있어서 다시 읽어 봐야 바뀌는 것이 없고, 끌 때마다 창 전체를
   * 다시 읽으면 눈에 띄게 끊긴다. 실패했을 때만 이 표에서 지우고 다시 읽어
   * **진짜 자리로 되돌린다** — 그래야 「저장된 줄 알았는데 아니었다」가 안 생긴다.
   */
  const [droppedPositions, setDroppedPositions] = useState<ReadonlyMap<string, GraphPoint>>(new Map());

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (isOpen && !dialog.open) dialog.showModal();
    else if (!isOpen && dialog.open) dialog.close();
  }, [isOpen]);

  const selectedNode = useMemo(
    () => nodes.find((n) => n.id === selectedNodeId) ?? null,
    [nodes, selectedNodeId]
  );
  const edgeRows = useMemo(() => buildCaseEditEdgeRows({ nodes, edges: flowEdges }), [nodes, flowEdges]);
  const nodeMarks = useMemo(() => buildJumpStatusMarks(nodes), [nodes]);

  /**
   * 그림에 넘길 칸들 — 방금 끌어다 놓은 자리를 **덧씌운 뒤**다(droppedPositions).
   *
   * 🔵 덧씌우는 칸이 user_position_* 인 까닭: 그림은 사용자 배치가 있으면 언제나
   * 그쪽을 쓴다(resolveBaselinePosition). position_* 만 고치면 절차 갈래에 따라
   * 자동 배치로 흘러가 방금 놓은 자리가 버려질 수 있다.
   */
  const effectiveGraphNodes = useMemo(() => {
    if (droppedPositions.size === 0) return graphNodes;
    return graphNodes.map((n) => {
      const dropped = droppedPositions.get(n.id);
      if (!dropped) return n;
      return { ...n, positionX: dropped.x, positionY: dropped.y, userPositionX: dropped.x, userPositionY: dropped.y };
    });
  }, [graphNodes, droppedPositions]);

  /**
   * 🔴 **이 건에서 더한 작업만** 끌 수 있다. 원본 절차에서 온 칸은 그림 위에서
   * 똑같이 생겼지만, 끌리게 두면 사람이 끌고 **서버가 거절할 때까지** 움직인
   * 것으로 보인다 — 원본을 안 바꾸는 것이 이 창의 전제다.
   */
  const draggableGraphNodeIds = useMemo(
    () => effectiveGraphNodes.filter((n) => n.isAddedInCase).map((n) => n.id),
    [effectiveGraphNodes]
  );

  function openDialog() {
    setErrorMessage(null);
    setSelectedEdgeId(null);
    setEdgeTargetNodeId(null);
    setIsPickingEdgeTarget(false);
    // 🔵 끌어 놓은 자리는 **비우고 연다.** 창을 여는 시점의 서버 값이 진짜이고,
    //    닫힌 사이에 다른 사람이 옮겼을 수도 있다.
    setDroppedPositions(new Map());
    // 🔵 「지금 할 일」이 골라진 채로 뜬다 — 이어 붙이는 자리가 거기일 때가 가장 많다.
    setSelectedNodeId(currentTaskNodeId);
    setFocusSeq((seq) => seq + 1);
    setIsOpen(true);
  }

  function closeDialog() {
    if (isSubmitting) return;
    setIsOpen(false);
  }

  function selectNode(executionNodeId: string | null) {
    setSelectedNodeId(executionNodeId);
    setFocusSeq((seq) => seq + 1);
    setErrorMessage(null);
  }

  // 🔴 useCallback 으로 묶는다 — ProcedureFlowGraph 가 이 함수를 useEffect 의
  // 의존으로 쓴다. 매 렌더 새 함수를 넘기면 그 효과가 매번 다시 돌아 같은 값을
  // 되풀이해 올려 보낸다(조각 10 의 같은 주석).
  const handlePickedNodeChange = useCallback(
    (graphNodeId: string | null) => {
      // 그림이 주는 것은 **그림 위 자리 id** 다. 실행 줄이 없는 칸(시작 지점·참고
      // 문서)을 누르면 null 이 되고, 그러면 지우기 단추가 까닭과 함께 흐려진다.
      const node = findCaseEditNodeByGraphNodeId(nodes, graphNodeId);
      setSelectedNodeId(node?.id ?? null);
      setErrorMessage(null);
    },
    [nodes]
  );

  /**
   * 🔴 **시작과 대상을 가르는 자리**(2026-11-03, 조각 14).
   *
   * 지도에서 한 번 누른 것만으로는 시작인지 대상인지 알 수 없다. 그래서
   * 「지도에서 대상 고르기」를 눌러 둔 동안에만 이 가로채기가 누름을 **가져가고**
   * (true 를 돌려주면 그림의 고름은 안 바뀐다), 평소에는 아무것도 안 가져간다 —
   * 그때 지도 누름은 지금까지처럼 「고른 작업」을 바꾸고, 그것이 연결의 시작이 된다.
   *
   * 🔵 그림의 고름을 **안 건드리는** 길을 쓰는 까닭: 고름으로 대상을 받으면 같은
   * 칸을 두 번 누를 때 그림이 고름을 해제해 버려(토글) 대상이 조용히 사라진다.
   * 이 손잡이는 편집기의 「화면에서 선택」이 같은 까닭으로 쓰는 그것이다.
   *
   * 🔴 작업 줄로 안 풀리는 칸(시작 지점·참고 문서)을 누르면 **대상이 안 된다.**
   * 그래도 누름은 가져간다 — 안 가져가면 고름이 거기로 옮겨 가 「대상을 고르려다
   * 시작이 바뀐」 화면이 된다. 대신 까닭을 한 줄 적고 고르기 모드를 켠 채 둔다.
   */
  const handleNodeClickIntercept = useCallback(
    (graphNodeId: string): boolean => {
      if (!isPickingEdgeTarget) return false;
      const node = findCaseEditNodeByGraphNodeId(nodes, graphNodeId);
      if (!node) {
        setErrorMessage("그 칸은 이 실행의 작업이 아니라 연결 대상이 될 수 없습니다. 다른 칸을 눌러 주세요.");
        return true;
      }
      setEdgeTargetNodeId(node.id);
      setIsPickingEdgeTarget(false);
      setErrorMessage(null);
      return true;
    },
    [isPickingEdgeTarget, nodes]
  );

  /**
   * 🔴 **누르는 즉시 저장**이라 모든 단추가 이 한 통로를 지난다(2026-11-02 결정).
   * 성공하면 `router.refresh()` 로 창 안의 지도·목록이 그 자리에서 바뀐다 —
   * 창을 닫지 않는 까닭은 **연달아 더하는** 쓰임이 기본이기 때문이다(작업을
   * 만들고 바로 잇는다).
   */
  async function run(action: () => Promise<{ ok: boolean; message?: string }>) {
    if (isSubmitting) return;
    setIsSubmitting(true);
    setErrorMessage(null);
    const result = await action();
    setIsSubmitting(false);
    if (!result.ok) {
      setErrorMessage(result.message ?? "처리에 실패했습니다.");
      return;
    }
    router.refresh();
  }

  /**
   * **놓는 순간 저장**(2026-11-03, 조각 14) — 위 `run` 을 안 쓴다. 까닭이 셋이다:
   *
   *  1. 🔴 `run` 은 `isSubmitting` 이 서 있으면 **조용히 돌아간다.** 끌기는 손을
   *     떼는 순간 한 번뿐이라, 그 한 번을 거르면 사람은 저장된 줄 알고 창을 닫는다.
   *  2. 🔵 단추들을 흐리게 만들 까닭이 없다. 자리를 옮기는 동안 다른 일을 못 하게
   *     막을 이유가 없고, 오히려 끌 때마다 화면이 깜빡인다.
   *  3. 🔵 성공했을 때 **다시 읽지 않는다.** 화면은 이미 그 자리를 그리고 있다
   *     (droppedPositions) — 끌 때마다 창 전체를 다시 읽으면 눈에 띄게 끊긴다.
   *
   * 🔴 실패하면 덧씌운 자리를 **지우고** 다시 읽어 진짜 자리로 되돌린다. 안 그러면
   * 「저장된 줄 알았는데 아니었다」가 화면에 남는다.
   */
  async function saveDroppedPosition(executionNodeId: string, position: GraphPoint) {
    const result = await moveExecutionExtraTaskAction({ executionNodeId, position });
    if (result.ok) return;
    setErrorMessage(result.message ?? "자리를 저장하지 못했습니다.");
    setDroppedPositions((current) => {
      const next = new Map(current);
      next.delete(executionNodeId);
      return next;
    });
    router.refresh();
  }

  /**
   * 그림에서 손을 뗐다. 🔵 `graphNodeId` 는 **더한 작업의 실행 노드 id** 와 같다
   * (그 칸들만 끌 수 있고, 더한 작업의 그림 위 자리 id 가 곧 제 실행 노드
   * id 다 — getExecutionDetail 의 graphNodeIdOf). 그래도 한 번 되짚어 확인한다.
   */
  function handleNodeDragStop(graphNodeId: string, position: GraphPoint) {
    const node = findCaseEditNodeByGraphNodeId(nodes, graphNodeId);
    if (!node || !node.isAddedInCase) return;
    setDroppedPositions((current) => new Map(current).set(node.id, position));
    setErrorMessage(null);
    void saveDroppedPosition(node.id, position);
  }

  /**
   * 「고른 작업의 **어느 쪽**에 놓을지」를 화면이 보는 그대로의 좌표로 바꾼다.
   *
   * 🔴 고른 작업이 없으면 **null** 이다 — 기준이 없으면 방향도 뜻이 없다. 그때는
   * 좌표를 안 보내고, 조회가 지금까지처럼 자리를 센다(placeAddedGraphNodes).
   *
   * 🔵 기준으로 삼는 자리는 **그림이 실제로 그린 자리**다(사용자 배치 → 원본
   * 배치 차례). 서버가 혼자 다시 세면 사람이 화면에서 본 그 자리가 아니게 된다.
   */
  function resolveNewNodePosition(direction: ExtraTaskDirection): GraphPoint | null {
    if (!selectedNode) return null;
    const base = effectiveGraphNodes.find((n) => n.id === selectedNode.graphNodeId);
    if (!base) return null;
    const positionOf = (n: (typeof effectiveGraphNodes)[number]): GraphPoint => ({
      x: n.userPositionX ?? n.positionX,
      y: n.userPositionY ?? n.positionY,
    });
    return placeExtraTaskByDirection({
      base: positionOf(base),
      direction,
      // 🔴 **지금 그림에 서 있는 칸 전부**를 넘긴다. 더한 작업끼리만 견주면
      //    원본 칸 위에 올라앉는 것을 못 막는다.
      occupied: effectiveGraphNodes.map(positionOf),
    });
  }

  if (!eligible) return null;

  return (
    <>
      <button
        type="button"
        data-execution-extra-task-trigger
        onClick={openDialog}
        className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
      >
        추가 작업 등록
      </button>

      <dialog
        ref={dialogRef}
        aria-labelledby="execution-extra-task-dialog-title"
        onCancel={(event) => {
          event.preventDefault();
          closeDialog();
        }}
        className="max-h-[90vh] w-[min(64rem,95vw)] overflow-y-auto rounded-lg border border-zinc-200 bg-white p-4 text-zinc-900 backdrop:bg-black/40 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50"
      >
        <h2 id="execution-extra-task-dialog-title" className="text-sm font-semibold">
          추가 작업 등록
        </h2>

        <div className="mt-2">
          <ExecutionTaskEditorPanel
            nodes={nodes}
            edgeRows={edgeRows}
            selectedNode={selectedNode}
            onSelectNode={selectNode}
            selectedEdgeId={selectedEdgeId}
            onSelectEdge={(edgeId) => {
              setSelectedEdgeId(edgeId);
              setErrorMessage(null);
            }}
            isPickingEdgeTarget={isPickingEdgeTarget}
            onToggleEdgeTargetPicking={() => {
              setIsPickingEdgeTarget((picking) => !picking);
              setErrorMessage(null);
            }}
            edgeTargetNodeId={edgeTargetNodeId}
            onChangeEdgeTarget={(executionNodeId) => {
              setEdgeTargetNodeId(executionNodeId);
              setErrorMessage(null);
            }}
            isSubmitting={isSubmitting}
            errorMessage={errorMessage}
            onClose={closeDialog}
            onCreateNode={(input) =>
              void run(() =>
                addExecutionExtraTaskAction({
                  executionId,
                  title: input.title,
                  instructions: input.instructions,
                  nodeType: input.nodeType,
                  // 🔵 고른 작업이 없으면 null 이고, 그때는 자리를 저절로 센다.
                  position: resolveNewNodePosition(input.direction),
                })
              )
            }
            onRemoveNode={() => {
              if (!selectedNode) return;
              void run(async () => {
                const result = await removeExecutionExtraTaskAction({
                  executionNodeId: selectedNode.id,
                  expectedVersion: selectedNode.version,
                });
                // 🔵 지운 줄을 고른 채로 두면 다음 렌더에서 「없는 줄을 골랐다」가
                //    되어 까닭이 엉뚱하게 뜬다 — 고름을 먼저 푼다.
                if (result.ok) setSelectedNodeId(null);
                return result;
              });
            }}
            onCreateEdge={(input) =>
              void run(() =>
                addExecutionEdgeAction({
                  executionId,
                  fromExecutionNodeId: input.fromExecutionNodeId,
                  toExecutionNodeId: input.toExecutionNodeId,
                  branchType: input.branchType,
                  branchLabel: input.branchLabel,
                })
              )
            }
            onRemoveEdge={() => {
              if (!selectedEdgeId) return;
              void run(async () => {
                const result = await removeExecutionEdgeAction({ edgeId: selectedEdgeId });
                if (result.ok) setSelectedEdgeId(null);
                return result;
              });
            }}
            graphSlot={
              <ExecutionStepsGraph
                templateId={procedureTemplateId}
                templateCategory={templateCategory}
                nodes={effectiveGraphNodes}
                edges={flowEdges}
                focusNodeId={selectedNode?.graphNodeId ?? null}
                focusSeq={focusSeq}
                // 🔵 이 창에는 검색이 없다 — null 이 「아직 아무것도 안 걸렀다」는
                //    뜻이고, 빈 배열을 넘기면 그림이 통째로 흐려진다.
                highlightedNodeIds={null}
                nodeMarks={nodeMarks}
                onPickedNodeChange={handlePickedNodeChange}
                draggableNodeIds={draggableGraphNodeIds}
                onNodeDragStop={handleNodeDragStop}
                onNodeClickIntercept={handleNodeClickIntercept}
              />
            }
          />
        </div>
      </dialog>
    </>
  );
}
