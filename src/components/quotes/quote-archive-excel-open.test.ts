import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { QUOTE_FOLDER_OPENABLE_EXTENSIONS } from "@/lib/domain/quote-folder-file-link";
import { CONTACT_FOLDER_FILE_HELPER_REINSTALL_TEXT } from "@/components/repair-cases/files/contact-folder-file-open";
import {
  QUOTE_ARCHIVE_FOLDER_SECTION_FAILED_TEXT,
  QUOTE_ARCHIVE_FOLDER_SECTION_MULTIPLE_TEXT,
  QUOTE_ARCHIVE_FOLDER_SECTION_NOT_FOUND_TEXT,
  quoteArchiveFolderEntriesUrl,
  type QuoteArchiveFolderEntriesFetch,
  type QuoteArchiveFolderEntryView,
} from "./QuoteArchiveFolderSection";
import { QUOTE_FOLDER_DISABLED_TEXT } from "./quote-folder-open";
import {
  QUOTE_ARCHIVE_EXCEL_EXTENSIONS,
  QUOTE_ARCHIVE_EXCEL_NOT_SAVED_TEXT,
  QUOTE_ARCHIVE_EXCEL_TRUNCATED_TEXT,
  isQuoteArchiveExcelFileName,
  pickQuoteArchiveExcelEntry,
  quoteArchiveExcelNumberKey,
  runQuoteArchiveExcelOpen,
  type QuoteArchiveExcelFileOpen,
  type QuoteArchiveExcelOpenOutcome,
} from "./quote-archive-excel-open";

/**
 * ============================================================================
 * 견적서 목록의 [Excel 보기] — 누르면 **그 줄의** 엑셀 하나가 열린다 (2026-10-06)
 * ============================================================================
 * 사용자 지시: 「폴더에 있는 해당 견적서를 바로 열 수 있도록 … 저장된 파일이 없다면
 * **저장된 파일이 없습니다.** 라고 안내가 뜨면 되는거야.」
 *
 * 여기서 못 박는 것:
 *  ① 🔴 **번호가 맞는 파일만 고른다** — `2026-078-3` 줄이 `2026-078` 도 `-1` 도 열지 않는다
 *     (열면 **남의 견적서**를 여는 것이다)
 *  ② 같은 번호로 여럿이면 **수정 시각이 가장 최근**인 것
 *  ③ 🔴 맞는 것이 없으면 **「저장된 파일이 없습니다.」**
 *  ④ 폴더 없음 · 여럿 · 꺼짐 · 읽기 실패가 **각각 사실대로**
 *  ⑤ 🔴 알림 어디에도 **경로가 한 글자도 없다**
 *  ⑦ 🔴 허용 확장자가 아닌 파일 · 폴더 줄 · 엑셀이 아닌 파일(결재 PDF)은 **안 연다**
 *
 * ⑥(두 번 눌러도 두 번 열리지 않는다)는 단추가 쥐는 상태라 quote-list-screen-source.test.ts
 * 가 본다(그 단추는 2026-10-07 부터 제 파일이다 — QuoteArchiveExcelOpenButton.tsx). 그것을
 * 거는 목록은 서버 액션을 다루는 클라이언트 컴포넌트라 이 환경에서 그려 볼 수 없다 —
 * 그래서 흐름은 여기서 **값으로** 본다(네트워크 · DOM 없이).
 * ============================================================================
 */

// ── 들러리 ───────────────────────────────────────────────────────────────

const QUOTE_ID = "11111111-2222-3333-4444-555555555555";
const RELATIVE_PATH = "21. 2026 내자견적서/DSS 2026-078 가나상사 MODEL-X Bias Fwd Drop 발생";

type EntryInput = { name: string; modifiedAt?: string; isDirectory?: boolean };

