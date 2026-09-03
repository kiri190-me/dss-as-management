import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyDbConnectionFailure,
  describeDbConnectionFailure,
} from "./db-connection-failure";

/** 실제 오류가 오는 모양대로 만든다 — 코드는 message가 아니라 code에 담겨 온다. */
function errorWithCode(code: string, message = "실패"): Error {
  return Object.assign(new Error(message), { code });
}

// ── 갈래 가르기 ──────────────────────────────────────────────────────────

test("classify: ECONNREFUSED는 '아무도 듣고 있지 않다'로 가른다", () => {
  assert.equal(classifyDbConnectionFailure(errorWithCode("ECONNREFUSED")), "REFUSED");
});

test("classify: 주소에 닿지 못한 코드들은 한 갈래로 모은다", () => {
  assert.equal(classifyDbConnectionFailure(errorWithCode("ENOTFOUND")), "UNREACHABLE");
  assert.equal(classifyDbConnectionFailure(errorWithCode("ETIMEDOUT")), "UNREACHABLE");
  assert.equal(classifyDbConnectionFailure(errorWithCode("EHOSTUNREACH")), "UNREACHABLE");
  // postgres.js가 스스로 만드는 코드. Node의 것이 아니라서 빠뜨리기 쉽다.
  assert.equal(classifyDbConnectionFailure(errorWithCode("CONNECT_TIMEOUT")), "UNREACHABLE");
});

test("classify: 28P01은 인증 실패", () => {
  assert.equal(classifyDbConnectionFailure(errorWithCode("28P01")), "AUTH");
});

test("classify: 3D000은 그 이름의 DB 없음", () => {
  assert.equal(classifyDbConnectionFailure(errorWithCode("3D000")), "NO_DATABASE");
});

test("classify: 모르는 코드·코드 없음·Error가 아닌 것은 UNKNOWN", () => {
  assert.equal(classifyDbConnectionFailure(errorWithCode("EPERM")), "UNKNOWN");
  assert.equal(classifyDbConnectionFailure(new Error("코드 없는 오류")), "UNKNOWN");
  assert.equal(classifyDbConnectionFailure("문자열이 던져졌다"), "UNKNOWN");
  assert.equal(classifyDbConnectionFailure(null), "UNKNOWN");
  assert.equal(classifyDbConnectionFailure(undefined), "UNKNOWN");
});

test("classify: 한 겹 싸인 오류도 안쪽 코드를 찾아낸다", () => {
  const wrapped = new Error("접속 실패", { cause: errorWithCode("ECONNREFUSED") });
  assert.equal(classifyDbConnectionFailure(wrapped), "REFUSED");
});

test("classify: 스스로를 cause로 가리켜도 돌지 않는다", () => {
  const looping = new Error("고리") as Error & { cause?: unknown };
  looping.cause = looping;
  assert.equal(classifyDbConnectionFailure(looping), "UNKNOWN");
});

// ── 안내 문구 ────────────────────────────────────────────────────────────

test("describe: ECONNREFUSED에는 컨테이너를 켜는 명령을 그대로 실어 준다", () => {
  const message = describeDbConnectionFailure(errorWithCode("ECONNREFUSED"));
  assert.match(message, /docker start dss-as-postgres-dev/);
  assert.match(message, /ECONNREFUSED/);
});

test("describe: 닿지 못한 경우에는 주소와 방화벽을 의심하게 한다", () => {
  const message = describeDbConnectionFailure(errorWithCode("ENOTFOUND"));
  assert.match(message, /호스트 이름/);
  assert.match(message, /방화벽/);
});

test("describe: 28P01에는 사용자·비밀번호를 보라고 한다", () => {
  const message = describeDbConnectionFailure(errorWithCode("28P01"));
  assert.match(message, /사용자 이름과 비밀번호/);
});

test("describe: 3D000에는 데이터베이스 이름을 보라고 한다", () => {
  const message = describeDbConnectionFailure(errorWithCode("3D000"));
  assert.match(message, /데이터베이스 이름/);
});

test("describe: 모르는 오류는 이름과 코드만 그대로 보여 준다", () => {
  const message = describeDbConnectionFailure(errorWithCode("EPERM", "무언가 잘못됐다"));
  assert.match(message, /Error/);
  assert.match(message, /EPERM/);
  assert.doesNotMatch(message, /무언가 잘못됐다/);
});

test("describe: 코드가 아예 없으면 코드 칸을 지어내지 않는다", () => {
  const message = describeDbConnectionFailure(new Error("코드 없는 오류"));
  assert.doesNotMatch(message, /코드:/);
  assert.doesNotMatch(message, /null/);
});

// ── 🔴 접속 문자열이 새 나가지 않는다 ────────────────────────────────────

test("describe: 오류 message에 접속 문자열이 실려 있어도 옮겨 담지 않는다", () => {
  // postgres.js는 접속 대상을 message에 적어 넣는다. 여기에 접속 문자열이
  // 통째로 실려 오는 경로가 있어서, message는 어느 갈래에서도 쓰지 않는다.
  const leaky = "write ECONNREFUSED postgres://dss:s3cr3t-pw@10.0.0.9:5432/dss_as";
  for (const code of ["ECONNREFUSED", "ENOTFOUND", "28P01", "3D000", "EPERM"]) {
    const message = describeDbConnectionFailure(errorWithCode(code, leaky));
    assert.doesNotMatch(message, /s3cr3t-pw/, `${code} 갈래에서 비밀번호가 샜다`);
    assert.doesNotMatch(message, /postgres:\/\//, `${code} 갈래에서 접속 문자열이 샜다`);
    assert.doesNotMatch(message, /10\.0\.0\.9/, `${code} 갈래에서 호스트가 샜다`);
  }
});

// ── 접속 실패를 '빈 DB'로 읽히게 두지 않는다 (이 파일이 생긴 이유) ───────

test("describe: 어느 갈래도 '처음 적용하는 DB'처럼 읽히지 않는다", () => {
  for (const code of ["ECONNREFUSED", "ENOTFOUND", "28P01", "3D000", "EPERM"]) {
    const message = describeDbConnectionFailure(errorWithCode(code));
    assert.doesNotMatch(message, /처음 적용/, `${code} 갈래가 빈 DB처럼 읽힌다`);
    assert.doesNotMatch(message, /적용 대기/, `${code} 갈래가 개수 보고처럼 읽힌다`);
    assert.match(message, /접속|인증|거부/, `${code} 갈래가 접속 문제라고 말하지 않는다`);
  }
});
