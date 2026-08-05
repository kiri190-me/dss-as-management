/**
 * Deterministic, regex-based OOXML XML parsing for exactly the subset of
 * spreadsheetml/drawingml this importer needs (shared strings, worksheet
 * cells/merges/hyperlinks, drawing shapes/connectors/pictures). Ported and
 * cleaned up from the extraction script used to write the Phase 1 report,
 * which was validated against the real 18-sheet workbook.
 *
 * No AI interpretation anywhere in this file: every value returned is
 * either copied verbatim from the XML or is a structural fact (a shape id,
 * a merge range, a connector's endpoint ids) mechanically derived from it.
 */

export function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

export function colLettersToNum(letters: string): number {
  let n = 0;
  for (let i = 0; i < letters.length; i++) {
    n = n * 26 + (letters.charCodeAt(i) - 64);
  }
  return n;
}

export function splitCellRef(ref: string): { col: string; row: number } {
  const m = ref.match(/^([A-Z]+)(\d+)$/);
  if (!m) throw new Error(`Not a cell reference: "${ref}"`);
  return { col: m[1], row: parseInt(m[2], 10) };
}

// ---- shared strings ----

export function parseSharedStrings(xml: string | null): string[] {
  if (!xml) return [];
  const items: string[] = [];
  const siRe = /<si>([\s\S]*?)<\/si>/g;
  let m: RegExpExecArray | null;
  while ((m = siRe.exec(xml))) {
    const body = m[1];
    const tRe = /<t[^>]*>([\s\S]*?)<\/t>/g;
    let tm: RegExpExecArray | null;
    let text = "";
    while ((tm = tRe.exec(body))) text += tm[1];
    items.push(decodeXmlEntities(text));
  }
  return items;
}

// ---- workbook.xml ----

export type WorkbookSheetRef = { name: string; sheetId: string; rId: string };

export function parseWorkbookSheets(xml: string): WorkbookSheetRef[] {
  const sheets: WorkbookSheetRef[] = [];
  const sheetRe = /<sheet name="([^"]+)" sheetId="(\d+)" (?:state="[^"]+" )?r:id="(rId\d+)"\/>/g;
  let m: RegExpExecArray | null;
  while ((m = sheetRe.exec(xml))) {
    sheets.push({ name: decodeXmlEntities(m[1]), sheetId: m[2], rId: m[3] });
  }
  return sheets;
}

// ---- generic .rels files ----

export function parseRels(xml: string | null): Record<string, string> {
  const map: Record<string, string> = {};
  if (!xml) return map;
  const re = /<Relationship Id="([^"]+)"[^>]*Target="([^"]+)"(?:[^>]*TargetMode="([^"]+)")?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    map[m[1]] = decodeXmlEntities(m[2]);
  }
  return map;
}

// ---- worksheet ----

export type Hyperlink = {
  ref: string | null;
  rId: string | null;
  location: string | null;
  display: string | null;
  target: string | null;
};

export type ParsedWorksheet = {
  dimension: string | null;
  merges: string[];
  hyperlinks: Hyperlink[];
  cells: Record<string, string>;
};

