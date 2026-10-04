import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

/**
 * "현재 단계 직접 변경" 상자의 화면 쪽 — 사유가 선택 입력이 되었다(2026-10-04).
 *
 * 세 겹(화면 · 서버 액션 · mutation)을 한꺼번에 풀어야 하는 변경이라, 화면만
 * 되돌아가면 「서버는 받아 주는데 단추가 안 눌린다」가 된다. 서버 쪽 같은
 * 판정은 db 목록의 workflow-transitions.integration.test.ts(15번)가 본다.
 *
 * 이 컴포넌트는 서버 액션(set-workflow-step.ts → server-only)을 직접 부르므로
 * 통째로 그릴 수 없다 — 이 목록의 이웃들과 같은 방법으로 원본을 글자로 읽는다.
 */
const source = readFileSync(
  join(process.cwd(), "src", "components", "repair-cases", "workflow", "ManualStepSetPanel.tsx"),
  "utf8"
);

test("제출 가능 판정이 사유가 비었는지를 더 보지 않는다", () => {
  const canSubmit = source.match(/const canSubmit = .*;/)?.[0];
  assert.ok(canSubmit, "canSubmit 계산을 찾지 못했다 — 이 시험의 전제가 사라졌다");
  assert.doesNotMatch(canSubmit, /isReasonEmpty/, "사유가 비면 단추가 다시 막힌다");
  // 나머지 세 조건은 그대로여야 한다.
  assert.match(canSubmit, /!unavailableReason/);
  assert.match(canSubmit, /!isUnchanged/);
  assert.match(canSubmit, /!isSubmitting/);
  assert.doesNotMatch(source, /isReasonEmpty/, "쓰이지 않는 판정이 남아 있다");
});

test("🔴 사유 입력칸은 없애지 않는다 — 적고 싶은 사람은 적는다", () => {
  assert.match(source, /id="manual-step-reason"/, "사유 입력칸이 사라졌다");
  assert.match(source, /setReason\(event\.target\.value\)/, "사유를 입력해도 반영되지 않는다");
  assert.match(source, /reason: reason\.trim\(\)/, "사유를 서버로 보내지 않는다");
});

test("화면 글자가 사실과 맞는다 — 별표와 「반드시 남겨야 합니다」가 없다", () => {
  assert.doesNotMatch(source, /변경 사유 \*/, "필수 표시(별표)가 남아 있다");
  assert.doesNotMatch(source, /사유는 반드시 남겨야 합니다/, "설명문이 아직 필수라고 말한다");
  assert.doesNotMatch(source, /변경 사유를 입력해 주세요/, "사유를 재촉하는 안내가 남아 있다");
  assert.match(source, /사유는 선택 입력입니다/, "선택 입력이라는 설명이 없다");
});

test("🔴 출하 완료 잠금은 그대로 가장 먼저 막는다", () => {
  assert.match(
    source,
    /const unavailableReason = isCaseLocked\s*\?\s*"출하 완료 후 잠금된 접수 건입니다\."/,
    "잠금 검사가 자격 검사보다 먼저 오지 않는다"
  );
});

test("🔴 자격 판정은 여전히 공용 함수 하나를 부른다 — 화면이 제 손으로 역할을 세지 않는다", () => {
  assert.match(source, /checkManualStepSetEligibility\(actingUser, holdState\)/);
  // 담당 엔지니어 비교가 화면으로 되살아나지 않았는가(2026-10-04 완화).
  assert.doesNotMatch(source, /assignedEngineerId/, "담당 엔지니어 비교가 화면에 되살아났다");
  assert.doesNotMatch(source, /AS_ENGINEER/, "화면이 역할을 직접 비교한다");
});
