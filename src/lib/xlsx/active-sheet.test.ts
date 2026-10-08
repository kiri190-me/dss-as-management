import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  ActiveSheetError,
  hasTabSelected,
  parseWorkbookSheets,
  readActiveTabIndex,
  setActiveSheet,
} from "./active-sheet";
import { ZipArchive } from "./zip-reader";
import { writeZip, type ZipEntryInput } from "./zip-writer";

/**
 * ============================================================================
 * 「그 탭만 내보낸다」의 서버 쪽 — 활성 시트 지정 (2026-10-08)
 * ============================================================================
 * 🔴 **실제 양식 파일을 읽지 않는다.** 그 파일에는 법인 직인과 계좌번호가 들어 있어
 * 저장소에 없다. 대신 양식과 같은 모양(한 통합문서에 시트 셋 · 인쇄 영역이 여럿)을 본뜬
 * **가짜 통합문서**를 zip-writer 로 만들어 돌린다(cable-quote-template.test.ts 와 같은 방식).
 *
 * 실제 양식 다섯으로 도는 시험은 server/services/quote-workbook-active-sheet.test.ts 에 있다.
 * ============================================================================
 */

const WORKSHEET_CT = "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml";

type SheetSpec = {
  name: string;
  /** 그 시트의 `<sheetViews>` 자리에 넣을 글자. `null` 이면 `<sheetViews>` 가 아예 없다. */
  sheetViews: string | null;
};

const DEFAULT_SHEETS: readonly SheetSpec[] = [
  { name: "내자견적서", sheetViews: '<sheetViews><sheetView tabSelected="1" workbookViewId="0"/></sheetViews>' },
  { name: "OH견적서", sheetViews: '<sheetViews><sheetView workbookViewId="0"/></sheetViews>' },
  { name: "Sheet1", sheetViews: '<sheetViews><sheetView workbookViewId="0"/></sheetViews>' },
];

function sheetXml(spec: SheetSpec): string {
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<dimension ref="A1:I60"/>' +
    (spec.sheetViews ?? "") +
    `<sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>${spec.name}</t></is></c></row></sheetData>` +
    "</worksheet>"
  );
}

function workbookXmlOf(sheets: readonly SheetSpec[], bookViews: string): string {
  const tags = sheets
    .map((sheet, index) => `<sheet name="${sheet.name}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`)
    .join("");
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"' +
    ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    bookViews +
    `<sheets>${tags}</sheets>` +
    '<definedNames><definedName name="_xlnm.Print_Area" localSheetId="0">내자견적서!$A$1:$I$60</definedName>' +
    '<definedName name="_xlnm.Print_Area" localSheetId="1">OH견적서!$A$1:$I$60</definedName></definedNames>' +
    "</workbook>"
  );
}

function buildWorkbook(
  sheets: readonly SheetSpec[] = DEFAULT_SHEETS,
  bookViews = '<bookViews><workbookView xWindow="0" yWindow="0" activeTab="0"/></bookViews>'
): Buffer {
  const entries: ZipEntryInput[] = [
    {
      name: "[Content_Types].xml",
      data: Buffer.from(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          sheets
            .map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="${WORKSHEET_CT}"/>`)
            .join("") +
          "</Types>",
        "utf8"
      ),
    },
    { name: "xl/workbook.xml", data: Buffer.from(workbookXmlOf(sheets, bookViews), "utf8") },
    {
      name: "xl/_rels/workbook.xml.rels",
      data: Buffer.from(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          sheets
            .map(
              (_, index) =>
                `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${
                  index + 1
                }.xml"/>`
            )
            .join("") +
          "</Relationships>",
        "utf8"
      ),
    },
    { name: "xl/styles.xml", data: Buffer.from('<styleSheet><cellXfs count="1"><xf/></cellXfs></styleSheet>', "utf8") },
  ];
  sheets.forEach((sheet, index) => {
    entries.push({ name: `xl/worksheets/sheet${index + 1}.xml`, data: Buffer.from(sheetXml(sheet), "utf8") });
  });
  return writeZip(entries);
}

