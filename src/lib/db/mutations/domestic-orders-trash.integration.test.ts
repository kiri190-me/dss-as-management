import "../../../../scripts/load-env";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, like } from "drizzle-orm";

import { db, pgClient } from "../connection";
import { auditLogs, domesticOrderDueDates, domesticOrders, users } from "../schema";
import { createDomesticOrder } from "./domestic-orders";
import {
  permanentlyDeleteDomesticOrder,
  restoreDomesticOrder,
  softDeleteDomesticOrder,
} from "./domestic-orders-trash";
import {
  listPurgeEligibleDomesticOrderIds,
  purgeExpiredDomesticOrder,
  runMasterDataPurgeSweep,
} from "./master-data-purge";
import { listDeletedDomesticOrders, listDomesticOrders } from "../queries/domestic-orders";
import {
  MASTER_DATA_TRASH_RETENTION_DAYS,
  getMasterDataTrashRetentionStatus,
} from "@/lib/domain/master-data-trash-retention";
import type { DomesticOrderFields } from "@/lib/validation/domestic-order-input";

/**
 * ============================================================================
 * 내자 정리 휴지통 — 실제 DB 통합 시험 (2026-09-11)
 * ============================================================================
 * 지키는 것:
 *  1. 휴지통으로 보내면 네 칸(is_deleted · deleted_at · deleted_by ·
 *     delete_reason)이 채워지고 목록에서 빠져 휴지통 목록에 선다.
 *  2. 되살리면 네 칸이 비고 목록에 돌아온다.
 *  3. 완전 삭제는 **휴지통의 줄만** — 활성 줄은 NOT_FOUND 로 그대로 남는다.
 *     지우면 납기요청일도 함께 사라진다(FK CASCADE).
 *  4. 이미 지운 줄을 다시 지우면 NOT_FOUND, 낡은 version 이면 CONFLICT — 둘 다
 *     행은 한 글자도 바뀌지 않는다.
 *  5. 두 사람이 같은 순간에 누르면 한 쪽만 성공하고, 진 쪽은 NOT_FOUND 다.
 *  6. 감사 로그 셋(SOFT_DELETE · RESTORE · PURGE)이 남고, 자유 입력 칸(현황·
 *     이력·기타·납품자·일본 송금·고장내역)은 어느 로그에도 닿지 않는다.
 *  7. 15일 정리: 기한 전은 건너뛰고, 복원된 것도 건너뛰고, 기한이 지난 것만
 *     지운다. 만료 판정은 화면 배지와 같은 함수다.
 *
 * 인가(누가 지울 수 있는가)는 여기서 보지 않는다 — 서버 액션의 몫이고,
 * 역할 정책은 domestic-order-authorization.test.ts 가 본다.
 *
 * ── 격리 규약 ────────────────────────────────────────────────────────────
 * 이 파일이 만드는 줄은 전부 발주서번호가 `DO-TRASH-TEST-{실행마다 다른 토큰}-`
 * 로 시작한다. 수리 건·고객사는 만들지 않는다 — 내자 줄은 둘 다 없이도 한 줄이
 * 된다(schema 의 '수리 건 연결은 비어 있어도 된다'). 감사 로그는 (엔티티, 대상
 * id) 쌍으로만 지운다(HANDOFF N절 — 3년 보존 대상이다).
 *
 * 15일을 기다릴 수 없으므로 deleted_at 을 직접 과거로 돌린다 — 이 파일이 만든
 * 줄에만 한다(customers-trash.integration.test.ts 와 같은 방식).
 * ============================================================================
 */

const RUN_TOKEN = randomUUID();
const PO_PREFIX = `DO-TRASH-TEST-${RUN_TOKEN}-`;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** 자유 입력 칸에 넣는 표지. 감사 로그 어디에도 이 글자가 나오면 안 된다. */
const PII_MARKER = "노출되면-안-되는-담당자-홍길동";

