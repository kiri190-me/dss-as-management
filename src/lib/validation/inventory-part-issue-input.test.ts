import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PART_ISSUE_APPROVAL_DECISIONS,
  isValidPartIssueApprovalDecision,
  validateCreatePartIssueRequestInput,
  validatePartIssueNoteFormat,
  validatePartIssueReasonFormat,
} from "./inventory-part-issue-input";

/**
 * ============================================================================
 * 부품 불출 승인 — 형식 검증
 * ============================================================================
 * 🔴 이 층이 **무엇을 보지 않는지**까지 못 박는다. 「항목이 0개다」·「그 요청이
 * 지금 불출 가능한가」·「재고가 있는가」는 여기서 통과해야 한다 — 자료를 봐야
 * 알 수 있는 것이고, 여기서 한 벌 더 판정하면 mutation 과 두 벌이 된다.
 * ============================================================================
 */

const BALANCE_ID = "11111111-1111-4111-8111-111111111111";
const REQUEST_ID = "22222222-2222-4222-8222-222222222222";
const ITEM_ID = "33333333-3333-4333-8333-333333333333";
const CASE_ID = "44444444-4444-4444-8444-444444444444";
const NODE_ID = "55555555-5555-4555-8555-555555555555";

test("결정은 승인·반려 둘뿐이다 — 대기(REQUESTED)는 결정이 아니다", () => {
  assert.deepEqual([...PART_ISSUE_APPROVAL_DECISIONS], ["APPROVED", "REJECTED"]);
  assert.equal(isValidPartIssueApprovalDecision("APPROVED"), true);
  assert.equal(isValidPartIssueApprovalDecision("REJECTED"), true);
  assert.equal(isValidPartIssueApprovalDecision("REQUESTED"), false);
  assert.equal(isValidPartIssueApprovalDecision("EXECUTED"), false);
  assert.equal(isValidPartIssueApprovalDecision(""), false);
  assert.equal(isValidPartIssueApprovalDecision(null), false);
  assert.equal(isValidPartIssueApprovalDecision(undefined), false);
});

test("사유 — 없으면 null 이고 그것이 정상값이다", () => {
  for (const empty of [null, undefined, "", "   ", "\n\t "]) {
    const result = validatePartIssueReasonFormat(empty);
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.reason, null, `${JSON.stringify(empty)} 는 null 이어야 한다`);
  }
});

test("사유 — 앞뒤 공백을 털고, 글자가 아니거나 너무 길면 거절한다", () => {
  const trimmed = validatePartIssueReasonFormat("  긴급 교체  ");
  assert.equal(trimmed.ok, true);
  if (trimmed.ok) assert.equal(trimmed.reason, "긴급 교체");

  assert.equal(validatePartIssueReasonFormat(123).ok, false);
  assert.equal(validatePartIssueReasonFormat({}).ok, false);

  assert.equal(validatePartIssueReasonFormat("가".repeat(2000)).ok, true);
  assert.equal(validatePartIssueReasonFormat("가".repeat(2001)).ok, false);
});

test("사용처 — 사유와 같은 규칙이되 안내 문구가 다르다", () => {
  const ok = validatePartIssueNoteFormat("  상해수리소 ");
  assert.equal(ok.ok, true);
  if (ok.ok) assert.equal(ok.reason, "상해수리소");

  assert.equal(validatePartIssueNoteFormat("   ").ok, true);
  const tooLong = validatePartIssueNoteFormat("가".repeat(2001));
  assert.equal(tooLong.ok, false);
  if (!tooLong.ok) assert.match(tooLong.error, /사용처/);
});

test("신청 — 값이 객체가 아니거나 갈래를 모르면 거절한다", () => {
  for (const bad of [null, undefined, 3, "PART_REQUEST", []]) {
    assert.equal(validateCreatePartIssueRequestInput(bad).ok, false);
  }
  const unknownKind = validateCreatePartIssueRequestInput({ kind: "SOMETHING_ELSE" });
  assert.equal(unknownKind.ok, false);
  if (!unknownKind.ok) assert.match(unknownKind.error, /불출 종류/);
});

