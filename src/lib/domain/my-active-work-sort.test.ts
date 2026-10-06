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
