import { columnLettersToNumber, columnNumberToLetters } from "../xlsx/sheet-grid";
import { collapseWhitespace, isCheckMark, normalizeKey, type GridLike } from "./card-grid";

/**
 * ============================================================================
 * 수리보고서 시트의 ○ 표시 — 「원인」과 「처치」는 글자가 아니라 동그라미다
 * ============================================================================
 * Card 시트의 `６．原因(Main_Factor)` 칸은 실측에서 거의 언제나 비어 있다.
 * 원인은 **수리보고서 시트(`Repair_Report` · `修理報告書GEx`)의 보기들 위에
 * ○ 를 찍어** 고른다:
 *
 *     C30 `原　因`   J30 `製作不良`  R30 `部品不良`  Z30 `経年劣化` …
 *                    J31 `仕様不備`  R31 `検査ミス`  Z31 `取扱不備`
 *                                   AH31 `再現せず`  AN31 `○`  AP31 `その他`
 *
 * ── 🔴 ○ 는 라벨의 **왼쪽**에 있다 ────────────────────────────────────
 * 위 실측에서 AN31 의 ○ 가 고르는 것은 **오른쪽** AP31 `その他` 다. 처치 줄도
 * 같다 — `X28 ○` 다음에 `Z28 現品引取`. 오른쪽으로 읽으면 표시가 한 칸씩 앞
 * 보기로 밀려 **전혀 다른 원인**이 된다. 그래서 규칙은 하나다:
 *
 *   ▸ 보기 하나가 골렸다 = **앞 보기와 이 보기 사이**에 ○ 가 있다.
 *
 * 맨 뒤 보기보다 더 오른쪽에 있는 ○ 는 아무도 고르지 않는다. 이것이 덤으로
 * 도움 칸을 걸러 준다 — 실측에서 `AY31` 에 수식이 만든 ○ 가 앉아 있다.
 *
 * ── 도움 칸 구역은 잘라 낸다 ───────────────────────────────────────────
 * 보고서 시트 오른쪽(실측 AY 열부터)에는 수식용 도움 칸이 늘어서 있다
 * (`BAKA避け` · `判定条件` · `入力桁数` · `文字数`). 그 이름들이 앉은 가장 왼쪽
 * 열부터는 보기로 치지 않는다 — 이름을 찾지 못하면 자르지 않고, 위의 「맨 뒤
 * 보기보다 오른쪽은 무시」 규칙만으로 버틴다.
 *
 * ── 🔴 오른쪽 옆 상자에서 멈춘다 ──────────────────────────────────────
 * 처치 줄은 오른쪽에 **다른 상자**가 붙어 있다 — 처치 일자와 `No.` 와 접수번호다
 * (실측: `Z28 現品引取` … `AO28 No.` `AQ28 <접수번호>`). 그대로 훑으면 **접수번호가
 * 처치 보기로 잡힌다.** 원인 줄은 상자가 가로로 끝까지 가므로 열을 못 박을 수 없다.
 * 그래서 **가로 틈**으로 가른다: 보기 사이의 빈 열이 실측 최대 8칸(`J→R`·`R→Z`·
 * `Z→AH`·`AH→AP`)인데, 옆 상자로 건너가는 틈은 15칸(`Z→AO`)이다. 그 사이인
 * **9칸**에서 끊는다. ○ 표시는 틈 계산에서 끊는 쪽이 되지 않는다 — 실측에서 ○ 가
 * 첫 보기에서 14칸 떨어져 앉아 있다(`J28` → `X28`).
 * ============================================================================
 */

/** 도움 칸 구역의 시작을 알려 주는 이름들(실측). */
const HELPER_ZONE_KEYS = new Set(["baka避け", "判定条件", "入力桁数", "文字数"]);

/** 옆 상자로 건너갔다고 보는 가로 틈(빈 열 수 + 1). 위 머리말 참조. */
const NEIGHBOUR_BOX_GAP = 9;

/** 보기 줄을 몇 줄까지 훑을 것인가. 실측은 두 줄이고, 판본 여유로 넷까지 본다. */
const MARK_BLOCK_MAX_ROWS = 4;

/** 구역 이름(`原　因`)이 앉는 열 범위. 실측은 C 열 하나다. */
const SECTION_LABEL_COLUMN_MAX = 12;

export type MarkGroup = {
  /** 구역 이름 칸 주소(`C30`). 못 찾았으면 null 이고 나머지는 빈 값이다. */
  sectionAddress: string | null;
  /** 그 구역에 늘어선 보기들, 왼쪽에서 오른쪽·위에서 아래 차례. */
  options: readonly string[];
  /** ○ 가 찍힌 보기들. 하나도 없으면 빈 배열 = 「없음」. */
  marked: readonly string[];
};

const EMPTY_GROUP: MarkGroup = { sectionAddress: null, options: [], marked: [] };

