import { extname } from "node:path";
import { readFileSync, statSync } from "node:fs";
import { decodeXmlEntities } from "./ooxml-parser";
import { ZipArchive } from "./zip-reader";

export const REPAIR_CASE_XLSX_SAFETY_LIMITS = {
  maxCompressedBytes: 20 * 1024 * 1024,
  maxZipEntries: 2_000,
  maxEntryUncompressedBytes: 25 * 1024 * 1024,
  maxTotalUncompressedBytes: 100 * 1024 * 1024,
  maxCompressionRatio: 200,
  maxWorksheetDataRows: 10_000,
  maxParsedCells: 250_000,
  maxCellTextLength: 32_767,
} as const;

export type RepairCaseXlsxSafetyLimits = {
  [K in keyof typeof REPAIR_CASE_XLSX_SAFETY_LIMITS]: number;
};

export type RepairCaseXlsxSafetyCode =
  | "UNSUPPORTED_FILE_EXTENSION"
  | "COMPRESSED_UPLOAD_SIZE_LIMIT_EXCEEDED"
  | "INVALID_ZIP_SIGNATURE"
  | "INVALID_OOXML_PACKAGE"
  | "MACRO_CONTENT_DETECTED"
  | "ACTIVEX_CONTENT_DETECTED"
  | "OLE_EMBEDDED_CONTENT_DETECTED"
  | "EXTERNAL_WORKBOOK_LINK_DETECTED"
  | "DDE_FORMULA_DETECTED"
  | "ZIP_PATH_TRAVERSAL_DETECTED"
  | "DUPLICATE_ZIP_ENTRY_DETECTED"
  | "ZIP_ENTRY_LIMIT_EXCEEDED"
  | "ZIP_ENTRY_SIZE_LIMIT_EXCEEDED"
  | "ZIP_TOTAL_UNCOMPRESSED_LIMIT_EXCEEDED"
  | "ZIP_COMPRESSION_RATIO_LIMIT_EXCEEDED"
  | "WORKSHEET_ROW_LIMIT_EXCEEDED"
  | "WORKSHEET_CELL_LIMIT_EXCEEDED"
  | "CELL_TEXT_LIMIT_EXCEEDED"
  | "HYPERLINK_PRESENT";

export type RepairCaseXlsxSafetyIssue = {
  code: RepairCaseXlsxSafetyCode;
  severity: "ERROR" | "WARNING";
};

export type RepairCaseXlsxSafetyResult = {
  ok: boolean;
  issues: RepairCaseXlsxSafetyIssue[];
};

export type RepairCaseXlsxSafetyOptions = {
  limits?: Partial<RepairCaseXlsxSafetyLimits>;
};

const REQUIRED_PACKAGE_ENTRIES = [
  "[Content_Types].xml",
  "_rels/.rels",
  "xl/workbook.xml",
  "xl/_rels/workbook.xml.rels",
] as const;

const ORDINARY_WORKBOOK_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml";

function issue(code: RepairCaseXlsxSafetyCode, severity: "ERROR" | "WARNING" = "ERROR") {
  return { code, severity } as const;
}

function hasZipSignature(bytes: Buffer): boolean {
  if (bytes.length < 4) return false;
  const signature = bytes.readUInt32LE(0);
  return signature === 0x04034b50 || signature === 0x06054b50 || signature === 0x08074b50;
}

function isUnsafeZipPath(name: string): boolean {
  const normalized = name.replace(/\\/g, "/");
  return (
    normalized.startsWith("/") ||
    /^[A-Za-z]:/.test(normalized) ||
    normalized.split("/").some((part) => part === "..")
  );
}

function exceedsCompressionRatio(
  compressedSize: number,
  uncompressedSize: number,
  maxRatio: number
): boolean {
  if (uncompressedSize === 0) return false;
  if (compressedSize === 0) return true;
  // A 64-byte denominator floor avoids unstable ratios for harmless tiny
  // metadata entries while large expansion is still caught by size caps.
  return uncompressedSize / Math.max(compressedSize, 64) > maxRatio;
}

