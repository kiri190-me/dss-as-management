import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DELIVERED_DATE_FROM_REPAIR_CASE_LABEL,
  DOMESTIC_ORDER_DELIVERED_DATE_NOTE,
  DOMESTIC_ORDER_DELIVERED_NOT_LINKED_MESSAGE,
  REPAIR_CASE_SHIPMENT_BLOCKED_BY_RECEIVED_AT_MESSAGE,
  REPAIR_CASE_SHIPMENT_NOT_LINKED_MESSAGE,
  REPAIR_CASE_SHIPMENT_NOT_SHIPPED_MESSAGE,
  resolveDeliveredLinkShape,
  resolveDomesticOrderDeliveredWriteThrough,
  resolveDomesticOrderDeliveryDisplay,
  resolveRepairCaseShipmentWriteThrough,
} from "./delivered-date-link";

/**
 * ============================================================================
 * 내자 `납품일` ↔ 수리 건 `실제 출하일` — 그리기와 묶기 (2026-11-08)
 * ============================================================================
 * 이 시험이 지키는 것:
 *
 *  1. **그리기** — 행에 적힌 것이 먼저, 아무 행에도 없을 때만 빌린다. 두 목록의
 *     **줄 수가 늘 같다**(표가 세로로 밀리지 않는 유일한 근거다).
 *  2. **묶기 다섯 자리** — 안 바뀐 저장 · 지운 저장 · 행이 없는 줄 · 여럿 ·
 *     아직 출하 전. 넷은 조용히 멈추고, 셋은 **까닭을 말한다.**
 *  3. 🔴 **아직 출하 전인 건에는 날짜를 밀어 넣지 않는다** — 그 칸은 종 알림 넷의
 *     침묵 스위치다. 이 한 줄이 이 파일에서 가장 중요한 단언이다.
 *  4. 🔴 **자동으로 찍는 자리는 빈 행에만 쓴다**(trigger 갈림). 사람이 적어 둔
 *     납품일을 출하 완료 처리가 덮으면, 운송 시차라는 사실이 말없이 사라진다.
 * ============================================================================
 */

/** 시험용 연결된 수리 건 id. 값은 상관없고 null 이 아니라는 것만 뜻이 있다. */
const CASE_ID = "11111111-1111-4111-8111-111111111111";

// ── ① 그리기 ───────────────────────────────────────────────────────────────

test("행에 적힌 납품일이 먼저다 — 수리 건이 나갔어도 가리지 않는다", () => {
  const display = resolveDomesticOrderDeliveryDisplay({
    dueDates: [{ deliveredDate: "2026-02-01", deliveredBy: "담당자1" }],
    repairCaseId: CASE_ID,
    repairCaseActualShipmentDate: "2026-01-28",
  });
  assert.deepEqual(display.dates, ["2026-02-01"]);
  assert.deepEqual(display.people, ["담당자1"]);
  assert.equal(display.borrowed, false, "행에 적힌 값에 '빌려 옴' 표시가 붙었다");
});

test("🔴 두 목록의 줄 수는 **늘 같다** — 안 적은 회차도 자리를 차지한다", () => {
  // 거르면 납품일과 납품자의 줄 수가 달라져, 아래로 갈수록 엉뚱한 회차끼리
  // 나란히 선다(표의 세 칸이 자리로 짝을 맞춘다).
  const display = resolveDomesticOrderDeliveryDisplay({
    dueDates: [
      { deliveredDate: "2026-02-01", deliveredBy: "담당자1" },
      { deliveredDate: null, deliveredBy: null },
      { deliveredDate: "2026-03-01", deliveredBy: null },
    ],
    repairCaseId: null,
    repairCaseActualShipmentDate: null,
  });
  assert.deepEqual(display.dates, ["2026-02-01", null, "2026-03-01"]);
  assert.deepEqual(display.people, ["담당자1", null, null]);
  assert.equal(display.dates.length, display.people.length);
});

test("🔴 납품자만 적힌 행도 「적혀 있다」다 — 한 줄에 두 출처가 섞이면 안 된다", () => {
  // 날짜만 보고 가르면, 「누가 보냈는지는 아는데 언제인지 모른다」는 줄에서
  // 납품자는 제 값이고 날짜는 수리 건에서 빌려 온 값이 된다.
  const display = resolveDomesticOrderDeliveryDisplay({
    dueDates: [{ deliveredDate: null, deliveredBy: "담당자1" }],
    repairCaseId: CASE_ID,
    repairCaseActualShipmentDate: "2026-01-28",
  });
  assert.deepEqual(display.dates, [null], "빌려 온 날짜가 새어 들어왔다");
  assert.deepEqual(display.people, ["담당자1"]);
  assert.equal(display.borrowed, false);
});

