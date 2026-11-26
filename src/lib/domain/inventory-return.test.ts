import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  INVENTORY_RETURN_REQUEST_TYPE,
  RETURN_AFTER_SHIPMENT_MESSAGE,
  RETURN_NOTHING_TO_SEND_MESSAGE,
  RETURN_QUANTITY_DEFAULT,
  applyReturnCartQuantity,
  hasReturnQuantity,
  parseInventoryReturnCandidatesResponse,
  parseReturnRequestLines,
  returnCandidateBreakdownText,
  returnRequestBlockReason,
  toReturnCartLines,
  validateReturnCart,
  type InventoryReturnCandidate,
} from "./inventory-return";

/**
 * ============================================================================
 * 부품 **반환** — 순수 규칙 (2026-11-26)
 * ============================================================================
 * 이 조각에서 **틀리면 물건이 두 번 움직이는** 자리가 하나 있다: 🔴 **최댓값을 `remaining` 이
 * 아니라 `taken`(나간 수)으로 그리는 것.** 그러면 이미 돌아온 몫과 올려 두고 확인을 기다리는
 * 몫이 빠지지 않아 **같은 부품을 두 번 돌려주는 신청**이 서고, 그것은 재고 담당자가 둘째를
 * 확인하는 순간까지 아무도 모른다. 아래 시험 여럿이 그 한 가지를 여러 각도에서 민다.
 *
 * 🔵 **여기서 재는 것은 규칙뿐이다.** 화면이 그 규칙을 실제로 쓰는가는
 *    `components/repair-cases/detail/part-request-section-wiring.test.ts` 가, 통로를 어떻게
 *    두드리는가는 `lib/server/inventory-gateway.test.ts` 가 잰다 — 셋 중 하나만 있으면
 *    「규칙은 맞는데 화면이 안 쓴다」가 조용히 지나간다.
 * 🔴 **실제 고객사명·사람 이름을 넣지 않는다** — 공개 저장소에 박힌다(지어낸 글자만 쓴다).
 * ============================================================================
 */

/** 저쪽 API.md 8-2절의 본보기와 **같은 모양**(값만 지어낸 것으로 바꿨다). */
const CANDIDATE_JSON = {
  generatedAt: "2026-11-26T01:00:00.000Z",
  intakeNumber: "D260701",
  count: 2,
  candidates: [
    {
      no: 7,
      name: "AMP-TEST-A1",
      name2: "13M",
      customerName: "증폭기 조립품",
      kyosanPartNo: "C000000001",
      drawingNo: "WR00000AA001A",
      owner: { code: "SERVICE_SPARE", label: "보수부재" },
      taken: 9,
      returned: 0,
      pending: 2,
      remaining: 7,
    },
    {
      no: 165,
      name: "FILTER-TEST-B2",
      name2: "",
      customerName: "",
      kyosanPartNo: "",
      drawingNo: "",
      owner: { code: "DSS", label: "DSS" },
      taken: 1,
      returned: 0,
      pending: 0,
      remaining: 1,
    },
  ],
};

function parsedCandidates(): InventoryReturnCandidate[] {
  const parsed = parseInventoryReturnCandidatesResponse(CANDIDATE_JSON);
  assert.ok(parsed !== null, "본보기 응답을 못 읽었다 — 아래 단언이 전부 헛돈다");
  assert.equal(parsed.length, 2, "본보기가 두 줄이 아니다");
  return parsed;
}

