/**
 * ============================================================================
 * 내자 정리 — 칸 하나를 고쳐 보낼 때 **무엇을 함께 실을지** 정하는 규칙
 * ============================================================================
 * DB 도 React 도 여기 들어오지 않는다. domestic-order-list.ts 와 같은 자리의
 * 파일이고, 같은 이유로 순수 함수만 둔다 — 아래 규칙은 **틀리면 자료가 조용히
 * 지워지는** 종류라서, 화면 안에 두면 브라우저를 띄우지 않고는 시험할 방법이
 * 없어진다.
 *
 * ── ⚠️ 이 화면의 저장은 "보낸 칸만" 고치지 않는다 ───────────────────────
 * 주간보고 비고와 **정반대**다. 저쪽 mutation 은 `key in fields` 로만 SET 절을
 * 만들어서, 안 보낸 칸은 손대지 않은 채로 남는다. 내자 정리는 그렇지 않다:
 *
 *   1. validateDomesticOrderFields(validation/domestic-order-input.ts)의
 *      normalizeText·normalizeDate 는 **키가 없으면(undefined) null 로 접는다.**
 *      "안 보냈다"와 "지웠다"를 구분하지 않는다.
 *   2. updateDomesticOrder(mutations/domestic-orders.ts)는 그 결과를
 *      toColumnValues 로 통째로 넘겨 **모든 칼럼을 SET 한다.**
 *
 * 그래서 `{ quoteNumber: "Q-1" }` 하나만 보내면 **그 줄의 나머지 칸이 전부
 * 지워진다.** 칸 하나를 고쳐도 그 줄의 값 전체를 함께 실어 보내야 하는 이유가
 * 이것이고, 그 일을 하는 것이 아래 buildDomesticOrderCellUpdateFields 다.
 *
 * 목록과 차례는 `줄 수정` 폼의 collectFields(DomesticOrderEditForm)를 그대로
 * 따른다 — 그쪽이 이미 이 규칙을 지키는 유일한 자리였다. 두 곳이 서로 다른
 * 목록을 들고 있으면, 한쪽에만 칸이 추가된 날 다른 쪽으로 저장한 줄에서 그 칸이
 * 말없이 비워진다.
 *
 * ⚠️ **이 함수를 부르는 쪽은 expectedVersion 에 그 줄의 version 을 반드시
 * 실어야 한다.** 줄 전체를 덮어쓰는 저장이라, 낙관적 잠금이 없으면 낡은 화면에서
 * 누른 저장이 그 사이 남이 고친 값을 통째로 되돌린다. 그것이 이 방식을 안전하게
 * 만드는 유일한 장치다.
 *
 * ── ⚠️ 계산된 값을 원본 칸에 저장하면 안 된다 ───────────────────────────
 * 목록 한 줄(DomesticOrderListItem)에는 두 벌이 들어 있다:
 *
 *   - **원본 칸** — modelNameText · lotNumberText · serialNumberText ·
 *     intakeNumberText · customerId · faultDescriptionText
 *   - **계산된 값** — modelName · lotNumber · serialNumber ·
 *     displayIntakeNumber · customerName · reportedSymptom ·
 *     **displayDeliveredDate**
 *
 * 계산된 값은 *"그 줄에 적힌 것이 먼저, 없으면 연결된 수리 건의 것"* 이다
 * (resolveDomesticOrderValue). 마지막 하나만 규칙이 더 세다 —
 * displayDeliveredDate 는 **연결된 수리 건의 실제 출하일뿐**이고 그 줄의
 * deliveredDate 는 보지 않는다(resolveDomesticOrderDeliveredDate). 그 값이 실려
 * 나가면 담길 칼럼조차 없거니와, 원본 칸(deliveredDate)에 옮겨 담으면 자동으로
 * 따라오던 날짜가 이 줄에 박제된다. 그러므로 **보낼 때는 반드시 원본 칸을 쓴다.**
 * 계산된 값을 보내면, 그 줄이 원래 비워 두고 수리 건 값을 빌려 쓰던 칸에 수리
 * 건의 값이 자기 값으로 복사되어 굳는다 — 그때부터 "일부러 다르게 적었다"와
 * "그냥 안 건드렸다"를 구분할 수 없고, 나중에 수리 건 쪽이 고쳐져도 이 줄만 옛
 * 값으로 남는다. 화면상으로는 똑같아 보여서 **알아채기까지 오래 걸린다.**
 * (같은 함정을 `줄 수정` 폼도 피하고 있다 — 그 파일 헤더의 'placeholder 다.
 * value 가 아니다'.)
 *
 * 아래 DomesticOrderCellEditRow 가 **원본 칸만** 요구하는 것이 그 장치다.
 * 계산된 값은 타입에 아예 없으므로 실수로 집어 올 자리가 없다.
 *
 * ⚠️ **고장내역은 그 두 벌이 둘 다 눈에 보이는 유일한 칸이다.** 이제 칸을 눌러
 * 고칠 수 있는 열두 칸 중 하나인데, 목록의 표·카드가 그리는 것은 계산된
 * 값(reportedSymptom)이고 저장되는 것은 원본 칸(faultDescriptionText)이다. 그
 * 어긋남을 사람에게 설명하는 것이 이 파일 맨 아래
 * domesticOrderFaultDescriptionHint 이고, 편집칸을 무엇으로 채우는지도 거기
 * 주석에 적혀 있다 — 나머지 여덟 칸에는 계산된 짝이 없어 이 문제가 없다.
 *
 * ── 값은 손대지 않고 그대로 옮긴다 ──────────────────────────────────────
 * 빈 값을 접는 일(빈 문자열 · 공백 → null), 금액의 쉼표를 걷어 내는 일, 순번을
 * 숫자로 읽는 일은 전부 **검증 한 곳**이 한다. 여기서 미리 다듬으면 규칙이 두
 * 곳에 생기고, 언젠가 둘이 어긋난다. 그래서 이 함수는 읽어 온 값을 그대로
 * 되돌려 보내고, 고치는 칸 하나만 갈아 끼운다.
 *
 * ── ⚠️ 날짜도 여기서 다시 검사하지 않는다 ───────────────────────────────
 * 날짜 칸 셋(발주발행일 · 견적발행일 · 세금계산서발행일)이 늦게 합류하면서
 * "형식이 맞는지 여기서 한 번 보면 어떤가"가 자연스러워 보이게 되었는데, 위
 * 문단과 **같은 이유로 보지 않는다.** 검증의 normalizeDate 는 형식뿐 아니라
 * **실제로 있는 날짜인지**까지 본다(2026-02-31 은 형식은 맞지만 없는 날이라
 * 거절한다). 그 규칙을 이쪽에도 적어 두면 두 벌이 되고, 한쪽만 고쳐지는 날
 * 화면과 서버가 서로 다른 날짜를 받아 준다.
 *
 * 빈 값도 마찬가지다 — `<input type="date">` 를 비우면 빈 문자열이 오고, 그것을
 * null 로 접는 것도 같은 검증이다. 세 칸 모두 비어 있는 것이 정상인 칸이라
 * (발주발행일이 없는 줄이 실제로 있다) 이 길은 반드시 살아 있어야 한다.
 *
 * ── 🔴 견적서 연결(quoteId)도 되실어 보낸다 (2026-09-11) ────────────────
 * 2026-08-28 견적서 연결(18ea112)이 `줄 수정` 폼의 collectFields 에는 quoteId 를
 * 넣었는데 **이 파일의 목록에는 넣지 않았다.** 검증은 키 없음을 null 로 접으므로
 * (위 1번), 그 뒤로 표에서 **어느 칸을 고쳐도 — 세금계산서발행일을 적어도 — 그
 * 줄의 견적서 연결이 말없이 풀렸다.** 세금계산서를 적는 줄은 대개 견적서가 붙은
 * 줄이라, 이 칸이 가장 자주 그 구멍을 밟는다. 위 '목록과 차례는 collectFields 를
 * 그대로 따른다'가 한쪽만 고쳐졌을 때 생기는 바로 그 증상이다.
 *
 * ── ⚠️ 견적서를 따르는 칸 둘 — 견적서번호 · 견적발행일 ─────────────────
 * 목록 한 줄의 견적서번호 · 견적발행일 · 금액은 **연결된 견적서가 있으면 그
 * 견적서의 값으로 덮여서** 온다(queries 의 mapDomesticOrderRow). 덮인 줄에는
 * 사람이 손으로 적은 원래 값이 실려 오지 않는다. 그래서 그 줄에서는 이 둘을 눌러
 * 고치지 못하게 막는다(아래 domesticOrderInlineEditQuoteLock) — 열면 편집칸이
 * 견적서 값으로 채워지고, 저장은 원본 칸에 들어가지만 화면은 계속 견적서 값을
 * 그려 "저장했는데 안 바뀐다"가 된다. 금액은 원래 칸 편집이 없다(사용자 결정
 * 2026-09-11 — 견적서에서 가져오는 값이다).
 *
 * ⚠️ **아직 남은 구멍** — 연결된 줄에서 **다른** 칸을 고쳐도 이 세 칸은 함께 실려
 * 나가야 하는데(줄 전체 SET), 실을 원래 값이 없어 견적서 값이 실린다. 화면에는
 * 차이가 없지만(견적서가 이긴다) 원본 칸의 옛 손입력값이 견적서 값으로 덮여,
 * 나중에 연결을 풀면 옛 값이 아니라 견적서 값이 보인다. 막으려면 조회가 원본 세
 * 칸을 따로 실어 줘야 한다(queries/domestic-orders.ts) — 이 파일 혼자서는 막을 수
 * 없다. `줄 수정` 폼도 같은 값으로 채워지므로 같은 구멍이다.
 *
 * ── 납기요청일 목록 편집 (2026-09-11) ────────────────────────────────────
 * 납기요청일은 칸 하나에 값 하나가 아니라 **날짜 여럿 + 메모**다. 그래서 위 열두
 * 칸의 목록에는 넣지 않고 따로 둔다(파일 아래 '납기요청일'). 실어 보내는 규칙은
 * 같다 — 줄 전체를 싣고 dueDates 하나만 갈아 끼운다. 다른 것은 편집 목록을
 * **무엇으로 채우는가** 하나이고, 그것이 이 기능에서 가장 위험한 자리다(그 묶음의
 * '빌려 온 날짜는 채우지 않는다').
 * ============================================================================
 */

