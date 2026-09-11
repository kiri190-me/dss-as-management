import { repairCaseDetailHrefs } from "./repair-case-detail-tabs";

/**
 * ============================================================================
 * 수리 건 → 새 견적서 → 다시 그 건. 링크에 실리는 두 값
 * ============================================================================
 * 「견적서」 탭의 `새 견적서` 단추는 `/quotes/new` 로 간다. 그냥 가면 빈 폼이
 * 열리고, 사람이 인수번호를 손으로 다시 적어야 한다 — 방금 그 건에서 눌렀는데도.
 * 그래서 **인수번호와 접수 건 id 두 개**를 주소에 싣는다.
 *
 * ── 왜 인수번호를 싣는가 ─────────────────────────────────────────────────
 * 🔴 폼을 채우는 값은 **기존의 「인수번호로 불러오기」 길에서 나와야 한다**
 * (`lookupIntakeForQuoteAction`). 여기서 고객사·모델명·금액 근거를 따로 채우는
 * 두 번째 길을 만들면, 두 입구가 서로 다른 값을 채우게 되고 그 차이는 한참
 * 뒤에 **금액으로** 드러난다. 그래서 이 링크가 나르는 것은 채워진 값이 아니라
 * **인수번호 하나**다 — 폼이 그것으로 기존 길을 그대로 탄다.
 *
 * ── 왜 접수 건 id 도 함께 싣는가 ─────────────────────────────────────────
 * 저장한 뒤에 **왔던 곳으로 돌아가기** 위해서다. 돌아갈 주소를 통째로 싣지
 * 않는 것이 요점이다: 주소를 그대로 받아 `router.push` 에 넘기면 남이 만든
 * 링크가 사람을 바깥 사이트로 보낼 수 있다(열린 리다이렉트). id 만 받아
 * **우리가 아는 주소를 우리가 만든다** — `repairCaseDetailHrefs` 한 곳에서.
 *
 * UUID 가 아닌 id 는 없는 것으로 친다. 조회에 넣지도 않고, 돌아갈 주소도
 * 만들지 않는다 — 그때 폼은 `/quotes/new` 로 그냥 들어온 것과 똑같이 동작한다.
 * ============================================================================
 */

export const QUOTE_NEW_INTAKE_NUMBER_PARAM = "intakeNumber";
export const QUOTE_NEW_REPAIR_CASE_PARAM = "repairCaseId";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Next 의 searchParams 모양. 같은 이름이 두 번 오면 배열이 된다. */
export type SearchParamsInput = Record<string, string | string[] | undefined>;

export type NewQuoteLink = {
  /** 폼이 「인수번호로 불러오기」를 그대로 태울 값. 없으면 null. */
  intakeNumber: string | null;
  /** 돌아갈 접수 건. UUID 가 아니면 null. */
  repairCaseId: string | null;
};

/** 이 접수 건에서 새 견적서를 만들러 가는 주소. 탭의 `새 견적서` 단추가 쓴다. */
export function newQuoteHrefForRepairCase(input: {
  repairCaseId: string;
  intakeNumber: string;
}): string {
  const params = new URLSearchParams({
    [QUOTE_NEW_INTAKE_NUMBER_PARAM]: input.intakeNumber,
    [QUOTE_NEW_REPAIR_CASE_PARAM]: input.repairCaseId,
  });
  return `/quotes/new?${params.toString()}`;
}

/** 위 주소를 되읽는다. 값이 없거나 모양이 아니면 null 이다 — 오류가 아니다. */
export function parseNewQuoteLink(searchParams: SearchParamsInput | undefined): NewQuoteLink {
  const intakeNumber = firstValue(searchParams?.[QUOTE_NEW_INTAKE_NUMBER_PARAM]);
  const repairCaseId = firstValue(searchParams?.[QUOTE_NEW_REPAIR_CASE_PARAM]);
  return {
    intakeNumber: intakeNumber === "" ? null : intakeNumber,
    repairCaseId: UUID_PATTERN.test(repairCaseId) ? repairCaseId : null,
  };
}

