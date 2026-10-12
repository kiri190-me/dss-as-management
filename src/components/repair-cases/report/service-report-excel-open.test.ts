import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { QUOTE_ARCHIVE_EXCEL_NOT_SAVED_TEXT, QUOTE_ARCHIVE_EXCEL_TRUNCATED_TEXT } from "@/components/quotes/quote-archive-excel-open";
import { QUOTE_FOLDER_DISABLED_TEXT } from "@/components/quotes/quote-folder-open";
import {
  CONTACT_FOLDER_SECTION_FAILED_TEXT,
  CONTACT_FOLDER_SECTION_MULTIPLE_TEXT,
  CONTACT_FOLDER_SECTION_NOT_FOUND_TEXT,
  contactFolderEntriesUrl,
  type ContactFolderEntriesFetch,
  type ContactFolderEntryView,
} from "@/components/repair-cases/files/ContactFolderSection";
import { CONTACT_FOLDER_FILE_HELPER_REINSTALL_TEXT } from "@/components/repair-cases/files/contact-folder-file-open";
import { contactFolderCopyFileName } from "@/lib/domain/contact-folder-naming";
import { serviceReportContactFolderRelativePath } from "@/lib/domain/service-report-contact-folder";
import {
  buildServiceReportFileName,
  serviceReportFileNameFromListName,
} from "@/lib/domain/service-report-file-name";
import { buildServiceReportListName } from "@/lib/domain/service-report-list";
import { serviceReportFolderCategoryName } from "./ServiceReportFolderSection";
import {
  SERVICE_REPORT_EXCEL_NOT_SAVED_TEXT,
  pickServiceReportExcelEntry,
  runServiceReportExcelOpen,
  type ServiceReportExcelFileOpen,
  type ServiceReportExcelOpenOutcome,
} from "./service-report-excel-open";

/**
 * ============================================================================
 * 보고서 목록의 [Excel 보기] — 누르면 **그 보고서의** 엑셀 하나가 열린다 (2026-10-12)
 * ============================================================================
 * 사용자 요구: 「보고서 탭 저장된 보고서의 [엑셀 받기]를 [Excel 보기]로」. 🔴 글자만 바꾸는
 * 일이 아니다 — 받기는 내려받기 통로였고, 보기는 **공유폴더에 이미 들어가 있는 그 엑셀**을
 * 그 PC 의 Excel 로 여는 것이다.
 *
 * 여기서 못 박는 것:
 *  ① 🔴 **그 보고서의 이름과 그 번호 사본만** 고른다 — 같은 분류 폴더에 있는 **다른 장비의
 *     보고서**를 열지 않는다
 *  ② `… (2).xlsx` 가 여럿이면 **수정 시각이 가장 최근**, 같으면 **이름순 첫째**
 *  ③ 🔴 못 찾으면 **열지 않고** 「저장된 파일이 없습니다.」
 *  ④ 꺼짐 · 폴더 없음 · 여럿 · 읽기 실패가 **각각 사실대로**
 *  ⑤ 🔴 **검사와 수리를 섞지 않는다** — 종류가 분류 폴더를 정한다
 *  ⑥ 🔴 PDF 는 안 연다(같은 자리에 함께 있다) · 폴더 줄도 안 연다
 *  ⑦ 🔴 알림 어디에도 **경로가 한 글자도 없다**
 *  ⑧ 🔴 이름 규칙을 **새로 적지 않았다** — 쓰는 길이 쓴 두 함수가 그대로 짓는다
 *  ⑨ 🔴 읽고 여는 것뿐이다(만들기 · 쓰기 · 지우기가 원본에 없다)
 *
 * 「두 번 눌러도 두 번 열리지 않는다」는 단추가 쥐는 상태라 아래 원본 읽기로 본다.
 * ============================================================================
 */

// ── 들러리 ───────────────────────────────────────────────────────────────

const CASE_ID = "11111111-2222-3333-4444-555555555555";
const FOLDER = "D260908 INVENIA T2RCONT-AD2 WN3947 1802034 점검요청";

