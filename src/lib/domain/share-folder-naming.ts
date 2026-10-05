/**
 * ============================================================================
 * 사내 공유폴더 이름 규칙의 **원시 함수들** (순수 — 파일시스템 없음)
 * ============================================================================
 * 공유폴더는 사람이 수년째 손으로 쓰고 탐색기 · 엑셀로 여는 폴더다. 앱이 그 모양을
 * 그대로 따르되, 사람이 읽는 이름이 부르는 문제(금지 글자 · 경로 벗어나기 ·
 * 너무 긴 경로)를 여기서 막는다.
 *
 * 이 모듈은 **어느 서류함인지 모른다.** 서류함마다의 규칙은 얹는 쪽이 정한다:
 *   · 견적서 — domain/quote-archive-naming.ts
 *   · 연락서 — domain/contact-folder-naming.ts
 *
 * 🔴 **갈라지면 안 되는 것을 한 벌로 둔다.** 금지 글자 표를 두 벌 두면 반드시
 * 갈라진다 — 한쪽만 고치고 다른 쪽은 그대로인 채로. 그래서 복제가 아니라
 * 끌어내기다(2026-10-05, 연락서 조각 1). 여기 있는 것은 견적서 쪽에서 그대로
 * 옮겨 온 것이고, 견적서의 **공개 이름은 quote-archive-naming.ts 가 그대로 다시
 * 내보낸다** — 부르는 쪽은 아무것도 바뀌지 않았다.
 *
 * ── 비교할 때와 이을 때가 다르다 ─────────────────────────────────────────
 * 이미 있는 폴더 이름은 사람이 적은 것이라 공백이 두 칸이거나 한글이 풀어쓴(NFD)
 * 모양일 수 있다. **비교할 때만** 다듬고(normalizeShareFolderNameForCompare),
 * 경로를 이을 때는 **디스크의 실제 이름**을 쓴다 — 다듬은 이름으로 이으면 없는
 * 폴더가 된다. 그 일은 저장 모듈(storage/*)이 한다.
 * ============================================================================
 */

/**
 * Windows 가 이름에 허용하지 않는 글자 `\ / : * ? " < > |` 와 제어문자(C0 · DEL · C1),
 * 그리고 보이지 않는 방향 제어문자(RLO 등 — 탐색기에서 확장자를 뒤집어 보이게 한다).
 */
const FORBIDDEN_IN_NAME = /[\\/:*?"<>|\u0000-\u001F\u007F-\u009F\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;

/**
 * 이름 한 조각을 다듬는다: NFC → 금지 글자 · 제어문자를 공백으로 → 연속 공백 하나로 →
 * 앞뒤 공백과 **끝의 점** 걷기. 점만 있던 조각(`.` · `..`)은 빈 문자열이 되어 빠진다 —
 * 경로를 거슬러 오르는 이름이 여기서 사라진다.
 *
 * 줄바꿈 · 탭도 제어문자라 공백이 된다(자유 입력 칸이 그대로 들어와도 한 줄이 된다).
 */
export function sanitizeShareFolderNamePiece(value: string | null | undefined): string {
  if (typeof value !== "string") return "";
  return value
    .normalize("NFC")
    .replace(FORBIDDEN_IN_NAME, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.\s]+$/, "")
    .normalize("NFC");
}

/** 조각을 자른 자리에 남은 공백 · 점을 걷는다(끝의 점 규칙을 자른 뒤에도 지킨다). */
function trimPieceEnd(value: string): string {
  return value.replace(/[.\s]+$/, "").trim();
}

/**
 * 다듬은 뒤 **글자 수 상한**까지만 남긴다(코드 포인트 단위 — UTF-16 한 쌍을 반으로
 * 가르지 않게). 자른 자리의 공백 · 점은 걷는다.
 *
 * 자유 입력 칸(신고증상 같은 4000 자짜리)을 이름 한 조각으로 쓸 때, **전체 상한에
 * 닿기 전에** 그 조각 혼자 이름을 다 차지하지 않게 미리 자르는 자리다.
 */
export function truncateShareFolderNamePiece(value: string | null | undefined, maxLength: number): string {
  const piece = sanitizeShareFolderNamePiece(value);
  const limit = Number.isFinite(maxLength) ? Math.max(0, Math.floor(maxLength)) : 0;
  const letters = Array.from(piece);
  if (letters.length <= limit) return piece;
  return trimPieceEnd(letters.slice(0, limit).join(""));
}

/** 디스크에 이미 있는 이름을 **비교할 때만** 쓰는 모양: NFC + 연속 공백 하나 + 앞뒤 공백 걷기. */
export function normalizeShareFolderNameForCompare(name: string): string {
  return name.normalize("NFC").replace(/\s+/g, " ").trim();
}

/**
 * 폴더 이름 정렬 — 다듬은 이름으로 견주고, 같으면 디스크의 실제 이름으로 가른다.
 * 맞는 폴더가 여럿일 때 **늘 같은 하나**를 고르기 위한 것이다(사람이 NFD 로 적은
 * 이름과 NFC 로 적은 이름이 섞여 있어도 순서가 흔들리지 않게).
 */
