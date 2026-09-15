import "server-only";

import {
  HANDWRITTEN_QUOTE_READ_LIMITS,
  readHandwrittenQuoteWorkbook,
  type HandwrittenQuoteSheet,
} from "@/lib/xlsx/handwritten-quote-reader";
import { MATCHER_QUOTE_SHEET_NAME } from "@/lib/xlsx/matcher-quote-template";
import { OH_QUOTE_SHEET_NAME } from "@/lib/xlsx/oh-quote-template";
import { QUOTE_SHEET_NAME } from "@/lib/xlsx/quote-template";
import {
  readSheetPrintGrid,
  resolveWorkbookThemePart,
  type PrintGridPicture,
  type SheetPrintGrid,
} from "@/lib/xlsx/sheet-print-grid";
import {
  resolveSheetDrawingPart,
  resolveSheetPart,
  SHARED_STRINGS_PART,
  STYLES_PART,
  WORKBOOK_PART,
  WORKBOOK_RELS_PART,
} from "@/lib/xlsx/workbook-parts";
import { decodeXmlCharacterData } from "@/lib/xlsx/xml-entities";
import { ZipArchive } from "@/lib/xlsx/zip-reader";

/**
 * ============================================================================
 * 붙인 수기 견적서 엑셀(.xlsx) → 인쇄 모양의 격자 (견적서 ②b)
 * ============================================================================
 * 엑셀 전용 견적서의 미리보기(GET /api/quotes/{id}/excel-preview)가 부른다. 입력은 파일
 * 바이트 하나이고, 화면 · DB · 저장소 · 요청을 모른다 — 통로는 문지기와 응답 모양만 맡는다.
 *
 *   바이트 → 시트 고르기(①a readHandwrittenQuoteWorkbook) → 상한 안에서 파트 풀어 보기
 *        → readSheetPrintGrid(…, fallback-to-used-range)(②a — 보고서 미리보기와 같은 격자)
 *        → 격자가 가리키는 그림만 data URI 로
 *
 * ── 결과는 두 갈래, 내용 때문에 던지지 않는다 ──────────────────────────────
 *  · `{ ok: true, grid, warnings }` — 시트를 대신 골랐거나 그림을 뺐으면 까닭을 warnings 에.
 *  · `{ ok: false, code, message }` — 옛 .xls · xlsx 아님 · 너무 큼 · 시트 모양을 못 읽음.
 *
 * ── 시트 고르기 ─────────────────────────────────────────────────────────
 * ①a 의 규칙 그대로다(발행번호가 채워진 시트 → 활성 시트 → 탭 순서). 알아볼 견적서 시트가
 * 하나도 없으면 **통합문서의 첫 시트**(숨긴 시트는 건너뛴다)를 대신 그리고 경고를 싣는다 —
 * 미리보기는 사람이 무엇을 붙였는지 보는 곳이라 「못 그림」보다 「첫 시트」가 쓸모 있다.
 * ①a 의 경고 가운데 **시트를 고른 까닭**(「탭 순서의 첫 시트」)만 옮긴다. 나머지(견적서
 * 종류 · 금액을 글자로 읽음 …)는 폼에 값을 채울 때의 말이라 미리보기에 싣지 않는다.
 *
 * ── 🔴 안전 — 믿을 수 없는 파일을 서버에서 푼다 ─────────────────────────────
 *  · zip-reader.ts 에는 상한이 없다. readSheetPrintGrid 와 resolveSheetPart ·
 *    resolveSheetDrawingPart 는 파트를 **상한 없이** 푼다. 그래서 그 함수들이 풀 파트를
 *    전부 **먼저 상한 안에서 한 번 풀어 본다**(`preflightParts`) — 같은 바이트는 같은
 *    크기로 풀리므로 뒤의 재읽기도 그 크기를 넘지 않는다(①a 가 resolveSheetPart 에 대해
 *    쓰는 방법과 같다). 상한은 ①a 의 것(파트 하나 8MB · 합계 32MB · 엔트리 2,000개)을
 *    그대로 쓴다. 시험이 «상한 없이 풀린 파트는 모두 먼저 상한 안에서 풀린 것»을 못 박는다
 *    — readSheetPrintGrid 가 새 파트를 읽게 되면 거기서 멈춘다.
 *  · 🔴 그림은 **격자가 가리키는 이미지 파트만** 꺼낸다(시트 → 그림 파트 → 그 관계 파일의
 *    image 관계). 외부 링크(TargetMode="External")는 따라가지 않는다. 확장자가 png · jpg ·
 *    jpeg · gif 이고 **앞머리 바이트도 그 형식**인 것만 싣는다 — emf · wmf 따위는 브라우저가
 *    못 그리므로 빼고 그 수를 경고로 알린다. 그림 합계가 상한(4MB)을 넘으면 **그림을 전부**
 *    빼고 경고한다(한 장만 빠진 문서 — 직인은 있는데 로고가 없는 것 — 보다 「그림 없이
 *    그렸다」가 헷갈리지 않는다).
 *  · 요청에서 온 글자는 여기 들어오지 않는다 — 파트 이름은 전부 파일 안의 관계에서 온다.
 *    디스크를 만지지 않는다(zip 안의 이름일 뿐이다).
 *  · 값을 로그에 찍지 않는다 — 이 모듈에는 console 이 없다.
 * ============================================================================
 */

