import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import type { SheetPrintGrid } from "@/lib/xlsx/sheet-print-grid";

import ServiceReportActions from "./ServiceReportActions";
import ServiceReportDocumentPreviewDialog from "./ServiceReportDocumentPreviewDialog";

/**
 * ============================================================================
 * 🔴 **[전체 미리보기]** — 저장하지 않은 문서를 보는 단추와 창 (2026-10-19)
 * ============================================================================
 * 사용자 요구: 「보고서 수정하고서 **저장을 누르지 않은 채** 저장 옆에 있는
 * 미리보기를 눌렀을 때에 수정한 내용이 반영되도록 해줘.」
 *
 * 값 쪽(보낸 값이 문서에 찍히는가 · 저장이 일어나지 않는가 · 인가)은
 * `lib/server/service-report-preview-grid.test.ts` 와
 * `app/api/repair-cases/*​/service-report/preview-grid/route-source.test.ts` 가 본다.
 * 여기서 보는 것은 **화면에 이어져 있는가**다:
 *
 *   ① 🔴 저장 전에도 단추가 **눌린다**(예전에는 「저장한 뒤에 볼 수 있습니다」였다)
 *   ② 🔴 막는 조건이 [Excel 내려받기]와 **같다**(`canDownload` 하나)
 *   ③ 🔴 **저장된 장의 인쇄 길이 사라지지 않았다** — 목록에서 지난 보고서를 여는
 *      그 화면이고, 인쇄 · PDF 는 거기서 한다
 *   ④ 🔴 창이 **저장되지 않았다는 사실을 말한다**(안 적으면 「봤으니 저장됐겠지」가 된다)
 *   ⑤ 🔴 창에 **인쇄 단추가 없다** — 뒤에 깔린 작성 화면까지 딸려 나가고, 저장하지
 *      않은 문서가 종이로 나가 결과물로 믿긴다
 *   ⑥ 🔴 도장 그림이 **서버가 넘긴 주소**에서 온다(격자를 뽑은 그 양식)
 *   ⑦ 🔴 미리보기 누르기가 **저장 액션을 부르지 않는다**(원본 글자로 본다)
 * ============================================================================
 */

