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
 * 한 칸은 **그 칸에 실제로 박힌 글꼴의 `0` 한 자**다. 한글·한자·가나·전각 기호는
 * 두 칸으로 센다 — **전각 2 · 반각 1**.
 *
 * 🔴 **들어오는 `width` 가 그 단위여야 한다.** 엑셀 양식의 `<col width>` 는
 * **통합문서 기본 글꼴** 기준이라 그대로 넣으면 안 된다. 보고서 양식은 기본
 * 글꼴이 ＭＳ Ｐゴシック 11pt 인데 본문·비고 칸은 맑은 고딕 9pt 라서, 그대로
 * 넣으면 **실제보다 일찍 줄이 바뀐다**(2026-10-15 실측·사용자 지적). 환산은
 * `xlsx/service-report-template.ts` 의 `contentWrapWidth` 가 한다.
 *
 * 🔴 **전각 2 는 넉넉한 쪽이다.** 맑은 고딕 9pt 실측으로 한글 음절은 12px,
 * 숫자는 7px — 1.71배이지 2배가 아니다. 그래서 한글은 늘 16.7% 모자라게 세고,
 * 그만큼이 **넘치지 않게 하는 여백**이 된다. 반대로 `m`·`W`·`M`(11px)처럼 반각
 * 중에서도 넓은 글자는 1칸보다 넓다 — 그런 글자만 한 줄을 채우면 넘친다.
 *
 * ── 어디서 끊는가 ───────────────────────────────────────────────────────
 * 🔴 **낱말 가운데를 자르지 않는다.** 「교체하였습니다」가 「교체하였습」/「니다」로
 * 갈리면 읽는 사람은 오탈자로 본다. 한글도 영문도 낱말 경계는 공백이므로
 * **공백 우선**이고, 낱말 하나가 한 줄보다 길 때만 어쩔 수 없이 자른다. 그때도
 * **문장부호 다음**을 먼저 찾고, 그것도 없을 때 글자 단위로 자른다.
 *
 * ── 🔴 어쩔 수 없이 자를 때의 네 규칙 (2026-10-15 사용자 요청) ──────────
 * 「줄바꿈이 자연스럽지 않다」는 말을 받고 실측한 결과, 공백이 없는 글
 * (현장에서 흔하다)에서 세 가지가 어긋나 있었다. 고친 뒤의 규칙은 이렇다 —
 * **넷 다 `breakOversizedWord` 안에서만 산다.** 공백이 있는 글은 지금까지처럼
 * 낱말째 넘기므로 애초에 해당이 없다.
 *
 *   1. **낱말 가운데를 자르지 않는다** — 공백이 있는 한 그대로다(위).
 *   2. **쉼표·마침표는 그 *뒤*에서 끊는다.** 자른 자리 **다음 글자**가 닫는
 *      부호(`,` `.` `)` 「」 …)면 그 줄 머리에 부호만 덩그러니 남는다.
 *      실측: `…정지하는현상` / `,이어서출력을…`. 그래서 한 글자씩 물려
 *      부호가 앞말에 붙어 내려가게 한다(`avoidLineHeadMark`).
 *   3. **꼬리만 남기지 않는다.** 마지막 줄에 「니다」(4칸)·「고,」(3칸) 같은
 *      **토막만** 넘어가면 사람은 오탈자로 읽는다. 실측: 74칸 + 꼬리 「이」(2칸).
 *      그래서 꼬리가 `MIN_TAIL_WIDTH` 보다 좁으면 자르는 자리를 앞으로 물려
 *      앞 글자들을 함께 내려보낸다(`growTail`).
 *   4. **영문·숫자 덩어리 가운데를 자르지 않는다.** 실측에서 `13.56MHz` 가
 *      `13.` / `56MHz` 로, `RF-3000B` 가 `RF-` / `3000B` 로 갈렸다 — 문장부호
 *      규칙이 **덩어리 안의 점·붙임표**를 끊을 자리로 본 탓이다. 그래서
 *      덩어리(`ALNUM_CHUNK`)를 한 몸으로 보고, 자리가 그 안이면 덩어리
 *      **앞**으로 물린다(`pullOutOfChunk`).
 *
 * 🔴 **물리기는 언제나 앞으로만 한다.** 그래야 줄이 폭을 넘지 않는다는 성질이
 * 그대로 남는다. 그리고 앞줄이 **반도 안 차게** 되는 물리기는 하지 않는다 —
 * 그러면 줄만 늘어나고 본문이 양식 밖으로 밀린다(`service-report-template.ts`
 * 의 `growBodyBlock`). 「반」의 잣대는 예전부터 쓰던 것 그대로다.
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
 *
 * ⚠️ 여기 든 `.`·`-`·`:` 는 **영문·숫자 덩어리 안에도** 산다(`13.56MHz`·
 * `RF-3000B`). 그 안은 끊을 자리가 아니므로 `ALNUM_CHUNK` 로 걸러 낸다.
 */
const BREAKABLE_AFTER = /[,.;:!?)\]}>/\\、。，．：；！？）］｝〉》」』…·・\-–—]/u;

