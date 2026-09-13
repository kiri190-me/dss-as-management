import "../../../../scripts/load-env";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, like } from "drizzle-orm";

import { db, pgClient } from "../connection";
import { auditLogs, improvementRequests, users } from "../schema";
import {
  changeImprovementRequestStatus,
  createImprovementRequest,
  deleteImprovementRequest,
  updateImprovementRequestBody,
  type ImprovementRequestMutationResult,
} from "./improvement-requests";
import { listImprovementRequests } from "../queries/improvement-requests";
import { DEVELOPER_MODE_NAV_KEY } from "@/lib/auth/developer-mode-gate";
import {
  IMPROVEMENT_REQUEST_OTHER_MENU_KEY,
  type ImprovementRequestStatus,
} from "@/lib/domain/improvement-request";

/**
 * ============================================================================
 * 개선 요청 — 규칙이 실제 DB 에서 지켜지는가
 * ============================================================================
 * 확인하는 것:
 *  1. **누가 무엇을** — 작성자는 접수 상태인 자기 글만 고치고 지운다. 남의 글,
 *     진행중이 된 글은 FORBIDDEN 이고 한 글자도 바뀌지 않는다. 관리 권한이
 *     있으면 상태를 옮기고 어느 글이든 지운다.
 *  2. **상태를 옮긴 행이 DB CHECK 를 통과한다** — 도메인의 계산과 스키마의 CHECK
 *     가 같은 말을 하는지는 실제 DB 에 넣어 봐야 안다. 대표 전이 넷을 넣는다.
 *  3. **CHECK 가 실제로 돈다** — 규칙에 어긋난 행을 직접 넣으면 23514 로 거절된다.
 *  4. **version 이 낙관적 잠금으로 동작한다** — 낡은 version 은 CONFLICT.
 *  5. **감사 로그가 동작마다 한 줄씩** — 같은 상태로의 변경은 한 줄도 늘리지 않는다.
 *  6. **목록 조회**가 세 사람의 이름과 ISO 시각을 함께, 최근 글부터 준다.
 *  7. **메뉴**(2026-09-13) — 적기·고치기가 menu_key 를 저장하고 감사에 이전·새
 *     메뉴를 남긴다. 메뉴는 필수이고 전체 메뉴 목록으로 검증하며, 본문 오류와 함께
 *     돌려준다. 메뉴 없이 적힌 옛 글은 목록이 null 로 싣고, 고칠 때 메뉴를 골라야 한다.
 *
 * 역할 · 관리자 설정은 여기서 시험하지 않는다. mutation 은 관리 권한을
 * `canManage` 인자로 받으므로(mutations 파일 헤더) 그 값을 직접 넘긴다. 그래서
 * 계정의 역할은 상관이 없다 — 실재하는 계정 둘이면 된다(FK RESTRICT).
 *
 * ── 격리 규약 ────────────────────────────────────────────────────────────
 * 이 스위트가 만드는 글은 본문이 언제나 "IR-TEST-" 로 시작하고, 만든 id 는
 * touchedIds 에 모인다. after() 는 **그 글들과, 그 글들을 가리키는 감사 로그만**
 * 지운다(target_entity = "improvement_requests" AND target_record_id ∈ 이 id 들 —
 * repair-cases-restore.integration.test.ts 등과 같은 방식). 계정은 기존 계정을
 * 빌려 쓰므로 actor 로 지우지 않는다 — 그러면 남의 감사 로그까지 지워진다.
 * 본문 접두사로 한 번 더 쓸어 담는 것은 이전 실행이 중간에 끊겨 남은 글까지
 * 치우기 위해서다.
 * ============================================================================
 */

const BODY_PREFIX = "IR-TEST-";
const TARGET_ENTITY = "improvement_requests";
/** 이 스위트가 적는 글의 기본 메뉴와, 고치기에서 바꿔 볼 다른 메뉴(둘 다 navItems 의 key). */
const MENU_KEY = "repairCases";
const OTHER_MENU_KEY = "customers";

let authorId: string;
let otherUserId: string;
const touchedIds = new Set<string>();

function testBody(label: string): string {
  return `${BODY_PREFIX}${label}`;
}

function expectOk(result: ImprovementRequestMutationResult, label: string): { id: string; version: number } {
  assert.equal(result.ok, true, `${label}: ${JSON.stringify(result)}`);
  if (!result.ok) throw new Error(label);
  return { id: result.id, version: result.version };
}

function expectFailure(result: ImprovementRequestMutationResult, code: string): void {
  assert.equal(result.ok, false, `실패해야 하는데 성공했다: ${JSON.stringify(result)}`);
  if (result.ok) return;
  assert.equal(result.code, code);
}

async function createAs(actorUserId: string, label: string): Promise<{ id: string; version: number }> {
  const created = expectOk(
    await createImprovementRequest({ body: testBody(label), menuKey: MENU_KEY, actorUserId }),
    "setup create"
  );
  touchedIds.add(created.id);
  return created;
}

/** 관리 권한으로 상태를 옮긴다. 성공해야 하는 준비 단계에서만 쓴다. */
async function moveTo(
  target: { id: string; version: number },
  to: ImprovementRequestStatus,
  actorUserId: string
): Promise<{ id: string; version: number }> {
  return expectOk(
    await changeImprovementRequestStatus({
      id: target.id,
      expectedVersion: target.version,
      to,
      actorUserId,
      canManage: true,
    }),
    `move to ${to}`
  );
}

