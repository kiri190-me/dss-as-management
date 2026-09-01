/**
 * ============================================================================
 * 글자 폭을 세고, 정해진 폭에서 줄을 나눈다 — 순수 계산
 * ============================================================================
 * 엑셀 양식의 한 줄에는 정해진 폭이 있다. 그 폭을 넘는 글은 병합 칸 밖으로
 * 흘러나가거나(옆 칸이 비어 있을 때) 잘려 보인다(옆 칸에 값이 있을 때) —
 * 둘 다 화면에서는 멀쩡해 보이고 **인쇄된 뒤에야** 드러난다.
 *
 * 그래서 값을 넣기 전에 우리가 먼저 나눈다. 나누는 규칙은 문서의 규칙이지
 * 엑셀의 규칙이 아니므로 xlsx 모듈에 두지 않고 여기 둔다 — 파일을 열지 않고도
 * 시험할 수 있어야 한다.
 *
 * ── 폭을 어떻게 세는가 ──────────────────────────────────────────────────
 * 엑셀의 열 너비 단위는 "기본 글꼴로 `0` 을 몇 자 넣을 수 있는가"다. 한글·한자·
 * 가나·전각 기호는 그 두 배 자리를 차지한다. 그래서 **전각 2 · 반각 1** 로 세는
 * 근사를 쓴다. 글꼴마다 자폭이 미묘하게 다르므로 이것은 정확한 값이 아니라
 * **넘치지 않게 하는 어림**이다 — 그래서 넉넉한 쪽(전각을 2로)으로 센다.
 *
 * ── 어디서 끊는가 ───────────────────────────────────────────────────────
 * 🔴 **낱말 가운데를 자르지 않는다.** 「교체하였습니다」가 「교체하였습」/「니다」로
 * 갈리면 읽는 사람은 오탈자로 본다. 한글도 영문도 낱말 경계는 공백이므로
 * **공백 우선**이고, 낱말 하나가 한 줄보다 길 때만 어쩔 수 없이 자른다. 그때도
 * **문장부호 다음**을 먼저 찾고, 그것도 없을 때 글자 단위로 자른다.
 *
 * ── 앞 공백은 살린다 ────────────────────────────────────────────────────
 * 이 문서들의 글머리표는 앞 공백이다(` ・수리의뢰`). 첫 줄의 앞 공백은 폭에 세어
 * 넣은 채 그대로 남기고, 줄이 넘어가는 자리의 공백만 버린다.
 * ============================================================================
 */

/**
 * 전각(2칸)으로 세는 유니코드 구간. East Asian Width 의 W·F 에 해당하는
 * 구간을 실용적인 범위로 추린 것이다 — 한글 음절·자모, 한자, 가나, 전각 기호,
 * 전각 영숫자가 들어 있다.
 */
const WIDE_RANGES: readonly (readonly [number, number])[] = [
  [0x1100, 0x115f], // 한글 자모
  [0x2e80, 0x303e], // 한자 부수 · 한중일 기호(전각 공백 U+3000 포함)
  [0x3041, 0x33ff], // 가나 · 주음부호 · 한글 호환 자모 · 한중일 조합 문자
  [0x3400, 0x4dbf], // 한자 확장 A
  [0x4e00, 0x9fff], // 한자
  [0xa000, 0xa4cf], // 이 문자
  [0xa960, 0xa97f], // 한글 자모 확장 A
  [0xac00, 0xd7a3], // 한글 음절
  [0xd7b0, 0xd7ff], // 한글 자모 확장 B
  [0xf900, 0xfaff], // 한자 호환
  [0xfe10, 0xfe19], // 세로쓰기 형태
  [0xfe30, 0xfe6f], // 한중일 호환 형태 · 전각 기호
  [0xff00, 0xff60], // 전각 영숫자·기호(전각 물결표 U+FF5E 포함)
  [0xffe0, 0xffe6], // 전각 통화 기호
  [0x1f300, 0x1f64f], // 그림문자
  [0x1f900, 0x1f9ff],
  [0x20000, 0x3fffd], // 한자 확장 B 이상
];

/**
 * 낱말 하나가 한 줄보다 길 때 **여기 다음에서** 끊는다. 공백이 없는 긴 글에서
 * 그나마 사람이 읽는 단위의 끝이 되는 자리들이다.
 */
const BREAKABLE_AFTER = /[,.;:!?)\]}>/\\、。，．：；！？）］｝〉》」』…·・\-–—]/u;

