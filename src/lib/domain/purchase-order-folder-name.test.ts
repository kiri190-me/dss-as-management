import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { purchaseOrderProductKey, readPurchaseOrderFolderName } from "./purchase-order-folder-name";

/**
 * ============================================================================
 * 발주서 폴더 이름 읽기 — 날짜 · L/N · S/N (2026-10-12)
 * ============================================================================
 * 🔴 **디스크를 보지 않는다** — 순수 함수에 글자만 넣는다. 실제 폴더를 훑는 일은
 * storage/purchase-order-archive.test.ts 가 임시 폴더에서 본다.
 *
 * 🔴 여기 적힌 **폴더 이름 모양**은 사용자가 탐색기에서 보여 준 실제 모양이다(고객사 이름은
 * 폴더 이름에 들어가지 않는 자리라 그대로 두었고, PO 번호 · 모델 · L/N · S/N 은 그 모양을
 * 따른 값이다).
 * ============================================================================
 */

/** 🔴 실제 폴더 이름 — 사용자가 보여 준 그대로. */
const REAL = "101. 내자 20251223_PO4500371858_MBKK200-JS2_WN1183_1708076 - 16,720,000원";
/** 🔴 실제 폴더 이름 둘째 — 같은 서류함의 다른 장비. */
const REAL_2 = "124. 내자 20261006_PO4500397970_MBK200-JS2_WV0997_2210149 - 15,950,000원";
/** 🔴 실제 외자 폴더 이름 — 날짜도 L/N 도 S/N 도 없다. */
const REAL_FOREIGN = "1. 외자 Purchase Order_JUSUNG_CSOT_4500391219_JPY16,295,000";

describe("발주 건 폴더 이름을 읽는다", () => {
  test("🔴 실제 이름에서 날짜 · L/N · S/N 을 읽는다", () => {
    assert.deepEqual(readPurchaseOrderFolderName(REAL), {
      issuedDate: "2025-12-23",
      lotNumber: "WN1183",
      serialNumber: "1708076",
    });
    assert.deepEqual(readPurchaseOrderFolderName(REAL_2), {
      issuedDate: "2026-10-06",
      lotNumber: "WV0997",
      serialNumber: "2210149",
    });
  });

  test("🔴 **외자 폴더는 null 이다** — 날짜도 L/N 도 S/N 도 없다", () => {
    assert.equal(readPurchaseOrderFolderName(REAL_FOREIGN), null);
  });

  test("🔴 `내자` 라는 낱말로 가르지 않는다 — **읽을 수 있는가**로 가른다", () => {
    // 구분 글자가 없어도 자리가 맞으면 읽힌다.
    assert.deepEqual(readPurchaseOrderFolderName("101. 20251223_PO4500371858_MODEL_WN1183_1708076"), {
      issuedDate: "2025-12-23",
      lotNumber: "WN1183",
      serialNumber: "1708076",
    });
    // `내자` 가 적혀 있어도 날짜가 없으면 안 읽힌다.
    assert.equal(readPurchaseOrderFolderName("101. 내자 PO4500371858_MODEL_WN1183_1708076"), null);
  });

  test("🔴 바로 가기 · 임시 폴더 이름은 null 이다", () => {
    assert.equal(readPurchaseOrderFolderName("임시 발주서 및 신용장"), null);
    assert.equal(readPurchaseOrderFolderName("임시 발주서 및 신용장 - 바로 가기"), null);
    assert.equal(readPurchaseOrderFolderName("2026"), null);
    assert.equal(readPurchaseOrderFolderName("1. 주성엔지니어링"), null);
  });

  test("🔴 PO 번호의 숫자가 날짜로 읽히지 않는다", () => {
    // `PO4500371858` 안에도 여덟 자리가 있지만 **첫 마디의 끝**이 아니다.
    assert.equal(readPurchaseOrderFolderName("101. 내자 PO4500371858_MODEL_WN1183_1708076 - 1원"), null);
    // 날짜 자리에 열 자리 숫자가 와도 안 읽힌다(앞이 숫자면 끝의 여덟 자리가 아니다).
    assert.equal(readPurchaseOrderFolderName("101. 내자 4500371858_MODEL_WN1183_1708076"), null);
  });

  test("🔴 달력에 없는 날은 날짜가 아니다 — 지어내지 않는다", () => {
    for (const bad of ["20251332", "20250230", "20250000", "19991223", "21001223"]) {
      assert.equal(
        readPurchaseOrderFolderName(`101. 내자 ${bad}_PO1_MODEL_WN1183_1708076`),
        null,
        `${bad} 를 날짜로 읽었다`
      );
    }
    // 윤년은 읽힌다(2024-02-29 는 있는 날이다).
    assert.equal(readPurchaseOrderFolderName("1. 내자 20240229_PO1_MODEL_WN1183_1708076")?.issuedDate, "2024-02-29");
  });

  test("🔴 금액 꼬리를 뗀다 — 모델 · S/N 의 하이픈은 그대로다", () => {
    assert.equal(readPurchaseOrderFolderName(REAL)?.serialNumber, "1708076");
    // 꼬리가 없어도 읽힌다.
    assert.equal(
      readPurchaseOrderFolderName("101. 내자 20251223_PO1_MBKK200-JS2_WN1183_1708076")?.serialNumber,
      "1708076"
    );
    // 띄어쓴 하이픈만 꼬리다 — 모델 이름의 하이픈은 L/N · S/N 자리에 있지도 않다.
    assert.equal(
      readPurchaseOrderFolderName("101. 내자 20251223_PO1_MODEL_WN-1183_1708076-1 - 1,000원")?.lotNumber,
      "WN-1183"
    );
    assert.equal(
      readPurchaseOrderFolderName("101. 내자 20251223_PO1_MODEL_WN-1183_1708076-1 - 1,000원")?.serialNumber,
      "1708076-1"
    );
  });

  test("🔴 NFD · 연속 공백으로 앉은 이름도 읽는다 — 사람이 만든 폴더다", () => {
    const nfd = REAL.normalize("NFD");
    assert.notEqual(nfd, REAL, "이 환경에서 NFD 가 같은 글자다 — 시험이 뜻을 잃었다");
    assert.deepEqual(readPurchaseOrderFolderName(nfd), {
      issuedDate: "2025-12-23",
      lotNumber: "WN1183",
      serialNumber: "1708076",
    });
    assert.deepEqual(readPurchaseOrderFolderName("101.  내자   20251223_PO1_MODEL_WN1183_1708076"), {
      issuedDate: "2025-12-23",
      lotNumber: "WN1183",
      serialNumber: "1708076",
    });
  });

  test("🔴 자리가 모자라면 null 이다 — 반쯤 읽어 지어내지 않는다", () => {
    assert.equal(readPurchaseOrderFolderName("101. 내자 20251223_WN1183"), null);
    assert.equal(readPurchaseOrderFolderName("101. 내자 20251223"), null);
    assert.equal(readPurchaseOrderFolderName("101. 내자 20251223_PO1_ - 1원"), null);
    assert.equal(readPurchaseOrderFolderName(""), null);
    assert.equal(readPurchaseOrderFolderName(undefined as unknown as string), null);
  });
});

