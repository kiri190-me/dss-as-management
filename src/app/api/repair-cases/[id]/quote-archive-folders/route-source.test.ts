import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

/**
 * ============================================================================
 * GET /api/repair-cases/{id}/quote-archive-folders — 문지기 순서 · 목록만 · 경로 비노출 (2026-10-06)
 * ============================================================================
 * 이 저장소는 라우트를 직접 부르지 않는다(세션 · DB 가 필요하다). 찾기 자체는
 * storage/quote-archive-product-folders.test.ts 가, 번호 뽑기는
 * domain/quote-archive-file-number.test.ts 가, 화면은
 * components/quotes/QuoteArchiveProductFolderSection.test.tsx 가 본다.
 *
 * 여기서 못 박는 것은 여섯이다:
 *  · 🔴 문지기가 **이웃 통로(견적서 폴더 목록)와 글자 그대로 같다**. 권한도 같은 글자
 *    (`quotes` READ)다 — 주소가 수리 건 id 라고 수리 건 쪽 열쇠를 쓰지 않았다(나가는 것이
 *    견적서 자료다). 새 권한 영역을 만들지도 넓히지도 않았다.
 *  · 🔴 권한이 **조회보다 앞**이다 — 권한 없는 사람에게 그 id 의 존재를 알리지 않는다
 *  · 🔴 **만들지 않는다 · 지우지 않는다** — 폴더 만들기 · 쓰기 · 삭제 · 쓰기 메서드가 없다
 *  · 🔴 **파일 바이트를 중계하지 않는다** — 폴더 줄만 낸다
 *  · 🔴 응답 타입에 **절대 경로를 담는 칸이 없다** — 전체 공유폴더 주소(uncPath)도 없다
 *  · 🔴 **이 건의 견적서 폴더를 뺀다** — 그 일을 통로가 제 손으로 하지 않는다
 * ============================================================================
 */