const ACTIONS = {
  canEdit: true,
  canDelete: true,
  isSaving: false,
  isDownloading: false,
  isPreviewing: false,
  canSave: true,
  canDownload: true,
  hint: null,
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

/**
 * 그 글자가 든 단추가 **잠겨 있는가**.
 *
 * 🔴 `"disabled"` 를 통째로 찾으면 안 된다 — 클래스에 `disabled:opacity-50` 이
 * 들어 있어서 늘 참이 된다(실제로 한 번 속았다). React 가 찍는 **속성**
 * (`disabled=""`)으로 본다.
 */
function buttonDisabled(html: string, label: string): boolean {
  const at = html.indexOf(label);
  assert.ok(at >= 0, `「${label}」 단추가 없다`);
  const start = html.lastIndexOf("<button", at);
  assert.ok(start >= 0, `「${label}」 가 단추 안에 없다`);
  const openTag = html.slice(start, html.indexOf(">", start));
  return openTag.includes('disabled=""');
}

describe("단추 줄 — 저장 전에도 전체 미리보기가 눌린다", () => {
  test("🔴 새 장(저장 전)에도 [전체 미리보기]가 있고 눌린다", () => {
    const html = actions();
    assert.ok(html.includes("전체 미리보기"));
    assert.equal(buttonDisabled(html, "전체 미리보기"), false, "저장 전이라고 잠겨 있다");
    // 예전 안내는 더 이상 참이 아니다 — 저장하지 않아도 볼 수 있다.
    assert.equal(html.includes("미리보기는 저장한 뒤에 볼 수 있습니다"), false);
  });

  test("🔴 막는 조건이 [Excel 내려받기]와 같다 — 반쪽짜리 문서를 보여 주지 않는다", () => {
    const html = actions({ canDownload: false });
    assert.ok(buttonDisabled(html, "전체 미리보기"), "내려받기만 막고 미리보기는 열려 있다");
    // 내려받기도 같은 조건으로 막힌다 — 둘이 갈리면 한쪽으로 반쪽 문서가 새어 나간다.
    assert.ok(buttonDisabled(html, "Excel 내려받기"));
    // 열려 있을 때는 둘 다 열려 있다.
    const open = actions();
    assert.equal(buttonDisabled(open, "전체 미리보기"), false);
    assert.equal(buttonDisabled(open, "Excel 내려받기"), false);
  });

  test("도는 동안 「만드는 중…」 으로 바뀐다", () => {
    assert.ok(actions({ isPreviewing: true }).includes("만드는 중…"));
  });

  test("🔴 저장된 장의 인쇄 길이 그대로 남아 있다 — 인쇄 · PDF 는 그 화면의 일이다", () => {
    const href = "/repair-cases/r-1/report/service-report/print?id=s-1";
    const saved = actions({ mode: "SAVED", savedPrintHref: href });
    assert.ok(saved.includes("저장본 인쇄 · PDF"));
    assert.ok(saved.includes(`href="${href.replace(/&/g, "&amp;")}"`), saved);
    // 아직 저장하지 않았으면 가리킬 id 가 없으므로 붙지 않는다.
    assert.equal(actions().includes("저장본 인쇄 · PDF"), false);
  });
});

/** 창이 그릴 수 있는 가장 작은 격자. 자리 셈은 공용 조각의 시험이 본다. */
const GRID: SheetPrintGrid = {
  firstRow: 1,
  lastRow: 1,
  firstColumn: 1,
  lastColumn: 1,
  columnWidthsPt: [120],
  widthPt: 120,
  heightPt: 20,
  rows: [
    {
      row: 1,
      heightPt: 20,
      cells: [
        {
          row: 1,
          column: 1,
          colSpan: 1,
          rowSpan: 1,
          text: "아직 저장하지 않은 확인내용",
          align: null,
          verticalAlign: null,
          wrap: false,
          bold: false,
          fontSizePt: 9,
          borders: { top: null, right: null, bottom: null, left: null },
          fontColor: null,
          backgroundColor: null,
          valueKind: "text",
        },
      ],
    },
  ],
  pictures: [{ name: "image3.png", leftPt: 1, topPt: 1, widthPt: 20, heightPt: 20 }],
  page: {
    paperSize: 9,
    scale: 0.94,
    orientation: "portrait",
    margins: { left: 0.25, right: 0.25, top: 0.25, bottom: 0.25 },
    horizontallyCentered: true,
    verticallyCentered: false,
  },
};

function dialog(templateImageBase = "/api/service-reports/template-image/REPAIR/MATCHER/"): string {
  return renderToStaticMarkup(
    <ServiceReportDocumentPreviewDialog
      grid={GRID}
      kindLabel="수리보고서"
      templateImageBase={templateImageBase}
      onClose={() => {}}
    />
  );
}

describe("미리보기 창 — 저장되지 않았다는 것을 말한다", () => {
  test("🔴 머리글이 «아직 저장하지 않았다»를 적는다", () => {
    const html = dialog();
    assert.ok(html.includes("아직 저장하지 않은 내용입니다"));
    assert.ok(html.includes("저장되지 않습니다"));
    // 닫고 나갈 길이 있다 — 문서가 화면을 덮으므로 갇히면 안 된다.
    assert.ok(html.includes("닫기"));
    assert.ok(html.includes('role="dialog"') && html.includes('aria-modal="true"'));
  });

  test("🔴 인쇄 단추를 두지 않고, 인쇄할 길을 알려 준다", () => {
    const html = dialog();
    // 🔴 창 안의 단추는 **닫기 하나**다. 여기서 인쇄하면 뒤에 깔린 작성 화면까지
    //    딸려 나가고, 저장하지 않은 문서가 종이로 나가 결과물로 믿긴다.
    const buttons = html.split("<button").length - 1;
    assert.equal(buttons, 1, `창에 단추가 ${buttons}개다 — 닫기 하나여야 한다`);
    assert.ok(html.includes("닫기"));
    // 대신 **어디서 인쇄하는지**를 글로 알려 준다.
    assert.ok(html.includes("[저장본 인쇄 · PDF]"), "인쇄할 길을 안 알려 준다");
    // 창을 그리는 코드에 인쇄를 부르는 길이 없다.
    const source = readFileSync(
      new URL("./ServiceReportDocumentPreviewDialog.tsx", import.meta.url),
      "utf8"
    ).replace(/\/\*[\s\S]*?\*\//g, "");
    assert.equal(source.includes("window.print()"), false);
  });

  test("🔴 격자와 도장이 **서버가 넘긴 주소**에서 온다", () => {
    const html = dialog();
    assert.ok(html.includes("아직 저장하지 않은 확인내용"), "격자의 글자를 안 그렸다");
    assert.ok(
      html.includes('src="/api/service-reports/template-image/REPAIR/MATCHER/image3.png"'),
      html
    );
    // 양식이 갈리면 도장 주소도 갈린다 — 화면이 주소를 들고 있지 않다는 뜻이다.
    assert.ok(
      dialog("/api/service-reports/template-image/REPAIR/GENERATOR/").includes(
        'src="/api/service-reports/template-image/REPAIR/GENERATOR/image3.png"'
      )
    );
  });

  test("저장된 장의 미리보기 화면과 **같은 CSS** 로 종이를 그린다", () => {
    const html = dialog();
    // 베낀 것이 아니라 그 화면이 내보낸 함수를 쓴다(ServiceReportPrintView).
    for (const marker of ["srp-page", "srp-sheet", "srp-table", "srp-picture", "--srp-fit"]) {
      assert.ok(html.includes(marker), `종이 CSS 가 빠졌다: ${marker}`);
    }
  });
});

describe("🔴 [전체 미리보기]는 저장이 아니다 — 작성 화면 원본으로 지킨다", () => {
  const form = readFileSync(new URL("./ServiceReportForm.tsx", import.meta.url), "utf8").replace(
    /\r\n/g,
    "\n"
  );
  const code = form.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const handler = (() => {
    const at = code.indexOf("async function handlePreview()");
    assert.ok(at >= 0, "handlePreview 를 찾지 못했다");
    const end = code.indexOf("async function handleDownload()", at);
    assert.ok(end > at, "handlePreview 의 끝을 찾지 못했다");
    return code.slice(at, end);
  })();

  test("저장 액션도 임시보관 지우기도 부르지 않는다", () => {
    for (const forbidden of [
      "createServiceReportAction",
      "updateServiceReportAction",
      "deleteServiceReportAction",
      "forgetDraft",
      "clearServiceReportDraft",
      "setSaved",
      "showSavePopup",
      "router.",
    ]) {
      assert.equal(handler.includes(forbidden), false, `미리보기가 저장 쪽을 건드린다: ${forbidden}`);
    }
  });

  test("🔴 내려받기와 **같은 요청 본문**을 보낸다 — 문서가 갈라질 자리를 안 만든다", () => {
    assert.ok(handler.includes("buildServiceReportRequestBody(values)"));
    assert.ok(handler.includes("/service-report/preview-grid"));
    assert.ok(handler.includes('method: "POST"'));
  });

  test("🔴 누를 때만 돈다 — 타자마다 도는 effect 가 아니다", () => {
    assert.equal(handler.includes("useEffect"), false);
    assert.ok(code.includes("onPreview={() => void handlePreview()}"));
  });
});
