import "server-only";

import { and, eq, ne, sql } from "drizzle-orm";
import { db } from "../client";
import {
  ohPartTemplateItems,
  ohPartTemplateModels,
  ohPartTemplates,
  parts,
  productModels,
} from "../schema";
import { insertAuditLog } from "./audit-logs";
import type { OhTemplateFields } from "@/lib/validation/oh-part-template-input";

/**
 * ============================================================================
 * O/H 부품 템플릿 — 만들고 고치고 모델을 잇는다
 * ============================================================================
 * mutations/quotes.ts 와 같은 구조다. 이 계층은 **기계**이고, 누가 고칠 수 있는지는
 * 서버 액션이 본다.
 *
 * ── 부품 줄은 통째로 갈아 끼운다 ────────────────────────────────────────
 * 폼이 목록을 통째로 편집하므로, 저장이 받는 것은 "이 템플릿의 부품은 지금부터
 * 이것이 전부"라는 말이다(quotes 의 replaceItems 와 같은 판단). 차례는 배열
 * index + 1 — **양식의 부품 순서가 그대로 뜻을 갖는다**(휴즈 22개가 셋째 줄인
 * 데는 이유가 있다).
 *
 * ── 모델 연결은 저장과 따로 움직인다 ────────────────────────────────────
 * 부품 목록을 고치는 일과 모델을 잇는 일은 사람에게 다른 행동이고, 한 번의
 * 저장으로 묶으면 "모델 하나 붙이려다 부품 목록까지 통째로 다시 보내는" 모양이
 * 된다. 그래서 linkProductModel / unlinkProductModel 이 따로 있다.
 *
 * 모델 하나는 템플릿 하나에만 붙는다(스키마의 unique). 이미 다른 템플릿에
 * 붙어 있으면 **거절하고 어디 붙어 있는지 알려 준다** — 조용히 옮기면 그
 * 템플릿을 쓰던 사람이 이유를 모른 채 다른 부품을 받게 된다.
 * ============================================================================
 */

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type OhTemplateResultCode = "NOT_FOUND" | "CONFLICT" | "VALIDATION_ERROR";

export type OhTemplateResult =
  | { ok: true; id: string; version: number }
  | { ok: false; code: OhTemplateResultCode; fieldErrors?: Record<string, string>; message: string };

const CONFLICT_MESSAGE =
  "다른 사용자가 이 템플릿을 먼저 수정했습니다. 최신 정보를 다시 불러온 뒤 시도해 주세요.";
const NOT_FOUND_MESSAGE = "해당 템플릿을 찾을 수 없습니다.";

function duplicateCode(code: string): OhTemplateResult {
  const message = `기종 코드 ${code} 를 쓰는 템플릿이 이미 있습니다.`;
  return { ok: false, code: "VALIDATION_ERROR", fieldErrors: { code: message }, message };
}

/** 살아 있는 템플릿 중 같은 코드가 있는가. 지운 코드는 다시 쓸 수 있다(부분 unique). */
async function codeTaken(tx: Tx, code: string, excludeId?: string): Promise<boolean> {
  const conditions = [eq(ohPartTemplates.code, code), eq(ohPartTemplates.isDeleted, false)];
  if (excludeId) conditions.push(ne(ohPartTemplates.id, excludeId));
  const [row] = await tx.select({ id: ohPartTemplates.id }).from(ohPartTemplates).where(and(...conditions)).limit(1);
  return Boolean(row);
}

/** 고른 재고 부품이 실제로 있는가. FK 오류는 사용자에게 아무것도 설명하지 못한다. */
async function checkParts(tx: Tx, fields: OhTemplateFields): Promise<OhTemplateResult | null> {
  for (const [index, item] of fields.items.entries()) {
    if (!item.partId) continue;
    const [row] = await tx.select({ id: parts.id }).from(parts).where(eq(parts.id, item.partId)).limit(1);
    if (!row) {
      return {
        ok: false,
        code: "VALIDATION_ERROR",
        fieldErrors: { [`items.${index}.partId`]: `${index + 1}번째 부품을 재고에서 찾을 수 없습니다.` },
        message: "입력값을 확인해 주세요.",
      };
    }
  }
  return null;
}

async function replaceItems(tx: Tx, templateId: string, fields: OhTemplateFields) {
  await tx.delete(ohPartTemplateItems).where(eq(ohPartTemplateItems.templateId, templateId));
  if (fields.items.length === 0) return;
  await tx.insert(ohPartTemplateItems).values(
    fields.items.map((item, index) => ({
      templateId,
      displayOrder: index + 1,
      partId: item.partId,
      partNameText: item.partNameText,
      quantity: item.quantity,
    }))
  );
}

export async function createOhTemplate(params: {
  fields: OhTemplateFields;
  actorUserId: string;
}): Promise<OhTemplateResult> {
  return db.transaction(async (tx): Promise<OhTemplateResult> => {
    const bad = await checkParts(tx, params.fields);
    if (bad) return bad;
    if (await codeTaken(tx, params.fields.code)) return duplicateCode(params.fields.code);

    const [created] = await tx
      .insert(ohPartTemplates)
      .values({
        code: params.fields.code,
        name: params.fields.name,
        note: params.fields.note,
        createdBy: params.actorUserId,
        updatedBy: params.actorUserId,
      })
      .returning({ id: ohPartTemplates.id, version: ohPartTemplates.version });

    await replaceItems(tx, created.id, params.fields);
    await insertAuditLog(tx, {
      actorUserId: params.actorUserId,
      actionType: "CREATE",
      targetEntity: "oh_part_templates",
      targetRecordId: created.id,
      newValue: { code: params.fields.code, name: params.fields.name, itemCount: params.fields.items.length },
    });

    return { ok: true, id: created.id, version: created.version };
  });
}