test("아무 행에도 없으면 연결된 수리 건의 실제 출하일을 빌린다 — 한 줄에 꼬리표", () => {
  const display = resolveDomesticOrderDeliveryDisplay({
    dueDates: [
      { deliveredDate: null, deliveredBy: null },
      { deliveredDate: "   ", deliveredBy: "  " },
    ],
    repairCaseId: CASE_ID,
    repairCaseActualShipmentDate: "2026-01-28",
  });
  assert.deepEqual(display.dates, ["2026-01-28"]);
  // 🔵 수리 건에는 「누가 보냈는가」가 없다 — 자리만 맞춘다.
  assert.deepEqual(display.people, [null]);
  assert.equal(display.borrowed, true);
  // 꼬리표 글자는 「출하일」이다 — 「납품일」이 아니다(뜻이 다른 두 날짜다).
  assert.equal(DELIVERED_DATE_FROM_REPAIR_CASE_LABEL, "수리 건 출하일");
  assert.ok(
    DOMESTIC_ORDER_DELIVERED_DATE_NOTE.includes(DELIVERED_DATE_FROM_REPAIR_CASE_LABEL),
    "설명이 화면에 없는 표시를 가리키고 있다"
  );
});

test("🔴 빌릴지는 repairCaseId 로만 가른다 — 출하일이 비었느냐로 가르면 샌다", () => {
  // 출하일이 null 인 것은 「연결이 없다」와 「연결은 있는데 아직 안 나갔다」 둘 다다.
  const notShipped = resolveDomesticOrderDeliveryDisplay({
    dueDates: [{ deliveredDate: null, deliveredBy: null }],
    repairCaseId: CASE_ID,
    repairCaseActualShipmentDate: null,
  });
  assert.deepEqual(notShipped.dates, []);
  assert.equal(notShipped.borrowed, false);

  const noLink = resolveDomesticOrderDeliveryDisplay({
    dueDates: [],
    repairCaseId: null,
    repairCaseActualShipmentDate: "2026-01-28",
  });
  assert.deepEqual(noLink.dates, [], "연결이 없는데 남의 출하일을 빌려 왔다");
});

// ── ② 모양 판정 ────────────────────────────────────────────────────────────

test("가리킬 수 있는 모양은 「줄 하나 · 기록 하나」뿐이다", () => {
  assert.deepEqual(resolveDeliveredLinkShape([]), { kind: "NO_ROW" });
  assert.deepEqual(resolveDeliveredLinkShape([{ deliveredCount: 0 }]), { kind: "NO_ROW" });
  assert.deepEqual(resolveDeliveredLinkShape([{ deliveredCount: 1 }]), { kind: "SINGLE" });
  // 🔵 기록이 없는 다른 줄은 모호함을 만들지 않는다 — 그 줄은 고를 거리가 없다.
  assert.deepEqual(
    resolveDeliveredLinkShape([{ deliveredCount: 1 }, { deliveredCount: 0 }]),
    { kind: "SINGLE" }
  );
  assert.deepEqual(resolveDeliveredLinkShape([{ deliveredCount: 2 }]), {
    kind: "AMBIGUOUS",
    lineCount: 1,
    deliveredCount: 2,
  });
  assert.deepEqual(
    resolveDeliveredLinkShape([{ deliveredCount: 1 }, { deliveredCount: 1 }]),
    { kind: "AMBIGUOUS", lineCount: 2, deliveredCount: 2 }
  );
});

test("🔴 기록 수를 줄 수보다 먼저 본다 — 아무 일도 없던 저장마다 알림이 뜨면 안 된다", () => {
  // 줄이 셋인데 기록이 하나도 없으면 「여럿이라 못 맞췄다」가 아니다.
  assert.deepEqual(
    resolveDeliveredLinkShape([
      { deliveredCount: 0 },
      { deliveredCount: 0 },
      { deliveredCount: 0 },
    ]),
    { kind: "NO_ROW" }
  );
});

// ── ③ 내자 → 수리 건 ──────────────────────────────────────────────────────

