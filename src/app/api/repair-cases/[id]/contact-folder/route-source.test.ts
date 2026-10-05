import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

/**
 * ============================================================================
 * GET /api/repair-cases/{id}/contact-folder — 문지기 순서 · 쓰기 없음 · 경로 비노출을 **소스로** 지킨다
 * ============================================================================
 * 이 저장소는 라우트를 직접 부르지 않는다(세션 · DB 가 필요하다). 찾기 자체는
 * storage/contact-folder-archive.test.ts 가, 이름 · 대조 규칙은
 * domain/contact-folder-naming.test.ts 가, 주소 규칙은 domain/quote-folder-link.test.ts 가 본다.
 *
 * 여기서 못 박는 것은 넷이다:
 *  · 🔴 권한이 **조회보다 앞**이다 — 권한 없는 사람에게 그 id 의 존재를 알리지 않는다
 *  · 🔴 **만들지 않는다** — mkdir · 쓰기 호출 · 쓰기 메서드가 한 글자도 없다
 *  · 🔴 응답 타입에 **절대 경로(컨테이너 안 경로)를 담는 칸이 없다**
 *  · 🔴 화면으로 나가는 설정은 CONTACT_FOLDER_ARCHIVE_UNC_PATH **하나**뿐이다
 *    (설치본에 박히는 _UNC_ROOT 는 여기로 나가지 않는다)
 * ============================================================================
 */

const route = readFileSync(new URL("./route.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");
/** 주석을 뺀 코드 — 머리말이 까닭을 설명하느라 적은 낱말(mkdir · CONTACT_FOLDER_ARCHIVE_DIR …)에 걸리지 않게. */
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

describe("연락서 폴더 위치 통로 — 소스로 지킨다", () => {
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

  test("🔴 순서: 저장 모드 → 세션 → 살아 있는 계정 · 승인 → 권한 → 수리 건 → 루트 → 찾기 → 규칙", () => {
    const marks = [
      'getAuthSource() !== "database"',
      "await readSession()",
      "resolveActingUserForSession(session)",
      'actingUser.approvalStatus !== "APPROVED"',
      'hasPermission(actingUser, "repairCases.files", "READ")',
      "getRepairCaseContactFolderKeyById(id)",
      "resolveContactFolderArchiveRoot()",
      "findContactFolder({",
      "isQuoteFolderRelativePath(relativePath)",
      "resolveContactFolderUncPath()",
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
    const notFound = getBody.slice(getBody.indexOf("getRepairCaseContactFolderKeyById(id)"));
    const at404 = notFound.indexOf('fail(404, "NOT_FOUND"');
    assert.ok(at404 >= 0, "조회 뒤의 404 가 없다");
    // 조회 뒤에는 403 이 없다(없는 건과 못 보는 건을 같은 답으로 돌려준다).
    assert.equal(notFound.includes("fail(403"), false, "조회 뒤에 403 이 있다");
  });

  test("🔴 아무것도 만들지 않는다 — 가져오는 것은 문지기 · 조회 · 읽기 전용 찾기 · 주소 규칙뿐", () => {
    assert.deepEqual(importSpecifiers(route), [
      "@/lib/auth/acting-user",
      "@/lib/auth/permission-resolver",
      "@/lib/auth/session",
      "@/lib/config/auth-source",
      "@/lib/db/queries/repair-cases",
      "@/lib/domain/quote-folder-link",
      "@/lib/server/contact-folder-helper",
      "@/lib/storage/contact-folder-archive",
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

  test("🔴 컨테이너 안 경로가 응답에 실리지 않는다 — 루트는 찾기에만 쓰고, 환경변수는 읽지 않는다", () => {
    assert.equal(code.includes("CONTACT_FOLDER_ARCHIVE_DIR"), false);
    assert.equal(code.includes("CONTACT_FOLDER_ARCHIVE_UNC_ROOT"), false);
    assert.equal(code.includes("process.env"), false);
    // archiveRoot 는 선언 · null 판정 · 찾기 입력 세 번만 나온다.
    assert.equal(getBody.match(/archiveRoot/g)?.length, 3);
    assert.ok(getBody.includes("const archiveRoot = resolveContactFolderArchiveRoot();"));
    assert.ok(getBody.includes("if (archiveRoot === null) {"));
    assert.ok(getBody.includes("root: archiveRoot,"));
    // 응답을 만드는 자리마다 루트가 없다.
    const responses = [...getBody.matchAll(/respond\(\{[\s\S]*?\}\)/g)].map((match) => match[0]);
    assert.equal(responses.length, 7);
    for (const response of responses) {
      assert.equal(response.toLowerCase().includes("root"), false, response);
    }
  });

  test("🔴 응답 타입에 절대 경로를 담는 칸이 없다", () => {
    const type = route.slice(route.indexOf("type ContactFolderResponse"), route.indexOf("const UNOPENABLE_FOLDER_REASON"));
    assert.ok(type.includes('status: "found"'), type);
    for (const forbidden of ["root", "absolutepath", "archivedir", "dir:", "fullpath"]) {
      assert.equal(type.toLowerCase().includes(forbidden), false, `${forbidden} 가 응답 타입에 있다`);
    }
    // 나가는 칸은 이 넷뿐이다.
    const fields = [...type.matchAll(/(\w+)\??:/g)].map((match) => match[1]);
    assert.deepEqual([...new Set(fields)].sort(), [
      "folderName",
      "folderNames",
      "relativePath",
      "reason",
      "status",
      "uncPath",
    ].sort());
  });

  test("전체 주소(uncPath) — 찾았을 때만, 설정값 그대로(서버가 이어 붙이지 않는다)", () => {
    assert.ok(getBody.includes("const uncPath = resolveContactFolderUncPath();"));
    // 🔴 설정이 비었거나 없으면(null) 그 칸만 빠지고 나머지 응답은 그대로 나간다.
    assert.ok(getBody.includes("...(uncPath === null ? {} : { uncPath }),"));
    // 이 통로는 주소를 스스로 만들거나 이어 붙이지 않는다 — 가져와 부르는 자리 하나뿐이다.
    assert.equal(code.match(/resolveContactFolderUncPath/g)?.length, 2);
    // found 응답 말고는 uncPath 가 없다.
    const withUncPath = [...getBody.matchAll(/respond\(\{[\s\S]*?\}\)/g)]
      .map((match) => match[0])
      .filter((response) => response.includes("uncPath"));
    assert.equal(withUncPath.length, 1);
    assert.ok(withUncPath[0].includes('status: "found"'));
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

  test("🔴 맞는 폴더가 여럿이면 앱이 고르지 않는다 — 이름만 돌려주고 끝낸다", () => {
    const multiple = getBody.slice(getBody.indexOf('if (result.status === "multiple")'));
    assert.ok(multiple.includes("folderNames: result.folderNames"), multiple.slice(0, 200));
    assert.equal(multiple.includes("[0]"), false, "첫째를 골랐다");
  });

  test("전역 보안 헤더와 같은 이름의 헤더를 붙이지 않는다", () => {
    for (const name of GLOBAL_HEADERS) {
      assert.equal(route.includes(`"${name}"`), false, name);
      assert.ok(nextConfig.includes(`"${name}"`), `next.config.ts 의 전역 헤더 목록이 바뀌었다: ${name}`);
    }
  });
});
