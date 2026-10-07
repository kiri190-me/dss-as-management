import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

import {
  mergeProductModelCustomers,
  type MergedProductModelCustomer,
} from "./product-model-customer-merge";
import { PRODUCT_MODEL_KIND_CODES, type ProductModelKind } from "./product-model-kind";
import {
  CUSTOMER_DETAIL_PRODUCT_MODEL_SORT_KEYS,
  DEFAULT_PRODUCT_MODEL_SORT,
  PRODUCT_MODEL_LIST_SORT_KEYS,
  PRODUCT_MODEL_SORT_KEYS,
  PRODUCT_MODEL_SORT_LABELS,
  isProductModelSortKey,
  sortProductModels,
} from "./product-model-sort";

/**
 * ============================================================================
 * 제품 모델 목록의 차례 — 「모델명 오름차순」 / 「종류별」 (2026-10-07 사용자 지시)
 * ============================================================================
 * 못 박는 것은 넷이다.
 *
 *  1. 🔴 **기본값이 지금까지와 같다** — 아무것도 고르지 않으면 모델명 오름차순이고,
 *     그 값에서는 **줄을 다시 세우지 않는다.** 여기서 JS 로 다시 비교하면 postgres
 *     의 정렬 규칙과 미세하게 달라져, 아무도 아무것도 고르지 않았는데 매주 보던
 *     화면의 차례가 바뀐다.
 *  2. 🔴 **종류가 없는 모델은 맨 뒤다** — 「미지정」 묶음이 가운데 끼면 종류별로
 *     읽으려던 눈이 한 번 걸린다. 실제로 kind 가 빈 모델이 많다.
 *  3. 🔴 **같은 종류 안의 차례는 들어온 차례 그대로다** — 조회가 모델명 오름차순
 *     으로 주고 정렬이 안정적이라 그 차례가 유지된다. 여기서 이름을 다시 비교하면
 *     묶음 안의 차례만 JS 규칙이 되어 같은 목록이 두 가지 이름 차례를 갖는다.
 *  4. 🔴 **두 화면이 같은 말을 쓴다** — [제품 모델 관리] 목록과 고객사 상세의
 *     [연결된 제품 모델]. 글자를 화면에 직접 적으면 한쪽만 고쳐지는 날이 오고,
 *     그때 아무 오류도 나지 않는다(product-model-kind.test.ts 와 같은 방법으로
 *     원본을 글자로 읽는다).
 *
 * ── 「고객사 오름차순」이 늘었다 (2026-10-08) ────────────────────────────────
 * 여기에 둘이 더 붙는다.
 *
 *  5. 🔴 **비교하는 값은 「합친 이름」이다** — 수기 설정과 접수 기록을 합친 결과이고
 *     (mergeProductModelCustomers), 수기만도 파생만도 아니다. 고객사가 하나도 없는
 *     모델은 **맨 뒤**다 — 빈 값이 앞에 몰리면 목록의 첫 화면이 전부 빈칸이 된다.
 *  6. 🔴 **고객사 상세의 고르개에는 그 값이 없다** — 거기 모델은 전부 같은 고객사의
 *     것이라 고르는 순간 아무것도 달라지지 않는 조작이 하나 생긴다. 어느 화면이 어떤
 *     키를 쓰는지도 이 모듈이 정하고(화면이 제 손으로 거르지 않는다), 아래 두
 *     describe 가 값과 원본 양쪽에서 그것을 못 박는다.
 * ============================================================================
 */

const repoUrl = new URL("../../../", import.meta.url);
/** CRLF 로 받아 둔 저장소에서도 표지가 맞도록 LF 로 맞춘다. */
const read = (relativePath: string) =>
  readFileSync(new URL(relativePath, repoUrl), "utf8").replace(/\r\n/g, "\n");
/** 줄바꿈·들여쓰기 차이로 시험이 깨지지 않도록 공백을 하나로 접는다. */
const flat = (source: string) => source.replace(/\s+/g, " ");
/** "이 글자가 남아 있으면 안 된다" 를 볼 때 쓴다 — 주석에 적힌 까닭에 걸리지 않게. */
const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");