function read(bytes: Buffer, part: string): string {
  return ZipArchive.fromBuffer(bytes).readText(part);
}

/** 그 통합문서에서 「고른 탭」으로 표시된 시트 이름들. 하나뿐이어야 한다. */
function selectedSheetNames(bytes: Buffer, sheets: readonly SheetSpec[] = DEFAULT_SHEETS): string[] {
  return sheets
    .map((sheet, index) => ({ name: sheet.name, xml: read(bytes, `xl/worksheets/sheet${index + 1}.xml`) }))
    .filter((entry) => hasTabSelected(entry.xml))
    .map((entry) => entry.name);
}

describe("활성 탭 — 이름으로 고른다", () => {
  test("탭 차례의 자리번호가 activeTab 이 되고, 그 시트만 「고른 탭」이다", () => {
    const made = setActiveSheet(buildWorkbook(), "OH견적서");
    assert.equal(readActiveTabIndex(read(made, "xl/workbook.xml")), 1);
    assert.deepEqual(selectedSheetNames(made), ["OH견적서"]);
  });

  test("🔴 다섯 양식이 쓰는 시트 이름 넷을 모두 고를 수 있다", () => {
    for (const [name, index] of [
      ["내자견적서", 0],
      ["OH견적서", 1],
      ["Sheet1", 2],
    ] as const) {
      const made = setActiveSheet(buildWorkbook(), name);
      assert.equal(readActiveTabIndex(read(made, "xl/workbook.xml")), index, name);
      assert.deepEqual(selectedSheetNames(made), [name]);
    }
  });

  test("🔴 첫 탭이어도 activeTab 을 적는다 — 「0 이라 없는 것」과 「없어서 0 인 것」을 가른다", () => {
    const made = setActiveSheet(buildWorkbook(DEFAULT_SHEETS, "<bookViews><workbookView/></bookViews>"), "내자견적서");
    assert.ok(read(made, "xl/workbook.xml").includes('<workbookView activeTab="0"/>'));
  });

  test("🔴 다른 시트의 「고른 탭」 표시를 뗀다 — 둘이 함께 골라지면 엑셀이 묶음으로 다룬다", () => {
    const both: SheetSpec[] = [
      { name: "내자견적서", sheetViews: '<sheetViews><sheetView tabSelected="1" workbookViewId="0"/></sheetViews>' },
      { name: "OH견적서", sheetViews: '<sheetViews><sheetView tabSelected="1" workbookViewId="0"/></sheetViews>' },
      { name: "Sheet1", sheetViews: '<sheetViews><sheetView tabSelected="1" workbookViewId="0"/></sheetViews>' },
    ];
    const made = setActiveSheet(buildWorkbook(both), "OH견적서");
    assert.deepEqual(selectedSheetNames(made, both), ["OH견적서"]);
  });

  test("「고른 탭」 표시가 없던 시트에는 붙여 준다 — 활성 탭과 어긋나면 안 된다", () => {
    const made = setActiveSheet(buildWorkbook(), "Sheet1");
    assert.ok(read(made, "xl/worksheets/sheet3.xml").includes('tabSelected="1"'));
  });

  test("🔴 없는 시트 이름이면 던진다 — 엉뚱한 탭을 골라 두는 것보다 멈추는 편이 낫다", () => {
    assert.throws(() => setActiveSheet(buildWorkbook(), "견적서"), ActiveSheetError);
  });

  test("엑셀 통합문서가 아니면 던진다", () => {
    assert.throws(() => setActiveSheet(Buffer.from("엑셀이 아니다", "utf8"), "내자견적서"), ActiveSheetError);
  });
});

