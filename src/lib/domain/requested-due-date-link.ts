import { foldBlankToNull, formatDomesticOrderDueDateLines } from "./domestic-order-list";
import { isNotEarlierThan } from "./local/validation";
import { pickEarliestDueDate } from "./weekly-report-delivery";

/**
 * ============================================================================
 * `납기요청일` ↔ `고객 요청 납기일` — **빌려 그리기**와 **묶기**
 * ============================================================================
 * DB 도 React 도 여기 들어오지 않는다. domestic-order-list.ts ·
 * weekly-report-delivery.ts 와 같은 자리의 파일이고, 같은 이유로 순수 함수만
 * 둔다 — 아래 규칙들은 **화면 둘과 저장 통로 둘이 같은 답을 내야** 하는 종류라,
 * 각자 안에 두면 한쪽만 고쳐지는 날이 오고 그날 같은 자료가 두 날짜로 보인다.
 *
 * 저장 구조는 예나 지금이나 **각자 자기 자리**다:
 *
 *   내자 정리 `납기요청일`   ← domestic_order_due_dates (날짜 + 비고, **여럿**)
 *   수리 건  `고객 요청 납기일` ← repair_cases.customer_requested_due_date (**하나**)
 *
 * ── 🔴 2026-10-30 **바뀐 것**: 저장할 때 서로 따라간다 ───────────────────
 * 사용자 요구 원문: 「내자정리에서 납기 요청일을 적은 상태에서 수리건 상세에서
 * 고객 요청 납기일을 수정하면 내자정리의 납기요청일도 따라서 바뀔 수 있도록 —
 * **어느 쪽에서 수정하든 같은 날짜를 보고 있을 수 있도록**」. 그래서 이제
 * **사람이 손으로 고쳐 저장한 날짜는 상대 칸에도 같이 적힌다**(이 파일 맨 아래
 * '묶기' 묶음이 그 판정을 혼자 가진다 — 고치는 일은 mutation 둘이 한다).
 *
 * 🔴 **그 전까지 이 머리말은 정반대를 적고 있었다.** 「한쪽에서 고친 값이 다른 쪽
 * 칼럼에 써지는 일은 없다 … 계산된 값을 원본 칸에 옮겨 담으면 자동으로 따라오던
 * 날짜가 그 줄에 **박제**되고, 그때부터 "일부러 다르게 적었다"와 "그냥 안
 * 건드렸다"를 구분할 수 없다」. 그 경고는 **틀린 말이 아니었고 지금도 살아 있다** —
 * 다만 가리키는 것이 달라졌다. 박제가 되는 것은 **아무도 적지 않은 값**(화면이
 * 빌려 그린 날짜)이 저장에 섞여 나갈 때이고, 사람이 그 칸을 열어 고쳐 적은 날짜는
 * 그것이 아니다. 그래서 묶기는 **네 자리에서 여전히 멈춘다**:
 *
 *   ① **빌려 온 날짜는 상대로 보내지 않는다.** 이 파일의 함수가 내놓는 `borrowed`
 *      값은 **그릴 값**이지 저장할 값이 아니다 — 어느 저장 payload 타입에도 들어가지
 *      않는다(domestic-order-cell-edit.ts 헤더의 함정 ②, 그리고 그 파일의
 *      domesticOrderDueDateEditDraft 가 받는 타입에 수리 건의 날짜가 아예 없다).
 *   ② **안 바뀐 저장은 아무 일도 하지 않는다.** 내자 정리의 칸 편집은 어느 칸을
 *      고쳐도 줄 전체를 다시 보내므로(그 파일 헤더), 날짜가 그대로인 저장까지 묶으면
 *      발주서번호 하나 고친 저장이 수리 건의 날짜를 덮는다. 그래서 아래 두 함수는
 *      **고치기 전 값과 뒤 값을 함께 받아** 같으면 멈춘다.
 *   ③ **행을 만들지도 지우지도 않는다.** 내자 쪽은 날짜가 **행**이라 비고가 딸려
 *      있다(운영 실측 2026-10-30: 비고가 적힌 행 5행). 행을 지우고 새로 만드는 방식은
 *      그 비고를 말없이 지운다. 날짜 행이 **없는** 줄에 행을 만들지도 않는다 — 그 줄은
 *      이미 수리 건의 날짜를 빌려 그리고 있어서 **화면에 보이는 날짜가 어차피 같고**,
 *      거기에 행을 만들면 「발주서에 적힌 날짜」가 아닌 것이 그 줄에 박제된다.
 *      같은 까닭으로 수리 건 쪽이 비어 있으면(빌려 그리는 중) 내자에서 고쳐도
 *      그 칸을 채우지 않는다.
 *   ④ **어느 날짜인지 말할 수 없으면 멈추고 사람에게 알린다.** 한 수리 건에 내자
 *      줄이 여럿이거나(분할 발주) 한 줄에 날짜가 여럿이면(분할 납품) 어느 날짜를
 *      맞춰야 하는지는 사람만 안다. 조용히 건너뛰지 않는다 — 저장 결과에 **왜 안
 *      묶였는지**를 실어 보내고 화면이 읽어야 닫히는 알림으로 띄운다.
 *
 * 🔵 ③ 때문에 **「양쪽이 다른 날짜로 남는 경우」가 여전히 있다.** 그것은 고장이
 * 아니라 위 넷의 결과다. 운영 실측(2026-10-30 `npm run check:requested-due-date-sync`)
 * 에서 ③ 「양쪽 다 적혔는데 다름」은 0건, ④ 「내자에만 적힘」이 8건이었고 — 그 8건은
 * 지금도 빌려 그리는 중이라 **화면에 보이는 날짜가 이미 같다.** 과거 건을 일괄로
 * 묶는 일은 하지 않았다(운영 대량 변경이라 별도 승인이 필요하다).
 *
 * ── 자기 자리에 적힌 것이 먼저다 ────────────────────────────────────────
 * 승인된 결정이다. 내자에 날짜가 있으면 그것을 보여 주고, 없을 때만 수리 건의
 * 값을 빌린다. 반대쪽도 같다 — 고객사·형식·L/N·S/N·고장내역 다섯 칸이 이미 쓰는
 * 방향과 같다(domestic-order-list.ts 의 resolveDomesticOrderValue).
 *
 * ── ⚠️ 빌려 온 값에는 표시가 붙는다. 그 다섯 칸과 다른 점이다 ────────────
 * 다섯 칸은 목록에 아무 표시 없이 그려진다. 그래도 되는 이유는 **그 다섯이 같은
 * 사실을 두 곳에서 부르는 이름**이기 때문이다 — 그 발주의 고객사는 곧 그 수리
 * 건의 고객사이고, 형식도 L/N 도 S/N 도 같은 물건의 같은 값이다. 어느 쪽에서
 * 왔든 문장의 뜻이 달라지지 않는다.
 *
 * 납기일은 그렇지 않다. 내자의 납기요청일은 **발주서에 적힌 날짜**이고, 수리
 * 건의 고객 요청 납기일은 **고객이 접수 때 말한 날짜**다 — 뜻이 다른 두 값이라
 * 「같아야 할 이유가 없다」고 이 저장소가 못 박아 두었다(due-date-inversion.ts 가
 * 아직 같은 말을 적고 있다). 🔵 **2026-10-30 묶기는 그 사실을 뒤집지 않는다** —
 * 사람이 한쪽을 고치면 다른 쪽도 그 뜻으로 고쳐 두겠다는 것이지, 두 칸이 같은
 * 사실의 두 이름이 되었다는 말이 아니다. 묶이지 않는 자리(머리말의 ①~④)가
 * 그대로 있는 까닭이고, 빌려 온 값에 표시가 붙는 까닭도 그대로다: 표시 없이 그냥
 * 날짜만 그리면 "이 줄에 내가 적어 둔 값"으로 읽히고, 나중에 상대 쪽이 바뀌면
 * 아무도 안 건드렸는데 값이 달라진 것으로 보인다. 그래서 아래 두 함수는 날짜만
 * 내놓지 않고 **어디서 온 값인지**를 함께 내놓는다(borrowed).
 *
 * 다섯 칸과 어긋나는 것도 아니다 — 납기요청일은 `줄 수정` 폼에서도 이미 다섯
 * 칸과 다르게 다뤄진다. 다섯은 흐린 글씨(placeholder)로 힌트를 주지만 납기일
 * 묶음에는 그럴 자리가 없어 **안내 한 줄**로 적고 있고(DomesticOrderEditForm 의
 * '흐린 글씨로는 안 된다'), 여기 붙는 표시는 그 결정의 목록 쪽 짝이다.
 *
 * ── ⚠️ 여럿 중 하나를 골라야 하는 쪽은 주간보고와 같은 함수를 쓴다 ───────
 * 내자 쪽은 날짜가 여럿일 수 있고(분할 납품), 한 수리 건에 내자 줄이 여럿일
 * 수도 있다(분할 발주 — repair_case_id 에 유일 제약이 없다). 그래서 수리 건
 * 화면이 빌려 올 때는 **하나로 접어야** 한다.
 *
 * 그 규칙은 여기서 새로 정하지 않는다 — 주간보고 `납입 예정 건` 표의
 * `입고 요청일` 이 같은 물음에 이미 답해 두었다: **그 건에 붙은 납기요청일 중
 * 가장 이른 하루**(weekly-report-delivery.ts 의 pickEarliestDueDate). 같은 자료를
 * 두 화면이 다른 날짜로 보여 주면 어느 쪽도 믿을 수 없게 되므로, 규칙을 베껴
 * 적지 않고 **그 함수를 그대로 부른다.**
 * ============================================================================
 */

