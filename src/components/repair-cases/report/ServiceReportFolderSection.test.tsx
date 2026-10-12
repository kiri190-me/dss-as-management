import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  CONTACT_FOLDER_SECTION_FAILED_TEXT,
  CONTACT_FOLDER_SECTION_INSIDE_EMPTY_TEXT,
  CONTACT_FOLDER_SECTION_LOADING_TEXT,
  CONTACT_FOLDER_SECTION_MULTIPLE_TEXT,
  CONTACT_FOLDER_SECTION_NOT_FOUND_TEXT,
  contactFolderEntriesUrl,
  type ContactFolderEntriesFetch,
} from "@/components/repair-cases/files/ContactFolderSection";
import { SHARE_FOLDER_ENTRY_ROW_CLASS } from "@/lib/domain/share-folder-entry-meta";
import ServiceReportFolderSection, {
  SERVICE_REPORT_FOLDER_GROUP_FAILED_TEXT,
  SERVICE_REPORT_FOLDER_KINDS,
  SERVICE_REPORT_FOLDER_SECTION_NO_REPORTS_TEXT,
  SERVICE_REPORT_FOLDER_SECTION_SCOPE_TEXT,
  SERVICE_REPORT_FOLDER_SECTION_TITLE,
  ServiceReportFolderSectionView,
  findServiceReportCategoryFolderName,
  loadServiceReportFolderEntries,
  serviceReportFolderCategoryLabel,
  serviceReportFolderCategoryName,
  type ServiceReportFolderSectionState,
} from "./ServiceReportFolderSection";

/**
 * ============================================================================
 * 「보고서」 탭의 공유폴더 구역 — 보고서 분류 폴더 둘만, 한 창에 (2026-10-12)
 * ============================================================================
 * 통로 쪽 규율은 app/api/repair-cases/*\/contact-folder/entries/route-source.test.ts 가,
 * 실제 읽기는 lib/storage/contact-folder-entries.test.ts 가 이미 본다 — **한 줄도 고치지
 * 않았다.** 여기서 보는 것은 이 구역이 **무엇만 묻고 무엇만 보이는가**다.
 * ============================================================================
 */

const sectionSource = readFileSync(new URL("./ServiceReportFolderSection.tsx", import.meta.url), "utf8").replace(
  /\r\n/g,
  "\n"
);
const reportPage = readFileSync(
  new URL("../../../app/(app)/repair-cases/[id]/report/page.tsx", import.meta.url),
  "utf8"
).replace(/\r\n/g, "\n");

/** 주석을 뺀 원본 — 머리말이 까닭을 설명하느라 적은 낱말에 걸리지 않게. */
const withoutComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

const CASE_ID = "case-1";
const FOLDER = "D260908 INVENIA T2RCONT-AD2 WN3947 1802034 점검요청";

/** 🔴 폴더 이름은 **도메인 함수가 정한 것**을 쓴다 — 시험도 글자로 적지 않는다. */
const INSPECTION_FOLDER = serviceReportFolderCategoryName("INSPECTION") ?? "";
const REPAIR_FOLDER = serviceReportFolderCategoryName("REPAIR") ?? "";

const INSPECTION_XLSX = "검사보고서_T2RCONT-AD2_WN3947_1802034.xlsx";
const INSPECTION_PDF = "검사보고서_T2RCONT-AD2_WN3947_1802034.pdf";
/** 🔴 덮어쓰지 않고 번호로 비켜 간 파일 — 앞 조각이 실제로 만든다. */
const INSPECTION_XLSX_2 = "검사보고서_T2RCONT-AD2_WN3947_1802034 (2).xlsx";
const REPAIR_XLSX = "수리보고서_T2RCONT-AD2_WN3947_1802034.xlsx";

type Body = Record<string, unknown>;

const dir = (name: string) => ({ name, isDirectory: true, sizeBytes: 0 });
const file = (name: string, sizeBytes = 1024) => ({
  name,
  isDirectory: false,
  sizeBytes,
  modifiedAt: "2026-10-12T02:00:00.000Z",
});

const listed = (entries: ReadonlyArray<Body>, extra: Body = {}): Body => ({
  status: "found",
  folderName: FOLDER,
  entries,
  totalCount: entries.length,
  truncated: false,
  ...extra,
});

