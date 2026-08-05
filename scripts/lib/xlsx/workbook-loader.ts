import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { ZipArchive } from "./zip-reader";
import {
  parseDrawing,
  parseRels,
  parseSharedStrings,
  parseWorkbookSheets,
  parseWorksheet,
  type DrawingAnchor,
  type ParsedWorksheet,
} from "./ooxml-parser";

export type LoadedSheet = {
  name: string;
  sheetId: string;
  worksheetPath: string;
  drawingPath: string | null;
  worksheet: ParsedWorksheet;
  drawing: DrawingAnchor[] | null;
};

export type LoadedWorkbook = {
  sourceFileName: string;
  sourceFileHash: string;
  sheets: LoadedSheet[];
};

/** sha256 of the raw file bytes — what makes the importer idempotent (§ importer). */
export function hashWorkbookFile(filePath: string): string {
  const bytes = readFileSync(filePath);
  return createHash("sha256").update(bytes).digest("hex");
}

export function loadWorkbook(filePath: string): LoadedWorkbook {
  const zip = ZipArchive.fromFile(filePath);
  const sourceFileHash = hashWorkbookFile(filePath);
  const sourceFileName = filePath.split(/[/\\]/).pop() ?? filePath;

  const workbookXml = zip.readText("xl/workbook.xml");
  const workbookRels = parseRels(zip.readTextOrNull("xl/_rels/workbook.xml.rels"));
  const sheetRefs = parseWorkbookSheets(workbookXml);
  const sharedStrings = parseSharedStrings(zip.readTextOrNull("xl/sharedStrings.xml"));

  const sheets: LoadedSheet[] = [];
  for (const ref of sheetRefs) {
    const target = workbookRels[ref.rId];
    if (!target || !target.startsWith("worksheets/")) continue;
    const worksheetPath = `xl/${target}`;
    const sheetBase = target.replace(/^worksheets\//, "").replace(/\.xml$/, "");
    const sheetRelsPath = `xl/worksheets/_rels/${sheetBase}.xml.rels`;
    const sheetRels = parseRels(zip.readTextOrNull(sheetRelsPath));

    const worksheetXml = zip.readTextOrNull(worksheetPath);
    if (!worksheetXml) continue;
    const worksheet = parseWorksheet(worksheetXml, sharedStrings, sheetRels);

    let drawingPath: string | null = null;
    let drawing: DrawingAnchor[] | null = null;
    for (const target of Object.values(sheetRels)) {
      if (target.includes("drawings/drawing")) {
        drawingPath = `xl/${target.replace("../", "")}`;
        const drawingXml = zip.readTextOrNull(drawingPath);
        drawing = drawingXml ? parseDrawing(drawingXml) : null;
      }
    }

    sheets.push({
      name: ref.name,
      sheetId: ref.sheetId,
      worksheetPath,
      drawingPath,
      worksheet,
      drawing,
    });
  }

  return { sourceFileName, sourceFileHash, sheets };
}