function entry(input: EntryInput): QuoteArchiveFolderEntryView {
  return {
    name: input.name,
    isDirectory: input.isDirectory === true,
    sizeBytes: 1024,
    ...(input.modifiedAt === undefined ? {} : { modifiedAt: input.modifiedAt }),
  };
}

/** 통로 응답 하나를 돌려주는 fetch. 부른 주소를 적어 둔다. */
function fetchReturning(payload: unknown, seen: string[] = []): QuoteArchiveFolderEntriesFetch {
  return async (url: string) => {
    seen.push(url);
    return { ok: true, status: 200, json: async () => payload };
  };
}

function foundPayload(entries: EntryInput[], extra: Record<string, unknown> = {}) {
  return {
    status: "found",
    relativePath: RELATIVE_PATH,
    entries: entries.map(entry),
    totalCount: entries.length,
    truncated: false,
    ...extra,
  };
}

/** 여는 장치를 대신한다 — 무엇을 받았는지 적고, 그 흐름이 늘 내는 줄을 흉내 낸다. */
function spyOpen(): { calls: Array<{ folderName: string; fileName: string }>; open: QuoteArchiveExcelFileOpen } {
  const calls: Array<{ folderName: string; fileName: string }> = [];
  return {
    calls,
    open: async ({ folderName, fileName }) => {
      calls.push({ folderName, fileName });
      return {
        lines: [
          { text: `파일을 엽니다: ${fileName}`, tone: "normal" },
          { text: CONTACT_FOLDER_FILE_HELPER_REINSTALL_TEXT, tone: "muted" },
        ],
        offerHelperInstall: true,
      };
    },
  };
}

const texts = (outcome: QuoteArchiveExcelOpenOutcome) => outcome.lines.map((line) => line.text);

// ── 번호를 견주는 방식 ────────────────────────────────────────────────────

describe("번호 뽑기 — 줄 쪽과 파일 쪽이 같은 함수를 쓴다", () => {
  test("발행번호에서 번호를 뽑는다 — 가지 · 개정 한 겹까지", () => {
    assert.equal(quoteArchiveExcelNumberKey("DSS 2026-078"), "2026-078");
    assert.equal(quoteArchiveExcelNumberKey("DSS 2026-078-3"), "2026-078-3");
    assert.equal(quoteArchiveExcelNumberKey("DSS 2026-004R1"), "2026-004R1");
  });

  test("🔴 공백 · 대소문자 · `DSS` 뒤 하이픈을 접는다 — 실측에 변종이 있다", () => {
    assert.equal(quoteArchiveExcelNumberKey("DSS-2026-099"), "2026-099");
    assert.equal(quoteArchiveExcelNumberKey("dss 2026-099"), "2026-099");
    assert.equal(quoteArchiveExcelNumberKey("DSS  2026-099  "), "2026-099");
    assert.equal(quoteArchiveExcelNumberKey("DSS 2026-004r1"), "2026-004R1");
  });

  test("🔴 못 뽑으면 null — 지어내지 않는다", () => {
    for (const odd of ["", "   ", "Q-7", "DSS2026-089", "2026-078", "견적서", null, undefined, 7]) {
      assert.equal(quoteArchiveExcelNumberKey(odd), null, String(odd));
    }
  });
});

// ── ⑦ 무엇을 엑셀로 보는가 ───────────────────────────────────────────────

