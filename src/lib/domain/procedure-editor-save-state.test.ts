import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mergeProcedureNodeForRender,
  mergeProcedureEdgeForRender,
  computeDirtyProcedureNodeFieldEntries,
  computeDirtyProcedureEdgeFieldEntries,
  computeDirtyProcedurePositionNodeIds,
  computeDirtyProcedureRouteEdgeIds,
  planProcedureSaveSteps,
  runProcedureSaveSequence,
  succeededProcedureNodeFieldIds,
  succeededProcedureEdgeFieldIds,
  succeededProcedureLayoutNodeIds,
  succeededProcedureRouteEdgeIds,
  type ProcedureNodeFieldDraft,
  type ProcedureEdgeFieldDraft,
  type ProcedureServerNodeSnapshot,
  type ProcedureServerEdgeSnapshot,
  type ProcedureSaveStep,
  type ProcedureSaveStepResult,
} from "./procedure-editor-save-state";

/**
 * Targeted pure tests for the Procedure editor's save-state model
 * (5C-6D-1B — PURE LOGIC ONLY, not wired into ProcedureTemplateEditorScreen
 * yet). Zero React, zero server-action imports — same harness constraint
 * documented throughout every prior 6D/6D-1 checkpoint. Mirrors the shape
 * of repair-case-flowchart-editor-save-state.test.ts, but every value
 * below reflects Procedure's OWN audited mutation boundaries, not a
 * transplant of the Case Flowchart domain's fixtures.
 */

const serverNode: ProcedureServerNodeSnapshot = {
  id: "n1",
  title: "원래 제목",
  description: "원래 설명",
  instructions: "원래 작업 지시",
  sortOrder: 10,
  isActive: true,
  positionX: 500,
  positionY: 300,
};
const serverEdge: ProcedureServerEdgeSnapshot = { id: "e1", branchType: "DEFAULT", branchLabel: null, routePoints: null };

function unchangedNodeDraft(): ProcedureNodeFieldDraft {
  return {
    title: serverNode.title,
    description: serverNode.description ?? "",
    instructions: serverNode.instructions ?? "",
    sortOrder: serverNode.sortOrder,
    isActive: serverNode.isActive,
  };
}
function unchangedEdgeDraft(): ProcedureEdgeFieldDraft {
  return { branchType: serverEdge.branchType, branchLabel: serverEdge.branchLabel ?? "" };
}

// ==================== NODE DIRTY ====================

test("node dirty: unchanged draft is not dirty", () => {
  const entries = computeDirtyProcedureNodeFieldEntries(new Map([["n1", unchangedNodeDraft()]]), new Map([["n1", serverNode]]));
  assert.deepEqual(entries, []);
});

test("node dirty: changed title is dirty", () => {
  const draft = { ...unchangedNodeDraft(), title: "새 제목" };
  const entries = computeDirtyProcedureNodeFieldEntries(new Map([["n1", draft]]), new Map([["n1", serverNode]]));
  assert.equal(entries.length, 1);
});

test("node dirty: changed description is dirty", () => {
  const draft = { ...unchangedNodeDraft(), description: "새 설명" };
  const entries = computeDirtyProcedureNodeFieldEntries(new Map([["n1", draft]]), new Map([["n1", serverNode]]));
  assert.equal(entries.length, 1);
});

test("node dirty: changed instructions is dirty", () => {
  const draft = { ...unchangedNodeDraft(), instructions: "새 작업 지시" };
  const entries = computeDirtyProcedureNodeFieldEntries(new Map([["n1", draft]]), new Map([["n1", serverNode]]));
  assert.equal(entries.length, 1);
});

test("node dirty: changed sortOrder is dirty", () => {
  const draft = { ...unchangedNodeDraft(), sortOrder: 20 };
  const entries = computeDirtyProcedureNodeFieldEntries(new Map([["n1", draft]]), new Map([["n1", serverNode]]));
  assert.equal(entries.length, 1);
});

test("node dirty: changed isActive is dirty", () => {
  const draft = { ...unchangedNodeDraft(), isActive: false };
  const entries = computeDirtyProcedureNodeFieldEntries(new Map([["n1", draft]]), new Map([["n1", serverNode]]));
  assert.equal(entries.length, 1);
});

