import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_MY_WORK_SORT,
  sortMyActiveWorkRows,
  sortMyActiveWorkRowsBy,
} from "./my-active-work-sort";
import type { MyActiveWorkRow } from "@/lib/db/queries/repair-cases-mine";

function row(overrides: Partial<MyActiveWorkRow>): MyActiveWorkRow {
  return {
    id: overrides.id ?? "id",
    intakeNumber: "D260101",
    receivedAt: "2026-01-01",
    customerId: "cust-1",
    customerName: "고객사",
    endUserName: null,
    productCategory: "Matcher",
    billingType: "PAID",
    modelName: "M",
    serialNumber: "S",
    lotNumber: "L",
    status: "IN_REPAIR",
    currentWorkflowStepLabel: "수리",
    exceptionStatus: null,
    internalTargetInspectionCompletionDate: null,
    internalTargetShipmentDate: null,
    customerRequestedDueDate: null,
    domesticOrderDueDates: [],
    lastActivityAt: null,
    lastWorkRecordAt: null,
    activePartsRequestStatus: null,
    ...overrides,
  };
}

test("sorts by internalTargetShipmentDate ascending, soonest first", () => {
  const rows = [
    row({ id: "late", internalTargetShipmentDate: "2026-09-01" }),
    row({ id: "soon", internalTargetShipmentDate: "2026-08-15" }),
    row({ id: "mid", internalTargetShipmentDate: "2026-08-20" }),
  ];
  const sorted = sortMyActiveWorkRows(rows).map((r) => r.id);
  assert.deepEqual(sorted, ["soon", "mid", "late"]);
});

test("rows with no internalTargetShipmentDate sort after every dated row (nulls last)", () => {
  const rows = [
    row({ id: "no-target", internalTargetShipmentDate: null }),
    row({ id: "dated", internalTargetShipmentDate: "2026-12-31" }),
  ];
  const sorted = sortMyActiveWorkRows(rows).map((r) => r.id);
  assert.deepEqual(sorted, ["dated", "no-target"]);
});

test("tie-break 1: same target date -> older receivedAt first", () => {
  const rows = [
    row({ id: "newer-intake", internalTargetShipmentDate: "2026-08-20", receivedAt: "2026-08-05" }),
    row({ id: "older-intake", internalTargetShipmentDate: "2026-08-20", receivedAt: "2026-08-01" }),
  ];
  const sorted = sortMyActiveWorkRows(rows).map((r) => r.id);
  assert.deepEqual(sorted, ["older-intake", "newer-intake"]);
});

test("tie-break 2: same target date and same receivedAt -> intakeNumber decides, always deterministic", () => {
  const rows = [
    row({ id: "b", intakeNumber: "D260102", internalTargetShipmentDate: "2026-08-20", receivedAt: "2026-08-01" }),
    row({ id: "a", intakeNumber: "D260101", internalTargetShipmentDate: "2026-08-20", receivedAt: "2026-08-01" }),
  ];
  const sorted = sortMyActiveWorkRows(rows).map((r) => r.id);
  assert.deepEqual(sorted, ["a", "b"]);
});

test("never mutates the input array", () => {
  const rows = [row({ id: "1", internalTargetShipmentDate: "2026-09-01" }), row({ id: "2", internalTargetShipmentDate: "2026-08-01" })];
  const original = [...rows];
  sortMyActiveWorkRows(rows);
  assert.deepEqual(rows, original);
});

// ─────────────────────────────────────────── 2026-08-19 열 머리글 정렬

test("아무 머리글도 누르지 않은 상태(default)는 기존 급한 순 정렬 그대로다", () => {
  const rows = [
    row({ id: "late", intakeNumber: "D1", internalTargetShipmentDate: "2026-09-01" }),
    row({ id: "soon", intakeNumber: "D2", internalTargetShipmentDate: "2026-08-20" }),
    row({ id: "none", intakeNumber: "D3", internalTargetShipmentDate: null }),
  ];
  assert.deepEqual(
    sortMyActiveWorkRowsBy(rows, DEFAULT_MY_WORK_SORT).map((r) => r.id),
    sortMyActiveWorkRows(rows).map((r) => r.id)
  );
});

