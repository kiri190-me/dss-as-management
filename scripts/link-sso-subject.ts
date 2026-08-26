import "./load-env";

import { eq } from "drizzle-orm";
import { db, pgClient } from "../src/lib/db/connection";
import { users } from "../src/lib/db/schema";

/**
 * ============================================================================
 * 통합 로그인(dss-auth) 계정 연결
 * ============================================================================
 * DSS 통합 로그인의 사용자와 이 시스템의 계정을 잇는다. 이 연결이 없으면
 * 통합 로그인으로 들어와도 "이 시스템 사용 권한이 없습니다"로 막힌다.
 *
 * 왜 자동으로 잇지 않는가 — 이메일이 같으면 자동 연결하는 방식이 편하지만,
 * dss-auth의 이메일은 포털 관리자가 손으로 입력하는 값이고 검증되지 않는다.
 * 자동 연결을 열어두면 포털 관리자가 남의 이메일을 적어 넣는 것만으로 이
 * 시스템의 최고관리자 계정을 차지할 수 있다. 연결은 사람이 명시적으로 한다.
 *
 * 사용법:
 *   npm run sso:link
 *     → 이 시스템의 계정 목록과 연결 상태를 본다
 *
 *   npm run sso:link -- --email hong@example.com --subject <dss 사용자 id>
 *     → 그 계정을 해당 DSS 사용자와 잇는다
 *
 *   npm run sso:link -- --email hong@example.com --unlink
 *     → 연결을 끊는다(사람이 바뀌었을 때)
 *
 * <dss 사용자 id>는 dss-auth 관리 화면의 사용자 관리에서 확인한다.
 * ============================================================================
 */

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  return value && !value.startsWith("--") ? value : undefined;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

async function list() {
  const rows = await db
    .select({
      email: users.email,
      name: users.name,
      role: users.role,
      isActive: users.isActive,
      ssoSubject: users.ssoSubject,
    })
    .from(users)
    .where(eq(users.isDeleted, false))
    .orderBy(users.name);

  if (rows.length === 0) {
    console.log("계정이 없습니다.");
    return;
  }

  const linked = rows.filter((row) => row.ssoSubject !== null).length;
  console.log(`계정 ${rows.length}건 · 연결됨 ${linked}건 · 미연결 ${rows.length - linked}건\n`);

  for (const row of rows) {
    const mark = row.ssoSubject ? "연결됨" : "미연결";
    const inactive = row.isActive ? "" : " (비활성)";
    console.log(`  [${mark}] ${row.name} <${row.email}> · ${row.role}${inactive}`);
    if (row.ssoSubject) console.log(`           ↔ ${row.ssoSubject}`);
  }

  console.log("\n연결하려면:");
  console.log("  npm run sso:link -- --email <이메일> --subject <dss 사용자 id>");
}

async function main() {
  const email = arg("email");

  if (!email) {
    await list();
    return;
  }

  const [target] = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
      ssoSubject: users.ssoSubject,
    })
    .from(users)
    .where(eq(users.email, email.trim().toLowerCase()))
    .limit(1);

  if (!target) {
    console.error(`"${email}" 계정을 찾을 수 없습니다.`);
    process.exitCode = 1;
    return;
  }

  // ── 연결 해제 ──
  if (hasFlag("unlink")) {
    if (!target.ssoSubject) {
      console.log(`${target.name}님은 이미 연결되어 있지 않습니다. 변경 없음.`);
      return;
    }
    await db
      .update(users)
      .set({ ssoSubject: null, ssoLinkedAt: null, updatedAt: new Date() })
      .where(eq(users.id, target.id));
    console.log(`${target.name}님의 통합 로그인 연결을 끊었습니다.`);
    console.log("이제 이 계정으로는 통합 로그인으로 들어올 수 없습니다.");
    return;
  }

  const subject = arg("subject");
  if (!subject) {
    console.error("--subject 에 dss-auth의 사용자 id를 주세요.");
    console.error("(dss-auth 관리 화면 → 사용자 관리에서 확인)");
    process.exitCode = 1;
    return;
  }
  if (!UUID_PATTERN.test(subject)) {
    console.error(`"${subject}"는 dss-auth 사용자 id 형태가 아닙니다(UUID여야 합니다).`);
    process.exitCode = 1;
    return;
  }

  // 이미 다른 계정이 이 DSS 사용자를 쓰고 있으면 막는다. DB의 부분 유니크
  // 인덱스도 같은 것을 막지만, 여기서 걸러야 사람이 읽을 수 있는 이유가 나온다.
  const [conflict] = await db
    .select({ email: users.email, name: users.name })
    .from(users)
    .where(eq(users.ssoSubject, subject))
    .limit(1);

  if (conflict && conflict.email !== target.email) {
    console.error(
      `이 DSS 사용자는 이미 ${conflict.name} <${conflict.email}> 계정에 연결되어 있습니다.`
    );
    console.error("먼저 그쪽 연결을 끊으세요:");
    console.error(`  npm run sso:link -- --email ${conflict.email} --unlink`);
    process.exitCode = 1;
    return;
  }

  if (target.ssoSubject === subject) {
    console.log(`${target.name}님은 이미 이 DSS 사용자와 연결되어 있습니다. 변경 없음.`);
    return;
  }

  if (target.ssoSubject) {
    console.log(`주의: ${target.name}님의 기존 연결을 덮어씁니다.`);
    console.log(`  이전: ${target.ssoSubject}`);
    console.log(`  이후: ${subject}`);
  }

  await db
    .update(users)
    .set({ ssoSubject: subject, ssoLinkedAt: new Date(), updatedAt: new Date() })
    .where(eq(users.id, target.id));

  console.log(`${target.name} <${target.email}> ↔ ${subject}`);
  console.log(`연결했습니다. 이제 통합 로그인으로 ${target.role} 권한으로 들어옵니다.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => pgClient.end());