test("node dirty: reverting every field back to the exact baseline returns to not-dirty", () => {
  const drafted = { ...unchangedNodeDraft(), title: "임시 제목", isActive: false };
  const reverted = { ...drafted, title: serverNode.title, isActive: serverNode.isActive };
  const entries = computeDirtyProcedureNodeFieldEntries(new Map([["n1", reverted]]), new Map([["n1", serverNode]]));
  assert.deepEqual(entries, []);
});

test("node dirty: a draft referencing a deleted node never counts as dirty", () => {
  const entries = computeDirtyProcedureNodeFieldEntries(new Map([["ghost", unchangedNodeDraft()]]), new Map());
  assert.deepEqual(entries, []);
});

// ==================== POSITION DIRTY ====================

test("position dirty: changed position is dirty", () => {
  const ids = computeDirtyProcedurePositionNodeIds(new Map([["n1", { x: 700, y: 330 }]]), new Map([["n1", serverNode]]));
  assert.deepEqual(ids, ["n1"]);
});

test("position dirty: unchanged position (equals current effective baseline) is not dirty", () => {
  const ids = computeDirtyProcedurePositionNodeIds(new Map([["n1", { x: serverNode.positionX, y: serverNode.positionY }]]), new Map([["n1", serverNode]]));
  assert.deepEqual(ids, []);
});

test("position dirty: dragged away then back to the exact baseline reverts to not-dirty", () => {
  const ids = computeDirtyProcedurePositionNodeIds(new Map([["n1", { x: 500, y: 300 }]]), new Map([["n1", serverNode]]));
  assert.deepEqual(ids, []);
});

// ==================== EDGE DIRTY ====================

test("edge dirty: unchanged draft is not dirty", () => {
  const entries = computeDirtyProcedureEdgeFieldEntries(new Map([["e1", unchangedEdgeDraft()]]), new Map([["e1", serverEdge]]));
  assert.deepEqual(entries, []);
});

test("edge dirty: changed branchType is dirty", () => {
  const draft: ProcedureEdgeFieldDraft = { branchType: "CUSTOM", branchLabel: "특이" };
  const entries = computeDirtyProcedureEdgeFieldEntries(new Map([["e1", draft]]), new Map([["e1", serverEdge]]));
  assert.equal(entries.length, 1);
});

test("edge dirty: changed branchLabel is dirty", () => {
  const draft: ProcedureEdgeFieldDraft = { branchType: serverEdge.branchType, branchLabel: "라벨" };
  const entries = computeDirtyProcedureEdgeFieldEntries(new Map([["e1", draft]]), new Map([["e1", serverEdge]]));
  assert.equal(entries.length, 1);
});

test("edge dirty: reverting to the exact baseline returns to not-dirty", () => {
  const entries = computeDirtyProcedureEdgeFieldEntries(new Map([["e1", { branchType: serverEdge.branchType, branchLabel: serverEdge.branchLabel ?? "" }]]), new Map([["e1", serverEdge]]));
  assert.deepEqual(entries, []);
});

// Note: `reviewerNote`/`note` is deliberately absent from ProcedureEdgeFieldDraft
// and therefore untested here for dirtiness — it is a write-only per-save audit
// annotation with no server-side baseline to diff against (see this module's own
// AUDITED MUTATION BOUNDARIES doc comment). There is nothing to "revert to."

// ==================== ROUTE DIRTY ====================

test("route dirty: changed route (new waypoint) is dirty", () => {
  const ids = computeDirtyProcedureRouteEdgeIds(new Map([["e1", [{ x: 10, y: 20 }]]]), new Map([["e1", serverEdge]]));
  assert.deepEqual(ids, ["e1"]);
});

test("route dirty: route reset to null (from a baseline that had a manual route) is dirty", () => {
  const baselineWithRoute: ProcedureServerEdgeSnapshot = { ...serverEdge, routePoints: [{ x: 1, y: 1 }] };
  const ids = computeDirtyProcedureRouteEdgeIds(new Map([["e1", null]]), new Map([["e1", baselineWithRoute]]));
  assert.deepEqual(ids, ["e1"]);
});

