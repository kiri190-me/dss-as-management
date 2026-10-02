/**
 * ============================================================================
 * 명판을 **글자로** 읽었을 때 — 날것의 글에서 `Model` · `L/N` · `S/N` 뽑기
 * ============================================================================
 * QR 이 없는 2013년 구 양식 명판은 글자 인식으로밖에 읽을 수 없다. 그런데 글자
 * 인식은 **반드시 틀린다** — 실측에서 나온 날것의 글이 이렇다(2026-10-02).
 *
 *     정답 CMK150M-IC2 → "JCWKi50M—1C2" · "CWR150M—1C2" · "CWKi50M-1C2"
 *     정답 RFK150FHIC1 → "CRFRTSOFATCT" · "REKTSOFRICT"  · "RFRTSOFATCT"
 *     정답 WZ6243      → "W76243"       (Z 를 7 로 읽었다)
 *
 * 그래서 이 파일이 하는 일은 **글자를 믿지 않는 것**이다.
 *
 *  · `S/N` 은 **숫자 일곱 자리**라는 꼴에만 맞으면 받는다.
 *  · `L/N` 은 **영문 둘 + 숫자 넷**이라는 꼴에만 맞으면 받는다.
 *    🔴 `W76243` 처럼 꼴이 깨진 것은 **버린다.** 올바른 `WZ6243` 을 되살릴
 *    방법이 없기 때문이다 — 빈칸은 사람이 알아채지만 틀린 글자는 못 알아챈다.
 *  · `Model` 은 **등록된 Model 목록과 대조**해 바로잡는다. 혼동하는 글자끼리
 *    접어 놓고 편집거리로 재면 `CMK150M-IC2` 는 실측 네 번 모두 1등이었다.
 *
 * ── 🔴 비기면 고르지 않는다 ────────────────────────────────────────────
 * 우리 Model 마스터에는 **붙임표만 다른 중복**이 있다 — `CFK150FH-IC1` 과
 * `CFK150FHIC1`, `RFK150FH-IC1` 과 `RFK150FHIC1`. 같은 장비인데 구 양식은
 * 붙임표 없이, 신 양식은 붙임표를 넣어 인쇄해서 둘 다 등록된 것으로 보인다.
 * 접어서 재면 **글자 하나까지 같아져** 대조로는 절대 가를 수 없다. 이럴 때는
 * 둘을 그대로 내놓고 사람이 고르게 한다 — 마음대로 하나를 집지 않는다.
 * (마스터를 정리하는 일은 이 조각의 몫이 아니다.)
 * ============================================================================
 */

/** 글자로 읽어 낸 세 칸. 못 뽑은 칸은 `null` 이다 — **빈칸으로 둔다.** */
export type NameplateTextFields = {
  modelName: string | null;
  lotNumber: string | null;
  serialNumber: string | null;
};

/** 어떤 길로 집었는가. 보고와 시험이 「무엇이 일했는지」를 가릴 때 쓴다. */
export type ModelMatchBy = "DISTANCE" | "FRAGMENT";

/** 모델명 대조 결과. 🔴 「비김」이 「못 찾음」과 다른 갈래인 것이 핵심이다. */
export type ModelMatch =
  | { state: "MATCHED"; name: string; distance: number; by?: ModelMatchBy }
  | { state: "AMBIGUOUS"; names: string[]; distance: number; by?: ModelMatchBy }
  | { state: "NONE" };

/** 한 사진에서 글자로 읽어 낸 것 전부. */
export type NameplateTextReading = {
  /** 대조를 통과한 모델명 하나. 비겼거나 못 찾았으면 `null` 이다. */
  modelName: string | null;
  /** 모델명을 어떻게 정했는가 — 화면이 「둘 중 고르세요」를 띄울 때 본다. */
  model: ModelMatch;
  lotNumber: string | null;
  /**
   * 🔴 **자동으로 못 채웠을 때만** 내놓는 L/N 후보들(표 많은 순, 최대 다섯).
   *
   * 자동으로 채운 경우에는 **빈 목록**이다 — 이미 들어간 값 옆에 「혹시 이것들
   * 아닌가요」를 늘어놓을 까닭이 없다. 🔴 이 목록은 **사람이 눌러야** 칸에
   * 들어간다. 1등을 자동으로 넣으면 안 되는 까닭은 `suggestLotNumbers` 를 볼 것.
   */
  lotCandidates: string[];
  serialNumber: string | null;
  /** 모델명 후보로 들여다본 날것의 토막들. 보고와 시험이 본다. */
  rawTokens: string[];
};

/* ────────────────────────────────────────────────────────────────────────── *
 * 1. 글 다듬기
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * 붙임표처럼 보이는 유니코드 글자를 ASCII `-` 로 모은다.
 *
 * 글자 인식기에 흰 목록(`-` 만 허용)을 줘도 `—`(em dash) 가 섞여 나온 적이
 * 있다. 토막을 가르는 기준이 `-` 라 여기서 모아 두지 않으면 모델명이 두
 * 토막으로 갈라진다.
 */
function unifyDashes(text: string): string {
  return text.replace(/[‐-―−－]/g, "-");
}

/** 대조·꼴검사에 쓰는 한 줄 글. 대문자로 올리고 붙임표를 모은다. */
export function normalizeNameplateText(text: string): string {
  return unifyDashes(text).toUpperCase();
}

/* ────────────────────────────────────────────────────────────────────────── *
 * 2. 모델명 대조 — 혼동 글자를 접고 편집거리로 잰다
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * 🔴 **흔히 뒤바뀌는 글자끼리 하나로 접는다.** 비교할 때만 쓰는 모양이고,
 * 칸에 채우는 값은 **등록 목록의 원래 글자**다(접은 글을 되돌리지 않는다).
 *
 * 짝은 전부 실측에서 실제로 나온 오독이다(2026-10-02, 구 양식 4장):
 *   I L 1 T · O 0 D Q · S 5 · Z 2 7 · B 8 · G C 6 · U V · R P · K X · M W · E F
 *
 * 붙임표와 공백은 아예 지운다 — 구 양식은 `RFK150FHIC1`, 신 양식은
 * `RFK150FH-IC1` 로 **같은 장비를 다르게 인쇄**하기 때문이다.
 */
