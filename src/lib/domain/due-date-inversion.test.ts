import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  DUE_DATE_INVERSION_NOTE,
  DUE_DATE_INVERSION_NOTE_CLASS,
  DUE_DATE_INVERSION_REASON_NOTE,
  isDueDateInverted,
  isRepairCaseDueDateInverted,
} from "./due-date-inversion";
import { isRepairCaseShipmentFinished } from "./notifications";
import type { RepairStatus } from "./types";

/**
 * ============================================================================
 * 「납기 역전」 — 사내 목표 출하일이 고객 요청 납기일보다 늦다 (2026-10-29)
 * ============================================================================
 * 사용자 요구: 「작성한 사내 목표 출하일이 고객 요청 납기일보다 늦으면 그 날짜를
 * 빨간 볼드로, 옆에 『납기 요청일 협의가 필요합니다.』 라는 메모를」.
 *
 * 🔴 여기서 못 박는 것 넷
 *  ① **경계** — 「늦으면」이므로 **같은 날은 역전이 아니다.** 이 한 줄이 없으면
 *     `>` 를 `>=` 로 바꿔도 시험이 전부 초록색으로 남고, 그날 제날짜에 맞춰 잡아
 *     둔 건 **전부**에 「협의가 필요합니다」가 뜬다.
 *  ② **한쪽이라도 비면 거짓** — 모름과 아님을 같은 칸에 넣기로 한 결정이다.
 *     비교를 한 적도 없는 건에 경보가 서면 안 된다.
 *  ③ **빌려 온 날짜로도 잰다**(사용자 결정) — 고객 요청 납기일이 비어 있으면
 *     화면에 보이는 것은 연결된 내자의 납기요청일 중 **가장 이른 하루**이고,
 *     판정도 그 날짜를 봐야 한다. 보이는 날짜와 판정이 본 날짜가 다르면 날짜만
 *     빨갛고 까닭은 어디에도 없는 화면이 된다.
 *  ④ **「오늘」을 보지 않는다** — 지난 건도 먼 미래 건도 답이 같다. 이것이
 *     「납기 지연」·「납기 임박」과 이 판정을 가르는 선이다.
 *  ⑤ **이미 나간 건에는 안 뜬다**(2026-10-30 사용자 결정) — 할 일이 없는 말이고,
 *     지난 건마다 붉은 글이 뜨면 살아 있는 경고가 묻힌다. 🔴 거르는 잣대는 새로
 *     적지 않고 납기 임박·납기 지연이 쓰는 그 함수와 **맞대어** 본다.
 *
 * 🔴 날짜는 전부 가짜 미래다. 실제 고객사·L/N·S/N 은 한 글자도 쓰지 않는다.
 * ============================================================================
 */

/** 고객이 달라고 한 날. 아래 시험이 이 날을 가운데 두고 앞뒤를 본다. */
const REQUESTED = "2094-10-20";
const ONE_DAY_LATER = "2094-10-21";
const ONE_DAY_EARLIER = "2094-10-19";

