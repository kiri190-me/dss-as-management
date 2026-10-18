import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

import {
  serviceReportBodyMetrics,
  type ServiceReportColumnWidths,
} from "@/lib/domain/service-report-body-wrap";

import {
  SERVICE_REPORT_GRID_CELL_PADDING_LEFT_PX,
  SERVICE_REPORT_GRID_CONTAINER_CLASS,
  SERVICE_REPORT_GRID_FONT_CSS,
  SERVICE_REPORT_GRID_FONT_FAMILY,
  SERVICE_REPORT_GRID_FONT_VAR,
  SERVICE_REPORT_GRID_INPUT_CLASS,
  SERVICE_REPORT_GRID_INPUT_FONT_SIZE_PX,
  SERVICE_REPORT_GRID_INPUT_FRAME_PX,
  SERVICE_REPORT_GRID_INPUT_LINE_HEIGHT_PX,
  SERVICE_REPORT_GRID_MAX_FONT_SIZE_PX,
  SERVICE_REPORT_GRID_MAX_PREVIEW_FONT_SIZE_PX,
  SERVICE_REPORT_GRID_PREVIEW_BORDER_PX,
  SERVICE_REPORT_GRID_PREVIEW_FONT_CSS,
  SERVICE_REPORT_GRID_PREVIEW_FONT_SIZE_PX,
  SERVICE_REPORT_GRID_PREVIEW_FONT_VAR,
  SERVICE_REPORT_GRID_PREVIEW_LINE_HEIGHT_PX,
  SERVICE_REPORT_GRID_REMARK_LINE_HEIGHT_PX,
  SERVICE_REPORT_GRID_ROW_CLASS,
  SERVICE_REPORT_GRID_ROW_GAP_PX,
  SERVICE_REPORT_GRID_SIDE_BY_SIDE_PX,
  serviceReportGridDocumentBoxCss,
  serviceReportGridDocumentBoxPx,
  serviceReportGridFontSizeForRowWidth,
  serviceReportGridInputContentCss,
  serviceReportGridInputContentPx,
  serviceReportGridInputMaxWidthCss,
  serviceReportGridInputMaxWidthPx,
  serviceReportGridInputScaledCss,
  serviceReportGridInputScaledPx,
  serviceReportGridInputStyle,
  serviceReportGridMinFontSizePx,
  serviceReportGridPreviewBoxWidthPx,
  serviceReportGridPreviewFontCss,
  serviceReportGridPreviewFontSizePx,
  serviceReportGridPreviewScaledCss,
  serviceReportGridPreviewScaledPx,
  serviceReportGridPreviewTextStyle,
  serviceReportGridRemarkPreviewTextStyle,
  serviceReportGridRowFontCss,
  serviceReportGridRowWidthPx,
  serviceReportGridScaleStyle,
  serviceReportGridStackedFontCss,
} from "./service-report-grid";

/**
 * ============================================================================
 * 적는 칸과 미리보기의 **글꼴과 폭** (2026-10-18)
 * ============================================================================
 * 세 조각이 이 자리를 차례로 손봤다:
 *   ① 칸의 **폭**을 문서의 칸 폭에 맞췄다
 *   ② 폭이 맞아도 줄 바뀌는 자리가 달라, 반각이 전각의 **정확히 절반**인 고정폭
 *      글꼴(돋움체·굴림체)을 세워 「칸 수 × 글꼴 크기 ÷ 2」로 폭을 냈다
 *   ③ 🔴 **사용자가 글꼴을 지정했다** — 「엑셀 글꼴이 [맑은 고딕 (본문)] 이거든?
 *      그 글꼴로 해줘.」 맑은 고딕은 영숫자가 **가변폭**이라 ②의 2:1 전제가
 *      깨진다. 그래서 **역할을 나눈다**: 적는 칸은 줄 자리가 «대략», 오른쪽
 *      미리보기는 «정확». 그 사실이 화면 안내문에도 적혀 있어야 한다.
 *
 * 폼은 서버 액션을 부르는 클라이언트 컴포넌트라 이 시험 환경에서 그려 볼 수 없다.
 * 이웃(service-report-save-pdf-screens.test.ts)과 **같은 방법**으로 원본을 글자로 읽고,
 * 셈 자체는 `service-report-grid.ts` 를 값으로 불러 본다.
 *
 * 여기서 못 박는 것:
 *  ① 본문으로 들어가는 네 칸(머리글·확인내용·조치·정리)이 **모두** 문서의 칸 수를 받는다
 *  ② 비고는 문서에서 더 좁으므로(`H60:AF60`) **제 칸 수**를 따로 받는다
 *  ③ 🔴 글꼴이 **한 곳에서** 나온다 — 적는 칸과 미리보기가 같은 상수를 쓴다
 *  ④ 🔴 폭도 **한 곳에서** 나온다 — 두 화면이 px 를 글자로 적어 두지 않았다
 *  ⑤ 🔴 쓰는 글꼴이 **맑은 고딕**이다(사용자 지정 · 문서가 쓰는 글꼴)
 *  ⑥ 🔴 「글꼴 크기는 짝수」 규칙이 **없어졌다** — 비트맵 글꼴 때문에 있던 것이다
 *  ⑦ 🔴 **상한이지 고정 폭이 아니다** — 좁은 화면에서 가로 스크롤이 생기면 안 된다
 *  ⑧ 🔴 스크롤막대가 글 폭을 먹지 않는다 — 여덟 줄을 넘기는 순간 일찍 바뀐다
 *  ⑨ 🔴 안내문이 **지금 사실과 맞는다** — 옛 설명이 남아 있지 않다
 *  ⑩ 🔴 공용 입력칸(`editInputClass`)은 **한 글자도 안 바뀌었다** — 거기에 폭을 적으면
 *     수리건 상세 같은 상관없는 화면이 전부 함께 좁아진다
 *
 * ── 🔴 넷째 조각(2026-10-18): 「가로폭을 다 채우도록」 · 「반응형으로」 ──────
 * 폭이 이제 **창 크기를 따라 움직인다.** 그래서 여기서 못 박을 것이 셋 늘었다:
 *  ⑪ 🔴 **폭이 글꼴 크기에서 나온다** — 화면에 적히는 CSS 식의 비율과, 값을 돌려주는
 *     px 함수가 **같은 수**다(둘이 따로 놀면 넓힐 때마다 줄 나뉨이 어긋난다)
 *  ⑫ 🔴 **한글 42자 기준이 어느 크기에서도 유지된다** — 글꼴을 여러 값으로 넣어
 *     글 폭이 정확히 비례하는지 본다
 *  ⑬ 🔴 **가로가 남지 않는다** — 글꼴을 정하는 식이 폭을 세는 함수의 **역산**이고,
 *     적는 칸이 상한에 닿은 뒤에는 미리보기가 남은 자리를 메운다
 *
 * ── 🔴 다섯째 조각(2026-10-18): 폭이 **양식에서 들어온다** ─────────────────
 * 칸 폭이 화면에 굳어 있었다. 사용자가 양식 넷에 **도장만 바꿔 저장**했는데 Excel 이
 * 열 너비를 다시 써서(1.875 → 1.90625) 그 값이 틀어졌다. 이제 서버가 읽어 props 로
 * 넘긴다. 그래서 여기서 못 박을 것이 둘 늘었다:
 *  ⑭ 🔴 치수 함수들이 **인자로 받은 폭**을 쓴다 — 옛 양식 값을 넣으면 지금까지의
 *     px(600 · 375 · 70 · 614)가 그대로 나오고, 새 양식 값을 넣으면 **다 함께 커진다**
 *  ⑮ 🔴 화면 원본에 폭 숫자도, 없어진 상수 이름도 남아 있지 않다
 * ============================================================================
 */

