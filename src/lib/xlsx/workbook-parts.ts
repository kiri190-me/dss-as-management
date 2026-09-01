import type { ZipArchive } from "./zip-reader";

/**
 * ============================================================================
 * 통합문서 껍데기를 손보는 일 — 세 채우개가 똑같이 하는 것들
 * ============================================================================
 * 내자·O/H·매쳐 채우개는 채우는 자리가 서로 다르지만, **파일을 내보내기 전에
 * 하는 뒷정리는 같다** — 시트 파트를 이름으로 찾고, 낡은 계산 캐시를 들어내고,
 * 줄이 밀렸으면 인쇄 영역을 따라 민다.
 *
 * 같은 코드를 세 벌 두면 한 벌만 고쳐지는 날이 온다. 그리고 그때 증상은
 * "어떤 종류의 견적서만 이상하다" 라서, 그 종류를 쓰는 사람이 말해 주기 전에는
 * 아무도 모른다.
 * ============================================================================
 */

export const CALC_CHAIN_PART = "xl/calcChain.xml";
export const CONTENT_TYPES_PART = "[Content_Types].xml";
export const WORKBOOK_PART = "xl/workbook.xml";
export const WORKBOOK_RELS_PART = "xl/_rels/workbook.xml.rels";
export const SHARED_STRINGS_PART = "xl/sharedStrings.xml";
export const STYLES_PART = "xl/styles.xml";

/**
 * 시트 이름 → 파트 경로.
 *
 * `sheet1.xml` 로 못 박지 않는다. 탭 순서가 바뀌면 아무 말 없이 **다른 시트**를
 * 채우게 되고, 그러면 값이 하나도 안 들어간 견적서가 나간다. 실제로 내자 양식은
 * 한 파일에 시트가 셋(`내자견적서`·`OH견적서`·`Sheet1`)이다.
 */
export function resolveSheetPart(archive: ZipArchive, sheetName: string): string {
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

/**
 * 열 때 전부 다시 계산하게 한다.
 *
 * 우리는 수식을 쓰되 **캐시값(`<v>`)은 남기지 않는다.** 우리가 셈해 넣은 값이
 * Excel 이 다시 계산한 값과 어긋날 수 있고, 어긋난 쪽이 화면에 먼저 보인다.
 */
export function enableFullCalcOnLoad(workbookXml: string): string {
  if (/<calcPr[^>]*fullCalcOnLoad="1"/.test(workbookXml)) return workbookXml;
  if (/<calcPr[^>]*\/>/.test(workbookXml)) {
    return workbookXml.replace(/<calcPr([^>]*)\/>/, '<calcPr$1 fullCalcOnLoad="1"/>');
  }
  if (workbookXml.includes("</workbook>")) {
    return workbookXml.replace("</workbook>", '<calcPr fullCalcOnLoad="1"/></workbook>');
  }
  throw new Error("workbook.xml 에 calcPr 을 넣을 자리를 찾지 못했습니다.");
}

/**
 * `calcChain.xml` 은 Excel 이 언제든 다시 만드는 캐시다. 우리가 수식을 고치거나
 * 줄을 밀면 그 파일이 시트와 어긋나므로 **파트째 들어낸다** — 참조 세 곳
 * (파트 자체, Content_Types, workbook.xml.rels)을 함께 지워야 한다. 하나라도
 * 남으면 Excel 이 "복구할 수 없는 내용" 대화상자를 띄운다.
 */
export function removeCalcChainOverride(contentTypesXml: string): string {
  const next = contentTypesXml.replace(/<Override[^>]*PartName="\/xl\/calcChain\.xml"[^>]*\/>/, "");
  if (next === contentTypesXml) {
    throw new Error("[Content_Types].xml 에서 calcChain 항목을 찾지 못했습니다.");
  }
  return next;
}

export function removeCalcChainRelationship(relsXml: string): string {
  const next = relsXml.replace(/<Relationship[^>]*Target="calcChain\.xml"[^>]*\/>/, "");
  if (next === relsXml) {
    throw new Error("workbook.xml.rels 에서 calcChain 관계를 찾지 못했습니다.");
  }
  return next;
}

/**
 * 🔴 인쇄 영역의 마지막 행을 밀린 만큼 민다.
 *
 * 양식들은 인쇄 영역이 합계 줄에 딱 맞춰져 있거나 그보다 몇 줄 아래까지다.
 * 줄이 늘었는데 여기를 안 밀면 **합계가 인쇄에서 잘린다.** 화면으로는 멀쩡해
 * 보여서 미리보기로는 못 잡는 종류의 사고다.
 *
 * ── 시트 이름을 견주는 이유 ────────────────────────────────────────────
 * 한 통합문서에 인쇄 영역이 여럿일 수 있다(내자 양식은 `내자견적서` 것과
 * `OH견적서` 것 둘을 갖고 있다). 우리가 채운 시트의 것만 밀어야 한다.
 *
 * 그 이름의 인쇄 영역이 **없으면 아무것도 하지 않는다.** 없는 것을 만들어 주면
 * 지금까지 인쇄 영역이 걸려 있지 않던 문서에 갑자기 걸려서, 우리가 손대기 전과
 * 인쇄 결과가 달라진다.
 */
export function shiftPrintArea(
  workbookXml: string,
  sheetName: string,
  rowShift: number
): string {
  if (rowShift === 0) return workbookXml;

  const pattern = /<definedName[^>]*name="_xlnm\.Print_Area"[^>]*>([^<]*)<\/definedName>/g;
  return workbookXml.replace(pattern, (whole, reference: string) => {
    if (referencedSheetName(reference) !== sheetName) return whole;
    const shifted = reference.replace(
      /(\$[A-Z]+\$)(\d+)\s*$/,
      (_all, column: string, row: string) => `${column}${Number(row) + rowShift}`
    );
    return whole.replace(reference, shifted);
  });
}

/**
 * 그 시트에 걸린 그림 파트(`xl/drawings/drawingN.xml`). 없으면 null.
 *
 * `drawing2.xml` 로 못 박지 않는다 — 시트 순서나 그림 개수가 바뀌면 **다른
 * 시트의 그림**을 고치게 되고, 그러면 손대지 않아야 할 문서가 망가진다.
 * 시트 파트의 관계 파일에서 `.../relationships/drawing` 을 찾는다.
 */
export function resolveSheetDrawingPart(archive: ZipArchive, sheetPart: string): string | null {
  const relsPart = sheetPart.replace(/([^/]+)$/, "_rels/$1.rels");
  const rels = archive.readTextOrNull(relsPart);
  if (rels === null) return null;

  const relTag = /<Relationship[^>]*Type="[^"]*\/relationships\/drawing"[^>]*>/.exec(rels);
  const target = relTag ? /Target="([^"]+)"/.exec(relTag[0])?.[1] : undefined;
  if (!target) return null;

  const part = resolvePartPath(sheetPart, target);
  return archive.has(part) ? part : null;
}

