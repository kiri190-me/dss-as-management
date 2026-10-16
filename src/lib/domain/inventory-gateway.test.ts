import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  CHARGE_TYPE_LABELS,
  CUSTOMER_NAME_EMPTY_NOTICE,
  MAX_STOCK_REQUEST_LINES,
  canCancelStockRequest,
  customerNameAlreadySetLines,
  filterInventoryParts,
  inventoryPartCustomerName,
  inventoryPartIdLabels,
  inventoryPartNoteFirstLine,
  inventoryPartSpec,
  inventoryUnreachableMessage,
  isChargeType,
  isValidRequestKey,
  parseInventoryOhTemplateResponse,
  parseInventoryPartsResponse,
  parseInventoryStockRequestsResponse,
  parseStockRequestLines,
  stockRequestKeyBelongsToCase,
  toScreenStockRequests,
  type InventoryPart,
  type InventoryStockRequest,
} from "./inventory-gateway";

/**
 * ============================================================================
 * 재고 관리에서 받아 온 것을 읽는 규칙 (2026-10-15)
 * ============================================================================
 * 🔴 여기서 지키는 가장 큰 것: **「모양이 아니다」와 「하나도 없다」가 다른 값이어야 한다.**
 *    파서가 둘을 뭉개 빈 배열을 돌려주면 부르는 쪽이 「못 받아 왔다」로 바꿀 길이 사라지고,
 *    화면은 재고가 멀쩡한데도 「재고에 부품이 하나도 없다」고 말한다.
 *
 * 🔴 두 번째: **유상/무상이 빠지면 올라가지 않는다.** 청구에 걸리는 값이라 저쪽 통로도
 *    기본값으로 채워 주지 않고 400 으로 거절한다. 화면과 서버 액션이 **같은 함수**를 쓰므로
 *    이 시험 하나가 두 자리를 함께 덮는다.
 *
 * 값은 전부 지어낸 것이다 — 실제 고객사 · 모델 · L/N · S/N 을 적지 않는다(공개 저장소).
 * ============================================================================
 */

const PARTS_BODY = {
  generatedAt: "2026-10-15T05:12:00.000Z",
  count: 2,
  parts: [
    {
      no: 11,
      name: "AMP-TEST-A1",
      name2: "규격 A",
      customerName: "증폭기 조립품",
      kyosanPartNo: "C000000001",
      drawingNo: "WR00000AA001A",
      quantity: 7,
      note: "수리소 관리용\n두 번째 줄",
      item: { code: "PCB", name: "PCB" },
      category: { code: "RFG", label: "RFG" },
      owner: { code: "SERVICE_SPARE", label: "보수부재" },
      // 🔴 견적가 둘 — 부품 고르개가 단가 칸을 채우는 값이다(2026-10-16).
      quotePrice: 125000,
      overhaulQuotePrice: 0,
      updatedAt: "2026-10-06T03:00:00.000Z",
    },
    {
      no: 12,
      name: "VVC-TEST-B2",
      name2: "",
      customerName: "",
      kyosanPartNo: "",
      drawingNo: "WR00000BB002B",
      quantity: 0,
      note: "",
      owner: { code: "DSS", label: "DSS" },
    },
  ],
};

