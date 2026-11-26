import { contactFolderCopyFileName } from "./contact-folder-naming";
import { MAX_FILE_NAME_LENGTH, isSafeFileNameString } from "./local/attachments/filename";
import { isIgnoredShareFolderEntryName } from "./share-folder-naming";

/**
 * ============================================================================
 * [연락서 폴더에 저장] — **어떤 이름으로 넣을 것인가** (2026-11-26)
 * ============================================================================
 * 2026-11-18 에 「어느 폴더에 넣을까요」 창이 섰다(domain/contact-folder-save-targets.ts).
 * 그 창에 칸이 하나 더 붙는다 — 사용자 요청 그대로다:
 *
 *   「저장될 폴더를 선택한 다음에 **파일 이름을 어떻게 할지 적을 수 있도록** 해줘.
 *     (기본적으로 기존 이름이 적혀 있고, 변경할 수 있도록)」
 *
 * 2026-10-08 부터 이 길의 파일 이름은 **사람 손을 한 번도 거치지 않았다** — 서버가
 * 공유폴더에서 읽은 원본 이름을 그대로 넘겼다. 이제 사람이 적을 수 있으므로, 그 글자가
 * 디스크에 닿기 전에 지날 자리가 필요하다. 그 자리가 여기 하나다.
 *
 * 🔴 **다듬기를 여기서 다시 적지 않는다.** 금지 글자 걷기 · 글자 수 84 · 바이트 255 ·
 * 끝의 점 걷기는 전부 contactFolderCopyFileName 의 것이고(domain/contact-folder-naming.ts),
 * 사람이 적은 글자도 **그 함수를 그대로 지난다.** 여기서 하는 일은 그 앞에 두 가지를
 * 보태는 것뿐이다:
 *   ① 쓸 수 없는 이름을 **거절**한다(아래 「왜 거절형인가」)
 *   ② 원본의 **확장자를 지킨다**(아래 「확장자는 사람의 것이 아니다」)
 *
 * ── 🔴 **왜 거절형인가** — 치환형이 아니라 ───────────────────────────────
 * 이 저장소에는 이름을 보는 자가 둘 있다:
 *   · **치환형** sanitizeShareFolderNamePiece — 금지 글자를 공백으로 바꾼다. 쓰는 자리는
 *     고객사명 · 모델명 · 신고증상처럼 **아무도 이름으로 적은 적이 없는** 조각이다. 바꿔도
 *     알려 줄 사람이 없고, 거절하면 폴더가 아예 안 생긴다.
 *   · **거절형** isSafeFileNameString — 경로 글자(`/` · `\` · `..`)와 제어문자를 보면
 *     **거짓을 돌려준다.** 쓰는 자리는 올리기 통로처럼 **사람이 방금 적은** 이름이다.
 *
 * 🔴 이 칸은 **사람이 방금 적은 이름**이라 거절형을 골랐다. 치환형으로 받으면 사람이
 * `2026/11 점검표` 라고 적었을 때 `2026 11 점검표` 가 조용히 생기고, 그 사람은 제가 적은
 * 이름이 바뀐 줄 모른 채 탐색기에서 적은 이름을 찾는다. 틀린 글자를 적었으면 **그 자리에서
 * 말해 주는 것**이 맞다.
 *
 * 🔴 그렇다고 치환형이 빠진 것은 아니다 — 거절을 지난 글자도 contactFolderCopyFileName 을
 * 지나므로 `:` · `*` · `?` 같은 **경로를 깨지 않는** 금지 글자는 거기서 걷힌다. 두 자가
 * 겹쳐 서 있고, 거절형은 그 **앞의 한 겹**이다.
 *
 * ── 🔴 **목록이 감추는 이름**도 거절한다 ────────────────────────────────
 * `.점검표.xlsx` · `~$점검표.xlsx` · `Thumbs.db` 는 디스크에 멀쩡히 쓰이지만 공유폴더
 * 목록이 **걸러서 안 보여 준다**(isIgnoredShareFolderEntryName — 화면의 「공유폴더」 구역이
 * 그 함수로 줄을 거른다). 넣었다는 말은 나오는데 화면에도 탐색기에도 안 보이는 파일이
 * 생기면 사람은 「안 들어갔다」고 여기고 같은 일을 되풀이한다. 🔴 **판정을 베껴 적지 않고**
 * 목록이 쓰는 그 함수를 그대로 부른다 — 거르는 규칙이 느는 날 한쪽만 고쳐지지 않게.
 *
 * ── 🔴 **확장자는 사람의 것이 아니다** ──────────────────────────────────
 * 이 길이 넣는 것은 **원본 파일의 사본**이다 — 바이트가 바뀌지 않는다. 그러므로 이름이
 * 가리키는 형식도 바뀔 수 없다. 사람이 이름 칸을 통째로 지우고 `점검표` 라고 적으면
 * 확장자 없는 파일이 공유폴더에 서고, 그것은 탐색기에서 두 번 눌러도 안 열린다 —
 * 사람은 파일이 깨진 줄 안다.
 *
 * 그래서 **나가는 이름은 늘 원본의 확장자로 끝난다**(keepSourceExtension). 이미 그
 * 확장자로 끝나면 그대로 두고, 아니면 뒤에 붙인다 — `점검표` → `점검표.xlsx`,
 * `점검표.pdf` → `점검표.pdf.xlsx`. 뒤엣것이 보기 좋지는 않지만 **열린다**, 그리고
 * 사람이 제 실수를 바로 본다. 확장자만 바꿔 적어 안 열리는 파일을 남기는 쪽보다 낫다.
 *
 * 🔴 contactFolderCopyFileName 의 「**줄기만 자르고 확장자는 그대로 둔다**」는 성질을
 * 여기서 깨뜨리지 않는다 — 그 함수에 넘기기 **전에** 확장자를 갖춰 주는 것이고, 그 함수는
 * 받은 확장자를 여전히 한 글자도 자르지 않는다.
 *
 * ── 🔴 **비우면 원본 이름이다** ─────────────────────────────────────────
 * 칸을 비우고 [저장]하면 2026-10-08 부터의 동작 그대로 **원본 이름**으로 간다. 셋을 재서
 * 고른 결과다:
 *   · 빈 이름의 파일은 만들 수 없다 — 무엇으로든 이름을 지어야 한다.
 *   · [저장]을 못 누르게 막으면 **까닭 없는 죽은 단추**가 된다. 비운 사람은 왜 안 눌리는지
 *     모르고, 이 창에는 그 까닭을 적을 자리가 마땅찮다.
 *   · 「안 적었다」와 「손대지 않았다」가 **같은 뜻**이 되면 통로가 받는 값이 한 가지로
 *     줄어든다 — 칸이 아예 없으면 원본, 있으면 그 이름. 고른 폴더(`?category=`)가 **이미
 *     같은 규율**이라(안 고르면 칸을 안 보낸다) 두 값이 같은 모양으로 간다.
 * 창은 그 사실을 칸 아래에 적어 둔다(SHARE_DOC_FOLDER_PICKER_FILE_NAME_HINT).
 *
 * 순수 파일이다 — server-only · React · drizzle 을 물지 않는다(창과 통로가 함께 쓴다).
 * ============================================================================
 */