export type QuoteExcelPreviewLimits = {
  maxZipEntries: number;
  /** 파트 하나를 풀었을 때의 바이트. */
  maxPartBytes: number;
  /** 미리 풀어 본 파트들의 합계 바이트. */
  maxTotalPartBytes: number;
  /** 응답에 싣는 그림(서로 다른 파트)의 합계 바이트 — base64 로 부풀기 전. */
  maxPictureBytes: number;
  /**
   * 그리는 칸 수(인쇄 영역 · 쓰인 범위의 행 × 열). 격자 자체의 폭주 방지(20만 칸)와 따로 둔다 —
   * 칸마다 JSON 이 백 바이트를 넘으니, 견적서 한 장(수백 ~ 수천 칸)을 넉넉히 넘는 선에서 끊는다.
   */
  maxCells: number;
};

export const QUOTE_EXCEL_PREVIEW_LIMITS: QuoteExcelPreviewLimits = {
  maxZipEntries: HANDWRITTEN_QUOTE_READ_LIMITS.maxZipEntries,
  maxPartBytes: HANDWRITTEN_QUOTE_READ_LIMITS.maxPartBytes,
  maxTotalPartBytes: HANDWRITTEN_QUOTE_READ_LIMITS.maxTotalPartBytes,
  maxPictureBytes: 4 * 1024 * 1024,
  maxCells: 20_000,
};

/** 그림 한 장 — 격자의 자리에 **data URI** 를 단다(png · jpeg · gif 만). */
export type QuoteExcelPreviewPicture = PrintGridPicture & { src: string };

/** 응답의 격자. 그림만 data URI 를 단 모양이고 나머지는 ②a 의 격자 그대로다. */
export type QuoteExcelPreviewGrid = Omit<SheetPrintGrid, "pictures"> & {
  pictures: QuoteExcelPreviewPicture[];
};

export type QuoteExcelPreviewFailureCode =
  | "XLS_LEGACY"
  | "NOT_XLSX"
  | "CONTENT_TOO_LARGE"
  | "SHEET_UNREADABLE"
  | "SHEET_TOO_LARGE";

export type QuoteExcelPreviewResult =
  | { ok: true; grid: QuoteExcelPreviewGrid; warnings: string[] }
  | { ok: false; code: QuoteExcelPreviewFailureCode; message: string };

