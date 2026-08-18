import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mergeNodeForRender,
  mergeEdgeForRender,
  computeDirtyNodeEntries,
  computeDirtyEdgeEntries,
  computeDirtyRouteEdgeIds,
  computeDirtyPositionNodeIds,
  planSaveSteps,
  runSaveSequence,
  fullySucceededNodeIds,
  fullySucceededEdgeIds,
  succeededRouteEdgeIds,
  succeededPositionNodeIds,
  type CaseFlowchartNodeDraft,
  type CaseFlowchartEdgeDraft,
  type ServerNodeSnapshot,
  type ServerEdgeSnapshot,
  type SaveStep,
  type SaveStepResult,
} from "./repair-case-flowchart-editor-save-state";

/**
 * Targeted pure tests for the live-preview + explicit-save editor model
 * (5C-6D follow-up #2). Deliberately the smallest testable unit: pure
 * render-merge + dirty-detection + step-planning + step-sequencing logic,
 * zero React, zero server-action imports. A component-level render test for
 * CaseFlowchartEditorScreen was not attempted — this project's node:test
 * harness (`node --conditions=react-server --import tsx --test`, no Next.js
 * runtime) cannot statically render a client component that transitively
 * imports a "use server" action module (server-only throws outside Next's
 * own conditions); this is an existing, already-documented constraint (see
 * this file's earlier version and the procedure editor's own untested
 * action-calling panels, for the same reason).
 */

const serverNode: ServerNodeSnapshot = { id: "n1", title: "원래 제목", description: "원래 설명", instructions: "원래 지시", nodeType: "TASK", positionX: 500, positionY: 300 };
const serverEdge: ServerEdgeSnapshot = { id: "e1", branchType: "DEFAULT", branchLabel: null, fromNodeId: "n1", toNodeId: "n2", routePoints: null };

// ==================== LIVE PREVIEW (merge) ====================

test("mergeNodeForRender: no pending draft/position renders the server baseline unchanged", () => {
  const rendered = mergeNodeForRender(serverNode, undefined, undefined);
  assert.deepEqual(rendered, serverNode);
});

test("mergeNodeForRender: pending title overrides the baseline title", () => {
  const draft: CaseFlowchartNodeDraft = { title: "Driver Board 점검", description: serverNode.description ?? "", instructions: serverNode.instructions ?? "", nodeType: serverNode.nodeType };
  const rendered = mergeNodeForRender(serverNode, draft, undefined);
  assert.equal(rendered.title, "Driver Board 점검");
});

test("mergeNodeForRender: pending nodeType overrides the baseline type", () => {
  const draft: CaseFlowchartNodeDraft = { title: serverNode.title, description: serverNode.description ?? "", instructions: serverNode.instructions ?? "", nodeType: "DECISION" };
  const rendered = mergeNodeForRender(serverNode, draft, undefined);
  assert.equal(rendered.nodeType, "DECISION");
});

test("mergeNodeForRender: pending instructions overrides the baseline instructions", () => {
  const draft: CaseFlowchartNodeDraft = { title: serverNode.title, description: serverNode.description ?? "", instructions: "새 작업 지시 요약", nodeType: serverNode.nodeType };
  const rendered = mergeNodeForRender(serverNode, draft, undefined);
  assert.equal(rendered.instructions, "새 작업 지시 요약");
});

test("mergeNodeForRender: pending instructions cleared to empty string renders as null (same rule as description)", () => {
  const draft: CaseFlowchartNodeDraft = { title: serverNode.title, description: serverNode.description ?? "", instructions: "", nodeType: serverNode.nodeType };
  const rendered = mergeNodeForRender(serverNode, draft, undefined);
  assert.equal(rendered.instructions, null);
});

test("mergeNodeForRender: pending position overrides the baseline positionX/positionY", () => {
  const rendered = mergeNodeForRender(serverNode, undefined, { x: 700, y: 330 });
  assert.equal(rendered.positionX, 700);
  assert.equal(rendered.positionY, 330);
});

test("mergeNodeForRender: title, type, and position overrides all apply together", () => {
  const draft: CaseFlowchartNodeDraft = { title: "새 제목", description: "새 설명", instructions: "새 지시", nodeType: "DECISION" };
  const rendered = mergeNodeForRender(serverNode, draft, { x: 10, y: 20 });
  assert.deepEqual(rendered, { id: "n1", title: "새 제목", description: "새 설명", instructions: "새 지시", nodeType: "DECISION", positionX: 10, positionY: 20 });
});

