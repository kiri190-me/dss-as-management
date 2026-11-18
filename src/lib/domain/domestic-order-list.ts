/**
 * 🔵 「발주일 미정」은 **화면에 보이는 그 글자**를 그대로 쓴다 — 상태 거르개의 한
 * 줄이 그 배지가 붙은 줄을 가리키는 것이라(아래 거르개 머리말), 두 곳에 따로
 * 적으면 글자를 바꾼 날 필터 이름만 옛말로 남는다. 저쪽 파일은 아무것도 들여오지
 * 않으므로 서로 부르는 고리가 생기지 않는다.
 */
import { NO_ORDER_DATE_LABEL } from "./domestic-order-display";
import { normalizeEntityName } from "./entity-name-match";

/**
 * ============================================================================
 * 내자 정리 목록의 계산 — 값 고르기 · 년도 고르기 · 글자로 찾기 · 고객사 묶기 ·
 * 완료 판정 · 납기일 줄 나누기
 * ============================================================================
 * DB 도 React 도 여기 들어오지 않는다. repair-case-filters.ts 와 같은 자리의
 * 파일이고, 같은 이유로 순수 함수만 둔다 — 목록 화면이 무엇을 감추고 무엇을
 * 함께 묶는지는 **규칙**이지 그리기가 아니라서, 화면 안에 두면 그 규칙을
 * 시험할 방법이 브라우저를 띄우는 것밖에 남지 않는다.
 *
 * ── 년도는 문자열 앞 4글자다 ────────────────────────────────────────────
 * order_issued_date 는 PostgreSQL date 컬럼이라 "YYYY-MM-DD" 문자열로 온다.
 * new Date(...) 로 파싱하지 않는다 — 날짜만 있는 문자열은 UTC 자정으로 읽히고,
 * 한국(UTC+9)에서 보면 1월 1일이 전해 12월 31일로 밀린다. 이 저장소가 이미
 * 겪은 고장이라 date-only.ts 파일 머리에 그 경위가 적혀 있다. 앞 4글자를
 * 그대로 쓰면 시간대가 개입할 여지 자체가 없다.
 *
 * ── 발주일 없는 줄은 어느 년도에서도 사라지지 않는다 ────────────────────
 * 발주일이 비었다는 것은 "아직 발주가 나지 않았다"는 뜻이고, 그 줄이야말로
 * 사람이 챙겨야 하는 줄이다. 년도로 거를 때 함께 떨어뜨리면 어느 해를 골라도
 * 보이지 않아, 잊혔다는 사실조차 화면에서 알 수 없게 된다. 그래서 년도 조건은
 * **날짜가 있는 줄에만** 적용한다.
 *
 * 형식이 깨진 값(년도 네 자리를 읽을 수 없는 값)도 같은 쪽으로 보낸다.
 * 어느 해로 추측해 넣는 것보다 늘 보이게 두는 편이 안전하다 — 추측한 해에
 * 넣으면 그 줄은 다른 해에서 영영 보이지 않는다.
 *
 * ── 검색은 한 칸이고, 여덟 칸 중 어디든 걸리면 남는다 ───────────────────
 * 사람이 아는 것은 자기가 손에 쥔 번호 하나다 — 그것이 발주서번호인지
 * 견적서번호인지 인수번호인지를 먼저 골라 달라고 하면, 고르는 일부터
 * 틀린다. 그래서 칸마다 검색칸을 두지 않고 하나로 받아 여덟 칸을 함께 본다
 * (filterDomesticOrdersBySearch).
 *
 * 맞추는 방식은 이 저장소가 이미 쓰던 것 그대로다 — normalizeEntityName
 * (entity-name-match.ts). 앞뒤 공백을 떼고, 사이 공백을 한 칸으로 줄이고,
 * 대소문자를 무시한다. repair-case-link-search.ts 가 같은 이유로 같은 함수를
 * 부른다: 여기서 규칙을 새로 적으면 같은 글자가 화면마다 다르게 걸린다.
 *
 * ── 검색어가 있으면 년도를 보지 않는다 ──────────────────────────────────
 * 그 판단은 화면이 한다(DomesticOrderListScreen). 견적서번호를 칠 때 그게 몇
 * 년도 건인지 기억하는 사람은 없어서, 년도 안에서만 찾으면 **있는 건을
 * "없다"고 보게 된다.** 이 파일의 두 함수(년도 거르기 · 검색)는 서로를 부르지
 * 않는다 — 어느 쪽을 쓸지 정하는 것은 화면의 상태(검색어가 있는가)이고,
 * 규칙 둘을 하나로 붙여 두면 각각을 따로 시험할 수 없다.
 *
 * ── 고객사·형식·L/N·S/N·고장내역은 이 행의 값이 먼저다 ──────────────────
 * 그 다섯은 두 곳에서 알 수 있다 — 이 행에 적힌 값과, 연결된 수리 건에서
 * 따라오는 값. 이 행에 적힌 쪽을 먼저 본다(schema/domestic-orders.ts 의
 * '여기에도 있다'). 판정을 SQL 의 coalesce 에 맡기지 않고 여기 두는 이유는
 * 그래야 시험할 수 있어서이고, 그 시험이 실제로 잡아 주는 것이 아래 규칙이다:
 *
 * **빈 문자열과 공백만 적힌 값은 "없음"이다.** 이 구분이 없으면 실수로 스페이스
 * 한 칸이 들어간 줄이 수리 건의 값을 영영 가린다 — 화면에는 빈칸으로 보이는데
 * 원본에는 값이 있는 상태라, 왜 안 보이는지 화면만 봐서는 알 길이 없다.
 *
 * ── 🔴 납품일은 **이 파일을 떠났다** (2026-11-08) ────────────────────────
 * 2026-09-11 까지 이 자리에는 `resolveDomesticOrderDeliveredDate` 가 있었고,
 * 머리말은 이렇게 적고 있었다: 「**수리 건이 연결된 줄**의 납품일은 그 건의 실제
 * 출하일 **하나뿐**이고, 그 줄에 손으로 적힌 값이 있어도 화면에 나오지 않는다 …
 * 손으로 적는 칸을 그 옆에 나란히 두면 둘이 어긋나는 줄이 생기고, 그때 어느 쪽이
 * 맞는지 화면만 봐서는 알 길이 없다 — 그래서 아예 한쪽만 보여 준다.」
 *
 * 🔴 **그 걱정은 지금도 옳고, 답이 바뀌었다.** 사용자 결정(2026-11-07, 연동은
 * 양방향)으로 이제 둘을 **맞춘다** — 어긋남을 숨기는 대신 저장할 때마다 같은
 * 날짜로 만들고, 맞출 수 없는 모양에서는 사람에게 말한다. 그리고 납품일 자체가
 * 이 줄의 칼럼이 아니라 **납기요청일 행마다 하나씩** 달리게 되었다(분할 납품).
 *
 * 그 규칙 전부는 **domain/delivered-date-link.ts** 하나가 가진다
 * (resolveDomesticOrderDeliveryDisplay — 그리기, 그리고 묶기 둘). 여기에 껍데기를
 * 남겨 다시 내보내지 않는 것은 이름이 둘이면 둘 다 고쳐야 하기 때문이고, 옛 함수를
 * 남겨 두지 않는 것은 **그 함수가 이제 틀린 답을 내놓기 때문**이다 — 남겨 두면
 * 다음 사람이 그것을 보고 「납품일은 연결 여부로 가른다」로 읽는다.
 *
 * 🔵 **`domestic_orders.delivered_date`·`delivered_by` 칼럼은 지우지 않았다**
 * (사용자 결정 11 — PO 가 같은 DB 에서 쓴다). 저장은 읽어 온 값을 그대로 되실어
 * 보내고(domestic-order-cell-edit.ts 의 그 칸 주석), **A/S 는 그리지 않는다.**
 * ============================================================================
 */

