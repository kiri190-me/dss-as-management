import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import type { StoredQuoteKind } from "@/lib/validation/quote-input";
import QuoteSavePdfNotice, { QUOTE_SAVE_PDF_RUNNING_TEXT } from "./QuoteSavePdfNotice";
import {
  QUOTE_SAVE_PDF_CREATED_TEXT,
  QUOTE_SAVE_PDF_NOT_VISIBLE_TEXT,
  QUOTE_SAVE_PDF_SAVED_TEXT,
  runQuoteSavePdfConvert,
} from "./quote-save-pdf-convert";

/**
 * ============================================================================
 * [저장] 뒤 PDF 변환 알림 칸 — **실제로 그려 보고 결과로 잰다** (2026-10-08)
 * ============================================================================
 * 흐름(quote-save-pdf-convert.ts)이 낸 줄을 그대로 넣어 그려 본다 — 글자만 맞춰 보는 것이
 * 아니라 **그 흐름의 산출물**이 화면에 어떻게 서는지를 본다.
 *
 * 🔴 폼 자체(QuoteEditForm)는 서버 액션을 부르는 클라이언트 컴포넌트라 이 환경에서 그릴 수
 * 없다 — 그쪽은 이 저장소 관례대로 원본을 글자로 읽는다(quote-save-pdf-screens.test.ts).
 * ============================================================================
 */

const QUOTE_ID = "11111111-2222-3333-4444-555555555555";
const FOLDER = "21. 2026 내자견적서/DSS 2026-089 가나상사 MODEL-X1 S456 전원 불량";
const SOURCE = "DSS 2026-089 가나상사 MODEL-X1 S456 전원 불량.xlsx";
const SUBJECT = { kind: "DOMESTIC" as StoredQuoteKind, isExcelOnly: false };

/** 통로 응답을 차례로 내는 가짜 fetch — 마지막 답은 되풀이한다. */
function run(answers: readonly Record<string, unknown>[]) {
  let at = 0;
  return runQuoteSavePdfConvert({
    quoteId: QUOTE_ID,
    subject: SUBJECT,
    env: {
      fetchImpl: async () => {
        const body = answers[Math.min(at, answers.length - 1)];
        at += 1;
        return { ok: true, status: 200, json: async () => body };
      },
      openLink: () => {},
      delay: async () => {},
    },
  });
}

const FOUND = { status: "found", relativePath: FOLDER, sourceName: SOURCE, pdfExists: false };

describe("그려 본다", () => {
  test("줄이 없으면 아무것도 그리지 않는다 — 건너뛴 장에는 칸이 서지 않는다", () => {
    assert.equal(renderToStaticMarkup(<QuoteSavePdfNotice lines={[]} />), "");
  });

  test("도는 중 — 흐릿한 칸, 「저장은 끝났다」가 먼저이고 [목록으로]가 없다", () => {
    const html = renderToStaticMarkup(
      <QuoteSavePdfNotice lines={[{ text: QUOTE_SAVE_PDF_RUNNING_TEXT, tone: "normal" }]} busy onLeave={() => {}} />
    );
    assert.ok(html.includes(QUOTE_SAVE_PDF_RUNNING_TEXT), html);
    assert.ok(html.startsWith(QUOTE_SAVE_PDF_RUNNING_TEXT.slice(0, 0)));
    assert.match(QUOTE_SAVE_PDF_RUNNING_TEXT, /^견적서는 저장되었습니다/);
    assert.ok(html.includes("bg-zinc-50"), html);
    assert.equal(html.includes("<button"), false, "도는 중에 [목록으로]가 있다");
    assert.ok(html.includes('role="status"'), html);
  });

  test("🔴 만들어졌다 — 흐름이 낸 줄 그대로 서고, 첫 줄이 「저장되었습니다」다", async () => {
    const outcome = await run([FOUND, { ...FOUND, pdfExists: true, pdfModifiedAt: "2026-10-08T01:00:00.000Z" }]);
    assert.equal(outcome.kind, "CREATED");
    const html = renderToStaticMarkup(<QuoteSavePdfNotice lines={outcome.lines} onLeave={() => {}} />);
    assert.ok(html.includes(QUOTE_SAVE_PDF_SAVED_TEXT), html);
    assert.ok(html.includes(QUOTE_SAVE_PDF_CREATED_TEXT), html);
    assert.ok(html.indexOf(QUOTE_SAVE_PDF_SAVED_TEXT) < html.indexOf(QUOTE_SAVE_PDF_CREATED_TEXT), html);
  });

  test("🔴 안 보인다 — 노란 칸 · 주의 색 · 곁에 [목록으로]", async () => {
    const outcome = await run([FOUND]);
    assert.equal(outcome.kind, "NOT_VISIBLE");
    const html = renderToStaticMarkup(<QuoteSavePdfNotice lines={outcome.lines} onLeave={() => {}} />);
    assert.ok(html.includes("bg-amber-50"), html);
    assert.ok(html.includes(QUOTE_SAVE_PDF_NOT_VISIBLE_TEXT), html);
    // 주의 줄은 주의 색이다(QuoteIssueNoticeLines 의 결).
    assert.ok(html.includes("text-amber-700"), html);
    assert.ok(html.includes("<button"), html);
    assert.ok(html.includes(">목록으로</button>"), html);
  });

  test("[목록으로]를 넘기지 않으면 단추를 그리지 않는다", async () => {
    const outcome = await run([FOUND]);
    const html = renderToStaticMarkup(<QuoteSavePdfNotice lines={outcome.lines} />);
    assert.equal(html.includes("<button"), false, html);
  });

  test("🔴 그려진 글자에 폴더 이름 · 파일 이름이 한 글자도 없다", async () => {
    for (const answers of [
      [FOUND],
      [FOUND, { ...FOUND, pdfExists: true, pdfModifiedAt: "2026-10-08T01:00:00.000Z" }],
      [{ status: "failed", reason: "공유폴더를 읽지 못했습니다." }],
    ]) {
      const outcome = await run(answers);
      const html = renderToStaticMarkup(<QuoteSavePdfNotice lines={outcome.lines} onLeave={() => {}} />);
      for (const piece of ["가나상사", "MODEL-X1", "S456", "내자견적서", ".xlsx", ".pdf", QUOTE_ID]) {
        assert.equal(html.includes(piece), false, `그려진 글자에 「${piece}」가 있다 — ${html}`);
      }
    }
  });
});