describe("부품 목록 읽기", () => {
  test("모양이면 그대로 읽고, 소유·비고를 함께 들고 온다", () => {
    const parts = parseInventoryPartsResponse(PARTS_BODY);
    assert.ok(parts);
    assert.equal(parts.length, 2);
    assert.equal(parts[0].no, 11);
    assert.equal(parts[0].owner.label, "보수부재");
    // 같은 품명이 여럿일 때 사람이 가르는 단서는 비고의 첫 줄이다.
    assert.equal(inventoryPartNoteFirstLine(parts[0]), "수리소 관리용");
    assert.equal(inventoryPartNoteFirstLine(parts[1]), "");
  });

  test("🔴 모양이 아니면 null — 빈 배열이 아니다", () => {
    // 부르는 쪽은 null 을 「못 받아 왔다」로 바꾼다. 여기서 []를 돌려주면 그 길이 끊긴다.
    assert.equal(parseInventoryPartsResponse(null), null);
    assert.equal(parseInventoryPartsResponse("<html>500</html>"), null);
    assert.equal(parseInventoryPartsResponse([]), null);
    assert.equal(parseInventoryPartsResponse({}), null);
    assert.equal(parseInventoryPartsResponse({ parts: "nope" }), null);
  });

  test("🔴 200 에 빈 목록이 온 것은 「하나도 없다」는 사실이다 — null 이 아니다", () => {
    assert.deepEqual(parseInventoryPartsResponse({ count: 0, parts: [] }), []);
  });

  test("🔴 견적가 둘 — `0`(무상)과 「없음」(정하지 않음)을 가른다", () => {
    const parts = parseInventoryPartsResponse(PARTS_BODY) as InventoryPart[];
    assert.equal(parts[0].quotePrice, 125000);
    // 🔴 `0` 이 null 로 뒤집히면 **무상으로 정해 둔 부품**이 「안 정함」이 된다.
    assert.equal(parts[0].overhaulQuotePrice, 0);
    // 🔴 칸이 아예 없는 줄(저쪽이 2026-10-16 전에 주던 모양)은 「정하지 않았다」다.
    //    0 으로 채우면 그 부품이 0원으로 청구되고, 아무도 눈치채지 못한다.
    assert.equal(parts[1].quotePrice, null);
    assert.equal(parts[1].overhaulQuotePrice, null);
  });

  test("번호나 품명이 빈 줄은 버린다 — 가리킬 수 없는 줄이다", () => {
    const parts = parseInventoryPartsResponse({
      parts: [
        { no: 0, name: "번호 없음" },
        { no: 5, name: "" },
        { no: "6", name: "글자 번호" },
        { no: 7, name: "쓸 수 있는 줄" },
      ],
    });
    assert.deepEqual(parts?.map((p) => p.no), [7]);
  });
});

describe("화면에서 거르기 — 저쪽 q 와 같은 잣대", () => {
  const parts = parseInventoryPartsResponse(PARTS_BODY) as InventoryPart[];

  test("빈 글자는 빈 목록 — 수백 개를 통째로 펼치지 않는다", () => {
    assert.deepEqual(filterInventoryParts(parts, ""), []);
    assert.deepEqual(filterInventoryParts(parts, "   "), []);
  });

  test("다섯 칸에서 찾는다 — 품명·품명2·고객사 품명·교산 품번·도번", () => {
    assert.deepEqual(filterInventoryParts(parts, "amp").map((p) => p.no), [11]);
    assert.deepEqual(filterInventoryParts(parts, "규격").map((p) => p.no), [11]);
    assert.deepEqual(filterInventoryParts(parts, "조립품").map((p) => p.no), [11]);
    assert.deepEqual(filterInventoryParts(parts, "C000000001").map((p) => p.no), [11]);
    assert.deepEqual(filterInventoryParts(parts, "WR00000BB002B").map((p) => p.no), [12]);
  });

  test("🔴 낱말이 여럿이면 **모두** 들어 있어야 한다(저쪽 q 와 같다)", () => {
    assert.deepEqual(filterInventoryParts(parts, "amp 규격").map((p) => p.no), [11]);
    assert.deepEqual(filterInventoryParts(parts, "amp vvc"), []);
  });

  test("대소문자를 가리지 않는다", () => {
    assert.deepEqual(filterInventoryParts(parts, "vvc-test").map((p) => p.no), [12]);
  });
});

