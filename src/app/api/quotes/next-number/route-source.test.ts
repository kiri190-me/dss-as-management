import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

/**
 * ============================================================================
 * GET /api/quotes/next-number — 문지기 · 제안일 뿐 · 경로 비노출 (2026-10-06)
 * ============================================================================
 * 이 저장소는 라우트를 직접 부르지 않는다(세션 · DB 가 필요하다). 제안 규칙 자체는
 * storage/quote-number-suggestion.test.ts 가 임시 폴더에서, 읽기 전용 규율은
 * storage/quote-number-suggestion-source.test.ts 가 원본 글자로 본다.
 *
 * 여기서 못 박는 것은 여섯이다:
 *  · 🔴 문지기가 **이웃 통로(견적서 폴더 목록)와 글자 그대로 같다** — 본떠 만든 통로라
 *    빠진 검사 하나가 곧 구멍이다
 *  · 🔴 권한이 **`quotes` WRITE** 다 — [새 견적서] 를 보여 줄 때 쓰는 **그 열쇠 그대로**이고,
 *    새 권한 영역을 만들지도 넓히지도 않았다
 *  · 🔴 **제안이지 채번이 아니다** — 번호를 잡아 두지 않는다(DB 에 한 줄도 쓰지 않는다)
 *  · 🔴 **만들지 않는다 · 지우지 않는다** — 폴더 만들기 · 쓰기 · 삭제 · 쓰기 메서드가 없다
 *  · 🔴 응답 타입에 **절대 경로 · 폴더 이름을 담는 칸이 없다**
 *  · 🔴 번호 모양 · 상한을 **통로가 다시 짜지 않는다** — 저장소 모듈이 쥔다
 * ============================================================================
 */