/** 주소별로 답을 돌려주는 가짜 통로 — 네트워크 없이 값으로 시험한다. */
function stub(answers: Record<string, Body>) {
  const urls: string[] = [];
  const fetchImpl: ContactFolderEntriesFetch = (url) => {
    urls.push(url);
    const body = answers[url];
    if (body === undefined) {
      return Promise.resolve({
        ok: false,
        status: 404,
        json: () => Promise.resolve({ error: "묻지 않아야 할 주소다" }),
      });
    }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
  };
  return { urls, fetchImpl };
}

/** 두 분류 폴더가 다 서 있고 그 안에 보고서가 든 보통의 건. */
function fullArchive() {
  return stub({
    [contactFolderEntriesUrl(CASE_ID)]: listed([
      dir("DATA"),
      dir("공통"),
      dir("인수 사진"),
      dir("견적서"),
      dir(INSPECTION_FOLDER),
      dir(REPAIR_FOLDER),
      file("연락서스캔.pdf"),
    ]),
    [contactFolderEntriesUrl(CASE_ID, INSPECTION_FOLDER)]: listed([
      file(INSPECTION_XLSX),
      file(INSPECTION_PDF),
      file(INSPECTION_XLSX_2),
    ]),
    [contactFolderEntriesUrl(CASE_ID, REPAIR_FOLDER)]: listed([file(REPAIR_XLSX)]),
  });
}

const markup = (state: ServiceReportFolderSectionState): string =>
  renderToStaticMarkup(createElement(ServiceReportFolderSectionView, { state }));

const groupCount = (html: string): number => html.split("data-service-report-folder-group").length - 1;

describe("🔴 보고서 분류 폴더 **둘만** 묻는다 — 다른 분류 · 폴더 바로 아래 파일은 안 본다", () => {
  test("묻는 주소는 맨 위 칸 한 번 + 분류 폴더 둘뿐이다", async () => {
    const { urls, fetchImpl } = fullArchive();
    await loadServiceReportFolderEntries(CASE_ID, fetchImpl);
    assert.deepEqual(urls, [
      contactFolderEntriesUrl(CASE_ID),
      contactFolderEntriesUrl(CASE_ID, INSPECTION_FOLDER),
      contactFolderEntriesUrl(CASE_ID, REPAIR_FOLDER),
    ]);
    // 🔴 인수 사진 · 견적서 · DATA · 공통 을 읽으러 간 적이 없다.
    for (const never of ["인수 사진", "견적서", "DATA", "공통"]) {
      assert.equal(
        urls.some((url) => url.includes(encodeURIComponent(never))),
        false,
        `${never} 를 읽으러 갔다`
      );
    }
  });

  test("🔴 보이는 줄은 보고서뿐 — 다른 분류 폴더도, 폴더 바로 아래 파일도 안 보인다", async () => {
    const { fetchImpl } = fullArchive();
    const html = markup(await loadServiceReportFolderEntries(CASE_ID, fetchImpl));
    assert.ok(html.includes(INSPECTION_XLSX), html);
    assert.ok(html.includes(REPAIR_XLSX), html);
    for (const hidden of ["인수 사진", "견적서", "DATA", "공통", "연락서스캔.pdf"]) {
      assert.equal(html.includes(hidden), false, `${hidden} 가 보인다`);
    }
  });

  test("🔴 같은 이름의 **파일**이 자리를 막고 있으면 분류 폴더로 치지 않는다", () => {
    assert.equal(findServiceReportCategoryFolderName([file(INSPECTION_FOLDER)], INSPECTION_FOLDER), null);
    assert.equal(findServiceReportCategoryFolderName([dir(INSPECTION_FOLDER)], INSPECTION_FOLDER), INSPECTION_FOLDER);
  });

  test("🔴 견줄 때만 다듬고 — 경로는 **디스크의 실제 이름**으로 잇는다", async () => {
    // 사람이 풀어쓴(NFD) 이름으로 만들어 둔 폴더. 다듬은 이름으로 이으면 없는 폴더가 된다.
    const onDisk = INSPECTION_FOLDER.normalize("NFD");
    assert.notEqual(onDisk, INSPECTION_FOLDER, "표본이 NFD 가 아니다");
    assert.equal(findServiceReportCategoryFolderName([dir(onDisk)], INSPECTION_FOLDER), onDisk);

    const { urls, fetchImpl } = stub({
      [contactFolderEntriesUrl(CASE_ID)]: listed([dir(onDisk)]),
      [contactFolderEntriesUrl(CASE_ID, onDisk)]: listed([file(INSPECTION_XLSX)]),
    });
    const state = await loadServiceReportFolderEntries(CASE_ID, fetchImpl);
    assert.deepEqual(urls, [contactFolderEntriesUrl(CASE_ID), contactFolderEntriesUrl(CASE_ID, onDisk)]);
    assert.equal(state.kind, "found");
    if (state.kind !== "found") throw new Error("unreachable");
    assert.equal(state.groups[0]?.relativePath, `${FOLDER}/${onDisk}`);
  });
});

