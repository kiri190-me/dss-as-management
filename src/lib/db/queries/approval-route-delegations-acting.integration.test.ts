import "../../../../scripts/load-env";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { inArray, like, or } from "drizzle-orm";
import { db, pgClient } from "../connection";
import { approvalRouteDelegations, portalApprovalDelegations, users } from "../schema";
import {
  resolveActingApproverUserIds,
  resolveActingDelegateUserIds,
} from "./approval-route-delegations";
import { guardPreexistingRows, type PreexistingRowsGuard } from "../test-cleanup-guard";

/**
 * ============================================================================
 * 위임을 **양방향으로** 묻는 두 조회 — 실제 DB (시험 DB)
 * ============================================================================
 * 재는 것은 `resolveActingDelegateUserIds`(「나를 누가 대신하나」)이고, 짝인
 * `resolveActingApproverUserIds`(「내가 누구를 대신하나」)는 **맞대어 보는 자**로
 * 함께 쓴다.
 *
 * ── 왜 이 파일이 생겼나 (2026-11-17, 설계 D-8 ①) ────────────────────────
 * 결재가 생기면 그 단계의 결재자 **와 그를 대신할 수 있는 사람들**에게 즉시 메일이
 * 나간다(server/integration/approval-created-notice.ts). 🔴 그런데 그 「대신할 수 있는
 * 사람들」을 세는 조회가 **A/S 제 표 하나만** 읽고 있어서, **통합 승인함에서 맡긴
 * 위임의 대리인이 빠졌다.** 그 사람은 결재를 **누를 수는 있고**(판정 쪽은 2026-11-16
 * 부터 두 표를 읽는다) 종에도 승인함 대기 목록에도 떴다 — 🔴 **모자란 것은 생길 때
 * 나가는 메일 하나뿐**이었고, 그래서 화면에도 로그에도 아무 표시가 안 남았다.
 *
 * ── 여기서 지키는 것 다섯 ───────────────────────────────────────────────
 *  1. 🔴 **포털 위임의 대리인이 목록에 들어온다** — 이 조각의 전부다.
 *  2. A/S 제 표의 대리인도 그대로 남는다(합집합 — 설계 B-4: 둘 다 살려 둔다).
 *  3. 🔴 **끝났거나 거둔 위임의 대리인은 안 들어온다** — 두 표 모두. 안 가리면
 *     「승인함에서는 거뒀는데 메일은 계속 온다」가 된다.
 *  4. 🔴 **같은 사람이 두 표 양쪽에 적혀 있어도 한 번만** 나온다. 두 번 실리면 포털이
 *     같은 사람에게 두 번 묻고, 사람은 같은 결재로 메일을 두 통 받는다.
 *  5. 🔴 **두 방향이 같은 규칙을 쓴다** — 같은 줄을 양쪽으로 물어 짝이 맞는지 본다.
 *     🔵 규칙(`revoked_at IS NULL AND ends_at > now`)을 여기 **베껴 적지 않는다.**
 *     베끼면 시험이 규칙의 사본을 재게 되어, 한쪽 조회만 고친 날에도 초록으로
 *     통과한다. 짝 맞추기는 **한쪽만 고치는 순간** 깨진다 — 그 어긋남(「메일은 오는데
 *     눌리지 않는다」, 또는 그 반대)은 지금까지 신고로만 드러났다.
 *
 * 🔵 순수 규칙 자체(반열린 구간 · 되돌림 · 이어 붙지 않음)는
 * domain/approval-route-delegation.test.ts 가 DB 없이 잰다. 여기서만 알 수 있는 것은
 * **조회가 어느 표를 어떤 조건으로 읽는가**다 — 그 둘은 SQL 에 있어서 순수 시험이
 * 못 본다.
 *
 * ── 격리·청소 규약 ──────────────────────────────────────────────────────
 * 🔴 **표가 비어 있다고 가정하지 않는다.** 이 파일은 `routedelegacting-test-` 로
 * 시작하는 던지기용 계정만 만들고, **그 계정의 id 로만** 묻는다 — 남의 줄이 몇 개든
 * 답이 달라지지 않는다. 접수 건·견적서·판을 하나도 만들지 않으므로 접수번호 차례(D…)와
 * 공유 폴더에는 손이 닿지 않는다.
 * 🔵 옆 파일들의 접두사(`routedeleg-test-` · `routedelegdecide-test-`)와 **서로 걸리지
 * 않는다** — 그쪽 치우기는 `routedeleg-test-%` 로 지우는데, 이 파일의 이메일은
 * `routedeleg` 뒤에 `-` 가 아니라 `a` 가 온다.
 * 🔴 치우기가 남의 줄을 지우지 않는지를 지문으로 증명한다(test-cleanup-guard) —
 * **두 표 모두**.
 * ============================================================================
 */

