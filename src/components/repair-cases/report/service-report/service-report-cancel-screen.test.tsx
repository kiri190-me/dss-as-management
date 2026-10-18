import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import ServiceReportActions from "./ServiceReportActions";
import ServiceReportLeaveConfirmDialog from "./ServiceReportLeaveConfirmDialog";

/**
 * ============================================================================
 * 🔴 **임시보관을 걷어내고 [취소]를 둔다** (2026-10-19)
 * ============================================================================
 * 사용자 요구 둘:
 *
 *   ①「보고서에서 적은 내용이 지금은 브라우저에 임시보관 되고 있는데 그러지 말고
 *      **새로고침 하거나 나갔다오면 저장했던 내용으로 뜨도록** 해줘. (임시보관과
 *      진짜 저장된 내용간이 구분하기 힘들어서 **브라우저와 실제 파일이 차이가 생길
 *      것 같아.**) **[전체 미리보기]는 예외.**」
 *   ②「보고서에서 **[저장] 왼쪽에 [취소] 버튼**을 만들어줘. 그 버튼을 누르면 지금
 *      내용이 저장되지 않은 채 **보고서 탭으로 빠져나오게** 해줘. 그리고 **그
 *      버튼들을 [보고서 종류] 창 위에** 위치하도록 해줘.」
 *
 * 여기서 못 박는 것:
 *
 *   1. 🔴 **브라우저에 남는 자리가 없다** — 보고서 작성 화면 어디에도 `localStorage`
 *      가 없고, 화면이 시작하는 값은 서버가 넘긴 것 하나뿐이다. 그래서 새로고침하면
 *      **저장된 내용**이 뜬다.
 *   2. 🔴 **[전체 미리보기]는 예외** — 창이라 페이지를 떠나지 않는다. 열고 닫아도
 *      적던 글이 그대로다.
 *   3. 🔴 [취소]가 [저장] **바로 왼쪽**이고, 단추 줄이 「보고서 종류」 **위**다.
 *   4. 🔴 [취소]는 **저장하지 않는다.**
 *   5. 🔴 고친 것이 있으면 **묻고**, 그 글에 「사라집니다」가 들어 있다. 창에서
 *      그만두면 **적던 글이 그대로** 남는다.
 *
 * `ServiceReportForm` 은 서버 액션을 부르는 클라이언트 컴포넌트라 이 시험 환경에서
 * 그려 볼 수 없다(`server-only`). 이웃들과 **같은 방법**으로 원본을 글자로 읽는다
 * (service-report-save-pdf-screens.test.ts · service-report-document-preview-screen.test.tsx).
 * ============================================================================
 */

const HERE = fileURLToPath(new URL("./", import.meta.url));

const raw = readFileSync(new URL("./ServiceReportForm.tsx", import.meta.url), "utf8").replace(
  /\r\n/g,
  "\n"
);
/** 주석을 뺀 코드 — 머리말이 «없앴다»를 설명하느라 적은 낱말에 걸리지 않게. */
const code = raw
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "")
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
/** 공백을 한 칸으로 접은 것 — 여러 줄에 걸쳐 적힌 호출을 한 글자로 견주려고. */
const flat = code.replace(/\s+/g, " ");

function indexOrFail(source: string, marker: string): number {
  const at = source.indexOf(marker);
  assert.ok(at >= 0, `원본에서 '${marker}' 를 찾지 못했다`);
  return at;
}

// ───────────────────────────── 1. 브라우저에 남는 자리가 없다

