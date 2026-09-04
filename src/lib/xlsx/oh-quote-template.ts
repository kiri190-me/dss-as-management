import { ZipArchive } from "./zip-reader";
import { writeZip, type ZipEntryInput } from "./zip-writer";
import { readCellInner, setDate, setFormula, setInlineString, setNumber } from "./sheet-patch";
import { createCellTextReader } from "./sheet-text";
import { parseSheetRows, resizeRowBlock, syncDimension, writeSheetRows } from "./sheet-rows";
import {
  assertAscending,
  clearCellIfPresent,
  dropExcludedWorkScopeLines,
  EMPTY_WORK_SCOPE_LINES,
  fillWorkScopeRows,
  findItemBlock,
  findLabelRow,
  findSpacedLabelRow,
  findWorkScopeBlocks,
  dropErrorValueCaches,
  LAYOUT_COLUMNS as COLUMNS,
  NO_WORK_SCOPE_EXCLUSIONS,
  renumberPaperworkBlock,
  resizeWorkScopeBlocks,
  workScopeRowCount,
  type WorkScopeExclusions,
  type WorkScopeLabels,
} from "./quote-sheet-layout";
import {
  CALC_CHAIN_PART,
  CONTENT_TYPES_PART,
  enableFullCalcOnLoad,
  removeCalcChainOverride,
  removeCalcChainRelationship,
  resolveSheetPart,
  SHARED_STRINGS_PART,
  shiftPrintArea,
  WORKBOOK_PART,
  WORKBOOK_RELS_PART,
} from "./workbook-parts";
import { fillPartRows, validateQuoteInput, type GeneratorQuoteInput } from "./quote-template";

/**
 * ============================================================================
 * O/H 견적서 — 내자와 **다른 파일, 다른 자리**
 * ============================================================================
 * 이 양식에만 있는 것이 둘이다: `2) OH 부품 비용` 칸과, 공급가를 **만원 단위로
 * 내리는 계산 사슬**.
 *
 * ── 🔴 행을 코드에 박지 않는다 ──────────────────────────────────────────
 * 예전에는 부품 27~31 · O/H 부품 34~46 · 작업비 H48 · 합계 I70~I72 로 박아
 * 두었다. 2026-08-31 에 들어온 새 양식은 부품이 8줄, O/H 부품이 12줄, 작업비가
 * 50행, 합계가 72~74행이었다. 그대로 썼다면 **「2) OH 부품 비용」 이라는 머리글
 * 자체가 부품 이름으로 덮어써진** 문서가 고객사로 나갔을 것이다.
 *
 * 이제 D열 머리글로 자리를 찾고 담을 만큼 줄을 늘리고 줄인다. O/H 부품 13줄
 * 상한도 함께 없앴다.
 *
 * ── 🔴 절사 줄을 합계 범위에 넣으면 순환 참조가 된다 ────────────────────
 * 이 양식의 사슬은 이렇게 돈다:
 *
 *     G{셈}   = SUM(I{부품머리글}:I{통전 마지막})   ← 날 합계
 *     H{셈}   = G{셈}/10000
 *     H{내림} = ROUNDDOWN(H{셈},0)*10000            ← 만원 단위로 내림
 *     I{내림} = H{내림} - G{셈}                      ← 내린 만큼(음수)
 *     I{절사} = I{내림}                              ← 문서에 보이는 절사 줄
 *     I{공급가} = H{내림}
 *
 * 절사 줄은 공급가 **바로 위**에 있어서, 합계 범위를 '공급가 바로 윗줄까지'로
 * 잡으면 자기 자신을 더하게 된다. 그래서 범위의 끝은 **통전검사 묶음의 마지막
 * 항목**이다 — 양식이 원래 그렇게 잡아 두었고, 그것이 옳다.
 *
 * ⚠️ 그 자리는 **통전검사 줄 수가 바뀌면 따라 움직인다.** 빈 목록을 받아 양식
 * 그대로 두었을 때는 양식의 줄 수를 써야 한다(`workScopeRowCount`).
 *
 * ── 작업 내역 세 묶음을 채운다 ──────────────────────────────────────────
 * 「① 인수 조사 · ② OH 및 수리 작업 · ③ 통전검사」. ② 는 양식에 줄이 0개라
 * ① 의 줄을 본으로 복제한다. **빈 묶음은 양식 그대로 둔다.**
 *
 * 내림 규칙 자체는 손대지 않는다. 우리가 셈해 적어 넣으면 Excel 이 다시 계산한
 * 값과 어긋날 수 있고, 어긋난 쪽이 화면에 먼저 보인다.
 *
 * ── 외부 통합문서 링크 ──────────────────────────────────────────────────
 * 예전 양식은 22개 칸이 `[1]내자견적서!D10` 꼴로 **다른 파일**을 참조했다. 그대로
 * 내보내면 받아 본 쪽에서 "다른 데이터 원본 링크가 있습니다" 경고가 뜬다. 그래서
 * 남은 참조를 값으로 굳히고 링크 파트를 들어낸다.
 *
 * 새 양식에는 링크 파트가 없고 그 자리가 `#REF!` 로 죽어 있는데, 우리가 줄을
 * 실제 개수에 맞추면서 그 칸들을 전부 덮거나 지우므로 문서에는 남지 않는다.
 * ============================================================================
 */

