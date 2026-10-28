import { partFieldValue } from "@dss/core/ui/inventory/part-picker-rows";
import { normalizeKey } from "../../src/lib/kyosan/card-grid";
import { kyosanUsedPartKey } from "../../src/lib/kyosan/report-preview";

/**
 * ============================================================================
 * 사용 부품 이름과 재고 관리 부품명이 **얼마나 겹치는가** — 세는 규칙만 (조각 C0)
 * ============================================================================
 * DB 도 통로도 모르는 순수 함수다. 받은 두 목록을 맞대어 수만 돌려준다. 그래서
 * DB 없이 값으로 시험할 수 있고(`part-name-overlap.test.ts`), 실제로 읽어 오는
 * 일은 `scripts/check-part-name-overlap.ts` 가 한다.
 *
 * ── 🔴 왜 이 수를 재야 하는가 ───────────────────────────────────────────
 * 「고장 부품」 그래프를 **연락서에서 읽은 부품**과 **재고 관리에 요청한 부품**이
 * 한 줄로 묶여 보이게 하려는데, 지금 그 둘을 이을 열쇠는 **이름 글자뿐**이다.
 * `repair_case_used_parts.part_id` 는 거의 다 `null` 이고(연락서 이식은 언제나
 * `null` 로 넣는다 — `server/services/kyosan-report-import.ts` 의 `replaceUsedParts`),
 * 재고 관리 쪽에서 돌아오는 부품에는 A/S 의 UUID 가 아예 없다(저쪽 API.md 2절 —
 * 바깥에 내주는 열쇠는 부품 번호뿐이다).
 *
 * 🔴 **그래서 이름이 안 겹치면 그래프를 이름으로 묶는 설계 자체가 틀린 것**이고,
 *    그 수치를 아는 길이 코드 어디에도 없었다. 단위 시험으로는 영영 안 잡힌다 —
 *    두 시스템의 **실제 자료**를 맞대어 봐야만 나오는 수이기 때문이다.
 *
 * ── 🔴 눌림은 **이 저장소에 이미 있는 자**만 쓴다 ───────────────────────
 * 새 눌림을 여기서 지으면 맞대는 자가 한 벌 더 생기고, 그것으로 잰 수치는
 * 「실제로 묶일 때」와 다른 수가 된다. 그래서 셋 다 남의 함수를 가져다 쓴다:
 *
 *   `literal`  `partFieldValue` 만 — 앞뒤 공백을 떼고 `-` 만 적힌 칸을 「없음」으로
 *              본다(재고 관리도 **같은 글자들**을 빈 값으로 본다 — 그쪽
 *              `lib/parts/form.ts` 의 `DASH_ONLY`).
 *   `fold`     + `normalizeKey`(`src/lib/kyosan/card-grid.ts`) — NFKC · 공백 **전부**
 *              제거 · 소문자. 지시서가 말한 「공백 · 대소문자 · 전각반각」이
 *              정확히 이 셋이다. 연락서 판독기가 라벨을 더듬을 때 쓰는 바로 그 자다.
 *   `merge`    + `kyosanUsedPartKey`(`src/lib/kyosan/report-preview.ts`) — 위에
 *              **장음류 제거**가 더 붙는다(`ー` `―` `‐` `−` `-`). 🔴 **A/S 가 사용
 *              부품 칸의 줄을 묶을 때 쓰는 바로 그 열쇠**다. 그러므로 이 단계의
 *              수치는 「지금 이미 한 줄로 묶이고 있는 이름들」의 잣대와 같다.
 *
 * ⚠️ `merge` 의 장음류에는 **ASCII 붙임표 `-` 가 들어 있다.** 품번 `ABC-123` 과
 *    `ABC123` 이 같아진다. 부품 **이름**을 묶으려고 만든 자라 그렇고, 품번을
 *    맞댈 때는 **겹치는 쪽으로 넉넉하게** 기운다. 그래서 세 단계를 **함께** 찍는다 —
 *    `fold` 와 `merge` 의 차이가 곧 「붙임표·장음 때문에 갈린 것」의 수다.
 *
 * ── 🔴 분모는 **열쇠 가짓수가 아니다** ──────────────────────────────────
 * 눌릴수록 열쇠 가짓수는 줄어든다(같은 물건의 표기 둘이 한 열쇠가 되니까). 그 줄어든
 * 수를 분모로 쓰면 단계끼리 견줄 수 없다 — 분자도 분모도 함께 움직여 비율이 거꾸로
 * 보이기까지 한다. 그래서 분모는 **적힌 글자 기준 서로 다른 이름 수**이고, 분자는
 * 「그 이름이 그 단계에서 재고 관리에 짝이 있나」다. 그래서 수가 **단조 증가**한다.
 *
 * ⚠️ 한 가지 예외가 있다: **눌렀더니 빈 글자가 되는 이름**(`ー` 한 글자 따위)은 그
 *    단계에서 맞댈 수가 없어 분모에서 빠진다. 그래서 분모가 단계마다 한두 가지 다를 수
 *    있다. 숨기지 않으려고 `asNames`(그 단계의 분모)와 `droppedNames`(빠진 수)를 **함께**
 *    돌려준다 — 부르는 쪽이 비율만 찍지 말고 분모도 같이 찍어야 한다.
 *
 * ── 🔴 「맞댈 것이 없다」를 0% 로 찍지 않는다 ───────────────────────────
 * 한쪽 목록이 비면 겹침은 당연히 0 이다. 그것을 「0% 겹친다」로 읽으면 사람이
 * **설계 결정을 거꾸로** 내린다. `isMeasurable` 이 그 갈림이고, 부르는 쪽이 그것을
 * 보고 표 대신 「못 쟀다」를 찍는다.
 *
 * ── 🔵 표의 **자리 맞추개**도 여기 있다 ─────────────────────────────────
 * 세는 것과 그리는 것을 한 파일에 두는 것이 보기에 좋지는 않지만, 자리 맞추개를
 * 도구 안에 두면 **시험이 붙지 않는다.** 그리고 그 자리 맞추개는 조용히 틀리는
 * 종류다 — 한글이 두 칸을 먹는 것을 놓치면 표가 어긋나고, 사람은 **엉뚱한 칸의
 * 수를 읽는다.** 이 도구의 쓸모가 「사람이 그 표를 보고 설계를 정하는 것」 하나뿐이라
 * 정렬이 곧 내용이다. 그래서 순수한 이쪽에 두고 값으로 못 박는다.
 * ============================================================================
 */

