import { clearCell, setInlineString } from "./sheet-patch";
import { findRowByCellText, resizeRowBlock, type SheetRow } from "./sheet-rows";

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
 * ============================================================================
 * 작업 내역 세 묶음 — 「① 인수 조사 · ② 수리 작업 · ③ 통전검사」
 * ============================================================================
 * 양식 넷이 모두 이 세 묶음을 갖는데 **머리글 글자가 다르다**(제너레이터는
 * `인수 조사`, 매쳐는 `조사작업`, O/H 의 ② 는 `OH 및 수리 작업`). 그래서 글자는
 * 각 채우개가 들고 있고, 여기는 **자리를 찾고 줄 수를 맞추는 방법**만 안다.
 *
 * ── 🔴 빈 묶음은 양식 그대로 둔다 ───────────────────────────────────────
 * 준 목록이 빈 배열이면 그 묶음은 **손대지 않는다.** 줄을 0개로 줄이지 않는다.
 * 유효기간·납기가 이미 쓰는 규칙과 같다("비워 두면 양식의 기본 문구를 그대로
 * 쓴다"). 지금까지 저장된 제너레이터 견적서는 작업 내역이 전부 비어 있어서, 이
 * 규칙이 없으면 예전 견적서를 다시 내려받을 때 **표준 통전검사 7줄이 통째로
 * 사라진 문서**가 나간다.
 * ============================================================================
 */

/**
 * 묶음 구분. 저장 쪽(`validation/quote-input.ts` 의 `QUOTE_WORK_SCOPE_SECTIONS`)과
 * 같은 키다. 그 모듈을 여기서 가져오지 않는 이유는, xlsx 층이 앱 층을 모르는 채로
 * 남아 있어야 이 파일들을 다른 곳에 떼어 쓸 수 있기 때문이다.
 */
export const WORK_SCOPE_SECTIONS = ["INVESTIGATION", "REPAIR", "POWER_TEST"] as const;
export type WorkScopeSection = (typeof WORK_SCOPE_SECTIONS)[number];

/** 묶음별 D열 머리글과 견주는 방식. 양식마다 다르다 — 각 채우개가 제 것을 들고 있다. */
export type WorkScopeLabels = Record<WorkScopeSection, { label: string; match: LabelMatch }>;

/** 묶음별로 문서에 적을 줄. **빈 배열은 "양식 그대로 둔다"** 는 뜻이다. */
export type WorkScopeLines = Record<WorkScopeSection, readonly string[]>;

export type WorkScopeBlocks = Record<WorkScopeSection, ItemBlock>;

/**
 * ── 🔴 "비어 있음" 과 "일부러 없앰" 은 다르다 ──────────────────────────
 *
 * 묶음별로 **그 구역을 문서에서 통째로 지울지**. 켜면 항목 줄만이 아니라
 * **머리글 줄까지** 사라진다.
 *
 * 🔴 이것은 줄 수와 **완전히 별개의 입력**이다. 빈 목록은 위 머리말대로
 * "양식 그대로 둔다"는 뜻이고, 그것을 "없애라"로 읽으면 손대지 않은 예전
 * 견적서에서 표준 문구가 통째로 사라진 문서가 고객사로 나간다.
 *
 * 왜 집합(`Set<WorkScopeSection>`)이 아니라 `Record` 인가 — `WorkScopeLines`·
 * `WorkScopeLabels` 가 이미 그 모양이고, 묶음이 하나 더 생기는 날 **컴파일러가
 * 여기를 채우라고 짚어 주기 때문**이다. 집합이면 새 묶음이 조용히 "안 없앰"
 * 으로 흘러가고, 그런 종류의 누락은 문서가 나간 뒤에야 드러난다.
 */
export type WorkScopeExclusions = Record<WorkScopeSection, boolean>;

/** 아무것도 주지 않았을 때. 셋 다 양식 그대로 나간다. */
export const EMPTY_WORK_SCOPE_LINES: WorkScopeLines = {
  INVESTIGATION: [],
  REPAIR: [],
  POWER_TEST: [],
};

/** 신호를 주지 않았을 때. 하나도 없애지 않는다 — 예전과 한 글자도 다르지 않다. */
export const NO_WORK_SCOPE_EXCLUSIONS: WorkScopeExclusions = {
  INVESTIGATION: false,
  REPAIR: false,
  POWER_TEST: false,
};

/**
 * 없애기로 한 묶음의 줄 목록을 비운다.
 *
 * 없앤 묶음은 **적을 자리 자체가 문서에서 사라진다.** 그런데 줄 목록은 화면에서
 * 온 그대로 들어오므로, 그것을 들고 채우러 가면 사라진 자리 아래에 있던 **남의
 * 줄에** 글이 적힌다. 채우개 셋이 저마다 막게 두지 않고 여기서 한 번 비운다.
 *
 * 없애는 묶음이 하나도 없으면 내용이 같은 그릇을 그대로 돌려준다 — 신호를 주지
 * 않았을 때 결과가 달라질 여지를 남기지 않기 위해서다.
 */
export function dropExcludedWorkScopeLines(
  lines: WorkScopeLines,
  excluded: WorkScopeExclusions
): WorkScopeLines {
  const next = { ...lines };
  for (const section of WORK_SCOPE_SECTIONS) {
    if (excluded[section]) next[section] = [];
  }
  return next;
}

/** 세 묶음의 자리. 못 찾으면 던진다(findLabelRow 와 같은 판단). */
export function findWorkScopeBlocks(
  rows: readonly SheetRow[],
  read: (ref: string) => string | null,
  labels: WorkScopeLabels
): WorkScopeBlocks {
  return {
    INVESTIGATION: findItemBlock(rows, read, labels.INVESTIGATION.label, labels.INVESTIGATION.match),
    REPAIR: findItemBlock(rows, read, labels.REPAIR.label, labels.REPAIR.match),
    POWER_TEST: findItemBlock(rows, read, labels.POWER_TEST.label, labels.POWER_TEST.match),
  };
}

/**
 * 그 묶음이 실제로 갖게 될 줄 수. 빈 목록이면 **양식의 줄 수 그대로**다.
 * 자리를 셈하는 쪽(합계 범위의 끝 따위)이 이 값을 봐야 한다.
 *
 * 없앤 묶음은 **0** 이다 — 빈 목록과 정반대다. 그래서 그 뜻을 줄 수에서 읽지
 * 않고 따로 받는다.
 */
export function workScopeRowCount(
  block: ItemBlock,
  lines: readonly string[],
  excluded = false
): number {
  if (excluded) return 0;
  return lines.length === 0 ? block.count : lines.length;
}

/**
 * 세 묶음의 줄 수를 맞춘다 — 🔴 **아래에서부터**(③ → ② → ①).
 *
 * 위를 먼저 늘리면 아래 묶음의 시작 행이 이미 밀려 있어 엉뚱한 줄을 잡는다.
 * 고친 뒤에 다시 훑지도 않는다 — 복제된 줄은 아직 C열이 비어 있어 머리글
 * 훑기로는 안 세어진다. 그래서 **이동량(delta)을 돌려주고** 부르는 쪽이 셈한다.
 *
 * ── 🔴 ② 는 양식에 줄이 0개다 ──────────────────────────────────────────
 * 제너레이터 양식 둘 다 「수리 작업」 아래에 줄이 하나도 없다. 복제할 본이 그
 * 구간 안에 없으므로 **① 의 마지막 줄을 본으로 건네준다** — 같은 서식이라 그대로
 * 복제하면 그 줄만 모양이 다른 일이 없다. ① 을 아직 안 건드린 시점이라(아래에서
 * 부터 고친다) 그 행 번호는 양식 그대로다.
 *
 * ── 🔴 없애는 묶음은 머리글까지 지운다 ─────────────────────────────────
 * `excluded` 에서 켠 묶음은 항목 줄을 0개로 줄이는 데서 그치지 않고 **머리글
 * 줄까지** 없앤다. 통전작업을 하지 않아 돈을 빼면서 문서에는 「절연저항치·
 * 내압시험 …」 이 그대로 찍혀 나가면, 하지 않은 시험을 했다고 적어 보내는 셈이다.
 *
 * 그래서 구간의 시작을 **머리글 행**으로 잡고 줄 수를 하나 더 세어 0으로 줄인다.
 * 이렇게 하면 돌려주는 이동량(delta)에 **머리글 한 줄이 저절로 들어간다** —
 * 부르는 쪽은 그 값으로 rowShift 를 셈하므로, 여기서 한 줄을 빠뜨리면 공급가·
 * 부가세·합계가 엉뚱한 칸에 박힌다.
 */
export function resizeWorkScopeBlocks(
  rows: readonly SheetRow[],
  blocks: WorkScopeBlocks,
  lines: WorkScopeLines,
  excluded: WorkScopeExclusions = NO_WORK_SCOPE_EXCLUSIONS
): { rows: SheetRow[]; deltas: Record<WorkScopeSection, number> } {
  const modelRow =
    blocks.INVESTIGATION.count > 0
      ? blocks.INVESTIGATION.firstRow + blocks.INVESTIGATION.count - 1
      : undefined;

  let next: SheetRow[] = [...rows];
  const deltas: Record<WorkScopeSection, number> = {
    INVESTIGATION: 0,
    REPAIR: 0,
    POWER_TEST: 0,
  };

  // 아래에서부터. 순서를 뒤집으면 조용히 어긋난 문서가 나간다.
  for (const section of ["POWER_TEST", "REPAIR", "INVESTIGATION"] as const) {
    const block = blocks[section];

    // 🔴 없애는 묶음. **줄 수를 보기 전에** 판단한다 — 이 신호는 줄 수와 별개다.
    // 머리글 행부터 한 줄 더 세어 통째로 0줄로 만든다(위 머리말).
    if (excluded[section]) {
      const resized = resizeRowBlock(next, {
        firstRow: block.headerRow,
        currentCount: block.count + 1,
        targetCount: 0,
      });
      next = resized.rows;
      deltas[section] = resized.delta;
      continue;
    }

    // 빈 묶음은 양식 그대로 둔다(위 머리말).
    if (lines[section].length === 0) continue;

    const resized = resizeRowBlock(next, {
      firstRow: block.firstRow,
      currentCount: block.count,
      targetCount: lines[section].length,
      modelRow,
    });
    next = resized.rows;
    deltas[section] = resized.delta;
  }

  return { rows: next, deltas };
}

/**
 * 한 묶음의 줄들을 적는다. 복제된 줄은 줄임표(`-`)까지 비워져 있어 줄마다 다시
 * 쓴다(sheet-rows.ts 의 blankRow).
 *
 * 빈 목록이면 아무것도 하지 않는다 — 양식의 기본 문구가 그대로 남는다.
 */
export function fillWorkScopeRows(
  sheetXml: string,
  firstRow: number,
  lines: readonly string[]
): string {
  let xml = sheetXml;
  lines.forEach((line, index) => {
    const row = firstRow + index;
    xml = setInlineString(xml, `${LAYOUT_COLUMNS.marker}${row}`, ITEM_MARKER);
    xml = setInlineString(xml, `${LAYOUT_COLUMNS.name}${row}`, line.trim());
  });
  return xml;
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