import { foldBlankToNull, formatDomesticOrderDueDates } from "./domestic-order-list";
import { resolveDomesticOrderDueDateDisplay } from "./requested-due-date-link";

/**
 * 칸을 눌러 그 자리에서 고칠 수 있는 칸. **글자 칸 아홉 + 날짜 칸 셋, 열둘이다.**
 *
 * 한 줄짜리 다섯(발주서번호 · PJT · 견적서번호 · 납품자 · 일본 송금), 사람이
 * 줄바꿈을 섞어 적는 여러 줄짜리 넷(고장내역 · 현황 · 이력 · 기타), 그리고 날짜
 * 셋(발주발행일 · 견적발행일 · 세금계산서발행일)이다. 셋 갈래의 차이는
 * **편집칸의 생김새 하나뿐**이고(아래 domesticOrderInlineEditControl), 보내는
 * 값을 만드는 규칙은 열둘이 똑같다 — 그래서 하나의 목록이다.
 *
 * ── 날짜 셋이 여기 들어오고 둘이 안 들어온 까닭 ─────────────────────────
 * 이 셋은 **그 줄에 사람이 적는 날짜 하나**다. 값이 `"YYYY-MM-DD"` 문자열 하나라
 * 위 아홉과 똑같이 실려 나가고, 검증도 같은 관문 하나를 지난다. 반면:
 *
 *   - **`deliveredDate`(납품일)** — 목록이 그리는 납품일은 이 칼럼이 아니라
 *     연결된 수리 건의 실제 출하일이다. 사람이 적는 값이 아니라서 `줄 수정`
 *     폼에서도 입력칸을 없앴다(DomesticOrderEditForm). 칸 편집을 붙이면 그
 *     결정이 뒤집힌다 — **여기 적으면 안 된다.**
 *   - **`dueDates`(납기요청일)** — 날짜가 **여럿**이고 메모가 딸린 별도 표다
 *     (schema/domestic-order-due-dates.ts). 칸 하나에 값 하나라는 이 목록의 전제가
 *     통째로 다르다. 2026-09-11 부터 표에서 눌러 고치지만 **이 목록이 아니라**
 *     파일 아래 '납기요청일' 묶음이 따로 맡는다(값 모양과 편집칸이 다르다).
 *
 * 금액·입금완료·고르기 칸도 아직 아니다(쉼표가 섞인 숫자, 체크상자, UUID 를
 * 고르는 드롭다운). 그 칸들은 지금도 `줄 수정` 폼에서 고친다.
 *
 * ⚠️ **`faultDescriptionText` 는 원본 칸이다.** 목록의 표·카드가 그리는 고장내역은
 * 계산된 값(`reportedSymptom`)이지 이 칸이 아니다(파일 헤더의 함정 ②). 여기 적힌
 * 것이 원본 칸이라야 그 함정에 빠질 자리가 없다 — 이 목록에 계산된 값의 이름을
 * 적는 순간 아래 buildDomesticOrderCellUpdateFields 가 그 이름으로 SET 을 만든다.
 * 날짜 셋에는 계산된 짝이 없어(`displayDeliveredDate` 는 납품일의 짝이다) 이
 * 함정이 없지만, **함께 실려 나가는 나머지 스물세 칸에는 그대로 있다.**
 */
