import path from "node:path";

import { isAllowedExtension, normalizeFileExtension } from "./attachment-allowlist";

/**
 * ============================================================================
 * 첨부 파일의 자리 — DB에 적는 상대 경로를 만드는 단 하나의 지점
 * ============================================================================
 *
 *   저장 루트 (UPLOADS_DIR)  →  C:\DSS-AS-DATA\uploads      ← 설정값, DB에 안 들어감
 *   DB stored_path           →  repair-cases/{접수건id}/{첨부id}.{확장자}
 *                            →  product-models/{모델id}/{첨부id}.{확장자}
 *
 * ── 첫 마디가 주인을 말한다 ──────────────────────────────────────────────
 * 첨부의 주인은 접수 건 아니면 제품 모델이고(schema/attachments.ts의
 * attachments_owner_not_both 참조), stored_path의 **첫 마디가 그 둘을 가른다.**
 * 그래서 폴더 하나만 보면 그것이 어느 쪽의 파일인지 알 수 있고, 백업이 DB 없이
 * 디스크만 훑어도 구조가 읽힌다. 두 접두어는 아래 두 상수가 정본이며,
 * assertPortableStoredPath가 그 둘 **말고는 아무것도 받지 않는다.**
 *
 * ── 왜 이 계산이 파일 하나로 떨어져 있는가 ───────────────────────────────
 * 이 시스템은 나중에 사내 NAS로 옮긴다. NAS는 Docker로 돌고 **컨테이너 안은
 * Linux**인데 개발은 Windows에서 한다. 경로를 실제로 만들어 내는 이 자리가
 * 그 차이가 물리는 유일한 지점이라, 규칙 세 개를 여기에 모아 두고 단위
 * 테스트로 못박는다(attachment-path.test.ts). 실제 파일 없이 검증된다.
 *
 *   1. **DB에는 항상 `/` 로 저장한다.** Windows에서 `repair-cases\abc\1.jpg`로
 *      적으면 Linux는 그 전체를 **폴더 하나의 이름**으로 읽는다 — 옮긴 순간
 *      파일을 못 찾는다. 그래서 DB에 넣을 값을 만들 때는 path.join 같은 OS
 *      구분자 함수를 쓰지 않고 문자열로 `/`를 붙인다.
 *   2. **소문자로 통일한다.** Windows는 "A.JPG"와 "a.jpg"를 같은 파일로 보지만
 *      Linux는 다른 파일로 본다. 대소문자가 섞인 채로 옮기면 **일부만 안 열린다.**
 *   3. **절대경로를 DB에 넣지 않는다.** `C:\DSS-AS-DATA`는 컨테이너 안에
 *      존재하지 않는다. 루트는 설정값 하나로 남기고 행에는 루트 아래 자리만 적는다
 *      (schema/attachments.ts의 stored_path 주석과 같은 결정).
 *
 * ── 디스크 파일명은 원본 이름이 아니라 첨부 ID다 ─────────────────────────
 * 사용자가 올린 이름은 original_file_name 컬럼에만 남고 디스크에는 쓰지 않는다.
 * 그 이름에는 경로 구분자·".."·윈도우 예약어가 섞일 수 있어 그대로 파일명으로
 * 쓰면 저장 루트 밖을 가리키는 경로가 만들어지고, 같은 이름이 두 번 올라오면
 * 앞의 파일을 덮어쓴다. 한글·특수문자가 NAS 이전 때 인코딩 때문에 깨지는 문제도
 * 함께 사라진다.
 *
 * ── OS 구분자는 디스크에 닿는 순간에만 ───────────────────────────────────
 * node:path를 쓰는 함수는 이 파일에서 resolveAttachmentAbsolutePath 하나뿐이다 —
 * 실제로 파일을 열고 쓰는 그 순간의 절대 경로를 만드는 함수라서다. DB에 넣을
 * 값을 만드는 buildAttachmentStoredPath는 node:path를 쓰지 않는다.
 * ============================================================================
 */

