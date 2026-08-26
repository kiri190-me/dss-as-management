import { test } from "node:test";
import assert from "node:assert/strict";
import { getLoginMode, LOGIN_MODES } from "./login-mode";

let original: string | undefined;

test.beforeEach(() => {
  original = process.env.LOGIN_MODE;
});

test.afterEach(() => {
  if (original === undefined) delete process.env.LOGIN_MODE;
  else process.env.LOGIN_MODE = original;
});

test("defaults to demo when unset", () => {
  delete process.env.LOGIN_MODE;
  assert.equal(getLoginMode(), "demo");
});

test("defaults to demo when empty", () => {
  process.env.LOGIN_MODE = "";
  assert.equal(getLoginMode(), "demo");
});

test("accepts demo", () => {
  process.env.LOGIN_MODE = "demo";
  assert.equal(getLoginMode(), "demo");
});

test("accepts sso", () => {
  process.env.LOGIN_MODE = "sso";
  assert.equal(getLoginMode(), "sso");
});

test("throws clearly on an unknown value rather than falling back", () => {
  process.env.LOGIN_MODE = "kakao";
  assert.throws(() => getLoginMode(), /LOGIN_MODE must be one of/);
});

test("is case-sensitive — SSO is not sso", () => {
  process.env.LOGIN_MODE = "SSO";
  assert.throws(() => getLoginMode(), /LOGIN_MODE must be one of/);
});

test("LOGIN_MODES holds exactly the two supported values", () => {
  assert.deepEqual([...LOGIN_MODES], ["demo", "sso"]);
});
