import type { CustomerPortalForm } from "@/lib/domain/customer-portal-forms";
import {
  normalizePortalExportHeader,
  type CustomerPortalExportSpec,
  type PortalExportCell,
} from "@/lib/domain/customer-portal-export";

import {
  buildSheetGrid,
  columnLettersToNumber,
  columnNumberToLetters,
  parseSharedStringsWithoutPhonetics,
  readDate1904,
} from "./sheet-grid";
import { escapeXmlText, toExcelSerialDate } from "./sheet-patch";
import {
  cloneRowMergeCells,
  parseSheetRows,
  resizeRowBlock,
  shiftMergeCellRows,
  shiftSqrefRows,
  syncDimension,
  writeSheetRows,
  type SheetRow,
} from "./sheet-rows";
import {
  CONTENT_TYPES_PART,
  SHARED_STRINGS_PART,
  STYLES_PART,
  WORKBOOK_PART,
  WORKBOOK_RELS_PART,
  createWrapTextCellXfs,
  type WrapTextCellXfs,
} from "./workbook-parts";
import { decodeXmlCharacterData } from "./xml-entities";
import { ZipArchive } from "./zip-reader";
import { writeZip } from "./zip-writer";

/**
 * ============================================================================
 * 고객사 양식 현황표를 **직전 파일에 이어** 엑셀로 쓴다
 * ============================================================================
 * 들어오는 것은 공유폴더에서 읽은 **직전 파일의 바이트**와 이번에 넣을 줄들이다.
 * 나가는 것은 새 이름으로 저장할 바이트 하나. 디스크 · DB · 요청을 모른다.
 *
 * ── 🔴 양식을 새로 그리지 않는다 ─────────────────────────────────────────
 * 색 · 열 너비 · 테두리 · 병합 · 인쇄 설정은 전부 그 고객사가 쓰던 파일 것이다. 우리가
 * 하는 일은 **줄 수를 맞추고 값을 갈아 끼우는 것**뿐이다. 직전 파일이 없으면 만들지
 * 않는다(그 판단은 부르는 쪽이 한다 — 없는 서식을 지어내면 고객사로 나간다).
 *
 * ── 🔴 JUSUNG — 옛 탭은 한 글자도 바뀌지 않는다 ───────────────────────────
 * 새 탭은 가장 새 탭(= 탭 차례의 **첫째**)을 **베껴서** 만들고, 베낀 원본 파트는
 * 손대지 않는다. 그래서 84장이 85장이 되고 옛 84장의 바이트는 그대로다.
 * 새 탭은 맨 **앞**에 들어간다(이 파일들은 최신이 앞이다).
 *
 *   🔴 탭을 앞에 끼우면 `<definedName localSheetId="36">` 의 번호가 전부 하나씩
 *   밀린다 — 그 번호는 시트 차례의 자리번호다. 안 밀면 숨은 이름(_FilterDatabase)이
 *   **엉뚱한 시트**를 가리킨다. `<workbookView activeTab>` 도 같이 민다(열었을 때
 *   보이던 탭이 그대로 보이게).
 *
 * ── 🔴 하루에 한 탭 — 같은 날 다시 저장하면 **갈아 끼운다** ────────────────
 * 탭 이름은 만든 날짜(`YYMMDD`)다. 저장할 때마다 탭을 더하면 같은 날 두 번 누른 순간
 * `260930` 탭이 둘이 되는데, **엑셀은 같은 이름의 탭을 허용하지 않는다** — 그 파일은
 * 열리지 않거나 「복구할 수 없는 내용」이 뜬다(2026-09-30 실측: 세 번 저장한 파일의
 * 앞 세 탭이 전부 `260930` 이었다).
 *
 * 그래서 오늘 날짜 탭이 **이미 있으면** 더하지 않고 그 탭을 본으로 삼아 **그 자리에서**
 * 갈아 끼운다. 자리(맨 앞)도 이름도 그대로고, 옛 탭은 여전히 한 바이트도 바뀌지 않는다.
 * 사람이 쌓아 온 것은 주 1회 한 장씩이다 — 하루에 여러 장이 필요했던 적이 없다.
 *
 * ── 🔴 이미 깨진 파일은 **거절한다** ─────────────────────────────────────
 * 직전 파일에 이름이 겹치는 탭이 있으면 읽지 않고 사람에게 알린다. 고치지도 지우지도
 * 않는다:
 *   · 겹친 탭 가운데 **어느 것이 진짜인지 우리가 모른다.** 엑셀이 열지 못하는 파일이라
 *     사람도 아직 본 적이 없다.
 *   · 조용히 하나만 쓰면 나머지 겹침이 그 파일에 그대로 남고, **깨진 파일이 공유폴더에
 *     있다는 사실을 사람이 영영 모른다.** 그 파일은 이미 고객사로 나갔을 수도 있다.
 *   · 탭을 지우는 것은 `definedName` 의 자리번호 · 수식을 함께 고쳐야 하는 수술이고,
 *     실패하면 두 번째 깨진 파일이 생긴다. 「직전 파일이 없습니다」와 같은 갈래로
 *     사람에게 돌려준다(services/customer-portal-export.ts 머리말).
 *
 * ── 어떤 칸으로 적는가 ──────────────────────────────────────────────────
 * 값은 도메인이 «글자 · 숫자 · 날짜 · 빈칸» 으로만 알려 준다. 실제로 어떤 칸이 되는지는
 * **그 자리에 원래 있던 칸의 서식**이 정한다:
 *   · 날짜 값 + 날짜 서식 칸  → 날짜(일련번호). 그 칸의 서식이 그대로 먹는다.
 *   · 날짜 값 + 그 밖의 칸    → 글자 그대로(`2026-09-15`).
 *   · 그 밖에는 전부 **글자**(inlineStr).
 *
 * ── 🔴 한 칸 안에 여러 줄 — 값만으로는 모자라다 (2026-10-07) ──────────────
 * 견적서 번호는 한 건에 여럿일 수 있어 **줄바꿈으로 이어** 한 칸에 들어온다
 * (db/queries/customer-portal.ts 의 quoteNumber). 그런데 **칸의 서식에 「자동 줄 바꿈」이
 * 꺼져 있으면 엑셀은 그것을 한 줄로 보여 준다** — 값은 멀쩡한데 사람 눈에는 번호 하나만
 * 보인다. 그래서 줄바꿈이 든 칸은 그 자리에 있던 서식의 **사본에 wrapText 를 켜서** 쓴다
 * (workbook-parts.ts 의 createWrapTextCellXfs). 사본은 styles.xml 맨 뒤에 붙으므로 기존
 * 서식 번호가 하나도 밀리지 않는다 — 옛 탭과 다른 칸들은 그대로다.
 *
 * 🔴 숫자처럼 보이는 글자를 숫자로 바꾸지 않는다. S/N `0012345` 가 `12345` 가 되기
 * 때문이다 — 고객사 표에서 그것은 다른 물건이다. 엑셀이 「숫자가 글자로 있다」는
 * 초록 표시를 띄울 수 있지만, 값이 바뀌는 것보다 낫다. 줄 번호만 숫자다(도메인이
 * 숫자로 준다).
 *
 * ── 병합은 밀고, 겹치면 버린다 ──────────────────────────────────────────
 * 줄이 늘거나 줄면 그 아래 병합도 함께 민다(엑셀에서 사람이 줄을 끼운 것과 같다).
 * 줄어들 때 아래쪽 병합이 위로 밀려 **다른 병합과 겹칠 수** 있는데, 겹치거나 똑같은
 * 병합이 둘 있는 시트는 엑셀이 파일 열기를 거부한다. 그래서 마지막에 한 번
 * 훑어 겹치는 것을 버린다(`sanitizeMergeCells`).
 * ============================================================================
 */