/**
 * 저장·취소 뒤에 돌아갈 곳. 접수 건에서 들어왔으면 그 건의 「견적서」 탭이고,
 * 그냥 `/quotes/new` 로 들어왔으면 null 이다(그때는 지금까지와 똑같이 동작한다).
 *
 * 🔴 주소를 **여기서 만든다** — 링크가 실어 온 글자를 그대로 쓰지 않는다.
 */
export function returnHrefForNewQuote(link: NewQuoteLink): string | null {
  return link.repairCaseId === null ? null : repairCaseDetailHrefs(link.repairCaseId).quotes;
}

/**
 * ============================================================================
 * 수리 건 → **기존** 견적서 수정 → 다시 그 건
 * ============================================================================
 * 새 견적서와 같은 일을 이미 있는 장에도 한다(2026-09-11 사용자 요청). 「견적서」
 * 탭에서 한 장을 눌러 수정 화면에 들어갔다가 [취소]를 누르면, 예전에는 PO/내자
 * 목록(`/quotes`)으로 떨어졌다 — 방금 있던 건에서 한참 떨어진 곳이다.
 *
 * 링크에 싣는 것은 **접수 건 id 하나**이고, 이름도 새 견적서와 같은
 * `repairCaseId` 다(QUOTE_NEW_REPAIR_CASE_PARAM). 돌아갈 주소를 통째로 싣지 않는
 * 까닭도 위와 같다 — id 만 받아 **우리가 아는 주소를 우리가 만든다**.
 *
 * ── 🔴 새 견적서보다 하나 더 본다: 그 견적서가 정말 그 건의 것인가 ──────
 * 새 견적서는 아직 어느 건에도 붙지 않았으니 비교할 대상이 없다. 기존 장은 이미
 * `quotes.repair_case_id` 를 갖고 있다. 그래서 주소의 id 가 **그 값과 같을 때만**
 * 그 건으로 돌려보낸다. 다르면 null(= 지금까지처럼 `/quotes`)이다.
 *   · 주소를 손으로 바꾼 링크가 사람을 **남의 건**으로 보내지 않게 — UUID 모양만
 *     맞으면 아무 건으로나 가는 문이 되면 안 된다.
 *   · 견적서가 그 사이 **다른 건으로 옮겨졌으면** 옛 건으로 돌아가지 않게 — 옛
 *     탭에는 그 장이 더 이상 없어서, 돌아간 사람은 방금 고친 장을 못 찾는다.
 *   · 견적서가 어느 건에도 붙어 있지 않으면(NULL) 돌아갈 건 자체가 없다.
 * 돌아갈 주소는 **DB 가 준 값으로** 만든다 — 대소문자까지 링크의 글자는 쓰지 않는다.
 * ============================================================================
 */

/**
 * 목록의 한 줄이 여는 수정 화면 주소. 접수 건이 없으면(null) **지금까지의 그
 * 주소 그대로**다 — PO/내자 목록은 한 글자도 달라지지 않는다. 접수 건 탭은 그 건의
 * id 를 실어 보내, 수정 화면이 돌아갈 곳을 알게 한다.
 */
export function quoteEditHref(input: { quoteId: string; repairCaseId: string | null }): string {
  if (input.repairCaseId === null) return `/quotes/${input.quoteId}`;
  const params = new URLSearchParams({ [QUOTE_NEW_REPAIR_CASE_PARAM]: input.repairCaseId });
  return `/quotes/${input.quoteId}?${params.toString()}`;
}

/**
 * 주소에 실려 온 건 id 를 **믿어도 되는가**. 위 머리말의 세 조건을 모두 넘으면
 * 그 건의 id — **DB 가 준 값**(`quote.repairCaseId`) — 를, 하나라도 못 넘으면
 * null 을 돌려준다.
 *
 * 🔴 이 판정은 **여기 한 곳에만** 적는다. 수정 화면의 [취소](returnHrefForEditQuote)
 * 와 인쇄 화면의 「돌아가기」(returnHrefForQuotePrint)가 둘 다 이것을 부른다 — 두
 * 벌로 적어 두면 언젠가 한쪽만 느슨해지고, 그쪽이 손으로 바꾼 링크를 남의 건으로
 * 보내는 문이 된다.
 */