/**
 * 내자 정리의 `납기요청일` 칸에 붙는 표시. 빌려 온 날짜 옆에만 붙는다.
 *
 * 짧아야 하는 자리다 — 22칼럼짜리 표의 한 칸이라, 설명을 통째로 적으면 그
 * 칼럼만 넓어져 표가 옆으로 길어진다. 긴 설명은 아래 …_NOTE 가 맡는다.
 */
export const DUE_DATE_FROM_REPAIR_CASE_LABEL = "수리 건 요청일";

/**
 * 수리 건 상세정보의 `고객 요청 납기일` 아래에 붙는 표시. 위와 짝이다.
 *
 * 🔵 **「어디서 왔는가」를 적는다**(2026-10-30 사용자 요청으로 「내자 납기요청일」에서
 * 바꿨다). 칸 이름을 그대로 적으면 그 자체가 **또 하나의 값**처럼 읽힌다 — 바로 위에
 * 날짜가 있어서 더 그렇다. 위 짝(`…FROM_REPAIR_CASE_LABEL`)은 표 안이라 짧아야 해서
 * 칸 이름 그대로지만, 이쪽은 상세 화면이라 한 마디 더 들어갈 자리가 있다.
 */
export const DUE_DATE_FROM_DOMESTIC_ORDER_LABEL = "내자 정리에서 작성됨";

