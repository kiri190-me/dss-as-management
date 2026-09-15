import { parseSheetRows, SheetRowError, type SheetRow } from "./sheet-rows";
import { resolveSheetPart, SHARED_STRINGS_PART, WORKBOOK_PART } from "./workbook-parts";
import { decodeXmlCharacterData } from "./xml-entities";
import type { ZipArchive } from "./zip-reader";

/**
 * ============================================================================
 * 시트 하나를 **행 × 열 → 값** 으로 읽는다 — 목록형 시트를 가져오는 쪽의 읽개
 * ============================================================================
 * 교산 인수품 리스트(시트 `リスト`)를 가져오려고 만들었다(2026-09-15, S1). 견적서·
 * 보고서 채우개가 쓰는 `sheet-text.ts` 는 정해진 칸 몇 개를 주소로 읽는 도구라,
 * 수백 줄을 훑는 일에는 맞지 않는다.
 *
 * ── 🔴 후리가나(`<rPh>`)를 걷는다 ──────────────────────────────────────
 * 일본어 Excel 은 공유문자열 `<si>` 안에 읽는 법을 `<rPh><t>シュベツ</t></rPh>` 로
 * 함께 적는다. `<t>` 를 전부 이어 붙이면 `種別` 이 `種別シュベツ` 가 되고, 그러면
 * 머리글 대조가 전부 어긋난다. 여기서는 `<rPh>`·`<phoneticPr>` 를 먼저 들어낸 뒤
 * 남은 `<t>` 조각(서식 run `<r><t>` 여러 개 포함)을 잇는다.
 *
 * `sheet-text.ts` 의 `parseSharedStrings` 도 같은 결함이 있지만 **일부러 고치지
 * 않았다** — 그쪽은 한국어 양식만 읽고, 고치면 견적서·보고서 채우개의 동작이 함께
 * 바뀐다. 결함은 알고 남겨 둔 것이다.
 *
 * ── 칸의 종류 ──────────────────────────────────────────────────────────
 *  · `t="s"`(공유문자열) · `t="inlineStr"` · `t="str"`(수식 결과 문자열) → 글자
 *  · 형식 없음 / `t="n"` → 숫자(날짜도 여기로 온다 — 일련번호다)
 *  · `t="e"`(수식 오류 `#N/A` 등) → **빈칸**. 가져오는 쪽에는 값이 없는 것과 같다.
 *  · `t="b"` → `TRUE`/`FALSE` 글자, `t="d"` → 적힌 글자 그대로
 * 빈 글자·값 없는 칸은 Map 에 넣지 않는다.
 * ============================================================================
 */

export type GridCell = { kind: "text"; text: string } | { kind: "number"; value: number };

export type SheetGrid = {
  /** workbook.xml 의 `<workbookPr date1904="1"/>`. 날짜 일련번호를 풀 때 쓴다. */
  date1904: boolean;
  /** 시트에 적힌 행 번호들, 오름차순. 칸이 없는 줄(`<row r="9"/>`)도 들어 있다. */
  rowNumbers: readonly number[];
  /** 그 행의 칸들 — 열 문자(`"C"`) → 값. 없는 행이면 빈 Map. */
  cells(rowNumber: number): ReadonlyMap<string, GridCell>;
};

const NO_CELLS: ReadonlyMap<string, GridCell> = new Map();

/**
 * 이름으로 시트를 찾아 읽는다. 시트를 못 찾으면(이름이 없거나 관계가 깨졌으면)
 * **null** — 부르는 쪽이 "시트 없음" 으로 알린다.
 *
 * 공유문자열 파트는 `xl/sharedStrings.xml` 고정이다(workbook-parts.ts 와 같은 약속).
 */
export function readSheetGrid(archive: ZipArchive, sheetName: string): SheetGrid | null {
  let sheetPart: string;
  try {
    sheetPart = resolveSheetPart(archive, sheetName);
  } catch {
    return null;
  }
  return buildSheetGrid(
    archive.readText(sheetPart),
    parseSharedStringsWithoutPhonetics(archive.readTextOrNull(SHARED_STRINGS_PART)),
    readDate1904(archive.readText(WORKBOOK_PART))
  );
}

/** `<workbookPr date1904="1"/>`(또는 `"true"`)면 true. 없거나 0 이면 1900 체계. */
export function readDate1904(workbookXml: string): boolean {
  const workbookPr = /<workbookPr\b([^>]*)>/.exec(workbookXml);
  return workbookPr ? /\bdate1904="(?:1|true)"/.test(workbookPr[1]) : false;
}

/** 공유문자열 표 — 후리가나를 걷고 서식 run 을 이은 **보이는 글자**들. */
export function parseSharedStringsWithoutPhonetics(xml: string | null): string[] {
  if (!xml) return [];
  const strings: string[] = [];
  for (const si of xml.matchAll(/<si\b[^>]*?(?:\/>|>([\s\S]*?)<\/si>)/g)) {
    strings.push(visibleText(si[1] ?? ""));
  }
  return strings;
}

/**
 * `<si>`·`<is>` 안쪽 → 보이는 글자. `<rPh>`(읽는 법)·`<phoneticPr>` 를 먼저 들어내고
 * 남은 `<t>` 를 잇는다.
 */
