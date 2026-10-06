import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

/**
 * ============================================================================
 * 다음 번호 **제안** — 채번기가 아니다 · 지우지 않는다 · 만들지 않는다 (2026-10-06)
 * ============================================================================
 * 이웃 quote-archive-product-folders-source.test.ts 와 같은 규율이다. 「지금은 안 쓴다」는
 * 시험으로 지켜지지 않는다 — 뒤 조각에서 누군가 쓰는 한 줄을 들이면 **앱이 사람의 서류함을
 * 고친다.** 그래서 동작이 아니라 **원본 글자**를 본다.
 *
 * 여기에 이 모듈만의 것이 셋 더 있다:
 *  · 🔴 **채번기가 아니라는 사실이 머리말에 적혀 있다.** 다음 사람이 이 모듈을 「채번기」로
 *    오해하면 번호 칸이 읽기 전용이 되거나 저장할 때 덮어쓰는 코드가 붙는다 — 그 순간
 *    「사람이 손으로 적는다」는 승인된 결정이 코드로 뒤집힌다.
 *  · 🔴 **DB 를 모른다.** 이미 쓰인 번호는 **받아서** 본다 — 저장소 모듈이 조회를 끌어안으면
 *    시험이 DB 없이 돌 수 없게 되고, 읽기 전용 경계도 흐려진다.
 *  · 🔴 **연도 폴더 판정을 새로 쓰지 않는다.** 규칙이 두 벌이 되면 한쪽만 고쳐져 어떤 해의
 *    폴더만 조용히 안 보이게 된다.
 *
 * 제안 자체는 quote-number-suggestion.test.ts 가 임시 폴더에서 본다.
 * ============================================================================
 */