/** 사람이 읽는 까닭. 🔴 XLS_LEGACY 는 사용자 결정(2026-09-16) 문장 그대로다. */
export const QUOTE_EXCEL_PREVIEW_FAILURE_MESSAGES: Record<QuoteExcelPreviewFailureCode, string> = {
  XLS_LEGACY:
    "옛 엑셀 형식(.xls)이라 미리보기를 그릴 수 없습니다 — xlsx 로 다시 저장해 올리거나 [견적서 받기]로 받아 보세요",
  NOT_XLSX:
    "엑셀 통합 문서(.xlsx)로 읽을 수 없는 파일이라 미리보기를 그릴 수 없습니다 — [견적서 받기]로 받아 확인해 주세요",
  CONTENT_TOO_LARGE:
    "엑셀 파일 안의 내용이 너무 커서 미리보기를 그리지 않았습니다 — [견적서 받기]로 받아 확인해 주세요",
  SHEET_UNREADABLE:
    "엑셀 시트의 모양을 읽지 못해 미리보기를 그릴 수 없습니다 — [견적서 받기]로 받아 확인해 주세요",
  SHEET_TOO_LARGE:
    "엑셀 시트에 쓰인 범위가 너무 넓어 미리보기를 그리지 않았습니다 — [견적서 받기]로 받아 확인해 주세요",
};

/** ①a 가 고른 시트 → 그 시트의 이름(채우개의 상수 그대로). */
const SHEET_NAMES: Record<HandwrittenQuoteSheet, string> = {
  GENERATOR_DOMESTIC: QUOTE_SHEET_NAME,
  GENERATOR_OH: OH_QUOTE_SHEET_NAME,
  MATCHER: MATCHER_QUOTE_SHEET_NAME,
};

/**
 * ①a 의 경고 가운데 **시트를 고른 까닭**의 표지. 그 두 문장(발행번호가 채워진 시트가 여럿 ·
 * 모두 비어 있음)만 이 말을 담는다 — 시험이 ①a 의 실제 문장으로 이 짝을 확인한다.
 */
const SHEET_CHOICE_WARNING_MARK = "탭 순서의 첫 시트";

/** 브라우저가 그리는 그림만. 확장자는 **파일 안의 파트 이름**에서 온다. */
const IMAGE_TYPES: Record<string, "image/png" | "image/jpeg" | "image/gif"> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
};

