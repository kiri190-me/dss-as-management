import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * ============================================================================
 * 견적서 첨부 Q3 — 화면이 조각 · 도우미를 제자리에서 부르는가
 * ============================================================================
 * QuoteEditForm · QuoteListScreen · QuoteAttachmentsSection 은 서버 액션을 부르는 클라이언트
 * 컴포넌트라 이 시험 환경에서 그려 볼 수 없다(`server-only`). 그래서 이웃 시험
 * (QuoteListScreen.test.ts · quote-edit-work-scope-suppression.test.ts)과 같은 방법으로
 * 원본을 글자로 읽는다. 조각이 무엇을 그리는지는 QuoteAttachmentParts.test.tsx ·
 * quote-print-excel-only.test.tsx 가, 판정 값은 quote-attachment-files.test.ts 가 본다.
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

const form = flat(read("src/components/quotes/QuoteEditForm.tsx"));
const list = read("src/components/quotes/QuoteListScreen.tsx");
const printPage = flat(read("src/app/(app)/quotes/[id]/print/page.tsx"));
const editPage = flat(read("src/app/(app)/quotes/[id]/page.tsx"));

describe("수정 화면 — 견적서 파일 두 칸", () => {
  test("🔴 상태는 폼이 부르는 훅에 있다 — 미리보기를 열어도 골라 둔 파일이 살아남게", () => {
    assert.ok(
      form.includes('import QuoteAttachmentsSection, { useQuoteAttachments } from "@/components/quotes/QuoteAttachmentsSection";')
    );
    assert.ok(
      form.includes("const attachments = useQuoteAttachments({ quoteId: savedQuote?.id ?? null, serverSlots: attachmentSlots, });"),
      "훅을 폼에서 부르지 않는다"
    );
    // 훅은 미리보기로 갈아 그리는 자리(if (showPreview)) 보다 앞에서 불린다.
    assert.ok(indexOrFail(form, "useQuoteAttachments({") < indexOrFail(form, "if (showPreview) {"));
  });

  test("🔴 구역은 상단 정보 바로 아래 — 부품 구역보다 앞", () => {
    const render = "<QuoteAttachmentsSection controller={attachments} isExcelOnly={isExcelOnly} disabled={disabled} />";
    const at = indexOrFail(form, render);
    assert.ok(indexOrFail(form, "{/* ── 상단 정보") < at, "상단 정보보다 앞에 있다");
    assert.ok(at < indexOrFail(form, "{/* ── O/H 템플릿 부품"), "부품 구역보다 뒤에 있다");
    assert.equal(form.split("<QuoteAttachmentsSection ").length - 1, 1, "구역을 두 번 그린다");
  });

  test("수정 화면은 칸을 읽어 폼에 넘긴다 — 견적서를 읽은 뒤에", () => {
    assert.ok(editPage.includes("listQuoteAttachmentSlots(quote.id),"), "칸을 읽지 않는다");
    assert.ok(editPage.includes("attachmentSlots={attachmentSlots}"), "폼에 칸을 넘기지 않는다");
    assert.ok(indexOrFail(editPage, "if (!quote) notFound();") < indexOrFail(editPage, "listQuoteAttachmentSlots(quote.id)"));
  });
});

