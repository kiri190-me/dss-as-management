import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { encodeQuoteIssueResult, decodeQuoteIssueResult, type QuoteIssueResult } from "@/lib/domain/quote-issue-result";
import {
  QUOTE_ISSUE_RESULT_UNKNOWN_TEXT,
  QUOTE_ISSUE_UNSAVED_CHANGES_TEXT,
  QUOTE_SIGNED_PDF_ARCHIVE_UNKNOWN_TEXT,
  quoteArchiveNoticeLines,
  quoteAttachmentNoticeLine,
  quoteIssueBlockedNoticeLines,
  quoteIssueFailureNoticeLines,
  quoteIssueNoticeLines,
  quoteUploadArchiveNoticeLines,
} from "./quote-issue-messages";

/**
 * ============================================================================
 * [견적서 받기] · 결재 PDF 올리기 — 결과 문장 (견적서 B1c)
 * ============================================================================
 * 세 화면과 결재 PDF 올리기가 이 문장을 그대로 쓴다. 문장은 사용자가 정한 것이라(작업 지시서)
 * 한 글자까지 본다. 공유폴더 네 상태 × 여러 폴더, 엑셀 칸 네 상태(올림 · 교체 가르기 포함),
 * 결과를 못 읽었을 때.
 * ============================================================================
 */

const PATH = "2026/견적서/견적서_DSS 2026-077_ICD.xlsx";
const MULTIPLE_SAVED = "맞는 폴더가 여럿이라 이름순 첫째에 넣었습니다 — 폴더를 확인해 주세요";
const MULTIPLE_UNCHANGED = "맞는 폴더가 여럿이라 이름순 첫째 폴더를 보았습니다 — 폴더를 확인해 주세요";

describe("공유폴더 — [견적서 받기]", () => {
  test("저장함 — 경로를 붙인다", () => {
    assert.deepEqual(
      quoteArchiveNoticeLines({ status: "saved", relativePath: PATH, multipleFolderMatches: false }, "download"),
      [{ text: `공유폴더에 저장했습니다: ${PATH}`, tone: "normal" }]
    );
  });

  test("🔴 저장함 + 맞는 폴더가 여럿 — 경로 줄 뒤에 확인하라는 주의 줄", () => {
    assert.deepEqual(
      quoteArchiveNoticeLines({ status: "saved", relativePath: PATH, multipleFolderMatches: true }, "download"),
      [
        { text: `공유폴더에 저장했습니다: ${PATH}`, tone: "normal" },
        { text: MULTIPLE_SAVED, tone: "warning" },
      ]
    );
  });

  test("같은 내용 — 이미 있는 그 파일의 경로", () => {
    assert.deepEqual(
      quoteArchiveNoticeLines({ status: "unchanged", relativePath: PATH, multipleFolderMatches: false }, "download"),
      [{ text: `공유폴더에 같은 내용의 파일이 이미 있습니다: ${PATH}`, tone: "normal" }]
    );
  });

  test("같은 내용 + 맞는 폴더가 여럿 — 넣지 않았으므로 「보았습니다」", () => {
    assert.deepEqual(
      quoteArchiveNoticeLines({ status: "unchanged", relativePath: PATH, multipleFolderMatches: true }, "download"),
      [
        { text: `공유폴더에 같은 내용의 파일이 이미 있습니다: ${PATH}`, tone: "normal" },
        { text: MULTIPLE_UNCHANGED, tone: "warning" },
      ]
    );
  });

  test("🔴 실패 — 사유를 괄호에(끝의 마침표만 뗀다), 파일은 내려받았다고", () => {
    assert.deepEqual(
      quoteArchiveNoticeLines({ status: "failed", reason: "공유폴더에 쓸 권한이 없습니다." }, "download"),
      [{ text: "공유폴더에 저장하지 못했습니다(공유폴더에 쓸 권한이 없습니다) — 파일은 내려받았습니다", tone: "warning" }]
    );
    // 사유 안의 괄호는 그대로 둔다 — 서버가 지은 문장이다.
    const [line] = quoteArchiveNoticeLines(
      { status: "failed", reason: "공유폴더를 찾을 수 없습니다(연결이 끊겼을 수 있습니다)." },
      "download"
    );
    assert.equal(line.text, "공유폴더에 저장하지 못했습니다(공유폴더를 찾을 수 없습니다(연결이 끊겼을 수 있습니다)) — 파일은 내려받았습니다");
  });

  test("실패 사유가 비었으면 빈 괄호 대신 「까닭을 알 수 없습니다」", () => {
    const [line] = quoteArchiveNoticeLines({ status: "failed", reason: " . " }, "download");
    assert.equal(line.text, "공유폴더에 저장하지 못했습니다(까닭을 알 수 없습니다) — 파일은 내려받았습니다");
  });

  test("🔴 꺼짐 — 흐린 글씨 한 줄", () => {
    assert.deepEqual(quoteArchiveNoticeLines({ status: "disabled" }, "download"), [
      { text: "공유폴더 저장이 꺼져 있습니다", tone: "muted" },
    ]);
  });
});

