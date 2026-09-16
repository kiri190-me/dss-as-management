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

  test("🔴 순서: 저장 모드 → 세션 → 살아 있는 계정 · 승인 → quotes READ → UNC 루트 → 설치 파일", () => {
    const marks = [
      'getAuthSource() !== "database"',
      "await readSession()",
      "resolveActingUserForSession(session)",
      'actingUser.approvalStatus !== "APPROVED"',
      'hasPermission(actingUser, "quotes", "READ")',
      "resolveQuoteFolderHelperRoot()",
      'helperRoot.status === "unset"',
      'helperRoot.status === "invalid"',
      "buildQuoteFolderHelperInstaller({ uncRoot: helperRoot.root, uncRootAlt: helperRoot.alt })",
    ];
    let previous = -1;
    for (const mark of marks) {
      const at = getBody.indexOf(mark);
      assert.ok(at >= 0, `없다: ${mark}`);
      assert.ok(at > previous, `순서가 어긋났다: ${mark}`);
      previous = at;
    }
    assert.equal(getBody.match(/hasPermission\(/g)?.length, 1);
  });

  test("루트가 비었거나 틀리면 409 와 사람이 읽는 문장 — 값은 싣지 않는다", () => {
    assert.ok(getBody.includes('fail(409, "HELPER_ROOT_NOT_CONFIGURED", "관리자가 공유폴더 주소를 설정해야 합니다.")'));
    assert.ok(getBody.includes('fail(409, "HELPER_ROOT_INVALID",'));
    // 루트 값은 설치 파일을 만드는 자리 한 번만 나온다(오류 · 로그에 없다).
    assert.equal(getBody.match(/helperRoot\.root/g)?.length, 1);
    for (const call of [...getBody.matchAll(/fail\([^)]*\)/g)].map((match) => match[0])) {
      assert.equal(call.includes("helperRoot.root"), false, call);
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