const source = readFileSync(new URL("./quote-number-suggestion.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");

/** 주석을 뺀 코드 — 머리말이 까닭을 설명하느라 적은 낱말에 걸리지 않게. */
const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/** 머리말(파일 첫 블록 주석) — 여기에 적혀 있어야 하는 말이 있다. */
const header = source.slice(source.indexOf("/**"), source.indexOf("*/") + 2);

function importedFrom(text: string): string[] {
  return [...text.matchAll(/\bfrom "([^"]+)";/g)].map((match) => match[1]).sort();
}

describe("다음 번호 제안 — 원본으로 지킨다", () => {
  test("🔴 **채번기가 아니다**라는 사실이 머리말에 적혀 있다", () => {
    for (const phrase of ["채번기가 아니다", "사람이 손으로 적는", "자유 텍스트", "제안"]) {
      assert.ok(header.includes(phrase), `머리말에 없다: ${phrase}`);
    }
    // 번호를 **쓰는** 쪽 이름이 한 글자도 없다 — 이 모듈은 어디에도 번호를 적지 않는다.
    for (const forbidden of ["mutations", "updateQuote", "insert", "db.", "drizzle"]) {
      assert.equal(code.includes(forbidden), false, `번호를 쓰는 흔적: ${forbidden}`);
    }
  });

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

  test("🔴 폴더 **이름만** 본다 — 안으로 내려가지도, 내용을 읽지도 않는다", () => {
    for (const forbidden of [/\breadFile\b/, /\bcreateReadStream\b/, /\bopen\b\s*\(/, /\bBlob\b/, /\bBuffer\b/]) {
      assert.equal(forbidden.test(code), false, `내용을 읽는 흔적: ${forbidden}`);
    }
    // 크기 · 수정 시각도 재지 않고, 폴더 안의 파일 이름조차 읽지 않는다.
    assert.equal(code.includes("statShareFolderEntry"), false, "줄마다 stat 을 때린다");
    assert.equal(code.includes("listShareFolderDirents"), false, "폴더 안의 파일까지 읽는다");
  });

  test("🔴 파일시스템을 직접 가져오지 않는다 — 읽기는 공용 도우미 하나를 거친다", () => {
    assert.deepEqual(
      importedFrom(source),
      [
        "./quote-archive",
        "./share-folder-fs",
        "@/lib/domain/date-only",
        "@/lib/domain/quote-archive-naming",
        "@/lib/domain/share-folder-naming",
        "node:path",
      ].sort()
    );
    for (const forbidden of ["node:fs", "fs/promises", "require(", "import(", "child_process", "console."]) {
      assert.equal(code.includes(forbidden), false, `흔적: ${forbidden}`);
    }
    // 🔴 DB 를 모른다 — 이미 쓰인 번호는 **받아서** 본다.
    for (const forbidden of ["@/lib/db", "queries/quotes", "listQuotes"]) {
      assert.equal(source.includes(forbidden), false, `DB 를 끌어안았다: ${forbidden}`);
    }
    assert.ok(code.includes("knownQuoteNumbers"), "이미 쓰인 번호를 받는 칸이 없다");
    // 서버에서만 도는 모듈이다.
    assert.ok(source.startsWith('import "server-only";'), "server-only 가 맨 앞에 없다");
  });

  test("🔴 연도 폴더 판정을 새로 쓰지 않는다 — 이미 있는 함수를 그대로 쓴다", () => {
    assert.ok(code.includes("isQuoteArchiveYearFolder("), "연도 폴더 판정을 부르지 않는다");
    // 연도 폴더 이름 규칙(라벨 · 앞 번호 · 연도 범위)을 여기에 두 벌째 적지 않는다.
    for (const forbidden of ["내자견적서", "YEAR_FOLDER", "2005", "2104"]) {
      assert.equal(code.includes(forbidden), false, `연도 폴더 규칙을 베꼈다: ${forbidden}`);
    }
    // 폴더를 읽는 일도 공용 도우미 하나를 거친다 — 루트에서 한 번, 그 해 연도 폴더에서 한 번.
    assert.equal(code.includes("readdir("), false, "폴더 읽기를 다시 짰다");
    assert.equal(code.match(/listShareFolderNames\(/g)?.length, 2, "연도 폴더 고르기 · 그 안 읽기 두 번이 아니다");
  });

  test("🔴 설정이 없으면 디스크를 보기 **전에** 끝난다", () => {
    const disabledAt = code.indexOf('return { status: "disabled" };');
    assert.ok(disabledAt >= 0, "disabled 가 없다");
    for (const diskMark of ["withShareFolderTimeout(", "requireExistingShareFolderRoot("]) {
      assert.ok(disabledAt < code.indexOf(diskMark), `디스크를 본 뒤에 꺼짐을 본다: ${diskMark}`);
    }
    // 설정을 읽는 길은 공용 함수 하나다 — 환경변수를 직접 만지지 않는다.
    assert.equal(code.includes("process.env"), false);
    assert.equal(code.includes("QUOTE_ARCHIVE_DIR"), false);
    assert.equal(code.match(/resolveQuoteArchiveRoot\(\)/g)?.length, 1);
  });

  test("🔴 기다리는 시간에 상한이 있다", () => {
    assert.ok(code.includes("withShareFolderTimeout("), "상한 없이 기다린다");
    assert.ok(code.includes("QUOTE_NUMBER_SUGGESTION_TIMEOUT_MS"));
    assert.ok(code.includes("error instanceof ShareFolderTimeout"));
    assert.ok(code.includes("reason: QUOTE_NUMBER_SUGGESTION_SLOW_REASON"));
  });

  test("🔴 던지지 않는다 — 밖으로 나가는 것은 status 뿐이고, 사유에 경로를 담지 않는다", () => {
    const exported = [...source.matchAll(/^export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm)]
      .map((match) => match[1])
      .sort();
    assert.deepEqual(exported, ["suggestNextQuoteNumber"]);
    assert.ok(code.includes('status: "failed"'));
    // fs 오류의 message 를 사유로 쓰지 않는다 — 경로가 들어 있다.
    assert.equal(/reason:\s*[A-Za-z_$][\w$]*\.message/.test(code), false, "오류 message 를 사유로 썼다");
    assert.equal(code.includes("String(error)"), false);
  });

  test("🔴 결과 타입에 경로를 담는 칸이 없다 — 번호와 근거 숫자뿐이다", () => {
    const resultType = source.slice(
      source.indexOf("export type QuoteNumberSuggestionResult ="),
      source.indexOf("export type SuggestNextQuoteNumberInput")
    );
    assert.ok(resultType.includes('status: "ready";'), resultType);
    // 🔴 `ready` 가 들고 나오는 칸 전부(한 줄에 한 칸씩 적은 것만 걸린다 — `disabled` ·
    //    `failed` 는 한 줄짜리라 여기 안 나온다. 그 둘은 아래에서 따로 본다).
    const fields = [...resultType.matchAll(/^\s*(\w+)\??:/gm)].map((match) => match[1]).sort();
    assert.deepEqual(fields, [
      "folderCount",
      "highestFolderSequence",
      "highestKnownSequence",
      "numberedFolderCount",
      "quoteNumber",
      "sequence",
      "status",
      "year",
    ]);
    assert.ok(resultType.includes('| { status: "disabled" }'), resultType);
    assert.ok(resultType.includes('| { status: "failed"; reason: string };'), resultType);
    for (const forbidden of ["root", "absolute", "fullpath", "uncpath", "dir:", "relativepath"]) {
      assert.equal(resultType.toLowerCase().includes(forbidden), false, `${forbidden} 가 결과 타입에 있다`);
    }
  });

  test("🔴 「가장 큰 것 + 1」이다 — 빈 자리를 메우는 코드가 없다", () => {
    assert.ok(code.includes("highest + 1"), "가장 큰 번호 다음을 쓰지 않는다");
    // 빈 자리를 찾아 채우려면 번호를 늘어놓고 사이를 뒤져야 한다 — 그런 코드가 없다.
    for (const forbidden of [/\bgap\b/i, /\bmissing\b/i, /\.sort\(/, /\bnew Set\b/]) {
      assert.equal(forbidden.test(code), false, `빈 자리를 메우려는 흔적: ${forbidden}`);
    }
  });
});