describe("⑦ 🔴 엑셀만 · 허용 확장자만", () => {
  test("엑셀 확장자 셋은 여는 쪽 허용 목록 안에 있다 — 두 목록이 갈라지면 여기서 깨진다", () => {
    for (const extension of QUOTE_ARCHIVE_EXCEL_EXTENSIONS) {
      assert.ok(QUOTE_FOLDER_OPENABLE_EXTENSIONS.includes(extension), extension);
    }
  });

  test("엑셀이면 참 — 대소문자를 접는다", () => {
    for (const name of ["견적서.xlsx", "견적서.XLS", "견적서.xlsm", "DSS 2026-078 가나상사.XLSX"]) {
      assert.equal(isQuoteArchiveExcelFileName(name), true, name);
    }
  });

  test("🔴 엑셀이 아니면 거짓 — 결재 PDF · 실행 파일 · 확장자 없음 · 마디 늘리기 · 끝의 점과 공백", () => {
    for (const name of [
      "DSS 2026-078 가나상사 - 有印.pdf",
      "견적서.exe",
      "견적서.lnk",
      "견적서",
      "하위/견적서.xlsx",
      "견적서.xlsx ",
      "견적서.xlsx.",
      "",
      null,
    ]) {
      assert.equal(isQuoteArchiveExcelFileName(name), false, String(name));
    }
  });
});

// ── ① ② 고르는 규칙 ─────────────────────────────────────────────────────

describe("① 🔴 번호가 맞는 파일만 — 남의 견적서를 열지 않는다", () => {
  const folder = [
    entry({ name: "DSS 2026-078 가나상사 MODEL-X 수리 견적서.xlsx", modifiedAt: "2026-03-01T01:00:00.000Z" }),
    entry({ name: "DSS 2026-078-1 가나상사 MODEL-X 수리 견적서(OH포함).xlsx", modifiedAt: "2026-03-02T01:00:00.000Z" }),
    entry({ name: "DSS 2026-078-3 가나상사 MODEL-X Bias Fwd Drop 발생.xlsx", modifiedAt: "2026-01-02T01:00:00.000Z" }),
  ];

  test("가지 번호 줄은 **제 번호의 파일만** 연다 — 본 번호도 다른 가지도 아니다", () => {
    assert.equal(
      pickQuoteArchiveExcelEntry(folder, "DSS 2026-078-3")?.name,
      "DSS 2026-078-3 가나상사 MODEL-X Bias Fwd Drop 발생.xlsx"
    );
  });

  test("🔴 본 번호 줄은 가지 번호 파일을 열지 않는다 — 더 최근이어도", () => {
    assert.equal(pickQuoteArchiveExcelEntry(folder, "DSS 2026-078")?.name, "DSS 2026-078 가나상사 MODEL-X 수리 견적서.xlsx");
  });

  test("다른 가지 줄도 제 것만", () => {
    assert.equal(
      pickQuoteArchiveExcelEntry(folder, "DSS 2026-078-1")?.name,
      "DSS 2026-078-1 가나상사 MODEL-X 수리 견적서(OH포함).xlsx"
    );
  });

  test("폴더에 그 번호가 없으면 null", () => {
    assert.equal(pickQuoteArchiveExcelEntry(folder, "DSS 2026-079"), null);
  });

  test("🔴 번호를 못 뽑는 줄은 **아무것도** 고르지 않는다 — 번호 없는 파일과 맞다고 보지 않는다", () => {
    const odd = [entry({ name: "단가기재 참고용.XLS", modifiedAt: "2026-05-01T01:00:00.000Z" })];
    assert.equal(pickQuoteArchiveExcelEntry(odd, "Q-7"), null);
    assert.equal(pickQuoteArchiveExcelEntry(odd, ""), null);
  });

  test("하이픈으로 적은 번호도 공백으로 적은 파일과 맞는다", () => {
    const one = [entry({ name: "DSS 2026-099 가나상사 FWD DROP.xlsx", modifiedAt: "2026-04-01T07:18:00.000Z" })];
    assert.equal(pickQuoteArchiveExcelEntry(one, "DSS-2026-099")?.name, "DSS 2026-099 가나상사 FWD DROP.xlsx");
  });
});