describe("O/H 템플릿 읽기", () => {
  test("🔴 「이어 둔 템플릿이 없다」는 오류가 아니다 — template: null 로 온다", () => {
    assert.deepEqual(parseInventoryOhTemplateResponse({ modelId: "m", template: null }), { template: null });
  });

  test("🔴 모양이 아니면 null — 「템플릿이 없다」와 섞이지 않는다", () => {
    assert.equal(parseInventoryOhTemplateResponse(null), null);
    assert.equal(parseInventoryOhTemplateResponse({ template: { name: "줄이 없다" } }), null);
  });

  test("안 이어진 줄도 그대로 들고 온다 — 빼면 「다 담겼다」고 믿게 된다", () => {
    const parsed = parseInventoryOhTemplateResponse({
      template: {
        id: "t1",
        name: "시험용 O/H",
        note: "",
        items: [
          { displayOrder: 1, no: 11, name: "증폭기 PCB", partName: "AMP-TEST-A1", quantity: 2, linked: true },
          { displayOrder: 2, no: null, name: "유량계", partName: null, quantity: 1, linked: false },
        ],
      },
    });
    assert.equal(parsed?.template?.items.length, 2);
    assert.equal(parsed?.template?.items[1].linked, false);
    assert.equal(parsed?.template?.items[1].name, "유량계");
  });

  test("🔴 번호가 없는데 linked 가 참이면 거짓으로 본다 — 담으려다 올리기가 통째로 400 이 된다", () => {
    const parsed = parseInventoryOhTemplateResponse({
      template: { id: "t1", name: "", note: "", items: [{ displayOrder: 1, no: null, name: "유량계", quantity: 1, linked: true }] },
    });
    assert.equal(parsed?.template?.items[0].linked, false);
  });
});

describe("올린 신청의 지금 상태 읽기", () => {
  const BODY = {
    generatedAt: "2026-10-15T05:12:00.000Z",
    count: 2,
    requests: [
      {
        requestKey: "AS-TEST-0001",
        id: "r1",
        intakeNumber: "D260701",
        type: "USE",
        status: { code: "PARTIAL", label: "일부 나감" },
        closed: false,
        requestedAt: "2026-10-15T01:00:00.000Z",
        lines: [{ no: 11, name: "AMP-TEST-A1", quantity: 8, issued: 5 }],
        decision: null,
        hold: null,
      },
      {
        requestKey: null,
        id: "r2",
        intakeNumber: "D260701",
        type: "USE",
        status: { code: "CONFIRMED", label: "마감" },
        closed: true,
        requestedAt: "2026-10-14T06:00:00.000Z",
        lines: [{ no: null, name: "(지워진 부품)", quantity: 2, issued: 0 }],
        decision: { byName: "담당자", at: "2026-10-14T08:00:00.000Z", note: "재고가 없습니다" },
        hold: { reason: "부품 입고 대기", byName: "담당자", at: "2026-10-14T07:00:00.000Z" },
      },
    ],
    notFound: [],
  };

  test("🔴 상태 글자를 저쪽이 준 그대로 들고 온다 — 손으로 다시 적지 않는다", () => {
    const requests = parseInventoryStockRequestsResponse(BODY);
    assert.equal(requests?.[0].status.label, "일부 나감");
    // 「마감」은 상태값이 아니라 closed 칸이다 — code 는 CONFIRMED 다.
    assert.equal(requests?.[1].status.code, "CONFIRMED");
    assert.equal(requests?.[1].status.label, "마감");
    assert.equal(requests?.[1].closed, true);
  });

  test("🔵 requestKey 가 null 인 줄 = 재고 관리에서 직접 올린 신청. 지어내지 않는다", () => {
    const requests = parseInventoryStockRequestsResponse(BODY);
    assert.equal(requests?.[0].requestKey, "AS-TEST-0001");
    assert.equal(requests?.[1].requestKey, null);
  });

  test("차례를 다시 매기지 않는다 — 저쪽이 최근 것부터 준다", () => {
    const requests = parseInventoryStockRequestsResponse(BODY);
    assert.deepEqual(requests?.map((r) => r.id), ["r1", "r2"]);
  });

  test("결정·보류 사유를 그대로 들고 온다", () => {
    const requests = parseInventoryStockRequestsResponse(BODY);
    assert.equal(requests?.[1].decision?.note, "재고가 없습니다");
    assert.equal(requests?.[1].hold?.reason, "부품 입고 대기");
  });

  test("🔴 모양이 아니면 null, 빈 목록은 빈 목록", () => {
    assert.equal(parseInventoryStockRequestsResponse({ requests: null }), null);
    assert.equal(parseInventoryStockRequestsResponse("오류 페이지"), null);
    assert.deepEqual(parseInventoryStockRequestsResponse({ count: 0, requests: [], notFound: [] }), []);
  });
});