describe("🔴 검사 · 수리가 **한 창에** 모인다", () => {
  test("구역은 하나, 묶음은 둘 — 검사가 먼저다", async () => {
    const { fetchImpl } = fullArchive();
    const state = await loadServiceReportFolderEntries(CASE_ID, fetchImpl);
    assert.equal(state.kind, "found");
    if (state.kind !== "found") throw new Error("unreachable");
    assert.deepEqual(
      state.groups.map((group) => group.reportKind),
      ["INSPECTION", "REPAIR"]
    );
    assert.deepEqual(SERVICE_REPORT_FOLDER_KINDS, ["INSPECTION", "REPAIR"]);

    const html = markup(state);
    assert.equal(html.split("data-service-report-folder-section").length - 1, 1, "구역이 둘 이상이다");
    assert.equal(groupCount(html), 2, html);
    // 줄에 딱지를 붙이지 않는다 — 어느 보고서인지는 **묶음 머리**가 가른다.
    const inspectionAt = html.indexOf(serviceReportFolderCategoryLabel("INSPECTION"));
    const repairAt = html.indexOf(serviceReportFolderCategoryLabel("REPAIR"));
    assert.ok(inspectionAt >= 0 && repairAt >= 0, html);
    assert.ok(inspectionAt < html.indexOf(INSPECTION_XLSX), "검사 머리가 검사 파일보다 뒤에 있다");
    assert.ok(html.indexOf(INSPECTION_XLSX) < repairAt, "검사 줄이 수리 머리 뒤로 갔다");
    assert.ok(repairAt < html.indexOf(REPAIR_XLSX), "수리 머리가 수리 파일보다 뒤에 있다");
  });

  test("🔴 `… (2).xlsx` 처럼 번호가 붙은 파일도 보인다", async () => {
    const { fetchImpl } = fullArchive();
    const html = markup(await loadServiceReportFolderEntries(CASE_ID, fetchImpl));
    assert.ok(html.includes(INSPECTION_XLSX_2), html);
    assert.ok(html.includes(INSPECTION_PDF), html);
  });

  test("한 종류만 저장한 건에서는 묶음도 하나다", async () => {
    const { urls, fetchImpl } = stub({
      [contactFolderEntriesUrl(CASE_ID)]: listed([dir("인수 사진"), dir(REPAIR_FOLDER)]),
      [contactFolderEntriesUrl(CASE_ID, REPAIR_FOLDER)]: listed([file(REPAIR_XLSX)]),
    });
    const html = markup(await loadServiceReportFolderEntries(CASE_ID, fetchImpl));
    assert.deepEqual(urls, [contactFolderEntriesUrl(CASE_ID), contactFolderEntriesUrl(CASE_ID, REPAIR_FOLDER)]);
    assert.equal(groupCount(html), 1, html);
    assert.ok(html.includes(REPAIR_XLSX), html);
    assert.equal(html.includes(SERVICE_REPORT_FOLDER_SECTION_NO_REPORTS_TEXT), false, html);
  });

  test("표의 생김새는 공용 한 벌을 그대로 쓴다 — 열을 더하지 않았다", async () => {
    const { fetchImpl } = fullArchive();
    const html = markup(await loadServiceReportFolderEntries(CASE_ID, fetchImpl));
    const rows = [...html.matchAll(/<li[^>]*\sclass="([^"]*)"/g)].map((match) => match[1] ?? "");
    assert.equal(rows.length, 4, html);
    for (const row of rows) assert.equal(row, SHARE_FOLDER_ENTRY_ROW_CLASS, row);
  });
});

