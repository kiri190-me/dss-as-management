import { test } from "node:test";
import assert from "node:assert/strict";
import {
  uploadQuoteAttachment,
  uploadQueuedQuoteAttachments,
  type QuoteAttachmentFetch,
} from "./quote-attachment-upload";

/**
 * ============================================================================
 * 견적서 파일 올리기 — 응답을 읽는 법 · 새 견적서의 차례 올리기
 * ============================================================================
 * fetch 를 흉내 내어 올리기 통로(api/quotes/[id]/attachments/route.ts)의 응답 모양을
 * 그대로 돌려준다. 네트워크도 DB 도 없다.
 * ============================================================================
 */

type Call = { url: string; method: string; body: Blob };

function fakeFetch(responses: ({ status: number; json: unknown } | "THROW")[]): {
  fetchImpl: QuoteAttachmentFetch;
  calls: Call[];
} {
  const calls: Call[] = [];
  let index = 0;
  const fetchImpl: QuoteAttachmentFetch = async (url, init) => {
    calls.push({ url, method: init.method, body: init.body });
    const next = responses[index];
    index += 1;
    if (next === undefined) throw new Error("준비한 응답보다 많이 불렀다");
    if (next === "THROW") throw new TypeError("Failed to fetch");
    return {
      ok: next.status >= 200 && next.status < 300,
      status: next.status,
      json: async () => next.json,
    };
  };
  return { fetchImpl, calls };
}

function pdf(name = "결재.pdf"): File {
  return new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], name, { type: "application/pdf" });
}

function xlsx(name = "견적.xlsx"): File {
  return new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00])], name);
}

function created(id: string, displaced: string[] = []) {
  return {
    status: 201,
    json: {
      id,
      quoteId: "q-1",
      category: "SIGNED_QUOTE_PDF",
      originalFileName: "결재.pdf",
      fileSize: 4,
      checksumSha256: "x",
      uploadedAt: "2026-09-15T05:00:00.000Z",
      displacedAttachmentIds: displaced,
    },
  };
}

test("한 칸 올리기 — 칸 · 이름을 쿼리로, 본문은 파일 그대로 POST 한다", async () => {
  const { fetchImpl, calls } = fakeFetch([created("att-1")]);
  const file = pdf();
  const result = await uploadQuoteAttachment("q-1", "SIGNED_QUOTE_PDF", file, fetchImpl);

  assert.equal(calls.length, 1);
  const url = new URL(calls[0].url, "http://x");
  assert.equal(url.pathname, "/api/quotes/q-1/attachments");
  assert.equal(url.searchParams.get("category"), "SIGNED_QUOTE_PDF");
  assert.equal(url.searchParams.get("fileName"), "결재.pdf");
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].body, file, "multipart 가 아니라 파일 바이트 그대로다");

  assert.deepEqual(result, {
    ok: true,
    file: {
      id: "att-1",
      originalFileName: "결재.pdf",
      fileSize: 4,
      uploadedAt: "2026-09-15T05:00:00.000Z",
      uploadedByName: null,
    },
    replaced: false,
    // 응답에 공유폴더 칸이 없다(이 흉내 응답) — 해독하지 못한 것은 null 이다.
    archive: null,
  });
});

test("🔴 칸 교체로 옛 파일이 휴지통에 갔으면 replaced 다", async () => {
  const { fetchImpl } = fakeFetch([created("att-2", ["att-1"])]);
  const result = await uploadQuoteAttachment("q-1", "SIGNED_QUOTE_PDF", pdf(), fetchImpl);
  assert.equal(result.ok && result.replaced, true);
});

test("서버가 거절하면 그 문장 · 상태 · 코드를 돌려준다", async () => {
  const { fetchImpl } = fakeFetch([
    { status: 415, json: { error: "파일 내용이 확장자(.pdf)와 맞지 않습니다.", code: "CONTENT_MISMATCH" } },
  ]);
  const result = await uploadQuoteAttachment("q-1", "SIGNED_QUOTE_PDF", pdf(), fetchImpl);
  assert.deepEqual(result, {
    ok: false,
    reason: "파일 내용이 확장자(.pdf)와 맞지 않습니다.",
    status: 415,
    code: "CONTENT_MISMATCH",
  });
});