/** 이 방향 시험의 기본 재료. 인수일은 2026-01-01 이다. */
function toCase(overrides: Partial<Parameters<typeof resolveRepairCaseShipmentWriteThrough>[0]> = {}) {
  return resolveRepairCaseShipmentWriteThrough({
    editedLine: { previousDeliveredDates: [], nextDeliveredDates: ["2026-02-01"] },
    otherLines: [],
    repairCaseActualShipmentDate: "2026-01-28",
    receivedAt: "2026-01-01",
    ...overrides,
  });
}

test("납품일을 고치면 수리 건의 실제 출하일이 그 날짜가 된다", () => {
  assert.deepEqual(toCase(), { kind: "WRITE", date: "2026-02-01" });
});

test("안 바뀐 저장은 아무 일도 하지 않는다 — 차례만 바뀐 것도 안 바뀐 저장이다", () => {
  assert.deepEqual(
    toCase({
      editedLine: {
        previousDeliveredDates: ["2026-02-01", "2026-03-01"],
        nextDeliveredDates: ["2026-03-01", "2026-02-01"],
      },
    }),
    { kind: "NONE" }
  );
  // 🔴 같은 날짜가 두 회차에 적힌 줄도 있다 — **집합이 아니라 센 것**으로 견준다.
  //    집합으로 보면 「회차 하나를 지운 저장」이 안 바뀐 저장으로 읽힌다.
  assert.deepEqual(
    toCase({
      editedLine: {
        previousDeliveredDates: ["2026-02-01", "2026-02-01"],
        nextDeliveredDates: ["2026-02-01"],
      },
    }),
    { kind: "WRITE", date: "2026-02-01" }
  );
});

test("🔴 다 지운 저장은 수리 건의 출하일을 지우지 않는다", () => {
  // 지우기를 묶으면, 수리 건 저장이 막아 둔 문(「실제 출하일은 비울 수 없습니다」)을
  // 이 통로가 뒤로 여는 셈이 된다.
  assert.deepEqual(
    toCase({
      editedLine: { previousDeliveredDates: ["2026-02-01"], nextDeliveredDates: [] },
    }),
    { kind: "NONE" }
  );
});

test("🔴 아직 출하 완료가 안 된 건에는 밀어 넣지 않는다 — 종 알림 넷의 침묵 스위치다", () => {
  const plan = toCase({ repairCaseActualShipmentDate: null });
  assert.equal(plan.kind, "NOT_LINKED");
  if (plan.kind !== "NOT_LINKED") return;
  assert.equal(plan.outcome.reason, "NOT_SHIPPED");
  assert.equal(plan.outcome.message, REPAIR_CASE_SHIPMENT_NOT_SHIPPED_MESSAGE);
  // 🔴 「저장했습니다」로 시작해야 한다 — 사람이 보고 있는 쪽은 저장됐다.
  assert.ok(plan.outcome.message.startsWith("납품일은 저장했습니다"));
  // 그리고 어디로 가야 하는지를 말한다 — 수리 건 상세에서도 못 적는 값이다.
  assert.ok(plan.outcome.message.includes("출하 완료 처리"));
});

test("🔴 인수일보다 이른 날짜는 수리 건에 넣지 않는다 — 저쪽 잣대를 우회하지 않는다", () => {
  const plan = toCase({
    editedLine: { previousDeliveredDates: [], nextDeliveredDates: ["2025-12-31"] },
  });
  assert.equal(plan.kind, "NOT_LINKED");
  if (plan.kind !== "NOT_LINKED") return;
  assert.equal(plan.outcome.reason, "BLOCKED_BY_RECEIVED_AT");
  assert.equal(plan.outcome.message, REPAIR_CASE_SHIPMENT_BLOCKED_BY_RECEIVED_AT_MESSAGE);
  // 같은 날은 통과한다(저쪽 잣대와 같은 함수다).
  assert.deepEqual(
    toCase({ editedLine: { previousDeliveredDates: [], nextDeliveredDates: ["2026-01-01"] } }),
    { kind: "WRITE", date: "2026-01-01" }
  );
});

test("🔴 기록이 여럿이면 멈추고 말한다 — 어느 날짜인지는 사람만 안다", () => {
  const sameLine = toCase({
    editedLine: { previousDeliveredDates: [], nextDeliveredDates: ["2026-02-01", "2026-03-01"] },
  });
  assert.equal(sameLine.kind, "NOT_LINKED");
  if (sameLine.kind === "NOT_LINKED") {
    assert.equal(sameLine.outcome.reason, "AMBIGUOUS");
    assert.equal(sameLine.outcome.message, REPAIR_CASE_SHIPMENT_NOT_LINKED_MESSAGE);
  }

  // 다른 줄에 기록이 있어도 모호하다(분할 발주).
  const otherLine = toCase({ otherLines: [{ deliveredCount: 1 }] });
  assert.equal(otherLine.kind, "NOT_LINKED");
});