describe("🔴 분류 폴더가 아직 없어도 화면이 깨지지 않는다", () => {
  test("한 번도 저장하지 않은 건 — 더 묻지 않고 「아직 저장된 보고서가 없습니다」", async () => {
    const { urls, fetchImpl } = stub({
      [contactFolderEntriesUrl(CASE_ID)]: listed([dir("DATA"), dir("인수 사진"), file("연락서스캔.pdf")]),
    });
    const state = await loadServiceReportFolderEntries(CASE_ID, fetchImpl);
    // 🔴 없는 자리를 읽으러 가지 않는다 — 가면 「하위 폴더를 찾을 수 없습니다」가 빨갛게 선다.
    assert.deepEqual(urls, [contactFolderEntriesUrl(CASE_ID)]);
    assert.equal(state.kind, "found");
    if (state.kind !== "found") throw new Error("unreachable");
    assert.deepEqual(state.groups, []);

    const html = markup(state);
    assert.ok(html.includes(SERVICE_REPORT_FOLDER_SECTION_NO_REPORTS_TEXT), html);
    assert.equal(html.includes(SERVICE_REPORT_FOLDER_GROUP_FAILED_TEXT), false, html);
    assert.equal(html.includes(CONTACT_FOLDER_SECTION_FAILED_TEXT), false, html);
    assert.equal(html.includes("text-amber-700"), false, "아무 일도 없는 건에 경고가 섰다");
  });

  test("분류 폴더는 섰는데 비어 있으면 그 묶음만 「이 폴더가 비어 있습니다」", async () => {
    const { fetchImpl } = stub({
      [contactFolderEntriesUrl(CASE_ID)]: listed([dir(INSPECTION_FOLDER)]),
      [contactFolderEntriesUrl(CASE_ID, INSPECTION_FOLDER)]: listed([]),
    });
    const html = markup(await loadServiceReportFolderEntries(CASE_ID, fetchImpl));
    assert.ok(html.includes(CONTACT_FOLDER_SECTION_INSIDE_EMPTY_TEXT), html);
    assert.equal(html.includes("<ul"), false, "빈 폴더인데 목록 틀을 그렸다");
  });

  test("한 분류만 못 읽어도 다른 분류는 그대로 보인다", async () => {
    const { fetchImpl } = stub({
      [contactFolderEntriesUrl(CASE_ID)]: listed([dir(INSPECTION_FOLDER), dir(REPAIR_FOLDER)]),
      [contactFolderEntriesUrl(CASE_ID, INSPECTION_FOLDER)]: { status: "failed", reason: "공유폴더가 느립니다." },
      [contactFolderEntriesUrl(CASE_ID, REPAIR_FOLDER)]: listed([file(REPAIR_XLSX)]),
    });
    const html = markup(await loadServiceReportFolderEntries(CASE_ID, fetchImpl));
    assert.ok(html.includes(SERVICE_REPORT_FOLDER_GROUP_FAILED_TEXT), html);
    assert.ok(html.includes("공유폴더가 느립니다."), html);
    assert.ok(html.includes(REPAIR_XLSX), html);
  });
});