describe("새 견적서 — [저장] 뒤에 파일을 올린다", () => {
  const submit = sliceBetween(form, "async function handleSubmit(", "const disabled = isSubmitting || isConflict;");

  test("🔴 이 화면에서 만든 장도 다음 [저장]은 고치기다 — 두 장이 생기지 않게", () => {
    assert.ok(
      submit.includes(
        "const result = savedQuote ? await updateQuoteAction({ id: savedQuote.id, expectedVersion: savedQuote.version, fields }) : await createQuoteAction({ fields });"
      ),
      "저장된 장 판단이 savedQuote 가 아니다"
    );
    assert.ok(form.includes("const savedQuote = quote ? { id: quote.id, version: quote.version } : createdQuote;"));
  });

  test("🔴 만든 장을 기억한 뒤 올리고, 하나라도 못 올리면 목록으로 넘기지 않는다", () => {
    const remember = indexOrFail(submit, "setCreatedQuote({ id: result.id, version: result.version });");
    const upload = indexOrFail(submit, "await attachments.uploadQueuedAfterCreate(result.id,");
    const failed = indexOrFail(submit, "if (upload.failures.length > 0) {");
    const popup = indexOrFail(submit, 'showSavePopup({ message: "견적서를 등록했습니다."');
    assert.ok(remember < upload && upload < failed && failed < popup, "차례가 틀렸다");
    const failureBranch = sliceBetween(submit, "if (upload.failures.length > 0) {", "}");
    assert.ok(failureBranch.includes("createdWithAttachmentFailuresText(upload.total, upload.failures)"), failureBranch);
    assert.ok(failureBranch.includes("return;"), "실패해도 팝업으로 넘어간다");
    // 고치기 저장은 올리기를 거치지 않는다 — 파일은 칸에서 곧바로 반영된다.
    assert.ok(indexOrFail(submit, "if (savedQuote) {") < upload);
  });

  test("못 올렸을 때 안내 곁에 [목록으로] — 견적서는 이미 저장됐다", () => {
    const notice = sliceBetween(form, "{attachmentNotice && (", "</div> )}");
    assert.ok(notice.includes("{createdQuote && !isSubmitting && ("), notice);
    assert.ok(notice.includes('onClick={() => router.push(returnHref ?? "/quotes")}'), notice);
  });
});

describe("엑셀 전용 스위치", () => {
  test("스위치는 상단 정보 안에, 켜면 공급가액 칸(콤마 칸)", () => {
    const top = sliceBetween(form, "{/* ── 상단 정보", "<QuoteAttachmentsSection ");
    assert.ok(top.includes("<ExcelOnlySwitch checked={isExcelOnly} disabled={disabled} onToggle={(next) => toggleExcelOnly(next)} />"));
    assert.ok(top.includes('label="공급가액(부가세 별도)"'), top);
    assert.ok(top.includes("<AmountInput value={manualSupplyAmount} onValueChange={setManualSupplyAmount}"), top);
  });

  test("🔴 켜고 끄는 판정은 도메인 도우미 한 곳 — 줄이 있으면 묻고, 끄면 돌려놓는다", () => {
    assert.ok(form.includes("const plan = planExcelOnlyToggle<ExcelOnlyLines>({"), "판정을 도우미에 맡기지 않는다");
    assert.ok(form.includes("current: { items, scopeLines, scopeTouched, taskQuantities },"));
    assert.ok(form.includes("<ExcelOnlyClearLinesDialog counts={clearLinesAsk} onConfirm={() => toggleExcelOnly(true, true)}"));
    // 정의 하나 · 스위치 하나 · 확인 창 하나 — 그 밖에서 켜고 끄면 판정을 건너뛴다.
    assert.equal(form.split("toggleExcelOnly(").length - 1, 3, "정의 · 스위치 · 확인 말고 부르는 곳이 생겼다");
  });

  test("🔴 켜면 부품 · 작업 구역을 접는다 — 합계 앞에서 조건이 닫힌다", () => {
    const open = indexOrFail(form, "{isExcelOnly ? (");
    assert.ok(open < indexOrFail(form, "{/* ── O/H 템플릿 부품"), "접는 조건이 부품 구역보다 뒤다");
    const close = indexOrFail(form, "</section> </> )} {/* ── 합계 미리보기");
    assert.ok(close > indexOrFail(form, "{QUOTE_WORK_SCOPE_SECTIONS.map((section) => {"), "작업 내역이 조건 밖이다");
    assert.ok(close > indexOrFail(form, "<AmountInput value={workCost} onValueChange={setWorkCost}"), "작업비가 조건 밖이다");
  });

  test("🔴 엑셀 전용일 때 종류를 바꿔도 줄이 몰래 생기지 않는다", () => {
    const kindSelect = sliceBetween(form, 'label="견적서 종류"', "</select>");
    const guard = indexOrFail(kindSelect, "if (!isExcelOnly) {");
    assert.ok(guard < indexOrFail(kindSelect, "applyOverhaulRule(next, laborKind);"));
    assert.ok(guard < indexOrFail(kindSelect, "fillScopeFromTemplate(next, laborKind);"));
  });

  test("저장은 켜져 있을 때만 공급가액을 보낸다", () => {
    const collect = sliceBetween(form, "function collectFields() {", "async function handleSubmit(");
    assert.ok(collect.includes("isExcelOnly, manualSupplyAmount: isExcelOnly ? manualSupplyAmount : null,"), collect);
  });

  test("🔴 합계 미리보기는 서버와 같은 함수(quoteSupplyAmountOf) — 옛 셈법을 따로 부르지 않는다", () => {
    assert.ok(form.includes("quoteSupplyAmountOf({ isExcelOnly, manualSupplyAmount,"), "합계가 quoteSupplyAmountOf 가 아니다");
    assert.ok(!form.includes("sumQuoteSupplyAmount"), "편집 화면이 옛 셈법을 부른다");
    assert.ok(!read("src/components/quotes/QuotePrintView.tsx").includes("sumQuoteSupplyAmount"), "미리보기가 옛 셈법을 부른다");
    assert.ok(form.includes("{formatMaybeAmount(supplyAmount)}"), "금액을 모르면 「—」로 그리지 않는다");
  });

  test("겹쳐 뜬 미리보기에도 엑셀 전용 · 결재 PDF 를 넘긴다", () => {
    const preview = sliceBetween(form, "<QuotePrintView", "quoteNumber,");
    assert.ok(preview.includes("signedPdf={attachments.signedPdfForPreview}"), preview);
    assert.ok(preview.includes("hasExcel={attachments.excelAttachedOrQueued}"), preview);
    assert.ok(preview.includes("isExcelOnly, manualSupplyAmount: isExcelOnly ? orNull(manualSupplyAmount) : null,"), preview);
  });
});

