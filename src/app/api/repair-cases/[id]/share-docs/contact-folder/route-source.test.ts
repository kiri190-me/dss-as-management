import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

/**
 * ============================================================================
 * POST /api/repair-cases/{id}/share-docs/contact-folder — 규율 (2026-10-08)
 * ============================================================================
 * 이 저장소는 라우트를 직접 부르지 않는다(세션 · DB · 디스크가 필요하다). 그래서 이
 * 통로에서 **바뀌면 안 되는 것**을 원본 글자로 본다:
 *
 *  · 🔴 **「1. 수리 관련」에 쓰지 않는다** — 운영에서 그 볼륨은 읽기 전용이다
 *  · 🔴 **바이트를 브라우저로 내보내지 않는다** — 스트림 · 내려받기 갈래가 없다
 *  · 🔴 꽂는 자리는 **`공통`** 이다(접수 자동 복사와 같은 자리 — `DATA` 도 분류 폴더도 아니다)
 *  · 🔴 **연락서 폴더를 만들지 않는다**
 *  · 🔴 권한은 **이미 있는 문**이다(`repairCases.files` WRITE) — 새 권한이 없다
 *  · 🔴 설정이 **하나라도** 비면 DB 도 디스크도 안 본다
 *  · 🔴 화면이 보낸 경로를 **다시 본다** — 목록 통로가 쓰는 그 검사다
 *  · 🔴 상한 · 실행 파일 거절을 통로가 **다시 짜지 않는다** — 저장소 모듈이 쥔다
 *  · 🔴 감사는 **새로 꽂았을 때만** · 응답과 로그에 경로가 없다
 *
 * 읽기 자체는 lib/storage/repair-docs-file-read.test.ts 가, 꽂기는
 * lib/storage/contact-folder-common-copy.test.ts 가, 화면 쪽 흐름은
 * components/repair-cases/files/share-doc-contact-folder-save.test.ts 가 본다.
 * ============================================================================
 */

