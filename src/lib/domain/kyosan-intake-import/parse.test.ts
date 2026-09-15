import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, test } from "node:test";

import { writeZip, type ZipEntryInput } from "@/lib/xlsx/zip-writer";
import { parseKyosanIntakeWorkbook } from "./parse";
import type { KyosanClassifiedRow, KyosanParseResult } from "./types";

/**
 * 🔴 실제 인수품 리스트는 열지 않는다. 여기의 통합문서는 전부 zip-writer 로 만든
 * **가짜**이고, 고객사·모델 이름도 가짜다(TEST-CUSTOMER-A 등).
 *
 * 모양은 원본에서 확인한 사실을 따른다 — 시트 셋(まとめ·リスト·メモ), 범례 3~13행,
 * 요약 15~16행, 머리글 17행(일본어⏎한국어 두 줄 + 후리가나), 자료 18행부터, 그리고
 * 일련번호(B)·X·AA 만 있는 빈 틀 줄.
 */

const TODAY = "2026-09-15";

const MAIN_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PKG_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships";
const CONTENT_TYPES_NS = "http://schemas.openxmlformats.org/package/2006/content-types";

type CellInput =
  | string // 인라인 문자열
  | number // 숫자 칸
  | { rawNumber: string } // 숫자 칸 — <v> 에 적힌 글자 그대로(지수 표기 등)
  | { shared: string } // 공유문자열
  | { si: string } // 공유문자열 — <si> 안쪽 XML 그대로(후리가나·서식 run)
  | { formula: string; cached: string } // t="str"
  | { error: string }; // t="e"

type RowCells = Record<string, CellInput | null>;
type SheetSpec = { name: string; rows: Record<number, RowCells> };

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function columnNumber(letters: string): number {
  let result = 0;
  for (const letter of letters) result = result * 26 + (letter.charCodeAt(0) - 64);
  return result;
}

function buildWorkbook(sheets: readonly SheetSpec[], options: { date1904?: boolean } = {}): Buffer {
  const sharedItems: string[] = [];
  const addShared = (siBody: string): number => sharedItems.push(`<si>${siBody}</si>`) - 1;

  const cellXml = (ref: string, input: CellInput): string => {
    if (typeof input === "number") return `<c r="${ref}"><v>${input}</v></c>`;
    if (typeof input === "string") {
      return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(input)}</t></is></c>`;
    }
    if ("rawNumber" in input) return `<c r="${ref}"><v>${input.rawNumber}</v></c>`;
    if ("shared" in input) {
      return `<c r="${ref}" t="s"><v>${addShared(`<t xml:space="preserve">${escapeXml(input.shared)}</t>`)}</v></c>`;
    }
    if ("si" in input) return `<c r="${ref}" t="s"><v>${addShared(input.si)}</v></c>`;
    if ("formula" in input) {
      return `<c r="${ref}" t="str"><f>${escapeXml(input.formula)}</f><v>${escapeXml(input.cached)}</v></c>`;
    }
    return `<c r="${ref}" t="e"><v>${escapeXml(input.error)}</v></c>`;
  };

  const sheetXmls = sheets.map((sheet) => {
    const rowsXml = Object.keys(sheet.rows)
      .map(Number)
      .sort((a, b) => a - b)
      .map((rowNumber) => {
        const cells = Object.entries(sheet.rows[rowNumber])
          .filter((entry): entry is [string, CellInput] => entry[1] !== null)
          .sort(([a], [b]) => columnNumber(a) - columnNumber(b))
          .map(([column, input]) => cellXml(`${column}${rowNumber}`, input))
          .join("");
        return `<row r="${rowNumber}">${cells}</row>`;
      })
      .join("");
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="${MAIN_NS}"><sheetData>${rowsXml}</sheetData></worksheet>`;
  });

  const sharedStringsRelId = `rId${sheets.length + 1}`;
  const entries: ZipEntryInput[] = [
    {
      name: "[Content_Types].xml",
      data: Buffer.from(
        `<Types xmlns="${CONTENT_TYPES_NS}">` +
          `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
          `<Default Extension="xml" ContentType="application/xml"/>` +
          `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
          sheets
            .map(
              (_sheet, index) =>
                `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
            )
            .join("") +
          `<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>` +
          `</Types>`,
        "utf8"
      ),
    },
    {
      name: "_rels/.rels",
      data: Buffer.from(
        `<Relationships xmlns="${PKG_REL_NS}"><Relationship Id="rId1" Type="${REL_NS}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
        "utf8"
      ),
    },
    {
      name: "xl/workbook.xml",
      data: Buffer.from(
        `<workbook xmlns="${MAIN_NS}" xmlns:r="${REL_NS}">` +
          `<workbookPr${options.date1904 ? ' date1904="1"' : ""} defaultThemeVersion="164011"/>` +
          `<sheets>${sheets
            .map((sheet, index) => `<sheet name="${sheet.name}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`)
            .join("")}</sheets></workbook>`,
        "utf8"
      ),
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      data: Buffer.from(
        `<Relationships xmlns="${PKG_REL_NS}">` +
          sheets
            .map(
              (_sheet, index) =>
                `<Relationship Id="rId${index + 1}" Type="${REL_NS}/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`
            )
            .join("") +
          `<Relationship Id="${sharedStringsRelId}" Type="${REL_NS}/sharedStrings" Target="sharedStrings.xml"/>` +
          `</Relationships>`,
        "utf8"
      ),
    },
    ...sheetXmls.map((xml, index) => ({ name: `xl/worksheets/sheet${index + 1}.xml`, data: Buffer.from(xml, "utf8") })),
    {
      name: "xl/sharedStrings.xml",
      data: Buffer.from(
        `<sst xmlns="${MAIN_NS}" count="${sharedItems.length}" uniqueCount="${sharedItems.length}">${sharedItems.join("")}</sst>`,
        "utf8"
      ),
    },
  ];
  return writeZip(entries);
}

