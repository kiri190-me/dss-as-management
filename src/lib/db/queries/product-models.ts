import "server-only";
import { and, desc, eq, inArray, notInArray } from "drizzle-orm";
import { db } from "../client";
import {
  inventoryPartRequestItems,
  inventoryPartRequests,
  parts,
  productModels,
  products,
  repairCases,
  users,
} from "../schema";
import type { RequestedPartRow } from "@/lib/domain/product-model-breakdown";
import type { ProductModelKind } from "@/lib/validation/product-model-input";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ProductModelListRow = {
  id: string;
  modelName: string;
  kind: ProductModelKind | null;
  manufacturer: string | null;
  unitCount: number;
  repairCaseCount: number;
  lastReceivedAt: string | null;
  /** 삭제 시 낙관적 동시성 검사에 쓴다(product_models에는 version 컬럼이 없다). */
  updatedAt: string;
};

/**
 * Product Model Master conversion — this now sources from `product_models`
 * (the real canonical table, migration 0030), and every count/link below
 * follows `products.product_model_id`, never `model_name` string matching.
 * A model with zero linked units still appears (0/0/null), since the
 * iteration base is `product_models` itself, not derived from `products`.
 *
 * Computed in plain JS over three small SELECTs (same "small dataset, no
 * join-fanout risk" precedent as before) rather than a grouped SQL
 * aggregate.
 */
export async function listProductModels(): Promise<ProductModelListRow[]> {
  const [modelRows, productRows, caseRows] = await Promise.all([
    db
      .select({
        id: productModels.id,
        modelName: productModels.modelName,
        kind: productModels.kind,
        manufacturer: productModels.manufacturer,
        updatedAt: productModels.updatedAt,
      })
      .from(productModels)
      .where(eq(productModels.isDeleted, false))
      .orderBy(productModels.modelName),
    db
      .select({ id: products.id, productModelId: products.productModelId })
      .from(products)
      .where(eq(products.isDeleted, false)),
    db
      .select({ productId: repairCases.productId, receivedAt: repairCases.receivedAt })
      .from(repairCases)
      .where(eq(repairCases.isDeleted, false)),
  ]);

  const productIdToModelId = new Map<string, string>();
  const unitCounts = new Map<string, number>();
  for (const p of productRows) {
    // Unlinked products (product_model_id still NULL — e.g. any unit
    // created after this migration by the still-unchanged resolveProduct()
    // flow) simply don't count toward any model yet, by design.
    if (!p.productModelId) continue;
    productIdToModelId.set(p.id, p.productModelId);
    unitCounts.set(p.productModelId, (unitCounts.get(p.productModelId) ?? 0) + 1);
  }

  const repairCaseCounts = new Map<string, number>();
  const lastReceivedAt = new Map<string, string>();
  for (const c of caseRows) {
    const modelId = productIdToModelId.get(c.productId);
    if (!modelId) continue;
    repairCaseCounts.set(modelId, (repairCaseCounts.get(modelId) ?? 0) + 1);
    const prevMax = lastReceivedAt.get(modelId);
    if (!prevMax || c.receivedAt > prevMax) {
      lastReceivedAt.set(modelId, c.receivedAt);
    }
  }

  return modelRows.map((m) => ({
    id: m.id,
    modelName: m.modelName,
    kind: m.kind,
    manufacturer: m.manufacturer,
    unitCount: unitCounts.get(m.id) ?? 0,
    repairCaseCount: repairCaseCounts.get(m.id) ?? 0,
    lastReceivedAt: lastReceivedAt.get(m.id) ?? null,
    updatedAt: m.updatedAt.toISOString(),
  }));
}

export type ProductModelDetail = {
  id: string;
  modelName: string;
  kind: ProductModelKind | null;
  manufacturer: string | null;
  description: string | null;
  createdAt: string;
  updatedAt: string;
  unitCount: number;
  repairCaseCount: number;
  repeatRepairUnitCount: number;
  currentlyInRepairCount: number;
  /** null when zero completed (shipped) cases exist yet — never fabricated as 0. */
  averageRepairDurationDays: number | null;
  units: ProductModelUnitRow[];
};

