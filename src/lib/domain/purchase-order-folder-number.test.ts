import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { readPurchaseOrderFolderName } from "./purchase-order-folder-name";
import { purchaseOrderNumberKey, readPurchaseOrderFolderNumber } from "./purchase-order-folder-number";

/**
 * ============================================================================
 * 발주 건 폴더 이름에서 **발주서번호를 읽는다** — 둘째 마디 (2026-11-06)
 * ============================================================================
 * 기타건(내자 정리 한 줄)의 「발주서」 탭이 공유폴더를 찾을 때 쓰는 읽기. 실제로 폴더를
 * 훑는 일은 lib/storage/purchase-order-number-archive.test.ts 가 임시 폴더에서 본다.
 *
 * 여기서 못 박는 것은 다섯이다:
 *  · 🔴 **둘째 마디**를 읽는다 — 첫 마디의 날짜나 뒤의 내용에 번호 비슷한 글자가 있어도
 *    걸리지 않는다(느슨하면 남의 발주 건 폴더 안이 통째로 뜬다)
 *  · 🔴 **양식이 다른 번호가 다 읽힌다** — 고객사마다 다르다(9자리 · 10자리 SAP 꼴). 모양을
 *    정규식으로 못 박지 않았다는 증거다
 *  · 🔴 **금액 꼬리**를 뗀다 — 이웃(purchase-order-folder-name.ts)이 떼는 것과 **같은 꼬리**다
 *    (두 벌이 갈라지지 않았는지 두 함수를 나란히 돌려 본다)
 *  · 🔴 못 읽으면 null — 지어내지 않는다
 *  · 🔴 **수리 건 길은 그대로다** — 같은 이름에서 두 함수가 **다른 마디**를 읽는다
 *
 * 🔴 고객사 · 모델 · 번호는 전부 **가짜**다(이 저장소는 공개다). 모양만 실측과 같게 맞췄다.
 * ============================================================================
 */

/** 🔴 가짜 이름 — 사용자가 보여 준 **기타건** 폴더의 모양 그대로다(마디 셋). */
const OTHER_FOLDER = "117. 내자 20261103_PO261103031_(고객) 30kW 부속케이블 3SET - (금액)";
/** 🔴 가짜 이름 — **수리 건** 폴더의 모양(마디 다섯). 앞 세 마디가 위와 같다. */
const REPAIR_FOLDER = "101. 내자 20251223_PO4500371858_MODEL-X1_AB1234_1234567 - 16,720,000원";

describe("① 둘째 마디가 번호다", () => {
  test("기타건 · 수리 건 폴더 이름에서 같은 자리를 읽는다", () => {
    assert.equal(readPurchaseOrderFolderNumber(OTHER_FOLDER), "PO261103031");
    assert.equal(readPurchaseOrderFolderNumber(REPAIR_FOLDER), "PO4500371858");
  });

  test("🔴 **첫 마디의 날짜**는 번호가 아니다 — 자리로 읽는다", () => {
    const read = readPurchaseOrderFolderNumber(OTHER_FOLDER);
    assert.equal(read, "PO261103031");
    assert.equal(read?.includes("20261103"), false, read ?? "");
    // 순번 · 구분 글자가 무엇이든 둘째 마디는 그대로다.
    assert.equal(readPurchaseOrderFolderNumber("내자 20261103_PO261103031_내용"), "PO261103031");
    assert.equal(readPurchaseOrderFolderNumber("20261103_PO261103031_내용"), "PO261103031");
  });

  test("🔴 **뒤의 내용**에 번호가 적혀 있어도 그것으로 읽지 않는다", () => {
    // 사람이 내용 칸에 「… 건」을 적어 둔 폴더 — 이름 어딘가를 보는 방식이면 여기 걸린다.
    const name = "118. 내자 20261104_PO4500999999_(고객) PO261103031 건 재발행분 - (금액)";
    assert.equal(readPurchaseOrderFolderNumber(name), "PO4500999999");
    // 🔵 못 — 찾는 번호가 그 이름 **안에는** 실제로 들어 있다(표본이 허수가 아니다).
    assert.ok(name.includes("PO261103031"));
  });

  test("🔴 마디가 하나뿐인 이름은 null — 지어내지 않는다", () => {
    for (const name of ["임시 발주서 및 신용장 - 바로 가기", "2026", "", "발주서 모음"]) {
      assert.equal(readPurchaseOrderFolderNumber(name), null, name);
    }
    // 둘째 마디가 비어 있어도 null 이다.
    assert.equal(readPurchaseOrderFolderNumber("1. 내자 20261103__내용"), null);
    assert.equal(readPurchaseOrderFolderNumber("1. 내자 20261103_   _내용"), null);
    // 글자가 아닌 값에도 던지지 않는다.
    assert.equal(readPurchaseOrderFolderNumber(null as unknown as string), null);
  });
});

