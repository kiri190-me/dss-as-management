import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

/**
 * ============================================================================
 * GET /api/quote-folder-helper/installer — 문지기 · 루트 비노출 · 첨부 헤더를 **소스로** 지킨다 (견적서 ④a)
 * ============================================================================
 * 설치 파일 본문 자체는 server/quote-folder-helper.test.ts 가 본다.
 * ============================================================================
 */

const route = readFileSync(new URL("./route.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const nextConfig = readFileSync(new URL("../../../../../next.config.ts", import.meta.url), "utf8");
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

describe("도우미 설치 파일 통로 — 소스로 지킨다", () => {
  test("🔴 Next 가 정한 이름만 export 한다 — GET · runtime · dynamic 뿐", () => {
    assert.deepEqual(exportedNames(route), ["GET", "dynamic", "runtime"]);
    assert.equal(/^export\s*(?:\{|default|\*)/m.test(route), false);
    assert.ok(route.includes('export const runtime = "nodejs";'));
    assert.ok(route.includes('export const dynamic = "force-dynamic";'));
  });

  test("🔴 순서: 저장 모드 → 세션 → 살아 있는 계정 · 승인 → 설치 권한 → UNC 루트 → 설치 파일", () => {
    const marks = [
      'getAuthSource() !== "database"',
      "await readSession()",
      "resolveActingUserForSession(session)",
      'actingUser.approvalStatus !== "APPROVED"',
      'mayInstallQuoteFolderHelper((areaKey) => hasPermission(actingUser, areaKey, "READ"))',
      "resolveQuoteFolderHelperInstallRoots()",
      'helperRoots.status === "unset"',
      'helperRoots.status === "invalid"',
      "buildQuoteFolderHelperInstaller(quoteFolderHelperRootsInput(helperRoots.roots))",
    ];
    let previous = -1;
    for (const mark of marks) {
      const at = getBody.indexOf(mark);
      assert.ok(at >= 0, `없다: ${mark}`);
      assert.ok(at > previous, `순서가 어긋났다: ${mark}`);
      previous = at;
    }
    assert.equal(getBody.match(/hasPermission\(/g)?.length, 1);
    assert.equal(getBody.match(/mayInstallQuoteFolderHelper\(/g)?.length, 1);
  });

  /**
   * 🔴 2026-09-30 — 설치 통로가 `quotes` READ **하나**에서 「`quotes` 또는 `customerPortal`
   * READ」로 넓어졌다. 뜻이 약해지지 않게 이 시험이 세 가지를 함께 못 박는다:
   *  · 통로가 **스스로 영역 이름을 적지 않는다** — 목록은 한 곳(server/quote-folder-helper.ts)이고,
   *    그 목록이 무엇인지와 「둘 다 없으면 거짓」은 quote-folder-helper.test.ts 가 값으로 본다.
   *  · 묻는 수준은 여전히 **READ 뿐**이다(WRITE 로 올리지도, 아예 빼지도 않았다).
   *  · 🔴 권한을 통과하지 못하면 그대로 403 — 「누구나」로 가는 길이 없다.
   */
  test("🔴 설치 권한은 한 곳에서 판단한다 — 통로가 영역 이름을 스스로 적지 않고, 막히면 403", () => {
    for (const hardcoded of ['"quotes"', '"customerPortal"', '"WRITE"', '"MANAGE"']) {
      assert.equal(getBody.includes(hardcoded), false, `통로가 ${hardcoded} 를 직접 적는다`);
    }
    assert.ok(route.includes("mayInstallQuoteFolderHelper,"), "설치 권한 판단을 가져오지 않는다");
    const permissionAt = getBody.indexOf("mayInstallQuoteFolderHelper(");
    const rejected = getBody.indexOf('fail(403, "FORBIDDEN", "이 작업을 수행할 권한이 없습니다.")');
    assert.ok(permissionAt >= 0 && rejected > permissionAt, "권한을 통과하지 못했을 때 403 이 아니다");
  });

  test("루트가 비었거나 틀리면 409 와 사람이 읽는 문장 — 값은 싣지 않는다", () => {
    assert.ok(getBody.includes('fail(409, "HELPER_ROOT_NOT_CONFIGURED", "관리자가 공유폴더 주소를 설정해야 합니다.")'));
    assert.ok(getBody.includes('fail(409, "HELPER_ROOT_INVALID",'));
    // 루트 값은 설치 파일을 만드는 자리 한 번만 나온다(루트가 여럿이어도 — 오류 · 로그에 없다).
    assert.equal(getBody.match(/helperRoots\.roots/g)?.length, 1);
    for (const call of [...getBody.matchAll(/fail\([^)]*\)/g)].map((match) => match[0])) {
      assert.equal(call.includes("helperRoots.roots"), false, call);
    }
    assert.equal(route.includes("console."), false);
    assert.equal(route.includes("process.env"), false);
  });

  test("🔴 라우트는 설치 파일을 만들기만 한다 — 실행 · 파일 · 레지스트리 · DB 가 없다", () => {
    assert.deepEqual(importSpecifiers(route), [
      "@/lib/auth/acting-user",
      "@/lib/auth/permission-resolver",
      "@/lib/auth/session",
      "@/lib/config/auth-source",
      "@/lib/server/quote-folder-helper",
      "next/server",
    ]);
    for (const forbidden of ["child_process", "spawn(", "exec(", "node:fs", "Registry", "@/lib/db/", "mutations", "require(", "import("]) {
      assert.equal(route.includes(forbidden), false, forbidden);
    }
  });

  test("첨부로 내려준다 — 이름 · 형식 · 길이 · 캐시하지 않음, 전역 헤더 이름은 쓰지 않는다", () => {
    assert.ok(getBody.includes('"Content-Type": "application/octet-stream"'));
    assert.ok(getBody.includes('"Content-Disposition": `attachment; filename="${QUOTE_FOLDER_HELPER_INSTALLER_FILE_NAME}"`'));
    assert.ok(getBody.includes('"Content-Length": String(body.byteLength)'));
    assert.ok(getBody.includes('"Cache-Control": "no-store"'));
    for (const name of GLOBAL_HEADERS) {
      assert.equal(route.includes(`"${name}"`), false, name);
      assert.ok(nextConfig.includes(`"${name}"`), `next.config.ts 의 전역 헤더 목록이 바뀌었다: ${name}`);
    }
  });
});
