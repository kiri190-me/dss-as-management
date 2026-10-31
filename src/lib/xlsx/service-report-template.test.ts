import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { ZipArchive } from "./zip-reader";
import { writeZip } from "./zip-writer";
import { createCellTextReader } from "./sheet-text";
import { parseSheetRows, readRowHeightAttribute } from "./sheet-rows";
import {
  resolveSheetPart,
  SHARED_STRINGS_PART,
  STYLES_PART,
  WORKBOOK_PART,
} from "./workbook-parts";
import {
  serviceReportBodyMetrics,
  serviceReportBodyPreviewSections,
} from "@/lib/domain/service-report-body-wrap";
/** 🔴 「한 벌인가」를 보려고 **원본 모듈째** 가져온다(아래 한 벌 시험). */
import * as wrap from "@/lib/domain/service-report-body-wrap";
import { textDisplayWidth } from "@/lib/domain/text-wrap";
import { koreanKyosanDocumentText, translateKyosanTerm } from "@/lib/kyosan/report-terms";
import {
  clearDrawingTextInRows,
  contentWrapWidth,
  fillServiceReportWorkbook,
  findBodyBlock,
  findLabelledBlock,
  normalizeBodyRowHeights,
  readColumnRangeWidth,
  readSectionStartRows,
  readServiceReportColumnWidths,
  serviceReportColumnWidthsFromSheet,
  SERVICE_REPORT_ACTIONS_INTRO,
  SERVICE_REPORT_BODY_LABELS,
  SERVICE_REPORT_CELLS,
  SERVICE_REPORT_CHECK_MARK,
  SERVICE_REPORT_CAUSE_LABELS,
  SERVICE_REPORT_CAUSES,
  SERVICE_REPORT_CLOSING_GAP_ROWS,
  SERVICE_REPORT_CLOSING_MARK,
  SERVICE_REPORT_CLOSING_MARK_COLUMN_SHIFT,
  SERVICE_REPORT_CLOSING_TRAILING_ROWS,
  SERVICE_REPORT_FINDINGS_INTRO,
  SERVICE_REPORT_FINDINGS_ROW_OFFSET,
  SERVICE_REPORT_MAX_BODY_ROWS,
  SERVICE_REPORT_OCCURRED_ON_PLACEHOLDER,
  SERVICE_REPORT_SECTION_GAP_ROWS,
  SERVICE_REPORT_SHEET_NAME,
  SERVICE_REPORT_SUMMARY_INTRO,
  SERVICE_REPORT_TITLES,
  serviceReportClosingMarkColumn,
  shiftFindingsSectionDown,
  usesIsoDates,
  validateServiceReportInput,
  type ServiceReportInput,
} from "./service-report-template";

/**
 * ============================================================================
 * 검사 보고서 · 수리 보고서 채우개
 * ============================================================================
 * 앞의 묶음은 **양식 없이도 도는 시험**이다 — 자리를 양식에서 읽어 내는 규칙과
 * 입력 검사가 여기 있다.
 *
 * 뒤의 묶음은 실제 양식 파일이 있어야 돈다
 * (`INSPECTION_REPORT_TEMPLATE_PATH`·`REPAIR_REPORT_TEMPLATE_PATH`).
 * 없으면 건너뛴다 — 양식은 저장소에 두지 않는다(직인이 들어 있다).
 *
 * 🔴 **시험 자료는 전부 지어낸 것이다.** 양식 파일 자체가 실제로 발행된
 * 보고서의 사본이라 진짜 고객사 이름이 들어 있는데, 그것을 시험 기대값으로
 * 쓰면 시험이 통과하는 것과 "우리가 그 값을 지웠는가"가 뒤섞인다.
 * ============================================================================
 */

// ── 양식 없이 — 자리를 읽는 규칙 ────────────────────────────────────────

/** 실제 양식의 뼈대만 본뜬 것. 본문 도우미와 병합 칸이 자리를 알려 준다. */
const SYNTHETIC_SHEET =
  '<?xml version="1.0"?><worksheet>' +
  '<cols><col min="1" max="7" width="1.75"/><col min="8" max="47" width="1.875"/></cols>' +
  "<sheetData>" +
  '<row r="31"><c r="C31" s="1"/><c r="H31" s="2"/>' +
  '<c r="BC31" s="3"><f t="shared" ref="BC31:BC33" si="0">LEN(H31)</f><v>0</v></c></row>' +
  '<row r="32"><c r="BC32" s="3"><f t="shared" si="0"/><v>0</v></c></row>' +
  "</sheetData>" +
  '<mergeCells count="4"><mergeCell ref="C31:G31"/><mergeCell ref="H31:AU31"/>' +
  '<mergeCell ref="C60:G63"/><mergeCell ref="H60:AF60"/></mergeCells></worksheet>';

test("본문 자리는 양식의 글자수 도우미(LEN 공유 수식)가 알려 준다", () => {
  assert.deepEqual(findBodyBlock(SYNTHETIC_SHEET), {
    firstRow: 31,
    lastRow: 33,
    labelColumn: "C",
    contentColumn: "H",
    contentEndColumn: "AU",
    helperColumn: "BC",
  });
});

/**
 * 🔴 **본문 한 줄의 폭을 여기 굳혀 두던 상수가 없어졌다**(2026-10-18 다섯째 조각).
 *
 * `contentWrapWidth(75)` 로 한 번 재어 두고 실제 양식 시험들이 그 값을 썼는데,
 * 양식이 여럿이 되고 열 너비가 갈리면서(옛 1.875 · 새 1.90625) 그 수가 「어느
 * 양식의 폭인가」를 말할 수 없게 됐다. 이제 **그 양식에서 읽는다**
 * (`templateMetrics`).
 */

test("🔴 한 줄의 폭은 양식의 <cols> 에서 읽는다 — 코드에 박지 않는다", () => {
  // H~AU 40열 × 1.875 = 75칸.
  assert.equal(readColumnRangeWidth(SYNTHETIC_SHEET, "H", "AU"), 75);
  assert.equal(readColumnRangeWidth(SYNTHETIC_SHEET, "A", "G"), 7 * 1.75);

  // 양식의 열 너비가 바뀌면 값도 따라간다.
  const wider = SYNTHETIC_SHEET.replace('max="47" width="1.875"', 'max="47" width="3.75"');
  assert.equal(readColumnRangeWidth(wider, "H", "AU"), 150);

  // <cols> 에 없는 열은 기본 너비로 센다.
  const noCols = SYNTHETIC_SHEET.replace(/<cols>[\s\S]*?<\/cols>/, "");
  assert.equal(readColumnRangeWidth(noCols, "H", "I"), 8.43 * 2);
});

/**
 * ============================================================================
 * 🔴 **화면에 넘길 칸 폭 셋** — 주소를 박지 않고 양식에서 찾아낸다 (2026-10-18)
 * ============================================================================
 * 미리보기가 쓰는 폭이 더는 화면에 굳어 있지 않다. 서버가 그 건의 양식에서 읽어
 * props 로 넘기고, 읽는 셈이 **채우개가 줄을 나눌 때 쓰는 그것과 같은 함수**다.
 * 여기서는 양식 없이 뼈대 시트로 「어디를 재는가」를 못 박는다.
 * ============================================================================
 */
test("🔴 본문·비고·라벨 폭을 양식 안에서 찾아 읽는다", () => {
  assert.deepEqual(serviceReportColumnWidthsFromSheet(SYNTHETIC_SHEET), {
    body: 40 * 1.875, // H~AU — 채우개가 줄을 나눌 때 재는 바로 그 범위
    remark: 25 * 1.875, // H~AF — 「비　고」 병합과 첫 줄 병합이 알려 준다
    label: 5 * 1.75, // C~G — 내용 열 **바로 왼쪽**까지
    // 🔴 폭만이 아니라 **열 수**도 넘긴다(2026-10-31) — 미리보기가 맺음 표시
    //    여백을 셈하려면 한 열이 얼마인지 알아야 하는데, 브라우저에는 양식이 없다.
    bodyColumns: 40,
  });

  // 🔴 사람이(또는 Excel 이) 열 너비를 다시 쓰면 **세 값이 다 따라간다.**
  //    2026-10-18 에 실제로 일어난 일이 이것이다(1.875 → 1.90625).
  //    ⚠️ 열 **수**는 그대로다 — 너비가 바뀐 것이지 칸이 늘어난 것이 아니다.
  const resaved = SYNTHETIC_SHEET.replace('max="47" width="1.875"', 'max="47" width="1.90625"');
  assert.deepEqual(serviceReportColumnWidthsFromSheet(resaved), {
    body: 40 * 1.90625,
    remark: 25 * 1.90625,
    label: 5 * 1.75,
    bodyColumns: 40,
  });

  // 그리고 그 폭이 곧 화면이 쓸 줄 폭이 된다 — 84칸이 85칸으로.
  assert.equal(serviceReportBodyMetrics(serviceReportColumnWidthsFromSheet(SYNTHETIC_SHEET)).bodyWrapWidth, 84);
  assert.equal(serviceReportBodyMetrics(serviceReportColumnWidthsFromSheet(resaved)).bodyWrapWidth, 85);
});

test("🔴 줄 폭은 기본 글꼴이 아니라 **칸에 박힌 글꼴** 기준으로 환산한다", () => {
  /**
   * 2026-10-15 실측값을 못 박는다. 누가 상수를 건드리면 여기가 먼저 깨진다.
   *   본문 H:AU  75칸      × 8px = 600px → ⌊(600−5−7)÷7⌋ = 84칸(한글 42자)
   *   비고 H:AF  46.875칸  × 8px = 375px → ⌊(375−5−7)÷7⌋ = 51칸(한글 25자)
   */
  assert.equal(contentWrapWidth(75), 84);
  assert.equal(contentWrapWidth(46.875), 51);

  // 🔴 기본 글꼴 기준 값보다 **넓어야** 한다 — 그래야 칸이 찬다.
  assert.ok(contentWrapWidth(75) > 75, "환산이 오히려 좁아졌다");

  /**
   * 🔴 그래도 엑셀이 실제로 담는 양보다는 **좁아야** 한다. 한글 음절은 맑은
   * 고딕 9pt 에서 12px 이므로 (600−5)÷12 = 49자가 진짜 용량이다.
   */
  assert.ok(Math.floor(contentWrapWidth(75) / 2) < Math.floor((75 * 8 - 5) / 12));

  // 양식의 열 너비가 바뀌면 줄 폭도 따라간다. ⌊(150×8−12)÷7⌋ = 169.
  assert.equal(contentWrapWidth(150), 169);

  // 칸이 말이 안 되게 좁으면 파일을 만들기 전에 던진다.
  assert.throws(() => contentWrapWidth(1), /본문 칸이 너무 좁습니다/);
});

test("본문 도우미가 없거나 여럿이면 짐작하지 않고 던진다", () => {
  assert.throws(
    () => findBodyBlock('<worksheet><sheetData></sheetData></worksheet>'),
    /LEN 공유 수식.*0개/
  );

  const twice = SYNTHETIC_SHEET.replace(
    "</sheetData>",
    '<row r="70"><c r="BZ70"><f t="shared" ref="BZ70:BZ71" si="9">LEN(K70)</f><v>0</v></c></row></sheetData>'
  );
  assert.throws(() => findBodyBlock(twice), /LEN 공유 수식.*2개/);
});

test("비고 자리는 라벨 칸의 병합 범위가 알려 준다", () => {
  assert.deepEqual(findLabelledBlock(SYNTHETIC_SHEET, "C60"), {
    firstRow: 60,
    lastRow: 63,
    contentColumn: "H",
  });
  assert.throws(() => findLabelledBlock(SYNTHETIC_SHEET, "C99"), /병합 칸을 찾지 못했습니다/);
});

/** 글상자 하나(31~59행) + 그림 하나(61~63행). 실제 양식의 모양을 줄인 것. */
const SYNTHETIC_DRAWING =
  '<xdr:wsDr xmlns:xdr="x" xmlns:a="y">' +
  "<xdr:twoCellAnchor><xdr:from><xdr:col>7</xdr:col><xdr:row>30</xdr:row></xdr:from>" +
  "<xdr:to><xdr:col>46</xdr:col><xdr:row>58</xdr:row></xdr:to>" +
  '<xdr:sp><xdr:nvSpPr><xdr:cNvPr id="2" name="Text Box 7"/></xdr:nvSpPr>' +
  '<xdr:txBody><a:bodyPr wrap="square"/><a:lstStyle/>' +
  "<a:p><a:r><a:t>인수품에 대하여</a:t></a:r></a:p>" +
  "<a:p><a:r><a:t>～이　상～</a:t></a:r></a:p></xdr:txBody></xdr:sp></xdr:twoCellAnchor>" +
  "<xdr:twoCellAnchor><xdr:from><xdr:col>32</xdr:col><xdr:row>60</xdr:row></xdr:from>" +
  "<xdr:to><xdr:col>36</xdr:col><xdr:row>62</xdr:row></xdr:to>" +
  '<xdr:pic><xdr:nvPicPr><xdr:cNvPr id="5" name="그림 4"/></xdr:nvPicPr></xdr:pic>' +
  "</xdr:twoCellAnchor></xdr:wsDr>";

test("🔴 본문 위에 뜬 글상자는 글자만 비우고 도형은 남긴다", () => {
  const cleared = clearDrawingTextInRows(SYNTHETIC_DRAWING, 31, 59);

  assert.ok(!cleared.includes("인수품에 대하여"), "견본 문장이 남았다");
  assert.ok(!cleared.includes("～이　상～"), "맺음 표시가 글상자에 남았다");
  assert.ok(!cleared.includes("<a:r>"), "문단이 남았다");

  // 도형·그림·글자 모양은 그대로.
  assert.ok(cleared.includes('name="Text Box 7"'), "도형이 사라졌다");
  assert.ok(cleared.includes('name="그림 4"'), "그림이 사라졌다");
  assert.ok(cleared.includes('<a:bodyPr wrap="square"/>'), "글자 모양이 사라졌다");
  assert.ok(cleared.includes("<a:p/>"), "빈 문단이 없다");
  assert.equal(
    (cleared.match(/<xdr:twoCellAnchor>/g) ?? []).length,
    2,
    "앵커 개수가 달라졌다"
  );
});

test("본문과 안 겹치는 도형의 글자는 건드리지 않는다", () => {
  // 본문이 70~80행이라면 31~59행의 글상자는 우리 것이 아니다.
  const untouched = clearDrawingTextInRows(SYNTHETIC_DRAWING, 70, 80);
  assert.equal(untouched, SYNTHETIC_DRAWING);
});

// ── 양식 없이 — 구역이 시작하는 자리와 행 높이 ──────────────────────────

/**
 * 본문 31~59행짜리 시트. 행 높이를 바꿔 가며 계산이 그것을 **읽는지** 본다.
 */
function bodyHeightSheet(overrides: Record<number, string> = {}): string {
  const rows: string[] = [];
  for (let row = 31; row <= 59; row += 1) {
    const height = overrides[row] ?? "14.1";
    rows.push(`<row r="${row}" s="1" customFormat="1" ht="${height}" customHeight="1">` +
      `<c r="H${row}" s="2"/></row>`);
  }
  return (
    '<worksheet><sheetFormatPr defaultRowHeight="12"/>' +
    `<sheetData>${rows.join("")}</sheetData></worksheet>`
  );
}

/**
 * 라벨 글상자 하나. 실제 양식과 같은 모양이다 — 1번째 `확　내`, 2번째 `인　용`,
 * 14번째 `조  치`, 27번째 `정  리`, 나머지는 빈 문단.
 */
function labelDrawing(
  options: { spacing?: string; tIns?: string; rowOff?: string; dropSpacing?: boolean } = {}
): string {
  const spacing = options.spacing ?? "1100";
  const paragraph = (text: string): string => {
    const lnSpc = options.dropSpacing ? "" : `<a:lnSpc><a:spcPts val="${spacing}"/></a:lnSpc>`;
    const body = text === "" ? "<a:endParaRPr/>" : `<a:r><a:t>${text}</a:t></a:r>`;
    return `<a:p><a:pPr algn="ctr">${lnSpc}</a:pPr>${body}</a:p>`;
  };

  const texts = new Map([[1, "확　내"], [2, "인　용"], [14, "조  치"], [27, "정  리"]]);
  const paragraphs = Array.from({ length: 27 }, (_value, index) =>
    paragraph(texts.get(index + 1) ?? "")
  );

  return (
    '<xdr:wsDr xmlns:xdr="x" xmlns:a="y"><xdr:twoCellAnchor>' +
    "<xdr:from><xdr:col>2</xdr:col><xdr:colOff>0</xdr:colOff>" +
    `<xdr:row>30</xdr:row><xdr:rowOff>${options.rowOff ?? "76201"}</xdr:rowOff></xdr:from>` +
    "<xdr:to><xdr:col>7</xdr:col><xdr:colOff>0</xdr:colOff>" +
    "<xdr:row>58</xdr:row><xdr:rowOff>133351</xdr:rowOff></xdr:to>" +
    '<xdr:sp><xdr:nvSpPr><xdr:cNvPr id="3" name="Text Box 9"/></xdr:nvSpPr>' +
    `<xdr:txBody><a:bodyPr tIns="${options.tIns ?? "18288"}"/><a:lstStyle/>` +
    `${paragraphs.join("")}</xdr:txBody></xdr:sp></xdr:twoCellAnchor></xdr:wsDr>`
  );
}

const THREE_SECTIONS = [
  { labelLines: SERVICE_REPORT_BODY_LABELS.findings, lines: ["가"] },
  { labelLines: SERVICE_REPORT_BODY_LABELS.actions, lines: ["나"] },
  { labelLines: SERVICE_REPORT_BODY_LABELS.summary, lines: ["다"] },
];
const BODY_BLOCK = { firstRow: 31, lastRow: 59 };

/**
 * 🔴 이 시험이 "구역 시작 행을 코드에 박지 않았다"는 증거다.
 *
 * 같은 입력에 **글상자만 바꾸면** 구역의 시작 행이 따라 움직인다 — 줄간격·
 * 안쪽여백·앵커·행 높이 넷 모두가 계산에 실제로 쓰인다는 뜻이다. 어느 하나라도
 * 코드에 박혀 있다면 그 항목을 바꾼 아래 단언이 깨진다.
 */
test("🔴 구역 시작 행은 글상자에서 나온다 — 코드에 박은 값이 아니다", () => {
  // 실제 양식과 같은 모양: 줄간격 11pt · tIns 18288 · 앵커 31행 76201.
  assert.deepEqual(
    readSectionStartRows(labelDrawing(), bodyHeightSheet(), BODY_BLOCK, THREE_SECTIONS),
    [31, 41, 51]
  );

  // 1) 줄간격을 행 높이와 같은 14.1pt 로 바꾸면 문단 번호가 곧 행 번호가 된다.
  assert.deepEqual(
    readSectionStartRows(labelDrawing({ spacing: "1410" }), bodyHeightSheet(), BODY_BLOCK, THREE_SECTIONS),
    [31, 44, 57]
  );

  // 2) 위쪽 안쪽여백(tIns)이 늘면 통째로 한 줄 내려간다.
  assert.deepEqual(
    readSectionStartRows(labelDrawing({ tIns: "200000" }), bodyHeightSheet(), BODY_BLOCK, THREE_SECTIONS),
    [32, 42, 52]
  );

  // 3) 앵커가 첫 행 안에서 더 내려가 붙으면(rowOff) 아래 구역이 한 줄씩 밀린다.
  assert.deepEqual(
    readSectionStartRows(labelDrawing({ rowOff: "150000" }), bodyHeightSheet(), BODY_BLOCK, THREE_SECTIONS),
    [31, 42, 52]
  );

  // 4) 🔴 행 높이도 읽는다 — 46행이 75.6pt 로 남아 있으면 「정리」가 47행이 된다.
  //    (그래서 구역을 셈하기 **전에** 행 높이를 고르게 편다.)
  assert.deepEqual(
    readSectionStartRows(
      labelDrawing(),
      bodyHeightSheet({ 46: "75.599999999999994" }),
      BODY_BLOCK,
      THREE_SECTIONS
    ),
    [31, 41, 47]
  );
});

/**
 * ============================================================================
 * 🔴 「확인내용」만 글상자보다 한 줄 아래다
 * ============================================================================
 * 계산은 31을 준다(바로 위 시험이 그것을 못 박는다). 실제 발행본은 32에서
 * 시작한다 — 2026-09-02 사용자 결정. 그래서 **계산을 왜곡하지 않고** 그 위에
 * 규칙 한 줄을 얹었다. 「조치」·「정리」는 손대지 않는다.
 * ============================================================================
 */
test("🔴 「확인내용」만 한 줄 내려온다 — 조치·정리는 글상자 그대로", () => {
  const startRows = readSectionStartRows(
    labelDrawing(),
    bodyHeightSheet(),
    BODY_BLOCK,
    THREE_SECTIONS
  );
  // 계산은 손대지 않았다.
  assert.deepEqual(startRows, [31, 41, 51]);

  assert.deepEqual(shiftFindingsSectionDown(THREE_SECTIONS, startRows), [32, 41, 51]);
  assert.equal(SERVICE_REPORT_FINDINGS_ROW_OFFSET, 1);

  // 구역은 **라벨 글자로** 가린다 — 자리(index)로 가리지 않는다.
  assert.deepEqual(
    shiftFindingsSectionDown(
      [
        { labelLines: SERVICE_REPORT_BODY_LABELS.actions },
        { labelLines: SERVICE_REPORT_BODY_LABELS.findings },
      ],
      [41, 51]
    ),
    [41, 52]
  );
  // 「확인내용」이 없는 문서에서는 아무것도 안 밀린다.
  assert.deepEqual(
    shiftFindingsSectionDown(
      [
        { labelLines: SERVICE_REPORT_BODY_LABELS.actions },
        { labelLines: SERVICE_REPORT_BODY_LABELS.summary },
      ],
      [41, 51]
    ),
    [41, 51]
  );
});

/**
 * 🔴 원인 열 가지의 한글 이름은 **`CAUSE_CELLS` 에서 뽑아낸다.** 두 곳에 적어
 * 두면 양식의 라벨이 바뀐 날 화면과 문서가 서로 다른 이름을 부른다.
 */
test("🔴 원인 라벨 표는 문서에 찍히는 그 글자에서 나온다", () => {
  assert.deepEqual(Object.keys(SERVICE_REPORT_CAUSE_LABELS), [...SERVICE_REPORT_CAUSES]);
  assert.deepEqual(SERVICE_REPORT_CAUSE_LABELS, {
    MANUFACTURING_DEFECT: "제작불량",
    PART_DEFECT: "부품불량",
    // 양식의 글자는 `노후화 `(뒤에 공백)지만 우리가 견주는 것은 앞부분이다.
    AGING: "노후화",
    TRANSPORT_DAMAGE: "운송불량",
    STORAGE_DAMAGE: "보관불량",
    SPEC_SHORTFALL: "사양미비",
    INSPECTION_MISS: "검사 미스",
    MISHANDLING: "취급불비",
    NOT_REPRODUCED: "재현 안됨",
    OTHER: "기타",
  });
});

test("양식이 바뀌어 자리를 못 읽으면 짐작하지 않고 던진다", () => {
  // 그림 파트가 없다.
  assert.throws(
    () => readSectionStartRows(null, bodyHeightSheet(), BODY_BLOCK, THREE_SECTIONS),
    /그림 파트가 없어/
  );
  // 라벨 글상자가 없다.
  assert.throws(
    () => readSectionStartRows("<xdr:wsDr/>", bodyHeightSheet(), BODY_BLOCK, THREE_SECTIONS),
    /본문 라벨 글상자를 0개/
  );
  // 라벨 글상자가 둘이다.
  assert.throws(
    () =>
      readSectionStartRows(
        labelDrawing() + labelDrawing(),
        bodyHeightSheet(),
        BODY_BLOCK,
        THREE_SECTIONS
      ),
    /본문 라벨 글상자를 2개/
  );
  // 줄간격이 없다 — 짐작하면 엉뚱한 자리에 그린 문서가 나간다.
  assert.throws(
    () =>
      readSectionStartRows(
        labelDrawing({ dropSpacing: true }),
        bodyHeightSheet(),
        BODY_BLOCK,
        THREE_SECTIONS
      ),
    /줄간격\(<a:lnSpc><a:spcPts>\)/
  );
  // 라벨 글자가 없는 구역.
  assert.throws(
    () =>
      readSectionStartRows(labelDrawing(), bodyHeightSheet(), BODY_BLOCK, [
        { labelLines: ["없는라벨"], lines: ["가"] },
      ]),
    /「없는라벨」 이\(가\) 없습니다/
  );
});

/**
 * 🔴 본문 행 높이를 **최빈값**으로 통일한다 — 값을 코드에 박지 않는다.
 *
 * 수리 양식의 46행만 75.6pt 인데, 그것은 그 발행본을 만든 사람이 손으로 잡아
 * 늘린 자국이다(검사 양식의 같은 행은 13.9pt). 그대로 두면 문서 한가운데 구멍이
 * 뚫리고 아래 구역 계산이 뒤틀린다.
 */
