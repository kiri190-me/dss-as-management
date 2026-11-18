import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * ============================================================================
 * 내자 정리 목록의 **거르개 둘과 발주발행일 세모가 실제로 배선됐는가** (2026-11-18)
 * ============================================================================
 * 값으로 도는 규칙은 lib/domain/domestic-order-list-filters.test.ts 가 잰다.
 * 여기서 보는 것은 **화면이 그 함수들을 정말 그렇게 쓰는가**뿐이다 — 값 쪽 시험이
 * 전부 통과한 채로 화면만 예전으로 돌아가면, 사용자가 보는 것은 바뀌기 전과 똑같다.
 *
 * ── 왜 렌더하지 않고 원본을 글자로 읽는가 ───────────────────────────────
 * DomesticOrderListScreen 은 편집 폼 → 서버 액션 → `server-only` 로 이어지는 사슬을
 * 물고 있어 이 자리에서 통째로 그릴 수 없고(이웃 domestic-order-inline-cells ·
 * domestic-order-due-date-inversion · badge-visibility-screens 가 같은 사정을 같은
 * 방법으로 푼다), 그릴 수 있다 해도 드롭다운은 **접힌 채로 태어나** 정적 렌더로는
 * 목록을 못 본다(이 저장소에는 jsdom 이 없다).
 *
 * 🔴 **주석을 걷어낸 뒤에 센다.** 이 화면의 주석은 「왜 그렇게 했는가」를 길게 적는
 * 자리라 「완료됨」도 `<select>` 도 거기 적혀 있다 — 날것으로 세면 코드를 되돌려도
 * 주석만으로 영영 통과한다(이웃 repair-case-multi-select-filters.test.ts 와 같은
 * 함정·같은 방어, 정규식도 그쪽 것을 그대로 쓴다).
 * ============================================================================
 */

const repoUrl = new URL("../../../", import.meta.url);
/** CRLF 로 받아 둔 저장소에서도 표지가 맞도록 LF 로 맞춘다. */
const read = (relativePath: string) =>
  readFileSync(new URL(relativePath, repoUrl), "utf8").replace(/\r\n/g, "\n");

/**
 * 주석 걷어내기. 안쪽을 `[\s\S]*?` 로 적으면 다른 주석의 닫힘까지 뛰어넘어 코드를
 * 통째로 지운다 — 이웃 시험이 실제로 밟은 함정이라 같은 모양을 그대로 쓴다.
 */
