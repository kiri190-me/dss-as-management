import { test } from "node:test";
import assert from "node:assert/strict";
import { isLongPendingPo, type LongPendingPoCandidate } from "./long-pending-po";
import type { WeeklyReportOrderDates } from "./weekly-report";

/**
 * 장기 PO 미발행 판정. 규칙은 넷이고(long-pending-po.ts 헤더), 아래 시험이
 * 그 넷을 각각 못 박는다.
 *
 * 경계 두 가지를 특히 조심한다:
 *  - **딱 두 달이 되는 날 당일부터** 걸린다(`≤`). 그 하루 전은 안 걸린다.
 *  - **오늘은 한국 날짜다.** date 칼럼의 "YYYY-MM-DD" 를 new Date() 로 파싱하면
 *    UTC 자정이 되어 한국시간 오전 9시부터 하루가 어긋난다 — 아래 KST 경계
 *    두 케이스가 그 회귀를 막는 자물쇠다(repair-case-overdue.test.ts 와 같은
 *    자물쇠다).
 */

/** 2026-08-25 14:00 KST — 한국/UTC 달력 날짜가 둘 다 08-25인, 경계가 아닌 시각. */
const MIDDAY_KST = new Date("2026-08-25T05:00:00.000Z");

function order(overrides: Partial<WeeklyReportOrderDates> = {}): WeeklyReportOrderDates {
  return { quoteIssuedDate: null, orderIssuedDate: null, ...overrides };
}

function subject(overrides: Partial<LongPendingPoCandidate> = {}): LongPendingPoCandidate {
  return {
    status: "WAITING_PO",
    orderRows: [order({ quoteIssuedDate: "2026-06-25" })],
    ...overrides,
  };
}

// ─────────────────────────────────────────────── 두 달 경계

test("견적일 + 2개월이 정확히 오늘이면 걸린다 (당일부터다)", () => {
  // 2026-06-25 + 2개월 = 2026-08-25 = 오늘.
  assert.equal(isLongPendingPo(subject(), MIDDAY_KST), true);
});

test("그 하루 전이면 아직 걸리지 않는다", () => {
  // 2026-06-26 + 2개월 = 2026-08-26 > 오늘(08-25).
  assert.equal(
    isLongPendingPo(subject({ orderRows: [order({ quoteIssuedDate: "2026-06-26" })] }), MIDDAY_KST),
    false
  );
});

test("두 달을 한참 넘긴 건은 당연히 걸린다", () => {
  assert.equal(
    isLongPendingPo(subject({ orderRows: [order({ quoteIssuedDate: "2026-01-05" })] }), MIDDAY_KST),
    true
  );
});

test("말일 접기: 12월 31일 견적은 2월 28일부터 걸린다", () => {
  const feb27 = new Date("2027-02-27T05:00:00.000Z");
  const feb28 = new Date("2027-02-28T05:00:00.000Z");
  const dec31Quote = subject({ orderRows: [order({ quoteIssuedDate: "2026-12-31" })] });

  assert.equal(isLongPendingPo(dec31Quote, feb27), false, "2월 27일에는 아직 아니다");
  assert.equal(isLongPendingPo(dec31Quote, feb28), true, "2월 28일 당일부터 걸린다");
});

test("윤년: 2027년 12월 31일 견적은 2028년 2월 29일부터 걸린다", () => {
  const feb28 = new Date("2028-02-28T05:00:00.000Z");
  const feb29 = new Date("2028-02-29T05:00:00.000Z");
  const dec31Quote = subject({ orderRows: [order({ quoteIssuedDate: "2027-12-31" })] });

  assert.equal(isLongPendingPo(dec31Quote, feb28), false, "윤년의 2월 28일에는 아직 아니다");
  assert.equal(isLongPendingPo(dec31Quote, feb29), true, "2월 29일 당일부터 걸린다");
});

// ─────────────────────────────────────────────── KST 경계 (UTC 자정 함정)

test("KST 경계: 한국 08-25 00:30(UTC 08-24 15:30)에 견적일 06-25는 이미 걸린다", () => {
  // UTC 달력 날짜는 아직 08-24라, UTC 기준 구현이라면 틀리게 "아직 아니다"가 나온다.
  const alreadyAug25Kst = new Date("2026-08-24T15:30:00.000Z");
  assert.equal(isLongPendingPo(subject(), alreadyAug25Kst), true);
});

