import { createCellTextReader } from "./sheet-text";
import { SERVICE_REPORT_CELLS, SERVICE_REPORT_SHEET_NAME } from "./service-report-template";
import { resolveSheetPart, SHARED_STRINGS_PART } from "./workbook-parts";
import { ZipArchive } from "./zip-reader";

/**
 * ============================================================================
 * 양식에 걸린 드롭다운 목록을 **양식에서 읽어 낸다**
 * ============================================================================
 * 검사·수리 보고서 양식은 두 칸에 데이터 유효성 검사(드롭다운)를 걸어 두었다:
 *
 *   · `H21` 「상　황」 윗칸 — 의뢰 종류(수리의뢰 / 오버홀 의뢰 / 동작확인의뢰 …)
 *   · `H19` 「품　명」 — 주파수 × 출력 열두 가지(`13.56MHz 30kW` …)
 *
 * 🔴 **목록 값도, 그 값이 놓인 자리도 코드에 적지 않는다.** 사람이 Excel 에서
 * 항목을 하나 더하는 날, 화면이 저절로 따라가야 한다. 목록을 코드에 베껴 두면
 * 그날 화면과 문서가 어긋나고 — 더 나쁘게는 **아무도 어긋난 줄을 모른다**
 * (드롭다운에 안 보이는 항목은 아무도 못 고르므로 오류가 나지 않는다).
 *
 * 그래서 세 단계를 전부 양식에서 읽는다:
 *
 *   1. 그 칸을 품은 `<dataValidation>` 을 `sqref` 로 찾고
 *   2. 그 `formula1`(예: `$BS$21:$BS$24`)이 가리키는 범위를 풀어
 *   3. 그 범위의 셀 글자를 읽는다.
 *
 * 채우개(`service-report-template.ts`)와 **다른 파일**인 이유는 사는 이유가
 * 달라서다. 채우개는 값을 받아 문서를 만들고, 여기는 문서가 무슨 값을
 * 받아들이는지 물어본다. 채우개는 이미 1340줄이고, 화면이 목록만 필요할 때
 * 통합문서를 다시 쓰는 코드까지 딸려 오면 안 된다.
 *
 * ── 🔴 못 찾으면 빈 배열이 아니라 던진다 ────────────────────────────────
 * 빈 드롭다운을 조용히 화면에 내미는 것은, 사람이 「상황」 칸을 열고 아무것도
 * 없는 것을 보고 "아직 안 만들었나 보다" 하고 손으로 적게 만드는 일이다.
 * 목록이 안 읽히면 **양식이 바뀐 것**이고, 그건 사람이 알아야 한다.
 *
 * ── 🔴 후리가나를 걷어 낸다 ─────────────────────────────────────────────
 * 이 양식의 공유문자열에는 일본어 후리가나가 `<rPh>` 로 딸려 있다. 그대로 읽으면
 * 「 ・ 수리의뢰」가 「 ・ 수리의뢰シュウリイライ」로 온다 — 그 값을 화면에
 * 띄우고 다시 `H21` 에 적으면 문서에 없던 가타카나가 찍혀 나간다. `<rPh>` 를
 * 먼저 걷어 낸 공유문자열을 `createCellTextReader` 에 넘겨 그 구조를 건드리지
 * 않고 표시 글자만 얻는다(채우개의 `assertLayout` 이 `startsWith` 로 우회한
 * 것과 같은 문제, 다른 답 — 여기서는 값 전체가 필요하다).
 *
 * ── 앞 공백은 다듬지 않는다 ─────────────────────────────────────────────
 * 상황 목록의 값은 `" ・ 수리의뢰"` 처럼 **글머리표가 붙은 채**다. 채우개도
 * 이 칸만은 다듬지 않고 그대로 적는다(`ServiceReportCommon.situation`).
 * 여기서 다듬으면 화면에서 고른 값과 문서에 찍히는 값이 달라진다.
 * ============================================================================
 */

