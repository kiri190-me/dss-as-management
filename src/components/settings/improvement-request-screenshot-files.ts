import {
  MAX_ATTACHMENT_SIZE_BYTES,
  isExtensionAllowedForCategory,
  normalizeFileExtension,
} from "@/lib/domain/attachment-allowlist";
import { IMPROVEMENT_REQUEST_ATTACHMENT_CATEGORY } from "@/lib/domain/attachment-category";
import {
  IMPROVEMENT_REQUEST_SCREENSHOT_LIMIT_MESSAGE,
  IMPROVEMENT_REQUEST_SCREENSHOT_MAX_COUNT,
} from "@/lib/domain/improvement-request";

/**
 * ============================================================================
 * 개선 요청 스크린샷 — 화면이 파일을 고르고 이름 짓고 미리 거르는 순수 도우미
 * ============================================================================
 * DOM 도 fetch 도 만지지 않는다 — 시험이 브라우저 없이 전부 돌린다. 올리기 자체는
 * ImprovementRequestScreenshots.tsx 의 uploadImprovementRequestScreenshots 가 한다.
 *
 * 🔴 **여기의 판정은 편의일 뿐이다.** 형식 · 크기 · 5장은 올리기 통로
 * (api/improvement-requests/[id]/attachments/route.ts)가 다시 본다 — 20MB 를 다
 * 보내고 거절당하기 전에 알려 주려는 것이다. 판정의 재료도 그 통로와 같은 것을
 * 부른다(허용목록 · SCREENSHOT 분류 · 20MB · 도메인의 5장). 여기에 수를 따로 적으면
 * 화면은 받는데 서버가 거절하는(또는 그 반대의) 날이 온다.
 *
 * 🔴 파일 이름은 사람이 붙인 것이라 개인정보가 섞일 수 있다(schema/attachments.ts).
 * 화면에 보이는 것 말고는 어디로도 내보내지 않는다 — console 에도 싣지 않는다.
 * ============================================================================
 */

/** 파일 고르기 칸의 accept — 서버가 받는 셋(png · jpg · jpeg)의 MIME 이다. */
export const SCREENSHOT_FILE_ACCEPT = "image/png,image/jpeg";

/** 형식이 틀렸을 때 보이는 까닭 — 서버의 415 문구와 같은 말이다. */
const FORMAT_REJECTION = "png · jpg · jpeg 만 올릴 수 있습니다";

// ────────────────────────────────────────────────── 붙여넣기에서 이미지 고르기

/** 클립보드 항목에서 쓰는 것만 — DataTransferItem 이 그대로 맞고, 시험은 흉내 낸 객체를 넘긴다. */
export type ClipboardItemLike = {
  kind: string;
  type: string;
  getAsFile(): File | null;
};

export type ScreenshotPastePlan = {
  /** 붙여넣은 이미지 파일들 — 이름은 아직 브라우저가 붙인 그대로다(nameScreenshotFile 로 짓는다). */
  images: File[];
  /**
   * 글자도 함께 왔는가. 왔으면 브라우저의 글자 붙여넣기를 그대로 두고 이미지만 더한다.
   * 안 왔으면 부르는 쪽이 기본 동작을 막는다(preventDefault).
   */
  hasText: boolean;
};

/**
 * 붙여넣기(`clipboardData.items`)에서 이미지 파일과 「글자가 함께 왔는가」를 고른다.
 *
 * 이미지는 png · jpeg 만이 아니라 **image/* 전부**를 고른다 — gif · webp 를 붙여넣었을
 * 때 조용히 무시하면 사람은 붙었는지 모른다. 고른 뒤 checkScreenshotFile 이 형식
 * 까닭으로 거절해 알린다.
 *
 * 🔴 getAsFile 은 붙여넣기 이벤트 **안에서 곧바로** 불러야 한다 — 이벤트가 끝나면
 * 클립보드 항목이 비워지는 브라우저가 있다. 그래서 이 함수는 동기다.
 */
export function pickPastedScreenshots(items: ArrayLike<ClipboardItemLike>): ScreenshotPastePlan {
  const images: File[] = [];
  let hasText = false;
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (!item) continue;
    if (item.kind === "string" && item.type === "text/plain") {
      hasText = true;
      continue;
    }
    if (item.kind === "file" && item.type.startsWith("image/")) {
      const file = item.getAsFile();
      if (file) images.push(file);
    }
  }
  return { images, hasText };
}

