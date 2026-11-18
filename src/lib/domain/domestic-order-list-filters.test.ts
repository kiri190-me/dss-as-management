import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  collectDomesticOrderCustomerOptions,
  DOMESTIC_ORDER_STATUS_FILTER_LABELS,
  DOMESTIC_ORDER_STATUS_FILTER_VALUES,
  DOMESTIC_ORDER_UNASSIGNED_CUSTOMER_VALUE,
  domesticOrderCustomerFilterValue,
  filterDomesticOrdersByCustomerNames,
  filterDomesticOrdersBySearch,
  filterDomesticOrdersByStatus,
  filterDomesticOrdersByYear,
  groupDomesticOrdersByCustomer,
  matchesDomesticOrderStatusFilter,
  nextDomesticOrderOrderIssuedSort,
  sortDomesticOrderGroupRowsByOrderIssuedDate,
  UNASSIGNED_CUSTOMER_LABEL,
} from "./domestic-order-list";
import { NO_ORDER_DATE_LABEL } from "./domestic-order-display";

/**
 * ============================================================================
 * 내자 정리의 **거르개 둘(상태 · 고객사)과 발주발행일 세우기** (2026-11-18)
 * ============================================================================
 * 사용자 요구: 「내자정리에 상태 필터, 고객사 필터를 드롭박스로 … 복수 선택 …
 * 발주 발행일 옆에 작은 세모를 둬서 고객사 별로 오름차순·내림차순으로 (고객사들이
 * 섞이지 않게 고객사 안에서)」.
 *
 * 이웃 domestic-order-list.test.ts 와 **파일을 가른** 까닭: 저 파일은 「년도 ·
 * 검색 · 묶기 · 완료 판정」이 지켜야 하는 것을 재는 자리이고, 그중 하나가
 * **「묶음 안의 순서는 원본 그대로여야 한다」**이다. 이번에 생긴 것은 그 순서를
 * **일부러 바꾸는** 기능이라, 같은 파일에 섞어 두면 어느 단언이 어느 상태를 재는
 * 것인지 읽는 사람이 가려낼 수 없다. 🔴 저쪽 단언은 **지금도 그대로 참**이어야
 * 하고, 아래 ③-1 이 그 사실을 이쪽에서도 한 번 더 못 박는다.
 *
 * 2026-11-19 에 상태가 **넷**이 됐다(사용자 요구: 「[발주일 미정]을 [발주 대기]로
 * 이름을 바꿔주고, [발주 완료]상태를 추가해줘」). 늘어난 값은 `ORDER_ISSUED` 하나고,
 * 판정은 한 줄도 바뀌지 않았다 — 아래 ①-2 가 새 값이 지켜야 하는 것을 잰다.
 *
 * 이 시험이 지키는 것:
 *  1. 🔴 **상태 복수 선택은 OR 이다** — 넷이 서로 배타적이지 않아서(발주 대기는
 *     완료·미완료 양쪽과 겹친다) 교집합으로 두면 사람이 고른 뜻과 정반대가 된다.
 *  2. 🔴 「발주 대기」의 판정이 **화면 배지와 같은 한 줄**이다 — 배지가 붙은 줄과
 *     필터에 걸리는 줄이 다르면 사람이 필터를 믿지 못한다.
 *  2-1. 🔴 「발주 대기」와 「발주 완료」가 **정확한 여집합**이다 — 한쪽에만 공백
 *     접기를 더하면 `""` 인 줄이 둘 다 켜도 사라진다.
 *  3. 🔴 고객사 후보는 **지금 올라온 줄에서** 나온다 — 고객사 마스터를 쓰면 수정
 *     권한이 없는 분에게 필터가 통째로 사라진다.
 *  4. 🔴 **세모가 꺼진 기본 상태에서는 묶음 안 차례가 원본 그대로**다. 표의 `순번`
 *     칸이 사람이 매긴 값이라, 기본이 흔들리면 그 숫자와 눈에 보이는 차례가 어긋난다.
 *  5. 🔴 켜면 **묶음 안만** 다시 서고 **묶음의 차례는 그대로**다.
 *  6. 🔴 발행일이 없는 줄은 **오름·내림 어느 쪽에서도 맨 뒤**다.
 * ============================================================================
 */

type Row = {
  id: string;
  orderIssuedDate: string | null;
  customerName: string | null;
  completedAt: string | null;
  displayIntakeNumber: string | null;
  purchaseOrderNumber: string | null;
  displayQuoteNumber: string | null;
  projectName: string | null;
  modelName: string | null;
  serialNumber: string | null;
  lotNumber: string | null;
};

function row(id: string, overrides: Partial<Row> = {}): Row {
  return {
    id,
    orderIssuedDate: null,
    customerName: null,
    completedAt: null,
    displayIntakeNumber: null,
    purchaseOrderNumber: null,
    displayQuoteNumber: null,
    projectName: null,
    modelName: null,
    serialNumber: null,
    lotNumber: null,
    ...overrides,
  };
}

const idsOf = (rows: readonly Row[]) => rows.map((r) => r.id);

