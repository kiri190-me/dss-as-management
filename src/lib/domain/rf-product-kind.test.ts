import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  classifyRfProductByModelName,
  rfProductCustomerCodeOf,
} from "./rf-product-kind";

/**
 * ============================================================================
 * 모델명 → RF 제품 종류
 * ============================================================================
 * 이 판정의 쓰임새는 고객사(ICD) 현황표의 「Parts 명」 칸을 **대신 채우는**
 * 것이다. 그래서 이 시험이 보는 것은 「되는가」보다 🔴 **「모르는 것을 아는 척
 * 하지 않는가」**다 — 빈칸은 사람이 보고 알아채지만 틀린 글자는 알아챌 방법이
 * 없다.
 *
 * 접두사 여섯은 사용자가 준 교산 제품 형식 그대로다(2026-09-30).
 * ============================================================================
 */

describe("제너레이터(RFG)와 매쳐(MB)를 앞 세 글자로 가른다", () => {
  test("제너레이터 셋", () => {
    assert.deepEqual(classifyRfProductByModelName("RFK500FH-JS"), {
      kind: "RFG",
      band: "SOURCE",
    });
    assert.deepEqual(classifyRfProductByModelName("CFK300FH-IC"), {
      kind: "RFG",
      band: "BIAS",
    });
    assert.deepEqual(classifyRfProductByModelName("KFK120M-AD"), {
      kind: "RFG",
      band: "BIAS",
    });
  });

  test("매쳐 셋", () => {
    assert.deepEqual(classifyRfProductByModelName("MBK500M-JS"), {
      kind: "MB",
      band: "SOURCE",
    });
    assert.deepEqual(classifyRfProductByModelName("CMK300M-IC"), {
      kind: "MB",
      band: "BIAS",
    });
    assert.deepEqual(classifyRfProductByModelName("KMK120M-AD"), {
      kind: "MB",
      band: "BIAS",
    });
  });

  test("소문자로 등록된 모델명도 가린다", () => {
    assert.deepEqual(classifyRfProductByModelName("rfk500fh-js"), {
      kind: "RFG",
      band: "SOURCE",
    });
  });

  test("앞뒤 공백은 지운다 — 마스터에 손으로 넣은 값이라 붙어 있는 일이 있다", () => {
    assert.deepEqual(classifyRfProductByModelName("  MBK500M-JS  "), {
      kind: "MB",
      band: "SOURCE",
    });
  });
});

describe("🔴 모르면 null 이다 — 짐작하지 않는다", () => {
  for (const unknown of [
    null,
    undefined,
    "",
    "  ",
    "AB",
    "XYZ999",
    "RF",
    "MB500M-JS", // 앞 세 글자가 MB5 다 — 표에 없다
    "제너레이터",
    123 as unknown as string,
  ]) {
    test(`${JSON.stringify(unknown)} → null`, () => {
      assert.equal(classifyRfProductByModelName(unknown), null);
    });
  }

  test("가운데 공백을 지워 가며 봐 주지 않는다", () => {
    // "R FK..." 를 RFK 로 읽어 주기 시작하면 어디까지 봐 줄지의 경계가 없어진다.
    assert.equal(classifyRfProductByModelName("R FK500FH-JS"), null);
  });
});

describe("모델명 끝의 고객사 표시", () => {
  test("세 가지를 읽는다", () => {
    assert.equal(rfProductCustomerCodeOf("RFK500FH-JS"), "JS");
    assert.equal(rfProductCustomerCodeOf("CFK300FH-IC"), "IC");
    assert.equal(rfProductCustomerCodeOf("KMK120M-AD"), "AD");
  });

  test("없거나 모르는 표시는 null", () => {
    assert.equal(rfProductCustomerCodeOf("RFK500FH"), null);
    assert.equal(rfProductCustomerCodeOf("RFK500FH-ZZ"), null);
    assert.equal(rfProductCustomerCodeOf(null), null);
  });

  test("가운데에 있는 글자를 끝으로 읽지 않는다", () => {
    assert.equal(rfProductCustomerCodeOf("RFK-JS-500"), null);
  });
});
