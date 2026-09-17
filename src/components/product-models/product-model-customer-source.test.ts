import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * ============================================================================
 * 제품 모델의 고객사 — **두 갈래가 섞이지 않는가**
 * ============================================================================
 * 합치는 규칙 자체는 값으로 볼 수 있어 따로 있다
 * (lib/domain/product-model-customer-merge.test.ts). 여기서 보는 것은 값으로 볼 수
 * 없는 셋이다.
 *
 *  1. 🔴 **수정 폼에 넘어가는 `customers` 에 파생값이 섞이지 않는다.** 이 폼은
 *     "항상 전체 제출" 규약이라, 한 번 섞이면 사람이 폼을 열었다 저장하는 것만으로
 *     파생값 전부가 product_model_customers 에 수기 설정으로 써진다 — 아무도
 *     그러라고 하지 않았는데 자료가 바뀐다.
 *  2. 🔴 조회가 **소프트 삭제 셋**을 거른다 — 접수 건 · 장비 · 고객사.
 *  3. 🔴 목록 화면의 조회 횟수가 **모델 수에 따라 늘지 않는다**(104개 × N+1 금지).
 *
 * ── 왜 렌더하지 않고 원본을 읽는가 ──────────────────────────────────────
 * ProductModelEditForm 은 서버 액션(update-product-model)을 직접 import 하는
 * 클라이언트 컴포넌트라, 그 사슬 끝의 `server-only` 때문에 react-server 조건 없이
 * 도는 test:components 에서는 import 자체가 던진다. 조회 쪽(queries/*.ts)은 반대로
 * db/connection 이 DATABASE_URL 없이는 던진다. 양쪽 다 이웃 시험
 * (repair-labor-screen-source.test.ts)과 같은 방법으로 원본을 글자로 읽는다.
 * 실제 SQL 결과는 통합 시험의 몫이다.
 * ============================================================================
 */

const repoUrl = new URL("../../../", import.meta.url);
/** CRLF 로 받아 둔 저장소에서도 표지가 맞도록 LF 로 맞춘다. */
const read = (relativePath: string) =>
  readFileSync(new URL(relativePath, repoUrl), "utf8").replace(/\r\n/g, "\n");
/** 줄바꿈·들여쓰기 차이로 시험이 깨지지 않도록 공백을 하나로 접는다. */
const flat = (source: string) => source.replace(/\s+/g, " ");
/** "이 이름이 나오면 안 된다" 를 볼 때 쓴다. 이 저장소의 파일들은 주석에 서로의
 * 함수 이름을 자주 적어 두는데, 그 글자까지 세면 주석 한 줄에 시험이 깨진다. */
const code = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");

const editForm = read("src/components/product-models/ProductModelEditForm.tsx");
const detailScreen = read("src/components/product-models/ProductModelDetailScreen.tsx");
const listScreen = read("src/components/product-models/ProductModelListScreen.tsx");
const modelQueries = read("src/lib/db/queries/product-models.ts");
const customerQueries = read("src/lib/db/queries/product-model-customers.ts");

describe("🔴 수정 폼에 파생값이 섞이지 않는다", () => {
  test("선택칩은 productModel.customers(수기 설정) 하나로 시작한다", () => {
    assert.match(
      flat(editForm),
      /useState<ProductModelCustomerOption\[\]>\( productModel\.customers \)/,
      "여기에 파생값을 합치면 폼을 열었다 저장하는 것만으로 표에 써진다"
    );
  });

  test("폼이 합치는 함수를 부르지 않는다", () => {
    assert.ok(
      !code(editForm).includes("mergeProductModelCustomers"),
      "합치는 일은 보여 줄 때만이다 — 고르는 화면이 합치면 그 결과가 저장된다"
    );
  });

  test("저장 묶음의 customerIds 는 고른 목록에서만 나온다", () => {
    assert.match(flat(editForm), /customerIds: selectedCustomers\.map\(\(c\) => c\.id\)/);
    assert.ok(
      !flat(code(editForm)).includes("derivedCustomers.map((c) => c.id)"),
      "파생값의 id 가 저장 묶음에 실리면 안 된다"
    );
  });

  test("파생값은 setState 를 거치지 않는다 — 안내 글로만 쓰인다", () => {
    for (const forbidden of [
      "setSelectedCustomers(derivedCustomers",
      "...derivedCustomers",
      "concat(derivedCustomers",
    ]) {
      assert.ok(!flat(code(editForm)).includes(forbidden), `파생값을 선택 상태에 넣지 말 것: ${forbidden}`);
    }
    assert.ok(
      editForm.includes("접수 기록에서 자동:"),
      "지울 수 없는 것이 왜 지울 수 없는지 한 줄로 알려야 한다"
    );
  });

  test("상세 화면은 폼에 detail.customers 를 그대로 넘긴다", () => {
    const start = detailScreen.indexOf("<ProductModelEditForm");
    assert.ok(start >= 0, "수정 폼을 띄우는 자리를 찾지 못했다");
    const mount = flat(detailScreen.slice(start, detailScreen.indexOf("/>", start)));
    assert.ok(mount.includes("productModel={detail}"), "폼이 받는 것은 detail 그대로다");
    assert.ok(
      mount.includes("derivedCustomers={detail.derivedCustomers}"),
      "파생값은 detail.customers 가 아니라 따로 난 칸으로 넘어가야 한다"
    );
  });

  test("조회가 두 갈래를 각각 다른 칸에 담는다", () => {
    const flatQueries = flat(modelQueries);
    assert.ok(
      flatQueries.includes("customers: customersByModelId.get(m.id) ?? [], derivedCustomers: derivedCustomersByModelId.get(m.id) ?? []"),
      "목록 행에서 두 갈래가 각각 제 칸에 들어가야 한다"
    );
    assert.ok(
      flatQueries.includes("customers: modelCustomers, derivedCustomers: derivedModelCustomers"),
      "상세에서도 두 갈래가 각각 제 칸에 들어가야 한다"
    );
    assert.ok(
      !code(modelQueries).includes("mergeProductModelCustomers"),
      "🔴 조회가 합치면 안 된다 — 합친 값이 customers 칸에 실려 폼까지 간다"
    );
  });

  test("화면으로 넘기는 몫에도 두 칸이 따로 실린다", () => {
    const start = modelQueries.indexOf("export function toProductModelDetailForScreen");
    assert.ok(start >= 0, "화면용 변환 함수를 찾지 못했다");
    const body = flat(modelQueries.slice(start, modelQueries.indexOf("\n}", start)));
    assert.ok(body.includes("customers: detail.customers"));
    assert.ok(body.includes("derivedCustomers: detail.derivedCustomers"));
  });
});

describe("🔴 접수 기록 조회가 거르는 것", () => {
  /** 파생 조회 한 함수만 잘라낸다 — 파일 전체에 걸면 형제 함수의 필터에 걸린다. */
  const derivedQuery = (() => {
    const start = customerQueries.indexOf(
      "export async function listRepairCaseCustomersForProductModels"
    );
    assert.ok(start >= 0, "파생 조회 함수를 찾지 못했다");
    const end = customerQueries.indexOf("\n}", customerQueries.indexOf("return byModelId;", start));
    assert.ok(end > start, "파생 조회 함수의 끝을 찾지 못했다");
    return flat(customerQueries.slice(start, end));
  })();

  test("접수 건 · 장비 · 고객사 셋 다 소프트 삭제를 뺀다", () => {
    for (const filter of [
      "eq(repairCases.isDeleted, false)",
      "eq(products.isDeleted, false)",
      "eq(customers.isDeleted, false)",
    ]) {
      assert.ok(derivedQuery.includes(filter), `걸러야 한다: ${filter}`);
    }
  });

  test("경로는 repair_cases → products → product_models 이고 inner join 이다", () => {
    assert.ok(derivedQuery.includes(".from(repairCases)"));
    assert.ok(derivedQuery.includes("innerJoin(products, eq(repairCases.productId, products.id))"));
    assert.ok(
      derivedQuery.includes("innerJoin(customers, eq(repairCases.customerId, customers.id))"),
      "고객사는 접수 건의 customer_id 에서 온다"
    );
    assert.ok(derivedQuery.includes("inArray(products.productModelId, ids)"));
  });

  test("기존 수기 조회 두 형제는 그대로다", () => {
    // 이 작업은 표가 아니라 화면이 보여 주는 내용을 바꾼 것이다 — 수기 설정을 읽는
    // 길이 달라지면 안 된다.
    assert.ok(customerQueries.includes("export async function listCustomersForProductModels"));
    assert.ok(customerQueries.includes("export async function listCustomersForProductModel("));
    assert.ok(
      customerQueries.includes(".from(productModelCustomers)"),
      "수기 조회는 여전히 연결 표에서 읽어야 한다"
    );
  });

  test("파생값을 표에 쓰지 않는다 — 읽을 때 계산한다", () => {
    for (const write of ["insert(productModelCustomers", "delete(productModelCustomers", "update(productModelCustomers"]) {
      assert.ok(!code(customerQueries).includes(write), `읽는 파일이 표를 고치면 안 된다: ${write}`);
    }
  });
});

describe("🔴 조회 횟수가 모델 수에 따라 늘지 않는다", () => {
  test("목록은 모델 id 전부를 한 번에 물어본다", () => {
    const flatQueries = flat(modelQueries);
    assert.ok(
      flatQueries.includes("listRepairCaseCustomersForProductModels(modelIds)"),
      "모델 id 배열을 통째로 넘기는 판을 써야 한다"
    );
    assert.ok(
      !flatQueries.includes("modelRows.map(async"),
      "모델마다 도는 모양(N+1)이면 안 된다"
    );
  });

  test("파생 조회가 모델 하나짜리를 여럿분 판에 얹는다", () => {
    const start = customerQueries.indexOf(
      "export async function listRepairCaseCustomersForProductModel("
    );
    assert.ok(start >= 0, "모델 하나짜리 파생 조회를 찾지 못했다");
    const body = flat(customerQueries.slice(start, customerQueries.indexOf("\n}", start)));
    assert.ok(
      body.includes("listRepairCaseCustomersForProductModels([productModelId])"),
      "거르는 규칙과 차례를 두 곳에 따로 적으면 한쪽만 고쳐지는 날이 온다"
    );
  });

  test("상세는 두 갈래를 같은 Promise.all 에 묶는다", () => {
    assert.match(
      flat(modelQueries),
      /const \[productRows, modelCustomers, derivedModelCustomers\] = await Promise\.all/
    );
  });
});

describe("두 화면이 같은 규칙을 쓴다", () => {
  test("목록도 상세도 도메인 함수 하나로 합친다", () => {
    for (const [name, source] of [
      ["목록", listScreen],
      ["상세", detailScreen],
    ] as const) {
      assert.ok(
        source.includes("mergeProductModelCustomers"),
        `${name} 화면이 합치는 규칙을 따로 적으면 두 화면이 다른 말을 한다`
      );
    }
  });

  test("상세는 기록에서 온 것에 딱지를 붙인다", () => {
    assert.ok(
      flat(detailScreen).includes(`c.source === "REPAIR_CASE" && (`),
      "갈래를 구분해 보여야 한다"
    );
    assert.ok(detailScreen.includes("접수 기록"), "딱지에는 글자가 있어야 한다(색만으로 구분 금지)");
  });
});
