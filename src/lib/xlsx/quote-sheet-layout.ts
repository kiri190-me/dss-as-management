import { clearCell } from "./sheet-patch";
import { findRowByCellText, type SheetRow } from "./sheet-rows";

/**
 * ============================================================================
 * 견적서 양식에서 **자리를 찾는다** — 행 번호를 코드에 박지 않기 위해
 * ============================================================================
 * 이 양식들은 사람이 건마다 줄을 넣어 저장하는 문서다. 실제로 하루 사이에 두 번
 * 바뀌었다 — 제너레이터 O/H 는 부품 칸이 5줄에서 8줄로, O/H 부품 칸이 13줄에서
 * 12줄로 늘고 줄었다. 행을 박아 두면 그때마다 **엉뚱한 칸에 값이 앉는다.**
 *
 * 조용히 틀리는 것이 특히 나쁘다. 예를 들어 O/H 부품 칸이 세 줄 밀린 채로
 * 예전 행에 쓰면 「2) OH 부품 비용」 이라는 **머리글 자체가 부품 이름으로
 * 덮어써진다.** 그 문서는 고객사로 나가고, 우리는 알 길이 없다.
 *
 * ── 자리를 정하는 규칙 ──────────────────────────────────────────────────
 *  · 묶음의 머리글은 D열의 글자로 찾는다(`부품 비용`, `조사작업`, `작업비 …`).
 *  · 묶음의 항목은 머리글 바로 아래부터 **C열이 `-` 인 줄이 이어지는 만큼**이다.
 *    고정 안내 문구는 `*` 라서 걸리지 않고, 빈 줄에서 자연히 끝난다.
 *  · 합계 머리글은 H열인데 `공 급 가` 처럼 글자 사이가 띄워져 있다. 공백을
 *    지우고 견준다.
 * ============================================================================
 */

/** 항목 줄임표. 이 열이 이 글자인 동안이 한 묶음이다. */
export const ITEM_MARKER = "-";

export const LAYOUT_COLUMNS = {
  marker: "C",
  name: "D",
  quantity: "G",
  unitPrice: "H",
  amount: "I",
} as const;

export type ItemBlock = {
  headerRow: number;
  /** 머리글 바로 아래. 항목이 없어도(`count` 0) 이 값은 있다. */
  firstRow: number;
  count: number;
};

/** 글자를 어떻게 견줄 것인가. 제너레이터의 `작업비 (조사,수리,…)` 는 너무 길어 앞만 본다. */
export type LabelMatch = "exact" | "prefix";

function matches(value: string, label: string, mode: LabelMatch): boolean {
  const trimmed = value.trim();
  return mode === "prefix" ? trimmed.startsWith(label) : trimmed === label;
}

/**
 * 그 글자가 있는 줄. 없으면 던진다 — 조용히 넘어가면 값이 하나도 안 들어간
 * 견적서가 나간다.
 */
export function findLabelRow(
  rows: readonly SheetRow[],
  read: (ref: string) => string | null,
  column: string,
  label: string,
  mode: LabelMatch = "exact"
): number {
  if (mode === "exact") {
    const row = findRowByCellText(rows, column, label, read);
    if (row === null) throw new Error(`양식에서 "${label}" 줄을 찾지 못했습니다.`);
    return row;
  }
  for (const row of rows) {
    const value = read(`${column}${row.rowNumber}`);
    if (value !== null && matches(value, label, mode)) return row.rowNumber;
  }
  throw new Error(`양식에서 "${label}" 로 시작하는 줄을 찾지 못했습니다.`);
}

/** 공백을 지우고 견준다. `공 급 가` · `합     계` 처럼 모양을 맞춰 띄워 둔 머리글용. */
export function findSpacedLabelRow(
  rows: readonly SheetRow[],
  read: (ref: string) => string | null,
  column: string,
  label: string
): number {
  for (const row of rows) {
    const value = read(`${column}${row.rowNumber}`);
    if (value !== null && value.replace(/\s+/g, "") === label) return row.rowNumber;
  }
  throw new Error(`양식에서 "${label}" 줄을 찾지 못했습니다.`);
}