export type DomesticOrderInlineEditableField =
  | "purchaseOrderNumber"
  | "projectName"
  | "quoteNumber"
  | "deliveredBy"
  | "japanRemittanceNote"
  | "faultDescriptionText"
  | "progressNote"
  | "historyNote"
  | "etcNote"
  | "orderIssuedDate"
  | "quoteIssuedDate"
  | "taxInvoiceDate";

/**
 * 그 칸의 이름. 표 머리말·카드 이름표와 **같은 글자**여야 한다 — 화면 낭독기가
 * 읽는 이름과 마우스를 올렸을 때 뜨는 안내가 여기서 나오므로, 다르게 적으면 한
 * 칸이 두 이름으로 불린다.
 */
export const DOMESTIC_ORDER_INLINE_EDIT_LABELS: Readonly<
  Record<DomesticOrderInlineEditableField, string>
> = {
  purchaseOrderNumber: "발주서번호",
  projectName: "PJT",
  quoteNumber: "견적서번호",
  deliveredBy: "납품자",
  japanRemittanceNote: "일본 송금",
  faultDescriptionText: "고장내역",
  progressNote: "현황",
  historyNote: "이력",
  etcNote: "기타",
  // 날짜 셋. **검증의 DATE_FIELDS 이름표와도 같은 글자다**
  // (validation/domestic-order-input.ts) — 저장이 거절되면 그 이름으로 만든
  // 문장이 이 칸 아래에 그대로 뜨므로, 다르면 "발주일은 … 형식이어야 합니다"가
  // 화면에 없는 칸 이름을 말하게 된다.
  orderIssuedDate: "발주발행일",
  quoteIssuedDate: "견적발행일",
  taxInvoiceDate: "세금계산서발행일",
};

/**
 * 사람이 **줄바꿈을 섞어 적는 칸인가.** 켠 칸의 편집칸은 `<textarea>` 이고, 끈
 * 칸은 `<input type="text">` 다.
 *
 * ── 왜 화면이 아니라 여기서 정하는가 ────────────────────────────────────
 * 틀리면 **자료가 조용히 깎이는** 규칙이라서다. 여러 줄이 들어 있는 칸을
 * `<input>` 으로 열면 브라우저가 값의 줄바꿈을 **말없이 지운 채** 넘겨주고, 아무
 * 것도 고치지 않고 저장만 눌러도 그 줄의 메모가 한 줄로 뭉개진다. 화면에 두면
 * 표와 카드가 각각 고르게 되어 한쪽만 틀릴 수 있고, 브라우저를 띄우지 않고는
 * 시험할 방법도 없다.
 *
 * ── `Enter` 로 저장하지 않는 것도 여기서 갈린다 ─────────────────────────
 * 한 줄짜리 다섯은 `<input>` 하나뿐인 폼이라 브라우저가 Enter 를 저장으로 받는다
 * (묵시적 제출). 여러 줄 칸에서 그러면 **줄바꿈을 칠 수가 없다** — `<textarea>` 는
 * Enter 를 묵시적 제출로 삼지 않으므로, 켜는 것만으로 저장은 버튼 몫이 된다.
 *
 * ⚠️ 이 표는 **접는 방식(whitespace)과 다른 것이다.** 접는 방식은 같은 칸이라도
 * 표와 카드가 다르게 고르므로(표는 폭에서 안 접고, 카드는 접는다) 부르는 쪽이
 * 정한다. 여기 있는 것은 **값 자체의 성질**이라 어디서 그리든 같다.
 *
 * ⚠️ 날짜 칸 셋은 전부 false 인데, 그것이 "그러니 `<input type="text">` 로 연다"는
 * 뜻은 아니다. 편집칸 종류를 실제로 고르는 것은 아래
 * domesticOrderInlineEditControl 이고, 날짜 판정이 먼저다.
 */