/** 한 글자(코드 포인트)가 차지하는 칸 수. 제어문자는 0. */
export function charDisplayWidth(char: string): 0 | 1 | 2 {
  const code = char.codePointAt(0);
  if (code === undefined) return 0;
  // 줄바꿈·탭 말고 제어문자는 화면에 자리를 차지하지 않는다.
  if (code < 0x20 || code === 0x7f) return code === 0x09 ? 1 : 0;
  for (const [from, to] of WIDE_RANGES) {
    if (code >= from && code <= to) return 2;
  }
  return 1;
}

/** 글 전체가 차지하는 칸 수. */
export function textDisplayWidth(text: string): number {
  let total = 0;
  for (const char of text) total += charDisplayWidth(char);
  return total;
}

/**
 * `width` 칸을 넘지 않도록 줄을 나눈다.
 *
 *  · 빈 줄(또는 공백뿐인 줄)은 **그대로 한 줄로** 돌려준다 — 사람이 사이를
 *    띄우려고 넣은 줄이라 없애면 안 된다.
 *  · 줄이 넘어가는 자리의 공백은 버린다. 맨 앞의 공백(글머리표 들여쓰기)은 남긴다.
 *  · 이어지는 줄은 들여쓰지 않는다 — 이 양식의 본문 칸은 가운데 맞춤이라
 *    들여쓰기가 눈에 보이지 않는다.
 */
export function wrapTextToWidth(text: string, width: number): string[] {
  if (!Number.isFinite(width) || width < 2) {
    throw new Error(`줄 폭은 2 이상이어야 합니다: ${String(width)}`);
  }
  if (text.trim() === "") return [text];

  const lines: string[] = [];
  let current = "";
  /** 아직 어느 줄에도 붙이지 않은 낱말 사이 공백. 줄이 바뀌면 버린다. */
  let separator = "";

  const flush = (): void => {
    lines.push(current);
    current = "";
    separator = "";
  };

  const units = text.match(/\s+|\S+/gu) ?? [];
  for (let index = 0; index < units.length; index += 1) {
    const unit = units[index];
    if (/^\s+$/u.test(unit)) {
      // 맨 앞의 공백만 자리로 인정한다(글머리표 들여쓰기).
      if (index === 0) current = unit;
      else separator = unit;
      continue;
    }

    let rest = unit;
    while (rest !== "") {
      const glue = current === "" ? "" : separator;
      const room = width - textDisplayWidth(current) - textDisplayWidth(glue);
      if (textDisplayWidth(rest) <= room) {
        current += glue + rest;
        separator = "";
        rest = "";
      } else if (current.trim() !== "") {
        // 이 줄에는 안 들어간다. **낱말은 자르지 않고** 다음 줄에서 다시 본다.
        flush();
      } else {
        // 낱말 하나가 한 줄보다 길다 — 자를 수밖에 없다.
        const head = breakOversizedWord(rest, Math.max(1, room));
        current += glue + head;
        rest = rest.slice(head.length);
        flush();
      }
    }
  }

  if (current !== "" || lines.length === 0) lines.push(current);
  return lines;
}

/**
 * 한 줄보다 긴 낱말에서 `room` 칸 안에 들어가는 앞부분을 떼어낸다.
 * **문장부호 다음**을 먼저 찾고, 없으면 들어가는 만큼 글자 단위로 자른다.
 * 🔴 돌려주는 값은 언제나 한 글자 이상이다 — 아니면 부르는 쪽이 무한히 돈다.
 */
function breakOversizedWord(word: string, room: number): string {
  let taken = "";
  let used = 0;
  for (const char of word) {
    const next = used + charDisplayWidth(char);
    if (taken !== "" && next > room) break;
    taken += char;
    used = next;
  }
  if (taken === "") taken = [...word][0] ?? word;

  // 문장부호 다음에서 끊을 수 있으면 그쪽이 읽기 좋다. 너무 조금만 남기고
  // 끊으면(앞부분이 반도 안 차면) 줄만 늘어나므로 그때는 그냥 글자 단위로 둔다.
  const chars = [...taken];
  for (let index = chars.length - 1; index >= 1; index -= 1) {
    if (!BREAKABLE_AFTER.test(chars[index])) continue;
    const candidate = chars.slice(0, index + 1).join("");
    if (textDisplayWidth(candidate) * 2 >= used) return candidate;
    break;
  }
  return taken;
}
