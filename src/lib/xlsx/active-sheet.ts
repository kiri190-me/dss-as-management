import { ZipArchive } from "./zip-reader";
import { WORKBOOK_PART, WORKBOOK_RELS_PART } from "./workbook-parts";
import { decodeXmlCharacterData } from "./xml-entities";
import { writeZip, type ZipEntryInput } from "./zip-writer";

/**
 * ============================================================================
 * 통합문서에서 **그 시트 하나를 「활성」으로** 둔다 (2026-10-08)
 * ============================================================================
 * 양식 파일 하나에 시트가 여럿이다 — 내자 양식에는 `내자견적서` · `OH견적서` · `Sheet1`
 * 이 함께 들어 있고, 종류마다 **쓰는 시트가 다르다**(storage/quote-template.ts 의 표).
 *
 * ── 왜 필요한가 ─────────────────────────────────────────────────────────────
 * [저장]을 누르면 서버가 값을 채운 엑셀을 공유폴더에 꽂고, 그 PC 의 도우미가 Excel 로
 * **PDF 로 바꾼다**(server/quote-folder-helper.ts). 그 도우미가 예전에는 **통합문서
 * 전체**를 내보냈다 — 인쇄 영역이 잡힌 다른 시트가 함께 딸려 나가서, 내자 견적서를
 * 저장했는데 PDF 에 OH 장이 붙어 나갔다(사용자 요구 2026-10-08).
 *
 * 울타리를 **양쪽에** 친다:
 *   · 도우미는 **활성 시트만** 내보낸다(`$book.ActiveSheet.ExportAsFixedFormat`).
 *   · 🔴 **서버가 그 종류의 시트를 활성으로 두고 보낸다** — 이 모듈이 하는 일이다.
 * 🔵 덤으로, 사람이 그 엑셀을 열면 맞는 탭이 먼저 보인다.
 *
 * ── 무엇을 손보나 — 두 자리뿐이다 ───────────────────────────────────────────
 *  1. `xl/workbook.xml` 의 `bookViews/workbookView@activeTab` — 탭 차례의 **0부터** 센
 *     자리번호. OOXML 의 기본값이 0 이라 첫 탭이면 적지 않아도 되지만, **늘 적는다**
 *     (적지 않으면 「0 이라서 없는 것」과 「없어서 0 인 것」을 뒤에 읽는 쪽이 못 가린다).
 *  2. 그 시트의 `sheetView@tabSelected` 를 `1` 로, **다른 시트의 것은 뗀다.** 두 탭이
 *     함께 「골라진」 채로 열리면 엑셀이 둘을 묶음으로 다루고(사람이 한 탭에 적은 글자가
 *     다른 탭에도 적힌다), 활성 탭과 고른 탭이 어긋난 파일이 된다.
 *     (customer-portal-export-workbook.ts 의 `dropTabSelected` 가 같은 까닭으로 있다.)
 *
 * 그 밖의 파트는 **바이트 그대로** 옮긴다. 스타일 · 그림 · 공유문자열 · 손대지 않은
 * 시트들은 한 바이트도 달라지지 않는다.
 *
 * ── 🔴 같은 입력이면 같은 바이트 ────────────────────────────────────────────
 * 값을 꾸미는 자리가 하나도 없다 — 시각도, 무작위도, 지역 설정도 읽지 않는다. 활성 탭은
 * **양식 종류가 정하는 고정값**이므로 같은 견적서를 두 번 만들면 여전히 같은 바이트다
 * (zip-writer.ts 가 타임스탬프를 1980-01-01 로 고정한다). 한 번 더 걸어도 결과가
 * 달라지지 않는다(멱등) — 이미 활성인 시트를 다시 활성으로 두는 것뿐이다.
 * ============================================================================
 */

/** 사람에게 보여 줄 수 있는 실패 사유만 들고 나온다 — 경로 · 설정값을 담지 않는다. */
export class ActiveSheetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ActiveSheetError";
  }
}

type WorkbookSheet = {
  /** 사람이 보는 탭 이름(XML 이스케이프를 푼 것). */
  name: string;
  relId: string;
};

const SHEETS_BLOCK = /<sheets\b[^>]*>([\s\S]*?)<\/sheets>/;
const SHEET_TAG = /<sheet\b[^>]*\/?>/g;
const WORKBOOK_VIEW_TAG = /<workbookView\b[^>]*>/g;
const SHEET_VIEW_TAG = /<sheetView\b[^>]*>/g;

/**
 * 그 이름의 시트를 활성 탭으로 둔 통합문서 바이트.
 *
 * @throws ActiveSheetError 그 이름의 시트가 없거나, 통합문서를 읽지 못했을 때.
 */