export function foldModelLetters(text: string): string {
  return normalizeNameplateText(text)
    .replace(/[^A-Z0-9]/g, "")
    .replace(/[ILT1]/g, "1")
    .replace(/[OQD0]/g, "0")
    .replace(/[S5]/g, "5")
    .replace(/[Z27]/g, "2")
    .replace(/[B8]/g, "8")
    .replace(/[GC6]/g, "C")
    .replace(/[UV]/g, "V")
    .replace(/[RP]/g, "R")
    .replace(/[KX]/g, "K")
    .replace(/[MW]/g, "M")
    .replace(/[EF]/g, "E");
}

/** 편집거리(Levenshtein). 짧은 글만 다루므로 단순한 두 줄짜리면 충분하다. */
export function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = new Array<number>(n + 1);
  let cur = new Array<number>(n + 1);
  for (let j = 0; j <= n; j += 1) prev[j] = j;
  for (let i = 1; i <= m; i += 1) {
    cur[0] = i;
    for (let j = 1; j <= n; j += 1) {
      const sub = prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1);
      const del = prev[j] + 1;
      const ins = cur[j - 1] + 1;
      cur[j] = Math.min(sub, del, ins);
    }
    const swap = prev;
    prev = cur;
    cur = swap;
  }
  return prev[n];
}

/**
 * 🔴 **얼마나 멀어도 같은 것으로 볼 것인가 — 접은 글자 수의 0.34 까지.**
 *
 * 이 숫자를 느슨하게 하면 「못 읽음」이 조용히 「아무 모델이나 끌어옴」으로
 * 바뀐다. 0.34 로 정한 근거는 실측한 토막 전부의 분포다(2026-10-02, 구 양식
 * 4장 × 18조합에서 나온 모델명 후보 토막 14개):
 *
 *   0.00  CMK150M-1C2          → CMK150M-IC2   맞음
 *   0.08  TCFKT50FHICT         → CFK150FH*     맞음
 *   0.09  JCMK150M-1C2         → CMK150M-IC2   맞음
 *   0.27  CFRIB0PHICT          → CFK150FH*     맞음
 *   0.33  RFKTEOFTCTJ8         → RFK150FH*     맞음   ← 받아들이는 끝
 *   ───────────────────────────────────────────── 0.34
 *   0.38  RFRTEOFITCT38        → RFK150FH*     (맞지만 버린다)
 *   0.44  GFRISOFHIGTSRIRF50   → CFK150FH*     🔴 **틀렸다**(RFK 사진이다)
 *   0.50~ WA176204 · TR26ISEW · TRGE2013 → TG-200 · TG-150 … 전부 쓰레기
 *
 * 🔴 **0.44 를 넘기면 틀린 모델이 들어온다.** 올리고 싶어지면 위 줄을 먼저
 * 볼 것 — 0.38 한 줄을 더 얻자고 0.44 까지 열면 그 사진은 오답이 된다.
 *
 * 길이로 나누는 까닭은 모델명 길이가 5(`TG-100` 을 접으면 `1C100`)에서
 * 11(`RFK150FHIC1`)까지 제각각이라, 절대 거리로 재면 짧은 이름이 아무
 * 쓰레기 토막에나 들러붙기 때문이다.
 */
export const MODEL_MATCH_MAX_RATIO = 0.34;

/** 모델명 후보로 삼을 토막의 최소 길이. 이보다 짧으면 아무 모델에나 가깝다. */
const MIN_TOKEN_LENGTH = 6;

/**
 * 🔴 한 줄에서 **이어 붙여 볼 토막 수** — 1칸(그대로) · 2칸 · 3칸.
 *
 * 구 양식 명판은 모델명을 **표의 두 칸에 나눠** 인쇄한다:
 *
 *     MBK │ 150M-IC1 │ S/N │ 1309015
 *     Wt  │  22  kg  │ L/N │ WZ6293
 *
 * 사이에 세로 테두리가 있어 글자 인식기가 공백이나 `|` 를 끼운다. 그래서
 * `MBK150M-IC1` 이라는 토막은 **사진 어디에도 없다.** 실측에서 배율 6가지 ×
 * 기울기 3가지 × 뒤집기 2가지 × 이진화 2가지 × psm 2가지를 다 돌려도 정답
 * 문자열이 한 번도 안 나온 까닭이 이것이다 — 글자가 안 읽혀서가 아니라
 * **붙어 있지 않아서**다.
 *
 * 🔴 **줄을 넘어 붙이지 않는다.** 아래 줄의 `Wt 22 kg` 이 딸려 오면 엉뚱한
 * 모델이 된다. 그래서 줄 단위로 끊어 놓고 그 안에서만 잇는다.
 */
const MODEL_JOIN_SPANS = [1, 2, 3];

/** 모델명 후보로 쓸 만한 꼴인가. 글자와 숫자가 **둘 다** 있어야 한다. */
function isModelLike(token: string): boolean {
  return token.length >= MIN_TOKEN_LENGTH && /[A-Z]/.test(token) && /[0-9]/.test(token);
}

/**
 * 날것의 글에서 **모델명일 법한 토막**을 고른다 — 한 칸짜리와 **이어 붙인 것**.
 *
 * 붙임표를 품은 채로 자른다 — `CMK150M-IC2` 를 `-` 에서 가르면 대조가
 * 무너진다. 글자와 숫자가 **둘 다** 들어 있는 것만 본다(`1307009` 같은
 * 일련번호를 모델명으로 끌고 가지 않게).
 *
 * 이어 붙인 것을 더해도 **한 칸짜리는 그대로 남는다.** `CMK150M-IC2` 처럼 한
 * 칸에 다 들어 있는 명판은 지금까지와 똑같이 읽혀야 한다.
 */
export function collectModelTokens(text: string): string[] {
  const tokens: string[] = [];
  for (const line of normalizeNameplateText(text).split(/\r?\n/)) {
    const cells = (line.match(/[A-Z0-9-]+/g) ?? [])
      .map((cell) => cell.replace(/^-+|-+$/g, ""))
      .filter((cell) => cell.length > 0);
    for (let i = 0; i < cells.length; i += 1) {
      for (const span of MODEL_JOIN_SPANS) {
        if (i + span > cells.length) break;
        const parts = cells.slice(i, i + span);
        // 🔴 한 글자짜리 칸은 **이어 붙이지 않는다.** `S/N` 이 `S` 와 `N` 으로
        //    갈려 들어오는데, 그것을 뒤 숫자에 붙이면 `SN1307009` 같은 가짜
        //    모델명 후보가 패스마다 쏟아진다. 모델명이 나뉘는 칸
        //    (`MBK` + `150M-IC1`)은 어느 쪽도 두 글자 아래로 내려가지 않는다.
        if (span > 1 && parts.some((part) => part.length < 2)) continue;
        const joined = parts.join("");
        if (isModelLike(joined)) tokens.push(joined);
      }
    }
  }
  return tokens;
}

