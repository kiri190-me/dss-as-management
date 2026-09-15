"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import type { ImportedCaseNeedingBillingReview } from "@/lib/db/queries/kyosan-intake-import";
import { billingTypeLabels } from "@/lib/domain/types";
import type { KyosanChunkRowResult } from "@/lib/server/services/kyosan-intake-import";
import { KYOSAN_SECTION_CLASS, KYOSAN_TH_CLASS, KyosanFailureNotice } from "./KyosanImportPreviewParts";
import {
  KYOSAN_UPLOAD_MAX_BYTES,
  formatKstDate,
  kyosanImportConfirmLines,
  kyosanRunProgress,
  repairCaseHref,
  type KyosanResultSummary,
  type KyosanRunPhase,
  type KyosanRunState,
} from "./kyosan-import-view-model";

/**
 * ============================================================================
 * 과거 인수품 가져오기 — 올리기 · 가져오기 · 결과를 그리기만 하는 조각
 * ============================================================================
 * 상태와 서버 호출은 KyosanIntakeImportScreen.tsx 가 갖는다. 여기는 받은 값을 그리고
 * 단추 누름을 위로 올릴 뿐이다(KyosanImportParts.test.tsx 가 그려 본다).
 * ============================================================================
 */

const PRIMARY_BUTTON_CLASS =
  "rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200";
const SECONDARY_BUTTON_CLASS =
  "rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800";
const LINK_CLASS = "font-medium text-zinc-900 underline underline-offset-2 hover:text-zinc-600 dark:text-zinc-100 dark:hover:text-zinc-300";

const MAX_MB = Math.round(KYOSAN_UPLOAD_MAX_BYTES / (1024 * 1024));

// ── 1. 올리기 ─────────────────────────────────────────────────────────────

export function KyosanUploadPanel({
  hasFile,
  fileError,
  busy,
  disabled,
  onFileChange,
  onPreview,
}: {
  hasFile: boolean;
  fileError: string | null;
  /** 미리보기를 기다리는 중. */
  busy: boolean;
  /** 가져오는 중이라 파일을 바꿀 수 없다. */
  disabled: boolean;
  onFileChange: (file: File | null) => void;
  onPreview: () => void;
}) {
  const canPreview = hasFile && fileError === null && !busy && !disabled;
  return (
    <section className={KYOSAN_SECTION_CLASS}>
      <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">1. 파일 올리기</h2>
      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
        {`교산 인수품 리스트(.xlsx, ${MAX_MB}MB 이하)를 골라 [미리보기]를 누르세요. 미리보기는 아무것도 저장하지 않습니다.`}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <label htmlFor="kyosan-import-file" className="sr-only">
          교산 인수품 리스트 파일
        </label>
        <input
          id="kyosan-import-file"
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          disabled={busy || disabled}
          onChange={(event) => onFileChange(event.target.files?.[0] ?? null)}
          className="block w-full max-w-full text-sm text-zinc-700 file:mr-3 file:rounded-md file:border file:border-zinc-300 file:bg-white file:px-3 file:py-1.5 file:text-sm file:text-zinc-700 hover:file:bg-zinc-100 disabled:opacity-50 sm:w-auto dark:text-zinc-300 dark:file:border-zinc-700 dark:file:bg-zinc-900 dark:file:text-zinc-300"
        />
        <button
          type="button"
          data-role="kyosan-preview"
          disabled={!canPreview}
          aria-busy={busy}
          onClick={onPreview}
          className={PRIMARY_BUTTON_CLASS}
        >
          {busy ? "읽는 중..." : "미리보기"}
        </button>
      </div>
      {fileError ? (
        <p role="alert" className="mt-2 text-xs text-red-600 dark:text-red-400">
          {fileError}
        </p>
      ) : null}
    </section>
  );
}

// ── 3. 가져오기 ───────────────────────────────────────────────────────────

export function KyosanImportBar({
  importableCount,
  chunkSize,
  disabled,
  onRequestImport,
}: {
  importableCount: number;
  chunkSize: number;
  disabled: boolean;
  onRequestImport: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        data-role="kyosan-import"
        disabled={disabled || importableCount === 0}
        onClick={onRequestImport}
        className={PRIMARY_BUTTON_CLASS}
      >
        {`가져오기 ${importableCount}건`}
      </button>
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        {importableCount === 0
          ? "가져올 줄이 없습니다."
          : `「가져올 것」 줄만 ${chunkSize}줄씩 차례로 보냅니다. 확인 필요 · 이미 있음 · 제외 줄은 보내지 않습니다.`}
      </p>
    </div>
  );
}

