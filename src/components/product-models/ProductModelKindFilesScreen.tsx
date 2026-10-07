"use client";

import { useMemo, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileDropZone, putFilesInPicker } from "@/components/common/FileDropZone";
import { showSavePopup } from "@/components/common/SavePopup";
import { ResponsiveList } from "@/components/common/responsive-list";
import AttachmentViewer from "@/components/repair-cases/files/AttachmentViewer";
import DeleteAttachmentDialog from "@/components/repair-cases/files/DeleteAttachmentDialog";
import PurgeAttachmentDialog from "@/components/repair-cases/files/PurgeAttachmentDialog";
import RestoreAttachmentDialog from "@/components/repair-cases/files/RestoreAttachmentDialog";
import KindShareDocsSection, { type KindShareDocRow } from "./KindShareDocsSection";
import type { KindShareFolderAddRequest } from "./KindShareFolderPicker";
import type {
  ProductModelKindAttachmentListItem,
  TrashedProductModelKindAttachmentListItem,
} from "@/lib/db/queries/product-model-kind-attachments";
import {
  ATTACHMENT_EXTENSION_RULES,
  isCategoryOpenToAnyExtension,
  isExtensionAllowedForCategory,
} from "@/lib/domain/attachment-allowlist";
import {
  attachmentCategoriesForProductModelKind,
  attachmentCategoryLabels,
  type AttachmentCategory,
} from "@/lib/domain/attachment-category";
import { ATTACHMENT_KIND_LABELS, attachmentKindOf } from "@/lib/domain/attachment-list-filters";
import {
  ORIGINAL_MODIFIED_AT_PARAM,
  originalModifiedAtParamValue,
} from "@/lib/domain/attachment-original-modified-at";
import { productModelKindLabel, type ProductModelKind } from "@/lib/domain/product-model-kind";
import {
  purgeAttachmentAction,
  restoreAttachmentAction,
  softDeleteAttachmentAction,
} from "@/lib/server/actions/attachments";
import {
  addProductModelKindShareDocAction,
  removeProductModelKindShareDocAction,
} from "@/lib/server/actions/product-model-kind-share-docs";

/**
 * ============================================================================
 * 제품 종류 공통 서류함 — 종류 하나가 통째로 나눠 쓰는 서류 (2026-10-06)
 * ============================================================================
 * 모델 상세의 `사진·도면` 구역(ProductModelFilesSection)을 **본떠** 만들었다.
 * 생김새도 같은 결이고, 거기서 인자만으로 쓸 수 있는 부품 셋을 고치지 않고
 * 그대로 가져다 쓴다 — 사진 크게 보기(AttachmentViewer)와 지우기·되살리기 확인
 * 창 둘. 표/미리보기 전환은 서비스의 모든 목록이 쓰는 ResponsiveList 그대로다.
 *
 * 🔴 **그 파일을 고쳐 재사용하지 않은 까닭.** ProductModelFilesSection 은
 * `productModelId` 를 올리기 주소 · 지우기 인자 · 갱신 경로 세 곳에서 쓴다. 주인을
 * 인자로 받게 고치면 그 셋이 전부 갈래가 되고, 그때부터 모델 상세(실기에서 쓰이는
 * 화면)의 동작이 이 새 화면의 수정에 묶인다. 저장소가 올리기 통로 · 경로 함수 ·
 * 조회를 주인마다 나란히 둔 것과 같은 판단이다.
 *
 * ── 이 화면이 부르는 것 ──────────────────────────────────────────────────
 *   올리기    POST /api/product-model-kinds/{종류코드}/attachments?category=&fileName=
 *             **본문이 파일 바이트 그 자체다.** FormData 가 아니다 — multipart 로
 *             보내면 서버가 파일 전체를 메모리에 올려야 한다(라우트 주석).
 *   보기·받기 GET /api/attachments/{첨부id}/download — 다른 첨부와 **같은 통로**다.
 *   지우기    softDeleteAttachmentAction / restoreAttachmentAction — **기존 통로를
 *             그대로** 쓴다. 넘기는 productModelKind 는 화면 갱신 경로일 뿐이고,
 *             권한은 서버가 첨부의 주인을 DB 에서 다시 읽어 정한다.
 *
 * ── 미리보기(썸네일)를 만들어 보내지 않는다 ──────────────────────────────
 * 모델 파일 구역은 올린 뒤 `uploadPreview` 로 썸네일을 이어 보낸다. 여기서는
 * 부르지 않는다 — 미리보기를 둘 자리는 **주인의 ID 로** 정해지는데(세 경로 함수
 * 모두) 이 주인은 ID 가 없다. 썸네일이 없는 사진은 목록이 원본으로 보여 주므로
 * (download 라우트의 `?view=thumb` 는 미리보기가 없으면 원본을 준다) 보이는 것은
 * 같고, 여기 올라오는 것은 대개 사진이 아니라 서류다.
 *
 * ── 날짜가 둘이다 — 🔴 뜻을 섞지 말 것 ───────────────────────────────────
 *   올린 날짜    우리 시스템에 들어온 때(attachments.uploaded_at). 서버가 잰 값.
 *   원본 수정일  **올린 사람 PC 에서 그 파일을 마지막으로 저장한 때.**
 * 이 서류함이 그 열을 보이는 까닭은 모델 기본 자료와 같다 — 「이 양식이 언제
 * 갱신된 것인가」. 🔴 모르는 파일은 빈칸이다. 올린 날짜로 메우면 화면이 아무
 * 오류 없이 거짓을 말한다.
 *
 * ── 권한 ─────────────────────────────────────────────────────────────────
 * `canManageFiles`(productModels.files WRITE)가 없으면 올리기 칸도 지우기 단추도
 * **아예 그리지 않는다.** 판정은 서버 컴포넌트가 하고 여기로는 boolean 만
 * 내려온다 — 화면이 역할을 보고 스스로 판단하지 않는다.
 *
 * ── 🔴 **올린 서류**와 **가리킨 서류**는 다른 구역이다 (2026-10-07) ────────
 * 같은 화면에 구역이 둘 선다. 위는 지금까지의 **올린 파일**(바이트가 우리 창고에
 * 있다 — 내려받기 · 미리보기 · 휴지통), 아래는 **공유폴더를 가리켜 둔 줄**
 * (바이트가 없다 — 내려받기도 미리보기도 휴지통도 없다). 🔴 **섞지 않는다**:
 * 섞으면 사람이 「이건 왜 내려받기가 없지」에서 멈춘다(KindShareDocsSection 머리말).
 * 🔴 올린 파일 쪽 동작(업로드 · 내려받기 · 미리보기 · 휴지통)은 **한 줄도 바뀌지
 * 않았다** — 아래 구역은 그 옆에 선 형제다.
 *
 * 이 화면이 아래 구역을 위해 하는 일은 **서버 액션을 묶어 넘기는 것**뿐이다
 * (add · remove). 그 두 조각은 서버 액션을 직접 물지 않는다 — 그래야
 * test:components 에서 그려 볼 수 있다.
 * ============================================================================
 */