// ────────────────────────────────────────────────── 이름 짓기

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/** `YYYYMMDD-HHmmss`(KST). 한국은 서머타임이 없어 +9 시간을 더해 UTC 로 읽으면 된다. */
export function kstFileStamp(now: Date): string {
  const kst = new Date(now.getTime() + KST_OFFSET_MS);
  return (
    `${kst.getUTCFullYear()}${pad2(kst.getUTCMonth() + 1)}${pad2(kst.getUTCDate())}` +
    `-${pad2(kst.getUTCHours())}${pad2(kst.getUTCMinutes())}${pad2(kst.getUTCSeconds())}`
  );
}

/**
 * 이미지 MIME → 확장자. png → `png`, jpeg → `jpg`(서버가 둘 다 받는다). 그 밖의
 * 이미지는 MIME 의 뒤쪽을 그대로 쓴다(`image/gif` → `gif`) — 사전 검사가 형식 까닭으로
 * 거절하도록 이름에 무엇이었는지를 남긴다.
 */
export function screenshotExtensionForMime(mimeType: string): string {
  const type = mimeType.trim().toLowerCase();
  if (type === "image/png") return "png";
  if (type === "image/jpeg" || type === "image/jpg" || type === "image/pjpeg") return "jpg";
  const subtype = type.startsWith("image/") ? type.slice("image/".length).replace(/[^a-z0-9]/g, "") : "";
  return subtype.length > 0 ? subtype.slice(0, 16) : "img";
}

/**
 * 브라우저가 붙인 자리표시 이름인가 — 비었거나 `image.png` 꼴. 화면 캡처를 붙여넣으면
 * 브라우저는 이런 이름을 준다. 탐색기에서 파일을 복사해 붙여넣은 경우처럼 **사람이
 * 붙인 이름**이면 거짓이다 — 그 이름은 그대로 둔다.
 */
export function isPlaceholderPastedName(name: string): boolean {
  const trimmed = name.trim();
  return trimmed.length === 0 || /^image\.[a-z0-9]+$/i.test(trimmed);
}

/** 붙여넣은 이미지의 새 이름 — `스크린샷-YYYYMMDD-HHmmss-N.확장자`(KST, N 은 1부터). */
export function pastedScreenshotName(mimeType: string, now: Date, sequence: number): string {
  return `스크린샷-${kstFileStamp(now)}-${sequence}.${screenshotExtensionForMime(mimeType)}`;
}

/**
 * 붙여넣은 이미지 한 장에 이름을 붙인다. 자리표시 이름이면 새로 짓고(확장자는 MIME
 * 으로), 사람이 붙인 이름이면 그 파일을 그대로 돌려준다. 바이트는 건드리지 않는다.
 */
export function nameScreenshotFile(file: File, now: Date, sequence: number): File {
  if (!isPlaceholderPastedName(file.name)) return file;
  return new File([file], pastedScreenshotName(file.type, now, sequence), {
    type: file.type,
    lastModified: file.lastModified,
  });
}

// ────────────────────────────────────────────────── 한 장 사전 검사

function formatMegabytes(bytes: number): string {
  const megabytes = bytes / (1024 * 1024);
  return `${Number.isInteger(megabytes) ? megabytes : megabytes.toFixed(1)}MB`;
}

/**
 * 한 장을 보내기 전에 거른다. 틀리면 사람이 읽을 까닭, 맞으면 null.
 *
 * 순서와 모양은 파일 화면(FilesScreen.tsx 의 rejectionReasonFor)과 같다 — 형식 →
 * 빈 파일 → 크기. 형식은 **이름의 확장자**로 본다(서버도 그렇게 본다). 여러 장은
 * 한 장씩 따로 판정한다 — 한 장이 틀렸다고 나머지까지 거절하지 않는다.
 */
export function checkScreenshotFile(file: { name: string; size: number }): string | null {
  const extension = normalizeFileExtension(file.name);
  if (!extension || !isExtensionAllowedForCategory(extension, IMPROVEMENT_REQUEST_ATTACHMENT_CATEGORY)) {
    return FORMAT_REJECTION;
  }
  if (file.size === 0) return "빈 파일";
  if (file.size > MAX_ATTACHMENT_SIZE_BYTES) {
    return `${formatMegabytes(MAX_ATTACHMENT_SIZE_BYTES)} 초과 (${formatMegabytes(file.size)})`;
  }
  return null;
}

// ────────────────────────────────────────────────── 남은 자리 · 한 묶음 거르기

/** 앞으로 몇 장을 더 붙일 수 있는가. `liveCount` 는 이미 붙은(또는 등록 전에 모아 둔) 수. */
export function screenshotRoomLeft(liveCount: number): number {
  return Math.max(0, IMPROVEMENT_REQUEST_SCREENSHOT_MAX_COUNT - liveCount);
}

export type ScreenshotRejection = { fileName: string; reason: string };

