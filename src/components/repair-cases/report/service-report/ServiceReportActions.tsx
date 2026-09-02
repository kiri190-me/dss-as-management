"use client";

/**
 * ============================================================================
 * 보고서 화면 아래 단추 줄 — 저장 · 내려받기 · 지우기
 * ============================================================================
 * 셋의 문턱이 서로 다르다(`auth/service-report-authorization.ts`):
 *
 *   · 저장     WRITE
 *   · 내려받기 WRITE — 내려받기 라우트가 이미 그렇게 막는다
 *   · 지우기   MANAGE
 *
 * 🔴 **여기서 감추는 것은 경계가 아니다.** 권한 판정은 서버 액션과 라우트 안에서
 * 매번 다시 한다 — 이 조각이 하는 일은 "누를 수 없는 단추를 보여 주지 않는 것"
 * 뿐이다. 단추를 감췄다고 그 조작이 막힌 것이 아니다.
 *
 * 지우기를 왼쪽 끝에 따로 떼어 둔 것은 자리를 채우려는 것이 아니다 — 저장 옆에
 * 붙여 두면 저장하려다 지우는 손이 나온다.
 * ============================================================================
 */

export default function ServiceReportActions({
  mode,
  canEdit,
  canDelete,
  isSaving,
  isDownloading,
  canSave,
  canDownload,
  hint,
  onSave,
  onDownload,
  onDelete,
}: {
  /** 새 장을 적는 중인가(`NEW`), 저장된 장을 고치는 중인가(`SAVED`). */
  mode: "NEW" | "SAVED";
  canEdit: boolean;
  canDelete: boolean;
  isSaving: boolean;
  isDownloading: boolean;
  canSave: boolean;
  canDownload: boolean;
  /** 지금 왜 못 누르는지 한 줄. 없으면 null. */
  hint: string | null;
  onSave: () => void;
  onDownload: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div>
        {/* 저장된 장을 열었을 때만 나온다 — 아직 저장하지 않은 장에는 지울 것이 없다. */}
        {mode === "SAVED" && canDelete && (
          <button
            type="button"
            onClick={onDelete}
            disabled={isSaving || isDownloading}
            className="rounded-md border border-red-300 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950"
          >
            지우기
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-end gap-3">
        {hint !== null && (
          <p className="text-xs text-zinc-500 dark:text-zinc-400">{hint}</p>
        )}

        {canEdit && (
          <button
            type="button"
            onClick={onSave}
            disabled={!canSave}
            aria-busy={isSaving}
            className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            {isSaving ? "저장 중…" : mode === "SAVED" ? "저장" : "저장하기"}
          </button>
        )}

        <button
          type="button"
          onClick={onDownload}
          disabled={!canDownload}
          aria-busy={isDownloading}
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          {isDownloading ? "만드는 중…" : "Excel 내려받기"}
        </button>
      </div>
    </div>
  );
}
