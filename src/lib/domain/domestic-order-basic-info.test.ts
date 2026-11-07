import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  domesticOrderBasicInfoBoxes,
  domesticOrderDetailHeadFacts,
  type DomesticOrderBasicInfoRow,
} from "./domestic-order-basic-info";
import { DUE_DATE_FROM_REPAIR_CASE_LABEL } from "./requested-due-date-link";

/**
 * ============================================================================
 * 「기타건 상세」의 머리 넷 · 기본정보 탭 — **값으로** 잰다 (2026-11-06)
 * ============================================================================
 * 재는 것:
 *  · 🔴 머리에 **품명 · 공급처 · 발행일자 · 발행번호** 넷이 **그 차례로** 선다.
 *  · 🔴 넷을 **내자 줄**에서 읽는다 — 발행일자·발행번호는 매퍼가 이미 접어 둔
 *    display* 둘이라, 견적서가 연결된 줄에서는 그 견적서의 값이 그대로 보인다.
 *  · 🔴 **견적서 없이 손으로 더한 줄에서도 머리가 선다** — 넷이 하나도 빠지지 않고,
 *    품명·공급처는 그 줄에 적은 값이 그대로 나온다.
 *  · 🔴 기본정보 탭에 내자 정리의 칸들이 한눈에 들어간다 — **박스 둘**로(2026-11-07).
 *  · 🔴 **사용자가 뺀 다섯 칸이 이 탭에 안 보인다** — 순번 · 인수번호 · L/N · S/N ·
 *    고장내역. 🔵 그 단언은 **값이 실제로 들어 있는 줄**로 해야 한다(아래 WITH_PRODUCT
 *    표본) — 전부 null 인 줄로 재면 「안 보인다」는 공짜로 통과한다.
 *  · 🔴 빌려 온 납기요청일에는 꼬리표가 붙는다 — 「내가 적은 값」으로 읽히지 않게.
 *
 * 🔵 **못 먼저** — 머리 알약이 빈 값에 사라지지 않는가(언제나 넷), 그리고 모든 칸의
 * `lines` 가 비어 있지 않은가. 둘 중 하나라도 무너지면 아래 단언들이 「없는 것을
 * 없다고 확인하는」 꼴이 된다.
 * ============================================================================
 */

/** 기타 견적서가 만든 줄 — 품명·번호·발행일자가 그 견적서에서 적혀 왔다. */
const QUOTE_BORN: DomesticOrderBasicInfoRow = {
  displayOrder: 12,
  displayIntakeNumber: null,
  customerName: "가나 테크",
  completedAt: null,
  purchaseOrderNumber: "PO-2026-0007",
  projectName: "라인 증설",
  orderIssuedDate: "2026-10-02",
  dueDates: [
    { dueDate: "2026-11-10", note: "1차분" },
    { dueDate: "2026-12-01", note: null },
  ],
  repairCaseCustomerRequestedDueDate: null,
  modelName: "케이블 교체 일식",
  lotNumber: null,
  serialNumber: null,
  reportedSymptom: null,
  displayQuoteIssuedDate: "2026-09-30",
  displayQuoteNumber: "DSS 2026-120",
  progressNote: "발주 대기",
  displayDeliveredDate: null,
  deliveredBy: null,
  taxInvoiceDate: null,
  displayAmountExcludingVat: "1234567.00",
  paymentCompleted: false,
  japanRemittanceNote: null,
  historyNote: null,
  etcNote: null,
};

/** 손으로 [행 추가] 한 줄 — 견적서가 아예 없다. 번호도 발행일자도 없다. */
const HAND_ADDED: DomesticOrderBasicInfoRow = {
  ...QUOTE_BORN,
  displayOrder: null,
  customerName: "다라 전자",
  modelName: "RFG-7",
  purchaseOrderNumber: null,
  projectName: null,
  orderIssuedDate: null,
  dueDates: [],
  repairCaseCustomerRequestedDueDate: null,
  displayQuoteIssuedDate: null,
  displayQuoteNumber: null,
  progressNote: null,
  displayAmountExcludingVat: null,
  completedAt: "2026-11-01T00:00:00.000Z",
};

/**
 * 🔵 **「안 보인다」를 재기 위한 표본** — 사용자가 뺀 다섯 칸에 값이 **실제로 들어
 * 있는** 줄이다. 위 둘은 그 칸들이 전부 비어 있어서, 그 줄로 「안 보인다」를 재면
 * 값이 없어서 안 보이는 것인지 빼서 안 보이는 것인지 가를 수 없다.
 *
 * 🔴 값은 전부 지어낸 것이다 — 이 저장소는 공개된다(실제 고객사·L/N·S/N 금지).
 */
const WITH_PRODUCT: DomesticOrderBasicInfoRow = {
  ...QUOTE_BORN,
  displayOrder: 12,
  displayIntakeNumber: "D990101",
  lotNumber: "LN-0001",
  serialNumber: "SN-0001",
  reportedSymptom: "전원이 들어오지 않음",
};

const labelsOf = (row: DomesticOrderBasicInfoRow) =>
  domesticOrderDetailHeadFacts(row).map((fact) => fact.label);