/** 사람에게 그대로 보일 실패 사유를 들고 나온다. 경로 · 설정값을 담지 않는다. */
export class CustomerPortalExportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CustomerPortalExportError";
  }
}

const WORKSHEET_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml";
const WORKSHEET_RELATIONSHIP_TYPE =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet";

/** 시트 이름 상한(엑셀 규격). 넘으면 엑셀이 파일을 거부한다. */
const MAX_SHEET_NAME_LENGTH = 31;

/** 표 한 장에 담을 수 있는 줄 수의 상한 — 폭주 방지다(현황표는 수십 줄이다). */
export const PORTAL_EXPORT_MAX_ROWS = 2000;

export type CustomerPortalExportResult = {
  bytes: Buffer;
  /** 값이 들어간 탭의 이름. 미리보기가 이 이름으로 그 탭을 다시 읽는다. */
  sheetName: string;
  /** 본으로 삼은 탭의 이름. */
  modelSheetName: string;
  /** 직전 파일의 표에 있던 줄 수. */
  previousRowCount: number;
  /** 이번에 적은 줄 수. */
  rowCount: number;
};

export type CustomerPortalExportInput = {
  /** 공유폴더에서 읽은 **직전 파일**의 바이트. */
  previousBytes: Buffer;
  form: CustomerPortalForm;
  spec: CustomerPortalExportSpec;
  rows: readonly PortalExportCell[][];
  /** 만든 날짜 `YYMMDD` — 탭 이름이 된다. */
  stamp: string;
  /** 만든 날짜 — JUSUNG 의 `N1` 에 적는다. */
  today: Date;
};