describe("돌려줄 수 있는 부품 — 응답 읽기", () => {
  test("본보기 응답을 그대로 읽는다 — 칸 이름이 저쪽과 같다", () => {
    const [first, second] = parsedCandidates();
    assert.deepEqual(first, {
      no: 7,
      name: "AMP-TEST-A1",
      name2: "13M",
      customerName: "증폭기 조립품",
      kyosanPartNo: "C000000001",
      drawingNo: "WR00000AA001A",
      owner: { code: "SERVICE_SPARE", label: "보수부재" },
      taken: 9,
      returned: 0,
      pending: 2,
      remaining: 7,
    });
    // 🔵 차례는 **저쪽이 준 그대로**다(부품 No. 오름차순) — 새로고침해도 줄이 안 바뀐다.
    assert.equal(second.no, 165);
  });

  test("🔴 **모양이 아니면 `null`** 이다 — 빈 목록으로 바꾸지 않는다", () => {
    // 🔴 빈 목록으로 접으면 화면이 「돌려줄 부품이 없다」고 거짓말하고, 사람은 부품을 그냥 든다.
    for (const bad of [null, undefined, 1, "candidates", [], {}, { candidates: null }, { candidates: {} }]) {
      assert.equal(parseInventoryReturnCandidatesResponse(bad), null, JSON.stringify(bad) ?? "undefined");
    }
  });

  test("🔵 **나간 적이 없는 건은 빈 목록**이고 오류가 아니다 (API.md 8-3절)", () => {
    const empty = parseInventoryReturnCandidatesResponse({ count: 0, candidates: [] });
    assert.deepEqual(empty, [], "빈 목록이 「못 읽었다」로 접혔다");
  });

  test("🔴 `remaining` 이 1 미만인 줄은 버린다 — 0 인 줄에 수를 적으면 거절당한다", () => {
    const parsed = parseInventoryReturnCandidatesResponse({
      candidates: [
        { no: 1, name: "A-TEST", taken: 3, returned: 3, pending: 0, remaining: 0 },
        { no: 2, name: "B-TEST", taken: 3, returned: 1, pending: 0, remaining: 2 },
        // 🔵 저쪽이 음수를 줄 일은 없지만, 줘도 화면에 세우지 않는다.
        { no: 3, name: "C-TEST", taken: 1, returned: 2, pending: 0, remaining: -1 },
      ],
    });
    assert.deepEqual(parsed?.map((c) => c.no), [2], "돌려줄 것이 없는 줄이 화면에 선다");
  });

  test("가리킬 수 없는 줄은 버린다 — 번호가 없거나 품명이 비었거나 줄이 아닌 것", () => {
    const parsed = parseInventoryReturnCandidatesResponse({
      candidates: [
        null,
        "줄이 아니다",
        { no: 0, name: "A-TEST", remaining: 1 },
        { no: 1.5, name: "A-TEST", remaining: 1 },
        { no: 4, name: "   ", remaining: 1 },
        { no: 5, name: "D-TEST", remaining: 1 },
      ],
    });
    assert.deepEqual(parsed?.map((c) => c.no), [5]);
  });

  test("세는 칸이 숫자가 아니면 0 이다 — 「모름」이 없는 칸이다", () => {
    const parsed = parseInventoryReturnCandidatesResponse({
      candidates: [{ no: 9, name: "E-TEST", taken: "아홉", returned: null, pending: 1.5, remaining: 4 }],
    });
    assert.deepEqual(
      parsed?.map((c) => [c.taken, c.returned, c.pending, c.remaining]),
      [[0, 0, 0, 4]]
    );
  });
});

