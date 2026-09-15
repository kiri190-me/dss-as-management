import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * ============================================================================
 * 견적서 B1c — 수정 권한자의 [견적서 받기]를 세 화면이 제자리에서 부르는가
 * ============================================================================
 * QuoteListScreen · QuoteEditForm · QuoteAttachmentsSection 은 서버 액션을 부르는 클라이언트
 * 컴포넌트라 이 시험 환경에서 그려 볼 수 없다(`server-only`). 그래서 이웃 시험
 * (quote-attachment-screens.test.ts · QuoteListScreen.test.ts)과 같은 방법으로 원본을 글자로
 * 읽는다. 단추 · 인쇄 미리보기가 무엇을 그리는지는 QuoteIssueButton.test.tsx 가, 누른 뒤의
 * 흐름(저장하지 않은 변경이면 통로를 부르지 않는다)은 quote-issue-download.test.ts 가 값으로 본다.
 *
 * 불변식 셋:
 *  (a) 보기 권한자 화면에는 부작용 단추가 없다 — 목록 canEdit · 인쇄 canIssue 로 가른다.
 *  (b) 저장하지 않은 변경은 공유폴더로 가지 않는다 — 편집 화면 · 그 안의 미리보기.
 *  (c) 기존 링크 동작은 그대로다 — 보기 권한자 갈래.
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
const indexOrFail = (source: string, marker: string) => {
  const at = source.indexOf(marker);
  assert.ok(at >= 0, `원본에서 '${marker}' 를 찾지 못했다`);
  return at;
};

const list = read("src/components/quotes/QuoteListScreen.tsx");
const form = flat(read("src/components/quotes/QuoteEditForm.tsx"));
const printPage = flat(read("src/app/(app)/quotes/[id]/print/page.tsx"));
const printView = flat(read("src/components/quotes/QuotePrintView.tsx"));
const section = flat(read("src/components/quotes/QuoteAttachmentsSection.tsx"));
const button = flat(read("src/components/quotes/QuoteIssueButton.tsx"));

describe("목록 — 표와 카드 두 곳 모두", () => {
  const table = flat(sliceBetween(list, "function QuoteTable(", "function QuoteCardList("));
  const cards = flat(sliceBetween(list, "function QuoteCardList(", "function PreviewLink("));
  const CALL = "<DownloadLink row={row} canEdit={canEdit} onIssueOutcome={onIssueOutcome} />";

  test("🔴 표와 카드가 같은 값으로 받기를 부른다 — 창 폭에 따라 권한 갈래가 달라지지 않게", () => {
    assert.ok(table.includes(CALL), "표의 받기가 권한을 받지 않는다");
    assert.ok(cards.includes(CALL), "카드의 받기가 권한을 받지 않는다");
    assert.ok(!flat(list).includes("<DownloadLink row={row} />"), "권한 없이 부르는 곳이 남았다");
  });

  test("두 곳 모두 부르는 쪽의 canEdit · 결과 받는 곳을 넘겨받는다", () => {
    const screen = flat(sliceBetween(list, "<ResponsiveList", "/>\n      )}"));
    for (const props of [sliceBetween(screen, "<QuoteTable", "/>"), sliceBetween(screen, "<QuoteCardList", "/>")]) {
      assert.ok(props.includes("canEdit={canEdit}"), props);
      assert.ok(props.includes("onIssueOutcome={handleIssueOutcome}"), props);
    }
  });

  test("🔴 canEdit 거짓 → 지금 링크, 참 → 발행 단추", () => {
    const download = flat(sliceBetween(list, "function DownloadLink(", "function IntakeLink("));
    const branch = indexOrFail(download, "if (canEdit) {");
    const issue = indexOrFail(download, "<QuoteIssueButton");
    const link = indexOrFail(download, "href={`/api/quotes/${row.id}/xlsx`}");
    assert.ok(branch < issue && issue < link, "갈래 차례가 틀렸다");
    const trueBranch = sliceBetween(download, "if (canEdit) {", "return ( <a");
    assert.ok(!trueBranch.includes("/xlsx"), trueBranch);
    assert.ok(trueBranch.includes("showNotice={false}"), trueBranch);
    assert.ok(trueBranch.includes("onOutcome={(outcome) => onIssueOutcome(row, outcome)}"), trueBranch);
  });

  test("결과는 화면 위 한 자리에 — 어느 견적서인지 번호를 붙여", () => {
    const body = flat(list);
    assert.ok(body.includes("setIssueNotice({ quoteNumber: row.quoteNumber, lines: outcome.lines });"), "번호를 붙이지 않는다");
    assert.ok(body.includes("[견적서 받기] {issueNotice.quoteNumber}"));
    assert.ok(body.includes("<QuoteIssueNoticeLines lines={issueNotice.lines}"));
    // 엑셀 칸이 바뀌면 목록의 표시를 다시 그려 온다.
    assert.ok(body.includes("if (shouldReloadSlotsAfterIssue(outcome)) router.refresh();"));
  });

  test("목록을 부르는 두 쪽의 canEdit 은 quotes WRITE 다", () => {
    const quotesPage = flat(read("src/app/(app)/quotes/page.tsx"));
    assert.ok(quotesPage.includes('hasPermission(actingUser, "quotes", "WRITE")'));
    assert.ok(quotesPage.includes("canEdit={canEdit}"));
    const tabPage = flat(read("src/app/(app)/repair-cases/[id]/quotes/page.tsx"));
    assert.ok(tabPage.includes('hasPermission(actingUser, "quotes", "WRITE")'));
    assert.ok(tabPage.includes("canEdit={canEdit}"));
  });
});

