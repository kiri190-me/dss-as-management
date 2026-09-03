import assert from "node:assert/strict";
import { test } from "node:test";
import { planSsoProvision } from "./sso-provision";

/**
 * 여기서 확인하려는 것은 "계정이 자동으로 생긴다"가 아니라, **어떤 경우에
 * 생기지 않는가**이다. 자동 생성은 편의지만, 생기지 않아야 할 때 생기는
 * 것은 권한 사고다.
 */

test("역할과 이메일이 오면 만든다", () => {
  const plan = planSsoProvision({
    role: "AS_ENGINEER",
    email: "hong@dss21.com",
    name: "홍길동",
  });
  assert.deepEqual(plan, {
    kind: "CREATE",
    email: "hong@dss21.com",
    name: "홍길동",
    role: "AS_ENGINEER",
  });
});

test("역할이 없으면 만들지 않는다 — 새 계정에는 지킬 값이 없다", () => {
  // 기존 계정에서 역할 클레임이 없는 것은 KEEP(그대로 두기)이지만,
  // 새 계정에 임의의 역할을 정해 주지는 않는다. 이 시스템의 역할은 전부
  // 실질적인 쓰기 권한을 가진다.
  for (const claims of [
    { email: "a@dss21.com", name: "가" },
    { role: undefined, email: "a@dss21.com" },
    { role: null, email: "a@dss21.com" },
  ]) {
    const plan = planSsoProvision(claims);
    assert.equal(plan.kind, "REFUSE");
    assert.equal(plan.kind === "REFUSE" && plan.code, "ROLE_MISSING");
  }
});

test("모르는 역할이면 만들지 않는다", () => {
  const plan = planSsoProvision({ role: "ADMINISTRATOR", email: "a@dss21.com" });
  assert.equal(plan.kind, "REFUSE");
  assert.equal(plan.kind === "REFUSE" && plan.code, "ROLE_UNKNOWN");
  assert.equal(plan.kind === "REFUSE" && plan.received, "ADMINISTRATOR");
});

test("역할이 문자열이 아니면 만들지 않는다", () => {
  for (const role of [1, true, {}, []]) {
    const plan = planSsoProvision({ role, email: "a@dss21.com" });
    assert.equal(plan.kind, "REFUSE", JSON.stringify(role));
    assert.equal(plan.kind === "REFUSE" && plan.code, "ROLE_UNKNOWN");
  }
});

test("쓸 수 없는 이메일이면 만들지 않는다 — email 열은 NOT NULL·유일이다", () => {
  for (const email of [undefined, null, "", "   ", "골뱅이없음", "a b@dss21.com", 42]) {
    const plan = planSsoProvision({ role: "ADMIN", email });
    assert.equal(plan.kind, "REFUSE", JSON.stringify(email));
    assert.equal(plan.kind === "REFUSE" && plan.code, "EMAIL_MISSING");
  }
});

test("이메일은 소문자로 저장한다 — 로그인마다 바뀐 것으로 보이면 안 된다", () => {
  const plan = planSsoProvision({ role: "ADMIN", email: "  Hong@DSS21.com  ", name: "홍" });
  assert.equal(plan.kind === "CREATE" && plan.email, "hong@dss21.com");
});

test("이름이 없으면 이메일 앞부분을 쓴다 — 이름 없는 줄을 만들지 않는다", () => {
  for (const name of [undefined, null, "", "   ", 7]) {
    const plan = planSsoProvision({ role: "SALES", email: "njlee@dss21.com", name });
    assert.equal(plan.kind === "CREATE" && plan.name, "njlee", JSON.stringify(name));
  }
});

test("이름 앞뒤 공백은 다듬는다", () => {
  const plan = planSsoProvision({ role: "SALES", email: "a@dss21.com", name: "  홍길동  " });
  assert.equal(plan.kind === "CREATE" && plan.name, "홍길동");
});

test("역할 검사가 이메일 검사보다 먼저다", () => {
  // 둘 다 잘못됐을 때 역할 쪽을 알려준다. 역할이 없으면 이메일이 맞아도
  // 어차피 만들 수 없고, 관리자가 고쳐야 할 곳은 포털의 부여 화면이다.
  const plan = planSsoProvision({ role: "NOPE", email: "" });
  assert.equal(plan.kind === "REFUSE" && plan.code, "ROLE_UNKNOWN");
});

test("이 시스템이 아는 역할 다섯 가지는 모두 통과한다", () => {
  for (const role of ["SUPER_ADMIN", "ADMIN", "AS_ENGINEER", "SALES", "INVENTORY_MANAGER"]) {
    const plan = planSsoProvision({ role, email: "a@dss21.com", name: "가" });
    assert.equal(plan.kind, "CREATE", role);
    assert.equal(plan.kind === "CREATE" && plan.role, role);
  }
});