/** 토막 하나에 가장 가까운 등록 모델들(거리가 같으면 전부). 멀면 빈 목록. */
function nearestModels(
  token: string,
  folded: ReadonlyMap<string, string>
): { names: string[]; distance: number } | null {
  const target = foldModelLetters(token);
  if (!target) return null;
  let best = Number.POSITIVE_INFINITY;
  let names: string[] = [];
  for (const [name, model] of folded) {
    const distance = editDistance(target, model);
    const ratio = distance / Math.max(target.length, model.length);
    if (ratio > MODEL_MATCH_MAX_RATIO) continue;
    if (distance < best) {
      best = distance;
      names = [name];
    } else if (distance === best) {
      names.push(name);
    }
  }
  if (names.length === 0) return null;
  return { names: names.slice().sort((a, b) => a.localeCompare(b)), distance: best };
}

/* ────────────────────────────────────────────────────────────────────────── *
 * 2-나. 🔴 조각으로 집기 — 모델명이 **두 칸에 나뉘어** 인쇄된 명판
 *
 * 구 양식은 모델명을 표의 두 칸에 나눠 찍는데, 그 두 칸의 **바탕색이 반대**다:
 *
 *     MBK        ← 검은 바탕에 **흰** 글자
 *     150M-IC1   ← 흰 바탕에 **검은** 글자
 *
 * 그래서 **한 패스 안에서는 둘이 같이 읽히지 않는다** — 뒤집지 않은 그림에서는
 * `150M-IC1` 만, 뒤집은 그림에서는 `MBK` 만 나온다. 위의 「이웃 토막 이어
 * 붙이기」로는 `MBK150M-IC1` 이 영영 안 만들어진다(2026-10-02 실측).
 *
 * 그래서 **조각 하나로 등록 목록을 좁힌다.** `150M-IC1` 로 끝나는 등록 모델은
 * 104개 중 `MBK150M-IC1` 하나뿐이라, 그 꼬리만 읽혀도 모델을 집을 수 있다.
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * 🔴 **조각은 접은 글자 여섯 자 이상만 본다.** 짧으면 아무 데나 걸린다.
 *
 * 등록 모델 104개로 재 본 숫자(2026-10-02):
 *
 *   `IC1`      (접어서 3자) → **15개**에 걸린다
 *   `M-IC1`    (접어서 4자) → 4개
 *   `0M-IC1`   (접어서 5자) → 4개
 *   `50M-IC1`  (접어서 6자) → **1개** (MBK150M-IC1)   ← 여기서부터 쓸 만하다
 *   `150M-IC1` (접어서 7자) → 1개
 *
 * 그리고 실측에서 나온 **쓰레기 토막 스물한 개**(`WA176204` `TRGE2013`
 * `60HZIEEIA` `AUTOMATCHINGBOX` …)를 같은 자로 재 보니, 여섯 자 기준에서
 * 엉뚱한 모델을 집은 것은 **하나도 없었다**(유일하게 걸린 것은
 * `JCWKI150M-1C2INJAN1307009` → CMK150M-IC2 로, 그 사진의 **정답**이다).
 */
export const MODEL_FRAGMENT_LENGTH = 6;

/** 접은 등록 모델 이름의 여섯 글자 조각 → 그 조각을 품은 모델들. */
function buildFragmentIndex(models: readonly string[]): Map<string, string[]> {
  const index = new Map<string, string[]>();
  for (const name of models) {
    const key = foldModelLetters(name);
    const seen = new Set<string>();
    for (let i = 0; i + MODEL_FRAGMENT_LENGTH <= key.length; i += 1) {
      const gram = key.slice(i, i + MODEL_FRAGMENT_LENGTH);
      if (seen.has(gram)) continue;
      seen.add(gram);
      const bucket = index.get(gram);
      if (bucket) bucket.push(name);
      else index.set(gram, [name]);
    }
  }
  return index;
}

/**
 * 토막의 조각으로 등록 모델을 집는다 — 🔴 **딱 하나만 걸릴 때만** 쓴다.
 *
 * 둘 이상 걸리는 조각은 아무 말도 하지 않은 것과 같으므로 버린다(그래서
 * `IC1` 같은 꼬리가 열다섯 개를 끌고 오는 일이 생기지 않는다). 하나만 걸린
 * 조각이 여럿이면 가장 많이 걸린 모델을 고르고, 비기면 사람에게 넘긴다.
 */
export function decideModelByFragment(
  tokens: readonly string[],
  models: readonly string[]
): ModelMatch {
  const index = buildFragmentIndex(models);
  if (index.size === 0) return { state: "NONE" };
  const votes = new Map<string, number>();
  for (const token of tokens) {
    const key = foldModelLetters(token);
    const counted = new Set<string>();
    for (let i = 0; i + MODEL_FRAGMENT_LENGTH <= key.length; i += 1) {
      const bucket = index.get(key.slice(i, i + MODEL_FRAGMENT_LENGTH));
      // 🔴 둘 이상에 걸리는 조각은 버린다.
      if (!bucket || bucket.length !== 1) continue;
      const name = bucket[0];
      // 한 토막이 같은 모델에 여러 조각으로 걸려도 한 표다.
      if (counted.has(name)) continue;
      counted.add(name);
      votes.set(name, (votes.get(name) ?? 0) + 1);
    }
  }
  if (votes.size === 0) return { state: "NONE" };
  let top = 0;
  for (const count of votes.values()) if (count > top) top = count;
  const leaders = [...votes.entries()]
    .filter(([, count]) => count === top)
    .map(([name]) => name)
    .sort((a, b) => a.localeCompare(b));
  if (leaders.length === 1) {
    return { state: "MATCHED", name: leaders[0], distance: 0, by: "FRAGMENT" };
  }
  return { state: "AMBIGUOUS", names: leaders, distance: 0, by: "FRAGMENT" };
}

