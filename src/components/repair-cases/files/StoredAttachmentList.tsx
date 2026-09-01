"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { ResponsiveList } from "@/components/common/responsive-list";
import {
  ATTACHMENT_CATEGORY_CODES,
  attachmentCategoryLabels,
  malwareScanStatusLabels,
  type AttachmentCategory,
} from "@/lib/domain/attachment-category";
import {
  ATTACHMENT_GALLERY_ZOOM_STORAGE_KEY,
  DEFAULT_GALLERY_ZOOM_PERCENT,
  GALLERY_ZOOM_PERCENT_RANGE,
  GALLERY_ZOOM_STEP_PERCENT,
  canZoomInGallery,
  canZoomOutGallery,
  clampGalleryZoom,
  formatGalleryZoom,
  galleryGridTemplate,
  readGalleryZoom,
  stepGalleryZoom,
  writeGalleryZoom,
  type GalleryZoomStore,
} from "@/lib/domain/attachment-gallery-zoom";
import {
  ATTACHMENT_KIND_LABELS,
  DEFAULT_ATTACHMENT_LIST_FILTERS,
  applyAttachmentListFilters,
  attachmentKindOf,
  countByKind,
  hasActiveFilters,
  type AttachmentListFilters,
} from "@/lib/domain/attachment-list-filters";
import type { RepairCaseAttachmentListItem } from "@/lib/db/queries/attachments";
import AttachmentViewer from "./AttachmentViewer";
import ShrinkDownloadDialog from "./ShrinkDownloadDialog";
import { fetchAttachmentBlob, saveBlobAs, uploadPreview } from "./shrink-image";
import { createStoredZip, uniqueEntryNames } from "./zip-store";

/**
 * ============================================================================
 * 저장된 첨부 목록 — 보는 방식 두 가지와, 여러 개를 한 번에
 * ============================================================================
 * **썸네일 주소는 `?view=thumb`이다.** 같은 라우트지만 그 값이 붙으면 서버가
 * 사진 형식일 때만 화면 안에 그대로 보여 주고, **감사 로그를 남기지 않는다.**
 * 썸네일 하나마다 FILE_DOWNLOAD가 쌓이면 목록을 한 번 여는 것만으로 감사
 * 기록이 열 줄 늘고, 그렇게 되면 "누가 무엇을 가져갔는가"를 그 안에서 찾을 수
 * 없다. 기록하는 것은 실제로 가져가는 행위뿐이다(라우트 주석 참조).
 *
 * ── 썸네일은 따로 만든 작은 파일이다 ────────────────────────────────────
 * 예전에는 썸네일도 원본을 그대로 받아 CSS로 줄인 것이라, 사진 스무 장짜리
 * 접수 건을 열면 스무 장을 통째로 받았다. 이제는 **올릴 때 브라우저가 480px
 * 짜리 미리보기를 함께 만들어 보낸다**(preview_path). 서버는 이미지 처리를
 * 전혀 하지 않는다 — 네이티브 라이브러리를 들이면 NAS 컨테이너로 옮길 때
 * 짐이 되기 때문이다.
 *
 * 미리보기가 없는 옛 사진은 원본으로 보여 준다(없어도 되는 것이다). 위쪽의
 * "미리보기 만들기"로 한 번에 채울 수 있고, 그때도 만드는 쪽은 브라우저다.
 *
 * ── 표와 카드를 직접 고르지 않는다 ───────────────────────────────────────
 * ResponsiveList가 "표가 들어가면 표, 안 들어가면 카드"를 재서 정하고 사용자가
 * 고른 것을 기억한다. 이 서비스의 모든 목록이 쓰는 기준이라 여기서 다시 정하지
 * 않는다 — 화면마다 기준이 다르면 "이 화면은 왜 카드지?"를 따로 기억해야 한다.
 * ============================================================================
 */

type StoredAttachmentListProps = {
  attachments: RepairCaseAttachmentListItem[];
  /** 지우기를 보일지. 실제 차단은 서버 액션이 다시 한다. */
  canManage: boolean;
  /** 고른 것들을 지운다. 부모가 확인 창을 띄우고 결과를 알린다. */
  onDeleteMany: (items: RepairCaseAttachmentListItem[]) => void;
  /** 지우기·되살리기가 도는 중 — 그동안 조작을 막는다. */
  isBusy: boolean;
};

type ViewKind = "list" | "gallery";

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

/** 화면 안에서 그대로 볼 수 있는 형식인가 — 서버의 판정과 같은 목록이다. */
function isViewableImage(mimeType: string): boolean {
  return mimeType === "image/jpeg" || mimeType === "image/png";
}

function previewUrlOf(id: string): string {
  return `/api/attachments/${encodeURIComponent(id)}/download?view=thumb`;
}

function downloadUrlOf(id: string): string {
  return `/api/attachments/${encodeURIComponent(id)}/download`;
}

