import { ZipArchive } from "./zip-reader";
import { writeZip, type ZipEntryInput } from "./zip-writer";
import { clearCell, setDate, setFormula, setInlineString, setNumber } from "./sheet-patch";

/**
 * ============================================================================
 * 내자견적서 — 원본 양식의 칸만 채운다
 * ============================================================================
 * 원본 `내자견적서.xlsx` 를 읽어 값이 들어간 새 버퍼를 돌려준다. 원본 파일은
 * 절대 쓰지 않는다(읽기 전용). 로고·직인 이미지, styles.xml, 인쇄설정,
 * 36~52행의 작업 항목 문구, 20행 표머리, 3~7행 회사 정보는 **손대지 않는다** —
 * 그것들은 다른 파트에 있거나 우리가 건드릴 칸 목록에 없다.
 *
 * 아래 셀 주소와 스타일 승계 규칙은 **원본 파일을 실측해서 정한 값**이다.
 * 추측으로 늘리지 말 것. 새 칸이 필요하면 원본을 다시 열어보고 확인한 뒤 더한다.
 *
 * ── 양식의 공급가 수식은 고장나 있었다 ──────────────────────────────────
 * 원본 `I55`(공 급 가)가 `=M45` 인데 `M45` 는 값이 없는 빈 칸이다. 부가세
 * (`I56=I55*0.1`)와 합계(`I57=I55+I56`)가 전부 이 칸을 물고 있어서, 부품 단가를
 * 채워 넣어도 `I27:I31` 만 계산되고 **아래 합계 세 칸은 늘 0** 이었다. 손으로
 * 쓸 때는 합계를 직접 타이핑해 덮었을 것이다. 자동으로 만드는 문서에서는 그럴
 * 사람이 없으므로 `I55` 를 실제 합계로 바꾼다. 부가세·합계 수식은 그대로 둔다.
 *
 * ── 재계산을 Excel 에 맡긴다 ────────────────────────────────────────────
 * `D10`(발행일자)의 `TODAY()` 를 없애면 `xl/calcChain.xml` 이 시트와 어긋난다
 * (그 파일이 D10 을 수식 셀로 적어 두고 있다). calcChain 은 Excel 이 언제든
 * 다시 만들 수 있는 캐시라서 **파트째 들어낸다** — 참조 세 곳(Content_Types,
 * workbook.xml.rels, 파트 자체)을 함께 지우고, workbook 에 `fullCalcOnLoad` 를
 * 켜서 열 때 전부 다시 계산하게 한다. 낡은 캐시값이 화면에 먼저 보이는 일이
 * 없어야 한다.
 *
 * `TODAY()` 를 남기지 않는 이유: 그것은 '오늘'이지 '발행일자'가 아니다. 남겨
 * 두면 3개월 뒤에 그 파일을 여는 사람에게 3개월 뒤 날짜가 찍힌 견적서가 보인다.
 * ============================================================================
 */

/** 값을 채우는 시트. 통합문서의 첫 번째 탭이다. */
export const QUOTE_SHEET_NAME = "내자견적서";

export const QUOTE_CELLS = {
  quoteDate: "D10",
  quoteNumber: "D11",
  /** D12:E12 병합. M12:M18 을 목록으로 쓰는 드롭다운이 걸려 있지만, 목록 밖 값도 그대로 들어간다. */
  customerName: "D12",
  /** D23 이 `=D13` 으로 따라오므로 여기만 채우면 본문 제목도 함께 바뀐다. */
  subject: "D13",
  validity: "D15",
  delivery: "D16",
  payment: "D17",
  /** `MODEL: …, S/N:…, L/N:…` 한 줄. 원본에 예시가 박혀 있다. */
  productInfo: "D24",
  /** 2) 작업비의 단가. 수량(G33=1)과 금액 수식(I33)은 원본 그대로 둔다. */
  workCost: "H33",
  /** 공 급 가. 위 '고장나 있었다' 참조. */
  supplyTotal: "I55",
} as const;