const TEST_EMAIL_PREFIX = "routedelegacting-test-";

/** 「지금」을 벽시계에서 받지 않는다 — 모든 줄을 이 시각에 맞춰 세운다. */
const NOW = new Date("2026-11-17T03:00:00.000Z");
const hours = (n: number) => new Date(NOW.getTime() + n * 60 * 60 * 1000);

const createdTestUserIds: string[] = [];
let ownGuard: PreexistingRowsGuard;
let portalGuard: PreexistingRowsGuard;

async function createTestUser(name: string): Promise<string> {
  const [row] = await db
    .insert(users)
    .values({
      email: `${TEST_EMAIL_PREFIX}${randomUUID().slice(0, 8)}@example.test`,
      name,
      role: "AS_ENGINEER",
      approvalStatus: "APPROVED",
      isActive: true,
    })
    .returning({ id: users.id });
  createdTestUserIds.push(row.id);
  return row.id;
}

/**
 * A/S 화면에서 맡긴 위임 한 줄을 **표에 직접** 적는다.
 *
 * 🔵 쓰기 mutation 을 거치지 않는 까닭: 여기서 재는 것은 **읽는 쪽**이고, mutation 을
 * 거치면 권한·겹침 검사까지 표본에 끼어들어 「왜 이 줄이 안 들어갔나」가 두 겹이 된다.
 * 쓰기 쪽 규칙은 mutations/approval-route-delegations.integration.test.ts 가 잰다.
 *
 * 🔴 되돌린 줄은 **되돌린 사람까지** 적어야 한다 — 표의
 * `…_revocation_metadata` CHECK 가 한쪽만 적힌 줄을 아예 안 받는다.
 */
async function insertOwnDelegation(params: {
  delegatorUserId: string;
  delegateUserId: string;
  startsAt: Date;
  endsAt: Date;
  revokedAt?: Date | null;
}): Promise<string> {
  const [row] = await db
    .insert(approvalRouteDelegations)
    .values({
      delegatorUserId: params.delegatorUserId,
      delegateUserId: params.delegateUserId,
      startsAt: params.startsAt,
      endsAt: params.endsAt,
      reason: "",
      createdByUserId: params.delegatorUserId,
      revokedAt: params.revokedAt ?? null,
      revokedByUserId: params.revokedAt ? params.delegatorUserId : null,
    })
    .returning({ id: approvalRouteDelegations.id });
  return row.id;
}

/**
 * 통합 승인함에서 맡겨 **포털이 전파해 준** 줄. A/S 는 이 표에 쓰지 않으므로(들어오는
 * 길은 포털이 부르는 통로 하나뿐이다) 통로가 열쇠를 바꿔 넣은 **뒤의 모습**을 직접
 * 적어 세운다. 🔴 `id` 는 포털이 정해서 보내는 값이라 표에 기본값이 없다.
 */
async function insertPortalDelegation(params: {
  delegatorUserId: string;
  delegateUserId: string;
  startsAt: Date;
  endsAt: Date;
  revokedAt?: Date | null;
}): Promise<string> {
  const id = randomUUID();
  await db.insert(portalApprovalDelegations).values({
    id,
    delegatorUserId: params.delegatorUserId,
    delegateUserId: params.delegateUserId,
    startsAt: params.startsAt,
    endsAt: params.endsAt,
    reason: "",
    revokedAt: params.revokedAt ?? null,
  });
  return id;
}

before(async () => {
  ownGuard = await guardPreexistingRows({
    label: "approval_route_delegations",
    table: approvalRouteDelegations,
    idColumn: approvalRouteDelegations.id,
    createdAtColumn: approvalRouteDelegations.createdAt,
  });
  portalGuard = await guardPreexistingRows({
    label: "portal_approval_delegations",
    table: portalApprovalDelegations,
    idColumn: portalApprovalDelegations.id,
    createdAtColumn: portalApprovalDelegations.syncedAt,
  });
});

