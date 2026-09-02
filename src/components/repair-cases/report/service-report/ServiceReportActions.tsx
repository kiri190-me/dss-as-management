"use client";

import Link from "next/link";

/**
 * ============================================================================
 * 보고서 화면 아래 단추 줄 — 저장 · 미리보기 · 내려받기 · 지우기
 * ============================================================================
 * 넷의 문턱이 서로 다르다(`auth/service-report-authorization.ts`):
 *
 *   · 저장       WRITE
 *   · 미리보기   READ — 이미 저장된 값을 보여 줄 뿐이다
 *   · 내려받기   WRITE — 내려받기 라우트가 이미 그렇게 막는다
 *   · 지우기     MANAGE
 *
 * 🔴 **여기서 감추는 것은 경계가 아니다.** 권한 판정은 서버 액션과 라우트 안에서
 * 매번 다시 한다 — 이 조각이 하는 일은 "누를 수 없는 단추를 보여 주지 않는 것"
 * 뿐이다. 단추를 감췄다고 그 조작이 막힌 것이 아니다.
 *
 * 지우기를 왼쪽 끝에 따로 떼어 둔 것은 자리를 채우려는 것이 아니다 — 저장 옆에
 * 붙여 두면 저장하려다 지우는 손이 나온다.
 *
 * ── 🔴 미리보기는 **저장된 장에만** 붙는다 ──────────────────────────────
 * 미리보기 화면은 주소(보고서 id)로 열리고 **DB 에 저장된 값**을 그린다. 아직
 * 저장하지 않은 장에는 가리킬 id 가 없다. 견적서 미리보기는 폼 위에 겹쳐 뜨는
 * 방식이라 저장 전에도 열 수 있었지만, 여기서는 그럴 수 없다 — 보고서 미리보기는
 * «채우개가 만든 시트를 읽는» 방식이라 서버가 문서를 한 번 만들어야 한다
 * (`report/service-report/print/page.tsx`). 그러니 링크 하나로 두고, 없을 때는
 * 왜 없는지를 그 자리에 적는다(회색 단추만 두면 "왜 안 눌리지"가 된다).
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
  previewHref,
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
  /**
   * 미리보기 화면의 주소. **아직 저장하지 않은 장이면 null** — 위 '미리보기는
   * 저장된 장에만 붙는다'.
   */
  previewHref: string | null;
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

        {previewHref === null ? (
          <span className="text-xs text-zinc-500 dark:text-zinc-400">
            미리보기는 저장한 뒤에 볼 수 있습니다
          </span>
        ) : (
          <Link
            href={previewHref}
            className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            미리보기
          </Link>
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
