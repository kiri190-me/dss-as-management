import {
  QUOTE_FOLDER_LINK_MAX_ENCODED_LENGTH,
  checkQuoteFolderRelativePath,
  quoteFolderLinkDecodeBytes,
  quoteFolderLinkEncodeBytes,
  type QuoteFolderPathRejection,
} from "./quote-folder-link";

/**
 * ============================================================================
 * 「엑셀 → PDF」 도우미 주소 — `dss-folder://xlsx2pdf/?p=<base64url>` (순수 — 서버 · 화면 · 시험이 함께 쓴다)
 * ============================================================================
 * 공유폴더 안의 `.xlsx` **한 장**을 그 PC 의 Excel 로 열어 **같은 폴더에 같은 이름 `.pdf`** 로
 * 바꿔 쓴다. 운영이 리눅스 컨테이너라 서버는 진짜 Excel 변환을 할 수 없다 — 변환은 그 PC 가
 * 한다(server/quote-folder-helper.ts 의 도우미 스크립트).
 *
 * ── 🔴 이 파일이 생긴 까닭 (2026-10-08) ──────────────────────────────────
 * 접두어 상수는 2026-10-08 아침까지 server/quote-folder-helper.ts 에 있었다. 그 파일은
 * `import "server-only"` 라 **화면이 읽을 수 없다** — 주소를 만드는 쪽이 화면이 되는 순간
 * 그 자리는 막힌 자리다. 그래서 폴더 주소 · 파일 주소와 **같은 모양**으로 domain 에 옮기고,
 * 서버 모듈은 여기서 읽어 쓴다.
 * 🔴 **도우미 스크립트의 글자는 한 글자도 바뀌지 않았다** — 상수의 값이 그대로이기 때문이고,
 * 그 사실은 server/quote-folder-helper.test.ts 가 스크립트 전체의 sha256 으로 못 박는다.
 *
 * ── 🔴 새 스킴을 만들지 않는다 ───────────────────────────────────────────
 * 레지스트리 자리가 `HKCU\Software\Classes\dss-folder` 하나뿐이라 스킴을 늘리면 설치가 한 벌
 * 더 는다(domain/quote-folder-file-link.ts 머리말과 같은 까닭). 접두어만 다르다:
 *   폴더:        dss-folder://open/?p=<base64url(상대 폴더경로)>   ← quote-folder-link.ts
 *   파일 열기:   dss-folder://openfile/?p=<base64url(상대 파일경로)> ← quote-folder-file-link.ts
 *   🔴 PDF 변환: dss-folder://xlsx2pdf/?p=<base64url(상대 .xlsx 경로)> ← 이 파일
 * 🔴 앞의 둘은 한 글자도 바뀌지 않았다.
 *
 * ── 🔴 원본은 `.xlsx` 하나뿐이다 (사용자 결정 2026-10-08) ─────────────────
 * 읽기 허용 목록(QUOTE_FOLDER_OPENABLE_EXTENSIONS · 열여덟 개)과 **일부러 다르다.** 이 명령은
 * 도우미가 **처음으로 파일을 쓰는** 명령이라 울타리를 좁힌다 — `.xlsm` 도 `.xls` 도 거절이다.
 * 판정 방식은 도우미의 `Test-XlsxFileName` 과 같다: 점이 1 번째 자리 뒤에 있고, 점이 맨 뒤가
 * 아니고, **점부터 끝까지를 접은 글자**가 `.xlsx` 와 같아야 한다.
 *
 * ── 🔴 결과 경로를 주소에 싣지 않는다 ────────────────────────────────────
 * 주소가 나르는 것은 **원본 하나**뿐이다. 쓰는 곳은 원본과 같은 폴더의 같은 이름 `.pdf` 로
 * **규칙이 정한다**(quoteFolderXlsx2PdfOutputPath). 결과 경로를 받는 순간 이 명령은
 * 「아무 데나 쓰기」가 된다. 도우미도 같은 규칙으로 제 손으로 다시 짓는다 — 여기서 지은
 * 값을 믿고 쓰지 않는다.
 *
 * ── 🔴 마지막 울타리는 도우미다 ──────────────────────────────────────────
 * 이 주소도 **아무 웹페이지나 부를 수 있다.** 여기서 거절하는 것은 편의이고, 루트 담김 ·
 * 바로 가기 · 확장자 · 「폴더가 아니라 파일인가」 · 「쓸 자리가 바로 가기 · 폴더가 아닌가」는
 * 전부 PowerShell 도우미 안에서 **다시** 본다(server/quote-folder-helper.ts 의 검사 열하나).
 * ============================================================================
 */