describe("🔴 공유폴더가 꺼져 있거나 못 읽어도 보고서 탭이 뜬다", () => {
  test("disabled 면 구역을 **아예 안 그린다** — 꺼진 개발 PC 에서 빈 상자가 늘지 않게", async () => {
    const { urls, fetchImpl } = stub({ [contactFolderEntriesUrl(CASE_ID)]: { status: "disabled" } });
    const state = await loadServiceReportFolderEntries(CASE_ID, fetchImpl);
    assert.deepEqual(state, { kind: "disabled" });
    assert.deepEqual(urls, [contactFolderEntriesUrl(CASE_ID)], "꺼져 있는데 더 물었다");
    assert.equal(markup(state), "");
  });

  test("네트워크가 끊겨도 던지지 않는다 — 이 구역만 「읽지 못했습니다」가 된다", async () => {
    const state = await loadServiceReportFolderEntries(CASE_ID, () => Promise.reject(new Error("끊김")));
    assert.equal(state.kind, "failed");
    const html = markup(state);
    assert.ok(html.includes(CONTACT_FOLDER_SECTION_FAILED_TEXT), html);
    // 보고서 목록 · 갈림길의 말은 이 구역이 그리지 않는다.
    for (const elsewhere of ["검사보고서 작성", "휴지통", "사용중"]) {
      assert.equal(html.includes(elsewhere), false, html);
    }
  });

  test("서버가 거절해도 상태 하나로 끝난다", async () => {
    const state = await loadServiceReportFolderEntries(CASE_ID, () =>
      Promise.resolve({ ok: false, status: 403, json: () => Promise.resolve({ error: "권한이 없습니다." }) })
    );
    assert.deepEqual(state, { kind: "failed", reason: "권한이 없습니다." });
  });

  test("not-found · multiple — 목록을 내지 않는다", async () => {
    const notFound = await loadServiceReportFolderEntries(CASE_ID, () =>
      Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ status: "not-found" }) })
    );
    assert.deepEqual(notFound, { kind: "not-found" });
    assert.ok(markup(notFound).includes(CONTACT_FOLDER_SECTION_NOT_FOUND_TEXT));

    const multiple = await loadServiceReportFolderEntries(CASE_ID, () =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ status: "multiple", folderNames: [FOLDER, `${FOLDER} 복사본`] }),
      })
    );
    assert.deepEqual(multiple, { kind: "multiple" });
    const html = markup(multiple);
    assert.ok(html.includes(CONTACT_FOLDER_SECTION_MULTIPLE_TEXT), html);
    // 🔴 어느 폴더인지 모르는 채로 내용도 이름도 보이지 않는다.
    assert.equal(html.includes(FOLDER), false, html);
    assert.equal(html.includes("<ul"), false, html);
  });

  test("불러오는 중 — 「불러오는 중…」 한 줄", () => {
    const html = markup({ kind: "loading" });
    assert.ok(html.includes(CONTACT_FOLDER_SECTION_LOADING_TEXT), html);
    assert.ok(html.includes(SERVICE_REPORT_FOLDER_SECTION_TITLE), html);
  });
});

describe("🔴 읽고 여는 것뿐이다 — 만들지도 쓰지도 지우지도 않는다", () => {
  const code = withoutComments(sectionSource);

  test("원본에 만들기 · 쓰기 · 지우기가 한 글자도 없다", () => {
    for (const forbidden of ["node:fs", "mkdir", "writeFile", "unlink", "rename", "\"POST\"", "\"PUT\"", "\"DELETE\""]) {
      assert.equal(code.includes(forbidden), false, `${forbidden} 가 들어왔다`);
    }
    // 🔴 [폴더 만들고 열기]가 달린 단추를 들이지 않았다 — 그것은 「파일 관리」 탭의 몫이다.
    assert.equal(code.includes("ContactFolderOpenButton"), false, "폴더를 만들 수 있는 단추를 들였다");
    assert.equal(code.includes("ContactFolderEntryOpenButton"), true, "줄의 [열기]를 가져다 쓰지 않았다");
    assert.equal(code.includes("ContactFolderPlaceOpenButton"), true, "자리 열기 단추를 가져다 쓰지 않았다");
  });

  test("🔴 분류 폴더 이름을 **글자로 적지 않는다** — 도메인 함수가 정한다", () => {
    for (const label of [serviceReportFolderCategoryLabel("INSPECTION"), serviceReportFolderCategoryLabel("REPAIR")]) {
      assert.equal(code.includes(label), false, `${label} 를 글자로 적었다`);
    }
    for (const category of ["INSPECTION_REPORT", "REPAIR_REPORT"]) {
      assert.equal(code.includes(category), false, `${category} 를 글자로 적었다`);
    }
    assert.ok(code.includes("contactFolderCategoryFolderName"), code);
    assert.ok(code.includes("serviceReportContactFolderCategory"), code);
    // 지금의 이름은 이것이다 — 바뀌면 저장 쪽과 함께 바뀐다.
    assert.equal(INSPECTION_FOLDER, "검사 보고서");
    assert.equal(REPAIR_FOLDER, "수리 보고서");
  });

  test("🔴 통로는 연락서 쪽 것 하나다 — 주소도 읽기도 베끼지 않았다", () => {
    assert.ok(code.includes("loadContactFolderEntries"), code);
    assert.equal(code.includes("/api/"), false, "주소를 따로 적었다");
    assert.equal(code.includes("fetch("), false, "fetch 를 따로 부른다");
  });

  test("🔴 절대 경로가 화면으로 나가지 않는다 — 루트 기준 상대 경로뿐", async () => {
    const { fetchImpl } = fullArchive();
    const state = await loadServiceReportFolderEntries(CASE_ID, fetchImpl);
    assert.equal(state.kind, "found");
    if (state.kind !== "found") throw new Error("unreachable");
    assert.deepEqual(
      state.groups.map((group) => group.relativePath),
      [`${FOLDER}/${INSPECTION_FOLDER}`, `${FOLDER}/${REPAIR_FOLDER}`]
    );
    const html = markup(state);
    for (const absolute of ["\\\\", "C:", "/mnt/", "2_AS센터"]) {
      assert.equal(html.includes(absolute), false, `${absolute} 가 화면에 나갔다`);
    }
  });

  test("Windows 가 아니면(서버 렌더) 단추가 하나도 안 그려진다 — 열 수 있는 줄에는 표시만 남는다", async () => {
    const { fetchImpl } = fullArchive();
    const html = markup(await loadServiceReportFolderEntries(CASE_ID, fetchImpl));
    assert.equal(html.includes("<button"), false, html);
    assert.equal(html.includes("href="), false, html);
    assert.ok(html.includes("data-service-report-folder-entry-openable"), html);
  });

  test("무엇만 보이는지 한 줄로 알린다 — 폴더 전체는 [폴더 열기]로", async () => {
    const { fetchImpl } = fullArchive();
    const html = markup(await loadServiceReportFolderEntries(CASE_ID, fetchImpl));
    assert.ok(html.includes(SERVICE_REPORT_FOLDER_SECTION_SCOPE_TEXT), html);
    // 못 찾은 화면에서는 할 말이 아니다.
    assert.equal(markup({ kind: "not-found" }).includes(SERVICE_REPORT_FOLDER_SECTION_SCOPE_TEXT), false);
  });

  test("인쇄에 안 찍힌다", () => {
    assert.ok(markup({ kind: "loading" }).includes("print:hidden"));
  });
});