export type ServiceReportChoices = {
  /** `H21` 의 목록 — 상황·의뢰 종류. */
  situationRequests: readonly string[];
  /** `H19` 의 목록 — 품명(주파수 × 출력). */
  productNames: readonly string[];
};

/**
 * 한 번에 읽어 낼 수 있는 목록 칸 수의 상한.
 *
 * 상한이 아니라 폭주 방지다. 누군가 Excel 에서 `formula1` 을 열 전체(`$A:$A`)로
 * 바꿔 두면 백만 칸을 훑게 된다. 드롭다운 목록이 천 줄을 넘는 일은 없다.
 */
const MAX_CHOICE_CELLS = 1000;

export function readServiceReportChoices(templateXlsx: Buffer): ServiceReportChoices {
  const archive = ZipArchive.fromBuffer(templateXlsx);
  const sheetPart = resolveSheetPart(archive, SERVICE_REPORT_SHEET_NAME);
  const sheetXml = archive.readText(sheetPart);
  // 🔴 후리가나를 먼저 걷어 낸다. 위 '후리가나를 걷어 낸다'.
  const sharedStringsXml = stripPhoneticRuns(archive.readTextOrNull(SHARED_STRINGS_PART));

  const validations = parseDataValidations(sheetXml);

  const readList = (cell: string, label: string): readonly string[] =>
    readChoiceList(archive, sheetXml, sharedStringsXml, validations, cell, label);

  return {
    situationRequests: readList(SERVICE_REPORT_CELLS.situationRequest, "상황·의뢰 종류"),
    productNames: readList(SERVICE_REPORT_CELLS.productName, "품명"),
  };
}

// ── 유효성 검사 읽기 ─────────────────────────────────────────────────────

type DataValidation = { sqref: string; formula1: string };

/**
 * 시트의 `<dataValidation>` 전부.
 *
 * 보통은 `<dataValidations>` 안에 있지만, Excel 이 확장으로
 * `<x14:dataValidation>`(`<extLst>` 안)에 넣어 두는 경우가 있다. 두 모양이
 * 다른 것은 이름공간 접두사와 `sqref`·`formula1` 이 놓이는 자리뿐이라, 접두사를
 * 무시하고 둘 다 훑는다. **지금 이 양식은 확장 쪽을 안 쓰지만**(실측: `<extLst>`
 * 자체가 없다) 사람이 Excel 에서 목록을 고쳐 저장하는 순간 확장으로 옮겨 가는
 * 일이 실제로 있다.
 *
 * `\b` 가 `<dataValidations>`(복수) 여는 태그를 걸러 준다 — `n` 과 `s` 사이는
 * 낱말 경계가 아니다.
 */
function parseDataValidations(sheetXml: string): DataValidation[] {
  const found: DataValidation[] = [];

  const pattern = /<(?:[A-Za-z0-9]+:)?dataValidation\b([^>]*)>([\s\S]*?)<\/(?:[A-Za-z0-9]+:)?dataValidation>/g;
  for (const match of sheetXml.matchAll(pattern)) {
    const attributes = match[1];
    const body = match[2];

    // 보통은 속성, 확장(x14)은 `<xm:sqref>` 자식 요소다.
    const sqref =
      /\ssqref="([^"]*)"/.exec(attributes)?.[1] ??
      /<(?:[A-Za-z0-9]+:)?sqref>([\s\S]*?)<\/(?:[A-Za-z0-9]+:)?sqref>/.exec(body)?.[1];
    if (sqref === undefined) continue;

    const formulaBlock = /<(?:[A-Za-z0-9]+:)?formula1>([\s\S]*?)<\/(?:[A-Za-z0-9]+:)?formula1>/.exec(body)?.[1];
    if (formulaBlock === undefined) continue;
    // 확장 쪽은 수식이 `<xm:f>` 로 한 겹 더 싸여 있다.
    const formula1 = /<(?:[A-Za-z0-9]+:)?f>([\s\S]*?)<\/(?:[A-Za-z0-9]+:)?f>/.exec(formulaBlock)?.[1] ?? formulaBlock;

    found.push({ sqref: unescapeXml(sqref), formula1: unescapeXml(formula1).trim() });
  }

  return found;
}