async function readRow(id: string) {
  const [row] = await db.select().from(improvementRequests).where(eq(improvementRequests.id, id));
  return row;
}

async function readAudits(id: string) {
  return db
    .select({
      actionType: auditLogs.actionType,
      actorUserId: auditLogs.actorUserId,
      previousValue: auditLogs.previousValue,
      newValue: auditLogs.newValue,
    })
    .from(auditLogs)
    .where(and(eq(auditLogs.targetEntity, TARGET_ENTITY), eq(auditLogs.targetRecordId, id)))
    .orderBy(asc(auditLogs.createdAt));
}

/** CHECK 를 거치지 않는 길 — mutation 을 건너뛰고 표에 직접 넣는다. */
async function insertRaw(values: Partial<typeof improvementRequests.$inferInsert>): Promise<void> {
  await db
    .insert(improvementRequests)
    .values({ body: testBody("직접 넣은 행"), createdBy: authorId, ...values });
}

function findPgError(err: unknown): { code: string; constraint: string } | null {
  let current: unknown = err;
  for (let depth = 0; depth < 5 && typeof current === "object" && current !== null; depth += 1) {
    const candidate = current as { code?: unknown; constraint_name?: unknown; cause?: unknown };
    if (typeof candidate.code === "string") {
      return {
        code: candidate.code,
        constraint: typeof candidate.constraint_name === "string" ? candidate.constraint_name : "",
      };
    }
    current = candidate.cause;
  }
  return null;
}

/** 23514 로 거절되는가. 두 CHECK 에 함께 걸리는 행은 어느 쪽이 먼저 보고돼도 받는다. */
async function assertCheckViolation(
  run: () => Promise<unknown>,
  constraints: readonly string[]
): Promise<void> {
  await assert.rejects(
    async () => {
      await run();
    },
    (err: unknown) => {
      const pgError = findPgError(err);
      assert.ok(pgError, "PostgresError 를 찾지 못했다");
      assert.equal(pgError.code, "23514", `기대한 오류코드가 아니라 ${pgError.code} 다`);
      assert.ok(
        constraints.includes(pgError.constraint),
        `기대한 제약이 아니라 ${pgError.constraint} 에 걸렸다`
      );
      return true;
    }
  );
}

before(async () => {
  const [engineer] = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.role, "AS_ENGINEER"),
        eq(users.approvalStatus, "APPROVED"),
        eq(users.isDeleted, false)
      )
    )
    .limit(1);
  assert.ok(engineer, "expected at least one approved AS_ENGINEER in the test DB");
  authorId = engineer.id;

  // 「남의 글」과 「다른 사람이 상태를 옮겼다」를 보려면 계정이 둘 필요하다.
  const [superAdmin] = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.role, "SUPER_ADMIN"),
        eq(users.approvalStatus, "APPROVED"),
        eq(users.isDeleted, false)
      )
    )
    .limit(1);
  assert.ok(superAdmin, "expected an approved SUPER_ADMIN in the test DB");
  assert.notEqual(superAdmin.id, authorId, "두 계정은 서로 달라야 한다");
  otherUserId = superAdmin.id;
});

after(async () => {
  const leftovers = await db
    .select({ id: improvementRequests.id })
    .from(improvementRequests)
    .where(like(improvementRequests.body, `${BODY_PREFIX}%`));
  const ids = [...new Set([...touchedIds, ...leftovers.map((row) => row.id)])];
  if (ids.length > 0) {
    await db
      .delete(auditLogs)
      .where(and(eq(auditLogs.targetEntity, TARGET_ENTITY), inArray(auditLogs.targetRecordId, ids)));
    await db.delete(improvementRequests).where(inArray(improvementRequests.id, ids));
  }
  await pgClient.end({ timeout: 5 });
});

describe("createImprovementRequest", () => {
  test("새 글은 접수 · version 1 · 적은 사람으로 시작하고 CREATE 감사가 한 줄 남는다", async () => {
    const created = await createAs(authorId, "새 글");
    assert.equal(created.version, 1);

    const row = await readRow(created.id);
    assert.equal(row.body, testBody("새 글"));
    assert.equal(row.menuKey, MENU_KEY);
    assert.equal(row.status, "OPEN");
    assert.equal(row.inProgressBy, null);
    assert.equal(row.inProgressAt, null);
    assert.equal(row.resolvedBy, null);
    assert.equal(row.resolvedAt, null);
    assert.equal(row.createdBy, authorId);
    assert.equal(row.updatedBy, authorId);
    assert.equal(row.createdAt.getTime(), row.updatedAt.getTime(), "「지금」은 한 트랜잭션에 한 번이다");

    const audits = await readAudits(created.id);
    assert.deepEqual(
      audits.map((audit) => [audit.actionType, audit.actorUserId]),
      [["CREATE", authorId]]
    );
    assert.deepEqual(audits[0].newValue, { body: testBody("새 글"), menuKey: MENU_KEY, status: "OPEN" });
  });

  test("서버 액션을 거치지 않아도 앞뒤 공백을 걷고 줄바꿈을 LF 로 저장한다", async () => {
    const created = expectOk(
      await createImprovementRequest({
        body: `  ${testBody("첫 줄")}\r\n둘째 줄  `,
        menuKey: MENU_KEY,
        actorUserId: authorId,
      }),
      "create"
    );
    touchedIds.add(created.id);
    assert.equal((await readRow(created.id)).body, `${testBody("첫 줄")}\n둘째 줄`);
  });

  test("빈 본문은 DB 오류가 아니라 VALIDATION_ERROR다", async () => {
    const result = await createImprovementRequest({ body: "  \r\n ", menuKey: MENU_KEY, actorUserId: authorId });
    expectFailure(result, "VALIDATION_ERROR");
    if (!result.ok) assert.ok(result.fieldErrors?.body);
  });
});

