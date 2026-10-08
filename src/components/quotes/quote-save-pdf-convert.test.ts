import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

import {
  QUOTE_FOLDER_XLSX2PDF_LINK_PREFIX,
  parseQuoteFolderXlsx2PdfLink,
} from "@/lib/domain/quote-folder-xlsx2pdf-link";
import type { StoredQuoteKind } from "@/lib/validation/quote-input";
import {
  QUOTE_SAVE_PDF_CHECK_DELAYS_MS,
  QUOTE_SAVE_PDF_CREATED_TEXT,
  QUOTE_SAVE_PDF_DISABLED_TEXT,
  QUOTE_SAVE_PDF_FOLDER_FAILED_TEXT,
  QUOTE_SAVE_PDF_FOLDER_MULTIPLE_TEXT,
  QUOTE_SAVE_PDF_FOLDER_NOT_FOUND_TEXT,
  QUOTE_SAVE_PDF_LINK_FAILED_TEXT,
  QUOTE_SAVE_PDF_NOT_VISIBLE_TEXT,
  QUOTE_SAVE_PDF_NO_SOURCE_TEXT,
  QUOTE_SAVE_PDF_OPEN_FAILED_TEXT,
  QUOTE_SAVE_PDF_SAVED_TEXT,
  QUOTE_SAVE_PDF_STALE_TEXT,
  QUOTE_SAVE_PDF_TOTAL_WAIT_MS,
  isFreshQuoteSavePdf,
  quoteArchivePdfUrl,
  runQuoteSavePdfConvert,
} from "./quote-save-pdf-convert";

/**
 * ============================================================================
 * [저장] 뒤 엑셀 → PDF — 값으로 본다 (2026-10-08)
 * ============================================================================
 * 네트워크도 DOM 도 없이, 바꿔 끼운 fetch · 주소 열기 · 시계로 돌린다. 🔴 **브라우저를 열지
 * 않는다** — 도우미가 실제로 Excel 을 부르는지는 사람이 눈으로 확인할 몫이다.
 *
 * 여기서 못 박는 것:
 *  · 🔴 건너뛰는 장(엑셀 전용 · 앱 양식 없는 종류)은 **통로를 부르지도 주소를 열지도 않는다**
 *  · 🔴 설정이 비면 **아무것도 하지 않는다**(주소를 열지 않는다)
 *  · 🔴 「전에도 있었다」와 「방금 생겼다」를 가른다
 *  · 🔴 확인은 **몇 번 보고 상한에서 멈춘다**
 *  · 🔴 줄에 경로 · 파일 이름이 **한 글자도** 없다
 *  · 🔴 저장을 막지 않는다 — 이 모듈에 저장 액션이 없다
 * ============================================================================
 */

const QUOTE_ID = "11111111-2222-3333-4444-555555555555";
/** 🔴 폴더 · 파일 이름에 공급처와 S/N 이 들어 있다 — 줄에 새면 안 된다. */
const FOLDER = "21. 2026 내자견적서/DSS 2026-089 가나상사 MODEL-X1 S456 전원 불량";
const SOURCE = "DSS 2026-089 가나상사 MODEL-X1 S456 전원 불량.xlsx";
const SECRET_PIECES = ["가나상사", "MODEL-X1", "S456", "21. 2026 내자견적서", ".xlsx", ".pdf"];

type Answer = Record<string, unknown>;

/** 통로 응답을 차례로 내는 가짜 fetch. 마지막 답은 끝까지 되풀이한다. */
function fakeFetch(answers: readonly Answer[]) {
  const urls: string[] = [];
  let at = 0;
  const fetchImpl = async (url: string) => {
    urls.push(url);
    const body = answers[Math.min(at, answers.length - 1)];
    at += 1;
    return { ok: true, status: 200, json: async () => body };
  };
  return { fetchImpl, urls };
}

function found(extra: Answer = {}): Answer {
  return { status: "found", relativePath: FOLDER, sourceName: SOURCE, pdfExists: false, ...extra };
}

function harness(answers: readonly Answer[]) {
  const { fetchImpl, urls } = fakeFetch(answers);
  const opened: string[] = [];
  const waits: number[] = [];
  return {
    urls,
    opened,
    waits,
    env: {
      fetchImpl,
      openLink: (link: string) => opened.push(link),
      delay: async (ms: number) => {
        waits.push(ms);
      },
    },
  };
}