/**
 * 적은 이름이 너무 길다. 🔴 **올리기 통로와 같은 자**(255 자)를 쓴다 — 여기서 새 숫자를
 * 짓지 않는다. 실제로 디스크에 쓰이는 길이는 이보다 훨씬 짧게 깎이지만(84 자 · 255 바이트
 * — contactFolderCopyFileName), 그것은 **자동으로 깎이는 일**이라 거절할 거리가 아니다.
 * 원본 이름도 늘 그렇게 깎여 왔다.
 */
export const CONTACT_FOLDER_SAVE_FILE_NAME_TOO_LONG_REASON = `파일 이름이 너무 깁니다(${MAX_FILE_NAME_LENGTH}자까지).`;

/** 경로를 깨는 글자 · 제어문자. 🔴 **파일 이름은 경로가 아니다.** */
export const CONTACT_FOLDER_SAVE_FILE_NAME_PATH_REASON =
  "파일 이름에 경로 글자(/ \\ ..)나 보이지 않는 글자를 넣을 수 없습니다.";

/** 디스크에는 쓰이지만 **목록에 안 보이는** 이름(위 머리말). */
export const CONTACT_FOLDER_SAVE_FILE_NAME_HIDDEN_REASON =
  "공유폴더 목록이 감추는 이름입니다(점 · ~$ 로 시작하거나 Thumbs.db · desktop.ini) — 다른 이름을 적어 주세요.";