export function buildCustomerPortalExportWorkbook(
  input: CustomerPortalExportInput
): CustomerPortalExportResult {
  if (input.rows.length > PORTAL_EXPORT_MAX_ROWS) {
    throw new CustomerPortalExportError(
      `표가 너무 깁니다(${input.rows.length}줄) — ${PORTAL_EXPORT_MAX_ROWS}줄까지만 내보낼 수 있습니다.`
    );
  }

  let archive: ZipArchive;
  try {
    archive = ZipArchive.fromBuffer(input.previousBytes);
  } catch {
    throw new CustomerPortalExportError("직전 파일을 엑셀 통합문서(.xlsx)로 읽지 못했습니다.");
  }
  if (archive.hasDuplicateEntryNames()) {
    throw new CustomerPortalExportError("직전 파일 안에 같은 이름의 부품이 둘 있습니다(파일이 손상된 것 같습니다).");
  }

  const workbookXml = requirePart(archive, WORKBOOK_PART, "통합문서 정보");
  const workbookRelsXml = requirePart(archive, WORKBOOK_RELS_PART, "통합문서 관계 정보");
  const contentTypesXml = requirePart(archive, CONTENT_TYPES_PART, "내용 형식 목록");

  const sheets = parseWorkbookSheets(workbookXml);
  if (sheets.length === 0) throw new CustomerPortalExportError("직전 파일에 시트가 하나도 없습니다.");
  assertPreviousSheetNamesAreUnique(sheets);

  // 🔴 같은 날 두 번째 저장이면 탭을 **더하지 않고** 오늘 탭을 갈아 끼운다(머리말).
  const sameDaySheet = findSameDaySheet(sheets, input.spec, input.stamp);
  const placementKind: PlacementKind = sameDaySheet === null ? input.spec.placement.kind : "REPLACE";

  const model = sameDaySheet ?? pickModelSheet(sheets, input.spec);
  const modelPart = resolvePartForRelId(archive, workbookRelsXml, model.relId, model.name);
  const modelSheetXml = archive.readText(modelPart);

  const sharedStrings = parseSharedStringsWithoutPhonetics(archive.readTextOrNull(SHARED_STRINGS_PART));
  const stylesXml = archive.readTextOrNull(STYLES_PART);
  const dateStyles = readDateStyleIndexes(stylesXml);
  const date1904 = readDate1904(workbookXml);
  // 🔴 줄바꿈이 든 칸에 켜 줄 「자동 줄 바꿈」 서식(머리말 「한 칸 안에 여러 줄」).
  const wrapStyles = createWrapTextCellXfs(stylesXml);

  const rebuilt = rebuildSheet({
    sheetXml: modelSheetXml,
    sharedStrings,
    spec: input.spec,
    form: input.form,
    rows: input.rows,
    dateStyles,
    date1904,
    today: input.today,
    wrapStyles,
  });

  const newSheetName = placementKind === "REPLACE" ? model.name : sheetNameFromStamp(input.stamp);

  const replacements = new Map<string, Buffer>();
  const additions: { name: string; data: Buffer }[] = [];
  let nextWorkbookXml = workbookXml;
  let nextContentTypesXml = contentTypesXml;
  let nextWorkbookRelsXml = workbookRelsXml;

  if (placementKind === "PREPEND_COPY") {
    // 🔴 본 파트는 건드리지 않는다 — 새 파트를 하나 만들어 맨 앞 탭으로 끼운다.
    const newPart = unusedWorksheetPart(archive);
    const newRelId = unusedRelationshipId(workbookRelsXml);
    // 🔴 베낀 탭에서 「고른 탭」 표시를 뗀다. 두 탭이 함께 「골라진」 채로 열리면 엑셀이
    //    둘을 묶음으로 다루어, 사람이 한 탭에 적은 글자가 다른 탭에도 적힌다.
    additions.push({ name: newPart, data: Buffer.from(dropTabSelected(rebuilt.xml), "utf8") });
    nextWorkbookRelsXml = addWorksheetRelationship(workbookRelsXml, newRelId, newPart);
    nextContentTypesXml = addWorksheetOverride(contentTypesXml, newPart);
    nextWorkbookXml = prependSheet(workbookXml, {
      name: newSheetName,
      sheetId: nextSheetId(sheets),
      relId: newRelId,
    });
  } else {
    replacements.set(modelPart, Buffer.from(rebuilt.xml, "utf8"));
    if (placementKind === "REPLACE_AND_RENAME" && newSheetName !== model.name) {
      nextWorkbookXml = renameSheet(workbookXml, model, newSheetName);
    }
  }

  // 자동 필터의 숨은 이름(_xlnm._FilterDatabase)을 새 범위 · 새 이름에 맞춘다.
  // 🔴 탭을 앞에 끼웠으면 그 이름들의 시트 자리번호가 하나씩 밀려 있다(위 머리말).
  if (placementKind === "PREPEND_COPY") {
    nextWorkbookXml = shiftDefinedNameLocalSheetIds(nextWorkbookXml, 1);
    nextWorkbookXml = shiftActiveTab(nextWorkbookXml, 1);
  } else if (rebuilt.autoFilterRef !== null) {
    nextWorkbookXml = updateFilterDatabase(nextWorkbookXml, {
      localSheetId: model.index,
      sheetName: newSheetName,
      ref: rebuilt.autoFilterRef,
    });
  }

  replacements.set(WORKBOOK_PART, Buffer.from(nextWorkbookXml, "utf8"));
  // 🔴 서식 사본을 **맨 뒤에** 더했으므로 기존 번호는 하나도 밀리지 않는다 — 옛 탭들의
  //    칸이 가리키던 서식은 그대로다(머리말 「옛 탭은 한 글자도 바뀌지 않는다」와 같은 규율).
  const nextStylesXml = wrapStyles.stylesXml();
  if (nextStylesXml !== null) replacements.set(STYLES_PART, Buffer.from(nextStylesXml, "utf8"));
  if (nextContentTypesXml !== contentTypesXml) {
    replacements.set(CONTENT_TYPES_PART, Buffer.from(nextContentTypesXml, "utf8"));
  }
  if (nextWorkbookRelsXml !== workbookRelsXml) {
    replacements.set(WORKBOOK_RELS_PART, Buffer.from(nextWorkbookRelsXml, "utf8"));
  }

  // 🔴 나가는 파일에 같은 이름의 탭이 없는가. 있으면 엑셀이 열지 못한다 — 여기서 멈추는
  //    편이 그 파일이 공유폴더에 쌓이는 것보다 낫다(이 버그가 실제로 일어났다).
  assertBuiltSheetNamesAreUnique(nextWorkbookXml);

  return {
    bytes: repackage(archive, replacements, additions),
    sheetName: newSheetName,
    modelSheetName: model.name,
    previousRowCount: rebuilt.previousRowCount,
    rowCount: input.rows.length,
  };
}

function requirePart(archive: ZipArchive, part: string, label: string): string {
  const text = archive.readTextOrNull(part);
  if (text === null) throw new CustomerPortalExportError(`직전 파일에서 ${label}를 읽지 못했습니다.`);
  return text;
}

// ── 통합문서의 시트 목록 ──────────────────────────────────────────────────

type WorkbookSheet = {
  /** `<sheet …/>` 태그 전체. */
  raw: string;
  /** 사람이 보는 탭 이름(XML 이스케이프를 푼 것). */
  name: string;
  sheetId: number;
  relId: string;
  /** 탭 차례의 자리번호(0부터) — `definedName localSheetId` 가 세는 번호와 같다. */
  index: number;
};

const SHEETS_BLOCK = /<sheets\b[^>]*>([\s\S]*?)<\/sheets>/;

export function parseWorkbookSheets(workbookXml: string): WorkbookSheet[] {
  const block = SHEETS_BLOCK.exec(workbookXml);
  if (!block) return [];
  const sheets: WorkbookSheet[] = [];
  for (const match of block[1].matchAll(/<sheet\b[^>]*\/?>/g)) {
    const raw = match[0];
    const name = /\sname="([^"]*)"/.exec(raw)?.[1];
    const relId = /\sr:id="([^"]*)"/.exec(raw)?.[1];
    if (name === undefined || relId === undefined) continue;
    sheets.push({
      raw,
      name: decodeXmlCharacterData(name),
      sheetId: Number(/\ssheetId="(\d+)"/.exec(raw)?.[1] ?? "0"),
      relId,
      index: sheets.length,
    });
  }
  return sheets;
}

type PlacementKind = CustomerPortalExportSpec["placement"]["kind"];

/**
 * 🔴 **같은 날 두 번째 저장인가** — 오늘 날짜(`stamp`) 탭이 이미 있으면 그 탭을 돌려준다.
 *
 * 있으면 부르는 쪽이 탭을 더하지 않고 **그 탭을 그 자리에서** 갈아 끼운다(머리말).
 * 이름으로 찾는다 — 자리로 찾지 않는다. 사람이 탭 차례를 손봤어도 오늘 탭은 하나뿐이다.
 *
 * 탭을 쌓지 않는 양식(ICD · INVENIA)은 볼 것이 없다: ICD 는 이름 고정 탭 하나를 늘 덮어
 * 쓰고, INVENIA 는 탭 하나의 이름을 오늘 날짜로 바꿀 뿐이라 같은 날 다시 저장해도
 * 이름이 이미 오늘이라 그대로 덮어쓰인다. 애초에 이 버그가 없다(실측 확인).
 */