/**
 * 브라우저에서 그대로 열어 볼 수 있는 문서인가 — 지금은 PDF 뿐이다.
 *
 * **파일명 확장자로 판단하지 않는다.** 이 저장소는 브라우저가 보낸 형식을 믿지
 * 않고 서버가 확장자에서 정본 MIME 을 골라 저장한다(attachment-allowlist.ts).
 * 화면이 이름을 다시 읽어 판단하면 이름만 바꾼 파일에 속는 자리가 하나 더 생긴다.
 *
 * ⚠️ **isViewableImage 와 일부러 갈라 둔다 — PDF 를 "사진"으로 만들지 않는다.**
 *    위쪽 뷰어(AttachmentViewer)는 `<img>` 로 그리므로 PDF 를 받지 못하고,
 *    viewable 목록에 끼워 넣으면 좌우로 넘기다 빈 화면을 만난다. PDF 는 새
 *    탭에서 연다. 거르기(종류 배지)의 사진/문서 구분도 그대로 둔다.
 *
 * 이것이 참이어도 **여는 것을 결정하는 쪽은 서버다** — 화면은 `?view=full` 을
 * 물을 뿐이고, 열어도 되는 형식인지는 download 라우트의 목록 하나가 정한다.
 */
function isViewablePdf(mimeType: string): boolean {
  return mimeType === "application/pdf";
}

/**
 * 화면에서 원본을 그대로 여는 주소. `?view=full` 은 썸네일이 아니라 **원본**을,
 * 첨부가 아니라 **inline** 으로 준다(형식이 서버 목록에 있을 때만).
 *
 * 새 탭에서 연다 — `<iframe>`·`<embed>`·`<object>` 로 이 페이지 안에 끼워 넣는
 * 길은 막혀 있다. next.config.ts 가 모든 응답에 `X-Frame-Options: DENY` 와
 * `frame-ancestors 'none'` 을 걸기 때문이고, 그 헤더는 이것 때문에 풀 만한
 * 것이 아니다(결재·출하 승인 화면이 클릭 가로채기의 표적이다).
 *
 * 이 주소는 감사 로그를 남기지 않는다(inline 이므로). 그래서 `미리보기` 는
 * `내려받기` 를 **대신하지 않는다** — 훑어보는 것과 손에 들고 나가는 것은 다른
 * 일이고, 기록이 남아야 하는 쪽은 뒤엣것이다. 둘을 나란히 둔다.
 */
function inlineViewUrlOf(id: string): string {
  return `/api/attachments/${encodeURIComponent(id)}/download?view=full`;
}

/** 사진인지 문서인지 한눈에. 거르기 칸의 이름과 같은 말을 쓴다. */
function KindBadge({ mimeType }: { mimeType: string }) {
  const kind = attachmentKindOf(mimeType);
  return (
    <span
      className={`inline-block rounded px-1.5 py-0.5 text-[11px] font-medium ${
        kind === "image"
          ? "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300"
          : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
      }`}
    >
      {ATTACHMENT_KIND_LABELS[kind]}
    </span>
  );
}

/** 사진이 아닌 파일의 자리. 확장자를 크게 보여 준다. */
function FileKindBadge({ fileName, className }: { fileName: string; className?: string }) {
  const extension = fileName.split(".").pop()?.toUpperCase() ?? "파일";
  return (
    <div
      className={`flex items-center justify-center bg-zinc-100 text-xs font-semibold text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400 ${className ?? ""}`}
    >
      {extension.length <= 5 ? extension : "파일"}
    </div>
  );
}

/**
 * 목록·격자 어디에나 들어가는 미리보기.
 *
 * 사진이면 **누르면 크게 열린다.** 썸네일로는 파형의 눈금도 외관의 흠집도
 * 확인할 수 없어서, 확인하려고 찍은 사진이 확인할 수 없는 크기로만 남는다.
 * 사진이 아닌 것은 열어 봐야 보여 줄 게 없으므로 누를 수 없다.
 */
function Thumbnail({
  item,
  size,
  onOpen,
}: {
  item: RepairCaseAttachmentListItem;
  size: "small" | "large";
  onOpen?: (item: RepairCaseAttachmentListItem) => void;
}) {
  const box = size === "small" ? "h-10 w-10 shrink-0 rounded" : "aspect-square w-full";
  if (!isViewableImage(item.mimeType)) {
    return <FileKindBadge fileName={item.originalFileName} className={box} />;
  }

  const image = (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={previewUrlOf(item.id)}
      alt={item.originalFileName}
      // 화면에 들어온 것만 받는다. 미리보기가 없는 옛 사진은 원본이 오므로
      // 이 한 줄이 그때 특히 값이 크다.
      loading="lazy"
      decoding="async"
      className={`${box} bg-zinc-100 object-cover dark:bg-zinc-800`}
    />
  );

  if (!onOpen) return image;

  return (
    <button
      type="button"
      onClick={() => onOpen(item)}
      aria-label={`${item.originalFileName} 크게 보기`}
      className={`${size === "small" ? "shrink-0" : "block w-full"} overflow-hidden rounded`}
    >
      {image}
    </button>
  );
}