/** 이름 하나와 그 이름이 붙은 `repair_case_used_parts` 줄 수. */
export type NameTally = {
  /** 🔴 DB 에 적힌 **글자 그대로**. 눌린 값이 아니다. */
  text: string;
  rows: number;
};

/** 눌림 세 단계(머리말). 🔴 **차례가 뜻이 있다** — 뒤가 앞보다 넓다. */
export const SQUEEZE_LEVELS = ["literal", "fold", "merge"] as const;
export type SqueezeLevel = (typeof SQUEEZE_LEVELS)[number];

/** 화면에 찍는 이름표. 🔴 **무엇을 눌렀는지**까지 적는다 — 수만 보면 해석이 갈린다. */
export const SQUEEZE_LABELS: Record<SqueezeLevel, string> = {
  literal: "글자 그대로",
  fold: "눌러서(공백·대소문자·전각반각)",
  merge: "더 눌러서(+장음·붙임표)",
};

/**
 * 그 단계의 **견줌 열쇠**. 🔴 빈 글자는 「맞댈 수 없는 값」이다 — 부르는 쪽이 세어 둔다.
 *
 * 🔴 세 단계 **모두** `partFieldValue` 를 먼저 지난다. 그래서 「글자 그대로」도 앞뒤 공백은
 *    떼고 보며, `-` 만 적힌 칸은 어느 단계에서도 값이 아니다. 그 자를 양쪽에 똑같이
 *    대지 않으면 한쪽은 「이름이 있다」고 세고 다른 쪽은 「비었다」고 세어, 그 차이만큼이
 *    통째로 「안 겹침」으로 쌓인다.
 */
export function squeezeName(level: SqueezeLevel, text: string): string {
  const value = partFieldValue(text);
  if (value === "") return "";
  if (level === "literal") return value;
  if (level === "fold") return normalizeKey(value);
  return normalizeKey(kyosanUsedPartKey(value));
}