const route = readFileSync(new URL("./route.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");
/** 주석을 뺀 코드 — 머리말이 까닭을 설명하느라 적은 낱말에 걸리지 않게. */
const code = route.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const postBody = code.slice(code.indexOf("export async function POST("), code.indexOf("function toNote("));

function exportedNames(source: string): string[] {
  return [
    ...source.matchAll(
      /^export\s+(?:async\s+)?(?:function|const|let|var|class|type|interface|enum)\s+([A-Za-z_$][\w$]*)/gm
    ),
  ]
    .map((match) => match[1])
    .sort();
}

describe("[연락서 폴더에 저장] 통로 — 원본으로 지킨다", () => {
  test("🔴 Next 가 정한 이름만 export 한다 — POST · runtime · dynamic 뿐", () => {
    assert.deepEqual(exportedNames(route), ["POST", "dynamic", "runtime"]);
    assert.ok(route.includes('export const runtime = "nodejs";'));
    assert.ok(route.includes('export const dynamic = "force-dynamic";'));
    for (const method of ["GET", "PUT", "PATCH", "DELETE"]) {
      assert.equal(
        new RegExp(`export\\s+(?:async\\s+)?function\\s+${method}\\b`).test(route),
        false,
        `${method} 가 생겼다`
      );
    }
  });

  test("🔴 「1. 수리 관련」에 쓰지 않는다 — 쓰기 · 지우기 · 옮기기가 한 글자도 없다", () => {
    for (const forbidden of [
      /\bunlink\b/,
      /\brm\b/,
      /\brmdir\b/,
      /\brename\b/,
      /\btruncate\b/,
      /\bmkdir\b/,
      /\bwriteFile\b/,
      /\bnode:fs\b/,
    ]) {
      assert.equal(forbidden.test(code), false, `흔적: ${forbidden}`);
    }
    // 서류함에서 하는 일은 **읽기 하나**다.
    assert.equal(code.match(/readRepairDocsFile\(/g)?.length, 1, "읽는 자리가 하나가 아니다");
  });

  test("🔴 바이트를 브라우저로 내보내지 않는다 — 내려받기 · 미리보기 갈래가 없다", () => {
    for (const forbidden of [
      "Content-Disposition",
      "ReadableStream",
      "createReadStream",
      "new Response(",
      'toString("base64")',
    ]) {
      assert.equal(code.includes(forbidden), false, `바이트를 내보내는 흔적: ${forbidden}`);
    }
    // 바이트가 가는 곳은 **꽂기와 크기 재기** 둘뿐이다.
    assert.deepEqual(code.match(/read\.bytes[.\w]*/g)?.sort(), ["read.bytes", "read.bytes.byteLength"]);
  });

  test("🔴 `공통` 에 꽂는다 — 접수 자동 복사와 **같은 함수**이고, 폴더를 만들지 않는다", () => {
    assert.ok(code.includes("copyIntoContactFolderCommonFolder({"), "공통에 꽂는 함수를 안 쓴다");
    assert.equal(code.match(/copyIntoContactFolderCommonFolder\(/g)?.length, 1, "꽂는 자리가 하나가 아니다");
    // 🔴 다른 자리로 가는 길이 섞이지 않았다.
    for (const forbidden of [
      "copyIntoContactFolderDataFolder",
      "copyIntoContactFolder(",
      "contactFolderCategoryFolderName",
      "CONTACT_FOLDER_DATA_FOLDER_NAME",
    ]) {
      assert.equal(code.includes(forbidden), false, `다른 자리로 가는 길이 섞였다: ${forbidden}`);
    }
    // 🔴 연락서 폴더를 만드는 길이 없다 — 없으면 `no-folder` 로 사람에게 말한다.
    for (const forbidden of ["createContactFolder", "recordContactFolderCreated"]) {
      assert.equal(code.includes(forbidden), false, `폴더를 만든다: ${forbidden}`);
    }
    assert.ok(code.includes('status: "no-folder"'), "폴더가 없을 때를 말하지 않는다");
  });

  test("🔴 권한은 이미 있는 문이다 — `repairCases.files` WRITE, 새 권한이 없다", () => {
    assert.ok(postBody.includes('hasPermission(actingUser, "repairCases.files", "WRITE")'), "문턱이 다르다");
    assert.equal(/"productModels\./.test(code), false, "다른 메뉴의 권한을 끌어왔다");
    assert.equal(/"shareDocs\./.test(code), false, "새 권한을 만들었다");
    // 🔴 권한이 조회 · 디스크보다 앞이다.
    const permission = postBody.indexOf('hasPermission(actingUser, "repairCases.files", "WRITE")');
    const query = postBody.indexOf("getRepairCaseContactFolderKeyById(");
    const disk = postBody.indexOf("readRepairDocsFile({");
    assert.ok(permission >= 0 && query > permission, "🔴 권한보다 조회가 앞이다");
    assert.ok(disk > permission, "🔴 권한보다 디스크가 앞이다");
  });

  test("🔴 설정이 **하나라도** 비면 DB 도 디스크도 보지 않는다", () => {
    const guard = postBody.indexOf("resolveRepairDocsArchiveRoot() === null || resolveContactFolderArchiveRoot() === null");
    assert.ok(guard >= 0, "두 설정을 함께 보지 않는다");
    assert.ok(guard < postBody.indexOf("getRepairCaseContactFolderKeyById("), "설정을 보기 전에 DB 를 읽는다");
    assert.ok(guard < postBody.indexOf("readRepairDocsFile({"), "설정을 보기 전에 디스크를 읽는다");
    // 다만 권한은 그보다 먼저 본다 — 설정 상태조차 아무에게나 알리지 않는다.
    assert.ok(postBody.indexOf('hasPermission(actingUser, "repairCases.files", "WRITE")') < guard);
  });

  test("🔴 화면이 보낸 경로를 다시 본다 — 목록 통로가 쓰는 **그 검사**다", () => {
    assert.ok(postBody.includes("checkQuoteFolderRelativePath(sourcePath)"), "경로를 안 본다");
    assert.ok(
      postBody.indexOf("checkQuoteFolderRelativePath(sourcePath)") < postBody.indexOf("readRepairDocsFile({"),
      "디스크를 본 뒤에 경로를 본다"
    );
    // 🔴 규칙을 베껴 적은 자리가 없다 — 상한 · 실행 파일 · 깊이는 저장소 모듈이 쥔다.
    for (const forbidden of [
      "MAX_ATTACHMENT_SIZE_BYTES",
      "isExecutableExtension",
      "EXECUTABLE_EXTENSIONS",
      '".."',
      "normalizeFileExtension",
      "path.join",
      "REPAIR_DOCS_ARCHIVE_DIR",
      "CONTACT_FOLDER_ARCHIVE_DIR",
    ]) {
      assert.equal(code.includes(forbidden), false, `통로가 제 규칙을 들었다: ${forbidden}`);
    }
    // 거절 갈래는 **코드**로 가른다 — 사유 글귀로 갈라 보면 글귀가 바뀔 때 조용히 틀린다.
    assert.ok(code.includes("REJECTION_RESPONSE[read.rejection]"), "거절 갈래를 코드로 가르지 않는다");
    for (const rejection of ["INVALID_PATH", "NOT_FOUND", "NOT_A_FILE", "EXECUTABLE", "TOO_LARGE"]) {
      assert.ok(code.includes(`${rejection}:`), `거절 갈래 ${rejection} 을 다루지 않는다`);
    }
  });

  test("🔴 폴더는 가져오지 않는다 · 한 번에 한 줄이다", () => {
    assert.ok(code.includes('code: "NOT_A_FILE"'), "폴더를 거절하지 않는다");
    // 여러 자리를 한 번에 받는 칸이 없다 — 화면이 한 줄씩 부른다.
    for (const forbidden of ["paths", "JSON.parse", "request.json(", "formData(", "zip", "ZIP"]) {
      assert.equal(code.includes(forbidden), false, `몰아 받는 흔적: ${forbidden}`);
    }
  });

  test("🔴 감사 기록 — 새로 꽂았을 때만 · 응답과 로그에 경로가 없다", () => {
    assert.ok(code.includes("recordContactFolderShareDocSaved({"), "기록을 남기지 않는다");
    assert.equal(code.match(/recordContactFolderShareDocSaved\(/g)?.length, 1, "기록하는 자리가 하나가 아니다");
    // 🔴 `copied` 일 때만 — 같은 내용이 이미 있어 안 쓴 경우에는 새로 생긴 것이 없다.
    const audit = code.indexOf("recordContactFolderShareDocSaved({");
    const guard = code.lastIndexOf('result.status === "copied"', audit);
    assert.ok(guard >= 0 && guard < audit, "🔴 unchanged 에도 기록을 남긴다");
    // 어느 수리건에 · 어느 가리킴에서 · 무슨 이름으로 — 셋을 적는다.
    const entry = code.slice(audit, code.indexOf("}", code.indexOf("fileSize:", audit)));
    for (const field of ["repairCaseId:", "sourceRelativePath: sourcePath", "fileName: result.fileName", "fileSize:"]) {
      assert.ok(entry.includes(field), `감사에 ${field} 가 빠졌다`);
    }

    // 로그 · 응답에 경로가 없다.
    assert.equal(/reason:\s*[A-Za-z_$][\w$]*\.message/.test(code), false, "오류 message 를 사유로 썼다");
    for (const forbidden of ["error.message", "String(error)", "JSON.stringify(error)"]) {
      assert.equal(code.includes(forbidden), false, `로그에 ${forbidden} 가 들어간다`);
    }
    assert.ok(code.includes("error instanceof Error ? error.name :"), "오류 이름만 적는 모양이 아니다");
    // 나가는 칸은 상태 · 파일 이름 · 막힘 여부 · 사유뿐이다.
    const note = route.slice(route.indexOf("type ContactFolderCopyNote ="), route.indexOf("const REJECTION_RESPONSE"));
    assert.equal(/\bfolderName\b/.test(note), false, "폴더 이름까지 싣는다");
    assert.equal(/\bpath\b/i.test(note), false, "경로를 담는 칸이 있다");
  });

  test("🔴 바꾸는 통로다 — 출처와 저장 모드를 먼저 본다", () => {
    assert.ok(postBody.includes("isTrustedOrigin(request)"), "출처를 보지 않는다");
    assert.ok(postBody.indexOf("isTrustedOrigin(request)") < postBody.indexOf("readSession("), "출처가 뒤에 있다");
    assert.ok(postBody.includes('getAuthSource() !== "database"'), "저장 모드를 보지 않는다");
    // 휴지통 건 · 없는 건 · id 모양이 아닌 것이 모두 404 로 모인다(이웃 통로와 같다).
    assert.ok(postBody.includes('fail(404, "NOT_FOUND"'), "없는 건을 404 로 모으지 않는다");
  });
});
