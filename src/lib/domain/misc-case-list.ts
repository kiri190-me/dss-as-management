import {
  filterDomesticOrdersBySearch,
  foldBlankToNull,
  UNASSIGNED_CUSTOMER_LABEL,
  type DomesticOrderSearchable,
} from "./domestic-order-list";
import type { MiscCaseStatus } from "./misc-case-status";

/**
 * ============================================================================
 * 「기타건 현황」 목록의 계산 — 차례 세우기 (2026-11-06)
 * ============================================================================
 * 기타건 = **수리 건이 붙지 않은 내자 정리의 한 줄**이다(사용자가 붙인 이름 —
 * domain/domestic-order-detail-tabs.ts 머리말). 그 줄들만 모아 보는 화면이
 * 「기타건 현황」이고, 이 파일은 그 화면의 **규칙**만 갖는다.
 *
 * DB 도 React 도 들어오지 않는다. repair-case-filters.ts · domestic-order-list.ts
 * 와 같은 자리의 파일이고 같은 까닭이다 — 「어느 줄이 먼저 서는가」는 규칙이지
 * 그리기가 아니라서, 화면 안에 두면 시험할 방법이 브라우저를 띄우는 것밖에 남지
 * 않는다.
 *
 * ── 🔴 **거르는 일은 여기 없다** ────────────────────────────────────────
 * 「수리 건이 붙지 않았는가」를 이 파일에서 다시 재지 않는다. 그 판정은 조회의
 * `where` 한 줄이고(queries/domestic-orders.ts 의 listMiscDomesticOrders), 화면은
 * 이미 걸러진 줄만 받는다. 여기에 같은 규칙을 한 벌 더 적으면 두 곳이 갈라지는
 * 날이 오고, 그때 화면은 **아무 말 없이** 서버가 보낸 줄 일부를 감춘다.
 *
 * 검색도 새로 적지 않는다 — 내자 정리가 쓰는 함수를 그대로 쓴다
 * (domestic-order-list.ts 의 filterDomesticOrdersBySearch · 여덟 칸). 같은 자료를
 * 보는 두 화면에서 같은 글자가 다르게 걸리면 안 된다.
 *
 * ── 🔴 기본 차례는 **발행일자 내림차순**이다 ────────────────────────────
 * 기타건은 **견적서에서 태어나는 줄**이 많고(기타 견적서를 만들면 내자에 줄이
 * 하나 선다 — domain/quote-domestic-order-line.ts), 상세의 머리 카드도 품명 ·
 * 공급처 다음에 **발행일자 · 발행번호**를 단다(domain/domestic-order-basic-info.ts).
 * 사람이 이 화면에서 먼저 찾는 것은 「최근에 나간 건」이라 최신이 위다 — 전체 A/S
 * 현황이 인수번호 내림차순인 것과 같은 결이다.
 *
 * 🔴 **서버 조회도 같은 차례로 세운다**(listMiscDomesticOrders 의 orderBy). 이
 * 저장소에는 「목록은 화면이 다시 정렬한다 — 서버만 고치면 화면이 그대로다」가
 * 기록돼 있는데, 그 반대도 참이다: 화면만 고치면 **서버가 그린 첫 HTML 과 화면이
 * 세운 차례가 달라져** hydration 이 어긋난다. 둘을 같은 값으로 맞춰 두고, 한쪽을
 * 고치면 다른 쪽도 함께 본다.
 *
 * ── 🔴 빈 값은 **어느 방향에서도 뒤**다 ─────────────────────────────────
 * 전체 A/S 현황의 sortRows 는 널을 작은 쪽에 두고 내림차순을 `reverse()` 로
 * 만든다 — 그래서 올림차순에서는 "-"인 줄이 맨 위에 선다. 여기서는 **방향과
 * 무관하게 뒤로** 보낸다. 까닭 둘:
 *  · 이 표에는 빈 칸이 흔하다(개발 DB 실측 2026-11-06 — 기타건 13건 중 품명이
 *    적힌 줄 2건 · 공급처 3건 · 발행번호 9건). 널을 앞에 두면 어느 칸으로 세우든
 *    첫 화면이 "-" 묶음으로 시작한다.
 *  · 널이 「작은 값」이라는 뜻이 아니라 「모른다」라서, 방향을 뒤집었다고 모르는
 *    줄이 맨 앞으로 올 이유가 없다.
 *
 * ── 🔵 **안정 정렬이다** ────────────────────────────────────────────────
 * 같은 값끼리는 **받은 차례가 그대로 남는다**(= 서버의 등록순). `reverse()` 를
 * 쓰지 않고 비교값을 뒤집는 것이 그 장치다 — `reverse()` 는 동점인 줄의 차례까지
 * 함께 뒤집어, 같은 날짜의 줄들이 방향을 바꿀 때마다 자리를 바꾼다.
 * ============================================================================
 */