describe("② 🔴 양식이 다른 번호가 **다 읽힌다** — 모양을 못 박지 않았다", () => {
  test("고객사마다 다른 실측 양식 셋", () => {
    const cases: ReadonlyArray<readonly [string, string]> = [
      // 9 자리(날짜 꼴)
      ["117. 내자 20261103_PO261103031_내용 - (금액)", "PO261103031"],
      // 10 자리 SAP 꼴 둘
      ["101. 내자 20251223_PO4500361248_내용 - (금액)", "PO4500361248"],
      ["102. 내자 20251224_PO4500360904_내용 - (금액)", "PO4500360904"],
      // 🔴 `PO` 로 시작하지 않는 번호도 그대로 읽힌다 — 새 고객사가 들어와도 안 막힌다.
      ["103. 내자 20260105_4500371858_내용 - (금액)", "4500371858"],
      ["104. 내자 20260106_PO-2026-001_내용 - (금액)", "PO-2026-001"],
    ];
    for (const [name, expected] of cases) {
      assert.equal(readPurchaseOrderFolderNumber(name), expected, name);
    }
  });

  test("🔵 못 — 표본의 번호들이 서로 **다른 모양**이다(길이 · 글자)", () => {
    const numbers = ["PO261103031", "PO4500361248", "4500371858", "PO-2026-001"];
    assert.equal(new Set(numbers.map((number) => number.length)).size >= 3, true, numbers.join(" / "));
    assert.ok(numbers.some((number) => !number.startsWith("PO")));
    assert.ok(numbers.some((number) => number.includes("-")));
  });
});

describe("③ 🔴 금액 꼬리 — 이웃과 **같은 꼬리**를 뗀다", () => {
  /** 실측 · 사용자 예시에서 본 꼬리들. 모양을 글자로 못 박지 않았다는 표본이다. */
  const TAILS = [" - 16,720,000원", " - (금액)", " - JPY16,295,000", " - 1,000,000원 (재발행)"];

  test("마디가 둘뿐인 이름에서는 둘째 마디에 꼬리가 붙는다 — 떼고 읽는다", () => {
    for (const tail of TAILS) {
      assert.equal(readPurchaseOrderFolderNumber(`1. 내자 20261103_PO261103031${tail}`), "PO261103031", tail);
    }
  });

  test("🔴 **이웃도 같은 꼬리를 뗀다** — 두 벌이 갈라지지 않았다", () => {
    for (const tail of TAILS) {
      const read = readPurchaseOrderFolderName(`1. 내자 20261103_PO261103031_MODEL-X1_AB1234_1234567${tail}`);
      assert.equal(read?.serialNumber, "1234567", tail);
    }
  });

  test("🔴 번호 안의 하이픈은 떨어지지 않는다 — **띄어쓴** 하이픈만 꼬리다", () => {
    assert.equal(readPurchaseOrderFolderNumber("1. 내자 20261103_PO-2026-001 - 1,000원"), "PO-2026-001");
    assert.equal(readPurchaseOrderFolderNumber("1. 내자 20261103_PO-2026-001_내용"), "PO-2026-001");
  });

  test("마디가 셋 이상이면 꼬리는 **마지막 마디**에 붙어 번호와 상관없다", () => {
    assert.equal(readPurchaseOrderFolderNumber(OTHER_FOLDER), "PO261103031");
    assert.equal(readPurchaseOrderFolderNumber(`${OTHER_FOLDER} - 1,000원`), "PO261103031");
  });
});