function findSameDaySheet(
  sheets: readonly WorkbookSheet[],
  spec: CustomerPortalExportSpec,
  stamp: string
): WorkbookSheet | null {
  if (spec.placement.kind !== "PREPEND_COPY") return null;
  const todayName = sheetNameFromStamp(stamp);
  return sheets.find((sheet) => sheet.name === todayName) ?? null;
}

/** 이름이 겹치는 탭들. 엑셀은 같은 이름의 탭을 허용하지 않는다 — 있으면 그 파일은 깨진 것이다. */
function duplicateSheetNames(sheets: readonly WorkbookSheet[]): string[] {
  const seen = new Set<string>();
  const duplicated = new Set<string>();
  for (const sheet of sheets) {
    if (seen.has(sheet.name)) duplicated.add(sheet.name);
    seen.add(sheet.name);
  }
  return [...duplicated];
}

/**
 * 🔴 이미 깨진 직전 파일은 **읽지 않고 거절한다.** 까닭은 머리말 「이미 깨진 파일」.
 * 고치지도 지우지도 않고, 사람이 읽을 수 있는 사유 하나만 들고 나온다.
 */
function assertPreviousSheetNamesAreUnique(sheets: readonly WorkbookSheet[]): void {
  const duplicated = duplicateSheetNames(sheets);
  if (duplicated.length === 0) return;
  throw new CustomerPortalExportError(
    `직전 파일에 이름이 같은 탭이 둘 이상 있습니다(${duplicated.join(" · ")}) — 엑셀이 열지 못하는 파일입니다. ` +
      "그 파일을 공유폴더에서 치운 뒤(지우지 마시고 OLD 폴더 등으로 옮겨 주세요) 다시 시도해 주세요. " +
      "저희가 고치거나 지우지는 않습니다."
  );
}

/** 🔴 나가는 파일의 불변식. 여기서 걸리면 우리 잘못이라 사람이 할 수 있는 일이 없다. */
function assertBuiltSheetNamesAreUnique(workbookXml: string): void {
  const duplicated = duplicateSheetNames(parseWorkbookSheets(workbookXml));
  if (duplicated.length === 0) return;
  throw new CustomerPortalExportError(
    `만드는 중에 이름이 같은 탭이 생겨(${duplicated.join(" · ")}) 파일을 만들지 않았습니다 — 관리자에게 알려 주세요.`
  );
}

function pickModelSheet(sheets: readonly WorkbookSheet[], spec: CustomerPortalExportSpec): WorkbookSheet {
  if (spec.modelSheet.kind === "NAME") {
    const wanted = spec.modelSheet.name;
    const found = sheets.find((sheet) => sheet.name === wanted);
    if (!found) {
      throw new CustomerPortalExportError(`직전 파일에 「${wanted}」 탭이 없습니다 — 파일을 확인해 주세요.`);
    }
    return found;
  }
  // 최신이 앞이다(실측) — 첫 탭이 「가장 최근」이다.
  return sheets[0];
}

/** 관계 id 로 시트 파트 경로를 찾는다. 이름으로 찾지 않는다(이름에 이스케이프가 섞인다). */
function resolvePartForRelId(archive: ZipArchive, relsXml: string, relId: string, sheetName: string): string {
  const tag = new RegExp(`<Relationship\\b[^>]*Id="${escapeRegExp(relId)}"[^>]*>`).exec(relsXml)?.[0];
  const target = tag === undefined ? undefined : /\sTarget="([^"]+)"/.exec(tag)?.[1];
  if (target === undefined) {
    throw new CustomerPortalExportError(`직전 파일에서 「${sheetName}」 탭의 자리를 찾지 못했습니다.`);
  }
  const decoded = decodeXmlCharacterData(target);
  const part = decoded.startsWith("/") ? decoded.slice(1) : `xl/${decoded}`;
  if (!archive.has(part)) {
    throw new CustomerPortalExportError(`직전 파일에 「${sheetName}」 탭의 내용이 없습니다.`);
  }
  return part;
}

function nextSheetId(sheets: readonly WorkbookSheet[]): number {
  return sheets.reduce((max, sheet) => Math.max(max, sheet.sheetId), 0) + 1;
}

function sheetNameFromStamp(stamp: string): string {
  if (stamp.length > MAX_SHEET_NAME_LENGTH) {
    throw new CustomerPortalExportError("탭 이름이 너무 깁니다.");
  }
  return stamp;
}

// ── 통합문서 손보기 ──────────────────────────────────────────────────────

function prependSheet(
  workbookXml: string,
  sheet: { name: string; sheetId: number; relId: string }
): string {
  const tag = `<sheet name="${escapeXmlAttribute(sheet.name)}" sheetId="${sheet.sheetId}" r:id="${escapeXmlAttribute(
    sheet.relId
  )}"/>`;
  const opened = /<sheets\b[^>]*>/.exec(workbookXml);
  if (!opened) throw new CustomerPortalExportError("직전 파일에서 탭 목록을 찾지 못했습니다.");
  const at = opened.index + opened[0].length;
  return workbookXml.slice(0, at) + tag + workbookXml.slice(at);
}

function renameSheet(workbookXml: string, sheet: WorkbookSheet, newName: string): string {
  const renamed = sheet.raw.replace(/\sname="[^"]*"/, ` name="${escapeXmlAttribute(newName)}"`);
  let next = workbookXml.replace(sheet.raw, renamed);
  // 🔴 이름이 바뀌면 그 이름을 부르던 정의된 이름(인쇄 영역 · _FilterDatabase)도 함께
  //    바뀌어야 한다. 안 바꾸면 엑셀이 「복구할 수 없는 내용」으로 파일을 고치려 든다.
  next = next.replace(/<definedName\b[^>]*>([\s\S]*?)<\/definedName>/g, (whole, body: string) => {
    const replaced = replaceSheetReference(body, sheet.name, newName);
    return replaced === body ? whole : whole.replace(body, replaced);
  });
  return next;
}

/** `'260929'!$B$3:$L$10` · `Sheet1!A1` 의 시트 이름만 갈아 끼운다. */
function replaceSheetReference(reference: string, oldName: string, newName: string): string {
  const quoted = `'${oldName.replace(/'/g, "''")}'!`;
  if (reference.startsWith(quoted)) {
    return `${quoteSheetName(newName)}!${reference.slice(quoted.length)}`;
  }
  const plain = `${oldName}!`;
  if (reference.startsWith(plain)) {
    return `${quoteSheetName(newName)}!${reference.slice(plain.length)}`;
  }
  return reference;
}

