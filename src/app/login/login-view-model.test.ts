import { test } from "node:test";
import assert from "node:assert/strict";
import { getLoginViewModel } from "./login-view-model";

test("database mode: heading is 로그인 (DB), description mentions PostgreSQL, badge is DB 사용자", () => {
  const model = getLoginViewModel("database");
  assert.equal(model.heading, "로그인 (DB)");
  assert.match(model.description, /PostgreSQL/);
  assert.equal(model.sourceBadgeLabel, "DB 사용자");
});

test("mock mode: heading is 로그인 (데모), description is the original demo copy, badge is 데모 사용자", () => {
  const model = getLoginViewModel("mock");
  assert.equal(model.heading, "로그인 (데모)");
  assert.equal(
    model.description,
    "실제 인증(카카오 로그인, 회사 이메일 인증)이 도입되기 전까지 임시로 제공되는 데모 로그인입니다."
  );
  assert.equal(model.sourceBadgeLabel, "데모 사용자");
});

test("the two modes never produce the same heading or badge label (visual ambiguity regression guard)", () => {
  const db = getLoginViewModel("database");
  const mock = getLoginViewModel("mock");
  assert.notEqual(db.heading, mock.heading);
  assert.notEqual(db.sourceBadgeLabel, mock.sourceBadgeLabel);
  assert.notEqual(db.description, mock.description);
});

test("sso mode: heading has no parenthetical mode label and the badge says 통합 로그인", () => {
  const model = getLoginViewModel("database", "sso");
  assert.equal(model.heading, "로그인");
  assert.equal(model.sourceBadgeLabel, "통합 로그인");
});

test("sso mode ignores authSource — the user never picks an account, so the source is not shown", () => {
  assert.deepEqual(getLoginViewModel("database", "sso"), getLoginViewModel("mock", "sso"));
});

test("omitting loginMode preserves the pre-SSO behavior exactly", () => {
  assert.deepEqual(getLoginViewModel("database"), getLoginViewModel("database", "demo"));
  assert.deepEqual(getLoginViewModel("mock"), getLoginViewModel("mock", "demo"));
});

test("sso copy never repeats the demo/DB wording that invites picking an account", () => {
  const model = getLoginViewModel("database", "sso");
  assert.doesNotMatch(model.description, /선택합니다/);
  assert.doesNotMatch(model.heading, /데모|DB/);
});