const SUBJECT = { kind: "DOMESTIC" as StoredQuoteKind, isExcelOnly: false };

describe("🔴 건너뛰는 장은 건너뛴다 — 저장 쪽과 같은 판정", () => {
  test("엑셀 전용 — 통로를 부르지도, 주소를 열지도 않는다", async () => {
    const h = harness([found()]);
    const outcome = await runQuoteSavePdfConvert({
      quoteId: QUOTE_ID,
      subject: { kind: "DOMESTIC", isExcelOnly: true },
      env: h.env,
    });
    assert.equal(outcome.kind, "SKIPPED");
    assert.deepEqual(outcome.lines, []);
    assert.deepEqual(h.urls, []);
    assert.deepEqual(h.opened, []);
    assert.equal(outcome.checks, 0);
  });

  test("앱 양식이 없는 종류 — 같은 자물쇠에 걸린다", async () => {
    const h = harness([found()]);
    const outcome = await runQuoteSavePdfConvert({
      quoteId: QUOTE_ID,
      subject: { kind: "FUTURE_KIND" as StoredQuoteKind, isExcelOnly: false },
      env: h.env,
    });
    assert.equal(outcome.kind, "SKIPPED");
    assert.deepEqual(h.urls, []);
    assert.deepEqual(h.opened, []);
  });
});

describe("🔴 설정이 비면 아무것도 하지 않는다", () => {
  test("disabled — 묻고 끝낸다. 주소를 열지 않는다", async () => {
    const h = harness([{ status: "disabled" }]);
    const outcome = await runQuoteSavePdfConvert({ quoteId: QUOTE_ID, subject: SUBJECT, env: h.env });
    assert.equal(outcome.kind, "DISABLED");
    assert.deepEqual(h.opened, []);
    assert.deepEqual(h.waits, []);
    assert.equal(outcome.checks, 0);
    assert.deepEqual(
      outcome.lines.map((line) => line.text),
      [QUOTE_SAVE_PDF_SAVED_TEXT, QUOTE_SAVE_PDF_DISABLED_TEXT]
    );
  });
});

describe("폴더 · 원본이 없을 때 — 주소를 열지 않는다", () => {
  for (const [status, text, kind] of [
    ["not-found", QUOTE_SAVE_PDF_FOLDER_NOT_FOUND_TEXT, "FOLDER_NOT_FOUND"],
    ["multiple", QUOTE_SAVE_PDF_FOLDER_MULTIPLE_TEXT, "FOLDER_MULTIPLE"],
    ["no-source", QUOTE_SAVE_PDF_NO_SOURCE_TEXT, "NO_SOURCE"],
  ] as const) {
    test(`${status} — ${kind}`, async () => {
      const h = harness([{ status }]);
      const outcome = await runQuoteSavePdfConvert({ quoteId: QUOTE_ID, subject: SUBJECT, env: h.env });
      assert.equal(outcome.kind, kind);
      assert.deepEqual(h.opened, []);
      assert.equal(outcome.lines[0].text, QUOTE_SAVE_PDF_SAVED_TEXT);
      assert.equal(outcome.lines[1].text, text);
    });
  }

  test("통로가 실패하면 서버가 준 짧은 사유를 곁들인다", async () => {
    const h = harness([{ status: "failed", reason: "공유폴더가 느려 목록을 읽지 못했습니다(잠시 뒤 다시 시도하세요)." }]);
    const outcome = await runQuoteSavePdfConvert({ quoteId: QUOTE_ID, subject: SUBJECT, env: h.env });
    assert.equal(outcome.kind, "FOLDER_FAILED");
    assert.deepEqual(h.opened, []);
    assert.equal(outcome.lines[1].text, QUOTE_SAVE_PDF_FOLDER_FAILED_TEXT);
    assert.match(outcome.lines[2].text, /공유폴더가 느려/);
  });

  test("요청 자체가 터져도 던지지 않는다", async () => {
    const outcome = await runQuoteSavePdfConvert({
      quoteId: QUOTE_ID,
      subject: SUBJECT,
      env: {
        fetchImpl: async () => {
          throw new Error("네트워크");
        },
        openLink: () => {},
        delay: async () => {},
      },
    });
    assert.equal(outcome.kind, "FOLDER_FAILED");
    // 🔴 던진 오류의 message 가 줄에 실리지 않는다.
    assert.equal(
      outcome.lines.some((line) => line.text.includes("네트워크 상태를 확인")),
      true
    );
  });
});

