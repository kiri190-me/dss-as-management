import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  PORTAL_APPROVAL_KIND_LABELS,
  buildDomesticOrderApprovalItem,
  buildPortalApprovalInbox,
  buildQuoteApprovalItem,
  buildRepairCaseApprovalItem,
  sortPortalApprovalItems,
  type PendingDomesticOrderApprovalRow,
  type PendingQuoteApprovalRow,
  type PendingRepairCaseApprovalRow,
  type PortalApprovalItem,
  type PortalApprovalKind,
} from "./portal-approvals";
import { DOMESTIC_ORDER_NO_MODEL_LINK_LABEL } from "@/lib/domain/domestic-order-detail-link";
import type { PortalActor } from "./portal-notifications";

/**
 * ============================================================================
 * 통합 승인함에 내줄 목록 — DB 없이 그대로 돌려 본다
 * ============================================================================
 * 여기서 지키는 것:
 *  · 🔴 대상 사람은 **토큰이 실어 온 sub** 하나로만 정해진다. 부르는 쪽이 남의
 *    번호를 끼워 넣을 자리가 없다.
 *  · 🔴 「결재할 차례인가」를 이 파일이 판정하지 않는다 — **조회가 준 줄만**
 *    나온다. 조회가 안 준 건은 한 줄도 만들어지지 않는다.
 *  · 갈래 셋 · 절대 주소 · ISO 8601 · 열쇠의 유일성.
 *
 * 🔴 값은 전부 가짜다 — 실제 고객사 · 사람 이름 · L/N · S/N 을 적지 않는다.
 * ============================================================================
 */

const BASE = "http://192.168.0.13:3000";
const SUBJECT = "portal-user-0001";
/** 되짚어 낸 A/S 계정의 id. 🔴 토큰의 sub 와 **다른 값**이어야 시험이 뜻을 갖는다. */
const LOCAL_ID = "33333333-3333-4333-8333-333333333333";
const CASE_ID = "44444444-4444-4444-8444-444444444444";
const OTHER_CASE_ID = "55555555-5555-4555-8555-555555555555";
const QUOTE_ID = "66666666-6666-4666-8666-666666666666";
/** 기타건 = 내자 정리의 한 줄(`domestic_orders.id`). 🔴 접수 건 id 와 **다른 표**다. */
const ORDER_ID = "77777777-7777-4777-8777-777777777777";

function actor(overrides: Partial<PortalActor> = {}): PortalActor {
  return {
    id: LOCAL_ID,
    role: "ADMIN",
    isDeveloper: false,
    approvalStatus: "APPROVED",
    isActive: true,
    lockedAt: null,
    ...overrides,
  };
}

function repairCaseRow(
  overrides: Partial<PendingRepairCaseApprovalRow> = {}
): PendingRepairCaseApprovalRow {
  return {
    repairCaseId: CASE_ID,
    intakeNumber: "DSS-2026-0007",
    approvalType: "REPAIR_INSPECTION",
    requestedAt: "2026-10-20T01:00:00.000Z",
    ...overrides,
  };
}

function quoteRow(overrides: Partial<PendingQuoteApprovalRow> = {}): PendingQuoteApprovalRow {
  return {
    quoteId: QUOTE_ID,
    quoteNumber: "Q-2026-0001",
    routeStepOrder: 1,
    requestedByName: "김결재",
    requestedAt: "2026-10-21T02:00:00.000Z",
    ...overrides,
  };
}

function domesticOrderRow(
  overrides: Partial<PendingDomesticOrderApprovalRow> = {}
): PendingDomesticOrderApprovalRow {
  return {
    domesticOrderId: ORDER_ID,
    modelName: "시험용 품명",
    routeStepOrder: 1,
    requestedByName: "김결재",
    requestedAt: "2026-11-06T03:00:00.000Z",
    // 🔴 2026-11-08 — 승인 단위가 회차로 내려왔다. 기본 표본은 회차 하나짜리 기타건
    //    이라 이름표가 null 이고, 그때 승인함 줄은 2026-11-07 과 같아야 한다.
    dueDateRowOrder: 1,
    dueDateRowLabel: null,
    ...overrides,
  };
}

