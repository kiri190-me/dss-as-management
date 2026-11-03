import { test } from "node:test";
import assert from "node:assert/strict";
import { isRepairCaseOverdue, type RepairCase } from "./types";

/**
 * ============================================================================
 * 「납기 지연」 — **고객 요청 납기일**이 지난 건 (2026-11-03 부터)
 * ============================================================================
 * 사용자 결정: 「사내 목표 완료일을 지났다고 해서 납기 지연 베찌가 뜨지 않도록
 * 해줘. (고객 요청 납기일을 지났을 때만 [납기 지연]이 뜨도록 해줘.)」
 *
 * 🔴 **그 전까지 이 판정이 보던 날짜는 사내 목표 완료일**(칸 이름은
 * internalTargetShipmentDate 그대로)이었다. 그래서 아래 표본은 **두 날짜를 모두**
 * 들고 다니며, 사내 날짜 쪽은 일부러 **한참 지난 값**으로 둔다 — 옛 규칙이
 * 되살아나면 그 자리에서 터지도록. 사내 날짜를 null 로 비워 두면 「고객 날짜를
 * 본다」와 「아무 날짜도 안 본다」가 구별되지 않아, 판정을 통째로 꺼 놔도 초록이다.
 *
 * "납기 지연"은 납기일이 *지난* 것이지 납기일 *당일*이 아니다.
 * customerRequestedDueDate는 PostgreSQL `date` 컬럼에서 온 "YYYY-MM-DD"
 * 문자열이라 new Date()로 파싱하면 UTC 자정이 되므로, 실제 시각과 그대로
 * 비교하면 한국시간 오전 9시(=UTC 0시)부터 "납기일이 바로 오늘"인 건이
 * 지연으로 뒤집힌다. 아래 KST 경계 두 케이스가 그 회귀를 막는 자물쇠다.
 * ============================================================================
 */

type OverdueInput = Pick<
  RepairCase,
  "status" | "customerRequestedDueDate" | "actualShipmentDate" | "internalTargetShipmentDate"
>;

function subject(overrides: Partial<OverdueInput> = {}): OverdueInput {
  return {
    status: "IN_REPAIR",
    customerRequestedDueDate: "2026-08-25",
    actualShipmentDate: null,
    // 🔴 표본의 못 — 이 날짜는 **언제나 한참 지나 있다.** 옛 규칙(사내 날짜로 재기)이
    // 되살아나면 아래 "지연 아님" 단언들이 전부 깨진다.
    internalTargetShipmentDate: "2026-01-05",
    ...overrides,
  };
}

// 2026-08-25 14:00 KST — 한국/UTC 달력 날짜가 둘 다 08-25인, 경계가 아닌 시각.
const MIDDAY_KST = new Date("2026-08-25T05:00:00.000Z");

test("표본 점검 — 사내 목표 완료일은 늘 지나 있다(옛 규칙이 되살아나면 바로 걸린다)", () => {
  const s = subject();
  assert.ok(s.internalTargetShipmentDate !== null);
  assert.ok(
    s.internalTargetShipmentDate < "2026-08-25",
    "표본의 사내 날짜가 지나 있지 않다 — 아래 시험들이 옛 규칙을 못 잡는다"
  );
});

test("🔴 사내 목표 완료일만 지났으면 납기 지연이 아니다 — 2026-11-03 사용자 결정", () => {
  assert.equal(
    isRepairCaseOverdue(
      subject({ customerRequestedDueDate: "2026-12-31", internalTargetShipmentDate: "2026-01-05" }),
      MIDDAY_KST
    ),
    false
  );
});

test("🔴 고객 요청 납기일이 어제면 납기 지연이다", () => {
  assert.equal(
    isRepairCaseOverdue(subject({ customerRequestedDueDate: "2026-08-24" }), MIDDAY_KST),
    true
  );
});

test("고객 요청 납기일이 오늘(한국)이면 아직 납기 지연이 아니다", () => {
  assert.equal(
    isRepairCaseOverdue(subject({ customerRequestedDueDate: "2026-08-25" }), MIDDAY_KST),
    false
  );
});

test("고객 요청 납기일이 내일이면 납기 지연이 아니다", () => {
  assert.equal(
    isRepairCaseOverdue(subject({ customerRequestedDueDate: "2026-08-26" }), MIDDAY_KST),
    false
  );
});

test("출하 완료된 건은 고객 요청 납기일이 한참 지났어도 납기 지연이 아니다", () => {
  assert.equal(
    isRepairCaseOverdue(
      subject({ status: "SHIPMENT_COMPLETED", customerRequestedDueDate: "2026-01-05" }),
      MIDDAY_KST
    ),
    false
  );
});

test("🔴 고객 요청 납기일이 없으면(null) 납기 지연이 아니다 — 사내 날짜가 지나 있어도", () => {
  assert.equal(
    isRepairCaseOverdue(
      subject({ customerRequestedDueDate: null, internalTargetShipmentDate: "2026-01-05" }),
      MIDDAY_KST
    ),
    false
  );
});

test("KST 경계: 한국 08-25 09:30(UTC 08-25 00:30)에 납기일 08-25는 지연이 아니다", () => {
  // UTC 기준으로 비교하는 구현이라면 new Date("2026-08-25")(UTC 자정)이
  // 이 시각보다 앞서므로 틀리게 "지연"이 나온다.
  const justAfterNineAmKst = new Date("2026-08-25T00:30:00.000Z");
  assert.equal(
    isRepairCaseOverdue(subject({ customerRequestedDueDate: "2026-08-25" }), justAfterNineAmKst),
    false
  );
});

test("KST 경계: 한국 08-26 00:30(UTC 08-25 15:30)에 납기일 08-25는 지연이다", () => {
  // UTC 달력 날짜는 아직 08-25라, UTC 기준 구현이라면 틀리게 "지연 아님"이 나온다.
  const alreadyNextDayKst = new Date("2026-08-25T15:30:00.000Z");
  assert.equal(
    isRepairCaseOverdue(subject({ customerRequestedDueDate: "2026-08-25" }), alreadyNextDayKst),
    true
  );
});

/**
 * 아래 세 케이스가 "출하일이 찍힌 건은 지연이 아니다" 규칙의 자물쇠다.
 * 출하일이 있으면 그 물건은 이미 나간 것이므로, 워크플로 단계가 아직
 * SHIPMENT_COMPLETED에 닿지 않았어도 살아 있는 경보에서는 빠진다.
 */

test("납기일이 지났어도 실제 출하일이 찍혀 있으면 납기 지연이 아니다", () => {
  assert.equal(
    isRepairCaseOverdue(
      subject({
        status: "IN_REPAIR",
        customerRequestedDueDate: "2026-08-10",
        actualShipmentDate: "2026-08-09",
      }),
      MIDDAY_KST
    ),
    false
  );
});

test("납기일이 지났고 실제 출하일이 없으면(null) 여전히 납기 지연이다", () => {
  assert.equal(
    isRepairCaseOverdue(
      subject({
        status: "IN_REPAIR",
        customerRequestedDueDate: "2026-08-10",
        actualShipmentDate: null,
      }),
      MIDDAY_KST
    ),
    true
  );
});

test("실제 출하일이 납기일보다 늦어도(늦게 나갔어도) 이미 출하됐으므로 납기 지연이 아니다", () => {
  assert.equal(
    isRepairCaseOverdue(
      subject({
        status: "IN_REPAIR",
        customerRequestedDueDate: "2026-08-10",
        actualShipmentDate: "2026-08-20",
      }),
      MIDDAY_KST
    ),
    false
  );
});
