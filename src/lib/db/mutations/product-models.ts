import "server-only";
import { and, eq, inArray, ne } from "drizzle-orm";
import { db } from "../client";
import { customers, productModelCustomers, productModels } from "../schema";
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
 *
 * ── 고객사 연결(product_model_customers)도 여기서 함께 쓴다 ─────────────
 * 🔴 **같은 트랜잭션 · 같은 행 잠금 안이어야 한다.** 별도 트랜잭션이나 별도
 * 함수로 빼면 위 FOR UPDATE + expectedUpdatedAt 검사를 빠져나가서, 두 사람이 같은
 * 모델을 동시에 고칠 때 한쪽이 고른 고객사가 아무 충돌 없이 조용히 사라진다.
 * 연결은 모델 기본정보 한 구역에서 이름·종류와 **함께** 편집되는 값이므로 동시성
 * 판정도 함께 받아야 한다.
 *
 * 쓰는 방법은 "이 모델의 연결을 전부 지우고 받은 것을 넣는다"다. 화면이 늘 전체
 * 목록을 보내므로(validation/product-model-input.ts 의 "항상 전체 제출" 규약)
 * 서버가 차집합을 계산할 이유가 없고, 계산하면 화면이 보낸 것과 서버가 가진 것이
 * 어긋났을 때 결과가 입력만으로 정해지지 않게 된다.
 */
export async function updateProductModel(params: {
  id: string;
  expectedUpdatedAt: string;
  modelName: string;
  kind: ProductModelKind | null;
  manufacturer: string | null;
  description: string | null;
  /** 이 모델에 붙일 고객사 **전체 목록**. 여기 없는 연결은 지워진다. */
  customerIds: readonly string[];
}): Promise<UpdateProductModelResult> {
  // 콜백의 반환 타입을 못 박는다 — 없으면 추론이 여러 갈래의 반환을 하나의
  // 유니온으로 합치면서 fieldErrors 의 키가 갈래마다 `undefined` 로 섞여
  // Record<string, string> 에 맞지 않게 된다(savePartMinimumQuantities 도 같은
  // 이유로 같은 자리에 타입을 적어 둔다).
  return db.transaction(async (tx): Promise<UpdateProductModelResult> => {
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

    // ── 고객사 연결: 보내온 것을 서버가 독립적으로 판정한다 ────────────────
    // 중복 제거는 validation 쪽에서 이미 하지만(product-model-input.ts 머리말 2)
    // 여기서 한 번 더 한다 — 이 함수는 그 validation 을 거치지 않고도 불릴 수 있는
    // 공개 함수라(통합 시험이 그렇게 부른다), 유니크 인덱스에 걸려 사람이 읽을 수
    // 없는 23505 로 터지는 길은 이 함수 스스로 막아야 한다.
    const customerIds = [...new Set(params.customerIds)];
    if (customerIds.length > 0) {
      // 🔴 실제로 있고 휴지통에 들어 있지 않은 고객사만 붙일 수 있다. FK 오류로
      // 터지게 두지 않는 이유가 둘이다: (1) 23503 은 사람이 읽을 수 있는 말이
      // 아니고, (2) FK 는 행이 있는지만 보므로 is_deleted = true 인 고객사는
      // 그대로 통과한다 — 휴지통에 든 고객사가 모델에 붙는 것은 조회가 그것을
      // 걸러 낸다는 사실과 합쳐지면 "저장했는데 화면에 안 나오는" 상태가 된다.
      const alive = await tx
        .select({ id: customers.id })
        .from(customers)
        .where(and(inArray(customers.id, customerIds), eq(customers.isDeleted, false)));
      if (alive.length !== customerIds.length) {
        // 아직 아무것도 쓰지 않았다 — 여기서 반환하면 빈 트랜잭션이 커밋된다.
        return {
          ok: false,
          code: "VALIDATION_ERROR",
          fieldErrors: { customerIds: "선택한 고객사를 확인할 수 없습니다. 목록을 새로고침한 뒤 다시 선택해 주세요." },
          message: "입력값을 확인해 주세요.",
        };
      }
    }

    let updated: { id: string; modelName: string; updatedAt: Date };
    try {
      // 🔴 연결만 바뀐 저장에서도 이 UPDATE 는 반드시 돈다 — updated_at 이 오르지
      // 않으면 다음 사람이 낡은 expectedUpdatedAt 을 들고도 충돌 없이 덮어쓴다.
      [updated] = await tx
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

    // ── 전부 지우고 받은 것을 넣는다 ──────────────────────────────────────
    // 위 try 밖이다. 안에 넣으면 연결 쪽에서 난 오류가 "이미 존재하는 모델명"으로
    // 둔갑한다. 같은 모델의 연결을 쓰는 길은 이 함수뿐이고 여기는 그 모델 행을
    // FOR UPDATE 로 잡고 있으므로, 두 저장이 같은 (모델, 고객사) 짝을 동시에 넣어
    // 23505 가 나는 경쟁 자체가 없다.
    await tx.delete(productModelCustomers).where(eq(productModelCustomers.productModelId, params.id));
    if (customerIds.length > 0) {
      await tx
        .insert(productModelCustomers)
        .values(customerIds.map((customerId) => ({ productModelId: params.id, customerId })));
    }

    return { ok: true, id: updated.id, modelName: updated.modelName, updatedAt: updated.updatedAt.toISOString() };
  });
}
