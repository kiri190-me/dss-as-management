import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

/**
 * ============================================================================
 * 가리킴 담기 · 지우기 서버 액션 — 원본을 글자로 읽어 못 박는다
 * ============================================================================
 * 이 액션은 **디스크를 보고 DB 를 친다.** 동작 시험으로 둘을 한꺼번에 재려면 공유폴더와
 * 테스트 DB 를 동시에 쥐어야 하는데, 지금 개발 PC 는 공유폴더 설정이 비어 있다. 그래서
 * 두 쪽을 갈라 본다 — 디스크는 storage/repair-docs-entries.test.ts, DB 와 감사 로그는
 * mutations/product-model-kind-share-docs.integration.test.ts, 그리고 **그 둘을 잇는
 * 차례와 울타리**는 이 파일이 원본 글자로 본다.
 *
 * 지키는 것 여섯:
 *  · 🔴 **권한은 productModels.files WRITE** 하나다(새 권한을 만들지 않았다).
 *  · 🔴 **경로 규칙도 확장자 목록도 제 손으로 적지 않는다** — 있는 것을 부른다.
 *  · 🔴 **설정이 비면 담지 않는다** — 확인할 수 없는 자리를 표에 남기지 않는다.
 *  · 🔴 **디스크 확인이 DB 보다 앞이다.**
 *  · 🔴 **공유폴더에 쓰지 않는다** — 이 기능은 읽기 전용이다.
 *  · 🔴 **지우기는 감사를 남기는 mutation 을 거친다** — 휴지통이 없어 그것이 유일한 흔적이다.
 * ============================================================================
 */

const source = readFileSync(new URL("./product-model-kind-share-docs.ts", import.meta.url), "utf8").replace(
  /\r\n/g,
  "\n"
);
const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("가리킴 담기 · 지우기 — 원본으로 지킨다", () => {
  test("🔴 서버 액션이다 — \"use server\" 가 맨 앞이다", () => {
    assert.ok(source.startsWith('"use server";'), "\"use server\" 가 맨 앞에 없다");
    // 라우트가 아니다 — 메서드 내보내기가 없다.
    for (const forbidden of [/export async function GET/, /export async function POST/, /NextResponse/]) {
      assert.equal(forbidden.test(code), false, `라우트의 흔적: ${forbidden}`);
    }
  });

  test("🔴 권한은 productModels.files WRITE 하나다 — 새 권한을 만들지 않았다", () => {
    assert.ok(code.includes('hasPermission(actingUser, "productModels.files", "WRITE")'));
    assert.equal(code.match(/hasPermission\(/g)?.length, 1, "권한을 묻는 자리가 하나가 아니다");
    for (const forbidden of ["shareDocs.", "repairDocs.", "productModels.shareDocs", "repairCases.files"]) {
      assert.equal(code.includes(forbidden), false, `새 · 엉뚱한 권한 영역: ${forbidden}`);
    }
    // 세션에 박힌 값이 아니라 살아 있는 계정을 다시 읽는다.
    assert.ok(code.includes("resolveActingUserForSession(session)"));
    assert.ok(code.includes('actingUser.approvalStatus !== "APPROVED"'));
    // 담기와 지우기가 **같은 문** 하나를 지난다.
    assert.equal(code.match(/await resolveWriteActor\(\);/g)?.length, 2);
  });

  test("🔴 경로 규칙도 확장자 목록도 제 손으로 적지 않는다", () => {
    assert.ok(code.includes("checkQuoteFolderRelativePath(relativePath)"));
    assert.ok(code.includes("checkQuoteFolderOpenableFilePath(relativePath)"));
    // 🔴 18종을 베껴 적지 않는다 — 글자로 적힌 확장자가 한 개도 없다.
    for (const forbidden of ["xlsx", "xlsm", "hwp", "pptx", "\"pdf\"", ".pdf\"", "lastIndexOf"]) {
      assert.equal(code.includes(forbidden), false, `확장자 목록을 베꼈다: ${forbidden}`);
    }
    // 경로를 제 손으로 쪼개거나 정규식으로 보지 않는다.
    for (const forbidden of [/relativePath\.split\(/, /relativePath\.includes\(/, /\/\^.*\$\//]) {
      assert.equal(forbidden.test(code), false, `경로 규칙을 다시 짰다: ${forbidden}`);
    }
  });

  test("🔴 설정이 비면 **담지 않는다** — 확인할 수 없는 자리를 표에 남기지 않는다", () => {
    const disabledAt = code.indexOf("SHARE_FOLDER_DISABLED");
    const findAt = code.indexOf("findRepairDocsEntry(");
    const insertAt = code.indexOf("addProductModelKindShareDoc({");
    assert.ok(disabledAt > 0 && findAt > disabledAt, "설정 확인이 디스크 확인보다 뒤다");
    assert.ok(insertAt > findAt, "디스크를 보기 전에 DB 를 친다");
    // 환경변수를 직접 만지지 않는다.
    assert.equal(code.includes("process.env"), false);
    assert.equal(code.match(/resolveRepairDocsArchiveRoot\(\)/g)?.length, 1);
  });

  test("🔴 공유폴더에 쓰지 않는다 — 읽기 전용이고, 파일시스템을 직접 가져오지 않는다", () => {
    for (const forbidden of [
      "node:fs",
      "fs/promises",
      /\bmkdir\b/,
      /\bwriteFile\b/,
      /\bunlink\b/,
      /\brename\b/,
      /\breadFile\b/,
      /\bcreateReadStream\b/,
    ]) {
      const hit = typeof forbidden === "string" ? code.includes(forbidden) : forbidden.test(code);
      assert.equal(hit, false, `공유폴더를 고치는 · 직접 읽는 흔적: ${forbidden}`);
    }
  });

  test("🔴 담기 · 지우기 둘 다 감사를 남기는 mutation 을 거친다 — 여기서 표를 직접 치지 않는다", () => {
    assert.ok(code.includes("addProductModelKindShareDoc({"));
    assert.ok(code.includes("removeProductModelKindShareDoc({"));
    for (const forbidden of ["db.insert", "db.delete", "db.update", "drizzle", "insertAuditLog"]) {
      assert.equal(code.includes(forbidden), false, `액션이 표를 직접 친다: ${forbidden}`);
    }
  });

  test("🔴 종류는 셋 중 하나로 좁히고, id 는 UUID 모양만 받는다", () => {
    assert.equal(code.match(/isProductModelKind\(kind\)/g)?.length, 2, "두 액션 모두에서 좁히지 않는다");
    assert.ok(code.includes("isValidUuid(input.id)"));
    // 성공했을 때만 화면을 다시 그린다.
    assert.equal(code.match(/if \(result\.ok\) revalidateKind\(kind\);/g)?.length, 2);
  });
});