const SCREENS: readonly [string, string][] = [
  ["제품 모델 목록", "src/components/product-models/ProductModelListScreen.tsx"],
  ["고객사 상세", "src/components/customers/CustomerDetailScreen.tsx"],
];

type Row = { id: string; modelName: string; kind: ProductModelKind | null };

/** 조회가 주는 모양 — 모델명 오름차순으로 들어온다. */
const row = (modelName: string, kind: ProductModelKind | null): Row => ({
  id: `id-${modelName}`,
  modelName,
  kind,
});

describe("고르개의 값과 글자", () => {
  test("🔴 고를 수 있는 값은 셋뿐이고, 글자는 사용자가 쓴 말 그대로다", () => {
    assert.deepEqual([...PRODUCT_MODEL_SORT_KEYS], ["MODEL_NAME", "KIND", "CUSTOMER"]);
    assert.deepEqual(PRODUCT_MODEL_SORT_LABELS, {
      MODEL_NAME: "모델명 오름차순",
      KIND: "종류별",
      CUSTOMER: "고객사 오름차순",
    });
  });

  test("🔴 기본값은 지금까지의 차례(모델명 오름차순)다", () => {
    assert.equal(DEFAULT_PRODUCT_MODEL_SORT, "MODEL_NAME");
  });

  test("목록 밖의 값은 고르개 값이 아니다", () => {
    for (const key of PRODUCT_MODEL_SORT_KEYS) {
      assert.equal(isProductModelSortKey(key), true, key);
    }
    for (const bogus of ["", " ", "model_name", "KIND ", "종류별", "NAME", "customer", "고객사", null, undefined, 0, {}, []]) {
      assert.equal(isProductModelSortKey(bogus), false, JSON.stringify(bogus));
    }
  });
});

/**
 * ── 🔴 어느 화면이 어떤 키를 쓰는가 ─────────────────────────────────────────
 * 화면이 제 손으로 키를 걸러 내면 그 걸러내기가 화면마다 따로 적히고, 키가 하나 더
 * 느는 날 한쪽만 고쳐진다. 그래서 **화면별 목록도 이 모듈이 내준다.**
 */
describe("🔴 화면마다 고를 수 있는 값이 다르다", () => {
  test("[제품 모델 관리] 목록은 전부 쓴다", () => {
    assert.deepEqual([...PRODUCT_MODEL_LIST_SORT_KEYS], [...PRODUCT_MODEL_SORT_KEYS]);
  });

  test("🔴 고객사 상세의 고르개에는 「고객사」가 없다", () => {
    // 그 목록은 전부 **같은 고객사**의 모델이라, 고르는 순간 아무것도 달라지지 않는
    // 조작이 하나 생긴다.
    assert.equal(
      CUSTOMER_DETAIL_PRODUCT_MODEL_SORT_KEYS.includes("CUSTOMER"),
      false,
      "같은 고객사의 모델만 있는 목록에 고객사 줄 세우기를 내놓으면 안 된다"
    );
    assert.deepEqual([...CUSTOMER_DETAIL_PRODUCT_MODEL_SORT_KEYS], ["MODEL_NAME", "KIND"]);
  });

  test("화면별 목록에 든 값은 모두 진짜 고르개 값이다", () => {
    for (const [name, keys] of [
      ["목록", PRODUCT_MODEL_LIST_SORT_KEYS],
      ["고객사 상세", CUSTOMER_DETAIL_PRODUCT_MODEL_SORT_KEYS],
    ] as const) {
      assert.ok(keys.length > 0, `${name} 의 고르개가 비었다`);
      for (const key of keys) {
        assert.equal(isProductModelSortKey(key), true, `${name}: ${key}`);
      }
      // 🔴 기본값이 빠지면 고르개가 아무것도 안 고른 상태를 보여 주지 못한다.
      assert.ok(keys.includes(DEFAULT_PRODUCT_MODEL_SORT), `${name} 에 기본값이 없다`);
    }
  });
});

