import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  checkDomesticOrderCompletionLock,
  domesticOrderDueDateRowEditBlockReason,
  domesticOrderLineEditBlockReason,
  domesticOrderLinkedFieldLockedMessage,
  DOMESTIC_ORDER_COMPLETED_LOCK_MESSAGE,
  DOMESTIC_ORDER_LINE_COMPLETED_MESSAGE,
  type DomesticOrderCompletionLockRow,
  type DomesticOrderCompletionLockStoredRow,
} from "./domestic-order-completion-lock";

/**
 * ============================================================================
 * 🔴 **완료된 것은 잠근다** — 그 판정 하나 (2026-11-08)
 * ============================================================================
 * DB 도 React 도 없는 순수 함수라 갈림을 전부 여기서 센다. 진짜 저장 통로 셋이
 * 실제로 막는가는 db.txt 쪽(mutations/domestic-order-completion-lock…)이 본다.
 *
 * 🔵 **「되는 경우」를 같은 자리에 붙인다** — 「막힌다」만 재면 울타리를 너무 넓게
 * 친 날에도 초록이다. 이 파일이 쌍으로 재는 것 셋:
 *  · 줄이 완료면 막힌다  ↔  완료가 아니면 통과한다.
 *  · 완료된 회차의 네 칸을 바꾸면 막힌다  ↔  **다른 회차**를 바꾸면 통과한다.
 *  · 완료된 회차를 **그대로 되실어 보내면** 통과한다(화면이 늘 하는 일이다).
 * ============================================================================
 */

function row(overrides: Partial<DomesticOrderCompletionLockRow> = {}): DomesticOrderCompletionLockRow {
  return { dueDate: "2096-01-20", note: null, deliveredDate: null, deliveredBy: null, ...overrides };
}

function stored(
  overrides: Partial<DomesticOrderCompletionLockStoredRow> = {}
): DomesticOrderCompletionLockStoredRow {
  return { ...row(), isCompleted: false, ...overrides };
}

describe("줄 전체가 완료면 — 무엇을 보냈든 거절이다", () => {
  test("🔴 줄이 완료면 막힌다", () => {
    const guard = checkDomesticOrderCompletionLock({
      lineCompleted: true,
      storedRows: [stored()],
      nextRows: [row()],
    });
    assert.equal(guard.ok, false, "완료된 줄의 저장이 통과했다");
    if (guard.ok) return;
    assert.equal(guard.reason, "LINE_COMPLETED");
    // 🔴 줄 전체가 잠긴 것은 **어느 한 칸의 문제가 아니다** — 칸 이름을 달면 그 칸만
    //    문제인 것으로 읽힌다.
    assert.equal(guard.field, null);
    assert.equal(guard.message, DOMESTIC_ORDER_LINE_COMPLETED_MESSAGE);
  });

  test("🔴 **아무것도 안 바꾼 저장도** 막힌다 — 값을 견주지 않는다", () => {
    const rows = [stored({ dueDate: "2096-02-01", note: "1차분" })];
    const guard = checkDomesticOrderCompletionLock({
      lineCompleted: true,
      storedRows: rows,
      nextRows: [row({ dueDate: "2096-02-01", note: "1차분" })],
    });
    assert.equal(guard.ok, false, "완료된 줄에서 「안 바뀐 저장」이 통과했다");
  });

  test("🔵 완료가 아니면 통과한다 — 「막힌다」가 공짜로 나오지 않는다", () => {
    const guard = checkDomesticOrderCompletionLock({
      lineCompleted: false,
      storedRows: [stored()],
      nextRows: [row({ dueDate: "2096-03-03", note: "고친 메모" })],
    });
    assert.equal(guard.ok, true, "완료도 아닌 줄이 막혔다");
  });

  test("🔴 첫 문장은 **사용자가 못 박은 그대로**이고, 뒤에 할 일이 붙는다", () => {
    assert.equal(
      DOMESTIC_ORDER_COMPLETED_LOCK_MESSAGE,
      "내자정리에서 완료 상태이므로 수정이 불가능합니다."
    );
    assert.ok(
      DOMESTIC_ORDER_LINE_COMPLETED_MESSAGE.startsWith(DOMESTIC_ORDER_COMPLETED_LOCK_MESSAGE),
      "막는 말이 사용자가 못 박은 문장으로 시작하지 않는다"
    );
    assert.ok(
      DOMESTIC_ORDER_LINE_COMPLETED_MESSAGE.includes("[완료 해제]"),
      "무엇을 먼저 눌러야 하는지가 빠졌다 — 막다른 길로 읽힌다"
    );
  });
});