describe("납기 역전 — 날짜 둘만 본다", () => {
  test("🔴 사내 목표 출하일이 더 늦으면 역전이다", () => {
    assert.equal(
      isDueDateInverted({
        internalTargetShipmentDate: ONE_DAY_LATER,
        customerRequestedDueDate: REQUESTED,
      }),
      true
    );
  });

  test("🔴 같은 날은 역전이 아니다 — 요구가 「늦으면」이다(경계)", () => {
    assert.equal(
      isDueDateInverted({
        internalTargetShipmentDate: REQUESTED,
        customerRequestedDueDate: REQUESTED,
      }),
      false,
      "목표일 당일에 나가면 약속은 지켜진다 — 여기가 참이 되면 제날짜 건이 전부 경보가 된다"
    );
  });

  test("🔴 사내 목표 출하일이 더 이르면 역전이 아니다", () => {
    assert.equal(
      isDueDateInverted({
        internalTargetShipmentDate: ONE_DAY_EARLIER,
        customerRequestedDueDate: REQUESTED,
      }),
      false
    );
  });

  test("달·해를 넘는 하루도 가린다 — 사전순 비교가 곧 날짜순이다", () => {
    // 자리수가 고정된 "YYYY-MM-DD" 라서 성립한다. 9 < 10 을 글자로 견주면 뒤집히는
    // 자리(9월 30일 ↔ 10월 1일)를 일부러 고른다.
    assert.equal(
      isDueDateInverted({
        internalTargetShipmentDate: "2094-10-01",
        customerRequestedDueDate: "2094-09-30",
      }),
      true
    );
    assert.equal(
      isDueDateInverted({
        internalTargetShipmentDate: "2094-09-30",
        customerRequestedDueDate: "2094-10-01",
      }),
      false
    );
    assert.equal(
      isDueDateInverted({
        internalTargetShipmentDate: "2095-01-01",
        customerRequestedDueDate: "2094-12-31",
      }),
      true
    );
  });

  test("🔴 한쪽이라도 비면 거짓이다 — 「아직 모른다」를 「아니다」와 같은 칸에 넣는다", () => {
    // 공백만 적힌 값까지 접는다 — 화면에는 빈칸으로 보이는데 경보만 켜지는 건이
    // 생기지 않게 한다. 왼쪽이 늦은 날짜인 짝을 일부러 섞어, "비었다"는 사실이
    // 비교보다 먼저라는 것을 본다.
    const blanks: (string | null)[] = [null, "", "   "];
    for (const blank of blanks) {
      assert.equal(
        isDueDateInverted({
          internalTargetShipmentDate: ONE_DAY_LATER,
          customerRequestedDueDate: blank,
        }),
        false,
        `고객 요청 납기일이 ${JSON.stringify(blank)} 인데 역전이라고 했다`
      );
      assert.equal(
        isDueDateInverted({
          internalTargetShipmentDate: blank,
          customerRequestedDueDate: REQUESTED,
        }),
        false,
        `사내 목표 출하일이 ${JSON.stringify(blank)} 인데 역전이라고 했다`
      );
    }
    assert.equal(
      isDueDateInverted({ internalTargetShipmentDate: null, customerRequestedDueDate: null }),
      false
    );
  });

  test("🔴 「오늘」을 보지 않는다 — 한참 지난 짝도, 먼 미래 짝도 답이 같다", () => {
    // 같은 하루 차이를 과거와 미래에서 각각 본다. 어느 한쪽만 참이면 이 함수가
    // 몰래 「오늘」을 보고 있다는 뜻이고, 그러면 납기 지연·납기 임박과 구별되지
    // 않는다(그 둘은 시간이 흐르면 저절로 켜지는 경보다).
    assert.equal(
      isDueDateInverted({
        internalTargetShipmentDate: "2001-03-02",
        customerRequestedDueDate: "2001-03-01",
      }),
      true
    );
    assert.equal(
      isDueDateInverted({
        internalTargetShipmentDate: "2094-03-02",
        customerRequestedDueDate: "2094-03-01",
      }),
      true
    );
  });

  test("메모는 사용자가 준 글자 그대로이고, 옷은 붉되 굵지 않다", () => {
    assert.equal(DUE_DATE_INVERSION_NOTE, "납기 요청일 협의가 필요합니다.");
    assert.ok(
      DUE_DATE_INVERSION_REASON_NOTE.includes("사내 목표 출하일"),
      "까닭 설명이 무엇과 무엇을 견준 것인지 말하지 않는다"
    );
    // 클래스 이름은 글자 그대로여야 Tailwind 가 CSS 로 만든다(조립하면 색만 사라진다).
    assert.ok(DUE_DATE_INVERSION_NOTE_CLASS.includes("text-red-700"), "메모가 붉지 않다");
    assert.ok(DUE_DATE_INVERSION_NOTE_CLASS.includes("dark:"), "어두운 화면 짝이 없다");
    assert.ok(
      !DUE_DATE_INVERSION_NOTE_CLASS.includes("font-bold"),
      "메모까지 굵으면 날짜와 한 덩어리로 보여 눈이 날짜를 먼저 찾지 못한다"
    );
  });
});