/**
 * 줄마다의 글자 → **서로 다른 이름**과 줄 수.
 *
 * 🔴 **적힌 글자 그대로** 묶는다(눌리지 않는다). 여기서 눌러 버리면 위 세 단계의 분모가
 *    이미 한 번 눌린 수가 되어, `literal` 의 「글자 그대로 겹친다」가 거짓말이 된다.
 * 🔵 차례는 **처음 나온 차례**다(`Map` 이 넣은 차례를 지킨다) — 본보기를 뽑을 때 같은
 *    입력이면 언제나 같은 답이 나와야 시험이 붙는다.
 */
export function tallyNames(values: readonly string[]): NameTally[] {
  const byText = new Map<string, number>();
  for (const value of values) byText.set(value, (byText.get(value) ?? 0) + 1);
  return [...byText].map(([text, rows]) => ({ text, rows }));
}

export type OverlapTally = {
  level: SqueezeLevel;
  /** 🔴 **분모** — 맞댄 A/S 이름 가짓수(열쇠가 빈 이름을 뺀 뒤). */
  asNames: number;
  /** 🔴 **분모** — 그 이름들이 덮는 사용 부품 줄 수. */
  asRows: number;
  /**
   * 🔴 열쇠가 **빈 글자**가 되어 아예 맞대지 못한 A/S 이름·줄. 0 이 아니면 위 분모가
   * 「전부」가 아니라는 뜻이다 — 조용히 사라지지 않게 따로 센다.
   */
  droppedNames: number;
  droppedRows: number;
  /** 받은 재고 관리 글자 가짓수 — **적힌 글자 기준**, 빈 값을 뺀 뒤. */
  inventoryValues: number;
  /** 그것을 이 단계 열쇠로 묶은 가짓수. 🔴 **0 이면 맞댈 것이 없었다**(`isMeasurable`). */
  inventoryKeys: number;
  /** 🔴 **분자** — 재고 관리에 짝이 있는 A/S 이름 가짓수. */
  matchedNames: number;
  /** 그 이름들이 덮는 사용 부품 줄 수. */
  matchedRows: number;
};

/** 한 단계로 한 번 맞댄다. 🔴 **아무것도 바꾸지 않는다** — 수만 돌려준다. */
export function tallyOverlap(input: {
  asNames: readonly NameTally[];
  inventoryValues: readonly string[];
  level: SqueezeLevel;
}): OverlapTally {
  const { level } = input;

  const inventoryKeys = new Set<string>();
  const inventorySeen = new Set<string>();
  for (const raw of input.inventoryValues) {
    const value = partFieldValue(raw);
    if (value === "") continue;
    inventorySeen.add(value);
    const key = squeezeName(level, raw);
    if (key !== "") inventoryKeys.add(key);
  }

  let asNames = 0;
  let asRows = 0;
  let droppedNames = 0;
  let droppedRows = 0;
  let matchedNames = 0;
  let matchedRows = 0;
  for (const tally of input.asNames) {
    const key = squeezeName(level, tally.text);
    if (key === "") {
      droppedNames += 1;
      droppedRows += tally.rows;
      continue;
    }
    asNames += 1;
    asRows += tally.rows;
    if (inventoryKeys.has(key)) {
      matchedNames += 1;
      matchedRows += tally.rows;
    }
  }

  return {
    level,
    asNames,
    asRows,
    droppedNames,
    droppedRows,
    inventoryValues: inventorySeen.size,
    inventoryKeys: inventoryKeys.size,
    matchedNames,
    matchedRows,
  };
}

/**
 * 🔴 **잴 것이 있었나.** 한쪽이 비어 있으면 겹침 0 은 사실이 아니라 **표본이 없는 것**이다.
 * 부르는 쪽이 이것을 보고 비율 대신 「못 쟀다」를 찍는다(머리말).
 */
export function isMeasurable(tally: OverlapTally): boolean {
  return tally.asNames > 0 && tally.inventoryKeys > 0;
}

export type UnmatchedSamples = {
  /** 재고 관리에 짝이 없는 A/S 이름 — 🔵 **줄 수 많은 것부터**(같으면 글자순). */
  asOnly: NameTally[];
  /** A/S 에 짝이 없는 재고 관리 글자 — 🔵 **처음 나온 차례대로**. */
  inventoryOnly: string[];
};