describe("② 같은 번호로 여럿이면 가장 최근 것", () => {
  test("🔴 이름이 달라 쌓인 두 장 가운데 늦게 고친 것 — 차례가 뒤바뀌어 와도 같다", () => {
    const older = entry({ name: "DSS 2026-099 가나상사 FWD DROP.xlsx", modifiedAt: "2026-04-01T07:18:00.000Z" });
    const newer = entry({ name: "DSS 2026-099 가나상사 FWD DROPING.xlsx", modifiedAt: "2026-04-01T10:58:00.000Z" });
    assert.equal(pickQuoteArchiveExcelEntry([older, newer], "DSS 2026-099")?.name, newer.name);
    assert.equal(pickQuoteArchiveExcelEntry([newer, older], "DSS 2026-099")?.name, newer.name);
  });

  test("수정 시각이 없는 줄은 가장 오래된 것으로 본다 — 시각이 있는 쪽이 이긴다", () => {
    const noTime = entry({ name: "DSS 2026-099 가나상사 FWD DROPING.xlsx" });
    const timed = entry({ name: "DSS 2026-099 가나상사 FWD DROP.xlsx", modifiedAt: "2026-04-01T07:18:00.000Z" });
    assert.equal(pickQuoteArchiveExcelEntry([noTime, timed], "DSS 2026-099")?.name, timed.name);
  });

  test("시각이 같거나 둘 다 없으면 이름순 첫째 — 늘 같은 하나를 고른다", () => {
    const a = entry({ name: "DSS 2026-099 가나상사 FWD DROP.xlsx" });
    const b = entry({ name: "DSS 2026-099 가나상사 FWD DROPING.xlsx" });
    assert.equal(pickQuoteArchiveExcelEntry([a, b], "DSS 2026-099")?.name, a.name);
    assert.equal(pickQuoteArchiveExcelEntry([b, a], "DSS 2026-099")?.name, a.name);
  });
});

describe("⑦ 🔴 고를 때도 엑셀만 — 폴더 줄 · 결재 PDF · 목록 밖 확장자는 건너뛴다", () => {
  test("같은 번호의 PDF 가 더 최근이어도 엑셀을 연다", () => {
    const folder = [
      entry({ name: "DSS 2026-077 가나상사 수리 견적서.xlsx", modifiedAt: "2026-02-01T01:00:00.000Z" }),
      entry({ name: "DSS 2026-077 가나상사 수리 견적서 - 有印.pdf", modifiedAt: "2026-09-01T01:00:00.000Z" }),
    ];
    assert.equal(pickQuoteArchiveExcelEntry(folder, "DSS 2026-077")?.name, "DSS 2026-077 가나상사 수리 견적서.xlsx");
  });

  test("🔴 실행 파일 · 폴더 줄은 번호가 맞아도 고르지 않는다", () => {
    const folder = [
      entry({ name: "DSS 2026-077 가나상사 수리 견적서.exe", modifiedAt: "2026-09-01T01:00:00.000Z" }),
      entry({ name: "DSS 2026-077 가나상사 지난 자료", isDirectory: true, modifiedAt: "2026-09-02T01:00:00.000Z" }),
      entry({ name: "DSS 2026-077 가나상사 수리 견적서.xlsx", modifiedAt: "2026-02-01T01:00:00.000Z" }),
    ];
    assert.equal(pickQuoteArchiveExcelEntry(folder, "DSS 2026-077")?.name, "DSS 2026-077 가나상사 수리 견적서.xlsx");
  });

  test("엑셀 이름을 단 **폴더**만 있으면 null — 폴더를 열지 않는다", () => {
    const folder = [entry({ name: "DSS 2026-077 가나상사.xlsx", isDirectory: true })];
    assert.equal(pickQuoteArchiveExcelEntry(folder, "DSS 2026-077"), null);
  });
});

// ── 누른 뒤의 흐름 ───────────────────────────────────────────────────────

