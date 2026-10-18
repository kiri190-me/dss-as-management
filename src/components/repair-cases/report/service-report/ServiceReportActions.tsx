"use client";

import Link from "next/link";

/**
 * ============================================================================
 * 보고서 화면 **맨 위** 단추 줄 — 취소 · 저장 · 미리보기 · 내려받기 · 지우기
 * ============================================================================
 * 🔴 **자리가 「보고서 종류」 위다** (2026-10-19 사용자 요구: 「그 버튼들을 [보고서
 * 종류] 창 위에 위치하도록 해줘」). 예전에는 폼 맨 아래였다 — 본문이 길어지면
 * [저장]을 누르러 스무 줄을 내려가야 했다. 그리는 것은 이 조각이고 **자리를 정하는
 * 것은 `ServiceReportForm` 의 차례**다.
 *
 * 문턱이 서로 다르다(`auth/service-report-authorization.ts`):
 *
 *   · 취소            없음  — 아무것도 보내지 않는다. 화면을 떠나는 일이다
 *   · 저장            WRITE
 *   · 저장본 인쇄     READ  — 이미 저장된 값을 보여 줄 뿐이다
 *   · 전체 미리보기   WRITE — 🔴 **보내는 사람이 문서 내용을 그 자리에서 짓는다.**
 *                            내려받기와 같은 일이라 같은 문턱이다(그 통로의 '왜
 *                            READ 가 아니라 WRITE 인가')
 *   · 내려받기        WRITE — 내려받기 라우트가 이미 그렇게 막는다
 *   · 지우기          MANAGE
 *
 * 🔴 **여기서 감추는 것은 경계가 아니다.** 권한 판정은 서버 액션과 라우트 안에서
 * 매번 다시 한다 — 이 조각이 하는 일은 "누를 수 없는 단추를 보여 주지 않는 것"
 * 뿐이다. 단추를 감췄다고 그 조작이 막힌 것이 아니다.
 *
 * 지우기를 왼쪽 끝에 따로 떼어 둔 것은 자리를 채우려는 것이 아니다 — 저장 옆에
 * 붙여 두면 저장하려다 지우는 손이 나온다.
 *
 * ── 🔴 [전체 미리보기]는 **저장하지 않은 값으로도** 돈다 (2026-10-19) ────
 * 예전에는 미리보기가 저장된 장에만 붙는 **링크**였다 — 미리보기 화면이 주소(보고서
 * id)로 열리고 DB 에 저장된 값을 그렸기 때문이다. 그래서 저장 전에는 단추가 아예
 * 없었고, 저장한 뒤 고치면 **옛 내용**이 보였다. 사용자 요구가 바로 그것이었다:
 * 「저장을 누르지 않은 채 미리보기를 눌렀을 때에 수정한 내용이 반영되도록.」
 *
 * 이제 단추를 누르면 화면이 **지금 폼의 값**을 서버에 보내고
 * (`POST …/service-report/preview-grid`), 돌려받은 문서를 그 자리에서 창으로 띄운다
 * (`ServiceReportDocumentPreviewDialog`). 새 탭이 열리지 않는다.
 *
 *   · 🔴 **막는 조건은 [Excel 내려받기]와 같다**(`canDownload`) — 둘 다 «지금 값으로
 *     문서를 짓는» 일이라, 한쪽만 되면 반쪽짜리 문서를 보여 주고 사람이 그것을
 *     결과물로 믿는다. 못 누를 때 까닭을 적는 자리도 같다(`hint`).
 *   · **저장된 장에는 [저장본 인쇄 · PDF]가 함께 붙는다** — 인쇄 · PDF 로 저장은
 *     그 화면의 일이다(저장 전 창에서 인쇄하면 뒤에 깔린 작성 화면까지 딸려 나가고,
 *     저장하지 않은 문서가 종이로 나가 결과물로 믿긴다).
 *
 * ── 🔴 [취소]는 [저장] **바로 왼쪽**이다 (2026-10-19) ────────────────────
 * 사용자가 그렇게 짚었다. 짝이 되는 두 단추라 사이에 다른 것을 끼우지 않는다 —
 * 「이 화면을 끝내는 길은 둘」이라는 것이 자리로 읽혀야 한다.
 *
 * 🔴 **저장 권한이 없어도 나온다.** [저장]은 WRITE 가 있어야 보이지만, 나가는 길은
 * 누구에게나 있어야 한다 — 읽기만 할 수 있는 사람이 이 화면에 갇히면 안 된다.
 * 🔴 **바쁠 때도 잠그지 않는다.** 저장 · 미리보기가 도는 동안 눌리지 않으면 서버가
 * 느린 그 순간 사람이 화면에 묶인다. 눌렀을 때 무엇을 묻고 어디로 보낼지는 부르는
 * 쪽이 정한다(`ServiceReportForm` 의 `handleLeave`).
 * ============================================================================
 */

