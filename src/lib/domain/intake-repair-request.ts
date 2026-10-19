import {
  CONTENT_SNIFF_BYTES,
  MAX_ATTACHMENT_SIZE_BYTES,
  canonicalMimeTypeForExtension,
  isAllowedExtension,
  isExtensionAllowedForCategory,
  isUploadContentCompatible,
  normalizeFileExtension,
} from "./attachment-allowlist";
import type { AttachmentCategory } from "./attachment-category";

/**
 * ============================================================================
 * 접수와 함께 올라온 **수리 의뢰서** — 받아도 되는 파일인가 (2026-10-19)
 * ============================================================================
 * A/S 접수 화면에서 **선택으로** 붙이는 파일 한 장이다. 붙이면 접수 알림 메일에
 * **진짜 첨부**로 나가고 그 건의 **연락서 폴더에 저장된다.**
 *
 * 🔴 **서버 디스크에는 한 바이트도 남지 않는다** — 첨부 표(`attachments`)에 행을
 * 만들지 않고 시스템 창고(UPLOADS_DIR)에도 쓰지 않는다. 그래서 이 파일에는
 * 「올린 파일」의 생애(미리보기 · 휴지통 · 내려받기)가 아예 없다.
 *
 * ── 🔴 잣대를 새로 짓지 않는다 ───────────────────────────────────────────
 * 크기 상한 · 확장자 허용목록 · **앞머리 바이트 대조**는 사람이 [파일 관리]에서
 * 올릴 때와 **같은 함수**를 쓴다(domain/attachment-allowlist.ts). 한 벌을 더 지으면
 * 두 길이 받는 파일이 갈라지고, 느슨한 쪽이 곧 구멍이 된다.
 *
 * ── 🔴 브라우저가 보낸 MIME 을 믿지 않는다 ───────────────────────────────
 * 아예 **보지 않는다.** 메일 첨부의 Content-Type 과 연락서 폴더에 적히는 형식은
 * 둘 다 **확장자에서 서버가 고른 정본**이다(canonicalMimeTypeForExtension).
 * 그 값을 클라이언트가 정하게 두면 받는 사람 메일 프로그램이 공격자가 고른
 * 형식으로 파일을 연다.
 *
 * ── 분류는 「수리 의뢰서」의 **이름표를 얻기 위한** 것이다 ───────────────
 * `REPAIR_REQUEST` 는 2026-10-18 에 들어온 첨부 분류이고, 연락서 폴더 안에서
 * **그 한글 이름표로 된 하위 폴더**(`수리 의뢰서/`)를 고르는 데 쓴다. 🔴 **첨부
 * 표에 그 분류로 행을 만든다는 뜻이 아니다** — 사람이 [파일 관리]에서 직접 올릴
 * 때와 이 길은 별개다. 폴더 이름을 글자로 박지 않는 까닭도 그것이다(이름표가
 * 바뀌는 날 폴더가 둘로 갈린다).
 *
 * 이 분류는 `CATEGORY_EXTENSION_ALLOWLIST` 에 없으므로 **전체 허용목록 14종**이
 * 그대로 걸리고(`isExtensionAllowedForCategory`), 형식을 안 가리는 분류 셋에도
 * 들어 있지 않으므로 **앞머리 대조가 면제되지 않는다.**
 *
 * ── 순수 파일이다 ────────────────────────────────────────────────────────
 * server-only / node:fs / drizzle / React 를 부르지 않는다. 실제 파일 없이 단위
 * 시험으로 전부 검증된다.
 * ============================================================================
 */

/**
 * 🔴 연락서 폴더 안에서 이 파일이 들어갈 **하위 폴더의 이름표**를 정하는 분류.
 * 폴더 이름(`수리 의뢰서`)은 여기서 글자로 적지 않는다 — 이름표 한 자리
 * (domain/attachment-category.ts)에서만 나온다.
 */
export const INTAKE_REPAIR_REQUEST_CATEGORY: AttachmentCategory = "REPAIR_REQUEST";

