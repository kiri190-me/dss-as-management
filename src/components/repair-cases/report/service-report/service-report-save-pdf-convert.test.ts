import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

import {
  QUOTE_SAVE_PDF_DONE_POPUP_TEXT,
  QUOTE_SAVE_PDF_RUNNING_POPUP_TEXT,
} from "@/components/quotes/quote-save-pdf-convert";
import { parseQuoteFolderXlsx2PdfLink } from "@/lib/domain/quote-folder-xlsx2pdf-link";
import {
  SERVICE_REPORT_SAVE_PDF_ARCHIVE_FAILED_TEXT,
  SERVICE_REPORT_SAVE_PDF_CATEGORY_BLOCKED_TEXT,
  SERVICE_REPORT_SAVE_PDF_CHECK_DELAYS_MS,
  SERVICE_REPORT_SAVE_PDF_CREATED_TEXT,
  SERVICE_REPORT_SAVE_PDF_DISABLED_TEXT,
  SERVICE_REPORT_SAVE_PDF_DONE_POPUP_TEXT,
  SERVICE_REPORT_SAVE_PDF_FOLDER_FAILED_TEXT,
  SERVICE_REPORT_SAVE_PDF_LINK_FAILED_TEXT,
  SERVICE_REPORT_SAVE_PDF_MULTIPLE_TEXT,
  SERVICE_REPORT_SAVE_PDF_NOT_VISIBLE_TEXT,
  SERVICE_REPORT_SAVE_PDF_NO_FOLDER_TEXT,
  SERVICE_REPORT_SAVE_PDF_NO_SOURCE_TEXT,
  SERVICE_REPORT_SAVE_PDF_OPEN_FAILED_TEXT,
  SERVICE_REPORT_SAVE_PDF_RUNNING_POPUP_TEXT,
  SERVICE_REPORT_SAVE_PDF_SAVED_TEXT,
  SERVICE_REPORT_SAVE_PDF_STALE_TEXT,
  SERVICE_REPORT_SAVE_PDF_TOTAL_WAIT_MS,
  canLeaveAfterServiceReportSavePdf,
  runServiceReportSavePdfConvert,
} from "./service-report-save-pdf-convert";

/**
 * ============================================================================
 * 보고서 [저장] 뒤 연락서 폴더 · PDF — 값으로 본다 (2026-10-12)
 * ============================================================================
 * 네트워크도 DOM 도 없이, 바꿔 끼운 fetch · 주소 열기 · 시계로 돌린다. 🔴 **브라우저를
 * 열지 않는다** — 도우미가 실제로 Excel 을 부르는지는 사람이 눈으로 확인할 몫이다.
 *
 * 여기서 못 박는 것:
 *  · 🔴 **공유폴더가 꺼져 있어도 보고서는 저장된다** — 이 모듈에 저장 액션이 없고,
 *    꺼져 있으면 주소를 열지도 않으며, 결과는 「넘어가도 되는 것」이다
 *  · 🔴 **공유폴더 쓰기가 실패해도 보고서는 저장된다** — 첫 줄이 「보고서는 저장되었습니다.」
 *  · 🔴 연락서 폴더가 없으면 **만들지 않는다**(사람에게 만드는 길을 알린다)
 *  · 🔴 **PDF 가 안 보이면 「만들었다」고 단언하지 않는다**
 *  · 🔴 확인은 **몇 번 보고 상한에서 멈춘다**
 *  · 🔴 줄에 경로 · 파일 이름이 **한 글자도** 없다
 * ============================================================================
 */

const REPAIR_CASE_ID = "11111111-2222-3333-4444-555555555555";
const REPORT_ID = "99999999-8888-7777-6666-555555555555";
/** 🔴 폴더 · 파일 이름에 고객사명 · 모델 · S/N 이 들어 있다 — 줄에 새면 안 된다. */
const FOLDER = "D260908 INVENIA T2RCONT-AD2 WN3947 1802034 점검요청";
const CATEGORY = "검사 보고서";
const FILE = "검사보고서_T2RCONT-AD2_WN3947_1802034.xlsx";
const SECRET_PIECES = ["INVENIA", "T2RCONT-AD2", "WN3947", "1802034", "D260908", ".xlsx", ".pdf", CATEGORY];

type Answer = Record<string, unknown>;

