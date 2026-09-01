/**
 * ============================================================================
 * 시트 XML 의 셀 하나를 통째로 갈아 끼운다
 * ============================================================================
 * .xlsx 의 워크시트는 `xl/worksheets/sheetN.xml` 한 장이고, 셀은 그 안의
 * `<c r="D13" s="62" .../>` 요소다. 견적서 생성은 **정해진 칸 십여 개의 값만**
 * 바꾸는 일이라, XML 을 트리로 파싱했다가 다시 직렬화하지 않는다 — 그렇게 하면
 * 손대지 않은 부분의 속성 순서·공백·네임스페이스 선언이 미묘하게 달라지고,
 * "원본과 무엇이 달라졌는가"를 더 이상 바이트로 답할 수 없게 된다.
 * 대상 요소만 문자열로 찾아 바꾸면 나머지는 **입력 그대로** 남는다.
 *
 * ── 못 찾으면 던진다 ────────────────────────────────────────────────────
 * `findCell` 은 매치가 정확히 하나가 아니면 예외다. 조용히 넘어가면 양식이
 * 바뀌었을 때 아무도 모르는 채 **빈 칸짜리 견적서가 고객사로 나간다.**
 * 견적서는 틀린 것보다 안 나오는 편이 낫다.
 *
 * ── 문자열은 inlineStr 로 쓴다 ──────────────────────────────────────────
 * `t="s"` 는 값이 `xl/sharedStrings.xml` 의 인덱스라, 글자를 하나 바꾸려면 그
 * 파일에 항목을 더하고 `count`/`uniqueCount` 를 고치고 다른 시트가 쓰는 인덱스가
 * 밀리지 않는지까지 봐야 한다. `t="inlineStr"` 는 글자를 셀 안에 그대로 담아서
 * sharedStrings 를 아예 건드리지 않는다. Excel 이 정식으로 지원하는 형식이다.
 *
 * **스타일 인덱스(`s`)는 언제나 원본 것을 승계한다.** 서식은 우리가 만드는 것이
 * 아니라 양식에 이미 있는 것이고, 새로 만들면 styles.xml 이 원본과 달라진다.
 * ============================================================================
 */

/** Excel 1900 날짜 체계의 기준일. 1900년 윤년 버그 때문에 1899-12-31 이 아니라 12-30 이다. */
const EXCEL_EPOCH_UTC = Date.UTC(1899, 11, 30);
const MS_PER_DAY = 86_400_000;

/** 줄바꿈·탭 말고 XML 1.0 이 허용하지 않는 제어문자. Excel 은 이것들을 손상으로 본다. */
const FORBIDDEN_CONTROL_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;

export type CellMatch = {
  /** 매치된 `<c ...>` 요소 전체 */
  raw: string;
  start: number;
  end: number;
  /** 원본의 `s="…"` 값. 스타일이 없으면 null. */
  style: string | null;
};

export function escapeXmlText(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(FORBIDDEN_CONTROL_CHARS, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/\n/g, "&#10;");
}

/** 달력 날짜 → Excel 일련번호. 시각은 버린다(발행일자는 날짜다). */
export function toExcelSerialDate(date: Date): number {
  if (Number.isNaN(date.getTime())) throw new Error("유효하지 않은 날짜입니다.");
  const local = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.round((local - EXCEL_EPOCH_UTC) / MS_PER_DAY);
}

/** 지수 표기 없이 숫자를 쓴다. `1e+21` 같은 문자열은 Excel 이 못 읽는다. */
function numberToXml(value: number): string {
  if (!Number.isFinite(value)) throw new Error(`셀에 넣을 수 없는 숫자입니다: ${value}`);
  if (Math.abs(value) >= 1e21) throw new Error(`셀에 넣기에 너무 큰 숫자입니다: ${value}`);
  return String(value);
}

/**
 * `<c r="{ref}" …>` 요소를 찾는다. 자체닫힘과 여는-닫는 형태를 모두 받는다.
 * 매치가 하나가 아니면 던진다(파일 머리말의 '못 찾으면 던진다' 참조).
 */
