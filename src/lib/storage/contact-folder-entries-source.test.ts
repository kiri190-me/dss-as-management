import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

/**
 * ============================================================================
 * 연락서 폴더 **읽기** — 지우지 않는다 · 만들지 않는다 · 내용을 내보내지 않는다
 * ============================================================================
 * 조각 1 의 contact-folder-archive-source.test.ts 와 같은 규율이다. 「지금은 안 쓴다」는
 * 시험으로 지켜지지 않는다 — 뒤 조각에서 누군가 `rm` 한 줄을 들이면 **앱이 사람의
 * 서류함에서 파일을 지운다.** 그래서 동작이 아니라 **원본 글자**를 본다.
 *
 * 여기에 한 가지가 더 있다: 🔴 **파일 내용을 읽지 않는다.** 공유폴더의 파일은 첨부
 * 통로의 권한 · 확장자 검사 · 앞머리 바이트 대조 밖에 있어, 우리 출처로 내보내면 그
 * 방어선이 통째로 빠진다. `readFile` · 스트림이 이 모듈에 들어올 길을 막아 둔다.
 *
 * 읽기 동작 자체는 contact-folder-entries.test.ts 가 임시 폴더에서 본다.
 * ============================================================================
 */

const source = readFileSync(new URL("./contact-folder-entries.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");

/** 주석을 뺀 코드 — 머리말이 까닭을 설명하느라 적은 낱말(mkdir · readFile …)에 걸리지 않게. */
const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

function importedFrom(text: string): string[] {
  return [...text.matchAll(/\bfrom "([^"]+)";/g)].map((match) => match[1]).sort();
}

describe("연락서 폴더 읽기 — 원본으로 지킨다", () => {
  test("🔴 지우기 · 옮기기가 한 글자도 없다", () => {
    for (const forbidden of [/\bunlink\b/, /\brm\b/, /\brmdir\b/, /\brename\b/, /\btruncate\b/, /\bcp\b/]) {
      assert.equal(forbidden.test(code), false, `지우기 · 옮기기 흔적: ${forbidden}`);
    }
  });

  test("🔴 만들기 · 쓰기가 한 글자도 없다", () => {
    for (const forbidden of [/\bmkdir\b/, /\bwriteFile\b/, /\bappendFile\b/, /\bcreateWriteStream\b/, /"wx"/]) {
      assert.equal(forbidden.test(code), false, `쓰기 흔적: ${forbidden}`);
    }
  });

  test("🔴 파일 **내용**을 읽지 않는다 — 목록만 낸다", () => {
    for (const forbidden of [/\breadFile\b/, /\bcreateReadStream\b/, /\bopen\b\s*\(/, /\bBlob\b/, /\bBuffer\b/]) {
      assert.equal(forbidden.test(code), false, `내용을 읽는 흔적: ${forbidden}`);
    }
  });

  test("🔴 파일시스템을 직접 가져오지 않는다 — 읽기는 공용 도우미 하나를 거친다", () => {
    assert.deepEqual(
      importedFrom(source),
      ["./share-folder-fs", "@/lib/domain/share-folder-naming", "node:path"].sort()
    );
    for (const forbidden of ["node:fs", "fs/promises", "require(", "import(", "child_process", "console."]) {
      assert.equal(code.includes(forbidden), false, `흔적: ${forbidden}`);
    }
    // 서버에서만 도는 모듈이다.
    assert.ok(source.startsWith('import "server-only";'), "server-only 가 맨 앞에 없다");
  });

  /**
   * 🔴 2026-10-05(조각 10) — 제목에서 「하위 폴더로 내려가지 않는다」를 **「한 번에 한 칸만」**
   * 으로 고쳤다. 사람이 폴더 줄을 누르면 그 자리를 읽을 수 있게 됐기 때문이다. 🔴 **금지는
   * 한 줄도 느슨해지지 않았다** — 재귀가 없고(받은 마디 수만큼만 도는 걸음이다), 읽는 길은
   * 공용 도우미의 「맨 위 칸」 **하나**뿐이다. 그 둘이 곧 「한 화면에 폴더 전부가 쏟아지지
   * 않는다」를 지킨다.
   */
  test("🔴 한 번에 한 칸만 읽는다 — 재귀가 없고, 읽는 길이 하나다", () => {
    for (const forbidden of [/recursive/, /\bwalk\b/, /function\s+\w*[Rr]ecurse/]) {
      assert.equal(forbidden.test(code), false, `재귀 흔적: ${forbidden}`);
    }
    // 읽는 길은 공용 도우미의 「맨 위 칸」 하나뿐이다.
    assert.equal(code.match(/listShareFolderDirents\(/g)?.length, 1);
    // 🔴 내려가는 길은 **그 자리에 보이는 폴더 줄**뿐이다(바로가기는 폴더로 치지 않는다).
    assert.ok(code.includes("dirent.isDirectory && dirent.name === next"), "아무 마디나 이어 붙인다");
    // 🔴 깊이 상한이 있고, 그것을 넘으면 디스크를 보지 않는다.
    assert.ok(code.includes("CONTACT_FOLDER_ENTRIES_MAX_DEPTH"), "깊이 상한이 없다");
    assert.ok(
      code.indexOf("CONTACT_FOLDER_ENTRIES_MAX_DEPTH") < code.indexOf("requireExistingShareFolderRoot("),
      "깊이를 보기 전에 디스크를 본다"
    );
  });

  test("🔴 기다리는 시간과 줄 수에 상한이 있다", () => {
    assert.ok(code.includes("withShareFolderTimeout("), "상한 없이 기다린다");
    assert.ok(code.includes("CONTACT_FOLDER_ENTRIES_TIMEOUT_MS"));
    assert.ok(code.includes("error instanceof ShareFolderTimeout"));
    assert.ok(code.includes("reason: CONTACT_FOLDER_ENTRIES_SLOW_REASON"));
    assert.ok(code.includes("CONTACT_FOLDER_ENTRIES_LIMIT"), "줄 수 상한이 없다");
    assert.ok(code.includes(".slice(0, limit)"), "상한대로 자르지 않는다");
    // 🔴 stat 은 **자른 뒤**에만 때린다 — 상한이 곧 NAS 왕복 횟수다.
    assert.ok(
      code.indexOf(".slice(0, limit)") < code.indexOf("statShareFolderEntry("),
      "자르기보다 stat 이 앞에 있다"
    );
  });

  test("🔴 던지지 않는다 — 밖으로 나가는 것은 status 뿐이고, 사유에 경로를 담지 않는다", () => {
    const exported = [...source.matchAll(/^export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm)]
      .map((match) => match[1])
      .sort();
    assert.deepEqual(exported, [
      "compareContactFolderEntries",
      "isIgnoredContactFolderEntryName",
      "listContactFolderEntries",
    ]);
    assert.ok(code.includes('status: "failed"'));
    // fs 오류의 message 를 사유로 쓰지 않는다 — 경로가 들어 있다.
    assert.equal(/reason:\s*[A-Za-z_$][\w$]*\.message/.test(code), false, "오류 message 를 사유로 썼다");
    assert.equal(code.includes("String(error)"), false);
  });

  test("🔴 돌려주는 값에 경로를 담는 칸이 없다 — 이름은 폴더 안에서의 이름뿐이다", () => {
    const entryType = source.slice(
      source.indexOf("export type ContactFolderEntry = {"),
      source.indexOf("export type ContactFolderEntriesResult")
    );
    assert.ok(entryType.includes("name: string;"), entryType);
    const fields = [...entryType.matchAll(/^\s*(\w+)\??:/gm)].map((match) => match[1]).sort();
    assert.deepEqual(fields, ["isDirectory", "modifiedAtMs", "name", "sizeBytes"]);
    for (const forbidden of ["path", "root", "absolute", "fullname", "dir:"]) {
      assert.equal(entryType.toLowerCase().includes(forbidden), false, `${forbidden} 가 줄 타입에 있다`);
    }
  });

  test("🔴 환경변수를 읽지 않는다 — 루트는 부르는 쪽이 준다", () => {
    assert.equal(code.includes("process.env"), false);
    assert.equal(code.includes("CONTACT_FOLDER_ARCHIVE_DIR"), false);
  });
});
