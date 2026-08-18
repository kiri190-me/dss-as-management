import { test } from "node:test";
import assert from "node:assert/strict";
import { runSaveSequence, type SaveStepResult } from "./save-sequence";

/**
 * Targeted pure tests for the generic save-sequence executor (5C-6D-1A).
 * Deliberately uses a synthetic, domain-free step shape — this module must
 * never need to know what a "node" or "edge" or "updatedAt" is. Domain-
 * specific step-planning/ordering/id-reconciliation tests stay in each
 * domain's own test file (e.g. repair-case-flowchart-editor-save-state.test.ts),
 * unchanged by this extraction.
 */

type TestStep = { id: string };

function makeSuccessExecutor(log: string[]): (step: TestStep, expectedToken: string) => Promise<SaveStepResult<string>> {
  let counter = 0;
  return async (step, expectedToken) => {
    counter += 1;
    log.push(`${step.id}@${expectedToken}`);
    return { ok: true, token: `t${counter}` };
  };
}

test("runSaveSequence: steps run in order", async () => {
  const log: string[] = [];
  const steps: TestStep[] = [{ id: "a" }, { id: "b" }, { id: "c" }];
  await runSaveSequence(steps, "t0", makeSuccessExecutor(log));
  assert.deepEqual(
    log.map((entry) => entry.split("@")[0]),
    ["a", "b", "c"]
  );
});

test("runSaveSequence: the concurrency token from step N feeds step N+1, never the stale initial token", async () => {
  const log: string[] = [];
  const steps: TestStep[] = [{ id: "a" }, { id: "b" }, { id: "c" }];
  await runSaveSequence(steps, "t0", makeSuccessExecutor(log));
  assert.deepEqual(log, ["a@t0", "b@t1", "c@t2"]);
});

test("runSaveSequence: all-success outcome reports every step succeeded, no failure, correct final token", async () => {
  const steps: TestStep[] = [{ id: "a" }, { id: "b" }];
  const outcome = await runSaveSequence(steps, "t0", makeSuccessExecutor([]));
  assert.deepEqual(outcome.succeededSteps, steps);
  assert.equal(outcome.failedAtStep, null);
  assert.equal(outcome.failureMessage, null);
  assert.equal(outcome.finalToken, "t2");
});

test("runSaveSequence: a failure stops subsequent steps — they are never invoked", async () => {
  const steps: TestStep[] = [{ id: "a" }, { id: "b" }, { id: "c" }];
  let calls = 0;
  const executeStep = async (step: TestStep): Promise<SaveStepResult<string>> => {
    calls += 1;
    if (step.id === "b") return { ok: false, message: "boom" };
    return { ok: true, token: `t${calls}` };
  };
  await runSaveSequence(steps, "t0", executeStep);
  assert.equal(calls, 2); // "a" ran, "b" ran and failed, "c" never called
});

test("runSaveSequence: succeeded steps are reported exactly, in order, up to (not including) the failed step", async () => {
  const steps: TestStep[] = [{ id: "a" }, { id: "b" }, { id: "c" }];
  const executeStep = async (step: TestStep): Promise<SaveStepResult<string>> => (step.id === "c" ? { ok: false, message: "boom" } : { ok: true, token: `${step.id}-token` });
  const outcome = await runSaveSequence(steps, "t0", executeStep);
  assert.deepEqual(outcome.succeededSteps, [{ id: "a" }, { id: "b" }]);
});

test("runSaveSequence: the failed step is reported exactly", async () => {
  const steps: TestStep[] = [{ id: "a" }, { id: "b" }, { id: "c" }];
  const executeStep = async (step: TestStep): Promise<SaveStepResult<string>> => (step.id === "b" ? { ok: false, message: "concurrency conflict" } : { ok: true, token: "t" });
  const outcome = await runSaveSequence(steps, "t0", executeStep);
  assert.deepEqual(outcome.failedAtStep, { id: "b" });
  assert.equal(outcome.failureMessage, "concurrency conflict");
});

test("runSaveSequence: unrun steps are neither in succeededSteps nor failedAtStep — the caller can derive them as steps.slice(succeededSteps.length + 1)", async () => {
  const steps: TestStep[] = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
  const executeStep = async (step: TestStep): Promise<SaveStepResult<string>> => (step.id === "b" ? { ok: false, message: "boom" } : { ok: true, token: "t" });
  const outcome = await runSaveSequence(steps, "t0", executeStep);
  assert.deepEqual(outcome.succeededSteps, [{ id: "a" }]);
  assert.deepEqual(outcome.failedAtStep, { id: "b" });
  // "c" and "d" are the unrun remainder — never appear anywhere in the outcome.
  const accountedFor = [...outcome.succeededSteps, outcome.failedAtStep].map((s) => s!.id);
  assert.deepEqual(accountedFor, ["a", "b"]);
});

test("runSaveSequence: the latest token is the one from the last step that actually succeeded, not a later unrun step", async () => {
  const steps: TestStep[] = [{ id: "a" }, { id: "b" }, { id: "c" }];
  const executeStep = async (step: TestStep): Promise<SaveStepResult<string>> => (step.id === "c" ? { ok: false, message: "boom" } : { ok: true, token: `${step.id}-token` });
  const outcome = await runSaveSequence(steps, "t0", executeStep);
  assert.equal(outcome.finalToken, "b-token");
});

test("runSaveSequence: a failure on the very first step leaves finalToken equal to the initial token", async () => {
  const steps: TestStep[] = [{ id: "a" }];
  const executeStep = async (): Promise<SaveStepResult<string>> => ({ ok: false, message: "boom" });
  const outcome = await runSaveSequence(steps, "t0", executeStep);
  assert.equal(outcome.finalToken, "t0");
});

test("runSaveSequence: never mutates the input steps array or its elements", async () => {
  const steps: TestStep[] = [{ id: "a" }, { id: "b" }];
  const stepsCopy = steps.map((s) => ({ ...s }));
  await runSaveSequence(steps, "t0", makeSuccessExecutor([]));
  assert.deepEqual(steps, stepsCopy);
});

test("runSaveSequence: an empty step list succeeds cleanly with no executor calls", async () => {
  let calls = 0;
  const executeStep = async (): Promise<SaveStepResult<string>> => {
    calls += 1;
    return { ok: true, token: "unused" };
  };
  const outcome = await runSaveSequence([], "t0", executeStep);
  assert.equal(calls, 0);
  assert.deepEqual(outcome.succeededSteps, []);
  assert.equal(outcome.failedAtStep, null);
  assert.equal(outcome.failureMessage, null);
  assert.equal(outcome.finalToken, "t0");
});
