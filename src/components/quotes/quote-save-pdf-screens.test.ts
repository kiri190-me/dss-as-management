import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

/**
 * ============================================================================
 * [저장] 뒤 PDF 변환이 **제자리에서 불리는가** — 폼 원본을 글자로 읽는다 (2026-10-08)
 * ============================================================================
 * QuoteEditForm 은 서버 액션을 부르는 클라이언트 컴포넌트라 이 시험 환경에서 그려 볼 수 없다
 * (`server-only`). 이웃 시험(quote-attachment-screens.test.ts)과 **같은 방법**으로 원본을
 * 글자로 읽는다. 흐름의 값은 quote-save-pdf-convert.test.ts 가, 그려진 칸은
 * QuoteSavePdfNotice.test.tsx 가 **실제로 그려서** 본다.
 *
 * 여기서 못 박는 것:
 *  · 🔴 **저장을 막지 않는다** — 저장 액션이 돌아온 **뒤에** 부른다
 *  · 🔴 만들기는 **파일 올리기까지 끝난 뒤** · 고치기는 **그 가지 안에서**, 둘 다 팝업 **앞**
 *  · 🔴 사람이 읽을 것이 남으면 **넘어가지 않는다**(저장 팝업 두 개는 그대로)
 *  · 🔴 폼이 **주소를 제 손으로 만들지 않는다** — 흐름 하나에 맡긴다
 *  · 🔴 건너뛰는 판정도 폼이 다시 적지 않는다 — 흐름에 `{ kind, isExcelOnly }` 를 넘긴다
 * ============================================================================
 */

const repoUrl = new URL("../../../", import.meta.url);
const read = (relativePath: string) => readFileSync(new URL(relativePath, repoUrl), "utf8").replace(/\r\n/g, "\n");
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

const raw = read("src/components/quotes/QuoteEditForm.tsx");
const form = flat(raw);
/** 주석을 뺀 코드 — 머리말이 까닭을 설명하느라 적은 낱말에 걸리지 않게. */
const code = flat(raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, ""));
const submit = sliceBetween(form, "async function handleSubmit(", "const disabled = isSubmitting || isConflict;");