export function setActiveSheet(bytes: Buffer, sheetName: string): Buffer {
  let archive: ZipArchive;
  try {
    archive = ZipArchive.fromBuffer(bytes);
  } catch {
    throw new ActiveSheetError("엑셀 통합문서(.xlsx)로 읽지 못했습니다.");
  }

  const workbookXml = readPart(archive, WORKBOOK_PART, "통합문서 정보");
  const relsXml = readPart(archive, WORKBOOK_RELS_PART, "통합문서 관계 정보");

  const sheets = parseWorkbookSheets(workbookXml);
  const index = sheets.findIndex((sheet) => sheet.name === sheetName);
  if (index < 0) throw new ActiveSheetError(`통합문서에 「${sheetName}」 시트가 없습니다.`);

  // 시트 파트는 **관계 id 로** 찾는다 — 이름으로 찾으면 이스케이프가 섞인 이름에서 어긋난다.
  const parts = sheets.map((sheet) => resolvePartForRelId(archive, relsXml, sheet.relId));
  const targetPart = parts[index];
  if (targetPart === null) {
    throw new ActiveSheetError(`통합문서에서 「${sheetName}」 시트의 자리를 찾지 못했습니다.`);
  }
  // 🔴 「고른 탭」 표시를 뗄 시트들 — 같은 파트를 둘이 가리키면 target 이 이긴다.
  const others = new Set<string>();
  parts.forEach((part, at) => {
    if (part !== null && at !== index && part !== targetPart) others.add(part);
  });

  const entries: ZipEntryInput[] = archive.listEntries().map((entry) => {
    const data = archive.readEntry(entry.name) ?? Buffer.alloc(0);
    if (entry.name === WORKBOOK_PART) {
      return { name: entry.name, data: utf8(withActiveTab(data.toString("utf8"), index)) };
    }
    if (entry.name === targetPart) {
      return { name: entry.name, data: utf8(withTabSelected(data.toString("utf8"))) };
    }
    if (others.has(entry.name)) {
      return { name: entry.name, data: utf8(withoutTabSelected(data.toString("utf8"))) };
    }
    // 그 밖은 바이트 그대로.
    return { name: entry.name, data };
  });

  return writeZip(entries);
}

/** `bookViews/workbookView@activeTab` — 탭 차례의 0부터. 없으면 0(첫 탭)이 OOXML 의 기본값이다. */
export function readActiveTabIndex(workbookXml: string): number {
  const view = /<workbookView\b[^>]*>/.exec(workbookXml)?.[0];
  const value = view === undefined ? undefined : /\sactiveTab="(\d+)"/.exec(view)?.[1];
  return value === undefined ? 0 : Number(value);
}

/** 그 시트가 「고른 탭」인가 — `sheetView@tabSelected` 가 1 인 것이 하나라도 있는가. */
export function hasTabSelected(sheetXml: string): boolean {
  for (const tag of sheetXml.matchAll(SHEET_VIEW_TAG)) {
    if (/\stabSelected="(?:1|true)"/.test(tag[0])) return true;
  }
  return false;
}

/** 탭 차례대로의 시트 이름과 관계 id. */
export function parseWorkbookSheets(workbookXml: string): WorkbookSheet[] {
  const block = SHEETS_BLOCK.exec(workbookXml);
  if (!block) return [];
  const sheets: WorkbookSheet[] = [];
  for (const match of block[1].matchAll(SHEET_TAG)) {
    const name = /\sname="([^"]*)"/.exec(match[0])?.[1];
    const relId = /\sr:id="([^"]*)"/.exec(match[0])?.[1];
    if (name === undefined || relId === undefined) continue;
    sheets.push({ name: decodeXmlCharacterData(name), relId });
  }
  return sheets;
}

// ── 통합문서 · 시트 손보기 ────────────────────────────────────────────────

/**
 * `activeTab` 을 그 자리번호로. `<workbookView>` 가 여럿이면(창마다 하나) **전부** 맞춘다 —
 * 하나만 고치면 어느 창으로 열렸느냐에 따라 다른 탭이 활성이 된다.
 *
 * 🔴 `<bookViews>` 자체가 없는 통합문서에는 **만들어 넣는다.** OOXML 의 `CT_Workbook` 은
 * `bookViews` 가 `sheets` **앞**이라 자리를 그렇게 잡는다 — 뒤에 붙이면 엑셀이 파일을 거부한다.
 */