describe("🔴 보고서 탭에 선 자리 — 서버가 공유폴더를 읽지 않는다", () => {
  test("목록 아래 · 갈림길 위, 자기 닫는 태그로 건 id 하나만 건넨다", () => {
    assert.equal(reportPage.split("<ServiceReportFolderSection").length - 1, 1, "구역이 둘 이상이다");
    assert.ok(
      reportPage.includes("{canView && <ServiceReportFolderSection repairCaseId={resolved.id} />}"),
      "건 id 를 건네지 않거나 문턱이 다르다"
    );
    const listAt = reportPage.indexOf("savedList");
    const sectionAt = reportPage.indexOf("<ServiceReportFolderSection");
    const choiceAt = reportPage.indexOf("<ReportKindChoice");
    assert.ok(listAt >= 0 && sectionAt >= 0 && choiceAt >= 0);
    assert.ok(listAt < sectionAt, "목록 위로 올라갔다");
    assert.ok(sectionAt < choiceAt, "갈림길 아래로 내려갔다");
  });

  test("🔴 페이지(서버 컴포넌트)가 공유폴더를 읽지 않는다 — NAS 가 꺼져도 탭이 뜬다", () => {
    const page = withoutComments(reportPage);
    for (const forbidden of ["@/lib/storage/", "node:fs", "listContactFolderEntries", "findContactFolder"]) {
      assert.equal(page.includes(forbidden), false, `${forbidden} 를 서버에서 부른다`);
    }
  });

  test("🔴 문턱은 목록과 같다 — 새 문턱을 만들지 않았다", () => {
    assert.ok(reportPage.includes("const canView = canViewServiceReports(level);"), reportPage);
    assert.equal(reportPage.includes("canEditServiceReports(level) && <ServiceReportFolderSection"), false);
  });
});

describe("기본 내보내기 — 화면이 뜬 뒤에 부른다", () => {
  test("첫 그림은 「불러오는 중…」이다(서버에서 읽지 않는다)", () => {
    const html = renderToStaticMarkup(createElement(ServiceReportFolderSection, { repairCaseId: CASE_ID }));
    assert.ok(html.includes(CONTACT_FOLDER_SECTION_LOADING_TEXT), html);
  });

  test("효과 안에서 한 번 부르고, 떠난 뒤의 답은 버린다", () => {
    const code = withoutComments(sectionSource);
    assert.ok(code.includes("loadServiceReportFolderEntries(repairCaseId)"), code);
    assert.ok(code.includes("if (!cancelled) setAnswer({ repairCaseId, state });"), code);
    assert.ok(code.includes("}, [repairCaseId]);"), code);
  });
});