export const OH_QUOTE_SHEET_NAME = "OH견적서";

export const OH_QUOTE_CELLS = {
  quoteDate: "D10",
  quoteNumber: "D11",
  customerName: "D12",
  subject: "D13",
  /** 표 위의 요약 금액. 양식이 공급가를 받아 쓴다. */
  amount: "D14",
  validity: "D15",
  delivery: "D16",
  payment: "D17",
  productInfo: "D24",
} as const;

/** D열에서 찾는 머리글. `작업비 (조사,수리,…)` 는 길어서 앞부분만 본다. */
const BLOCK_LABELS = {
  parts: "부품 비용",
  overhaulParts: "OH 부품 비용",
  labor: "작업비",
  /**
   * 작업 내역 세 묶음. **② 가 내자와 다르다** — 이 양식은 `OH 및 수리 작업` 이다.
   * ③ 은 양식에 `통전검사[출하검사]` 로 적혀 있어 앞부분만 보고, **합계 범위의
   * 끝을 정하는 자리**이기도 하다(아래 순환 참조 머리말).
   */
  workScope: {
    INVESTIGATION: { label: "인수 조사", match: "exact" },
    REPAIR: { label: "OH 및 수리 작업", match: "exact" },
    POWER_TEST: { label: "통전검사", match: "prefix" },
  } satisfies WorkScopeLabels,
} as const;

/**
 * 🔴 **제너레이터 O/H 양식의 작업 내역 머리글은 여기 한 곳에만 적는다.**
 * 화면이 쓸 기본 목록을 읽는 쪽(`storage/quote-template.ts`)이 가져다 쓴다 —
 * 두 곳에 따로 적으면 화면과 파일이 다른 말을 하는 날이 온다.
 */
export const OH_QUOTE_WORK_SCOPE_LABELS: WorkScopeLabels = BLOCK_LABELS.workScope;

const TOTAL_LABELS = { supply: "공급가", vat: "부가세", total: "합계" } as const;

/** 만원 단위 내림 사슬이 시작하는 자리를 가리키는 G열의 글자. */
const CALC_LABEL = "계산";

const EXTERNAL_LINK_PREFIX = "xl/externalLinks/";

/**
 * 내자 입력에 O/H 부품 칸만 더한 것. `workScope` 와 `powerTestExcluded` 는
 * `GeneratorQuoteInput` 에서 그대로 물려받는다 — 두 양식이 같은 뜻으로 받아야 할
 * 신호라 한 곳에만 적는다(quote-template.ts).
 */
export type OhQuoteInput = GeneratorQuoteInput & {
  /**
   * `2) OH 부품 비용` 칸에 들어갈 부품들. 재고 관리의 O/H 템플릿에서 담아 온
   * 것이고, 비어 있어도 된다(부품 없이 작업비만 받는 O/H 견적이 있다).
   */
  overhaulParts: readonly { name: string; quantity: number; unitPrice: number }[];
};

