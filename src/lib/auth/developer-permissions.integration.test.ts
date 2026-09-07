import "../../../scripts/load-env";

import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { db, pgClient } from "@/lib/db/connection";
import { rolePermissions, users } from "@/lib/db/schema";
import { resolveActingUserForSession } from "./acting-user";
import {
  resolveEffectivePermissions,
  getPermissionLevel,
  hasPermission,
  listAccessibleAreaKeys,
  roleOnlyActor,
  type PermissionActor,
} from "./permission-resolver";
import { buildRolePermissionViews } from "./role-permission-views";
import { PERMISSION_AREAS, meetsPermissionLevel } from "./permission-areas";
import { PERMISSION_LEAF_KEYS, maxMeaningfulLevelOfLeaf } from "./permission-features";
import { baselineLeafLevel } from "./permission-baseline";
import { ROLE_CODES } from "@/lib/domain/types";
import type { SessionPayload } from "./session";

/**
 * ============================================================================
 * 개발자 표시가 권한을 최고관리자급으로 올린다 — 실제 DB
 * ============================================================================
 * users.is_developer 는 **역할이 아니다.** 켜지면 권한 판정에서만 최고관리자로
 * 해석되고(permission-resolver.ts), 그 사람의 role 은 끝까지 그대로다.
 *
 * 해석기가 role_permissions 표를 읽으므로 이 시험들은 DB 가 필요하다. 역할이
 * 그대로 남는다는 쪽(배정·자격·이름표)은 DB 없이 developer-flag.test.ts 가 본다.
 *
 * role_permissions 는 건드리지 않는다 — 이 파일은 저장 경로를 시험하지 않고,
 * 기본 정책 상태에서 승격만 본다. before() 에서 표가 비어 있는지 확인한다.
 * ============================================================================
 */

const DEV_ACTOR: PermissionActor = { role: "AS_ENGINEER", isDeveloper: true };
const SUPER_ADMIN_ACTOR = roleOnlyActor("SUPER_ADMIN");

let originalAuthSource: string | undefined;
let devUserId: string;
let plainUserId: string;

function sessionFor(userId: string): SessionPayload {
  const now = Math.floor(Date.now() / 1000);
  return { userId, role: "AS_ENGINEER", approvalStatus: "APPROVED", issuedAt: now, expiresAt: now + 3600 };
}

before(async () => {
  originalAuthSource = process.env.AUTH_SOURCE;
  process.env.AUTH_SOURCE = "database";

  const stored = await db.select({ id: rolePermissions.id }).from(rolePermissions);
  assert.equal(stored.length, 0, "이 시험은 role_permissions 가 비어 있는 상태(기본 정책)를 전제로 합니다");

  // 개발자로 표시된 A/S 엔지니어 하나, 표시가 꺼진 A/S 엔지니어 하나.
  // 둘 다 이 파일이 만들고 이 파일이 지운다 — 씨앗 계정은 건드리지 않는다.
  const [dev] = await db
    .insert(users)
    .values({
      email: `devflag-${randomUUID()}@example.test`,
      name: "개발자 표시 시험 계정",
      role: "AS_ENGINEER",
      approvalStatus: "APPROVED",
      isDeveloper: true,
    })
    .returning({ id: users.id });
  const [plain] = await db
    .insert(users)
    .values({
      email: `devflag-${randomUUID()}@example.test`,
      name: "개발자 아님 시험 계정",
      role: "AS_ENGINEER",
      approvalStatus: "APPROVED",
    })
    .returning({ id: users.id });
  devUserId = dev.id;
  plainUserId = plain.id;
});

after(async () => {
  await db.delete(users).where(inArray(users.id, [devUserId, plainUserId]));
  if (originalAuthSource === undefined) delete process.env.AUTH_SOURCE;
  else process.env.AUTH_SOURCE = originalAuthSource;
  await pgClient.end();
});

test("🔴 개발자 표시가 켜진 A/S 엔지니어의 실효 권한이 최고관리자와 같다", async () => {
  const dev = await resolveEffectivePermissions(DEV_ACTOR);
  const superAdmin = await resolveEffectivePermissions(SUPER_ADMIN_ACTOR);

  assert.deepEqual(dev.leafLevels, superAdmin.leafLevels);
  assert.deepEqual(dev.levels, superAdmin.levels);

  // 네 창구가 전부 같은 답을 내야 한다 — 한 곳만 승격되면 화면과 서버 액션이
  // 어긋나서 "보이는데 눌리지 않는" 상태가 된다.
  for (const leafKey of PERMISSION_LEAF_KEYS) {
    assert.equal(
      await getPermissionLevel(DEV_ACTOR, leafKey),
      await getPermissionLevel(SUPER_ADMIN_ACTOR, leafKey),
      `getPermissionLevel 이 갈린다: ${leafKey}`
    );
    assert.equal(
      await hasPermission(DEV_ACTOR, leafKey, "MANAGE"),
      await hasPermission(SUPER_ADMIN_ACTOR, leafKey, "MANAGE"),
      `hasPermission 이 갈린다: ${leafKey}`
    );
  }
  assert.deepEqual(await listAccessibleAreaKeys(DEV_ACTOR), await listAccessibleAreaKeys(SUPER_ADMIN_ACTOR));
});

test("🔴 그 사람의 role 은 여전히 AS_ENGINEER 다 — 세션 관문을 지나도", async () => {
  const actingUser = await resolveActingUserForSession(sessionFor(devUserId));
  assert.ok(actingUser);
  assert.equal(actingUser.role, "AS_ENGINEER", "승격이 진짜 역할을 덮어썼다");
  assert.equal(actingUser.isDeveloper, true, "DB 의 is_developer 가 관문에서 내려오지 않는다");

  // 그리고 그 살아 있는 행위자를 그대로 창구에 넣으면 최고관리자와 같은 답이 온다.
  assert.deepEqual(
    (await resolveEffectivePermissions(actingUser)).leafLevels,
    (await resolveEffectivePermissions(SUPER_ADMIN_ACTOR)).leafLevels
  );
});