describe("🔴 ① 새로고침하면 저장된 내용이 뜬다 — 브라우저에 남는 자리가 없다", () => {
  test("🔴 화면이 시작하는 값은 **서버가 넘긴 것 하나**뿐이다", () => {
    // 고친 것 > 서버가 넘긴 것. 가운데 「되살린 임시보관」이 빠졌다.
    assert.ok(flat.includes("const values = edited ?? initialValues;"), flat.slice(0, 400));
    assert.equal(
      /edited \?\? [^;]*Draft/.test(flat),
      false,
      "되살린 임시보관이 아직 값의 차례에 끼어 있다"
    );
  });

  test("🔴 보고서 작성 화면 **어느 파일에도** 브라우저 저장소가 없다", () => {
    const files = readdirSync(HERE).filter(
      (name) => /\.(ts|tsx)$/.test(name) && !name.includes(".test.")
    );
    // 화면 조각이 하나도 안 걸리면 시험이 아무것도 안 보고 통과한 것이다.
    assert.ok(files.length >= 8, `읽은 파일이 ${files.length}개뿐이다`);

    for (const name of files) {
      const text = readFileSync(new URL(`./${name}`, import.meta.url), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      for (const forbidden of ["localStorage", "sessionStorage", "document.cookie"]) {
        assert.equal(text.includes(forbidden), false, `${name} 에 ${forbidden} 가 남아 있다`);
      }
    }
  });

  test("🔴 임시보관을 읽고 적던 함수도, 그 안내 조각도 사라졌다", () => {
    for (const forbidden of [
      "readServiceReportDraft",
      "writeServiceReportDraft",
      "clearServiceReportDraft",
      "serviceReportDraftStorageKeys",
      "SERVICE_REPORT_DRAFT_SAVE_DEBOUNCE_MS",
      "useSyncExternalStore",
      "ServiceReportDraftNotice",
    ]) {
      assert.equal(code.includes(forbidden), false, `작성 화면에 ${forbidden} 가 남아 있다`);
    }
    assert.equal(
      existsSync(new URL("./ServiceReportDraftNotice.tsx", import.meta.url)),
      false,
      "임시보관 안내 조각이 아직 있다"
    );
  });

  test("🔴 「되살렸습니다」·「새로 시작」 같은 말이 화면에서 사라졌다", () => {
    for (const gone of [
      "임시로 보관",
      "되살렸습니다",
      "새로 시작",
      "저장된 내용으로",
      "나갔다 와도 그대로입니다",
    ]) {
      assert.equal(raw.includes(gone), false, `임시보관 문구가 남아 있다: ${gone}`);
    }
  });
});

// ───────────────────────────── 2. [전체 미리보기]는 예외

describe("🔴 ② [전체 미리보기]는 예외 — 열고 닫아도 적던 글이 그대로다", () => {
  test("창은 폼을 **대신하지 않고 곁에** 그려진다 — 폼이 떨어지지 않으니 글이 산다", () => {
    const fields = indexOrFail(flat, "<ServiceReportBodyFields");
    const dialog = indexOrFail(flat, "<ServiceReportDocumentPreviewDialog");
    assert.ok(fields < dialog, "창이 폼보다 앞에 있다 — 갈아 끼우는 모양이면 글이 날아간다");
    // 창을 띄우는 조건이 폼 전체를 감싸지 않는다(그랬다면 폼이 통째로 사라진다).
    assert.ok(
      flat.includes("{previewDocument !== null && ( <ServiceReportDocumentPreviewDialog"),
      "창을 띄우는 조건이 바뀌었다"
    );
  });

  test("🔴 **닫기는 창만 놓는다** — 적던 값(`edited`)에 손대지 않는다", () => {
    assert.ok(flat.includes("onClose={() => setPreviewDocument(null)}"), flat);
    // 닫는 길이 하나뿐이다 — 어딘가에서 값을 함께 놓는 두 번째 길이 없다.
    assert.equal(flat.split("setPreviewDocument(null)").length - 1, 2, "창을 닫는 길이 더 있다");
  });

  test("🔴 미리보기를 **여는** 쪽도 값을 건드리지 않는다", () => {
    const handler = code.slice(
      indexOrFail(code, "async function handlePreview()"),
      indexOrFail(code, "async function handleDownload()")
    );
    for (const forbidden of [
      "setEdited(",
      "setSavedValues(",
      "setLeaveConfirmOpen(",
      "router.",
      "createServiceReportAction",
      "updateServiceReportAction",
    ]) {
      assert.equal(handler.includes(forbidden), false, `미리보기가 값을 건드린다: ${forbidden}`);
    }
  });
});

// ───────────────────────────── 3. 자리

/** 단추 줄에 보이는 단추 이름을 **차례대로**. 링크(`<a>`)는 세지 않는다. */
function buttonLabels(html: string): string[] {
  return html
    .split("<button")
    .slice(1)
    .map((chunk) =>
      chunk
        .slice(chunk.indexOf(">") + 1, chunk.indexOf("</button>"))
        .replace(/<[^>]*>/g, "")
        .trim()
    );
}

const ACTIONS = {
  canEdit: true,
  canDelete: true,
  isSaving: false,
  isDownloading: false,
  isPreviewing: false,
  canSave: true,
  canDownload: true,
  hint: null,
  onCancel: () => {},
  onSave: () => {},
  onPreview: () => {},
  onDownload: () => {},
  onDelete: () => {},
};

function actions(overrides: Partial<Parameters<typeof ServiceReportActions>[0]> = {}): string {
  return renderToStaticMarkup(
    <ServiceReportActions mode="NEW" savedPrintHref={null} {...ACTIONS} {...overrides} />
  );
}

describe("🔴 ③ [취소]는 [저장] 바로 왼쪽, 단추 줄은 「보고서 종류」 위", () => {
  test("새 장 — [취소] 바로 다음이 [저장하기]다", () => {
    const labels = buttonLabels(actions());
    const cancel = labels.indexOf("취소");
    assert.ok(cancel >= 0, `[취소] 가 없다: ${labels.join(" / ")}`);
    assert.equal(labels[cancel + 1], "저장하기", labels.join(" / "));
  });

  test("저장된 장 — [지우기] · [전체 미리보기] 뒤에 [취소] · [저장]이 붙는다", () => {
    const labels = buttonLabels(
      actions({ mode: "SAVED", savedPrintHref: "/repair-cases/r-1/report/service-report/print?id=s-1" })
    );
    const cancel = labels.indexOf("취소");
    assert.ok(cancel >= 0, `[취소] 가 없다: ${labels.join(" / ")}`);
    assert.equal(labels[cancel + 1], "저장", labels.join(" / "));
    // 지우기는 여전히 저장에서 멀리 떨어져 있다(저장하려다 지우는 손을 막는다).
    assert.equal(labels[0], "지우기", labels.join(" / "));
  });

  test("🔴 저장 권한이 없어도 · 바쁜 중에도 나가는 길은 열려 있다", () => {
    const readOnly = buttonLabels(actions({ canEdit: false, canSave: false }));
    assert.ok(readOnly.includes("취소"), readOnly.join(" / "));
    assert.equal(readOnly.includes("저장하기"), false, "저장 권한이 없는데 [저장]이 보인다");

    const busy = actions({ isSaving: true, canSave: false, canDownload: false });
    const at = busy.indexOf("취소");
    const open = busy.slice(busy.lastIndexOf("<button", at), at);
    assert.equal(open.includes('disabled=""'), false, "바쁜 동안 [취소]가 잠긴다");
  });

  test("🔴 단추 줄이 「보고서 종류」 **위**에 있다", () => {
    const row = indexOrFail(flat, "<ServiceReportActions");
    const kind = indexOrFail(flat, '<ServiceReportSection title="보고서 종류"');
    assert.ok(row < kind, "단추 줄이 아직 「보고서 종류」 아래다");
    // 머리 항목·처리·본문보다도 위다 — 본문이 길어져도 [저장]이 손에 닿는다.
    assert.ok(row < indexOrFail(flat, "<ServiceReportHeaderFields"));
    assert.ok(row < indexOrFail(flat, "<ServiceReportBodyFields"));
    assert.equal(flat.split("<ServiceReportActions").length - 1, 1, "단추 줄이 두 벌이다");
  });
});

// ───────────────────────────── 4·5. 저장하지 않는다 · 묻는다

describe("🔴 ④ [취소]는 저장하지 않는다", () => {
  const leave = code.slice(
    indexOrFail(code, "function handleLeave()"),
    indexOrFail(code, "const rowLimitErrors")
  );

  test("서버 액션도 통로도 부르지 않는다 — 하는 일은 «묻거나 나가기»뿐이다", () => {
    for (const forbidden of [
      "createServiceReportAction",
      "updateServiceReportAction",
      "deleteServiceReportAction",
      "fetch(",
      "showSavePopup",
      "setEdited(",
      "setSavedValues(",
    ]) {
      assert.equal(leave.includes(forbidden), false, `[취소]가 저장 쪽을 건드린다: ${forbidden}`);
    }
  });

  test("🔴 가는 곳은 서버가 넘긴 「보고서」 탭 주소다 — 화면이 짓지 않는다", () => {
    assert.ok(leave.replace(/\s+/g, " ").includes("router.push(reportHref);"), leave);
    assert.equal(/router\.push\(["`]/.test(leave), false, "주소를 손으로 적는다");
  });

  test("🔴 [취소]와 머리의 [보고서 탭으로]가 **같은 길**을 지난다", () => {
    assert.ok(flat.includes("onCancel={handleLeave}"), "단추 줄이 handleLeave 를 안 쓴다");
    assert.ok(flat.includes("onClick={handleLeave}"), "머리의 [보고서 탭으로]가 안 묻는다");
    // 머리의 길이 아직 링크면 묻지 않고 빠져나간다.
    assert.equal(/<Link[^>]*href=\{reportHref\}/.test(flat), false, "머리가 아직 링크다");
  });
});

describe("🔴 ⑤ 고친 것이 있으면 묻는다 — 그만두면 글이 그대로다", () => {
  test("🔴 **고친 것이 있을 때만** 뜬다 — 판단은 도메인 함수 하나다", () => {
    assert.ok(
      flat.includes("const dirty = serviceReportValuesChanged(savedValues ?? initialValues, values);"),
      flat
    );
    assert.ok(
      flat.includes("function handleLeave() { if (dirty) { setLeaveConfirmOpen(true); return; } leaveWithoutSaving(); }"),
      flat
    );
  });

  test("🔴 창에서 그만두면 **창만 닫힌다** — 적던 글에 손대지 않는다", () => {
    assert.ok(
      flat.includes(
        "<ServiceReportLeaveConfirmDialog isOpen={leaveConfirmOpen} onConfirm={leaveWithoutSaving} onCancel={() => setLeaveConfirmOpen(false)} />"
      ),
      flat
    );
  });

  test("🔴 글에 「사라집니다」가 **그대로** 들어 있다 — 돌아올 길이 없기 때문이다", () => {
    const html = renderToStaticMarkup(
      <ServiceReportLeaveConfirmDialog isOpen onConfirm={() => {}} onCancel={() => {}} />
    );
    assert.ok(html.includes("지금 나가면 적은 내용이 사라집니다"), html);
    assert.ok(html.includes("되살릴 수 없습니다"), html);
    assert.ok(html.includes("[저장]"), "남기는 길을 안 알려 준다");
  });

  test("창은 브라우저 기본 팝업이 아니라 이 저장소의 모양이다", () => {
    const source = readFileSync(
      new URL("./ServiceReportLeaveConfirmDialog.tsx", import.meta.url),
      "utf8"
    ).replace(/\/\*[\s\S]*?\*\//g, "");
    assert.equal(/\bconfirm\(/.test(source), false, "브라우저 기본 confirm 을 쓴다");
    assert.ok(source.includes("dialog.showModal()"), "휴지통 창들과 같은 native <dialog> 가 아니다");

    const html = renderToStaticMarkup(
      <ServiceReportLeaveConfirmDialog isOpen onConfirm={() => {}} onCancel={() => {}} />
    );
    // 나가는 쪽과 그만두는 쪽, 둘뿐이다.
    assert.deepEqual(buttonLabels(html), ["돌아가서 계속 적기", "저장하지 않고 나가기"]);
  });
});
