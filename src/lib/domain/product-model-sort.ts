import {
  mergedProductModelCustomerNames,
  type MergedProductModelCustomer,
} from "./product-model-customer-merge";
import { PRODUCT_MODEL_KIND_CODES, type ProductModelKind } from "./product-model-kind";

/**
 * ============================================================================
 * 제품 모델 목록의 차례 — 「모델명 오름차순」 / 「종류별」 (2026-10-07 사용자 지시)
 * ============================================================================
 * 모델 목록이 나오는 자리는 둘이다.
 *
 *  - [제품 모델 관리] 목록 (ProductModelListScreen)
 *  - 고객사 상세의 [연결된 제품 모델] (CustomerDetailScreen)
 *
 * 두 화면이 **같은 말**을 쓰고 **같은 차례**를 내도록 고르개의 값·이름표·비교
 * 규칙을 여기 한 자리에 둔다. 글자를 화면마다 적으면 같은 기능이 화면마다 다른
 * 이름으로 불리게 되고, 그때 아무 오류도 나지 않는다(종류 이름표를 한 자리로
 * 모은 것과 같은 까닭 — product-model-kind.ts 머리말).
 *
 * ── 🔴 기본값은 지금까지와 같다 ──────────────────────────────────────────
 * `MODEL_NAME` 이 기본이고, 그 값에서는 **줄을 다시 세우지 않는다**. 두 화면이
 * 받는 목록은 이미 조회가 모델명 오름차순으로 준 것이다
 * (queries/product-models.ts 의 `listProductModels`,
 *  queries/product-model-customers.ts 의 `listProductModelsForCustomer`).
 * 여기서 JS 로 다시 비교하면 postgres 의 정렬 규칙과 미세하게 달라져, 아무도
 * 아무것도 고르지 않았는데 매주 보던 화면의 차례가 바뀐다.
 *
 * ── 🔴 「종류별」 안의 차례 — 들어온 차례 그대로다 ───────────────────────
 * 종류로 묶기만 하고 **같은 종류 안에서는 다시 비교하지 않는다.** `Array#sort`
 * 는 안정 정렬이므로(ES2019 에서 규격이 됐다) 묶음 안의 차례는 들어온 차례,
 * 곧 **모델명 오름차순** 그대로 남는다. 여기서 이름을 다시 비교하면 묶음 안의
 * 차례만 JS 규칙이 되어, 같은 목록이 고르개에 따라 두 가지 이름 차례를 갖게
 * 된다 — 그쪽이 더 이상하다.
 *
 * ── 🔴 종류가 없는 모델(`kind === null`)은 **맨 뒤**다 ───────────────────
 * 실제로 `kind` 가 비어 있는 모델이 많다(모델 마스터는 kind 를 workflow_type 에서
 * 유도하지 않는다 — schema/product-models.ts). 「미지정」 묶음이 Generator 와
 * Matcher 사이에 끼면 종류별로 읽으려던 눈이 한 번 걸린다. 목록 밖의 값(있어서는
 * 안 되지만 조회가 그대로 내보낸다 — productModelKindLabel 과 같은 태도)도 같은
 * 자리에 둔다.
 *
 * ── 🔴 「고객사」는 **한 화면에서만** 뜻이 있다 (2026-10-08) ──────────────
 * 고객사 상세의 [연결된 제품 모델] 은 **전부 같은 고객사**의 모델이다. 거기에
 * 「고객사」로 줄 세우기를 내놓으면 고르는 순간 아무것도 달라지지 않는 조작이
 * 하나 생긴다. 그래서 **어느 화면이 어떤 키를 쓰는지도 이 모듈이 정한다**
 * (PRODUCT_MODEL_LIST_SORT_KEYS · CUSTOMER_DETAIL_PRODUCT_MODEL_SORT_KEYS).
 * 화면이 제 손으로 키를 걸러 내면 그 걸러내기가 화면마다 따로 적히게 되고,
 * 그때 아무 오류도 나지 않는다 — 글자를 화면에 적지 않는 것과 같은 까닭이다.
 *
 * ── 순수 파일이다 ────────────────────────────────────────────────────────
 * server-only / drizzle / React 를 불러오지 않는다 — 두 화면 모두 클라이언트
 * 컴포넌트이고, 값만 다루는 규칙이라 시험도 값으로 볼 수 있어야 한다.
 * 이웃 product-model-customer-merge.ts 도 같은 뜻의 순수 파일이라 불러 쓴다.
 * ============================================================================
 */