/**
 * 머리글을 눌러 세울 수 있는 칸. **화면에 실제로 있는 칸만** 넣는다 — 보이지
 * 않는 값으로 줄을 세우면 왜 그 차례인지 화면만 봐서는 답할 수 없다.
 *
 * 이름은 **화면의 이름표가 아니라 값의 이름**이다(전체 A/S 현황의 SortColumn 과
 * 같은 규칙). 화면의 이름표는 「발행일자 · 발행번호」이지만 그 값은 내자 줄의
 * display* 둘이고, 이름을 값에 맞춰 두면 무엇을 비교하는지가 이 타입에서 바로
 * 보인다.
 */
export type MiscCaseSortColumn =
  | "quoteIssuedDate"
  | "quoteNumber"
  | "modelName"
  | "customerName"
  | "orderIssuedDate";

export type MiscCaseSortDirection = "asc" | "desc";

export type MiscCaseSortState = {
  column: MiscCaseSortColumn;
  direction: MiscCaseSortDirection;
};

/** 처음 그리는 차례 — 발행일자 내림차순(파일 머리말). 서버 조회와 같은 값이다. */
export const MISC_CASE_DEFAULT_SORT: MiscCaseSortState = {
  column: "quoteIssuedDate",
  direction: "desc",
};

/**
 * 이 파일이 실제로 들여다보는 칸만 요구한다 — 조회의 전체 행 타입을 끌어오지
 * 않는다(domestic-order-list.ts 의 다른 타입들과 같은 규칙).
 *
 * 🔴 **셋은 이미 정해진 값이다.** `displayQuoteIssuedDate` · `displayQuoteNumber`
 * 는 연결된 견적서가 이긴 쪽이고, `modelName` · `customerName` 은 이 행의 값이
 * 먼저인 쪽이다(queries 의 mapDomesticOrderRow). 원본 칸으로 세우면 **화면에
 * 보이는 글자와 줄 서는 기준이 달라진다** — 전체 A/S 현황이 「보이는 날짜로
 * 세운다」를 적어 둔 그 함정과 같다.
 */
export type MiscCaseSortable = {
  displayQuoteIssuedDate: string | null;
  displayQuoteNumber: string | null;
  modelName: string | null;
  customerName: string | null;
  orderIssuedDate: string | null;
};

/** 이 줄에서 그 칸의 **비교할 값**. 공백만 적힌 값은 없는 것으로 접는다. */
function valueOf(row: MiscCaseSortable, column: MiscCaseSortColumn): string | null {
  switch (column) {
    case "quoteIssuedDate":
      return foldBlankToNull(row.displayQuoteIssuedDate);
    case "quoteNumber":
      return foldBlankToNull(row.displayQuoteNumber);
    case "modelName":
      return foldBlankToNull(row.modelName);
    case "customerName":
      return foldBlankToNull(row.customerName);
    case "orderIssuedDate":
      return foldBlankToNull(row.orderIssuedDate);
  }
}