export const DOMESTIC_ORDER_INLINE_EDIT_MULTILINE: Readonly<
  Record<DomesticOrderInlineEditableField, boolean>
> = {
  purchaseOrderNumber: false,
  projectName: false,
  quoteNumber: false,
  deliveredBy: false,
  japanRemittanceNote: false,
  faultDescriptionText: true,
  progressNote: true,
  historyNote: true,
  etcNote: true,
  orderIssuedDate: false,
  quoteIssuedDate: false,
  taxInvoiceDate: false,
};

/**
 * **달력으로 고르는 칸인가.** 켠 칸의 편집칸은 `<input type="date">` 다.
 *
 * ── 왜 글자 칸으로 받지 않는가 ──────────────────────────────────────────
 * `줄 수정` 폼이 이미 이 셋을 `type: "date"` 로 받는다(DomesticOrderEditForm 의
 * renderText). 같은 값을 칸 편집에서만 글자로 받으면 사람은 자기가 늘 쓰는 대로
 * `2026.5.11` 이나 `26/5/11` 을 치고, 그 저장은 **매번 검증에 걸려 되돌아온다** —
 * 고칠 수 있는 칸처럼 보이는데 실제로는 형식을 맞춰 친 사람만 쓸 수 있는 칸이
 * 된다. 달력 입력은 브라우저가 그 지역의 표기로 보여 주면서 값은 늘
 * `YYYY-MM-DD` 로 넘겨준다.
 *
 * ── 왜 화면이 아니라 여기서 정하는가 ────────────────────────────────────
 * 위 …_MULTILINE 과 같은 이유다 — 표와 카드가 각각 고르면 한쪽만 틀릴 수 있고,
 * 그때 한쪽 화면에서만 형식 오류가 나는 칸이 생긴다. 그리고 이것 역시 **값
 * 자체의 성질**이라 어디서 그리든 같다.
 *
 * ⚠️ **여기 true 인 칸은 …_MULTILINE 이 반드시 false 다.** 날짜에 여러 줄이 있을
 * 수 없어서이기도 하지만, 아래 domesticOrderInlineEditControl 이 날짜를 먼저
 * 보므로 둘 다 true 이면 여러 줄 판정이 **말없이 무시되기** 때문이다. 시험이 그
 * 어긋남을 막는다.
 */
export const DOMESTIC_ORDER_INLINE_EDIT_DATE: Readonly<
  Record<DomesticOrderInlineEditableField, boolean>
> = {
  purchaseOrderNumber: false,
  projectName: false,
  quoteNumber: false,
  deliveredBy: false,
  japanRemittanceNote: false,
  faultDescriptionText: false,
  progressNote: false,
  historyNote: false,
  etcNote: false,
  orderIssuedDate: true,
  quoteIssuedDate: true,
  taxInvoiceDate: true,
};

/**
 * 그 칸을 열었을 때 **무엇으로 받을 것인가.** 화면은 이 하나만 물어본다.
 *
 * 표 둘(날짜 · 여러 줄)을 화면에서 각각 읽어 `isDate ? … : isMultiline ? … : …`
 * 로 갈라도 결과는 같지만, 그러면 **어느 것이 먼저인가**라는 규칙이 표와 카드의
 * JSX 안에 두 벌로 생긴다. 그 규칙이 틀리면 조용히 값이 깎이는 쪽으로 틀리므로
 * (날짜 칸을 textarea 로 열면 브라우저가 값을 못 채우고 빈칸으로 뜬다), 여기서
 * 한 번 정하고 브라우저 없이 시험한다.
 */
export type DomesticOrderInlineEditControl = "date" | "textarea" | "text";

export function domesticOrderInlineEditControl(
  field: DomesticOrderInlineEditableField
): DomesticOrderInlineEditControl {
  if (DOMESTIC_ORDER_INLINE_EDIT_DATE[field]) return "date";
  return DOMESTIC_ORDER_INLINE_EDIT_MULTILINE[field] ? "textarea" : "text";
}

/**
 * 편집칸 아래에 **"저장하면 이 줄이 목록에서 사라질 수 있습니다"**를 적어야 하는
 * 칸인가. 적을 것이 없으면 null 이다.
 *
 * ── 발주발행일 하나뿐이고, 고장이 아니다 ────────────────────────────────
 * 목록은 **발주발행일의 년도**로 줄을 가른다(domestic-order-list.ts 의
 * filterDomesticOrdersByYear). 그래서 이 칸을 다른 해로 고치면 저장한 그 줄이
 * 지금 보고 있는 해에서 **없어진다** — 규칙대로 움직인 결과인데, 사람에게는
 * "저장했더니 줄이 사라졌다"로 보인다. 되돌리려면 어느 해로 가야 하는지도 화면
 * 어디에도 안 적혀 있다.
 *
 * 비우는 쪽은 반대다. 발주 년도를 읽을 수 없는 줄은 **어느 해를 골라도 통과**
 * 하므로(같은 함수) 사라지지 않는다. 둘은 결과가 정반대라 한 문장으로 뭉뚱그릴
 * 수 없어 두 줄로 적는다.
 *
 * ⚠️ **년도 거르기 규칙 자체는 건드리지 않는다.** 이 안내는 그 규칙을 사람이 미리
 * 알게 할 뿐이다 — 규칙을 여기서 손보면 "발주일 미정 N건은 어느 년도를 골라도
 * 함께 보입니다"라는 목록 위의 안내부터 거짓이 된다.
 *
 * 문구를 화면이 아니라 여기 두는 것은, **어느 칸에 붙는지**가 규칙이기 때문이다.
 * 표와 카드가 각각 적으면 한쪽에만 붙거나, 년도와 상관없는 칸(견적발행일 ·
 * 세금계산서발행일)에까지 붙어 **있지도 않은 규칙을 설명하는 문장**이 된다.
 */
