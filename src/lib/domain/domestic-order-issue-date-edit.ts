import { isValidDateString } from "./local/validation";
import { domesticOrderInlineEditQuoteLock } from "./domestic-order-cell-edit";
import type { RepairCaseDomesticOrderRow } from "./repair-case-domestic-order-dates";

/**
 * ============================================================================
 * 수리 건 상세 「내자 정리 발행일」 — **고치기**의 판정 (2026-09-29)
 * ============================================================================
 * DB 도 React 도 여기 들어오지 않는다. 옆 파일(repair-case-domestic-order-dates.ts)이
 * **무엇을 그릴지**를 정한다면, 이 파일은 **저장이 무엇을 할 것인지**를 정한다 —
 * 줄을 만들 것인가, 있는 줄을 고칠 것인가, 아예 막을 것인가.
 *
 * ── 🔴 왜 순수 함수로 떼어 놓았는가 ─────────────────────────────────────
 * **같은 판정을 화면과 서버가 각각 해야 하기 때문**이다. 화면만 막으면 서버
 * 액션을 직접 부르는 사람에게 열린다(auth/domestic-order-authorization.ts 의
 * '막는 곳은 여기가 아니다'와 같은 규칙). 두 곳이 규칙을 따로 적으면 언젠가
 * 한쪽만 고쳐지고, 그때 화면에는 단추가 없는데 서버는 받아 주는 상태가 된다.
 * 그래서 판정은 이 함수 하나이고, 화면(DomesticOrderDatesSection)과
 * mutation(db/mutations/domestic-order-issue-dates.ts)이 **둘 다 이것을 부른다.**
 *
 * ── 🔴 줄이 둘 이상이면 막는다 ──────────────────────────────────────────
 * 한 수리 건에 내자 줄이 여럿일 수 있다(분할 발주 — repair_case_id 에 유일
 * 제약이 없다). 칸은 둘뿐이라 어느 줄을 고치라는 뜻인지 말할 수 없고, 그리는
 * 값은 여럿 중 **하나를 골라 접은** 값이다(옆 파일). 그 상태에서 저장을 받으면
 * 다른 줄의 날짜가 이 줄에 복사되어 굳는다 — 그래서 아예 막고 내자 정리로
 * 보낸다.
 *
 * ── 🔴 견적서가 연결된 줄의 견적발행일은 막는다 ─────────────────────────
 * 그 줄의 견적서번호 · 견적발행일 · 금액은 **연결된 견적서를 따르므로** 내자
 * 정리에서도 칸 편집이 막혀 있다(domestic-order-cell-edit.ts 의
 * domesticOrderInlineEditQuoteLock). 여기서 판정을 새로 적지 않고 **그 함수를
 * 그대로 부른다** — 규칙을 베껴 적으면 두 화면이 다르게 동작하고, 여기만 열면
 * 저장은 되는데 목록은 계속 견적서 값을 그려 "저장했는데 안 바뀐다"가 된다.
 * 발주발행일(PO 발행일)에는 그런 잠금이 없다.
 *
 * ── 줄이 없으면 그 자리에서 만든다 (2026-09-29 사용자 결정) ──────────────
 * 이 표에는 사람이 채워야 하는 NOT NULL 칸이 하나도 없어서
 * {repair_case_id, quote_issued_date, order_issued_date} 셋만으로 줄이 선다.
 * 고객사 · 인수번호 · 형식 · L/N · S/N · 고장내역은 **비운다** — 비어 있으면
 * 연결된 수리 건의 값을 따라가는 것이 이 표의 기본이다
 * (schema/domestic-orders.ts 의 '비어 있는 것이 기본'). 값을 옮겨 적으면 그
 * 줄에 박제되어, 나중에 수리 건 쪽을 고쳐도 이 줄만 옛 값으로 남는다.
 *
 * 🔴 **두 날짜가 둘 다 비어 있으면 만들지 않는다.** 그때 만들면 내자 정리에
 * 아무 내용도 없는 줄이 하나 늘 뿐이고, 지우는 일은 MANAGE 권한이 있어야 한다.
 * ============================================================================
 */

/**
 * 고칠 대상을 가리기 위해 필요한 값들. **화면에 보이는 값이 아니다** — 두 날짜와
 * 달리 이 셋은 어느 줄을 고칠지, 낙관적 잠금 토큰은 무엇인지, 견적서가 붙어
 * 있는지를 정하는 데에만 쓴다.
 */
