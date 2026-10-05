import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

/**
 * ============================================================================
 * GET /api/repair-cases/{id}/contact-folder/entries — 문지기 순서 · 목록만 · 경로 비노출
 * ============================================================================
 * 이 저장소는 라우트를 직접 부르지 않는다(세션 · DB 가 필요하다). 읽기 자체는
 * storage/contact-folder-entries.test.ts 가, 찾기는 storage/contact-folder-archive.test.ts 가,
 * 이름 규칙은 domain/contact-folder-naming.test.ts 가 본다.
 *
 * 여기서 못 박는 것은 여섯이다:
 *  · 🔴 권한이 **조회보다 앞**이다 — 권한 없는 사람에게 그 id 의 존재를 알리지 않는다
 *  · 🔴 **만들지 않는다 · 지우지 않는다** — mkdir · 쓰기 · 삭제 · 쓰기 메서드가 없다
 *  · 🔴 **파일 바이트를 중계하지 않는다** — 목록만 낸다(내용을 내보내는 길이 없다)
 *  · 🔴 응답 타입에 **절대 경로를 담는 칸이 없다**
 *  · 🔴 폴더를 **찾은 뒤에만** 그 안을 읽는다 — 여럿이면 목록을 내지 않는다
 *  · 🔴 하위 폴더 경로(조각 10)는 **이미 있는 검사**를 그대로 쓴다 — 통로가 제 규칙을 짜지
 *    않는다. 어긋나면 디스크를 보기 전에 400 이다.
 * ============================================================================
 */

