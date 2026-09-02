import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { readServiceReportChoices } from "./service-report-choices";
import { SERVICE_REPORT_CELLS, SERVICE_REPORT_SHEET_NAME } from "./service-report-template";
import { writeZip } from "./zip-writer";

/**
 * ============================================================================
 * 양식의 드롭다운 목록 읽개
 * ============================================================================
 * 앞의 묶음은 **양식 없이도 도는 시험**이다 — 유효성 검사를 찾아 `formula1` 이
 * 가리키는 범위를 푸는 규칙이 여기 있다. 뼈대만 본뜬 통합문서를 그 자리에서
 * 만들어 쓴다.
 *
 * 뒤의 묶음은 실제 양식 파일이 있어야 돈다
 * (`INSPECTION_REPORT_TEMPLATE_PATH`·`REPAIR_REPORT_TEMPLATE_PATH`).
 * 없으면 건너뛴다 — 양식은 저장소에 두지 않는다(직인이 들어 있다).
 * `service-report-template.test.ts` 와 같은 방식이다.
 *
 * 🔴 **목록 전체를 여기에 베껴 단정하지 않는다.** 사람이 Excel 에서 항목을
 * 하나 더하는 날 이 시험이 깨지면, 그때 고쳐지는 것은 양식이 아니라 시험이다 —
 * 그러면 "양식을 따라간다"는 이 읽개의 존재 이유가 시험으로 막힌다. 대신
 * **읽개가 살아 있음을 보이는 표본 하나**(「수리의뢰」)만 확인한다.
 * ============================================================================
 */

// ── 양식 없이 — 유효성 검사를 푸는 규칙 ─────────────────────────────────

/** 시트 하나짜리 통합문서. `readServiceReportChoices` 가 여는 것과 같은 모양이다. */
function buildWorkbook(options: {
  sheetXml: string;
  extraSheets?: readonly { name: string; xml: string }[];
  sharedStringsXml?: string;
}): Buffer {
  const extras = options.extraSheets ?? [];

  const sheetTags = [
    `<sheet name="${SERVICE_REPORT_SHEET_NAME}" sheetId="1" r:id="rId1"/>`,
    ...extras.map((sheet, index) => `<sheet name="${sheet.name}" sheetId="${index + 2}" r:id="rId${index + 2}"/>`),
  ].join("");
  const relTags = [
    '<Relationship Id="rId1" Target="worksheets/sheet1.xml"/>',
    ...extras.map((_, index) => `<Relationship Id="rId${index + 2}" Target="worksheets/sheet${index + 2}.xml"/>`),
  ].join("");

  const entries = [
    { name: "xl/workbook.xml", data: Buffer.from(`<?xml version="1.0"?><workbook><sheets>${sheetTags}</sheets></workbook>`, "utf8") },
    { name: "xl/_rels/workbook.xml.rels", data: Buffer.from(`<?xml version="1.0"?><Relationships>${relTags}</Relationships>`, "utf8") },
    { name: "xl/worksheets/sheet1.xml", data: Buffer.from(options.sheetXml, "utf8") },
    ...extras.map((sheet, index) => ({
      name: `xl/worksheets/sheet${index + 2}.xml`,
      data: Buffer.from(sheet.xml, "utf8"),
    })),
  ];
  if (options.sharedStringsXml !== undefined) {
    entries.push({ name: "xl/sharedStrings.xml", data: Buffer.from(options.sharedStringsXml, "utf8") });
  }
  return writeZip(entries);
}

/** 값 셀 몇 개를 담은 시트. 인라인 문자열이라 공유문자열이 없어도 읽힌다. */
function cells(values: Record<string, string | null>): string {
  const rows = Object.entries(values)
    .map(([ref, value]) =>
      value === null
        ? `<c r="${ref}"/>`
        : `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${value}</t></is></c>`
    )
    .join("");
  return `<sheetData><row>${rows}</row></sheetData>`;
}

const SITUATION_CELL = SERVICE_REPORT_CELLS.situationRequest;
const PRODUCT_CELL = SERVICE_REPORT_CELLS.productName;

