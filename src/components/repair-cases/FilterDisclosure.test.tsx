import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import FilterDisclosure from "./FilterDisclosure";
import { countHiddenActiveFilters } from "./RepairCaseFilters";
import { DEFAULT_FILTERS } from "@/lib/domain/repair-case-filters";

/**
 * 정적 렌더로 확인할 수 있는 것은 **첫 화면**이다. 이 컴포넌트에서 첫 화면이
 * 곧 핵심 계약이라 그것으로 충분하다 — 좁은 화면에서는 접혀 있고, 넓은
 * 화면에서는 상태와 무관하게 펼쳐져 있어야 한다. 그 둘은 클래스 조합
 * (`hidden lg:flex`, `lg:hidden`)으로 정해지므로 마크업만 보면 판정된다.
 */

test("처음에는 접혀 있고, 넓은 화면(lg)에서는 상태와 무관하게 펼쳐진다", () => {
  const html = renderToStaticMarkup(
    <FilterDisclosure activeCount={0} onReset={() => {}}>
      <div>상세 조건 내용</div>
    </FilterDisclosure>
  );
  assert.ok(html.includes("hidden lg:flex"), "접힌 패널은 좁은 화면에서만 숨고 lg에서는 다시 나와야 한다");
  assert.ok(html.includes('aria-expanded="false"'), "처음은 접힌 상태다");
  assert.ok(html.includes("상세 조건 내용"), "접혀 있어도 내용은 렌더된다(숨겨질 뿐이다)");
});

test("토글 버튼 자체가 넓은 화면에서는 사라진다", () => {
  const html = renderToStaticMarkup(
    <FilterDisclosure activeCount={0} onReset={() => {}}>
      <div />
    </FilterDisclosure>
  );
  assert.ok(html.includes("lg:hidden"), "lg에서는 늘 펼쳐져 있으므로 토글이 있을 이유가 없다");
  assert.ok(html.includes("더보기"));
});

test("걸린 조건이 없으면 개수 안내도 초기화 버튼도 띄우지 않는다", () => {
  const html = renderToStaticMarkup(
    <FilterDisclosure activeCount={0} onReset={() => {}}>
      <div />
    </FilterDisclosure>
  );
  assert.ok(!html.includes("적용됨"));
  assert.ok(!html.includes("필터 초기화"), "감춰진 조건이 없는데 초기화만 내밀 이유가 없다");
});

test("접힌 채로 조건이 걸려 있으면 개수를 알리고, 펼치지 않고도 지울 수 있다", () => {
  // 이게 이 컴포넌트가 존재하는 이유다 — 조건이 걸린 채 접히면 목록이 왜 짧은지
  // 알 방법이 없다.
  const html = renderToStaticMarkup(
    <FilterDisclosure activeCount={2} onReset={() => {}}>
      <div />
    </FilterDisclosure>
  );
  assert.ok(html.includes("2개 적용됨"));
  assert.ok(html.includes("필터 초기화"));
});

test("countHiddenActiveFilters는 검색어를 세지 않는다", () => {
  // 검색칸은 접혀도 늘 보이므로, 세면 "감춰진 조건 N개"가 거짓말이 된다.
  assert.equal(countHiddenActiveFilters({ ...DEFAULT_FILTERS, query: "D2608" }), 0);
});

test("countHiddenActiveFilters는 감춰지는 조건만 하나씩 센다", () => {
  assert.equal(countHiddenActiveFilters(DEFAULT_FILTERS), 0);
  assert.equal(countHiddenActiveFilters({ ...DEFAULT_FILTERS, status: "IN_REPAIR" }), 1);
  assert.equal(
    countHiddenActiveFilters({
      ...DEFAULT_FILTERS,
      status: "IN_REPAIR",
      productCategory: "Generator",
      billingType: "PAID",
      customerId: "c-1",
      priority: "HIGH",
      overdueOnly: true,
    }),
    6
  );
});

test("유·무상 '미지정'도 걸린 조건 하나로 센다", () => {
  // "ALL이 아니면 걸린 것"이라는 규칙에서 NONE만 빠지면, 미지정만 훑는 동안
  // 접힌 필터가 "0개 적용됨"이라고 말하게 된다.
  assert.equal(countHiddenActiveFilters({ ...DEFAULT_FILTERS, billingType: "NONE" }), 1);
});

test("대시보드에서 넘어온 출하월 필터는 세지 않는다", () => {
  // 그 필터는 카드 아래 자기 안내 문구가 따로 있어서, 개수에 넣으면 같은 것을
  // 두 번 말하게 된다.
  assert.equal(countHiddenActiveFilters({ ...DEFAULT_FILTERS, shipmentMonth: "2026-08" }), 0);
});