describe("🔴 같은 입력이면 같은 바이트", () => {
  test("두 번 만들어도 바이트가 같다", () => {
    const source = buildWorkbook();
    assert.ok(setActiveSheet(source, "OH견적서").equals(setActiveSheet(source, "OH견적서")));
  });

  test("🔴 한 번 더 걸어도 달라지지 않는다(멱등) — 이미 활성인 탭을 다시 활성으로 둘 뿐이다", () => {
    const once = setActiveSheet(buildWorkbook(), "OH견적서");
    assert.ok(setActiveSheet(once, "OH견적서").equals(once));
  });

  test("고르는 탭이 다르면 바이트가 다르다 — 아무것도 안 하는 것이 아니다", () => {
    const source = buildWorkbook();
    assert.equal(setActiveSheet(source, "내자견적서").equals(setActiveSheet(source, "OH견적서")), false);
  });
});

describe("🔴 손대는 자리는 둘뿐이다", () => {
  test("통합문서와 그 시트들 말고는 바이트 그대로다", () => {
    const source = buildWorkbook();
    const made = setActiveSheet(source, "OH견적서");
    const before = ZipArchive.fromBuffer(source);
    const after = ZipArchive.fromBuffer(made);
    // 파트 이름과 차례가 그대로다 — 더하지도 빼지도 않는다.
    assert.deepEqual(
      after.listEntries().map((entry) => entry.name),
      before.listEntries().map((entry) => entry.name)
    );
    for (const part of ["[Content_Types].xml", "xl/_rels/workbook.xml.rels", "xl/styles.xml"]) {
      assert.ok(after.readEntry(part)?.equals(before.readEntry(part) ?? Buffer.alloc(0)), part);
    }
  });

  test("🔴 인쇄 영역 · 시트 이름 · 시트 값은 건드리지 않는다", () => {
    const made = setActiveSheet(buildWorkbook(), "OH견적서");
    const workbookXml = read(made, "xl/workbook.xml");
    assert.ok(workbookXml.includes("내자견적서!$A$1:$I$60"));
    assert.ok(workbookXml.includes("OH견적서!$A$1:$I$60"));
    assert.deepEqual(
      parseWorkbookSheets(workbookXml).map((sheet) => sheet.name),
      ["내자견적서", "OH견적서", "Sheet1"]
    );
    assert.ok(read(made, "xl/worksheets/sheet2.xml").includes("<t>OH견적서</t>"));
  });
});

describe("🔴 없는 자리는 규격이 요구하는 차례로 만들어 넣는다", () => {
  test("bookViews 가 없으면 sheets **앞**에 만든다", () => {
    const made = setActiveSheet(buildWorkbook(DEFAULT_SHEETS, ""), "Sheet1");
    const workbookXml = read(made, "xl/workbook.xml");
    assert.ok(workbookXml.includes('<bookViews><workbookView activeTab="2"/></bookViews><sheets>'), workbookXml);
    assert.equal(readActiveTabIndex(workbookXml), 2);
  });

  test("sheetViews 가 없는 시트에는 dimension **뒤**에 만든다", () => {
    const sheets: SheetSpec[] = [
      { name: "내자견적서", sheetViews: null },
      { name: "OH견적서", sheetViews: null },
      { name: "Sheet1", sheetViews: null },
    ];
    const made = setActiveSheet(buildWorkbook(sheets), "OH견적서");
    const xml = read(made, "xl/worksheets/sheet2.xml");
    assert.ok(
      xml.includes('<dimension ref="A1:I60"/><sheetViews><sheetView tabSelected="1" workbookViewId="0"/></sheetViews>'),
      xml
    );
    assert.deepEqual(selectedSheetNames(made, sheets), ["OH견적서"]);
  });

  test("창(workbookView)이 여럿이면 전부 맞춘다 — 어느 창으로 열어도 같은 탭이다", () => {
    const made = setActiveSheet(
      buildWorkbook(DEFAULT_SHEETS, '<bookViews><workbookView activeTab="0"/><workbookView activeTab="2"/></bookViews>'),
      "OH견적서"
    );
    const workbookXml = read(made, "xl/workbook.xml");
    assert.equal(workbookXml.match(/activeTab="1"/g)?.length, 2, workbookXml);
  });
});