/**
 * 안 겹친 것의 **본보기**를 양쪽에서 뽑는다.
 *
 * 🔴 **양쪽을 다 뽑는 까닭**: 수만 보면 왜 안 맞는지 모른다. 한쪽만 보면 더 그렇다 —
 *    A/S 쪽만 보고 「표기가 흔들린다」로 읽었는데 실은 **체계가 다른 것**(한쪽은 품번,
 *    다른 쪽은 사람이 읽는 설명)일 수 있고, 그 둘은 고치는 길이 전혀 다르다.
 * 🔵 A/S 쪽을 줄 수 순으로 뽑는 까닭: 한 줄짜리 이름 스무 개를 보여 주면 「드문 표기가
 *    안 맞는구나」로 읽히는데, 정작 그래프를 망치는 것은 **많이 쓰이는 이름**이 안 맞는
 *    경우다.
 */
export function unmatchedSamples(input: {
  asNames: readonly NameTally[];
  inventoryValues: readonly string[];
  level: SqueezeLevel;
  limit: number;
}): UnmatchedSamples {
  const limit = Math.max(0, Math.trunc(input.limit));
  const { level } = input;

  const asKeys = new Set<string>();
  for (const tally of input.asNames) {
    const key = squeezeName(level, tally.text);
    if (key !== "") asKeys.add(key);
  }
  const inventoryKeys = new Set<string>();
  for (const raw of input.inventoryValues) {
    const key = squeezeName(level, raw);
    if (key !== "") inventoryKeys.add(key);
  }

  const asOnly = input.asNames
    .filter((tally) => {
      const key = squeezeName(level, tally.text);
      // 🔴 열쇠가 빈 이름은 「안 겹친 것」이 아니라 **맞대지 못한 것**이다 — 섞지 않는다.
      return key !== "" && !inventoryKeys.has(key);
    })
    .sort((a, b) => b.rows - a.rows || (a.text < b.text ? -1 : a.text > b.text ? 1 : 0))
    .slice(0, limit);

  const inventoryOnly: string[] = [];
  const seen = new Set<string>();
  for (const raw of input.inventoryValues) {
    const value = partFieldValue(raw);
    if (value === "" || seen.has(value)) continue;
    seen.add(value);
    const key = squeezeName(level, raw);
    if (key === "" || asKeys.has(key)) continue;
    if (inventoryOnly.length < limit) inventoryOnly.push(value);
  }

  return { asOnly, inventoryOnly };
}

// ---------------------------------------------------------------------------
// 표의 자리 맞추개 (머리말 마지막 절)
// ---------------------------------------------------------------------------

/**
 * 터미널에서 **두 칸**을 먹는 글자의 번호 범위.
 *
 * 🔴 **글자를 그대로 적지 않고 번호로 적는다.** 이 범위에는 눈에 안 보이는 글자가 섞여
 *    있어(한글 첫소리 채움 U+115F 따위), 글자로 적으면 편집기·도구를 오가는 사이에
 *    조용히 사라지거나 다른 글자로 바뀐다 — 그래도 **오류가 안 나고** 표만 어긋난다.
 * 🔵 East Asian Wide/Fullwidth 의 흔한 토막만 적는다. 가운뎃점(`·`)·화살표·그림글자는
 *    여기 없다 — 앞의 둘은 실제로 한 칸이고, 🔴 **그림글자는 두 칸인데 여기 없다.**
 *    그래서 자리를 맞출 칸에는 그림글자를 쓰지 않는다(쓰면 그 줄만 한 칸 밀린다).
 */
const WIDE_RANGES: readonly (readonly [number, number])[] = [
  [0x1100, 0x115f], // 한글 첫소리 낱자 (채움 문자 포함 — 눈에 안 보인다)
  [0x2e80, 0x303e], // CJK 부수 · 한중일 기호와 구두점
  [0x3041, 0x33ff], // 가나 · 한글 호환 자모 · 한중일 묶음 기호
  [0x3400, 0x4dbf], // CJK 확장 A
  [0x4e00, 0x9fff], // CJK 한자
  [0xa000, 0xa4cf], // 이(彝) 문자
  [0xac00, 0xd7a3], // 한글 음절
  [0xf900, 0xfaff], // CJK 호환 한자
  [0xfe30, 0xfe6f], // 한중일 호환 형태
  [0xff00, 0xff60], // 전각 영숫자 · 기호
  [0xffe0, 0xffe6], // 전각 통화 기호
];