test("route dirty: reverting to the exact baseline route returns to not-dirty", () => {
  const baselineWithRoute: ProcedureServerEdgeSnapshot = { ...serverEdge, routePoints: [{ x: 1, y: 1 }] };
  const ids = computeDirtyProcedureRouteEdgeIds(new Map([["e1", [{ x: 1, y: 1 }]]]), new Map([["e1", baselineWithRoute]]));
  assert.deepEqual(ids, []);
});

test("route dirty: null vs null (both automatic) is not dirty", () => {
  const ids = computeDirtyProcedureRouteEdgeIds(new Map([["e1", null]]), new Map([["e1", serverEdge]]));
  assert.deepEqual(ids, []);
});

// ==================== RENDER MERGE ====================

test("render merge: no pending draft/position renders the node baseline unchanged", () => {
  const rendered = mergeProcedureNodeForRender(serverNode, undefined, undefined);
  assert.deepEqual(rendered, serverNode);
});

test("render merge: pending node field draft overrides the baseline", () => {
  const draft: ProcedureNodeFieldDraft = { title: "Driver Board 점검", description: "", instructions: "", sortOrder: 1, isActive: false };
  const rendered = mergeProcedureNodeForRender(serverNode, draft, undefined);
  assert.equal(rendered.title, "Driver Board 점검");
  assert.equal(rendered.isActive, false);
});

test("render merge: pending position overrides the baseline positionX/positionY", () => {
  const rendered = mergeProcedureNodeForRender(serverNode, undefined, { x: 900, y: 120 });
  assert.equal(rendered.positionX, 900);
  assert.equal(rendered.positionY, 120);
});

test("render merge: no pending draft/route renders the edge baseline unchanged", () => {
  const rendered = mergeProcedureEdgeForRender(serverEdge, undefined, undefined);
  assert.deepEqual(rendered, serverEdge);
});

test("render merge: pending edge field draft overrides the baseline", () => {
  const draft: ProcedureEdgeFieldDraft = { branchType: "NG", branchLabel: "" };
  const rendered = mergeProcedureEdgeForRender(serverEdge, draft, undefined);
  assert.equal(rendered.branchType, "NG");
});

test("render merge: pending route draft overrides the baseline route", () => {
  const rendered = mergeProcedureEdgeForRender(serverEdge, undefined, [{ x: 5, y: 6 }]);
  assert.deepEqual(rendered.routePoints, [{ x: 5, y: 6 }]);
});

test("render merge: an explicit null route override (key present, value null) overrides a non-null baseline route", () => {
  const baselineWithRoute: ProcedureServerEdgeSnapshot = { ...serverEdge, routePoints: [{ x: 1, y: 1 }] };
  const rendered = mergeProcedureEdgeForRender(baselineWithRoute, undefined, null);
  assert.equal(rendered.routePoints, null);
});

// ==================== SAVE PLAN ====================

test("save plan: only node field changes produce only NODE_FIELDS steps", () => {
  const steps = planProcedureSaveSteps({
    dirtyNodeFieldEntries: [["n1", unchangedNodeDraft()]],
    dirtyEdgeFieldEntries: [],
    dirtyPositionNodeIds: [],
    dirtyRouteEdgeIds: [],
  });
  assert.deepEqual(steps, [{ kind: "NODE_FIELDS", nodeId: "n1" }]);
});

test("save plan: only edge field changes produce only EDGE_FIELDS steps", () => {
  const steps = planProcedureSaveSteps({
    dirtyNodeFieldEntries: [],
    dirtyEdgeFieldEntries: [["e1", unchangedEdgeDraft()]],
    dirtyPositionNodeIds: [],
    dirtyRouteEdgeIds: [],
  });
  assert.deepEqual(steps, [{ kind: "EDGE_FIELDS", edgeId: "e1" }]);
});

test("save plan: only layout/route changes produce a single combined LAYOUT_AND_ROUTES step", () => {
  const steps = planProcedureSaveSteps({
    dirtyNodeFieldEntries: [],
    dirtyEdgeFieldEntries: [],
    dirtyPositionNodeIds: ["n1", "n2"],
    dirtyRouteEdgeIds: ["e1"],
  });
  assert.deepEqual(steps, [{ kind: "LAYOUT_AND_ROUTES", nodeIds: ["n1", "n2"], edgeIds: ["e1"] }]);
});

