import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

/**
 * ============================================================================
 * POST /api/repair-cases/{id}/attachments — **차례**를 소스로 지킨다 (연락서 조각 6)
 * ============================================================================
 * 이 저장소는 라우트를 직접 부르지 않는다(세션 · DB · 스트림이 필요하다). 그래서 이
 * 통로에서 **바뀌면 안 되는 차례**를 원본 글자로 본다.
 *
 * 2026-10-05 조각 6 이 이 통로에 **공유폴더 사본**을 덧붙였다. 덧붙인 것이지 끼워 넣은
 * 것이 아니라는 사실을 여기서 못 박는다:
 *  · 🔴 파일 이동(commit) → **DB(행 + 감사)** → **그 다음에** 공유폴더 — 이 차례다
 *  · 🔴 공유폴더 쪽이 무슨 일을 겪어도 **올리기는 201** 이다(그 함수에 `fail(` 이 없다)
 *  · 🔴 설정이 비면 **DB 도 디스크도 보지 않는다**
 *  · 🔴 이 통로는 공유폴더에 **폴더를 만들지 않는다 · 지우지 않는다**
 *  · 🔴 응답에 공유폴더 루트 · 절대 경로가 없다
 *
 * 꽂기 자체(덮어쓰지 않기 · NFC/NFD · 길이 상한)는 lib/storage/contact-folder-copy.test.ts 가,
 * 지우기 금지는 lib/storage/contact-folder-archive-source.test.ts 가 원본으로 본다.
 * ============================================================================
 */