/**
 * 내자 정리 쪽 설명. 표 머리말과 카드 이름표가 **같은 글자**를 title 로 나눠
 * 쓴다 — 따로 적으면 언젠가 한쪽만 고쳐져 같은 칸이 화면마다 다른 규칙으로
 * 설명된다(DomesticOrderListScreen 의 DELIVERED_DATE_NOTE 와 같은 이유).
 *
 * 표시 글자를 문장에 **박아 넣지 않고 위 상수를 끼워 넣는다.** 배지에 적히는
 * 말과 설명에 적히는 말이 어긋나면, 설명이 화면에 없는 표시를 가리키게 된다.
 */
export const DOMESTIC_ORDER_DUE_DATE_LINK_NOTE =
  `납기요청일이 비어 있는 줄은 연결된 수리 건의 고객 요청 납기일을 대신 보여 줍니다. ` +
  `그 값에는 '${DUE_DATE_FROM_REPAIR_CASE_LABEL}' 표시가 붙습니다. ` +
  // 🔴 2026-10-30 묶기 — 사람이 **여기서 처음 알게 되는** 사실이라 함께 적는다.
  `납기요청일을 고쳐 저장하면 연결된 수리 건의 고객 요청 납기일도 같은 날짜로 맞춰집니다` +
  `(그 건에 내자 줄이나 날짜가 여럿이면 맞추지 않고 알려 드립니다).`;

/** 수리 건 상세정보 쪽 설명. 위와 같은 자리에 같은 이유로 있다. */
export const REPAIR_CASE_DUE_DATE_LINK_NOTE =
  `고객 요청 납기일이 비어 있으면 연결된 내자 정리의 납기요청일 중 가장 이른 하루를 ` +
  `대신 보여 줍니다. 그 값에는 '${DUE_DATE_FROM_DOMESTIC_ORDER_LABEL}' 표시가 붙습니다. ` +
  // 🔴 위와 **거울이면서 같은 사실**이다. 한쪽만 적으면 그 화면만 보는 사람은 자기가
  // 고친 날짜가 다른 화면도 바꾼다는 것을 끝내 모른다.
  `고객 요청 납기일을 고쳐 저장하면 연결된 내자 정리의 납기요청일도 같은 날짜로 맞춰집니다` +
  `(내자 줄이나 날짜가 여럿이면 맞추지 않고 알려 드립니다).`;

/**
 * **목록**에서 빌려 온 날짜 옆에 붙는 표시 — 전체 A/S 현황 표·카드와 내 작업
 * 화면이 쓴다(2026-10-19).
 *
 * 🔴 위 DUE_DATE_FROM_DOMESTIC_ORDER_LABEL("내자 납기요청일")을 그대로 쓰지
 * 않는 이유는 **자리가 다르기** 때문이다. 상세정보는 칸 아래에 한 줄을 통째로
 * 내줄 수 있지만, 목록에서 이 값이 사는 곳은 출하일 칸 안의 `text-xs` 보조 줄
 * 하나이고 그 줄은 줄바꿈을 하지 않는다(whitespace-nowrap). 거기에 긴 이름표를
 * 붙이면 그 열만 넓어져 표가 옆으로 길어진다 — 내자 정리 쪽이 목록용으로
 * 짧은 DUE_DATE_FROM_REPAIR_CASE_LABEL 을 따로 둔 것과 같은 판단이다.
 *
 * 🔴 **그래도 한 파일에 둔다.** 긴 것과 짧은 것이 서로 다른 파일에 흩어지면
 * 언젠가 한쪽만 고쳐져, 같은 사실이 화면마다 다른 말로 설명된다. 둘은 같은
 * 규칙의 두 자리일 뿐이다.
 */