describe("🔴 모델명 오름차순 — 줄을 다시 세우지 않는다", () => {
  test("조회가 준 차례가 한 줄도 움직이지 않는다", () => {
    // 일부러 이름순이 아닌 차례로 넣는다. 다시 세우지 않는다는 것은 "들어온 대로
    // 내보낸다"는 뜻이지 "이름순으로 만들어 준다"가 아니다 — 그 일은 조회가 한다.
    const rows = [row("TG-300", "MATCHER"), row("AA-1", null), row("TG-100", "GENERATOR")];
    assert.deepEqual(
      sortProductModels(rows, "MODEL_NAME").map((r) => r.modelName),
      ["TG-300", "AA-1", "TG-100"]
    );
  });

  test("새 배열을 돌려주고 받은 배열은 건드리지 않는다", () => {
    const rows = [row("TG-300", "MATCHER"), row("TG-100", "GENERATOR")];
    const before = rows.map((r) => r.modelName);

    const sorted = sortProductModels(rows, "MODEL_NAME");
    assert.notEqual(sorted, rows, "같은 배열을 그대로 돌려주면 부르는 쪽이 남의 것을 들고 있게 된다");
    assert.deepEqual(rows.map((r) => r.modelName), before);

    sortProductModels(rows, "KIND");
    assert.deepEqual(rows.map((r) => r.modelName), before, "종류별에서도 제자리 정렬을 하면 안 된다");
  });

  test("빈 목록도 그대로 돈다", () => {
    assert.deepEqual(sortProductModels([], "MODEL_NAME"), []);
    assert.deepEqual(sortProductModels([], "KIND"), []);
  });
});

describe("🔴 종류별 — 묶는 차례와 종류 없는 모델의 자리", () => {
  test("묶음의 차례는 코드 목록에 적힌 차례 그대로다", () => {
    // 정본은 validation/product-model-input.ts 의 PRODUCT_MODEL_KIND_CODES 다.
    // 여기서 차례를 따로 적으면 한쪽만 고쳐지는 날이 온다.
    const rows = PRODUCT_MODEL_KIND_CODES.map((kind, index) => row(`M-${index}`, kind));
    const shuffled = [...rows].reverse();
    assert.deepEqual(
      sortProductModels(shuffled, "KIND").map((r) => r.kind),
      [...PRODUCT_MODEL_KIND_CODES]
    );
  });

  test("🔴 종류가 없는 모델(kind === null)은 맨 뒤다", () => {
    const rows = [
      row("AA-1", null),
      row("BB-1", "TOTAL_CONTROLLER"),
      row("CC-1", null),
      row("DD-1", "GENERATOR"),
    ];
    assert.deepEqual(
      sortProductModels(rows, "KIND").map((r) => r.modelName),
      ["DD-1", "BB-1", "AA-1", "CC-1"]
    );
  });

  test("목록 밖의 값도 맨 뒤다 — 가운데 끼어 들지 않는다", () => {
    // 조회는 목록 밖의 값도 그대로 내보낸다(productModelKindLabel 과 같은 태도).
    // 그때 그 줄이 Generator 와 Matcher 사이에 끼면 종류별로 읽을 수 없다.
    const rows = [
      row("BOGUS", "RECTIFIER" as ProductModelKind),
      row("MM-1", "MATCHER"),
      row("GG-1", "GENERATOR"),
    ];
    assert.deepEqual(
      sortProductModels(rows, "KIND").map((r) => r.modelName),
      ["GG-1", "MM-1", "BOGUS"]
    );
  });

  test("🔴 같은 종류 안의 차례는 들어온 차례(= 모델명 오름차순) 그대로다", () => {
    const rows = [
      row("GA-1", "GENERATOR"),
      row("MA-1", "MATCHER"),
      row("GB-2", "GENERATOR"),
      row("MB-2", "MATCHER"),
      row("GC-3", "GENERATOR"),
    ];
    assert.deepEqual(
      sortProductModels(rows, "KIND").map((r) => r.modelName),
      ["GA-1", "GB-2", "GC-3", "MA-1", "MB-2"]
    );
  });

  test("종류 없는 모델끼리의 차례도 들어온 차례 그대로다", () => {
    const rows = [row("AA-1", null), row("AB-2", null), row("AC-3", null)];
    assert.deepEqual(
      sortProductModels(rows, "KIND").map((r) => r.modelName),
      ["AA-1", "AB-2", "AC-3"]
    );
  });

  test("한 줄도 빠지거나 늘지 않는다", () => {
    const rows = [row("AA-1", null), row("MM-1", "MATCHER"), row("GG-1", "GENERATOR")];
    for (const key of PRODUCT_MODEL_SORT_KEYS) {
      const sorted = sortProductModels(rows, key);
      assert.equal(sorted.length, rows.length, key);
      assert.deepEqual(
        [...sorted].map((r) => r.id).sort(),
        rows.map((r) => r.id).sort(),
        key
      );
    }
  });
});