describe("🔴 저장이 끝난 뒤에 부른다 — 저장을 막지 않는다", () => {
  test("저장 액션 호출은 한 글자도 바뀌지 않았다", () => {
    assert.ok(
      submit.includes(
        "const result = savedQuote ? await updateQuoteAction({ id: savedQuote.id, expectedVersion: savedQuote.version, fields }) : await createQuoteAction({ fields });"
      ),
      "저장 액션 호출이 바뀌었다"
    );
  });

  test("🔴 변환은 저장 응답을 받은 **뒤**다 — 저장 호출을 감싸지 않는다", () => {
    const save = indexOrFail(submit, "const result = savedQuote ? await updateQuoteAction(");
    const ok = indexOrFail(submit, "if (!result.ok) {");
    for (const call of ["convertSavedQuoteToPdf(savedQuote.id)", "convertSavedQuoteToPdf(result.id)"]) {
      assert.ok(indexOrFail(submit, call) > save, `${call} 이 저장보다 앞이다`);
      assert.ok(indexOrFail(submit, call) > ok, `${call} 이 저장 결과 판정보다 앞이다`);
    }
    // 변환을 부르는 자리는 둘뿐이다(만들기 · 고치기).
    assert.equal(submit.split("await convertSavedQuoteToPdf(").length - 1, 2);
  });

  test("🔴 고치기 — 그 가지 안, 팝업 앞. 읽을 것이 남으면 넘어가지 않는다", () => {
    const branch = indexOrFail(submit, "if (savedQuote) {");
    const convert = indexOrFail(submit, "if (!(await convertSavedQuoteToPdf(savedQuote.id))) return;");
    const popup = indexOrFail(submit, 'showSavePopup({ message: "견적서를 저장했습니다."');
    assert.ok(branch < convert && convert < popup, "차례가 틀렸다");
  });

  test("🔴 만들기 — 파일 올리기까지 끝난 뒤, 팝업 앞", () => {
    const upload = indexOrFail(submit, "await attachments.uploadQueuedAfterCreate(result.id,");
    const failed = indexOrFail(submit, "if (upload.failures.length > 0) {");
    const convert = indexOrFail(submit, "if (!(await convertSavedQuoteToPdf(result.id))) return;");
    const popup = indexOrFail(submit, 'showSavePopup({ message: "견적서를 등록했습니다."');
    assert.ok(upload < failed && failed < convert && convert < popup, "차례가 틀렸다");
  });

  test("🔴 저장 팝업 두 개는 그대로다 — 넘기기 직전에 단추를 되살리지 않는다", () => {
    assert.equal(raw.match(/leaving = true;\s*showSavePopup\(/g)?.length, 2);
    assert.ok(form.includes('showSavePopup({ message: "견적서를 저장했습니다.", redirectTo: returnHref ?? "/quotes" });'));
    assert.ok(form.includes('showSavePopup({ message: "견적서를 등록했습니다.", redirectTo: returnHref ?? "/quotes" });'));
  });
});

describe("🔴 폼은 주소를 만들지 않는다 — 흐름 하나에 맡긴다", () => {
  const helper = sliceBetween(form, "async function convertSavedQuoteToPdf(", "async function handleSubmit(");

  test("흐름을 부르고, 건너뛰는 판정에 쓸 값만 넘긴다", () => {
    assert.ok(
      form.includes('import { runQuoteSavePdfConvert } from "@/components/quotes/quote-save-pdf-convert";'),
      "흐름을 가져오지 않는다"
    );
    assert.ok(
      helper.includes("await runQuoteSavePdfConvert({ quoteId, subject: { kind, isExcelOnly } });"),
      helper
    );
  });

  test("🔴 도우미 주소 · iframe · 통로 주소가 폼에 없다", () => {
    for (const forbidden of ["dss-folder:", "xlsx2pdf", 'createElement("iframe")', "archive-folder/pdf"]) {
      assert.equal(code.includes(forbidden), false, `폼이 직접 한다: ${forbidden}`);
    }
  });

  test("🔴 넘어가도 되는 결과는 셋뿐이다 — 건너뜀 · 꺼짐 · 만들어짐", () => {
    assert.ok(
      helper.includes(
        'return outcome.kind === "SKIPPED" || outcome.kind === "DISABLED" || outcome.kind === "CREATED";'
      ),
      helper
    );
  });

  test("🔴 흐름이 던져도 저장은 되돌아가지 않는다 — 삼키고 넘어간다", () => {
    assert.ok(helper.includes("} catch (pdfError) {"), helper);
    assert.ok(helper.includes("return true;"), "던지면 사람을 이 화면에 가둔다");
    // 🔴 오류 message 를 적지 않는다 — 폴더 이름 · 경로가 섞인다(저장 쪽과 같은 규율).
    assert.equal(/pdfError instanceof Error \? pdfError\.message/.test(helper), false, helper);
    assert.ok(helper.includes("name: pdfError instanceof Error ? pdfError.name : typeof pdfError,"), helper);
    assert.ok(helper.includes("setPdfConverting(false);"), "도는 중 표시가 안 풀린다");
  });

  test("도는 중에는 「저장은 끝났다」를 먼저 적는다", () => {
    assert.ok(helper.includes("setPdfNoticeLines([{ text: QUOTE_SAVE_PDF_RUNNING_TEXT, tone: \"normal\" }]);"), helper);
  });
});

describe("알림 칸을 그린다", () => {
  test("흐름이 낸 줄을 그 조각에 넘긴다 — 곁에 [목록으로]", () => {
    assert.ok(
      form.includes(
        '<QuoteSavePdfNotice lines={pdfNoticeLines} busy={pdfConverting} onLeave={() => router.push(returnHref ?? "/quotes")} />'
      ),
      "알림 칸을 그리지 않는다"
    );
    // 한 번만 그린다.
    assert.equal(form.split("<QuoteSavePdfNotice ").length - 1, 1);
  });
});