export const DUE_DATE_FROM_DOMESTIC_ORDER_SHORT_LABEL = "(내자)";

/**
 * 위 짧은 표시에 마우스를 올렸을 때 나오는 설명(title).
 *
 * 짧은 표시만으로는 "내자"가 무엇을 뜻하는지 알 수 없다 — 표시는 **다른 데서
 * 온 값임을 알리는 신호**이고, 어디서 왔는지는 이 문장이 말한다. 표시 글자를
 * 문장에 박아 넣지 않고 위 상수를 끼워 넣는 것은 REPAIR_CASE_DUE_DATE_LINK_NOTE
 * 와 같은 이유다(설명이 화면에 없는 표시를 가리키면 안 된다).
 */
export const DUE_DATE_FROM_DOMESTIC_ORDER_SHORT_NOTE =
  `이 건에는 고객 요청 납기일이 적혀 있지 않습니다. ` +
  `'${DUE_DATE_FROM_DOMESTIC_ORDER_SHORT_LABEL}' 가 붙은 날짜는 연결된 내자 정리의 ` +
  `납기요청일 중 가장 이른 하루입니다.`;

/**
 * 내자 정리 목록의 `납기요청일` 칸에 그릴 것.
 *
 * `lines` 는 **한 줄에 날짜 하나**다(formatDomesticOrderDueDateLines 와 같은
 * 모양). 비어 있으면 그릴 것이 없다는 뜻이고, "-"로 바꾸는 일은 화면이 한다 —
 * 자료를 "-"로 바꾸는 일은 화면에서만 한다는 이 저장소의 규칙 그대로다.
 *
 * `borrowed` 가 참이면 그 줄들은 **이 줄에 적힌 값이 아니다.** 화면은 이때만
 * 표시를 붙인다(위 DUE_DATE_FROM_REPAIR_CASE_LABEL).
 */
export type DomesticOrderDueDateDisplay = {
  lines: string[];
  borrowed: boolean;
};

/**
 * 그 줄의 `납기요청일` 칸에 무엇을 그릴 것인가 — **이 줄에 적힌 날짜가 먼저,
 * 하나도 없으면 연결된 수리 건의 고객 요청 납기일**(파일 헤더).
 *
 * 딸린 표에 줄이 하나라도 있으면 그것이 전부다. 거기에 수리 건의 날짜를 섞어
 * 붙이지 않는다 — 섞으면 사람이 적어 넣은 1차분·2차분 사이에 아무도 적지 않은
 * 날짜가 끼어들고, 그 순간 이 칸은 "발주서에 이렇게 적혀 있다"는 기록이기를
 * 그만둔다.
 *
 * 빌려 오는 쪽은 **한 줄뿐**이다. 수리 건의 그 칸은 원래 날짜 하나이고
 * (repair_cases.customer_requested_due_date), 메모도 없어 괄호가 붙지 않는다.
 * 공백만 적힌 값은 없는 것으로 접는다 — 화면에는 빈칸으로 보이는데 표시만
 * 붙는 줄이 생기지 않게 한다(domestic-order-list.ts 의 foldBlankToNull).
 *
 * ⚠️ **행 전체가 아니라 이 함수가 보는 두 칸만 받는다.** 목록 한 줄을 통째로
 * 받게 해 두면 언젠가 `deliveredDate` 나 원본 칸이 여기 섞여 들어오고, 그때
 * 이 규칙은 조용히 달라진다(resolveDomesticOrderDeliveredDate 가 행 전체가
 * 아니라 필요한 칸 셋만 이름 붙여 받는 것과 같은 이유).
 */
export function resolveDomesticOrderDueDateDisplay(row: {
  dueDates: readonly { dueDate: string; note: string | null }[];
  repairCaseCustomerRequestedDueDate: string | null;
}): DomesticOrderDueDateDisplay {
  if (row.dueDates.length > 0) {
    return { lines: formatDomesticOrderDueDateLines(row.dueDates), borrowed: false };
  }

  const borrowed = foldBlankToNull(row.repairCaseCustomerRequestedDueDate);
  if (borrowed === null) return { lines: [], borrowed: false };
  return { lines: [borrowed], borrowed: true };
}

