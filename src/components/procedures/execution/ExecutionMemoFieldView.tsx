"use client";

import type { MemoFieldState } from "@/lib/domain/procedure-execution-memo-field";

/**
 * 작업 메모 칸이 **그려지는 모습**(2026-11-03, 조각 12). 상태도 서버 액션도 안
 * 들고 있다 — 그것은 ExecutionMemoField 의 몫이고, 이 묶음은 받은 값만 그린다.
 *
 * 🔴 가른 까닭은 **그려서 재려고**다. 서버 액션을 직접 import 하는 부품은
 * test:components 에서 import 가 바로 던진다(「전체 단계 보기」 창이 속과 껍데기를
 * 가른 것과 같은 수법 — ExecutionStepsPanel 머리말). 「[수정]을 눌러야 고쳐진다」는
 * 화면에서만 드러나는 규칙이라 반드시 그려서 재야 한다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 🔴 평소에는 **글자**다 (2026-11-03 사용자 결정)
 * ──────────────────────────────────────────────────────────────────────
 * 「지금은 [실행 이력]에 작업메모가 언제든 수정할 수 있도록 되어 있는데,
 *  [수정]버튼을 누르고서 수정할 수 있도록 해줘.」
 *
 * 그래서 칸(textarea)은 고치는 중에만 그린다. 🔵 **못 고치는 사람에게도 글자는
 * 보인다** — 메모는 읽을 거리이고, 가리면 그 사람에게는 작업 메모가 아예 없는
 * 화면이 된다. 막는 것은 [수정] 단추다.
 */

/**
 * 글자 크기 두 벌. 「지금 할 일」 큰 카드는 본문 크기(MD), 작은 카드와 실행
 * 이력의 끝난 줄은 잔글씨(SM) — 전에 두 카드가 각자 쓰던 크기 그대로다.
 */
const SIZE_CLASS = {
  SM: { label: "text-[11px]", body: "text-xs", button: "px-2.5 py-1 text-xs", rows: 2 },
  MD: { label: "text-xs", body: "text-sm", button: "px-3 py-1.5 text-sm", rows: 3 },
} as const;

export type ExecutionMemoFieldSize = keyof typeof SIZE_CLASS;

export default function ExecutionMemoFieldView({
  fieldId,
  field,
  savedMemo,
  eligible,
  isSubmitting,
  errorMessage,
  size = "MD",
  onEdit,
  onDraftChange,
  onSave,
  onCancel,
}: {
  /** textarea 와 label 을 잇는 id. 한 화면에 칸이 여럿이라 노드마다 달라야 한다. */
  fieldId: string;
  field: MemoFieldState;
  /** DB 에 저장돼 있는 메모. 평소에 보이는 글자가 이것이다. */
  savedMemo: string | null;
  /** 고칠 수 있는 사람인가. 서버도 같은 문턱으로 다시 판정한다. */
  eligible: boolean;
  isSubmitting: boolean;
  errorMessage: string | null;
  size?: ExecutionMemoFieldSize;
  onEdit: () => void;
  onDraftChange: (draft: string) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const cls = SIZE_CLASS[size];

  return (
    <div data-memo-field className="flex flex-col gap-1">
      <label htmlFor={fieldId} className={`${cls.label} text-zinc-500 dark:text-zinc-400`}>
        작업 메모
      </label>

      {field.isEditing ? (
        <>
          <textarea
            id={fieldId}
            rows={cls.rows}
            value={field.draft}
            onChange={(event) => onDraftChange(event.target.value)}
            className={`w-full rounded-md border border-zinc-200 bg-white px-2 py-1 ${cls.body} text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50`}
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              data-memo-save
              onClick={onSave}
              disabled={isSubmitting}
              className={`w-fit rounded-md bg-primary-900 ${cls.button} font-medium text-white hover:bg-primary-800 disabled:opacity-50 dark:bg-primary-50 dark:text-zinc-900 dark:hover:bg-primary-200`}
            >
              저장
            </button>
            <button
              type="button"
              data-memo-cancel
              onClick={onCancel}
              disabled={isSubmitting}
              className={`w-fit rounded-md border border-zinc-300 ${cls.button} text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800`}
            >
              취소
            </button>
          </div>
        </>
      ) : (
        <>
          {/* 🔵 줄바꿈을 지켜 그린다 — 작업 메모는 여러 줄로 적힌다(실행 이력의
              지운 메모 줄과 같은 잣대). 비어 있으면 **빈 자리를 남기지 않고**
              그렇다고 적는다 — 빈 네모는 「칸이 깨졌나」로 읽힌다. */}
          <p
            id={fieldId}
            data-memo-view
            className={
              savedMemo === null
                ? `${cls.body} text-zinc-400 dark:text-zinc-500`
                : `whitespace-pre-wrap ${cls.body} text-zinc-700 dark:text-zinc-300`
            }
          >
            {savedMemo ?? "작성된 작업 메모가 없습니다."}
          </p>
          {eligible && (
            <button
              type="button"
              data-memo-edit
              onClick={onEdit}
              disabled={isSubmitting}
              className={`w-fit rounded-md border border-zinc-300 ${cls.button} text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800`}
            >
              수정
            </button>
          )}
        </>
      )}

      {errorMessage && <p className={`${cls.body} text-red-600 dark:text-red-400`}>{errorMessage}</p>}
    </div>
  );
}