test("요청 기반 — 정규화된 값을 그대로 돌려준다", () => {
  const result = validateCreatePartIssueRequestInput({
    kind: "PART_REQUEST",
    partRequestId: REQUEST_ID,
    allocations: [{ requestItemId: ITEM_ID, partStockBalanceId: BALANCE_ID, quantity: 2 }],
    requestReason: "  급합니다  ",
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.input.kind, "PART_REQUEST");
  if (result.input.kind !== "PART_REQUEST") return;
  assert.equal(result.input.partRequestId, REQUEST_ID);
  assert.equal(result.input.requestReason, "급합니다");
  assert.deepEqual(result.input.allocations, [
    { requestItemId: ITEM_ID, partStockBalanceId: BALANCE_ID, quantity: 2 },
  ]);
});

test("요청 기반 — UUID 모양이 아니거나 수량이 정수 1 이상이 아니면 거절한다", () => {
  const base = {
    kind: "PART_REQUEST",
    partRequestId: REQUEST_ID,
    allocations: [{ requestItemId: ITEM_ID, partStockBalanceId: BALANCE_ID, quantity: 1 }],
  };

  assert.equal(validateCreatePartIssueRequestInput({ ...base, partRequestId: "abc" }).ok, false);
  assert.equal(validateCreatePartIssueRequestInput({ ...base, allocations: "nope" }).ok, false);
  assert.equal(validateCreatePartIssueRequestInput({ ...base, allocations: [null] }).ok, false);
  assert.equal(
    validateCreatePartIssueRequestInput({
      ...base,
      allocations: [{ requestItemId: "abc", partStockBalanceId: BALANCE_ID, quantity: 1 }],
    }).ok,
    false
  );
  for (const quantity of [0, -1, 1.5, "2", null, Number.NaN]) {
    assert.equal(
      validateCreatePartIssueRequestInput({
        ...base,
        allocations: [{ requestItemId: ITEM_ID, partStockBalanceId: BALANCE_ID, quantity }],
      }).ok,
      false,
      `수량 ${String(quantity)} 가 통과했다`
    );
  }
});

test("🔴 요청 기반 — 항목이 0개인 것은 여기서 막지 않는다(그 판정은 mutation 의 것이다)", () => {
  // 형식만 보는 층이 상태 판정까지 하면 규칙이 두 벌이 된다. 항목 0개는
  // domain/inventory-part-request-rules.ts 의 validateRawIssueAllocations 가
  // 이미 쥐고 있고, mutation 이 그것을 부른다.
  const result = validateCreatePartIssueRequestInput({
    kind: "PART_REQUEST",
    partRequestId: REQUEST_ID,
    allocations: [],
  });
  assert.equal(result.ok, true);
  if (result.ok && result.input.kind === "PART_REQUEST") {
    assert.deepEqual(result.input.allocations, []);
  }
});

test("직접 사용 — 접수 건만 있어도, 사용처만 있어도 된다", () => {
  const byCase = validateCreatePartIssueRequestInput({
    kind: "DIRECT_USE",
    partStockBalanceId: BALANCE_ID,
    quantity: 3,
    repairCaseId: CASE_ID,
  });
  assert.equal(byCase.ok, true);
  if (byCase.ok && byCase.input.kind === "DIRECT_USE") {
    assert.equal(byCase.input.repairCaseId, CASE_ID);
    assert.equal(byCase.input.destinationNote, null);
    assert.equal(byCase.input.procedureExecutionNodeId, null);
  }

  const byDestination = validateCreatePartIssueRequestInput({
    kind: "DIRECT_USE",
    partStockBalanceId: BALANCE_ID,
    quantity: 1,
    repairCaseId: "",
    destinationNote: "  상해수리소 ",
  });
  assert.equal(byDestination.ok, true);
  if (byDestination.ok && byDestination.input.kind === "DIRECT_USE") {
    assert.equal(byDestination.input.repairCaseId, null, "빈 문자열은 null 로 정규화된다");
    assert.equal(byDestination.input.destinationNote, "상해수리소");
  }
});

test("🔴 직접 사용 — 접수 건도 사용처도 없으면 거절한다", () => {
  // 표의 CHECK 과 consumeStock 이 같은 것을 요구한다. 여기서 걸러 두지 않으면
  // 결재를 다 받고 실행 순간에야 「사용처를 입력해 주세요」로 거절된다.
  const result = validateCreatePartIssueRequestInput({
    kind: "DIRECT_USE",
    partStockBalanceId: BALANCE_ID,
    quantity: 1,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /사용처/);

  const blankDestination = validateCreatePartIssueRequestInput({
    kind: "DIRECT_USE",
    partStockBalanceId: BALANCE_ID,
    quantity: 1,
    destinationNote: "   ",
  });
  assert.equal(blankDestination.ok, false, "공백만 적은 사용처는 사용처가 아니다");
});

test("직접 사용 — 잔량·접수 건·절차 작업의 UUID 모양과 수량을 본다", () => {
  const base = {
    kind: "DIRECT_USE",
    partStockBalanceId: BALANCE_ID,
    quantity: 1,
    destinationNote: "상해수리소",
  };

  assert.equal(validateCreatePartIssueRequestInput({ ...base, partStockBalanceId: "abc" }).ok, false);
  assert.equal(validateCreatePartIssueRequestInput({ ...base, quantity: 0 }).ok, false);
  assert.equal(validateCreatePartIssueRequestInput({ ...base, repairCaseId: "abc" }).ok, false);
  assert.equal(
    validateCreatePartIssueRequestInput({ ...base, procedureExecutionNodeId: "abc" }).ok,
    false
  );

  const withNode = validateCreatePartIssueRequestInput({
    ...base,
    repairCaseId: CASE_ID,
    procedureExecutionNodeId: NODE_ID,
  });
  assert.equal(withNode.ok, true);
  if (withNode.ok && withNode.input.kind === "DIRECT_USE") {
    assert.equal(withNode.input.procedureExecutionNodeId, NODE_ID);
  }
});
