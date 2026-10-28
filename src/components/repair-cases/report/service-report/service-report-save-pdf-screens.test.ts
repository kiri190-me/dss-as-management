import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

/**
 * ============================================================================
 * 보고서 [저장] 뒤 연락서 폴더 · PDF 가 **제자리에서 불리는가** — 폼 원본을 글자로 (2026-10-12)
 * ============================================================================
 * ServiceReportForm 은 서버 액션을 부르는 클라이언트 컴포넌트라 이 시험 환경에서 그려 볼 수
 * 없다(`server-only`). 견적서 쪽 이웃(quote-save-pdf-screens.test.ts)과 **같은 방법**으로
 * 원본을 글자로 읽는다. 흐름의 값은 service-report-save-pdf-convert.test.ts 가 본다.
 *
 * 여기서 못 박는 것:
 *  · 🔴 **저장(DB)을 한 글자도 건드리지 않았다** — 저장 액션 호출이 그대로다
 *  · 🔴 변환은 저장 응답을 받고 **성공 갈래 안에서** 부른다 — 저장을 감싸지 않는다
 *  · 🔴 무슨 일이 나도 **저장은 되돌아가지 않는다**(던져도 삼키고 넘어간다)
 *  · 🔴 폼이 **주소를 제 손으로 만들지 않는다** · 분류를 고르지도 않는다
 *  · 🔴 도는 중은 **팝업**이고, 실패하면 팝업을 닫고 이 화면에 남는다
 * ============================================================================
 */

