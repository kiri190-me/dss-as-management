import type { AttachmentCategory } from "./attachment-types";

// DATABASE_DESIGN.md 10번 / SECURITY_POLICY.md 10번의 지원 파일 유형(JPG, PNG,
// PDF, XLS, XLSX, DOC, DOCX, ZIP, CSV, TXT, 오실로스코프 데이터, 장비 로그 파일,
// 펌웨어, 회로도)에 JPEG를 더하고, 오실로스코프/로그/펌웨어에 대한 구체적인
// 확장자(.log/.bin/.hex)를 Stage D-2 승인 사항에 따라 추가한 데모 전용
// 허용목록이다. 실제 파일 바이트 검증은 수행하지 않는다(메타데이터 형식
// 검사만 한다).

export const MAX_ATTACHMENT_SIZE_BYTES = 300 * 1024 * 1024; // 300MB

type ExtensionRule = {
  extension: string;
  allowedMimeTypes: readonly string[];
  /** section 6 기준 미리보기 가능 확장자만 true다: jpg, jpeg, png, pdf, txt, csv */
  previewCapable: boolean;
};

export const ATTACHMENT_EXTENSION_RULES: readonly ExtensionRule[] = [
  { extension: "jpg", allowedMimeTypes: ["image/jpeg"], previewCapable: true },
  { extension: "jpeg", allowedMimeTypes: ["image/jpeg"], previewCapable: true },
  { extension: "png", allowedMimeTypes: ["image/png"], previewCapable: true },
  { extension: "pdf", allowedMimeTypes: ["application/pdf"], previewCapable: true },
  { extension: "xls", allowedMimeTypes: ["application/vnd.ms-excel"], previewCapable: false },
  {
    extension: "xlsx",
    allowedMimeTypes: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
    previewCapable: false,
  },
  { extension: "doc", allowedMimeTypes: ["application/msword"], previewCapable: false },
  {
    extension: "docx",
    allowedMimeTypes: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
    previewCapable: false,
  },
  {
    extension: "zip",
    allowedMimeTypes: ["application/zip", "application/x-zip-compressed"],
    previewCapable: false,
  },
  { extension: "csv", allowedMimeTypes: ["text/csv"], previewCapable: true },
  { extension: "txt", allowedMimeTypes: ["text/plain"], previewCapable: true },
  { extension: "log", allowedMimeTypes: ["text/plain"], previewCapable: false },
  { extension: "bin", allowedMimeTypes: ["application/octet-stream"], previewCapable: false },
  {
    extension: "hex",
    allowedMimeTypes: ["application/octet-stream", "text/plain"],
    previewCapable: false,
  },
];

const EXTENSION_RULE_MAP = new Map(ATTACHMENT_EXTENSION_RULES.map((rule) => [rule.extension, rule]));

export const PREVIEW_CAPABLE_EXTENSIONS = new Set(
  ATTACHMENT_EXTENSION_RULES.filter((r) => r.previewCapable).map((r) => r.extension)
);

/**
 * 4개 카테고리는 승인된 확장자만 허용한다(오실로스코프: csv/txt, 로그: log/txt,
 * 펌웨어: bin/hex/zip, 회로도: pdf + 사진). 나머지 카테고리는 여기 목록에 없으므로
 * 전체 허용목록 중 아무 확장자나 쓸 수 있다.
 *
 * 이 목록은 실제 저장의 정본(src/lib/domain/attachment-allowlist.ts)과 순서까지
 * 같아야 하고, attachment-allowlist.test.ts가 그것을 검사한다. 한쪽만 고치면
 * 화면과 서버가 서로 다른 파일을 받는다.
 */
export const CATEGORY_EXTENSION_ALLOWLIST: Partial<Record<AttachmentCategory, readonly string[]>> = {
  OSCILLOSCOPE_DATA: ["csv", "txt"],
  LOG_FILE: ["log", "txt"],
  FIRMWARE: ["bin", "hex", "zip"],
  // 종이 회로도를 현장에서 폰으로 찍어 올리는 길을 연다. 나중에 넓히면 그
  // 전보다 앞서 올라온 파일들과 규칙이 어긋나므로 지금 함께 넓힌다.
  // (정본 쪽 같은 자리의 주석이 더 자세하다.)
  CIRCUIT_DIAGRAM: ["pdf", "jpg", "jpeg", "png"],
};

export function isAllowedExtension(extension: string): boolean {
  return EXTENSION_RULE_MAP.has(extension);
}

export function getAllowedMimeTypesForExtension(extension: string): readonly string[] {
  return EXTENSION_RULE_MAP.get(extension)?.allowedMimeTypes ?? [];
}

export function isExtensionMimeCompatible(extension: string, mimeType: string): boolean {
  const rule = EXTENSION_RULE_MAP.get(extension);
  if (!rule) return false;
  return rule.allowedMimeTypes.includes(mimeType);
}

export function isExtensionAllowedForCategory(extension: string, category: AttachmentCategory): boolean {
  const restricted = CATEGORY_EXTENSION_ALLOWLIST[category];
  if (!restricted) return isAllowedExtension(extension);
  return restricted.includes(extension);
}

export function isPreviewCapableExtension(extension: string): boolean {
  return PREVIEW_CAPABLE_EXTENSIONS.has(extension);
}