/** 형식마다 앞머리 바이트. 확장자만 바꾼 파트를 거른다. */
const IMAGE_SIGNATURES: Record<"image/png" | "image/jpeg" | "image/gif", readonly (readonly number[])[]> = {
  "image/png": [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
  "image/jpeg": [[0xff, 0xd8, 0xff]],
  "image/gif": [
    [0x47, 0x49, 0x46, 0x38, 0x37, 0x61],
    [0x47, 0x49, 0x46, 0x38, 0x39, 0x61],
  ],
};

/** 안쪽에서 던져 맨 바깥의 한 곳에서 실패 결과로 바꾸는 표지. 밖으로 새지 않는다. */
class PreviewFailure extends Error {
  readonly code: QuoteExcelPreviewFailureCode;

  constructor(code: QuoteExcelPreviewFailureCode) {
    super(code);
    this.code = code;
  }
}

function failure(code: QuoteExcelPreviewFailureCode): QuoteExcelPreviewResult {
  return { ok: false, code, message: QUOTE_EXCEL_PREVIEW_FAILURE_MESSAGES[code] };
}

// ── 들어가는 곳 ─────────────────────────────────────────────────────────

export function buildQuoteExcelPreview(
  input: Uint8Array,
  options: { limits?: Partial<QuoteExcelPreviewLimits> } = {}
): QuoteExcelPreviewResult {
  const limits: QuoteExcelPreviewLimits = { ...QUOTE_EXCEL_PREVIEW_LIMITS, ...options.limits };
  const bytes = Buffer.from(input.buffer, input.byteOffset, input.byteLength);

  // ①a 가 xls · zip 아님 · 상한을 먼저 가르고 시트를 고른다.
  const recognized = readHandwrittenQuoteWorkbook(bytes, {
    limits: {
      maxZipEntries: limits.maxZipEntries,
      maxPartBytes: limits.maxPartBytes,
      maxTotalPartBytes: limits.maxTotalPartBytes,
    },
  });

  const warnings: string[] = [];
  let sheetName: string | null = null;
  if (recognized.ok) {
    sheetName = SHEET_NAMES[recognized.sheet];
    warnings.push(...recognized.warnings.filter((warning) => warning.includes(SHEET_CHOICE_WARNING_MARK)));
  } else if (recognized.code !== "NO_QUOTE_SHEET") {
    return failure(recognized.code);
  }

  try {
    return drawWorkbook(bytes, sheetName, limits, warnings);
  } catch (error) {
    // 깨진 파트 · 못 읽는 시트 구조가 어디서 터졌든 여기서 멈춘다(머리말 '던지지 않는다').
    return failure(error instanceof PreviewFailure ? error.code : "SHEET_UNREADABLE");
  }
}

function drawWorkbook(
  bytes: Buffer,
  chosenSheetName: string | null,
  limits: QuoteExcelPreviewLimits,
  warnings: string[]
): QuoteExcelPreviewResult {
  let archive: ZipArchive;
  try {
    archive = ZipArchive.fromBuffer(bytes);
  } catch {
    throw new PreviewFailure("NOT_XLSX");
  }
  if (archive.entryCount() > limits.maxZipEntries) throw new PreviewFailure("CONTENT_TOO_LARGE");
  if (archive.hasDuplicateEntryNames()) throw new PreviewFailure("NOT_XLSX");

  const readPart = createBoundedPartReader(archive, limits);

  // resolveSheetPart 가 이 두 파트를 상한 없이 다시 푼다 — 먼저 상한 안에서(머리말 '안전').
  const workbookXml = readPart(WORKBOOK_PART);
  if (workbookXml === null || readPart(WORKBOOK_RELS_PART) === null) throw new PreviewFailure("NOT_XLSX");

  let sheetName = chosenSheetName;
  if (sheetName === null) {
    const first = firstSheetName(workbookXml.toString("utf8"));
    if (first === null) throw new PreviewFailure("NOT_XLSX");
    sheetName = first;
    warnings.push(
      `견적서 시트(내자견적서 · OH견적서 · 견적서)를 찾지 못해 통합문서의 첫 시트 「${first}」를 그렸습니다 — 앱 양식을 바탕으로 만든 견적서 엑셀인지 확인해 주세요.`
    );
  }

  const parts = preflightParts(archive, sheetName, readPart);
  // 조건부 서식을 켠다 — 사람이 만든 견적서 엑셀은 「0 이면 흰 글자」로 도우미 칸의 ₩0 을
  // 감춘다(sheet-print-grid.ts 의 「조건부 서식」). 보고서 미리보기는 켜지 않는다.
  const grid = readSheetPrintGrid(bytes, sheetName, {
    printArea: "fallback-to-used-range",
    conditionalFormatting: "apply",
  });

  const cellCount = (grid.lastRow - grid.firstRow + 1) * (grid.lastColumn - grid.firstColumn + 1);
  if (cellCount > limits.maxCells) throw new PreviewFailure("SHEET_TOO_LARGE");

  const pictures = collectPictures(archive, parts.drawingPart, parts.drawingRelsXml, grid.pictures, limits, warnings);
  return { ok: true, grid: { ...grid, pictures }, warnings };
}

/**
 * 이 모듈의 파트 읽기는 전부 여기를 지난다 — 파트 하나 · 합계 상한. 없는 파트는 null.
 * 상한을 넘으면 CONTENT_TOO_LARGE, 풀지 못하면 SHEET_UNREADABLE 을 던진다.
 */
function createBoundedPartReader(
  archive: ZipArchive,
  limits: QuoteExcelPreviewLimits
): (name: string) => Buffer | null {
  let total = 0;
  return (name) => {
    if (!archive.has(name)) return null;
    let bytes: Buffer | null;
    try {
      bytes = archive.readEntry(name, limits.maxPartBytes);
    } catch (error) {
      throw new PreviewFailure(isOutputLimitError(error) ? "CONTENT_TOO_LARGE" : "SHEET_UNREADABLE");
    }
    if (bytes === null) return null;
    total += bytes.length;
    if (total > limits.maxTotalPartBytes) throw new PreviewFailure("CONTENT_TOO_LARGE");
    return bytes;
  };
}

/** 풀린 크기가 상한을 넘었다 — deflate 는 zlib 의 ERR_BUFFER_TOO_LARGE, 무압축은 zip-reader 의 문장. */
function isOutputLimitError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  if ((error as { code?: unknown }).code === "ERR_BUFFER_TOO_LARGE") return true;
  return error instanceof Error && error.message.includes("exceeds configured output limit");
}

