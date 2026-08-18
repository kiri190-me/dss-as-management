import "server-only";
import { and, eq, ne } from "drizzle-orm";
import { db } from "../client";
import { productModels } from "../schema";
import { isExactNormalizedMatch } from "@/lib/domain/entity-name-match";
import type { ProductModelKind } from "@/lib/validation/product-model-input";

function hasPgCode(err: unknown, code: string): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === code
  );
}

/** Same reasoning/precedent as customers.ts's own isUniqueViolation. */
function isUniqueViolation(err: unknown): boolean {
  if (hasPgCode(err, "23505")) return true;
  const cause = err instanceof Error ? err.cause : undefined;
  return hasPgCode(cause, "23505");
}

export type UpdateProductModelResultCode = "NOT_FOUND" | "CONFLICT" | "VALIDATION_ERROR";

export type UpdateProductModelResult =
  | { ok: true; id: string; modelName: string; updatedAt: string }
  | { ok: false; code: UpdateProductModelResultCode; fieldErrors?: Record<string, string>; message: string };

/**
 * Product model master edit (SUPER_ADMIN/ADMIN only — enforced by the
 * caller). Row-locked + expectedUpdatedAt concurrency check, same pattern
 * as updateCustomer/renameEndUser. Duplicate-name protection mirrors
 * createEndUser/renameEndUser exactly: a pre-update JS scan via
 * isExactNormalizedMatch (excluding self) + a catch-unique-violation
 * fallback for the race where two concurrent renames collide on the same
 * normalized name.
 *
 * This mutation only ever writes to product_models — it never touches
 * products.model_name, which stays exactly as each unit's own historical
 * intake string regardless of any later master-name edit (same "master
 * rename never rewrites unit/case history" principle already applied to
 * repair_cases.contact*_snapshot and end_user_contacts).
 */
export async function updateProductModel(params: {
  id: string;
  expectedUpdatedAt: string;
  modelName: string;
  kind: ProductModelKind | null;
  manufacturer: string | null;
  description: string | null;
}): Promise<UpdateProductModelResult> {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(productModels)
      .where(and(eq(productModels.id, params.id), eq(productModels.isDeleted, false)))
      .for("update");
    if (!current) {
      return { ok: false, code: "NOT_FOUND", message: "해당 제품 모델을 찾을 수 없습니다." };
    }
    if (current.updatedAt.toISOString() !== params.expectedUpdatedAt) {
      return {
        ok: false,
        code: "CONFLICT",
        message: "다른 사용자가 이 제품 모델 정보를 수정했습니다. 새로고침 후 다시 시도하세요.",
      };
    }

    const others = await tx
      .select({ id: productModels.id, modelName: productModels.modelName })
      .from(productModels)
      .where(and(eq(productModels.isDeleted, false), ne(productModels.id, params.id)));
    const duplicate = others.find((m) => isExactNormalizedMatch(m.modelName, params.modelName));
    if (duplicate) {
      return {
        ok: false,
        code: "VALIDATION_ERROR",
        fieldErrors: { modelName: "이미 존재하는 모델명입니다." },
        message: "입력값을 확인해 주세요.",
      };
    }

    try {
      const [updated] = await tx
        .update(productModels)
        .set({
          modelName: params.modelName,
          kind: params.kind,
          manufacturer: params.manufacturer,
          description: params.description,
          updatedAt: new Date(),
        })
        .where(eq(productModels.id, params.id))
        .returning({ id: productModels.id, modelName: productModels.modelName, updatedAt: productModels.updatedAt });
      return { ok: true, id: updated.id, modelName: updated.modelName, updatedAt: updated.updatedAt.toISOString() };
    } catch (err) {
      if (isUniqueViolation(err)) {
        return {
          ok: false,
          code: "VALIDATION_ERROR",
          fieldErrors: { modelName: "이미 존재하는 모델명입니다." },
          message: "입력값을 확인해 주세요.",
        };
      }
      throw err;
    }
  });
}
