import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { ZipArchive } from "./zip-reader";
import { writeZip } from "./zip-writer";
import { createCellTextReader } from "./sheet-text";
import {
  resolveSheetPart,
  SHARED_STRINGS_PART,
  STYLES_PART,
  WORKBOOK_PART,
} from "./workbook-parts";
import { textDisplayWidth } from "@/lib/domain/text-wrap";
import {
  clearDrawingTextInRows,
  fillServiceReportWorkbook,
  findBodyBlock,
  findLabelledBlock,
  readColumnRangeWidth,
  SERVICE_REPORT_BODY_LABELS,
  SERVICE_REPORT_CELLS,
  SERVICE_REPORT_CHECK_MARK,
  SERVICE_REPORT_CLOSING_MARK,
  SERVICE_REPORT_FINDINGS_INTRO,
  SERVICE_REPORT_MAX_BODY_ROWS,
  SERVICE_REPORT_SHEET_NAME,
  SERVICE_REPORT_TITLES,
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
  assert.throws(
    () =>
      validateServiceReportInput({
        ...INSPECTION_INPUT,
        reportNumber: { ...INSPECTION_INPUT.reportNumber, middle: "" },
      }),
    /보고서 번호\(중간\)/
  );
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

/**
 * 종류가 무엇이든 문서가 깨지지 않았는지는 늘 같은 방식으로 본다.
 *
 * @param rowShift 끼워 넣은 줄 수. 0이면 양식과 줄 수가 같아야 한다.
 */
function assertSheetIsSound(filled: Filled, rowShift = 0): void {
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
   *  · 줄을 안 늘렸으면 양식의 공유 수식이 **그대로** 있어야 한다.
   *  · 늘렸으면 공유 수식이 **하나도 남으면 안 되고**, 모든 본문 줄에 제 줄을
   *    가리키는 보통 수식이 있어야 한다.
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
      "줄을 늘렸는데 어긋난 공유 수식이 남았다"
    );
    for (let row = TEMPLATE_BODY_FIRST_ROW; row <= bodyLastRow; row += 1) {
      assert.ok(
        new RegExp(`<c r="BC${row}"[^>]*><f>LEN\\(H${row}\\)</f></c>`).test(filled.sheetXml),
        `BC${row} 의 글자수 도우미가 제 줄을 세지 않는다`
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

  // 본문 — 🔴 「확인내용」 라벨은 원본처럼 **두 줄**이다.
  assert.equal(filled.text("C31"), SERVICE_REPORT_BODY_LABELS.findings[0]);
  assert.equal(filled.text("C32"), SERVICE_REPORT_BODY_LABELS.findings[1]);
  assert.equal(filled.text("H31"), "외관 손상 없음");
  assert.equal(filled.text("H32"), "전원부 퓨즈 단선 확인");
  assert.equal(filled.text("C33"), SERVICE_REPORT_BODY_LABELS.actions[0]);
  assert.equal(filled.text("C34"), undefined, "「조치」 라벨이 두 줄에 찍혔다");
  assert.equal(filled.text("H33"), "퓨즈 교체");
  assert.equal(filled.text("H34"), "정격 출력 시험 통과");
  // 맺음 표시는 본문 마지막 줄의 바로 다음 줄.
  assert.equal(filled.text("H35"), SERVICE_REPORT_CLOSING_MARK);
  // 🔴 정리는 검사 보고서에 없다.
  assert.equal(filled.text("C35"), undefined);
  assert.equal(filled.text("H36"), undefined);
  assert.equal(filled.text("H59"), undefined);

  // 비고.
  assert.equal(filled.text("H60"), "보증 기간 밖입니다.");
  assert.equal(filled.text("H61"), "부품은 재고분을 썼습니다.");
  assert.equal(filled.text("H62"), undefined);

  assertUntouchedParts(inspectionPath as string, filled);
});

test("수리 보고서: 제목·조치 완료·정리가 이 종류에만 들어간다", { skip: skipRepair }, () => {
  const filled = fill(repairPath as string, REPAIR_INPUT);
  assertSheetIsSound(filled);

  assert.equal(filled.text(SERVICE_REPORT_CELLS.title), "수　리　보　고　서");
  assert.equal(filled.text(SERVICE_REPORT_CELLS.title), SERVICE_REPORT_TITLES.REPAIR);

  // 🔴 검사 보고서에는 없던 둘.
  assert.equal(filled.text("X28"), SERVICE_REPORT_CHECK_MARK, "조치 완료가 안 찍혔다");
  assert.equal(filled.text(SERVICE_REPORT_CELLS.completedOn), "2026-09-01");

  // 「정리」가 「조치」 다음 줄에.
  assert.equal(filled.text("C31"), SERVICE_REPORT_BODY_LABELS.findings[0]);
  assert.equal(filled.text("C32"), SERVICE_REPORT_BODY_LABELS.findings[1]);
  assert.equal(filled.text("C33"), SERVICE_REPORT_BODY_LABELS.actions[0]);
  assert.equal(filled.text("C35"), SERVICE_REPORT_BODY_LABELS.summary[0]);
  assert.equal(filled.text("H35"), "같은 증상 재발 시 전원부 전체 점검을 권합니다.");
  assert.equal(filled.text("H36"), SERVICE_REPORT_CLOSING_MARK);
  assert.equal(filled.text("H37"), undefined);

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
  assert.equal(filled.text("C31"), "확　내");
  assert.equal(filled.text("C32"), "인　용");
  assert.equal(filled.text("C33"), "조  치");
  assert.equal(filled.text("C35"), "정  리");
  assert.equal(filled.text("H36"), SERVICE_REPORT_CLOSING_MARK);
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
  assert.equal(filled.text("C31"), SERVICE_REPORT_BODY_LABELS.findings[0]);
  assert.equal(filled.text("C32"), SERVICE_REPORT_BODY_LABELS.findings[1]);
  // 내용은 첫 줄부터 채우므로 둘째 줄은 빈다.
  assert.equal(filled.text("H31"), "외관 손상 없음");
  assert.equal(filled.text("H32"), undefined, "내용이 라벨을 따라 밀렸다");

  // 🔴 다음 구역은 라벨이 끝난 **다음** 줄에서 시작한다 — 안 그러면
  //    「조치」 라벨이 `인　용` 을 덮어 「확인내용」이 반쪽으로 찍힌다.
  assert.equal(filled.text("C33"), SERVICE_REPORT_BODY_LABELS.actions[0]);
  assert.equal(filled.text("H33"), "퓨즈 교체");
  assert.equal(filled.text("C34"), SERVICE_REPORT_BODY_LABELS.summary[0]);
  assert.equal(filled.text("H34"), "재발 시 연락 바랍니다.");
  assert.equal(filled.text("H35"), SERVICE_REPORT_CLOSING_MARK);
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
  for (const ref of [
    "H13", "H17", "X17", "AK17", "H19", "H20", "V19", "AK19", "AP19",
    "H21", "H23", "AO21", "AO23", "AK25", "AP25",
    "H27", "H28", "X27", "AF27", "AQ27", "X28", "AF28", "AO28", "AN30", "H60",
  ]) {
    assert.equal(filled.text(ref), undefined, `${ref} 에 양식의 옛 값이 남았다`);
  }

  // 고객사 코드가 박혀 있던 자리도 우리 값으로 덮인다.
  assert.equal(filled.text(SERVICE_REPORT_CELLS.reportNumberPrefix), "No. ");
  assert.equal(filled.text(SERVICE_REPORT_CELLS.customerName), "테스트 반도체(주)");
});

const bodyLines = (count: number, prefix: string): string[] =>
  Array.from({ length: count }, (_value, index) => `${prefix} ${index + 1}`);

test("줄을 안 늘려도 되는 본문은 양식의 줄 수 그대로 나온다", { skip: skipRepair }, () => {
  // 28줄 + 맺음 표시 한 줄 = 양식의 29줄에 딱 찬다.
  const filled = fill(repairPath as string, {
    ...REPAIR_INPUT,
    body: {
      findings: bodyLines(10, "확인"),
      findingsIntro: "",
      actions: bodyLines(10, "조치"),
      summary: bodyLines(8, "정리"),
    },
  });
  assertSheetIsSound(filled, 0);

  assert.equal(filled.text("H31"), "확인 1");
  assert.equal(filled.text("C41"), SERVICE_REPORT_BODY_LABELS.actions[0]);
  assert.equal(filled.text("C51"), SERVICE_REPORT_BODY_LABELS.summary[0]);
  assert.equal(filled.text("H58"), "정리 8");
  assert.equal(filled.text("H59"), SERVICE_REPORT_CLOSING_MARK);

  // 아래 구역이 제자리에 있다. (라벨 뒤에는 양식의 후리가나가 딸려 온다.)
  assert.ok(filled.text("C60")?.startsWith("비　고"), "비고 라벨이 움직였다");
  assert.ok(filled.merges.includes("C60:G63"), "비고 병합이 움직였다");
  assert.equal(filled.printArea, `'${SERVICE_REPORT_SHEET_NAME}'!$B$8:$AV$64`);
  assert.ok(/<dimension ref="B2:DD117"\/>/.test(filled.sheetXml), "dimension 이 움직였다");
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

    // 본문 total 줄 + 맺음 표시 한 줄이 필요하다.
    const shift = total + 1 - TEMPLATE_BODY_CAPACITY;
    assertSheetIsSound(filled, shift);

    // 1) 본문 — 첫 줄·구역 라벨·마지막 줄·맺음 표시.
    assert.equal(filled.text("C31"), SERVICE_REPORT_BODY_LABELS.findings[0]);
    assert.equal(filled.text("H31"), "확인 1");
    assert.equal(filled.text(`C${31 + findings.length}`), SERVICE_REPORT_BODY_LABELS.actions[0]);
    assert.equal(filled.text(`C${41 + findings.length}`), SERVICE_REPORT_BODY_LABELS.summary[0]);
    assert.equal(filled.text(`H${30 + total}`), "정리 10");
    assert.equal(filled.text(`H${31 + total}`), SERVICE_REPORT_CLOSING_MARK);

    // 2) 병합 — 새 줄에는 생기고, 아래 구역은 통째로 내려간다.
    for (let row = TEMPLATE_BODY_LAST_ROW; row < TEMPLATE_BODY_LAST_ROW + shift; row += 1) {
      assert.ok(filled.merges.includes(`C${row}:G${row}`), `${row}행에 라벨 병합이 없다`);
      assert.ok(filled.merges.includes(`H${row}:AU${row}`), `${row}행에 내용 병합이 없다`);
    }
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
  // H~AU 40열 × 1.875 = 75칸. 한글 38자면 76칸이라 한 줄에 못 들어간다.
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
  for (let row = 31; row < actionsRow; row += 1) written.push(filled.text(`H${row}`) ?? "");
  assert.ok(written.length > 1, "긴 줄이 나뉘지 않았다");
  for (const line of written) {
    assert.ok(textDisplayWidth(line) <= 75, `"${line}" 이 75칸을 넘는다`);
  }
  // 낱말을 자르지 않았으므로 공백만 빼면 원문 그대로다.
  assert.equal(written.join("").replace(/\s/gu, ""), long.replace(/\s/gu, ""));
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

test("확인내용 첫 줄 — 안 주면 정형 문구가 들어간다", { skip: skipInspection }, () => {
  const filled = fill(inspectionPath as string, {
    ...INSPECTION_INPUT,
    // findingsIntro 를 아예 주지 않는다.
    body: { findings: ["외관 손상 없음", "전원부 퓨즈 단선 확인"], actions: ["퓨즈 교체"] },
  });
  assertSheetIsSound(filled);

  assert.equal(filled.text("H31"), SERVICE_REPORT_FINDINGS_INTRO);
  // 코드 포인트까지 — 문서에 실제로 찍힌 글자를 견준다.
  assert.equal(
    [...(filled.text("H31") ?? "")]
      .map((char) => char.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0"))
      .join(" "),
    "C778 C218 D488 C5D0 0020 B300 D558 C5EC 0020 C774 D558 C758 0020 " +
      "D56D BAA9 C744 0020 D655 C778 D558 C600 C2B5 B2C8 B2E4 002E"
  );

  // 그 아래로 사람이 적은 확인 항목이 이어진다. 라벨은 여전히 두 줄이다.
  assert.equal(filled.text("C31"), SERVICE_REPORT_BODY_LABELS.findings[0]);
  assert.equal(filled.text("C32"), SERVICE_REPORT_BODY_LABELS.findings[1]);
  assert.equal(filled.text("H32"), "외관 손상 없음");
  assert.equal(filled.text("H33"), "전원부 퓨즈 단선 확인");
  assert.equal(filled.text("C34"), SERVICE_REPORT_BODY_LABELS.actions[0]);
  assert.equal(filled.text("H34"), "퓨즈 교체");
  assert.equal(filled.text("H35"), SERVICE_REPORT_CLOSING_MARK);
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

  assert.equal(filled.text("H31"), other);
  assert.notEqual(filled.text("H31"), SERVICE_REPORT_FINDINGS_INTRO);
  assert.equal(filled.text("H32"), "외관 손상 없음");
  assert.equal(filled.text("C33"), SERVICE_REPORT_BODY_LABELS.actions[0]);
  assert.equal(filled.text("H33"), "퓨즈 교체");
  assert.equal(filled.text("H34"), SERVICE_REPORT_CLOSING_MARK);
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

  assert.equal(filled.text("H31"), "외관 손상 없음", "빈 문자열인데 정형 문구가 들어갔다");
  assert.equal(filled.text("H32"), "전원부 퓨즈 단선 확인");
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
  assert.equal(filled.text("C31"), SERVICE_REPORT_BODY_LABELS.actions[0]);
  assert.equal(filled.text("H31"), "퓨즈 교체");
  assert.ok(!filled.sheetXml.includes(SERVICE_REPORT_FINDINGS_INTRO), "정형 문구만 남았다");
});

test("🔴 정형 문구도 폭을 넘으면 본문 줄과 같은 규칙으로 나뉜다", { skip: skipInspection }, () => {
  // H~AU 는 75칸이다. 아래 문장은 그보다 길다.
  const long =
    "인수품에 대하여 이하의 항목을 확인하였습니다. " +
    "아울러 반입 시 외관과 부속품 구성까지 함께 확인하였음을 알려 드립니다.";
  assert.ok(textDisplayWidth(long) > 75, "시험 준비 실패 — 문장이 한 줄에 들어간다");

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
  for (let row = 31; row < actionsRow; row += 1) written.push(filled.text(`H${row}`) ?? "");
  assert.ok(written.length > 2, "정형 문구가 나뉘지 않았다");
  for (const line of written) {
    assert.ok(textDisplayWidth(line) <= 75, `"${line}" 이 75칸을 넘는다`);
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
  { name: "검사", path: () => inspectionPath, skip: () => skipInspection, input: INSPECTION_INPUT, closingRow: 34 },
  { name: "수리", path: () => repairPath, skip: () => skipRepair, input: REPAIR_INPUT, closingRow: 35 },
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
    assert.equal(filled.text(`H${closing}`), SERVICE_REPORT_CLOSING_MARK, "맺음 표시 자리가 다르다");

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

    // 4) 머리 정보·체크칸·비고 — 손대지 않는다.
    for (const ref of ["C8", "C11", "AO8", "H13", "H21", "H27", "X28", "AN30", "H60", "H61"]) {
      assert.equal(
        styleIndexOf(filled.sheetXml, ref),
        styleIndexOf(beforeSheet, ref),
        `${ref} 의 서식이 바뀌었다`
      );
    }
  });
}

test("🔴 줄을 늘려도 새 줄이 왼쪽이고 마지막 줄의 아래 테두리가 산다", { skip: skipRepair }, () => {
  const templatePath = repairPath as string;
  const before = ZipArchive.fromBuffer(readFileSync(templatePath));
  const beforeStyles = before.readText(STYLES_PART);
  const beforeSheet = templateSheetXml(templatePath);

  // 60줄 + 맺음 표시 = 61줄. 양식은 29줄이라 32줄이 끼워 넣어진다.
  const total = 60;
  const shift = total + 1 - TEMPLATE_BODY_CAPACITY;
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
  const closingRow = 31 + total; // 91
  assert.equal(filled.text(`H${closingRow}`), SERVICE_REPORT_CLOSING_MARK);

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

  // 2) 🔴 마지막 줄(= 맺음 표시 줄)은 양식의 마지막 줄 서식 그대로다 —
  //    상자의 **아래 테두리**가 거기 걸려 있다.
  const lastSource = styleIndexOf(beforeSheet, `H${TEMPLATE_BODY_LAST_ROW}`);
  assert.equal(
    styleIndexOf(filled.sheetXml, `H${closingRow}`),
    lastSource,
    "마지막 줄의 서식이 바뀌었다 — 상자 밑변이 사라진다"
  );
  assert.equal(horizontalOf(afterStyles, lastSource), "center", "맺음 표시가 왼쪽으로 갔다");
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
