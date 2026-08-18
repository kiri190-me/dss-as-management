import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { workflowSteps } from "../../mock-data";
import type { WorkflowType } from "../../types";
import { TRANSITION_DEFINITIONS } from "./transition-definitions";

const pairs = [
  ["MATCHER", "PAID_MATCHER"],
  ["MATCHER", "WARRANTY_MATCHER"],
  ["PAID_GENERATOR", "PAID_TOTAL_CONTROLLER"],
  ["WARRANTY_GENERATOR", "WARRANTY_TOTAL_CONTROLLER"],
] as const satisfies readonly (readonly [WorkflowType, WorkflowType])[];

function comparable<T extends { workflowType: WorkflowType }>(rows: readonly T[], type: WorkflowType) {
  return rows.filter((row) => row.workflowType === type).map((row) => {
    const copy: Partial<T> = { ...row };
    delete copy.workflowType;
    return copy;
  });
}

describe("independent workflow foundation snapshots", () => {
  for (const [source, target] of pairs) {
    test(`${target} steps equal the approved ${source} snapshot`, () => {
      assert.deepEqual(comparable(workflowSteps, target), comparable(workflowSteps, source));
      const sourceRows = workflowSteps.filter((row) => row.workflowType === source);
      const targetRows = workflowSteps.filter((row) => row.workflowType === target);
      assert.notStrictEqual(sourceRows, targetRows);
      assert.ok(sourceRows.every((row, index) => row !== targetRows[index]));
    });

    test(`${target} transitions and approval gates equal ${source} with independent IDs`, () => {
      const stripIdentity = (type: WorkflowType) => TRANSITION_DEFINITIONS
        .filter((row) => row.workflowType === type)
        .map((row) => {
          const copy: Partial<typeof row> = { ...row };
          delete copy.id;
          delete copy.workflowType;
          return copy;
        });
      assert.deepEqual(stripIdentity(target), stripIdentity(source));
      const sourceRows = TRANSITION_DEFINITIONS.filter((row) => row.workflowType === source);
      const targetRows = TRANSITION_DEFINITIONS.filter((row) => row.workflowType === target);
      assert.equal(new Set([...sourceRows, ...targetRows].map((row) => row.id)).size, sourceRows.length + targetRows.length);
      assert.ok(sourceRows.every((row, index) => row !== targetRows[index]));
    });
  }

  test("pending workflows expose only the two intake steps and no progress transitions", () => {
    for (const workflowType of ["PENDING_MATCHER", "PENDING_GENERATOR", "PENDING_TOTAL_CONTROLLER"] as const) {
      assert.deepEqual(
        workflowSteps.filter((row) => row.workflowType === workflowType).map((row) => row.key),
        ["product_intake", "intake_inspection"]
      );
      assert.deepEqual(
        TRANSITION_DEFINITIONS.filter((row) => row.workflowType === workflowType),
        []
      );
    }
  });
});