/** 1) 부품 비용 칸. 양식이 다섯 줄로 고정돼 있고, 인쇄영역이 A1:I57 딱 1페이지다. */
export const PART_ROWS = [27, 28, 29, 30, 31] as const;
export const PART_COLUMNS = { name: "D", quantity: "G", unitPrice: "H" } as const;

/** 공급가 = 부품비 다섯 줄 + 작업비. 품목 영역(26~53행)을 통째로 더해 둔다. */
export const SUPPLY_TOTAL_FORMULA = "SUM(I26:I53)";

/**
 * 부품이 다섯 줄을 넘을 때 27행에 대신 적는 말(승인된 규칙). 행을 늘리지 않는
 * 이유는 인쇄 레이아웃이다 — 이 양식은 1페이지에 맞춰져 있고, 행을 밀면 아래
 * 병합셀·직인 앵커·인쇄영역이 전부 따라 틀어진다. 상세 목록은 이 함수가 버리지
 * 않는다. 부르는 쪽이 그대로 갖고 있다.
 */
export const PARTS_ROLLUP_LABEL = "부품 비용 일괄";

const CALC_CHAIN_PART = "xl/calcChain.xml";
const CONTENT_TYPES_PART = "[Content_Types].xml";
const WORKBOOK_PART = "xl/workbook.xml";
const WORKBOOK_RELS_PART = "xl/_rels/workbook.xml.rels";

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
 * 원본 양식 버퍼 + 입력 → 채워진 xlsx 버퍼.
 *
 * 은행계좌(D18)는 인자로 받지 않는다. 계좌번호를 코드나 DB 에 두지 않기 위해서고,
 * 양식에 이미 적혀 있으므로 그대로 나간다.
 */
