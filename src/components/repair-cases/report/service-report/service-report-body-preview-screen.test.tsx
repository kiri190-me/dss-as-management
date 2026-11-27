import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * 🔴 `.env.local` 의 **양식 경로 여섯**만 골라 넣는다. `npm run test:components` 는
 * `--import ./scripts/test-template-bootstrap.ts` 를 안 거치므로(unit 쪽만 그렇다)
 * 이 파일이 직접 부른다 — 안 부르면 아래 「진짜 양식으로」 묶음이 **영영 건너뛴다**.
 * 통째로 붓지 않는 이유는 그 로더 머리말에 있다(개발 DB 주소가 새면 안 된다).
 */
import "../../../../../scripts/load-template-env";

import { excelColumnRangePx } from "@/lib/domain/excel-column-width";
import {
  SERVICE_REPORT_BODY_LABEL_WIDTH,
  SERVICE_REPORT_BODY_LABELS,
  SERVICE_REPORT_CLOSING_MARK,
  SERVICE_REPORT_CLOSING_MARK_COLUMN_SHIFT,
  SERVICE_REPORT_REMARK_LABEL,
  serviceReportBodyMetrics,
  type ServiceReportColumnWidths,
} from "@/lib/domain/service-report-body-wrap";
import {
  findBodyBlock,
  readServiceReportBodyMetrics,
  SERVICE_REPORT_SHEET_NAME,
} from "@/lib/xlsx/service-report-template";
import { readSheetPrintGrid } from "@/lib/xlsx/sheet-print-grid";
import { resolveSheetPart } from "@/lib/xlsx/workbook-parts";
import { ZipArchive } from "@/lib/xlsx/zip-reader";

import { ServiceReportBodyPreview, ServiceReportRemarkPreview } from "./ServiceReportBodyPreview";
import {
  SERVICE_REPORT_GRID_ALIGN_CLASS,
  SERVICE_REPORT_GRID_CELL_PADDING_LEFT_PX,
  SERVICE_REPORT_GRID_PREVIEW_FONT_SIZE_PX,
  SERVICE_REPORT_GRID_REMARK_LINE_HEIGHT_PX,
  SERVICE_REPORT_GRID_ROW_CLASS,
  serviceReportGridDocumentBoxCss,
  serviceReportGridDocumentBoxPx,
  serviceReportGridPreviewScaledCss,
} from "./service-report-grid";

/**
 * ============================================================================
 * 적는 칸 **옆**에서 문서를 미리 보여 준다 (2026-10-18)
 * ============================================================================
 * 사용자 지적 둘이 이 화면을 만들었다:
 *   「빈 공간이 너무 낭비되는 것 같아」 → 좁힌 칸 옆에 미리보기를 놓았다
 *   「정말 최종 결과물을 미리보기하는 것 같은 화면으로」 → 발행본 모양으로 그린다
 *
 * 🔴 「같은 글을 넣으면 화면과 서버가 똑같이 나눈다」는 값으로
 * `lib/domain/service-report-body-wrap.test.ts` 와 — 실제 양식을 채워서 —
 * `lib/xlsx/service-report-template.test.ts` 가 본다. 여기서 보는 것은
 * **그 셈이 화면에 이어져 있는가**다:
 *   ① 문서의 한 줄이 화면의 한 줄로 그려진다(빈 줄도 자리를 지킨다)
 *   ② 🔴 라벨·맺음 표시가 **상수에서** 온다 — 글자를 두 번 적지 않았다
 *   ③ 🔴 칸의 폭·테두리·맞춤이 **문서 실측값**이다(2026-10-18 셋째 조각) —
 *      라벨 `C:G` 70px · 본문 `H:AU` 600px · 비고 `H:AF` 375px · 상자 위는 겹줄 ·
 *      본문은 왼쪽 맞춤이고 **비고는 가운데 맞춤**이다
 *   ④ 비고는 **나누지 않는다** — 채우개가 안 나누므로 나눠 그리면 거짓말이다
 *   ⑤ 🔴 좁은 화면에서는 **아래로** 내려간다(가로로 미는 화면을 만들지 않는다)
 *   ⑥ 🔴 칸 폭이 **props 로 들어온다**(2026-10-18 다섯째 조각) — 양식을 바꾸면
 *      상자도 줄 나뉨도 따라가고, 못 읽었으면 **옛 숫자로 물러서지 않는다**
 * ============================================================================
 */

/**
 * 🔴 서버가 양식에서 읽어 넘기는 값. 여기서는 **실측한 열 너비**를 칸 폭(px)으로
 * 바꿔 넣어 「폭이 바뀌면 화면도 바뀐다」를 본다.
 *
 * ⚠️ 🔴 **열 너비가 늘어도 칸 폭은 그대로일 수 있다**(2026-11-27). Excel 은 열을
 * 하나씩 환산하고 버려서 1.875·1.90625·1.9296875 가 전부 15px 이다. 그래서 아래
 * 둘은 **같은 600·375·70** 이고, 「넓어지면 따라간다」는 `WIDER_` 로 본다.
 * 양식에서 읽은 실물로 재는 쪽은 이 파일 맨 아래 「진짜 양식으로」 묶음이다.
 */
const rangePx = (columns: number, charsPerColumn: number): number =>
  excelColumnRangePx(Array.from({ length: columns }, () => charsPerColumn));

const OLD_TEMPLATE_COLUMNS: ServiceReportColumnWidths = {
  bodyPx: rangePx(40, 1.875),
  remarkPx: rangePx(25, 1.875),
  labelPx: rangePx(5, 1.75),
  // 🔴 본문 칸이 몇 열인가 — 맺음 표시의 왼쪽 여백이 여기서 나온다(H:AU = 40).
  bodyColumns: 40,
};
const NEW_TEMPLATE_COLUMNS: ServiceReportColumnWidths = {
  bodyPx: rangePx(40, 1.90625),
  remarkPx: rangePx(25, 1.90625),
  labelPx: rangePx(5, 1.7265625),
  bodyColumns: 40,
};
/** 🔴 한 열이 16px 이 되는 양식 — 버림 뒤에도 칸 폭이 **진짜로** 달라진다. */
const WIDER_TEMPLATE_COLUMNS: ServiceReportColumnWidths = {
  bodyPx: rangePx(40, 2),
  remarkPx: rangePx(25, 2),
  labelPx: rangePx(5, 2),
  bodyColumns: 40,
};
/** 🔴 비고 맞춤도 양식에서 온다 — 지금 양식 넷은 `left`, 10/19 사본은 `center`. */
const METRICS = serviceReportBodyMetrics(OLD_TEMPLATE_COLUMNS, "center");
const NEW_METRICS = serviceReportBodyMetrics(NEW_TEMPLATE_COLUMNS, "center");
const WIDER_METRICS = serviceReportBodyMetrics(WIDER_TEMPLATE_COLUMNS, "left");
const LEFT_METRICS = serviceReportBodyMetrics(OLD_TEMPLATE_COLUMNS, "left");