/** 수식 · 정의된 이름에서 쓰는 시트 이름 표기. 글자 · 밑줄로만 된 이름이 아니면 따옴표. */
function quoteSheetName(name: string): string {
  return /^[A-Za-z_][A-Za-z0-9_.]*$/.test(name) ? name : `'${name.replace(/'/g, "''")}'`;
}

/**
 * 정의된 이름들의 시트 자리번호를 민다 — 탭을 **앞에** 끼웠을 때만 부른다.
 * `localSheetId` 는 시트 차례의 자리번호이므로 앞에 하나가 끼면 전부 하나씩 밀린다.
 */
function shiftDefinedNameLocalSheetIds(workbookXml: string, delta: number): string {
  if (delta === 0) return workbookXml;
  return workbookXml.replace(/(<definedName\b[^>]*?\slocalSheetId=")(\d+)(")/g, (_whole, head, value: string, tail) => {
    return `${head}${Number(value) + delta}${tail}`;
  });
}

/** 열었을 때 보이던 탭이 그대로 보이게 — 탭을 앞에 끼운 만큼 민다. */
function shiftActiveTab(workbookXml: string, delta: number): string {
  if (delta === 0) return workbookXml;
  return workbookXml.replace(/(<workbookView\b[^>]*?\sactiveTab=")(\d+)(")/g, (_whole, head, value: string, tail) => {
    return `${head}${Number(value) + delta}${tail}`;
  });
}

/**
 * 그 시트의 `_xlnm._FilterDatabase`(자동 필터가 남기는 숨은 이름)를 새 범위로 맞춘다.
 * 없으면 아무것도 하지 않는다 — 없던 이름을 만들어 주지 않는다.
 */
function updateFilterDatabase(
  workbookXml: string,
  params: { localSheetId: number; sheetName: string; ref: CellRange }
): string {
  const body = `${quoteSheetName(params.sheetName)}!$${params.ref.startColumn}$${params.ref.startRow}:$${
    params.ref.endColumn
  }$${params.ref.endRow}`;
  return workbookXml.replace(
    /<definedName\b[^>]*\sname="_xlnm\._FilterDatabase"[^>]*>[\s\S]*?<\/definedName>/g,
    (whole) => {
      const id = /\slocalSheetId="(\d+)"/.exec(whole)?.[1];
      if (id === undefined || Number(id) !== params.localSheetId) return whole;
      return whole.replace(/>([\s\S]*?)<\/definedName>/, `>${escapeXmlText(body)}</definedName>`);
    }
  );
}

function addWorksheetRelationship(relsXml: string, relId: string, part: string): string {
  const target = part.startsWith("xl/") ? part.slice("xl/".length) : `/${part}`;
  const tag = `<Relationship Id="${escapeXmlAttribute(relId)}" Type="${WORKSHEET_RELATIONSHIP_TYPE}" Target="${escapeXmlAttribute(
    target
  )}"/>`;
  if (!relsXml.includes("</Relationships>")) {
    throw new CustomerPortalExportError("직전 파일의 관계 정보를 손보지 못했습니다.");
  }
  return relsXml.replace("</Relationships>", `${tag}</Relationships>`);
}

function addWorksheetOverride(contentTypesXml: string, part: string): string {
  const tag = `<Override PartName="/${escapeXmlAttribute(part)}" ContentType="${WORKSHEET_CONTENT_TYPE}"/>`;
  if (!contentTypesXml.includes("</Types>")) {
    throw new CustomerPortalExportError("직전 파일의 내용 형식 목록을 손보지 못했습니다.");
  }
  return contentTypesXml.replace("</Types>", `${tag}</Types>`);
}

function unusedWorksheetPart(archive: ZipArchive): string {
  for (let index = 1; index <= 10_000; index += 1) {
    const candidate = `xl/worksheets/sheet${index}.xml`;
    if (!archive.has(candidate)) return candidate;
  }
  throw new CustomerPortalExportError("새 탭을 넣을 자리를 찾지 못했습니다.");
}

function unusedRelationshipId(relsXml: string): string {
  let max = 0;
  for (const match of relsXml.matchAll(/\sId="rId(\d+)"/g)) max = Math.max(max, Number(match[1]));
  return `rId${max + 1}`;
}

// ── 시트 다시 쓰기 ───────────────────────────────────────────────────────

type CellRange = { startColumn: string; startRow: number; endColumn: string; endRow: number };

type RebuiltSheet = {
  xml: string;
  previousRowCount: number;
  autoFilterRef: CellRange | null;
};

function rebuildSheet(params: {
  sheetXml: string;
  sharedStrings: readonly string[];
  spec: CustomerPortalExportSpec;
  form: CustomerPortalForm;
  rows: readonly PortalExportCell[][];
  dateStyles: ReadonlySet<number>;
  date1904: boolean;
  today: Date;
  wrapStyles: WrapTextCellXfs;
}): RebuiltSheet {
  const { spec, form } = params;
  const firstColumnNumber = columnLettersToNumber(spec.firstColumn);
  const grid = buildSheetGrid(params.sheetXml, params.sharedStrings, params.date1904);

  verifyHeader(grid, spec, form, firstColumnNumber);

  const previousRowCount = countDataRows(grid, spec.headerRow, spec.firstColumn);
  const targetCount = params.rows.length;
  const firstDataRow = spec.headerRow + 1;
  if (previousRowCount === 0 && targetCount > 0) {
    throw new CustomerPortalExportError(
      "직전 파일의 표에 줄이 하나도 없어 새 줄의 서식을 물려받을 수 없습니다 — 표에 줄을 하나 남겨 주세요."
    );
  }

  const originalRows = parseSheetRows(params.sheetXml);
  const resized = resizeRowBlock(originalRows, {
    firstRow: firstDataRow,
    currentCount: previousRowCount,
    targetCount,
  });

  // 값 채우기 — 줄 번호는 머리글 바로 아래부터 차례대로다.
  let rows = resized.rows;
  for (let index = 0; index < targetCount; index += 1) {
    const rowNumber = firstDataRow + index;
    rows = writeRowValues(rows, rowNumber, {
      firstColumnNumber,
      values: params.rows[index],
      dateStyles: params.dateStyles,
      date1904: params.date1904,
      wrapStyles: params.wrapStyles,
    });
  }

  // 그 주의 날짜(JUSUNG 의 N1). 머리글 위라 줄 밀기와 무관하다.
  if (spec.dateCell !== undefined) {
    const target = parseCellRef(spec.dateCell);
    rows = writeRowValues(rows, target.row, {
      firstColumnNumber: target.columnNumber,
      values: [{ kind: "date", iso: isoDateOf(params.today) }],
      dateStyles: params.dateStyles,
      date1904: params.date1904,
      wrapStyles: params.wrapStyles,
    });
  }

  let xml = writeSheetRows(params.sheetXml, rows);

  const delta = resized.delta;
  if (delta !== 0) {
    const shiftFrom = firstDataRow + previousRowCount;
    xml = shiftMergeCellRows(xml, shiftFrom, delta);
    xml = shiftSqrefRows(xml, shiftFrom, delta);
  }
  if (delta > 0 && previousRowCount > 0) {
    const modelRow = firstDataRow + previousRowCount - 1;
    if (hasSingleRowMerge(xml, modelRow)) {
      const added: number[] = [];
      for (let index = 0; index < delta; index += 1) added.push(modelRow + 1 + index);
      xml = cloneRowMergeCells(xml, modelRow, added);
    }
  }
  xml = sanitizeMergeCells(xml);

  const autoFilter = updateAutoFilter(xml, spec.headerRow, targetCount);
  if (autoFilter !== null) xml = autoFilter.xml;
  xml = syncDimension(xml, rows);

  return { xml, previousRowCount, autoFilterRef: autoFilter?.ref ?? null };
}