after(async () => {
  if (createdTestUserIds.length > 0) {
    // 🔴 사람 참조가 전부 RESTRICT 라 위임 줄을 먼저 걷어야 계정이 지워진다. 남으면
    //    그 실패는 **다음 실행의 before 에서** 엉뚱한 얼굴로 나타난다.
    await db
      .delete(approvalRouteDelegations)
      .where(
        or(
          inArray(approvalRouteDelegations.delegatorUserId, createdTestUserIds),
          inArray(approvalRouteDelegations.delegateUserId, createdTestUserIds),
          inArray(approvalRouteDelegations.createdByUserId, createdTestUserIds),
          inArray(approvalRouteDelegations.revokedByUserId, createdTestUserIds)
        )
      );
    await db
      .delete(portalApprovalDelegations)
      .where(
        or(
          inArray(portalApprovalDelegations.delegatorUserId, createdTestUserIds),
          inArray(portalApprovalDelegations.delegateUserId, createdTestUserIds)
        )
      );
  }
  await db.delete(users).where(like(users.email, `${TEST_EMAIL_PREFIX}%`));

  // 🔴 치우기가 **만들기 전부터 있던 줄**을 건드리지 않았는지. 지문이 어긋나면 이
  // 시험 전체가 실패해야 한다 — 조용히 넘어가면 남의 자료가 사라진 채로 남는다.
  assert.deepEqual(await ownGuard.current(), ownGuard.baseline);
  assert.deepEqual(await portalGuard.current(), portalGuard.baseline);

  await pgClient.end({ timeout: 5 });
});

