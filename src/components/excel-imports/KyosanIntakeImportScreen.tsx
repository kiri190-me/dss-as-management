"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { showSavePopup } from "@/components/common/SavePopup";
import Pagination from "@/components/repair-cases/Pagination";
import type { ImportedCaseNeedingBillingReview } from "@/lib/db/queries/kyosan-intake-import";
import {
  executeKyosanIntakeImportChunkAction,
  previewKyosanIntakeImportAction,
  type ExecuteKyosanIntakeImportChunkActionResult,
} from "@/lib/server/actions/kyosan-intake-import";
import type { KyosanPreviewResult } from "@/lib/server/services/kyosan-intake-import";
import {
  KyosanCountCards,
  KyosanFailureNotice,
  KyosanNewNamesPanel,
  KyosanPreviewTable,
  KYOSAN_SECTION_CLASS,
} from "./KyosanImportPreviewParts";
import {
  KyosanBillingReviewList,
  KyosanImportBar,
  KyosanImportConfirmDialogView,
  KyosanImportProgressView,
  KyosanImportResultView,
  KyosanUploadPanel,
} from "./KyosanImportRunParts";
import {
  DEFAULT_KYOSAN_ROW_FILTER,
  KYOSAN_DEFAULT_PAGE_SIZE,
  checkKyosanUploadFile,
  countKyosanBillingFlags,
  describeKyosanFailure,
  describeKyosanNetworkFailure,
  filterKyosanPreviewRows,
  importableKyosanRowNumbers,
  isKyosanRunActive,
  kyosanRunDoneMessage,
  nextKyosanChunk,
  paginateKyosanRows,
  pauseKyosanRun,
  recordKyosanChunkFailure,
  recordKyosanChunkSuccess,
  resumeKyosanRun,
  retryKyosanRun,
  settleKyosanPause,
  startKyosanRun,
  summarizeKyosanResults,
  type KyosanFailureText,
  type KyosanRowFilter,
  type KyosanRunState,
} from "./kyosan-import-view-model";

/**
 * ============================================================================
 * 과거 인수품 가져오기 — 올리기 → 미리보기 → 25줄씩 가져오기 → 결과 (S3)
 * ============================================================================
 * 판단은 kyosan-import-view-model.ts, 그리기는 KyosanImport*Parts.tsx 에 있다. 이 파일은
 * 상태를 들고 서버 액션 둘을 부르는 일만 한다(서버 액션을 부르므로 시험에서 그릴 수 없다).
 *
 * ── 🔴 조각은 차례로, 한 흐름만 ───────────────────────────────────────────────
 * 조각을 병렬로 보내지 않는다 — 한 조각의 답을 받은 뒤 다음 조각을 보낸다. [이어서]·[다시 시도]를
 * 두 번 눌러도 흐름이 둘 생기지 않게 loopRef 로 막는다. 흐름의 상태는 runRef 가 정본이고, 화면은
 * 같은 값을 useState 로 받아 다시 그린다(비동기 반복 안에서 옛 state 를 읽지 않으려는 것).
 *
 * ── 같은 File 을 매번 다시 보낸다 ─────────────────────────────────────────────
 * 서버는 상태를 두지 않고 조각마다 파일을 다시 읽어 미리보기 때의 sha 와 견준다. 그래서
 * 미리보기에 쓴 File 객체를 미리보기 결과와 함께 붙들어 두고, 그 File 을 보낸다.
 *
 * ── 끝나면 이 페이지에 머문다 ─────────────────────────────────────────────────
 * 결과 목록을 읽어야 하므로 팝업은 넘기지 않는다(redirectTo: null). router.refresh() 로
 * 아래 「유/무상 확인 필요」 목록만 새로 받는다.
 * ============================================================================
 */

type ReadyPreview = Extract<KyosanPreviewResult, { ok: true }>;