let actorUserId: string;
/** 감사 로그 정리 범위. 이 파일이 만든 줄의 id 만 담는다. */
const touchedOrderIds: string[] = [];

function fields(overrides: Partial<DomesticOrderFields> = {}): DomesticOrderFields {
  return {
    repairCaseId: null,
    quoteId: null,
    intakeNumberText: null,
    customerId: null,
    modelNameText: null,
    lotNumberText: null,
    serialNumberText: null,
    faultDescriptionText: null,
    displayOrder: null,
    purchaseOrderNumber: null,
    projectName: null,
    orderIssuedDate: null,
    dueDates: [],
    quoteIssuedDate: null,
    quoteNumber: null,
    progressNote: null,
    deliveredDate: null,
    deliveredBy: null,
    taxInvoiceDate: null,
    amountExcludingVat: null,
    paymentCompleted: false,
    japanRemittanceNote: null,
    historyNote: null,
    etcNote: null,
    ...overrides,
  };
}

/**
 * 한 줄을 만든다. 자유 입력 칸 여섯 모두에 PII 표지를 넣어 두어, 어느 감사
 * 로그로도 새지 않는지 볼 수 있게 한다.
 */
async function createOrder(suffix: string, overrides: Partial<DomesticOrderFields> = {}) {
  const result = await createDomesticOrder({
    fields: fields({
      purchaseOrderNumber: `${PO_PREFIX}${suffix}`,
      intakeNumberText: `손으로 적은 인수번호 ${suffix}`,
      progressNote: `현황 ${PII_MARKER}`,
      historyNote: `이력 ${PII_MARKER}`,
      etcNote: `기타 ${PII_MARKER}`,
      deliveredBy: PII_MARKER,
      japanRemittanceNote: `송금 ${PII_MARKER}`,
      faultDescriptionText: `고장 ${PII_MARKER}`,
      amountExcludingVat: "1234567.00",
      ...overrides,
    }),
    actorUserId,
  });
  assert.equal(result.ok, true, `setup create failed: ${JSON.stringify(result)}`);
  if (!result.ok) throw new Error("unreachable");
  touchedOrderIds.push(result.id);
  return result;
}

async function readOrder(id: string) {
  const [row] = await db.select().from(domesticOrders).where(eq(domesticOrders.id, id));
  return row;
}

async function readAudit(id: string, actionType: "SOFT_DELETE" | "RESTORE" | "PURGE") {
  return db
    .select()
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.targetEntity, "domestic_orders"),
        eq(auditLogs.targetRecordId, id),
        eq(auditLogs.actionType, actionType)
      )
    );
}

function assertNoPii(log: { previousValue: unknown; newValue: unknown }) {
  const serialized = JSON.stringify({ previous: log.previousValue, next: log.newValue });
  assert.ok(!serialized.includes(PII_MARKER), `감사 로그에 자유 입력 칸이 들어갔다: ${serialized}`);
}

/** 휴지통으로 보내고, 보낸 뒤의 version 을 돌려준다. */
async function trash(id: string, reason: string | null = null): Promise<number> {
  const before = await readOrder(id);
  const result = await softDeleteDomesticOrder({
    id,
    expectedVersion: before.version,
    actorUserId,
    reason,
  });
  assert.equal(result.ok, true, `soft delete failed: ${JSON.stringify(result)}`);
  return (await readOrder(id)).version;
}

/** deleted_at 을 N일 과거로 돌린다 — 15일을 실제로 기다리는 대신. */
async function backdateDeletion(id: string, days: number): Promise<Date> {
  const past = new Date(Date.now() - days * MS_PER_DAY);
  await db.update(domesticOrders).set({ deletedAt: past }).where(eq(domesticOrders.id, id));
  return past;
}

before(async () => {
  const [admin] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, "ADMIN"), eq(users.isDeleted, false)))
    .limit(1);
  const [anyone] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.approvalStatus, "APPROVED"), eq(users.isDeleted, false)))
    .limit(1);
  // 행위자는 created_by · deleted_by · 감사 로그의 actor 로만 쓰인다. 역할 판정은
  // 여기서 하지 않으므로 관리자가 없으면 승인된 아무 계정으로 대신한다.
  const actor = admin ?? anyone;
  assert.ok(actor, "expected at least one usable user in the test DB");
  actorUserId = actor.id;
});