function archived(extra: Answer = {}): Answer {
  return {
    status: "copied",
    fileName: FILE,
    categoryFolderName: CATEGORY,
    categoryFolderBlockedByFile: false,
    relativePath: `${FOLDER}/${CATEGORY}`,
    ...extra,
  };
}

function pdfFound(extra: Answer = {}): Answer {
  return { status: "found", sourceName: FILE, pdfName: FILE.replace(/\.xlsx$/, ".pdf"), pdfExists: false, ...extra };
}

/**
 * 꽂기(POST)는 한 번, PDF 확인(GET)은 차례로 — 마지막 답은 끝까지 되풀이한다.
 * 어느 통로인지는 주소로 가른다.
 */
function harness(archive: Answer, pdfAnswers: readonly Answer[] = [pdfFound()]) {
  const urls: string[] = [];
  const methods: string[] = [];
  const opened: string[] = [];
  const waits: number[] = [];
  let at = 0;
  return {
    urls,
    methods,
    opened,
    waits,
    env: {
      fetchImpl: async (url: string, init?: { method: string }) => {
        urls.push(url);
        methods.push(init?.method ?? "GET");
        if (!url.includes("/contact-folder/pdf")) {
          return { ok: true, status: 200, json: async () => archive };
        }
        const body = pdfAnswers[Math.min(at, pdfAnswers.length - 1)];
        at += 1;
        return { ok: true, status: 200, json: async () => body };
      },
      openLink: (link: string) => opened.push(link),
      delay: async (ms: number) => {
        waits.push(ms);
      },
    },
  };
}

function run(h: ReturnType<typeof harness>, onConvertStart?: () => void) {
  return runServiceReportSavePdfConvert({
    repairCaseId: REPAIR_CASE_ID,
    serviceReportId: REPORT_ID,
    onConvertStart,
    env: h.env,
  });
}

describe("🔴 보고서는 저장된 채다 — 이 모듈이 저장을 건드리지 않는다", () => {
  test("저장 액션 · 보고서 표를 부르지 않는다(원본 글자)", () => {
    const source = readFileSync(new URL("./service-report-save-pdf-convert.ts", import.meta.url), "utf8");
    for (const forbidden of [
      "createServiceReportAction",
      "updateServiceReportAction",
      "deleteServiceReportAction",
      "server/actions",
      "use server",
      "showSavePopup",
    ]) {
      assert.equal(source.includes(forbidden), false, `흐름이 저장 · 팝업을 직접 한다: ${forbidden}`);
    }
  });

  test("🔴 공유폴더가 꺼져 있으면 — 주소를 열지 않고, 넘어가도 된다", async () => {
    const h = harness({ status: "disabled" });
    const outcome = await run(h);
    assert.equal(outcome.kind, "DISABLED");
    assert.equal(canLeaveAfterServiceReportSavePdf(outcome.kind), true);
    assert.deepEqual(h.opened, []);
    assert.equal(outcome.checks, 0);
    // 통로는 꽂기 한 번뿐이다 — PDF 쪽은 묻지도 않는다.
    assert.equal(h.urls.length, 1);
    assert.deepEqual(h.methods, ["POST"]);
    assert.deepEqual(outcome.lines.map((line) => line.text), [
      SERVICE_REPORT_SAVE_PDF_SAVED_TEXT,
      SERVICE_REPORT_SAVE_PDF_DISABLED_TEXT,
    ]);
  });

  test("🔴 공유폴더 쓰기가 실패해도 — 첫 줄은 「보고서는 저장되었습니다.」", async () => {
    const h = harness({ status: "failed", reason: "공유폴더가 느려 응답이 없습니다(잠시 뒤 다시 시도하세요)." });
    const outcome = await run(h);
    assert.equal(outcome.kind, "ARCHIVE_FAILED");
    assert.equal(canLeaveAfterServiceReportSavePdf(outcome.kind), false);
    assert.deepEqual(h.opened, []);
    assert.equal(outcome.lines[0].text, SERVICE_REPORT_SAVE_PDF_SAVED_TEXT);
    assert.equal(outcome.lines[1].text, SERVICE_REPORT_SAVE_PDF_ARCHIVE_FAILED_TEXT);
    // 서버가 준 **경로 없는** 짧은 사유를 그대로 싣는다.
    assert.ok(outcome.lines[2].text.includes("공유폴더가 느려"));
  });

  test("🔴 통로에 닿지 못해도 값으로 끝난다 — 던지지 않는다", async () => {
    const outcome = await runServiceReportSavePdfConvert({
      repairCaseId: REPAIR_CASE_ID,
      serviceReportId: REPORT_ID,
      env: {
        fetchImpl: async () => {
          throw new Error("offline");
        },
        openLink: () => {
          throw new Error("열면 안 된다");
        },
        delay: async () => undefined,
      },
    });
    assert.equal(outcome.kind, "ARCHIVE_FAILED");
    assert.equal(outcome.lines[0].text, SERVICE_REPORT_SAVE_PDF_SAVED_TEXT);
  });

  test("🔴 응답 모양이 낯설면 실패로 끝낸다 — 지어내지 않는다", async () => {
    const h = harness({ status: "무엇인가" });
    const outcome = await run(h);
    assert.equal(outcome.kind, "ARCHIVE_FAILED");
    assert.deepEqual(h.opened, []);
  });
});

