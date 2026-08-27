"use client";

import { useMemo, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ResponsiveList } from "@/components/common/responsive-list";
import AttachmentViewer from "@/components/repair-cases/files/AttachmentViewer";
import DeleteAttachmentDialog from "@/components/repair-cases/files/DeleteAttachmentDialog";
import RestoreAttachmentDialog from "@/components/repair-cases/files/RestoreAttachmentDialog";
import { uploadPreview } from "@/components/repair-cases/files/shrink-image";
import type {
  ProductModelAttachmentListItem,
  TrashedProductModelAttachmentListItem,
} from "@/lib/db/queries/attachments";
import {
  ATTACHMENT_EXTENSION_RULES,
  isExtensionAllowedForCategory,
} from "@/lib/domain/attachment-allowlist";
import {
  ATTACHMENT_CATEGORY_CODES,
  attachmentCategoryLabels,
  type AttachmentCategory,
} from "@/lib/domain/attachment-category";
import { ATTACHMENT_KIND_LABELS, attachmentKindOf } from "@/lib/domain/attachment-list-filters";
import {
  restoreAttachmentAction,
  softDeleteAttachmentAction,
} from "@/lib/server/actions/attachments";

/**
 * ============================================================================
 * 제품 모델의 `사진·도면` — 사람이 실제로 파일을 올리는 첫 화면
 * ============================================================================
 * 서버는 이미 다 서 있다. 이 파일이 하는 일은 있는 통로를 부르는 것뿐이다.
 *
 *   올리기    POST /api/product-models/{id}/attachments?category=&fileName=
 *             **본문이 파일 바이트 그 자체다.** FormData 가 아니다 — multipart 로
 *             보내면 서버가 파일 전체를 메모리에 올려야 한다(라우트 주석).
 *   보기·받기 GET /api/attachments/{첨부id}/download — 접수 건 첨부와 같은 통로.
 *   지우기    softDeleteAttachmentAction / restoreAttachmentAction.
 *             넘기는 productModelId 는 **화면 갱신 경로일 뿐**이고, 권한은 서버가
 *             첨부의 주인을 DB 에서 다시 읽어 정한다(actions/attachments.ts).
 *
 * ── 실패 문장을 여기서 지어내지 않는다 ───────────────────────────────────
 * 서버가 "파일이 20MB를 넘습니다", "파일 내용이 확장자(.jpg)와 맞지 않습니다.
 * 이름만 바꾼 파일은 올릴 수 없습니다" 처럼 **무엇이 왜 막혔는지** 사람이 읽을
 * 수 있게 적어 준다. 화면이 따로 문장을 만들면 서버가 검사를 넓히거나 좁히는
 * 날 두 문장이 갈라지고, 그때 사용자는 화면이 하는 말과 실제로 막힌 이유가
 * 다른 상태를 보게 된다. 그래서 응답의 `error` 를 그대로 내보인다.
 *
 * ── 접수 건 파일 화면에서 무엇을 가져왔는가 ──────────────────────────────
 * 고치지 않고 인자만으로 쓸 수 있는 셋만 import 한다 — 사진 크게 보기
 * (AttachmentViewer), 지우기·되살리기 확인 창 둘, 그리고 썸네일을 만들어 보내는
 * uploadPreview. 목록·올리기 칸은 새로 만들었다: 접수 건 쪽 화면(FilesScreen ·
 * StoredAttachmentList)에는 카메라·묶어 받기·줄여서 받기·거르기·타임라인·데모
 * 저장소가 함께 들어 있어 인자만으로는 떼어 낼 수 없고, 떼어 내려고 그 파일을
 * 손대는 순간 실기에서 쓰이는 화면이 함께 흔들린다.
 *
 * ── `표` / `미리보기` — 전환 장치는 새로 만들지 않는다 ────────────────────
 * 서비스의 모든 목록이 쓰는 ResponsiveList 를 그대로 쓴다. 단추 두 개도, 고른
 * 것을 목록마다 따로 기억하는 것도, 표가 지금 폭에 들어가는지 실제로 재는 것도
 * 전부 그쪽에 이미 있다.
 *
 * 다만 두 가지를 인자로 덮는다:
 *   cardLabel="미리보기"  — 여기 격자는 사람이 `미리보기` 라고 부르는 것이지
 *                           카드가 아니다.
 *   defaultMode="CARD"    — **고른 적이 없으면 미리보기부터.** 기본값(폭이 정함)
 *                           그대로 두면 넓은 화면에서 처음 여는 사람에게 표가
 *                           먼저 뜬다 — 사진을 보러 들어온 자리에서 사진이 아닌
 *                           것을 먼저 보이는 셈이다. 한 번이라도 `표`를 고른
 *                           사람에게는 그 선택이 이긴다(resolveShowTable).
 *
 * 표에는 **썸네일을 넣지 않는다.** 넣으면 두 보기가 같아져 전환할 까닭이
 * 없어진다 — 표는 이름·분류·크기를 **글자로 훑는 자리**이고, 사진인지 문서인지는
 * 종류 배지가 알린다. 사진을 보는 자리는 미리보기 격자다.
 *
 * 올리기 폼과 휴지통은 전환 장치 **밖**에 둔다 — 보기 방식과 상관없이 늘 같은
 * 자리에 있어야 한다.
 *
 * ── 권한 ─────────────────────────────────────────────────────────────────
 * `canManageFiles`(productModels.files WRITE)가 없으면 올리기 칸도 지우기 단추도
 * **아예 그리지 않는다.** 눌러도 서버가 막지만, 할 수 없는 일을 내미는 것 자체가
 * 잘못이다. 판정은 서버 컴포넌트가 하고 여기로는 boolean 만 내려온다 — 화면이
 * 역할을 보고 스스로 판단하지 않는다.
 * ============================================================================
 */