/** 조회 셋을 가짜로 끼우고 한 번 부른다. 어느 id 로 물었는지도 함께 돌려준다. */
async function inboxOf(options: {
  actorValue?: PortalActor | null;
  repairCases?: PendingRepairCaseApprovalRow[];
  quotes?: PendingQuoteApprovalRow[];
  domesticOrders?: PendingDomesticOrderApprovalRow[];
  baseUrl?: string;
}) {
  const askedForActor: string[] = [];
  const askedRepairCases: string[] = [];
  const askedQuotes: string[] = [];
  const askedDomesticOrders: string[] = [];
  const inbox = await buildPortalApprovalInbox({
    subject: SUBJECT,
    baseUrl: options.baseUrl ?? BASE,
    findActor: async (subject) => {
      askedForActor.push(subject);
      return options.actorValue === undefined ? actor() : options.actorValue;
    },
    listRepairCaseApprovals: async (userId) => {
      askedRepairCases.push(userId);
      return options.repairCases ?? [];
    },
    listQuoteApprovals: async (userId) => {
      askedQuotes.push(userId);
      return options.quotes ?? [];
    },
    listDomesticOrderApprovals: async (userId) => {
      askedDomesticOrders.push(userId);
      return options.domesticOrders ?? [];
    },
  });
  return { inbox, askedForActor, askedRepairCases, askedQuotes, askedDomesticOrders };
}

describe("승인함 갈래 이름표", () => {
  test("갈래 넷이 모두 이름표를 갖고, 서로 다른 말이다", () => {
    const kinds: PortalApprovalKind[] = [
      "REPAIR_INSPECTION",
      "FINAL_SHIPMENT",
      "QUOTE_APPROVAL",
      // 🔴 2026-11-06. 글자가 **포털의 메일 갈래 표와 한 글자씩 같아야** 한다
      //    (dss-auth 의 lib/approvals/kinds.ts — 저장소가 둘이라 tsc 가 못 잡는다).
      "DOMESTIC_ORDER_FINAL_SHIPMENT",
    ];
    assert.deepEqual(Object.keys(PORTAL_APPROVAL_KIND_LABELS).sort(), [...kinds].sort());
    for (const kind of kinds) {
      assert.ok(
        PORTAL_APPROVAL_KIND_LABELS[kind].trim().length > 0,
        `${kind}: 이름표가 비어 있다 — 포털 화면에 코드 값이 그대로 찍힌다`
      );
    }
    assert.equal(new Set(Object.values(PORTAL_APPROVAL_KIND_LABELS)).size, kinds.length);
  });
});