describe("인쇄 미리보기 — 🔴 보기 권한자도 들어오는 화면", () => {
  test("page 가 quotes WRITE 로 계산해 넘긴다 — 견적서를 읽은 뒤에, 살아 있는 계정으로", () => {
    assert.ok(
      printPage.includes('const canIssue = actingUser !== null && (await hasPermission(actingUser, "quotes", "WRITE"));'),
      "인쇄 화면의 받기 권한이 quotes WRITE 가 아니다"
    );
    assert.ok(printPage.includes("const actingUser = session ? await resolveActingUserForSession(session) : null;"));
    assert.ok(printPage.includes("canIssue={canIssue}"), "미리보기에 권한이 넘어가지 않는다");
    assert.ok(indexOrFail(printPage, "if (!quote) notFound();") < indexOrFail(printPage, "const canIssue ="));
    // 화면 문턱은 그대로 읽기 권한이다 — 보기 권한자도 미리보기는 연다.
    assert.ok(printPage.includes('await requireAreaAccessForCurrentUser("quotes");'));
  });

  test("미리보기는 canIssue 일 때만 발행 단추 — 앱 양식 · 엑셀 전용 두 갈래 모두, 기본은 링크", () => {
    assert.equal(printView.split("<QuoteIssueButton").length - 1, 2, "받기 단추가 두 갈래가 아니다");
    assert.equal(printView.split(") : canIssue ? (").length - 1, 2, "단추가 권한 갈래 밖에 있다");
    assert.equal(printView.split("href={`/api/quotes/${quoteId}/xlsx`}").length - 1, 2, "보기 권한자의 링크가 사라졌다");
    assert.ok(printView.includes("canIssue = false,"), "안 주면 링크여야 한다");
    assert.ok(printView.includes("canIssue={canIssue} hasUnsavedChanges={hasUnsavedChanges} onIssueOutcome={onIssueOutcome}"));
  });
});

describe("편집 화면 — 🔴 저장하지 않은 변경은 공유폴더로 가지 않는다", () => {
  test("머리의 [견적서 받기]는 발행 단추이고 옛 링크가 없다", () => {
    assert.ok(!form.includes("/xlsx"), "편집 화면에 옛 받기 링크가 남았다");
    const header = sliceBetween(form, "{savedQuote && (", ")}");
    assert.ok(header.includes('<QuoteIssueButton quoteId={savedQuote.id} label="견적서 받기"'), header);
    assert.ok(header.includes("hasUnsavedChanges={hasUnsavedChanges}"), header);
    assert.ok(header.includes("disabled={disabled}"), "저장 중 · 충돌에도 받을 수 있다");
    assert.ok(header.includes("onOutcome={handleIssueOutcome}"), header);
  });

  test("🔴 저장하지 않은 변경 = 저장이 보내는 값(collectFields)이 마지막 저장값과 다르다", () => {
    assert.ok(form.includes("useState<string | null>(() => quote ? JSON.stringify(collectFields()) : null"));
    assert.ok(
      form.includes(
        "const hasUnsavedChanges = savedFieldsSnapshot === null || JSON.stringify(collectFields()) !== savedFieldsSnapshot;"
      )
    );
    // 미리보기로 갈아 그리는 자리보다 앞 — 미리보기의 단추도 같은 값을 받는다.
    assert.ok(indexOrFail(form, "const [savedFieldsSnapshot, setSavedFieldsSnapshot]") < indexOrFail(form, "if (showPreview) {"));
  });

  test("🔴 [저장]이 성공한 뒤에만 그때 보낸 값으로 기준을 옮긴다", () => {
    const submit = sliceBetween(form, "async function handleSubmit(", "const disabled = isSubmitting || isConflict;");
    assert.ok(submit.includes("const fields = collectFields();"));
    const failed = indexOrFail(submit, "if (!result.ok) {");
    const moved = indexOrFail(submit, "setSavedFieldsSnapshot(JSON.stringify(fields));");
    assert.ok(failed < moved, "저장이 실패해도 기준을 옮긴다");
    assert.ok(moved < indexOrFail(submit, "if (savedQuote) {"));
    assert.ok(moved < indexOrFail(submit, "await attachments.uploadQueuedAfterCreate("), "새 견적서가 머물 때 기준이 없다");
    assert.equal(form.split("setSavedFieldsSnapshot(").length - 1, 1, "저장 말고 기준을 옮기는 곳이 생겼다");
  });

  test("🔴 겹쳐 뜬 미리보기의 받기도 같은 규칙", () => {
    const preview = sliceBetween(form, "<QuotePrintView", "quoteNumber,");
    assert.ok(preview.includes("canIssue"), preview);
    assert.ok(preview.includes("hasUnsavedChanges={hasUnsavedChanges}"), preview);
    assert.ok(preview.includes("onIssueOutcome={reloadSlotsAfterIssue}"), preview);
  });

  test("발행이 엑셀 칸을 바꾸면 서버 칸을 다시 그려 온다 — 결과 줄은 머리 아래", () => {
    assert.ok(form.includes("if (shouldReloadSlotsAfterIssue(outcome)) attachments.reloadAfterIssue();"));
    assert.ok(section.includes("function reloadAfterIssue() { setStatusText(null); setArchiveNotice([]); refreshServerSlots(); }"));
    assert.ok(form.includes("<QuoteIssueNoticeLines lines={issueNotice}"));
  });
});

describe("결재 PDF 올리기 — 공유폴더 결과를 같은 문장 함수로", () => {
  test("올린 뒤 결과 줄을 싣고, 칸 구역이 그린다", () => {
    assert.ok(section.includes("setArchiveNotice(quoteUploadArchiveNoticeLines(category, result.archive));"));
    assert.ok(section.includes("statusDetails={<QuoteIssueNoticeLines lines={controller.archiveNotice}"));
  });
});

describe("단추 · 조각", () => {
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
