import { ZipArchive } from "./zip-reader";
import { writeZip, type ZipEntryInput } from "./zip-writer";
import { clearCell, setDate, setFormula, setInlineString, setNumber } from "./sheet-patch";
import type { QuoteInput } from "./quote-template";

/**
 * ============================================================================
 * OH 견적서 — `견적서 OH.xlsx` 의 `OH견적서` 시트를 채운다
 * ============================================================================
 * 내자 양식(quote-template.ts)과 **다른 파일, 다른 자리**다. 같은 함수로 처리할
 * 수 없어서 따로 둔다 — 셀 주소가 겹치는 곳이 거의 없다:
 *
 *              내자              OH
 *   부품 칸    27~31             27~31  (같다)
 *   OH 부품    없음              34~46  ← 이 양식에만 있다
 *   작업비     H33               H48
 *   합계       I55/I56/I57       I70/I71/I72
 *
 * ── 🔴 외부 링크를 전부 값으로 바꾼다 ──────────────────────────────────
 * 이 양식은 22개 칸이 **다른 통합문서**를 참조한다(`[1]내자견적서!D10` 꼴).
 * 사람이 두 파일을 나란히 놓고 쓰던 흔적이고, 그대로 내보내면 받아 본 쪽에서
 * "이 통합 문서에 다른 데이터 원본 링크가 있습니다" 경고가 뜨고 값이 갱신되지
 * 않는다. 그래서 그 수식들을 **값으로 갈아 끼우고**, 링크 파트 자체를 들어낸다
 * (externalLinks + workbook 의 externalReferences + rels + Content_Types).
 *
 * ── 합계 수식은 그대로 둔다 ─────────────────────────────────────────────
 * 이 양식은 공급가를 **만원 단위로 내린다**:
 *
 *     G76 = SUM(I26:I65)  →  H76 = G76/10000  →  H77 = ROUNDDOWN(H76,0)*10000
 *     I70(공급가) = H77
 *
 * 그 사슬을 손대지 않는다. 우리가 셈해서 적어 넣으면 Excel 이 다시 계산한 값과
 * 어긋날 수 있고, 어긋난 쪽이 화면에 먼저 보인다. 값만 채우면 반올림 규칙은
 * 양식이 알아서 지킨다.
 *
 * ── ⚠️ I46 만 조건 수식이다 ────────────────────────────────────────────
 * `IF(D46="유량계", G46*H46, "")` — 기종 15 에만 있는 마지막 줄이라 이름으로
 * 걸러 두었다. 우리가 다른 부품을 그 자리에 쓰면 금액이 `""` 가 되어 **합계에서
 * 통째로 빠진다.** 그래서 다른 줄과 같은 `H46*G46` 으로 바꾼다.
 *
 * ── 작업비에 240만을 더하지 않는다 ─────────────────────────────────────
 * 양식은 `H48 = 내자!H33 + 2400000` 이지만, 여기서는 **받은 작업비를 그대로
 * 쓴다.** 그 상수가 늘 고정인지 확인되지 않았고(사용자에게 물어 둔 상태),
 * 확인되지 않은 금액을 조용히 더하면 고객사에 240만원이 더 붙은 견적서가
 * 나간다. 화면이 그 사실을 안내하고 사람이 포함된 값을 적는다.
 * ============================================================================
 */

export const OH_QUOTE_SHEET_NAME = "OH견적서";

export const OH_QUOTE_CELLS = {
  quoteDate: "D10",
  quoteNumber: "D11",
  customerName: "D12",
  subject: "D13",
  validity: "D15",
  delivery: "D16",
  payment: "D17",
  productInfo: "D24",
  /** 작업비. 내자의 H33 에 해당한다(위 표). */
  workCost: "H48",
} as const;

/** 1) 부품 비용 — 내자와 같은 자리. */
export const OH_PART_ROWS = [27, 28, 29, 30, 31] as const;
/** 2) OH 부품 비용 — 이 양식에만 있는 13줄. */
export const OH_OVERHAUL_ROWS = [34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46] as const;
export const OH_COLUMNS = { name: "D", quantity: "G", unitPrice: "H", amount: "I" } as const;

/** 위 '⚠️ I46 만 조건 수식이다' 참조. */
const CONDITIONAL_AMOUNT_ROW = 46;

