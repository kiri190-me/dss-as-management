import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * ============================================================================
 * [전체 A/S 현황]의 **다섯 필터가 모두 복수 선택 칸인가** (2026-11-11)
 * ============================================================================
 * 사용자 개선요청: 한 종류의 필터 안에서 여럿 고를 수 있게. [현재 상태]가 먼저
 * 되었고(in-house-filter-matches-dashboard.test.ts 의 뒤 두 시험), 이 파일은
 * **나머지 넷**(제품군·유·무상·고객사·우선순위)을 본다.
 *
 * ── 왜 렌더하지 않고 원본을 글자로 읽는가 ───────────────────────────────
 * RepairCaseFilters 는 "use client" 에 useUiText 까지 묶인 컴포넌트라 여기서
 * 통째로 그릴 수 없고, 그릴 수 있다 해도 드롭다운은 **접힌 채로 태어나** 정적
 * 렌더로는 목록을 못 본다(이 저장소에는 jsdom 이 없다). 이웃
 * fault-symptom-result-link.test.ts · in-house-filter-matches-dashboard.test.ts
 * 가 같은 사정을 같은 방법으로 푼다.
 *
 * 🔴 **값으로 도는 부분은 여기서 재지 않는다.** 거르는 규칙과 주소줄은
 * lib/domain/repair-case-filters.test.ts, 닫힌 칸의 글자와 체크 뒤집기는
 * components/common/checkbox-filter-dropdown.test.ts 가 잰다. 여기서 보는 것은
 * **화면이 그 부품을 실제로 그렇게 쓰는가**뿐이다 — 값 쪽 시험이 전부 통과한
 * 채로 화면만 <select> 로 되돌아가면 사용자가 보는 것은 전과 똑같아진다.
 * ============================================================================
 */

const repoUrl = new URL("../../../", import.meta.url);
/** CRLF 로 받아 둔 저장소에서도 표지가 맞도록 LF 로 맞춘다. */
const read = (relativePath: string) =>
  readFileSync(new URL(relativePath, repoUrl), "utf8").replace(/\r\n/g, "\n");

/**
 * 🔴 주석을 걷어낸 뒤에 센다. 이 화면의 주석은 "왜 그렇게 했는가"를 길게 적는
 * 자리라 `<select>` 도 "미지정" 도 거기 적혀 있다 — 날것으로 세면 코드를
 * 되돌려도 주석만으로 영영 통과한다. 걷어내기가 정말 듣는지는 아래 ⓪ 에서 먼저
 * 잰다(정규식은 in-house-filter-matches-dashboard.test.ts 와 같은 모양이다 —
 * 안쪽을 `[\s\S]*?` 로 적으면 다른 주석의 닫힘까지 뛰어넘어 코드를 통째로 지운다).
 */
