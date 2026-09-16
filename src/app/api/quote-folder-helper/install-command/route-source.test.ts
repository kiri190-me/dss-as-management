import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

/**
 * ============================================================================
 * GET /api/quote-folder-helper/install-command — 문지기 · 루트 비노출 · 캐시 없음을 **소스로** 지킨다 (견적서 ④c)
 * ============================================================================
 * 설치 명령 본문 자체는 server/quote-folder-helper.test.ts 가 본다(설치 파일과 한 벌인지까지).
 * 이 시험은 설치 파일 통로(installer/route-source.test.ts)와 **같은 방식 · 같은 잣대**다 —
 * 두 통로의 문지기가 갈라지지 않게.
 * ============================================================================
 */

const route = readFileSync(new URL("./route.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const installerRoute = readFileSync(new URL("../installer/route.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");
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

describe("도우미 설치 명령 통로 — 소스로 지킨다", () => {
  test("🔴 Next 가 정한 이름만 export 한다 — GET · runtime · dynamic 뿐", () => {
    assert.deepEqual(exportedNames(route), ["GET", "dynamic", "runtime"]);
    assert.equal(/^export\s*(?:\{|default|\*)/m.test(route), false);
    assert.ok(route.includes('export const runtime = "nodejs";'));
    assert.ok(route.includes('export const dynamic = "force-dynamic";'));
  });

  test("🔴 순서: 저장 모드 → 세션 → 살아 있는 계정 · 승인 → quotes READ → UNC 루트 → 명령", () => {
    const marks = [
      'getAuthSource() !== "database"',
      "await readSession()",
      "resolveActingUserForSession(session)",
      'actingUser.approvalStatus !== "APPROVED"',
      'hasPermission(actingUser, "quotes", "READ")',
      "resolveQuoteFolderHelperRoot()",
      'helperRoot.status === "unset"',
      'helperRoot.status === "invalid"',
      "buildQuoteFolderHelperInlineInstallCommand({ uncRoot: helperRoot.root, uncRootAlt: helperRoot.alt })",
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

  test("🔴 문지기가 설치 파일 통로와 같다 — 실패 코드 · 사유 문장이 글자 그대로 같다", () => {
    const installerGetBody = installerRoute.slice(installerRoute.indexOf("export async function GET"));
    for (const call of [
      'fail(403, "DATABASE_MODE_REQUIRED", "데이터베이스 저장 모드가 아닙니다.")',
      'fail(401, "UNAUTHENTICATED", "로그인이 필요합니다.")',
      'fail(401, "UNAUTHENTICATED", "사용자 정보를 확인할 수 없습니다.")',
      'fail(403, "ACCOUNT_NOT_APPROVED", "계정이 아직 승인되지 않았습니다.")',
      'fail(403, "FORBIDDEN", "이 작업을 수행할 권한이 없습니다.")',
      'fail(409, "HELPER_ROOT_NOT_CONFIGURED", "관리자가 공유폴더 주소를 설정해야 합니다.")',
      'fail(409, "HELPER_ROOT_INVALID",',
    ]) {
      assert.ok(getBody.includes(call), `이 통로에 없다: ${call}`);
      assert.ok(installerGetBody.includes(call), `설치 파일 통로와 다르다: ${call}`);
    }
  });

  test("루트 값은 명령을 만드는 자리 한 번뿐 — 오류 · 로그에 없다", () => {
    assert.equal(getBody.match(/helperRoot\.root/g)?.length, 1);
    for (const call of [...getBody.matchAll(/fail\([^)]*\)/g)].map((match) => match[0])) {
      assert.equal(call.includes("helperRoot.root"), false, call);
    }
    assert.equal(route.includes("console."), false);
    assert.equal(route.includes("process.env"), false);
    assert.equal(route.includes("QUOTE_ARCHIVE_DIR"), false);
  });

  test("🔴 라우트는 명령을 만들기만 한다 — 실행 · 파일 · 레지스트리 · DB 가 없다", () => {
    assert.deepEqual(importSpecifiers(route), [
      "@/lib/auth/acting-user",
      "@/lib/auth/permission-resolver",
      "@/lib/auth/session",
      "@/lib/config/auth-source",
      "@/lib/server/quote-folder-helper",
      "next/server",
    ]);
    for (const forbidden of [
      "child_process",
      "spawn(",
      "exec(",
      "node:fs",
      "Registry",
      "@/lib/db/",
      "mutations",
      "require(",
      "import(",
    ]) {
      assert.equal(route.includes(forbidden), false, forbidden);
    }
  });

  test("JSON 한 칸(command)으로 · 캐시하지 않음, 전역 헤더 이름은 쓰지 않는다", () => {
    assert.ok(
      getBody.includes(
        'NextResponse.json({ command }, { status: 200, headers: { "Cache-Control": "no-store" } })'
      )
    );
    for (const name of GLOBAL_HEADERS) {
      assert.equal(route.includes(`"${name}"`), false, name);
      assert.ok(nextConfig.includes(`"${name}"`), `next.config.ts 의 전역 헤더 목록이 바뀌었다: ${name}`);
    }
  });
});