const EXTERNAL_LINK_PREFIX = "xl/externalLinks/";
const CONTENT_TYPES_PART = "[Content_Types].xml";
const WORKBOOK_PART = "xl/workbook.xml";
const WORKBOOK_RELS_PART = "xl/_rels/workbook.xml.rels";
const CALC_CHAIN_PART = "xl/calcChain.xml";

export type OhQuoteInput = QuoteInput & {
  /**
   * `2) OH 부품 비용` 칸에 들어갈 부품들. 재고 관리의 O/H 템플릿에서 담아 온
   * 것이고, 비어 있어도 된다(부품 없이 작업비만 받는 OH 견적이 있다).
   *
   * 13줄을 넘으면 **자르지 않고 던진다** — 조용히 빼면 청구해야 할 부품이
   * 문서에서 사라진다. 화면이 그 전에 막는다.
   */
  overhaulParts: readonly { name: string; quantity: number; unitPrice: number }[];
};

export function fillOhQuoteWorkbook(templateXlsx: Buffer, input: OhQuoteInput): Buffer {
  if (input.overhaulParts.length > OH_OVERHAUL_ROWS.length) {
    throw new Error(
      `OH 부품은 ${OH_OVERHAUL_ROWS.length}줄까지 넣을 수 있습니다(받은 것: ${input.overhaulParts.length}줄).`
    );
  }

  const archive = ZipArchive.fromBuffer(templateXlsx);
  const sheetPart = resolveSheetPart(archive, OH_QUOTE_SHEET_NAME);
  const hasCalcChain = archive.has(CALC_CHAIN_PART);

  const entries: ZipEntryInput[] = [];
  for (const name of archive.list()) {
    // 링크 파트와 계산 캐시는 들어낸다(파일 머리말).
    if (name.startsWith(EXTERNAL_LINK_PREFIX)) continue;
    if (name === CALC_CHAIN_PART) continue;

    const bytes = archive.readEntry(name);
    if (!bytes) throw new Error(`양식에서 파트를 읽지 못했습니다: "${name}"`);

    if (name === sheetPart) {
      entries.push({ name, data: utf8(fillSheet(bytes.toString("utf8"), input)) });
    } else if (name === WORKBOOK_PART) {
      entries.push({ name, data: utf8(cleanWorkbook(bytes.toString("utf8"))) });
    } else if (name === CONTENT_TYPES_PART) {
      entries.push({ name, data: utf8(cleanContentTypes(bytes.toString("utf8"), hasCalcChain)) });
    } else if (name === WORKBOOK_RELS_PART) {
      entries.push({ name, data: utf8(cleanWorkbookRels(bytes.toString("utf8"))) });
    } else {
      entries.push({ name, data: bytes });
    }
  }

  return writeZip(entries);
}

function utf8(value: string): Buffer {
  return Buffer.from(value, "utf8");
}

function fillSheet(sheetXml: string, input: OhQuoteInput): string {
  let xml = sheetXml;

  xml = setDate(xml, OH_QUOTE_CELLS.quoteDate, input.quoteDate);
  xml = setInlineString(xml, OH_QUOTE_CELLS.quoteNumber, input.quoteNumber.trim());
  xml = setInlineString(xml, OH_QUOTE_CELLS.customerName, input.customerName.trim());
  xml = setInlineString(xml, OH_QUOTE_CELLS.subject, input.subject.trim());
  xml = setInlineString(xml, OH_QUOTE_CELLS.productInfo, buildProductInfoLine(input));

  for (const [value, cell] of [
    [input.validity, OH_QUOTE_CELLS.validity],
    [input.delivery, OH_QUOTE_CELLS.delivery],
    [input.payment, OH_QUOTE_CELLS.payment],
  ] as const) {
    if (value !== undefined) xml = setInlineString(xml, cell, value.trim());
  }

  xml = fillRows(xml, OH_PART_ROWS, input.parts);
  xml = fillRows(xml, OH_OVERHAUL_ROWS, input.overhaulParts);

  // 위 '⚠️ I46 만 조건 수식이다' — 이름으로 거르던 수식을 다른 줄과 같게 만든다.
  xml = setFormula(xml, `${OH_COLUMNS.amount}${CONDITIONAL_AMOUNT_ROW}`, `H${CONDITIONAL_AMOUNT_ROW}*G${CONDITIONAL_AMOUNT_ROW}`);

  // 작업비는 받은 값 그대로 — 240만을 더하지 않는다(파일 머리말).
  xml = setNumber(xml, OH_QUOTE_CELLS.workCost, input.workCost);

  // 마지막으로 **남은 외부 참조를 전부 굳힌다**(아래 함수 주석).
  return freezeExternalReferences(xml);
}

