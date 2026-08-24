import type { AttachmentCategory } from "./attachment-category";

/**
 * ============================================================================
 * 첨부 허용목록 — 실제 저장이 기준으로 삼는 정본
 * ============================================================================
 * 지금까지 확장자 규칙은 데모 화면 전용 파일
 * (src/lib/domain/local/attachments/allowlist.ts) 안에만 있었다. 그 파일은
 * 브라우저 localStorage에 메타데이터만 담는 "실제 저장 없음" 데모라, 실제
 * 디스크에 파일을 쓰는 코드가 거기 있는 목록을 참조할 수는 없다 — 그 파일은
 * 언제든 데모가 걷히면서 사라진다.
 *
 * 그래서 실제 저장(attachments 테이블 + UPLOADS_DIR)이 기준으로 삼을 목록을
 * 여기로 옮긴다. **확장자 규칙은 데모 파일과 정확히 같다** — 새로 만들거나 뺀
 * 확장자가 하나도 없고, attachment-allowlist.test.ts가 두 목록이 어긋나지
 * 않는지 순서까지 검사한다(분류 목록에 attachment-category.test.ts가 하는 것과
 * 같은 방식).
 *
 * ── 크기 상한만 일부러 다르다 ────────────────────────────────────────────
 * 데모 파일의 MAX_ATTACHMENT_SIZE_BYTES는 300MB이고, 여기는 **20MB**다.
 * 이것은 실수가 아니라 승인된 결정이다.
 *
 * 데모는 파일 내용을 한 바이트도 다루지 않는다 — 사용자가 입력한 "크기"라는
 * 숫자를 localStorage에 적을 뿐이라, 300MB든 3GB든 아무 자원도 쓰지 않는다.
 * 여기서부터는 그 숫자가 실제로 디스크를 흐르는 바이트가 된다: 업로드 시간,
 * 임시 파일 자리, 백업 크기, 그리고 NAS로 옮길 때의 복사 시간이 전부 이 값에
 * 달린다. 그래서 실제 저장의 상한은 승인된 20MB로 따로 정했다.
 *
 * 두 값을 억지로 맞추지 않는 이유: 데모 쪽을 20MB로 낮추면 지금 그 화면에서
 * 되던 일이 까닭 없이 막히고, 이쪽을 300MB로 올리면 승인되지 않은 상한이
 * 실제 저장에 적용된다. 그래서 **테스트가 두 값을 비교하지 않는다** —
 * 비교 대상에서 명시적으로 뺐고, 그 사실을 테스트에 적어 두었다.
 * (데모 파일 쪽에는 주석을 달지 못했다. 이번 단계의 지시가 데모 계층
 * `src/lib/domain/local/attachments/*` 수정을 금지하기 때문이다.)
 *
 * ── 순수 파일이다 ─────────────────────────────────────────────────────────
 * server-only / node:fs / drizzle / React 를 import 하지 않는다. 실제 파일
 * 없이 단위 테스트로 전부 검증된다.
 * ============================================================================
 */

/**
 * 실제 저장의 파일 크기 상한. 위 헤더의 "크기 상한만 일부러 다르다" 참조 —
 * 데모 파일의 300MB와 다른 것이 의도된 것이다.
 */
export const MAX_ATTACHMENT_SIZE_BYTES = 20 * 1024 * 1024; // 20MB

export type AttachmentExtensionRule = {
  extension: string;
  allowedMimeTypes: readonly string[];
  /** SECURITY_POLICY.md 6번 기준 미리보기 가능 확장자만 true다: jpg, jpeg, png, pdf, txt, csv */
  previewCapable: boolean;
};

/**
 * 값·순서 모두 데모 파일의 ATTACHMENT_EXTENSION_RULES와 정확히 같아야 한다.
 * 어긋남은 attachment-allowlist.test.ts가 잡는다.
 */