/** 실제 양식과 같은 모양 — `H21` 은 `H21:AE22` 안에, `H19` 는 `H19:P19` 안에 있다. */
const BASE_SHEET =
  '<?xml version="1.0"?><worksheet>' +
  cells({
    BS21: " ・ 수리의뢰",
    BS22: " ・ 동작확인의뢰",
    BS23: "",
    BS24: null,
    DD14: "13.56MHz 30kW",
    DD15: "4MHz T/C",
  }) +
  '<dataValidations count="2">' +
  '<dataValidation type="list" sqref="H21:AE22"><formula1>$BS$21:$BS$24</formula1></dataValidation>' +
  '<dataValidation type="list" sqref="H19:P19"><formula1>$DD$14:$DD$15</formula1></dataValidation>' +
  "</dataValidations></worksheet>";

test("드롭다운이 걸린 범위에서 목록을 읽어 낸다", () => {
  const choices = readServiceReportChoices(buildWorkbook({ sheetXml: BASE_SHEET }));

  // 🔴 앞의 글머리표와 공백을 다듬지 않는다 — 채우개가 그대로 적는 값이다.
  assert.deepEqual(choices.situationRequests, [" ・ 수리의뢰", " ・ 동작확인의뢰"]);
  assert.deepEqual(choices.productNames, ["13.56MHz 30kW", "4MHz T/C"]);
});

test("🔴 빈 칸은 목록에서 걸러진다 — 양식의 범위가 항목보다 넉넉하다", () => {
  const choices = readServiceReportChoices(buildWorkbook({ sheetXml: BASE_SHEET }));
  for (const value of choices.situationRequests) {
    assert.notEqual(value.trim(), "", "빈 값이 목록에 남았다");
  }
  assert.equal(choices.situationRequests.length, 2);
});

test("🔴 sqref 는 범위이고 여럿이 붙는다 — 글자로 견주면 하나도 안 잡힌다", () => {
  const sheet =
    '<?xml version="1.0"?><worksheet>' +
    cells({ BS21: "수리의뢰", DD14: "13.56MHz 30kW" }) +
    "<dataValidations>" +
    // 실제 양식의 체크칸 유효성 검사가 이 모양이다(공백으로 붙은 다섯 범위).
    `<dataValidation type="list" sqref="P29:Q30 ${SITUATION_CELL}:AE22 X27:Y30"><formula1>$BS$21:$BS$21</formula1></dataValidation>` +
    `<dataValidation type="list" sqref="${PRODUCT_CELL}"><formula1>$DD$14:$DD$14</formula1></dataValidation>` +
    "</dataValidations></worksheet>";

  const choices = readServiceReportChoices(buildWorkbook({ sheetXml: sheet }));
  assert.deepEqual(choices.situationRequests, ["수리의뢰"]);
  assert.deepEqual(choices.productNames, ["13.56MHz 30kW"]);
});

test("formula1 이 다른 시트를 가리키면 그 시트를 읽는다", () => {
  const sheet =
    '<?xml version="1.0"?><worksheet><sheetData/>' +
    "<dataValidations>" +
    `<dataValidation type="list" sqref="${SITUATION_CELL}"><formula1>'목록 시트'!$A$1:$A$2</formula1></dataValidation>` +
    `<dataValidation type="list" sqref="${PRODUCT_CELL}"><formula1>목록시트!$B$1</formula1></dataValidation>` +
    "</dataValidations></worksheet>";

  // 같은 이름의 시트가 둘이면 안 되므로 두 갈래를 따로 만들어 확인한다.
  const quoted = readServiceReportChoices(
    buildWorkbook({
      sheetXml: sheet.replace("목록시트!$B$1", "'목록 시트'!$B$1"),
      extraSheets: [
        {
          name: "목록 시트",
          xml: `<?xml version="1.0"?><worksheet>${cells({ A1: "수리의뢰", A2: "동작확인의뢰", B1: "4MHz 15kW" })}</worksheet>`,
        },
      ],
    })
  );
  assert.deepEqual(quoted.situationRequests, ["수리의뢰", "동작확인의뢰"]);
  assert.deepEqual(quoted.productNames, ["4MHz 15kW"]);
});

