"use client";

/**
 * ============================================================================
 * 저장 충돌 — 적어 둔 글을 잃지 않게
 * ============================================================================
 * 두 사람이 같은 보고서를 열어 두면 나중 사람이 CONFLICT 를 받는다
 * (`mutations/service-reports.ts` 의 낙관적 잠금). 그때 화면이 그냥 "다시
 * 불러오세요"라고만 하면, 다시 불러오는 순간 **방금 친 글이 통째로 사라진다.**
 * 확인내용·조치는 한 장에 수백 줄까지 가는 칸이다.
 *
 * 그래서 얼리기 직전에 "저장하려던 값"에서 **사람이 직접 타이핑한 글만** 골라
 * (`domain/edit-draft-text.ts` 의 `SERVICE_REPORT_DRAFT_LABELS`) 여기 읽기 전용
 * 상자에 담는다. 수리 건 편집 폼 셋이 하는 것과 **같은 판단**이다
 * (`detail/edit/useSectionEditSubmit.ts`).
 *
 * ── 🔴 상자는 「다시 불러오기」 뒤에도 남는다 ───────────────────────────
 * 이 화면이 본보기와 다른 점이다. 편집 폼은 다시 불러오면 폼이 언마운트되면서
 * 상자도 함께 사라지는데, 그쪽은 잃는 글이 몇 줄이라 그래도 괜찮았다. 여기서는
 * 상자가 사라지는 순간이 곧 **수백 줄이 사라지는 순간**이다. 그래서 다시
 * 불러온 뒤에도 남겨 두고, 사람이 「옮겨 적었습니다」를 누를 때에만 치운다 —
 * 버리는 것은 언제나 사람의 손이어야 한다.
 * ============================================================================
 */

export default function ServiceReportConflictNotice({
  message,
  draftText,
  reloaded,
  onReload,
  onDismiss,
  disabled,
}: {
  /** 서버가 준 말. 무엇이 일어났는지는 저쪽이 정한다. */
  message: string;
  /** 저장하려던 값에서 고른, 사람이 친 글. 보여 줄 것이 없으면 빈 글자다. */
  draftText: string;
  /** 이미 「최신 내용 다시 불러오기」를 눌렀는가. */
  reloaded: boolean;
  onReload: () => void;
  /** 「옮겨 적었습니다」 — 이 상자를 치운다. */
  onDismiss: () => void;
  disabled?: boolean;
}) {
  return (
    <div
      role="alert"
      className="flex flex-col gap-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200"
    >
      <p>
        {reloaded
          ? "최신 내용을 불러왔습니다. 아래는 저장되지 못한 내용입니다 — 필요한 부분을 옮겨 적은 뒤 닫아 주세요."
          : message}
      </p>

      {/* 보여 줄 것이 없으면 상자를 아예 그리지 않는다 — 빈 상자는 무언가
          잘못된 것처럼 보인다(edit-draft-text.ts 의 같은 판단). */}
      {draftText !== "" && (
        <textarea
          readOnly
          value={draftText}
          rows={10}
          aria-label="저장되지 못한 내용"
          className="w-full resize-y rounded border border-amber-300 bg-white p-2 font-mono text-xs text-zinc-800 dark:border-amber-800 dark:bg-zinc-900 dark:text-zinc-200"
        />
      )}

      <div className="flex flex-wrap gap-2">
        {reloaded ? (
          <button
            type="button"
            onClick={onDismiss}
            className="rounded-md border border-amber-400 bg-white px-3 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100 dark:border-amber-700 dark:bg-transparent dark:text-amber-200 dark:hover:bg-amber-900"
          >
            옮겨 적었습니다 · 닫기
          </button>
        ) : (
          <button
            type="button"
            onClick={onReload}
            disabled={disabled}
            className="rounded-md bg-amber-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            최신 내용 다시 불러오기
          </button>
        )}
      </div>
    </div>
  );
}