test("save plan: position-only changes still produce a LAYOUT_AND_ROUTES step (edgeIds empty)", () => {
  const steps = planProcedureSaveSteps({ dirtyNodeFieldEntries: [], dirtyEdgeFieldEntries: [], dirtyPositionNodeIds: ["n1"], dirtyRouteEdgeIds: [] });
  assert.deepEqual(steps, [{ kind: "LAYOUT_AND_ROUTES", nodeIds: ["n1"], edgeIds: [] }]);
});

test("save plan: no changes at all produces an empty plan", () => {
  const steps = planProcedureSaveSteps({ dirtyNodeFieldEntries: [], dirtyEdgeFieldEntries: [], dirtyPositionNodeIds: [], dirtyRouteEdgeIds: [] });
  assert.deepEqual(steps, []);
});

test("save plan: combined changes produce deterministic ordered steps — node fields, then edge fields, then layout/routes", () => {
  const steps = planProcedureSaveSteps({
    dirtyNodeFieldEntries: [["n1", unchangedNodeDraft()]],
    dirtyEdgeFieldEntries: [["e1", unchangedEdgeDraft()]],
    dirtyPositionNodeIds: ["n2"],
    dirtyRouteEdgeIds: ["e2"],
  });
  assert.deepEqual(steps, [
    { kind: "NODE_FIELDS", nodeId: "n1" },
    { kind: "EDGE_FIELDS", edgeId: "e1" },
    { kind: "LAYOUT_AND_ROUTES", nodeIds: ["n2"], edgeIds: ["e2"] },
  ]);
});

test("save plan: excluded structural actions never appear — every emitted step's kind is one of the three safe-to-defer kinds", () => {
  const steps = planProcedureSaveSteps({
    dirtyNodeFieldEntries: [["n1", unchangedNodeDraft()]],
    dirtyEdgeFieldEntries: [["e1", unchangedEdgeDraft()]],
    dirtyPositionNodeIds: ["n2"],
    dirtyRouteEdgeIds: ["e2"],
  });
  const allowedKinds = new Set(["NODE_FIELDS", "EDGE_FIELDS", "LAYOUT_AND_ROUTES"]);
  for (const step of steps) assert.ok(allowedKinds.has(step.kind), `unexpected step kind: ${step.kind}`);
});

// ==================== SUCCESS CLEARING ====================

function makeSuccessExecutor(): (step: ProcedureSaveStep, expectedUpdatedAt: string) => Promise<ProcedureSaveStepResult> {
  let counter = 0;
  return async () => {
    counter += 1;
    return { ok: true, updatedAt: `t${counter}` };
  };
}

test("success clearing: a fully successful sequence reports every node field / edge field / layout+route id as succeeded", async () => {
  const steps = planProcedureSaveSteps({
    dirtyNodeFieldEntries: [["n1", unchangedNodeDraft()]],
    dirtyEdgeFieldEntries: [["e1", unchangedEdgeDraft()]],
    dirtyPositionNodeIds: ["n2"],
    dirtyRouteEdgeIds: ["e2"],
  });
  const outcome = await runProcedureSaveSequence(steps, "t0", makeSuccessExecutor());
  assert.equal(outcome.failedAtStep, null);
  assert.deepEqual(succeededProcedureNodeFieldIds(outcome.succeededSteps), ["n1"]);
  assert.deepEqual(succeededProcedureEdgeFieldIds(outcome.succeededSteps), ["e1"]);
  assert.deepEqual(succeededProcedureLayoutNodeIds(outcome.succeededSteps), ["n2"]);
  assert.deepEqual(succeededProcedureRouteEdgeIds(outcome.succeededSteps), ["e2"]);
});