type ProductModelKindFilesScreenProps = {
  /** enum 코드다(GENERATOR 등). 주소의 마디와 올리기 주소에 그대로 쓴다. */
  kind: ProductModelKind;
  attachments: ProductModelKindAttachmentListItem[];
  trashedAttachments: TrashedProductModelKindAttachmentListItem[];
  /**
   * 🔴 공유폴더를 **가리켜 둔** 줄들 — 올린 파일과 다른 목록이다(바이트가 없다).
   * 차례는 서버가 정한다(display_order, created_at) — 화면이 다시 정렬하지 않는다.
   */
  shareDocs: KindShareDocRow[];
  /** productModels.files WRITE. 올리기·지우기·되살리기를 보일지 정한다. */
  canManageFiles: boolean;
};

type StatusMessage = { type: "success" | "error"; text: string };

/**
 * 처음 고를 분류. 이 서류함이 있는 까닭이 「종류 전체가 쓰는 공통 점검표」라
 * 그것을 기본으로 둔다(모델 구역이 회로도를 기본으로 두는 것과 같은 결정).
 */
const DEFAULT_CATEGORY: AttachmentCategory = "CHECKLIST";

const ALL_EXTENSIONS = ATTACHMENT_EXTENSION_RULES.map((rule) => rule.extension);

/**
 * 올리기 칸의 분류 선택지 — **제품 모델 파일이 받는 것과 같은 집합**이다.
 *
 * 🔴 **목록을 손으로 적지 않는다.** 모델 쪽 집합이 넓어지거나 좁아지는 날 이
 * 화면과 올리기 통로가 **함께** 따라와야 한다 — 규칙은 domain 한 자리에만 있다
 * (attachment-category.ts 의 attachmentCategoriesForProductModelKind, 그 안에서
 * isAttachmentCategoryAllowedForOwner 를 그대로 돌려 쓴다).
 */
const KIND_UPLOAD_CATEGORIES = attachmentCategoriesForProductModelKind();

/**
 * 이 분류가 받는 확장자 — **셀 수 있을 때만**. 형식을 가리지 않는 분류(파라미터 ·
 * 통전검사 · 점검표)는 목록으로 적을 수가 없어 null 이다. 모델 파일 구역과 같은
 * 규칙이고, 까닭도 그쪽 주석과 같다 — 정본이 바뀌는 날 화면이 저절로 따라와야 한다.
 */