export async function updateOhTemplate(params: {
  id: string;
  expectedVersion: number;
  fields: OhTemplateFields;
  actorUserId: string;
}): Promise<OhTemplateResult> {
  return db.transaction(async (tx): Promise<OhTemplateResult> => {
    const [existing] = await tx
      .select({ id: ohPartTemplates.id, version: ohPartTemplates.version, isDeleted: ohPartTemplates.isDeleted })
      .from(ohPartTemplates)
      .where(eq(ohPartTemplates.id, params.id))
      .limit(1)
      .for("update");

    if (!existing || existing.isDeleted) return { ok: false, code: "NOT_FOUND", message: NOT_FOUND_MESSAGE };
    if (existing.version !== params.expectedVersion) {
      return { ok: false, code: "CONFLICT", message: CONFLICT_MESSAGE };
    }

    const bad = await checkParts(tx, params.fields);
    if (bad) return bad;
    if (await codeTaken(tx, params.fields.code, params.id)) return duplicateCode(params.fields.code);

    const [updated] = await tx
      .update(ohPartTemplates)
      .set({
        code: params.fields.code,
        name: params.fields.name,
        note: params.fields.note,
        version: sql`${ohPartTemplates.version} + 1`,
        updatedAt: new Date(),
        updatedBy: params.actorUserId,
      })
      .where(eq(ohPartTemplates.id, params.id))
      .returning({ id: ohPartTemplates.id, version: ohPartTemplates.version });

    // version 대조를 통과한 뒤에만 부품을 건드린다 — CONFLICT 로 끝난 저장이
    // 부품을 먼저 지워 버리면, 실패한 저장이 자료를 지우고 간 셈이 된다.
    await replaceItems(tx, params.id, params.fields);
    await insertAuditLog(tx, {
      actorUserId: params.actorUserId,
      actionType: "UPDATE",
      targetEntity: "oh_part_templates",
      targetRecordId: params.id,
      newValue: { code: params.fields.code, name: params.fields.name, itemCount: params.fields.items.length },
    });

    return { ok: true, id: updated.id, version: updated.version };
  });
}

export type OhLinkResult =
  | { ok: true }
  | { ok: false; code: "NOT_FOUND" | "ALREADY_LINKED"; message: string };

/**
 * 제품 모델을 템플릿에 잇는다. 이미 **다른** 템플릿에 붙어 있으면 거절한다 —
 * 조용히 옮기면 그 템플릿을 쓰던 사람이 이유를 모른 채 다른 부품을 받게 된다.
 */
export async function linkProductModel(params: {
  templateId: string;
  productModelId: string;
  actorUserId: string;
}): Promise<OhLinkResult> {
  return db.transaction(async (tx): Promise<OhLinkResult> => {
    const [template] = await tx
      .select({ id: ohPartTemplates.id })
      .from(ohPartTemplates)
      .where(and(eq(ohPartTemplates.id, params.templateId), eq(ohPartTemplates.isDeleted, false)))
      .limit(1);
    if (!template) return { ok: false, code: "NOT_FOUND", message: NOT_FOUND_MESSAGE };

    const [model] = await tx
      .select({ id: productModels.id, modelName: productModels.modelName })
      .from(productModels)
      .where(eq(productModels.id, params.productModelId))
      .limit(1);
    if (!model) return { ok: false, code: "NOT_FOUND", message: "해당 제품 모델을 찾을 수 없습니다." };

    const [clash] = await tx
      .select({ templateId: ohPartTemplateModels.templateId, code: ohPartTemplates.code })
      .from(ohPartTemplateModels)
      .innerJoin(ohPartTemplates, eq(ohPartTemplates.id, ohPartTemplateModels.templateId))
      .where(eq(ohPartTemplateModels.productModelId, params.productModelId))
      .limit(1);
    if (clash) {
      if (clash.templateId === params.templateId) return { ok: true };
      return {
        ok: false,
        code: "ALREADY_LINKED",
        message: `${model.modelName} 은(는) 이미 기종 ${clash.code} 템플릿에 연결되어 있습니다. 그쪽 연결을 먼저 푸세요.`,
      };
    }

    await tx.insert(ohPartTemplateModels).values({
      templateId: params.templateId,
      productModelId: params.productModelId,
      createdBy: params.actorUserId,
    });
    await insertAuditLog(tx, {
      actorUserId: params.actorUserId,
      actionType: "UPDATE",
      targetEntity: "oh_part_template_models",
      targetRecordId: params.templateId,
      newValue: { productModelId: params.productModelId, modelName: model.modelName, linked: true },
    });
    return { ok: true };
  });
}

export async function unlinkProductModel(params: {
  linkId: string;
  actorUserId: string;
}): Promise<OhLinkResult> {
  return db.transaction(async (tx): Promise<OhLinkResult> => {
    const [link] = await tx
      .select({ id: ohPartTemplateModels.id, templateId: ohPartTemplateModels.templateId, productModelId: ohPartTemplateModels.productModelId })
      .from(ohPartTemplateModels)
      .where(eq(ohPartTemplateModels.id, params.linkId))
      .limit(1);
    if (!link) return { ok: false, code: "NOT_FOUND", message: "해당 연결을 찾을 수 없습니다." };

    await tx.delete(ohPartTemplateModels).where(eq(ohPartTemplateModels.id, params.linkId));
    await insertAuditLog(tx, {
      actorUserId: params.actorUserId,
      actionType: "UPDATE",
      targetEntity: "oh_part_template_models",
      targetRecordId: link.templateId,
      previousValue: { productModelId: link.productModelId, linked: true },
      newValue: { productModelId: link.productModelId, linked: false },
    });
    return { ok: true };
  });
}