/**
 * 여러 조합에서 나온 토막들을 모아 **모델명 하나**를 정한다.
 *
 * 토막마다 「가장 가까운 등록 모델들」을 뽑고, **그 자리에 든 횟수**로 센다.
 * 가장 많이 든 모델이 하나뿐이면 그것이 답이고, 여럿이면 비긴 것이다.
 *
 * 🔴 비기는 일은 실제로 일어난다 — `RFK150FH-IC1` 과 `RFK150FHIC1` 은 접으면
 * 완전히 같은 글이라 **어느 토막에서든 늘 함께** 1등이 된다.
 *
 * 🔴 **조각 집기는 「온전한 토막」이 아무 말도 못 했을 때만 쓴다**(뒤로 물러서
 * 있다). 차례를 바꾸거나 둘을 섞으면, 지금 온전한 토막으로 제대로 맞히고 있는
 * 사진(`092806579` 의 `CMK150M-1C2`)이 조각 쪽 표에 밀려 비길 수 있다 —
 * 멀쩡히 되던 것을 깨지 않으려고 이 차례로 둔다.
 */
export function decideModelName(
  tokens: readonly string[],
  models: readonly string[]
): ModelMatch {
  const folded = new Map<string, string>();
  for (const name of models) {
    const key = foldModelLetters(name);
    if (key) folded.set(name, key);
  }
  if (folded.size === 0) return { state: "NONE" };

  const votes = new Map<string, number>();
  const closest = new Map<string, number>();
  for (const token of tokens) {
    const near = nearestModels(token, folded);
    if (!near) continue;
    for (const name of near.names) {
      votes.set(name, (votes.get(name) ?? 0) + 1);
      const had = closest.get(name);
      if (had === undefined || near.distance < had) closest.set(name, near.distance);
    }
  }
  if (votes.size === 0) return decideModelByFragment(tokens, models);

  let top = 0;
  for (const count of votes.values()) if (count > top) top = count;
  const leaders = [...votes.entries()]
    .filter(([, count]) => count === top)
    .map(([name]) => name)
    .sort((a, b) => a.localeCompare(b));

  const distance = Math.min(...leaders.map((name) => closest.get(name) ?? 0));
  if (leaders.length === 1) return { state: "MATCHED", name: leaders[0], distance, by: "DISTANCE" };
  return { state: "AMBIGUOUS", names: leaders, distance, by: "DISTANCE" };
}

/* ────────────────────────────────────────────────────────────────────────── *
 * 3. L/N · S/N — 꼴로만 거른다
 * ────────────────────────────────────────────────────────────────────────── */

/** `S/N` 이라는 말. 빗금이 `1` `I` `\` `|` 로 읽히는 일이 잦다. */
const SERIAL_MARKER = /S[\s/\\|1IL.:-]{0,3}N/g;
/** `L/N` 이라는 말. `L` 자체가 `I` `1` 로 읽히기도 한다. */
const LOT_MARKER = /[L1I|][\s/\\|1IL.:-]{0,3}N/g;

/**
 * 🔴 S/N 의 꼴 — **숫자 일곱 자리**. 앞뒤로 숫자가 더 붙으면 아니다.
 *
 * 글자가 붙어 있는 것은 허용한다(`JA1307006` → `1307006`). 글자 인식기가
 * 표의 세로선을 글자로 읽어 값에 들러붙는 일이 잦은데, **숫자 일곱 자리가
 * 어디서 시작하는지는 그래도 분명하기** 때문이다. 실측에서 이 허용이 두 장을
 * 살렸다(`...IYANE1307006` · `...JRPIE1307006`).
 */
const SERIAL_SHAPE = /(?<![0-9])[0-9]{7}(?![0-9])/g;

/**
 * 🔴 L/N 의 꼴 — **영문 둘 + 숫자 넷**. S/N 과 달리 **앞뒤가 깨끗해야만**
 * 받는다(글자도 숫자도 붙어 있으면 안 된다).
 *
 * 차별하는 까닭은 **영문 두 글자가 어디서 시작하는지 알 수 없기** 때문이다.
 * 실측에서 글자가 붙은 것까지 받아 보니 이렇게 됐다(2026-10-02):
 *
 *   `UA50SWIYZ6204` → `YZ6204`  🔴 정답은 WZ6204 (W 를 Y 로 읽었다)
 *   `WWZ6241`       → `WZ6241`  🔴 정답은 WZ6247 (7 을 1 로 읽었다)
 *
 * 두 장을 더 「읽었다」고 세는 대신 **두 장에 틀린 값을 적는** 거래였다.
 * 느슨하게 되돌리지 마라 — L/N 은 사람이 명판을 다시 보지 않으면 틀린 줄
 * 모르는 값이다.
 *
 * 🔴 **첫 글자는 `W` 여야 한다.** 지금까지 확인한 L/N 열셋이 전부 `W` 로
 * 시작한다(WN6445 · WT6397 · WU7801 · WT9844 · WZ6243 · WZ6247 · WZ6204 ·
 * WZ6216 · WZ6293 · WV4970 · WV4968 · WV4480 · WN8532). 이 한 글자를 안 걸면
 * **명판의 제조년이 L/N 으로 들어간다** — 2026-10-02 다섯째 표본에서 날짜
 * 칸의 `…NE 2013.7` 이 `NE2013` 으로 잡혀 **틀린 로트번호가 자동으로
 * 채워졌다.** 후보 쪽(`suggestLotNumbers`)이 쓰는 규칙과 같은 것이다.
 */
const LOT_SHAPE = /(?<![A-Z0-9])W[A-Z][0-9]{4}(?![A-Z0-9])/g;

/** 말머리 바로 뒤라고 볼 거리(글자 수). 구 양식은 `S/N 1307009` 로 붙어 있다. */
const MARKER_REACH = 12;

type ShapeHit = { value: string; nearMarker: boolean };

