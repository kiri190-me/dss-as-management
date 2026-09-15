/**
 * ============================================================================
 * Content-Disposition 헤더에서 사람이 볼 파일 이름을 꺼낸다 (순수)
 * ============================================================================
 * fetch 로 받은 파일을 `<a download>` 로 저장하는 화면이 같은 규칙으로 이름을 읽는다 —
 * 검사·수리 보고서 내려받기(ServiceReportForm)와 수정 권한자의 [견적서 받기]
 * (components/quotes/quote-issue-download.ts). 원래 ServiceReportForm 안에 있던 함수를
 * **뜻을 한 글자도 바꾸지 않고** 이리 옮겼다(2026-09-15 견적서 B1c) — 두 벌이면 한쪽만
 * 고쳐지는 날이 온다.
 *
 * 서버는 이름을 두 벌 싣는다: `filename="<ASCII 로 접은 값>"` 과
 * `filename*=UTF-8''<퍼센트 인코딩>`(domain/quote-file-name.ts 의 quoteContentDisposition).
 * 한글 이름은 뒤쪽에만 온전하다.
 * ============================================================================
 */

/** `attachment; filename="..."; filename*=UTF-8''...` 에서 사람이 볼 이름을 꺼낸다. */
export function fileNameFromContentDisposition(header: string | null): string | null {
  if (!header) return null;

  // 한글 이름은 이쪽에만 온전히 들어 있다(ASCII 쪽은 `_` 로 바뀌어 있다).
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (encoded) {
    try {
      return decodeURIComponent(encoded[1].trim());
    } catch {
      // 잘못 인코딩된 헤더 하나 때문에 내려받기를 포기하지는 않는다.
    }
  }

  const ascii = /filename="([^"]*)"/i.exec(header);
  return ascii && ascii[1] !== "" ? ascii[1] : null;
}
