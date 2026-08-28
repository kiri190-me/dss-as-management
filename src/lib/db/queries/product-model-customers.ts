import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../client";
import { customers, productModelCustomers, productModels } from "../schema";
import type { ProductModelKind } from "@/lib/validation/product-model-input";

/**
 * ============================================================================
 * 제품 모델 × 고객사 연결 읽기 — 양방향
 * ============================================================================
 * 짝이 되는 표는 schema/product-model-customers.ts 다. 그 머리말이 이 파일의
 * 사양서이고, 그중 이 파일이 지켜야 하는 것은 하나다:
 *
 *   🔴 **소프트 삭제된 쪽을 걸러야 한다.**
 *
 * product_model_customers 에는 is_deleted 가 없고, 고객사(또는 모델)를 휴지통에
 * 넣는 것은 그 행을 지우는 것이 아니라 is_deleted 를 세우는 일이다. FK CASCADE 는
 * **완전삭제 때만** 움직이므로 연결 줄은 그대로 남는다 — 걸르지 않으면 휴지통에
 * 있는 고객사가 모델 상세에 계속 보이고, 휴지통에 있는 모델이 고객사 상세에 계속
 * 보인다.
 *
 * 그래서 이 파일의 함수들은 **읽는 방향의 반대쪽 마스터를 inner join 하고
 * is_deleted = false 를 건다.** 모델 → 고객사 방향(아래 두 함수)은 customers 를,
 * 고객사 → 모델 방향(listProductModelsForCustomer)은 product_models 를 건다.
 * inner join 인 것도 같은 이유다: 마스터 행이 어떤 경로로든 없어졌는데 연결 줄만
 * 남았다면(있어서는 안 되지만) 이름이 없는 줄을 화면에 내보내지 않는다.
 *
 * 읽기 전용이고 권한을 보지 않는다 — 페이지가 판정한다(queries/product-models.ts
 * 의 다른 함수들과 같은 역할 분담).
 * ============================================================================
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 화면이 받는 모양. queries/repair-case-references.ts 의 IntakeCustomerOption 과
 * 같은 `{ id, name }` 이다 — 3단계의 선택 목록이 그쪽 것을 그대로 쓰므로 두 목록의
 * 원소 모양이 어긋나면 안 된다. */
export type ProductModelCustomerOption = { id: string; name: string };

/**
 * 모델 여럿분을 **한 번의 조회**로. 목록 화면(모델 104개)이 쓰므로 모델마다 한 번씩
 * 도는 모양(N+1)이면 안 된다.
 *
 * 돌려주는 Map 에는 **연결이 하나라도 있는 모델의 키만** 들어 있다. 부르는 쪽은
 * `map.get(id) ?? []` 로 읽는다(비어 있는 배열을 104개 만들어 두는 것보다 부르는
 * 쪽의 한 줄이 싸다).
 */
export async function listCustomersForProductModels(
  productModelIds: readonly string[]
): Promise<Map<string, ProductModelCustomerOption[]>> {
  // uuid 가 아닌 값이 섞이면 postgres 가 22P02 로 터진다. 조회는 조용히 비는 편이
  // 맞다 — getProductModelDetailById 도 같은 판단으로 null 을 돌려준다.
  const ids = [...new Set(productModelIds.filter((id) => UUID_PATTERN.test(id)))];
  if (ids.length === 0) return new Map();

  const rows = await db
    .select({
      productModelId: productModelCustomers.productModelId,
      id: customers.id,
      name: customers.name,
    })
    .from(productModelCustomers)
    .innerJoin(customers, eq(productModelCustomers.customerId, customers.id))
    .where(
      and(
        inArray(productModelCustomers.productModelId, ids),
        // 🔴 휴지통에 든 고객사를 빼는 자리. 위 머리말 참조.
        eq(customers.isDeleted, false)
      )
    )
    // 이름순. id 까지 얹는 것은 동명이인(정규화 유니크는 이름을 다듬어 비교하므로
    // 표시 이름이 같은 두 행이 있을 수 있다)일 때도 같은 입력에 같은 차례가
    // 나오게 하려는 것이다 — 정렬 없는 조회는 계획이 바뀌면 순서가 바뀐다.
    .orderBy(customers.name, customers.id);

  const byModelId = new Map<string, ProductModelCustomerOption[]>();
  for (const row of rows) {
    const list = byModelId.get(row.productModelId);
    if (list) list.push({ id: row.id, name: row.name });
    else byModelId.set(row.productModelId, [{ id: row.id, name: row.name }]);
  }
  return byModelId;
}