test("KST 경계: 한국 08-25 17:59(UTC 08-25 08:59)에 견적일 06-26은 아직 걸리지 않는다", () => {
  const stillAug25Kst = new Date("2026-08-25T08:59:00.000Z");
  assert.equal(
    isLongPendingPo(
      subject({ orderRows: [order({ quoteIssuedDate: "2026-06-26" })] }),
      stillAug25Kst
    ),
    false
  );
});

// ─────────────────────────────────────────────── 견적일 · PO 발행일

test("견적일이 없으면 걸리지 않는다", () => {
  assert.equal(isLongPendingPo(subject({ orderRows: [order()] }), MIDDAY_KST), false);
});

test("내자 줄이 하나도 없으면 걸리지 않는다", () => {
  assert.equal(isLongPendingPo(subject({ orderRows: [] }), MIDDAY_KST), false);
});

test("PO 발행일이 있으면 견적일이 아무리 오래돼도 걸리지 않는다", () => {
  assert.equal(
    isLongPendingPo(
      subject({
        orderRows: [order({ quoteIssuedDate: "2025-01-05", orderIssuedDate: "2025-02-01" })],
      }),
      MIDDAY_KST
    ),
    false
  );
});

// ─────────────────────────────────────────────── 출하 완료

test("출하 완료된 건은 걸리지 않는다", () => {
  const shipped = subject({
    status: "SHIPMENT_COMPLETED",
    orderRows: [order({ quoteIssuedDate: "2026-01-05" })],
  });
  assert.equal(isLongPendingPo(shipped, MIDDAY_KST), false);
  // 대조가 성립한다 — 상태만 다르면 걸리는 건이다(검사를 지워도 초록색인
  // 시험이 아니라는 증거).
  assert.equal(isLongPendingPo({ ...shipped, status: "WAITING_PO" }, MIDDAY_KST), true);
});

test("상태가 비어 있는(null) 건도 출하 완료가 아니므로 판정 대상이다", () => {
  assert.equal(isLongPendingPo(subject({ status: null }), MIDDAY_KST), true);
});

// ─────────────────────────────────────────────── 내자 줄이 여럿일 때

test("발주일이 있는 줄이 하나라도 있으면, 다른 줄의 견적일이 오래돼도 걸리지 않는다", () => {
  // pickWeeklyReportOrderDates 는 발주일이 있는 줄을 먼저 걸러 그 안에서
  // 고른다 — 그 불변식이 이 판정을 지탱한다.
  const rows = [
    order({ quoteIssuedDate: "2025-01-05" }),
    order({ quoteIssuedDate: "2026-05-01", orderIssuedDate: "2026-05-10" }),
  ];
  assert.equal(isLongPendingPo(subject({ orderRows: rows }), MIDDAY_KST), false);
});

test("발주일이 어느 줄에도 없으면 견적일이 가장 이른 줄로 판정한다", () => {
  // 이른 줄(06-25)은 딱 두 달이 됐고, 늦은 줄(08-20)은 아직이다. 고르는 줄이
  // 바뀌면 답이 뒤집히므로, 이 시험이 "그 함수를 그대로 쓴다"를 못 박는다.
  const rows = [order({ quoteIssuedDate: "2026-08-20" }), order({ quoteIssuedDate: "2026-06-25" })];
  assert.equal(isLongPendingPo(subject({ orderRows: rows }), MIDDAY_KST), true);
});

test("가장 이른 견적일이 아직 두 달이 안 됐으면 걸리지 않는다", () => {
  const rows = [order({ quoteIssuedDate: "2026-08-20" }), order({ quoteIssuedDate: "2026-07-01" })];
  assert.equal(isLongPendingPo(subject({ orderRows: rows }), MIDDAY_KST), false);
});

test("견적일이 비어 있는 줄이 섞여 있어도 견적일이 있는 줄로 판정한다", () => {
  const rows = [order(), order({ quoteIssuedDate: "2026-06-25" }), order()];
  assert.equal(isLongPendingPo(subject({ orderRows: rows }), MIDDAY_KST), true);
});
