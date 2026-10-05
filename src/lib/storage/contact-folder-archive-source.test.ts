import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

/**
 * ============================================================================
 * 연락서 폴더 찾기 — **지우지 않는다 · 만들지 않는다**를 원본으로 지킨다
 * ============================================================================
 * 이 모듈이 하는 일은 찾기뿐이다. 「지금은 안 쓴다」는 시험으로 지켜지지 않는다 —
 * 뒤 조각에서 누군가 `rm` 한 줄을 들이면 **앱이 사람의 서류함에서 파일을 지운다.**
 * 그래서 동작이 아니라 **원본 글자**를 본다.
 *
 * 찾기 동작 자체는 contact-folder-archive.test.ts 가, 이름 · 대조 규칙은
 * domain/contact-folder-naming.test.ts 가 본다.
 * ============================================================================
 */

const source = readFileSync(new URL("./contact-folder-archive.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");

/** 주석을 뺀 코드 — 머리말이 까닭을 설명하느라 적은 낱말(mkdir · unlink …)에 걸리지 않게. */
const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

function importedFrom(text: string): string[] {
  return [...text.matchAll(/\bfrom "([^"]+)";/g)].map((match) => match[1]).sort();
}

describe("연락서 폴더 찾기 — 원본으로 지킨다", () => {
  test("🔴 지우기 · 옮기기가 한 글자도 없다", () => {
    for (const forbidden of [/\bunlink\b/, /\brm\b/, /\brmdir\b/, /\brename\b/, /\btruncate\b/, /\bcp\b/]) {
      assert.equal(forbidden.test(code), false, `지우기 · 옮기기 흔적: ${forbidden}`);
    }
  });

  test("🔴 만들기 · 쓰기가 한 글자도 없다 — 폴더 만들기는 뒤 조각이다", () => {
    for (const forbidden of [/\bmkdir\b/, /\bwriteFile\b/, /\bappendFile\b/, /\bcreateWriteStream\b/, /"wx"/]) {
      assert.equal(forbidden.test(code), false, `쓰기 흔적: ${forbidden}`);
    }
  });

  test("🔴 파일시스템을 직접 가져오지 않는다 — 읽기는 공용 도우미 하나를 거친다", () => {
    assert.deepEqual(importedFrom(source), [
      "./share-folder-fs",
      "@/lib/domain/contact-folder-naming",
      "node:path",
    ].sort());
    for (const forbidden of ["node:fs", "fs/promises", "require(", "import(", "child_process", "console."]) {
      assert.equal(code.includes(forbidden), false, `흔적: ${forbidden}`);
    }
    // 서버에서만 도는 모듈이다.
    assert.ok(source.startsWith('import "server-only";'), "server-only 가 맨 앞에 없다");
  });

  test("🔴 기다리는 시간에 상한이 있다 — 상한을 넘으면 사유를 돌려준다", () => {
    assert.ok(code.includes("withShareFolderTimeout("), "상한 없이 기다린다");
    assert.ok(code.includes("CONTACT_FOLDER_LOOKUP_TIMEOUT_MS"));
    assert.ok(code.includes("error instanceof ShareFolderTimeout"));
    assert.ok(code.includes("reason: CONTACT_FOLDER_SLOW_REASON"));
  });

  test("🔴 던지지 않는다 — 밖으로 나가는 것은 status 뿐이고, 사유에 경로를 담지 않는다", () => {
    // 내보내는 함수는 찾기 둘뿐이다(만들기 · 지우기를 내보내지 않는다).
    const exported = [...source.matchAll(/^export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm)]
      .map((match) => match[1])
      .sort();
    assert.deepEqual(exported, ["findContactFolder", "resolveContactFolderArchiveRoot"]);

    // 네 가지 상태가 모두 있다.
    for (const status of ['status: "disabled"', 'status: "failed"']) {
      assert.ok(code.includes(status), status);
    }
    // fs 오류의 message 를 사유로 쓰지 않는다 — 경로가 들어 있다.
    assert.equal(/reason:\s*[A-Za-z_$][\w$]*\.message/.test(code), false, "오류 message 를 사유로 썼다");
    assert.equal(code.includes("String(error)"), false);
  });

  test("🔴 루트 값(.env)을 로그 · 결과에 싣지 않는다", () => {
    // 환경변수를 읽는 자리는 resolveContactFolderArchiveRoot 한 곳뿐이다.
    assert.equal(code.match(/process\.env/g)?.length, 1);
    assert.equal(code.match(/CONTACT_FOLDER_ARCHIVE_DIR/g)?.length, 1);
  });
});
