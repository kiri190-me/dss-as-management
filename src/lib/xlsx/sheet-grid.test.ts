import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  buildSheetGrid,
  columnLettersToNumber,
  columnNumberToLetters,
  parseSharedStringsWithoutPhonetics,
  readDate1904,
  readSheetGrid,
  type GridCell,
} from "./sheet-grid";
import { ZipArchive } from "./zip-reader";
import { writeZip, type ZipEntryInput } from "./zip-writer";

/**
 * 시험용 통합문서는 전부 zip-writer 로 만든 **가짜**다. 실제 인수품 리스트는 열지 않는다.
 */

const MAIN_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PKG_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships";

function sst(items: readonly string[]): string {
  return `<sst xmlns="${MAIN_NS}" count="${items.length}" uniqueCount="${items.length}">${items.join("")}</sst>`;
}

function worksheet(rowsXml: string): string {
  return `<worksheet xmlns="${MAIN_NS}"><sheetData>${rowsXml}</sheetData></worksheet>`;
}

function archiveOf(options: {
  sheets: { name: string; xml: string }[];
  sharedStringsXml?: string;
  workbookPr?: string;
}): ZipArchive {
  const sheetTags = options.sheets
    .map((sheet, index) => `<sheet name="${sheet.name}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`)
    .join("");
  const relTags = options.sheets
    .map(
      (_sheet, index) =>
        `<Relationship Id="rId${index + 1}" Type="${REL_NS}/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`
    )
    .join("");
  const entries: ZipEntryInput[] = [
    {
      name: "xl/workbook.xml",
      data: Buffer.from(
        `<workbook xmlns="${MAIN_NS}" xmlns:r="${REL_NS}">${options.workbookPr ?? "<workbookPr/>"}<sheets>${sheetTags}</sheets></workbook>`,
        "utf8"
      ),
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      data: Buffer.from(`<Relationships xmlns="${PKG_REL_NS}">${relTags}</Relationships>`, "utf8"),
    },
    ...options.sheets.map((sheet, index) => ({
      name: `xl/worksheets/sheet${index + 1}.xml`,
      data: Buffer.from(sheet.xml, "utf8"),
    })),
  ];
  if (options.sharedStringsXml !== undefined) {
    entries.push({ name: "xl/sharedStrings.xml", data: Buffer.from(options.sharedStringsXml, "utf8") });
  }
  return ZipArchive.fromBuffer(writeZip(entries));
}

function text(value: string): GridCell {
  return { kind: "text", text: value };
}

function number(value: number): GridCell {
  return { kind: "number", value };
}

describe("공유문자열 — 후리가나(<rPh>)를 걷는다", () => {
  test("種別 이 種別シュベツ 가 되지 않는다", () => {
    const xml = sst([
      `<si><t>種別</t><rPh sb="0" eb="2"><t>シュベツ</t></rPh><phoneticPr fontId="1" type="noConversion"/></si>`,
    ]);
    assert.deepEqual(parseSharedStringsWithoutPhonetics(xml), ["種別"]);
  });

  test("서식 run 여러 개를 잇는다 — 후리가나가 함께 있어도", () => {
    const xml = sst([
      `<si><r><rPr><b/><sz val="11"/></rPr><t>RF</t></r><r><rPr><sz val="9"/></rPr><t xml:space="preserve">(FH) </t></r>` +
        `<rPh sb="0" eb="2"><t>アールエフ</t></rPh><phoneticPr fontId="1"/></si>`,
    ]);
    assert.deepEqual(parseSharedStringsWithoutPhonetics(xml), ["RF(FH) "]);
  });

  test("두 줄 머리글 — 첫 줄의 후리가나만 빠지고 줄바꿈은 남는다", () => {
    const xml = sst([
      `<si><t xml:space="preserve">引取番号\n인수번호</t><rPh sb="0" eb="4"><t>ヒキトリバンゴウ</t></rPh></si>`,
    ]);
    assert.deepEqual(parseSharedStringsWithoutPhonetics(xml), ["引取番号\n인수번호"]);
  });

  test("XML 엔티티 · 숫자 참조 · _x000D_ 를 한 번씩만 푼다", () => {
    const xml = sst([
      `<si><t>A&amp;B &lt;x&gt; &quot;q&quot; &#10;줄 &amp;#10; _x000D_ _x005F_x000D_</t></si>`,
    ]);
    assert.deepEqual(parseSharedStringsWithoutPhonetics(xml), [
      `A&B <x> "q" \n줄 &#10; \r _x000D_`,
    ]);
  });

  test("빈 <si/> 와 후리가나만 있는 항목도 자리를 지킨다 — 번호가 밀리지 않는다", () => {
    const xml = sst([`<si/>`, `<si><rPh sb="0" eb="1"><t>ア</t></rPh></si>`, `<si><t>三番目</t></si>`]);
    assert.deepEqual(parseSharedStringsWithoutPhonetics(xml), ["", "", "三番目"]);
  });

  test("공유문자열 파트가 없으면 빈 표", () => {
    assert.deepEqual(parseSharedStringsWithoutPhonetics(null), []);
  });
});