/**
 * 내자 정리 한 줄의 `납기요청일` 을 **견줄 수 있는 하루**로 접은 것 — 납기 역전
 * 판정이 쓴다(due-date-inversion.ts 의 isDomesticOrderDueDateInverted, 2026-10-30).
 *
 * ── 🔴 바로 위 함수와 **같은 갈림**이어야 한다 ──────────────────────────────
 * 이 줄에 날짜가 하나라도 있으면 그 날짜들, 하나도 없을 때만 수리 건에서 빌린다.
 * 갈림을 다르게 적으면 **보이는 날짜와 판정이 본 날짜가 달라진다** — 그때 이 화면은
 * 이 줄에 적힌 날짜를 그려 놓고 수리 건의 날짜로 재게 되고, 사람은 빨간 날짜를 보며
 * 왜 빨간지 끝내 알 수 없다.
 *
 * 🔴 **위 함수를 불러서 쓸 수가 없다.** 그쪽이 내놓는 `lines` 는 이미 메모가 붙은
 * 글자(`"2026-01-05 (1차분)"`)라 날짜로 견줄 수 없다. 그래서 갈림만 같은 모양으로
 * 적고, **둘이 어긋나지 않는다는 사실 자체를 시험이 맞대어 본다**
 * (requested-due-date-link.test.ts — 고른 하루가 언제나 그 칸에 보이는 줄 중 하나다).
 *
 * ── 여럿이면 **가장 이른 하루** ─────────────────────────────────────────────
 * 분할 납품이라 한 줄에 날짜가 여럿일 수 있다. 고르는 규칙은 여기서 새로 정하지
 * 않고 주간보고·수리 건 상세와 같은 함수를 그대로 부른다(pickEarliestDueDate) —
 * 같은 자료를 세 화면이 다른 날짜로 재면 어느 쪽도 믿을 수 없게 된다.
 *
 * 🔵 가장 이른 날을 고르는 것은 경보 쪽에서도 **안전한 방향**이다: 우리가 잡아 둔
 * 출하일이 그 줄의 **첫 약속**보다 늦으면 이미 어긋난 것이고, 뒤 회차가 아직
 * 여유롭다는 사실이 그 어긋남을 지우지 못한다.
 *
 * 날짜가 양쪽 어디에도 없으면 null 이다 — 「아직 정해지지 않았다」이고, 그것으로
 * 무엇을 재지는 않는다(부르는 쪽이 거짓으로 접는다).
 */
export function resolveDomesticOrderDueDateForComparison(row: {
  dueDates: readonly { dueDate: string }[];
  repairCaseCustomerRequestedDueDate: string | null;
}): string | null {
  if (row.dueDates.length > 0) {
    return pickEarliestDueDate(row.dueDates.map((entry) => entry.dueDate));
  }
  return foldBlankToNull(row.repairCaseCustomerRequestedDueDate);
}

/**
 * 수리 건 상세정보의 `고객 요청 납기일` 칸에 그릴 것.
 *
 * `dueDate` 가 null 이면 양쪽 어디에도 날짜가 없다는 뜻이고, 화면이 "-"로
 * 그린다. `borrowed` 가 참이면 그 날짜는 **이 건에 적힌 값이 아니다.**
 */
export type RepairCaseRequestedDueDateDisplay = {
  dueDate: string | null;
  borrowed: boolean;
};

/**
 * 그 수리 건의 `고객 요청 납기일` 에 무엇을 그릴 것인가 — **이 건에 적힌 날짜가
 * 먼저, 없으면 연결된 내자 줄들의 납기요청일 중 가장 이른 하루**(파일 헤더).
 *
 * `domesticOrderDueDates` 는 **여러 내자 줄에 걸친 날짜를 통틀어 모은 한
 * 묶음**이다. 줄마다 먼저 접은 뒤 다시 고르지 않는다 — 그렇게 하면 "어느 줄의
 * 날짜인가"라는 뜻이 슬쩍 끼어들지만, 여기서 답하려는 물음은 "이 건에서 가장
 * 이른 날이 언제인가"다(pickEarliestDueDate 의 주석).
 *
 * 고르는 일을 그 함수에 그대로 맡기므로 **주간보고 `입고 요청일` 과 언제나 같은
 * 날짜**다. 이미 지난 날짜라도 그것이 가장 이르면 그것이고, 그 판단은 여기서
 * 다시 하지 않는다.
 */
export function resolveRepairCaseRequestedDueDate(row: {
  customerRequestedDueDate: string | null;
  domesticOrderDueDates: readonly string[];
}): RepairCaseRequestedDueDateDisplay {
  const own = foldBlankToNull(row.customerRequestedDueDate);
  if (own !== null) return { dueDate: own, borrowed: false };

  const borrowed = pickEarliestDueDate(row.domesticOrderDueDates);
  if (borrowed === null) return { dueDate: null, borrowed: false };
  return { dueDate: borrowed, borrowed: true };
}