test("열을 고르면 그 열로 오름차순 정렬한다", () => {
  const rows = [row({ id: "b", customerName: "동해정밀" }), row({ id: "a", customerName: "가온전자" })];
  const sorted = sortMyActiveWorkRowsBy(rows, { column: "customerName", direction: "asc" });
  assert.deepEqual(sorted.map((r) => r.id), ["a", "b"]);
});

test("값이 같으면 인수번호로 순서를 매듭짓는다", () => {
  const rows = [
    row({ id: "second", intakeNumber: "D260902", customerName: "가온전자" }),
    row({ id: "first", intakeNumber: "D260901", customerName: "가온전자" }),
  ];
  const sorted = sortMyActiveWorkRowsBy(rows, { column: "customerName", direction: "asc" });
  assert.deepEqual(sorted.map((r) => r.id), ["first", "second"]);
});

test("내림차순에서도 값 없는 행은 맨 뒤에 남는다", () => {
  // 값 없음이 맨 위로 올라오면 목록 첫 화면이 정보 없는 행으로 채워진다.
  const rows = [
    row({ id: "early", intakeNumber: "D1", customerRequestedDueDate: "2026-08-20" }),
    row({ id: "none", intakeNumber: "D2", customerRequestedDueDate: null }),
    row({ id: "late", intakeNumber: "D3", customerRequestedDueDate: "2026-09-10" }),
  ];
  const sorted = sortMyActiveWorkRowsBy(rows, { column: "customerRequestedDueDate", direction: "desc" });
  assert.deepEqual(sorted.map((r) => r.id), ["late", "early", "none"]);
});

test("정렬은 원본 배열을 건드리지 않는다", () => {
  const rows = [row({ id: "b", customerName: "동해정밀" }), row({ id: "a", customerName: "가온전자" })];
  sortMyActiveWorkRowsBy(rows, { column: "customerName", direction: "asc" });
  assert.deepEqual(rows.map((r) => r.id), ["b", "a"]);
});

// ──────────────────────── 2026-10-19 고객 요청 납기일은 **보이는 날짜**로 선다

/**
 * ============================================================================
 * 자기 칸이 비면 이 화면도 내자 정리에서 날짜를 빌려 그린다
 * ============================================================================
 * 전체 A/S 현황과 같은 조각을 쓴다(components/repair-cases/RequestedDueDateValue.tsx
 * → domain/requested-due-date-link.ts). 그리는 값이 바뀌었으면 **줄 서는 차례도
 * 함께** 바뀌어야 한다 — 안 그러면 화면에 2026-10-20 이라고 적힌 줄이 "값 없음"
 * 자리(맨 뒤)로 가서 선다. 값이 안 나오는 것보다 더 나쁜 결함이다.
 *
 * 🔵 이 화면의 널 처리는 전체 A/S 현황과 다르다 — **방향과 무관하게 늘 맨 뒤**다
 * (my-active-work-sort.ts 의 주석). 그 성질은 그대로 두고, "무엇이 널인가"만
 * 달라진다: 양쪽 다 없는 건만 널이다.
 * ============================================================================
 */
test("🔴 자기 칸이 빈 건은 내자에서 빌려 온 날짜 자리에 줄 선다 — 맨 뒤가 아니다", () => {
  const rows = [
    row({ id: "own-early", intakeNumber: "D1", customerRequestedDueDate: "2026-09-05" }),
    // 빌려 올 날짜 중 가장 이른 하루는 2026-10-20 — 위아래 두 건 **사이**다.
    // 원본 칸으로 세우면 이 줄은 널로 보여 어느 방향에서도 맨 뒤로 밀린다.
    row({
      id: "borrowed",
      intakeNumber: "D2",
      customerRequestedDueDate: null,
      domesticOrderDueDates: ["2026-11-20", "2026-10-20"],
    }),
    row({ id: "own-late", intakeNumber: "D3", customerRequestedDueDate: "2026-12-01" }),
  ];

  assert.deepEqual(
    sortMyActiveWorkRowsBy(rows, { column: "customerRequestedDueDate", direction: "asc" }).map((r) => r.id),
    ["own-early", "borrowed", "own-late"],
    "오름차순에서 빌려 온 줄이 제 날짜 자리에 서지 않았다"
  );
  assert.deepEqual(
    sortMyActiveWorkRowsBy(rows, { column: "customerRequestedDueDate", direction: "desc" }).map((r) => r.id),
    ["own-late", "borrowed", "own-early"],
    "내림차순에서 빌려 온 줄이 제 날짜 자리에 서지 않았다"
  );
});