/**
 * 아직 남아 있는 `[1]다른통합문서!…` 수식을 **그 자리의 캐시값으로** 바꾼다.
 *
 * 위에서 칸마다 값을 써 넣지만, **값을 주지 않은 칸은 일부러 건드리지 않는다** —
 * 내자 양식에서는 그것이 "양식의 기본 문구를 그대로 쓴다"는 뜻이고 옳다. 그런데
 * 이 양식에서는 그 칸(예: 납기 D16)이 **외부 수식**이라, 안 건드리면 깨진 링크가
 * 그대로 나간다. 실제로 D16 하나가 그렇게 남아 시험에 걸렸다.
 *
 * 그래서 칸을 하나씩 더 지정하는 대신 **훑어서 굳힌다.** 앞으로 양식에 외부
 * 참조가 하나 더 생겨도 자동으로 잡힌다 — 목록을 손으로 관리하면 그 하나를
 * 빠뜨리는 날이 오고, 그때 증상은 "받아 본 쪽에서만 보이는 경고"라 우리 쪽에서
 * 알아채지 못한다.
 *
 * 캐시값은 Excel 이 마지막으로 저장할 때 계산해 둔 값이라, 그 순간의 내자
 * 견적서 값이다. 우리가 채우는 칸은 이미 위에서 덮였으므로 여기 남는 것은
 * **기본 문구 성격의 칸들**뿐이다.
 */
function freezeExternalReferences(sheetXml: string): string {
  let xml = sheetXml;
  // 셀 하나를 바꿀 때마다 길이가 달라지므로 매번 처음부터 다시 찾는다.
  for (let guard = 0; guard < 200; guard += 1) {
    const match = /<c r="([A-Z]+\d+)"([^>]*)>((?:(?!<\/c>)[\s\S])*?)<\/c>/g.exec(xml);
    const target = findNextExternalCell(xml);
    if (!target) return xml;
    void match;

    const style = /\ss="([^"]*)"/.exec(target.openTag)?.[1] ?? null;
    const isText = /\st="str"/.test(target.openTag);
    const cached = /<v>([\s\S]*?)<\/v>/.exec(target.inner)?.[1];

    let replacement: string;
    if (cached === undefined || cached === "") {
      replacement = `<c r="${target.ref}"${style === null ? "" : ` s="${style}"`}/>`;
    } else if (isText) {
      replacement = `<c r="${target.ref}"${style === null ? "" : ` s="${style}"`} t="inlineStr"><is><t xml:space="preserve">${cached}</t></is></c>`;
    } else {
      replacement = `<c r="${target.ref}"${style === null ? "" : ` s="${style}"`}><v>${cached}</v></c>`;
    }
    xml = xml.slice(0, target.start) + replacement + xml.slice(target.end);
  }
  throw new Error("외부 참조가 지나치게 많습니다. 양식을 확인해 주세요.");
}

function findNextExternalCell(
  xml: string
): { ref: string; openTag: string; inner: string; start: number; end: number } | null {
  const pattern = /<c r="([A-Z]+\d+)"[^>]*>/g;
  let open: RegExpExecArray | null;
  while ((open = pattern.exec(xml)) !== null) {
    if (open[0].endsWith("/>")) continue;
    const contentStart = open.index + open[0].length;
    const closeIndex = xml.indexOf("</c>", contentStart);
    if (closeIndex === -1) continue;
    const inner = xml.slice(contentStart, closeIndex);
    // 외부 통합문서 참조는 `[1]` 처럼 대괄호 안의 번호로 적힌다.
    if (!/<f[^>]*>(?:(?!<\/f>)[\s\S])*\[\d+\]/.test(inner)) continue;
    return {
      ref: open[1],
      openTag: open[0],
      inner,
      start: open.index,
      end: closeIndex + "</c>".length,
    };
  }
  return null;
}