test("🔴 본문 행 높이는 그 블록의 최빈값으로 고르게 편다", () => {
  const evened = normalizeBodyRowHeights(
    bodyHeightSheet({ 46: "75.599999999999994" }),
    BODY_BLOCK
  );
  assert.ok(!evened.includes("75.5"), "75.6pt 행이 남았다");
  assert.equal((evened.match(/ ht="14\.1"/g) ?? []).length, 29, "본문 29줄이 다 고르지 않다");
  assert.equal((evened.match(/customHeight="1"/g) ?? []).length, 29);

  // 🔴 값을 박지 않았다 — 양식이 다른 높이를 쓰면 그쪽으로 통일된다.
  const other = normalizeBodyRowHeights(
    bodyHeightSheet(Object.fromEntries(
      Array.from({ length: 29 }, (_value, index) => [31 + index, index === 5 ? "9.9" : "20.4"])
    )),
    BODY_BLOCK
  );
  assert.equal((other.match(/ ht="20\.4"/g) ?? []).length, 29);
  assert.ok(!other.includes('ht="9.9"'), "최빈값이 아닌 높이가 남았다");

  // 본문 밖은 손대지 않는다.
  const outside = normalizeBodyRowHeights(bodyHeightSheet({ 59: "30" }), { firstRow: 31, lastRow: 58 });
  assert.ok(outside.includes('ht="30"'), "본문 밖 행의 높이가 바뀌었다");
});

test("날짜를 ISO 로 담는 통합문서인지 workbook.xml 이 정한다", () => {
  assert.equal(usesIsoDates('<workbook><workbookPr dateCompatibility="0" codeName="x"/></workbook>'), true);
  assert.equal(usesIsoDates("<workbook><workbookPr codeName=\"x\"/></workbook>"), false);
  assert.equal(usesIsoDates('<workbook><workbookPr dateCompatibility="1"/></workbook>'), false);
});

// ── 양식 없이 — 입력 검사 ───────────────────────────────────────────────

const INSPECTION_INPUT: ServiceReportInput = {
  kind: "INSPECTION",
  customerName: "테스트 반도체(주)",
  issuedOn: new Date(2026, 8, 1),
  reportNumber: { prefix: "T900", middle: "Q11A1", tail: "7788" },
  customer: "테스트 고객 담당",
  receivedOn: new Date(2026, 7, 20),
  occurrencePlace: "귀사 End User",
  occurrencePlaceDetail: "제2공장",
  occurredOn: new Date(2026, 7, 18),
  productName: "13.56MHz 30kW",
  productCategory: "RF제네레이터",
  modelName: "TEST300FH-AD1",
  manufacturedYear: 2022,
  manufacturedMonth: 5,
  lotNumber: "LN12345",
  serialNumber: "SN12345",
  usedYears: 4,
  usedMonths: 3,
  situation: { request: " ・수리의뢰", detail: "출력이 나오지 않는다는 연락을 받았다." },
  causes: ["PART_DEFECT", "AGING"],
  repairNumber: "R260901",
  remark: ["보증 기간 밖입니다.", "부품은 재고분을 썼습니다."],
  disposition: {
    onSiteRepair: true,
    goodsReceipt: { on: new Date(2026, 7, 21), number: "T260821" },
  },
  /**
   * 🔴 `findingsIntro: ""` — **일부러 껐다.** 기본값을 켜 두면 확인내용이 한 줄씩
   * 밀려서, 아래 시험들이 "줄 자리"를 보는 것인지 "정형 문구"를 보는 것인지
   * 뒤섞인다. 기본값·다른 문장·비움 세 갈래는 아래 전용 시험이 따로 본다.
   */
  body: {
    findings: ["외관 손상 없음", "전원부 퓨즈 단선 확인"],
    findingsIntro: "",
    actions: ["퓨즈 교체", "정격 출력 시험 통과"],
  },
};

const REPAIR_INPUT: ServiceReportInput = {
  ...INSPECTION_INPUT,
  kind: "REPAIR",
  disposition: {
    onSiteRepair: true,
    goodsReceipt: { on: new Date(2026, 7, 21), number: "T260821" },
    completion: { on: new Date(2026, 8, 1) },
  },
  body: {
    findings: ["외관 손상 없음", "전원부 퓨즈 단선 확인"],
    findingsIntro: "",
    actions: ["퓨즈 교체", "정격 출력 시험 통과"],
    summary: ["같은 증상 재발 시 전원부 전체 점검을 권합니다."],
  },
};

test("입력 검사: 빈 고객사명·잘못된 날짜·없는 원인은 던진다", () => {
  assert.throws(
    () => validateServiceReportInput({ ...INSPECTION_INPUT, customerName: "  " }),
    /고객사명이 비어 있습니다/
  );
  assert.throws(
    () => validateServiceReportInput({ ...INSPECTION_INPUT, issuedOn: new Date("bad") }),
    /발행일이\(가\) 유효한 날짜가 아닙니다/
  );
  // 🔴 보고서 번호는 여기 없다 — 비어도 된다(바로 아래 시험이 그것을 못 박는다).
  assert.throws(
    () =>
      validateServiceReportInput({
        ...INSPECTION_INPUT,
        causes: ["없는항목"] as unknown as ServiceReportInput["causes"],
      }),
    /알 수 없는 원인 항목/
  );
  assert.throws(
    () => validateServiceReportInput({ ...INSPECTION_INPUT, usedYears: 1.5 }),
    /사용 년수은\(는\) 0 이상의 정수/
  );
  assert.throws(
    () =>
      validateServiceReportInput({
        ...INSPECTION_INPUT,
        body: { findings: [], actions: [] },
      }),
    /본문이 한 줄도 없습니다/
  );
});

/**
 * ============================================================================
 * 🔴 보고서 번호는 **없어도 문서가 된다**(2026-09-21 사용자 결정)
 * ============================================================================
 * 예전에는 이 검사가 번호(중간·뒤) 두 칸을 필수로 봐서 빈 칸이면 던졌다. 그런데
 * **교산 연락서에서 자동으로 만든 A/S 보고서는 그 칸을 일부러 비워 둔다** —
 * 교산 쪽 번호를 우리 발행번호 자리에 넣으면 *우리가 발행한 척*이 되기
 * 때문이다(`kyosan/report-save-values.ts`). 그래서 그 보고서들이 미리보기·인쇄·
 * 엑셀에서 통째로 막혀 있었다.
 *
 * 사용자 판단은 **번호 없이도 보게 한다**이다. 번호를 지어내지 않는다 —
 * 아직 우리가 발행한 문서가 아니니 **빈 칸이 사실에 맞다**. 그 칸이 정말 빈 채로
 * 찍히는지는 아래 「빈 채로 찍힌다」 시험이 실제 양식을 채워서 본다. 여기서는
 * **던지지 않는다**까지만 본다.
 * ============================================================================
 */
test("🔴 입력 검사: 보고서 번호가 비어 있어도 던지지 않는다", () => {
  const cases: ServiceReportInput["reportNumber"][] = [
    // 중간만 빈 것 · 뒤만 빈 것 · 둘 다 빈 것.
    { prefix: "T900", middle: "", tail: "7788" },
    { prefix: "T900", middle: "Q11A1", tail: "" },
    { prefix: "T900", middle: "", tail: "" },
    // 앞 칸까지 통째로 없는 것 — 교산에서 들어온 보고서의 실제 모습이다.
    { middle: "", tail: "" },
    // 공백만 적힌 것도 빈 것으로 본다(채우개가 `.trim()` 한 뒤 칸을 비운다).
    { middle: "   ", tail: " " },
  ];
  for (const reportNumber of cases) {
    assert.doesNotThrow(
      () => validateServiceReportInput({ ...INSPECTION_INPUT, reportNumber }),
      `보고서 번호 ${JSON.stringify(reportNumber)} 를 막았다`
    );
  }

  // 🔴 무르게 한 것은 **번호 하나뿐**이다 — 나머지 필수 검사는 그대로 산다.
  assert.throws(
    () =>
      validateServiceReportInput({
        ...INSPECTION_INPUT,
        reportNumber: { middle: "", tail: "" },
        customerName: "  ",
      }),
    /고객사명이 비어 있습니다/
  );
});

test("입력 검사: 「조치 완료」와 「정리」는 검사 보고서에서 거부한다", () => {
  assert.throws(
    () =>
      validateServiceReportInput({
        ...INSPECTION_INPUT,
        disposition: { completion: { on: new Date(2026, 8, 1) } },
      } as unknown as ServiceReportInput),
    /검사 보고서에는 「조치 완료」/
  );
  assert.throws(
    () =>
      validateServiceReportInput({
        ...INSPECTION_INPUT,
        body: { findings: ["가"], actions: [], summary: ["나"] },
      } as unknown as ServiceReportInput),
    /검사 보고서에는 「정리」/
  );
});

// ── 실제 양식 ───────────────────────────────────────────────────────────

const inspectionPath = process.env.INSPECTION_REPORT_TEMPLATE_PATH;
const repairPath = process.env.REPAIR_REPORT_TEMPLATE_PATH;
const skipInspection = inspectionPath
  ? false
  : "INSPECTION_REPORT_TEMPLATE_PATH 가 설정되지 않았습니다";
const skipRepair = repairPath ? false : "REPAIR_REPORT_TEMPLATE_PATH 가 설정되지 않았습니다";

/** 양식이 이렇게 생겼다 — 시험의 기대값은 전부 이 숫자에서 나온다. */
const TEMPLATE_BODY_FIRST_ROW = 31;
const TEMPLATE_BODY_LAST_ROW = 59;
const TEMPLATE_BODY_CAPACITY = TEMPLATE_BODY_LAST_ROW - TEMPLATE_BODY_FIRST_ROW + 1;
const TEMPLATE_DRAWING_PART = "xl/drawings/drawing2.xml";

/**
 * ============================================================================
 * 🔴 세 구역이 시작하는 행 — **양식의 라벨 글상자가 정한 값**이다
 * ============================================================================
 * 코드에 박아 둔 것이 아니라 `Text Box 9` 의 문단 자리에서 계산된다(아래
 * 「구역 시작 행은 글상자에서 나온다」 시험이 그것을 증명한다). 여기 적는 것은
 * **그 계산이 실제 양식에서 내놓는 값**이고, 아래 시험들은 이 행 번호를 그대로
 * 단언한다 — "어딘가에 있다" 로 물러서면 자리가 밀려도 시험이 안 잡는다.
 *
 * ⚠️ 검사와 수리가 다르다. 두 양식은 같은 통합문서지만 검사 양식의 라벨
 * 글상자는 앞 14문단이 13pt(라벨 글꼴 12pt)이고 수리는 11pt(10pt)라, 같은
 * 14번째 문단인 「조  치」가 검사에서는 두 행 아래에서 시작한다.
 *
 * 🔴 **「확인내용」만 예외다.** 두 양식의 글상자는 둘 다 31행을 가리키지만
 * (실측), 실제 발행본은 32행에서 시작한다 — 2026-09-02 사용자 결정. 그래서
 * 계산값(31)에 `SERVICE_REPORT_FINDINGS_ROW_OFFSET` 한 줄이 얹힌다. 여기서도
 * **더해서** 적는다 — 32 를 박아 두면 그 한 줄이 어디서 왔는지 사라진다.
 * ============================================================================
 */
/** 글상자가 「확인내용」에 주는 행. 실제로 쓰이는 자리는 여기에 한 줄 더한 값이다. */
const DRAWING_FINDINGS_ROW = 31;
const INSPECTION_FINDINGS_ROW = DRAWING_FINDINGS_ROW + SERVICE_REPORT_FINDINGS_ROW_OFFSET;
const INSPECTION_ACTIONS_ROW = 43;
const REPAIR_FINDINGS_ROW = DRAWING_FINDINGS_ROW + SERVICE_REPORT_FINDINGS_ROW_OFFSET;
const REPAIR_ACTIONS_ROW = 41;
const REPAIR_SUMMARY_ROW = 51;

type Filled = {
  text: (ref: string) => string | undefined;
  sheetXml: string;
  workbookXml: string;
  drawingXml: string;
  merges: string[];
  printArea: string | undefined;
  archive: ZipArchive;
};

function fill(templatePath: string, input: ServiceReportInput): Filled {
  const archive = ZipArchive.fromBuffer(
    fillServiceReportWorkbook(readFileSync(templatePath), input)
  );
  const sheetXml = archive.readText(resolveSheetPart(archive, SERVICE_REPORT_SHEET_NAME));
  const read = createCellTextReader(sheetXml, archive.readTextOrNull(SHARED_STRINGS_PART));
  const workbookXml = archive.readText(WORKBOOK_PART);

  return {
    text: (ref) => read(ref) ?? undefined,
    sheetXml,
    workbookXml,
    drawingXml: archive.readText(TEMPLATE_DRAWING_PART),
    merges: [...sheetXml.matchAll(/<mergeCell ref="([^"]+)"/g)].map((match) => match[1]),
    printArea: [
      ...workbookXml.matchAll(/<definedName[^>]*Print_Area[^>]*>([^<]*)<\/definedName>/g),
    ]
      .map((match) => match[1])
      .find((reference) => reference.includes(SERVICE_REPORT_SHEET_NAME)),
    archive,
  };
}

/** 양식에서 「비　고」 라벨이 앉아 있던 행. 블록이 늘거나 줄면 함께 움직인다. */
const TEMPLATE_REMARK_LABEL_ROW = 60;

/**
 * 채워진 문서에서 그 글자가 있는 행을 찾는다. 없으면 0.
 *
 * 훑는 끝은 **본문이 커질 수 있는 끝**이다(`SERVICE_REPORT_MAX_BODY_ROWS`) —
 * 수를 적어 두면 긴 보고서에서 조용히 0을 돌려주고, 그러면 「못 찾았다」가 아니라
 * 「비고가 없다」로 읽힌다.
 */
function rowOfText(filled: Filled, column: string, match: (text: string) => boolean): number {
  const end = TEMPLATE_BODY_FIRST_ROW + SERVICE_REPORT_MAX_BODY_ROWS + 8;
  for (let row = TEMPLATE_BODY_FIRST_ROW; row <= end; row += 1) {
    const text = filled.text(`${column}${row}`);
    if (text !== undefined && match(text)) return row;
  }
  return 0;
}

/**
 * 🔴 맺음 표시가 앉는 **열** — 본문 내용 열(`H`)이 아니라 거기서 여섯 칸 오른쪽
 * (`N`)이다. 가운데 맞춤이라 병합의 왼쪽 끝을 여섯 칸 당겨야 **보이는 자리**가
 * 세 칸 오른쪽으로 간다(2026-10-31 사용자 결정 · 채우개의
 * `serviceReportClosingMarkColumn` 머리말).
 *
 * 🔵 글자를 박지 않고 채우개와 **같은 함수**로 셈한 뒤, 이 양식에서 그 값이
 * 실제로 `N` 인지 아래 시험이 못 박는다 — 양쪽이 갈라지면 바로 드러난다.
 */
const TEMPLATE_CLOSING_COLUMN = serviceReportClosingMarkColumn({
  contentColumn: "H",
  contentEndColumn: "AU",
});

const closingMarkRow = (filled: Filled): number =>
  rowOfText(filled, TEMPLATE_CLOSING_COLUMN, (text) => text === SERVICE_REPORT_CLOSING_MARK);
const remarkLabelRow = (filled: Filled): number =>
  rowOfText(filled, "C", (text) => text.startsWith("비　고"));

/**
 * 🔴 맺음 표시가 **그 줄의 `N` 칸**에 있고, **옛 자리(`H`)는 비어 있고**, 그 줄의
 * 병합이 `N:AU` 로 갈아 끼워졌는가.
 *
 * 🔴 **옛 자리를 함께 재는 것이 요점이다.** 병합의 왼쪽 위 칸이 아닌 칸에 든
 * 글자는 Excel 이 **화면에도 인쇄에도 안 그린다** — 글자가 두 군데 남으면 눈에는
 * 멀쩡해 보이고 파일에만 남는다. 「있다」만 재면 그 상태가 영영 통과한다.
 */
function assertClosingMarkAt(filled: Filled, row: number): void {
  assert.equal(
    filled.text(`${TEMPLATE_CLOSING_COLUMN}${row}`),
    SERVICE_REPORT_CLOSING_MARK,
    `${TEMPLATE_CLOSING_COLUMN}${row} 에 맺음 표시가 없다`
  );
  assert.equal(filled.text(`H${row}`), undefined, `옛 자리 H${row} 에 글자가 남았다`);
  assert.ok(
    filled.merges.includes(`${TEMPLATE_CLOSING_COLUMN}${row}:AU${row}`),
    `${row}행의 병합이 ${TEMPLATE_CLOSING_COLUMN}:AU 가 아니다 — 글자가 병합 밖에 떨어진다`
  );
  assert.ok(!filled.merges.includes(`H${row}:AU${row}`), `${row}행에 옛 병합이 남았다`);
}

/**
 * 블록이 몇 줄 늘었나 — **문서에서 잰다**(음수면 줄어든 것이다).
 *
 * 🔴 2026-10-31 전에는 늘어나는 일이 드물어 시험이 숫자를 직접 건넸다. 지금은
 * 블록이 **본문에 맞춰 늘거나 줄어서**(`fillSheet` 의 `rowShift`) 거의 모든
 * 문서가 0 이 아니다. 그래서 기본은 재는 쪽으로 두고, **그 수 자체가 요점인
 * 시험만** 기대값을 건넨다.
 */
function bodyRowShiftOf(filled: Filled): number {
  const remark = remarkLabelRow(filled);
  assert.ok(remark > 0, "채워진 문서에서 비고 라벨을 찾지 못했다");
  return remark - TEMPLATE_REMARK_LABEL_ROW;
}

/**
 * 종류가 무엇이든 문서가 깨지지 않았는지는 늘 같은 방식으로 본다.
 *
 * @param expectedRowShift 블록이 늘어난 줄 수(음수면 줄어든 것). 안 주면 문서에서
 *        재고, 주면 **그 수와 같은지까지** 본다.
 */
function assertSheetIsSound(filled: Filled, expectedRowShift?: number): void {
  const rowShift = bodyRowShiftOf(filled);
  if (expectedRowShift !== undefined) {
    assert.equal(rowShift, expectedRowShift, "블록이 늘거나 준 줄 수가 다르다");
  }

  /**
   * 🔴 **맺음 표시 아래는 언제나 세 줄이고, 블록은 거기서 끝난다**
   * (2026-10-31 사용자 결정). 비고 라벨이 곧 블록 다음 줄이므로, 그 둘의 사이가
   * 이 규칙이다 — 본문이 길든 짧든, 양식이 넷 중 무엇이든 같아야 한다.
   */
  const closing = closingMarkRow(filled);
  assert.ok(closing > 0, "채워진 문서에서 맺음 표시를 찾지 못했다");
  // 🔴 가로 자리(N 칸 · 옛 자리 비움 · 병합)도 **모든 문서에서** 본다.
  assertClosingMarkAt(filled, closing);
  assert.equal(
    remarkLabelRow(filled) - closing,
    SERVICE_REPORT_CLOSING_TRAILING_ROWS + 1,
    `맺음 표시(${closing}행) 아래 빈 줄이 ${SERVICE_REPORT_CLOSING_TRAILING_ROWS}줄이 아니다`
  );
  for (let index = 1; index <= SERVICE_REPORT_CLOSING_TRAILING_ROWS; index += 1) {
    assert.equal(
      filled.text(`H${closing + index}`),
      undefined,
      `맺음 표시 아래 ${index}번째 줄에 글자가 찍혔다`
    );
    assert.equal(filled.text(`${TEMPLATE_CLOSING_COLUMN}${closing + index}`), undefined);
    assert.equal(filled.text(`C${closing + index}`), undefined);
  }

  const duplicates: string[] = [];
  const seen = new Set<string>();
  for (const cell of filled.sheetXml.matchAll(/<c r="([A-Z]+\d+)"/g)) {
    if (seen.has(cell[1])) duplicates.push(cell[1]);
    seen.add(cell[1]);
  }
  assert.deepEqual(duplicates, [], "같은 주소의 셀이 여러 개다");

  const rowNumbers: number[] = [];
  for (const row of filled.sheetXml.matchAll(/<row\s[^>]*?r="(\d+)"[^>]*?(?:\/>|>[\s\S]*?<\/row>)/g)) {
    rowNumbers.push(Number(row[1]));
    for (const cell of row[0].matchAll(/<c r="([A-Z]+)(\d+)"/g)) {
      assert.equal(cell[2], row[1], `${row[1]}행에 ${cell[1]}${cell[2]} 이 있다`);
    }
  }
  // 행 번호는 오르막이고 겹치지 않는다.
  for (let index = 1; index < rowNumbers.length; index += 1) {
    assert.ok(
      rowNumbers[index] > rowNumbers[index - 1],
      `행 번호가 ${rowNumbers[index - 1]} 다음에 ${rowNumbers[index]} 이다`
    );
  }

  // 병합도 겹치지 않는다 — 같은 범위가 둘이면 Excel 이 거부한다.
  assert.equal(new Set(filled.merges).size, filled.merges.length, "같은 병합이 두 번 있다");
  assert.equal(
    Number(/<mergeCells count="(\d+)"/.exec(filled.sheetXml)?.[1]),
    filled.merges.length,
    "mergeCells 의 count 가 실제 개수와 다르다"
  );

  // 낡은 계산 캐시가 화면에 먼저 보이면 안 된다.
  assert.ok(!filled.archive.has("xl/calcChain.xml"), "calcChain 이 남았다");
  assert.ok(/fullCalcOnLoad="1"/.test(filled.workbookXml), "fullCalcOnLoad 가 꺼져 있다");

  /**
   * 🔴 어긋난 공유 수식은 Excel 이 파일 열기를 거부하는 사유다.
   *
   *  · 줄 수가 그대로면 양식의 공유 수식이 **그대로** 있어야 한다.
   *  · 늘렸거나 **줄였으면** 공유 수식이 **하나도 남으면 안 되고**, 모든 본문
   *    줄에 제 줄을 가리키는 보통 수식이 있어야 한다. 🔴 줄이는 쪽도 같다 —
   *    `ref="BC31:BC59"` 가 가리키던 범위에서 뒤쪽이 사라지면 그 역시 어긋난
   *    공유 수식이다(`shrinkBodyBlock`).
   */
  const bodyLastRow = TEMPLATE_BODY_LAST_ROW + rowShift;
  if (rowShift === 0) {
    assert.ok(
      filled.sheetXml.includes(`ref="BC${TEMPLATE_BODY_FIRST_ROW}:BC${TEMPLATE_BODY_LAST_ROW}"`),
      "본문 글자수 도우미의 공유 수식이 사라지거나 바뀌었다"
    );
  } else {
    assert.ok(
      !/<f[^>]*t="shared"[^>]*si="0"/.test(filled.sheetXml),
      "줄 수를 바꿨는데 어긋난 공유 수식이 남았다"
    );
    for (let row = TEMPLATE_BODY_FIRST_ROW; row <= bodyLastRow; row += 1) {
      assert.ok(
        new RegExp(`<c r="BC${row}"[^>]*><f>LEN\\(H${row}\\)</f></c>`).test(filled.sheetXml),
        `BC${row} 의 글자수 도우미가 제 줄을 세지 않는다`
      );
    }
    // 🔴 줄인 쪽 — 사라진 줄의 도우미가 **남아 있으면 안 된다.**
    for (let row = bodyLastRow + 1; row <= TEMPLATE_BODY_LAST_ROW; row += 1) {
      assert.ok(
        !new RegExp(`<c r="BC${row}"[^>]*><f>LEN\\(H${row}\\)</f></c>`).test(filled.sheetXml),
        `BC${row} 는 걷어낸 줄인데 글자수 도우미가 남았다`
      );
    }
  }
}

// ── 서식(styles.xml) 을 견주는 도구 ─────────────────────────────────────

/**
 * `<cellXfs>` 안의 `<xf>` 목록.
 *
 * 🔴 `[^>]*` 를 탐욕적으로 쓰면 자체닫힘(`<xf …/>`)의 `/` 를 삼켜 **다음 xf 까지
 * 한 덩이**가 된다. 그러면 번호가 밀려서, 실제로는 멀쩡한 서식을 두고 "정렬이
 * 틀렸다"는 시험 결과가 나온다(실측: 497개가 471개로 읽혔다).
 */
function cellXfs(stylesXml: string): string[] {
  const block = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(stylesXml);
  assert.ok(block, "styles.xml 에 cellXfs 가 없다");
  return [...block[1].matchAll(/<xf\b[^>]*?(?:\/>|>[\s\S]*?<\/xf>)/g)].map((match) => match[0]);
}

function declaredCellXfCount(stylesXml: string): number {
  return Number(/<cellXfs\b[^>]*\scount="(\d+)"/.exec(stylesXml)?.[1]);
}

/** 그 서식의 가로 맞춤. 안 적혀 있으면 undefined. */
function horizontalOf(stylesXml: string, index: number): string | undefined {
  const xf = cellXfs(stylesXml)[index];
  assert.ok(xf !== undefined, `styles.xml 에 ${index}번 서식이 없다`);
  return /<alignment\b[^>]*\shorizontal="([^"]*)"/.exec(xf)?.[1];
}

/** 그 서식이 쓰는 테두리 번호. 아래 테두리가 살았는지 볼 때 쓴다. */
function borderIdOf(stylesXml: string, index: number): string | undefined {
  const xf = cellXfs(stylesXml)[index];
  assert.ok(xf !== undefined, `styles.xml 에 ${index}번 서식이 없다`);
  return /\sborderId="(\d+)"/.exec(xf)?.[1];
}