/**
 * 🔴 엑셀의 머리글이 지금 양식의 열 이름과 같은가. 다르면 **적지 않는다.**
 *
 * 값을 자리로 넣기 때문이다 — 고객사가 열을 하나 끼워 넣었는데 그대로 적으면 모든 값이
 * 한 칸씩 밀려 들어가고, 파일은 멀쩡해 보인다. 그 파일은 고객사로 나간다.
 */
function verifyHeader(
  grid: ReturnType<typeof buildSheetGrid>,
  spec: CustomerPortalExportSpec,
  form: CustomerPortalForm,
  firstColumnNumber: number
): void {
  const cells = grid.cells(spec.headerRow);
  form.columns.forEach((column, index) => {
    const letters = columnNumberToLetters(firstColumnNumber + index);
    const cell = cells.get(letters);
    const found = cell === undefined ? "" : cell.kind === "text" ? cell.text : String(cell.value);
    if (normalizePortalExportHeader(found) === normalizePortalExportHeader(column.label)) return;
    throw new CustomerPortalExportError(
      `직전 파일의 머리글이 화면의 양식과 다릅니다 — ${spec.headerRow}행 ${letters}열이 「${
        normalizePortalExportHeader(found) === "" ? "빈칸" : found.split(/\r\n|\r|\n/)[0]
      }」인데 「${column.label}」이어야 합니다. 양식이 바뀌었다면 알려 주세요.`
    );
  });
}

/**
 * 머리글 바로 아래부터, **첫 열이 비지 않은 줄**이 몇 줄 이어지는가. 셋 다 첫 열이
 * 「No.」(줄 번호)라 이 셈이 곧 표의 줄 수다. 표 아래에 남아 있는 딴 줄(옛 표의 자취 ·
 * 메모)은 첫 열이 비어 있어 여기서 끊긴다.
 */
function countDataRows(
  grid: ReturnType<typeof buildSheetGrid>,
  headerRow: number,
  firstColumn: string
): number {
  let count = 0;
  for (let row = headerRow + 1; row <= headerRow + PORTAL_EXPORT_MAX_ROWS; row += 1) {
    if (grid.cells(row).get(firstColumn) === undefined) break;
    count += 1;
  }
  return count;
}

// ── 칸 쓰기 ──────────────────────────────────────────────────────────────

type CellContent =
  | { kind: "empty" }
  | { kind: "text"; text: string }
  | { kind: "number"; value: number };

const ROW_OPEN_TAG = /^<row\b[^>]*?(\/?)>/;
const CELL_ELEMENT = /<c\b([^>]*?)(?:\/>|>[\s\S]*?<\/c>)/g;

function writeRowValues(
  rows: readonly SheetRow[],
  rowNumber: number,
  params: {
    firstColumnNumber: number;
    values: readonly PortalExportCell[];
    dateStyles: ReadonlySet<number>;
    date1904: boolean;
    wrapStyles: WrapTextCellXfs;
  }
): SheetRow[] {
  let found = false;
  const next = rows.map((row) => {
    if (row.rowNumber !== rowNumber) return row;
    found = true;
    return writeCellsInRow(row, params);
  });
  // 없는 줄에 적으려 했다면 조용히 넘어가지 않는다 — 그러면 그 값만 빠진 파일이 나간다.
  if (!found) throw new CustomerPortalExportError(`직전 파일의 ${rowNumber}행을 찾지 못했습니다.`);
  return next;
}

function writeCellsInRow(
  row: SheetRow,
  params: {
    firstColumnNumber: number;
    values: readonly PortalExportCell[];
    dateStyles: ReadonlySet<number>;
    date1904: boolean;
    wrapStyles: WrapTextCellXfs;
  }
): SheetRow {
  const open = ROW_OPEN_TAG.exec(row.xml);
  if (open === null) throw new CustomerPortalExportError(`${row.rowNumber}행을 읽지 못했습니다.`);

  const selfClosing = open[1] === "/";
  const inner = selfClosing ? "" : row.xml.slice(open[0].length, row.xml.lastIndexOf("</row>"));

  const existing = new Map<number, { raw: string; style: string | null }>();
  let nextColumn = 1;
  for (const match of inner.matchAll(CELL_ELEMENT)) {
    const attributes = match[1];
    const reference = /\br="([A-Z]+)\d*"/.exec(attributes);
    const columnNumber = reference ? columnLettersToNumber(reference[1]) : nextColumn;
    nextColumn = columnNumber + 1;
    existing.set(columnNumber, { raw: match[0], style: /\ss="([^"]*)"/.exec(attributes)?.[1] ?? null });
  }

  const written = new Map<number, string>();
  params.values.forEach((value, index) => {
    const columnNumber = params.firstColumnNumber + index;
    const style = existing.get(columnNumber)?.style ?? null;
    const content = toCellContent(value, style, params.dateStyles, params.date1904);
    // 🔴 한 칸 안에 **여러 줄**이면 그 칸의 서식에 「자동 줄 바꿈」을 켠 사본을 쓴다 —
    //    안 켜면 값은 들어 있는데 엑셀에서 한 줄로만 보인다(고객 안내 현황의 견적서 번호).
    const cellStyle = isMultiLineText(content) ? params.wrapStyles.indexFor(style) : style;
    written.set(columnNumber, buildCellXml(columnNumber, row.rowNumber, cellStyle, content));
  });

  const columns = [...new Set([...existing.keys(), ...written.keys()])].sort((a, b) => a - b);
  const body = columns.map((column) => written.get(column) ?? existing.get(column)?.raw ?? "").join("");
  const openTag = selfClosing ? open[0].replace(/\s*\/>$/, ">") : open[0];
  return { rowNumber: row.rowNumber, xml: `${openTag}${body}</row>` };
}

