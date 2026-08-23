import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { db } from "../connection";
import {
  customers,
  endUserContacts,
  endUsers,
  inventoryPartRequestItems,
  partStockBalances,
  parts,
  procedureCaseExecutions,
  procedureChecklistItems,
  procedureChecklistSections,
  procedureReferenceItems,
  procedureTemplateEdges,
  procedureTemplateEditHistory,
  procedureTemplateNodes,
  procedureTemplateValidationIssues,
  procedureTemplates,
  procedureTroubleshootingEntries,
  procedureValidationResolutionHistory,
  productModels,
  products,
  repairCases,
  stockTransactions,
} from "../schema";
import { insertAuditLog } from "./audit-logs";
import { getMasterDataTrashRetentionStatus } from "@/lib/domain/master-data-trash-retention";

/**
 * ============================================================================
 * 마스터 데이터 자동 완전삭제 — 휴지통에서 15일이 지난 것
 * ============================================================================
 * 여기에 "server-only"가 없는 것은 실수가 아니다. 이 모듈의 유일한 호출자는
 * scripts/purge-expired-master-data.ts — Next.js 번들러 밖에서 tsx로 도는
 * CLI다. db를 ../client가 아니라 ../connection에서 가져오는 것도 같은
 * 이유이고, repair-cases-purge.ts와 repair-case-flowchart-purge.ts가 이미
 * 같은 이유로 같은 모양을 하고 있다.
 *
 * 그래서 customers-trash.ts(그 파일은 "server-only"다)의
 * permanentlyDeleteCustomer를 부르지 않고 삭제 순서를 다시 적는다. 재사용을
 * 놓친 것이 아니라 넘을 수 없는 경계다. 대신 정말로 공유해야 하는 것 —
 * 만료 계산(getMasterDataTrashRetentionStatus, 휴지통 배지가 "만료됨"이라고
 * 말할 때 쓰는 바로 그 함수)과 감사 로그 기록 — 은 같은 함수를 쓴다. 화면이
 * 만료라고 말하는 순간과 이 정리가 대상으로 삼는 순간은 어긋날 수 없다.
 *
 * ── 후보 선택은 판정이 아니다 ───────────────────────────────────────────
 * 목록 조회(listPurgeEligible*)는 잠그지 않는다. 실제 판정은 전부 각자의
 * 트랜잭션 안에서 행을 잠근 뒤 다시 한다 — 그 사이에 복원됐을 수도, 접수
 * 건이 새로 걸렸을 수도, 이미 사람이 완전삭제했을 수도 있다.
 * ============================================================================
 */

export type PurgeCustomerOutcome =
  | "PURGED"
  | "SKIPPED_RESTORED"
  | "SKIPPED_NOT_ELIGIBLE"
  | "SKIPPED_ALREADY_GONE"
  | "SKIPPED_REFERENCED";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * 고객사 하나, 트랜잭션 하나. 행을 잠그고 자격을 실시간으로 다시 본다:
 *  - 행이 없다 → SKIPPED_ALREADY_GONE (사람이 먼저 완전삭제했거나 이전
 *    회차가 이미 지웠다. 오류가 아니라 정상적인 결과다.)
 *  - is_deleted = false → SKIPPED_RESTORED (선택과 잠금 사이에 복원됐다.
 *    복원이 이긴다 — 먼저 행 잠금을 얻은 쪽이 결과를 정한다.)
 *  - 아직 15일이 지나지 않았다 → SKIPPED_NOT_ELIGIBLE (방어적 재검사.
 *    실제 판정 지점은 후보 조회가 아니라 여기다.)
 *  - A/S 접수 건이 걸려 있다 → SKIPPED_REFERENCED (휴지통에 넣을 때 이미
 *    막았으므로 정상 운영에서는 나오지 않는다. 그래도 DB 오류로 터뜨리는
 *    대신 이유가 있는 건너뜀으로 보고한다 — 매일 밤 같은 줄이 다시 찍히는
 *    것 자체가 "손을 봐야 한다"는 신호가 된다.)
 *  - 그렇지 않으면 담당자 → End-User → 고객사 순으로 지운다. 이 순서는
 *    FK RESTRICT가 강제한다. 감사 로그는 actor_user_id = NULL(사람이 아닌
 *    시스템이 한 일)로 남는다.
 */
