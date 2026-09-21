import { excelSerialToDateOnly } from "../xlsx/excel-date";
import { columnLettersToNumber, columnNumberToLetters, type GridCell, type SheetGrid } from "../xlsx/sheet-grid";

/**
 * ============================================================================
 * 교산 연락서 판독기 — 칸 격자를 **라벨 글자로** 더듬는 도구 (2026-09-21, S1)
 * ============================================================================
 * 연락서 469장에서 수리 건에 들어갈 내용을 뽑는다. 이 파일은 그 바닥 층 —
 * `SheetGrid`(src/lib/xlsx/sheet-grid.ts) 위에서 "이 라벨이 어디 있나" 와
 * "그 라벨의 값은 어느 칸인가" 만 다룬다. 어떤 항목을 뽑을지는 `card-fields.ts`.
 *
 * ── 🔴 왜 고정 주소를 쓰지 않는가 ──────────────────────────────────────
 * 실측한 판본이 `.xlsm` 326장에 **184가지**, 변환본 143장에 **44가지**다
 * (%TEMP%/kyosan-version-map.md · kyosan-xls-scan.md). 사람들이 해마다 줄을
 * 넣고 빼서 **같은 항목이 파일마다 다른 줄**에 있다 — `客先故障状況①` 이 어떤
 * 판본에서는 B53, 어떤 판본에서는 B51 이다. `B53` 이라고 적는 순간 판독기는
 * 판본 하나에서만 맞는다. 그래서 **라벨 글자를 찾아 그 값 칸을 읽는다.**
 *
 * ── 라벨은 A·B 열에만 있다 ─────────────────────────────────────────────
 * 라벨 지도를 보면 Card 계열 시트의 항목 이름은 전부 A 열(큰 항목)과 B 열
 * (하위 항목)에 앉는다. 이 제한이 없으면 **값이 라벨로 오인된다** — `返却先`
 * 의 값이 `客先(Customer)` 라서(드롭다운에서 고른 글자다) C21 이 `客先(Customer)`
 * 라벨로 잡히고, 진짜 라벨 A25 를 놓친다. 실제로 겪은 함정이다.
 *
 * ── 값은 C 열과 F 열에만 있다 ──────────────────────────────────────────
 * C 는 RF 부, F 는 DC 부다(둘 다 있는 판본에서 F 는 대개 `---`). D·E·G·H 는
 * 🔴 **숨은 도움 열**이다 — 제너레이터 양식의 교체부품 30줄에서 D·E·G·H 가
 * 모두 **같은 공유문자열 하나**를 가리킨다(실측: `<c r="D67" t="s"><v>963</v>`
 * 가 D67..D96 에 똑같이). C 가 `―` 일 때 오른쪽으로 계속 훑으면 그 도움 글자를
 * 값으로 주워 온다. 그래서 값 열을 C·F 로 못 박았다.
 *   예외가 하나 있고, 아래 「동그라미 번호 묶음」이 그것이다.
 *
 * ── 동그라미 번호 묶음(옛 양식) ────────────────────────────────────────
 * 2010년대 양식은 값을 라벨 **아래**에 적는다:
 *
 *     A50 `主な故障箇所`   C50 `①`   E50 `②`   G50 `③`
 *     C51 <값>
 *
 * 라벨 줄의 C·E·G 에 앉은 `①②③` 은 **값이 아니라 칸 머리글**이다. 그것을
 * 값으로 읽으면 모든 고장 부위가 `①` 이 된다. 그래서 동그라미 번호를 만나면
 * 값 열을 그 번호들이 앉은 열로 바꾸고, 값을 **다음 라벨 줄 직전까지 아래로**
 * 읽는다.
 *
 * ── `-` 와 `―` 는 값이 아니다 ──────────────────────────────────────────
 * 양식이 빈칸을 싫어해서 `-` · `―` · `－－－` · `---------` 로 채워 둔다. 이것을
 * 값으로 돌려주면 "비었다" 와 "적혀 있다" 를 구분할 수 없게 된다 — 지시서가
 * 못 박은 대로 **못 뽑은 항목은 「없음」(null)** 이어야 하므로 전부 null 로 본다.
 * ============================================================================
 */

/** 값이 앉는 열 — C(RF부) · F(DC부). 위 머리말 「값은 C 열과 F 열에만」 참조. */
export const CARD_VALUE_COLUMNS: readonly number[] = [3, 6];

/** 라벨이 앉는 열 — A(큰 항목) · B(하위 항목). 위 머리말 「라벨은 A·B 열에만」 참조. */
export const CARD_LABEL_COLUMN_MIN = 1;
export const CARD_LABEL_COLUMN_MAX = 2;