test("개발자 표시가 꺼진 계정의 답은 예전과 완전히 같다 — 다섯 역할 모든 잎", async () => {
  for (const role of ROLE_CODES) {
    const resolved = await resolveEffectivePermissions(roleOnlyActor(role));
    for (const leafKey of PERMISSION_LEAF_KEYS) {
      assert.equal(
        resolved.leafLevels[leafKey],
        baselineLeafLevel(leafKey, role),
        `${role}/${leafKey} 가 기본 정책에서 벗어났다`
      );
    }
  }

  // 관문을 지나온 실제 계정도 마찬가지다 — 승격은 isDeveloper === true 일 때만이다.
  const plain = await resolveActingUserForSession(sessionFor(plainUserId));
  assert.ok(plain);
  assert.equal(plain.isDeveloper, false);
  assert.deepEqual(
    (await resolveEffectivePermissions(plain)).leafLevels,
    (await resolveEffectivePermissions(roleOnlyActor("AS_ENGINEER"))).leafLevels
  );
});

test("🔴 권한 설정 화면의 표는 승격되지 않는다 — 다섯 역할을 그대로 보여 준다", async () => {
  // 개발자가 이 화면을 열든 아니든 같은 표여야 한다. 해석기가 세션을 몰래
  // 들여다보는 구현이었다면 여기서 다섯 줄이 전부 최고관리자로 보인다.
  const asDeveloper = await buildRolePermissionViews({ actorRole: "AS_ENGINEER" });
  const asSuperAdmin = await buildRolePermissionViews({ actorRole: "SUPER_ADMIN" });

  assert.deepEqual(Object.keys(asDeveloper.roles).sort(), [...ROLE_CODES].sort());

  for (const role of ROLE_CODES) {
    assert.deepEqual(asDeveloper.roles[role].effective, asSuperAdmin.roles[role].effective);
    for (const leafKey of PERMISSION_LEAF_KEYS) {
      assert.equal(
        asDeveloper.roles[role].effective[leafKey],
        baselineLeafLevel(leafKey, role),
        `표의 ${role}/${leafKey} 가 역할 자체의 값이 아니다`
      );
    }
  }

  // 그리고 엔지니어 줄은 최고관리자 줄과 달라야 한다 — 같아졌다면 승격이 샜다.
  assert.notDeepEqual(
    asDeveloper.roles.AS_ENGINEER.effective,
    asDeveloper.roles.SUPER_ADMIN.effective
  );
});

test("승격이 maxMeaningfulLevel 을 넘지 않는다 — 최고관리자보다 높아지지 않는다", async () => {
  const dev = await resolveEffectivePermissions(DEV_ACTOR);

  for (const leafKey of PERMISSION_LEAF_KEYS) {
    const ceiling = maxMeaningfulLevelOfLeaf(leafKey);
    assert.ok(
      meetsPermissionLevel(ceiling, dev.leafLevels[leafKey]),
      `${leafKey}: 승격값 ${dev.leafLevels[leafKey]} 이 의미 있는 최고 수준 ${ceiling} 을 넘는다`
    );
  }
  for (const area of PERMISSION_AREAS) {
    assert.ok(
      meetsPermissionLevel(area.maxMeaningfulLevel, dev.levels[area.key]),
      `${area.key}: 승격값 ${dev.levels[area.key]} 이 ${area.maxMeaningfulLevel} 을 넘는다`
    );
  }
});

test("개발자 표시는 역할별 권한 설정으로 켤 수 없다 — role_permissions 에 자리가 없다", async () => {
  // 저장 단위는 (역할, 영역/잎 키)뿐이다. 사람 단위 칸을 가리킬 방법이 없으므로
  // 관리자가 권한 설정 화면에서 자신을 개발자로 만들 수 없다.
  const rows = await db.select({ role: rolePermissions.role, areaKey: rolePermissions.areaKey }).from(rolePermissions);
  assert.equal(rows.length, 0);

  const stillOff = await db
    .select({ isDeveloper: users.isDeveloper })
    .from(users)
    .where(eq(users.id, plainUserId));
  assert.equal(stillOff[0].isDeveloper, false, "권한 설정과 무관한 칸이 켜졌다");
});

test("승격은 최고관리자 「해석 결과」를 쓴다 — 모든 영역 MANAGE 로 박은 것이 아니다", async () => {
  const dev = await resolveEffectivePermissions(DEV_ACTOR);
  const levels = new Set(Object.values(dev.leafLevels));

  // 최고관리자에게도 MANAGE 가 무의미한 잎이 있다(예: 읽기 전용 영역).
  // "전부 MANAGE" 로 구현했다면 이 집합에 MANAGE 하나만 남는다.
  const nonManage = PERMISSION_LEAF_KEYS.filter((key) => dev.leafLevels[key] !== "MANAGE");
  assert.ok(
    nonManage.length > 0,
    `모든 잎이 MANAGE 다 — 최고관리자 해석 결과가 아니라 상수로 박혔을 가능성이 있다 (${[...levels].join(",")})`
  );
});

test("개발자로 표시된 계정은 이 파일이 만든 하나뿐이다 — 기존 데이터가 승격되지 않았다", async () => {
  const flagged = await db.select({ id: users.id }).from(users).where(eq(users.isDeveloper, true));
  assert.deepEqual(flagged.map((row) => row.id), [devUserId]);
});