export function findCell(sheetXml: string, ref: string): CellMatch {
  // 여는 태그만 먼저 잡는다. `[^>]*` 가 `>` 를 못 넘으므로 자체닫힘 `/>` 도 여기서 끝난다.
  // 한 방에 `(?:/>|>…</c>)` 로 잡으려 하면 `[^>]*` 가 자체닫힘의 `/` 를 삼켜서
  // **다음 셀까지 통째로 매치된다** — 그 셀이 조용히 지워진다.
  const openPattern = new RegExp(`<c r="${escapeRegExp(ref)}"[^>]*>`, "g");
  const opens = [...sheetXml.matchAll(openPattern)];
  if (opens.length === 0) {
    throw new Error(`시트에서 셀 ${ref} 를 찾지 못했습니다. 양식이 바뀐 것 같습니다.`);
  }
  if (opens.length > 1) {
    throw new Error(`시트에서 셀 ${ref} 가 ${opens.length}번 나옵니다. 양식이 손상됐습니다.`);
  }

  const openTag = opens[0][0];
  const start = opens[0].index;
  let end = start + openTag.length;
  if (!openTag.endsWith("/>")) {
    // `<c>` 는 중첩되지 않으므로 처음 만나는 `</c>` 가 이 셀의 것이다.
    const closeIndex = sheetXml.indexOf("</c>", end);
    if (closeIndex === -1) {
      throw new Error(`셀 ${ref} 의 닫는 태그를 찾지 못했습니다. 양식이 손상됐습니다.`);
    }
    end = closeIndex + "</c>".length;
  }

  const style = /\ss="([^"]*)"/.exec(openTag)?.[1] ?? null;
  return { raw: sheetXml.slice(start, end), start, end, style };
}

/** 셀의 현재 내용(자식 XML). 자체닫힘이면 빈 문자열. 테스트와 눈으로 확인할 때 쓴다. */
export function readCellInner(sheetXml: string, ref: string): string {
  const cell = findCell(sheetXml, ref);
  if (cell.raw.endsWith("/>")) return "";
  return cell.raw.slice(cell.raw.indexOf(">") + 1, cell.raw.lastIndexOf("</c>"));
}

function replaceCell(sheetXml: string, ref: string, build: (style: string | null) => string): string {
  const cell = findCell(sheetXml, ref);
  return sheetXml.slice(0, cell.start) + build(cell.style) + sheetXml.slice(cell.end);
}

function styleAttr(style: string | null): string {
  return style === null ? "" : ` s="${style}"`;
}

/** 문자열 값. 빈 문자열이면 `clearCell` 과 같게 동작한다(빈 `<is>` 를 남기지 않는다). */
export function setInlineString(sheetXml: string, ref: string, value: string): string {
  if (value === "") return clearCell(sheetXml, ref);
  return replaceCell(
    sheetXml,
    ref,
    (style) =>
      `<c r="${ref}"${styleAttr(style)} t="inlineStr"><is><t xml:space="preserve">${escapeXmlText(value)}</t></is></c>`
  );
}

export function setNumber(sheetXml: string, ref: string, value: number): string {
  return replaceCell(
    sheetXml,
    ref,
    (style) => `<c r="${ref}"${styleAttr(style)}><v>${numberToXml(value)}</v></c>`
  );
}

export function setDate(sheetXml: string, ref: string, value: Date): string {
  return setNumber(sheetXml, ref, toExcelSerialDate(value));
}

