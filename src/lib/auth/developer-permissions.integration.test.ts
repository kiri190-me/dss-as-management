import "../../../scripts/load-env";

import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { db, pgClient } from "@/lib/db/connection";
import { procedureTemplates, rolePermissions, users } from "@/lib/db/schema";
import { publishProcedureTemplate } from "@/lib/db/mutations/procedure-templates";
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

/**
 * 🔴 이 단언이 「같다(=)」에서 「진짜 역할 ∪ 최고관리자」로 바뀐 이유
 * ─────────────────────────────────────────────────────────────────────────
 * 승격이 「갈아치우기」였을 때는 개발자의 답이 최고관리자와 **정확히 같았다.**
 * 그런데 최고관리자보다 A/S 엔지니어가 높은 잎이 실제로 있다:
 * `myActiveWork`(「내 담당 제품」)는 정책상 **A/S 엔지니어 전용**이고 최고관리자에게
 * 닫혀 있다(my-active-work-authorization.ts, 일부러 그렇게 정한 정책).
 *
 * 즉 갈아치우기에서는 **개발자 표시를 켜는 순간 엔지니어가 「내 담당 제품」 메뉴를
 * 잃었다.** 「표시를 켜니까 오히려 안 되네」가 가설이 아니라 이미 일어나 있던 일이다.
 *
 * 더하기로 바꾼 뒤 답은 두 역할의 합이다. 단언을 느슨하게 한 것이 아니라
 * **정확한 합**으로 적는다 — ≥ 가 아니라 = 이고, 양쪽을 모두 확인한다.
 */
function unionLevel(a: string, b: string): string {
  const rank = ["NONE", "READ", "WRITE", "MANAGE"];
  return rank.indexOf(a) >= rank.indexOf(b) ? a : b;
}

test("🔴 개발자 표시가 켜진 A/S 엔지니어의 실효 권한이 「진짜 역할 ∪ 최고관리자」다", async () => {
  const dev = await resolveEffectivePermissions(DEV_ACTOR);
  const superAdmin = await resolveEffectivePermissions(SUPER_ADMIN_ACTOR);
  const engineer = await resolveEffectivePermissions(roleOnlyActor("AS_ENGINEER"));

  for (const leafKey of PERMISSION_LEAF_KEYS) {
    assert.equal(
      dev.leafLevels[leafKey],
      unionLevel(engineer.leafLevels[leafKey], superAdmin.leafLevels[leafKey]),
      `${leafKey}: 더하기 결과가 아니다`
    );
    // 어느 쪽으로도 손해가 없다.
    assert.ok(meetsPermissionLevel(dev.leafLevels[leafKey], superAdmin.leafLevels[leafKey]), `${leafKey}: 최고관리자보다 낮다`);
    assert.ok(meetsPermissionLevel(dev.leafLevels[leafKey], engineer.leafLevels[leafKey]), `${leafKey}: 자기 역할보다 낮다`);
  }
  for (const area of PERMISSION_AREAS) {
    assert.ok(meetsPermissionLevel(dev.levels[area.key], superAdmin.levels[area.key]), `${area.key}: 최고관리자보다 낮다`);
    assert.ok(meetsPermissionLevel(dev.levels[area.key], engineer.levels[area.key]), `${area.key}: 자기 역할보다 낮다`);
  }

  // 🔴 갈아치우기가 실제로 빼앗던 자리 — 최고관리자에게 닫힌 엔지니어 전용 메뉴.
  assert.equal(superAdmin.levels.myActiveWork, "NONE", "myActiveWork 정책이 바뀌었다 — 이 시험의 전제가 사라졌다");
  assert.equal(engineer.levels.myActiveWork, "READ");
  assert.equal(dev.levels.myActiveWork, "READ", "개발자 표시를 켜서 「내 담당 제품」을 잃었다");

  // 네 창구가 전부 같은 답을 내야 한다 — 한 곳만 승격되면 화면과 서버 액션이
  // 어긋나서 "보이는데 눌리지 않는" 상태가 된다.
  for (const leafKey of PERMISSION_LEAF_KEYS) {
    assert.equal(await getPermissionLevel(DEV_ACTOR, leafKey), dev.leafLevels[leafKey], `getPermissionLevel 이 갈린다: ${leafKey}`);
    assert.equal(
      await hasPermission(DEV_ACTOR, leafKey, "MANAGE"),
      meetsPermissionLevel(dev.leafLevels[leafKey], "MANAGE"),
      `hasPermission 이 갈린다: ${leafKey}`
    );
  }

  // 사이드바가 거르는 목록도 합이다 — 최고관리자의 것을 전부 담고, 엔지니어 전용
  // 항목도 잃지 않는다.
  const devAreas = new Set(await listAccessibleAreaKeys(DEV_ACTOR));
  for (const key of await listAccessibleAreaKeys(SUPER_ADMIN_ACTOR)) {
    assert.ok(devAreas.has(key), `최고관리자에게 열린 ${key} 가 개발자에게 없다`);
  }
  for (const key of await listAccessibleAreaKeys(roleOnlyActor("AS_ENGINEER"))) {
    assert.ok(devAreas.has(key), `엔지니어에게 열린 ${key} 를 개발자가 잃었다`);
  }
});