/**
 * ────────────────────────────────────────────────────────────────────────────
 * 미리보기 크기 — 이 브라우저에 적어 두는 자리
 * ────────────────────────────────────────────────────────────────────────────
 * 판정은 전부 lib/domain/attachment-gallery-zoom.ts 가 한다. 여기 있는 것은
 * `window.localStorage` 를 실제로 두드리는 일과, 그 값이 바뀌었음을 화면에
 * 알리는 일뿐이다.
 *
 * ⚠️ **responsive-list 의 useStoredChoice 를 쓰지 않는다.** 저장한 값을 화면에
 * 들이는 방법(useSyncExternalStore)은 그쪽을 그대로 따랐다 — 첫 렌더에서 그냥
 * 읽으면 서버가 그린 것과 달라져 hydration 이 어긋나고, effect 에서 읽어
 * setState 하면 기본 크기가 한 프레임 스쳐 지나간다. 다만 그 함수는
 * `window.localStorage` 를 try/catch 없이 만져서, 사생활 보호 창처럼 **읽는
 * 것만으로 던지는** 브라우저에서는 첨부 목록 전체가 죽는다(BrowserNotifications
 * 의 getSeenKeyStore 주석이 그 사정을 적어 두었다). 미리보기 크기 하나 때문에
 * 파일을 못 받게 될 수는 없으므로 여기서는 감싼 것을 쓴다.
 */
const galleryZoomListeners = new Set<() => void>();

/**
 * 저장을 막아 둔 브라우저에서도 **이번 방문 동안은** 조절이 먹히게 하는 자리.
 *
 * 화면이 저장소만 보고 그리면, 적히지 않는 브라우저에서는 슬라이더를 아무리
 * 움직여도 값이 되돌아온다 — 고장으로 보인다. 적어 두기와 별개로 여기에 들고
 * 있으면 화면은 따라오고, 못 적은 대가는 다음에 열 때 기본값으로 돌아가는
 * 것뿐이다.
 */
let galleryZoomInMemory: number | null = null;

/**
 * 저장소를 집는다. **속성을 읽는 것 자체가 던진다**(사생활 보호 창, 저장을 막아
 * 둔 브라우저). 그래서 접근을 통째로 감싼다.
 */
function galleryZoomStore(): GalleryZoomStore | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

function subscribeGalleryZoom(listener: () => void): () => void {
  galleryZoomListeners.add(listener);
  return () => {
    galleryZoomListeners.delete(listener);
  };
}

/**
 * 지금 배율. 숫자라 값으로 비교되므로 useSyncExternalStore 가 매번 같은 것으로
 * 본다(참조가 흔들려 무한히 다시 그리는 일이 없다).
 */
function readGalleryZoomSnapshot(): number {
  if (galleryZoomInMemory !== null) return galleryZoomInMemory;
  return readGalleryZoom(galleryZoomStore(), ATTACHMENT_GALLERY_ZOOM_STORAGE_KEY);
}

/** 서버에는 저장소가 없다. 아직 아무것도 안 고른 사람과 같은 화면을 준다. */
function readGalleryZoomServerSnapshot(): number {
  return DEFAULT_GALLERY_ZOOM_PERCENT;
}

function setGalleryZoom(percent: number): void {
  galleryZoomInMemory = clampGalleryZoom(percent);
  writeGalleryZoom(galleryZoomStore(), ATTACHMENT_GALLERY_ZOOM_STORAGE_KEY, galleryZoomInMemory);
  for (const listener of galleryZoomListeners) listener();
}

