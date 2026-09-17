import "../../../../scripts/load-env";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db, pgClient } from "../connection";
import {
  auditLogs,
  customers,
  inventoryPartRequests,
  parts,
  productModels,
  products,
  repairCaseIdempotencyKeys,
  repairCaseIntakeSequences,
  repairCaseUsedParts,
  repairCases,
  statusChangeHistories,
  users,
} from "../schema";
import { createRepairCaseWithIdempotency } from "@/lib/server/services/create-repair-case";
import type { IntakeSubmissionInput } from "@/lib/domain/local/submit-intake";
import { getRepairCaseUsedPartsView } from "../queries/repair-case-used-parts";
import { saveRepairCaseUsedParts } from "./repair-case-used-parts";

/**
 * ============================================================================
 * 「사용 부품」 저장 (B-2) — 격리된 시험 DB
 * ============================================================================
 * 못 박는 것:
 *  1. 🔴 반출 이력이 있으면 **서버가** 거절한다(화면이 감추는 것으로는 모자라다).
 *  2. 🔴 출하 잠금 + 「과거 인수품 가져오기」로 들어온 건 → 적을 수 있다.
 *  3. 🔴 출하 잠금 + 그 밖의 건 → 막힌다.
 *  4. 잠금이 없으면 평소대로 적을 수 있다.
 *  5. 수량이 0 이하면 거절한다(검사 층 밖에서 직접 불러도 DB CHECK 가 막는다).
 *  6. expectedVersion 이 다르면 거절한다 — 조용히 덮어쓰지 않는다.
 *  7. 감사 이력이 남는다(앞 목록 · 뒤 목록 둘 다).
 *  8. 고르면 part_id 가 붙고, 손으로 적으면 null 이다.
 *  9. 🔴 line_no 를 서버가 매긴다 — 화면이 보낸 값을 안 믿는다.
 *
 * ── 격리 ────────────────────────────────────────────────────────────────────
 * 인수 달 "9502" 하나만 쓴다(저장소 전체에서 쓰이지 않는 달임을 확인했다 —
 * 9501 은 user-deletion 이 쓴다). 고객사 · 모델 · 부품 이름은 전부
 * `AS-TEST-USEDPARTS-` 접두어 + 실행마다 다른 토큰이고, after 가 이 파일이 만든
 * 줄만 지운다. 실제 자료는 건드리지 않는다.
 * ============================================================================
 */

const RUN = randomUUID().slice(0, 8);
const PREFIX = `AS-TEST-USEDPARTS-${RUN}`;
const YEAR_MONTH = "9502";

let adminId: string;
let customerId: string;
let productModelId: string;
let partAId: string;
let partBId: string;

const createdCaseIds: string[] = [];
const createdProductIds: string[] = [];
const createdIdempotencyKeys: string[] = [];

/** 잠기지 않은, 반출 이력도 없는 평범한 건. */
let plainCaseId: string;
/** 출하 잠금 + 「과거 인수품 가져오기」로 들어온 건. */
let importedLockedCaseId: string;
/** 출하 잠금 + 가져오기 흔적에 source 가 없는 건(= 가져온 건이 아니다). */
let lockedNotImportedCaseId: string;
/** 살아 있는 부품 요청이 붙은 건. */
let partRequestCaseId: string;

function intake(overrides: Partial<IntakeSubmissionInput>): IntakeSubmissionInput {
  return {
    workflowType: "PAID_GENERATOR",
    billingType: "PAID",
    customerId,
    endUserId: null,
    assignedEngineerId: null,
    priority: "NORMAL",
    receivedAt: "2095-02-05",
    customerRequestedDueDate: null,
    internalTargetShipmentDate: null,
    internalTargetInspectionCompletionDate: null,
    intakeNumber: null,
    modelName: `${PREFIX}-MODEL`,
    productModelId,
    newProductModelName: null,
    lotNumber: `LOT-${RUN}`,
    serialNumber: `SN-${RUN}`,
    partNumber: null,
    accessoryList: null,
    externalConditionSummary: null,
    reasonForRemoval: null,
    reportedSymptom: null,
    notes: null,
    contactName: null,
    contactPhone: null,
    contactEmail: null,
    ...overrides,
  };
}