const route = readFileSync(new URL("./route.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");
/** 주석을 뺀 코드 — 머리말이 까닭을 설명하느라 적은 낱말에 걸리지 않게. */
const code = route.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
/** 공유폴더 사본 함수 하나만 — 그 안의 규율이 POST 본문 때문에 흐려지지 않게. */
const copyBody = code.slice(
  code.indexOf("async function copyToContactFolder("),
  code.indexOf("export async function POST(")
);
const postBody = code.slice(code.indexOf("export async function POST("));

function exportedNames(source: string): string[] {
  return [
    ...source.matchAll(
      /^export\s+(?:async\s+)?(?:function|const|let|var|class|type|interface|enum)\s+([A-Za-z_$][\w$]*)/gm
    ),
  ]
    .map((match) => match[1])
    .sort();
}

describe("첨부 올리기 통로 — 차례를 소스로 지킨다", () => {
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

  test("🔴 차례: 파일 이동 → DB(행 + 감사) → **그 다음에** 공유폴더 사본", () => {
    const commit = postBody.indexOf("await storage.commit(");
    const record = postBody.indexOf("await createAttachmentRecord(");
    const share = postBody.indexOf("await copyToContactFolder(");
    assert.ok(commit >= 0, "파일 이동이 없다");
    assert.ok(record >= 0, "DB 기록이 없다");
    assert.ok(share >= 0, "공유폴더 사본이 없다");
    // 원래 있던 차례(4 → 5)는 그대로다.
    assert.ok(commit < record, "🔴 DB 가 파일 이동보다 앞이다");
    // 🔴 이번 조각이 더한 차례 — 뒤집으면 주인 없는 사본이 사람의 서류함에 남는다.
    assert.ok(record < share, "🔴 공유폴더 사본이 DB 보다 앞이다");
  });

  test("🔴 공유폴더 사본이 실패해도 올리기는 성공한다 — 그 자리에 `fail(` 도 `throw` 도 없다", () => {
    assert.ok(copyBody.length > 0, "공유폴더 사본 함수가 없다");
    assert.equal(/\bfail\(/.test(copyBody), false, "공유폴더 때문에 올리기를 거절한다");
    assert.equal(/\bthrow\b/.test(copyBody), false, "던지면 201 이 깨진다");
    assert.ok(copyBody.includes("} catch (error) {"), "감싸지 않았다 — 무엇이든 새어 나오면 안 된다");
    // 사본을 부른 뒤에는 거절이 없다 — 그 줄 다음은 바로 201 이다.
    const afterShare = postBody.slice(postBody.indexOf("await copyToContactFolder("));
    assert.equal(/\bfail\(/.test(afterShare), false, "사본 뒤에 거절하는 길이 생겼다");
    assert.ok(afterShare.includes("{ status: 201 }"), "201 로 끝나지 않는다");
  });

  test("🔴 설정이 비면 아무 일도 하지 않는다 — DB 도 디스크도 보지 않는다", () => {
    const guard = copyBody.indexOf("resolveContactFolderArchiveRoot() === null");
    const query = copyBody.indexOf("getRepairCaseContactFolderKeyById(");
    const read = copyBody.indexOf("storage.read(");
    assert.ok(guard >= 0, "설정 확인이 없다");
    assert.ok(guard < query, "설정을 보기 전에 DB 를 읽는다");
    assert.ok(guard < read, "설정을 보기 전에 파일을 읽는다");
    assert.ok(copyBody.slice(guard).includes("return null;"), "꺼져 있어도 무언가 한다");
  });

  test("🔴 이 통로는 공유폴더에 폴더를 만들지 않는다 · 지우지 않는다", () => {
    // 만들기(createContactFolder)는 사람이 [폴더 만들고 열기]를 누른 그때만 돈다.
    assert.equal(code.includes("createContactFolder"), false, "🔴 올리기가 폴더를 만든다");
    assert.equal(code.includes("recordContactFolderCreated"), false);
    // 공유폴더를 다루는 것은 꽂기 하나뿐이다.
    assert.deepEqual(
      [...code.matchAll(/\b(copyIntoContactFolder|findContactFolder|createContactFolder)\b/g)]
        .map((match) => match[1])
        .filter((name, index, all) => all.indexOf(name) === index),
      ["copyIntoContactFolder"]
    );
    // 공유폴더 쪽 파일시스템을 직접 부르지 않는다 — 모든 일은 storage 모듈을 거친다.
    for (const forbidden of ["node:fs", "unlink", "rmdir", "rename(", "writeFile"]) {
      assert.equal(code.includes(forbidden), false, `흔적: ${forbidden}`);
    }
  });

  test("🔴 응답에 공유폴더 루트 · 절대 경로가 없다 — 나가는 것은 파일 이름과 짧은 사유뿐", () => {
    assert.equal(code.includes("CONTACT_FOLDER_ARCHIVE_DIR"), false, "루트 설정 이름이 통로에 있다");
    assert.equal(code.includes("relativePath"), false);
    assert.equal(code.includes("uncPath"), false);
    // 사유에 fs 오류의 message 를 쓰지 않는다 — 경로가 들어 있다.
    assert.equal(/reason:\s*[A-Za-z_$][\w$]*\.message/.test(code), false, "오류 message 를 사유로 썼다");
    assert.equal(copyBody.includes("String(error)"), false);
    // 응답 칸은 상태와 파일 이름뿐이다.
    const note = route.slice(route.indexOf("type ContactFolderCopyNote ="), route.indexOf("const CONTACT_FOLDER_COPY_CASE_GONE_REASON"));
    assert.equal(/\bfolderName\b/.test(note), false, "폴더 이름까지 싣는다");
    assert.equal(/\bpath\b/i.test(note), false, "경로를 담는 칸이 있다");
  });

  test("🔴 DB 에 「어느 파일이 어느 첨부의 사본인가」를 적지 않는다", () => {
    // 공유폴더 사본 뒤에 DB 를 건드리는 길이 없다 — 그것을 적는 순간 지우기 동기화가 따라온다.
    const afterShare = postBody.slice(postBody.indexOf("await copyToContactFolder("));
    for (const forbidden of ["createAttachmentRecord", "db.", "update(", "insert("]) {
      assert.equal(afterShare.includes(forbidden), false, `사본 뒤에 DB 를 건드린다: ${forbidden}`);
    }
  });
});