/** stored_path의 첫 마디. 소문자·하이픈 — 규칙 2를 파일 이름 수준에서 지킨다. */
export const ATTACHMENT_STORED_PATH_PREFIX = "repair-cases";

/** 제품 모델에 붙는 첨부(외형 사진·회로도)의 첫 마디. 위와 같은 규칙이다. */
export const ATTACHMENT_MODEL_STORED_PATH_PREFIX = "product-models";

/**
 * 저장 경로로 인정하는 첫 마디의 **전부**. 여기 없는 접두어는 거부된다 —
 * "옮길 수 있는 경로"의 정의를 한 자리에 모아 두어, 주인이 늘어날 때 검사
 * 함수를 고치지 않고 이 목록만 늘리게 한다.
 */
const ALLOWED_STORED_PATH_PREFIXES: readonly string[] = [
  ATTACHMENT_STORED_PATH_PREFIX,
  ATTACHMENT_MODEL_STORED_PATH_PREFIX,
];

/** UUID(소문자 hex). 대문자가 섞인 값은 눕혀서 받고, 형태가 아니면 던진다. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export class AttachmentPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AttachmentPathError";
  }
}

function requireUuid(label: string, value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!UUID_PATTERN.test(normalized)) {
    throw new AttachmentPathError(`${label}가 UUID 형식이 아닙니다.`);
  }
  return normalized;
}

/**
 * DB의 stored_path에 넣을 값을 만든다. **여기서 나온 문자열만이 저장 경로다.**
 *
 * extension은 허용목록에서 정규화한 소문자만 붙는다 — 목록 밖 확장자는 던진다.
 * 확장자 자리에 임의 문자열이 들어오면 규칙 1·2가 그 자리에서 깨진다.
 */
export function buildAttachmentStoredPath(params: {
  repairCaseId: string;
  attachmentId: string;
  /** 원본 파일명이 아니라 정규화된 확장자(점 없음). normalizeFileExtension의 결과. */
  extension: string;
}): string {
  const repairCaseId = requireUuid("접수 건 ID", params.repairCaseId);
  const attachmentId = requireUuid("첨부 ID", params.attachmentId);

  const extension = params.extension.trim().toLowerCase();
  if (!isAllowedExtension(extension)) {
    throw new AttachmentPathError(`허용되지 않은 확장자입니다: ${extension || "(없음)"}`);
  }

  // path.join을 쓰지 않는다 — Windows에서 역슬래시가 섞이면 Linux가 이 값을
  // 폴더 하나의 이름으로 읽는다(파일 헤더 규칙 1).
  return `${ATTACHMENT_STORED_PATH_PREFIX}/${repairCaseId}/${attachmentId}.${extension}`;
}

/**
 * 미리보기(썸네일) 파일의 상대 경로.
 *
 * 원본과 **같은 폴더에 나란히** 둔다. 접수 건 폴더 하나만 보면 그 건의 파일이
 * 다 있는 셈이고, 백업이나 NAS 이전 때 원본과 미리보기가 갈라지지 않는다.
 *
 * 확장자는 언제나 jpg다 — 미리보기는 브라우저가 JPEG로 만들어 올리기 때문이다
 * (PNG 원본이어도 미리보기는 JPEG). `.preview.jpg`로 끝나므로 원본 파일과
 * 이름이 겹치지 않는다.
 */
export function buildAttachmentPreviewPath(params: {
  repairCaseId: string;
  attachmentId: string;
}): string {
  const repairCaseId = requireUuid("접수 건 ID", params.repairCaseId);
  const attachmentId = requireUuid("첨부 ID", params.attachmentId);
  return `${ATTACHMENT_STORED_PATH_PREFIX}/${repairCaseId}/${attachmentId}.preview.jpg`;
}

/**
 * 원본 파일명에서 바로 stored_path를 만드는 편의 함수. 확장자를 뽑는 규칙이
 * 부르는 쪽마다 다시 적히지 않게 한다. 확장자를 뽑을 수 없으면 던진다.
 */