test("🔴 자기 칸이 적혀 있으면 그 값이 이긴다 — 내자 날짜가 더 일러도 끌려가지 않는다", () => {
  const rows = [
    // 내자 날짜(2026-01-02)가 훨씬 이르다. 빌려 온 것이 이기면 이 줄이 맨 앞으로 온다.
    row({
      id: "own-wins",
      intakeNumber: "D1",
      customerRequestedDueDate: "2026-12-01",
      domesticOrderDueDates: ["2026-01-02"],
    }),
    row({ id: "mid", intakeNumber: "D2", customerRequestedDueDate: "2026-06-01" }),
  ];

  assert.deepEqual(
    sortMyActiveWorkRowsBy(rows, { column: "customerRequestedDueDate", direction: "asc" }).map((r) => r.id),
    ["mid", "own-wins"],
    "자기 칸이 있는데도 내자 날짜로 줄을 세웠다"
  );
});

test("양쪽 어디에도 날짜가 없는 행만 맨 뒤로 간다 — 예전 그대로다", () => {
  const rows = [
    row({ id: "none", intakeNumber: "D1", customerRequestedDueDate: null, domesticOrderDueDates: [] }),
    row({ id: "dated", intakeNumber: "D2", customerRequestedDueDate: "2026-09-01" }),
  ];

  for (const direction of ["asc", "desc"] as const) {
    assert.deepEqual(
      sortMyActiveWorkRowsBy(rows, { column: "customerRequestedDueDate", direction }).map((r) => r.id),
      ["dated", "none"],
      `${direction} 에서 값 없는 행이 맨 뒤에 남지 않았다`
    );
  }
});

// ──────────────────────────────── 2026-10-06 작업기록이 적힌 시각 순으로 정렬

const WORK_RECORD_ROWS = [
  row({ id: "oldest", intakeNumber: "D1", lastWorkRecordAt: "2026-09-01T01:00:00.000Z" }),
  row({ id: "never", intakeNumber: "D2", lastWorkRecordAt: null }),
  row({ id: "newest", intakeNumber: "D3", lastWorkRecordAt: "2026-10-05T23:00:00.000Z" }),
  row({ id: "middle", intakeNumber: "D4", lastWorkRecordAt: "2026-09-30T09:00:00.000Z" }),
];

test("작업기록 열은 처음 누르면(asc) 최근에 적힌 건이 맨 위로 온다", () => {
  // 이 열만 방향이 반대다 — "요즘 손댄 것부터 보자"가 이 열을 누르는 이유라서
  // 오름차순(옛날 것 먼저)으로 시작하면 누른 보람이 없다.
  const sorted = sortMyActiveWorkRowsBy(WORK_RECORD_ROWS, { column: "lastWorkRecordAt", direction: "asc" });
  assert.deepEqual(sorted.map((r) => r.id), ["newest", "middle", "oldest", "never"]);
});

test("작업기록 열을 한 번 더 누르면(desc) 오래된 건이 맨 위로 온다", () => {
  const sorted = sortMyActiveWorkRowsBy(WORK_RECORD_ROWS, { column: "lastWorkRecordAt", direction: "desc" });
  assert.deepEqual(sorted.map((r) => r.id), ["oldest", "middle", "newest", "never"]);
});

test("작업기록이 한 번도 없는 건은 방향과 무관하게 늘 맨 뒤에 남는다", () => {
  for (const direction of ["asc", "desc"] as const) {
    const sorted = sortMyActiveWorkRowsBy(WORK_RECORD_ROWS, { column: "lastWorkRecordAt", direction });
    assert.equal(sorted.at(-1)!.id, "never", `${direction}에서도 작업기록 없는 건이 맨 뒤여야 한다`);
  }
});