/** `xl/worksheets/sheet1.xml` → `xl/worksheets/_rels/sheet1.xml.rels`(readSheetPrintGrid 와 같은 규칙). */
function relsPartOf(part: string): string {
  return part.replace(/([^/]+)$/, "_rels/$1.rels");
}

/**
 * readSheetPrintGrid 가 풀 파트를 **먼저 상한 안에서** 풀어 본다(머리말 '안전'). 차례도 그
 * 함수와 같다 — 시트 → (시트 관계 →) 그림 파트 → 그 관계 · 공유문자열 · 서식.
 */
function preflightParts(
  archive: ZipArchive,
  sheetName: string,
  readPart: (name: string) => Buffer | null
): { drawingPart: string | null; drawingRelsXml: string | null } {
  const sheetPart = resolveSheetPart(archive, sheetName);
  if (readPart(sheetPart) === null) throw new PreviewFailure("SHEET_UNREADABLE");
  // resolveSheetDrawingPart 가 시트의 관계 파일을 상한 없이 푼다.
  readPart(relsPartOf(sheetPart));

  const drawingPart = resolveSheetDrawingPart(archive, sheetPart);
  let drawingRelsXml: string | null = null;
  if (drawingPart !== null) {
    readPart(drawingPart);
    drawingRelsXml = readPart(relsPartOf(drawingPart))?.toString("utf8") ?? null;
  }
  readPart(SHARED_STRINGS_PART);
  readPart(STYLES_PART);
  // 조건부 서식의 테마 색 — readSheetPrintGrid 가 conditionalFormatting: "apply" 일 때 편다.
  const themePart = resolveWorkbookThemePart(archive);
  if (themePart !== null) readPart(themePart);
  return { drawingPart, drawingRelsXml };
}

/**
 * 통합문서 탭 순서의 첫 시트 이름(풀린 글자). 숨긴 시트(`state="hidden"` · `veryHidden`)는
 * 건너뛴다 — 사람이 Excel 에서 보는 첫 탭이 그것이다. 모두 숨었으면 첫 시트. 없으면 null.
 */
function firstSheetName(workbookXml: string): string | null {
  const sheets = /<sheets\b[^>]*>([\s\S]*?)<\/sheets>/.exec(workbookXml)?.[1] ?? "";
  const tags = [...sheets.matchAll(/<sheet\b[^>]*>/g)].map((match) => match[0]);
  const visible = tags.find((tag) => !/\sstate="(?:hidden|veryHidden)"/.test(tag)) ?? tags[0];
  const name = visible === undefined ? undefined : /\sname="([^"]*)"/.exec(visible)?.[1];
  return name === undefined || name === "" ? null : decodeXmlCharacterData(name);
}

// ── 그림 ─────────────────────────────────────────────────────────────────

/**
 * 격자의 그림들에 data URI 를 단다. 격자는 그림을 **파일 이름**(`image3.png`)으로만 들고
 * 있으므로, 그림 파트의 관계 파일에서 «파일 이름 → 파트 경로»를 모아 그 열쇠로만 찾는다
 * (sheet-print-grid.ts 가 이름을 뽑는 규칙과 같다 — Target 의 마지막 조각).
 */
