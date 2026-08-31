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

/** `견적서!$A$1:$I$60` 또는 `'내 시트'!$A$1:$I$60` → 시트 이름. */
function referencedSheetName(reference: string): string | null {
  const found = /^\s*(?:'([^']*)'|([^!']+))!/.exec(reference);
  if (!found) return null;
  return found[1] ?? found[2] ?? null;
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