/** 그 셀이 가리키는 서식 번호. */
function styleIndexOf(sheetXml: string, ref: string): number {
  const open = new RegExp(`<c r="${ref}"[^>]*>`).exec(sheetXml)?.[0];
  assert.ok(open !== undefined, `시트에 ${ref} 셀이 없다`);
  const style = /\ss="(\d+)"/.exec(open)?.[1];
  assert.ok(style !== undefined, `${ref} 에 서식 번호가 없다`);
  return Number(style);
}

function templateSheetXml(templatePath: string): string {
  const archive = ZipArchive.fromBuffer(readFileSync(templatePath));
  return archive.readText(resolveSheetPart(archive, SERVICE_REPORT_SHEET_NAME));
}

/**
 * 🔴 `styles.xml` 은 **더해지기만** 해야 한다.
 *
 * 기존 `xf` 를 하나라도 고치면 그것을 쓰는 다른 칸이 전부 따라 바뀐다 — 이
 * 양식에서는 본문 라벨과 맺음 표시가 본문 내용 칸과 같은 번호를 쓰므로 바로
 * 그 일이 일어난다. 그리고 `count` 가 실제 개수와 어긋나면 Excel 이 파일을
 * 거부한다.
 */
function assertStylesOnlyGrew(original: ZipArchive, filled: Filled): void {
  const before = original.readText(STYLES_PART);
  const after = filled.archive.readText(STYLES_PART);

  const beforeXfs = cellXfs(before);
  const afterXfs = cellXfs(after);
  assert.ok(afterXfs.length >= beforeXfs.length, "cellXfs 가 줄었다");
  assert.deepEqual(
    afterXfs.slice(0, beforeXfs.length),
    beforeXfs,
    "🔴 기존 xf 가 바뀌었다 — 그것을 쓰는 다른 칸이 전부 따라 바뀐다"
  );
  assert.equal(
    declaredCellXfCount(after),
    afterXfs.length,
    "cellXfs 의 count 가 실제 개수와 다르다 — Excel 이 파일을 거부한다"
  );
  assert.equal(declaredCellXfCount(before), beforeXfs.length, "양식의 count 부터 어긋나 있다");

  // cellXfs 말고는 글자 하나 안 달라진다(글꼴·테두리·색·dxfs·cellStyleXfs …).
  const withoutCellXfs = (xml: string): string =>
    xml.replace(/<cellXfs\b[^>]*>[\s\S]*?<\/cellXfs>/, "<cellXfs/>");
  assert.equal(withoutCellXfs(after), withoutCellXfs(before), "cellXfs 밖의 서식이 달라졌다");
}

/** 원본에서 그대로 나가야 하는 파트들 — 직인 그림·인쇄 설정. */
function assertUntouchedParts(templatePath: string, filled: Filled): void {
  const original = ZipArchive.fromBuffer(readFileSync(templatePath));
  const rewritten = new Set([
    resolveSheetPart(original, SERVICE_REPORT_SHEET_NAME),
    "xl/workbook.xml",
    "xl/_rels/workbook.xml.rels",
    "[Content_Types].xml",
    "xl/calcChain.xml",
    // 글상자의 견본 글자를 비우므로 이 파트는 언제나 달라진다.
    TEMPLATE_DRAWING_PART,
    // 본문 왼쪽 맞춤 xf 가 **뒤에 더해지므로** 달라진다. 바로 아래에서 그것이
    // 정말 '더하기만' 인지 본다 — 통째로 봐주는 것이 아니다.
    STYLES_PART,
  ]);
  assertStylesOnlyGrew(original, filled);

  let checked = 0;
  for (const name of original.list()) {
    if (rewritten.has(name)) continue;
    const before = original.readEntry(name);
    const after = filled.archive.readEntry(name);
    assert.ok(after !== null, `${name} 이 사라졌다`);
    assert.ok(before !== null && before.equals(after), `${name} 의 바이트가 달라졌다`);
    checked += 1;
  }
  assert.ok(checked > 20, `견준 파트가 ${checked}개뿐이다`);

  // 직인·사진은 이름을 못 박아 한 번 더 본다.
  for (const media of ["xl/media/image3.png", "xl/media/image4.jpeg"]) {
    assert.ok(
      original.readEntry(media)?.equals(filled.archive.readEntry(media) as Buffer),
      `${media} 가 달라졌다`
    );
  }
}

test("검사 보고서: 머리·체크·본문이 준 대로 들어간다", { skip: skipInspection }, () => {
  const filled = fill(inspectionPath as string, INSPECTION_INPUT);
  assertSheetIsSound(filled);

  // 제목 — 전각 공백까지.
  assert.equal(filled.text(SERVICE_REPORT_CELLS.title), "검　사　보　고　서");
  assert.equal(filled.text(SERVICE_REPORT_CELLS.title), SERVICE_REPORT_TITLES.INSPECTION);

  // 머리.
  assert.equal(filled.text(SERVICE_REPORT_CELLS.customerName), "테스트 반도체(주)");
  assert.equal(filled.text(SERVICE_REPORT_CELLS.issuedOn), "2026-09-01");
  assert.equal(filled.text(SERVICE_REPORT_CELLS.reportNumberPrefix), "No. T900 - ");
  assert.equal(filled.text(SERVICE_REPORT_CELLS.reportNumberMiddle), "Q11A1");
  assert.equal(filled.text(SERVICE_REPORT_CELLS.reportNumberTail), "7788");
  assert.equal(filled.text(SERVICE_REPORT_CELLS.customer), "테스트 고객 담당");
  assert.equal(filled.text(SERVICE_REPORT_CELLS.receivedOn), "2026-08-20");
  assert.equal(filled.text(SERVICE_REPORT_CELLS.occurrencePlace), "귀사 End User");
  assert.equal(filled.text(SERVICE_REPORT_CELLS.occurrencePlaceDetail), "제2공장");
  assert.equal(filled.text(SERVICE_REPORT_CELLS.occurredOn), "2026-08-18");
  assert.equal(filled.text(SERVICE_REPORT_CELLS.productName), "13.56MHz 30kW");
  assert.equal(filled.text(SERVICE_REPORT_CELLS.productCategory), "RF제네레이터");
  assert.equal(filled.text(SERVICE_REPORT_CELLS.modelName), "TEST300FH-AD1");
  assert.equal(filled.text(SERVICE_REPORT_CELLS.manufacturedYear), "2022");
  assert.equal(filled.text(SERVICE_REPORT_CELLS.manufacturedMonth), "5");
  assert.equal(filled.text(SERVICE_REPORT_CELLS.lotNumber), "LN12345");
  assert.equal(filled.text(SERVICE_REPORT_CELLS.serialNumber), "SN12345");
  assert.equal(filled.text(SERVICE_REPORT_CELLS.usedYears), "4");
  assert.equal(filled.text(SERVICE_REPORT_CELLS.usedMonths), "3");
  assert.equal(filled.text(SERVICE_REPORT_CELLS.repairNumber), "R260901");

  // 상황 — 앞 공백(글머리표)이 살아 있어야 한다.
  assert.equal(filled.text(SERVICE_REPORT_CELLS.situationRequest), " ・수리의뢰");
  assert.equal(
    filled.text(SERVICE_REPORT_CELLS.situationDetail),
    "출력이 나오지 않는다는 연락을 받았다."
  );

  // 조치 — 고른 것만 ○.
  assert.equal(filled.text("H27"), SERVICE_REPORT_CHECK_MARK, "현지수리가 안 찍혔다");
  assert.equal(filled.text("H28"), undefined, "대품납입이 찍혔다");
  assert.equal(filled.text("X27"), SERVICE_REPORT_CHECK_MARK, "현품 인수가 안 찍혔다");
  assert.equal(filled.text(SERVICE_REPORT_CELLS.goodsReceivedOn), "2026-08-21");
  assert.equal(filled.text(SERVICE_REPORT_CELLS.goodsReceiptNumber), "T260821");

  // 🔴 조치 완료는 검사 보고서에 없다.
  assert.equal(filled.text("X28"), undefined, "검사 보고서에 조치 완료가 찍혔다");
  assert.equal(filled.text(SERVICE_REPORT_CELLS.completedOn), undefined);

  // 원인 — 고른 둘만. 양식 견본에 남아 있던 `기타`(AN30) 는 지워져야 한다.
  assert.equal(filled.text("P29"), SERVICE_REPORT_CHECK_MARK, "부품불량이 안 찍혔다");
  assert.equal(filled.text("X29"), SERVICE_REPORT_CHECK_MARK, "노후화가 안 찍혔다");
  for (const ref of ["H29", "AF29", "AN29", "H30", "P30", "X30", "AF30", "AN30"]) {
    assert.equal(filled.text(ref), undefined, `${ref} 에 안 고른 원인이 찍혔다`);
  }

  // 🔴 31행은 비운다 — 「확인내용」은 32행부터다(발행본이 그렇다).
  assert.equal(filled.text("C31"), undefined, "31행에 라벨이 찍혔다");
  assert.equal(filled.text("H31"), undefined, "31행에 내용이 찍혔다");

  // 본문 — 🔴 「확인내용」 라벨은 원본처럼 **두 줄**이다.
  assert.equal(filled.text("C32"), SERVICE_REPORT_BODY_LABELS.findings[0]);
  assert.equal(filled.text("C33"), SERVICE_REPORT_BODY_LABELS.findings[1]);
  assert.equal(INSPECTION_FINDINGS_ROW, 32, "검사 양식의 「확인내용」 자리가 바뀌었다");
  assert.equal(filled.text("H32"), "외관 손상 없음");
  assert.equal(filled.text("H33"), "전원부 퓨즈 단선 확인");

  /**
   * 🔴 **2026-10-31 — 「조치」는 확인내용 바로 다음, 빈 줄 하나 건너 35행이다.**
   *
   * 예전에는 양식의 라벨 글상자가 정한 **43행**에서 시작했고(검사 양식),
   * 확인내용이 두 줄뿐이면 34~42행이 통째로 비었다. 사용자가 그 설계를 알고
   * 뒤집었다 — 「행을 한 칸만 띄운 다음에 다음 단락의 내용이 나오도록」.
   * `INSPECTION_ACTIONS_ROW`(43) 는 **양식이 그 자리를 여전히 그렇게 말한다**는
   * 사실만 지키고(아래 '구역 자리는 양식의 글상자를 따라간다' 시험이 그 쓰임),
   * 문서의 배치는 더 이상 그 값을 쓰지 않는다.
   */
  assert.equal(filled.text("C34"), undefined, "구역 사이의 빈 줄에 라벨이 찍혔다");
  assert.equal(filled.text("H34"), undefined, "구역 사이의 빈 줄이 없다");
  assert.equal(filled.text("C35"), SERVICE_REPORT_BODY_LABELS.actions[0]);
  assert.equal(filled.text("C36"), undefined, "「조치」 라벨이 두 줄에 찍혔다");
  assert.equal(filled.text("H35"), "퓨즈 교체");
  assert.equal(filled.text("H36"), "정격 출력 시험 통과");
  assert.equal(filled.text("C43"), undefined, "「조치」가 옛 자리에도 찍혔다");
  // 🔴 맺음 표시는 마지막 내용 줄(36)에서 **세 줄 띄운** 40행이고, 그 아래로
  //    세 줄(41·42·43)이 남은 뒤 블록이 끝난다.
  for (const row of [37, 38, 39]) {
    assert.equal(filled.text(`H${row}`), undefined, `맺음 표시 위 ${row}행이 안 비었다`);
  }
  assertClosingMarkAt(filled, 40);
  assert.equal(filled.text("H41"), undefined);
  assert.equal(filled.text("H42"), undefined);
  assert.equal(filled.text("H43"), undefined);
  // 🔴 정리는 검사 보고서에 없다.
  assert.equal(filled.text("C40"), undefined);
  assert.equal(filled.text("C41"), undefined);

  // 비고 — 블록이 열여섯 줄 줄었으므로 60행이 아니라 44행이다.
  assert.equal(filled.text("H44"), "보증 기간 밖입니다.");
  assert.equal(filled.text("H45"), "부품은 재고분을 썼습니다.");
  assert.equal(filled.text("H46"), undefined);
  assert.ok(filled.text("C44")?.startsWith("비　고"), "비고 라벨이 안 올라왔다");
  assert.equal(filled.printArea, `'${SERVICE_REPORT_SHEET_NAME}'!$B$8:$AV$48`);

  assertUntouchedParts(inspectionPath as string, filled);
});

/**
 * 🔴 **「던지지 않는다」만으로는 모자라다.** 검사를 통과해도 채우개가 그 칸에
 * `undefined` 나 `No. - ` 같은 찌꺼기를 박으면 사람이 그것을 발행번호로 읽는다.
 * 그래서 실제 양식을 채워 **칸에 무엇이 남았는지** 본다.
 *
 * 양식 견본(AM13·AQ13)에는 실제로 발행된 보고서의 번호가 박혀 있다. 빈 값을
 * 주면 그 옛 값까지 지워져야 한다 — 남으면 남의 번호를 달고 나간다.
 */
test("🔴 보고서 번호가 비면 그 칸은 빈 채로 찍힌다", { skip: skipInspection }, () => {
  const filled = fill(inspectionPath as string, {
    ...INSPECTION_INPUT,
    // 공백만 준 쪽도 함께 본다 — 다듬은 뒤 비워야 한다.
    reportNumber: { prefix: "T900", middle: "", tail: "  " },
  });
  assertSheetIsSound(filled);

  assert.equal(
    filled.text(SERVICE_REPORT_CELLS.reportNumberMiddle),
    undefined,
    "보고서 번호(중간) 칸에 무언가 남았다 — 양식의 옛 번호이거나 찌꺼기다"
  );
  assert.equal(
    filled.text(SERVICE_REPORT_CELLS.reportNumberTail),
    undefined,
    "보고서 번호(뒤) 칸에 무언가 남았다 — 양식의 옛 번호이거나 찌꺼기다"
  );
  // 🔴 칸이 사라지는 것이 아니라 **값만** 빈다. 서식이 날아가면 나중에 사람이
  //    번호를 적어 넣었을 때 글꼴·테두리가 다른 칸이 된다.
  assert.match(filled.sheetXml, /<c r="AM13"[^>]*\/>/, "AM13 셀 자체가 사라졌다");
  assert.match(filled.sheetXml, /<c r="AQ13"[^>]*\/>/, "AQ13 셀 자체가 사라졌다");

  // 번호 줄이 통째로 비는 것은 아니다 — 앞 칸은 준 대로 찍힌다.
  assert.equal(filled.text(SERVICE_REPORT_CELLS.reportNumberPrefix), "No. T900 - ");
  // 나머지 머리 칸도 평소대로다.
  assert.equal(filled.text(SERVICE_REPORT_CELLS.customerName), "테스트 반도체(주)");
  assert.equal(filled.text(SERVICE_REPORT_CELLS.issuedOn), "2026-09-01");
});

test("수리 보고서: 제목·조치 완료·정리가 이 종류에만 들어간다", { skip: skipRepair }, () => {
  const filled = fill(repairPath as string, REPAIR_INPUT);
  assertSheetIsSound(filled);

  assert.equal(filled.text(SERVICE_REPORT_CELLS.title), "수　리　보　고　서");
  assert.equal(filled.text(SERVICE_REPORT_CELLS.title), SERVICE_REPORT_TITLES.REPAIR);

  // 🔴 검사 보고서에는 없던 둘.
  assert.equal(filled.text("X28"), SERVICE_REPORT_CHECK_MARK, "조치 완료가 안 찍혔다");
  assert.equal(filled.text(SERVICE_REPORT_CELLS.completedOn), "2026-09-01");

  /**
   * 🔴 세 구역이 **한 줄씩 띄워 이어진다** — 32 / 35 / 38행 (2026-10-31).
   *
   * 예전에는 양식의 라벨 글상자가 정한 32 / 41 / 51행에서 시작했고, 짧은 본문은
   * 구역 사이가 일곱·아홉 줄씩 벌어졌다. 사용자가 그 설계를 알고 뒤집었다.
   * 양식이 말하는 자리(`REPAIR_ACTIONS_ROW`·`REPAIR_SUMMARY_ROW`)는 아래 전용
   * 시험이 따로 지키고, 여기서는 **문서에 찍힌 자리**를 본다.
   *
   * 「확인내용」만 글상자가 가리키는 31행이 아니라 **한 줄 아래**다 — 발행본이
   * 그렇다(2026-09-02 사용자 결정. 이 한 줄은 그대로 살아 있다). 31행은 빈다.
   */
  assert.equal(filled.text("C31"), undefined, "31행에 라벨이 찍혔다");
  assert.equal(filled.text("H31"), undefined, "31행에 내용이 찍혔다");
  assert.equal(filled.text("C32"), SERVICE_REPORT_BODY_LABELS.findings[0]);
  assert.equal(filled.text("C33"), SERVICE_REPORT_BODY_LABELS.findings[1]);
  assert.equal(REPAIR_FINDINGS_ROW, 32, "수리 양식의 「확인내용」 자리가 바뀌었다");
  assert.equal(filled.text("C35"), SERVICE_REPORT_BODY_LABELS.actions[0]);
  assert.equal(filled.text("H35"), "퓨즈 교체");
  assert.equal(filled.text("H36"), "정격 출력 시험 통과");
  assert.equal(filled.text("C38"), SERVICE_REPORT_BODY_LABELS.summary[0]);
  assert.equal(filled.text("H38"), "같은 증상 재발 시 전원부 전체 점검을 권합니다.");
  // 구역 사이는 **딱 한 줄**이고 거기엔 라벨도 내용도 없다.
  for (const row of [34, 37]) {
    assert.equal(filled.text(`C${row}`), undefined, `${row}행(구역 사이)에 라벨이 찍혔다`);
    assert.equal(filled.text(`H${row}`), undefined, `${row}행(구역 사이)에 내용이 찍혔다`);
  }
  // 옛 자리에는 아무것도 없다 — 되돌아가면 여기가 먼저 깨진다.
  assert.equal(filled.text("C41"), undefined, "「조치」가 옛 자리(41행)에 찍혔다");
  assert.equal(filled.text("C51"), undefined, "「정리」가 옛 자리(51행)에 찍혔다");
  // 🔴 맺음 표시는 마지막 내용 줄(38)에서 **세 줄 띄운** 42행. 아래 세 줄도 빈다.
  for (const row of [39, 40, 41]) {
    assert.equal(filled.text(`H${row}`), undefined, `맺음 표시 위 ${row}행이 안 비었다`);
  }
  assertClosingMarkAt(filled, 42);
  assert.equal(filled.text("H43"), undefined);
  assert.equal(filled.text("H44"), undefined);
  assert.equal(filled.text("H45"), undefined);
  // 블록이 열네 줄 줄어 비고가 46행으로 올라왔다.
  assert.ok(filled.text("C46")?.startsWith("비　고"), "비고 라벨이 안 올라왔다");
  assert.equal(filled.printArea, `'${SERVICE_REPORT_SHEET_NAME}'!$B$8:$AV$50`);

  assertUntouchedParts(repairPath as string, filled);
});

test("🔴 양식의 글상자에 남아 있던 견본 글자가 사라진다", { skip: skipRepair }, () => {
  const original = ZipArchive.fromBuffer(readFileSync(repairPath as string));
  const before = original.readText(TEMPLATE_DRAWING_PART);
  // 시험 준비 확인 — 양식에는 실제로 그 글자들이 있다.
  assert.ok(before.includes("인수품에 대하여"), "양식에 견본 문장이 없다(시험 준비 실패)");
  assert.ok(before.includes("확　내"), "양식에 라벨 글상자가 없다(시험 준비 실패)");

  const filled = fill(repairPath as string, REPAIR_INPUT);
  for (const leftover of ["인수품에 대하여", "확　내", "인　용", "조  치", "정  리", "～"]) {
    assert.ok(
      !filled.drawingXml.includes(leftover),
      `글상자에 "${leftover}" 이(가) 남았다 — 본문과 겹쳐 인쇄된다`
    );
  }

  // 🔴 도형과 그림은 그대로 있다. 지우면 관계와 그림 번호가 흔들린다.
  assert.equal(
    (filled.drawingXml.match(/<xdr:twoCellAnchor/g) ?? []).length,
    (before.match(/<xdr:twoCellAnchor/g) ?? []).length,
    "도형이 사라졌다"
  );
  for (const name of ["Text Box 7", "Text Box 9", "그림 3", "그림 6", "그림 4"]) {
    assert.ok(filled.drawingXml.includes(`name="${name}"`), `${name} 도형이 사라졌다`);
  }
  // 라벨과 맺음 표시는 이제 셀에 있다 — 그리고 **글자가 원본과 똑같다.**
  // 자리는 2026-10-31 부터 이어 붙은 자리다(32 / 35 / 38행). 「확인내용」만
  // 글상자가 가리키는 31행이 아니라 발행본을 따라 한 줄 아래(32행)다.
  assert.equal(filled.text("C32"), "확　내");
  assert.equal(filled.text("C33"), "인　용");
  assert.equal(filled.text("C35"), "조  치");
  assert.equal(filled.text("C38"), "정  리");
  assertClosingMarkAt(filled, 42);
});

/**
 * 🔴 라벨 글자는 원본 글상자에서 코드 포인트째 옮긴 것이다. 전각 공백(U+3000)과
 * 보통 공백(U+0020)은 화면에서 구별되지 않아서, 한 번 섞이면 아무도 못 잡는다.
 * 여기서 **코드 포인트로** 못 박는다.
 */