export type ProductModelUnitRow = {
  id: string;
  serialNumber: string | null;
  lotNumber: string | null;
  repairCaseCount: number;
  latestReceivedAt: string | null;
};

/**
 * Detail for one product_models.id. Every unit/history figure below is
 * derived from `products.product_model_id = id`, never from a model_name
 * string comparison — a later master rename (updateProductModelAction)
 * never breaks this linkage.
 */
export async function getProductModelDetailById(id: string): Promise<ProductModelDetail | null> {
  if (!UUID_PATTERN.test(id)) return null;

  const [model] = await db
    .select()
    .from(productModels)
    .where(and(eq(productModels.id, id), eq(productModels.isDeleted, false)));
  if (!model) return null;

  const productRows = await db
    .select({ id: products.id, serialNumber: products.serialNumber, lotNumber: products.lotNumber })
    .from(products)
    .where(and(eq(products.productModelId, id), eq(products.isDeleted, false)));

  const productIds = productRows.map((p) => p.id);
  const caseRows =
    productIds.length === 0
      ? []
      : await db
          .select({
            productId: repairCases.productId,
            receivedAt: repairCases.receivedAt,
            actualShipmentDate: repairCases.actualShipmentDate,
          })
          .from(repairCases)
          .where(and(eq(repairCases.isDeleted, false), inArray(repairCases.productId, productIds)));

  const caseCountByProductId = new Map<string, number>();
  const latestReceivedByProductId = new Map<string, string>();
  for (const c of caseRows) {
    caseCountByProductId.set(c.productId, (caseCountByProductId.get(c.productId) ?? 0) + 1);
    const prevMax = latestReceivedByProductId.get(c.productId);
    if (!prevMax || c.receivedAt > prevMax) {
      latestReceivedByProductId.set(c.productId, c.receivedAt);
    }
  }

  const units = productRows
    .map((p) => ({
      id: p.id,
      serialNumber: p.serialNumber,
      lotNumber: p.lotNumber,
      repairCaseCount: caseCountByProductId.get(p.id) ?? 0,
      latestReceivedAt: latestReceivedByProductId.get(p.id) ?? null,
    }))
    .sort((a, b) => (a.serialNumber ?? "").localeCompare(b.serialNumber ?? ""));

  const repeatRepairUnitCount = units.filter((u) => u.repairCaseCount > 1).length;

  // "Currently in repair" vs "completed" proxy: actual_shipment_date is set
  // exactly (and only) when a case's SHIPMENT_COMPLETED workflow action
  // fires (workflow-transitions.ts), and nothing ever clears it afterward
  // — so `actualShipmentDate IS NOT NULL` reliably means "shipment
  // completed" for every DATABASE-source case here, without needing to
  // also join workflow_steps/workflow_versions/workflow_templates just to
  // re-derive the same fact via deriveRepairStatus.
  const currentlyInRepairCount = caseRows.filter((c) => !c.actualShipmentDate).length;

  const completedDurationsDays: number[] = [];
  for (const c of caseRows) {
    if (!c.actualShipmentDate) continue;
    const receivedMs = new Date(c.receivedAt).getTime();
    const shippedMs = new Date(c.actualShipmentDate).getTime();
    if (Number.isNaN(receivedMs) || Number.isNaN(shippedMs)) continue;
    completedDurationsDays.push((shippedMs - receivedMs) / (24 * 60 * 60 * 1000));
  }
  const averageRepairDurationDays =
    completedDurationsDays.length > 0
      ? completedDurationsDays.reduce((sum, d) => sum + d, 0) / completedDurationsDays.length
      : null;

  return {
    id: model.id,
    modelName: model.modelName,
    kind: model.kind,
    manufacturer: model.manufacturer,
    description: model.description,
    createdAt: model.createdAt.toISOString(),
    updatedAt: model.updatedAt.toISOString(),
    unitCount: productRows.length,
    repairCaseCount: caseRows.length,
    repeatRepairUnitCount,
    currentlyInRepairCount,
    averageRepairDurationDays,
    units,
  };
}

