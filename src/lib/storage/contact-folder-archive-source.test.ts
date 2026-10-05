import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

/**
 * ============================================================================
 * 연락서 폴더 — **지우지 않는다 · 덮어쓰지 않는다**를 원본으로 지킨다
 * ============================================================================
 * 「지금은 안 쓴다」는 시험으로 지켜지지 않는다 — 누군가 `rm` 한 줄을 들이면 **앱이
 * 사람의 서류함에서 파일을 지운다.** 그래서 동작이 아니라 **원본 글자**를 본다.
 *
 * ── 🔴 2026-10-05(조각 5) — `mkdir` 만 금지에서 허용으로 옮겼다 ──────────
 * 그 조각이 처음으로 **폴더를 만들었다**(createContactFolder).
 *
 * ── 🔴 2026-10-05(조각 6) — **파일 쓰기**를 열었다 ──────────────────────
 * 이 조각이 처음으로 연락서 폴더에 **파일을 꽂는다**(copyIntoContactFolder). 그래서
 * `writeFile` · `"wx"` · `open(` 금지를 풀었다. 대신 **무엇을 열었는지 이름으로 못 박는다**:
 *  · 파일시스템에서 가져오는 것은 `mkdir` · `open` · `readdir` · `readFile` · `stat`
 *    **다섯뿐**이고 하나씩 까닭이 있다(모듈 머리말).
 *  · 🔴 여는 방식은 **`"wx"` 하나**다 — 덮어쓰는 길(`"w"` · `"a"` · `"r+"`)이 없다.
 *  · 🔴 **지우기 · 옮기기 금지는 한 글자도 느슨하게 하지 않았다** — `unlink` · `rm` ·
 *    `rmdir` · `rename` · `truncate` · `cp` 는 그대로 없어야 한다. 쓰다 실패한 조각을
 *    치우는 길도 들이지 않는다(머리말의 「대가」).
 *  · 🔴 사본 꽂기 쪽에는 **`mkdir` 이 없다** — 이 길은 이미 있는 폴더에만 꽂는다.
 *
 * 찾기 · 만들기 · 꽂기 동작 자체는 contact-folder-archive.test.ts ·
 * contact-folder-create.test.ts · contact-folder-copy.test.ts 가, 이름 · 대조 규칙은
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

  test("🔴 덮어쓰는 길이 없다 — 파일은 `wx` 로만 연다 (조각 6)", () => {
    // 여는 자리는 하나뿐이고 그 하나가 `wx` 다. 존재 확인과 쓰기 사이에 틈이 없다.
    assert.equal(code.match(/\bopen\(/g)?.length, 1, "파일을 여는 자리가 하나가 아니다");
    assert.ok(code.includes('await open(target, "wx");'), "`wx` 말고 다른 방식으로 열었다");
    // 🔴 덮어쓰는 플래그는 한 글자도 없다.
    for (const forbidden of ['"w"', '"a"', '"r+"', '"w+"', '"a+"', /\bappendFile\b/, /\bcreateWriteStream\b/]) {
      const test = typeof forbidden === "string" ? code.includes(forbidden) : forbidden.test(code);
      assert.equal(test, false, `덮어쓰기 흔적: ${forbidden}`);
    }
    // 🔴 파일을 쓰는 것은 **연 손잡이**를 통해서다 — fs 의 writeFile 을 직접 부르지 않는다
    //    (아래 가져오기 고정이 그것을 함께 막는다).
    assert.ok(code.includes("await handle.writeFile(bytes);"), "쓰는 자리가 사라졌다");
    assert.equal(/\bawait writeFile\(/.test(code), false, "fs 의 writeFile 을 직접 불렀다");
  });

  test("🔴 사본을 꽂는 길은 폴더를 만들지 않는다 — 이미 있는 폴더에만 꽂는다 (조각 6)", () => {
    const copy = code.slice(code.indexOf("export async function copyIntoContactFolder("), code.indexOf("async function look("));
    assert.ok(copy.length > 0, "사본 꽂기가 없다");
    assert.equal(/\bmkdir\b/.test(copy), false, "🔴 꽂는 길에서 폴더를 만들었다");
    assert.ok(copy.includes('status: "no-folder"'), "폴더가 없을 때 건너뛰지 않는다");
    // 🔴 NFC/NFD — 쓰기 전에 디스크의 이름을 접어서 견준다(`wx` 만으로는 못 막는다).
    assert.ok(copy.includes("normalizeShareFolderNameForCompare("), "정규화해 견주지 않는다");
  });

  test("🔴 파일시스템에서 가져오는 것은 다섯뿐 — 폴더 읽기는 공용 도우미를 거친다", () => {
    assert.deepEqual(importedFrom(source), [
      "./share-folder-fs",
      "@/lib/domain/contact-folder-naming",
      "@/lib/domain/share-folder-naming",
      "node:fs/promises",
      "node:path",
    ].sort());
    // 🔴 이름을 적어 못 박는다 — `node:fs/promises` 에서 더 가져오면 여기서 걸린다.
    //    `unlink` · `rename` 을 들이려면 **이 줄부터** 고쳐야 한다.
    assert.ok(
      code.includes('import { mkdir, open, readdir, readFile, stat } from "node:fs/promises";'),
      "가져오는 목록이 바뀌었다"
    );
    assert.equal(code.match(/from "node:fs\/promises"/g)?.length, 1);
    assert.equal(code.match(/\bmkdir\(/g)?.length, 1, "mkdir 을 부르는 자리는 하나뿐이다");
    // 🔴 `recursive` 없이 만든다 — 부모(= 루트)가 없으면 만들지 않고 실패해야 한다.
    //    `readdir` 도 마찬가지로 하위 폴더를 끌어오지 않는다.
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
    // 내보내는 함수는 넷뿐이다 — 설정 읽기 · 찾기 · 만들기 · 꽂기.
    // 🔴 **지우기 · 이름 바꾸기를 내보내지 않는다.**
    const exported = [...source.matchAll(/^export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm)]
      .map((match) => match[1])
      .sort();
    assert.deepEqual(exported, [
      "copyIntoContactFolder",
      "createContactFolder",
      "findContactFolder",
      "resolveContactFolderArchiveRoot",
    ]);

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
