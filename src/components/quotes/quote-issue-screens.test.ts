import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * ============================================================================
 * 🔴 견적서를 브라우저로 내려받는 길이 화면에 하나도 없다 (2026-10-06)
 * ============================================================================
 * 2026-09-15(견적서 B1c)에는 세 화면(목록 · 편집 · 인쇄 미리보기)이 수정 권한자에게 발행
 * 단추(POST /api/quotes/{id}/issue — 공유폴더 저장 · 엑셀 칸 교체 · 내려주기)를 그렸다.
 * 같은 날 그 단추를 없애고 받기 링크(GET …/xlsx)를 남겼는데, 사용자가 화면을 보고 다시
 * 정했다 — 「내려받기도 아예 없앤다」. 그래서 **네 자리(목록의 표 · 카드, 인쇄 미리보기 두
 * 갈래, 편집 화면 머리)에서 받기를 모두 걷어냈다.** 견적서 엑셀은 [저장]이 사내 공유폴더에
 * 넣고(server/actions/quotes.ts 의 archiveDocumentAfterSave), 받는 길은 그 폴더 하나다.
 *
 * 견적서 목록 · QuoteEditForm · QuoteAttachmentsSection 은 서버 액션을 부르는 클라이언트
 * 컴포넌트라 이 시험 환경에서 그려 볼 수 없다(`server-only`). 그래서 이웃 시험
 * (quote-attachment-screens.test.ts · quote-list-screen-source.test.ts)과 같은 방법으로 원본을 글자로
 * 읽는다. 인쇄 미리보기가 실제로 무엇을 그리는지는 QuoteIssueButton.test.tsx 가 값으로 본다.
 *
 * 불변식 넷:
 *  (a) 🔴 **어느 화면에도 발행 단추(QuoteIssueButton)가 없다.**
 *  (b) 🔴 **어느 화면에도 받기 주소(`/xlsx`)가 없다** — 슬그머니 되살아나면 여기서 깨진다.
 *  (c) 못 하는 일은 말없이 감추지 않는다 — 같은 문장 하나로 까닭을 적는다.
 *  (d) 통로 · 조각 · 결과 줄은 살아 있다 — 결재 PDF 올리기가 같은 문장 함수를 쓴다.
 * ============================================================================
 */

const repoUrl = new URL("../../../", import.meta.url);
const read = (relativePath: string) =>
  readFileSync(new URL(relativePath, repoUrl), "utf8").replace(/\r\n/g, "\n");
const flat = (source: string) => source.replace(/\s+/g, " ");
const sliceBetween = (source: string, startMarker: string, endMarker: string) => {
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, `원본에서 '${startMarker}' 를 찾지 못했다`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(end > start, `원본에서 '${endMarker}' 를 찾지 못했다`);
  return source.slice(start, end);
};
/**
 * 주석을 뺀 원본 — 「무엇을 그리는가」를 볼 때 쓴다(quote-folder-open-screens.test.ts 와 같은
 * 도구). 머리말은 **없앤 길을 일부러 설명하므로**(「받기 링크는 2026-10-06 에 없앴다 —
 * GET …/xlsx」) 글자만 찾으면 헛걸린다.
 */
const withoutComments = (source: string) =>
  source.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

/**
 * 🔴 **목록 쪽 원본이 둘로 갈렸다**(2026-10-07 · 설계서 G절 조각 4). 화면은 공용 묶음의
 * 한 벌이 되었고(`vendor/dss-core`), 받기가 있던 자리를 포함해 A/S 에만 있는 조각은 전부
 * 그 화면이 비워 둔 **슬롯**으로 옮겨 갔다(QuoteListSlots.tsx). 받기가 되살아날 수 있는
 * 곳은 **슬롯 쪽**이므로 그것을 「목록」으로 읽는다 — 화면 쪽은 두 사이트가 함께 쓰는
 * 한 벌이라 받기가 애초에 없다.
 */
const list = read("src/components/quotes/QuoteListSlots.tsx");
const listScreen = read("vendor/dss-core/src/ui/quotes/QuoteListScreen.tsx");
const form = flat(read("src/components/quotes/QuoteEditForm.tsx"));
const printPage = flat(read("src/app/(app)/quotes/[id]/print/page.tsx"));
const printView = flat(read("src/components/quotes/QuotePrintView.tsx"));
const section = flat(read("src/components/quotes/QuoteAttachmentsSection.tsx"));
const button = flat(read("src/components/quotes/QuoteIssueButton.tsx"));