export async function purgeExpiredCustomer(id: string, now: Date = new Date()): Promise<PurgeCustomerOutcome> {
  return await db.transaction(async (tx) => {
    const [current] = await tx
      .select({
        id: customers.id,
        name: customers.name,
        createdAt: customers.createdAt,
        isDeleted: customers.isDeleted,
        deletedAt: customers.deletedAt,
        deletedBy: customers.deletedBy,
        deleteReason: customers.deleteReason,
        // contact_name/contact_email/contact_phone은 여기서도 고르지 않는다.
        // 이 트랜잭션이 그 개인정보가 시스템에서 영구히 지워지는 지점이고,
        // 감사 로그로 새어 나가면 지운 것이 아니게 된다.
      })
      .from(customers)
      .where(eq(customers.id, id))
      .for("update");

    if (!current) return "SKIPPED_ALREADY_GONE";
    if (!current.isDeleted || !current.deletedAt) return "SKIPPED_RESTORED";
    if (!getMasterDataTrashRetentionStatus(current.deletedAt.toISOString(), now).isExpired) {
      return "SKIPPED_NOT_ELIGIBLE";
    }

    const ownEndUsers = await tx
      .select({ id: endUsers.id, name: endUsers.name })
      .from(endUsers)
      .where(eq(endUsers.customerId, id))
      .for("update");
    const endUserIds = ownEndUsers.map((endUser) => endUser.id);

    if ((await countReferencingRepairCases(tx, id, endUserIds)) > 0) return "SKIPPED_REFERENCED";

    if (endUserIds.length > 0) {
      await tx.delete(endUserContacts).where(inArray(endUserContacts.endUserId, endUserIds));
      await tx.delete(endUsers).where(inArray(endUsers.id, endUserIds));

      for (const endUser of ownEndUsers) {
        await insertAuditLog(tx, {
          actorUserId: null,
          actionType: "PURGE",
          targetEntity: "end_users",
          targetRecordId: endUser.id,
          previousValue: { id: endUser.id, customerId: id, name: endUser.name },
          newValue: null,
        });
      }
    }

    await tx.delete(customers).where(eq(customers.id, id));

    await insertAuditLog(tx, {
      actorUserId: null,
      actionType: "PURGE",
      targetEntity: "customers",
      targetRecordId: id,
      previousValue: {
        id: current.id,
        name: current.name,
        createdAt: current.createdAt.toISOString(),
        deletedAt: current.deletedAt.toISOString(),
        deletedBy: current.deletedBy,
        deleteReason: current.deleteReason,
        purgedEndUserIds: endUserIds,
      },
      newValue: null,
    });

    return "PURGED";
  });
}

/** customers-trash.ts의 같은 이름 함수와 같은 규칙 — 삭제된 접수 건도 센다. */
async function countReferencingRepairCases(tx: Tx, customerId: string, endUserIds: string[]): Promise<number> {
  const [direct] = await tx
    .select({ total: sql<number>`count(*)::int` })
    .from(repairCases)
    .where(eq(repairCases.customerId, customerId));

  if (endUserIds.length === 0) return direct.total;

  const [viaEndUser] = await tx
    .select({ total: sql<number>`count(*)::int` })
    .from(repairCases)
    .where(and(inArray(repairCases.endUserId, endUserIds), ne(repairCases.customerId, customerId)));

  return direct.total + viaEndUser.total;
}

/**
 * 읽기 전용, 잠그지 않음 — 이번 회차의 후보 목록. 만료 판정을 SQL로 다시
 * 적지 않고 화면과 같은 함수로 계산한다.
 */
export async function listPurgeEligibleCustomerIds(now: Date = new Date()): Promise<string[]> {
  const rows = await db
    .select({ id: customers.id, deletedAt: customers.deletedAt })
    .from(customers)
    .where(eq(customers.isDeleted, true));

  return rows
    .filter((row) => row.deletedAt !== null && getMasterDataTrashRetentionStatus(row.deletedAt.toISOString(), now).isExpired)
    .map((row) => row.id);
}