function allowedExtensionsFor(category: AttachmentCategory): string[] | null {
  if (isCategoryOpenToAnyExtension(category)) return null;
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

/**
 * 원본 수정일을 모르는 파일의 칸. 🔴 **올린 날짜로 대신 채우지 않는다** — 그러면
 * 화면은 아무 오류 없이 거짓을 말하고, 읽는 사람은 그 날짜를 보고 "이 양식은
 * 최신이다"를 판단한다. 아주 비워 두지 않고 줄표를 적는 것은, 빈 칸이 "열이 한 칸
 * 밀렸나"로 읽히기 때문이다(모델 파일 구역과 같은 글자다).
 */
const UNKNOWN_ORIGINAL_MODIFIED_AT = "—";

/** 화면 안에서 그대로 볼 수 있는 형식인가 — 서버(download 라우트)의 판정과 같은 목록이다. */
function isViewableImage(mimeType: string): boolean {
  return mimeType === "image/jpeg" || mimeType === "image/png";
}

/** 브라우저에서 그대로 열어 볼 수 있는 문서인가 — 지금은 PDF 뿐이다. */
function isViewablePdf(mimeType: string): boolean {
  return mimeType === "application/pdf";
}

/** 표에서 `미리보기` 를 그릴 형식인가 — 사진은 화면 위 뷰어로, PDF 는 새 탭으로 열린다. */
function isPreviewable(mimeType: string): boolean {
  return isViewableImage(mimeType) || isViewablePdf(mimeType);
}

function downloadUrlOf(id: string): string {
  return `/api/attachments/${encodeURIComponent(id)}/download`;
}

/**
 * 화면에서 원본을 그대로 여는 주소. 새 탭에서 연다 — `<iframe>` 으로 이 페이지
 * 안에 끼워 넣는 길은 전역 `X-Frame-Options: DENY` 와 `frame-ancestors 'none'` 이
 * 막는다(모델 파일 구역의 같은 함수 주석).
 */
function inlineViewUrlOf(id: string): string {
  return `/api/attachments/${encodeURIComponent(id)}/download?view=full`;
}

/**
 * 미리보기 그림. `?view=thumb` 은 미리보기가 있으면 그것을, 없으면 **원본**을
 * 주고 감사 로그를 남기지 않는다. 이 서류함의 파일에는 미리보기가 없으므로
 * (파일 머리말) 늘 원본이 온다.
 */
function previewUrlOf(id: string): string {
  return `/api/attachments/${encodeURIComponent(id)}/download?view=thumb`;
}

/** 사진이면 그림, 아니면 확장자. 사진은 누르면 크게 열린다. */
function Thumbnail({
  item,
  onOpen,
}: {
  item: ProductModelKindAttachmentListItem;
  onOpen?: (item: ProductModelKindAttachmentListItem) => void;
}) {
  if (!isViewableImage(item.mimeType)) {
    const extension = item.originalFileName.split(".").pop()?.toUpperCase() ?? "파일";
    return (
      <div className="flex aspect-square w-full items-center justify-center bg-zinc-100 text-xs font-semibold text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
        {extension.length <= 5 ? extension : "파일"}
      </div>
    );
  }

  const image = (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={previewUrlOf(item.id)}
      alt={item.originalFileName}
      loading="lazy"
      decoding="async"
      // object-contain이다 — 잘라 채우면 도면·명판처럼 가로로 긴 그림의 양 끝이
      // 사라져 무엇인지 알아볼 수 없다.
      className="aspect-square w-full bg-zinc-100 object-contain dark:bg-zinc-800"
    />
  );

  if (!onOpen) return image;

  return (
    <button
      type="button"
      onClick={() => onOpen(item)}
      aria-label={`${item.originalFileName} 크게 보기`}
      className="block w-full overflow-hidden"
    >
      {image}
    </button>
  );
}

/** 사진인지 문서인지 한눈에. 표에는 썸네일이 없으므로 이것이 그 자리를 대신한다. */
function KindBadge({ mimeType }: { mimeType: string }) {
  const kind = attachmentKindOf(mimeType);
  return (
    <span
      className={`inline-block shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium ${
        kind === "image"
          ? "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300"
          : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
      }`}
    >
      {ATTACHMENT_KIND_LABELS[kind]}
    </span>
  );
}

/**
 * 표 보기 — 서류가 늘었을 때 이름·분류·크기를 **글자로** 훑는 자리.
 *
 * 🔴 **썸네일을 넣지 말 것.** 넣는 순간 미리보기 격자와 같은 것이 되어 전환할
 * 까닭이 사라진다. 사진인지 문서인지는 KindBadge 가 알린다.
 *
 * 스크롤 껍데기(overflow-x-auto)와 테두리는 **여기서 두르지 않는다** —
 * ResponsiveList 가 소유한다. 여기서 한 겹 더 두르면 넘침이 그 안에서 흡수되어
 * 표/미리보기 자동 판정이 망가진다.
 */
function FilesTable({
  attachments,
  canManageFiles,
  hasPreviewable,
  hasOriginalModifiedAt,
  isBusy,
  onDelete,
  onOpenImage,
}: {
  attachments: ProductModelKindAttachmentListItem[];
  canManageFiles: boolean;
  /** 볼 수 있는 파일이 하나도 없으면 열 자체를 그리지 않는다 — 빈 열의 폭이 표/미리보기 판정을 민다. */
  hasPreviewable: boolean;
  /** 원본 수정일을 아는 파일이 하나도 없으면 열 자체를 그리지 않는다 — 위와 같은 규칙·같은 까닭. */
  hasOriginalModifiedAt: boolean;
  isBusy: boolean;
  onDelete: (item: ProductModelKindAttachmentListItem) => void;
  /** 격자에서 썸네일을 눌렀을 때와 **같은 함수**다 — 넘기는 순서가 갈릴 수 없다. */
  onOpenImage: (item: ProductModelKindAttachmentListItem) => void;
}) {
  return (
    <table className="min-w-full text-left text-sm">
      <thead className="border-b border-zinc-200 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
        <tr>
          <th scope="col" className="px-3 py-2 font-medium">파일명</th>
          <th scope="col" className="px-3 py-2 font-medium">분류</th>
          <th scope="col" className="px-3 py-2 text-right font-medium">크기</th>
          <th scope="col" className="px-3 py-2 font-medium">올린 사람</th>
          <th scope="col" className="px-3 py-2 font-medium">올린 날짜</th>
          {/* 「올린 날짜」 **바로 옆**이다 — 두 날짜가 붙어 있어야 한눈에 견준다. */}
          {hasOriginalModifiedAt && <th scope="col" className="px-3 py-2 font-medium">원본 수정일</th>}
          {hasPreviewable && <th scope="col" className="px-3 py-2 font-medium">미리보기</th>}
          <th scope="col" className="px-3 py-2 font-medium">내려받기</th>
          {canManageFiles && <th scope="col" className="px-3 py-2 font-medium">지우기</th>}
        </tr>
      </thead>
      <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
        {attachments.map((item) => (
          <tr key={item.id}>
            <td className="px-3 py-2">
              <div className="flex items-center gap-2">
                <KindBadge mimeType={item.mimeType} />
                <span className="truncate text-zinc-900 dark:text-zinc-50" title={item.originalFileName}>
                  {item.originalFileName}
                </span>
              </div>
            </td>
            <td className="whitespace-nowrap px-3 py-2 text-zinc-700 dark:text-zinc-300">
              {attachmentCategoryLabels[item.category]}
            </td>
            {/* 줄지어 서는 숫자는 자릿수를 맞춘다 — 이 저장소의 다른 표와 같다. */}
            <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-zinc-700 dark:text-zinc-300">
              {formatBytes(item.fileSize)}
            </td>
            <td className="whitespace-nowrap px-3 py-2 text-zinc-700 dark:text-zinc-300">
              {item.uploadedByName}
            </td>
            <td className="whitespace-nowrap px-3 py-2 tabular-nums text-zinc-700 dark:text-zinc-300">
              {formatTimestamp(item.uploadedAt)}
            </td>
            {hasOriginalModifiedAt && (
              <td className="whitespace-nowrap px-3 py-2 tabular-nums text-zinc-700 dark:text-zinc-300">
                {item.originalModifiedAt
                  ? formatTimestamp(item.originalModifiedAt)
                  : UNKNOWN_ORIGINAL_MODIFIED_AT}
              </td>
            )}
            {hasPreviewable && (
              <td className="whitespace-nowrap px-3 py-2">
                {isViewableImage(item.mimeType) ? (
                  <button
                    type="button"
                    onClick={() => onOpenImage(item)}
                    aria-label={`${item.originalFileName} 미리보기`}
                    className="text-xs font-medium text-sky-700 underline dark:text-sky-400"
                  >
                    미리보기
                  </button>
                ) : isViewablePdf(item.mimeType) ? (
                  <a
                    href={inlineViewUrlOf(item.id)}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`${item.originalFileName} 미리보기`}
                    className="text-xs font-medium text-sky-700 underline dark:text-sky-400"
                  >
                    미리보기
                  </a>
                ) : null}
              </td>
            )}
            <td className="whitespace-nowrap px-3 py-2">
              <a
                href={downloadUrlOf(item.id)}
                aria-label={`${item.originalFileName} 내려받기`}
                className="text-xs font-medium text-zinc-700 underline dark:text-zinc-300"
              >
                내려받기
              </a>
            </td>
            {canManageFiles && (
              <td className="whitespace-nowrap px-3 py-2">
                <button
                  type="button"
                  onClick={() => onDelete(item)}
                  disabled={isBusy}
                  aria-label={`${item.originalFileName} 지우기`}
                  className="text-xs font-medium text-red-700 underline disabled:opacity-50 dark:text-red-400"
                >
                  지우기
                </button>
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function ProductModelKindFilesScreen({
  kind,
  attachments,
  trashedAttachments,
  shareDocs,
  canManageFiles,
}: ProductModelKindFilesScreenProps) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [category, setCategory] = useState<AttachmentCategory>(DEFAULT_CATEGORY);
  const [isUploading, setIsUploading] = useState(false);
  /** 여러 개를 올릴 때 어디까지 갔는지. 한 개짜리도 같은 자리에 보인다. */
  const [uploadProgress, setUploadProgress] = useState<{ current: number; total: number } | null>(null);
  const [statusMessage, setStatusMessage] = useState<StatusMessage | null>(null);

  const [pendingDelete, setPendingDelete] = useState<ProductModelKindAttachmentListItem | null>(null);
  const [pendingRestore, setPendingRestore] =
    useState<TrashedProductModelKindAttachmentListItem | null>(null);
  /** 🔴 영구 삭제 대기(2026-10-07) — 되살리기와 다른 상태다. 휴지통 줄에서만 세워진다. */
  const [pendingPurge, setPendingPurge] =
    useState<TrashedProductModelKindAttachmentListItem | null>(null);
  const [isMutating, setIsMutating] = useState(false);

  /** 크게 보고 있는 사진의 자리. 사진만 모은 목록(viewable) 기준이다. */
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);

  const allowedExtensions = useMemo(() => allowedExtensionsFor(category), [category]);
  /**
   * 형식을 가리지 않는 분류에서는 **undefined** 다 — 빈 문자열을 넣으면 브라우저가
   * "받는 형식이 없다"로 읽어 고르는 창이 아무것도 내놓지 않는 날이 있다.
   */
  const acceptAttribute = useMemo(
    () => allowedExtensions?.map((extension) => `.${extension}`).join(","),
    [allowedExtensions]
  );

  const viewable = useMemo(
    () => attachments.filter((item) => isViewableImage(item.mimeType)),
    [attachments]
  );

  const hasPreviewable = useMemo(
    () => attachments.some((item) => isPreviewable(item.mimeType)),
    [attachments]
  );

  const hasOriginalModifiedAt = useMemo(
    () => attachments.some((item) => item.originalModifiedAt !== null),
    [attachments]
  );

  function openViewer(item: ProductModelKindAttachmentListItem) {
    const position = viewable.findIndex((candidate) => candidate.id === item.id);
    if (position >= 0) setViewerIndex(position);
  }

  /** 한 개를 실제로 보낸다. 막혔으면 **서버가 준 문장**을 그대로 들고 온다. */
  async function uploadOne(file: File): Promise<{ ok: true } | { ok: false; reason: string }> {
    try {
      // 본문은 파일 바이트 그 자체이고 메타데이터는 쿼리 문자열이다(파일 상단).
      const query = new URLSearchParams({ category, fileName: file.name });
      // 이 PC 에서 그 파일을 마지막으로 저장한 시각도 함께 싣는다.
      //
      // 🔴 **실을 수 없는 값이면 아예 보내지 않는다.** 거르는 판정은 서버와 **같은
      // 함수** 하나다 — 여기서 따로 판단하면 "보냈는데 서버가 버리는" 어긋남이
      // 생기고 그때는 아무 오류도 나지 않는다. 보내든 말든 **업로드는 그대로 간다.**
      const modifiedAt = originalModifiedAtParamValue(file.lastModified);
      if (modifiedAt !== null) query.set(ORIGINAL_MODIFIED_AT_PARAM, modifiedAt);
      const response = await fetch(
        `/api/product-model-kinds/${encodeURIComponent(kind)}/attachments?${query.toString()}`,
        { method: "POST", body: file }
      );

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        return { ok: false, reason: payload?.error ?? "서버가 거절했습니다" };
      }

      // 썸네일은 이어 보내지 않는다 — 둘 자리가 주인의 ID 로 정해지는데 이 주인은
      // ID 가 없다(파일 머리말). 목록은 원본으로 보여 준다.
      return { ok: true };
    } catch {
      return { ok: false, reason: "네트워크 문제" };
    }
  }

  /**
   * 폴더에서 끌어다 놓은 파일. **고르기 칸에 그대로 담는다**(putFilesInPicker) —
   * 떨구기용 목록을 따로 두면 [올리기]가 보는 곳이 둘이 되고, 그때부터 두 길이
   * 갈린다.
   */
  function receiveDroppedFiles(files: File[]) {
    if (!putFilesInPicker(fileInputRef.current, files)) return;
    setStatusMessage(null);
  }

  async function handleUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const files = Array.from(fileInputRef.current?.files ?? []);
    if (files.length === 0) {
      setStatusMessage({ type: "error", text: "올릴 파일을 선택해 주세요." });
      return;
    }

    setIsUploading(true);
    setStatusMessage(null);

    // 한 개씩 차례로 보낸다. 동시에 쏘면 어디까지 됐는지 보여 줄 방법이 없고,
    // 한 개가 막혔을 때 나머지가 어떻게 됐는지도 말할 수 없다.
    const failures: { name: string; reason: string }[] = [];
    let uploaded = 0;
    try {
      for (const [index, file] of files.entries()) {
        setUploadProgress({ current: index + 1, total: files.length });
        const result = await uploadOne(file);
        if (result.ok) uploaded += 1;
        else failures.push({ name: file.name, reason: result.reason });
      }
    } finally {
      setIsUploading(false);
      setUploadProgress(null);
    }

    if (uploaded > 0 && fileInputRef.current) {
      // 올라간 것이 있으면 고른 목록을 비운다 — 그대로 두면 다시 눌렀을 때
      // 같은 파일이 한 벌 더 올라간다.
      fileInputRef.current.value = "";
    }

    if (uploaded === 0) {
      setStatusMessage({
        type: "error",
        text: failures.map((item) => `${item.name}: ${item.reason}`).join(" / "),
      });
      return;
    }

    if (failures.length === 0) {
      showSavePopup({ message: `${uploaded}건을 올렸습니다.`, redirectTo: null });
    } else {
      setStatusMessage({
        type: "error",
        text: `${uploaded}건을 올렸고 ${failures.length}건은 빠졌습니다 — ${failures
          .map((item) => `${item.name}(${item.reason})`)
          .join(", ")}`,
      });
    }
    // 목록은 서버가 만든다 — 방금 올린 것을 보려면 다시 그려야 한다.
    router.refresh();
  }

  async function handleDeleteConfirm(reason: string) {
    const target = pendingDelete;
    if (!target) return;
    setIsMutating(true);
    setStatusMessage(null);
    try {
      const result = await softDeleteAttachmentAction({
        attachmentId: target.id,
        // 화면 갱신 경로일 뿐이다. 권한은 서버가 주인을 다시 읽어 정한다.
        productModelKind: kind,
        reason,
      });
      // 성공이든 실패든 확인 창을 닫는다. 열어 둔 채 아래에 이유를 적으면
      // 그 글이 창 뒤에 가려 사용자는 아무 일도 안 일어난 것으로 본다.
      setPendingDelete(null);
      if (!result.ok) {
        setStatusMessage({ type: "error", text: result.message });
        return;
      }
      setStatusMessage({
        type: "success",
        text: `${target.originalFileName} 을(를) 휴지통으로 옮겼습니다. 되살릴 수 있습니다.`,
      });
      router.refresh();
    } finally {
      setIsMutating(false);
    }
  }

  async function handleRestoreConfirm() {
    const target = pendingRestore;
    if (!target) return;
    setIsMutating(true);
    setStatusMessage(null);
    try {
      const result = await restoreAttachmentAction({ attachmentId: target.id, productModelKind: kind });
      // 지우기 쪽과 같은 이유로 먼저 닫는다(위 주석).
      setPendingRestore(null);
      if (!result.ok) {
        setStatusMessage({ type: "error", text: result.message });
        return;
      }
      setStatusMessage({ type: "success", text: `${target.originalFileName} 을(를) 되살렸습니다.` });
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
      const result = await purgeAttachmentAction({ attachmentId: target.id, productModelKind: kind });
      // 지우기 쪽과 같은 이유로 먼저 닫는다(위 주석).
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

  /**
   * 🔴 가리킴 담기 — 서버 액션을 부르고 **그 답을 그대로** 돌려준다. 거절 문장은
   * 서버가 짓고 고르는 창이 그대로 보인다(문장을 여기서 다시 쓰지 않는다).
   * 성공하면 다시 그려 **담은 줄이 곧바로 목록에 보이게** 한다 — 목록은 서버
   * 컴포넌트가 만든다(액션 쪽 revalidatePath 와 짝이다).
   */
  async function handleAddShareDoc(request: KindShareFolderAddRequest) {
    const result = await addProductModelKindShareDocAction({ kind, ...request });
    if (!result.ok) return { ok: false as const, message: result.message };
    router.refresh();
    return { ok: true as const };
  }

  /** 🔴 가리킴 지우기 — **휴지통이 없다.** 되돌릴 수 없다는 말은 확인 창이 한다. */
  async function handleRemoveShareDoc(id: string) {
    const result = await removeProductModelKindShareDocAction({ kind, id });
    if (!result.ok) return { ok: false as const, message: result.message };
    router.refresh();
    return { ok: true as const };
  }

  const isBusy = isUploading || isMutating;
  const label = productModelKindLabel(kind);

  return (
    <div className="flex flex-col gap-4">
      {/* 모델 상세가 `← 제품 모델 관리` 를 두는 것과 같은 모양·같은 자리다. */}
      <Link
        href="/product-models"
        className="text-sm text-zinc-500 underline dark:text-zinc-400"
      >
        ← 제품 모델 관리
      </Link>

      <div className="flex flex-wrap items-baseline gap-2">
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">{label} 공통 서류</h1>
        <span className="text-sm text-zinc-500 dark:text-zinc-400">
          이 종류의 모든 모델이 함께 쓰는 서류입니다.
        </span>
      </div>

      <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        {canManageFiles && (
          <FileDropZone
            name="product-model-kind-files-upload"
            multiple
            disabled={isBusy}
            hint="여기에 파일을 놓으세요 — 놓은 뒤 [올리기]"
            onFiles={receiveDroppedFiles}
          >
            <form
              onSubmit={handleUpload}
              className="flex flex-col gap-2 rounded-md border border-dashed border-zinc-300 p-3 dark:border-zinc-700"
            >
              <div className="flex flex-wrap items-end gap-2">
                <label className="flex flex-col gap-1 text-xs text-zinc-500 dark:text-zinc-400">
                  분류
                  <select
                    value={category}
                    onChange={(event) => setCategory(event.target.value as AttachmentCategory)}
                    disabled={isBusy}
                    className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-900 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50"
                  >
                    {KIND_UPLOAD_CATEGORIES.map((code) => (
                      <option key={code} value={code}>
                        {attachmentCategoryLabels[code]}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs text-zinc-500 dark:text-zinc-400">
                  파일
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    // 고른 분류가 받는 확장자만 파일 고르는 창에 보인다. 형식을
                    // 가리지 않는 분류에서는 undefined 라 모든 파일이 보인다.
                    accept={acceptAttribute}
                    disabled={isBusy}
                    className="min-w-0 rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-900 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50"
                  />
                </label>

                <button
                  type="submit"
                  disabled={isBusy}
                  className="rounded-md bg-primary-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-800 disabled:opacity-50 dark:bg-primary-50 dark:text-zinc-900 dark:hover:bg-primary-200"
                >
                  {uploadProgress
                    ? `올리는 중… ${uploadProgress.current}/${uploadProgress.total}`
                    : isUploading
                      ? "올리는 중…"
                      : "올리기"}
                </button>
              </div>

              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                {attachmentCategoryLabels[category]} 분류가 받는 형식:{" "}
                {allowedExtensions === null
                  ? "실행 파일을 뺀 모든 형식"
                  : allowedExtensions.map((extension) => `.${extension}`).join(" ")}{" "}
                · 한 개당 20MB까지
                {" · "}
                폴더에서 끌어다 놓아도 됩니다
              </p>
            </form>
          </FileDropZone>
        )}

        {statusMessage && (
          <p
            role="alert"
            className={`mt-3 rounded-md border px-3 py-2 text-sm ${
              statusMessage.type === "success"
                ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300"
                : "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-400"
            }`}
          >
            {statusMessage.text}
          </p>
        )}

        {attachments.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">
            아직 올라온 공통 서류가 없습니다.
          </p>
        ) : (
          <div className="mt-3">
            <ResponsiveList
              listId="product-model-kind-attachments"
              /* 서류를 모아 둔 자리라 **표**가 기본이다 — 모델의 사진·도면 구역이
                 미리보기부터 여는 것과 다른 점이고, 여기 올라오는 것은 대개 사진이
                 아니라 양식·점검표라서다. 한 번이라도 `미리보기` 를 고른 사람에게는
                 그 선택이 이긴다(ResponsiveList 가 기억한다). */
              cardLabel="미리보기"
              meta={
                <span className="mr-auto text-xs text-zinc-500 tabular-nums dark:text-zinc-400">
                  {attachments.length}건
                </span>
              }
              /* 줄 수와 `지우기`·`미리보기`·`원본 수정일` 열의 유무가 표의 필요 폭을 바꾼다. */
              measureKey={[attachments.length, canManageFiles, hasPreviewable, hasOriginalModifiedAt]}
              table={
                <FilesTable
                  attachments={attachments}
                  canManageFiles={canManageFiles}
                  hasPreviewable={hasPreviewable}
                  hasOriginalModifiedAt={hasOriginalModifiedAt}
                  isBusy={isBusy}
                  onDelete={setPendingDelete}
                  /* 격자의 썸네일이 부르는 것과 **같은 함수**다 — 두 벌로 만들지 않는다. */
                  onOpenImage={openViewer}
                />
              }
              cards={
                <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                  {attachments.map((item) => (
                    <li
                      key={item.id}
                      className="flex flex-col overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900"
                    >
                      <Thumbnail item={item} onOpen={openViewer} />
                      <div className="flex min-w-0 flex-1 flex-col gap-1 p-2">
                        <span
                          title={item.originalFileName}
                          className="truncate text-xs font-medium text-zinc-900 dark:text-zinc-50"
                        >
                          {item.originalFileName}
                        </span>
                        <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
                          {attachmentCategoryLabels[item.category]} · {formatBytes(item.fileSize)}
                        </span>
                        <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
                          {item.uploadedByName} · {formatTimestamp(item.uploadedAt)}
                        </span>
                        {/* 🔴 모르는 파일에는 **줄 자체를 그리지 않는다** — 표에는 열
                            머리글이 있어 줄표가 "모른다"로 읽히지만, 여기서는
                            「원본 수정일 —」 이 모든 칸에 붙는 군더더기가 된다. */}
                        {item.originalModifiedAt && (
                          <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
                            원본 수정일 {formatTimestamp(item.originalModifiedAt)}
                          </span>
                        )}
                        {item.description && (
                          <span className="truncate text-[11px] text-zinc-600 dark:text-zinc-300">
                            {item.description}
                          </span>
                        )}
                        <div className="mt-auto flex items-center justify-between gap-2 pt-1">
                          {/* `미리보기` 는 `내려받기` 를 **대신하지 않는다.** 훑어보는
                              것과 손에 들고 나가는 것은 다른 일이라 둘 다 둔다. */}
                          <div className="flex min-w-0 items-center gap-2">
                            {isViewablePdf(item.mimeType) && (
                              <a
                                href={inlineViewUrlOf(item.id)}
                                target="_blank"
                                rel="noopener noreferrer"
                                aria-label={`${item.originalFileName} 미리보기`}
                                className="text-[11px] font-medium text-sky-700 underline dark:text-sky-400"
                              >
                                미리보기
                              </a>
                            )}
                            <a
                              href={downloadUrlOf(item.id)}
                              aria-label={`${item.originalFileName} 내려받기`}
                              className="text-[11px] font-medium text-zinc-700 underline dark:text-zinc-300"
                            >
                              내려받기
                            </a>
                          </div>
                          {canManageFiles && (
                            <button
                              type="button"
                              onClick={() => setPendingDelete(item)}
                              disabled={isBusy}
                              className="text-[11px] font-medium text-red-700 underline disabled:opacity-50 dark:text-red-400"
                            >
                              지우기
                            </button>
                          )}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              }
            />
          </div>
        )}

        {/*
          휴지통. 파일을 다룰 수 있는 사람에게만 보인다 — 되살리기가 그 권한이고,
          되살릴 수 없는 사람에게 "지워진 파일이 있다"만 알려 줄 이유가 없다.
        */}
        {canManageFiles && trashedAttachments.length > 0 && (
          <details className="mt-3 rounded-md border border-zinc-200 dark:border-zinc-800">
            <summary className="cursor-pointer px-3 py-2 text-xs text-zinc-600 dark:text-zinc-400">
              휴지통 {trashedAttachments.length}건
            </summary>
            <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {trashedAttachments.map((item) => (
                <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                  <div className="min-w-0">
                    <span className="block truncate text-xs text-zinc-900 dark:text-zinc-50">
                      {item.originalFileName}
                    </span>
                    <span className="block text-[11px] text-zinc-500 dark:text-zinc-400">
                      {formatTimestamp(item.deletedAt)}에 {item.deletedByName ?? "알 수 없음"}이(가) 지움
                      {item.deleteReason ? ` · ${item.deleteReason}` : ""}
                    </span>
                  </div>
                  {/*
                    🔴 두 단추를 한 묶음으로 둔다 — 바깥이 justify-between 이라 형제로
                    나란히 두면 되살리기가 가운데로 흩어진다. 되살리기 단추 자체는
                    글자도 동작도 그대로다. 권한(canManageFiles)은 이 구역 전체가
                    이미 쥐고 있다 — 영구 삭제에 새 문턱을 만들지 않았다.
                  */}
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setPendingRestore(item)}
                      disabled={isBusy}
                      className="rounded-md border border-zinc-300 px-2 py-1 text-[11px] font-medium text-zinc-700 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300"
                    >
                      되살리기
                    </button>
                    <button
                      type="button"
                      data-attachment-purge-button
                      onClick={() => setPendingPurge(item)}
                      disabled={isBusy}
                      className="rounded-md border border-red-300 px-2 py-1 text-[11px] font-medium text-red-700 disabled:opacity-50 dark:border-red-900 dark:text-red-400"
                    >
                      영구 삭제
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </details>
        )}

        {viewerIndex !== null && (
          <AttachmentViewer
            items={viewable}
            initialIndex={viewerIndex}
            onClose={() => setViewerIndex(null)}
          />
        )}

        <DeleteAttachmentDialog
          isOpen={pendingDelete !== null}
          displayName={pendingDelete?.originalFileName ?? ""}
          isSubmitting={isMutating}
          onConfirm={handleDeleteConfirm}
          onCancel={() => setPendingDelete(null)}
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
      </section>

      {/*
        🔴 올린 파일 구역의 **밖**이다 — 바이트가 있는 것과 자리만 가리킨 것을 한
        목록에 섞지 않는다(파일 머리말). 위 구역의 동작은 한 줄도 건드리지 않았다.
      */}
      <KindShareDocsSection
        kind={kind}
        docs={shareDocs}
        canManageFiles={canManageFiles}
        onAdd={handleAddShareDoc}
        onRemove={handleRemoveShareDoc}
      />
    </div>
  );
}
