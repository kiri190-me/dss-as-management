"use client";

import { useMemo, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { FileDropZone, putFilesInPicker } from "@/components/common/FileDropZone";
import { showSavePopup } from "@/components/common/SavePopup";
import { ResponsiveList } from "@/components/common/responsive-list";
import AttachmentViewer from "@/components/repair-cases/files/AttachmentViewer";
import DeleteAttachmentDialog from "@/components/repair-cases/files/DeleteAttachmentDialog";
import PurgeAttachmentDialog from "@/components/repair-cases/files/PurgeAttachmentDialog";
import RestoreAttachmentDialog from "@/components/repair-cases/files/RestoreAttachmentDialog";
import { uploadPreview } from "@/components/repair-cases/files/shrink-image";
import type {
  ProductModelAttachmentListItem,
  TrashedProductModelAttachmentListItem,
} from "@/lib/db/queries/attachments";
import {
  ATTACHMENT_EXTENSION_RULES,
  isCategoryOpenToAnyExtension,
  isExtensionAllowedForCategory,
} from "@/lib/domain/attachment-allowlist";
import {
  attachmentCategoriesForOwner,
  attachmentCategoryLabels,
  type AttachmentCategory,
} from "@/lib/domain/attachment-category";
import { ATTACHMENT_KIND_LABELS, attachmentKindOf } from "@/lib/domain/attachment-list-filters";
import {
  ORIGINAL_MODIFIED_AT_PARAM,
  originalModifiedAtParamValue,
} from "@/lib/domain/attachment-original-modified-at";
import {
  purgeAttachmentAction,
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
 * 종류 배지가 알린다. 사진을 **늘어놓는** 자리는 미리보기 격자다.
 *
 * 대신 표에는 `미리보기` 열이 있다. 누르면 사진은 격자에서 썸네일을 누른 것과
 * 똑같이 뷰어가 열리고, PDF 는 새 탭에서 열린다 — 자세한 사정은 isPreviewable
 * 머리말에 있다.
 *
 * 올리기 폼과 휴지통은 전환 장치 **밖**에 둔다 — 보기 방식과 상관없이 늘 같은
 * 자리에 있어야 한다.
 *
 * ── 날짜가 둘이다 — 🔴 뜻을 섞지 말 것 (2026-09-30) ──────────────────────
 *   올린 날짜    우리 시스템에 들어온 때(attachments.uploaded_at). 서버가 잰 값.
 *   원본 수정일  **올린 사람 PC 에서 그 파일을 마지막으로 저장한 때.** 브라우저의
 *                `File.lastModified` 를 올릴 때 함께 실어 보낸 값이다
 *                (attachments.original_modified_at).
 *
 * 사장님이 이 열을 보는 까닭은 「이 양식이 언제 갱신된 것인가」이지 「언제
 * 올렸는가」가 아니다(사용자 요청). 🔴 **모르는 파일은 빈칸으로 둔다** — 이 칸이
 * 생기기 전에 올라온 파일은 전부 그렇고, 올린 날짜로 메우면 화면이 아무 오류 없이
 * 거짓을 말한다. 못 믿을 값을 거르는 판정은 화면이 하지 않는다: 보내는 쪽도 받는
 * 쪽도 domain/attachment-original-modified-at.ts 하나를 지난다.
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
 * 올리기 칸의 분류 선택지 — 제품 모델 파일이 받는 분류만. 「스크린샷」은 개선 요청 글
 * 전용이라 빠진다(attachment-category.ts 의 isAttachmentCategoryAllowedForOwner —
 * 올리기 통로도 같은 함수로 거절한다).
 *
 * 🔴 **목록을 손으로 적지 않는다.** 그래서 2026-09-30 에 더한 모델 기본 자료 셋
 * (파라미터 · 통전검사 · 점검표)은 이 화면을 고치지 않아도 저절로 나타났다.
 * 같은 날 「점검표」만 접수 건에도 열렸는데(모델 것은 빈 양식, 접수 건 것은 채워
 * 인쇄한 기록), 그때도 두 화면 모두 고칠 것이 없었다 — 규칙은
 * isAttachmentCategoryAllowedForOwner 한 자리에만 있다.
 */
const PRODUCT_MODEL_UPLOAD_CATEGORIES = attachmentCategoriesForOwner("PRODUCT_MODEL");

/**
 * 이 분류가 받는 확장자 — **셀 수 있을 때만**. 형식을 가리지 않는 분류(파라미터 ·
 * 통전검사 · 점검표)는 목록으로 적을 수가 없어 null 이다. 그때 파일 고르는 창에는
 * `accept` 를 아예 걸지 않고(= 모든 파일), 안내 글도 목록 대신 한 문장을 쓴다.
 *
 * 🔴 **손으로 적지 않는다** — 정본(CATEGORY_EXTENSION_ALLOWLIST ·
 * ANY_EXTENSION_CATEGORIES)이 넓어지거나 좁아지는 날 이 화면이 저절로 따라와야 한다.
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
 * 원본 수정일을 모르는 파일의 칸(2026-09-30).
 *
 * 이 칸이 생기기 전에 올라온 파일은 전부 이것이다 — 그 값을 받은 적이 없기
 * 때문이다. 🔴 **올린 날짜로 대신 채우지 않는다**(사용자 결정): 그러면 화면은
 * 아무 오류 없이 거짓을 말하고, 읽는 사람은 그 날짜를 보고 "이 양식은 최신이다"를
 * 판단한다. 아주 비워 두지 않고 줄표를 적는 것은, 빈 칸이 "열이 한 칸 밀렸나"로
 * 읽히기 때문이다.
 */
const UNKNOWN_ORIGINAL_MODIFIED_AT = "—";

/** 화면 안에서 그대로 볼 수 있는 형식인가 — 서버(download 라우트)의 판정과 같은 목록이다. */
function isViewableImage(mimeType: string): boolean {
  return mimeType === "image/jpeg" || mimeType === "image/png";
}

/**
 * 브라우저에서 그대로 열어 볼 수 있는 문서인가 — 지금은 PDF 뿐이다.
 *
 * **파일명 확장자로 판단하지 않는다.** 이 저장소는 브라우저가 보낸 형식을 믿지
 * 않고, 서버가 확장자에서 정본 MIME 을 골라 저장한다(attachment-allowlist.ts).
 * 화면이 이름을 다시 읽어 판단하면 이름만 바꾼 파일에 속는 자리가 하나 더 생긴다.
 *
 * 이것이 참이어도 **여는 것을 결정하는 쪽은 서버다** — 화면은 `?view=full` 을
 * 물을 뿐이고, 열어도 되는 형식인지는 download 라우트의 목록 하나가 정한다.
 * 여기서 참으로 만든다고 서버가 열어 주지는 않는다.
 */
function isViewablePdf(mimeType: string): boolean {
  return mimeType === "application/pdf";
}

/**
 * 표에서 `미리보기` 를 그릴 형식인가.
 *
 * ⚠️ **누르면 벌어지는 일이 형식마다 다르다** — 그리고 그것은 의도한 것이다.
 *
 *   사진(jpeg·png)  화면 위에 AttachmentViewer 가 열린다. 좌우로 넘어간다.
 *   PDF             새 탭에서 열린다.
 *
 * 사용자에게는 "이 파일을 본다" 하나이므로 글자도 **둘 다 `미리보기`** 로 같다.
 * 갈리는 까닭은 우리 사정이다: 뷰어는 `<img>` 로 그리므로 PDF 를 못 받고,
 * PDF 를 이 페이지 안에 끼워 넣는 길은 전역 `X-Frame-Options: DENY` 와
 * `frame-ancestors 'none'` 이 막아 새 탭밖에 남지 않는다. 그 사정을 단추 글자로
 * 내보이면 사용자는 자기가 고를 수 있는 두 가지가 있는 줄 안다.
 */
function isPreviewable(mimeType: string): boolean {
  return isViewableImage(mimeType) || isViewablePdf(mimeType);
}

function downloadUrlOf(id: string): string {
  return `/api/attachments/${encodeURIComponent(id)}/download`;
}

/**
 * 화면에서 원본을 그대로 여는 주소. `?view=full` 은 썸네일이 아니라 **원본**을,
 * 첨부가 아니라 **inline** 으로 준다(형식이 서버 목록에 있을 때만).
 *
 * 새 탭에서 연다 — `<iframe>`·`<embed>`·`<object>` 로 이 페이지 안에 끼워 넣는
 * 길은 막혀 있다. next.config.ts 가 모든 응답에 `X-Frame-Options: DENY` 와
 * `frame-ancestors 'none'` 을 걸기 때문이고, 그 헤더는 이것 때문에 풀 만한
 * 것이 아니다(결재·출하 승인 화면이 클릭 가로채기의 표적이다).
 */
function inlineViewUrlOf(id: string): string {
  return `/api/attachments/${encodeURIComponent(id)}/download?view=full`;
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
      // object-contain이다 — 잘라 채우면 도면·명판처럼 가로로 긴 그림의 양 끝이
      // 사라져 무엇인지 알아볼 수 없다. 맞춰 넣어 남는 자리는 bg-zinc-100/800 이
      // 받는다(칸 크기는 aspect-square w-full 그대로).
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
 * 표 보기 — 파일이 늘었을 때 이름·분류·크기를 **글자로** 훑는 자리.
 *
 * 🔴 **썸네일을 넣지 말 것.** 넣는 순간 미리보기 격자와 같은 것이 되어 전환할
 * 까닭이 사라진다(파일 상단 참조). 사진인지 문서인지는 KindBadge 가 알린다.
 *
 * 다만 **볼 수는 있어야 한다.** 그림을 늘어놓지 않는 것과 볼 길이 없는 것은
 * 다른 이야기인데, 예전 표에는 `내려받기` 밖에 없어서 사진 한 장을 확인하려면
 * 파일로 받아 여는 수밖에 없었다. 그래서 `미리보기` 열을 둔다 — 표는 여전히
 * 글자만 늘어놓고, 보고 싶을 때 한 번 누르는 길만 열어 둔다.
 *
 * 스크롤 껍데기(overflow-x-auto)와 테두리는 **여기서 두르지 않는다** —
 * ResponsiveList 가 소유한다. 여기서 한 겹 더 두르면 넘침이 그 안에서 흡수되어
 * 바깥은 영영 "들어간다"고 답하고, 표/미리보기 자동 판정이 망가진다
 * (responsive-list.tsx 의 '표 껍데기는 여기가 소유한다').
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
  attachments: ProductModelAttachmentListItem[];
  canManageFiles: boolean;
  /**
   * 볼 수 있는 파일(사진 또는 PDF)이 목록에 하나라도 있는가.
   *
   * 하나도 없으면 열 자체를 그리지 않는다 — 전부 빈 칸인 열은 표를 넓히기만
   * 하고, 그 폭이 ResponsiveList 의 "표가 지금 폭에 들어가는가" 판정을 밀어
   * 엑셀·zip 뿐인 모델에서 표가 미리보기로 튕기게 만든다. 그래서 이 값은 아래
   * measureKey 에도 함께 들어간다.
   */
  hasPreviewable: boolean;
  /**
   * 원본 수정일을 아는 파일이 목록에 하나라도 있는가(2026-09-30).
   *
   * 하나도 없으면 열 자체를 그리지 않는다 — 위 hasPreviewable 과 **같은 규칙이고
   * 같은 까닭**이다. 이 칸이 생기기 전에 올라온 파일은 전부 모르는 값이라, 조건 없이
   * 그리면 **예전 모델의 표가 전부 줄표만 늘어선 열 하나만큼 넓어진다.** 그 폭이
   * ResponsiveList 의 "표가 지금 폭에 들어가는가" 판정을 밀어, 여태 표로 보이던
   * 목록이 미리보기로 튕긴다. 그래서 이 값도 아래 measureKey 에 함께 들어간다.
   */
  hasOriginalModifiedAt: boolean;
  isBusy: boolean;
  onDelete: (item: ProductModelAttachmentListItem) => void;
  /**
   * 사진을 크게 여는 길. **격자에서 썸네일을 눌렀을 때와 같은 함수다**
   * (아래 openViewer 하나를 둘이 나눠 쓴다). 사진만 모은 목록도 시작 위치도
   * 그 안에서 한 번만 계산되므로, 격자와 표에서 좌우로 넘기는 순서가 갈릴 수
   * 없다.
   */
  onOpenImage: (item: ProductModelAttachmentListItem) => void;
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
          {/*
            「올린 날짜」 **바로 옆**이다(사용자 요청 2026-09-30). 두 날짜가 붙어
            있어야 "우리에게 들어온 때"와 "그 파일이 만들어진 때"를 한눈에 견준다.
            이름을 「수정일」로 줄이지 않는 것은, 무엇이 수정됐는지가 흐려지기
            때문이다 — 우리 시스템에서 고친 때로 읽히면 정반대의 뜻이 된다.
          */}
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
              // 옆 칸(올린 날짜)과 같은 꾸밈이다 — 나란히 놓고 견주는 두 값이라
              // 자릿수(tabular-nums)도 줄바꿈 금지도 같아야 눈이 바로 비교한다.
              <td className="whitespace-nowrap px-3 py-2 tabular-nums text-zinc-700 dark:text-zinc-300">
                {item.originalModifiedAt
                  ? formatTimestamp(item.originalModifiedAt)
                  : UNKNOWN_ORIGINAL_MODIFIED_AT}
              </td>
            )}
            {hasPreviewable && (
              // 단추가 셋(미리보기·내려받기·지우기)까지 늘어난 줄이다. 좁은
              // 화면에서 글자가 반으로 접히지 않게 칸마다 nowrap 을 둔다.
              <td className="whitespace-nowrap px-3 py-2">
                {isViewableImage(item.mimeType) ? (
                  // 사진은 격자에서 썸네일을 누른 것과 **똑같이** 화면 위 뷰어로
                  // 연다 — 새 탭이 아니다. 표에는 썸네일이 없어(그것이 두 보기를
                  // 가르는 선이다) 이 단추가 그 자리를 대신한다.
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
                    // 새 탭에서 연다(iframe 은 전역 헤더가 막는다).
                    // rel 은 새 탭이 window.opener 로 이 창을 건드리지 못하게 한다.
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
  /** 🔴 영구 삭제 대기(2026-10-07) — 되살리기와 다른 상태다. 휴지통 줄에서만 세워진다. */
  const [pendingPurge, setPendingPurge] = useState<TrashedProductModelAttachmentListItem | null>(null);
  const [isMutating, setIsMutating] = useState(false);

  /** 크게 보고 있는 사진의 자리. 사진만 모은 목록(viewable) 기준이다. */
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);

  const allowedExtensions = useMemo(() => allowedExtensionsFor(category), [category]);
  /**
   * 형식을 가리지 않는 분류에서는 **undefined** 다 — 빈 문자열이 아니다. 빈
   * 문자열을 넣으면 브라우저가 "받는 형식이 없다"로 읽어 고르는 창이 아무것도
   * 내놓지 않는 날이 있다. 속성을 아예 달지 않아야 모든 파일이 보인다.
   */
  const acceptAttribute = useMemo(
    () => allowedExtensions?.map((extension) => `.${extension}`).join(","),
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

  /** 표에 `미리보기` 열을 그릴지 — 볼 수 있는 파일이 하나라도 있을 때만이다(FilesTable 주석). */
  const hasPreviewable = useMemo(
    () => attachments.some((item) => isPreviewable(item.mimeType)),
    [attachments]
  );

  /**
   * 표에 `원본 수정일` 열을 그릴지 — 아는 파일이 하나라도 있을 때만이다. 위
   * hasPreviewable 과 같은 규칙이고, 까닭은 FilesTable 의 같은 이름 인자 주석에 있다.
   */
  const hasOriginalModifiedAt = useMemo(
    () => attachments.some((item) => item.originalModifiedAt !== null),
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
      // 이 PC 에서 그 파일을 마지막으로 저장한 시각도 함께 싣는다(2026-09-30).
      // 브라우저만 아는 값이라 여기서 보내지 않으면 서버가 알 길이 아예 없다.
      //
      // 🔴 **실을 수 없는 값이면 아예 보내지 않는다.** 시계가 틀린 PC 가 주는 값을
      // 거르는 판정은 서버와 **같은 함수** 하나다
      // (domain/attachment-original-modified-at.ts) — 여기서 따로 판단하면 "보냈는데
      // 서버가 버리는" 어긋남이 생기고 그때는 아무 오류도 나지 않는다. 그리고 보내든
      // 말든 **업로드는 그대로 간다**: 이 값은 실패의 근거가 아니다.
      const modifiedAt = originalModifiedAtParamValue(file.lastModified);
      if (modifiedAt !== null) query.set(ORIGINAL_MODIFIED_AT_PARAM, modifiedAt);
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

  /**
   * 폴더에서 끌어다 놓은 파일. **고르기 칸에 그대로 담는다**(putFilesInPicker) —
   * 떨구기용 목록을 따로 두면 [올리기]가 보는 곳이 둘이 되고, 그때부터 두 길이
   * 갈린다. 담고 나면 화면에도 고른 것과 똑같이 보이고, 같은 handleUpload 를 탄다.
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

    // 다 올라갔으면 팝업으로 알린다(모델 안에 딸린 것이라 그 자리에 머문다).
    // 몇 건이 빠졌으면 무엇이 빠졌는지 읽고 다시 올려야 하므로 지금처럼 화면에 남긴다.
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

  /** 🔴 되돌릴 수 없다 — 디스크 파일까지 지운다(2026-10-07). */
  async function handlePurgeConfirm() {
    const target = pendingPurge;
    if (!target) return;
    setIsMutating(true);
    setStatusMessage(null);
    try {
      const result = await purgeAttachmentAction({ attachmentId: target.id, productModelId });
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
        <FileDropZone
          name="product-model-files-upload"
          multiple
          disabled={isBusy}
          hint="여기에 파일을 놓으세요 — 놓은 뒤 [올리기]"
          onFiles={receiveDroppedFiles}
          className="mt-3"
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
                  {PRODUCT_MODEL_UPLOAD_CATEGORIES.map((code) => (
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
                      {/*
                        원본 수정일 — 올린 날짜 **바로 다음 줄**이다(2026-09-30).
                        표와 달리 여기에는 열 제목이 없으므로 이름을 값 앞에 적고,
                        같은 줄에 잇지 않는다: 이 칸은 넓어야 4열 격자의 1/4 폭이라
                        한 줄에 두 날짜를 넣으면 글자가 접혀 어느 쪽 날짜인지 못 읽는다.
                        🔴 모르는 파일에는 **줄 자체를 그리지 않는다** — 표에는 열
                        머리글이 있어 줄표가 "모른다"로 읽히지만, 여기서는 「원본
                        수정일 —」 이 모든 칸에 붙는 군더더기가 된다. 이 칸이 생기기
                        전에 올라온 파일의 미리보기는 예전과 한 글자도 같다.
                      */}
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
                        {/*
                          `미리보기` 는 `내려받기` 를 **대신하지 않는다.** 회로도를
                          훑어보는 것과 손에 들고 나가는 것은 다른 일이라 둘 다 둔다.
                        */}
                        <div className="flex min-w-0 items-center gap-2">
                          {isViewablePdf(item.mimeType) && (
                            <a
                              href={inlineViewUrlOf(item.id)}
                              // 새 탭에서 연다(iframe 은 전역 헤더가 막는다).
                              // rel 은 새 탭이 window.opener 로 이 창을 건드리지 못하게 한다.
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
  );
}
