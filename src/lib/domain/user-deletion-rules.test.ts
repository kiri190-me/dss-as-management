import { test } from "node:test";
import assert from "node:assert/strict";
import {
  approvalSuccessorBlock,
  collectSuccessorExclusions,
  countPendingApprovalsAssignedTo,
  engineerSuccessorBlock,
  isActionableOpenApprovalPlan,
  planOpenApproval,
  replaceApproverInRouteSteps,
  resolveUserDeletionRequirements,
  routeScopeForApprovalKind,
  totalPendingApprovals,
  type ApprovalSuccessorContext,
  type ApprovalSuccessorFacts,
  type OpenApprovalFacts,
  type OpenApprovalPlan,
} from "./user-deletion-rules";

/**
 * 사용자 계정 삭제의 순수 규칙. 미리보기와 삭제가 같은 함수를 부르므로, 여기서
 * 판정이 틀리면 두 곳이 함께 틀린다 — 그래서 경계를 하나씩 못 박는다.
 */

const TARGET = "target";
const SUCCESSOR = "successor";

function candidate(overrides: Partial<ApprovalSuccessorFacts> = {}): ApprovalSuccessorFacts {
  return { id: SUCCESSOR, name: "이어받을사람", accountBlockReason: null, canDecideInspection: true, ...overrides };
}

function context(overrides: Partial<ApprovalSuccessorContext> = {}): ApprovalSuccessorContext {
  return {
    targetUserId: TARGET,
    mustInspect: false,
    routeMemberIds: new Set(),
    requesterIds: new Set(),
    ...overrides,
  };
}

// 용도를 하나 더하면 여기가 컴파일 오류로 잡힌다(Record 라서) — 그것이 의도다.
const NO_ROUTES = { FINAL_SHIPMENT: null, PART_ISSUE: null, QUOTE: null } as const;

function routeRow(overrides: Partial<OpenApprovalFacts> = {}): OpenApprovalFacts {
  return {
    kind: "FINAL_SHIPMENT",
    assignedApproverUserId: "a",
    requestedByUserId: "requester",
    routeId: "route-current",
    routeStepOrder: 1,
    routeSteps: [
      { stepOrder: 1, approverUserId: "a" },
      { stepOrder: 2, approverUserId: TARGET },
    ],
    ...overrides,
  };
}

// ── 결재 이어받을 사람 ──────────────────────────────────────────────────

test("결재 이어받을 사람 — 조건을 다 갖추면 막지 않는다", () => {
  assert.equal(approvalSuccessorBlock(candidate(), context()), null);
});

test("결재 이어받을 사람 — 지울 사람 자신은 안 된다", () => {
  const block = approvalSuccessorBlock(candidate({ id: TARGET }), context());
  assert.equal(block?.code, "INVALID_SUCCESSOR");
});

test("결재 이어받을 사람 — 계정 조건에 걸리면 그 이유를 이름과 함께 말한다", () => {
  const block = approvalSuccessorBlock(candidate({ accountBlockReason: "잠긴 계정입니다" }), context());
  assert.equal(block?.code, "INVALID_SUCCESSOR");
  assert.equal(block?.message, "이어받을사람 님은 잠긴 계정입니다.");
});

test("결재 이어받을 사람 — 검수 자격은 검수 수동 지정을 넘겨받을 때만 본다", () => {
  const noInspect = candidate({ canDecideInspection: false });
  assert.equal(approvalSuccessorBlock(noInspect, context({ mustInspect: false })), null);
  assert.equal(approvalSuccessorBlock(noInspect, context({ mustInspect: true }))?.code, "INVALID_SUCCESSOR");
  assert.equal(approvalSuccessorBlock(candidate(), context({ mustInspect: true })), null);
});

test("결재 이어받을 사람 — 이미 영향받는 판에 있으면 SUCCESSOR_ALREADY_IN_ROUTE", () => {
  const block = approvalSuccessorBlock(candidate(), context({ routeMemberIds: new Set([SUCCESSOR]) }));
  assert.equal(block?.code, "SUCCESSOR_ALREADY_IN_ROUTE");
});