describe("수기 견적서 엑셀 칸", () => {
  test("🔴 빈 칸에 처음 올렸으면(displacedCount 0) 「올렸습니다」", () => {
    assert.deepEqual(quoteAttachmentNoticeLine({ status: "replaced", displacedCount: 0 }), {
      text: "수기 견적서 엑셀 칸에 이 파일을 올렸습니다",
      tone: "normal",
    });
  });

  test("🔴 옛 파일을 밀어냈으면(1 이상) 「바꿨습니다(옛 파일은 첨부 휴지통)」", () => {
    for (const displacedCount of [1, 3]) {
      assert.deepEqual(quoteAttachmentNoticeLine({ status: "replaced", displacedCount }), {
        text: "수기 견적서 엑셀 칸을 이 파일로 바꿨습니다(옛 파일은 첨부 휴지통)",
        tone: "normal",
      });
    }
  });

  test("같은 내용 · 실패", () => {
    assert.deepEqual(quoteAttachmentNoticeLine({ status: "unchanged" }), {
      text: "엑셀 칸은 같은 내용이라 그대로 두었습니다",
      tone: "normal",
    });
    assert.deepEqual(
      quoteAttachmentNoticeLine({ status: "failed", reason: "견적서 파일이 20MB를 넘어 첨부 칸에 올리지 못했습니다." }),
      { text: "엑셀 칸에 올리지 못했습니다(견적서 파일이 20MB를 넘어 첨부 칸에 올리지 못했습니다)", tone: "warning" }
    );
  });

  test("엑셀 전용(skipped)은 말이 없다", () => {
    assert.equal(quoteAttachmentNoticeLine({ status: "skipped" }), null);
  });
});

describe("[견적서 받기] — 전체 줄", () => {
  const RESULT: QuoteIssueResult = {
    archive: { status: "saved", relativePath: PATH, multipleFolderMatches: false },
    attachment: { status: "replaced", displacedCount: 1 },
  };

  test("공유폴더 줄 다음에 엑셀 칸 줄", () => {
    assert.deepEqual(
      quoteIssueNoticeLines(RESULT).map((line) => line.text),
      [`공유폴더에 저장했습니다: ${PATH}`, "수기 견적서 엑셀 칸을 이 파일로 바꿨습니다(옛 파일은 첨부 휴지통)"]
    );
  });

  test("엑셀 전용 견적서는 공유폴더 줄만", () => {
    assert.deepEqual(quoteIssueNoticeLines({ ...RESULT, attachment: { status: "skipped" } }), [
      { text: `공유폴더에 저장했습니다: ${PATH}`, tone: "normal" },
    ]);
  });

  test("🔴 결과 헤더가 없거나 해독이 안 되면 — 내려받았지만 결과를 확인하지 못했다고", () => {
    const unknown = [{ text: QUOTE_ISSUE_RESULT_UNKNOWN_TEXT, tone: "warning" }];
    assert.equal(QUOTE_ISSUE_RESULT_UNKNOWN_TEXT, "파일은 내려받았지만 공유폴더 · 엑셀 칸 결과를 확인하지 못했습니다");
    assert.deepEqual(quoteIssueNoticeLines(null), unknown);
    assert.deepEqual(quoteIssueNoticeLines(decodeQuoteIssueResult(null)), unknown);
    assert.deepEqual(quoteIssueNoticeLines(decodeQuoteIssueResult("%7B%22archive%22")), unknown);
  });

  test("서버가 접은 헤더를 풀어도 같은 줄이다", () => {
    assert.deepEqual(quoteIssueNoticeLines(decodeQuoteIssueResult(encodeQuoteIssueResult(RESULT))), quoteIssueNoticeLines(RESULT));
  });
});