/**
 * 이 요청 상태의 줄은 **세지 않는다** — 물건이 나가지 않은(그리고 앞으로도 나가지
 * 않을) 요청이라, 고장 부품 그래프에 넣으면 "이 모델에서 이 부품이 문제였다"는
 * 읽음이 거짓이 된다.
 *
 * 나머지 다섯(PENDING · PARTIALLY_ISSUED · FULLY_ISSUED · PARTIALLY_CLOSED ·
 * ON_HOLD)은 센다. PENDING·ON_HOLD 는 아직 안 나갔지만 **엔지니어가 그 부품을
 * 지목했다**는 사실 자체가 이 그래프가 묻는 것이고, ON_HOLD 는 종료 상태도 아니다
 * (inventory-part-requests.ts 의 enum 주석).
 */
const UNCOUNTED_PART_REQUEST_STATUSES = ["REJECTED", "CANCELLED"] as const;

/**
 * 이 모델의 접수 건들에 대해 **요청된 부품** 줄. 제품 모델 상세의 `고장 부품`
 * 원형 그래프가 쓰는 유일한 재료다.
 *
 * ── 왜 부품 요청인가 ────────────────────────────────────────────────────
 * 이 시스템에는 "이 건에서 뭐가 고장났나"를 적는 칸이 **없다**. 가장 가까운 것이
 * 수리하며 요청한 부품이라 그것을 쓴다. 그래서 이 목록은 접수 건마다 한 줄이
 * 아니고 — 한 건이 여러 줄일 수도, 아예 없을 수도 있다. 화면이 그 사실을 원 밑에
 * 한 줄로 적는다(product-model-breakdown.ts 헤더).
 *
 * ── 무엇을 한 줄로 세는가 ───────────────────────────────────────────────
 * **요청 줄(inventory_part_request_items) 하나가 한 개**다. 수량(requested_quantity)
 * 은 보지 않는다 — 이 그래프가 묻는 것은 "어느 부품이 몇 번 지목되었나"이지 "몇
 * 개가 나갔나"가 아니고, 후자는 재고 원장(stock_transactions)이 답할 질문이다.
 *
 * 접수 건 id 를 함께 돌려주는 이유는 화면이 **요청 기록이 있는 건 수**를 셀 수
 * 있어야 하기 때문이다(부품 개수와 다른 것이 정상이고, 화면은 둘을 나란히 적는다).
 *
 * 삭제된 부품(parts.is_deleted)도 그대로 센다 — 부품 대장에서 지운 것은 "앞으로 쓸
 * 수 있는 목록"에서 뺀 것이지 **그때 그 부품을 요청했다는 과거**가 없어진 것이
 * 아니다.
 *
 * 읽기 전용이다. 이 파일의 다른 함수들과 같이 권한을 보지 않는다 — 페이지가
 * 판정한다.
 */