/**
 * 🔴 두 양식의 **실측 열 너비**. 시험의 입력이지 화면이 들고 있는 값이 아니다
 * (화면에 굳힌 값이 없다는 것은 아래 「굳힌 폭이 없다」가 본다).
 *
 *   옛 양식 — 본문 40열 × 1.875    · 비고 25열 × 1.875    · 라벨 5열 × 1.75
 *   새 양식 — 본문 40열 × 1.90625  · 비고 25열 × 1.90625  · 라벨 5열 × 1.7265625
 */
const OLD_TEMPLATE_COLUMNS: ServiceReportColumnWidths = {
  body: 40 * 1.875,
  remark: 25 * 1.875,
  label: 5 * 1.75,
};
const NEW_TEMPLATE_COLUMNS: ServiceReportColumnWidths = {
  body: 40 * 1.90625,
  remark: 25 * 1.90625,
  label: 5 * 1.7265625,
};
const METRICS = serviceReportBodyMetrics(OLD_TEMPLATE_COLUMNS);
const NEW_METRICS = serviceReportBodyMetrics(NEW_TEMPLATE_COLUMNS);

/** 그 양식에서 나오는 글꼴 하한. 🔴 **상수였던 것이 함수가 되었다** — 폭을 탄다. */
const MIN_FONT_SIZE_PX = serviceReportGridMinFontSizePx(METRICS);

const read = (path: string): string =>
  readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");

const bodyFields = read("./ServiceReportBodyFields.tsx");
const field = read("./ServiceReportField.tsx");
const preview = read("./ServiceReportBodyPreview.tsx");
const shared = read("../../detail/edit/EditSectionActions.tsx");

/** 주석을 뺀 코드 — 머리말이 까닭을 설명하느라 적은 낱말에 걸리지 않게. */
const code = (source: string): string =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\s+/g, " ");

const bodyCode = code(bodyFields);
const fieldCode = code(field);
const previewCode = code(preview);

describe("본문으로 들어가는 칸은 문서의 칸 수를 받는다", () => {
  test("머리글·확인내용·조치·정리 네 칸 모두", () => {
    for (const label of ["확인내용 머리글 (정형 문구)", "확인내용", "조치", "정리"]) {
      const at = bodyCode.indexOf(`label="${label}"`);
      assert.ok(at >= 0, `원본에서 「${label}」 칸을 찾지 못했다`);
      const block = bodyCode.slice(at, bodyCode.indexOf("/>", at));
      assert.ok(
        block.includes("gridColumns={bodyMetrics?.bodyWrapWidth}"),
        `「${label}」 칸이 **양식에서 온** 칸 수를 안 받는다: ${block}`
      );
    }
    assert.equal(
      bodyCode.split("gridColumns={bodyMetrics?.bodyWrapWidth}").length - 1,
      4,
      "본문 칸 수를 받는 칸이 네 개가 아니다"
    );
  });

  test("비고는 문서에서 더 좁다 — 제 칸 수를 따로 받는다", () => {
    const at = bodyCode.indexOf('label="비고"');
    assert.ok(at >= 0, "원본에서 「비고」 칸을 찾지 못했다");
    const block = bodyCode.slice(at, bodyCode.indexOf("/>", at));
    assert.ok(block.includes("gridColumns={bodyMetrics?.remarkWrapWidth}"), block);
    for (const metrics of [METRICS, NEW_METRICS]) {
      assert.ok(metrics.remarkWrapWidth < metrics.bodyWrapWidth);
    }
  });

  test("🔴 양식을 못 읽으면 눈금을 **안 준다** — 옛 숫자로 물러서지 않는다", () => {
    // `gridColumns` 가 `undefined` 면 `ServiceReportField` 가 보통 입력칸으로 그린다.
    assert.ok(bodyCode.includes("gridColumns={bodyMetrics?.bodyWrapWidth}"), bodyCode.slice(0, 200));
    assert.ok(
      bodyCode.includes("bodyMetrics === null ? undefined :"),
      "양식을 못 읽었을 때 기둥 폭을 비우지 않는다"
    );
    assert.ok(
      !/\b(84|51|75|46\.875|8\.75)\b/.test(bodyCode),
      "본문 폼 코드에 폭 숫자가 박혀 있다"
    );
    assert.ok(!/\b(84|51|75|46\.875|8\.75)\b/.test(previewCode), "미리보기에 폭 숫자가 박혀 있다");
  });

  test("폼의 다른 여러 줄 칸(상황 상세)은 받지 않는다 — 문서에서 다른 칸이다", () => {
    const headerFields = code(read("./ServiceReportHeaderFields.tsx"));
    assert.ok(!headerFields.includes("gridColumns"), "머리 구역 칸에 문서 눈금이 붙었다");
    assert.ok(fieldCode.includes("gridColumns?: number"), "눈금은 **주는 칸만** 받아야 한다");
  });
});

/**
 * 🔴 **두 폭이 다른 것은 이제 정상이다.**
 *
 *   적는 칸  = 한글 `칸 수 ÷ 2` 자가 꼭 들어가는 폭(84칸 → 42자 × 14px = 588px)
 *   미리보기 = **문서의 칸 그 자체**(본문 열 너비 75칸 × 8px = 600px)
 *
 * 문서는 600px 칸 안에서 84칸(= 한글 42자)까지만 쓰도록 안전 여백을 두고 나누므로
 * (`contentWrapWidth`), 미리보기 상자가 적는 칸보다 **넓은 것이 맞다**. 여기서
 * 못 박는 것은 「두 폭이 같다」가 아니라 **「두 폭이 모두 한 곳에서 나온다」**다.
 */