/**
 * 가리킨 자리의 **마디 하나** — 통로가 읽은 뒤 쓰는 그 이름과 같은 값이어야 한다
 * (storage/repair-docs-archive.ts 의 `segments[segments.length - 1]`). 창은 디스크를
 * 보지 않으므로 경로에서 뽑는 길밖에 없고, 그 둘이 어긋나면 **창이 보여 준 기본값과
 * 실제로 저장되는 이름이 달라진다.**
 */
function sourceFileName(relativePath: string): string {
  const segments = typeof relativePath === "string" ? relativePath.split("/") : [];
  return segments[segments.length - 1] ?? "";
}

/**
 * 창의 파일 이름 칸에 **처음부터 적혀 있을 글자**(사용자: 「기본적으로 기존 이름이 적혀
 * 있고」).
 *
 * 🔴 **원본 이름 그대로가 아니라 `contactFolderCopyFileName` 을 지난 뒤**다 — 즉 아무것도
 * 건드리지 않고 [저장]했을 때 **디스크에 실제로 쓰일 이름**이다. 원본 이름을 그대로
 * 보여 주면 긴 이름 · 금지 글자가 섞인 이름에서 창이 말한 이름과 공유폴더에 생긴 이름이
 * 달라지고, 사람은 그 차이를 설명할 길이 없다(창은 그 뒤 닫혀 있다).
 *
 * 🔴 쓸 수 있는 이름이 안 나오면(`null`) **원본 이름을 그대로 보여 준다.** 그 이름으로는
 * 어차피 저장이 안 되지만(통로가 「쓸 수 있는 글자가 없습니다」로 끝낸다), 빈 칸을 내밀면
 * 사람이 무엇을 고쳐야 하는지 알 수 없다 — 고칠 거리를 손에 쥐여 주는 쪽이 낫다.
 */
export function contactFolderSaveFileNameDefault(relativePath: string): string {
  const source = sourceFileName(relativePath);
  return contactFolderCopyFileName(source) ?? source;
}

/**
 * 사람이 적은 이름이 **쓸 수 있는가** — 쓸 수 없으면 **까닭 한 줄**, 괜찮으면 `null`.
 * 생김새는 이웃 `checkQuoteFolderRelativePath` 와 같다(까닭을 돌려주는 검사자).
 *
 * 🔴 **빈 글자는 거절이 아니다** — 「안 적었다」는 원본 이름을 뜻한다(머리말).
 *
 * 🔴 **창과 통로가 이 함수 하나를 함께 쓴다.** 창은 [저장]을 누른 자리에서 이것을 보고
 * 걸리면 **창을 닫지 않고** 까닭을 그대로 보여 준다(사람이 그 자리에서 고친다). 통로는
 * 디스크를 보기 전에 다시 본다 — 주소는 아무 웹페이지나 만들기 때문이다. 🔴 까닭을 두
 * 곳에서 지어 적지 않는 것이 핵심이다: 글귀가 갈라지면 화면이 말하는 것과 서버가 말하는
 * 것이 서로 다른 날이 온다.
 */
export function checkContactFolderSaveFileName(value: string | null | undefined): string | null {
  const typed = typeof value === "string" ? value.trim() : "";
  if (typed === "") return null;
  if (typed.length > MAX_FILE_NAME_LENGTH) return CONTACT_FOLDER_SAVE_FILE_NAME_TOO_LONG_REASON;
  if (!isSafeFileNameString(typed, MAX_FILE_NAME_LENGTH)) return CONTACT_FOLDER_SAVE_FILE_NAME_PATH_REASON;
  if (isIgnoredShareFolderEntryName(typed)) return CONTACT_FOLDER_SAVE_FILE_NAME_HIDDEN_REASON;
  return null;
}