test("이미 같은 날짜면 아무 일도 하지 않는다", () => {
  assert.deepEqual(toCase({ repairCaseActualShipmentDate: "2026-02-01" }), { kind: "NONE" });
});

// ── ④ 수리 건 → 내자 ──────────────────────────────────────────────────────

function toOrder(
  overrides: Partial<Parameters<typeof resolveDomesticOrderDeliveredWriteThrough>[0]> = {}
) {
  return resolveDomesticOrderDeliveredWriteThrough({
    previousActualShipmentDate: null,
    nextActualShipmentDate: "2026-02-01",
    trigger: "SHIPMENT_COMPLETED",
    lines: [{ dueDateRows: [{ deliveredDate: null }] }],
    ...overrides,
  });
}

test("출하 완료가 연결된 줄의 빈 행에 납품일을 찍는다 (사용자 결정 6)", () => {
  assert.deepEqual(toOrder(), { kind: "WRITE", date: "2026-02-01" });
});

test("🔴 출하 완료는 **이미 적힌 납품일을 덮지 않는다** — 운송 시차가 말없이 사라진다", () => {
  assert.deepEqual(
    toOrder({ lines: [{ dueDateRows: [{ deliveredDate: "2026-02-05" }] }] }),
    { kind: "NONE" }
  );
  // 🔴 사람이 수리 건 상세에서 **고쳐 적은** 길은 다르다 — 그때는 맞춘다.
  assert.deepEqual(
    toOrder({
      trigger: "MANUAL_EDIT",
      previousActualShipmentDate: "2026-01-20",
      lines: [{ dueDateRows: [{ deliveredDate: "2026-02-05" }] }],
    }),
    { kind: "WRITE", date: "2026-02-01" }
  );
});

test("🔴 행이 하나도 없는 줄에는 행을 만들지 않는다 — 지어낼 납기일이 없다", () => {
  assert.deepEqual(toOrder({ lines: [{ dueDateRows: [] }] }), { kind: "NONE" });
  assert.deepEqual(toOrder({ lines: [] }), { kind: "NONE" });
});

test("🔴 행이 여럿이면 자동으로 안 찍고 말한다 (사용자 결정 7)", () => {
  const manyRows = toOrder({
    lines: [{ dueDateRows: [{ deliveredDate: null }, { deliveredDate: null }] }],
  });
  assert.equal(manyRows.kind, "NOT_LINKED");
  if (manyRows.kind === "NOT_LINKED") {
    assert.equal(manyRows.outcome.reason, "AMBIGUOUS");
    assert.equal(manyRows.outcome.message, DOMESTIC_ORDER_DELIVERED_NOT_LINKED_MESSAGE);
  }

  const manyLines = toOrder({
    lines: [{ dueDateRows: [{ deliveredDate: null }] }, { dueDateRows: [{ deliveredDate: null }] }],
  });
  assert.equal(manyLines.kind, "NOT_LINKED");
});

test("🔴 출하 완료를 되돌려도 내자의 납품 기록은 지우지 않는다", () => {
  // 그 행에는 사람이 적은 납품자가 함께 달려 있다. 되돌리기가 그것까지 지우면
  // 손으로 적은 기록이 말없이 사라진다.
  assert.deepEqual(
    toOrder({
      previousActualShipmentDate: "2026-02-01",
      nextActualShipmentDate: null,
      lines: [{ dueDateRows: [{ deliveredDate: "2026-02-01" }] }],
    }),
    { kind: "NONE" }
  );
});

test("안 바뀐 저장은 아무 일도 하지 않는다 — 인수정보 폼은 칸을 늘 함께 보낸다", () => {
  assert.deepEqual(
    toOrder({
      trigger: "MANUAL_EDIT",
      previousActualShipmentDate: "2026-02-01",
      nextActualShipmentDate: "2026-02-01",
    }),
    { kind: "NONE" }
  );
  // 공백만 적힌 값은 양쪽 다 「없음」으로 접는다.
  assert.deepEqual(
    toOrder({ previousActualShipmentDate: "   ", nextActualShipmentDate: "  " }),
    { kind: "NONE" }
  );
});
