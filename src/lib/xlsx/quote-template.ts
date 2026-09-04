import { ZipArchive } from "./zip-reader";
import { writeZip, type ZipEntryInput } from "./zip-writer";
import { setDate, setFormula, setInlineString, setNumber } from "./sheet-patch";
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
  ITEM_MARKER,
  LAYOUT_COLUMNS as COLUMNS,
  NO_WORK_SCOPE_EXCLUSIONS,
  renumberPaperworkBlock,
  resizeWorkScopeBlocks,
  type WorkScopeExclusions,
  type WorkScopeLabels,
  type WorkScopeLines,
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

/**
 * ============================================================================
 * 내자견적서 — 원본 양식을 채운다
 * ============================================================================
 * 원본을 읽어 값이 들어간 새 버퍼를 돌려준다. 원본 파일은 절대 쓰지 않는다.
 * 로고·직인 이미지, styles.xml, 인쇄설정, 회사 정보는 **손대지 않는다.**
 *
 * 「④ 서류작업」 구역도 문구는 그대로 두지만, **③ 통전검사를 없앤 문서에서는
 * 번호만 ③ 으로 당긴다** — 안 그러면 `① ② ④` 로 번호가 건너뛴다
 * (quote-sheet-layout.ts 의 `renumberPaperworkBlock`).
 *
 * ── 작업 내역 세 묶음은 채운다 ──────────────────────────────────────────
 * 「① 인수 조사 · ② 수리 작업 · ③ 통전검사」 는 화면에서 정한 값으로 적는다.
 * 예전에는 이 구역을 통째로 안 건드려서, 화면에는 편집 가능한 세 칸이 떠 있는데
 * **파일에는 무슨 수리를 했는지가 한 줄도 안 나갔다.**
 *
 * 🔴 **빈 묶음은 양식 그대로 둔다.** ② 는 양식에 줄이 0개라 ① 의 줄을 본으로
 * 삼아 복제한다(quote-sheet-layout.ts · sheet-rows.ts 의 `modelRow`).
 *
 * ── 🔴 행을 코드에 박지 않는다 ──────────────────────────────────────────
 * 예전에는 부품 칸을 27~31행으로 박아 두었다. 그런데 이 양식들은 사람이 건마다
 * 줄을 넣어 저장하는 문서다 — 실제로 하루 사이에 제너레이터 O/H 의 부품 칸이
 * 5줄에서 8줄로 바뀐 판이 들어왔다. 박아 두면 그때마다 조용히 엉뚱한 칸에 값이
 * 앉는다(quote-sheet-layout.ts 의 머리말).
 *
 * 이제 D열 머리글로 자리를 찾고, **담을 만큼 줄을 늘리고 줄인다.**
 *
 * ── 부품을 한 줄로 합치던 규칙을 없앴다 ────────────────────────────────
 * 예전에는 부품이 다섯을 넘으면 「부품 비용 일괄」 한 줄로 합쳐 적었다. 양식이
 * 1페이지에 맞춰져 있고 행을 늘릴 수 없어서였다. 이제 늘릴 수 있으므로
 * **부품을 있는 그대로 적는다**(2026-08-31 사용자 승인). 부품이 많으면 문서가
 * 2페이지가 된다 — 청구 내역을 뭉뚱그리는 것보다 낫다.
 *
 * 화면 미리보기(components/quotes/QuotePrintView.tsx)도 같이 바뀌었다. 둘이
 * 다르면 받아 본 쪽이 다른 문서라고 여긴다.
 *
 * ── 양식의 공급가 수식은 고장나 있었다 ──────────────────────────────────
 * 원본의 공급가 칸이 `=M45` 인데 `M45` 는 빈 칸이다. 부가세와 합계가 전부 이
 * 칸을 물고 있어서, 부품 단가를 채워도 **아래 합계 세 칸은 늘 0** 이었다. 손으로
 * 쓸 때는 합계를 직접 타이핑해 덮었을 것이다. 자동으로 만드는 문서에는 그럴
 * 사람이 없으므로 실제 합계로 바꾼다.
 *
 * ── 재계산을 Excel 에 맡긴다 ────────────────────────────────────────────
 * 발행일자의 `TODAY()` 를 없애고 줄까지 밀리므로 `calcChain.xml` 이 시트와
 * 어긋난다. 파트째 들어내고 `fullCalcOnLoad` 를 켠다(workbook-parts.ts).
 *
 * `TODAY()` 를 남기지 않는 이유: 그것은 '오늘'이지 '발행일자'가 아니다. 남겨
 * 두면 3개월 뒤에 그 파일을 여는 사람에게 3개월 뒤 날짜가 찍힌 견적서가 보인다.
 * ============================================================================
 */

