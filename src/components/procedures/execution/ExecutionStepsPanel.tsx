"use client";

import {
  toJumpStatusMark,
  type JumpButtonState,
  type JumpNodeHit,
  type JumpNodeSearchResult,
  type JumpStatusTone,
} from "@/lib/domain/procedure-execution-jump";
import { PROCEDURE_CASE_EXECUTION_NODE_STATUS_CODES } from "@/lib/domain/procedure-case-execution-types";

/**
 * 「전체 단계 보기」 창의 **속**(2026-11-02, 조각 10) — 작업 이름 검색 · 검색 결과 ·
 * 상태 범례 · 플로우차트 자리 · 고른 것 · 단추 둘.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 🔴 상태를 하나도 안 들고 있다 — 이웃 ProcedureStartPickerPanel 과 같은 까닭
 * ──────────────────────────────────────────────────────────────────────
 * 검색어도 고른 노드도 전부 부모(ExecutionStepsDialog)가 들고 있다. 그래야
 * 플로우차트와 목록이 **같은 값**을 보고, 이 묶음은 상태가 없으니 **그려서 잴 수
 * 있다**(그림은 @xyflow/react 의 .css 를 끌고 와서 test:components 에서 import
 * 자체가 던진다 — 그래서 `graphSlot` 으로 바깥에서 받는다).
 *
 * ──────────────────────────────────────────────────────────────────────
 * 🔴 여기서 다시 판정하지 않는다
 * ──────────────────────────────────────────────────────────────────────
 * 「무엇이 걸렸는가」(searchJumpTargets) · 「옮길 수 있는가」(classifyJumpTarget) ·
 * 「단추에 뭐라고 적고 왜 안 눌리는가」(resolveJumpButtonState)는 전부
 * procedure-execution-jump.ts 가 정한 결과로 받는다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 🔵 왜 이웃 창(ProcedureStartPickerPanel)을 함께 쓰지 않았나
 * ──────────────────────────────────────────────────────────────────────
 * 일곱 자리 가운데 **다섯이 다르다**: 절차 드롭다운이 여기엔 아예 없고(실행이
 * 정해져 있다), 줄마다 **상태 딱지**가 붙고, 상태 범례가 붙고, 아래 글이
 * 「처음부터 시작합니다」가 아니라 「지금 할 일을 옮깁니다」이고, 단추 글자와
 * 못 누르는 까닭이 다르다. 합치면 그 다섯이 전부 조건이 되어 두 쓰임 어느 쪽도
 * 읽기 어려워진다. 대신 **같은 것은 진짜로 같이 쓴다** — 제목 접기
 * (flattenNodeTitle)와 그림(ProcedureFlowGraph)이 그것이다.
 */

/** 딱지 색. 🔵 흐름 띠(ExecutionFlowStrip)의 CHIP_TONE_CLASS 와 같은 계열이다 — 한 화면에 둘이 나란히 선다. */
const TONE_CLASS: Record<JumpStatusTone, string> = {
  CURRENT: "border-primary-900 bg-primary-900 text-white dark:border-primary-50 dark:bg-primary-50 dark:text-zinc-900",
  DONE: "border-zinc-200 bg-zinc-100 text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400",
  BLOCKED: "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-300",
  AHEAD: "border-zinc-300 bg-white text-zinc-700 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-300",
};

function StatusChip({ label, tone }: { label: string; tone: JumpStatusTone }) {
  return (
    <span
      data-jump-status-chip
      data-jump-status-tone={tone}
      className={`shrink-0 rounded-full border px-1.5 py-px text-[10px] font-semibold whitespace-nowrap ${TONE_CLASS[tone]}`}
    >
      {label}
    </span>
  );
}