// ═══════════════════════════════════════ ① 상태 거르개

/**
 * 🔵 **표본이 무엇을 재는 모양인지 먼저 못 박는다.** 네 줄이 완료 여부 × 발주일
 * 유무의 네 칸을 하나씩 채우고 있어야 아래 조합 시험이 뜻을 갖는다 — 특히
 * 🔴 **「발주 대기이면서 완료됨」** 한 줄이 OR 과 AND 를 가르는 유일한 자리다.
 */
const statusRows = [
  row("완료·발주일O", { completedAt: "2026-11-01T00:00:00Z", orderIssuedDate: "2026-03-01" }),
  row("미완료·발주일O", { completedAt: null, orderIssuedDate: "2026-04-01" }),
  // 🔴 겹치는 줄. 완료 처리에 「발주일이 있어야 한다」는 관문이 없어 실제로 생긴다.
  row("완료·발주일X", { completedAt: "2026-11-02T00:00:00Z", orderIssuedDate: null }),
  row("미완료·발주일X", { completedAt: null, orderIssuedDate: null }),
];

describe("🔵 재는 도구 — 표본", () => {
  test("표본 네 줄이 완료 여부 × 발주일 유무의 네 칸을 하나씩 채운다", () => {
    assert.equal(statusRows.length, 4, "표본이 바뀌었다 — 아래 조합 시험도 함께 고칠 것");
    const shape = statusRows.map((r) => `${r.completedAt === null ? "미완료" : "완료"}/${r.orderIssuedDate === null ? "발주일X" : "발주일O"}`);
    assert.deepEqual(new Set(shape).size, 4, "같은 칸을 두 줄이 채우고 있다 — 조합을 가를 수 없다");
    assert.ok(
      statusRows.some((r) => r.completedAt !== null && r.orderIssuedDate === null),
      "🔴 「발주 대기이면서 완료됨」 줄이 표본에 없다 — OR 과 AND 가 같은 답을 내 시험이 공짜로 통과한다"
    );
  });

  test("상태 값 넷이 그대로다 — 늘거나 줄면 아래 조합이 뜻을 잃는다", () => {
    // 🔴 차례가 곧 드롭다운에 서는 차례다. 「발주 완료」는 **맨 뒤**이고 「발주 대기」
    //    바로 다음이다 — 짝으로 읽히지 않으면 사용자가 둘을 같은 칸의 반대쪽으로 안 본다.
    assert.deepEqual([...DOMESTIC_ORDER_STATUS_FILTER_VALUES], [
      "COMPLETED",
      "INCOMPLETE",
      "NO_ORDER_DATE",
      "ORDER_ISSUED",
    ]);
  });
});

