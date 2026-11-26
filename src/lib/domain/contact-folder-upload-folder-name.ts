import {
  CONTACT_FOLDER_UPLOAD_FOLDER_MAX_NAME_LENGTH,
  contactFolderUploadFolderName,
} from "./contact-folder-naming";
import { isSafeFileNameString } from "./local/attachments/filename";
import { isIgnoredShareFolderEntryName } from "./share-folder-naming";

/**
 * ============================================================================
 * [파일 올리기]의 **「폴더 이름 (선택)」** — 쓸 수 있는 이름인가 (2026-11-26)
 * ============================================================================
 * 이 칸은 두 번 뜻이 바뀌었다. 내력을 그대로 적어 둔다 — 같은 자리가 또 바뀔 때 무엇이
 * 왜 없어졌는지 알아야 한다.
 *
 *  · ~2026-11-18  「설명 (선택)」 — 올린 파일에 한 줄 적는 칸.
 *  · 2026-11-18   「파일 이름 (선택)」 — 「그 의미는 저장되는 파일의 이름을 설정하는
 *                 거고 거기에 작성되는 이름에 (1), (2) 로 번호가 붙도록 해줘.」
 *  · 2026-11-26   「폴더 이름 (선택)」 — 🔴 **지금**이다. 사용자 요청 그대로:
 *                 「파일 이름이 아니라 폴더 이름을 적는 자리로 바꿔서, 적힌 폴더
 *                   이름으로 분류 폴더 아래에 폴더를 만들고 파일은 그 안에 저장되도록
 *                   해줘. (안 적혀 있다면 그대로 분류 안에 저장되면 돼.)」
 *
 * 🔴 **파일 이름을 정하는 기능은 없어졌다.** 2026-11-18 의 번호 규칙((1)(2)) · 확장자
 * 붙이기 · 그 한 벌(components/repair-cases/files/upload-file-name.ts)이 통째로 빠졌고,
 * 올리는 파일은 **고른 이름 그대로** 올라간다(2026-11-18 이전과 같다). 까닭은 하나다 —
 * 번호를 붙일 **바탕 이름**이 더 이상 없다. 같은 이름이 겹칠 때의 ` (2)` 는 여전히
 * 있지만 그것은 연락서 폴더 쪽의 **덮어쓰기 방지**이고(storage/contact-folder-archive.ts),
 * 사람이 적은 이름에 붙이던 번호와는 다른 것이다.
 *
 * ── 🔴 **왜 거절형인가** — 치환형이 아니라 ───────────────────────────────
 * 이웃 [연락서 폴더에 저장]의 파일 이름 칸과 **같은 판단**이다
 * (domain/contact-folder-save-file-name.ts 머리말의 「왜 거절형인가」). 이 칸도 **사람이
 * 방금 적은 이름**이라, 틀린 글자는 조용히 바꾸지 않고 **그 자리에서 말해 준다.**
 * `2026/11 점검` 이 `2026 11 점검` 으로 소리 없이 바뀌면, 그 사람은 탐색기에서 제가 적은
 * 이름을 찾는다.
 *
 * 🔴 그렇다고 치환형이 빠진 것은 아니다 — 거절을 지난 글자도
 * contactFolderUploadFolderName 을 지나므로 `:` · `*` · `?` 처럼 **경로를 깨지 않는**
 * 금지 글자는 거기서 걷힌다. 두 자가 겹쳐 서 있고, 거절형은 그 **앞의 한 겹**이다.
 *
 * ── 🔴 **목록이 감추는 이름**도 거절한다 ────────────────────────────────
 * 🔴 **폴더에도 같은 함정이 있다.** `.점검` · `~$점검` 으로 시작하는 폴더는 디스크에
 * 멀쩡히 만들어지지만 공유폴더 목록이 **걸러서 안 보여 준다**(isIgnoredShareFolderEntryName
 * — 화면의 「공유폴더」 구역이 그 함수로 줄을 거른다). 「넣었습니다」는 나오는데 화면에도
 * 탐색기에도 안 보이는 폴더가 생기면 사람은 「안 들어갔다」고 여기고 같은 일을 되풀이한다.
 * 🔴 **판정을 베껴 적지 않고** 목록이 쓰는 그 함수를 그대로 부른다.
 *
 * ── 🔴 **다듬고 나서 빈 글자가 되는 이름**도 거절한다 ───────────────────
 * `...` · `:::` 는 경로 글자도 아니고 감춰지는 이름도 아니지만, 다듬고 나면 아무것도 안
 * 남아 **폴더를 만들 수 없다**(그때는 분류 폴더에 바로 들어간다 = 안 적은 것과 같다).
 * 적은 사람에게는 「적었는데 무시당한」 일이라 **거절해서 알린다.** 🔴 판정은 실제로 폴더
 * 이름을 짓는 그 함수로 한다 — 베껴 적으면 다듬기 규칙이 느는 날 한쪽만 고쳐진다.
 *
 * ── 🔴 **비우면 지금까지와 똑같다** ─────────────────────────────────────
 * 빈 글자는 거절이 아니다(`null`). 안 적으면 **분류 폴더에 바로** 들어가고, 그것이
 * 2026-11-26 **전의 동작 그대로**다 — 이 칸을 한 번도 안 쓰는 사람에게는 한 글자도
 * 달라지지 않아야 한다.
 *
 * 순수 파일이다 — server-only · React · drizzle 을 물지 않는다(화면과 통로가 함께 쓴다).
 * ============================================================================
 */