/**
 * ============================================================================
 * 거두기 — 🔴 **단추를 그릴 줄과 거둘 수 있는 줄** (2026-10-16)
 * ============================================================================
 * 거두는 통로가 열렸다. 여기서 재는 것은 **판정 규칙**이고, 화면이 그 규칙을 실제로 쓰는가는
 * `components/inventory/part-request-section-wiring.test.ts` 가, 통로를 어떻게 두드리는가는
 * `lib/server/inventory-gateway.test.ts` 가 잰다.
 *
 * 🔴 이 판정은 **편의**다 — 진짜 울타리는 서버 액션과 저쪽 통로다. 그래도 여기서 넷을 각각
 *    재어 두는 까닭은, 남의 신청에 단추가 그려지면 누르는 사람은 「내 것인데 왜 안 되지」로
 *    읽고 담당자를 찾아다니기 때문이다.
 * ============================================================================
 */
const MY_SUB = "지어낸-포털번호-나-1111";
const OTHER_SUB = "지어낸-포털번호-남-2222";

/** 네 갈래를 **통로 응답 모양 그대로** 만든다 — 파서를 지나야 실제 길과 같은 것을 잰다. */
function parsedFourRows(): InventoryStockRequest[] {
  const parsed = parseInventoryStockRequestsResponse({
    count: 4,
    requests: [
      {
        requestKey: "AS-TEST-0001",
        id: "r1",
        intakeNumber: "D260701",
        status: { code: "PENDING", label: "확인 대기" },
        closed: false,
        requestedAt: "2026-10-16T01:00:00.000Z",
        lines: [{ no: 11, name: "AMP-TEST-A1", quantity: 2, issued: 0 }],
        requester: { sub: MY_SUB, name: "홍길동" },
      },
      {
        requestKey: "AS-TEST-0002",
        id: "r2",
        intakeNumber: "D260701",
        status: { code: "PARTIAL", label: "일부 나감" },
        closed: false,
        requestedAt: "2026-10-16T02:00:00.000Z",
        lines: [{ no: 11, name: "AMP-TEST-A1", quantity: 8, issued: 5 }],
        requester: { sub: MY_SUB, name: "홍길동" },
      },
      {
        requestKey: "AS-TEST-0003",
        id: "r3",
        intakeNumber: "D260701",
        status: { code: "PENDING", label: "확인 대기" },
        closed: false,
        requestedAt: "2026-10-16T03:00:00.000Z",
        lines: [{ no: 12, name: "AMP-TEST-B2", quantity: 1, issued: 0 }],
        requester: { sub: OTHER_SUB, name: "임꺽정" },
      },
      {
        requestKey: null,
        id: "r4",
        intakeNumber: "D260701",
        status: { code: "PENDING", label: "확인 대기" },
        closed: false,
        requestedAt: "2026-10-16T04:00:00.000Z",
        lines: [{ no: 13, name: "AMP-TEST-C3", quantity: 1, issued: 0 }],
        requester: { sub: OTHER_SUB, name: "임꺽정" },
      },
    ],
  });
  assert.ok(parsed, "응답 모양을 못 읽었다");
  return parsed;
}