/**
 * 차례대로 세운다. **빈 값은 방향과 무관하게 뒤**이고, 같은 값끼리는 **받은
 * 차례가 그대로**다(파일 머리말).
 *
 * 원본 배열을 건드리지 않는다 — 화면이 `useMemo` 로 들고 있는 서버 행을 제자리에서
 * 뒤집으면, 조건이 바뀔 때마다 같은 배열이 거듭 뒤집혀 차례가 누적된다.
 */
export function sortMiscCases<T extends MiscCaseSortable>(
  rows: readonly T[],
  sort: MiscCaseSortState
): T[] {
  return [...rows].sort((a, b) => {
    const left = valueOf(a, sort.column);
    const right = valueOf(b, sort.column);

    // 🔴 빈 값 처리가 방향보다 **먼저**다. 뒤에 두면 아래 부호 뒤집기에 함께
    //    걸려 내림차순에서 "-"인 줄이 맨 위로 올라온다.
    if (left === null && right === null) return 0;
    if (left === null) return 1;
    if (right === null) return -1;

    const compared = left.localeCompare(right);
    return sort.direction === "asc" ? compared : -compared;
  });
}

/**
 * 머리글을 눌렀을 때의 다음 차례. **같은 칸을 다시 누르면 방향만 뒤집고, 다른
 * 칸을 누르면 그 칸의 내림차순**으로 간다.
 *
 * 전체 A/S 현황의 handleSortChange 와 **같은 규칙**이다(그 화면은 이 판단을 컴포넌트
 * 안에 두고 있다). 여기서는 도메인에 두어 시험할 수 있게 했다 — 규칙은 한 줄이지만
 * 틀려도 화면이 조용히 다르게 굴 뿐이라 눈으로는 잘 안 잡힌다.
 *
 * 처음 누른 칸이 **내림차순**인 까닭: 이 화면의 칸은 날짜와 번호가 대부분이고,
 * 사람이 그것으로 세울 때 보고 싶은 것은 거의 언제나 최신 쪽이다.
 */
export function nextMiscCaseSort(
  current: MiscCaseSortState,
  column: MiscCaseSortColumn
): MiscCaseSortState {
  if (current.column !== column) return { column, direction: "desc" };
  return { column, direction: current.direction === "desc" ? "asc" : "desc" };
}

/**
 * ============================================================================
 * 🔴 거르개 — **상태 · 공급처**, 그리고 글자 찾기 (2026-11-06 사용자 요구)
 * ============================================================================
 * 「상태·공급처 별로 필터링할 수 있는 검색기능을 넣어줘」.
 *
 * 모양은 전체 A/S 현황의 거르개를 따른다(domain/repair-case-filters.ts 의 Filters ·
 * applyFilters) — 값은 언제나 **코드**, 거르는 일은 순수 함수 하나, 그리는 일은
 * 화면. 새 모양을 만들지 않는다.
 *
 * ── 🔴 한 종류 안에서 **여럿 고른다** (2026-11-11 사용자 개선요청) ───────
 * 「[전체 A/S 현황]·[기타건 현황]에서 한 종류의 필터 안에서 복수로 선택할 수 있게」.
 * 그래서 둘 다 **배열**이고 **빈 배열이 「전체」**다 — `"ALL"` 이라는 값은 없앴다.
 * 두면 「"ALL" 이 들어 있는 배열」이라는 뜻 없는 상태가 생기고, 거르는 쪽이 매번
 * 그것을 따로 가려내야 한다(전체 A/S 현황이 같은 날 같은 판단을 했다).
 *
 * ── 🔴 공급처는 **이름으로** 거른다 (id 가 아니다) ──────────────────────
 * 전체 A/S 현황은 고객사 id 로 거르는데 여기서는 이름이다. 까닭 둘:
 *  · 화면에 보이는 값이 이름이고, 그 이름은 **이미 정해진 값**이다(매퍼의
 *    customerName). id 로 거르면 「보이는 글자」와 「거르는 기준」이 갈라진다 —
 *    전체 A/S 현황이 「보이는 날짜로 세운다」를 적어 둔 그 함정과 같은 결이다.
 *  · 기타건에는 수리 건이 없어 고객사가 **이 줄의 customer_id** 하나뿐이고, 그 칸이
 *    비어 있는 줄이 많다(개발 DB 실측 2026-11-06 — 13건 중 3건만 찼다). 비어 있는
 *    줄을 고르는 길이 있어야 하는데 id 에는 그런 값이 없다.
 *
 * 그래서 배열에 들어갈 수 있는 값이 둘이다: `"NONE"`(공급처가 비어 있는 줄) · 그
 * 이름 자체. 🔴 **`"NONE"` 은 거르는 방식이 아니라 배열의 평범한 원소**다 — 화면의
 * 목록에 실제로 서는 한 줄이고, 다른 이름과 **함께** 고를 수 있어야 한다(「가나
 * 테크와 미지정을 같이」가 실제 쓰임이다).
 *
 * ── 🔴 고를 수 있는 공급처는 **지금 떠 있는 기타건들에서** 뽑는다 ────────
 * 고객사 마스터 전체를 내밀면 고를 수 있는 이름이 수백인데 대부분 0건이다. 전체 A/S
 * 현황도 같은 규칙으로 뽑는다(collectCustomerFilterOptions — 「필터를 걸기 전의
 * rows 에서」). **거른 뒤의 줄에서 뽑으면 안 된다**: 한 번 고르는 순간 목록에 그
 * 공급처만 남아, 다른 이름이 선택지에서 사라져 되돌릴 수 없게 된다.
 * ============================================================================
 */