export default function ServiceReportActions({
  mode,
  canEdit,
  canDelete,
  isSaving,
  isDownloading,
  isPreviewing,
  canSave,
  canDownload,
  savedPrintHref,
  hint,
  onCancel,
  onSave,
  onPreview,
  onDownload,
  onDelete,
}: {
  /** 새 장을 적는 중인가(`NEW`), 저장된 장을 고치는 중인가(`SAVED`). */
  mode: "NEW" | "SAVED";
  canEdit: boolean;
  canDelete: boolean;
  isSaving: boolean;
  isDownloading: boolean;
  /** 미리보기 문서를 서버에 만들러 보낸 중인가. */
  isPreviewing: boolean;
  canSave: boolean;
  /**
   * 지금 값으로 문서를 지을 수 있는가. 🔴 **[전체 미리보기]와 [Excel 내려받기]가
   * 이 하나를 함께 쓴다** — 위 '막는 조건은 같다'.
   */
  canDownload: boolean;
  /**
   * **저장된 장**의 인쇄 화면 주소. 아직 저장하지 않았으면 null — 그 화면은 DB 에
   * 저장된 값을 그리므로 가리킬 id 가 없다.
   */
  savedPrintHref: string | null;
  /** 지금 왜 못 누르는지 한 줄. 없으면 null. */
  hint: string | null;
  /**
   * 🔴 **저장하지 않고 「보고서」 탭으로 나간다.** 고친 것이 있으면 묻는 일까지
   * 부르는 쪽의 몫이다 — 이 조각은 자리만 안다.
   */
  onCancel: () => void;
  onSave: () => void;
  onPreview: () => void;
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
            disabled={isSaving || isDownloading || isPreviewing}
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

        {/* 🔴 저장된 장에만 붙는다 — 그 화면은 DB 에 저장된 값을 그린다. 인쇄 ·
            PDF 로 저장이 그 화면의 일이다(위 머리말). */}
        {savedPrintHref !== null && (
          <Link
            href={savedPrintHref}
            className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            저장본 인쇄 · PDF
          </Link>
        )}

        {/* 🔴 저장 전에도 눌린다 — 지금 폼의 값으로 문서를 지어 창으로 띄운다. */}
        <button
          type="button"
          onClick={onPreview}
          disabled={!canDownload}
          aria-busy={isPreviewing}
          className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
        >
          {isPreviewing ? "만드는 중…" : "전체 미리보기"}
        </button>

        {/* 🔴 [저장] 바로 왼쪽. 권한이 없어도 · 바쁜 중에도 나가는 길은 열려 있다
            (위 머리말). 묻는 것은 부르는 쪽이 한다. */}
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
        >
          취소
        </button>

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
          className="rounded-md bg-primary-900 px-4 py-2 text-sm font-medium text-white hover:bg-primary-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-primary-50 dark:text-zinc-900 dark:hover:bg-primary-200"
        >
          {isDownloading ? "만드는 중…" : "Excel 내려받기"}
        </button>
      </div>
    </div>
  );
}
