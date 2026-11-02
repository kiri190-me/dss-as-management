"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { jumpToExecutionNodeAction } from "@/lib/server/actions/procedure-case-execution";
import {
  buildJumpStatusMarks,
  findJumpTarget,
  findJumpTargetByTemplateNodeId,
  resolveJumpButtonState,
  searchJumpTargets,
  type JumpCandidateNode,
  type JumpNodeHit,
} from "@/lib/domain/procedure-execution-jump";
import ExecutionStepsPanel from "./ExecutionStepsPanel";
import ExecutionStepsGraph from "./ExecutionStepsGraph";
import type { ExecutionDetail } from "@/lib/db/queries/procedure-case-execution";

/**
 * **[전체 단계 보기]** — 「절차 흐름」 상자의 단추와 그것이 여는 창
 * (2026-11-02, 조각 10).
 *
 * ──────────────────────────────────────────────────────────────────────
 * 무엇이 바뀌었나
 * ──────────────────────────────────────────────────────────────────────
 * 전에는 같은 이름의 **접히는 묶음**이 화면 아래에 있었고, 펼치면 노드 카드가
 * 스무 장 넘게 쏟아졌다. 사용자가 눈으로 보고 정했다 — 「[전체 단계 보기]는
 * 지금같은 형태 말고, 누르면 팝업으로 플로우차드로 보여지도록 해주고, 노드를
 * 선택하면 [지금 할 일]이 해당 노드의 작업으로 뛰어넘기 되도록 해줘.」
 *
 * ──────────────────────────────────────────────────────────────────────
 * 🔴 이 파일은 **상태만** 들고 있다
 * ──────────────────────────────────────────────────────────────────────
 * 무엇이 걸리는지 · 무엇을 옮길 수 있는지 · 단추에 뭐라고 적고 왜 안 눌리는지는
 * 전부 procedure-execution-jump.ts 가 정한다. 그려지는 모습은
 * ExecutionStepsPanel, 그림은 ExecutionStepsGraph 다 — 그림 쪽은 @xyflow/react 의
 * .css 를 끌고 와서 test:components 에서 import 가 던지므로, 그 둘을 가른 덕에
 * 창의 글자를 **그려서** 잴 수 있다(조각 7 의 불러오기 창과 같은 모양).
 *
 * 🔴 창이 닫힐 때 `router.refresh()` 만 하고 저장 팝업은 안 띄운다. 모달 창은
 * 브라우저의 top layer 에 서므로 그 위에 뜨는 저장 팝업이 **창 뒤로 가려진다** —
 * 불러오기 창(ExecutionStartCard)이 같은 까닭으로 같은 길을 쓴다.
 */