/**
 * ============================================================================
 * 🔴 묶기 — 한쪽을 고쳐 저장하면 상대 칸도 같은 날짜가 된다 (2026-10-30)
 * ============================================================================
 * 여기부터는 **그릴 값이 아니라 저장할 값**을 정한다. 묶는 일을 실제로 하는 곳은
 * mutation 둘이고(db/mutations/repair-cases.ts · db/mutations/domestic-orders.ts),
 * **무엇을 할지 정하는 규칙은 이 묶음 하나뿐**이다 — 두 통로가 규칙을 베껴 적으면
 * 언젠가 한쪽만 고쳐지고, 그날 「어느 쪽에서 고쳤느냐」에 따라 묶이기도 안 묶이기도
 * 한다. 사용자가 고친 것은 정확히 그 어긋남이다.
 *
 * 두 방향의 모양은 같다. 받는 것은 **고치기 전 값 · 고친 뒤 값 · 그 수리 건에 붙은
 * 살아 있는 내자 줄들의 모양** 셋이고, 내놓는 것은 셋 중 하나다:
 *
 *   NONE       — 할 일이 없다(안 바뀌었거나, 빌려 그리는 중이라 이미 같은 날짜다)
 *   WRITE      — 상대 칸을 이 날짜로 고친다
 *   NOT_LINKED — 묶을 수 없다. **까닭을 사람에게 말한다**(머리말 ④)
 *
 * ── 🔴 방향 하나에만 있는 잣대 ──────────────────────────────────────────
 * 수리 건의 고객 요청 납기일에는 **인수일보다 이를 수 없다**는 잣대가 걸려 있고
 * (mutations/repair-cases.ts 의 그 검증 — 날짜 넷이 같이 쓴다), 내자 납기요청일에는
 * 그런 잣대가 없다(validation/domestic-order-input.ts 에 인수일이라는 말이 없다).
 * 그래서 **내자 → 수리 건** 방향만 그 잣대에 걸릴 수 있다. 🔴 우회하지 않는다 —
 * 그 건은 수리 건 쪽만 그대로 두고 사람에게 말한다. 잣대 자체는 베껴 적지 않고
 * 저쪽이 부르는 함수를 그대로 부른다(isNotEarlierThan).
 * ============================================================================
 */

/**
 * 묶음이 **어느 날짜를 가리키는지 말할 수 있는 모양인가.** 두 방향이 이 하나로
 * 판정한다.
 *
 * 보는 것은 **날짜 행의 수**뿐이다 — 날짜 값도, 비고도, 어느 줄의 것인지도 보지
 * 않는다. 「고칠 날짜가 꼭 하나인가」만이 물음이기 때문이다.
 *
 * 🔴 **줄이 하나뿐이어도 그 줄의 날짜가 여럿이면 안 묶는다**(분할 납품). 반대로
 * 줄이 여럿이면 날짜가 통틀어 하나뿐이어도 안 묶는다 — 수리 건 상세의 「내자 정리
 * 발행일」이 줄이 여럿일 때 아예 막는 것과 **같은 자리에 같은 까닭으로** 선다
 * (domestic-order-issue-date-edit.ts 의 resolveDomesticOrderIssueDateEditPlan).
 * 어느 줄의 날짜를 고르는 규칙을 여기서 새로 만들면, 그 선택이 어느 화면에도 안
 * 적힌 채 자료만 바뀐다.
 */
export type RequestedDueDateLinkLine = { dueDateCount: number };

export type RequestedDueDateLinkShape =
  /** 고칠 날짜 행이 없다 — 줄이 없거나, 줄은 있는데 날짜 행이 없다. */
  | { kind: "NO_ROW" }
  /** 줄 하나 · 날짜 하나. 가리킬 것이 분명하다. */
  | { kind: "SINGLE" }
  /** 줄이 여럿이거나 날짜가 여럿이다. 사람만 안다. */
  | { kind: "AMBIGUOUS"; lineCount: number; dueDateCount: number };

export function resolveRequestedDueDateLinkShape(
  lines: readonly RequestedDueDateLinkLine[]
): RequestedDueDateLinkShape {
  const dueDateCount = lines.reduce((sum, line) => sum + line.dueDateCount, 0);
  // 🔴 **날짜 행 수를 줄 수보다 먼저 본다.** 줄이 여럿이어도 날짜 행이 하나도 없으면
  // 고를 것이 없으니 「여럿이라 못 맞췄다」가 아니다 — 그 줄들은 전부 수리 건의
  // 날짜를 빌려 그리고 있어 **보이는 날짜가 이미 같다.** 차례를 뒤집으면 아무 일도
  // 없었던 저장마다 알림이 떠, 진짜 경고가 그 소음에 묻힌다.
  if (dueDateCount === 0) return { kind: "NO_ROW" };
  if (lines.length > 1 || dueDateCount > 1) {
    return { kind: "AMBIGUOUS", lineCount: lines.length, dueDateCount };
  }
  return { kind: "SINGLE" };
}

/**
 * 묶지 못한 까닭 — **화면에 그대로 뜨는 글이다.**
 *
 * 두 문장이 같은 까닭을 말하면서 끝만 다른 것은 **무엇이 그대로인지**가 방향마다
 * 다르기 때문이다. 「안 됐다」만 말하고 무엇이 안 됐는지 안 말하면, 사람은 저장
 * 자체가 실패한 줄 안다(실제로는 지금 보고 있는 쪽은 저장됐다).
 */
