import "server-only";
import { asc, eq } from "drizzle-orm";
import { db } from "../client";
import { productModels } from "../schema";

/** 밖으로 나가는 모델 한 줄. 🔴 칸 이름이 다른 시스템과의 약속이다. */
export type ExternalProductModel = {
  id: string;
  modelName: string;
};

/**
 * ============================================================================
 * 제품 모델 전부 — 다른 사내 시스템이 읽어 가는 통로용 (`GET /api/v1/product-models`)
 * ============================================================================
 * 재고 관리로 옮긴 O/H 부품 템플릿 화면의 「모델 잇기」 고르개가 쓴다.
 *
 * 🔴 **`oh-part-templates.ts` 의 `listUnlinkedProductModels` 를 쓰지 않는다.** 그
 * 함수는 **아직 어느 템플릿에도 안 붙은 모델만** 돌려준다(이름 그대로). A/S 쪽
 * 템플릿에 붙었는지 여부로 재고 쪽 고르개를 거르면, A/S 에 템플릿이 있는 모델이
 * 재고 쪽에서는 통째로 안 보인다. 쓰임이 다르므로 그 함수는 그대로 두고 새로 쓴다.
 *
 * 지운 모델은 뺀다 — `product_models` 는 이 저장소의 네 칸 소프트 삭제 규약을
 * 쓰고(`is_deleted` · `deleted_at` · `deleted_by` · `delete_reason`,
 * DATABASE_DESIGN.md 8번), 살아 있는 줄을 고르는 조건은 `is_deleted = false` 다.
 *
 * 모델명 순. 이름이 같은 줄이 있어도 순서가 실행마다 흔들리지 않게 id 로 동점을
 * 깬다(ORDER BY 가 완전하지 않은 조회는 순서를 보장하지 않는다 —
 * `shipment-approval-routes.ts` 의 `listSelectableApproverCandidates` 와 같은 판단).
 * ============================================================================
 */
export async function listProductModelsForExternalLookup(): Promise<ExternalProductModel[]> {
  return db
    .select({ id: productModels.id, modelName: productModels.modelName })
    .from(productModels)
    .where(eq(productModels.isDeleted, false))
    .orderBy(asc(productModels.modelName), asc(productModels.id));
}
