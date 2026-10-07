import "server-only";
import { and, eq, exists, inArray, or, sql } from "drizzle-orm";
import { db } from "../client";
import { customers, productModelCustomers, productModels, products, repairCases } from "../schema";
import type { ProductModelCustomerSource } from "@/lib/domain/product-model-customer-merge";
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
 * ── 접수 기록에서 나오는 고객사 (파생) ──────────────────────────────────────
 *
 * 위 두 함수가 읽는 product_model_customers 는 **사람이 골라 둔 설정**이다
 * (schema/product-model-customers.ts 머리말). 접수 건이 생겼다고 해서 그 표에 줄이
 * 저절로 늘지 않으므로, 실제로 이어졌던 고객사 대부분이 모델 마스터 화면에서 보이지
 * 않았다 — 실측으로 수기 연결은 모델 3개뿐인데 접수 기록에는 모델 39개가 있다.
 *
 * 아래 두 함수는 그 기록 쪽을 읽는다. **표에 쓰지 않는다** — 읽을 때 계산해야 새
 * 접수 건이 들어오는 순간 저절로 따라오고, 사람이 골라 둔 설정과도 섞이지 않는다.
 * 합치는 일은 화면 직전에 도메인 함수 하나가 한다
 * (domain/product-model-customer-merge.ts).
 *
 * 경로는 repair_cases → products → product_models 다(products.product_model_id).
 * 🔴 거를 것이 셋이다 — 접수 건 · 장비 · 고객사 모두 소프트 삭제된 쪽을 뺀다.
 * 고객사를 거르는 근거는 이 파일 머리말과 같고, 접수 건과 장비는 휴지통에 든
 * 기록으로 고객사를 만들어 내지 않기 위해서다.
 */

/**
 * 모델 여럿분을 **한 번의 조회**로. 목록 화면(모델 104개)이 쓰므로 모델마다 한 번씩
 * 도는 모양(N+1)이면 안 된다 — listCustomersForProductModels 와 같은 규칙이고,
 * 돌려주는 Map 도 같은 모양이다(연결이 있는 모델의 키만 들어 있다).
 */
export async function listRepairCaseCustomersForProductModels(
  productModelIds: readonly string[]
): Promise<Map<string, ProductModelCustomerOption[]>> {
  // uuid 가 아닌 값이 섞이면 postgres 가 22P02 로 터진다(위 형제 함수와 같은 판단).
  const ids = [...new Set(productModelIds.filter((id) => UUID_PATTERN.test(id)))];
  if (ids.length === 0) return new Map();

  const rows = await db
    // 한 모델에 같은 고객사의 접수 건이 여러 건인 것이 보통이다(실측 127줄 →
    // 모델 39개). 줄 단위로 받아 JS 에서 접는 대신 DB 가 접게 한다.
    .selectDistinct({
      productModelId: products.productModelId,
      id: customers.id,
      name: customers.name,
    })
    .from(repairCases)
    .innerJoin(products, eq(repairCases.productId, products.id))
    .innerJoin(customers, eq(repairCases.customerId, customers.id))
    .where(
      and(
        inArray(products.productModelId, ids),
        // 🔴 셋 다 걸어야 한다. 위 머리말 참조.
        eq(repairCases.isDeleted, false),
        eq(products.isDeleted, false),
        eq(customers.isDeleted, false)
      )
    )
    // 형제 함수와 같은 차례(이름순, 동명 대비 id). 정렬 없는 조회는 계획이 바뀌면
    // 순서가 바뀐다.
    .orderBy(customers.name, customers.id);

  const byModelId = new Map<string, ProductModelCustomerOption[]>();
  for (const row of rows) {
    // product_model_id 는 nullable 이라 타입이 `string | null` 이다. 위 inArray 가
    // 이미 null 을 걸러 내므로 여기 걸리는 줄은 없지만, 타입을 좁히는 자리다.
    if (!row.productModelId) continue;
    const list = byModelId.get(row.productModelId);
    if (list) list.push({ id: row.id, name: row.name });
    else byModelId.set(row.productModelId, [{ id: row.id, name: row.name }]);
  }
  return byModelId;
}