const bareForm = flat(withoutComments(read("src/components/quotes/QuoteEditForm.tsx")));
const barePrintView = flat(withoutComments(read("src/components/quotes/QuotePrintView.tsx")));

/** 받기가 있던 네 자리를 담은 화면 원본들 — 주석을 뺀 것. */
const SCREENS_WITHOUT_COMMENTS = [
  ["목록", flat(withoutComments(list))],
  ["편집 화면", bareForm],
  ["인쇄 미리보기", barePrintView],
  ["인쇄 미리보기 페이지", flat(withoutComments(read("src/app/(app)/quotes/[id]/print/page.tsx")))],
] as const;

describe("🔴 세 화면 어디에도 발행 단추가 없다", () => {
  test("목록 · 편집 · 인쇄 미리보기가 QuoteIssueButton 을 그리지 않는다", () => {
    for (const [name, source] of [
      ["목록", flat(list)],
      ["편집 화면", form],
      ["인쇄 미리보기", printView],
    ] as const) {
      assert.ok(!source.includes("<QuoteIssueButton"), `${name} 에 발행 단추가 남았다`);
      // 발행 통로를 부르는 길은 이 조각 하나다(quote-issue-download.ts) — 들여오지 않으면 못 부른다.
      assert.ok(!source.includes('from "@/components/quotes/quote-issue-download"'), `${name} 이 발행 흐름을 들여온다`);
    }
  });

  test("🔴 어느 화면도 발행 통로의 결과를 다루지 않는다 — 딸린 상태 · 핸들러가 남지 않았다", () => {
    for (const [name, source] of [
      ["목록", flat(list)],
      ["편집 화면", form],
      ["인쇄 미리보기", printView],
    ] as const) {
      for (const dead of ["issueNotice", "onIssueOutcome", "shouldReloadSlotsAfterIssue", "hasUnsavedChanges", "canIssue"]) {
        assert.ok(!source.includes(dead), `${name} 에 '${dead}' 가 남았다`);
      }
    }
  });
});

describe("🔴 네 화면 어디에도 받기 주소가 없다 — 되살아나면 여기서 깨진다", () => {
  test("목록 · 편집 화면 · 인쇄 미리보기(화면 · 페이지)에 '/xlsx' 가 없다", () => {
    for (const [name, source] of SCREENS_WITHOUT_COMMENTS) {
      assert.ok(!source.includes("/xlsx"), `${name} 에 받기 주소가 들어왔다`);
    }
  });

  test("🔴 받기라고 읽히는 글자도 없다 — [견적서 받기] · [Excel 받기]", () => {
    for (const [name, source] of SCREENS_WITHOUT_COMMENTS) {
      assert.ok(!source.includes("견적서 받기<"), `${name} 에 [견적서 받기]가 남았다`);
      assert.ok(!source.includes("Excel 받기"), `${name} 에 [Excel 받기]가 남았다`);
      // 받기가 없으니 저장 전후로 갈릴 일도 없다 — 그 곁말도 함께 걷어냈다.
      assert.ok(!source.includes("Excel 은 저장한 뒤에 받을 수 있습니다"), `${name} 에 옛 곁말이 남았다`);
    }
  });
});