export function fillOhQuoteWorkbook(templateXlsx: Buffer, input: OhQuoteInput): Buffer {
  validateQuoteInput(input);

  const archive = ZipArchive.fromBuffer(templateXlsx);
  const sheetPart = resolveSheetPart(archive, OH_QUOTE_SHEET_NAME);
  const hasCalcChain = archive.has(CALC_CHAIN_PART);

  const filled = fillSheet(
    archive.readText(sheetPart),
    archive.readTextOrNull(SHARED_STRINGS_PART),
    input
  );

  const entries: ZipEntryInput[] = [];
  for (const name of archive.list()) {
    // 링크 파트와 계산 캐시는 들어낸다(파일 머리말).
    if (name.startsWith(EXTERNAL_LINK_PREFIX)) continue;
    if (name === CALC_CHAIN_PART) continue;

    const bytes = archive.readEntry(name);
    if (!bytes) throw new Error(`양식에서 파트를 읽지 못했습니다: "${name}"`);

    if (name === sheetPart) {
      entries.push({ name, data: toUtf8(filled.xml) });
    } else if (name === WORKBOOK_PART) {
      const workbook = shiftPrintArea(
        cleanWorkbook(bytes.toString("utf8")),
        OH_QUOTE_SHEET_NAME,
        filled.rowShift
      );
      entries.push({ name, data: toUtf8(workbook) });
    } else if (name === CONTENT_TYPES_PART) {
      entries.push({ name, data: toUtf8(cleanContentTypes(bytes.toString("utf8"), hasCalcChain)) });
    } else if (name === WORKBOOK_RELS_PART) {
      entries.push({ name, data: toUtf8(cleanWorkbookRels(bytes.toString("utf8"), hasCalcChain)) });
    } else {
      entries.push({ name, data: bytes });
    }
  }

  return writeZip(entries);
}

function toUtf8(value: string): Buffer {
  return Buffer.from(value, "utf8");
}

