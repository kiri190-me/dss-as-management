import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { db } from "../connection";
import {
  customers,
  domesticOrderDueDates,
  domesticOrders,
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
  quoteItems,
  quoteRepairTasks,
  quoteWorkScopeLines,
  quotes,
  repairCases,
  stockTransactions,
} from "../schema";
import { insertAuditLog } from "./audit-logs";
import { getMasterDataTrashRetentionStatus } from "@/lib/domain/master-data-trash-retention";
import { sumQuoteSupplyAmount } from "@/lib/domain/quote-list";

/**
 * ============================================================================
 * 마스터 데이터 자동 완전삭제 — 휴지통에서 15일이 지난 것
 * ============================================================================
 * 고객사 · 제품 모델 · 부품 · 기술 절차, 그리고 내자 정리 줄과 견적서
 * (둘 다 2026-09-11). 둘은 마스터 데이터가 아니지만 같은 15일 규칙과 같은
 * 배지를 쓰도록 정해졌고(사용자 결정), 같은 CLI 한 번으로 함께 도는 편이 야간
 * 작업을 하나 더 늘리는 것보다 낫다.
 *
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

export type PurgeDomesticOrderOutcome = PurgeCustomerOutcome;

/**
 * 내자 정리 한 줄, 트랜잭션 하나(2026-09-11). 다른 마스터와 판정 순서·결과
 * 종류가 같다 — 다만 **SKIPPED_REFERENCED 는 나오지 않는다.** 이 줄을 가리키는
 * 표는 domestic_order_due_dates 하나뿐이고 ON DELETE CASCADE 라, 무엇도 이 줄의
 * 삭제를 막지 않는다(납기요청일은 DB 가 함께 지운다).
 *
 * 사람이 휴지통에서 누르는 완전 삭제(domestic-orders-trash.ts 의
 * permanentlyDeleteDomesticOrder)와 같은 일을 시스템이 한다. 그 파일은
 * "server-only"라 부를 수 없어서 순서를 여기 다시 적는다(이 파일 머리말).
 * 감사 로그의 스냅숏 칸도 그쪽과 같다 — 자유 입력 칸(현황·이력·기타·납품자·
 * 일본 송금·고장내역)은 고르지 않는다. 사람 이름이 섞일 수 있는 칸이다.
 */
export async function purgeExpiredDomesticOrder(
  id: string,
  now: Date = new Date()
): Promise<PurgeDomesticOrderOutcome> {
  return await db.transaction(async (tx) => {
    const [current] = await tx
      .select({
        id: domesticOrders.id,
        version: domesticOrders.version,
        repairCaseId: domesticOrders.repairCaseId,
        customerId: domesticOrders.customerId,
        quoteId: domesticOrders.quoteId,
        intakeNumberText: domesticOrders.intakeNumberText,
        displayOrder: domesticOrders.displayOrder,
        purchaseOrderNumber: domesticOrders.purchaseOrderNumber,
        projectName: domesticOrders.projectName,
        modelNameText: domesticOrders.modelNameText,
        lotNumberText: domesticOrders.lotNumberText,
        serialNumberText: domesticOrders.serialNumberText,
        orderIssuedDate: domesticOrders.orderIssuedDate,
        quoteIssuedDate: domesticOrders.quoteIssuedDate,
        quoteNumber: domesticOrders.quoteNumber,
        taxInvoiceDate: domesticOrders.taxInvoiceDate,
        amountExcludingVat: domesticOrders.amountExcludingVat,
        paymentCompleted: domesticOrders.paymentCompleted,
        completedAt: domesticOrders.completedAt,
        createdAt: domesticOrders.createdAt,
        isDeleted: domesticOrders.isDeleted,
        deletedAt: domesticOrders.deletedAt,
        deletedBy: domesticOrders.deletedBy,
        deleteReason: domesticOrders.deleteReason,
      })
      .from(domesticOrders)
      .where(eq(domesticOrders.id, id))
      .for("update");

    if (!current) return "SKIPPED_ALREADY_GONE";
    if (!current.isDeleted || !current.deletedAt) return "SKIPPED_RESTORED";
    if (!getMasterDataTrashRetentionStatus(current.deletedAt.toISOString(), now).isExpired) {
      return "SKIPPED_NOT_ELIGIBLE";
    }

    const [dueDates] = await tx
      .select({ total: sql<number>`count(*)::int` })
      .from(domesticOrderDueDates)
      .where(eq(domesticOrderDueDates.domesticOrderId, id));

    // 납기요청일은 FK 의 ON DELETE CASCADE 가 함께 지운다.
    await tx.delete(domesticOrders).where(eq(domesticOrders.id, id));

    await insertAuditLog(tx, {
      actorUserId: null,
      actionType: "PURGE",
      targetEntity: "domestic_orders",
      targetRecordId: id,
      previousValue: {
        ...current,
        completedAt: current.completedAt ? current.completedAt.toISOString() : null,
        createdAt: current.createdAt.toISOString(),
        deletedAt: current.deletedAt.toISOString(),
        purgedDueDateCount: dueDates.total,
      },
      newValue: null,
    });

    return "PURGED";
  });
}