/**
 * 창이 [저장]에서 **통로에 실어 보낼 값** — 🔴 `null` 이면 칸을 아예 붙이지 않는다는 뜻이다.
 *
 * `null` 이 되는 때가 둘이고 **둘 다 「원본 이름 그대로」**다:
 *  · 칸을 **비웠다**(머리말 「비우면 원본 이름이다」).
 *  · 칸을 **손대지 않았다** — 적힌 글자가 기본값 그대로다. 🔴 이때 나가는 주소가
 *    2026-11-18 의 주소와 **한 글자도 달라지지 않아야 한다.** 고른 폴더가 `공통` 일 때
 *    `?category=` 를 안 붙이는 것과 **같은 규율**이다 — 늘 하던 일을 하는 사람의 요청이
 *    새 칸 때문에 달라지면, 나중에 무엇이 달라졌는지 가릴 수 없다.
 *
 * 앞뒤 공백은 여기서 걷는다 — 사람이 글자를 지우다 남긴 공백 때문에 「손대지 않았다」가
 * 「바꿨다」로 뒤집히면 안 된다.
 */
export function contactFolderSaveFileNameToSend(typed: string, relativePath: string): string | null {
  const name = typeof typed === "string" ? typed.trim() : "";
  if (name === "") return null;
  return name === contactFolderSaveFileNameDefault(relativePath) ? null : name;
}

/**
 * 통로가 받은 `?name=` → **`copyIntoContactFolder*` 에 넘길 이름.** 던지지 않는다.
 *
 * 🔴 여기서 다듬지 않는다 — 돌려주는 값은 여전히 **「원본 이름」 자리에 들어갈 날것**이고,
 * 다듬기는 꽂는 함수 안의 contactFolderCopyFileName 이 한다(머리말). 그래서 사람이 적은
 * 글자도 원본 이름과 **똑같은 길**을 지난다.
 *
 * 🔴 **거절할 값은 통로가 먼저 거른다**(checkContactFolderSaveFileName). 그래도 여기까지
 * 쓸 수 없는 값이 왔다면 **원본 이름으로 간다** — 던지지도, 사람이 적은 적 없는 이름을
 * 지어내지도 않는다. 두 겹 가운데 하나가 빠지는 날 파일이 엉뚱한 이름으로 서는 것보다
 * 「이름이 안 바뀐 사본」이 서는 쪽이 되돌리기 쉽다.
 */
export function contactFolderSaveFileName(value: string | null | undefined, source: string): string {
  const typed = typeof value === "string" ? value.trim() : "";
  if (typed === "" || checkContactFolderSaveFileName(typed) !== null) return source;
  return keepSourceExtension(typed, source);
}

/**
 * 나가는 이름이 **원본의 확장자로 끝나게** 한다(머리말 「확장자는 사람의 것이 아니다」).
 *
 * · 원본에 확장자가 없으면(`README` · `.gitignore`) 붙일 것이 없다 — 적은 그대로 둔다.
 *   맨 앞의 점은 확장자 구분자가 아니다(contactFolderCopyFileName 과 **같은 판정**이다).
 * · 대소문자는 접어서 견주되 **붙이는 글자는 원본 그대로**다 — `.XLSX` 인 원본의 사본이
 *   `.xlsx` 로 바뀌면 리눅스(NAS)에서는 다른 이름이고, 사람이 둘을 같은 파일로 못 본다.
 */
function keepSourceExtension(fileName: string, source: string): string {
  const dot = source.lastIndexOf(".");
  if (dot <= 0 || dot === source.length - 1) return fileName;
  const extension = source.slice(dot);
  return fileName.toLowerCase().endsWith(extension.toLowerCase()) ? fileName : `${fileName}${extension}`;
}
