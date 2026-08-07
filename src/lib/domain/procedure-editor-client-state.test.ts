import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeUnsavedNodeIds,
  computeUnsavedEdgeIds,
  computeUnsavedLayoutNodeIds,
  computeUnsavedEdgeRouteIds,
  computeEditorSaveState,
  buildEdgeRetargetPreview,
  buildNewEdgePreview,
  type EditableNodeFields,
  type EditableEdgeFields,
  type NodeLookup,
} from "./procedure-editor-client-state";

function nodeFields(overrides: Partial<EditableNodeFields> = {}): EditableNodeFields {
  return { title: "제목", description: null, instructions: null, sortOrder: 0, isActive: true, nodeType: "TASK", ...overrides };
}
function edgeFields(overrides: Partial<EditableEdgeFields> = {}): EditableEdgeFields {
  return { fromNodeId: "a", toNodeId: "b", branchType: "DEFAULT", branchLabel: null, ...overrides };
}

test("computeUnsavedNodeIds: identical saved/working state has no unsaved ids", () => {
  const saved = new Map([["n1", nodeFields()]]);
  const working = new Map([["n1", nodeFields()]]);
  assert.deepEqual(computeUnsavedNodeIds(saved, working), new Set());
});

test("computeUnsavedNodeIds: a changed title marks that node id unsaved, and no others", () => {
  const saved = new Map([
    ["n1", nodeFields({ title: "원래" })],
    ["n2", nodeFields({ title: "그대로" })],
  ]);
  const working = new Map([
    ["n1", nodeFields({ title: "수정됨" })],
    ["n2", nodeFields({ title: "그대로" })],
  ]);
  assert.deepEqual(computeUnsavedNodeIds(saved, working), new Set(["n1"]));
});

test("computeUnsavedNodeIds: a node type change alone is detected as unsaved", () => {
  const saved = new Map([["n1", nodeFields({ nodeType: "TASK" })]]);
  const working = new Map([["n1", nodeFields({ nodeType: "INSPECTION" })]]);
  assert.deepEqual(computeUnsavedNodeIds(saved, working), new Set(["n1"]));
});

test("computeUnsavedEdgeIds: a retargeted (endpoint-changed) edge is unsaved", () => {
  const saved = new Map([["e1", edgeFields({ toNodeId: "b" })]]);
  const working = new Map([["e1", edgeFields({ toNodeId: "z" })]]);
  assert.deepEqual(computeUnsavedEdgeIds(saved, working), new Set(["e1"]));
});

test("computeUnsavedLayoutNodeIds: only nodes whose position actually changed are unsaved", () => {
  const saved = new Map([
    ["n1", { x: 10, y: 20 }],
    ["n2", { x: 30, y: 40 }],
  ]);
  const working = new Map([
    ["n1", { x: 10, y: 20 }],
    ["n2", { x: 999, y: 40 }],
  ]);
  assert.deepEqual(computeUnsavedLayoutNodeIds(saved, working), new Set(["n2"]));
});

test("computeUnsavedEdgeRouteIds: only edges whose manual route actually changed are unsaved", () => {
  const saved = new Map([
    ["e1", [{ x: 1, y: 1 }]],
    ["e2", null],
  ]);
  const working = new Map([
    ["e1", [{ x: 1, y: 1 }]],
    ["e2", [{ x: 5, y: 5 }]],
  ]);
  assert.deepEqual(computeUnsavedEdgeRouteIds(saved, working), new Set(["e2"]));
});

test("computeUnsavedEdgeRouteIds: null and an empty array are equally 'not unsaved' against a null baseline", () => {
  const saved = new Map([["e1", null]]);
  const working = new Map([["e1", []]]);
  assert.deepEqual(computeUnsavedEdgeRouteIds(saved, working), new Set());
});

test("computeUnsavedEdgeRouteIds: an edge absent from working (never touched this session) is never marked unsaved", () => {
  const saved = new Map([["e1", [{ x: 1, y: 1 }]]]);
  const working = new Map<string, { x: number; y: number }[] | null>();
  assert.deepEqual(computeUnsavedEdgeRouteIds(saved, working), new Set());
});

test("computeUnsavedEdgeRouteIds: explicitly clearing a route (working=null against a saved override) is detected as unsaved", () => {
  const saved = new Map([["e1", [{ x: 1, y: 1 }]]]);
  const working = new Map<string, { x: number; y: number }[] | null>([["e1", null]]);
  assert.deepEqual(computeUnsavedEdgeRouteIds(saved, working), new Set(["e1"]));
});

