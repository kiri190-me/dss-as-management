import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

/**
 * ============================================================================
 * 모델별 가리킴 담기 · 지우기 서버 액션 — 원본을 글자로 읽어 못 박는다
 * ============================================================================
 * 이 액션은 **디스크를 보고 DB 를 친다.** 동작 시험으로 둘을 한꺼번에 재려면 공유폴더와
 * 테스트 DB 를 동시에 쥐어야 하는데, 지금 개발 PC 는 공유폴더 설정이 비어 있다. 그래서
 * 두 쪽을 갈라 본다 — 디스크는 storage/repair-docs-entries.test.ts, DB 와 감사 로그는
 * mutations/product-model-share-docs.integration.test.ts, 그리고 **그 둘을 잇는 차례와
 * 울타리**는 이 파일이 원본 글자로 본다(이웃 product-model-kind-share-docs-source.test.ts
 * 와 같은 방법이다).
 *
 * 지키는 것 여덟:
 *  · 🔴 **권한은 productModels.files WRITE** 하나다(새 권한을 만들지 않았다).
 *  · 🔴 **휴지통에 있는 모델은 거절한다** — 담기도 지우기도 같은 문을 지난다.
 *  · 🔴 **경로 규칙도 확장자 목록도 제 손으로 적지 않는다** — 있는 것을 부른다.
 *  · 🔴 **설정이 비면 담지 않는다** — 확인할 수 없는 자리를 표에 남기지 않는다.
 *  · 🔴 **디스크 확인이 DB 보다 앞이다.**
 *  · 🔴 **거절 사유에 경로가 한 글자도 들어가지 않는다**(폴더 이름에 고객사명이 섞여 있다).
 *  · 🔴 **공유폴더에 쓰지 않는다** — 이 기능은 읽기 전용이다.
 *  · 🔴 **지우기는 감사를 남기는 mutation 을 거친다** — 휴지통이 없어 그것이 유일한 흔적이다.
 * ============================================================================
 */

const source = readFileSync(new URL("./product-model-share-docs.ts", import.meta.url), "utf8").replace(
  /\r\n/g,
  "\n"
);
const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/**
 * `deny(` 한 번의 인자 전부를 괄호 짝을 세어 떼어 낸다. 정규식 하나로는 안쪽 괄호
 * (`PATH_REJECTION_MESSAGES[rejection]` · 삼항)가 섞인 호출을 못 자른다.
 * 함수 **정의**(`function deny(`)는 건너뛴다.
 */
function denyCallArguments(text: string): string[] {
  const calls: string[] = [];
  for (let at = text.indexOf("deny("); at !== -1; at = text.indexOf("deny(", at + 1)) {
    if (text.slice(0, at).endsWith("function ")) continue;
    let depth = 0;
    for (let cursor = at + 4; cursor < text.length; cursor += 1) {
      if (text[cursor] === "(") depth += 1;
      else if (text[cursor] === ")") {
        depth -= 1;
        if (depth === 0) {
          calls.push(text.slice(at + 5, cursor));
          break;
        }
      }
    }
  }
  return calls;
}

describe("모델별 가리킴 담기 · 지우기 — 원본으로 지킨다", () => {
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

  test("🔴 휴지통에 있는 모델은 거절한다 — 담기 · 지우기 둘 다 같은 조회를 지난다", () => {
    // 판정은 조회 하나가 쥔다 — 액션이 is_deleted 를 제 손으로 보지 않는다.
    assert.equal(code.match(/getShareDocProductModel\(input\.productModelId\)/g)?.length, 2);
    assert.equal(
      code.match(/deny\("MODEL_NOT_FOUND", MODEL_NOT_FOUND_MESSAGE\)/g)?.length,
      2,
      "담기 · 지우기 가운데 한쪽만 거절한다"
    );
    assert.equal(code.includes("isDeleted"), false, "액션이 휴지통 판정을 제 손으로 다시 짰다");

    // 🔴 주인 확인이 **디스크보다도 DB 쓰기보다도 앞**이다.
    const modelAt = code.indexOf("getShareDocProductModel(input.productModelId)");
    assert.ok(modelAt > 0);
    assert.ok(code.indexOf("findRepairDocsEntry(") > modelAt, "모델을 보기 전에 디스크를 본다");
    assert.ok(code.indexOf("addProductModelShareDoc({") > modelAt, "모델을 보기 전에 표를 친다");
    assert.ok(code.indexOf("removeProductModelShareDoc({") > modelAt, "모델을 보기 전에 표를 친다");
    // 권한이 그보다도 앞이다 — 못 보는 사람에게 「그 모델이 있는가」를 알려 주지 않는다.
    assert.ok(code.indexOf("resolveWriteActor") < modelAt);
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
    const insertAt = code.indexOf("addProductModelShareDoc({");
    assert.ok(disabledAt > 0 && findAt > disabledAt, "설정 확인이 디스크 확인보다 뒤다");
    assert.ok(insertAt > findAt, "디스크를 보기 전에 DB 를 친다");
    // 환경변수를 직접 만지지 않는다.
    assert.equal(code.includes("process.env"), false);
    assert.equal(code.match(/resolveRepairDocsArchiveRoot\(\)/g)?.length, 1);
  });

  test("🔴 거절 사유에 **경로가 한 글자도 들어가지 않는다**", () => {
    const calls = denyCallArguments(code);
    assert.ok(calls.length >= 9, `deny 호출을 못 찾았다(${calls.length})`);

    // 🔴 사람이 적은 경로도, 설정의 루트도, 폴더 이름도 사유에 **끼워 넣을 길이 없다.**
    //    `found.reason`(저장소 모듈이 만든 **경로 없는** 짧은 문장)과
    //    `found.isDirectory`(붙박이 두 문장 가운데 하나를 고르는 참·거짓)만 지난다.
    for (const call of calls) {
      for (const forbidden of ["relativePath", "archiveRoot", "input.", "model.", "${"]) {
        assert.equal(call.includes(forbidden), false, `거절 사유에 경로가 섞일 길: ${call}`);
      }
    }
    assert.ok(calls.includes('"SHARE_FOLDER_FAILED", found.reason'), "저장소 사유를 그대로 넘기지 않는다");

    // 사유 글자를 만드는 표에도 사람이 적은 값이 섞이지 않는다 — 코드만 받아 글자로 바꾼다.
    const table = code.slice(
      code.indexOf("const PATH_REJECTION_MESSAGES"),
      code.indexOf("type Actor =")
    );
    assert.ok(table.length > 0);
    for (const forbidden of ["relativePath", "archiveRoot", "input", "rejection}"]) {
      assert.equal(table.includes(forbidden), false, `사유 표에 경로가 섞일 길: ${forbidden}`);
    }
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
    assert.ok(code.includes("addProductModelShareDoc({"));
    assert.ok(code.includes("removeProductModelShareDoc({"));
    for (const forbidden of ["db.insert", "db.delete", "db.update", "drizzle", "insertAuditLog"]) {
      assert.equal(code.includes(forbidden), false, `액션이 표를 직접 친다: ${forbidden}`);
    }
  });

  test("🔴 id 는 UUID 모양만 받고, 성공했을 때만 화면을 다시 그린다", () => {
    assert.ok(code.includes("isValidUuid(input.id)"));
    assert.equal(code.match(/if \(result\.ok\) revalidateModel\(model\.id\);/g)?.length, 2);
    // 🔴 종류용 네 파일을 끌어다 쓰지 않는다 — 본떴을 뿐 묶지 않았다.
    assert.equal(code.includes("product-model-kind-share-docs"), false);
  });
});