test("🔴 그 사람의 role 은 여전히 AS_ENGINEER 다 — 세션 관문을 지나도", async () => {
  const actingUser = await resolveActingUserForSession(sessionFor(devUserId));
  assert.ok(actingUser);
  assert.equal(actingUser.role, "AS_ENGINEER", "승격이 진짜 역할을 덮어썼다");
  assert.equal(actingUser.isDeveloper, true, "DB 의 is_developer 가 관문에서 내려오지 않는다");

  // 그리고 그 살아 있는 행위자를 그대로 창구에 넣으면 인자로 만든 행위자와 같은
  // 답이 온다 — 관문을 지나는 길에서 승격이 사라지지 않는다.
  assert.deepEqual(
    (await resolveEffectivePermissions(actingUser)).leafLevels,
    (await resolveEffectivePermissions(DEV_ACTOR)).leafLevels
  );

  // 최고관리자의 권한을 하나도 빠뜨리지 않는다.
  const superAdmin = await resolveEffectivePermissions(SUPER_ADMIN_ACTOR);
  const live = await resolveEffectivePermissions(actingUser);
  for (const leafKey of PERMISSION_LEAF_KEYS) {
    assert.ok(
      meetsPermissionLevel(live.leafLevels[leafKey], superAdmin.leafLevels[leafKey]),
      `${leafKey}: 살아 있는 행위자가 최고관리자보다 낮다`
    );
  }
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

/**
 * ============================================================================
 * 🔴 승격은 더하기다 — 최고관리자 설정을 좁혀 놓고 확인한다
 * ============================================================================
 * role_permissions 는 화면에서 사람이 바꾸는 값이다. 최고관리자가 자기 역할의
 * 어떤 잎을 A/S 엔지니어보다 낮게 저장하면, 승격이 「갈아치우기」였을 때
 * **개발자 엔지니어가 그 잎에서 권한을 잃는다.** 아래 시험이 그 일을 막는다.
 *
 * 이 파일의 다른 시험들은 표가 비어 있는 상태를 전제하므로(before), 여기서는
 * 넣은 행을 try/finally 로 반드시 지운다 — 남으면 이 파일과
 * mutations/role-permissions.integration.test.ts 의 before 가 함께 깨진다.
 * ============================================================================
 */

/** 엔지니어에게 열려 있는 잎 하나를 실제 기본 정책에서 고른다(표로 적지 않는다). */
function leafOpenToEngineer(): string {
  const found = PERMISSION_LEAF_KEYS.find(
    (leafKey) => baselineLeafLevel(leafKey, "AS_ENGINEER") !== "NONE"
  );
  assert.ok(found, "A/S 엔지니어에게 열린 잎이 하나도 없다 — 기본 정책이 바뀌었다");
  return found;
}

async function withStoredLevels(
  rows: { role: (typeof ROLE_CODES)[number]; areaKey: string; level: "NONE" | "READ" | "WRITE" | "MANAGE" }[],
  run: () => Promise<void>
): Promise<void> {
  try {
    await db.insert(rolePermissions).values(rows.map((row) => ({ ...row, updatedBy: devUserId })));
    await run();
  } finally {
    await db.delete(rolePermissions).where(inArray(rolePermissions.role, rows.map((row) => row.role)));
  }
}

test("🔴 최고관리자 권한이 좁혀져도 개발자는 자기 역할 권한을 잃지 않는다", async () => {
  const leafKey = leafOpenToEngineer();
  const engineerBaseline = baselineLeafLevel(leafKey, "AS_ENGINEER");

  await withStoredLevels([{ role: "SUPER_ADMIN", areaKey: leafKey, level: "NONE" }], async () => {
    // 최고관리자는 설정대로 닫혔다.
    assert.equal(await getPermissionLevel(SUPER_ADMIN_ACTOR, leafKey), "NONE");

    // 개발자 엔지니어는 자기 역할의 권한을 그대로 갖는다 — 갈아치우기였다면 NONE 이다.
    assert.equal(
      await getPermissionLevel(DEV_ACTOR, leafKey),
      engineerBaseline,
      `${leafKey}: 개발자 표시를 켜서 오히려 권한을 잃었다`
    );
    assert.equal(await hasPermission(DEV_ACTOR, leafKey, engineerBaseline), true);

    // 표시가 꺼진 엔지니어의 답은 최고관리자 설정과 무관하게 그대로다.
    assert.equal(await getPermissionLevel(roleOnlyActor("AS_ENGINEER"), leafKey), engineerBaseline);
  });

  // 지운 뒤에는 기본 정책으로 돌아온다.
  assert.equal(await getPermissionLevel(SUPER_ADMIN_ACTOR, leafKey), baselineLeafLevel(leafKey, "SUPER_ADMIN"));
});

test("🔴 개발자는 두 역할 중 높은 쪽을 갖는다 — 양쪽 다 저장돼 있어도", async () => {
  const leafKey = leafOpenToEngineer();

  // 최고관리자를 닫고 엔지니어를 관리까지 올려 둔다.
  await withStoredLevels(
    [
      { role: "SUPER_ADMIN", areaKey: leafKey, level: "NONE" },
      { role: "AS_ENGINEER", areaKey: leafKey, level: "MANAGE" },
    ],
    async () => {
      assert.equal(await getPermissionLevel(DEV_ACTOR, leafKey), "MANAGE");
      assert.equal(await getPermissionLevel(SUPER_ADMIN_ACTOR, leafKey), "NONE");
    }
  );

  // 반대로 엔지니어를 닫고 최고관리자를 열어 두면 개발자는 최고관리자 쪽을 갖는다.
  await withStoredLevels(
    [
      { role: "SUPER_ADMIN", areaKey: leafKey, level: "MANAGE" },
      { role: "AS_ENGINEER", areaKey: leafKey, level: "NONE" },
    ],
    async () => {
      assert.equal(await getPermissionLevel(DEV_ACTOR, leafKey), "MANAGE");
      assert.equal(await getPermissionLevel(roleOnlyActor("AS_ENGINEER"), leafKey), "NONE");
    }
  );
});

test("좁혀진 설정에서도 권한 설정 화면의 표는 역할 자체의 값을 보여 준다", async () => {
  const leafKey = leafOpenToEngineer();

  await withStoredLevels([{ role: "SUPER_ADMIN", areaKey: leafKey, level: "NONE" }], async () => {
    const views = await buildRolePermissionViews({ actorRole: "AS_ENGINEER", actorIsDeveloper: true });

    // 표는 승격되지 않는다 — 최고관리자 줄은 저장된 값(NONE)이 그대로 보여야 한다.
    assert.equal(views.roles.SUPER_ADMIN.effective[leafKey], "NONE");
    assert.equal(views.roles.AS_ENGINEER.effective[leafKey], baselineLeafLevel(leafKey, "AS_ENGINEER"));

    // 다만 canWiden 은 표가 아니라 「이 사람이 넓혀 저장해도 되는가」이므로 승격된다.
    assert.equal(views.canWiden, true);
    assert.equal((await buildRolePermissionViews({ actorRole: "AS_ENGINEER" })).canWiden, false);
    assert.equal((await buildRolePermissionViews({ actorRole: "SUPER_ADMIN" })).canWiden, true);
  });
});

test("🔴 개발자는 표준 절차를 관리할 수 있다 — mutation 관문까지 실제로 통과한다", async () => {
  // publishProcedureTemplate 은 템플릿 행을 읽기 **전에** 거친 관문
  // (canManageTechnicalTemplates)을 먼저 본다. 그래서 없는 id 로 불러 보면
  // 아무것도 만들지 않고 관문만 확인할 수 있다:
  //   관문에 막히면 FORBIDDEN, 관문을 지나면 NOT_FOUND.
  const missingTemplateId = randomUUID();

  const asDeveloper = await publishProcedureTemplate(missingTemplateId, devUserId);
  assert.equal(asDeveloper.ok, false);
  assert.equal(
    asDeveloper.ok === false ? asDeveloper.code : null,
    "NOT_FOUND",
    "개발자 엔지니어가 표준 절차 관문에서 막혔다"
  );

  const asPlainEngineer = await publishProcedureTemplate(missingTemplateId, plainUserId);
  assert.equal(asPlainEngineer.ok, false);
  assert.equal(
    asPlainEngineer.ok === false ? asPlainEngineer.code : null,
    "FORBIDDEN",
    "표시가 꺼진 엔지니어에게 권한이 샜다"
  );

  // 아무 행도 만들지 않았다 — 관문에서 끝났다.
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(procedureTemplates)
    .where(eq(procedureTemplates.id, missingTemplateId));
  assert.equal(count, 0);
});

test("표가 비어 있는 상태로 되돌아왔다 — 다음 시험 파일이 전제하는 상태다", async () => {
  const rows = await db.select({ id: rolePermissions.id }).from(rolePermissions);
  assert.equal(rows.length, 0, "이 파일이 넣은 role_permissions 행이 남아 있다");
});