/** 한 조합의 글에서 꼴에 맞는 값을 전부 집는다 — 말머리 뒤인지도 함께. */
function collectShape(text: string, shape: RegExp, marker: RegExp): ShapeHit[] {
  const norm = normalizeNameplateText(text);
  const markerEnds: number[] = [];
  marker.lastIndex = 0;
  for (let m = marker.exec(norm); m; m = marker.exec(norm)) markerEnds.push(m.index + m[0].length);

  const hits: ShapeHit[] = [];
  shape.lastIndex = 0;
  for (let m = shape.exec(norm); m; m = shape.exec(norm)) {
    const start = m.index;
    const nearMarker = markerEnds.some((end) => start >= end && start - end <= MARKER_REACH);
    hits.push({ value: m[0], nearMarker });
  }
  return hits;
}

/** 글에서 S/N 꼴을 전부 집는다. */
export function collectSerialNumbers(text: string): ShapeHit[] {
  return collectShape(text, SERIAL_SHAPE, SERIAL_MARKER);
}

/** 글에서 L/N 꼴을 전부 집는다. */
export function collectLotNumbers(text: string): ShapeHit[] {
  return collectShape(text, LOT_SHAPE, LOT_MARKER);
}

/**
 * 여러 조합에서 나온 값들로 투표한다.
 *
 * 차례는 **말머리 뒤에서 나온 횟수 → 전체 횟수** 다. 🔴 **둘 다 비기면
 * 고르지 않는다** — 서로 다른 두 값이 똑같이 자주 나왔다면 어느 쪽이 맞는지
 * 알 길이 없고, 그 자리에서 찍으면 절반은 틀린 값이 칸에 적힌다.
 */
export function decideByVote(hits: readonly ShapeHit[]): string | null {
  if (hits.length === 0) return null;
  const marked = new Map<string, number>();
  const total = new Map<string, number>();
  for (const hit of hits) {
    total.set(hit.value, (total.get(hit.value) ?? 0) + 1);
    if (hit.nearMarker) marked.set(hit.value, (marked.get(hit.value) ?? 0) + 1);
  }
  const ranked = [...total.keys()].sort((a, b) => {
    const byMarked = (marked.get(b) ?? 0) - (marked.get(a) ?? 0);
    if (byMarked !== 0) return byMarked;
    return (total.get(b) ?? 0) - (total.get(a) ?? 0);
  });
  if (ranked.length === 1) return ranked[0];
  const first = ranked[0];
  const second = ranked[1];
  const tied =
    (marked.get(first) ?? 0) === (marked.get(second) ?? 0) &&
    (total.get(first) ?? 0) === (total.get(second) ?? 0);
  return tied ? null : first;
}

/* ────────────────────────────────────────────────────────────────────────── *
 * 3-나. L/N 후보 — 🔴 **사람이 고르게** 내놓는다. 자동으로 넣지 않는다.
 *
 * 위 `LOT_SHAPE` 는 「토막 **전체**가 영문 둘 + 숫자 넷」일 때만 받는다. 그
 * 깐깐함이 틀린 값을 막고 있고(실측: `WWZ6241` · `W76243` · `YZ6204` 가 전부
 * 그 문에서 걸렸다) **절대 풀지 않는다.** 대신 그 문에 걸려 아무것도 못 채운
 * 사진에서, 날것의 글을 여섯 글자씩 훑어 **후보 목록**을 만든다.
 *
 * 🔴 **왜 1등을 자동으로 넣으면 안 되는가 — 숫자가 말한다**(2026-10-02 실측,
 * 구 양식 4장 × 18조합):
 *
 *   092832456   정답 WZ6204 → **WZ6204(4표)** · WA1762(3) · WA5010(2) …  1등이 정답
 *   092949573_01 정답 WZ6216 → **WZ6216(4표)** · WW2621(2) …             1등이 정답
 *   092949573   정답 WZ6247 → **WZ6241(4표)** · WW2624(2) …  🔴 **정답이 후보에 없다**
 *   092806579   정답 WZ6243 → WK1150(2) · WA1307(1) · WA2013(1) · **WZ6243(1)** …
 *
 * 틀린 `WZ6241` 이 맞는 것들과 **똑같이 4표**다. 표 수로 거르는 어떤 기준도
 * 둘을 가르지 못한다 — 1등을 자동으로 채우면 **4장 중 2장이 틀린 값**이 된다.
 * 그래서 「고르세요」까지만 한다. 그리고 **맞는 것이 아예 없을 수 있다**는 말을
 * 화면에 함께 적어야 한다(092949573 이 실제로 그렇다).
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * 🔴 첫 글자는 `W` 로 좁힌다.
 *
 * 지금까지 확인한 L/N 열둘이 **전부** `W` 로 시작한다 — WN6445 · WT6397 ·
 * WU7801 · WT9844 · WZ6243 · WZ6247 · WZ6204 · WZ6216 · WV4970 · WV4968 ·
 * WV4480 · WN8532. 그래서 첫 글자가 `V Y M U` 로 읽힌 것은 `W` 를 잘못 읽은
 * 것으로 보고, 그 밖의 글자로 시작하는 창은 아예 버린다(후보가 수십 개로
 * 불어나면 사람이 고를 수 없다).
 */
const LOT_FIRST_LOOKALIKES = new Set(["W", "V", "Y", "M", "U"]);

/** 글자 자리에 숫자가 왔을 때 되돌리는 짝. */
const DIGIT_TO_LETTER: Record<string, string> = {
  "0": "O",
  "1": "I",
  "2": "Z",
  "5": "S",
  "6": "G",
  "7": "Z",
  "8": "B",
};

/** 숫자 자리에 글자가 왔을 때 되돌리는 짝. */
const LETTER_TO_DIGIT: Record<string, string> = {
  O: "0",
  I: "1",
  L: "1",
  Z: "2",
  S: "5",
  G: "6",
  B: "8",
  T: "1",
  A: "4",
};

/**
 * 여섯 글자 창 하나를 **L/N 의 자리에 맞춰** 고친다. 못 고치면 `null`.
 *
 * 앞 둘은 글자여야 하고 뒤 넷은 숫자여야 한다는 것만 쓴다 — 어느 자리에
 * 무엇이 와야 하는지가 정해져 있으니, 글자 인식이 그 자리에서 틀린 종류는
 * 뻔하다(`7` 로 읽힌 `Z`, `I` 로 읽힌 `1` 따위).
 */
