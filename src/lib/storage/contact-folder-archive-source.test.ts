import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

/**
 * ============================================================================
 * 연락서 폴더 — **지우지 않는다 · 파일을 쓰지 않는다**를 원본으로 지킨다
 * ============================================================================
 * 「지금은 안 쓴다」는 시험으로 지켜지지 않는다 — 누군가 `rm` 한 줄을 들이면 **앱이
 * 사람의 서류함에서 파일을 지운다.** 그래서 동작이 아니라 **원본 글자**를 본다.
 *
 * ── 🔴 2026-10-05(조각 5) — `mkdir` 만 금지에서 허용으로 옮겼다 ──────────
 * 이 조각이 처음으로 **폴더를 만든다**(createContactFolder). 그래서 `mkdir` 한 낱말만
 * 옮기고 **나머지 금지는 한 줄도 느슨하게 하지 않았다**: `unlink` · `rm` · `rmdir` ·
 * `rename` · `truncate` · `cp` 는 그대로 없어야 하고, 파일을 쓰는 길(`writeFile` ·
 * `appendFile` · `createWriteStream` · `"wx"`)도 그대로 없어야 한다 — 파일 쓰기는 뒤
 * 조각이다. 파일시스템을 가져오는 자리도 **`node:fs/promises` 에서 `mkdir` 하나**로
 * 못 박는다(전보다 좁다 — 이름을 적어 고정한다).
 *
 * 찾기 · 만들기 동작 자체는 contact-folder-archive.test.ts ·
 * contact-folder-create.test.ts 가, 이름 · 대조 규칙은
 * domain/contact-folder-naming.test.ts 가 본다.
 * ============================================================================
 */

const source = readFileSync(new URL("./contact-folder-archive.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");

/** 주석을 뺀 코드 — 머리말이 까닭을 설명하느라 적은 낱말(mkdir · unlink …)에 걸리지 않게. */
const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

function importedFrom(text: string): string[] {
  return [...text.matchAll(/\bfrom "([^"]+)";/g)].map((match) => match[1]).sort();
}

describe("연락서 폴더 — 원본으로 지킨다", () => {
  test("🔴 지우기 · 옮기기가 한 글자도 없다", () => {
    for (const forbidden of [/\bunlink\b/, /\brm\b/, /\brmdir\b/, /\brename\b/, /\btruncate\b/, /\bcp\b/]) {
      assert.equal(forbidden.test(code), false, `지우기 · 옮기기 흔적: ${forbidden}`);
    }
  });

  test("🔴 파일을 쓰는 길이 한 글자도 없다 — 폴더만 만든다(파일은 뒤 조각이다)", () => {
    for (const forbidden of [/\bwriteFile\b/, /\bappendFile\b/, /\bcreateWriteStream\b/, /"wx"/, /\bopen\(/]) {
      assert.equal(forbidden.test(code), false, `쓰기 흔적: ${forbidden}`);
    }
  });

  test("🔴 파일시스템에서 가져오는 것은 mkdir 하나뿐 — 읽기는 공용 도우미를 거친다", () => {
    assert.deepEqual(importedFrom(source), [
      "./share-folder-fs",
      "@/lib/domain/contact-folder-naming",
      "node:fs/promises",
      "node:path",
    ].sort());
    // 🔴 이름을 적어 못 박는다 — `node:fs/promises` 에서 더 가져오면 여기서 걸린다.
    assert.ok(code.includes('import { mkdir } from "node:fs/promises";'), "mkdir 말고 다른 것을 가져왔다");
    assert.equal(code.match(/from "node:fs\/promises"/g)?.length, 1);
    assert.equal(code.match(/\bmkdir\(/g)?.length, 1, "mkdir 을 부르는 자리는 하나뿐이다");
    // 🔴 `recursive` 없이 만든다 — 부모(= 루트)가 없으면 만들지 않고 실패해야 한다.
    assert.ok(code.includes("await mkdir(target);"), "mkdir 에 옵션이 붙었다");
    for (const forbidden of ["recursive", "require(", "import(", "child_process", "console."]) {
      assert.equal(code.includes(forbidden), false, `흔적: ${forbidden}`);
    }
    // 서버에서만 도는 모듈이다.
    assert.ok(source.startsWith('import "server-only";'), "server-only 가 맨 앞에 없다");
  });

  test("🔴 루트를 만들지 않는다 — 루트는 「이미 있어야 한다」를 거쳐서만 쓴다", () => {
    assert.ok(code.includes("await requireExistingShareFolderRoot(rawRoot)"));
    // 만들기 · 찾기 두 길이 **같은 함수**로 루트를 확인한다.
    assert.equal(code.match(/requireExistingShareFolderRoot\(/g)?.length, 2);
  });

  test("🔴 만들기 직전에 비슷한 폴더를 훑는다 — 걸리면 만들지 않는다", () => {
    const make = code.slice(code.indexOf("async function make("));
    const scan = make.indexOf("pickSimilarContactFolders(");
    const create = make.indexOf("await mkdir(");
    assert.ok(scan >= 0, "비슷한 폴더 훑기가 없다");
    assert.ok(create >= 0, "만드는 자리가 없다");
    assert.ok(scan < create, "훑기가 만들기보다 뒤에 있다");
    assert.ok(make.slice(scan, create).includes('status: "candidates"'), "훑어 놓고 만들었다");
    // 🔴 이름은 domain 이 지은 것 그대로 쓴다 — 여기서 새로 짓지 않는다.
    assert.ok(make.includes("contactFolderName(naming)"));
  });

  test("🔴 기다리는 시간에 상한이 있다 — 상한을 넘으면 사유를 돌려준다", () => {
    assert.ok(code.includes("withShareFolderTimeout("), "상한 없이 기다린다");
    assert.ok(code.includes("CONTACT_FOLDER_LOOKUP_TIMEOUT_MS"));
    assert.ok(code.includes("error instanceof ShareFolderTimeout"));
    assert.ok(code.includes("reason: CONTACT_FOLDER_SLOW_REASON"));
  });

  test("🔴 던지지 않는다 — 밖으로 나가는 것은 status 뿐이고, 사유에 경로를 담지 않는다", () => {
    // 내보내는 함수는 셋뿐이다 — 설정 읽기 · 찾기 · 만들기. 🔴 **지우기를 내보내지 않는다.**
    const exported = [...source.matchAll(/^export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm)]
      .map((match) => match[1])
      .sort();
    assert.deepEqual(exported, ["createContactFolder", "findContactFolder", "resolveContactFolderArchiveRoot"]);

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