/** 한 건에 내자 줄이 여럿일 수 있다(분할 발주). 빌려 오는 것은 **가장 이른 하루**다. */
const DOMESTIC_DUE_DATES = ["2094-11-20", "2094-10-20"];
const EARLIEST = "2094-10-20";

/**
 * **아직 안 나간** 수리 건 한 줄. 출하 두 칸에 기본값을 둬서 시험마다 적지 않게 한다 —
 * 날짜를 보는 시험과 출하를 보는 시험이 한 덩어리로 뒤섞이면 무엇을 재는지 흐려진다.
 */
function liveCase(row: {
  internalTargetShipmentDate: string | null;
  customerRequestedDueDate: string | null;
  domesticOrderDueDates?: readonly string[];
  status?: RepairStatus | null;
  actualShipmentDate?: string | null;
}) {
  return {
    internalTargetShipmentDate: row.internalTargetShipmentDate,
    customerRequestedDueDate: row.customerRequestedDueDate,
    domesticOrderDueDates: row.domesticOrderDueDates ?? [],
    status: row.status === undefined ? ("IN_REPAIR" as RepairStatus | null) : row.status,
    actualShipmentDate: row.actualShipmentDate ?? null,
  };
}

describe("납기 역전 — 수리 건은 빌려 온 날짜로도 잰다", () => {
  test("🔴 고객 요청 납기일이 비면 내자의 가장 이른 하루로 잰다", () => {
    // 목표일 11-01 은 가장 이른 10-20 보다 늦고, 늦은 쪽 11-20 보다는 이르다.
    // 엉뚱하게 11-20 을 보고 있으면 이 단언이 깨진다.
    assert.equal(
      isRepairCaseDueDateInverted(
        liveCase({
          internalTargetShipmentDate: "2094-11-01",
          customerRequestedDueDate: null,
          domesticOrderDueDates: DOMESTIC_DUE_DATES,
        })
      ),
      true
    );
    assert.equal(
      isRepairCaseDueDateInverted(
        liveCase({
          internalTargetShipmentDate: "2094-10-19",
          customerRequestedDueDate: null,
          domesticOrderDueDates: DOMESTIC_DUE_DATES,
        })
      ),
      false
    );
  });

  test("🔴 빌려 온 날짜에서도 같은 날은 역전이 아니다 — 경계가 두 길에서 같다", () => {
    assert.equal(
      isRepairCaseDueDateInverted(
        liveCase({
          internalTargetShipmentDate: EARLIEST,
          customerRequestedDueDate: null,
          domesticOrderDueDates: DOMESTIC_DUE_DATES,
        })
      ),
      false
    );
  });

  test("🔴 자기 칸이 적혀 있으면 그 값이 이긴다 — 내자 날짜는 보지 않는다", () => {
    // 자기 칸(12-01)으로 재면 역전이 아니고, 내자의 10-20 으로 재면 역전이다.
    // 빌려 오는 규칙의 방향이 뒤집히면 바로 여기서 드러난다.
    assert.equal(
      isRepairCaseDueDateInverted(
        liveCase({
          internalTargetShipmentDate: "2094-11-01",
          customerRequestedDueDate: "2094-12-01",
          domesticOrderDueDates: DOMESTIC_DUE_DATES,
        })
      ),
      false
    );
  });

  test("양쪽 어디에도 납기일이 없으면 거짓이다", () => {
    assert.equal(
      isRepairCaseDueDateInverted(
        liveCase({ internalTargetShipmentDate: "2094-11-01", customerRequestedDueDate: null })
      ),
      false
    );
  });

  test("사내 목표 출하일이 비어 있으면 빌려 올 날짜가 있어도 거짓이다", () => {
    assert.equal(
      isRepairCaseDueDateInverted(
        liveCase({
          internalTargetShipmentDate: null,
          customerRequestedDueDate: null,
          domesticOrderDueDates: DOMESTIC_DUE_DATES,
        })
      ),
      false
    );
  });
});