export type ScreenshotBatch<T> = {
  /** 받은 것 — 고른 차례 그대로. */
  accepted: T[];
  /** 사전 검사에 걸린 것, 까닭과 함께. */
  rejected: ScreenshotRejection[];
  /** 검사는 통과했지만 5장을 넘어 받지 못한 장 수. */
  overflowCount: number;
};

/**
 * 고르거나 붙여넣은 한 묶음을 거른다 — 한 장씩 사전 검사하고, 통과한 것 가운데
 * 남은 자리만큼만 앞에서부터 받는다. 검사에 걸린 장은 자리를 차지하지 않는다.
 */
export function screenScreenshotBatch<T extends { name: string; size: number }>(
  files: readonly T[],
  liveCount: number
): ScreenshotBatch<T> {
  const valid: T[] = [];
  const rejected: ScreenshotRejection[] = [];
  for (const file of files) {
    const reason = checkScreenshotFile(file);
    if (reason === null) valid.push(file);
    else rejected.push({ fileName: file.name, reason });
  }
  const room = screenshotRoomLeft(liveCount);
  return { accepted: valid.slice(0, room), rejected, overflowCount: Math.max(0, valid.length - room) };
}

/**
 * `이름: 까닭 · 이름: 까닭`. 서버 문구는 마침표로 끝나므로 끝의 마침표를 떼어 잇는다 —
 * 그대로 두면 문장 안에서 「넘습니다. · …」, 끝에서 「넘습니다..」가 된다.
 */
export function formatScreenshotRejections(rejections: readonly ScreenshotRejection[]): string {
  return rejections
    .map((rejection) => `${rejection.fileName}: ${rejection.reason.trim().replace(/\.+$/, "")}`)
    .join(" · ");
}

/** 한 묶음에서 받지 못한 것을 한 문장으로. 다 받았으면 null. */
export function screenshotBatchNotice(batch: { rejected: readonly ScreenshotRejection[]; overflowCount: number }): string | null {
  const parts: string[] = [];
  if (batch.rejected.length > 0) {
    parts.push(`받지 않은 파일 — ${formatScreenshotRejections(batch.rejected)}`);
  }
  if (batch.overflowCount > 0) {
    parts.push(`${IMPROVEMENT_REQUEST_SCREENSHOT_LIMIT_MESSAGE} ${batch.overflowCount}장은 넣지 못했습니다.`);
  }
  return parts.length > 0 ? parts.join(" ") : null;
}

// ────────────────────────────────────────────────── 올리는 동안 · 올린 뒤의 문구

/** 「스크린샷 올리는 중 2/3…」 — `current` 는 지금 보내는 장의 차례(1부터). */
export function screenshotUploadProgressText(current: number, total: number): string {
  return `스크린샷 올리는 중 ${current}/${total}…`;
}

/**
 * 새 글은 등록됐는데 스크린샷 일부를 못 올렸을 때 남기는 문구. 글은 이미 목록에
 * 있으므로 입력칸은 비우고, 무엇을 왜 못 올렸는지와 다시 붙이는 길을 알린다.
 */
export function createdWithScreenshotFailuresText(
  total: number,
  failures: readonly ScreenshotRejection[]
): string {
  return (
    `글은 등록됐습니다. 스크린샷 ${total}장 중 ${failures.length}장을 올리지 못했습니다 — ` +
    `${formatScreenshotRejections(failures)}. 목록의 [스크린샷 추가]로 다시 붙일 수 있습니다.`
  );
}

/** 글 지우기 확인창에 더하는 한 줄. 스크린샷이 없으면 null. */
export function deleteRequestScreenshotNotice(count: number): string | null {
  return count > 0 ? `붙은 스크린샷 ${count}장은 첨부 휴지통으로 옮겨집니다.` : null;
}

// ────────────────────────────────────────────────── 주소

/** 목록의 썸네일 — 썸네일이 없으면 내려받기 통로가 원본을 준다. */
export function screenshotThumbUrl(attachmentId: string): string {
  return `/api/attachments/${encodeURIComponent(attachmentId)}/download?view=thumb`;
}

/** 크게 보기 — 원본을 화면 안에 보인다. */
export function screenshotFullUrl(attachmentId: string): string {
  return `/api/attachments/${encodeURIComponent(attachmentId)}/download?view=full`;
}

/** 올리기 통로. 본문은 파일 바이트 그대로이고 이름은 쿼리 문자열이다(multipart 아님). */
export function screenshotUploadUrl(improvementRequestId: string, fileName: string): string {
  const query = new URLSearchParams({ fileName });
  return `/api/improvement-requests/${encodeURIComponent(improvementRequestId)}/attachments?${query.toString()}`;
}