const route = readFileSync(new URL("./route.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");
/** 주석을 뺀 코드 — 머리말이 까닭을 설명하느라 적은 낱말(mkdir · Content-Disposition …)에 걸리지 않게. */
const code = route.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const nextConfig = readFileSync(new URL("../../../../../../../next.config.ts", import.meta.url), "utf8");
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

describe("연락서 폴더 목록 통로 — 소스로 지킨다", () => {
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

  test("🔴 순서: 저장 모드 → 세션 → 살아 있는 계정 · 승인 → 권한 → 수리 건 → 경로 검사 → 루트 → 찾기 → 읽기", () => {
    const marks = [
      'getAuthSource() !== "database"',
      "await readSession()",
      "resolveActingUserForSession(session)",
      'actingUser.approvalStatus !== "APPROVED"',
      'hasPermission(actingUser, "repairCases.files", "READ")',
      "getRepairCaseContactFolderKeyById(id)",
      "checkQuoteFolderRelativePath(insidePath)",
      "resolveContactFolderArchiveRoot()",
      "findContactFolder({",
      "listContactFolderEntries({",
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
      getBody.indexOf('hasPermission(actingUser, "repairCases.files", "READ")') <
        getBody.indexOf("getRepairCaseContactFolderKeyById(id)"),
      "권한 검사가 조회보다 뒤에 있다"
    );
    // 넓은 문턱은 READ 한 번뿐이고, 쓰기 권한을 묻지 않는다.
    assert.equal(getBody.match(/hasPermission\(/g)?.length, 1);
    assert.equal(getBody.includes('"WRITE"'), false);
  });

  test("🔴 문턱을 넘었는데 안 보이면 403 이 아니라 404 — 존재 여부를 흘리지 않는다", () => {
    const afterQuery = getBody.slice(getBody.indexOf("getRepairCaseContactFolderKeyById(id)"));
    assert.ok(afterQuery.includes('fail(404, "NOT_FOUND"'), "조회 뒤의 404 가 없다");
    assert.equal(afterQuery.includes("fail(403"), false, "조회 뒤에 403 이 있다");
  });

  test("🔴 아무것도 만들지 않는다 · 지우지 않는다 — 가져오는 것은 문지기 · 조회 · 읽기 전용 둘뿐", () => {
    // 🔴 2026-10-05(조각 10) — 상대 경로 검사 하나가 늘었다(domain/quote-folder-link).
    //    **순수 함수**이고 읽기도 쓰기도 하지 않는다 — 통로가 제 규칙을 짜지 않게 하려는 것이다.
    assert.deepEqual(importSpecifiers(route), [
      "@/lib/auth/acting-user",
      "@/lib/auth/permission-resolver",
      "@/lib/auth/session",
      "@/lib/config/auth-source",
      "@/lib/db/queries/repair-cases",
      "@/lib/domain/quote-folder-link",
      "@/lib/storage/contact-folder-archive",
      "@/lib/storage/contact-folder-entries",
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
      /mutations/,
      /recordAudit/,
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
  });

  test("🔴 컨테이너 안 경로가 응답에 실리지 않는다 — 루트는 찾기 · 읽기에만 쓴다", () => {
    assert.equal(code.includes("CONTACT_FOLDER_ARCHIVE_DIR"), false);
    assert.equal(code.includes("CONTACT_FOLDER_ARCHIVE_UNC_ROOT"), false);
    assert.equal(code.includes("process.env"), false);
    // archiveRoot 는 선언 · null 판정 · 찾기 입력 · 읽기 입력 네 번만 나온다.
    assert.equal(getBody.match(/archiveRoot/g)?.length, 4);
    assert.ok(getBody.includes("const archiveRoot = resolveContactFolderArchiveRoot();"));
    assert.ok(getBody.includes("if (archiveRoot === null) {"));
    // 루트가 나가는 자리는 두 저장소 호출의 입력뿐이다.
    assert.equal(getBody.match(/root: archiveRoot,/g)?.length, 2);
    assert.equal(getBody.match(/\broot\b\s*:/g)?.length, 2);
  });

  test("🔴 응답 타입에 절대 경로를 담는 칸이 없다", () => {
    // 주석을 뺀 쪽에서 센다 — 머리말의 낱말이 칸으로 잡히지 않게.
    const types = code.slice(code.indexOf("type ContactFolderEntryBody"), code.indexOf("function fail("));
    assert.ok(types.includes('status: "found"'), types);
    for (const forbidden of ["root", "absolutepath", "archivedir", "dir:", "fullpath"]) {
      assert.equal(types.toLowerCase().includes(forbidden), false, `${forbidden} 가 응답 타입에 있다`);
    }
    // 나가는 칸은 이것들뿐이다.
    const fields = [...types.matchAll(/(\w+)\??:/g)].map((match) => match[1]);
    assert.deepEqual(
      [...new Set(fields)].sort(),
      [
        "entries",
        "folderName",
        "folderNames",
        "isDirectory",
        "modifiedAt",
        "name",
        "reason",
        "sizeBytes",
        "status",
        "totalCount",
        "truncated",
      ].sort()
    );
  });

  test("🔴 폴더를 찾은 뒤에만 그 안을 읽는다 — 여럿 · 없음 · 실패는 그 앞에서 끝난다", () => {
    const readAt = getBody.indexOf("listContactFolderEntries({");
    for (const earlier of [
      'found.status === "multiple"',
      'found.status === "not-found"',
      'found.status === "disabled"',
      'found.status === "failed"',
    ]) {
      const at = getBody.indexOf(earlier);
      assert.ok(at >= 0, `없다: ${earlier}`);
      assert.ok(at < readAt, `${earlier} 가 읽기보다 뒤에 있다`);
    }
    // 🔴 여럿일 때는 이름만 — 앱이 고르지도, 내용을 보이지도 않는다.
    const multiple = getBody.slice(getBody.indexOf('found.status === "multiple"'), readAt);
    assert.ok(multiple.includes("folderNames: found.folderNames"), multiple.slice(0, 200));
    assert.equal(multiple.includes("entries"), false, "여럿인데 목록을 낸다");
    assert.equal(multiple.includes("[0]"), false, "첫째를 골랐다");
  });

  test("상태 다섯 — found · multiple · not-found · disabled · failed, 캐시하지 않는다", () => {
    for (const status of [
      'status: "found"',
      'status: "multiple"',
      'status: "not-found"',
      'status: "disabled"',
      'status: "failed"',
    ]) {
      assert.ok(getBody.includes(status), status);
    }
    assert.ok(route.includes('NextResponse.json(body, { status: 200, headers: { "Cache-Control": "no-store" } })'));
  });

  test("🔴 하위 폴더 경로 — 검사를 새로 짜지 않는다, 어긋나면 디스크를 보기 전에 400 (조각 10)", () => {
    // 받는 곳은 쿼리 한 칸뿐이다 — 본문도, 헤더도, 경로 칸도 아니다.
    assert.ok(getBody.includes('request.nextUrl.searchParams.get("path")'), "하위 폴더 자리를 받지 않는다");
    assert.equal(getBody.match(/searchParams/g)?.length, 1, "쿼리를 여러 곳에서 읽는다");
    // 🔴 규칙은 도우미 주소가 쓰는 그 함수 하나다 — 통로가 제 손으로 세지 않는다.
    assert.ok(getBody.includes("checkQuoteFolderRelativePath(insidePath) !== null"));
    for (const forbidden of [/\.\.\//, /includes\("\.\."\)/, /\bnormalize\(/, /\bresolve\(/, /node:path/, /path\.join/]) {
      assert.equal(forbidden.test(code), false, `통로가 경로 규칙을 제 손으로 짠다: ${forbidden}`);
    }
    // 🔴 검사가 **디스크를 보는 일(루트 · 찾기 · 읽기)보다 앞**이다.
    const checkedAt = getBody.indexOf("checkQuoteFolderRelativePath(insidePath)");
    assert.ok(checkedAt >= 0);
    for (const later of ["resolveContactFolderArchiveRoot()", "findContactFolder({", "listContactFolderEntries({"]) {
      assert.ok(checkedAt < getBody.indexOf(later), `${later} 가 경로 검사보다 앞에 있다`);
    }
    assert.ok(getBody.includes('fail(400, "INVALID_PATH"'), "어긋난 경로를 400 으로 끝내지 않는다");
    // 읽기에 넘기는 것은 **폴더 안에서의 자리**다 — 루트도 이어 붙인 전체 경로도 아니다.
    assert.ok(getBody.includes("relativePath: insidePath,"));
    assert.equal(getBody.match(/insidePath/g)?.length, 4, "하위 폴더 자리를 다루는 자리가 늘었다");
  });

  test("🔴 줄 수 · 기다리기 · 깊이 상한은 저장소 모듈이 쥔다 — 통로가 제 숫자를 들지 않는다", () => {
    assert.equal(/depth/i.test(getBody), false, "통로가 제 깊이 상한을 든다");
    assert.equal(/\bsplit\(/.test(getBody), false, "통로가 경로를 제 손으로 쪼갠다");
    assert.equal(/limit\s*:/.test(getBody), false, "통로가 제 상한을 넘긴다");
    assert.equal(/timeoutMs\s*:/.test(getBody), false, "통로가 제 기다리기 상한을 넘긴다");
    assert.ok(getBody.includes("listed.truncated"), "「더 있습니다」를 나르지 않는다");
    assert.ok(getBody.includes("listed.totalCount"));
  });

  test("전역 보안 헤더와 같은 이름의 헤더를 붙이지 않는다", () => {
    for (const name of GLOBAL_HEADERS) {
      assert.equal(route.includes(`"${name}"`), false, name);
      assert.ok(nextConfig.includes(`"${name}"`), `next.config.ts 의 전역 헤더 목록이 바뀌었다: ${name}`);
    }
  });
});
