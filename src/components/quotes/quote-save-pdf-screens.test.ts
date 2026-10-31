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
 *  · 🔴 **도는 중은 팝업이다**(2026-10-12) — 변환이 시작될 때만 뜨고, 끝나면 「완료되었습니다」로
 *    바뀌며, 실패하면 팝업을 닫고 이 화면에 남는다
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
/**
 * 🔴 **`handleSubmit` 몸통만** 자른다.
 *
 * 🔵 2026-10-31 에 그 바로 뒤로 함수가 하나 더 생겼다 — 「승인요청이 반려되었습니다」
 * 팝업을 닫은 뒤 마무리를 잇는 `finishSaveAfterNotice`. 끝 표시를 `const disabled`
 * 로 두면 그 함수까지 한 덩이로 묶여, 아래 「변환을 부르는 자리는 둘뿐」이 **셋**으로
 * 읽힌다. 세 번째 자리는 아래 전용 묶음이 따로 잰다.
 */
const submit = sliceBetween(form, "async function handleSubmit(", "async function finishSaveAfterNotice(");

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
    const convert = indexOrFail(submit, "const afterPdf = await convertSavedQuoteToPdf(savedQuote.id);");
    const popup = indexOrFail(submit, 'showSavePopup({ message: "견적서를 저장했습니다."');
    assert.ok(branch < convert && convert < popup, "차례가 틀렸다");
    assert.ok(submit.includes('if (afterPdf === "STAY") return;'), submit.slice(convert, convert + 200));
  });

  test("🔴 만들기 — 파일 올리기까지 끝난 뒤, 팝업 앞", () => {
    const upload = indexOrFail(submit, "await attachments.uploadQueuedAfterCreate(result.id,");
    const failed = indexOrFail(submit, "if (upload.failures.length > 0) {");
    const convert = indexOrFail(submit, "const afterPdfOnCreate = await convertSavedQuoteToPdf(result.id);");
    const popup = indexOrFail(submit, 'showSavePopup({ message: "견적서를 등록했습니다."');
    assert.ok(upload < failed && failed < convert && convert < popup, "차례가 틀렸다");
    assert.ok(submit.includes('if (afterPdfOnCreate === "STAY") return;'), submit.slice(convert, convert + 200));
  });

  test("🔴 저장 팝업 두 개는 그대로다 — 넘기기 직전에 단추를 되살리지 않는다", () => {
    assert.equal(raw.match(/leaving = true;\s*showSavePopup\(/g)?.length, 2);
    assert.ok(form.includes('showSavePopup({ message: "견적서를 저장했습니다.", redirectTo: returnHref ?? "/quotes" });'));
    assert.ok(form.includes('showSavePopup({ message: "견적서를 등록했습니다.", redirectTo: returnHref ?? "/quotes" });'));
  });
});

/**
 * ============================================================================
 * 🔴 **세 번째 변환 자리** — 「승인요청이 반려되었습니다」를 닫은 뒤 (2026-10-31)
 * ============================================================================
 * 결재가 자동으로 반려된 저장은 그 사실을 **PDF 변환보다 먼저** 읽히고, 사람이
 * 팝업을 닫으면 지금까지의 마무리(변환 → 저장 팝업 → 넘어가기)를 그대로 잇는다.
 *
 * 🔴 **이 자리가 변환을 건너뛰면 안 된다** — 하필 내용이 바뀐 바로 그 장이라,
 * 건너뛰면 가장 새로 만들어야 할 PDF 만 옛 판으로 남는다.
 * ============================================================================
 */
