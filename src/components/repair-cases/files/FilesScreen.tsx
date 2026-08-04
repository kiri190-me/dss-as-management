"use client";

import { useMemo, useState } from "react";
import type { ActingUser } from "@/lib/domain/local/approval/transitions";
import {
  addAttachment,
  attachmentActionErrorMessages,
  renameAttachment,
  restoreAttachment,
  simulateDownload,
  simulatePreview,
  softDeleteAttachment,
  updateDescription,
} from "@/lib/domain/local/attachments/actions";
import type { LocalAttachmentMetadata } from "@/lib/domain/local/attachments/attachment-types";
import { useAttachmentStore } from "@/lib/domain/local/attachments/use-attachment-data";
import {
  applyAttachmentFilters,
  DEFAULT_ATTACHMENT_FILTERS,
  distinctExtensions,
  summarizeAttachments,
  type AttachmentFilters as AttachmentFiltersState,
} from "@/lib/domain/local/attachments/filters";
import type { ResolvedRepairCase } from "@/lib/domain/local/resolved-repair-case";
import LoadingNotice from "@/components/domain/LoadingNotice";
import AttachmentCardList from "./AttachmentCardList";
import AttachmentEventTimeline from "./AttachmentEventTimeline";
import AttachmentFilters from "./AttachmentFilters";
import AttachmentFormDialog, { type AttachmentFormSubmitInput } from "./AttachmentFormDialog";
import AttachmentSummaryCards from "./AttachmentSummaryCards";
import AttachmentTable from "./AttachmentTable";
import DeleteAttachmentDialog from "./DeleteAttachmentDialog";
import EditMetadataDialog from "./EditMetadataDialog";
import FilesHeaderSummary from "./FilesHeaderSummary";
import RestoreAttachmentDialog from "./RestoreAttachmentDialog";
import SimulationNoticeDialog from "./SimulationNoticeDialog";
import StorageDisclaimer from "./StorageDisclaimer";

type StatusMessage = { type: "success" | "error"; text: string };