describe("결재 PDF 올리기 — 같은 문장, 뒷말만 올리기에 맞게", () => {
  test("🔴 실패는 「결재 PDF 는 칸에 올라갔습니다」 — 내려받은 것이 없다", () => {
    const [line] = quoteUploadArchiveNoticeLines("SIGNED_QUOTE_PDF", {
      status: "failed",
      reason: "공유폴더에 남은 공간이 없습니다.",
    });
    assert.equal(line.text, "공유폴더에 저장하지 못했습니다(공유폴더에 남은 공간이 없습니다) — 결재 PDF 는 칸에 올라갔습니다");
    assert.equal(line.tone, "warning");
    assert.ok(!line.text.includes("내려받았습니다"), line.text);
  });

  test("저장함 · 같은 내용 · 꺼짐은 받기와 같은 문장", () => {
    for (const archive of [
      { status: "saved", relativePath: "2026/견적서/x - 有印.pdf", multipleFolderMatches: true },
      { status: "unchanged", relativePath: "2026/견적서/x - 有印.pdf", multipleFolderMatches: false },
      { status: "disabled" },
    ] as const) {
      assert.deepEqual(
        quoteUploadArchiveNoticeLines("SIGNED_QUOTE_PDF", archive),
        quoteArchiveNoticeLines(archive, "download")
      );
    }
  });

  test("응답의 공유폴더 칸을 못 읽었으면 그 사실 한 줄", () => {
    assert.deepEqual(quoteUploadArchiveNoticeLines("SIGNED_QUOTE_PDF", null), [
      { text: QUOTE_SIGNED_PDF_ARCHIVE_UNKNOWN_TEXT, tone: "warning" },
    ]);
  });

  test("수기 엑셀 칸 올리기는 공유폴더에 복사하지 않는다 — 줄이 없다", () => {
    assert.deepEqual(quoteUploadArchiveNoticeLines("QUOTE_EXCEL", null), []);
    assert.deepEqual(quoteUploadArchiveNoticeLines("QUOTE_EXCEL", { status: "disabled" }), []);
  });
});

describe("막힘 · 실패", () => {
  test("🔴 저장하지 않은 변경 — 사용자가 정한 문장", () => {
    assert.equal(QUOTE_ISSUE_UNSAVED_CHANGES_TEXT, "저장하지 않은 변경이 있습니다 — 먼저 [저장]을 눌러 주세요");
    assert.deepEqual(quoteIssueBlockedNoticeLines(), [{ text: QUOTE_ISSUE_UNSAVED_CHANGES_TEXT, tone: "warning" }]);
  });

  test("받지 못했으면 그 까닭을 붙인다", () => {
    assert.deepEqual(quoteIssueFailureNoticeLines("이 작업을 수행할 권한이 없습니다."), [
      { text: "견적서 파일을 받지 못했습니다 — 이 작업을 수행할 권한이 없습니다.", tone: "warning" },
    ]);
  });
});
