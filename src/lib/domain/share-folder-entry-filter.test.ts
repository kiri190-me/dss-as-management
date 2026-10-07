import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

import {
  SHARE_FOLDER_ENTRY_PLACE_ROOT,
  filterShareFolderEntriesByQuery,
  isShareFolderEntryQueryActive,
  matchesShareFolderEntryQuery,
  normalizeShareFolderEntryQuery,
  shareFolderEntryPlaceAt,
} from "./share-folder-entry-filter";

/**
 * ============================================================================
 * 「공유폴더에서 고르기」 창의 **이름으로 거르기** — 값 쪽 (2026-10-08)
 * ============================================================================
 * 화면 쪽(두 창이 이것을 어떻게 쓰는가)은 components 목록의 두 시험이 본다:
 * product-model-kind-share-docs-screen.test.tsx · product-model-share-docs-screen.test.tsx.
 * 여기서는 **견주는 규칙 자체**만 본다.
 *
 * 🔴 못 박는 것:
 *  · 폴더와 파일이 **둘 다** 걸린다(이름만 본다 — 종류를 보지 않는다)
 *  · 대소문자가 달라도, 연속 공백이 달라도, 풀어쓴 한글(NFD)이어도 걸린다
 *  · 거르는 글자가 없으면 **받은 배열 그대로**다
 *  · 자리를 옮기면 거르기 칸이 **빈 칸**이 된다
 *  · 🔴 견주기를 **새로 만들지 않았다** — share-folder-naming 의 비교 함수를 쓴다
 * ============================================================================
 */

const repoUrl = new URL("../../../", import.meta.url);
const source = readFileSync(
  new URL("src/lib/domain/share-folder-entry-filter.ts", repoUrl),
  "utf8"
).replace(/\r\n/g, "\n");
/** "이 글자가 있으면 안 된다" 를 볼 때 쓴다 — 주석에 적힌 까닭에 걸리지 않게. */
const code = (value: string) =>
  value.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");

type Row = { name: string; isDirectory: boolean };

const entry = (name: string, isDirectory = false): Row => ({ name, isDirectory });

const names = (rows: readonly Row[]) => rows.map((row) => row.name);

describe("① 🔴 폴더와 파일이 **둘 다** 걸린다 — 이름만 본다", () => {
  const rows = [
    entry("2. 인수시 서류", true),
    entry("MB 인수시 체크시트.xlsx"),
    entry("1. 수리 관련", true),
    entry("회로도.pdf"),
  ];

  test("「인수」로 거르면 폴더 한 줄과 파일 한 줄이 함께 남는다", () => {
    const kept = filterShareFolderEntriesByQuery(rows, "인수");
    assert.deepEqual(names(kept), ["2. 인수시 서류", "MB 인수시 체크시트.xlsx"]);
    assert.deepEqual(
      kept.map((row) => row.isDirectory),
      [true, false],
      "폴더와 파일이 둘 다 걸리지 않았다"
    );
  });

  test("부분 일치다 — 이름 가운데 글자로도 걸린다", () => {
    assert.deepEqual(names(filterShareFolderEntriesByQuery(rows, "체크")), ["MB 인수시 체크시트.xlsx"]);
    assert.deepEqual(names(filterShareFolderEntriesByQuery(rows, "xlsx")), ["MB 인수시 체크시트.xlsx"]);
    assert.deepEqual(names(filterShareFolderEntriesByQuery(rows, "관련")), ["1. 수리 관련"]);
  });

  test("차례를 흔들지 않는다 — 서버가 준 차례 그대로 남는다", () => {
    assert.deepEqual(names(filterShareFolderEntriesByQuery(rows, "ㅅ")), []);
    assert.deepEqual(names(filterShareFolderEntriesByQuery(rows, "1")), ["1. 수리 관련"]);
    const reversed = filterShareFolderEntriesByQuery([...rows].reverse(), "수");
    assert.deepEqual(names(reversed), ["1. 수리 관련", "MB 인수시 체크시트.xlsx", "2. 인수시 서류"]);
  });

  test("맞는 것이 하나도 없으면 빈 배열이다 — 화면이 그때 안내를 낸다", () => {
    assert.deepEqual(filterShareFolderEntriesByQuery(rows, "없는이름"), []);
  });
});

describe("② 🔴 대소문자가 달라도, 연속 공백이 달라도 걸린다", () => {
  test("대소문자를 접는다 — 사람이 소문자로 쳐도 대문자 폴더가 걸린다", () => {
    assert.equal(matchesShareFolderEntryQuery("MB 인수시 체크시트.xlsx", "mb"), true);
    assert.equal(matchesShareFolderEntryQuery("mb 자료", "MB"), true);
    assert.equal(matchesShareFolderEntryQuery("보고서.PDF", "pdf"), true);
    assert.equal(matchesShareFolderEntryQuery("보고서.pdf", "PDF"), true);
  });

  test("연속 공백을 하나로 접는다 — 양쪽 어디에 두 칸이 있어도 같다", () => {
    assert.equal(matchesShareFolderEntryQuery("2.  인수시   서류", "인수시 서류"), true);
    assert.equal(matchesShareFolderEntryQuery("2. 인수시 서류", "인수시   서류"), true);
    assert.equal(matchesShareFolderEntryQuery("2. 인수시 서류", "  인수시 서류  "), true);
  });

  test("풀어쓴 한글(NFD)도 모아쓴 한글로 친 글자에 걸린다 — 디스크에 둘 다 있다", () => {
    const nfd = "인수시 서류".normalize("NFD");
    assert.notEqual(nfd, "인수시 서류", "시험 재료가 NFD 가 아니다");
    assert.equal(matchesShareFolderEntryQuery(nfd, "인수시"), true);
    assert.equal(matchesShareFolderEntryQuery("인수시 서류", "인수시".normalize("NFD")), true);
  });

  test("다듬는 자리는 하나다 — 칸의 글자도 줄의 이름도 같은 함수를 지난다", () => {
    assert.equal(normalizeShareFolderEntryQuery("  Mb   자료 "), "MB 자료");
    assert.equal(normalizeShareFolderEntryQuery("\t인수시\n서류 "), "인수시 서류");
  });
});