describe("🔴 연락서 폴더가 없으면 만들지 않는다", () => {
  test("no-folder — 사람에게 만드는 길을 알린다", async () => {
    const h = harness({ status: "no-folder" });
    const outcome = await run(h);
    assert.equal(outcome.kind, "NO_FOLDER");
    assert.equal(canLeaveAfterServiceReportSavePdf(outcome.kind), false);
    assert.deepEqual(h.opened, []);
    assert.equal(outcome.lines[1].text, SERVICE_REPORT_SAVE_PDF_NO_FOLDER_TEXT);
    assert.ok(outcome.lines[1].text.includes("[폴더 만들고 열기]"));
  });

  test("multiple — 앱이 고르지 않는다", async () => {
    const h = harness({ status: "multiple" });
    const outcome = await run(h);
    assert.equal(outcome.kind, "MULTIPLE");
    assert.deepEqual(h.opened, []);
    assert.equal(outcome.lines[1].text, SERVICE_REPORT_SAVE_PDF_MULTIPLE_TEXT);
  });
});

describe("🔴 꽂은 그 한 장을 들고 다닌다", () => {
  test("주소 · 확인 모두 **꽂기가 돌려준 이름**을 쓴다(번호가 붙었어도)", async () => {
    const numbered = "검사보고서_T2RCONT-AD2_WN3947_1802034 (2).xlsx";
    const h = harness(archived({ fileName: numbered }), [pdfFound(), pdfFound({ pdfExists: true })]);
    const outcome = await run(h);
    assert.equal(outcome.kind, "CREATED");
    assert.equal(parseQuoteFolderXlsx2PdfLink(h.opened[0]), `${FOLDER}/${CATEGORY}/${numbered}`);
    for (const url of h.urls.filter((one) => one.includes("/contact-folder/pdf"))) {
      assert.ok(url.includes(`name=${encodeURIComponent(numbered)}`), url);
      assert.ok(url.includes(`path=${encodeURIComponent(CATEGORY)}`), url);
    }
  });

  test("🔴 주소를 만들 수 없으면 지어내지 않는다", async () => {
    const h = harness(archived({ relativePath: null }));
    const outcome = await run(h);
    assert.equal(outcome.kind, "LINK_FAILED");
    assert.deepEqual(h.opened, []);
    assert.equal(outcome.lines[1].text, SERVICE_REPORT_SAVE_PDF_LINK_FAILED_TEXT);
  });

  test("🔴 분류 폴더를 파일이 막았으면 그 사실을 함께 알린다 — 바로 아래가 자리다", async () => {
    const h = harness(
      archived({ categoryFolderName: null, categoryFolderBlockedByFile: true, relativePath: FOLDER }),
      [pdfFound(), pdfFound({ pdfExists: true })]
    );
    const outcome = await run(h);
    assert.equal(outcome.kind, "CREATED");
    assert.equal(outcome.lines[1].text, SERVICE_REPORT_SAVE_PDF_CATEGORY_BLOCKED_TEXT);
    assert.equal(parseQuoteFolderXlsx2PdfLink(h.opened[0]), `${FOLDER}/${FILE}`);
    for (const url of h.urls.filter((one) => one.includes("/contact-folder/pdf"))) {
      assert.ok(url.includes("path=&") || url.includes("path=&name="), url);
    }
  });

  test("브라우저가 주소를 못 열면 거기서 끝난다", async () => {
    const h = harness(archived());
    const outcome = await runServiceReportSavePdfConvert({
      repairCaseId: REPAIR_CASE_ID,
      serviceReportId: REPORT_ID,
      env: {
        ...h.env,
        openLink: () => {
          throw new Error("no handler");
        },
      },
    });
    assert.equal(outcome.kind, "OPEN_FAILED");
    assert.equal(outcome.checks, 0);
    assert.equal(outcome.lines[1].text, SERVICE_REPORT_SAVE_PDF_OPEN_FAILED_TEXT);
  });
});