test("mergeEdgeForRender: no pending draft/route renders the server baseline unchanged", () => {
  const rendered = mergeEdgeForRender(serverEdge, undefined, undefined);
  assert.deepEqual(rendered, serverEdge);
});

test("mergeEdgeForRender: pending branch type overrides the baseline (e.g. DEFAULT -> NG)", () => {
  const draft: CaseFlowchartEdgeDraft = { branchType: "NG", branchLabel: "", fromNodeId: serverEdge.fromNodeId, toNodeId: serverEdge.toNodeId };
  const rendered = mergeEdgeForRender(serverEdge, draft, undefined);
  assert.equal(rendered.branchType, "NG");
});

test("mergeEdgeForRender: pending retarget overrides fromNodeId/toNodeId", () => {
  const draft: CaseFlowchartEdgeDraft = { branchType: serverEdge.branchType, branchLabel: "", fromNodeId: "n1", toNodeId: "n3" };
  const rendered = mergeEdgeForRender(serverEdge, draft, undefined);
  assert.equal(rendered.toNodeId, "n3");
});

test("mergeEdgeForRender: pending route (present in map, non-null) overrides the baseline route", () => {
  const rendered = mergeEdgeForRender(serverEdge, undefined, [{ x: 10, y: 20 }]);
  assert.deepEqual(rendered.routePoints, [{ x: 10, y: 20 }]);
});

test("mergeEdgeForRender: pending route explicitly reset to null (key present, value null) overrides a non-null baseline route", () => {
  const baselineWithRoute: ServerEdgeSnapshot = { ...serverEdge, routePoints: [{ x: 1, y: 1 }] };
  const rendered = mergeEdgeForRender(baselineWithRoute, undefined, null);
  assert.equal(rendered.routePoints, null);
});

test("mergeEdgeForRender: route key absent (undefined) falls back to the baseline route, distinct from an explicit null override", () => {
  const baselineWithRoute: ServerEdgeSnapshot = { ...serverEdge, routePoints: [{ x: 1, y: 1 }] };
  const rendered = mergeEdgeForRender(baselineWithRoute, undefined, undefined);
  assert.deepEqual(rendered.routePoints, [{ x: 1, y: 1 }]);
});

// ==================== DIRTY ====================

test("unchanged node draft is not dirty", () => {
  const draft: CaseFlowchartNodeDraft = { title: serverNode.title, description: serverNode.description ?? "", instructions: serverNode.instructions ?? "", nodeType: serverNode.nodeType };
  const entries = computeDirtyNodeEntries(new Map([["n1", draft]]), new Map([["n1", serverNode]]));
  assert.deepEqual(entries, []);
});

test("changed node title makes the entry dirty", () => {
  const draft: CaseFlowchartNodeDraft = { title: "새 제목", description: serverNode.description ?? "", instructions: serverNode.instructions ?? "", nodeType: serverNode.nodeType };
  const entries = computeDirtyNodeEntries(new Map([["n1", draft]]), new Map([["n1", serverNode]]));
  assert.equal(entries.length, 1);
  assert.equal(entries[0][0], "n1");
});

test("changed node instructions (with title/description/type unchanged) makes the entry dirty", () => {
  const draft: CaseFlowchartNodeDraft = { title: serverNode.title, description: serverNode.description ?? "", instructions: "새 작업 지시 요약", nodeType: serverNode.nodeType };
  const entries = computeDirtyNodeEntries(new Map([["n1", draft]]), new Map([["n1", serverNode]]));
  assert.equal(entries.length, 1);
  assert.equal(entries[0][0], "n1");
});

test("a draft referencing a deleted node never counts as dirty", () => {
  const draft: CaseFlowchartNodeDraft = { title: "새 제목", description: "", instructions: "", nodeType: "TASK" };
  const entries = computeDirtyNodeEntries(new Map([["ghost", draft]]), new Map());
  assert.deepEqual(entries, []);
});

test("unchanged edge draft is not dirty", () => {
  const draft: CaseFlowchartEdgeDraft = { branchType: serverEdge.branchType, branchLabel: serverEdge.branchLabel ?? "", fromNodeId: serverEdge.fromNodeId, toNodeId: serverEdge.toNodeId };
  const entries = computeDirtyEdgeEntries(new Map([["e1", draft]]), new Map([["e1", serverEdge]]));
  assert.deepEqual(entries, []);
});

