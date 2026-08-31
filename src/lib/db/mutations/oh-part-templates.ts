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
import { applyOverhaulUnitPricesInTx } from "./part-overhaul-unit-prices";
import type { OhTemplateFields } from "@/lib/validation/oh-part-template-input";
import type { PartOverhaulUnitPriceEntry } from "@/lib/validation/part-overhaul-unit-price-input";

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
 *
 * ── 🔴 부품별 O/H 단가도 **같은 트랜잭션에서** 저장한다 ──────────────────
 * 화면이 부품 목록 · 이 기종의 O/H 작업비 · 부품별 O/H 단가를 한 표에서 한
 * 단추로 저장한다. 앞의 둘은 이 표에, 단가는 part_overhaul_unit_prices 에 사는데,
 * 트랜잭션을 따로 열면 "부품 목록은 저장됐는데 단가는 안 된" 반쪽 상태가 생긴다.
 * 게다가 이 저장은 version 을 올리므로 **실패한 저장이 버전만 올려놓고 끝난다** —
 * 그러면 화면은 다음 저장에서 이유 없이 CONFLICT 를 만난다.
 *
 * 그래서 단가 쪽의 applyOverhaulUnitPricesInTx 를 이 트랜잭션 안에서 부른다.
 * 잠금 순서와 "없는 부품이 섞이면 통째로 거절" 규칙은 그 함수 한 곳에만 있다.
 * 권한이 같아서(`inventory.parts` WRITE) 여기서 따로 판정할 것도 없다.
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

/**
 * 🔴 거절을 **트랜잭션 밖으로 던지기** 위한 신호.
 *
 * 콜백에서 그냥 `return` 하면 트랜잭션이 **커밋된다.** 이 파일의 옛 거절들은
 * 전부 아무것도 쓰기 전에 반환하므로 빈 트랜잭션이 커밋될 뿐 무해했다. 그러나
 * 단가 저장은 템플릿을 이미 고친 뒤에 돌기 때문에, 거기서 반환하면 **템플릿만
 * 저장되고 단가는 빠진 채 커밋된다** — 한 트랜잭션으로 묶은 이유가 통째로
 * 무너진다. 그래서 그 자리에서는 던진다.
 * (part-overhaul-unit-prices.ts 의 SaveRejected 와 같은 장치다.)
 */
class TemplateRejected extends Error {
  constructor(readonly result: Extract<OhTemplateResult, { ok: false }>) {
    super(result.message);
    this.name = "TemplateRejected";
  }
}

/** 트랜잭션 밖에서 거절 신호를 결과로 되돌린다. 다른 오류는 그대로 올려보낸다. */
function unwrapRejection(err: unknown): OhTemplateResult {
  if (err instanceof TemplateRejected) return err.result;
  throw err;
}

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
  /**
   * 부품별 O/H 단가. 이 트랜잭션 안에서 함께 저장된다(파일 머리말).
   * **보내지 않으면 단가를 아예 건드리지 않는다** — 빈 배열과 같은 결과지만,
   * 뜻이 다르므로 부르는 쪽이 구분해서 보낼 수 있게 둔다.
   */
  overhaulUnitPriceEntries?: PartOverhaulUnitPriceEntry[];
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

    // 단가는 부품에 붙는 값이라 템플릿을 만든 뒤에 넣어도 순서가 어긋나지 않는다.
    // 감사 기록은 그 함수가 부품마다 따로 남긴다 — 여기서 겹쳐 남기지 않는다.
    const prices = await applyOverhaulUnitPricesInTx(tx, {
      entries: params.overhaulUnitPriceEntries ?? [],
      actorUserId: params.actorUserId,
    });
    // 🔴 반환이 아니라 **던진다** — 여기서 반환하면 위의 쓰기가 커밋된다
    // (TemplateRejected 주석).
    if (!prices.ok) throw new TemplateRejected({ ok: false, code: "NOT_FOUND", message: prices.message });

    await insertAuditLog(tx, {
      actorUserId: params.actorUserId,
      actionType: "CREATE",
      targetEntity: "oh_part_templates",
      targetRecordId: created.id,
      newValue: {
        code: params.fields.code,
        name: params.fields.name,
        itemCount: params.fields.items.length,
      },
    });

    return { ok: true, id: created.id, version: created.version };
  }).catch(unwrapRejection);
}

export async function updateOhTemplate(params: {
  id: string;
  expectedVersion: number;
  fields: OhTemplateFields;
  /** 부품별 O/H 단가. createOhTemplate 의 같은 인자와 규칙이 같다. */
  overhaulUnitPriceEntries?: PartOverhaulUnitPriceEntry[];
  actorUserId: string;
}): Promise<OhTemplateResult> {
  return db.transaction(async (tx): Promise<OhTemplateResult> => {
    const [existing] = await tx
      .select({
        id: ohPartTemplates.id,
        version: ohPartTemplates.version,
        isDeleted: ohPartTemplates.isDeleted,
        // 감사의 previousValue 에 실을 값들. 어차피 이 줄을 잠그려고 읽으므로
        // 질의를 새로 열지 않는다.
        code: ohPartTemplates.code,
        name: ohPartTemplates.name,
      })
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

    // 부품별 O/H 단가도 이 트랜잭션 안에서(파일 머리말). 여기서 거절되면 위의
    // version 증가와 부품 교체까지 함께 되돌아간다 — 그것이 이 자리에 있는 이유다.
    const prices = await applyOverhaulUnitPricesInTx(tx, {
      entries: params.overhaulUnitPriceEntries ?? [],
      actorUserId: params.actorUserId,
    });
    // 🔴 반환이 아니라 **던진다** — 여기서 반환하면 위의 쓰기가 커밋된다
    // (TemplateRejected 주석).
    if (!prices.ok) throw new TemplateRejected({ ok: false, code: "NOT_FOUND", message: prices.message });

    await insertAuditLog(tx, {
      actorUserId: params.actorUserId,
      actionType: "UPDATE",
      targetEntity: "oh_part_templates",
      targetRecordId: params.id,
      // previousValue 는 **템플릿 자신의 칸만** 싣는다. 부품 줄은 통째로 갈아
      // 끼우는 방식이라 이전 목록을 남기려면 줄 전체를 실어야 하는데, 그것은
      // 이 기록이 답하려는 질문("누가 이 작업비를 얼마에서 얼마로 바꿨나")과
      // 다른 일이다.
      previousValue: {
        code: existing.code,
        name: existing.name,
      },
      newValue: {
        code: params.fields.code,
        name: params.fields.name,
        itemCount: params.fields.items.length,
      },
    });

    return { ok: true, id: updated.id, version: updated.version };
  }).catch(unwrapRejection);
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