/** 원본 파일 이름의 글자 수 상한. 올리기 통로와 같은 값이다. */
export const INTAKE_REPAIR_REQUEST_MAX_FILE_NAME_LENGTH = 255;

export type IntakeRepairRequestCheck =
  | {
      ok: true;
      /** 다듬은 원본 이름 — 연락서 폴더에 사람이 읽는 이름으로 꽂힌다. */
      fileName: string;
      /** 🔴 확장자에서 **서버가 고른** 정본. 브라우저가 보낸 값이 아니다. */
      mimeType: string;
      extension: string;
    }
  | { ok: false; message: string };

/** 사람이 읽는 상한(`20MB`). 메시지에 쓰려고 한 자리에서 만든다. */
const SIZE_LIMIT_LABEL = `${Math.round(MAX_ATTACHMENT_SIZE_BYTES / (1024 * 1024))}MB`;

/**
 * 이 바이트를 수리 의뢰서로 받아도 되는가. **던지지 않는다.**
 *
 * 🔴 거절 문구에 경로 · 루트 · 저장소 구조가 들어가지 않는다 — 이 결과는 그대로
 * 접수 화면에 뜬다.
 */
export function checkIntakeRepairRequestFile(input: {
  /** 브라우저가 알려 준 원본 이름. */
  fileName: string;
  /** 🔴 **실물 바이트**다 — 브라우저가 알려 준 크기가 아니라 이것으로 잰다. */
  bytes: Uint8Array;
}): IntakeRepairRequestCheck {
  const fileName = typeof input.fileName === "string" ? input.fileName.trim() : "";
  if (fileName.length === 0 || fileName.length > INTAKE_REPAIR_REQUEST_MAX_FILE_NAME_LENGTH) {
    return { ok: false, message: "수리 의뢰서의 파일 이름이 비어 있거나 너무 깁니다." };
  }

  if (input.bytes.byteLength === 0) {
    return { ok: false, message: "빈 파일은 수리 의뢰서로 붙일 수 없습니다." };
  }
  if (input.bytes.byteLength > MAX_ATTACHMENT_SIZE_BYTES) {
    return { ok: false, message: `수리 의뢰서는 ${SIZE_LIMIT_LABEL} 이하만 붙일 수 있습니다.` };
  }

  const extension = normalizeFileExtension(fileName);
  // 🔴 전체 허용목록(14종) 관문. 이 분류는 형식을 가리지 않는 셋에 들어 있지
  //    않으므로 이 관문을 **그대로 지난다.**
  if (!extension || !isAllowedExtension(extension)) {
    return { ok: false, message: "수리 의뢰서로 붙일 수 없는 파일 형식입니다." };
  }
  // 분류별 제한 목록도 한 번 더 본다 — 이 분류에 제한이 붙는 날 여기서 걸린다.
  if (!isExtensionAllowedForCategory(extension, INTAKE_REPAIR_REQUEST_CATEGORY)) {
    return { ok: false, message: "수리 의뢰서로 붙일 수 없는 파일 형식입니다." };
  }

  // 🔴 앞머리 바이트 대조 — 이름만 바꾼 파일을 되돌려 보낸다. 올리기 통로가
  //    부르는 것과 **같은 함수 · 같은 길이**다.
  const header = input.bytes.subarray(0, CONTENT_SNIFF_BYTES);
  if (!isUploadContentCompatible(extension, INTAKE_REPAIR_REQUEST_CATEGORY, header)) {
    return {
      ok: false,
      message: `파일 내용이 확장자(.${extension})와 맞지 않습니다. 이름만 바꾼 파일은 붙일 수 없습니다.`,
    };
  }

  // 허용목록을 지났으므로 정본 MIME 이 반드시 있다. 없더라도 지어내지 않고
  // 일반 바이트 형식으로 둔다(올리기 통로와 같은 처리).
  return {
    ok: true,
    fileName,
    mimeType: canonicalMimeTypeForExtension(extension) ?? "application/octet-stream",
    extension,
  };
}