type LegacyImportState = NonNullable<
  Parameters<typeof createRepairCaseWithIdempotency>[0]["legacyImportState"]
>;

async function seedCase(
  overrides: Partial<IntakeSubmissionInput>,
  legacyImportState?: LegacyImportState
): Promise<string> {
  const key = randomUUID();
  createdIdempotencyKeys.push(key);
  const result = await createRepairCaseWithIdempotency({
    actor: { userId: adminId, role: "SUPER_ADMIN", approvalStatus: "APPROVED", isDeveloper: false },
    intake: intake(overrides),
    idempotencyKey: key,
    logContext: "EXCEL_IMPORT",
    ...(legacyImportState ? { legacyImportState } : {}),
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) throw new Error("fixture 접수 건을 만들지 못했다");
  createdCaseIds.push(result.id);
  const [row] = await db
    .select({ productId: repairCases.productId })
    .from(repairCases)
    .where(eq(repairCases.id, result.id));
  createdProductIds.push(row.productId);
  return result.id;
}

async function versionOf(repairCaseId: string): Promise<number> {
  const [row] = await db
    .select({ version: repairCases.version })
    .from(repairCases)
    .where(eq(repairCases.id, repairCaseId));
  assert.ok(row);
  return row.version;
}

async function storedLines(repairCaseId: string) {
  return db
    .select({
      lineNo: repairCaseUsedParts.lineNo,
      partId: repairCaseUsedParts.partId,
      partNameText: repairCaseUsedParts.partNameText,
      quantity: repairCaseUsedParts.quantity,
    })
    .from(repairCaseUsedParts)
    .where(eq(repairCaseUsedParts.repairCaseId, repairCaseId))
    .orderBy(asc(repairCaseUsedParts.lineNo));
}

async function usedPartsAuditRows(repairCaseId: string) {
  return db
    .select({ previousValue: auditLogs.previousValue, newValue: auditLogs.newValue, actorUserId: auditLogs.actorUserId })
    .from(auditLogs)
    .where(
      and(eq(auditLogs.targetEntity, "repair_case_used_parts"), eq(auditLogs.targetRecordId, repairCaseId))
    )
    .orderBy(asc(auditLogs.createdAt));
}

before(async () => {
  const [admin] = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.role, "SUPER_ADMIN"),
        eq(users.approvalStatus, "APPROVED"),
        eq(users.isActive, true),
        eq(users.isDeleted, false)
      )
    )
    .limit(1);
  assert.ok(admin, "시험 DB 에 승인된 최고관리자 계정이 있어야 한다");
  adminId = admin.id;

  const [customer] = await db
    .insert(customers)
    .values({ name: `${PREFIX}-CUST` })
    .returning({ id: customers.id });
  customerId = customer.id;
  const [model] = await db
    .insert(productModels)
    .values({ modelName: `${PREFIX}-MODEL` })
    .returning({ id: productModels.id });
  productModelId = model.id;

  const insertedParts = await db
    .insert(parts)
    .values([{ partName: `${PREFIX}-PART-A` }, { partName: `${PREFIX}-PART-B` }])
    .returning({ id: parts.id });
  partAId = insertedParts[0].id;
  partBId = insertedParts[1].id;

  plainCaseId = await seedCase({ intakeNumber: `D${YEAR_MONTH}01`, serialNumber: `SN-${RUN}-01` });
  partRequestCaseId = await seedCase({ intakeNumber: `D${YEAR_MONTH}02`, serialNumber: `SN-${RUN}-02` });

  // 🔴 「과거 인수품 가져오기」로 들어온, 출하 완료로 잠긴 건 — 이 칸을 만든 까닭
  // 그 자체다. createRepairCase 가 targetStepKey === "shipment_completed" 일 때
  // is_locked 를 세우고, metadata.source 로 가져오기 흔적을 남긴다.
  importedLockedCaseId = await seedCase(
    { intakeNumber: `D${YEAR_MONTH}03`, serialNumber: `SN-${RUN}-03` },
    {
      targetStepKey: "shipment_completed",
      actualShipmentDate: "2095-03-01",
      batchId: randomUUID(),
      sourceRowNumber: 18,
      metadata: {
        source: "KYOSAN_INTAKE_LIST",
        fileSha256: "a".repeat(64),
        billingReview: false,
        billingAdjustment: null,
        sourceStatus: null,
        sourceBilling: null,
        sourceReportedSymptom: null,
      },
    }
  );

  // 잠겼지만 **가져온 건이 아니다** — 흔적 metadata 에 source 가 없다.
  lockedNotImportedCaseId = await seedCase(
    { intakeNumber: `D${YEAR_MONTH}04`, serialNumber: `SN-${RUN}-04` },
    {
      targetStepKey: "shipment_completed",
      actualShipmentDate: "2095-03-02",
      batchId: randomUUID(),
      sourceRowNumber: 19,
    }
  );

  await db.insert(inventoryPartRequests).values({
    repairCaseId: partRequestCaseId,
    requestedByUserId: adminId,
    status: "PENDING",
  });
});