describe("🔴 자동 반려 알림을 닫은 뒤에도 변환은 돈다", () => {
  const after = sliceBetween(form, "async function finishSaveAfterNotice(", "const disabled = isSubmitting || isConflict;");

  test("🔵 무엇을 재는지 — 그 함수가 원본에 있다", () => {
    assert.ok(after.length > 0);
  });

  test("🔴 변환을 부르고, 저장 팝업으로 끝맺는다", () => {
    assert.ok(after.includes("await convertSavedQuoteToPdf(quoteId)"), after);
    assert.ok(after.includes('showSavePopup({ message: "견적서를 저장했습니다."'), after);
  });

  test("🔴 변환 쪽에 읽을 것이 남으면 머물고 **단추를 되살린다** — 안 그러면 사람이 갇힌다", () => {
    assert.ok(after.includes('if (afterPdf === "STAY") { setIsSubmitting(false); return; }'), after);
  });

  test("🔴 두 갈래는 변환보다 **먼저** 갈린다 — 뒤에 두면 알림이 한 번도 안 보인다", () => {
    const unchanged = indexOrFail(submit, 'result.outcome === "UNCHANGED"');
    const rejected = indexOrFail(submit, 'result.outcome === "APPROVAL_AUTO_REJECTED"');
    const convert = indexOrFail(submit, "const afterPdf = await convertSavedQuoteToPdf(savedQuote.id);");
    assert.ok(unchanged < convert, "「안 바뀜」이 변환 뒤에 있다");
    assert.ok(rejected < convert, "「자동 반려」가 변환 뒤에 있다");
  });

  test("🔴 「안 바뀜」은 변환도 하지 않는다 — 한 글자도 저장되지 않았다", () => {
    const branch = sliceBetween(
      submit,
      'result.outcome === "UNCHANGED"',
      'result.outcome === "APPROVAL_AUTO_REJECTED"'
    );
    assert.equal(branch.includes("convertSavedQuoteToPdf"), false, branch);
  });
});

describe("🔴 폼은 주소를 만들지 않는다 — 흐름 하나에 맡긴다", () => {
  const helper = sliceBetween(form, "async function convertSavedQuoteToPdf(", "async function handleSubmit(");

  test("흐름을 부르고, 건너뛰는 판정에 쓸 값만 넘긴다", () => {
    assert.ok(
      form.includes(
        'import { QUOTE_SAVE_PDF_DONE_POPUP_TEXT, QUOTE_SAVE_PDF_RUNNING_POPUP_TEXT, runQuoteSavePdfConvert, } from "@/components/quotes/quote-save-pdf-convert";'
      ),
      "흐름을 가져오지 않는다"
    );
    assert.ok(helper.includes("await runQuoteSavePdfConvert({ quoteId, subject: { kind, isExcelOnly },"), helper);
  });

  test("🔴 도우미 주소 · iframe · 통로 주소가 폼에 없다", () => {
    for (const forbidden of ["dss-folder:", "xlsx2pdf", 'createElement("iframe")', "archive-folder/pdf"]) {
      assert.equal(code.includes(forbidden), false, `폼이 직접 한다: ${forbidden}`);
    }
  });

  test("🔴 넘어가도 되는 결과는 셋뿐이다 — 건너뜀 · 꺼짐 · 만들어짐", () => {
    assert.ok(
      helper.includes(
        'const canLeave = outcome.kind === "SKIPPED" || outcome.kind === "DISABLED" || outcome.kind === "CREATED";'
      ),
      helper
    );
  });

  test("🔴 흐름이 던져도 저장은 되돌아가지 않는다 — 삼키고 넘어간다", () => {
    assert.ok(helper.includes("} catch (pdfError) {"), helper);
    assert.ok(helper.includes('return "SAVED";'), "던지면 사람을 이 화면에 가둔다");
    // 🔴 오류 message 를 적지 않는다 — 폴더 이름 · 경로가 섞인다(저장 쪽과 같은 규율).
    assert.equal(/pdfError instanceof Error \? pdfError\.message/.test(helper), false, helper);
    assert.ok(helper.includes("name: pdfError instanceof Error ? pdfError.name : typeof pdfError,"), helper);
    assert.ok(helper.includes("setPdfConverting(false);"), "도는 중 표시가 안 풀린다");
    // 🔴 던져서 끝난 자리에 진행 팝업이 떠 있으면 사람이 갇힌다 — 걷고 나간다.
    assert.ok(helper.includes("if (converting) cancelSavePopupProgress();"), helper);
  });
});