/** 달력 날짜 → `2026-09-01`. 시각은 버린다(setDate 와 같은 이유). */
export function toIsoDateText(date: Date): string {
  if (Number.isNaN(date.getTime())) throw new Error("유효하지 않은 날짜입니다.");
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * ISO 8601 날짜(`t="d"`). **엄격(strict) OOXML 통합문서에서만 쓴다.**
 *
 * `setDate` 는 1900 기준의 일련번호를 적는다. 그런데 통합문서가
 * `<workbookPr dateCompatibility="0">` 이면 그 통합문서는 **일련번호 체계를
 * 쓰지 않겠다고 선언한 것**이고, 그런 파일에 숫자를 적으면 Excel 은 그것을
 * 날짜가 아니라 그냥 숫자로 읽는다 — 발행일 칸에 `45728` 이 찍힌 보고서가
 * 고객사로 나간다.
 *
 * 검사·수리 보고서 양식이 그 부류다(`conformance="strict"`). 그 양식의 날짜
 * 칸들은 Excel 자신이 `<c r="AO8" s="358" t="d"><v>2025-03-12</v></c>` 로
 * 적어 두었고, 여기서 하는 일은 **양식이 이미 쓰고 있는 모양 그대로** 값만
 * 갈아 끼우는 것이다. 어느 쪽을 쓸지는 부르는 쪽이 workbook.xml 을 보고
 * 정한다(service-report-template.ts 의 `usesIsoDates`).
 */
export function setIsoDate(sheetXml: string, ref: string, value: Date): string {
  return replaceCell(
    sheetXml,
    ref,
    (style) => `<c r="${ref}"${styleAttr(style)} t="d"><v>${toIsoDateText(value)}</v></c>`
  );
}

/**
 * 수식. 캐시값(`<v>`)을 일부러 쓰지 않는다 — 우리가 계산한 값을 적어 넣으면
 * Excel 이 다시 계산한 값과 어긋날 수 있고, 어긋난 쪽이 화면에 먼저 보인다.
 * 대신 workbook 에 `fullCalcOnLoad` 를 켜서 열 때 Excel 이 전부 계산하게 한다
 * (quote-template.ts 의 '재계산을 Excel 에 맡긴다').
 */
export function setFormula(sheetXml: string, ref: string, formula: string): string {
  return replaceCell(
    sheetXml,
    ref,
    (style) => `<c r="${ref}"${styleAttr(style)}><f>${escapeXmlText(formula)}</f></c>`
  );
}

/**
 * 셀의 **서식 번호(`s`)만** 바꾼다. 값·자료형·자식 요소는 글자 하나 안 건드린다.
 *
 * 파일 머리말의 "스타일 인덱스는 언제나 원본 것을 승계한다" 는 여전히 기본
 * 규칙이다. 이것은 그 예외를 위한 도구다 — **양식의 서식으로는 안 되는 것이
 * 딱 하나 있을 때**(검사·수리 보고서의 본문 칸이 `horizontal="center"` 라
 * 보고서 본문이 가운데 찍히는 것) 쓴다. 새 서식은 `addAlignedCellXfs` 가
 * 원본을 **복제해서** 만든 것이므로, 원본 `xf` 는 그대로 남고 그것을 쓰는 다른
 * 칸들도 그대로다.
 */
export function setCellStyle(sheetXml: string, ref: string, styleIndex: number): string {
  if (!Number.isInteger(styleIndex) || styleIndex < 0) {
    throw new Error(`서식 번호가 잘못됐습니다: ${String(styleIndex)}`);
  }
  const cell = findCell(sheetXml, ref);
  // 여는 태그는 첫 `>` 에서 끝난다 — 자체닫힘(`…/>`)이면 그것이 셀 전체다.
  const openEnd = cell.raw.indexOf(">") + 1;
  const open = cell.raw.slice(0, openEnd);
  const rest = cell.raw.slice(openEnd);

  const next = /\ss="[^"]*"/.test(open)
    ? open.replace(/\ss="[^"]*"/, ` s="${styleIndex}"`)
    : open.replace(/^<c(\s[^>]*?)?(\/?)>$/, (_all, attrs: string | undefined, slash: string) =>
        `<c${attrs ?? ""} s="${styleIndex}"${slash}>`
      );
  if (next === open && !new RegExp(`\\ss="${styleIndex}"`).test(open)) {
    throw new Error(`셀 ${ref} 에 서식 번호를 넣지 못했습니다: ${open}`);
  }
  return sheetXml.slice(0, cell.start) + next + rest + sheetXml.slice(cell.end);
}

/** 값을 지우고 서식만 남긴다. 양식에 박혀 있던 예시 문구를 없앨 때 쓴다. */
export function clearCell(sheetXml: string, ref: string): string {
  return replaceCell(sheetXml, ref, (style) => `<c r="${ref}"${styleAttr(style)}/>`);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