after(async () => {
  // 감사 로그는 (엔티티, 대상 id) 쌍으로만 — 담긴 id 가 없으면 아예 지우지 않는다.
  if (touchedOrderIds.length > 0) {
    await db
      .delete(auditLogs)
      .where(
        and(eq(auditLogs.targetEntity, "domestic_orders"), inArray(auditLogs.targetRecordId, touchedOrderIds))
      );
  }
  // 이 파일이 만든 줄만. 납기요청일은 FK CASCADE 로 함께 지워진다.
  await db.delete(domesticOrders).where(like(domesticOrders.purchaseOrderNumber, `${PO_PREFIX}%`));
  await pgClient.end({ timeout: 5 });
});

describe("softDeleteDomesticOrder", () => {
  test("네 칸이 채워지고 version 이 오르며, 목록에서 빠져 휴지통에 선다", async () => {
    const created = await createOrder("SOFT");
    const result = await softDeleteDomesticOrder({
      id: created.id,
      expectedVersion: created.version,
      actorUserId,
      reason: "시험 삭제",
    });
    assert.equal(result.ok, true, JSON.stringify(result));

    const row = await readOrder(created.id);
    assert.equal(row.isDeleted, true);
    assert.ok(row.deletedAt, "deleted_at 이 비어 있다");
    assert.equal(row.deletedBy, actorUserId);
    assert.equal(row.deleteReason, "시험 삭제");
    assert.equal(row.version, created.version + 1, "version 이 오르지 않았다");

    const active = await listDomesticOrders();
    assert.equal(active.some((item) => item.id === created.id), false, "지운 줄이 목록에 남아 있다");

    const trashed = await listDeletedDomesticOrders();
    const item = trashed.find((candidate) => candidate.id === created.id);
    assert.ok(item, "휴지통 목록에 없다");
    assert.equal(item.version, row.version);
    assert.equal(item.purchaseOrderNumber, `${PO_PREFIX}SOFT`);
    assert.equal(item.displayIntakeNumber, "손으로 적은 인수번호 SOFT");
    assert.equal(item.deleteReason, "시험 삭제");
    assert.equal(item.deletedAt, row.deletedAt?.toISOString());
  });

  test("감사 로그 SOFT_DELETE — 사유는 남고 자유 입력 칸은 남지 않는다", async () => {
    const created = await createOrder("SOFT-AUDIT");
    await trash(created.id, "사유 한 줄");

    const logs = await readAudit(created.id, "SOFT_DELETE");
    assert.equal(logs.length, 1);
    const [log] = logs;
    assert.equal(log.actorUserId, actorUserId);
    assertNoPii(log);
    const previous = log.previousValue as { purchaseOrderNumber: string; isDeleted: boolean };
    assert.equal(previous.purchaseOrderNumber, `${PO_PREFIX}SOFT-AUDIT`);
    assert.equal(previous.isDeleted, false);
    const next = log.newValue as { isDeleted: boolean; deleteReason: string | null };
    assert.equal(next.isDeleted, true);
    assert.equal(next.deleteReason, "사유 한 줄");
  });

  test("이미 휴지통에 있는 줄을 다시 지우면 NOT_FOUND — 행은 그대로다", async () => {
    const created = await createOrder("SOFT-TWICE");
    const version = await trash(created.id, "처음 사유");
    const first = await readOrder(created.id);

    const again = await softDeleteDomesticOrder({
      id: created.id,
      expectedVersion: version,
      actorUserId,
      reason: "두 번째 사유",
    });
    assert.equal(again.ok, false);
    if (again.ok) return;
    assert.equal(again.code, "NOT_FOUND");

    const after = await readOrder(created.id);
    assert.equal(after.deleteReason, "처음 사유", "두 번째 삭제가 사유를 덮었다");
    assert.equal(after.deletedAt?.getTime(), first.deletedAt?.getTime(), "지운 시각이 바뀌었다");
    assert.equal(after.version, first.version);
  });

  test("낡은 version 이면 CONFLICT — 휴지통에 들어가지 않는다", async () => {
    const created = await createOrder("SOFT-STALE");
    const result = await softDeleteDomesticOrder({
      id: created.id,
      expectedVersion: created.version + 5,
      actorUserId,
      reason: null,
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "CONFLICT");
    assert.equal((await readOrder(created.id)).isDeleted, false);
  });

  test("없는 id 는 NOT_FOUND", async () => {
    const result = await softDeleteDomesticOrder({
      id: randomUUID(),
      expectedVersion: 1,
      actorUserId,
      reason: null,
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "NOT_FOUND");
  });
});

describe("restoreDomesticOrder", () => {
  test("네 칸이 비고 목록에 돌아온다 — 감사 로그 RESTORE", async () => {
    const created = await createOrder("RESTORE", {
      dueDates: [{ dueDate: "2096-03-01", note: "1차분" }],
    });
    const version = await trash(created.id, "되살릴 줄");

    const result = await restoreDomesticOrder({ id: created.id, expectedVersion: version, actorUserId });
    assert.equal(result.ok, true, JSON.stringify(result));

    const row = await readOrder(created.id);
    assert.equal(row.isDeleted, false);
    assert.equal(row.deletedAt, null);
    assert.equal(row.deletedBy, null);
    assert.equal(row.deleteReason, null);
    assert.equal(row.version, version + 1);

    const active = await listDomesticOrders();
    const item = active.find((candidate) => candidate.id === created.id);
    assert.ok(item, "되살린 줄이 목록에 없다");
    // 소프트 삭제는 행을 지우지 않으므로 납기요청일도 그대로 돌아온다.
    assert.deepEqual(
      item.dueDates.map((dueDate) => dueDate.dueDate),
      ["2096-03-01"]
    );

    const logs = await readAudit(created.id, "RESTORE");
    assert.equal(logs.length, 1);
    assert.equal(logs[0].actorUserId, actorUserId);
    assertNoPii(logs[0]);
    const previous = logs[0].previousValue as { isDeleted: boolean; deleteReason: string | null };
    assert.equal(previous.isDeleted, true);
    assert.equal(previous.deleteReason, "되살릴 줄");
  });

  test("휴지통에 없는 줄은 되살릴 수 없다 — NOT_FOUND", async () => {
    const created = await createOrder("RESTORE-ACTIVE");
    const result = await restoreDomesticOrder({
      id: created.id,
      expectedVersion: created.version,
      actorUserId,
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "NOT_FOUND");
  });

  test("낡은 version 이면 CONFLICT — 휴지통에 그대로 있다", async () => {
    const created = await createOrder("RESTORE-STALE");
    const version = await trash(created.id);
    const result = await restoreDomesticOrder({
      id: created.id,
      expectedVersion: version - 1,
      actorUserId,
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "CONFLICT");
    assert.equal((await readOrder(created.id)).isDeleted, true);
  });
});

describe("permanentlyDeleteDomesticOrder", () => {
  test("휴지통의 줄이 사라지고 납기요청일도 함께 사라진다 — 감사 로그 PURGE", async () => {
    const created = await createOrder("PURGE-MANUAL", {
      dueDates: [
        { dueDate: "2096-04-01", note: "1차분" },
        { dueDate: "2096-05-01", note: "2차분" },
      ],
    });
    const dueDatesBefore = await db
      .select({ id: domesticOrderDueDates.id })
      .from(domesticOrderDueDates)
      .where(eq(domesticOrderDueDates.domesticOrderId, created.id));
    assert.equal(dueDatesBefore.length, 2, "setup: 납기요청일이 두 건이어야 한다");

    const version = await trash(created.id, "먼저 휴지통");
    const result = await permanentlyDeleteDomesticOrder({
      id: created.id,
      expectedVersion: version,
      actorUserId,
      reason: "시험 완전 삭제",
    });
    assert.equal(result.ok, true, JSON.stringify(result));

    assert.equal(await readOrder(created.id), undefined, "줄이 남아 있다");
    const dueDatesAfter = await db
      .select({ id: domesticOrderDueDates.id })
      .from(domesticOrderDueDates)
      .where(eq(domesticOrderDueDates.domesticOrderId, created.id));
    assert.equal(dueDatesAfter.length, 0, "납기요청일이 남아 있다");

    const logs = await readAudit(created.id, "PURGE");
    assert.equal(logs.length, 1);
    const [log] = logs;
    assert.equal(log.actorUserId, actorUserId, "사람이 지웠으면 행위자가 남아야 한다");
    assert.equal(log.newValue, null);
    assertNoPii(log);
    const previous = log.previousValue as {
      purchaseOrderNumber: string;
      amountExcludingVat: string;
      deleteReason: string;
      purgeReason: string;
      purgedDueDateCount: number;
      deletedAt: string;
    };
    assert.equal(previous.purchaseOrderNumber, `${PO_PREFIX}PURGE-MANUAL`);
    // 정산 사실은 스냅숏에 남는다 — 줄은 사라져도 무엇을 지웠는지는 답할 수 있어야 한다.
    assert.equal(previous.amountExcludingVat, "1234567.00");
    assert.equal(previous.deleteReason, "먼저 휴지통");
    assert.equal(previous.purgeReason, "시험 완전 삭제");
    assert.equal(previous.purgedDueDateCount, 2);
    assert.equal(typeof previous.deletedAt, "string");
  });

  test("🔴 활성 줄은 완전 삭제할 수 없다 — NOT_FOUND, 줄도 납기요청일도 그대로다", async () => {
    const created = await createOrder("PURGE-ACTIVE", {
      dueDates: [{ dueDate: "2096-06-01", note: null }],
    });
    const result = await permanentlyDeleteDomesticOrder({
      id: created.id,
      expectedVersion: created.version,
      actorUserId,
      reason: "활성 줄을 지우려는 시도",
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "NOT_FOUND");

    const row = await readOrder(created.id);
    assert.ok(row, "활성 줄이 지워졌다");
    assert.equal(row.isDeleted, false);
    const dueDates = await db
      .select({ id: domesticOrderDueDates.id })
      .from(domesticOrderDueDates)
      .where(eq(domesticOrderDueDates.domesticOrderId, created.id));
    assert.equal(dueDates.length, 1);
    assert.equal((await readAudit(created.id, "PURGE")).length, 0, "지우지 않았는데 PURGE 로그가 남았다");
  });

  test("낡은 version 이면 CONFLICT — 휴지통에 그대로 있다", async () => {
    const created = await createOrder("PURGE-STALE");
    const version = await trash(created.id);
    const result = await permanentlyDeleteDomesticOrder({
      id: created.id,
      expectedVersion: version + 1,
      actorUserId,
      reason: "낡은 화면",
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "CONFLICT");
    assert.ok(await readOrder(created.id), "낡은 화면의 완전 삭제가 줄을 지웠다");
  });
});

describe("같은 순간의 경쟁", () => {
  test("복원과 완전 삭제가 동시에 오면 한 쪽만 성공하고, 진 쪽은 NOT_FOUND 다", async () => {
    const created = await createOrder("RACE-RESTORE-PURGE");
    const version = await trash(created.id);

    const [restored, purged] = await Promise.all([
      restoreDomesticOrder({ id: created.id, expectedVersion: version, actorUserId }),
      permanentlyDeleteDomesticOrder({ id: created.id, expectedVersion: version, actorUserId, reason: "경쟁" }),
    ]);

    const winners = [restored, purged].filter((result) => result.ok);
    assert.equal(winners.length, 1, `한 쪽만 이겨야 한다: ${JSON.stringify({ restored, purged })}`);
    const loser = restored.ok ? purged : restored;
    assert.equal(loser.ok, false);
    if (loser.ok) return;
    assert.equal(loser.code, "NOT_FOUND");

    const row = await readOrder(created.id);
    if (restored.ok) {
      assert.ok(row, "복원이 이겼는데 줄이 없다");
      assert.equal(row.isDeleted, false);
      assert.equal((await readAudit(created.id, "PURGE")).length, 0);
    } else {
      assert.equal(row, undefined, "완전 삭제가 이겼는데 줄이 남아 있다");
      assert.equal((await readAudit(created.id, "RESTORE")).length, 0);
    }
  });

  test("두 사람이 동시에 복원하면 한 번만 되살아나고 감사 로그도 하나다", async () => {
    const created = await createOrder("RACE-RESTORE-TWICE");
    const version = await trash(created.id);

    const results = await Promise.all([
      restoreDomesticOrder({ id: created.id, expectedVersion: version, actorUserId }),
      restoreDomesticOrder({ id: created.id, expectedVersion: version, actorUserId }),
    ]);
    assert.equal(results.filter((result) => result.ok).length, 1, JSON.stringify(results));
    const loser = results.find((result) => !result.ok);
    assert.ok(loser && !loser.ok);
    assert.equal(loser.code, "NOT_FOUND");
    assert.equal((await readAudit(created.id, "RESTORE")).length, 1);
    assert.equal((await readOrder(created.id)).version, version + 1, "두 번 되살아났다");
  });

  test("두 사람이 동시에 휴지통으로 보내면 한 번만 들어가고 감사 로그도 하나다", async () => {
    const created = await createOrder("RACE-SOFT-TWICE");
    const results = await Promise.all([
      softDeleteDomesticOrder({ id: created.id, expectedVersion: created.version, actorUserId, reason: "가" }),
      softDeleteDomesticOrder({ id: created.id, expectedVersion: created.version, actorUserId, reason: "나" }),
    ]);
    assert.equal(results.filter((result) => result.ok).length, 1, JSON.stringify(results));
    const loser = results.find((result) => !result.ok);
    assert.ok(loser && !loser.ok);
    assert.equal(loser.code, "NOT_FOUND");
    assert.equal((await readAudit(created.id, "SOFT_DELETE")).length, 1);
  });
});

describe("purgeExpiredDomesticOrder — 15일 정리", () => {
  test("15일이 지나지 않았으면 지우지 않고, 후보에도 없다", async () => {
    const created = await createOrder("SWEEP-YOUNG-1");
    await trash(created.id);
    await backdateDeletion(created.id, MASTER_DATA_TRASH_RETENTION_DAYS - 1);

    assert.equal(await purgeExpiredDomesticOrder(created.id), "SKIPPED_NOT_ELIGIBLE");
    assert.ok(await readOrder(created.id));
    assert.equal((await listPurgeEligibleDomesticOrderIds()).includes(created.id), false);
  });

  test("만료 판정은 화면 배지와 같은 함수다 — 경계 순간에 후보 목록과 배지가 같은 답을 한다", async () => {
    const created = await createOrder("SWEEP-BOUNDARY");
    await trash(created.id);
    const deletedAt = await backdateDeletion(created.id, 3);

    const expiry = new Date(deletedAt.getTime() + MASTER_DATA_TRASH_RETENTION_DAYS * MS_PER_DAY);
    const justBefore = new Date(expiry.getTime() - 1000);

    for (const now of [justBefore, expiry]) {
      const badge = getMasterDataTrashRetentionStatus(deletedAt.toISOString(), now);
      const eligible = (await listPurgeEligibleDomesticOrderIds(now)).includes(created.id);
      assert.equal(eligible, badge.isExpired, `now=${now.toISOString()} 에서 배지와 후보가 갈렸다`);
    }
    assert.equal(getMasterDataTrashRetentionStatus(deletedAt.toISOString(), expiry).isExpired, true);
    assert.equal(getMasterDataTrashRetentionStatus(deletedAt.toISOString(), justBefore).isExpired, false);
    assert.equal(await purgeExpiredDomesticOrder(created.id, justBefore), "SKIPPED_NOT_ELIGIBLE");
  });

  test("15일이 지나면 줄과 납기요청일이 함께 사라지고, 감사 로그의 행위자는 비어 있다", async () => {
    const created = await createOrder("SWEEP-EXPIRED-1", {
      dueDates: [{ dueDate: "2096-07-01", note: "만료" }],
    });
    await trash(created.id, "오래된 줄");
    await backdateDeletion(created.id, MASTER_DATA_TRASH_RETENTION_DAYS + 1);

    assert.ok((await listPurgeEligibleDomesticOrderIds()).includes(created.id), "만료된 줄이 후보에 없다");
    assert.equal(await purgeExpiredDomesticOrder(created.id), "PURGED");
    assert.equal(await readOrder(created.id), undefined);
    const dueDates = await db
      .select({ id: domesticOrderDueDates.id })
      .from(domesticOrderDueDates)
      .where(eq(domesticOrderDueDates.domesticOrderId, created.id));
    assert.equal(dueDates.length, 0);

    const logs = await readAudit(created.id, "PURGE");
    assert.equal(logs.length, 1);
    assert.equal(logs[0].actorUserId, null, "자동 정리는 사람이 한 일이 아니다");
    assertNoPii(logs[0]);
    const previous = logs[0].previousValue as { purgedDueDateCount: number; deleteReason: string };
    assert.equal(previous.purgedDueDateCount, 1);
    assert.equal(previous.deleteReason, "오래된 줄");
  });

  test("복원된 뒤라면 만료 목록에 들어 있었더라도 지우지 않는다", async () => {
    const created = await createOrder("SWEEP-RESTORED");
    await trash(created.id);
    await backdateDeletion(created.id, MASTER_DATA_TRASH_RETENTION_DAYS + 1);
    assert.ok((await listPurgeEligibleDomesticOrderIds()).includes(created.id));

    const trashed = await readOrder(created.id);
    const restored = await restoreDomesticOrder({
      id: created.id,
      expectedVersion: trashed.version,
      actorUserId,
    });
    assert.equal(restored.ok, true);

    assert.equal(await purgeExpiredDomesticOrder(created.id), "SKIPPED_RESTORED");
    assert.ok(await readOrder(created.id), "복원된 줄은 살아 있어야 한다");
  });

  test("이미 사라진 줄은 오류가 아니라 건너뜀이다", async () => {
    assert.equal(await purgeExpiredDomesticOrder(randomUUID()), "SKIPPED_ALREADY_GONE");
  });

  test("정리 회차는 만료된 내자 줄만 지우고 결과를 세어 돌려준다", async () => {
    const expired = await createOrder("SWEEP-RUN-EXPIRED");
    const young = await createOrder("SWEEP-RUN-YOUNG");
    await trash(expired.id);
    await trash(young.id);
    await backdateDeletion(expired.id, MASTER_DATA_TRASH_RETENTION_DAYS + 2);
    await backdateDeletion(young.id, 1);

    const summary = await runMasterDataPurgeSweep();
    assert.ok(summary.domesticOrders.eligible >= 1);
    assert.ok(summary.domesticOrders.purged >= 1);
    assert.equal(summary.domesticOrders.errored, 0, JSON.stringify(summary.domesticOrders.errors));
    // 이 표를 붙잡는 표가 없으므로 이 이유의 건너뜀은 나올 수 없다.
    assert.equal(summary.domesticOrders.skippedReferenced, 0);

    assert.equal(await readOrder(expired.id), undefined, "만료된 줄은 지워져야 한다");
    assert.ok(await readOrder(young.id), "아직 만료가 아닌 줄은 남아 있어야 한다");
  });
});