/** 🔴 분류 폴더 이름은 **도메인 함수가 정한 것**을 쓴다 — 시험도 글자로 적지 않는다. */
const INSPECTION_FOLDER = serviceReportFolderCategoryName("INSPECTION") ?? "";
const REPAIR_FOLDER = serviceReportFolderCategoryName("REPAIR") ?? "";

/** 🔴 **페이지가 짓는 그 이름**이다 — 여기서도 손으로 적지 않는다. */
const INSPECTION_EXCEL =
  contactFolderCopyFileName(serviceReportFileNameFromListName("INSPECTION", "T2RCONT-AD2_WN3947_1802034")) ?? "";
const REPAIR_EXCEL =
  contactFolderCopyFileName(serviceReportFileNameFromListName("REPAIR", "T2RCONT-AD2_WN3947_1802034")) ?? "";

const INSPECTION_PATH = serviceReportContactFolderRelativePath(FOLDER, INSPECTION_FOLDER) ?? "";
const REPAIR_PATH = serviceReportContactFolderRelativePath(FOLDER, REPAIR_FOLDER) ?? "";

type EntryInput = { name: string; modifiedAt?: string; isDirectory?: boolean };

function entry(input: EntryInput): ContactFolderEntryView {
  return {
    name: input.name,
    isDirectory: input.isDirectory === true,
    sizeBytes: 1024,
    ...(input.modifiedAt === undefined ? {} : { modifiedAt: input.modifiedAt }),
  };
}

function found(entries: EntryInput[], extra: Record<string, unknown> = {}) {
  return {
    status: "found",
    folderName: FOLDER,
    entries: entries.map(entry),
    totalCount: entries.length,
    truncated: false,
    ...extra,
  };
}

/** 폴더 안 자리(`?path=`)마다 다른 답을 주는 통로. 부른 주소를 적어 둔다. */
function fetchTree(byPath: Record<string, unknown>, seen: string[] = []): ContactFolderEntriesFetch {
  return async (url: string) => {
    seen.push(url);
    const insidePath = new URL(url, "http://local").searchParams.get("path") ?? "";
    const payload = Object.prototype.hasOwnProperty.call(byPath, insidePath)
      ? byPath[insidePath]
      : { status: "failed", reason: "하위 폴더를 찾을 수 없습니다" };
    return { ok: true, status: 200, json: async () => payload };
  };
}

/** 분류 폴더 둘이 **서 있는** 맨 위 칸. */
const TOP_WITH_BOTH = found([
  { name: INSPECTION_FOLDER, isDirectory: true },
  { name: REPAIR_FOLDER, isDirectory: true },
  { name: "DATA", isDirectory: true },
  { name: "연락서.pdf" },
]);

