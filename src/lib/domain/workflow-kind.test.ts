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

  test("never guesses without billing and keeps legacy MATCHER readable", () => {
    assert.equal(deriveWorkflowType("MATCHER", null), null);
    assert.equal(deriveWorkflowType("GENERATOR", null), null);
    assert.equal(deriveWorkflowType("TOTAL_CONTROLLER", null), null);
    assert.equal(workflowKindOf("MATCHER"), "MATCHER");
  });
});