// ── 원본 모양 흉내 ────────────────────────────────────────────────────────

const HEADER_LINES: Record<string, readonly [string, string?]> = {
  B: ["No."],
  C: ["引取番号", "인수번호"],
  D: ["引取日", "인수일"],
  E: ["受付者"],
  F: ["型式", "모델"],
  G: ["種別", "종류"],
  H: ["L/N", "L/N"],
  I: ["S/N", "S/N"],
  J: ["客先名称", "고객사"],
  K: ["End-User", "END-USER"],
  L: ["客先返却理由", "신고증상"],
  M: ["調査結果"],
  O: ["状態", "상태"],
  S: ["出荷日", "출하일"],
  V: ["報告書番号", "보고서 번호"],
  X: ["備考"],
  Y: ["費用", "유/무상"],
  AA: ["確認"],
};

/**
 * 머리글 칸 — 일본어 첫 줄과 한국어 둘째 줄을 서식 run 둘로, 첫 줄에 후리가나를 단다.
 * 후리가나를 걷지 않으면 `種別` 이 `種別フリガナ` 가 되어 대조가 전부 어긋난다.
 */
function headerCell(first: string, second?: string): CellInput {
  const secondRun =
    second === undefined ? "" : `<r><rPr><sz val="9"/></rPr><t xml:space="preserve">${escapeXml(`\n${second}`)}</t></r>`;
  return {
    si:
      `<r><t>${escapeXml(first)}</t></r>${secondRun}` +
      `<rPh sb="0" eb="${first.length}"><t>フリガナ</t></rPh><phoneticPr fontId="1" type="noConversion"/>`,
  };
}

function headerCells(overrides: RowCells = {}): RowCells {
  const cells: RowCells = {};
  for (const [column, [first, second]] of Object.entries(HEADER_LINES)) cells[column] = headerCell(first, second);
  return { ...cells, ...overrides };
}

/** 문제 없는 자료 줄. `sequence` 로 인수번호·S/N 이 달라진다. */
function dataRow(sequence: number, overrides: RowCells = {}): RowCells {
  return {
    B: sequence,
    C: `D2101${String(sequence).padStart(2, "0")}`,
    D: 44200, // 2021-01-04
    E: "TEST-RECEIVER",
    F: "TEST-MODEL-RF",
    G: "RF(FH)",
    H: "LN-0001",
    I: 1912100 + sequence,
    J: "TEST-CUSTOMER-A",
    K: "TEST-END-USER-A",
    L: "출력이 나오지 않음",
    O: "受付",
    Y: "有償",
    X: "x",
    AA: 0,
    ...overrides,
  };
}