/** 동그라미 번호 머리글을 찾을 때 훑는 열 범위(C…H). */
const ORDINAL_SCAN_COLUMN_MIN = 3;
const ORDINAL_SCAN_COLUMN_MAX = 8;

/** 동그라미 번호 머리글로 치려면 한 줄에 몇 개가 있어야 하는가. */
const ORDINAL_HEADER_MIN_COUNT = 2;

/** 동그라미 번호 머리글이 라벨 줄에서 몇 줄 위까지 유효한가. */
const ORDINAL_HEADER_LOOKBACK_ROWS = 4;

/** 한 묶음에서 아래로 몇 줄까지 값을 읽을 것인가(다음 라벨 줄을 만나면 거기서 끝난다). */
const ORDINAL_BLOCK_MAX_ROWS = 12;

/**
 * 「빈칸 채움」으로 쓰이는 줄표들. `ー`(U+30FC, 가타카나 장음)까지 넣는다 —
 * NFKC 가 반각 `ｰ` 를 그리로 옮기고, 그 한 글자만 든 칸은 실측에서 언제나
 * 빈칸 채움이었다.
 */
const DASH_CHARACTERS = "-‐‑‒–—―−－─ーｰ";
const DASH_ONLY = new RegExp(`^[${DASH_CHARACTERS}\\s]+$`);

/** 동그라미 번호 ①…⑳ (U+2460…U+2473). */
const ORDINAL_ONLY = /^[①-⑳]$/;

/**
 * 체크 표시로 쓰이는 글자들. 연락서의 「원인」·「처치」 칸은 글자를 적지 않고
 * **○ 를 찍어** 고른다(report-marks.ts).
 */
const CHECK_MARK_ONLY = /^[○◯〇●◎✓✔☑レﾚ]$/;

export type GridLike = Pick<SheetGrid, "rowNumbers" | "cells">;

/** 격자에서 찾아낸 칸 하나 — 주소와 원문과 대조용 열쇠를 함께 들고 다닌다. */
export type FoundCell = {
  row: number;
  column: number;
  /** `B53` 꼴. 보고와 시험에서 어디를 읽었는지 말하려고 들고 있다. */
  address: string;
  /** 줄바꿈·앞뒤 공백만 다듬은 글자. 값으로 돌려줄 때 쓴다. */
  text: string;
  /** 대조용으로 눌러 놓은 글자(`normalizeKey`). 라벨을 견줄 때 쓴다. */
  key: string;
};

/**
 * 라벨을 가리키는 법. 글자를 주면 **앞머리 일치**, 정규식을 주면 그대로 시험한다.
 * 둘 다 `normalizeKey` 로 누른 열쇠에 대고 견준다.
 *
 * 앞머리 일치를 쓰는 까닭: 같은 항목의 이름이 판본마다 꼬리를 달고 다닌다 —
 * `装置名` / `装置名・P/N(Parts_No)`, `現象(Type_of_Alarm)` / `現象\n(Type_of_Alarm)`.
 * 꼬리를 무시하면 한 줄로 둘 다 잡힌다. 다만 앞머리가 짧으면 남의 라벨까지
 * 잡으므로(`客先` 는 `客先希望納期`·`客先依頼書番号`·`客先故障状況` 을 모두 먹는다)
 * 앞머리는 **그 항목에만 있는 데까지** 길게 적는다.
 */
export type LabelMatcher = string | RegExp;

/** 줄바꿈(`_x000D_`)·전각 공백을 한 칸으로 눌러 앞뒤를 자른다. */
export function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * 대조용 열쇠. 순서가 중요하다.
 *  1. `NFKC` — 반각 가타카나 `ﾕﾆｯﾄ名` 이 `ユニット名` 이 되고 전각 영숫자가 반각이 된다.
 *  2. 공백 **전부 제거** — `担　当` 과 `担当`, `OP. TIME` 과 `OP.TIME` 을 같게 본다.
 *  3. 소문자 — `(MODEL)` 과 `(Model)` 을 같게 본다.
 */
export function normalizeKey(text: string): string {
  return text.normalize("NFKC").replace(/\s+/g, "").toLowerCase();
}

/** 「빈칸 채움」인가 — `-` · `―` · `－－－` · `---------` 따위. 빈 글자도 참이다. */
export function isDashPlaceholder(text: string): boolean {
  return text === "" || DASH_ONLY.test(text);
}