export default function StoredAttachmentList({
  attachments,
  canManage,
  onDeleteMany,
  isBusy,
}: StoredAttachmentListProps) {
  const router = useRouter();
  const [view, setView] = useState<ViewKind>("list");
  /**
   * 미리보기 타일 크기(%). 이 사람 브라우저에 남고 다음에 열어도 그대로다 —
   * 서버에도 DB 에도 보내지 않는다(내 화면을 어떻게 보느냐는 내 사정이다).
   */
  const zoomPercent = useSyncExternalStore(
    subscribeGalleryZoom,
    readGalleryZoomSnapshot,
    readGalleryZoomServerSnapshot
  );
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  /** 크게 보고 있는 사진의 자리. 사진 목록(viewable) 기준이다. */
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  /** 줄여서 받을 대상. 비어 있지 않으면 창이 떠 있다. */
  const [shrinkTargets, setShrinkTargets] = useState<RepairCaseAttachmentListItem[]>([]);
  /** 여러 개를 묶는 중 — 파일을 하나씩 받아 오므로 진행을 보여 준다. */
  const [bundleProgress, setBundleProgress] = useState<{ current: number; total: number } | null>(null);
  const [bundleError, setBundleError] = useState<string | null>(null);

  const [filters, setFilters] = useState<AttachmentListFilters>(DEFAULT_ATTACHMENT_LIST_FILTERS);
  /** 옛 사진의 미리보기를 채우는 중. */
  const [previewProgress, setPreviewProgress] = useState<{ current: number; total: number } | null>(null);

  /** 사진인데 미리보기가 없는 것들 — 목록이 원본을 그대로 받아 오는 대상이다. */
  const missingPreview = useMemo(
    () => attachments.filter((item) => isViewableImage(item.mimeType) && !item.previewPath),
    [attachments]
  );

  async function buildMissingPreviews() {
    setPreviewProgress({ current: 0, total: missingPreview.length });
    try {
      for (const [index, item] of missingPreview.entries()) {
        setPreviewProgress({ current: index + 1, total: missingPreview.length });
        // 원본을 받아 브라우저에서 줄여 올린다. 한 장씩 하는 이유는 폰에서
        // 여러 장을 동시에 풀면 메모리가 모자라 탭이 죽기 때문이다.
        const source = await fetchAttachmentBlob(item.id);
        await uploadPreview(item.id, source);
      }
      // 목록은 서버가 만든다 — 새 previewPath를 받아 오려면 다시 그려야 한다.
      router.refresh();
    } finally {
      setPreviewProgress(null);
    }
  }

  /**
   * 조건에 맞아 지금 화면에 있는 것들.
   *
   * **아래의 모든 조작이 이 목록을 기준으로 한다.** 안 보이는 것을 지우거나
   * 받는 일이 없어야 하기 때문이다 — 조건을 걸어 좁혀 놓고 "전체 선택"을
   * 눌렀는데 화면 밖의 것까지 지워지면 되돌릴 방법이 없다.
   */
  const visible = useMemo(
    () => applyAttachmentListFilters(attachments, filters),
    [attachments, filters]
  );
  const kindCounts = useMemo(() => countByKind(attachments), [attachments]);
  /** 지금 목록에 실제로 있는 분류만 고를 수 있게 한다 — 없는 것을 골라 빈 화면을 보지 않도록. */
  const presentCategories = useMemo(
    () => ATTACHMENT_CATEGORY_CODES.filter((code) => attachments.some((item) => item.category === code)),
    [attachments]
  );

  /**
   * 크게 볼 수 있는 것들만 모은다. 압축 파일이나 로그를 사이에 끼워 두면
   * 넘기다 빈 화면을 만난다.
   */
  const viewable = useMemo(
    () => visible.filter((item) => isViewableImage(item.mimeType)),
    [visible]
  );

  function openViewer(item: RepairCaseAttachmentListItem) {
    const position = viewable.findIndex((candidate) => candidate.id === item.id);
    if (position >= 0) setViewerIndex(position);
  }

  // 화면에 보이는 것만 고른 것으로 친다. 조건을 바꾸면 가려진 것은 선택에서도
  // 빠진다 — 안 보이는 것이 함께 지워지는 일이 없어야 한다. 목록이 바뀐 뒤
  // (올리기·지우기) 이제 없는 id가 남아 있는 경우도 같은 규칙으로 걸러진다.
  const selected = useMemo(
    () => visible.filter((item) => selectedIds.includes(item.id)),
    [visible, selectedIds]
  );
  const allSelected = visible.length > 0 && selected.length === visible.length;
  /** 고른 것 중 줄일 수 있는 것(사진)만. 줄이기는 사진에만 뜻이 있다. */
  const selectedViewable = useMemo(
    () => selected.filter((item) => isViewableImage(item.mimeType)),
    [selected]
  );

  function toggle(id: string) {
    setSelectedIds((previous) =>
      previous.includes(id) ? previous.filter((value) => value !== id) : [...previous, id]
    );
  }

  function toggleAll() {
    setSelectedIds(allSelected ? [] : visible.map((item) => item.id));
  }

  /**
   * 고른 것들을 내려받는다.
   *
   * **한 개면 그냥 링크, 여러 개면 ZIP 하나로 묶는다.**
   *
   * 처음에는 링크를 잇달아 눌러 주는 방식이었는데, 실제로 해 보니 **첫 개만
   * 받아지고 나머지는 조용히 사라졌다.** 브라우저가 연속 내려받기를 막기
   * 때문이고, 폰에서는 허용 확인창조차 뜨지 않는다. 그래서 묶는다 — 내려받기가
   * 한 번이면 막힐 일이 없다.
   *
   * 압축은 하지 않는다(zip-store.ts). 담을 것이 이미 압축된 사진이라 다시
   * 압축해도 거의 줄지 않고, 압축 라이브러리는 NAS 컨테이너로 옮길 때 짐이 된다.
   */
  async function downloadSelected() {
    if (selected.length === 0) return;

    if (selected.length === 1) {
      const anchor = document.createElement("a");
      anchor.href = downloadUrlOf(selected[0].id);
      anchor.rel = "noopener";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      return;
    }

    setBundleProgress({ current: 0, total: selected.length });
    setBundleError(null);
    try {
      const names = uniqueEntryNames(selected.map((item) => item.originalFileName));
      const entries = [];
      for (const [index, item] of selected.entries()) {
        setBundleProgress({ current: index + 1, total: selected.length });
        // 감사 로그가 남는 쪽(inline이 아닌 주소)으로 받는다 — 실제로 파일을
        // 가져가는 행위이기 때문이다.
        const response = await fetch(downloadUrlOf(item.id));
        if (!response.ok) throw new Error(`${item.originalFileName}을(를) 받지 못했습니다.`);
        entries.push({
          name: names[index],
          data: new Uint8Array(await response.arrayBuffer()),
        });
      }
      saveBlobAs(createStoredZip(entries), `첨부파일_${entries.length}건.zip`);
    } catch (caught) {
      setBundleError(caught instanceof Error ? caught.message : "묶어서 받지 못했습니다.");
    } finally {
      setBundleProgress(null);
    }
  }

  const filterBar = (
    <div className="flex flex-col gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-center gap-2">
        {/* 종류 — 사진이냐 문서냐. 개수를 함께 보여 줘 눌러 보지 않아도 안다. */}
        <div className="flex overflow-hidden rounded-md border border-zinc-300 dark:border-zinc-700">
          {(
            [
              ["all", `전체 ${attachments.length}`],
              ["image", `${ATTACHMENT_KIND_LABELS.image} ${kindCounts.image}`],
              ["file", `${ATTACHMENT_KIND_LABELS.file} ${kindCounts.file}`],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setFilters((previous) => ({ ...previous, kind: value }))}
              aria-pressed={filters.kind === value}
              className={`px-2.5 py-1.5 text-xs font-medium tabular-nums ${
                filters.kind === value
                  ? "bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-900"
                  : "text-zinc-700 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-800"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* 업무 분류 — 지금 목록에 있는 것만 고를 수 있다. */}
        {presentCategories.length > 1 && (
          <select
            value={filters.category}
            onChange={(event) =>
              setFilters((previous) => ({
                ...previous,
                category: event.target.value as AttachmentCategory | "all",
              }))
            }
            aria-label="분류로 거르기"
            className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-950"
          >
            <option value="all">분류 전체</option>
            {presentCategories.map((code) => (
              <option key={code} value={code}>
                {attachmentCategoryLabels[code]}
              </option>
            ))}
          </select>
        )}

        <input
          type="search"
          value={filters.query}
          onChange={(event) => setFilters((previous) => ({ ...previous, query: event.target.value }))}
          placeholder="파일명·설명 검색"
          aria-label="파일명이나 설명으로 검색"
          className="min-w-0 flex-1 rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-950"
        />

        {hasActiveFilters(filters) && (
          <button
            type="button"
            onClick={() => setFilters(DEFAULT_ATTACHMENT_LIST_FILTERS)}
            className="text-xs text-zinc-600 underline dark:text-zinc-400"
          >
            조건 지우기
          </button>
        )}
      </div>

      {hasActiveFilters(filters) && (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          {attachments.length}건 중 <strong className="text-zinc-700 dark:text-zinc-300">{visible.length}건</strong>{" "}
          보이는 중입니다. 아래 조작은 <strong>보이는 것에만</strong> 적용됩니다.
        </p>
      )}
    </div>
  );

  const selectionBar = (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900">
      <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
        <input
          type="checkbox"
          checked={allSelected}
          onChange={toggleAll}
          disabled={isBusy || visible.length === 0}
          className="h-4 w-4"
        />
        {selected.length > 0 ? `${selected.length}건 선택됨` : "전체 선택"}
      </label>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={downloadSelected}
          disabled={isBusy || selected.length === 0 || bundleProgress !== null}
          className="rounded-md border border-zinc-300 px-2.5 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          {bundleProgress
            ? `묶는 중… ${bundleProgress.current}/${bundleProgress.total}`
            : selected.length > 1
              ? "묶어서 받기"
              : "내려받기"}
        </button>
        {/*
          줄일 수 있는 것은 사진뿐이다. 고른 것 중에 사진이 하나도 없으면
          누를 수 없다 — 눌러 놓고 "줄일 게 없습니다"를 보여 주지 않는다.
        */}
        <button
          type="button"
          onClick={() => setShrinkTargets(selectedViewable)}
          disabled={isBusy || selectedViewable.length === 0}
          title={
            selected.length > 0 && selectedViewable.length === 0
              ? "고른 것 중에 사진이 없습니다"
              : undefined
          }
          className="rounded-md border border-zinc-300 px-2.5 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          줄여서 받기
        </button>
        {canManage && (
          <button
            type="button"
            onClick={() => onDeleteMany(selected)}
            disabled={isBusy || selected.length === 0}
            className="rounded-md border border-zinc-300 px-2.5 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-40 dark:border-zinc-700 dark:text-red-400 dark:hover:bg-red-950"
          >
            지우기
          </button>
        )}
        {/* 보기 전환 — 목록과 미리보기 */}
        <div className="flex overflow-hidden rounded-md border border-zinc-300 dark:border-zinc-700">
          {(["list", "gallery"] as const).map((kind) => (
            <button
              key={kind}
              type="button"
              onClick={() => setView(kind)}
              aria-pressed={view === kind}
              className={`px-2.5 py-1.5 text-xs font-medium ${
                view === kind
                  ? "bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-900"
                  : "text-zinc-700 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-800"
              }`}
            >
              {kind === "list" ? "목록" : "미리보기"}
            </button>
          ))}
        </div>
      </div>
    </div>
  );

  // ── 목록: 표 ──────────────────────────────────────────────────────────
  const table = (
    <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <table className="min-w-full text-left text-sm">
        <thead className="border-b border-zinc-200 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
          <tr>
            <th scope="col" className="w-10 px-3 py-2" />
            <th scope="col" className="px-3 py-2 font-medium">파일명</th>
            <th scope="col" className="px-3 py-2 font-medium">종류</th>
            <th scope="col" className="px-3 py-2 font-medium">분류</th>
            <th scope="col" className="px-3 py-2 font-medium">크기</th>
            <th scope="col" className="px-3 py-2 font-medium">검사</th>
            <th scope="col" className="px-3 py-2 font-medium">올린 사람</th>
            <th scope="col" className="px-3 py-2 font-medium">올린 시각</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">작업</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {visible.map((item) => (
            <tr key={item.id} className={selectedIds.includes(item.id) ? "bg-zinc-50 dark:bg-zinc-950" : undefined}>
              <td className="px-3 py-2">
                <input
                  type="checkbox"
                  checked={selectedIds.includes(item.id)}
                  onChange={() => toggle(item.id)}
                  disabled={isBusy}
                  aria-label={`${item.originalFileName} 선택`}
                  className="h-4 w-4"
                />
              </td>
              <td className="px-3 py-2">
                {/* 목록에서도 작게나마 보인다 — 파일명만으로는 어느 사진인지 모른다. */}
                <div className="flex items-center gap-2">
                  <Thumbnail item={item} size="small" onOpen={openViewer} />
                  <div className="min-w-0">
                    <span className="block truncate text-zinc-900 dark:text-zinc-50">
                      {item.originalFileName}
                    </span>
                    {item.description && (
                      <span className="block truncate text-xs text-zinc-500 dark:text-zinc-400">
                        {item.description}
                      </span>
                    )}
                  </div>
                </div>
              </td>
              <td className="px-3 py-2 whitespace-nowrap">
                <KindBadge mimeType={item.mimeType} />
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
              <td className="px-3 py-2 whitespace-nowrap text-zinc-700 dark:text-zinc-300">
                {item.uploadedByName}
              </td>
              <td className="px-3 py-2 whitespace-nowrap text-zinc-700 dark:text-zinc-300">
                {formatTimestamp(item.uploadedAt)}
              </td>
              <td className="px-3 py-2 whitespace-nowrap text-right">
                <div className="flex items-center justify-end gap-2">
                  {/*
                    PDF 는 새 탭에서 그대로 열어 본다. 사진은 여기 없다 — 사진은
                    왼쪽 썸네일을 누르면 화면 위 뷰어가 열리므로 같은 일을 하는
                    단추가 한 줄에 둘이 되지 않게 한다.
                  */}
                  {isViewablePdf(item.mimeType) && (
                    <a
                      href={inlineViewUrlOf(item.id)}
                      // 새 탭에서 연다(iframe 은 전역 헤더가 막는다).
                      // rel 은 새 탭이 window.opener 로 이 창을 건드리지 못하게 한다.
                      target="_blank"
                      rel="noopener noreferrer"
                      // 한 화면에 같은 말이 여럿이라 무엇을 여는지 이름으로 밝힌다.
                      // (sr-only 로 숨긴 글자는 이 저장소에서 페이지를 굴린 전력이
                      //  있어 쓰지 않는다 — aria-label 로 붙인다.)
                      aria-label={`${item.originalFileName} 미리보기`}
                      className="rounded-md border border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                    >
                      미리보기
                    </a>
                  )}
                  <a
                    href={downloadUrlOf(item.id)}
                    className="rounded-md border border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                  >
                    내려받기
                  </a>
                  {canManage && (
                    <button
                      type="button"
                      onClick={() => onDeleteMany([item])}
                      disabled={isBusy}
                      className="rounded-md border border-zinc-300 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-zinc-700 dark:text-red-400 dark:hover:bg-red-950"
                    >
                      지우기
                    </button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  // ── 목록: 카드 (폰) ───────────────────────────────────────────────────
  const cards = (
    <ul className="flex flex-col gap-2">
      {visible.map((item) => (
        <li
          key={item.id}
          className={`rounded-lg border p-3 ${
            selectedIds.includes(item.id)
              ? "border-zinc-900 bg-zinc-50 dark:border-zinc-50 dark:bg-zinc-950"
              : "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900"
          }`}
        >
          <div className="flex items-start gap-3">
            <input
              type="checkbox"
              checked={selectedIds.includes(item.id)}
              onChange={() => toggle(item.id)}
              disabled={isBusy}
              aria-label={`${item.originalFileName} 선택`}
              className="mt-1 h-5 w-5 shrink-0"
            />
            <Thumbnail item={item} size="small" onOpen={openViewer} />
            <div className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-zinc-900 dark:text-zinc-50">
                {item.originalFileName}
              </span>
              <span className="block text-xs text-zinc-500 dark:text-zinc-400">
                <KindBadge mimeType={item.mimeType} /> {attachmentCategoryLabels[item.category]} · {formatBytes(item.fileSize)}
              </span>
              <span className="block text-xs text-zinc-500 dark:text-zinc-400">
                {item.uploadedByName} · {formatTimestamp(item.uploadedAt)}
              </span>
              {item.description && (
                <span className="mt-1 block text-xs text-zinc-600 dark:text-zinc-300">{item.description}</span>
              )}
            </div>
          </div>
          <div className="mt-2 flex justify-end gap-2">
            {/* 표 보기와 같은 규칙이다 — PDF 만, 새 탭에서(위 표의 주석 참조). */}
            {isViewablePdf(item.mimeType) && (
              <a
                href={inlineViewUrlOf(item.id)}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`${item.originalFileName} 미리보기`}
                className="rounded-md border border-zinc-300 px-2.5 py-1.5 text-xs font-medium text-zinc-700 dark:border-zinc-700 dark:text-zinc-300"
              >
                미리보기
              </a>
            )}
            <a
              href={downloadUrlOf(item.id)}
              className="rounded-md border border-zinc-300 px-2.5 py-1.5 text-xs font-medium text-zinc-700 dark:border-zinc-700 dark:text-zinc-300"
            >
              내려받기
            </a>
            {canManage && (
              <button
                type="button"
                onClick={() => onDeleteMany([item])}
                disabled={isBusy}
                className="rounded-md border border-zinc-300 px-2.5 py-1.5 text-xs font-medium text-red-700 disabled:opacity-50 dark:border-zinc-700 dark:text-red-400"
              >
                지우기
              </button>
            )}
          </div>
        </li>
      ))}
    </ul>
  );

  // ── 미리보기: 크기 조절 바 ────────────────────────────────────────────
  /**
   * `−` 슬라이더 `+` 배율. 윈도우 사진 앱·탐색기의 확대 바와 같은 모양이다
   * (사용자가 그 화면을 그대로 가리켜 요청했다).
   *
   * 🔴 **미리보기 보기에서만 나온다.** 목록(표·카드) 보기의 썸네일은 40px 고정이라
   * 이 조절과 상관이 없고, 안 듣는 조절 바가 화면에 남아 있으면 그것이 고장이다.
   *
   * 키보드로도 조절된다 — `<input type="range">` 는 방향키를 저절로 받고, 단추와
   * 슬라이더에는 무엇을 조절하는 것인지 이름을 붙였다. 지금 몇 %인지는
   * aria-valuetext 로 낭독기에 전해진다(오른쪽 글자는 그래서 aria-hidden 이다 —
   * 안 그러면 같은 값을 두 번 읽는다).
   */
  const zoomBar = (
    <div className="flex items-center justify-end gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900">
      <span className="text-xs text-zinc-500 dark:text-zinc-400">미리보기 크기</span>
      <button
        type="button"
        onClick={() => setGalleryZoom(stepGalleryZoom(zoomPercent, -1))}
        disabled={!canZoomOutGallery(zoomPercent)}
        aria-label="미리보기 크기 줄이기"
        className="rounded-md border border-zinc-300 px-2 py-1 text-xs font-medium leading-none text-zinc-700 hover:bg-zinc-50 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
      >
        −
      </button>
      <input
        type="range"
        min={GALLERY_ZOOM_PERCENT_RANGE.min}
        max={GALLERY_ZOOM_PERCENT_RANGE.max}
        step={GALLERY_ZOOM_STEP_PERCENT}
        value={zoomPercent}
        onChange={(event) => setGalleryZoom(Number(event.target.value))}
        aria-label="미리보기 크기"
        aria-valuetext={formatGalleryZoom(zoomPercent)}
        className="w-24 cursor-pointer accent-zinc-900 sm:w-40 dark:accent-zinc-100"
      />
      <button
        type="button"
        onClick={() => setGalleryZoom(stepGalleryZoom(zoomPercent, 1))}
        disabled={!canZoomInGallery(zoomPercent)}
        aria-label="미리보기 크기 키우기"
        className="rounded-md border border-zinc-300 px-2 py-1 text-xs font-medium leading-none text-zinc-700 hover:bg-zinc-50 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
      >
        +
      </button>
      <span
        aria-hidden="true"
        className="w-10 text-right text-xs tabular-nums text-zinc-600 dark:text-zinc-400"
      >
        {formatGalleryZoom(zoomPercent)}
      </span>
    </div>
  );

  // ── 미리보기: 격자 ────────────────────────────────────────────────────
  /**
   * 칸 수를 못 박지 않는다. **타일 너비만 정하고 칸 수는 브라우저가 센다**
   * (auto-fill) — 그래야 사람이 고른 크기가 그대로 나오고, 자리가 좁아지면
   * 칸이 저절로 줄어든다. 예전에는 화면 너비만 보고 2·3·4칸으로 못 박혀 있어서
   * 사람이 정할 여지가 없었다(그 결과가 "크게만 나온다"였다).
   *
   * Tailwind 로는 못 쓴다 — 클래스 이름을 값에서 만들어 내면 빌드 때 그 클래스가
   * 없다. 그래서 style 로 준다(값 계산은 attachment-gallery-zoom.ts).
   */
  const gallery = (
    <ul className="grid gap-3" style={{ gridTemplateColumns: galleryGridTemplate(zoomPercent) }}>
      {visible.map((item) => {
        const isSelected = selectedIds.includes(item.id);
        return (
          <li
            key={item.id}
            className={`overflow-hidden rounded-lg border ${
              isSelected
                ? "border-zinc-900 dark:border-zinc-50"
                : "border-zinc-200 dark:border-zinc-800"
            } bg-white dark:bg-zinc-900`}
          >
            {/*
              누르는 자리가 둘이다 — 그림은 크게 열고, 모서리 동그라미는
              고른다. 폰 갤러리 앱과 같은 약속이다. 동그라미는 손가락이
              닿을 만큼(44px) 키워 두었다.
            */}
            <div className="relative">
              <Thumbnail item={item} size="large" onOpen={openViewer} />
              <button
                type="button"
                onClick={() => toggle(item.id)}
                disabled={isBusy}
                aria-pressed={isSelected}
                aria-label={`${item.originalFileName} 선택`}
                className="absolute left-0 top-0 flex h-11 w-11 items-center justify-center disabled:opacity-50"
              >
                <span
                  aria-hidden="true"
                  className={`flex h-6 w-6 items-center justify-center rounded-full border-2 text-xs font-bold ${
                    isSelected
                      ? "border-white bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-900"
                      : "border-white/90 bg-black/40 text-transparent"
                  }`}
                >
                  ✓
                </span>
              </button>
            </div>
            <div className="flex flex-col gap-1 p-2">
              <span className="truncate text-xs font-medium text-zinc-900 dark:text-zinc-50">
                {item.originalFileName}
              </span>
              <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
                <KindBadge mimeType={item.mimeType} /> {attachmentCategoryLabels[item.category]} · {formatBytes(item.fileSize)}
              </span>
              <div className="mt-1 flex justify-between gap-2">
                {/*
                  왼쪽 한 덩어리로 묶는다 — 이 줄은 justify-between 이라
                  묶지 않으면 단추가 셋일 때 `내려받기` 가 가운데로 흩어지고
                  `지우기` 만 오른쪽에 남는다. 표 보기와 같은 규칙으로 PDF 에만
                  `미리보기` 가 붙는다(위 표의 주석 참조).
                */}
                <div className="flex min-w-0 items-center gap-2">
                  {isViewablePdf(item.mimeType) && (
                    <a
                      href={inlineViewUrlOf(item.id)}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`${item.originalFileName} 미리보기`}
                      className="text-[11px] font-medium text-zinc-700 underline dark:text-zinc-300"
                    >
                      미리보기
                    </a>
                  )}
                  <a
                    href={downloadUrlOf(item.id)}
                    className="text-[11px] font-medium text-zinc-700 underline dark:text-zinc-300"
                  >
                    내려받기
                  </a>
                </div>
                {canManage && (
                  <button
                    type="button"
                    onClick={() => onDeleteMany([item])}
                    disabled={isBusy}
                    className="text-[11px] font-medium text-red-700 underline disabled:opacity-50 dark:text-red-400"
                  >
                    지우기
                  </button>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );

  return (
    <div className="flex flex-col gap-2">
      {filterBar}
      {selectionBar}

      {/*
        옛 사진 채우기. 미리보기가 생기기 전에 올라온 것들은 목록에서 원본을
        그대로 받아 오므로 느리다. 한 번 눌러 두면 그 뒤로는 빨라진다.
        만드는 쪽은 여기서도 브라우저다 — 서버는 이미지 처리를 하지 않는다.
      */}
      {missingPreview.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs dark:border-amber-900 dark:bg-amber-950">
          <span className="text-amber-800 dark:text-amber-300">
            사진 {missingPreview.length}장에 미리보기가 없어 목록이 원본을 그대로 받아 옵니다.
          </span>
          <button
            type="button"
            onClick={buildMissingPreviews}
            disabled={isBusy || previewProgress !== null}
            className="rounded-md border border-amber-300 px-2.5 py-1.5 font-medium text-amber-900 disabled:opacity-50 dark:border-amber-800 dark:text-amber-200"
          >
            {previewProgress
              ? `만드는 중… ${previewProgress.current}/${previewProgress.total}`
              : "미리보기 만들기"}
          </button>
        </div>
      )}

      {bundleError && (
        <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-400">
          {bundleError}
        </p>
      )}
      {visible.length === 0 ? (
        <div className="rounded-lg border border-zinc-200 bg-white p-6 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
          조건에 맞는 파일이 없습니다.{" "}
          <button
            type="button"
            onClick={() => setFilters(DEFAULT_ATTACHMENT_LIST_FILTERS)}
            className="underline"
          >
            조건 지우기
          </button>
        </div>
      ) : view === "gallery" ? (
        // 조절 바는 격자 바로 위에 둔다 — 여기가 그 조절이 실제로 듣는 유일한
        // 자리이고, 위 도구 줄에 얹으면 목록 보기에서도 보여 안 듣는 조절이 된다.
        <>
          {zoomBar}
          {gallery}
        </>
      ) : (
        <ResponsiveList listId="repair-case-stored-attachments" table={table} cards={cards} />
      )}

      {viewerIndex !== null && (
        <AttachmentViewer
          items={viewable}
          initialIndex={viewerIndex}
          onClose={() => setViewerIndex(null)}
          onShrinkDownload={(item) => setShrinkTargets([item])}
        />
      )}

      {shrinkTargets.length > 0 && (
        <ShrinkDownloadDialog items={shrinkTargets} onClose={() => setShrinkTargets([])} />
      )}
    </div>
  );
}
