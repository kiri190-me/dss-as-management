import sanitizeHtml from "sanitize-html";

/**
 * ============================================================================
 * 서명 HTML 정화 — 붙여넣은 것을 그대로 믿지 않는다
 * ============================================================================
 * 서명은 관리자가 Outlook 등에서 **HTML 을 복사해 붙여넣는다.** 그 글은
 *
 *   1. 전사원의 메일함으로 나가고
 *   2. 설정 화면의 미리보기에서 우리 앱 안에 그려진다
 *
 * 2번이 특히 중요하다 — 미리보기는 dangerouslySetInnerHTML 로 그리므로, 걸러
 * 내지 않으면 **우리 화면에서 스크립트가 도는 길**이 열린다. 메일 클라이언트는
 * 대개 자기가 한 번 더 걸러 주지만 우리 화면은 아무도 안 걸러 준다.
 *
 * ── 직접 만들지 않는다 ──────────────────────────────────────────────────
 * 정규식으로 태그를 지우는 방식은 우회 사례가 널려 있다(주석 안의 태그, 속성
 * 값에 숨긴 이벤트, 인코딩 우회 …). 검증된 파서 기반 라이브러리를 쓴다.
 *
 * ── Outlook 이 붙여 보내는 잡동사니 ─────────────────────────────────────
 * `<o:p>`, `<w:...>`, `class="MsoNormal"`, 조건부 주석이 잔뜩 딸려온다.
 * 허용 목록에 없으므로 자동으로 떨어져 나간다 — 따로 지우는 코드가 필요 없다.
 * ============================================================================
 */

/** 서명 HTML 길이 상한. 이미지는 cid 참조라 길이에 거의 기여하지 않는다. */
export const SIGNATURE_HTML_MAX = 20_000;

const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    // 글
    "p", "div", "span", "br", "hr", "b", "strong", "i", "em", "u", "s", "small", "sub", "sup",
    "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "pre", "code",
    // 목록
    "ul", "ol", "li",
    // 표 — 메일 서명은 표로 짜인 경우가 많다
    "table", "thead", "tbody", "tfoot", "tr", "td", "th",
    // 링크·이미지
    "a", "img",
    // 옛 메일 클라이언트가 아직 뱉는 태그
    "font", "center",
  ],
  allowedAttributes: {
    "*": ["style", "align", "valign", "width", "height", "bgcolor", "dir", "lang"],
    a: ["href", "target", "rel", "title"],
    img: ["src", "alt", "width", "height", "border"],
    font: ["color", "face", "size"],
    table: ["border", "cellpadding", "cellspacing"],
    td: ["colspan", "rowspan"],
    th: ["colspan", "rowspan"],
  },
  /*
   * 🔴 http/https/mailto/tel 과 **cid** 만 허용한다.
   *
   * cid 를 넣는 이유: 서명 이미지는 메일에 동봉되어 `<img src="cid:...">` 로
   * 참조된다(외부 URL 은 NAS 가 인터넷에서 안 보이고, data: 는 Gmail·Outlook 이
   * 막는다).
   *
   * javascript: 와 data: 는 **일부러 빼 두었다.** javascript: 는 명백하고,
   * data: 는 어차피 메일에서 막히는 데다 허용하면 미리보기 화면에서 임의
   * 콘텐츠를 심는 길이 된다.
   */
  allowedSchemes: ["http", "https", "mailto", "tel", "cid"],
  allowedSchemesByTag: { img: ["http", "https", "cid"] },
  // 스킴 없는 상대경로는 막는다 — 메일에서 상대경로는 의미가 없고, 미리보기
  // 화면에서는 우리 앱의 경로로 해석되어 엉뚱한 곳을 가리킨다.
  allowProtocolRelative: false,
  // 허용하지 않은 태그는 **껍데기만** 버리고 글자는 남긴다. 통째로 지우면
  // 붙여넣은 서명에서 글이 소리 없이 사라진다.
  disallowedTagsMode: "discard",
  nonTextTags: ["style", "script", "textarea", "option", "noscript"],
  transformTags: {
    // 새 창으로 열리는 링크에는 noopener 를 붙인다(미리보기 화면 기준).
    a: sanitizeHtml.simpleTransform("a", { rel: "noopener noreferrer" }, true),
  },
};

/**
 * 붙여넣은 서명 HTML 을 안전한 형태로 만든다.
 *
 * 저장할 때 한 번 거르고, 화면에 그릴 때 저장된 값을 그대로 쓴다 — 그리는
 * 자리마다 거르게 하면 언젠가 한 곳을 빠뜨린다.
 */
export function sanitizeSignatureHtml(raw: string): string {
  if (!raw) return "";
  return sanitizeHtml(raw.slice(0, SIGNATURE_HTML_MAX), OPTIONS).trim();
}

/**
 * 서명이 참조하는 cid 목록. 발송할 때 **실제로 쓰이는 이미지만** 동봉하려고
 * 쓴다 — 올려 두고 서명에서 지운 이미지까지 붙이면 메일이 무거워지고, 받는
 * 사람 메일함에 정체 모를 첨부가 달린다.
 */
export function referencedCids(html: string): string[] {
  const found = new Set<string>();
  const pattern = /(?:src|SRC)\s*=\s*["']cid:([^"']+)["']/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) !== null) {
    const cid = match[1].trim();
    if (cid) found.add(cid);
  }
  return [...found];
}