describe("주소를 연다 — 규칙이 만든 그 주소", () => {
  test("통로가 준 폴더 · 이름으로 변환 주소를 만들어 연다", async () => {
    const h = harness([found()]);
    await runQuoteSavePdfConvert({ quoteId: QUOTE_ID, subject: SUBJECT, env: h.env });
    assert.equal(h.opened.length, 1);
    assert.ok(h.opened[0].startsWith(QUOTE_FOLDER_XLSX2PDF_LINK_PREFIX));
    assert.equal(parseQuoteFolderXlsx2PdfLink(h.opened[0]), `${FOLDER}/${SOURCE}`);
    assert.equal(h.urls[0], quoteArchivePdfUrl(QUOTE_ID));
  });

  test("🔴 `.xlsx` 가 아니면 주소를 지어내지 않는다", async () => {
    const h = harness([found({ sourceName: "손으로 만든 견적서.xlsm" })]);
    const outcome = await runQuoteSavePdfConvert({ quoteId: QUOTE_ID, subject: SUBJECT, env: h.env });
    assert.equal(outcome.kind, "LINK_FAILED");
    assert.deepEqual(h.opened, []);
    assert.equal(outcome.lines[1].text, QUOTE_SAVE_PDF_LINK_FAILED_TEXT);
  });

  test("브라우저가 주소를 못 열면 거기서 끝난다 — 확인하지 않는다", async () => {
    const { fetchImpl } = fakeFetch([found()]);
    const outcome = await runQuoteSavePdfConvert({
      quoteId: QUOTE_ID,
      subject: SUBJECT,
      env: {
        fetchImpl,
        openLink: () => {
          throw new Error("막혔다");
        },
        delay: async () => {},
      },
    });
    assert.equal(outcome.kind, "OPEN_FAILED");
    assert.equal(outcome.checks, 0);
    assert.equal(outcome.lines[1].text, QUOTE_SAVE_PDF_OPEN_FAILED_TEXT);
  });
});