export type DomesticOrderIssueDateEditRow = {
  id: string;
  /**
   * 🔴 **내자 줄의 version 이다. repair_cases.version 이 아니다.** 고치는 대상이
   * 내자 줄이므로 낙관적 잠금도 그 줄의 것이어야 한다 — 수리 건의 version 을
   * 쓰면 내자 정리 화면에서 남이 고친 것을 알아채지 못하고 덮어쓴다.
   */
  version: number;
  /** 연결된 견적서. null 이 아니면 견적발행일이 잠긴다(파일 헤더). */
  quoteId: string | null;
};

/**
 * 조회가 실어 오는 한 줄 — **그릴 두 날짜 + 고칠 대상을 가리키는 셋**.
 * (db/queries/domestic-orders.ts 의 listDomesticOrderIssueDatesForRepairCase)
 *
 * 두 벌을 한 타입으로 합쳐 두는 이유: 그리는 쪽과 고치는 쪽이 **같은 줄 목록**을
 * 봐야 한다. 따로 실어 오면 그 사이에 줄이 생기거나 사라졌을 때 화면이 "한 줄"로
 * 그리면서 "만들기"로 저장하는 어긋남이 생긴다.
 */
export type RepairCaseDomesticOrderIssueDateRow = RepairCaseDomesticOrderRow &
  DomesticOrderIssueDateEditRow;

/**
 * 이 구역의 저장이 무엇을 할 것인가.
 *
 * 화면은 이 값 하나만 보고 수정 단추를 낼지 말지, 견적발행일 칸을 열지 말지를
 * 정한다. 서버도 **트랜잭션 안에서 다시 읽은 줄**로 같은 함수를 불러 같은 값을
 * 얻는다 — 화면이 본 것과 다르면 그때 갈린 대로 거절된다.
 */
export type DomesticOrderIssueDateEditPlan =
  /** 줄이 없다 — 저장하면 그 자리에서 하나 만든다(두 날짜가 둘 다 비면 안 만든다). */
  | { kind: "CREATE" }
  /** 줄이 하나다 — 그 줄의 두 칸만 고친다. */
  | {
      kind: "UPDATE";
      id: string;
      /** 저장할 때 함께 보낼 낙관적 잠금 토큰. **내자 줄의 version** 이다. */
      version: number;
      /** 견적서가 연결돼 있어 견적발행일을 고칠 수 없는가(파일 헤더). */
      quoteIssuedDateLocked: boolean;
    }
  /** 줄이 둘 이상이다 — 여기서는 고칠 수 없다. 내자 정리로 보낸다. */
  | { kind: "BLOCKED_MULTIPLE"; rowCount: number };

/**
 * 그 수리 건의 내자 줄 목록을 보고 **저장이 무엇을 할지**를 정한다.
 *
 * 줄 수를 세는 일 말고는 아무것도 하지 않는다 — 어느 줄의 날짜를 그릴지 고르는
 * 일은 옆 파일이 주간보고와 같은 함수로 하고, 여기서는 "하나뿐이라 고를 것이
 * 없다"일 때만 그 줄을 집는다. 🔴 **여럿 중 하나를 골라 고치는 길은 없다.**
 */
export function resolveDomesticOrderIssueDateEditPlan(
  rows: readonly DomesticOrderIssueDateEditRow[]
): DomesticOrderIssueDateEditPlan {
  if (rows.length === 0) return { kind: "CREATE" };
  if (rows.length > 1) return { kind: "BLOCKED_MULTIPLE", rowCount: rows.length };
  const row = rows[0];
  return {
    kind: "UPDATE",
    id: row.id,
    version: row.version,
    // 🔴 판정을 베껴 적지 않는다 — 내자 정리 표가 쓰는 그 함수를 그대로 부른다.
    quoteIssuedDateLocked: domesticOrderInlineEditQuoteLock(row, "quoteIssuedDate") !== null,
  };
}

/**
 * 줄이 둘 이상이라 막혔을 때 서버가 돌려주는 말. 화면은 애초에 단추를 내지
 * 않으므로 이 문장을 보는 사람은 (1) 저장을 누른 뒤 그 사이에 줄이 늘어난
 * 사람이거나 (2) 액션을 직접 부른 사람이다. 어느 쪽이든 어디서 고치는지를
 * 말해 주어야 한다.
 */
export const DOMESTIC_ORDER_ISSUE_DATE_MULTIPLE_ROWS_MESSAGE =
  "이 수리 건에는 내자 줄이 여럿이라 여기서 고칠 수 없습니다. 내자 정리에서 고쳐 주세요.";