after(async () => {
  if (createdCaseIds.length > 0) {
    await db.delete(repairCaseUsedParts).where(inArray(repairCaseUsedParts.repairCaseId, createdCaseIds));
    await db.delete(inventoryPartRequests).where(inArray(inventoryPartRequests.repairCaseId, createdCaseIds));
    await db.delete(statusChangeHistories).where(inArray(statusChangeHistories.repairCaseId, createdCaseIds));
    await db
      .delete(auditLogs)
      .where(
        and(
          inArray(auditLogs.targetEntity, ["repair_cases", "repair_case_used_parts"]),
          inArray(auditLogs.targetRecordId, createdCaseIds)
        )
      );
  }
  if (createdIdempotencyKeys.length > 0) {
    await db
      .delete(repairCaseIdempotencyKeys)
      .where(inArray(repairCaseIdempotencyKeys.idempotencyKey, createdIdempotencyKeys));
  }
  if (createdCaseIds.length > 0) await db.delete(repairCases).where(inArray(repairCases.id, createdCaseIds));
  if (createdProductIds.length > 0) await db.delete(products).where(inArray(products.id, createdProductIds));
  await db.delete(parts).where(inArray(parts.id, [partAId, partBId].filter(Boolean)));
  if (productModelId) await db.delete(productModels).where(eq(productModels.id, productModelId));
  if (customerId) await db.delete(customers).where(eq(customers.id, customerId));
  await db.delete(repairCaseIntakeSequences).where(eq(repairCaseIntakeSequences.yearMonth, YEAR_MONTH));
  await pgClient.end({ timeout: 5 });
});

