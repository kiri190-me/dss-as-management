import {
  MAX_ATTACHMENT_PREVIEW_BYTES,
  isContentCompatibleWithExtension,
  isExtensionMimeCompatible,
  normalizeFileExtension,
} from "@/lib/domain/attachment-allowlist";
import {
  isIdentityOrientation,
  parseOrientation,
  type ImageOrientation,
} from "@/lib/domain/image-orientation";

/**
 * ============================================================================
 * 돌린 사진을 받아도 되는가 — 라우트에서 뽑아낸 판정
 * ============================================================================
 * 이 판정을 route.ts 안에 두지 않는 까닭은 download/inline-view.ts 와 같다:
 * **Next.js 는 route.ts 에서 정해진 이름 말고 다른 것을 export 하는 것을
 * 금지한다.** 시험이 부를 수 있게 export 해 두었다가 `next build` 가 여덟 커밋
 * 동안 타입 검사에서 실패한 전력이 있어서, 판정만 **같은 폴더의 형제 파일로**
 * 옮긴다. lib/ 로 보내지 않는 것은 이 규칙들이 그 라우트의 이야기여서다.
 *
 * ── 🔴 원본을 덮어쓴다. 그래서 판정이 전부 앞에 선다 ─────────────────────
 * 이 통로는 되돌릴 수 없는 일을 한다(사용자 결정 2026-09-29). 그러므로
 * **바이트를 놓기 전에** 걸러낼 수 있는 것은 전부 여기서 걸러낸다:
 *
 *   checkRotationTarget   본문을 받기 **전에**. 이 첨부가 애초에 돌릴 수 있는
 *                         것인가 — 사진인가, 저장 경로의 확장자와 mime 이 맞는가.
 *   checkRotationPayload  두 덩어리를 다 받은 **뒤에**. 받은 것이 정말 그 형식인가.
 *
 * ── 🔴 확장자가 아니라 앞머리 바이트로 판정한다 ──────────────────────────
 * 이름도 Content-Type 도 보내는 쪽이 정하는 값이라 아무 증거가 아니다. 올리기
 * 통로가 쓰는 검사(isContentCompatibleWithExtension)를 **그대로** 쓴다 — 새 검사를
 * 만들지 않는다. 새로 만들면 올리기에서 막히는 것이 여기서는 통과하는 날이 온다.
 *
 * ── 형식은 바뀌지 않는다 ────────────────────────────────────────────────
 * PNG 원본이면 돌린 것도 PNG 로 받는다. JPEG 로 바꿔 받으면 디스크의 파일 이름
 * (`….png`)·DB 의 mime_type 과 내용이 어긋나고, 내려받기가 그 mime 으로 내보낸다.
 * 썸네일만은 언제나 JPEG 다 — 미리보기 경로가 `.preview.jpg` 로 고정이고
 * (attachment-path.ts), 붙이기 통로와 같은 규칙이다.
 * ============================================================================
 */

/** 돌려서 저장할 수 있는 형식. 크게 보기가 `<img>` 로 그리는 것과 같은 목록이다. */
export const ROTATION_SUPPORTED_MIME_TYPES: readonly string[] = ["image/jpeg", "image/png"];

/** 썸네일은 언제나 JPEG 다(attachment-path.ts 의 `.preview.jpg`). */
const PREVIEW_EXTENSION = "jpg";

export type RotationFailureCode =
  | "INVALID_ORIENTATION"
  | "NO_CHANGE"
  | "INVALID_PREVIEW_SIZE"
  | "PREVIEW_TOO_LARGE"
  | "NOT_AN_IMAGE"
  | "UNSUPPORTED_FILE"
  | "EMPTY_BODY"
  | "PAYLOAD_TRUNCATED"
  | "PREVIEW_CONTENT_MISMATCH"
  | "CONTENT_MISMATCH";

export type RotationRejection = {
  status: number;
  code: RotationFailureCode;
  /** 사용자에게 그대로 보여 줄 수 있는 문장. 저장 경로는 담지 않는다. */
  message: string;
};

function reject(status: number, code: RotationFailureCode, message: string): RotationRejection {
  return { status, code, message };
}

/** 저장 경로의 확장자. `repair-cases/…/{id}.jpg` 의 마지막 마디에서 읽는다. */
export function storedExtensionOf(storedPath: string): string | null {
  const segments = storedPath.split("/");
  return normalizeFileExtension(segments[segments.length - 1] ?? "");
}

// ───────────────────────────────────────── 본문을 받기 **전에** 보는 것

export type RotationRequest = {
  orientation: ImageOrientation;
  /** 본문 앞쪽 몇 바이트가 썸네일인가. 나머지가 돌린 원본이다. */
  previewBytes: number;
};

/**
 * 주소의 인자를 읽는다. 알아들을 수 없는 값은 짐작하지 않는다 — 되돌릴 수 없는
 * 일을 시키는 인자이므로 닫히는 쪽으로 실패한다.
 */