describe("🔴 폭이 한 곳에서 나온다", () => {
  test("적는 칸 = 한글 `칸 수 ÷ 2` 자 + 입력칸 테두리", () => {
    assert.equal(
      serviceReportGridInputMaxWidthPx(METRICS.bodyWrapWidth),
      serviceReportGridInputContentPx(
        METRICS.bodyWrapWidth,
        SERVICE_REPORT_GRID_INPUT_FONT_SIZE_PX
      ) + SERVICE_REPORT_GRID_INPUT_FRAME_PX
    );
    // 한글 한 자는 맑은 고딕에서 정확히 1em 이다 — 그래서 42자 = 42 × 글꼴 크기.
    for (const fontSizePx of [12, 14, 13]) {
      assert.equal(serviceReportGridInputContentPx(2, fontSizePx), fontSizePx);
      assert.equal(serviceReportGridInputContentPx(84, fontSizePx), 42 * fontSizePx);
    }
  });

  test("🔴 미리보기 상자 = 문서의 칸 그 자체다 — 열 너비 × 8px", () => {
    // 옛 양식을 넣으면 지금까지의 px 그대로다.
    assert.equal(serviceReportGridDocumentBoxPx(METRICS.columns.body), 600);
    assert.equal(serviceReportGridDocumentBoxPx(METRICS.columns.remark), 375);
    assert.equal(serviceReportGridDocumentBoxPx(METRICS.columns.label), 70);
    // 🔴 새 양식을 넣으면 **다 함께 넓어진다** — 굳혀 두면 문서보다 좁게 그린다.
    assert.equal(serviceReportGridDocumentBoxPx(NEW_METRICS.columns.body), 610);
    assert.equal(serviceReportGridDocumentBoxPx(NEW_METRICS.columns.remark), 381);
    assert.equal(serviceReportGridDocumentBoxPx(NEW_METRICS.columns.label), 69);
    // 🔴 문서의 칸이 한글 42자 폭보다 넓다 — 그 차이가 양식의 안전 여백이다.
    for (const metrics of [METRICS, NEW_METRICS]) {
      assert.ok(
        serviceReportGridDocumentBoxPx(metrics.columns.body) >
          serviceReportGridInputContentPx(
            metrics.bodyWrapWidth,
            SERVICE_REPORT_GRID_PREVIEW_FONT_SIZE_PX
          ),
        "미리보기 상자가 한글 42자 폭보다 좁다 — 영숫자로 찬 줄이 테두리를 넘친다"
      );
    }
  });

  test("🔴 두 화면이 숫자를 따로 적어 두지 않았다 — 셈을 불러서 쓴다", () => {
    assert.ok(
      bodyCode.includes("serviceReportGridInputMaxWidthCss(bodyMetrics.bodyWrapWidth)"),
      "적는 칸 기둥의 폭이 셈에서 안 나온다"
    );
    assert.ok(
      previewCode.includes("serviceReportGridDocumentBoxCss(metrics.columns.body)"),
      "미리보기 폭이 **양식에서 온 값**으로 안 나온다"
    );
    assert.ok(
      previewCode.includes("serviceReportGridDocumentBoxCss(metrics.columns.label)"),
      "라벨 칸 폭이 **양식에서 온 값**으로 안 나온다"
    );
    assert.ok(
      previewCode.includes("serviceReportGridDocumentBoxCss(metrics.columns.remark)"),
      "비고 칸 폭이 **양식에서 온 값**으로 안 나온다"
    );
    assert.ok(
      previewCode.includes("serviceReportGridPreviewScaledCss("),
      "칸 안쪽 여백이 배율을 안 탄다"
    );
    // px 를 글자로 박아 둔 자리가 없다. 🔴 `calc(비율 × var(…))` 만 쓴다.
    for (const [name, source] of [
      ["본문 폼", bodyCode],
      ["미리보기", previewCode],
    ] as const) {
      assert.ok(!/max-w-\[\d+px\]/.test(source), `${name}에 폭이 글자로 박혀 있다`);
      assert.ok(!/\bwidth:\s*\d+px/.test(source), `${name}에 폭이 글자로 박혀 있다`);
      assert.ok(!/\$\{[A-Za-z_$][\w$]*\}px/.test(source), `${name}에 폭을 px 로 굳히는 자리가 있다`);
    }
  });

  test("🔴 기둥이 입력칸보다 좁지 않다 — 좁으면 애써 맞춘 글 폭이 잘린다", () => {
    const at = bodyCode.indexOf("bodyColumnMaxWidth =");
    assert.ok(at >= 0, "기둥의 폭 상한을 찾지 못했다");
    assert.ok(
      bodyCode
        .slice(at, at + 160)
        .includes("serviceReportGridInputMaxWidthCss(bodyMetrics.bodyWrapWidth)"),
      bodyCode.slice(at, at + 160)
    );
    // 비고 칸은 본문보다 좁으므로 같은 기둥 안에 그대로 들어간다.
    for (const metrics of [METRICS, NEW_METRICS]) {
      assert.ok(
        serviceReportGridInputMaxWidthPx(metrics.remarkWrapWidth) <=
          serviceReportGridInputMaxWidthPx(metrics.bodyWrapWidth)
      );
    }
  });
});

/**
 * ============================================================================
 * 🔴 **폭이 글꼴 크기에서 나온다** — 둘이 따로 놀 길이 없다 (2026-10-18 넷째)
 * ============================================================================
 * 화면에 적히는 것은 전부 `calc(비율 × var(--sr-grid-font))` 다. 그 **비율**과,
 * 값을 돌려주는 px 함수가 같은 수에서 나오는지를 여기서 맞춘다. 한쪽만 고쳐지면
 * 창을 넓힐 때마다 적는 칸의 글자 수가 조용히 달라지고, 그 어긋남은 아무 오류도
 * 내지 않는다 — 문서와 다른 자리에서 줄이 바뀔 뿐이다.
 * ============================================================================
 */
