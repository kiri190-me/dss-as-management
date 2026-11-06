import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

/**
 * ============================================================================
 * 기타 견적서 → 내자 줄 — **끼운 자리**를 소스로 지킨다 (2026-11-06)
 * ============================================================================
 * 판정은 domain/quote-domestic-order-line.test.ts 가 값으로 재고, 실제로 줄이 서는
 * 것은 시험 DB 가 본다(quote-domestic-order-line.integration.test.ts). 이 파일이
 * 보는 것은 그 둘이 못 재는 **자리**다 — 이웃 server/actions/
 * quote-save-archive-source.test.ts 와 같은 규율이다:
 *
 *  · 🔴 **만들 때만** 부른다 — `updateQuote` 에는 한 글자도 없다(사용자 결정:
 *    고친 견적서는 내자 줄을 따라가게 하지 않는다. 따라가면 사람이 손으로 고쳐 둔
 *    값을 저장이 말없이 덮는다).
 *  · 🔴 **같은 트랜잭션 안**이다 — `tx` 를 넘긴다. 공유폴더 만들기처럼 트랜잭션
 *    바깥의 성공 분기에 붙으면, 번호 중복으로 되돌아간 저장이 내자 줄만 남긴다.
 *  · 🔴 **잠그고 → 센다** — 차례가 뒤집히면 동시에 들어온 둘이 각자 줄을 만든다
 *    (`quote_id` 에는 유일 제약이 없다).
 *  · 🔴 **살아 있는 줄만 센다** — 휴지통을 세면 사람이 지운 줄 때문에 다시 만들
 *    길이 없어진다.
 *  · 🔴 **넣는 칸은 판정이 준 묶음 + 기록용 둘뿐**이고, 순번을 지어내지 않는다.
 *  · 🔴 **이 길은 던지지도 거절하지도 않는다** — 견적서 저장을 뒤집지 않는다.
 *  · 🔴 **기존 두 길을 건드리지 않았다** — 내자 정리의 [행 추가](createDomesticOrder)
 *    와 수리 건 상세의 발행일 저장(saveRepairCaseDomesticOrderIssueDates)은 이 모듈을
 *    모른다(알게 되면 그 두 화면의 저장이 이 판정을 함께 타게 된다).
 * ============================================================================
 */

const quotesSource = readFileSync(new URL("./quotes.ts", import.meta.url), "utf8").replace(
  /\r\n/g,
  "\n"
);
const lineSource = readFileSync(
  new URL("./quote-domestic-order-line.ts", import.meta.url),
  "utf8"
).replace(/\r\n/g, "\n");
const actionSource = readFileSync(
  new URL("../../server/actions/quotes.ts", import.meta.url),
  "utf8"
).replace(/\r\n/g, "\n");
const domesticOrdersSource = readFileSync(
  new URL("./domestic-orders.ts", import.meta.url),
  "utf8"
).replace(/\r\n/g, "\n");
const issueDatesSource = readFileSync(
  new URL("./domestic-order-issue-dates.ts", import.meta.url),
  "utf8"
).replace(/\r\n/g, "\n");