export function repairLotShape(window: string): string | null {
  if (window.length !== 6) return null;
  const first = window[0];
  if (!LOT_FIRST_LOOKALIKES.has(first)) return null;
  const out = ["W"];

  const second = window[1];
  if (/[A-Z]/.test(second)) out.push(second);
  else if (DIGIT_TO_LETTER[second]) out.push(DIGIT_TO_LETTER[second]);
  else return null;

  for (let i = 2; i < 6; i += 1) {
    const c = window[i];
    if (/[0-9]/.test(c)) out.push(c);
    else if (LETTER_TO_DIGIT[c]) out.push(LETTER_TO_DIGIT[c]);
    else return null;
  }
  return out.join("");
}

/** 후보를 몇 개까지 보일 것인가. 사람이 사진과 눈으로 맞출 수 있는 수다. */
export const LOT_CANDIDATE_LIMIT = 5;

/**
 * 날것의 글 전부를 여섯 글자씩 훑어 L/N 후보를 표 많은 순으로 모은다.
 *
 * 창은 **글자·숫자가 끊기지 않고 이어진 토막 안에서만** 민다(`CMK150M-1C2`
 * 처럼 붙임표로 끊긴 자리를 건너뛰지 않는다). 표가 같으면 가나다순으로 — 같은
 * 사진에서 늘 같은 차례가 나와야 시험이 뜻을 가진다.
 *
 * 🔴 **이 목록은 자동으로 채우는 값이 아니다.** 위 머리글의 숫자를 볼 것.
 */
export function suggestLotNumbers(
  texts: readonly string[],
  limit: number = LOT_CANDIDATE_LIMIT
): string[] {
  const votes = new Map<string, number>();
  for (const text of texts) {
    const runs = normalizeNameplateText(text).match(/[A-Z0-9]+/g) ?? [];
    for (const run of runs) {
      for (let i = 0; i + 6 <= run.length; i += 1) {
        const fixed = repairLotShape(run.slice(i, i + 6));
        if (fixed) votes.set(fixed, (votes.get(fixed) ?? 0) + 1);
      }
    }
  }
  return [...votes.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([value]) => value);
}

/* ────────────────────────────────────────────────────────────────────────── *
 * 4. 한 사진의 결론
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * 조합마다 나온 글을 **전부 합쳐** 세 칸을 정한다.
 *
 * 🔴 어느 한 조합이 셋을 다 주지 않는다 — 뒤집은 그림에서 흰 글자(`L/N`)가
 * 나오고, 안 뒤집은 그림에서 검은 글자(값)가 나온다. 구 양식 명판은 한 표
 * 안에 흰 바탕과 검은 바탕이 섞여 있기 때문이다.
 */
export function readNameplateFromTexts(
  texts: readonly string[],
  models: readonly string[]
): NameplateTextReading {
  const tokens: string[] = [];
  const serials: ShapeHit[] = [];
  const lots: ShapeHit[] = [];
  for (const text of texts) {
    tokens.push(...collectModelTokens(text));
    serials.push(...collectSerialNumbers(text));
    lots.push(...collectLotNumbers(text));
  }
  const model = decideModelName(tokens, models);
  const lotNumber = decideByVote(lots);
  return {
    modelName: model.state === "MATCHED" ? model.name : null,
    model,
    lotNumber,
    // 🔴 자동으로 채운 사진에는 후보를 내놓지 않는다.
    lotCandidates: lotNumber === null ? suggestLotNumbers(texts) : [],
    serialNumber: decideByVote(serials),
    rawTokens: tokens,
  };
}

/**
 * 🔴 **2단계가 1단계를 뒤집지 못하게 막는다.**
 *
 * 2단계(「더 자세히 읽기」)는 배율·기울기를 더 쓸어 글을 많이 모은다. 그런데
 * 글이 많아지면 **비슷한 오답도 같이 늘어** 투표를 뒤집는 일이 실제로 있었다
 * (실측: 모델명이 `DEMO-GENERATOR-016` 으로 바뀌기까지 했다). 그래서 1단계가
 * 이미 정한 칸은 **그대로 두고**, 1단계가 비워 둔 칸만 2단계 결과로 본다.
 *
 * 후보 목록은 둘을 합친다 — 후보는 어차피 사람이 눌러야 들어가므로 많을수록
 * 고를 거리가 늘 뿐이다.
 */
export function keepEarlierReading(
  earlier: NameplateTextReading,
  later: NameplateTextReading
): NameplateTextReading {
  const mergedCandidates = [...earlier.lotCandidates];
  for (const value of later.lotCandidates) {
    if (!mergedCandidates.includes(value)) mergedCandidates.push(value);
  }
  return {
    modelName: earlier.modelName,
    model: earlier.model.state === "NONE" ? later.model : earlier.model,
    lotNumber: earlier.lotNumber,
    lotCandidates: earlier.lotNumber === null ? mergedCandidates.slice(0, LOT_CANDIDATE_LIMIT) : [],
    serialNumber: earlier.serialNumber,
    rawTokens: [...earlier.rawTokens, ...later.rawTokens],
  };
}

/**
 * 2단계가 **새로 찾았지만 1단계가 비워 둔** 칸들.
 *
 * 🔴 **자동으로 채우지 않는다.** 화면이 단추로 보여 주고 사람이 누른다 —
 * 2단계에서 나온 값은 실측에서 틀린 적이 있다(`1301013` · `DEMO-GENERATOR-016`).
 */
export function offeredByDeeperRead(
  earlier: NameplateTextReading,
  later: NameplateTextReading
): NameplateTextFields {
  return {
    modelName: earlier.modelName === null ? later.modelName : null,
    lotNumber: earlier.lotNumber === null ? later.lotNumber : null,
    serialNumber: earlier.serialNumber === null ? later.serialNumber : null,
  };
}