/**
 * 정해진 줄들에 부품을 채우고 **남는 줄은 반드시 비운다.**
 * 양식에는 외부 링크 수식과 IFS 수식이 박혀 있어서, 안 지우면 쓰지도 않은
 * 부품(또는 `#REF!`)이 견적서에 남는다.
 */
function fillRows(
  sheetXml: string,
  rows: readonly number[],
  items: readonly { name: string; quantity: number; unitPrice: number }[]
): string {
  let xml = sheetXml;
  rows.forEach((row, index) => {
    const item = items[index];
    if (!item) {
      xml = clearCell(xml, `${OH_COLUMNS.name}${row}`);
      xml = clearCell(xml, `${OH_COLUMNS.quantity}${row}`);
      xml = clearCell(xml, `${OH_COLUMNS.unitPrice}${row}`);
      return;
    }
    xml = setInlineString(xml, `${OH_COLUMNS.name}${row}`, item.name.trim());
    xml = setNumber(xml, `${OH_COLUMNS.quantity}${row}`, item.quantity);
    xml = setNumber(xml, `${OH_COLUMNS.unitPrice}${row}`, item.unitPrice);
  });
  return xml;
}

/** 내자 양식과 같은 형식 — 두 문서의 제품 줄이 달라 보이면 안 된다. */
function buildProductInfoLine(input: {
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

function resolveSheetPart(archive: ZipArchive, sheetName: string): string {
  const workbook = archive.readText(WORKBOOK_PART);
  const escaped = sheetName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const sheetTag = new RegExp(`<sheet[^>]*name="${escaped}"[^>]*>`).exec(workbook);
  if (!sheetTag) throw new Error(`양식에 "${sheetName}" 시트가 없습니다.`);
  const relId = /r:id="([^"]+)"/.exec(sheetTag[0])?.[1];
  if (!relId) throw new Error(`"${sheetName}" 시트에 관계 ID 가 없습니다.`);

  const rels = archive.readText(WORKBOOK_RELS_PART);
  const relTag = new RegExp(`<Relationship[^>]*Id="${relId}"[^>]*>`).exec(rels);
  const target = relTag ? /Target="([^"]+)"/.exec(relTag[0])?.[1] : undefined;
  if (!target) throw new Error(`관계 ${relId} 의 대상을 찾지 못했습니다.`);

  const part = target.startsWith("/") ? target.slice(1) : `xl/${target}`;
  if (!archive.has(part)) throw new Error(`양식에 시트 파트가 없습니다: "${part}"`);
  return part;
}

/** 링크 선언을 지우고 열 때 전부 다시 계산하게 한다. */
function cleanWorkbook(workbookXml: string): string {
  const xml = workbookXml.replace(/<externalReferences>[\s\S]*?<\/externalReferences>/, "");
  if (/<calcPr[^>]*fullCalcOnLoad="1"/.test(xml)) return xml;
  if (/<calcPr[^>]*\/>/.test(xml)) {
    return xml.replace(/<calcPr([^>]*)\/>/, '<calcPr$1 fullCalcOnLoad="1"/>');
  }
  if (xml.includes("</workbook>")) {
    return xml.replace("</workbook>", '<calcPr fullCalcOnLoad="1"/></workbook>');
  }
  throw new Error("workbook.xml 에 calcPr 을 넣을 자리를 찾지 못했습니다.");
}

function cleanContentTypes(contentTypesXml: string, hasCalcChain: boolean): string {
  let xml = contentTypesXml.replace(/<Override[^>]*PartName="\/xl\/externalLinks\/[^"]*"[^>]*\/>/g, "");
  if (hasCalcChain) {
    const next = xml.replace(/<Override[^>]*PartName="\/xl\/calcChain\.xml"[^>]*\/>/, "");
    if (next === xml) throw new Error("[Content_Types].xml 에서 calcChain 항목을 찾지 못했습니다.");
    xml = next;
  }
  return xml;
}

function cleanWorkbookRels(relsXml: string): string {
  return relsXml
    .replace(/<Relationship[^>]*Target="externalLinks\/[^"]*"[^>]*\/>/g, "")
    .replace(/<Relationship[^>]*Target="calcChain\.xml"[^>]*\/>/, "");
}