test("changed edge branch type makes the entry dirty", () => {
  const draft: CaseFlowchartEdgeDraft = { branchType: "CUSTOM", branchLabel: "특이 케이스", fromNodeId: serverEdge.fromNodeId, toNodeId: serverEdge.toNodeId };
  const entries = computeDirtyEdgeEntries(new Map([["e1", draft]]), new Map([["e1", serverEdge]]));
  assert.equal(entries.length, 1);
});

test("changed edge retarget (fromNodeId/toNodeId) makes the entry dirty", () => {
  const draft: CaseFlowchartEdgeDraft = { branchType: serverEdge.branchType, branchLabel: "", fromNodeId: "n1", toNodeId: "n3" };
  const entries = computeDirtyEdgeEntries(new Map([["e1", draft]]), new Map([["e1", serverEdge]]));
  assert.equal(entries.length, 1);
});

test("unchanged route (null vs null, or empty vs null) is not dirty", () => {
  const ids1 = computeDirtyRouteEdgeIds(new Map([["e1", null]]), new Map([["e1", serverEdge]]));
  assert.deepEqual(ids1, []);
  const ids2 = computeDirtyRouteEdgeIds(new Map([["e1", []]]), new Map([["e1", serverEdge]]));
  assert.deepEqual(ids2, []);
});

test("changed route (new waypoint) is dirty", () => {
  const ids = computeDirtyRouteEdgeIds(new Map([["e1", [{ x: 10, y: 20 }]]]), new Map([["e1", serverEdge]]));
  assert.deepEqual(ids, ["e1"]);
});

test("moved node alone is dirty (position), with no node-property or edge dirtiness implied", () => {
  const ids = computeDirtyPositionNodeIds(new Map([["n1", { x: 700, y: 330 }]]), new Map([["n1", serverNode]]));
  assert.deepEqual(ids, ["n1"]);
});

test("unmoved node (pending position equals baseline) is not dirty", () => {
  const ids = computeDirtyPositionNodeIds(new Map([["n1", { x: serverNode.positionX, y: serverNode.positionY }]]), new Map([["n1", serverNode]]));
  assert.deepEqual(ids, []);
});

test("a pending position dragged back to the exact baseline position reverts to not-dirty", () => {
  // Simulates: drag away, then drag back to (500, 300) before Save — same rule as every other draft field.
  const ids = computeDirtyPositionNodeIds(new Map([["n1", { x: 500, y: 300 }]]), new Map([["n1", serverNode]]));
  assert.deepEqual(ids, []);
});

test("a position draft referencing a deleted node never counts as dirty", () => {
  const ids = computeDirtyPositionNodeIds(new Map([["ghost", { x: 1, y: 1 }]]), new Map());
  assert.deepEqual(ids, []);
});

// ==================== SAVE PLAN ====================

test("planSaveSteps orders: node changes, then node positions (one batched step), then edge changes, then route changes", () => {
  const dirtyNodeDraft: CaseFlowchartNodeDraft = { title: "새 제목", description: "새 설명", instructions: "새 지시", nodeType: "DECISION" };
  const dirtyEdgeDraft: CaseFlowchartEdgeDraft = { branchType: "CUSTOM", branchLabel: "특이", fromNodeId: "n1", toNodeId: "n3" };
  const steps = planSaveSteps({
    dirtyNodes: [["n1", dirtyNodeDraft]],
    serverNodesById: new Map([["n1", serverNode]]),
    dirtyPositionNodeIds: ["n1", "n2"],
    dirtyEdges: [["e1", dirtyEdgeDraft]],
    serverEdgesById: new Map([["e1", serverEdge]]),
    dirtyRouteEdgeIds: ["e1"],
  });
  assert.deepEqual(steps, [
    { kind: "NODE_FIELDS", nodeId: "n1" },
    { kind: "NODE_TYPE", nodeId: "n1" },
    { kind: "NODE_POSITIONS", nodeIds: ["n1", "n2"] },
    { kind: "EDGE_FIELDS", edgeId: "e1" },
    { kind: "EDGE_RETARGET", edgeId: "e1" },
    { kind: "EDGE_ROUTE", edgeId: "e1" },
  ]);
});