describe("🔴 「전에도 있었다」와 「방금 생겼다」를 가른다", () => {
  test("순수 판정 — 네 가지 경우", () => {
    // 전에 없었다 → 생겼다.
    assert.equal(
      isFreshQuoteSavePdf({ pdfExists: false, pdfModifiedAtMs: null }, { pdfExists: true, pdfModifiedAtMs: 100 }),
      true
    );
    // 전에도 있었고 시각이 그대로다 → 아니다.
    assert.equal(
      isFreshQuoteSavePdf({ pdfExists: true, pdfModifiedAtMs: 100 }, { pdfExists: true, pdfModifiedAtMs: 100 }),
      false
    );
    // 전에도 있었는데 더 뒤다 → 생겼다.
    assert.equal(
      isFreshQuoteSavePdf({ pdfExists: true, pdfModifiedAtMs: 100 }, { pdfExists: true, pdfModifiedAtMs: 101 }),
      true
    );
    // 🔴 잴 수 없으면 단언하지 않는다.
    assert.equal(
      isFreshQuoteSavePdf({ pdfExists: true, pdfModifiedAtMs: null }, { pdfExists: true, pdfModifiedAtMs: 200 }),
      false
    );
    assert.equal(
      isFreshQuoteSavePdf({ pdfExists: true, pdfModifiedAtMs: 100 }, { pdfExists: true, pdfModifiedAtMs: null }),
      false
    );
    assert.equal(isFreshQuoteSavePdf({ pdfExists: true, pdfModifiedAtMs: 1 }, { pdfExists: false, pdfModifiedAtMs: null }), false);
  });

  test("없던 PDF 가 생기면 CREATED — 첫 확인에서 멈춘다", async () => {
    const h = harness([found(), found({ pdfExists: true, pdfModifiedAt: "2026-10-08T01:00:00.000Z" })]);
    const outcome = await runQuoteSavePdfConvert({ quoteId: QUOTE_ID, subject: SUBJECT, env: h.env });
    assert.equal(outcome.kind, "CREATED");
    assert.equal(outcome.checks, 1);
    assert.deepEqual(h.waits, [QUOTE_SAVE_PDF_CHECK_DELAYS_MS[0]]);
    assert.equal(outcome.lines[1].text, QUOTE_SAVE_PDF_CREATED_TEXT);
  });

  test("🔴 전에 있던 PDF 가 그대로면 CREATED 가 아니다 — STALE", async () => {
    const before = { pdfExists: true, pdfModifiedAt: "2026-10-07T01:00:00.000Z" };
    const h = harness([found(before), found(before)]);
    const outcome = await runQuoteSavePdfConvert({ quoteId: QUOTE_ID, subject: SUBJECT, env: h.env });
    assert.equal(outcome.kind, "STALE");
    assert.equal(outcome.lines[1].text, QUOTE_SAVE_PDF_STALE_TEXT);
    // 상한까지 다 봤다 — 늦게 끝날 수도 있으므로 한 번 보고 접지 않는다.
    assert.equal(outcome.checks, QUOTE_SAVE_PDF_CHECK_DELAYS_MS.length);
  });

  test("🔴 전에 있던 PDF 가 **덮어써지면** CREATED", async () => {
    const h = harness([
      found({ pdfExists: true, pdfModifiedAt: "2026-10-07T01:00:00.000Z" }),
      found({ pdfExists: true, pdfModifiedAt: "2026-10-07T01:00:00.000Z" }),
      found({ pdfExists: true, pdfModifiedAt: "2026-10-08T01:00:00.000Z" }),
    ]);
    const outcome = await runQuoteSavePdfConvert({ quoteId: QUOTE_ID, subject: SUBJECT, env: h.env });
    assert.equal(outcome.kind, "CREATED");
    assert.equal(outcome.checks, 2);
  });

  test("🔴 수정 시각을 못 읽으면 「만들었다」고 말하지 않는다", async () => {
    const h = harness([found({ pdfExists: true }), found({ pdfExists: true })]);
    const outcome = await runQuoteSavePdfConvert({ quoteId: QUOTE_ID, subject: SUBJECT, env: h.env });
    assert.equal(outcome.kind, "STALE");
  });
});

describe("🔴 확인은 상한에서 멈춘다", () => {
  test("끝까지 안 보이면 NOT_VISIBLE — 확인 횟수와 기다린 시간이 상한 그대로다", async () => {
    const h = harness([found()]);
    const outcome = await runQuoteSavePdfConvert({ quoteId: QUOTE_ID, subject: SUBJECT, env: h.env });
    assert.equal(outcome.kind, "NOT_VISIBLE");
    assert.equal(outcome.checks, QUOTE_SAVE_PDF_CHECK_DELAYS_MS.length);
    assert.deepEqual(h.waits, [...QUOTE_SAVE_PDF_CHECK_DELAYS_MS]);
    // 기준 한 번 + 확인 네 번 = 다섯 번 물었다. 주소는 한 번만 열었다.
    assert.equal(h.urls.length, 1 + QUOTE_SAVE_PDF_CHECK_DELAYS_MS.length);
    assert.equal(h.opened.length, 1);
    assert.equal(outcome.lines[1].text, QUOTE_SAVE_PDF_NOT_VISIBLE_TEXT);
  });

  test("상한 상수는 간격의 합이다 — 둘이 어긋나지 않게", () => {
    assert.equal(
      QUOTE_SAVE_PDF_CHECK_DELAYS_MS.reduce((sum, ms) => sum + ms, 0),
      QUOTE_SAVE_PDF_TOTAL_WAIT_MS
    );
    assert.ok(QUOTE_SAVE_PDF_CHECK_DELAYS_MS.length >= 2, "한 번만 보고 단정한다");
    assert.ok(QUOTE_SAVE_PDF_TOTAL_WAIT_MS <= 15_000, "사람을 너무 오래 세워 둔다");
  });

  test("확인 도중 한 번 못 읽어도 그만두지 않는다 — 다음 차례에 다시 본다", async () => {
    const h = harness([
      found(),
      { status: "failed", reason: "공유폴더가 느립니다" },
      found({ pdfExists: true, pdfModifiedAt: "2026-10-08T01:00:00.000Z" }),
    ]);
    const outcome = await runQuoteSavePdfConvert({ quoteId: QUOTE_ID, subject: SUBJECT, env: h.env });
    assert.equal(outcome.kind, "CREATED");
    assert.equal(outcome.checks, 2);
  });

  test("모양이 다른 응답은 읽지 않는다 — 끝까지 가고 단정하지 않는다", async () => {
    const h = harness([found(), { status: "found", relativePath: 7, sourceName: SOURCE, pdfExists: true }]);
    const outcome = await runQuoteSavePdfConvert({ quoteId: QUOTE_ID, subject: SUBJECT, env: h.env });
    assert.equal(outcome.kind, "NOT_VISIBLE");
  });
});