describe("회차 하나가 완료면 — 그 회차의 네 칸만 잠긴다", () => {
  /** 1차가 완료된 두 회차짜리 기타건. 🔵 모든 시험이 이 모양에서 시작한다. */
  const storedRows: DomesticOrderCompletionLockStoredRow[] = [
    stored({ dueDate: "2096-01-20", note: "1차분", deliveredDate: "2096-01-25", deliveredBy: "홍길동", isCompleted: true }),
    stored({ dueDate: "2096-02-20", note: "2차분" }),
  ];
  /** 저장돼 있는 모양을 그대로 되실어 보낸 목록 — 화면이 늘 하는 일이다. */
  const unchanged: DomesticOrderCompletionLockRow[] = storedRows.map(
    ({ dueDate, note, deliveredDate, deliveredBy }) => ({ dueDate, note, deliveredDate, deliveredBy })
  );

  test("🔵 **못** — 표본의 1차가 정말 완료이고 2차는 아니다", () => {
    assert.equal(storedRows[0].isCompleted, true, "표본의 1차가 완료가 아니다");
    assert.equal(storedRows[1].isCompleted, false, "표본의 2차까지 완료라 「다른 회차」를 잴 수 없다");
  });

  test("🔵 그대로 되실어 보내면 통과한다 — 아니면 완료된 줄은 아무것도 못 고친다", () => {
    const guard = checkDomesticOrderCompletionLock({
      lineCompleted: false,
      storedRows,
      nextRows: unchanged,
    });
    assert.equal(guard.ok, true, "안 바뀐 저장이 막혔다");
  });

  for (const [label, patch] of [
    ["납기요청일", { dueDate: "2096-01-21" }],
    ["비고", { note: "고친 메모" }],
    ["납품일", { deliveredDate: "2096-01-26" }],
    ["납품자", { deliveredBy: "다른 사람" }],
  ] as const) {
    test(`🔴 완료된 1차의 ${label}를 바꾸면 막힌다`, () => {
      const guard = checkDomesticOrderCompletionLock({
        lineCompleted: false,
        storedRows,
        nextRows: [{ ...unchanged[0], ...patch }, unchanged[1]],
      });
      assert.equal(guard.ok, false, `완료된 회차의 ${label}가 그대로 바뀌었다`);
      if (guard.ok) return;
      assert.equal(guard.reason, "DUE_DATE_ROW_COMPLETED");
      // 목록 전체의 문제라 칸 이름은 `dueDates` 하나다(조각 A 의 울타리와 같다).
      assert.equal(guard.field, "dueDates");
      assert.ok(guard.message.startsWith(DOMESTIC_ORDER_COMPLETED_LOCK_MESSAGE));
      // 🔴 **몇 차인지**와 **무엇을 눌러야 하는지**가 글에 있어야 한다.
      assert.ok(guard.message.includes("1차 · 납기 2096-01-20 (1차분)"), guard.message);
      assert.ok(guard.message.includes("[1차 해제]"), guard.message);
    });
  }

  for (const [label, patch] of [
    ["납기요청일", { dueDate: "2096-02-21" }],
    ["비고", { note: "2차 메모를 고친다" }],
    ["납품일", { deliveredDate: "2096-02-25" }],
    ["납품자", { deliveredBy: "2차 납품자" }],
  ] as const) {
    test(`🔵 완료가 아닌 2차의 ${label}는 그대로 고쳐진다`, () => {
      const guard = checkDomesticOrderCompletionLock({
        lineCompleted: false,
        storedRows,
        nextRows: [unchanged[0], { ...unchanged[1], ...patch }],
      });
      assert.equal(guard.ok, true, `완료되지 않은 회차의 ${label}가 막혔다`);
    });
  }

  test("🔵 **빈 값의 모양 차이는 「바뀌었다」가 아니다** — 공백·빈 글자·null 이 한 뜻이다", () => {
    // 🔴 이것을 접지 않으면, 비고에 공백 한 칸이 섞인 회차 하나가 **그 줄의 다른
    //    칸을 고치는 저장까지** 막는다(화면은 저장된 값을 그대로 되실어 보내는데
    //    검증이 그것을 다듬어 「바뀌었다」가 된다). 사람은 까닭도 고칠 길도 없다.
    const untrimmed: DomesticOrderCompletionLockStoredRow[] = [
      stored({ dueDate: "2096-01-20", note: "  1차분  ", deliveredBy: "", isCompleted: true }),
    ];
    const guard = checkDomesticOrderCompletionLock({
      lineCompleted: false,
      storedRows: untrimmed,
      // 저장 검증이 다듬어 놓은 모양 — 화면이 되실어 보내면 이렇게 들어온다.
      nextRows: [row({ dueDate: "2096-01-20", note: "1차분", deliveredBy: null })],
    });
    assert.equal(guard.ok, true, "빈 값의 모양 차이가 「바뀌었다」로 읽혔다");
  });

  test("🔵 **회차를 뒤에 더하는 저장**은 통과한다 — 앞 자리는 그대로다", () => {
    const guard = checkDomesticOrderCompletionLock({
      lineCompleted: false,
      storedRows,
      nextRows: [...unchanged, row({ dueDate: "2096-03-20", note: "3차분" })],
    });
    assert.equal(guard.ok, true, "회차를 더하는 저장이 막혔다");
  });

  test("🔴 **자리가 밀리면 막힌다** — 보내온 목록이 더 짧으면 그 회차를 잃는다", () => {
    // 🔵 이 길은 조각 A 의 셋째 울타리가 먼저 거절한다(완료된 회차가 있으면 줄을 못
    //    줄인다). 그래도 여기서 한 번 더 막는 것은, 그 차례가 언젠가 뒤바뀌어도 이
    //    판정이 조용히 통과하지 않게 하기 위해서다.
    const guard = checkDomesticOrderCompletionLock({
      lineCompleted: false,
      storedRows,
      nextRows: [],
    });
    assert.equal(guard.ok, false, "완료된 회차가 통째로 사라지는 저장이 통과했다");
    if (guard.ok) return;
    assert.equal(guard.reason, "DUE_DATE_ROW_COMPLETED");
  });

  test("🔴 **먼저 막히는 회차를 말한다** — 둘 다 완료면 1차 이름이 나온다", () => {
    const bothCompleted = storedRows.map((entry) => ({ ...entry, isCompleted: true }));
    const guard = checkDomesticOrderCompletionLock({
      lineCompleted: false,
      storedRows: bothCompleted,
      nextRows: unchanged.map((entry) => ({ ...entry, note: "둘 다 고친다" })),
    });
    assert.equal(guard.ok, false);
    if (guard.ok) return;
    assert.ok(guard.message.includes("[1차 해제]"), guard.message);
    assert.ok(!guard.message.includes("[2차 해제]"), "두 회차를 한꺼번에 말하고 있다");
  });
});