export default function ExecutionStepsPanel({
  query,
  onQueryChange,
  search,
  onHitSelect,
  chosen,
  onClearChoice,
  button,
  onJump,
  onCancel,
  errorMessage,
  graphSlot,
}: {
  query: string;
  onQueryChange: (query: string) => void;
  search: JumpNodeSearchResult;
  /** 검색 결과 한 줄을 눌렀다 — 부모가 그림을 그 노드로 옮기고 「고른 것」으로 세운다. */
  onHitSelect: (hit: JumpNodeHit) => void;
  chosen: JumpNodeHit | null;
  onClearChoice: () => void;
  button: JumpButtonState;
  onJump: () => void;
  onCancel: () => void;
  errorMessage: string | null;
  graphSlot: React.ReactNode;
}) {
  return (
    <div className="mt-3 flex flex-col gap-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <label htmlFor="execution-steps-search" className="w-12 shrink-0 text-xs text-zinc-500 dark:text-zinc-400">
          검색
        </label>
        <input
          id="execution-steps-search"
          type="search"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="작업 이름으로 찾기 (예: MCU)"
          className="w-full rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-900 sm:flex-1 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
        />
        {query.trim().length > 0 && (
          <span className="shrink-0 text-xs text-zinc-500 dark:text-zinc-400">맞는 작업 {search.matchCount}개</span>
        )}
      </div>

      {query.trim().length > 0 && (
        <div className="max-h-44 overflow-y-auto rounded-md border border-zinc-200 dark:border-zinc-800">
          {search.hits.length === 0 ? (
            <p className="px-3 py-2 text-xs text-zinc-500 dark:text-zinc-400">일치하는 작업이 없습니다.</p>
          ) : (
            <ul>
              {search.hits.map((hit) => (
                <li key={hit.node.id}>
                  {/* 🔵 **못 옮기는 줄도 누를 수 있다.** 누르면 그림이 그리로 날아가고
                      아래 줄에 왜 못 옮기는지가 적힌다 — 아예 못 누르게 하면 어디에
                      있는 작업인지 확인할 길까지 함께 막힌다. 막는 것은 단추다. */}
                  <button
                    type="button"
                    onClick={() => onHitSelect(hit)}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
                  >
                    <StatusChip label={hit.mark.label} tone={hit.mark.tone} />
                    <span className="min-w-0 flex-1 truncate font-medium">
                      {hit.node.orderIndex > 0 ? `${hit.node.orderIndex}. ` : ""}
                      {hit.title}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {search.truncated && (
            <p className="border-t border-zinc-200 px-3 py-1.5 text-xs text-zinc-400 dark:border-zinc-800 dark:text-zinc-600">
              맞는 작업이 많아 {search.hits.length}개만 보입니다. 검색어를 더 적어 주세요.
            </p>
          )}
        </div>
      )}

      {/* 상태 범례. 🔴 다섯을 손으로 적지 않고 **상태 목록 그대로** 돈다 — 상태가
          하나 늘어난 날 범례만 옛것으로 남는 자리를 안 만든다. 그림의 칸에 붙는
          딱지가 이 색 그대로다. */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs text-zinc-500 dark:text-zinc-400">상태</span>
        {PROCEDURE_CASE_EXECUTION_NODE_STATUS_CODES.map((status) => {
          const mark = toJumpStatusMark(status);
          return <StatusChip key={status} label={mark.label} tone={mark.tone} />;
        })}
      </div>

      {graphSlot}

      <div className="flex flex-col gap-2 border-t border-zinc-200 pt-3 sm:flex-row sm:items-center sm:justify-between dark:border-zinc-800">
        <p className="min-w-0 text-xs text-zinc-600 dark:text-zinc-400">
          {chosen === null ? (
            <span className="text-zinc-500 dark:text-zinc-400">
              고른 것 없음 — 그림에서 작업을 누르면 「지금 할 일」을 그리로 옮길 수 있습니다.
            </span>
          ) : (
            <>
              <span className="text-zinc-500 dark:text-zinc-400">고른 것: </span>
              <span className="font-medium text-zinc-900 dark:text-zinc-50">
                {chosen.node.orderIndex > 0 ? `${chosen.node.orderIndex}. ` : ""}
                {chosen.title}
              </span>
              <span className="ml-1 text-zinc-500 dark:text-zinc-400">({chosen.mark.label})</span>
              <button
                type="button"
                onClick={onClearChoice}
                className="ml-2 rounded border border-zinc-300 px-1.5 py-0.5 text-[11px] text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
              >
                고른 것 지우기
              </button>
            </>
          )}
        </p>
        <div className="flex shrink-0 justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            닫기
          </button>
          <button
            type="button"
            onClick={onJump}
            disabled={button.disabled}
            title={button.hint ?? undefined}
            className="rounded-md bg-primary-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-800 disabled:opacity-50 dark:bg-primary-50 dark:text-zinc-900 dark:hover:bg-primary-200"
          >
            {button.label}
          </button>
        </div>
      </div>

      {/* 🔴 못 누르는 까닭은 **글자로도** 적는다. 폰에는 「올려 두기」가 없어
          title 만으로는 영영 안 보인다(2026-11-02 결정 — 단추 뜻은 올려 두면 뜨되
          확인 창의 설명은 남긴다). */}
      {button.hint && <p className="text-right text-xs text-zinc-500 dark:text-zinc-400">{button.hint}</p>}
      {errorMessage && <p className="text-xs text-red-600 dark:text-red-400">{errorMessage}</p>}
    </div>
  );
}