/** 칸 머리글로 쓰이는 동그라미 번호 한 글자인가(`①`…`⑳`). */
export function isOrdinalMark(text: string): boolean {
  return ORDINAL_ONLY.test(text.trim());
}

/** ○ 따위의 체크 표시 한 글자인가. */
export function isCheckMark(text: string): boolean {
  return CHECK_MARK_ONLY.test(text.trim());
}

/** 라벨 열쇠가 이 지시자에 맞는가. */
export function matchesLabel(key: string, matcher: LabelMatcher): boolean {
  return typeof matcher === "string" ? key.startsWith(matcher) : matcher.test(key);
}

/** 칸 하나를 `FoundCell` 로. 글자 칸이 아니거나 비었으면 null. */
function toFoundCell(row: number, column: number, cell: GridCell | undefined): FoundCell | null {
  if (!cell || cell.kind !== "text") return null;
  const text = collapseWhitespace(cell.text);
  if (text === "") return null;
  return { row, column, address: `${columnNumberToLetters(column)}${row}`, text, key: normalizeKey(text) };
}

/**
 * 라벨을 전부 찾는다 — 격자를 위에서 아래로, 왼쪽에서 오른쪽으로.
 * 기본 범위는 A·B 열이다(위 머리말).
 */
export function findLabelCells(
  grid: GridLike,
  matcher: LabelMatcher,
  options: { minColumn?: number; maxColumn?: number } = {}
): FoundCell[] {
  const minColumn = options.minColumn ?? CARD_LABEL_COLUMN_MIN;
  const maxColumn = options.maxColumn ?? CARD_LABEL_COLUMN_MAX;

  const found: FoundCell[] = [];
  for (const row of grid.rowNumbers) {
    const cells = grid.cells(row);
    for (const [letters, cell] of cells) {
      const column = columnLettersToNumber(letters);
      if (column < minColumn || column > maxColumn) continue;
      const foundCell = toFoundCell(row, column, cell);
      if (foundCell && matchesLabel(foundCell.key, matcher)) found.push(foundCell);
    }
  }
  return found.sort((a, b) => a.row - b.row || a.column - b.column);
}

/**
 * 그 줄이 「동그라미 번호 머리글」인가 — C…H 에 `①②③` 이 둘 이상 앉아 있으면
 * 그 열들이 값 열이다. 하나만 있는 줄은 머리글로 치지 않는다(우연히 `①` 하나가
 * 값으로 적힌 칸과 구분되지 않기 때문이다).
 */
export function ordinalHeaderColumns(grid: GridLike, row: number): number[] {
  const columns: number[] = [];
  for (const [letters, cell] of grid.cells(row)) {
    const column = columnLettersToNumber(letters);
    if (column < ORDINAL_SCAN_COLUMN_MIN || column > ORDINAL_SCAN_COLUMN_MAX) continue;
    if (cell.kind === "text" && isOrdinalMark(cell.text)) columns.push(column);
  }
  return columns.length >= ORDINAL_HEADER_MIN_COUNT ? columns.sort((a, b) => a - b) : [];
}

/**
 * 이 줄에서 값을 읽을 열들. 라벨 줄 자신이나 **바로 위 몇 줄**에 동그라미 번호
 * 머리글이 있으면 그 열들을, 없으면 C·F 를 쓴다.
 *
 * 위쪽을 보는 까닭: 옛 양식의 처치 묶음이 머리글 줄과 라벨 줄을 따로 둔다 —
 * `A54 －－－ / C54 ① E54 ② G54 ③` 아래 `A55 交換部品(Action) / C55 <값>`.
 * 머리글을 물려받지 않으면 E55·G55 의 두 번째·세 번째 교체부품을 놓친다.
 */
export function valueColumnsForRow(grid: GridLike, row: number): readonly number[] {
  for (let candidate = row; candidate >= row - ORDINAL_HEADER_LOOKBACK_ROWS; candidate--) {
    const columns = ordinalHeaderColumns(grid, candidate);
    if (columns.length > 0) return columns;
  }
  return CARD_VALUE_COLUMNS;
}

/** 그 줄에 A·B 열 글자가 있는가 — 「다음 라벨 줄」을 알아보는 데 쓴다. */
export function hasLabelText(grid: GridLike, row: number): boolean {
  for (const [letters, cell] of grid.cells(row)) {
    const column = columnLettersToNumber(letters);
    if (column < CARD_LABEL_COLUMN_MIN || column > CARD_LABEL_COLUMN_MAX) continue;
    if (toFoundCell(row, column, cell)) return true;
  }
  return false;
}