describe("updateImprovementRequestBody", () => {
  test("작성자는 접수 상태인 자기 글을 고친다 — version · 고친 사람 · UPDATE 감사(이전·새 본문)", async () => {
    const created = await createAs(authorId, "고치기 전");

    const result = expectOk(
      await updateImprovementRequestBody({
        id: created.id,
        expectedVersion: created.version,
        body: testBody("고친 뒤"),
        menuKey: MENU_KEY,
        actorUserId: authorId,
      }),
      "update"
    );
    assert.equal(result.version, 2);

    const row = await readRow(created.id);
    assert.equal(row.body, testBody("고친 뒤"));
    assert.equal(row.version, 2);
    assert.equal(row.status, "OPEN");
    assert.equal(row.updatedBy, authorId);
    assert.equal(row.createdBy, authorId, "적은 사람은 고친다고 바뀌지 않는다");

    const audits = await readAudits(created.id);
    assert.deepEqual(
      audits.map((audit) => audit.actionType),
      ["CREATE", "UPDATE"]
    );
    assert.deepEqual(audits[1].previousValue, { body: testBody("고치기 전"), menuKey: MENU_KEY });
    assert.deepEqual(audits[1].newValue, { body: testBody("고친 뒤"), menuKey: MENU_KEY });
  });

  test("남의 글은 고칠 수 없다 — FORBIDDEN이고 글도 감사도 그대로다", async () => {
    const created = await createAs(authorId, "남의 글");

    const result = await updateImprovementRequestBody({
      id: created.id,
      expectedVersion: created.version,
      body: testBody("남이 고친 값"),
      menuKey: MENU_KEY,
      actorUserId: otherUserId,
    });
    expectFailure(result, "FORBIDDEN");

    const row = await readRow(created.id);
    assert.equal(row.body, testBody("남의 글"));
    assert.equal(row.version, 1);
    assert.deepEqual(
      (await readAudits(created.id)).map((audit) => audit.actionType),
      ["CREATE"]
    );
  });

  test("진행중이 된 글은 작성자도 고칠 수 없다", async () => {
    const created = await createAs(authorId, "맡겨진 글");
    const moved = await moveTo(created, "IN_PROGRESS", otherUserId);

    // 최신 version 으로 보냈다 — 막는 것은 version 이 아니라 상태다.
    const result = await updateImprovementRequestBody({
      id: created.id,
      expectedVersion: moved.version,
      body: testBody("발밑에서 바뀐 값"),
      menuKey: MENU_KEY,
      actorUserId: authorId,
    });
    expectFailure(result, "FORBIDDEN");

    const row = await readRow(created.id);
    assert.equal(row.body, testBody("맡겨진 글"));
    assert.equal(row.version, moved.version);
  });

  test("낡은 version 으로 온 수정은 CONFLICT이고 글은 그대로다", async () => {
    const created = await createAs(authorId, "처음");
    expectOk(
      await updateImprovementRequestBody({
        id: created.id,
        expectedVersion: created.version,
        body: testBody("먼저 저장된 값"),
        menuKey: MENU_KEY,
        actorUserId: authorId,
      }),
      "first update"
    );

    const second = await updateImprovementRequestBody({
      id: created.id,
      expectedVersion: created.version,
      body: testBody("덮으면 안 되는 값"),
      menuKey: MENU_KEY,
      actorUserId: authorId,
    });
    expectFailure(second, "CONFLICT");

    const row = await readRow(created.id);
    assert.equal(row.body, testBody("먼저 저장된 값"));
    assert.equal(row.version, 2, "충돌한 저장은 version 도 올리지 않는다");
  });

  test("작성자의 수정과 관리자의 상태 변경이 겹치면 정확히 하나만 성공한다", async () => {
    // schema 헤더의 'version 은 처음부터 둔다' — 이 경합이 그 이유다.
    const created = await createAs(authorId, "겹치는 글");

    const [edit, move] = await Promise.all([
      updateImprovementRequestBody({
        id: created.id,
        expectedVersion: created.version,
        body: testBody("작성자가 고친 값"),
        menuKey: MENU_KEY,
        actorUserId: authorId,
      }),
      changeImprovementRequestStatus({
        id: created.id,
        expectedVersion: created.version,
        to: "IN_PROGRESS",
        actorUserId: otherUserId,
        canManage: true,
      }),
    ]);

    assert.deepEqual([edit.ok, move.ok].sort(), [false, true], "둘 중 하나만 성공해야 한다");
    const loser = edit.ok ? move : edit;
    if (!loser.ok) assert.equal(loser.code, "CONFLICT");
    assert.equal((await readRow(created.id)).version, 2, "성공한 쪽 한 번만 version 이 오른다");
  });

  test("없는 id는 NOT_FOUND다", async () => {
    const result = await updateImprovementRequestBody({
      id: randomUUID(),
      expectedVersion: 1,
      body: testBody("없는 글"),
      menuKey: MENU_KEY,
      actorUserId: authorId,
    });
    expectFailure(result, "NOT_FOUND");
  });
});