describe("🔴 상태 거르개", () => {
  test("아무것도 안 고르면 전체다", () => {
    assert.deepEqual(idsOf(filterDomesticOrdersByStatus(statusRows, [])), idsOf(statusRows));
  });

  test("「완료됨」은 completed_at 이 있는 줄, 「미완료」는 없는 줄이다", () => {
    assert.deepEqual(idsOf(filterDomesticOrdersByStatus(statusRows, ["COMPLETED"])), [
      "완료·발주일O",
      "완료·발주일X",
    ]);
    assert.deepEqual(idsOf(filterDomesticOrdersByStatus(statusRows, ["INCOMPLETE"])), [
      "미완료·발주일O",
      "미완료·발주일X",
    ]);
  });

  test("「발주 대기」는 완료 여부와 **상관없이** 발주일이 없는 줄 전부다", () => {
    // 겹치는 줄이 여기서 한 번, 아래 OR 에서 한 번 더 뜻을 갖는다.
    assert.deepEqual(idsOf(filterDomesticOrdersByStatus(statusRows, ["NO_ORDER_DATE"])), [
      "완료·발주일X",
      "미완료·발주일X",
    ]);
  });

  test("🔴 복수 선택은 OR 이다 — 「완료됨」+「발주 대기」는 둘 중 하나라도 해당되면 남는다", () => {
    const picked = idsOf(filterDomesticOrdersByStatus(statusRows, ["COMPLETED", "NO_ORDER_DATE"]));
    assert.deepEqual(picked, ["완료·발주일O", "완료·발주일X", "미완료·발주일X"]);
    // 🔴 교집합이었다면 「완료·발주일X」 한 줄뿐이다. 이 한 줄이 두 규칙을 가른다.
    assert.notDeepEqual(picked, ["완료·발주일X"], "교집합으로 돌고 있다");
    assert.ok(
      picked.includes("완료·발주일O"),
      "발주일이 있는 완료 줄이 빠졌다 — 「완료됨」을 고른 뜻이 사라졌다"
    );
    assert.ok(
      picked.includes("미완료·발주일X"),
      "미완료인 발주 대기 줄이 빠졌다 — 「발주 대기」를 고른 뜻이 사라졌다"
    );
  });

  test("🔴 「완료됨」과 「미완료」를 둘 다 고르면 전체가 된다 — 합집합의 당연한 결과다", () => {
    assert.deepEqual(
      idsOf(filterDomesticOrdersByStatus(statusRows, ["COMPLETED", "INCOMPLETE"])),
      idsOf(statusRows)
    );
  });

  test("🔴 「발주 대기이면서 완료됨」 줄이 네 조합에서 어떻게 나오는가", () => {
    const only = (statuses: Parameters<typeof filterDomesticOrdersByStatus>[1]) =>
      idsOf(filterDomesticOrdersByStatus(statusRows, statuses)).includes("완료·발주일X");
    assert.equal(only(["COMPLETED"]), true, "완료됨에 안 걸렸다");
    assert.equal(only(["NO_ORDER_DATE"]), true, "발주 대기에 안 걸렸다");
    assert.equal(only(["INCOMPLETE"]), false, "미완료에 걸렸다 — 완료된 줄이다");
    assert.equal(
      only(["INCOMPLETE", "NO_ORDER_DATE"]),
      true,
      "미완료에는 안 걸려도 발주 대기로 남아야 한다(OR)"
    );
  });

  test("거르기가 줄 차례를 흔들지 않는다 — 표에 사람이 매긴 순번이 있다", () => {
    const shuffled = [statusRows[3], statusRows[0], statusRows[2], statusRows[1]];
    assert.deepEqual(
      idsOf(filterDomesticOrdersByStatus(shuffled, ["COMPLETED", "INCOMPLETE"])),
      idsOf(shuffled)
    );
  });

  test("🔴 「발주 대기」 판정은 null 하나다 — 빈 글자는 대기가 아니다(화면 배지와 같은 한 줄)", () => {
    // 화면의 OrderIssuedDateContent 는 `orderIssuedDate !== null` 이면 그 글자를
    // 그대로 그린다 — 빈 글자인 줄에는 배지가 안 붙는다. 여기서만 공백을 접으면
    // 배지는 없는데 필터에는 걸리는 줄이 생기고, 그 어긋남은 오류 없이 조용히 산다.
    assert.equal(matchesDomesticOrderStatusFilter(row("빈글자", { orderIssuedDate: "" }), "NO_ORDER_DATE"), false);
    assert.equal(matchesDomesticOrderStatusFilter(row("널", { orderIssuedDate: null }), "NO_ORDER_DATE"), true);
  });

  test("🔴 거르개의 이름표는 배지의 상수와 **일부러 다르다** — 되돌리면 여기서 깨진다", () => {
    // 🔴 **뜻이 2026-11-19 에 뒤집힌 단언이다.** 전날까지는
    // `=== NO_ORDER_DATE_LABEL`(= 배지와 같은 글자여야 한다)이었다. 사용자에게 「그
    // 글자를 쓰는 다섯 자리를 전부 통일할까요」를 물었고 **「필터 이름만 바꾸자」**는
    // 답을 받았으므로, 이제 지켜야 하는 것은 **갈라져 있다**는 쪽이다.
    //
    // 상수를 그대로 쓰는 쪽이 자연스러워 보여서 다음 사람이 되돌리기 쉽다. 그러면
    // 화면의 필터 이름이 조용히 「발주일 미정」으로 돌아가므로, 같음이 아니라 **다름**
    // 을 단언해 그 되돌림이 여기서 멈추게 한다.
    assert.equal(DOMESTIC_ORDER_STATUS_FILTER_LABELS.NO_ORDER_DATE, "발주 대기");
    assert.notEqual(
      DOMESTIC_ORDER_STATUS_FILTER_LABELS.NO_ORDER_DATE,
      NO_ORDER_DATE_LABEL,
      "🔴 거르개 이름표가 배지 상수로 되돌아갔다 — 2026-11-19 사용자 결정은 「필터 이름만 바꾼다」였다"
    );
    // 🔵 배지 쪽 상수는 **그대로여야 한다.** 거르개 이름을 바꾸면서 저쪽까지 바꾸면
    //    「다섯 자리는 안 건드린다」는 그 결정의 나머지 절반이 사라진다.
    assert.equal(NO_ORDER_DATE_LABEL, "발주일 미정");
    assert.equal(DOMESTIC_ORDER_STATUS_FILTER_LABELS.ORDER_ISSUED, "발주 완료");
    assert.equal(DOMESTIC_ORDER_STATUS_FILTER_LABELS.COMPLETED, "완료됨");
    assert.equal(DOMESTIC_ORDER_STATUS_FILTER_LABELS.INCOMPLETE, "미완료");
  });

  test("🔵 값 넷이 전부 이름표를 갖는다 — 하나라도 비면 드롭다운에 빈 줄이 선다", () => {
    for (const value of DOMESTIC_ORDER_STATUS_FILTER_VALUES) {
      const label = DOMESTIC_ORDER_STATUS_FILTER_LABELS[value];
      assert.equal(typeof label, "string", `${value} 의 이름표가 글자가 아니다`);
      assert.notEqual(label.trim(), "", `${value} 의 이름표가 비었다`);
    }
    assert.equal(
      new Set(Object.values(DOMESTIC_ORDER_STATUS_FILTER_LABELS)).size,
      DOMESTIC_ORDER_STATUS_FILTER_VALUES.length,
      "이름표 둘이 같은 글자다 — 드롭다운에서 어느 쪽을 고른 것인지 알 수 없다"
    );
  });

  test("빈 목록을 걸러도 빈 목록이다", () => {
    assert.deepEqual(filterDomesticOrdersByStatus([], ["COMPLETED"]), []);
    assert.deepEqual(filterDomesticOrdersByStatus([], []), []);
  });
});