function withoutComments(source: string): string {
  return source
    .replace(/\{\s*\/\*(?:[^*]|\*(?!\/))*\*\/\s*\}/g, " ") // JSX 주석 {/* … */}
    .replace(/\/\*(?:[^*]|\*(?!\/))*\*\//g, " ") // 블록 주석
    .replace(/(^|[^:"'`\\])\/\/[^\n]*/gm, "$1"); // 줄 주석 ("https://" 는 건드리지 않는다)
}

/** 줄바꿈·들여쓰기 차이로 깨지지 않도록 공백을 하나로 접는다. */
const flat = (source: string) => source.replace(/\s+/g, " ");

const filtersSource = read("src/components/repair-cases/RepairCaseFilters.tsx");
const listPageSource = read("src/components/repair-cases/RepairCaseListPage.tsx");

const strippedFilters = flat(withoutComments(filtersSource));
const strippedListPage = flat(withoutComments(listPageSource));

/**
 * `id="…"` 자리에서 **그 요소의 여는 `<`** 까지 되짚는다.
 *
 * 🔴 그냥 바로 앞의 `<` 를 잡으면 안 된다 — 타입 인자를 적은 칸
 * (`<CheckboxFilterDropdown<Priority> id="repair-case-priority" …`)에서는 그것이
 * `<Priority>` 의 `<` 다. 타입 인자의 `<` 는 **바로 앞이 낱말 글자**이고, 여는
 * 태그의 `<` 는 공백이나 `{` 뒤에 온다. 그 차이로 가른다.
 */
function openingTagStart(at: number): number {
  for (let i = at; i >= 0; i -= 1) {
    if (strippedFilters[i] !== "<") continue;
    const before = i === 0 ? " " : strippedFilters[i - 1];
    if (!/[\w$]/.test(before)) return i;
  }
  return -1;
}

/**
 * 칸 하나를 그리는 `<CheckboxFilterDropdown … />` 한 덩어리만 잘라낸다.
 *
 * 🔴 넉넉히 잘라 보면 **다음 칸까지 딸려 들어와** 무엇을 재는지 알 수 없게 된다
 * (이웃 시험이 실제로 그 함정에 빠졌다). id 바로 앞의 `<` 에서 시작해 **첫 `/>`
 * 에서** 끊는다 — 앞으로 되짚는 까닭은 재야 할 것 가운데 **태그 이름**이 있어서다
 * (id 자리부터 자르면 `<CheckboxFilterDropdown` 이 덩어리 밖에 남는다).
 */
function fieldBlock(id: string): string {
  const at = strippedFilters.indexOf(`id="${id}"`);
  assert.notEqual(at, -1, `${id} 칸을 찾지 못했다 — 이름이 바뀌었으면 이 시험도 함께 고칠 것`);
  const start = openingTagStart(at);
  assert.notEqual(start, -1, `${id} 칸의 여는 태그를 찾지 못했다`);
  const end = strippedFilters.indexOf("/>", start);
  assert.notEqual(end, -1, `${id} 칸의 끝(/>)을 찾지 못했다`);
  const block = strippedFilters.slice(start, end);
  assert.ok(block.length > 0, `${id} 덩어리를 못 잘랐다 — 아래 단언이 공짜로 통과한다`);
  return block;
}

/** 이번 조각이 바꾼 네 칸. [현재 상태]는 앞 조각에서 이미 되었다. */
const FOUR_FIELDS = [
  { id: "repair-case-product-category", label: "제품군", selected: "filters.productCategories" },
  { id: "repair-case-billing-type", label: "유·무상", selected: "filters.billingTypes" },
  { id: "repair-case-customer", label: "고객사", selected: "filters.customerIds" },
  { id: "repair-case-priority", label: "우선순위", selected: "filters.priorities" },
] as const;

// ───────────────────────────────────── ⓪ 재는 도구가 정말 듣는가

describe("🔵 재는 도구", () => {
  test("주석 걷어내기가 정말 듣는다 — 안 들으면 아래가 주석만으로 통과한다", () => {
    assert.ok(
      filtersSource.includes("2026-11-11 사용자 개선요청의 나머지"),
      "표지로 삼은 주석 글귀가 사라졌다 — 이 시험도 함께 고칠 것"
    );
    assert.ok(
      !withoutComments(filtersSource).includes("2026-11-11 사용자 개선요청의 나머지"),
      "주석이 그대로 남아 있다 — 아래 부정 단언들이 무의미해진다"
    );
    assert.ok(strippedFilters.includes("제품군"), "걷어내다 칸 이름까지 날렸다");
    assert.ok(strippedFilters.includes("미지정"), "걷어내다 '미지정' 선택지까지 날렸다");
  });

  test("칸 덩어리 자르기가 칸 하나에서 끝난다 — 옆 칸이 딸려 오지 않는다", () => {
    // 덩어리가 넘치면 "제품군 칸에 우선순위 값이 들어 있다"는 식으로 아무 단언이나
    // 통과한다. 제 label 만 있고 남의 label 은 없는지로 잰다.
    for (const field of FOUR_FIELDS) {
      const block = fieldBlock(field.id);
      assert.ok(block.includes(`label="${field.label}"`), `${field.id} 에 제 이름이 없다`);
      for (const other of FOUR_FIELDS) {
        if (other.id === field.id) continue;
        assert.ok(
          !block.includes(`label="${other.label}"`),
          `${field.id} 덩어리에 ${other.label} 칸이 딸려 들어왔다`
        );
      }
    }
  });
});

// ───────────────────── ① 네 칸이 모두 복수 선택 부품을 쓴다

describe("🔴 네 칸이 복수 선택 칸이다", () => {
  test("공용 부품을 가져다 쓴다 — 이 화면에 따로 만들지 않았다", () => {
    assert.match(
      filtersSource,
      /^import CheckboxFilterDropdown from "@\/components\/common\/CheckboxFilterDropdown";$/m
    );
  });

  test("네 칸 다 <CheckboxFilterDropdown> 이고, 고른 값을 배열 칸에서 읽는다", () => {
    for (const field of FOUR_FIELDS) {
      const block = fieldBlock(field.id);
      assert.ok(
        block.includes("<CheckboxFilterDropdown"),
        `${field.id} 가 복수 선택 칸이 아니다`
      );
      assert.ok(
        block.includes(`selected={${field.selected}}`),
        `${field.id} 가 ${field.selected} 를 읽지 않는다`
      );
    }
  });

  test("🔴 한 번에 하나만 고르던 <select> 가 한 칸도 남지 않았다", () => {
    // 되돌리는 쪽은 "시험이 줄어드는 것"으로도 안 드러난다 — 값 쪽 시험은 전부
    // 통과한 채로 화면만 예전으로 돌아간다.
    assert.ok(!strippedFilters.includes("<select"), "필터 카드에 <select> 가 되살아났다");
    assert.ok(!strippedFilters.includes("<option"), "필터 카드에 <option> 이 되살아났다");
    assert.ok(
      !strippedFilters.includes('value="ALL"'),
      "「전체」가 다시 고르는 값이 되었다 — 이제는 빈 배열이 「전체」다"
    );
  });

  test("🔴 네 칸에는 단축 단추를 주지 않는다 — 그건 [현재 상태] 하나뿐이다", () => {
    for (const field of FOUR_FIELDS) {
      assert.ok(
        !fieldBlock(field.id).includes("shortcut="),
        `${field.id} 에 단축 단추가 붙었다 — 미리 정해진 묶음이 있는 것은 [현재 상태]뿐이다`
      );
    }
    // 그 하나는 그대로 있어야 한다(없애 버린 것이 아니다).
    assert.ok(
      fieldBlock("repair-case-status").includes("shortcut={{ label: \"입고품 전체\""),
      "[현재 상태]의 「입고품 전체」 단추가 사라졌다"
    );
  });
});

// ───────────────────── ② 선택지를 어디서 뽑는가

describe("🔴 선택지의 출처", () => {
  test("제품군·유·무상·우선순위는 코드 목록에서 뽑는다 — 손으로 적지 않는다", () => {
    // 손으로 적어 두면 목록이 느는 날 그 값이 아무 소리 없이 필터에서만 빠진다.
    assert.match(fieldBlock("repair-case-product-category"), /options=\{PRODUCT_CATEGORY_OPTIONS\.map/);
    assert.match(fieldBlock("repair-case-billing-type"), /options=\{\[ \.\.\.BILLING_TYPE_CODES\.map/);
    assert.match(fieldBlock("repair-case-priority"), /options=\{PRIORITY_CODES\.map/);
  });

  test("🔴 유·무상에만 「미지정」 한 줄이 더 붙는다 — 코드 목록에는 없는 값이다", () => {
    // 표에 "-" 로 나오는 건들(billing_type 이 null). BILLING_TYPE_CODES 에 끼워
    // 넣으면 접수·수정 화면이 저장할 값으로 쓰게 되므로 여기서만 덧붙인다.
    const block = fieldBlock("repair-case-billing-type");
    assert.match(block, /\{ value: "NONE", label: "미지정" \}/);
    // 다른 칸에 새어 들어가지 않았다.
    for (const field of FOUR_FIELDS) {
      if (field.id === "repair-case-billing-type") continue;
      assert.ok(!fieldBlock(field.id).includes('"NONE"'), `${field.id} 에 NONE 이 섞였다`);
    }
  });

  test("고객사 선택지는 목록에서 뽑은 명단(customers)을 그대로 쓴다", () => {
    // "목록에 있으면 필터에도 있다"를 지키는 자리다(collectCustomerFilterOptions).
    // 🔴 값은 id, 글자는 이름이다 — 뒤집으면 같은 이름의 고객사 둘이 한 줄로 접힌다.
    assert.match(
      fieldBlock("repair-case-customer"),
      /options=\{customers\.map\(\(customer\) => \(\{ value: customer\.id, label: customer\.name \}\)\)\}/
    );
  });
});

// ───────────────────── ③ 목록 화면이 그 값을 필터에 넣는가

describe("🔴 목록 화면의 배선", () => {
  test("네 칸의 onChange 가 배열 칸을 그대로 고친다", () => {
    for (const [prop, field] of [
      ["onProductCategoriesChange", "productCategories"],
      ["onBillingTypesChange", "billingTypes"],
      ["onCustomerIdsChange", "customerIds"],
      ["onPrioritiesChange", "priorities"],
    ] as const) {
      assert.ok(
        strippedListPage.includes(`${prop}={(value) => updateFilters({ ${field}: value })}`),
        `${prop} 가 ${field} 로 이어지지 않았다`
      );
    }
  });

  test("🔴 값 하나를 넘기던 옛 프롭 이름이 남아 있지 않다", () => {
    // 이름만 남고 아무 데도 안 닿는 프롭은 tsc 가 잡아 주지만, 두 화면 중 한쪽에만
    // 남으면 "안 쓰이는 줄" 로 조용히 산다.
    for (const stale of [
      "onProductCategoryChange",
      "onBillingTypeChange",
      "onCustomerChange",
      "onPriorityChange",
    ]) {
      assert.ok(!strippedListPage.includes(stale), `목록 화면에 옛 프롭 ${stale} 이 남아 있다`);
      assert.ok(!withoutComments(filtersSource).includes(stale), `필터 화면에 옛 프롭 ${stale} 이 남아 있다`);
    }
  });
});