describe("changeImprovementRequestStatus", () => {
  test("관리 권한 없이는 상태를 바꿀 수 없다 — FORBIDDEN이고 글도 감사도 그대로다", async () => {
    const created = await createAs(authorId, "권한 없는 변경");

    const result = await changeImprovementRequestStatus({
      id: created.id,
      expectedVersion: created.version,
      to: "IN_PROGRESS",
      actorUserId: authorId,
      canManage: false,
    });
    expectFailure(result, "FORBIDDEN");

    const row = await readRow(created.id);
    assert.equal(row.status, "OPEN");
    assert.equal(row.version, 1);
    assert.deepEqual(
      (await readAudits(created.id)).map((audit) => audit.actionType),
      ["CREATE"]
    );
  });

  test("접수 → 진행중 → 해결: 네 칸이 규칙대로 채워지고 DB CHECK 를 통과한다", async () => {
    const created = await createAs(authorId, "순서대로");

    const inProgress = await moveTo(created, "IN_PROGRESS", otherUserId);
    const afterInProgress = await readRow(created.id);
    assert.equal(afterInProgress.status, "IN_PROGRESS");
    assert.equal(afterInProgress.inProgressBy, otherUserId);
    assert.equal(
      afterInProgress.inProgressAt?.getTime(),
      afterInProgress.updatedAt.getTime(),
      "「지금」은 한 트랜잭션에 한 번이다"
    );
    assert.equal(afterInProgress.resolvedBy, null);
    assert.equal(afterInProgress.resolvedAt, null);
    assert.equal(afterInProgress.updatedBy, otherUserId);

    // 해결은 다른 사람이 해도 된다 — 진행중 쌍은 맡았던 사람 그대로 남는다.
    const resolved = await moveTo(inProgress, "RESOLVED", authorId);
    assert.equal(resolved.version, 3);
    const afterResolved = await readRow(created.id);
    assert.equal(afterResolved.status, "RESOLVED");
    assert.equal(afterResolved.inProgressBy, otherUserId);
    assert.equal(afterResolved.inProgressAt?.getTime(), afterInProgress.inProgressAt?.getTime());
    assert.equal(afterResolved.resolvedBy, authorId);
    assert.equal(afterResolved.resolvedAt?.getTime(), afterResolved.updatedAt.getTime());

    const audits = await readAudits(created.id);
    assert.deepEqual(
      audits.map((audit) => [audit.actionType, audit.previousValue, audit.newValue]),
      [
        ["CREATE", null, { body: testBody("순서대로"), menuKey: MENU_KEY, status: "OPEN" }],
        ["STATUS_CHANGE", { status: "OPEN" }, { status: "IN_PROGRESS" }],
        ["STATUS_CHANGE", { status: "IN_PROGRESS" }, { status: "RESOLVED" }],
      ]
    );
  });

  test("접수 → 해결: 진행중 쌍은 빈 채로 해결된다", async () => {
    const created = await createAs(authorId, "곧바로 해결");
    await moveTo(created, "RESOLVED", otherUserId);

    const row = await readRow(created.id);
    assert.equal(row.status, "RESOLVED");
    assert.equal(row.inProgressBy, null);
    assert.equal(row.inProgressAt, null);
    assert.equal(row.resolvedBy, otherUserId);
    assert.ok(row.resolvedAt);
  });

  test("해결 → 접수: 네 칸이 모두 비워진다", async () => {
    const created = await createAs(authorId, "되돌린 글");
    const inProgress = await moveTo(created, "IN_PROGRESS", otherUserId);
    const resolved = await moveTo(inProgress, "RESOLVED", otherUserId);
    const reopened = await moveTo(resolved, "OPEN", otherUserId);
    assert.equal(reopened.version, 4);

    const row = await readRow(created.id);
    assert.equal(row.status, "OPEN");
    assert.equal(row.inProgressBy, null);
    assert.equal(row.inProgressAt, null);
    assert.equal(row.resolvedBy, null);
    assert.equal(row.resolvedAt, null);
  });

  test("해결 → 진행중: 진행중 쌍은 지금 옮긴 사람으로 새로 적히고 해결 쌍은 비워진다", async () => {
    const created = await createAs(authorId, "다시 맡은 글");
    const inProgress = await moveTo(created, "IN_PROGRESS", otherUserId);
    const resolved = await moveTo(inProgress, "RESOLVED", otherUserId);
    await moveTo(resolved, "IN_PROGRESS", authorId);

    const row = await readRow(created.id);
    assert.equal(row.status, "IN_PROGRESS");
    assert.equal(row.inProgressBy, authorId, "진행중 쌍은 「지금 이 글을 맡은 사람」이다");
    assert.equal(row.inProgressAt?.getTime(), row.updatedAt.getTime());
    assert.equal(row.resolvedBy, null);
    assert.equal(row.resolvedAt, null);
  });

  test("같은 상태로의 변경은 저장도 감사도 없이 성공한다", async () => {
    const created = await createAs(authorId, "두 번 누른 진행중");
    const moved = await moveTo(created, "IN_PROGRESS", otherUserId);
    const rowBefore = await readRow(created.id);
    const auditCountBefore = (await readAudits(created.id)).length;

    const again = expectOk(
      await changeImprovementRequestStatus({
        id: created.id,
        expectedVersion: moved.version,
        to: "IN_PROGRESS",
        actorUserId: authorId,
        canManage: true,
      }),
      "same status"
    );
    assert.equal(again.version, moved.version, "version 이 오르지 않는다");

    const rowAfter = await readRow(created.id);
    assert.equal(rowAfter.version, rowBefore.version);
    assert.equal(rowAfter.inProgressBy, otherUserId, "다시 누른다고 맡은 사람이 바뀌지 않는다");
    assert.equal(rowAfter.updatedAt.getTime(), rowBefore.updatedAt.getTime());
    assert.equal(rowAfter.updatedBy, rowBefore.updatedBy);
    assert.equal((await readAudits(created.id)).length, auditCountBefore, "감사 로그가 늘지 않는다");
  });

  test("낡은 version 으로 온 상태 변경은 CONFLICT이고 상태는 그대로다", async () => {
    const created = await createAs(authorId, "낡은 화면의 상태 변경");
    await moveTo(created, "IN_PROGRESS", otherUserId);

    const result = await changeImprovementRequestStatus({
      id: created.id,
      expectedVersion: created.version,
      to: "RESOLVED",
      actorUserId: otherUserId,
      canManage: true,
    });
    expectFailure(result, "CONFLICT");

    const row = await readRow(created.id);
    assert.equal(row.status, "IN_PROGRESS");
    assert.equal(row.version, 2);
  });

  test("없는 id는 NOT_FOUND다", async () => {
    const result = await changeImprovementRequestStatus({
      id: randomUUID(),
      expectedVersion: 1,
      to: "RESOLVED",
      actorUserId: otherUserId,
      canManage: true,
    });
    expectFailure(result, "NOT_FOUND");
  });
});