describe("승인함 한 줄 만들기", () => {
  test("접수 건 결재 — 갈래 · 이름표 · 제목 · 때 · **절대 주소**가 짝이 맞는다", () => {
    const item = buildRepairCaseApprovalItem(repairCaseRow(), BASE);
    assert.equal(item.kind, "REPAIR_INSPECTION");
    assert.equal(item.kindLabel, "접수건 검수 결재");
    assert.equal(item.subject, "DSS-2026-0007");
    assert.equal(item.requestedAt, "2026-10-20T01:00:00.000Z");
    assert.equal(item.href, `${BASE}/repair-cases/${CASE_ID}/approval`);
    // 조회가 더 들고 오는 값이 없어서 비어 있다 — 비는 것이 의도다.
    assert.equal(item.detail, "");
  });

  test("최종 출하 결재도 **같은 결재 화면**으로 간다 — 두 갈래가 한 화면이다", () => {
    const inspection = buildRepairCaseApprovalItem(repairCaseRow(), BASE);
    const shipment = buildRepairCaseApprovalItem(
      repairCaseRow({ approvalType: "FINAL_SHIPMENT" }),
      BASE
    );
    assert.equal(shipment.kind, "FINAL_SHIPMENT");
    assert.equal(shipment.kindLabel, "접수건 최종 출하 결재");
    assert.equal(shipment.href, inspection.href);
    // 🔴 주소가 같아도 열쇠는 달라야 한다 — 같으면 통합함이 두 결재를 한 줄로 접는다.
    assert.notEqual(shipment.id, inspection.id);
  });

  test("견적서 결재 — 갈래 · 이름표 · 발행번호 · 보탬 · **절대 주소**", () => {
    const item = buildQuoteApprovalItem(quoteRow(), BASE);
    assert.equal(item.kind, "QUOTE_APPROVAL");
    assert.equal(item.kindLabel, "견적서 결재");
    assert.equal(item.subject, "Q-2026-0001");
    assert.equal(item.detail, "결재선 1단계 · 요청자 김결재");
    // 🔴 2026-10-31 — 종 알림과 **같은 주소**다(그 헬퍼를 그대로 쓴다). 누르면 그
    //    견적서의 [견적서 결재] 탭이 열린다: 통합함에서 넘어온 사람이 할 일이 바로
    //    그 탭에 있다(domain/notifications.ts 의 buildQuoteApprovalNotification).
    assert.equal(item.href, `${BASE}/quotes/${QUOTE_ID}?tab=approval`);
  });

  test("결재선을 타지 않는 견적서 행은 단계 없이 요청자만 적는다", () => {
    const item = buildQuoteApprovalItem(quoteRow({ routeStepOrder: null }), BASE);
    assert.equal(item.detail, "요청자 김결재");
  });

  test("🔴 기타건 결재 — 갈래 · 이름표 · 품명 · 보탬 · **`/domestic-orders/` 로 가는 절대 주소**", () => {
    const item = buildDomesticOrderApprovalItem(domesticOrderRow(), BASE);
    assert.equal(item.kind, "DOMESTIC_ORDER_FINAL_SHIPMENT");
    assert.equal(item.kindLabel, "기타건 최종 출하 결재");
    assert.equal(item.subject, "시험용 품명");
    assert.equal(item.detail, "결재선 1단계 · 요청자 김결재");
    // 🔴 **이 줄이 이 조각에서 가장 비싼 울타리다.** 기타건 결재 행은 접수 건과 같은
    //    표에 있어 `repairCaseDetailHrefs` 를 베끼기 쉬운데, 그러면
    //    `/repair-cases/{내자줄 uuid}/approval` 로 나가 포털 화면에서만 404 가 난다.
    assert.equal(item.href, `${BASE}/domestic-orders/${ORDER_ID}/approval`);
    assert.ok(!item.href.includes("/repair-cases/"), "접수 건 주소로 나갔다");
  });

  test("🔴 품명이 비어도 제목이 비지 않는다 — 비면 승인함이 그 줄을 통째로 뺀다", () => {
    // 🔵 먼저 표본이 뜻을 갖는지 — **적혀 있으면 그 글자**가 나온다(아래 단언이
    //    「언제나 (형식 없음)」으로 공짜 통과하지 않게).
    assert.equal(buildDomesticOrderApprovalItem(domesticOrderRow(), BASE).subject, "시험용 품명");

    for (const empty of [null, "", "   "]) {
      const item = buildDomesticOrderApprovalItem(domesticOrderRow({ modelName: empty }), BASE);
      assert.equal(item.subject, DOMESTIC_ORDER_NO_MODEL_LINK_LABEL, `${JSON.stringify(empty)}`);
      assert.ok(item.subject.trim().length > 0);
      // 나머지 칸도 그대로 선다 — 승인함은 detail 말고 하나라도 비면 줄을 뺀다.
      assert.ok(item.kindLabel.length > 0);
      assert.ok(item.href.length > 0);
      assert.ok(item.requestedAt.length > 0);
      assert.ok(item.id.length > 0);
    }
  });

  test("결재선을 타지 않는 기타건 행은 단계 없이 요청자만 적는다", () => {
    const item = buildDomesticOrderApprovalItem(domesticOrderRow({ routeStepOrder: null }), BASE);
    assert.equal(item.detail, "요청자 김결재");
  });

  test("🔴 기준 주소가 비면 던진다 — 상대 주소를 조용히 내보내지 않는다", () => {
    assert.throws(() => buildRepairCaseApprovalItem(repairCaseRow(), ""));
    assert.throws(() => buildQuoteApprovalItem(quoteRow(), ""));
    assert.throws(() => buildDomesticOrderApprovalItem(domesticOrderRow(), ""));
  });
});

