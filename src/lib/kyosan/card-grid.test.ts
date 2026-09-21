import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { buildSheetGrid } from "../xlsx/sheet-grid";
import {
  CARD_VALUE_COLUMNS,
  findLabelCells,
  isCheckMark,
  isDashPlaceholder,
  isOrdinalMark,
  normalizeKey,
  ordinalHeaderColumns,
  readDateValue,
  readValuesFor,
  valueColumnsForRow,
} from "./card-grid";

/**
 * ============================================================================
 * 🔴 시험용 연락서는 전부 **손으로 지은 가짜**다
 * ============================================================================
 * 실제 연락서에는 고객명·모델·S/N·고장 내용이 그대로 들어 있다. 한 장이라도
 * 고정 시험 파일로 넣으면 그 고객 정보가 git 에 영영 남는다. 그래서 여기서는
 * 라벨(양식의 글자)만 실측에서 가져오고, 값 자리에는 `값A`·`값B` 를 넣는다.
 * ============================================================================
 */

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** `{ "B53": "라벨", "C53": "값A" }` → 격자. 숫자를 주면 숫자 칸이 된다. */
function gridOf(cells: Record<string, string | number>, date1904 = false) {
  const byRow = new Map<number, { column: string; xml: string }[]>();
  for (const [address, value] of Object.entries(cells)) {
    const matched = /^([A-Z]+)(\d+)$/.exec(address);
    assert.ok(matched, `칸 주소가 아니다: ${address}`);
    const row = Number(matched[2]);
    const xml =
      typeof value === "number"
        ? `<c r="${address}"><v>${value}</v></c>`
        : `<c r="${address}" t="inlineStr"><is><t>${escapeXml(value)}</t></is></c>`;
    byRow.set(row, [...(byRow.get(row) ?? []), { column: matched[1], xml }]);
  }
  const rowsXml = [...byRow.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(
      ([row, entries]) =>
        `<row r="${row}">${entries
          .sort((a, b) => (a.column.length - b.column.length) || (a.column < b.column ? -1 : 1))
          .map((entry) => entry.xml)
          .join("")}</row>`
    )
    .join("");
  return buildSheetGrid(`<worksheet><sheetData>${rowsXml}</sheetData></worksheet>`, [], date1904);
}

describe("normalizeKey — 대조용으로 누르는 법", () => {
  test("반각 가타카나가 전각이 된다(NFKC)", () => {
    assert.equal(normalizeKey("ﾕﾆｯﾄ名"), normalizeKey("ユニット名"));
    assert.equal(normalizeKey("ｶｰﾄﾞ"), normalizeKey("カード"));
  });

  test("공백은 전부 없애고 소문자로 — 전각 공백·줄바꿈도", () => {
    assert.equal(normalizeKey("担　当"), "担当");
    assert.equal(normalizeKey("OP. TIME"), "op.time");
    assert.equal(normalizeKey("備考\r\n(Notes)"), "備考(notes)");
  });

  test("🔴 동그라미 번호는 보통 숫자가 된다 — 라벨 정규식을 `\\d` 로 적어야 하는 까닭", () => {
    assert.equal(normalizeKey("故障①/⑥"), "故障1/6");
    assert.equal(normalizeKey("予防措置⑪"), "予防措置11");
    // `[①-⑳]` 로 적으면 하나도 맞지 않는다는 것을 여기서 못 박는다.
    assert.equal(/^故障[①-⑳]/.test(normalizeKey("故障①/⑥")), false);
    assert.equal(/^故障\d/.test(normalizeKey("故障①/⑥")), true);
    // 고장 부위 라벨은 숫자로 이어지지 않으므로 교체 부품 정규식에 걸리지 않는다.
    assert.equal(/^故障\d/.test(normalizeKey("故障箇所")), false);
    assert.equal(/^故障\d/.test(normalizeKey("故障個所①/⑥")), false);
  });
});

describe("빈칸 채움과 칸 머리글", () => {
  test("줄표만 든 칸은 값이 아니다", () => {
    for (const filler of ["-", "―", "－－－", "---------", "‐", "ー", " - "]) {
      assert.equal(isDashPlaceholder(filler), true, filler);
    }
    assert.equal(isDashPlaceholder("정상"), false);
    assert.equal(isDashPlaceholder("R-5"), false);
  });

  test("동그라미 번호와 체크 표시를 알아본다", () => {
    assert.equal(isOrdinalMark("①"), true);
    assert.equal(isOrdinalMark("⑳"), true);
    assert.equal(isOrdinalMark("①②"), false);
    assert.equal(isCheckMark("○"), true);
    assert.equal(isCheckMark("〇"), true);
    assert.equal(isCheckMark("レ"), true);
    assert.equal(isCheckMark("OK"), false);
  });
});

describe("findLabelCells — 🔴 라벨은 A·B 열에서만 찾는다", () => {
  /**
   * 실측 함정: `返却先` 의 값이 드롭다운에서 고른 `客先(Customer)` 라서 C21 에
   * 라벨과 똑같은 글자가 앉는다. C 열까지 라벨로 보면 진짜 라벨 A25 대신 C21 을
   * 집고, 그 줄 오른쪽에는 값이 없으므로 고객사가 통째로 「없음」이 된다.
   */
  const grid = gridOf({
    A21: "返却先",
    C21: "客先(Customer)",
    A25: "客先(Customer)",
    C25: "값A",
  });

  test("값 자리에 앉은 같은 글자는 라벨로 세지 않는다", () => {
    const found = findLabelCells(grid, "客先(customer)");
    assert.deepEqual(
      found.map((cell) => cell.address),
      ["A25"]
    );
  });

  test("찾은 라벨에서 값을 읽으면 진짜 값이 나온다", () => {
    const [label] = findLabelCells(grid, "客先(customer)");
    assert.deepEqual(readValuesFor(grid, label), [{ address: "C25", text: "값A" }]);
  });
});

describe("readValuesFor — 🔴 값은 C·F 에서만 읽는다", () => {
  /**
   * 실측 함정: 제너레이터 양식의 교체부품 30줄에서 D·E·G·H 가 **같은 공유문자열
   * 하나**를 가리킨다(숨은 도움 열). C 가 `―` 일 때 오른쪽으로 훑으면 그 글자가
   * 부품 이름으로 둔갑한다.
   */
  test("C 가 빈칸 채움이면 D·E·G·H 를 주워 오지 않는다", () => {
    const grid = gridOf({
      B67: "故障①",
      C67: "―",
      D67: "숨은도움글자",
      E67: "숨은도움글자",
      F67: "―",
      G67: "숨은도움글자",
      H67: "숨은도움글자",
      I67: "OK",
    });
    const [label] = findLabelCells(grid, /^故障\d/);
    assert.deepEqual(readValuesFor(grid, label), []);
  });

  test("RF부(C)와 DC부(F)를 둘 다 읽는다", () => {
    const grid = gridOf({ B71: "故障①/⑥", C71: "값A", F71: "값B" });
    const [label] = findLabelCells(grid, /^故障\d/);
    assert.deepEqual(readValuesFor(grid, label), [
      { address: "C71", text: "값A" },
      { address: "F71", text: "값B" },
    ]);
  });

  test("검증 표시(I 열의 OK/NG)는 값이 아니다", () => {
    const grid = gridOf({ B54: "客先故障状況②", C54: "―", F54: "―", I54: "OK" });
    const [label] = findLabelCells(grid, "客先故障状況");
    assert.deepEqual(readValuesFor(grid, label), []);
    assert.deepEqual(CARD_VALUE_COLUMNS, [3, 6]);
  });
});

describe("동그라미 번호 묶음 — 옛 양식은 값이 라벨 **아래**에 있다", () => {
  const grid = gridOf({
    A50: "主な故障箇所\r\n(Broken_Points)",
    C50: "①",
    E50: "②",
    G50: "③",
    C51: "값A",
    E51: "값B",
    A53: "５．処置(Action)",
  });

  test("머리글 줄을 알아본다", () => {
    assert.deepEqual(ordinalHeaderColumns(grid, 50), [3, 5, 7]);
    assert.deepEqual(ordinalHeaderColumns(grid, 51), []);
  });

  test("값은 아래 줄에서, 다음 라벨 줄 직전까지", () => {
    const [label] = findLabelCells(grid, "主な故障箇所");
    assert.deepEqual(readValuesFor(grid, label), [
      { address: "C51", text: "값A" },
      { address: "E51", text: "값B" },
    ]);
  });

  test("머리글을 아래 줄이 물려받는다 — 옛 양식의 처치 묶음", () => {
    const action = gridOf({
      A54: "－－－",
      C54: "①",
      E54: "②",
      G54: "③",
      A55: "交換部品(Action)",
      C55: "값A",
      E55: "값B",
    });
    assert.deepEqual(valueColumnsForRow(action, 55), [3, 5, 7]);
    const [label] = findLabelCells(action, "交換部品(");
    assert.deepEqual(readValuesFor(action, label), [
      { address: "C55", text: "값A" },
      { address: "E55", text: "값B" },
    ]);
  });
});

describe("readDateValue — 일련번호를 YYYY-MM-DD 로", () => {
  test("1900 체계", () => {
    const grid = gridOf({ A10: "引取日(Receiving_Date)", C10: 46086 });
    const [label] = findLabelCells(grid, "引取日");
    assert.deepEqual(readDateValue(grid, label, false), { address: "C10", text: "2026-03-05" });
  });

  test("1904 체계는 같은 날이 1462 만큼 작다", () => {
    const grid = gridOf({ A10: "引取日(Receiving_Date)", C10: 46086 - 1462 }, true);
    const [label] = findLabelCells(grid, "引取日");
    assert.deepEqual(readDateValue(grid, label, true), { address: "C10", text: "2026-03-05" });
  });

  test("빈칸 채움이면 없음", () => {
    const grid = gridOf({ A20: "返却日(Shipping-Date)", C20: "-" });
    const [label] = findLabelCells(grid, "返却日");
    assert.equal(readDateValue(grid, label, false), null);
  });

  test("글자로 적힌 날짜는 모양만 맞춰 준다 — 못 알아보면 그대로 둔다", () => {
    const grid = gridOf({ A8: "記入日(Receiption_Dates)", C8: "2022/6/1" });
    const [label] = findLabelCells(grid, "記入日");
    assert.deepEqual(readDateValue(grid, label, false), { address: "C8", text: "2022-06-01" });

    const odd = gridOf({ A8: "記入日(Receiption_Dates)", C8: "22년 6월경" });
    const [oddLabel] = findLabelCells(odd, "記入日");
    assert.deepEqual(readDateValue(odd, oddLabel, false), { address: "C8", text: "22년 6월경" });
  });
});
