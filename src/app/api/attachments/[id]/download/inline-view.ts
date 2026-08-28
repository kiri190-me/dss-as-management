/**
 * ============================================================================
 * inline 판정 — 이 라우트만의 것이고, 이 폴더를 벗어나지 않는다
 * ============================================================================
 * 원래 route.ts 안에 있었다. 그 자리의 주석이 **라우트 밖으로 옮기지 않는다**고
 * 적어 둔 이유는 지금도 그대로 맞다 — 이 판정과 아래 두 목록(무엇을 왜 열어
 * 주는지, PDF 를 여는 대가로 무엇을 감수했는지)은 **같이 읽혀야 뜻이 통한다.**
 *
 * 그런데 Next.js 는 `route.ts` 에서 정해진 이름(GET/POST/runtime/dynamic…) 말고
 * 다른 것을 export 하는 것을 **금지한다.** 테스트가 부를 수 있게 export 해 둔
 * `shouldServeInline` 때문에 `next build` 가 타입 검사 단계에서 실패했고, 그
 * 상태로 여덟 커밋이 지나갔다.
 *
 * 그래서 **같은 폴더의 형제 파일**로만 옮긴다. lib/ 로 보내지 않는 것이 요점이다:
 * 이 목록들은 범용 규칙이 아니라 *이 통로* 의 방어선이고, 물리적으로 붙어 있어야
 * 라우트를 고치는 사람이 함께 읽는다. 폴더 안의 route 아닌 파일에는 export 제약이
 * 없다.
 * ============================================================================
 */

/**
 * 화면 안에서 그대로 보여 줘도 되는 형식인가.
 *
 * `inline`은 브라우저에게 "내려받지 말고 열어라"라고 말하는 것이라, 여는
 * 순간 그 내용이 이 사이트의 것으로 실행될 수 있는 형식은 절대 넣으면 안
 * 된다 — 특히 SVG와 HTML이 그렇다(그 안의 스크립트가 우리 도메인에서 돈다).
 * 지금 허용목록에 SVG는 없지만, 나중에 누가 더할 때를 대비해 **여기서도
 * 따로** 좁혀 둔다. 목록에 없는 형식은 전부 첨부로 내려간다.
 *
 * 🔴 **이 집합에 SVG · HTML · XML 계열을 더하지 말 것.**
 *    image/svg+xml · text/html · application/xhtml+xml · application/xml ·
 *    text/xml — 전부 스크립트를 품을 수 있는 형식이고, inline 으로 나가는
 *    순간 그 스크립트가 **우리 도메인에서** 돈다(세션 쿠키가 닿는 자리다).
 *    확장자 허용목록(attachment-allowlist.ts)이 언젠가 넓어져도 이 집합이
 *    **두 번째 방어선**으로 남아 있어야 한다 — 그것이 이 목록을 라우트에
 *    따로 두는 이유다.
 *
 * ── PDF 가 여기 있는 까닭, 그리고 그것이 감수하는 위험 ────────────────────
 * 회로도다. 이 구역이 있는 이유 자체가 회로도를 **보는** 것인데, 볼 때마다
 * 파일로 받아서 여는 것은 번거롭다. 그래서 PDF 는 `?view=full` 에서 열어 준다.
 *
 * 🔴 다만 **PDF 도 스크립트를 담을 수 있는 형식이다.** inline 으로 나가면 그
 *    문서는 **우리 출처(origin)에서** 열리고, 그 안의 스크립트가 우리 도메인의
 *    것으로 도는 길이 원리상 열린다 — 세션 쿠키가 닿는 자리다. 이것은 열어
 *    주기로 **승인된 위험**이고, 지금 그 자리를 받치고 있는 방어선은 넷뿐이다:
 *
 *      1) **올릴 때 확장자와 실제 앞머리 바이트를 대조한다**
 *         (attachment-allowlist.ts 의 isContentCompatibleWithExtension —
 *          .pdf 는 앞 1024바이트 안에서 `%PDF-` 를 찾는다). 이름만 .pdf 로 바꾼
 *          파일은 애초에 들어오지 못한다. 다만 이것은 **형식을 속인 파일**까지만
 *          막는다 — 진짜 PDF 안의 스크립트는 검사하지 않는다(검사 엔진이 없어
 *          malware_scan_status 는 전부 NOT_SCANNED 다).
 *      2) **`X-Content-Type-Options: nosniff`** — 브라우저가 내용을 보고 형식을
 *         다시 추측하지 않는다(아래 응답 헤더의 ⚠️ 도 함께 읽을 것).
 *      3) **사내망 로그인 + 올리기는 WRITE 권한이 있어야 한다**
 *         (repairCases.files · productModels.files WRITE). 바깥 사람이 이 통로에
 *         파일을 밀어 넣을 창구가 없다.
 *      4) **요즘 브라우저는 PDF 를 자기 내장 뷰어 안에서 연다**(PDF.js 계열).
 *         그 뷰어는 문서 안의 스크립트를 기본적으로 돌리지 않는다. 이것은 우리가
 *         건 방어가 아니라 **빌려 쓰는 방어**라 브라우저 설정 하나로 사라질 수
 *         있다 — 그래서 네 번째에 둔다.
 *
 *    이 넷 중 하나라도 무너지는 날(허용목록이 넓어지거나, 바깥에서 올릴 수 있게
 *    되거나, 이 통로가 인증 없이 열리거나) **PDF 를 inline 으로 여는 결정 자체를
 *    다시 저울질해야 한다.**
 *
 * ── 🚨 `Content-Security-Policy: sandbox` 는 이 라우트에서 붙일 수 없다 ────
 * 한 번 넣었다가 **함수째 뺐다.** 이 라우트가 응답에 그 헤더를 실어도
 * **브라우저에는 도달하지 않는다**(개발 서버에 실제로 물어 확인했다). 나가는
 * 응답에는 next.config.ts 가 모든 경로에 건
 * `Content-Security-Policy: frame-ancestors 'none'` **하나만** 남는다. 같은
 * 자리에서 함께 실어 본 시험용 헤더(`X-Temp-Probe`)는 그대로 나왔으므로 라우트
 * 헤더가 통째로 무시되는 것은 아니다 — **이름이 겹칠 때만** 떨어진다.
 *
 * 까닭은 Next 의 응답 조립 순서다(node_modules/next/dist/server/send-response.js):
 * 전역 headers() 가 **먼저** 붙고, 그 뒤 라우트 응답의 헤더는
 *
 *     const isHeaderPresent = typeof res.getHeader(name) !== 'undefined';
 *     if (multipleAllowed.includes(name) || !isHeaderPresent) res.appendHeader(...)
 *
 * 로 **이미 있는 이름이면 그냥 버린다**(여럿 허용은 set-cookie ·
 * www-authenticate · proxy-authenticate · vary 넷뿐이다). 두 값을 한 헤더에
 * 합쳐 적어도(`sandbox; frame-ancestors 'none'`) 결과는 같다 — 이름이 겹치는
 * 순간 버려진다.
 *
 * 돌지 않는 보안 코드는 없는 것보다 나쁘다. 코드에 sandbox 가 보이면 다음에
 * 읽는 사람이 "PDF 는 격리돼 있구나" 하고 믿게 되고, 그 믿음 위에서 다른 결정을
 * 내린다. 그래서 지웠다.
 *
 * ▶ **되살리려면 여기가 아니라 next.config.ts 를 고쳐야 한다.** 그 파일의
 *   headers() 에 전역 규칙보다 **뒤에** 이 경로만의 규칙을 하나 더 두는 식이다:
 *
 *     { source: "/api/attachments/:id/download",
 *       headers: [{ key: "Content-Security-Policy",
 *                   value: "sandbox; frame-ancestors 'none'" }] }
 *
 *   ⚠️ 그때는 **일부 브라우저의 내장 PDF 뷰어가 sandbox 안에서 뜨지 않는다**는
 *      것도 함께 확인할 것(뷰어 자체가 스크립트로 만들어져 있다). 켜자마자
 *      "PDF 가 안 열린다"는 신고가 올 수 있고, 그때 되돌릴 자리도 그 파일이다.
 */