/** `xl/worksheets/sheet3.xml` + `../drawings/drawing2.xml` → `xl/drawings/drawing2.xml`. */
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

/**
 * 🔴 그림·도형이 붙어 있는 행을 밀린 만큼 민다.
 *
 * 그림 파트의 앵커는 행 번호를 **0부터** 세어 들고 있다
 * (`<xdr:from><xdr:row>30</xdr:row>` = 31행). 줄을 끼워 넣고 여기를 안 밀면
 * **표만 내려가고 도장과 글상자는 제자리에 남는다** — 인쇄해 보기 전에는 잘
 * 안 보이는 종류의 사고다.
 *
 * @param fromRow **0부터 세는** 삽입 지점. 이 값 이상인 앵커가 밀린다.
 */
export function shiftDrawingAnchorRows(
  drawingXml: string,
  fromRow: number,
  delta: number
): string {
  if (delta === 0) return drawingXml;
  // 접두사(`xdr:`)를 그대로 되받는다. 접두사 없는 `<row …>` 은 시트의 행 태그라
  // 여기서 절대 건드리면 안 되므로 접두사를 **반드시** 요구한다.
  return drawingXml.replace(/<(\w+):row>(\d+)<\/\1:row>/g, (whole, prefix: string, row: string) => {
    const rowNumber = Number(row);
    return rowNumber >= fromRow ? `<${prefix}:row>${rowNumber + delta}</${prefix}:row>` : whole;
  });
}

/** `견적서!$A$1:$I$60` 또는 `'내 시트'!$A$1:$I$60` → 시트 이름. */
function referencedSheetName(reference: string): string | null {
  const found = /^\s*(?:'([^']*)'|([^!']+))!/.exec(reference);
  if (!found) return null;
  return found[1] ?? found[2] ?? null;
}

// ── 서식(styles.xml) 을 늘린다 ───────────────────────────────────────────

/**
 * `<cellXfs>` 안의 `<xf>` 하나. 자체닫힘(`<xf …/>`)과 자식이 있는 것
 * (`<xf …><alignment …/></xf>`)을 모두 잡는다.
 *
 * 🔴 `[^>]*` 를 **탐욕적으로** 쓰면 안 된다. 자체닫힘의 `/` 까지 삼킨 뒤
 * `>` 로 이어 붙어 **다음 xf 까지 통째로 한 덩이**가 되고, 그러면 번호가
 * 밀린다 — 그 번호로 셀 서식을 가리키면 문서 전체의 서식이 어긋난다
 * (실측: 그 상태로 세면 497개가 471개로 읽힌다).
 */
const CELL_XF = /<xf\b[^>]*?(?:\/>|>[\s\S]*?<\/xf>)/g;