export function buildAttachmentStoredPathFromFileName(params: {
  repairCaseId: string;
  attachmentId: string;
  originalFileName: string;
}): string {
  const extension = normalizeFileExtension(params.originalFileName);
  if (!extension) {
    throw new AttachmentPathError("파일 확장자를 확인할 수 없습니다.");
  }
  return buildAttachmentStoredPath({
    repairCaseId: params.repairCaseId,
    attachmentId: params.attachmentId,
    extension,
  });
}

/**
 * ============================================================================
 * 제품 모델 첨부 — 접수 건과 나란히 놓인 두 번째 벌
 * ============================================================================
 * 위 세 함수와 **한 벌로 겹쳐 쓰지 않고 나란히 새로 둔다.** 위쪽은 이미 실기에서
 * 파일을 다루고 있는 코드라 서명을 바꾸면 업로드 통로까지 함께 흔들린다. 두 벌을
 * 하나로 합칠지는 모델 첨부의 실제 쓰임을 본 다음에 판단할 일이다.
 *
 * 검사 규칙은 위쪽과 **글자 하나까지 같다** — UUID 형식 확인, 확장자 허용목록,
 * 소문자 눕히기, path.join 금지. 다른 것은 첫 마디뿐이다.
 * ============================================================================
 */

/**
 * 제품 모델 첨부의 stored_path. `product-models/{모델id}/{첨부id}.{확장자}`
 *
 * buildAttachmentStoredPath와 같은 규칙을 따른다 — 확장자는 허용목록에서
 * 정규화한 소문자만 붙고, 목록 밖 확장자는 던진다.
 */
export function buildProductModelAttachmentStoredPath(params: {
  productModelId: string;
  attachmentId: string;
  /** 원본 파일명이 아니라 정규화된 확장자(점 없음). normalizeFileExtension의 결과. */
  extension: string;
}): string {
  const productModelId = requireUuid("제품 모델 ID", params.productModelId);
  const attachmentId = requireUuid("첨부 ID", params.attachmentId);

  const extension = params.extension.trim().toLowerCase();
  if (!isAllowedExtension(extension)) {
    throw new AttachmentPathError(`허용되지 않은 확장자입니다: ${extension || "(없음)"}`);
  }

  // 접수 건 쪽과 같은 이유로 path.join을 쓰지 않는다(파일 헤더 규칙 1).
  return `${ATTACHMENT_MODEL_STORED_PATH_PREFIX}/${productModelId}/${attachmentId}.${extension}`;
}

/**
 * 제품 모델 첨부의 미리보기(썸네일) 경로. 원본과 같은 폴더에 나란히 두고,
 * 확장자는 언제나 jpg다 — buildAttachmentPreviewPath의 주석과 같은 이유다.
 */
export function buildProductModelAttachmentPreviewPath(params: {
  productModelId: string;
  attachmentId: string;
}): string {
  const productModelId = requireUuid("제품 모델 ID", params.productModelId);
  const attachmentId = requireUuid("첨부 ID", params.attachmentId);
  return `${ATTACHMENT_MODEL_STORED_PATH_PREFIX}/${productModelId}/${attachmentId}.preview.jpg`;
}

/**
 * 원본 파일명에서 바로 모델 첨부의 stored_path를 만드는 편의 함수.
 * buildAttachmentStoredPathFromFileName과 짝이며, 확장자를 뽑을 수 없으면 던진다.
 */
export function buildProductModelAttachmentStoredPathFromFileName(params: {
  productModelId: string;
  attachmentId: string;
  originalFileName: string;
}): string {
  const extension = normalizeFileExtension(params.originalFileName);
  if (!extension) {
    throw new AttachmentPathError("파일 확장자를 확인할 수 없습니다.");
  }
  return buildProductModelAttachmentStoredPath({
    productModelId: params.productModelId,
    attachmentId: params.attachmentId,
    extension,
  });
}

