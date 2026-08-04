// 파일명/확장자 관련 순수 함수. validation.ts, seed-data.ts, actions.ts,
// 폼 컴포넌트가 모두 이 함수만을 통해 확장자를 파생시킨다(중복 구현 금지).

const CONTROL_CHAR_PATTERN = /[\x00-\x1F\x7F]/;
/** 슬래시/역슬래시/".." 상위 경로 이동 패턴을 모두 금지한다. 파일명은 경로가 아니다. */
const PATH_TRAVERSAL_PATTERN = /(\.\.|[\\/])/;

export const MAX_FILE_NAME_LENGTH = 255;
export const MAX_DISPLAY_NAME_LENGTH = 255;
export const MAX_DESCRIPTION_LENGTH = 500;
export const MAX_DELETION_REASON_LENGTH = 300;

/** 실제 실행 파일 확장자 차단 목록(2차 방어선). 허용목록에도 이미 포함되어 있지 않다. */
export const EXECUTABLE_EXTENSION_DENYLIST = new Set([
  "exe",
  "bat",
  "cmd",
  "sh",
  "msi",
  "dll",
  "scr",
  "ps1",
  "vbs",
  "jar",
  "app",
  "com",
  "cpl",
  "gadget",
  "wsf",
  "wsh",
  "js",
  "jse",
  "vbe",
  "apk",
]);

export function isSafeFileNameString(
  value: unknown,
  maxLength: number = MAX_FILE_NAME_LENGTH
): value is string {
  if (typeof value !== "string") return false;
  if (value !== value.trim()) return false;
  if (value.length === 0 || value.length > maxLength) return false;
  if (CONTROL_CHAR_PATTERN.test(value)) return false;
  if (PATH_TRAVERSAL_PATTERN.test(value)) return false;
  return true;
}

/**
 * 파일명 끝의 "확장자"를 소문자로 파생한다. 점이 없거나("README"), 맨 앞이
 * 점이거나(숨김 파일 ".gitignore"), 맨 끝이 점이면 확장자가 없는 것으로
 * 취급해 null을 반환한다.
 */
export function deriveExtensionFromFileName(fileName: string): string | null {
  const lastDot = fileName.lastIndexOf(".");
  if (lastDot <= 0 || lastDot === fileName.length - 1) return null;
  return fileName.slice(lastDot + 1).toLowerCase();
}

export function hasExecutableExtension(extension: string): boolean {
  return EXECUTABLE_EXTENSION_DENYLIST.has(extension.toLowerCase());
}
