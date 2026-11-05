import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkDevelopmentWriteTarget,
  describeDatabaseTarget,
  formatDatabaseTarget,
  formatWriteGuardBlockMessage,
} from "./dev-database-write-guard";

/**
 * 🔴 **DB 에 안 붙는다.** 전부 지어낸 접속 글자로 판정 함수만 부른다 —
 * 「막혔다」가 사람 눈에만 보이면 그 장치는 다음에 조용히 열린다.
 *
 * 🔵 비밀번호는 전부 가짜(`pw`)다. 실제 값을 시험에 적지 않는다.
 */

const DEV_URL = "postgresql://dss_admin:pw@127.0.0.1:5442/dss_as";
/** 운영은 NAS 에 있고 **DB 이름이 개발과 똑같다** — 이 시험의 알맹이다. */
const PROD_URL = "postgresql://dss_admin:pw@192.168.0.222:5432/dss_as";

test("🔴 개발과 운영의 **DB 이름이 같다** — 이름으로 가르는 장치는 둘 다 통과시킨다", () => {
  // 이 시험이 지키는 것은 결과가 아니라 **전제**다. 언젠가 운영 DB 이름이 바뀌어
  // 이름으로도 갈리게 되면 이 단언이 깨지면서, 아래 시험들이 무엇을 재고 있었는지
  // 다시 보게 된다. 전제를 안 박아 두면 「호스트를 본다」가 괜히 복잡한 코드로만 보인다.
  assert.equal(describeDatabaseTarget(DEV_URL)?.database, "dss_as");
  assert.equal(describeDatabaseTarget(PROD_URL)?.database, "dss_as");
  assert.equal(describeDatabaseTarget(DEV_URL)?.database, describeDatabaseTarget(PROD_URL)?.database);
});

test("🔴 개발 접속(루프백 + 개발 포트)은 통과한다", () => {
  const verdict = checkDevelopmentWriteTarget({ databaseUrl: DEV_URL });
  assert.equal(verdict.allowed, true);
  assert.deepEqual(verdict.identity, { host: "127.0.0.1", port: "5442", database: "dss_as" });
});

test("localhost · ::1 도 같은 기계다", () => {
  assert.equal(checkDevelopmentWriteTarget({ databaseUrl: "postgresql://u:pw@localhost:5442/dss_as" }).allowed, true);
  assert.equal(checkDevelopmentWriteTarget({ databaseUrl: "postgresql://u:pw@[::1]:5442/dss_as" }).allowed, true);
});

test("🔴 운영처럼 보이는 접속은 **멈춘다** — 이름이 개발과 같아도", () => {
  const verdict = checkDevelopmentWriteTarget({ databaseUrl: PROD_URL });
  assert.equal(verdict.allowed, false);
  assert.ok(verdict.reason.includes("192.168.0.222"), "무엇을 보고 막았는지가 까닭에 없다");
  // 🔴 서버가 "dss_as" 라고 답해도 통과하면 안 된다 — 그게 처음 장치가 틀렸던 자리다.
  assert.equal(
    checkDevelopmentWriteTarget({ databaseUrl: PROD_URL, actualDatabaseName: "dss_as" }).allowed,
    false
  );
});

test("🔴 루프백이어도 **모르는 포트**면 멈춘다 — NAS 위에서 돌리는 경우를 막는다", () => {
  const verdict = checkDevelopmentWriteTarget({ databaseUrl: "postgresql://u:pw@127.0.0.1:5432/dss_as" });
  assert.equal(verdict.allowed, false);
  assert.ok(verdict.reason.includes("5432"));
});

test("루프백의 시험 DB 는 포트가 달라도 통과한다 — 운영이 _test 로 끝날 일은 없다", () => {
  assert.equal(
    checkDevelopmentWriteTarget({ databaseUrl: "postgresql://u:pw@127.0.0.1:5433/dss_as_test" }).allowed,
    true
  );
});

test("🔴 붙은 곳이 적힌 곳과 다르면 멈춘다", () => {
  const verdict = checkDevelopmentWriteTarget({
    databaseUrl: DEV_URL,
    actualDatabaseName: "dss_as_somethingelse",
  });
  assert.equal(verdict.allowed, false);
  assert.ok(verdict.reason.includes("dss_as_somethingelse"));
});

test("🔴 판단할 신호가 없으면 **막는 쪽**이다 — 빈 값 · 깨진 URL · 이름 없는 URL", () => {
  for (const databaseUrl of [undefined, null, "", "그냥 글자", "postgresql://u:pw@127.0.0.1:5442/"]) {
    assert.equal(
      checkDevelopmentWriteTarget({ databaseUrl }).allowed,
      false,
      `막아야 하는데 통과했다: ${String(databaseUrl)}`
    );
  }
});

test("🔴 막은 글에 **비밀번호도 사용자명도** 안 들어간다", () => {
  const verdict = checkDevelopmentWriteTarget({
    databaseUrl: "postgresql://dss_admin:s3cr3t-pw@192.168.0.222:5432/dss_as",
  });
  const message = formatWriteGuardBlockMessage(verdict);

  assert.equal(message.includes("s3cr3t-pw"), false, "비밀번호가 메시지에 샜다");
  assert.equal(message.includes("dss_admin"), false, "사용자명이 메시지에 샜다");
  assert.equal(message.includes("postgresql://"), false, "접속 URL 이 통째로 샜다");
  // 그러면서도 「무엇을 보고 막았는지」는 남아 있어야 한다.
  assert.ok(message.includes("192.168.0.222:5432/dss_as"));
  assert.ok(message.includes("쓰기 안 함"));
});

test("보여 주는 한 줄은 호스트:포트/DB 이름뿐이다", () => {
  assert.equal(formatDatabaseTarget(describeDatabaseTarget(DEV_URL)), "127.0.0.1:5442/dss_as");
  assert.equal(formatDatabaseTarget(null), "(접속 정보를 못 읽음)");
});
