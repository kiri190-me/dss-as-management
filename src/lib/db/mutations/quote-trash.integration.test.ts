import "../../../../scripts/load-env";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, like } from "drizzle-orm";

import { db, pgClient } from "../connection";
import {
  auditLogs,
  customers,
  domesticOrders,
  parts,
  quoteItems,
  quoteRepairTasks,
  quoteWorkScopeLines,
  quotes,
  users,
} from "../schema";
import { createQuote } from "./quotes";
import { permanentlyDeleteQuote, restoreQuote, softDeleteQuote } from "./quote-trash";
import { createDomesticOrder } from "./domestic-orders";
import { listPurgeEligibleQuoteIds, purgeExpiredQuote, runMasterDataPurgeSweep } from "./master-data-purge";
import { listDeletedQuotes } from "../queries/quotes";
import { listDomesticOrders } from "../queries/domestic-orders";
import {
  MASTER_DATA_TRASH_RETENTION_DAYS,
  getMasterDataTrashRetentionStatus,
} from "@/lib/domain/master-data-trash-retention";
import type { QuoteFields } from "@/lib/validation/quote-input";
import type { DomesticOrderFields } from "@/lib/validation/domestic-order-input";

/**
 * ============================================================================
 * 견적서 휴지통 — 완전 삭제와 15일 정리, 실제 DB 통합 시험 (2026-09-11)
 * ============================================================================
 * 견적서도 다른 휴지통과 같은 루틴이 됐다(사용자 결정 2026-09-11 — 그 전에는
 * 보내기·되살리기만 있었다). 지키는 것:
 *  1. 완전 삭제는 **휴지통의 장만** — 활성 장은 NOT_FOUND 로 그대로 남는다.
 *  2. 지우면 부품 줄 · 작업 내역 · 고른 수리 작업이 함께 사라지고(FK CASCADE),
 *     그 장을 연결해 둔 내자 정리 줄은 **남고 연결만 풀린다**(SET NULL).
 *  3. 내자 정리 목록에 보이는 값(견적서번호·견적발행일·금액)은 견적서가 휴지통에
 *     있을 때와 완전히 지워진 뒤가 같다 — 둘 다 손으로 적은 값이다.
 *  4. 발행번호 규칙은 흔들리지 않는다 — 휴지통의 장이 풀어 둔 번호를 이미 쓰는
 *     활성 장은 그 장이 완전히 지워져도 그대로다.
 *  5. 낡은 version 이면 CONFLICT, 이미 지운 장이면 NOT_FOUND — 행은 그대로다.
 *     되살리기와 완전 삭제가 같은 순간에 오면 한 쪽만 이긴다.
 *  6. 감사 로그 PURGE — 번호·발행일·금액 사실과 딸린 것의 개수는 남고, 자유 입력
 *     칸(품명·신고증상·유효기간·납기·결재조건·고객사 이름 글자·부품명·작업 내역·
 *     수리 작업명)은 어느 로그에도 닿지 않는다.
 *  7. 15일 정리: 기한 전·복원된 것은 건너뛰고 기한이 지난 것만 지운다. 만료 판정은
 *     화면 배지와 같은 함수다. 회차 안에서 견적서가 고객사·부품보다 먼저 돌아,
 *     셋이 함께 만료됐으면 한 회차에 함께 정리된다(RESTRICT 순서).
 *
 * 인가(누가 지울 수 있는가)는 여기서 보지 않는다 — 서버 액션의 몫이다.
 *
 * ── 격리 규약 ────────────────────────────────────────────────────────────
 * 이 파일이 만드는 행은 전부 실행마다 다른 토큰을 단다:
 *   견적서 발행번호 `QUOTE-TRASH-TEST-{토큰}-` · 내자 발주서번호
 *   `QT-TRASH-TEST-{토큰}-` · 고객사 이름 `AS-TEST-QUOTE-TRASH-{토큰}-` ·
 *   부품 품명 `QUOTE-TRASH-TEST-PART-{토큰}-`.
 * 감사 로그는 (엔티티, 대상 id) 쌍으로만 지운다(HANDOFF N절 — 3년 보존 대상이다).
 * 15일을 기다릴 수 없으므로 deleted_at 을 직접 과거로 돌린다 — 이 파일이 만든
 * 행에만 한다(domestic-orders-trash.integration.test.ts 와 같은 방식).
 * ============================================================================
 */