const read = (path: string): string =>
  readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");

/** 주석을 뺀 코드 — 머리말이 까닭을 설명하느라 적은 낱말에 걸리지 않게. */
const code = (source: string): string =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\s+/g, " ");

const bodyFields = read("./ServiceReportBodyFields.tsx");
const bodyFieldsCode = code(bodyFields);
const previewSource = read("./ServiceReportBodyPreview.tsx");

/**
 * 그려진 문서의 줄들 — 한 줄이 `[라벨 칸, 내용 칸]` 두 조각이다.
 *
 * 본문 상자는 `<div class="flex"><span>라벨</span><span>내용</span></div>` 가
 * 줄마다 하나씩이라, `<span>` 을 차례로 둘씩 묶으면 그대로 문서의 줄이 된다.
 */
function documentRows(html: string): [label: string, text: string][] {
  const cells = [...html.matchAll(/<span[^>]*>([\s\S]*?)<\/span>/g)].map((match) => match[1]);
  const rows: [string, string][] = [];
  for (let index = 0; index + 1 < cells.length; index += 2) {
    rows.push([cells[index], cells[index + 1]]);
  }
  return rows;
}

/** 빈 칸은 높이를 잃지 않도록 줄바꿈 없는 공백 한 자로 그린다. */
const BLANK = " ";

