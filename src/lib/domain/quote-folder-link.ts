/**
 * ============================================================================
 * 「견적서 폴더 열기」 도우미 주소 — `dss-folder://open/?p=<base64url>` (순수 — 서버 · 화면 · 시험이 함께 쓴다)
 * ============================================================================
 * 브라우저는 웹 페이지에서 Windows 탐색기를 직접 열 수 없다. 그래서 PC 마다 한 번 설치하는
 * 도우미(server/quote-folder-helper.ts 가 만드는 open-dss-folder.ps1)가 이 사용자 정의 주소를
 * 받아 **공유폴더 루트 아래의 폴더만** 탐색기로 연다.
 *
 * ── 주소에는 상대 경로만 싣는다 ──────────────────────────────────────────
 * 루트(`\\NAS이름\공유이름\…`)는 설치 때 도우미 스크립트에 박힌다 — 웹 페이지가 바꿀 수 없다.
 * 주소는 그 루트 아래의 상대 경로(`연도 폴더/견적서 폴더`, 구분자 `/`)만 나른다.
 *
 * ── 왜 base64url 로 싸는가 ────────────────────────────────────────────────
 * 폴더 이름에는 공백 · 한글 · `%` · `&` · 따옴표가 들어간다. 주소를 그대로 두면 브라우저 ·
 * Windows 셸 · 명령줄을 지나며 퍼센트 인코딩 · 따옴표 해석이 끼어든다. UTF-8 바이트를
 * base64url(`A-Z a-z 0-9 - _`, 채움 `=` 없음)로 싸면 명령줄에는 이 글자들만 간다.
 *
 * ── 🔴 이 주소는 다른 웹사이트도 부를 수 있다 ─────────────────────────────
 * 그래서 되읽기는 엄격하다. 아래 규칙(checkQuoteFolderRelativePath)은 도우미 스크립트가
 * **같은 규칙**으로 한 번 더 본다(두 곳의 규칙은 quote-folder-helper.test.ts 가 맞춰 본다).
 *   · 빈 값 · 길이 상한(QUOTE_FOLDER_RELATIVE_PATH_MAX_LENGTH, UTF-16 단위) 초과
 *   · 제어문자(C0 · DEL · C1)
 *   · 절대 경로 — `/` 로 시작 · 드라이브 문자(`C:`) · UNC(`\\`)
 *   · Windows 가 이름에 허용하지 않는 글자 `\ : * ? " < > |` — 구분자는 `/` 뿐이다
 *   · 빈 마디(`a//b` · 끝의 `/`) · `.` · `..` 마디
 *   · 끝이 점 · 공백인 마디 — Windows 가 조용히 떼어 다른 이름이 되기 때문이다(`.. ` 같은 꼼수도 여기서 막힌다)
 * base64url 도 표준 모양만 받는다(알파벳 밖 · 길이 나머지 1 · 다시 싸면 달라지는 값 거절),
 * UTF-8 이 아닌 바이트도 거절한다.
 * ============================================================================
 */

/** 도우미가 받는 주소의 앞부분. 뒤에 base64url 로 싼 상대 경로가 붙는다. */
export const QUOTE_FOLDER_LINK_PREFIX = "dss-folder://open/?p=";

/**
 * 상대 경로 길이 상한(UTF-16 단위 — JavaScript 의 length 와 PowerShell 의 Length 가 같게 센다).
 * 탐색기 경로 한도(260)보다 넉넉하다 — 사람이 만든 긴 폴더 이름도 여기서 막히지 않게.
 */
export const QUOTE_FOLDER_RELATIVE_PATH_MAX_LENGTH = 512;

/** 상대 경로 상한을 UTF-8(글자당 최대 3바이트 — UTF-16 한 단위는 3바이트를 넘지 않는다)로 싼 최대 길이. */
export const QUOTE_FOLDER_LINK_MAX_ENCODED_LENGTH = Math.ceil((QUOTE_FOLDER_RELATIVE_PATH_MAX_LENGTH * 3 * 4) / 3);

/** Windows 가 이름에 허용하지 않는 글자. 구분자는 `/` 뿐이라 `\` 도 여기 든다. */
export const QUOTE_FOLDER_FORBIDDEN_CHARACTERS = ["\\", ":", "*", "?", '"', "<", ">", "|"] as const;

export type QuoteFolderPathRejection =
  | "EMPTY"
  | "TOO_LONG"
  | "CONTROL_CHARACTER"
  | "ABSOLUTE"
  | "FORBIDDEN_CHARACTER"
  | "EMPTY_SEGMENT"
  | "DOT_SEGMENT"
  | "TRAILING_DOT_OR_SPACE";

function isControlCodePoint(codePoint: number): boolean {
  return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f);
}