/** 값을 채우는 시트. 이 통합문서에는 `OH견적서`·`Sheet1` 도 들어 있다. */
export const QUOTE_SHEET_NAME = "내자견적서";

export const QUOTE_CELLS = {
  quoteDate: "D10",
  quoteNumber: "D11",
  /** D12:E12 병합. M12:M18 을 목록으로 쓰는 드롭다운이 걸려 있지만, 목록 밖 값도 그대로 들어간다. */
  customerName: "D12",
  /** D23 이 `=D13` 으로 따라오므로 여기만 채우면 본문 제목도 함께 바뀐다. */
  subject: "D13",
  /** 표 위의 요약 금액. 양식이 공급가를 받아 쓴다. */
  amount: "D14",
  validity: "D15",
  delivery: "D16",
  payment: "D17",
  /** `MODEL: …, S/N:…, L/N:…` 한 줄. 원본에 예시가 박혀 있다. */
  productInfo: "D24",
} as const;

/** D열에서 찾는 머리글. 양식의 글자 그대로다. */
const BLOCK_LABELS = {
  parts: "부품 비용",
  /**
   * 양식에는 `작업비 (조사,수리,개조,통전,출하검사)` 라고 길게 적혀 있다. 괄호
   * 안은 언제든 손볼 수 있는 설명이라 **앞부분만** 본다.
   */
  labor: "작업비",
  /** 「② 수리 작업」 아래에 적히는 세 묶음의 머리글. 아래 export 를 볼 것. */
  workScope: {
    INVESTIGATION: { label: "인수 조사", match: "exact" },
    REPAIR: { label: "수리 작업", match: "exact" },
    /** 양식에는 `통전검사[출하검사]` 로 적혀 있다 — 앞부분만 본다. */
    POWER_TEST: { label: "통전검사", match: "prefix" },
  } satisfies WorkScopeLabels,
} as const;

/**
 * 🔴 **제너레이터 내자 양식의 작업 내역 머리글은 여기 한 곳에만 적는다.**
 *
 * 화면이 쓸 기본 목록을 읽는 쪽(`storage/quote-template.ts`)이 이 값을 가져다
 * 쓴다. 두 곳에 따로 적으면 한쪽만 고쳐지는 날이 오고, 그때 증상은 "화면에 뜨는
 * 작업 내역과 파일에 적히는 작업 내역이 다른" 것이다.
 *
 * (storage 층이 xlsx 층을 부르는 것은 이미 하고 있다. 반대 방향은 안 된다 —
 * xlsx 층은 앱 층을 몰라야 이 파일들을 떼어 쓸 수 있다.)
 */
export const QUOTE_WORK_SCOPE_LABELS: WorkScopeLabels = BLOCK_LABELS.workScope;

/** H열에서 찾는 합계 머리글. 양식은 `공 급 가` 처럼 띄워 두었다 — 공백을 지우고 견준다. */
const TOTAL_LABELS = { supply: "공급가", vat: "부가세", total: "합계" } as const;

export type QuotePartInput = {
  name: string;
  quantity: number;
  unitPrice: number;
};

export type QuoteInput = {
  quoteNumber: string;
  quoteDate: Date;
  customerName: string;
  subject: string;
  modelName?: string;
  serialNumber?: string;
  lotNumber?: string;
  /** 비워 두면 양식의 기본 문구를 그대로 쓴다(유효기간·납기·결재조건). */
  validity?: string;
  delivery?: string;
  payment?: string;
  parts: readonly QuotePartInput[];
  workCost: number;
};

/**
 * 제너레이터 양식(내자·O/H)이 받는 입력. 매쳐와 갈리는 것은 **작업 내역이
 * 있어도 되고 없어도 된다**는 점이다.
 *
 * 🔴 **빈 묶음은 양식 그대로 나간다.** 통째로 안 주는 것과 셋 다 빈 배열로 주는
 * 것이 같은 뜻이다 — 지금까지 저장된 제너레이터 견적서는 작업 내역이 전부 비어
 * 있고, 그것들을 다시 내려받았을 때 양식의 표준 문구가 사라지면 안 된다
 * (quote-sheet-layout.ts 의 '빈 묶음은 양식 그대로 둔다').
 */
