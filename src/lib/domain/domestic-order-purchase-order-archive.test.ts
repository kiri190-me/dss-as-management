import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

import {
  DOMESTIC_ORDER_PURCHASE_ORDER_ARCHIVE_NO_NUMBER_TEXT,
  resolveDomesticOrderPurchaseOrderArchiveLookup,
  type DomesticOrderPurchaseOrderArchiveRow,
} from "./domestic-order-purchase-order-archive";
import { purchaseOrderNumberKey } from "./purchase-order-folder-number";

/**
 * ============================================================================
 * 기타건의 발주서 공유폴더를 **무엇으로 찾는가** (2026-11-06)
 * ============================================================================
 * 내자 정리 한 줄에서 찾을 열쇠 하나(발주서번호)를 꺼내는 순수 함수. 실제로 폴더를 찾는
 * 일은 lib/storage/purchase-order-number-archive.test.ts 가, 통로 쪽 규율은
 * app/api/domestic-orders/[id]/purchase-order-folder/entries/route-source.test.ts 가 본다.
 *
 * 여기서 못 박는 것은 넷이다:
 *  · 🔴 **쓸 수 있는 번호인가를 폴더 맞대는 함수로 묻는다** — `-` 한 글자처럼 가리키는 것이
 *    없는 값이 번호 행세를 하지 못한다(내자 정리에 실제로 있는 값이다)
 *  · 🔴 **발주발행일로 문을 열지 않는다** — 수리 건 통로와 다른 한 가지다. 줄 타입에 날짜
 *    칸이 아예 없고, 원본에 그 낱말이 **코드로는** 한 글자도 없다
 *  · 🔴 돌려주는 번호는 **사람이 적은 글자**다(앞뒤 공백만 턴 것) — 열쇠로 바꾸지 않는다
 *  · 🔴 못 찾을 줄의 안내가 **차분한 한 줄**이고 번호를 어디에 적으면 되는지 말한다
 *
 * 🔴 번호는 **가짜**다(이 저장소는 공개다). 모양만 실측과 같게 맞췄다.
 * ============================================================================
 */

const row = (purchaseOrderNumber: string | null): DomesticOrderPurchaseOrderArchiveRow => ({
  purchaseOrderNumber,
});

describe("① 번호가 있으면 그 번호로 찾는다", () => {
  test("앞뒤 공백만 턴 **사람이 적은 글자**를 그대로 돌려준다", () => {
    assert.deepEqual(resolveDomesticOrderPurchaseOrderArchiveLookup(row("  PO261103031  ")), {
      status: "ready",
      purchaseOrderNumber: "PO261103031",
    });
    // 🔴 열쇠(대문자로 접은 값)가 아니다 — 그 글자가 화면 머리에 그대로 적힌다.
    const lower = resolveDomesticOrderPurchaseOrderArchiveLookup(row("po-2026-001"));
    assert.deepEqual(lower, { status: "ready", purchaseOrderNumber: "po-2026-001" });
  });

  test("🔴 양식이 다른 번호가 다 통과한다 — 모양을 못 박지 않았다", () => {
    for (const number of ["PO261103031", "PO4500361248", "PO4500360904", "4500371858", "PO-2026-001"]) {
      assert.deepEqual(resolveDomesticOrderPurchaseOrderArchiveLookup(row(number)), {
        status: "ready",
        purchaseOrderNumber: number,
      });
    }
  });
});

describe("② 찾아볼 수 없는 줄 — 공유폴더를 보지 않는다", () => {
  test("빈 칸 · 공백뿐인 칸", () => {
    for (const empty of [null, "", "   "]) {
      assert.deepEqual(resolveDomesticOrderPurchaseOrderArchiveLookup(row(empty)), { status: "no-po-number" });
    }
  });

  test("🔴 `-` 한 글자처럼 **가리키는 것이 없는 값**도 번호가 아니다", () => {
    for (const dash of ["-", "--", "   -   ", "."]) {
      assert.deepEqual(
        resolveDomesticOrderPurchaseOrderArchiveLookup(row(dash)),
        { status: "no-po-number" },
        dash
      );
      // 🔵 못 — 같은 판정을 **폴더 맞대는 함수**가 내고 있다(두 벌로 세지 않았다).
      assert.equal(purchaseOrderNumberKey(dash), null, dash);
    }
  });

  test("던지지 않는다 — 칸이 통째로 없는 줄도 값으로 답한다", () => {
    const empty = {} as DomesticOrderPurchaseOrderArchiveRow;
    assert.deepEqual(resolveDomesticOrderPurchaseOrderArchiveLookup(empty), { status: "no-po-number" });
  });
});

describe("③ 🔴 발주발행일로 문을 열지 않는다 — 수리 건 통로와 다른 한 가지", () => {
  test("날짜가 있든 없든 **같은 답**이다", () => {
    const withDate = { purchaseOrderNumber: "PO261103031", orderIssuedDate: "2026-11-03" };
    const withoutDate = { purchaseOrderNumber: "PO261103031", orderIssuedDate: null };
    const expected = { status: "ready", purchaseOrderNumber: "PO261103031" };
    // 🔴 날짜 칸을 **받지도 않는다** — 넘겨 봐야 답이 달라지지 않는다는 것을 값으로 본다.
    assert.deepEqual(resolveDomesticOrderPurchaseOrderArchiveLookup(withDate), expected);
    assert.deepEqual(resolveDomesticOrderPurchaseOrderArchiveLookup(withoutDate), expected);
  });

  test("🔴 원본에 날짜 조건이 **코드로는** 한 글자도 없다", () => {
    const source = readFileSync(new URL("./domestic-order-purchase-order-archive.ts", import.meta.url), "utf8");
    const code = source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^[ \t]*\/\/.*$/gm, " ");
    // 🔵 못 — 머리말에는 그 낱말이 **까닭과 함께** 적혀 있고, 코드에는 없다. 둘 다 봐야
    //    「없다」가 뜻을 갖는다(주석만으로 통과하지 않게).
    assert.ok(source.includes("발주발행일"), "머리말이 바뀌었다 — 이 못을 다시 보라");
    for (const forbidden of ["orderIssuedDate", "no-order-date", "issuedDate", "발주발행일"]) {
      assert.equal(code.includes(forbidden), false, `날짜 조건이 들어왔다: ${forbidden}`);
    }
  });
});

describe("④ 안내 문장 — 차분하고, 다음 걸음을 적는다", () => {
  test("어디에 무엇을 적으면 찾기 시작하는지 말한다", () => {
    const text = DOMESTIC_ORDER_PURCHASE_ORDER_ARCHIVE_NO_NUMBER_TEXT;
    assert.ok(text.includes("발주서번호"), text);
    assert.ok(text.includes("내자 정리"), text);
    // 🔴 「폴더가 없습니다」가 아니다 — 공유폴더를 보지도 않았다.
    assert.equal(text.includes("폴더가 없습니다"), false, text);
    assert.ok(text.length > 20, text);
  });
});