test("🔴 라벨 글자가 원본 양식과 코드 포인트까지 같다", () => {
  const codePoints = (text: string): string =>
    [...text].map((char) => char.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")).join(" ");

  assert.deepEqual(SERVICE_REPORT_BODY_LABELS.findings.map(codePoints), [
    "D655 3000 B0B4", // 확　내 — 전각 공백
    "C778 3000 C6A9", // 인　용 — 전각 공백
  ]);
  assert.deepEqual(SERVICE_REPORT_BODY_LABELS.actions.map(codePoints), [
    "C870 0020 0020 CE58", // 조  치 — 보통 공백 둘
  ]);
  assert.deepEqual(SERVICE_REPORT_BODY_LABELS.summary.map(codePoints), [
    "C815 0020 0020 B9AC", // 정  리 — 보통 공백 둘
  ]);

  // 「확인내용」만 두 줄이다.
  assert.equal(SERVICE_REPORT_BODY_LABELS.findings.length, 2);
  assert.equal(SERVICE_REPORT_BODY_LABELS.actions.length, 1);
  assert.equal(SERVICE_REPORT_BODY_LABELS.summary.length, 1);
});

/**
 * 🔴 **라벨·맺음 표시·여백이 한 벌인가** (2026-10-18)
 *
 * 작성 화면의 미리보기가 그 글자들을 그려야 해서
 * `domain/service-report-body-wrap.ts` 로 옮겼고, 이 모듈은 같은 이름으로 다시
 * 내보낸다. 어느 날 누가 여기에 «비슷한 값»을 다시 적어 두면 위의 코드 포인트
 * 시험은 그대로 통과하면서 화면과 문서만 갈린다 — **같은 물건인지**를 본다.
 */
test("🔴 화면과 채우개가 같은 라벨·맺음 표시·여백을 쓴다 (한 벌)", () => {
  assert.equal(SERVICE_REPORT_BODY_LABELS, wrap.SERVICE_REPORT_BODY_LABELS);
  assert.equal(SERVICE_REPORT_CLOSING_MARK, wrap.SERVICE_REPORT_CLOSING_MARK);
  assert.equal(SERVICE_REPORT_SECTION_GAP_ROWS, wrap.SERVICE_REPORT_SECTION_GAP_ROWS);
  assert.equal(SERVICE_REPORT_CLOSING_GAP_ROWS, wrap.SERVICE_REPORT_CLOSING_GAP_ROWS);
  assert.equal(SERVICE_REPORT_CLOSING_TRAILING_ROWS, wrap.SERVICE_REPORT_CLOSING_TRAILING_ROWS);
});

test("🔴 확인내용이 한 줄뿐이어도 라벨은 두 줄을 지킨다", { skip: skipRepair }, () => {
  const filled = fill(repairPath as string, {
    ...REPAIR_INPUT,
    // 정형 문구를 켜면 확인내용이 두 줄이 되어 이 시험의 뜻(내용 한 줄)이 사라진다.
    body: {
      findings: ["외관 손상 없음"],
      findingsIntro: "",
      actions: ["퓨즈 교체"],
      summary: ["재발 시 연락 바랍니다."],
    },
  });

  // 라벨 두 줄이 온전하다.
  assert.equal(filled.text("C32"), SERVICE_REPORT_BODY_LABELS.findings[0]);
  assert.equal(filled.text("C33"), SERVICE_REPORT_BODY_LABELS.findings[1]);
  // 내용은 첫 줄부터 채우므로 둘째 줄은 빈다.
  assert.equal(filled.text("H32"), "외관 손상 없음");
  assert.equal(filled.text("H33"), undefined, "내용이 라벨을 따라 밀렸다");

  /**
   * 🔴 **구역을 이어 붙이게 된 뒤(2026-10-31) 이 시험이 더 중요해졌다.** 예전에는
   * 「조치」가 41행에서 시작해 `인　용`(33행)과 여덟 줄 떨어져 있었으니 덮일 일이
   * 애초에 없었다. 지금은 바로 아래 줄들이라, 구역이 먹는 줄 수를 내용 줄 수로
   * 세면(`sectionRowCount` 를 안 쓰면) 「조치」가 33행에 앉아 `인　용` 을 덮는다.
   *
   * 자리: 확인내용 32~33(내용 한 줄 + 라벨 둘) → 빈 줄 34 → 조치 35 → 빈 줄 36
   *       → 정리 37 → 빈 줄 38·39·40 → 맺음 41.
   */
  assert.equal(filled.text("C34"), undefined, "구역 사이의 빈 줄에 라벨이 찍혔다");
  assert.equal(filled.text("C35"), SERVICE_REPORT_BODY_LABELS.actions[0]);
  assert.equal(filled.text("H35"), "퓨즈 교체");
  assert.equal(filled.text("C37"), SERVICE_REPORT_BODY_LABELS.summary[0]);
  assert.equal(filled.text("H37"), "재발 시 연락 바랍니다.");
  assertClosingMarkAt(filled, 41);
  assertSheetIsSound(filled, -15);
});

/**
 * ============================================================================
 * 🔴 이 시험이 구역 자리 규칙의 본체다 — **2026-10-31 에 뒤집힌 자리**
 * ============================================================================
 * 예전 제목은 「짧은 본문이라도 세 구역은 제자리(32·41·51행)에서 시작한다」였다.
 * 양식의 라벨 글상자가 정한 자리에서 각 구역이 시작했고, 확인내용이 두 줄뿐이면
 * 34~40행이 통째로 비었다 — **버그가 아니라 설계**였다(실제 발행본의 모양).
 *
 * 🔴 사용자가 그 설계를 알고 뒤집었다: 「각각의 본문내용이 끝나고 행을 한 칸만
 * 띄운 다음에 다음 단락의 내용이 나오도록」. 그래서 **단언의 수만 바꾸는 것이
 * 아니라 뜻이 바뀌었다** — 「제자리에서 시작한다」가 아니라 「이어 붙는다」를
 * 지킨다. 지키던 보증(31행은 빈다 · 라벨 두 줄 · 사이에 라벨도 내용도 없다 ·
 * 맺음 표시 아래 여백이 블록 안에 있다)은 그대로 둔다.
 * ============================================================================
 */
test("🔴 짧은 본문이면 세 구역이 한 줄씩 띄워 이어진다(32·35·38행)", { skip: skipRepair }, () => {
  const filled = fill(repairPath as string, {
    ...REPAIR_INPUT,
    body: {
      findings: ["확인 1", "확인 2"],
      findingsIntro: "",
      actions: ["조치 1", "조치 2"],
      summary: ["정리 1"],
    },
  });
  // 🔴 본문이 양식의 29줄을 다 안 쓰므로 블록이 열네 줄 **줄어든다**.
  assertSheetIsSound(filled, -14);

  // 🔴 31행은 비운다 — 글상자는 31을 가리키지만 발행본은 32에서 시작한다.
  assert.equal(filled.text("C31"), undefined, "31행에 라벨이 찍혔다");
  assert.equal(filled.text("H31"), undefined, "31행에 내용이 찍혔다");

  assert.equal(filled.text(`C${REPAIR_FINDINGS_ROW}`), SERVICE_REPORT_BODY_LABELS.findings[0]);
  assert.equal(filled.text("C32"), SERVICE_REPORT_BODY_LABELS.findings[0]);
  assert.equal(filled.text("C33"), SERVICE_REPORT_BODY_LABELS.findings[1]);
  assert.equal(filled.text("H32"), "확인 1");
  assert.equal(filled.text("H33"), "확인 2");

  // 확인내용 마지막 줄(33) → 빈 줄 하나(34) → 조치(35).
  assert.equal(filled.text("C35"), SERVICE_REPORT_BODY_LABELS.actions[0]);
  assert.equal(filled.text("H35"), "조치 1");
  assert.equal(filled.text("H36"), "조치 2");

  // 조치 마지막 줄(36) → 빈 줄 하나(37) → 정리(38).
  assert.equal(filled.text("C38"), SERVICE_REPORT_BODY_LABELS.summary[0]);
  assert.equal(filled.text("H38"), "정리 1");

  // 🔴 양식이 말하는 옛 자리에는 아무것도 없다 — 되돌리면 여기가 먼저 깨진다.
  assert.equal(REPAIR_ACTIONS_ROW, 41, "수리 양식이 말하는 「조치」 자리가 바뀌었다");
  assert.equal(REPAIR_SUMMARY_ROW, 51, "수리 양식이 말하는 「정리」 자리가 바뀌었다");
  assert.equal(filled.text(`C${REPAIR_ACTIONS_ROW}`), undefined, "「조치」가 옛 자리에 찍혔다");
  assert.equal(filled.text(`C${REPAIR_SUMMARY_ROW}`), undefined, "「정리」가 옛 자리에 찍혔다");

  /**
   * 🔴 **정리 마지막 줄(38) → 빈 줄 셋(39·40·41) → 맺음 표시(42)** — 2026-10-31
   * 사용자 결정(「본문의 가장 마지막 줄에서 3행을 띄우고」).
   */
  assertClosingMarkAt(filled, 42);
  assert.equal(
    38 + SERVICE_REPORT_CLOSING_GAP_ROWS + 1,
    42,
    "맺음 표시의 여백이 세 줄이 아니다"
  );
  for (const row of [39, 40, 41]) {
    assert.equal(filled.text(`H${row}`), undefined, `맺음 표시 위 ${row}행이 안 비었다`);
    assert.equal(filled.text(`C${row}`), undefined, `맺음 표시 위 ${row}행에 라벨이 찍혔다`);
  }

  // 🔴 맺음 표시 아래 세 줄(43·44·45)이 **줄어든 블록 안에** 남고 거기서 끝난다.
  //    (`assertSheetIsSound` 가 비고 라벨과의 사이로 그것을 이미 본다.)
  for (let index = 1; index <= SERVICE_REPORT_CLOSING_TRAILING_ROWS; index += 1) {
    assert.equal(filled.text(`H${42 + index}`), undefined, `H${42 + index} 에 글자가 찍혔다`);
  }
  assert.ok(filled.text("C46")?.startsWith("비　고"), "비고가 블록 바로 아래로 안 올라왔다");

  // 구역 사이·맺음 표시 둘레는 라벨도 내용도 없다.
  for (const row of [31, 34, 37, 39, 40, 41]) {
    assert.equal(filled.text(`C${row}`), undefined, `${row}행에 라벨이 찍혔다`);
    assert.equal(filled.text(`H${row}`), undefined, `${row}행에 내용이 찍혔다`);
  }
});

test("🔴 검사 보고서도 두 구역이 한 줄 띄워 이어진다(32·35행)", { skip: skipInspection }, () => {
  const filled = fill(inspectionPath as string, {
    ...INSPECTION_INPUT,
    body: { findings: ["확인 1"], findingsIntro: "", actions: ["조치 1"] },
  });
  assertSheetIsSound(filled, -17);

  assert.equal(filled.text("C31"), undefined, "31행에 라벨이 찍혔다");
  assert.equal(filled.text("H31"), undefined, "31행에 내용이 찍혔다");
  assert.equal(filled.text(`C${INSPECTION_FINDINGS_ROW}`), SERVICE_REPORT_BODY_LABELS.findings[0]);
  assert.equal(filled.text("C33"), SERVICE_REPORT_BODY_LABELS.findings[1], "라벨 두 줄이 깨졌다");
  assert.equal(filled.text("H32"), "확인 1");

  /**
   * 🔴 「조치」는 확인내용이 먹은 두 줄(32·33 — 내용 한 줄 + 라벨 둘) 다음에
   * 빈 줄 하나를 두고 35행이다. 양식이 말하는 자리(43행)는 이제 안 쓴다.
   */
  assert.equal(filled.text("H34"), undefined, "구역 사이의 빈 줄이 없다");
  assert.equal(filled.text("C35"), SERVICE_REPORT_BODY_LABELS.actions[0]);
  assert.equal(filled.text("H35"), "조치 1");
  assert.equal(INSPECTION_ACTIONS_ROW, 43, "검사 양식이 말하는 「조치」 자리가 바뀌었다");
  /**
   * ⚠️ 여기서는 **옛 자리(43행)가 비었는지 볼 수 없다.** 블록이 열일곱 줄 줄어
   * 그 행이 이제 비고 라벨 자리다(아래에서 그것을 단언한다). 대신 「조치」 라벨이
   * 문서에 **한 번만** 있는지로 본다.
   */
  assert.equal(
    [...filled.sheetXml.matchAll(/<is><t[^>]*>조  치<\/t><\/is>/g)].length,
    1,
    "「조치」 라벨이 두 군데 찍혔다"
  );

  /**
   * 🔴 「정리」가 없는 검사 보고서에서도 여백 규칙은 같다 —
   * **조치 마지막 줄(35) → 빈 줄 셋(36·37·38) → 맺음 표시(39) → 빈 줄 셋(40~42)**.
   */
  for (const row of [36, 37, 38]) {
    assert.equal(filled.text(`H${row}`), undefined, `맺음 표시 위 ${row}행이 안 비었다`);
  }
  assertClosingMarkAt(filled, 39);
  for (let index = 1; index <= SERVICE_REPORT_CLOSING_TRAILING_ROWS; index += 1) {
    assert.equal(filled.text(`H${39 + index}`), undefined, `H${39 + index} 에 글자가 찍혔다`);
  }
  assert.ok(filled.text("C43")?.startsWith("비　고"), "비고가 블록 바로 아래로 안 올라왔다");
});

/**
 * 🔴 확인내용이 **길어도 사이는 한 줄**이고, 아래 구역이 그만큼 내려간다. 조용히
 * 잘리거나 겹쳐 찍히면 우리가 적은 줄이 문서에서 사라진 채 나간다.
 *
 * ⚠️ 예전 제목은 「확인내용이 배정된 자리보다 길면 조치가 그만큼 밀린다」였다.
 * 「배정된 자리」(확인내용에 9줄 · 조치에 10줄)라는 것이 2026-10-31 에 사라졌다 —
 * 구역은 이제 배정 없이 이어 붙는다. 🔴 지키려던 것(긴 본문이 잘리거나 겹치지
 * 않는다)은 그대로이고, 수만 새 규칙으로 다시 적었다. 13줄은 **옛 배정 9줄을 네
 * 줄 넘기던** 표본이라 그대로 둔다 — 이제는 아무 데도 안 넘치는 보통 본문이다.
 */
test("🔴 확인내용이 열세 줄이어도 사이는 한 줄이고 아래가 그만큼 내려간다", { skip: skipRepair }, () => {
  const filled = fill(repairPath as string, {
    ...REPAIR_INPUT,
    body: {
      findings: bodyLines(13, "확인"),
      findingsIntro: "",
      actions: ["조치 1", "조치 2"],
      summary: ["정리 1"],
    },
  });
  /**
   * 🔴 줄이 **세 줄 걷힌다.** 맺음 표시가 53행이면 그 아래 세 줄은 56행에서
   * 끝나는데 양식의 블록은 59행까지라 세 줄이 남기 때문이다 — 그 세 줄은 이제
   * 상자 안에 남지 않고 비고가 그만큼 올라온다(`shrinkBodyBlock`).
   */
  assertSheetIsSound(filled, -3);

  assert.equal(filled.text("H32"), "확인 1");
  assert.equal(filled.text("H44"), "확인 13");

  // 🔴 마지막 확인내용(44행) 다음 한 줄이 빈다.
  assert.equal(filled.text("C45"), undefined, "구역 사이의 빈 줄에 라벨이 찍혔다");
  assert.equal(filled.text("H45"), undefined, "구역 사이의 빈 줄이 없다");

  // 조치는 46행에서 시작한다(32 + 13줄 + 빈 줄 1).
  assert.equal(filled.text("C46"), SERVICE_REPORT_BODY_LABELS.actions[0]);
  assert.equal(filled.text("C41"), undefined, "「조치」가 옛 자리에 찍혔다");
  assert.equal(filled.text("H46"), "조치 1");
  assert.equal(filled.text("H47"), "조치 2");

  // 🔴 「정리」도 바로 이어진다(47 + 빈 줄 1).
  assert.equal(filled.text("C49"), SERVICE_REPORT_BODY_LABELS.summary[0]);
  assert.equal(filled.text("H48"), undefined, "구역 사이의 빈 줄이 없다");
  assert.equal(filled.text("C51"), undefined, "「정리」가 옛 자리에 찍혔다");
  assert.equal(filled.text("H49"), "정리 1");
  // 🔴 맺음 표시의 여백 규칙은 그대로다 — 49 → 빈 50·51·52 → 53.
  for (const row of [50, 51, 52]) {
    assert.equal(filled.text(`H${row}`), undefined, `맺음 표시 위 ${row}행이 안 비었다`);
  }
  assertClosingMarkAt(filled, 53);
  // 🔴 아래 세 줄(54·55·56)이 **줄어든 블록 안에** 있고 전부 비어 있다.
  for (const row of [54, 55, 56]) {
    assert.equal(filled.text(`H${row}`), undefined, `맺음 표시 아래 ${row}행에 글자가 찍혔다`);
  }
  assert.ok(filled.merges.includes("H56:AU56"), "줄어든 블록의 마지막 줄에 내용 병합이 없다");
  assert.ok(!filled.merges.includes("H59:AU59"), "걷어낸 줄의 병합이 남았다");
  // 비고는 세 줄 올라왔다 — 블록이 줄어든 만큼 아래가 통째로 따라온다.
  assert.ok(filled.text("C57")?.startsWith("비　고"), "비고 라벨이 안 올라왔다");
});

/**
 * ============================================================================
 * 🔴 구역과 구역 사이에는 빈 줄이 한 줄 있다
 * ============================================================================
 * 사용자가 실제 발행본과 견주어 짚은 자리다. 내용이 넘쳐 아래 구역을 밀어내면
 * 예전에는 이렇게 나왔다(실측):
 *
 *   42        | -종단 AMP 압착금구 고장 확인
 *   43 조  치 | • 종단 AMP 입력 보호 휴즈 교환   ← 딱 붙어 구분이 안 된다
 *
 * 확인내용 11줄이 그 실측 예다 — 옛 설계에서 배정된 9줄을 두 줄 넘기던 자리라,
 * **구역이 딱 붙던 바로 그 상황**을 재현한다. 2026-10-31 뒤에는 길이와 상관없이
 * 사이가 한 줄이므로 이 표본은 「길어도 한 줄」을 보는 쪽이 되었다.
 * ============================================================================
 */
test("🔴 확인내용 열한 줄 — 사이는 여전히 빈 줄 한 줄이다", { skip: skipRepair }, () => {
  const filled = fill(repairPath as string, {
    ...REPAIR_INPUT,
    body: {
      findings: bodyLines(11, "확인"),
      findingsIntro: "",
      actions: ["조치 1"],
      summary: ["정리 1"],
    },
  });
  assertSheetIsSound(filled, -6);

  // 확인내용은 32~42행이다.
  assert.equal(filled.text("H32"), "확인 1");
  assert.equal(filled.text("H42"), "확인 11");

  // 🔴 43행이 빈다 — 구역이 딱 붙으면 안 된다.
  assert.equal(filled.text("C43"), undefined, "빈 줄 자리에 라벨이 찍혔다");
  assert.equal(filled.text("H43"), undefined, "「조치」가 「확인내용」에 이어 붙었다");

  // 「조치」는 44행에서 시작한다.
  assert.equal(filled.text("C44"), SERVICE_REPORT_BODY_LABELS.actions[0]);
  assert.equal(filled.text("H44"), "조치 1");

  // 빈 줄은 **한 줄뿐**이다 — 두 줄이면 아래가 한 줄 더 내려간다.
  assert.equal(filled.text("H45"), undefined);
  assert.equal(filled.text("C46"), SERVICE_REPORT_BODY_LABELS.summary[0], "빈 줄이 두 줄이 됐다");
  assert.equal(filled.text("H46"), "정리 1");
  // 🔴 정리 마지막 줄(46) → 빈 줄 셋(47·48·49) → 맺음 표시(50) → 빈 줄 셋(51~53).
  for (const row of [47, 48, 49]) {
    assert.equal(filled.text(`H${row}`), undefined, `맺음 표시 위 ${row}행이 안 비었다`);
  }
  assertClosingMarkAt(filled, 50);
  assert.equal(filled.text("H51"), undefined);
  assert.equal(filled.text("H52"), undefined);
  assert.equal(filled.text("H53"), undefined);
});

/**
 * 🔴 **길이가 달라도 사이는 늘 한 줄이다.** 바로 위 시험이 11줄, 이쪽이 9줄 —
 * 옛 설계에서 9줄은 「확인내용에 배정된 자리를 딱 채우는」 수였고, 그때는 배정과
 * 여백 중 큰 쪽이 이기는 셈(`max(allotted, lines + gap)`) 때문에 사이가 딱 한 줄
 * 벌어졌다. 지금은 배정이 없고 늘 한 줄이다 — **두 표본의 사이가 같은지**가
 * 그것을 가른다(한 가지만 재면 「고정 한 줄」과 「우연히 한 줄」이 안 갈린다).
 */
test("🔴 확인내용 아홉 줄 — 사이가 11줄일 때와 똑같이 한 줄이다", { skip: skipRepair }, () => {
  const filled = fill(repairPath as string, {
    ...REPAIR_INPUT,
    body: {
      findings: bodyLines(9, "확인"),
      findingsIntro: "",
      actions: ["조치 1"],
      summary: ["정리 1"],
    },
  });
  assertSheetIsSound(filled, -8);

  assert.equal(filled.text("H40"), "확인 9", "확인내용이 아홉 줄이 아니다");
  assert.equal(filled.text("C41"), undefined, "41행이 안 비었다");
  assert.equal(filled.text("H41"), undefined, "41행이 안 비었다");
  assert.equal(filled.text("C42"), SERVICE_REPORT_BODY_LABELS.actions[0]);
  assert.equal(filled.text("H42"), "조치 1");
  // 「정리」도 한 줄만 띄우고 이어진다.
  assert.equal(filled.text("H43"), undefined, "구역 사이의 빈 줄이 없다");
  assert.equal(filled.text("C44"), SERVICE_REPORT_BODY_LABELS.summary[0]);
  assert.equal(filled.text("H44"), "정리 1");
  // 🔴 구역 사이의 빈 줄 규칙은 그대로이고, 맺음 표시 여백 셋이 그 위에 얹힌다.
  for (const row of [45, 46, 47]) {
    assert.equal(filled.text(`H${row}`), undefined, `맺음 표시 위 ${row}행이 안 비었다`);
  }
  assertClosingMarkAt(filled, 48);
});

/**
 * 🔴 **내용이 없는 구역은 빈 줄도 안 만든다.** 만들면 그리지도 않은 구역 때문에
 * 사이가 두 줄이 되고, 아래 구역이 한 줄 더 밀린다.
 */
test("🔴 내용 없는 구역을 건너뛸 때 빈 줄이 두 줄이 되지 않는다", { skip: skipRepair }, () => {
  const filled = fill(repairPath as string, {
    ...REPAIR_INPUT,
    body: {
      // 확인내용 25줄이면 32~56행을 쓴다 — 양식의 블록이 모자랄 만큼 길다.
      findings: bodyLines(25, "확인"),
      findingsIntro: "",
      actions: [],
      summary: ["정리 1"],
    },
  });
  // 🔴 맺음 표시(62)와 그 아래 세 줄(63·64·65)이 양식의 블록(~59행)을 넘으므로
  //    여섯 줄이 끼워 넣어진다 — 여백을 잘라 내지 않는다.
  assertSheetIsSound(filled, 6);

  assert.equal(filled.text("H56"), "확인 25");
  // 빈 줄은 57행 하나뿐이고, 건너뛴 「조치」가 한 줄을 더 먹지 않는다.
  assert.equal(filled.text("C57"), undefined, "빈 줄에 라벨이 찍혔다");
  assert.equal(filled.text("H57"), undefined, "빈 줄이 없다");
  assert.equal(filled.text("C58"), SERVICE_REPORT_BODY_LABELS.summary[0], "빈 줄이 두 줄이 됐다");
  assert.equal(filled.text("H58"), "정리 1");
  // 정리 마지막 줄(58) → 빈 줄 셋(59·60·61) → 맺음 표시(62) → 빈 줄 셋(63~65).
  for (const row of [59, 60, 61]) {
    assert.equal(filled.text(`H${row}`), undefined, `맺음 표시 위 ${row}행이 안 비었다`);
  }
  assertClosingMarkAt(filled, 62);
  assert.equal(filled.text("H63"), undefined);
  assert.equal(filled.text("H64"), undefined);
  assert.equal(filled.text("H65"), undefined);
  // 아래 구역은 통째로 여섯 줄 내려갔다.
  assert.ok(filled.text("C66")?.startsWith("비　고"), "비고 라벨이 안 내려갔다");
  assert.equal(filled.printArea, `'${SERVICE_REPORT_SHEET_NAME}'!$B$8:$AV$70`);
});

/**
 * ============================================================================
 * 🔴 **양식 넷 전부 · 본문 길이 여섯 가지** — 사이 한 줄 · 맺음 위아래 세 줄
 * ============================================================================
 * 위의 시험들은 **옛 양식 둘**만 연다. 그런데 운영이 실제로 쓰는 것은 2026-10-18
 * 에 갈라진 **넷**이고(매쳐·제너레이터 × 검사·수리), 넷이 같은 배치라는 보장은
 * 어디에도 없다 — 사람이 Excel 에서 한 장만 손보면 그날로 갈라진다(실제로 열
 * 너비가 그렇게 갈린 적이 있다).
 *
 * 🔴 **길이도 여러 가지로 잰다.** 한 가지만 재면 「늘 한 줄」과 「그 길이에서
 * 우연히 한 줄」이 안 갈린다. 그래서 짧은 것 · 옛 배정과 같은 수 · 넘치는 것 ·
 * 구역 하나가 빈 것을 함께 돌린다.
 *
 * 🔵 표본이 비어 공짜로 통과하는 것을 막으려고, 재기 전에 **무엇을 재는지**부터
 * 단언한다(그린 구역이 몇 개인가 · 본문이 32행에서 시작하는가).
 * ============================================================================
 */
const LAYOUT_TEMPLATES = [
  { name: "옛 검사", variable: "INSPECTION_REPORT_TEMPLATE_PATH", kind: "INSPECTION" },
  { name: "옛 수리", variable: "REPAIR_REPORT_TEMPLATE_PATH", kind: "REPAIR" },
  { name: "매쳐 검사", variable: "MATCHER_INSPECTION_REPORT_TEMPLATE_PATH", kind: "INSPECTION" },
  { name: "매쳐 수리", variable: "MATCHER_REPAIR_REPORT_TEMPLATE_PATH", kind: "REPAIR" },
  {
    name: "제너레이터 검사",
    variable: "GENERATOR_INSPECTION_REPORT_TEMPLATE_PATH",
    kind: "INSPECTION",
  },
  { name: "제너레이터 수리", variable: "GENERATOR_REPAIR_REPORT_TEMPLATE_PATH", kind: "REPAIR" },
] as const;

/**
 * 🔴 양식 넷이 모두 「확인내용 = 32행」이라고 말한다(실측 2026-10-31). 이 값은
 * 양식의 라벨 글상자에서 나오고(위 '본문이 시작하는 줄은 양식의 글상자를
 * 따라간다'), 여기서는 **넷이 같은 값인지**를 지킨다.
 */
const EXPECTED_BODY_START_ROW = 32;

const LAYOUT_SAMPLES = [
  { name: "아주 짧음 1/1/1", findings: 1, actions: 1, summary: 1 },
  { name: "짧음 2/2/1", findings: 2, actions: 2, summary: 1 },
  // 🔴 옛 설계에서 「확인내용 9줄 · 조치 10줄」이 배정된 자리를 딱 채우는 수였다.
  //    배정이 사라진 지금도 사이가 같은지 보는 표본이다.
  { name: "옛 배정과 같은 수 9/10/1", findings: 9, actions: 10, summary: 1 },
  // 🔴 양식의 29줄을 넘겨 줄이 끼워지는 쪽.
  { name: "넘침 20/12/8", findings: 20, actions: 12, summary: 8 },
  { name: "확인내용 없음 0/3/1", findings: 0, actions: 3, summary: 1 },
  { name: "조치 없음 4/0/2", findings: 4, actions: 0, summary: 2 },
] as const;

/**
 * 🔵 **표본 묶음이 쓸모 있는가** — 길이를 한 가지만 재면 「늘 한 줄」과 「그
 * 길이에서 우연히 한 줄」이 안 갈린다. 아래 시험들이 공짜로 통과하지 않도록
 * 묶음의 성질을 먼저 못 박는다.
 */
test("🔵 배치 표본 묶음 — 길이가 여러 가지이고 넘치는 것·비는 것이 들어 있다", () => {
  const repairSections = LAYOUT_SAMPLES.map((sample) => drawnSections("REPAIR", sample));
  // 구역 셋이 다 그려지는 표본이 둘 이상이고, 그 길이가 서로 다르다.
  const full = repairSections.filter((sections) => sections.length === 3);
  assert.ok(full.length >= 2, "구역 셋짜리 표본이 둘 미만이다");
  assert.ok(
    new Set(full.map((sections) => sections[0].lines.length)).size >= 2,
    "확인내용 길이가 한 가지뿐이다 — 「우연히 한 줄」과 안 갈린다"
  );
  // 라벨(두 줄)보다 짧은 구역과, 양식의 29줄을 넘기는 구역이 둘 다 있다.
  assert.ok(
    repairSections.some((sections) => sections[0]?.lines.length === 1),
    "내용이 라벨보다 짧은 표본이 없다"
  );
  assert.ok(
    repairSections.some(
      (sections) => sections.reduce((sum, section) => sum + section.lines.length, 0) > 29
    ),
    "양식의 줄 수를 넘기는 표본이 없다"
  );
  // 가운데 구역이 빈 것과 첫 구역이 빈 것이 둘 다 있다.
  assert.ok(
    LAYOUT_SAMPLES.some((sample) => sample.findings === 0),
    "첫 구역이 빈 표본이 없다"
  );
  assert.ok(
    LAYOUT_SAMPLES.some((sample) => sample.actions === 0),
    "가운데 구역이 빈 표본이 없다"
  );
});

/** 그 종류에서 **실제로 그려지는** 구역들 — 줄이 없는 구역은 통째로 빠진다. */
function drawnSections(
  kind: "INSPECTION" | "REPAIR",
  sample: (typeof LAYOUT_SAMPLES)[number]
): { labelLines: readonly string[]; lines: string[] }[] {
  const all = [
    { labelLines: SERVICE_REPORT_BODY_LABELS.findings, lines: bodyLines(sample.findings, "확인") },
    { labelLines: SERVICE_REPORT_BODY_LABELS.actions, lines: bodyLines(sample.actions, "조치") },
    // 🔴 「정리」는 수리 보고서에만 있다 — 검사에 넣으면 입력 검사가 던진다.
    {
      labelLines: SERVICE_REPORT_BODY_LABELS.summary,
      lines: kind === "REPAIR" ? bodyLines(sample.summary, "정리") : [],
    },
  ];
  return all.filter((section) => section.lines.length > 0);
}

for (const template of LAYOUT_TEMPLATES) {
  const templatePath = process.env[template.variable];
  const skip = templatePath ? false : `${template.variable} 가 설정되지 않았습니다`;

  for (const sample of LAYOUT_SAMPLES) {
    test(
      `🔴 단락 사이 한 줄 · 맺음 위아래 세 줄 — ${template.name} · ${sample.name}`,
      { skip },
      () => {
        const sections = drawnSections(template.kind, sample);
        // 🔵 무엇을 재는지 먼저 — 빈 표본으로 공짜 통과하지 않게.
        //    (구역이 하나뿐인 표본도 있다 — 검사 보고서의 「정리」는 아예 없고,
        //     구역 하나를 비운 표본이 그것과 겹치면 하나만 남는다. 그때는 사이를
        //     못 재는 대신 **본문이 어디서 시작하는지**와 맺음 여백을 잰다.
        //     묶음 전체가 쓸모 있는지는 아래 '표본 묶음' 시험이 따로 본다.)
        assert.ok(sections.length >= 1, "그릴 구역이 하나도 없는 표본이다");

        const base = template.kind === "REPAIR" ? REPAIR_INPUT : INSPECTION_INPUT;
        const filled = fill(templatePath as string, {
          ...base,
          body: {
            findingsIntro: "",
            findings: bodyLines(sample.findings, "확인"),
            actions: bodyLines(sample.actions, "조치"),
            ...(template.kind === "REPAIR"
              ? { summary: bodyLines(sample.summary, "정리") }
              : {}),
          },
        } as ServiceReportInput);

        // 31행은 비고 본문은 32행에서 시작한다 — 넷이 같은 값이어야 한다.
        assert.equal(filled.text("C31"), undefined, "31행에 라벨이 찍혔다");
        assert.equal(filled.text("H31"), undefined, "31행에 내용이 찍혔다");
        assert.equal(
          filled.text(`C${EXPECTED_BODY_START_ROW}`),
          sections[0].labelLines[0],
          `본문이 ${EXPECTED_BODY_START_ROW}행에서 시작하지 않는다`
        );

        let cursor = EXPECTED_BODY_START_ROW;
        sections.forEach((section, index) => {
          if (index > 0) {
            // 🔴 **사이는 딱 한 줄**이다 — 라벨도 내용도 없는 줄 하나.
            assert.equal(filled.text(`C${cursor}`), undefined, `${cursor}행(사이)에 라벨이 찍혔다`);
            assert.equal(filled.text(`H${cursor}`), undefined, `${cursor}행(사이)에 내용이 찍혔다`);
            cursor += 1;
          }
          section.labelLines.forEach((label, line) => {
            assert.equal(filled.text(`C${cursor + line}`), label, `${cursor + line}행의 라벨이 다르다`);
          });
          section.lines.forEach((text, line) => {
            assert.equal(filled.text(`H${cursor + line}`), text, `${cursor + line}행의 내용이 다르다`);
          });
          const rowCount = Math.max(section.lines.length, section.labelLines.length);
          // 라벨이 내용보다 길면 남는 줄은 빈다(확인내용 한 줄짜리의 `인　용` 줄).
          for (let line = section.lines.length; line < rowCount; line += 1) {
            assert.equal(filled.text(`H${cursor + line}`), undefined);
          }
          // 그리고 구역이 끝난 **바로 다음 줄**에 다음 구역이 오면 안 된다.
          cursor += rowCount;
        });

        // 🔴 맺음 표시 위는 빈 줄 셋.
        for (let gap = 0; gap < SERVICE_REPORT_CLOSING_GAP_ROWS; gap += 1) {
          assert.equal(filled.text(`H${cursor + gap}`), undefined, `맺음 표시 위 ${gap + 1}번째 줄이 안 비었다`);
          assert.equal(filled.text(`C${cursor + gap}`), undefined);
        }
        const closing = cursor + SERVICE_REPORT_CLOSING_GAP_ROWS;
        assertClosingMarkAt(filled, closing);
        assert.equal(SERVICE_REPORT_CLOSING_GAP_ROWS, 3, "맺음 표시 위가 세 줄이 아니다");

        /**
         * 🔴 맺음 표시 **아래 세 줄**에서 블록이 끝나고 비고가 바로 이어진다 —
         * 남는 줄을 걷어낸다는 것이 곧 이것이다. `assertSheetIsSound` 가 그
         * 사이를 재고, 여기서는 수를 한 번 더 못 박는다.
         */
        assert.equal(SERVICE_REPORT_CLOSING_TRAILING_ROWS, 3, "맺음 표시 아래가 세 줄이 아니다");
        assert.equal(
          remarkLabelRow(filled),
          closing + SERVICE_REPORT_CLOSING_TRAILING_ROWS + 1,
          "비고가 맺음 표시 아래 세 줄 자리에 안 붙었다"
        );
        assertSheetIsSound(filled);

        // 인쇄 영역도 블록과 함께 움직인다 — 안 따라가면 비고·도장이 잘린다.
        assert.equal(
          filled.printArea,
          `'${SERVICE_REPORT_SHEET_NAME}'!$B$8:$AV$${64 + bodyRowShiftOf(filled)}`
        );
      }
    );
  }
}

/**
 * ============================================================================
 * 🔴 **줄을 걷어낼 때 함께 따라오는 것들** (2026-10-31 · 양식 넷 전부)
 * ============================================================================
 * 늘리는 쪽(`growBodyBlock`)은 오래전부터 시험이 지키고 있었다. 줄이는 쪽은 이번에
 * 새로 생긴 길이고, **빠뜨리면 Excel 이 파일 열기를 거부하는 자리**가 둘 있다:
 * 지워진 줄의 병합이 남아 아래에서 올라온 병합과 겹치는 것, 그리고 어긋난 공유
 * 수식(`assertSheetIsSound` 가 본다).
 *
 * 여기서는 **병합 전체**를 양식에서 다시 셈해 견준다 — 시험이 제 셈으로
 * (지워질 줄의 것은 빼고 · 아래는 당겨서) 만든 목록과 한 글자까지 같아야 한다.
 * ============================================================================
 */
for (const template of LAYOUT_TEMPLATES) {
  const templatePath = process.env[template.variable];
  const skip = templatePath ? false : `${template.variable} 가 설정되지 않았습니다`;

  test(`🔴 줄을 걷어내도 병합·유효성·인쇄·도장이 함께 올라온다 — ${template.name}`, { skip }, () => {
    const path = templatePath as string;
    const templateSheet = templateSheetXml(path);
    const templateMerges = [...templateSheet.matchAll(/<mergeCell ref="([^"]+)"/g)].map((m) => m[1]);

    const base = template.kind === "REPAIR" ? REPAIR_INPUT : INSPECTION_INPUT;
    const filled = fill(path, {
      ...base,
      body: {
        findingsIntro: "",
        findings: ["확인 1", "확인 2"],
        actions: ["조치 1"],
        ...(template.kind === "REPAIR" ? { summary: ["정리 1"] } : {}),
      },
    } as ServiceReportInput);

    const shift = bodyRowShiftOf(filled);
    assert.ok(shift < 0, "이 표본은 줄이 걷혀야 한다 — 안 걷혔으면 잴 것이 없다");

    /**
     * 🔴 **시험이 제 셈으로 만든 병합 목록**과 견준다. 걷어낼 줄의 범위는
     * 「블록의 마지막 줄 바로 위에서 |shift| 줄」이다(`shrinkBodyBlock`).
     */
    const removedFirst = TEMPLATE_BODY_LAST_ROW + shift;
    const removedLast = TEMPLATE_BODY_LAST_ROW - 1;
    const pulled = (ref: string): string =>
      ref.replace(/([A-Z]+)(\d+)/g, (whole, column: string, row: string) =>
        Number(row) >= TEMPLATE_BODY_LAST_ROW ? `${column}${Number(row) + shift}` : whole
      );
    /**
     * 🔴 그리고 **맺음 표시 줄 하나만** `H:AU` 에서 `N:AU` 로 갈아 끼워진다
     * (2026-10-31 · 가로 3열 옮기기). **개수는 그대로다** — 이 목록 비교가 곧
     * 「병합이 늘지도 줄지도 않았다」의 증명이다.
     */
    const closing = closingMarkRow(filled);
    const expected = templateMerges
      .filter((ref) => {
        const rows = [...ref.matchAll(/[A-Z]+(\d+)/g)].map((m) => Number(m[1]));
        return !(Math.min(...rows) >= removedFirst && Math.max(...rows) <= removedLast);
      })
      .map(pulled)
      .map((ref) =>
        ref === `H${closing}:AU${closing}` ? `${TEMPLATE_CLOSING_COLUMN}${closing}:AU${closing}` : ref
      );
    assert.deepEqual([...filled.merges].sort(), [...expected].sort(), "병합이 셈과 다르다");
    assert.equal(
      filled.merges.length,
      expected.length,
      "병합 개수가 달라졌다 — 갈아 끼우는 것이지 더하는 것이 아니다"
    );
    assert.ok(expected.length < templateMerges.length, "걷어낸 줄의 병합이 하나도 안 빠졌다");

    // 비고·담당·승인·문서번호 — 이름을 짚어 한 번 더.
    for (const [before, after] of [
      ["C60:G63", `C${60 + shift}:G${63 + shift}`],
      ["AG61:AK63", `AG${61 + shift}:AK${63 + shift}`],
      ["AQ61:AU63", `AQ${61 + shift}:AU${63 + shift}`],
      ["C64:I64", `C${64 + shift}:I${64 + shift}`],
      ["D68:AS68", `D${68 + shift}:AS${68 + shift}`],
    ] as const) {
      assert.ok(filled.merges.includes(after), `${before} 이 ${after} 로 안 올라왔다`);
      assert.ok(!filled.merges.includes(before), `${before} 이 그대로 남았다`);
    }

    /**
     * 🔴 데이터 유효성 검사와 조건부 서식은 **하나도 안 움직여야 한다** — 이
     * 양식에서는 둘 다 본문(31행) **위**에 있다(유효성 5개 = 10~30행 · 조건부
     * 서식 5개 = 8~27행. 실측 2026-10-31). 글자째 견준다.
     */
    const block = (xml: string, tag: string): string =>
      (new RegExp(`<${tag}[\\s\\S]*?</${tag}>`).exec(xml) ?? [""])[0];
    for (const tag of ["dataValidations", "conditionalFormatting"]) {
      assert.ok(block(templateSheet, tag) !== "", `양식에 ${tag} 가 없다(시험 준비 실패)`);
      assert.equal(
        block(filled.sheetXml, tag),
        block(templateSheet, tag),
        `${tag} 가 달라졌다 — 본문 위에 있으므로 움직이면 안 된다`
      );
    }

    // 인쇄 영역 · dimension — 안 따라오면 비고와 도장이 인쇄에서 잘린다.
    assert.equal(filled.printArea, `'${SERVICE_REPORT_SHEET_NAME}'!$B$8:$AV$${64 + shift}`);
    assert.ok(
      new RegExp(`<dimension ref="B2:DD${117 + shift}"/>`).test(filled.sheetXml),
      "dimension 이 실제 행 수와 다르다"
    );

    /**
     * 🔴 도장 그림의 고정 행 — 안 당기면 표만 올라오고 도장은 제자리에 남는다.
     * 앵커의 행은 0부터 세므로 양식의 61~63행이 60~62 로 적혀 있다.
     */
    const anchors = [...filled.drawingXml.matchAll(/<xdr:row>(\d+)<\/xdr:row>/g)].map((m) =>
      Number(m[1])
    );
    assert.ok(anchors.includes(60 + shift), "도장이 안 올라왔다");
    assert.ok(!anchors.includes(60), "옛 자리의 도장 앵커가 남았다");
    // 단추 둘(2·6행 또는 2·3행)은 삽입 지점 위라 그대로다.
    assert.ok(anchors.includes(2), "단추가 움직였다");

    // 비고는 올라온 자리에 그대로 쓰인다.
    assert.equal(filled.text(`H${remarkLabelRow(filled)}`), "보증 기간 밖입니다.");
  });
}

/**
 * ============================================================================
 * 🔴 맺음 표시를 **가로로 세 열** 옮긴다 (2026-10-31 사용자 결정)
 * ============================================================================
 * 사용자: 「~이상~을 지금 위치보다 3열정도 우측에 위치하게 해줘.」
 *
 * 맺음 표시는 그 줄의 병합(`H:AU`) 안에서 **가운데 맞춤**이라, 보이는 자리는
 * 병합의 한가운데다. 그래서 왼쪽 끝을 **여섯 열** 당겨야 한가운데가 **세 열**
 * 오른쪽으로 간다 — 아래 첫 시험이 그 셈을 못 박는다(양식 없이 돈다).
 * ============================================================================
 */
test("🔴 맺음 표시의 열은 **가운데가 세 열** 오른쪽으로 가게 셈한다", () => {
  // 이 양식의 본문 칸은 `H`(8열)~`AU`(47열)다.
  const column = serviceReportClosingMarkColumn({ contentColumn: "H", contentEndColumn: "AU" });
  assert.equal(column, "N", "맺음 표시 열이 N 이 아니다");
  assert.equal(TEMPLATE_CLOSING_COLUMN, "N");

  /**
   * 🔴 **보이는 자리는 병합의 한가운데**다. 왼쪽 끝만 보고 「세 열 옮겼다」고
   * 하면 실제로는 1.5열만 간다 — 가운데로 재야 한다.
   */
  const middle = (start: string, end: string): number =>
    (columnNumberOf(start) + columnNumberOf(end)) / 2;
  assert.equal(middle("H", "AU"), 27.5);
  assert.equal(middle(column, "AU"), 30.5);
  assert.equal(
    middle(column, "AU") - middle("H", "AU"),
    SERVICE_REPORT_CLOSING_MARK_COLUMN_SHIFT,
    "가운데가 세 열 오른쪽으로 안 간다"
  );
  // 글자는 반드시 병합 **안**이다 — 밖이면 Excel 이 안 그린다.
  assert.ok(columnNumberOf(column) > columnNumberOf("H"));
  assert.ok(columnNumberOf(column) < columnNumberOf("AU"));

  // 본문 칸이 그만큼 넓지 않으면 짐작하지 않고 던진다.
  assert.throws(
    () => serviceReportClosingMarkColumn({ contentColumn: "H", contentEndColumn: "M" }),
    /맺음 표시를 3열 옮길 자리가 없습니다/
  );
});

/**
 * ============================================================================
 * 🔴 **화면이 쓰는 여백과 문서의 병합이 같은 자리인가** (2026-10-31 둘째 조각)
 * ============================================================================
 * 작성 화면의 미리보기는 양식 파일을 못 읽으니 맺음 표시의 여백을 **순수 셈**으로
 * 만든다(`serviceReportClosingMarkIndentWidth` — 전체 폭 × 6/40). 채우개는 같은
 * 자리를 **양식의 열 너비**로 만든다(병합을 `N:AU` 로 좁힌다).
 *
 * 🔴 둘이 **같은 수에 닿는지**를 양식 여섯 장에서 본다. 갈라지는 길은 하나뿐이다
 * — 본문 열의 너비가 고르지 않은 양식이 오는 날. 그날 이 시험이 먼저 깨진다.
 * ============================================================================
 */
for (const template of LAYOUT_TEMPLATES) {
  const templatePath = process.env[template.variable];
  const skip = templatePath ? false : `${template.variable} 가 설정되지 않았습니다`;

  test(`🔴 미리보기의 맺음 표시 여백이 양식에서 잰 폭과 같다 — ${template.name}`, { skip }, () => {
    const sheetXml = templateSheetXml(templatePath as string);
    const block = findBodyBlock(sheetXml);
    const widths = serviceReportColumnWidthsFromSheet(sheetXml);
    const metrics = serviceReportBodyMetrics(widths);

    // 🔵 재는 것이 있는지부터 — 이 양식의 본문은 `H:AU` 40열이다.
    assert.equal(block.contentColumn, "H");
    assert.equal(block.contentEndColumn, "AU");
    assert.equal(widths.bodyColumns, 40, "본문 열 수를 잘못 셌다");

    /**
     * 🔴 **문서 쪽 실측** — 전체 폭에서 `N:AU`(맺음 표시가 실제로 앉는 병합) 폭을
     * 뺀 것이 곧 앞에 비는 폭이다. 「N 의 바로 왼쪽」을 글자로 적지 않으려고
     * 이렇게 뺀다.
     */
    const markColumn = serviceReportClosingMarkColumn(block);
    const measured =
      widths.body - readColumnRangeWidth(sheetXml, markColumn, block.contentEndColumn);

    assert.equal(
      metrics.closingMarkIndentWidth,
      measured,
      "화면이 쓰는 여백과 문서의 병합이 다른 자리를 가리킨다"
    );
    // 그리고 그 여백은 **여섯 열**이다(= 옮길 세 열의 두 배).
    assert.equal(
      metrics.closingMarkIndentWidth / (widths.body / widths.bodyColumns),
      SERVICE_REPORT_CLOSING_MARK_COLUMN_SHIFT * 2
    );
  });
}

for (const template of LAYOUT_TEMPLATES) {
  const templatePath = process.env[template.variable];
  const skip = templatePath ? false : `${template.variable} 가 설정되지 않았습니다`;

  for (const sample of [
    { name: "짧음", findings: 2, actions: 2, summary: 1 },
    // 🔴 줄이 **늘어나는** 쪽도 본다 — 맺음 표시 줄이 복제된 새 줄일 때
    //    병합을 갈아 끼우는 것은 다른 갈래다.
    { name: "넘침", findings: 20, actions: 12, summary: 8 },
  ]) {
    test(`🔴 맺음 표시가 N 칸이고 옛 자리 H 는 비었다 — ${template.name} · ${sample.name}`, { skip }, () => {
      const base = template.kind === "REPAIR" ? REPAIR_INPUT : INSPECTION_INPUT;
      const filled = fill(templatePath as string, {
        ...base,
        body: {
          findingsIntro: "",
          findings: bodyLines(sample.findings, "확인"),
          actions: bodyLines(sample.actions, "조치"),
          ...(template.kind === "REPAIR" ? { summary: bodyLines(sample.summary, "정리") } : {}),
        },
      } as ServiceReportInput);

      const closing = closingMarkRow(filled);
      assert.ok(closing > 0, "맺음 표시를 찾지 못했다");

      // ① 글자가 N 칸에 있고 ② 옛 자리 H 는 **비어 있고** ③ 병합이 N:AU 다.
      assertClosingMarkAt(filled, closing);

      /**
       * 🔴 **병합 개수가 늘지 않았다** — 그 줄의 병합 수가 바로 윗줄(여느 빈
       * 본문 줄)과 같은지로 본다. `H:AU` 하나를 `N:AU` 하나로 **갈아 끼우는**
       * 것이지 더하는 것이 아니다.
       */
      const mergesOnRow = (row: number): string[] =>
        filled.merges.filter((ref) => {
          const found = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(ref);
          return found !== null && Number(found[2]) === row && Number(found[4]) === row;
        });
      assert.ok(mergesOnRow(closing).length > 0, "맺음 표시 줄에 병합이 하나도 없다");
      assert.equal(
        mergesOnRow(closing).length,
        mergesOnRow(closing - 1).length,
        `맺음 표시 줄의 병합 수가 윗줄과 다르다: ${mergesOnRow(closing).join(" ")}`
      );

      /**
       * 🔴 **왼쪽 여섯 칸은 글자가 없고**, 상자의 **왼쪽 변은 살아 있다.**
       * `H` 칸이 그 변을 들고 있어서(borderId = `start thin`), 서식을 건드리면
       * 그 줄만 상자가 열린다.
       */
      for (const column of ["H", "I", "J", "K", "L", "M"]) {
        assert.equal(
          filled.text(`${column}${closing}`),
          undefined,
          `${column}${closing} 에 글자가 들어갔다`
        );
      }
      const styles = filled.archive.readText(STYLES_PART);
      const original = ZipArchive.fromBuffer(readFileSync(templatePath as string));
      // 🔴 기대값을 적지 않고 **양식의 본문 줄에서 읽어** 견준다. 줄이 늘어난
      //    문서에서는 맺음 표시 줄이 복제된 줄이라 행 번호로는 못 맞춘다.
      const bodyLeftBorder = borderIdOf(
        original.readText(STYLES_PART),
        styleIndexOf(templateSheetXml(templatePath as string), "H45")
      );
      assert.notEqual(bodyLeftBorder, "0", "시험 준비 실패 — 양식의 본문 H 칸에 테두리가 없다");
      assert.equal(
        borderIdOf(styles, styleIndexOf(filled.sheetXml, `H${closing}`)),
        bodyLeftBorder,
        "맺음 표시 줄의 상자 왼쪽 변이 사라졌다"
      );

      /**
       * 🔴 맺음 표시 칸의 서식 — **가운데 맞춤이고 테두리가 없다.**
       * 테두리가 붙으면 문서 한가운데 세로줄이 생긴다(`H` 칸 서식을 베끼면
       * 실제로 그렇게 된다).
       */
      const markStyle = styleIndexOf(filled.sheetXml, `${TEMPLATE_CLOSING_COLUMN}${closing}`);
      assert.equal(horizontalOf(styles, markStyle), "center", "맺음 표시가 가운데가 아니다");
      assert.equal(borderIdOf(styles, markStyle), "0", "맺음 표시 칸에 테두리가 생겼다");

      // 🔵 세로 자리는 가로 이동과 **따로** 산다 — 아래 세 줄 규칙이 그대로다.
      assertSheetIsSound(filled);
    });
  }
}

/** 본문 줄들의 높이 — 채워진 문서에서 그대로 읽는다. */
function bodyRowHeights(sheetXml: string, lastRow: number): string[] {
  return parseSheetRows(sheetXml)
    .filter((row) => row.rowNumber >= TEMPLATE_BODY_FIRST_ROW && row.rowNumber <= lastRow)
    .map((row) => readRowHeightAttribute(row) ?? "(없음)");
}

/**
 * 그 중 **가장 많이 쓰인 높이**. 채우개가 고르는 것과 같은 규칙이다
 * (`normalizeBodyRowHeights` — 같은 수면 먼저 나온 쪽).
 *
 * 🔴 높이는 **글자 그대로** 센다. 숫자로 바꾸면 `75.599999999999994` 가
 * 반올림되어 양식에 적힌 글자와 달라진다.
 */
function modalRowHeight(heights: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const height of heights) counts.set(height, (counts.get(height) ?? 0) + 1);

  let mode = "";
  let most = -1;
  for (const [height, count] of counts) {
    if (count > most) {
      mode = height;
      most = count;
    }
  }
  return mode;
}