export default function KyosanIntakeImportScreen({
  billingReviewItems,
}: {
  billingReviewItems: ImportedCaseNeedingBillingReview[];
}) {
  const router = useRouter();

  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  /** 파일 칸을 비우려면 다시 붙인다. */
  const [uploadKey, setUploadKey] = useState(0);

  const [previewPending, setPreviewPending] = useState(false);
  const [preview, setPreview] = useState<{ result: ReadyPreview; file: File } | null>(null);
  const [previewFailure, setPreviewFailure] = useState<KyosanFailureText | null>(null);

  const [filter, setFilter] = useState<KyosanRowFilter>(DEFAULT_KYOSAN_ROW_FILTER);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(KYOSAN_DEFAULT_PAGE_SIZE);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [run, setRun] = useState<KyosanRunState | null>(null);
  const runRef = useRef<KyosanRunState | null>(null);
  const loopRef = useRef(false);

  const importing = isKyosanRunActive(run);
  const locked = importing || previewPending;

  // 가져오는 동안 창을 닫거나 새로 고치면 경고한다(조각 사이에서 끊긴다).
  useEffect(() => {
    if (!importing) return;
    function handleBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [importing]);

  function commitRun(next: KyosanRunState | null) {
    runRef.current = next;
    setRun(next);
  }

  function clearPreview() {
    setPreview(null);
    setPreviewFailure(null);
    setConfirmOpen(false);
    commitRun(null);
  }

  function handleFileChange(next: File | null) {
    if (locked) return;
    setFile(next);
    setFileError(next ? checkKyosanUploadFile(next) : null);
    clearPreview();
  }

  async function handlePreview() {
    if (file === null || locked) return;
    const problem = checkKyosanUploadFile(file);
    if (problem) {
      setFileError(problem);
      return;
    }
    setPreviewPending(true);
    clearPreview();
    try {
      const form = new FormData();
      form.set("file", file);
      const result = await previewKyosanIntakeImportAction(form);
      if (result.ok) {
        setPreview({ result, file });
        setFilter(DEFAULT_KYOSAN_ROW_FILTER);
        setPage(1);
      } else {
        setPreviewFailure(describeKyosanFailure(result));
      }
    } catch {
      setPreviewFailure(describeKyosanNetworkFailure());
    } finally {
      setPreviewPending(false);
    }
  }

  async function driveImport(source: File, batchId: string, fileSha256: string) {
    if (loopRef.current) return;
    loopRef.current = true;
    try {
      for (;;) {
        const state = runRef.current;
        if (state === null) break;
        if (state.phase === "pausing") {
          commitRun(settleKyosanPause(state));
          break;
        }
        if (state.phase !== "running") break;
        const chunk = nextKyosanChunk(state);
        if (chunk === null) break;

        let result: ExecuteKyosanIntakeImportChunkActionResult;
        try {
          const form = new FormData();
          form.set("file", source);
          form.set("batchId", batchId);
          form.set("fileSha256", fileSha256);
          form.set("rowNumbers", JSON.stringify(chunk));
          result = await executeKyosanIntakeImportChunkAction(form);
        } catch {
          // 네트워크 오류 — 차례를 그대로 두어 [다시 시도]가 같은 조각을 보낸다(서버가 멱등).
          commitRun(recordKyosanChunkFailure(runRef.current ?? state, describeKyosanNetworkFailure()));
          break;
        }
        const current = runRef.current ?? state;
        commitRun(
          result.ok
            ? recordKyosanChunkSuccess(current, result.results)
            : recordKyosanChunkFailure(current, describeKyosanFailure(result))
        );
      }
    } finally {
      loopRef.current = false;
    }

    const finished = runRef.current;
    if (finished === null || finished.results.length === 0) return;
    router.refresh();
    if (finished.phase === "done") {
      const message = kyosanRunDoneMessage(summarizeKyosanResults(finished.results));
      showSavePopup({ message, redirectTo: null });
    }
  }

  function handleConfirmImport() {
    setConfirmOpen(false);
    if (preview === null || locked || runRef.current !== null) return;
    const { result, file: source } = preview;
    commitRun(startKyosanRun(importableKyosanRowNumbers(result.rows), result.chunkSize));
    void driveImport(source, result.batchId, result.fileSha256);
  }

  function handlePause() {
    if (runRef.current) commitRun(pauseKyosanRun(runRef.current));
  }

  function handleResume() {
    if (preview === null || runRef.current === null) return;
    commitRun(resumeKyosanRun(runRef.current));
    void driveImport(preview.file, preview.result.batchId, preview.result.fileSha256);
  }

  function handleRetry() {
    if (preview === null || runRef.current === null) return;
    commitRun(retryKyosanRun(runRef.current));
    void driveImport(preview.file, preview.result.batchId, preview.result.fileSha256);
  }

  function handleReset() {
    if (locked) return;
    setFile(null);
    setFileError(null);
    clearPreview();
    setUploadKey((key) => key + 1);
  }

  const filteredRows = useMemo(
    () => (preview ? filterKyosanPreviewRows(preview.result.rows, filter) : []),
    [preview, filter]
  );
  const paged = paginateKyosanRows(filteredRows, page, pageSize);
  const billingFlags = useMemo(
    () => (preview ? countKyosanBillingFlags(preview.result.rows) : { billingReview: 0, billingAdjusted: 0 }),
    [preview]
  );
  const summary = useMemo(() => (run ? summarizeKyosanResults(run.results) : null), [run]);

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        교산 인수품 리스트(xlsx)로 과거 수리 건을 한꺼번에 만듭니다. 같은 인수번호가 이미 있으면(휴지통 포함) 그 줄은
        가져오지 않습니다 — 덮어쓰지 않습니다.
      </p>

      <KyosanUploadPanel
        key={uploadKey}
        hasFile={file !== null}
        fileError={fileError}
        busy={previewPending}
        disabled={importing}
        onFileChange={handleFileChange}
        onPreview={() => void handlePreview()}
      />

      {previewFailure ? <KyosanFailureNotice failure={previewFailure} /> : null}

      {preview ? (
        <section className="flex flex-col gap-3">
          <h2 className="break-words text-sm font-semibold text-zinc-900 dark:text-zinc-50">
            {`2. 미리보기 — ${preview.result.fileName} (자료 ${preview.result.counts.total}줄, 머리글 ${preview.result.headerRow}행)`}
          </h2>
          <KyosanCountCards
            counts={preview.result.counts}
            billing={billingFlags}
            filter={filter}
            onFilterChange={(next) => {
              setFilter(next);
              setPage(1);
            }}
          />
          <KyosanNewNamesPanel newNames={preview.result.newNames} />
          <KyosanPreviewTable rows={paged.rows} />
          <Pagination
            page={paged.page}
            pageSize={pageSize}
            totalCount={filteredRows.length}
            onPageChange={setPage}
            onPageSizeChange={(size) => {
              setPageSize(size);
              setPage(1);
            }}
          />
        </section>
      ) : null}

      {preview ? (
        <section className={KYOSAN_SECTION_CLASS}>
          <h2 className="mb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-50">3. 가져오기</h2>
          {run === null ? (
            <KyosanImportBar
              importableCount={preview.result.counts.IMPORTABLE}
              chunkSize={preview.result.chunkSize}
              disabled={locked}
              onRequestImport={() => setConfirmOpen(true)}
            />
          ) : (
            <KyosanImportProgressView
              state={run}
              onPause={handlePause}
              onResume={handleResume}
              onRetry={handleRetry}
              onReset={handleReset}
            />
          )}
        </section>
      ) : null}

      {run && summary && summary.total > 0 ? <KyosanImportResultView summary={summary} finished={run.phase === "done"} /> : null}

      {confirmOpen && preview ? (
        <KyosanImportConfirmDialogView
          count={preview.result.counts.IMPORTABLE}
          chunkSize={preview.result.chunkSize}
          onConfirm={handleConfirmImport}
          onCancel={() => setConfirmOpen(false)}
        />
      ) : null}

      <KyosanBillingReviewList items={billingReviewItems} />
    </div>
  );
}