describe("resolveActingDelegateUserIds — 고지가 둘이다", () => {
  test("🔴 통합 승인함에서 맡긴 위임의 대리인이 목록에 들어온다", async () => {
    const 결재권자 = await createTestUser("위임조회 결재권자");
    const 승인함대리인 = await createTestUser("위임조회 승인함 대리인");

    // 🔵 표본이 공짜로 통과하지 않게 — **줄을 넣기 전에는 비어 있다**를 먼저 못 박는다.
    assert.deepEqual(
      await resolveActingDelegateUserIds(결재권자, NOW),
      [],
      "표본이 깨졌다 — 아무 줄도 안 넣었는데 대리인이 나온다"
    );

    await insertPortalDelegation({
      delegatorUserId: 결재권자,
      delegateUserId: 승인함대리인,
      startsAt: hours(-1),
      endsAt: hours(24),
    });

    assert.deepEqual(
      await resolveActingDelegateUserIds(결재권자, NOW),
      [승인함대리인],
      "🔴 승인함에서 맡긴 위임의 대리인이 빠진다 — 그 사람은 결재 메일을 못 받는다"
    );
  });

  test("🔴 합집합이다 — A/S 제 표의 대리인과 승인함 쪽 대리인이 둘 다 나온다", async () => {
    const 결재권자 = await createTestUser("합집합 결재권자");
    const 제표대리인 = await createTestUser("합집합 A/S 대리인");
    const 승인함대리인 = await createTestUser("합집합 승인함 대리인");

    await insertOwnDelegation({
      delegatorUserId: 결재권자,
      delegateUserId: 제표대리인,
      startsAt: hours(-1),
      endsAt: hours(24),
    });
    await insertPortalDelegation({
      delegatorUserId: 결재권자,
      delegateUserId: 승인함대리인,
      startsAt: hours(-1),
      endsAt: hours(24),
    });

    assert.deepEqual(
      [...(await resolveActingDelegateUserIds(결재권자, NOW))].sort(),
      [제표대리인, 승인함대리인].sort(),
      "🔴 한쪽 표의 대리인이 다른 쪽에 밀려 사라졌다"
    );
  });

  test("🔴 같은 사람이 두 표 양쪽에 적혀 있어도 한 번만 — 메일 두 통은 안 된다", async () => {
    const 결재권자 = await createTestUser("중복 결재권자");
    const 대리인 = await createTestUser("중복 대리인");

    await insertOwnDelegation({
      delegatorUserId: 결재권자,
      delegateUserId: 대리인,
      startsAt: hours(-1),
      endsAt: hours(24),
    });
    await insertPortalDelegation({
      delegatorUserId: 결재권자,
      delegateUserId: 대리인,
      startsAt: hours(-2),
      endsAt: hours(48),
    });

    // 🔵 **두 줄이 실제로 둘 다 살아 있는** 표본인지 먼저 — 하나가 죽어 있으면
    //    「한 번만」은 공짜로 통과한다. 한쪽씩 지워 가며 재는 대신, 같은 줄을 한쪽
    //    표에만 넣었을 때도 그 사람이 나온다는 것을 옆 시험들이 이미 보였다.
    const 대리인들 = await resolveActingDelegateUserIds(결재권자, NOW);
    assert.deepEqual(대리인들, [대리인], "🔴 같은 사람이 두 번 나온다 — 메일이 두 통 간다");
  });

  test("🔴 끝났거나 거둔 위임의 대리인은 안 들어온다 — 두 표 모두", async () => {
    const 결재권자 = await createTestUser("만료 결재권자");
    const 거둔쪽대리인 = await createTestUser("만료 승인함 대리인");
    const 끝난쪽대리인 = await createTestUser("만료 A/S 대리인");

    // 🔵 **살아 있었다면 들어왔을 줄**인지 먼저 못 박는다 — 기간·되돌림만 바꾼 같은
    //    모양의 줄을 넣어 재고, 그다음에 죽은 줄로 바꾼다.
    const 살아있는포털줄 = await insertPortalDelegation({
      delegatorUserId: 결재권자,
      delegateUserId: 거둔쪽대리인,
      startsAt: hours(-1),
      endsAt: hours(24),
    });
    const 살아있는제표줄 = await insertOwnDelegation({
      delegatorUserId: 결재권자,
      delegateUserId: 끝난쪽대리인,
      startsAt: hours(-1),
      endsAt: hours(24),
    });
    assert.deepEqual(
      [...(await resolveActingDelegateUserIds(결재권자, NOW))].sort(),
      [거둔쪽대리인, 끝난쪽대리인].sort(),
      "표본이 깨졌다 — 살아 있는 줄인데도 대리인이 안 나온다"
    );

    // 승인함에서 거뒀다(전파가 `revoked_at` 을 적고 간 모습 그대로).
    await db
      .delete(portalApprovalDelegations)
      .where(inArray(portalApprovalDelegations.id, [살아있는포털줄]));
    await insertPortalDelegation({
      delegatorUserId: 결재권자,
      delegateUserId: 거둔쪽대리인,
      startsAt: hours(-1),
      endsAt: hours(24),
      revokedAt: hours(-0.5),
    });
    // A/S 제 표의 줄은 기간이 끝났다.
    await db
      .delete(approvalRouteDelegations)
      .where(inArray(approvalRouteDelegations.id, [살아있는제표줄]));
    await insertOwnDelegation({
      delegatorUserId: 결재권자,
      delegateUserId: 끝난쪽대리인,
      startsAt: hours(-48),
      endsAt: hours(-24),
    });

    assert.deepEqual(
      await resolveActingDelegateUserIds(결재권자, NOW),
      [],
      "🔴 죽은 위임의 대리인에게 결재 메일이 간다"
    );
  });

  test("🔴 아직 시작 안 한 위임의 대리인도 아직 아니다 — 두 표 모두", async () => {
    const 결재권자 = await createTestUser("예정 결재권자");
    const 제표대리인 = await createTestUser("예정 A/S 대리인");
    const 승인함대리인 = await createTestUser("예정 승인함 대리인");

    await insertOwnDelegation({
      delegatorUserId: 결재권자,
      delegateUserId: 제표대리인,
      startsAt: hours(10),
      endsAt: hours(20),
    });
    await insertPortalDelegation({
      delegatorUserId: 결재권자,
      delegateUserId: 승인함대리인,
      startsAt: hours(10),
      endsAt: hours(20),
    });

    assert.deepEqual(
      await resolveActingDelegateUserIds(결재권자, NOW),
      [],
      "🔴 아직 시작 안 한 위임의 대리인에게 벌써 메일이 간다"
    );
    // 🔵 **그 줄이 때가 되면 실제로 든다**는 것까지 봐야 「아직 아니다」가 뜻을 갖는다.
    //    여기서 아무도 안 나온다면 위의 빈 목록은 줄을 잘못 넣은 결과일 뿐이다.
    assert.deepEqual(
      [...(await resolveActingDelegateUserIds(결재권자, hours(15)))].sort(),
      [제표대리인, 승인함대리인].sort(),
      "표본이 깨졌다 — 기간 안인데도 대리인이 안 나온다"
    );
  });

  test("남의 결재권자로 물으면 빈 목록 — 방향·사람이 안 섞인다", async () => {
    const 결재권자 = await createTestUser("남 결재권자");
    const 대리인 = await createTestUser("남 대리인");
    const 상관없는사람 = await createTestUser("남 상관없는 사람");

    await insertPortalDelegation({
      delegatorUserId: 결재권자,
      delegateUserId: 대리인,
      startsAt: hours(-1),
      endsAt: hours(24),
    });

    assert.deepEqual(await resolveActingDelegateUserIds(결재권자, NOW), [대리인], "표본이 깨졌다");
    assert.deepEqual(await resolveActingDelegateUserIds(상관없는사람, NOW), []);
    // 🔴 **방향을 거꾸로 물으면 빈 목록이다.** 대리인을 결재권자 자리에 넣어도 오류가
    //    안 나고, 그 빈 목록은 「대신할 사람이 없다」와 구별되지 않는다.
    assert.deepEqual(await resolveActingDelegateUserIds(대리인, NOW), []);
  });
});

