"use client";

import { useState } from "react";
import {
  KYOSAN_IMPORT_FAILURE_TEXT,
  canImportKyosanReport,
  checkKyosanReportFile,
  defaultKyosanReportSelection,
  kyosanReportSaveOffer,
  type KyosanReportPreviewReady,
} from "@/lib/domain/kyosan-report-import/preview-view";
import {
  importKyosanReportAction,
  previewKyosanReportAction,
} from "@/lib/server/actions/kyosan-report-import";
import type {
  ImportKyosanReportActionResult,
  KyosanReportActionFailure,
} from "@/lib/server/actions/kyosan-report-import";
import type { KyosanReportImportResult } from "@/lib/server/services/kyosan-report-import";
import {
  KyosanReportConfirmDialogView,
  KyosanReportContentPanel,
  KyosanReportFailureNotice,
  KyosanReportImportBar,
  KyosanReportMatchPanel,
  KyosanReportNotices,
  KyosanReportResultPanel,
  KyosanReportUploadPanel,
} from "./KyosanReportImportParts";

/**
 * ============================================================================
 * 연락서 한 장 넣기 — 올리기 → 미리보기 → 확인 → 저장 (조각 S4)
 * ============================================================================
 * 판단은 `domain/kyosan-report-import/preview-view.ts`(순수 함수), 그리기는
 * `KyosanReportImportParts.tsx` 에 있다. 이 파일은 상태를 들고 서버 액션 둘을
 * 부르는 일만 한다(서버 액션을 부르므로 시험에서 통째로 그릴 수 없다).
 *
 * ── 🔴 서버로 보내는 것은 둘뿐이다 ───────────────────────────────────
 *   · `file`         올린 연락서 원본 (미리보기에 쓴 바로 그 File)
 *   · `repairCaseId` 사람이 고른(또는 확인한) 수리 건
 * 미리보기 결과 · 넣을 줄 · 부품 목록은 **보내지 않는다.** 저장 함수가 파일에서
 * 처음부터 다시 만든다 — 화면이 계산한 것을 보내는 순간 「사람이 본 것」과
 * 「들어간 것」이 갈라진다(services/kyosan-report-import.ts 머리말).
 *
 * ── 🔴 바로 저장하지 않는다 ──────────────────────────────────────────
 * [미리보기] 는 아무것도 저장하지 않는다. 사람이 내용을 보고 [이식] → 확인
 * 대화상자의 [넣습니다] 를 눌러야 그때 처음으로 서버가 DB 에 쓴다.
 *
 * ── 🔴 한 장씩이다 ──────────────────────────────────────────────────
 * 여러 장을 한꺼번에 넣는 길을 만들지 않았다(그것은 다음 조각이다). 파일 칸도
 * `multiple` 이 아니다.
 * ============================================================================
 */

type PreviewState = { result: KyosanReportPreviewReady; file: File };