/**
 * 머리글과 그 아래 항목 줄들.
 *
 * 행 번호가 끊기면(양식에 빠진 행이 있으면) 거기서 멈춘다 — 떨어져 있는 줄을
 * 한 묶음으로 묶어 늘리면 사이의 줄이 통째로 밀려난다.
 */
export function findItemBlock(
  rows: readonly SheetRow[],
  read: (ref: string) => string | null,
  label: string,
  mode: LabelMatch = "exact"
): ItemBlock {
  const headerRow = findLabelRow(rows, read, LAYOUT_COLUMNS.name, label, mode);

  const start = rows.findIndex((row) => row.rowNumber === headerRow);
  let count = 0;
  for (let index = start + 1; index < rows.length; index += 1) {
    const row = rows[index];
    if (row.rowNumber !== headerRow + 1 + count) break;
    if (read(`${LAYOUT_COLUMNS.marker}${row.rowNumber}`) !== ITEM_MARKER) break;
    count += 1;
  }

  return { headerRow, firstRow: headerRow + 1, count };
}

/**
 * 찾아 둔 자리들이 위에서 아래로 이 차례인지 확인한다.
 *
 * 자리를 옮긴 뒤의 셈은 이 차례를 전제로 한다. 양식이 뒤바뀌었는데 그대로
 * 진행하면 조용히 어긋난 문서가 나가므로, 여기서 멈추는 편이 낫다.
 */
export function assertAscending(labelled: ReadonlyArray<readonly [string, number]>): void {
  for (let index = 1; index < labelled.length; index += 1) {
    const previous = labelled[index - 1];
    const current = labelled[index];
    if (current[1] <= previous[1]) {
      throw new Error(
        `양식의 차례가 예상과 다릅니다: "${previous[0]}"(${previous[1]}행) 아래에 ` +
          `"${current[0]}"(${current[1]}행) 이 와야 합니다.`
      );
    }
  }
}

/**
 * 그 칸이 있으면 비우고, 없으면 그냥 둔다.
 *
 * 쓰는 쪽은 원래 못 찾으면 던진다 — 값이 안 들어간 견적서가 나가는 것보다
 * 낫기 때문이다. 여기는 반대다: **양식이 남겨 둔 여유 줄을 치우는 일**이라
 * 그 칸이 없다는 것은 치울 것이 없다는 뜻이지 사고가 아니다.
 */
export function clearCellIfPresent(sheetXml: string, ref: string): string {
  try {
    return clearCell(sheetXml, ref);
  } catch {
    return sheetXml;
  }
}

/**
 * 수식 칸에 박혀 있는 **오류 캐시값**(`#REF!` 따위)을 걷어낸다.
 *
 * 양식이 다른 통합문서를 참조하다가 링크가 끊긴 채로 저장되면 그 자리에
 * `<f>D13</f><v>#REF!</v>` 가 남는다. Excel 은 열 때 다시 계산하니 괜찮지만,
 * **미리보기나 다른 뷰어는 캐시값을 그대로 보여 준다** — 본문 제목 자리에
 * `#REF!` 가 찍힌 견적서를 고객사가 보게 된다.
 *
 * 값을 지우고 수식만 남긴다. 오류를 캐시로 갖고 있어야 할 이유는 없다.
 *
 * 🔴 여는 태그의 마지막 글자가 `/` 이면 안 된다 — 자기 닫힘 칸을 여는 태그로
 * 읽으면 뒤따르는 칸까지 하나로 뭉갠다(sheet-rows.ts 의 blankRow 와 같은 함정).
 */
export function dropErrorValueCaches(sheetXml: string): string {
  return sheetXml.replace(
    /<c(\s[^>]*?[^/])>((?:(?!<\/c>)[\s\S])*?<\/f>)\s*<v>#[^<]*<\/v>\s*<\/c>/g,
    (_all, attributes: string, upToFormula: string) =>
      `<c${attributes.replace(/\st="e"/, "")}>${upToFormula}</c>`
  );
}