export default function ExecutionStepsDialog({
  executionId,
  procedureTemplateId,
  templateCategory,
  nodes,
  templateNodes,
  flowEdges,
  currentTaskNodeId,
  isExecutionFinished,
  eligible,
}: {
  executionId: string;
  procedureTemplateId: string;
  templateCategory: ExecutionDetail["templateCategory"];
  /** 실행 줄 전부 — 절차 차례 그대로다(getExecutionDetail 이 정렬해서 내려준다). */
  nodes: readonly JumpCandidateNode[];
  /** 절차 **그림 재료**(START·참고 문서까지 전부). */
  templateNodes: ExecutionDetail["templateNodes"];
  flowEdges: ExecutionDetail["flowEdges"];
  /** 지금 「지금 할 일」로 서 있는 실행 줄. 🔴 화면이 다시 고르지 않는다 — pickCurrentTask 의 답을 그대로 받는다. */
  currentTaskNodeId: string | null;
  /**
   * 🔴 마친 실행에서도 **창은 열린다**(되짚어 보는 쓰임이 있다) — 다만 옮기기는
   * 막히고 까닭이 적힌다. 여기서 completedAt 을 다시 보지 않는다. 큰 카드·띠·
   * 목록이 쓰는 것과 **같은 사실 한 줄**을 받는다.
   */
  isExecutionFinished: boolean;
  /** 옮길 수 있는 사람인가. 서버도 같은 문턱으로 다시 판정한다. */
  eligible: boolean;
}) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [chosenNodeId, setChosenNodeId] = useState<string | null>(null);
  /**
   * 검색 결과를 누를 때마다 올라간다. 그림의 `key` 에 들어가 **다시 태어나게**
   * 하는 값이다 — 같은 결과를 두 번 눌러도 카메라가 움직여야 하므로 노드 id 가
   * 아니라 번호다(조각 7 의 같은 주석).
   */
  const [focusSeq, setFocusSeq] = useState(0);
  const [focusNodeId, setFocusNodeId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (isOpen && !dialog.open) dialog.showModal();
    else if (!isOpen && dialog.open) dialog.close();
  }, [isOpen]);

  const search = useMemo(() => searchJumpTargets(nodes, query), [nodes, query]);

  // 그림에서 환하게 남길 노드. 🔴 검색어가 **비어 있으면 null** — 빈 배열을 넘기면
  // 「하나도 안 걸렸다」는 뜻이 되어 아직 검색도 안 했는데 그림이 통째로 흐려진다.
  //
  // 🔵 사례별 추가 작업은 그림에 자리가 없으므로 여기서 빠진다(목록에는 그대로
  // 걸린다 — 둘을 같은 규칙으로 묶으면 추가 작업으로는 영영 못 옮긴다).
  const highlightedNodeIds = useMemo(() => {
    if (query.trim() === "") return null;
    return search.hits
      .map((hit) => hit.node.procedureTemplateNodeId)
      .filter((id): id is string => id !== null);
  }, [query, search]);

  const nodeMarks = useMemo(() => buildJumpStatusMarks(nodes), [nodes]);
  const chosen = useMemo(() => findJumpTarget(nodes, chosenNodeId), [nodes, chosenNodeId]);

  const button = resolveJumpButtonState({
    chosen,
    isAlreadyCurrent: chosen !== null && chosen.node.id === currentTaskNodeId,
    isSubmitting,
    isExecutionFinished,
    eligible,
  });

  function openDialog() {
    setErrorMessage(null);
    setQuery("");
    // 🔵 창을 열면 **지금 할 일**이 골라진 채로 뜨고 카메라가 거기로 간다 —
    // 「내가 지금 어디에 있고 어디로 갈 수 있나」가 이 창을 여는 까닭이다.
    setChosenNodeId(currentTaskNodeId);
    setFocusNodeId(nodes.find((n) => n.id === currentTaskNodeId)?.procedureTemplateNodeId ?? null);
    setFocusSeq((seq) => seq + 1);
    setIsOpen(true);
  }

  function closeDialog() {
    if (isSubmitting) return;
    setIsOpen(false);
  }

  function handleHitSelect(hit: JumpNodeHit) {
    setChosenNodeId(hit.node.id);
    setFocusNodeId(hit.node.procedureTemplateNodeId);
    setFocusSeq((seq) => seq + 1);
    setErrorMessage(null);
  }

  // 🔴 useCallback 으로 묶는다 — ProcedureFlowGraph 가 이 함수를 useEffect 의
  // 의존으로 쓴다. 매 렌더 새 함수를 넘기면 그 효과가 매번 다시 돌아 같은 값을
  // 되풀이해 올려 보낸다.
  const handlePickedNodeChange = useCallback(
    (templateNodeId: string | null) => {
      // 그림이 주는 것은 **절차 노드** id 다. 실행 줄이 없는 칸(시작 지점·참고
      // 문서)을 누르면 null 이 되고, 그러면 단추가 까닭과 함께 흐려진다.
      const node = findJumpTargetByTemplateNodeId(nodes, templateNodeId);
      setChosenNodeId(node?.id ?? null);
      setErrorMessage(null);
    },
    [nodes]
  );

  function handleClearChoice() {
    setChosenNodeId(null);
    setFocusNodeId(null);
    setFocusSeq((seq) => seq + 1);
  }

  async function handleJump() {
    if (chosen === null || isSubmitting) return;
    setIsSubmitting(true);
    setErrorMessage(null);
    const result = await jumpToExecutionNodeAction({
      executionId,
      executionNodeId: chosen.node.id,
      expectedVersion: chosen.node.version,
    });
    setIsSubmitting(false);
    if (!result.ok) {
      setErrorMessage(result.message);
      return;
    }
    setIsOpen(false);
    router.refresh();
  }

  return (
    <>
      <button
        type="button"
        data-execution-steps-trigger
        onClick={openDialog}
        className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
      >
        전체 단계 보기
      </button>

      <dialog
        ref={dialogRef}
        aria-labelledby="execution-steps-dialog-title"
        onCancel={(event) => {
          event.preventDefault();
          closeDialog();
        }}
        // 🔵 좁은 폰에서는 화면 폭의 95% 까지만 쓰고 세로로 넘치면 창 안에서
        // 스크롤한다(그림 자체는 React Flow 가 제 안에서 끌어 움직인다) —
        // 불러오기 창과 같은 잣대다.
        className="max-h-[90vh] w-[min(64rem,95vw)] overflow-y-auto rounded-lg border border-zinc-200 bg-white p-4 text-zinc-900 backdrop:bg-black/40 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50"
      >
        <h2 id="execution-steps-dialog-title" className="text-sm font-semibold">
          전체 단계 보기
        </h2>
        {/* 🔴 2026-11-02(조각 11)에 **하는 일이 바뀌어** 글자를 고쳤다. 전에는
            「앞의 작업들은 건너뛴 것이 아니라 대기로 남습니다」였는데, 이제는
            경로 위가 완료가 되고 경로 밖의 완료는 대기로 되돌아간다. 글자를 안
            고치면 화면이 **반대로 적힌 설명**을 달고 있게 된다.

            🔴 되돌아가는 쪽을 반드시 적는다 — 되돌리면 그 노드의 작업 메모가
            지워지므로(실행 이력에는 남는다), 누르기 전에 알아야 한다. */}
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          이 절차의 모든 단계와 지금 상태를 봅니다. 작업을 고르고 <span className="font-medium">[여기로 옮기기]</span> 를
          누르면 「지금 할 일」이 그 작업이 되고, <span className="font-medium">시작 지점에서 그 작업까지 이어지는 최단
          경로 위의 앞 작업들이 완료로 바뀝니다</span>. 그 경로에서 벗어난 완료는{" "}
          <span className="font-medium">다시 대기가 되고 그 작업의 메모는 지워집니다</span> — 지워진 메모는 「실행 이력」에
          남습니다. 건너뛰거나 막아 둔 작업은 사유와 함께 그대로 둡니다.
        </p>

        <ExecutionStepsPanel
          query={query}
          onQueryChange={setQuery}
          search={search}
          onHitSelect={handleHitSelect}
          chosen={chosen}
          onClearChoice={handleClearChoice}
          button={button}
          onJump={() => void handleJump()}
          onCancel={closeDialog}
          errorMessage={errorMessage}
          graphSlot={
            <ExecutionStepsGraph
              templateId={procedureTemplateId}
              templateCategory={templateCategory}
              nodes={templateNodes}
              edges={flowEdges}
              focusNodeId={focusNodeId}
              focusSeq={focusSeq}
              highlightedNodeIds={highlightedNodeIds}
              nodeMarks={nodeMarks}
              onPickedNodeChange={handlePickedNodeChange}
            />
          }
        />
      </dialog>
    </>
  );
}