/**
 * ── 「고객사 오름차순」 ─────────────────────────────────────────────────────
 * 비교하는 값은 **화면이 보여 주는 바로 그 글자**다 — 수기 설정과 접수 기록을
 * 합친 결과(mergeProductModelCustomers). 그래서 여기 표본도 그 함수로 만든다:
 * 합치는 규칙을 시험이 베껴 적으면, 규칙이 바뀌는 날 시험만 옛말을 하게 된다.
 */
describe("🔴 고객사 오름차순 — 합친 이름으로 선다", () => {
  const customer = (name: string) => ({ id: `cust-${name}`, name });
  /** 그 모델의 고객사 목록을 합친 것. 화면이 표에 그리는 값과 같은 함수다. */
  const merged = (
    manual: readonly { id: string; name: string }[],
    derived: readonly { id: string; name: string }[]
  ): MergedProductModelCustomer[] => mergeProductModelCustomers(manual, derived);

  test("🔴 수기만도 파생만도 아닌 **합친 이름**으로 선다", () => {
    // P 는 수기 「하」 + 기록 「가」 → 합치면 수기가 앞이라 「하, 가」로 읽힌다.
    // Q 는 기록 「나」 하나뿐 → 「나」.
    // 합친 이름으로 세우면 Q → P 다. 수기만 보면(「하」 vs 없음) P → Q 이고,
    // 파생만 보면(「가」 vs 「나」) 역시 P → Q 다 — 셋이 서로 다른 답을 낸다.
    const rows = [
      { ...row("M-P", null), customers: merged([customer("하")], [customer("가")]) },
      { ...row("M-Q", null), customers: merged([], [customer("나")]) },
    ];
    assert.deepEqual(
      sortProductModels(rows, "CUSTOMER", (r) => r.customers).map((r) => r.modelName),
      ["M-Q", "M-P"],
      "수기만 혹은 파생만 보고 세우면 이 차례가 뒤집힌다"
    );
  });

  test("🔴 고객사가 없는 모델은 맨 뒤다", () => {
    // 조회가 준 차례(모델명 오름차순)대로 넣는다. 빈 글자는 ko 비교에서 가장
    // 작으므로, 따로 가르지 않으면 빈 줄이 **앞에** 몰린다.
    const rows = [
      { ...row("AA-1", null), customers: merged([], []) },
      { ...row("BB-2", null), customers: merged([customer("나")], []) },
      { ...row("CC-3", null), customers: merged([], []) },
      { ...row("DD-4", null), customers: merged([], [customer("가")]) },
    ];
    assert.deepEqual(
      sortProductModels(rows, "CUSTOMER", (r) => r.customers).map((r) => r.modelName),
      ["DD-4", "BB-2", "AA-1", "CC-3"],
      "고객사가 없는 모델이 앞에 서면 목록의 첫 화면이 전부 빈칸이 된다"
    );
  });

  test("같은 고객사 글자면 들어온 차례(= 모델명 오름차순)로 갈린다", () => {
    const rows = [
      { ...row("M-1", null), customers: merged([customer("가")], []) },
      { ...row("M-2", null), customers: merged([customer("나")], []) },
      { ...row("M-3", null), customers: merged([customer("가")], []) },
    ];
    assert.deepEqual(
      sortProductModels(rows, "CUSTOMER", (r) => r.customers).map((r) => r.modelName),
      ["M-1", "M-3", "M-2"]
    );
  });

  test("고객사가 하나도 없는 모델끼리의 차례도 들어온 차례 그대로다", () => {
    const rows = [
      { ...row("AA-1", null), customers: merged([], []) },
      { ...row("AB-2", null), customers: merged([], []) },
      { ...row("AC-3", null), customers: merged([], []) },
    ];
    assert.deepEqual(
      sortProductModels(rows, "CUSTOMER", (r) => r.customers).map((r) => r.modelName),
      ["AA-1", "AB-2", "AC-3"]
    );
  });

  test("고객사를 안 넘기면 전부 「없음」으로 읽혀 들어온 차례가 남는다", () => {
    // 고객사 상세처럼 그 키를 고르개에 내놓지 않는 화면이 실수로 이 키를 넘겨도
    // 목록이 뒤섞이지 않아야 한다.
    const rows = [row("ZZ-9", null), row("AA-1", "GENERATOR")];
    assert.deepEqual(
      sortProductModels(rows, "CUSTOMER").map((r) => r.modelName),
      ["ZZ-9", "AA-1"]
    );
  });

  test("새 배열을 돌려주고 받은 배열은 건드리지 않는다", () => {
    const rows = [
      { ...row("M-1", null), customers: merged([customer("하")], []) },
      { ...row("M-2", null), customers: merged([customer("가")], []) },
    ];
    const before = rows.map((r) => r.modelName);
    const sorted = sortProductModels(rows, "CUSTOMER", (r) => r.customers);
    assert.notEqual(sorted, rows);
    assert.deepEqual(rows.map((r) => r.modelName), before, "제자리 정렬을 하면 남의 것을 바꾼다");
    assert.deepEqual(sorted.map((r) => r.modelName), ["M-2", "M-1"]);
  });

  test("한 줄도 빠지거나 늘지 않는다", () => {
    const rows = [
      { ...row("AA-1", null), customers: merged([], []) },
      { ...row("BB-2", null), customers: merged([customer("가")], [customer("나")]) },
      { ...row("CC-3", "MATCHER" as ProductModelKind), customers: merged([], [customer("다")]) },
    ];
    const sorted = sortProductModels(rows, "CUSTOMER", (r) => r.customers);
    assert.equal(sorted.length, rows.length);
    assert.deepEqual(
      sorted.map((r) => r.id).sort(),
      rows.map((r) => r.id).sort()
    );
  });

  test("빈 목록도 그대로 돈다", () => {
    assert.deepEqual(sortProductModels([], "CUSTOMER"), []);
  });
});