export function parseRotationRequest(
  searchParams: URLSearchParams
): { ok: true; request: RotationRequest } | { ok: false; rejection: RotationRejection } {
  const orientation = parseOrientation({
    rotate: searchParams.get("rotate"),
    flipX: searchParams.get("flipX"),
    flipY: searchParams.get("flipY"),
  });
  if (!orientation) {
    return {
      ok: false,
      rejection: reject(400, "INVALID_ORIENTATION", "돌린 방향을 알아볼 수 없습니다."),
    };
  }
  // 🔴 그대로인 것을 저장하지 않는다. 화면도 그때는 단추를 내밀지 않지만,
  // 여기서 막지 않으면 원본을 아무 뜻 없이 다시 인코딩해 화질만 잃는다.
  if (isIdentityOrientation(orientation)) {
    return { ok: false, rejection: reject(400, "NO_CHANGE", "돌리거나 뒤집은 것이 없습니다.") };
  }

  const raw = searchParams.get("previewBytes") ?? "";
  const previewBytes = /^[0-9]+$/.test(raw) ? Number(raw) : Number.NaN;
  if (!Number.isSafeInteger(previewBytes) || previewBytes <= 0) {
    return {
      ok: false,
      rejection: reject(400, "INVALID_PREVIEW_SIZE", "미리보기 크기를 알아볼 수 없습니다."),
    };
  }
  if (previewBytes > MAX_ATTACHMENT_PREVIEW_BYTES) {
    return { ok: false, rejection: reject(413, "PREVIEW_TOO_LARGE", "미리보기가 너무 큽니다.") };
  }

  return { ok: true, request: { orientation, previewBytes } };
}

/**
 * 이 첨부를 애초에 돌릴 수 있는가. **한 바이트도 받기 전에** 답이 난다.
 * 통과하면 저장 경로의 확장자를 함께 돌려준다 — 뒤의 앞머리 대조가 그것을 쓴다.
 */
export function checkRotationTarget(attachment: {
  mimeType: string;
  storedPath: string;
}): { ok: true; extension: string } | { ok: false; rejection: RotationRejection } {
  if (!ROTATION_SUPPORTED_MIME_TYPES.includes(attachment.mimeType)) {
    return {
      ok: false,
      rejection: reject(400, "NOT_AN_IMAGE", "사진이 아닌 파일은 돌려서 저장할 수 없습니다."),
    };
  }

  const extension = storedExtensionOf(attachment.storedPath);
  // 행의 확장자와 mime 이 어긋나는 것은 정상 경로로 생기지 않는다(올리기가 확장자
  // 에서 mime 을 고른다). 그런 행을 덮어쓰면 무엇이 저장되는지 아무도 답할 수
  // 없으므로 여기서 멈춘다 — 저장 경로는 응답에 싣지 않는다.
  if (!extension || !isExtensionMimeCompatible(extension, attachment.mimeType)) {
    return {
      ok: false,
      rejection: reject(409, "UNSUPPORTED_FILE", "이 파일은 돌려서 저장할 수 없습니다."),
    };
  }

  return { ok: true, extension };
}

// ───────────────────────────────────────── 두 덩어리를 받은 **뒤에** 보는 것

export type ReceivedPart = {
  /** 실제로 받은 바이트 수. 보낸 쪽이 말한 값이 아니다. */
  size: number;
  /** 앞머리 바이트. 저장소가 흘려보내며 붙들어 둔 것. */
  header: Uint8Array;
};

/**
 * 받은 두 덩어리가 저장해도 되는 것인가. `null` 이면 통과다.
 *
 * 🔴 **썸네일이 잘렸는지를 크기로 가른다.** 본문이 선언한 previewBytes 보다
 * 짧으면 앞 덩어리가 그만큼만 채워지고 뒤 덩어리는 빈다 — 그러면 원본 자리에
 * 썸네일 뒷부분이 들어가는 일이 생길 수 있다. 센 바이트가 선언과 다르면 거절한다.
 */
export function checkRotationPayload(params: {
  /** checkRotationTarget 이 돌려준 값. */
  extension: string;
  declaredPreviewBytes: number;
  preview: ReceivedPart;
  original: ReceivedPart;
}): RotationRejection | null {
  if (params.preview.size === 0 || params.original.size === 0) {
    return reject(400, "EMPTY_BODY", "저장할 내용이 비어 있습니다.");
  }
  if (params.preview.size !== params.declaredPreviewBytes) {
    return reject(400, "PAYLOAD_TRUNCATED", "보낸 내용이 도중에 끊겼습니다. 다시 시도해 주세요.");
  }
  if (!isContentCompatibleWithExtension(PREVIEW_EXTENSION, params.preview.header)) {
    return reject(415, "PREVIEW_CONTENT_MISMATCH", "미리보기가 사진이 아닙니다.");
  }
  if (!isContentCompatibleWithExtension(params.extension, params.original.header)) {
    return reject(
      415,
      "CONTENT_MISMATCH",
      `저장하려는 내용이 원본의 형식(.${params.extension})과 맞지 않습니다.`
    );
  }
  return null;
}
