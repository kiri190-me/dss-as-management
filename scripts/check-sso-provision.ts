import "./load-env";

import { eq, inArray } from "drizzle-orm";
import { db, pgClient } from "../src/lib/db/connection";
import { users } from "../src/lib/db/schema";
import { resolveSsoLogin } from "../src/lib/auth/sso-login";

/**
 * 계정 자동 생성 점검 (브라우저 없이).
 *
 * 왜 필요한가: 이 경로는 화면이 없고, 틀려도 "로그인은 되는 것처럼" 보인다.
 * 특히 **생기지 않아야 할 때 생기는 것**은 권한 사고인데 아무 증상이 없다.
 * 정상 생성 한 번과 거절되어야 하는 경우들을 함께 돌린다.
 *
 * 실행:  npm run check:sso
 *
 * 임시 계정을 만들고 끝나면 지운다. 기존 계정은 건드리지 않는다.
 */
const T1 = "00000000-0000-4000-8000-00000000e2e1";
const T2 = "00000000-0000-4000-8000-00000000e2e2";
const T3 = "00000000-0000-4000-8000-00000000e2e3";
const TEST_EMAIL = "__e2e-provision@example.test";

let passed = 0;
let failed = 0;

function check(label: string, ok: boolean, detail = "") {
  if (ok) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

async function cleanup() {
  await db.delete(users).where(inArray(users.ssoSubject, [T1, T2, T3]));
  await db.delete(users).where(eq(users.email, TEST_EMAIL));
}

async function main() {
  await cleanup();

  try {
    console.log("\n계정 자동 생성\n");

    // ── 1. 처음 보는 사람 ──
    const created = await resolveSsoLogin(T1, {
      role: "AS_ENGINEER",
      email: TEST_EMAIL,
      name: "점검용 사용자",
    });
    check("처음 보는 사람의 계정을 만들고 세션을 준다", created.outcome === "SESSION");
    check(
      "포털이 지정한 역할로 만들어진다",
      created.outcome === "SESSION" && created.user.role === "AS_ENGINEER",
      created.outcome === "SESSION" ? created.user.role : ""
    );
    check(
      "승인 대기로 두지 않는다 — 포털에서 이미 승인받았다",
      created.outcome === "SESSION" && created.user.approvalStatus === "APPROVED"
    );

    const [row] = await db.select().from(users).where(eq(users.ssoSubject, T1)).limit(1);
    check("sso_subject로 이어져 있다", row !== undefined && row.ssoSubject === T1);
    check("이메일이 소문자로 저장된다", row?.email === TEST_EMAIL.toLowerCase());

    // ── 2. 같은 사람이 다시 ──
    const again = await resolveSsoLogin(T1, {
      role: "AS_ENGINEER",
      email: TEST_EMAIL,
      name: "점검용 사용자",
    });
    check(
      "같은 사람이 다시 들어와도 계정이 하나다",
      again.outcome === "SESSION" && again.user.id === (created.outcome === "SESSION" ? created.user.id : "")
    );
    const dupes = await db.select().from(users).where(eq(users.email, TEST_EMAIL));
    check("행이 늘어나지 않는다", dupes.length === 1, `${dupes.length}건`);

    // ── 3. 포털이 역할을 바꾸면 따라간다 ──
    const promoted = await resolveSsoLogin(T1, {
      role: "ADMIN",
      email: TEST_EMAIL,
      name: "점검용 사용자",
    });
    check(
      "포털에서 역할을 바꾸면 다음 로그인에 반영된다",
      promoted.outcome === "SESSION" && promoted.user.role === "ADMIN",
      promoted.outcome === "SESSION" ? promoted.user.role : ""
    );

    console.log("\n거절되어야 하는 것들\n");

    // ── 4. 기존 계정을 이메일로 주워가려는 시도 ──
    //
    // 예전 설계가 막으려던 바로 그 공격이다: 포털 관리자가 어떤 사람의
    // 이메일을 이 시스템 최고관리자의 주소로 적어 넣는다.
    const [victim] = await db
      .select()
      .from(users)
      .where(eq(users.role, "SUPER_ADMIN"))
      .limit(1);

    if (!victim) {
      console.log("  (SUPER_ADMIN 계정이 없어 이 항목은 건너뜁니다)");
    } else {
      const beforeSubject = victim.ssoSubject;
      const hijack = await resolveSsoLogin(T2, {
        role: "SUPER_ADMIN",
        email: victim.email,
        name: "공격자",
      });
      check(
        "이미 쓰이는 이메일로는 계정을 만들지도, 주워가지도 않는다",
        hijack.outcome === "REJECTED" && hijack.code === "EMAIL_TAKEN",
        hijack.outcome === "REJECTED" ? hijack.code : "세션이 발급되었다"
      );

      const [after] = await db.select().from(users).where(eq(users.id, victim.id)).limit(1);
      check(
        "노려진 계정의 연결이 그대로다",
        after?.ssoSubject === beforeSubject,
        `${beforeSubject} → ${after?.ssoSubject}`
      );
      check(
        "노려진 계정의 역할도 그대로다",
        after?.role === victim.role
      );
    }

    // ── 5. 역할 없이 ──
    const noRole = await resolveSsoLogin(T3, { email: "__e2e-norole@example.test", name: "역할없음" });
    check(
      "포털이 역할을 지정하지 않으면 만들지 않는다",
      noRole.outcome === "REJECTED" && noRole.code === "PORTAL_ROLE_MISSING",
      noRole.outcome === "REJECTED" ? noRole.code : "세션이 발급되었다"
    );
    const [ghost] = await db.select().from(users).where(eq(users.ssoSubject, T3)).limit(1);
    check("그 경우 행이 만들어지지 않는다", ghost === undefined);

    // ── 6. 모르는 역할 ──
    const badRole = await resolveSsoLogin(T3, {
      role: "ADMINISTRATOR",
      email: "__e2e-badrole@example.test",
    });
    check(
      "모르는 역할이면 만들지 않는다",
      badRole.outcome === "REJECTED" && badRole.code === "UNKNOWN_ROLE",
      badRole.outcome === "REJECTED" ? badRole.code : "세션이 발급되었다"
    );

    // ── 7. 이메일 없이 ──
    const noEmail = await resolveSsoLogin(T3, { role: "ADMIN", name: "이메일없음" });
    check(
      "쓸 수 있는 이메일이 없으면 만들지 않는다",
      noEmail.outcome === "REJECTED" && noEmail.code === "PORTAL_EMAIL_MISSING",
      noEmail.outcome === "REJECTED" ? noEmail.code : "세션이 발급되었다"
    );
  } finally {
    await cleanup();
  }

  console.log(`\n통과 ${passed} / 실패 ${failed}`);
  if (failed > 0) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => pgClient.end());