export function domesticOrderInlineEditYearNotice(
  field: DomesticOrderInlineEditableField
): readonly string[] | null {
  if (field !== "orderIssuedDate") return null;
  return [
    "목록은 발주발행일의 년도로 가릅니다. 다른 해로 바꾸면 이 줄은 지금 보고 있는 년도에서 사라집니다.",
    "비워 두면 어느 년도를 골라도 함께 보입니다.",
  ];
}

/**
 * 이 함수가 실제로 보는 칸만 요구한다 — DomesticOrderListItem 전체를 끌어오지
 * 않는 것은 domestic-order-list.ts 와 같은 이유이고, 여기서는 이유가 하나 더
 * 있다: **계산된 값을 타입에서 아예 빼 두기 위해서다**(파일 헤더의 함정 ②).
 *
 * 차례는 `줄 수정` 폼의 collectFields 그대로다.
 */
export type DomesticOrderCellEditRow = {
  repairCaseId: string | null;
  intakeNumberText: string | null;
  customerId: string | null;
  modelNameText: string | null;
  lotNumberText: string | null;
  serialNumberText: string | null;
  faultDescriptionText: string | null;
  displayOrder: number | null;
  purchaseOrderNumber: string | null;
  projectName: string | null;
  orderIssuedDate: string | null;
  /**
   * 납기요청일 **전부**. 차례가 곧 저장되는 차례다(validation 의
   * DomesticOrderDueDateInput 주석) — 여기서 다시 정렬하거나 걸러 내면 그 줄의
   * 납기일 순서가 칸 하나 고칠 때마다 바뀐다.
   *
   * 목록이 실어 오는 항목에는 id 와 displayOrder 도 붙어 있지만 저장에는 쓰이지
   * 않는다(검증이 dueDate · note 만 읽는다). 그래도 아래에서 두 칸만 골라
   * 새로 만드는 것은, **보내는 값의 모양을 이 파일이 정한다**는 사실을 코드로
   * 남겨 두기 위해서다.
   */
  dueDates: readonly { dueDate: string; note: string | null }[];
  quoteIssuedDate: string | null;
  quoteNumber: string | null;
  /**
   * 연결된 견적서. ⚠️ **화면에 칸이 없는데 반드시 여기 있어야 한다** — 납품일과
   * 같은 종류다. 빠지면 검증이 undefined 를 null 로 접어, 칸 하나 고치는 저장
   * 한 번에 그 줄의 견적서 연결이 풀린다(파일 헤더 '견적서 연결도 되실어 보낸다').
   *
   * 원본 칼럼(quote_id) 그대로라 계산된 값이 아니다. 조인해 온 linkedQuoteNumber ·
   * linkedQuoteDate 는 이 타입에 없다 — 담길 칼럼이 없는 값이다.
   */
  quoteId: string | null;
  progressNote: string | null;
  /**
   * ⚠️ **화면 어디에도 안 나오는 값인데 반드시 여기 있어야 한다.**
   *
   * 목록의 `납품일` 은 이제 이 칼럼이 아니라 연결된 수리 건의 실제 출하일이다
   * (queries 의 displayDeliveredDate). `줄 수정` 폼에도 입력칸이 없다. 그래도
   * 이 칸을 뺄 수 없는 이유는 파일 헤더의 규칙 하나 때문이다 — **이 저장은 모든
   * 칼럼을 SET 한다.** 아래 builder 가 이 키를 안 실으면 검증이 undefined 를
   * null 로 접고, 손으로 적던 시절의 납품일이 **칸 하나 고치는 저장 한 번에**
   * DB 에서 사라진다.
   *
   * 화면에서 안 보여 주기로 한 것과 자료를 버리는 것은 다른 결정이다. 되돌릴 수
   * 있게 두려고 칼럼을 남긴 것이므로, 이 경로로 지워지면 그 결정이 무의미해진다.
   *
   * ⚠️ 계산된 짝(displayDeliveredDate)은 **이 타입에 없다.** 고장내역과 같은
   * 함정이고(파일 헤더의 함정 ②), 여기 없다는 것이 그 함정에 빠질 자리를 없애는
   * 장치다 — 그 이름으로 SET 을 만들 칼럼은 아예 없다.
   */
  deliveredDate: string | null;
  /** `납품일` 과 이름만 비슷한 다른 칸이다. 이쪽은 눌러서 고치는 열두 칸에 든다. */
  deliveredBy: string | null;
  taxInvoiceDate: string | null;
  amountExcludingVat: string | null;
  paymentCompleted: boolean;
  japanRemittanceNote: string | null;
  historyNote: string | null;
  etcNote: string | null;
};

/**
 * 칸 하나를 고쳐 `updateDomesticOrderAction` 에 보낼 `fields`.
 *
 * 고치는 칸에는 사용자가 친 글자를 **다듬지 않고 그대로** 넣는다(파일 헤더의
 * '값은 손대지 않고'). 빈 문자열을 넣어 지운 경우도 마찬가지다 — 빈 문자열을
 * null 로 접는 일은 검증이 하고, 그래야 `줄 수정` 폼으로 지웠을 때와 결과가
 * 한 글자도 다르지 않다.
 *
 * 날짜 칸 셋도 이 길을 그대로 탄다. `<input type="date">` 가 넘겨주는 것은
 * `"2026-01-05"` 또는 (비웠으면) 빈 문자열인 **문자열 하나**라, 여기서 갈라
 * 다룰 것이 없다 — 날짜인지 아닌지는 편집칸을 고를 때 한 번 보고 끝난다
 * (위 domesticOrderInlineEditControl).
 *
 * 나머지 칸은 읽어 온 값 그대로다. 하나라도 빠뜨리면 그 칸이 지워진다.
 */
