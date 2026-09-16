import { ZipArchive } from "./zip-reader";
import { writeZip, type ZipEntryInput } from "./zip-writer";
import { setDate, setFormula, setInlineString, setIsoDate, setNumber } from "./sheet-patch";
import { clearCellIfPresent } from "./quote-sheet-layout";
import { usesIsoDates } from "./service-report-template";
import {
  CALC_CHAIN_PART,
  CONTENT_TYPES_PART,
  enableFullCalcOnLoad,
  removeCalcChainOverride,
  removeCalcChainRelationship,
  resolveSheetPart,
  WORKBOOK_PART,
  WORKBOOK_RELS_PART,
} from "./workbook-parts";

/**
 * ============================================================================
 * 케이블 견적서 — 자리가 정해진 양식을 채운다
 * ============================================================================
 * 케이블 견적서는 **수리품과 이어지지 않는 별도 견적서**다(2026-09-16 사용자).
 * 그래서 앞선 셋과 여러 곳이 다르다:
 *
 *   · **작업 범위 구역이 없다.** 「조사 · 수리 · 통전」 세 묶음이 아예 없고 품목
 *     표 하나뿐이다. 그래서 이 파일은 quote-sheet-layout.ts 의 작업 범위 도구를
 *     하나도 쓰지 않는다 — 없는 것을 억지로 만들지 않는다.
 *   · **규격 칸(D열)이 있다.** 앞선 셋에는 없다.
 *   · **설명 줄**이 품목 사이에 낀다(`* 20kW RFG 부속케이블 Parts 3종` 같은 것).
 *     그 줄은 품명 칸에 글자만 앉고 수량 · 단가 · 합계가 비어 있다.
 *   · **특이사항**이 머리말 맨 아래에 한 줄 있다.
 *   · **장비 종류와 무관하다.** 제너레이터 · 매쳐 · T/C 구분이 없다.
 *
 * ── 🔴 줄을 늘리지 않는다 ───────────────────────────────────────────────
 * 매쳐 채우개는 담을 만큼 줄을 늘리고 줄인다. 이 양식은 **늘리지 않는다.**
 * 27 · 29 · 31 … 43 의 아홉 자리에 한 줄씩 띄워 앉히고, 그것이 전부다
 * (2026-09-16 사용자 결정 — 한 줄씩 띄운 모양이 이 견적서의 본래 모양이다).
 *
 * 줄이 안 움직이므로 인쇄 영역도 그림 앵커도 밀 것이 없다. 이 양식에는 애초에
 * `_xlnm.Print_Area` 가 걸려 있지도 않다(실측).
 *
 * ── 🔴 아홉 줄을 넘으면 만들지 않는다 ───────────────────────────────────
 * 합계 수식은 `SUM(H26:H43)` 이라 43행까지만 더한다. 열 번째 줄을 조용히 잘라
 * 버리면 **사람은 자기가 넣은 품목이 다 들어간 줄 아는데 금액은 그만큼 모자란**
 * 견적서가 고객사로 나간다. 그래서 자르지 않고 `validateCableQuoteInput` 이
 * 던진다. 한계는 `CABLE_QUOTE_MAX_LINES` 로 내놓는다 — 화면이 미리 막을 수
 * 있어야 사람이 저장하기 전에 안다.
 *
 * **설명 줄도 한 자리를 먹는다.** 품목 줄과 합쳐 아홉이다.
 *
 * ── 🔴 합계 구간은 통째로 우리가 정한다 ─────────────────────────────────
 * `H26:H43` 안에서 우리가 적지 않은 칸은 **전부 비운다.** 양식에 손으로 적은
 * 조정액이 한 칸 남아 있으면 합계에 그대로 얹히고, 그것은 문서를 눈으로 봐도
 * 어디서 온 돈인지 알 수 없다(매쳐 OH 양식의 견본에 실제로 -6,000 이 남아
 * 있었다). 지금 양식은 몸통이 비어 있어서 이 비우기는 **한 바이트도 바꾸지
 * 않는다** — 값이 없는 칸을 비우면 서식만 남은 같은 칸이 나온다.
 *
 * ── 🔴 이 통합문서는 엄격(strict) OOXML 이다 ────────────────────────────
 * `<workbook conformance="strict"> <workbookPr dateCompatibility="0">` 이라
 * **1900 일련번호 체계를 쓰지 않겠다고 선언한 파일**이다. 여기에 `setDate` 로
 * 숫자를 적으면 발행일자 칸에 `45905` 가 찍힌다. 검사 · 수리 보고서 양식이 같은
 * 부류이고, 그쪽이 쓰는 판단(`usesIsoDates`)을 그대로 가져다 쓴다 — 규칙을 두 벌
 * 적어 두면 한쪽만 고쳐지는 날이 온다.
 *
 * ── 양식의 수식과 고정 문구는 손대지 않는다 ─────────────────────────────
 * `C16(=H44)` · `H44(=SUM(H26:H43))` · `H45(=H44*10%)` · `H46(=H44+H45)` 와
 * 은행계좌(C20) · 회사 정보(3~10행)는 **읽지도 쓰지도 않는다.** 값을 채우면
 * 엑셀이 스스로 셈한다(열 때 전부 다시 계산하도록 `fullCalcOnLoad` 를 켠다).
 * ============================================================================
 */

