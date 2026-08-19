import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { deriveWorkflowType, workflowKindOf } from "./workflow-kind";

describe("final and pending workflow intake derivation", () => {
  const cases = [
    ["MATCHER", "PAID", "PAID_MATCHER"],
    ["MATCHER", "WARRANTY", "WARRANTY_MATCHER"],
    ["MATCHER", "PARTIAL_PAID", "PAID_MATCHER"],
    ["MATCHER", "PENDING_DECISION", "PENDING_MATCHER"],
    ["GENERATOR", "PAID", "PAID_GENERATOR"],
    ["GENERATOR", "WARRANTY", "WARRANTY_GENERATOR"],
    ["GENERATOR", "PARTIAL_PAID", "PAID_GENERATOR"],
    ["GENERATOR", "PENDING_DECISION", "PENDING_GENERATOR"],
    ["TOTAL_CONTROLLER", "PAID", "PAID_TOTAL_CONTROLLER"],
    ["TOTAL_CONTROLLER", "WARRANTY", "WARRANTY_TOTAL_CONTROLLER"],
    ["TOTAL_CONTROLLER", "PARTIAL_PAID", "PAID_TOTAL_CONTROLLER"],
    ["TOTAL_CONTROLLER", "PENDING_DECISION", "PENDING_TOTAL_CONTROLLER"],
  ] as const;

  for (const [kind, billingType, expected] of cases) {
    test(`${kind} + ${billingType} -> ${expected}`, () => {
      assert.equal(deriveWorkflowType(kind, billingType), expected);
      assert.equal(workflowKindOf(expected), kind);
    });
  }

  test("never guesses without billing — 세 종류 모두", () => {
    assert.equal(deriveWorkflowType("MATCHER", null), null);
    assert.equal(deriveWorkflowType("GENERATOR", null), null);
    assert.equal(deriveWorkflowType("TOTAL_CONTROLLER", null), null);
  });

  test("매쳐 종류는 유·무상이 붙은 workflowType에서만 나온다", () => {
    // 레거시 "MATCHER"(Matcher (기존 이력))가 없어진 뒤로 매쳐를 알아보는
    // 방법은 접미사 하나뿐이다. 예전처럼 유·무상 없는 매쳐가 다시 생기면
    // 이 규칙이 조용히 어긋나므로 여기서 못 박는다.
    assert.equal(workflowKindOf("PAID_MATCHER"), "MATCHER");
    assert.equal(workflowKindOf("WARRANTY_MATCHER"), "MATCHER");
    assert.equal(workflowKindOf("PENDING_MATCHER"), "MATCHER");
  });
});