/** 공급처가 비어 있는 줄을 고르는 값. 이름이 `"NONE"` 인 고객사는 없다. */
export const MISC_CASE_UNASSIGNED_CUSTOMER_VALUE = "NONE";

export type MiscCaseFilters = {
  /** 글자 찾기. 여덟 칸을 함께 본다(filterDomesticOrdersBySearch). */
  query: string;
  /** 보고 싶은 상태들. **빈 배열이 「전체」**다(2026-11-11 복수 선택). */
  statuses: readonly MiscCaseStatus[];
  /**
   * 보고 싶은 공급처들 — **이름**이다(id 가 아니다, 위 머리말). 빈 배열이 「전체」고,
   * `"NONE"`(미지정)은 그 안의 평범한 원소다.
   */
  customerNames: readonly string[];
};

export const DEFAULT_MISC_CASE_FILTERS: MiscCaseFilters = {
  query: "",
  statuses: [],
  customerNames: [],
};

/**
 * 접혔을 때 감춰지는 조건 중 지금 걸려 있는 개수 — 전체 A/S 현황의
 * countHiddenActiveFilters 와 같은 자리다. **검색어는 세지 않는다**(늘 보인다).
 *
 * 🔴 **몇 개를 골랐든 그 필터는 하나**다. 여기서 세는 것은 「걸려 있는 조건의
 * 수」이지 고른 값의 수가 아니다 — 공급처를 셋 고른 것은 「공급처라는 조건 하나가
 * 걸려 있다」는 뜻이고, 그것을 3 으로 세면 접힌 거르개가 「3개 적용됨」이라 말해
 * 사람이 어디서 세 가지를 걸었는지 찾아 헤맨다(전체 A/S 현황의 같은 주석).
 */
export function countActiveMiscCaseFilters(filters: MiscCaseFilters): number {
  let count = 0;
  if (filters.statuses.length > 0) count += 1;
  if (filters.customerNames.length > 0) count += 1;
  return count;
}

export type MiscCaseFilterable = DomesticOrderSearchable & {
  status: MiscCaseStatus;
  customerName: string | null;
};

/**
 * 고를 수 있는 공급처 — **자료에 실제로 있는 이름만**, 가나다순. 공백만 적힌 이름은
 * 없는 것으로 접으므로(foldBlankToNull) 같은 고객사가 둘로 갈라지지 않는다.
 *
 * 비어 있는 줄이 하나라도 있으면 목록 **맨 뒤**에 「미지정」 자리를 둔다 — 하나도
 * 없는데 내밀면 눌러도 늘 0건인 칸이 된다.
 */
