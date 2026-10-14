import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  buildIntakeLookupResponse,
  isValidIntakeNumber,
  normalizeIntakeNumber,
  type ExternalIntakeRow,
} from "./intake-lookup";

/**
 * ============================================================================
 * 인수번호 조회 통로가 글자로 하는 일
 * ============================================================================
 * 모양 검사는 재고 관리 쪽 `INTAKE_NUMBER_RE`(`src/lib/stock/codes.ts` 의
 * `/^D\d{6}$/`)와 **같은 규칙**이어야 한다. 두 시스템이 다른 잣대로 재면 한쪽이
 * 400 으로 막는 번호를 다른 쪽은 보내 온다.
 *
 * 응답 만들기에서 지키는 것 하나: 🔴 **없는 값은 빈 글자다.** 받는 쪽의
 * `IntakeInfo` 여섯 칸이 전부 string 이고, 화면이 그 값을 이어 붙여 사용처 글자를
 * 만든다 — null 이 가면 거기에 "null" 이 박힌다.
 * ============================================================================
 */

describe("인수번호 모양 검사", () => {
  test("D + 숫자 6자리는 통과한다", () => {
    for (const ok of ["D260701", "D000000", "D999999"]) {
      assert.equal(isValidIntakeNumber(ok), true, `${ok} 를 막았다`);
    }
  });

  test("D 가 없으면 거절한다", () => {
    assert.equal(isValidIntakeNumber("260701"), false);
  });

  test("숫자가 모자라거나 넘치면 거절한다", () => {
    assert.equal(isValidIntakeNumber("D26070"), false);
    assert.equal(isValidIntakeNumber("D2607012"), false);
  });

  test("빈 값은 거절한다", () => {
    assert.equal(isValidIntakeNumber(""), false);
    assert.equal(isValidIntakeNumber(" "), false);
  });

  test("숫자가 아닌 글자가 섞이면 거절한다", () => {
    for (const bad of ["D26070A", "DD260701", "D-260701", "D260701 ", "X260701"]) {
      assert.equal(isValidIntakeNumber(bad), false, `${bad} 를 통과시켰다`);
    }
  });

  test("다듬기가 공백을 떼고 대문자로 바꾼다 — d260701 도 같은 번호다", () => {
    assert.equal(normalizeIntakeNumber("  d260701 "), "D260701");
    assert.equal(isValidIntakeNumber(normalizeIntakeNumber(" d260701 ")), true);
  });

  test("다듬어도 가운데 공백은 살아남아 거절된다", () => {
    assert.equal(isValidIntakeNumber(normalizeIntakeNumber("D 260701")), false);
  });
});

describe("응답 만들기", () => {
  const full: ExternalIntakeRow = {
    intakeNumber: "D260701",
    customerName: "가나다 주식회사",
    endUser: "라마바 사업장",
    productModel: "TG-100",
    productSerial: "SN-0001",
    productLot: "LN-0001",
  };

  test("여섯 칸이 약속한 이름 그대로 나간다", () => {
    assert.deepEqual(buildIntakeLookupResponse(full), {
      intakeNumber: "D260701",
      customerName: "가나다 주식회사",
      endUser: "라마바 사업장",
      productModel: "TG-100",
      productSerial: "SN-0001",
      productLot: "LN-0001",
    });
  });

  test("🔴 없는 값은 빈 글자다 — null 이 그대로 나가지 않는다", () => {
    const sparse: ExternalIntakeRow = {
      intakeNumber: "D260701",
      customerName: "가나다 주식회사",
      endUser: null,
      productModel: "TG-100",
      productSerial: null,
      productLot: null,
    };
    const built = buildIntakeLookupResponse(sparse);
    assert.deepEqual(built, {
      intakeNumber: "D260701",
      customerName: "가나다 주식회사",
      endUser: "",
      productModel: "TG-100",
      productSerial: "",
      productLot: "",
    });
    // JSON 으로 구워도 null 이 섞여 있지 않은가 — 받는 쪽이 보는 것은 이 글자다.
    assert.ok(!JSON.stringify(built).includes("null"), "응답에 null 이 들어 있다");
  });

  test("조인이 하나도 안 붙은 건도 번호만 남고 나머지는 빈 글자다", () => {
    const empty: ExternalIntakeRow = {
      intakeNumber: "D260701",
      customerName: null,
      endUser: null,
      productModel: null,
      productSerial: null,
      productLot: null,
    };
    assert.deepEqual(buildIntakeLookupResponse(empty), {
      intakeNumber: "D260701",
      customerName: "",
      endUser: "",
      productModel: "",
      productSerial: "",
      productLot: "",
    });
  });

  test("앞뒤 공백은 떼고 내보낸다", () => {
    const padded: ExternalIntakeRow = { ...full, customerName: "  가나다 주식회사  ", productLot: "   " };
    const built = buildIntakeLookupResponse(padded);
    assert.equal(built.customerName, "가나다 주식회사");
    assert.equal(built.productLot, "");
  });

  test("칸이 여섯 개뿐이다 — 묻지 않은 것이 따라 나가지 않는다", () => {
    assert.deepEqual(Object.keys(buildIntakeLookupResponse(full)).sort(), [
      "customerName",
      "endUser",
      "intakeNumber",
      "productLot",
      "productModel",
      "productSerial",
    ]);
  });
});