/** 지정 열이 전부 빈 틀 줄 — 일련번호(B)·X(수식, 빈 결과)·AA 만. */
function blankTemplateRow(sequence: number): RowCells {
  return { B: sequence, X: { formula: 'IF(C1="","","x")', cached: "" }, AA: 0 };
}

function listSheet(
  data: readonly RowCells[],
  options: { headerRow?: number; header?: RowCells; trailingBlankRows?: number } = {}
): SheetSpec {
  const headerRow = options.headerRow ?? 17;
  const rows: Record<number, RowCells> = { 1: { B: "引取品リスト" } };
  for (let row = 3; row <= 13 && row < headerRow; row += 1) {
    rows[row] = { B: `凡例 ${row}: 引取番号の付け方`, D: "説明" };
  }
  for (let row = 15; row <= 16 && row < headerRow; row += 1) rows[row] = { B: "件数", D: data.length };
  rows[headerRow] = options.header ?? headerCells();
  data.forEach((cells, index) => {
    rows[headerRow + 1 + index] = cells;
  });
  const firstBlank = headerRow + 1 + data.length;
  for (let index = 0; index < (options.trailingBlankRows ?? 3); index += 1) {
    rows[firstBlank + index] = blankTemplateRow(firstBlank + index - headerRow);
  }
  return { name: "リスト", rows };
}

/** 원본처럼 앞뒤에 다른 시트를 둔다. まとめ 의 C열에도 引取番号 가 있다 — 읽으면 안 된다. */
function kyosanWorkbook(list: SheetSpec, options: { date1904?: boolean } = {}): Buffer {
  return buildWorkbook(
    [
      { name: "まとめ", rows: { 1: { A: "集計" }, 2: { C: "引取番号", D: 10 } } },
      list,
      { name: "メモ", rows: { 1: { A: "memo" } } },
    ],
    options
  );
}

function parse(bytes: Buffer, fileName = "引取品リスト.xlsx"): KyosanParseResult {
  return parseKyosanIntakeWorkbook(bytes, fileName, { today: TODAY });
}

function okRows(result: KyosanParseResult): KyosanClassifiedRow[] {
  if (!result.ok) throw new Error(`읽기가 실패했습니다: ${result.code} ${result.message}`);
  return result.rows;
}

function importable(row: KyosanClassifiedRow) {
  if (row.outcome !== "IMPORTABLE") throw new Error(`IMPORTABLE 이어야 합니다: ${JSON.stringify(row)}`);
  return row;
}

// ── 시험 ─────────────────────────────────────────────────────────────────