describe("buildPortalApprovalInbox — 대상 사람", () => {
  test("🔴 되짚는 열쇠는 토큰의 sub 다 — 다른 값이 끼어들 자리가 없다", async () => {
    const { askedForActor } = await inboxOf({ repairCases: [repairCaseRow()] });
    assert.deepEqual(askedForActor, [SUBJECT]);
  });

  test("🔴 조회 셋은 **되짚은 A/S 계정의 id** 로만 부른다 — sub 로도, 다른 값으로도 묻지 않는다", async () => {
    const { askedRepairCases, askedQuotes, askedDomesticOrders } = await inboxOf({
      repairCases: [repairCaseRow()],
      quotes: [quoteRow()],
      domesticOrders: [domesticOrderRow()],
    });
    assert.deepEqual(askedRepairCases, [LOCAL_ID]);
    assert.deepEqual(askedQuotes, [LOCAL_ID]);
    assert.deepEqual(askedDomesticOrders, [LOCAL_ID]);
    // sub 가 그대로 조회에 흘러들면 **남의 결재함**을 열 수 있다.
    assert.ok(!askedRepairCases.includes(SUBJECT));
    assert.ok(!askedQuotes.includes(SUBJECT));
    assert.ok(!askedDomesticOrders.includes(SUBJECT));
  });

  test("🔴 A/S 계정이 없는 사람은 빈 목록이다 — 오류가 아니고, 조회를 부르지도 않는다", async () => {
    const { inbox, askedRepairCases, askedQuotes, askedDomesticOrders } = await inboxOf({
      actorValue: null,
      repairCases: [repairCaseRow()],
      quotes: [quoteRow()],
      domesticOrders: [domesticOrderRow()],
    });
    assert.deepEqual(inbox, { items: [], count: 0 });
    assert.deepEqual(askedRepairCases, []);
    assert.deepEqual(askedQuotes, []);
    assert.deepEqual(askedDomesticOrders, []);
  });

  test("🔴 승인 대기 · 비활성 · 잠긴 계정도 빈 목록이다 — 조회를 부르지 않는다", async () => {
    for (const stopped of [
      actor({ approvalStatus: "PENDING" }),
      actor({ isActive: false }),
      actor({ lockedAt: new Date("2026-10-01T00:00:00.000Z") }),
    ]) {
      const { inbox, askedRepairCases, askedQuotes, askedDomesticOrders } = await inboxOf({
        actorValue: stopped,
        repairCases: [repairCaseRow()],
        quotes: [quoteRow()],
        domesticOrders: [domesticOrderRow()],
      });
      assert.deepEqual(inbox, { items: [], count: 0 });
      assert.deepEqual(askedRepairCases, []);
      assert.deepEqual(askedQuotes, []);
      assert.deepEqual(askedDomesticOrders, []);
    }
  });
});