// ═══════════════════ ①-2 「발주 완료」 (2026-11-19)

/**
 * 🔵 **여집합을 재는 표본은 위 넷에 「공백만」 한 줄을 더한 것**이다. 그 줄이
 * 없으면 한쪽에 공백 접기(foldBlankToNull)를 더해도 「둘을 다 켜면 전체」가 그대로
 * 참이라, 아래 여집합 시험이 접기를 **못 잡는다** — 양쪽에서 동시에 빠질 수 있는
 * 값은 `""` 뿐이기 때문이다(`null` 도 날짜 글자도 어느 판정에서든 한쪽에 걸린다).
 */
const orderIssuedRows = [...statusRows, row("공백만", { orderIssuedDate: "" })];

describe("🔵 재는 도구 — 여집합 표본", () => {
  test("표본 다섯 줄에 null · 날짜 글자 · 공백만이 다 들어 있다", () => {
    assert.equal(orderIssuedRows.length, 5, "표본이 바뀌었다 — 아래 단언도 함께 고칠 것");
    assert.ok(orderIssuedRows.some((r) => r.orderIssuedDate === null), "null 줄이 없다");
    assert.ok(
      orderIssuedRows.some((r) => typeof r.orderIssuedDate === "string" && r.orderIssuedDate !== ""),
      "날짜가 적힌 줄이 없다"
    );
    assert.ok(
      orderIssuedRows.some((r) => r.orderIssuedDate === ""),
      "🔴 공백만인 줄이 없다 — 공백 접기를 더해도 아래 여집합 시험이 그대로 통과한다"
    );
  });
});

describe("🔴 「발주 완료」 — 발주일이 **있는** 줄", () => {
  test("「발주 완료」 단독은 발주일이 적힌 줄만 남긴다 — 완료 여부와 상관없다", () => {
    assert.deepEqual(idsOf(filterDomesticOrdersByStatus(statusRows, ["ORDER_ISSUED"])), [
      "완료·발주일O",
      "미완료·발주일O",
    ]);
  });

  test("🔴 빈 글자는 「발주 완료」다 — 「발주 대기」의 null 한 줄과 짝이다", () => {
    // 위 「발주 대기 판정은 null 하나다」의 **짝**이다. 화면의 OrderIssuedDateContent
    // 는 `!== null` 이면 그 글자를 그대로 그리므로 `""` 인 줄에는 배지가 안 붙는다 —
    // 배지가 없는 줄은 「발주가 난 줄」 쪽에 서는 것이 화면과 맞는다.
    // 🔴 여기에 공백 접기를 더하면 이 줄이 양쪽 어디에도 안 걸려, 이 단언이 막는다.
    assert.equal(matchesDomesticOrderStatusFilter(row("빈글자", { orderIssuedDate: "" }), "ORDER_ISSUED"), true);
    assert.equal(matchesDomesticOrderStatusFilter(row("널", { orderIssuedDate: null }), "ORDER_ISSUED"), false);
    assert.equal(matchesDomesticOrderStatusFilter(row("날짜", { orderIssuedDate: "2026-03-01" }), "ORDER_ISSUED"), true);
  });

  test("🔴 「발주 대기」와 「발주 완료」는 **정확한 여집합**이다 — 둘 다 켜면 전체다", () => {
    assert.deepEqual(
      idsOf(filterDomesticOrdersByStatus(orderIssuedRows, ["NO_ORDER_DATE", "ORDER_ISSUED"])),
      idsOf(orderIssuedRows),
      "둘을 다 켰는데 빠진 줄이 있다 — 한쪽 판정에 공백 접기가 섞였을 것이다"
    );
  });

  test("🔴 한 줄이 둘 다에 걸리는 일은 **없다** — 모든 줄이 정확히 한쪽이다", () => {
    for (const r of orderIssuedRows) {
      const waiting = matchesDomesticOrderStatusFilter(r, "NO_ORDER_DATE");
      const issued = matchesDomesticOrderStatusFilter(r, "ORDER_ISSUED");
      assert.notEqual(
        waiting,
        issued,
        `${r.id} 가 「발주 대기」·「발주 완료」 둘 다 ${waiting} 다 — 여집합이 깨졌다`
      );
    }
  });

  test("🔵 「완료됨 + 미완료」와 **같은 성질**이다 — 한 쌍을 둘 다 고르면 전체", () => {
    // 쌍이 둘이라는 사실 자체를 재는 자리다. 새 값이 「셋째 쌍의 한쪽」처럼 끼어들면
    // 여기서 드러난다.
    assert.deepEqual(
      idsOf(filterDomesticOrdersByStatus(orderIssuedRows, ["COMPLETED", "INCOMPLETE"])),
      idsOf(orderIssuedRows)
    );
  });

  test("🔴 쌍을 건너뛴 조합도 OR 이다 — 「완료됨 + 발주 완료」", () => {
    // 교집합이었다면 「완료·발주일O」 한 줄뿐이다.
    const picked = idsOf(filterDomesticOrdersByStatus(orderIssuedRows, ["COMPLETED", "ORDER_ISSUED"]));
    assert.deepEqual(picked, ["완료·발주일O", "미완료·발주일O", "완료·발주일X", "공백만"]);
    assert.ok(picked.includes("완료·발주일X"), "발주일 없는 완료 줄이 빠졌다 — 교집합으로 돌고 있다");
  });

  test("「발주 완료」로 걸러도 줄 차례는 원본 그대로다 — 표에 사람이 매긴 순번이 있다", () => {
    // 🔵 걸러져 나가는 줄(미완료·발주일X)을 가운데 끼워 둔다 — 전부 남는 표본으로
    //    재면 「차례를 지킨다」가 공짜로 통과한다.
    const shuffled = [orderIssuedRows[4], orderIssuedRows[3], orderIssuedRows[1], orderIssuedRows[0]];
    assert.deepEqual(idsOf(filterDomesticOrdersByStatus(shuffled, ["ORDER_ISSUED"])), [
      "공백만",
      "미완료·발주일O",
      "완료·발주일O",
    ]);
  });
});