describe("③ 거르는 글자가 없으면 거르지 않는다", () => {
  const rows = [entry("MB", true), entry("회로도.pdf")];

  test("빈 칸 · 공백뿐인 칸은 「거르는 중」이 아니다", () => {
    assert.equal(isShareFolderEntryQueryActive(""), false);
    assert.equal(isShareFolderEntryQueryActive("   "), false);
    assert.equal(isShareFolderEntryQueryActive("\t\n"), false);
    assert.equal(isShareFolderEntryQueryActive("M"), true);
    assert.equal(isShareFolderEntryQueryActive(" 회로 "), true);
  });

  test("🔴 받은 배열을 **그대로** 돌려준다 — 새 배열을 만들지 않는다", () => {
    assert.equal(filterShareFolderEntriesByQuery(rows, ""), rows);
    assert.equal(filterShareFolderEntriesByQuery(rows, "   "), rows);
    assert.equal(matchesShareFolderEntryQuery("아무이름", ""), true);
    assert.equal(matchesShareFolderEntryQuery("아무이름", "  "), true);
  });
});

describe("④ 🔴 자리를 옮기면 거르기 칸이 비워진다", () => {
  test("어느 자리로 옮기든 칸은 빈 글자로 시작한다", () => {
    for (const next of ["", "2. 인수시 서류", "2. 인수시 서류/MB", "1. 수리 관련"]) {
      const place = shareFolderEntryPlaceAt(next);
      assert.equal(place.insidePath, next);
      assert.equal(place.filterQuery, "", `${next} 로 옮겼는데 칸이 남았다`);
    }
  });

  test("처음 뜨는 자리도 맨 위 칸 · 빈 칸이다", () => {
    assert.deepEqual(SHARE_FOLDER_ENTRY_PLACE_ROOT, { insidePath: "", filterQuery: "" });
    assert.deepEqual(shareFolderEntryPlaceAt(""), SHARE_FOLDER_ENTRY_PLACE_ROOT);
  });

  test("🔴 자리를 옮기면서 칸을 남길 길이 없다 — 받는 값이 자리 하나뿐이다", () => {
    assert.equal(shareFolderEntryPlaceAt.length, 1);
  });
});

describe("⑤ 🔴 견주기를 **새로 만들지 않았다**", () => {
  test("share-folder-naming 의 비교 함수를 그대로 쓴다", () => {
    assert.ok(
      source.includes('import { normalizeShareFolderNameForCompare } from "./share-folder-naming";'),
      "공용 비교 함수를 가져오지 않는다"
    );
    assert.ok(code(source).includes("normalizeShareFolderNameForCompare(value)"), "가져다 놓고 안 쓴다");
  });

  test("🔴 다듬기를 베껴 적지 않았다 — NFC · 공백 접기 · 걷기를 제 손으로 하지 않는다", () => {
    const body = code(source);
    for (const forbidden of ['normalize("NFC")', "replace(/\\s+/g", ".trim()", "sanitizeShareFolderNamePiece"]) {
      assert.equal(body.includes(forbidden), false, `다듬기를 베껴 적었다: ${forbidden}`);
    }
  });

  test("🔴 대소문자 접기는 로케일을 못 박는다 — 터키어에서 i 가 İ 가 되지 않게", () => {
    assert.ok(code(source).includes('toLocaleUpperCase("en-US")'), "로케일을 못 박지 않았다");
    assert.equal(code(source).includes("toUpperCase()"), false, "로케일 없는 접기를 쓴다");
    assert.equal(code(source).includes("toLowerCase()"), false, "로케일 없는 접기를 쓴다");
  });

  test("🔴 순수하다 — 파일시스템도 통로도 서버도 만지지 않는다", () => {
    const body = code(source);
    for (const forbidden of ["node:fs", "fetch(", "/api/", "@/lib/server/", "@/lib/db/", "server-only"]) {
      assert.equal(body.includes(forbidden), false, `순수 함수가 아니다: ${forbidden}`);
    }
  });

  test("🔴 상한 셋을 건드리지 않는다 — 받아 둔 줄을 거를 뿐이다", () => {
    const body = code(source);
    for (const forbidden of ["REPAIR_DOCS_ENTRIES_LIMIT", "@/lib/storage/", "3000", "200", "slice("]) {
      assert.equal(body.includes(forbidden), false, `상한에 손을 댄다: ${forbidden}`);
    }
  });
});