describe("🔴 최댓값은 `remaining` 이다 — `taken` 이 아니다", () => {
  test("본보기에서 둘이 **다른 수**다 — 섞이면 이 시험이 먼저 넘어진다", () => {
    const [first] = parsedCandidates();
    assert.equal(first.taken, 9);
    assert.equal(first.remaining, 7);
    assert.notEqual(first.taken, first.remaining, "표본이 둘을 못 가른다 — 시험이 헛돈다");
  });

  test("🔴 `taken − returned` 로 **다시 빼지 않는다** — 올려 둔 신청(`pending`)이 빠진다", () => {
    const [first] = parsedCandidates();
    // 🔴 저쪽이 세어 준 수를 그대로 쓴다. 여기서 다시 빼면 9 − 0 = 9 가 되어, 이미 올려 둔
    //    둘을 한 번 더 올릴 수 있게 된다(저쪽 API.md 8-4절이 못 박은 그 사고).
    assert.equal(first.remaining, 7);
    assert.notEqual(first.taken - first.returned, first.remaining);
  });

  test("🔴 남은 수를 넘기면 **그 수를 말에 담아** 거절한다", () => {
    const lines = toReturnCartLines(parsedCandidates());
    const over = applyReturnCartQuantity(lines, 7, "8");
    const result = validateReturnCart(over);
    assert.equal(result.ok, false);
    assert.match(result.ok ? "" : result.message, /7개까지/, "몇 개까지인지를 말해 주지 않는다");
    assert.match(result.ok ? "" : result.message, /AMP-TEST-A1\(No\. 7\)/, "어느 부품인지를 말해 주지 않는다");
  });

  test("🔴 **나간 수까지는 받아 주지 않는다** — `taken`(9)은 넘침이다", () => {
    const lines = toReturnCartLines(parsedCandidates());
    const asTaken = applyReturnCartQuantity(lines, 7, "9");
    assert.equal(validateReturnCart(asTaken).ok, false, "나간 수를 최댓값으로 받고 있다");
  });

  test("🔵 남은 수에 **딱 맞는 수**는 통과한다 — 경계에서 한 개가 잘리면 안 된다", () => {
    const lines = toReturnCartLines(parsedCandidates());
    const exact = applyReturnCartQuantity(lines, 7, "7");
    const result = validateReturnCart(exact);
    assert.equal(result.ok, true);
    assert.deepEqual(result.ok ? result.lines : null, [{ no: 7, quantity: 7 }]);
  });
});

describe("🔴 왜 최댓값이 그 수인지를 사람이 읽는다", () => {
  test("세 수와 남은 수가 한 줄에 함께 적힌다", () => {
    const [first] = parsedCandidates();
    const text = returnCandidateBreakdownText(first);
    for (const piece of ["나간 9", "돌아간 0", "신청 중 2", "7"]) {
      assert.ok(text.includes(piece), `「${piece}」가 빠졌다 — 사람이 7 을 납득할 수 없다: ${text}`);
    }
  });
});

describe("🔴 출하 완료면 못 누른다 — 까닭을 글로 말한다", () => {
  test("나간 건이면 그 까닭이 돌아온다", () => {
    assert.equal(
      returnRequestBlockReason({ shipmentFinished: true, requesterMessage: null }),
      RETURN_AFTER_SHIPMENT_MESSAGE
    );
    // 🔴 「막는다」만 말하고 까닭이 비면 사람은 화면이 고장 난 줄 안다.
    assert.notEqual(RETURN_AFTER_SHIPMENT_MESSAGE.trim(), "");
    assert.match(RETURN_AFTER_SHIPMENT_MESSAGE, /출하 완료/);
  });

  test("안 나간 건이고 올릴 수 있는 사람이면 `null` — 누를 수 있다", () => {
    assert.equal(returnRequestBlockReason({ shipmentFinished: false, requesterMessage: null }), null);
  });

  test("🔵 포털 번호가 없는 사람은 **서버가 들고 온 그 말**이 그대로 나온다", () => {
    assert.equal(
      returnRequestBlockReason({ shipmentFinished: false, requesterMessage: "지어낸 까닭" }),
      "지어낸 까닭"
    );
  });

  test("🔵 둘 다 걸리면 **출하 완료가 먼저**다 — 더 바꿀 수 없는 쪽을 먼저 말한다", () => {
    assert.equal(
      returnRequestBlockReason({ shipmentFinished: true, requesterMessage: "지어낸 까닭" }),
      RETURN_AFTER_SHIPMENT_MESSAGE
    );
  });
});