describe("목록 — 표와 카드 두 곳 모두", () => {
  const table = flat(sliceBetween(list, "function QuoteTable(", "function QuoteCardList("));
  const cards = flat(sliceBetween(list, "function QuoteCardList(", "function PreviewLink("));

  test("🔴 표시 조각을 표와 카드 모두 같은 줄 값으로 부른다 — 창 폭에 따라 달라지지 않게", () => {
    assert.ok(table.includes("<QuoteFileBadges row={row} />"), "표에 표시가 없다");
    assert.ok(cards.includes("<QuoteFileBadges row={row} />"), "카드에 표시가 없다");
  });

  test("금액 옆 괄호도 두 곳 모두 같은 도우미", () => {
    assert.ok(table.includes("({quoteListAmountNote(row)})"), table);
    assert.ok(cards.includes("({quoteListAmountNote(row)} · 부가세 별도)"), cards);
    assert.ok(!list.includes("{row.itemCount}품목"), "옛 품목 괄호가 남았다");
  });
});

describe("미리보기 화면 — 엑셀 전용 장만 칸을 읽는다", () => {
  test("🔴 일반 견적서는 조회가 늘지 않는다", () => {
    assert.ok(
      printPage.includes("quote.isExcelOnly ? listQuoteAttachmentSlots(quote.id) : Promise.resolve(null),"),
      "엑셀 전용이 아닌 장도 칸을 읽는다"
    );
    assert.ok(printPage.includes("signedPdf={excelOnly?.signedPdf ?? null}"), printPage);
    assert.ok(printPage.includes("hasExcel={excelOnly?.hasExcel}"), printPage);
  });
});

describe("시험할 수 있는 조각은 서버 사슬을 부르지 않는다", () => {
  test("🔴 서버 액션을 부르는 것은 QuoteAttachmentsSection 하나다", () => {
    for (const path of [
      "src/components/quotes/QuoteAttachmentParts.tsx",
      "src/components/quotes/quote-attachment-files.ts",
      "src/components/quotes/quote-attachment-upload.ts",
    ]) {
      const source = read(path);
      assert.ok(!source.includes("@/lib/server/"), `${path} 가 서버 액션을 부른다`);
      assert.ok(!source.includes('"server-only"'), `${path} 가 server-only 를 부른다`);
      // 서버 조회 파일에서는 타입만 가져온다(지워지는 import).
      assert.ok(!/import \{[^}]*\} from "@\/lib\/db\//.test(source), `${path} 가 DB 조회를 값으로 부른다`);
    }
    assert.ok(read("src/components/quotes/QuoteAttachmentsSection.tsx").includes("softDeleteAttachmentAction"));
  });
});