function readChoiceList(
  archive: ZipArchive,
  sheetXml: string,
  sharedStringsXml: string | null,
  validations: readonly DataValidation[],
  cell: string,
  label: string
): readonly string[] {
  const validation = validations.find((candidate) => sqrefContains(candidate.sqref, cell));
  if (!validation) {
    throw new Error(
      `양식의 ${label} 칸(${cell})에 드롭다운 목록이 걸려 있지 않습니다. 양식이 바뀐 것 같습니다.`
    );
  }

  const values = readFormulaValues(archive, sheetXml, sharedStringsXml, validation.formula1, label);
  // 빈 칸은 목록이 아니다 — 양식의 범위가 실제 항목보다 넉넉하게 잡혀 있다.
  const choices = values.filter((value) => value.trim() !== "");

  if (choices.length === 0) {
    throw new Error(`양식의 ${label} 드롭다운 목록이 비어 있습니다. 양식이 바뀐 것 같습니다.`);
  }
  return choices;
}

/** `formula1` 이 가리키는 값들. 셀 범위이거나, 드물게 따옴표로 적은 목록이다. */
function readFormulaValues(
  archive: ZipArchive,
  sheetXml: string,
  sharedStringsXml: string | null,
  formula1: string,
  label: string
): string[] {
  /**
   * Excel 은 목록을 셀 범위 대신 `"가,나,다"` 로 곧장 적는 것도 허용한다.
   * 이 양식은 범위를 쓰지만, 사람이 Excel 에서 짧은 목록을 손으로 적어 넣는 날
   * 알아들을 수 없는 오류로 멈추는 대신 그대로 읽는다.
   */
  if (formula1.startsWith('"') && formula1.endsWith('"') && formula1.length >= 2) {
    return formula1.slice(1, -1).split(",");
  }

  const range = parseFormulaRange(formula1);
  if (!range) {
    throw new Error(
      `양식의 ${label} 드롭다운이 가리키는 목록 범위를 읽을 수 없습니다: "${formula1}"`
    );
  }

  // 다른 시트를 가리킬 수 있다. 이름이 붙어 있으면 그 시트를 읽는다.
  let targetXml = sheetXml;
  if (range.sheetName !== null && range.sheetName !== SERVICE_REPORT_SHEET_NAME) {
    targetXml = archive.readText(resolveSheetPart(archive, range.sheetName));
  }

  const cellCount = (range.lastRow - range.firstRow + 1) * (range.lastColumn - range.firstColumn + 1);
  if (cellCount > MAX_CHOICE_CELLS) {
    throw new Error(
      `양식의 ${label} 드롭다운 목록 범위가 ${cellCount}칸입니다. ${MAX_CHOICE_CELLS}칸까지만 읽습니다.`
    );
  }

  const read = createCellTextReader(targetXml, sharedStringsXml);
  const values: string[] = [];
  for (let row = range.firstRow; row <= range.lastRow; row += 1) {
    for (let column = range.firstColumn; column <= range.lastColumn; column += 1) {
      const text = read(`${numberToColumn(column)}${row}`);
      if (text !== null) values.push(text);
    }
  }
  return values;
}

// ── 주소 셈 ──────────────────────────────────────────────────────────────

type CellAddress = { column: number; row: number };

type FormulaRange = {
  sheetName: string | null;
  firstColumn: number;
  lastColumn: number;
  firstRow: number;
  lastRow: number;
};

/** `$BS$21` · `H19` 둘 다 받는다. 절대참조 표시는 자리와 상관이 없다. */
function parseCellAddress(value: string): CellAddress | null {
  const match = /^\$?([A-Za-z]+)\$?(\d+)$/.exec(value.trim());
  if (!match) return null;
  return { column: columnToNumber(match[1]), row: Number(match[2]) };
}