/** 읽어 낸 값 한 개 — 어느 칸에서 왔는지 함께 들고 온다. */
export type ReadValue = { address: string; text: string };

/**
 * 라벨 칸 하나가 가리키는 값들. 보통 한 줄에서 C·F 두 칸을 본다.
 * 동그라미 번호 머리글 줄이면 **아래 줄들**을 대신 읽는다.
 *
 * 돌려주는 것은 「빈칸 채움이 아닌 진짜 글자」뿐이다. 하나도 없으면 빈 배열 —
 * 부르는 쪽이 그것을 「없음」으로 옮긴다.
 */
export function readValuesFor(grid: GridLike, label: FoundCell): ReadValue[] {
  const ownHeader = ordinalHeaderColumns(grid, label.row);
  if (ownHeader.length > 0) return readBlockBelow(grid, label.row, ownHeader);

  const columns = valueColumnsForRow(grid, label.row);
  return readRowValues(grid, label.row, columns, label.column);
}

/** 한 줄에서 주어진 열들의 값. `afterColumn` 왼쪽 칸은 보지 않는다. */
function readRowValues(
  grid: GridLike,
  row: number,
  columns: readonly number[],
  afterColumn: number
): ReadValue[] {
  const cells = grid.cells(row);
  const values: ReadValue[] = [];
  for (const column of columns) {
    if (column <= afterColumn) continue;
    const text = cellToText(cells.get(columnNumberToLetters(column)));
    if (text === null) continue;
    values.push({ address: `${columnNumberToLetters(column)}${row}`, text });
  }
  return values;
}

/**
 * 머리글 줄 아래를 읽는다 — **다음 라벨 줄 직전까지**. 라벨 줄에서 멈추는 까닭:
 * 묶음의 끝을 줄 수로 못 박으면 판본마다 어긋나는데, 「다음 항목 이름이 나오면
 * 끝」은 양식이 바뀌어도 성립한다.
 */
function readBlockBelow(
  grid: GridLike,
  headerRow: number,
  columns: readonly number[]
): ReadValue[] {
  const values: ReadValue[] = [];
  for (let row = headerRow + 1; row <= headerRow + ORDINAL_BLOCK_MAX_ROWS; row++) {
    if (hasLabelText(grid, row)) break;
    values.push(...readRowValues(grid, row, columns, 0));
  }
  return values;
}

/**
 * 칸 하나 → 값 글자. 빈칸 채움(`-`)·칸 머리글(`①`)은 값이 아니므로 null.
 *
 * 숫자 칸은 **그대로 숫자로** 돌려준다. 날짜 일련번호인지 여부는 칸만 보아서는
 * 알 수 없다 — `使用年数` 3.76 도 `引取日` 44701 도 둘 다 숫자다. 그래서 날짜
 * 변환은 항목을 아는 `card-fields.ts` 가 `readDateValue` 로 따로 부른다.
 */
export function cellToText(cell: GridCell | undefined): string | null {
  if (!cell) return null;
  if (cell.kind === "number") return trimNumber(cell.value);
  const text = collapseWhitespace(cell.text);
  if (isDashPlaceholder(text)) return null;
  if (isOrdinalMark(text)) return null;
  return text;
}

/** 부동소수점 꼬리를 자른다 — `3.7616438356164386` → `3.76`. */
function trimNumber(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return String(Math.round(value * 100) / 100);
}

/**
 * 날짜 칸을 `YYYY-MM-DD` 로. 숫자면 일련번호로 풀고, 글자면 이미 날짜꼴일 때만
 * 그대로 돌려준다(`2022/06/1` 같은 것은 판단하지 않고 글자 그대로 둔다 —
 * 억지로 고치면 「틀린 값」이 되고, 지시서는 그것을 가장 경계한다).
 */
export function readDateValue(
  grid: GridLike,
  label: FoundCell,
  date1904: boolean
): ReadValue | null {
  const columns = valueColumnsForRow(grid, label.row);
  const cells = grid.cells(label.row);
  for (const column of columns) {
    if (column <= label.column) continue;
    const cell = cells.get(columnNumberToLetters(column));
    if (!cell) continue;
    const address = `${columnNumberToLetters(column)}${label.row}`;
    if (cell.kind === "number") {
      const date = excelSerialToDateOnly(cell.value, date1904 ? "1904" : "1900");
      if (date) return { address, text: date };
      continue;
    }
    const text = collapseWhitespace(cell.text);
    if (isDashPlaceholder(text)) continue;
    const iso = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(text);
    if (iso) {
      return {
        address,
        text: `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`,
      };
    }
    return { address, text };
  }
  return null;
}