test("🔴 네트워크가 끊겨도 던지지 않는다 — 까닭을 돌려준다", async () => {
  const { fetchImpl } = fakeFetch(["THROW"]);
  const result = await uploadQuoteAttachment("q-1", "QUOTE_EXCEL", xlsx(), fetchImpl);
  assert.equal(result.ok, false);
  assert.equal(result.ok ? null : result.status, null);
  assert.match(result.ok ? "" : result.reason, /네트워크/);
});

test("올렸다는데 응답에 id 가 없으면 실패로 알린다 — 칸에 무엇을 그릴지 모른다", async () => {
  const { fetchImpl } = fakeFetch([{ status: 201, json: null }]);
  const result = await uploadQuoteAttachment("q-1", "QUOTE_EXCEL", xlsx(), fetchImpl);
  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.reason, /새로고침/);
});

test("새 견적서의 차례 올리기 — 칸 차례대로 하나씩, 진행을 알린다", async () => {
  const { fetchImpl, calls } = fakeFetch([created("att-1"), created("att-2")]);
  const progress: [number, number][] = [];
  const outcome = await uploadQueuedQuoteAttachments(
    "q-1",
    [
      { category: "SIGNED_QUOTE_PDF", file: pdf() },
      { category: "QUOTE_EXCEL", file: xlsx() },
    ],
    (current, total) => progress.push([current, total]),
    fetchImpl
  );
  assert.deepEqual(progress, [
    [1, 2],
    [2, 2],
  ]);
  assert.deepEqual(
    calls.map((call) => new URL(call.url, "http://x").searchParams.get("category")),
    ["SIGNED_QUOTE_PDF", "QUOTE_EXCEL"]
  );
  assert.equal(outcome.total, 2);
  assert.deepEqual(
    outcome.uploaded.map((item) => [item.category, item.file.id]),
    [
      ["SIGNED_QUOTE_PDF", "att-1"],
      ["QUOTE_EXCEL", "att-2"],
    ]
  );
  assert.deepEqual(outcome.failures, []);
});

test("🔴 권한 · 없는 견적서 · 휴지통(401 · 403 · 404 · 409)에 막히면 뒤의 파일은 보내지 않는다", async () => {
  const { fetchImpl, calls } = fakeFetch([
    { status: 409, json: { error: "휴지통에 있는 견적서에는 파일을 붙일 수 없습니다.", code: "QUOTE_IN_TRASH" } },
  ]);
  const outcome = await uploadQueuedQuoteAttachments(
    "q-1",
    [
      { category: "SIGNED_QUOTE_PDF", file: pdf() },
      { category: "QUOTE_EXCEL", file: xlsx() },
    ],
    () => {},
    fetchImpl
  );
  assert.equal(calls.length, 1, "막힌 뒤에 또 보냈다");
  assert.deepEqual(
    outcome.failures.map((failure) => [failure.category, failure.fileName, failure.reason]),
    [
      ["SIGNED_QUOTE_PDF", "결재.pdf", "휴지통에 있는 견적서에는 파일을 붙일 수 없습니다."],
      ["QUOTE_EXCEL", "견적.xlsx", "휴지통에 있는 견적서에는 파일을 붙일 수 없습니다."],
    ]
  );
});

test("한 파일의 형식 거절(415)은 뒤의 파일을 막지 않는다", async () => {
  const { fetchImpl, calls } = fakeFetch([
    { status: 415, json: { error: "결재 견적서는 PDF 로만 올릴 수 있습니다(.xlsx).", code: "EXTENSION_NOT_ALLOWED_FOR_CATEGORY" } },
    created("att-2"),
  ]);
  const outcome = await uploadQueuedQuoteAttachments(
    "q-1",
    [
      { category: "SIGNED_QUOTE_PDF", file: pdf() },
      { category: "QUOTE_EXCEL", file: xlsx() },
    ],
    () => {},
    fetchImpl
  );
  assert.equal(calls.length, 2);
  assert.deepEqual(outcome.uploaded.map((item) => item.category), ["QUOTE_EXCEL"]);
  assert.deepEqual(outcome.failures.map((failure) => failure.category), ["SIGNED_QUOTE_PDF"]);
});