/** 터미널에서 몇 칸을 먹나. 🔴 `String.length` 가 아니다 — 한글 한 자가 두 칸이다. */
export function displayWidth(text: string): number {
  let width = 0;
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    width += WIDE_RANGES.some(([from, to]) => code >= from && code <= to) ? 2 : 1;
  }
  return width;
}

/** 오른쪽에 붙여 맞춘다(수). 🔵 글자가 칸보다 넓으면 **자르지 않는다** — 수를 자르면 거짓이 된다. */
export function padLeft(text: string, columns: number): string {
  return " ".repeat(Math.max(0, columns - displayWidth(text))) + text;
}

/** 왼쪽에 붙여 맞춘다(이름표). */
export function padRight(text: string, columns: number): string {
  return text + " ".repeat(Math.max(0, columns - displayWidth(text)));
}

// ---------------------------------------------------------------------------
// 표를 **글자로** 만든다 (찍는 일은 부르는 쪽이 한다)
// ---------------------------------------------------------------------------

/**
 * 🔴 **`console.log` 를 여기서 부르지 않는다.** 줄을 만들어 돌려주기만 하면 이 표가
 * **DB 없이 시험된다** — 도구는 운영에서 딱 한 번 돌고, 거기서 처음 터지면 그날 아무도
 * 수를 못 본다. 실제로 이 저장소에서 「시험 다 통과했는데 눌러 보니 틀렸다」가 여러 번
 * 있었고, 화면이 없는 도구는 눌러 볼 수조차 없다.
 */
export type NameBucket = { label: string; values: readonly string[] };

/** 표 한 덩이. 🔴 `unmeasured` 는 **줄과 따로** 센다 — 부르는 쪽이 종료 코드를 그것으로 정한다. */
export type TableBlock = {
  lines: string[];
  /** 못 잰 것의 수. 🔵 그 줄은 `lines` 에 **제자리에** 들어 있다(표의 어느 칸인지가 보여야 한다). */
  unmeasured: number;
};

/** 🔴 못 쟀다는 줄의 글자. **한 곳에서** 만든다 — 도구와 표가 다른 모양으로 말하면 눈에 안 띈다. */
export function cannotMeasureLine(label: string, why: string): string {
  return `  ? ${label} — 못 쟀다 (${why})`;
}

/** 비율. 🔴 분모가 0 이면 **수를 찍지 않는다** — `0.0%` 는 「안 겹친다」로 읽힌다. */
function percent(part: number, whole: number): string {
  return whole === 0 ? "   -  " : `${((part / whole) * 100).toFixed(1).padStart(5)}%`;
}

/**
 * 🔵 자리 맞추기는 **칸 수**로 한다 — 한글이 두 칸을 먹는다(위 `padLeft`·`padRight`).
 *
 * 🔴 `CELL_COLUMNS` 는 **머리글 이름표 가운데 가장 넓은 것**(「눌러서(공백·대소문자·전각반각)」,
 *    30칸)에 맞춰 둔다. 값 칸은 26칸이라 더 좁은데, 좁은 쪽에 맞추면 **머리글만 넘쳐** 머리글과
 *    값의 칸이 어긋난다 — 수는 맞는데 사람이 옆 칸의 이름표를 읽는다. 시험이 머리글과 값 줄의
 *    **너비가 같은지**를 잰다(이름표를 늘리는 날 그 시험이 먼저 깨진다).
 */
const LABEL_COLUMNS = 16;
const COUNT_COLUMNS = 12;
const CELL_COLUMNS = 30;

/**
 * 한 묶음(전체 · 이식분 · 그 밖)을 **칸마다 · 단계마다** 맞대어 표로 만든다.
 *
 * 🔴 **이름표에 그림글자를 쓰지 않는다** — 자리 맞추개가 그림글자의 너비를 모른다
 *    (`WIDE_RANGES` 머리말). 쓰면 그 줄만 한 칸 밀려 사람이 옆 칸의 수를 읽는다.
 */