test("planSaveSteps omits the NODE_POSITIONS step entirely when no position is dirty", () => {
  const steps = planSaveSteps({
    dirtyNodes: [],
    serverNodesById: new Map(),
    dirtyPositionNodeIds: [],
    dirtyEdges: [],
    serverEdgesById: new Map(),
    dirtyRouteEdgeIds: [],
  });
  assert.deepEqual(steps, []);
});

test("planSaveSteps emits only the fields actually needing change (type-only change emits no NODE_FIELDS step)", () => {
  const typeOnlyDraft: CaseFlowchartNodeDraft = { title: serverNode.title, description: serverNode.description ?? "", instructions: serverNode.instructions ?? "", nodeType: "DECISION" };
  const steps = planSaveSteps({
    dirtyNodes: [["n1", typeOnlyDraft]],
    serverNodesById: new Map([["n1", serverNode]]),
    dirtyPositionNodeIds: [],
    dirtyEdges: [],
    serverEdgesById: new Map(),
    dirtyRouteEdgeIds: [],
  });
  assert.deepEqual(steps, [{ kind: "NODE_TYPE", nodeId: "n1" }]);
});

test("planSaveSteps emits NODE_FIELDS for an instructions-only change (title/description/type unchanged)", () => {
  const instructionsOnlyDraft: CaseFlowchartNodeDraft = { title: serverNode.title, description: serverNode.description ?? "", instructions: "새 작업 지시 요약", nodeType: serverNode.nodeType };
  const steps = planSaveSteps({
    dirtyNodes: [["n1", instructionsOnlyDraft]],
    serverNodesById: new Map([["n1", serverNode]]),
    dirtyPositionNodeIds: [],
    dirtyEdges: [],
    serverEdgesById: new Map(),
    dirtyRouteEdgeIds: [],
  });
  assert.deepEqual(steps, [{ kind: "NODE_FIELDS", nodeId: "n1" }]);
});

function makeSuccessExecutor(sequenceLog: string[]): (step: SaveStep, expectedUpdatedAt: string) => Promise<SaveStepResult> {
  let counter = 0;
  return async (step, expectedUpdatedAt) => {
    counter += 1;
    const label = "nodeId" in step ? step.nodeId : "edgeId" in step ? step.edgeId : step.nodeIds.join(",");
    sequenceLog.push(`${step.kind}:${label}@${expectedUpdatedAt}`);
    return { ok: true, updatedAt: `t${counter}` };
  };
}

test("save all pending changes: one call flushes node + position + edge + route changes, in order, chaining updatedAt", async () => {
  const nodeDraft: CaseFlowchartNodeDraft = { title: "새 제목", description: "", instructions: "", nodeType: "TASK" };
  const edgeDraft: CaseFlowchartEdgeDraft = { branchType: "NORMAL", branchLabel: "", fromNodeId: "n1", toNodeId: "n2" };
  const steps = planSaveSteps({
    dirtyNodes: [["n1", nodeDraft]],
    serverNodesById: new Map([["n1", serverNode]]),
    dirtyPositionNodeIds: ["n1"],
    dirtyEdges: [["e1", edgeDraft]],
    serverEdgesById: new Map([["e1", serverEdge]]),
    dirtyRouteEdgeIds: ["e1"],
  });
  const log: string[] = [];
  const outcome = await runSaveSequence(steps, "t0", makeSuccessExecutor(log));

  assert.equal(outcome.failedAtStep, null);
  assert.equal(outcome.succeededSteps.length, 4);
  assert.equal(outcome.finalUpdatedAt, "t4");
  assert.deepEqual(log, ["NODE_FIELDS:n1@t0", "NODE_POSITIONS:n1@t1", "EDGE_FIELDS:e1@t2", "EDGE_ROUTE:e1@t3"]);
});

test("successful save clears every pending entry that was flushed, including positions", async () => {
  const nodeDraft: CaseFlowchartNodeDraft = { title: "새 제목", description: "", instructions: "", nodeType: "TASK" };
  const steps = planSaveSteps({
    dirtyNodes: [["n1", nodeDraft]],
    serverNodesById: new Map([["n1", serverNode]]),
    dirtyPositionNodeIds: ["n1", "n2"],
    dirtyEdges: [],
    serverEdgesById: new Map(),
    dirtyRouteEdgeIds: [],
  });
  const outcome = await runSaveSequence(steps, "t0", makeSuccessExecutor([]));
  assert.deepEqual(fullySucceededNodeIds(steps, outcome.succeededSteps), ["n1"]);
  assert.deepEqual(succeededPositionNodeIds(outcome.succeededSteps), ["n1", "n2"]);
});

