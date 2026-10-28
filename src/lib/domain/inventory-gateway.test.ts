import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  CHARGE_TYPE_LABELS,
  CUSTOMER_NAME_EMPTY_NOTICE,
  INVENTORY_STOCK_AS_OF_NOTE,
  MAX_STOCK_REQUEST_LINES,
  canCancelStockRequest,
  customerNameAlreadySetLines,
  filterInventoryParts,
  inventoryPartCustomerName,
  inventoryPartIdLabels,
  inventoryPartNoteFirstLine,
  inventoryPartSpec,
  inventoryStockText,
  inventoryUnreachableMessage,
  isChargeType,
  isInventoryRequestSettled,
  isValidRequestKey,
  parseInventoryOhTemplateResponse,
  parseInventoryPartsResponse,
  parseInventoryStockRequestsResponse,
  parseStockRequestLines,
  resolveInventoryPartRequestTrace,
  stockRequestDecisionLabel,
  stockRequestKeyBelongsToCase,
  stockRequestLineChargeTag,
  stockRequestLineCustomerName,
  stockRequestLineDetails,
  stockRequestLineOwnerTag,
  stockRequestStatusBadge,
  toScreenStockRequests,
  STOCK_REQUEST_CHARGE_TAG_CLASS,
  STOCK_REQUEST_CHARGE_TAG_UNKNOWN_CLASS,
  STOCK_REQUEST_LINE_BLOCK_CLASS,
  STOCK_REQUEST_OWNER_TAG_CLASS,
  STOCK_REQUEST_QUANTITY_LABEL_CLASS,
  STOCK_REQUEST_QUANTITY_VALUE_CLASS,
  STOCK_REQUEST_STATUS_BADGE_CLASS,
  STOCK_REQUEST_STATUS_BADGE_CLOSED,
  STOCK_REQUEST_STATUS_BADGE_SHAPE,
  STOCK_REQUEST_STATUS_BADGE_UNKNOWN,
  type InventoryPart,
  type InventoryStockRequest,
  type InventoryStockRequestLine,
} from "./inventory-gateway";
/* 🔴 차례와 이름표를 **여기서 다시 적지 않는다** — 시험이 제 손으로 적으면 그 표를 고치는 날
   시험만 옛 차례를 지키고, 화면은 조용히 다른 차례로 간다(2026-10-16 요청 ③). */
import { PART_FIELD_LABELS, PART_FIELD_ORDER } from "@dss/core/ui/inventory/part-picker-rows";

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
 * 🔴 부품 요청 흔적 — **있다 · 없다 · 모른다** (2026-10-28)
 * ============================================================================
 * 이 판정이 가리는 것은 연락서 이식이 교체 부품을 **사용 부품 칸에 덮어쓸지 말지**다
 * (`server/services/kyosan-report-import.ts`). 쓰는 분의 잣대 그대로 — 「[부품 요청] 칸에
 * **반출신청된 어떤 흔적이라도** 있으면 했었다고 본다」.
 *
 * 🔴 **가장 비싼 실수 자리는 「모른다」를 「없다」로 바꾸는 것**이다. 그러면 재고 관리가
 *    잠깐 멈춘 사이에 **이미 부품을 받아 간 건**의 사용 부품이 연락서 내용으로 덮어써지고,
 *    오류가 한 번도 안 나므로 아무도 신고하지 않는다. 그래서 다섯 갈래를 하나씩 센다.
 * ============================================================================
 */
describe("🔴 부품 요청 흔적 — 있다 · 없다 · 모른다", () => {
  test("🔴 못 받아 온 다섯 갈래가 **전부** 「모른다」다 — 하나도 「없다」로 눕지 않는다", () => {
    const reasons = ["not_configured", "timeout", "unauthorized", "api_closed", "error"] as const;
    // 🔵 표본이 비면 이 시험은 공짜로 통과한다 — 다섯을 다 재는지부터 못 박는다.
    assert.equal(reasons.length, 5);
    for (const reason of reasons) {
      const trace = resolveInventoryPartRequestTrace({ status: "unreachable", reason });
      assert.deepEqual(trace, { kind: "unknown", reason }, reason);
    }
  });

  test("빈 목록은 「없다」 — 저쪽이 200 으로 준 **사실**이다", () => {
    assert.deepEqual(resolveInventoryPartRequestTrace({ status: "ok", value: [] }), { kind: "absent" });
  });

  test("🔴 취소·반려된 신청도 **흔적**이다 — 상태로 거르지 않는다", () => {
    const parsed = parseInventoryStockRequestsResponse({
      count: 1,
      requests: [
        {
          requestKey: "AS-TEST-0009",
          id: "r9",
          intakeNumber: "D260701",
          status: { code: "CANCELLED", label: "취소됨" },
          closed: false,
          requestedAt: "2026-10-20T01:00:00.000Z",
          lines: [],
        },
      ],
    });
    // 🔵 **표본이 진짜 그 표본인지** 먼저 센다 — 빈 목록을 「취소된 신청」이라 부르며
    //    통과하는 시험이 되지 않게.
    assert.ok(parsed);
    assert.equal(parsed.length, 1);
    assert.equal(
      isInventoryRequestSettled(parsed[0]),
      true,
      "표본이 **끝난(취소된) 신청**이어야 이 시험이 뜻이 있다"
    );
    assert.deepEqual(resolveInventoryPartRequestTrace({ status: "ok", value: parsed }), {
      kind: "present",
      count: 1,
    });
  });

  test("🔵 줄의 내용을 쳐다보지 않는다 — 화면의 모양이든 서버의 모양이든 **같은 자**다", () => {
    assert.deepEqual(resolveInventoryPartRequestTrace({ status: "ok", value: [{}, {}, {}] }), {
      kind: "present",
      count: 3,
    });
  });
});