describe("원본 모양의 파일", () => {
  test("17행 머리글(후리가나 포함) — 범례·요약을 건너뛰고, 지정 열이 빈 줄은 세지 않는다", () => {
    const bytes = kyosanWorkbook(
      listSheet([
        dataRow(1),
        dataRow(2, { I: "SN-TEXT-02" }),
        // 가운데 끼인 빈 틀 줄도 무시한다.
        blankTemplateRow(3),
        dataRow(4, { G: "MB", F: "TEST-MODEL-MB" }),
      ])
    );
    const result = parse(bytes);
    assert.ok(result.ok, JSON.stringify(result));
    assert.equal(result.headerRow, 17);
    assert.equal(result.sheetName, "リスト");
    assert.equal(result.fileSha256, createHash("sha256").update(bytes).digest("hex"));
    assert.deepEqual(
      result.rows.map((row) => [row.raw.rowNumber, row.outcome]),
      [
        [18, "IMPORTABLE"],
        [19, "IMPORTABLE"],
        [21, "IMPORTABLE"],
      ]
    );
    assert.equal(importable(result.rows[2]).workflowKind, "MATCHER");
  });

  test("머리글이 17행이 아니어도(5행) 읽는다", () => {
    const result = parse(kyosanWorkbook(listSheet([dataRow(1)], { headerRow: 5 })));
    assert.ok(result.ok, JSON.stringify(result));
    assert.equal(result.headerRow, 5);
    assert.deepEqual(result.rows.map((row) => row.raw.rowNumber), [6]);
  });

  test("원문 보존 — 이름·증상·보고서 번호는 trim 만, 인수번호·L/N·S/N 은 NFKC", () => {
    const rows = okRows(
      parse(
        kyosanWorkbook(
          listSheet([
            dataRow(1, {
              C: " Ｄ２１０１０１ ",
              F: "  ＴＥＳＴ－Model  Ｘ ",
              H: "ＬＮ－０１",
              I: 1912120,
              J: " TEST-CUSTOMER-Ａ ",
              K: { shared: "TEST-END-USER-Ｂ" },
              L: "  전원 불량\n팬 소음 ",
              V: 20210001,
              Y: { shared: " 無償 " },
            }),
          ])
        )
      )
    );
    const row = importable(rows[0]);
    assert.deepEqual(row.raw, {
      rowNumber: 18,
      intakeNumber: "D210101",
      receivedAt: "2021-01-04",
      modelName: "ＴＥＳＴ－Model  Ｘ",
      kindText: "RF(FH)",
      lotNumber: "LN-01",
      serialNumber: "1912120",
      customerName: "TEST-CUSTOMER-Ａ",
      endUserName: "TEST-END-USER-Ｂ",
      reportedSymptom: "전원 불량\n팬 소음",
      statusText: "受付",
      shippedAt: null,
      reportNumber: "20210001",
      billingText: "無償",
    });
    assert.equal(row.workflowType, "WARRANTY_GENERATOR");
  });

  test("숫자 S/N — .0 이나 지수 표기로 적힌 칸도 정수 문자열", () => {
    const rows = okRows(
      parse(
        kyosanWorkbook(
          listSheet([
            dataRow(1, { I: { rawNumber: "1912120" } }),
            dataRow(2, { I: { rawNumber: "1.91212E6" }, H: { rawNumber: "20190.0" } }),
          ])
        )
      )
    );
    assert.deepEqual(
      rows.map((row) => [row.raw.serialNumber, row.raw.lotNumber]),
      [
        ["1912120", "LN-0001"],
        ["1912120", "20190"],
      ]
    );
  });

  test("date1904 통합문서의 일련번호", () => {
    const rows = okRows(
      parse(
        kyosanWorkbook(listSheet([dataRow(1, { D: 42738, O: "出荷済み", S: 42769 })]), { date1904: true })
      )
    );
    const row = importable(rows[0]);
    assert.equal(row.raw.receivedAt, "2021-01-04");
    assert.equal(row.actualShipmentDate, "2021-02-04");
    assert.equal(row.targetStepKey, "shipment_completed");

    // 같은 번호를 1900 체계로 읽으면 다른 날이다 — 체계를 실제로 보고 있다는 증거.
    const in1900 = okRows(parse(kyosanWorkbook(listSheet([dataRow(1, { D: 42738 })]))));
    assert.equal(in1900[0].raw.receivedAt, "2017-01-03");
  });

  test("날짜가 글자로 적힌 칸(YYYY/MM/DD · YYYY-MM-DD)", () => {
    const rows = okRows(
      parse(kyosanWorkbook(listSheet([dataRow(1, { D: "2021/01/05", O: "出荷済み", S: { shared: "2021-02-03" } })])))
    );
    const row = importable(rows[0]);
    assert.equal(row.raw.receivedAt, "2021-01-05");
    assert.equal(row.actualShipmentDate, "2021-02-03");
  });

  test("전각 콜론 상태 — 공유문자열로 적혀 있어도", () => {
    const rows = okRows(
      parse(
        kyosanWorkbook(
          listSheet([
            dataRow(1, { O: { shared: "中断：客先待ち" } }),
            dataRow(2, { G: "MB", F: "TEST-MODEL-MB", O: "中断：指示待ち" }),
          ])
        )
      )
    );
    assert.equal(importable(rows[0]).targetStepKey, "waiting_po");
    assert.equal(rows[0].raw.statusText, "中断：客先待ち");
    assert.equal(importable(rows[1]).targetStepKey, "waiting_kyosan_reply");
  });

  test("오류 칸(#N/A · #REF!)은 빈칸", () => {
    const rows = okRows(
      parse(kyosanWorkbook(listSheet([dataRow(1, { Y: { error: "#N/A" }, K: { error: "#REF!" } })])))
    );
    const row = importable(rows[0]);
    assert.equal(row.raw.endUserName, null);
    assert.deepEqual([row.billingType, row.billingReview, row.sourceBilling], ["PAID", true, null]);
  });

  test("제외 · 확인 필요 · 파일 안 중복이 읽은 줄에도 그대로", () => {
    const rows = okRows(
      parse(
        kyosanWorkbook(
          listSheet([
            dataRow(1),
            dataRow(2, { G: "TTB/DUO", F: "TEST-MODEL-TTB" }),
            dataRow(3, { I: null }),
            dataRow(4, { C: "D210101" }),
          ])
        )
      )
    );
    const duplicate = "인수번호 D210101 이 파일 안에 여러 번 있습니다(18·21행) — 한 번만 적혀 있어야 합니다.";
    assert.deepEqual(
      rows.map((row) => ({
        rowNumber: row.raw.rowNumber,
        outcome: row.outcome,
        detail: row.outcome === "NEEDS_REVIEW" ? row.reasons : row.outcome === "EXCLUDED" ? row.reason : null,
      })),
      [
        { rowNumber: 18, outcome: "NEEDS_REVIEW", detail: [duplicate] },
        {
          rowNumber: 19,
          outcome: "EXCLUDED",
          detail: '종류(G열)이 "TTB/DUO" 입니다 — TTB/DUO 는 가져오지 않습니다.',
        },
        { rowNumber: 20, outcome: "NEEDS_REVIEW", detail: ["S/N(I열)이 비어 있습니다."] },
        { rowNumber: 21, outcome: "NEEDS_REVIEW", detail: [duplicate] },
      ]
    );
  });
});

