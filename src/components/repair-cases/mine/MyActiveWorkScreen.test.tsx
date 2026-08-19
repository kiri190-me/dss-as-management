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
    customerId: "cust-1",
    customerName: "대성RF시스템",
    endUserName: "대성RF 대전연구소",
    productCategory: "Generator",
    billingType: "PAID",
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

test("표와 카드를 함께 그리고, 공용 기준(@4xl)으로 하나만 보인다", () => {
  // 끊는 지점은 화면마다 따로 정하지 않는다 — components/common/responsive-list.tsx
  // 한 곳이 정하고 모든 목록이 그것을 쓴다. 여기서 검사하는 것은 이 화면이
  // 그 공용 기준을 타고 있는가이지, 값 자체가 아니다.
  const html = renderToStaticMarkup(<MyActiveWorkScreen rows={[row()]} />);
  assert.ok(html.includes("@container"), "공용 기준은 컨테이너 폭을 본다 — 화면 폭이 아니다");
  assert.ok(html.includes("@4xl:block"), "넓을 때 보일 표 래퍼가 있어야 한다");
  assert.ok(html.includes("@4xl:hidden"), "좁을 때만 보일 카드 래퍼가 있어야 한다");
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

// ─────────────────────────────── 2026-08-19 전체 A/S 현황과 같은 UI

test("담당 건이 하나도 없으면 필터 카드 자체를 그리지 않는다", () => {
  // 거를 것이 없는 화면에 검색·선택 항목만 남기면 빈 화면이 더 복잡해진다.
  const html = renderToStaticMarkup(<MyActiveWorkScreen rows={[]} />);
  assert.ok(!html.includes("제품 구분"), "필터 카드가 나오면 안 된다");
  assert.ok(!html.includes("필터 초기화"));
});

test("전체 A/S 현황과 같은 필터 항목을 같은 순서로 그린다", () => {
  const html = renderToStaticMarkup(<MyActiveWorkScreen rows={[row()]} />);
  for (const label of ["검색", "현재 상태", "제품 구분", "고객사", "예외 상태", "필터 초기화"]) {
    assert.ok(html.includes(label), `필터 항목 "${label}"이 있어야 한다`);
  }
  // 순서는 라벨 글자가 아니라 입력 요소 id로 본다 — "고객사"는 검색 안내
  // 문구에도 나오므로 글자 위치로 재면 엉뚱한 곳을 짚는다.
  const order = ["my-work-search", "my-work-status", "my-work-product-category", "my-work-customer", "my-work-exception-status"];
  const positions = order.map((id) => html.indexOf(id));
  assert.ok(positions.every((pos) => pos >= 0), "다섯 항목이 모두 있어야 한다");
  assert.deepEqual([...positions].sort((a, b) => a - b), positions, "선택 항목 순서도 그쪽과 같아야 한다");
});

test("제품 열은 전체 A/S 현황과 같이 한 칸에 접어 보여 준다", () => {
  const html = renderToStaticMarkup(
    <MyActiveWorkScreen
      rows={[row({ productCategory: "Generator", modelName: "TG-350", billingType: "PAID", serialNumber: "SN-1", lotNumber: "LN-1" })]}
    />
  );
  assert.ok(html.includes("Generator / TG-350 / 유상"), "제품 구분/모델/유·무상이 한 줄이어야 한다");
  assert.ok(html.includes("S/N SN-1 / L/N LN-1"), "S/N·L/N이 둘째 줄이어야 한다");
  assert.ok(!html.includes(">제품 구분</th>"), "제품 구분이 다시 독립 열로 돌아오면 안 된다");
});

test("유·무상이 정해지지 않았으면 제품 줄에 '-'로 적는다", () => {
  const html = renderToStaticMarkup(<MyActiveWorkScreen rows={[row({ productCategory: "Generator", modelName: "TG-350", billingType: null })]} />);
  assert.ok(html.includes("Generator / TG-350 / -"));
});

test("목록 위에 조건에 맞는 건수를 적는다", () => {
  const html = renderToStaticMarkup(<MyActiveWorkScreen rows={[row({ id: "1" }), row({ id: "2" })]} />);
  assert.ok(html.includes("조건에 맞는 담당 제품 2건"));
});

test("접었어도 원래 보여 주던 값은 하나도 사라지지 않았다", () => {
  const html = renderToStaticMarkup(
    <MyActiveWorkScreen
      rows={[
        row({
          endUserName: "부산공장",
          internalTargetInspectionCompletionDate: "2026-08-21",
          internalTargetShipmentDate: "2026-08-27",
          customerRequestedDueDate: "2026-08-30",
        }),
      ]}
    />
  );
  for (const value of ["부산공장", "2026-08-21", "2026-08-27", "2026-08-30"]) {
    assert.ok(html.includes(value), `${value}가 어딘가에는 남아 있어야 한다`);
  }
  assert.ok(html.includes("입고 후"), "입고 후 경과일도 남아 있어야 한다");
});
