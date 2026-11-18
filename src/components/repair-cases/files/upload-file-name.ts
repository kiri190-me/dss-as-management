import {
  MAX_DISPLAY_NAME_LENGTH,
  MAX_FILE_NAME_LENGTH,
  isSafeFileNameString,
} from "@/lib/domain/local/attachments/filename";
import type { HeicRename } from "./heic-upload";

/**
 * ============================================================================
 * 올릴 때 **파일 이름을 미리 정한다** — 여러 장이면 (1) (2) 번호 (2026-11-18)
 * ============================================================================
 * 사용자 요청: 「[설명 (선택)]을 없애고 [파일 이름(선택)]으로 바꿔줘. 그 의미는
 * 저장되는 파일의 이름을 설정하는 거고 거기에 작성되는 이름에 (1), (2) 로 번호가
 * 붙도록 해줘.」 번호 규칙은 그 뒤 셋으로 정해졌다:
 *   · 한 장만 올리면 번호를 **안 붙인다** — `점검사진`
 *   · 여러 장이면 `점검사진 (1)` · `점검사진 (2)` · `점검사진 (3)`
 *   · 비워 두면 **지금까지와 똑같다** — 고른 파일의 이름이 그대로 올라간다
 *
 * ── 🔴 여기서 정하는 이름이 **두 곳**에 쓰인다 ──────────────────────────────
 * 이 이름은 올리기 통로의 `fileName` 질의값이 되고, 서버에서 `originalFileName`
 * 칸에 그대로 앉는다(api/repair-cases/[id]/attachments/route.ts). 그 값이 가는 곳은
 * 둘이다 — **표시 이름**(목록 · 뷰어 · 내려받을 때의 Content-Disposition)과
 * **연락서 폴더에 실제로 적히는 파일 이름**(storage/contact-folder-archive.ts 가
 * `contactFolderCopyFileName` 으로 다듬어 쓴다). 시스템 창고 쪽 디스크 이름은 여전히
 * 첨부 ID(UUID)라 이 값과 무관하다.
 *   🔴 그래서 **경로 글자를 반드시 막아야 한다.** 표시만 하는 값이면 `/` 가 섞여도
 *      글자가 이상할 뿐이지만, 이 값은 사람의 공유폴더에 파일로 적힌다. 막는 자리는
 *      새로 짓지 않고 이미 있는 것을 그대로 쓴다 — `isSafeFileNameString`
 *      (제어문자 · `/` · `\` · `..` · 길이). 「표시 이름 변경」 창이 쓰는 그 함수다
 *      (EditMetadataDialog.tsx · actions.ts 의 renameAttachment).
 *
 * ── 🔴 확장자는 **고른 파일의 것**을 붙인다 ─────────────────────────────────
 * 사람은 `점검사진` 이라고만 적는다. 그대로 보내면 서버가 확장자를 못 뽑아
 * (`normalizeFileExtension`) 415 로 되돌려보낸다 — 그 통로는 확장자로 허용목록과
 * 저장 경로와 앞머리 바이트 대조를 전부 정한다. 그래서 적힌 이름은 **줄기**로만 쓰고
 * 확장자는 보내는 파일에서 떼어다 붙인다.
 *   · `점검사진` + `IMG_1234.jpg` → `점검사진.jpg`
 *   · 사람이 확장자까지 적었으면(`점검사진.jpg`) **두 번 붙이지 않는다** — 끝이 같은
 *     확장자면 그 자리를 줄기의 끝으로 본다. 대소문자는 접어서 본다(`.JPG` 도 같다).
 *   · 확장자가 다르면 그대로 둔다 — `보고서.v2` + `a.jpg` → `보고서.v2.jpg`. 「.v2」는
 *     사람이 적은 이름의 일부이고, 진짜 확장자는 파일이 말하는 쪽이다.
 *   🔴 **이것이 「표시 이름 변경」 창과 다른 점이고, 달라야 하는 까닭이 있다.** 그 창은
 *      적은 글자를 그대로 둔다 — 데모 쪽 기록은 `displayName` 과 `fileExtension` 이
 *      **다른 칸**이라 확장자를 건드릴 일이 없다(actions.ts 의 renameAttachment 머리말
 *      「originalFileName/fileExtension/mimeType은 절대 건드리지 않는다」). 여기는 칸이
 *      하나뿐이라 확장자가 그 안에 들어 있어야 한다. 막는 규칙(isSafeFileNameString)은
 *      같은 것을 쓰고, 다른 것은 확장자를 붙이는 일 하나뿐이다.
 *
 * ── 🔴 heic 와의 차례 — 바꾼 **뒤에** 이름을 정한다 ─────────────────────────
 * 아이폰 사진은 보내기 전에 jpg 로 구워진다(heic-upload.ts). 이름 짓기는 그 **뒤**에
 * 돌아서, 확장자가 `.heic` 가 아니라 `.jpg` 로 붙는다:
 *   `점검사진.heic` 를 고르고 이름에 `보고서` 를 적으면 → `보고서.jpg`
 * 반대 차례로 두면 `보고서.heic` 라는 이름으로 jpeg 바이트를 보내게 되고, 서버의
 * 내용 대조에서 그대로 막힌다(CONTENT_MISMATCH).
 *   🔴 그래서 **바뀐 이름을 알리는 줄도 다시 쓴다**(heicRenamesWithUploadNames).
 *      그 줄은 「IMG_1234.HEIC → IMG_1234.jpg」처럼 적히는데, 이름을 적어 두면 목록에
 *      뜨는 것은 `보고서.jpg` 라서 그 안내가 **거짓말**이 된다. 사람이 제 사진을 못
 *      찾게 하지 않으려고 만든 줄이 거꾸로 못 찾게 만든다.
 *
 * ── 🔵 번호는 **고른 차례**다 ───────────────────────────────────────────────
 * 보내기 직전에 한 장이 거절되면(분류가 안 받는 형식 · 20MB 초과) 번호가 하나 빈다 —
 * `(1)` 과 `(3)` 만 올라간다. 메우지 않는다: 빠진 장이 무엇이고 왜 빠졌는지는 올리기
 * 알림이 한 줄로 말하고, 그 줄과 번호가 어긋나면 사람이 두 번 세어야 한다.
 * ============================================================================
 */

