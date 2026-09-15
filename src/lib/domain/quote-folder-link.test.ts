import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { quoteArchiveFolderName, quoteArchiveYearFolderName } from "./quote-archive-naming";
import {
  QUOTE_FOLDER_LINK_MAX_ENCODED_LENGTH,
  QUOTE_FOLDER_LINK_PREFIX,
  QUOTE_FOLDER_RELATIVE_PATH_MAX_LENGTH,
  buildQuoteFolderLink,
  checkQuoteFolderRelativePath,
  isQuoteFolderRelativePath,
  parseQuoteFolderLink,
  type QuoteFolderPathRejection,
} from "./quote-folder-link";

/*
 * 도우미 주소의 만들기 · 되읽기 · 거절 규칙. 도우미 스크립트(PowerShell)가 같은 규칙을 지키는지는
 * server/quote-folder-helper.test.ts 가 실제 스크립트를 돌려 본다. 이름은 가짜다(저장소가 공개다).
 */

/** 규칙을 거치지 않고 아무 문자열이나 주소로 싼다 — 공격자가 만든 주소 흉내. */
function rawLink(text: string): string {
  return `${QUOTE_FOLDER_LINK_PREFIX}${Buffer.from(text, "utf8").toString("base64url")}`;
}

const YEAR = "21. 2026 내자견적서";

describe("도우미 주소 — 왕복", () => {
  const cases = [
    `${YEAR}/DSS 2026-089 가나상사 MODEL-X1 수리 견적서`,
    `${YEAR}/DSS 2026-089  공백  두 칸`,
    `${YEAR}/R&D 100% 'Q' 견적서 (사본)`,
    `${YEAR}/이름에 %41 과 %% 과 & 과 ^ 과 ! 과 $env 과 $(calc) 과 ; 과 '`,
    `${YEAR.normalize("NFD")}/풀어쓴 한글`,
    "혼자 있는 폴더",
    "가/나/다/라",
    " 앞 공백은 Windows 가 허용한다",
    "😀 넷바이트 글자",
  ];
  for (const relativePath of cases) {
    test(`왕복: ${JSON.stringify(relativePath)}`, () => {
      const link = buildQuoteFolderLink(relativePath);
      assert.ok(link !== null);
      assert.ok(link.startsWith(QUOTE_FOLDER_LINK_PREFIX));
      // 명령줄에는 base64url 글자만 간다 — 공백 · % · & · 따옴표가 날것으로 가지 않는다.
      assert.match(link.slice(QUOTE_FOLDER_LINK_PREFIX.length), /^[A-Za-z0-9_-]+$/);
      assert.equal(parseQuoteFolderLink(link), relativePath);
      // Node 의 base64url 과 같은 값이다(채움 없음).
      assert.equal(link, rawLink(relativePath));
    });
  }

  test("이름 규칙이 만드는 폴더 경로는 모두 통과한다", () => {
    const folder = quoteArchiveFolderName({
      quoteNumber: "DSS 2026-089-1",
      kind: "OVERHAUL",
      customerName: "가나상사",
      modelName: "MODEL-X1",
      lotNumber: "L123",
      serialNumber: "S456",
    });
    const relativePath = `${quoteArchiveYearFolderName(2026)}/${folder}`;
    assert.equal(checkQuoteFolderRelativePath(relativePath), null);
    assert.equal(parseQuoteFolderLink(buildQuoteFolderLink(relativePath)), relativePath);
  });

  test("길이 상한 바로 아래까지는 통과, 한 글자 넘으면 거절 · 가장 긴 주소도 인코딩 상한 안", () => {
    const longest = "가".repeat(QUOTE_FOLDER_RELATIVE_PATH_MAX_LENGTH);
    const link = buildQuoteFolderLink(longest);
    assert.ok(link !== null);
    assert.ok(link.length - QUOTE_FOLDER_LINK_PREFIX.length <= QUOTE_FOLDER_LINK_MAX_ENCODED_LENGTH);
    assert.equal(parseQuoteFolderLink(link), longest);
    assert.equal(buildQuoteFolderLink(`${longest}가`), null);
    assert.equal(parseQuoteFolderLink(rawLink(`${longest}가`)), null);
  });
});

