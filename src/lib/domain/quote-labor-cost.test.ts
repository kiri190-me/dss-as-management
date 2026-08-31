import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { sumQuoteLaborCost, type SelectedRepairTask } from "./quote-labor-cost";
// 같은 파일에 둔다: 견적서가 얼마를 청구하는가를 정하는 규칙 둘(작업비 합계 ·
// 부품 단가 넣기)이라 함께 읽히는 편이 낫고, package.json 의 시험 목록을 건드리지
// 않아도 이 파일은 이미 등록돼 있다(두 세션이 같은 저장소를 쓰는 동안 그 줄을
// 건드리면 서로 섞인다).
import { isPriceUnset, toPriceFieldValue } from "./quote-part-price";

/**
 * ============================================================================
 * 작업비 = 기본 작업비 + Σ(공수시간 × 시간당 단가)
 * ============================================================================
 * 실제 값으로 못 박는다 — 제너레이터는 기본 350만원이고 `OH` 가 24시간이므로
 * O/H 한 건만 골랐을 때 **590만원**이 나와야 한다(2026-08-31 사용자 자료).
 * ============================================================================
 */

function task(patch: Partial<SelectedRepairTask> = {}): SelectedRepairTask {
  return { taskName: "OH", hours: 24, hourlyRate: "100000", ...patch };
}

test("🔴 실제 값 — 제너레이터에서 OH 하나를 고르면 350만 + 240만 = 590만원", () => {
  const result = sumQuoteLaborCost([task()], "3500000");
  assert.equal(result.tasksTotal, 2400000);
  assert.equal(result.baseCost, 3500000);
  assert.equal(result.total, 5900000);
});

test("여러 작업은 각각 공수시간 × 단가로 더해진다", () => {
  const result = sumQuoteLaborCost(
    [
      task({ taskName: "OH", hours: 24 }),
      task({ taskName: "FAN 교환", hours: 2 }),
      task({ taskName: "MCU 기판 교환 작업", hours: 12 }),
    ],
    "3500000"
  );
  assert.equal(result.tasksTotal, 3800000, "(24+2+12)시간 × 10만원");
  assert.equal(result.total, 7300000);
});

test("아무것도 안 고르면 기본 작업비만 남는다", () => {
  const result = sumQuoteLaborCost([], "3500000");
  assert.equal(result.tasksTotal, 0);
  assert.equal(result.total, 3500000);
});

test("🔴 정하지 않은 기본 작업비(null)를 0 으로 접지 않는다 — 접으면 정하지 않은 사실이 사라진다", () => {
  const result = sumQuoteLaborCost([task({ hours: 8 })], null);
  assert.equal(result.baseCost, null, "더하지 않았다는 사실이 남아야 화면이 알린다");
  assert.equal(result.total, 800000);
});

test("기본 작업비 '0' 은 실제 0원이라 더해지고, 정하지 않은 것과 구별된다", () => {
  const zero = sumQuoteLaborCost([task({ hours: 8 })], "0");
  assert.equal(zero.baseCost, 0, "0 은 '더했는데 0원'이다");
  assert.equal(zero.total, 800000);

  const unset = sumQuoteLaborCost([task({ hours: 8 })], null);
  assert.equal(unset.baseCost, null, "null 은 '아예 안 더했다'이다");
});

test("줄마다의 시간당 단가를 그대로 쓴다 — 옛 견적서가 지금 단가로 다시 셈되지 않는다", () => {
  // 단가가 오르기 전에 저장된 줄과 오른 뒤의 줄이 한 견적서에 섞일 수 있다.
  const result = sumQuoteLaborCost(
    [task({ taskName: "옛 줄", hours: 10, hourlyRate: "80000" }), task({ taskName: "새 줄", hours: 10 })],
    null
  );
  assert.equal(result.tasksTotal, 1800000, "80만 + 100만");
});

test("숫자로 안 읽히는 값은 합계를 NaN 으로 만들지 않고, 무엇이 빠졌는지 알린다", () => {
  const result = sumQuoteLaborCost(
    [task({ taskName: "정상", hours: 2 }), task({ taskName: "망가진 단가", hourlyRate: "abc" })],
    "3500000"
  );
  assert.equal(result.tasksTotal, 200000);
  assert.deepEqual(result.unknown, ["망가진 단가"], "조용히 빼면 사람은 합계가 맞는 줄 안다");
  assert.equal(Number.isFinite(result.total), true);
});

test("빈 목록에 기본 작업비도 없으면 0 이다", () => {
  assert.deepEqual(sumQuoteLaborCost([], null), {
    total: 0,
    tasksTotal: 0,
    baseCost: null,
    unknown: [],
  });
});

/**
 * ============================================================================
 * 단가를 화면 칸에 넣기 — "정하지 않음"과 "0"을 가르는 자리
 * ============================================================================
 * 어느 단가를 따르는지는 **줄의 출처**가 정한다(2026-08-31 사용자 결정):
 * 출고에서 담은 줄은 부품 상세의 일반 단가, O/H 템플릿에서 불러온 줄은 템플릿의
 * O/H 단가. 남은 규칙이 이것이다 — **null 을 0 으로 접지 않는 것.**
 * ============================================================================
 */
describe("단가를 화면 칸에 넣기", () => {
  test("🔴 정하지 않은 단가(null)는 빈칸이다 — 0 으로 채우면 0원으로 청구된다", () => {
    assert.equal(toPriceFieldValue(null), "");
    assert.equal(isPriceUnset(null), true);
  });

  test("🔴 '0' 은 '무상'이라는 실제 값이라 0 으로 남는다 — 빈칸과 다르다", () => {
    assert.equal(toPriceFieldValue("0"), "0");
    assert.equal(isPriceUnset("0"), false, "0 은 정하지 않은 것이 아니다");
  });

  test("numeric 이 달고 오는 소수점을 지운다 — 사람이 적지도 않은 '.00' 을 보여 주지 않는다", () => {
    assert.equal(toPriceFieldValue("160000.00"), "160000");
    assert.equal(toPriceFieldValue("2000.00"), "2000");
  });

  test("실제로 값이 있는 소수는 남긴다", () => {
    assert.equal(toPriceFieldValue("1500.50"), "1500.5");
  });

  test("숫자로 안 읽히는 값은 NaN 을 칸에 박지 않고 빈칸으로 둔다", () => {
    assert.equal(toPriceFieldValue("abc"), "", "'NaN' 이 칸에 보이면 사람이 지우는 수밖에 없다");
  });
});
