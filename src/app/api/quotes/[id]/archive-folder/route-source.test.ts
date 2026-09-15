import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

/**
 * ============================================================================
 * GET /api/quotes/{id}/archive-folder — 문지기 순서 · 이름 · 쓰기 없음 · 루트 비노출을 **소스로** 지킨다 (견적서 ④a)
 * ============================================================================
 * 이 저장소는 라우트를 직접 부르지 않는다(세션 · DB 가 필요하다). 찾기 자체는
 * storage/quote-archive.test.ts 가, 주소 규칙은 domain/quote-folder-link.test.ts 가 본다.
 * ============================================================================
 */

const route = readFileSync(new URL("./route.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");
/** 주석을 뺀 코드 — 머리말이 까닭을 설명하느라 적은 낱말(mkdir · QUOTE_ARCHIVE_UNC_ROOT …)에 걸리지 않게. */
const code = route.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const nextConfig = readFileSync(new URL("../../../../../../next.config.ts", import.meta.url), "utf8");
const getBody = route.slice(route.indexOf("export async function GET"));

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

describe("견적서 폴더 위치 통로 — 소스로 지킨다", () => {
  test("🔴 Next 가 정한 이름만 export 한다 — GET · runtime · dynamic 뿐", () => {
    assert.deepEqual(exportedNames(route), ["GET", "dynamic", "runtime"]);
    assert.equal(/^export\s*(?:\{|default|\*)/m.test(route), false);
    assert.ok(route.includes('export const runtime = "nodejs";'));
    assert.ok(route.includes('export const dynamic = "force-dynamic";'));
  });

  test("🔴 순서: 저장 모드 → 세션 → 살아 있는 계정 · 승인 → quotes READ → id → 견적서 → 루트 → 찾기 → 규칙", () => {
    const marks = [
      'getAuthSource() !== "database"',
      "await readSession()",
      "resolveActingUserForSession(session)",
      'actingUser.approvalStatus !== "APPROVED"',
      'hasPermission(actingUser, "quotes", "READ")',
      "isValidQuoteId(id)",
      "await getQuoteForEdit(id)",
      "resolveQuoteArchiveRoot()",
      "findQuoteArchiveFolder({",
      "isQuoteFolderRelativePath(result.relativePath)",
    ];
    let previous = -1;
    for (const mark of marks) {
      const at = getBody.indexOf(mark);
      assert.ok(at >= 0, `없다: ${mark}`);
      assert.ok(at > previous, `순서가 어긋났다: ${mark}`);
      previous = at;
    }
    assert.equal(getBody.match(/hasPermission\(/g)?.length, 1);
    assert.equal(getBody.includes('"WRITE"'), false);
  });

  test("🔴 쓰기가 없다 — 가져오는 것은 문지기 · 조회 · 읽기 전용 찾기 · 주소 규칙뿐", () => {
    assert.deepEqual(importSpecifiers(route), [
      "@/lib/auth/acting-user",
      "@/lib/auth/permission-resolver",
      "@/lib/auth/session",
      "@/lib/config/auth-source",
      "@/lib/db/queries/quotes",
      "@/lib/domain/quote-folder-link",
      "@/lib/storage/quote-archive",
      "@/lib/validation/quote-input",
      "next/server",
    ]);
    for (const forbidden of [
      "saveToQuoteArchive",
      "mutations",
      "recordAudit",
      "recordQuoteExport",
      "node:fs",
      "mkdir",
      "writeFile",
      "require(",
      "import(",
      "console.",
    ]) {
      assert.equal(code.includes(forbidden), false, `쓰기 · 기록 흔적: ${forbidden}`);
    }
  });

  test("🔴 루트 값이 응답에 실리지 않는다 — 루트는 찾기에만 쓰고, UNC 루트는 읽지도 않는다", () => {
    assert.equal(code.includes("QUOTE_ARCHIVE_UNC_ROOT"), false);
    assert.equal(code.includes("quote-folder-helper"), false);
    assert.equal(code.includes("process.env"), false);
    // archiveRoot 는 선언 · null 판정 · 찾기 입력 세 번만 나온다.
    assert.equal(getBody.match(/archiveRoot/g)?.length, 3);
    assert.ok(getBody.includes("const archiveRoot = resolveQuoteArchiveRoot();"));
    assert.ok(getBody.includes("if (archiveRoot === null) {"));
    assert.ok(getBody.includes("root: archiveRoot,"));
    // 응답을 만드는 자리마다 루트가 없다.
    const responses = [...getBody.matchAll(/respond\(\{[\s\S]*?\}\)/g)].map((match) => match[0]);
    assert.equal(responses.length, 5);
    for (const response of responses) {
      assert.equal(response.toLowerCase().includes("root"), false, response);
    }
    // 응답 본문 타입에 루트 칸이 없다.
    const type = route.slice(route.indexOf("type ArchiveFolderResponse"), route.indexOf("const UNOPENABLE_FOLDER_REASON"));
    assert.equal(type.toLowerCase().includes("root"), false);
  });

  test("상태 넷 — found · not-found · disabled · failed, 캐시하지 않는다", () => {
    for (const status of ['status: "found"', 'status: "not-found"', 'status: "disabled"', 'status: "failed"']) {
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