export const PRODUCT_MODEL_SORT_KEYS = ["MODEL_NAME", "KIND", "CUSTOMER"] as const;
export type ProductModelSortKey = (typeof PRODUCT_MODEL_SORT_KEYS)[number];

/**
 * 고르개에 보이는 글자. 🔴 **두 화면이 이 한 벌을 쓴다** — 화면에 직접 적지 말 것.
 * 사용자가 쓴 말 그대로다(2026-10-07): 「종류별」 혹은 「모델명 오름차순」.
 * 「고객사 오름차순」은 2026-10-08 에 더했다 — 「모델명 오름차순」과 같은 짜임이다.
 */
export const PRODUCT_MODEL_SORT_LABELS: Record<ProductModelSortKey, string> = {
  MODEL_NAME: "모델명 오름차순",
  KIND: "종류별",
  CUSTOMER: "고객사 오름차순",
};

/**
 * [제품 모델 관리] 목록의 고르개에 서는 값들 — 전부다. 한 줄에 여러 고객사가
 * 붙으므로 「고객사」로 줄을 세울 뜻이 있다.
 */
export const PRODUCT_MODEL_LIST_SORT_KEYS: readonly ProductModelSortKey[] =
  PRODUCT_MODEL_SORT_KEYS;

/**
 * 고객사 상세 [연결된 제품 모델] 의 고르개에 서는 값들. 🔴 **「고객사」가 빠진다**
 * — 그 목록은 전부 같은 고객사의 모델이라 뜻이 없다(위 머리말).
 *
 * 빼는 값을 적지 않고 **남기는 규칙**을 적는 것은, 나중에 키가 하나 더 늘 때
 * 두 화면 모두에 저절로 나타나게 하기 위해서다 — 뜻이 없는 키만 여기서 빠진다.
 */
export const CUSTOMER_DETAIL_PRODUCT_MODEL_SORT_KEYS: readonly ProductModelSortKey[] =
  PRODUCT_MODEL_SORT_KEYS.filter((key) => key !== "CUSTOMER");

/** 아무것도 고르지 않은 상태. 🔴 지금까지의 차례(모델명 오름차순) 그대로다. */
export const DEFAULT_PRODUCT_MODEL_SORT: ProductModelSortKey = "MODEL_NAME";

/** 목록에 있는 값인가. `<select>` 가 돌려주는 글자를 좁히는 자리다. */
export function isProductModelSortKey(value: unknown): value is ProductModelSortKey {
  return typeof value === "string" && (PRODUCT_MODEL_SORT_KEYS as readonly string[]).includes(value);
}

/**
 * 이 함수가 행에서 직접 보는 칸은 `kind` 하나뿐이다. 두 화면의 행 타입이 서로
 * 다르므로(ProductModelListRow · CustomerProductModelRow) 공통으로 가진 칸만
 * 요구한다.
 *
 * 🔴 **고객사는 여기 없다.** 한쪽 행에만 있는 칸이고(목록 행의 customers ·
 * derivedCustomers), 무엇보다 두 갈래를 합치는 규칙은 이 모듈의 것이 아니다 —
 * 정렬에 쓸 값은 아래 `customersOf` 로 **인자로 받는다**(머리말의 순수 규칙).
 */
export type SortableProductModel = { kind: ProductModelKind | null };

/** 종류별 묶음의 차례. 코드 목록에 적힌 차례를 그대로 쓴다 — 거기가 정본이다. */
const KIND_RANK = new Map<string, number>(PRODUCT_MODEL_KIND_CODES.map((code, index) => [code, index]));

/** 종류가 없거나 목록 밖인 모델이 가는 자리 — 맨 뒤(위 머리말). */
const UNSPECIFIED_KIND_RANK = PRODUCT_MODEL_KIND_CODES.length;