// ═══════════════════════════════════════ ② 고객사 거르개

const customerRows = [
  row("c1", { customerName: "한빛전자" }),
  row("c2", { customerName: "동해정밀" }),
  row("c3", { customerName: null }),
  row("c4", { customerName: "한빛전자" }),
  row("c5", { customerName: "   " }),
  row("c6", { customerName: "가온전자" }),
];

describe("🔴 고객사 거르개 — 후보 뽑기", () => {
  test("🔵 표본에 이름 셋·빈 값 두 가지(null · 공백만)가 들어 있다", () => {
    assert.ok(customerRows.some((r) => r.customerName === null), "null 줄이 없다");
    assert.ok(
      customerRows.some((r) => typeof r.customerName === "string" && r.customerName.trim() === ""),
      "공백만 적힌 줄이 없다 — 「빈 값 접기」가 공짜로 통과한다"
    );
  });

  test("🔴 후보는 **지금 올라온 줄에서** 나온다 — 가나다순, 미지정은 맨 뒤 하나", () => {
    assert.deepEqual(collectDomesticOrderCustomerOptions(customerRows), [
      { value: "가온전자", label: "가온전자" },
      { value: "동해정밀", label: "동해정밀" },
      { value: "한빛전자", label: "한빛전자" },
      { value: DOMESTIC_ORDER_UNASSIGNED_CUSTOMER_VALUE, label: UNASSIGNED_CUSTOMER_LABEL },
    ]);
  });

  test("같은 고객사가 여러 줄에 나와도 후보는 한 줄이다", () => {
    const names = collectDomesticOrderCustomerOptions(customerRows).map((o) => o.value);
    assert.equal(names.filter((n) => n === "한빛전자").length, 1);
  });

  test("비어 있는 줄이 하나도 없으면 「미지정」 자리를 내밀지 않는다 — 늘 0건인 칸이 된다", () => {
    const options = collectDomesticOrderCustomerOptions([row("a", { customerName: "한빛전자" })]);
    assert.deepEqual(options, [{ value: "한빛전자", label: "한빛전자" }]);
  });

  test("줄이 하나도 없으면 후보도 없다", () => {
    assert.deepEqual(collectDomesticOrderCustomerOptions([]), []);
  });

  test("🔴 미지정 줄의 글자는 묶음 소제목과 같다 — 두 자리가 같은 줄을 다른 말로 부르지 않는다", () => {
    const groups = groupDomesticOrdersByCustomer(customerRows);
    const unassignedGroup = groups.find((g) => g.customerName === null);
    assert.ok(unassignedGroup, "미지정 묶음이 없다 — 표본이 바뀌었다");
    const unassignedOption = collectDomesticOrderCustomerOptions(customerRows).at(-1);
    assert.equal(unassignedOption?.label, unassignedGroup.label);
  });
});

describe("🔴 고객사 거르개 — 거르기", () => {
  test("아무것도 안 고르면 전체다", () => {
    assert.deepEqual(idsOf(filterDomesticOrdersByCustomerNames(customerRows, [])), idsOf(customerRows));
  });

  test("고른 이름의 줄만 남고, 차례는 원본 그대로다", () => {
    assert.deepEqual(idsOf(filterDomesticOrdersByCustomerNames(customerRows, ["한빛전자"])), [
      "c1",
      "c4",
    ]);
  });

  test("🔴 여럿 고르면 합집합이다", () => {
    assert.deepEqual(
      idsOf(filterDomesticOrdersByCustomerNames(customerRows, ["한빛전자", "가온전자"])),
      ["c1", "c4", "c6"]
    );
  });

  test("🔴 「미지정」은 평범한 한 줄이라 이름과 **함께** 고를 수 있다", () => {
    // 미지정을 따로 떼어 판정하면 먼저 쓴 가지가 나중 가지를 잡아먹는다.
    assert.deepEqual(
      idsOf(
        filterDomesticOrdersByCustomerNames(customerRows, [
          "동해정밀",
          DOMESTIC_ORDER_UNASSIGNED_CUSTOMER_VALUE,
        ])
      ),
      ["c2", "c3", "c5"]
    );
  });

  test("공백만 적힌 이름은 「미지정」으로 접힌다 — 화면에는 빈칸인 줄이다", () => {
    assert.equal(domesticOrderCustomerFilterValue(row("x", { customerName: "   " })), "NONE");
    assert.equal(domesticOrderCustomerFilterValue(row("x", { customerName: null })), "NONE");
    assert.equal(domesticOrderCustomerFilterValue(row("x", { customerName: " 한빛전자 " })), "한빛전자");
  });
});

