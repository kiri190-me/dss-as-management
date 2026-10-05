import {
  QUOTE_FOLDER_LINK_MAX_ENCODED_LENGTH,
  checkQuoteFolderRelativePath,
  quoteFolderLinkDecodeBytes,
  quoteFolderLinkEncodeBytes,
  type QuoteFolderPathRejection,
} from "./quote-folder-link";

/**
 * ============================================================================
 * 「파일 열기」 도우미 주소 — `dss-folder://openfile/?p=<base64url>` (순수 — 서버 · 화면 · 시험이 함께 쓴다)
 * ============================================================================
 * 공유폴더 안의 **파일 하나**를 그 PC 의 연결 프로그램(엑셀 · PDF 뷰어 · 한글 …)으로 연다.
 * 탐색기에서 그 파일을 더블클릭하는 것과 같은 일이다.
 *
 * ── 🔴 새 스킴을 만들지 않는다 — 기존 스킴에 **동작 하나**를 더했다 ──────────
 * 레지스트리 자리가 `HKCU\Software\Classes\dss-folder` **하나**다. 새 스킴(`dss-file://` 등)을
 * 만들면 설치가 두 벌이 되고 사람에게 설치를 두 번 부탁해야 한다. 접두어만 바꾸면 **같은
 * 스크립트 · 같은 설치 명령 한 번**으로 끝난다.
 *   폴더:  dss-folder://open/?p=<base64url(상대 폴더경로)>      ← quote-folder-link.ts (그대로)
 *   파일:  dss-folder://openfile/?p=<base64url(상대 파일경로)>  ← 이 파일
 * 🔴 견적서 · 현황표가 쓰는 `open/` 쪽은 한 글자도 바뀌지 않았다.
 *
 * ── 🔴 상대 경로 규칙은 그대로 재사용한다 ────────────────────────────────
 * checkQuoteFolderRelativePath 를 그대로 거친다(빈 값 · 길이 · 제어문자 · 절대 경로 ·
 * Windows 금지 글자 · 빈 마디 · `.` `..` 마디 · 끝이 점 · 공백인 마디). 그 위에 **파일에만
 * 필요한 둘**을 더한다:
 *   · 🔴 확장자 **허용 목록** — 목록 밖은 전부 거절. 거절 목록이 아니다(아래).
 *   · 🔴 확장자 없는 이름 거절 — `문서` 처럼 점이 없는 이름.
 * base64url 인코딩도 폴더 주소와 **같은 한 벌**을 쓴다(quoteFolderLinkEncodeBytes · …Decode…).
 *
 * ── 🔴 왜 허용 목록인가 (거절 목록이 아니다) ──────────────────────────────
 * `.exe` 류를 세는 방식은 Windows 가 실행하는 확장자를 **하나라도 빠뜨리면 끝난다**
 * (`.lnk` · `.url` · `.scf` · `.pif` · `.hta` · `.cpl` · `.msc` · PATHEXT 로 늘어나는 것들 …).
 * 그래서 「무엇을 막을까」가 아니라 「무엇만 열까」로 적는다. 목록에 없으면 거절이다.
 *
 * ── 🔴 왜 `.xlsm`(매크로 통합 문서)이 들어 있나 (사용자 결정 2026-10-05) ───
 * 연락서 **원본이 .xlsm** 이다 — 못 열면 이 기능의 뜻이 없다.
 * 🔴 올리기 허용목록(domain/attachment-allowlist.ts)은 `.xlsm` 을 **막는다. 이것은 다른
 * 판단이다.** 저쪽은 바깥에서 들어온 파일을 **우리 창고(UPLOADS_DIR · DB)에 받아 두는** 일이라
 * 받아 두는 순간 우리가 책임지는 물건이 된다. 이쪽은 **이미 사람의 서류함(사내 공유폴더)에
 * 있는 파일**을 그 사람의 PC 에서 더블클릭하는 것과 같은 일이고, 그 파일은 우리를 거치지
 * 않고도 탐색기로 열리고 있었다. 두 목록은 **일부러** 다르다 — 한쪽을 다른 쪽에 맞추지 말 것.
 *
 * ── 🔴 남는 위험 ─────────────────────────────────────────────────────────
 * 이 주소도 **아무 웹페이지나 부를 수 있다.** 악성 페이지가 공유폴더 안 **문서**를 열게 할 수
 * 있다(그 사람이 이미 열 수 있는 문서다). 실행 파일 · 바로 가기는 목록 밖이라 막히지만 위험이
 * 0 은 아니다. 그래서 검사를 **서버 · 화면에서 끝내지 않고 PowerShell 도우미가 다시 한다**
 * (server/quote-folder-helper.ts 의 검사 일곱 — 그쪽이 마지막 울타리다).
 * ============================================================================
 */

/** 도우미가 받는 **파일 열기** 주소의 앞부분. 뒤에 base64url 로 싼 상대 경로가 붙는다. */
export const QUOTE_FOLDER_FILE_LINK_PREFIX = "dss-folder://openfile/?p=";

