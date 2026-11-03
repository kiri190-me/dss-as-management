"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  addExecutionEdgeAction,
  addExecutionExtraTaskAction,
  removeExecutionEdgeAction,
  removeExecutionExtraTaskAction,
} from "@/lib/server/actions/procedure-case-execution";
import {
  buildCaseEditEdgeRows,
  findCaseEditNodeByGraphNodeId,
  type CaseEditEdge,
  type CaseEditNode,
} from "@/lib/domain/procedure-execution-case-edit";
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

  function openDialog() {
    setErrorMessage(null);
    setSelectedEdgeId(null);
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
                nodes={graphNodes}
                edges={flowEdges}
                focusNodeId={selectedNode?.graphNodeId ?? null}
                focusSeq={focusSeq}
                // 🔵 이 창에는 검색이 없다 — null 이 「아직 아무것도 안 걸렀다」는
                //    뜻이고, 빈 배열을 넘기면 그림이 통째로 흐려진다.
                highlightedNodeIds={null}
                nodeMarks={nodeMarks}
                onPickedNodeChange={handlePickedNodeChange}
              />
            }
          />
        </div>
      </dialog>
    </>
  );
}