describe("🔴 올린 사람 — 가르는 값은 포털 번호뿐이다", () => {
  test("포털 번호와 이름을 그대로 읽는다", () => {
    const rows = parsedFourRows();
    assert.deepEqual(rows[0].requester, { sub: MY_SUB, name: "홍길동" });
  });

  test("🔴 포털 번호가 없으면 통째로 null — 이름만으로 사람을 가르지 않는다", () => {
    const parsed = parseInventoryStockRequestsResponse({
      requests: [{ requestKey: "AS-TEST-0009", id: "r9", status: { code: "PENDING", label: "확인 대기" }, requester: { name: "홍길동" } }],
    });
    assert.equal(parsed?.[0].requester, null);
  });

  test("requester 칸이 아예 없는 응답도 읽는다 — 「누가 올렸는지 모른다」다", () => {
    const parsed = parseInventoryStockRequestsResponse({
      requests: [{ requestKey: "AS-TEST-0010", id: "r10", status: { code: "PENDING", label: "확인 대기" } }],
    });
    assert.equal(parsed?.[0].requester, null);
  });
});

describe("🔴 화면 모양으로 바꿀 때 포털 번호를 뗀다", () => {
  test("🔴 sub 이 화면 모양에 한 글자도 남지 않는다 — props 는 브라우저로 나간다", () => {
    const screen = toScreenStockRequests(parsedFourRows(), MY_SUB);
    assert.equal(Object.prototype.hasOwnProperty.call(screen[0], "requester"), false);
    assert.equal(JSON.stringify(screen).includes(MY_SUB), false, "내 포털 번호가 화면으로 나간다");
    assert.equal(JSON.stringify(screen).includes(OTHER_SUB), false, "남의 포털 번호가 화면으로 나간다");
  });

  test("내 포털 번호와 같은 줄만 mine 이다 — 이름은 보여 주되 가름은 번호로", () => {
    const screen = toScreenStockRequests(parsedFourRows(), MY_SUB);
    assert.deepEqual(screen.map((r) => r.mine), [true, true, false, false]);
    assert.equal(screen[2].requesterName, "임꺽정");
  });

  test("🔴 포털 번호가 없는 사람에게는 전부 남의 것이다 — 비교할 값이 없다", () => {
    const screen = toScreenStockRequests(parsedFourRows(), null);
    assert.deepEqual(screen.map((r) => r.mine), [false, false, false, false]);
  });

  test("올린 사람을 모르는 줄은 내 것이 아니다", () => {
    const parsed = parseInventoryStockRequestsResponse({
      requests: [{ requestKey: "AS-TEST-0011", id: "r11", status: { code: "PENDING", label: "확인 대기" } }],
    });
    assert.equal(toScreenStockRequests(parsed ?? [], MY_SUB)[0].mine, false);
  });
});

describe("🔴 [요청 취소]를 그릴 줄 — 넷을 각각 잰다", () => {
  const screen = () => toScreenStockRequests(parsedFourRows(), MY_SUB);

  test("㉠ 내 것 · 대기 → 그린다", () => {
    assert.equal(canCancelStockRequest(screen()[0]), true);
  });

  test("㉡ 내 것 · 일부 나감 → 그리지 않는다(창고에서 물건이 이미 움직였다)", () => {
    assert.equal(canCancelStockRequest(screen()[1]), false);
  });

  test("㉢ 남의 것 · 대기 → 그리지 않는다", () => {
    assert.equal(canCancelStockRequest(screen()[2]), false);
  });

  test("㉣ 열쇠 없는 줄(재고 관리에서 직접 올린 신청) → 그리지 않는다", () => {
    assert.equal(canCancelStockRequest(screen()[3]), false);
  });

  test("마감된 줄은 그리지 않는다", () => {
    assert.equal(canCancelStockRequest({ ...screen()[0], closed: true }), false);
  });

  test("🔵 모르는 상태 코드는 **못 거두는 것으로** 본다 — 되돌릴 수 없는 일을 열지 않는다", () => {
    assert.equal(canCancelStockRequest({ ...screen()[0], status: { code: "NEW_CODE", label: "새 상태" } }), false);
  });
});