describe("본문 미리보기 — 발행본 모양", () => {
  const html = renderToStaticMarkup(
    <ServiceReportBodyPreview
      metrics={METRICS}
      findingsIntro="인수품에 대하여 이하의 항목을 확인하였습니다."
      findings={"외관 손상 없음\n\n절연 저항 측정값 500MΩ 이상"}
      actions="퓨즈 교체"
      summary="정상 동작을 확인하였습니다."
    />
  );

  test("🔴 문서의 한 줄이 화면의 한 줄이다 — 라벨·빈 줄·맺음 표시까지", () => {
    assert.deepEqual(documentRows(html), [
      ["확　내", "인수품에 대하여 이하의 항목을 확인하였습니다."],
      ["인　용", "외관 손상 없음"],
      // 사람이 사이를 띄우려고 넣은 빈 줄 — 자리를 지킨다.
      [BLANK, BLANK],
      [BLANK, "절연 저항 측정값 500MΩ 이상"],
      // 구역과 구역 사이에 채우개가 반드시 넣는 한 줄.
      [BLANK, BLANK],
      ["조  치", "퓨즈 교체"],
      [BLANK, BLANK],
      ["정  리", "정상 동작을 확인하였습니다."],
      // 🔴 맺음 표시 위의 **세 줄**(2026-10-31 사용자 결정: 「본문의 가장 마지막
      //    줄에서 3행을 띄우고 ~이 상~ 이 표시되도록」). 예전에는 한 줄이었다.
      [BLANK, BLANK],
      [BLANK, BLANK],
      [BLANK, BLANK],
      [BLANK, SERVICE_REPORT_CLOSING_MARK],
    ]);
  });

  test("🔴 라벨 글자를 화면이 지어내지 않았다 — 원본에 그 글자가 없다", () => {
    const previewCode = code(previewSource);
    for (const label of [
      ...SERVICE_REPORT_BODY_LABELS.findings,
      ...SERVICE_REPORT_BODY_LABELS.actions,
      ...SERVICE_REPORT_BODY_LABELS.summary,
      SERVICE_REPORT_CLOSING_MARK,
    ]) {
      assert.ok(!previewCode.includes(label), `미리보기에 「${label}」 글자가 박혀 있다`);
      assert.ok(!bodyFieldsCode.includes(label), `본문 폼에 「${label}」 글자가 박혀 있다`);
    }
    // 가져다 쓰는 길이 실제로 이어져 있는가.
    assert.ok(previewCode.includes("serviceReportBodyPreviewRows("), previewCode.slice(0, 300));
    assert.ok(bodyFields.includes("SERVICE_REPORT_CLOSING_MARK"), "맺음 표시를 상수로 안 썼다");
  });

  test("🔴 맺음 표시만 가운데 맞춤이다 — 문서에서 그 줄만 서식이 다르다", () => {
    const centered = [...html.matchAll(/<span[^>]*class="([^"]*)"[^>]*>([\s\S]*?)<\/span>/g)]
      .filter((match) => match[1].includes("text-center") && !match[1].includes("border-r"))
      .map((match) => match[2]);
    assert.deepEqual(centered, [SERVICE_REPORT_CLOSING_MARK]);
  });

  /**
   * ==========================================================================
   * 🔴 맺음 표시만 **왼쪽 여백이 더 붙는다** (2026-10-31)
   * ==========================================================================
   * 문서에서는 그 줄의 병합이 `H:AU` 가 아니라 `N:AU` 라 맺음 표시의 가운데가
   * 세 열 오른쪽이다(사용자: 「~이상~을 지금 위치보다 3열정도 우측에」). 화면은
   * 같은 자리를 **왼쪽 여백**으로 만든다 — 남은 폭에서 가운데 맞춤이므로 가운데가
   * 여백의 절반만 간다.
   * ==========================================================================
   */
  test("🔴 맺음 표시 줄만 왼쪽 여백이 더 붙는다 — 문서에서 세 열 오른쪽인 그만큼", () => {
    const paddings = [...html.matchAll(/padding-left:([^;"]+)/g)].map((match) => match[1]);
    const cellPadding = serviceReportGridPreviewScaledCss(SERVICE_REPORT_GRID_CELL_PADDING_LEFT_PX);
    const closingPadding = `calc(${cellPadding} + ${serviceReportGridDocumentBoxCss(
      METRICS.closingMarkIndentPx
    )})`;

    // 🔵 재는 것이 있는지부터 — 줄마다 내용 칸이 하나씩 있어야 한다.
    assert.ok(paddings.length >= 8, `여백을 ${paddings.length}개밖에 못 찾았다`);
    assert.equal(
      paddings.filter((padding) => padding === closingPadding).length,
      1,
      "맺음 표시 줄의 여백이 하나가 아니다"
    );
    assert.ok(
      paddings.filter((padding) => padding === cellPadding).length >= 7,
      "여느 줄의 여백이 함께 바뀌었다"
    );
    assert.equal(new Set(paddings).size, 2, "여백이 두 가지(여느 줄 · 맺음 줄)가 아니다");

    /**
     * 🔴 **값으로도 못 박는다.** 배율 1배에서 90px — 600px 상자의 15%(= 6/40 열)다.
     * `SERVICE_REPORT_CLOSING_MARK_COLUMN_SHIFT` 를 올리면 여기가 먼저 깨진다.
     */
    assert.equal(serviceReportGridDocumentBoxPx(METRICS.closingMarkIndentPx), 90);
    assert.equal(
      serviceReportGridDocumentBoxPx(METRICS.closingMarkIndentPx) /
        serviceReportGridDocumentBoxPx(METRICS.columns.bodyPx),
      0.15
    );
    // 그 여백이 가운데를 **세 열** 옮긴다(가운데 맞춤이라 절반).
    const columnPx =
      serviceReportGridDocumentBoxPx(METRICS.columns.bodyPx) / METRICS.columns.bodyColumns;
    assert.equal(
      serviceReportGridDocumentBoxPx(METRICS.closingMarkIndentPx) / 2 / columnPx,
      SERVICE_REPORT_CLOSING_MARK_COLUMN_SHIFT
    );
  });

  test("🔴 그 여백을 화면이 지어내지 않았다 — 양식에서 온 값이다", () => {
    const previewCode = code(previewSource);
    // 🔴 `15%`·`0.15`·`6/40` 중 하나라도 박혀 있으면, 상수를 올리는 날 화면만
    //    옛 자리에 남는다. 그 거짓말은 **문서를 열어 보기 전까지** 안 보인다.
    for (const forbidden of ["15%", "0.15", "6 / 40", "/ 40", "* 2"]) {
      assert.ok(!previewCode.includes(forbidden), `미리보기에 「${forbidden}」 이 박혀 있다`);
    }
    assert.ok(
      previewCode.includes("metrics.closingMarkIndentPx"),
      "맺음 표시 여백을 양식에서 온 값으로 안 쓰고 있다"
    );
  });

  test("🔴 폭이 **문서의 칸 그 자체**다 — 라벨 `C:G` · 본문 `H:AU`", () => {
    assert.equal(METRICS.bodyWrapWidth, 84);
    /*
      🔴 넷째 조각부터 폭이 **글꼴 크기에 비례하는 식**이다(창을 따라 함께 커진다).
      그래서 px 가 아니라 식 그대로를 맞춰 본다 — 어느 배율에서나 「문서의 칸 ×
      배율」이라는 뜻이 유지되는지는 `service-report-body-width-screen.test.ts` 가
      값으로 본다.
    */
    const widths = [...html.matchAll(/style="width:([^;"]+)/g)].map((match) => match[1]);
    assert.deepEqual(
      new Set(widths),
      new Set([
        serviceReportGridDocumentBoxCss(METRICS.columns.labelPx),
        serviceReportGridDocumentBoxCss(METRICS.columns.bodyPx),
      ])
    );
    // 🔴 지어낸 px 가 아니다 — 양식에서 읽은 칸 폭(열마다 환산해 더한 것)이다.
    //    배율 1배(= 문서 글꼴 9pt)에서 그 값이 그대로 나온다.
    assert.equal(serviceReportGridDocumentBoxPx(METRICS.columns.bodyPx), 600);
    assert.equal(serviceReportGridDocumentBoxPx(METRICS.columns.labelPx), 70);
    // 🔴 라벨 글자(넷 다 6칸 = 전각 3자)가 그 칸에 들어간다 — 잘리면 반쪽 라벨이다.
    assert.ok(
      serviceReportGridDocumentBoxPx(METRICS.columns.labelPx) >=
        (SERVICE_REPORT_BODY_LABEL_WIDTH / 2) * SERVICE_REPORT_GRID_PREVIEW_FONT_SIZE_PX,
      "라벨 칸이 라벨 글자보다 좁다"
    );
  });

  test("🔴 상자가 **세로로 늘어난다** — 옆의 적는 칸들만큼", () => {
    /*
      사용자 말: 「미리보기의 **세로 길이**를 본문 창에 맞게 더 늘려주고」.
      늘어남은 바깥 줄(stretch) → 미리보기 칸(`flex-1`) → 머리말 아래 스크롤 칸
      (`flex-1`) → 문서 상자(`flex-1`) 로 이어진다. 가운데 하나가 `flex` 를 잃으면
      거기서 끊기고, **화면에서만** 상자가 짧아진다(시험으로 못 잡히던 자리라
      사슬을 글자로 못 박는다).
    */
    assert.match(html, /^<div class="flex min-w-0 flex-1 flex-col">/);
    assert.ok(html.includes('<div class="flex flex-1 overflow-x-auto">'), html.slice(0, 300));
    assert.ok(html.includes('<div class="flex w-max flex-col">'), html.slice(0, 300));
    assert.match(html, /class="flex-1 border border-t-\[3px\]/);
    // 🔴 상자 안에서 따로 미끄러지지 않는다 — 숨겨진 줄이 생기면 믿을 수 없다.
    assert.ok(!/overflow-y-(auto|scroll)|min-h-0/.test(html), html.slice(0, 400));
  });

  test("🔴 상자의 테두리가 문서를 따른다 — 위만 겹줄이다", () => {
    // 실측: 본문 블록 첫 행(31행)의 위가 `double`, 좌우와 마지막 행 아래가 `thin`.
    assert.ok(html.includes("[border-top-style:double]"), html.slice(0, 400));
    assert.ok(html.includes("border-t-[3px]"), html.slice(0, 400));
  });

  test("🔴 줄은 다시 접히지 않는다 — 접으면 문서에 없는 줄바꿈이 보인다", () => {
    assert.ok(!/whitespace-pre-wrap|break-all|break-words/.test(html), html.slice(0, 400));
  });

  test("「정리」가 없는 건은 그 구역이 아예 안 그려진다", () => {
    const inspection = renderToStaticMarkup(
      <ServiceReportBodyPreview
        metrics={METRICS}
        findingsIntro=""
        findings="외관 손상 없음"
        actions="퓨즈 교체"
        summary=""
      />
    );
    assert.ok(!inspection.includes(SERVICE_REPORT_BODY_LABELS.summary[0]), "「정리」가 그려졌다");
    assert.deepEqual(documentRows(inspection), [
      // 🔴 확인내용이 한 줄뿐이어도 라벨 두 줄이 온전하다 — 문서에서도 그렇다.
      ["확　내", "외관 손상 없음"],
      ["인　용", BLANK],
      // 구역 사이는 한 줄 그대로다.
      [BLANK, BLANK],
      ["조  치", "퓨즈 교체"],
      // 맺음 표시 위는 세 줄(2026-10-31) — 구역 사이와 **따로** 산다.
      [BLANK, BLANK],
      [BLANK, BLANK],
      [BLANK, BLANK],
      [BLANK, SERVICE_REPORT_CLOSING_MARK],
    ]);
  });

  test("아직 아무것도 안 적었으면 빈 상자가 아니라 안내가 뜬다", () => {
    const empty = renderToStaticMarkup(
      <ServiceReportBodyPreview
        metrics={METRICS}
        findingsIntro="머리글"
        findings=""
        actions=""
        summary=""
      />
    );
    assert.ok(empty.includes("본문을 적으면 여기 보입니다."), empty);
    assert.ok(!empty.includes(SERVICE_REPORT_CLOSING_MARK), "적기도 전에 맺음 표시가 떴다");
    assert.deepEqual(documentRows(empty), []);
  });

  /**
   * ══════════════════════════════════════════════════════════════════════
   * 🔴 **양식이 바뀌면 화면이 따라간다** (2026-10-18 다섯째 조각)
   * ══════════════════════════════════════════════════════════════════════
   * 사용자가 양식 넷에 도장만 바꿔 저장했더니 Excel 이 열 너비를 다시 썼다 —
   * 채우개는 매번 읽으니 따라갔고 **미리보기만 뒤처졌다.** 아래 셋이 그 자리를
   * 지킨다.
   *
   * 🔴 **견주는 짝이 2026-11-27 에 바뀌었다.** 그때까지는 「1.875 양식 vs 1.90625
   * 양식」으로 보았는데, Excel 이 열마다 버리므로 그 둘은 **문서에서 같은 600px**
   * 이다(75칸 → 76.25칸이 줄 폭 84 → 85 가 된다고 본 것은 옛 환산의 착시였다).
   * 그래서 「넓어지면 따라간다」는 칸 폭이 **진짜로** 달라지는 양식으로 보고,
   * 「열 너비만 달라지면 화면도 안 달라진다」를 반대쪽에서 함께 못 박는다.
   */
  test("🔴 양식이 넓어지면 **상자도 넓어진다**", () => {
    const wide = renderToStaticMarkup(
      <ServiceReportBodyPreview
        metrics={WIDER_METRICS}
        findingsIntro=""
        findings="외관 손상 없음"
        actions="퓨즈 교체"
        summary=""
      />
    );
    const widths = new Set([...wide.matchAll(/style="width:([^;"]+)/g)].map((m) => m[1]));
    assert.deepEqual(
      widths,
      new Set([
        serviceReportGridDocumentBoxCss(WIDER_METRICS.columns.labelPx),
        serviceReportGridDocumentBoxCss(WIDER_METRICS.columns.bodyPx),
      ])
    );
    // 좁은 양식으로 그린 상자와 **다른 값**이어야 한다 — 같으면 굳어 있는 것이다.
    assert.ok(
      !widths.has(serviceReportGridDocumentBoxCss(METRICS.columns.bodyPx)),
      "양식을 바꿨는데 본문 상자 폭이 그대로다"
    );
    assert.equal(serviceReportGridDocumentBoxPx(WIDER_METRICS.columns.bodyPx), 640);
  });

  test("🔴 열 너비만 달라진 양식은 **상자도 그대로다** — 문서가 그렇다", () => {
    /*
      🔵 위 시험의 반대쪽이다. 「달라지면 따라간다」만 보면 «늘 달라진다»도 통과하고,
      그러면 화면이 문서보다 넓게 그리던 옛 식이 되살아나도 안 잡힌다.
    */
    const render = (metrics: typeof METRICS) =>
      new Set(
        [
          ...renderToStaticMarkup(
            <ServiceReportBodyPreview
              metrics={metrics}
              findingsIntro=""
              findings="외관 손상 없음"
              actions="퓨즈 교체"
              summary=""
            />
          ).matchAll(/style="width:([^;"]+)/g),
        ].map((m) => m[1])
      );
    assert.deepEqual(render(NEW_METRICS), render(METRICS));
    assert.equal(serviceReportGridDocumentBoxPx(NEW_METRICS.columns.bodyPx), 600);
  });

  test("🔴 양식이 넓어지면 **줄도 그만큼 늦게 바뀐다**", () => {
    /*
      딱 **85칸**짜리 줄이다 — 84칸 양식에서는 둘로 나뉘고 더 넓은 양식(89칸)에서는
      한 줄에 들어간다. ⚠️ 둘째 줄(`외관 손상 없음`)이 필요하다: 「확인내용」의 라벨이
      두 줄이라 내용이 한 줄이어도 구역은 두 줄을 먹어서, 한 줄짜리끼리 견주면 차이가
      라벨에 가려진다.
    */
    const findings =
      "RF-3000B 13.56MHz 30kW OUTPUT 0.0W REFLECT 0.0W DC-BUS 320V CTRL-BD REV2.1 SN 1234567\n" +
      "외관 손상 없음";
    const rowsOf = (metrics: typeof METRICS) =>
      documentRows(
        renderToStaticMarkup(
          <ServiceReportBodyPreview
            metrics={metrics}
            findingsIntro=""
            findings={findings}
            actions="퓨즈 교체"
            summary=""
          />
        )
      );
    assert.ok(rowsOf(METRICS).length > rowsOf(WIDER_METRICS).length, "넓어졌는데 똑같이 나뉜다");
  });

  test("🔴 양식을 못 읽으면 상자 대신 **까닭**이 뜬다 — 옛 숫자로 물러서지 않는다", () => {
    const blocked = renderToStaticMarkup(
      <ServiceReportBodyPreview
        metrics={null}
        findingsIntro=""
        findings="외관 손상 없음"
        actions="퓨즈 교체"
        summary=""
      />
    );
    assert.ok(blocked.includes("양식을 읽을 수 없어"), blocked);
    assert.deepEqual(documentRows(blocked), []);
    // 🔴 폭을 하나도 안 그린다 — 지어낸 칸으로 「문서처럼」 보여 주지 않는다.
    assert.ok(!blocked.includes("style=\"width:"), blocked);

    const remark = renderToStaticMarkup(
      <ServiceReportRemarkPreview metrics={null} remark="보증 기간 밖입니다." />
    );
    assert.ok(remark.includes("양식을 읽을 수 없어"), remark);
    assert.ok(!remark.includes("보증 기간 밖입니다."), "폭을 모르는데 비고를 그렸다");
  });
});