type ProductModelFilesSectionProps = {
  productModelId: string;
  attachments: ProductModelAttachmentListItem[];
  trashedAttachments: TrashedProductModelAttachmentListItem[];
  /** productModels.files WRITE. 올리기·지우기·되살리기를 보일지 정한다. */
  canManageFiles: boolean;
};

type StatusMessage = { type: "success" | "error"; text: string };

/** 처음 고를 분류. 이 구역이 있는 까닭이 회로도라 그것을 기본으로 둔다. */
const DEFAULT_CATEGORY: AttachmentCategory = "CIRCUIT_DIAGRAM";

const ALL_EXTENSIONS = ATTACHMENT_EXTENSION_RULES.map((rule) => rule.extension);

/**
 * 이 분류가 받는 확장자. **손으로 적지 않는다** — 허용목록
 * (CATEGORY_EXTENSION_ALLOWLIST)이 정본이고, 그것이 넓어지거나 좁아지는 날
 * 파일 고르는 창이 저절로 따라와야 한다.
 */
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

/** 화면 안에서 그대로 볼 수 있는 형식인가 — 서버(download 라우트)의 판정과 같은 목록이다. */
function isViewableImage(mimeType: string): boolean {
  return mimeType === "image/jpeg" || mimeType === "image/png";
}

function downloadUrlOf(id: string): string {
  return `/api/attachments/${encodeURIComponent(id)}/download`;
}

/**
 * 미리보기 그림. `?view=thumb` 은 미리보기가 있으면 그것을, 없으면 원본을 주고
 * **감사 로그를 남기지 않는다** — 목록을 한 번 여는 것이 내려받기 기록 열 줄로
 * 쌓이면 "누가 무엇을 가져갔는가"를 그 안에서 찾을 수 없다(download 라우트 주석).
 */
function previewUrlOf(id: string): string {
  return `/api/attachments/${encodeURIComponent(id)}/download?view=thumb`;
}

/**
 * 사진이면 그림, 아니면 확장자.
 *
 * 사진은 **누르면 크게 열린다.** 회로도는 작게 보면 아무 소용이 없다 — 도선
 * 하나를 확인하려고 올린 파일이 확인할 수 없는 크기로만 남으면 올린 뜻이 없다
 * (접수 건 목록이 같은 판단으로 그렇게 하고 있다).
 */