test("결재 이어받을 사람 — 영향받는 사슬의 요청자면 SUCCESSOR_IS_REQUESTER", () => {
  const block = approvalSuccessorBlock(candidate(), context({ requesterIds: new Set([SUCCESSOR]) }));
  assert.equal(block?.code, "SUCCESSOR_IS_REQUESTER");
});

test("결재 이어받을 사람 — 사람 자체의 자격을 결재선 충돌보다 먼저 말한다", () => {
  const block = approvalSuccessorBlock(
    candidate({ accountBlockReason: "비활성화된 계정입니다" }),
    context({ routeMemberIds: new Set([SUCCESSOR]), requesterIds: new Set([SUCCESSOR]) })
  );
  assert.equal(block?.code, "INVALID_SUCCESSOR");
});

// ── 담당 이어받을 사람 ──────────────────────────────────────────────────

test("담당 이어받을 사람 — A/S 엔지니어이고 계정 조건을 갖추면 된다", () => {
  const facts = { id: SUCCESSOR, name: "엔지니어", role: "AS_ENGINEER", accountBlockReason: null };
  assert.equal(engineerSuccessorBlock(facts, { targetUserId: TARGET }), null);
});

test("담당 이어받을 사람 — 자기 자신 · 계정 조건 · 역할이 막는다", () => {
  const base = { id: SUCCESSOR, name: "엔지니어", role: "AS_ENGINEER", accountBlockReason: null };
  assert.equal(engineerSuccessorBlock({ ...base, id: TARGET }, { targetUserId: TARGET })?.code, "INVALID_SUCCESSOR");
  assert.equal(
    engineerSuccessorBlock({ ...base, accountBlockReason: "잠긴 계정입니다" }, { targetUserId: TARGET })?.message,
    "엔지니어 님은 잠긴 계정입니다."
  );
  assert.equal(
    engineerSuccessorBlock({ ...base, role: "ADMIN" }, { targetUserId: TARGET })?.message,
    "엔지니어 님은 A/S 엔지니어가 아닙니다."
  );
});

// ── 필요한가 ────────────────────────────────────────────────────────────

const NOTHING = {
  routeSlotCount: 0,
  pendingApprovals: { finalShipment: 0, repairInspection: 0, partIssue: 0, quote: 0 },
  isLastRepresentative: false,
  openAssignedCaseCount: 0,
};

test("필요한가 — 아무것도 없으면 둘 다 필요 없다", () => {
  assert.deepEqual(resolveUserDeletionRequirements(NOTHING), {
    approvalSuccessor: false,
    engineerSuccessor: false,
    approvalSuccessorMustInspect: false,
  });
});

test("필요한가 — 결재선 자리 · 대기 결재 넷 · 마지막 대표는 각각 결재 쪽을 요구한다", () => {
  const cases = [
    { ...NOTHING, routeSlotCount: 1 },
    { ...NOTHING, pendingApprovals: { finalShipment: 1, repairInspection: 0, partIssue: 0, quote: 0 } },
    { ...NOTHING, pendingApprovals: { finalShipment: 0, repairInspection: 1, partIssue: 0, quote: 0 } },
    { ...NOTHING, pendingApprovals: { finalShipment: 0, repairInspection: 0, partIssue: 1, quote: 0 } },
    // 🔴 견적서 결재만 걸린 사람 — 예전에는 세 칸만 더해 이어받을 사람 없이 삭제됐다.
    { ...NOTHING, pendingApprovals: { finalShipment: 0, repairInspection: 0, partIssue: 0, quote: 1 } },
    { ...NOTHING, isLastRepresentative: true },
  ];
  for (const facts of cases) {
    const required = resolveUserDeletionRequirements(facts);
    assert.equal(required.approvalSuccessor, true, JSON.stringify(facts));
    assert.equal(required.engineerSuccessor, false, JSON.stringify(facts));
  }
});