test("🔵 못 — 머리 알약은 빈 값에도 사라지지 않는다(언제나 넷)", () => {
  assert.equal(domesticOrderDetailHeadFacts(QUOTE_BORN).length, 4);
  assert.equal(domesticOrderDetailHeadFacts(HAND_ADDED).length, 4);
  const empty = domesticOrderDetailHeadFacts({
    modelName: null,
    customerName: null,
    displayQuoteIssuedDate: null,
    displayQuoteNumber: null,
  });
  assert.equal(empty.length, 4, "빈 줄에서 알약이 빠졌다 — 「덜 그려졌다」로 읽힌다");
  assert.deepEqual(
    empty.map((fact) => fact.value),
    ["-", "-", "-", "-"]
  );
});

test("🔵 못 — 기본정보의 모든 칸이 적어도 한 줄을 갖는다", () => {
  for (const row of [QUOTE_BORN, HAND_ADDED, WITH_PRODUCT]) {
    const fields = domesticOrderBasicInfoBoxes(row).flatMap((box) => box.fields);
    assert.ok(fields.length >= 18, `칸이 너무 적다(${fields.length})`);
    for (const field of fields) {
      assert.ok(field.lines.length > 0, `${field.label} 칸이 빈 배열이다`);
      for (const line of field.lines) assert.notEqual(line, "", `${field.label} 칸에 빈 글자가 있다`);
    }
  }
});

describe("🔴 머리 넷 — 품명 · 공급처 · 발행일자 · 발행번호", () => {
  test("이름과 차례가 사용자가 지목한 그대로다", () => {
    assert.deepEqual(labelsOf(QUOTE_BORN), ["품명", "공급처", "발행일자", "발행번호"]);
    assert.deepEqual(labelsOf(HAND_ADDED), ["품명", "공급처", "발행일자", "발행번호"]);
  });

  test("🔴 값은 **내자 줄**에서 온다 — 기타 견적서가 만든 줄", () => {
    assert.deepEqual(
      domesticOrderDetailHeadFacts(QUOTE_BORN).map((fact) => fact.value),
      // 품명 = 그 줄의 형식(= 견적서의 품명이 적혀 온 칸) · 공급처 = 그 줄의 고객사 ·
      // 발행일자·발행번호 = 연결된 견적서가 이긴 display* 둘.
      ["케이블 교체 일식", "가나 테크", "2026-09-30", "DSS 2026-120"]
    );
  });

  test("🔴 견적서 없이 손으로 더한 줄에서도 선다 — 품명·공급처가 그대로 나온다", () => {
    assert.deepEqual(
      domesticOrderDetailHeadFacts(HAND_ADDED).map((fact) => fact.value),
      ["RFG-7", "다라 전자", "-", "-"]
    );
  });

  test("⚠️ 공급처가 비면 \"-\" 다 — 견적서의 공급처 글자를 끌어오지 않는다", () => {
    const facts = domesticOrderDetailHeadFacts({ ...HAND_ADDED, customerName: null });
    assert.equal(facts[1].label, "공급처");
    assert.equal(facts[1].value, "-");
  });
});