describe("파일 전체 거절", () => {
  test("머리글이 다르면 HEADER_MISMATCH — 어느 열이 무엇이었는지", () => {
    const header = headerCells({ G: headerCell("分類", "종류"), I: headerCell("S/N No.", "S/N"), Y: null });
    const result = parse(kyosanWorkbook(listSheet([dataRow(1)], { header })));
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "HEADER_MISMATCH");
    assert.deepEqual(result.mismatches, [
      { column: "G", expected: "種別", actual: "分類" },
      { column: "I", expected: "S/N", actual: "S/N No." },
      { column: "Y", expected: "費用", actual: null },
    ]);
    assert.match(result.message, /17행/);
  });

  test("リスト 시트가 없으면 SHEET_NOT_FOUND", () => {
    const list = listSheet([dataRow(1)]);
    const result = parse(buildWorkbook([{ name: "まとめ", rows: {} }, { ...list, name: "リスト (2)" }]));
    assert.equal(result.ok ? null : result.code, "SHEET_NOT_FOUND");
  });

  test("C열에 引取番号 가 없으면 HEADER_NOT_FOUND", () => {
    const noAnchor = parse(kyosanWorkbook(listSheet([dataRow(1)], { header: { B: "No.", D: "引取日" } })));
    assert.equal(noAnchor.ok ? null : noAnchor.code, "HEADER_NOT_FOUND");
    const emptySheet = parse(kyosanWorkbook({ name: "リスト", rows: {} }));
    assert.equal(emptySheet.ok ? null : emptySheet.code, "HEADER_NOT_FOUND");
  });

  test("안전 검사에 걸리면 UNSAFE_FILE", () => {
    const wrongExtension = parse(kyosanWorkbook(listSheet([dataRow(1)])), "引取品リスト.xls");
    assert.equal(wrongExtension.ok, false);
    if (wrongExtension.ok) return;
    assert.equal(wrongExtension.code, "UNSAFE_FILE");
    assert.ok(wrongExtension.safetyCodes?.includes("UNSUPPORTED_FILE_EXTENSION"));

    const notZip = parse(Buffer.from("not a zip"));
    assert.equal(notZip.ok ? null : notZip.code, "UNSAFE_FILE");
  });

  test("today 가 날짜가 아니면 던진다(부르는 쪽의 실수)", () => {
    assert.throws(
      () => parseKyosanIntakeWorkbook(kyosanWorkbook(listSheet([dataRow(1)])), "a.xlsx", { today: "20260915" }),
      /today/
    );
  });
});
