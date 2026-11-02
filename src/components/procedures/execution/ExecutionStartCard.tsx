"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { startProcedureExecutionAction } from "@/lib/server/actions/procedure-case-execution";
import {
  classifyStartNode,
  findStartNode,
  resolveStartButtonState,
  searchStartNodes,
  type StartNodeHit,
} from "@/lib/domain/procedure-start-picker";
import ProcedureStartPickerPanel from "./ProcedureStartPickerPanel";
import ProcedureStartPickerGraph from "./ProcedureStartPickerGraph";
import type { ExecutableTemplateGraph, ExecutableTemplateNode } from "@/lib/db/queries/procedure-case-execution";

const START_ELIGIBLE_ROLES = ["SUPER_ADMIN", "ADMIN", "AS_ENGINEER"] as const;

/**
 * Phase 5C-1 — compact replacement for the former full-width "표준 절차 실행
 * 시작" card: a `[+ 기술 절차 불러오기]` trigger that opens the same
 * template-selection flow in a dialog. Role eligibility, published/
 * non-reference-only template filtering (computed by the caller via
 * getExecutableTemplateOptions), and the startProcedureExecutionAction call
 * are all identical to before.
 *
 * 이름에서 "표준" 을 뺐다 — 여기 뜨는 것은 [기술/지원] > 기술 작업 절차에서
 * 만들어 **게시한** 절차이지, 따로 있는 "표준" 묶음이 아니다. 이름이 그렇게
 * 읽히면 목록이 비었을 때 사람이 엉뚱한 데를 찾게 된다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 2026-11-02(조각 7) — 드롭다운 하나짜리 작은 창이 **고르는 창**이 됐다
 * ──────────────────────────────────────────────────────────────────────
 * 전에는 절차를 고르면 **언제나 처음부터** 시작했고, 노드 이름으로 찾을 길이
 * 없었다. 이제 창 하나에서 네 가지가 된다: 모든 절차에서 이름으로 찾기 ·
 * 절차 하나로 좁혀 찾기 · 플로우차트에서 자리 확인하기 · 그 노드부터 시작하기.
 *
 * 🔴 **이 파일은 상태만 들고 있다.** 무엇이 걸리는지 · 무엇을 고를 수 있는지 ·
 * 단추에 뭐라고 적는지는 전부 procedure-start-picker.ts 가 정한다. 그려지는
 * 모습은 ProcedureStartPickerPanel, 그림은 ProcedureStartPickerGraph 다 —
 * 그림 쪽은 @xyflow/react 의 .css 를 끌고 와서 test:components 에서 import 가
 * 던지므로, 그 둘을 가른 덕에 창의 글자를 **그려서** 잴 수 있다.
 */