export default function KyosanReportImportScreen() {
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  /** 파일 칸을 비우려면 다시 붙인다. */
  const [uploadKey, setUploadKey] = useState(0);

  const [previewPending, setPreviewPending] = useState(false);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [failureMessage, setFailureMessage] = useState<string | null>(null);

  /** 🔴 사람이 고른 수리 건. 후보가 여럿이면 처음에는 `null` 이다. */
  const [selectedRepairCaseId, setSelectedRepairCaseId] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [importPending, setImportPending] = useState(false);
  const [result, setResult] = useState<KyosanReportImportResult | null>(null);

  const saveOffer = preview === null ? "none" : kyosanReportSaveOffer(preview.result);
  const canImport =
    preview !== null && !importPending && canImportKyosanReport(preview.result, selectedRepairCaseId);
  const selectedTarget =
    preview === null
      ? undefined
      : preview.result.targets.find((target) => target.repairCaseId === selectedRepairCaseId);

  function resetPreview() {
    setPreview(null);
    setSelectedRepairCaseId(null);
    setConfirmOpen(false);
    setFailureMessage(null);
    setResult(null);
  }

  function handleFileChange(next: File | null) {
    resetPreview();
    setFile(next);
    setFileError(next === null ? null : checkKyosanReportFile(next));
  }

  async function handlePreview() {
    if (file === null || fileError !== null) return;
    resetPreview();
    setPreviewPending(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const outcome = await previewKyosanReportAction(formData);
      if (!outcome.ok) {
        setFailureMessage(outcome.message);
        return;
      }
      setPreview({ result: outcome, file });
      // 🔴 짝이 하나로 확정됐을 때만 미리 골라 둔다. 후보가 여럿이면 null 이다.
      setSelectedRepairCaseId(defaultKyosanReportSelection(outcome));
    } catch {
      setFailureMessage("연락서를 읽지 못했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setPreviewPending(false);
    }
  }

  async function handleImport() {
    if (preview === null || selectedRepairCaseId === null) return;
    if (!canImportKyosanReport(preview.result, selectedRepairCaseId)) return;
    setConfirmOpen(false);
    setImportPending(true);
    setFailureMessage(null);
    try {
      // 🔴 보내는 것은 이 둘뿐이다 — 파일과 고른 수리 건 id.
      const formData = new FormData();
      formData.append("file", preview.file);
      formData.append("repairCaseId", selectedRepairCaseId);
      const outcome = await importKyosanReportAction(formData);

      // 문 앞에서 막힌 것(권한 · 파일 · 일시 장애)은 「저장 결과」가 아니다 — 따로 보인다.
      if (isActionFailure(outcome)) {
        setFailureMessage(outcome.message);
        return;
      }
      setResult(outcome);
      if (outcome.ok) {
        // 같은 파일을 또 보내지 못하게 미리보기를 접는다(두 번 넣기 방지는 서버에도 있다).
        setPreview(null);
        setSelectedRepairCaseId(null);
        setFile(null);
        setUploadKey((key) => key + 1);
      }
    } catch {
      setFailureMessage("연락서를 넣지 못했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setImportPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <KyosanReportUploadPanel
        key={uploadKey}
        hasFile={file !== null}
        fileError={fileError}
        busy={previewPending}
        disabled={importPending}
        onFileChange={handleFileChange}
        onPreview={() => void handlePreview()}
      />

      {failureMessage !== null ? <KyosanReportFailureNotice message={failureMessage} /> : null}

      {preview !== null ? (
        <>
          <KyosanReportMatchPanel
            preview={preview.result}
            saveOffer={saveOffer}
            selectedRepairCaseId={selectedRepairCaseId}
            disabled={importPending}
            onSelect={setSelectedRepairCaseId}
          />
          <KyosanReportContentPanel preview={preview.result} />
          <KyosanReportNotices preview={preview.result} />
          <KyosanReportImportBar
            saveOffer={saveOffer}
            canImport={canImport}
            busy={importPending}
            onImport={() => setConfirmOpen(true)}
          />
        </>
      ) : null}

      {confirmOpen && preview !== null && selectedTarget !== undefined ? (
        <KyosanReportConfirmDialogView
          target={selectedTarget}
          preview={preview.result}
          onConfirm={() => void handleImport()}
          onCancel={() => setConfirmOpen(false)}
        />
      ) : null}

      {result !== null ? (
        <KyosanReportResultPanel
          result={result}
          failureText={result.ok ? "" : KYOSAN_IMPORT_FAILURE_TEXT[result.code]}
        />
      ) : null}
    </div>
  );
}

/** 액션이 문 앞에서 막은 것인가(권한 · 파일 · 일시 장애) — 저장 실패와 가른다. */
function isActionFailure(
  outcome: ImportKyosanReportActionResult
): outcome is KyosanReportActionFailure {
  if (outcome.ok) return false;
  return (
    outcome.code === "UNAUTHORIZED" ||
    outcome.code === "FORBIDDEN" ||
    outcome.code === "VALIDATION_ERROR" ||
    outcome.code === "DATABASE_UNAVAILABLE"
  );
}
