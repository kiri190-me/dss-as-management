import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

/**
 * ============================================================================
 * 서류함 목록 통로 — 원본을 글자로 읽어 못 박는다
 * ============================================================================
 * 이웃 attachments/route-source.test.ts 와 같은 방법이다. 여기서 지키는 것 다섯:
 *  · 🔴 **읽기뿐이다** — 쓰기 메서드도, DB 쓰기도, 감사도 없다.
 *  · 🔴 **파일 바이트를 중계하지 않는다** — 스트림 · Content-Disposition · 내려받기가 없다.
 *  · 🔴 **절대 경로가 응답에 실리지 않는다** — 루트를 돌려주는 길이 없다.
 *  · 🔴 **권한은 productModels.view READ** 이고, 새 권한을 만들지 않았다.
 *  · 🔴 **경로 검사도 상한도 제 손으로 짜지 않는다** — 있는 것을 부른다.
 * ============================================================================
 */

const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("종류별 서류함 목록 통로 — 원본으로 지킨다", () => {
  test("🔴 읽기뿐이다 — 쓰기 메서드도, DB 쓰기도, 감사도 없다", () => {
    for (const forbidden of [
      /export async function POST/,
      /export async function PUT/,
      /export async function PATCH/,
      /export async function DELETE/,
      /\bmkdir\b/,
      /\bwriteFile\b/,
      /\bunlink\b/,
      /\binsertAuditLog\b/,
      /\bauditLogs\b/,
      /\brevalidatePath\b/,
      /\bdb\.insert\b/,
      /\bdb\.update\b/,
      /\bdb\.delete\b/,
    ]) {
      assert.equal(forbidden.test(code), false, `쓰는 흔적: ${forbidden}`);
    }
    assert.ok(/export async function GET\(/.test(code), "GET 이 없다");
  });

  test("🔴 파일 바이트를 중계하지 않는다 — 목록만 낸다", () => {
    for (const forbidden of [
      "Content-Disposition",
      "createReadStream",
      "readFile",
      "ReadableStream",
      "Blob",
      "Buffer",
      "attachment;",
    ]) {
      assert.equal(code.includes(forbidden), false, `바이트를 내보내는 흔적: ${forbidden}`);
    }
  });

  test("🔴 루트 · 절대 경로가 응답에 실리지 않는다", () => {
    // 루트 값은 읽기에만 쓰인다 — 응답 본문을 만드는 자리에 나오지 않는다.
    assert.equal(code.match(/archiveRoot/g)?.length, 3, "루트를 쓰는 자리가 늘었다");
    assert.ok(code.includes("respond({ status: \"disabled\" })"));
    // 환경변수를 직접 만지지 않는다 — 설정을 읽는 길은 공용 함수 하나다.
    assert.equal(code.includes("process.env"), false);
    assert.equal(code.includes("REPAIR_DOCS_ARCHIVE_DIR"), false);
    assert.equal(code.match(/resolveRepairDocsArchiveRoot\(\)/g)?.length, 1);
  });

  test("🔴 권한은 productModels.view READ 하나다 — 새 권한을 만들지 않았다", () => {
    assert.ok(code.includes('hasPermission(actingUser, "productModels.view", "READ")'));
    assert.equal(code.match(/hasPermission\(/g)?.length, 1, "권한을 묻는 자리가 하나가 아니다");
    for (const forbidden of ["shareDocs.", "repairDocs.", "productModels.shareDocs"]) {
      assert.equal(code.includes(forbidden), false, `새 권한 영역이 생겼다: ${forbidden}`);
    }
  });

  test("🔴 앞머리 차례 — 출처 → 세션 → 계정 → 승인 → 권한 → 종류 → 경로 → 루트 → 읽기", () => {
    const order = [
      "isTrustedOrigin(request)",
      "await readSession()",
      "resolveActingUserForSession(session)",
      'actingUser.approvalStatus !== "APPROVED"',
      "hasPermission(actingUser",
      "isProductModelKind(kind)",
      "checkQuoteFolderRelativePath(insidePath)",
      "resolveRepairDocsArchiveRoot()",
      "listRepairDocsEntries(",
    ];
    let cursor = -1;
    for (const mark of order) {
      const at = code.indexOf(mark);
      assert.ok(at > cursor, `차례가 어긋났다: ${mark}`);
      cursor = at;
    }
  });

  test("🔴 경로 검사도 상한도 제 손으로 짜지 않는다 — 있는 것을 부른다", () => {
    assert.ok(code.includes("checkQuoteFolderRelativePath(insidePath)"));
    // 통로가 제 숫자(깊이 · 줄 수 · 기다리기)를 들지 않는다 — 저장소 모듈이 쥔다.
    for (const forbidden of ["LIMIT", "MAX_DEPTH", "TIMEOUT", "limit:", "timeoutMs"]) {
      assert.equal(code.includes(forbidden), false, `통로가 상한을 들었다: ${forbidden}`);
    }
    assert.equal(/\breaddir\b|node:fs/.test(code), false, "통로가 디스크를 직접 읽는다");
  });

  test("🔴 Node 런타임 · 캐시 없음", () => {
    assert.ok(code.includes('export const runtime = "nodejs";'));
    assert.ok(code.includes('export const dynamic = "force-dynamic";'));
    assert.ok(code.includes('"Cache-Control": "no-store"'));
  });
});