export function parseWorksheet(
  xml: string,
  sharedStrings: string[],
  sheetRels: Record<string, string>
): ParsedWorksheet {
  const dimM = xml.match(/<dimension ref="([^"]+)"/);
  const dimension = dimM ? dimM[1] : null;

  const merges: string[] = [];
  const mergeBlockM = xml.match(/<mergeCells[^>]*>([\s\S]*?)<\/mergeCells>/);
  if (mergeBlockM) {
    const mcRe = /<mergeCell ref="([^"]+)"\/>/g;
    let mm: RegExpExecArray | null;
    while ((mm = mcRe.exec(mergeBlockM[1]))) merges.push(mm[1]);
  }

  const hyperlinks: Hyperlink[] = [];
  const hlBlockM = xml.match(/<hyperlinks>([\s\S]*?)<\/hyperlinks>/);
  if (hlBlockM) {
    const hlRe = /<hyperlink ([^>]+)\/?>/g;
    let hm: RegExpExecArray | null;
    while ((hm = hlRe.exec(hlBlockM[1]))) {
      const attrs = hm[1];
      const refM = attrs.match(/ref="([^"]+)"/);
      const ridM = attrs.match(/r:id="([^"]+)"/);
      const locM = attrs.match(/location="([^"]+)"/);
      const displayM = attrs.match(/display="([^"]+)"/);
      hyperlinks.push({
        ref: refM ? refM[1] : null,
        rId: ridM ? ridM[1] : null,
        location: locM ? decodeXmlEntities(locM[1]) : null,
        display: displayM ? decodeXmlEntities(displayM[1]) : null,
        target: ridM && sheetRels[ridM[1]] ? sheetRels[ridM[1]] : null,
      });
    }
  }

  const cells: Record<string, string> = {};
  const rowRe = /<row r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g;
  let rm: RegExpExecArray | null;
  while ((rm = rowRe.exec(xml))) {
    const rowBody = rm[2];
    const cRe = /<c r="([A-Z]+\d+)"([^>]*)>([\s\S]*?)<\/c>|<c r="([A-Z]+\d+)"([^>]*)\/>/g;
    let cm: RegExpExecArray | null;
    while ((cm = cRe.exec(rowBody))) {
      const ref = cm[1] || cm[4];
      const attrs = cm[2] || cm[5] || "";
      const body = cm[3] || "";
      const tMatch = attrs.match(/t="([^"]+)"/);
      const type = tMatch ? tMatch[1] : "n";
      let value: string | null = null;
      if (type === "s") {
        const vM = body.match(/<v>([\s\S]*?)<\/v>/);
        if (vM) value = sharedStrings[parseInt(vM[1], 10)] ?? "";
      } else if (type === "inlineStr") {
        const tM = body.match(/<t[^>]*>([\s\S]*?)<\/t>/);
        if (tM) value = decodeXmlEntities(tM[1]);
      } else if (type === "str") {
        const vM = body.match(/<v>([\s\S]*?)<\/v>/);
        if (vM) value = decodeXmlEntities(vM[1]);
      } else if (type === "e") {
        // Formula-error cell (e.g. #VALUE!) — the raw error token itself is
        // the content the importer needs (to raise a FORMULA_ERROR
        // validation issue), not a computed value.
        const vM = body.match(/<v>([\s\S]*?)<\/v>/);
        if (vM) value = decodeXmlEntities(vM[1]);
      } else {
        const vM = body.match(/<v>([\s\S]*?)<\/v>/);
        if (vM) value = vM[1];
      }
      if (value !== null && value !== "") cells[ref] = value;
    }
  }

  return { dimension, merges, hyperlinks, cells };
}

// ---- drawing (shapes / connectors / pictures / groups) ----

export type DrawingPos = { col: number; row: number };

export type DrawingShape = {
  kind: "shape";
  id: string | null;
  name: string | null;
  descr: string | null;
  geom: string | null;
  text: string;
  fill: string | null;
  from: DrawingPos | null;
  to: DrawingPos | null;
};

export type DrawingConnector = {
  kind: "connector";
  id: string | null;
  name: string | null;
  geom: string | null;
  stCxnId: string | null;
  endCxnId: string | null;
  headType: string;
  tailType: string;
  from: DrawingPos | null;
  to: DrawingPos | null;
};

export type DrawingPicture = {
  kind: "picture";
  id: string | null;
  name: string | null;
  descr: string | null;
  from: DrawingPos | null;
  to: DrawingPos | null;
};

export type DrawingGroup = {
  kind: "group";
  childShapeCount: number;
  childConnectorCount: number;
  text: string;
  from: DrawingPos | null;
  to: DrawingPos | null;
};

export type DrawingAnchor = DrawingShape | DrawingConnector | DrawingPicture | DrawingGroup;