describe("🔴 「전에도 있었다」와 「방금 생겼다」를 가른다", () => {
  test("전에 없던 PDF 가 보이면 — 방금 생겼다", async () => {
    const h = harness(archived(), [pdfFound({ pdfExists: false }), pdfFound({ pdfExists: true })]);
    const outcome = await run(h);
    assert.equal(outcome.kind, "CREATED");
    assert.equal(canLeaveAfterServiceReportSavePdf(outcome.kind), true);
    assert.equal(outcome.checks, 1);
    assert.equal(outcome.lines[1].text, SERVICE_REPORT_SAVE_PDF_CREATED_TEXT);
  });

  test("전에도 있었고 수정 시각이 더 뒤면 — 방금 생겼다", async () => {
    const h = harness(archived(), [
      pdfFound({ pdfExists: true, pdfModifiedAt: "2026-10-12T00:00:00.000Z" }),
      pdfFound({ pdfExists: true, pdfModifiedAt: "2026-10-12T00:00:05.000Z" }),
    ]);
    const outcome = await run(h);
    assert.equal(outcome.kind, "CREATED");
  });

  test("🔴 수정 시각이 그대로면 — 「만들었다」고 말하지 않는다", async () => {
    const h = harness(archived(), [pdfFound({ pdfExists: true, pdfModifiedAt: "2026-10-12T00:00:00.000Z" })]);
    const outcome = await run(h);
    assert.equal(outcome.kind, "STALE");
    assert.equal(canLeaveAfterServiceReportSavePdf(outcome.kind), false);
    assert.equal(outcome.lines[1].text, SERVICE_REPORT_SAVE_PDF_STALE_TEXT);
  });

  test("🔴 수정 시각을 **못 읽으면** 단언하지 않는다 — 거짓 실패 쪽으로 틀린다", async () => {
    const h = harness(archived(), [pdfFound({ pdfExists: true }), pdfFound({ pdfExists: true })]);
    const outcome = await run(h);
    assert.equal(outcome.kind, "STALE");
  });

  test("🔴 상한까지 안 보이면 — 「아직 안 보인다」고 사실대로 말한다", async () => {
    const h = harness(archived(), [pdfFound({ pdfExists: false })]);
    const outcome = await run(h);
    assert.equal(outcome.kind, "NOT_VISIBLE");
    assert.equal(canLeaveAfterServiceReportSavePdf(outcome.kind), false);
    assert.equal(outcome.lines[1].text, SERVICE_REPORT_SAVE_PDF_NOT_VISIBLE_TEXT);
  });
});

describe("🔴 몇 번 보고 상한에서 멈춘다", () => {
  test("간격은 견적서와 **같은 한 벌**이고, 합이 곧 상한이다", async () => {
    const h = harness(archived(), [pdfFound({ pdfExists: false })]);
    const outcome = await run(h);
    assert.deepEqual(h.waits, [...SERVICE_REPORT_SAVE_PDF_CHECK_DELAYS_MS]);
    assert.equal(
      SERVICE_REPORT_SAVE_PDF_CHECK_DELAYS_MS.reduce((sum, one) => sum + one, 0),
      SERVICE_REPORT_SAVE_PDF_TOTAL_WAIT_MS
    );
    assert.equal(outcome.checks, SERVICE_REPORT_SAVE_PDF_CHECK_DELAYS_MS.length);
  });

  test("한 번 못 읽어도 그만두지 않는다 — 다음 차례에 다시 본다", async () => {
    const h = harness(archived(), [
      pdfFound({ pdfExists: false }),
      { status: "failed", reason: "공유폴더가 느립니다." },
      pdfFound({ pdfExists: true }),
    ]);
    const outcome = await run(h);
    assert.equal(outcome.kind, "CREATED");
    assert.equal(outcome.checks, 2);
  });

  test("꽂기는 **한 번**뿐이다 — 확인 때 다시 쓰지 않는다", async () => {
    const h = harness(archived(), [pdfFound({ pdfExists: false })]);
    await run(h);
    assert.equal(h.methods.filter((method) => method === "POST").length, 1);
    assert.equal(h.methods[0], "POST");
    assert.equal(h.urls[0].includes("/contact-folder?id="), true, h.urls[0]);
  });
});

