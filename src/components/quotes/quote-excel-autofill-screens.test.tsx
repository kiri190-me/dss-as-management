import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { QuoteAttachmentSlotsView, QuoteExcelAutofillNotice } from "./QuoteAttachmentParts";
import type { QuoteExcelFieldChange } from "./quote-excel-autofill";
import type { QuoteIssueNoticeLine } from "./quote-issue-messages";

/**
 * ============================================================================
 * 수기 견적서 엑셀로 칸 채우기 — 화면이 규칙을 제자리에서 부르는가 (견적서 ①b)
 * ============================================================================
 * QuoteEditForm · QuoteAttachmentsSection 은 서버 액션을 부르는 클라이언트 컴포넌트라 이 시험
 * 환경에서 그려 볼 수 없다(`server-only`). 그래서 이웃 시험(quote-attachment-screens.test.ts ·
 * quote-new-start.test.ts)과 같은 방법으로 원본을 글자로 읽는다. 알림 조각은 따로 그려 본다.
 * 계획 · 문장의 값은 quote-excel-autofill.test.ts, 읽기 클라이언트 · 「마지막 파일만」은
 * quote-excel-parse.test.ts 가 본다.
 *
 * 불변식 넷: (a) 읽기가 실패해도 붙이기는 그대로 (b) 사람이 적은 값을 말없이 덮지 않는다
 * (c) 종류 변경은 한 길 (d) 엑셀 전용이 아니면 아무 일도 없다.
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
const count = (source: string, needle: string) => source.split(needle).length - 1;

const form = flat(read("src/components/quotes/QuoteEditForm.tsx"));
const section = flat(read("src/components/quotes/QuoteAttachmentsSection.tsx"));

describe("훅 — 「수기 견적서 엑셀」을 고른 순간을 폼에 알린다", () => {
  const pick = sliceBetween(section, "function pickFile(", "function retry(");

  test("🔴 (a) 붙이기를 시작한 **뒤에** 알린다 — 새 견적서(들고 있기) · 수정 화면(곧바로 올리기) 모두", () => {
    const notify = indexOrFail(pick, 'if (category === "QUOTE_EXCEL") onExcelPicked?.(file);');
    assert.ok(indexOrFail(pick, "setPending((prev) => withPendingQuoteAttachment(prev, category, file));") < notify);
    assert.ok(indexOrFail(pick, "void uploadNow(quoteId, category, file);") < notify);
    // 돌아가는 곳은 형식 · 크기 거절 하나뿐이다 — 새 견적서 갈래가 알리기 전에 돌아가지 않는다.
    assert.equal(count(pick, "return;"), 1, pick);
    assert.ok(pick.indexOf("return;", indexOrFail(pick, "if (rejection !== null) {")) < notify, "거절된 파일도 읽는다");
  });

  test("🔴 결재 PDF 칸은 알리지 않는다 — 알리는 곳은 한 곳, 그 칸의 조건 안이다", () => {
    assert.equal(count(section, "onExcelPicked?.("), 1, "알리는 곳이 둘이다");
    for (const [start, end] of [
      ["async function uploadNow(", "function pickFile("],
      ["function retry(", "function clearPending("],
      ["async function uploadQueuedAfterCreate(", "function reloadAfterIssue("],
    ]) {
      const body = sliceBetween(section, start, end);
      assert.ok(!body.includes("onExcelPicked"), `${start} 가 읽기를 부른다([다시 올리기] · 저장 뒤 올리기는 다시 읽지 않는다)`);
    }
  });

  test("엑셀 읽기 알림은 「수기 견적서 엑셀」 칸에만 붙는다", () => {
    assert.ok(section.includes("slotDetails={{ QUOTE_EXCEL: excelSlotDetails }}"), section);
  });
});

describe("🔴 (d) 폼 — 엑셀 전용 장만 읽는다", () => {
  test("훅에 알림을 걸고, 엑셀 전용이 아니면 곧바로 돌아간다", () => {
    assert.ok(form.includes("onExcelPicked: (file) => handleExcelPicked(file),"));
    const handler = sliceBetween(form, "function handleExcelPicked(file: File) {", "async function readPickedExcel(");
    assert.ok(indexOrFail(handler, "if (!isExcelOnly) return;") < indexOrFail(handler, "void readPickedExcel(file);"), handler);
    assert.equal(count(form, "readPickedExcel("), 2, "정의 · 부르는 곳 하나 말고 읽는 곳이 생겼다");
    assert.equal(count(form, "excelReader.read("), 1);
  });

  test("끄면 읽던 결과를 버리고 알림을 걷는다 · 알림과 다른 칸 목록은 엑셀 전용일 때만", () => {
    const toggle = sliceBetween(form, "function toggleExcelOnly(", "function handleExcelPicked(");
    assert.ok(toggle.includes("if (!plan.isExcelOnly) { excelReader.cancel(); setExcelAutofill(null); }"), toggle);
    assert.ok(form.includes("const excelAutofillPanel = isExcelOnly && excelAutofill !== null ? ("), "엑셀 전용이 아니어도 알림을 그린다");
    assert.ok(
      form.includes(
        'const excelConflicts = isExcelOnly && excelAutofill?.status === "read" ? planQuoteExcelAutofill(excelFormValues, excelAutofill.fields).conflicts : [];'
      ),
      "다른 칸 목록을 지금 값으로 뽑지 않는다"
    );
    assert.ok(
      form.includes(
        "<QuoteAttachmentsSection controller={attachments} isExcelOnly={isExcelOnly} disabled={disabled} excelSlotDetails={excelAutofillPanel} />"
      )
    );
  });
});

describe("🔴 (b) 두 번 고르면 마지막 결과만 · 결과가 온 순간에는 빈 칸만 채운다", () => {
  const readFn = sliceBetween(form, "async function readPickedExcel(file: File) {", "function applyExcelValue(");

  test("늦게 온 옛 결과(null)는 칸을 건드리기 전에 버린다", () => {
    assert.ok(form.includes("const [excelReader] = useState(() => createLatestQuoteExcelReader());"));
    const discard = indexOrFail(readFn, "if (result === null) return;");
    assert.ok(indexOrFail(readFn, "const result = await excelReader.read(file);") < discard);
    assert.ok(discard < indexOrFail(readFn, "applyExcelValue(change)"));
    assert.ok(discard < indexOrFail(readFn, 'setExcelAutofill({ status: "failed"'));
    assert.ok(discard < indexOrFail(readFn, 'setExcelAutofill({ status: "read"'));
  });

  test("채우는 것은 계획의 fills 뿐 — 고른 때가 아니라 마지막으로 그린 폼 값과 견준다", () => {
    assert.ok(readFn.includes("const plan = planQuoteExcelAutofill(latestExcelFormValues.current, result.fields);"), readFn);
    assert.ok(readFn.includes("for (const change of plan.fills) applyExcelValue(change);"), readFn);
    assert.ok(!readFn.includes("plan.conflicts.forEach") && !readFn.includes("of plan.conflicts)"), "다른 칸을 말없이 덮는다");
    assert.ok(form.includes("useEffect(() => { latestExcelFormValues.current = excelFormValues; });"));
    // 지금 값에는 채울 칸이 모두 있다 — 이름은 폼 상태 그대로.
    const values = sliceBetween(form, "const excelFormValues: QuoteExcelFormValues = quoteExcelPlanFormValues(", ");");
    for (const name of [
      "kind",
      "quoteNumber",
      "quoteDate",
      "customerNameText",
      "subject",
      "modelNameText",
      "lotNumberText",
      "serialNumberText",
      "validity",
      "delivery",
      "payment",
      "manualSupplyAmount",
    ]) {
      assert.ok(values.includes(` ${name},`), `${name} 가 없다`);
    }
    assert.ok(!values.includes("faultDescriptionText"), "신고증상을 채운다");
  });
});

describe("🔴 (c) 종류 변경은 한 길 — select 와 [엑셀 값으로 바꾸기]가 changeKind 를 부른다", () => {
  test("select 의 onChange 는 changeKind 하나, 종류를 바꾸는 곳은 changeKind 안 하나", () => {
    const kindSelect = sliceBetween(form, 'label="견적서 종류"', "</select>");
    assert.ok(kindSelect.includes("onChange={(e) => changeKind(e.target.value as QuoteKind)}"), kindSelect);
    const changeKind = sliceBetween(form, "function changeKind(", "function editCustomerName(");
    const guard = indexOrFail(changeKind, "if (!isExcelOnly) {");
    assert.ok(indexOrFail(changeKind, "setKind(next);") < guard);
    assert.ok(guard < indexOrFail(changeKind, "applyOverhaulRule(next, laborKind);"));
    assert.ok(guard < indexOrFail(changeKind, "fillScopeFromTemplate(next, laborKind);"));
    assert.equal(count(form, "setKind("), 1, "종류를 changeKind 밖에서 바꾼다");
    assert.equal(count(form, "changeKind("), 3, "정의 · select · 엑셀 값 넣기 말고 부르는 곳이 생겼다");
  });

  test("엑셀 값 넣기의 종류 칸은 changeKind, 공급처는 칸에 치는 것과 같은 editCustomerName", () => {
    const apply = sliceBetween(form, "function applyExcelValue(", "function collectFields() {");
    assert.ok(apply.includes("if (next) changeKind(next);"), apply);
    assert.ok(apply.includes("customerNameText: editCustomerName,"), apply);
    assert.ok(apply.includes("manualSupplyAmount: setManualSupplyAmount,"), apply);
    const customerInput = sliceBetween(form, 'label="공급처"', "</Field>");
    assert.ok(customerInput.includes("onChange={(e) => editCustomerName(e.target.value)}"), customerInput);
    const edit = sliceBetween(form, "function editCustomerName(", "function taskNamesOf(");
    assert.ok(edit.includes("setCustomerNameText(value); setCustomerId(null);"), edit);
  });

  test("다른 칸 목록의 단추도 같은 applyExcelValue 를 부른다", () => {
    const panel = sliceBetween(form, "const excelAutofillPanel =", ") : null;");
    assert.ok(panel.includes("onReplace={(change) => applyExcelValue(change)}"), panel);
    assert.ok(panel.includes("onReplaceAll={() => excelConflicts.forEach((change) => applyExcelValue(change))}"), panel);
    assert.ok(panel.includes("disabled={disabled}"), panel);
  });
});

describe("🔴 발행일자의 「손댐」 — 새 견적서에서 손대지 않은 기본값만 빈 칸처럼 (2026-09-16 사용자 결정)", () => {
  test("계획에 넘기는 폼 값은 저장 전 · 손대지 않음일 때만 날짜를 비운다", () => {
    assert.ok(
      form.includes("{ isNewQuote: savedQuote === null, touched: quoteDateTouched }"),
      "새 견적서 · 손댐 판정이 계획에 들어가지 않는다"
    );
    assert.ok(form.includes("const [quoteDateTouched, setQuoteDateTouched] = useState(false);"));
  });

  test("날짜를 바꾸는 길은 editQuoteDate 하나 — 칸에 친 것 · 엑셀 값 넣기 모두 손댐을 켠다", () => {
    const edit = sliceBetween(form, "function editQuoteDate(", "function taskNamesOf(");
    assert.ok(edit.includes("setQuoteDate(value); setQuoteDateTouched(true);"), edit);
    assert.equal(count(form, "setQuoteDate("), 1, "editQuoteDate 밖에서 날짜를 바꾼다");
    assert.equal(count(form, "setQuoteDateTouched("), 1, "손댐 표시를 끄거나 따로 켜는 곳이 생겼다");
    const dateInput = sliceBetween(form, 'label="발행일자"', "</Field>");
    assert.ok(dateInput.includes("onChange={(e) => editQuoteDate(e.target.value)}"), dateInput);
    const apply = sliceBetween(form, "function applyExcelValue(", "function collectFields() {");
    assert.ok(apply.includes("quoteDate: editQuoteDate,"), apply);
  });
});

// ───────────────────────────── 알림 조각 — 그려 본다

const CUSTOMER: QuoteExcelFieldChange = {
  field: "customerNameText",
  label: "공급처",
  excelValue: "가나 테크",
  formDisplay: "다라 전자",
  excelDisplay: "가나 테크",
};
const KIND: QuoteExcelFieldChange = {
  field: "kind",
  label: "견적서 종류",
  excelValue: "DOMESTIC",
  formDisplay: "OH 견적서",
  excelDisplay: "내자 견적서",
};
const LINES: QuoteIssueNoticeLine[] = [
  { text: "엑셀에서 빈 칸 2개를 채웠습니다: 발행번호 · 공급가액", tone: "normal" },
  { text: "경고 한 줄", tone: "warning" },
];

function renderNotice(props: {
  reading?: boolean;
  lines?: QuoteIssueNoticeLine[];
  conflicts?: QuoteExcelFieldChange[];
  disabled?: boolean;
}): string {
  return renderToStaticMarkup(
    <QuoteExcelAutofillNotice
      reading={props.reading ?? false}
      lines={props.lines ?? []}
      conflicts={props.conflicts ?? []}
      disabled={props.disabled ?? false}
      onReplace={() => {}}
      onReplaceAll={() => {}}
      onDismiss={() => {}}
    />
  );
}

describe("알림 조각", () => {
  test("읽는 중 — 「엑셀을 읽는 중…」 한 줄뿐, 목록 · 닫기 없음", () => {
    const html = renderNotice({ reading: true, lines: LINES, conflicts: [CUSTOMER] });
    assert.ok(html.includes("엑셀을 읽는 중…"), html);
    assert.ok(!html.includes("엑셀 값으로 바꾸기"), html);
    assert.ok(!html.includes("닫기"), html);
    assert.ok(!html.includes("경고 한 줄"), html);
  });

  test("결과 줄 · 다른 칸 목록 — 칸마다 [엑셀 값으로 바꾸기], 둘 이상이면 [모두 …]", () => {
    const html = renderNotice({ lines: LINES, conflicts: [KIND, CUSTOMER] });
    assert.ok(html.includes("엑셀에서 빈 칸 2개를 채웠습니다: 발행번호 · 공급가액"), html);
    assert.ok(html.includes("경고 한 줄"), html);
    assert.ok(html.includes("엑셀과 다른 칸 — 폼에 적힌 값을 덮지 않았습니다"), html);
    assert.ok(html.includes("견적서 종류(폼: OH 견적서 / 엑셀: 내자 견적서)"), html);
    assert.ok(html.includes("공급처(폼: 다라 전자 / 엑셀: 가나 테크)"), html);
    assert.ok(html.includes('aria-label="공급처 엑셀 값으로 바꾸기"'), html);
    assert.ok(html.includes('aria-label="견적서 종류 엑셀 값으로 바꾸기"'), html);
    assert.ok(html.includes("모두 엑셀 값으로 바꾸기 (2칸)"), html);
    assert.ok(html.includes("닫기"), html);
  });

  test("다른 칸이 하나면 [모두 …] 는 없다 · 없으면 목록도 없다", () => {
    const one = renderNotice({ lines: LINES, conflicts: [CUSTOMER] });
    assert.equal(count(one, ">엑셀 값으로 바꾸기<"), 1, one);
    assert.ok(!one.includes("모두 엑셀 값으로 바꾸기"), one);
    const none = renderNotice({ lines: LINES });
    assert.ok(!none.includes("엑셀과 다른 칸"), none);
    assert.ok(!none.includes("엑셀 값으로 바꾸기"), none);
  });

  test("저장 중 · 충돌이면 바꾸기 단추를 잠근다", () => {
    const html = renderNotice({ lines: LINES, conflicts: [KIND, CUSTOMER], disabled: true });
    const buttons = html.match(/<button[^>]*>[^<]*바꾸기[^<]*<\/button>/g) ?? [];
    assert.equal(buttons.length, 3, html);
    for (const button of buttons) assert.ok(button.includes('disabled=""'), button);
  });

  test("「수기 견적서 엑셀」 칸 안에만 그린다 — 결재 PDF 칸에는 없다", () => {
    const html = renderToStaticMarkup(
      <QuoteAttachmentSlotsView
        mode="pending"
        slots={{ SIGNED_QUOTE_PDF: null, QUOTE_EXCEL: null }}
        pending={{}}
        errors={{}}
        busyCategory={null}
        statusText={null}
        notice={null}
        disabled={false}
        onPickFile={() => {}}
        onRetry={() => {}}
        onClearPending={() => {}}
        onRequestDelete={() => {}}
        slotDetails={{ QUOTE_EXCEL: <p>엑셀 칸 곁의 알림</p> }}
      />
    );
    assert.equal(count(html, "엑셀 칸 곁의 알림"), 1, html);
    assert.ok(indexOrFail(html, "수기 견적서 엑셀") < indexOrFail(html, "엑셀 칸 곁의 알림"), html);
    assert.ok(indexOrFail(html, "결재 견적서 PDF") < indexOrFail(html, "수기 견적서 엑셀"), html);
  });

  test("안 주면 지금 그대로 — 칸에 아무것도 붙지 않는다", () => {
    const html = renderToStaticMarkup(
      <QuoteAttachmentSlotsView
        mode="pending"
        slots={{ SIGNED_QUOTE_PDF: null, QUOTE_EXCEL: null }}
        pending={{}}
        errors={{}}
        busyCategory={null}
        statusText={null}
        notice={null}
        disabled={false}
        onPickFile={() => {}}
        onRetry={() => {}}
        onClearPending={() => {}}
        onRequestDelete={() => {}}
      />
    );
    assert.ok(!html.includes("엑셀에서 칸 채우기"), html);
  });
});