function kindRank(kind: ProductModelKind | null): number {
  if (!kind) return UNSPECIFIED_KIND_RANK;
  return KIND_RANK.get(kind) ?? UNSPECIFIED_KIND_RANK;
}

/**
 * 「고객사 오름차순」이 비교하는 값 — **합친 이름 한 줄**이다. 합치는 일은
 * 부르는 쪽이 하고(mergeProductModelCustomers), 그 결과를 글로 만드는 규칙은
 * 화면이 쓰는 바로 그 함수를 그대로 쓴다 — 🔴 규칙을 여기 베껴 적으면 보이는
 * 글자와 줄 세우는 값이 갈라진다.
 *
 * 하나도 없으면 **빈 글자**다. 화면용 함수는 그 자리에 `-` 를 넣지만(없는 것을
 * 사람에게 보이는 말), 줄 세우기에서는 `-` 도 하나의 값이라 **맨 뒤로 보내야 할
 * 줄이 가운데에 선다.** 그래서 빈 것은 여기서 먼저 가른다.
 */
function customerSortName(customers: readonly MergedProductModelCustomer[]): string {
  return customers.length === 0 ? "" : mergedProductModelCustomerNames(customers);
}

/**
 * 고른 차례대로 새 배열을 돌려준다. 입력 배열은 건드리지 않는다 — 부르는 쪽이
 * 넘기는 것은 서버에서 받은 목록이거나 그것을 걸러 낸 결과라, 제자리 정렬을 하면
 * 남의 것을 바꾼다(mergeProductModelCustomers 와 같은 규칙).
 *
 * `customersOf` 는 「고객사 오름차순」에서만 쓴다 — 그 행의 **합친 고객사 목록**
 * (수기 + 접수 기록)을 돌려주면 된다. 넘기지 않으면 모든 줄이 「고객사 없음」으로
 * 읽히므로, 그 키를 고르개에 내놓는 화면은 반드시 함께 넘긴다.
 */
export function sortProductModels<T extends SortableProductModel>(
  rows: readonly T[],
  key: ProductModelSortKey,
  customersOf?: (row: T) => readonly MergedProductModelCustomer[]
): T[] {
  // 🔴 기본값에서는 줄을 다시 세우지 않는다 — 조회가 이미 모델명 오름차순으로
  // 준 것이고, 여기서 다시 비교하면 DB 의 정렬 규칙과 어긋난다(위 머리말).
  if (key === "MODEL_NAME") return [...rows];

  if (key === "CUSTOMER") {
    // 합치는 일은 줄마다 **한 번만** 한다. 비교 함수 안에서 부르면 같은 줄의
    // 고객사를 O(n log n) 번 합치게 된다(목록은 모델 104개다).
    const keyed = rows.map((row) => ({
      row,
      name: customersOf ? customerSortName(customersOf(row)) : "",
    }));
    keyed.sort((a, b) => {
      // 🔴 고객사가 없는 모델은 맨 뒤다. 빈 값이 앞에 몰리면(ko 비교에서 빈
      // 글자가 가장 작다) 목록의 첫 화면이 전부 빈칸이 되어 쓸모가 없어진다.
      const aEmpty = a.name === "";
      const bEmpty = b.name === "";
      if (aEmpty !== bEmpty) return aEmpty ? 1 : -1;
      // 같은 값이면(둘 다 비었을 때를 포함해) 모델명으로 갈린다 — 그 일은
      // 아래 안정 정렬이 한다(바로 아래 주석).
      return a.name.localeCompare(b.name, "ko");
    });
    // 같은 고객사 글자를 가진 줄들의 차례는 안정 정렬이 들어온 차례(= 조회가 준
    // 모델명 오름차순)를 그대로 지켜 준다 — 「종류별」과 같은 규칙이다. 여기서
    // 이름을 JS 로 다시 비교하면 그 묶음 안의 차례만 postgres 와 달라진다.
    return keyed.map((entry) => entry.row);
  }

  // 종류로만 묶는다. 같은 종류 안의 차례는 안정 정렬이 들어온 차례(= 모델명
  // 오름차순)를 그대로 지켜 준다(위 머리말).
  return [...rows].sort((a, b) => kindRank(a.kind) - kindRank(b.kind));
}