export default function FilesScreen({
  resolved,
  actingUser,
}: {
  resolved: ResolvedRepairCase;
  actingUser: ActingUser | null;
}) {
  const attachmentStore = useAttachmentStore();

  const [filters, setFilters] = useState<AttachmentFiltersState>(DEFAULT_ATTACHMENT_FILTERS);
  const [statusMessage, setStatusMessage] = useState<StatusMessage | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<LocalAttachmentMetadata | null>(null);
  const [descriptionTarget, setDescriptionTarget] = useState<LocalAttachmentMetadata | null>(null);
  const [previewTarget, setPreviewTarget] = useState<LocalAttachmentMetadata | null>(null);
  const [downloadTarget, setDownloadTarget] = useState<LocalAttachmentMetadata | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<LocalAttachmentMetadata | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<LocalAttachmentMetadata | null>(null);

  const caseRecords = useMemo(
    () => attachmentStore.records.filter((r) => r.repairCaseId === resolved.id),
    [attachmentStore.records, resolved.id]
  );
  const caseEvents = useMemo(
    () => attachmentStore.events.filter((e) => e.repairCaseId === resolved.id),
    [attachmentStore.events, resolved.id]
  );
  const recordsById = useMemo(() => new Map(caseRecords.map((r) => [r.id, r])), [caseRecords]);
  const filteredRecords = useMemo(() => applyAttachmentFilters(caseRecords, filters), [caseRecords, filters]);
  const summary = useMemo(() => summarizeAttachments(caseRecords), [caseRecords]);
  const extensions = useMemo(() => distinctExtensions(caseRecords), [caseRecords]);
  const uploaders = useMemo(() => {
    const map = new Map<string, string>();
    for (const record of caseRecords) {
      if (!map.has(record.uploadedByUserId)) map.set(record.uploadedByUserId, record.uploadedByNameSnapshot);
    }
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [caseRecords]);

  if (!attachmentStore.isHydrated) {
    return <LoadingNotice />;
  }

  if (!actingUser) {
    return (
      <p className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-400">
        현재 로그인한 데모 사용자 정보를 확인할 수 없습니다.
      </p>
    );
  }

  function announce(type: StatusMessage["type"], text: string) {
    setStatusMessage({ type, text });
  }

  async function handleAddSubmit(input: AttachmentFormSubmitInput) {
    if (!actingUser) return;
    setIsSubmitting(true);
    const result = await addAttachment({ repairCaseId: resolved.id, actingUser, ...input });
    setIsSubmitting(false);
    if (result.ok) {
      setIsAddDialogOpen(false);
      announce("success", `"${result.record.displayName}" 메타데이터를 등록했습니다.`);
    } else {
      announce("error", result.message ?? attachmentActionErrorMessages[result.reason]);
    }
  }

  function handleRenameSubmit(newDisplayName: string) {
    if (!actingUser || !renameTarget) return;
    const result = renameAttachment({
      attachmentId: renameTarget.id,
      repairCaseId: resolved.id,
      newDisplayName,
      actingUser,
    });
    if (result.ok) {
      setRenameTarget(null);
      announce("success", `표시 이름을 "${result.record.displayName}"(으)로 변경했습니다.`);
    } else {
      announce("error", result.message ?? attachmentActionErrorMessages[result.reason]);
    }
  }

  function handleDescriptionSubmit(description: string) {
    if (!actingUser || !descriptionTarget) return;
    const result = updateDescription({
      attachmentId: descriptionTarget.id,
      repairCaseId: resolved.id,
      description: description || null,
      actingUser,
    });
    if (result.ok) {
      setDescriptionTarget(null);
      announce("success", "설명을 저장했습니다.");
    } else {
      announce("error", result.message ?? attachmentActionErrorMessages[result.reason]);
    }
  }

  function handlePreviewConfirm() {
    if (!actingUser || !previewTarget) return;
    const result = simulatePreview({ attachmentId: previewTarget.id, repairCaseId: resolved.id, actingUser });
    if (result.ok) {
      setPreviewTarget(null);
      announce("success", "미리보기 시뮬레이션 이력을 기록했습니다.");
    } else {
      announce("error", result.message ?? attachmentActionErrorMessages[result.reason]);
    }
  }

  function handleDownloadConfirm() {
    if (!actingUser || !downloadTarget) return;
    const result = simulateDownload({ attachmentId: downloadTarget.id, repairCaseId: resolved.id, actingUser });
    if (result.ok) {
      setDownloadTarget(null);
      announce("success", "다운로드 시뮬레이션 이력을 기록했습니다.");
    } else {
      announce("error", result.message ?? attachmentActionErrorMessages[result.reason]);
    }
  }

  function handleDeleteConfirm(reason: string) {
    if (!actingUser || !deleteTarget) return;
    const result = softDeleteAttachment({
      attachmentId: deleteTarget.id,
      repairCaseId: resolved.id,
      reason,
      actingUser,
    });
    if (result.ok) {
      setDeleteTarget(null);
      announce("success", `"${result.record.displayName}"을(를) 삭제했습니다.`);
    } else {
      announce("error", result.message ?? attachmentActionErrorMessages[result.reason]);
    }
  }

  function handleRestoreConfirm() {
    if (!actingUser || !restoreTarget) return;
    const result = restoreAttachment({ attachmentId: restoreTarget.id, repairCaseId: resolved.id, actingUser });
    if (result.ok) {
      setRestoreTarget(null);
      announce("success", `"${result.record.displayName}"을(를) 복원했습니다.`);
    } else {
      announce("error", result.message ?? attachmentActionErrorMessages[result.reason]);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <FilesHeaderSummary resolved={resolved} />
      <StorageDisclaimer />

      {attachmentStore.isMalformed && (
        <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
          저장된 첨부파일 메타데이터를 확인할 수 없어 이번 세션에서는 빈 상태로 표시합니다. 브라우저 저장소를 초기화하면 다시
          시드 데이터가 생성됩니다.
        </p>
      )}

      {statusMessage && (
        <p
          role={statusMessage.type === "error" ? "alert" : "status"}
          aria-live="polite"
          className={
            statusMessage.type === "error"
              ? "rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-400"
              : "rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-700 dark:border-green-900 dark:bg-green-950 dark:text-green-400"
          }
        >
          {statusMessage.text}
        </p>
      )}

      <AttachmentSummaryCards summary={summary} />

      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => setIsAddDialogOpen(true)}
          className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          메타데이터 추가
        </button>
      </div>

      <AttachmentFilters
        filters={filters}
        extensions={extensions}
        uploaders={uploaders}
        onQueryChange={(value) => setFilters((prev) => ({ ...prev, query: value }))}
        onCategoryChange={(value) => setFilters((prev) => ({ ...prev, category: value }))}
        onExtensionChange={(value) => setFilters((prev) => ({ ...prev, extension: value }))}
        onUploaderChange={(value) => setFilters((prev) => ({ ...prev, uploaderId: value }))}
        onIncludeDeletedChange={(value) => setFilters((prev) => ({ ...prev, includeDeleted: value }))}
        onReset={() => setFilters(DEFAULT_ATTACHMENT_FILTERS)}
      />

      <p aria-live="polite" className="text-sm text-zinc-600 dark:text-zinc-400">
        조건에 맞는 첨부파일 {filteredRecords.length}건
      </p>

      {filteredRecords.length === 0 ? (
        <div className="rounded-lg border border-zinc-200 bg-white p-8 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
          조건에 맞는 첨부파일이 없습니다.
        </div>
      ) : (
        <>
          <AttachmentTable
            records={filteredRecords}
            onRename={setRenameTarget}
            onEditDescription={setDescriptionTarget}
            onPreview={setPreviewTarget}
            onDownload={setDownloadTarget}
            onDelete={setDeleteTarget}
            onRestore={setRestoreTarget}
          />
          <AttachmentCardList
            records={filteredRecords}
            onRename={setRenameTarget}
            onEditDescription={setDescriptionTarget}
            onPreview={setPreviewTarget}
            onDownload={setDownloadTarget}
            onDelete={setDeleteTarget}
            onRestore={setRestoreTarget}
          />
        </>
      )}

      <AttachmentEventTimeline events={caseEvents} recordsById={recordsById} />

      <AttachmentFormDialog
        isOpen={isAddDialogOpen}
        isSubmitting={isSubmitting}
        onSubmit={handleAddSubmit}
        onCancel={() => setIsAddDialogOpen(false)}
      />

      <EditMetadataDialog
        isOpen={renameTarget !== null}
        mode="rename"
        isSubmitting={false}
        initialValue={renameTarget?.displayName ?? ""}
        onSubmit={handleRenameSubmit}
        onCancel={() => setRenameTarget(null)}
      />

      <EditMetadataDialog
        isOpen={descriptionTarget !== null}
        mode="description"
        isSubmitting={false}
        initialValue={descriptionTarget?.description ?? ""}
        onSubmit={handleDescriptionSubmit}
        onCancel={() => setDescriptionTarget(null)}
      />

      <SimulationNoticeDialog
        isOpen={previewTarget !== null}
        mode="preview"
        displayName={previewTarget?.displayName ?? ""}
        isSubmitting={false}
        onConfirm={handlePreviewConfirm}
        onCancel={() => setPreviewTarget(null)}
      />

      <SimulationNoticeDialog
        isOpen={downloadTarget !== null}
        mode="download"
        displayName={downloadTarget?.displayName ?? ""}
        isSubmitting={false}
        onConfirm={handleDownloadConfirm}
        onCancel={() => setDownloadTarget(null)}
      />

      <DeleteAttachmentDialog
        isOpen={deleteTarget !== null}
        displayName={deleteTarget?.displayName ?? ""}
        isSubmitting={false}
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeleteTarget(null)}
      />

      <RestoreAttachmentDialog
        isOpen={restoreTarget !== null}
        displayName={restoreTarget?.displayName ?? ""}
        isSubmitting={false}
        onConfirm={handleRestoreConfirm}
        onCancel={() => setRestoreTarget(null)}
      />
    </div>
  );
}