test("필요한가 — 검수 역할은 검수 수동 지정이 있을 때만 요구한다", () => {
  assert.equal(
    resolveUserDeletionRequirements({ ...NOTHING, routeSlotCount: 1 }).approvalSuccessorMustInspect,
    false
  );
  assert.equal(
    resolveUserDeletionRequirements({
      ...NOTHING,
      pendingApprovals: { finalShipment: 0, repairInspection: 2, partIssue: 0, quote: 0 },
    }).approvalSuccessorMustInspect,
    true
  );
  // 견적서 결재는 검수 역할을 요구하지 않는다 — 결재는 요구한다.
  const quoteOnly = resolveUserDeletionRequirements({
    ...NOTHING,
    pendingApprovals: { finalShipment: 0, repairInspection: 0, partIssue: 0, quote: 3 },
  });
  assert.equal(quoteOnly.approvalSuccessorMustInspect, false);
  assert.equal(quoteOnly.approvalSuccessor, true);
});

test("필요한가 — 열린 담당 건이 있으면 담당 쪽만 요구한다", () => {
  assert.deepEqual(resolveUserDeletionRequirements({ ...NOTHING, openAssignedCaseCount: 3 }), {
    approvalSuccessor: false,
    engineerSuccessor: true,
    approvalSuccessorMustInspect: false,
  });
});

// ── 진행 중인 결재 사슬 ──────────────────────────────────────────────────

test("승인 종류 → 결재선 용도 — 검수는 결재선을 타지 않는다", () => {
  assert.equal(routeScopeForApprovalKind("FINAL_SHIPMENT"), "FINAL_SHIPMENT");
  assert.equal(routeScopeForApprovalKind("PART_ISSUE"), "PART_ISSUE");
  assert.equal(routeScopeForApprovalKind("QUOTE"), "QUOTE");
  assert.equal(routeScopeForApprovalKind("REPAIR_INSPECTION"), null);
});

const CURRENT = {
  FINAL_SHIPMENT: "route-current",
  PART_ISSUE: "part-current",
  QUOTE: "quote-current",
} as const;

test("사슬 — 지울 사람과 관계없으면 NONE", () => {
  const row = routeRow({ routeSteps: [{ stepOrder: 1, approverUserId: "a" }, { stepOrder: 2, approverUserId: "b" }] });
  assert.deepEqual(planOpenApproval(row, { targetUserId: TARGET, currentRouteIdByScope: CURRENT }), { action: "NONE" });
});

test("사슬 — 열린 단계가 지울 사람에게 지정됐고 뒤에는 없으면 REASSIGN", () => {
  const row = routeRow({ assignedApproverUserId: TARGET, routeStepOrder: 2 });
  assert.deepEqual(planOpenApproval(row, { targetUserId: TARGET, currentRouteIdByScope: CURRENT }), {
    action: "REASSIGN",
  });
});

test("사슬 — 결재선을 타지 않는 검수 수동 지정은 REASSIGN", () => {
  const row = routeRow({
    kind: "REPAIR_INSPECTION",
    assignedApproverUserId: TARGET,
    routeId: null,
    routeStepOrder: null,
    routeSteps: [],
  });
  assert.deepEqual(planOpenApproval(row, { targetUserId: TARGET, currentRouteIdByScope: NO_ROUTES }), {
    action: "REASSIGN",
  });
});

test("사슬 — 지울 사람이 현재 판의 뒤 단계에 있으면 REPIN", () => {
  assert.deepEqual(planOpenApproval(routeRow(), { targetUserId: TARGET, currentRouteIdByScope: CURRENT }), {
    action: "REPIN",
    reassign: false,
  });
});

test("사슬 — 부품 불출은 부품 불출의 현재 판과 견준다", () => {
  const row = routeRow({ kind: "PART_ISSUE", routeId: "part-current" });
  assert.deepEqual(planOpenApproval(row, { targetUserId: TARGET, currentRouteIdByScope: CURRENT }), {
    action: "REPIN",
    reassign: false,
  });
  // 출하의 현재 판 id 와 같아도 용도가 다르면 옛 판이다.
  const crossed = routeRow({ kind: "PART_ISSUE", routeId: "route-current" });
  assert.deepEqual(planOpenApproval(crossed, { targetUserId: TARGET, currentRouteIdByScope: CURRENT }), {
    action: "STOP",
    code: "IN_FLIGHT_ON_OLD_ROUTE",
  });
});