describe("🔴 그 열쇠가 이 수리 건의 신청인가 — 서버가 거두기 전에 보는 것", () => {
  test("이 건의 목록에 있는 열쇠면 참", () => {
    assert.equal(stockRequestKeyBelongsToCase(parsedFourRows(), "AS-TEST-0001"), true);
  });

  test("🔴 다른 건의 열쇠는 거짓 — 그대로 보내면 남의 건 신청이 거둬진다", () => {
    assert.equal(stockRequestKeyBelongsToCase(parsedFourRows(), "AS-TEST-9999"), false);
  });

  test("빈 글자·공백은 거짓이고, 열쇠 없는 줄과는 맞지 않는다", () => {
    assert.equal(stockRequestKeyBelongsToCase(parsedFourRows(), "   "), false);
    assert.equal(stockRequestKeyBelongsToCase(parsedFourRows(), ""), false);
  });

  test("앞뒤 공백은 같은 열쇠로 본다", () => {
    assert.equal(stockRequestKeyBelongsToCase(parsedFourRows(), "  AS-TEST-0002  "), true);
  });
});

describe("올릴 줄의 모양 — 화면과 서버 액션이 함께 쓴다", () => {
  test("🔴 유상/무상이 빠지면 올라가지 않는다", () => {
    const result = parseStockRequestLines([{ no: 11, quantity: 2 }], new Map([[11, "AMP-TEST-A1"]]));
    assert.equal(result.ok, false);
    assert.match(result.ok ? "" : result.message, /유상\/무상/);
    // 이름을 적어 준다 — 열 줄 가운데 어느 줄인지 알아야 고친다.
    assert.match(result.ok ? "" : result.message, /AMP-TEST-A1/);
  });

  test("🔴 기본값으로 채워 주지 않는다 — 빈 글자·모르는 값도 거절", () => {
    for (const chargeType of ["", null, undefined, "유상", "paid", "PAID ", 1]) {
      const result = parseStockRequestLines([{ no: 11, quantity: 1, chargeType }]);
      assert.equal(result.ok, false, `chargeType=${String(chargeType)} 가 통과했다`);
    }
  });

  test("유상·무상이 한 요청 안에 섞여도 된다", () => {
    const result = parseStockRequestLines([
      { no: 11, quantity: 2, chargeType: "PAID" },
      { no: 12, quantity: 1, chargeType: "FREE" },
    ]);
    assert.equal(result.ok, true);
    assert.deepEqual(result.ok ? result.lines : null, [
      { no: 11, quantity: 2, chargeType: "PAID" },
      { no: 12, quantity: 1, chargeType: "FREE" },
    ]);
  });

  test("한 줄도 없으면 거절한다", () => {
    assert.equal(parseStockRequestLines([]).ok, false);
    assert.equal(parseStockRequestLines(null).ok, false);
  });

  test(`${MAX_STOCK_REQUEST_LINES}줄을 넘으면 거절한다`, () => {
    const many = Array.from({ length: MAX_STOCK_REQUEST_LINES + 1 }, (_, i) => ({
      no: i + 1,
      quantity: 1,
      chargeType: "FREE",
    }));
    assert.equal(parseStockRequestLines(many).ok, false);
    assert.equal(parseStockRequestLines(many.slice(0, MAX_STOCK_REQUEST_LINES)).ok, true);
  });

  test("🔴 글자로 온 숫자를 조용히 고쳐 주지 않는다", () => {
    assert.equal(parseStockRequestLines([{ no: "11", quantity: 1, chargeType: "FREE" }]).ok, false);
    assert.equal(parseStockRequestLines([{ no: 11, quantity: "1", chargeType: "FREE" }]).ok, false);
  });

  test("수량은 1 이상의 정수다", () => {
    for (const quantity of [0, -1, 1.5, Number.NaN, 1_000_001]) {
      assert.equal(parseStockRequestLines([{ no: 11, quantity, chargeType: "FREE" }]).ok, false, `${quantity} 가 통과했다`);
    }
    assert.equal(parseStockRequestLines([{ no: 11, quantity: 1_000_000, chargeType: "FREE" }]).ok, true);
  });

  test("🔴 같은 부품이 두 줄이면 거절한다 — 저쪽도 거절한다", () => {
    const result = parseStockRequestLines([
      { no: 11, quantity: 1, chargeType: "FREE" },
      { no: 11, quantity: 2, chargeType: "PAID" },
    ]);
    assert.equal(result.ok, false);
    assert.match(result.ok ? "" : result.message, /한 줄로 합쳐/);
  });
});