const RUN_TOKEN = randomUUID();
const QUOTE_NUMBER_PREFIX = `QUOTE-TRASH-TEST-${RUN_TOKEN}-`;
const PO_PREFIX = `QT-TRASH-TEST-${RUN_TOKEN}-`;
const CUSTOMER_NAME_PREFIX = `AS-TEST-QUOTE-TRASH-${RUN_TOKEN}-`;
const PART_NAME_PREFIX = `QUOTE-TRASH-TEST-PART-${RUN_TOKEN}-`;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** 자유 입력 칸에 넣는 표지. 감사 로그 어디에도 이 글자가 나오면 안 된다. */
const PII_MARKER = "노출되면-안-되는-담당자-홍길동";

let actorUserId: string;
/** 감사 로그 정리 범위 — 이 파일이 만든 행의 id 만 담는다. */
const touchedQuoteIds: string[] = [];
const touchedCustomerIds: string[] = [];
const touchedPartIds: string[] = [];

function quoteFields(suffix: string, overrides: Partial<QuoteFields> = {}): QuoteFields {
  return {
    quoteNumber: `${QUOTE_NUMBER_PREFIX}${suffix}`,
    kind: "DOMESTIC",
    quoteDate: "2096-03-10",
    repairCaseId: null,
    intakeNumberText: `D9603-${suffix}`,
    customerId: null,
    customerNameText: `고객사 ${PII_MARKER}`,
    modelNameText: "CFK300FH-IC2",
    lotNumberText: "WU8042",
    serialNumberText: "1612027",
    faultDescriptionText: `신고증상 ${PII_MARKER}`,
    subject: `품명 ${PII_MARKER}`,
    validity: `유효기간 ${PII_MARKER}`,
    delivery: `납기 ${PII_MARKER}`,
    payment: `결재조건 ${PII_MARKER}`,
    workCost: "1200000.00",
    laborEquipmentKind: null,
    laborBaseCost: null,
    powerTestExcluded: false,
    laborPowerTestDeduction: null,
    repairTasks: [],
    workScopeLines: [],
    items: [],
    ...overrides,
  };
}

/** 딸린 것 셋을 모두 가진 한 장. 글자 칸마다 PII 표지를 넣는다. */
function fullQuoteFields(suffix: string, overrides: Partial<QuoteFields> = {}): QuoteFields {
  return quoteFields(suffix, {
    items: [
      { partId: null, isOverhaulPart: false, partNameText: `부품 ${PII_MARKER}`, quantity: 2, unitPrice: "45000.00" },
      { partId: null, isOverhaulPart: false, partNameText: "냉각 팬", quantity: 1, unitPrice: "10000.00" },
    ],
    workScopeLines: [
      { section: "INVESTIGATION", text: `조사 ${PII_MARKER}` },
      { section: "POWER_TEST", text: "정격 출력 시험" },
      { section: "POWER_TEST", text: "에이징시험" },
    ],
    repairTasks: [{ taskId: null, taskName: `수리 ${PII_MARKER}`, hours: 3, hourlyRate: "100000.00" }],
    ...overrides,
  });
}

async function createTestQuote(fields: QuoteFields) {
  const result = await createQuote({ fields, actorUserId });
  assert.equal(result.ok, true, `setup create quote failed: ${JSON.stringify(result)}`);
  if (!result.ok) throw new Error("unreachable");
  touchedQuoteIds.push(result.id);
  return result;
}

async function readQuote(id: string) {
  const [row] = await db.select().from(quotes).where(eq(quotes.id, id));
  return row;
}

async function countChildren(quoteId: string) {
  const items = await db.select({ id: quoteItems.id }).from(quoteItems).where(eq(quoteItems.quoteId, quoteId));
  const scope = await db
    .select({ id: quoteWorkScopeLines.id })
    .from(quoteWorkScopeLines)
    .where(eq(quoteWorkScopeLines.quoteId, quoteId));
  const tasks = await db
    .select({ id: quoteRepairTasks.id })
    .from(quoteRepairTasks)
    .where(eq(quoteRepairTasks.quoteId, quoteId));
  return { items: items.length, scope: scope.length, tasks: tasks.length };
}

async function readAudit(entity: string, id: string, actionType: "SOFT_DELETE" | "RESTORE" | "PURGE") {
  return db
    .select()
    .from(auditLogs)
    .where(
      and(eq(auditLogs.targetEntity, entity), eq(auditLogs.targetRecordId, id), eq(auditLogs.actionType, actionType))
    );
}