function collectPictures(
  archive: ZipArchive,
  drawingPart: string | null,
  drawingRelsXml: string | null,
  pictures: readonly PrintGridPicture[],
  limits: QuoteExcelPreviewLimits,
  warnings: string[]
): QuoteExcelPreviewPicture[] {
  if (pictures.length === 0) return [];

  const targets =
    drawingPart === null || drawingRelsXml === null ? new Map<string, string>() : imagePartsByName(drawingPart, drawingRelsXml);
  const sources = new Map<string, string | null>();
  let total = 0;
  let overBudget = false;

  const load = (name: string): string | null => {
    const path = targets.get(name);
    if (path === undefined || !archive.has(path)) return null;
    const type = IMAGE_TYPES[path.split(".").pop()?.toLowerCase() ?? ""];
    if (type === undefined) return null; // emf · wmf · svg … 브라우저가 못 그리거나 싣지 않는 것.

    const remaining = limits.maxPictureBytes - total;
    if (remaining < 1) {
      overBudget = true;
      return null;
    }
    let bytes: Buffer | null;
    try {
      bytes = archive.readEntry(path, remaining);
    } catch (error) {
      if (isOutputLimitError(error)) overBudget = true;
      return null;
    }
    if (bytes === null) return null;
    total += bytes.length;
    if (total > limits.maxPictureBytes) {
      overBudget = true;
      return null;
    }
    if (!IMAGE_SIGNATURES[type].some((signature) => startsWith(bytes, signature))) return null;
    return `data:${type};base64,${bytes.toString("base64")}`;
  };

  for (const picture of pictures) {
    if (!sources.has(picture.name)) sources.set(picture.name, load(picture.name));
    if (overBudget) break;
  }

  if (overBudget) {
    warnings.push(
      `그림을 모두 합하면 ${formatMegabytes(limits.maxPictureBytes)}를 넘어 그림(직인 · 로고 등) 없이 그렸습니다 — 그림까지 보려면 [견적서 받기]로 받아 확인해 주세요.`
    );
    return [];
  }

  const drawn: QuoteExcelPreviewPicture[] = [];
  for (const picture of pictures) {
    const src = sources.get(picture.name) ?? null;
    if (src !== null) drawn.push({ ...picture, src });
  }
  const skipped = pictures.length - drawn.length;
  if (skipped > 0) {
    warnings.push(
      `그림 ${skipped}장은 브라우저가 그릴 수 없는 형식(emf 등)이거나 파일 안에서 꺼낼 수 없어 빼고 그렸습니다.`
    );
  }
  return drawn;
}

/**
 * 그림 파트의 관계 파일 → «파일 이름 → 파트 경로». image 관계만, 파일 **안**을 가리키는 것만
 * (TargetMode="External" 은 뺀다). 이름이 겹치면 먼저 나온 것.
 */
function imagePartsByName(drawingPart: string, relsXml: string): Map<string, string> {
  const parts = new Map<string, string>();
  for (const match of relsXml.matchAll(/<Relationship\b[^>]*\/>/g)) {
    const tag = match[0];
    if (!/\/relationships\/image"/.test(tag)) continue;
    if (/\sTargetMode="External"/.test(tag)) continue;

    const target = /\sTarget="([^"]+)"/.exec(tag)?.[1];
    if (target === undefined) continue;
    const name = target.split("/").pop();
    if (name === undefined || name === "" || parts.has(name)) continue;
    parts.set(name, resolvePartPath(drawingPart, decodeXmlCharacterData(target)));
  }
  return parts;
}

/** `xl/drawings/drawing1.xml` + `../media/image1.png` → `xl/media/image1.png`. zip 안의 이름일 뿐이다. */
function resolvePartPath(fromPart: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const segments = fromPart.split("/").slice(0, -1);
  for (const piece of target.split("/")) {
    if (piece === "" || piece === ".") continue;
    if (piece === "..") segments.pop();
    else segments.push(piece);
  }
  return segments.join("/");
}

function startsWith(bytes: Buffer, signature: readonly number[]): boolean {
  if (bytes.length < signature.length) return false;
  return signature.every((value, index) => bytes[index] === value);
}

function formatMegabytes(bytes: number): string {
  const megabytes = bytes / (1024 * 1024);
  return `${Number.isInteger(megabytes) ? megabytes : megabytes.toFixed(1)}MB`;
}

// ── 저장소에서 읽기 ─────────────────────────────────────────────────────

/**
 * 저장소가 준 흐름을 끝까지 읽되 상한을 넘는 순간 멈춘다(첨부 상한 20MB — 메모리에 담아도
 * 된다). 올리기 통로가 이미 20MB 로 막았지만, 디스크의 파일을 믿지 않는다.
 */
export async function readAttachmentBytesWithinLimit(
  stream: ReadableStream<Uint8Array>,
  maxBytes: number
): Promise<{ ok: true; bytes: Buffer } | { ok: false }> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return { ok: false };
    }
    chunks.push(value);
  }
  return { ok: true, bytes: Buffer.concat(chunks, total) };
}