/** 붙을 때 showModal, 떨어질 때 close — 부르는 쪽이 열 때만 붙인다(UserDeletionParts 와 같다). */
function useShowModalOnMount() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      if (dialog?.open) dialog.close();
    };
  }, []);
  return dialogRef;
}

export function KyosanImportConfirmDialogView({
  count,
  chunkSize,
  onConfirm,
  onCancel,
}: {
  count: number;
  chunkSize: number;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const dialogRef = useShowModalOnMount();
  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="kyosan-import-confirm-title"
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
      className="m-auto w-full max-w-md rounded-lg border border-zinc-200 bg-white p-4 text-zinc-900 backdrop:bg-black/40 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50"
    >
      <h2 id="kyosan-import-confirm-title" className="text-sm font-semibold">
        {`과거 인수품 ${count}건을 가져옵니다`}
      </h2>
      <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-zinc-800 dark:text-zinc-200">
        {kyosanImportConfirmLines(count, chunkSize).map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
        <button type="button" onClick={onCancel} className={SECONDARY_BUTTON_CLASS}>
          취소
        </button>
        <button type="button" data-role="kyosan-import-confirm" onClick={onConfirm} className={PRIMARY_BUTTON_CLASS}>
          {`${count}건 가져오기`}
        </button>
      </div>
    </dialog>
  );
}

const PHASE_TEXT: Record<KyosanRunPhase, string> = {
  running: "가져오는 중입니다 — 끝날 때까지 이 페이지를 떠나지 마세요.",
  pausing: "지금 보내는 조각이 끝나면 멈춥니다...",
  paused: "멈췄습니다. [이어서 가져오기]를 누르면 다음 조각부터 보냅니다.",
  failed: "조각 하나가 실패해 멈췄습니다.",
  done: "모두 보냈습니다. 아래 결과를 확인해 주세요.",
};

export function KyosanImportProgressView({
  state,
  onPause,
  onResume,
  onRetry,
  onReset,
}: {
  state: KyosanRunState;
  onPause: () => void;
  onResume: () => void;
  onRetry: () => void;
  onReset: () => void;
}) {
  const progress = kyosanRunProgress(state);
  const retryable = state.phase === "failed" && state.failure?.retryable === true;
  const barClass =
    state.phase === "failed" ? "bg-red-500" : state.phase === "done" ? "bg-emerald-500" : "bg-zinc-900 dark:bg-zinc-100";

  return (
    <div data-role="kyosan-progress" data-phase={state.phase} className="flex flex-col gap-2">
      <div
        role="progressbar"
        aria-label="가져오기 진행"
        aria-valuemin={0}
        aria-valuemax={progress.totalRows}
        aria-valuenow={progress.sentRows}
        className="h-2 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800"
      >
        <div className={`h-full ${barClass}`} style={{ width: `${progress.percent}%` }} />
      </div>
      <p className="text-sm tabular-nums text-zinc-800 dark:text-zinc-200">
        {`${progress.sentRows} / ${progress.totalRows}줄 보냄 (${progress.percent}%) · 조각 ${progress.sentChunks} / ${progress.totalChunks}`}
      </p>
      <p className="text-xs text-zinc-500 dark:text-zinc-400">{PHASE_TEXT[state.phase]}</p>
      {state.failure ? <KyosanFailureNotice failure={state.failure} /> : null}
      <div className="flex flex-wrap gap-2">
        {state.phase === "running" ? (
          <button type="button" data-role="kyosan-pause" onClick={onPause} className={SECONDARY_BUTTON_CLASS}>
            멈춤
          </button>
        ) : null}
        {state.phase === "pausing" ? (
          <button type="button" data-role="kyosan-resume" onClick={onResume} className={SECONDARY_BUTTON_CLASS}>
            멈추지 않고 계속
          </button>
        ) : null}
        {state.phase === "paused" ? (
          <button type="button" data-role="kyosan-resume" onClick={onResume} className={PRIMARY_BUTTON_CLASS}>
            이어서 가져오기
          </button>
        ) : null}
        {retryable ? (
          <button type="button" data-role="kyosan-retry" onClick={onRetry} className={PRIMARY_BUTTON_CLASS}>
            다시 시도
          </button>
        ) : null}
        {state.phase === "done" || (state.phase === "failed" && !retryable) ? (
          <button type="button" data-role="kyosan-reset" onClick={onReset} className={SECONDARY_BUTTON_CLASS}>
            다른 파일 올리기
          </button>
        ) : null}
      </div>
    </div>
  );
}

// ── 4. 결과 ───────────────────────────────────────────────────────────────

/** 만든 건이 이보다 많으면 목록을 접어 둔다. */
const CREATED_OPEN_LIMIT = 25;

function ResultGroup({
  group,
  title,
  items,
  danger,
  open,
  linkCases,
}: {
  group: string;
  title: string;
  items: readonly KyosanChunkRowResult[];
  danger: boolean;
  open: boolean;
  linkCases: boolean;
}) {
  if (items.length === 0) return null;
  return (
    <details open={open} data-group={group} className="rounded-md border border-zinc-200 dark:border-zinc-800">
      <summary
        className={`cursor-pointer px-3 py-2 text-sm font-medium ${
          danger ? "text-red-700 dark:text-red-400" : "text-zinc-800 dark:text-zinc-200"
        }`}
      >
        {`${title} ${items.length}건`}
      </summary>
      <ul className="max-h-80 space-y-1 overflow-y-auto border-t border-zinc-200 px-3 py-2 text-xs dark:border-zinc-800">
        {items.map((item) => (
          <li key={item.rowNumber} className="break-words text-zinc-800 dark:text-zinc-200">
            <span className="tabular-nums text-zinc-500 dark:text-zinc-400">{`행 ${item.rowNumber} · `}</span>
            {linkCases && item.repairCaseId ? (
              <Link href={repairCaseHref(item.repairCaseId)} className={LINK_CLASS}>
                {item.intakeNumber ?? "수리 건"}
              </Link>
            ) : (
              <span className="font-medium">{item.intakeNumber ?? "인수번호 없음"}</span>
            )}
            {item.message ? <span className="text-zinc-600 dark:text-zinc-400">{` — ${item.message}`}</span> : null}
          </li>
        ))}
      </ul>
    </details>
  );
}

export function KyosanImportResultView({ summary, finished }: { summary: KyosanResultSummary; finished: boolean }) {
  return (
    <section data-role="kyosan-result" className={KYOSAN_SECTION_CLASS}>
      <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{finished ? "4. 결과" : "4. 결과 (지금까지)"}</h2>
      <p data-role="kyosan-result-totals" className="mt-1 text-sm tabular-nums text-zinc-800 dark:text-zinc-200">
        {`만듦 ${summary.created.length} · 이미 있음 ${summary.alreadyExists.length} · 건너뜀 ${summary.skipped.length} · 실패 ${summary.failed.length} · 합계 ${summary.total}건`}
      </p>
      <div className="mt-3 flex flex-col gap-2">
        <ResultGroup group="failed" title="실패" items={summary.failed} danger open linkCases={false} />
        <ResultGroup group="skipped" title="건너뜀" items={summary.skipped} danger={false} open linkCases={false} />
        <ResultGroup group="already-exists" title="이미 있음" items={summary.alreadyExists} danger={false} open linkCases={false} />
        <ResultGroup
          group="created"
          title="만든 건"
          items={summary.created}
          danger={false}
          open={summary.created.length <= CREATED_OPEN_LIMIT}
          linkCases
        />
      </div>
    </section>
  );
}

// ── 유/무상 확인 필요 목록 ───────────────────────────────────────────────────

export function KyosanBillingReviewList({ items }: { items: readonly ImportedCaseNeedingBillingReview[] }) {
  return (
    <section data-role="billing-review-list" className={KYOSAN_SECTION_CLASS}>
      <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{`유/무상 확인 필요 (${items.length}건)`}</h2>
      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
        과거 인수품 가져오기로 들어온 건 가운데 원본 費用 칸이 有償 · 無償 이 아니어서 유상으로 가져왔고, 그 뒤 유/무상
        결정 기록이 아직 없는 건입니다. 휴지통의 건은 빠집니다.
      </p>
      {items.length === 0 ? (
        <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">확인할 건이 없습니다.</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[36rem] border-collapse text-sm text-zinc-900 dark:text-zinc-100">
            <thead>
              <tr>
                <th scope="col" className={KYOSAN_TH_CLASS}>인수번호</th>
                <th scope="col" className={KYOSAN_TH_CLASS}>지금 유/무상</th>
                <th scope="col" className={KYOSAN_TH_CLASS}>원본 費用</th>
                <th scope="col" className={KYOSAN_TH_CLASS}>원본 행</th>
                <th scope="col" className={KYOSAN_TH_CLASS}>가져온 날</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.repairCaseId} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800">
                  <td className="px-3 py-2">
                    <Link href={repairCaseHref(item.repairCaseId)} className={LINK_CLASS}>
                      {item.intakeNumber}
                    </Link>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">{item.billingType ? billingTypeLabels[item.billingType] : "—"}</td>
                  <td className="px-3 py-2">{item.sourceBilling ?? "비어 있음"}</td>
                  <td className="px-3 py-2 tabular-nums">{item.sourceRowNumber ?? "—"}</td>
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums">{formatKstDate(item.importedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