const AMBIGUOUS_REASON =
  "이 수리 건에는 내자 줄이 여럿이거나 한 줄에 납기요청일이 여럿입니다. 어느 날짜를 맞춰야 하는지는 사람만 알 수 있습니다.";

/** 수리 건에서 고쳤는데 **내자 쪽이 못 따라갔다.** */
export const DOMESTIC_ORDER_DUE_DATE_NOT_LINKED_MESSAGE =
  `고객 요청 납기일은 저장했습니다. 다만 ${AMBIGUOUS_REASON} ` +
  `내자 정리의 납기요청일은 그대로 두었으니, 내자 정리에서 직접 맞춰 주세요.`;

/** 내자에서 고쳤는데 **수리 건 쪽이 못 따라갔다.** */
export const REPAIR_CASE_DUE_DATE_NOT_LINKED_MESSAGE =
  `납기요청일은 저장했습니다. 다만 ${AMBIGUOUS_REASON} ` +
  `수리 건의 고객 요청 납기일은 그대로 두었으니, 수리 건 상세에서 직접 맞춰 주세요.`;

/**
 * 내자에서 고친 날짜가 **인수일보다 일러** 수리 건에 넣지 못했다.
 *
 * 🔴 여기서만 쓰는 잣대가 아니라 수리 건 저장이 날짜 넷에 똑같이 거는 잣대다.
 * 우회하면 사람이 수리 건 상세에서는 적을 수 없는 날짜가 내자를 거쳐 들어간다.
 */
export const REPAIR_CASE_DUE_DATE_BLOCKED_BY_RECEIVED_AT_MESSAGE =
  "납기요청일은 저장했습니다. 다만 그 날짜가 수리 건의 인수일보다 일러 " +
  "수리 건의 고객 요청 납기일에는 반영하지 못했습니다(인수일보다 이른 날짜는 적을 수 없습니다).";

/**
 * 이번 저장이 **상대 쪽 날짜까지 맞췄는가.** 두 mutation 의 성공 결과에 실려
 * 서버 액션을 그대로 지나 화면까지 간다.
 *
 * 🔴 `linked: false` 를 **조용히 버리지 마라.** 그때 사람이 보고 있는 화면은
 * 「저장했습니다」만 떠 있고, 반대쪽은 옛 날짜 그대로다 — 다음에 그 화면을 열면
 * 자기가 고친 적 없는 날짜가 거기 있다.
 */
export type RequestedDueDateLinkOutcome =
  | { linked: true }
  | { linked: false; reason: "AMBIGUOUS" | "BLOCKED_BY_RECEIVED_AT"; message: string };

/** 무엇을 할 것인가 — 부르는 쪽(mutation)이 이 값만 보고 움직인다. */
export type RequestedDueDateLinkPlan =
  | { kind: "NONE" }
  | { kind: "WRITE"; dueDate: string }
  | { kind: "NOT_LINKED"; outcome: Extract<RequestedDueDateLinkOutcome, { linked: false }> };

function notLinked(
  reason: "AMBIGUOUS" | "BLOCKED_BY_RECEIVED_AT",
  message: string
): RequestedDueDateLinkPlan {
  return { kind: "NOT_LINKED", outcome: { linked: false, reason, message } };
}

/**
 * **수리 건 → 내자** — 고객 요청 납기일을 고쳐 저장할 때 내자의 납기요청일 행을
 * 어떻게 할 것인가.
 *
 * 멈추는 자리가 셋이다(머리말 ②③④ 그대로):
 *
 *  · **안 바뀌었다** — 인수정보 폼은 고칠 수 있는 칸을 늘 함께 보내므로, 날짜를
 *    건드리지 않은 저장도 이 함수까지 온다. 그때 묶으면 다른 칸 하나 고친 저장이
 *    내자의 날짜를 덮는다. 공백만 적힌 값은 양쪽 다 「없음」으로 접는다 — 화면이
 *    그렇게 읽기 때문이다(foldBlankToNull).
 *  · **지웠다**(next 가 없음) — 🔴 **행을 지우지 않는다.** 비고가 함께 사라진다.
 *    지운 뒤의 수리 건은 내자 날짜를 빌려 그리므로 두 화면에 보이는 날짜는 같다.
 *  · **고칠 행이 없다**(NO_ROW) — 🔴 **행을 만들지 않는다.** 그 줄은 이미 수리 건의
 *    날짜를 빌려 그리는 중이라 보이는 날짜가 같고, 행을 만들면 「발주서에 적힌
 *    날짜」가 아닌 것이 박제된다.
 */