describe("사용 부품 저장 — 두 인가 규칙", () => {
  test("잠금도 이력도 없으면 평소대로 적을 수 있다", async () => {
    const version = await versionOf(plainCaseId);
    const result = await saveRepairCaseUsedParts({
      repairCaseId: plainCaseId,
      expectedVersion: version,
      actorUserId: adminId,
      lines: [{ partId: null, partNameText: "손으로 적은 부품", quantity: 2 }],
    });

    assert.equal(result.ok, true, JSON.stringify(result));
    if (!result.ok) return;
    assert.equal(result.version, version + 1, "저장이 건의 version 을 올린다");
    assert.deepEqual(await storedLines(plainCaseId), [
      { lineNo: 1, partId: null, partNameText: "손으로 적은 부품", quantity: 2 },
    ]);
  });

  test("🔴 반출 이력이 있으면 서버가 거절한다 — 화면이 감추는 것으로는 모자라다", async () => {
    const version = await versionOf(partRequestCaseId);
    const result = await saveRepairCaseUsedParts({
      repairCaseId: partRequestCaseId,
      expectedVersion: version,
      actorUserId: adminId,
      lines: [{ partId: null, partNameText: "몰래 적어 본 부품", quantity: 1 }],
    });

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "PART_REQUEST_HISTORY_EXISTS");
    assert.deepEqual(await storedLines(partRequestCaseId), [], "한 줄도 들어가지 않았다");
    assert.equal(await versionOf(partRequestCaseId), version, "거절된 저장은 version 도 올리지 않는다");

    // 조회도 같은 판정을 내려 화면이 입력 칸을 열지 않는다.
    const view = await getRepairCaseUsedPartsView(partRequestCaseId);
    assert.equal(view.hasPartRequestHistory, true);
    assert.equal(view.writeGate.ok, false);
    if (view.writeGate.ok) return;
    assert.equal(view.writeGate.code, "PART_REQUEST_HISTORY_EXISTS");
  });

  test("🔴 출하 잠금 + 가져온 건 → 적을 수 있다", async () => {
    const [row] = await db
      .select({ isLocked: repairCases.isLocked })
      .from(repairCases)
      .where(eq(repairCases.id, importedLockedCaseId));
    assert.equal(row.isLocked, true, "fixture 가 실제로 잠겨 있어야 한다");

    const version = await versionOf(importedLockedCaseId);
    const result = await saveRepairCaseUsedParts({
      repairCaseId: importedLockedCaseId,
      expectedVersion: version,
      actorUserId: adminId,
      lines: [{ partId: partAId, partNameText: `${PREFIX}-PART-A`, quantity: 3 }],
    });

    assert.equal(result.ok, true, JSON.stringify(result));
    assert.deepEqual(await storedLines(importedLockedCaseId), [
      { lineNo: 1, partId: partAId, partNameText: `${PREFIX}-PART-A`, quantity: 3 },
    ]);

    const view = await getRepairCaseUsedPartsView(importedLockedCaseId);
    assert.equal(view.writeGate.ok, true, "화면도 입력 칸을 연다");
  });

  test("🔴 출하 잠금 + 가져온 건이 아님 → 막힌다", async () => {
    const [row] = await db
      .select({ isLocked: repairCases.isLocked })
      .from(repairCases)
      .where(eq(repairCases.id, lockedNotImportedCaseId));
    assert.equal(row.isLocked, true, "fixture 가 실제로 잠겨 있어야 한다");

    const version = await versionOf(lockedNotImportedCaseId);
    const result = await saveRepairCaseUsedParts({
      repairCaseId: lockedNotImportedCaseId,
      expectedVersion: version,
      actorUserId: adminId,
      lines: [{ partId: null, partNameText: "잠긴 건에 적어 본 부품", quantity: 1 }],
    });

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "CASE_LOCKED");
    assert.deepEqual(await storedLines(lockedNotImportedCaseId), []);
    assert.equal(await versionOf(lockedNotImportedCaseId), version);

    const view = await getRepairCaseUsedPartsView(lockedNotImportedCaseId);
    assert.equal(view.writeGate.ok, false);
    if (view.writeGate.ok) return;
    assert.equal(view.writeGate.code, "CASE_LOCKED");
  });

  test("없는 건 · 휴지통의 건은 NOT_FOUND 다", async () => {
    const result = await saveRepairCaseUsedParts({
      repairCaseId: randomUUID(),
      expectedVersion: 1,
      actorUserId: adminId,
      lines: [],
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "NOT_FOUND");
  });
});