/**
 * 모델 하나분. 위 함수에 그대로 얹는다 — 거르는 규칙과 차례를 두 곳에 따로 적어
 * 두면 한쪽만 고쳐지는 날이 온다(listCustomersForProductModel 과 같은 모양).
 */
export async function listRepairCaseCustomersForProductModel(
  productModelId: string
): Promise<ProductModelCustomerOption[]> {
  const byModelId = await listRepairCaseCustomersForProductModels([productModelId]);
  return byModelId.get(productModelId) ?? [];
}

/**
 * ── 반대 방향 — 고객사 하나에 붙은 제품 모델 ────────────────────────────────
 *
 * 고객사 상세의 `연결된 제품 모델` 구역이 쓴다. 위 네 함수의 거울상이라 같은
 * 파일에 둔다 — 거르는 규칙이 하나뿐인데 파일이 둘이면 한쪽만 고쳐지는 날이 온다.
 *
 * 🔴 **여기도 두 갈래다**(2026-10-08). 모델 → 고객사 방향이 수기 설정과 접수 기록을
 * 함께 보여 주는 것과 같은 까닭이고, 실측이 그 까닭 자체다 — 개발 DB 에서 수기 연결은
 * 6건(고객사 5곳)뿐인데 접수 건으로 이어지는 짝은 132쌍이고, 접수 건이 있는 고객사
 * 32곳 중 27곳이 이 구역에서 「없습니다」를 보고 있었다.
 */

/** 화면이 받는 모양. 고객사 상세는 `"use client"` 라 여기 담기는 칸이 그대로
 * 브라우저까지 실려 간다 — 목록을 그리고 링크를 거는 데 필요한 칸만 둔다.
 *
 * `kind` 가 `ProductModelKind | null` 인 것은 queries/product-models.ts 의
 * 다른 조회들과 같다. `null` 은 **미지정**이라는 뜻이지 "아직 못 읽었다"가
 * 아니다 — schema/product-models.ts 머리말이 적어 둔 대로 이 저장소는 kind 를
 * workflow_type 에서 유도하지 않기로 했으므로, 읽는 쪽이 추측으로 채우면 안 된다.
 *
 * `sources` 는 **어디에서 이어졌는가**다. 갈래 이름은 모델 → 고객사 방향이 쓰는
 * 것과 같은 한 벌이다(domain/product-model-customer-merge.ts 의
 * ProductModelCustomerSource) — 같은 사실을 두 방향에서 다른 말로 부르면 안 된다.
 * 🔴 **양쪽에 다 있으면 둘 다 들어 있다.** 한 줄로 합치되 출처는 둘 다 보인다. */
export type CustomerProductModelRow = {
  id: string;
  modelName: string;
  kind: ProductModelKind | null;
  sources: ProductModelCustomerSource[];
};

/**
 * 고객사 하나에 붙은 모델 전부를 **한 번의 조회**로. 결과 수에 비례해 조회가
 * 늘어나면 안 된다(위 함수들과 같은 규칙). 두 갈래를 각각 한 번씩 물어보고 JS 에서
 * 접는 길도 있었지만, 그러면 차례(모델명 → id)를 JS 로 다시 세워야 하고 그 비교가
 * postgres 와 미세하게 달라진다 — 기본 차례는 조회가 정한 그대로여야 한다.
 *
 * 그래서 **product_models 를 한 번 훑으면서 두 갈래를 `exists` 로 묻는다.** 모델마다
 * 한 줄이 나오므로 양쪽에 다 있어도 저절로 한 줄이고, 두 `exists` 의 참/거짓이 그대로
 * 출처가 된다. 묶음(group by)이나 distinct 로 접을 필요가 없다.
 *
 * 🔴 `product_models.is_deleted = false` 로 거른다 — **두 갈래 모두에** 걸린다(바깥
 * where 에 있다). 정방향이 customers 를 거르는 것과 정확히 같은 이유다: 휴지통에 든
 * 모델은 product_models 에 행이 그대로 남고 FK CASCADE 는 완전삭제 때만 움직이므로
 * 연결 줄도 남는다. 안 거르면 지운 모델이 고객사 상세에 계속 보인다.
 *
 * 🔴 접수 기록 쪽은 `repair_cases.is_deleted = false` 와 `products.is_deleted = false`
 * 도 본다 — 휴지통에 든 기록으로 모델을 만들어 내지 않기 위해서다(모델 → 고객사
 * 방향이 접수 건·장비·고객사 셋을 거르는 것과 같은 규칙). 고객사 자신은 여기서
 * 거르지 않는다: 보고 있는 화면이 그 고객사의 상세다.
 */