function visibleText(richTextXml: string): string {
  const body = richTextXml
    .replace(/<rPh\b[\s\S]*?<\/rPh>/g, "")
    .replace(/<phoneticPr\b[^>]*?(?:\/>|>[\s\S]*?<\/phoneticPr>)/g, "");
  let text = "";
  for (const piece of body.matchAll(/<t\b[^>]*?(?:\/>|>([\s\S]*?)<\/t>)/g)) text += piece[1] ?? "";
  return decodeExcelEscapes(decodeXmlCharacterData(text));
}

/**
 * Excel 은 XML 에 못 적는 제어 문자를 `_x000D_` 꼴로 적는다(ST_Xstring). 글자 그대로의
 * `_x` 는 `_x005F_x…` 로 적히므로, 한 번에 풀면 두 번 풀리는 글자가 없다.
 */
function decodeExcelEscapes(text: string): string {
  return text.replace(/_x([0-9A-Fa-f]{4})_/g, (_whole, hex: string) =>
    String.fromCharCode(Number.parseInt(hex, 16))
  );
}

/**
 * 시트 XML 문자열에서 바로 만든다(시험과, 아카이브 없이 XML 만 가진 쪽을 위해).
 * `<sheetData>` 가 없거나 비었으면 줄이 하나도 없는 격자다.
 */
export function buildSheetGrid(
  sheetXml: string,
  sharedStrings: readonly string[],
  date1904: boolean
): SheetGrid {
  let rows: SheetRow[] = [];
  try {
    rows = parseSheetRows(sheetXml);
  } catch (error) {
    if (!(error instanceof SheetRowError)) throw error;
  }

  const byRow = new Map<number, Map<string, GridCell>>();
  for (const row of rows) byRow.set(row.rowNumber, readRowCells(row.xml, sharedStrings));
  const rowNumbers = [...byRow.keys()].sort((a, b) => a - b);

  return {
    date1904,
    rowNumbers,
    cells: (rowNumber) => byRow.get(rowNumber) ?? NO_CELLS,
  };
}

/**
 * 한 줄의 칸들. 자체닫힘 칸(`<c r="C5" s="3"/>`)을 먼저 알아봐야 한다 — 여는 태그로
 * 잘못 읽으면 다음 칸의 `</c>` 까지 먹는다(sheet-rows.ts 의 blankRow 참조).
 */
const CELL = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;

function readRowCells(rowXml: string, sharedStrings: readonly string[]): Map<string, GridCell> {
  const cells = new Map<string, GridCell>();
  const open = /^<row\b[^>]*?(\/?)>/.exec(rowXml);
  if (!open || open[1] === "/") return cells;

  const inner = rowXml.slice(open[0].length);
  // 주소(`r=`)가 빠진 칸은 바로 앞 칸의 다음 열이다(규격이 허용한다).
  let nextColumn = 1;
  for (const match of inner.matchAll(CELL)) {
    const attributes = match[1];
    const ref = /\br="([A-Z]+)\d*"/.exec(attributes);
    const columnNumber = ref ? columnLettersToNumber(ref[1]) : nextColumn;
    nextColumn = columnNumber + 1;

    const cell = readCell(attributes, match[2] ?? "", sharedStrings);
    if (cell) cells.set(columnNumberToLetters(columnNumber), cell);
  }
  return cells;
}

function readCell(
  attributes: string,
  body: string,
  sharedStrings: readonly string[]
): GridCell | null {
  const type = /\bt="([^"]*)"/.exec(attributes)?.[1] ?? "n";
  const value = /<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/.exec(body)?.[1];

  switch (type) {
    case "s": {
      if (value === undefined) return null;
      return textCell(sharedStrings[Number(value.trim())]);
    }
    case "inlineStr": {
      const inline = /<is\b[^>]*>([\s\S]*?)<\/is>/.exec(body)?.[1];
      return inline === undefined ? null : textCell(visibleText(inline));
    }
    case "e":
      return null;
    case "b":
      if (value === undefined) return null;
      return textCell(value.trim() === "1" ? "TRUE" : "FALSE");
    case "n": {
      if (value === undefined || value.trim() === "") return null;
      const number = Number(value.trim());
      return Number.isFinite(number) ? { kind: "number", value: number } : null;
    }
    default:
      // "str"(수식 결과 문자열) · "d"(ISO 날짜 글자) · 모르는 형식 — 적힌 글자 그대로.
      return value === undefined ? null : textCell(decodeExcelEscapes(decodeXmlCharacterData(value)));
  }
}

function textCell(text: string | undefined): GridCell | null {
  return text === undefined || text === "" ? null : { kind: "text", text };
}

export function columnLettersToNumber(letters: string): number {
  let number = 0;
  for (const letter of letters) number = number * 26 + (letter.charCodeAt(0) - 64);
  return number;
}

export function columnNumberToLetters(columnNumber: number): string {
  let letters = "";
  let rest = columnNumber;
  while (rest > 0) {
    const remainder = (rest - 1) % 26;
    letters = String.fromCharCode(65 + remainder) + letters;
    rest = Math.floor((rest - 1) / 26);
  }
  return letters;
}