export type GeneratorQuoteInput = QuoteInput & {
  workScope?: WorkScopeLines;
  /**
   * 켜면 「③ 통전검사」 구역을 **머리글까지 문서에서 지운다.** 통전작업을 하지
   * 않아 작업비에서 그 몫을 뺐는데 문서에는 「절연저항치·내압시험 …」 이 그대로
   * 찍혀 나가면, 하지 않은 시험을 했다고 적어 보내는 셈이다.
   *
   * 🔴 **빈 목록과 정반대의 뜻이다.** 빈 목록은 "양식 그대로 둔다"이고 이것은
   * "없앤다"이다(quote-sheet-layout.ts 의 `WorkScopeExclusions`).
   *
   * 그 아래 「④ 서류작업」의 번호도 함께 ③ 으로 당겨진다 — 지우기만 하고 번호를
   * 두면 고객사가 받는 견적서에 `① ② ④` 로 번호가 건너뛴다.
   *
   * 기본은 꺼짐이고, **주지 않으면 결과가 한 바이트도 달라지지 않는다.**
   */
  powerTestExcluded?: boolean;
};

/**
 * 원본 양식 버퍼 + 입력 → 채워진 xlsx 버퍼.
 *
 * 은행계좌는 인자로 받지 않는다. 계좌번호를 코드나 DB 에 두지 않기 위해서고,
 * 양식에 이미 적혀 있으므로 그대로 나간다.
 */