/** 상대 경로를 거절할 까닭 — 받아들이면 null. 규칙은 머리말. */
export function checkQuoteFolderRelativePath(value: unknown): QuoteFolderPathRejection | null {
  if (typeof value !== "string" || value.length === 0) return "EMPTY";
  if (value.length > QUOTE_FOLDER_RELATIVE_PATH_MAX_LENGTH) return "TOO_LONG";
  for (let index = 0; index < value.length; index += 1) {
    if (isControlCodePoint(value.charCodeAt(index))) return "CONTROL_CHARACTER";
  }
  if (value.startsWith("/") || value.startsWith("\\") || /^[A-Za-z]:/.test(value)) return "ABSOLUTE";
  for (const character of QUOTE_FOLDER_FORBIDDEN_CHARACTERS) {
    if (value.includes(character)) return "FORBIDDEN_CHARACTER";
  }
  for (const segment of value.split("/")) {
    if (segment.length === 0) return "EMPTY_SEGMENT";
    if (segment === "." || segment === "..") return "DOT_SEGMENT";
    if (segment.endsWith(".") || segment.endsWith(" ")) return "TRAILING_DOT_OR_SPACE";
  }
  return null;
}

export function isQuoteFolderRelativePath(value: unknown): value is string {
  return checkQuoteFolderRelativePath(value) === null;
}

const BASE64URL_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** 바이트 → base64url(채움 없음). Buffer 없이 — 화면(브라우저)에서도 돈다. */
function bytesToBase64Url(bytes: Uint8Array): string {
  let out = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const second = index + 1 < bytes.length ? bytes[index + 1] : 0;
    const third = index + 2 < bytes.length ? bytes[index + 2] : 0;
    const triple = (bytes[index] << 16) | (second << 8) | third;
    out += BASE64URL_ALPHABET[(triple >> 18) & 63] + BASE64URL_ALPHABET[(triple >> 12) & 63];
    if (index + 1 < bytes.length) out += BASE64URL_ALPHABET[(triple >> 6) & 63];
    if (index + 2 < bytes.length) out += BASE64URL_ALPHABET[triple & 63];
  }
  return out;
}

/** base64url(채움 없음) → 바이트. 표준 모양이 아니면 null — 다시 싸서 같은 글자가 나와야 한다. */
function base64UrlToBytes(text: string): Uint8Array | null {
  if (text.length === 0 || text.length % 4 === 1 || !/^[A-Za-z0-9_-]+$/.test(text)) return null;
  const bytes = new Uint8Array(Math.floor((text.length * 3) / 4));
  let buffer = 0;
  let bits = 0;
  let written = 0;
  for (const character of text) {
    buffer = (buffer << 6) | BASE64URL_ALPHABET.indexOf(character);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes[written] = (buffer >> bits) & 0xff;
      written += 1;
    }
    buffer &= (1 << bits) - 1;
  }
  // 남은 비트가 0 이 아닌 값(같은 바이트의 다른 표기)은 받지 않는다.
  return bytesToBase64Url(bytes) === text ? bytes : null;
}

/**
 * 상대 경로 → 도우미 주소. 규칙에 어긋나는 경로(서버가 찾은 폴더 이름이 탐색기로 열 수 없는
 * 모양인 경우 등)면 null — 부르는 쪽이 사람에게 알린다.
 */
export function buildQuoteFolderLink(relativePath: string): string | null {
  if (!isQuoteFolderRelativePath(relativePath)) return null;
  const encoded = bytesToBase64Url(new TextEncoder().encode(relativePath));
  // 짝이 없는 UTF-16 반쪽은 UTF-8 로 옮기면 다른 글자(U+FFFD)가 된다 — 되읽어 같아야 한다.
  if (parseQuoteFolderLink(`${QUOTE_FOLDER_LINK_PREFIX}${encoded}`) !== relativePath) return null;
  return `${QUOTE_FOLDER_LINK_PREFIX}${encoded}`;
}

/** 도우미 주소 → 상대 경로. 모양 · 인코딩 · 경로 규칙 가운데 하나라도 어긋나면 null. */
export function parseQuoteFolderLink(link: unknown): string | null {
  if (typeof link !== "string" || !link.startsWith(QUOTE_FOLDER_LINK_PREFIX)) return null;
  const encoded = link.slice(QUOTE_FOLDER_LINK_PREFIX.length);
  if (encoded.length > QUOTE_FOLDER_LINK_MAX_ENCODED_LENGTH) return null;
  const bytes = base64UrlToBytes(encoded);
  if (bytes === null) return null;
  let relativePath: string;
  try {
    relativePath = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return null;
  }
  return isQuoteFolderRelativePath(relativePath) ? relativePath : null;
}