test("확장(x14) 유효성 검사도 본다 — Excel 이 저장하며 그리로 옮겨 놓는다", () => {
  const sheet =
    '<?xml version="1.0"?><worksheet>' +
    cells({ BS21: "수리의뢰", DD14: "13.56MHz 30kW" }) +
    "<extLst><ext><x14:dataValidations>" +
    '<x14:dataValidation type="list">' +
    "<x14:formula1><xm:f>$BS$21</xm:f></x14:formula1>" +
    `<xm:sqref>${SITUATION_CELL}:AE22</xm:sqref>` +
    "</x14:dataValidation>" +
    '<x14:dataValidation type="list">' +
    "<x14:formula1><xm:f>$DD$14</xm:f></x14:formula1>" +
    `<xm:sqref>${PRODUCT_CELL}</xm:sqref>` +
    "</x14:dataValidation>" +
    "</x14:dataValidations></ext></extLst></worksheet>";

  const choices = readServiceReportChoices(buildWorkbook({ sheetXml: sheet }));
  assert.deepEqual(choices.situationRequests, ["수리의뢰"]);
  assert.deepEqual(choices.productNames, ["13.56MHz 30kW"]);
});

test("따옴표로 곧장 적은 목록도 읽는다 — Excel 이 허용하는 모양이다", () => {
  const sheet =
    '<?xml version="1.0"?><worksheet><sheetData/>' +
    "<dataValidations>" +
    `<dataValidation type="list" sqref="${SITUATION_CELL}"><formula1>&quot;수리의뢰,동작확인의뢰&quot;</formula1></dataValidation>` +
    `<dataValidation type="list" sqref="${PRODUCT_CELL}"><formula1>&quot;4MHz 30kW&quot;</formula1></dataValidation>` +
    "</dataValidations></worksheet>";

  const choices = readServiceReportChoices(buildWorkbook({ sheetXml: sheet }));
  assert.deepEqual(choices.situationRequests, ["수리의뢰", "동작확인의뢰"]);
  assert.deepEqual(choices.productNames, ["4MHz 30kW"]);
});

test("🔴 드롭다운을 못 찾으면 빈 배열이 아니라 던진다", () => {
  const sheet =
    '<?xml version="1.0"?><worksheet>' +
    cells({ DD14: "13.56MHz 30kW" }) +
    "<dataValidations>" +
    `<dataValidation type="list" sqref="${PRODUCT_CELL}"><formula1>$DD$14</formula1></dataValidation>` +
    "</dataValidations></worksheet>";

  assert.throws(
    () => readServiceReportChoices(buildWorkbook({ sheetXml: sheet })),
    /상황·의뢰 종류 칸\(H21\)에 드롭다운 목록이 걸려 있지 않습니다/
  );
});

test("🔴 목록 범위가 통째로 비어 있어도 던진다", () => {
  const sheet =
    '<?xml version="1.0"?><worksheet>' +
    cells({ BS21: "  ", DD14: "13.56MHz 30kW" }) +
    "<dataValidations>" +
    `<dataValidation type="list" sqref="${SITUATION_CELL}"><formula1>$BS$21:$BS$22</formula1></dataValidation>` +
    `<dataValidation type="list" sqref="${PRODUCT_CELL}"><formula1>$DD$14</formula1></dataValidation>` +
    "</dataValidations></worksheet>";

  assert.throws(
    () => readServiceReportChoices(buildWorkbook({ sheetXml: sheet })),
    /상황·의뢰 종류 드롭다운 목록이 비어 있습니다/
  );
});

test("formula1 을 못 읽으면 짐작하지 않고 던진다", () => {
  const sheet =
    '<?xml version="1.0"?><worksheet><sheetData/>' +
    "<dataValidations>" +
    `<dataValidation type="list" sqref="${SITUATION_CELL}"><formula1>INDIRECT(A1)</formula1></dataValidation>` +
    "</dataValidations></worksheet>";

  assert.throws(
    () => readServiceReportChoices(buildWorkbook({ sheetXml: sheet })),
    /목록 범위를 읽을 수 없습니다/
  );
});

test("목록 범위가 폭주하면 백만 칸을 훑지 않고 멈춘다", () => {
  const sheet =
    '<?xml version="1.0"?><worksheet><sheetData/>' +
    "<dataValidations>" +
    `<dataValidation type="list" sqref="${SITUATION_CELL}"><formula1>$A$1:$A$100000</formula1></dataValidation>` +
    "</dataValidations></worksheet>";

  assert.throws(() => readServiceReportChoices(buildWorkbook({ sheetXml: sheet })), /칸까지만 읽습니다/);
});

