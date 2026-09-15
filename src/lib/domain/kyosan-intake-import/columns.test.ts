import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { GridCell, SheetGrid } from "@/lib/xlsx/sheet-grid";
import {
  KYOSAN_COLUMNS,
  columnCaption,
  findHeaderRow,
  headerFirstLine,
  headerKey,
  verifyHeaders,
} from "./columns";

function gridOf(rows: Record<number, Record<string, string | number>>): SheetGrid {
  const byRow = new Map<number, Map<string, GridCell>>();
  for (const [rowNumber, cells] of Object.entries(rows)) {
    byRow.set(
      Number(rowNumber),
      new Map(
        Object.entries(cells).map(([column, value]): [string, GridCell] => [
          column,
          typeof value === "number" ? { kind: "number", value } : { kind: "text", text: value },
        ])
      )
    );
  }
  return {
    date1904: false,
    rowNumbers: [...byRow.keys()].sort((a, b) => a - b),
    cells: (rowNumber) => byRow.get(rowNumber) ?? new Map(),
  };
}

/** 실제 원본처럼 일본어⏎한국어 두 줄. 지정 열이 아닌 칸(B·E)도 섞는다. */
const GOOD_HEADER: Record<string, string> = {
  B: "No.",
  C: "引取番号\n인수번호",
  D: "引取日\n인수일",
  E: "受付者",
  F: "型式\n모델",
  G: "種別\n종류",
  H: "L/N\nL/N",
  I: "S/N\nS/N",
  J: "客先名称\n고객사",
  K: "End-User\nEND-USER",
  L: "客先返却理由\n신고증상",
  O: "状態\n상태",
  S: "出荷日\n출하일",
  V: "報告書番号\n보고서 번호",
  Y: "費用\n유/무상",
};

describe("열 명세", () => {
  test("지정 열 13개 — 열 문자와 머리글 첫 줄", () => {
    assert.deepEqual(
      KYOSAN_COLUMNS.map((spec) => `${spec.column}:${spec.header}`),
      [
        "C:引取番号",
        "D:引取日",
        "F:型式",
        "G:種別",
        "H:L/N",
        "I:S/N",
        "J:客先名称",
        "K:End-User",
        "L:客先返却理由",
        "O:状態",
        "S:出荷日",
        "V:報告書番号",
        "Y:費用",
      ]
    );
    assert.equal(columnCaption("serialNumber"), "S/N(I열)");
    assert.equal(columnCaption("billingText"), "유/무상(Y열)");
  });
});

describe("머리글 행 찾기", () => {
  test("범례·요약을 지나 C열에 引取番号 가 든 첫 행(17행)", () => {
    const rows: Record<number, Record<string, string | number>> = { 1: { B: "引取品リスト" } };
    // 범례에 같은 글자가 있어도 C열이 아니면 머리글이 아니다.
    for (let row = 3; row <= 13; row += 1) rows[row] = { B: `凡例: 引取番号の付け方 ${row}` };
    rows[15] = { B: "件数", D: 10 };
    rows[16] = { B: "完了", C: 3 };
    rows[17] = GOOD_HEADER;
    rows[18] = { C: "D210101" };
    assert.equal(findHeaderRow(gridOf(rows)), 17);
  });

  test("행 번호를 박지 않는다 — 5행 머리글", () => {
    assert.equal(findHeaderRow(gridOf({ 2: { B: "title" }, 5: GOOD_HEADER, 6: { C: "D210101" } })), 5);
  });

  test("C열에 引取番号 가 없으면 null", () => {
    assert.equal(findHeaderRow(gridOf({ 17: { B: "引取番号", D: "引取日" } })), null);
    assert.equal(findHeaderRow(gridOf({})), null);
  });
});

describe("머리글 대조", () => {
  test("맞는 머리글 — 둘째 줄(한국어)은 보지 않는다", () => {
    assert.deepEqual(verifyHeaders(gridOf({ 17: GOOD_HEADER }), 17), []);
    assert.deepEqual(
      verifyHeaders(gridOf({ 17: { ...GOOD_HEADER, G: "種別\n분류(바뀐 한국어)" } }), 17),
      []
    );
  });

  test("NFKC · 공백 차이는 같은 머리글", () => {
    const header = {
      ...GOOD_HEADER,
      C: "  引取番号 \n인수번호",
      H: "Ｌ／Ｎ\nL/N",
      K: "End - User\nEND-USER",
      Y: "費用\r\n유/무상",
    };
    assert.deepEqual(verifyHeaders(gridOf({ 17: header }), 17), []);
  });

  test("다르면 어느 열이 무엇이었는지 전부", () => {
    const header: Record<string, string | number> = { ...GOOD_HEADER, G: "分類\n종류", I: 5 };
    delete header.Y;
    assert.deepEqual(verifyHeaders(gridOf({ 17: header }), 17), [
      { column: "G", expected: "種別", actual: "分類" },
      { column: "I", expected: "S/N", actual: "5" },
      { column: "Y", expected: "費用", actual: null },
    ]);
  });

  test("headerFirstLine · headerKey", () => {
    assert.equal(headerFirstLine(undefined), null);
    assert.equal(headerFirstLine({ kind: "text", text: "  \n  " }), null);
    assert.equal(headerFirstLine({ kind: "text", text: "引取番号\r\n인수번호" }), "引取番号");
    assert.equal(headerKey("Ｅｎｄ－Ｕｓｅｒ "), "End-User");
  });
});