/* ────────────────────────────────────────────────────────────────────────── *
 * 4-나. S/N 으로 **등록된 장비를 찾아 보여 준다** — 🔴 채우지는 않는다
 *
 * 세 칸을 다 사진에서 캐내려 애쓸 까닭이 없다. 실측에서 잘 읽히는 것은 S/N
 * 하나뿐이고(5장 중 4장 · Model 2/5 · L/N 1/5), 장비는 이미 `products` 에
 * model·S/N·L/N 과 함께 등록돼 있다. 글자 인식이 그렇게 애써도 못 읽던
 * `WZ6243` 이 `S/N 1307009` 행에 그냥 들어 있다.
 *
 * ── 🔴 **S/N 은 고유키가 아니다. 한 대만 나와도 채우지 않는다.** ────────
 * 같은 S/N 에 다른 모델·다른 L/N 인 장비가 실제로 있다(2026-10-02 사용자
 * 지적, 개발 DB 로 확인):
 *
 *     2210294 → CFK200FH-IC3 / WV0097
 *     2210294 → MBK200-JS2   / wv7615
 *     2210294 → MBK300M-IC2  / WN4809     ← 한 S/N 에 모델 셋
 *     2210149 → MBK200-JS2   / WV0097
 *     2210149 → MBK200-JS2   / WN4040     ← 같은 모델인데 L/N 둘
 *
 * 🔴 **우리 시험 표본 다섯 장 안에도 이미 있다:**
 *
 *     1307006 → RFK150FHIC1 / WZ6204   (092832456)
 *     1307006 → CFK150FHIC1 / WZ6216   (092949573_01)
 *
 * 그래서 「딱 한 대가 나오면 확정」은 **더 위험하다** — 둘 중 하나만 등록돼
 * 있으면 한 대만 나오고, 그러면 확신하고 **남의 장비 값을 적는다.**
 * 게다가 사용자 말로 **처음 들어오는 제품이 더 많아** 조회가 맞는 경우 자체가
 * 드물다. 이 길은 **덤이지 주된 길이 아니다.**
 *
 * → 찾은 것을 **Model·L/N 짝으로** 늘어놓고 사람이 사진과 맞춰 고른다.
 *   🔴 **짝을 깨지 마라** — 모델은 이 장비 것, L/N 은 저 장비 것이 되면 안 된다.
 * ────────────────────────────────────────────────────────────────────────── */

/** `products` 에서 찾은 장비 한 대. DB 조회가 돌려주는 모양 그대로다. */
export type RegisteredProduct = {
  id: string;
  modelName: string;
  serialNumber: string | null;
  lotNumber: string | null;
};

/** 사람에게 내놓을 한 줄. 🔴 **고르기 전에는 아무 칸도 안 채워진다.** */
export type RegisteredProductChoice = {
  product: RegisteredProduct;
  /** 사진에서 읽은 모델과 **일치**하는 줄. 맨 위에 두고 그렇다고 적는다. */
  matchesReadModel: boolean;
};

function sameName(a: string, b: string): boolean {
  return a.trim().toUpperCase() === b.trim().toUpperCase();
}

/**
 * 찾은 장비들을 **고를 수 있게** 줄 세운다. 🔴 고르는 것은 사람이다.
 *
 * 글자 인식이 읽은 모델과 **정확히 하나만** 맞아떨어질 때에만 그 줄을 맨
 * 위로 올리고 표시한다. 둘 이상 맞으면 표시하지 않는다 — 「일치」라고 적어
 * 놓고 여럿이면 그 말이 아무 도움이 안 되고, 맨 위 줄을 믿게만 만든다.
 */
export function rankRegisteredProducts(
  rows: readonly RegisteredProduct[],
  reading: NameplateTextFields
): RegisteredProductChoice[] {
  const read = reading.modelName;
  const matching = read ? rows.filter((row) => sameName(row.modelName, read)) : [];
  const only = matching.length === 1 ? matching[0] : null;
  return rows
    .map((product) => ({ product, matchesReadModel: only !== null && product.id === only.id }))
    .sort((a, b) => {
      if (a.matchesReadModel !== b.matchesReadModel) return a.matchesReadModel ? -1 : 1;
      return (
        a.product.modelName.localeCompare(b.product.modelName) ||
        a.product.id.localeCompare(b.product.id)
      );
    });
}

/** 고른 장비 한 대가 채울 두 칸. 🔴 **짝으로** 움직인다. */
export function fieldsFromRegisteredProduct(product: RegisteredProduct): NameplateTextFields {
  return {
    modelName: product.modelName.trim() ? product.modelName.trim() : null,
    lotNumber: product.lotNumber?.trim() ? product.lotNumber.trim() : null,
    serialNumber: null,
  };
}

/* ────────────────────────────────────────────────────────────────────────── *
 * 5. 어느 칸을 채울 것인가
 * ────────────────────────────────────────────────────────────────────────── */

/** 접수폼에서 이 기능이 건드릴 수 있는 칸들의 현재 값. */
export type NameplateTextCurrent = {
  modelName: string;
  lotNumber: string;
  serialNumber: string;
};

/** 이 칸을 채운 것이 무엇인가. 🔴 QR 로 들어온 값은 글자 인식이 덮지 않는다. */
export type NameplateFieldKey = keyof NameplateTextCurrent;

export type NameplateFillPlan = {
  /** 실제로 바꿀 칸들. 비어 있으면 바꿀 것이 없다. */
  patch: Partial<NameplateTextCurrent>;
  /** 이미 적혀 있던 것을 **덮어쓴** 칸들. 알림이 이것을 따로 말한다. */
  overwritten: NameplateFieldKey[];
  /** QR 이 채워 둬서 **일부러 비켜 간** 칸들. */
  keptFromQr: NameplateFieldKey[];
};

/**
 * 채울 칸을 고른다.
 *
 * ── 🔴 세 가지 규칙 ────────────────────────────────────────────────────
 *  1. **빈칸은 언제나 채운다.**
 *  2. **이미 적힌 칸은 `overwrite` 일 때만 덮는다.** 사람이 「이 영역으로
 *     읽기」를 **다시** 누른 것이 그 신호다 — 첫 판에 손으로 적어 둔 값을
 *     날리면 안 되고, 두 번째부터는 「아까 읽은 게 틀려서 다시 읽는다」는
 *     뜻이므로 덮는 쪽이 맞다(2026-10-02 사용자 요청).
 *  3. 🔴 **QR 로 들어온 값은 덮지 않는다.** QR 에는 오류 정정 부호가 있어
 *     읽혔으면 맞고, 글자 인식에는 그런 장치가 없다. **확실한 것을 불확실한
 *     것으로 덮는 것**은 어느 쪽으로도 득이 없다.
 *
 * 못 뽑은 칸(`null`)은 어느 경우에도 건드리지 않는다 — 글자 인식이 실패한
 * 자리를 빈칸으로 두는 것이 이 기능의 안전장치다.
 */
