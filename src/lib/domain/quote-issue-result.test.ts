import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  QUOTE_ISSUE_RESULT_HEADER,
  decodeQuoteIssueResult,
  encodeQuoteIssueResult,
  parseQuoteIssueArchiveResult,
  parseQuoteIssueAttachmentResult,
  type QuoteIssueResult,
} from "./quote-issue-result";

/*
 * [견적서 받기] 결과 헤더 — 부호화 · 해독 한 쌍(순수). 공급처 · 모델 이름은 가짜다.
 */

const KOREAN_PATH =
  "91. 2096 내자견적서/DSS 2096-001 가나상사 MODEL-X1 수리 견적서/DSS 2096-001-1 가나상사 MODEL-X1 수리 견적서(OH포함) - 有印 (2).pdf";

/** encodeURIComponent 가 내는 글자만 — 공백 · 쉼표 · 쌍반점 · 한글이 헤더에 날로 실리지 않는다. */
const URI_COMPONENT_ONLY = /^[A-Za-z0-9%\-_.!~*'()]+$/;

const CASES: QuoteIssueResult[] = [
  {
    archive: { status: "saved", relativePath: KOREAN_PATH, multipleFolderMatches: false },
    attachment: { status: "replaced", displacedCount: 1 },
  },
  {
    archive: { status: "unchanged", relativePath: KOREAN_PATH, multipleFolderMatches: true },
    attachment: { status: "unchanged" },
  },
  {
    archive: { status: "failed", reason: "공유폴더를 찾을 수 없습니다(연결이 끊겼을 수 있습니다)." },
    attachment: { status: "failed", reason: "첨부 기록을 저장하지 못해 첨부 칸에 올리지 못했습니다." },
  },
  { archive: { status: "disabled" }, attachment: { status: "skipped" } },
  {
    archive: { status: "saved", relativePath: "a/b/c.xlsx", multipleFolderMatches: false },
    attachment: { status: "replaced", displacedCount: 0 },
  },
  {
    // 헤더 · JSON 이 다루기 까다로운 글자들 — 따옴표 · 퍼센트 · 더하기 · 쉼표 · 쌍반점 · 줄바꿈.
    archive: { status: "failed", reason: "사유 \"따옴표\" 100% + a,b; c\n다음 줄" },
    attachment: { status: "failed", reason: "%E0%A4%A 는 그냥 글자다" },
  },
];

describe("헤더 이름", () => {
  test("X-Quote-Issue-Result — 전역 보안 헤더(next.config.ts)와 겹치지 않는 새 이름", () => {
    assert.equal(QUOTE_ISSUE_RESULT_HEADER, "X-Quote-Issue-Result");
    const globalHeaders = [
      "X-Frame-Options",
      "Content-Security-Policy",
      "X-Content-Type-Options",
      "Referrer-Policy",
      "Permissions-Policy",
      "Strict-Transport-Security",
    ];
    for (const name of globalHeaders) {
      assert.notEqual(QUOTE_ISSUE_RESULT_HEADER.toLowerCase(), name.toLowerCase());
    }
  });
});

describe("부호화 → 해독 왕복", () => {
  for (const [index, result] of CASES.entries()) {
    test(`${index + 1}. archive=${result.archive.status} · attachment=${result.attachment.status}`, () => {
      const encoded = encodeQuoteIssueResult(result);
      assert.match(encoded, URI_COMPONENT_ONLY, "헤더 값은 ASCII(URI 부호) 뿐이어야 한다");
      assert.deepEqual(decodeQuoteIssueResult(encoded), result);
    });
  }

  test("한글 경로가 ASCII 로 실리고 그대로 돌아온다", () => {
    const encoded = encodeQuoteIssueResult(CASES[0]);
    for (const char of encoded) {
      const code = char.codePointAt(0) ?? 0;
      assert.ok(code >= 0x21 && code <= 0x7e, `ASCII 가 아닌 글자: ${JSON.stringify(char)}`);
    }
    const decoded = decodeQuoteIssueResult(encoded);
    assert.equal(decoded?.archive.status, "saved");
    assert.equal(decoded?.archive.status === "saved" ? decoded.archive.relativePath : null, KOREAN_PATH);
  });

  test("알려진 칸만 싣는다 — 부호화에 섞인 모르는 칸은 버린다", () => {
    const widened = {
      archive: { status: "saved", relativePath: "a/b.xlsx", multipleFolderMatches: false, absolutePath: "/비밀/경로" },
      attachment: { status: "replaced", displacedCount: 2, storedPath: "quotes/x/y.xlsx" },
      extra: "버린다",
    } as unknown as QuoteIssueResult;
    const encoded = encodeQuoteIssueResult(widened);
    assert.ok(!decodeURIComponent(encoded).includes("비밀"), "모르는 칸이 헤더에 실렸다");
    assert.ok(!decodeURIComponent(encoded).includes("storedPath"));
    assert.deepEqual(decodeQuoteIssueResult(encoded), {
      archive: { status: "saved", relativePath: "a/b.xlsx", multipleFolderMatches: false },
      attachment: { status: "replaced", displacedCount: 2 },
    });
  });
});

describe("이상한 값은 던지지 않고 null", () => {
  const wrap = (value: unknown) => encodeURIComponent(JSON.stringify(value));
  const valid = CASES[0];

  const weird: [string, string | null | undefined][] = [
    ["null", null],
    ["undefined", undefined],
    ["빈 문자열", ""],
    ["JSON 이 아니다", "not-json"],
    ["잘린 퍼센트 부호", "%E0%A4%A"],
    ["잘린 JSON", wrap(valid).slice(0, 20)],
    ["배열", wrap([valid.archive, valid.attachment])],
    ["null JSON", wrap(null)],
    ["문자열 JSON", wrap("saved")],
    ["attachment 없음", wrap({ archive: valid.archive })],
    ["archive 없음", wrap({ attachment: valid.attachment })],
    ["모르는 archive 상태", wrap({ ...valid, archive: { status: "overwritten", relativePath: "a" } })],
    ["saved 인데 경로 없음", wrap({ ...valid, archive: { status: "saved", multipleFolderMatches: false } })],
    ["경로가 숫자", wrap({ ...valid, archive: { status: "saved", relativePath: 7, multipleFolderMatches: false } })],
    [
      "여럿 표시가 글자",
      wrap({ ...valid, archive: { status: "unchanged", relativePath: "a", multipleFolderMatches: "false" } }),
    ],
    ["failed 인데 사유 없음", wrap({ ...valid, archive: { status: "failed" } })],
    ["모르는 attachment 상태", wrap({ ...valid, attachment: { status: "deleted" } })],
    ["교체 수가 음수", wrap({ ...valid, attachment: { status: "replaced", displacedCount: -1 } })],
    ["교체 수가 소수", wrap({ ...valid, attachment: { status: "replaced", displacedCount: 1.5 } })],
    ["교체 수가 글자", wrap({ ...valid, attachment: { status: "replaced", displacedCount: "1" } })],
    ["교체 수가 너무 크다", wrap({ ...valid, attachment: { status: "replaced", displacedCount: 1e20 } })],
    ["교체 수 없음", wrap({ ...valid, attachment: { status: "replaced" } })],
    ["attachment 가 배열", wrap({ ...valid, attachment: [] })],
  ];

  for (const [label, value] of weird) {
    test(label, () => {
      assert.equal(decodeQuoteIssueResult(value), null);
    });
  }
});

describe("한 칸씩 읽기 — 결재 PDF 올리기 응답의 archive 도 같은 모양", () => {
  test("archive 칸", () => {
    assert.deepEqual(parseQuoteIssueArchiveResult({ status: "disabled" }), { status: "disabled" });
    assert.deepEqual(
      parseQuoteIssueArchiveResult({ status: "unchanged", relativePath: KOREAN_PATH, multipleFolderMatches: false, x: 1 }),
      { status: "unchanged", relativePath: KOREAN_PATH, multipleFolderMatches: false }
    );
    assert.equal(parseQuoteIssueArchiveResult(null), null);
    assert.equal(parseQuoteIssueArchiveResult([]), null);
    assert.equal(parseQuoteIssueArchiveResult({ status: "skipped" }), null, "첨부 칸의 상태는 archive 가 아니다");
  });

  test("attachment 칸", () => {
    assert.deepEqual(parseQuoteIssueAttachmentResult({ status: "skipped" }), { status: "skipped" });
    assert.deepEqual(parseQuoteIssueAttachmentResult({ status: "replaced", displacedCount: 0 }), {
      status: "replaced",
      displacedCount: 0,
    });
    assert.equal(parseQuoteIssueAttachmentResult({ status: "disabled" }), null, "archive 의 상태는 첨부 칸이 아니다");
    assert.equal(parseQuoteIssueAttachmentResult("unchanged"), null);
  });
});