describe("🔴 기본정보 탭 — 내자 정리의 내용이 한눈에", () => {
  const boxes = domesticOrderBasicInfoBoxes(QUOTE_BORN);
  const byLabel = new Map(
    boxes.flatMap((box) => box.fields.map((field) => [field.label, field] as const))
  );

  test("🔴 박스는 **둘**이고 이름이 사용자가 쓴 낱말 그대로다 (2026-11-07)", () => {
    assert.deepEqual(
      boxes.map((box) => box.label),
      ["제품 · 견적 · 납품", "줄 · 발주 · 정산 · 기타"]
    );
  });

  test("🔴 칸이 어느 박스에 서는지가 사용자가 말한 묶음 그대로다", () => {
    assert.deepEqual(
      boxes[0].fields.map((field) => field.label),
      // 제품(형식 하나) + 견적 · 납품 다섯.
      ["형식", "견적발행일", "견적서번호", "현황", "납품일", "납품자"]
    );
    assert.deepEqual(
      boxes[1].fields.map((field) => field.label),
      // 줄 둘 + 발주 넷 + 정산 넷 + 기타 둘. 차례는 예전 묶음 차례 그대로다.
      [
        "고객사",
        "완료 여부",
        "발주서번호",
        "PJT",
        "발주발행일",
        "납기요청일",
        "세금계산서발행일",
        "금액(VAT별도)",
        "입금완료 여부",
        "일본 송금",
        "이력",
        "기타",
      ]
    );
  });

  test("🔴 견적서 번호가 보인다(사용자가 콕 집어 말한 칸)", () => {
    assert.deepEqual(byLabel.get("견적서번호")?.lines, ["DSS 2026-120"]);
    assert.deepEqual(byLabel.get("견적발행일")?.lines, ["2026-09-30"]);
  });

  /**
   * 🔴 **사용자가 뺀 다섯 칸**(2026-11-07) — 「[제품]에서 L/N, S/N, 고장내역은 없어도
   * 돼」 · 「[줄]에서 순번, 인수번호는 없어도 돼」.
   *
   * 🔵 **값이 들어 있는 줄로 잰다.** 전부 비어 있는 줄로 재면 「안 보인다」가 공짜로
   * 통과하므로, 먼저 그 줄에 값이 **실제로 있다**를 단언하고 나서 말한다.
   */
  test("🔴 뺀 다섯 칸이 이 탭에 **안 보인다** — 값이 있는 줄에서도", () => {
    // ① 표본에 값이 정말 들어 있다.
    assert.equal(WITH_PRODUCT.displayOrder, 12);
    assert.equal(WITH_PRODUCT.displayIntakeNumber, "D990101");
    assert.equal(WITH_PRODUCT.lotNumber, "LN-0001");
    assert.equal(WITH_PRODUCT.serialNumber, "SN-0001");
    assert.equal(WITH_PRODUCT.reportedSymptom, "전원이 들어오지 않음");

    const fields = domesticOrderBasicInfoBoxes(WITH_PRODUCT).flatMap((box) => box.fields);
    // ② 그런데 이름표가 없다.
    for (const label of ["순번", "인수번호", "L/N", "S/N", "고장내역"]) {
      assert.ok(
        !fields.some((field) => field.label === label),
        `${label} 칸이 아직 기본정보 탭에 있다`
      );
    }
    // ③ 그리고 **값 글자도** 어느 칸에도 안 섞여 있다(이름표만 지우고 다른 칸에
    //    붙여 두는 일이 없게).
    const printed = fields.flatMap((field) => field.lines).join("");
    for (const value of ["D990101", "LN-0001", "SN-0001", "전원이 들어오지 않음"]) {
      assert.ok(!printed.includes(value), `${value} 가 아직 화면에 그려진다`);
    }
  });

  test("남은 칸들은 빠짐없이 들어 있다", () => {
    for (const label of [
      "고객사",
      "완료 여부",
      "발주서번호",
      "PJT",
      "발주발행일",
      "납기요청일",
      "형식",
      "견적발행일",
      "견적서번호",
      "현황",
      "납품일",
      "납품자",
      "세금계산서발행일",
      "금액(VAT별도)",
      "입금완료 여부",
      "일본 송금",
      "이력",
      "기타",
    ]) {
      assert.ok(byLabel.has(label), `${label} 칸이 없다`);
    }
  });

  test("금액 · 입금 여부 · 완료 여부는 목록과 같은 말로 그려진다", () => {
    assert.deepEqual(byLabel.get("금액(VAT별도)")?.lines, ["1,234,567"]);
    assert.deepEqual(byLabel.get("입금완료 여부")?.lines, ["미완료"]);
    assert.deepEqual(byLabel.get("완료 여부")?.lines, ["진행 중"]);

    const done = new Map(
      domesticOrderBasicInfoBoxes(HAND_ADDED)
        .flatMap((box) => box.fields)
        .map((field) => [field.label, field] as const)
    );
    assert.deepEqual(done.get("입금완료 여부")?.lines, ["미완료"]);
    assert.deepEqual(done.get("완료 여부")?.lines, ["완료"]);
    assert.deepEqual(done.get("금액(VAT별도)")?.lines, ["-"]);
  });

  test("발주일이 없는 줄은 \"-\" 가 아니라 목록과 같은 말을 쓴다", () => {
    const hand = domesticOrderBasicInfoBoxes(HAND_ADDED)
      .flatMap((box) => box.fields)
      .find((field) => field.label === "발주발행일");
    assert.deepEqual(hand?.lines, ["발주일 미정"]);
    assert.deepEqual(byLabel.get("발주발행일")?.lines, ["2026-10-02"]);
  });

  test("🔴 납기요청일은 한 줄에 하나씩 전부, 메모가 있으면 괄호로", () => {
    assert.deepEqual(byLabel.get("납기요청일")?.lines, ["2026-11-10 (1차분)", "2026-12-01"]);
    // 이 줄에 적힌 날짜라 꼬리표가 붙지 않는다.
    assert.equal(byLabel.get("납기요청일")?.note, undefined);
  });

  test("🔴 빌려 온 납기요청일에는 꼬리표가 붙는다", () => {
    const borrowed = domesticOrderBasicInfoBoxes({
      ...QUOTE_BORN,
      dueDates: [],
      repairCaseCustomerRequestedDueDate: "2026-12-24",
    })
      .flatMap((box) => box.fields)
      .find((field) => field.label === "납기요청일");
    assert.deepEqual(borrowed?.lines, ["2026-12-24"]);
    assert.equal(borrowed?.note, DUE_DATE_FROM_REPAIR_CASE_LABEL);
  });

  test("양쪽 다 없으면 빈 칸이고 꼬리표도 없다", () => {
    const none = domesticOrderBasicInfoBoxes(HAND_ADDED)
      .flatMap((box) => box.fields)
      .find((field) => field.label === "납기요청일");
    assert.deepEqual(none?.lines, ["-"]);
    assert.equal(none?.note, undefined);
  });
});
