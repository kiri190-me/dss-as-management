import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createUndoStack,
  pushUndoStep,
  undoStep,
  redoStep,
  canUndo,
  canRedo,
  MAX_UNDO_STEPS,
} from "./undo-stack";

const eq = (a: string, b: string) => a === b;

test("되돌리기: 쌓은 직전 상태로 한 단계씩 돌아간다", () => {
  let stack = createUndoStack<string>();
  stack = pushUndoStep(stack, "A", eq); // A -> B로 바뀌기 직전
  stack = pushUndoStep(stack, "B", eq); // B -> C로 바뀌기 직전
  assert.equal(canUndo(stack), true);

  const first = undoStep(stack, "C", eq);
  assert.equal(first.restored, "B");
  const second = undoStep(first.stack, "B", eq);
  assert.equal(second.restored, "A");
  assert.equal(canUndo(second.stack), false);
});

test("다시 적용: 되돌린 만큼 앞으로 갈 수 있고, 새 조작이 생기면 그 미래는 사라진다", () => {
  let stack = createUndoStack<string>();
  stack = pushUndoStep(stack, "A", eq);
  const undone = undoStep(stack, "B", eq);
  assert.equal(undone.restored, "A");
  assert.equal(canRedo(undone.stack), true);

  const redone = redoStep(undone.stack, "A", eq);
  assert.equal(redone.restored, "B");

  // 되돌린 뒤 새 조작을 하면 다시 적용할 미래는 무효다
  const afterUndo = undoStep(redone.stack, "B", eq);
  const afterNewEdit = pushUndoStep(afterUndo.stack, "A", eq);
  assert.equal(canRedo(afterNewEdit), false);
});

test("아무것도 바꾸지 않은 조작은 빈 단계로 남지 않는다", () => {
  let stack = createUndoStack<string>();
  stack = pushUndoStep(stack, "A", eq);
  stack = pushUndoStep(stack, "A", eq); // 같은 상태 — 쌓이지 않는다
  assert.equal(stack.past.length, 1);
});

test("되돌릴 때 현재와 같은 단계는 건너뛰고, 없으면 restored는 null이다", () => {
  let stack = createUndoStack<string>();
  stack = pushUndoStep(stack, "A", eq);
  const result = undoStep(stack, "A", eq); // 현재가 이미 A
  assert.equal(result.restored, null);
  assert.equal(canUndo(result.stack), false, "헛도는 단계는 버려져 버튼이 꺼진다");
});

test("상한을 넘으면 가장 오래된 단계부터 버린다", () => {
  let stack = createUndoStack<string>();
  for (let i = 0; i < MAX_UNDO_STEPS + 10; i++) stack = pushUndoStep(stack, `s${i}`, eq);
  assert.equal(stack.past.length, MAX_UNDO_STEPS);
  assert.equal(stack.past[0], `s10`);
});