export function trustedLinkedRepairCaseId(
  searchParams: SearchParamsInput | undefined,
  quote: { repairCaseId: string | null }
): string | null {
  const linked = firstValue(searchParams?.[QUOTE_NEW_REPAIR_CASE_PARAM]);
  if (!UUID_PATTERN.test(linked)) return null;
  if (quote.repairCaseId === null) return null;
  // UUID 는 대소문자를 가리지 않는다. 같은 건인지는 글자 모양이 아니라 값으로 본다.
  if (linked.toLowerCase() !== quote.repairCaseId.toLowerCase()) return null;
  return quote.repairCaseId;
}

/**
 * 수정 화면이 [취소] 뒤에 돌아갈 곳. 위 머리말의 세 조건을 모두 넘으면 그 건의
 * 「견적서」 탭, 아니면 null 이다(그때는 지금까지와 똑같이 `/quotes`).
 */
export function returnHrefForEditQuote(
  searchParams: SearchParamsInput | undefined,
  quote: { repairCaseId: string | null }
): string | null {
  const repairCaseId = trustedLinkedRepairCaseId(searchParams, quote);
  return repairCaseId === null ? null : repairCaseDetailHrefs(repairCaseId).quotes;
}

/**
 * ============================================================================
 * 수리 건 → 견적서 **인쇄 화면** → 수정 화면 → 다시 그 건
 * ============================================================================
 * 「견적서」 탭의 [미리보기 · PDF] 는 독립 페이지 `/quotes/{id}/print` 로 간다. 그
 * 화면의 「← 견적서로 돌아가기」가 맨 주소 `/quotes/{id}` 로 가면 건 id 가 거기서
 * 떨어지고, 이어서 수정 화면의 [취소]가 `/quotes` 로 떨어진다 — 위 수정 화면이
 * 고친 그 일이 한 화면 건너서 다시 생긴다.
 *
 * 그래서 인쇄 주소에도 **같은 이름**(`repairCaseId`)으로 건 id 하나를 싣고, 인쇄
 * 화면은 그것을 **수정 화면과 똑같은 판정**(trustedLinkedRepairCaseId)으로 걸러
 * 돌아갈 수정 화면 주소에 다시 싣는다. 판정을 넘으면 수정 화면이 받는 값은 DB 가
 * 준 id 이므로, 거기서도 같은 판정을 그대로 넘는다.
 * ============================================================================
 */

/**
 * 목록의 [미리보기 · PDF] 가 여는 인쇄 화면 주소. 접수 건이 없으면(null) **지금까지의
 * 그 주소 그대로**다 — PO/내자 목록은 한 글자도 달라지지 않는다.
 */
export function quotePrintHref(input: { quoteId: string; repairCaseId: string | null }): string {
  if (input.repairCaseId === null) return `/quotes/${input.quoteId}/print`;
  const params = new URLSearchParams({ [QUOTE_NEW_REPAIR_CASE_PARAM]: input.repairCaseId });
  return `/quotes/${input.quoteId}/print?${params.toString()}`;
}

/**
 * 인쇄 화면의 「← 견적서로 돌아가기」가 갈 곳. 주소의 건 id 가 판정을 넘으면
 * **그 건을 실은 수정 화면 주소**, 아니면 지금까지의 `/quotes/{id}` 그대로다.
 * 언제나 주소가 있다(null 이 아니다) — 돌아갈 견적서 자체는 늘 있기 때문이다.
 */
export function returnHrefForQuotePrint(
  searchParams: SearchParamsInput | undefined,
  quote: { id: string; repairCaseId: string | null }
): string {
  return quoteEditHref({
    quoteId: quote.id,
    repairCaseId: trustedLinkedRepairCaseId(searchParams, quote),
  });
}

function firstValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return (value[0] ?? "").trim();
  return (value ?? "").trim();
}
