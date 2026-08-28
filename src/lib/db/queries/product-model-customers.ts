import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../client";
import { customers, productModelCustomers } from "../schema";

/**
 * ============================================================================
 * 제품 모델에 붙은 고객사 읽기
 * ============================================================================
 * 짝이 되는 표는 schema/product-model-customers.ts 다. 그 머리말이 이 파일의
 * 사양서이고, 그중 이 파일이 지켜야 하는 것은 하나다:
 *
 *   🔴 **customers.is_deleted = false 로 걸러야 한다.**
 *
 * product_model_customers 에는 is_deleted 가 없고, 고객사를 휴지통에 넣는 것은
 * customers 행을 지우는 것이 아니라 is_deleted 를 세우는 일이다. FK CASCADE 는
 * **완전삭제 때만** 움직이므로 연결 줄은 그대로 남는다 — 걸르지 않으면 휴지통에
 * 있는 고객사가 모델 상세에 계속 보인다.
 *
 * 그래서 두 함수 모두 customers 를 inner join 하고 is_deleted = false 를 건다.
 * inner join 인 것도 같은 이유다: 고객사 행이 어떤 경로로든 없어졌는데 연결 줄만
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