function assertNoPii(log: { previousValue: unknown; newValue: unknown }) {
  const serialized = JSON.stringify({ previous: log.previousValue, next: log.newValue });
  assert.ok(!serialized.includes(PII_MARKER), `감사 로그에 자유 입력 칸이 들어갔다: ${serialized}`);
}

/** 휴지통으로 보내고, 보낸 뒤의 version 을 돌려준다. */
async function trash(id: string, reason: string | null = null): Promise<number> {
  const before = await readQuote(id);
  const result = await softDeleteQuote({ quoteId: id, expectedVersion: before.version, actorUserId, reason });
  assert.equal(result.ok, true, `soft delete failed: ${JSON.stringify(result)}`);
  return (await readQuote(id)).version;
}

/** deleted_at 을 N일 과거로 돌린다 — 15일을 실제로 기다리는 대신. */
async function backdateDeletion(id: string, days: number): Promise<Date> {
  const past = new Date(Date.now() - days * MS_PER_DAY);
  await db.update(quotes).set({ deletedAt: past }).where(eq(quotes.id, id));
  return past;
}

function domesticFields(suffix: string, overrides: Partial<DomesticOrderFields> = {}): DomesticOrderFields {
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
    purchaseOrderNumber: `${PO_PREFIX}${suffix}`,
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

async function createLinkedDomesticOrder(suffix: string, quoteId: string, overrides: Partial<DomesticOrderFields> = {}) {
  const result = await createDomesticOrder({
    fields: domesticFields(suffix, { quoteId, ...overrides }),
    actorUserId,
  });
  assert.equal(result.ok, true, `setup create domestic order failed: ${JSON.stringify(result)}`);
  if (!result.ok) throw new Error("unreachable");
  return result;
}

async function readDomesticOrder(id: string) {
  const [row] = await db.select().from(domesticOrders).where(eq(domesticOrders.id, id));
  return row;
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
  if (touchedQuoteIds.length > 0) {
    await db
      .delete(auditLogs)
      .where(and(eq(auditLogs.targetEntity, "quotes"), inArray(auditLogs.targetRecordId, touchedQuoteIds)));
  }
  if (touchedCustomerIds.length > 0) {
    await db
      .delete(auditLogs)
      .where(and(eq(auditLogs.targetEntity, "customers"), inArray(auditLogs.targetRecordId, touchedCustomerIds)));
  }
  if (touchedPartIds.length > 0) {
    await db
      .delete(auditLogs)
      .where(and(eq(auditLogs.targetEntity, "parts"), inArray(auditLogs.targetRecordId, touchedPartIds)));
  }
  // FK 순서: 내자 줄 → 견적서(부품 줄 등은 CASCADE) → 부품 → 고객사. 견적서가
  // 고객사와 부품을 RESTRICT 로 가리킨다.
  await db.delete(domesticOrders).where(like(domesticOrders.purchaseOrderNumber, `${PO_PREFIX}%`));
  await db.delete(quotes).where(like(quotes.quoteNumber, `${QUOTE_NUMBER_PREFIX}%`));
  await db.delete(parts).where(like(parts.partName, `${PART_NAME_PREFIX}%`));
  await db.delete(customers).where(like(customers.name, `${CUSTOMER_NAME_PREFIX}%`));
  await pgClient.end({ timeout: 5 });
});