/**
 * 주석을 뺀 코드. 🔴 이 저장소의 머리말은 까닭을 길게 적으므로, 걷어 내지 않으면
 * 「updateQuote 에는 없다」 같은 단언이 **주석에 적힌 그 낱말** 때문에 뒤집힌다.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const quotesCode = stripComments(quotesSource);
const lineCode = stripComments(lineSource);
const actionCode = stripComments(actionSource);
const domesticOrdersCode = stripComments(domesticOrdersSource);
const issueDatesCode = stripComments(issueDatesSource);

function occurrences(source: string, needle: string): number {
  return source.split(needle).length - 1;
}

const HELPER = "createDomesticOrderLineForQuote";

const createBody = quotesCode.slice(
  quotesCode.indexOf("export async function createQuote("),
  quotesCode.indexOf("function excelOnlyViolationResult(")
);
const updateBody = quotesCode.slice(quotesCode.indexOf("export async function updateQuote("));

describe("기타 견적서 → 내자 줄 — 견적서 저장에 끼운 자리", () => {
  test("🔵 먼저 표본이 비지 않았는지 — 두 몸통을 제대로 잘랐는가", () => {
    // 🔴 자르기가 빗나가면 아래 단언들이 **빈 글자**를 보고 전부 통과한다.
    assert.ok(createBody.includes(".insert(quotes)"), "createQuote 몸통을 못 잘랐다");
    assert.ok(createBody.includes("replaceWorkScopeLines"), "createQuote 몸통이 너무 짧다");
    assert.ok(updateBody.includes(".update(quotes)"), "updateQuote 몸통을 못 잘랐다");
    assert.ok(updateBody.includes("isQuoteContentUnchanged"), "updateQuote 몸통이 너무 짧다");
    // 두 몸통이 겹치지 않는다 — 겹치면 「고치기에 없다」가 뜻을 잃는다.
    assert.equal(createBody.includes("export async function updateQuote("), false);
    assert.equal(updateBody.includes("export async function createQuote("), false);
  });

  test("🔴 만들기에만 있다 — 고치기에는 한 글자도 없다", () => {
    assert.ok(createBody.includes(`await ${HELPER}(tx, {`), "🔴 만들 때 내자 줄을 안 세운다");
    assert.equal(
      updateBody.includes(HELPER),
      false,
      "🔴 고치기가 내자 줄을 건드린다 — 사람이 손으로 고쳐 둔 값이 저장에 덮인다"
    );
    // 가져오기 1 + 부르기 1. 늘면 부르는 자리가 둘로 갈라진 것이다.
    assert.equal(occurrences(quotesCode, HELPER), 2, "부르는 자리가 하나가 아니다");
  });

  test("🔴 같은 트랜잭션 안이다 — `tx` 를 넘기고, 트랜잭션 바깥에는 없다", () => {
    // 부르는 자리가 createQuote 의 `db.transaction(async (tx) => {` 블록 안이다.
    const txOpen = createBody.indexOf("db.transaction(async (tx)");
    const call = createBody.indexOf(`await ${HELPER}(tx, {`);
    const insert = createBody.indexOf(".insert(quotes)");
    assert.ok(txOpen >= 0, "만들기가 트랜잭션을 열지 않는다");
    assert.ok(txOpen < call, "🔴 트랜잭션을 열기 전에 내자 줄을 만든다");
    assert.ok(insert < call, "견적서 행보다 먼저 내자 줄을 만든다 — 가리킬 곳이 없다");
    assert.ok(
      createBody.includes("quoteId: inserted.id,"),
      "방금 만든 견적서가 아닌 것을 가리킨다"
    );

    // 🔴 서버 액션(트랜잭션 바깥)에는 없다 — 거기 붙으면 되돌아간 저장이 줄만 남긴다.
    assert.equal(actionCode.includes(HELPER), false, "🔴 트랜잭션 바깥에서 부른다");
    assert.equal(actionCode.includes("quote-domestic-order-line"), false);
  });

  test("🔴 기존 두 길은 이 모듈을 모른다 — [행 추가]와 발행일 저장이 그대로다", () => {
    assert.equal(domesticOrdersCode.includes(HELPER), false, "[행 추가]가 이 판정을 탄다");
    assert.equal(
      domesticOrdersCode.includes("quote-domestic-order-line"),
      false,
      "[행 추가]가 이 모듈을 가져온다"
    );
    assert.equal(issueDatesCode.includes(HELPER), false, "발행일 저장이 이 판정을 탄다");
    assert.equal(
      issueDatesCode.includes("quote-domestic-order-line"),
      false,
      "발행일 저장이 이 모듈을 가져온다"
    );
    // 🔵 표본이 비지 않았는가 — 두 길이 실제로 줄을 만드는 코드를 들고 있다.
    assert.ok(
      domesticOrdersCode.includes("export async function createDomesticOrder("),
      "[행 추가] 함수가 사라졌다"
    );
    assert.ok(
      domesticOrdersCode.includes(".insert(domesticOrders)"),
      "[행 추가]의 INSERT 가 사라졌다"
    );
    assert.ok(
      issueDatesCode.includes("export async function saveRepairCaseDomesticOrderIssueDates("),
      "발행일 저장 함수가 사라졌다"
    );
    assert.ok(
      issueDatesCode.includes(".insert(domesticOrders)"),
      "발행일 저장의 INSERT 가 사라졌다"
    );
  });
});

describe("기타 견적서 → 내자 줄 — 만드는 쪽의 규율", () => {
  test("🔴 견적서를 잠그고, **그다음에** 센다", () => {
    const lock = lineCode.indexOf('.for("update")');
    const count = lineCode.indexOf("eq(domesticOrders.quoteId, params.quoteId)");
    assert.ok(lock >= 0, "🔴 견적서 행을 잠그지 않는다 — 동시에 들어오면 줄이 둘이 된다");
    assert.ok(count >= 0, "이미 있는 줄을 세지 않는다");
    assert.ok(lock < count, "🔴 세고 나서 잠근다 — 둘 다 「없다」를 보고 각자 만든다");
    // 잠그는 것은 **견적서**다. 내자 줄은 아직 없어 잠글 수가 없다.
    assert.ok(
      lineCode.slice(0, lock).includes("from(quotes)"),
      "🔴 잠그는 대상이 견적서가 아니다"
    );
  });

  test("🔴 살아 있는 줄만 센다 — 휴지통은 세지 않는다", () => {
    assert.ok(
      lineCode.includes("eq(domesticOrders.isDeleted, false)"),
      "🔴 휴지통에 든 줄까지 세면, 사람이 지운 뒤 다시 만들 길이 없어진다"
    );
  });

  test("🔴 넣는 칸은 판정이 준 묶음 + 기록용 둘뿐 — 순번을 지어내지 않는다", () => {
    const insertAt = lineCode.indexOf(".insert(domesticOrders)");
    assert.ok(insertAt >= 0, "줄을 넣는 자리가 없다");
    const insertBody = lineCode.slice(insertAt, lineCode.indexOf(".returning(", insertAt));
    assert.ok(insertBody.includes("...plan.values,"), "🔴 판정이 준 묶음을 안 쓴다");
    assert.ok(insertBody.includes("createdBy: params.actorUserId,"));
    assert.ok(insertBody.includes("updatedBy: params.actorUserId,"));
    for (const forbidden of [
      "displayOrder",
      "intakeNumberText",
      "lotNumberText",
      "serialNumberText",
      "faultDescriptionText",
      "orderIssuedDate",
      "amountExcludingVat",
      "paymentCompleted",
      "progressNote",
    ]) {
      assert.equal(insertBody.includes(forbidden), false, `🔴 ${forbidden} 까지 적는다`);
    }
    // 🔴 칸 이름을 제 손으로 적지 않는다 — 규칙은 domain 한 곳이다.
    assert.equal(insertBody.includes("modelNameText:"), false, "칸을 두 벌로 적는다");
  });

  test("🔴 제 트랜잭션을 열지 않고, 던지지도 거절하지도 않는다", () => {
    assert.equal(
      lineCode.includes("db.transaction("),
      false,
      "🔴 제 트랜잭션을 연다 — 견적서 저장이 되돌아가도 줄이 남는다"
    );
    assert.ok(lineCode.includes("tx: Tx,"), "트랜잭션을 받지 않는다");
    assert.equal(/\bthrow\b/.test(lineCode), false, "🔴 던지면 견적서 저장이 뒤집힌다");
    assert.equal(lineCode.includes("ok: false"), false, "저장을 거절하는 모양을 만든다");
    // 🔴 돌려주는 것은 「만들었다」 또는 「안 만들었고 까닭은 이것」 둘뿐이다.
    assert.ok(lineCode.includes("return { created: false, reason: plan.reason };"));
    assert.ok(lineCode.includes("return { created: true, domesticOrderId: inserted.id };"));
  });

  test("🔴 판정을 제 손으로 다시 적지 않는다 — domain 한 곳을 부른다", () => {
    assert.ok(
      lineCode.includes('from "@/lib/domain/quote-domestic-order-line"'),
      "판정 모듈을 가져오지 않는다"
    );
    assert.ok(lineCode.includes("resolveQuoteDomesticOrderLine({"), "판정을 부르지 않는다");
    assert.equal(
      lineCode.includes('=== "CABLE"'),
      false,
      "🔴 종류 가름을 여기에 한 벌 더 적었다 — 두 곳이 갈라진다"
    );
  });
});