export default function ExecutionStartCard({
  repairCaseId,
  actingUserRole,
  templateOptions,
}: {
  repairCaseId: string;
  actingUserRole: string;
  templateOptions: ExecutableTemplateGraph[];
}) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  /**
   * 🔴 null 이 **「모든 절차」**이고 그것이 기본값이다. 전에는 첫 절차가 미리
   * 골라져 있었는데, 사람은 보통 「어느 절차에 있는지」가 아니라 「무슨 작업인지」를
   * 알고 온다 — 그 상태에서 첫 절차로 좁혀 두면 검색이 엉뚱한 데서 돈다.
   */
  const [scopeTemplateId, setScopeTemplateId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [chosenNodeId, setChosenNodeId] = useState<string | null>(null);
  /**
   * 검색 결과를 누를 때마다 올라간다. 그림의 `key` 에 들어가 **다시 태어나게**
   * 하는 값이다 — 같은 결과를 두 번 눌러도 카메라가 움직여야 하므로 노드 id 가
   * 아니라 번호다(ProcedureStartPickerGraph 의 focusSeq 주석).
   */
  const [focusSeq, setFocusSeq] = useState(0);
  const [focusNodeId, setFocusNodeId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const eligible = (START_ELIGIBLE_ROLES as readonly string[]).includes(actingUserRole);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (isOpen && !dialog.open) dialog.showModal();
    else if (!isOpen && dialog.open) dialog.close();
  }, [isOpen]);

  const search = useMemo(
    () => searchStartNodes(templateOptions, query, scopeTemplateId),
    [templateOptions, query, scopeTemplateId]
  );

  // 그림에서 환하게 남길 노드. 🔴 검색어가 **비어 있으면 null** — 빈 배열을 넘기면
  // 「하나도 안 걸렸다」는 뜻이 되어 아직 검색도 안 했는데 그림이 통째로 흐려진다.
  //
  // 🔵 목록에 **보이는 것**(search.hits)만 환하게 한다. 맞는 수가 한도를 넘어 잘린
  // 경우에도 그림과 목록이 같은 것을 가리키게 하려는 것이다 — 그림만 더 많이
  // 밝히면 목록에 없는 노드가 왜 환한지 설명할 길이 없다.
  const highlightedNodeIds = useMemo(() => {
    if (query.trim() === "") return null;
    return search.hits.filter((hit) => hit.templateId === scopeTemplateId).map((hit) => hit.node.id);
  }, [query, search, scopeTemplateId]);

  const scopedTemplate = useMemo(
    () => (scopeTemplateId === null ? null : (templateOptions.find((t) => t.id === scopeTemplateId) ?? null)),
    [templateOptions, scopeTemplateId]
  );

  // 🔴 그림에서 **누를 수 있는** 노드. 서버도 같은 함수로 다시 가른다
  // (startProcedureExecution) — 여기서 막는 것은 편의이지 집행이 아니다.
  const pickableNodeIds = useMemo(() => {
    const ids = new Set<string>();
    for (const node of scopedTemplate?.nodes ?? []) {
      if (classifyStartNode(node.nodeType).ok) ids.add(node.id);
    }
    return ids;
  }, [scopedTemplate]);

  const chosen = useMemo(
    () => findStartNode(templateOptions, scopeTemplateId, chosenNodeId),
    [templateOptions, scopeTemplateId, chosenNodeId]
  );

  const button = resolveStartButtonState({ scopeTemplateId, chosenNodeId, isSubmitting });

  function openDialog() {
    setErrorMessage(null);
    setScopeTemplateId(null);
    setQuery("");
    setChosenNodeId(null);
    setFocusNodeId(null);
    setFocusSeq(0);
    setIsOpen(true);
  }

  function closeDialog() {
    if (isSubmitting) return;
    setIsOpen(false);
  }

  function handleScopeChange(templateId: string | null) {
    setScopeTemplateId(templateId);
    // 🔴 절차를 바꾸면 고른 것을 비운다 — 안 비우면 **앞 절차의 노드 id** 가 그대로
    // 남아, 화면에는 「고른 것 없음」이 뜨는데 서버로는 남의 절차 노드가 간다.
    setChosenNodeId(null);
    setFocusNodeId(null);
    setErrorMessage(null);
  }

  function handleHitSelect(hit: StartNodeHit<ExecutableTemplateNode>) {
    // 🔵 검색 결과를 누르면 **드롭다운이 그 절차로 저절로 바뀐다** — 「모든 절차」에서
    // 찾은 노드를 그림에서 보려면 절차가 정해져야 한다.
    setScopeTemplateId(hit.templateId);
    setChosenNodeId(hit.node.id);
    setFocusNodeId(hit.node.id);
    setFocusSeq((seq) => seq + 1);
    setErrorMessage(null);
  }

  // 🔴 useCallback 으로 묶는다 — ProcedureFlowGraph 가 이 함수를 useEffect 의
  // 의존으로 쓴다. 매 렌더 새 함수를 넘기면 그 효과가 매번 다시 돌아 같은 값을
  // 되풀이해 올려 보낸다.
  const handlePickedNodeChange = useCallback((nodeId: string | null) => {
    setChosenNodeId(nodeId);
  }, []);

  function handleClearChoice() {
    setChosenNodeId(null);
    setFocusNodeId(null);
    setFocusSeq((seq) => seq + 1);
  }

  async function handleStart() {
    if (scopeTemplateId === null || isSubmitting) return;
    setIsSubmitting(true);
    setErrorMessage(null);
    const result = await startProcedureExecutionAction({
      repairCaseId,
      procedureTemplateId: scopeTemplateId,
      startAtProcedureTemplateNodeId: chosenNodeId,
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
        onClick={openDialog}
        className="self-start rounded-md border border-dashed border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
      >
        + 기술 절차 불러오기
      </button>

      <dialog
        ref={dialogRef}
        aria-labelledby="execution-start-dialog-title"
        onCancel={(event) => {
          event.preventDefault();
          closeDialog();
        }}
        // 🔵 창이 넓어졌다 — 안에 플로우차트가 들어간다. 좁은 폰에서는 화면 폭의
        // 95% 까지만 쓰고 세로로 넘치면 창 안에서 스크롤한다(그림 자체는 React
        // Flow 가 제 안에서 끌어 움직인다).
        className="max-h-[90vh] w-[min(64rem,95vw)] overflow-y-auto rounded-lg border border-zinc-200 bg-white p-4 text-zinc-900 backdrop:bg-black/40 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50"
      >
        <h2 id="execution-start-dialog-title" className="text-sm font-semibold">
          기술 절차 불러오기
        </h2>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          게시된 절차 템플릿을 선택하여 이 접수 건에 대한 절차 실행을 시작합니다. 작업 이름으로 찾아{" "}
          <span className="font-medium">그 작업부터</span> 시작할 수도 있습니다 — 앞의 작업들은 건너뛴 것이 아니라
          대기로 남습니다.
        </p>

        {templateOptions.length === 0 ? (
          // 비었을 때 "없습니다" 한 줄만 두면 사람이 고장으로 읽는다. 왜
          // 비었는지(게시된 것만 온다)와 어디서 채우는지([기술/지원] > 기술
          // 작업 절차의 [게시])를 함께 말해 준다.
          <div className="mt-3 flex flex-col gap-1 text-sm text-zinc-500 dark:text-zinc-400">
            <p>불러올 수 있는 기술 절차가 없습니다.</p>
            <p className="text-xs">
              이 목록에는 <span className="font-medium">게시된</span> 절차만 나타납니다. 절차를 게시하려면{" "}
              <span className="font-medium">[기술/지원] &gt; 기술 작업 절차</span> 에서 해당 절차를 열고{" "}
              <span className="font-medium">[게시]</span> 를 누르세요. 초안(DRAFT) 상태이거나 참고용으로 표시된
              절차는 여기에 나타나지 않습니다.
            </p>
            <div className="mt-3 flex justify-end">
              <button
                type="button"
                onClick={closeDialog}
                className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                취소
              </button>
            </div>
          </div>
        ) : !eligible ? (
          <div className="mt-3 flex flex-col gap-3">
            <p className="text-sm text-zinc-500 dark:text-zinc-400">최고관리자·관리자·담당 A/S 엔지니어만 실행을 시작할 수 있습니다.</p>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={closeDialog}
                className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                취소
              </button>
            </div>
          </div>
        ) : (
          <ProcedureStartPickerPanel
            templates={templateOptions}
            scopeTemplateId={scopeTemplateId}
            onScopeChange={handleScopeChange}
            query={query}
            onQueryChange={setQuery}
            search={search}
            onHitSelect={handleHitSelect}
            chosen={chosen}
            onClearChoice={handleClearChoice}
            button={button}
            onStart={() => void handleStart()}
            onCancel={closeDialog}
            errorMessage={errorMessage}
            graphSlot={
              scopedTemplate === null ? null : (
                <ProcedureStartPickerGraph
                  template={scopedTemplate}
                  focusNodeId={focusNodeId}
                  focusSeq={focusSeq}
                  highlightedNodeIds={highlightedNodeIds}
                  pickableNodeIds={pickableNodeIds}
                  onPickedNodeChange={handlePickedNodeChange}
                />
              )
            }
          />
        )}
      </dialog>
    </>
  );
}