/** 적은 이름에 쓸 수 없는 글자가 있을 때. 막는 규칙은 `isSafeFileNameString` 그대로다. */
export const UPLOAD_FILE_NAME_INVALID_MESSAGE =
  "파일 이름에 쓸 수 없는 글자가 있습니다 — / \\ .. 와 제어문자는 쓸 수 없습니다.";

/** 번호와 확장자까지 붙이고 나면 상한을 넘을 때. */
export const UPLOAD_FILE_NAME_TOO_LONG_MESSAGE =
  `파일 이름이 너무 깁니다 — 번호와 확장자까지 합쳐 ${MAX_FILE_NAME_LENGTH}자 안에 들어와야 합니다.`;

/**
 * 파일 이름 칸의 **글자 수 상한**(화면의 `maxLength`). 표시 이름 상한과 같은 값을 쓴다 —
 * 여기서 한 자 더 줄여 봐야 번호·확장자가 붙어 넘는 것은 아래 검사가 잡는다.
 */
export const UPLOAD_FILE_NAME_MAX_LENGTH = MAX_DISPLAY_NAME_LENGTH;

/**
 * 이름 끝의 확장자를 **점까지 함께** 떼어 온다. 없으면 빈 글자다.
 *
 * 경계는 공용 함수와 **같다**(`deriveExtensionFromFileName` — 점이 없거나, 맨 앞이
 * 점이거나(`.gitignore`), 맨 끝이 점이면 확장자가 아니다). 그 함수를 그대로 쓰지 않는
 * 까닭은 하나뿐이다: 그쪽은 소문자로 접어서 돌려주는데, 여기서 필요한 것은 **고른
 * 파일이 쓰던 그대로의 글자**다. `IMG_1234.JPG` 를 고른 사람의 목록에 `.jpg` 가 뜨면
 * 자기가 올린 것이 맞는지 한 번 더 들여다보게 된다. (서버의 판정은 어차피 접어서 한다.)
 */
function extensionSuffixOf(fileName: string): string {
  const lastDot = fileName.lastIndexOf(".");
  if (lastDot <= 0 || lastDot === fileName.length - 1) return "";
  return fileName.slice(lastDot);
}

/**
 * 적은 이름이 이미 그 확장자로 끝나면 그 자리를 줄기의 끝으로 본다(대소문자를 접는다).
 *
 * 🔴 떼고 나서 **줄기가 비면 떼지 않는다.** `.jpg` 만 적은 사람은 `.jpg.jpg` 를 받게
 * 되는데, 이상해 보여도 그쪽이 맞다 — 떼면 이름이 `.jpg`(또는 ` (1).jpg`)가 되고,
 * 맨 앞의 점은 확장자 구분자가 아니라서(`deriveExtensionFromFileName`) 서버가 확장자를
 * 아예 못 뽑아 **415 로 되돌려보낸다.** 이름 한 줄 때문에 못 올리게 되는 쪽이 나쁘다.
 */
function stemOf(baseName: string, extensionSuffix: string): string {
  if (extensionSuffix.length === 0) return baseName;
  if (baseName.length <= extensionSuffix.length) return baseName;
  const tail = baseName.slice(-extensionSuffix.length);
  return tail.toLowerCase() === extensionSuffix.toLowerCase()
    ? baseName.slice(0, -extensionSuffix.length)
    : baseName;
}