function withoutComments(source: string): string {
  return source
    .replace(/\{\s*\/\*(?:[^*]|\*(?!\/))*\*\/\s*\}/g, " ") // JSX 주석 {/* … */}
    .replace(/\/\*(?:[^*]|\*(?!\/))*\*\//g, " ") // 블록 주석
    .replace(/(^|[^:"'`\\])\/\/[^\n]*/gm, "$1"); // 줄 주석 ("https://" 는 건드리지 않는다)
}

/** 줄바꿈·들여쓰기 차이로 깨지지 않도록 공백을 하나로 접는다. */
const flat = (source: string) => source.replace(/\s+/g, " ");

const screenSource = read("src/components/domestic-orders/DomesticOrderListScreen.tsx");
const stripped = flat(withoutComments(screenSource));

/**
 * `id="…"` 자리에서 **그 요소의 여는 `<`** 까지 되짚는다. 타입 인자를 적은 칸
 * (`<CheckboxFilterDropdown<DomesticOrderStatusFilterValue> id="…"`)에서는 바로 앞의
 * `<` 가 타입 인자의 것이다 — 그쪽은 **바로 앞이 낱말 글자**라는 차이로 가른다.
 */
function openingTagStart(at: number): number {
  for (let i = at; i >= 0; i -= 1) {
    if (stripped[i] !== "<") continue;
    const before = i === 0 ? " " : stripped[i - 1];
    if (!/[\w$]/.test(before)) return i;
  }
  return -1;
}

/** 칸 하나를 그리는 `<CheckboxFilterDropdown … />` 한 덩어리만 잘라낸다. */
function fieldBlock(id: string): string {
  const at = stripped.indexOf(`id="${id}"`);
  assert.notEqual(at, -1, `${id} 칸을 찾지 못했다 — 이름이 바뀌었으면 이 시험도 함께 고칠 것`);
  const start = openingTagStart(at);
  assert.notEqual(start, -1, `${id} 칸의 여는 태그를 찾지 못했다`);
  const end = stripped.indexOf("/>", start);
  assert.notEqual(end, -1, `${id} 칸의 끝(/>)을 찾지 못했다`);
  const block = stripped.slice(start, end);
  assert.ok(block.length > 0, `${id} 덩어리를 못 잘랐다 — 아래 단언이 공짜로 통과한다`);
  return block;
}

const TWO_FIELDS = [
  { id: "domestic-order-status-filter", label: "상태", selected: "statusFilters" },
  { id: "domestic-order-customer-filter", label: "고객사", selected: "customerFilters" },
] as const;

// ───────────────────────────────────── ⓪ 재는 도구가 정말 듣는가

describe("🔵 재는 도구", () => {
  test("주석 걷어내기가 정말 듣는다 — 안 들으면 아래가 주석만으로 통과한다", () => {
    const marker = "거르개 둘(상태 · 고객사)과 발주발행일 세모";
    assert.ok(screenSource.includes(marker), "표지로 삼은 주석 글귀가 사라졌다 — 이 시험도 함께 고칠 것");
    assert.ok(
      !withoutComments(screenSource).includes(marker),
      "주석이 그대로 남아 있다 — 아래 부정 단언들이 무의미해진다"
    );
    assert.ok(stripped.includes('label="상태"'), "걷어내다 칸 이름까지 날렸다");
    assert.ok(stripped.includes('label="고객사"'), "걷어내다 칸 이름까지 날렸다");
  });

  test("칸 덩어리 자르기가 칸 하나에서 끝난다 — 옆 칸이 딸려 오지 않는다", () => {
    for (const field of TWO_FIELDS) {
      const block = fieldBlock(field.id);
      assert.ok(block.includes(`label="${field.label}"`), `${field.id} 에 제 이름이 없다`);
      for (const other of TWO_FIELDS) {
        if (other.id === field.id) continue;
        assert.ok(
          !block.includes(`label="${other.label}"`),
          `${field.id} 덩어리에 ${other.label} 칸이 딸려 들어왔다`
        );
      }
    }
  });
});

// ───────────────────── ① 두 칸이 복수 선택 부품을 쓴다

describe("🔴 ① 상태 · 고객사가 복수 선택 칸이다", () => {
  test("공용 부품을 가져다 쓴다 — 이 화면에 따로 만들지 않았다", () => {
    assert.match(
      screenSource,
      /^import CheckboxFilterDropdown from "@\/components\/common\/CheckboxFilterDropdown";$/m
    );
  });

  test("두 칸 다 <CheckboxFilterDropdown> 이고, 고른 값을 배열 상태에서 읽는다", () => {
    for (const field of TWO_FIELDS) {
      const block = fieldBlock(field.id);
      assert.ok(block.includes("<CheckboxFilterDropdown"), `${field.id} 가 복수 선택 칸이 아니다`);
      assert.ok(
        block.includes(`selected={${field.selected}}`),
        `${field.id} 가 ${field.selected} 를 읽지 않는다`
      );
    }
  });

  test("🔴 빈 배열이 「전체」다 — 고르는 값으로 「전체」를 두지 않았다", () => {
    for (const field of TWO_FIELDS) {
      const block = fieldBlock(field.id);
      assert.ok(!block.includes("emptyLabel="), `${field.id} 가 「전체」 글자를 따로 바꿔 놨다`);
      assert.ok(!block.includes('value="ALL"'), `${field.id} 에 「전체」가 고르는 값으로 들어갔다`);
    }
  });

  test("🔴 두 칸에는 단축 단추를 주지 않는다 — 미리 정해진 묶음이 없다", () => {
    for (const field of TWO_FIELDS) {
      assert.ok(!fieldBlock(field.id).includes("shortcut="), `${field.id} 에 단축 단추가 붙었다`);
    }
  });

  test("🔵 발주 년도 고르개는 그대로 <select> 다 — 복수 선택으로 바꾸지 않았다", () => {
    // 한 해만 보는 칸이고, 「검색 중에는 잠근다(disabled)」는 규칙이 걸려 있다.
    assert.match(stripped, /<select id="domestic-order-year"/);
    assert.match(stripped, /disabled=\{isSearching\}/);
  });
});

// ───────────────────── ② 선택지를 어디서 뽑는가

describe("🔴 ② 선택지의 출처", () => {
  test("상태 넷은 도메인 상수를 펼친다 — 손으로 적지 않았다", () => {
    assert.match(
      fieldBlock("domestic-order-status-filter"),
      /options=\{DOMESTIC_ORDER_STATUS_FILTER_VALUES\.map\(\(value\) => \(\{ value, label: DOMESTIC_ORDER_STATUS_FILTER_LABELS\[value\], \}\)\)\}/
    );
  });

  test("🔴 상태 글자 넷을 화면에 손으로 박지 않았다", () => {
    // 박아 두면 도메인 쪽 글자를 바꾼 날 필터 이름만 옛말로 남는다 — 2026-11-19 에
    // 실제로 「발주일 미정」이 「발주 대기」가 됐고, 이 화면은 한 글자도 안 고쳤다.
    //
    // 🔴 `"발주일 미정"` 은 **목록에 그대로 둔다.** 그 글자가 화면에서 사라진 것이
    // 아니다 — 발주발행일 칸의 배지와 주황 안내가 여전히 그 말을 쓴다. 다만 둘 다
    // `NO_ORDER_DATE_LABEL` 상수를 거쳐 그리므로(badges.tsx · 이 화면 2755줄의
    // `{NO_ORDER_DATE_LABEL}`) **따옴표에 싸인 날것**은 이 파일에 없어야 맞다.
    // 주석에 적힌 「발주일 미정」은 위 withoutComments 가 걷어낸 뒤라 안 세어진다.
    for (const label of ['"완료됨"', '"미완료"', '"발주일 미정"', '"발주 대기"', '"발주 완료"']) {
      assert.ok(!stripped.includes(label), `상태 글자 ${label} 가 화면에 손으로 박혔다`);
    }
  });

  test("🔵 그 부정 단언이 정말 무는가 — 상수를 거치는 쪽은 통과하고 날것은 걸린다", () => {
    // 🔴 위 시험은 **「없다」만 재는** 모양이라, 세는 대상(stripped)이 비거나 글자가
    //    조금만 달라도 영영 공짜로 통과한다. 여기서 재는 도구가 살아 있는지 본다.
    assert.ok(stripped.length > 1000, "화면 소스를 못 읽었다 — 위 부정 단언이 무의미하다");
    assert.ok(
      stripped.includes("{NO_ORDER_DATE_LABEL}"),
      "🔴 배지·안내가 쓰던 상수 호출이 사라졌다 — 「발주일 미정」이 화면에서 없어졌거나 날것으로 바뀌었다"
    );
    assert.ok(
      !stripped.includes('"완료됨"') && stripped.includes("DOMESTIC_ORDER_STATUS_FILTER_LABELS"),
      "상태 이름표를 도메인에서 받지 않는다"
    );
  });

  test("🔴 고객사 후보는 **지금 올라온 줄**에서 뽑는다", () => {
    assert.match(
      stripped,
      /const customerFilterOptions = useMemo\(\(\) => collectDomesticOrderCustomerOptions\(rows\), \[rows\]\);/
    );
    assert.ok(
      fieldBlock("domestic-order-customer-filter").includes("options={customerFilterOptions}"),
      "고객사 칸이 그 명단을 안 쓴다"
    );
  });

  test("🔴 고객사 마스터(customerOptions prop)를 선택지로 쓰지 않는다", () => {
    // 그 prop 은 canEdit 인 세션에만 내려온다(page.tsx). 그것으로 선택지를 만들면
    // **수정 권한이 없는 분에게 고객사 필터가 통째로 사라진다.**
    assert.ok(
      !fieldBlock("domestic-order-customer-filter").includes("customerOptions"),
      "고객사 필터가 고객사 마스터를 쓰고 있다"
    );
    // 그 prop 자체는 그대로 남아 있어야 한다 — `줄 수정` 폼이 쓴다(없애면 안 된다).
    assert.ok(
      stripped.includes("customerOptions={customerOptions}"),
      "`줄 수정` 폼에 넘기던 고객사 마스터가 사라졌다"
    );
  });
});

// ───────────────────── ③ 거르개가 실제로 줄을 거르는가

describe("🔴 ③ 목록 배선", () => {
  test("거르는 차례가 (검색 또는 년도) → 상태 → 고객사다", () => {
    assert.match(
      stripped,
      /const byYearOrSearch = isSearching \? filterDomesticOrdersBySearch\(rows, searchText\) : filterDomesticOrdersByYear\(rows, activeYear\);/
    );
    assert.match(
      stripped,
      /const byStatus = filterDomesticOrdersByStatus\(byYearOrSearch, statusFilters\);/
    );
    assert.match(
      stripped,
      /return filterDomesticOrdersByCustomerNames\(byStatus, customerFilters\);/
    );
  });

  test("고른 값이 바뀌면 목록을 다시 센다 — useMemo 가 그 둘을 보고 있다", () => {
    // 빠지면 체크를 눌러도 표가 그대로다. 오류가 아니라 「필터가 안 먹는다」로만 보인다.
    assert.match(
      stripped,
      /\[rows, activeYear, isSearching, searchText, statusFilters, customerFilters\]/
    );
  });

  test("🔴 거르개 때문에 표가 비면 빈 표 대신 안내가 선다", () => {
    assert.match(stripped, /\) : visibleRows\.length === 0 \? \(/);
    assert.ok(stripped.includes("지금 걸린 조건에 맞는 내자 정리 항목이 없습니다."));
  });

  test("🔴 한 번에 푸는 단추가 있고, 걸려 있을 때만 선다", () => {
    assert.match(stripped, /const hasRowFilters = statusFilters\.length > 0 \|\| customerFilters\.length > 0;/);
    assert.match(stripped, /\{hasRowFilters && \( <button/);
    assert.ok(stripped.includes("필터 지우기"));
    // 🔵 검색어와 년도는 건드리지 않는다 — 그 둘은 제 자리에 지우는 길이 따로 있다.
    const at = stripped.indexOf("필터 지우기");
    const clearBlock = stripped.slice(Math.max(0, at - 600), at);
    assert.ok(clearBlock.includes("setStatusFilters([]); setCustomerFilters([]);"), "두 거르개를 함께 풀지 않는다");
    assert.ok(!clearBlock.includes("setSearchText"), "「필터 지우기」가 검색어까지 지운다");
    assert.ok(!clearBlock.includes("setSelectedYear"), "「필터 지우기」가 년도까지 되돌린다");
  });
});

// ───────────────────── ④ 발주발행일 세모

describe("🔴 ④ 발주발행일 세모", () => {
  test("🔴 기본은 꺼짐이다 — 세모를 누르기 전에는 이 변경 전과 똑같아야 한다", () => {
    assert.match(
      stripped,
      /const \[orderIssuedSort, setOrderIssuedSort\] = useState<DomesticOrderOrderIssuedSort>\(null\);/
    );
  });

  test("🔴 꺼져 있으면 세우는 함수를 **아예 부르지 않는다**", () => {
    // 이 한 줄이 「묶음 안의 순서는 원본 그대로여야 한다」(domestic-order-list.test.ts)를
    // 기본 상태에서 지키는 자리다. 가지 없이 늘 부르면 그 사실이 세우는 함수의
    // 정확성에 매달린다.
    assert.match(
      stripped,
      /const base = groupDomesticOrdersByCustomer\(visibleRows\); if \(orderIssuedSort === null\) return base; return sortDomesticOrderGroupRowsByOrderIssuedDate\(base, orderIssuedSort\);/
    );
  });

  test("머리글이 진짜 단추이고, 누름 규칙을 도메인에서 받는다", () => {
    assert.match(stripped, /setOrderIssuedSort\(nextDomesticOrderOrderIssuedSort\(orderIssuedSort\)\)/);
    assert.match(stripped, /발주발행일 <span aria-hidden="true"/);
    assert.match(stripped, /\{orderIssuedSort === "desc" \? "▼" : "▲"\}/);
  });

  test("🔴 읽어 주는 프로그램에도 정렬 상태가 전해진다 — aria-sort 세 갈래", () => {
    assert.match(
      stripped,
      /aria-sort=\{ orderIssuedSort === "asc" \? "ascending" : orderIssuedSort === "desc" \? "descending" : "none" \}/
    );
  });

  test("🔴 켜 두면 표 위에 한 줄이 서고, 끄는 단추가 그 옆에 있다", () => {
    // 🔴 **지금 무엇으로 세워 보고 있는지**를 말하는 유일한 자리다 — 머리글의 세모는
    //    22칼럼을 옆으로 밀어 본 뒤에는 화면 밖이다.
    assert.match(stripped, /const showOrderIssuedSortNote = orderIssuedSort !== null;/);
    assert.ok(
      stripped.includes(
        '발주발행일 {orderIssuedSort === "asc" ? "오름차순" : "내림차순"}으로 보고 있습니다 </span>'
      ),
      "지금 무엇으로 세워 보고 있는지를 말하는 줄이 사라졌거나 글자가 바뀌었다"
    );
    assert.ok(stripped.includes("onClick={() => setOrderIssuedSort(null)}"), "끄는 단추가 없다");
    assert.ok(stripped.includes("순번 차례로"));
    // 안내 묶음이 그 줄까지 받아야 한다 — 빠지면 상자가 안 그려져 줄이 통째로 사라진다.
    assert.match(stripped, /\{\(showAlwaysVisibleNote \|\| showOrderIssuedSortNote\) && \(/);
  });

  test("🔵 그 줄에 **설명은 적지 않는다** — 2026-11-18 에 사용자 요구로 걷어낸 한 문장", () => {
    // 사용자가 인용해 지우라고 한 것은 「— 」 뒤의 설명뿐이다. 상태를 말하는 앞 절과
    // [순번 차례로] 단추는 위 시험이 지킨다.
    for (const phrase of [
      "고객사 묶음 안에서만 다시 세웠고",
      "줄은 맨 뒤입니다",
      "순번 칸의 숫자는 사람이 매긴 그대로입니다",
    ]) {
      assert.ok(!stripped.includes(phrase), `걷어낸 설명이 되살아났다: ${phrase}`);
    }
    // 🔴 **글자만 걷었고 규칙은 그대로**다. 같은 말이 머리글 세모의 title 에 남아
    //    있다(ORDER_ISSUED_SORT_HINT) — 그쪽까지 지우면 세우는 규칙을 아는 자리가
    //    화면에서 통째로 사라진다. 비슷한 문장이라 위 부정 단언과 섞이지 않도록
    //    **여기서 함께** 잰다.
    assert.ok(
      stripped.includes("고객사 묶음 안에서만 다시 세웁니다."),
      "머리글 세모의 title 에 있던 설명까지 사라졌다"
    );
    assert.ok(stripped.includes("title={ORDER_ISSUED_SORT_HINT}"), "세모가 그 설명을 안 단다");
  });

  test("🔵 휴지통 표의 발주발행일은 그대로 글자다 — 단추가 되지 않았다", () => {
    // 이 파일에는 `발주발행일` 머리글이 둘이고(사용중 표 · 휴지통 표), 휴지통은
    // 묶음도 순번도 없어 세울 것이 없다. 둘을 한꺼번에 고치면 거기서만 터진다.
    assert.ok(
      stripped.includes('<th className="px-3 py-2">발주발행일</th>'),
      "휴지통 표의 발주발행일 칸이 함께 바뀌었다"
    );
  });
});