export function parseDrawing(xml: string): DrawingAnchor[] {
  const anchors: DrawingAnchor[] = [];
  const anchorRe = /<xdr:(twoCellAnchor|oneCellAnchor)(?:[^>]*)>([\s\S]*?)<\/xdr:\1>/g;
  let am: RegExpExecArray | null;
  while ((am = anchorRe.exec(xml))) {
    const body = am[2];
    const fromM = body.match(
      /<xdr:from>[\s\S]*?<xdr:col>(\d+)<\/xdr:col>[\s\S]*?<xdr:row>(\d+)<\/xdr:row>[\s\S]*?<\/xdr:from>/
    );
    const toM = body.match(
      /<xdr:to>[\s\S]*?<xdr:col>(\d+)<\/xdr:col>[\s\S]*?<xdr:row>(\d+)<\/xdr:row>[\s\S]*?<\/xdr:to>/
    );
    const from: DrawingPos | null = fromM
      ? { col: parseInt(fromM[1], 10), row: parseInt(fromM[2], 10) }
      : null;
    const to: DrawingPos | null = toM
      ? { col: parseInt(toM[1], 10), row: parseInt(toM[2], 10) }
      : null;

    const spM = body.match(/<xdr:sp[^>]*>([\s\S]*?)<\/xdr:sp>/);
    const cxnM = body.match(/<xdr:cxnSp[^>]*>([\s\S]*?)<\/xdr:cxnSp>/);
    const picM = body.match(/<xdr:pic[^>]*>([\s\S]*?)<\/xdr:pic>/);
    const grpM = body.match(/<xdr:grpSp[^>]*>([\s\S]*?)<\/xdr:grpSp>/);

    if (spM) {
      const sp = spM[1];
      const idM = sp.match(/<xdr:cNvPr id="(\d+)" name="([^"]*)"(?:[^>]*descr="([^"]*)")?/);
      const geomM = sp.match(/<a:prstGeom prst="([^"]+)"/);
      const txBodyM = sp.match(/<xdr:txBody>([\s\S]*?)<\/xdr:txBody>/);
      let text = "";
      if (txBodyM) {
        const paras = txBodyM[1].match(/<a:p>[\s\S]*?<\/a:p>/g) ?? [];
        text = paras
          .map((p) => {
            const ts = p.match(/<a:t>([\s\S]*?)<\/a:t>/g) ?? [];
            return ts.map((t) => decodeXmlEntities(t.replace(/<a:t>|<\/a:t>/g, ""))).join("");
          })
          .filter((l) => l.length > 0)
          .join("\n");
      }
      const fillM = sp.match(/<a:solidFill>[\s\S]*?<a:srgbClr val="([0-9A-Fa-f]{6})"/);
      anchors.push({
        kind: "shape",
        id: idM ? idM[1] : null,
        name: idM ? idM[2] : null,
        descr: idM ? idM[3] ?? null : null,
        geom: geomM ? geomM[1] : null,
        text,
        fill: fillM ? fillM[1] : null,
        from,
        to,
      });
    } else if (cxnM) {
      const cx = cxnM[1];
      const idM = cx.match(/<xdr:cNvPr id="(\d+)" name="([^"]*)"/);
      const geomM = cx.match(/<a:prstGeom prst="([^"]+)"/);
      const stM = cx.match(/<a:stCxn id="(\d+)"[^/]*idx="(\d+)"/);
      const endM = cx.match(/<a:endCxn id="(\d+)"[^/]*idx="(\d+)"/);
      const headM = cx.match(/<a:headEnd type="([^"]+)"/);
      const tailM = cx.match(/<a:tailEnd type="([^"]+)"/);
      anchors.push({
        kind: "connector",
        id: idM ? idM[1] : null,
        name: idM ? idM[2] : null,
        geom: geomM ? geomM[1] : null,
        stCxnId: stM ? stM[1] : null,
        endCxnId: endM ? endM[1] : null,
        headType: headM ? headM[1] : "none",
        tailType: tailM ? tailM[1] : "none",
        from,
        to,
      });
    } else if (picM) {
      const pc = picM[1];
      const idM = pc.match(/<xdr:cNvPr id="(\d+)" name="([^"]*)"(?:[^>]*descr="([^"]*)")?/);
      anchors.push({
        kind: "picture",
        id: idM ? idM[1] : null,
        name: idM ? idM[2] : null,
        descr: idM ? idM[3] ?? null : null,
        from,
        to,
      });
    } else if (grpM) {
      const childShapeCount = (grpM[1].match(/<xdr:sp[^>]*>/g) ?? []).length;
      const childConnectorCount = (grpM[1].match(/<xdr:cxnSp[^>]*>/g) ?? []).length;
      const texts: string[] = [];
      const txRe = /<a:t>([\s\S]*?)<\/a:t>/g;
      let txm: RegExpExecArray | null;
      while ((txm = txRe.exec(grpM[1]))) {
        const t = decodeXmlEntities(txm[1]);
        if (t.trim()) texts.push(t);
      }
      anchors.push({
        kind: "group",
        childShapeCount,
        childConnectorCount,
        text: texts.join(" | "),
        from,
        to,
      });
    }
    // Anchors with no recognized child (e.g. a bare graphicFrame/chart) are
    // silently skipped here — none exist in the source workbook (verified
    // during the Phase 1 inspection), and any future sheet that introduces
    // one will simply not contribute a shape/connector, not crash the
    // import; UNSUPPORTED_OBJECT issue reporting for that case is the
    // importer's job, not this low-level parser's.
  }
  return anchors;
}