/**
 * 견적서가 연결된 줄에서 견적발행일을 고치려 했을 때의 말.
 *
 * 앞부분은 내자 정리의 안내(DOMESTIC_ORDER_QUOTE_LOCK_NOTE)와 **같은 까닭을 같은
 * 말로** 적는다 — 같은 규칙을 두 화면이 다른 말로 설명하면 사람은 서로 다른
 * 규칙으로 읽는다. 뒷부분만 이 화면에 맞춘다(여기에는 `줄 수정` 폼이 없다).
 */
export const DOMESTIC_ORDER_ISSUE_DATE_QUOTE_LOCK_MESSAGE =
  "견적서 발행일은 연결된 견적서를 따르므로 여기서 고칠 수 없습니다. 바꾸려면 견적서를 고치거나, 내자 정리에서 견적서 연결을 푸세요.";

/**
 * 줄이 없는데 두 날짜를 둘 다 비워 저장했을 때의 말. 거절하는 편이 낫다 —
 * 아무 내용도 없는 줄을 만들어 두면 지우는 데 MANAGE 권한이 필요하다.
 */
export const DOMESTIC_ORDER_ISSUE_DATE_BOTH_EMPTY_MESSAGE =
  "두 날짜가 모두 비어 있습니다. 하나 이상 적어야 내자 정리에 줄이 생깁니다.";

/** 값 자체를 받지 못했을 때. 아래 normalize 의 '둘을 언제나 함께 보낸다' 참조. */
export const DOMESTIC_ORDER_ISSUE_DATE_MISSING_MESSAGE = "날짜 값을 확인할 수 없습니다.";

/**
 * 날짜 형식 오류. **칸 이름을 담지 않는다** — 화면은 이 문장을 그 칸 바로 밑에
 * 붙이고, 칸 이름은 이미 이름표에 있다(EngineerEditCell 이 fieldErrors 를 쓰는
 * 방식과 같다). 이름을 여기 적으면 이 파일이 화면의 이름표와 같은 글자인지를
 * 따로 지켜야 하는데, 그 글자는 주간보고와 맞춰 둔 것이라 여기서 손댈 값이
 * 아니다.
 */
export const DOMESTIC_ORDER_ISSUE_DATE_FORMAT_MESSAGE =
  "YYYY-MM-DD 형식의 실제 날짜여야 합니다.";

export type DomesticOrderIssueDateInputResult =
  | { ok: true; value: string | null }
  | { ok: false; message: string };

/**
 * 받은 날짜 한 칸을 저장할 모양으로 다듬는다.
 *
 * ── 🔴 「안 보냈다」와 「지웠다」를 가른다 ────────────────────────────────
 * 이 경로는 **두 칸을 언제나 함께** 보낸다. 그래서:
 *
 *   - `null` 또는 빈 문자열 = **지웠다.** null 로 저장한다. 잘못 적은 날짜를
 *     여기서 지울 수 없으면 사람은 내자 정리까지 가야 한다.
 *   - 키가 없다(`undefined`) · 문자열이 아니다 = **받지 못했다.** 거절한다.
 *
 * 내자 정리의 전체 저장(validation/domestic-order-input.ts 의 normalizeDate)은
 * 키 없음도 null 로 접는데, 그쪽은 폼이 스물넉 칸을 통째로 보내는 전제라서
 * 그렇다. 이 경로는 칸이 둘뿐이라 **하나가 빠진 요청은 사고**이고, 조용히 null
 * 로 접으면 그 사고가 날짜를 지우는 저장이 된다.
 *
 * ── 있는 날짜인지까지 본다 ──────────────────────────────────────────────
 * 형식만 보면 2026-02-31 이 통과해 Postgres 가 22008 로 거절하고, 사용자에게는
 * 까닭 없는 실패만 남는다. 판정은 내자 정리 · 접수 검증과 **같은 함수**
 * (domain/local/validation.ts 의 isValidDateString)로 한다 — 규칙을 베껴 적으면
 * 한쪽만 고쳐지는 날 두 길이 서로 다른 날짜를 받아 준다.
 */
export function normalizeDomesticOrderIssueDateInput(
  value: unknown
): DomesticOrderIssueDateInputResult {
  if (value === null) return { ok: true, value: null };
  if (typeof value !== "string") {
    return { ok: false, message: DOMESTIC_ORDER_ISSUE_DATE_MISSING_MESSAGE };
  }
  const trimmed = value.trim();
  if (trimmed === "") return { ok: true, value: null };
  if (!isValidDateString(trimmed)) {
    return { ok: false, message: DOMESTIC_ORDER_ISSUE_DATE_FORMAT_MESSAGE };
  }
  return { ok: true, value: trimmed };
}