/**
 * 수리보고서 시트 이름을 고른다. 판본마다 이름이 다르고, 한 통합문서에 비슷한
 * 이름이 여럿 있다(`1st_Repair_Report` 는 **조사 단계** 보고서다). 그래서
 * 우선순위를 못 박는다 — 정확히 `Repair_Report` → 제너레이터 양식의
 * `修理報告書GEx` → `Repair_Report…` 로 시작하는 것 → `修理報告書` 를 품은 것.
 */
export function pickRepairReportSheetName(sheetNames: readonly string[]): string | null {
  const keyed = sheetNames.map((name) => ({ name, key: normalizeKey(name) }));
  return (
    keyed.find((sheet) => sheet.key === "repair_report")?.name ??
    keyed.find((sheet) => sheet.key === "修理報告書gex")?.name ??
    keyed.find((sheet) => sheet.key.startsWith("repair_report"))?.name ??
    keyed.find((sheet) => sheet.key.includes("修理報告書"))?.name ??
    null
  );
}

/** 도움 칸 구역이 시작하는 열. 못 찾으면 `Infinity`(자르지 않는다). */
export function helperZoneColumn(grid: GridLike): number {
  let column = Number.POSITIVE_INFINITY;
  for (const row of grid.rowNumbers) {
    for (const [letters, cell] of grid.cells(row)) {
      if (cell.kind !== "text") continue;
      if (!HELPER_ZONE_KEYS.has(normalizeKey(cell.text))) continue;
      column = Math.min(column, columnLettersToNumber(letters));
    }
  }
  return column;
}

type RowCell = { column: number; text: string };

/**
 * 구역 하나를 읽는다. `sectionKey` 는 `normalizeKey` 를 통과한 글자여야 한다
 * (`原　因` → `原因`).
 */
export function readMarkGroup(grid: GridLike, sectionKey: string): MarkGroup {
  const section = findSectionCell(grid, sectionKey);
  if (!section) return EMPTY_GROUP;

  const cut = helperZoneColumn(grid);
  const options: string[] = [];
  const marked: string[] = [];

  for (const row of blockRows(grid, section)) {
    // 한 줄 안에서만 짝을 짓는다 — 보기와 그 왼쪽 ○ 는 언제나 같은 줄이다.
    let boundary = section.column;
    let previous = section.column;
    for (const cell of rowCells(grid, row, section.column, cut)) {
      const mark = isCheckMark(cell.text);
      // 🔴 옆 상자로 건너갔으면 거기서 이 줄은 끝이다(위 머리말).
      if (!mark && cell.column - previous >= NEIGHBOUR_BOX_GAP) break;
      previous = cell.column;
      if (mark) continue;
      options.push(cell.text);
      if (hasMarkBetween(grid, row, boundary, cell.column, cut)) marked.push(cell.text);
      boundary = cell.column;
    }
  }

  return { sectionAddress: section.address, options, marked };
}

type SectionCell = { row: number; column: number; address: string };

function findSectionCell(grid: GridLike, sectionKey: string): SectionCell | null {
  for (const row of grid.rowNumbers) {
    for (const [letters, cell] of grid.cells(row)) {
      const column = columnLettersToNumber(letters);
      if (column > SECTION_LABEL_COLUMN_MAX) continue;
      if (cell.kind !== "text" || normalizeKey(cell.text) !== sectionKey) continue;
      return { row, column, address: `${letters}${row}` };
    }
  }
  return null;
}

/**
 * 구역이 차지하는 줄들. 구역 이름이 앉은 열에 **다음 이름이 나오면 끝**이다
 * (`原　因` 다음은 `備　考`). 줄 수로 못 박지 않는 까닭은 판본마다 줄이 밀리기
 * 때문이고, 그래도 너무 멀리 가지 않도록 위 한계를 둔다.
 */
function blockRows(grid: GridLike, section: SectionCell): number[] {
  const rows: number[] = [section.row];
  const letters = columnNumberToLetters(section.column);
  for (let row = section.row + 1; row < section.row + MARK_BLOCK_MAX_ROWS; row++) {
    const cell = grid.cells(row).get(letters);
    if (cell && cell.kind === "text" && collapseWhitespace(cell.text) !== "") break;
    rows.push(row);
  }
  return rows;
}

/** 그 줄에서 구역 이름 오른쪽·도움 칸 왼쪽의 글자 칸들, 왼쪽부터. */
function rowCells(grid: GridLike, row: number, afterColumn: number, cut: number): RowCell[] {
  const cells: RowCell[] = [];
  for (const [letters, cell] of grid.cells(row)) {
    if (cell.kind !== "text") continue;
    const column = columnLettersToNumber(letters);
    if (column <= afterColumn || column >= cut) continue;
    const text = collapseWhitespace(cell.text);
    if (text === "") continue;
    cells.push({ column, text });
  }
  return cells.sort((a, b) => a.column - b.column);
}

/** 두 열 사이에 ○ 가 있는가 — 🔴 이 함수가 「왼쪽」 규칙 그 자체다. */
function hasMarkBetween(grid: GridLike, row: number, after: number, before: number, cut: number): boolean {
  for (const cell of rowCells(grid, row, after, cut)) {
    if (cell.column >= before) break;
    if (isCheckMark(cell.text)) return true;
  }
  return false;
}