/** 다른 마스터와 같은 규칙 — 읽기 전용이고, 판정은 각자의 트랜잭션에서 다시 한다. */
export async function listPurgeEligibleDomesticOrderIds(now: Date = new Date()): Promise<string[]> {
  const rows = await db
    .select({ id: domesticOrders.id, deletedAt: domesticOrders.deletedAt })
    .from(domesticOrders)
    .where(eq(domesticOrders.isDeleted, true));

  return rows
    .filter(
      (row) => row.deletedAt !== null && getMasterDataTrashRetentionStatus(row.deletedAt.toISOString(), now).isExpired
    )
    .map((row) => row.id);
}

export type PurgeQuoteOutcome = PurgeCustomerOutcome;

/**
 * 견적서 한 장, 트랜잭션 하나(2026-09-11). 다른 마스터와 판정 순서·결과 종류가
 * 같다 — 다만 **SKIPPED_REFERENCED 는 나오지 않는다.** quotes 를 가리키는 표
 * 넷 중 셋(quote_items · quote_work_scope_lines · quote_repair_tasks)은 ON DELETE
 * CASCADE 이고, 남은 하나(domestic_orders.quote_id)는 SET NULL 이라 무엇도 이
 * 장의 삭제를 막지 않는다. 내자 정리 줄은 남고 연결만 풀린다.
 *
 * 사람이 휴지통에서 누르는 완전 삭제(quote-trash.ts 의 permanentlyDeleteQuote)와
 * 같은 일을 시스템이 한다. 그 파일은 "server-only"라 부를 수 없어서 순서와 감사
 * 스냅숏을 여기 다시 적는다(이 파일 머리말). 스냅숏의 칸도 그쪽과 같다 — 품명·
 * 신고증상·유효기간·납기·결재조건·고객사 이름 글자, 그리고 부품 줄·작업 내역·
 * 수리 작업의 글자는 고르지 않는다. 사람이 자유롭게 적는 칸이다.
 */
export async function purgeExpiredQuote(id: string, now: Date = new Date()): Promise<PurgeQuoteOutcome> {
  return await db.transaction(async (tx) => {
    const [current] = await tx
      .select({
        id: quotes.id,
        version: quotes.version,
        quoteNumber: quotes.quoteNumber,
        kind: quotes.kind,
        quoteDate: quotes.quoteDate,
        repairCaseId: quotes.repairCaseId,
        customerId: quotes.customerId,
        intakeNumberText: quotes.intakeNumberText,
        modelNameText: quotes.modelNameText,
        lotNumberText: quotes.lotNumberText,
        serialNumberText: quotes.serialNumberText,
        workCost: quotes.workCost,
        laborEquipmentKind: quotes.laborEquipmentKind,
        laborBaseCost: quotes.laborBaseCost,
        powerTestExcluded: quotes.powerTestExcluded,
        laborPowerTestDeduction: quotes.laborPowerTestDeduction,
        createdAt: quotes.createdAt,
        isDeleted: quotes.isDeleted,
        deletedAt: quotes.deletedAt,
        deletedBy: quotes.deletedBy,
        deleteReason: quotes.deleteReason,
      })
      .from(quotes)
      .where(eq(quotes.id, id))
      .for("update");

    if (!current) return "SKIPPED_ALREADY_GONE";
    if (!current.isDeleted || !current.deletedAt) return "SKIPPED_RESTORED";
    if (!getMasterDataTrashRetentionStatus(current.deletedAt.toISOString(), now).isExpired) {
      return "SKIPPED_NOT_ELIGIBLE";
    }

    const items = await tx
      .select({ quantity: quoteItems.quantity, unitPrice: quoteItems.unitPrice })
      .from(quoteItems)
      .where(eq(quoteItems.quoteId, id));
    const [scopeLines] = await tx
      .select({ total: sql<number>`count(*)::int` })
      .from(quoteWorkScopeLines)
      .where(eq(quoteWorkScopeLines.quoteId, id));
    const [repairTasks] = await tx
      .select({ total: sql<number>`count(*)::int` })
      .from(quoteRepairTasks)
      .where(eq(quoteRepairTasks.quoteId, id));
    const linkedOrders = await tx
      .select({ id: domesticOrders.id })
      .from(domesticOrders)
      .where(eq(domesticOrders.quoteId, id));

    // 부품 줄·작업 내역·수리 작업은 FK 의 ON DELETE CASCADE 가, 내자 정리 줄의
    // 연결은 ON DELETE SET NULL 이 처리한다.
    await tx.delete(quotes).where(eq(quotes.id, id));

    await insertAuditLog(tx, {
      actorUserId: null,
      actionType: "PURGE",
      targetEntity: "quotes",
      targetRecordId: id,
      previousValue: {
        ...current,
        createdAt: current.createdAt.toISOString(),
        deletedAt: current.deletedAt.toISOString(),
        supplyAmount: sumQuoteSupplyAmount(items, current.workCost).toFixed(2),
        purgedItemCount: items.length,
        purgedWorkScopeLineCount: scopeLines.total,
        purgedRepairTaskCount: repairTasks.total,
        unlinkedDomesticOrderIds: linkedOrders.map((order) => order.id),
      },
      newValue: null,
    });

    return "PURGED";
  });
}

