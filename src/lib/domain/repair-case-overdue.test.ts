import { test } from "node:test";
import assert from "node:assert/strict";
import { isRepairCaseOverdue, type RepairCase } from "./types";

/**
 * "납기 지연"은 내부 목표 출하일이 *지난* 것이지 목표일 *당일*이 아니다.
 * internalTargetShipmentDate는 PostgreSQL `date` 컬럼에서 온 "YYYY-MM-DD"
 * 문자열이라 new Date()로 파싱하면 UTC 자정이 되므로, 실제 시각과 그대로
 * 비교하면 한국시간 오전 9시(=UTC 0시)부터 "목표일이 바로 오늘"인 건이
 * 지연으로 뒤집힌다. 아래 KST 경계 두 케이스가 그 회귀를 막는 자물쇠다.
 */

type OverdueInput = Pick<RepairCase, "status" | "internalTargetShipmentDate">;

function subject(overrides: Partial<OverdueInput> = {}): OverdueInput {
  return {
    status: "IN_REPAIR",
    internalTargetShipmentDate: "2026-08-25",
    ...overrides,
  };
}

// 2026-08-25 14:00 KST — 한국/UTC 달력 날짜가 둘 다 08-25인, 경계가 아닌 시각.
const MIDDAY_KST = new Date("2026-08-25T05:00:00.000Z");

test("목표 출하일이 어제면 납기 지연이다", () => {
  assert.equal(
    isRepairCaseOverdue(subject({ internalTargetShipmentDate: "2026-08-24" }), MIDDAY_KST),
    true
  );
});

test("목표 출하일이 오늘(한국)이면 아직 납기 지연이 아니다", () => {
  assert.equal(
    isRepairCaseOverdue(subject({ internalTargetShipmentDate: "2026-08-25" }), MIDDAY_KST),
    false
  );
});

test("목표 출하일이 내일이면 납기 지연이 아니다", () => {
  assert.equal(
    isRepairCaseOverdue(subject({ internalTargetShipmentDate: "2026-08-26" }), MIDDAY_KST),
    false
  );
});

test("출하 완료된 건은 목표 출하일이 한참 지났어도 납기 지연이 아니다", () => {
  assert.equal(
    isRepairCaseOverdue(
      subject({ status: "SHIPMENT_COMPLETED", internalTargetShipmentDate: "2026-01-05" }),
      MIDDAY_KST
    ),
    false
  );
});

test("목표 출하일이 없으면(null) 납기 지연이 아니다", () => {
  assert.equal(
    isRepairCaseOverdue(subject({ internalTargetShipmentDate: null }), MIDDAY_KST),
    false
  );
});

test("KST 경계: 한국 08-25 09:30(UTC 08-25 00:30)에 목표일 08-25는 지연이 아니다", () => {
  // UTC 기준으로 비교하는 구현이라면 new Date("2026-08-25")(UTC 자정)이
  // 이 시각보다 앞서므로 틀리게 "지연"이 나온다.
  const justAfterNineAmKst = new Date("2026-08-25T00:30:00.000Z");
  assert.equal(
    isRepairCaseOverdue(subject({ internalTargetShipmentDate: "2026-08-25" }), justAfterNineAmKst),
    false
  );
});

test("KST 경계: 한국 08-26 00:30(UTC 08-25 15:30)에 목표일 08-25는 지연이다", () => {
  // UTC 달력 날짜는 아직 08-25라, UTC 기준 구현이라면 틀리게 "지연 아님"이 나온다.
  const alreadyNextDayKst = new Date("2026-08-25T15:30:00.000Z");
  assert.equal(
    isRepairCaseOverdue(subject({ internalTargetShipmentDate: "2026-08-25" }), alreadyNextDayKst),
    true
  );
});
