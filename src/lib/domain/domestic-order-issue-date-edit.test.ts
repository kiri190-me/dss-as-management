import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DOMESTIC_ORDER_ISSUE_DATE_BOTH_EMPTY_MESSAGE,
  DOMESTIC_ORDER_ISSUE_DATE_FORMAT_MESSAGE,
  DOMESTIC_ORDER_ISSUE_DATE_MISSING_MESSAGE,
  DOMESTIC_ORDER_ISSUE_DATE_MULTIPLE_ROWS_MESSAGE,
  DOMESTIC_ORDER_ISSUE_DATE_QUOTE_LOCK_MESSAGE,
  normalizeDomesticOrderIssueDateInput,
  resolveDomesticOrderIssueDateEditPlan,
  type DomesticOrderIssueDateEditRow,
  type RepairCaseDomesticOrderIssueDateRow,
} from "./domestic-order-issue-date-edit";
import {
  DOMESTIC_ORDER_QUOTE_LOCK_NOTE,
  domesticOrderInlineEditQuoteLock,
} from "./domestic-order-cell-edit";
import { resolveRepairCaseDomesticOrderDates } from "./repair-case-domestic-order-dates";

/**
 * ============================================================================
 * 수리 건 상세 「내자 정리 발행일」 — **고치기**의 판정
 * ============================================================================
 * 이 판정은 화면과 서버가 **둘 다** 부른다(그 파일 헤더). 그래서 여기서 깨지는
 * 것은 화면 하나가 아니라 두 곳이다.
 *
 * 지키는 것 다섯:
 *
 *  1. 줄 0개 → 만들기, 1개 → 그 줄 고치기, 2개 이상 → 막기.
 *  2. 🔴 **낙관적 잠금 토큰은 그 내자 줄의 version 이다** — 수리 건의 것이
 *     아니다(PO 시스템이 같은 표를 같은 DB 에서 고친다).
 *  3. 🔴 **견적서 잠금 판정을 베껴 적지 않았다** — 내자 정리 표가 쓰는
 *     domesticOrderInlineEditQuoteLock 을 그대로 부른다. 여기만 열면 두 화면이
 *     다르게 동작한다.
 *  4. 🔴 **그리는 판정과 고치는 판정이 서로 어긋나지 않는다** — 「줄이 여럿」을
 *     두 함수가 따로 세므로, 둘이 갈리면 안내는 "여럿"인데 단추는 열려 있는
 *     상태가 된다.
 *  5. 🔴 **「안 보냈다」와 「지웠다」가 갈린다** — 빈 값은 지운 것이고, 키가
 *     없는 것은 사고다. 조용히 null 로 접으면 그 사고가 날짜를 지우는 저장이
 *     된다.
 * ============================================================================
 */

/** 내자 줄 하나 — 고르는 데 쓰는 셋만. */
function editRow(
  overrides: Partial<DomesticOrderIssueDateEditRow> = {}
): DomesticOrderIssueDateEditRow {
  return { id: "row-1", version: 3, quoteId: null, ...overrides };
}

/** 그리는 두 날짜까지 붙은 한 줄 — 조회가 실어 오는 모양 그대로. */
function fullRow(
  overrides: Partial<RepairCaseDomesticOrderIssueDateRow> = {}
): RepairCaseDomesticOrderIssueDateRow {
  return {
    id: "row-1",
    version: 3,
    quoteId: null,
    quoteIssuedDate: null,
    orderIssuedDate: null,
    ...overrides,
  };
}

// ── ① 줄 수가 저장이 할 일을 정한다 ─────────────────────────────────────