/**
 * 🔴 수리 양식의 46행만 유난히 높다(지금 75.65pt) — 그 발행본을 만든 사람이
 * 손으로 잡아 늘린 자국이고, 같은 통합문서인 검사 양식의 같은 행은 본문 높이
 * 그대로다. 그대로 두면 문서 한가운데 손가락만 한 구멍이 뚫리고 아래 구역
 * 계산도 뒤틀린다.
 *
 * 🔴 **지키는 것은 「고른가」이지 「몇 pt 인가」가 아니다.** 사용자가 Excel 에서
 * 셀 높이·글꼴을 손보면 본문 행 높이가 통째로 다시 적힌다(2026-10-18~19 에만
 * 14.1 → 14.15). 그래서 기대값을 적어 두지 않고 **양식의 최빈값을 읽어** 견준다
 * — 손자국 행은 여전히 걸린다(최빈값이 아니라서 통일 대상이 된다).
 */
test("🔴 채워진 문서의 본문에 손자국 행이 남지 않는다", { skip: skipRepair }, () => {
  const original = ZipArchive.fromBuffer(readFileSync(repairPath as string));
  const templateHeights = bodyRowHeights(
    original.readText(resolveSheetPart(original, SERVICE_REPORT_SHEET_NAME)),
    TEMPLATE_BODY_LAST_ROW
  );
  // 시험 준비 확인 — 양식에는 실제로 그 행이 있다.
  assert.ok(
    templateHeights.some((height) => Number(height) > 70),
    "양식의 본문에 늘어난 행이 없다(시험 준비 실패)"
  );

  // 양식이 정한 본문 행 높이. 손자국 행은 하나뿐이라 최빈값이 될 수 없다.
  const bodyHeight = modalRowHeight(templateHeights);
  assert.ok(
    Number(bodyHeight) < 70,
    `최빈값이 늘어난 행(${bodyHeight}pt)이다 — 양식의 본문이 손자국으로 뒤덮였다`
  );

  /**
   * 🔴 채워진 문서에서 **블록이 어디서 끝나는지는 그때그때 다르다**(2026-10-31):
   * 본문이 짧으면 줄을 걷어내 블록이 줄고, 길면 늘어난다. 그래서 양식의 59행을
   * 끝으로 삼으면 블록 밖(비고 15pt)까지 세어 "고르지 않다"가 된다 — 비고
   * 라벨의 바로 윗줄이 곧 블록의 끝이다.
   */
  const filled = fill(repairPath as string, REPAIR_INPUT);
  assert.deepEqual(
    [...new Set(bodyRowHeights(filled.sheetXml, remarkLabelRow(filled) - 1))],
    [bodyHeight],
    "본문 행 높이가 고르지 않다 — 양식의 최빈값으로 통일되어야 한다"
  );
  assert.ok(remarkLabelRow(filled) - 1 < TEMPLATE_BODY_LAST_ROW, "이 표본은 블록이 줄어야 한다");

  // 줄을 끼워 넣어도 마찬가지다. 새로 복제된 줄까지 같은 높이여야 한다.
  const grown = fill(repairPath as string, {
    ...REPAIR_INPUT,
    body: {
      findings: bodyLines(40, "확인"),
      findingsIntro: "",
      actions: bodyLines(10, "조치"),
      summary: bodyLines(10, "정리"),
    },
  });
  assert.ok(remarkLabelRow(grown) - 1 > TEMPLATE_BODY_LAST_ROW, "이 표본은 블록이 늘어야 한다");
  assert.deepEqual(
    [...new Set(bodyRowHeights(grown.sheetXml, remarkLabelRow(grown) - 1))],
    [bodyHeight],
    "늘린 줄의 높이가 다르다"
  );
});

