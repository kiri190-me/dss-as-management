import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

/**
 * ============================================================================
 * 고객 안내 현황의 견적서 번호 읽기 — 지우지 않는다 · 만들지 않는다 · 내용을 안 읽는다
 * ============================================================================
 * 이웃 quote-archive-product-folders-source.test.ts 와 같은 규율이다. 「지금은 안 쓴다」는
 * 시험으로 지켜지지 않는다 — 뒤 조각에서 누군가 지우는 한 줄을 들이면 **앱이 사람의
 * 서류함에서 파일을 지운다.** 그래서 동작이 아니라 **원본 글자**를 본다.
 *
 * 여기에 이 모듈만의 것이 셋 더 있다:
 *  · 🔴 **훑기와 읽기가 갈라져 있다.** 한 덩이로 합치면 양식마다 연도 폴더를 다시 훑게 되고
 *    (화면이 양식 셋을 미리 읽는다) 851ms 가 그만큼 곱절이 된다.
 *  · 🔴 **둘 다 맞아야 걸린다**(L/N + S/N). 한쪽만 보면 같은 S/N 을 쓰는 남의 장비 번호가
 *    고객사 표에 적힌다.
 *  · 🔴 **DB 를 모른다.** 「내자 정리에 번호가 있으면 그것만」이라는 규칙은 조회가 쥔다 —
 *    여기까지 내려오면 규칙이 두 군데가 된다.
 *
 * 읽는 동작 자체는 quote-archive-case-numbers.test.ts 가 임시 폴더에서 본다.
 * ============================================================================
 */

const source = readFileSync(new URL("./quote-archive-case-numbers.ts", import.meta.url), "utf8").replace(
  /\r\n/g,
  "\n"
);

/** 주석을 뺀 코드 — 머리말이 까닭을 설명하느라 적은 낱말에 걸리지 않게. */
const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

function importedFrom(text: string): string[] {
  return [...text.matchAll(/\bfrom "([^"]+)";/g)].map((match) => match[1]).sort();
}