describe("누르면 — 통로 한 번, 고른 파일 하나를 여는 장치로", () => {
  test("🔴 목록 통로를 그 견적서 id 로 한 번만 부른다", async () => {
    const seen: string[] = [];
    const spy = spyOpen();
    await runQuoteArchiveExcelOpen({
      quoteId: QUOTE_ID,
      quoteNumber: "DSS 2026-078-3",
      env: {
        fetchImpl: fetchReturning(
          foundPayload([{ name: "DSS 2026-078-3 가나상사 Bias Fwd Drop 발생.xlsx", modifiedAt: "2026-03-01T01:00:00.000Z" }]),
          seen
        ),
        openFile: spy.open,
      },
    });
    assert.deepEqual(seen, [quoteArchiveFolderEntriesUrl(QUOTE_ID)]);
  });

  test("여는 장치는 **폴더 경로와 파일 이름 하나**를 받는다", async () => {
    const spy = spyOpen();
    const outcome = await runQuoteArchiveExcelOpen({
      quoteId: QUOTE_ID,
      quoteNumber: "DSS 2026-078-3",
      env: {
        fetchImpl: fetchReturning(
          foundPayload([
            { name: "DSS 2026-078 가나상사 수리 견적서.xlsx", modifiedAt: "2026-09-01T01:00:00.000Z" },
            { name: "DSS 2026-078-3 가나상사 Bias Fwd Drop 발생.xlsx", modifiedAt: "2026-03-01T01:00:00.000Z" },
          ])
        ),
        openFile: spy.open,
      },
    });
    assert.deepEqual(spy.calls, [
      { folderName: RELATIVE_PATH, fileName: "DSS 2026-078-3 가나상사 Bias Fwd Drop 발생.xlsx" },
    ]);
    assert.equal(outcome.kind, "OPENED");
  });

  test("🔴 「열리지 않으면 도우미를 다시 설치해 주세요」와 설치 단추가 그대로 따라온다 — 끄지 않는다", async () => {
    const spy = spyOpen();
    const outcome = await runQuoteArchiveExcelOpen({
      quoteId: QUOTE_ID,
      quoteNumber: "DSS 2026-078",
      env: {
        fetchImpl: fetchReturning(foundPayload([{ name: "DSS 2026-078 가나상사 수리 견적서.xlsx" }])),
        openFile: spy.open,
      },
    });
    assert.ok(texts(outcome).includes(CONTACT_FOLDER_FILE_HELPER_REINSTALL_TEXT), texts(outcome).join(" / "));
    assert.equal(outcome.offerHelperInstall, true);
  });

  test("🔴 바꿔 끼우지 않으면 **이미 있는 여는 장치**가 돈다 — 제 사본을 두지 않았다", async () => {
    // DOM 이 없는 이 환경에서는 그 장치가 「주소를 열지 못했다」로 끝난다. 여기서 보는 것은
    // **그 장치를 거쳤다**는 사실이다(베낀 구현이 따로 있으면 이 결과가 나오지 않는다).
    const outcome = await runQuoteArchiveExcelOpen({
      quoteId: QUOTE_ID,
      quoteNumber: "DSS 2026-078",
      env: {
        fetchImpl: fetchReturning(foundPayload([{ name: "DSS 2026-078 가나상사 수리 견적서.xlsx" }])),
      },
    });
    assert.equal(outcome.kind, "OPENED");
    assert.ok(outcome.lines.length > 0);
  });
});