function formulaSafetyCodes(xml: string): RepairCaseXlsxSafetyCode[] {
  const codes = new Set<RepairCaseXlsxSafetyCode>();
  const formulaRe = /<f(?:\s[^>]*)?>([\s\S]*?)<\/f>/g;
  let match: RegExpExecArray | null;
  while ((match = formulaRe.exec(xml))) {
    const formula = decodeXmlEntities(match[1]);
    if (/[^|]{0,200}\|[^!]{0,200}!/.test(formula)) codes.add("DDE_FORMULA_DETECTED");
    if (/\[[^\]]+]\s*[^!]*!/.test(formula)) codes.add("EXTERNAL_WORKBOOK_LINK_DETECTED");
  }
  return [...codes];
}

function maxTextNodeGroupLength(xml: string): number {
  let maximum = 0;
  const groups = xml.match(/<si\b[\s\S]*?<\/si>|<is\b[\s\S]*?<\/is>/g) ?? [];
  for (const group of groups) {
    let length = 0;
    const textRe = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g;
    let match: RegExpExecArray | null;
    while ((match = textRe.exec(group))) length += decodeXmlEntities(match[1]).length;
    maximum = Math.max(maximum, length);
  }
  return maximum;
}

export function validateRepairCaseXlsxBuffer(
  bytes: Buffer,
  fileName: string,
  options: RepairCaseXlsxSafetyOptions = {}
): RepairCaseXlsxSafetyResult {
  const limits: RepairCaseXlsxSafetyLimits = {
    ...REPAIR_CASE_XLSX_SAFETY_LIMITS,
    ...options.limits,
  };
  const issues: RepairCaseXlsxSafetyIssue[] = [];

  if (extname(fileName).toLowerCase() !== ".xlsx") {
    issues.push(issue("UNSUPPORTED_FILE_EXTENSION"));
  }
  if (bytes.length > limits.maxCompressedBytes) {
    issues.push(issue("COMPRESSED_UPLOAD_SIZE_LIMIT_EXCEEDED"));
  }
  if (!hasZipSignature(bytes)) {
    issues.push(issue("INVALID_ZIP_SIGNATURE"));
    return { ok: false, issues };
  }

  let archive: ZipArchive;
  try {
    archive = ZipArchive.fromBuffer(bytes);
  } catch {
    issues.push(issue("INVALID_OOXML_PACKAGE"));
    return { ok: false, issues };
  }

  if (archive.entryCount() > limits.maxZipEntries) issues.push(issue("ZIP_ENTRY_LIMIT_EXCEEDED"));
  if (archive.hasDuplicateEntryNames()) issues.push(issue("DUPLICATE_ZIP_ENTRY_DETECTED"));

  const entries = archive.listEntries();
  let totalUncompressed = 0;
  for (const entry of entries) {
    totalUncompressed += entry.uncompressedSize;
    if (isUnsafeZipPath(entry.name)) issues.push(issue("ZIP_PATH_TRAVERSAL_DETECTED"));
    if (entry.compressionMethod !== 0 && entry.compressionMethod !== 8) {
      issues.push(issue("INVALID_OOXML_PACKAGE"));
    }
    if (entry.uncompressedSize > limits.maxEntryUncompressedBytes) {
      issues.push(issue("ZIP_ENTRY_SIZE_LIMIT_EXCEEDED"));
    }
    if (
      exceedsCompressionRatio(
        entry.compressedSize,
        entry.uncompressedSize,
        limits.maxCompressionRatio
      )
    ) {
      issues.push(issue("ZIP_COMPRESSION_RATIO_LIMIT_EXCEEDED"));
    }
  }
  if (totalUncompressed > limits.maxTotalUncompressedBytes) {
    issues.push(issue("ZIP_TOTAL_UNCOMPRESSED_LIMIT_EXCEEDED"));
  }

  const entryNames = archive.list();
  if (entryNames.some((name) => /(^|\/)vbaProject\.bin$/i.test(name))) {
    issues.push(issue("MACRO_CONTENT_DETECTED"));
  }
  if (entryNames.some((name) => /(^|\/)activeX\//i.test(name))) {
    issues.push(issue("ACTIVEX_CONTENT_DETECTED"));
  }
  if (entryNames.some((name) => /(^|\/)(embeddings|oleObjects)\//i.test(name))) {
    issues.push(issue("OLE_EMBEDDED_CONTENT_DETECTED"));
  }
  if (entryNames.some((name) => /^xl\/externalLinks\//i.test(name))) {
    issues.push(issue("EXTERNAL_WORKBOOK_LINK_DETECTED"));
  }

  if (issues.some((candidate) => candidate.severity === "ERROR")) {
    return { ok: false, issues: deduplicateIssues(issues) };
  }

  if (REQUIRED_PACKAGE_ENTRIES.some((name) => !archive.has(name))) {
    issues.push(issue("INVALID_OOXML_PACKAGE"));
    return { ok: false, issues: deduplicateIssues(issues) };
  }

  try {
    const contentTypes = archive.readText(
      "[Content_Types].xml",
      limits.maxEntryUncompressedBytes
    );
    if (/macroEnabled|vbaProject/i.test(contentTypes)) issues.push(issue("MACRO_CONTENT_DETECTED"));
    if (/activeX/i.test(contentTypes)) issues.push(issue("ACTIVEX_CONTENT_DETECTED"));
    if (
      /application\/vnd\.(?:openxmlformats-officedocument\.(?:oleObject|package)|ms-package)/i.test(
        contentTypes
      )
    ) {
      issues.push(issue("OLE_EMBEDDED_CONTENT_DETECTED"));
    }
    if (!contentTypes.includes(ORDINARY_WORKBOOK_CONTENT_TYPE)) {
      issues.push(issue("INVALID_OOXML_PACKAGE"));
    }

    let totalCells = 0;
    let hyperlinkFound = false;
    for (const name of entryNames.filter((entry) => /^xl\/worksheets\/[^/]+\.xml$/i.test(entry))) {
      const xml = archive.readText(name, limits.maxEntryUncompressedBytes);
      const dataRowCount = [...xml.matchAll(/<row\b[^>]*\br="(\d+)"/g)].filter(
        (match) => Number(match[1]) >= 4
      ).length;
      if (dataRowCount > limits.maxWorksheetDataRows) {
        issues.push(issue("WORKSHEET_ROW_LIMIT_EXCEEDED"));
      }
      totalCells += (xml.match(/<c\b/g) ?? []).length;
      for (const code of formulaSafetyCodes(xml)) issues.push(issue(code));
      if (/<hyperlink\b/.test(xml)) hyperlinkFound = true;
      if (maxTextNodeGroupLength(xml) > limits.maxCellTextLength) {
        issues.push(issue("CELL_TEXT_LIMIT_EXCEEDED"));
      }
    }
    if (totalCells > limits.maxParsedCells) issues.push(issue("WORKSHEET_CELL_LIMIT_EXCEEDED"));

    const sharedStrings = archive.readTextOrNull(
      "xl/sharedStrings.xml",
      limits.maxEntryUncompressedBytes
    );
    if (sharedStrings && maxTextNodeGroupLength(sharedStrings) > limits.maxCellTextLength) {
      issues.push(issue("CELL_TEXT_LIMIT_EXCEEDED"));
    }
    if (hyperlinkFound) issues.push(issue("HYPERLINK_PRESENT", "WARNING"));
  } catch {
    issues.push(issue("INVALID_OOXML_PACKAGE"));
  }

  const deduplicated = deduplicateIssues(issues);
  return { ok: !deduplicated.some((candidate) => candidate.severity === "ERROR"), issues: deduplicated };
}

export function validateRepairCaseXlsxFile(
  filePath: string,
  options: RepairCaseXlsxSafetyOptions = {}
): RepairCaseXlsxSafetyResult {
  const fileSize = statSync(filePath).size;
  if (fileSize > (options.limits?.maxCompressedBytes ?? REPAIR_CASE_XLSX_SAFETY_LIMITS.maxCompressedBytes)) {
    return { ok: false, issues: [issue("COMPRESSED_UPLOAD_SIZE_LIMIT_EXCEEDED")] };
  }
  return validateRepairCaseXlsxBuffer(readFileSync(filePath), filePath, options);
}

function deduplicateIssues(issues: RepairCaseXlsxSafetyIssue[]): RepairCaseXlsxSafetyIssue[] {
  const seen = new Set<string>();
  return issues.filter((candidate) => {
    const key = `${candidate.severity}:${candidate.code}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