describe("deleteImprovementRequest", () => {
  test("작성자는 접수 상태인 자기 글을 지운다 — 행이 사라지고 PURGE 감사에 지우기 직전 행이 남는다", async () => {
    const created = await createAs(authorId, "지울 글");
    const rowBefore = await readRow(created.id);

    const result = expectOk(
      await deleteImprovementRequest({
        id: created.id,
        expectedVersion: created.version,
        actorUserId: authorId,
        canManage: false,
      }),
      "delete"
    );
    assert.equal(result.version, 1);
    assert.equal(await readRow(created.id), undefined, "휴지통이 없다 — 행 자체가 사라진다");

    const audits = await readAudits(created.id);
    assert.deepEqual(
      audits.map((audit) => [audit.actionType, audit.actorUserId]),
      [
        ["CREATE", authorId],
        ["PURGE", authorId],
      ]
    );
    assert.deepEqual(audits[1].previousValue, {
      id: created.id,
      body: testBody("지울 글"),
      menuKey: MENU_KEY,
      status: "OPEN",
      inProgressBy: null,
      inProgressAt: null,
      resolvedBy: null,
      resolvedAt: null,
      createdBy: authorId,
      createdAt: rowBefore.createdAt.toISOString(),
      updatedBy: authorId,
      updatedAt: rowBefore.updatedAt.toISOString(),
      version: 1,
    });
    assert.equal(audits[1].newValue, null);
  });

  test("진행중인 자기 글은 관리 권한 없이 지울 수 없다 — FORBIDDEN이고 행은 남는다", async () => {
    const created = await createAs(authorId, "진행중인 내 글");
    const moved = await moveTo(created, "IN_PROGRESS", otherUserId);

    const result = await deleteImprovementRequest({
      id: created.id,
      expectedVersion: moved.version,
      actorUserId: authorId,
      canManage: false,
    });
    expectFailure(result, "FORBIDDEN");

    const row = await readRow(created.id);
    assert.ok(row, "거절된 삭제가 행을 지워서는 안 된다");
    assert.equal(row.status, "IN_PROGRESS");
    assert.ok(
      !(await readAudits(created.id)).some((audit) => audit.actionType === "PURGE"),
      "거절된 삭제는 PURGE 를 남기지 않는다"
    );
  });

  test("남의 접수 글은 관리 권한 없이 지울 수 없다", async () => {
    const created = await createAs(authorId, "남이 지우려는 글");

    const result = await deleteImprovementRequest({
      id: created.id,
      expectedVersion: created.version,
      actorUserId: otherUserId,
      canManage: false,
    });
    expectFailure(result, "FORBIDDEN");
    assert.ok(await readRow(created.id));
  });

  test("관리 권한이 있으면 남의 글도 상태와 상관없이 지운다", async () => {
    const created = await createAs(authorId, "관리자가 지우는 글");
    const moved = await moveTo(created, "IN_PROGRESS", otherUserId);

    expectOk(
      await deleteImprovementRequest({
        id: created.id,
        expectedVersion: moved.version,
        actorUserId: otherUserId,
        canManage: true,
      }),
      "manager delete"
    );
    assert.equal(await readRow(created.id), undefined);

    const purge = (await readAudits(created.id)).find((audit) => audit.actionType === "PURGE");
    assert.ok(purge, "PURGE 감사가 남아야 한다");
    assert.equal(purge.actorUserId, otherUserId);
    const snapshot = purge.previousValue as Record<string, unknown>;
    assert.equal(snapshot.status, "IN_PROGRESS");
    assert.equal(snapshot.inProgressBy, otherUserId);
    assert.equal(snapshot.createdBy, authorId);
  });

  test("낡은 version 으로 온 삭제는 CONFLICT이고 행은 남는다", async () => {
    const created = await createAs(authorId, "삭제 전 원문");
    expectOk(
      await updateImprovementRequestBody({
        id: created.id,
        expectedVersion: created.version,
        body: testBody("그 사이 고친 글"),
        menuKey: MENU_KEY,
        actorUserId: authorId,
      }),
      "update"
    );

    const result = await deleteImprovementRequest({
      id: created.id,
      expectedVersion: created.version,
      actorUserId: authorId,
      canManage: false,
    });
    expectFailure(result, "CONFLICT");

    const row = await readRow(created.id);
    assert.ok(row, "충돌한 삭제가 행을 지워서는 안 된다");
    assert.equal(row.body, testBody("그 사이 고친 글"));
  });
});