export function planNameplateTextFill(
  reading: NameplateTextFields,
  current: NameplateTextCurrent,
  options?: {
    /** 두 번째 읽기부터 `true`. */
    overwrite?: boolean;
    /** QR 이 채운 칸들 — 덮지 않는다. */
    lockedByQr?: readonly NameplateFieldKey[];
  }
): NameplateFillPlan {
  const overwrite = options?.overwrite ?? false;
  const locked = new Set(options?.lockedByQr ?? []);
  const patch: Partial<NameplateTextCurrent> = {};
  const overwritten: NameplateFieldKey[] = [];
  const keptFromQr: NameplateFieldKey[] = [];

  for (const key of FIELD_ORDER) {
    const value = reading[key];
    if (!value) continue;
    const taken = current[key].trim().length > 0;
    if (!taken) {
      patch[key] = value;
      continue;
    }
    if (!overwrite) continue;
    if (locked.has(key)) {
      keptFromQr.push(key);
      continue;
    }
    // 같은 값이면 덮었다고 떠들 까닭이 없다.
    if (current[key].trim() === value) continue;
    patch[key] = value;
    overwritten.push(key);
  }
  return { patch, overwritten, keptFromQr };
}

const FIELD_LABELS: Record<keyof NameplateTextCurrent, string> = {
  modelName: "Model",
  lotNumber: "L/N",
  serialNumber: "S/N",
};

const FIELD_ORDER: (keyof NameplateTextCurrent)[] = ["modelName", "lotNumber", "serialNumber"];

/** 하나도 못 뽑았을 때의 글. 지시서의 문장 그대로다. */
export const NAMEPLATE_TEXT_EMPTY_MESSAGE = "글자로도 읽지 못했습니다. 직접 입력해 주세요.";

/** 읽기는 했는데 채울 빈칸이 없었을 때. */
export const NAMEPLATE_TEXT_ALL_TAKEN_MESSAGE =
  "글자로 읽었지만 해당 칸이 이미 채워져 있어 그대로 두었습니다.";

/**
 * 등록된 장비에서 가져왔을 때의 한 줄.
 *
 * 🔴 **글자 인식이 읽은 값과 말을 다르게 한다.** 이쪽은 사진에서 캐낸 글자가
 * 아니라 **저장돼 있던 값**이라 글자 자체는 정확하다 — 그런데도 「확인 필요」를
 * 떼지 않는 까닭은 **그 S/N 이 잘못 읽혔을 수 있기** 때문이다. 둘을 같은
 * 문장으로 말하면 사람이 무엇을 확인해야 하는지 알 수 없다.
 */
export function summarizeRegisteredFill(
  plan: NameplateFillPlan,
  serialNumber: string
): string {
  const filled = FIELD_ORDER.filter((key) => plan.patch[key] !== undefined).map(
    (key) => `${FIELD_LABELS[key]} ${plan.patch[key]}`
  );
  const tail: string[] = [];
  if (plan.overwritten.length > 0) {
    tail.push(
      `다시 읽어 ${plan.overwritten.map((key) => FIELD_LABELS[key]).join(" · ")} 칸을 덮어썼습니다.`
    );
  }
  if (plan.keptFromQr.length > 0) {
    tail.push(
      `${plan.keptFromQr.map((key) => FIELD_LABELS[key]).join(" · ")} 은 QR 로 읽은 값이라 그대로 두었습니다.`
    );
  }
  if (filled.length === 0) {
    return [
      `S/N ${serialNumber} 으로 등록된 장비를 찾았지만 채울 빈칸이 없었습니다.`,
      ...tail,
    ].join(" ");
  }
  return [
    `S/N ${serialNumber} 으로 **등록된 장비**를 찾아 채웠습니다 — ${filled.join(" · ")} · 🔴 확인 필요`,
    ...tail,
  ].join(" ");
}

/**
 * 「무엇이 들어왔는가」 한 줄.
 *
 * 🔴 **반드시 「확인 필요」라고 말한다.** QR 은 오류 검출 부호가 붙어 있어
 * 읽혔으면 맞지만, 글자 인식에는 그런 장치가 없다 — 사람이 명판을 다시 보고
 * 맞춰 봐야 하는 값이라는 사실이 글에서 사라지면 안 된다.
 *
 * 🔴 **「못 읽었다」와 「읽었는데 칸이 차 있었다」를 가른다.** 둘 다 채운 것이
 * 없지만 사람이 할 일은 정반대다 — 앞은 다시 찍거나 직접 적어야 하고, 뒤는
 * 아무 할 일이 없다. 한 문장으로 뭉치면 「또 읽어 보라」는 뜻으로 읽힌다.
 *
 * 🔴 **덮어쓴 것은 덮어썼다고 말한다.** 값이 조용히 바뀌면 사람은 자기가 적은
 * 값이 아직 있는 줄 안다. QR 값을 비켜 간 것도 함께 알린다 — 안 그러면
 * 「왜 이 칸만 안 바뀌지」가 된다.
 */
export function summarizeNameplateTextFill(
  plan: NameplateFillPlan,
  reading?: NameplateTextFields
): string {
  const filled = FIELD_ORDER.filter((key) => plan.patch[key] !== undefined).map(
    (key) => `${FIELD_LABELS[key]} ${plan.patch[key]}`
  );
  const tail: string[] = [];
  if (plan.overwritten.length > 0) {
    tail.push(
      `다시 읽어 ${plan.overwritten.map((key) => FIELD_LABELS[key]).join(" · ")} 칸을 덮어썼습니다.`
    );
  }
  if (plan.keptFromQr.length > 0) {
    tail.push(
      `${plan.keptFromQr.map((key) => FIELD_LABELS[key]).join(" · ")} 은 QR 로 읽은 값이라 그대로 두었습니다.`
    );
  }
  if (filled.length > 0) {
    return [`글자로 읽어 채웠습니다 — ${filled.join(" · ")} · 🔴 확인 필요`, ...tail].join(" ");
  }
  const readSomething =
    reading !== undefined &&
    (reading.modelName !== null || reading.lotNumber !== null || reading.serialNumber !== null);
  const head = readSomething ? NAMEPLATE_TEXT_ALL_TAKEN_MESSAGE : NAMEPLATE_TEXT_EMPTY_MESSAGE;
  return [head, ...tail].join(" ");
}