/**
 * ============================================================================
 * 🔴 도는 중은 **팝업**이다 (2026-10-12 사용자 요구)
 * ============================================================================
 * 「[저장] → 팝업 "저장된 엑셀을 PDF 로 바꾸는 중입니다…"(안 닫힌다) → 끝나면 같은 팝업이
 * "완료되었습니다"로 바뀌고 → 0.5초 뒤 목록으로」. 팝업 쪽 규칙은 값으로
 * lib/domain/save-popup.test.ts 가, 띄우는 때는 quote-save-pdf-convert.test.ts 가 본다 —
 * 여기서 보는 것은 **폼이 그 둘을 어떻게 잇는가**다.
 * ============================================================================
 */
describe("🔴 도는 중은 팝업이다", () => {
  const helper = sliceBetween(form, "async function convertSavedQuoteToPdf(", "async function handleSubmit(");

  test("🔴 팝업은 **변환이 시작될 때만** 뜬다 — 흐름이 알려 주는 그 자리에서", () => {
    assert.ok(
      helper.includes(
        'onConvertStart: () => { converting = true; showSavePopupProgress({ message: QUOTE_SAVE_PDF_RUNNING_POPUP_TEXT, redirectTo: returnHref ?? "/quotes", }); },'
      ),
      helper
    );
    // 🔴 띄우는 자리는 하나뿐이다 — 흐름을 부르기 전에 미리 띄우면 엑셀 전용 견적서에도 뜬다.
    assert.equal(form.split("showSavePopupProgress(").length - 1, 1);
  });

  test("🔴 문구는 사용자가 적어 준 그대로다", () => {
    const texts = read("src/components/quotes/quote-save-pdf-convert.ts");
    assert.ok(
      texts.includes('export const QUOTE_SAVE_PDF_RUNNING_POPUP_TEXT = "저장된 엑셀을 PDF 로 바꾸는 중입니다…";'),
      "도는 중 문구가 바뀌었다"
    );
    assert.ok(
      texts.includes('export const QUOTE_SAVE_PDF_DONE_POPUP_TEXT = "완료되었습니다";'),
      "완료 문구가 바뀌었다"
    );
  });

  test("🔴 끝나면 「완료되었습니다」로 바꾸고, 저장 팝업을 **또 띄우지 않는다**", () => {
    assert.ok(helper.includes("finishSavePopupProgress(QUOTE_SAVE_PDF_DONE_POPUP_TEXT); return \"POPUP\";"), helper);
    // 두 가지(고치기 · 등록)가 다 같다 — 팝업이 넘기는 동안 단추만 잠가 둔다.
    assert.ok(submit.includes('if (afterPdf === "POPUP") { leaving = true; return; }'), submit);
    assert.ok(submit.includes('if (afterPdfOnCreate === "POPUP") { leaving = true; return; }'), submit);
  });

  test("🔴 실패하면 팝업을 닫고 이 화면에 남는다 — 노란 칸은 읽을 시간이 있다", () => {
    assert.ok(helper.includes('if (!canLeave) { cancelSavePopupProgress(); return "STAY"; }'), helper);
    // 🔴 실패에 완료 문구가 붙으면 안 된다 — 끝남은 넘어가도 되는 결과에서만 나간다.
    const fail = helper.indexOf("if (!canLeave) {");
    assert.ok(fail >= 0 && fail < helper.indexOf("finishSavePopupProgress("), helper);
  });

  test("🔴 팝업을 띄운 적이 없으면 지금까지 그대로다 — 엑셀 전용 견적서의 길", () => {
    assert.ok(helper.includes('if (!converting) return canLeave ? "SAVED" : "STAY";'), helper);
    // 저장 팝업 두 개는 그 길로만 간다(위 「저장 팝업 두 개는 그대로다」가 글자를 지킨다).
  });

  test("🔴 「도는 중」 칸은 더 이상 쓰지 않는다 — 줄은 끝난 뒤에만 찬다", () => {
    assert.equal(raw.includes("QUOTE_SAVE_PDF_RUNNING_TEXT"), false, "흐릿한 칸의 글이 폼에 남아 있다");
    assert.equal(/setPdfNoticeLines\(\[\{ text:/.test(form), false, form.slice(0, 0));
    // 결과 줄은 흐름이 낸 그대로 한 번만 담는다.
    assert.ok(helper.includes("setPdfNoticeLines(outcome.lines);"), helper);
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