export async function listRequestedPartsByProductModelId(
  productModelId: string
): Promise<RequestedPartRow[]> {
  if (!UUID_PATTERN.test(productModelId)) return [];

  const rows = await db
    .select({
      repairCaseId: repairCases.id,
      partName: parts.partName,
    })
    .from(inventoryPartRequestItems)
    .innerJoin(
      inventoryPartRequests,
      eq(inventoryPartRequestItems.requestId, inventoryPartRequests.id)
    )
    // repair_case_id 는 nullable 이다(접수 건 완전삭제 대비 ON DELETE SET NULL).
    // inner join 이라 끊긴 요청은 저절로 빠진다 — 어느 모델의 것인지 알 수 없는
    // 줄을 이 모델의 그래프에 넣을 수는 없다.
    .innerJoin(repairCases, eq(inventoryPartRequests.repairCaseId, repairCases.id))
    .innerJoin(products, eq(repairCases.productId, products.id))
    .innerJoin(parts, eq(inventoryPartRequestItems.partId, parts.id))
    .where(
      and(
        eq(products.productModelId, productModelId),
        eq(products.isDeleted, false),
        eq(repairCases.isDeleted, false),
        notInArray(inventoryPartRequests.status, [...UNCOUNTED_PART_REQUEST_STATUSES])
      )
    )
    // 조각 차례는 도메인이 정하지만, 같은 입력에 같은 배열이 나오도록 여기서도
    // 한 번 못 박아 둔다 — 정렬 없는 조회는 계획이 바뀌면 순서가 바뀐다.
    .orderBy(parts.partName, repairCases.id);

  return rows;
}

export type DeletedProductModelRow = {
  id: string;
  modelName: string;
  kind: ProductModelKind | null;
  manufacturer: string | null;
  /** 복원·완전삭제의 낙관적 동시성 검사값(고객사 휴지통과 같은 방식). */
  updatedAt: string;
  deletedAt: string;
  deletedByUserName: string | null;
  deleteReason: string | null;
  /** 이 모델과 함께 딸려 간 등록 장비 수. 복원하면 이만큼이 같이 돌아온다. */
  unitCount: number;
};

/**
 * 제품 모델 관리 휴지통 목록. 삭제 권한이 있는 세션에서만 호출된다 —
 * 페이지가 그것을 판정하고, 이 함수는 권한을 보지 않는다
 * (listDeletedCustomers와 같은 역할 분담).
 *
 * unitCount는 "이 모델에 딸린, 삭제된 장비 수"다. 고객사 휴지통의
 * endUserCount와 같은 셈법이고, 같은 한계를 갖는다 — 모델 삭제 이전에 따로
 * 지워져 있던 장비도 함께 세어지지만 복원은 그런 행을 되살리지 않는다.
 */
export async function listDeletedProductModels(): Promise<DeletedProductModelRow[]> {
  const [modelRows, deletedProductRows] = await Promise.all([
    db
      .select({
        id: productModels.id,
        modelName: productModels.modelName,
        kind: productModels.kind,
        manufacturer: productModels.manufacturer,
        updatedAt: productModels.updatedAt,
        deletedAt: productModels.deletedAt,
        deleteReason: productModels.deleteReason,
        deletedByUserName: users.name,
      })
      .from(productModels)
      // leftJoin이어야 한다 — deleted_by는 nullable이고, inner join이면
      // 삭제자를 알 수 없는 행이 휴지통에서 통째로 사라진다.
      .leftJoin(users, eq(productModels.deletedBy, users.id))
      .where(eq(productModels.isDeleted, true))
      .orderBy(desc(productModels.deletedAt)),
    db
      .select({ productModelId: products.productModelId })
      .from(products)
      .where(eq(products.isDeleted, true)),
  ]);

  const unitCounts = new Map<string, number>();
  for (const row of deletedProductRows) {
    if (!row.productModelId) continue;
    unitCounts.set(row.productModelId, (unitCounts.get(row.productModelId) ?? 0) + 1);
  }

  return modelRows.map((row) => ({
    id: row.id,
    modelName: row.modelName,
    kind: row.kind,
    manufacturer: row.manufacturer,
    updatedAt: row.updatedAt.toISOString(),
    // is_deleted = true인 행만 여기 온다. softDeleteProductModel은 같은
    // UPDATE에서 deleted_at을 반드시 채운다(listDeletedCustomers와 같은 근거).
    deletedAt: row.deletedAt!.toISOString(),
    deletedByUserName: row.deletedByUserName,
    deleteReason: row.deleteReason,
    unitCount: unitCounts.get(row.id) ?? 0,
  }));
}