/** 값을 채우는 시트. 이 통합문서에는 `Sheet2`·`Sheet3` 도 들어 있다(빈 시트). */
export const CABLE_QUOTE_SHEET_NAME = "Sheet1";

/**
 * 머리말 칸. 왼쪽(A · B열)에 번호와 항목 이름이 이미 박혀 있고 **값만** C열에
 * 채운다. 실측한 값이라 추측으로 늘리지 말 것.
 */
export const CABLE_QUOTE_CELLS = {
  /** C12:D12 병합. 서식이 `yyyy"년" m"월" d"일"` 이다. */
  quoteDate: "C12",
  quoteNumber: "C13",
  customerName: "C14",
  subject: "C15",
  /** 🔴 표 위의 요약 금액. 양식이 `=H44` 로 받아 쓴다 — **건드리지 않는다.** */
  amount: "C16",
  validity: "C17",
  delivery: "C18",
  payment: "C19",
  /** 🔴 고정 문구(은행계좌) — **건드리지 않는다.** 계좌번호를 코드에 두지 않는다. */
  bankAccount: "C20",
  /**
   * 특이사항. B21 에 항목 이름(`특이사항 :`)만 있고 값 자리는 비어 있다 —
   * 머리말 여덟 줄이 모두 「B 이름 · C 값」이라 **같은 규칙으로 C21** 에 적는다.
   */
  remarks: "C21",
} as const;

/** 품목 표의 열. 머리글은 22행에 있다(`번호 · 품명 · 규격 · 수량 · 단가 · 합계`). */
export const CABLE_QUOTE_COLUMNS = {
  mark: "B",
  name: "C",
  spec: "D",
  quantity: "F",
  unitPrice: "G",
  amount: "H",
} as const;

/**
 * 🔴 품목이 앉는 아홉 자리. **한 줄씩 띄운다**(2026-09-16 사용자 결정) — 사이의
 * 짝수 행은 줄 간격을 벌리는 빈 줄이고, 거기에 적으면 양식의 모양이 무너진다.
 */
export const CABLE_QUOTE_ITEM_ROWS: readonly number[] = [27, 29, 31, 33, 35, 37, 39, 41, 43];

/**
 * 한 장에 담을 수 있는 줄 수 — **품목 줄 + 설명 줄을 합쳐서** 센다.
 *
 * 화면(뒤 조각)이 이 값으로 미리 막는다. 넘겨 주면 문서를 만들지 않고 던진다.
 */
export const CABLE_QUOTE_MAX_LINES = CABLE_QUOTE_ITEM_ROWS.length;