/** 여는 장치를 대신한다 — 무엇을 받았는지 적고, 그 흐름이 늘 내는 줄을 흉내 낸다. */
function spyOpen(): { calls: Array<{ folderName: string; fileName: string }>; open: ServiceReportExcelFileOpen } {
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

const texts = (outcome: ServiceReportExcelOpenOutcome) => outcome.lines.map((line) => line.text);

// ── ⑧ 이름 규칙 — 쓰는 길과 **같은 이름**을 찾는다 ────────────────────────

describe("⑧ 🔴 이름 규칙을 새로 적지 않았다", () => {
  test("목록 줄 이름으로 짓는 길이 **장비 셋으로 짓는 길과 한 글자도 같다**", () => {
    const parts = { modelName: "T2RCONT-AD2", lotNumber: "WN3947", serialNumber: "1802034", reportNumber: "Z494-4013" };
    for (const kind of ["INSPECTION", "REPAIR"] as const) {
      assert.equal(
        serviceReportFileNameFromListName(kind, buildServiceReportListName(parts)),
        buildServiceReportFileName({ kind, ...parts })
      );
    }
  });

  test("장비 셋이 다 비면 문서번호로, 그것도 비면 **종류만** — 되돌아가는 순서가 그대로다", () => {
    const empty = { modelName: null, lotNumber: null, serialNumber: null };
    assert.equal(
      serviceReportFileNameFromListName("REPAIR", buildServiceReportListName({ ...empty, reportNumber: "Z494-4013" })),
      "수리보고서_Z494-4013.xlsx"
    );
    assert.equal(
      serviceReportFileNameFromListName("REPAIR", buildServiceReportListName({ ...empty, reportNumber: "" })),
      "수리보고서.xlsx"
    );
  });

  test("찾는 이름은 `검사보고서_모델_L/N_S/N.xlsx` 꼴이다", () => {
    assert.equal(INSPECTION_EXCEL, "검사보고서_T2RCONT-AD2_WN3947_1802034.xlsx");
    assert.equal(REPAIR_EXCEL, "수리보고서_T2RCONT-AD2_WN3947_1802034.xlsx");
  });
});

// ── ①②⑥ 고르는 규칙 (순수) ─────────────────────────────────────────────

describe("① 그 보고서의 엑셀만 — 같은 폴더의 남의 장을 열지 않는다", () => {
  test("이름이 맞는 한 장을 고른다", () => {
    const folder = [entry({ name: INSPECTION_EXCEL })];
    assert.equal(pickServiceReportExcelEntry(folder, INSPECTION_EXCEL)?.name, INSPECTION_EXCEL);
  });

  test("🔴 **다른 장비의 검사 보고서**는 같은 폴더에 있어도 고르지 않는다", () => {
    const other = contactFolderCopyFileName(serviceReportFileNameFromListName("INSPECTION", "RFK300FH-AD1_WU8042_1612027")) ?? "";
    const folder = [entry({ name: other, modifiedAt: "2026-10-11T01:00:00.000Z" })];
    assert.notEqual(other, INSPECTION_EXCEL);
    assert.equal(pickServiceReportExcelEntry(folder, INSPECTION_EXCEL), null);
  });

  test("🔴 **수리 보고서 이름**은 검사 보고서를 찾을 때 걸리지 않는다", () => {
    const folder = [entry({ name: REPAIR_EXCEL })];
    assert.equal(pickServiceReportExcelEntry(folder, INSPECTION_EXCEL), null);
  });

  test("디스크에 풀어쓴 한글(NFD)로 앉아 있어도 찾는다 — 비교할 때 접는다", () => {
    const folder = [entry({ name: INSPECTION_EXCEL.normalize("NFD") })];
    assert.equal(pickServiceReportExcelEntry(folder, INSPECTION_EXCEL)?.name, INSPECTION_EXCEL.normalize("NFD"));
  });

  test("찾는 이름이 비었거나 엑셀이 아니면 **아무것도 고르지 않는다**", () => {
    const folder = [entry({ name: INSPECTION_EXCEL })];
    assert.equal(pickServiceReportExcelEntry(folder, ""), null);
    assert.equal(pickServiceReportExcelEntry(folder, null), null);
    assert.equal(pickServiceReportExcelEntry(folder, "검사보고서_T2RCONT-AD2_WN3947_1802034.pdf"), null);
  });
});

describe("② 번호 붙은 사본이 여럿이면 — 수정 시각이 가장 최근", () => {
  /** 🔴 번호 꼬리를 글자로 적지 않는다 — 쓰는 길이 쓰는 그 규칙으로 짓는다. */
  const copy = (n: number) => INSPECTION_EXCEL.replace(/\.xlsx$/u, ` (${n}).xlsx`);

  test("`… (3)` 이 가장 최근이면 그것을 연다", () => {
    const folder = [
      entry({ name: INSPECTION_EXCEL, modifiedAt: "2026-10-01T01:00:00.000Z" }),
      entry({ name: copy(2), modifiedAt: "2026-10-05T01:00:00.000Z" }),
      entry({ name: copy(3), modifiedAt: "2026-10-09T01:00:00.000Z" }),
    ];
    assert.equal(pickServiceReportExcelEntry(folder, INSPECTION_EXCEL)?.name, copy(3));
  });

  test("🔴 번호가 큰 쪽이 아니라 **최근인 쪽**이다 — 사람이 옛 장을 다시 저장할 수 있다", () => {
    const folder = [
      entry({ name: INSPECTION_EXCEL, modifiedAt: "2026-10-09T01:00:00.000Z" }),
      entry({ name: copy(2), modifiedAt: "2026-10-05T01:00:00.000Z" }),
    ];
    assert.equal(pickServiceReportExcelEntry(folder, INSPECTION_EXCEL)?.name, INSPECTION_EXCEL);
  });

  test("시각이 같으면 **이름순 첫째** — 늘 같은 하나를 고른다", () => {
    const folder = [
      entry({ name: copy(3), modifiedAt: "2026-10-09T01:00:00.000Z" }),
      entry({ name: copy(2), modifiedAt: "2026-10-09T01:00:00.000Z" }),
    ];
    assert.equal(pickServiceReportExcelEntry(folder, INSPECTION_EXCEL)?.name, copy(2));
  });

  test("수정 시각 칸이 없는 줄은 **가장 오래된 것**으로 친다", () => {
    const folder = [entry({ name: INSPECTION_EXCEL }), entry({ name: copy(2), modifiedAt: "2026-10-05T01:00:00.000Z" })];
    assert.equal(pickServiceReportExcelEntry(folder, INSPECTION_EXCEL)?.name, copy(2));
  });
});

describe("⑥ PDF · 폴더 줄은 안 연다", () => {
  test("🔴 같은 자리의 **PDF 가 더 최근이어도** 엑셀을 연다", () => {
    const folder = [
      entry({ name: INSPECTION_EXCEL.replace(/\.xlsx$/u, ".pdf"), modifiedAt: "2026-10-12T01:00:00.000Z" }),
      entry({ name: INSPECTION_EXCEL, modifiedAt: "2026-10-01T01:00:00.000Z" }),
    ];
    assert.equal(pickServiceReportExcelEntry(folder, INSPECTION_EXCEL)?.name, INSPECTION_EXCEL);
  });

  test("엑셀 이름을 단 **폴더**만 있으면 null", () => {
    const folder = [entry({ name: INSPECTION_EXCEL, isDirectory: true })];
    assert.equal(pickServiceReportExcelEntry(folder, INSPECTION_EXCEL), null);
  });
});

// ── 누른 뒤의 흐름 ───────────────────────────────────────────────────────

describe("누르면 — 맨 위 칸 한 번, 분류 폴더 한 번, 고른 파일 하나를 여는 장치로", () => {
  test("여는 장치는 **분류 폴더까지의 경로와 파일 이름 하나**를 받는다", async () => {
    const seen: string[] = [];
    const spy = spyOpen();
    const outcome = await runServiceReportExcelOpen({
      repairCaseId: CASE_ID,
      reportKind: "INSPECTION",
      fileName: INSPECTION_EXCEL,
      env: {
        fetchImpl: fetchTree({ "": TOP_WITH_BOTH, [INSPECTION_FOLDER]: found([{ name: INSPECTION_EXCEL }]) }, seen),
        openFile: spy.open,
      },
    });
    assert.deepEqual(spy.calls, [{ folderName: INSPECTION_PATH, fileName: INSPECTION_EXCEL }]);
    assert.equal(outcome.kind, "OPENED");
    assert.deepEqual(seen, [
      contactFolderEntriesUrl(CASE_ID),
      contactFolderEntriesUrl(CASE_ID, INSPECTION_FOLDER),
    ]);
  });

  test("🔴 「열리지 않으면 도우미를 다시 설치해 주세요」와 설치 단추가 그대로 따라온다 — 끄지 않는다", async () => {
    const spy = spyOpen();
    const outcome = await runServiceReportExcelOpen({
      repairCaseId: CASE_ID,
      reportKind: "INSPECTION",
      fileName: INSPECTION_EXCEL,
      env: {
        fetchImpl: fetchTree({ "": TOP_WITH_BOTH, [INSPECTION_FOLDER]: found([{ name: INSPECTION_EXCEL }]) }),
        openFile: spy.open,
      },
    });
    assert.ok(texts(outcome).includes(CONTACT_FOLDER_FILE_HELPER_REINSTALL_TEXT), texts(outcome).join(" / "));
    assert.equal(outcome.offerHelperInstall, true);
  });

  test("🔴 바꿔 끼우지 않으면 **이미 있는 여는 장치**가 돈다 — 제 사본을 두지 않았다", async () => {
    // DOM 이 없는 이 환경에서는 그 장치가 「주소를 열지 못했다」로 끝난다. 여기서 보는 것은
    // **그 장치를 거쳤다**는 사실이다(베낀 구현이 따로 있으면 이 결과가 나오지 않는다).
    const outcome = await runServiceReportExcelOpen({
      repairCaseId: CASE_ID,
      reportKind: "INSPECTION",
      fileName: INSPECTION_EXCEL,
      env: {
        fetchImpl: fetchTree({ "": TOP_WITH_BOTH, [INSPECTION_FOLDER]: found([{ name: INSPECTION_EXCEL }]) }),
      },
    });
    assert.equal(outcome.kind, "OPENED");
    assert.ok(outcome.lines.length > 0);
  });
});

// ── ⑤ 검사 ↔ 수리 ───────────────────────────────────────────────────────

describe("⑤ 🔴 검사와 수리를 섞지 않는다", () => {
  const tree = {
    "": TOP_WITH_BOTH,
    [INSPECTION_FOLDER]: found([{ name: INSPECTION_EXCEL }]),
    [REPAIR_FOLDER]: found([{ name: REPAIR_EXCEL }]),
  };

  test("수리 보고서 줄은 **수리 폴더**만 읽고 수리 엑셀을 연다", async () => {
    const seen: string[] = [];
    const spy = spyOpen();
    await runServiceReportExcelOpen({
      repairCaseId: CASE_ID,
      reportKind: "REPAIR",
      fileName: REPAIR_EXCEL,
      env: { fetchImpl: fetchTree(tree, seen), openFile: spy.open },
    });
    assert.deepEqual(spy.calls, [{ folderName: REPAIR_PATH, fileName: REPAIR_EXCEL }]);
    assert.equal(
      seen.some((url) => url === contactFolderEntriesUrl(CASE_ID, INSPECTION_FOLDER)),
      false,
      "검사 폴더를 읽으러 갔다"
    );
  });

  test("검사 보고서 줄은 **검사 폴더**만 읽는다", async () => {
    const seen: string[] = [];
    const spy = spyOpen();
    await runServiceReportExcelOpen({
      repairCaseId: CASE_ID,
      reportKind: "INSPECTION",
      fileName: INSPECTION_EXCEL,
      env: { fetchImpl: fetchTree(tree, seen), openFile: spy.open },
    });
    assert.deepEqual(spy.calls, [{ folderName: INSPECTION_PATH, fileName: INSPECTION_EXCEL }]);
    assert.equal(seen.some((url) => url === contactFolderEntriesUrl(CASE_ID, REPAIR_FOLDER)), false, "수리 폴더를 읽으러 갔다");
  });
});

// ── ③ 못 찾으면 열지 않는다 ─────────────────────────────────────────────

describe("③ 🔴 못 찾으면 — 열지 않고 「저장된 파일이 없습니다.」", () => {
  test("문장은 견적서 [Excel 보기]와 **같은 한 벌**이다(사용자가 직접 말한 문장)", () => {
    assert.equal(SERVICE_REPORT_EXCEL_NOT_SAVED_TEXT, QUOTE_ARCHIVE_EXCEL_NOT_SAVED_TEXT);
  });

  test("🔴 분류 폴더가 아직 없다(한 번도 저장 안 한 보고서) — **읽으러 가지도 않는다**", async () => {
    const seen: string[] = [];
    const spy = spyOpen();
    const outcome = await runServiceReportExcelOpen({
      repairCaseId: CASE_ID,
      reportKind: "INSPECTION",
      fileName: INSPECTION_EXCEL,
      env: {
        fetchImpl: fetchTree({ "": found([{ name: "DATA", isDirectory: true }]) }, seen),
        openFile: spy.open,
      },
    });
    assert.equal(outcome.kind, "FILE_NOT_FOUND");
    assert.deepEqual(texts(outcome), [SERVICE_REPORT_EXCEL_NOT_SAVED_TEXT]);
    assert.deepEqual(spy.calls, [], "열었다");
    assert.deepEqual(seen, [contactFolderEntriesUrl(CASE_ID)], "없는 자리를 읽으러 갔다");
  });

  test("분류 폴더는 섰는데 **그 보고서의 엑셀이 없다** — 남의 장을 열지 않는다", async () => {
    const spy = spyOpen();
    const outcome = await runServiceReportExcelOpen({
      repairCaseId: CASE_ID,
      reportKind: "INSPECTION",
      fileName: INSPECTION_EXCEL,
      env: {
        fetchImpl: fetchTree({
          "": TOP_WITH_BOTH,
          [INSPECTION_FOLDER]: found([
            { name: "검사보고서_RFK300FH-AD1_WU8042_1612027.xlsx", modifiedAt: "2026-10-11T01:00:00.000Z" },
            { name: INSPECTION_EXCEL.replace(/\.xlsx$/u, ".pdf") },
          ]),
        }),
        openFile: spy.open,
      },
    });
    assert.equal(outcome.kind, "FILE_NOT_FOUND");
    assert.deepEqual(spy.calls, [], "남의 장을 열었다");
  });

  test("🔴 같은 이름의 **파일**이 분류 폴더 자리를 막고 있으면 들어가지 않는다", async () => {
    const spy = spyOpen();
    const outcome = await runServiceReportExcelOpen({
      repairCaseId: CASE_ID,
      reportKind: "INSPECTION",
      fileName: INSPECTION_EXCEL,
      env: {
        // 폴더가 아니라 **파일**로 서 있다 — 분류 폴더가 없는 것과 같이 본다.
        fetchImpl: fetchTree({ "": found([{ name: INSPECTION_FOLDER }]) }),
        openFile: spy.open,
      },
    });
    assert.equal(outcome.kind, "FILE_NOT_FOUND");
    assert.deepEqual(spy.calls, []);
  });

  test("목록이 잘렸으면 그 사실을 한 줄 곁들인다 — 「없다」고 단언하지 않는다", async () => {
    const outcome = await runServiceReportExcelOpen({
      repairCaseId: CASE_ID,
      reportKind: "INSPECTION",
      fileName: INSPECTION_EXCEL,
      env: {
        fetchImpl: fetchTree({
          "": TOP_WITH_BOTH,
          [INSPECTION_FOLDER]: found([{ name: "다른 파일.xlsx" }], { truncated: true, totalCount: 400 }),
        }),
        openFile: spyOpen().open,
      },
    });
    assert.deepEqual(texts(outcome), [SERVICE_REPORT_EXCEL_NOT_SAVED_TEXT, QUOTE_ARCHIVE_EXCEL_TRUNCATED_TEXT]);
  });

  test("이름을 못 지은 줄(빈 글자)은 **아무것도 열지 않는다**", async () => {
    const spy = spyOpen();
    const outcome = await runServiceReportExcelOpen({
      repairCaseId: CASE_ID,
      reportKind: "INSPECTION",
      fileName: "",
      env: {
        fetchImpl: fetchTree({ "": TOP_WITH_BOTH, [INSPECTION_FOLDER]: found([{ name: INSPECTION_EXCEL }]) }),
        openFile: spy.open,
      },
    });
    assert.equal(outcome.kind, "FILE_NOT_FOUND");
    assert.deepEqual(spy.calls, []);
  });
});

// ── ④ 꺼짐 · 폴더 없음 · 여럿 · 읽기 실패 ───────────────────────────────

describe("④ 사실대로 알린다 — 조용히 아무 일도 안 하지 않는다", () => {
  async function runWithTop(payload: unknown, seen: string[] = []) {
    const spy = spyOpen();
    const outcome = await runServiceReportExcelOpen({
      repairCaseId: CASE_ID,
      reportKind: "INSPECTION",
      fileName: INSPECTION_EXCEL,
      env: { fetchImpl: fetchTree({ "": payload }, seen), openFile: spy.open },
    });
    return { outcome, calls: spy.calls };
  }

  test("🔴 공유폴더가 꺼져 있다 — 한 번만 묻고 끝난다", async () => {
    const seen: string[] = [];
    const { outcome, calls } = await runWithTop({ status: "disabled" }, seen);
    assert.equal(outcome.kind, "DISABLED");
    assert.deepEqual(texts(outcome), [QUOTE_FOLDER_DISABLED_TEXT]);
    assert.deepEqual(calls, []);
    assert.deepEqual(seen, [contactFolderEntriesUrl(CASE_ID)]);
  });

  test("아직 이 건의 폴더가 없다", async () => {
    const { outcome, calls } = await runWithTop({ status: "not-found" });
    assert.equal(outcome.kind, "FOLDER_NOT_FOUND");
    assert.deepEqual(texts(outcome), [CONTACT_FOLDER_SECTION_NOT_FOUND_TEXT]);
    assert.deepEqual(calls, []);
  });

  test("🔴 맞는 폴더가 여럿이다 — 어느 폴더인지 모르는 채로 열지 않는다", async () => {
    const { outcome, calls } = await runWithTop({ status: "multiple", folderNames: [FOLDER, `${FOLDER} 사본`] });
    assert.equal(outcome.kind, "FOLDER_MULTIPLE");
    assert.deepEqual(texts(outcome), [CONTACT_FOLDER_SECTION_MULTIPLE_TEXT]);
    assert.deepEqual(calls, []);
  });

  test("공유폴더를 읽지 못했다 — 서버가 준 짧은 사유를 그대로 곁들인다", async () => {
    const { outcome, calls } = await runWithTop({ status: "failed", reason: "공유폴더가 느립니다" });
    assert.equal(outcome.kind, "FOLDER_FAILED");
    assert.deepEqual(texts(outcome), [CONTACT_FOLDER_SECTION_FAILED_TEXT, "공유폴더가 느립니다"]);
    assert.deepEqual(calls, []);
  });

  test("분류 폴더 **안**을 못 읽었을 때도 열지 않는다", async () => {
    const spy = spyOpen();
    const outcome = await runServiceReportExcelOpen({
      repairCaseId: CASE_ID,
      reportKind: "INSPECTION",
      fileName: INSPECTION_EXCEL,
      env: {
        fetchImpl: fetchTree({ "": TOP_WITH_BOTH, [INSPECTION_FOLDER]: { status: "failed", reason: "권한이 없습니다" } }),
        openFile: spy.open,
      },
    });
    assert.equal(outcome.kind, "FOLDER_FAILED");
    assert.deepEqual(texts(outcome), [CONTACT_FOLDER_SECTION_FAILED_TEXT, "권한이 없습니다"]);
    assert.deepEqual(spy.calls, []);
  });

  test("통로가 닿지 않아도 던지지 않는다", async () => {
    const spy = spyOpen();
    const outcome = await runServiceReportExcelOpen({
      repairCaseId: CASE_ID,
      reportKind: "INSPECTION",
      fileName: INSPECTION_EXCEL,
      env: {
        fetchImpl: async () => {
          throw new Error("offline");
        },
        openFile: spy.open,
      },
    });
    assert.equal(outcome.kind, "FOLDER_FAILED");
    assert.deepEqual(spy.calls, []);
  });
});

// ── ⑦ 경로를 알리지 않는다 ───────────────────────────────────────────────

describe("⑦ 🔴 알림에 경로가 한 글자도 없다", () => {
  const payloads: unknown[] = [
    { status: "disabled" },
    { status: "not-found" },
    { status: "multiple", folderNames: [FOLDER] },
    { status: "failed", reason: "공유폴더가 느립니다" },
    found([{ name: "DATA", isDirectory: true }]),
  ];

  test("어느 갈래에서도 연락서 폴더 이름 · 분류 폴더 이름이 줄에 안 나온다", async () => {
    for (const payload of payloads) {
      const outcome = await runServiceReportExcelOpen({
        repairCaseId: CASE_ID,
        reportKind: "INSPECTION",
        fileName: INSPECTION_EXCEL,
        env: { fetchImpl: fetchTree({ "": payload }), openFile: spyOpen().open },
      });
      const joined = texts(outcome).join(" / ");
      assert.equal(joined.includes(FOLDER), false, joined);
      assert.equal(joined.includes(INSPECTION_PATH), false, joined);
    }
  });
});

// ── ⑨ 원본을 글자로 — 읽고 여는 것뿐이다 ────────────────────────────────

const flowSource = readFileSync(new URL("./service-report-excel-open.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const buttonSource = readFileSync(new URL("./ServiceReportExcelOpenButton.tsx", import.meta.url), "utf8").replace(
  /\r\n/g,
  "\n"
);
const listSource = readFileSync(new URL("./ServiceReportList.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const reportPage = readFileSync(
  new URL("../../../app/(app)/repair-cases/[id]/report/page.tsx", import.meta.url),
  "utf8"
).replace(/\r\n/g, "\n");

/** 주석을 뺀 원본 — 머리말이 까닭을 설명하느라 적은 낱말에 걸리지 않게. */
const withoutComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

describe("⑨ 🔴 읽고 여는 것뿐이다", () => {
  test("새 원본 셋에 만들기 · 쓰기 · 지우기가 한 글자도 없다", () => {
    for (const [name, source] of [
      ["흐름", flowSource],
      ["단추", buttonSource],
      ["목록", listSource],
    ] as const) {
      const code = withoutComments(source);
      for (const forbidden of ["mkdir", "writeFile", "unlink", "node:fs", "rename(", " rm(", "@/lib/storage/"]) {
        assert.equal(code.includes(forbidden), false, `${name} 원본에 ${forbidden} 가 있다`);
      }
    }
  });

  test("🔴 분류 폴더 이름 · 번호 꼬리를 글자로 적지 않았다 — 도메인 함수가 정한다", () => {
    const code = withoutComments(flowSource);
    assert.equal(code.includes("검사 보고서"), false);
    assert.equal(code.includes("수리 보고서"), false);
    assert.ok(code.includes("numberedContactFolderFileName("), "번호 붙이기를 가져다 쓰지 않았다");
    assert.ok(code.includes("serviceReportFolderCategoryName("), "분류 폴더 이름을 가져다 쓰지 않았다");
  });

  test("🔴 두 번 눌러도 두 번 열리지 않는다 — 단추가 잠근다", () => {
    assert.ok(buttonSource.includes("if (busy) return;"), buttonSource);
    assert.ok(buttonSource.includes("disabled={busy}"));
    assert.equal(buttonSource.split("runServiceReportExcelOpen(").length - 1, 1, "흐름을 부르는 곳이 하나가 아니다");
  });

  test("🔴 Windows 가 아니면 단추가 아예 없다", () => {
    assert.ok(buttonSource.includes("if (!isWindows) return null;"), buttonSource);
  });
});

describe("화면이 바뀐 자리 — [엑셀 받기]가 [Excel 보기]로", () => {
  test("🔴 목록 줄에 「엑셀 받기」도 내려받기 주소도 남아 있지 않다", () => {
    const code = withoutComments(listSource);
    assert.equal(code.includes("엑셀 받기"), false, code);
    assert.equal(code.includes("xlsxHref"), false, code);
    assert.equal(code.includes("service-report/xlsx"), false, code);
    assert.ok(code.includes("<ServiceReportExcelOpenButton"), code);
  });

  test("🔴 단추의 글자는 단추가 쥔다 — 목록이 들고 있는 것은 보조기술용 이름뿐이다", () => {
    const code = withoutComments(listSource);
    // 목록에 남은 「Excel 보기」는 **aria-label 한 자리**뿐이다(화면에 찍히는 글자가 아니다).
    assert.equal(code.split("Excel 보기").length - 1, 1, code);
    assert.ok(code.includes("ariaLabel={`${row.kindLabel} ${row.name} Excel 보기`}"), code);
    assert.ok(buttonSource.includes('{busy ? "여는 중…" : "Excel 보기"}'), buttonSource);
  });

  test("🔴 페이지가 **쓰는 길과 같은 두 함수**로 이름을 짓는다", () => {
    const page = withoutComments(reportPage);
    assert.ok(
      page.includes("contactFolderCopyFileName(serviceReportFileNameFromListName(item.kind, item.name))"),
      reportPage
    );
  });

  test("🔴 문턱은 예전 [엑셀 받기] 그대로다 — 이 조각이 넓히지 않았다", () => {
    assert.ok(reportPage.includes("const canOpenExcel = canEditServiceReports(level);"), reportPage);
    assert.ok(reportPage.includes("excelFileName: canOpenExcel"), reportPage);
  });

  test("🔴 내려받기 통로는 그대로 살아 있다 — 지우지 않았다", () => {
    const route = readFileSync(
      new URL("../../../app/api/repair-cases/[id]/service-report/xlsx/route.ts", import.meta.url),
      "utf8"
    );
    assert.ok(route.includes("export async function GET"), "내려받기 통로가 사라졌다");
  });
});