describe("감사 로그", () => {
  test("동작마다 종류가 하나씩 — CREATE · UPDATE · STATUS_CHANGE · PURGE 가 행위자와 함께 남는다", async () => {
    const created = await createAs(authorId, "한 바퀴");
    const edited = expectOk(
      await updateImprovementRequestBody({
        id: created.id,
        expectedVersion: created.version,
        body: testBody("한 바퀴 고침"),
        menuKey: MENU_KEY,
        actorUserId: authorId,
      }),
      "edit"
    );
    const moved = await moveTo(edited, "IN_PROGRESS", otherUserId);
    expectOk(
      await deleteImprovementRequest({
        id: created.id,
        expectedVersion: moved.version,
        actorUserId: otherUserId,
        canManage: true,
      }),
      "delete"
    );

    assert.deepEqual(
      (await readAudits(created.id)).map((audit) => [audit.actionType, audit.actorUserId]),
      [
        ["CREATE", authorId],
        ["UPDATE", authorId],
        ["STATUS_CHANGE", otherUserId],
        ["PURGE", otherUserId],
      ]
    );
  });
});

/**
 * ── CHECK 가 실제로 도는가 ──────────────────────────────────────────────
 * mutation 을 건너뛰고 표에 직접 넣는다. 도메인 함수를 거치지 않은 행이 들어올
 * 수 없다는 것 — 그것이 schema 헤더가 말하는 「마지막 방어선」이다. 들어가 버린
 * 행이 있어도 본문이 접두사로 시작하므로 after() 가 치운다.
 */
describe("DB CHECK — 상태와 칸이 같은 말인가", () => {
  const STATUS_COLUMNS = "improvement_requests_status_columns";

  test("진행중인데 진행중 쌍이 비어 있으면 거절한다", async () => {
    await assertCheckViolation(() => insertRaw({ status: "IN_PROGRESS" }), [STATUS_COLUMNS]);
  });

  test("접수인데 진행중 쌍이 적혀 있으면 거절한다", async () => {
    await assertCheckViolation(
      () => insertRaw({ status: "OPEN", inProgressBy: authorId, inProgressAt: new Date() }),
      [STATUS_COLUMNS]
    );
  });

  test("진행중인데 해결 쌍까지 적혀 있으면 거절한다", async () => {
    const now = new Date();
    await assertCheckViolation(
      () =>
        insertRaw({
          status: "IN_PROGRESS",
          inProgressBy: authorId,
          inProgressAt: now,
          resolvedBy: authorId,
          resolvedAt: now,
        }),
      [STATUS_COLUMNS]
    );
  });

  test("해결인데 해결 쌍이 비어 있으면 거절한다", async () => {
    await assertCheckViolation(() => insertRaw({ status: "RESOLVED" }), [STATUS_COLUMNS]);
  });

  test("진행중 쌍의 한쪽만 적힌 행은 거절한다", async () => {
    // 해결 쌍은 온전하므로 상태 CHECK 는 통과하고, 쌍 CHECK 하나에만 걸린다.
    await assertCheckViolation(
      () =>
        insertRaw({
          status: "RESOLVED",
          inProgressBy: authorId,
          resolvedBy: authorId,
          resolvedAt: new Date(),
        }),
      ["improvement_requests_in_progress_pair"]
    );
  });

  test("해결 쌍의 한쪽만 적힌 행은 거절한다", async () => {
    // 이 행은 상태 CHECK 에도 함께 걸린다 — 어느 쪽이 먼저 보고되든 받는다.
    await assertCheckViolation(
      () => insertRaw({ status: "RESOLVED", resolvedBy: authorId }),
      ["improvement_requests_resolved_pair", STATUS_COLUMNS]
    );
  });

  test("2000자를 넘는 본문은 거절한다", async () => {
    await assertCheckViolation(
      () => insertRaw({ body: testBody("가".repeat(2000)) }),
      ["improvement_requests_body_length"]
    );
  });
});

describe("listImprovementRequests", () => {
  test("최근 글부터, 세 사람의 이름과 ISO 시각을 함께 준다", async () => {
    const older = await createAs(authorId, "먼저 적은 글");
    // created_at 은 밀리초까지다 — 같은 밀리초에 적히면 순서가 id 로 갈린다.
    await new Promise((resolve) => setTimeout(resolve, 5));
    const newer = await createAs(authorId, "나중에 적은 글");
    const inProgress = await moveTo(newer, "IN_PROGRESS", otherUserId);
    await moveTo(inProgress, "RESOLVED", authorId);

    const nameRows = await db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(inArray(users.id, [authorId, otherUserId]));
    const names = new Map(nameRows.map((row) => [row.id, row.name]));

    const mine = (await listImprovementRequests()).filter(
      (item) => item.id === older.id || item.id === newer.id
    );
    assert.deepEqual(
      mine.map((item) => item.id),
      [newer.id, older.id],
      "최근 글이 먼저다"
    );

    const [resolved, open] = mine;
    assert.equal(resolved.status, "RESOLVED");
    assert.equal(resolved.body, testBody("나중에 적은 글"));
    assert.equal(resolved.createdByUserId, authorId);
    assert.equal(resolved.createdByName, names.get(authorId));
    assert.equal(resolved.inProgressByUserId, otherUserId);
    assert.equal(resolved.inProgressByName, names.get(otherUserId));
    assert.equal(resolved.resolvedByUserId, authorId);
    assert.equal(resolved.resolvedByName, names.get(authorId));
    assert.equal(resolved.version, 3);
    for (const iso of [resolved.createdAt, resolved.inProgressAt, resolved.resolvedAt, resolved.updatedAt]) {
      assert.equal(typeof iso, "string", "시각은 문자열로 넘긴다");
      assert.equal(new Date(iso as string).toISOString(), iso, "시각은 ISO 문자열이다");
    }

    assert.equal(open.status, "OPEN");
    assert.equal(open.createdByName, names.get(authorId));
    assert.equal(open.inProgressByUserId, null);
    assert.equal(open.inProgressByName, null);
    assert.equal(open.inProgressAt, null);
    assert.equal(open.resolvedByUserId, null);
    assert.equal(open.resolvedByName, null);
    assert.equal(open.resolvedAt, null);
    assert.equal(open.version, 1);
  });
});