// ── 결재 PDF 의 공유폴더 사본 결과 (2026-09-15 B1b · B1c) ─────────────────────
// 올리기 통로의 201 응답에 `archive` 칸이 있다 — 결재 PDF 면 [견적서 받기]와 같은 모양, 수기 엑셀
// 칸이면 null. 모양이 다르면 null 로 읽는다(화면이 「확인하지 못했다」고 알린다).

function createdWithArchive(archive: unknown) {
  const reply = created("att-9");
  return { ...reply, json: { ...reply.json, archive } };
}

test("🔴 결재 PDF 의 공유폴더 결과를 풀어 싣는다", async () => {
  const archive = { status: "saved", relativePath: "2026/견적서/DSS 2026-077 - 有印.pdf", multipleFolderMatches: true };
  const { fetchImpl } = fakeFetch([createdWithArchive(archive)]);
  const result = await uploadQuoteAttachment("q-1", "SIGNED_QUOTE_PDF", pdf(), fetchImpl);
  assert.deepEqual(result.ok && result.archive, archive);
});

test("수기 엑셀 칸이면 서버가 null 을 싣는다 — 그대로 null", async () => {
  const { fetchImpl } = fakeFetch([createdWithArchive(null)]);
  const result = await uploadQuoteAttachment("q-1", "QUOTE_EXCEL", xlsx(), fetchImpl);
  assert.equal(result.ok, true);
  assert.equal(result.ok && result.archive, null);
});

test("🔴 공유폴더 칸의 모양이 이상하면 null — 모르는 칸을 싣지 않는다", async () => {
  for (const odd of [{ status: "saved" }, { status: "exploded" }, "saved", 42]) {
    const { fetchImpl } = fakeFetch([createdWithArchive(odd)]);
    const result = await uploadQuoteAttachment("q-1", "SIGNED_QUOTE_PDF", pdf(), fetchImpl);
    assert.equal(result.ok, true, JSON.stringify(odd));
    assert.equal(result.ok && result.archive, null, JSON.stringify(odd));
  }
  const { fetchImpl } = fakeFetch([createdWithArchive({ status: "failed", reason: "공유폴더에 쓸 권한이 없습니다.", path: "C:/x" })]);
  const result = await uploadQuoteAttachment("q-1", "SIGNED_QUOTE_PDF", pdf(), fetchImpl);
  assert.deepEqual(result.ok && result.archive, { status: "failed", reason: "공유폴더에 쓸 권한이 없습니다." });
});

test("새 견적서의 차례 올리기도 올린 파일마다 공유폴더 결과를 싣는다", async () => {
  const { fetchImpl } = fakeFetch([createdWithArchive({ status: "disabled" }), createdWithArchive(null)]);
  const outcome = await uploadQueuedQuoteAttachments(
    "q-1",
    [
      { category: "SIGNED_QUOTE_PDF", file: pdf() },
      { category: "QUOTE_EXCEL", file: xlsx() },
    ],
    () => {},
    fetchImpl
  );
  assert.deepEqual(
    outcome.uploaded.map((item) => [item.category, item.archive]),
    [
      ["SIGNED_QUOTE_PDF", { status: "disabled" }],
      ["QUOTE_EXCEL", null],
    ]
  );
});

test("올릴 것이 없으면 아무것도 부르지 않는다", async () => {
  const { fetchImpl, calls } = fakeFetch([]);
  const outcome = await uploadQueuedQuoteAttachments("q-1", [], () => assert.fail("진행을 알렸다"), fetchImpl);
  assert.equal(calls.length, 0);
  assert.deepEqual(outcome, { total: 0, uploaded: [], failures: [] });
});