test("🔴 후리가나(rPh)는 목록 값에 따라오지 않는다", () => {
  // 실제 양식의 공유문자열이 이 모양이다 — 「수리의뢰」 뒤에 가타카나가 붙어 있다.
  const sharedStringsXml =
    '<?xml version="1.0"?><sst>' +
    "<si><r><t xml:space=\"preserve\"> ・ 수리의뢰</t></r>" +
    '<rPh sb="2" eb="4"><t>シュウリ</t></rPh><rPh sb="4" eb="6"><t>イライ</t></rPh></si>' +
    "<si><t>13.56MHz 30kW</t></si>" +
    "</sst>";
  const sheet =
    '<?xml version="1.0"?><worksheet>' +
    '<sheetData><row><c r="BS21" t="s"><v>0</v></c><c r="DD14" t="s"><v>1</v></c></row></sheetData>' +
    "<dataValidations>" +
    `<dataValidation type="list" sqref="${SITUATION_CELL}"><formula1>$BS$21</formula1></dataValidation>` +
    `<dataValidation type="list" sqref="${PRODUCT_CELL}"><formula1>$DD$14</formula1></dataValidation>` +
    "</dataValidations></worksheet>";

  const choices = readServiceReportChoices(buildWorkbook({ sheetXml: sheet, sharedStringsXml }));
  assert.deepEqual(choices.situationRequests, [" ・ 수리의뢰"]);
});

// ── 실제 양식으로 ────────────────────────────────────────────────────────

const inspectionPath = process.env.INSPECTION_REPORT_TEMPLATE_PATH;
const repairPath = process.env.REPAIR_REPORT_TEMPLATE_PATH;
const skipInspection = inspectionPath ? false : "INSPECTION_REPORT_TEMPLATE_PATH 가 설정되지 않았습니다";
const skipRepair = repairPath ? false : "REPAIR_REPORT_TEMPLATE_PATH 가 설정되지 않았습니다";

for (const kind of [
  { name: "검사", path: () => inspectionPath, skip: () => skipInspection },
  { name: "수리", path: () => repairPath, skip: () => skipRepair },
] as const) {
  test(`${kind.name} 보고서 양식 — 상황 목록에 「수리의뢰」가 있다`, { skip: kind.skip() }, () => {
    const choices = readServiceReportChoices(readFileSync(kind.path() as string));

    // 🔴 목록 전체를 베끼지 않는다. 표본 하나로 "읽개가 살아 있다"만 본다.
    assert.ok(
      choices.situationRequests.some((value) => value.includes("수리의뢰")),
      `상황 목록에 「수리의뢰」가 없다: ${JSON.stringify(choices.situationRequests)}`
    );
    assert.ok(choices.productNames.length > 0, "품명 목록이 비었다");

    // 값이 그대로 `H19`·`H21` 에 적혀 나간다 — 후리가나가 섞이면 문서가 틀린다.
    // ⚠️ 글머리표 `・`(U+30FB)도 가타카나 블록이라 **글자만** 견준다
    //    (U+30A1~U+30FA). 목록 값이 실제로 `" ・ 수리의뢰"` 다.
    for (const value of [...choices.situationRequests, ...choices.productNames]) {
      assert.ok(
        !/[ァ-ヺ]/.test(value),
        `가타카나(후리가나)가 남았다: ${JSON.stringify(value)}`
      );
      assert.notEqual(value.trim(), "");
    }
  });
}

test("품명 목록은 주파수 × 출력이다", { skip: skipRepair }, () => {
  const choices = readServiceReportChoices(readFileSync(repairPath as string));
  // 값을 못 박지 않고 **모양**만 본다 — 항목이 늘어도 깨지지 않는다.
  assert.ok(
    choices.productNames.every((value) => /MHz/.test(value)),
    `품명 목록이 아니다: ${JSON.stringify(choices.productNames)}`
  );
});

test("검사·수리 양식은 같은 목록을 쓴다", { skip: skipInspection || skipRepair }, () => {
  const inspection = readServiceReportChoices(readFileSync(inspectionPath as string));
  const repair = readServiceReportChoices(readFileSync(repairPath as string));
  assert.deepEqual(inspection.situationRequests, repair.situationRequests);
  assert.deepEqual(inspection.productNames, repair.productNames);
});