/**
 * ============================================================================
 * 🔴 실제 양식으로 보는 "코드에 박지 않았다" — **글상자만 고치면 따라 움직인다**
 * ============================================================================
 * 예전에는 라벨 글상자의 **줄간격**을 본문 행 높이와 같게 바꿔(11pt → 14.1pt)
 * 「조치」가 44행, 「정리」가 57행으로 따라오는지를 봤다. 2026-10-31 부터 그 두
 * 구역은 글상자를 안 따라가므로(이어 붙는다) 그 단언은 뜻을 잃었다.
 *
 * 🔴 **대신 글상자의 앵커를 통째로 내린다.** 양식이 「본문은 여기서 시작한다」고
 * 말하는 자리가 그것이고, 지금도 그 한 값만은 양식에서 읽는다
 * (`readSectionStartRows` 의 첫 값 + `SERVICE_REPORT_FINDINGS_ROW_OFFSET`).
 * 앵커를 세 줄 내리면 본문 전체가 세 줄 내려와야 한다 — 32행을 코드에 박아
 * 두었다면 여기가 깨진다.
 * ============================================================================
 */
test("🔴 본문이 시작하는 줄은 양식의 글상자를 따라간다 — 실제 양식으로", { skip: skipRepair }, () => {
  const archive = ZipArchive.fromBuffer(readFileSync(repairPath as string));
  const drawing = archive.readText(TEMPLATE_DRAWING_PART);

  const anchors = [...drawing.matchAll(/<xdr:(twoCellAnchor|oneCellAnchor)[\s\S]*?<\/xdr:\1>/g)].map(
    (match) => match[0]
  );
  const label = anchors.find((anchor) => anchor.includes(SERVICE_REPORT_BODY_LABELS.findings[0]));
  assert.ok(label !== undefined, "양식에서 라벨 글상자를 찾지 못했다(시험 준비 실패)");

  // 🔴 `<xdr:from>` 의 행만 내린다. `<xdr:to>` 는 상자의 아래끝이라 읽지 않는다.
  const from = /<xdr:from>[\s\S]*?<\/xdr:from>/.exec(label);
  assert.ok(from !== null, "라벨 글상자의 앵커를 읽지 못했다(시험 준비 실패)");
  const anchorRow = Number(/<xdr:row>(\d+)<\/xdr:row>/.exec(from[0])?.[1]);
  // 앵커의 행은 0부터 센다 — 30 이 곧 31행이고, 거기에 발행본의 한 줄이 얹혀 32행이다.
  assert.equal(anchorRow, 30, "라벨 글상자의 앵커 행이 바뀌었다(시험 준비 실패)");

  const moved = label.replace(from[0], () =>
    from[0].replace(`<xdr:row>${anchorRow}</xdr:row>`, `<xdr:row>${anchorRow + 3}</xdr:row>`)
  );
  const entries = archive.list().map((name) => ({
    name,
    data:
      name === TEMPLATE_DRAWING_PART
        ? Buffer.from(drawing.replace(label, () => moved), "utf8")
        : (archive.readEntry(name) as Buffer),
  }));

  const changed = ZipArchive.fromBuffer(
    fillServiceReportWorkbook(writeZip(entries), REPAIR_INPUT)
  );
  const sheetXml = changed.readText(resolveSheetPart(changed, SERVICE_REPORT_SHEET_NAME));
  const read = createCellTextReader(sheetXml, changed.readTextOrNull(SHARED_STRINGS_PART));

  // 본문이 통째로 세 줄 내려왔다 — 32행이 아니라 35행에서 시작한다.
  assert.equal(read("C32"), null, "본문 시작 줄이 글상자를 안 따라갔다");
  assert.equal(read("C35"), SERVICE_REPORT_BODY_LABELS.findings[0]);
  assert.equal(read("C36"), SERVICE_REPORT_BODY_LABELS.findings[1]);
  // 아래 구역은 여전히 한 줄씩 띄워 이어진다 — 38 / 41행.
  assert.equal(read("C38"), SERVICE_REPORT_BODY_LABELS.actions[0]);
  assert.equal(read("C41"), SERVICE_REPORT_BODY_LABELS.summary[0]);
  // 정리 마지막 줄(41) → 빈 줄 셋(42·43·44) → 맺음 표시(45).
  assert.equal(read("H44"), null);
  // 맺음 표시는 본문 열이 아니라 그 오른쪽(`N`)이다 — 옛 자리는 비어 있다.
  assert.equal(read(`${TEMPLATE_CLOSING_COLUMN}45`), SERVICE_REPORT_CLOSING_MARK);
  assert.equal(read("H45"), null, "옛 자리에 맺음 표시가 남았다");
});

test("🔴 양식에 남아 있던 발행본 자료가 새 문서로 새지 않는다", { skip: skipRepair }, () => {
  const filled = fill(repairPath as string, {
    ...REPAIR_INPUT,
    customer: undefined,
    occurrencePlace: undefined,
    occurrencePlaceDetail: undefined,
    occurredOn: undefined,
    productName: undefined,
    productCategory: undefined,
    modelName: undefined,
    manufacturedYear: undefined,
    manufacturedMonth: undefined,
    lotNumber: undefined,
    serialNumber: undefined,
    usedYears: undefined,
    usedMonths: undefined,
    situation: undefined,
    causes: [],
    repairNumber: undefined,
    remark: undefined,
    reportNumber: { middle: "Q11A1", tail: "7788" },
    disposition: {},
  });

  // 양식 견본에 값이 들어 있던 칸들이 전부 비어야 한다.
  //
  // 🔴 `AK17`(발생 년월일)은 **이 목록에 없다.** 그 한 칸만 비우지 않고 양식이
  //    쓰던 자리표시를 남긴다 — 아래 전용 시험이 본다.
  for (const ref of [
    "H13", "H17", "X17", "H19", "H20", "V19", "AK19", "AP19",
    "H21", "H23", "AO21", "AO23", "AK25", "AP25",
    "H27", "H28", "X27", "AF27", "AQ27", "X28", "AF28", "AO28", "AN30", "H60",
  ]) {
    assert.equal(filled.text(ref), undefined, `${ref} 에 양식의 옛 값이 남았다`);
  }

  // 고객사 코드가 박혀 있던 자리도 우리 값으로 덮인다.
  assert.equal(filled.text(SERVICE_REPORT_CELLS.reportNumberPrefix), "No. ");
  assert.equal(filled.text(SERVICE_REPORT_CELLS.customerName), "테스트 반도체(주)");
});

/**
 * ============================================================================
 * 🔴 발생 년월일 — 비면 **자리표시가 남는다** (2026-10-18)
 * ============================================================================
 * 사용자 요구: 「발생 년월일이 비면 `-` 가 들어가도록」. 예전에는 값이 없으면
 * `clearCell` 이라 **아무것도 없이** 나갔다.
 *
 * 넣는 글자는 지어낸 것이 아니라 **양식에서 재서** 정했다 — 검사·수리 양식 두
 * 파일의 `AK17` 이 똑같이 `<f>"―――"</f>` 였다(2026-10-18 실측).
 * ============================================================================
 */
test("🔴 자리표시는 양식이 쓰던 글자 그대로다 — U+2015 세 자", () => {
  assert.deepEqual(
    [...SERVICE_REPORT_OCCURRED_ON_PLACEHOLDER].map((char) => char.codePointAt(0)),
    [0x2015, 0x2015, 0x2015],
    "양식의 AK17 은 `=\"―――\"`(U+2015 HORIZONTAL BAR 세 자)였다"
  );
});

test("🔴 발생 년월일을 안 적으면 그 칸에 자리표시가 남는다", { skip: skipRepair }, () => {
  const filled = fill(repairPath as string, { ...REPAIR_INPUT, occurredOn: undefined });
  assert.equal(
    filled.text(SERVICE_REPORT_CELLS.occurredOn),
    SERVICE_REPORT_OCCURRED_ON_PLACEHOLDER,
    "발생 년월일 칸이 빈 채로 나갔다"
  );

  /**
   * 🔴 양식의 수식(`="―――"`)을 그냥 두고 지나간 것이 아니라 **우리가 적은
   * 글자**다. 수식을 남기면 그 칸만 다른 길로 살아 있는 셈이 되고, 양식이
   * 바뀌는 날 조용히 다른 글자가 나간다.
   */
  const cell = /<c r="AK17"[^>]*>[\s\S]*?<\/c>/.exec(filled.sheetXml)?.[0];
  assert.ok(cell !== undefined, "AK17 셀이 사라졌다");
  assert.ok(cell.includes('t="inlineStr"'), `AK17 이 우리가 쓴 글자가 아니다: ${cell}`);
  assert.ok(!cell.includes("<f>"), `AK17 에 양식의 수식이 남았다: ${cell}`);

  assertSheetIsSound(filled);
});

test("🔴 빈 글자로 와도 같다 — 안 적은 것과 같은 자리표시", { skip: skipInspection }, () => {
  const filled = fill(inspectionPath as string, { ...INSPECTION_INPUT, occurredOn: "" });
  assert.equal(
    filled.text(SERVICE_REPORT_CELLS.occurredOn),
    SERVICE_REPORT_OCCURRED_ON_PLACEHOLDER
  );
});

test("🔴 적은 값이 있으면 그 값이 들어간다 — 날짜도 글자도", { skip: skipInspection }, () => {
  const dated = fill(inspectionPath as string, {
    ...INSPECTION_INPUT,
    occurredOn: new Date(2026, 7, 18),
  });
  assert.equal(dated.text(SERVICE_REPORT_CELLS.occurredOn), "2026-08-18");

  // 날짜를 모를 때 사람이 적는 글자는 그대로 간다 — 자리표시가 덮지 않는다.
  const written = fill(inspectionPath as string, {
    ...INSPECTION_INPUT,
    occurredOn: "2026년 7월경",
  });
  assert.equal(written.text(SERVICE_REPORT_CELLS.occurredOn), "2026년 7월경");
});

const bodyLines = (count: number, prefix: string): string[] =>
  Array.from({ length: count }, (_value, index) => `${prefix} ${index + 1}`);

test("줄을 안 늘리지도 줄이지도 않는 본문 — 양식의 29줄에 딱 찬다", { skip: skipRepair }, () => {
  /**
   * 빈 31행 + 확인내용 9(32~40) + 빈 줄(41) + 조치 8(42~49) + 빈 줄(50)
   * + 정리 2(51~52) + 🔴 맺음 표시 위의 빈 줄 셋(53·54·55) + 맺음 56
   * + 🔴 아래 빈 줄 셋(57·58·59) = 양식의 29줄에 딱 찬다.
   *
   * ⚠️ 2026-10-31 전에는 같은 자리를 「확인내용 9 · 조치 8 · 정리 4」로 채웠다.
   * 구역이 제자리에서 시작하느라 정리가 52행으로 밀려 있었고, 맺음 표시 위아래
   * 여백이 한 줄·두 줄이었기 때문이다. 지금은 여백이 셋·셋이라 **내용이 두 줄
   * 적어야** 딱 찬다 — 블록이 늘지도 줄지도 않는 유일한 지점이다.
   */
  const filled = fill(repairPath as string, {
    ...REPAIR_INPUT,
    body: {
      findings: bodyLines(9, "확인"),
      findingsIntro: "",
      actions: bodyLines(8, "조치"),
      summary: bodyLines(2, "정리"),
    },
  });
  assertSheetIsSound(filled, 0);

  assert.equal(filled.text("H32"), "확인 1");
  assert.equal(filled.text("H40"), "확인 9");
  assert.equal(filled.text("H41"), undefined, "구역 사이의 빈 줄이 없다");
  assert.equal(filled.text("C42"), SERVICE_REPORT_BODY_LABELS.actions[0]);
  assert.equal(filled.text("H49"), "조치 8");
  assert.equal(filled.text("H50"), undefined, "구역 사이의 빈 줄이 없다");
  assert.equal(filled.text("C51"), SERVICE_REPORT_BODY_LABELS.summary[0]);
  assert.equal(filled.text("H52"), "정리 2");
  for (const row of [53, 54, 55]) {
    assert.equal(filled.text(`H${row}`), undefined, `맺음 표시 위 ${row}행이 안 비었다`);
  }
  assertClosingMarkAt(filled, 56);
  // 🔴 아래 세 줄이 블록의 마지막 세 줄이다 — 딱 맞아서 줄이 안 끼워졌다.
  assert.equal(filled.text("H57"), undefined);
  assert.equal(filled.text("H58"), undefined);
  assert.equal(filled.text("H59"), undefined);

  // 아래 구역이 제자리에 있다. (라벨 뒤에는 양식의 후리가나가 딸려 온다.)
  assert.ok(filled.text("C60")?.startsWith("비　고"), "비고 라벨이 움직였다");
  assert.ok(filled.merges.includes("C60:G63"), "비고 병합이 움직였다");
  assert.equal(filled.printArea, `'${SERVICE_REPORT_SHEET_NAME}'!$B$8:$AV$64`);
  assert.ok(/<dimension ref="B2:DD117"\/>/.test(filled.sheetXml), "dimension 이 움직였다");
});

/**
 * 🔴 바로 위 시험에서 **정리를 딱 한 줄 늘린 것**이다. 맺음 표시가 57행으로
 * 내려가면 그 아래 세 줄 중 하나(60행)가 양식의 블록(~59행) 밖으로 나간다 —
 * 그때 여백을 잘라 내는 대신 **줄을 끼워 넣는다**.
 */
test("🔴 맺음 표시 아래 세 줄이 안 남으면 줄이 끼워진다 — 딱 한 줄 차이로", { skip: skipRepair }, () => {
  const filled = fill(repairPath as string, {
    ...REPAIR_INPUT,
    body: {
      findings: bodyLines(9, "확인"),
      findingsIntro: "",
      actions: bodyLines(8, "조치"),
      summary: bodyLines(3, "정리"),
    },
  });
  assertSheetIsSound(filled, 1);

  assert.equal(filled.text("H53"), "정리 3");
  for (const row of [54, 55, 56]) {
    assert.equal(filled.text(`H${row}`), undefined, `맺음 표시 위 ${row}행이 안 비었다`);
  }
  assertClosingMarkAt(filled, 57);
  assert.equal(filled.text("H58"), undefined);
  assert.equal(filled.text("H59"), undefined);
  assert.equal(filled.text("H60"), undefined);

  // 블록이 한 줄 커졌고, 아래 구역이 통째로 따라 내려갔다.
  assert.ok(filled.merges.includes("H59:AU59"), "끼워 넣은 줄에 내용 병합이 없다");
  assert.ok(filled.merges.includes("C61:G64"), "비고 병합이 안 내려갔다");
  assert.equal(filled.printArea, `'${SERVICE_REPORT_SHEET_NAME}'!$B$8:$AV$65`);
});

/**
 * 🔴 이 시험이 이 작업의 본체다. 줄이 늘어날 때 **함께 밀려야 하는 것 전부**를
 * 한 자리에서 본다 — 하나만 빠뜨려도 문서가 깨지고, 대개 인쇄해 보기 전까지
 * 아무도 모른다.
 */
for (const total of [40, 60]) {
  test(`본문 ${total}줄 — 던지지 않고 행이 늘어나며 아래가 통째로 내려간다`, { skip: skipRepair }, () => {
    const findings = bodyLines(total - 20, "확인");
    const filled = fill(repairPath as string, {
      ...REPAIR_INPUT,
      body: {
        findings,
        findingsIntro: "",
        actions: bodyLines(10, "조치"),
        summary: bodyLines(10, "정리"),
      },
    });

    // 빈 31행 + 본문 total 줄 + 🔴 구역 사이의 빈 줄 둘 + 🔴 맺음 표시 위의
    // 빈 줄 + 맺음 표시 한 줄 + 🔴 그 아래 두 줄.
    const shift =
      total +
      2 +
      2 * SERVICE_REPORT_SECTION_GAP_ROWS +
      SERVICE_REPORT_CLOSING_GAP_ROWS +
      SERVICE_REPORT_CLOSING_TRAILING_ROWS -
      TEMPLATE_BODY_CAPACITY;
    assertSheetIsSound(filled, shift);

    // 1) 본문 — 첫 줄·구역 라벨·마지막 줄·맺음 표시.
    assert.equal(filled.text("C31"), undefined, "31행에 라벨이 찍혔다");
    assert.equal(filled.text(`C${REPAIR_FINDINGS_ROW}`), SERVICE_REPORT_BODY_LABELS.findings[0]);
    assert.equal(filled.text("H32"), "확인 1");
    // 🔴 확인내용의 마지막 줄과 「조치」 사이에 빈 줄이 한 줄 있다.
    assert.equal(filled.text(`H${31 + findings.length}`), `확인 ${findings.length}`);
    assert.equal(filled.text(`H${32 + findings.length}`), undefined, "구역 사이의 빈 줄이 없다");
    assert.equal(filled.text(`C${33 + findings.length}`), SERVICE_REPORT_BODY_LABELS.actions[0]);
    assert.equal(filled.text(`C${44 + findings.length}`), SERVICE_REPORT_BODY_LABELS.summary[0]);
    assert.equal(filled.text(`H${33 + total}`), "정리 10");
    // 🔴 정리 마지막 줄 → 빈 줄 → 맺음 표시 → 빈 줄 둘. 아래 두 줄은 늘어난
    //    블록(~59+shift행) 안에 있어야 한다.
    assert.equal(filled.text(`H${34 + total}`), undefined, "맺음 표시 위의 빈 줄이 없다");
    const closingRow = 34 + total + SERVICE_REPORT_CLOSING_GAP_ROWS;
    assertClosingMarkAt(filled, closingRow);
    for (let index = 1; index <= SERVICE_REPORT_CLOSING_TRAILING_ROWS; index += 1) {
      assert.ok(
        closingRow + index <= TEMPLATE_BODY_LAST_ROW + shift,
        `맺음 표시 아래 ${index}번째 줄이 블록 밖이다`
      );
      assert.equal(filled.text(`H${closingRow + index}`), undefined);
    }

    /**
     * 2) 병합 — 새 줄에는 생기고, 아래 구역은 통째로 내려간다.
     *
     * ⚠️ **맺음 표시 줄만 다르다**: 그 줄의 내용 병합은 `H:AU` 가 아니라
     * `N:AU` 다(2026-10-31 · 가로 3열 옮기기). 끼워 넣을 때는 여느 줄처럼
     * `H:AU` 로 복제되고, 맨 마지막에 그 한 줄만 갈아 끼워진다.
     */
    for (let row = TEMPLATE_BODY_LAST_ROW; row < TEMPLATE_BODY_LAST_ROW + shift; row += 1) {
      assert.ok(filled.merges.includes(`C${row}:G${row}`), `${row}행에 라벨 병합이 없다`);
      const content = row === closingRow ? `${TEMPLATE_CLOSING_COLUMN}${row}:AU${row}` : `H${row}:AU${row}`;
      assert.ok(filled.merges.includes(content), `${row}행에 내용 병합(${content})이 없다`);
    }
    // 🔵 맺음 표시 줄이 정말 그 범위 안이어야 이 갈래가 돈 것이다.
    assert.ok(
      closingRow >= TEMPLATE_BODY_LAST_ROW && closingRow < TEMPLATE_BODY_LAST_ROW + shift,
      "맺음 표시가 끼워 넣은 줄 안에 없다 — 이 시험이 그 갈래를 안 지난다"
    );
    for (const [before, after] of [
      ["C60:G63", `C${60 + shift}:G${63 + shift}`], // 비고 라벨
      ["H60:AF60", `H${60 + shift}:AF${60 + shift}`], // 비고 첫 줄
      ["AG60:AK60", `AG${60 + shift}:AK${60 + shift}`], // 담당
      ["AQ61:AU63", `AQ${61 + shift}:AU${63 + shift}`], // 승인 도장 자리
      ["C64:I64", `C${64 + shift}:I${64 + shift}`], // 문서번호
      ["D68:AS68", `D${68 + shift}:AS${68 + shift}`],
    ] as const) {
      assert.ok(filled.merges.includes(after), `${before} 이 ${after} 로 안 내려갔다`);
      assert.ok(!filled.merges.includes(before), `${before} 이 그대로 남았다`);
    }

    // 3) 인쇄 영역 — 안 밀면 비고와 도장이 인쇄에서 잘린다.
    assert.equal(filled.printArea, `'${SERVICE_REPORT_SHEET_NAME}'!$B$8:$AV$${64 + shift}`);

    // 4) 도형·그림의 고정 행 — 안 밀면 표만 내려가고 도장은 제자리에 남는다.
    const anchors = [...filled.drawingXml.matchAll(/<xdr:row>(\d+)<\/xdr:row>/g)].map((m) =>
      Number(m[1])
    );
    // 단추 둘(2·6행)은 삽입 지점 위라 그대로, 도장 셋(60~62행)은 내려간다.
    assert.ok(anchors.includes(2) && anchors.includes(6), "단추가 움직였다");
    assert.ok(anchors.includes(60 + shift), "도장이 안 내려갔다");
    assert.ok(!anchors.includes(60), "옛 자리의 도장 앵커가 남았다");

    // 5) dimension.
    assert.ok(
      new RegExp(`<dimension ref="B2:DD${117 + shift}"/>`).test(filled.sheetXml),
      "dimension 이 실제 행 수와 다르다"
    );

    // 6) 비고는 여전히 자기 자리에 쓰인다.
    assert.equal(filled.text(`H${60 + shift}`), "보증 기간 밖입니다.");
    assert.ok(filled.text(`C${60 + shift}`)?.startsWith("비　고"), "비고 라벨이 안 내려갔다");
  });
}

test("🔴 폭을 넘는 긴 줄은 낱말을 자르지 않고 나뉜다", { skip: skipRepair }, () => {
  // 🔴 폭은 **그 양식**이 말한다 — 옛 양식 84칸 · 새 양식 85칸. 수를 적지 않는다.
  const wrapWidth = templateMetrics(repairPath as string).bodyWrapWidth;
  const long =
    "출력이 나오지 않는다는 연락을 받아 현지에서 확인한 결과 전원부 퓨즈가 단선되어 있었고 " +
    "정합기 연결부의 접촉 불량이 함께 발견되어 두 곳을 모두 손보았습니다.";
  const filled = fill(repairPath as string, {
    ...REPAIR_INPUT,
    body: { findings: [long], findingsIntro: "", actions: ["퓨즈 교체"], summary: [] },
  });

  // 「조치」 라벨이 붙은 줄이 곧 「확인내용」이 끝난 자리다.
  let actionsRow = 0;
  for (let row = 32; row <= 70; row += 1) {
    if (filled.text(`C${row}`) === SERVICE_REPORT_BODY_LABELS.actions[0]) {
      actionsRow = row;
      break;
    }
  }
  assert.ok(actionsRow > 0, "「조치」 구역을 찾지 못했다");

  const written: string[] = [];
  for (let row = REPAIR_FINDINGS_ROW; row < actionsRow; row += 1) {
    written.push(filled.text(`H${row}`) ?? "");
  }
  assert.ok(written.length > 1, "긴 줄이 나뉘지 않았다");
  for (const line of written) {
    assert.ok(textDisplayWidth(line) <= wrapWidth, `"${line}" 이 ${wrapWidth}칸을 넘는다`);
  }
  // 낱말을 자르지 않았으므로 공백만 빼면 원문 그대로다.
  assert.equal(written.join("").replace(/\s/gu, ""), long.replace(/\s/gu, ""));
});