describe("목록 — 표와 카드 두 곳 모두", () => {
  // 🔴 줄 단추를 **고르는 곳은 슬롯 한 곳**이고, 화면이 그 한 자리를 표와 카드 두 곳에
  //    건다. 그래서 「표에만 받기가 되살아나는」 고장이 애초에 생기지 않는다 — 그래도
  //    두 곳에 걸려 있는지는 그대로 잰다(걸리지 않으면 곁말이 통째로 사라진다).
  const table = flat(sliceBetween(listScreen, "function QuoteTable(", "function QuoteCardList("));
  const cards = flat(sliceBetween(listScreen, "function QuoteCardList(", "function SummaryLine("));
  const CALL = "<DocumentUnsupportedNote row={row} />";

  test("🔴 받기를 부르던 조각이 없다 — 슬롯에도 화면에도", () => {
    for (const [name, source] of [
      ["슬롯", flat(list)],
      ["화면", flat(listScreen)],
    ] as const) {
      assert.ok(!source.includes("<DownloadLink"), `${name} 에 받기 조각이 남았다`);
      assert.ok(!source.includes("function DownloadLink("), `${name} 에 받기 조각 자체가 남았다`);
    }
  });

  test("🔴 못 하는 일을 말없이 감추지 않는다 — 표와 카드가 같은 곁말을 부른다", () => {
    // 앱 양식이 없는 종류는 [미리보기 · PDF]도 없어 칸이 통째로 빈다 — 까닭을 곁말로 적는다.
    assert.ok(table.includes("{renderRowActions?.(row)}"), "표가 줄 단추 슬롯을 걸지 않는다");
    assert.ok(cards.includes("{renderRowActions?.(row)}"), "카드가 줄 단추 슬롯을 걸지 않는다");
    assert.equal(flat(list).split(CALL).length - 1, 1, "곁말을 부르는 곳이 하나가 아니다");
    const note = flat(sliceBetween(list, "function DocumentUnsupportedNote(", "\n}\n"));
    assert.ok(note.includes("if (canRenderQuoteDocument(row)) return null;"), note);
    assert.ok(note.includes("title={QUOTE_DOCUMENT_UNSUPPORTED_MESSAGE}"), note);
    assert.ok(!note.includes("canEdit"), "권한 갈래가 남았다");
  });

  test("목록을 부르는 두 쪽의 canEdit 은 quotes WRITE 다 — 받기가 아니라 [새 견적서] 쪽이다", () => {
    const quotesPage = flat(read("src/app/(app)/quotes/page.tsx"));
    assert.ok(quotesPage.includes('hasPermission(actingUser, "quotes", "WRITE")'));
    assert.ok(quotesPage.includes("canEdit={canEdit}"));
    const tabPage = flat(read("src/app/(app)/repair-cases/[id]/quotes/page.tsx"));
    assert.ok(tabPage.includes('hasPermission(actingUser, "quotes", "WRITE")'));
    assert.ok(tabPage.includes("canEdit={canEdit}"));
  });
});

describe("인쇄 미리보기 — 🔴 보기 권한자도 들어오는 화면", () => {
  test("page 는 받기 때문에 권한을 읽지 않는다 — 화면 문턱은 그대로 읽기 권한", () => {
    assert.ok(!printPage.includes("canIssue"), "옛 권한 계산이 남았다");
    assert.ok(!printPage.includes("hasPermission("), "미리보기 화면이 권한을 다시 계산한다");
    assert.ok(printPage.includes('await requireAreaAccessForCurrentUser("quotes");'));
  });

  test("🔴 앱 양식 · 엑셀 전용 두 갈래 모두 받기가 없다 — 남은 것은 인쇄뿐", () => {
    assert.equal(printView.split("href={`/api/quotes/${quoteId}/xlsx`}").length - 1, 0, "받기 링크가 남았다");
    // 저장 여부로 갈리던 곁말도 함께 걷어냈다 — 가리킬 받기가 없다.
    assert.equal(printView.split("Excel 은 저장한 뒤에 받을 수 있습니다").length - 1, 0);
    // [인쇄 · PDF로 저장]은 두 갈래 모두 그대로다 — 이번 일과 무관하다.
    assert.equal(barePrintView.split("인쇄 · PDF로 저장").length - 1, 2);
  });
});