/**
 * 그 칸이 **여러 줄**인가. 글자 칸만 그럴 수 있다(숫자 · 날짜 · 빈칸에는 줄바꿈이 없다).
 * `\r\n` 도 센다 — 칸을 쓸 때 escapeXmlText 가 `\n` 으로 맞춰 `&#10;` 로 적는다.
 */
function isMultiLineText(content: CellContent): boolean {
  return content.kind === "text" && /[\r\n]/.test(content.text);
}

/**
 * 값 + 그 자리에 있던 서식 → 실제로 적을 칸. 머리말 「어떤 칸으로 적는가」 참조.
 */
function toCellContent(
  value: PortalExportCell,
  style: string | null,
  dateStyles: ReadonlySet<number>,
  date1904: boolean
): CellContent {
  switch (value.kind) {
    case "empty":
      return { kind: "empty" };
    case "number":
      return { kind: "number", value: value.value };
    case "text":
      return { kind: "text", text: value.text };
    case "date": {
      const styleIndex = style === null ? null : Number(style);
      if (styleIndex !== null && Number.isInteger(styleIndex) && dateStyles.has(styleIndex)) {
        return { kind: "number", value: excelSerial(value.iso, date1904) };
      }
      // 날짜 서식이 아닌 칸에 일련번호를 적으면 `46294` 가 찍힌다 — 글자로 적는다.
      return { kind: "text", text: value.iso };
    }
  }
}

function buildCellXml(
  columnNumber: number,
  rowNumber: number,
  style: string | null,
  content: CellContent
): string {
  const reference = `${columnNumberToLetters(columnNumber)}${rowNumber}`;
  const styleAttribute = style === null ? "" : ` s="${escapeXmlAttribute(style)}"`;
  switch (content.kind) {
    case "empty":
      return `<c r="${reference}"${styleAttribute}/>`;
    case "number":
      return `<c r="${reference}"${styleAttribute}><v>${content.value}</v></c>`;
    case "text":
      return `<c r="${reference}"${styleAttribute} t="inlineStr"><is><t xml:space="preserve">${escapeXmlText(
        content.text
      )}</t></is></c>`;
  }
}

/** 베낀 탭에서 `tabSelected` 를 뗀다(위 「베낀 탭」 주석). 없으면 그대로다. */
function dropTabSelected(sheetXml: string): string {
  return sheetXml.replace(/(<sheetView\b[^>]*?)\stabSelected="[^"]*"/g, "$1");
}

function parseCellRef(reference: string): { columnNumber: number; row: number } {
  const found = /^([A-Z]+)(\d+)$/.exec(reference);
  if (!found) throw new CustomerPortalExportError(`칸 주소를 읽지 못했습니다: ${reference}`);
  return { columnNumber: columnLettersToNumber(found[1]), row: Number(found[2]) };
}

function isoDateOf(date: Date): string {
  if (Number.isNaN(date.getTime())) throw new CustomerPortalExportError("유효하지 않은 날짜입니다.");
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * `YYYY-MM-DD` → 엑셀 일련번호. 🔴 `new Date("2026-09-15")` 로 만들지 않는다 — 그것은
 * UTC 자정이라 시간대에 따라 하루 어긋난다. 적힌 숫자 셋으로 그 지역의 날짜를 만든다.
 */
function excelSerial(iso: string, date1904: boolean): number {
  const found = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!found) throw new CustomerPortalExportError(`날짜를 읽지 못했습니다: ${iso}`);
  const serial = toExcelSerialDate(new Date(Number(found[1]), Number(found[2]) - 1, Number(found[3])));
  // 1904 체계는 1900 체계보다 1462일 뒤에서 센다.
  return date1904 ? serial - 1462 : serial;
}

// ── 서식이 날짜인가 ──────────────────────────────────────────────────────

/** 규격이 미리 정해 둔 날짜 서식 번호들. */
const BUILTIN_DATE_NUMBER_FORMATS = new Set([
  14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51,
  52, 53, 54, 55, 56, 57, 58,
]);

const CELL_XF = /<xf\b[^>]*?(?:\/>|>[\s\S]*?<\/xf>)/g;

/**
 * `<cellXfs>` 의 몇 번 서식이 **날짜로 보이는가**. 값을 날짜(일련번호)로 적을지
 * 글자로 적을지를 이것으로 가른다.
 *
 * 스스로 만든 서식(numFmtId ≥ 164)은 그 서식 글자를 본다 — 따옴표 안의 글자와
 * `[빨강]` 같은 꾸밈은 걷어내고, `y` 가 있거나 `d` 와 `m` 이 함께 있으면 날짜로 본다
 * (`m` 만으로는 안 된다 — 분(minute)도 `m` 이다).
 */