/** 규격이 없는 품목에 적는 글자. 사용자가 손으로 쓰던 그대로다. */
export const CABLE_QUOTE_EMPTY_SPEC = "-";

/**
 * 합계 수식(`SUM(H26:H43)`)이 더하는 구간. 이 안의 금액 칸은 우리가 적은 것만
 * 남는다 — 위 머리말의 '합계 구간은 통째로 우리가 정한다'.
 */
const TOTAL_RANGE = { firstRow: 26, lastRow: 43 } as const;

/** 품목 줄. 규격은 없을 수 있다(`quote_items.part_spec_text` 가 nullable 이다). */
export type CableQuoteItemLine = {
  kind: "ITEM";
  name: string;
  spec?: string | null;
  quantity: number;
  unitPrice: number;
};

/**
 * 설명 줄. 품명 칸에 글자만 앉고 수량 · 단가 · 합계는 비어 있다.
 *
 * 저장 쪽에서도 수량 · 단가가 **NULL 이어야 한다**(0101 마이그레이션의 CHECK).
 * 그래서 타입에도 그 칸이 아예 없다 — 넣을 수 있게 열어 두면 언젠가 들어온다.
 */
export type CableQuoteNoteLine = {
  kind: "NOTE";
  text: string;
};

export type CableQuoteLine = CableQuoteItemLine | CableQuoteNoteLine;

/**
 * 케이블 견적서 한 장.
 *
 * 🔴 **작업비 · 부품 · 장비 종류가 없다.** 앞선 셋의 `QuoteInput` 을 물려받지
 * 않는 까닭이다 — 물려받으면 이 양식에 자리가 없는 `workCost`·`parts` 를 쓰지도
 * 않으면서 요구하게 되고, 부르는 쪽은 0 과 빈 배열을 지어내 넘겨야 한다.
 */
export type CableQuoteInput = {
  quoteNumber: string;
  quoteDate: Date;
  customerName: string;
  subject: string;
  /** 비워 두면 양식의 기본 문구를 그대로 쓴다(유효기간 `발행일로 부터 4 주` 따위). */
  validity?: string;
  delivery?: string;
  payment?: string;
  /** 특이사항. 안 주면 양식 그대로 빈 칸이다. */
  remarks?: string;
  /** 품목 줄과 설명 줄이 **적히는 차례대로** 섞여 있는 목록. */
  lines: readonly CableQuoteLine[];
};

/**
 * 원본 양식 버퍼 + 입력 → 채워진 xlsx 버퍼. 원본은 절대 쓰지 않는다.
 *
 * 은행계좌 · 회사 정보는 인자로 받지 않는다 — 양식에 이미 적혀 있고, 계좌번호를
 * 코드나 DB 에 두지 않기 위해서다(quote-template.ts 와 같은 판단).
 */