test("🔴 사슬 — 견적서 결재도 견적서의 현재 판과 견준다(REPIN · STOP)", () => {
  // 견적서 결재선은 아무 문도 잠그지 않지만(schema/quote-approvals.ts), 사슬을 따라가는
  // 방식은 다른 둘과 같다 — 이 판정이 빠져 있던 동안 견적서 사슬은 아예 보이지 않았다.
  const onCurrent = routeRow({ kind: "QUOTE", routeId: "quote-current" });
  assert.deepEqual(planOpenApproval(onCurrent, { targetUserId: TARGET, currentRouteIdByScope: CURRENT }), {
    action: "REPIN",
    reassign: false,
  });
  const onOld = routeRow({ kind: "QUOTE", routeId: "quote-old" });
  assert.deepEqual(planOpenApproval(onOld, { targetUserId: TARGET, currentRouteIdByScope: CURRENT }), {
    action: "STOP",
    code: "IN_FLIGHT_ON_OLD_ROUTE",
  });
  // 열린 단계가 지울 사람이고 뒤에도 있으면 옮기면서 지정까지 바꾼다.
  const assignedAndAhead = routeRow({
    kind: "QUOTE",
    routeId: "quote-current",
    assignedApproverUserId: TARGET,
  });
  assert.deepEqual(planOpenApproval(assignedAndAhead, { targetUserId: TARGET, currentRouteIdByScope: CURRENT }), {
    action: "REPIN",
    reassign: true,
  });
});

test("사슬 — 지울 사람이 옛 판의 뒤 단계에 있으면 STOP", () => {
  const row = routeRow({ routeId: "route-old" });
  assert.deepEqual(planOpenApproval(row, { targetUserId: TARGET, currentRouteIdByScope: CURRENT }), {
    action: "STOP",
    code: "IN_FLIGHT_ON_OLD_ROUTE",
  });
});

test("사슬 — 그 용도의 판이 아예 없으면 붙잡은 판은 옛 판이다(STOP)", () => {
  assert.deepEqual(planOpenApproval(routeRow(), { targetUserId: TARGET, currentRouteIdByScope: NO_ROUTES }), {
    action: "STOP",
    code: "IN_FLIGHT_ON_OLD_ROUTE",
  });
});

test("사슬 — 이미 지나온 앞 단계에만 있으면 NONE", () => {
  const row = routeRow({
    assignedApproverUserId: "b",
    routeStepOrder: 2,
    routeSteps: [
      { stepOrder: 1, approverUserId: TARGET },
      { stepOrder: 2, approverUserId: "b" },
    ],
  });
  assert.deepEqual(planOpenApproval(row, { targetUserId: TARGET, currentRouteIdByScope: CURRENT }), { action: "NONE" });
});

test("사슬 — 지울 사람이 그 사슬의 요청자면 그 단계는 건너뛰므로 뒤에 있는 것으로 치지 않는다", () => {
  const ownOld = routeRow({ routeId: "route-old", requestedByUserId: TARGET });
  assert.deepEqual(planOpenApproval(ownOld, { targetUserId: TARGET, currentRouteIdByScope: CURRENT }), {
    action: "NONE",
  });
});

test("사슬 — 손대는 사슬은 넘김 · 옮김뿐이다", () => {
  const plans: [OpenApprovalPlan, boolean][] = [
    [{ action: "NONE" }, false],
    [{ action: "REASSIGN" }, true],
    [{ action: "REPIN", reassign: false }, true],
    [{ action: "STOP", code: "IN_FLIGHT_ON_OLD_ROUTE" }, false],
  ];
  for (const [plan, expected] of plans) assert.equal(isActionableOpenApprovalPlan(plan), expected, plan.action);
});

// ── 후보에서 뺄 사람 ────────────────────────────────────────────────────