/**
 * 🔴 **열 수 있는 확장자 — 이 목록 밖은 전부 거절한다**(사용자 결정 2026-10-05).
 * 소문자로 적고, 비교할 때 접어서 본다(`.PDF` 도 같은 것, `.EXE` 도 당연히 거절).
 *
 * 🔴 **PowerShell 도우미 안에도 같은 목록이 글자 그대로 박힌다**
 * (server/quote-folder-helper.ts 의 `$OpenableExtensions`). 두 벌이 같은지는
 * quote-folder-helper.test.ts 가 스크립트 본문에서 목록을 도로 꺼내 맞춰 본다 —
 * 상대 경로 규칙을 TS · PS 양쪽에 두고 맞춰 보는 것과 같은 방식이다.
 */
export const QUOTE_FOLDER_OPENABLE_EXTENSIONS: readonly string[] = [
  "xlsx",
  "xls",
  "xlsm",
  "pdf",
  "docx",
  "doc",
  "pptx",
  "ppt",
  "hwp",
  "hwpx",
  "jpg",
  "jpeg",
  "png",
  "gif",
  "bmp",
  "txt",
  "csv",
  "zip",
];

export type QuoteFolderFileRejection =
  | QuoteFolderPathRejection
  /** 점이 없다(`문서`) · 점이 맨 앞이다(`.pdf`) — 확장자가 없는 것으로 본다. */
  | "NO_EXTENSION"
  /** 허용 목록 밖이다. */
  | "EXTENSION_NOT_ALLOWED";

/**
 * 파일 이름에서 확장자를 뽑아 접는다 — 맨 뒤 점 뒤. 점이 없거나 맨 앞이면 null.
 * `toLowerCase` 는 지역 설정과 무관하다(`toLocaleLowerCase` 가 아니다).
 */
function foldedExtensionOf(name: string): string | null {
  const dot = name.lastIndexOf(".");
  if (dot < 1 || dot === name.length - 1) return null;
  return name.slice(dot + 1).toLowerCase();
}

/** 접은 확장자가 허용 목록에 있는가. */
export function isOpenableQuoteFolderExtension(extension: string): boolean {
  return QUOTE_FOLDER_OPENABLE_EXTENSIONS.includes(extension.toLowerCase());
}

/**
 * 열 수 있는 **파일 상대 경로**인가 — 거절할 까닭을 돌려준다(받아들이면 null).
 * 상대 경로 규칙을 먼저 그대로 거치고, 맨 뒤 마디(파일 이름)의 확장자를 본다.
 *
 * 🔴 `보고서.pdf.` · `보고서.pdf ` 처럼 끝에 점 · 공백이 붙은 이름은 **상대 경로 규칙**이
 * 먼저 막는다(TRAILING_DOT_OR_SPACE) — Windows 가 조용히 떼어 `.pdf` 가 아닌 것을 열 수 있다.
 */
export function checkQuoteFolderOpenableFilePath(value: unknown): QuoteFolderFileRejection | null {
  const pathRejection = checkQuoteFolderRelativePath(value);
  if (pathRejection !== null) return pathRejection;
  const segments = (value as string).split("/");
  const name = segments[segments.length - 1];
  const extension = foldedExtensionOf(name);
  if (extension === null) return "NO_EXTENSION";
  return QUOTE_FOLDER_OPENABLE_EXTENSIONS.includes(extension) ? null : "EXTENSION_NOT_ALLOWED";
}

export function isOpenableQuoteFolderFilePath(value: unknown): value is string {
  return checkQuoteFolderOpenableFilePath(value) === null;
}

/**
 * 🔴 **화면이 쓰는 물음** — 목록의 한 줄(폴더 안에서의 이름 하나)에 [열기]를 그릴 것인가.
 * 이름 하나는 마디 하나짜리 상대 경로이므로 위 검사를 그대로 쓴다.
 */
export function isOpenableQuoteFolderFileName(name: unknown): boolean {
  return typeof name === "string" && !name.includes("/") && isOpenableQuoteFolderFilePath(name);
}

/**
 * 상대 파일 경로 → 도우미 주소. 규칙 · 허용 목록에 어긋나면 null — 주소를 지어내지 않는다.
 * 되읽어 같은 글자가 나오는 것까지 본다(짝이 없는 UTF-16 반쪽은 UTF-8 로 옮기면 달라진다).
 */
export function buildQuoteFolderFileLink(relativePath: string): string | null {
  if (!isOpenableQuoteFolderFilePath(relativePath)) return null;
  const encoded = quoteFolderLinkEncodeBytes(new TextEncoder().encode(relativePath));
  const link = `${QUOTE_FOLDER_FILE_LINK_PREFIX}${encoded}`;
  return parseQuoteFolderFileLink(link) === relativePath ? link : null;
}

/** 도우미 주소 → 상대 파일 경로. 모양 · 인코딩 · 경로 규칙 · 허용 목록 하나라도 어긋나면 null. */
export function parseQuoteFolderFileLink(link: unknown): string | null {
  if (typeof link !== "string" || !link.startsWith(QUOTE_FOLDER_FILE_LINK_PREFIX)) return null;
  const encoded = link.slice(QUOTE_FOLDER_FILE_LINK_PREFIX.length);
  if (encoded.length > QUOTE_FOLDER_LINK_MAX_ENCODED_LENGTH) return null;
  const bytes = quoteFolderLinkDecodeBytes(encoded);
  if (bytes === null) return null;
  let relativePath: string;
  try {
    relativePath = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return null;
  }
  return isOpenableQuoteFolderFilePath(relativePath) ? relativePath : null;
}