test("success clearing: chains the returned updatedAt token from step to step, in the planned order", async () => {
  const steps = planProcedureSaveSteps({
    dirtyNodeFieldEntries: [["n1", unchangedNodeDraft()]],
    dirtyEdgeFieldEntries: [["e1", unchangedEdgeDraft()]],
    dirtyPositionNodeIds: ["n2"],
    dirtyRouteEdgeIds: [],
  });
  const seenTokens: string[] = [];
  const executeStep = async (_step: ProcedureSaveStep, expectedUpdatedAt: string): Promise<ProcedureSaveStepResult> => {
    seenTokens.push(expectedUpdatedAt);
    return { ok: true, updatedAt: `next-${seenTokens.length}` };
  };
  const outcome = await runProcedureSaveSequence(steps, "t0", executeStep);
  assert.deepEqual(seenTokens, ["t0", "next-1", "next-2"]);
  assert.equal(outcome.finalUpdatedAt, "next-3");
});

test("success clearing: a failed EDGE_FIELDS step stops LAYOUT_AND_ROUTES from ever running, leaving it pending", async () => {
  const steps = planProcedureSaveSteps({
    dirtyNodeFieldEntries: [["n1", unchangedNodeDraft()]],
    dirtyEdgeFieldEntries: [["e1", unchangedEdgeDraft()]],
    dirtyPositionNodeIds: ["n2"],
    dirtyRouteEdgeIds: ["e2"],
  });
  let calls = 0;
  const executeStep = async (step: ProcedureSaveStep): Promise<ProcedureSaveStepResult> => {
    calls += 1;
    if (step.kind === "EDGE_FIELDS") return { ok: false, message: "동시성 충돌" };
    return { ok: true, updatedAt: `t${calls}` };
  };
  const outcome = await runProcedureSaveSequence(steps, "t0", executeStep);

  assert.equal(calls, 2); // NODE_FIELDS ran, EDGE_FIELDS ran and failed — LAYOUT_AND_ROUTES never ran
  assert.deepEqual(outcome.failedAtStep, { kind: "EDGE_FIELDS", edgeId: "e1" });
  assert.equal(outcome.failureMessage, "동시성 충돌");

  assert.deepEqual(succeededProcedureNodeFieldIds(outcome.succeededSteps), ["n1"]); // succeeded, stays cleared
  assert.deepEqual(succeededProcedureEdgeFieldIds(outcome.succeededSteps), []); // failed, stays pending
  assert.deepEqual(succeededProcedureLayoutNodeIds(outcome.succeededSteps), []); // never ran, stays pending
  assert.deepEqual(succeededProcedureRouteEdgeIds(outcome.succeededSteps), []); // never ran, stays pending
});

test("success clearing: a failed LAYOUT_AND_ROUTES step leaves ALL its node/edge ids pending (single batched mutation, not per-item)", async () => {
  const steps = planProcedureSaveSteps({
    dirtyNodeFieldEntries: [],
    dirtyEdgeFieldEntries: [],
    dirtyPositionNodeIds: ["n1", "n2"],
    dirtyRouteEdgeIds: ["e1"],
  });
  const executeStep = async (): Promise<ProcedureSaveStepResult> => ({ ok: false, message: "저장 실패" });
  const outcome = await runProcedureSaveSequence(steps, "t0", executeStep);
  assert.deepEqual(succeededProcedureLayoutNodeIds(outcome.succeededSteps), []);
  assert.deepEqual(succeededProcedureRouteEdgeIds(outcome.succeededSteps), []);
  assert.equal(outcome.finalUpdatedAt, "t0");
});

test("success clearing: never mutates its inputs (steps array, draft maps)", async () => {
  const dirtyNodeFieldEntries: [string, ProcedureNodeFieldDraft][] = [["n1", unchangedNodeDraft()]];
  const dirtyEdgeFieldEntries: [string, ProcedureEdgeFieldDraft][] = [["e1", unchangedEdgeDraft()]];
  const input = { dirtyNodeFieldEntries, dirtyEdgeFieldEntries, dirtyPositionNodeIds: ["n2"], dirtyRouteEdgeIds: ["e2"] };
  const inputCopy = JSON.parse(JSON.stringify(input));
  const steps = planProcedureSaveSteps(input);
  const stepsCopy = JSON.parse(JSON.stringify(steps));
  await runProcedureSaveSequence(steps, "t0", makeSuccessExecutor());
  assert.deepEqual(JSON.parse(JSON.stringify(input)), inputCopy);
  assert.deepEqual(JSON.parse(JSON.stringify(steps)), stepsCopy);
});
