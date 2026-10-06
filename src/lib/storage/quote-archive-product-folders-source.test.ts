import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

/**
 * ============================================================================
 * 지난 견적서 **찾기** — 지우지 않는다 · 만들지 않는다 · 내용을 내보내지 않는다 (2026-10-06)
 * ============================================================================
 * 이웃 quote-archive-entries-source.test.ts 와 같은 규율이다. 「지금은 안 쓴다」는 시험으로
 * 지켜지지 않는다 — 뒤 조각에서 누군가 지우는 한 줄을 들이면 **앱이 사람의 서류함에서 파일을
 * 지운다.** 그래서 동작이 아니라 **원본 글자**를 본다.
 *
 * 여기에 이 모듈만의 것이 둘 더 있다:
 *  · 🔴 **연도 폴더 판정을 새로 쓰지 않는다.** 규칙이 두 벌이 되면 한쪽만 고쳐져 어떤 해의
 *    폴더만 조용히 안 보이게 된다.
 *  · 🔴 **열쇠가 비면 디스크를 보기 전에 끝난다.** 빈 열쇠로 훑으면 공유폴더의 견적서 폴더가
 *    전부 걸려 남의 장비 견적서를 통째로 보여 준다.
 *
 * 찾기 동작 자체는 quote-archive-product-folders.test.ts 가 임시 폴더에서 본다.
 * ============================================================================
 */

const source = readFileSync(new URL("./quote-archive-product-folders.ts", import.meta.url), "utf8").replace(
  /\r\n/g,
  "\n"
);

/** 주석을 뺀 코드 — 머리말이 까닭을 설명하느라 적은 낱말에 걸리지 않게. */
const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

function importedFrom(text: string): string[] {
  return [...text.matchAll(/\bfrom "([^"]+)";/g)].map((match) => match[1]).sort();
}