/** 고객사가 비어 있는 묶음의 이름. 화면과 시험이 같은 글자를 쓴다. */
export const UNASSIGNED_CUSTOMER_LABEL = "(고객사 미지정)";

/** 이 파일의 함수들이 실제로 보는 칸만 요구한다 — 전체 행 타입을 끌어오지 않는다. */
type OrderIssued = { orderIssuedDate: string | null };
type CustomerNamed = { customerName: string | null };
type Completable = { completedAt: string | null };

const YEAR_PATTERN = /^\d{4}$/;

/**
 * 비어 있음을 한 가지 모양으로 접는다 — null · undefined · 빈 문자열 ·
 * 공백만 적힌 값은 전부 null 이다.
 *
 * 검증(validation/domestic-order-input.ts)이 저장 전에 같은 일을 하지만, 이
 * 함수가 따로 있어야 한다: 조회는 저장을 거치지 않은 값도 읽는다 — 연결된
 * 수리 건에서 따라온 값, 그리고 이 기능이 생기기 전에 들어간 행이 그렇다.
 * 앞뒤 공백을 떼고 돌려주므로 화면과 묶기가 같은 글자를 본다.
 */
export function foldBlankToNull(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * 고객사·형식·L/N·S/N·고장내역을 정한다 — **이 행에 적힌 값이 먼저, 없으면
 * 연결된 수리 건의 값**(파일 헤더).
 *
 * 두 값을 다 받아야 하는 이유가 이 서명에 그대로 드러난다. 부르는 쪽은
 * 어느 하나를 미리 고르지 않고 둘 다 넘긴다 — 조회가 coalesce 로 하나만
 * 실어 오면, 화면은 그 값이 어느 쪽에서 왔는지 영영 알 수 없고 폼도
 * "연결된 수리 건에는 이렇게 적혀 있습니다"를 보여 줄 수 없다.
 */
export function resolveDomesticOrderValue(
  ownValue: string | null | undefined,
  repairCaseValue: string | null | undefined
): string | null {
  return foldBlankToNull(ownValue) ?? foldBlankToNull(repairCaseValue);
}

/**
 * 이 줄에 칠할 고객사 배경색(팔레트 키). 색이 없거나 고객사를 알 수 없으면
 * null 이다.
 *
 * **정해진 고객사의 색이어야 한다.** 고객사는 두 곳에서 온다 — 이 행에 적힌
 * 고객사와 연결된 수리 건의 고객사 — 그리고 화면이 그리는 이름은
 * resolveDomesticOrderValue 가 고른 쪽이다. 색만 따로
 * `resolveDomesticOrderValue(이 행의 색, 수리 건의 색)` 으로 접으면, 이 행의
 * 고객사에 색이 없을 때 **다른 고객사(수리 건 쪽)의 색이 칠해진다** — 화면에는
 * A 라고 적혀 있는데 줄은 B 의 색인 상태다. 그래서 "어느 쪽 고객사인가"를 먼저
 * 정하고(이름을 고르는 그 판단 그대로), 그쪽의 색을 그대로 가져온다.
 *
 * 색이 팔레트에 있는 값인지는 여기서 보지 않는다 — 그 판단은
 * domain/customer-row-color.ts 한 곳에 있고, 모르는 키는 거기서 "없음"으로
 * 떨어진다.
 */
export function resolveDomesticOrderCustomerRowColor(row: {
  ownCustomerName: string | null;
  ownCustomerRowColor: string | null;
  repairCaseCustomerRowColor: string | null;
}): string | null {
  return foldBlankToNull(row.ownCustomerName) !== null
    ? row.ownCustomerRowColor
    : row.repairCaseCustomerRowColor;
}

/**
 * 이 파일의 납기일 함수들이 실제로 보는 칸만 요구한다 — 조회 쪽의
 * DomesticOrderDueDate 를 끌어오지 않는다(id · display_order 는 그리는 데
 * 쓰이지 않는다).
 */
type DueDateLike = { dueDate: string; note: string | null };

/**
 * 날짜 하나를 사람이 읽는 한 조각으로. 메모가 있으면 괄호로 붙인다 —
 * "2026-01-20 (1차분)".
 *
 * 메모가 유일한 단서인 경우가 있다: 같은 발주를 나눠 납품하면 날짜만으로는
 * 어느 분량인지 알 수 없다. 공백만 적힌 메모는 없는 것으로 접는다(이 파일의
 * 다른 값들과 같은 규칙).
 */
function describeDueDate(dueDate: DueDateLike): string {
  const note = foldBlankToNull(dueDate.note);
  return note === null ? dueDate.dueDate : `${dueDate.dueDate} (${note})`;
}

/**
 * 목록의 `납기요청일` 칸에 그릴 줄들 — **한 줄에 날짜 하나**다. 날짜가 없으면
 * 빈 배열이고, 화면이 "-"로 바꾼다(자료를 "-"로 바꾸는 일은 화면에서만 한다 —
 * queries 파일의 같은 규칙).
 *
 * ── 왜 접지 않고 전부 늘어놓는가 ────────────────────────────────────────
 * 처음에는 첫 날짜와 "외 N건"만 적었다. 이 표는 22칼럼이라 칸 하나에 쓸 수 있는
 * 폭이 좁고, 날짜를 옆으로 늘어놓으면 그 줄만 길어져 표가 읽히지 않아서였다.
 * 그런데 접힌 날짜는 마우스를 올리거나 폼을 열어야 보였고, 납기일은 이 표에서
 * 사람이 가장 자주 확인하는 값이라 결국 매번 다시 열어 보게 됐다 — 접어서 아낀
 * 폭보다 잃은 것이 컸다.
 *
 * 그래서 **옆이 아니라 아래로** 늘린다. 칼럼은 여전히 22개이고
 * (DomesticOrderListScreen 헤더의 '표 22칼럼'), 길어지는 것은 날짜가 여럿인 줄의
 * 높이뿐이다. 표가 세로로 들쭉날쭉해지는 것은 전부 보이는 값을 얻는 대가로
 * 받아들인다.
 *
 * 줄바꿈으로 이어 붙인 한 덩어리가 아니라 **글자 배열**을 돌려준다. 한 덩어리로
 * 주면 무엇이 한 줄인지가 CSS(whitespace) 설정에 달리게 되고, 그러면 이 규칙을
 * 브라우저를 띄우지 않고는 시험할 수 없다 — 이 파일이 순수 함수만 두는 이유가
 * 그것이다(파일 헤더).
 *
 * **순서를 여기서 다시 정하지 않는다.** 받은 차례가 곧 화면의 차례다 —
 * 1차분·2차분처럼 순서가 뜻인 값이라, 날짜순으로 몰래 다시 세우면 사람이 폼에
 * 늘어놓은 차례와 표에 보이는 차례가 어긋난다. 차례를 정하는 일은 조회가
 * 한다(queries 의 loadDueDatesByOrderId).
 */
export function formatDomesticOrderDueDateLines(dueDates: readonly DueDateLike[]): string[] {
  return dueDates.map(describeDueDate);
}

/**
 * 그 줄의 납기일 **전부**를 한 줄로. 없으면 null 이다.
 *
 * 목록은 줄마다 따로 그리므로(위 formatDomesticOrderDueDateLines) 이 한 줄을 쓰는
 * 곳은 수정 폼 하나다 — 저장이 충돌했을 때 방금 적은 값을 잃지 않도록 적어 두는
 * 초안 상자(DomesticOrderEditForm 의 dueDatesDraftText). 거기는 사람이 통째로
 * 복사해 가는 글이라 여러 줄보다 한 줄이 맞다.
 */
export function formatDomesticOrderDueDates(dueDates: readonly DueDateLike[]): string | null {
  if (dueDates.length === 0) return null;
  return dueDates.map(describeDueDate).join(", ");
}

/**
 * 이 줄의 발주 년도. 날짜가 없거나 년도를 읽을 수 없으면 null 이고, null 은
 * "년도로 가릴 수 없는 줄"이라는 뜻이다(파일 헤더).
 */
export function orderIssuedYearOf(row: OrderIssued): string | null {
  if (row.orderIssuedDate === null) return null;
  const year = row.orderIssuedDate.slice(0, 4);
  return YEAR_PATTERN.test(year) ? year : null;
}

/**
 * 고를 수 있는 년도. **자료에 실제로 있는 년도만** 내놓는다 — 없는 해를
 * 고르면 빈 표가 나오고, 사람은 자료가 사라진 것인지 원래 없는 해인지
 * 구분할 수 없다. 최신 해가 앞이다(대부분 올해나 작년을 본다).
 */
export function collectDomesticOrderYears(rows: readonly OrderIssued[]): string[] {
  const years = new Set<string>();
  for (const row of rows) {
    const year = orderIssuedYearOf(row);
    if (year !== null) years.add(year);
  }
  return [...years].sort().reverse();
}

/** 년도로 가릴 수 없는 줄이 몇 건인가 — 화면이 "왜 이 줄이 함께 보이는지" 알리는 데 쓴다. */
export function countDomesticOrdersWithoutOrderYear(rows: readonly OrderIssued[]): number {
  return rows.filter((row) => orderIssuedYearOf(row) === null).length;
}

/**
 * 고른 년도만 남긴다. 발주 년도를 읽을 수 없는 줄은 **언제나 통과**한다
 * (파일 헤더). year 가 null 이면 아무것도 거르지 않는다 — 고를 수 있는 년도가
 * 하나도 없을 때가 그렇다.
 *
 * 입력 순서를 그대로 유지한다. 이 표에는 사람이 매긴 순번이 있어서, 거르는
 * 일이 순서를 건드리면 화면의 순번이 위아래로 어긋난다.
 */
export function filterDomesticOrdersByYear<T extends OrderIssued>(
  rows: readonly T[],
  year: string | null
): T[] {
  if (year === null) return [...rows];
  return rows.filter((row) => {
    const rowYear = orderIssuedYearOf(row);
    return rowYear === null || rowYear === year;
  });
}

/**
 * 검색이 실제로 들여다보는 칸만 요구한다 — 조회의 전체 행 타입을 끌어오지
 * 않는다(이 파일의 다른 타입들과 같은 이유).
 *
 * **여기 적힌 여섯 칸(고객사·형식·S/N·L/N·인수번호·견적서번호)은 이미 정해진
 * 값이다.** 원본 두 벌이 아니라 고른 쪽 — 앞 다섯은 resolveDomesticOrderValue 가
 * 고른 쪽(이 행의 값 / 연결된 수리 건의 값), 견적서번호는 연결된 견적서가 이긴
 * 쪽(displayQuoteNumber) — 곧 **화면에 그려지는 그 글자**를 본다(queries 의
 * DomesticOrderListItem 에서 이미 접혀 온다). 원본 두 벌을 따로 뒤지면 화면이
 * 보여 주는 값과 검색이 보는 값이 어긋나, 눈에 보이는 글자를 그대로 쳤는데
 * 안 걸리는(혹은 화면에 없는 글자로 걸리는) 일이 생긴다. 견적서번호의 원본 칸
 * (quoteNumber)에는 연결된 줄에서 화면에 안 보이는 옛 손 번호가 남아 있다.
 */
export type DomesticOrderSearchable = {
  customerName: string | null;
  displayIntakeNumber: string | null;
  purchaseOrderNumber: string | null;
  displayQuoteNumber: string | null;
  projectName: string | null;
  modelName: string | null;
  serialNumber: string | null;
  lotNumber: string | null;
};

/**
 * 검색이 보는 칸 여덟. 목록으로 두는 이유는 칸을 늘리거나 줄이는 일이 이 한
 * 줄에서 끝나게 하기 위해서다 — 조건문을 여덟 개 늘어놓으면 하나를 빠뜨려도
 * 아무 데서도 티가 나지 않는다(그 칸으로만 조용히 못 찾게 된다).
 */
const DOMESTIC_ORDER_SEARCH_FIELDS: readonly (keyof DomesticOrderSearchable)[] = [
  "customerName",
  "displayIntakeNumber",
  "purchaseOrderNumber",
  "displayQuoteNumber",
  "projectName",
  "modelName",
  "serialNumber",
  "lotNumber",
];

/**
 * 지금 검색 중인가. **화면이 "년도를 무시할지"를 이 함수로 묻는다** — 화면에서
 * `query.trim() !== ""` 로 따로 판정하면 정규화 규칙이 두 곳에 생기고, 그러면
 * 스페이스 한 칸만 친 순간 "검색 중"이라 표시되면서 정작 거르기는 아무것도
 * 하지 않는 어긋난 상태가 만들어진다.
 */
export function isDomesticOrderSearchActive(query: string): boolean {
  return normalizeEntityName(query) !== "";
}

/**
 * 검색어에 걸리는 줄만 남긴다. 여덟 칸(DOMESTIC_ORDER_SEARCH_FIELDS) 중
 * **하나라도** 검색어를 품고 있으면 남는다 — 부분 일치이고, 대소문자와 공백
 * 모양은 normalizeEntityName 이 접는다.
 *
 * **검색어가 비었거나 공백뿐이면 아무것도 거르지 않는다.** 스페이스 한 칸이
 * 목록을 통째로 지우면 사람은 "자료가 없다"고 읽는다(파일 헤더 ·
 * repair-case-link-search.ts 의 같은 규칙).
 *
 * 값이 없는 칸(null)은 그냥 걸리지 않는 칸이다 — 이 표에는 빈 칸이 흔하다
 * (견적은 냈는데 발주 전, 발주는 받았는데 접수 전).
 *
 * **입력 순서를 그대로 지킨다.** 이 표에는 사람이 매긴 순번이 있어서, 검색이
 * 줄을 다시 세우면 순번 칸과 눈에 보이는 차례가 검색할 때만 어긋난다
 * (filterDomesticOrdersByYear 와 같은 이유).
 */
export function filterDomesticOrdersBySearch<T extends DomesticOrderSearchable>(
  rows: readonly T[],
  query: string
): T[] {
  const q = normalizeEntityName(query);
  if (q === "") return [...rows];

  return rows.filter((row) =>
    DOMESTIC_ORDER_SEARCH_FIELDS.some((field) => {
      const value = row[field];
      return typeof value === "string" && normalizeEntityName(value).includes(q);
    })
  );
}

/**
 * 처음 보여 줄 년도. **올해가 기본값**이다 — 열자마자 보고 싶은 것은 거의
 * 언제나 올해 것이다.
 *
 * 올해 자료가 아직 하나도 없으면 있는 것 중 가장 최근 해로 내려온다. 없는
 * 해를 골라 둔 채 시작하면 첫 화면이 (발주일 없는 줄을 빼고) 비어 보이는데,
 * 그것은 자료가 없다는 뜻이 아니라 고른 해가 없다는 뜻이라 오해를 부른다.
 * 고를 수 있는 년도가 아예 없으면 null — 그때는 거르지 않는다.
 */
export function resolveInitialDomesticOrderYear(
  years: readonly string[],
  currentYear: string
): string | null {
  if (years.length === 0) return null;
  if (years.includes(currentYear)) return currentYear;
  return years[0];
}

/** 완료 처리된 줄인가. 상태는 completed_at 한 곳에만 있다(schema 파일 주석). */
export function isDomesticOrderCompleted(row: Completable): boolean {
  return row.completedAt !== null;
}

export type DomesticOrderCustomerGroup<T> = {
  /** 원본 값. 고객사가 없는 묶음은 null 이다. */
  customerName: string | null;
  /** 소제목에 그대로 쓸 글자. 고객사가 없으면 UNASSIGNED_CUSTOMER_LABEL. */
  label: string;
  rows: T[];
};

/** 이름이 비어 있는 것과 없는 것은 같은 뜻이다 — 묶음이 둘로 갈라지지 않게 한다. */
function customerKeyOf(row: CustomerNamed): string | null {
  return foldBlankToNull(row.customerName);
}

/**
 * 고객사끼리 묶는다.
 *
 * 묶음의 순서는 **먼저 나온 고객사가 먼저**다. 부르는 쪽이 이미 순번
 * (display_order) → 등록순으로 정렬해 넘기므로, 그 순서가 곧 묶음 순서가 되고
 * 묶음 안의 줄 순서도 원본 그대로 남는다. 여기서 이름순으로 다시 정렬하지
 * 않는 이유가 그것이다 — 사람이 매긴 순번을 화면이 다시 흔들면, 표의 순번
 * 칸과 눈에 보이는 차례가 어긋난다.
 *
 * 고객사가 없는 묶음은 **맨 뒤** 하나다. 청구 상대가 아직 정해지지 않은 줄이라
 * 다른 고객사 사이에 끼워 두면 그 고객사의 건으로 읽힌다.
 *
 * 🔴 **발주발행일 세우기(2026-11-18)가 생긴 뒤에도 이 함수는 한 글자도 안 바뀌었다.**
 * 다시 세우는 일은 이 함수가 내놓은 묶음을 받아 **따로** 하고
 * (sortDomesticOrderGroupRowsByOrderIssuedDate), 세모를 누르지 않은 평상시에는 그
 * 함수가 **아예 불리지 않는다.** 여기에 방향 인자를 받아 섞어 두지 않은 까닭이
 * 그것이다 — 위 '묶음 안의 줄 순서도 원본 그대로'는 기본 상태에서 여전히 참이어야
 * 하고, 한 함수가 두 일을 하면 그 사실을 따로 시험할 자리가 없어진다.
 */
export function groupDomesticOrdersByCustomer<T extends CustomerNamed>(
  rows: readonly T[]
): DomesticOrderCustomerGroup<T>[] {
  const named = new Map<string, T[]>();
  const unassigned: T[] = [];

  for (const row of rows) {
    const key = customerKeyOf(row);
    if (key === null) {
      unassigned.push(row);
      continue;
    }
    const bucket = named.get(key);
    if (bucket) bucket.push(row);
    else named.set(key, [row]);
  }

  const groups: DomesticOrderCustomerGroup<T>[] = [...named].map(([label, groupRows]) => ({
    customerName: label,
    label,
    rows: groupRows,
  }));

  if (unassigned.length > 0) {
    groups.push({ customerName: null, label: UNASSIGNED_CUSTOMER_LABEL, rows: unassigned });
  }

  return groups;
}

/**
 * ============================================================================
 * 🔴 거르개 둘(상태 · 고객사)과 발주발행일 세우기 (2026-11-18 사용자 요구)
 * ============================================================================
 * 원문: 「내자정리에 상태 필터, 고객사 필터를 드롭박스로 만들어주고 드롭박스에서는
 * 복수 선택을 할 수 있도록 해줘. 상태 필터는 [완료됨, 미완료, 발주일 미정] 를
 * 목록으로 둬줘. 그리고 목록에서 발주 발행일 옆에 작은 세모를 둬서 고객사 별로
 * 발행일을 오름차순·내림차순으로 다시 정렬할 수 있도록 해줘. (고객사들이 섞이지
 * 않게 고객사 안에서 정렬되도록 해줘.)」
 *
 * 모양은 [전체 A/S 현황]·[기타건 현황]의 거르개를 그대로 따른다 — 값은 언제나
 * **코드**, 거르는 일은 **순수 함수**, 그리는 일은 화면
 * (domain/repair-case-filters.ts · domain/misc-case-list.ts). 새 모양을 만들지 않는다.
 *
 * ── 🔴 **빈 배열이 「전체」**이고 `"ALL"` 같은 값은 두지 않는다 ──────────
 * 2026-11-11 에 일곱 필터가 복수 선택으로 옮겨 가면서 같은 판단을 했다: `"ALL"` 을
 * 두면 「"ALL" 이 들어 있는 배열」이라는 뜻 없는 상태가 생기고, 거르는 쪽이 매번
 * 그것을 따로 가려내야 한다.
 *
 * ── 🔴 **한 종류 안에서는 합집합(OR)** 이다 ─────────────────────────────
 * 상태를 둘 고르면 **둘 중 하나라도** 해당되는 줄이 남는다. 다른 화면의 복수 선택과
 * 같은 규칙이고, 이 화면에서는 특히 그래야 한다 — 아래에 적듯 상태 셋이 서로
 * 배타적이지 않아서, 교집합으로 두면 「완료됨 + 발주일 미정」이 **두 조건을 다
 * 만족하는 줄**이라는 전혀 다른 뜻이 된다(그리고 사람은 그 뜻으로 고르지 않는다).
 *
 * ── 🔴 **상태 셋은 서로 배타적이지 않다** ───────────────────────────────
 * 「완료됨」과 「미완료」는 completed_at 하나로 갈리는 반대쪽이지만,
 * **「발주일 미정」은 그 둘과 겹친다** — 완료 처리에 「발주일이 적혀 있어야 한다」는
 * 관문이 없어서(db/mutations/domestic-orders.ts 의 setDomesticOrderCompletion — 그
 * 함수는 order_issued_date 를 읽지도 않는다), 발주일이 빈 채로 완료된 줄이
 * 실제로 있을 수 있다. 그래서 셋을 「상태」라는 한 칸에 두되 OR 로 합친다.
 *
 * 🔵 그 결과 **「완료됨」과 「미완료」를 둘 다 고르면 전체**가 된다. 고장이 아니라
 * 합집합의 당연한 결과이고, 그 조합을 막지 않는 까닭은 체크 둘을 켜 보는 사람에게
 * 「이 조합은 안 됩니다」를 설명할 자리가 드롭다운에 없기 때문이다.
 *
 * ── 🔴 「발주일 미정」의 판정은 **배지와 같은 한 줄**이다 ────────────────
 * `orderIssuedDate === null`. 화면의 OrderIssuedDateContent 가 바로 그 한 줄로 배지를
 * 그린다 — **배지가 붙은 줄과 이 필터로 뽑히는 줄이 같아야** 사람이 필터를 믿는다.
 * 여기서만 공백 접기(foldBlankToNull)를 더하면 화면에는 배지가 없는데 필터에는
 * 걸리는 줄이 생기고, 그 어긋남은 오류 없이 조용히 산다.
 * ============================================================================
 */

/** 상태 거르개의 값 셋. 차례가 곧 드롭다운에 서는 차례다. */
export const DOMESTIC_ORDER_STATUS_FILTER_VALUES = [
  "COMPLETED",
  "INCOMPLETE",
  "NO_ORDER_DATE",
] as const;

export type DomesticOrderStatusFilterValue = (typeof DOMESTIC_ORDER_STATUS_FILTER_VALUES)[number];

/**
 * 보일 글자. 「발주일 미정」만은 **화면이 이미 쓰는 상수**를 그대로 가져온다 —
 * 그 글자는 발주발행일 칸의 배지에도 상세 화면에도 적히는 말이라, 여기 손으로
 * 한 번 더 적으면 바꾸는 날 한 곳만 바뀐다(파일 머리의 import 주석).
 */
export const DOMESTIC_ORDER_STATUS_FILTER_LABELS: Record<DomesticOrderStatusFilterValue, string> = {
  COMPLETED: "완료됨",
  INCOMPLETE: "미완료",
  NO_ORDER_DATE: NO_ORDER_DATE_LABEL,
};

/** 상태 거르개가 실제로 보는 칸 둘만 요구한다 — 이 파일의 다른 타입들과 같은 이유. */
type StatusFilterable = Completable & OrderIssued;

/**
 * 이 줄이 그 상태 하나에 해당되는가. **한 값씩** 묻는 모양으로 떼어 둔 까닭은
 * 합집합을 아래 한 줄로 적기 위해서이고(statuses.some), 그래야 「OR 인가」를
 * 조합마다 따로 시험할 수 있다.
 */
export function matchesDomesticOrderStatusFilter(
  row: StatusFilterable,
  value: DomesticOrderStatusFilterValue
): boolean {
  switch (value) {
    case "COMPLETED":
      return isDomesticOrderCompleted(row);
    case "INCOMPLETE":
      return !isDomesticOrderCompleted(row);
    case "NO_ORDER_DATE":
      // 🔴 화면의 배지와 **같은 한 줄**이다(위 머리말). 공백 접기를 더하지 않는다.
      return row.orderIssuedDate === null;
  }
}

/**
 * 고른 상태들 중 **하나라도** 해당되는 줄만 남긴다. 빈 배열이면 아무것도 거르지
 * 않는다(= 전체).
 *
 * **입력 순서를 그대로 지킨다.** 이 표에는 사람이 매긴 순번이 있어서, 거르는 일이
 * 줄을 다시 세우면 순번 칸과 눈에 보이는 차례가 조건을 걸 때만 어긋난다
 * (filterDomesticOrdersByYear · filterDomesticOrdersBySearch 와 같은 규칙).
 */
export function filterDomesticOrdersByStatus<T extends StatusFilterable>(
  rows: readonly T[],
  statuses: readonly DomesticOrderStatusFilterValue[]
): T[] {
  if (statuses.length === 0) return [...rows];
  return rows.filter((row) =>
    statuses.some((status) => matchesDomesticOrderStatusFilter(row, status))
  );
}

/**
 * 고객사가 비어 있는 줄을 고르는 값. 이름이 `"NONE"` 인 고객사는 없다.
 *
 * 🔴 **id 가 아니라 이름으로 거른다.** 화면에 보이는 값이 이름이고(묶음 소제목이
 * 그 이름이다), 이 표에는 고객사가 비어 있는 줄이 흔해서 그 줄을 고르는 길이
 * 있어야 하는데 id 에는 그런 값이 없다 — 「기타건 현황」이 2026-11-06 에 같은
 * 까닭으로 같은 선택을 했다(domain/misc-case-list.ts 의 그 머리말).
 */
export const DOMESTIC_ORDER_UNASSIGNED_CUSTOMER_VALUE = "NONE";

/**
 * 이 줄을 고객사 거르개의 어느 값으로 볼 것인가. 비어 있으면(공백만 적힌 것도
 * 포함) `"NONE"` 이다.
 *
 * 🔴 **미지정을 따로 떼어 판정하지 않고 값 하나로 접는다.** 따로 두면 「가온전자와
 * 미지정을 함께」 고른 조합에서 먼저 쓴 가지가 나중 가지를 잡아먹는다 — [전체 A/S
 * 현황]의 유·무상에서 실제로 걸렸던 자리다.
 */
export function domesticOrderCustomerFilterValue(row: CustomerNamed): string {
  return foldBlankToNull(row.customerName) ?? DOMESTIC_ORDER_UNASSIGNED_CUSTOMER_VALUE;
}

/**
 * 고를 수 있는 고객사 — **자료에 실제로 있는 이름만**, 가나다순. 비어 있는 줄이
 * 하나라도 있으면 맨 뒤에 「(고객사 미지정)」 한 줄을 둔다.
 *
 * 🔴 **고객사 마스터(customerOptions prop)를 쓰지 않는다.** 그 목록은 고칠 수 있는
 * 세션에만 내려오므로(page.tsx), 그것으로 선택지를 만들면 **수정 권한이 없는 분에게
 * 고객사 필터가 통째로 사라진다.** 그리고 마스터에는 이 표에 한 줄도 없는 고객사가
 * 수백 들어 있어 대부분이 0건인 목록이 된다. [전체 A/S 현황]이
 * collectCustomerFilterOptions 로, 「기타건 현황」이
 * collectMiscCaseCustomerOptions 로 푼 그 문제다 — 「목록에 있으면 필터에도 있다」를
 * 구조로 보장한다.
 *
 * 🔴 넘길 배열은 **거르기 전의 전체 줄**이어야 한다. 걸러진 뒤의 배열에서 뽑으면
 * 고객사를 하나 고르는 순간 나머지가 선택지에서 사라져 되돌아갈 수 없다
 * (CheckboxFilterPanel 은 선택지에 없는 값의 체크를 풀 칸을 그리지 못한다).
 * 🔵 년도·검색도 **거르기 전**이다 — 2026년을 보다 고객사를 고르고 2025년으로
 * 옮겼을 때 그 고객사가 선택지에서 사라지면, 걸린 조건을 풀 길이 없어진다.
 *
 * 🔵 「기타건 현황」의 collectMiscCaseCustomerOptions 가 이것을 그대로 부른다 —
 * 기타건은 수리 건이 안 붙은 **내자 줄 그 자체**라 같은 규칙이고, 두 벌로 적으면
 * 한쪽만 고쳐지는 날이 온다(그 파일이 검색 함수를 빌려 쓰는 것과 같은 까닭).
 */
export function collectDomesticOrderCustomerOptions(
  rows: readonly CustomerNamed[]
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
      value: DOMESTIC_ORDER_UNASSIGNED_CUSTOMER_VALUE,
      // 묶음 소제목이 쓰는 **그 글자**다 — 필터에서 고른 이름과 표에 적힌 이름이
      // 달라 보이면 안 된다.
      label: UNASSIGNED_CUSTOMER_LABEL,
    });
  }
  return options;
}

