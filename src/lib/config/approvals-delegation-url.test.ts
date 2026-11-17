import { test } from "node:test";
import assert from "node:assert/strict";
import { getApprovalsDelegationUrlOrNull } from "./sso";

/**
 * ============================================================================
 * 통합 승인함의 위임 화면 주소 — **없어도 깨지지 않아야 한다**
 * ============================================================================
 * 쓰는 곳은 [사용자 관리] → [결재권 위임] 탭의 안내 한 줄이다
 * (components/users/ApprovalRouteDelegationSection.tsx). 승인함에서 맡긴 위임은
 * A/S 에서 되돌릴 수 없어서, 그 안내는 **어디로 가야 하는지**를 알려 주는 유일한
 * 자리다.
 *
 * 🔴 그래서 **값이 없을 때의 모양**이 이 파일의 본론이다. 옆의 던지는 getter 들
 * (`getSsoIssuer` 등)을 그대로 베끼면, 환경변수가 안 들어간 기계에서 **위임 목록이
 * 통째로 사라진다** — 링크 하나 때문에 화면 전부를 잃는 것은 값이 맞지 않는다.
 * 같은 판단이 이미 `getSsoClientIdOrEmpty`(알림 종의 열쇠 접두사)에 적혀 있다.
 *
 * 🔵 이 모듈은 `server-only` 사슬에 걸려 있어 `test:components` 에서는 import 가
 * 던진다. 그래서 react-server 조건으로 도는 **unit 목록**에 등록돼 있다.
 * ============================================================================
 */

let original: string | undefined;

test.beforeEach(() => {
  original = process.env.APPROVALS_BASE_URL;
});

test.afterEach(() => {
  if (original === undefined) delete process.env.APPROVALS_BASE_URL;
  else process.env.APPROVALS_BASE_URL = original;
});

test("🔴 이름이 APPROVALS_BASE_URL 이다 — 세 집이 같은 이름을 쓴다", () => {
  // 🔴 먼저 **재려는 것이 비어 있지 않은지** 본다. 아래 「없으면 null」 시험들은
  //    함수가 아무 변수도 안 읽어도 공짜로 통과한다 — 값을 넣었을 때 실제로 달라지는
  //    것을 여기서 한 번 확인해 두면 그 공짜 통과가 막힌다.
  delete process.env.APPROVALS_BASE_URL;
  assert.equal(getApprovalsDelegationUrlOrNull(), null);
  process.env.APPROVALS_BASE_URL = "http://approvals.example.test:3900";
  assert.equal(
    getApprovalsDelegationUrlOrNull(),
    "http://approvals.example.test:3900/delegations",
    "APPROVALS_BASE_URL 을 안 읽거나 다른 이름을 읽는다"
  );
});

test("🔴 값이 없으면 던지지 않고 null — 설정이 빠진 기계에서도 화면이 선다", () => {
  delete process.env.APPROVALS_BASE_URL;
  assert.equal(getApprovalsDelegationUrlOrNull(), null);
});

test("🔴 빈 글자·공백뿐인 값도 null 이다 — 「//delegations」 로 가지 않는다", () => {
  for (const blank of ["", "   ", "\t"]) {
    process.env.APPROVALS_BASE_URL = blank;
    assert.equal(
      getApprovalsDelegationUrlOrNull(),
      null,
      `빈 값(${JSON.stringify(blank)})이 주소로 풀렸다`
    );
  }
});

test("끝의 슬래시를 떼어 낸다 — 안 떼면 서버에 따라 그대로 404 다", () => {
  for (const raw of [
    "http://approvals.example.test:3900/",
    "http://approvals.example.test:3900///",
    "  http://approvals.example.test:3900/  ",
  ]) {
    process.env.APPROVALS_BASE_URL = raw;
    assert.equal(
      getApprovalsDelegationUrlOrNull(),
      "http://approvals.example.test:3900/delegations",
      `끝의 슬래시가 남았다: ${JSON.stringify(raw)}`
    );
  }
});

test("🔴 주소를 코드에 박지 않는다 — 환경변수를 바꾸면 결과가 따라 바뀐다", () => {
  // 박아 두면 주소가 바뀌는 날 **오류 없이 엉뚱한 데로** 간다. 사람은 「승인함이
  // 비었다」로 읽고 원인을 찾을 단서가 없다.
  process.env.APPROVALS_BASE_URL = "https://approvals.first.test";
  const first = getApprovalsDelegationUrlOrNull();
  process.env.APPROVALS_BASE_URL = "https://approvals.second.test";
  const second = getApprovalsDelegationUrlOrNull();
  assert.notEqual(first, second, "환경변수를 바꿔도 같은 주소가 나온다 — 어딘가에 박혀 있다");
  assert.equal(second, "https://approvals.second.test/delegations");
});

test("🔴 포털(dss-auth) 주소를 돌려쓰지 않는다 — 승인함은 다른 앱·다른 포트다", () => {
  // SSO_ISSUER 에 `/delegations` 를 붙이면 포털에는 없는 경로라 404 가 나고,
  // 그것은 「위임 화면이 비었다」와 구별되지 않는다.
  const issuerBefore = process.env.SSO_ISSUER;
  try {
    process.env.SSO_ISSUER = "http://portal.example.test:3100";
    process.env.APPROVALS_BASE_URL = "http://approvals.example.test:3900";
    const url = getApprovalsDelegationUrlOrNull();
    assert.ok(url, "주소가 null 이다");
    assert.ok(
      !url.includes("portal.example.test"),
      "승인함 주소가 포털 발행자에서 파생됐다"
    );
  } finally {
    if (issuerBefore === undefined) delete process.env.SSO_ISSUER;
    else process.env.SSO_ISSUER = issuerBefore;
  }
});