/**
 * ============================================================================
 * 🔴 작성 화면의 미리보기와 채우개가 **같은 글을 같게 나눈다** (2026-10-18)
 * ============================================================================
 * 작성 화면이 적는 칸 옆에 「문서에서 어떻게 나올지」를 그린다
 * (`components/.../ServiceReportBodyPreview.tsx`). 규칙이 두 벌이 되면 화면이
 * 「여기서 나뉜다」고 그려 놓고 문서는 다르게 나누고, 그때 미리보기는
 * **거짓말**이 되어 없느니만 못하다.
 *
 * 그래서 나누는 함수는 한 벌이다(`domain/service-report-body-wrap.ts`). 아래
 * 시험은 그 「한 벌」을 **결과로** 못 박는다 — 화면이 부르는 함수의 결과와,
 * 실제 양식을 채워 만든 문서의 본문 칸에 **실제로 찍힌 글자**를 맞춰 본다.
 * 어느 한쪽만 고쳐지면 여기가 깨진다.
 * ============================================================================
 */

/**
 * 🔴 **짝맞춤을 돌릴 양식들** (2026-10-18 다섯째 조각).
 *
 * 전에는 옛 양식 하나로만 돌렸다. 그런데 사용자가 양식 넷에 **도장만 바꿔
 * 저장**했더니 Excel 이 열 너비를 다시 써서 본문 줄 폭이 84칸 → 85칸이 되었다 —
 * 그러니 이 조각의 증명은 「한 양식에서 맞는다」가 아니라 **「어떤 양식을 써도
 * 맞는다」**여야 한다. 설정 안 된 것은 건너뛴다(양식은 저장소에 두지 않는다).
 *
 * 🔴 **옛 양식도 남는다** — 새 설정이 비면 거기로 물러서므로
 * (`storage/service-report-template.ts` 의 '물러서기'), 물러선 동안에도 맞아야 한다.
 */
const PARITY_TEMPLATES = [
  { name: "옛 양식", variable: "REPAIR_REPORT_TEMPLATE_PATH" },
  { name: "매쳐 양식", variable: "MATCHER_REPAIR_REPORT_TEMPLATE_PATH" },
  { name: "제너레이터 양식", variable: "GENERATOR_REPAIR_REPORT_TEMPLATE_PATH" },
] as const;

/**
 * 그 양식이 말하는 칸 폭 한 벌.
 *
 * 🔴 **작성 화면이 쓰는 것과 똑같은 길**이다(`page.tsx` 와 같은 두 함수). 시험이
 * 따로 재면 「화면이 받는 값」이 아니라 「시험이 재는 값」을 보게 된다.
 */
function templateMetrics(templatePath: string) {
  return serviceReportBodyMetrics(readServiceReportColumnWidths(readFileSync(templatePath)));
}

/** 화면이 넘기는 모양 그대로 — 전부 지어낸 글이다. */
const PARITY_SAMPLES: readonly {
  name: string;
  findings: readonly string[];
  /**
   * 🔴 문서에서 몇 줄이 되는가 — **줄 폭마다 실측**이다.
   *
   * 수 하나로는 못 적는다. 폭이 바뀌면 나뉘는 자리가 바뀌기 때문이다(실측:
   * 「영숫자만」의 첫 줄이 딱 85칸이라 84칸 양식에서는 둘로 쪼개지고 85칸
   * 양식에서는 한 줄에 들어간다). 여기 없는 폭이면 아래의 **규칙**만 본다 —
   * 규칙은 폭을 안 타고, 「둘 다 안 나눈다」를 그것이 막는다.
   */
  rows: Readonly<Record<number, number>>;
}[] = [
  {
    name: "한글만 — 한 줄에 안 들어간다",
    rows: { 84: 3, 85: 3 },
    findings: [
      "출력이 나오지 않는다는 연락을 받아 현지에서 확인한 결과 전원부 퓨즈가 단선되어 있었고 " +
        "정합기 연결부의 접촉 불량이 함께 발견되었습니다.",
      "외관 손상 없음",
    ],
  },
  {
    // 🔴 첫 줄이 **딱 85칸**이다 — 두 양식에서 결과가 갈리는 자리를 일부러 둔다.
    name: "영숫자만 — 모델명·수치가 섞여 덩어리가 많다",
    rows: { 84: 3, 85: 2 },
    findings: [
      "RF-3000B 13.56MHz 30kW OUTPUT 0.0W REFLECT 0.0W DC-BUS 320V CTRL-BD REV2.1 SN 1234567",
      "FUSE 10A 250V x2 REPLACED 2026-10-18 TEST OK",
    ],
  },
  {
    name: "섞인 것 — 한글 문장 안에 모델명이 든다",
    rows: { 84: 2, 85: 2 },
    findings: [
      "13.56MHz 30kW 정합기(RF-3000B)의 출력단 AMP 기판에서 소손이 확인되어 기판을 교체하였고, " +
        "교체 후 DC-BUS 전압이 320V 로 정상 복귀하였습니다.",
    ],
  },
  {
    name: "아주 긴 한 줄 — 공백이 하나도 없다",
    rows: { 84: 2, 85: 2 },
    findings: [
      "출력이나오지않는다는연락을받아현지에서확인한결과전원부퓨즈가단선되어있었고정합기연결부의접촉불량이함께발견되어두곳을모두손보았습니다.이후출력을확인하였습니다.",
    ],
  },
  {
    name: "빈 줄이 섞인 것 — 사람이 사이를 띄운 줄은 그대로 남는다",
    rows: { 84: 5, 85: 5 },
    findings: ["1차 점검", "", "외관 손상 없음", "", "절연 저항 측정값 500MΩ 이상"],
  },
  {
    name: "🔴 연락서 낱말이 든 줄 — 문서에서 한글로 바뀐 뒤에 나뉜다",
    rows: { 84: 2, 85: 2 },
    findings: ["部品不良", "외관 손상 없음"],
  },
] as const;

for (const template of PARITY_TEMPLATES) {
  const templatePath = process.env[template.variable];
  const skip = templatePath ? false : `${template.variable} 가 설정되지 않았습니다`;

  for (const sample of PARITY_SAMPLES) {
    test(
      `🔴 미리보기와 문서가 같게 나뉜다 — ${template.name} · ${sample.name}`,
      { skip },
      () => {
        const path = templatePath as string;
        // 🔴 화면이 받는 바로 그 값으로 미리보기를 돌린다 — 시험이 따로 재지 않는다.
        const metrics = templateMetrics(path);

        const actions = ["퓨즈 교체"];
        const filled = fill(path, {
          ...REPAIR_INPUT,
          // 🔴 정형 문구는 비운다 — 「확인내용」에 **준 줄만** 들어가야 견줄 수 있다.
          body: { findings: sample.findings, findingsIntro: "", actions, summary: [] },
        });

        // 「조치」 라벨이 붙은 줄이 곧 「확인내용」이 끝난 자리다.
        let actionsRow = 0;
        for (let row = REPAIR_FINDINGS_ROW; row <= TEMPLATE_BODY_LAST_ROW + 40; row += 1) {
          if (filled.text(`C${row}`) === SERVICE_REPORT_BODY_LABELS.actions[0]) {
            actionsRow = row;
            break;
          }
        }
        assert.ok(actionsRow > 0, "「조치」 구역을 찾지 못했다");

        const written: string[] = [];
        for (let row = REPAIR_FINDINGS_ROW; row < actionsRow; row += 1) {
          written.push(filled.text(`H${row}`) ?? "");
        }
        /**
         * 🔴 **뒤쪽 빈 줄만** 걷어낸다. 「조치」는 양식이 정한 행에서 시작하므로
         * 확인내용이 짧으면 그 사이가 빈 채로 남는다 — 그것은 나누기의 결과가
         * 아니라 **행 배치**이고, 화면은 애초에 그리지 않는다. 가운데 빈 줄은
         * 사람이 넣은 줄이라 그대로 둔다.
         */
        while (written.length > 0 && written[written.length - 1] === "") written.pop();

        const preview = serviceReportBodyPreviewSections(
          { findingsIntro: "", findings: sample.findings, actions, summary: [] },
          metrics.bodyWrapWidth
        );
        assert.equal(preview[0]?.title, "확인내용");
        assert.deepEqual(preview[0]?.lines, written);

        /**
         * 🔴 **「둘 다 안 나눈다」로도 통과하는 것**을 여기서 막는다. 수를 하나
         * 적어 두는 대신 **규칙**으로 적는다 — 양식마다 줄 폭이 달라 수가
         * 갈리기 때문이다(「영숫자만」이 84칸에서 3줄, 85칸에서 2줄). 규칙은
         * 폭을 안 탄다.
         */
        const sourceLines = sample.findings.map(koreanKyosanDocumentText);
        const needsWrap = sourceLines.some(
          (line) => textDisplayWidth(line) > metrics.bodyWrapWidth
        );
        if (needsWrap) {
          assert.ok(
            written.length > sourceLines.length,
            `${metrics.bodyWrapWidth}칸을 넘는 줄이 있는데 ${written.length}줄뿐이다 — 안 나뉘었다`
          );
        } else {
          assert.equal(written.length, sourceLines.length, "안 넘치는데 줄이 늘었다");
        }
        // 그 폭의 실측을 적어 두었으면 수까지 못 박는다.
        const measured = sample.rows[metrics.bodyWrapWidth];
        if (measured !== undefined) assert.equal(written.length, measured);

        // 나뉜 줄은 하나도 칸을 넘지 않고, 낱말도 글자도 잃지 않았다.
        for (const line of written) {
          assert.ok(textDisplayWidth(line) <= metrics.bodyWrapWidth, `"${line}" 이 칸을 넘는다`);
        }
        assert.equal(
          written.join("").replace(/\s/gu, ""),
          sourceLines.join("").replace(/\s/gu, "")
        );
      }
    );
  }
}

/** `A`=1 … `AA`=27. 열 글자를 자리로 옮긴다. */
function columnNumberOf(letters: string): number {
  let value = 0;
  for (const letter of letters) value = value * 26 + (letter.charCodeAt(0) - 64);
  return value;
}

/**
 * 그 열을 덮고 있는 `<col …/>` 한 덩이 — 너비를 **양식에 적힌 글자 그대로**
 * 돌려준다. 숫자로 읽었다가 다시 적으면 지금은 운 좋게 같은 글자가 나오지만,
 * 양식이 `1.906250` · `1.9062500000001` 처럼 적어 두는 날 바꿔치기가 조용히
 * 빗나간다(아무것도 안 바뀐 채 시험만 통과한다).
 */
function columnTagCovering(sheetXml: string, letters: string): { tag: string; width: string } {
  const column = columnNumberOf(letters);
  for (const match of sheetXml.matchAll(/<col\s[^>]*\/>/g)) {
    const tag = match[0];
    const min = Number(/\smin="(\d+)"/.exec(tag)?.[1]);
    const max = Number(/\smax="(\d+)"/.exec(tag)?.[1]);
    const width = /\swidth="([\d.]+)"/.exec(tag)?.[1];
    if (width !== undefined && column >= min && column <= max) return { tag, width };
  }
  assert.fail(`${letters} 열의 <col> 을 양식에서 찾지 못했다`);
}

/**
 * ============================================================================
 * 🔴 **화면이 받는 폭이 채우개가 쓰는 폭과 같은 수인가** (2026-10-18 다섯째 조각)
 * ============================================================================
 * 전에 여기 있던 시험은 「양식의 칸 폭이 **화면이 들고 있는 상수**와 같다」였다.
 * 그 전제가 사라졌다 — 화면은 이제 상수를 안 들고 있고, 서버가 양식에서 읽어
 * 넘긴다. 그래서 볼 것이 바뀐다: **두 길이 같은 수에 닿는가.**
 *
 *   채우개  `fillSheet` 안에서 `contentWrapWidth(readColumnRangeWidth(…))`
 *   화면    `page.tsx` 에서 `serviceReportBodyMetrics(readServiceReportColumnWidths(…))`
 *
 * 둘이 갈라지면 미리보기가 거짓말을 한다. 짝맞춤 시험이 **결과로** 그것을 잡지만,
 * 여기서는 **셈 자체**를 맞춰 본다 — 어느 쪽이 틀렸는지 바로 보인다.
 * ============================================================================
 */
test("🔴 화면에 넘기는 칸 폭이 채우개가 재는 폭과 같다", { skip: skipRepair }, () => {
  const archive = ZipArchive.fromBuffer(readFileSync(repairPath as string));
  const sheetXml = archive.readText(resolveSheetPart(archive, SERVICE_REPORT_SHEET_NAME));
  const widths = readServiceReportColumnWidths(readFileSync(repairPath as string));

  // ① 본문 — 채우개가 줄을 나누기 전에 재는 **그 범위**와 같은 수여야 한다.
  const body = findBodyBlock(sheetXml);
  assert.equal(
    widths.body,
    readColumnRangeWidth(sheetXml, body.contentColumn, body.contentEndColumn)
  );
  assert.equal(
    serviceReportBodyMetrics(widths).bodyWrapWidth,
    contentWrapWidth(readColumnRangeWidth(sheetXml, body.contentColumn, body.contentEndColumn))
  );

  // ② 라벨 — 내용 열 **바로 왼쪽**까지. 한 열의 너비가 본문과 달라 곱으로 못 센다.
  assert.equal(body.labelColumn, "C");
  assert.equal(widths.label, readColumnRangeWidth(sheetXml, "C", "G"));
  assert.notEqual(widths.label, (widths.body / 40) * 5);

  // ③ 비고 — 「비　고」 병합과 첫 줄 병합이 알려 주는 범위.
  assert.ok(sheetXml.includes('<mergeCell ref="H60:AF60"/>'), "비고 칸의 병합이 바뀌었다");
  assert.equal(widths.remark, readColumnRangeWidth(sheetXml, "H", "AF"));

  /**
   * 🔴 그리고 **숫자가 코드에 안 박혀 있다.** 지금 어떤 수가 나오든 그것은 이
   * 파일이 아는 값이 아니라 **양식이 말한 값**이다 — 아래는 그 사실을 「양식이
   * 바뀌면 값도 바뀐다」로 확인한다.
   *
   * 🔴 바꿔 넣을 값도 **양식에서 읽어** 정한다. 전에는 「1.875 를 1.90625 로」
   * 라고 적어 두었는데, 사용자가 도장을 바꿔 저장하자 Excel 이 열 너비를 통째로
   * 다시 계산해 양식이 이미 1.90625 가 되었고 — 바꿀 것이 없어 시험이 죽었다
   * (2026-10-19). 지금 적힌 너비를 읽어 그 **두 배**로 바꾼다.
   */
  const bodyColumn = columnTagCovering(sheetXml, body.contentColumn);
  const resaved = sheetXml.replace(bodyColumn.tag, () =>
    bodyColumn.tag.replace(
      `width="${bodyColumn.width}"`,
      `width="${Number(bodyColumn.width) * 2}"`
    )
  );
  assert.notEqual(resaved, sheetXml, "본문 열 너비를 바꿔 보지 못했다 — 양식이 바뀌었다");
  const after = serviceReportColumnWidthsFromSheet(resaved);
  assert.ok(after.body > widths.body, "열 너비를 바꿨는데 폭이 안 따라갔다");
  assert.ok(after.remark > widths.remark, "비고 폭이 안 따라갔다");
  // 안 건드린 라벨 열(C~G)은 그대로다 — 바꾼 열만 따라온다.
  assert.equal(after.label, widths.label, "안 바꾼 라벨 폭까지 달라졌다");
});

test("비고는 여전히 양식의 줄 수를 넘을 수 없다", { skip: skipRepair }, () => {
  assert.throws(
    () =>
      fillServiceReportWorkbook(readFileSync(repairPath as string), {
        ...REPAIR_INPUT,
        remark: ["1", "2", "3", "4", "5"],
      }),
    /비고가 5줄인데 양식에는 4줄만/
  );
});

test("본문이 폭주하면 파일을 만들기 전에 멈춘다", { skip: skipRepair }, () => {
  assert.throws(
    () =>
      fillServiceReportWorkbook(readFileSync(repairPath as string), {
        ...REPAIR_INPUT,
        body: {
          findings: bodyLines(SERVICE_REPORT_MAX_BODY_ROWS + 1, "확인"),
          findingsIntro: "",
          actions: [],
          summary: [],
        },
      }),
    new RegExp(`${SERVICE_REPORT_MAX_BODY_ROWS}줄까지만`)
  );
});

// ── 「확인내용」 첫 줄의 정형 문구 ──────────────────────────────────────

/**
 * 🔴 정형 문구는 양식의 글상자에서 코드 포인트째 옮긴 것이다. 라벨·제목과 달리
 * **전각 문자가 하나도 없다** — 보통 공백(U+0020)과 마침표(U+002E)뿐이다.
 * 눈으로 베끼다 전각 공백이 한 칸 섞이면 화면으로는 구별되지 않고, 자간이
 * 달라진 문서가 그대로 고객사로 나간다. 여기서 코드 포인트로 못 박는다.
 */
test("🔴 정형 문구가 원본 양식과 코드 포인트까지 같다", () => {
  const codePoints = [...SERVICE_REPORT_FINDINGS_INTRO].map((char) =>
    char.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")
  );

  assert.equal(
    codePoints.join(" "),
    "C778 C218 D488 C5D0 0020 B300 D558 C5EC 0020 C774 D558 C758 0020 " +
      "D56D BAA9 C744 0020 D655 C778 D558 C600 C2B5 B2C8 B2E4 002E"
  );
  // 전각 공백(U+3000)도 전각 마침표(U+FF0E)도 섞이지 않았다.
  assert.ok(!SERVICE_REPORT_FINDINGS_INTRO.includes("　"), "전각 공백이 섞였다");
  assert.equal(SERVICE_REPORT_FINDINGS_INTRO.at(-1), ".");
});

/**
 * 🔴 「조치」·「정리」의 정형 문구는 **채우개가 모르는 글자**다.
 *
 * 확인내용의 문구와 달리 양식에 그런 글상자가 없고, 실제 발행본에서는 같은
 * 모양의 문장이 한 구역 안에 두 번 나온다 — 즉 구조가 아니라 본문의 한 줄이다.
 * 화면이 그것을 폼의 첫 줄로 미리 채우고, 채우개는 받은 줄을 그대로 적는다.
 */
test("🔴 조치·정리의 정형 문구는 문장 그대로이고, 채우개는 그것을 넣지 않는다", { skip: skipRepair }, () => {
  /**
   * 🔴 조치 문구는 **종류마다 시제가 다르다**(2026-09-02 사용자 결정) — 검사
   * 보고서는 앞으로 할 일을, 수리 보고서는 이미 한 일을 적는다.
   */
  assert.equal(SERVICE_REPORT_ACTIONS_INTRO.INSPECTION, "수리로써 이하의 작업을 실시합니다.");
  assert.equal(SERVICE_REPORT_ACTIONS_INTRO.REPAIR, "수리로써 이하의 작업을 실시하였습니다.");
  // ⚠️ 「정리」는 갈리지 않는다 — 그 구역 자체가 수리 보고서에만 있다.
  assert.equal(SERVICE_REPORT_SUMMARY_INTRO, "조치후, 이하의 항목을 확인하였습니다.");

  // 안 주면 안 들어간다 — `findingsIntro` 같은 「안 줌」 규칙이 아예 없다.
  const filled = fill(repairPath as string, {
    ...REPAIR_INPUT,
    body: { findings: ["확인 1"], findingsIntro: "", actions: ["조치 1"], summary: ["정리 1"] },
  });
  assert.ok(
    !filled.sheetXml.includes(SERVICE_REPORT_ACTIONS_INTRO.REPAIR),
    "채우개가 조치 문구를 넣었다"
  );
  assert.ok(!filled.sheetXml.includes(SERVICE_REPORT_SUMMARY_INTRO), "채우개가 정리 문구를 넣었다");

  // 줄로 넘기면 여느 본문 줄과 똑같이 그 자리에 적힌다 — 한 구역에 두 번도 된다.
  const twice = fill(repairPath as string, {
    ...REPAIR_INPUT,
    body: {
      findings: ["확인 1"],
      findingsIntro: "",
      actions: [
        SERVICE_REPORT_ACTIONS_INTRO.REPAIR,
        "• 휴즈 교환 : 8개",
        SERVICE_REPORT_ACTIONS_INTRO.REPAIR,
      ],
      summary: [SERVICE_REPORT_SUMMARY_INTRO],
    },
  });
  // 확인내용 32~33(라벨 두 줄) → 빈 34 → 조치 35~37 → 빈 38 → 정리 39.
  assert.equal(twice.text("H35"), SERVICE_REPORT_ACTIONS_INTRO.REPAIR);
  assert.equal(twice.text("H36"), "• 휴즈 교환 : 8개");
  assert.equal(twice.text("H37"), SERVICE_REPORT_ACTIONS_INTRO.REPAIR);
  assert.equal(twice.text("H39"), SERVICE_REPORT_SUMMARY_INTRO);
});