describe("🔴 두 화면이 같은 말을 쓴다 — 원본을 글자로 읽는다", () => {
  test("두 화면 모두 도메인 한 자리에서 가져다 쓴다", () => {
    for (const [name, relativePath] of SCREENS) {
      const source = read(relativePath);
      assert.match(
        source,
        /from "@\/lib\/domain\/product-model-sort"/,
        `${name} 이 차례 규칙을 공용 자리에서 가져오지 않는다`
      );
      assert.ok(source.includes("sortProductModels("), `${name} 이 공용 비교 규칙을 쓰지 않는다`);
      assert.ok(
        source.includes("PRODUCT_MODEL_SORT_LABELS["),
        `${name} 이 공용 이름표를 쓰지 않는다`
      );
      assert.ok(
        source.includes("DEFAULT_PRODUCT_MODEL_SORT"),
        `${name} 의 기본값이 공용 기본값이 아니다`
      );
    }
  });

  test("🔴 화면에 이름표를 베껴 적지 않았다", () => {
    for (const [name, relativePath] of SCREENS) {
      const source = stripComments(read(relativePath));
      for (const label of Object.values(PRODUCT_MODEL_SORT_LABELS)) {
        assert.ok(
          !source.includes(`"${label}"`) && !source.includes(`>${label}<`),
          `${name} 에 고르개 글자가 직접 적혀 있다: ${label}`
        );
      }
    }
  });

  test("🔴 목록 화면은 걸러낸 뒤에 줄을 세운다 — 보이는 차례와 범위 고르기가 어긋나면 안 된다", () => {
    const listScreen = flat(read(SCREENS[0][1]));
    assert.ok(
      listScreen.includes("sortProductModels(matchedRows, sortKey, mergedCustomersOf)"),
      "검색으로 걸러낸 결과 위에 차례를 얹어야 한다"
    );
    // Shift 범위 고르기가 받는 차례도 같은 결과여야 한다.
    assert.ok(
      listScreen.includes("orderedIds: filteredRows.map((row) => row.id)"),
      "범위 고르기가 화면에 보이는 차례를 받아야 한다"
    );
  });

  test("🔴 목록 화면이 넘기는 고객사는 **합친** 목록이다 — 표에 보이는 값과 같아야 한다", () => {
    const listScreen = flat(read(SCREENS[0][1]));
    assert.match(
      listScreen,
      /function mergedCustomersOf\(row: ProductModelListRow\) \{ return mergeProductModelCustomers\(row\.customers, row\.derivedCustomers\); \}/,
      "줄 세우는 값과 보여 주는 값이 같은 한 자리에서 나와야 한다"
    );
    // 표·카드가 그리는 글자도 같은 자리를 거친다 — 둘이 갈라지면 「고객사 오름차순」이
    // 화면에 안 보이는 값으로 줄을 세우게 된다.
    assert.ok(listScreen.includes("mergedProductModelCustomerNames(mergedCustomersOf(row))"));
    assert.ok(listScreen.includes("const merged = mergedCustomersOf(row);"));
  });

  test("🔴 고르개의 값 목록도 화면마다 도메인에서 받는다 — 화면이 직접 거르지 않는다", () => {
    const listScreen = flat(read(SCREENS[0][1]));
    const customerDetail = flat(read(SCREENS[1][1]));

    assert.ok(
      listScreen.includes("PRODUCT_MODEL_LIST_SORT_KEYS.map((key) => ("),
      "목록 화면이 제 몫의 키 목록을 쓰지 않는다"
    );
    assert.ok(
      customerDetail.includes("CUSTOMER_DETAIL_PRODUCT_MODEL_SORT_KEYS.map((key) => ("),
      "고객사 상세가 제 몫의 키 목록을 쓰지 않는다"
    );

    // 🔴 고객사 상세가 전체 목록을 그리면 거기 「고객사」가 끼어든다.
    // 앞에 글자가 붙지 않은 **그 이름 자체**를 본다 —
    // CUSTOMER_DETAIL_PRODUCT_MODEL_SORT_KEYS 가 그 글자를 품고 있다.
    assert.equal(
      /(?<![A-Z_])PRODUCT_MODEL_SORT_KEYS/.test(stripComments(read(SCREENS[1][1]))),
      false,
      "고객사 상세는 전체 키 목록을 보면 안 된다 — 「고객사」가 고르개에 선다"
    );
    // 화면이 제 손으로 거르는 것도 막는다 — 그 걸러내기가 화면마다 따로 적히면
    // 키가 하나 더 느는 날 한쪽만 고쳐진다.
    for (const [name, relativePath] of SCREENS) {
      const body = stripComments(read(relativePath));
      assert.equal(body.includes(`!== "CUSTOMER"`), false, `${name} 이 키를 직접 걸러 낸다`);
      assert.equal(body.includes(`=== "CUSTOMER"`), false, `${name} 이 키를 직접 걸러 낸다`);
    }
  });
});