/**
 * 🔴 **자가 한 벌인지 파일의 글자로 본다.** 화면과 서버가 따로 세기 시작하면, 사람은 그 칸에서
 * 신청을 보고 있는데 서버는 「요청한 적 없다」로 읽고 **그 건의 사용 부품을 덮는다.** 그 어긋남은
 * 오류를 내지 않으므로 값 시험으로는 영영 안 잡힌다 — 세 파일이 **같은 함수**에 닿는지를 본다.
 */
describe("🔴 화면과 서버가 같은 자를 쓴다 — 세 파일의 글자", () => {
  const read = (relative: string) => readFileSync(join(process.cwd(), relative), "utf8");

  test("화면은 이름 붙은 자를 쓴다 — 제 손으로 길이를 세지 않는다", () => {
    const screen = read("src/components/repair-cases/detail/PartRequestSection.tsx");
    assert.match(screen, /resolveInventoryPartRequestTrace\(requests\)/);
    assert.doesNotMatch(screen, /requests\.value\.length/);
  });

  test("서버 통로의 probe 가 **그 함수를 그대로** 지난다", () => {
    const gateway = read("src/lib/server/inventory-gateway.ts");
    assert.match(
      gateway,
      /export async function probeInventoryPartRequestTrace[\s\S]{0,400}resolveInventoryPartRequestTrace\(await fetchInventoryStockRequestsByIntake\(intakeNumber\)\)/
    );
  });

  test("🔴 연락서 이식이 그 probe 를 쓴다 — 제 판정을 새로 짓지 않는다", () => {
    const importer = read("src/lib/server/services/kyosan-report-import.ts");
    assert.match(importer, /await probeInventoryPartRequestTrace\(plan\.intakeNumber\)/);
    // 🔴 상태 코드로 거르는 식이 이식기 쪽에 따로 생기지 않았는가(화면은 안 거른다).
    assert.doesNotMatch(importer, /status\.code === "(?:PENDING|CONFIRMED|REJECTED|CANCELLED)"/);
  });
});

/**
 * ============================================================================
 * 🔴 **요청 비고 — 올릴 때 적은 말을 되읽는다** (2026-10-22 쓰는 분 요청)
 * ============================================================================
 * 2026-10-22 에 올리는 쪽이 뚫렸다(화면에 적는 칸이 생겼다). 그런데 **되읽는 길이 없어서**
 * 적어 보낸 말이 A/S 화면에서는 어디에도 안 보였다 — 통로가 주는 값을 파서가 안 담고 있었다.
 *
 * ── 🔴 **없으면 `null` 이 아니라 빈 글자다** ──────────────────────────────
 * 이웃한 `decision`·`hold` 와 **다른 종류의 값**이라서다. 저 둘은 「일어났나 안 일어났나」지만
 * 요청 비고는 **적힌 말**이다 — 받는 쪽이 `null` 검사와 빈 글자 검사를 둘 다 하게 만들 까닭이
 * 없다. 🔵 **빈 것이 정상인 자리가 많다**: 안 적은 신청 · 칸이 생기기 전의 옛 신청 · 재고
 * 관리에서 직접 올린 신청.
 *
 * ── 🔴 **저쪽이 아직 안 보내도 안 터진다** ───────────────────────────────
 * 두 저장소가 따로 고쳐지므로 **칸이 아예 없는 응답**이 실제로 온다. 그때 화면이 500 이 되거나
 * 「undefined」를 그리면 안 되고, **안 적은 신청과 똑같이** 보여야 한다. 🔵 저쪽이 칸을 영영
 * 안 보내게 되는 것은 다른 이야기라 점검 도구가 ✗ 로 잡는다(`scripts/check-inventory-contract.ts`).
 * ============================================================================
 */