function withActiveTab(workbookXml: string, index: number): string {
  if (/<workbookView\b/.test(workbookXml)) {
    return workbookXml.replace(WORKBOOK_VIEW_TAG, (tag) => withAttribute(tag, "activeTab", String(index)));
  }
  const sheets = /<sheets\b[^>]*>/.exec(workbookXml);
  if (!sheets) throw new ActiveSheetError("통합문서에서 탭 목록을 찾지 못했습니다.");
  return (
    workbookXml.slice(0, sheets.index) +
    `<bookViews><workbookView activeTab="${index}"/></bookViews>` +
    workbookXml.slice(sheets.index)
  );
}

/**
 * 그 시트를 「고른 탭」으로. `<sheetView>` 가 여럿이면 **첫째에만** 붙이고 나머지는 뗀다 —
 * 한 시트 안에서도 고른 창이 둘이면 엑셀이 묶음으로 다룬다.
 */
function withTabSelected(sheetXml: string): string {
  if (!/<sheetView\b/.test(sheetXml)) return withInsertedSheetViews(sheetXml);
  let seen = 0;
  return sheetXml.replace(SHEET_VIEW_TAG, (tag) => {
    seen += 1;
    return seen === 1 ? withAttribute(tag, "tabSelected", "1") : withoutAttribute(tag, "tabSelected");
  });
}

/** 「고른 탭」 표시를 뗀다. 없으면 그대로다 — 없던 것을 만들지 않는다. */
function withoutTabSelected(sheetXml: string): string {
  return sheetXml.replace(SHEET_VIEW_TAG, (tag) => withoutAttribute(tag, "tabSelected"));
}

/**
 * `<sheetViews>` 가 아예 없는 시트에 한 벌 만들어 넣는다.
 *
 * 🔴 자리가 중요하다 — OOXML 의 `CT_Worksheet` 는 `sheetPr` → `dimension` → `sheetViews`
 * 차례를 요구한다. 그래서 그 둘이 있으면 **그 뒤**, 없으면 `<worksheet>` 여는 태그 바로
 * 뒤에 넣는다. 차례가 어긋나면 엑셀이 「복구할 수 없는 내용」으로 파일을 고치려 든다.
 */
function withInsertedSheetViews(sheetXml: string): string {
  const open = /<worksheet\b[^>]*>/.exec(sheetXml);
  if (!open) throw new ActiveSheetError("시트에서 <worksheet> 를 찾지 못했습니다.");

  let at = open.index + open[0].length;
  for (const pattern of [/<sheetPr\b[^>]*\/>/, /<\/sheetPr>/, /<dimension\b[^>]*\/?>/]) {
    const found = pattern.exec(sheetXml);
    if (found) at = Math.max(at, found.index + found[0].length);
  }
  return (
    sheetXml.slice(0, at) +
    '<sheetViews><sheetView tabSelected="1" workbookViewId="0"/></sheetViews>' +
    sheetXml.slice(at)
  );
}

/** 태그에 속성을 넣거나 갈아 끼운다. 자체닫힘(`/>`)과 여는 태그(`>`) 둘 다. */
function withAttribute(tag: string, name: string, value: string): string {
  const pattern = new RegExp(`\\s${name}="[^"]*"`);
  if (pattern.test(tag)) return tag.replace(pattern, ` ${name}="${value}"`);
  const selfClosing = tag.endsWith("/>");
  const body = tag.slice(0, selfClosing ? -2 : -1).replace(/\s+$/, "");
  return `${body} ${name}="${value}"${selfClosing ? "/>" : ">"}`;
}

/** 태그에서 그 속성을 뗀다. 없으면 그대로다. */
function withoutAttribute(tag: string, name: string): string {
  return tag.replace(new RegExp(`\\s${name}="[^"]*"`), "");
}

// ── 잔심부름 ─────────────────────────────────────────────────────────────

function readPart(archive: ZipArchive, part: string, label: string): string {
  const text = archive.readTextOrNull(part);
  if (text === null) throw new ActiveSheetError(`통합문서에서 ${label}를 읽지 못했습니다.`);
  return text;
}

/** 관계 id → 시트 파트 경로. 못 찾으면 null(그 시트는 건드리지 않는다). */
function resolvePartForRelId(archive: ZipArchive, relsXml: string, relId: string): string | null {
  const tag = new RegExp(`<Relationship\\b[^>]*Id="${escapeRegExp(relId)}"[^>]*>`).exec(relsXml)?.[0];
  const target = tag === undefined ? undefined : /\sTarget="([^"]+)"/.exec(tag)?.[1];
  if (target === undefined) return null;
  const decoded = decodeXmlCharacterData(target);
  const part = decoded.startsWith("/") ? decoded.slice(1) : `xl/${decoded}`;
  return archive.has(part) ? part : null;
}

function utf8(text: string): Buffer {
  return Buffer.from(text, "utf8");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