/**
 * 적은 이름 자체가 쓸 수 있는가 — **고른 파일을 보기 전에** 묻는 것이다.
 * 쓸 수 있으면 null, 아니면 사람이 읽을 한 줄.
 *
 * 🔴 화면이 이것을 **아이폰 사진을 굽기 전에** 부른다. 큰 사진 몇 장을 몇 초씩 들여
 * 바꾼 **뒤에** 「이름에 / 가 있습니다」로 되돌리는 것이 가장 나쁘다.
 *
 * 공백만 적은 것은 **안 적은 것과 같다**(null) — 아래 이름 짓기가 그때 원래 이름을
 * 그대로 쓴다. 두 자리가 같은 판정을 쓰도록 `trim()` 한 값으로만 본다.
 */
export function uploadFileNameError(baseName: string): string | null {
  const base = baseName.trim();
  if (base.length === 0) return null;
  if (base.length > UPLOAD_FILE_NAME_MAX_LENGTH) return UPLOAD_FILE_NAME_TOO_LONG_MESSAGE;
  if (!isSafeFileNameString(base, UPLOAD_FILE_NAME_MAX_LENGTH)) {
    return UPLOAD_FILE_NAME_INVALID_MESSAGE;
  }
  return null;
}

export type UploadFileNamesResult =
  /** 보낼 때 쓸 이름들. 받은 `fileNames` 와 **같은 길이 · 같은 차례**다. */
  | { ok: true; names: string[] }
  | { ok: false; message: string };

/**
 * 보낼 파일들의 **최종 이름**을 정한다.
 *
 * `fileNames` 는 **지금 보내려는 파일들의 이름**이다 — 아이폰 사진을 구운 **뒤**의
 * 목록이어야 한다(머리말의 차례). 확장자를 거기서 떼어 오기 때문이다.
 */
export function uploadFileNamesFor(input: {
  baseName: string;
  fileNames: readonly string[];
}): UploadFileNamesResult {
  const base = input.baseName.trim();
  // 🔴 안 적었으면 **한 글자도 달라지지 않는다** — 고른 이름이 그대로 올라간다.
  if (base.length === 0) return { ok: true, names: [...input.fileNames] };

  const error = uploadFileNameError(base);
  if (error) return { ok: false, message: error };

  // 🔴 한 장이면 번호가 없다. 분모는 **보내는 장 수**이고, 못 바꾼 아이폰 사진은 이미
  //    여기 오기 전에 빠져 있다 — 세 장을 골라 하나가 못 바뀌면 (1)(2) 두 장이다.
  const numbered = input.fileNames.length > 1;
  const names = input.fileNames.map((fileName, index) => {
    const suffix = extensionSuffixOf(fileName);
    const tail = numbered ? ` (${index + 1})` : "";
    return `${stemOf(base, suffix)}${tail}${suffix}`;
  });

  // 번호 꼬리와 확장자까지 붙은 **최종 이름**으로 잰다. 서버도 이 값으로 잰다
  // (MAX_ORIGINAL_FILE_NAME_LENGTH = 255) — 여기서 안 막으면 거기서 400 이 된다.
  if (names.some((name) => name.length > MAX_FILE_NAME_LENGTH)) {
    return { ok: false, message: UPLOAD_FILE_NAME_TOO_LONG_MESSAGE };
  }
  return { ok: true, names };
}

/**
 * 「아이폰 사진 N장을 jpg 로 바꿔서 올렸습니다 — A → B」 줄의 **B 를 최종 이름으로**
 * 갈아 끼운다. 이름을 안 적었으면 받은 그대로 돌려준다(B 가 이미 최종 이름이다).
 *
 * 🔴 **차례로 맞춘다.** `convertPickedHeic` 은 고른 차례를 그대로 지키므로, 바뀐 쌍의
 * `to` 는 보낼 목록(`fileNames`)에 **같은 차례로** 나타난다. 그래서 앞에서부터 한 번만
 * 훑으면 짝이 어긋나지 않는다 — 같은 이름이 두 장 섞여 있어도 앞의 것이 앞의 것과
 * 짝지어진다.
 *
 * 🔵 못 찾으면 받은 `to` 를 그대로 둔다. 안내 한 줄 때문에 올리기를 멈출 일이 아니고,
 *    지어낸 이름을 적는 것보다는 바꾸기 전 이름이 낫다.
 */
export function heicRenamesWithUploadNames(
  renamed: readonly HeicRename[],
  fileNames: readonly string[],
  uploadNames: readonly string[]
): HeicRename[] {
  if (uploadNames.length !== fileNames.length) return [...renamed];
  let cursor = 0;
  return renamed.map((pair) => {
    while (cursor < fileNames.length && fileNames[cursor] !== pair.to) cursor += 1;
    if (cursor >= fileNames.length) return pair;
    const to = uploadNames[cursor];
    cursor += 1;
    return { from: pair.from, to };
  });
}