/** 도우미가 받는 **PDF 변환** 주소의 앞부분. 뒤에 base64url 로 싼 상대 경로가 붙는다. */
export const QUOTE_FOLDER_XLSX2PDF_LINK_PREFIX = "dss-folder://xlsx2pdf/?p=";

/**
 * 🔴 PDF 로 바꿀 수 있는 **원본 확장자 — 이것 하나뿐이다**(사용자 결정 2026-10-08).
 * 읽기 허용 목록과 **일부러 다르다**(위 머리말).
 */
export const QUOTE_FOLDER_XLSX2PDF_SOURCE_EXTENSION = "xlsx";

/** 🔴 결과 확장자. 결과 경로는 **받지 않는다** — 원본 이름의 확장자만 이것으로 바꾼다. */
export const QUOTE_FOLDER_XLSX2PDF_OUTPUT_EXTENSION = "pdf";

/** `.xlsx` — 도우미의 `$ConvertSourceSuffix` 와 같은 글자다. */
export const QUOTE_FOLDER_XLSX2PDF_SOURCE_SUFFIX = `.${QUOTE_FOLDER_XLSX2PDF_SOURCE_EXTENSION}`;
/** `.pdf` — 도우미의 `$ConvertOutputSuffix` 와 같은 글자다. */
export const QUOTE_FOLDER_XLSX2PDF_OUTPUT_SUFFIX = `.${QUOTE_FOLDER_XLSX2PDF_OUTPUT_EXTENSION}`;

export type QuoteFolderXlsx2PdfRejection =
  | QuoteFolderPathRejection
  /** 점이 없다(`문서`) · 점이 맨 앞이다(`.xlsx`) · 점이 맨 뒤다(`문서.`) — 확장자가 없는 것으로 본다. */
  | "NO_EXTENSION"
  /** 🔴 `.xlsx` 가 아니다 — `.xlsm` · `.xls` 도 여기서 거절이다. */
  | "NOT_XLSX";

/**
 * 맨 뒤 마디(파일 이름)가 `.xlsx` 인가 — 도우미의 `Test-XlsxFileName` 과 **같은 판정**이다.
 * `toLowerCase` 는 지역 설정과 무관하다(`toLocaleLowerCase` 가 아니다).
 */
function xlsxNameRejection(name: string): "NO_EXTENSION" | "NOT_XLSX" | null {
  const dot = name.lastIndexOf(".");
  if (dot < 1 || dot === name.length - 1) return "NO_EXTENSION";
  return name.slice(dot).toLowerCase() === QUOTE_FOLDER_XLSX2PDF_SOURCE_SUFFIX ? null : "NOT_XLSX";
}

/**
 * PDF 로 바꿀 수 있는 **원본 상대 경로**인가 — 거절할 까닭을 돌려준다(받아들이면 null).
 * 상대 경로 규칙(domain/quote-folder-link.ts)을 먼저 그대로 거치고, 맨 뒤 마디를 본다.
 *
 * 🔴 `견적서.xlsx.` · `견적서.xlsx ` 처럼 끝에 점 · 공백이 붙은 이름은 **상대 경로 규칙**이
 * 먼저 막는다(TRAILING_DOT_OR_SPACE) — Windows 가 조용히 떼어 다른 파일을 가리킬 수 있다.
 */
export function checkQuoteFolderXlsx2PdfSourcePath(value: unknown): QuoteFolderXlsx2PdfRejection | null {
  const pathRejection = checkQuoteFolderRelativePath(value);
  if (pathRejection !== null) return pathRejection;
  const segments = (value as string).split("/");
  return xlsxNameRejection(segments[segments.length - 1]);
}

