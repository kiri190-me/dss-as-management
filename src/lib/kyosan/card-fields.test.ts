import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { buildSheetGrid } from "../xlsx/sheet-grid";
import { CARD_FIELDS, CARD_LISTS, readCardFields } from "./card-fields";

/**
 * 🔴 시험용 연락서는 전부 **손으로 지은 가짜**다. 라벨(양식의 글자)만 실측에서
 * 가져오고 값 자리에는 `값A`·`값B` 를 넣는다 — 실제 연락서를 고정 시험 파일로
 * 넣으면 고객 정보가 git 에 영영 남는다.
 */

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

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
          .sort((a, b) => a.column.length - b.column.length || (a.column < b.column ? -1 : 1))
          .map((entry) => entry.xml)
          .join("")}</row>`
    )
    .join("");
  return buildSheetGrid(`<worksheet><sheetData>${rowsXml}</sheetData></worksheet>`, [], date1904);
}

/** 라벨은 그대로 두고 **줄 번호만 offset 만큼 민** 연락서를 만든다. */
function shiftRows(cells: Record<string, string | number>, offset: number): Record<string, string | number> {
  const shifted: Record<string, string | number> = {};
  for (const [address, value] of Object.entries(cells)) {
    const matched = /^([A-Z]+)(\d+)$/.exec(address);
    assert.ok(matched, address);
    shifted[`${matched[1]}${Number(matched[2]) + offset}`] = value;
  }
  return shifted;
}

/** 2020년대 매처(`Card`) 양식의 한 조각. 줄 번호는 실측(파일 하나)에서 가져왔다. */
const MODERN_CARD: Record<string, string | number> = {
  A11: "引取No.(Receiving_No.)",
  C11: "값-접수번호",
  A25: "客先(Customer)",
  C25: "값-고객사",
  A34: "型式(MODEL)",
  C34: "값-모델",
  F34: "---",
  A35: "L/N",
  C35: "값-로트",
  A36: "S/N",
  C36: "값-시리얼",
  A37: "製造L/N",
  C37: "-",
  A51: "詳細な内容(Requirements)",
  C51: "값-반품사유",
  B53: "客先故障状況①",
  C53: "값-증상1",
  F53: "―",
  B54: "客先故障状況②",
  C54: "―",
  F54: "―",
  A57: "不具合現象の詳細\r\n(Situation)",
  C57: "값-현상상세",
  B59: "社内確認結果①",
  C59: "값-사내확인",
  B62: "故障個所①/⑥",
  C62: "값-고장부위",
  A71: "交換部品(Action)",
  B71: "故障①/⑥",
  C71: "값-부품1",
  B72: "故障②/⑦",
  C72: "값-부품2",
  B76: "予防措置①/⑪",
  C76: "값-예방부품",
  A87: "６．原因(Main_Factor)",
  A88: "詳細(Details/Comments)",
  A89: "区分",
  C89: "값-원인구분",
};

describe("🔴 라벨이 다른 줄에 있어도 찾는다 — 고정 주소가 아니라는 못", () => {
  /**
   * 실측에서 `客先故障状況①` 이 판본에 따라 B53 · B51 에 있었다. 줄을 통째로
   * 밀어도 같은 값이 나와야 한다. 나오지 않으면 그 판독기는 판본 하나에서만
   * 맞는 판독기다.
   */
  const asIs = readCardFields(gridOf(MODERN_CARD), false);
  const pushedDown = readCardFields(gridOf(shiftRows(MODERN_CARD, 7)), false);
  const pulledUp = readCardFields(gridOf(shiftRows(MODERN_CARD, -2)), false);

  test("줄을 밀어도 값이 같다", () => {
    for (const spec of CARD_FIELDS) {
      assert.equal(pushedDown.fields[spec.key].value, asIs.fields[spec.key].value, spec.caption);
      assert.equal(pulledUp.fields[spec.key].value, asIs.fields[spec.key].value, spec.caption);
    }
    for (const spec of CARD_LISTS) {
      assert.deepEqual(pushedDown.lists[spec.key].values, asIs.lists[spec.key].values, spec.caption);
      assert.deepEqual(pulledUp.lists[spec.key].values, asIs.lists[spec.key].values, spec.caption);
    }
  });

  test("값을 읽어 온 칸 주소는 밀린 만큼 움직인다 — 진짜로 다른 줄에서 읽었다는 증거", () => {
    assert.equal(asIs.fields.intakeNumber.valueAddress, "C11");
    assert.equal(pushedDown.fields.intakeNumber.valueAddress, "C18");
    assert.equal(pulledUp.fields.intakeNumber.valueAddress, "C9");
  });
});

describe("머리 정보", () => {
  const read = readCardFields(gridOf(MODERN_CARD), false);

  test("접수번호·고객사·모델·S/N 을 라벨로 찾는다", () => {
    assert.equal(read.fields.intakeNumber.value, "값-접수번호");
    assert.equal(read.fields.customer.value, "값-고객사");
    assert.equal(read.fields.model.value, "값-모델");
    assert.equal(read.fields.serialNumber.value, "값-시리얼");
  });

  test("🔴 `L/N` 이 `製造L/N` 을 먹지 않는다 — 앞머리 일치라서 갈린다", () => {
    assert.equal(read.fields.lotNumber.value, "값-로트");
    assert.equal(read.fields.lotNumber.valueAddress, "C35");
    // 製造L/N 은 라벨은 있고 값은 빈칸 채움 `-` 뿐이다 → 없음.
    assert.equal(read.fields.manufacturingLot.labelAddress, "A37");
    assert.equal(read.fields.manufacturingLot.value, null);
  });

  test("🔴 `詳細な内容(Requirements)` 과 `詳細(Details/Comments)` 을 가른다", () => {
    assert.equal(read.fields.requirementDetail.value, "값-반품사유");
    assert.equal(read.fields.causeDetail.labelAddress, "A88");
    assert.equal(read.fields.causeDetail.value, null);
    assert.equal(read.fields.causeCategory.value, "값-원인구분");
  });
});

describe("🔴 없는 항목은 「없음」으로 — 빈 글자도 가짜 값도 아니다", () => {
  const read = readCardFields(gridOf(MODERN_CARD), false);

  test("라벨이 아예 없으면 값도 라벨 주소도 null", () => {
    assert.deepEqual(read.fields.progress, { value: null, labelAddress: null, valueAddress: null });
    assert.deepEqual(read.fields.recallCount, { value: null, labelAddress: null, valueAddress: null });
  });

  test("라벨은 있는데 칸이 비었으면 값만 null — 이 둘을 가르는 것이 S2·S3 의 근거다", () => {
    assert.equal(read.fields.causeDetail.labelAddress, "A88");
    assert.equal(read.fields.causeDetail.value, null);
  });

  test("빈칸 채움 `―` 만 든 줄은 목록에 들어가지 않는다", () => {
    assert.deepEqual(read.lists.customerFaults.values, ["값-증상1"]);
    assert.equal(read.lists.customerFaults.labelCount, 2);
  });

  test("값이 하나도 없는 목록은 빈 배열", () => {
    const empty = readCardFields(gridOf({ B53: "客先故障状況①", C53: "―", F53: "―" }), false);
    assert.deepEqual(empty.lists.customerFaults.values, []);
    assert.equal(empty.lists.customerFaults.labelCount, 1);
    assert.equal(empty.lists.customerFaults.usedLegacy, false);
  });
});

describe("목록 항목", () => {
  const read = readCardFields(gridOf(MODERN_CARD), false);

  test("🔴 교체 부품은 `故障①` 꼴 라벨을 줄마다 읽는다", () => {
    assert.deepEqual(read.lists.faultParts.values, ["값-부품1", "값-부품2"]);
    assert.equal(read.lists.faultParts.usedLegacy, false);
    assert.deepEqual(read.lists.preventiveParts.values, ["값-예방부품"]);
  });

  test("고장 부위와 교체 부품이 섞이지 않는다", () => {
    assert.deepEqual(read.lists.brokenPoints.values, ["값-고장부위"]);
  });

  test("같은 글자가 RF부·DC부에 한 번씩 적혀 있으면 한 번만 남는다", () => {
    const both = readCardFields(
      gridOf({ B71: "故障①/⑥", C71: "값-부품1", F71: "값-부품1", B72: "故障②/⑦", C72: "값-부품2" }),
      false
    );
    assert.deepEqual(both.lists.faultParts.values, ["값-부품1", "값-부품2"]);
  });
});

describe("옛 양식 되돌림 — 라벨 하나 아래 ①②③ 칸이 늘어선다", () => {
  /** 2010년대 변환본(실측)의 한 조각. 줄 번호도 항목 이름도 지금 양식과 다르다. */
  const legacy = gridOf({
    A42: "詳細な内容(Requirements)",
    C42: "값-반품사유",
    A43: "現象(Type_of_Alarm)",
    C43: "①",
    E43: "②",
    G43: "③",
    C44: "값-증상1",
    E44: "값-증상2",
    A46: "４．返却時の状況(Situation)",
    A50: "主な故障箇所\r\n(Broken_Points)",
    C50: "①",
    E50: "②",
    G50: "③",
    C51: "값-고장부위",
    A53: "５．処置(Action)",
    A54: "－－－",
    C54: "①",
    E54: "②",
    G54: "③",
    A55: "交換部品(Action)",
    C55: "값-부품1",
    A56: "予防措置(Preventive_Action)",
  });
  const read = readCardFields(legacy, false);

  test("주 라벨이 없으면 되돌림으로 읽고, 그 사실을 표시한다", () => {
    assert.deepEqual(read.lists.customerFaults.values, ["값-증상1", "값-증상2"]);
    assert.equal(read.lists.customerFaults.usedLegacy, true);
    assert.deepEqual(read.lists.brokenPoints.values, ["값-고장부위"]);
    assert.equal(read.lists.brokenPoints.usedLegacy, true);
    assert.deepEqual(read.lists.faultParts.values, ["값-부품1"]);
    assert.equal(read.lists.faultParts.usedLegacy, true);
  });

  test("되돌림 라벨의 칸이 비었으면 그래도 「없음」", () => {
    assert.deepEqual(read.lists.preventiveParts.values, []);
    assert.equal(read.lists.preventiveParts.usedLegacy, true);
  });

  test("옛 양식에도 머리 정보는 같은 라벨로 잡힌다", () => {
    assert.equal(read.fields.requirementDetail.value, "값-반품사유");
  });
});
