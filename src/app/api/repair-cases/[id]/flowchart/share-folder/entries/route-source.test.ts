import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

/**
 * ============================================================================
 * 진단 Flowchart 노드의 **파일 고르기** 목록 통로 — 원본을 글자로 읽어 못 박는다
 * ============================================================================
 * 본보기(product-models/[id]/share-folder/entries/route-source.test.ts)와 같은 방법이다.
 * 여기서 지키는 것 일곱:
 *  · 🔴 **읽기뿐이다** — 쓰기 메서드도, DB 쓰기도, 감사도 없다.
 *  · 🔴 **파일 바이트를 중계하지 않는다** — 스트림 · Content-Disposition · 내려받기가 없다.
 *  · 🔴 **절대 경로가 응답에 실리지 않는다** — 루트를 돌려주는 길이 없다.
 *  · 🔴 **문턱은 [진단 Flowchart] 탭 하나**이고, 새 권한을 만들지 않았다.
 *  · 🔴 **주인(수리 건)을 DB 에 묻는다** — 모양이 아닌 id · 없는 건 · 휴지통이 모두 404.
 *  · 🔴 **검사 차례**가 본보기와 같다(출처가 맨 앞 — 세션보다도 앞).
 *  · 🔴 **경로 검사도 상한도 제 손으로 짜지 않는다** — 있는 것을 부른다.
 * ============================================================================
 */

const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("노드 파일 고르기 목록 통로 — 원본으로 지킨다", () => {
  test("🔵 먼저 표본 확인 — 원본을 실제로 읽었고 주석을 걷어 냈다", () => {
    // 경로가 틀리면 아래 「없다」 단언들이 전부 공짜로 통과한다.
    assert.ok(source.length > 2000, `원본이 ${source.length}자뿐이다 — 경로가 틀렸다`);
    assert.ok(code.includes("export async function GET("), "GET 을 못 찾았다");
    // 주석 걷기가 실제로 일을 하는가 — 머리말의 낱말이 code 에 남아 있으면 안 된다.
    assert.ok(source.includes("고르는 창"), "머리말이 사라졌다 — 이 시험의 전제가 바뀌었다");
    assert.equal(code.includes("고르는 창"), false, "주석 걷기가 일을 안 하고 있다");
  });

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
    assert.ok(code.includes('respond({ status: "disabled" })'));
    // 환경변수를 직접 만지지 않는다 — 설정을 읽는 길은 공용 함수 하나다.
    assert.equal(code.includes("process.env"), false);
    assert.equal(code.includes("REPAIR_DOCS_ARCHIVE_DIR"), false);
    assert.equal(code.match(/resolveRepairDocsArchiveRoot\(\)/g)?.length, 1);
  });

  test("🔴 문턱은 [진단 Flowchart] 탭 하나다 — 새 권한도, 열쇠를 글자로 또 적는 일도 없다", () => {
    assert.ok(code.includes('canOpenRepairCaseDetailTab(actingUser, "diagnosis")'));
    assert.equal(code.match(/canOpenRepairCaseDetailTab\(/g)?.length, 1, "문턱을 묻는 자리가 하나가 아니다");
    // 🔴 열쇠(diagnosisFlowcharts.view)를 통로가 따로 적지 않는다 — 표와 갈라질 자리다.
    assert.equal(code.includes("hasPermission("), false, "열쇠를 글자로 또 적었다");
    for (const forbidden of ["shareDocs.", "repairDocs.", "diagnosisFlowcharts."]) {
      assert.equal(code.includes(forbidden), false, `새 권한 영역이 생겼다: ${forbidden}`);
    }
  });

  test("🔴 주인을 DB 에 묻는다 — 모양이 아닌 id · 없는 건 · 휴지통이 모두 404 다", () => {
    assert.ok(code.includes("getRepairCaseFlowchartPageContext(repairCaseId)"));
    assert.equal(code.match(/fail\(404, "CASE_NOT_FOUND"/g)?.length, 2, "404 로 모으는 자리가 둘이 아니다");
    // 휴지통 판정을 통로가 다시 짜지 않는다 — 조회가 쥔다.
    for (const forbidden of ["isDeleted", "db/schema", "drizzle-orm"]) {
      assert.equal(code.includes(forbidden), false, `통로가 주인 판정을 다시 짰다: ${forbidden}`);
    }
    // 🔴 모양 검사만은 **조회보다 앞**이다(그 조회에는 UUID 관문이 없어 500 이 난다).
    assert.ok(code.indexOf("isValidUuid(repairCaseId)") < code.indexOf("getRepairCaseFlowchartPageContext("));
  });

  test("🔴 앞머리 차례 — 출처 → 세션 → 계정 → 승인 → 문턱 → 건 → 경로 → 루트 → 읽기", () => {
    const order = [
      "isTrustedOrigin(request)",
      "await readSession()",
      "resolveActingUserForSession(session)",
      'actingUser.approvalStatus !== "APPROVED"',
      "canOpenRepairCaseDetailTab(actingUser",
      "getRepairCaseFlowchartPageContext(repairCaseId)",
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

  test("🔴 출처 검사가 맨 앞에 있다 — fetch 로만 부를 수 있다", () => {
    const guardAt = code.indexOf("isTrustedOrigin(request)");
    assert.ok(guardAt > 0, "출처 검사가 없다");
    // 세션보다도 앞이다 — 남의 사이트에서 연 요청은 쿠키를 읽기 전에 끝난다.
    assert.ok(guardAt < code.indexOf("await readSession()"));
    assert.ok(code.includes('fail(403, "UNTRUSTED_ORIGIN"'));
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