/** 다른 마스터와 같은 규칙 — 읽기 전용이고, 판정은 각자의 트랜잭션에서 다시 한다. */
export async function listPurgeEligibleQuoteIds(now: Date = new Date()): Promise<string[]> {
  const rows = await db
    .select({ id: quotes.id, deletedAt: quotes.deletedAt })
    .from(quotes)
    .where(eq(quotes.isDeleted, true));

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
  domesticOrders: MasterDataPurgeEntitySummary;
  quotes: MasterDataPurgeEntitySummary;
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
 *
 * ── 내자 정리는 고객사보다 **먼저** 돈다(2026-09-11) ─────────────────────
 * 이쪽은 순서가 뜻을 갖는다. domestic_orders.customer_id 는 customers 를
 * RESTRICT 로 가리키므로, 만료된 내자 줄이 남아 있는 채로 같은 고객사를 먼저
 * 지우려 하면 그 고객사는 FK 오류로 이번 회차에서 실패한다. 내자 줄을 먼저
 * 비우면 둘 다 만료된 경우 한 회차에 함께 정리된다. (활성 내자 줄이 걸린
 * 고객사는 여전히 실패한다 — 그 검사는 고객사 쪽에 없고, 이 변경의 범위가
 * 아니다.)
 *
 * ── 견적서는 내자 정리 다음, 고객사·부품보다 **먼저** 돈다(2026-09-11) ────
 * 같은 이유다. quotes.customer_id 는 customers 를, quote_items.part_id 는
 * parts 를 RESTRICT 로 가리킨다 — 만료된 견적서가 남은 채로 같은 고객사나 부품을
 * 먼저 지우려 하면 그쪽이 FK 오류로 이번 회차에서 실패한다. 견적서를 먼저 비우면
 * 한 회차에 함께 정리된다. 내자 정리와의 순서는 뜻이 없다(domestic_orders.
 * quote_id 는 SET NULL 이라 어느 쪽이 먼저여도 막히지 않는다) — 내자 줄을 먼저
 * 지우면 견적서를 지울 때 풀어 줄 연결이 줄어들 뿐이다. (활성 견적서가 걸린
 * 고객사·부품은 여전히 실패한다 — 그 검사는 그쪽에 없고, 이 변경의 범위가
 * 아니다.)
 */
export async function runMasterDataPurgeSweep(now: Date = new Date()): Promise<MasterDataPurgeSweepSummary> {
  const domesticOrderSummary = await sweepEntity(
    await listPurgeEligibleDomesticOrderIds(now),
    purgeExpiredDomesticOrder,
    now
  );
  const quoteSummary = await sweepEntity(await listPurgeEligibleQuoteIds(now), purgeExpiredQuote, now);
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
    domesticOrders: domesticOrderSummary,
    quotes: quoteSummary,
  };
}