describe("🔴 요청 비고 — 올릴 때 적은 말을 되읽는다", () => {
  /** 🔵 **통로 응답 모양 그대로** 만든다 — 파서를 지나야 실제 길과 같은 것을 잰다. */
  function noteOf(over: Record<string, unknown>): string | undefined {
    const parsed = parseInventoryStockRequestsResponse({
      count: 1,
      requests: [
        {
          requestKey: "AS-TEST-0001",
          id: "r1",
          intakeNumber: "D260701",
          status: { code: "PENDING", label: "대기" },
          closed: false,
          requestedAt: "2026-10-22T01:00:00.000Z",
          lines: [{ no: 11, name: "AMP-TEST-A1", quantity: 2, issued: 0 }],
          ...over,
        },
      ],
    });
    assert.ok(parsed, "응답 모양을 못 읽었다");
    return parsed[0]?.note;
  }

  test("① 적어 보낸 말이 있으면 그대로 읽는다", () => {
    assert.equal(noteOf({ note: "O/H 때 쓸 부품입니다" }), "O/H 때 쓸 부품입니다");
  });

  test("① 🔵 가운데 줄바꿈은 **적은 사람의 것**이라 살린다 — 앞뒤 공백만 뗀다", () => {
    // 🔴 여러 줄로 적을 수 있는 칸이다(화면이 textarea 다). 줄바꿈을 뭉개면 적은 글이 달라진다.
    assert.equal(noteOf({ note: "  첫 줄\n둘째 줄  " }), "첫 줄\n둘째 줄");
  });

  test("② 🔴 칸이 **아예 없어도 안 터지고** 빈 글자다 — 저쪽이 아직 안 고쳐졌을 수 있다", () => {
    assert.equal(noteOf({}), "");
  });

  test("③ 🔴 글자가 아닌 값이 와도 빈 글자다 — `null`·숫자·객체 전부", () => {
    // 🔴 `null` 을 그대로 들고 가면 화면이 `null` 검사와 빈 글자 검사를 둘 다 해야 한다.
    assert.equal(noteOf({ note: null }), "");
    assert.equal(noteOf({ note: 1000 }), "");
    assert.equal(noteOf({ note: { text: "적은 말" } }), "");
    assert.equal(noteOf({ note: ["적은 말"] }), "");
  });

  test("🔴 **`decision.note` 와 섞이지 않는다** — 적은 사람이 다르다", () => {
    const parsed = parseInventoryStockRequestsResponse({
      count: 1,
      requests: [
        {
          requestKey: "AS-TEST-0001",
          id: "r1",
          intakeNumber: "D260701",
          status: { code: "REJECTED", label: "반려" },
          closed: false,
          requestedAt: "2026-10-22T01:00:00.000Z",
          note: "요청한 사람이 적은 말",
          lines: [{ no: 11, name: "AMP-TEST-A1", quantity: 2, issued: 0 }],
          decision: { byName: "담당자", at: "2026-10-22T02:00:00.000Z", note: "재고 담당자가 적은 말" },
        },
      ],
    });
    assert.equal(parsed?.[0].note, "요청한 사람이 적은 말");
    assert.equal(parsed?.[0].decision?.note, "재고 담당자가 적은 말");
  });

  test("🔵 화면 모양으로 바뀌어도 따라간다 — 되읽는 자리가 화면이다", () => {
    const parsed = parseInventoryStockRequestsResponse({
      count: 1,
      requests: [
        {
          requestKey: "AS-TEST-0001",
          id: "r1",
          intakeNumber: "D260701",
          status: { code: "PENDING", label: "대기" },
          closed: false,
          requestedAt: "2026-10-22T01:00:00.000Z",
          note: "O/H 때 쓸 부품입니다",
          lines: [{ no: 11, name: "AMP-TEST-A1", quantity: 2, issued: 0 }],
          requester: { sub: MY_SUB, name: "홍길동" },
        },
      ],
    });
    assert.ok(parsed);
    assert.equal(toScreenStockRequests(parsed, MY_SUB)[0].note, "O/H 때 쓸 부품입니다");
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
    /* 🔵 2026-10-22: O/H 표시를 안 준 줄은 **거짓**으로 서고, 칸은 그래도 선다 — 「안 보내면
       O/H 아님」이 실제로 도는 모습이다. 그 칸만 재는 자리는 `inventory-oh-line.test.ts` 다. */
    assert.deepEqual(result.ok ? result.lines : null, [
      { no: 11, quantity: 2, chargeType: "PAID", fromOhTemplate: false },
      { no: 12, quantity: 1, chargeType: "FREE", fromOhTemplate: false },
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

  test("🔴 재고 수에는 **언제 잰 값인지**가 붙어 있다 (2026-10-16 요청 ④)", () => {
    /**
     * 🔴 이 수는 화면을 **열 때** 한 번 받아 온 값이다. 숫자만 적으면 「지금 3개 있다」로
     *    읽혀, 그 수를 믿고 요청 수량을 정했다가 막상 나갈 때 모자라면 사람은 재고 관리가
     *    틀렸다고 생각한다 — 틀린 것은 그 수를 **언제 잰 것인지 말하지 않은 화면**이다.
     * 🔵 「현재 재고」라고 적지 않는 까닭도 같다 — 그것은 더 틀린 말이다.
     */
    assert.equal(inventoryStockText(part({ quantity: 3 })), "재고 3개(불러온 때 기준)");
    // 0 도 그대로 적는다 — 「없다」가 아니라 「그때 0 이었다」다.
    assert.equal(inventoryStockText(part({ quantity: 0 })), "재고 0개(불러온 때 기준)");
    assert.ok(inventoryStockText(part({ quantity: 3 })).includes(INVENTORY_STOCK_AS_OF_NOTE));
    assert.doesNotMatch(inventoryStockText(part({ quantity: 3 })), /현재|지금/);
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

/**
 * ============================================================================
 * 🔴 결정 사유 상자의 머리글 — 셋으로 갈린다 (2026-10-21)
 * ============================================================================
 * 보류 사유에는 제목이 있는데 결정 사유에만 없어서, 사람이 **상태 배지를 보고 유추**해야
 * 했다. 재고 관리가 같은 자리를 먼저 셋으로 갈랐고(저쪽 `requestDecisionNote`), **같은
 * 규칙**으로 맞춘다 — 두 화면이 같은 자료를 다른 말로 부르면 오가는 사람이 다른 것인 줄 안다.
 *
 * 🔴 **가르는 차례가 상태 배지와 같아야 한다 — ① 마감 ② 반려 ③ 그 밖.** 배지가 「마감」인데
 *    상자가 「반려 사유」라고 하면 같은 줄이 두 말을 한다.
 * ============================================================================
 */
describe("🔴 결정 사유의 머리글", () => {
  function decided(code: string, closed: boolean) {
    return { status: { code, label: "" }, closed };
  }

  test("마감된 신청은 「마감 사유」 — 🔴 상태값이 아니라 `closed` 칸으로 가린다", () => {
    // 🔵 마감의 코드는 CONFIRMED 다(저쪽은 상태를 새로 만들지 않았다) — code 로는 「다 나감」과
    //    구별되지 않으므로, closed 를 안 보면 이 줄이 「결정 사유」로 떨어진다.
    assert.equal(stockRequestDecisionLabel(decided("CONFIRMED", true)), "마감 사유");
  });

  test("반려된 신청은 「반려 사유」", () => {
    assert.equal(stockRequestDecisionLabel(decided("REJECTED", false)), "반려 사유");
  });

  test("🔴 마감이 반려보다 **앞**이다 — 둘 다 맞는 줄이 생겨도 답이 하나다", () => {
    // 저쪽도 같은 차례다. 적어 두지 않으면 그런 줄이 하나 생기는 날 두 화면이 다른 이름을 부른다.
    assert.equal(stockRequestDecisionLabel(decided("REJECTED", true)), "마감 사유");
  });

  test("그 밖은 「결정 사유」 — 🔵 지금 도달하지 않지만 「반려」로 뭉개지 않는다", () => {
    // 뭉개면 나중에 사유를 적는 자리가 하나 더 생겼을 때 그 줄이 **반려라고 거짓말을 한다.**
    assert.equal(stockRequestDecisionLabel(decided("CONFIRMED", false)), "결정 사유");
    assert.equal(stockRequestDecisionLabel(decided("CANCELLED", false)), "결정 사유");
    assert.equal(stockRequestDecisionLabel(decided("BRAND_NEW", false)), "결정 사유");
  });
});

/**
 * ============================================================================
 * 🔴 신청 줄에 **어느 부품인지**가 보인다 (2026-10-21 쓰는 분 요청)
 * ============================================================================
 * 「No. 165 AMP-… — 요청 2 / 불출 0」만으로는 가릴 수 없었다 — 같은 품명인 부품 묶음이 16개
 * 있다(재고 관리 API.md 2절). 재고 관리가 같은 날 제 화면을 그렇게 바꿨고, 그 뒤에 통로가
 * 칸을 내주게 넓어졌다. 🔵 **조회는 전부터 싣고 있었다** — 끊겨 있던 자리는 통로가 칸을 손으로
 * 옮겨 적는 그 한 곳이었다.
 *
 * 여기서 재는 것 넷:
 *  ㉠ **파서가 여섯을 다 들고 온다**(넷 + 딱지 둘), 그리고 **없는 것과 빈 것을 가른다.**
 *  ㉡ 🔴 **값이 없으면 빈 자리를 만들지 않는다** — `-` 만 적힌 칸도 없는 칸이다.
 *  ㉢ 🔴 **고객사 품명이 앞선다**, 나머지는 정해 둔 차례대로.
 *  ㉣ 🔴 **딱지 둘이 색 말고도 갈린다**, 그리고 **다크 짝이 붙어 있다.**
 *
 * 🔵 화면이 이 규칙을 실제로 쓰는가는 짝 시험이 잰다
 *    (`components/inventory/part-request-section-wiring.test.ts`). 둘 중 하나만 있으면 시험이
 *    비어 있는 것과 같다 — 규칙은 맞는데 화면이 안 쓰거나, 화면은 부르는데 규칙이 없다.
 * ============================================================================
 */

/** 줄 하나를 **통로 응답 모양 그대로** 만들어 파서를 지나게 한다 — 실제 길과 같은 것을 재려고. */
function parsedLine(over: Record<string, unknown> = {}): InventoryStockRequestLine {
  const parsed = parseInventoryStockRequestsResponse({
    requests: [
      {
        requestKey: "AS-TEST-0001",
        id: "r1",
        intakeNumber: "D260701",
        status: { code: "PENDING", label: "대기" },
        closed: false,
        requestedAt: "2026-10-21T01:00:00.000Z",
        lines: [
          {
            no: 165,
            name: "AMP-TEST-A1",
            quantity: 2,
            issued: 0,
            customerName: "증폭기 조립품",
            name2: "13M",
            kyosanPartNo: "KY-7788",
            drawingNo: "DWG-1001",
            owner: { code: "KYOSAN", label: "KYOSAN" },
            chargeType: { code: "PAID", label: "유상" },
            ...over,
          },
        ],
      },
    ],
  });
  assert.ok(parsed, "응답 모양을 못 읽었다");
  return parsed[0].lines[0];
}

describe("🔴 신청 줄의 자세한 내용 — 파서가 들고 온다", () => {
  test("㉠ 그 부품을 알아보는 값 넷이 그대로 온다", () => {
    const line = parsedLine();
    assert.equal(line.customerName, "증폭기 조립품");
    assert.equal(line.name2, "13M");
    assert.equal(line.kyosanPartNo, "KY-7788");
    assert.equal(line.drawingNo, "DWG-1001");
  });

  test("㉠ 딱지 둘도 코드와 글자를 그대로 들고 온다", () => {
    const line = parsedLine();
    assert.deepEqual(line.owner, { code: "KYOSAN", label: "KYOSAN" });
    assert.deepEqual(line.chargeType, { code: "PAID", label: "유상" });
  });

  test("🔴 옛 모양(칸이 없는 줄)도 읽는다 — 저쪽이 넓히기 전에 선 신청이 그렇다", () => {
    // 🔵 칸이 없는 것은 **오류가 아니다.** 없는 것으로 읽고 그 줄은 자세한 내용 없이 그려진다.
    const line = parsedLine({
      customerName: undefined,
      name2: undefined,
      kyosanPartNo: undefined,
      drawingNo: undefined,
      owner: undefined,
      chargeType: undefined,
    });
    assert.deepEqual([line.customerName, line.name2, line.kyosanPartNo, line.drawingNo], ["", "", "", ""]);
    assert.equal(line.owner, null);
    assert.equal(line.chargeType, null);
    // 🔴 머리줄이 쓰는 값은 그대로다 — 새 칸이 없다고 줄 자체가 무너지면 안 된다.
    assert.equal(line.no, 165);
    assert.equal(line.quantity, 2);
  });

  test("🔴 **없음과 빈 것을 가른다** — 코드가 없는 딱지는 통째로 `null` 이다", () => {
    // 🔴 `{ code: "", label: "" }` 을 「값이 있다」로 세면 **글자 없는 빈 딱지**가 화면에 선다.
    assert.equal(parsedLine({ owner: { code: "", label: "" } }).owner, null);
    assert.equal(parsedLine({ chargeType: { code: "", label: "" } }).chargeType, null);
    assert.equal(parsedLine({ owner: null }).owner, null);
    assert.equal(parsedLine({ chargeType: null }).chargeType, null);
  });

  test("🔵 글자가 없어도 코드가 있으면 값이다 — 그릴 때 코드를 그린다", () => {
    assert.deepEqual(parsedLine({ owner: { code: "DSS" } }).owner, { code: "DSS", label: "" });
  });
});

describe("🔴 신청 줄 — 값이 없으면 빈 자리를 만들지 않는다", () => {
  test("㉡ 고객사 품명이 비면 빈 글자다 — 「없음」을 지어내지 않는다", () => {
    assert.equal(stockRequestLineCustomerName(parsedLine({ customerName: "" })), "");
  });

  test("㉡ 🔴 `-` 만 적힌 칸도 **없는 칸**이다 — 자료가 엑셀에서 넘어왔다", () => {
    // 🔴 재는 자가 부품 찾기 줄과 **같은 하나**여야 한다 — 한쪽만 `-` 를 값으로 세면 같은 부품이
    //    두 자리에서 다르게 보인다.
    assert.equal(stockRequestLineCustomerName(parsedLine({ customerName: "-" })), "");
    assert.deepEqual(stockRequestLineDetails(parsedLine({ name2: "-", kyosanPartNo: "-", drawingNo: "-" })), []);
  });

  test("㉡ 빈 칸은 목록에서 아예 빠진다 — 있는 것만 남는다", () => {
    const details = stockRequestLineDetails(parsedLine({ name2: "", kyosanPartNo: "" }));
    assert.deepEqual(
      details.map((d) => d.key),
      ["drawingNo"]
    );
  });

  test("㉡ 🔴 지워진 부품 줄에는 **아무것도 안 그린다** — 소유도 자세한 내용도 없다", () => {
    const line = parsedLine({
      no: null,
      name: "(지워진 부품)",
      customerName: "",
      name2: "",
      kyosanPartNo: "",
      drawingNo: "",
      owner: null,
    });
    assert.equal(stockRequestLineCustomerName(line), "");
    assert.deepEqual(stockRequestLineDetails(line), []);
    assert.equal(stockRequestLineOwnerTag(line), null);
    // 🔵 **유상/무상은 남는다** — 부품 표가 아니라 신청 줄에서 오는 값이다.
    assert.notEqual(stockRequestLineChargeTag(line), null);
  });
});

describe("🔴 신청 줄 — 고객사 품명이 앞선다", () => {
  test("㉢ 앞세우는 값은 고객사 품명 하나다", () => {
    assert.equal(stockRequestLineCustomerName(parsedLine()), "증폭기 조립품");
  });

  test("㉢ 🔴 앞세운 값이 **나머지에 또 끼지 않는다** — 같은 글자가 두 줄에 서면 고른 것이 없는 것과 같다", () => {
    const keys = stockRequestLineDetails(parsedLine()).map((d) => d.key);
    assert.ok(!keys.includes("customerPartName"), "고객사 품명이 나머지에도 끼어 있다");
    assert.ok(!keys.includes("partName"), "품명이 끼어 있다 — 줄의 머리가 이미 그 값이다");
  });

  test("㉢ 나머지의 차례는 품명2 · 교산 품번 · 도번이고, 이름표도 정해 둔 한 곳에서 온다", () => {
    const details = stockRequestLineDetails(parsedLine());
    assert.deepEqual(
      details.map((d) => d.key),
      ["partSpec", "kyosanPartNo", "drawingNo"]
    );
    assert.deepEqual(
      details.map((d) => d.label),
      [PART_FIELD_LABELS.partSpec, PART_FIELD_LABELS.kyosanPartNo, PART_FIELD_LABELS.drawingNo]
    );
    assert.deepEqual(
      details.map((d) => d.value),
      ["13M", "KY-7788", "DWG-1001"]
    );
  });

  test("🔴 차례를 **이 자리에서 다시 적지 않았다** — `PART_FIELD_ORDER` 한 표가 쥔다", () => {
    // 🔵 거슬러 적어 두면 그 표를 고치는 날 이 줄만 옛 차례로 남는다.
    const order = stockRequestLineDetails(parsedLine()).map((d) => d.key);
    const inFieldOrder = [...order].sort((a, b) => PART_FIELD_ORDER.indexOf(a) - PART_FIELD_ORDER.indexOf(b));
    assert.deepEqual(order, inFieldOrder);
  });
});

describe("🔴 딱지 둘 — 성격이 다르고, 색 말고도 갈린다", () => {
  test("㉣ 소유구분은 **부품의 것**이고 이름표가 붙는다 — 값만으로는 무슨 칸인지 모른다", () => {
    const tag = stockRequestLineOwnerTag(parsedLine());
    assert.equal(tag?.key, "owner");
    assert.equal(tag?.label, "소유");
    assert.equal(tag?.value, "KYOSAN");
  });

  test("㉣ 유상/무상은 **그 줄의 것**이고 이름표가 없다 — 값 자체가 말이 된다", () => {
    const tag = stockRequestLineChargeTag(parsedLine());
    assert.equal(tag?.key, "chargeType");
    assert.equal(tag?.label, "", "「유상/무상 유상」처럼 같은 말이 두 번 나온다");
    assert.equal(tag?.value, "유상");
  });

  test("🔴 **둘을 따로 묻는다** — 한쪽이 없어도 다른 쪽은 선다", () => {
    // 🔴 한 함수로 합치면 「이 **부품**은 유상인가요?」라는 답이 없는 물음이 생긴다. 받는 칸이
    //    갈려 있다는 것을 값으로 확인한다 — 지워진 부품 줄은 소유가 없어도 유상/무상이 서고(위),
    //    대여·폐기 줄은 유상/무상이 없어도 소유가 선다(아래).
    const line = parsedLine({ chargeType: null });
    assert.equal(stockRequestLineChargeTag(line), null);
    assert.notEqual(stockRequestLineOwnerTag(line), null);
  });

  test("㉣ 🔴 유상과 무상이 **글자로** 갈린다 — 색을 전부 지워도 남는 가름", () => {
    assert.equal(stockRequestLineChargeTag(parsedLine({ chargeType: { code: "PAID", label: "유상" } }))?.value, "유상");
    assert.equal(stockRequestLineChargeTag(parsedLine({ chargeType: { code: "FREE", label: "무상" } }))?.value, "무상");
  });

  test("㉣ 🔴 유상과 무상이 **바탕이 차 있나**로도 갈린다 — 흑백으로 찍어도 보인다", () => {
    const paid = STOCK_REQUEST_CHARGE_TAG_CLASS.PAID;
    const free = STOCK_REQUEST_CHARGE_TAG_CLASS.FREE;
    // 🔴 색 이름만 다른 것으로는 모자라다. **칠해진 쪽과 안 칠해진 쪽**이 있어야 한다.
    assert.match(paid, /\bbg-amber-/, "유상 쪽이 칠해져 있지 않다");
    assert.match(free, /\bbg-white\b/, "무상 쪽이 카드와 같은 바탕이 아니다");
    assert.notEqual(paid.replace(/amber/g, "zinc"), free, "색 이름만 다르다 — 색약인 눈에는 같아 보인다");
  });

  test("㉣ 🔴 돈이 걸린 딱지만 굵다 — 소유구분은 보통 굵기다(색 아닌 표식 하나)", () => {
    for (const code of ["PAID", "FREE"] as const) {
      assert.match(STOCK_REQUEST_CHARGE_TAG_CLASS[code], /\bfont-semibold\b/, code);
    }
    assert.doesNotMatch(
      STOCK_REQUEST_OWNER_TAG_CLASS,
      /\bfont-semibold\b/,
      "소유구분이 유상/무상만큼 굵다 — 돈 걸린 값이 묻힌다"
    );
  });

  test("㉣ 🔴 **다크 짝이 전부 붙어 있다** — 밝은 쪽만 적으면 어두운 화면에서 글자가 잠긴다", () => {
    const classes = [
      STOCK_REQUEST_OWNER_TAG_CLASS,
      STOCK_REQUEST_CHARGE_TAG_CLASS.PAID,
      STOCK_REQUEST_CHARGE_TAG_CLASS.FREE,
      STOCK_REQUEST_CHARGE_TAG_UNKNOWN_CLASS,
    ];
    for (const className of classes) {
      // 밝은 쪽에 적은 border · bg · text 마다 dark: 짝이 하나씩 있어야 한다.
      for (const kind of ["border", "bg", "text"] as const) {
        const light = new RegExp(`(?<!dark:)\\b${kind}-(?:[a-z]+-\\d|white\\b)`).test(className);
        const dark = new RegExp(`dark:${kind}-(?:[a-z]+-\\d|white\\b)`).test(className);
        assert.equal(light, dark, `${kind} 의 다크 짝이 빠졌다: ${className}`);
      }
    }
  });

  test("🔴 모르는 유상/무상 코드는 **둘 중 아무 쪽으로도 칠하지 않는다** — 점선으로 세운다", () => {
    // 🔴 모르는 값을 무상처럼 칠하면 **청구가 따라붙는 줄이 안 붙는 줄로 보인다.**
    const tag = stockRequestLineChargeTag(parsedLine({ chargeType: { code: "BRAND_NEW", label: "새 값" } }));
    assert.equal(tag?.value, "새 값", "저쪽이 준 글자를 안 쓴다");
    assert.match(tag?.className ?? "", /\bborder-dashed\b/, "모르는 값인지 알 길이 없다");
    assert.notEqual(tag?.className, STOCK_REQUEST_CHARGE_TAG_CLASS.PAID);
    assert.notEqual(tag?.className, STOCK_REQUEST_CHARGE_TAG_CLASS.FREE);
  });

  test("🔴 글자는 **저쪽이 준 것 그대로**다 — 없으면 코드를 그리고, 우리 표로 다시 짓지 않는다", () => {
    assert.equal(stockRequestLineOwnerTag(parsedLine({ owner: { code: "SERVICE_SPARE", label: "보수부재" } }))?.value, "보수부재");
    assert.equal(stockRequestLineOwnerTag(parsedLine({ owner: { code: "SERVICE_SPARE" } }))?.value, "SERVICE_SPARE");
    assert.equal(stockRequestLineChargeTag(parsedLine({ chargeType: { code: "FREE" } }))?.value, "FREE");
  });
});

/**
 * ============================================================================
 * 🔴 반출 신청 줄의 **꾸밈** — 상태 배지 · 수량 · 부품 덩이 (2026-10-21 요청 셋)
 * ============================================================================
 * 「눈에 띄는가」는 시험으로 못 잰다. 대신 **고를 수 있는 값**으로 잰다 —
 *  ㉠ 상태 글자를 **손으로 적지 않는가**(꾸밈만 고른다)
 *  ㉡ **색 말고도** 갈리는가(바탕이 차 있나 · 굵기 · 선의 모양)
 *  ㉢ **다크 짝**이 전부 붙어 있는가(전수)
 *  ㉣ **재고 관리와 색조가 같은가**
 *
 * 🔵 색조 표를 **여기 적어 두는** 까닭: 저쪽은 **다른 저장소**라 끌어올 수 없다. 끌어올 수
 *    없는 약속은 적어 두는 것이 유일한 기록이고, 누가 색을 바꾸는 날 이 시험이 먼저 울어
 *    「저쪽도 같이 봐야 한다」고 말해 준다(두 시스템이 같은 말을 하는지 재는 자리).
 * ============================================================================
 */
describe("🔴 반출 신청 줄의 꾸밈 — 상태 배지", () => {
  /**
   * 재고 관리가 쓰는 색조 — `dss-inventory/src/lib/stock/codes.ts` 의 `REQUEST_STATUS_BADGE`
   * 와 `CLOSED_REQUEST_BADGE`(2026-10-21 판)에서 **색 이름만** 옮겨 적었다.
   * 🔴 값(`bg-amber-100`)이 아니라 **색조**를 적는 까닭: 저쪽은 다크 모드가 없어 글자값이
   *    같을 수 없다. 맞춰야 하는 것은 「주황인가」이지 「bg-amber-100 인가」가 아니다.
   */
  const INVENTORY_HUE: Record<string, string> = {
    PENDING: "amber",
    IN_APPROVAL: "indigo",
    CONFIRMING: "zinc",
    PARTIAL: "blue",
    CONFIRMED: "green",
    REJECTED: "red",
    CANCELLED: "zinc",
    ON_HOLD: "violet",
  };

  /** 꾸밈 한 줄에서 **색조**만 뽑는다 — `bg-amber-100 dark:text-amber-200` → `amber`. */
  function hueOf(className: string): string {
    const hues = new Set(
      [...className.matchAll(/(?:^|\s)(?:dark:)?(?:border|bg|text)-([a-z]+)-\d/g)].map((m) => m[1])
    );
    return [...hues].join(",");
  }

  function request(code: string, closed = false) {
    // 🔵 글자는 아무것이나 좋다 — 배지는 **글자를 보지 않는다**(그것이 이 조각의 약속이다).
    return { status: { code, label: "아무 글자" }, closed };
  }

  test("㉣ 🔴 **재고 관리와 색조가 같다** — 같은 신청을 두 화면이 다른 색으로 그리지 않는다", () => {
    for (const [code, className] of Object.entries(STOCK_REQUEST_STATUS_BADGE_CLASS)) {
      assert.equal(hueOf(className), INVENTORY_HUE[code], `${code} 의 색조가 재고 관리와 다르다`);
    }
    // 🔴 표에 구멍이 없는가 — 저쪽 상태 여덟이 전부 덮여 있어야 한다.
    assert.deepEqual(Object.keys(STOCK_REQUEST_STATUS_BADGE_CLASS).sort(), Object.keys(INVENTORY_HUE).sort());
  });

  test("㉡ 🔴 **끝난 신청은 바탕이 비고 보통 굵기다** — 색을 지워도 남는 가름(전수)", () => {
    for (const [code, className] of Object.entries(STOCK_REQUEST_STATUS_BADGE_CLASS)) {
      // 🔴 가르는 자를 **여기서 다시 적지 않는다** — 이미 있는 한 곳에 묻는다.
      const settled = isInventoryRequestSettled({ status: { code, label: "" } });
      assert.equal(/(?<!dark:)\bbg-/.test(className), !settled, `${code} 의 바탕이 「끝났나」와 어긋난다`);
      assert.equal(/\bfont-semibold\b/.test(className), !settled, `${code} 의 굵기가 「끝났나」와 어긋난다`);
    }
  });

  test("🔴 **마감은 `closed` 로 가른다** — 코드는 CONFIRMED 인데 확인됨의 초록이면 안 된다", () => {
    const closed = stockRequestStatusBadge(request("CONFIRMED", true));
    const confirmed = stockRequestStatusBadge(request("CONFIRMED"));
    assert.notEqual(closed, confirmed, "마감이 확인됨과 같은 색으로 뜬다 — 저쪽은 글자까지 「마감」으로 바꿔 보낸다");
    assert.equal(hueOf(closed), "amber", "저쪽 마감 배지(주황)와 색조가 다르다");
    assert.equal(hueOf(confirmed), "green");
  });

  test("㉡ 🔴 「마감」과 「대기」는 **같은 주황 안에서도** 갈린다 — 한쪽만 칠해져 있다", () => {
    // 🔴 색조가 같으니 색만으로는 못 가른다. 바탕이 차 있나가 그 가름이다(마감은 끝난 신청).
    assert.match(STOCK_REQUEST_STATUS_BADGE_CLASS.PENDING, /(?<!dark:)\bbg-amber-/, "대기가 칠해져 있지 않다");
    assert.doesNotMatch(STOCK_REQUEST_STATUS_BADGE_CLOSED, /(?<!dark:)\bbg-/, "마감이 대기처럼 칠해져 있다");
  });

  test("㉠ 🔴 **글자를 짓지 않는다** — 돌려주는 것은 꾸밈뿐이다", () => {
    const badge = stockRequestStatusBadge(request("CONFIRMED", true));
    // 🔴 여기서 「마감」을 보태면 화면이 「마감 (마감)」을 그린다(2026-10-21 에 실제로 그랬다).
    assert.doesNotMatch(badge, /[가-힣]/, "배지 꾸밈에 사람이 읽는 글자가 섞여 있다");
    // 🔵 글자를 안 보는지도 값으로 확인한다 — 같은 코드·같은 closed 면 글자가 달라도 같은 꾸밈이다.
    assert.equal(
      stockRequestStatusBadge({ status: { code: "PENDING", label: "대기" }, closed: false }),
      stockRequestStatusBadge({ status: { code: "PENDING", label: "딴 말" }, closed: false })
    );
  });

  test("🔴 모르는 상태 코드는 **아무 색으로도 안 칠하고** 점선으로 세운다", () => {
    const badge = stockRequestStatusBadge(request("BRAND_NEW"));
    assert.match(badge, /\bborder-dashed\b/, "모르는 값인지 알 길이 없다");
    for (const [code, known] of Object.entries(STOCK_REQUEST_STATUS_BADGE_CLASS)) {
      assert.ok(!badge.includes(known), `모르는 값이 ${code} 의 색으로 칠해진다`);
    }
    assert.ok(!badge.includes(STOCK_REQUEST_STATUS_BADGE_CLOSED), "모르는 값이 마감 색으로 칠해진다");
  });

  test("🔵 뼈대는 **한 곳**에서 온다 — 어느 상태든 같은 치수의 배지다", () => {
    for (const r of [request("PENDING"), request("CONFIRMED", true), request("BRAND_NEW")]) {
      assert.ok(
        stockRequestStatusBadge(r).startsWith(`${STOCK_REQUEST_STATUS_BADGE_SHAPE} `),
        `${r.status.code} 의 배지에 뼈대가 안 붙었다`
      );
    }
  });

  test("㉢ 🔴 **다크 짝이 전부 붙어 있다** — 밝은 쪽만 적으면 어두운 화면에서 글자가 잠긴다", () => {
    const classes = [
      ...Object.values(STOCK_REQUEST_STATUS_BADGE_CLASS),
      STOCK_REQUEST_STATUS_BADGE_CLOSED,
      STOCK_REQUEST_STATUS_BADGE_UNKNOWN,
      STOCK_REQUEST_QUANTITY_VALUE_CLASS,
      STOCK_REQUEST_QUANTITY_LABEL_CLASS,
      STOCK_REQUEST_LINE_BLOCK_CLASS,
    ];
    for (const className of classes) {
      for (const kind of ["border", "bg", "text"] as const) {
        const light = new RegExp(`(?<!dark:)\\b${kind}-(?:[a-z]+-\\d|white\\b)`).test(className);
        const dark = new RegExp(`dark:${kind}-(?:[a-z]+-\\d|white\\b)`).test(className);
        assert.equal(light, dark, `${kind} 의 다크 짝이 빠졌다: ${className}`);
      }
    }
  });
});

describe("🔴 반출 신청 줄의 꾸밈 — 수량과 부품 덩이", () => {
  test("㉡ 🔴 **숫자만 굵다** — 색을 전부 지워도 이름표와 갈린다", () => {
    assert.match(STOCK_REQUEST_QUANTITY_VALUE_CLASS, /\bfont-semibold\b/, "숫자가 이름표와 같은 굵기다");
    assert.doesNotMatch(
      STOCK_REQUEST_QUANTITY_LABEL_CLASS,
      /\bfont-(?:medium|semibold|bold)\b/,
      "이름표가 숫자만큼 굵다 — 숫자가 다시 묻힌다"
    );
  });

  test("🔵 자릿수가 달라도 줄이 흔들리지 않는다 — 대여섯 줄을 훑어 내리는 자리다", () => {
    assert.match(STOCK_REQUEST_QUANTITY_VALUE_CLASS, /\btabular-nums\b/);
  });

  test("🔵 숫자 색은 **이 칸이 이미 쓰는 그 파랑**이다 — 같은 화면에서 파랑의 뜻이 둘이 되지 않게", () => {
    // 🔵 찾은 줄의 도번·재고 수에 쓰는 값과 같다(`PartRequestSection.tsx` 의 VALUE_HIGHLIGHT).
    assert.match(STOCK_REQUEST_QUANTITY_VALUE_CLASS, /\btext-blue-700\b/);
    assert.match(STOCK_REQUEST_QUANTITY_VALUE_CLASS, /\bdark:text-blue-400\b/);
  });

  test("㉡ 🔴 부품 덩이는 **세로 선 하나**로 묶는다 — 네 변 상자가 아니다(좁은 칸)", () => {
    assert.match(STOCK_REQUEST_LINE_BLOCK_CLASS, /\bborder-l-\d\b/, "덩이를 묶는 선이 없다");
    assert.ok(
      !/(?:^|\s)border(?:\s|$)/.test(STOCK_REQUEST_LINE_BLOCK_CLASS),
      "네 변을 다 두른다 — 대여섯 줄이 붙는 좁은 칸이 답답해진다"
    );
    assert.doesNotMatch(STOCK_REQUEST_LINE_BLOCK_CLASS, /\brounded/, "덩이가 상자가 된다");
    // 🔵 선에 글이 붙으면 선이 글자의 일부처럼 읽힌다.
    assert.match(STOCK_REQUEST_LINE_BLOCK_CLASS, /\bpl-\d/, "선과 글 사이가 붙어 있다");
  });

  test("🔵 구분선에는 **뜻을 나르는 색을 안 쓴다** — 뜻 있는 색은 이 줄에 이미 셋이다", () => {
    // 상태 배지 · 유상/무상 딱지 · 수량. 구분선까지 칠하면 어느 색이 뜻인지 알 수 없다.
    assert.match(STOCK_REQUEST_LINE_BLOCK_CLASS, /\bborder-zinc-\d/, "구분선이 중립색이 아니다");
  });
});