test("작업기록이 없는 건이 여럿이면 그들끼리는 인수번호로 순서를 매듭짓는다", () => {
  const rows = [
    row({ id: "none-b", intakeNumber: "D9", lastWorkRecordAt: null }),
    row({ id: "written", intakeNumber: "D5", lastWorkRecordAt: "2026-10-01T00:00:00.000Z" }),
    row({ id: "none-a", intakeNumber: "D7", lastWorkRecordAt: null }),
  ];
  const sorted = sortMyActiveWorkRowsBy(rows, { column: "lastWorkRecordAt", direction: "asc" });
  assert.deepEqual(sorted.map((r) => r.id), ["written", "none-a", "none-b"]);
});

test("같은 열을 세 번 누르면 기본 정렬(급한 순)로 돌아온다", () => {
  // 세 번째 누름이 DEFAULT_MY_WORK_SORT로 되돌리는 토글 자체는
  // MyActiveWorkScreen.tsx에 있다. 여기서 확인하는 것은 그 세 상태가 실제로
  // 세 가지 다른 줄 세우기를 만들고, 마지막이 원래의 급한 순과 같다는 것이다.
  const rows = [
    row({ id: "urgent", intakeNumber: "D1", internalTargetShipmentDate: "2026-08-10", lastWorkRecordAt: "2026-09-01T00:00:00.000Z" }),
    row({ id: "later", intakeNumber: "D2", internalTargetShipmentDate: "2026-12-31", lastWorkRecordAt: "2026-10-05T00:00:00.000Z" }),
  ];
  const firstPress = sortMyActiveWorkRowsBy(rows, { column: "lastWorkRecordAt", direction: "asc" }).map((r) => r.id);
  const secondPress = sortMyActiveWorkRowsBy(rows, { column: "lastWorkRecordAt", direction: "desc" }).map((r) => r.id);
  const thirdPress = sortMyActiveWorkRowsBy(rows, DEFAULT_MY_WORK_SORT).map((r) => r.id);

  assert.deepEqual(firstPress, ["later", "urgent"], "처음 누르면 최근 작업기록이 위");
  assert.deepEqual(secondPress, ["urgent", "later"], "두 번째는 오래된 작업기록이 위");
  assert.deepEqual(thirdPress, sortMyActiveWorkRows(rows).map((r) => r.id), "세 번째는 기본(급한 순) 그대로");
  assert.deepEqual(thirdPress, ["urgent", "later"]);
});

test("작업기록 열을 더해도 기본 정렬의 뜻은 그대로다", () => {
  // 기본 정렬은 목표 출하일 → 인수일 → 인수번호다. 작업기록 시각이 아무리
  // 최근이어도 기본 상태의 순서를 흔들면 안 된다.
  const rows = [
    row({ id: "soon", intakeNumber: "D1", internalTargetShipmentDate: "2026-08-15", lastWorkRecordAt: null }),
    row({ id: "late", intakeNumber: "D2", internalTargetShipmentDate: "2026-09-01", lastWorkRecordAt: "2026-10-05T00:00:00.000Z" }),
  ];
  assert.deepEqual(sortMyActiveWorkRowsBy(rows, DEFAULT_MY_WORK_SORT).map((r) => r.id), ["soon", "late"]);
});

test("작업기록 열은 lastActivityAt이 아니라 lastWorkRecordAt으로 줄을 세운다", () => {
  // 상태만 옮긴 건은 "마지막 활동"이 최근이어도 작업기록은 옛날 것이다 —
  // 두 값이 엇갈릴 때 어느 쪽을 보는지가 이 열의 전부다.
  const rows = [
    row({
      id: "moved-but-unwritten",
      intakeNumber: "D1",
      lastActivityAt: "2026-10-06T00:00:00.000Z",
      lastWorkRecordAt: "2026-01-01T00:00:00.000Z",
    }),
    row({
      id: "written-recently",
      intakeNumber: "D2",
      lastActivityAt: "2026-02-01T00:00:00.000Z",
      lastWorkRecordAt: "2026-02-01T00:00:00.000Z",
    }),
  ];
  const sorted = sortMyActiveWorkRowsBy(rows, { column: "lastWorkRecordAt", direction: "asc" });
  assert.deepEqual(sorted.map((r) => r.id), ["written-recently", "moved-but-unwritten"]);
});
