import "server-only";

import { asc, eq, inArray } from "drizzle-orm";
import { db } from "../client";
import {
  ohPartTemplateItems,
  ohPartTemplateModels,
  ohPartTemplates,
  productModels,
  products,
  repairCases,
} from "../schema";

/**
 * ============================================================================
 * O/H 부품 템플릿 — 읽는 쪽
 * ============================================================================
 * **읽기 전용이다.** 만들고 고치는 일은 mutations/oh-part-templates.ts 가 맡는다.
 * ============================================================================
 */

export type OhTemplateItem = {
  id: string;
  displayOrder: number;
  /** 재고 마스터 연결. **null 이 정상이다** — 마스터에 없는 품목이 실제로 있다. */
  partId: string | null;
  partNameText: string;
  quantity: number;
};

export type OhTemplateRow = {
  id: string;
  version: number;
  code: string;
  name: string;
  note: string | null;
  items: OhTemplateItem[];
  /** 이 템플릿에 붙은 제품 모델들. 사람이 화면에서 잇는다. */
  models: { id: string; productModelId: string; modelName: string }[];
};

/** 살아 있는 템플릿 전부. 코드 순 — 사람이 `15 · 20 · 301 · 302` 로 기억한다. */
export async function listOhPartTemplates(): Promise<OhTemplateRow[]> {
  const rows = await db
    .select({
      id: ohPartTemplates.id,
      version: ohPartTemplates.version,
      code: ohPartTemplates.code,
      name: ohPartTemplates.name,
      note: ohPartTemplates.note,
    })
    .from(ohPartTemplates)
    .where(eq(ohPartTemplates.isDeleted, false))
    .orderBy(asc(ohPartTemplates.code));

  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.id);

  // 항목과 모델 연결을 **질의 두 번으로** 걷어 온다 — 템플릿마다 읽으면 N+1 이다.
  const [items, models] = await Promise.all([
    db
      .select({
        id: ohPartTemplateItems.id,
        templateId: ohPartTemplateItems.templateId,
        displayOrder: ohPartTemplateItems.displayOrder,
        partId: ohPartTemplateItems.partId,
        partNameText: ohPartTemplateItems.partNameText,
        quantity: ohPartTemplateItems.quantity,
      })
      .from(ohPartTemplateItems)
      .where(inArray(ohPartTemplateItems.templateId, ids))
      .orderBy(asc(ohPartTemplateItems.displayOrder)),
    db
      .select({
        id: ohPartTemplateModels.id,
        templateId: ohPartTemplateModels.templateId,
        productModelId: ohPartTemplateModels.productModelId,
        modelName: productModels.modelName,
      })
      .from(ohPartTemplateModels)
      .innerJoin(productModels, eq(productModels.id, ohPartTemplateModels.productModelId))
      .where(inArray(ohPartTemplateModels.templateId, ids))
      .orderBy(asc(productModels.modelName)),
  ]);

  return rows.map((row) => ({
    ...row,
    items: items
      .filter((item) => item.templateId === row.id)
      .map((item) => ({
        id: item.id,
        displayOrder: item.displayOrder,
        partId: item.partId,
        partNameText: item.partNameText,
        quantity: item.quantity,
      })),
    models: models
      .filter((model) => model.templateId === row.id)
      .map((model) => ({ id: model.id, productModelId: model.productModelId, modelName: model.modelName })),
  }));
}

/**
 * 이 접수 건의 제품 모델에 붙은 템플릿. 없으면 null 이다.
 *
 * 부품 요청 화면이 "이 장비의 O/H 부품 담기"를 그릴지 정할 때 쓴다 — 모델이
 * 이어져 있지 않으면 담을 것이 없으므로 단추를 그리지 않는다.
 *
 * 모델 하나는 템플릿 하나에만 붙으므로(스키마의 unique) 결과가 여럿일 수 없다.
 */
export async function findOhTemplateForRepairCase(repairCaseId: string): Promise<OhTemplateRow | null> {
  const [link] = await db
    .select({ templateId: ohPartTemplateModels.templateId })
    .from(repairCases)
    .innerJoin(products, eq(products.id, repairCases.productId))
    .innerJoin(productModels, eq(productModels.id, products.productModelId))
    .innerJoin(ohPartTemplateModels, eq(ohPartTemplateModels.productModelId, productModels.id))
    .where(eq(repairCases.id, repairCaseId))
    .limit(1);

  if (!link) return null;
  const all = await listOhPartTemplates();
  return all.find((template) => template.id === link.templateId) ?? null;
}

/** 템플릿에 아직 안 붙은 제품 모델들 — 연결 드롭다운이 쓴다. */
export async function listUnlinkedProductModels(): Promise<{ id: string; modelName: string }[]> {
  const linked = await db
    .select({ productModelId: ohPartTemplateModels.productModelId })
    .from(ohPartTemplateModels);
  const linkedIds = new Set(linked.map((row) => row.productModelId));

  const models = await db
    .select({ id: productModels.id, modelName: productModels.modelName })
    .from(productModels)
    .where(eq(productModels.isDeleted, false))
    .orderBy(asc(productModels.modelName));

  return models.filter((model) => !linkedIds.has(model.id));
}