/**
 * 모델 하나분. 위 함수에 그대로 얹는다 — 거르는 규칙(is_deleted)과 차례를 두 곳에
 * 따로 적어 두면 한쪽만 고쳐지는 날이 온다.
 */
export async function listCustomersForProductModel(
  productModelId: string
): Promise<ProductModelCustomerOption[]> {
  const byModelId = await listCustomersForProductModels([productModelId]);
  return byModelId.get(productModelId) ?? [];
}

/**
 * ── 반대 방향 — 고객사 하나에 붙은 제품 모델 ────────────────────────────────
 *
 * 고객사 상세의 `연결된 제품 모델` 구역이 쓴다. 위 두 함수의 거울상이라 같은
 * 파일에 둔다 — 거르는 규칙이 하나뿐인데 파일이 둘이면 한쪽만 고쳐지는 날이 온다.
 */

/** 화면이 받는 모양. 고객사 상세는 `"use client"` 라 여기 담기는 칸이 그대로
 * 브라우저까지 실려 간다 — 목록을 그리고 링크를 거는 데 필요한 세 칸만 둔다.
 *
 * `kind` 가 `ProductModelKind | null` 인 것은 queries/product-models.ts 의
 * 다른 조회들과 같다. `null` 은 **미지정**이라는 뜻이지 "아직 못 읽었다"가
 * 아니다 — schema/product-models.ts 머리말이 적어 둔 대로 이 저장소는 kind 를
 * workflow_type 에서 유도하지 않기로 했으므로, 읽는 쪽이 추측으로 채우면 안 된다. */
export type CustomerProductModelRow = {
  id: string;
  modelName: string;
  kind: ProductModelKind | null;
};

/**
 * 고객사 하나에 붙은 모델 전부를 **한 번의 조회**로. 결과 수에 비례해 조회가
 * 늘어나면 안 된다(위 두 함수와 같은 규칙).
 *
 * 🔴 `product_models.is_deleted = false` 로 거른다. 정방향이 customers 를 거르는
 * 것과 정확히 같은 이유다 — 휴지통에 든 모델은 product_models 에 행이 그대로 남고
 * FK CASCADE 는 완전삭제 때만 움직이므로 연결 줄도 남는다. 안 거르면 지운 모델이
 * 고객사 상세에 계속 보인다.
 */
export async function listProductModelsForCustomer(
  customerId: string
): Promise<CustomerProductModelRow[]> {
  // uuid 가 아닌 값이 오면 postgres 가 22P02 로 터진다. 위 함수와 같은 판단으로
  // 조용히 빈 목록을 돌려준다.
  if (!UUID_PATTERN.test(customerId)) return [];

  return db
    .select({
      id: productModels.id,
      modelName: productModels.modelName,
      kind: productModels.kind,
    })
    .from(productModelCustomers)
    .innerJoin(productModels, eq(productModelCustomers.productModelId, productModels.id))
    .where(
      and(
        eq(productModelCustomers.customerId, customerId),
        // 🔴 휴지통에 든 모델을 빼는 자리. 위 머리말 참조.
        eq(productModels.isDeleted, false)
      )
    )
    // 이름순. id 까지 얹는 것은 정방향과 같은 이유다 — 표시 이름이 같은 두 행이
    // 있을 수 있고, 정렬 없는 조회는 계획이 바뀌면 순서가 바뀐다.
    .orderBy(productModels.modelName, productModels.id);
}