export function buildDomesticOrderCellUpdateFields(
  row: DomesticOrderCellEditRow,
  field: DomesticOrderInlineEditableField,
  value: string
): Record<string, unknown> {
  return {
    ...collectRowFields(row),
    // 고치는 칸은 **맨 마지막에** 갈아 끼운다. 위 목록에 그 칸이 이미 있으므로
    // 순서가 곧 규칙이다 — 앞에 두면 원래 값이 새 값을 덮어쓴다.
    [field]: value,
  };
}

/**
 * 그 줄의 값 **전부**를 읽어 온 그대로. 칸 편집(위)과 납기요청일 편집(아래)이
 * 함께 쓴다 — 두 곳이 목록을 따로 들고 있으면 한쪽에만 칸이 늘어난 날 다른 쪽으로
 * 저장한 줄에서 그 칸이 말없이 비워진다(파일 헤더의 '한쪽만 고쳐졌을 때').
 *
 * 차례는 `줄 수정` 폼의 collectFields 그대로다.
 */
function collectRowFields(row: DomesticOrderCellEditRow): Record<string, unknown> {
  return {
    repairCaseId: row.repairCaseId,
    intakeNumberText: row.intakeNumberText,
    customerId: row.customerId,
    modelNameText: row.modelNameText,
    lotNumberText: row.lotNumberText,
    serialNumberText: row.serialNumberText,
    faultDescriptionText: row.faultDescriptionText,
    displayOrder: row.displayOrder,
    purchaseOrderNumber: row.purchaseOrderNumber,
    projectName: row.projectName,
    orderIssuedDate: row.orderIssuedDate,
    dueDates: row.dueDates.map((entry) => ({ dueDate: entry.dueDate, note: entry.note })),
    quoteIssuedDate: row.quoteIssuedDate,
    quoteNumber: row.quoteNumber,
    // ⚠️ 화면에 칸이 없지만 **빼면 견적서 연결이 풀린다**(위 타입의 그 칸 주석).
    // 2026-08-28 부터 09-11 까지 여기가 비어 있었다.
    quoteId: row.quoteId,
    progressNote: row.progressNote,
    // ⚠️ 화면에 안 보이는 값이지만 **빼면 지워진다**(위 타입의 그 칸 주석).
    // 안 보여 주기로 한 것이지 버리기로 한 것이 아니다.
    deliveredDate: row.deliveredDate,
    deliveredBy: row.deliveredBy,
    taxInvoiceDate: row.taxInvoiceDate,
    amountExcludingVat: row.amountExcludingVat,
    paymentCompleted: row.paymentCompleted,
    japanRemittanceNote: row.japanRemittanceNote,
    historyNote: row.historyNote,
    etcNote: row.etcNote,
  };
}

/**
 * 견적서가 연결된 줄에서 **따르는 값이 덮여 오는** 칸 중, 눌러 고칠 수 있는 둘.
 * `줄 수정` 폼의 안내("견적서번호 · 견적발행일 · 금액은 연결된 견적서를
 * 따릅니다")와 조회가 덮어쓰는 셋(queries 의 mapDomesticOrderRow)에서 칸 편집이
 * 없는 금액만 뺀 것이다.
 */
export const DOMESTIC_ORDER_QUOTE_FOLLOWING_FIELDS: readonly DomesticOrderInlineEditableField[] = [
  "quoteIssuedDate",
  "quoteNumber",
];

/**
 * 막힌 칸에 마우스를 올리면 뜨는 말. **왜 못 고치는지와 어디서 바꾸는지**를 함께
 * 적는다 — 까닭 없이 안 열리는 칸은 고장으로 읽힌다. 앞 문장은 `줄 수정` 폼의
 * 안내와 같은 말이다(같은 규칙을 두 곳이 다른 말로 설명하지 않게).
 */
export const DOMESTIC_ORDER_QUOTE_LOCK_NOTE =
  "견적서번호 · 견적발행일 · 금액은 연결된 견적서를 따르므로 표에서 고칠 수 없습니다. 바꾸려면 견적서를 고치거나, 줄을 눌러 `줄 수정`에서 견적서 연결을 푸세요.";

/**
 * 이 줄의 이 칸을 **눌러 고치지 못하게 막아야 하는가.** 막아야 하면 칸에 띄울
 * 까닭을, 아니면 null 을 돌려준다.
 *
 * ── 조건이 quoteId 하나인 까닭 ──────────────────────────────────────────
 * `줄 수정` 폼이 '연결된 견적서를 따릅니다'를 띄우는 조건이 quoteId 이고, 그와
 * 같게 둔다. 조회는 연결된 견적서가 휴지통에 있으면 덮지 않지만, 화면에 온 값만
 * 보고는 "지금 이 값이 덮인 값인가"를 틀림없이 말할 수 없다 — **덮였을지 모르는
 * 값을 원본 칸에 저장하는 길**을 남기는 것보다 연결이 걸린 줄을 통째로 막는 편이
 * 안전하다. 그런 줄은 `줄 수정` 에서 연결을 풀면 다시 열린다.
 *
 * ⚠️ **세금계산서발행일은 막지 않는다.** 견적서가 붙은 줄이 바로 세금계산서를
 * 적는 줄이다 — 이 판정이 그 칸까지 번지면 이번에 고친 것이 도로 막힌다.
 */
