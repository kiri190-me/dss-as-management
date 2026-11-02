"use client";

import { formatProcedureTemplateTitle } from "@/lib/domain/procedure-template-title";
import type {
  StartNodeHit,
  StartNodeSearchResult,
  StartPickerNode,
  StartPickerTemplate,
  StartButtonState,
} from "@/lib/domain/procedure-start-picker";

/**
 * 「기술 절차 불러오기」 창의 **속**(2026-11-02, 조각 7) — 절차 드롭다운 · 노드
 * 이름 검색 · 검색 결과 · 플로우차트 자리 · 고른 것 · 단추 둘.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 🔴 상태를 하나도 안 들고 있다
 * ──────────────────────────────────────────────────────────────────────
 * 고른 절차도, 검색어도, 고른 노드도 전부 **부모(ExecutionStartCard)가** 들고
 * 있고 여기로 내려온다. 까닭은 둘이다:
 *
 *  1. 같은 값을 **플로우차트도** 봐야 한다. 검색에 걸린 노드를 그림에서 환하게
 *     그리고, 그림에서 누른 노드를 「고른 것」으로 올린다 — 상태가 이 안에 있으면
 *     그림과 목록이 서로를 못 본다.
 *  2. 이 묶음은 상태가 없으므로 **그려서 잴 수 있다.** 플로우차트는
 *     @xyflow/react 의 .css 를 끌고 와서 test:components 에서 import 자체가
 *     던지는데(procedure-publish-flow.test.tsx 머리말), 그 그림을 `graphSlot` 으로
 *     바깥에서 받으면 이 묶음만 따로 그려 글자를 확인할 수 있다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 🔴 여기서 다시 판정하지 않는다
 * ──────────────────────────────────────────────────────────────────────
 * 「무엇이 걸렸는가」(searchStartNodes) · 「고를 수 있는가」(classifyStartNode) ·
 * 「단추에 뭐라고 적는가」(resolveStartButtonState)는 전부
 * procedure-start-picker.ts 가 정한 결과로 받는다. 화면이 조건을 한 줄이라도 다시
 * 적으면 서버·시험과 말이 갈린다.
 */
