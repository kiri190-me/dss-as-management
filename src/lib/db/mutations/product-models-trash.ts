import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../client";
import { productModels, products, repairCases } from "../schema";
import { insertAuditLog } from "./audit-logs";
import { isExactNormalizedMatch } from "@/lib/domain/entity-name-match";

/**
 * ============================================================================
 * 제품 모델 삭제 — 휴지통 → 15일 → 완전삭제 (승인된 체크포인트)
 * ============================================================================
 * 고객사 삭제(customers-trash.ts)와 같은 결정에서 나온 같은 규칙이고, 같은
 * 규율을 따른다. 두 파일이 나란히 있는 이유는 재사용을 놓쳐서가 아니라
 * 대상 테이블과 딸려 가는 자식이 다르기 때문이다 — 공통으로 뽑아낼 수 있는
 * 것(15일 계산, 확인 창, 선택 바, 감사 로그 기록)은 이미 공유하고 있다.
 *
 * ── 접수 건이 하나라도 있으면 삭제하지 않는다 ───────────────────────────
 * repair_cases.product_id는 ON DELETE RESTRICT다. 이 모델로 등록된 장비 중
 * 하나라도 접수 건에 걸려 있으면 그 장비를 지울 수 없고, 장비를 지울 수
 * 없으면 모델도 지울 수 없다. 15일 뒤에 실패할 일을 지금 막는다.
 *
 * 세는 대상은 삭제된 접수 건까지 포함한 전부다 — FK는 is_deleted를 보지
 * 않는다.
 *
 * ── 등록 장비는 함께 딸려 간다 ──────────────────────────────────────────
 * 승인된 결정이다(고객사-End-User와 같은 규칙). products.product_model_id가
 * nullable이라 "연결만 끊고 장비는 남기기"도 가능했지만, 그러면 같은 화면
 * 두 곳에서 삭제의 뜻이 달라진다 — 고객사에서는 아래가 함께 사라지고 제품
 * 모델에서는 남는다. 규칙은 하나여야 한다.
 *
 * products에는 자식 테이블이 없다(products.id를 참조하는 것은 repair_cases
 * 뿐이고, 접수 건이 있으면 애초에 여기까지 오지 못한다). 그래서 고객사 쪽의
 * 담당자 단계에 해당하는 것이 없고, 순서는 장비 → 모델 두 단계다.
 *
 * ── 복원은 '이번 삭제로 딸려 간 것'만 되살린다 ──────────────────────────
 * 고객사 쪽과 같은 방식 — 한 트랜잭션에서 같은 deleted_at을 찍고, 복원은
 * 모델의 deleted_at과 정확히 같은 장비만 되살린다.
 *
 * ── 복원은 이름 자리가 다시 비어 있을 때만 된다 ─────────────────────────
 * product_models_normalized_name_unique도 is_deleted = false인 행에만 걸리는
 * 부분 인덱스다. 휴지통에 있는 동안 같은 이름의 모델이 새로 생길 수 있고,
 * 그 상태로 복원하면 유니크 위반이 난다. 사전 검사와 23505 두 겹으로 막는다.
 *
 * (products의 유니크 인덱스 products_model_lot_serial_unique는 부분 인덱스가
 * 아니라 삭제 여부와 무관하게 늘 걸려 있다. 즉 휴지통에 있는 장비와 같은
 * 모델명·로트·시리얼로 새 장비를 만들 수 없으므로, 장비 쪽에는 복원이 막힐
 * 이름 충돌이 생기지 않는다.)
 * ============================================================================
 */

export type ProductModelTrashResultCode = "NOT_FOUND" | "CONFLICT" | "REFERENCED" | "NAME_TAKEN";

export type ProductModelTrashResult =
  | { ok: true; id: string; unitCount: number }
  | { ok: false; code: ProductModelTrashResultCode; message: string };

const CONFLICT_MESSAGE = "다른 사용자가 이 제품 모델 정보를 수정했습니다. 새로고침 후 다시 시도하세요.";
const NOT_FOUND_MESSAGE = "해당 제품 모델을 찾을 수 없습니다.";