describe("③ 🔴 맞는 것이 없으면 — 사용자가 직접 말한 문장", () => {
  test("폴더는 있는데 그 번호의 엑셀이 없다", async () => {
    const spy = spyOpen();
    const outcome = await runQuoteArchiveExcelOpen({
      quoteId: QUOTE_ID,
      quoteNumber: "DSS 2026-078-3",
      env: {
        fetchImpl: fetchReturning(
          foundPayload([
            { name: "DSS 2026-078 가나상사 수리 견적서.xlsx", modifiedAt: "2026-09-01T01:00:00.000Z" },
            { name: "DSS 2026-078-1 가나상사 수리 견적서(OH포함).xlsx", modifiedAt: "2026-09-02T01:00:00.000Z" },
          ])
        ),
        openFile: spy.open,
      },
    });
    assert.equal(outcome.kind, "FILE_NOT_FOUND");
    assert.deepEqual(texts(outcome), ["저장된 파일이 없습니다."]);
    assert.deepEqual(spy.calls, [], "아무것도 열지 않아야 한다");
  });

  test("폴더가 비어 있을 때도 같은 문장", async () => {
    const outcome = await runQuoteArchiveExcelOpen({
      quoteId: QUOTE_ID,
      quoteNumber: "DSS 2026-078",
      env: { fetchImpl: fetchReturning(foundPayload([])), openFile: spyOpen().open },
    });
    assert.deepEqual(texts(outcome), [QUOTE_ARCHIVE_EXCEL_NOT_SAVED_TEXT]);
  });

  test("문장은 마침표까지 사용자가 말한 그대로다", () => {
    assert.equal(QUOTE_ARCHIVE_EXCEL_NOT_SAVED_TEXT, "저장된 파일이 없습니다.");
  });

  test("🔴 목록이 잘렸으면 「없다」고 단언하지 않고 사실을 곁들인다", async () => {
    const outcome = await runQuoteArchiveExcelOpen({
      quoteId: QUOTE_ID,
      quoteNumber: "DSS 2026-078",
      env: {
        fetchImpl: fetchReturning(foundPayload([{ name: "DSS 2026-900 남의 견적서.xlsx" }], { truncated: true, totalCount: 400 })),
        openFile: spyOpen().open,
      },
    });
    assert.deepEqual(texts(outcome), [QUOTE_ARCHIVE_EXCEL_NOT_SAVED_TEXT, QUOTE_ARCHIVE_EXCEL_TRUNCATED_TEXT]);
  });
});