describe("화면이 쓰는 두 물음 — 서버와 **같은 함수**에 묻는다", () => {
  test("🔴 완료된 줄의 편집칸은 막히고, 완료가 아니면 열린다", () => {
    assert.equal(
      domesticOrderLineEditBlockReason({ completedAt: new Date("2096-01-20T00:00:00.000Z") }),
      DOMESTIC_ORDER_LINE_COMPLETED_MESSAGE
    );
    assert.equal(domesticOrderLineEditBlockReason({ completedAt: null }), null);
  });

  test("🔴 완료된 회차의 입력칸은 막히고, 완료가 아니면 열린다", () => {
    const blocked = domesticOrderDueDateRowEditBlockReason({
      rowOrder: 2,
      row: { dueDate: "2096-02-20", note: "2차분", isCompleted: true },
    });
    assert.ok(blocked !== null, "완료된 회차의 칸이 열려 있다");
    assert.ok(blocked.includes("2차 · 납기 2096-02-20 (2차분)"), blocked);
    assert.ok(blocked.includes("[2차 해제]"), blocked);
    assert.equal(
      domesticOrderDueDateRowEditBlockReason({
        rowOrder: 2,
        row: { dueDate: "2096-02-20", note: "2차분", isCompleted: false },
      }),
      null,
      "완료되지 않은 회차의 칸이 막혔다"
    );
  });

  test("🔵 **날짜가 아직 빈 회차**에서도 글이 안 깨진다", () => {
    const blocked = domesticOrderDueDateRowEditBlockReason({
      rowOrder: 1,
      row: { dueDate: null, note: null, isCompleted: true },
    });
    assert.ok(blocked !== null);
    assert.ok(blocked.includes("(날짜 없음)"), blocked);
  });
});

describe("수리 건 상세에서 막는 말 — **어느 줄인지**를 말한다", () => {
  test("🔴 발주서번호가 있으면 그 번호를 적는다", () => {
    const message = domesticOrderLinkedFieldLockedMessage({ purchaseOrderNumber: "PO-TEST-0001" });
    assert.ok(message.startsWith(DOMESTIC_ORDER_COMPLETED_LOCK_MESSAGE), message);
    assert.ok(message.includes("발주서번호 PO-TEST-0001"), message);
    // 🔴 막힌 칸이 **그 둘뿐**이라는 사실이 글에 있어야 한다 — 없으면 사람은 수리 건이
    //    통째로 잠긴 것으로 읽는다.
    assert.ok(message.includes("고객 요청 납기일"), message);
    assert.ok(message.includes("실제 출하일"), message);
    assert.ok(message.includes("[완료 해제]"), message);
  });

  test("🔵 발주서번호가 비어 있어도 글이 안 깨진다", () => {
    for (const value of [null, "", "   "]) {
      const message = domesticOrderLinkedFieldLockedMessage({ purchaseOrderNumber: value });
      assert.ok(message.includes("발주서번호가 비어 있는 줄"), `${value}: ${message}`);
      assert.ok(!message.includes("()"), `빈 괄호가 남았다: ${message}`);
    }
  });
});