describe("🔴 줄에 경로가 한 글자도 없다", () => {
  const cases: [string, Answer[]][] = [
    ["found → 안 보임", [found()]],
    ["found → 만들어짐", [found(), found({ pdfExists: true, pdfModifiedAt: "2026-10-08T01:00:00.000Z" })]],
    ["전에도 있었다", [found({ pdfExists: true, pdfModifiedAt: "2026-10-07T01:00:00.000Z" })]],
    ["원본이 xlsx 가 아니다", [found({ sourceName: `${FOLDER}.xlsm` })]],
    ["폴더 없음", [{ status: "not-found" }]],
    ["여럿", [{ status: "multiple" }]],
    ["원본 없음", [{ status: "no-source" }]],
    ["꺼져 있음", [{ status: "disabled" }]],
    ["실패", [{ status: "failed", reason: "공유폴더를 읽지 못했습니다." }]],
  ];

  for (const [name, answers] of cases) {
    test(name, async () => {
      const h = harness(answers);
      const outcome = await runQuoteSavePdfConvert({ quoteId: QUOTE_ID, subject: SUBJECT, env: h.env });
      const text = outcome.lines.map((line) => line.text).join("\n");
      for (const piece of SECRET_PIECES) {
        assert.equal(text.includes(piece), false, `${name}: 줄에 「${piece}」가 들어 있다 — ${text}`);
      }
      // 견적서 id 도 줄에 들어가지 않는다.
      assert.equal(text.includes(QUOTE_ID), false, text);
      // 🔴 결과마다 「저장되었습니다」가 첫 줄이다 — 건너뛴 장만 줄이 없다.
      assert.equal(outcome.lines[0].text, QUOTE_SAVE_PDF_SAVED_TEXT, name);
    });
  }
});

describe("🔴 저장을 막지 않는다 — 이 모듈은 저장을 모른다", () => {
  const source = readFileSync(new URL("./quote-save-pdf-convert.ts", import.meta.url), "utf8");
  /** 주석을 뺀 코드 — 머리말이 까닭을 설명하느라 적은 이름(archiveQuoteDocumentOnSave …)에 걸리지 않게. */
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  test("서버 액션을 가져오지 않는다 · 저장 팝업을 부르지 않는다", () => {
    for (const forbidden of [
      /server\/actions/,
      /createQuoteAction/,
      /updateQuoteAction/,
      /showSavePopup/,
      /archiveQuoteDocumentOnSave/,
    ]) {
      assert.equal(forbidden.test(code), false, `저장을 건드리는 흔적: ${forbidden}`);
    }
  });

  test("🔴 숨은 iframe 을 베껴 적지 않고 가져다 쓴다", () => {
    assert.equal(/document\.createElement\("iframe"\)/.test(source), false, "여섯 번째 사본이 생겼다");
    assert.ok(source.includes('import { openLinkInHiddenFrame, type QuoteFolderFetch } from "./quote-folder-open";'));
  });

  test("🔴 건너뛰는 판정을 베껴 적지 않고 가져다 쓴다", () => {
    assert.ok(source.includes('from "@/lib/domain/quote-document-support"'));
    assert.equal(/APP_TEMPLATE_KINDS|"OVERHAUL"|"CABLE"/.test(source), false, "종류 목록을 또 적었다");
  });
});
