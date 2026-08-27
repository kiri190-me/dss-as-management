import assert from "node:assert/strict";
import { test } from "node:test";
import { decideSsoProfile } from "./sso-profile";

const CURRENT = { email: "chm@dss21.com", name: "최희만" };

test("같은 값이면 아무것도 바꾸지 않는다", () => {
  assert.deepEqual(decideSsoProfile({ email: "chm@dss21.com", name: "최희만" }, CURRENT), {});
});

test("달라진 것만 담는다", () => {
  assert.deepEqual(decideSsoProfile({ email: "new@dss21.com", name: "최희만" }, CURRENT), {
    email: "new@dss21.com",
  });
  assert.deepEqual(decideSsoProfile({ email: "chm@dss21.com", name: "최희만2" }, CURRENT), {
    name: "최희만2",
  });
  assert.deepEqual(decideSsoProfile({ email: "a@b.com", name: "홍길동" }, CURRENT), {
    email: "a@b.com",
    name: "홍길동",
  });
});

test("이메일 대소문자와 공백은 차이로 치지 않는다", () => {
  // 매 로그인마다 쓸모없는 UPDATE가 나가지 않아야 한다.
  assert.deepEqual(decideSsoProfile({ email: "  CHM@DSS21.COM  " }, CURRENT), {});
});

test("이메일은 소문자로 눕혀 저장한다", () => {
  assert.deepEqual(decideSsoProfile({ email: "NEW@DSS21.COM" }, CURRENT), {
    email: "new@dss21.com",
  });
});

test("클레임이 없으면 기존 값을 지우지 않는다", () => {
  assert.deepEqual(decideSsoProfile({}, CURRENT), {});
  assert.deepEqual(decideSsoProfile({ email: undefined, name: undefined }, CURRENT), {});
  assert.deepEqual(decideSsoProfile({ email: null, name: null }, CURRENT), {});
});

test("빈 문자열도 지우기로 읽지 않는다 — 두 칸 다 NOT NULL이다", () => {
  assert.deepEqual(decideSsoProfile({ email: "", name: "" }, CURRENT), {});
  assert.deepEqual(decideSsoProfile({ email: "   ", name: "   " }, CURRENT), {});
});

test("문자열이 아닌 값은 무시한다", () => {
  assert.deepEqual(decideSsoProfile({ email: 42, name: ["최희만"] }, CURRENT), {});
  assert.deepEqual(decideSsoProfile({ email: true }, CURRENT), {});
});

test("이름은 앞뒤 공백만 다듬고 대소문자는 건드리지 않는다", () => {
  assert.deepEqual(decideSsoProfile({ name: "  최희만  " }, CURRENT), {});
  assert.deepEqual(decideSsoProfile({ name: "  홍길동  " }, CURRENT), { name: "홍길동" });
});