describe("🔴 팝업은 변환이 진짜 시작될 때만", () => {
  test("주소를 연 뒤에 한 번 불린다", async () => {
    const h = harness(archived(), [pdfFound({ pdfExists: false }), pdfFound({ pdfExists: true })]);
    let started = 0;
    await run(h, () => {
      started += 1;
      // 이 시점에는 이미 주소를 열었다.
      assert.equal(h.opened.length, 1);
    });
    assert.equal(started, 1);
  });

  test("그 앞에서 끝나는 길에서는 불리지 않는다 — 깜빡임이 없다", async () => {
    for (const answer of [{ status: "disabled" }, { status: "no-folder" }, archived({ relativePath: null })]) {
      const h = harness(answer, [pdfFound()]);
      let started = 0;
      await run(h, () => {
        started += 1;
      });
      assert.equal(started, 0, JSON.stringify(answer));
    }
  });

  test("🔴 팝업 문구는 견적서와 **같은 글자**다(사용자가 적어 준 그대로)", () => {
    assert.equal(SERVICE_REPORT_SAVE_PDF_RUNNING_POPUP_TEXT, "저장된 엑셀을 PDF 로 바꾸는 중입니다…");
    assert.equal(SERVICE_REPORT_SAVE_PDF_DONE_POPUP_TEXT, "완료되었습니다");
    // 🔴 베낀 것이 아니라 **같은 상수**다 — 한쪽만 고쳐지는 날이 오지 않게.
    assert.equal(SERVICE_REPORT_SAVE_PDF_RUNNING_POPUP_TEXT, QUOTE_SAVE_PDF_RUNNING_POPUP_TEXT);
    assert.equal(SERVICE_REPORT_SAVE_PDF_DONE_POPUP_TEXT, QUOTE_SAVE_PDF_DONE_POPUP_TEXT);
  });
});

describe("🔴 줄에 경로 · 파일 이름이 한 글자도 없다", () => {
  const answers: readonly (readonly [Answer, readonly Answer[]])[] = [
    [{ status: "disabled" }, [pdfFound()]],
    [{ status: "no-folder" }, [pdfFound()]],
    [{ status: "multiple" }, [pdfFound()]],
    [{ status: "failed", reason: "공유폴더를 읽지 못했습니다." }, [pdfFound()]],
    [archived({ relativePath: null }), [pdfFound()]],
    [archived(), [{ status: "no-source" }]],
    [archived(), [{ status: "failed", reason: "공유폴더가 느립니다." }]],
    [archived(), [pdfFound({ pdfExists: false })]],
    [archived(), [pdfFound({ pdfExists: true, pdfModifiedAt: "2026-10-12T00:00:00.000Z" })]],
    [archived(), [pdfFound({ pdfExists: false }), pdfFound({ pdfExists: true })]],
  ];

  test("어느 결과에서도 폴더 이름 · 모델 · S/N · 확장자가 새지 않는다", async () => {
    for (const [archive, pdfAnswers] of answers) {
      const h = harness(archive, pdfAnswers);
      const outcome = await run(h);
      const text = outcome.lines.map((line) => line.text).join("\n");
      for (const secret of SECRET_PIECES) {
        assert.equal(text.includes(secret), false, `${outcome.kind} 줄에 ${secret} 가 샌다: ${text}`);
      }
    }
  });

  test("꽂은 자리에서 엑셀을 못 찾으면 — 사실대로 말한다", async () => {
    const h = harness(archived(), [{ status: "no-source" }]);
    const outcome = await run(h);
    assert.equal(outcome.kind, "NO_SOURCE");
    assert.equal(outcome.lines[1].text, SERVICE_REPORT_SAVE_PDF_NO_SOURCE_TEXT);
    assert.deepEqual(h.opened, []);
  });

  test("기준을 묻다 실패하면 — 주소를 열지 않는다", async () => {
    const h = harness(archived(), [{ status: "failed", reason: "공유폴더를 읽지 못했습니다." }]);
    const outcome = await run(h);
    assert.equal(outcome.kind, "FOLDER_FAILED");
    assert.equal(outcome.lines[1].text, SERVICE_REPORT_SAVE_PDF_FOLDER_FAILED_TEXT);
    assert.deepEqual(h.opened, []);
  });
});
