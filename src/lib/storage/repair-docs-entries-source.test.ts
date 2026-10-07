import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

/**
 * ============================================================================
 * 「수리 관련」 서류함 읽기 — 지우지 않는다 · 만들지 않는다 · 내용을 안 읽는다
 * ============================================================================
 * 이웃 contact-folder-entries-source.test.ts · quote-archive-case-numbers-source.test.ts
 * 와 같은 규율이다. 「지금은 안 쓴다」는 시험으로 지켜지지 않는다 — 뒤 조각에서
 * 누군가 지우는 한 줄을 들이면 **앱이 사람의 서류함에서 파일을 지운다.** 그래서
 * 동작이 아니라 **원본 글자**를 본다.
 *
 * 이 모듈만의 것이 둘 더 있다:
 *  · 🔴 **루트가 곧 시작점이다** — 연락서처럼 폴더를 찾는 단계가 없고, 그래서
 *    `folderName` 칸도 없다. 그 사실이 타입에서 사라지지 않게 본다.
 *  · 🔴 **환경변수를 읽지 않는다** — 꺼져 있는지 판단은 부르는 쪽(통로 · 서버 액션)이
 *    한다. 여기까지 내려오면 「꺼짐」이 두 군데가 된다.
 *
 * 읽는 동작 자체는 repair-docs-entries.test.ts 가 임시 폴더에서 본다.
 * ============================================================================
 */