export function readDateStyleIndexes(stylesXml: string | null): Set<number> {
  const indexes = new Set<number>();
  if (stylesXml === null) return indexes;

  const customFormats = new Map<number, string>();
  for (const match of stylesXml.matchAll(/<numFmt\b[^>]*\/>/g)) {
    const id = Number(/\snumFmtId="(\d+)"/.exec(match[0])?.[1] ?? "-1");
    const code = /\sformatCode="([^"]*)"/.exec(match[0])?.[1];
    if (id >= 0 && code !== undefined) customFormats.set(id, decodeXmlCharacterData(code));
  }

  const block = /(<cellXfs\b[^>]*>)([\s\S]*?)(<\/cellXfs>)/.exec(stylesXml);
  if (!block) return indexes;
  const xfs = [...block[2].matchAll(CELL_XF)].map((match) => match[0]);
  xfs.forEach((xf, index) => {
    const id = Number(/\snumFmtId="(\d+)"/.exec(xf)?.[1] ?? "0");
    if (BUILTIN_DATE_NUMBER_FORMATS.has(id)) {
      indexes.add(index);
      return;
    }
    const code = customFormats.get(id);
    if (code !== undefined && looksLikeDateFormat(code)) indexes.add(index);
  });
  return indexes;
}

function looksLikeDateFormat(code: string): boolean {
  const stripped = code
    .replace(/"[^"]*"/g, "")
    .replace(/\[[^\]]*\]/g, "")
    .replace(/\\./g, "");
  if (/[yY]/.test(stripped)) return true;
  return /[dD]/.test(stripped) && /[mM]/.test(stripped);
}

// ── 자동 필터 · 병합 ─────────────────────────────────────────────────────

/**
 * 🔴 자동 필터 범위를 **실제 줄 수에 맞춘다.**
 *
 * 실측(2026-09-30)하면 세 파일 다 범위가 실제와 어긋나 있다(ICD `B5:M15` 인데 표는
 * 16행까지, JUSUNG `B4:N12` 인데 표는 11행까지). 줄을 더하거나 지우면서 필터를 안
 * 고친 자취다 — 그 사고를 물려받지 않는다. **열 범위는 그대로 둔다**(우리가 넓힐 일이
 * 아니다). 필터가 없는 시트에는 만들어 주지 않는다.
 */
function updateAutoFilter(
  sheetXml: string,
  headerRow: number,
  rowCount: number
): { xml: string; ref: CellRange } | null {
  const tag = /<autoFilter\b[^>]*>/.exec(sheetXml);
  if (!tag) return null;
  const reference = /\sref="([A-Z]+)(\d+):([A-Z]+)(\d+)"/.exec(tag[0]);
  if (!reference) return null;

  const ref: CellRange = {
    startColumn: reference[1],
    startRow: headerRow,
    endColumn: reference[3],
    endRow: headerRow + rowCount,
  };
  const next = tag[0].replace(
    /\sref="[^"]*"/,
    ` ref="${ref.startColumn}${ref.startRow}:${ref.endColumn}${ref.endRow}"`
  );
  return { xml: sheetXml.slice(0, tag.index) + next + sheetXml.slice(tag.index + tag[0].length), ref };
}

const MERGE_CELLS_BLOCK = /<mergeCells[^>]*>([\s\S]*?)<\/mergeCells>/;

function hasSingleRowMerge(sheetXml: string, rowNumber: number): boolean {
  const block = MERGE_CELLS_BLOCK.exec(sheetXml);
  if (!block) return false;
  for (const match of block[1].matchAll(/<mergeCell[^>]*\sref="([A-Z]+)(\d+):([A-Z]+)(\d+)"/g)) {
    if (Number(match[2]) === rowNumber && Number(match[4]) === rowNumber) return true;
  }
  return false;
}

/**
 * 🔴 겹치는 병합을 버린다. 줄이 **줄어들면** 표 아래에 남아 있던 병합이 위로 밀려 다른
 * 병합과 같은 자리에 올 수 있는데, 같은 범위가 둘 있거나 서로 겹치는 시트는 엑셀이
 * 파일 열기를 거부한다(「복구할 수 없는 내용」). 먼저 나온 것을 남긴다.
 */
function sanitizeMergeCells(sheetXml: string): string {
  const block = MERGE_CELLS_BLOCK.exec(sheetXml);
  if (!block) return sheetXml;

  const kept: { ref: string; box: { top: number; bottom: number; left: number; right: number } }[] = [];
  for (const match of block[1].matchAll(/<mergeCell[^>]*\sref="([^"]+)"/g)) {
    const box = parseMergeBox(match[1]);
    if (box === null) continue;
    if (kept.some((other) => overlaps(other.box, box))) continue;
    kept.push({ ref: match[1], box });
  }

  const body = kept.map((entry) => `<mergeCell ref="${entry.ref}"/>`).join("");
  const replacement =
    kept.length === 0 ? "" : `<mergeCells count="${kept.length}">${body}</mergeCells>`;
  return sheetXml.replace(MERGE_CELLS_BLOCK, () => replacement);
}

function parseMergeBox(
  reference: string
): { top: number; bottom: number; left: number; right: number } | null {
  const found = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(reference);
  if (!found) return null;
  const left = columnLettersToNumber(found[1]);
  const right = columnLettersToNumber(found[3]);
  const top = Number(found[2]);
  const bottom = Number(found[4]);
  return {
    top: Math.min(top, bottom),
    bottom: Math.max(top, bottom),
    left: Math.min(left, right),
    right: Math.max(left, right),
  };
}

function overlaps(
  a: { top: number; bottom: number; left: number; right: number },
  b: { top: number; bottom: number; left: number; right: number }
): boolean {
  return a.left <= b.right && b.left <= a.right && a.top <= b.bottom && b.top <= a.bottom;
}

// ── 다시 묶기 ────────────────────────────────────────────────────────────

/**
 * 원본의 파트를 **같은 차례로** 다시 묶고, 바뀐 것만 갈아 끼우고 새 것은 뒤에 붙인다.
 * 손대지 않은 파트(그림 · 프린터 설정 · 테마 · 옛 시트들)는 바이트 그대로 옮겨진다.
 */
function repackage(
  archive: ZipArchive,
  replacements: ReadonlyMap<string, Buffer>,
  additions: readonly { name: string; data: Buffer }[]
): Buffer {
  const entries: { name: string; data: Buffer }[] = [];
  for (const entry of archive.listEntries()) {
    const replaced = replacements.get(entry.name);
    if (replaced !== undefined) {
      entries.push({ name: entry.name, data: replaced });
      continue;
    }
    entries.push({ name: entry.name, data: archive.readEntry(entry.name) ?? Buffer.alloc(0) });
  }
  entries.push(...additions.map((addition) => ({ name: addition.name, data: addition.data })));
  return writeZip(entries);
}

// ── 잔심부름 ─────────────────────────────────────────────────────────────

function escapeXmlAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
