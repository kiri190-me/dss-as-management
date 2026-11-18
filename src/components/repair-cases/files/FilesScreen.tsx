"use client";

import { useMemo, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { FileDropZone, putFilesInPicker } from "@/components/common/FileDropZone";
import { showSavePopup } from "@/components/common/SavePopup";
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
  attachmentCategoriesForOwner,
  attachmentCategoryLabels,
  type AttachmentCategory,
} from "@/lib/domain/attachment-category";
import {
  MAX_ATTACHMENT_SIZE_BYTES,
  isExtensionAllowedForCategory,
  normalizeFileExtension,
} from "@/lib/domain/attachment-allowlist";
/**
 * 아이폰 사진(heic)을 고를 수 있게 하고 보내기 전에 jpg 로 바꾸는 한 벌(2026-11-18).
 * 🔴 허용목록은 한 글자도 안 바뀌었다 — 서버로 가는 것은 지금도 jpg 다(그쪽 머리말).
 * `allowedExtensionsFor` 는 그 판정이 전부 이 목록에서 갈려서 함께 옮겨 갔다.
 */
import {
  allowedExtensionsFor,
  categoryTakesPhotos,
  convertPickedHeic,
  heicConversionNotice,
  pickerAcceptAttribute,
  type HeicRename,
} from "./heic-upload";
import { convertHeicToJpeg } from "./heic-to-jpeg";
/**
 * 올릴 때 **파일 이름을 미리 정하는** 한 벌(2026-11-18 사용자 요청 — 「설명 (선택)」이
 * 있던 자리다). 번호 규칙 · 확장자 · 막는 글자의 까닭은 전부 그쪽 머리말에 있고,
 * 여기서는 **보내기 직전에 한 번** 부른다(아이폰 사진을 구운 뒤).
 */
import {
  heicRenamesWithUploadNames,
  uploadFileNameError,
  uploadFileNamesFor,
  UPLOAD_FILE_NAME_MAX_LENGTH,
} from "./upload-file-name";
import type {
  RepairCaseAttachmentListItem,
  TrashedAttachmentListItem,
} from "@/lib/db/queries/attachments";
// 데모 계층에도 같은 이름의 함수가 있어 별칭을 붙인다 — 이름이 같지만 하는 일이
// 다르다(한쪽은 브라우저 저장소, 한쪽은 실제 DB).
import {
  purgeAttachmentAction,
  restoreAttachmentAction,
  softDeleteAttachmentAction,
} from "@/lib/server/actions/attachments";
import LoadingNotice from "@/components/domain/LoadingNotice";
import {
  preventShiftClickTextSelection,
  shiftKeyOf,
  useShiftRangeSelection,
} from "@/lib/hooks/useShiftRangeSelection";
import InAppCamera from "./InAppCamera";
import {
  contactFolderCopyNotice,
  readContactFolderCopyNote,
  type ContactFolderCopyNote,
} from "./contact-folder-copy-notice";
import { uploadPreview } from "./shrink-image";
import StoredAttachmentList from "./StoredAttachmentList";
import AttachmentCardList from "./AttachmentCardList";
import AttachmentEventTimeline from "./AttachmentEventTimeline";
import AttachmentFilters from "./AttachmentFilters";
import AttachmentFormDialog, { type AttachmentFormSubmitInput } from "./AttachmentFormDialog";
import AttachmentSummaryCards from "./AttachmentSummaryCards";
import AttachmentTable from "./AttachmentTable";
import { ResponsiveList } from "@/components/common/responsive-list";
import type { KindShareDocRow } from "@/components/product-models/KindShareDocsSection";
import type { ModelShareDocRow } from "@/components/product-models/ModelShareDocsSection";
import { productModelKindOfWorkflowKind } from "@/lib/domain/product-model-kind";
import { workflowKindOf } from "@/lib/domain/workflow-kind";
import CaseKindShareDocsSection from "./CaseKindShareDocsSection";
import CaseModelShareDocsSection from "./CaseModelShareDocsSection";
import ContactFolderSection from "./ContactFolderSection";
import DeleteAttachmentDialog from "./DeleteAttachmentDialog";
import EditMetadataDialog from "./EditMetadataDialog";
import PurgeAttachmentDialog from "./PurgeAttachmentDialog";
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
  /**
   * 🔴 사내 공유폴더(연락서 폴더) 기능이 켜져 있는가(조각 12). 서버가 설정을 보고
   * 정한다 — 꺼져 있으면 목록에 [DATA에 저장]이 **아예 그려지지 않는다.**
   */
  contactFolderEnabled?: boolean;
  /**
   * 🔴 가리킨 공유폴더 서류를 **이 건의 연락서 폴더로 가져올 수 있는가**(2026-10-08).
   * 읽을 곳(수리 관련)과 쓸 곳(연락서 폴더)이 **둘 다** 설정됐고 파일 권한이 있을 때만
   * 참이다 — 서버가 정한다. 거짓이면 아래 두 구역이 [연락서 폴더에 저장]을 **아예
   * 그리지 않는다.**
   */
  shareDocCopyEnabled?: boolean;
  /**
   * 🔴 **이 건의 종류**가 가리켜 둔 공유폴더 서류들(2026-10-07). 서버가 DB 에서 읽어
   * **보이는 차례 그대로** 넘긴다 — 바이트가 아니라 경로 줄이라 첨부 목록과는 전혀 다른
   * 것이고, 한 줄도 없으면 구역이 아예 그려지지 않는다(CaseKindShareDocsSection).
   */
  kindShareDocs?: readonly KindShareDocRow[];
  /**
   * 🔴 **이 건의 제품 모델**이 가리켜 둔 공유폴더 서류들(2026-10-08). 위 종류 쪽과 **다른
   * 것**이다 — 저쪽은 그 종류 전체가 함께 쓰고 이쪽은 이 모델 하나의 자리다. 서버가 DB 에서
   * 읽어 **보이는 차례 그대로** 넘기고, 모델을 못 찾은 건(장비가 마스터에 안 묶였거나 모델이
   * 휴지통)에는 **빈 목록**이 온다 — 구역이 스스로 사라진다(CaseModelShareDocsSection).
   */
  modelShareDocs?: readonly ModelShareDocRow[];
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
        contactFolderEnabled={props.contactFolderEnabled ?? false}
        shareDocCopyEnabled={props.shareDocCopyEnabled ?? false}
        kindShareDocs={props.kindShareDocs ?? []}
        modelShareDocs={props.modelShareDocs ?? []}
      />
    );
  }
  return <DemoFilesScreen resolved={props.resolved} actingUser={props.actingUser} />;
}