export function fillQuoteWorkbook(templateXlsx: Buffer, input: GeneratorQuoteInput): Buffer {
  validateQuoteInput(input);

  const archive = ZipArchive.fromBuffer(templateXlsx);
  const sheetPart = resolveSheetPart(archive, QUOTE_SHEET_NAME);
  const hasCalcChain = archive.has(CALC_CHAIN_PART);

  const filled = fillSheet(
    archive.readText(sheetPart),
    archive.readTextOrNull(SHARED_STRINGS_PART),
    input
  );

  const entries: ZipEntryInput[] = [];
  for (const name of archive.list()) {
    if (name === CALC_CHAIN_PART) continue;

    const bytes = archive.readEntry(name);
    if (!bytes) throw new Error(`양식에서 파트를 읽지 못했습니다: "${name}"`);

    if (name === sheetPart) {
      entries.push({ name, data: toUtf8(filled.xml) });
    } else if (name === WORKBOOK_PART) {
      const workbook = shiftPrintArea(
        enableFullCalcOnLoad(bytes.toString("utf8")),
        QUOTE_SHEET_NAME,
        filled.rowShift
      );
      entries.push({ name, data: toUtf8(workbook) });
    } else if (hasCalcChain && name === CONTENT_TYPES_PART) {
      entries.push({ name, data: toUtf8(removeCalcChainOverride(bytes.toString("utf8"))) });
    } else if (hasCalcChain && name === WORKBOOK_RELS_PART) {
      entries.push({ name, data: toUtf8(removeCalcChainRelationship(bytes.toString("utf8"))) });
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
  input: GeneratorQuoteInput
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
  const laborRow = findLabelRow(templateRows, read, COLUMNS.name, BLOCK_LABELS.labor, "prefix");
  const scope = findWorkScopeBlocks(templateRows, read, BLOCK_LABELS.workScope);
  const supplyRow = findSpacedLabelRow(templateRows, read, COLUMNS.unitPrice, TOTAL_LABELS.supply);
  const vatRow = findSpacedLabelRow(templateRows, read, COLUMNS.unitPrice, TOTAL_LABELS.vat);
  const totalRow = findSpacedLabelRow(templateRows, read, COLUMNS.unitPrice, TOTAL_LABELS.total);

  assertAscending([
    [BLOCK_LABELS.parts, parts.headerRow],
    [BLOCK_LABELS.labor, laborRow],
    [BLOCK_LABELS.workScope.INVESTIGATION.label, scope.INVESTIGATION.headerRow],
    [BLOCK_LABELS.workScope.REPAIR.label, scope.REPAIR.headerRow],
    [BLOCK_LABELS.workScope.POWER_TEST.label, scope.POWER_TEST.headerRow],
    [TOTAL_LABELS.supply, supplyRow],
    [TOTAL_LABELS.vat, vatRow],
    [TOTAL_LABELS.total, totalRow],
  ]);

  // ── 2) 줄 수를 맞춘다 — 반드시 아래에서부터 ──────────────────────
  // 작업 내역 셋(③→②→①)을 먼저, 그 위의 부품 칸을 마지막에.
  const resizedScope = resizeWorkScopeBlocks(templateRows, scope, workScope, excluded);
  const resizedParts = resizeRowBlock(resizedScope.rows, {
    firstRow: parts.firstRow,
    currentCount: parts.count,
    targetCount: input.parts.length,
  });
  const rows = resizedParts.rows;

  // ── 3) 옮겨진 자리를 셈한다 ──────────────────────────────────────
  // 부품이 밀면 그 아래 전부가, ① 이 밀면 ② 아래가 밀린다. 다시 훑지 않는다 —
  // 복제된 줄은 아직 `-` 가 비어 있어 머리글 훑기로는 세어지지 않는다.
  const afterParts = resizedParts.delta;
  const afterInvestigation = afterParts + resizedScope.deltas.INVESTIGATION;
  const afterRepair = afterInvestigation + resizedScope.deltas.REPAIR;
  const rowShift = afterRepair + resizedScope.deltas.POWER_TEST;

  const at = {
    partsFirst: parts.firstRow,
    labor: laborRow + afterParts,
    investigationFirst: scope.INVESTIGATION.firstRow + afterParts,
    repairFirst: scope.REPAIR.firstRow + afterInvestigation,
    powerTestFirst: scope.POWER_TEST.firstRow + afterRepair,
    supply: supplyRow + rowShift,
    vat: vatRow + rowShift,
    total: totalRow + rowShift,
  };

  let xml = syncDimension(writeSheetRows(sheetXml, rows), rows);

  // ── 4) 값을 채운다 ────────────────────────────────────────────────
  xml = setDate(xml, QUOTE_CELLS.quoteDate, input.quoteDate);
  xml = setInlineString(xml, QUOTE_CELLS.quoteNumber, input.quoteNumber.trim());
  xml = setInlineString(xml, QUOTE_CELLS.customerName, input.customerName.trim());
  xml = setInlineString(xml, QUOTE_CELLS.subject, input.subject.trim());
  xml = setInlineString(xml, QUOTE_CELLS.productInfo, buildProductInfoLine(input));

  // 값을 준 것만 바꾼다. 안 주면 양식의 기본 문구가 그대로 남는다.
  for (const [value, cell] of [
    [input.validity, QUOTE_CELLS.validity],
    [input.delivery, QUOTE_CELLS.delivery],
    [input.payment, QUOTE_CELLS.payment],
  ] as const) {
    if (value !== undefined) xml = setInlineString(xml, cell, value.trim());
  }

  xml = fillPartRows(xml, at.partsFirst, input.parts);

  xml = setNumber(xml, `${COLUMNS.quantity}${at.labor}`, 1);
  xml = setNumber(xml, `${COLUMNS.unitPrice}${at.labor}`, input.workCost);
  xml = setFormula(
    xml,
    `${COLUMNS.amount}${at.labor}`,
    `${COLUMNS.unitPrice}${at.labor}*${COLUMNS.quantity}${at.labor}`
  );

  // 작업 내역 세 묶음. 빈 묶음은 아무것도 하지 않는다 — 양식의 기본 목록이
  // 그대로 나간다(quote-sheet-layout.ts 의 '빈 묶음은 양식 그대로 둔다').
  // 없앤 묶음도 목록이 비어 있어 여기서 아무 일도 일어나지 않는다 — 자리가
  // 사라졌으므로 적을 것도 없다(dropExcludedWorkScopeLines).
  xml = fillWorkScopeRows(xml, at.investigationFirst, workScope.INVESTIGATION);
  xml = fillWorkScopeRows(xml, at.repairFirst, workScope.REPAIR);
  xml = fillWorkScopeRows(xml, at.powerTestFirst, workScope.POWER_TEST);

  // ③ 을 지웠으면 「④ 서류작업」이 ③ 이 된다. 없앤 것이 없으면 그 칸은 손도
  // 대지 않는다(quote-sheet-layout.ts 의 '서류작업의 번호를 당긴다').
  xml = renumberPaperworkBlock(xml, templateRows, read, excluded, rowShift);

  /**
   * 작업비 아래부터 공급가 바로 위까지의 금액 칸을 비운다. 그 사이는 작업 내역
   * 문구가 적히는 자리라 금액이 없어야 하는데, 양식에는 빈 칸을 가리키는 낡은
   * 수식(`=N45`)이 하나 남아 있다. 합계 범위 안이라 치워 둔다.
   *
   * ⚠️ 작업 내역 줄이 이 사이에서 늘고 준다. 부딪히지 않는 이유는 그 줄들이
   * **금액 칸을 쓰지 않기 때문**이다 — 복제된 줄은 비어 있고(blankRow), 우리도
   * C·D 열만 적는다. 위 fillWorkScopeRows 뒤에 두어도 지울 것이 없다.
   */
  for (let row = at.labor + 1; row < at.supply; row += 1) {
    xml = clearCellIfPresent(xml, `${COLUMNS.amount}${row}`);
  }

  // ── 5) 옮겨진 자리로 수식을 다시 쓴다 ────────────────────────────
  xml = setFormula(xml, QUOTE_CELLS.amount, `${COLUMNS.amount}${at.supply}`);
  xml = setFormula(
    xml,
    `${COLUMNS.amount}${at.supply}`,
    `SUM(${COLUMNS.amount}${parts.headerRow}:${COLUMNS.amount}${at.supply - 1})`
  );
  xml = setFormula(xml, `${COLUMNS.amount}${at.vat}`, `${COLUMNS.amount}${at.supply}*0.1`);
  xml = setFormula(
    xml,
    `${COLUMNS.amount}${at.total}`,
    `${COLUMNS.amount}${at.supply}+${COLUMNS.amount}${at.vat}`
  );

  return { xml: dropErrorValueCaches(xml), rowShift };
}

/**
 * 부품 줄. 복제된 줄은 줄임표(`-`)까지 비워져 있어 줄마다 다시 쓴다.
 *
 * ⚠️ 금액 칸을 **보통 수식으로** 쓴다. 양식은 이 자리를 공유 수식
 * (`<f t="shared" ref="I27:I31">`)으로 두는데, 줄 수가 바뀌면 그 `ref` 가 실제와
 * 어긋나고 어긋난 공유 수식은 Excel 이 파일 열기를 거부하는 사유다.
 */
export function fillPartRows(
  sheetXml: string,
  firstRow: number,
  parts: readonly QuotePartInput[]
): string {
  let xml = sheetXml;
  parts.forEach((part, index) => {
    const row = firstRow + index;
    xml = setInlineString(xml, `${COLUMNS.marker}${row}`, ITEM_MARKER);
    xml = setInlineString(xml, `${COLUMNS.name}${row}`, part.name.trim());
    xml = setNumber(xml, `${COLUMNS.quantity}${row}`, part.quantity);
    xml = setNumber(xml, `${COLUMNS.unitPrice}${row}`, part.unitPrice);
    xml = setFormula(
      xml,
      `${COLUMNS.amount}${row}`,
      `${COLUMNS.unitPrice}${row}*${COLUMNS.quantity}${row}`
    );
  });
  return xml;
}

export function totalPartsCost(parts: readonly QuotePartInput[]): number {
  return parts.reduce((sum, part) => sum + part.quantity * part.unitPrice, 0);
}

/** `MODEL: …, S/N:…, L/N:…` — 원본에 적혀 있던 형식 그대로. 없는 조각은 통째로 뺀다. */
export function buildProductInfoLine(input: {
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
 * 입력이 문서로 나가도 되는 값인가. O/H·매쳐 채우개도 같은 규칙을 쓴다 —
 * 규칙이 여러 벌이면 한쪽만 고쳐진 채로 남는다.
 */
export function validateQuoteInput(input: QuoteInput): void {
  const problems: string[] = [];
  if (!input.quoteNumber.trim()) problems.push("발행번호가 비어 있습니다.");
  if (!input.customerName.trim()) problems.push("공급처가 비어 있습니다.");
  if (!input.subject.trim()) problems.push("품명이 비어 있습니다.");
  if (Number.isNaN(input.quoteDate.getTime())) problems.push("발행일자가 유효하지 않습니다.");
  if (!Number.isFinite(input.workCost) || input.workCost < 0) {
    problems.push("작업비는 0 이상의 숫자여야 합니다.");
  }
  input.parts.forEach((part, index) => {
    const label = `부품 ${index + 1}`;
    if (!part.name.trim()) problems.push(`${label}: 품명이 비어 있습니다.`);
    if (!Number.isFinite(part.quantity) || part.quantity <= 0) {
      problems.push(`${label}: 수량은 0보다 커야 합니다.`);
    }
    if (!Number.isFinite(part.unitPrice) || part.unitPrice < 0) {
      problems.push(`${label}: 단가는 0 이상이어야 합니다.`);
    }
  });
  if (problems.length > 0) throw new Error(problems.join("\n"));
}