describe("④ 비교용 열쇠 — 사람이 적은 모양의 흔들림을 흡수한다", () => {
  test("대소문자 · 앞뒤 공백 · 연속 공백 · NFD 가 달라도 같은 열쇠다", () => {
    const key = purchaseOrderNumberKey("PO4500361248");
    assert.notEqual(key, null);
    for (const written of [" po4500361248 ", "PO4500361248", "\tPO4500361248\n"]) {
      assert.equal(purchaseOrderNumberKey(written), key, written);
    }
    // 한글이 섞인 번호를 사람이 풀어쓴(NFD) 모양으로 적어 둔 폴더도 같은 열쇠가 된다.
    assert.equal(purchaseOrderNumberKey("PO 가나".normalize("NFD")), purchaseOrderNumberKey("PO 가나"));
    // 연속 공백은 하나로 접힌다 — 폴더 이름 다듬기와 같은 한 벌을 쓴다.
    assert.equal(purchaseOrderNumberKey("PO  2026  001"), purchaseOrderNumberKey("PO 2026 001"));
  });

  test("🔴 **가리키는 것이 없는 값**은 열쇠가 아니다 — 아무 폴더에나 걸리지 않게", () => {
    for (const empty of [null, undefined, "", "   ", "-", "--", " / ", ".", "..", 7 as unknown as string]) {
      assert.equal(purchaseOrderNumberKey(empty), null, JSON.stringify(empty));
    }
  });

  test("🔵 못 — 다른 번호는 다른 열쇠다(전부 null 로 접혀 공짜 통과하지 않게)", () => {
    assert.notEqual(purchaseOrderNumberKey("PO4500361248"), purchaseOrderNumberKey("PO4500360904"));
    assert.notEqual(purchaseOrderNumberKey("PO261103031"), null);
  });
});

describe("⑤ 🔴 수리 건 길은 그대로다 — 같은 이름에서 **다른 마디**를 읽는다", () => {
  test("수리 건 폴더: 이웃은 날짜 · L/N · S/N, 이쪽은 둘째 마디", () => {
    const read = readPurchaseOrderFolderName(REPAIR_FOLDER);
    assert.deepEqual(read, { issuedDate: "2025-12-23", lotNumber: "AB1234", serialNumber: "1234567" });
    assert.equal(readPurchaseOrderFolderNumber(REPAIR_FOLDER), "PO4500371858");
    // 🔴 번호는 이웃이 내는 어느 값과도 같지 않다 — 두 길이 서로의 자리를 침범하지 않는다.
    assert.equal(Object.values(read ?? {}).includes("PO4500371858"), false);
  });

  test("기타건 폴더: 이웃이 읽어도 **장비가 되지 않는다**(내용 마디가 S/N 자리에 온다)", () => {
    const read = readPurchaseOrderFolderName(OTHER_FOLDER);
    // 🔴 이웃은 이 이름도 읽지만, 그 값은 L/N `PO261103031` · S/N `(고객) 30kW 부속케이블
    //    3SET` 이라 어떤 장비와도 맞지 않는다 — 수리 건 탭에는 걸릴 일이 없다.
    assert.equal(read?.lotNumber, "PO261103031");
    assert.equal(read?.serialNumber, "(고객) 30kW 부속케이블 3SET");
    // 그리고 이쪽이 읽는 번호는 그 L/N 자리와 **같은 마디**다 — 그것이 둘째 마디다.
    assert.equal(readPurchaseOrderFolderNumber(OTHER_FOLDER), read?.lotNumber);
  });
});