/**
 * `sqref` 가 그 칸을 품는가.
 *
 * 🔴 `sqref` 는 `"P29:Q30 AF29:AG30 X27:Y30"` 처럼 **여럿이 공백으로 붙거나**
 * `"H19:P19"` 처럼 범위다. 글자로 견주면(`sqref === "H19"`) 이 양식의 두 목록이
 * 둘 다 안 잡힌다 — 실제로 `H21` 은 `H21:AE22`, `H19` 는 `H19:P19` 안에 있다.
 */
function sqrefContains(sqref: string, ref: string): boolean {
  const target = parseCellAddress(ref);
  if (!target) return false;

  for (const token of sqref.trim().split(/\s+/)) {
    if (token === "") continue;
    const [rawStart, rawEnd] = token.split(":");
    const start = parseCellAddress(rawStart);
    const end = parseCellAddress(rawEnd ?? rawStart);
    if (!start || !end) continue;

    const withinColumn =
      target.column >= Math.min(start.column, end.column) &&
      target.column <= Math.max(start.column, end.column);
    const withinRow =
      target.row >= Math.min(start.row, end.row) && target.row <= Math.max(start.row, end.row);
    if (withinColumn && withinRow) return true;
  }
  return false;
}

/**
 * `'Repair_Report (한글)'!$BS$21:$BS$24` · `$DD$14:$DD$25` · `Sheet1!$A$1` 을 푼다.
 *
 * 시트 이름은 **마지막 `!` 앞**이다 — 범위 쪽에는 `!` 가 들어갈 수 없고, 시트
 * 이름 쪽에는 (따옴표로 싸인 채) 들어갈 수 있다. 따옴표 안의 `''` 는 작은따옴표
 * 하나다(Excel 의 규칙).
 */
function parseFormulaRange(formula1: string): FormulaRange | null {
  let sheetName: string | null = null;
  let rangeText = formula1;

  const bang = formula1.lastIndexOf("!");
  if (bang >= 0) {
    let name = formula1.slice(0, bang).trim();
    rangeText = formula1.slice(bang + 1);
    if (name.startsWith("'") && name.endsWith("'") && name.length >= 2) {
      name = name.slice(1, -1).replace(/''/g, "'");
    }
    if (name === "") return null;
    sheetName = name;
  }

  const [rawStart, rawEnd] = rangeText.split(":");
  const start = parseCellAddress(rawStart);
  const end = parseCellAddress(rawEnd ?? rawStart);
  if (!start || !end) return null;

  return {
    sheetName,
    firstColumn: Math.min(start.column, end.column),
    lastColumn: Math.max(start.column, end.column),
    firstRow: Math.min(start.row, end.row),
    lastRow: Math.max(start.row, end.row),
  };
}

/** `A`=1 … `Z`=26, `AA`=27. 26진수인데 0이 없다. */
function columnToNumber(letters: string): number {
  let value = 0;
  for (const letter of letters.toUpperCase()) {
    value = value * 26 + (letter.charCodeAt(0) - 64);
  }
  return value;
}

function numberToColumn(value: number): string {
  let remaining = value;
  let letters = "";
  while (remaining > 0) {
    const digit = (remaining - 1) % 26;
    letters = String.fromCharCode(65 + digit) + letters;
    remaining = Math.floor((remaining - 1) / 26);
  }
  return letters;
}

// ── 공유문자열 손질 ──────────────────────────────────────────────────────

/**
 * 후리가나(`<rPh>`)를 걷어 낸 공유문자열.
 *
 * 원본을 고치는 것이 아니라 **읽으려고 만든 사본**이다 — 이 함수의 결과는
 * `createCellTextReader` 에만 들어가고 파일로 다시 나가지 않는다.
 */
function stripPhoneticRuns(sharedStringsXml: string | null): string | null {
  if (sharedStringsXml === null) return null;
  return sharedStringsXml
    .replace(/<rPh\b[^>]*\/>/g, "")
    .replace(/<rPh\b[^>]*>[\s\S]*?<\/rPh>/g, "");
}

function unescapeXml(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    // & 는 마지막이다 — 먼저 풀면 `&amp;lt;` 가 `<` 로 잘못 풀린다.
    .replace(/&amp;/g, "&");
}