describe("permanentlyDeleteQuote", () => {
  test("휴지통의 장이 사라지고 부품 줄 · 작업 내역 · 수리 작업도 함께 사라진다 — 내자 줄은 남고 연결만 풀린다", async () => {
    const created = await createTestQuote(fullQuoteFields("PURGE-MANUAL"));
    assert.deepEqual(await countChildren(created.id), { items: 2, scope: 3, tasks: 1 }, "setup: 딸린 것 셋");
    const order = await createLinkedDomesticOrder("PURGE-MANUAL", created.id);
    const orderBefore = await readDomesticOrder(order.id);
    assert.equal(orderBefore.quoteId, created.id, "setup: 내자 줄이 견적서를 가리켜야 한다");

    const version = await trash(created.id, "먼저 휴지통");
    const result = await permanentlyDeleteQuote({
      quoteId: created.id,
      expectedVersion: version,
      actorUserId,
      reason: "시험 완전 삭제",
    });
    assert.equal(result.ok, true, JSON.stringify(result));

    assert.equal(await readQuote(created.id), undefined, "견적서가 남아 있다");
    assert.deepEqual(await countChildren(created.id), { items: 0, scope: 0, tasks: 0 }, "딸린 줄이 남아 있다");

    const orderAfter = await readDomesticOrder(order.id);
    assert.ok(orderAfter, "내자 정리 줄이 함께 지워졌다 — SET NULL 이어야 한다");
    assert.equal(orderAfter.quoteId, null, "내자 정리 줄의 연결이 풀리지 않았다");
    assert.equal(orderAfter.isDeleted, false);

    assert.equal((await listDeletedQuotes()).some((row) => row.id === created.id), false, "휴지통 목록에 남아 있다");
  });

  test("감사 로그 PURGE — 번호·금액·딸린 것의 개수는 남고, 자유 입력 칸은 남지 않는다", async () => {
    const created = await createTestQuote(fullQuoteFields("PURGE-AUDIT"));
    const order = await createLinkedDomesticOrder("PURGE-AUDIT", created.id);
    const version = await trash(created.id, "휴지통 사유");
    const result = await permanentlyDeleteQuote({
      quoteId: created.id,
      expectedVersion: version,
      actorUserId,
      reason: "완전 삭제 사유",
    });
    assert.equal(result.ok, true, JSON.stringify(result));

    const logs = await readAudit("quotes", created.id, "PURGE");
    assert.equal(logs.length, 1);
    const [log] = logs;
    assert.equal(log.actorUserId, actorUserId, "사람이 지웠으면 행위자가 남아야 한다");
    assert.equal(log.newValue, null);
    assertNoPii(log);
    const previous = log.previousValue as Record<string, unknown>;
    assert.equal(previous.quoteNumber, `${QUOTE_NUMBER_PREFIX}PURGE-AUDIT`);
    assert.equal(previous.quoteDate, "2096-03-10");
    assert.equal(previous.kind, "DOMESTIC");
    assert.equal(previous.intakeNumberText, "D9603-PURGE-AUDIT");
    assert.equal(previous.workCost, "1200000.00");
    // 2 × 45,000 + 1 × 10,000 + 작업비 1,200,000 — 목록과 같은 셈법이다.
    assert.equal(previous.supplyAmount, "1300000.00");
    assert.equal(previous.purgedItemCount, 2);
    assert.equal(previous.purgedWorkScopeLineCount, 3);
    assert.equal(previous.purgedRepairTaskCount, 1);
    assert.deepEqual(previous.unlinkedDomesticOrderIds, [order.id]);
    assert.equal(previous.deleteReason, "휴지통 사유");
    assert.equal(previous.purgeReason, "완전 삭제 사유");
    assert.equal(typeof previous.deletedAt, "string");
    assert.equal(typeof previous.createdAt, "string");
    // 사람이 적는 글자 칸은 이름째로도 들어가지 않는다.
    for (const key of ["subject", "faultDescriptionText", "validity", "delivery", "payment", "customerNameText"]) {
      assert.equal(key in previous, false, `스냅숏에 ${key} 칸이 들어갔다`);
    }
  });

  test("🔴 활성 견적서는 완전 삭제할 수 없다 — NOT_FOUND, 장도 딸린 줄도 연결도 그대로다", async () => {
    const created = await createTestQuote(fullQuoteFields("PURGE-ACTIVE"));
    const order = await createLinkedDomesticOrder("PURGE-ACTIVE", created.id);
    const result = await permanentlyDeleteQuote({
      quoteId: created.id,
      expectedVersion: created.version,
      actorUserId,
      reason: "활성 장을 지우려는 시도",
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "NOT_FOUND");

    const row = await readQuote(created.id);
    assert.ok(row, "활성 견적서가 지워졌다");
    assert.equal(row.isDeleted, false);
    assert.equal(row.version, created.version);
    assert.deepEqual(await countChildren(created.id), { items: 2, scope: 3, tasks: 1 });
    assert.equal((await readDomesticOrder(order.id)).quoteId, created.id, "내자 줄의 연결이 풀렸다");
    assert.equal((await readAudit("quotes", created.id, "PURGE")).length, 0, "지우지 않았는데 PURGE 로그가 남았다");
  });

  test("낡은 version 이면 CONFLICT — 휴지통에 그대로 있다", async () => {
    const created = await createTestQuote(quoteFields("PURGE-STALE"));
    const version = await trash(created.id);
    const result = await permanentlyDeleteQuote({
      quoteId: created.id,
      expectedVersion: version - 1,
      actorUserId,
      reason: "낡은 화면",
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "CONFLICT");
    const row = await readQuote(created.id);
    assert.ok(row, "낡은 화면의 완전 삭제가 장을 지웠다");
    assert.equal(row.isDeleted, true);
    assert.equal((await readAudit("quotes", created.id, "PURGE")).length, 0);
  });

  test("이미 지운 장을 다시 지우면 NOT_FOUND, 없는 id 도 NOT_FOUND", async () => {
    const created = await createTestQuote(quoteFields("PURGE-TWICE"));
    const version = await trash(created.id);
    const first = await permanentlyDeleteQuote({ quoteId: created.id, expectedVersion: version, actorUserId, reason: "한 번" });
    assert.equal(first.ok, true, JSON.stringify(first));

    const again = await permanentlyDeleteQuote({ quoteId: created.id, expectedVersion: version, actorUserId, reason: "두 번" });
    assert.equal(again.ok, false);
    if (!again.ok) assert.equal(again.code, "NOT_FOUND");
    assert.equal((await readAudit("quotes", created.id, "PURGE")).length, 1, "PURGE 로그가 두 번 남았다");

    const missing = await permanentlyDeleteQuote({ quoteId: randomUUID(), expectedVersion: 1, actorUserId, reason: "없음" });
    assert.equal(missing.ok, false);
    if (!missing.ok) assert.equal(missing.code, "NOT_FOUND");
  });

  test("발행번호 규칙은 흔들리지 않는다 — 풀린 번호를 쓰는 활성 장은 옛 장이 완전히 지워져도 그대로다", async () => {
    const number = `${QUOTE_NUMBER_PREFIX}NUMBER`;
    const old = await createTestQuote(quoteFields("NUMBER-OLD", { quoteNumber: number }));
    const version = await trash(old.id);
    // 휴지통에 넣는 순간 번호가 풀려 있다(부분 unique 인덱스).
    const reused = await createTestQuote(quoteFields("NUMBER-NEW", { quoteNumber: number }));

    const result = await permanentlyDeleteQuote({ quoteId: old.id, expectedVersion: version, actorUserId, reason: "번호 확인" });
    assert.equal(result.ok, true, JSON.stringify(result));

    const survivor = await readQuote(reused.id);
    assert.ok(survivor, "같은 번호의 활성 장이 함께 지워졌다");
    assert.equal(survivor.quoteNumber, number);
    assert.equal(survivor.isDeleted, false);
  });
});

describe("내자 정리 목록에 보이는 값", () => {
  test("🔴 견적서가 휴지통에 있을 때와 완전히 지워진 뒤에 같은 값을 보여 준다 — 손으로 적은 값이다", async () => {
    const created = await createTestQuote(fullQuoteFields("DOMESTIC-VIEW", { quoteDate: "2096-03-11" }));
    const order = await createLinkedDomesticOrder("DOMESTIC-VIEW", created.id, {
      quoteNumber: "손으로 적은 견적서번호",
      quoteIssuedDate: "2096-01-05",
      amountExcludingVat: "777000.00",
    });
    const view = async () => {
      const item = (await listDomesticOrders()).find((row) => row.id === order.id);
      assert.ok(item, "내자 줄이 목록에 없다");
      return {
        quoteNumber: item.quoteNumber,
        quoteIssuedDate: item.quoteIssuedDate,
        amountExcludingVat: item.amountExcludingVat,
      };
    };

    // 활성일 때는 연결된 견적서가 이긴다.
    assert.deepEqual(await view(), {
      quoteNumber: `${QUOTE_NUMBER_PREFIX}DOMESTIC-VIEW`,
      quoteIssuedDate: "2096-03-11",
      amountExcludingVat: "1300000.00",
    });

    const version = await trash(created.id);
    const whileTrashed = await view();
    assert.deepEqual(whileTrashed, {
      quoteNumber: "손으로 적은 견적서번호",
      quoteIssuedDate: "2096-01-05",
      amountExcludingVat: "777000.00",
    });

    const result = await permanentlyDeleteQuote({ quoteId: created.id, expectedVersion: version, actorUserId, reason: "보이는 값" });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.deepEqual(await view(), whileTrashed, "완전 삭제 뒤 내자 정리 목록의 값이 달라졌다");
  });
});

describe("같은 순간의 경쟁", () => {
  test("되살리기와 완전 삭제가 동시에 오면 한 쪽만 성공하고, 진 쪽은 NOT_FOUND 다", async () => {
    const created = await createTestQuote(quoteFields("RACE"));
    const version = await trash(created.id);

    const [restored, purged] = await Promise.all([
      restoreQuote({ quoteId: created.id, expectedVersion: version, actorUserId }),
      permanentlyDeleteQuote({ quoteId: created.id, expectedVersion: version, actorUserId, reason: "경쟁" }),
    ]);

    const winners = [restored, purged].filter((result) => result.ok);
    assert.equal(winners.length, 1, `한 쪽만 이겨야 한다: ${JSON.stringify({ restored, purged })}`);
    const loser = restored.ok ? purged : restored;
    assert.equal(loser.ok, false);
    if (loser.ok) return;
    assert.equal(loser.code, "NOT_FOUND");

    const row = await readQuote(created.id);
    if (restored.ok) {
      assert.ok(row, "되살리기가 이겼는데 장이 없다");
      assert.equal(row.isDeleted, false);
      assert.equal((await readAudit("quotes", created.id, "PURGE")).length, 0);
    } else {
      assert.equal(row, undefined, "완전 삭제가 이겼는데 장이 남아 있다");
      assert.equal((await readAudit("quotes", created.id, "RESTORE")).length, 0);
    }
  });
});

describe("purgeExpiredQuote — 15일 정리", () => {
  test("15일이 지나지 않았으면 지우지 않고, 후보에도 없다", async () => {
    const created = await createTestQuote(quoteFields("SWEEP-YOUNG"));
    await trash(created.id);
    await backdateDeletion(created.id, MASTER_DATA_TRASH_RETENTION_DAYS - 1);

    assert.equal(await purgeExpiredQuote(created.id), "SKIPPED_NOT_ELIGIBLE");
    assert.ok(await readQuote(created.id));
    assert.equal((await listPurgeEligibleQuoteIds()).includes(created.id), false);
  });

  test("만료 판정은 화면 배지와 같은 함수다 — 경계 순간에 후보 목록과 배지가 같은 답을 한다", async () => {
    const created = await createTestQuote(quoteFields("SWEEP-BOUNDARY"));
    await trash(created.id);
    const deletedAt = await backdateDeletion(created.id, 3);

    const expiry = new Date(deletedAt.getTime() + MASTER_DATA_TRASH_RETENTION_DAYS * MS_PER_DAY);
    const justBefore = new Date(expiry.getTime() - 1000);

    for (const now of [justBefore, expiry]) {
      const badge = getMasterDataTrashRetentionStatus(deletedAt.toISOString(), now);
      const eligible = (await listPurgeEligibleQuoteIds(now)).includes(created.id);
      assert.equal(eligible, badge.isExpired, `now=${now.toISOString()} 에서 배지와 후보가 갈렸다`);
    }
    assert.equal(await purgeExpiredQuote(created.id, justBefore), "SKIPPED_NOT_ELIGIBLE");
  });

  test("15일이 지나면 장과 딸린 줄이 함께 사라지고, 내자 줄은 연결만 풀린다 — 감사 로그의 행위자는 비어 있다", async () => {
    const created = await createTestQuote(fullQuoteFields("SWEEP-EXPIRED"));
    const order = await createLinkedDomesticOrder("SWEEP-EXPIRED", created.id);
    await trash(created.id, "오래된 장");
    await backdateDeletion(created.id, MASTER_DATA_TRASH_RETENTION_DAYS + 1);

    assert.ok((await listPurgeEligibleQuoteIds()).includes(created.id), "만료된 장이 후보에 없다");
    assert.equal(await purgeExpiredQuote(created.id), "PURGED");
    assert.equal(await readQuote(created.id), undefined);
    assert.deepEqual(await countChildren(created.id), { items: 0, scope: 0, tasks: 0 });
    const orderAfter = await readDomesticOrder(order.id);
    assert.ok(orderAfter, "내자 줄이 함께 지워졌다");
    assert.equal(orderAfter.quoteId, null);

    const logs = await readAudit("quotes", created.id, "PURGE");
    assert.equal(logs.length, 1);
    assert.equal(logs[0].actorUserId, null, "자동 정리는 사람이 한 일이 아니다");
    assertNoPii(logs[0]);
    const previous = logs[0].previousValue as Record<string, unknown>;
    assert.equal(previous.quoteNumber, `${QUOTE_NUMBER_PREFIX}SWEEP-EXPIRED`);
    assert.equal(previous.supplyAmount, "1300000.00");
    assert.equal(previous.purgedItemCount, 2);
    assert.equal(previous.purgedWorkScopeLineCount, 3);
    assert.equal(previous.purgedRepairTaskCount, 1);
    assert.deepEqual(previous.unlinkedDomesticOrderIds, [order.id]);
    assert.equal(previous.deleteReason, "오래된 장");
  });

  test("복원된 뒤라면 만료 목록에 들어 있었더라도 지우지 않는다", async () => {
    const created = await createTestQuote(quoteFields("SWEEP-RESTORED"));
    const version = await trash(created.id);
    await backdateDeletion(created.id, MASTER_DATA_TRASH_RETENTION_DAYS + 1);
    assert.ok((await listPurgeEligibleQuoteIds()).includes(created.id));

    const restored = await restoreQuote({ quoteId: created.id, expectedVersion: version, actorUserId });
    assert.equal(restored.ok, true, JSON.stringify(restored));

    assert.equal(await purgeExpiredQuote(created.id), "SKIPPED_RESTORED");
    assert.ok(await readQuote(created.id), "복원된 장은 살아 있어야 한다");
  });

  test("이미 사라진 장은 오류가 아니라 건너뜀이다", async () => {
    assert.equal(await purgeExpiredQuote(randomUUID()), "SKIPPED_ALREADY_GONE");
  });

  test("정리 회차는 만료된 견적서만 지우고, 그 장이 붙잡던 고객사·부품도 같은 회차에 정리된다", async () => {
    const past = new Date(Date.now() - (MASTER_DATA_TRASH_RETENTION_DAYS + 2) * MS_PER_DAY);
    // 둘 다 휴지통에서 만료된 고객사와 부품. 만료된 견적서가 이 둘을 RESTRICT 로
    // 가리킨다 — 견적서가 먼저 지워져야 이 둘도 이번 회차에 지워진다.
    const [customer] = await db
      .insert(customers)
      .values({ name: `${CUSTOMER_NAME_PREFIX}SWEEP`, isDeleted: true, deletedAt: past, deletedBy: actorUserId })
      .returning({ id: customers.id });
    touchedCustomerIds.push(customer.id);
    const [part] = await db
      .insert(parts)
      .values({ partName: `${PART_NAME_PREFIX}SWEEP`, isDeleted: true, deletedAt: past, deletedBy: actorUserId })
      .returning({ id: parts.id });
    touchedPartIds.push(part.id);

    const expired = await createTestQuote(
      quoteFields("SWEEP-RUN-EXPIRED", {
        customerId: customer.id,
        items: [{ partId: part.id, isOverhaulPart: false, partNameText: "고른 부품", quantity: 1, unitPrice: "1000.00" }],
      })
    );
    const young = await createTestQuote(quoteFields("SWEEP-RUN-YOUNG"));
    await trash(expired.id);
    await trash(young.id);
    await backdateDeletion(expired.id, MASTER_DATA_TRASH_RETENTION_DAYS + 2);
    await backdateDeletion(young.id, 1);

    const summary = await runMasterDataPurgeSweep();
    assert.ok(summary.quotes.eligible >= 1);
    assert.ok(summary.quotes.purged >= 1);
    assert.equal(summary.quotes.errored, 0, JSON.stringify(summary.quotes.errors));
    // 이 표를 붙잡는 표는 CASCADE 이거나 SET NULL 이라 이 이유의 건너뜀은 나올 수 없다.
    assert.equal(summary.quotes.skippedReferenced, 0);

    assert.equal(await readQuote(expired.id), undefined, "만료된 장은 지워져야 한다");
    assert.ok(await readQuote(young.id), "아직 만료가 아닌 장은 남아 있어야 한다");

    const [customerAfter] = await db.select({ id: customers.id }).from(customers).where(eq(customers.id, customer.id));
    assert.equal(customerAfter, undefined, "견적서가 먼저 지워지지 않아 고객사가 FK 에 막혔다");
    const [partAfter] = await db.select({ id: parts.id }).from(parts).where(eq(parts.id, part.id));
    assert.equal(partAfter, undefined, "견적서가 먼저 지워지지 않아 부품이 FK 에 막혔다");
  });
});