export type PurgeProductModelOutcome = PurgeCustomerOutcome;

/**
 * 제품 모델 하나, 트랜잭션 하나. 고객사 쪽 purgeExpiredCustomer와 판정
 * 순서·결과 종류가 같고, 다른 것은 딸려 가는 자식뿐이다: 등록 장비
 * (products) → 모델. products를 참조하는 것은 repair_cases뿐이므로 장비
 * 아래로는 더 내려갈 것이 없다.
 */
export async function purgeExpiredProductModel(
  id: string,
  now: Date = new Date()
): Promise<PurgeProductModelOutcome> {
  return await db.transaction(async (tx) => {
    const [current] = await tx
      .select({
        id: productModels.id,
        modelName: productModels.modelName,
        kind: productModels.kind,
        manufacturer: productModels.manufacturer,
        createdAt: productModels.createdAt,
        isDeleted: productModels.isDeleted,
        deletedAt: productModels.deletedAt,
        deletedBy: productModels.deletedBy,
        deleteReason: productModels.deleteReason,
      })
      .from(productModels)
      .where(eq(productModels.id, id))
      .for("update");

    if (!current) return "SKIPPED_ALREADY_GONE";
    if (!current.isDeleted || !current.deletedAt) return "SKIPPED_RESTORED";
    if (!getMasterDataTrashRetentionStatus(current.deletedAt.toISOString(), now).isExpired) {
      return "SKIPPED_NOT_ELIGIBLE";
    }

    const ownProducts = await tx
      .select({ id: products.id, modelName: products.modelName })
      .from(products)
      .where(eq(products.productModelId, id))
      .for("update");
    const productIds = ownProducts.map((product) => product.id);

    if (productIds.length > 0) {
      const [referencing] = await tx
        .select({ total: sql<number>`count(*)::int` })
        .from(repairCases)
        .where(inArray(repairCases.productId, productIds));
      if (referencing.total > 0) return "SKIPPED_REFERENCED";

      await tx.delete(products).where(inArray(products.id, productIds));

      for (const product of ownProducts) {
        await insertAuditLog(tx, {
          actorUserId: null,
          actionType: "PURGE",
          targetEntity: "products",
          targetRecordId: product.id,
          previousValue: { id: product.id, productModelId: id, modelName: product.modelName },
          newValue: null,
        });
      }
    }

    await tx.delete(productModels).where(eq(productModels.id, id));

    await insertAuditLog(tx, {
      actorUserId: null,
      actionType: "PURGE",
      targetEntity: "product_models",
      targetRecordId: id,
      previousValue: {
        id: current.id,
        modelName: current.modelName,
        kind: current.kind,
        manufacturer: current.manufacturer,
        createdAt: current.createdAt.toISOString(),
        deletedAt: current.deletedAt.toISOString(),
        deletedBy: current.deletedBy,
        deleteReason: current.deleteReason,
        purgedProductIds: productIds,
      },
      newValue: null,
    });

    return "PURGED";
  });
}

/** 고객사 쪽과 같은 규칙 — 읽기 전용이고, 판정은 각자의 트랜잭션에서 다시 한다. */
export async function listPurgeEligibleProductModelIds(now: Date = new Date()): Promise<string[]> {
  const rows = await db
    .select({ id: productModels.id, deletedAt: productModels.deletedAt })
    .from(productModels)
    .where(eq(productModels.isDeleted, true));

  return rows
    .filter(
      (row) => row.deletedAt !== null && getMasterDataTrashRetentionStatus(row.deletedAt.toISOString(), now).isExpired
    )
    .map((row) => row.id);
}

export type PurgePartOutcome = PurgeCustomerOutcome;

