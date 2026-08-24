"use client";

import { useMemo, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
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
import { useEffectiveRepairCase } from "@/lib/domain/local/workflow/effective-repair-case";
import type { ResolvedRepairCase } from "@/lib/domain/local/resolved-repair-case";
import {
  ATTACHMENT_CATEGORY_CODES,
  attachmentCategoryLabels,
  malwareScanStatusLabels,
  type AttachmentCategory,
} from "@/lib/domain/attachment-category";
import {
  ATTACHMENT_EXTENSION_RULES,
  MAX_ATTACHMENT_SIZE_BYTES,
  isExtensionAllowedForCategory,
  normalizeFileExtension,
} from "@/lib/domain/attachment-allowlist";
import type { RepairCaseAttachmentListItem } from "@/lib/db/queries/attachments";
import LoadingNotice from "@/components/domain/LoadingNotice";
import AttachmentCardList from "./AttachmentCardList";
import AttachmentEventTimeline from "./AttachmentEventTimeline";
import AttachmentFilters from "./AttachmentFilters";
import AttachmentFormDialog, { type AttachmentFormSubmitInput } from "./AttachmentFormDialog";
import AttachmentSummaryCards from "./AttachmentSummaryCards";
import AttachmentTable from "./AttachmentTable";
import { ResponsiveList } from "@/components/common/responsive-list";
import DeleteAttachmentDialog from "./DeleteAttachmentDialog";
import EditMetadataDialog from "./EditMetadataDialog";
import FilesHeaderSummary from "./FilesHeaderSummary";
import RestoreAttachmentDialog from "./RestoreAttachmentDialog";
import SimulationNoticeDialog from "./SimulationNoticeDialog";
import StorageDisclaimer from "./StorageDisclaimer";

type StatusMessage = { type: "success" | "error"; text: string };

/**
 * ============================================================================
 * 파일 관리 화면 — 두 가지가 한 이름 아래 있다
 * ============================================================================
 * 이 화면에는 성격이 전혀 다른 두 개가 들어 있다.
 *
 *  - **실제 저장**: DB 접수 건(source === "DATABASE")에서 쓴다. 목록은 서버가
 *    조회해서 넘겨 주고(attachments 표), 올리기는 라우트 핸들러로 실제 파일을
 *    보낸다. 브라우저 저장소를 전혀 읽지 않는다.
 *  - **데모**: local- 접수 건과 mock 읽기 소스에서 쓴다. 예전 그대로 브라우저
 *    localStorage에 메타데이터만 담는다 — 파일 내용은 오가지 않는다.
 *
 * 둘을 한 컴포넌트 안에서 분기하지 않고 **아예 다른 컴포넌트로 갈라 둔다.**
 * 한 몸으로 두면 훅 호출이 조건부가 되고(데모 쪽만 localStorage 훅을 쓴다),
 * 무엇보다 "이 화면이 지금 진짜 파일을 다루는 중인가"가 코드에서 안 보인다.
 *
 * 브라우저에 남아 있는 데모 기록은 지우지 않는다 — 각자 브라우저 안에만 있고,
 * DB 건에서 더 이상 보이지 않게 되면 그것으로 충분하다.
 * ============================================================================
 */
export default function FilesScreen(props: {
  resolved: ResolvedRepairCase;
  actingUser: ActingUser | null;
  /** 서버가 attachments 표에서 조회한 목록. 이 값이 있으면 실제 저장 화면이다. */
  attachments?: RepairCaseAttachmentListItem[];
  canUpload?: boolean;
}) {
  if (props.attachments) {
    return (
      <DatabaseFilesScreen
        resolved={props.resolved}
        actingUser={props.actingUser}
        attachments={props.attachments}
        canUpload={props.canUpload ?? false}
      />
    );
  }
  return <DemoFilesScreen resolved={props.resolved} actingUser={props.actingUser} />;
}

// ============================================================================
// 실제 저장
// ============================================================================

const ALL_EXTENSIONS = ATTACHMENT_EXTENSION_RULES.map((rule) => rule.extension);

function allowedExtensionsFor(category: AttachmentCategory): string[] {
  return ALL_EXTENSIONS.filter((extension) => isExtensionAllowedForCategory(extension, category));
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatTimestamp(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" });
}

function DatabaseFilesScreen({
  resolved,
  actingUser,
  attachments,
  canUpload,
}: {
  resolved: ResolvedRepairCase;
  actingUser: ActingUser | null;
  attachments: RepairCaseAttachmentListItem[];
  canUpload: boolean;
}) {
  const router = useRouter();
  const { effective, isHydrated } = useEffectiveRepairCase(resolved);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [category, setCategory] = useState<AttachmentCategory>("INTAKE_PHOTO");
  const [description, setDescription] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [statusMessage, setStatusMessage] = useState<StatusMessage | null>(null);

  const allowedExtensions = useMemo(() => allowedExtensionsFor(category), [category]);
  const acceptAttribute = useMemo(
    () => allowedExtensions.map((extension) => `.${extension}`).join(","),
    [allowedExtensions]
  );
  const totalBytes = useMemo(
    () => attachments.reduce((sum, item) => sum + item.fileSize, 0),
    [attachments]
  );

  if (!isHydrated || !effective) {
    return <LoadingNotice />;
  }

  async function handleUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const file = fileInputRef.current?.files?.[0];
    if (!file) {
      setStatusMessage({ type: "error", text: "올릴 파일을 선택해 주세요." });
      return;
    }

    // 화면에서도 한 번 걸러 준다. 진짜 판정은 서버가 다시 하지만, 20MB짜리를
    // 다 보내고 나서 거절당하는 것보다는 보내기 전에 아는 편이 낫다.
    const extension = normalizeFileExtension(file.name);
    if (!extension || !isExtensionAllowedForCategory(extension, category)) {
      setStatusMessage({
        type: "error",
        text: `'${attachmentCategoryLabels[category]}' 분류에는 ${allowedExtensions
          .map((value) => `.${value}`)
          .join(", ")} 만 올릴 수 있습니다.`,
      });
      return;
    }
    if (file.size === 0) {
      setStatusMessage({ type: "error", text: "빈 파일은 올릴 수 없습니다." });
      return;
    }
    if (file.size > MAX_ATTACHMENT_SIZE_BYTES) {
      setStatusMessage({
        type: "error",
        text: `파일이 ${formatBytes(MAX_ATTACHMENT_SIZE_BYTES)}를 넘습니다. (선택한 파일 ${formatBytes(file.size)})`,
      });
      return;
    }

    setIsUploading(true);
    setStatusMessage(null);
    try {
      // 본문은 파일 바이트 그 자체이고 메타데이터는 쿼리 문자열이다 —
      // multipart로 보내면 서버가 파일 전체를 메모리에 올려야 한다
      // (라우트 핸들러 주석 참조).
      const query = new URLSearchParams({ category, fileName: file.name });
      if (description.trim().length > 0) query.set("description", description.trim());

      const response = await fetch(
        `/api/repair-cases/${encodeURIComponent(resolved.id)}/attachments?${query.toString()}`,
        { method: "POST", body: file }
      );

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        setStatusMessage({
          type: "error",
          text: payload?.error ?? "파일을 올리지 못했습니다. 잠시 후 다시 시도해 주세요.",
        });
        return;
      }

      setStatusMessage({ type: "success", text: `"${file.name}"을(를) 올렸습니다.` });
      setDescription("");
      if (fileInputRef.current) fileInputRef.current.value = "";
      // 목록은 서버가 만든다 — 화면에서 지어내지 않고 다시 받아 온다.
      router.refresh();
    } catch {
      setStatusMessage({ type: "error", text: "네트워크 문제로 파일을 올리지 못했습니다." });
    } finally {
      setIsUploading(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <FilesHeaderSummary resolved={effective} />

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

      {canUpload ? (
        <form
          onSubmit={handleUpload}
          className="flex flex-col gap-3 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
        >
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">파일 올리기</h2>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-xs text-zinc-500 dark:text-zinc-400">분류</span>
              <select
                value={category}
                onChange={(event) => setCategory(event.target.value as AttachmentCategory)}
                disabled={isUploading}
                className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-950"
              >
                {ATTACHMENT_CATEGORY_CODES.map((code) => (
                  <option key={code} value={code}>
                    {attachmentCategoryLabels[code]}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1 text-sm">
              <span className="text-xs text-zinc-500 dark:text-zinc-400">파일</span>
              <input
                ref={fileInputRef}
                type="file"
                accept={acceptAttribute}
                disabled={isUploading}
                className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-950"
              />
            </label>
          </div>

          <label className="flex flex-col gap-1 text-sm">
            <span className="text-xs text-zinc-500 dark:text-zinc-400">설명 (선택)</span>
            <input
              type="text"
              value={description}
              maxLength={500}
              onChange={(event) => setDescription(event.target.value)}
              disabled={isUploading}
              placeholder="예: 반입 당시 전면 패널 상태"
              className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-950"
            />
          </label>

          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            최대 {formatBytes(MAX_ATTACHMENT_SIZE_BYTES)} · 허용 형식{" "}
            {allowedExtensions.map((extension) => `.${extension}`).join(", ")}
          </p>

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={isUploading}
              className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
            >
              {isUploading ? "올리는 중…" : "올리기"}
            </button>
          </div>
        </form>
      ) : (
        <p className="rounded-md border border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
          {actingUser
            ? "이 접수 건에 파일을 올릴 권한이 없습니다. 목록은 그대로 보실 수 있습니다."
            : "로그인 정보를 확인할 수 없어 파일을 올릴 수 없습니다."}
        </p>
      )}

      <p aria-live="polite" className="text-sm text-zinc-600 dark:text-zinc-400">
        저장된 파일 {attachments.length}건 · 합계 {formatBytes(totalBytes)}
      </p>

      {attachments.length === 0 ? (
        <div className="rounded-lg border border-zinc-200 bg-white p-8 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
          아직 이 접수 건에 올라온 파일이 없습니다.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-zinc-200 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">파일명</th>
                <th scope="col" className="px-3 py-2 font-medium">분류</th>
                <th scope="col" className="px-3 py-2 font-medium">크기</th>
                <th scope="col" className="px-3 py-2 font-medium">검사</th>
                <th scope="col" className="px-3 py-2 font-medium">올린 사람</th>
                <th scope="col" className="px-3 py-2 font-medium">올린 시각</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {attachments.map((item) => (
                <tr key={item.id}>
                  <td className="px-3 py-2">
                    <span className="text-zinc-900 dark:text-zinc-50">{item.originalFileName}</span>
                    {item.description && (
                      <span className="block text-xs text-zinc-500 dark:text-zinc-400">{item.description}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-zinc-700 dark:text-zinc-300">
                    {attachmentCategoryLabels[item.category]}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-zinc-700 dark:text-zinc-300">
                    {formatBytes(item.fileSize)}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-zinc-700 dark:text-zinc-300">
                    {malwareScanStatusLabels[item.malwareScanStatus]}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-zinc-700 dark:text-zinc-300">{item.uploadedByName}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-zinc-700 dark:text-zinc-300">
                    {formatTimestamp(item.uploadedAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        내려받기와 미리보기는 아직 연결되지 않았습니다. 악성코드 검사기도 아직 없어 모든 파일은 &ldquo;미검사&rdquo;로
        남습니다.
      </p>
    </div>
  );
}

// ============================================================================
// 데모 (브라우저 localStorage) — local- 접수 건과 mock 읽기 소스 전용
// ============================================================================

function DemoFilesScreen({
  resolved,
  actingUser,
}: {
  resolved: ResolvedRepairCase;
  actingUser: ActingUser | null;
}) {
  const attachmentStore = useAttachmentStore();
  const { effective, isHydrated: workflowHydrated } = useEffectiveRepairCase(resolved);

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

  if (!attachmentStore.isHydrated || !workflowHydrated || !effective) {
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
      <FilesHeaderSummary resolved={effective} />
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
        <ResponsiveList
          listId="repair-case-attachments"
          table={
            <AttachmentTable
              records={filteredRecords}
              onRename={setRenameTarget}
              onEditDescription={setDescriptionTarget}
              onPreview={setPreviewTarget}
              onDownload={setDownloadTarget}
              onDelete={setDeleteTarget}
              onRestore={setRestoreTarget}
            />
          }
          cards={
            <AttachmentCardList
              records={filteredRecords}
              onRename={setRenameTarget}
              onEditDescription={setDescriptionTarget}
              onPreview={setPreviewTarget}
              onDownload={setDownloadTarget}
              onDelete={setDeleteTarget}
              onRestore={setRestoreTarget}
            />
          }
        />
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
