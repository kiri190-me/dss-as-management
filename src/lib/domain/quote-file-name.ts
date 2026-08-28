/**
 * 내려받는 견적서 파일의 이름.
 *
 * 받는 사람의 다운로드 폴더에서 **어느 건인지 바로 알아볼 수 있어야** 한다.
 * 번호만으로는 모자라고(`DSS 2026-077.xlsx` 가 열 장 쌓이면 결국 다 열어 봐야
 * 한다), 목록 한 줄을 통째로 넣기에는 길다. 번호와 공급처 둘이면 충분하다.
 *
 * ── 파일 이름에 쓸 수 없는 글자를 지운다 ────────────────────────────────
 * 공급처 이름에 `㈜A/S 사업부` 처럼 슬래시가 들어가는 일이 실제로 있고,
 * Windows 는 `\ / : * ? " < > |` 를 파일 이름에 허용하지 않는다. 그대로 내보내면
 * 브라우저가 이름을 제멋대로 자르거나 저장 자체가 실패한다.
 *
 * 제어문자도 뺀다 — 헤더에 그대로 실리면 응답이 깨진다.
 */
const FORBIDDEN_IN_FILENAME = /[\\/:*?"<>|\u0000-\u001F\u007F]/g;

/** 이름이 길어지면 브라우저·파일시스템마다 다르게 잘린다. 넉넉하되 상한은 둔다. */
const MAX_PART_LENGTH = 60;

function sanitize(value: string): string {
  return value.replace(FORBIDDEN_IN_FILENAME, " ").replace(/\s+/g, " ").trim().slice(0, MAX_PART_LENGTH);
}

export function buildQuoteFileName(input: { quoteNumber: string; customerName: string }): string {
  const parts = [sanitize(input.quoteNumber), sanitize(input.customerName)].filter(
    (part) => part.length > 0
  );
  // 둘 다 비는 일은 없다(검증이 필수로 막는다). 그래도 빈 이름을 내보내지는
  // 않는다 — 이름 없는 첨부는 브라우저가 `download` 로 저장한다.
  const stem = parts.length > 0 ? parts.join("_") : "견적서";
  return `견적서_${stem}.xlsx`;
}

/**
 * Content-Disposition 헤더 한 줄.
 *
 * `filename*=UTF-8''`(RFC 5987)를 쓰는 이유는 한글이다. 옛 `filename=` 하나만
 * 보내면 브라우저가 바이트를 latin-1 로 읽어 깨진 이름으로 저장한다. 호환을 위해
 * 둘 다 보내되, 옛 형식에는 ASCII 로 접을 수 없는 글자를 `_` 로 바꾼 값을 넣는다
 * (그 값을 읽는 브라우저는 어차피 한글을 못 쓴다). 첨부 다운로드 라우트가
 * 이미 같은 방식을 쓰고 있다.
 */
export function quoteContentDisposition(fileName: string): string {
  const asciiFallback = fileName.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}