function Thumbnail({
  item,
  onOpen,
}: {
  item: ProductModelAttachmentListItem;
  onOpen?: (item: ProductModelAttachmentListItem) => void;
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
      // 화면에 들어온 것만 받는다. 미리보기가 없는 파일은 원본이 오므로 이 한
      // 줄이 그때 특히 값이 크다.
      loading="lazy"
      decoding="async"
      className="aspect-square w-full bg-zinc-100 object-cover dark:bg-zinc-800"
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
 * 표 보기 — 파일이 늘었을 때 이름·분류·크기를 **글자로** 훑는 자리.
 *
 * 🔴 **썸네일을 넣지 말 것.** 넣는 순간 미리보기 격자와 같은 것이 되어 전환할
 * 까닭이 사라진다(파일 상단 참조). 사진인지 문서인지는 KindBadge 가 알린다.
 *
 * 스크롤 껍데기(overflow-x-auto)와 테두리는 **여기서 두르지 않는다** —
 * ResponsiveList 가 소유한다. 여기서 한 겹 더 두르면 넘침이 그 안에서 흡수되어
 * 바깥은 영영 "들어간다"고 답하고, 표/미리보기 자동 판정이 망가진다
 * (responsive-list.tsx 의 '표 껍데기는 여기가 소유한다').
 */
function FilesTable({
  attachments,
  canManageFiles,
  isBusy,
  onDelete,
}: {
  attachments: ProductModelAttachmentListItem[];
  canManageFiles: boolean;
  isBusy: boolean;
  onDelete: (item: ProductModelAttachmentListItem) => void;
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
            <td className="whitespace-nowrap px-3 py-2">
              <a
                href={downloadUrlOf(item.id)}
                // 한 줄에 같은 말이 여럿이라 무엇을 받는지 이름으로 밝힌다.
                // (sr-only 로 숨긴 글자는 이 저장소에서 페이지를 굴린 전력이 있어
                //  쓰지 않는다 — aria-label 로 붙인다.)
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

export default function ProductModelFilesSection({
  productModelId,
  attachments,
  trashedAttachments,
  canManageFiles,
}: ProductModelFilesSectionProps) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [category, setCategory] = useState<AttachmentCategory>(DEFAULT_CATEGORY);
  const [isUploading, setIsUploading] = useState(false);
  /** 여러 개를 올릴 때 어디까지 갔는지. 한 개짜리도 같은 자리에 보인다. */
  const [uploadProgress, setUploadProgress] = useState<{ current: number; total: number } | null>(null);
  const [statusMessage, setStatusMessage] = useState<StatusMessage | null>(null);

  const [pendingDelete, setPendingDelete] = useState<ProductModelAttachmentListItem | null>(null);
  const [pendingRestore, setPendingRestore] = useState<TrashedProductModelAttachmentListItem | null>(null);
  const [isMutating, setIsMutating] = useState(false);

  /** 크게 보고 있는 사진의 자리. 사진만 모은 목록(viewable) 기준이다. */
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);

  const allowedExtensions = useMemo(() => allowedExtensionsFor(category), [category]);
  const acceptAttribute = useMemo(
    () => allowedExtensions.map((extension) => `.${extension}`).join(","),
    [allowedExtensions]
  );

  /**
   * 크게 볼 수 있는 것만 모은다. 회로도 PDF 나 문서를 사이에 끼워 두면 넘기다
   * 빈 화면을 만난다.
   */
  const viewable = useMemo(
    () => attachments.filter((item) => isViewableImage(item.mimeType)),
    [attachments]
  );

  function openViewer(item: ProductModelAttachmentListItem) {
    const position = viewable.findIndex((candidate) => candidate.id === item.id);
    if (position >= 0) setViewerIndex(position);
  }

  /** 한 개를 실제로 보낸다. 막혔으면 **서버가 준 문장**을 그대로 들고 온다. */
  async function uploadOne(file: File): Promise<{ ok: true } | { ok: false; reason: string }> {
    try {
      // 본문은 파일 바이트 그 자체이고 메타데이터는 쿼리 문자열이다(파일 상단).
      const query = new URLSearchParams({ category, fileName: file.name });
      const response = await fetch(
        `/api/product-models/${encodeURIComponent(productModelId)}/attachments?${query.toString()}`,
        { method: "POST", body: file }
      );

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        return { ok: false, reason: payload?.error ?? "서버가 거절했습니다" };
      }

      // 썸네일을 이어서 보낸다. 원본을 이미 손에 들고 있으므로 다시 받을 필요가
      // 없고, 서버는 이미지 처리를 전혀 하지 않는다(preview 라우트 주석).
      //
      // await 하지 않는다 — 사용자가 한 일(파일 올리기)은 이미 끝났고, 썸네일은
      // 없어도 목록이 원본으로 보여 준다. 실패해도 조용히 넘어간다.
      const created = (await response.json().catch(() => null)) as { id?: string } | null;
      if (created?.id) void uploadPreview(created.id, file);

      return { ok: true };
    } catch {
      return { ok: false, reason: "네트워크 문제" };
    }
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

    setStatusMessage(
      failures.length === 0
        ? { type: "success", text: `${uploaded}건을 올렸습니다.` }
        : {
            type: "error",
            text: `${uploaded}건을 올렸고 ${failures.length}건은 빠졌습니다 — ${failures
              .map((item) => `${item.name}(${item.reason})`)
              .join(", ")}`,
          }
    );
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
        productModelId,
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
        // 실물이 남는다는 사실을 그때 알려 준다 — 완전히 사라진 줄 알고 다시
        // 올리는 일을 막는다.
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
      const result = await restoreAttachmentAction({ attachmentId: target.id, productModelId });
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

  const isBusy = isUploading || isMutating;

  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      {/*
        건수는 아래 ResponsiveList 의 meta 자리(단추 왼쪽)에 있다 — 다른 목록들이
        전부 그 자리에 적고, 여기와 두 곳에 적으면 같은 수가 한 화면에 두 번
        보인다. 목록이 비었을 때는 어차피 둘 다 없다(아래 빈 상태 문장).
      */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">사진·도면</h2>
      </div>

      {canManageFiles && (
        <form
          onSubmit={handleUpload}
          className="mt-3 flex flex-col gap-2 rounded-md border border-dashed border-zinc-300 p-3 dark:border-zinc-700"
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
                {ATTACHMENT_CATEGORY_CODES.map((code) => (
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
                // 고른 분류가 받는 확장자만 파일 고르는 창에 보인다.
                accept={acceptAttribute}
                disabled={isBusy}
                className="min-w-0 rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-900 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50"
              />
            </label>

            <button
              type="submit"
              disabled={isBusy}
              className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
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
            {allowedExtensions.map((extension) => `.${extension}`).join(" ")} · 한 개당 20MB까지
          </p>
        </form>
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
          아직 올라온 사진·도면이 없습니다.
        </p>
      ) : (
        <div className="mt-3">
          <ResponsiveList
            listId="product-model-attachments"
            /* 사진을 보러 온 자리다 — 고른 적이 없으면 미리보기부터(파일 상단). */
            defaultMode="CARD"
            cardLabel="미리보기"
            meta={
              <span className="mr-auto text-xs text-zinc-500 tabular-nums dark:text-zinc-400">
                {attachments.length}건
              </span>
            }
            /* 줄 수와 `지우기` 열의 유무가 표의 필요 폭을 바꾼다. */
            measureKey={[attachments.length, canManageFiles]}
            table={
              <FilesTable
                attachments={attachments}
                canManageFiles={canManageFiles}
                isBusy={isBusy}
                onDelete={setPendingDelete}
              />
            }
            /* 미리보기는 예전 격자 그대로다 — 자리만 이 안으로 옮겼다(mt-3 은
               위 감싸개가 가져갔다). */
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
                      {item.description && (
                        <span className="truncate text-[11px] text-zinc-600 dark:text-zinc-300">
                          {item.description}
                        </span>
                      )}
                      <div className="mt-auto flex items-center justify-between gap-2 pt-1">
                        <a
                          href={downloadUrlOf(item.id)}
                          className="text-[11px] font-medium text-zinc-700 underline dark:text-zinc-300"
                        >
                          내려받기
                        </a>
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
        접혀 있는 것은 이 구역의 주인공이 아니기 때문이다.
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
                <button
                  type="button"
                  onClick={() => setPendingRestore(item)}
                  disabled={isBusy}
                  className="rounded-md border border-zinc-300 px-2 py-1 text-[11px] font-medium text-zinc-700 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300"
                >
                  되살리기
                </button>
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
    </section>
  );
}
