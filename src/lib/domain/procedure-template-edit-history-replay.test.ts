import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { reconstructStateAtSequenceNumber, ReplayError, type ReplayHistoryRow, type ReplayNodeState, type ReplayEdgeState } from "./procedure-template-edit-history-replay";

let seq = 0;
function nextSeq(): number {
  seq += 1;
  return seq;
}

function row(partial: Partial<ReplayHistoryRow> & Pick<ReplayHistoryRow, "actionType">): ReplayHistoryRow {
  return {
    id: `row-${nextSeq()}`,
    changeGroupId: partial.changeGroupId ?? `group-${seq}`,
    origin: "USER_EDIT",
    sourceGroupId: null,
    sequenceNumber: nextSeq(),
    nodeId: null,
    edgeId: null,
    beforeState: null,
    afterState: null,
    ...partial,
  };
}

function nodeSnapshot(overrides: Partial<ReplayNodeState> & Pick<ReplayNodeState, "id">): ReplayNodeState {
  return {
    nodeCode: `manual-${overrides.id}`,
    nodeType: "TASK",
    title: "노드",
    description: null,
    objective: null,
    preparation: null,
    toolsAndEquipment: null,
    safetyCaution: null,
    instructions: null,
    expectedNormalResult: null,
    ngSymptoms: null,
    recommendedCorrectiveAction: null,
    acceptanceCriteria: null,
    workerMayAddNextTask: true,
    positionX: 0,
    positionY: 0,
    userPositionX: null,
    userPositionY: null,
    sortOrder: 0,
    sourceWorksheet: null,
    sourceShapeId: null,
    sourceCellRange: null,
    isActive: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function edgeState(overrides: Partial<ReplayEdgeState> & Pick<ReplayEdgeState, "id" | "fromNodeId" | "toNodeId">): ReplayEdgeState {
  return {
    branchType: "DEFAULT",
    branchLabel: null,
    conditionDefinition: null,
    sortOrder: 0,
    sourceConnectorId: null,
    clonedFromEdgeId: null,
    userRoutePoints: null,
    ...overrides,
  };
}

describe("reconstructStateAtSequenceNumber", () => {
  test("empty history reconstructs an empty graph with the current template name", () => {
    const result = reconstructStateAtSequenceNumber([], 0, "현재 이름");
    assert.equal(result.templateName, "현재 이름");
    assert.equal(result.nodes.size, 0);
    assert.equal(result.edges.size, 0);
  });

  test("CREATE_NODE then UPDATE_NODE reconstructs the merged state at the cutoff", () => {
    const created = row({ actionType: "CREATE_NODE", nodeId: "n1", afterState: nodeSnapshot({ id: "n1", title: "원래" }) });
    const updated = row({ actionType: "UPDATE_NODE", nodeId: "n1", beforeState: { title: "원래", description: null, instructions: null, sortOrder: 0, isActive: true }, afterState: { title: "수정됨", description: null, instructions: null, sortOrder: 0, isActive: true } });
    const rows = [created, updated];

    const atCreate = reconstructStateAtSequenceNumber(rows, created.sequenceNumber, "x");
    assert.equal(atCreate.nodes.get("n1")!.title, "원래");

    const atUpdate = reconstructStateAtSequenceNumber(rows, updated.sequenceNumber, "x");
    assert.equal(atUpdate.nodes.get("n1")!.title, "수정됨");
  });

  test("create -> delete -> reconstructing before the delete still shows the node, after shows it gone", () => {
    const created = row({ actionType: "CREATE_NODE", nodeId: "n1", afterState: nodeSnapshot({ id: "n1" }) });
    const deleted = row({ actionType: "DELETE_NODE", nodeId: null, beforeState: nodeSnapshot({ id: "n1" }) }); // node_id already nulled by the real delete cascade
    const rows = [created, deleted];

    assert.equal(reconstructStateAtSequenceNumber(rows, created.sequenceNumber, "x").nodes.has("n1"), true);
    assert.equal(reconstructStateAtSequenceNumber(rows, deleted.sequenceNumber, "x").nodes.has("n1"), false);
  });

  test("UPDATE_NODE with a null node_id (identity lost to a later delete) fails explicitly", () => {
    const updated = row({ actionType: "UPDATE_NODE", nodeId: null, beforeState: { title: "a" }, afterState: { title: "b" } });
    assert.throws(() => reconstructStateAtSequenceNumber([updated], updated.sequenceNumber, "x"), ReplayError);
  });

  test("CREATE_EDGE with a live edge_id resolves identity directly", () => {
    const n1 = row({ actionType: "CREATE_NODE", nodeId: "n1", afterState: nodeSnapshot({ id: "n1" }) });
    const n2 = row({ actionType: "CREATE_NODE", nodeId: "n2", afterState: nodeSnapshot({ id: "n2" }) });
    const e1 = row({ actionType: "CREATE_EDGE", edgeId: "e1", afterState: { fromNodeId: "n1", toNodeId: "n2", branchType: "DEFAULT", branchLabel: null } });
    const result = reconstructStateAtSequenceNumber([n1, n2, e1], e1.sequenceNumber, "x");
    assert.deepEqual(result.edges.get("e1"), edgeState({ id: "e1", fromNodeId: "n1", toNodeId: "n2" }));
  });

  test("CREATE_EDGE with edge_id nulled by its own Undo falls back to the UNDO-mirror snapshot", () => {
    const n1 = row({ actionType: "CREATE_NODE", nodeId: "n1", afterState: nodeSnapshot({ id: "n1" }) });
    const n2 = row({ actionType: "CREATE_NODE", nodeId: "n2", afterState: nodeSnapshot({ id: "n2" }) });
    const createGroup = "create-edge-group";
    const e1 = row({ actionType: "CREATE_EDGE", changeGroupId: createGroup, edgeId: null, afterState: { fromNodeId: "n1", toNodeId: "n2", branchType: "DEFAULT", branchLabel: null } });
    const undoMirror = row({
      actionType: "DELETE_EDGE",
      origin: "UNDO",
      sourceGroupId: createGroup,
      edgeId: "e1",
      beforeState: edgeState({ id: "e1", fromNodeId: "n1", toNodeId: "n2", sourceConnectorId: "c1" }),
    });
    const rows = [n1, n2, e1, undoMirror];
    // Reconstructing AT e1's own cutoff (before the undo mirror row exists in the walk) must still
    // resolve identity, since the mirror lookup scans the FULL row set, not just the walked prefix.
    const result = reconstructStateAtSequenceNumber(rows, e1.sequenceNumber, "x");
    assert.equal(result.edges.get("e1")!.sourceConnectorId, "c1", "recovered id/fields from the UNDO-mirror snapshot");
  });

  test("CREATE_EDGE with no live edge_id and no mirror fails explicitly", () => {
    const e1 = row({ actionType: "CREATE_EDGE", edgeId: null, afterState: { fromNodeId: "n1", toNodeId: "n2", branchType: "DEFAULT", branchLabel: null } });
    assert.throws(() => reconstructStateAtSequenceNumber([e1], e1.sequenceNumber, "x"), ReplayError);
  });

  test("SAVE_LAYOUT and SAVE_EDGE_ROUTE apply batched updates by self-identifying array elements", () => {
    const n1 = row({ actionType: "CREATE_NODE", nodeId: "n1", afterState: nodeSnapshot({ id: "n1" }) });
    const e1 = row({ actionType: "CREATE_EDGE", edgeId: "e1", afterState: { fromNodeId: "n1", toNodeId: "n1", branchType: "DEFAULT", branchLabel: null } });
    const layout = row({ actionType: "SAVE_LAYOUT", afterState: [{ nodeId: "n1", x: 10, y: 20 }] });
    const route = row({ actionType: "SAVE_EDGE_ROUTE", afterState: [{ edgeId: "e1", points: [{ x: 1, y: 1 }] }] });
    const result = reconstructStateAtSequenceNumber([n1, e1, layout, route], route.sequenceNumber, "x");
    assert.equal(result.nodes.get("n1")!.userPositionX, 10);
    assert.equal(result.nodes.get("n1")!.userPositionY, 20);
    assert.deepEqual(result.edges.get("e1")!.userRoutePoints, [{ x: 1, y: 1 }]);
  });

  test("template name is bootstrapped from the first UPDATE_TEMPLATE_METADATA row's beforeState when reconstructing before any rename", () => {
    const before = row({ actionType: "CREATE_NODE", nodeId: "n1", afterState: nodeSnapshot({ id: "n1" }) });
    const rename = row({ actionType: "UPDATE_TEMPLATE_METADATA", beforeState: { name: "생성 시 이름" }, afterState: { name: "변경된 이름" } });
    const rows = [before, rename];
    const atCreate = reconstructStateAtSequenceNumber(rows, before.sequenceNumber, "현재(라이브) 이름");
    assert.equal(atCreate.templateName, "생성 시 이름", "must recover the pre-rename name, not the live current one");
    const atRename = reconstructStateAtSequenceNumber(rows, rename.sequenceNumber, "현재(라이브) 이름");
    assert.equal(atRename.templateName, "변경된 이름");
  });

  test("a template never renamed uses the current live name for every cutoff", () => {
    const n1 = row({ actionType: "CREATE_NODE", nodeId: "n1", afterState: nodeSnapshot({ id: "n1" }) });
    const result = reconstructStateAtSequenceNumber([n1], n1.sequenceNumber, "변경된 적 없는 이름");
    assert.equal(result.templateName, "변경된 적 없는 이름");
  });

  test("VALIDATE_TEMPLATE and other unsupported action types are a correct no-op for reconstruction", () => {
    const n1 = row({ actionType: "CREATE_NODE", nodeId: "n1", afterState: nodeSnapshot({ id: "n1", title: "안정" }) });
    const validate = row({ actionType: "VALIDATE_TEMPLATE", afterState: { errorCount: 0, warningCount: 0, infoCount: 0 } });
    const result = reconstructStateAtSequenceNumber([n1, validate], validate.sequenceNumber, "x");
    assert.equal(result.nodes.get("n1")!.title, "안정", "VALIDATE_TEMPLATE must never alter graph state");
  });
});