describe("메뉴 — 어느 메뉴의 일인가", () => {
  /**
   * mutation 을 건너뛰고 menu_key 를 마음대로 넣는다 — 메뉴 칸이 생기기 전의 옛 글
   * (NULL)과 사이드바에서 빠진 메뉴의 옛 글(모르는 열쇠)을 만든다. 본문이 접두사로
   * 시작하고 id 를 touchedIds 에 넣으므로 after() 가 치운다.
   */
  async function insertLegacy(label: string, menuKey: string | null): Promise<{ id: string; version: number }> {
    const [inserted] = await db
      .insert(improvementRequests)
      .values({ body: testBody(label), menuKey, createdBy: authorId })
      .returning({ id: improvementRequests.id, version: improvementRequests.version });
    touchedIds.add(inserted.id);
    return inserted;
  }

  async function countRowsWithBody(label: string): Promise<number> {
    const rows = await db
      .select({ id: improvementRequests.id })
      .from(improvementRequests)
      .where(eq(improvementRequests.body, testBody(label)));
    return rows.length;
  }

  test("적을 때 고른 메뉴가 저장되고, 목록 조회가 그대로 싣고, CREATE 감사에 새 메뉴가 남는다", async () => {
    const created = expectOk(
      await createImprovementRequest({
        body: testBody("기타 메뉴 글"),
        menuKey: IMPROVEMENT_REQUEST_OTHER_MENU_KEY,
        actorUserId: authorId,
      }),
      "create"
    );
    touchedIds.add(created.id);

    assert.equal((await readRow(created.id)).menuKey, IMPROVEMENT_REQUEST_OTHER_MENU_KEY);
    const listed = (await listImprovementRequests()).find((item) => item.id === created.id);
    assert.ok(listed, "목록에 있어야 한다");
    assert.equal(listed.menuKey, IMPROVEMENT_REQUEST_OTHER_MENU_KEY);

    const audits = await readAudits(created.id);
    assert.deepEqual(
      audits.map((audit) => [audit.actionType, audit.previousValue, audit.newValue]),
      [["CREATE", null, { body: testBody("기타 메뉴 글"), menuKey: IMPROVEMENT_REQUEST_OTHER_MENU_KEY, status: "OPEN" }]]
    );
  });

  test("고치기에서 메뉴만 바꿔도 저장되고, UPDATE 감사에 이전·새 메뉴가 남는다", async () => {
    const created = await createAs(authorId, "메뉴를 바꿀 글");

    const result = expectOk(
      await updateImprovementRequestBody({
        id: created.id,
        expectedVersion: created.version,
        body: testBody("메뉴를 바꿀 글"),
        menuKey: OTHER_MENU_KEY,
        actorUserId: authorId,
      }),
      "update menu"
    );
    assert.equal(result.version, 2);

    const row = await readRow(created.id);
    assert.equal(row.menuKey, OTHER_MENU_KEY);
    assert.equal(row.body, testBody("메뉴를 바꿀 글"), "본문은 그대로다");
    assert.equal(row.updatedBy, authorId);
    assert.equal((await listImprovementRequests()).find((item) => item.id === created.id)?.menuKey, OTHER_MENU_KEY);

    const audits = await readAudits(created.id);
    assert.deepEqual(
      audits.map((audit) => [audit.actionType, audit.previousValue, audit.newValue]),
      [
        ["CREATE", null, { body: testBody("메뉴를 바꿀 글"), menuKey: MENU_KEY, status: "OPEN" }],
        [
          "UPDATE",
          { body: testBody("메뉴를 바꿀 글"), menuKey: MENU_KEY },
          { body: testBody("메뉴를 바꿀 글"), menuKey: OTHER_MENU_KEY },
        ],
      ]
    );
  });

  test("메뉴 없이 적힌 옛 글 — 목록은 null 로 싣고, 메뉴를 골라야 고쳐지며, 감사의 이전 메뉴는 null 이다", async () => {
    const legacy = await insertLegacy("메뉴 없는 옛 글", null);
    assert.equal((await listImprovementRequests()).find((item) => item.id === legacy.id)?.menuKey, null);

    const withoutMenu = await updateImprovementRequestBody({
      id: legacy.id,
      expectedVersion: legacy.version,
      body: testBody("메뉴 없는 옛 글"),
      menuKey: "",
      actorUserId: authorId,
    });
    expectFailure(withoutMenu, "VALIDATION_ERROR");
    if (!withoutMenu.ok) assert.ok(withoutMenu.fieldErrors?.menuKey, "메뉴 칸 오류여야 한다");
    const untouched = await readRow(legacy.id);
    assert.equal(untouched.menuKey, null);
    assert.equal(untouched.version, 1, "거절된 저장은 version 을 올리지 않는다");

    expectOk(
      await updateImprovementRequestBody({
        id: legacy.id,
        expectedVersion: legacy.version,
        body: testBody("메뉴 없는 옛 글"),
        menuKey: MENU_KEY,
        actorUserId: authorId,
      }),
      "update legacy"
    );
    assert.equal((await readRow(legacy.id)).menuKey, MENU_KEY);
    assert.deepEqual(
      (await readAudits(legacy.id)).map((audit) => [audit.actionType, audit.previousValue, audit.newValue]),
      [
        [
          "UPDATE",
          { body: testBody("메뉴 없는 옛 글"), menuKey: null },
          { body: testBody("메뉴 없는 옛 글"), menuKey: MENU_KEY },
        ],
      ]
    );
  });

  test("사이드바에서 빠진 옛 열쇠 — 목록은 그대로 싣고, 그 열쇠로는 다시 저장되지 않는다", async () => {
    const legacy = await insertLegacy("없어진 메뉴 글", "noSuchMenu");
    assert.equal((await listImprovementRequests()).find((item) => item.id === legacy.id)?.menuKey, "noSuchMenu");

    const result = await updateImprovementRequestBody({
      id: legacy.id,
      expectedVersion: legacy.version,
      body: testBody("없어진 메뉴 글 고침"),
      menuKey: "noSuchMenu",
      actorUserId: authorId,
    });
    expectFailure(result, "VALIDATION_ERROR");
    if (!result.ok) assert.ok(result.fieldErrors?.menuKey);
    const row = await readRow(legacy.id);
    assert.equal(row.body, testBody("없어진 메뉴 글"));
    assert.equal(row.menuKey, "noSuchMenu");
    assert.equal((await readAudits(legacy.id)).length, 0, "감사도 없다");
  });

  test("메뉴를 고르지 않았거나 고를 수 없는 값이면 VALIDATION_ERROR — 글도 감사도 생기지 않는다", async () => {
    for (const [label, menuKey] of [
      ["메뉴 빈 값", ""],
      ["모르는 메뉴", "noSuchMenu"],
      ["이름표를 보낸 메뉴", "전체 A/S 현황"],
      ["구획 열쇠를 보낸 메뉴", "asOperations"],
    ] as const) {
      const result = await createImprovementRequest({ body: testBody(label), menuKey, actorUserId: authorId });
      expectFailure(result, "VALIDATION_ERROR");
      if (!result.ok) {
        assert.ok(result.fieldErrors?.menuKey, `${label}: 메뉴 칸 오류여야 한다`);
        assert.equal(result.fieldErrors?.body, undefined, `${label}: 본문은 틀리지 않았다`);
      }
      assert.equal(await countRowsWithBody(label), 0, `${label}: 저장되면 안 된다`);
    }
  });

  test("본문과 메뉴가 둘 다 틀리면 두 칸의 오류를 한꺼번에 돌려준다 — 적기 · 고치기", async () => {
    const created = await createImprovementRequest({ body: "   ", menuKey: "", actorUserId: authorId });
    expectFailure(created, "VALIDATION_ERROR");
    if (!created.ok) assert.deepEqual(Object.keys(created.fieldErrors ?? {}).sort(), ["body", "menuKey"]);

    const target = await createAs(authorId, "둘 다 틀린 고치기");
    const updated = await updateImprovementRequestBody({
      id: target.id,
      expectedVersion: target.version,
      body: "",
      menuKey: "noSuchMenu",
      actorUserId: authorId,
    });
    expectFailure(updated, "VALIDATION_ERROR");
    if (!updated.ok) assert.deepEqual(Object.keys(updated.fieldErrors ?? {}).sort(), ["body", "menuKey"]);

    const row = await readRow(target.id);
    assert.equal(row.body, testBody("둘 다 틀린 고치기"));
    assert.equal(row.menuKey, MENU_KEY);
    assert.equal(row.version, 1);
  });

  test("검증은 전체 메뉴 목록으로 한다 — 개발자 모드 열쇠도 저장된다(보는 사람의 사이드바로 좁히지 않는다)", async () => {
    // authorId 는 개발자가 아닌 A/S 엔지니어다. 화면은 그에게 개발자 모드를 내놓지
    // 않지만, 저장은 권한이 바뀐 사람의 옛 글이 막히지 않도록 전체 목록으로 본다.
    const created = expectOk(
      await createImprovementRequest({
        body: testBody("개발자 모드 메뉴 글"),
        menuKey: DEVELOPER_MODE_NAV_KEY,
        actorUserId: authorId,
      }),
      "create"
    );
    touchedIds.add(created.id);
    assert.equal((await readRow(created.id)).menuKey, DEVELOPER_MODE_NAV_KEY);
  });

  test("지우기의 PURGE 감사에 메뉴도 남는다 — 지운 뒤에는 그 줄만 안다", async () => {
    const created = await createAs(authorId, "메뉴와 함께 지울 글");
    expectOk(
      await deleteImprovementRequest({
        id: created.id,
        expectedVersion: created.version,
        actorUserId: otherUserId,
        canManage: true,
      }),
      "delete"
    );
    const purge = (await readAudits(created.id)).find((audit) => audit.actionType === "PURGE");
    assert.ok(purge, "PURGE 감사가 남아야 한다");
    assert.equal((purge.previousValue as Record<string, unknown>).menuKey, MENU_KEY);
  });
});