/**
 * DB에서 읽어 온 stored_path가 옮겨도 되는 값인가 — 규칙 1·2·3을 그대로 검사한다.
 *
 * **DB 값이라고 그대로 믿지 않는다.** 이 표의 행은 옛 버전 코드나 손으로 넣은
 * SQL로도 들어올 수 있고, 그 한 줄이 저장 루트 밖의 파일을 열게 만들 수 있다.
 */
export function assertPortableStoredPath(storedPath: string): void {
  if (typeof storedPath !== "string" || storedPath.length === 0) {
    throw new AttachmentPathError("저장 경로가 비어 있습니다.");
  }
  // 규칙 1 — 역슬래시는 Linux에서 파일명의 일부가 된다.
  if (storedPath.includes("\\")) {
    throw new AttachmentPathError("저장 경로에 역슬래시가 들어 있습니다. 구분자는 '/' 하나뿐입니다.");
  }
  // 규칙 3 — 절대경로·드라이브 문자·UNC는 루트 설정을 무의미하게 만든다.
  if (storedPath.startsWith("/") || /^[a-zA-Z]:/.test(storedPath)) {
    throw new AttachmentPathError("저장 경로는 저장 루트 기준 상대 경로여야 합니다.");
  }
  // 규칙 2 — 대문자가 섞이면 NAS로 옮긴 뒤 그 파일만 열리지 않는다.
  if (storedPath !== storedPath.toLowerCase()) {
    throw new AttachmentPathError("저장 경로는 소문자여야 합니다.");
  }
  if (storedPath.includes("\0")) {
    throw new AttachmentPathError("저장 경로에 허용되지 않은 문자가 들어 있습니다.");
  }

  const segments = storedPath.split("/");
  for (const segment of segments) {
    if (segment === "" || segment === "." || segment === "..") {
      throw new AttachmentPathError("저장 경로에 빈 마디나 상위 이동(..)이 들어 있습니다.");
    }
  }
  // 첫 마디는 **알려진 접두어 둘 중 하나여야 한다.** 넓힌 것은 이 한 줄뿐이고,
  // "아무 접두어나 받는다"가 아니다 — 목록 밖의 첫 마디(customers/... 등)는
  // 여전히 던진다. 백업 스크립트(scripts/backup-attachments.ts)가 이 함수로 DB의
  // 전 행을 검사하므로, 여기가 모델 경로를 안 받으면 나중에 백업이 그 파일에서
  // 멈춘다.
  if (!ALLOWED_STORED_PATH_PREFIXES.includes(segments[0])) {
    throw new AttachmentPathError(
      `저장 경로는 ${ALLOWED_STORED_PATH_PREFIXES.map((prefix) => `'${prefix}/'`).join(
        " 또는 "
      )}로 시작해야 합니다.`
    );
  }
}

/** 던지지 않는 형태. 화면·테스트가 가부만 물을 때 쓴다. */
export function isPortableStoredPath(storedPath: string): boolean {
  try {
    assertPortableStoredPath(storedPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * 실제로 디스크에 닿는 절대 경로. **이 파일에서 node:path를 쓰는 유일한 함수다.**
 *
 * 규칙 검사를 통과한 값이라도 한 번 더 정규화해서 루트 밖을 가리키면 던진다 —
 * 검사와 해석 사이에 뭐가 달라졌든, 저장 루트 밖의 파일을 여는 일은 없어야 한다.
 */
export function resolveAttachmentAbsolutePath(uploadsRoot: string, storedPath: string): string {
  if (!uploadsRoot || uploadsRoot.trim().length === 0) {
    throw new AttachmentPathError("저장 루트가 설정되지 않았습니다.");
  }
  assertPortableStoredPath(storedPath);

  const absoluteRoot = path.resolve(uploadsRoot);
  const absolute = path.resolve(absoluteRoot, ...storedPath.split("/"));

  const relative = path.relative(absoluteRoot, absolute);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new AttachmentPathError("저장 경로가 저장 루트 밖을 가리킵니다.");
  }
  return absolute;
}