describe("줄 수가 저장이 할 일을 정한다", () => {
  test("0개 — 그 자리에서 만든다", () => {
    assert.deepEqual(resolveDomesticOrderIssueDateEditPlan([]), { kind: "CREATE" });
  });

  test("1개 — 그 줄을 고친다. id 와 version 이 그 줄의 것이다", () => {
    const plan = resolveDomesticOrderIssueDateEditPlan([
      editRow({ id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", version: 7 }),
    ]);
    assert.deepEqual(plan, {
      kind: "UPDATE",
      id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      version: 7,
      quoteIssuedDateLocked: false,
    });
  });

  test("🔴 2개 이상 — 막는다. 여럿 중 하나를 골라 고치는 길은 없다", () => {
    const plan = resolveDomesticOrderIssueDateEditPlan([
      editRow({ id: "a" }),
      editRow({ id: "b" }),
      editRow({ id: "c" }),
    ]);
    assert.deepEqual(plan, { kind: "BLOCKED_MULTIPLE", rowCount: 3 });
  });

  test("세 갈래뿐이다 — 화면도 서버도 이 셋만 보고 갈라진다", () => {
    const kinds = [0, 1, 2, 9].map(
      (n) =>
        resolveDomesticOrderIssueDateEditPlan(
          Array.from({ length: n }, (_unused, index) => editRow({ id: `row-${index}` }))
        ).kind
    );
    assert.deepEqual(kinds, ["CREATE", "UPDATE", "BLOCKED_MULTIPLE", "BLOCKED_MULTIPLE"]);
  });
});

// ── ② 🔴 낙관적 잠금 토큰은 내자 줄의 것이다 ───────────────────────────

test("🔴 version 은 그 내자 줄에서 그대로 온다 — 지어내지 않는다", () => {
  for (const version of [1, 2, 41]) {
    const plan = resolveDomesticOrderIssueDateEditPlan([editRow({ version })]);
    assert.equal(plan.kind === "UPDATE" ? plan.version : null, version);
  }
});

test("🔴 만들기 계획에는 version 이 아예 없다 — 보낼 토큰이 없다는 뜻이다", () => {
  // 줄이 없으면 잠글 대상도 없다. 여기에 아무 version 이나(예: 수리 건의 것)
  // 실리면 서버는 "있는 줄을 고치러 왔다"로 읽고 충돌로 막는다.
  assert.deepEqual(Object.keys(resolveDomesticOrderIssueDateEditPlan([])), ["kind"]);
});

test("🔴 이 판정은 수리 건 표를 읽지 않는다 — 잠글 것은 내자 줄이다", () => {
  // repair_cases.version 으로 잠그면 내자 정리 화면(과 PO 시스템)에서 남이 고친
  // 것을 알아채지 못하고 덮어쓴다.
  const code = readFileSync(new URL("./domestic-order-issue-date-edit.ts", import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
  assert.ok(!/repairCases\b|repair_cases/.test(code), "수리 건 표가 이 판정에 들어왔다");
});

// ── ③ 🔴 견적서 잠금은 내자 정리와 같은 판정이다 ───────────────────────

describe("🔴 견적서가 연결된 줄의 견적발행일", () => {
  test("연결이 없으면 잠기지 않는다", () => {
    const plan = resolveDomesticOrderIssueDateEditPlan([editRow({ quoteId: null })]);
    assert.equal(plan.kind === "UPDATE" && plan.quoteIssuedDateLocked, false);
  });

  test("연결이 있으면 잠긴다", () => {
    const plan = resolveDomesticOrderIssueDateEditPlan([editRow({ quoteId: "quote-1" })]);
    assert.equal(plan.kind === "UPDATE" && plan.quoteIssuedDateLocked, true);
  });

  test("내자 정리 표의 판정과 **같은 답**이다 — 같은 함수를 부른다", () => {
    for (const quoteId of [null, "quote-1"]) {
      const plan = resolveDomesticOrderIssueDateEditPlan([editRow({ quoteId })]);
      const tableLock = domesticOrderInlineEditQuoteLock({ quoteId }, "quoteIssuedDate") !== null;
      assert.equal(plan.kind === "UPDATE" && plan.quoteIssuedDateLocked, tableLock, `quoteId=${quoteId}`);
    }
  });

  test("판정을 베껴 적지 않았다 — 원본이 quoteId 를 제 손으로 비교하지 않는다", () => {
    const code = readFileSync(new URL("./domestic-order-issue-date-edit.ts", import.meta.url), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    assert.match(code, /domesticOrderInlineEditQuoteLock\(row, "quoteIssuedDate"\)/);
    assert.ok(
      !/row\.quoteId ===|row\.quoteId !==/.test(code),
      "잠금 규칙을 여기서 새로 적었다 — 두 화면이 갈린다"
    );
  });

  test("발주발행일(PO 발행일)에는 그런 잠금이 없다 — 판정이 견적발행일만 본다", () => {
    assert.equal(domesticOrderInlineEditQuoteLock({ quoteId: "quote-1" }, "orderIssuedDate"), null);
  });

  test("잠금 안내는 내자 정리와 **같은 까닭**을 말한다", () => {
    // 뒷부분(어디서 바꾸는가)만 이 화면에 맞춘다 — 여기에는 `줄 수정` 폼이 없다.
    for (const note of [DOMESTIC_ORDER_QUOTE_LOCK_NOTE, DOMESTIC_ORDER_ISSUE_DATE_QUOTE_LOCK_MESSAGE]) {
      assert.ok(note.includes("연결된 견적서를 따르"), `까닭이 빠졌다: ${note}`);
      assert.ok(note.includes("고칠 수 없습니다"), `막힌다는 말이 빠졌다: ${note}`);
    }
    assert.ok(
      DOMESTIC_ORDER_ISSUE_DATE_QUOTE_LOCK_MESSAGE.includes("견적서를 고치거나"),
      "바꾸는 길을 말하지 않으면 고장으로 읽힌다"
    );
  });
});

// ── ④ 🔴 그리는 판정과 고치는 판정이 어긋나지 않는다 ───────────────────

test("🔴 「줄이 여럿」을 두 함수가 같은 줄 수에서 말한다", () => {
  for (const n of [0, 1, 2, 5]) {
    const rows = Array.from({ length: n }, (_unused, index) => fullRow({ id: `row-${index}` }));
    const display = resolveRepairCaseDomesticOrderDates(rows);
    const plan = resolveDomesticOrderIssueDateEditPlan(rows);
    assert.equal(
      display.kind === "MULTIPLE",
      plan.kind === "BLOCKED_MULTIPLE",
      `줄 ${n}개에서 안내와 단추가 갈렸다`
    );
    assert.equal(display.kind === "NONE", plan.kind === "CREATE", `줄 ${n}개에서 만들기 판정이 갈렸다`);
  }
});

test("줄이 하나면 그리는 값이 **고칠 바로 그 줄**의 값이다", () => {
  // 이것이 여럿을 막는 진짜 까닭이다 — 여럿이면 접어서 그린 값이 다른 줄의
  // 것일 수 있고, 그대로 저장하면 그 날짜가 이 줄에 복사되어 굳는다.
  const row = fullRow({ id: "only", quoteIssuedDate: "2026-01-20", orderIssuedDate: "2026-02-15" });
  const display = resolveRepairCaseDomesticOrderDates([row]);
  const plan = resolveDomesticOrderIssueDateEditPlan([row]);
  assert.equal(plan.kind === "UPDATE" && plan.id, "only");
  assert.equal(display.quoteIssuedDate, row.quoteIssuedDate);
  assert.equal(display.orderIssuedDate, row.orderIssuedDate);
});

// ── ⑤ 🔴 「안 보냈다」와 「지웠다」 ──────────────────────────────────────

describe("🔴 받은 날짜 한 칸을 다듬는다", () => {
  test("빈 값은 **지웠다** — null 로 저장한다", () => {
    for (const value of [null, "", "   "]) {
      assert.deepEqual(
        normalizeDomesticOrderIssueDateInput(value),
        { ok: true, value: null },
        `${JSON.stringify(value)} 가 지운 것으로 읽히지 않았다`
      );
    }
  });

  test("키가 없거나 문자열이 아니면 **거절한다** — 조용히 지우지 않는다", () => {
    for (const value of [undefined, 20260105, {}, ["2026-01-05"]]) {
      const result = normalizeDomesticOrderIssueDateInput(value);
      assert.equal(result.ok, false, `${JSON.stringify(value)} 가 통과했다`);
      if (!result.ok) assert.equal(result.message, DOMESTIC_ORDER_ISSUE_DATE_MISSING_MESSAGE);
    }
  });

  test("YYYY-MM-DD 는 그대로 통과한다 — 앞뒤 공백은 걷는다", () => {
    assert.deepEqual(normalizeDomesticOrderIssueDateInput("2026-01-05"), {
      ok: true,
      value: "2026-01-05",
    });
    assert.deepEqual(normalizeDomesticOrderIssueDateInput(" 2026-01-05 "), {
      ok: true,
      value: "2026-01-05",
    });
  });

  test("형식은 맞아도 **없는 날**은 거절한다", () => {
    // 2026-02-31 은 형식만 보면 통과하고, 그대로 넘기면 Postgres 가 22008 로
    // 거절해 사용자에게는 까닭 없는 실패만 남는다.
    for (const value of ["2026-02-31", "2026-13-01", "2026/01/05", "26-01-05", "오늘"]) {
      const result = normalizeDomesticOrderIssueDateInput(value);
      assert.equal(result.ok, false, `${value} 가 통과했다`);
      if (!result.ok) assert.equal(result.message, DOMESTIC_ORDER_ISSUE_DATE_FORMAT_MESSAGE);
    }
  });

  test("오류 문장에 칸 이름이 없다 — 화면이 그 칸 밑에 붙인다", () => {
    // 이름표는 주간보고와 맞춰 둔 글자라 이 파일이 들고 있을 값이 아니다.
    for (const message of [
      DOMESTIC_ORDER_ISSUE_DATE_FORMAT_MESSAGE,
      DOMESTIC_ORDER_ISSUE_DATE_MISSING_MESSAGE,
    ]) {
      assert.ok(!message.includes("견적"), `칸 이름이 문장에 들어갔다: ${message}`);
      assert.ok(!message.includes("PO"), `칸 이름이 문장에 들어갔다: ${message}`);
    }
  });
});

// ── 안내 글자 ───────────────────────────────────────────────────────────

describe("거절할 때 하는 말", () => {
  test("줄이 여럿이면 **어디서 고치는지**를 말한다", () => {
    assert.ok(DOMESTIC_ORDER_ISSUE_DATE_MULTIPLE_ROWS_MESSAGE.includes("내자 정리"));
    assert.ok(DOMESTIC_ORDER_ISSUE_DATE_MULTIPLE_ROWS_MESSAGE.includes("여럿"));
  });

  test("둘 다 비었으면 **왜 안 만들었는지**를 말한다", () => {
    assert.ok(DOMESTIC_ORDER_ISSUE_DATE_BOTH_EMPTY_MESSAGE.includes("하나 이상"));
  });

  test("세 문장이 서로 다른 말이다", () => {
    const messages = new Set([
      DOMESTIC_ORDER_ISSUE_DATE_MULTIPLE_ROWS_MESSAGE,
      DOMESTIC_ORDER_ISSUE_DATE_BOTH_EMPTY_MESSAGE,
      DOMESTIC_ORDER_ISSUE_DATE_QUOTE_LOCK_MESSAGE,
    ]);
    assert.equal(messages.size, 3);
  });
});