test("computeEditorSaveState: SAVING takes priority over everything else", () => {
  const state = computeEditorSaveState({ isSaving: true, lastSaveFailed: true, unsavedNodeIds: new Set(["n1"]), unsavedEdgeIds: new Set(), unsavedLayoutNodeIds: new Set(), unsavedEdgeRouteIds: new Set() });
  assert.equal(state, "SAVING");
});

test("computeEditorSaveState: SAVE_FAILED shows when not currently saving but the last attempt failed", () => {
  const state = computeEditorSaveState({ isSaving: false, lastSaveFailed: true, unsavedNodeIds: new Set(), unsavedEdgeIds: new Set(), unsavedLayoutNodeIds: new Set(), unsavedEdgeRouteIds: new Set() });
  assert.equal(state, "SAVE_FAILED");
});

test("computeEditorSaveState: UNSAVED when any of node/edge/layout/edge-route has pending changes", () => {
  const base = { isSaving: false, lastSaveFailed: false, unsavedNodeIds: new Set<string>(), unsavedEdgeIds: new Set<string>(), unsavedLayoutNodeIds: new Set<string>(), unsavedEdgeRouteIds: new Set<string>() };
  assert.equal(computeEditorSaveState({ ...base, unsavedNodeIds: new Set(["n1"]) }), "UNSAVED");
  assert.equal(computeEditorSaveState({ ...base, unsavedEdgeIds: new Set(["e1"]) }), "UNSAVED");
  assert.equal(computeEditorSaveState({ ...base, unsavedLayoutNodeIds: new Set(["n1"]) }), "UNSAVED");
  assert.equal(computeEditorSaveState({ ...base, unsavedEdgeRouteIds: new Set(["e1"]) }), "UNSAVED");
});

test("computeEditorSaveState: SAVED when nothing is pending and nothing failed", () => {
  const state = computeEditorSaveState({ isSaving: false, lastSaveFailed: false, unsavedNodeIds: new Set(), unsavedEdgeIds: new Set(), unsavedLayoutNodeIds: new Set(), unsavedEdgeRouteIds: new Set() });
  assert.equal(state, "SAVED");
});

test("computeEditorSaveState: pure selection/zoom/pan never produces a dirty edge-route id (nothing to mark unsaved with an empty set)", () => {
  // Selection/zoom/pan never touch pendingEdgeRouteMoves at all in the
  // editor screen, so unsavedEdgeRouteIds is always empty from those
  // interactions alone — this test documents that computeEditorSaveState
  // has no other, hidden way to go UNSAVED from an empty set.
  const state = computeEditorSaveState({ isSaving: false, lastSaveFailed: false, unsavedNodeIds: new Set(), unsavedEdgeIds: new Set(), unsavedLayoutNodeIds: new Set(), unsavedEdgeRouteIds: new Set() });
  assert.equal(state, "SAVED");
});

test("buildEdgeRetargetPreview: resolves both current and proposed endpoint titles/codes, keeping the original branch info", () => {
  const nodesById = new Map<string, NodeLookup>([
    ["a", { id: "a", title: "시작", nodeCode: "n1" }],
    ["b", { id: "b", title: "원래 대상", nodeCode: "n2" }],
    ["z", { id: "z", title: "새 대상", nodeCode: "n9" }],
  ]);
  const result = buildEdgeRetargetPreview({ fromNodeId: "a", toNodeId: "b", branchType: "NG", branchLabel: "NG" }, { fromNodeId: "a", toNodeId: "z" }, nodesById);
  assert.equal(result.current.to.title, "원래 대상");
  assert.equal(result.proposed.to.title, "새 대상");
  assert.equal(result.proposed.from.title, "시작");
  assert.equal(result.proposed.branchType, "NG");
});

test("buildEdgeRetargetPreview: an unknown node id resolves to a clear placeholder, never throws", () => {
  const result = buildEdgeRetargetPreview({ fromNodeId: "a", toNodeId: "b", branchType: "DEFAULT", branchLabel: null }, { fromNodeId: "a", toNodeId: "does-not-exist" }, new Map());
  assert.equal(result.proposed.to.title, "(알 수 없는 노드)");
});

test("buildNewEdgePreview: builds a from/to preview for a not-yet-created connection", () => {
  const nodesById = new Map<string, NodeLookup>([
    ["a", { id: "a", title: "시작", nodeCode: "n1" }],
    ["b", { id: "b", title: "대상", nodeCode: "n2" }],
  ]);
  const result = buildNewEdgePreview({ fromNodeId: "a", toNodeId: "b", branchType: "CUSTOM", branchLabel: "특수" }, nodesById);
  assert.equal(result.from.title, "시작");
  assert.equal(result.to.title, "대상");
  assert.equal(result.branchLabel, "특수");
});