function fillSheet(
  sheetXml: string,
  sharedStringsXml: string | null,
  input: OhQuoteInput
): { xml: string; rowShift: number } {
  const read = createCellTextReader(sheetXml, sharedStringsXml);
  const templateRows = parseSheetRows(sheetXml);

  // 없애기로 한 묶음. 지금 켤 수 있는 것은 ③ 뿐이다 — 나머지 둘은 늘 꺼짐이다.
  const excluded: WorkScopeExclusions = {
    ...NO_WORK_SCOPE_EXCLUSIONS,
    POWER_TEST: input.powerTestExcluded === true,
  };
  // 없앤 묶음의 줄은 여기서 비워진다 — 사라진 자리 아래 남의 줄에 적지 않도록.
  const workScope = dropExcludedWorkScopeLines(
    input.workScope ?? EMPTY_WORK_SCOPE_LINES,
    excluded
  );

  // ── 1) 자리를 찾는다 ──────────────────────────────────────────────
  const parts = findItemBlock(templateRows, read, BLOCK_LABELS.parts);
  const overhaul = findItemBlock(templateRows, read, BLOCK_LABELS.overhaulParts);
  const laborRow = findLabelRow(templateRows, read, COLUMNS.name, BLOCK_LABELS.labor, "prefix");
  const scope = findWorkScopeBlocks(templateRows, read, BLOCK_LABELS.workScope);
  const supplyRow = findSpacedLabelRow(templateRows, read, COLUMNS.unitPrice, TOTAL_LABELS.supply);
  const vatRow = findSpacedLabelRow(templateRows, read, COLUMNS.unitPrice, TOTAL_LABELS.vat);
  const totalRow = findSpacedLabelRow(templateRows, read, COLUMNS.unitPrice, TOTAL_LABELS.total);
  const calcRow = findLabelRow(templateRows, read, COLUMNS.quantity, CALC_LABEL);

  assertAscending([
    [BLOCK_LABELS.parts, parts.headerRow],
    [BLOCK_LABELS.overhaulParts, overhaul.headerRow],
    [BLOCK_LABELS.labor, laborRow],
    [BLOCK_LABELS.workScope.INVESTIGATION.label, scope.INVESTIGATION.headerRow],
    [BLOCK_LABELS.workScope.REPAIR.label, scope.REPAIR.headerRow],
    [BLOCK_LABELS.workScope.POWER_TEST.label, scope.POWER_TEST.headerRow],
    [TOTAL_LABELS.supply, supplyRow],
    [TOTAL_LABELS.vat, vatRow],
    [TOTAL_LABELS.total, totalRow],
    [CALC_LABEL, calcRow],
  ]);

  // 절사 줄은 통전검사 마지막 항목과 공급가 사이에 있는, 금액 칸에 수식이 든
  // 유일한 줄이다. 자리를 박지 않고 **수식이 있는 줄을 찾아** 정한다.
  // (양식의 원본 자리에서 찾는다 — 줄을 밀기 전이라 아래 rowShift 로 옮긴다.)
  const writeOffRow = findWriteOffRow(
    sheetXml,
    scope.POWER_TEST.firstRow + scope.POWER_TEST.count,
    supplyRow
  );

  // ── 2) 줄 수를 맞춘다 — 아래에서부터 ─────────────────────────────
  // 작업 내역 셋(③→②→①) → O/H 부품 → 부품. 위를 먼저 고치면 아래 묶음의
  // 시작 행이 이미 밀려 있어 엉뚱한 줄을 잡는다.
  const resizedScope = resizeWorkScopeBlocks(templateRows, scope, workScope, excluded);
  const resizedOverhaul = resizeRowBlock(resizedScope.rows, {
    firstRow: overhaul.firstRow,
    currentCount: overhaul.count,
    targetCount: input.overhaulParts.length,
  });
  const resizedParts = resizeRowBlock(resizedOverhaul.rows, {
    firstRow: parts.firstRow,
    currentCount: parts.count,
    targetCount: input.parts.length,
  });
  const rows = resizedParts.rows;

  const afterParts = resizedParts.delta;
  const afterOverhaul = afterParts + resizedOverhaul.delta;
  const afterInvestigation = afterOverhaul + resizedScope.deltas.INVESTIGATION;
  const afterRepair = afterInvestigation + resizedScope.deltas.REPAIR;
  const rowShift = afterRepair + resizedScope.deltas.POWER_TEST;

  /**
   * 통전검사 묶음이 갖게 될 줄 수. **빈 목록이면 양식의 줄 수 그대로**이고,
   * **없앴으면 0** 이다 — 합계 범위의 끝이 이 값으로 정해지므로 여기서 틀리면
   * 순환 참조가 된다.
   */
  const powerTestCount = workScopeRowCount(
    scope.POWER_TEST,
    workScope.POWER_TEST,
    excluded.POWER_TEST
  );

  /**
   * 합계 범위의 끝 — 작업 내역의 마지막 줄.
   *
   * 🔴 통전검사를 없앴으면 **머리글까지 사라졌으므로 그 윗줄**(② 의 마지막 줄)이
   * 끝이다. 한 줄이라도 더 내려 잡으면 그 자리로 절사 줄이 올라와 있어 합계가
   * 자기 자신을 삼킨다 — 이 파일 머리말의 순환 참조가 바로 그것이다.
   */
  const powerTestLastRow = excluded.POWER_TEST
    ? scope.POWER_TEST.headerRow - 1
    : scope.POWER_TEST.firstRow + powerTestCount - 1;

  const at = {
    partsFirst: parts.firstRow,
    overhaulFirst: overhaul.firstRow + afterParts,
    labor: laborRow + afterOverhaul,
    investigationFirst: scope.INVESTIGATION.firstRow + afterOverhaul,
    repairFirst: scope.REPAIR.firstRow + afterInvestigation,
    powerTestFirst: scope.POWER_TEST.firstRow + afterRepair,
    powerTestLast: powerTestLastRow + afterRepair,
    writeOff: writeOffRow === null ? null : writeOffRow + rowShift,
    supply: supplyRow + rowShift,
    vat: vatRow + rowShift,
    total: totalRow + rowShift,
    /** 사슬은 `계산` 아래 두 줄에 걸쳐 있다: 날 합계 한 줄, 내림 한 줄. */
    raw: calcRow + 1 + rowShift,
    rounded: calcRow + 2 + rowShift,
  };

  let xml = syncDimension(writeSheetRows(sheetXml, rows), rows);

  // ── 3) 값을 채운다 ────────────────────────────────────────────────
  xml = setDate(xml, OH_QUOTE_CELLS.quoteDate, input.quoteDate);
  xml = setInlineString(xml, OH_QUOTE_CELLS.quoteNumber, input.quoteNumber.trim());
  xml = setInlineString(xml, OH_QUOTE_CELLS.customerName, input.customerName.trim());
  xml = setInlineString(xml, OH_QUOTE_CELLS.subject, input.subject.trim());
  xml = setInlineString(xml, OH_QUOTE_CELLS.productInfo, buildProductInfo(input));

  for (const [value, cell] of [
    [input.validity, OH_QUOTE_CELLS.validity],
    [input.delivery, OH_QUOTE_CELLS.delivery],
    [input.payment, OH_QUOTE_CELLS.payment],
  ] as const) {
    if (value !== undefined) xml = setInlineString(xml, cell, value.trim());
  }

  xml = fillPartRows(xml, at.partsFirst, input.parts);
  xml = fillPartRows(xml, at.overhaulFirst, input.overhaulParts);

  xml = setNumber(xml, `${COLUMNS.quantity}${at.labor}`, 1);
  xml = setNumber(xml, `${COLUMNS.unitPrice}${at.labor}`, input.workCost);
  xml = setFormula(
    xml,
    `${COLUMNS.amount}${at.labor}`,
    `${COLUMNS.unitPrice}${at.labor}*${COLUMNS.quantity}${at.labor}`
  );

  // 작업 내역 세 묶음. 빈 묶음은 아무것도 하지 않는다 — 양식의 기본 목록이
  // 그대로 나간다(quote-sheet-layout.ts 의 '빈 묶음은 양식 그대로 둔다').
  // 없앤 묶음도 목록이 비어 있어 아무 일도 일어나지 않는다 — 자리가 사라졌으므로
  // 적을 것도 없다(dropExcludedWorkScopeLines).
  xml = fillWorkScopeRows(xml, at.investigationFirst, workScope.INVESTIGATION);
  xml = fillWorkScopeRows(xml, at.repairFirst, workScope.REPAIR);
  xml = fillWorkScopeRows(xml, at.powerTestFirst, workScope.POWER_TEST);

  // ③ 을 지웠으면 「④ 서류작업」이 ③ 이 된다. 없앤 것이 없으면 그 칸은 손도
  // 대지 않는다(quote-sheet-layout.ts 의 '서류작업의 번호를 당긴다').
  xml = renumberPaperworkBlock(xml, templateRows, read, excluded, rowShift);

  // 작업 내역 문구가 적히는 자리에는 금액이 없어야 한다. 합계 범위 안이라 치운다.
  // (작업 내역 줄은 C·D 열만 쓰므로 방금 적은 값이 지워지지 않는다.)
  for (let row = at.labor + 1; row <= at.powerTestLast; row += 1) {
    xml = clearCellIfPresent(xml, `${COLUMNS.amount}${row}`);
  }

  // ── 4) 옮겨진 자리로 사슬을 다시 쓴다 ────────────────────────────
  const amount = COLUMNS.amount;
  const raw = `${COLUMNS.quantity}${at.raw}`;
  const rounded = `${COLUMNS.unitPrice}${at.rounded}`;

  xml = setFormula(xml, raw, `SUM(${amount}${parts.headerRow}:${amount}${at.powerTestLast})`);
  xml = setFormula(xml, `${COLUMNS.unitPrice}${at.raw}`, `${raw}/10000`);
  xml = setFormula(xml, rounded, `ROUNDDOWN(${COLUMNS.unitPrice}${at.raw},0)*10000`);
  xml = setFormula(xml, `${amount}${at.rounded}`, `${rounded}-${raw}`);

  if (at.writeOff !== null) {
    xml = setFormula(xml, `${amount}${at.writeOff}`, `${amount}${at.rounded}`);
  }

  xml = setFormula(xml, `${amount}${at.supply}`, rounded);
  xml = setFormula(xml, `${amount}${at.vat}`, `${amount}${at.supply}*0.1`);
  xml = setFormula(xml, `${amount}${at.total}`, `${amount}${at.supply}+${amount}${at.vat}`);
  xml = setFormula(xml, OH_QUOTE_CELLS.amount, `${amount}${at.supply}`);

  // 마지막으로 **남은 외부 참조를 전부 굳힌다**(아래 함수 주석).
  return { xml: dropErrorValueCaches(freezeExternalReferences(xml)), rowShift };
}