export function collectMiscCaseCustomerOptions(
  rows: readonly { customerName: string | null }[]
): { value: string; label: string }[] {
  const names = new Set<string>();
  let hasUnassigned = false;
  for (const row of rows) {
    const name = foldBlankToNull(row.customerName);
    if (name === null) hasUnassigned = true;
    else names.add(name);
  }

  const options = [...names]
    .sort((a, b) => a.localeCompare(b))
    .map((name) => ({ value: name, label: name }));

  if (hasUnassigned) {
    options.push({
      value: MISC_CASE_UNASSIGNED_CUSTOMER_VALUE,
      // 내자 정리가 같은 줄을 묶을 때 쓰는 **그 글자**다 — 두 화면이 같은 줄을
      // 다른 말로 부르지 않게 상수를 나눠 쓴다.
      label: UNASSIGNED_CUSTOMER_LABEL,
    });
  }
  return options;
}

/**
 * 조건에 맞는 줄만 남긴다 — 글자 찾기 · 상태 · 공급처를 **모두** 만족해야 한다
 * (전체 A/S 현황의 applyFilters 와 같은 규칙: **종류끼리는 AND**).
 *
 * 🔴 **한 종류 안에서는 합집합**이다(2026-11-11 복수 선택). 상태를 둘 고르면 둘 중
 * 하나이기만 하면 남는다 — 교집합이면 한 줄의 상태는 하나뿐이라 둘을 고르는 순간
 * 늘 0건이 된다. 길이가 0 이면 그 조건은 아예 안 걸린 것이다(= 전체).
 *
 * **입력 차례를 그대로 지킨다.** 세우는 일은 sortMiscCases 가 따로 하고, 거르는 쪽이
 * 차례를 건드리면 조건을 걸 때마다 줄이 다시 선다.
 */
export function applyMiscCaseFilters<T extends MiscCaseFilterable>(
  rows: readonly T[],
  filters: MiscCaseFilters
): T[] {
  const searched = filterDomesticOrdersBySearch(rows, filters.query);
  return searched.filter((row) => {
    if (filters.statuses.length > 0 && !filters.statuses.includes(row.status)) return false;
    // 🔴 공급처가 비어 있는 줄을 `"NONE"` 으로 **바꿔 놓고 한 번만 견준다.** 미지정을
    //    따로 떼어 판정하면 「가나 테크와 미지정을 함께」 고른 조합에서 먼저 쓴 줄이
    //    나중 줄을 잡아먹는다(전체 A/S 현황의 유·무상에서 실제로 걸린 자리다).
    //    공백만 적힌 이름도 없는 것으로 접는다 — 보이지 않는 한 칸짜리 이름 때문에
    //    화면에는 빈칸인데 「미지정」에서 빠지는 줄이 생기면 안 된다.
    if (filters.customerNames.length > 0) {
      const name = foldBlankToNull(row.customerName) ?? MISC_CASE_UNASSIGNED_CUSTOMER_VALUE;
      if (!filters.customerNames.includes(name)) return false;
    }
    return true;
  });
}

/** 아직 한 줄도 없을 때. 「검색에 안 걸린다」와 **다른 말**이다(아래). */
export const MISC_CASE_EMPTY_LABEL = "아직 기타건이 없습니다.";

/**
 * 지금 걸린 조건(글자 찾기 · 상태 · 공급처)에 걸리는 줄이 없을 때.
 *
 * 🔴 위 글자와 가르는 까닭: 「없다」가 **자료가 없다**는 뜻인지 **내가 건 조건에
 * 안 걸린다**는 뜻인지 한 문장으로는 알 수 없고, 앞쪽으로 읽은 사람은 조건을 풀어
 * 볼 생각을 하지 않는다. 말투는 전체 A/S 현황의 같은 자리와 맞췄다(「조건에 맞는
 * A/S 접수 건이 없습니다.」).
 */
export const MISC_CASE_NO_MATCH_LABEL = "조건에 맞는 기타건이 없습니다.";
