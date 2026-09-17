/**
 * ============================================================================
 * 제품 모델의 고객사 — 사람이 고른 것 + 접수 기록에서 나온 것
 * ============================================================================
 * 제품 모델 마스터에는 고객사가 두 갈래로 있다.
 *
 *  - **수기(MANUAL)** — product_model_customers 에 사람이 골라 둔 설정이다.
 *    접수 건이 하나도 없는 모델에도 미리 붙여 둘 수 있고, 수정 폼이 고치는 것도
 *    이쪽 하나뿐이다(queries/product-model-customers.ts 의 앞 두 함수).
 *  - **기록(REPAIR_CASE)** — 그 모델의 장비로 실제 접수된 건의 고객사다. 표에
 *    쓰지 않고 읽을 때 계산한다(같은 파일의 listRepairCaseCustomersForProductModels).
 *
 * 🔴 **두 갈래를 데이터에서 섞지 않는다.** 섞어서 수정 폼에 넘기면, 사람이 폼을
 * 열었다 저장하는 순간 파생값 전부가 수기 설정으로 표에 써진다 — 아무도 그러라고
 * 하지 않았는데 자료가 바뀌는 일이다. 그래서 합치는 일은 **보여 주기 직전**, 이
 * 함수 하나에서만 일어난다.
 *
 * 목록 화면과 상세 화면이 같은 함수를 쓴다. 규칙을 두 곳에 따로 적으면 두 화면이
 * 다른 말을 하게 된다.
 * ============================================================================
 */

/** 이 고객사가 어디에서 왔는가. 화면이 기록 쪽에 딱지를 붙이는 데 쓴다. */
export type ProductModelCustomerSource = "MANUAL" | "REPAIR_CASE";

export type MergedProductModelCustomer = {
  id: string;
  name: string;
  source: ProductModelCustomerSource;
};

/** 이름순, 같은 이름이면 id 순. 표시 이름이 같은 두 고객사가 있을 수 있어서
 * (정규화 유니크는 이름을 다듬어 비교한다) id 까지 본다 — 조회가 정렬을 거는
 * 이유와 같다. */
function byNameThenId(
  a: { id: string; name: string },
  b: { id: string; name: string }
): number {
  const byName = a.name.localeCompare(b.name, "ko");
  return byName !== 0 ? byName : a.id.localeCompare(b.id);
}

/**
 * 두 갈래를 화면용 한 목록으로.
 *
 *  - 같은 고객사가 양쪽에 있으면 **한 번만** 나오고, 갈래는 `MANUAL` 이다
 *    (사람이 고른 사실이 더 강한 말이고, 수정 폼에서 뺄 수 있는 것도 그쪽이다).
 *  - 🔴 **기록에 없는 수기 연결도 그대로 남는다.** 접수 건이 한 건도 없는 모델에
 *    미리 붙여 둔 고객사가 이 함수를 지나며 사라지면 안 된다.
 *  - 차례는 **수기 먼저(이름순), 그다음 기록(이름순)** 이다.
 *
 * 입력 배열은 건드리지 않는다(새 배열을 만들어 정렬한다) — 부르는 쪽이 넘긴 것은
 * 조회 결과이거나 폼의 상태값이라, 이 함수가 제자리 정렬을 하면 남의 것을 바꾼다.
 */
export function mergeProductModelCustomers(
  manual: readonly { id: string; name: string }[],
  derived: readonly { id: string; name: string }[]
): MergedProductModelCustomer[] {
  const manualIds = new Set(manual.map((c) => c.id));

  const manualPart: MergedProductModelCustomer[] = manual
    .map((c) => ({ id: c.id, name: c.name, source: "MANUAL" as const }))
    .sort(byNameThenId);

  const seenDerived = new Set<string>();
  const derivedPart: MergedProductModelCustomer[] = [];
  for (const c of derived) {
    // 수기 쪽에 이미 있으면 거기서 이미 나왔다. 기록 쪽 자체에 같은 id 가 두 번
    // 오는 일은 조회가 막지만(selectDistinct), 이 함수는 조회 하나에만 매인 것이
    // 아니므로 여기서도 한 번 접는다.
    if (manualIds.has(c.id) || seenDerived.has(c.id)) continue;
    seenDerived.add(c.id);
    derivedPart.push({ id: c.id, name: c.name, source: "REPAIR_CASE" });
  }
  derivedPart.sort(byNameThenId);

  return [...manualPart, ...derivedPart];
}

/**
 * 합친 목록을 한 줄 글로. 하나도 없으면 `-` — 제품 모델 화면의 다른 칸들과 같은
 * 규칙이다(없는 것과 빈 것을 다르게 보이게 할 이유가 없다).
 *
 * 갈래 표시가 필요 없는 자리(목록 화면의 표·카드)가 쓴다. 상세 화면은 갈래를
 * 딱지로 보여야 해서 이 함수 대신 배열을 직접 그린다.
 */
export function mergedProductModelCustomerNames(
  merged: readonly MergedProductModelCustomer[]
): string {
  return merged.length === 0 ? "-" : merged.map((c) => c.name).join(", ");
}