describe("🔴 기본은 0개 — 0 인 줄은 보내지 않는다", () => {
  test("창을 열면 모든 줄이 0 이고, 올리기 단추가 잠긴다", () => {
    const lines = toReturnCartLines(parsedCandidates());
    assert.deepEqual(lines.map((line) => line.quantity), [RETURN_QUANTITY_DEFAULT, RETURN_QUANTITY_DEFAULT]);
    assert.equal(RETURN_QUANTITY_DEFAULT, "0");
    assert.equal(hasReturnQuantity(lines), false, "열자마자 올릴 수 있으면 실수로 전부 반환된다");
  });

  test("🔴 전부 0 이면 올리지 않는다 — 까닭을 말한다", () => {
    const result = validateReturnCart(toReturnCartLines(parsedCandidates()));
    assert.equal(result.ok, false);
    assert.equal(result.ok ? "" : result.message, RETURN_NOTHING_TO_SEND_MESSAGE);
  });

  test("🔴 **0 인 줄만 빠지고 적은 줄은 간다** — 저쪽은 0 짜리 줄을 400 으로 거절한다", () => {
    const lines = applyReturnCartQuantity(toReturnCartLines(parsedCandidates()), 165, "1");
    assert.equal(hasReturnQuantity(lines), true);
    const result = validateReturnCart(lines);
    assert.deepEqual(result.ok ? result.lines : null, [{ no: 165, quantity: 1 }]);
  });

  test("🔵 **빈 칸은 0 과 같다** — 지운 줄 때문에 다른 줄까지 막히지 않는다", () => {
    const lines = applyReturnCartQuantity(
      applyReturnCartQuantity(toReturnCartLines(parsedCandidates()), 7, ""),
      165,
      "1"
    );
    const result = validateReturnCart(lines);
    assert.deepEqual(result.ok ? result.lines : null, [{ no: 165, quantity: 1 }]);
    // 전부 비우면 올릴 것이 없는 것과 같다.
    const allBlank = toReturnCartLines(parsedCandidates()).map((line) => ({ ...line, quantity: "  " }));
    assert.equal(hasReturnQuantity(allBlank), false);
  });

  test("🔴 숫자가 아닌 글자는 **조용히 빠지지 않는다** — 무엇이 잘못됐는지 말해 준다", () => {
    const lines = applyReturnCartQuantity(toReturnCartLines(parsedCandidates()), 7, "두개");
    assert.equal(hasReturnQuantity(lines), true, "손댄 줄인데 안 적은 것으로 센다");
    const result = validateReturnCart(lines);
    assert.equal(result.ok, false);
    assert.match(result.ok ? "" : result.message, /AMP-TEST-A1\(No\. 7\)/);
  });

  test("수량을 고치는 일이 **그 줄만** 건드린다", () => {
    const lines = toReturnCartLines(parsedCandidates());
    const patched = applyReturnCartQuantity(lines, 7, "3");
    assert.equal(patched[0].quantity, "3");
    assert.equal(patched[1].quantity, "0", "다른 줄이 함께 바뀌었다");
    // 저쪽이 준 줄(최댓값과 세 수)은 그대로다 — 베껴 담지 않았다는 뜻이다.
    assert.equal(patched[0].candidate.remaining, 7);
    assert.equal(lines[0].quantity, "0", "원본이 함께 바뀌었다");
  });
});