const source = readFileSync(new URL("./repair-docs-entries.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");

/** 주석을 뺀 코드 — 머리말이 까닭을 설명하느라 적은 낱말에 걸리지 않게. */
const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

function importedFrom(text: string): string[] {
  return [...text.matchAll(/\bfrom "([^"]+)";/g)].map((match) => match[1]).sort();
}

describe("수리 서류함 읽기 — 원본으로 지킨다", () => {
  test("🔴 지우기 · 옮기기 · 만들기 · 쓰기가 한 글자도 없다", () => {
    for (const forbidden of [
      /\bunlink\b/,
      /\brm\b/,
      /\brmdir\b/,
      /\brename\b/,
      /\btruncate\b/,
      /\bcp\b/,
      /\bmkdir\b/,
      /\bwriteFile\b/,
      /\bappendFile\b/,
      /\bcreateWriteStream\b/,
      /\bchmod\b/,
      /\butimes\b/,
      /"wx"/,
    ]) {
      assert.equal(forbidden.test(code), false, `쓰기 · 지우기 흔적: ${forbidden}`);
    }
  });

  test("🔴 파일 **내용**을 읽지 않는다 — 이름 · 크기 · 수정 시각뿐이다", () => {
    for (const forbidden of [/\breadFile\b/, /\bcreateReadStream\b/, /\bBlob\b/, /\bBuffer\b/, /\bArrayBuffer\b/]) {
      assert.equal(forbidden.test(code), false, `내용을 읽는 흔적: ${forbidden}`);
    }
  });

  test("🔴 파일시스템을 직접 가져오지 않는다 — 읽기는 공용 도우미 하나를 거친다", () => {
    assert.deepEqual(importedFrom(source), ["./share-folder-fs", "@/lib/domain/share-folder-naming", "node:path"].sort());
    for (const forbidden of ["node:fs", "fs/promises", "require(", "import(", "child_process", "console."]) {
      assert.equal(code.includes(forbidden), false, `흔적: ${forbidden}`);
    }
    // 읽는 길은 공용 도우미의 두 함수뿐이다 — readdir · stat 을 다시 짜지 않는다.
    assert.equal(/\breaddir\s*\(/.test(code), false, "폴더 읽기를 다시 짰다");
    assert.ok(code.includes("listShareFolderDirents("));
    assert.ok(code.includes("statShareFolderEntry("));
    // 서버에서만 도는 모듈이다.
    assert.ok(source.startsWith('import "server-only";'), "server-only 가 맨 앞에 없다");
  });

  test("🔴 설정도 DB 도 모른다 — 루트는 **받는다**", () => {
    for (const forbidden of [
      "process.env",
      "REPAIR_DOCS_ARCHIVE_DIR",
      "REPAIR_DOCS_ARCHIVE_UNC_ROOT",
      "resolveRepairDocsArchiveRoot",
      "drizzle",
      "db/client",
      "queries/",
      '"react"',
      "cache(",
    ]) {
      assert.equal(code.includes(forbidden), false, `부르는 쪽이 할 일이 내려왔다: ${forbidden}`);
    }
    // 두 창구 모두 루트를 인자로 받는다.
    assert.equal(code.match(/root: string;/g)?.length, 2, "루트를 받는 칸이 둘이 아니다");
  });

  test("🔴 연락서와 달리 **폴더를 찾는 단계가 없다** — 루트가 곧 시작점이다", () => {
    for (const forbidden of ["folderName", "findShareFolder", "intakeNumber", "listShareFolderNames"]) {
      assert.equal(code.includes(forbidden), false, `찾기 단계가 들어왔다: ${forbidden}`);
    }
    // 걷기는 루트에서 시작한다.
    assert.ok(code.includes("let folder = root;"), "루트에서 걷기 시작하지 않는다");
  });

  test("🔴 상한 셋을 들고 있다 — 기다리기 · 줄 수 · 깊이", () => {
    assert.ok(code.includes("export const REPAIR_DOCS_ENTRIES_TIMEOUT_MS = 3000;"));
    assert.ok(code.includes("export const REPAIR_DOCS_ENTRIES_LIMIT = 200;"));
    assert.ok(code.includes("export const REPAIR_DOCS_ENTRIES_MAX_DEPTH = 6;"));
    // 상한 없이 기다리는 길이 없다 — 두 창구가 같은 문 하나(guard)를 지난다.
    assert.equal(code.match(/withShareFolderTimeout\(/g)?.length, 1, "상한을 씌우는 자리가 하나가 아니다");
    assert.equal(code.match(/\bguard\(/g)?.length, 2, "상한을 안 거치는 창구가 있다");
    assert.ok(code.includes("error instanceof ShareFolderTimeout"));
  });

  test("🔴 한 칸씩만 내려간다 — 재귀가 아니고, 바퀴마다 울타리를 본다", () => {
    // recursive readdir 로 통째로 끌어오는 길이 없다.
    assert.equal(code.includes("recursive"), false, "재귀로 읽는다");
    assert.ok(code.includes("assertInsideShareFolderRoot(root, folder, OUTSIDE_ROOT_REASON);"));
    // 들어가는 길은 **보이는 폴더 줄** 하나뿐이다.
    assert.ok(code.includes("visible.some((dirent) => dirent.isDirectory && dirent.name === next)"));
    // 걷는 함수가 하나다 — 목록과 확인이 서로 다른 규칙으로 걸으면 울타리가 갈라진다.
    assert.equal(code.match(/async function openFolder\(/g)?.length, 1);
    assert.equal(code.match(/openFolder\(/g)?.length, 3, "openFolder 를 안 거치고 걷는 길이 있다");
  });

  test("🔴 stat 은 **남긴 줄에만** 때린다 — 상한이 곧 NAS 왕복 횟수다", () => {
    const readAt = code.indexOf("async function read(");
    assert.ok(readAt >= 0);
    const sliceAt = code.indexOf(".slice(0, limit)", readAt);
    const statAt = code.indexOf("statShareFolderEntry(", readAt);
    assert.ok(sliceAt >= 0 && statAt > sliceAt, "자르기 전에 stat 을 때린다");
    // 한 줄 확인(find)은 stat 을 아예 안 때린다.
    const findAt = code.indexOf("async function find(");
    assert.ok(findAt > 0);
    assert.equal(code.slice(findAt).includes("statShareFolderEntry("), false, "한 줄 확인이 stat 을 때린다");
  });

  test("🔴 던지지 않는다 — 밖으로 나가는 것은 status 뿐이고, 사유에 경로를 담지 않는다", () => {
    assert.ok(code.includes('status: "failed"'));
    // fs 오류의 message 를 사유로 쓰지 않는다 — 경로가 들어 있다.
    assert.equal(/reason:\s*[A-Za-z_$][\w$]*\.message/.test(code), false, "오류 message 를 사유로 썼다");
    assert.equal(code.includes("String(error)"), false);
    // 밖으로 내보내는 함수는 둘이고, 둘 다 status 로 끝난다.
    const exported = [...source.matchAll(/^export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm)]
      .map((match) => match[1])
      .sort();
    assert.deepEqual(exported, ["compareRepairDocsEntries", "findRepairDocsEntry", "listRepairDocsEntries"]);
  });

  test("🔴 줄 타입에 경로를 담는 칸이 없다 — 이름 하나뿐이다", () => {
    const entryType = source.slice(
      source.indexOf("export type RepairDocsEntry = {"),
      source.indexOf("export type RepairDocsEntriesResult")
    );
    const fields = [...entryType.matchAll(/^\s*(\w+)\??:/gm)].map((match) => match[1]).sort();
    assert.deepEqual(fields, ["isDirectory", "modifiedAtMs", "name", "sizeBytes"]);
    for (const forbidden of ["root", "absolute", "fullpath", "uncpath", "dir:", "relativepath"]) {
      assert.equal(entryType.toLowerCase().includes(forbidden), false, `${forbidden} 가 줄 타입에 있다`);
    }
  });

  test("🔴 사유 글귀에 경로 구분자가 없다", () => {
    for (const match of source.matchAll(/_REASON =\s*\n?\s*"([^"]*)"/g)) {
      assert.equal(/[\\/]/.test(match[1]), false, `사유에 경로 구분자가 있다: ${match[1]}`);
    }
  });
});