export function compareShareFolderNames(a: string, b: string): number {
  const left = normalizeShareFolderNameForCompare(a);
  const right = normalizeShareFolderNameForCompare(b);
  if (left !== right) return left < right ? -1 : 1;
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/**
 * 이미 있는 이름이 이 **열쇠로 시작하는가** — 다듬은 이름이 열쇠 그 자체이거나,
 * 열쇠 **바로 뒤가 공백**이어야 맞다.
 *
 * 🔴 경계를 보는 것이 핵심이다. 그냥 `startsWith` 면 `D2609081 …` 이 `D260908` 의
 * 폴더로 잡히고, `DSS 2026-0891 …` 이 `DSS 2026-089` 의 폴더로 잡힌다 — 남의 서류에
 * 이번 자료를 넣게 된다.
 *
 * `foldCase` 는 **대소문자를 접어서** 본다. 사람이 `d260908 …` 로 적었을 때 리눅스
 * (NAS)에서는 그것이 다른 이름이라, 접지 않으면 못 찾고 폴더가 둘이 된다. 로케일을
 * `en-US` 로 못 박는다 — 터키어 로케일에서 `i` 가 `İ` 가 되는 일이 없게.
 */
export function matchesShareFolderPrefix(
  existingName: string,
  base: string,
  options?: { foldCase?: boolean }
): boolean {
  if (base.length === 0) return false;
  const fold = options?.foldCase === true;
  const normalized = normalizeShareFolderNameForCompare(existingName);
  const left = fold ? normalized.toLocaleUpperCase("en-US") : normalized;
  const right = fold ? base.toLocaleUpperCase("en-US") : base;
  return left === right || left.startsWith(`${right} `);
}

/**
 * 같은 이름이 이미 있을 때의 후보 이름: `n = 1` 이면 그대로, 2 이상이면 **확장자 앞에**
 * ` (n)` 을 넣는다.
 *
 *   `사진.jpg` → `사진 (2).jpg`
 *   `이름`     → `이름 (2)`        (확장자가 없으면 끝에 붙인다)
 *   `.gitignore` → `.gitignore (2)` (맨 앞의 점은 확장자 구분자가 아니다)
 *
 * 🔴 **한 벌로 둔다.** 견적서(quote-archive-naming.ts)와 연락서(contact-folder-naming.ts)가
 * 같은 규칙을 쓴다 — 두 벌을 두면 한쪽만 고쳐져 같은 공유폴더 안에서 번호 모양이 갈라진다.
 * `n` 이 1 이상의 정수인지는 **부르는 쪽이** 본다(서류함마다 던지는 오류가 다르다).
 */
export function numberedShareFolderFileName(name: string, n: number): string {
  if (n === 1) return name;
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return `${name} (${n})`;
  return `${name.slice(0, dot)} (${n})${name.slice(dot)}`;
}

/** 바이트 수를 세는 자(바로 아래 shareFolderNameByteLength). 한 벌만 만들어 둔다. */
const UTF8 = new TextEncoder();

/**
 * 이름의 **UTF-8 바이트 수**. 리눅스(NAS)의 파일 이름 한도가 글자 수가 아니라 바이트
 * 수(255)라, 한글 이름은 글자 수만 보면 세 배로 넘친다 — 한 자가 3 바이트다.
 */
export function shareFolderNameByteLength(name: string): number {
  return UTF8.encode(name).length;
}

export type ShareFolderStemOptions = {
  /** 🔴 **절대 자르지 않는 머리**(견적서 번호 · 인수번호). 이미 다듬은 값을 넘긴다. */
  head: string;
  /** 길면 줄어드는 조각들. 다듬기는 여기서 한다 — **빈 조각은 빠진다.** */
  pieces: ReadonlyArray<string | null | undefined>;
  /** 절대 자르지 않는 꼬리(견적서의 「수리 견적서」). 없으면 붙이지 않는다. */
  tail?: string | null;
  /** 줄기 전체의 글자 수 상한(UTF-16 단위 — Windows 경로 한도가 세는 단위). */
  maxLength: number;
};

/**
 * `머리 조각 조각 … 꼬리` 를 공백으로 이어 **줄기**를 만든다. 상한을 넘으면 **가장 긴
 * 조각부터 한 글자씩** 줄인다(길이가 같으면 뒤의 조각부터). 머리와 꼬리는 자르지
 * 않는다 — 머리가 비정상적으로 길면 조각이 모두 빠진 채 상한을 넘는 이름이 나올 수
 * 있다(그때는 디스크가 거절하고 저장 모듈이 `failed` 로 돌려준다).
 *
 * 머리를 자르지 않는 까닭: 머리가 **찾는 열쇠**다. 한 글자라도 잘리면 다음에 같은
 * 서류를 찾을 수 없다.
 */
export function buildShareFolderStem(options: ShareFolderStemOptions): string {
  const tail = typeof options.tail === "string" && options.tail.length > 0 ? [options.tail] : [];
  const pieces = options.pieces
    .map((piece) => sanitizeShareFolderNamePiece(piece))
    .filter((piece) => piece.length > 0)
    // 코드 포인트 단위로 자른다 — UTF-16 한 쌍을 반으로 가르지 않게.
    .map((piece) => Array.from(piece));

  const assemble = (parts: string[][]) =>
    [options.head, ...parts.map((part) => part.join("")).filter((part) => part.length > 0), ...tail].join(" ");

  while (assemble(pieces).length > options.maxLength) {
    let longest = -1;
    let longestLength = 0;
    pieces.forEach((part, index) => {
      const length = part.join("").length;
      if (length > 0 && length >= longestLength) {
        longest = index;
        longestLength = length;
      }
    });
    if (longest < 0) break; // 줄일 조각이 없다 — 머리가 길다. 머리는 자르지 않는다.
    pieces[longest].pop();
  }

  const kept = pieces.map((part) => trimPieceEnd(part.join(""))).filter((part) => part.length > 0);
  return [options.head, ...kept, ...tail].join(" ").normalize("NFC");
}