test("first failure stops subsequent steps and leaves them unrun", async () => {
  const nodeDraft: CaseFlowchartNodeDraft = { title: "새 제목", description: "", instructions: "", nodeType: "DECISION" }; // dirty in both fields + type
  const edgeDraft: CaseFlowchartEdgeDraft = { branchType: "CUSTOM", branchLabel: "특이", fromNodeId: "n1", toNodeId: "n2" };
  const steps = planSaveSteps({
    dirtyNodes: [["n1", nodeDraft]],
    serverNodesById: new Map([["n1", serverNode]]),
    dirtyPositionNodeIds: ["n1"],
    dirtyEdges: [["e1", edgeDraft]],
    serverEdgesById: new Map([["e1", serverEdge]]),
    dirtyRouteEdgeIds: ["e1"],
  });
  // steps: NODE_FIELDS(n1), NODE_TYPE(n1), NODE_POSITIONS([n1]), EDGE_FIELDS(e1), EDGE_ROUTE(e1) — fail on the 2nd step (NODE_TYPE).
  let calls = 0;
  const executeStep = async (step: SaveStep): Promise<SaveStepResult> => {
    calls += 1;
    if (step.kind === "NODE_TYPE") return { ok: false, message: "저장 실패" };
    return { ok: true, updatedAt: `t${calls}` };
  };

  const outcome = await runSaveSequence(steps, "t0", executeStep);

  assert.equal(calls, 2); // NODE_FIELDS ran, NODE_TYPE ran and failed — NODE_POSITIONS/EDGE_FIELDS/EDGE_ROUTE never ran
  assert.deepEqual(outcome.failedAtStep, { kind: "NODE_TYPE", nodeId: "n1" });
  assert.equal(outcome.failureMessage, "저장 실패");
  assert.equal(outcome.succeededSteps.length, 1);
  assert.equal(outcome.finalUpdatedAt, "t1"); // the one step that DID succeed still advanced the token

  // The node had two planned property steps but only one succeeded — must NOT be reported as fully flushed.
  assert.deepEqual(fullySucceededNodeIds(steps, outcome.succeededSteps), []);
  // Positions, edge fields, and route never even ran, so they must all stay pending too.
  assert.deepEqual(succeededPositionNodeIds(outcome.succeededSteps), []);
  assert.deepEqual(fullySucceededEdgeIds(steps, outcome.succeededSteps), []);
  assert.deepEqual(succeededRouteEdgeIds(outcome.succeededSteps), []);
});

test("a node with two planned property steps (fields + type) is fully flushed only once both succeed", async () => {
  const nodeDraft: CaseFlowchartNodeDraft = { title: "새 제목", description: "새 설명", instructions: "", nodeType: "DECISION" };
  const steps = planSaveSteps({
    dirtyNodes: [["n1", nodeDraft]],
    serverNodesById: new Map([["n1", serverNode]]),
    dirtyPositionNodeIds: [],
    dirtyEdges: [],
    serverEdgesById: new Map(),
    dirtyRouteEdgeIds: [],
  });
  assert.equal(steps.length, 2);
  const outcome = await runSaveSequence(steps, "t0", makeSuccessExecutor([]));
  assert.deepEqual(fullySucceededNodeIds(steps, outcome.succeededSteps), ["n1"]);
});

test("a failed NODE_POSITIONS step leaves ALL its listed node ids pending (single batched mutation, not per-node)", async () => {
  const steps = planSaveSteps({
    dirtyNodes: [],
    serverNodesById: new Map(),
    dirtyPositionNodeIds: ["n1", "n2", "n3"],
    dirtyEdges: [],
    serverEdgesById: new Map(),
    dirtyRouteEdgeIds: [],
  });
  const executeStep = async (): Promise<SaveStepResult> => ({ ok: false, message: "동시성 충돌" });
  const outcome = await runSaveSequence(steps, "t0", executeStep);
  assert.deepEqual(succeededPositionNodeIds(outcome.succeededSteps), []);
  assert.equal(outcome.finalUpdatedAt, "t0");
});