// ============================================================================
// 실제 저장
// ============================================================================

/**
 * 올리기 칸의 분류 선택지 — 접수 건 파일이 받는 분류만. 「스크린샷」은 개선 요청 글
 * 전용이라, 「파라미터」·「통전검사」는 제품 모델 전용이라 빠진다
 * (attachment-category.ts 의 isAttachmentCategoryAllowedForOwner — 올리기 통로도
 * 같은 함수로 거절한다).
 *
 * 🔴 **「점검표」는 여기 있다**(2026-09-30 사용자). 모델 쪽 점검표가 빈 양식이라면
 * 여기 것은 그 건에서 실제로 채워 인쇄한 기록이다. 목록을 손으로 적지 않으므로
 * 이 화면은 고칠 것이 없었다.
 */
const REPAIR_CASE_UPLOAD_CATEGORIES = attachmentCategoriesForOwner("REPAIR_CASE");

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
  contactFolderEnabled,
  shareDocCopyEnabled,
  kindShareDocs,
  modelShareDocs,
}: {
  resolved: ResolvedRepairCase;
  actingUser: ActingUser | null;
  attachments: RepairCaseAttachmentListItem[];
  trashedAttachments: TrashedAttachmentListItem[];
  canUpload: boolean;
  canManage: boolean;
  contactFolderEnabled: boolean;
  shareDocCopyEnabled: boolean;
  kindShareDocs: readonly KindShareDocRow[];
  modelShareDocs: readonly ModelShareDocRow[];
}) {
  const router = useRouter();
  const { effective, isHydrated } = useEffectiveRepairCase(resolved);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [category, setCategory] = useState<AttachmentCategory>("INTAKE_PHOTO");
  /**
   * 🔴 **저장될 파일 이름**(2026-11-18 사용자 요청). 2026-11-18 전까지 이 자리에는
   * 「설명 (선택)」 칸이 있었다 — 그 칸만 없어졌고, **설명 자체는 그대로 산다**:
   * 이미 적힌 설명은 목록·뷰어에 그대로 뜨고, 올리기 통로도 지금껏처럼 `description`
   * 질의값을 받는다(route.ts). 화면이 더 이상 보내지 않을 뿐이다.
   *
   * 비워 두면 **지금까지와 똑같다** — 고른 파일의 이름이 그대로 올라간다.
   */
  const [fileName, setFileName] = useState("");
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
   * 🔴 공유폴더 구역에 보내는 **「다시 읽어라」 신호**(2026-10-05 사용자 요청).
   *
   * 올린 파일은 그 건의 연락서 폴더에도 한 벌 들어간다(조각 6). 그런데 그 구역은 화면이 뜰
   * 때 한 번만 읽어서, 올린 직후에는 **새로고침해야** 보였다. 아래 handleUpload 가 DB 목록을
   * 다시 받아 오는(router.refresh) **바로 그 자리에서** 이 숫자를 하나 올린다.
   *
   * 🔴 DB 첨부 목록 갱신 방식은 한 글자도 바뀌지 않았다 — 그 목록은 지금도 서버가 만든다.
   * 🔴 다시 읽기가 실패해도 **올리기 결과 알림(statusMessage · 저장 팝업)은 그대로다** —
   *    읽기는 저 구역 안에서 끝나고, 실패하면 그 구역만 「읽지 못했습니다」가 된다.
   * 🔴 하위 폴더에 들어가 있으면 **그 자리를 그대로 두고** 다시 읽는다(구역이 자리를 쥔다).
   */
  const [contactFolderReloadToken, setContactFolderReloadToken] = useState(0);

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
  /**
   * 🔴 아이폰 사진을 jpg 로 **바꾸는 중**인지(2026-11-18). 올리기 진행 표시와 **다른
   * 칸**이다 — 같은 칸을 돌려 쓰면 「올리는 중 3장째」가 떠 있는데 실제로는 아직 한
   * 장도 안 보내고 사진을 굽고 있는 상태가 된다. 큰 사진은 한 장에 몇 초가 걸려서,
   * 그때 아무 표시가 없으면 멈춘 줄 안다.
   */
  const [conversionProgress, setConversionProgress] = useState<{ current: number; total: number } | null>(null);

  // 지우기·되살리기 다이얼로그. 데모 화면이 쓰던 컴포넌트를 그대로 재사용한다.
  // 지우기는 **여러 건을 함께** 받는다 — 목록에서 여러 개를 골라 한 번에
  // 지울 수 있고, 한 건짜리는 길이 1인 목록일 뿐이다. 확인 창을 한 번만 띄우려면
  // 사유도 한 번만 받아야 하므로 이 모양이 자연스럽다.
  const [pendingDeletes, setPendingDeletes] = useState<RepairCaseAttachmentListItem[]>([]);
  const [pendingRestore, setPendingRestore] = useState<TrashedAttachmentListItem | null>(null);
  /**
   * 🔴 영구 삭제 대기(2026-10-07). 되살리기와 **다른 상태**다 — 한 창에 두 성질을
   * 담지 않는다(PurgeAttachmentDialog 머리말). 휴지통 줄에서만 세워진다.
   */
  const [pendingPurge, setPendingPurge] = useState<TrashedAttachmentListItem | null>(null);
  const [isMutating, setIsMutating] = useState(false);

  async function handleDeleteConfirm(reason: string) {
    if (pendingDeletes.length === 0) return;
    setIsMutating(true);
    setStatusMessage(null);
    try {
      // 한 건씩 차례로 보낸다. 한 건이 막혀도(휴지통에 있는 견적서의 파일 등) 나머지는
      // 지운다 — 여러 개를 고른 사람에게 "하나가 안 되니 전부 취소"는 도움이 안 된다.
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

  /** 🔴 되돌릴 수 없다 — 디스크 파일까지 지운다(2026-10-07). */
  async function handlePurgeConfirm() {
    const target = pendingPurge;
    if (!target) return;
    setIsMutating(true);
    setStatusMessage(null);
    try {
      const result = await purgeAttachmentAction({
        attachmentId: target.id,
        repairCaseId: resolved.id,
      });
      // 성공이든 실패든 확인 창을 닫는다 — 열어 둔 채 아래에 이유를 적으면 그 글이
      // 창 뒤에 가려 사용자는 아무 일도 안 일어난 것으로 본다.
      setPendingPurge(null);
      if (!result.ok) {
        setStatusMessage({ type: "error", text: result.message });
        return;
      }
      setStatusMessage({
        type: "success",
        text: `${target.originalFileName} 을(를) 영구 삭제했습니다. 되돌릴 수 없습니다.`,
      });
      router.refresh();
    } finally {
      setIsMutating(false);
    }
  }

  const allowedExtensions = useMemo(() => allowedExtensionsFor(category), [category]);
  /**
   * 형식을 가리지 않는 분류에서는 **undefined** 다 — 빈 문자열이 아니다. 빈
   * 문자열을 넣으면 브라우저가 "받는 형식이 없다"로 읽어 고르는 창이 아무것도
   * 내놓지 않는 날이 있다. 속성을 아예 달지 않아야 모든 파일이 보인다.
   *
   * 🔴 사진을 받는 분류에는 `.heic,.heif` 가 뒤에 붙는다(2026-11-18 — heic-upload.ts).
   * 앞의 목록은 지금까지와 한 글자도 다르지 않다 — 허용목록에서 뽑은 그대로다.
   */
  const acceptAttribute = useMemo(() => pickerAcceptAttribute(allowedExtensions), [allowedExtensions]);
  /**
   * 이 분류가 사진을 받는가 — 받을 때만 촬영 입력을 내민다.
   *
   * 촬영으로 들어오는 파일은 브라우저가 정하고(보통 jpg), 확장자를 고를 수
   * 없다. 그래서 사진을 아예 안 받는 분류(펌웨어·로그 등)에 촬영 버튼을 두면
   * 찍는 순간까지 갔다가 거절당한다 — 그 앞에서 감춘다.
   *
   * 형식을 가리지 않는 분류(점검표)는 **참**이다 — jpg 도 받으므로 찍어서 올릴 수
   * 있고, 인쇄한 점검표를 폰으로 찍어 올리는 것이 그 분류의 실제 쓰임이다.
   *
   * 🔴 **아이폰 사진(heic)을 고를 수 있는지도 같은 값이 정한다**(2026-11-18). 판정을
   * 둘로 두면 「촬영은 되는데 아이폰 사진은 못 고르는」 분류가 생기고, 그 어긋남은
   * 오류 없이 화면에서만 드러난다. 그래서 이름도 촬영 전용에서 바꿨다.
   */
  const takesPhotos = useMemo(() => categoryTakesPhotos(allowedExtensions), [allowedExtensions]);
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

  /**
   * 한 장 누르기와 Shift 로 사이를 한꺼번에 넣고 빼기(useShiftRangeSelection).
   * 범위의 순서는 찍은 순서, 곧 격자에 그려진 순서다. 선택이 사진마다의
   * 깃발(selected)이라 그 깃발을 직접 맞춘다.
   */
  const photoRangeSelection = useShiftRangeSelection({
    orderedIds: stagedPhotos.map((photo) => photo.id),
    isSelected: (id) => stagedPhotos.some((photo) => photo.id === id && photo.selected),
    apply: (ids, checked) => {
      const targets = new Set(ids);
      setStagedPhotos((previous) =>
        previous.map((photo) => (targets.has(photo.id) ? { ...photo, selected: checked } : photo))
      );
    },
  });

  function togglePhotoSelected(id: string, shiftKey: boolean) {
    photoRangeSelection.toggle(id, shiftKey);
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
    file: File,
    /**
     * 🔴 **저장될 이름.** 파일 객체의 이름이 아니라 따로 받는다 — 사람이 [파일 이름]
     * 칸에 적었으면 거기에 번호까지 붙은 이름이고(upload-file-name.ts), 안 적었으면
     * `file.name` 그대로다. 파일 객체를 새로 지어 이름만 바꾸지 않는 까닭은 바이트를
     * 쥔 객체를 폰에서 한 벌 더 만들 일이 없어서다.
     */
    uploadName: string
  ): Promise<
    | { ok: true; previewUpload: Promise<void> | null; contactFolderCopy: ContactFolderCopyNote | null }
    | { ok: false; reason: string }
  > {
    try {
      // 본문은 파일 바이트 그 자체이고 메타데이터는 쿼리 문자열이다 —
      // multipart로 보내면 서버가 파일 전체를 메모리에 올려야 한다
      // (라우트 핸들러 주석 참조).
      //
      // 🔴 `description` 은 **더 이상 싣지 않는다**(2026-11-18 — 적는 칸이 없어졌다).
      //    통로 쪽은 한 글자도 안 건드렸다. 받는 자리가 그대로 남아 있어야 다른 데서
      //    부를 수 있고, 이미 적혀 있는 설명도 그대로 산다.
      const query = new URLSearchParams({ category, fileName: uploadName });

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

      // 🔴 공유폴더(연락서 폴더) 사본의 결과. 서버는 **올리기와 따로** 알려 준다 — 사본이
      // 실패해도 올리기는 성공이므로 여기서 ok 를 뒤집지 않는다. 기능이 꺼진 환경에서는
      // 이 칸이 아예 없고, 그때는 화면도 아무 말을 하지 않는다.
      return { ok: true, previewUpload, contactFolderCopy: readContactFolderCopyNote(created) };
    } catch {
      return { ok: false, reason: "네트워크 문제" };
    }
  }

  /**
   * 앨범에서 고르거나 폴더에서 끌어다 놓았을 때 한 번씩. 찍어 모아 둔 사진이 있으면
   * 그쪽이 우선이라(handleUpload) 여기서 들어온 파일이 조용히 무시된다 — 그 사실을
   * 미리 알린다. 두 길이 같은 말을 하도록 한 자리에 둔다.
   */
  function notePickedFiles() {
    if (stagedPhotos.length > 0) {
      setStatusMessage({
        type: "error",
        text: "찍어 둔 사진이 있어 그쪽이 먼저 올라갑니다. 앨범에서 고른 파일을 올리려면 찍은 사진을 먼저 올리거나 버려 주세요.",
      });
    }
  }

  /**
   * 끌어다 놓은 파일은 **고르기 칸에 그대로 담는다**(putFilesInPicker) — [올리기]가
   * 읽는 곳이 한 곳으로 남아야 rejectionReasonFor 도 같은 길을 지난다.
   */
  function receiveDroppedFiles(files: File[]) {
    if (!putFilesInPicker(fileInputRef.current, files)) return;
    notePickedFiles();
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

    /**
     * 🔴 적어 둔 이름을 **아이폰 사진을 굽기 전에** 본다. 큰 사진 몇 장을 몇 초씩 들여
     * 바꾼 **뒤에** 「이름에 / 가 있습니다」로 되돌리는 것이 가장 나쁘다. 진짜 이름
     * 짓기는 굽고 난 뒤에 한 번 더 돈다(확장자가 거기서 갈린다).
     */
    const fileNameError = uploadFileNameError(fileName);
    if (fileNameError) {
      setStatusMessage({ type: "error", text: fileNameError });
      return;
    }

    setIsUploading(true);
    setStatusMessage(null);
    setUploadProgress(null);
    setConversionProgress(null);

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
    /**
     * 장마다의 **공유폴더 사본 결과.** 올리기 성공/실패와 **따로** 모은다 — 사본이
     * 실패해도 올리기는 성공이고(라우트 머리말 6), 그 사실만 아래에서 한 줄로 알린다.
     */
    const contactFolderCopies: ContactFolderCopyNote[] = [];
    let uploaded = 0;
    /**
     * 🔴 **보낼 목록.** heic 를 바꾸고 나면 여기서부터 갈린다 — 바뀐 장은 이름도
     * 바이트도 다른 새 File 이고, 못 바꾼 장은 빠진다. heic 가 없으면 고른 그대로다.
     */
    let outgoing: File[] = [...files];
    /** 바뀐 이름을 사람에게 알릴 한 줄(없으면 null). 아래 알림 칸으로 간다. */
    let heicNotice: string | null = null;
    /**
     * 아이폰 사진에서 **무엇이 무엇이 됐는지**. 🔴 알림 한 줄은 여기서 바로 짓지 않고
     * **저장될 이름을 정한 뒤에** 짓는다 — 사람이 [파일 이름]을 적었으면 목록에 뜨는
     * 것은 `IMG_1234.jpg` 가 아니라 그 이름이고, 그대로 적으면 안내가 거짓말이 된다.
     */
    let heicRenamed: readonly HeicRename[] = [];

    try {
      /**
       * 🔴 **아이폰 사진(heic)은 보내기 전에 jpg 로 바꾼다**(2026-11-18 사용자 결정).
       * 까닭·울타리는 heic-upload.ts 머리말 — 요약하면 크롬이 heic 를 못 그려서
       * 그대로 저장하면 목록·뷰어·새 탭 어디서도 안 보이고, 서버에는 다시 구울
       * 도구가 없다. 🔴 **허용목록은 안 바뀌었다** — 통로로 가는 것은 지금도 jpg 다.
       *
       * 🔴 **찍어 모아 둔 사진(fromCamera)은 이 길을 지나지 않는다.** 둘 다 까닭이
       * 있다: InAppCamera 가 캔버스에서 만든 것이라 이미 image/jpeg 이고, 아래
       * 올리기 고리가 `chosenPhotos[index]` 로 **차례를 맞춰** 쓰기 때문에 한 장이라도
       * 빠지면 엉뚱한 사진이 「올렸다」 처리되어 목록에서 사라진다.
       *
       * 🔴 사진을 안 받는 분류(펌웨어·로그·오실로스코프 등)도 지나지 않는다 — 바꿔
       * 봐야 그 분류가 jpg 를 안 받아 거절된다. 몇 초를 들여 바꾼 **뒤에** 거절하는
       * 것이 가장 나쁘다.
       */
      if (!fromCamera && takesPhotos) {
        const outcome = await convertPickedHeic(files, {
          convert: convertHeicToJpeg,
          onProgress: (current, total) => setConversionProgress({ current, total }),
        });
        outgoing = outcome.files;
        // 못 바꾼 장은 올리기 실패와 **같은 목록**에 넣는다 — 아래 알림이 한 줄로
        // 「무엇이 왜 빠졌는지」를 말한다(조용히 삼키지 않는다).
        failures.push(...outcome.failures);
        heicRenamed = outcome.renamed;
        setConversionProgress(null);
      }

      /**
       * 🔴 **저장될 이름을 여기서 정한다**(2026-11-18) — 아이폰 사진을 구운 **뒤**다.
       * 확장자가 그 자리에서 `.heic` → `.jpg` 로 갈리기 때문이고, 반대로 두면
       * `보고서.heic` 라는 이름에 jpeg 바이트를 실어 보내 서버의 내용 대조에서 막힌다.
       * 규칙(한 장이면 번호 없음 · 여럿이면 (1)(2) · 비면 그대로)은 upload-file-name.ts.
       *
       * 🔵 이 목록은 `outgoing` 과 **같은 길이 · 같은 차례**다 — 아래 고리가 index 로
       *    짝을 맞춘다. 찍어 둔 사진 쪽이 `chosenPhotos[index]` 를 쓰는 것과 같은 줄이다.
       */
      const outgoingNames = outgoing.map((file) => file.name);
      const naming = uploadFileNamesFor({ baseName: fileName, fileNames: outgoingNames });
      if (!naming.ok) {
        setStatusMessage({ type: "error", text: naming.message });
        return;
      }
      const uploadNames = naming.names;
      // 바뀐 이름 줄의 「→ 뒤」를 **최종 이름**으로 갈아 끼운 뒤에 짓는다(위 주석).
      heicNotice = heicConversionNotice(
        heicRenamesWithUploadNames(heicRenamed, outgoingNames, uploadNames)
      );

      for (const [index, file] of outgoing.entries()) {
        if (outgoing.length > 1) {
          setUploadProgress({ current: index + 1, total: outgoing.length });
        }

        const rejection = rejectionReasonFor(file);
        if (rejection) {
          // 🔵 빠진 장은 **고른 이름**으로 적는다 — 적어 둔 이름에 번호가 붙은 쪽
          //    (`점검사진 (2).txt`)으로 말하면 사람이 어느 파일인지 다시 세어야 한다.
          failures.push({ name: file.name, reason: rejection });
          continue;
        }

        const result = await uploadOne(file, uploadNames[index]);
        if (result.ok) {
          uploaded += 1;
          if (result.previewUpload) previewUploads.push(result.previewUpload);
          if (result.contactFolderCopy) contactFolderCopies.push(result.contactFolderCopy);
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

      /**
       * 🔴 공유폴더 쪽 결과는 **저장 팝업에 싣지 않는다** — 그 팝업은 0.5 초 뒤 저절로
       * 닫히는 성공 전용이라 읽어야 하는 문장을 담을 자리가 아니다. 화면에 남는 알림 칸
       * (statusMessage)으로 보낸다. 기능이 꺼진 환경에서는 null 이라 예전 그대로다.
       */
      const copyNotice = contactFolderCopyNotice(contactFolderCopies);
      /**
       * 🔴 **화면에 남겨야 읽히는 줄들**을 한 자리에 모은다(공유폴더 결과 · 바뀐 이름).
       * 저장 팝업은 0.5초 뒤 닫히는 성공 전용이라 이 글이 거기 실리면 안 된다.
       *
       * 🔴 바뀐 이름은 **올린 것이 있을 때만** 말한다 — 한 장도 못 올렸으면 「바꿔서
       * 올렸습니다」가 거짓말이 되고, 못 바꾼 장은 이미 실패 목록에 제 까닭으로 적힌다.
       */
      const extraNotices = [uploaded > 0 ? heicNotice : null, copyNotice?.text ?? null].filter(
        (part): part is string => part !== null
      );
      const extraText = extraNotices.length > 0 ? extraNotices.join(" / ") : null;

      if (uploaded > 0 && failures.length === 0) {
        const remaining = stagedPhotos.length - uploadedPhotoIds.length;
        // 다 올라갔으면 저장 팝업으로 알린다(접수 건 안에 딸린 것이라 머문다).
        // 몇 장이 빠진 경우는 무엇이 빠졌는지 읽어야 하므로 아래처럼 화면에 남긴다.
        //
        // 🔴 한 장일 때의 이름은 **저장된 이름**(uploadNames)이다 — heic 를 골랐으면
        //    목록에 뜨는 이름이 그 jpg 이름이고, [파일 이름]을 적었으면 그 이름이다.
        //    고른 이름을 적으면 사람이 목록에서 그 이름을 찾다가 못 찾는다.
        const message = fromCamera
          ? `사진 ${uploaded}장을 올렸습니다.${remaining > 0 ? ` 고르지 않은 ${remaining}장은 그대로 있습니다.` : ""}`
          : outgoing.length === 1
            ? `"${uploadNames[0]}"을(를) 올렸습니다.`
            : `${uploaded}장을 모두 올렸습니다.`;
        showSavePopup({ message, redirectTo: null });
        if (extraText) setStatusMessage({ type: copyNotice?.tone ?? "success", text: extraText });
      } else if (uploaded > 0) {
        const text = `${uploaded}장을 올렸고 ${failures.length}장은 빠졌습니다 — ${failures
          .map((item) => `${item.name}(${item.reason})`)
          .join(", ")}`;
        // 올린 것 가운데 공유폴더에 못 들어간 것이 있으면 그 줄도 함께 남긴다.
        setStatusMessage({ type: "error", text: extraText ? `${text} / ${extraText}` : text });
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
        // 파일 이름은 비운다 — 장마다 다른 이름을 적는 칸이다. 그대로 두면 연달아
        // 올릴 때 같은 이름이 또 붙어 목록에 같은 이름이 둘 선다(연락서 폴더 쪽은
        // 겹치는 이름에 (2) 를 붙여 두 벌이 생긴다). 분류는 그대로 두어 연달아 올릴
        // 때 매번 다시 고르지 않게 한다(state가 따로라 유지된다).
        setFileName("");
        // 앨범에서 고른 파일은 비운다. 안 비우면 다음 업로드가 방금 올린 파일을
        // 다시 집어 같은 파일이 두 번 올라간다. (촬영 쪽은 위에서 올라간 것만
        // 골라 뺐고, 입력 자체는 촬영 때마다 이미 비워진다.)
        if (!fromCamera && fileInputRef.current) fileInputRef.current.value = "";
        // 연달아 올리는 사람이 매번 다시 펼치지 않도록, 올린 직후에는 접기
        // 구역을 펼친 채로 둔다(접기 카드 주석 참조).
        setIsUploadPanelOpen(true);
        // 목록은 서버가 만든다 — 화면에서 지어내지 않고 다시 받아 온다.
        router.refresh();
        // 🔴 공유폴더 구역도 같은 자리에서 다시 읽게 한다 — 올린 사본이 **새로고침 없이**
        //    보이도록(위 주석). 공유폴더에 못 들어갔거나 기능이 꺼져 있어도 안전하다 —
        //    그때는 다시 읽어도 달라질 것이 없고, 읽기가 실패해도 이 알림은 그대로 남는다.
        setContactFolderReloadToken((token) => token + 1);

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
      setConversionProgress(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* 🔴 머리말 상자를 여기서 그리지 않는다 (2026-10-06 사용자 지시) — 탭 위의
          머리 카드(DetailHeader)와 겹쳐 같은 정보가 두 상자에 나왔다. 그 상자에만
          있던 고객사 · 모델은 카드 한 줄로 옮겨 갔다. */}
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
          연속 촬영이 그대로 있고, 접기만 씌웠다. (「설명」 칸이 있던 자리는
          2026-11-18 에 「파일 이름 (선택)」으로 바뀌었다 — 그 칸의 주석 참조.)
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
            {/*
              폴더에서 끌어다 놓아도 된다. 떨군 파일은 고르기 칸에 담기므로
              [올리기] 뒤의 판정(rejectionReasonFor)까지 고르기와 **같은 길**이다.
            */}
            <FileDropZone
              name="repair-case-files-upload"
              multiple
              disabled={isUploading}
              hint="여기에 파일을 놓으세요 — 놓은 뒤 [올리기]"
              onFiles={receiveDroppedFiles}
              className="grid gap-3 rounded-md border border-dashed border-zinc-300 p-3 sm:grid-cols-2 dark:border-zinc-700"
            >
              {/*
                🔴 **`min-w-0` 과 `max-w-full` 은 한 벌이다**(2026-11-18 폰 신고 —
                좁은 화면에서 이 두 칸이 점선 테두리 밖으로 삐져나와 있었다). 고칠
                자리가 **두 겹**인 까닭:
                  · 이 라벨은 grid 칸이고, grid·flex 칸의 기본값은 `min-width: auto`
                    라 **속의 최소 폭보다 좁아지지 못한다.** 그래서 칸 쪽에 `min-w-0`.
                  · 속의 두 칸은 제 내용만큼을 최소 폭으로 들고 있다 — 분류는 가장 긴
                    이름(「오실로스코프 데이터」 10글자), 고르기 칸은 브라우저가 제
                    손으로 그리는 「파일 선택 선택된 파일 없음」이다. 그래서 속 쪽에
                    `max-w-full`.
                한 겹만 고치면 안 풀린다 — 칸이 줄어들어도 속이 그대로 넘치거나, 속이
                칸을 따라도 칸 자신이 안 줄어든다.

                🔴 **넓은 화면은 건드리지 않았다** — `w-full`(폭을 정한다)이 아니라
                `max-w-full`(넘지 못하게만 한다)을 고른 까닭이 그것이다. 상한이 칸 폭
                그 자체라, 칸 안에 들어와 있던 것은 그대로 서고 넘치던 것만 칸에 맞춰
                접힌다. 두 칸이 나란히 서는 `sm:` 위는 애초에 넘치지 않으므로 달라지는
                것이 없다(`sm:grid-cols-2` 도 그대로다).
              */}
              <label className="flex min-w-0 flex-col gap-1 text-sm">
                <span className="text-xs text-zinc-500 dark:text-zinc-400">분류</span>
                <select
                  value={category}
                  onChange={(event) => setCategory(event.target.value as AttachmentCategory)}
                  disabled={isUploading}
                  className="max-w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                >
                  {REPAIR_CASE_UPLOAD_CATEGORIES.map((code) => (
                    <option key={code} value={code}>
                      {attachmentCategoryLabels[code]}
                    </option>
                  ))}
                </select>
              </label>

              {/* 폭 두 겹(min-w-0 · max-w-full)은 바로 위 분류 칸과 같은 까닭이다. */}
              <label className="flex min-w-0 flex-col gap-1 text-sm">
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
                  onChange={notePickedFiles}
                  className="max-w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                />
                <span className="text-xs text-zinc-500 dark:text-zinc-400">
                  폴더에서 이 칸 위로 끌어다 놓아도 됩니다.
                </span>
                {/*
                  🔴 **안내 한 줄을 여기서 뺐다**(2026-11-18 사용자 요청 「설명은 없어도
                  될 것 같아」). 아이폰 사진(.heic·.heif)이 올릴 때 .jpg 로 바뀐다는 줄을
                  고르기 칸 아래에 달고 있었다. 🔴 **기능은 한 글자도 안 바뀌었다** —
                  heic 는 지금도 고를 수 있고(accept), 보내기 전에 jpg 로 구워지고,
                  **바꾼 뒤에는 그대로 알린다**(heicConversionNotice — 어떤 이름이 어떤
                  이름이 됐는지까지 적는 그 줄이다). 미리 말하던 것을 그만두었을 뿐이라
                  이름이 바뀐 사실이 묻히지는 않는다.
                */}
              </label>
            </FileDropZone>

            {takesPhotos && (
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
                  🔴 **평소에 떠 있던 안내 한 줄을 뺐다**(2026-11-18 사용자 요청 「설명은
                  없어도 될 것 같아」). 「각인·파형처럼 화질이 중요한 사진은 폰 기본
                  카메라로 찍어 위 파일 칸에서 올려 주세요 — 앱 안 카메라는 미리보기
                  화질이라 원본보다 작게 저장됩니다.」였고, 카메라가 멀쩡할 때도 늘 떠
                  있었다.

                  🔴 **그 사실 자체는 그대로다** — 앱 안 카메라가 미리보기 스트림이라
                  폰 기본 카메라 앱보다 해상도가 낮다는 것(InAppCamera.tsx 머리말 「두
                  가지 대가」)은 여전하고, 대체 경로(위 [파일] 칸)도 그대로 있다. 없앤
                  것은 화면에 적던 글 한 줄뿐이다.

                  🔴 **아래 노란 줄은 다른 것이다 — 남는다.** 그쪽은 카메라를 아예 못
                  쓸 때만 뜨고(권한 거부 · 장치 없음), 그때는 찍을 길이 없으므로 파일
                  칸으로 가라는 말이 **유일한 길 안내**가 된다.
                */}
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
                            onMouseDown={preventShiftClickTextSelection}
                          >
                            <input
                              type="checkbox"
                              checked={photo.selected}
                              disabled={isUploading}
                              onChange={(event) => togglePhotoSelected(photo.id, shiftKeyOf(event))}
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
                              // object-contain이다 — 잘라 채우면 파형 눈금과 외관
                              // 흠집이 양 끝에서 사라진다. 여기는 올릴지 뺄지를
                              // 고르는 자리라, 잘린 가운데만 보고 고르면 정작
                              // 찍으려던 것이 빠진 사진을 올리게 된다. 맞춰 넣어
                              // 남는 자리는 bg-zinc-100/800 이 받는다(칸 크기는
                              // aspect-square w-full 그대로).
                              className="aspect-square w-full bg-zinc-100 object-contain dark:bg-zinc-800"
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

            {/*
              🔴 **2026-11-18 전까지 이 자리는 「설명 (선택)」이었다.** 사용자 요청으로
              **저장될 파일 이름을 적는 칸**으로 바뀌었다 — 「그 의미는 저장되는 파일의
              이름을 설정하는 거고 거기에 작성되는 이름에 (1), (2) 로 번호가 붙도록」.

              🔴 **설명 기능을 없앤 것이 아니다.** 이미 적혀 있는 설명은 목록·뷰어에
              그대로 뜨고(StoredAttachmentList · AttachmentViewer), 올리기 통로도 지금껏
              처럼 `description` 질의값을 받는다. **올릴 때 적는 칸 하나**가 없어졌을
              뿐이다.

              🔴 적은 이름은 **표시 이름이면서 동시에 연락서 폴더에 적히는 파일 이름**이
              된다(upload-file-name.ts 머리말). 그래서 경로 글자를 막는 일이 그냥 모양새
              문제가 아니다 — 막는 자리는 「표시 이름 변경」 창과 **같은 함수**다.
            */}
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-xs text-zinc-500 dark:text-zinc-400">파일 이름 (선택)</span>
              <input
                type="text"
                value={fileName}
                maxLength={UPLOAD_FILE_NAME_MAX_LENGTH}
                onChange={(event) => setFileName(event.target.value)}
                disabled={isUploading}
                placeholder="예: 점검사진 (비워 두면 원래 파일 이름 그대로)"
                className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-950"
              />
            </label>

            {/*
              🔴 번호 규칙을 **사람이 보는 자리**에 적어 둔다. 적어 두지 않으면 한 장을
              올린 사람이 「(1) 이 왜 안 붙지」로 읽는다 — 한 장이면 안 붙는 것이 규칙이다.
              확장자는 고른 파일의 것이 그대로 따라붙으므로 적지 않아도 된다.
            */}
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              여러 장을 한 번에 고르면 <strong>분류가 모두에 똑같이</strong> 붙고, 적어 둔 파일 이름 뒤에{" "}
              <strong>(1) (2) 번호</strong>가 붙습니다. 한 장만 올리면 번호 없이 적은 이름 그대로입니다.
            </p>

            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              최대 {formatBytes(MAX_ATTACHMENT_SIZE_BYTES)} · 허용 형식{" "}
              {allowedExtensions === null
                ? "실행 파일을 뺀 모든 형식"
                : allowedExtensions.map((extension) => `.${extension}`).join(", ")}
            </p>

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={isUploading}
                className="rounded-md bg-primary-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-800 disabled:opacity-50 dark:bg-primary-50 dark:text-zinc-900 dark:hover:bg-primary-200"
              >
                {/*
                  🔴 바꾸는 동안은 **다른 글자**가 선다(2026-11-18). 큰 사진은 한 장에
                  몇 초가 걸리는데, 그때 「올리는 중」이라고 적어 두면 어디까지 갔는지
                  알 수 없고 멈춘 것처럼 보인다 — 아직 한 장도 안 보낸 때다.
                */}
                {isUploading
                  ? conversionProgress
                    ? `사진 바꾸는 중… ${conversionProgress.total}장 중 ${conversionProgress.current}장째`
                    : uploadProgress
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
          /*
            🔴 [DATA에 저장](조각 12) — 꺼져 있으면 단추가 아예 그려지지 않는다.
            꽂은 뒤에는 **올리기와 같은 신호**로 공유폴더 구역을 다시 읽게 한다
            (조각 10 이 만든 reloadToken — 보고 있던 자리는 그대로다).
          */
          contactFolderEnabled={contactFolderEnabled}
          onSavedToContactFolder={() => setContactFolderReloadToken((token) => token + 1)}
        />
      )}

      {/*
        사내 공유폴더(연락서 폴더) 안에 무엇이 있는지 — 🔴 **DB 첨부 목록과 나란히 선
        형제**다. 위 목록을 감싸지 않으므로 공유폴더가 느리거나 없거나 꺼져 있어도
        첨부 목록은 그대로 보인다. 읽기도 서버가 아니라 이 구역이 뜬 뒤에 따로 한다
        (ContactFolderSection.tsx 머리말). 설정이 없는 환경에서는 스스로 사라진다.
      */}
      <ContactFolderSection repairCaseId={resolved.id} reloadToken={contactFolderReloadToken} />

      {/*
        🔴 **이 건의 종류**가 가리켜 둔 공유폴더 서류(2026-10-07) — 위 구역과 **다른 것**이다.
        위는 이 건 하나의 연락서 폴더 안이고, 여기는 **그 종류의 모든 건이 함께 쓰는** 서류를
        가리킨 줄들이다. 그래서 구역을 나눠 세운다. 🔴 담기 · 지우기는 여기 없다 — 한 건을
        보던 사람이 그 종류 전체를 바꾸게 되고, 고치는 자리는 제품 모델 관리 화면이다.

        🔴 **종류는 여기서 지어내지 않는다.** 수리 건에는 `product_model_kind` 칸이 없고,
        접수할 때 사람이 고른 워크플로 종류를 제품 종류 축으로 옮기는 자리는 저장소에 하나뿐이다
        (domain/product-model-kind.ts 의 productModelKindOfWorkflowKind — 접수의 공통 서류 복사도
        같은 함수를 부른다). 🔴 한 줄도 없으면 구역이 스스로 사라진다.

        🔴 **더한 것은 하나뿐**이다(2026-10-08) — 줄의 [열기] 옆에 [연락서 폴더에 저장]이
        선다. 두 공유폴더가 둘 다 설정됐고 파일 권한이 있을 때만(shareDocCopyEnabled) 그려지고,
        꽂는 자리는 사람이 창에서 고른 폴더다(2026-11-18 — 기본은 `공통`). 담기 · 지우기는
        여전히 없다.

        🔴 넣고 나면 **바로 위 공유폴더 구역을 다시 읽게 한다**(2026-11-18) — [DATA에 저장] ·
        올리기와 **같은 신호 · 같은 글자**다(reloadToken 이 하나 오르고, 보고 있던 자리는
        그대로다). 넣는 자리가 이 건의 연락서 폴더라, 알리지 않으면 폴더는 실제로 생겼는데
        화면에는 새로 고치기 전까지 안 나타난다(사용자가 겪고 요청했다).
      */}
      <CaseKindShareDocsSection
        kind={productModelKindOfWorkflowKind(workflowKindOf(resolved.workflowType))}
        docs={kindShareDocs}
        repairCaseId={resolved.id}
        canCopyToContactFolder={shareDocCopyEnabled}
        onSavedToContactFolder={() => setContactFolderReloadToken((token) => token + 1)}
      />

      {/*
        🔴 **이 제품 모델**이 가리켜 둔 공유폴더 서류(2026-10-08) — 바로 위 구역과 **또 다른
        것**이다. 공유폴더 쪽 구역이 이로써 셋이고 뜻이 전부 다르다: 맨 위는 **이 건 하나**의
        연락서 폴더, 가운데는 **그 종류 전체**가 함께 쓰는 자리, 여기는 **이 제품 모델**의
        자리다. 셋이 나란히 서므로 제목이 그 차이를 말한다(각 구역의 머리말).

        🔴 담기 · 지우기는 여기 없다 — 한 건을 보던 사람이 그 모델 전체를 바꾸게 되고,
        고치는 자리는 제품 모델 상세 화면이다. 🔴 어느 모델인가는 여기서 짓지 않는다 —
        서버가 getProductModelIdForProduct 로 잇고(files/page.tsx), 못 찾으면 빈 목록이
        와서 구역이 스스로 사라진다.

        🔴 [연락서 폴더에 저장]도 **바로 위 구역과 똑같이** 받는다(2026-10-08) — 넣은 뒤
        공유폴더 구역을 다시 읽게 하는 신호까지 똑같다(2026-11-18). 🔴 **두 구역에 다**
        건넨다: 한쪽만 이으면 그쪽에서 넣었을 때만 화면이 따라오고 다른 쪽은 여전히 새로
        고쳐야 보인다.
      */}
      <CaseModelShareDocsSection
        docs={modelShareDocs}
        repairCaseId={resolved.id}
        canCopyToContactFolder={shareDocCopyEnabled}
        onSavedToContactFolder={() => setContactFolderReloadToken((token) => token + 1)}
      />

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
                    /*
                      🔴 두 단추를 한 묶음으로 둔다 — 바깥이 justify-between 이라
                      형제로 나란히 두면 되살리기가 가운데로 흩어진다. 되살리기
                      단추 자체는 글자도 동작도 그대로다.
                    */
                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setPendingRestore(item)}
                        disabled={isMutating}
                        className="rounded-md border border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-700 hover:bg-white disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
                      >
                        되살리기
                      </button>
                      {/* 🔴 되돌릴 수 없는 쪽. 같은 권한(canManage)이 두 단추를 함께 연다. */}
                      <button
                        type="button"
                        data-attachment-purge-button
                        onClick={() => setPendingPurge(item)}
                        disabled={isMutating}
                        className="rounded-md border border-red-300 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950"
                      >
                        영구 삭제
                      </button>
                    </div>
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
      <PurgeAttachmentDialog
        isOpen={pendingPurge !== null}
        displayName={pendingPurge?.originalFileName ?? ""}
        isSubmitting={isMutating}
        onConfirm={handlePurgeConfirm}
        onCancel={() => setPendingPurge(null)}
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
      showSavePopup({ message: `"${result.record.displayName}" 메타데이터를 등록했습니다.`, redirectTo: null });
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
      showSavePopup({ message: `표시 이름을 "${result.record.displayName}"(으)로 변경했습니다.`, redirectTo: null });
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
      showSavePopup({ message: "설명을 저장했습니다.", redirectTo: null });
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
      {/* 🔴 머리말 상자를 여기서 그리지 않는다 — 위 형제 화면과 같은 이유다
          (탭 위의 머리 카드와 겹친다). */}
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
          className="rounded-md bg-primary-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-800 dark:bg-primary-50 dark:text-zinc-900 dark:hover:bg-primary-200"
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