describe("사용 부품 저장 — 줄 다루기", () => {
  test("🔴 line_no 를 서버가 매긴다 — 받은 차례대로 1부터", async () => {
    const version = await versionOf(plainCaseId);
    const result = await saveRepairCaseUsedParts({
      repairCaseId: plainCaseId,
      expectedVersion: version,
      actorUserId: adminId,
      lines: [
        { partId: null, partNameText: "첫째", quantity: 1 },
        { partId: null, partNameText: "둘째", quantity: 2 },
        { partId: null, partNameText: "셋째", quantity: 3 },
      ],
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    if (!result.ok) return;

    assert.deepEqual(result.lines.map((line) => line.lineNo), [1, 2, 3]);
    assert.deepEqual(
      (await storedLines(plainCaseId)).map((line) => [line.lineNo, line.partNameText]),
      [
        [1, "첫째"],
        [2, "둘째"],
        [3, "셋째"],
      ]
    );
  });

  test("🔴 고르면 part_id 가 붙고, 손으로 적으면 null 이다", async () => {
    const version = await versionOf(plainCaseId);
    const result = await saveRepairCaseUsedParts({
      repairCaseId: plainCaseId,
      expectedVersion: version,
      actorUserId: adminId,
      lines: [
        { partId: partAId, partNameText: `${PREFIX}-PART-A`, quantity: 1 },
        { partId: null, partNameText: "마스터에 없는 옛 부품", quantity: 4 },
        { partId: partBId, partNameText: "고르고 나서 고친 이름", quantity: 2 },
      ],
    });
    assert.equal(result.ok, true, JSON.stringify(result));

    assert.deepEqual(await storedLines(plainCaseId), [
      { lineNo: 1, partId: partAId, partNameText: `${PREFIX}-PART-A`, quantity: 1 },
      { lineNo: 2, partId: null, partNameText: "마스터에 없는 옛 부품", quantity: 4 },
      // 마스터 품명이 아니어도 그 건에 적힌 글자를 그대로 남긴다(quote_items 와 같다).
      { lineNo: 3, partId: partBId, partNameText: "고르고 나서 고친 이름", quantity: 2 },
    ]);
  });

  test("없는 부품을 고른 척하면 거절한다 — 날 FK 오류로 터지지 않는다", async () => {
    const version = await versionOf(plainCaseId);
    const before = await storedLines(plainCaseId);
    const result = await saveRepairCaseUsedParts({
      repairCaseId: plainCaseId,
      expectedVersion: version,
      actorUserId: adminId,
      lines: [{ partId: randomUUID(), partNameText: "없는 부품", quantity: 1 }],
    });

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "INVALID_PART");
    assert.deepEqual(await storedLines(plainCaseId), before, "실패한 저장이 기존 줄을 지우지 않는다");
    assert.equal(await versionOf(plainCaseId), version);
  });

  test("빈 목록을 저장하면 줄이 모두 사라진다 — 잘못 적은 것을 걷어내는 길", async () => {
    assert.ok((await storedLines(plainCaseId)).length > 0, "지울 줄이 남아 있어야 하는 시험이다");
    const version = await versionOf(plainCaseId);
    const result = await saveRepairCaseUsedParts({
      repairCaseId: plainCaseId,
      expectedVersion: version,
      actorUserId: adminId,
      lines: [],
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.deepEqual(await storedLines(plainCaseId), []);
  });

  test("🔴 수량이 0 이하면 DB CHECK 가 막는다 — 검사 층을 건너뛰어도", async () => {
    const version = await versionOf(plainCaseId);
    await assert.rejects(
      saveRepairCaseUsedParts({
        repairCaseId: plainCaseId,
        expectedVersion: version,
        actorUserId: adminId,
        lines: [{ partId: null, partNameText: "0개 갈았다", quantity: 0 }],
      }),
      // drizzle 이 감싼 오류라 CHECK 이름은 cause 에 있다.
      (err: unknown) => {
        const cause = (err as { cause?: { message?: string } }).cause;
        assert.match(
          String(cause?.message ?? (err as Error).message),
          /repair_case_used_parts_quantity_positive/
        );
        return true;
      }
    );
    assert.deepEqual(await storedLines(plainCaseId), [], "롤백돼 한 줄도 남지 않는다");
    assert.equal(await versionOf(plainCaseId), version, "version 도 롤백된다");
  });

  test("🔴 다른 건의 줄을 건드리지 않는다 — 지우기는 그 건으로만 좁힌다", async () => {
    const plainVersion = await versionOf(plainCaseId);
    await saveRepairCaseUsedParts({
      repairCaseId: plainCaseId,
      expectedVersion: plainVersion,
      actorUserId: adminId,
      lines: [{ partId: null, partNameText: "평범한 건의 줄", quantity: 1 }],
    });

    const importedBefore = await storedLines(importedLockedCaseId);
    assert.ok(importedBefore.length > 0);

    const importedVersion = await versionOf(importedLockedCaseId);
    await saveRepairCaseUsedParts({
      repairCaseId: importedLockedCaseId,
      expectedVersion: importedVersion,
      actorUserId: adminId,
      lines: [{ partId: null, partNameText: "가져온 건의 줄", quantity: 9 }],
    });

    assert.deepEqual(
      (await storedLines(plainCaseId)).map((line) => line.partNameText),
      ["평범한 건의 줄"],
      "다른 건을 저장해도 이 건의 줄은 그대로다"
    );
  });
});

describe("사용 부품 저장 — 동시 편집과 감사 이력", () => {
  test("🔴 expectedVersion 이 다르면 거절한다 — 조용히 덮어쓰지 않는다", async () => {
    const version = await versionOf(plainCaseId);
    const before = await storedLines(plainCaseId);

    const stale = await saveRepairCaseUsedParts({
      repairCaseId: plainCaseId,
      expectedVersion: version - 1,
      actorUserId: adminId,
      lines: [{ partId: null, partNameText: "낡은 폼이 보낸 줄", quantity: 1 }],
    });
    assert.equal(stale.ok, false);
    if (stale.ok) return;
    assert.equal(stale.code, "CONFLICT");

    const ahead = await saveRepairCaseUsedParts({
      repairCaseId: plainCaseId,
      expectedVersion: version + 5,
      actorUserId: adminId,
      lines: [{ partId: null, partNameText: "앞선 번호", quantity: 1 }],
    });
    assert.equal(ahead.ok, false);
    if (ahead.ok) return;
    assert.equal(ahead.code, "CONFLICT");

    assert.deepEqual(await storedLines(plainCaseId), before, "거절된 저장은 아무것도 바꾸지 않는다");
    assert.equal(await versionOf(plainCaseId), version);
  });

  test("🔴 감사 이력이 남는다 — 앞 목록과 뒤 목록을 함께", async () => {
    const version = await versionOf(plainCaseId);
    const previous = await storedLines(plainCaseId);
    const auditBefore = await usedPartsAuditRows(plainCaseId);

    const result = await saveRepairCaseUsedParts({
      repairCaseId: plainCaseId,
      expectedVersion: version,
      actorUserId: adminId,
      lines: [{ partId: partAId, partNameText: `${PREFIX}-PART-A`, quantity: 7 }],
    });
    assert.equal(result.ok, true, JSON.stringify(result));

    const auditAfter = await usedPartsAuditRows(plainCaseId);
    assert.equal(auditAfter.length, auditBefore.length + 1, "저장마다 한 줄씩 남는다");

    const latest = auditAfter[auditAfter.length - 1];
    assert.equal(latest.actorUserId, adminId);
    assert.deepEqual(latest.previousValue, { lines: previous });
    assert.deepEqual(latest.newValue, {
      lines: [{ lineNo: 1, partId: partAId, partNameText: `${PREFIX}-PART-A`, quantity: 7 }],
    });
  });

  test("거절된 저장은 감사 이력도 남기지 않는다", async () => {
    const auditBefore = await usedPartsAuditRows(lockedNotImportedCaseId);
    await saveRepairCaseUsedParts({
      repairCaseId: lockedNotImportedCaseId,
      expectedVersion: await versionOf(lockedNotImportedCaseId),
      actorUserId: adminId,
      lines: [{ partId: null, partNameText: "막힌 줄", quantity: 1 }],
    });
    assert.deepEqual(await usedPartsAuditRows(lockedNotImportedCaseId), auditBefore);
  });
});

describe("사용 부품 조회 — 저장한 것이 그대로 보인다", () => {
  test("line_no 차례대로 돌려주고, 판정도 함께 온다", async () => {
    const version = await versionOf(importedLockedCaseId);
    await saveRepairCaseUsedParts({
      repairCaseId: importedLockedCaseId,
      expectedVersion: version,
      actorUserId: adminId,
      lines: [
        { partId: partBId, partNameText: `${PREFIX}-PART-B`, quantity: 1 },
        { partId: null, partNameText: "손으로 적은 것", quantity: 2 },
      ],
    });

    const view = await getRepairCaseUsedPartsView(importedLockedCaseId);
    assert.deepEqual(
      view.rows.map((row) => [row.lineNo, row.partId, row.partNameText, row.quantity]),
      [
        [1, partBId, `${PREFIX}-PART-B`, 1],
        [2, null, "손으로 적은 것", 2],
      ]
    );
    assert.equal(view.hasPartRequestHistory, false);
    assert.equal(view.writeGate.ok, true);
  });
});