describe("견적서 번호 읽기 — 원본으로 지킨다", () => {
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

  test("🔴 DB 도 요청 수명 캐시도 모른다 — 그 일은 조회가 쥔다", () => {
    for (const forbidden of ["drizzle", "db/client", "queries/", '"react"', "cache(", "domesticOrder"]) {
      assert.equal(code.includes(forbidden), false, `조회가 할 일이 내려왔다: ${forbidden}`);
    }
  });

  test("🔴 훑기와 읽기가 갈라져 있다 — 화면 하나에서 훑기를 한 번으로 만들 수 있게", () => {
    const exported = [...source.matchAll(/^export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm)]
      .map((match) => match[1])
      .sort();
    assert.deepEqual(exported, [
      "listQuoteArchiveFolderRefs",
      "quoteArchiveProductKey",
      "readQuoteArchiveNumbersForProducts",
    ]);
    // 🔴 훑기 쪽은 폴더 **안**을 열지 않는다 — 읽기 쪽만 연다(그래서 훑기 결과를 나눠 쓸 수 있다).
    const scanAt = code.indexOf("async function scanFolders(");
    const readAt = code.indexOf("async function readFileNames(");
    assert.ok(scanAt >= 0 && readAt >= 0);
    assert.equal(code.slice(scanAt, readAt).includes("listShareFolderDirents("), false, "훑기가 폴더 안을 연다");
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

  test("🔴 번호 모양을 다시 짜지 않는다 — 파일 이름에서 뽑는 일은 순수 함수 하나다", () => {
    assert.ok(code.includes("quoteNumbersFromArchiveFileNames("), "번호를 뽑는 함수를 부르지 않는다");
    // 번호를 제 손으로 쪼개거나 모양을 다시 적지 않는다.
    assert.equal(code.includes("quoteArchiveBaseNumber"), false, "번호 규칙을 베꼈다");
    assert.equal(/\\d\{4\}-/.test(code), false, "번호 모양 정규식을 이 파일이 다시 짰다");
    // `DSS` 가 나오는 자리는 **머리말을 다시 붙이는 상수 하나**뿐이다(내자 정리 값과 꼴을 맞춘다).
    assert.equal(code.match(/DSS/g)?.length, 1, "번호 모양을 글자로 다시 적었다");
    assert.ok(code.includes('const ARCHIVE_NUMBER_PREFIX = "DSS ";'));
  });

  test("🔴 둘 다 맞아야 한다 — 한쪽만 맞으면 걸리지 않는다(코드 모양으로도)", () => {
    assert.ok(
      code.includes("nameKeys.has(product.lotKey) && nameKeys.has(product.serialKey)"),
      "한쪽만 맞아도 걸린다"
    );
    // 열쇠가 비면 그 장비는 아예 목록에 들어가지 않는다.
    assert.ok(code.includes("if (!isUsableKey(lotKey) || !isUsableKey(serialKey)) return null;"));
  });

  test("🔴 설정이 없으면 디스크를 보기 **전에** 끝난다", () => {
    for (const diskMark of ["withShareFolderTimeout(", "requireExistingShareFolderRoot("]) {
      assert.ok(code.indexOf('return { status: "disabled" };') < code.indexOf(diskMark), diskMark);
    }
    // 설정을 읽는 길은 공용 함수 하나다 — 환경변수를 직접 만지지 않는다.
    assert.equal(code.includes("process.env"), false);
    assert.equal(code.includes("QUOTE_ARCHIVE_DIR"), false);
    // 훑기 · 읽기 두 자리에서 각각 한 번씩 읽는다.
    assert.equal(code.match(/resolveQuoteArchiveRoot\(\)/g)?.length, 2);
  });

  test("🔴 기다리는 시간과 폴더 수에 상한이 있다", () => {
    assert.equal(code.match(/withShareFolderTimeout\(/g)?.length, 2, "상한 없이 기다리는 길이 있다");
    assert.ok(code.includes("QUOTE_ARCHIVE_CASE_NUMBERS_SCAN_TIMEOUT_MS"));
    assert.ok(code.includes("QUOTE_ARCHIVE_CASE_NUMBERS_READ_TIMEOUT_MS"));
    assert.ok(code.includes("error instanceof ShareFolderTimeout"));
    assert.ok(code.includes("reason: QUOTE_ARCHIVE_CASE_NUMBERS_SLOW_REASON"));
    assert.ok(code.includes("QUOTE_ARCHIVE_CASE_NUMBERS_FOLDER_LIMIT"), "폴더 수 상한이 없다");
    assert.ok(code.includes("picked.length >= folderLimit"), "상한대로 끊지 않는다");
    // 🔴 상한에 걸리면 그 폴더를 **열기 전에** 끝낸다 — 상한이 곧 NAS 왕복 횟수다.
    assert.ok(code.indexOf("picked.length >= folderLimit") < code.indexOf("async function readNumbers("));
  });

  test("🔴 던지지 않는다 — 밖으로 나가는 것은 status 뿐이고, 사유에 경로를 담지 않는다", () => {
    assert.ok(code.includes('status: "failed"'));
    // fs 오류의 message 를 사유로 쓰지 않는다 — 경로가 들어 있다.
    assert.equal(/reason:\s*[A-Za-z_$][\w$]*\.message/.test(code), false, "오류 message 를 사유로 썼다");
    assert.equal(code.includes("String(error)"), false);
  });

  test("🔴 폴더를 가리키는 타입에 컨테이너 안 경로를 담는 칸이 없다 — 이름 둘뿐이다", () => {
    const folderType = source.slice(
      source.indexOf("export type QuoteArchiveFolderRef = {"),
      source.indexOf("export type QuoteArchiveFolderRefsResult")
    );
    const fields = [...folderType.matchAll(/^\s*(\w+)\??:/gm)].map((match) => match[1]).sort();
    assert.deepEqual(fields, ["folderName", "yearFolderName"]);
    for (const forbidden of ["root", "absolute", "fullpath", "uncpath", "dir:"]) {
      assert.equal(folderType.toLowerCase().includes(forbidden), false, `${forbidden} 가 줄 타입에 있다`);
    }
  });
});