const INLINE_SAFE_MIME_TYPES = new Set(["image/jpeg", "image/png", "application/pdf"]);

/**
 * 썸네일 자리(`?view=thumb`)에 그대로 실어도 되는 형식 — **그림뿐이다.**
 *
 * 그 주소를 부르는 곳은 목록의 작은 그림칸이다. 미리보기(JPEG)가 있으면
 * 그것이 나가지만 **없으면 원본이 통째로** 나간다. 그런데 미리보기를 만드는
 * 쪽(shrink-image.ts 의 makePreview)은 jpeg·png 가 아니면 아예 만들지 않으므로
 * **PDF 에는 미리보기가 영영 없다.** 그래서 PDF 를 이 목록에까지 넣으면 한 변이
 * 200px 도 안 되는 자리에 몇 MB짜리 회로도 원본이 실려 나가고, 그러고도 그림이
 * 아니라 그려지지도 않는다.
 *
 * 화면(ProductModelFilesSection · StoredAttachmentList)은 사진에만 thumb 을
 * 부르므로 실제로 이 경우가 오지는 않는다. 그래도 **판정은 서버가 한다** —
 * 무엇을 화면에서 열어도 되는지 클라이언트가 정하게 두지 않는 것이 이 라우트의
 * 성질이고, 거기에는 "어느 자리에서" 열어도 되는지도 포함된다.
 */
const THUMBNAIL_INLINE_MIME_TYPES = new Set(["image/jpeg", "image/png"]);

/**
 * inline 으로 내보낼 것인가 — 이 판정은 **오직 서버에만** 있다.
 *
 * 클라이언트가 `?view=full` 이라고 물어도 형식이 목록에 없으면 그냥 첨부로
 * 내려간다. `view` 가 없거나 모르는 값이면 어떤 형식이든 첨부다.
 *
 * 라우트 밖으로 옮기지 않는다 — 이 판정과 바로 위 두 목록(무엇을 왜 열어 주는지,
 * 그리고 PDF 를 여는 대가로 무엇을 감수했는지)은 같이 읽혀야 뜻이 통하고, 파일을
 * 내보내는 통로는 이 하나뿐이다. 테스트가 부를 수 있도록 export 만 한다.
 */
export function shouldServeInline(view: string | null, mimeType: string): boolean {
  if (view === "full") return INLINE_SAFE_MIME_TYPES.has(mimeType);
  if (view === "thumb") return THUMBNAIL_INLINE_MIME_TYPES.has(mimeType);
  return false;
}
