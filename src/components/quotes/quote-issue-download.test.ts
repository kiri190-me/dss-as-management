import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { quoteContentDisposition } from "@/lib/domain/quote-file-name";
import { QUOTE_ISSUE_RESULT_HEADER, encodeQuoteIssueResult, type QuoteIssueResult } from "@/lib/domain/quote-issue-result";
import {
  QUOTE_ISSUE_FALLBACK_FILE_NAME,
  downloadIssuedQuote,
  quoteIssueUrl,
  runQuoteIssue,
  shouldReloadSlotsAfterIssue,
  type QuoteIssueFetch,
  type QuoteIssueRunOutcome,
} from "./quote-issue-download";
import {
  QUOTE_ISSUE_FILE_NOT_SAVED_TEXT,
  QUOTE_ISSUE_RESULT_UNKNOWN_TEXT,
  QUOTE_ISSUE_UNSAVED_CHANGES_TEXT,
  quoteIssueNoticeLines,
} from "./quote-issue-messages";

/**
 * ============================================================================
 * 수정 권한자의 [견적서 받기] — 발행 통로 응답을 읽는 법 · 저장하지 않은 변경 (견적서 B1c)
 * ============================================================================
 * fetch 를 흉내 내어 발행 통로(api/quotes/[id]/issue/route.ts)의 응답 모양을 그대로 돌려준다 —
 * 성공은 파일 바이트 + Content-Disposition + X-Quote-Issue-Result, 실패는 `{ error, code }`.
 * 네트워크도 DB 도 DOM 도 없다(저장도 바꿔 끼운다).
 * ============================================================================
 */

type Reply =
  | "THROW"
  | {
      status: number;
      headers?: Record<string, string>;
      json?: unknown;
      jsonThrows?: boolean;
      blobThrows?: boolean;
    };

const BYTES = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);

function fakeFetch(reply: Reply): { fetchImpl: QuoteIssueFetch; calls: { url: string; method: string }[] } {
  const calls: { url: string; method: string }[] = [];
  const fetchImpl: QuoteIssueFetch = async (url, init) => {
    calls.push({ url, method: init.method });
    if (reply === "THROW") throw new TypeError("Failed to fetch");
    return {
      ok: reply.status >= 200 && reply.status < 300,
      status: reply.status,
      headers: new Headers(reply.headers ?? {}),
      blob: async () => {
        if (reply.blobThrows) throw new TypeError("network error");
        return new Blob([BYTES]);
      },
      json: async () => {
        if (reply.jsonThrows) throw new SyntaxError("Unexpected token <");
        return reply.json;
      },
    };
  };
  return { fetchImpl, calls };
}

const FILE_NAME = "견적서_DSS 2026-077_ICD.xlsx";

const RESULT: QuoteIssueResult = {
  archive: { status: "saved", relativePath: `2026/견적서/${FILE_NAME}`, multipleFolderMatches: false },
  attachment: { status: "replaced", displacedCount: 1 },
};

function issued(result: QuoteIssueResult | string | null = RESULT): Reply {
  const headers: Record<string, string> = { "Content-Disposition": quoteContentDisposition(FILE_NAME) };
  if (result !== null) headers[QUOTE_ISSUE_RESULT_HEADER] = typeof result === "string" ? result : encodeQuoteIssueResult(result);
  return { status: 200, headers };
}