describe("칸 읽기", () => {
  test("칸의 종류마다 — 글자·숫자·오류(빈칸)·자체닫힘", () => {
    const shared = parseSharedStringsWithoutPhonetics(
      sst([`<si><t>種別</t><rPh sb="0" eb="2"><t>シュベツ</t></rPh></si>`, `<si><t></t></si>`])
    );
    const grid = buildSheetGrid(
      worksheet(
        `<row r="18" spans="1:27">` +
          `<c r="A18" t="s"><v>0</v></c>` +
          // 자체닫힘 칸 — 여는 태그로 읽으면 C18 까지 먹는다.
          `<c r="B18" s="3"/>` +
          `<c r="C18" t="inlineStr"><is><t>D210101</t><rPh sb="0" eb="1"><t>ディー</t></rPh></is></c>` +
          `<c r="D18" s="5"><v>44200</v></c>` +
          `<c r="E18" t="str"><f>IF(A1=1,"x","y")</f><v>수식 결과</v></c>` +
          `<c r="F18" t="e"><f>VLOOKUP(A1,B:C,2,FALSE)</f><v>#N/A</v></c>` +
          `<c r="G18" t="b"><v>1</v></c>` +
          `<c r="I18"><v>1912120</v></c>` +
          `<c r="J18" t="s"><v>1</v></c>` +
          `<c r="K18"><f>A1</f></c>` +
          `<c r="AA18"><v>1.5</v></c>` +
          `</row>`
      ),
      shared,
      false
    );
    assert.deepEqual(
      [...grid.cells(18)],
      [
        ["A", text("種別")],
        ["C", text("D210101")],
        ["D", number(44200)],
        ["E", text("수식 결과")],
        ["G", text("TRUE")],
        ["I", number(1912120)],
        ["AA", number(1.5)],
      ]
    );
  });

  test("행 번호 — 칸 없는 줄도 담고, 없는 행은 빈 Map", () => {
    const grid = buildSheetGrid(
      worksheet(
        `<row r="3"><c r="B3" t="inlineStr"><is><t>凡例</t></is></c></row>` +
          `<row r="5"/>` +
          `<row r="17" spans="2:27" ht="45" customHeight="1"><c r="C17"><v>1</v></c></row>`
      ),
      [],
      false
    );
    assert.deepEqual(grid.rowNumbers, [3, 5, 17]);
    assert.equal(grid.cells(5).size, 0);
    assert.equal(grid.cells(99).size, 0);
    assert.deepEqual(grid.cells(3).get("B"), text("凡例"));
  });

  test("주소(r)가 빠진 칸은 바로 앞 칸의 다음 열", () => {
    const grid = buildSheetGrid(
      worksheet(`<row r="2"><c r="X2"><v>1</v></c><c><v>2</v></c><c r="AA2"><v>3</v></c></row>`),
      [],
      false
    );
    assert.deepEqual([...grid.cells(2)], [["X", number(1)], ["Y", number(2)], ["AA", number(3)]]);
  });

  test("<sheetData/> 나 줄이 없는 시트는 빈 격자", () => {
    assert.deepEqual(buildSheetGrid(`<worksheet><sheetData/></worksheet>`, [], false).rowNumbers, []);
    assert.deepEqual(buildSheetGrid(worksheet(""), [], false).rowNumbers, []);
  });

  test("열 문자 ↔ 번호", () => {
    for (const [letters, columnNumber] of [
      ["A", 1],
      ["Z", 26],
      ["AA", 27],
      ["AZ", 52],
      ["BA", 53],
      ["XFD", 16384],
    ] as const) {
      assert.equal(columnLettersToNumber(letters), columnNumber, letters);
      assert.equal(columnNumberToLetters(columnNumber), letters, String(columnNumber));
    }
  });
});

describe("통합문서", () => {
  test("date1904 — workbookPr 의 속성으로만 정한다", () => {
    assert.equal(readDate1904(`<workbook><workbookPr date1904="1"/></workbook>`), true);
    assert.equal(readDate1904(`<workbook><workbookPr date1904="true" defaultThemeVersion="1"/></workbook>`), true);
    assert.equal(readDate1904(`<workbook><workbookPr date1904="0"/></workbook>`), false);
    assert.equal(readDate1904(`<workbook><workbookPr defaultThemeVersion="164011"/></workbook>`), false);
    assert.equal(readDate1904(`<workbook/>`), false);
  });

  test("이름으로 시트를 골라 읽는다 — 다른 시트는 보지 않는다", () => {
    const archive = archiveOf({
      workbookPr: `<workbookPr date1904="1"/>`,
      sharedStringsXml: sst([
        `<si><t>引取番号</t></si>`,
        `<si><t>種別</t><rPh sb="0" eb="2"><t>シュベツ</t></rPh></si>`,
      ]),
      sheets: [
        { name: "まとめ", xml: worksheet(`<row r="1"><c r="C1" t="s"><v>0</v></c></row>`) },
        { name: "リスト", xml: worksheet(`<row r="17"><c r="G17" t="s"><v>1</v></c></row>`) },
      ],
    });
    const grid = readSheetGrid(archive, "リスト");
    assert.ok(grid);
    assert.equal(grid.date1904, true);
    assert.deepEqual(grid.rowNumbers, [17]);
    assert.deepEqual([...grid.cells(17)], [["G", text("種別")]]);
  });

  test("없는 시트면 null", () => {
    const archive = archiveOf({ sheets: [{ name: "Sheet1", xml: worksheet("") }] });
    assert.equal(readSheetGrid(archive, "リスト"), null);
  });
});