/**
 * 부품 하나, 트랜잭션 하나. 고객사·제품 모델과 판정 순서·결과 종류가 같고,
 * 다른 것은 붙잡는 사슬뿐이다:
 *
 *     parts <- part_stock_balances.part_id <- stock_transactions.part_stock_balance_id
 *     parts <- inventory_part_request_items.part_id
 *
 * 이력(입출고·부품 요청)이 하나라도 있으면 SKIPPED_REFERENCED다. 이력이
 * 없으면 잔량 버킷을 먼저 지우고 부품을 지운다 — FK가 강제하는 순서다.
 */
export async function purgeExpiredPart(id: string, now: Date = new Date()): Promise<PurgePartOutcome> {
  return await db.transaction(async (tx) => {
    const [current] = await tx
      .select({
        id: parts.id,
        partName: parts.partName,
        partSpec: parts.partSpec,
        kyosanPartNo: parts.kyosanPartNo,
        drawingNo: parts.drawingNo,
        category: parts.category,
        createdAt: parts.createdAt,
        isDeleted: parts.isDeleted,
        deletedAt: parts.deletedAt,
        deletedBy: parts.deletedBy,
        deleteReason: parts.deleteReason,
      })
      .from(parts)
      .where(eq(parts.id, id))
      .for("update");

    if (!current) return "SKIPPED_ALREADY_GONE";
    if (!current.isDeleted || !current.deletedAt) return "SKIPPED_RESTORED";
    if (!getMasterDataTrashRetentionStatus(current.deletedAt.toISOString(), now).isExpired) {
      return "SKIPPED_NOT_ELIGIBLE";
    }

    const [transactions] = await tx
      .select({ total: sql<number>`count(*)::int` })
      .from(stockTransactions)
      .innerJoin(partStockBalances, eq(stockTransactions.partStockBalanceId, partStockBalances.id))
      .where(eq(partStockBalances.partId, id));
    const [requestItems] = await tx
      .select({ total: sql<number>`count(*)::int` })
      .from(inventoryPartRequestItems)
      .where(eq(inventoryPartRequestItems.partId, id));
    if (transactions.total + requestItems.total > 0) return "SKIPPED_REFERENCED";

    await tx.delete(partStockBalances).where(eq(partStockBalances.partId, id));
    await tx.delete(parts).where(eq(parts.id, id));

    await insertAuditLog(tx, {
      actorUserId: null,
      actionType: "PURGE",
      targetEntity: "parts",
      targetRecordId: id,
      previousValue: {
        id: current.id,
        partName: current.partName,
        partSpec: current.partSpec,
        kyosanPartNo: current.kyosanPartNo,
        drawingNo: current.drawingNo,
        category: current.category,
        createdAt: current.createdAt.toISOString(),
        deletedAt: current.deletedAt.toISOString(),
        deletedBy: current.deletedBy,
        deleteReason: current.deleteReason,
      },
      newValue: null,
    });

    return "PURGED";
  });
}

/** 고객사·제품 모델과 같은 규칙 — 읽기 전용이고, 판정은 각자의 트랜잭션에서 다시 한다. */
export async function listPurgeEligiblePartIds(now: Date = new Date()): Promise<string[]> {
  const rows = await db.select({ id: parts.id, deletedAt: parts.deletedAt }).from(parts).where(eq(parts.isDeleted, true));

  return rows
    .filter(
      (row) => row.deletedAt !== null && getMasterDataTrashRetentionStatus(row.deletedAt.toISOString(), now).isExpired
    )
    .map((row) => row.id);
}

export type PurgeProcedureTemplateOutcome = PurgeCustomerOutcome;

/**
 * 기술 절차 하나, 트랜잭션 하나. 판정 순서·결과 종류는 다른 마스터와 같고,
 * 다른 것은 딸려 가는 부속물의 규모다 — 검증 해소 이력, 검증 이슈, 편집
 * 이력, 참고자료, 체크리스트(항목→구역), 문제 해결 항목, 분기, 노드.
 * 이 순서는 취향이 아니라 FK RESTRICT가 강제한다.
 *
 * procedure-templates.ts의 purgeProcedureTemplateContent가 같은 순서를 갖고
 * 있지만 부를 수 없다 — 그 파일은 "server-only"이고 이 모듈은 CLI에서 돈다
 * (파일 상단 주석). 재사용을 놓친 것이 아니라 넘을 수 없는 경계다.
 */