// ═══════════════════════════════════════ ③ 발주발행일 세우기

const sortRows = [
  row("g1-3월", { customerName: "한빛전자", orderIssuedDate: "2026-03-10" }),
  row("g1-미정", { customerName: "한빛전자", orderIssuedDate: null }),
  row("g1-1월", { customerName: "한빛전자", orderIssuedDate: "2026-01-05" }),
  row("g1-3월또", { customerName: "한빛전자", orderIssuedDate: "2026-03-10" }),
  row("g2-5월", { customerName: "동해정밀", orderIssuedDate: "2026-05-02" }),
  row("g2-2월", { customerName: "동해정밀", orderIssuedDate: "2026-02-02" }),
  row("없음-4월", { customerName: null, orderIssuedDate: "2026-04-04" }),
  row("없음-미정", { customerName: null, orderIssuedDate: null }),
];

/** 묶음을 「이름: 줄, 줄」 꼴로 펴서 한눈에 맞댄다. */
const shapeOf = (groups: readonly { label: string; rows: readonly Row[] }[]) =>
  groups.map((g) => `${g.label}: ${idsOf(g.rows).join(", ")}`);

describe("🔵 재는 도구 — 세우기 표본", () => {
  test("표본이 묶음 셋이고, 한 묶음 안에 **이미 날짜순이 아닌** 줄들이 있다", () => {
    const groups = groupDomesticOrdersByCustomer(sortRows);
    assert.equal(groups.length, 3, "묶음 수가 바뀌었다");
    const first = groups[0].rows.map((r) => r.orderIssuedDate);
    assert.deepEqual(first, ["2026-03-10", null, "2026-01-05", "2026-03-10"]);
    assert.notDeepEqual(
      first,
      [...first].sort(),
      "🔴 표본이 이미 날짜순이다 — 세우기 시험이 공짜로 통과한다"
    );
    assert.ok(
      first.filter((d) => d === "2026-03-10").length === 2,
      "같은 날짜 두 줄이 없다 — 안정 정렬을 잴 수 없다"
    );
  });
});

describe("🔴 ③-1 꺼진 기본 상태", () => {
  test("🔴 세모를 누르기 전에는 묶음 안 차례가 **원본 그대로**다", () => {
    // 이웃 domestic-order-list.test.ts 의 「묶음 안의 순서는 원본 그대로여야 한다」와
    // 같은 강도다. 세우는 함수는 **불리지 않는다** — 화면도 그 가지를 탄다.
    assert.deepEqual(shapeOf(groupDomesticOrdersByCustomer(sortRows)), [
      "한빛전자: g1-3월, g1-미정, g1-1월, g1-3월또",
      "동해정밀: g2-5월, g2-2월",
      `${UNASSIGNED_CUSTOMER_LABEL}: 없음-4월, 없음-미정`,
    ]);
  });

  test("기본값은 꺼짐이고, 누르면 오름 → 내림 → 꺼짐으로 돈다", () => {
    assert.equal(nextDomesticOrderOrderIssuedSort(null), "asc");
    assert.equal(nextDomesticOrderOrderIssuedSort("asc"), "desc");
    assert.equal(nextDomesticOrderOrderIssuedSort("desc"), null, "끄는 길이 없어졌다");
  });

  test("세 번 누르면 처음으로 돌아온다", () => {
    let state = nextDomesticOrderOrderIssuedSort(null);
    state = nextDomesticOrderOrderIssuedSort(state);
    state = nextDomesticOrderOrderIssuedSort(state);
    assert.equal(state, null);
  });
});