const raw = readFileSync(new URL("./ServiceReportForm.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const form = raw.replace(/\s+/g, " ");
/** 주석을 뺀 코드 — 머리말이 까닭을 설명하느라 적은 낱말에 걸리지 않게. */
const code = raw
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "")
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
  .replace(/\s+/g, " ");

function sliceBetween(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, `원본에서 '${startMarker}' 를 찾지 못했다`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(end > start, `원본에서 '${endMarker}' 를 찾지 못했다`);
  return source.slice(start, end);
}

function indexOrFail(source: string, marker: string): number {
  const at = source.indexOf(marker);
  assert.ok(at >= 0, `원본에서 '${marker}' 를 찾지 못했다`);
  return at;
}

const save = sliceBetween(form, "async function handleSave() {", "function openDelete() {");
const helper = sliceBetween(form, "async function archiveReportToContactFolder(", "async function handleSave() {");

describe("🔴 보고서 저장은 그대로다", () => {
  test("저장 액션 호출이 한 글자도 바뀌지 않았다", () => {
    assert.ok(
      save.includes(
        "const result = saved ? await updateServiceReportAction({ serviceReportId: saved.id, expectedVersion: saved.version, values, }) : await createServiceReportAction({ repairCaseId, values });"
      ),
      save
    );
  });

  test("🔴 변환은 저장 응답을 받은 **뒤**, 성공 갈래 안이다", () => {
    const action = indexOrFail(save, "const result = saved ? await updateServiceReportAction(");
    const notOk = indexOrFail(save, "if (!result.ok) {");
    // ⚠️ 2026-10-19 까지 이 자리의 표식은 `forgetDraft();`(임시보관 지우기)였다.
    //    임시보관을 걷어내면서 성공 갈래의 마지막 한 줄이 이것으로 바뀌었다.
    const settle = indexOrFail(save, "setSavedValues(values);");
    const convert = indexOrFail(save, "const next = await archiveReportToContactFolder(result.id);");
    assert.ok(action < notOk && notOk < settle && settle < convert, "차례가 틀렸다");
    // 부르는 자리는 하나뿐이다.
    assert.equal(save.split("await archiveReportToContactFolder(").length - 1, 1);
  });

  test("🔴 저장 성공 상태를 되돌리지 않는다 — 변환 뒤에 손대는 것은 팝업뿐", () => {
    const after = save.slice(indexOrFail(save, "const next = await archiveReportToContactFolder(result.id);"));
    for (const forbidden of ["setSaved(", "setSavedValues(", "setEdited("]) {
      assert.equal(after.includes(forbidden), false, `변환 뒤에 저장 상태를 건드린다: ${forbidden}`);
    }
    assert.ok(after.includes('if (next !== "SAVED") return;'), after);
  });

  test("🔴 저장 팝업은 그대로다 — 넘어가도 되는 길에서만 뜬다", () => {
    assert.ok(
      save.includes(
        'showSavePopup({ message: saved ? "보고서를 저장했습니다." : "새 보고서를 저장했습니다.", redirectTo: reportHref, });'
      ),
      save
    );
    // 🔴 **저장 흐름 안에서는 여전히 하나다.** 이것이 이 시험의 본래 보증이고,
    //    PDF 변환이 끼어든 뒤에도 팝업이 두 번 뜨지 않게 하는 자리다.
    assert.equal(save.split("showSavePopup({").length - 1, 1, "저장 흐름에서 팝업이 둘 이상이다");
    // 🔵 파일 전체로는 **둘**이다 — 2026-10-28 에 지우기 쪽에도 생겼다(사용자 요청:
    //    「휴지통으로 보내기를 누르면 목록으로 나오면서 0.5초 안내가 뜨게」).
    //    🔴 수를 못 박는 것은 일부러다. 늘면 여기서 멈추고 **어느 길에 생겼는지**
    //    적게 된다 — 저장 팝업은 성공 전용이라 아무 갈래에나 달면 안 된다.
    assert.equal(form.split("showSavePopup({").length - 1, 2, "팝업이 생기거나 사라졌다");
  });

  test("🔴 지우기 쪽 팝업은 지우기 흐름 안에만 있다 — 실패 갈래에는 없다", () => {
    const del = sliceBetween(form, "async function confirmDelete() {", "function handleConflictReload() {");
    assert.equal(del.split("showSavePopup({").length - 1, 1, "지우기 흐름의 팝업이 하나가 아니다");
    assert.ok(
      del.includes('showSavePopup({ message: "휴지통으로 이동되었습니다.", redirectTo: reportHref, });'),
      del
    );
    // 🔴 **성공 갈래에서만 뜬다.** `if (!result.ok)` 보다 뒤에 있어야 한다 —
    //    앞에 있으면 실패했는데도 「이동되었습니다」가 뜨고 목록으로 넘어간다.
    const notOk = indexOrFail(del, "if (!result.ok) {");
    const popup = indexOrFail(del, 'showSavePopup({ message: "휴지통으로 이동되었습니다."');
    assert.ok(notOk < popup, "실패를 가르기 전에 팝업을 띄운다");
    // 🔴 팝업이 넘기는 길과 router 가 미는 길이 **다투면 안 된다**. 지우기 흐름의
    //    replace·refresh 는 NOT_FOUND 갈래 하나뿐이어야 한다(거기는 팝업을 안 띄운다).
    assert.equal((del.match(/router\.refresh\(\)/g) ?? []).length, 1, "지우기에 refresh 가 둘 이상이다");
    assert.equal((del.match(/router\.replace\(/g) ?? []).length, 1, "지우기에 replace 가 둘 이상이다");
  });

  test("🔴 흐름이 던져도 저장은 되돌아가지 않는다 — 삼키고 넘어간다", () => {
    assert.ok(helper.includes("} catch (pdfError) {"), helper);
    assert.ok(helper.includes('return "SAVED";'), "던지면 사람을 이 화면에 가둔다");
    // 🔴 오류 message 를 적지 않는다 — 폴더 이름 · 경로가 섞인다.
    assert.equal(/pdfError instanceof Error \? pdfError\.message/.test(helper), false, helper);
    assert.ok(helper.includes("name: pdfError instanceof Error ? pdfError.name : typeof pdfError,"), helper);
    assert.ok(helper.includes("if (converting) cancelSavePopupProgress();"), helper);
  });
});

describe("🔴 폼은 주소를 만들지 않는다 · 분류를 고르지 않는다", () => {
  test("흐름 하나를 부르고, 넘길 것은 두 id 뿐이다", () => {
    assert.ok(
      form.includes(
        "await runServiceReportSavePdfConvert({ repairCaseId, serviceReportId, onConvertStart: () => {"
      ),
      helper
    );
  });

  test("🔴 도우미 주소 · iframe · 통로 주소 · 분류 글자가 폼에 없다", () => {
    for (const forbidden of [
      "dss-folder:",
      "xlsx2pdf",
      'createElement("iframe")',
      "contact-folder",
      // 🔴 분류 코드 — 폼이 자리를 고르면 서버 표와 두 벌이 된다.
      "INSPECTION_REPORT",
      "REPAIR_REPORT",
      "contactFolderCategoryFolderName",
    ]) {
      assert.equal(code.includes(forbidden), false, `폼이 직접 한다: ${forbidden}`);
    }
    /**
     * ⚠️ 「검사 보고서」 · 「수리 보고서」라는 **글자 자체**는 폼에 있다 — 종류 드롭다운과
     * 지우기 확인 창이 쓰는 `KIND_LABELS` 다(2026-09-03 부터 있던 것). 그것은 **화면에
     * 보이는 이름**이지 폴더 이름이 아니다. 폴더 이름은 서버가 이름표에서 짓는다.
     */
    assert.ok(form.includes('REPAIR: "수리 보고서", INSPECTION: "검사 보고서",'), "화면 이름표가 바뀌었다");
  });

  test("🔴 넘어가도 되는 결과 판정도 폼이 다시 적지 않는다", () => {
    assert.ok(helper.includes("const canLeave = canLeaveAfterServiceReportSavePdf(outcome.kind);"), helper);
    assert.equal(/outcome\.kind === "/.test(helper), false, "폼이 결과 갈래를 손으로 적는다");
  });
});

describe("🔴 도는 중은 팝업이다", () => {
  test("팝업은 **변환이 시작될 때만** 뜬다 — 흐름이 알려 주는 그 자리에서", () => {
    assert.ok(
      helper.includes(
        "onConvertStart: () => { converting = true; showSavePopupProgress({ message: SERVICE_REPORT_SAVE_PDF_RUNNING_POPUP_TEXT, redirectTo: reportHref, }); },"
      ),
      helper
    );
    assert.equal(form.split("showSavePopupProgress(").length - 1, 1);
  });

  test("끝나면 「완료되었습니다」로 바꾸고, 저장 팝업을 또 띄우지 않는다", () => {
    assert.ok(
      helper.includes('finishSavePopupProgress(SERVICE_REPORT_SAVE_PDF_DONE_POPUP_TEXT); return "POPUP";'),
      helper
    );
    assert.ok(save.includes('if (next !== "SAVED") return;'), save);
  });

  test("🔴 실패하면 팝업을 닫고 이 화면에 남는다 — 노란 칸은 읽을 시간이 있다", () => {
    assert.ok(helper.includes('if (!canLeave) { cancelSavePopupProgress(); return "STAY"; }'), helper);
    const fail = indexOrFail(helper, "if (!canLeave) {");
    assert.ok(fail < indexOrFail(helper, "finishSavePopupProgress("), helper);
  });

  test("팝업을 띄운 적이 없으면 지금까지 그대로다", () => {
    assert.ok(helper.includes('if (!converting) return canLeave ? "SAVED" : "STAY";'), helper);
  });
});

describe("알림 칸을 그린다", () => {
  test("흐름이 낸 줄을 그대로 담고, 곁에 [보고서 탭으로]", () => {
    assert.ok(helper.includes("setPdfNoticeLines(canLeave ? [] : outcome.lines);"), helper);
    assert.ok(
      form.includes(
        "<ServiceReportSavePdfNotice lines={pdfNoticeLines} onLeave={() => router.push(reportHref)} />"
      ),
      "알림 칸을 그리지 않는다"
    );
    assert.equal(form.split("<ServiceReportSavePdfNotice ").length - 1, 1);
    // 🔴 줄을 폼이 짓지 않는다 — 흐름이 낸 것만 담는다.
    assert.equal(/setPdfNoticeLines\(\[\{ text:/.test(form), false, "폼이 줄을 짓는다");
  });

  test("새 저장을 시작하면 앞 결과를 지운다", () => {
    assert.ok(save.includes("setPdfNoticeLines([]);"), save);
  });
});