export async function purgeExpiredProcedureTemplate(
  id: string,
  now: Date = new Date()
): Promise<PurgeProcedureTemplateOutcome> {
  return await db.transaction(async (tx) => {
    const [current] = await tx
      .select({
        id: procedureTemplates.id,
        code: procedureTemplates.code,
        name: procedureTemplates.name,
        category: procedureTemplates.category,
        status: procedureTemplates.status,
        version: procedureTemplates.version,
        createdAt: procedureTemplates.createdAt,
        isDeleted: procedureTemplates.isDeleted,
        deletedAt: procedureTemplates.deletedAt,
        deletedBy: procedureTemplates.deletedBy,
        deleteReason: procedureTemplates.deleteReason,
      })
      .from(procedureTemplates)
      .where(eq(procedureTemplates.id, id))
      .for("update");

    if (!current) return "SKIPPED_ALREADY_GONE";
    if (!current.isDeleted || !current.deletedAt) return "SKIPPED_RESTORED";
    if (!getMasterDataTrashRetentionStatus(current.deletedAt.toISOString(), now).isExpired) {
      return "SKIPPED_NOT_ELIGIBLE";
    }

    const [executions] = await tx
      .select({ total: sql<number>`count(*)::int` })
      .from(procedureCaseExecutions)
      .where(eq(procedureCaseExecutions.procedureTemplateId, id));
    const [successors] = await tx
      .select({ total: sql<number>`count(*)::int` })
      .from(procedureTemplates)
      .where(eq(procedureTemplates.supersedesTemplateId, id));
    if (executions.total + successors.total > 0) return "SKIPPED_REFERENCED";

    const nodes = await tx
      .select({ id: procedureTemplateNodes.id })
      .from(procedureTemplateNodes)
      .where(eq(procedureTemplateNodes.procedureTemplateId, id));
    const nodeIds = nodes.map((node) => node.id);

    await tx
      .delete(procedureValidationResolutionHistory)
      .where(eq(procedureValidationResolutionHistory.procedureTemplateId, id));
    await tx
      .delete(procedureTemplateValidationIssues)
      .where(eq(procedureTemplateValidationIssues.procedureTemplateId, id));
    await tx.delete(procedureTemplateEditHistory).where(eq(procedureTemplateEditHistory.procedureTemplateId, id));
    await tx.delete(procedureReferenceItems).where(eq(procedureReferenceItems.procedureTemplateId, id));

    if (nodeIds.length > 0) {
      const sections = await tx
        .select({ id: procedureChecklistSections.id })
        .from(procedureChecklistSections)
        .where(inArray(procedureChecklistSections.nodeId, nodeIds));
      const sectionIds = sections.map((section) => section.id);
      if (sectionIds.length > 0) {
        await tx.delete(procedureChecklistItems).where(inArray(procedureChecklistItems.sectionId, sectionIds));
      }
      await tx.delete(procedureChecklistSections).where(inArray(procedureChecklistSections.nodeId, nodeIds));
      await tx
        .delete(procedureTroubleshootingEntries)
        .where(inArray(procedureTroubleshootingEntries.nodeId, nodeIds));
    }

    await tx.delete(procedureTemplateEdges).where(eq(procedureTemplateEdges.procedureTemplateId, id));
    await tx.delete(procedureTemplateNodes).where(eq(procedureTemplateNodes.procedureTemplateId, id));
    await tx.delete(procedureTemplates).where(eq(procedureTemplates.id, id));

    await insertAuditLog(tx, {
      actorUserId: null,
      actionType: "PURGE",
      targetEntity: "procedure_templates",
      targetRecordId: id,
      previousValue: {
        id: current.id,
        code: current.code,
        name: current.name,
        category: current.category,
        status: current.status,
        version: current.version,
        createdAt: current.createdAt.toISOString(),
        deletedAt: current.deletedAt.toISOString(),
        deletedBy: current.deletedBy,
        deleteReason: current.deleteReason,
        purgedNodeCount: nodeIds.length,
      },
      newValue: null,
    });

    return "PURGED";
  });
}