/**
 * ── 🔴 이미 나간 건에는 안 뜬다 (2026-10-30 사용자 결정) ────────────────────
 * 할 일이 없는 말이고, 지난 건을 열 때마다 붉은 글이 뜨면 정작 살아 있는 경고가
 * 묻힌다. 🔵 여기서 지키는 핵심은 「끝난 건을 뺀다」가 아니라 **「납기 임박·납기
 * 지연과 같은 잣대로 뺀다」**이다 — 경보마다 다른 식으로 가르면 언젠가 한쪽만
 * 고쳐지고, 그날 두 경보가 같은 건을 두고 다른 말을 한다.
 */
describe("납기 역전 — 이미 나간 건에는 안 뜬다", () => {
  /** 이 짝은 날짜만 보면 **언제나 역전**이다. 아래 시험들이 끄는 것은 출하뿐이다. */
  const INVERTED_DATES = {
    internalTargetShipmentDate: ONE_DAY_LATER,
    customerRequestedDueDate: REQUESTED,
  };

  test("표본 확인 — 안 나간 건에서는 이 짝이 분명히 역전이다", () => {
    // 이 줄이 없으면 아래 「안 뜬다」들이 **애초에 역전이 아니어서** 통과할 수 있다.
    assert.equal(isRepairCaseDueDateInverted(liveCase(INVERTED_DATES)), true);
  });

  test("🔴 출하 완료 상태면 역전이어도 안 뜬다", () => {
    assert.equal(
      isRepairCaseDueDateInverted(liveCase({ ...INVERTED_DATES, status: "SHIPMENT_COMPLETED" })),
      false
    );
  });

  test("🔴 실제 출하일이 찍혔으면 상태가 안 따라왔어도 안 뜬다", () => {
    // 🔴 상태 하나만 보면 새는 건이다 — 출하일은 찍혀 있는데 워크플로 단계가
    // 따라가지 못한 건이 실제로 있다(isRepairCaseShipmentFinished 주석).
    assert.equal(
      isRepairCaseDueDateInverted(
        liveCase({ ...INVERTED_DATES, status: "IN_REPAIR", actualShipmentDate: "2094-10-25" })
      ),
      false
    );
  });

  test("🔴 안 끝난 건은 그대로 뜬다 — 상태를 모르는 건(null)도 뜬다", () => {
    assert.equal(
      isRepairCaseDueDateInverted(liveCase({ ...INVERTED_DATES, status: "IN_REPAIR" })),
      true
    );
    // 상태를 지어내지 않고 「아직 안 나갔다」로 둔다 — 경보가 조용히 빠지는 쪽보다 낫다.
    assert.equal(
      isRepairCaseDueDateInverted(liveCase({ ...INVERTED_DATES, status: null })),
      true
    );
    // 공백만 적힌 출하일은 찍힌 것이 아니다.
    assert.equal(
      isRepairCaseDueDateInverted(liveCase({ ...INVERTED_DATES, actualShipmentDate: "   " })),
      true
    );
  });

  test("🔴 「끝났는가」의 잣대가 납기 임박·납기 지연과 **같은 함수**다", () => {
    // 규칙(상태 or 출하일)을 여기 다시 적지 않고 **그 함수의 답과 맞대어** 본다.
    // 베껴 적으면 이 시험이 지키려던 바로 그 중복을 제가 만든다.
    const rows: { status: RepairStatus | null; actualShipmentDate: string | null }[] = [
      { status: "SHIPMENT_COMPLETED", actualShipmentDate: null },
      { status: "IN_REPAIR", actualShipmentDate: "2094-10-25" },
      { status: "SHIPMENT_COMPLETED", actualShipmentDate: "2094-10-25" },
      { status: "IN_REPAIR", actualShipmentDate: null },
      { status: null, actualShipmentDate: null },
    ];
    let finishedSeen = 0;
    for (const row of rows) {
      const finished = isRepairCaseShipmentFinished(row);
      if (finished) finishedSeen += 1;
      assert.equal(
        isRepairCaseDueDateInverted(liveCase({ ...INVERTED_DATES, ...row })),
        !finished,
        `출하 판정(${finished})과 경보가 어긋난다: ${JSON.stringify(row)}`
      );
    }
    // 표본에 「끝난 건」이 하나도 없으면 위 단언은 아무것도 못 지킨다.
    assert.equal(finishedSeen, 3, "표본에서 끝난 건이 셋이어야 한다");
  });
});