describe("④ 폴더 쪽 네 갈래 — 각각 사실대로", () => {
  const cases: Array<{ name: string; payload: unknown; kind: string; first: string }> = [
    { name: "꺼짐", payload: { status: "disabled" }, kind: "DISABLED", first: QUOTE_FOLDER_DISABLED_TEXT },
    {
      name: "폴더 없음",
      payload: { status: "not-found" },
      kind: "FOLDER_NOT_FOUND",
      first: QUOTE_ARCHIVE_FOLDER_SECTION_NOT_FOUND_TEXT,
    },
    {
      name: "여럿",
      payload: { status: "multiple" },
      kind: "FOLDER_MULTIPLE",
      first: QUOTE_ARCHIVE_FOLDER_SECTION_MULTIPLE_TEXT,
    },
    {
      name: "읽기 실패",
      payload: { status: "failed", reason: "공유폴더에 닿지 못했습니다" },
      kind: "FOLDER_FAILED",
      first: QUOTE_ARCHIVE_FOLDER_SECTION_FAILED_TEXT,
    },
  ];

  for (const one of cases) {
    test(`${one.name} — 제 문장으로 알리고 아무것도 열지 않는다`, async () => {
      const spy = spyOpen();
      const outcome = await runQuoteArchiveExcelOpen({
        quoteId: QUOTE_ID,
        quoteNumber: "DSS 2026-078",
        env: { fetchImpl: fetchReturning(one.payload), openFile: spy.open },
      });
      assert.equal(outcome.kind, one.kind);
      assert.equal(texts(outcome)[0], one.first);
      assert.equal(outcome.offerHelperInstall, false);
      assert.deepEqual(spy.calls, []);
    });
  }

  test("🔴 네 갈래가 서로 다른 문장이다 — 「저장된 파일이 없습니다.」와도 겹치지 않는다", async () => {
    const said = new Set<string>();
    for (const one of cases) {
      const outcome = await runQuoteArchiveExcelOpen({
        quoteId: QUOTE_ID,
        quoteNumber: "DSS 2026-078",
        env: { fetchImpl: fetchReturning(one.payload), openFile: spyOpen().open },
      });
      said.add(texts(outcome)[0]);
    }
    assert.equal(said.size, cases.length);
    assert.ok(!said.has(QUOTE_ARCHIVE_EXCEL_NOT_SAVED_TEXT), "폴더 사정을 「파일이 없다」로 말한다");
  });

  test("읽기 실패에는 서버가 준 짧은 사유가 따라붙는다", async () => {
    const outcome = await runQuoteArchiveExcelOpen({
      quoteId: QUOTE_ID,
      quoteNumber: "DSS 2026-078",
      env: {
        fetchImpl: fetchReturning({ status: "failed", reason: "공유폴더에 닿지 못했습니다" }),
        openFile: spyOpen().open,
      },
    });
    assert.deepEqual(texts(outcome), [QUOTE_ARCHIVE_FOLDER_SECTION_FAILED_TEXT, "공유폴더에 닿지 못했습니다"]);
  });

  test("통로가 터지거나 모양이 다르면 — 던지지 않고 읽기 실패로 끝난다", async () => {
    const thrown = await runQuoteArchiveExcelOpen({
      quoteId: QUOTE_ID,
      quoteNumber: "DSS 2026-078",
      env: {
        fetchImpl: async () => {
          throw new Error("offline");
        },
        openFile: spyOpen().open,
      },
    });
    assert.equal(thrown.kind, "FOLDER_FAILED");

    const odd = await runQuoteArchiveExcelOpen({
      quoteId: QUOTE_ID,
      quoteNumber: "DSS 2026-078",
      env: { fetchImpl: fetchReturning({ status: "무엇" }), openFile: spyOpen().open },
    });
    assert.equal(odd.kind, "FOLDER_FAILED");
  });

  test("찾았다는데 폴더 자리가 비어 있으면 주소를 지어내지 않는다", async () => {
    const spy = spyOpen();
    const outcome = await runQuoteArchiveExcelOpen({
      quoteId: QUOTE_ID,
      quoteNumber: "DSS 2026-078",
      env: {
        fetchImpl: fetchReturning({
          status: "found",
          relativePath: "",
          entries: [entry({ name: "DSS 2026-078 가나상사 수리 견적서.xlsx" })],
          totalCount: 1,
          truncated: false,
        }),
        openFile: spy.open,
      },
    });
    assert.equal(outcome.kind, "FOLDER_FAILED");
    assert.deepEqual(spy.calls, []);
  });
});

// ── ⑤ 경로가 한 글자도 없다 ──────────────────────────────────────────────

describe("⑤ 🔴 알림에 경로가 없다", () => {
  const payloads: unknown[] = [
    { status: "disabled" },
    { status: "not-found" },
    { status: "multiple" },
    { status: "failed", reason: "공유폴더에 닿지 못했습니다" },
    foundPayload([]),
    foundPayload([{ name: "DSS 2026-900 남의 견적서.xlsx" }]),
    foundPayload([{ name: "DSS 2026-078 가나상사 수리 견적서.xlsx" }]),
  ];

  test("어느 갈래의 줄에도 폴더 경로 · 마디 구분자가 들어가지 않는다", async () => {
    for (const payload of payloads) {
      const outcome = await runQuoteArchiveExcelOpen({
        quoteId: QUOTE_ID,
        quoteNumber: "DSS 2026-078",
        env: { fetchImpl: fetchReturning(payload), openFile: spyOpen().open },
      });
      for (const line of texts(outcome)) {
        assert.ok(!line.includes(RELATIVE_PATH), `경로가 들어갔다: ${line}`);
        assert.ok(!line.includes("21. 2026 내자견적서"), `연도 폴더가 들어갔다: ${line}`);
        assert.ok(!line.includes("/"), `마디 구분자가 들어갔다: ${line}`);
        assert.ok(!line.includes(String.fromCharCode(92)), `마디 구분자가 들어갔다: ${line}`);
      }
    }
  });
});
