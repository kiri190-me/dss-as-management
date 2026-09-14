import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  USER_DELETION_REASON_MAX_LENGTH,
  validateUserDeletionInput,
  validateUserDeletionPreviewInput,
} from "./user-deletion-input";

const TARGET = randomUUID();
const APPROVER = randomUUID();
const ENGINEER = randomUUID();

function base(overrides: Record<string, unknown> = {}) {
  return {
    targetUserId: TARGET,
    expectedVersion: 3,
    reason: "퇴사",
    approvalSuccessorUserId: APPROVER,
    engineerSuccessorUserId: ENGINEER,
    ...overrides,
  };
}

function failMessage(input: unknown): string {
  const result = validateUserDeletionInput(input);
  assert.equal(result.ok, false, `거절돼야 한다: ${JSON.stringify(input)}`);
  if (result.ok) throw new Error("unreachable");
  assert.equal(result.code, "VALIDATION_ERROR");
  return result.message;
}

test("삭제 입력 — 모양이 맞으면 그대로 돌려준다(사유는 다듬는다)", () => {
  const result = validateUserDeletionInput(base({ reason: "  퇴사  " }));
  assert.deepEqual(result, {
    ok: true,
    value: {
      targetUserId: TARGET,
      expectedVersion: 3,
      reason: "퇴사",
      approvalSuccessorUserId: APPROVER,
      engineerSuccessorUserId: ENGINEER,
    },
  });
});

test("삭제 입력 — 이어받을 사람은 비워 둘 수 있다(없음 · null · 빈 문자열)", () => {
  for (const empty of [undefined, null, "", "   "]) {
    const result = validateUserDeletionInput(
      base({ approvalSuccessorUserId: empty, engineerSuccessorUserId: empty })
    );
    assert.equal(result.ok, true, String(empty));
    if (!result.ok) continue;
    assert.equal(result.value.approvalSuccessorUserId, null);
    assert.equal(result.value.engineerSuccessorUserId, null);
  }
});

test("삭제 입력 — 객체가 아니면 거절한다", () => {
  for (const input of [null, undefined, "x", 1, []]) failMessage(input);
});

test("삭제 입력 — 대상 id 가 uuid 가 아니면 거절한다", () => {
  assert.equal(failMessage(base({ targetUserId: "u-001" })), "삭제할 사용자를 확인할 수 없습니다.");
  failMessage(base({ targetUserId: undefined }));
});

test("삭제 입력 — 버전은 1 이상의 정수만 받는다", () => {
  for (const expectedVersion of [0, -1, 1.5, "1", Number.NaN, undefined, Number.MAX_VALUE]) {
    failMessage(base({ expectedVersion }));
  }
  assert.equal(validateUserDeletionInput(base({ expectedVersion: 1 })).ok, true);
});

test("삭제 입력 — 사유는 필수이고 상한까지 받는다", () => {
  assert.equal(failMessage(base({ reason: undefined })), "삭제 사유를 입력해 주세요.");
  assert.equal(failMessage(base({ reason: "   " })), "삭제 사유를 입력해 주세요.");
  failMessage(base({ reason: 12 }));
  failMessage(base({ reason: "가".repeat(USER_DELETION_REASON_MAX_LENGTH + 1) }));
  assert.equal(validateUserDeletionInput(base({ reason: "가".repeat(USER_DELETION_REASON_MAX_LENGTH) })).ok, true);
});

test("삭제 입력 — 이어받을 사람이 문자열이 아니거나 uuid 가 아니면 거절한다", () => {
  assert.equal(failMessage(base({ approvalSuccessorUserId: 7 })), "결재 이어받을 사람을 확인할 수 없습니다.");
  assert.equal(failMessage(base({ engineerSuccessorUserId: "nope" })), "담당 이어받을 사람을 확인할 수 없습니다.");
});

test("삭제 입력 — 지울 사람 자신을 이어받을 사람으로 보내면 거절한다(어느 쪽이든)", () => {
  const message = "삭제할 사용자 자신을 이어받을 사람으로 고를 수 없습니다.";
  assert.equal(failMessage(base({ approvalSuccessorUserId: TARGET })), message);
  assert.equal(failMessage(base({ engineerSuccessorUserId: TARGET })), message);
  // DB 는 uuid 의 대소문자를 가리지 않는다 — 대문자로 보내도 같은 사람이다.
  assert.equal(failMessage(base({ approvalSuccessorUserId: TARGET.toUpperCase() })), message);
});

test("삭제 입력 — 두 이어받을 사람이 같은 사람이어도 된다", () => {
  assert.equal(validateUserDeletionInput(base({ engineerSuccessorUserId: APPROVER })).ok, true);
});

test("미리보기 입력 — 대상 id 하나만 본다", () => {
  assert.deepEqual(validateUserDeletionPreviewInput({ targetUserId: TARGET }), { ok: true, targetUserId: TARGET });
  for (const input of [null, "x", [], { targetUserId: "u-001" }, {}]) {
    const result = validateUserDeletionPreviewInput(input);
    assert.equal(result.ok, false, JSON.stringify(input));
  }
});
