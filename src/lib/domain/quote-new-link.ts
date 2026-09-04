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

function firstValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return (value[0] ?? "").trim();
  return (value ?? "").trim();
}