export function isQuoteFolderXlsx2PdfSourcePath(value: unknown): value is string {
  return checkQuoteFolderXlsx2PdfSourcePath(value) === null;
}

/**
 * 🔴 **화면 · 통로가 쓰는 물음** — 폴더 안의 이름 하나를 PDF 로 바꿀 수 있는가.
 * 이름 하나는 마디 하나짜리 상대 경로이므로 위 검사를 그대로 쓴다(`/` 가 들어 있으면 거짓).
 */
export function isQuoteFolderXlsx2PdfSourceName(name: unknown): boolean {
  return typeof name === "string" && !name.includes("/") && isQuoteFolderXlsx2PdfSourcePath(name);
}

/**
 * 🔴 **결과 이름 — 규칙이 정한다.** 원본 이름 끝의 `.xlsx` 다섯 글자를 떼고 `.pdf` 를 붙인다
 * (도우미 스크립트와 **같은 방식**이다 — `ChangeExtension` 을 쓰지 않는다). 원본이 규칙 밖이면
 * null — 이름을 지어내지 않는다.
 */
export function quoteFolderXlsx2PdfOutputName(name: unknown): string | null {
  if (!isQuoteFolderXlsx2PdfSourceName(name)) return null;
  const text = name as string;
  return `${text.slice(0, text.length - QUOTE_FOLDER_XLSX2PDF_SOURCE_SUFFIX.length)}${QUOTE_FOLDER_XLSX2PDF_OUTPUT_SUFFIX}`;
}

/**
 * 결과 **상대 경로** — 원본과 **같은 폴더**의 같은 이름 `.pdf`. 폴더 마디는 한 글자도 바뀌지
 * 않는다(도우미도 폴더가 같은지를 다시 맞춰 본다). 원본이 규칙 밖이면 null.
 */
export function quoteFolderXlsx2PdfOutputPath(relativePath: unknown): string | null {
  if (!isQuoteFolderXlsx2PdfSourcePath(relativePath)) return null;
  const segments = (relativePath as string).split("/");
  const outputName = quoteFolderXlsx2PdfOutputName(segments[segments.length - 1]);
  if (outputName === null) return null;
  return [...segments.slice(0, -1), outputName].join("/");
}

/**
 * 상대 `.xlsx` 경로 → 도우미 주소. 규칙에 어긋나면 null — 주소를 지어내지 않는다.
 * 되읽어 같은 글자가 나오는 것까지 본다(짝이 없는 UTF-16 반쪽은 UTF-8 로 옮기면 달라진다).
 * base64url 한 벌은 폴더 주소와 **같은 것**을 쓴다(갈라지면 비표준 표기가 생긴다).
 */
export function buildQuoteFolderXlsx2PdfLink(relativePath: string): string | null {
  if (!isQuoteFolderXlsx2PdfSourcePath(relativePath)) return null;
  const encoded = quoteFolderLinkEncodeBytes(new TextEncoder().encode(relativePath));
  const link = `${QUOTE_FOLDER_XLSX2PDF_LINK_PREFIX}${encoded}`;
  return parseQuoteFolderXlsx2PdfLink(link) === relativePath ? link : null;
}

/** 도우미 주소 → 상대 `.xlsx` 경로. 모양 · 인코딩 · 경로 규칙 · 확장자 하나라도 어긋나면 null. */
export function parseQuoteFolderXlsx2PdfLink(link: unknown): string | null {
  if (typeof link !== "string" || !link.startsWith(QUOTE_FOLDER_XLSX2PDF_LINK_PREFIX)) return null;
  const encoded = link.slice(QUOTE_FOLDER_XLSX2PDF_LINK_PREFIX.length);
  if (encoded.length > QUOTE_FOLDER_LINK_MAX_ENCODED_LENGTH) return null;
  const bytes = quoteFolderLinkDecodeBytes(encoded);
  if (bytes === null) return null;
  let relativePath: string;
  try {
    relativePath = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return null;
  }
  return isQuoteFolderXlsx2PdfSourcePath(relativePath) ? relativePath : null;
}