/**
 * 🔴 **영문·숫자 덩어리** — 모델명·치수·수치. 가운데를 자르면 읽는 사람이 다른
 * 물건으로 읽는다(`13.56MHz` → `13.` / `56MHz`, `RF-3000B` → `RF-` / `3000B`).
 *
 * 안쪽 이음표는 `.`·`-`·`:` 만이다. **`/` 는 일부러 뺐다** — `/` 는 이름 안이
 * 아니라 **이름과 이름 사이**에 서는 일이 많고(`A-KIT/B-KIT`), 거기서 끊는 것이
 * 오히려 읽기 좋다. 지금까지의 동작도 그랬다.
 *
 * 한 글자짜리는 덩어리로 세지 않는다 — 지킬 가운데가 없고, 「…하였습니다.2차」의
 * `.` 같은 **문장의 마침표**까지 덩어리 안으로 끌어들이면 끊을 자리가 사라진다.
 */
const ALNUM_CHUNK = /[0-9A-Za-z]+(?:[.\-:][0-9A-Za-z]+)*/gu;

/**
 * 🔴 줄 **머리**에 오면 안 되는 부호. 앞말에 붙어 있어야 읽히는 것들이다.
 * `-`·`/`·`\` 는 여기 없다 — 그것들은 줄 머리에 서도 글머리표처럼 읽힌다.
 */
const NEVER_LINE_HEAD = /[,.;:!?)\]}>、。，．：；！？）］｝〉》」』…·・]/u;

/**
 * 🔴 꼬리로 남겨도 되는 **가장 좁은** 폭. 사용자가 짚은 토막이 「니다」(4칸)와
 * 「고,」(3칸)이므로 **둘 다 토막으로 보도록** 6칸(한글 세 자)으로 잡았다.
 */
const MIN_TAIL_WIDTH = 6;

/** 글 안에서 `[start, end)` 를 차지하는 조각. 자리는 모두 문자열 인덱스다. */
type Span = { start: number; end: number };

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
 * 🔴 돌려주는 값은 언제나 한 글자 이상이다 — 아니면 부르는 쪽이 무한히 돈다.
 *
 * 들어가는 데까지 담은 자리(`greedy`)에서 **앞으로만** 물려 가며 머리말의 네
 * 규칙을 차례로 본다. 앞으로만 가므로 폭을 넘길 길이 없고, 물릴 때마다
 * 「앞줄이 반은 차는가」(`fitsHalf`)를 물어 줄이 쓸데없이 늘어나는 것을 막는다.
 */
function breakOversizedWord(word: string, room: number): string {
  const greedy = greedyCut(word, room);
  if (greedy >= word.length) return word;

  const chunks = alnumChunks(word);
  const used = textDisplayWidth(word.slice(0, greedy));
  /** 거기서 끊어도 앞줄이 **반은 차는가**. 예전부터 쓰던 잣대 그대로다. */
  const fitsHalf = (cut: number): boolean => textDisplayWidth(word.slice(0, cut)) * 2 >= used;

  /**
   * 🔴 **지킬 수 있는 덩어리만 지킨다.** 자르는 자리에 걸린 덩어리를 앞으로
   * 물릴 수 없으면(앞줄이 반도 안 차거나 덩어리가 줄 머리부터다) 그 덩어리는
   * 어차피 쪼개진다 — 그런 덩어리까지 「안을 끊지 마라」로 묶으면 끊을 자리가
   * 통째로 사라져 `…REPLACEMEN` / `T` 같은 더 나쁜 줄이 나온다(실측).
   * 쪼갤 수밖에 없는 덩어리는 **안의 붙임표·점을 다시 끊을 자리로 쓴다.**
   */
  const forced = chunkAt(chunks, greedy);
  const keepsWhole = forced !== undefined && forced.start >= 1 && fitsHalf(forced.start);
  const kept = forced !== undefined && !keepsWhole ? chunks.filter((c) => c !== forced) : chunks;

  // ① 문장부호 다음이 있으면 그쪽이 읽기 좋다 — **덩어리 안은 빼고**(규칙 4).
  const marked = cutAfterMark(word, greedy, kept);
  let cut = marked !== null && fitsHalf(marked) ? marked : greedy;

  // ② 자리가 영문·숫자 덩어리 가운데면 덩어리 **앞**으로 물린다(규칙 4).
  cut = pullOutOfChunk(cut, kept, fitsHalf);

  // ③ 꼬리가 토막만 남으면 더 물린다(규칙 3).
  //    🔴 여기만 `kept` 가 아니라 `chunks` 를 넘긴다 — 쪼갤 수밖에 없는 덩어리
  //    안에서는 꼬리를 늘려도 더 읽히지 않는다(`growTail` 머리말).
  cut = pullOutOfChunk(growTail(word, cut, chunks, fitsHalf), kept, fitsHalf);

  // ④ 다음 줄이 닫는 부호로 시작하지 않게(규칙 2).
  cut = pullOutOfChunk(avoidLineHeadMark(word, cut, fitsHalf), kept, fitsHalf);

  // 🔴 마지막 그물 — 0이 되면 부르는 쪽이 무한히 돈다. 대리쌍을 쪼개지도 않는다.
  return cut >= 1 ? word.slice(0, cut) : ([...word][0] ?? word);
}