export default function ProcedureStartPickerPanel<T extends StartPickerNode>({
  templates,
  scopeTemplateId,
  onScopeChange,
  query,
  onQueryChange,
  search,
  onHitSelect,
  chosen,
  onClearChoice,
  button,
  onStart,
  onCancel,
  errorMessage,
  graphSlot,
}: {
  templates: readonly StartPickerTemplate<T>[];
  /** null 이면 「모든 절차」 — 드롭다운의 **기본값**이다. */
  scopeTemplateId: string | null;
  onScopeChange: (templateId: string | null) => void;
  query: string;
  onQueryChange: (query: string) => void;
  search: StartNodeSearchResult<T>;
  /** 검색 결과 한 줄을 눌렀다 — 부모가 드롭다운을 그 절차로 바꾸고 그림을 그 노드로 옮긴다. */
  onHitSelect: (hit: StartNodeHit<T>) => void;
  chosen: StartNodeHit<T> | null;
  onClearChoice: () => void;
  button: StartButtonState;
  onStart: () => void;
  onCancel: () => void;
  errorMessage: string | null;
  /**
   * 플로우차트. 「모든 절차」일 때는 부모가 null 을 넘기고, 여기서는 그릴 것이
   * 없다는 **한 줄 안내**를 대신 세운다 — 빈 네모를 그려 두면 「그림이 깨졌다」로
   * 읽힌다.
   */
  graphSlot: React.ReactNode;
}) {
  return (
    <div className="mt-3 flex flex-col gap-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <label htmlFor="execution-template-select" className="w-12 shrink-0 text-xs text-zinc-500 dark:text-zinc-400">
          절차
        </label>
        <select
          id="execution-template-select"
          value={scopeTemplateId ?? ""}
          onChange={(event) => onScopeChange(event.target.value === "" ? null : event.target.value)}
          className="w-full rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-900 sm:flex-1 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
        >
          {/* 🔴 기본값이 「모든 절차」다 — 사람이 어느 절차에 있는 노드인지 모르는
              채로 이름만 아는 경우가 흔하다는 것이 이 창을 만든 까닭이다. */}
          <option value="">모든 절차</option>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {formatProcedureTemplateTitle(t.name, t.code)}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <label htmlFor="execution-node-search" className="w-12 shrink-0 text-xs text-zinc-500 dark:text-zinc-400">
          검색
        </label>
        <input
          id="execution-node-search"
          type="search"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="작업 이름으로 찾기 (예: MCU)"
          className="w-full rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-900 sm:flex-1 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
        />
        {query.trim().length > 0 && (
          <span className="shrink-0 text-xs text-zinc-500 dark:text-zinc-400">맞는 노드 {search.matchCount}개</span>
        )}
      </div>

      {query.trim().length > 0 && (
        <div className="max-h-44 overflow-y-auto rounded-md border border-zinc-200 dark:border-zinc-800">
          {search.hits.length === 0 ? (
            <p className="px-3 py-2 text-xs text-zinc-500 dark:text-zinc-400">일치하는 작업이 없습니다.</p>
          ) : (
            <ul>
              {search.hits.map((hit) => (
                <li key={`${hit.templateId}:${hit.node.id}`}>
                  <button
                    type="button"
                    disabled={!hit.eligibility.ok}
                    onClick={() => onHitSelect(hit)}
                    className="block w-full px-3 py-1.5 text-left text-xs text-zinc-700 enabled:hover:bg-zinc-100 disabled:cursor-not-allowed disabled:text-zinc-400 dark:text-zinc-300 dark:enabled:hover:bg-zinc-800 dark:disabled:text-zinc-600"
                  >
                    {/* 🔴 절차 이름은 「모든 절차」에서만 앞에 붙인다 — 절차를 하나
                        고른 상태에서는 드롭다운에 이미 적혀 있어서, 줄마다 되풀이하면
                        정작 가려야 할 번호와 이름이 오른쪽으로 밀린다. */}
                    {scopeTemplateId === null && (
                      <span className="text-zinc-400 dark:text-zinc-600">{hit.templateTitle} › </span>
                    )}
                    <span className="font-medium">
                      {hit.orderIndex === null ? "" : `${hit.orderIndex}. `}
                      {hit.title}
                    </span>
                    {!hit.eligibility.ok && <span className="ml-1 text-zinc-400 dark:text-zinc-600">— {hit.eligibility.message}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {search.truncated && (
            <p className="border-t border-zinc-200 px-3 py-1.5 text-xs text-zinc-400 dark:border-zinc-800 dark:text-zinc-600">
              맞는 노드가 많아 {search.hits.length}개만 보입니다. 검색어를 더 적어 주세요.
            </p>
          )}
        </div>
      )}

      {scopeTemplateId === null ? (
        <p className="rounded-md border border-dashed border-zinc-300 px-3 py-6 text-center text-xs text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
          절차를 고르거나 검색 결과를 누르면 여기에 흐름이 그려집니다.
        </p>
      ) : (
        graphSlot
      )}

      <div className="flex flex-col gap-2 border-t border-zinc-200 pt-3 sm:flex-row sm:items-center sm:justify-between dark:border-zinc-800">
        <p className="text-xs text-zinc-600 dark:text-zinc-400">
          {chosen === null ? (
            <span className="text-zinc-500 dark:text-zinc-400">고른 것 없음 — 절차 처음부터 시작합니다.</span>
          ) : (
            <>
              <span className="text-zinc-500 dark:text-zinc-400">고른 것: </span>
              <span className="font-medium text-zinc-900 dark:text-zinc-50">
                {chosen.orderIndex === null ? "" : `${chosen.orderIndex}. `}
                {chosen.title}
              </span>
              <button
                type="button"
                onClick={onClearChoice}
                className="ml-2 rounded border border-zinc-300 px-1.5 py-0.5 text-[11px] text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
              >
                처음부터로 되돌리기
              </button>
            </>
          )}
        </p>
        <div className="flex shrink-0 justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            취소
          </button>
          <button
            type="button"
            onClick={onStart}
            disabled={button.disabled}
            title={button.hint ?? undefined}
            className="rounded-md bg-primary-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-800 disabled:opacity-50 dark:bg-primary-50 dark:text-zinc-900 dark:hover:bg-primary-200"
          >
            {button.label}
          </button>
        </div>
      </div>

      {button.hint && <p className="text-right text-xs text-zinc-500 dark:text-zinc-400">{button.hint}</p>}
      {errorMessage && <p className="text-xs text-red-600 dark:text-red-400">{errorMessage}</p>}
    </div>
  );
}