describe("도우미 주소 — 🔴 거절 규칙(만들기 · 되읽기 모두)", () => {
  const rejected: Array<[string, QuoteFolderPathRejection]> = [
    ["", "EMPTY"],
    ["..", "DOT_SEGMENT"],
    [".", "DOT_SEGMENT"],
    ["../바깥", "DOT_SEGMENT"],
    [`${YEAR}/../../바깥`, "DOT_SEGMENT"],
    [`${YEAR}/./견적서`, "DOT_SEGMENT"],
    ["/Windows", "ABSOLUTE"],
    ["//OTHERNAS/share", "ABSOLUTE"],
    ["\\\\OTHERNAS\\share", "ABSOLUTE"],
    ["\\Windows", "ABSOLUTE"],
    ["C:/Windows", "ABSOLUTE"],
    ["c:Windows", "ABSOLUTE"],
    ["C:", "ABSOLUTE"],
    [`${YEAR}\\견적서`, "FORBIDDEN_CHARACTER"],
    [`${YEAR}/견적서:stream`, "FORBIDDEN_CHARACTER"],
    [`${YEAR}/"; calc; "`, "FORBIDDEN_CHARACTER"],
    [`${YEAR}/별*표`, "FORBIDDEN_CHARACTER"],
    [`${YEAR}/물음?표`, "FORBIDDEN_CHARACTER"],
    [`${YEAR}/<꺾쇠>`, "FORBIDDEN_CHARACTER"],
    [`${YEAR}/파|이프`, "FORBIDDEN_CHARACTER"],
    [`${YEAR}/줄\n바꿈`, "CONTROL_CHARACTER"],
    [`${YEAR}/탭\t문자`, "CONTROL_CHARACTER"],
    [`${YEAR}/널${String.fromCharCode(0)}문자`, "CONTROL_CHARACTER"],
    [`${YEAR}/C1${String.fromCharCode(0x85)}문자`, "CONTROL_CHARACTER"],
    [`${YEAR}/DEL${String.fromCharCode(0x7f)}`, "CONTROL_CHARACTER"],
    [`${YEAR}/`, "EMPTY_SEGMENT"],
    [`${YEAR}//견적서`, "EMPTY_SEGMENT"],
    [`${YEAR}/끝이 점.`, "TRAILING_DOT_OR_SPACE"],
    [`${YEAR}/끝이 공백 `, "TRAILING_DOT_OR_SPACE"],
    [`${YEAR}/.. `, "TRAILING_DOT_OR_SPACE"],
    [`${YEAR}/...`, "TRAILING_DOT_OR_SPACE"],
    ["가".repeat(QUOTE_FOLDER_RELATIVE_PATH_MAX_LENGTH + 1), "TOO_LONG"],
  ];
  for (const [relativePath, reason] of rejected) {
    test(`${reason}: ${JSON.stringify(relativePath).slice(0, 60)}`, () => {
      assert.equal(checkQuoteFolderRelativePath(relativePath), reason);
      assert.equal(isQuoteFolderRelativePath(relativePath), false);
      assert.equal(buildQuoteFolderLink(relativePath), null);
      assert.equal(parseQuoteFolderLink(rawLink(relativePath)), null);
    });
  }

  test("문자열이 아니면 거절", () => {
    for (const value of [undefined, null, 1, {}, ["a"]]) {
      assert.equal(checkQuoteFolderRelativePath(value), "EMPTY");
      assert.equal(parseQuoteFolderLink(value), null);
    }
  });
});

describe("도우미 주소 — 🔴 모양 · 인코딩이 아니면 거절", () => {
  const good = rawLink(`${YEAR}/견적서`);

  test("앞부분이 다르면 거절(대소문자 · 다른 호스트 · 다른 이름)", () => {
    for (const link of [
      good.replace("dss-folder:", "DSS-FOLDER:"),
      good.replace("//open/", "//evil/"),
      good.replace("?p=", "?q="),
      good.replace("dss-folder://open/?p=", "dss-folder://open?p="),
      `https://example.com/?p=${good.slice(QUOTE_FOLDER_LINK_PREFIX.length)}`,
      ` ${good}`,
    ]) {
      assert.equal(parseQuoteFolderLink(link), null, link);
    }
  });

  test("base64url 알파벳 밖 · 채움 · 비었음 · 길이 나머지 1 · 뒤에 붙은 것은 거절", () => {
    const body = good.slice(QUOTE_FOLDER_LINK_PREFIX.length);
    for (const encoded of [
      "",
      `${body}=`,
      `${body}+`,
      `${body}/`,
      `${body} `,
      `${body}"; calc; "`,
      `${body}&calc`,
      `${body}%20`,
      `${body}\n`,
      "A",
      "AAAAA",
      Buffer.from(`${YEAR}/견적서`, "utf8").toString("base64"),
    ]) {
      assert.equal(parseQuoteFolderLink(`${QUOTE_FOLDER_LINK_PREFIX}${encoded}`), null, JSON.stringify(encoded));
    }
  });

  test("같은 바이트의 다른 표기(남은 비트가 0 이 아님)는 거절", () => {
    // "a" → "YQ" 가 표준. "YR" 은 같은 바이트로 풀리지만 표준 모양이 아니다.
    assert.equal(parseQuoteFolderLink(`${QUOTE_FOLDER_LINK_PREFIX}YQ`), "a");
    assert.equal(parseQuoteFolderLink(`${QUOTE_FOLDER_LINK_PREFIX}YR`), null);
  });

  test("UTF-8 이 아닌 바이트는 거절", () => {
    for (const bytes of [[0xff], [0xc3, 0x28], [0xed, 0xa0, 0x80], [0xe2, 0x82]]) {
      const link = `${QUOTE_FOLDER_LINK_PREFIX}${Buffer.from(bytes).toString("base64url")}`;
      assert.equal(parseQuoteFolderLink(link), null, JSON.stringify(bytes));
    }
  });

  test("짝이 없는 UTF-16 반쪽은 만들지 않는다", () => {
    assert.equal(buildQuoteFolderLink(`${YEAR}/반쪽${String.fromCharCode(0xd800)}`), null);
  });

  test("인코딩 상한을 넘는 주소는 풀기 전에 거절", () => {
    const tooLong = `${QUOTE_FOLDER_LINK_PREFIX}${"A".repeat(QUOTE_FOLDER_LINK_MAX_ENCODED_LENGTH + 4)}`;
    assert.equal(parseQuoteFolderLink(tooLong), null);
  });
});