/**
 * `room` 칸에 들어가는 **가장 긴** 앞부분이 끝나는 자리(문자열 인덱스).
 * 글이 비어 있지 않으면 **언제나 한 글자 이상**이다 — 첫 글자가 혼자서 폭을
 * 넘더라도 담는다. 그래야 부르는 쪽이 한 걸음도 못 나가고 도는 일이 없다.
 */
function greedyCut(word: string, room: number): number {
  let cut = 0;
  let used = 0;
  for (const char of word) {
    const next = used + charDisplayWidth(char);
    if (cut > 0 && next > room) break;
    cut += char.length;
    used = next;
  }
  return cut;
}

/** 글 안의 영문·숫자 덩어리들. 한 글자짜리는 지킬 가운데가 없어 빼 둔다. */
function alnumChunks(text: string): Span[] {
  const spans: Span[] = [];
  for (const match of text.matchAll(ALNUM_CHUNK)) {
    if (match[0].length < 2 || match.index === undefined) continue;
    spans.push({ start: match.index, end: match.index + match[0].length });
  }
  return spans;
}

/** 그 자리가 어느 덩어리의 **가운데**인가(앞뒤로 글자가 남는 자리인가). */
function chunkAt(spans: readonly Span[], cut: number): Span | undefined {
  return spans.find((span) => cut > span.start && cut < span.end);
}

/**
 * 끊을 자리 앞쪽에서 **가장 뒤에 있는 문장부호 다음**을 찾는다. 덩어리 안의
 * 점·붙임표는 건너뛴다 — 거기서 끊으면 `13.` / `56MHz` 가 된다.
 */
function cutAfterMark(word: string, greedy: number, chunks: readonly Span[]): number | null {
  const chars = [...word.slice(0, greedy)];
  let after = greedy;
  for (let index = chars.length - 1; index >= 1; index -= 1) {
    if (BREAKABLE_AFTER.test(chars[index]) && chunkAt(chunks, after) === undefined) return after;
    after -= chars[index].length;
  }
  return null;
}

/** 덩어리 가운데면 덩어리 앞으로. 덩어리 자체가 한 줄보다 길면 어쩔 수 없다. */
function pullOutOfChunk(
  cut: number,
  chunks: readonly Span[],
  fitsHalf: (cut: number) => boolean
): number {
  const chunk = chunkAt(chunks, cut);
  if (chunk === undefined) return cut;
  return chunk.start >= 1 && fitsHalf(chunk.start) ? chunk.start : cut;
}

/**
 * 꼬리가 토막(`MIN_TAIL_WIDTH` 미만)만 남으면 앞 글자들을 함께 내려보낸다.
 *
 * 🔴 **덩어리를 억지로 자르는 자리에서는 하지 않는다.** 거기는 애초에 사람이
 * 읽는 단위가 없어서 자르는 중이라, 꼬리를 늘려도 더 읽히지 않고 줄만 늘어난다.
 * 🔴 꼬리 최소치와 「반은 찬다」를 **둘 다** 만족하는 자리가 없으면 원래 자리를
 * 그대로 둔다 — 반만 고치면 이쪽 토막이 저쪽 빈 줄이 된다.
 */
function growTail(
  word: string,
  cut: number,
  chunks: readonly Span[],
  fitsHalf: (cut: number) => boolean
): number {
  if (chunkAt(chunks, cut) !== undefined) return cut;
  if (textDisplayWidth(word.slice(cut)) >= MIN_TAIL_WIDTH) return cut;

  const chars = [...word.slice(0, cut)];
  let next = cut;
  for (let index = chars.length - 1; index >= 1; index -= 1) {
    next -= chars[index].length;
    if (!fitsHalf(next)) return cut;
    if (chunkAt(chunks, next) !== undefined) continue;
    if (textDisplayWidth(word.slice(next)) >= MIN_TAIL_WIDTH) return next;
  }
  return cut;
}

/**
 * 다음 줄이 닫는 부호로 시작하면 한 글자씩 물려 부호를 앞말에 붙여 내려보낸다.
 * 부호가 잇달아 있을 수 있어(`).`) 몇 걸음은 본다 — 앞줄이 반도 안 차게 되면 그만둔다.
 */
function avoidLineHeadMark(
  word: string,
  cut: number,
  fitsHalf: (cut: number) => boolean
): number {
  let next = cut;
  for (let step = 0; step < 4; step += 1) {
    const lead = [...word.slice(next)][0];
    if (lead === undefined || !NEVER_LINE_HEAD.test(lead)) return next;
    const head = [...word.slice(0, next)];
    if (head.length < 2) return cut;
    const back = next - head[head.length - 1].length;
    if (!fitsHalf(back)) return cut;
    next = back;
  }
  return next;
}