describe("자잘한 것", () => {
  test("유상/무상 코드와 글자", () => {
    assert.equal(isChargeType("PAID"), true);
    assert.equal(isChargeType("free"), false);
    assert.equal(CHARGE_TYPE_LABELS.PAID, "유상");
    assert.equal(CHARGE_TYPE_LABELS.FREE, "무상");
  });

  test("요청 번호는 1~100자 글자다", () => {
    assert.equal(isValidRequestKey(""), false);
    assert.equal(isValidRequestKey("   "), false);
    assert.equal(isValidRequestKey(123), false);
    assert.equal(isValidRequestKey("a".repeat(100)), true);
    assert.equal(isValidRequestKey("a".repeat(101)), false);
  });

  test("🔴 못 받아 온 까닭 다섯 다 「없습니다」라고 말하지 않는다", () => {
    for (const reason of ["not_configured", "timeout", "unauthorized", "api_closed", "error"] as const) {
      const message = inventoryUnreachableMessage(reason);
      assert.ok(message.length > 0, reason);
      assert.doesNotMatch(message, /재고에 (부품이 )?없습니다/, reason);
    }
  });
});

/**
 * ============================================================================
 * 🔴 부품 줄에 **그 부품의 모든 것**을 보인다 — 값이 있는 것만 (2026-10-16 요청 B·C)
 * ============================================================================
 * 다 적으면 줄이 길어져 **아무것도 안 읽히는** 쪽으로 망가진다. 그래서 「없는 칸은 안 그린다」가
 * 규칙이고, 🔴 **`-` 만 적힌 칸도 없는 칸**이다 — 이 자료는 엑셀에서 넘어와 빈칸 대신 `-` 가
 * 적힌 줄이 많다. 재고 관리도 **같은 글자들**을 빈 값으로 본다(저쪽 `lib/parts/form.ts` 의
 * `DASH_ONLY`) — 자가 어긋나면 한쪽은 「이름이 있다」고 그리는데 다른 쪽은 「비어 있다」고 한다.
 * ============================================================================
 */