/**
 * 🔴 **기존 `xf` 를 고치지 않고, 정렬만 바꾼 사본을 맨 뒤에 더한다.**
 *
 * 양식의 `xf` 하나는 여러 칸이 함께 쓴다. 검사·수리 보고서에서는 본문 **내용
 * 칸과 라벨 칸이 같은 번호**를 쓴다(실측: 수리 31행 472 / 가운뎃줄 363,
 * 검사 31행 381 / 가운뎃줄 354). 그래서 그 `xf` 의 정렬을 바꾸면 내용만이
 * 아니라 라벨까지 따라 움직인다. 사본을 더하고 **바꿀 칸만** 새 번호를
 * 가리키게 하는 것이 유일하게 안전한 길이다.
 *
 * 그 밖의 것(글꼴·테두리·배경·숫자 서식)은 원본에서 그대로 물려받는다 —
 * 특히 **본문 마지막 줄의 아래 테두리**가 여기에 걸려 있다.
 *
 * ⚠️ `count` 를 함께 고친다. 실제 개수와 다르면 Excel 이 파일을 거부한다.
 *
 * @param sources 사본을 뜰 원본 `xf` 번호들.
 * @returns `xml` 과 **원본 번호 → 쓸 번호** 표. 원본이 이미 그 정렬이면
 *          자기 번호가 그대로 돌아온다(쓸데없이 `xf` 를 늘리지 않는다).
 */
export function addAlignedCellXfs(
  stylesXml: string,
  sources: readonly number[],
  horizontal: string
): { xml: string; indexBySource: Map<number, number> } {
  const block = /(<cellXfs\b[^>]*>)([\s\S]*?)(<\/cellXfs>)/.exec(stylesXml);
  if (!block) throw new Error("양식의 styles.xml 에서 <cellXfs> 를 찾지 못했습니다.");

  const xfs = [...block[2].matchAll(CELL_XF)].map((match) => match[0]);
  const declared = Number(/\scount="(\d+)"/.exec(block[1])?.[1]);
  if (!Number.isInteger(declared) || declared !== xfs.length) {
    // 여기가 어긋나면 우리가 세는 방식이 틀린 것이다. 짐작해서 더하면 문서가 깨진다.
    throw new Error(
      `styles.xml 의 cellXfs count(${String(declared)})가 실제 개수(${xfs.length})와 다릅니다.`
    );
  }

  const indexBySource = new Map<number, number>();
  const added: string[] = [];
  for (const source of [...new Set(sources)].sort((a, b) => a - b)) {
    const original = xfs[source];
    if (original === undefined) {
      throw new Error(`styles.xml 에 ${source}번 서식이 없습니다(cellXfs 는 ${xfs.length}개).`);
    }
    if (readHorizontalAlignment(original) === horizontal) {
      indexBySource.set(source, source);
      continue;
    }

    const clone = withHorizontalAlignment(original, horizontal);
    // 똑같은 서식이 이미 있으면 그것을 쓴다 — 같은 파일을 두 번 손봐도 안 늘어난다.
    const existing = xfs.indexOf(clone);
    if (existing !== -1) {
      indexBySource.set(source, existing);
      continue;
    }
    indexBySource.set(source, xfs.length);
    xfs.push(clone);
    added.push(clone);
  }

  if (added.length === 0) return { xml: stylesXml, indexBySource };

  const open = block[1].replace(/\scount="\d+"/, ` count="${xfs.length}"`);
  const next = `${open}${block[2]}${added.join("")}${block[3]}`;
  return {
    xml: stylesXml.slice(0, block.index) + next + stylesXml.slice(block.index + block[0].length),
    indexBySource,
  };
}

function readHorizontalAlignment(xf: string): string | null {
  return /<alignment\b[^>]*\shorizontal="([^"]*)"/.exec(xf)?.[1] ?? null;
}

/**
 * `xf` 사본에서 **가로 맞춤만** 바꾼다. 나머지 속성과 자식은 손대지 않는다.
 *
 * `<alignment>` 가 없으면 **여는 태그 바로 뒤**에 넣는다 — OOXML 의 `CT_Xf` 는
 * `alignment` → `protection` 순서를 요구하므로, 뒤에 붙이면 `protection` 이
 * 있는 서식에서 순서가 뒤집혀 Excel 이 파일을 거부한다.
 */
function withHorizontalAlignment(xf: string, horizontal: string): string {
  const selfClosing = !xf.includes("</xf>");
  const openEnd = xf.indexOf(">") + 1;
  let open = xf.slice(0, openEnd);
  let inner = selfClosing ? "" : xf.slice(openEnd, xf.lastIndexOf("</xf>"));

  if (selfClosing) open = open.replace(/\s*\/>$/, ">");
  open = /\sapplyAlignment="[^"]*"/.test(open)
    ? open.replace(/\sapplyAlignment="[^"]*"/, ' applyAlignment="1"')
    : open.replace(/>$/, ' applyAlignment="1">');

  const alignment = /<alignment\b[^>]*\/>|<alignment\b[^>]*>[\s\S]*?<\/alignment>/.exec(inner)?.[0];
  if (alignment === undefined) {
    inner = `<alignment horizontal="${horizontal}"/>${inner}`;
  } else {
    const replaced = /\shorizontal="[^"]*"/.test(alignment)
      ? alignment.replace(/\shorizontal="[^"]*"/, ` horizontal="${horizontal}"`)
      : alignment.replace(/^<alignment/, `<alignment horizontal="${horizontal}"`);
    inner = inner.replace(alignment, replaced);
  }
  return `${open}${inner}</xf>`;
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