export function domesticOrderInlineEditQuoteLock(
  row: { quoteId: string | null },
  field: DomesticOrderInlineEditableField
): string | null {
  if (row.quoteId === null) return null;
  return DOMESTIC_ORDER_QUOTE_FOLLOWING_FIELDS.includes(field)
    ? DOMESTIC_ORDER_QUOTE_LOCK_NOTE
    : null;
}

/**
 * 고장내역 편집칸 아래에 붙는 안내에 **무엇을 적을 것인가.** 붙일 것이 없으면
 * null 이다.
 *
 * ── 이 안내가 없으면 고장내역 칸은 고장으로 읽힌다 ──────────────────────
 * 이 칸은 편집칸을 **원본 칸(faultDescriptionText)으로 채운다.** 화면에 보이던
 * 계산된 값(reportedSymptom)으로 채우면, 사람이 아무것도 고치지 않고 저장만
 * 눌러도 **수리 건의 고장 증상이 이 줄 자기 값으로 굳는다** — 그 뒤로는 수리 건
 * 쪽을 고쳐도 이 줄만 옛 값으로 남고, 화면상으로는 똑같아 보여서 알아채기까지
 * 오래 걸린다(파일 헤더의 함정 ②). `줄 수정` 폼이 이미 같은 규칙이다
 * (DomesticOrderEditForm 의 'placeholder 다. value 가 아니다').
 *
 * 그 대신 **비어 있는 채로 열리는 순간이 생긴다** — 목록에는 수리 건에서 빌려 온
 * 글이 보이는데 눌러서 연 칸은 비어 있다. 그것을 설명하는 것이 이 안내다.
 * `줄 수정` 폼의 faultDescriptionHint 와 **같은 것을 같은 조건으로** 말한다:
 * 두 곳이 다른 말을 하면, 같은 칸을 어느 길로 여느냐에 따라 규칙이 달라 보인다.
 *
 * ── 조건이 둘인 까닭 ────────────────────────────────────────────────────
 * 연결이 없으면 빌려 올 값 자체가 없고, 연결이 있어도 그 건에 증상이 안 적혀
 * 있으면 비워 두어도 아무것도 안 보인다. 둘 중 하나라도 아니면 "비워 두면 이
 * 값이 보입니다"가 **거짓말**이 되므로 안내를 아예 내지 않는다.
 *
 * `줄 수정` 폼에는 조건이 하나 더 있다(고르개로 **다른** 수리 건을 고른 참이면
 * 안 낸다). 칸 편집에는 고르개가 없어 연결을 바꿀 길이 없으므로, 그 조건은 늘
 * 참이고 여기서는 사라진다.
 */
export type DomesticOrderFaultHintRow = {
  repairCaseId: string | null;
  /** 연결된 수리 건의 인수번호. **계산된 displayIntakeNumber 가 아니다.** */
  intakeNumber: string | null;
  /** 연결된 수리 건에 적힌 고장 증상. 이 줄 자신의 값이 아니다. */
  repairCaseReportedSymptom: string | null;
};

export function domesticOrderFaultDescriptionHint(
  row: DomesticOrderFaultHintRow
): { intakeNumber: string | null; symptom: string } | null {
  if (row.repairCaseId === null) return null;
  const symptom = foldBlankToNull(row.repairCaseReportedSymptom);
  if (symptom === null) return null;
  return { intakeNumber: foldBlankToNull(row.intakeNumber), symptom };
}

/**
 * ============================================================================
 * 납기요청일 — 표에서 **날짜 목록**을 고칠 때 (2026-09-11)
 * ============================================================================
 * 한 줄에 날짜가 여럿(분할 납품)이고 날짜마다 메모가 붙는다. 저장은 위 칸 편집과
 * 같은 길(updateDomesticOrderAction)이고, 저장하는 쪽은 받은 목록으로 그 줄의
 * 날짜를 **통째로 바꿔 적는다**(mutations 의 replaceDueDates). 그러니 여기서
 * 보내는 목록이 곧 "이 줄의 납기요청일은 이제 이것이 전부"다.
 *
 * ── 🔴 빌려 온 날짜는 편집 목록에 채우지 않는다 ─────────────────────────
 * 이 줄에 날짜가 하나도 없으면 목록은 연결된 수리 건의 **고객 요청 납기일**을
 * `수리 건 요청일` 표시와 함께 대신 보여 준다(requested-due-date-link.ts). 그
 * 날짜를 편집 목록에 미리 채우면, 아무것도 안 고치고 저장만 눌러도 **수리 건의
 * 값이 이 줄의 납기요청일로 복사되어 굳는다** — 고장내역(위 함정 ②)과 같은
 * 함정이고, V-5 가 "뜻이 다른 두 날짜"라고 못 박은 둘을 섞는 일이다.
 *
 * 그래서 편집 목록은 **이 줄에 적힌 날짜만으로** 시작한다(아래
 * domesticOrderDueDateEditDraft — 받는 타입에 수리 건의 날짜가 아예 없다). 빈
 * 목록으로 열리는 순간이 생기므로, 무엇이 보이게 되는지를 편집칸 아래 한 줄로
 * 적는다(domesticOrderDueDateBorrowHint). 고장내역 안내와 같은 방식이다.
 *
 * ── 값은 손대지 않고 그대로 옮긴다 ──────────────────────────────────────
 * 빈 줄을 빼는 일, 날짜 없이 메모만 적은 줄을 거절하는 일, 날짜가 실제로 있는
 * 날인지 보는 일, 스무 개 상한은 전부 **검증 한 곳**이 한다
 * (validation/domestic-order-input.ts 의 normalizeDueDates). `줄 수정` 폼과 같은
 * 관문이라 두 길이 받아 주는 목록이 한 글자도 다르지 않다. 여기서 빈 줄을 미리
 * 걸러 내면 검증이 돌려주는 `dueDates.N` 의 N 이 편집칸의 줄 번호와 어긋나, 오류가
 * 엉뚱한 줄 밑에 붙는다.
 * ============================================================================
 */