/**
 * 통전검사 마지막 항목과 공급가 사이에서, 금액 칸에 수식이 든 줄. 없으면 `null`.
 *
 * 그 자리가 절사 줄이다. `공급가 - 1` 로 박아 두면 양식이 한 줄만 바뀌어도 엉뚱한
 * 줄에 수식을 쓰게 되고, 그 줄은 서류작업 문구가 적히는 자리일 수도 있다.
 */
function findWriteOffRow(sheetXml: string, from: number, until: number): number | null {
  for (let row = from; row < until; row += 1) {
    let inner: string;
    try {
      inner = readCellInner(sheetXml, `${COLUMNS.amount}${row}`);
    } catch {
      continue; // 그 칸이 없다.
    }
    if (inner.includes("<f")) return row;
  }
  return null;
}

function buildProductInfo(input: {
  modelName?: string;
  serialNumber?: string;
  lotNumber?: string;
}): string {
  const pieces: string[] = [];
  if (input.modelName?.trim()) pieces.push(`MODEL: ${input.modelName.trim()}`);
  if (input.serialNumber?.trim()) pieces.push(`S/N:${input.serialNumber.trim()}`);
  if (input.lotNumber?.trim()) pieces.push(`L/N:${input.lotNumber.trim()}`);
  return pieces.join(", ");
}