test("확인내용 첫 줄 — 안 주면 정형 문구가 들어간다", { skip: skipInspection }, () => {
  const filled = fill(inspectionPath as string, {
    ...INSPECTION_INPUT,
    // findingsIntro 를 아예 주지 않는다.
    body: { findings: ["외관 손상 없음", "전원부 퓨즈 단선 확인"], actions: ["퓨즈 교체"] },
  });
  assertSheetIsSound(filled);

  assert.equal(filled.text("H32"), SERVICE_REPORT_FINDINGS_INTRO);
  // 코드 포인트까지 — 문서에 실제로 찍힌 글자를 견준다.
  assert.equal(
    [...(filled.text("H32") ?? "")]
      .map((char) => char.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0"))
      .join(" "),
    "C778 C218 D488 C5D0 0020 B300 D558 C5EC 0020 C774 D558 C758 0020 " +
      "D56D BAA9 C744 0020 D655 C778 D558 C600 C2B5 B2C8 B2E4 002E"
  );

  // 그 아래로 사람이 적은 확인 항목이 이어진다. 라벨은 여전히 두 줄이다.
  assert.equal(filled.text("C32"), SERVICE_REPORT_BODY_LABELS.findings[0]);
  assert.equal(filled.text("C33"), SERVICE_REPORT_BODY_LABELS.findings[1]);
  assert.equal(filled.text("H33"), "외관 손상 없음");
  assert.equal(filled.text("H34"), "전원부 퓨즈 단선 확인");
  /**
   * 🔴 정형 문구가 한 줄을 먹으므로 「조치」가 그만큼 내려간다 — 32~34 + 빈 35 →
   * 36행. 2026-10-31 전에는 「조치」가 제자리(43행)라 문구가 자리를 안 흔들었다.
   */
  assert.equal(filled.text("H35"), undefined, "구역 사이의 빈 줄이 없다");
  assert.equal(filled.text("C36"), SERVICE_REPORT_BODY_LABELS.actions[0]);
  assert.equal(filled.text("H36"), "퓨즈 교체");
  for (const row of [37, 38, 39]) {
    assert.equal(filled.text(`H${row}`), undefined, `맺음 표시 위 ${row}행이 안 비었다`);
  }
  assertClosingMarkAt(filled, 40);
});

test("확인내용 첫 줄 — 다른 문장을 주면 그것이 들어간다", { skip: skipRepair }, () => {
  // 다른 고객사의 발행본에는 「…실시하였습니다.」 로 적힌 것이 있다.
  const other = "인수품에 대해 이하의 항목을 실시하였습니다.";
  const filled = fill(repairPath as string, {
    ...REPAIR_INPUT,
    body: {
      findings: ["외관 손상 없음"],
      findingsIntro: other,
      actions: ["퓨즈 교체"],
      summary: [],
    },
  });

  assert.equal(filled.text("H32"), other);
  assert.notEqual(filled.text("H32"), SERVICE_REPORT_FINDINGS_INTRO);
  assert.equal(filled.text("H33"), "외관 손상 없음");
  // 확인내용 32~33 → 빈 34 → 조치 35. 「정리」가 비었으므로 맺음 표시는 35 뒤
  // 빈 줄 셋(36·37·38)을 건너뛴 39행이다.
  assert.equal(filled.text("C35"), SERVICE_REPORT_BODY_LABELS.actions[0]);
  assert.equal(filled.text("H35"), "퓨즈 교체");
  for (const row of [36, 37, 38]) {
    assert.equal(filled.text(`H${row}`), undefined, `맺음 표시 위 ${row}행이 안 비었다`);
  }
  assertClosingMarkAt(filled, 39);
});

test("🔴 확인내용 첫 줄 — 명시적으로 비우면 안 들어간다", { skip: skipRepair }, () => {
  const filled = fill(repairPath as string, {
    ...REPAIR_INPUT,
    body: {
      findings: ["외관 손상 없음", "전원부 퓨즈 단선 확인"],
      findingsIntro: "",
      actions: ["퓨즈 교체"],
      summary: [],
    },
  });

  assert.equal(filled.text("H32"), "외관 손상 없음", "빈 문자열인데 정형 문구가 들어갔다");
  assert.equal(filled.text("H33"), "전원부 퓨즈 단선 확인");
  assert.ok(
    !filled.sheetXml.includes(SERVICE_REPORT_FINDINGS_INTRO),
    "시트 어디에도 정형 문구가 남으면 안 된다"
  );
});

test("확인내용이 비어 있으면 정형 문구만 남지 않는다", { skip: skipRepair }, () => {
  const filled = fill(repairPath as string, {
    ...REPAIR_INPUT,
    body: { findings: [], actions: ["퓨즈 교체"], summary: [] },
  });

  // 소개할 항목이 없으므로 「확인내용」 구역 자체가 없다 — 라벨도 문구도 없다.
  assert.equal(filled.text("C31"), undefined, "31행 빈 구역에 라벨이 찍혔다");
  assert.equal(filled.text("H31"), undefined, "31행 빈 구역에 내용이 찍혔다");
  assert.ok(
    !filled.sheetXml.includes(SERVICE_REPORT_BODY_LABELS.findings[0]),
    "쓰이지도 않은 「확인내용」 라벨이 찍혔다"
  );

  /**
   * 🔴 **2026-10-31 에 달라진 자리다.** 예전에는 「조치」가 제자리(41행)에서
   * 시작해 본문 위쪽 아홉 줄이 통째로 비었다 — 「위 구역이 비었다고 끌어올리지
   * 않는다」가 그때의 규칙이었다. 지금은 **본문이 시작하는 줄(32행)**이 곧 첫
   * 구역의 자리다. 쓰이지도 않은 구역 때문에 문서 위가 비는 쪽이, 사용자가
   * 없애 달라고 한 바로 그 빈 줄이다.
   */
  assert.equal(filled.text(`C${REPAIR_FINDINGS_ROW}`), SERVICE_REPORT_BODY_LABELS.actions[0]);
  assert.equal(filled.text("C32"), SERVICE_REPORT_BODY_LABELS.actions[0]);
  assert.equal(filled.text("H32"), "퓨즈 교체");
  assert.equal(filled.text("C41"), undefined, "「조치」가 옛 자리에도 찍혔다");
  for (const row of [33, 34, 35]) {
    assert.equal(filled.text(`H${row}`), undefined, `맺음 표시 위 ${row}행이 안 비었다`);
  }
  assertClosingMarkAt(filled, 36);
  assert.ok(!filled.sheetXml.includes(SERVICE_REPORT_FINDINGS_INTRO), "정형 문구만 남았다");
});

test("🔴 정형 문구도 폭을 넘으면 본문 줄과 같은 규칙으로 나뉜다", { skip: skipInspection }, () => {
  // 아래 문장은 본문 한 줄보다 길다. 🔴 폭은 **그 양식**이 말한다.
  const wrapWidth = templateMetrics(inspectionPath as string).bodyWrapWidth;
  const long =
    "인수품에 대하여 이하의 항목을 확인하였습니다. " +
    "아울러 반입 시 외관과 부속품 구성까지 함께 확인하였음을 알려 드립니다.";
  assert.ok(textDisplayWidth(long) > wrapWidth, "시험 준비 실패 — 문장이 한 줄에 들어간다");

  const filled = fill(inspectionPath as string, {
    ...INSPECTION_INPUT,
    body: { findings: ["외관 손상 없음"], findingsIntro: long, actions: ["퓨즈 교체"] },
  });

  // 「조치」 라벨이 붙은 줄이 곧 「확인내용」이 끝난 자리다.
  let actionsRow = 0;
  for (let row = 32; row <= 70; row += 1) {
    if (filled.text(`C${row}`) === SERVICE_REPORT_BODY_LABELS.actions[0]) {
      actionsRow = row;
      break;
    }
  }
  assert.ok(actionsRow > 0, "「조치」 구역을 찾지 못했다");

  const written: string[] = [];
  for (let row = INSPECTION_FINDINGS_ROW; row < actionsRow; row += 1) {
    written.push(filled.text(`H${row}`) ?? "");
  }
  assert.ok(written.length > 2, "정형 문구가 나뉘지 않았다");
  for (const line of written) {
    assert.ok(textDisplayWidth(line) <= wrapWidth, `"${line}" 이 ${wrapWidth}칸을 넘는다`);
  }
  // 낱말을 자르지 않았으므로 공백만 빼면 문구 + 확인 항목 그대로다.
  assert.equal(
    written.join("").replace(/\s/gu, ""),
    `${long}외관 손상 없음`.replace(/\s/gu, "")
  );
});

// ── 본문 내용 줄의 가로 맞춤 ────────────────────────────────────────────

/**
 * 🔴 이 시험이 왼쪽 맞춤 작업의 본체다.
 *
 * 검사·수리 두 양식은 본문에 **서로 다른 xf 번호**를 쓰고(실측: 수리 472/363/366,
 * 검사 381/354/357), 그 번호를 **본문 내용 칸과 라벨 칸이 함께** 쓴다. 그래서
 * "내용만 왼쪽으로" 는 새 서식을 더해야만 되고, 잘못하면 라벨까지 따라간다.
 */
for (const kind of [
  // closingRow — 구역이 한 줄씩 띄워 이어지고, 맺음 표시 위는 빈 줄 셋이다
  // (2026-10-31). 본문은 둘 다 「확인 1·확인 2」 + 「조치 1」(+ 수리는 「정리 1」).
  //   검사: (31행 빈 줄) 확인내용 32~33 · 빈 34 · 조치 35 · 빈 36·37·38 · 맺음 39
  //   수리: (31행 빈 줄) 확인내용 32~33 · 빈 34 · 조치 35 · 빈 36 · 정리 37 ·
  //         빈 38·39·40 · 맺음 41
  { name: "검사", path: () => inspectionPath, skip: () => skipInspection, input: INSPECTION_INPUT, closingRow: 39 },
  { name: "수리", path: () => repairPath, skip: () => skipRepair, input: REPAIR_INPUT, closingRow: 41 },
] as const) {
  test(`🔴 ${kind.name} 보고서 — 본문 내용 줄만 왼쪽 맞춤이 된다`, { skip: kind.skip() }, () => {
    const templatePath = kind.path() as string;
    const before = ZipArchive.fromBuffer(readFileSync(templatePath));
    const beforeStyles = before.readText(STYLES_PART);
    const beforeSheet = templateSheetXml(templatePath);

    const body =
      kind.input.kind === "REPAIR"
        ? { findings: ["확인 1", "확인 2"], findingsIntro: "", actions: ["조치 1"], summary: ["정리 1"] }
        : { findings: ["확인 1", "확인 2"], findingsIntro: "", actions: ["조치 1"] };
    const filled = fill(templatePath, { ...kind.input, body } as ServiceReportInput);
    assertSheetIsSound(filled);
    assertStylesOnlyGrew(before, filled);

    const afterStyles = filled.archive.readText(STYLES_PART);
    const closing = kind.closingRow;
    assertClosingMarkAt(filled, closing);

    // 1) 본문 내용 줄 — 왼쪽. 그리고 정렬 말고는 원본 그대로다.
    for (let row = 31; row < closing; row += 1) {
      const source = styleIndexOf(beforeSheet, `H${row}`);
      const target = styleIndexOf(filled.sheetXml, `H${row}`);
      assert.equal(horizontalOf(afterStyles, target), "left", `H${row} 이 왼쪽이 아니다`);
      assert.notEqual(target, source, `H${row} 이 양식의 서식을 그대로 쓴다`);
      assert.equal(
        borderIdOf(afterStyles, target),
        borderIdOf(beforeStyles, source),
        `H${row} 의 테두리가 달라졌다`
      );
      // 원본 xf 는 그대로 가운데 맞춤으로 남아 있다.
      assert.equal(horizontalOf(afterStyles, source), "center", `${source}번 원본 xf 가 바뀌었다`);
    }

    // 2) 🔴 맺음 표시 — 서식 번호가 양식 그대로다(가운데 맞춤 + 아래 테두리).
    assert.equal(
      styleIndexOf(filled.sheetXml, `H${closing}`),
      styleIndexOf(beforeSheet, `H${closing}`),
      "맺음 표시의 서식이 바뀌었다"
    );
    assert.equal(horizontalOf(afterStyles, styleIndexOf(filled.sheetXml, `H${closing}`)), "center");

    // 3) 🔴 왼쪽 라벨 — 본문 내용 칸과 같은 번호를 쓰지만 따라가면 안 된다.
    for (let row = 31; row <= closing; row += 1) {
      assert.equal(
        styleIndexOf(filled.sheetXml, `C${row}`),
        styleIndexOf(beforeSheet, `C${row}`),
        `C${row} 라벨의 서식이 바뀌었다`
      );
      assert.equal(
        horizontalOf(afterStyles, styleIndexOf(filled.sheetXml, `C${row}`)),
        "center",
        `C${row} 라벨이 가운데가 아니다`
      );
    }

    // 4) 머리 정보·체크칸 — 본문 위라 자리도 서식도 그대로다.
    for (const ref of ["C8", "C11", "AO8", "H13", "H21", "H27", "X28", "AN30"]) {
      assert.equal(
        styleIndexOf(filled.sheetXml, ref),
        styleIndexOf(beforeSheet, ref),
        `${ref} 의 서식이 바뀌었다`
      );
    }
    /**
     * 🔴 비고는 **자리가 움직인다**(블록이 줄어든 만큼 위로 올라온다) — 그래서
     * 양식의 60·61행을 채워진 문서의 같은 주소와 견주면 엉뚱한 칸을 본다
     * (2026-10-31 전에는 늘 60행이었다). 올라온 자리에서 견준다.
     */
    const remark = remarkLabelRow(filled);
    assert.ok(remark < TEMPLATE_REMARK_LABEL_ROW, "이 표본은 비고가 올라와야 한다");
    for (const index of [0, 1]) {
      assert.equal(
        styleIndexOf(filled.sheetXml, `H${remark + index}`),
        styleIndexOf(beforeSheet, `H${TEMPLATE_REMARK_LABEL_ROW + index}`),
        `비고 ${index + 1}번째 줄의 서식이 바뀌었다`
      );
    }
  });
}

test("🔴 줄을 늘려도 새 줄이 왼쪽이고 마지막 줄의 아래 테두리가 산다", { skip: skipRepair }, () => {
  const templatePath = repairPath as string;
  const before = ZipArchive.fromBuffer(readFileSync(templatePath));
  const beforeStyles = before.readText(STYLES_PART);
  const beforeSheet = templateSheetXml(templatePath);

  // 빈 31행 + 60줄 + 구역 사이의 빈 줄 둘 + 맺음 표시 위의 빈 줄 셋 + 맺음 표시
  // + 아래 빈 줄 셋 = 70줄. 양식은 29줄이라 41줄이 끼워 넣어진다.
  const total = 60;
  const shift =
    total +
    2 +
    2 * SERVICE_REPORT_SECTION_GAP_ROWS +
    SERVICE_REPORT_CLOSING_GAP_ROWS +
    SERVICE_REPORT_CLOSING_TRAILING_ROWS -
    TEMPLATE_BODY_CAPACITY;
  const filled = fill(templatePath, {
    ...REPAIR_INPUT,
    body: {
      findings: bodyLines(total - 20, "확인"),
      findingsIntro: "",
      actions: bodyLines(10, "조치"),
      summary: bodyLines(10, "정리"),
    },
  });
  assertSheetIsSound(filled, shift);
  assertStylesOnlyGrew(before, filled);

  const afterStyles = filled.archive.readText(STYLES_PART);
  // 97 — 31행이 비고, 구역 사이의 빈 줄 둘과 맺음 표시 위의 빈 줄 셋이 더 든다.
  const closingRow =
    32 + total + 2 * SERVICE_REPORT_SECTION_GAP_ROWS + SERVICE_REPORT_CLOSING_GAP_ROWS;
  assert.equal(closingRow, 97, "맺음 표시 자리가 셈과 다르다");
  assertClosingMarkAt(filled, closingRow);

  // 1) 복제된 새 줄도 왼쪽이고, 가운뎃줄의 테두리를 그대로 물려받았다.
  const middleSource = styleIndexOf(beforeSheet, "H58");
  for (const row of [31, 59, 60, 89, closingRow - 1]) {
    const target = styleIndexOf(filled.sheetXml, `H${row}`);
    assert.equal(horizontalOf(afterStyles, target), "left", `H${row} 이 왼쪽이 아니다`);
  }
  assert.equal(
    borderIdOf(afterStyles, styleIndexOf(filled.sheetXml, `H${closingRow - 1}`)),
    borderIdOf(beforeStyles, middleSource),
    "복제된 줄의 테두리가 가운뎃줄과 다르다"
  );

  /**
   * 2) 🔴 블록의 **마지막 줄**은 양식의 마지막 줄 서식 그대로다 — 상자의
   *    **아래 테두리**가 거기 걸려 있다.
   *
   *    ⚠️ 예전에는 그 줄이 곧 맺음 표시 줄이었다. 이제는 맺음 표시 아래로 두
   *    줄이 더 있으므로 **마지막 줄 ≠ 맺음 표시 줄**이다(맺음 표시 아래 두
   *    줄째가 마지막 줄이다). 맺음 표시 쪽은 복제된 가운뎃줄 서식을 쓰되
   *    **가운데 맞춤**이어야 한다 — 왼쪽 맞춤은 그 앞줄까지만 얹힌다.
   */
  const lastSource = styleIndexOf(beforeSheet, `H${TEMPLATE_BODY_LAST_ROW}`);
  const lastRow = TEMPLATE_BODY_LAST_ROW + shift;
  assert.equal(
    lastRow,
    closingRow + SERVICE_REPORT_CLOSING_TRAILING_ROWS,
    "맺음 표시 아래 두 줄이 블록 끝과 안 맞는다"
  );
  assert.equal(
    styleIndexOf(filled.sheetXml, `H${lastRow}`),
    lastSource,
    "마지막 줄의 서식이 바뀌었다 — 상자 밑변이 사라진다"
  );
  assert.equal(
    horizontalOf(afterStyles, styleIndexOf(filled.sheetXml, `H${closingRow}`)),
    "center",
    "맺음 표시가 왼쪽으로 갔다"
  );
  assert.equal(
    borderIdOf(afterStyles, styleIndexOf(filled.sheetXml, `H${closingRow}`)),
    borderIdOf(beforeStyles, middleSource),
    "맺음 표시 줄이 가운뎃줄 테두리를 안 물려받았다"
  );
  assert.notEqual(
    borderIdOf(beforeStyles, lastSource),
    borderIdOf(beforeStyles, middleSource),
    "시험 준비 실패 — 마지막 줄과 가운뎃줄의 테두리가 같다"
  );

  // 3) 라벨은 늘어난 줄에서도 그대로다.
  for (const row of [31, 59, 89, closingRow]) {
    assert.equal(
      horizontalOf(afterStyles, styleIndexOf(filled.sheetXml, `C${row}`)),
      "center",
      `C${row} 라벨이 가운데가 아니다`
    );
  }
});

test("같은 입력이면 같은 바이트가 나온다", { skip: skipInspection }, () => {
  const template = readFileSync(inspectionPath as string);
  const first = fillServiceReportWorkbook(template, INSPECTION_INPUT);
  const second = fillServiceReportWorkbook(template, INSPECTION_INPUT);
  assert.ok(first.equals(second), "같은 입력으로 다른 파일이 나왔다");
  // 원본 버퍼를 건드리지 않는다.
  assert.ok(template.equals(readFileSync(inspectionPath as string)), "원본 버퍼가 바뀌었다");
});

test("잘못된 입력은 파일을 만들기 전에 던진다", { skip: skipInspection }, () => {
  const template = readFileSync(inspectionPath as string);
  assert.throws(
    () => fillServiceReportWorkbook(template, { ...INSPECTION_INPUT, customerName: "" }),
    /고객사명이 비어 있습니다/
  );
});

test("양식이 바뀌어 라벨이 어긋나면 엉뚱한 칸을 채우는 대신 던진다", { skip: skipInspection }, () => {
  const archive = ZipArchive.fromBuffer(readFileSync(inspectionPath as string));
  const shared = archive.readText(SHARED_STRINGS_PART);
  // 「현지수리」 라벨의 공유문자열만 바꿔 양식이 바뀐 상황을 만든다.
  const broken = shared.replace("<t>현지수리</t>", "<t>다른항목</t>");
  assert.notEqual(broken, shared, "시험 준비가 실패했다 — 라벨 글자를 못 찾았다");

  const entries = archive.list().map((name) => ({
    name,
    data:
      name === SHARED_STRINGS_PART
        ? Buffer.from(broken, "utf8")
        : (archive.readEntry(name) as Buffer),
  }));

  assert.throws(
    () => fillServiceReportWorkbook(writeZip(entries), INSPECTION_INPUT),
    /양식이 바뀐 것 같습니다: J27/
  );
});

// ── 🔴 연락서 일본어가 문서에서 한글로 나온다 (2026-09-22) ─────────────────

/**
 * 🔴 「사전에 없는 일본어」 본보기 — **가짜 글자를 쓴다.**
 *
 * 2026-09-23 에 이 아래 시험이 깨졌다. 본보기로 `焼損・煙・異臭発生` 이라는 **실제
 * 연락서 문장**(실측 139줄)을 써 두었는데, 자유 기술 사전이 192줄로 자라면서 그
 * 글자가 **사전 안으로 들어왔기** 때문이다. 제품이 망가진 것이 아니라 본보기가
 * 낡은 것이었다.
 *
 * 실제 연락서 문장은 사전이 자랄 때마다 이 자리를 깨뜨린다. 41자 넘는 문장을
 * 가져다 쓰는 것도 안 된다 — 그 무리에는 고객사명·모델명이 박혀 있다
 * (`kyosan/report-free-text-lines.fixture.ts` 머리말). 그래서 **시험용임이 글자에서
 * 드러나는 가짜 일본어**를 쓴다.
 *
 * ⚠️ `kyosan/report-terms.test.ts` · `components/excel-imports/
 * KyosanReportImportParts.test.tsx` 와 **같은 글자**다. 파일마다 따로 지으면 다음에
 * 또 여기저기서 깨진다.
 */
const 사전에_없는_일본어 = "試験用ダミー故障";

/**
 * 🔴 **지킴이.** 다음 사람이 이 글자를 사전에 넣는 날 **여기서** 잡힌다 — 아래
 * 시험들이 엉뚱한 자리에서 깨지는 대신이다. 깨지면 사전을 되돌리지 말고
 * **본보기 글자를 바꿔라.**
 *
 * ⚠️ `translateKyosanTerm` 은 사전 **둘 다**(양식 · 자유 기술)를 지나는 문이다.
 * 한쪽만 보면 다른 쪽에 들어갔을 때 놓친다.
 */
test("🔴 본보기가 아직 사전 밖에 있다 — 들어갔으면 다른 글자로 바꿔라", () => {
  assert.equal(translateKyosanTerm(사전에_없는_일본어), null);
});

/**
 * ============================================================================
 * 🔴 문서는 **한글만** 찍는다 — 병기하지 않는다
 * ============================================================================
 * 사용자 결정(2026-09-22)이다. 화면은 한글 옆에 원문을 작게 함께 보이지만
 * (`components/kyosan/KyosanText.tsx`), 고객사로 나가는 종이에 두 나라 말이 섞여
 * 찍히면 안 된다.
 *
 * 못 박는 것은 다섯이다.
 *  1. 🔴 사전에 있는 줄은 **한글만** 나온다(`(現品引取)` 가 따라붙지 않는다).
 *  2. 🔴 사전에 없는 줄은 **원문 그대로** 나간다 — 억지로 채우거나 비우지 않는다
 *     (사용자가 「한글과 섞여 보일 수 있다」는 경고를 듣고 고른 것이다).
 *  3. 🔴 대괄호 머리글은 **우리가 붙인 한글 이름**이라 손대지 않는다.
 *  4. 🔴 빈 줄과 줄 자리가 그대로다 — 줄 통째로 바꾸므로 줄 수가 달라지지 않는다.
 *  5. 지나가는 칸은 **여러 줄 자유 기술만**이다 — 머리 칸(이름·번호)은 그대로.
 * ============================================================================
 */
test("🔴 연락서 고정 보기는 문서에서 한글로, 사전에 없는 줄은 원문 그대로", { skip: skipRepair }, () => {
  const filled = fill(repairPath as string, {
    ...REPAIR_INPUT,
    // 「상황」 아랫칸 — 신고 증상(`repair_cases.reported_symptom`)이 폼의
    // `situationDetail` 을 거쳐 문서에 들어오는 그 길이다.
    situation: { request: " ・수리의뢰", detail: "現品引取" },
    body: {
      findingsIntro: "",
      findings: [
        // 저장 쪽(`kyosan/report-detail-values.ts`)이 실제로 만드는 모양이다.
        "[교산 연락서]",
        "",
        "[처치(○ 표시)]",
        "現品引取",
        // 🔴 앞뒤 공백이 붙어 있어도 눌린 열쇠(NFKC+공백 제거)로 맞는다.
        "  交換無し  ",
        // 🔴 사전에 없는 자유 기술 — 원문 그대로 나간다.
        사전에_없는_일본어,
      ],
      actions: ["その他"],
      summary: ["処置完了"],
    },
    remark: ["再現せず", "기존 한글 줄은 그대로"],
  });
  assertSheetIsSound(filled);

  // 「상황」 아랫칸.
  assert.equal(filled.text(SERVICE_REPORT_CELLS.situationDetail), "현품 인수");

  // 확인내용 — 32행부터. 🔴 줄 자리가 하나도 밀리지 않았다.
  assert.equal(REPAIR_FINDINGS_ROW, 32, "수리 양식의 「확인내용」 자리가 바뀌었다");
  assert.equal(filled.text("H32"), "[교산 연락서]", "머리글이 번역됐다");
  assert.equal(filled.text("H33"), undefined, "빈 줄이 사라졌다");
  assert.equal(filled.text("H34"), "[처치(○ 표시)]", "머리글이 번역됐다");
  assert.equal(filled.text("H35"), "현품 인수");
  assert.equal(filled.text("H36"), "교체 없음");
  assert.equal(filled.text("H37"), 사전에_없는_일본어, "사전에 없는 줄이 손대졌다");

  /**
   * 조치 · 정리 · 비고도 같은 문을 지난다.
   *
   * ⚠️ 자리는 2026-10-31 부터 이어 붙은 자리다 — 확인내용 32~37 → 빈 38 →
   * 조치 39 → 빈 40 → 정리 41. 비고는 블록이 줄어든 만큼 올라오므로 **재어서**
   * 가리킨다(양식의 60행을 그대로 쓰면 엉뚱한 칸을 본다).
   */
  assert.equal(filled.text("H39"), "기타");
  assert.equal(filled.text("H41"), "조치 완료");
  const remark = remarkLabelRow(filled);
  assert.equal(filled.text(`H${remark}`), "재현 안됨");
  assert.equal(filled.text(`H${remark + 1}`), "기존 한글 줄은 그대로");

  // 🔴 머리 칸은 지나가지 않는다 — 이름·번호를 옮길 짝은 없다.
  assert.equal(filled.text(SERVICE_REPORT_CELLS.customerName), "테스트 반도체(주)");
  assert.equal(filled.text(SERVICE_REPORT_CELLS.modelName), "TEST300FH-AD1");
  // 「상황」 윗칸은 우리 양식의 드롭다운 값이라 손대지 않는다(앞 공백도 그대로).
  assert.equal(filled.text(SERVICE_REPORT_CELLS.situationRequest), " ・수리의뢰");
});

/**
 * 🔴 **번역이 줄 수를 바꾸지 않는다.** 줄 통째로 갈아 끼우므로 같은 줄 수여야
 * 하고, 그래야 화면이 미리 센 「남은 줄 수」와 문서가 어긋나지 않는다
 * (`domain/service-report-form.ts` 의 `countServiceReportBodyRows`).
 */
test("🔴 번역해도 줄 자리가 그대로다 — 일본어 판과 한글 판의 줄 수가 같다", { skip: skipRepair }, () => {
  const lines = ["現品引取", "交換無し", 사전에_없는_일본어];
  const japanese = fill(repairPath as string, {
    ...REPAIR_INPUT,
    body: { findingsIntro: "", findings: lines, actions: ["その他"], summary: ["処置完了"] },
  });
  const korean = fill(repairPath as string, {
    ...REPAIR_INPUT,
    body: {
      findingsIntro: "",
      findings: ["현품 인수", "교체 없음", 사전에_없는_일본어],
      actions: ["기타"],
      summary: ["조치 완료"],
    },
  });

  for (let row = REPAIR_FINDINGS_ROW; row <= REPAIR_SUMMARY_ROW; row += 1) {
    assert.equal(
      japanese.text(`H${row}`),
      korean.text(`H${row}`),
      `H${row} 이 일본어 판과 한글 판에서 다르다`
    );
  }
});