describe("🔴 올리는 줄 — 유상/무상도 사유도 싣지 않는다", () => {
  test("보내는 줄은 **칸이 둘뿐**이다", () => {
    const parsed = parseReturnRequestLines([{ no: 7, quantity: 2 }]);
    assert.equal(parsed.ok, true);
    assert.deepEqual(parsed.ok ? Object.keys(parsed.lines[0]).sort() : null, ["no", "quantity"]);
  });

  test("🔴 유상/무상을 **적어 보내도 실리지 않는다** — 받는 칸 자체가 없다", () => {
    // 🔴 저쪽은 보내도 거절하지 않고 그냥 보지 않는다(API.md 4-11절). 우리 쪽에서 실어
    //    보내면 「반환에도 청구가 따라붙는다」로 읽히는 자료가 저쪽에 남는다.
    const parsed = parseReturnRequestLines([{ no: 7, quantity: 2, chargeType: "PAID", reason: "지어낸 사유" }]);
    assert.deepEqual(parsed.ok ? parsed.lines : null, [{ no: 7, quantity: 2 }]);
  });

  test("🔴 유상/무상이 **없다고 거절하지 않는다** — 반출 줄 검사와 일부러 다르다", () => {
    assert.equal(parseReturnRequestLines([{ no: 7, quantity: 1 }]).ok, true);
  });

  test("한 줄도 없으면 거절한다", () => {
    for (const bad of [null, {}, "줄", []]) {
      const parsed = parseReturnRequestLines(bad);
      assert.equal(parsed.ok, false, JSON.stringify(bad));
      assert.equal(parsed.ok ? "" : parsed.message, RETURN_NOTHING_TO_SEND_MESSAGE);
    }
  });

  test("50줄을 넘으면 거절한다 — 저쪽 상한과 같은 수다", () => {
    const many = Array.from({ length: 51 }, (_, i) => ({ no: i + 1, quantity: 1 }));
    assert.equal(parseReturnRequestLines(many).ok, false);
    assert.equal(parseReturnRequestLines(many.slice(0, 50)).ok, true);
  });

  test("같은 부품이 두 줄이면 거절한다 — 한 줄로 합쳐야 한다", () => {
    const parsed = parseReturnRequestLines(
      [
        { no: 7, quantity: 1 },
        { no: 7, quantity: 2 },
      ],
      new Map([[7, "AMP-TEST-A1"]])
    );
    assert.equal(parsed.ok, false);
    assert.match(parsed.ok ? "" : parsed.message, /AMP-TEST-A1\(No\. 7\)/);
  });

  test("번호와 수량의 모양을 잰다 — 글자로 온 숫자를 고쳐 주지 않는다", () => {
    for (const bad of [
      [{ no: "7", quantity: 1 }],
      [{ no: 0, quantity: 1 }],
      [{ no: 7, quantity: "2" }],
      [{ no: 7, quantity: 0 }],
      [{ no: 7, quantity: -1 }],
      [{ no: 7, quantity: 1.5 }],
      [{ no: 7 }],
      ["줄이 아니다"],
    ]) {
      assert.equal(parseReturnRequestLines(bad).ok, false, JSON.stringify(bad));
    }
  });

  test("🔴 **남은 수는 이 함수가 보지 않는다** — 서버 액션도 이 함수를 쓴다", () => {
    /* 🔴 서버는 `remaining` 을 모른다(알려면 통로를 한 번 더 두드려야 하고, 그렇게 받은 수도
       보내는 순간 이미 옛것이다). 여기서 넘침을 가리기 시작하면 서버가 **아는 체**하게 되고,
       화면이 안 거친 길로 들어온 요청마다 엉뚱한 수로 거절한다. 넘침을 가리는 자리는 둘이다 —
       화면의 장바구니 검사(헛걸음 줄이기)와 재고 관리의 원장(진짜 울타리). */
    assert.equal(parseReturnRequestLines([{ no: 7, quantity: 1_000 }]).ok, true);
  });
});

describe("🔴 보내는 본문의 `type` — 이 한 글자가 반출과 반환을 가른다", () => {
  test("「RETURN」이다 — 안 보내면 저쪽은 「사용」(반출)으로 읽는다", () => {
    // 🔴 글자가 어긋나면 **오류 없이 반출 신청이 한 줄 선다**(부품이 한 번 더 나가는 쪽으로).
    assert.equal(INVENTORY_RETURN_REQUEST_TYPE, "RETURN");
  });
});