test("후보 제외 — 현재 판의 사람들과, 손대는 사슬이 붙잡은 판의 사람 · 요청자를 모은다", () => {
  const repinned = routeRow({
    routeId: "route-current",
    requestedByUserId: "chain-requester",
    routeSteps: [
      { stepOrder: 1, approverUserId: "a" },
      { stepOrder: 2, approverUserId: TARGET },
    ],
  });
  const untouched = routeRow({
    routeId: "route-other",
    requestedByUserId: "untouched-requester",
    routeSteps: [{ stepOrder: 1, approverUserId: "untouched-member" }],
  });
  const stopped = routeRow({
    routeId: "route-old",
    requestedByUserId: "stopped-requester",
    routeSteps: [{ stepOrder: 1, approverUserId: "stopped-member" }],
  });
  const inspection = routeRow({
    kind: "REPAIR_INSPECTION",
    assignedApproverUserId: TARGET,
    requestedByUserId: "inspection-requester",
    routeId: null,
    routeStepOrder: null,
    routeSteps: [],
  });

  const result = collectSuccessorExclusions({
    targetUserId: TARGET,
    routeSlotSteps: [
      [
        { stepOrder: 1, approverUserId: "slot-member" },
        { stepOrder: 2, approverUserId: TARGET },
      ],
    ],
    openApprovals: [
      { facts: repinned, plan: { action: "REPIN", reassign: false } },
      { facts: untouched, plan: { action: "NONE" } },
      { facts: stopped, plan: { action: "STOP", code: "IN_FLIGHT_ON_OLD_ROUTE" } },
      { facts: inspection, plan: { action: "REASSIGN" } },
    ],
  });

  assert.deepEqual([...result.routeMemberIds].sort(), ["a", "slot-member"]);
  // 검수 수동 지정의 요청자는 사슬이 아니라 빠진다(파일 주석).
  assert.deepEqual([...result.requesterIds], ["chain-requester"]);
});

// ── 새 판 목록 ──────────────────────────────────────────────────────────

test("새 판 목록 — 같은 자리에서 사람만 바뀌고, 단계 순서대로 나온다", () => {
  const steps = [
    { stepOrder: 3, approverUserId: "c" },
    { stepOrder: 1, approverUserId: "a" },
    { stepOrder: 2, approverUserId: TARGET },
  ];
  assert.deepEqual(replaceApproverInRouteSteps(steps, TARGET, SUCCESSOR), ["a", SUCCESSOR, "c"]);
  // 받은 배열은 건드리지 않는다.
  assert.equal(steps[0].stepOrder, 3);
});

test("새 판 목록 — 지울 사람이 없으면 그대로다", () => {
  assert.deepEqual(
    replaceApproverInRouteSteps([{ stepOrder: 1, approverUserId: "a" }], TARGET, SUCCESSOR),
    ["a"]
  );
});

// ── 대기 결재 세기 ──────────────────────────────────────────────────────

test("대기 결재 — 지울 사람에게 지정된 것만 종류별로 센다", () => {
  const counts = countPendingApprovalsAssignedTo(
    [
      { kind: "FINAL_SHIPMENT", assignedApproverUserId: TARGET },
      { kind: "FINAL_SHIPMENT", assignedApproverUserId: "a" },
      { kind: "REPAIR_INSPECTION", assignedApproverUserId: TARGET },
      { kind: "PART_ISSUE", assignedApproverUserId: TARGET },
      { kind: "PART_ISSUE", assignedApproverUserId: TARGET },
      { kind: "PART_ISSUE", assignedApproverUserId: null },
      { kind: "QUOTE", assignedApproverUserId: TARGET },
      { kind: "QUOTE", assignedApproverUserId: "a" },
    ],
    TARGET
  );
  // 🔴 견적서가 제 칸으로 간다 — 예전 `else counts.partIssue += 1` 이면 partIssue 가 3이었다.
  assert.deepEqual(counts, { finalShipment: 1, repairInspection: 1, partIssue: 2, quote: 1 });
});

test("🔴 대기 결재 합 — 칸을 손으로 더하지 않는다(종류가 늘어도 따라온다)", () => {
  // 확인 창의 「대기 결재 N건」과 「이어받을 사람이 필요한가」가 둘 다 이 함수를 본다.
  assert.equal(totalPendingApprovals({ finalShipment: 0, repairInspection: 0, partIssue: 0, quote: 0 }), 0);
  assert.equal(totalPendingApprovals({ finalShipment: 1, repairInspection: 2, partIssue: 3, quote: 4 }), 10);
  // 견적서 한 건만 있어도 0 이 아니다 — 세 칸만 더하던 시절의 구멍이다.
  assert.equal(totalPendingApprovals({ finalShipment: 0, repairInspection: 0, partIssue: 0, quote: 1 }), 1);
});
