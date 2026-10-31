import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import {
  SERVICE_REPORT_BODY_LABEL_WIDTH,
  SERVICE_REPORT_BODY_LABELS,
  SERVICE_REPORT_CLOSING_MARK,
  SERVICE_REPORT_CLOSING_MARK_COLUMN_SHIFT,
  serviceReportBodyMetrics,
  type ServiceReportColumnWidths,
} from "@/lib/domain/service-report-body-wrap";

import { ServiceReportBodyPreview, ServiceReportRemarkPreview } from "./ServiceReportBodyPreview";
import {
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
 * 🔴 서버가 양식에서 읽어 넘기는 값. 여기서는 **실측한 두 벌**을 직접 넣어
 * 「폭이 바뀌면 화면도 바뀐다」를 본다.
 */
const OLD_TEMPLATE_COLUMNS: ServiceReportColumnWidths = {
  body: 40 * 1.875,
  remark: 25 * 1.875,
  label: 5 * 1.75,
  // 🔴 본문 칸이 몇 열인가 — 맺음 표시의 왼쪽 여백이 여기서 나온다(H:AU = 40).
  bodyColumns: 40,
};
const NEW_TEMPLATE_COLUMNS: ServiceReportColumnWidths = {
  body: 40 * 1.90625,
  remark: 25 * 1.90625,
  label: 5 * 1.7265625,
  bodyColumns: 40,
};
const METRICS = serviceReportBodyMetrics(OLD_TEMPLATE_COLUMNS);
const NEW_METRICS = serviceReportBodyMetrics(NEW_TEMPLATE_COLUMNS);

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
      METRICS.closingMarkIndentWidth
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
    assert.equal(serviceReportGridDocumentBoxPx(METRICS.closingMarkIndentWidth), 90);
    assert.equal(
      serviceReportGridDocumentBoxPx(METRICS.closingMarkIndentWidth) /
        serviceReportGridDocumentBoxPx(METRICS.columns.body),
      0.15
    );
    // 그 여백이 가운데를 **세 열** 옮긴다(가운데 맞춤이라 절반).
    const columnPx =
      serviceReportGridDocumentBoxPx(METRICS.columns.body) / METRICS.columns.bodyColumns;
    assert.equal(
      serviceReportGridDocumentBoxPx(METRICS.closingMarkIndentWidth) / 2 / columnPx,
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
      previewCode.includes("metrics.closingMarkIndentWidth"),
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
        serviceReportGridDocumentBoxCss(METRICS.columns.label),
        serviceReportGridDocumentBoxCss(METRICS.columns.body),
      ])
    );
    // 🔴 지어낸 px 가 아니다 — 양식의 열 너비 × 8px(= 96dpi 의 CSS 픽셀).
    //    배율 1배(= 문서 글꼴 9pt)에서 그 값이 그대로 나온다.
    assert.equal(serviceReportGridDocumentBoxPx(METRICS.columns.body), 600);
    assert.equal(serviceReportGridDocumentBoxPx(METRICS.columns.label), 70);
    // 🔴 라벨 글자(넷 다 6칸 = 전각 3자)가 그 칸에 들어간다 — 잘리면 반쪽 라벨이다.
    assert.ok(
      serviceReportGridDocumentBoxPx(METRICS.columns.label) >=
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
   * 본문 칸 75칸 → 76.25칸(줄 폭 84 → 85). 채우개는 매번 읽으니 따라갔고
   * **미리보기만 뒤처졌다.** 아래 둘이 그 자리를 지킨다.
   */
  test("🔴 양식이 넓어지면 **상자도 넓어진다**", () => {
    const wide = renderToStaticMarkup(
      <ServiceReportBodyPreview
        metrics={NEW_METRICS}
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
        serviceReportGridDocumentBoxCss(NEW_METRICS.columns.label),
        serviceReportGridDocumentBoxCss(NEW_METRICS.columns.body),
      ])
    );
    // 옛 양식으로 그린 상자와 **다른 값**이어야 한다 — 같으면 굳어 있는 것이다.
    assert.ok(
      !widths.has(serviceReportGridDocumentBoxCss(METRICS.columns.body)),
      "양식을 바꿨는데 본문 상자 폭이 그대로다"
    );
    assert.equal(serviceReportGridDocumentBoxPx(NEW_METRICS.columns.body), 610);
  });

  test("🔴 양식이 넓어지면 **줄도 그만큼 늦게 바뀐다**", () => {
    /*
      딱 **85칸**짜리 줄이다 — 84칸 양식에서는 둘로 나뉘고 85칸 양식에서는 한 줄에
      들어간다. ⚠️ 둘째 줄(`외관 손상 없음`)이 필요하다: 「확인내용」의 라벨이 두
      줄이라 내용이 한 줄이어도 구역은 두 줄을 먹어서, 한 줄짜리끼리 견주면 차이가
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
    assert.ok(rowsOf(METRICS).length > rowsOf(NEW_METRICS).length, "넓어졌는데 똑같이 나뉜다");
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
  /** 비고 상자는 라벨 칸이 없다 — 줄이 `<div>` 하나씩이다. */
  function remarkLines(html: string): string[] {
    return [...html.matchAll(/<div class="whitespace-pre[^"]*">([\s\S]*?)<\/div>/g)].map(
      (match) => match[1]
    );
  }

  test("🔴 본문보다 좁은 칸이다 — 그 차이가 폭으로 드러난다", () => {
    const html = renderToStaticMarkup(<ServiceReportRemarkPreview metrics={METRICS} remark="보증 기간 밖입니다." />);
    assert.equal(METRICS.remarkWrapWidth, 51);
    assert.ok(METRICS.remarkWrapWidth < METRICS.bodyWrapWidth);
    assert.ok(
      html.includes(`width:${serviceReportGridDocumentBoxCss(METRICS.columns.remark)}`),
      html.slice(0, 600)
    );
    assert.equal(serviceReportGridDocumentBoxPx(METRICS.columns.remark), 375);
    /*
      🔴 **그 좁은 비율이 어느 크기에서도 지켜진다.** 둘이 같은 미리보기 글꼴을
      곱하므로 비(375 : 600 = 5 : 8)가 배율에 안 흔들린다 — 비고를 본문과 같은
      폭으로 키우면 화면이 거짓말을 한다(문서에서 비고 칸은 더 좁다).
    */
    for (const previewFontSizePx of [9, 12, 15.43, 21.3, 24]) {
      assert.equal(
        serviceReportGridDocumentBoxPx(METRICS.columns.remark, previewFontSizePx) /
          serviceReportGridDocumentBoxPx(METRICS.columns.body, previewFontSizePx),
        375 / 600
      );
    }
  });

  test("🔴 가운데 맞춤이다 — 양식의 비고 칸이 그렇다(본문은 왼쪽)", () => {
    // 실측: `H60:AF60`~`H63:AF63` 의 가로 맞춤이 center, 행 높이는 15pt(= 20px).
    const html = renderToStaticMarkup(<ServiceReportRemarkPreview metrics={METRICS} remark="보증 기간 밖입니다." />);
    assert.match(html, /<div class="whitespace-pre text-center/);
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
    const long = "가".repeat(40); // 80칸 — 비고 51칸을 한참 넘는다
    const html = renderToStaticMarkup(<ServiceReportRemarkPreview metrics={METRICS} remark={long} />);
    assert.deepEqual(remarkLines(html), [long]);
    assert.ok(html.includes("text-amber-700"), "넘치는 줄에 표시가 없다");
    assert.ok(html.includes("자동으로 나뉘지 않아"), "넘친다는 설명이 없다");
  });

  test("칸에 들어가는 줄에는 표시가 없다", () => {
    const html = renderToStaticMarkup(<ServiceReportRemarkPreview metrics={METRICS} remark="보증 기간 밖입니다." />);
    assert.ok(!html.includes("text-amber-700"), "멀쩡한 줄에 경고가 붙었다");
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