describe("🔴 ③-2 켜면 묶음 안만 다시 선다", () => {
  test("오름차순 — 묶음 안만 발행일순이고 묶음 차례는 그대로다", () => {
    const sorted = sortDomesticOrderGroupRowsByOrderIssuedDate(
      groupDomesticOrdersByCustomer(sortRows),
      "asc"
    );
    assert.deepEqual(shapeOf(sorted), [
      "한빛전자: g1-1월, g1-3월, g1-3월또, g1-미정",
      "동해정밀: g2-2월, g2-5월",
      `${UNASSIGNED_CUSTOMER_LABEL}: 없음-4월, 없음-미정`,
    ]);
  });

  test("내림차순 — 날짜만 뒤집히고 묶음 차례는 여전히 그대로다", () => {
    const sorted = sortDomesticOrderGroupRowsByOrderIssuedDate(
      groupDomesticOrdersByCustomer(sortRows),
      "desc"
    );
    assert.deepEqual(shapeOf(sorted), [
      "한빛전자: g1-3월, g1-3월또, g1-1월, g1-미정",
      "동해정밀: g2-5월, g2-2월",
      `${UNASSIGNED_CUSTOMER_LABEL}: 없음-4월, 없음-미정`,
    ]);
  });

  test("🔴 묶음의 차례·이름·고객사 값은 어느 방향에서도 안 바뀐다", () => {
    const base = groupDomesticOrdersByCustomer(sortRows);
    for (const direction of ["asc", "desc"] as const) {
      const sorted = sortDomesticOrderGroupRowsByOrderIssuedDate(base, direction);
      assert.deepEqual(
        sorted.map((g) => [g.customerName, g.label, g.rows.length]),
        base.map((g) => [g.customerName, g.label, g.rows.length]),
        `${direction} 에서 묶음이 달라졌다`
      );
    }
  });

  test("🔴 발행일이 없는 줄은 오름·내림 **어느 쪽에서도 맨 뒤**다", () => {
    const base = groupDomesticOrdersByCustomer(sortRows);
    for (const direction of ["asc", "desc"] as const) {
      const first = sortDomesticOrderGroupRowsByOrderIssuedDate(base, direction)[0];
      assert.equal(
        idsOf(first.rows).at(-1),
        "g1-미정",
        `${direction} 에서 발주일 미정 줄이 맨 뒤가 아니다`
      );
    }
  });

  test("날짜 없는 줄끼리는 원본 차례 그대로 남는다", () => {
    const rows = [
      row("미정A", { customerName: "한빛전자" }),
      row("날짜", { customerName: "한빛전자", orderIssuedDate: "2026-01-01" }),
      row("미정B", { customerName: "한빛전자" }),
    ];
    const sorted = sortDomesticOrderGroupRowsByOrderIssuedDate(
      groupDomesticOrdersByCustomer(rows),
      "asc"
    );
    assert.deepEqual(idsOf(sorted[0].rows), ["날짜", "미정A", "미정B"]);
  });

  test("🔴 같은 날짜끼리는 원본 차례 그대로다 — 누를 때마다 같은 묶음이 다르게 보이면 안 된다", () => {
    const base = groupDomesticOrdersByCustomer(sortRows);
    assert.deepEqual(
      idsOf(sortDomesticOrderGroupRowsByOrderIssuedDate(base, "asc")[0].rows).slice(1, 3),
      ["g1-3월", "g1-3월또"]
    );
    assert.deepEqual(
      idsOf(sortDomesticOrderGroupRowsByOrderIssuedDate(base, "desc")[0].rows).slice(0, 2),
      ["g1-3월", "g1-3월또"]
    );
  });

  test("빈 글자·공백만 적힌 날짜도 맨 뒤다 — 오름차순 맨 위에 빈 칸이 줄줄이 서지 않는다", () => {
    const rows = [
      row("빈글자", { customerName: "한빛전자", orderIssuedDate: "" }),
      row("날짜", { customerName: "한빛전자", orderIssuedDate: "2026-01-01" }),
      row("공백", { customerName: "한빛전자", orderIssuedDate: "  " }),
    ];
    const sorted = sortDomesticOrderGroupRowsByOrderIssuedDate(
      groupDomesticOrdersByCustomer(rows),
      "asc"
    );
    assert.deepEqual(idsOf(sorted[0].rows), ["날짜", "빈글자", "공백"]);
  });

  test("년도가 바뀌는 경계를 글자 그대로 센다 — Date 로 파싱하면 하루가 밀린다", () => {
    const rows = [
      row("새해", { customerName: "한빛전자", orderIssuedDate: "2026-01-01" }),
      row("섣달그믐", { customerName: "한빛전자", orderIssuedDate: "2025-12-31" }),
    ];
    const sorted = sortDomesticOrderGroupRowsByOrderIssuedDate(
      groupDomesticOrdersByCustomer(rows),
      "asc"
    );
    assert.deepEqual(idsOf(sorted[0].rows), ["섣달그믐", "새해"]);
  });

  test("받은 묶음을 제자리에서 뒤집지 않는다 — React 가 같은 참조를 보면 다시 그리지 않는다", () => {
    const base = groupDomesticOrdersByCustomer(sortRows);
    const before = shapeOf(base);
    const sorted = sortDomesticOrderGroupRowsByOrderIssuedDate(base, "asc");
    assert.deepEqual(shapeOf(base), before, "원본 묶음이 함께 뒤집혔다");
    assert.notEqual(sorted[0], base[0], "묶음 객체를 그대로 돌려줬다");
    assert.notEqual(sorted[0].rows, base[0].rows, "줄 배열을 그대로 돌려줬다");
  });

  test("묶음이 하나도 없어도 터지지 않는다", () => {
    assert.deepEqual(sortDomesticOrderGroupRowsByOrderIssuedDate([], "asc"), []);
  });
});