function nameTakenMessage(modelName: string): string {
  return `같은 이름의 제품 모델(${modelName})이 이미 있어 복원할 수 없습니다. 기존 모델의 이름을 바꾼 뒤 다시 시도하세요.`;
}

function referencedMessage(count: number): string {
  return `이 모델로 등록된 장비에 연결된 A/S 접수 건이 ${count}건 있어 삭제할 수 없습니다. 휴지통에 있는 접수 건도 포함됩니다.`;
}

function hasPgCode(err: unknown, code: string): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code?: unknown }).code === code;
}

/** drizzle이 드라이버 오류를 자기 클래스로 감싸므로 cause까지 본다. */
function isUniqueViolation(err: unknown): boolean {
  if (hasPgCode(err, "23505")) return true;
  const cause = err instanceof Error ? err.cause : undefined;
  return hasPgCode(cause, "23505");
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** 이 모델의 장비를 붙잡고 있는 A/S 접수 건 수 — 삭제된 접수 건도 센다. */
async function countReferencingRepairCases(tx: Tx, productIds: string[]): Promise<number> {
  if (productIds.length === 0) return 0;
  const [row] = await tx
    .select({ total: sql<number>`count(*)::int` })
    .from(repairCases)
    .where(inArray(repairCases.productId, productIds));
  return row.total;
}

/**
 * 제품 모델을 휴지통으로 보낸다. 그 모델로 등록된 장비도 같은 순간으로 함께
 * 잠긴다. 접수 건이 하나라도 걸려 있으면 아무것도 바꾸지 않는다.
 */
export async function softDeleteProductModel(params: {
  productModelId: string;
  expectedUpdatedAt: string;
  actorUserId: string;
  reason: string | null;
}): Promise<ProductModelTrashResult> {
  return db.transaction(async (tx): Promise<ProductModelTrashResult> => {
    const [current] = await tx
      .select({
        id: productModels.id,
        modelName: productModels.modelName,
        kind: productModels.kind,
        manufacturer: productModels.manufacturer,
        createdAt: productModels.createdAt,
        updatedAt: productModels.updatedAt,
      })
      .from(productModels)
      .where(and(eq(productModels.id, params.productModelId), eq(productModels.isDeleted, false)))
      .for("update");

    if (!current) return { ok: false, code: "NOT_FOUND", message: NOT_FOUND_MESSAGE };
    if (current.updatedAt.toISOString() !== params.expectedUpdatedAt) {
      return { ok: false, code: "CONFLICT", message: CONFLICT_MESSAGE };
    }

    const ownProducts = await tx
      .select({
        id: products.id,
        modelName: products.modelName,
        serialNumber: products.serialNumber,
        lotNumber: products.lotNumber,
        isDeleted: products.isDeleted,
      })
      .from(products)
      .where(eq(products.productModelId, params.productModelId))
      .for("update");

    const referencing = await countReferencingRepairCases(
      tx,
      ownProducts.map((product) => product.id)
    );
    if (referencing > 0) {
      return { ok: false, code: "REFERENCED", message: referencedMessage(referencing) };
    }

    // 모델과 딸려 가는 장비가 이 한 순간을 공유한다 — 복원이 '이번 삭제로
    // 딸려 간 것'을 알아보는 유일한 근거다.
    const deletedAt = new Date();
    const deletion = {
      isDeleted: true as const,
      deletedAt,
      deletedBy: params.actorUserId,
      deleteReason: params.reason,
      updatedAt: deletedAt,
    };

    const cascaded = ownProducts.filter((product) => !product.isDeleted);
    const cascadedIds = cascaded.map((product) => product.id);

    if (cascadedIds.length > 0) {
      await tx.update(products).set(deletion).where(inArray(products.id, cascadedIds));

      for (const product of cascaded) {
        await insertAuditLog(tx, {
          actorUserId: params.actorUserId,
          actionType: "SOFT_DELETE",
          targetEntity: "products",
          targetRecordId: product.id,
          previousValue: {
            id: product.id,
            productModelId: params.productModelId,
            modelName: product.modelName,
            serialNumber: product.serialNumber,
            lotNumber: product.lotNumber,
          },
          newValue: {
            isDeleted: true,
            deletedAt: deletedAt.toISOString(),
            cascadedFromProductModelId: params.productModelId,
          },
        });
      }
    }

    const updated = await tx
      .update(productModels)
      .set(deletion)
      .where(and(eq(productModels.id, params.productModelId), eq(productModels.isDeleted, false)))
      .returning({ id: productModels.id });

    if (updated.length === 0) {
      // 행을 잠그고 있어 실제로는 닿지 않지만, 0행 쓰기를 조용히 성공으로
      // 넘기지 않는다는 규율은 그대로 지킨다.
      return { ok: false, code: "NOT_FOUND", message: NOT_FOUND_MESSAGE };
    }

    await insertAuditLog(tx, {
      actorUserId: params.actorUserId,
      actionType: "SOFT_DELETE",
      targetEntity: "product_models",
      targetRecordId: params.productModelId,
      previousValue: {
        id: current.id,
        modelName: current.modelName,
        kind: current.kind,
        manufacturer: current.manufacturer,
        createdAt: current.createdAt.toISOString(),
      },
      newValue: {
        isDeleted: true,
        deletedAt: deletedAt.toISOString(),
        deleteReason: params.reason,
        cascadedProductIds: cascadedIds,
      },
    });

    return { ok: true, id: params.productModelId, unitCount: cascadedIds.length };
  });
}

/** 휴지통의 제품 모델을 되살린다. 같은 순간에 딸려 갔던 장비도 같이 돌아온다. */
export async function restoreProductModel(params: {
  productModelId: string;
  expectedUpdatedAt: string;
  actorUserId: string;
}): Promise<ProductModelTrashResult> {
  return db.transaction(async (tx): Promise<ProductModelTrashResult> => {
    const [current] = await tx
      .select({
        id: productModels.id,
        modelName: productModels.modelName,
        updatedAt: productModels.updatedAt,
        deletedAt: productModels.deletedAt,
      })
      .from(productModels)
      .where(and(eq(productModels.id, params.productModelId), eq(productModels.isDeleted, true)))
      .for("update");

    if (!current) return { ok: false, code: "NOT_FOUND", message: NOT_FOUND_MESSAGE };
    if (current.updatedAt.toISOString() !== params.expectedUpdatedAt) {
      return { ok: false, code: "CONFLICT", message: CONFLICT_MESSAGE };
    }

    const others = await tx
      .select({ id: productModels.id, modelName: productModels.modelName })
      .from(productModels)
      .where(eq(productModels.isDeleted, false));
    if (others.some((other) => isExactNormalizedMatch(other.modelName, current.modelName))) {
      return { ok: false, code: "NAME_TAKEN", message: nameTakenMessage(current.modelName) };
    }

    // deleted_at을 지우기 전에 대상을 확정한다.
    const cascadedProducts = current.deletedAt
      ? await tx
          .select({ id: products.id, modelName: products.modelName })
          .from(products)
          .where(
            and(
              eq(products.productModelId, params.productModelId),
              eq(products.isDeleted, true),
              eq(products.deletedAt, current.deletedAt)
            )
          )
          .for("update")
      : [];

    const restoration = {
      isDeleted: false as const,
      deletedAt: null,
      deletedBy: null,
      deleteReason: null,
      updatedAt: new Date(),
    };

    try {
      if (cascadedProducts.length > 0) {
        const cascadedIds = cascadedProducts.map((product) => product.id);
        await tx.update(products).set(restoration).where(inArray(products.id, cascadedIds));

        for (const product of cascadedProducts) {
          await insertAuditLog(tx, {
            actorUserId: params.actorUserId,
            actionType: "RESTORE",
            targetEntity: "products",
            targetRecordId: product.id,
            previousValue: null,
            newValue: {
              id: product.id,
              productModelId: params.productModelId,
              modelName: product.modelName,
              isDeleted: false,
            },
          });
        }
      }

      const updated = await tx
        .update(productModels)
        .set(restoration)
        .where(and(eq(productModels.id, params.productModelId), eq(productModels.isDeleted, true)))
        .returning({ id: productModels.id });

      if (updated.length === 0) return { ok: false, code: "NOT_FOUND", message: NOT_FOUND_MESSAGE };

      await insertAuditLog(tx, {
        actorUserId: params.actorUserId,
        actionType: "RESTORE",
        targetEntity: "product_models",
        targetRecordId: params.productModelId,
        previousValue: null,
        newValue: {
          id: current.id,
          modelName: current.modelName,
          isDeleted: false,
          restoredProductIds: cascadedProducts.map((product) => product.id),
        },
      });

      return { ok: true, id: params.productModelId, unitCount: cascadedProducts.length };
    } catch (err) {
      // 사전 검사와 이 UPDATE 사이에 같은 이름이 활성으로 들어온 경쟁.
      if (isUniqueViolation(err)) {
        return { ok: false, code: "NAME_TAKEN", message: nameTakenMessage(current.modelName) };
      }
      throw err;
    }
  });
}

/**
 * 휴지통의 제품 모델을 15일을 기다리지 않고 즉시 완전삭제한다.
 * 삭제 순서는 FK RESTRICT가 강제한다: 등록 장비 → 모델.
 */
export async function permanentlyDeleteProductModel(params: {
  productModelId: string;
  expectedUpdatedAt: string;
  actorUserId: string;
  reason: string;
}): Promise<ProductModelTrashResult> {
  return db.transaction(async (tx): Promise<ProductModelTrashResult> => {
    const [current] = await tx
      .select({
        id: productModels.id,
        modelName: productModels.modelName,
        kind: productModels.kind,
        manufacturer: productModels.manufacturer,
        createdAt: productModels.createdAt,
        updatedAt: productModels.updatedAt,
        deletedAt: productModels.deletedAt,
        deletedBy: productModels.deletedBy,
        deleteReason: productModels.deleteReason,
      })
      .from(productModels)
      .where(and(eq(productModels.id, params.productModelId), eq(productModels.isDeleted, true)))
      .for("update");

    if (!current) return { ok: false, code: "NOT_FOUND", message: NOT_FOUND_MESSAGE };
    if (current.updatedAt.toISOString() !== params.expectedUpdatedAt) {
      return { ok: false, code: "CONFLICT", message: CONFLICT_MESSAGE };
    }

    const ownProducts = await tx
      .select({ id: products.id, modelName: products.modelName })
      .from(products)
      .where(eq(products.productModelId, params.productModelId))
      .for("update");
    const productIds = ownProducts.map((product) => product.id);

    // 휴지통에 넣을 때 이미 막았지만 여기서 다시 센다 — 그 사이에 접수 건이
    // 생겼다면 DB 오류로 터지는 대신 이유를 말해야 한다.
    const referencing = await countReferencingRepairCases(tx, productIds);
    if (referencing > 0) {
      return { ok: false, code: "REFERENCED", message: referencedMessage(referencing) };
    }

    if (productIds.length > 0) {
      await tx.delete(products).where(inArray(products.id, productIds));

      for (const product of ownProducts) {
        await insertAuditLog(tx, {
          actorUserId: params.actorUserId,
          actionType: "PURGE",
          targetEntity: "products",
          targetRecordId: product.id,
          previousValue: { id: product.id, productModelId: params.productModelId, modelName: product.modelName },
          newValue: null,
        });
      }
    }

    const deleted = await tx
      .delete(productModels)
      .where(and(eq(productModels.id, params.productModelId), eq(productModels.isDeleted, true)))
      .returning({ id: productModels.id });

    if (deleted.length === 0) return { ok: false, code: "NOT_FOUND", message: NOT_FOUND_MESSAGE };

    await insertAuditLog(tx, {
      actorUserId: params.actorUserId,
      actionType: "PURGE",
      targetEntity: "product_models",
      targetRecordId: params.productModelId,
      previousValue: {
        id: current.id,
        modelName: current.modelName,
        kind: current.kind,
        manufacturer: current.manufacturer,
        createdAt: current.createdAt.toISOString(),
        deletedAt: current.deletedAt ? current.deletedAt.toISOString() : null,
        deletedBy: current.deletedBy,
        deleteReason: current.deleteReason,
        purgedProductIds: productIds,
      },
      newValue: null,
    });

    return { ok: true, id: params.productModelId, unitCount: productIds.length };
  });
}
