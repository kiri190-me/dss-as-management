import { test } from "node:test";
import assert from "node:assert/strict";

import { selectQuoteLinkChoices } from "./quote-link-options";

/**
 * 이 시험이 지키는 것 넷.
 *  1. 후보는 고른 수리 건의 견적서뿐이다(원본 순서 그대로).
 *  2. 수리 건을 안 골랐으면 후보가 없다.
 *  3. **지금 연결된 견적서는 다른 건의 것이어도 남는다** — 빠지면 `<select>` 가
 *     '연결 없음'을 보여 주면서 상태에는 연결이 남고, 저장하면 무엇이 남는지
 *     화면이 거짓말을 한다. 남길 때 두 번 들어가지 않고, 남겼다는 사실은
 *     selectedOutsideRepairCase 로 드러난다.
 *  4. 수리 건이 붙지 않은 견적서(repairCaseId NULL)는 어느 건에도 뜨지 않는다
 *     — 단 지금 연결된 것이면 3번 규칙으로 남는다.
 */

type Option = { id: string; repairCaseId: string | null; label: string };

// 조회는 최근 발행순으로 넘긴다 — 이 배열의 순서가 곧 그 순서다.
const options: Option[] = [
  { id: "q1", repairCaseId: "rc-a", label: "A 건 2차" },
  { id: "q2", repairCaseId: "rc-b", label: "B 건" },
  { id: "q3", repairCaseId: null, label: "수리 건 없음" },
  { id: "q4", repairCaseId: "rc-a", label: "A 건 1차" },
];

const ids = (list: readonly Option[]) => list.map((option) => option.id);

// ── 같은 건만 ──────────────────────────────────────────────────────────

test("고른 수리 건의 견적서만 후보가 된다 — 원본 순서 그대로", () => {
  const choices = selectQuoteLinkChoices(options, "rc-a", null);
  assert.deepEqual(ids(choices.sameRepairCase), ["q1", "q4"]);
  assert.deepEqual(ids(choices.visible), ["q1", "q4"]);
  assert.equal(choices.selectedOutsideRepairCase, false);
});

test("견적서가 하나도 없는 수리 건이면 후보가 비어 있다", () => {
  const choices = selectQuoteLinkChoices(options, "rc-없음", null);
  assert.deepEqual(choices.sameRepairCase, []);
  assert.deepEqual(choices.visible, []);
  assert.equal(choices.selectedOutsideRepairCase, false);
});

// ── 건 미선택 ──────────────────────────────────────────────────────────

test("수리 건을 안 골랐으면 후보가 없다 — 빈 문자열 · null · undefined 모두", () => {
  for (const blank of ["", null, undefined]) {
    const choices = selectQuoteLinkChoices(options, blank, null);
    assert.deepEqual(choices.sameRepairCase, [], `repairCaseId=${String(blank)}`);
    assert.deepEqual(choices.visible, [], `repairCaseId=${String(blank)}`);
    assert.equal(choices.selectedOutsideRepairCase, false);
  }
});

test("견적서 선택이 빈 문자열이어도 '연결 없음'으로 읽는다", () => {
  const choices = selectQuoteLinkChoices(options, "rc-a", "");
  assert.deepEqual(ids(choices.visible), ["q1", "q4"]);
  assert.equal(choices.selectedOutsideRepairCase, false);
});

// ── 지금 연결된 견적서 붙잡아 두기 ──────────────────────────────────────

test("지금 연결된 견적서는 다른 건의 것이어도 남는다 — 원본 순서 자리에", () => {
  const choices = selectQuoteLinkChoices(options, "rc-a", "q2");
  assert.deepEqual(ids(choices.visible), ["q1", "q2", "q4"]);
  // 붙잡아 둔 것은 '이 건의 견적서' 개수에 세지 않는다.
  assert.deepEqual(ids(choices.sameRepairCase), ["q1", "q4"]);
  assert.equal(choices.selectedOutsideRepairCase, true);
});

test("지금 연결된 견적서가 이미 같은 건의 것이면 두 번 들어가지 않는다", () => {
  const choices = selectQuoteLinkChoices(options, "rc-a", "q4");
  assert.deepEqual(ids(choices.visible), ["q1", "q4"]);
  assert.equal(choices.selectedOutsideRepairCase, false);
});

test("수리 건을 안 골랐어도 지금 연결된 견적서는 남는다 — 그것 하나만", () => {
  const choices = selectQuoteLinkChoices(options, "", "q2");
  assert.deepEqual(choices.sameRepairCase, []);
  assert.deepEqual(ids(choices.visible), ["q2"]);
  assert.equal(choices.selectedOutsideRepairCase, true);
});

test("다른 건의 견적서가 연결된 채로 견적서 없는 건을 골라도 그 연결은 남는다", () => {
  const choices = selectQuoteLinkChoices(options, "rc-없음", "q1");
  assert.deepEqual(choices.sameRepairCase, []);
  assert.deepEqual(ids(choices.visible), ["q1"]);
  assert.equal(choices.selectedOutsideRepairCase, true);
});

test("목록에 없는 견적서가 연결돼 있어도(지워진 견적서) 없는 항목을 지어내지 않는다", () => {
  const choices = selectQuoteLinkChoices(options, "rc-a", "지워진-견적서");
  assert.deepEqual(ids(choices.visible), ["q1", "q4"]);
  assert.equal(choices.selectedOutsideRepairCase, false);
});

// ── repairCaseId NULL 인 견적서 ────────────────────────────────────────

test("수리 건이 붙지 않은 견적서는 어느 건을 골라도 후보에 뜨지 않는다", () => {
  for (const repairCaseId of ["rc-a", "rc-b", "rc-없음"]) {
    const choices = selectQuoteLinkChoices(options, repairCaseId, null);
    assert.ok(!ids(choices.visible).includes("q3"), `repairCaseId=${repairCaseId}`);
  }
});

test("수리 건이 붙지 않은 견적서라도 지금 연결된 것이면 남는다", () => {
  const withCase = selectQuoteLinkChoices(options, "rc-b", "q3");
  assert.deepEqual(ids(withCase.visible), ["q2", "q3"]);
  assert.equal(withCase.selectedOutsideRepairCase, true);

  const withoutCase = selectQuoteLinkChoices(options, "", "q3");
  assert.deepEqual(ids(withoutCase.visible), ["q3"]);
  assert.equal(withoutCase.selectedOutsideRepairCase, true);
});

// ── 입력을 건드리지 않는다 ─────────────────────────────────────────────

test("원본 배열을 건드리지 않고, 돌려준 배열도 원본과 따로다", () => {
  const before = ids(options);
  const choices = selectQuoteLinkChoices(options, "rc-a", "q2");
  assert.deepEqual(ids(options), before);
  assert.notEqual(choices.visible, options);
  assert.notEqual(choices.visible, choices.sameRepairCase);
});
