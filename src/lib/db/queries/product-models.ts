import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../client";
import { productModels, products, repairCases } from "../schema";
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