const route = readFileSync(new URL("./route.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");
/** 이웃 통로 — 그 견적서 폴더 **안에 무엇이 있는가**. 문지기를 그대로 본떴다. */
const sibling = readFileSync(
  new URL("../[id]/archive-folder/entries/route.ts", import.meta.url),
  "utf8"
).replace(/\r\n/g, "\n");
/** [새 견적서] 를 보여 주는 두 화면 — 권한이 같은 글자인지 견준다. */
const newQuotePage = readFileSync(new URL("../../../(app)/quotes/new/page.tsx", import.meta.url), "utf8");
const quoteListPage = readFileSync(new URL("../../../(app)/quotes/page.tsx", import.meta.url), "utf8");
/** 주석을 뺀 코드 — 머리말이 까닭을 설명하느라 적은 낱말에 걸리지 않게. */
const code = route.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const nextConfig = readFileSync(new URL("../../../../../next.config.ts", import.meta.url), "utf8");
const getBody = code.slice(code.indexOf("export async function GET"));

const GLOBAL_HEADERS = [
  "X-Frame-Options",
  "Content-Security-Policy",
  "X-Content-Type-Options",
  "Referrer-Policy",
  "Permissions-Policy",
  "Strict-Transport-Security",
];

function exportedNames(source: string): string[] {
  const names: string[] = [];
  for (const match of source.matchAll(
    /^export\s+(?:async\s+)?(?:function|const|let|var|class|type|interface|enum)\s+([A-Za-z_$][\w$]*)/gm
  )) {
    names.push(match[1]);
  }
  return names.sort();
}

function importSpecifiers(source: string): string[] {
  return [...source.matchAll(/^import\s[\s\S]*?\sfrom\s+"([^"]+)";/gm)].map((match) => match[1]).sort();
}

/**
 * 문지기 토막 — **저장 모드부터 권한을 묻기 직전**까지(저장 모드 · 세션 · 살아 있는 계정 ·
 * 승인). 주석과 공백을 걷어 두 통로를 글자로 견준다. 🔴 GET 의 머리부터 자르지 않는 까닭은
 * 이 통로가 **주소에서 받는 것이 없어** 서명이 다르기 때문이다(이웃은 `{ id }` 를 받는다).
 * 권한 한 줄은 낱말이 하나 다르므로 아래에서 따로 견준다.
 */
function gatekeeper(source: string): string {
  const body = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const from = body.indexOf('if (getAuthSource() !== "database")');
  const to = body.indexOf("hasPermission(actingUser,");
  assert.ok(from >= 0 && to > from, "문지기 토막을 찾지 못했다");
  return body.slice(from, to).replace(/\s+/g, "");
}

/** 권한 한 줄 — 낱말(READ · WRITE)만 다르고 나머지는 글자 그대로 같아야 한다. */
function permissionGate(action: string): string {
  return [
    `if (!(await hasPermission(actingUser, "quotes", "${action}"))) {`,
    `    return fail(403, "FORBIDDEN", "이 작업을 수행할 권한이 없습니다.");`,
    `  }`,
  ].join("\n");
}

describe("다음 견적서 번호 제안 통로 — 소스로 지킨다", () => {
  test("🔴 Next 가 정한 이름만 export 한다 — GET · runtime · dynamic 뿐", () => {
    assert.deepEqual(exportedNames(route), ["GET", "dynamic", "runtime"]);
    assert.equal(/^export\s*(?:\{|default|\*)/m.test(route), false);
    assert.ok(route.includes('export const runtime = "nodejs";'));
    assert.ok(route.includes('export const dynamic = "force-dynamic";'));
  });

  test("🔴 GET 뿐 — 쓰기 메서드를 만들지 않는다", () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      assert.equal(
        new RegExp(`export\\s+(?:async\\s+)?function\\s+${method}\\b`).test(route),
        false,
        `${method} 가 생겼다`
      );
    }
  });

  test("🔴 받는 칸이 없다 — 주소에서도 질의에서도 아무것도 받지 않는다", () => {
    assert.ok(getBody.startsWith("export async function GET(): Promise<NextResponse> {"), getBody.slice(0, 120));
    assert.equal(code.includes("context.params"), false, "주소에서 무언가를 받는다");
    assert.equal(code.includes("searchParams"), false, "질의 칸이 생겼다");
    assert.equal(code.includes("NextRequest"), false, "쓰지 않는 요청을 받는다");
  });

  test("🔴 문지기가 이웃 통로(견적서 폴더 목록)와 **글자 그대로 같다**", () => {
    assert.equal(gatekeeper(route), gatekeeper(sibling));
    // 권한 한 줄도 **낱말 하나만** 다르다 — 거절 코드도 문장도 같은 글자다.
    assert.ok(route.includes(permissionGate("WRITE")), "권한 한 줄이 이웃과 다른 모양이다");
    assert.ok(sibling.includes(permissionGate("READ")), "이웃 통로의 권한 한 줄이 바뀌었다");
  });

  test("🔴 권한은 `quotes` WRITE — [새 견적서] 를 보여 줄 때 쓰는 **그 열쇠 그대로**다", () => {
    const key = 'hasPermission(actingUser, "quotes", "WRITE")';
    assert.ok(code.includes(key));
    assert.ok(newQuotePage.includes(key), "새 견적서 화면의 열쇠가 바뀌었다 — 이 대조를 다시 보라");
    assert.ok(quoteListPage.includes(key), "견적서 목록 화면의 열쇠가 바뀌었다 — 이 대조를 다시 보라");
    // 🔴 새 영역을 만들거나 넓히지 않았다 — 묻는 것은 이 한 번뿐이고, 영역은 quotes 다.
    assert.equal(getBody.match(/hasPermission\(/g)?.length, 1);
    assert.equal(/hasPermission\(actingUser, "(?!quotes")/.test(code), false, "다른 영역을 물었다");
  });

  test("🔴 순서: 저장 모드 → 세션 → 살아 있는 계정 · 승인 → quotes WRITE → 루트 → 이미 쓰인 번호 → 제안", () => {
    const marks = [
      'getAuthSource() !== "database"',
      "await readSession()",
      "resolveActingUserForSession(session)",
      'actingUser.approvalStatus !== "APPROVED"',
      'hasPermission(actingUser, "quotes", "WRITE")',
      "resolveQuoteArchiveRoot()",
      "await listQuotes()",
      "suggestNextQuoteNumber({",
    ];
    let previous = -1;
    for (const mark of marks) {
      const at = getBody.indexOf(mark);
      assert.ok(at >= 0, `없다: ${mark}`);
      assert.ok(at > previous, `순서가 어긋났다: ${mark}`);
      previous = at;
    }
    // 🔴 권한이 조회보다 **앞**이다 — 두 자리를 직접 견준다.
    assert.ok(
      getBody.indexOf('hasPermission(actingUser, "quotes", "WRITE")') < getBody.indexOf("await listQuotes()"),
      "권한 검사가 조회보다 뒤에 있다"
    );
  });

  test("🔴 제안이지 채번이 아니다 — 번호를 잡아 두지 않는다", () => {
    // DB 에 한 줄도 쓰지 않는다. 쓰는 쪽(mutations)을 아예 가져오지 않는다.
    for (const forbidden of [/\bmutations\b/, /\binsert\b/, /\bupdate\b/i, /\bdb\./, /recordAudit/]) {
      assert.equal(forbidden.test(code), false, `번호를 잡아 두는 흔적: ${forbidden}`);
    }
    // 번호 모양을 통로가 다시 짜지 않는다 — 머리말도 자릿수도 저장소 모듈이 쥔다.
    for (const forbidden of [/\bDSS\b/, /padStart/, /parseInt/, /\bNumber\(/]) {
      assert.equal(forbidden.test(code), false, `번호 모양을 통로가 다시 짰다: ${forbidden}`);
    }
  });

  test("🔴 아무것도 만들지 않는다 · 지우지 않는다 — 가져오는 것은 문지기 · 조회 하나 · 읽기 전용 둘뿐", () => {
    assert.deepEqual(importSpecifiers(route), [
      "@/lib/auth/acting-user",
      "@/lib/auth/permission-resolver",
      "@/lib/auth/session",
      "@/lib/config/auth-source",
      "@/lib/db/queries/quotes",
      "@/lib/storage/quote-archive",
      "@/lib/storage/quote-number-suggestion",
      "next/server",
    ]);
    for (const forbidden of [
      /\bmkdir\b/,
      /\bwriteFile\b/,
      /\bappendFile\b/,
      /\bcreateWriteStream\b/,
      /\bunlink\b/,
      /\brm\b/,
      /\brmdir\b/,
      /\brename\b/,
      /node:fs/,
      /node:path/,
      /saveToQuoteArchive/,
      /createQuoteArchiveFolder/,
      /require\(/,
      /\bimport\(/,
      /console\./,
    ]) {
      assert.equal(forbidden.test(code), false, `쓰기 · 기록 흔적: ${forbidden}`);
    }
  });

  test("🔴 파일을 중계하지 않는다 — 나가는 것은 JSON 한 덩이뿐이다", () => {
    for (const forbidden of [
      /\breadFile\b/,
      /\bcreateReadStream\b/,
      /Content-Disposition/,
      /arrayBuffer/,
      /ReadableStream/,
      /new Response\(/,
      /NextResponse\.redirect/,
      /sendFile/,
    ]) {
      assert.equal(forbidden.test(code), false, `내용을 내보내는 흔적: ${forbidden}`);
    }
    // 응답을 만드는 길은 둘뿐이다 — 실패 JSON 과 성공 JSON.
    assert.equal(code.match(/NextResponse\.json\(/g)?.length, 2);
  });

  test("🔴 컨테이너 안 경로 · 폴더 이름이 응답에 실리지 않는다", () => {
    assert.equal(code.includes("QUOTE_ARCHIVE_DIR"), false);
    assert.equal(code.includes("QUOTE_ARCHIVE_UNC_ROOT"), false);
    assert.equal(code.includes("process.env"), false);
    assert.equal(code.includes("uncPath"), false);
    assert.equal(code.includes("quote-folder-helper"), false);
    // 폴더 이름 · 상대 경로는 아예 나르지 않는다 — 나가는 것은 번호와 숫자뿐이다.
    assert.equal(code.includes("relativePath"), false);
    assert.equal(code.includes("folderName"), false);
    // archiveRoot 는 선언 · null 판정 · 제안 입력 세 번만 나온다.
    assert.equal(getBody.match(/archiveRoot/g)?.length, 3);
    assert.ok(getBody.includes("const archiveRoot = resolveQuoteArchiveRoot();"));
    assert.ok(getBody.includes("if (archiveRoot === null) {"));
    assert.equal(getBody.match(/root: archiveRoot,/g)?.length, 1);
    assert.equal(getBody.match(/\broot\b\s*:/g)?.length, 1);
    // 🔴 응답을 만드는 토막(모듈에게 물은 **뒤**)에는 루트라는 낱말이 아예 없다.
    const responding = getBody.slice(getBody.indexOf('if (suggested.status === "ready") {'));
    assert.ok(responding.length > 0);
    assert.equal(/root/i.test(responding), false, responding);
  });

  test("🔴 응답 타입에 절대 경로를 담는 칸이 없다 — 나가는 칸은 정해진 열뿐이다", () => {
    const types = code.slice(code.indexOf("type NextQuoteNumberResponse"), code.indexOf("function fail("));
    assert.ok(types.includes('status: "ready"'), types);
    for (const forbidden of ["root", "absolutepath", "archivedir", "dir:", "fullpath", "uncpath", "relativepath"]) {
      assert.equal(types.toLowerCase().includes(forbidden), false, `${forbidden} 가 응답 타입에 있다`);
    }
    const fields = [...types.matchAll(/(\w+)\??:/g)].map((match) => match[1]);
    assert.deepEqual(
      [...new Set(fields)].sort(),
      [
        "folderCount",
        "highestFolderSequence",
        "highestKnownSequence",
        "numberedFolderCount",
        "quoteNumber",
        "reason",
        "sequence",
        "status",
        "year",
      ].sort()
    );
  });

  test("🔴 DB 의 번호를 함께 본다 — 통로가 제 손으로 번호를 쪼개지 않는다", () => {
    assert.ok(getBody.includes("knownQuoteNumbers: quotes.map((quote) => quote.quoteNumber),"), getBody);
    // 거르는 · 쪼개는 규칙은 domain · 저장소 한 자리에만 있다.
    for (const forbidden of ["quoteArchiveBaseNumber", "quoteNumberFromArchiveFileName", "filter("]) {
      assert.equal(code.includes(forbidden), false, `통로가 번호 규칙을 다시 짰다: ${forbidden}`);
    }
  });

  test("🔴 연도 · 기다리기 상한은 저장소 모듈이 쥔다 — 통로가 제 숫자를 들지 않는다", () => {
    const call = getBody.slice(
      getBody.indexOf("suggestNextQuoteNumber({"),
      getBody.indexOf('if (suggested.status === "ready") {')
    );
    assert.ok(call.length > 0);
    assert.equal(/year\s*:/.test(call), false, "통로가 연도를 정한다");
    assert.equal(/timeoutMs\s*:/.test(call), false, "통로가 제 기다리기 상한을 넘긴다");
    assert.equal(/limit\s*:/.test(call), false);
  });

  test("상태 셋 — ready · disabled · failed, 캐시하지 않는다", () => {
    for (const status of ['status: "ready"', 'status: "disabled"', 'status: "failed"']) {
      assert.ok(getBody.includes(status), status);
    }
    assert.ok(route.includes('NextResponse.json(body, { status: 200, headers: { "Cache-Control": "no-store" } })'));
  });

  test("전역 보안 헤더와 같은 이름의 헤더를 붙이지 않는다", () => {
    for (const name of GLOBAL_HEADERS) {
      assert.equal(route.includes(`"${name}"`), false, name);
      assert.ok(nextConfig.includes(`"${name}"`), `next.config.ts 의 전역 헤더 목록이 바뀌었다: ${name}`);
    }
  });
});
