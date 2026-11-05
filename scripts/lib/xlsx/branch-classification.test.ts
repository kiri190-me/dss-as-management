import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyBranchLabel,
  classifyUnifiedBranchLabel,
  matchStageRestartReference,
} from "./branch-classification";
import { procedureBranchTypeLabels } from "@/lib/domain/procedure-template-types";

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

/**
 * ============================================================================
 * 🔴 분기 이름 통일 — 「정상」과 「NG」 둘 (2026-11-05)
 * ============================================================================
 * 아래 시험들이 재는 것은 네 가지다. 🔴 **뒤의 둘을 빼면 「전부 정상/NG 로
 * 뭉개기」로 바뀌어도 전부 통과한다** — 그래서 같은 무게로 적는다.
 *   ① YES·O.K.·OK·정상 → 갈래 NORMAL · 이름 「정상」
 *   ② NO·N.G.·NG → 갈래 NG · 이름 「NG」
 *   ③ 🔴 이름 없는 분기(DEFAULT)에는 **이름이 안 생긴다**
 *   ④ 🔴 사람이 적은 이름(CUSTOM)은 **글자도 갈래도 그대로**
 */

test("🔴 통일 전의 어휘가 실제로 여섯 갈래로 갈려 있다 — 무엇을 합치는지 먼저 못 박는다", () => {
  // 표본이 비면 아래 시험들이 공짜로 통과한다. 통일이 **합칠 것이 있는** 상태에서
  // 돌고 있다는 것을 여기서 값으로 세워 둔다(실측한 워크북의 어휘 그대로다).
  const rawTypes = ["NG", "N.G.", "YES", "NO", "O.K.", null].map(
    (text) => classifyBranchLabel(text).branchType
  );
  assert.deepEqual(rawTypes, ["NG", "NG", "YES", "NO", "NORMAL", "DEFAULT"]);
  assert.equal(new Set(rawTypes).size, 5, "통일 전 갈래가 다섯이 아니다 — 본보기가 바뀌었다");
});

test("🔴 YES·O.K.·OK·정상은 전부 갈래 NORMAL · 이름 「정상」이 된다", () => {
  for (const text of ["YES", "yes", "O.K.", "OK", "ok", "정상"]) {
    assert.deepEqual(
      classifyUnifiedBranchLabel(text),
      { branchType: "NORMAL", branchLabel: "정상" },
      `"${text}" 가 정상으로 통일되지 않았다`
    );
  }
});

test("🔴 NO·N.G.·NG 는 전부 갈래 NG · 이름 「NG」가 된다", () => {
  for (const text of ["NG", "ng", "N.G.", "N. G.", "NO", "no"]) {
    assert.deepEqual(
      classifyUnifiedBranchLabel(text),
      { branchType: "NG", branchLabel: "NG" },
      `"${text}" 가 NG 로 통일되지 않았다`
    );
  }
});

test("🔴 이름 없는 분기에는 이름이 **안 생긴다** — 갈림이 아니라 그냥 다음 단계다", () => {
  // 여기에 「정상」을 붙이면 엑셀에 없던 글자를 지어내는 일이 된다. 실측으로 이
  // 갈래가 208건(전체의 2/3)이라, 뭉개면 그림이 통째로 달라진다.
  assert.deepEqual(classifyUnifiedBranchLabel(null), { branchType: "DEFAULT", branchLabel: null });
  assert.deepEqual(classifyUnifiedBranchLabel(""), { branchType: "DEFAULT", branchLabel: null });
});

test("🔴 사람이 적은 이름(CUSTOM)은 글자도 갈래도 그대로 둔다 — 정상/NG 로 뭉갤 수 없다", () => {
  for (const text of ["유상", "무상", "교산 확인 후"]) {
    assert.deepEqual(
      classifyUnifiedBranchLabel(text),
      { branchType: "CUSTOM", branchLabel: text },
      `"${text}" 가 통일에 휩쓸렸다`
    );
  }
});

test("🔴 통일된 글자는 갈래의 이름 그대로다 — 두 벌로 적어 두지 않는다", () => {
  // 이름이 두 자리에 적혀 있으면 한쪽만 고치는 날이 오고, 타입이 같아 컴파일러는
  // 아무 말도 하지 않는다. 화면 이름이 바뀌면 여기가 빨개져 사람이 판단한다.
  assert.equal(procedureBranchTypeLabels.NORMAL, "정상");
  assert.equal(procedureBranchTypeLabels.NG, "NG");
  assert.equal(classifyUnifiedBranchLabel("YES").branchLabel, procedureBranchTypeLabels.NORMAL);
  assert.equal(classifyUnifiedBranchLabel("NO").branchLabel, procedureBranchTypeLabels.NG);
});

test("🔴 통일은 기술 작업 절차 쪽 일이다 — 원래의 classifyBranchLabel 은 안 바뀐다", () => {
  // 기존 FULL_SERVICE 들여오기(extract-shape-graph.ts)가 이 함수의 YES·NO 를 따로
  // 세어 「정상 진행 경로가 갖춰졌나」를 판단한다(hasCompleteYesNo). 여기서 뭉개면
  // 그 규칙이 영영 한 번도 안 걸리고, 오류 없이 경고만 는다.
  assert.deepEqual(classifyBranchLabel("YES"), { branchType: "YES", branchLabel: "YES" });
  assert.deepEqual(classifyBranchLabel("NO"), { branchType: "NO", branchLabel: "NO" });
  assert.deepEqual(classifyBranchLabel("O.K."), { branchType: "NORMAL", branchLabel: "O.K." });
  assert.deepEqual(classifyBranchLabel("N.G."), { branchType: "NG", branchLabel: "N.G." });
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
