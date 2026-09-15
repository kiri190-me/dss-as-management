/**
 * ============================================================================
 * XML 글자 풀기
 * ============================================================================
 * `decodeXmlEntities` 는 scripts/lib/xlsx/ooxml-parser.ts 에서 **그대로** 옮겨 왔다
 * (2026-09-15, 교산 인수품 가져오기 S1). 앱(src/)은 scripts/ 의 실행 코드를 가져오지
 * 않으므로 원본을 이쪽에 두고, ooxml-parser.ts 는 다시 내보내기만 한다
 * (zip-reader.ts 를 옮긴 것과 같은 이유). 동작은 한 글자도 바꾸지 않았다 — 옛
 * 읽개들의 시험이 그대로 통과하는 것이 그 증거다.
 *
 * `decodeXmlCharacterData` 는 새 것이다. 위 함수는 숫자 참조(`&#10;`)를 풀지 않는다.
 * 그렇다고 위 함수 **뒤에** 숫자 참조 풀기를 한 번 더 돌리면 `&amp;#10;` 이 줄바꿈이
 * 되어 버린다(두 번 풀린다). 한 정규식으로 한 번에 풀어야 그런 글자가 없다.
 * ============================================================================
 */

export function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  amp: "&",
};

/** 이름 있는 다섯 개와 숫자 참조(`&#10;` · `&#x3042;`)를 **한 번에** 푼다. */
export function decodeXmlCharacterData(s: string): string {
  return s.replace(
    /&(?:(lt|gt|quot|apos|amp)|#([0-9]+)|#[xX]([0-9a-fA-F]+));/g,
    (whole: string, named: string | undefined, decimal: string | undefined, hex: string | undefined) => {
      if (named !== undefined) return NAMED_ENTITIES[named];
      const codePoint =
        decimal !== undefined ? Number.parseInt(decimal, 10) : Number.parseInt(hex ?? "", 16);
      if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff) return whole;
      return String.fromCodePoint(codePoint);
    }
  );
}