describe("buildPortalApprovalInbox — 목록", () => {
  test("갈래 넷이 전부 나오고, 갈래마다 주소가 그 건의 결재 화면이다", async () => {
    const { inbox } = await inboxOf({
      repairCases: [
        repairCaseRow({ approvalType: "REPAIR_INSPECTION" }),
        repairCaseRow({
          repairCaseId: OTHER_CASE_ID,
          intakeNumber: "DSS-2026-0008",
          approvalType: "FINAL_SHIPMENT",
          requestedAt: "2026-10-19T00:00:00.000Z",
        }),
      ],
      quotes: [quoteRow()],
      domesticOrders: [domesticOrderRow()],
    });
    // 🔵 먼저 「무엇을 재는지」를 못 박는다 — 표본이 비면 아래 단언이 공짜로 통과한다.
    assert.equal(inbox.items.length, 4);
    const byKind = new Map(inbox.items.map((item) => [item.kind, item]));
    assert.deepEqual(
      [...byKind.keys()].sort(),
      ["DOMESTIC_ORDER_FINAL_SHIPMENT", "FINAL_SHIPMENT", "QUOTE_APPROVAL", "REPAIR_INSPECTION"]
    );
    assert.equal(
      byKind.get("REPAIR_INSPECTION")?.href,
      `${BASE}/repair-cases/${CASE_ID}/approval`
    );
    assert.equal(
      byKind.get("FINAL_SHIPMENT")?.href,
      `${BASE}/repair-cases/${OTHER_CASE_ID}/approval`
    );
    // 🔴 견적서만 탭 이름이 붙는다(2026-10-31) — 접수 건 둘은 주소 자체가 결재 화면이다.
    assert.equal(byKind.get("QUOTE_APPROVAL")?.href, `${BASE}/quotes/${QUOTE_ID}?tab=approval`);
    // 🔴 기타건은 **다른 표의 상세**로 간다(2026-11-06).
    assert.equal(
      byKind.get("DOMESTIC_ORDER_FINAL_SHIPMENT")?.href,
      `${BASE}/domestic-orders/${ORDER_ID}/approval`
    );
    for (const item of inbox.items) {
      assert.equal(item.kindLabel, PORTAL_APPROVAL_KIND_LABELS[item.kind]);
    }
  });

  test("🔴 기타건을 더해도 접수 건·견적서 줄이 한 글자도 안 바뀐다", async () => {
    // 🔵 「안 섞인다」를 말하려면 **섞일 뻔한 줄이 실제로 있어야** 한다 — 기타건 줄을
    //    넣은 쪽과 안 넣은 쪽을 맞댄다.
    const 재료 = {
      repairCases: [
        repairCaseRow({ approvalType: "REPAIR_INSPECTION" }),
        repairCaseRow({ approvalType: "FINAL_SHIPMENT", requestedAt: "2026-10-20T02:00:00.000Z" }),
      ],
      quotes: [quoteRow()],
    };
    const 없을때 = await inboxOf(재료);
    const 있을때 = await inboxOf({ ...재료, domesticOrders: [domesticOrderRow()] });

    assert.equal(없을때.inbox.items.length, 3, "표본이 비었다 — 이 시험이 아무것도 안 본다");
    assert.equal(있을때.inbox.items.length, 4, "기타건 줄이 안 섰다");

    const 기타건빼고 = 있을때.inbox.items.filter(
      (item) => item.kind !== "DOMESTIC_ORDER_FINAL_SHIPMENT"
    );
    assert.deepEqual(기타건빼고, 없을때.inbox.items);
    assert.equal(없을때.inbox.count, 3);
    assert.equal(있을때.inbox.count, 4);
  });

  test("🔴 모든 주소가 절대 주소다 — 하나라도 상대 주소면 통합함에서 깨진다", async () => {
    const { inbox } = await inboxOf({
      repairCases: [repairCaseRow(), repairCaseRow({ approvalType: "FINAL_SHIPMENT" })],
      quotes: [quoteRow()],
      domesticOrders: [domesticOrderRow()],
    });
    assert.equal(inbox.items.length, 4);
    for (const item of inbox.items) {
      assert.ok(item.href.startsWith(`${BASE}/`), `상대 주소가 섞였다: ${item.href}`);
    }
  });

  test("🔴 requestedAt 이 ISO 8601 이다 — 글자를 그대로 되읽어도 같은 시각이다", async () => {
    const { inbox } = await inboxOf({
      repairCases: [repairCaseRow()],
      quotes: [quoteRow()],
      domesticOrders: [domesticOrderRow()],
    });
    assert.equal(inbox.items.length, 3);
    for (const item of inbox.items) {
      assert.match(item.requestedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      assert.equal(new Date(item.requestedAt).toISOString(), item.requestedAt);
    }
  });

  test("🔴 조회가 주지 않은 건은 한 줄도 만들지 않는다 — 자격 판정이 여기 없다는 뜻", async () => {
    // 「결재할 차례가 아닌 사람」에게 세 조회는 빈 배열을 돌려준다(그 판정이 조회
    // 안에 있다). 그때 이 함수가 무엇을 지어내지 않는지를 본다.
    const { inbox } = await inboxOf({ repairCases: [], quotes: [], domesticOrders: [] });
    assert.deepEqual(inbox, { items: [], count: 0 });
  });

  test("count 는 줄 수다 — 한 접수 건에 결재가 둘이면 2 다(종의 셈과 다르다)", async () => {
    const { inbox } = await inboxOf({
      repairCases: [
        repairCaseRow({ approvalType: "REPAIR_INSPECTION" }),
        repairCaseRow({ approvalType: "FINAL_SHIPMENT", requestedAt: "2026-10-20T03:00:00.000Z" }),
      ],
    });
    assert.equal(inbox.count, 2);
    assert.equal(inbox.count, inbox.items.length);
    // 같은 접수 건이지만 결재는 둘 — 열쇠가 갈라져 있어야 통합함이 두 줄로 센다.
    assert.equal(new Set(inbox.items.map((item) => item.id)).size, 2);
  });

  test("🔴 견적서 결재는 한 장에 한 줄이고, 다시 물어도 **같은 열쇠**다", async () => {
    // A/S 와 PO 가 같은 표(quote_approvals)를 본다. 통합 승인함이 같은 건을 두 번
    // 세지 않으려면 (1) 내주는 통로가 A/S 하나뿐이고 (2) 열쇠가 견적서 하나에
    // 하나여야 한다. 여기서 재는 것은 (2)다.
    const first = await inboxOf({ quotes: [quoteRow()] });
    const second = await inboxOf({
      // 같은 장이지만 결재선이 다음 단계로 넘어가 요청 행이 새로 열린 모습.
      quotes: [quoteRow({ routeStepOrder: 2, requestedAt: "2026-10-22T05:00:00.000Z" })],
    });
    assert.equal(first.inbox.items.length, 1);
    assert.equal(second.inbox.items.length, 1);
    assert.equal(first.inbox.items[0].id, second.inbox.items[0].id);
    assert.equal(first.inbox.items[0].href, second.inbox.items[0].href);
    // 단계가 바뀐 것은 보탬에만 드러난다.
    assert.equal(second.inbox.items[0].detail, "결재선 2단계 · 요청자 김결재");
  });

  test("🔴 갈래가 섞여도 열쇠가 겹치지 않는다", async () => {
    const { inbox } = await inboxOf({
      repairCases: [
        repairCaseRow({ approvalType: "REPAIR_INSPECTION" }),
        repairCaseRow({ approvalType: "FINAL_SHIPMENT" }),
        repairCaseRow({ repairCaseId: OTHER_CASE_ID, approvalType: "REPAIR_INSPECTION" }),
      ],
      quotes: [quoteRow()],
      domesticOrders: [domesticOrderRow()],
    });
    assert.equal(inbox.items.length, 5);
    assert.equal(new Set(inbox.items.map((item) => item.id)).size, 5);
  });

  test("🔴 기타건 결재는 한 줄에 한 줄이고, 다시 물어도 **같은 열쇠**다", async () => {
    // 견적서와 같은 까닭이다 — 표의 부분 유니크
    // (repair_case_approvals_one_active_domestic_request)가 열린 요청을 하나로 못
    // 박으므로, 결재선이 다음 단계로 넘어가 행이 새로 열려도 열쇠는 그대로여야 한다.
    const first = await inboxOf({ domesticOrders: [domesticOrderRow()] });
    const second = await inboxOf({
      domesticOrders: [
        domesticOrderRow({ routeStepOrder: 2, requestedAt: "2026-11-06T05:00:00.000Z" }),
      ],
    });
    assert.equal(first.inbox.items.length, 1);
    assert.equal(second.inbox.items.length, 1);
    assert.equal(first.inbox.items[0].id, second.inbox.items[0].id);
    assert.equal(first.inbox.items[0].href, second.inbox.items[0].href);
    // 단계가 바뀐 것은 보탬에만 드러난다.
    assert.equal(second.inbox.items[0].detail, "결재선 2단계 · 요청자 김결재");
  });

  test("오래 기다린 순으로 선다 — 같은 시각이면 열쇠로 동점을 깬다", async () => {
    const { inbox } = await inboxOf({
      repairCases: [
        repairCaseRow({ approvalType: "FINAL_SHIPMENT", requestedAt: "2026-10-20T00:00:00.000Z" }),
        repairCaseRow({
          approvalType: "REPAIR_INSPECTION",
          requestedAt: "2026-10-20T00:00:00.000Z",
        }),
      ],
      quotes: [quoteRow({ requestedAt: "2026-10-18T00:00:00.000Z" })],
    });
    assert.deepEqual(
      inbox.items.map((item) => item.kind),
      ["QUOTE_APPROVAL", "FINAL_SHIPMENT", "REPAIR_INSPECTION"]
    );
    // 동점 두 줄의 차례가 열쇠 사전순인지 — 실행마다 흔들리지 않게 하는 장치다.
    const tied = inbox.items.slice(1);
    assert.deepEqual([...tied.map((item) => item.id)].sort(), tied.map((item) => item.id));
  });
});

describe("sortPortalApprovalItems", () => {
  test("빈 목록과 한 줄짜리도 그대로 돌아온다", () => {
    assert.deepEqual(sortPortalApprovalItems([]), []);
    const one: PortalApprovalItem[] = [buildQuoteApprovalItem(quoteRow(), BASE)];
    assert.deepEqual(sortPortalApprovalItems([...one]), one);
  });
});