const route = readFileSync(new URL("./route.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");
/** 이웃 통로 — 그 견적서 폴더 **안에 무엇이 있는가**. 문지기를 그대로 본떴다. */
const sibling = readFileSync(
  new URL("../../../quotes/[id]/archive-folder/entries/route.ts", import.meta.url),
  "utf8"
).replace(/\r\n/g, "\n");
/** 주석을 뺀 코드 — 머리말이 까닭을 설명하느라 적은 낱말(uncPath …)에 걸리지 않게. */
const code = route.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const nextConfig = readFileSync(new URL("../../../../../../next.config.ts", import.meta.url), "utf8");
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
 * 문지기 토막 — GET 의 머리부터 **주소의 id 를 꺼내기 직전**까지(저장 모드 · 세션 · 살아 있는
 * 계정 · 승인 · 권한). 주석과 공백을 걷어 두 통로를 글자로 견준다. 그 뒤는 서로 다르다 —
 * 이웃은 견적서를, 여기는 수리 건을 읽는다.
 */
function gatekeeper(source: string): string {
  const body = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const from = body.indexOf("export async function GET");
  const to = body.indexOf("const { id } = await context.params;");
  assert.ok(from >= 0 && to > from, "문지기 토막을 찾지 못했다");
  return body.slice(from, to).replace(/\s+/g, "");
}

describe("지난 견적서 폴더 통로 — 소스로 지킨다", () => {
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

  test("🔴 문지기가 이웃 통로(견적서 폴더 목록)와 **글자 그대로 같다**", () => {
    assert.equal(gatekeeper(route), gatekeeper(sibling));
    // 권한은 **같은 글자**다 — 새 영역을 만들지도, 넓히지도 않았다.
    assert.ok(route.includes('hasPermission(actingUser, "quotes", "READ")'));
    assert.ok(sibling.includes('hasPermission(actingUser, "quotes", "READ")'));
    // 🔴 수리 건 쪽 열쇠로 바꿔 달지 않았다 — 나가는 것은 견적서 자료다.
    assert.equal(code.includes("repairCases.files"), false, "권한 영역이 바뀌었다");
  });

  test("🔴 순서: 저장 모드 → 세션 → 살아 있는 계정 · 승인 → quotes READ → 수리 건 → 루트 → 이 건의 번호 → 찾기", () => {
    const marks = [
      'getAuthSource() !== "database"',
      "await readSession()",
      "resolveActingUserForSession(session)",
      'actingUser.approvalStatus !== "APPROVED"',
      'hasPermission(actingUser, "quotes", "READ")',
      "await context.params",
      "getRepairCaseContactFolderNamingById(id)",
      "resolveQuoteArchiveRoot()",
      "listQuotesForRepairCase(",
      "listQuoteArchiveProductFolders({",
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
      getBody.indexOf('hasPermission(actingUser, "quotes", "READ")') <
        getBody.indexOf("getRepairCaseContactFolderNamingById(id)"),
      "권한 검사가 조회보다 뒤에 있다"
    );
    // 넓은 문턱은 READ 한 번뿐이고, 쓰기 권한을 묻지 않는다.
    assert.equal(getBody.match(/hasPermission\(/g)?.length, 1);
    assert.equal(getBody.includes('"WRITE"'), false);
  });

  test("🔴 문턱을 넘었는데 안 보이면 403 이 아니라 404 — 존재 여부를 흘리지 않는다", () => {
    const afterQuery = getBody.slice(getBody.indexOf("getRepairCaseContactFolderNamingById(id)"));
    assert.ok(afterQuery.includes('fail(404, "NOT_FOUND"'), "조회 뒤의 404 가 없다");
    assert.equal(afterQuery.includes("fail(403"), false, "조회 뒤에 403 이 있다");
  });

  test("🔴 아무것도 만들지 않는다 · 지우지 않는다 — 가져오는 것은 문지기 · 조회 둘 · 읽기 전용 둘뿐", () => {
    assert.deepEqual(importSpecifiers(route), [
      "@/lib/auth/acting-user",
      "@/lib/auth/permission-resolver",
      "@/lib/auth/session",
      "@/lib/config/auth-source",
      "@/lib/db/queries/quotes",
      "@/lib/db/queries/repair-cases",
      "@/lib/storage/quote-archive",
      "@/lib/storage/quote-archive-product-folders",
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
      /saveToQuoteArchive/,
      /createQuoteArchiveFolder/,
      /mutations/,
      /recordAudit/,
      /recordQuoteExport/,
      /require\(/,
      /\bimport\(/,
      /console\./,
    ]) {
      assert.equal(forbidden.test(code), false, `쓰기 · 기록 흔적: ${forbidden}`);
    }
  });

  test("🔴 파일 바이트를 중계하지 않는다 — 나가는 것은 JSON 목록뿐이다", () => {
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
    // 🔴 파일 **이름** 목록조차 나가지 않는다 — 뽑은 번호와 수뿐이다.
    assert.equal(code.includes("fileNames"), false);
    assert.equal(code.includes("entries"), false);
  });

  test("🔴 컨테이너 안 경로 · 전체 공유폴더 주소가 응답에 실리지 않는다", () => {
    assert.equal(code.includes("QUOTE_ARCHIVE_DIR"), false);
    assert.equal(code.includes("QUOTE_ARCHIVE_UNC_ROOT"), false);
    assert.equal(code.includes("process.env"), false);
    // 🔴 전체 주소(uncPath)는 **일부러 내지 않는다** — `\\서버\공유\…` 라는 절대 경로다.
    assert.equal(code.includes("uncPath"), false);
    assert.equal(code.includes("quote-folder-helper"), false);
    // archiveRoot 는 선언 · null 판정 · 찾기 입력 세 번만 나온다.
    assert.equal(getBody.match(/archiveRoot/g)?.length, 3);
    assert.ok(getBody.includes("const archiveRoot = resolveQuoteArchiveRoot();"));
    assert.ok(getBody.includes("if (archiveRoot === null) {"));
    // 루트가 나가는 자리는 저장소 호출의 입력 하나뿐이다.
    assert.equal(getBody.match(/root: archiveRoot,/g)?.length, 1);
    assert.equal(getBody.match(/\broot\b\s*:/g)?.length, 1);
    // 🔴 응답을 만드는 토막(저장소에게 물은 **뒤**)에는 루트라는 낱말이 아예 없다.
    const responding = getBody.slice(getBody.indexOf('if (found.status === "found") {'));
    assert.ok(responding.length > 0);
    assert.equal(/root/i.test(responding), false, responding);
    // 경로를 이어 붙이는 일도 없다.
    assert.equal(code.includes("node:path"), false);
  });

  test("🔴 응답 타입에 절대 경로를 담는 칸이 없다 — 나가는 칸은 정해진 열뿐이다", () => {
    const types = code.slice(code.indexOf("type QuoteArchiveProductFolderBody"), code.indexOf("function fail("));
    assert.ok(types.includes('status: "found"'), types);
    for (const forbidden of ["root", "absolutepath", "archivedir", "dir:", "fullpath", "uncpath"]) {
      assert.equal(types.toLowerCase().includes(forbidden), false, `${forbidden} 가 응답 타입에 있다`);
    }
    const fields = [...types.matchAll(/(\w+)\??:/g)].map((match) => match[1]);
    assert.deepEqual(
      [...new Set(fields)].sort(),
      [
        "fileCount",
        "folderName",
        "folders",
        "quoteNumbers",
        "reason",
        "relativePath",
        "status",
        "truncated",
        "year",
      ].sort()
    );
  });

  test("🔴 이 건의 견적서 폴더를 뺀다 — 통로가 제 손으로 번호를 쪼개지 않는다", () => {
    assert.ok(getBody.includes("excludeQuoteNumbers: quotes.map((quote) => quote.quoteNumber)"), getBody);
    // 거르는 규칙 · 본 번호 규칙은 저장소 · domain 쪽 한 자리에만 있다.
    for (const forbidden of ["quoteArchiveBaseNumber", "matchesQuoteArchiveFolder", "filter("]) {
      assert.equal(code.includes(forbidden), false, `통로가 거르는 규칙을 다시 짰다: ${forbidden}`);
    }
  });

  test("🔴 L/N · S/N 을 통로가 고쳐 쓰지 않는다 — 조회가 준 값을 그대로 넘긴다", () => {
    assert.ok(getBody.includes("lotNumber: repairCase.lotNumber,"));
    assert.ok(getBody.includes("serialNumber: repairCase.serialNumber,"));
    assert.equal(/\.trim\(\)/.test(getBody), false, "통로가 열쇠를 다듬는다");
    assert.equal(/toUpperCase|toLocaleUpperCase/.test(getBody), false, "통로가 열쇠를 접는다");
  });

  test("상태 셋 — found · disabled · failed, 캐시하지 않는다", () => {
    for (const status of ['status: "found"', 'status: "disabled"', 'status: "failed"']) {
      assert.ok(getBody.includes(status), status);
    }
    assert.ok(route.includes('NextResponse.json(body, { status: 200, headers: { "Cache-Control": "no-store" } })'));
  });

  test("🔴 폴더 수 · 기다리기 상한은 저장소 모듈이 쥔다 — 통로가 제 숫자를 들지 않는다", () => {
    assert.equal(/limit\s*:/.test(getBody), false, "통로가 제 상한을 넘긴다");
    assert.equal(/timeoutMs\s*:/.test(getBody), false, "통로가 제 기다리기 상한을 넘긴다");
    assert.ok(getBody.includes("found.truncated"), "「더 있습니다」를 나르지 않는다");
    // 받는 칸이 없다 — 검사할 일도 없다.
    assert.equal(getBody.includes("searchParams"), false, "질의 칸이 생겼다");
  });

  test("전역 보안 헤더와 같은 이름의 헤더를 붙이지 않는다", () => {
    for (const name of GLOBAL_HEADERS) {
      assert.equal(route.includes(`"${name}"`), false, name);
      assert.ok(nextConfig.includes(`"${name}"`), `next.config.ts 의 전역 헤더 목록이 바뀌었다: ${name}`);
    }
  });
});
