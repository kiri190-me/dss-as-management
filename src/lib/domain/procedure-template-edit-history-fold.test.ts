import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { foldProcedureTemplateEditHistory, EventFoldError, type HistoryGroupEvent } from "./procedure-template-edit-history-fold";

function userEdit(changeGroupId: string, sequenceNumber: number): HistoryGroupEvent {
  return { changeGroupId, origin: "USER_EDIT", sourceGroupId: null, restoreTargetGroupId: null, sequenceNumber };
}
function restore(changeGroupId: string, sequenceNumber: number, restoreTargetGroupId: string): HistoryGroupEvent {
  return { changeGroupId, origin: "RESTORE", sourceGroupId: null, restoreTargetGroupId, sequenceNumber };
}
function undo(changeGroupId: string, sequenceNumber: number, sourceGroupId: string): HistoryGroupEvent {
  return { changeGroupId, origin: "UNDO", sourceGroupId, restoreTargetGroupId: null, sequenceNumber };
}
function redo(changeGroupId: string, sequenceNumber: number, sourceGroupId: string): HistoryGroupEvent {
  return { changeGroupId, origin: "REDO", sourceGroupId, restoreTargetGroupId: null, sequenceNumber };
}

describe("foldProcedureTemplateEditHistory", () => {
  test("empty history -> empty stacks", () => {
    const result = foldProcedureTemplateEditHistory([]);
    assert.deepEqual(result, { appliedStack: [], redoStack: [] });
  });

  test("a single USER_EDIT is pushed onto appliedStack", () => {
    const result = foldProcedureTemplateEditHistory([userEdit("A", 1)]);
    assert.deepEqual(result, { appliedStack: ["A"], redoStack: [] });
  });

  test("multi-step stack: A, B, C -> Undo C -> Undo B -> Redo B: next Undo targets B, next Redo targets C", () => {
    const events = [userEdit("A", 1), userEdit("B", 2), userEdit("C", 3), undo("U1", 4, "C"), undo("U2", 5, "B"), redo("R1", 6, "B")];
    const result = foldProcedureTemplateEditHistory(events);
    assert.deepEqual(result.appliedStack, ["A", "B"], "next Undo targets B (top of appliedStack)");
    assert.deepEqual(result.redoStack, ["C"], "next Redo targets C (top of redoStack)");
  });

  test("divergent new edit after Undo clears redoStack", () => {
    const events = [userEdit("A", 1), userEdit("B", 2), userEdit("C", 3), undo("U1", 4, "C"), userEdit("D", 5)];
    const result = foldProcedureTemplateEditHistory(events);
    assert.deepEqual(result.appliedStack, ["A", "B", "D"]);
    assert.deepEqual(result.redoStack, [], "Redo must be unavailable after a divergent new edit");
  });

  test("RESTORE behaves like USER_EDIT: pushes and clears redo, and its own group is a valid future Undo target", () => {
    const events = [userEdit("A", 1), undo("U1", 2, "A"), restore("R1", 3, "A")];
    const result = foldProcedureTemplateEditHistory(events);
    assert.deepEqual(result.appliedStack, ["R1"]);
    assert.deepEqual(result.redoStack, []);
  });

  test("Undo of a RESTORE-origin forward group is valid", () => {
    const events = [userEdit("A", 1), restore("R1", 2, "A"), undo("U1", 3, "R1")];
    const result = foldProcedureTemplateEditHistory(events);
    assert.deepEqual(result.appliedStack, ["A"], "A remains beneath R1 on the stack — RESTORE only pushes its own group id");
    assert.deepEqual(result.redoStack, ["R1"]);
  });

  test("UNDO whose source_group_id does not match top(appliedStack) fails explicitly", () => {
    const events = [userEdit("A", 1), userEdit("B", 2), undo("U1", 3, "A")];
    assert.throws(() => foldProcedureTemplateEditHistory(events), EventFoldError);
  });

  test("UNDO against an empty appliedStack fails explicitly", () => {
    assert.throws(() => foldProcedureTemplateEditHistory([undo("U1", 1, "A")]), EventFoldError);
  });

  test("REDO whose source_group_id does not match top(redoStack) fails explicitly", () => {
    const events = [userEdit("A", 1), userEdit("B", 2), undo("U1", 3, "B"), redo("R1", 4, "A")];
    assert.throws(() => foldProcedureTemplateEditHistory(events), EventFoldError);
  });

  test("REDO against an empty redoStack fails explicitly", () => {
    assert.throws(() => foldProcedureTemplateEditHistory([redo("R1", 1, "A")]), EventFoldError);
  });

  test("out-of-order sequence_number input fails explicitly", () => {
    assert.throws(() => foldProcedureTemplateEditHistory([userEdit("A", 5), userEdit("B", 2)]), EventFoldError);
  });

  test("UNDO with a null source_group_id fails explicitly", () => {
    const bad: HistoryGroupEvent = { changeGroupId: "U1", origin: "UNDO", sourceGroupId: null, restoreTargetGroupId: null, sequenceNumber: 1 };
    assert.throws(() => foldProcedureTemplateEditHistory([bad]), EventFoldError);
  });
});