describe("발행 통로 부르기", () => {
  test("🔴 POST 로 부른다 — 부작용이 있는 통로라 링크(GET)가 아니다", async () => {
    const { fetchImpl, calls } = fakeFetch(issued());
    await downloadIssuedQuote("q-1", fetchImpl);
    assert.deepEqual(calls, [{ url: "/api/quotes/q-1/issue", method: "POST" }]);
    assert.equal(quoteIssueUrl("a/b"), "/api/quotes/a%2Fb/issue");
  });

  test("성공 — 파일 · 한글 이름 · 결과를 푼다", async () => {
    const { fetchImpl } = fakeFetch(issued());
    const outcome = await downloadIssuedQuote("q-1", fetchImpl);
    assert.equal(outcome.ok, true);
    if (!outcome.ok) return;
    assert.equal(outcome.fileName, FILE_NAME);
    assert.deepEqual(outcome.result, RESULT);
    assert.deepEqual(new Uint8Array(await outcome.blob.arrayBuffer()), BYTES);
  });

  test("🔴 결과 헤더가 없으면 결과만 null — 파일은 그대로 받는다", async () => {
    const { fetchImpl } = fakeFetch(issued(null));
    const outcome = await downloadIssuedQuote("q-1", fetchImpl);
    assert.equal(outcome.ok && outcome.result, null);
    assert.equal(outcome.ok && outcome.fileName, FILE_NAME);
  });

  test("🔴 결과 헤더가 이상하면(잘림 · 모양이 다름) 결과만 null", async () => {
    for (const odd of ["%7B%22archive", encodeURIComponent(JSON.stringify({ archive: { status: "saved" }, attachment: {} }))]) {
      const { fetchImpl } = fakeFetch(issued(odd));
      const outcome = await downloadIssuedQuote("q-1", fetchImpl);
      assert.equal(outcome.ok, true);
      assert.equal(outcome.ok && outcome.result, null, odd);
    }
  });

  test("이름을 싣지 않은 응답이면 기본 이름", async () => {
    const { fetchImpl } = fakeFetch({ status: 200, headers: { [QUOTE_ISSUE_RESULT_HEADER]: encodeQuoteIssueResult(RESULT) } });
    const outcome = await downloadIssuedQuote("q-1", fetchImpl);
    assert.equal(outcome.ok && outcome.fileName, QUOTE_ISSUE_FALLBACK_FILE_NAME);
  });

  test("실패 JSON — 서버의 문장 · 상태 · 코드를 그대로", async () => {
    const { fetchImpl } = fakeFetch({ status: 404, json: { error: "수기 견적서 엑셀이 붙어 있지 않습니다.", code: "EXCEL_NOT_ATTACHED" } });
    assert.deepEqual(await downloadIssuedQuote("q-1", fetchImpl), {
      ok: false,
      reason: "수기 견적서 엑셀이 붙어 있지 않습니다.",
      status: 404,
      code: "EXCEL_NOT_ATTACHED",
    });
  });

  test("🔴 JSON 이 아닌 실패(프록시 · 게이트웨이)도 던지지 않는다 — 상태를 붙인 기본 문장", async () => {
    const { fetchImpl } = fakeFetch({ status: 502, jsonThrows: true });
    const outcome = await downloadIssuedQuote("q-1", fetchImpl);
    assert.equal(outcome.ok, false);
    if (outcome.ok) return;
    assert.match(outcome.reason, /HTTP 502/);
    assert.equal(outcome.status, 502);
    assert.equal(outcome.code, null);
  });

  test("실패 JSON 에 문장이 없으면 기본 문장", async () => {
    const { fetchImpl } = fakeFetch({ status: 500, json: { code: "RENDER_FAILED" } });
    const outcome = await downloadIssuedQuote("q-1", fetchImpl);
    assert.equal(!outcome.ok && outcome.code, "RENDER_FAILED");
    assert.match(outcome.ok ? "" : outcome.reason, /HTTP 500/);
  });

  test("🔴 네트워크가 끊겨도 던지지 않는다", async () => {
    const { fetchImpl } = fakeFetch("THROW");
    const outcome = await downloadIssuedQuote("q-1", fetchImpl);
    assert.equal(outcome.ok, false);
    assert.equal(outcome.ok ? "x" : outcome.status, null);
    assert.match(outcome.ok ? "" : outcome.reason, /서버에 닿지 못했습니다/);
  });

  test("몸통을 받다 끊기면 실패로 알린다 — 서버 쪽은 이미 됐을 수 있다고", async () => {
    const { fetchImpl } = fakeFetch({ ...(issued() as { status: number }), blobThrows: true });
    const outcome = await downloadIssuedQuote("q-1", fetchImpl);
    assert.equal(outcome.ok, false);
    assert.match(outcome.ok ? "" : outcome.reason, /이미 반영됐을 수 있습니다/);
  });
});

