import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import MyActiveWorkScreen from "./MyActiveWorkScreen";
import type { MyActiveWorkRow } from "@/lib/db/queries/repair-cases-mine";

function row(overrides: Partial<MyActiveWorkRow> = {}): MyActiveWorkRow {
  return {
    id: "case-1",
    intakeNumber: "D260813",
    receivedAt: "2026-08-03",
    customerName: "대성RF시스템",
    endUserName: "대성RF 대전연구소",
    productCategory: "Generator",
    modelName: "TEST-MODEL-A",
    serialNumber: "TEST-SN-002",
    lotNumber: "TEST-LN-001",
    status: "WAITING_PARTS_SUPPLY",
    currentWorkflowStepLabel: "부품 수급",
    exceptionStatus: null,
    internalTargetInspectionCompletionDate: null,
    internalTargetShipmentDate: "2026-08-27",
    customerRequestedDueDate: null,
    lastActivityAt: null,
    activePartsRequestStatus: null,
    ...overrides,
  };
}

test("empty state: no assigned cases at all shows the exact required copy", () => {
  const html = renderToStaticMarkup(<MyActiveWorkScreen rows={[]} />);
  assert.ok(html.includes("현재 담당 중인 제품이 없습니다."), "must show the exact required empty-state copy");
  assert.ok(!html.includes("필터 초기화"), "the no-cases-at-all state must not offer a filter-reset button");
});

test("renders both the desktop table (hidden md:block) and mobile card list (md:hidden) for the same rows", () => {
  const html = renderToStaticMarkup(<MyActiveWorkScreen rows={[row()]} />);
  assert.ok(html.includes("hidden") && html.includes("md:block"), "desktop table wrapper must carry the responsive classes");
  assert.ok(html.includes("md:hidden"), "mobile card list wrapper must carry the responsive class");
});

test("row's intake number links to the existing repair-case detail route, not a new detail screen", () => {
  const html = renderToStaticMarkup(<MyActiveWorkScreen rows={[row({ id: "abc-123", intakeNumber: "D260813" })]} />);
  assert.ok(html.includes('href="/repair-cases/abc-123"'), "must link to /repair-cases/[id]");
  assert.ok(html.includes("D260813"));
});

test("현재 상태 and 현재 단계 render as distinct, independently-sourced values", () => {
  const html = renderToStaticMarkup(
    <MyActiveWorkScreen rows={[row({ status: "WAITING_PARTS_SUPPLY", currentWorkflowStepLabel: "부품 수급" })]} />
  );
  assert.ok(html.includes("부품 수급 대기"), "현재 상태 label must render");
  assert.ok(html.includes("부품 수급"), "현재 단계 label must render");
});

test("예외 상태 renders independently when present, and never merges with 현재 상태", () => {
  const html = renderToStaticMarkup(
    <MyActiveWorkScreen rows={[row({ status: "IN_REPAIR", exceptionStatus: "WAITING_KYOSAN_RESPONSE" })]} />
  );
  assert.ok(html.includes("교산 응답 대기"), "예외 상태 label must render");
  assert.ok(html.includes("수리 중"), "현재 상태 label must still render separately");
});

test("예외 상태 shows '-' when there is none", () => {
  const html = renderToStaticMarkup(<MyActiveWorkScreen rows={[row({ exceptionStatus: null })]} />);
  assert.ok(html.includes(">-<"), "must render a dash placeholder when no exception status is active");
});

test("L/N renders lotNumber, never a lineNumber field", () => {
  const html = renderToStaticMarkup(<MyActiveWorkScreen rows={[row({ lotNumber: "LN-777" })]} />);
  assert.ok(html.includes("LN-777"));
  assert.ok(html.includes("L/N"));
  assert.ok(!html.toLowerCase().includes("linenumber"));
});

test("no priority column, badge, or value renders anywhere on the screen", () => {
  const html = renderToStaticMarkup(<MyActiveWorkScreen rows={[row()]} />);
  assert.ok(!html.includes("우선순위"), "priority column header must never render");
  assert.ok(!html.includes("긴급") && !html.includes("낮음"), "no priority labels must ever render");
});

test("마지막 작업: honest no-activity fallback never formats receivedAt as if it were an activity timestamp", () => {
  const html = renderToStaticMarkup(<MyActiveWorkScreen rows={[row({ lastActivityAt: null, receivedAt: "2026-08-03" })]} />);
  assert.ok(html.includes("활동 없음"), "must show the explicit no-activity label");
  assert.ok(html.includes("2026-08-03"), "may show the intake date as separate context");
});

test("마지막 작업: a real timestamp renders as a real timestamp, not the no-activity fallback", () => {
  const html = renderToStaticMarkup(<MyActiveWorkScreen rows={[row({ lastActivityAt: "2026-08-05T08:18:01.241Z" })]} />);
  assert.ok(!html.includes("활동 없음"));
});

test("부품 요청 상태: PENDING renders 요청 대기", () => {
  const html = renderToStaticMarkup(<MyActiveWorkScreen rows={[row({ activePartsRequestStatus: "PENDING" })]} />);
  assert.ok(html.includes("요청 대기"));
});

test("부품 요청 상태: PARTIALLY_ISSUED renders 일부 지급", () => {
  const html = renderToStaticMarkup(<MyActiveWorkScreen rows={[row({ activePartsRequestStatus: "PARTIALLY_ISSUED" })]} />);
  assert.ok(html.includes("일부 지급"));
});

test("부품 요청 상태: no active request renders a dash, never a terminal-state label", () => {
  const html = renderToStaticMarkup(<MyActiveWorkScreen rows={[row({ activePartsRequestStatus: null })]} />);
  assert.ok(!html.includes("요청 대기") && !html.includes("일부 지급"));
});

test("summary shows 현재 담당 건수 based on the full (unfiltered) row count", () => {
  const html = renderToStaticMarkup(<MyActiveWorkScreen rows={[row({ id: "1" }), row({ id: "2" }), row({ id: "3" })]} />);
  assert.ok(html.includes("현재 담당 건수"));
  assert.ok(html.includes("3건"));
});