/** 다른 마스터와 같은 규칙 — 읽기 전용이고, 판정은 각자의 트랜잭션에서 다시 한다. */
export async function listPurgeEligibleProcedureTemplateIds(now: Date = new Date()): Promise<string[]> {
  const rows = await db
    .select({ id: procedureTemplates.id, deletedAt: procedureTemplates.deletedAt })
    .from(procedureTemplates)
    .where(eq(procedureTemplates.isDeleted, true));

  return rows
    .filter(
      (row) => row.deletedAt !== null && getMasterDataTrashRetentionStatus(row.deletedAt.toISOString(), now).isExpired
    )
    .map((row) => row.id);
}

export type MasterDataPurgeEntitySummary = {
  eligible: number;
  purged: number;
  skippedRestored: number;
  skippedNotEligible: number;
  skippedAlreadyGone: number;
  skippedReferenced: number;
  errored: number;
  errors: { id: string; message: string }[];
};

export type MasterDataPurgeSweepSummary = {
  customers: MasterDataPurgeEntitySummary;
  productModels: MasterDataPurgeEntitySummary;
  parts: MasterDataPurgeEntitySummary;
  procedureTemplates: MasterDataPurgeEntitySummary;
};

function emptySummary(eligible: number): MasterDataPurgeEntitySummary {
  return {
    eligible,
    purged: 0,
    skippedRestored: 0,
    skippedNotEligible: 0,
    skippedAlreadyGone: 0,
    skippedReferenced: 0,
    errored: 0,
    errors: [],
  };
}

/** 후보 하나하나를 자기 트랜잭션에서 지우고 결과를 센다. 한 건의 실패가 나머지를 멈추지 않는다. */
async function sweepEntity(
  eligibleIds: string[],
  purgeOne: (id: string, now: Date) => Promise<PurgeCustomerOutcome>,
  now: Date
): Promise<MasterDataPurgeEntitySummary> {
  const summary = emptySummary(eligibleIds.length);

  for (const id of eligibleIds) {
    try {
      const outcome = await purgeOne(id, now);
      if (outcome === "PURGED") summary.purged += 1;
      else if (outcome === "SKIPPED_RESTORED") summary.skippedRestored += 1;
      else if (outcome === "SKIPPED_NOT_ELIGIBLE") summary.skippedNotEligible += 1;
      else if (outcome === "SKIPPED_REFERENCED") summary.skippedReferenced += 1;
      else summary.skippedAlreadyGone += 1;
    } catch (err) {
      summary.errored += 1;
      summary.errors.push({ id, message: err instanceof Error ? err.message : String(err) });
    }
  }

  return summary;
}

/**
 * 한 회차 전체. 고객사를 먼저, 제품 모델을 나중에 — 순서가 안전에 영향을
 * 주지는 않지만(둘은 서로를 참조하지 않고, 각자 자기 행을 잠그고 다시
 * 판정한다) 로그를 읽는 순서를 고정해 둔다.
 *
 * 한 종류가 통째로 실패해도 다른 종류는 계속 돈다 — 각 건의 실패는 그 건의
 * 요약에만 기록된다.
 */
export async function runMasterDataPurgeSweep(now: Date = new Date()): Promise<MasterDataPurgeSweepSummary> {
  const customerSummary = await sweepEntity(await listPurgeEligibleCustomerIds(now), purgeExpiredCustomer, now);
  const productModelSummary = await sweepEntity(
    await listPurgeEligibleProductModelIds(now),
    purgeExpiredProductModel,
    now
  );
  const partSummary = await sweepEntity(await listPurgeEligiblePartIds(now), purgeExpiredPart, now);
  const procedureTemplateSummary = await sweepEntity(
    await listPurgeEligibleProcedureTemplateIds(now),
    purgeExpiredProcedureTemplate,
    now
  );

  return {
    customers: customerSummary,
    productModels: productModelSummary,
    parts: partSummary,
    procedureTemplates: procedureTemplateSummary,
  };
}