describe("지난 견적서 찾기 — 원본으로 지킨다", () => {
  test("🔴 지우기 · 옮기기가 한 글자도 없다", () => {
    for (const forbidden of [/\bunlink\b/, /\brm\b/, /\brmdir\b/, /\brename\b/, /\btruncate\b/, /\bcp\b/]) {
      assert.equal(forbidden.test(code), false, `지우기 · 옮기기 흔적: ${forbidden}`);
    }
  });

  test("🔴 만들기 · 쓰기가 한 글자도 없다", () => {
    for (const forbidden of [/\bmkdir\b/, /\bwriteFile\b/, /\bappendFile\b/, /\bcreateWriteStream\b/, /"wx"/]) {
      assert.equal(forbidden.test(code), false, `쓰기 흔적: ${forbidden}`);
    }
    // 저장 · 폴더 만들기 쪽 이름을 가져오지 않는다(같은 모듈에 들어 있다).
    for (const forbidden of ["saveToQuoteArchive", "createQuoteArchiveFolder"]) {
      assert.equal(code.includes(forbidden), false, `쓰기 쪽 이름을 가져왔다: ${forbidden}`);
    }
  });

  test("🔴 파일 **내용**을 읽지 않는다 — 이름만 본다", () => {
    for (const forbidden of [/\breadFile\b/, /\bcreateReadStream\b/, /\bopen\b\s*\(/, /\bBlob\b/, /\bBuffer\b/]) {
      assert.equal(forbidden.test(code), false, `내용을 읽는 흔적: ${forbidden}`);
    }
    // 크기 · 수정 시각도 재지 않는다 — 폴더 수만큼 NAS 왕복이 늘어난다.
    assert.equal(code.includes("statShareFolderEntry"), false, "줄마다 stat 을 때린다");
  });

  test("🔴 파일시스템을 직접 가져오지 않는다 — 읽기는 공용 도우미 하나를 거친다", () => {
    assert.deepEqual(
      importedFrom(source),
      [
        "./quote-archive",
        "./share-folder-fs",
        "@/lib/domain/quote-archive-file-number",
        "@/lib/domain/quote-archive-naming",
        "@/lib/domain/share-folder-naming",
        "node:path",
      ].sort()
    );
    for (const forbidden of ["node:fs", "fs/promises", "require(", "import(", "child_process", "console."]) {
      assert.equal(code.includes(forbidden), false, `흔적: ${forbidden}`);
    }
    // 서버에서만 도는 모듈이다.
    assert.ok(source.startsWith('import "server-only";'), "server-only 가 맨 앞에 없다");
  });

  test("🔴 연도 폴더 판정을 새로 쓰지 않는다 — 이미 있는 함수를 그대로 쓴다", () => {
    assert.ok(code.includes("isQuoteArchiveYearFolder("), "연도 폴더 판정을 부르지 않는다");
    // 연도 폴더 이름 규칙(라벨 · 앞 번호 · 연도 범위)을 여기에 두 벌째 적지 않는다.
    for (const forbidden of ["내자견적서", "YEAR_FOLDER", "2006", "2104"]) {
      assert.equal(code.includes(forbidden), false, `연도 폴더 규칙을 베꼈다: ${forbidden}`);
    }
    // 폴더를 고르는 일도 공용 도우미 하나를 거친다.
    assert.equal(code.includes("readdir("), false, "폴더 읽기를 다시 짰다");
    assert.equal(code.match(/listShareFolderNames\(/g)?.length, 2, "연도 폴더 · 견적서 폴더 두 번이 아니다");
    assert.equal(code.match(/listShareFolderDirents\(/g)?.length, 1);
  });

  test("🔴 거르는 규칙을 새로 쓰지 않는다 — 폴더를 찾는 쪽과 같은 함수다", () => {
    assert.ok(code.includes("matchesQuoteArchiveFolder("), "이 건의 폴더를 거르는 판정이 없다");
    // 번호를 제 손으로 쪼개지 않는다(본 번호를 뽑는 규칙은 한 자리에만 있다).
    assert.equal(code.includes("quoteArchiveBaseNumber"), false, "번호 규칙을 베꼈다");
    // 파일 이름에서 번호를 뽑는 일도 순수 함수 하나에 있다.
    assert.ok(code.includes("quoteNumbersFromArchiveFileNames("));
    assert.equal(/\bDSS\b/.test(code), false, "번호 모양을 이 파일이 다시 짰다");
  });

  test("🔴 L/N · S/N 이 비면 디스크를 보기 **전에** 끝난다 — 설정이 없을 때도 같다", () => {
    const keysAt = code.indexOf("if (!isUsableKey(lotKey) || !isUsableKey(serialKey))");
    const disabledAt = code.indexOf('return { status: "disabled" };');
    assert.ok(keysAt >= 0, "열쇠를 보지 않는다");
    assert.ok(disabledAt >= 0, "disabled 가 없다");
    for (const diskMark of ["withShareFolderTimeout(", "requireExistingShareFolderRoot("]) {
      assert.ok(keysAt < code.indexOf(diskMark), `디스크를 본 뒤에 열쇠를 본다: ${diskMark}`);
      assert.ok(disabledAt < code.indexOf(diskMark), `디스크를 본 뒤에 꺼짐을 본다: ${diskMark}`);
    }
    // 설정을 읽는 길은 공용 함수 하나다 — 환경변수를 직접 만지지 않는다.
    assert.equal(code.includes("process.env"), false);
    assert.equal(code.includes("QUOTE_ARCHIVE_DIR"), false);
    assert.equal(code.match(/resolveQuoteArchiveRoot\(\)/g)?.length, 1);
  });

  test("🔴 둘 다 맞아야 한다 — 한쪽만 맞으면 걸리지 않는다(코드 모양으로도)", () => {
    assert.ok(code.includes("keys.has(lotKey) && keys.has(serialKey)"), "한쪽만 맞아도 걸린다");
  });

  test("🔴 기다리는 시간과 폴더 수에 상한이 있다", () => {
    assert.ok(code.includes("withShareFolderTimeout("), "상한 없이 기다린다");
    assert.ok(code.includes("QUOTE_ARCHIVE_PRODUCT_FOLDERS_TIMEOUT_MS"));
    assert.ok(code.includes("error instanceof ShareFolderTimeout"));
    assert.ok(code.includes("reason: QUOTE_ARCHIVE_PRODUCT_FOLDERS_SLOW_REASON"));
    assert.ok(code.includes("QUOTE_ARCHIVE_PRODUCT_FOLDERS_LIMIT"), "폴더 수 상한이 없다");
    assert.ok(code.includes("folders.length >= limit"), "상한대로 끊지 않는다");
    // 🔴 상한에 걸리면 그 폴더 안을 **읽기 전에** 끝낸다 — 상한이 곧 NAS 왕복 횟수다.
    assert.ok(code.indexOf("folders.length >= limit") < code.indexOf("readNumbers("), "끊기보다 읽기가 앞에 있다");
  });

  test("🔴 던지지 않는다 — 밖으로 나가는 것은 status 뿐이고, 사유에 경로를 담지 않는다", () => {
    const exported = [...source.matchAll(/^export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm)]
      .map((match) => match[1])
      .sort();
    assert.deepEqual(exported, ["listQuoteArchiveProductFolders"]);
    assert.ok(code.includes('status: "failed"'));
    // fs 오류의 message 를 사유로 쓰지 않는다 — 경로가 들어 있다.
    assert.equal(/reason:\s*[A-Za-z_$][\w$]*\.message/.test(code), false, "오류 message 를 사유로 썼다");
    assert.equal(code.includes("String(error)"), false);
  });

  test("🔴 줄 타입에 컨테이너 안 경로를 담는 칸이 없다 — 상대 경로 하나뿐이다", () => {
    const folderType = source.slice(
      source.indexOf("export type QuoteArchiveProductFolder = {"),
      source.indexOf("export type QuoteArchiveProductFoldersResult")
    );
    assert.ok(folderType.includes("relativePath: string;"), folderType);
    const fields = [...folderType.matchAll(/^\s*(\w+)\??:/gm)].map((match) => match[1]).sort();
    assert.deepEqual(fields, [
      "fileCount",
      "folderName",
      "quoteNumbers",
      "relativePath",
      "year",
      "yearFolderName",
    ]);
    for (const forbidden of ["root", "absolute", "fullpath", "uncpath", "dir:"]) {
      assert.equal(folderType.toLowerCase().includes(forbidden), false, `${forbidden} 가 줄 타입에 있다`);
    }
  });
});