describe("비고 미리보기", () => {
  /** 비고의 줄들 — 라벨 칸은 `<span>` 이고 줄은 `<div>` 하나씩이다. */
  function remarkLines(html: string): string[] {
    return [...html.matchAll(/<div class="whitespace-pre[^"]*">([\s\S]*?)<\/div>/g)].map(
      (match) => match[1]
    );
  }

  /**
   * ══════════════════════════════════════════════════════════════════════
   * 🔴 **라벨 칸을 그린다** (2026-11-27 ③)
   * ══════════════════════════════════════════════════════════════════════
   * 그전에는 안 그렸다 — 「비　고」 글자가 채우개의 확인용 표에만 있어서 지어내지
   * 않으려던 것인데, 결과가 거짓말이었다. 문서에서는 라벨 칸 70px 가 비고 칸
   * 왼쪽에 서므로 그걸 빼면 비고 줄의 오른쪽 끝이 70px 일찍 끝나 보인다.
   * ══════════════════════════════════════════════════════════════════════
   */
  test("🔴 라벨 칸이 문서처럼 왼쪽에 선다 — 글자는 상수에서 온다", () => {
    const html = renderToStaticMarkup(
      <ServiceReportRemarkPreview metrics={METRICS} remark={"보증 기간 밖입니다.\n두 번째 줄"} />
    );
    // 라벨 칸은 **하나**다 — 문서의 `C60:G63` 이 네 줄에 걸친 한 칸이라서다.
    const labels = [...html.matchAll(/<span[^>]*>([\s\S]*?)<\/span>/g)].map((m) => m[1]);
    assert.deepEqual(labels, [SERVICE_REPORT_REMARK_LABEL]);
    // 줄은 둘인데 라벨은 하나 — 줄마다 라벨을 두는 본문과 다른 모양이다.
    assert.equal(remarkLines(html).length, 2);

    // 폭은 본문 미리보기의 라벨 칸과 **같은 값**이다(둘 다 문서의 `C:G`).
    assert.ok(
      html.includes(`width:${serviceReportGridDocumentBoxCss(METRICS.columns.labelPx)}`),
      html.slice(0, 800)
    );
    // 🔴 라벨 + 비고 칸이 문서의 가로 자리를 그대로 재현한다(70 + 375 = 445px).
    assert.equal(
      serviceReportGridDocumentBoxPx(METRICS.columns.labelPx) +
        serviceReportGridDocumentBoxPx(METRICS.columns.remarkPx),
      445
    );

    // 🔴 글자를 화면이 지어내지 않았다 — 원본에 그 글자가 없다(전각 공백 포함).
    assert.ok(
      !code(previewSource).includes(SERVICE_REPORT_REMARK_LABEL),
      "미리보기에 「비　고」 글자가 박혀 있다"
    );
  });

  test("🔴 본문보다 좁은 칸이다 — 그 차이가 폭으로 드러난다", () => {
    const html = renderToStaticMarkup(<ServiceReportRemarkPreview metrics={METRICS} remark="보증 기간 밖입니다." />);
    assert.equal(METRICS.remarkWrapWidth, 51);
    assert.ok(METRICS.remarkWrapWidth < METRICS.bodyWrapWidth);
    assert.ok(
      html.includes(`width:${serviceReportGridDocumentBoxCss(METRICS.columns.remarkPx)}`),
      html.slice(0, 600)
    );
    assert.equal(serviceReportGridDocumentBoxPx(METRICS.columns.remarkPx), 375);
    /*
      🔴 **그 좁은 비율이 어느 크기에서도 지켜진다.** 둘이 같은 미리보기 글꼴을
      곱하므로 비(375 : 600 = 5 : 8)가 배율에 안 흔들린다 — 비고를 본문과 같은
      폭으로 키우면 화면이 거짓말을 한다(문서에서 비고 칸은 더 좁다).
    */
    for (const previewFontSizePx of [9, 12, 15.43, 21.3, 24]) {
      assert.equal(
        serviceReportGridDocumentBoxPx(METRICS.columns.remarkPx, previewFontSizePx) /
          serviceReportGridDocumentBoxPx(METRICS.columns.bodyPx, previewFontSizePx),
        375 / 600
      );
    }
  });

  /**
   * ══════════════════════════════════════════════════════════════════════
   * 🔴 **맞춤도 양식에서 온다** (2026-11-27 ②)
   * ══════════════════════════════════════════════════════════════════════
   * 화면이 `text-center` 를 박아 두고 있었다. 2026-10-18 실측에서는 양식이 정말
   * `center` 였는데 지금 양식 넷은 `left` 다 — 화면만 가운데로 그리며 **이미
   * 거짓말을 하고 있었다.** 그래서 한쪽 값만 보지 않고 **양쪽을 다 본다**:
   * 양식이 center 면 center, left 면 left 로 그려야 한다.
   * ══════════════════════════════════════════════════════════════════════
   */
  test("🔴 가로 맞춤이 양식을 따른다 — center 면 center, left 면 left", () => {
    const render = (metrics: typeof METRICS) =>
      renderToStaticMarkup(
        <ServiceReportRemarkPreview metrics={metrics} remark="보증 기간 밖입니다." />
      );
    assert.match(render(METRICS), /<div class="whitespace-pre text-center/);
    assert.match(render(LEFT_METRICS), /<div class="whitespace-pre text-left/);
    // 🔵 반대쪽도 — 왼쪽 양식에서 가운데 맞춤 줄이 **없어야** 한다. (라벨 칸은
    //    `<span>` 이고 문서에서 가운데 맞춤이라 줄만 본다.)
    assert.ok(
      !/<div class="whitespace-pre text-center/.test(render(LEFT_METRICS)),
      "양식이 왼쪽인데 가운데로 그렸다"
    );
    // 🔴 화면 코드에 맞춤이 박혀 있지 않다 — 양식에서 온 값으로 고른다.
    const previewCode = code(previewSource);
    assert.ok(
      previewCode.includes("SERVICE_REPORT_GRID_ALIGN_CLASS[metrics.remarkAlign]"),
      "비고 맞춤을 양식에서 온 값으로 안 고르고 있다"
    );
  });

  test("🔴 줄 높이는 문서의 비고 행(15pt)이다 — 본문보다 조금 높다", () => {
    const html = renderToStaticMarkup(<ServiceReportRemarkPreview metrics={METRICS} remark="보증 기간 밖입니다." />);
    /*
      🔴 줄 높이를 px 가 아니라 **배수**로 적는다 — 확대하면 글자와 행이 같이
      커져야 상자 안이 계속 문서와 1:1 이다. 배수 × 문서 글꼴 = 실측한 15pt 다.
      (본문 행 14.1pt 와 다른 값인 것은 양식이 그렇기 때문이다.)
    */
    const lineHeight = /line-height:([\d.]+)[;"]/.exec(html);
    assert.ok(lineHeight, html.slice(0, 600));
    assert.ok(
      Math.abs(
        Number(lineHeight[1]) * SERVICE_REPORT_GRID_PREVIEW_FONT_SIZE_PX -
          SERVICE_REPORT_GRID_REMARK_LINE_HEIGHT_PX
      ) < 0.001,
      lineHeight[1]
    );
    assert.equal(SERVICE_REPORT_GRID_REMARK_LINE_HEIGHT_PX, 20);
  });

  test("🔴 나누지 않는다 — 넘치는 줄은 표시만 하고 글자는 그대로 둔다", () => {
    const long = "가".repeat(40); // 480px — 비고 370px 를 한참 넘는다
    const html = renderToStaticMarkup(<ServiceReportRemarkPreview metrics={METRICS} remark={long} />);
    assert.deepEqual(remarkLines(html), [long]);
    assert.ok(html.includes("text-amber-700"), "넘치는 줄에 표시가 없다");
    assert.ok(html.includes("자동으로 나뉘지 않아"), "넘친다는 설명이 없다");
  });

  test("칸에 들어가는 줄에는 표시가 없다", () => {
    const html = renderToStaticMarkup(<ServiceReportRemarkPreview metrics={METRICS} remark="보증 기간 밖입니다." />);
    assert.ok(!html.includes("text-amber-700"), "멀쩡한 줄에 경고가 붙었다");
  });

  /**
   * ══════════════════════════════════════════════════════════════════════
   * 🔴 **경고가 14% 일찍 뜨던 자리** (2026-11-27 ④)
   * ══════════════════════════════════════════════════════════════════════
   * 넘침을 본문의 줄 폭(칸 수 51)으로 재고 있었다. 거기에는 나누기 전용 안전
   * 여백이 들어 있어서, 문서(375px)에 멀쩡히 들어가는 한글 27~30자 줄을 주황색으로
   * 칠하고 「문서의 비고 칸보다 깁니다」를 띄웠다.
   * ══════════════════════════════════════════════════════════════════════
   */
  test("🔴 문서에 들어가는 줄은 경고하지 않는다 — 한글 30자까지", () => {
    const thirty = "가".repeat(30); // 360px ≤ 370px
    const ok = renderToStaticMarkup(
      <ServiceReportRemarkPreview metrics={METRICS} remark={thirty} />
    );
    assert.deepEqual(remarkLines(ok), [thirty]);
    assert.ok(!ok.includes("text-amber-700"), "문서에 들어가는 줄에 경고가 붙었다");
    assert.ok(!ok.includes("자동으로 나뉘지 않아"), "경고 설명까지 떴다");

    // 🔵 한 자만 더하면 경고가 뜬다 — 「아무 줄도 경고 안 한다」로 비어 버리지 않게.
    const thirtyOne = "가".repeat(31); // 372px > 370px
    const over = renderToStaticMarkup(
      <ServiceReportRemarkPreview metrics={METRICS} remark={thirtyOne} />
    );
    assert.ok(over.includes("text-amber-700"), "칸을 넘는 줄에 표시가 없다");
  });
});

describe("🔴 적는 칸 옆에 붙은 배선", () => {
  test("본문·비고 두 구역 모두 미리보기를 붙였다", () => {
    assert.ok(
      bodyFields.includes(
        'import { ServiceReportBodyPreview, ServiceReportRemarkPreview } from "./ServiceReportBodyPreview";'
      ),
      "미리보기를 가져오지 않았다"
    );
    assert.ok(bodyFieldsCode.includes("<ServiceReportBodyPreview"), bodyFieldsCode.slice(0, 200));
    assert.ok(
      bodyFieldsCode.includes(
        "<ServiceReportRemarkPreview metrics={bodyMetrics} remark={values.remark} />"
      )
    );
  });

  test("🔴 값을 글자 그대로 넘긴다 — 미리보기가 다시 나누는 짝이 원시값이어야 한다", () => {
    const at = bodyFieldsCode.indexOf("<ServiceReportBodyPreview");
    const block = bodyFieldsCode.slice(at, bodyFieldsCode.indexOf("/>", at));
    // 🔴 폭도 **그 양식에서 온 것**을 그대로 넘긴다 — 화면이 지어내지 않는다.
    assert.ok(block.includes("metrics={bodyMetrics}"), block);
    assert.ok(block.includes("findingsIntro={values.findingsIntro}"), block);
    assert.ok(block.includes("findings={values.findings}"), block);
    assert.ok(block.includes("actions={values.actions}"), block);
    // 🔴 「정리」는 수리 보고서에만 있다 — 적는 칸이 사라지는 조건과 같아야 한다.
    assert.ok(block.includes('summary={values.kind === "REPAIR" ? values.summary : ""}'), block);
  });

  test("🔴 좁은 화면에서는 아래로 내려간다 — 가로로 미는 화면을 만들지 않는다", () => {
    // 🔴 두 구역이 **같은 조각**을 쓴다. 베껴 적으면 한쪽만 고쳐지는 날이 온다.
    assert.equal(
      bodyFieldsCode.split("<ServiceReportGridRow metrics={bodyMetrics}>").length - 1,
      2,
      "본문과 비고 두 구역이 같은 줄 조각을 쓰지 않는다"
    );
    assert.ok(
      bodyFieldsCode.includes("className={SERVICE_REPORT_GRID_ROW_CLASS}"),
      "줄의 생김새가 한 곳에서 안 나온다"
    );
    // 기본이 세로고, 넓을 때만 가로다.
    assert.ok(SERVICE_REPORT_GRID_ROW_CLASS.startsWith("flex flex-col"), SERVICE_REPORT_GRID_ROW_CLASS);
    assert.ok(SERVICE_REPORT_GRID_ROW_CLASS.includes("@6xl:flex-row"), SERVICE_REPORT_GRID_ROW_CLASS);
    // 🔴 세로 맞춤을 **안 적는다**(= stretch) — 적으면 미리보기가 안 늘어난다.
    assert.ok(!/items-(start|center|baseline)/.test(SERVICE_REPORT_GRID_ROW_CLASS), SERVICE_REPORT_GRID_ROW_CLASS);
    assert.ok(!bodyFieldsCode.includes("2xl:items-start"), "옛 세로 맞춤이 남아 있다");
  });

  test("🔴 줄 수 세기는 그대로다 — 미리보기는 옆에서 보여 주기만 한다", () => {
    assert.ok(bodyFieldsCode.includes("<RowCounter used={bodyRows} limit={limits.maxBodyRows} />"));
    assert.ok(
      bodyFieldsCode.includes("<RowCounter used={remarkRows} limit={limits.maxRemarkRows} />")
    );
    assert.ok(
      bodyFieldsCode.includes(
        "countServiceReportBodyRows(serviceReportBodyLines(values), limits.bodyLayout)"
      )
    );
  });
});

/**
 * ============================================================================
 * 🔴 **진짜 양식으로 잰다** — 손으로 적은 값으로는 이 사고를 못 잡는다 (2026-11-27 ⑥)
 * ============================================================================
 * 위의 `OLD_`/`NEW_` 는 사람이 **적어 둔** 열 너비다. 그 값으로 재면 「화면이 그
 * 값을 쓰는가」는 보이지만 「그 값이 지금 양식과 같은가」는 영영 안 보인다 —
 * 실제로 2026-11-27 까지 양식은 `1.9296875` 였는데 시험은 `1.90625` 로 재며 초록이었다.
 * 이 화면이 막으려던 바로 그 사고가 **시험에는 없었다.**
 *
 * 그래서 여기서는 양식 파일을 **열어서** 잰다. 못 박는 것 둘:
 *
 *   ① 화면이 그린 `width:` 가 **문서의 px** 과 같은가. 🔴 「문서의 px」은
 *      작성 화면과 **다른 길**로 얻는다 — 문서 미리보기가 쓰는 격자 읽개
 *      (`readSheetPrintGrid`)의 `columnWidthsPt` 다. 같은 함수를 양쪽에서 불러
 *      맞춰 보면 식이 틀려도 통과하므로, 재는 길이 달라야 한다.
 *   ② 비고의 **가로 맞춤**이 양식 그대로인가(같은 격자의 `align`).
 *
 * ⚠️ 양식 경로는 환경변수에서 온다. 🔴 **없으면 건너뛴다** — 양식 파일이 없는 PC
 * (NAS·CI)에서 시험이 깨지면 안 된다(`xlsx/service-report-template.test.ts` 와 같은
 * 방식). 🔴 `npm run test:components` 는 `.env.local` 을 안 읽으므로 이 파일이
 * 직접 불러온다(`scripts/load-template-env` — `lib/auth/*.test.ts` 가 `load-env` 를
 * 그렇게 쓴다).
 * ============================================================================
 */
/**
 * 🔴 양식 경로 환경변수 여섯. **이름의 출처는 `storage/service-report-template.ts`**
 * 이고, 아래 시험이 그 원본에 여섯이 다 있는지 맞춰 본다 — 그쪽에서 이름을 바꾸면
 * 여기가 **조용히 건너뛰는** 대신 깨진다.
 *
 * ⚠️ 그 모듈을 직접 가져올 수는 없다. `import "server-only"` 가 들어 있어서
 * `npm run test:components` 처럼 `--conditions=react-server` 없이 도는 자리에서는
 * 가져오는 순간 던진다.
 */
const TEMPLATE_PATH_KEYS = [
  "MATCHER_INSPECTION_REPORT_TEMPLATE_PATH",
  "MATCHER_REPAIR_REPORT_TEMPLATE_PATH",
  "GENERATOR_INSPECTION_REPORT_TEMPLATE_PATH",
  "GENERATOR_REPAIR_REPORT_TEMPLATE_PATH",
  // 🔴 물러설 자리 둘 — 그쪽 머리말의 '물러서기'. 지금도 가리키는 파일이 다르다.
  "INSPECTION_REPORT_TEMPLATE_PATH",
  "REPAIR_REPORT_TEMPLATE_PATH",
] as const;

const configuredTemplates = TEMPLATE_PATH_KEYS.flatMap((key) => {
  const templatePath = process.env[key];
  // 🔴 경로는 담지 않는다 — 실패 메시지가 디스크 구조를 알려 주는 창구가 되면 안 된다.
  return templatePath === undefined ? [] : [{ key, templatePath }];
});

describe("🔴 진짜 양식으로 잰 폭·맞춤", () => {
  /** `A`·`AU` → 1부터 세는 열 번호. 양식을 안 읽는 순수 셈이라 시험 안에 둔다. */
  const columnIndexOf = (name: string): number =>
    [...name].reduce((sum, letter) => sum * 26 + (letter.charCodeAt(0) - 64), 0);

  /**
   * 🔵 **이 묶음이 통째로 잠드는 것을 막는다.** 환경변수 이름이 바뀌면 위 목록이
   * 아무것도 못 찾아 「건너뜀」으로 조용히 끝난다 — 그때 깨지라고 두는 자리다.
   */
  test("환경변수 이름이 양식 읽개의 것과 같다", () => {
    const storage = readFileSync(
      new URL("../../../../lib/storage/service-report-template.ts", import.meta.url),
      "utf8"
    );
    for (const key of TEMPLATE_PATH_KEYS) {
      assert.ok(storage.includes(`"${key}"`), `양식 읽개에 ${key} 가 없다 — 이름이 바뀌었다`);
    }
  });

  for (const { key, templatePath } of configuredTemplates) {
    test(`${key} — 화면이 그린 폭이 문서의 px 과 같다`, () => {
      const buffer = readFileSync(templatePath);
      const metrics = readServiceReportBodyMetrics(buffer);

      // ── 문서 쪽: 격자 읽개가 말하는 열 폭(px). pt = px × 0.75 로 실려 온다. ──
      const grid = readSheetPrintGrid(buffer, SERVICE_REPORT_SHEET_NAME);
      const documentPx = (first: number, last: number): number => {
        let sum = 0;
        for (let column = first; column <= last; column += 1) {
          const pt = grid.columnWidthsPt[column - grid.firstColumn];
          assert.ok(pt !== undefined, `${column}열이 인쇄 영역 밖이다`);
          sum += Math.round(pt / 0.75);
        }
        return sum;
      };

      // ── 범위는 양식이 스스로 적어 둔 곳에서 — 주소를 박지 않는다 ──
      const sheetXml = ZipArchive.fromBuffer(buffer).readText(
        resolveSheetPart(ZipArchive.fromBuffer(buffer), SERVICE_REPORT_SHEET_NAME)
      );
      const block = findBodyBlock(sheetXml);
      const bodyFirst = columnIndexOf(block.contentColumn);
      const bodyLast = columnIndexOf(block.contentEndColumn);

      // 🔵 재는 것이 있는지부터 — 범위가 비면 아래가 0 === 0 으로 공짜 통과한다.
      assert.ok(bodyLast > bodyFirst, "본문 열 범위를 못 읽었다");
      assert.equal(metrics.columns.bodyColumns, bodyLast - bodyFirst + 1);

      assert.equal(metrics.columns.bodyPx, documentPx(bodyFirst, bodyLast), "본문 칸 폭");
      assert.equal(
        metrics.columns.labelPx,
        documentPx(columnIndexOf(block.labelColumn), bodyFirst - 1),
        "라벨 칸 폭"
      );

      // 비고는 문서에서 「비　고」 라벨 칸의 **오른쪽 옆**이다 — 격자에서 찾는다.
      const cells = grid.rows.flatMap((row) => row.cells);
      const remarkLabel = cells.filter((cell) => cell.text === SERVICE_REPORT_REMARK_LABEL);
      assert.equal(remarkLabel.length, 1, "양식에서 「비　고」 라벨 칸이 하나가 아니다");
      const remarkCell = cells.find(
        (cell) =>
          cell.row === remarkLabel[0].row &&
          cell.column === remarkLabel[0].column + remarkLabel[0].colSpan
      );
      assert.ok(remarkCell, "「비　고」 라벨 오른쪽의 비고 칸을 못 찾았다");
      assert.equal(
        metrics.columns.remarkPx,
        documentPx(remarkCell.column, remarkCell.column + remarkCell.colSpan - 1),
        "비고 칸 폭"
      );
      // 🔴 맞춤도 문서가 말하는 그대로다. 코드에 박혀 있었다면 여기서 갈린다.
      assert.equal(metrics.remarkAlign, remarkCell.align, "비고 칸의 가로 맞춤");

      // ── 화면 쪽: 그려진 `width:` 가 그 px 에서 나온 식이어야 한다 ──
      const bodyHtml = renderToStaticMarkup(
        <ServiceReportBodyPreview
          metrics={metrics}
          findingsIntro=""
          findings="외관 손상 없음"
          actions="퓨즈 교체"
          summary=""
        />
      );
      assert.deepEqual(
        new Set([...bodyHtml.matchAll(/style="width:([^;"]+)/g)].map((m) => m[1])),
        new Set([
          serviceReportGridDocumentBoxCss(documentPx(bodyFirst, bodyLast)),
          serviceReportGridDocumentBoxCss(
            documentPx(columnIndexOf(block.labelColumn), bodyFirst - 1)
          ),
        ])
      );

      const remarkHtml = renderToStaticMarkup(
        <ServiceReportRemarkPreview metrics={metrics} remark="보증 기간 밖입니다." />
      );
      assert.ok(
        remarkHtml.includes(
          `width:${serviceReportGridDocumentBoxCss(
            documentPx(remarkCell.column, remarkCell.column + remarkCell.colSpan - 1)
          )}`
        ),
        remarkHtml.slice(0, 800)
      );
      // 🔴 그리고 그 줄이 양식의 맞춤으로 그려진다.
      assert.ok(
        remarkHtml.includes(
          `<div class="whitespace-pre ${SERVICE_REPORT_GRID_ALIGN_CLASS[metrics.remarkAlign]}`
        ),
        remarkHtml.slice(0, 800)
      );
    });
  }
});