/**
 * 고른 고객사들 중 **하나라도** 해당되는 줄만 남긴다. 빈 배열이면 아무것도 거르지
 * 않는다(= 전체). 입력 순서는 그대로다(위 상태 거르개와 같은 규칙).
 */
export function filterDomesticOrdersByCustomerNames<T extends CustomerNamed>(
  rows: readonly T[],
  customerNames: readonly string[]
): T[] {
  if (customerNames.length === 0) return [...rows];
  return rows.filter((row) => customerNames.includes(domesticOrderCustomerFilterValue(row)));
}

/**
 * ============================================================================
 * 🔴 발주발행일 세우기 — **묶음 안에서만**, 그리고 **기본은 꺼짐**
 * ============================================================================
 * ── 왜 기본이 꺼짐인가 ──────────────────────────────────────────────────
 * 묶음 안의 차례는 **사람이 손으로 매긴 순번**(display_order)이고, 그 숫자가 표의
 * `순번` 칸에 그대로 찍힌다. 발행일순으로 세우면 그 숫자가 1·7·3·12 처럼 뒤죽박죽
 * 보인다 — 오류는 아니지만 처음 보는 사람은 자료가 망가진 것으로 읽는다. 그래서
 * **세모를 누르기 전에는 이 함수가 아예 불리지 않고**, 화면은 지금과 한 글자도
 * 다르지 않다(groupDomesticOrdersByCustomer 의 🔴 주석).
 *
 * 방향 인자에 null 을 받지 않는 것도 그 때문이다. 「꺼짐이면 그대로 돌려준다」를
 * 이 함수 안에 두면 평상시에도 한 번은 불리게 되고, 그러면 「기본 상태에서 묶음 안
 * 차례가 원본 그대로인가」가 이 함수의 정확성에 매달린다. 타입으로 못 박아 두면
 * 부르는 쪽이 가지를 나눌 수밖에 없다.
 *
 * ── 🔴 묶음의 **차례**와 **머리**는 건드리지 않는다 ─────────────────────
 * 사용자 요구가 「고객사들이 섞이지 않게 고객사 안에서」다. 묶음 자체를 다시 세우면
 * 발행일이 이른 고객사가 통째로 위로 올라와, 늘 보던 고객사 차례가 바뀐다.
 *
 * ── 🔴 **날짜가 없는 줄은 오름·내림 어느 쪽에서도 맨 뒤**다 ──────────────
 * 그 줄들은 발주발행일 칸에 「발주일 미정」 배지가 붙어 있는 줄이고, 날짜 축 위에
 * 설 자리가 애초에 없다. 둘 중 하나를 골라야 한다면 **뒤**인 까닭:
 *  · 방향을 뒤집을 때마다 앞뒤로 튀면 챙겨야 하는 그 줄들을 매번 다시 찾아야 한다.
 *    어느 방향에서도 같은 자리에 있어야 눈이 외운다.
 *  · 내림차순(최신이 위)에서 앞에 두면 **「가장 최근 건」으로 읽힌다** — 날짜가
 *    없다는 사실이 정반대의 뜻으로 전해진다.
 * 그 줄들끼리는 **원본 차례(순번) 그대로** 남는다.
 *
 * 🔵 빈 문자열·공백만 적힌 날짜도 같은 쪽으로 보낸다(foldBlankToNull — 이 파일이
 * 비어 있음을 한 모양으로 접는 그 규칙). 글자 그대로 비교하면 ""(빈 글자)가 어떤
 * 날짜보다도 앞서서, 오름차순 맨 위에 빈 칸이 줄줄이 서는 모습이 된다.
 *
 * ── 날짜는 **글자 그대로** 견준다 ───────────────────────────────────────
 * "YYYY-MM-DD" 는 사전순이 곧 날짜순이다. new Date(...) 로 파싱하지 않는 까닭은
 * 이 파일 머리말에 있다(날짜만 있는 문자열은 UTC 자정으로 읽혀 한국에서 하루
 * 밀린다).
 *
 * ── 같은 날짜끼리는 **원본 차례 그대로**다 ──────────────────────────────
 * Array.prototype.sort 는 ES2019 부터 안정 정렬이다. 한 날짜에 여러 줄이 걸리는
 * 일이 흔한 표라(같은 발주서로 여러 품목), 여기서 차례가 흔들리면 세모를 누를
 * 때마다 같은 묶음이 다르게 보인다.
 * ============================================================================
 */