/** 편집 중인 납기요청일 한 줄. 두 값 다 문자열이다(빈 문자열 = 안 적음). */
export type DomesticOrderDueDateDraft = { dueDate: string; note: string };

/**
 * 편집 목록을 **무엇으로 채울 것인가** — 이 줄에 적힌 날짜 그대로, 차례도
 * 그대로다. 없으면 빈 목록이다.
 *
 * ⚠️ **받는 것이 이 줄의 dueDates 하나뿐인 것이 이 함수의 요점이다.** 수리 건의
 * 고객 요청 납기일(repairCaseCustomerRequestedDueDate)은 타입에 없으므로 여기로
 * 새어 들어올 길이 없다(위 '빌려 온 날짜는 채우지 않는다'). 목록 한 줄을 통째로
 * 넘겨도 이 함수가 읽는 칸은 dueDates 뿐이다.
 *
 * 메모의 null 은 빈 문자열로 편다 — 입력칸의 값은 문자열이어야 하고, 되돌려 보낸
 * 빈 문자열을 null 로 접는 일은 검증이 한다.
 */
export function domesticOrderDueDateEditDraft(row: {
  dueDates: readonly { dueDate: string; note: string | null }[];
}): DomesticOrderDueDateDraft[] {
  return row.dueDates.map((entry) => ({ dueDate: entry.dueDate, note: entry.note ?? "" }));
}

/**
 * 납기요청일 목록을 고쳐 `updateDomesticOrderAction` 에 보낼 `fields`.
 *
 * 줄 전체를 싣고 **dueDates 하나만** 갈아 끼운다(위 칸 편집과 같은 목록 —
 * collectRowFields). 받은 목록은 **걸러 내지도 다듬지도 않는다**(위 묶음 머리의
 * '값은 손대지 않고') — 빈 줄도, 앞뒤 공백도 그대로 나간다. 빈 목록이면 빈
 * 배열이 나가고, 저장하는 쪽이 그 줄의 날짜를 모두 지운다 — 그러면 목록은 다시
 * 수리 건의 요청일을 빌려 보여 준다.
 */
export function buildDomesticOrderDueDatesUpdateFields(
  row: DomesticOrderCellEditRow,
  dueDates: readonly DomesticOrderDueDateDraft[]
): Record<string, unknown> {
  return {
    ...collectRowFields(row),
    // 고치는 칸은 맨 마지막에 갈아 끼운다(위 칸 편집과 같은 이유). 새 배열·새
    // 객체로 만든다 — 편집 중인 상태를 그대로 넘기면 저장이 도는 동안 사람이
    // 고친 글자가 보낸 값에 섞일 수 있다.
    dueDates: dueDates.map((entry) => ({ dueDate: entry.dueDate, note: entry.note })),
  };
}

/**
 * 편집칸 아래 안내에 적을 날짜 — **목록을 비워 두면 대신 보이게 될** 연결된 수리
 * 건의 고객 요청 납기일. 비워 두어도 보일 것이 없으면 null 이고, 그때는 안내를
 * 내지 않는다(없는 것을 "보입니다"라고 말하면 거짓말이다).
 *
 * 판정을 새로 적지 않고 **목록이 그리는 규칙을 그대로 부른다**
 * (resolveDomesticOrderDueDateDisplay 에 빈 목록을 넣어 본다). 두 곳이 따로
 * 정하면, 안내는 "보입니다"라고 하는데 저장하고 나면 안 보이는 날이 온다.
 *
 * 이 줄에 지금 날짜가 적혀 있어도 안내는 나온다 — 그 날짜를 모두 지우면 이 날짜가
 * 보이게 된다는 사실은 그때도 참이기 때문이다.
 */
export function domesticOrderDueDateBorrowHint(row: {
  repairCaseCustomerRequestedDueDate: string | null;
}): string | null {
  const display = resolveDomesticOrderDueDateDisplay({
    dueDates: [],
    repairCaseCustomerRequestedDueDate: row.repairCaseCustomerRequestedDueDate,
  });
  return display.borrowed ? display.lines[0] ?? null : null;
}

/**
 * 충돌 상자에 담을 한 줄 — "2026-01-20 (1차분), 2026-02-15". 담을 것이 없으면 빈
 * 문자열이다(상자가 아예 안 그려진다 — buildDraftText).
 *
 * `줄 수정` 폼의 dueDatesDraftText 와 **같은 규칙**이다: 아무것도 안 적은 줄은
 * 빼고, 날짜 없이 메모만 친 줄은 `(날짜 없음)` 으로 남긴다 — 그 메모가 바로 다시
 * 불러온 화면에서 사라지는 글이다. 목록을 글자로 만드는 일은 표와 같은 함수가
 * 한다(formatDomesticOrderDueDates).
 */
export function domesticOrderDueDatesDraftText(
  dueDates: readonly DomesticOrderDueDateDraft[]
): string {
  const written = dueDates.filter(
    (entry) => entry.dueDate.trim() !== "" || entry.note.trim() !== ""
  );
  if (written.length === 0) return "";
  return (
    formatDomesticOrderDueDates(
      written.map((entry) => ({
        dueDate: entry.dueDate.trim() === "" ? "(날짜 없음)" : entry.dueDate.trim(),
        note: entry.note,
      }))
    ) ?? ""
  );
}