export const ATTACHMENT_EXTENSION_RULES: readonly AttachmentExtensionRule[] = [
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

export const PREVIEW_CAPABLE_EXTENSIONS: ReadonlySet<string> = new Set(
  ATTACHMENT_EXTENSION_RULES.filter((rule) => rule.previewCapable).map((rule) => rule.extension)
);

/**
 * 4개 분류는 승인된 확장자만 허용한다. 나머지 분류는 여기 목록에 없으므로 전체
 * 허용목록 중 아무 확장자나 쓸 수 있다. 데모 파일의 CATEGORY_EXTENSION_ALLOWLIST와
 * 같아야 하고, 어긋남은 테스트가 잡는다.
 */
export const CATEGORY_EXTENSION_ALLOWLIST: Partial<Record<AttachmentCategory, readonly string[]>> = {
  OSCILLOSCOPE_DATA: ["csv", "txt"],
  LOG_FILE: ["log", "txt"],
  FIRMWARE: ["bin", "hex", "zip"],
  CIRCUIT_DIAGRAM: ["pdf"],
};

/**
 * 사용자가 올린 이름에서 확장자만 뽑아 소문자로 정규화한다.
 *
 * 소문자로 고정하는 이유는 NAS 이식 때문이다 — Windows는 "A.JPG"와 "a.jpg"를
 * 같은 파일로 보지만 Linux 컨테이너는 다른 파일로 본다. 디스크 경로에 들어갈
 * 값을 여기서 한 번 소문자로 눕혀 두면, 옮긴 뒤 "일부 파일만 안 열리는" 일이
 * 생기지 않는다(attachment-path.ts의 같은 규칙과 짝이다).
 *
 * 점이 없거나, 마지막 점 뒤가 비었거나, 영숫자가 아닌 문자가 섞였으면 null이다.
 * 여기서 걸러 두면 "..", 경로 구분자, 윈도우 예약 문자가 확장자로 둔갑해
 * 디스크 경로를 만드는 일이 애초에 불가능해진다.
 */
export function normalizeFileExtension(fileName: string): string | null {
  const trimmed = fileName.trim();
  const lastDot = trimmed.lastIndexOf(".");
  if (lastDot <= 0 || lastDot === trimmed.length - 1) return null;
  const extension = trimmed.slice(lastDot + 1).toLowerCase();
  if (!/^[a-z0-9]{1,16}$/.test(extension)) return null;
  return extension;
}

export function isAllowedExtension(extension: string): boolean {
  return EXTENSION_RULE_MAP.has(extension);
}

export function getAllowedMimeTypesForExtension(extension: string): readonly string[] {
  return EXTENSION_RULE_MAP.get(extension)?.allowedMimeTypes ?? [];
}

/**
 * DB의 mime_type 컬럼에 적을 값. **브라우저가 보낸 Content-Type을 쓰지 않는다** —
 * 그 값은 클라이언트가 마음대로 정할 수 있어서, 그대로 저장하면 나중에
 * 다운로드 응답 헤더가 공격자가 고른 타입으로 나간다. 확장자는 허용목록으로
 * 이미 좁혀져 있으므로, 그 확장자의 정본 MIME을 서버가 직접 고른다.
 */
export function canonicalMimeTypeForExtension(extension: string): string | null {
  return EXTENSION_RULE_MAP.get(extension)?.allowedMimeTypes[0] ?? null;
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

/**
 * ============================================================================
 * 내용 대조 — 확장자가 말하는 것과 실제 바이트가 같은가
 * ============================================================================
 * 브라우저가 보낸 MIME도, 사용자가 붙인 확장자도 그 자체로는 아무 증거가 아니다.
 * `bad.exe`를 `report.pdf`로 이름만 바꿔 올리면 둘 다 "PDF"라고 말한다. 그래서
 * 실제로 저장하기 전에 **파일 앞머리 바이트**를 확장자가 주장하는 형식과 대조한다.
 *
 * 이것은 악성코드 검사가 아니다(검사 엔진은 아직 없고, malware_scan_status는
 * 전부 NOT_SCANNED로 남는다). 여기서 막는 것은 "형식을 속인 파일"까지다.
 *
 * bin/hex(펌웨어)에는 대조할 서명이 없다 — 펌웨어 덤프는 정의상 임의의 바이트라
 * 어떤 서명도 요구할 수 없다. 그 자리는 나중에 붙을 검사 엔진이 맡는다.
 * ============================================================================
 */

/** 앞머리 몇 바이트를 대조에 쓰는가. PDF 규격이 %PDF- 를 앞 1024바이트 안에 허용한다. */
export const CONTENT_SNIFF_BYTES = 1024;

type ContentCheck = "JPEG" | "PNG" | "PDF" | "ZIP" | "OFFICE_LEGACY" | "TEXT" | "UNCHECKED";

const CONTENT_CHECK_BY_EXTENSION: Readonly<Record<string, ContentCheck>> = {
  jpg: "JPEG",
  jpeg: "JPEG",
  png: "PNG",
  pdf: "PDF",
  // xlsx/docx는 규격상 ZIP 컨테이너다.
  zip: "ZIP",
  xlsx: "ZIP",
  docx: "ZIP",
  // 옛 Office는 OLE2 복합 문서다. ZIP도 받아 주는 것은 실무 때문이다 —
  // .xlsx를 .xls로 이름만 바꿔 보내는 일이 흔한데, 그건 형식을 속이려는
  // 시도가 아니라 사무실에서 늘 일어나는 실수다. 실행 파일·스크립트는
  // 두 서명 중 어느 쪽도 아니라 여전히 걸린다.
  xls: "OFFICE_LEGACY",
  doc: "OFFICE_LEGACY",
  csv: "TEXT",
  txt: "TEXT",
  log: "TEXT",
  // 펌웨어 — 대조할 서명이 없다(위 주석 참조).
  bin: "UNCHECKED",
  hex: "UNCHECKED",
};

function startsWith(bytes: Uint8Array, prefix: readonly number[]): boolean {
  if (bytes.length < prefix.length) return false;
  for (let i = 0; i < prefix.length; i += 1) {
    if (bytes[i] !== prefix[i]) return false;
  }
  return true;
}

function containsAscii(bytes: Uint8Array, ascii: string): boolean {
  const needle = Array.from(ascii, (char) => char.charCodeAt(0));
  outer: for (let i = 0; i + needle.length <= bytes.length; i += 1) {
    for (let j = 0; j < needle.length; j += 1) {
      if (bytes[i + j] !== needle[j]) continue outer;
    }
    return true;
  }
  return false;
}

const JPEG_MAGIC = [0xff, 0xd8, 0xff];
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const OLE2_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const ZIP_LOCAL = [0x50, 0x4b, 0x03, 0x04];
const ZIP_EMPTY = [0x50, 0x4b, 0x05, 0x06];
const ZIP_SPANNED = [0x50, 0x4b, 0x07, 0x08];
const WINDOWS_EXECUTABLE = [0x4d, 0x5a]; // "MZ"
const ELF_EXECUTABLE = [0x7f, 0x45, 0x4c, 0x46]; // "\x7fELF"

function isZip(header: Uint8Array): boolean {
  return startsWith(header, ZIP_LOCAL) || startsWith(header, ZIP_EMPTY) || startsWith(header, ZIP_SPANNED);
}

/**
 * 텍스트로 보이는가. NUL 바이트가 하나라도 있으면 텍스트가 아니다 — 실행
 * 파일·이미지·압축 파일은 앞머리 몇 백 바이트 안에 반드시 NUL이 나온다.
 * 실행 파일 서명은 그와 별개로 한 번 더 명시적으로 막는다.
 */
function looksLikeText(header: Uint8Array): boolean {
  if (startsWith(header, WINDOWS_EXECUTABLE) || startsWith(header, ELF_EXECUTABLE)) return false;
  if (isZip(header) || startsWith(header, OLE2_MAGIC) || startsWith(header, PNG_MAGIC)) return false;
  return !header.includes(0x00);
}

/**
 * 이 확장자의 파일이라면 앞머리가 이렇게 생겨야 한다 — 아니면 거부한다.
 *
 * 허용목록에 없는 확장자는 여기서도 false다(앞선 단계에서 이미 걸리지만, 이
 * 함수만 따로 불러도 열리지 않아야 한다).
 */
export function isContentCompatibleWithExtension(extension: string, header: Uint8Array): boolean {
  if (!isAllowedExtension(extension)) return false;
  if (header.length === 0) return false;

  switch (CONTENT_CHECK_BY_EXTENSION[extension] ?? "UNCHECKED") {
    case "JPEG":
      return startsWith(header, JPEG_MAGIC);
    case "PNG":
      return startsWith(header, PNG_MAGIC);
    case "PDF":
      // 규격은 %PDF- 가 앞 1024바이트 안에 있으면 된다고 본다(BOM/여백이 앞에
      // 붙은 실제 파일이 있다).
      return containsAscii(header, "%PDF-");
    case "ZIP":
      return isZip(header);
    case "OFFICE_LEGACY":
      return startsWith(header, OLE2_MAGIC) || isZip(header);
    case "TEXT":
      return looksLikeText(header);
    case "UNCHECKED":
      // 펌웨어. 다만 실행 파일 서명은 확장자와 무관하게 되돌려 보낸다 —
      // .bin 으로 위장한 실행 파일까지 통과시킬 이유는 없다.
      return !startsWith(header, WINDOWS_EXECUTABLE) && !startsWith(header, ELF_EXECUTABLE);
    default:
      return false;
  }
}
