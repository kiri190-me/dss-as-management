import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import WorkflowStageStatus from "./WorkflowStageStatus";

/**
 * Phase 5C-1 — WorkflowStageStatus replaced the "워크플로 제어" card
 * (WorkflowSummaryCard.tsx / DatabaseWorkflowSummaryCard.tsx, both deleted).
 * These tests pin the two behaviors that removal depends on: the old
 * heading string must never reappear, and the compact replacement must
 * still surface the same current-step/hold information the action list
 * (WorkflowActionList) needs context from.
 */

function render(overrides: Partial<Parameters<typeof WorkflowStageStatus>[0]> = {}): string {
  return renderToStaticMarkup(
    <WorkflowStageStatus
      stepLabel={overrides.stepLabel ?? "수리 진행"}
      stepOrder={overrides.stepOrder ?? 2}
      responsibleRoleLabel={overrides.responsibleRoleLabel ?? "관리자 또는 AS 엔지니어"}
      isOnHold={overrides.isOnHold ?? false}
      holdReason={overrides.holdReason}
      holdStartedByName={overrides.holdStartedByName}
    />
  );
}

test("renders the compact '현재 작업 상태' heading, never the removed '워크플로 제어' heading", () => {
  const html = render();
  assert.ok(html.includes("현재 작업 상태"), "must show the new compact heading");
  assert.ok(!html.includes("워크플로 제어"), "must never reintroduce the removed big-card heading");
});

test("shows current step order/label and responsible role", () => {
  const html = render({ stepLabel: "출하 준비", stepOrder: 5, responsibleRoleLabel: "관리자(SUPER_ADMIN/ADMIN)" });
  assert.ok(html.includes("5. "), "step order must render");
  assert.ok(html.includes("출하 준비"), "step label must render");
  assert.ok(html.includes("관리자(SUPER_ADMIN/ADMIN)"), "responsible role must render");
});

test("omits the step order prefix when stepOrder is null", () => {
  const html = render({ stepOrder: null, stepLabel: "알 수 없는 단계" });
  assert.ok(html.includes("알 수 없는 단계"));
  assert.ok(!/>\s*null\.\s*알 수 없는 단계/.test(html));
});

test("hold reason/starter render only while on hold", () => {
  const onHold = render({ isOnHold: true, holdReason: "부품 대기", holdStartedByName: "홍길동" });
  assert.ok(onHold.includes("보류 사유: 부품 대기"));
  assert.ok(onHold.includes("홍길동"));

  const notOnHold = render({ isOnHold: false, holdReason: "부품 대기", holdStartedByName: "홍길동" });
  assert.ok(!notOnHold.includes("보류 사유"), "must not show a stale hold reason when not on hold");
});

test("never renders approval statuses, workflow-type row, or override badge — those disappeared along with the big card", () => {
  const html = render();
  assert.ok(!html.includes("수리 검수 승인"));
  assert.ok(!html.includes("최종 출하 승인"));
  assert.ok(!html.includes("로컬 워크플로 재정의"));
  assert.ok(!html.includes("워크플로 유형"));
});