describe("🔴 부품 줄에 보이는 것 — 값이 있는 것만, `-` 는 값이 아니다", () => {
  const part = (over: Partial<InventoryPart>): InventoryPart => ({
    no: 11,
    name: "마그네트론",
    name2: "",
    customerName: "",
    kyosanPartNo: "",
    drawingNo: "",
    quantity: 0,
    note: "",
    owner: { code: "DSS", label: "DSS" },
    quotePrice: null,
    overhaulQuotePrice: null,
    ...over,
  });

  test("고객사 품명 — 적혀 있으면 그대로, 비어 있으면 빈 글자", () => {
    assert.equal(inventoryPartCustomerName(part({ customerName: "발진관 조립품" })), "발진관 조립품");
    assert.equal(inventoryPartCustomerName(part({ customerName: "" })), "");
  });

  test("🔴 `-` 만 적힌 고객사 품명은 **없는 것**이다 — 서류에 `-` 가 이름으로 찍히면 안 된다", () => {
    // 🔴 재고 관리도 `-` 를 고객사 품명으로 받지 않는다(보내면 400). 여기서 값으로 세면
    //    견적서는 그 부품을 고를 수 있다고 그리고, 나가는 종이에는 `-` 가 찍힌다.
    for (const dash of ["-", "--", "–", "—", "－", "ㅡ", "  -  "]) {
      assert.equal(inventoryPartCustomerName(part({ customerName: dash })), "", dash);
    }
  });

  test("🔴 교산 품번 · 도번 — **값이 있는 것만** 이름표를 달아 돌려준다", () => {
    assert.deepEqual(
      inventoryPartIdLabels(part({ kyosanPartNo: "KY-7788", drawingNo: "DWG-1001" })),
      [
        { label: "교산 품번", value: "KY-7788" },
        { label: "도번", value: "DWG-1001" },
      ]
    );
    // 한쪽만 있으면 한 줄만 — 「도번 없음」을 적지 않는다.
    assert.deepEqual(inventoryPartIdLabels(part({ kyosanPartNo: "KY-7788", drawingNo: "-" })), [
      { label: "교산 품번", value: "KY-7788" },
    ]);
    // 둘 다 없으면 **아무것도 없다** — 화면이 그 줄을 아예 안 그린다.
    assert.deepEqual(inventoryPartIdLabels(part({ kyosanPartNo: "-", drawingNo: "" })), []);
  });

  test("품명2도 같은 자로 잰다 — 품명 뒤에 ` · -` 가 붙으면 읽는 눈을 뺏는다", () => {
    assert.equal(inventoryPartSpec(part({ name2: "2M244-M1" })), "2M244-M1");
    assert.equal(inventoryPartSpec(part({ name2: "-" })), "");
  });

  test("🔴 다섯 가지가 **모두** 나올 길이 있다 — 하나라도 빠지면 요청 B 가 깨진다", () => {
    const full = part({
      name2: "2M244-M1",
      customerName: "발진관 조립품",
      kyosanPartNo: "KY-7788",
      drawingNo: "DWG-1001",
    });
    const shown = [
      full.name,
      inventoryPartSpec(full),
      inventoryPartCustomerName(full),
      ...inventoryPartIdLabels(full).map((item) => item.value),
    ];
    assert.deepEqual(shown, ["마그네트론", "2M244-M1", "발진관 조립품", "KY-7788", "DWG-1001"]);
  });

  test("🔴 비어 있을 때의 안내는 **까닭과 고칠 길**까지 말한다 — 「없음」으로 끝내지 않는다", () => {
    assert.match(CUSTOMER_NAME_EMPTY_NOTICE, /고객사 품명 없음/);
    assert.match(CUSTOMER_NAME_EMPTY_NOTICE, /견적서/, "견적서에서 막히는 까닭이 안 적혀 있다");
  });

  test("🔴 「이미 있습니다」는 **지금 값**을 말하고 덮지 않았다고 적는다", () => {
    const lines = customerNameAlreadySetLines({ no: 165, name: "마그네트론", customerName: "발진관 조립품" });
    assert.ok(lines.join(" ").includes("「발진관 조립품」"), "지금 값을 말하지 않는다");
    assert.ok(lines.join(" ").includes("No. 165"), "어느 부품인지 말하지 않는다");
    assert.ok(lines.join(" ").includes("덮어쓰지 않았습니다"), "덮지 않았다는 사실이 없다");
    // 🔴 거절처럼 보이면 안 된다 — 사람이 할 일이 다르다(고쳐 보내기 vs 그대로 쓰기).
    assert.doesNotMatch(lines.join(" "), /실패|오류|거절/);
  });
});
