"use server";

import { readSession } from "@/lib/auth/session";
import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { getAuthSource } from "@/lib/config/auth-source";
import { hasPermission } from "@/lib/auth/permission-resolver";
import { isValidExpectedUpdatedAt, isValidProductModelId } from "@/lib/validation/product-model-input";
import {
  permanentlyDeleteProductModel,
  restoreProductModel,
  softDeleteProductModel,
  type ProductModelTrashResult,
} from "@/lib/db/mutations/product-models-trash";

const MAX_BULK_ITEMS = 200;
const MAX_REASON_LENGTH = 2000;

export type ProductModelTrashItem = { id: string; expectedUpdatedAt: string };

export type ProductModelTrashItemResult = {
  id: string;
  ok: boolean;
  code?: "NOT_FOUND" | "CONFLICT" | "REFERENCED" | "NAME_TAKEN" | "DATABASE_UNAVAILABLE";
  message?: string;
  /** 이 건과 함께 움직인 등록 장비 수. 성공했을 때만 채워진다. */
  unitCount?: number;
};

export type ProductModelTrashActionResultCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "VALIDATION_ERROR"
  | "DATABASE_UNAVAILABLE";

export type ProductModelTrashActionResult =
  | { ok: true; results: ProductModelTrashItemResult[] }
  | { ok: false; code: ProductModelTrashActionResultCode; message: string };

/**
 * 제품 모델 삭제·복원·완전삭제 서버 액션. 고객사 쪽 customer-trash.ts와
 * 같은 모양이다 — 한 건씩, 건마다 자기 트랜잭션, 건마다 자기 결과. 관문은
 * 화면이 무엇을 그렸는지와 무관하게 여기서 다시 본다.
 */
type Gate =
  | { ok: true; actorUserId: string }
  | { ok: false; code: ProductModelTrashActionResultCode; message: string };

async function passGate(): Promise<Gate> {
  if (getAuthSource() !== "database") {
    return { ok: false, code: "FORBIDDEN", message: "데이터베이스 저장 모드가 아닙니다." };
  }

  const session = await readSession();
  if (!session) return { ok: false, code: "UNAUTHORIZED", message: "로그인이 필요합니다." };
  if (session.approvalStatus !== "APPROVED") {
    return { ok: false, code: "FORBIDDEN", message: "계정이 아직 승인되지 않았습니다." };
  }

  const actingUser = await resolveActingUserForSession(session);
  if (!actingUser) return { ok: false, code: "UNAUTHORIZED", message: "로그인이 필요합니다." };

  if (!(await hasPermission(actingUser.role, "productModels.lifecycle", "MANAGE"))) {
    return { ok: false, code: "FORBIDDEN", message: "제품 모델을 삭제하거나 복원할 권한이 없습니다." };
  }

  return { ok: true, actorUserId: actingUser.id };
}

function validateItems(
  items: ProductModelTrashItem[] | undefined,
  emptyMessage: string
): { ok: true } | { ok: false; code: "VALIDATION_ERROR"; message: string } {
  if (!Array.isArray(items) || items.length === 0) {
    return { ok: false, code: "VALIDATION_ERROR", message: emptyMessage };
  }
  if (items.length > MAX_BULK_ITEMS) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      message: `한 번에 최대 ${MAX_BULK_ITEMS}건까지 처리할 수 있습니다.`,
    };
  }
  for (const item of items) {
    if (!isValidProductModelId(item?.id) || !isValidExpectedUpdatedAt(item?.expectedUpdatedAt)) {
      return { ok: false, code: "VALIDATION_ERROR", message: "선택한 제품 모델 정보를 확인할 수 없습니다." };
    }
  }
  return { ok: true };
}

async function runEach(
  items: ProductModelTrashItem[],
  label: string,
  run: (item: ProductModelTrashItem) => Promise<ProductModelTrashResult>
): Promise<ProductModelTrashItemResult[]> {
  const results: ProductModelTrashItemResult[] = [];
  for (const item of items) {
    try {
      const result = await run(item);
      results.push(
        result.ok
          ? { id: item.id, ok: true, unitCount: result.unitCount }
          : { id: item.id, ok: false, code: result.code, message: result.message }
      );
    } catch (err) {
      const code = typeof err === "object" && err !== null && "code" in err ? (err as { code?: string }).code : undefined;
      console.error(`${label}: unexpected DB error`, { id: item.id, code });
      results.push({
        id: item.id,
        ok: false,
        code: "DATABASE_UNAVAILABLE",
        message: "일시적으로 처리할 수 없습니다. 잠시 후 다시 시도해 주세요.",
      });
    }
  }
  return results;
}

/** 제품 모델을 휴지통으로 보낸다. 되돌릴 수 있는 조작이므로 사유는 선택 입력이다. */
export async function deleteProductModelsAction(input: {
  items: ProductModelTrashItem[];
  reason?: string | null;
}): Promise<ProductModelTrashActionResult> {
  const gate = await passGate();
  if (!gate.ok) return gate;

  const validated = validateItems(input.items, "삭제할 제품 모델을 선택해 주세요.");
  if (!validated.ok) return validated;

  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  if (reason.length > MAX_REASON_LENGTH) {
    return { ok: false, code: "VALIDATION_ERROR", message: "삭제 사유가 너무 깁니다." };
  }

  const results = await runEach(input.items, "deleteProductModelsAction", (item) =>
    softDeleteProductModel({
      productModelId: item.id,
      expectedUpdatedAt: item.expectedUpdatedAt,
      actorUserId: gate.actorUserId,
      reason: reason || null,
    })
  );

  return { ok: true, results };
}

/** 휴지통의 제품 모델을 되살린다. 딸려 갔던 등록 장비도 함께 돌아온다. */
export async function restoreProductModelsAction(input: {
  items: ProductModelTrashItem[];
}): Promise<ProductModelTrashActionResult> {
  const gate = await passGate();
  if (!gate.ok) return gate;

  const validated = validateItems(input.items, "복원할 제품 모델을 선택해 주세요.");
  if (!validated.ok) return validated;

  const results = await runEach(input.items, "restoreProductModelsAction", (item) =>
    restoreProductModel({
      productModelId: item.id,
      expectedUpdatedAt: item.expectedUpdatedAt,
      actorUserId: gate.actorUserId,
    })
  );

  return { ok: true, results };
}

/** 15일을 기다리지 않고 즉시 완전삭제한다. 되돌릴 수 없으므로 사유가 필수다. */
export async function permanentlyDeleteProductModelsAction(input: {
  items: ProductModelTrashItem[];
  reason: string;
}): Promise<ProductModelTrashActionResult> {
  const gate = await passGate();
  if (!gate.ok) return gate;

  const validated = validateItems(input.items, "완전 삭제할 제품 모델을 선택해 주세요.");
  if (!validated.ok) return validated;

  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  if (reason === "") {
    return { ok: false, code: "VALIDATION_ERROR", message: "완전 삭제 사유를 입력해 주세요." };
  }
  if (reason.length > MAX_REASON_LENGTH) {
    return { ok: false, code: "VALIDATION_ERROR", message: "완전 삭제 사유가 너무 깁니다." };
  }

  const results = await runEach(input.items, "permanentlyDeleteProductModelsAction", (item) =>
    permanentlyDeleteProductModel({
      productModelId: item.id,
      expectedUpdatedAt: item.expectedUpdatedAt,
      actorUserId: gate.actorUserId,
      reason,
    })
  );

  return { ok: true, results };
}
