/**
 * ============================================================================
 * 내자 정리 목록의 계산 — 값 고르기 · 년도 고르기 · 고객사 묶기 · 완료 판정 ·
 * 납기일 줄 나누기
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
 * ── 고객사·형식·L/N·S/N·고장내역은 이 행의 값이 먼저다 ──────────────────
 * 그 다섯은 두 곳에서 알 수 있다 — 이 행에 적힌 값과, 연결된 수리 건에서
 * 따라오는 값. 이 행에 적힌 쪽을 먼저 본다(schema/domestic-orders.ts 의
 * '여기에도 있다'). 판정을 SQL 의 coalesce 에 맡기지 않고 여기 두는 이유는
 * 그래야 시험할 수 있어서이고, 그 시험이 실제로 잡아 주는 것이 아래 규칙이다:
 *
 * **빈 문자열과 공백만 적힌 값은 "없음"이다.** 이 구분이 없으면 실수로 스페이스
 * 한 칸이 들어간 줄이 수리 건의 값을 영영 가린다 — 화면에는 빈칸으로 보이는데
 * 원본에는 값이 있는 상태라, 왜 안 보이는지 화면만 봐서는 알 길이 없다.
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
