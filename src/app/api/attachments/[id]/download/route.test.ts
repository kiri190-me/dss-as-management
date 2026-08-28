import { test } from "node:test";
import assert from "node:assert/strict";

import { ATTACHMENT_EXTENSION_RULES } from "@/lib/domain/attachment-allowlist";
import { shouldServeInline } from "./inline-view";

/**
 * ============================================================================
 * 무엇을 **화면에서 열어 줄지** — 조용히 새는 쪽으로만 틀리는 판정
 * ============================================================================
 * `Content-Disposition: inline` 은 브라우저에게 "내려받지 말고 열어라"라고
 * 말하는 것이다. 열리는 문서는 **우리 출처에서** 열리므로, 스크립트를 품을 수
 * 있는 형식이 이 목록에 들어가면 그 스크립트가 우리 도메인의 것으로 돈다 —
 * 세션 쿠키가 닿는 자리다.
 *
 * 이 고장은 **겉으로 아무 티가 나지 않는다.** SVG 를 목록에 더해도 화면은
 * 멀쩡하고, 사진도 잘 열리고, 아무도 아무것도 눈치채지 못한다. 그래서 넓힌
 * 것이 "아무거나 열어 준다"가 되지 않았다는 것을 여기서 못박는다.
 *
 * 반대 방향도 마찬가지로 조용하다 — 목록이 좁아지면 회로도가 새 탭에서 열리는
 * 대신 파일로 떨어지고, 사용자는 그것을 "원래 그런 것"으로 여긴다.
 *
 * ── 판정 함수는 라우트 폴더 안의 형제 파일에 있다 ────────────────────────
 * `download/inline-view.ts`. 예전에는 route.ts 안에 있었고 테스트가 부를 수
 * 있게 export 해 두었는데, **Next.js 는 route.ts 에서 정해진 이름 말고 다른
 * 것을 export 하는 것을 금지한다** — 그 export 하나 때문에 `next build` 가
 * 타입 검사에서 실패한 채 여덟 커밋이 지나갔다.
 *
 * 그래서 lib/ 로 보내지 않고 **같은 폴더로만** 옮겼다. 이 판정과 그 위의 두
 * 목록(무엇을 왜 열어 주는지, PDF 를 여는 대가로 무엇을 감수했는지)은 같이
 * 읽혀야 뜻이 통하고, 파일이 밖으로 나가는 통로는 그 라우트 하나뿐이라는
 * 원래 판단은 그대로다.
 *
 * ── 격리 헤더(sandbox) 시험이 없는 것은 빠뜨린 것이 아니다 ───────────────
 * 예전에는 `Content-Security-Policy: sandbox` 를 붙이는 inlineIsolationHeaders
 * 를 여기서 시험했다. 그 함수는 **지웠다** — 붙여도 next.config.ts 의 전역 CSP
 * 와 이름이 겹쳐 브라우저까지 가지 못했기 때문이다(사연은 route.ts 의
 * INLINE_SAFE_MIME_TYPES 머리말). 지워진 코드를 시험하는 자리를 남겨 두면
 * "PDF 는 격리돼 있다"는 잘못된 안심이 시험 통과로 뒷받침되는 셈이 된다.
 * ============================================================================
 */

// 예전에는 여기서 DATABASE_URL 자리표시자를 넣고 CJS require 로 route.ts 를
// 불러왔다. route.ts 가 DB 클라이언트를 정적으로 import 해서, 정적 import 로는
// 끌어올려진 그 모듈이 먼저 던졌기 때문이다.
//
// 판정 함수가 inline-view.ts 로 나오면서 **그 수법이 통째로 필요 없어졌다** —
// 그 파일은 DB 를 건드리지 않는다. 평범한 import 로 되돌린다.

/** 스크립트를 품을 수 있어 **영영 inline 이면 안 되는** 형식들. */
const NEVER_INLINE_MIME_TYPES = [
  "image/svg+xml",
  "text/html",
  "application/xhtml+xml",
  "application/xml",
  "text/xml",
  "text/javascript",
  "application/javascript",
];

test("PDF 는 ?view=full 에서 화면에 열린다 — 회로도를 받아서 여는 번거로움을 없앤 자리다", () => {
  assert.equal(shouldServeInline("full", "application/pdf"), true);
});

test("사진은 예전 그대로 열린다 — 넓히면서 있던 것을 잃지 않았다", () => {
  assert.equal(shouldServeInline("full", "image/jpeg"), true);
  assert.equal(shouldServeInline("full", "image/png"), true);
  assert.equal(shouldServeInline("thumb", "image/jpeg"), true);
  assert.equal(shouldServeInline("thumb", "image/png"), true);
});

test("🔴 SVG · HTML · XML 계열은 ?view=full 로 물어도 막힌다 — 넓힌 것이 '아무거나'가 아니다", () => {
  for (const mimeType of NEVER_INLINE_MIME_TYPES) {
    assert.equal(
      shouldServeInline("full", mimeType),
      false,
      `${mimeType} 이(가) inline 으로 열린다 — 그 안의 스크립트가 우리 도메인에서 돈다`
    );
    assert.equal(shouldServeInline("thumb", mimeType), false, `${mimeType} 이(가) 썸네일 자리에서 열린다`);
  }
});

test("view 인자가 없으면(그냥 내려받기면) 어떤 형식이든 inline 이 아니다", () => {
  for (const mimeType of ["application/pdf", "image/jpeg", "image/png", ...NEVER_INLINE_MIME_TYPES]) {
    assert.equal(shouldServeInline(null, mimeType), false, `${mimeType} 이(가) view 없이도 열린다`);
  }
});

test("모르는 view 값은 내려받기다 — 클라이언트가 지어낸 말로 열리지 않는다", () => {
  for (const view of ["", "FULL", "Full", "full ", "inline", "preview", "thumbnail", "1", "true"]) {
    assert.equal(
      shouldServeInline(view, "application/pdf"),
      false,
      `view=${JSON.stringify(view)} 로 PDF 가 열린다`
    );
    assert.equal(shouldServeInline(view, "image/jpeg"), false, `view=${JSON.stringify(view)} 로 사진이 열린다`);
  }
});

test("PDF 는 썸네일 자리(?view=thumb)에서는 열리지 않는다 — 그 자리에 원본이 통째로 실리지 않게", () => {
  // 미리보기(JPEG)를 만드는 쪽(shrink-image.ts 의 makePreview)은 jpeg·png 가
  // 아니면 아예 만들지 않으므로 PDF 에는 미리보기가 없다. thumb 에서 열어 주면
  // 작은 그림칸에 몇 MB짜리 회로도 원본이 실려 나가고 그려지지도 않는다.
  assert.equal(shouldServeInline("thumb", "application/pdf"), false);
});

test("업로드가 허용하는 형식 중 화면에서 열리는 것은 사진 둘과 PDF 뿐이다", () => {
  const inlineCapable = ATTACHMENT_EXTENSION_RULES.flatMap((rule) =>
    rule.allowedMimeTypes.filter((mimeType) => shouldServeInline("full", mimeType))
  );
  // 엑셀·워드·zip 이 여기 끼면 그날 목록이 넓어진 것이다.
  assert.deepEqual([...new Set(inlineCapable)].sort(), ["application/pdf", "image/jpeg", "image/png"]);
});