/**
 * 아직 남아 있는 `[1]다른통합문서!…` 수식을 **그 자리의 캐시값으로** 바꾼다.
 *
 * 값을 주지 않은 칸은 일부러 건드리지 않는다 — 그것이 "양식의 기본 문구를 그대로
 * 쓴다"는 뜻이다. 그런데 이 양식에서는 그런 칸(예: 납기)이 **외부 수식**이라,
 * 안 건드리면 깨진 링크가 그대로 나간다.
 *
 * 그래서 칸을 하나씩 지정하는 대신 **훑어서 굳힌다.** 앞으로 양식에 외부 참조가
 * 하나 더 생겨도 자동으로 잡힌다 — 목록을 손으로 관리하면 그 하나를 빠뜨리는
 * 날이 오고, 그때 증상은 "받아 본 쪽에서만 보이는 경고"라 우리가 알아채지 못한다.
 */
function freezeExternalReferences(sheetXml: string): string {
  let xml = sheetXml;
  // 셀 하나를 바꿀 때마다 길이가 달라지므로 매번 처음부터 다시 찾는다.
  for (let guard = 0; guard < 200; guard += 1) {
    const found = /<c\s[^>]*>\s*<f>[^<]*\[\d+\][^<]*<\/f>\s*(<v>([^<]*)<\/v>)?\s*<\/c>/.exec(xml);
    if (!found) return xml;
    const cached = found[2];
    const openTag = /^<c\s[^>]*>/.exec(found[0])?.[0] ?? "<c>";
    const replacement =
      cached === undefined ? openTag.replace(/>$/, "/>") : `${openTag}<v>${cached}</v></c>`;
    xml = xml.slice(0, found.index) + replacement + xml.slice(found.index + found[0].length);
  }
  throw new Error("외부 참조가 너무 많아 굳히지 못했습니다. 양식을 확인해 주세요.");
}

/** 외부 링크 선언과 계산 캐시 설정을 뺀다. 다시 계산하게 하는 것은 함께 켠다. */
function cleanWorkbook(workbookXml: string): string {
  return enableFullCalcOnLoad(
    workbookXml.replace(/<externalReferences>[\s\S]*?<\/externalReferences>/, "")
  );
}

function cleanContentTypes(contentTypesXml: string, hasCalcChain: boolean): string {
  const withoutLinks = contentTypesXml.replace(
    /<Override[^>]*PartName="\/xl\/externalLinks\/[^"]*"[^>]*\/>/g,
    ""
  );
  return hasCalcChain ? removeCalcChainOverride(withoutLinks) : withoutLinks;
}

function cleanWorkbookRels(relsXml: string, hasCalcChain: boolean): string {
  const withoutLinks = relsXml.replace(
    /<Relationship[^>]*Target="externalLinks\/[^"]*"[^>]*\/>/g,
    ""
  );
  return hasCalcChain ? removeCalcChainRelationship(withoutLinks) : withoutLinks;
}