export type DomesticOrderOrderIssuedSortDirection = "asc" | "desc";

/**
 * 지금 세우기 상태. **null 이 꺼짐**이고, 꺼짐이 기본값이다.
 */
export type DomesticOrderOrderIssuedSort = DomesticOrderOrderIssuedSortDirection | null;

/**
 * 세모를 눌렀을 때의 **다음 상태** — 꺼짐 → 오름 → 내림 → 꺼짐.
 *
 * 🔵 [전체 A/S 현황]은 같은 자리에서 두 상태만 돈다(오름 ↔ 내림 — 그 화면의
 * handleSortChange). **여기에만 세 번째 칸(꺼짐)이 있는 까닭**은 이 표에만
 * 「되돌아갈 원래 차례」가 있기 때문이다: 저쪽의 기본 차례는 어차피 어느 칸으로
 * 세운 결과라 끌 것이 없지만, 여기서는 사람이 손으로 매긴 순번이 기본이고 그것이
 * 표의 `순번` 칸에 찍혀 있다. 끌 수 없으면 한 번 누른 사람이 그 차례로 돌아갈
 * 길을 잃는다.
 *
 * 🔵 눈에 보이는 끄는 길은 따로 또 있다(화면의 「순번 차례로」 단추) — 세 번
 * 눌러야 꺼진다는 것은 눌러 보기 전에는 알 수 없는 규칙이라, 그것 하나만 두면
 * 사실상 끄는 길이 없는 것과 같다.
 */