describe("[견적서 받기] 한 번 — runQuoteIssue", () => {
  function saver() {
    const saved: { size: number; fileName: string }[] = [];
    return { saved, save: (blob: Blob, fileName: string) => void saved.push({ size: blob.size, fileName }) };
  }

  test("🔴 저장하지 않은 변경이 있으면 발행 통로를 부르지 않는다 — 저장도 하지 않는다", async () => {
    const { fetchImpl, calls } = fakeFetch(issued());
    const { saved, save } = saver();
    const outcome = await runQuoteIssue({ quoteId: "q-1", hasUnsavedChanges: true, fetchImpl, save });
    assert.equal(calls.length, 0, "옛 내용이 공유폴더로 간다");
    assert.equal(saved.length, 0);
    assert.equal(outcome.kind, "BLOCKED_UNSAVED_CHANGES");
    assert.deepEqual(outcome.lines, [{ text: QUOTE_ISSUE_UNSAVED_CHANGES_TEXT, tone: "warning" }]);
  });

  test("받으면 서버가 정한 이름으로 저장하고 결과 줄을 돌려준다", async () => {
    const { fetchImpl, calls } = fakeFetch(issued());
    const { saved, save } = saver();
    const outcome = await runQuoteIssue({ quoteId: "q-1", hasUnsavedChanges: false, fetchImpl, save });
    assert.equal(calls.length, 1);
    assert.deepEqual(saved, [{ size: BYTES.length, fileName: FILE_NAME }]);
    assert.equal(outcome.kind, "ISSUED");
    assert.deepEqual(outcome.lines, quoteIssueNoticeLines(RESULT));
  });

  test("결과를 못 읽어도 저장하고, 확인하지 못했다고 알린다", async () => {
    const { fetchImpl } = fakeFetch(issued(null));
    const { saved, save } = saver();
    const outcome = await runQuoteIssue({ quoteId: "q-1", hasUnsavedChanges: false, fetchImpl, save });
    assert.equal(saved.length, 1);
    assert.deepEqual(outcome.lines, [{ text: QUOTE_ISSUE_RESULT_UNKNOWN_TEXT, tone: "warning" }]);
  });

  test("받지 못했으면 저장하지 않고 까닭을 알린다", async () => {
    const { fetchImpl } = fakeFetch({ status: 403, json: { error: "이 작업을 수행할 권한이 없습니다.", code: "FORBIDDEN" } });
    const { saved, save } = saver();
    const outcome = await runQuoteIssue({ quoteId: "q-1", hasUnsavedChanges: false, fetchImpl, save });
    assert.equal(saved.length, 0);
    assert.equal(outcome.kind, "FAILED");
    assert.equal(outcome.kind === "FAILED" && outcome.code, "FORBIDDEN");
    assert.deepEqual(outcome.lines.map((line) => line.text), ["견적서 파일을 받지 못했습니다 — 이 작업을 수행할 권한이 없습니다."]);
  });

  test("브라우저 저장이 던져도 던지지 않는다 — 서버 결과 줄 앞에 그 사실", async () => {
    const { fetchImpl } = fakeFetch(issued());
    const outcome = await runQuoteIssue({
      quoteId: "q-1",
      hasUnsavedChanges: false,
      fetchImpl,
      save: () => {
        throw new Error("blocked");
      },
    });
    assert.equal(outcome.kind === "ISSUED" && outcome.fileSaved, false);
    assert.deepEqual(outcome.lines, [
      { text: QUOTE_ISSUE_FILE_NOT_SAVED_TEXT, tone: "warning" },
      ...quoteIssueNoticeLines(RESULT),
    ]);
  });
});

describe("받은 뒤 엑셀 칸을 다시 그려 오는가", () => {
  const base = { kind: "ISSUED" as const, fileName: FILE_NAME, fileSaved: true, lines: [] };
  const withAttachment = (attachment: QuoteIssueResult["attachment"]): QuoteIssueRunOutcome => ({
    ...base,
    result: { archive: { status: "disabled" }, attachment },
  });

  test("🔴 칸이 바뀌었으면(replaced) 다시 그린다 — 처음 올린 것(0)도", () => {
    assert.equal(shouldReloadSlotsAfterIssue(withAttachment({ status: "replaced", displacedCount: 0 })), true);
    assert.equal(shouldReloadSlotsAfterIssue(withAttachment({ status: "replaced", displacedCount: 2 })), true);
  });

  test("결과를 모르면 다시 그린다 — 바뀌었을 수 있다", () => {
    assert.equal(shouldReloadSlotsAfterIssue({ ...base, result: null }), true);
  });

  test("그대로 · 실패 · 엑셀 전용 · 막힘 · 받기 실패는 다시 그리지 않는다", () => {
    for (const attachment of [{ status: "unchanged" }, { status: "failed", reason: "x" }, { status: "skipped" }] as const) {
      assert.equal(shouldReloadSlotsAfterIssue(withAttachment(attachment)), false, attachment.status);
    }
    assert.equal(shouldReloadSlotsAfterIssue({ kind: "BLOCKED_UNSAVED_CHANGES", lines: [] }), false);
    assert.equal(
      shouldReloadSlotsAfterIssue({ kind: "FAILED", reason: "x", status: 500, code: null, lines: [] }),
      false
    );
  });
});