export async function listProductModelsForCustomer(
  customerId: string
): Promise<CustomerProductModelRow[]> {
  // uuid 가 아닌 값이 오면 postgres 가 22P02 로 터진다. 위 함수와 같은 판단으로
  // 조용히 빈 목록을 돌려준다.
  if (!UUID_PATTERN.test(customerId)) return [];

  // 사람이 손으로 걸어 둔 연결(product_model_customers). 바깥 줄의 모델을 가리키는
  // 상관 하위질의라 `product_models` 를 제 from 절에 넣지 않는다.
  const hasManualLink = exists(
    db
      .select({ one: sql`1` })
      .from(productModelCustomers)
      .where(
        and(
          eq(productModelCustomers.customerId, customerId),
          eq(productModelCustomers.productModelId, productModels.id)
        )
      )
  );

  // 접수 기록에서 나오는 연결. 경로는 repair_cases → products → product_models 로,
  // 모델 → 고객사 방향(listRepairCaseCustomersForProductModels)과 같은 길을 거꾸로
  // 탄다.
  const hasRepairCaseLink = exists(
    db
      .select({ one: sql`1` })
      .from(repairCases)
      .innerJoin(products, eq(repairCases.productId, products.id))
      .where(
        and(
          eq(repairCases.customerId, customerId),
          eq(products.productModelId, productModels.id),
          // 🔴 둘 다 걸어야 한다. 위 머리말 참조.
          eq(repairCases.isDeleted, false),
          eq(products.isDeleted, false)
        )
      )
  );

  const rows = await db
    .select({
      id: productModels.id,
      modelName: productModels.modelName,
      kind: productModels.kind,
      manual: hasManualLink.mapWith(Boolean),
      fromRepairCase: hasRepairCaseLink.mapWith(Boolean),
    })
    .from(productModels)
    .where(
      and(
        // 🔴 휴지통에 든 모델을 빼는 자리. 위 머리말 참조.
        eq(productModels.isDeleted, false),
        or(hasManualLink, hasRepairCaseLink)
      )
    )
    // 이름순. id 까지 얹는 것은 정방향과 같은 이유다 — 표시 이름이 같은 두 행이
    // 있을 수 있고, 정렬 없는 조회는 계획이 바뀌면 순서가 바뀐다.
    //
    // 🔴 이것이 고객사 상세 [연결된 제품 모델] 의 **기본** 차례다. 「종류별」을
    // 고르면 화면이 종류로 다시 묶지만, 묶음 안의 차례는 여기서 나온 모델명
    // 순서가 그대로 남는다(domain/product-model-sort.ts) — 이 줄을 지우면
    // 두 차례가 다 깨진다.
    .orderBy(productModels.modelName, productModels.id);

  return rows.map((row) => ({
    id: row.id,
    modelName: row.modelName,
    kind: row.kind,
    // 차례는 수기 먼저, 그다음 접수 기록 — 합치는 도메인 함수가 고객사를 늘어놓는
    // 차례와 같다(mergeProductModelCustomers).
    sources: [
      ...(row.manual ? (["MANUAL"] as const) : []),
      ...(row.fromRepairCase ? (["REPAIR_CASE"] as const) : []),
    ],
  }));
}