describe("편집 화면 — 🔴 받기가 있던 자리", () => {
  test("머리에 받기가 없다 — [미리보기 · PDF] 다음은 곧바로 [폴더 열기]다", () => {
    // 🔴 주석을 뺀 원본으로 본다 — 머리말이 **없앤 길을 일부러** 설명한다(파일 맨 위 참조).
    const header = sliceBetween(bareForm, "<h1", "{!canGetDocument && (");
    assert.ok(!header.includes("savedQuote.id}/xlsx"), header);
    assert.ok(!header.includes("견적서 받기"), header);
    // 🔴 [미리보기 · PDF]는 그대로다 — 다른 기능이고 남는다(2026-09-16 케이블 ③의 판정도 그대로).
    assert.ok(header.includes('{canGetDocument && ( <button type="button" onClick={() => setShowPreview(true)}'), header);
    assert.ok(header.includes("<QuoteFolderOpenButton"), header);
  });

  test("🔴 못 하는 일은 여전히 말한다 — 서버와 같은 문장 하나", () => {
    assert.ok(form.includes("{!canGetDocument && ( <p"), "안내가 사라졌다");
    assert.ok(form.includes("{QUOTE_DOCUMENT_UNSUPPORTED_MESSAGE} </p>"), "화면이 문장을 따로 적는다");
  });

  test("🔴 저장하지 않은 변경을 가리던 장치가 남아 있지 않다 — 그 단추만을 위한 것이었다", () => {
    for (const dead of ["savedFieldsSnapshot", "hasUnsavedChanges"]) {
      assert.ok(!form.includes(dead), `'${dead}' 가 남았다`);
    }
    // [저장]이 보내는 값을 접어 두던 자리가 사라졌으니, 저장은 그 값을 보내기만 한다.
    const submit = sliceBetween(form, "async function handleSubmit(", "const disabled = isSubmitting || isConflict;");
    assert.ok(submit.includes("const fields = collectFields();"));
  });

  test("🔴 겹쳐 뜬 미리보기에도 발행 값이 넘어가지 않는다", () => {
    const preview = sliceBetween(form, "<QuotePrintView", "quoteNumber,");
    assert.ok(!preview.includes("canIssue"), preview);
    assert.ok(!preview.includes("onIssueOutcome"), preview);
  });

  test("「수기 견적서 엑셀」 칸을 다시 그려 오는 길은 살아 있다 — 결재 PDF 올리기가 쓴다", () => {
    assert.ok(section.includes("function reloadAfterIssue() { setStatusText(null); setArchiveNotice([]); refreshServerSlots(); }"));
  });
});

describe("결재 PDF 올리기 — 공유폴더 결과를 같은 문장 함수로", () => {
  test("올린 뒤 결과 줄을 싣고, 칸 구역이 그린다", () => {
    assert.ok(section.includes("setArchiveNotice(quoteUploadArchiveNoticeLines(category, result.archive));"));
    assert.ok(section.includes("statusDetails={<QuoteIssueNoticeLines lines={controller.archiveNotice}"));
  });
});

describe("단추 · 조각", () => {
  /**
   * 🔴 조각 자체는 **그리는 화면이 없어도 성해야 한다** — 통로(POST /api/quotes/{id}/issue)와
   * 서비스(issueQuoteFile)가 살아 있고, 결과 줄(QuoteIssueNoticeLines)은 결재 PDF 올리기와
   * [폴더 열기]가 그대로 쓴다. 조각을 정리할지는 사람이 따로 정한다.
   */
  test("🔴 단추는 저장하지 않은 변경을 runQuoteIssue 에 넘긴다 — 통로를 직접 부르지 않는다", () => {
    assert.ok(button.includes("await runQuoteIssue({ quoteId, hasUnsavedChanges });"));
    assert.ok(!button.includes("fetch("), "단추가 통로를 직접 부른다");
  });

  test("시험할 수 있는 조각은 서버 사슬을 부르지 않는다", () => {
    for (const path of [
      "src/components/quotes/QuoteIssueButton.tsx",
      "src/components/quotes/quote-issue-download.ts",
      "src/components/quotes/quote-issue-messages.ts",
      "src/lib/domain/content-disposition-file-name.ts",
    ]) {
      const source = read(path);
      assert.ok(!source.includes("@/lib/server/"), `${path} 가 서버 액션을 부른다`);
      assert.ok(!source.includes('"server-only"'), `${path} 가 server-only 를 부른다`);
      assert.ok(!/import \{[^}]*\} from "@\/lib\/db\//.test(source), `${path} 가 DB 조회를 값으로 부른다`);
    }
  });

  test("검사·수리 보고서는 공용 이름 모듈을 부른다 — 사본을 두지 않는다", () => {
    const serviceReport = read("src/components/repair-cases/report/service-report/ServiceReportForm.tsx");
    assert.ok(serviceReport.includes('import { fileNameFromContentDisposition } from "@/lib/domain/content-disposition-file-name";'));
    assert.ok(!serviceReport.includes("function fileNameFromContentDisposition("), "옛 사본이 남았다");
    assert.ok(serviceReport.includes('fileNameFromContentDisposition(response.headers.get("Content-Disposition"))'));
  });
});