export function fillCableQuoteWorkbook(templateXlsx: Buffer, input: CableQuoteInput): Buffer {
  validateCableQuoteInput(input);

  const archive = ZipArchive.fromBuffer(templateXlsx);
  const workbookXml = archive.readText(WORKBOOK_PART);
  const sheetPart = resolveSheetPart(archive, CABLE_QUOTE_SHEET_NAME);
  const hasCalcChain = archive.has(CALC_CHAIN_PART);

  const filled = fillSheet(archive.readText(sheetPart), input, usesIsoDates(workbookXml));

  const entries: ZipEntryInput[] = [];
  for (const name of archive.list()) {
    // 수식 칸의 값이 바뀌었으니 계산 사슬은 낡았다. Excel 이 열 때 다시 만든다
    // (quote-template.ts 의 '재계산을 Excel 에 맡긴다').
    if (name === CALC_CHAIN_PART) continue;

    const bytes = archive.readEntry(name);
    if (!bytes) throw new Error(`양식에서 파트를 읽지 못했습니다: "${name}"`);

    if (name === sheetPart) {
      entries.push({ name, data: toUtf8(filled) });
    } else if (name === WORKBOOK_PART) {
      // 인쇄 영역은 밀지 않는다 — 줄이 움직이지 않는다(위 머리말).
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

function fillSheet(sheetXml: string, input: CableQuoteInput, isoDates: boolean): string {
  let xml = sheetXml;

  // ── 머리말 ────────────────────────────────────────────────────────
  xml = isoDates
    ? setIsoDate(xml, CABLE_QUOTE_CELLS.quoteDate, input.quoteDate)
    : setDate(xml, CABLE_QUOTE_CELLS.quoteDate, input.quoteDate);
  xml = setInlineString(xml, CABLE_QUOTE_CELLS.quoteNumber, input.quoteNumber.trim());
  xml = setInlineString(xml, CABLE_QUOTE_CELLS.customerName, input.customerName.trim());
  xml = setInlineString(xml, CABLE_QUOTE_CELLS.subject, input.subject.trim());

  // 값을 준 것만 바꾼다. 안 주면 양식의 기본 문구가 그대로 남는다(유효기간 ·
  // 결재조건에는 문구가 적혀 있고, 납기 · 특이사항은 빈 칸이다).
  for (const [value, cell] of [
    [input.validity, CABLE_QUOTE_CELLS.validity],
    [input.delivery, CABLE_QUOTE_CELLS.delivery],
    [input.payment, CABLE_QUOTE_CELLS.payment],
    [input.remarks, CABLE_QUOTE_CELLS.remarks],
  ] as const) {
    if (value !== undefined) xml = setInlineString(xml, cell, value.trim());
  }

  // ── 품목 표 ───────────────────────────────────────────────────────
  // 번호는 **품목 줄만** 센다. 설명 줄은 번호를 받지 않으므로, 설명 줄이 사이에
  // 끼어도 품목은 `1) 2) 3)` 으로 이어진다.
  let itemNumber = 0;

  CABLE_QUOTE_ITEM_ROWS.forEach((row, index) => {
    // 먼저 그 줄의 여섯 칸을 비운다. 양식에 남아 있던 것이 우리가 안 적는 칸으로
    // 새어 나가지 않게 — 설명 줄의 수량 · 단가 자리가 특히 그렇다.
    for (const column of Object.values(CABLE_QUOTE_COLUMNS)) {
      xml = clearCellIfPresent(xml, `${column}${row}`);
    }

    const line = input.lines[index];
    if (line === undefined) return;

    if (line.kind === "NOTE") {
      // 품명 칸에 글자만. 번호 · 규격 · 수량 · 단가 · 합계는 위에서 비운 채로 둔다.
      xml = setInlineString(xml, `${CABLE_QUOTE_COLUMNS.name}${row}`, line.text.trim());
      return;
    }

    itemNumber += 1;
    const spec = line.spec?.trim();
    xml = setInlineString(xml, `${CABLE_QUOTE_COLUMNS.mark}${row}`, `${itemNumber})`);
    xml = setInlineString(xml, `${CABLE_QUOTE_COLUMNS.name}${row}`, line.name.trim());
    xml = setInlineString(
      xml,
      `${CABLE_QUOTE_COLUMNS.spec}${row}`,
      spec ? spec : CABLE_QUOTE_EMPTY_SPEC
    );
    xml = setNumber(xml, `${CABLE_QUOTE_COLUMNS.quantity}${row}`, line.quantity);
    xml = setNumber(xml, `${CABLE_QUOTE_COLUMNS.unitPrice}${row}`, line.unitPrice);
    /**
     * 합계 칸은 **수식**이다(`=F27*G27`). 사용자가 손으로 쓰던 모양 그대로이고,
     * 받아 본 사람이 수량이나 단가를 고치면 합계와 총액이 따라 움직인다 — 값으로
     * 박아 두면 그 자리만 옛 금액으로 남아 **문서 안에서 서로 어긋난다.**
     * 캐시값(`<v>`)을 같이 적지 않는 까닭은 sheet-patch.ts 의 `setFormula` 주석에.
     */
    xml = setFormula(
      xml,
      `${CABLE_QUOTE_COLUMNS.amount}${row}`,
      `${CABLE_QUOTE_COLUMNS.quantity}${row}*${CABLE_QUOTE_COLUMNS.unitPrice}${row}`
    );
  });

  // 품목 자리가 아닌 줄(사이의 빈 줄과 표 첫 줄)의 금액 칸을 비운다 — 합계
  // 수식이 더하는 구간 안이라, 남아 있으면 어디서 왔는지 모를 돈이 얹힌다.
  for (let row = TOTAL_RANGE.firstRow; row <= TOTAL_RANGE.lastRow; row += 1) {
    if (CABLE_QUOTE_ITEM_ROWS.includes(row)) continue;
    xml = clearCellIfPresent(xml, `${CABLE_QUOTE_COLUMNS.amount}${row}`);
  }

  return xml;
}

/**
 * 입력이 문서로 나가도 되는 값인가.
 *
 * 🔴 **아홉 줄을 넘으면 여기서 멈춘다.** 자르지 않는다 — 위 머리말의 '아홉 줄을
 * 넘으면 만들지 않는다'.
 */
export function validateCableQuoteInput(input: CableQuoteInput): void {
  const problems: string[] = [];
  if (!input.quoteNumber.trim()) problems.push("발행번호가 비어 있습니다.");
  if (!input.customerName.trim()) problems.push("공급처가 비어 있습니다.");
  if (!input.subject.trim()) problems.push("품명이 비어 있습니다.");
  if (Number.isNaN(input.quoteDate.getTime())) problems.push("발행일자가 유효하지 않습니다.");

  if (input.lines.length > CABLE_QUOTE_MAX_LINES) {
    problems.push(
      `케이블 견적서 양식에는 품목 줄과 설명 줄을 합쳐 ${CABLE_QUOTE_MAX_LINES}줄까지 넣을 수 있습니다` +
        `(지금 ${input.lines.length}줄). 줄을 줄이거나 견적서를 나눠 주세요.`
    );
  }

  input.lines.forEach((line, index) => {
    const label = `${index + 1}번째 줄`;

    // 타입이 없는 곳에서도 불릴 수 있다 — 종류를 못 알아보면 여기서 멈춘다
    // (service-report-template.ts 의 validateServiceReportInput 과 같은 판단).
    const kind: string = line.kind;
    if (kind !== "ITEM" && kind !== "NOTE") {
      problems.push(`${label}: 알 수 없는 줄 종류입니다: ${kind}`);
      return;
    }

    if (line.kind === "NOTE") {
      if (!line.text.trim()) problems.push(`${label}: 설명 줄의 글자가 비어 있습니다.`);
      return;
    }

    if (!line.name.trim()) problems.push(`${label}: 품명이 비어 있습니다.`);
    if (!Number.isFinite(line.quantity) || line.quantity <= 0) {
      problems.push(`${label}: 수량은 0보다 커야 합니다.`);
    }
    if (!Number.isFinite(line.unitPrice) || line.unitPrice < 0) {
      problems.push(`${label}: 단가는 0 이상이어야 합니다.`);
    }
  });

  if (problems.length > 0) throw new Error(problems.join("\n"));
}

/**
 * 품목 줄의 금액 합계. 설명 줄은 더할 것이 없어 건너뛴다.
 *
 * 문서에는 이 값을 적지 않는다 — 합계는 양식의 수식이 셈한다. 부르는 쪽(미리보기 ·
 * 화면)이 같은 금액을 보여 주어야 할 때 쓰라고 내놓는다.
 */
export function totalCableQuoteAmount(lines: readonly CableQuoteLine[]): number {
  return lines.reduce(
    (sum, line) => (line.kind === "ITEM" ? sum + line.quantity * line.unitPrice : sum),
    0
  );
}