export function resolveDomesticOrderDueDateWriteThrough(input: {
  /** 이 저장 **전에** 수리 건에 적혀 있던 값. */
  previousCustomerRequestedDueDate: string | null;
  /** 이 저장으로 수리 건에 적히는 값. null 이면 지웠다는 뜻이다. */
  nextCustomerRequestedDueDate: string | null;
  /** 그 수리 건에 붙은 **살아 있는** 내자 줄 전부(휴지통은 빠져 있다). */
  lines: readonly RequestedDueDateLinkLine[];
}): RequestedDueDateLinkPlan {
  const previous = foldBlankToNull(input.previousCustomerRequestedDueDate);
  const next = foldBlankToNull(input.nextCustomerRequestedDueDate);
  if (previous === next) return { kind: "NONE" };
  if (next === null) return { kind: "NONE" };

  const shape = resolveRequestedDueDateLinkShape(input.lines);
  if (shape.kind === "NO_ROW") return { kind: "NONE" };
  if (shape.kind === "AMBIGUOUS") {
    return notLinked("AMBIGUOUS", DOMESTIC_ORDER_DUE_DATE_NOT_LINKED_MESSAGE);
  }
  return { kind: "WRITE", dueDate: next };
}

/**
 * **내자 → 수리 건** — 납기요청일 목록을 고쳐 저장할 때 수리 건의 고객 요청
 * 납기일을 어떻게 할 것인가.
 *
 * 위 짝과 **거울**이고, 멈추는 자리도 같은 까닭으로 선다. 다른 점은 둘이다:
 *
 *  · **수리 건 쪽이 비어 있으면 채우지 않는다**(머리말 ③). 그 건은 지금 내자 날짜를
 *    빌려 그리는 중이라 **화면에 보이는 날짜가 이미 같고**, 채워 넣으면 「고객이 말한
 *    날짜」가 아닌 것이 그 건에 박제된다. 운영 실측에서 ④ 8건이 이 모양이었다.
 *  · **인수일 잣대**(머리말). 같은 날은 통과한다.
 *
 * 🔴 **날짜가 바뀌었는지를 이 줄의 전·후로 본다.** 내자 정리의 칸 편집은 어느 칸을
 * 고쳐도 줄 전체를 다시 보내므로, 「보낸 목록이 있다」만으로 묶으면 발주서번호 하나
 * 고친 저장이 수리 건의 날짜를 덮는다(머리말 ②). 차례와 비고는 보지 않는다 — 1차분과
 * 2차분의 순서를 바꾸거나 메모만 고친 저장은 **날짜가 안 바뀐 저장**이다.
 */
export function resolveRepairCaseDueDateWriteThrough(input: {
  /** 이 저장이 고친 내자 줄의 날짜 — 고치기 전과 뒤. 새로 만든 줄이면 앞은 빈 목록이다. */
  editedLine: { previousDueDates: readonly string[]; nextDueDates: readonly string[] };
  /** 같은 수리 건에 붙은 **다른** 살아 있는 줄들. 없으면 빈 목록이다. */
  otherLines: readonly RequestedDueDateLinkLine[];
  /** 그 수리 건에 지금 적혀 있는 고객 요청 납기일. */
  customerRequestedDueDate: string | null;
  /** 그 수리 건의 인수일. 잣대는 저쪽 저장과 같은 함수로 잰다. */
  receivedAt: string;
}): RequestedDueDateLinkPlan {
  if (sameDueDateSet(input.editedLine.previousDueDates, input.editedLine.nextDueDates)) {
    return { kind: "NONE" };
  }

  const own = foldBlankToNull(input.customerRequestedDueDate);
  if (own === null) return { kind: "NONE" };

  const shape = resolveRequestedDueDateLinkShape([
    { dueDateCount: input.editedLine.nextDueDates.length },
    ...input.otherLines,
  ]);
  if (shape.kind === "NO_ROW") return { kind: "NONE" };
  if (shape.kind === "AMBIGUOUS") {
    return notLinked("AMBIGUOUS", REPAIR_CASE_DUE_DATE_NOT_LINKED_MESSAGE);
  }

  // SINGLE 이면 이 줄에 날짜가 꼭 하나다(다른 줄은 전부 비어 있다).
  const dueDate = input.editedLine.nextDueDates[0];
  if (dueDate === own) return { kind: "NONE" };
  if (!isNotEarlierThan(dueDate, input.receivedAt)) {
    return notLinked("BLOCKED_BY_RECEIVED_AT", REPAIR_CASE_DUE_DATE_BLOCKED_BY_RECEIVED_AT_MESSAGE);
  }
  return { kind: "WRITE", dueDate };
}

/**
 * 두 날짜 묶음이 **같은 날짜들인가.** 차례는 보지 않는다(위 함수의 '차례와 비고는
 * 보지 않는다'). 같은 날짜가 두 행에 적힌 줄도 있으므로 집합이 아니라 **센 것**으로
 * 견준다 — 행 하나를 지운 저장을 「안 바뀜」으로 읽으면 안 된다.
 */
function sameDueDateSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const left = [...a].sort();
  const right = [...b].sort();
  return left.every((value, index) => value === right[index]);
}