export function formatOverlapTable(input: {
  title: string;
  asNames: readonly NameTally[];
  buckets: readonly NameBucket[];
}): TableBlock {
  const lines: string[] = [`\n  ── ${input.title} — 서로 다른 이름 ${input.asNames.length}가지`];

  if (input.asNames.length === 0) {
    lines.push(cannotMeasureLine(input.title, "맞댈 이름이 한 가지도 없다"));
    return { lines, unmeasured: 1 };
  }

  const head = [padRight("재고 관리 칸", LABEL_COLUMNS), padLeft("값 있는 글자", COUNT_COLUMNS)];
  for (const level of SQUEEZE_LEVELS) head.push(padLeft(SQUEEZE_LABELS[level], CELL_COLUMNS));
  lines.push(`     ${head.join(" ")}`);

  let unmeasured = 0;
  for (const bucket of input.buckets) {
    const tallies = SQUEEZE_LEVELS.map((level) =>
      tallyOverlap({ asNames: input.asNames, inventoryValues: bucket.values, level })
    );
    /* 🔴 맞댈 것이 없으면 비율을 찍지 않는다 — 「0% 겹친다」가 아니라 **못 쟀다**이다. */
    if (!tallies.some(isMeasurable)) {
      lines.push(cannotMeasureLine(`${input.title} × ${bucket.label}`, "그 칸에 값이 든 부품이 한 줄도 없다"));
      unmeasured += 1;
      continue;
    }
    const cells = [padRight(bucket.label, LABEL_COLUMNS), padLeft(String(tallies[0].inventoryValues), COUNT_COLUMNS)];
    for (const tally of tallies) {
      /* 🔴 **분모를 함께 찍는다.** 비율만 찍으면 그것이 어느 수 위의 비율인지 숨는다 —
         눌렀더니 빈 글자가 되는 이름이 있으면 분모가 단계마다 한두 가지 달라진다. */
      cells.push(
        padLeft(
          `${padLeft(String(tally.matchedNames), 5)}/${padRight(String(tally.asNames), 5)}` +
            `${percent(tally.matchedNames, tally.asNames)} 줄 ${padLeft(String(tally.matchedRows), 5)}`,
          CELL_COLUMNS
        )
      );
    }
    lines.push(`     ${cells.join(" ")}`);
  }

  /* 🔴 **맞대지 못한 이름**은 그 단계의 분모에서 빠져 있다. 0 이 아니면 반드시 말한다. */
  const dropped = SQUEEZE_LEVELS.map((level) =>
    tallyOverlap({ asNames: input.asNames, inventoryValues: [], level })
  );
  if (dropped.some((tally) => tally.droppedNames > 0)) {
    lines.push(
      "     ! 눌렀더니 빈 글자가 되어 맞대지 못한 이름 — " +
        dropped
          .map((tally) => `${SQUEEZE_LABELS[tally.level]} ${tally.droppedNames}가지(줄 ${tally.droppedRows})`)
          .join(" · ") +
        ". 그 단계의 분모에서 빠져 있다."
    );
  }

  return { lines, unmeasured };
}

/**
 * 안 겹친 것의 본보기를 **양쪽** 글자로 만든다.
 *
 * 🔴 **가장 너그러운 단계(`merge`)로 뽑는다.** 거기서도 안 맞는 것이 「진짜 안 겹치는 것」이고,
 *    표기가 흔들려 갈린 것은 그 단계에서 이미 붙는다. 느슨한 단계로 뽑으면 본보기가 온통
 *    표기 차이로 채워져, 정작 봐야 할 **체계가 다른 이름**이 스무 줄 밖으로 밀려난다.
 */
export function formatUnmatchedSamples(input: {
  title: string;
  asNames: readonly NameTally[];
  bucket: NameBucket;
  limit: number;
}): string[] {
  const samples = unmatchedSamples({
    asNames: input.asNames,
    inventoryValues: input.bucket.values,
    level: "merge",
    limit: input.limit,
  });

  const lines = [`\n  ── 안 겹친 본보기 (${SQUEEZE_LABELS.merge} 기준) — ${input.title}`];
  if (samples.asOnly.length === 0) {
    lines.push("     A/S 사용 부품: 없다 — 모든 이름에 짝이 있다");
  } else {
    lines.push(`     A/S 사용 부품 (줄 수 많은 것부터 ${samples.asOnly.length}가지):`);
    for (const item of samples.asOnly) lines.push(`       ${padLeft(String(item.rows), 4)}줄  ${item.text}`);
  }
  if (samples.inventoryOnly.length === 0) {
    lines.push(`     재고 관리 ${input.bucket.label}: 없다`);
  } else {
    lines.push(`     재고 관리 ${input.bucket.label} (앞에서 ${samples.inventoryOnly.length}가지):`);
    for (const value of samples.inventoryOnly) lines.push(`             ${value}`);
  }
  return lines;
}