export function nextDomesticOrderOrderIssuedSort(
  current: DomesticOrderOrderIssuedSort
): DomesticOrderOrderIssuedSort {
  if (current === null) return "asc";
  if (current === "asc") return "desc";
  return null;
}

/**
 * 묶음 **안의 줄만** 발주발행일순으로 다시 세운다. 묶음의 차례·이름·색은 그대로다.
 *
 * 원본 배열을 건드리지 않는다 — 받은 묶음은 useMemo 가 들고 있는 값이고, 제자리에서
 * 뒤집으면 React 가 같은 참조를 보고 다시 그리지 않는다.
 */
export function sortDomesticOrderGroupRowsByOrderIssuedDate<T extends OrderIssued>(
  groups: readonly DomesticOrderCustomerGroup<T>[],
  direction: DomesticOrderOrderIssuedSortDirection
): DomesticOrderCustomerGroup<T>[] {
  const sign = direction === "asc" ? 1 : -1;
  return groups.map((group) => ({
    ...group,
    rows: [...group.rows].sort((a, b) => {
      const left = foldBlankToNull(a.orderIssuedDate);
      const right = foldBlankToNull(b.orderIssuedDate);
      // 날짜 없는 줄은 방향과 무관하게 뒤다(머리말) — 그래서 sign 을 곱하지 않는다.
      if (left === null && right === null) return 0;
      if (left === null) return 1;
      if (right === null) return -1;
      if (left === right) return 0;
      return left < right ? -sign : sign;
    }),
  }));
}