export function fillQuoteWorkbook(templateXlsx: Buffer, input: QuoteInput): Buffer {
  validate(input);

  const archive = ZipArchive.fromBuffer(templateXlsx);
  const sheetPart = resolveSheetPart(archive, QUOTE_SHEET_NAME);
  const hasCalcChain = archive.has(CALC_CHAIN_PART);

  const entries: ZipEntryInput[] = [];
  for (const name of archive.list()) {
    // 위 '재계산을 Excel 에 맡긴다' 참조.
    if (name === CALC_CHAIN_PART) continue;

    const bytes = archive.readEntry(name);
    if (!bytes) throw new Error(`양식에서 파트를 읽지 못했습니다: "${name}"`);

    if (name === sheetPart) {
      entries.push({ name, data: toUtf8(fillSheet(bytes.toString("utf8"), input)) });
    } else if (name === WORKBOOK_PART) {
      entries.push({ name, data: toUtf8(enableFullCalcOnLoad(bytes.toString("utf8"))) });
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

function fillSheet(sheetXml: string, input: QuoteInput): string {
  let xml = sheetXml;

  xml = setDate(xml, QUOTE_CELLS.quoteDate, input.quoteDate);
  xml = setInlineString(xml, QUOTE_CELLS.quoteNumber, input.quoteNumber.trim());
  xml = setInlineString(xml, QUOTE_CELLS.customerName, input.customerName.trim());
  xml = setInlineString(xml, QUOTE_CELLS.subject, input.subject.trim());
  xml = setInlineString(xml, QUOTE_CELLS.productInfo, buildProductInfoLine(input));

  // 값을 준 것만 바꾼다. 안 주면 양식의 기본 문구가 그대로 남는다.
  const optional = [
    [input.validity, QUOTE_CELLS.validity],
    [input.delivery, QUOTE_CELLS.delivery],
    [input.payment, QUOTE_CELLS.payment],
  ] as const;
  for (const [value, cell] of optional) {
    if (value !== undefined) xml = setInlineString(xml, cell, value.trim());
  }

  xml = fillPartRows(xml, input.parts);
  xml = setNumber(xml, QUOTE_CELLS.workCost, input.workCost);
  xml = setFormula(xml, QUOTE_CELLS.supplyTotal, SUPPLY_TOTAL_FORMULA);

  return xml;
}

/**
 * 다섯 줄을 채우고 **남는 줄은 반드시 비운다.** 원본에는 "1번 부품"~"5번 부품"
 * 이라는 예시 문구가 박혀 있어서, 안 지우면 쓰지도 않은 부품이 견적서에 남는다.
 */
function fillPartRows(sheetXml: string, parts: readonly QuotePartInput[]): string {
  const rows: readonly QuotePartInput[] =
    parts.length > PART_ROWS.length
      ? [{ name: PARTS_ROLLUP_LABEL, quantity: 1, unitPrice: totalPartsCost(parts) }]
      : parts;

  let xml = sheetXml;
  PART_ROWS.forEach((row, index) => {
    const part = rows[index];
    if (!part) {
      xml = clearCell(xml, `${PART_COLUMNS.name}${row}`);
      xml = clearCell(xml, `${PART_COLUMNS.quantity}${row}`);
      xml = clearCell(xml, `${PART_COLUMNS.unitPrice}${row}`);
      return;
    }
    xml = setInlineString(xml, `${PART_COLUMNS.name}${row}`, part.name.trim());
    xml = setNumber(xml, `${PART_COLUMNS.quantity}${row}`, part.quantity);
    xml = setNumber(xml, `${PART_COLUMNS.unitPrice}${row}`, part.unitPrice);
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
 * 시트 이름 → 파트 경로. `sheet1.xml` 로 못 박지 않는 이유는, 탭 순서가 바뀌면
 * 아무 말 없이 **다른 시트(OH견적서)를 채우게** 되기 때문이다.
 */
function resolveSheetPart(archive: ZipArchive, sheetName: string): string {
  const workbook = archive.readText(WORKBOOK_PART);
  const sheetTag = new RegExp(`<sheet[^>]*name="${escapeRegExp(sheetName)}"[^>]*>`).exec(workbook);
  if (!sheetTag) throw new Error(`양식에 "${sheetName}" 시트가 없습니다.`);

  const relId = /r:id="([^"]+)"/.exec(sheetTag[0])?.[1];
  if (!relId) throw new Error(`"${sheetName}" 시트에 관계 ID 가 없습니다.`);

  const rels = archive.readText(WORKBOOK_RELS_PART);
  const relTag = new RegExp(`<Relationship[^>]*Id="${escapeRegExp(relId)}"[^>]*>`).exec(rels);
  const target = relTag ? /Target="([^"]+)"/.exec(relTag[0])?.[1] : undefined;
  if (!target) throw new Error(`관계 ${relId} 의 대상을 찾지 못했습니다.`);

  const part = target.startsWith("/") ? target.slice(1) : `xl/${target}`;
  if (!archive.has(part)) throw new Error(`양식에 시트 파트가 없습니다: "${part}"`);
  return part;
}

function enableFullCalcOnLoad(workbookXml: string): string {
  if (/<calcPr[^>]*fullCalcOnLoad="1"/.test(workbookXml)) return workbookXml;
  if (/<calcPr[^>]*\/>/.test(workbookXml)) {
    return workbookXml.replace(/<calcPr([^>]*)\/>/, '<calcPr$1 fullCalcOnLoad="1"/>');
  }
  if (workbookXml.includes("</workbook>")) {
    return workbookXml.replace("</workbook>", '<calcPr fullCalcOnLoad="1"/></workbook>');
  }
  throw new Error("workbook.xml 에 calcPr 을 넣을 자리를 찾지 못했습니다.");
}

function removeCalcChainOverride(contentTypesXml: string): string {
  const next = contentTypesXml.replace(/<Override[^>]*PartName="\/xl\/calcChain\.xml"[^>]*\/>/, "");
  if (next === contentTypesXml) {
    throw new Error("[Content_Types].xml 에서 calcChain 항목을 찾지 못했습니다.");
  }
  return next;
}

function removeCalcChainRelationship(relsXml: string): string {
  const next = relsXml.replace(/<Relationship[^>]*Target="calcChain\.xml"[^>]*\/>/, "");
  if (next === relsXml) {
    throw new Error("workbook.xml.rels 에서 calcChain 관계를 찾지 못했습니다.");
  }
  return next;
}

function validate(input: QuoteInput): void {
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
