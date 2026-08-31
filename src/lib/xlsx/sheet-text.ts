import type { ZipArchive } from "./zip-reader";
import { findCell } from "./sheet-patch";

/**
 * ============================================================================
 * 양식에서 셀의 **글자**를 읽는다
 * ============================================================================
 * `sheet-patch.ts` 는 쓰는 쪽이라 셀 요소를 통째로 다루고, 공유문자열
 * (`t="s"` → sharedStrings 의 인덱스)을 풀지 않는다. 여기는 읽는 쪽이라 그
 * 인덱스를 실제 글자로 바꿔 준다.
 *
 * 견적서 미리보기가 회사 정보와 기본 문구를 양식에서 읽어 오는 데 쓴다
 * (storage/quote-template.ts 의 readQuoteTemplateHeader — 계좌번호를 코드에
 * 두지 않으면서 화면에는 정본과 같은 값을 내보내기 위한 길이다).
 *
 * **못 찾은 칸은 조용히 건너뛴다.** 쓰는 쪽과 규칙이 반대인데, 이유는 결과가
 * 다르기 때문이다: 값을 못 써 넣으면 빈 견적서가 고객사로 나가지만, 값을 못
 * 읽으면 미리보기의 한 줄이 비는 것뿐이다. 그것 때문에 미리보기 전체가
 * 실패하는 편이 더 나쁘다.
 * ============================================================================
 */

/** 공유문자열 하나 — `<si>` 안의 `<t>` 조각을 전부 이어 붙인다(서식이 섞이면 여러 개다). */
function parseSharedStrings(xml: string): string[] {
  const strings: string[] = [];
  for (const si of xml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
    let text = "";
    for (const t of si[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)) text += t[1];
    strings.push(unescapeXml(text));
  }
  return strings;
}

function unescapeXml(value: string): string {
  return value
    .replace(/&#10;/g, "\n")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    // & 는 마지막이다 — 먼저 풀면 `&amp;lt;` 가 `<` 로 잘못 풀린다.
    .replace(/&amp;/g, "&");
}

/** 시트 이름 → 파트 경로. quote-template.ts 와 같은 이유로 이름으로 찾는다. */
function resolveSheetPart(archive: ZipArchive, sheetName: string): string | null {
  const workbook = archive.readTextOrNull("xl/workbook.xml");
  if (!workbook) return null;
  const escaped = sheetName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const sheetTag = new RegExp(`<sheet[^>]*name="${escaped}"[^>]*>`).exec(workbook);
  const relId = sheetTag ? /r:id="([^"]+)"/.exec(sheetTag[0])?.[1] : undefined;
  if (!relId) return null;

  const rels = archive.readTextOrNull("xl/_rels/workbook.xml.rels");
  if (!rels) return null;
  const relTag = new RegExp(`<Relationship[^>]*Id="${relId}"[^>]*>`).exec(rels);
  const target = relTag ? /Target="([^"]+)"/.exec(relTag[0])?.[1] : undefined;
  if (!target) return null;

  const part = target.startsWith("/") ? target.slice(1) : `xl/${target}`;
  return archive.has(part) ? part : null;
}

/**
 * 시트 하나에서 **주소 → 글자** 를 읽는 함수를 만든다.
 *
 * 아카이브가 아니라 **XML 문자열**을 받는다. 우리가 시트를 고친 뒤 그 결과를
 * 다시 읽어야 할 때가 있기 때문이다 — 매쳐 견적서는 행을 늘리고 줄인 다음
 * 옮겨진 자리를 머리글로 다시 찾는다. 아카이브만 읽을 수 있으면 고치기 전의
 * 낡은 시트밖에 못 본다.
 *
 * 공유문자열(`t="s"`)·인라인문자열(`t="inlineStr"`)·그냥 값(`<v>`) 셋 다 푼다.
 * 못 읽은 칸은 `null` — 위 '조용히 건너뛴다'.
 */
export function createCellTextReader(
  sheetXml: string,
  sharedStringsXml: string | null
): (ref: string) => string | null {
  const shared = sharedStringsXml ? parseSharedStrings(sharedStringsXml) : [];

  return (ref: string): string | null => {
    let raw: string;
    try {
      raw = findCell(sheetXml, ref).raw;
    } catch {
      return null; // 그 칸이 없다 — 양식이 바뀐 것이다. 한 줄 비우고 넘어간다.
    }
    if (raw.endsWith("/>")) return null; // 빈 칸

    const inner = raw.slice(raw.indexOf(">") + 1, raw.lastIndexOf("</c>"));
    const type = /\st="([^"]*)"/.exec(raw.slice(0, raw.indexOf(">") + 1))?.[1];

    if (type === "inlineStr") {
      let text = "";
      for (const t of inner.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)) text += t[1];
      return text === "" ? null : unescapeXml(text);
    }

    const v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
    if (v === undefined) return null;

    if (type === "s") {
      const text = shared[Number(v)];
      return text === undefined || text === "" ? null : text;
    }
    return unescapeXml(v);
  };
}

/**
 * 셀 주소들의 글자. 못 읽은 주소는 결과에 아예 없다(위 '조용히 건너뛴다').
 */
export function resolveSheetTextCells(
  archive: ZipArchive,
  sheetName: string,
  refs: readonly string[]
): Map<string, string> {
  const values = new Map<string, string>();

  const part = resolveSheetPart(archive, sheetName);
  if (!part) return values;
  const sheetXml = archive.readTextOrNull(part);
  if (!sheetXml) return values;

  const read = createCellTextReader(sheetXml, archive.readTextOrNull("xl/sharedStrings.xml"));
  for (const ref of refs) {
    const text = read(ref);
    if (text !== null) values.set(ref, text);
  }

  return values;
}
