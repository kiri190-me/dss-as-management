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
  type AttachmentCategory,
} from "@/lib/domain/attachment-category";
import {
  ATTACHMENT_EXTENSION_RULES,
  MAX_ATTACHMENT_SIZE_BYTES,
  isExtensionAllowedForCategory,
  normalizeFileExtension,
} from "@/lib/domain/attachment-allowlist";
import type {
  RepairCaseAttachmentListItem,
  TrashedAttachmentListItem,
} from "@/lib/db/queries/attachments";
// 데모 계층에도 같은 이름의 함수가 있어 별칭을 붙인다 — 이름이 같지만 하는 일이
// 다르다(한쪽은 브라우저 저장소, 한쪽은 실제 DB).
import {
  restoreAttachmentAction,
  softDeleteAttachmentAction,
} from "@/lib/server/actions/attachments";
import LoadingNotice from "@/components/domain/LoadingNotice";
import InAppCamera from "./InAppCamera";
import { uploadPreview } from "./shrink-image";
import StoredAttachmentList from "./StoredAttachmentList";
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
  /** 휴지통에 든 첨부. 별도 조회다(queries/attachments.ts — 부분 인덱스). */
  trashedAttachments?: TrashedAttachmentListItem[];
  canUpload?: boolean;
  /** 지우기·되살리기를 보일지. 실제 차단은 서버 액션이 다시 한다. */
  canManage?: boolean;
}) {
  if (props.attachments) {
    return (
      <DatabaseFilesScreen
        resolved={props.resolved}
        actingUser={props.actingUser}
        attachments={props.attachments}
        trashedAttachments={props.trashedAttachments ?? []}
        canUpload={props.canUpload ?? false}
        canManage={props.canManage ?? false}
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
  trashedAttachments,
  canUpload,
  canManage,
}: {
  resolved: ResolvedRepairCase;
  actingUser: ActingUser | null;
  attachments: RepairCaseAttachmentListItem[];
  trashedAttachments: TrashedAttachmentListItem[];
  canUpload: boolean;
  canManage: boolean;
}) {
  const router = useRouter();
  const { effective, isHydrated } = useEffectiveRepairCase(resolved);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [category, setCategory] = useState<AttachmentCategory>("INTAKE_PHOTO");
  const [description, setDescription] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [statusMessage, setStatusMessage] = useState<StatusMessage | null>(null);
  /**
   * 「파일 올리기」 구역을 펼쳤는가. **평소에는 접혀 있다**(2026-09-04 요구) —
   * 이 화면에 오는 대부분의 일은 이미 올라온 파일을 보는 것이고, 올리는 칸이
   * 늘 펼쳐져 있으면 목록이 화면 아래로 밀려난다.
   *
   * 어디에도 저장하지 않는다. 탭을 다시 열면 접힌 상태로 돌아온다.
   */
  const [isUploadPanelOpen, setIsUploadPanelOpen] = useState(false);

  /**
   * 찍었지만 아직 올리지 않은 사진들.
   *
   * 현장에서는 파형·외관을 여러 장 연달아 찍고 나서 **그중 잘 나온 것만**
   * 올린다. 찍는 즉시 올라가면 흔들린 사진까지 서버에 남고, 지우려면 휴지통을
   * 거쳐야 한다. 그래서 찍은 것을 여기 모아 두고, 사용자가 고른 것만 보낸다.
   *
   * previewUrl은 objectURL이다. 브라우저 메모리를 잡고 있으므로 버릴 때
   * revokeObjectURL로 반드시 놓아 준다 — 안 놓으면 여러 장 찍고 버리기를
   * 반복하는 동안 계속 쌓인다.
   */
  type StagedPhoto = { id: string; file: File; previewUrl: string; selected: boolean };
  const [stagedPhotos, setStagedPhotos] = useState<StagedPhoto[]>([]);

  /**
   * 앱 안 카메라를 쓸 수 없다고 판정됐을 때의 이유. 그때는 파일 입력으로
   * 안내한다 — 카메라가 안 열려도 사진을 올릴 길은 남아 있어야 한다.
   */
  const [cameraUnavailableReason, setCameraUnavailableReason] = useState<string | null>(null);
  /** 여러 장을 차례로 올릴 때 몇 장째인지. 한 장일 때는 null이라 표시하지 않는다. */
  const [uploadProgress, setUploadProgress] = useState<{ current: number; total: number } | null>(null);

  // 지우기·되살리기 다이얼로그. 데모 화면이 쓰던 컴포넌트를 그대로 재사용한다.
  // 지우기는 **여러 건을 함께** 받는다 — 목록에서 여러 개를 골라 한 번에
  // 지울 수 있고, 한 건짜리는 길이 1인 목록일 뿐이다. 확인 창을 한 번만 띄우려면
  // 사유도 한 번만 받아야 하므로 이 모양이 자연스럽다.
  const [pendingDeletes, setPendingDeletes] = useState<RepairCaseAttachmentListItem[]>([]);
  const [pendingRestore, setPendingRestore] = useState<TrashedAttachmentListItem | null>(null);
  const [isMutating, setIsMutating] = useState(false);

  async function handleDeleteConfirm(reason: string) {
    if (pendingDeletes.length === 0) return;
    setIsMutating(true);
    setStatusMessage(null);
    try {
      // 한 건씩 차례로 보낸다. 한 건이 막혀도(잠긴 건 등) 나머지는 지운다 —
      // 여러 개를 고른 사람에게 "하나가 안 되니 전부 취소"는 도움이 안 된다.
      const failures: { name: string; reason: string }[] = [];
      let deleted = 0;
      for (const target of pendingDeletes) {
        const result = await softDeleteAttachmentAction({
          attachmentId: target.id,
          repairCaseId: resolved.id,
          reason,
        });
        if (result.ok) deleted += 1;
        else failures.push({ name: target.originalFileName, reason: result.message });
      }

      if (deleted === 0) {
        setStatusMessage({
          type: "error",
          text: failures.map((item) => `${item.name}: ${item.reason}`).join(" / "),
        });
        return;
      }
      if (failures.length > 0) {
        setStatusMessage({
          type: "error",
          text: `${deleted}건을 휴지통으로 옮겼고 ${failures.length}건은 빠졌습니다 — ${failures
            .map((item) => `${item.name}(${item.reason})`)
            .join(", ")}`,
        });
        setPendingDeletes([]);
        router.refresh();
        return;
      }
      setStatusMessage({
        type: "success",
        // 실물이 남는다는 사실을 그때 알려 준다 — 되살릴 수 있다는 뜻이고,
        // 완전히 사라진 줄 알고 다시 올리는 일을 막는다.
        text:
          deleted === 1
            ? `${pendingDeletes[0].originalFileName} 을(를) 휴지통으로 옮겼습니다. 되살릴 수 있습니다.`
            : `${deleted}건을 휴지통으로 옮겼습니다. 되살릴 수 있습니다.`,
      });
      setPendingDeletes([]);
      router.refresh();
    } finally {
      setIsMutating(false);
    }
  }

  async function handleRestoreConfirm() {
    if (!pendingRestore) return;
    setIsMutating(true);
    setStatusMessage(null);
    try {
      const result = await restoreAttachmentAction({
        attachmentId: pendingRestore.id,
        repairCaseId: resolved.id,
      });
      if (!result.ok) {
        setStatusMessage({ type: "error", text: result.message });
        return;
      }
      setStatusMessage({ type: "success", text: `${pendingRestore.originalFileName} 을(를) 되살렸습니다.` });
      setPendingRestore(null);
      router.refresh();
    } finally {
      setIsMutating(false);
    }
  }

  const allowedExtensions = useMemo(() => allowedExtensionsFor(category), [category]);
  const acceptAttribute = useMemo(
    () => allowedExtensions.map((extension) => `.${extension}`).join(","),
    [allowedExtensions]
  );
  /**
   * 이 분류가 사진을 받는가 — 받을 때만 촬영 입력을 내민다.
   *
   * 촬영으로 들어오는 파일은 브라우저가 정하고(보통 jpg), 확장자를 고를 수
   * 없다. 그래서 사진을 아예 안 받는 분류(펌웨어·로그 등)에 촬영 버튼을 두면
   * 찍는 순간까지 갔다가 거절당한다 — 그 앞에서 감춘다.
   */
  const cameraSupported = useMemo(
    () => allowedExtensions.includes("jpg") || allowedExtensions.includes("jpeg"),
    [allowedExtensions]
  );
  const totalBytes = useMemo(
    () => attachments.reduce((sum, item) => sum + item.fileSize, 0),
    [attachments]
  );
  const selectedPhotoCount = useMemo(
    () => stagedPhotos.filter((photo) => photo.selected).length,
    [stagedPhotos]
  );

  /**
   * 한 장 찍을 때마다 여기로 들어온다.
   *
   * 입력을 곧바로 비우는 것이 핵심이다. 파일 입력은 같은 값이 다시 들어오면
   * change가 울리지 않으므로, 비우지 않으면 **같은 장면을 두 번째로 찍었을 때
   * 아무 일도 일어나지 않는다.**
   */
  /** 카메라가 한 장 찍을 때마다, 또는 파일 입력으로 사진이 들어올 때마다. */
  function stagePhoto(file: File) {
    // 앨범에서 고른 파일과 섞이지 않게 한다 — 무엇을 올리는지 화면만 보고
    // 알 수 없게 되는 것을 막는다.
    if (fileInputRef.current) fileInputRef.current.value = "";

    setStagedPhotos((previous) => [
      ...previous,
      {
        id: `${Date.now()}-${previous.length}-${file.size}`,
        file,
        previewUrl: URL.createObjectURL(file),
        // 찍었다면 올릴 뜻이 있었다고 본다. 뺄 사람이 빼는 편이 낫다.
        selected: true,
      },
    ]);
    setStatusMessage(null);
  }

  function togglePhotoSelected(id: string) {
    setStagedPhotos((previous) =>
      previous.map((photo) => (photo.id === id ? { ...photo, selected: !photo.selected } : photo))
    );
  }

  function setAllPhotosSelected(selected: boolean) {
    setStagedPhotos((previous) => previous.map((photo) => ({ ...photo, selected })));
  }

  /** 목록에서 없앤다. 서버에 올라간 것과는 무관하다. */
  function discardPhoto(id: string) {
    setStagedPhotos((previous) => {
      const target = previous.find((photo) => photo.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return previous.filter((photo) => photo.id !== id);
    });
  }

  function discardAllPhotos() {
    setStagedPhotos((previous) => {
      for (const photo of previous) URL.revokeObjectURL(photo.previewUrl);
      return [];
    });
  }

  if (!isHydrated || !effective) {
    return <LoadingNotice />;
  }

  /**
   * 한 장을 보내기 전에 화면에서 걸러 낸다. 진짜 판정은 서버가 다시 하지만,
   * 20MB짜리를 다 보내고 나서 거절당하는 것보다는 보내기 전에 아는 편이 낫다.
   *
   * 여러 장을 올릴 때는 이 판정이 **한 장씩** 따로 돌아야 한다. 미리 전체를
   * 검사해서 한 장이라도 틀리면 묶음 전체를 거절하면, 열 장 중 한 장이
   * 안 되는 형식일 때 나머지 아홉 장까지 못 올린다.
   */
  function rejectionReasonFor(file: File): string | null {
    const extension = normalizeFileExtension(file.name);
    if (!extension || !isExtensionAllowedForCategory(extension, category)) {
      return `'${attachmentCategoryLabels[category]}' 분류가 받지 않는 형식`;
    }
    if (file.size === 0) return "빈 파일";
    if (file.size > MAX_ATTACHMENT_SIZE_BYTES) {
      return `${formatBytes(MAX_ATTACHMENT_SIZE_BYTES)} 초과 (${formatBytes(file.size)})`;
    }
    return null;
  }

  /**
   * 한 장을 실제로 보낸다. 실패하면 사람이 읽을 수 있는 이유를 돌려준다.
   *
   * 성공하면 **썸네일 올리기의 약속을 함께 넘긴다.** 여기서 기다리지 않되
   * 부르는 쪽이 "다 끝났을 때"를 알 수 있어야 하기 때문이다(handleUpload).
   */
  async function uploadOne(
    file: File
  ): Promise<{ ok: true; previewUpload: Promise<void> | null } | { ok: false; reason: string }> {
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
        return { ok: false, reason: payload?.error ?? "서버가 거절했습니다" };
      }

      // 썸네일을 이어서 보낸다. 원본을 이미 손에 들고 있으므로 다시 받을 필요가
      // 없고, 서버는 이미지 처리를 전혀 하지 않는다(라우트 주석 참조).
      //
      // await 하지 않는다 — 사용자가 한 일(사진 올리기)은 이미 끝났고, 썸네일은
      // 없어도 목록이 원본으로 보여 준다. 여기서 기다리면 여러 장 올릴 때
      // 장마다 썸네일 만드는 시간이 그대로 얹힌다.
      //
      // 다만 **약속은 버리지 않고 돌려준다.** 예전에는 여기서 그냥 흘려보내
      // 아무도 끝을 몰랐고, 그 사이에 목록을 다시 받아 오는 바람에 썸네일이
      // 없는 목록이 화면에 남았다(handleUpload 의 두 번째 refresh 참조).
      // uploadPreview 는 스스로 실패를 삼키므로 이 약속은 거절되지 않는다.
      const created = (await response.json().catch(() => null)) as { id?: string } | null;
      const previewUpload = created?.id ? uploadPreview(created.id, file) : null;

      return { ok: true, previewUpload };
    } catch {
      return { ok: false, reason: "네트워크 문제" };
    }
  }

  async function handleUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    // 찍어 모아 둔 사진이 있으면 그중 **고른 것만** 보낸다. 앨범에서 고른
    // 파일은 그것이 없을 때만 쓴다 — 두 경로를 한 번에 섞어 보내면 사용자가
    // 무엇을 올렸는지 화면만 보고 알 수 없다.
    const chosenPhotos = stagedPhotos.filter((photo) => photo.selected);
    const fromCamera = stagedPhotos.length > 0;
    const files = fromCamera
      ? chosenPhotos.map((photo) => photo.file)
      : Array.from(fileInputRef.current?.files ?? []);

    if (files.length === 0) {
      setStatusMessage({
        type: "error",
        text: fromCamera
          ? "올릴 사진을 하나 이상 골라 주세요."
          : "올릴 파일을 선택하거나 사진을 촬영해 주세요.",
      });
      return;
    }

    setIsUploading(true);
    setStatusMessage(null);
    setUploadProgress(null);

    // 한 장씩 차례로 보낸다. 동시에 쏘면 서버가 같은 접수 건에 여러 파일을
    // 나란히 쓰게 되고, 어디까지 됐는지 사용자에게 보여 줄 방법도 없어진다.
    const failures: { name: string; reason: string }[] = [];
    // 실제로 올라간 사진의 id — 이것만 모아 둔 목록에서 뺀다. 실패한 것은
    // 남겨서 다시 시도할 수 있게 한다.
    const uploadedPhotoIds: string[] = [];
    /**
     * 썸네일 올리기들. 올리는 흐름은 이것을 기다리지 않고 끝나지만, 다 끝난
     * 뒤에 목록을 한 번 더 받아 오려면 끝을 알아야 한다(아래).
     */
    const previewUploads: Promise<void>[] = [];
    let uploaded = 0;

    try {
      for (const [index, file] of files.entries()) {
        if (files.length > 1) {
          setUploadProgress({ current: index + 1, total: files.length });
        }

        const rejection = rejectionReasonFor(file);
        if (rejection) {
          failures.push({ name: file.name, reason: rejection });
          continue;
        }

        const result = await uploadOne(file);
        if (result.ok) {
          uploaded += 1;
          if (result.previewUpload) previewUploads.push(result.previewUpload);
          if (fromCamera) uploadedPhotoIds.push(chosenPhotos[index].id);
        } else {
          failures.push({ name: file.name, reason: result.reason });
        }
      }

      // 이미 올라간 것은 되돌리지 않는다 — 실제로 저장된 파일이고, 지우고
      // 싶으면 휴지통이 있다. 몇 장이 왜 빠졌는지는 그대로 말해 준다.
      if (uploadedPhotoIds.length > 0) {
        setStagedPhotos((previous) => {
          for (const photo of previous) {
            if (uploadedPhotoIds.includes(photo.id)) URL.revokeObjectURL(photo.previewUrl);
          }
          return previous.filter((photo) => !uploadedPhotoIds.includes(photo.id));
        });
      }

      if (uploaded > 0 && failures.length === 0) {
        const remaining = stagedPhotos.length - uploadedPhotoIds.length;
        setStatusMessage({
          type: "success",
          text: fromCamera
            ? `사진 ${uploaded}장을 올렸습니다.${remaining > 0 ? ` 고르지 않은 ${remaining}장은 그대로 있습니다.` : ""}`
            : files.length === 1
              ? `"${files[0].name}"을(를) 올렸습니다.`
              : `${uploaded}장을 모두 올렸습니다.`,
        });
      } else if (uploaded > 0) {
        setStatusMessage({
          type: "error",
          text: `${uploaded}장을 올렸고 ${failures.length}장은 빠졌습니다 — ${failures
            .map((item) => `${item.name}(${item.reason})`)
            .join(", ")}`,
        });
      } else {
        setStatusMessage({
          type: "error",
          text:
            failures.length === 1
              ? `${failures[0].name}: ${failures[0].reason}`
              : `${failures.length}장 모두 올리지 못했습니다 — ${failures
                  .map((item) => `${item.name}(${item.reason})`)
                  .join(", ")}`,
        });
      }

      if (uploaded > 0) {
        // 설명은 비운다 — 사진마다 다른 내용을 적는 칸이다. 분류는 그대로 두어
        // 연달아 올릴 때 매번 다시 고르지 않게 한다(state가 따로라 유지된다).
        setDescription("");
        // 앨범에서 고른 파일은 비운다. 안 비우면 다음 업로드가 방금 올린 파일을
        // 다시 집어 같은 파일이 두 번 올라간다. (촬영 쪽은 위에서 올라간 것만
        // 골라 뺐고, 입력 자체는 촬영 때마다 이미 비워진다.)
        if (!fromCamera && fileInputRef.current) fileInputRef.current.value = "";
        // 연달아 올리는 사람이 매번 다시 펼치지 않도록, 올린 직후에는 접기
        // 구역을 펼친 채로 둔다(접기 카드 주석 참조).
        setIsUploadPanelOpen(true);
        // 목록은 서버가 만든다 — 화면에서 지어내지 않고 다시 받아 온다.
        router.refresh();

        /**
         * 🔴 **썸네일이 다 올라간 뒤에 한 번 더 받아 온다.**
         *
         * 바로 위 refresh 는 사진 자체를 지금 당장 보여 주려는 것이고, 그 시점에
         * 썸네일은 아직 서버에 없다(위에서 기다리지 않았으므로). 예전에는 그것이
         * 전부라 목록이 미리보기 없는 상태로 굳었고, 사람이 「미리보기 만들기」를
         * 눌러야 그제서야 보였다(2026-09-04 요구로 없앤 그 과정이다).
         *
         * 여기서도 기다리지 않는다 — 올리는 흐름은 이미 끝났고 이 뒷정리만
         * 혼자 돈다. 실패한 것이 있어도 진행한다(allSettled). 사용자가 이미 다른
         * 탭으로 옮겨 갔을 수 있으므로 refresh 는 감싸 둔다.
         */
        if (previewUploads.length > 0) {
          void Promise.allSettled(previewUploads).then(() => {
            try {
              router.refresh();
            } catch {
              // 화면을 떠났다 — 다음에 열 때 썸네일이 붙은 목록이 온다.
            }
          });
        }
      }
    } catch {
      setStatusMessage({ type: "error", text: "파일을 올리는 중 문제가 생겼습니다." });
    } finally {
      setIsUploading(false);
      setUploadProgress(null);
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
        /*
          기본 접힘 상태다(2026-09-04 요구). 이 탭에서 하는 일의 대부분은 이미
          올라온 파일을 보는 것인데, 올리는 칸이 늘 펼쳐져 있어 목록이 화면
          아래로 밀려나 있었다.

          useState 토글 대신 네이티브 <details>를 쓴 것은 이 앱의 기존 관례를
          따른 것이다(ManualStepSetPanel, 작업 이력의 "워크플로 변경 이력",
          바로 아래 휴지통이 같은 방식). 키보드 조작·접근성은 브라우저가 처리한다.
          (좁은 화면에서만 접히는 FilterDisclosure 는 목적이 달라 쓰지 않는다 —
          여기서는 넓은 화면에서도 접혀 있어야 한다.)

          🔴 **올리는 중에는 접히지 않는다.** 진행 표시와 되돌릴 수 없는 작업이
          그 안에 있다. 막는 방법은 summary 의 click 을 preventDefault 하는
          것이다 — 아예 닫히지 않게 한다.

          ⚠️ `open={... || isUploading}` 으로 "닫혀도 다시 열리게" 하는 길은
          **듣지 않는다.** 사람이 닫으면 브라우저가 DOM 의 open 을 끄는데, 그때
          React 가 넘긴 prop 값은 true 그대로라(true → true) 아무것도 바뀌지
          않은 것으로 보고 DOM 을 되돌리지 않는다. `<details>` 는 input 처럼
          제어 상태를 복구해 주는 물건이 아니다. 그래서 열림 상태는 언제나
          **DOM 을 따라가게** 두고(onToggle), 막을 때는 사건 자체를 막는다.

          올린 직후에도 펼친 채로 둔다(handleUpload 의
          setIsUploadPanelOpen(true)): 연달아 올리는 사람이 매번 다시 펼쳐야
          하면 접은 것이 오히려 불편해진다.

          안에 있는 것은 하나도 빼지 않았다 — 분류·파일 고르기·앱 안 카메라·
          연속 촬영·설명이 그대로 있고, 접기만 씌웠다.
        */
        <details
          open={isUploadPanelOpen}
          onToggle={(event) => setIsUploadPanelOpen(event.currentTarget.open)}
          className="group rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900"
        >
          {/* 손가락이 닿는 자리다. 목록 화면의 고르기 동그라미와 같은 기준(44px)으로 키워 둔다. */}
          <summary
            onClick={(event) => {
              // 올리는 중에는 접지 못한다(위 주석). 키보드로 여는 것도 이
              // click 을 거치므로 한 자리에서 막힌다.
              if (isUploading) event.preventDefault();
            }}
            className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 p-4"
          >
            <div className="flex min-w-0 flex-col">
              <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">파일 올리기</h2>
              {/*
                접혀 있어도 무엇을 하는 구역인지, 그리고 **찍어 두고 아직 올리지
                않은 사진이 있는지**는 보여야 한다. 그것을 감추면 접는 순간
                사진을 잊어버린다.
              */}
              <span className="text-xs font-normal text-zinc-500 dark:text-zinc-400">
                사진·문서를 이 접수 건에 올립니다
                {stagedPhotos.length > 0 ? ` · 찍어 둔 사진 ${stagedPhotos.length}장` : ""}
              </span>
            </div>
            {/*
              네이티브 삼각형 마커를 list-none으로 숨겼으므로 이 문구가 유일한
              상태 표시가 된다. 올리는 중에는 눌러도 접히지 않으므로 "접기"
              대신 그 사정을 적는다 — 안 듣는 단추처럼 보이지 않게.
            */}
            <span className="shrink-0 text-xs font-normal text-zinc-600 dark:text-zinc-400">
              {isUploading ? (
                "올리는 중…"
              ) : (
                <>
                  <span className="group-open:hidden">더보기</span>
                  <span className="hidden group-open:inline">접기</span>
                </>
              )}
            </span>
          </summary>

          <form
            onSubmit={handleUpload}
            className="flex flex-col gap-3 border-t border-zinc-200 p-4 dark:border-zinc-800"
          >
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
                <span className="text-xs text-zinc-500 dark:text-zinc-400">파일 (여러 개 선택 가능)</span>
                {/*
                  multiple은 앨범에서 여러 장을 한 번에 고르는 경로다. 폰 기본
                  카메라로 여러 장 찍어 둔 뒤 앨범에서 골라 올리는 것이 현장에서
                  가장 흔한 방식이라, 촬영 입력(한 장씩)과 함께 둔다.
                */}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={acceptAttribute}
                  multiple
                  disabled={isUploading}
                  onChange={() => {
                    // 찍어 모아 둔 사진이 있으면 그쪽이 우선이라(handleUpload),
                    // 앨범에서 고른 파일이 조용히 무시된다. 그 사실을 미리 알린다.
                    if (stagedPhotos.length > 0) {
                      setStatusMessage({
                        type: "error",
                        text: "찍어 둔 사진이 있어 그쪽이 먼저 올라갑니다. 앨범에서 고른 파일을 올리려면 찍은 사진을 먼저 올리거나 버려 주세요.",
                      });
                    }
                  }}
                  className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                />
              </label>
            </div>

            {cameraSupported && (
              <div className="flex flex-col gap-1 rounded-md border border-dashed border-zinc-300 p-3 dark:border-zinc-700">
                <span className="text-xs text-zinc-500 dark:text-zinc-400">휴대폰으로 바로 촬영</span>
                {/*
                  파일 입력(capture)이 아니라 앱 안에서 도는 카메라다. 그 이유는
                  InAppCamera.tsx 헤더에 적었다 — 요약하면 파일 입력 방식은
                  확인을 누를 때마다 카메라가 닫혀서 두 장에서 멈춘다.
                */}
                <InAppCamera
                  onCapture={stagePhoto}
                  disabled={isUploading}
                  onUnavailable={setCameraUnavailableReason}
                />

                {/*
                  앱 안 카메라는 미리보기 스트림이라 폰 기본 카메라 앱보다 해상도가
                  낮다(InAppCamera.tsx 헤더 "두 가지 대가"). 화면에서는 그 차이가
                  보이지 않아 각인·파형처럼 화질이 필요한 사진까지 여기서 찍게 되고,
                  작게 저장된 것은 현장을 떠난 뒤에야 드러난다. 그래서 카메라가
                  멀쩡할 때도 대체 경로를 늘 옆에 적어 둔다.

                  경고가 아니라 안내이므로 다른 설명문과 같은 회색을 쓴다 — 노란색은
                  아래 "카메라를 못 쓴다" 쪽이 쓰고 있어, 같은 색이면 무언가 잘못된
                  것으로 읽힌다. 그 안내가 떠 있을 때는 이 문구를 내지 않는다.
                  거기에 이미 같은 말이 들어 있어 화면에 두 번 뜨기 때문이다.
                */}
                {!cameraUnavailableReason && (
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    각인·파형처럼 화질이 중요한 사진은 폰 기본 카메라로 찍어 위 <strong>파일</strong> 칸에서 올려 주세요 —
                    앱 안 카메라는 미리보기 화질이라 원본보다 작게 저장됩니다.
                  </p>
                )}

                {cameraUnavailableReason && (
                  <p className="text-xs text-amber-700 dark:text-amber-400">
                    {cameraUnavailableReason} 폰 기본 카메라로 찍은 뒤 위의 <strong>파일</strong> 칸에서 여러 장을 골라
                    올리셔도 됩니다.
                  </p>
                )}

                {stagedPhotos.length > 0 && (
                  <div className="mt-2 flex flex-col gap-2">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                        찍은 사진 {stagedPhotos.length}장 · 올릴 것 {selectedPhotoCount}장
                      </span>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setAllPhotosSelected(true)}
                          disabled={isUploading}
                          className="text-xs text-zinc-600 underline disabled:opacity-50 dark:text-zinc-400"
                        >
                          전체 선택
                        </button>
                        <button
                          type="button"
                          onClick={() => setAllPhotosSelected(false)}
                          disabled={isUploading}
                          className="text-xs text-zinc-600 underline disabled:opacity-50 dark:text-zinc-400"
                        >
                          전체 해제
                        </button>
                        <button
                          type="button"
                          onClick={discardAllPhotos}
                          disabled={isUploading}
                          className="text-xs text-red-700 underline disabled:opacity-50 dark:text-red-400"
                        >
                          전부 버리기
                        </button>
                      </div>
                    </div>

                    <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
                      {stagedPhotos.map((photo, index) => (
                        <li key={photo.id} className="relative">
                          {/*
                            라벨 전체가 누를 수 있는 영역이다 — 폰에서 작은
                            체크박스만 겨냥하게 하면 장갑 낀 손으로 못 누른다.
                          */}
                          <label
                            className={`block cursor-pointer overflow-hidden rounded-md border-2 ${
                              photo.selected
                                ? "border-zinc-900 dark:border-zinc-50"
                                : "border-zinc-200 opacity-60 dark:border-zinc-800"
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={photo.selected}
                              disabled={isUploading}
                              onChange={() => togglePhotoSelected(photo.id)}
                              className="sr-only"
                            />
                            {/*
                              objectURL 미리보기다. next/image를 쓰지 않는 이유는
                              이 주소가 서버에 없는 블롭이라 최적화 대상이 아니고,
                              버릴 때 revokeObjectURL로 직접 놓아 줘야 하기 때문이다.
                            */}
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={photo.previewUrl}
                              alt={`찍은 사진 ${index + 1}장째`}
                              className="aspect-square w-full bg-zinc-100 object-cover dark:bg-zinc-800"
                            />
                            <span className="flex items-center justify-between gap-1 px-1.5 py-1 text-[10px] text-zinc-600 dark:text-zinc-400">
                              <span>{photo.selected ? "올림" : "제외"}</span>
                              <span className="tabular-nums">{formatBytes(photo.file.size)}</span>
                            </span>
                          </label>
                          <button
                            type="button"
                            onClick={() => discardPhoto(photo.id)}
                            disabled={isUploading}
                            aria-label={`${index + 1}장째 사진 버리기`}
                            className="absolute right-1 top-1 rounded bg-black/60 px-1.5 py-0.5 text-[11px] font-medium text-white disabled:opacity-50"
                          >
                            버리기
                          </button>
                        </li>
                      ))}
                    </ul>

                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                      누르면 올릴 사진에서 넣고 뺄 수 있습니다. <strong>버리기</strong>는 이 자리에서만 없애는 것이고,
                      이미 올라간 파일과는 무관합니다.
                    </p>
                  </div>
                )}
              </div>
            )}

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
              여러 장을 한 번에 고르면 <strong>분류와 설명이 모두에 똑같이</strong> 붙습니다. 장마다 다르게 적으려면
              나눠 올리세요.
            </p>

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
                {isUploading
                  ? uploadProgress
                    ? `올리는 중… ${uploadProgress.total}장 중 ${uploadProgress.current}장째`
                    : "올리는 중…"
                  : stagedPhotos.length > 0
                    ? `고른 ${selectedPhotoCount}장 올리기`
                    : "올리기"}
              </button>
            </div>
          </form>
        </details>
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
        <StoredAttachmentList
          attachments={attachments}
          canManage={canManage}
          onDeleteMany={setPendingDeletes}
          isBusy={isMutating}
        />
      )}

      {trashedAttachments.length > 0 && (
        /*
          기본 접힘 상태다(<details>에 open 속성을 주지 않는다). 되살릴 때만
          필요한 목록이라 평소에는 자리를 차지하지 않는 편이 맞다. 잘못 올려
          지운 파일이 쌓이면 이 구역이 화면을 길게 밀어냈다.

          useState 토글 대신 네이티브 <details>를 쓴 것은 이 앱의 기존 관례를
          따른 것이다(ManualStepSetPanel, 작업 이력 화면의 "워크플로 변경
          이력"이 같은 방식). 상태를 늘리지 않고 키보드 조작·접근성은 브라우저가
          처리한다. 접힘 여부는 어디에도 저장하지 않는다.

          접혀 있어도 몇 건이 들어 있는지는 <summary>에 그대로 보인다 — 펼치지
          않고도 되살릴 것이 있는지 알 수 있어야 한다.
        */
        <details className="group">
          {/* 손가락이 닿는 자리다. 목록 화면의 고르기 동그라미와 같은 기준(44px)으로 키워 둔다. */}
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 py-2">
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
              휴지통 <span className="text-xs font-normal text-zinc-500 dark:text-zinc-400">({trashedAttachments.length}건)</span>
            </h2>
            {/* 네이티브 삼각형 마커를 list-none으로 숨겼으므로 이 문구가 유일한 상태 표시가 된다. */}
            <span className="shrink-0 text-xs font-normal text-zinc-600 dark:text-zinc-400">
              <span className="group-open:hidden">더보기</span>
              <span className="hidden group-open:inline">접기</span>
            </span>
          </summary>

          <div className="flex flex-col gap-2">
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              지운 파일은 실물이 그대로 남아 있어 언제든 되살릴 수 있습니다.
            </p>
            <ul className="flex flex-col gap-2">
              {trashedAttachments.map((item) => (
                <li
                  key={item.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 dark:border-zinc-800 dark:bg-zinc-950"
                >
                  <div className="min-w-0">
                    <span className="block truncate text-sm text-zinc-700 line-through dark:text-zinc-400">
                      {item.originalFileName}
                    </span>
                    <span className="block text-xs text-zinc-500 dark:text-zinc-400">
                      {attachmentCategoryLabels[item.category]} · {formatBytes(item.fileSize)} ·{" "}
                      {formatTimestamp(item.deletedAt)}
                      {item.deletedByName ? ` · ${item.deletedByName}` : ""}
                      {item.deleteReason ? ` · ${item.deleteReason}` : ""}
                    </span>
                  </div>
                  {canManage && (
                    <button
                      type="button"
                      onClick={() => setPendingRestore(item)}
                      disabled={isMutating}
                      className="shrink-0 rounded-md border border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-700 hover:bg-white disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
                    >
                      되살리기
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </details>
      )}

      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        악성코드 검사기는 아직 없어 모든 파일은 &ldquo;미검사&rdquo;로 남습니다 — 그 상태에서도 내려받을 수
        있습니다.
      </p>

      <DeleteAttachmentDialog
        isOpen={pendingDeletes.length > 0}
        displayName={
          pendingDeletes.length === 1
            ? pendingDeletes[0].originalFileName
            : `${pendingDeletes.length}건`
        }
        isSubmitting={isMutating}
        onConfirm={handleDeleteConfirm}
        onCancel={() => setPendingDeletes([])}
      />
      <RestoreAttachmentDialog
        isOpen={pendingRestore !== null}
        displayName={pendingRestore?.originalFileName ?? ""}
        isSubmitting={isMutating}
        onConfirm={handleRestoreConfirm}
        onCancel={() => setPendingRestore(null)}
      />
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