describe("🔴 폭이 글꼴 크기에서 나온다", () => {
  /** `calc(42 * var(--sr-grid-font, 14px))` 에서 비율만 꺼낸다. */
  const multipleOf = (css: string): number => {
    const found = /^calc\(([\d.]+) \* var\(/.exec(css);
    assert.ok(found, `글꼴에 비례하는 식이 아니다: ${css}`);
    return Number(found[1]);
  };

  /** 어느 크기에서도 재어 볼 글꼴 값들 — 하한·밑값·상한과 그 사이. */
  const FONT_SIZES = [
    MIN_FONT_SIZE_PX,
    12,
    13,
    SERVICE_REPORT_GRID_INPUT_FONT_SIZE_PX,
    15.5,
    16,
    SERVICE_REPORT_GRID_MAX_FONT_SIZE_PX,
  ];

  test("🔴 적는 칸의 글 폭 = 한글 `칸 수 ÷ 2` 자 — **어느 글꼴 크기에서도**", () => {
    for (const columns of [METRICS.bodyWrapWidth, METRICS.remarkWrapWidth, 2]) {
      const multiple = multipleOf(serviceReportGridInputContentCss(columns));
      assert.equal(multiple, columns / 2, `${columns}칸의 비율이 틀렸다`);
      for (const fontSizePx of FONT_SIZES) {
        // 화면이 그리는 폭(비율 × 글꼴) = 셈이 말하는 폭. 오차 없이 같아야 한다.
        assert.ok(
          Math.abs(
            multiple * fontSizePx - serviceReportGridInputContentPx(columns, fontSizePx)
          ) < 1e-6,
          `${columns}칸 · ${fontSizePx}px 에서 폭과 글꼴이 따로 논다`
        );
        // 🔴 그 폭에 **한글이 정확히 칸 수 ÷ 2 자** 들어간다(맑은 고딕에서 1자 = 1em).
        assert.equal(
          serviceReportGridInputContentPx(columns, fontSizePx) / fontSizePx,
          columns / 2
        );
      }
    }
  });

  test("🔴 본문 84칸은 어느 크기에서도 **한글 42자**다", () => {
    for (const fontSizePx of FONT_SIZES) {
      assert.equal(
        serviceReportGridInputContentPx(METRICS.bodyWrapWidth, fontSizePx),
        42 * fontSizePx
      );
    }
    // 밑값(14px)에서는 지금까지의 588px 그대로다 — 기준이 안 움직였다.
    assert.equal(
      serviceReportGridInputContentPx(
        METRICS.bodyWrapWidth,
        SERVICE_REPORT_GRID_INPUT_FONT_SIZE_PX
      ),
      588
    );
  });

  test("🔴 여백과 테두리는 **안 커진다** — 커지면 글 폭이 42자를 넘는다", () => {
    for (const fontSizePx of FONT_SIZES) {
      assert.equal(
        serviceReportGridInputMaxWidthPx(METRICS.bodyWrapWidth, fontSizePx) -
          serviceReportGridInputContentPx(METRICS.bodyWrapWidth, fontSizePx),
        SERVICE_REPORT_GRID_INPUT_FRAME_PX
      );
    }
    // 화면에 적히는 식도 같은 모양이다 — 비례하는 부분 + 고정 26px.
    assert.equal(
      serviceReportGridInputMaxWidthCss(METRICS.bodyWrapWidth),
      `calc(${serviceReportGridInputContentCss(METRICS.bodyWrapWidth)} + ${SERVICE_REPORT_GRID_INPUT_FRAME_PX}px)`
    );
  });

  test("🔴 미리보기의 모든 치수가 **한 배율**을 탄다 — 상자 안이 계속 문서와 1:1", () => {
    const cases: [string, number][] = [
      [serviceReportGridDocumentBoxCss(METRICS.columns.label), serviceReportGridDocumentBoxPx(METRICS.columns.label)],
      [
        serviceReportGridDocumentBoxCss(METRICS.columns.body),
        serviceReportGridDocumentBoxPx(METRICS.columns.body),
      ],
      [
        serviceReportGridDocumentBoxCss(METRICS.columns.remark),
        serviceReportGridDocumentBoxPx(METRICS.columns.remark),
      ],
      [
        serviceReportGridPreviewScaledCss(SERVICE_REPORT_GRID_CELL_PADDING_LEFT_PX),
        SERVICE_REPORT_GRID_CELL_PADDING_LEFT_PX,
      ],
    ];
    for (const [css, documentPx] of cases) {
      const multiple = multipleOf(css);
      assert.ok(
        css.includes(`var(${SERVICE_REPORT_GRID_PREVIEW_FONT_VAR}`),
        `미리보기 치수가 미리보기 글꼴을 안 탄다: ${css}`
      );
      for (const previewFontSizePx of [9, SERVICE_REPORT_GRID_PREVIEW_FONT_SIZE_PX, 15.43, 24]) {
        assert.ok(
          Math.abs(
            multiple * previewFontSizePx -
              serviceReportGridPreviewScaledPx(documentPx, previewFontSizePx)
          ) < 1e-3,
          `${css} 가 ${previewFontSizePx}px 에서 어긋난다`
        );
      }
      // 배율 1배(= 문서 글꼴 9pt)면 **문서의 px 그대로**다.
      assert.ok(
        Math.abs(multiple * SERVICE_REPORT_GRID_PREVIEW_FONT_SIZE_PX - documentPx) < 1e-3,
        css
      );
    }
  });

  test("🔴 적는 칸의 줄 높이·최소 높이도 글꼴을 탄다 — 안 그러면 칸이 글자를 못 담는다", () => {
    const style = serviceReportGridInputStyle(METRICS.bodyWrapWidth, 8);
    assert.equal(style.fontSize, SERVICE_REPORT_GRID_FONT_CSS);
    assert.equal(
      style.lineHeight,
      serviceReportGridInputScaledCss(SERVICE_REPORT_GRID_INPUT_LINE_HEIGHT_PX)
    );
    assert.equal(
      style.minHeight,
      `calc(${serviceReportGridInputScaledCss(8 * SERVICE_REPORT_GRID_INPUT_LINE_HEIGHT_PX)} + 14px)`
    );
    // 밑값에서는 지금까지와 같은 높이다 — 20px 줄 여덟에 테두리 14px.
    assert.equal(
      serviceReportGridInputScaledPx(
        8 * SERVICE_REPORT_GRID_INPUT_LINE_HEIGHT_PX,
        SERVICE_REPORT_GRID_INPUT_FONT_SIZE_PX
      ) + 14,
      8 * 20 + 14
    );
  });

  test("🔴 변수가 없는 자리에서는 **밑값**으로 떨어진다 — 지금까지와 같은 모습", () => {
    assert.equal(
      SERVICE_REPORT_GRID_FONT_CSS,
      `var(${SERVICE_REPORT_GRID_FONT_VAR}, ${SERVICE_REPORT_GRID_INPUT_FONT_SIZE_PX}px)`
    );
    assert.equal(
      SERVICE_REPORT_GRID_PREVIEW_FONT_CSS,
      `var(${SERVICE_REPORT_GRID_PREVIEW_FONT_VAR}, ${SERVICE_REPORT_GRID_PREVIEW_FONT_SIZE_PX}px)`
    );
  });
});

/**
 * ============================================================================
 * 🔴 **가로가 남지 않는다** — 글꼴은 칸의 폭에서 역산한 값이다
 * ============================================================================
 * 사용자 말: 「여유공간이 너무 많네 … 가로폭을 다 채우도록」 · 「브라우저의 크기에
 * 따라 **적절하게 반응형으로**」.
 *
 * 그래서 글꼴을 정하는 CSS 식이 **폭을 세는 함수의 역산**이어야 한다. 둘을 따로
 * 적으면 한쪽만 고쳐지는 날이 오고, 그날부터 가로가 남거나 넘친다.
 * ============================================================================
 */
describe("🔴 글꼴이 칸의 폭에서 나온다 — 가로가 남지 않는다", () => {
  /** 그 글꼴 크기에서 미리보기가 비례로 따라올 때 줄이 먹는 폭. */
  const rowWidth = (fontSizePx: number): number => serviceReportGridRowWidthPx(METRICS, fontSizePx);

  test("줄의 폭 = 적는 칸 + 사이 + 미리보기 상자 — 지어낸 값이 없다", () => {
    for (const fontSizePx of [12, 14, 18]) {
      assert.equal(
        rowWidth(fontSizePx),
        serviceReportGridInputMaxWidthPx(METRICS.bodyWrapWidth, fontSizePx) +
          SERVICE_REPORT_GRID_ROW_GAP_PX +
          serviceReportGridPreviewBoxWidthPx(METRICS, 
            serviceReportGridPreviewFontSizePx(fontSizePx)
          )
      );
    }
    // 밑값에서는 지금까지의 모습 그대로다: 614 + 24 + (70 + 600 + 테두리 2).
    assert.equal(rowWidth(SERVICE_REPORT_GRID_INPUT_FONT_SIZE_PX), 614 + 24 + 672);
    assert.equal(SERVICE_REPORT_GRID_PREVIEW_BORDER_PX, 2);
  });

  test("🔴 글꼴을 정하는 식이 그 함수의 **역산**이다", () => {
    for (const widthPx of [1152, 1300, 1500, 1669.43]) {
      const fontSizePx = serviceReportGridFontSizeForRowWidth(METRICS, widthPx);
      assert.ok(Math.abs(rowWidth(fontSizePx) - widthPx) < 1e-6, `${widthPx}px 에서 어긋난다`);
    }
  });

  test("🔴 나란히 서는 **가장 좁은 폭**을 하한이 딱 채운다", () => {
    assert.equal(SERVICE_REPORT_GRID_SIDE_BY_SIDE_PX, 1152); // Tailwind 의 `@6xl` = 72rem
    assert.ok(
      Math.abs(rowWidth(MIN_FONT_SIZE_PX) - SERVICE_REPORT_GRID_SIDE_BY_SIDE_PX) <
        1e-6,
      `하한에서 ${rowWidth(MIN_FONT_SIZE_PX)}px — 1152px 를 안 채운다`
    );
    // 가름의 자리가 CSS 에도 **같은 눈금**으로 적혀 있다.
    assert.ok(SERVICE_REPORT_GRID_ROW_CLASS.includes("@6xl:flex-row"), SERVICE_REPORT_GRID_ROW_CLASS);
    assert.equal(SERVICE_REPORT_GRID_CONTAINER_CLASS, "@container");
    // 🔴 하한이 문서 글꼴(9pt = 12px)보다 작지 않다 — 적는 칸이 인쇄물보다 작아지면
    //    읽기 괴롭다. 그 아래로는 글자를 더 줄이는 대신 아래로 쌓는다.
    assert.ok(
      MIN_FONT_SIZE_PX >= SERVICE_REPORT_GRID_PREVIEW_FONT_SIZE_PX,
      `${MIN_FONT_SIZE_PX}px`
    );
    assert.ok(MIN_FONT_SIZE_PX < SERVICE_REPORT_GRID_INPUT_FONT_SIZE_PX);
  });

  test("🔴 적는 칸의 글꼴 식 — `cqi` 로 **칸**을 재고 상·하한 사이로 자른다", () => {
    const css = serviceReportGridRowFontCss(METRICS);
    assert.match(css, /^clamp\(/, css);
    // 창(100vw)이 아니라 칸(100cqi)이다 — 사이드바를 접고 편 것이 셈에 들어야 한다.
    assert.ok(css.includes("100cqi"), css);
    assert.ok(!css.includes("vw"), `창 폭으로 재고 있다: ${css}`);
    assert.ok(css.includes(`${SERVICE_REPORT_GRID_MAX_FONT_SIZE_PX}px)`), css);
    // 하한·고정분·기울기가 전부 위 함수들과 맞는다.
    const bounds = /^clamp\(([\d.]+)px, calc\(\(100cqi - ([\d.]+)px\) \/ ([\d.]+)\), (\d+)px\)$/.exec(
      css
    );
    assert.ok(bounds, css);
    assert.ok(Math.abs(Number(bounds[1]) - MIN_FONT_SIZE_PX) < 1e-3, css);
    assert.equal(Number(bounds[4]), SERVICE_REPORT_GRID_MAX_FONT_SIZE_PX);
    // 🔴 식에 폭을 넣으면 그 폭을 딱 채우는 글꼴이 나온다 — 그게 「남지 않는다」다.
    const fill = (widthPx: number) => (widthPx - Number(bounds[2])) / Number(bounds[3]);
    for (const widthPx of [1152, 1400, 1669.43]) {
      assert.ok(Math.abs(rowWidth(fill(widthPx)) - widthPx) < 1e-3, `${widthPx}px 에서 남는다`);
    }
  });

  test("🔴 상한에 닿은 뒤에는 **미리보기가 혼자 커져** 남은 자리를 메운다", () => {
    const css = serviceReportGridPreviewFontCss(METRICS);
    assert.match(css, /^clamp\(/, css);
    assert.ok(css.includes("100cqi"), css);
    assert.ok(css.includes(`${SERVICE_REPORT_GRID_MAX_PREVIEW_FONT_SIZE_PX}px)`), css);
    assert.equal(SERVICE_REPORT_GRID_MAX_PREVIEW_FONT_SIZE_PX, 24); // 문서의 두 배

    /** 식을 그대로 흉내 내 본다 — 가운데 값. */
    const fixedPx =
      SERVICE_REPORT_GRID_INPUT_FRAME_PX +
      SERVICE_REPORT_GRID_ROW_GAP_PX +
      SERVICE_REPORT_GRID_PREVIEW_BORDER_PX;
    const slopePx =
      (serviceReportGridPreviewBoxWidthPx(METRICS, SERVICE_REPORT_GRID_PREVIEW_FONT_SIZE_PX) -
        SERVICE_REPORT_GRID_PREVIEW_BORDER_PX) /
      SERVICE_REPORT_GRID_PREVIEW_FONT_SIZE_PX;
    const previewFill = (containerPx: number, fontSizePx: number) =>
      (containerPx -
        fixedPx -
        serviceReportGridInputContentPx(METRICS.bodyWrapWidth, fontSizePx)) /
      slopePx;

    // ① 적는 칸이 상한에 **닿기 전**에는 가운데 값이 하한(= 비례값)과 같다.
    for (const containerPx of [1152, 1400, 1600]) {
      const fontSizePx = serviceReportGridFontSizeForRowWidth(METRICS, containerPx);
      assert.ok(
        Math.abs(
          previewFill(containerPx, fontSizePx) - serviceReportGridPreviewFontSizePx(fontSizePx)
        ) < 1e-6,
        `${containerPx}px 에서 미리보기가 비례를 벗어난다`
      );
    }
    // ② 닿은 뒤에는 더 커져서 **남은 폭을 정확히** 메운다.
    for (const containerPx of [1800, 2000, 2146]) {
      const previewFontSizePx = previewFill(containerPx, SERVICE_REPORT_GRID_MAX_FONT_SIZE_PX);
      assert.ok(
        previewFontSizePx >
          serviceReportGridPreviewFontSizePx(SERVICE_REPORT_GRID_MAX_FONT_SIZE_PX),
        `${containerPx}px 에서 미리보기가 안 커진다`
      );
      assert.ok(
        Math.abs(
          serviceReportGridInputMaxWidthPx(
            METRICS.bodyWrapWidth,
            SERVICE_REPORT_GRID_MAX_FONT_SIZE_PX
          ) +
            SERVICE_REPORT_GRID_ROW_GAP_PX +
            serviceReportGridPreviewBoxWidthPx(METRICS, previewFontSizePx) -
            containerPx
        ) < 1e-3,
        `${containerPx}px 에서 가로가 남는다`
      );
      assert.ok(previewFontSizePx <= SERVICE_REPORT_GRID_MAX_PREVIEW_FONT_SIZE_PX);
    }
  });

  test("🔴 아래로 쌓였을 때는 **지금까지와 같은 크기**다 — 창을 좁혔는데 커지면 이상하다", () => {
    assert.equal(
      serviceReportGridStackedFontCss(),
      `${SERVICE_REPORT_GRID_INPUT_FONT_SIZE_PX}px`
    );
    assert.ok(!serviceReportGridStackedFontCss().includes("cqi"), "쌓인 자리까지 폭을 따라간다");
  });

  test("🔴 후보 둘을 심어 두고 **클래스가 고른다** — 인라인 style 은 못 덮기 때문이다", () => {
    const style = serviceReportGridScaleStyle(METRICS) as Record<string, string>;
    assert.equal(style["--sr-grid-font-stacked"], serviceReportGridStackedFontCss());
    assert.equal(style["--sr-grid-font-row"], serviceReportGridRowFontCss(METRICS));
    assert.equal(style[SERVICE_REPORT_GRID_PREVIEW_FONT_VAR], serviceReportGridPreviewFontCss(METRICS));
    // 고르는 쪽. 🔴 변수 이름이 상수와 **글자 그대로** 같아야 한다(Tailwind 는 이
    // 문자열을 글자로 훑는다 — 이름이 어긋나면 글꼴이 통째로 밑값으로 떨어진다).
    assert.ok(
      SERVICE_REPORT_GRID_ROW_CLASS.includes(
        `[${SERVICE_REPORT_GRID_FONT_VAR}:var(--sr-grid-font-stacked)]`
      ),
      SERVICE_REPORT_GRID_ROW_CLASS
    );
    assert.ok(
      SERVICE_REPORT_GRID_ROW_CLASS.includes(
        `@6xl:[${SERVICE_REPORT_GRID_FONT_VAR}:var(--sr-grid-font-row)]`
      ),
      SERVICE_REPORT_GRID_ROW_CLASS
    );
    for (const name of ["--sr-grid-font-stacked", "--sr-grid-font-row"]) {
      assert.ok(name in style, `${name} 후보값이 안 심겼다`);
    }
  });
});

/**
 * 🔴 사용자가 **글꼴을 지정했다** — 엑셀 본문 글꼴인 맑은 고딕이다. 미리보기가
 * 문서와 같은 글꼴이 되는 것이 덤으로 따라온다(「진짜 결과물처럼」).
 */
describe("🔴 글꼴은 맑은 고딕 — 문서가 쓰는 그 글꼴", () => {
  test("맨 앞이 맑은 고딕이고 마지막 대비책이 있다", () => {
    const families = SERVICE_REPORT_GRID_FONT_FAMILY.split(",").map((name) =>
      name.trim().replace(/^"|"$/g, "")
    );
    assert.equal(families[0], "Malgun Gothic", SERVICE_REPORT_GRID_FONT_FAMILY);
    assert.ok(families.includes("맑은 고딕"), SERVICE_REPORT_GRID_FONT_FAMILY);
    assert.equal(families[families.length - 1], "sans-serif", "마지막 대비책이 없다");
    // 🔴 앞 조각의 고정폭 글꼴은 하나도 남지 않았다 — 섞여 있으면 PC 마다 다른
    //    글꼴로 떨어져, 「문서와 같은 글꼴」이라는 말 자체가 거짓이 된다.
    for (const stale of ["D2Coding", "NanumGothicCoding", "DotumChe", "돋움체", "GulimChe", "굴림체", "MS Gothic", "monospace"]) {
      assert.ok(!families.includes(stale), `옛 고정폭 글꼴이 남아 있다: ${stale}`);
    }
    assert.ok(!/Geist|ui-monospace/.test(SERVICE_REPORT_GRID_FONT_FAMILY));
  });

  test("적는 칸과 미리보기가 **같은 글꼴**이다 — 눈으로 바로 견준다", () => {
    const style = serviceReportGridInputStyle(METRICS.bodyWrapWidth, 8);
    assert.equal(style.fontFamily, SERVICE_REPORT_GRID_FONT_FAMILY);
    assert.equal(serviceReportGridPreviewTextStyle.fontFamily, SERVICE_REPORT_GRID_FONT_FAMILY);
    assert.equal(
      serviceReportGridRemarkPreviewTextStyle.fontFamily,
      SERVICE_REPORT_GRID_FONT_FAMILY
    );
    assert.ok(previewCode.includes("serviceReportGridPreviewTextStyle"), previewCode.slice(0, 300));
  });

  test("🔴 「글꼴 크기는 짝수」 규칙이 없어졌다 — 비트맵 글꼴 때문이던 것이다", () => {
    // 맑은 고딕은 벡터 글꼴이고 애초에 2:1 을 기대하지 않는다. 홀수를 줘도 던지지
    // 않아야 한다 — 남겨 두면 까닭 없는 예외로 사람을 막는다.
    assert.equal(serviceReportGridInputContentPx(84, 13), 546);
    assert.doesNotThrow(() => serviceReportGridInputStyle(METRICS.bodyWrapWidth, 8));
  });

  test("🔴 미리보기의 치수가 **문서 실측값**이다 — 9pt · 14.1pt · 15pt", () => {
    assert.equal(SERVICE_REPORT_GRID_PREVIEW_FONT_SIZE_PX, 12); // 9pt ÷ 0.75
    assert.equal(SERVICE_REPORT_GRID_PREVIEW_LINE_HEIGHT_PX, 18.8); // 본문 행 14.1pt
    assert.equal(SERVICE_REPORT_GRID_REMARK_LINE_HEIGHT_PX, 20); // 비고 행 15pt
    assert.equal(serviceReportGridPreviewTextStyle.fontSize, SERVICE_REPORT_GRID_PREVIEW_FONT_CSS);
    /*
      🔴 줄 높이는 **배수**다(px 가 아니다). 확대했을 때 글자만 커지고 행 높이는
      그대로면 글이 겹치거나 상자가 문서와 안 닮는다. 배수 × 문서 글꼴 = 실측값이다.
    */
    for (const [lineHeight, documentPx] of [
      [serviceReportGridPreviewTextStyle.lineHeight, SERVICE_REPORT_GRID_PREVIEW_LINE_HEIGHT_PX],
      [serviceReportGridRemarkPreviewTextStyle.lineHeight, SERVICE_REPORT_GRID_REMARK_LINE_HEIGHT_PX],
    ] as const) {
      assert.equal(typeof lineHeight, "number", `줄 높이가 배수가 아니다: ${lineHeight}`);
      assert.ok(
        Math.abs(Number(lineHeight) * SERVICE_REPORT_GRID_PREVIEW_FONT_SIZE_PX - documentPx) < 0.001,
        `${lineHeight} × 12px ≠ ${documentPx}px`
      );
    }
    // 엑셀이 칸 왼쪽에 두는 안쪽 여백.
    assert.equal(SERVICE_REPORT_GRID_CELL_PADDING_LEFT_PX, 2);
  });
});

describe("🔴 상한이지 고정 폭이 아니다", () => {
  test("폭은 `maxWidth` 로만 준다 — `width` 로 박지 않았다", () => {
    const style = serviceReportGridInputStyle(METRICS.bodyWrapWidth, 8);
    assert.equal(style.maxWidth, serviceReportGridInputMaxWidthCss(METRICS.bodyWrapWidth));
    assert.equal(style.width, undefined, "입력칸에 고정 폭이 들어 있다");
    // 밑값에서는 지금까지의 614px 그대로다.
    assert.equal(serviceReportGridInputMaxWidthPx(METRICS.bodyWrapWidth), 614);
  });

  test("칸은 여전히 화면을 따라 줄어든다 — `w-full` 이 그대로다", () => {
    assert.ok(shared.includes('"w-full rounded-md border border-zinc-200'), shared.slice(0, 400));
    assert.ok(
      fieldCode.includes(
        "className={`${editInputClass} resize-y ${grid ? SERVICE_REPORT_GRID_INPUT_CLASS : \"\"}`}"
      ),
      "입력칸이 공용 모양 위에 눈금만 얹는 모양이 아니다"
    );
  });

  test("🔴 스크롤막대가 글 폭을 먹지 않는다 — 여덟 줄을 넘겨도 자리가 그대로다", () => {
    assert.equal(SERVICE_REPORT_GRID_INPUT_CLASS, "[field-sizing:content]");
    assert.ok(fieldCode.includes("SERVICE_REPORT_GRID_INPUT_CLASS"), fieldCode.slice(0, 300));
    // 늘어나는 대신 **처음 높이**는 `rows` 그대로여야 한다 — 밑값에서 8줄 + 테두리.
    const style = serviceReportGridInputStyle(METRICS.bodyWrapWidth, 8);
    assert.equal(
      style.minHeight,
      `calc(${serviceReportGridInputScaledCss(8 * SERVICE_REPORT_GRID_INPUT_LINE_HEIGHT_PX)} + 14px)`
    );
    assert.equal(
      serviceReportGridInputScaledPx(
        8 * SERVICE_REPORT_GRID_INPUT_LINE_HEIGHT_PX,
        SERVICE_REPORT_GRID_INPUT_FONT_SIZE_PX
      ) + 14,
      8 * 20 + 14
    );
  });
});

/**
 * ============================================================================
 * 🔴 화면의 안내문이 **지금 사실과 맞는가**
 * ============================================================================
 * 글꼴이 가변폭이 된 순간, 적는 칸의 줄 자리는 «대략»이 되었다. 그 사실을 화면이
 * 말하지 않으면 사람은 적는 칸에서 본 자리를 문서의 자리로 믿는다 — 바로 그
 * 오해가 이 세 조각을 만든 사용자 지적이었다.
 *
 * 그래서 **옛 설명이 남아 있지 않은지**까지 본다. 더하는 것은 쉽고 지우는 것은
 * 잊히기 때문이다.
 * ============================================================================
 */
describe("🔴 안내문이 지금 사실과 맞는다", () => {
  test("적는 칸의 줄 자리가 **대략**이라고 적혀 있다", () => {
    assert.ok(
      bodyCode.includes("적는 칸이 줄을 바꾸는 자리는 대략입니다"),
      "적는 칸의 줄 자리가 대략이라는 말이 없다"
    );
    assert.ok(
      bodyCode.includes("영숫자가 섞이면 문서보다 일찍 바뀝니다"),
      "어느 줄이 어긋나는지가 안 적혀 있다"
    );
  });

  test("🔴 정확한 자리는 **오른쪽 미리보기**를 보라고 적혀 있다", () => {
    assert.ok(bodyCode.includes("오른쪽 미리보기를 보세요"), "미리보기로 가라는 말이 없다");
  });

  test("🔴 옛 설명이 남아 있지 않다", () => {
    assert.ok(
      !bodyCode.includes("칸의 가로폭을 넘는 긴 줄은 문서에서 다시 나뉘므로"),
      "줄 자리가 맞는다는 전제로 쓰인 옛 안내문이 남아 있다"
    );
  });

  test("줄 수가 어림값이라는 말은 그대로다 — 그 성질은 안 바뀌었다", () => {
    assert.ok(bodyCode.includes("줄 수도 그만큼 늘 수 있습니다"), bodyCode.slice(0, 200));
  });
});

/**
 * 🔴 숫자의 근거 — 지어낸 값이 아니다.
 *
 *   · 칸 수(옛 84·51, 새 85·52)는 **양식의 열 너비**에서 나온다(`contentWrapWidth`).
 *     그 셈과 실제 양식의 대조는 `lib/xlsx/service-report-template.test.ts` 가 본다.
 *   · 여백 26px 은 공용 입력칸이 두르는 `px-3`(12px씩) + `border`(1px씩)다.
 */
describe("🔴 폭의 셈이 양식과 입력칸에서 나온다", () => {
  test("양식에서 온 칸 수 그대로다 — 옛 양식과 새 양식", () => {
    assert.equal(METRICS.bodyWrapWidth, 84);
    assert.equal(METRICS.remarkWrapWidth, 51);
    assert.equal(NEW_METRICS.bodyWrapWidth, 85);
    assert.equal(NEW_METRICS.remarkWrapWidth, 52);
  });

  test("🔴 상한 = 글 폭 + 입력칸의 안쪽 여백 + 테두리", () => {
    // 공용 입력칸이 두르는 값을 **원본에서 읽는다** — 바뀌면 이 셈도 바뀌어야 한다.
    const padding = /\spx-(\d+(?:\.\d+)?)\s/.exec(shared);
    assert.ok(padding, "editInputClass 에서 좌우 여백(px-…)을 찾지 못했다");
    const paddingPx = Number(padding[1]) * 4; // Tailwind 한 칸 = 0.25rem = 4px
    assert.equal(paddingPx, 12);

    assert.ok(/\sborder\s/.test(shared), "editInputClass 에서 테두리를 찾지 못했다");
    const borderPx = 1;
    assert.equal(SERVICE_REPORT_GRID_INPUT_FRAME_PX, paddingPx * 2 + borderPx * 2);

    assert.equal(serviceReportGridInputMaxWidthPx(METRICS.bodyWrapWidth), 588 + 26);
    assert.equal(serviceReportGridInputMaxWidthPx(METRICS.remarkWrapWidth), 357 + 26);
    // 🔴 새 양식이면 **한 칸(한글 반 자)만큼 넓어진다** — 85 ÷ 2 × 14 = 595.
    assert.equal(serviceReportGridInputMaxWidthPx(NEW_METRICS.bodyWrapWidth), 595 + 26);
  });
});

/**
 * ============================================================================
 * 🔴 **굳힌 폭이 화면 쪽에 남아 있지 않다** (2026-10-18 다섯째 조각)
 * ============================================================================
 * 이 조각이 없앤 것은 숫자만이 아니라 **「화면이 폭을 안다」는 구조**다. 다시
 * 생기면 양식을 저장만 해도 미리보기가 거짓말을 하므로, 이름과 숫자 양쪽으로
 * 막는다.
 * ============================================================================
 */
describe("🔴 굳힌 폭이 없다", () => {
  const gridSource = read("./service-report-grid.ts");
  const gridCode = code(gridSource);

  test("없어진 상수 이름이 화면 세 파일 어디에도 없다", () => {
    for (const [name, source] of [
      ["본문 폼", bodyCode],
      ["미리보기", previewCode],
      ["치수 모듈", gridCode],
    ] as const) {
      for (const stale of [
        "SERVICE_REPORT_BODY_COLUMN_WIDTH",
        "SERVICE_REPORT_REMARK_COLUMN_WIDTH",
        "SERVICE_REPORT_BODY_LABEL_COLUMN_WIDTH",
        "SERVICE_REPORT_BODY_WRAP_WIDTH",
        "SERVICE_REPORT_REMARK_WRAP_WIDTH",
      ]) {
        assert.ok(!source.includes(stale), `${name}에 ${stale} 가 남아 있다`);
      }
    }
  });

  test("🔴 치수 모듈의 코드에 양식 폭 숫자가 없다", () => {
    for (const literal of ["75", "46.875", "8.75", "1.875", "1.90625", "84", "51"]) {
      assert.ok(
        !new RegExp(`=\\s*${literal.replace(".", "\\.")}\\b`).test(gridCode),
        `치수 모듈에 양식 폭 ${literal} 이 굳어 있다`
      );
    }
  });

  test("🔴 하한·기울기가 **상수가 아니라 함수**다 — 폭이 바뀌면 따라가야 한다", () => {
    // 새 양식은 칸이 넓어서 같은 1152px 에 더 작은 글꼴로 들어간다.
    assert.ok(
      serviceReportGridMinFontSizePx(NEW_METRICS) < serviceReportGridMinFontSizePx(METRICS),
      "양식이 넓어졌는데 하한이 그대로다"
    );
    // 그리고 그 하한이 **각 양식에서** 1152px 를 딱 채운다.
    for (const metrics of [METRICS, NEW_METRICS]) {
      assert.ok(
        Math.abs(
          serviceReportGridRowWidthPx(metrics, serviceReportGridMinFontSizePx(metrics)) -
            SERVICE_REPORT_GRID_SIDE_BY_SIDE_PX
        ) < 1e-6
      );
    }
    // CSS 식도 양식마다 다른 수를 낸다 — 한 벌로 굳어 있지 않다.
    assert.notEqual(serviceReportGridRowFontCss(METRICS), serviceReportGridRowFontCss(NEW_METRICS));
    assert.notEqual(
      serviceReportGridPreviewFontCss(METRICS),
      serviceReportGridPreviewFontCss(NEW_METRICS)
    );
  });
});

describe("🔴 공용 입력칸은 그대로다", () => {
  test("`editInputClass` 에 폭 상한도 글꼴도 들어가지 않았다", () => {
    const line = /export const editInputClass =\n?\s*"([^"]+)";/.exec(shared);
    assert.ok(line, "editInputClass 를 찾지 못했다");
    assert.ok(!line[1].includes("max-w-"), `공용 입력칸에 폭 상한이 박혔다: ${line[1]}`);
    assert.ok(!line[1].includes("font-"), `공용 입력칸에 글꼴이 박혔다: ${line[1]}`);
    assert.ok(line[1].startsWith("w-full "), line[1]);
  });

  test("눈금을 안 주는 칸은 지금까지와 같다 — 글꼴도 폭도 안 붙는다", () => {
    assert.ok(
      fieldCode.includes("style={grid ? serviceReportGridInputStyle(gridColumns, rows) : undefined}"),
      fieldCode.slice(0, 300)
    );
  });
});