describe("🔴 두 방향이 같은 규칙을 쓴다 — 짝이 맞는지 맞대어 본다", () => {
  test("B 가 A 의 대리인이다 ⟺ A 가 B 의 자격 목록에 들어 있다", async () => {
    // 🔴 조건(`revoked_at IS NULL AND ends_at > now`)을 여기 베껴 적지 않는다. 베껴
    //    적으면 **시험이 규칙의 사본**을 재게 되어, 한쪽 조회만 고친 날에도 초록으로
    //    통과한다. 두 조회가 **같은 자리**(readLiveDelegationPeriodsFromBothSources)를
    //    쓰는 한 이 짝은 어느 시각에도 맞고, 한쪽만 고치는 순간 깨진다.
    const 가 = await createTestUser("짝맞춤 가");
    const 나 = await createTestUser("짝맞춤 나");
    const 다 = await createTestUser("짝맞춤 다");
    const 라 = await createTestUser("짝맞춤 라");
    const 사람들 = [가, 나, 다, 라];

    // A/S 제 표: 살아 있는 줄 · 거둔 줄 · 아직 시작 안 한 줄.
    await insertOwnDelegation({
      delegatorUserId: 가,
      delegateUserId: 나,
      startsAt: hours(-1),
      endsAt: hours(24),
    });
    await insertOwnDelegation({
      delegatorUserId: 다,
      delegateUserId: 라,
      startsAt: hours(-1),
      endsAt: hours(24),
      revokedAt: hours(-0.5),
    });
    await insertOwnDelegation({
      delegatorUserId: 라,
      delegateUserId: 다,
      startsAt: hours(10),
      endsAt: hours(20),
    });
    // 승인함 쪽: 살아 있는 줄 · 이미 끝난 줄.
    await insertPortalDelegation({
      delegatorUserId: 가,
      delegateUserId: 다,
      startsAt: hours(-1),
      endsAt: hours(24),
    });
    await insertPortalDelegation({
      delegatorUserId: 나,
      delegateUserId: 라,
      startsAt: hours(-48),
      endsAt: hours(-24),
    });

    // 🔵 **두 고지가 둘 다 참을 만드는 표본**인지 먼저 못 박는다 — 한쪽 표에 살아 있는
    //    줄이 없으면 아래 맞대기는 그 표에 대해 아무것도 재지 않는다.
    assert.deepEqual(
      [...(await resolveActingDelegateUserIds(가, NOW))].sort(),
      [나, 다].sort(),
      "표본이 깨졌다 — 두 표에 한 줄씩 살아 있어야 한다"
    );

    let 짝이참 = 0;
    let 짝이거짓 = 0;
    for (const at of [hours(-2), NOW, hours(15), hours(30)]) {
      const 대리인표 = new Map<string, readonly string[]>();
      const 자격표 = new Map<string, readonly string[]>();
      for (const 사람 of 사람들) {
        대리인표.set(사람, await resolveActingDelegateUserIds(사람, at));
        자격표.set(사람, await resolveActingApproverUserIds(사람, at));
      }

      for (const 결재권자 of 사람들) {
        for (const 사람 of 사람들) {
          if (사람 === 결재권자) continue;
          const 대리인인가 = 대리인표.get(결재권자)!.includes(사람);
          const 자격에있나 = 자격표.get(사람)!.includes(결재권자);
          assert.equal(
            대리인인가,
            자격에있나,
            `${at.toISOString()}: 「이 사람이 저 사람을 대신한다」가 두 방향에서 다르다`
          );
          if (대리인인가) 짝이참 += 1;
          else 짝이거짓 += 1;
        }
      }
    }

    // 🔵 둘 다 0 이 아니어야 맞대기를 실제로 한 셈이다 — 전부 거짓이면 「아무도 아무도
    //    안 대신한다」를 양쪽에서 확인한 것뿐이다.
    assert.ok(짝이참 > 0, "표본에 참인 짝이 하나도 없다 — 이 시험이 아무것도 안 잰다");
    assert.ok(짝이거짓 > 0, "표본에 거짓인 짝이 하나도 없다 — 이 시험이 아무것도 안 잰다");
  });
});