describe("장비 열쇠", () => {
  test("🔴 둘 다 있어야 만들어진다 — 하나라도 비면 null", () => {
    assert.equal(purchaseOrderProductKey("WN1183", "1708076"), "WN1183|1708076");
    assert.equal(purchaseOrderProductKey("", "1708076"), null);
    assert.equal(purchaseOrderProductKey("WN1183", ""), null);
    assert.equal(purchaseOrderProductKey(null, null), null);
    assert.equal(purchaseOrderProductKey(undefined, undefined), null);
    // 🔴 빈 칸을 `-` 로 채워 내려보내는 자리가 있다 — 그것도 빈 값이다.
    assert.equal(purchaseOrderProductKey("-", "1708076"), null);
    assert.equal(purchaseOrderProductKey("WN1183", " - "), null);
  });

  test("🔴 대소문자 · 앞뒤 공백 · NFD 가 같은 열쇠가 된다", () => {
    const key = purchaseOrderProductKey("WN1183", "1708076");
    assert.equal(purchaseOrderProductKey("wn1183", " 1708076 "), key);
    assert.equal(purchaseOrderProductKey("Wn1183".normalize("NFD"), "1708076"), key);
  });

  test("🔴 L/N 과 S/N 이 **둘 다** 맞아야 같은 열쇠다 — 뒤바뀌면 다른 열쇠다", () => {
    assert.notEqual(purchaseOrderProductKey("WN1183", "1708076"), purchaseOrderProductKey("1708076", "WN1183"));
    // 같은 S/N 에 모델(L/N)이 다른 장비는 다른 열쇠다.
    assert.notEqual(purchaseOrderProductKey("WN1183", "1708076"), purchaseOrderProductKey("WV0997", "1708076"));
  });

  test("🔴 폴더에서 읽은 값과 수리 건의 값이 **같은 함수**로 맞춰진다", () => {
    const read = readPurchaseOrderFolderName(REAL);
    assert.ok(read !== null);
    assert.equal(
      purchaseOrderProductKey(read.lotNumber, read.serialNumber),
      purchaseOrderProductKey(" wn1183 ", "1708076")
    );
  });
});