/** 적은 폴더 이름이 너무 길다. 숫자는 **경로 예산에서 뽑은 그 값**이다(새로 짓지 않는다). */
export const CONTACT_FOLDER_UPLOAD_FOLDER_TOO_LONG_REASON = `폴더 이름이 너무 깁니다(${CONTACT_FOLDER_UPLOAD_FOLDER_MAX_NAME_LENGTH}자까지).`;

/** 경로를 깨는 글자 · 제어문자. 🔴 **여기서 만드는 것은 폴더 한 겹**이지 경로가 아니다. */
export const CONTACT_FOLDER_UPLOAD_FOLDER_PATH_REASON =
  "폴더 이름에 경로 글자(/ \\ ..)나 보이지 않는 글자를 넣을 수 없습니다.";

/** 디스크에는 만들어지지만 **목록에 안 보이는** 이름(위 머리말). */
export const CONTACT_FOLDER_UPLOAD_FOLDER_HIDDEN_REASON =
  "공유폴더 목록이 감추는 이름입니다(점 · ~$ 로 시작하거나 Thumbs.db · desktop.ini) — 다른 이름을 적어 주세요.";

/** 다듬고 나면 아무것도 안 남는 이름(`...` · `:::`). */
export const CONTACT_FOLDER_UPLOAD_FOLDER_EMPTY_REASON =
  "폴더 이름으로 쓸 수 있는 글자가 없습니다 — 다른 이름을 적거나 칸을 비워 주세요.";

/**
 * 적은 폴더 이름이 **쓸 수 있는가** — 쓸 수 없으면 **까닭 한 줄**, 괜찮으면 `null`.
 * 생김새는 이웃 `checkContactFolderSaveFileName` 과 같다(까닭을 돌려주는 검사자).
 *
 * 🔴 **빈 글자는 거절이 아니다** — 「안 적었다」는 분류 폴더에 바로 넣으라는 뜻이다.
 *
 * 🔴 **화면과 통로가 이 함수 하나를 함께 쓴다.** 화면은 [올리기]를 누른 자리에서, 그리고
 * 🔴 **아이폰 사진을 굽기 전에** 이것을 본다 — 큰 사진 몇 장을 몇 초씩 들여 바꾼 뒤에
 * 「폴더 이름에 / 가 있습니다」로 되돌리는 것이 가장 나쁘다. 통로는 본문(파일 바이트)을
 * 받기 전에 다시 본다 — 주소는 아무 웹페이지나 만들기 때문이다. 🔴 까닭을 두 곳에서 지어
 * 적지 않는 것이 핵심이다: 글귀가 갈라지면 화면이 말하는 것과 서버가 말하는 것이 서로
 * 다른 날이 온다.
 */
export function checkContactFolderUploadFolderName(value: string | null | undefined): string | null {
  const typed = typeof value === "string" ? value.trim() : "";
  if (typed === "") return null;
  if (typed.length > CONTACT_FOLDER_UPLOAD_FOLDER_MAX_NAME_LENGTH) {
    return CONTACT_FOLDER_UPLOAD_FOLDER_TOO_LONG_REASON;
  }
  if (!isSafeFileNameString(typed, CONTACT_FOLDER_UPLOAD_FOLDER_MAX_NAME_LENGTH)) {
    return CONTACT_FOLDER_UPLOAD_FOLDER_PATH_REASON;
  }
  if (isIgnoredShareFolderEntryName(typed)) return CONTACT_FOLDER_UPLOAD_FOLDER_HIDDEN_REASON;
  // 🔴 마지막은 **실제로 폴더 이름을 짓는 그 함수**로 본다 — 다듬고 나서 빈 글자가 되면
  //    폴더가 안 생기고 조용히 분류 폴더로 들어간다(위 머리말).
  if (contactFolderUploadFolderName(typed) === null) return CONTACT_FOLDER_UPLOAD_FOLDER_EMPTY_REASON;
  return null;
}
