import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveDemoLoginEnabled } from "./demo-login";

test("데모 모드에서 true면 열린다 — 지금까지의 동작", () => {
  assert.equal(resolveDemoLoginEnabled("true", "demo"), true);
});

test("SSO 모드에서는 true여도 닫혀 있다", () => {
  // 설정 파일을 고치는 것을 잊어도 코드가 이미 닫혀 있어야 한다.
  assert.equal(resolveDemoLoginEnabled("true", "sso"), false);
});

test("값이 없으면 닫혀 있다", () => {
  assert.equal(resolveDemoLoginEnabled(undefined, "demo"), false);
  assert.equal(resolveDemoLoginEnabled(undefined, "sso"), false);
});

test("정확히 \"true\"만 인정한다", () => {
  // 오타 하나로 열리지 않게. "1"이나 "yes"를 받아 주면 그 관용이 곧 구멍이 된다.
  for (const value of ["1", "yes", "TRUE", "True", " true", "true "]) {
    assert.equal(resolveDemoLoginEnabled(value, "demo"), false, `"${value}"`);
  }
});

test("빈 문자열도 닫힘", () => {
  assert.equal(resolveDemoLoginEnabled("", "demo"), false);
});