// ═══════════════════════════════════════ ④ 함께 걸었을 때

describe("🔴 ④ 검색 · 년도와 함께 걸어도 어긋나지 않는다", () => {
  const mixed = [
    row("2026-한빛-완료", {
      customerName: "한빛전자",
      orderIssuedDate: "2026-03-01",
      completedAt: "2026-11-01T00:00:00Z",
      purchaseOrderNumber: "PO-2026-0001",
    }),
    row("2026-한빛-미완료", {
      customerName: "한빛전자",
      orderIssuedDate: "2026-04-01",
      purchaseOrderNumber: "PO-2026-0002",
    }),
    row("2025-한빛-미완료", {
      customerName: "한빛전자",
      orderIssuedDate: "2025-04-01",
      purchaseOrderNumber: "PO-2025-0003",
    }),
    row("2026-동해-완료", {
      customerName: "동해정밀",
      orderIssuedDate: "2026-05-01",
      completedAt: "2026-11-02T00:00:00Z",
      purchaseOrderNumber: "PO-2026-0004",
    }),
    row("미정-동해-완료", {
      customerName: "동해정밀",
      orderIssuedDate: null,
      completedAt: "2026-11-03T00:00:00Z",
      purchaseOrderNumber: "PO-2026-0005",
    }),
  ];

  /** 화면이 쓰는 그 차례 그대로 — (검색 또는 년도) → 상태 → 고객사. */
  function applyLikeScreen(options: {
    query?: string;
    year?: string | null;
    statuses?: Parameters<typeof filterDomesticOrdersByStatus>[1];
    customerNames?: readonly string[];
  }) {
    const query = options.query ?? "";
    const base =
      query === ""
        ? filterDomesticOrdersByYear(mixed, options.year ?? null)
        : filterDomesticOrdersBySearch(mixed, query);
    const byStatus = filterDomesticOrdersByStatus(base, options.statuses ?? []);
    return idsOf(filterDomesticOrdersByCustomerNames(byStatus, options.customerNames ?? []));
  }

  test("🔵 아무것도 안 걸면 전체다", () => {
    assert.deepEqual(applyLikeScreen({}), idsOf(mixed));
  });

  test("년도 + 상태 + 고객사를 함께 걸면 셋을 모두 만족하는 줄만 남는다", () => {
    assert.deepEqual(
      applyLikeScreen({ year: "2026", statuses: ["COMPLETED"], customerNames: ["동해정밀"] }),
      ["2026-동해-완료", "미정-동해-완료"]
    );
  });

  test("🔴 발주일 없는 줄은 년도를 걸어도 남고, 상태·고객사로는 평범하게 걸러진다", () => {
    // 년도 거르기만은 「발주일 없는 줄을 떨어뜨리지 않는다」가 규칙이다. 그 예외가
    // 상태·고객사로 새지 않는지 본다 — 새면 「발주일 미정」 줄이 어떤 조건에서도
    // 안 사라지는, 풀 수 없는 줄이 된다.
    assert.deepEqual(applyLikeScreen({ year: "2025" }), ["2025-한빛-미완료", "미정-동해-완료"]);
    assert.deepEqual(applyLikeScreen({ year: "2025", customerNames: ["한빛전자"] }), [
      "2025-한빛-미완료",
    ]);
    assert.deepEqual(applyLikeScreen({ year: "2026", statuses: ["INCOMPLETE"] }), [
      "2026-한빛-미완료",
    ]);
  });

  test("검색 중에는 년도를 안 보지만 상태·고객사는 그대로 걸린다", () => {
    assert.deepEqual(applyLikeScreen({ query: "PO-20" }), idsOf(mixed), "검색이 년도를 가리지 않는다");
    assert.deepEqual(applyLikeScreen({ query: "PO-20", statuses: ["COMPLETED"] }), [
      "2026-한빛-완료",
      "2026-동해-완료",
      "미정-동해-완료",
    ]);
    assert.deepEqual(
      applyLikeScreen({ query: "PO-20", statuses: ["COMPLETED"], customerNames: ["한빛전자"] }),
      ["2026-한빛-완료"]
    );
  });

  test("🔴 조건을 다 걸어 한 줄도 안 남을 수 있다 — 화면이 그때 빈 표 대신 안내를 세운다", () => {
    assert.deepEqual(
      applyLikeScreen({ year: "2025", statuses: ["COMPLETED"], customerNames: ["한빛전자"] }),
      []
    );
  });

  test("거른 뒤에도 묶음 안 차례는 원본 그대로다(세모를 안 눌렀으므로)", () => {
    const left = filterDomesticOrdersByCustomerNames(
      filterDomesticOrdersByStatus(mixed, ["COMPLETED", "INCOMPLETE"]),
      ["한빛전자"]
    );
    assert.deepEqual(shapeOf(groupDomesticOrdersByCustomer(left)), [
      "한빛전자: 2026-한빛-완료, 2026-한빛-미완료, 2025-한빛-미완료",
    ]);
  });
});
