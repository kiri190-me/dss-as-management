import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyBranchLabel, matchStageRestartReference } from "./branch-classification";

test("classifyBranchLabel: no label is DEFAULT", () => {
  assert.deepEqual(classifyBranchLabel(null), { branchType: "DEFAULT", branchLabel: null });
});

test('classifyBranchLabel: "NG" and "N.G." both classify as NG', () => {
  assert.equal(classifyBranchLabel("NG").branchType, "NG");
  assert.equal(classifyBranchLabel("N.G.").branchType, "NG");
});

test("classifyBranchLabel: YES / NO classify correctly", () => {
  assert.equal(classifyBranchLabel("YES").branchType, "YES");
  assert.equal(classifyBranchLabel("NO").branchType, "NO");
});

test('classifyBranchLabel: "정상" and "O.K." classify as NORMAL', () => {
  assert.equal(classifyBranchLabel("정상").branchType, "NORMAL");
  assert.equal(classifyBranchLabel("O.K.").branchType, "NORMAL");
});

test("classifyBranchLabel: unrecognized text is CUSTOM, not guessed at", () => {
  const result = classifyBranchLabel("교산 확인 후");
  assert.equal(result.branchType, "CUSTOM");
  assert.equal(result.branchLabel, "교산 확인 후");
});

test("matchStageRestartReference: matches the two verified RFG loop-back wordings", () => {
  const a = matchStageRestartReference("(4)기본 정전 검사 과정부터 재진행 실시");
  assert.ok(a);
  assert.equal(a?.stageNumber, "4");

  const b = matchStageRestartReference("(4) 기본 정전 검사 재실시");
  assert.ok(b);
  assert.equal(b?.stageNumber, "4");
});

test("matchStageRestartReference: unrelated text does not match", () => {
  assert.equal(matchStageRestartReference("일본 교산에 연락"), null);
  assert.equal(matchStageRestartReference("(4)기본 정전 검사 실시"), null);
});
