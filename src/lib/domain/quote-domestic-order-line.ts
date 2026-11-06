import type { StoredQuoteKind } from "@/lib/validation/quote-input";

/**
 * ============================================================================
 * 🔴 기타 견적서를 **만들면** 내자 정리에 줄이 하나 선다 — 그 판정 (2026-11-06)
 * ============================================================================
 * 사용자 요구 그대로: 「[기타 견적서]로 견적서를 만들면 [내자정리]에 해당 내용으로
 * 줄이 생기도록 해줘. (기타 견적서의 [품명]이 내자정리의 [형식]에 적히면 돼)」
 *
 * 이 파일은 **규칙만** 가진다 — 잠그고 세고 넣는 일은 mutations/
 * quote-domestic-order-line.ts 가 한다. 나누는 까닭은 이 저장소의 관례 그대로다:
 * 「CABLE 일 때만인가」 · 「이미 줄이 있으면 어떻게 하는가」 · 「어느 칸에 무엇이
 * 적히는가」 같은 물음 하나하나에 시험 DB 를 띄우지 않기 위해서다
 * (domain/domestic-order-issue-date-edit.ts · domain/requested-due-date-link.ts 와
 * 같은 자리).
 *
 * ── 🔴 **만들 때 한 번뿐이다** (사용자 결정) ────────────────────────────
 * 그 뒤로 견적서를 고쳐도 내자 줄은 **따라가지 않는다.** 내자 정리는 사람이 손으로
 * 고치는 표이고(화면에 인라인 편집이 있다), 따라가게 만들면 사람이 고쳐 둔 형식 ·
 * 견적발행일 · 공급처를 견적서 저장이 **말없이 덮는다.** 그래서 이 판정을 부르는
 * 자리는 `createQuote` 하나뿐이고, `updateQuote` 는 부르지 않는다 —
 * 그 배선은 mutations/quote-domestic-order-line-source.test.ts 가 글자로 지킨다.
 *
 * ── 🔴 **CABLE(기타 견적서)만** ────────────────────────────────────────
 * 내자 · OH 견적서는 보통 수리 건에서 출발하고, 그 건에는 내자 줄이 이미 있다
 * (수리 건 상세의 발행일 저장이 없으면 만든다 — mutations/
 * domestic-order-issue-dates.ts). 거기에 한 줄을 더 세우면 그 건에 줄이 둘이 되고,
 * 줄이 둘인 건은 발행일 저장이 **통째로 막힌다**(BLOCKED_MULTIPLE). 즉 다른 갈래를
 * 열면 기존 화면 하나가 조용히 잠긴다.
 *
 * 🔴 **열리는 쪽을 적는다**(`=== "CABLE"`). `!== "DOMESTIC"` 처럼 적으면 종류가
 * 하나 더 생기는 날 그 종류가 **조용히 뚫려** 줄이 선다 —
 * domain/quote-document-support.ts 의 APP_TEMPLATE_KINDS 와 같은 방향이다.
 *
 * ── 🔴 **한 견적서에 줄 하나** ──────────────────────────────────────────
 * `domestic_orders.quote_id` 에는 유일 제약이 **없다**(내자 정리 수정 폼의 select 가
 * 기존 줄을 견적서에 이어 붙일 수 있어, 운영에 같은 견적서를 가리키는 줄이 둘 있을
 * 수 있다 — 제약을 거는 마이그레이션은 그 자리에서 터진다). 그래서 DB 가 아니라
 * **부르는 쪽의 잠금 + 이 판정**이 둘째 줄을 막는다.
 *
 * 🔵 **휴지통에 든 줄은 세지 않는다**(`hasLiveLine` 은 살아 있는 줄만). 까닭 둘:
 *  · 화면 어디에도 없는 줄이 「이미 있다」가 되면, 사람은 줄이 없는 내자 정리를
 *    보면서 줄을 만들 길도 없는 상태에 놓인다(mutations/
 *    domestic-order-issue-dates.ts 의 ③ 이 같은 까닭으로 지워진 줄을 세지 않는다).
 *  · DB 의 되짚는 길 자체가 살아 있는 줄만 본다 —
 *    `domestic_orders_quote_id_not_deleted_idx` 가 `is_deleted = false` 부분
 *    인덱스다(schema/domestic-orders.ts). 여기서만 넓게 세면 인덱스와 판정이
 *    서로 다른 「연결」을 말하게 된다.
 *
 * ── 🔴 채우는 칸은 다섯 + 비우는 한 칸이다 ──────────────────────────────
 *  · `quote_id`           — 되찾는 열쇠. 위의 「이미 있는가」도 이 칸으로 센다.
 *  · `model_name_text`    — 🔴 **견적서의 품명(subject)**. 화면의 이름표가 「형식」이다.
 *  · `quote_number`       — 견적서 번호. 공유폴더를 번호로 찾는 자리가 뒤에 온다.
 *  · `quote_issued_date`  — 견적서의 발행일자(quote_date). 화면의 「견적발행일」.
 *  · `customer_id`        — 🔴 **null 일 수 있다.** 견적서는 공급처를 고객사 마스터에
 *                           안 이어도 저장된다(2026-11-06 의 승인된 결정).
 *  · `repair_case_id`     — **null**. 기타 견적서에는 수리 건이 없다.
 *
 * 🔵 `model_name_text` 는 원래 **비워 두면 연결된 수리 건의 형식을 빌려 그리는**
 * 칸이다(schema/domestic-orders.ts 의 '적지 않는 것이 기본'). 기타 건에는 빌려 올
 * 수리 건이 아예 없어 비워 두면 **영영 빈칸**이고, 목록에서 그 줄이 무엇인지 말해
 * 주는 글자가 하나도 없게 된다. 그래서 여기서만은 적는다 — 빌려 올 값을 덮는 것이
 * 아니라, 빌려 올 곳이 없는 자리를 채우는 것이다.
 *
 * 🔴 **나머지 칸은 건드리지 않는다.** 순번(display_order)도 비운다 — 사람이 시트에
 * 적던 표시 순서라 기계가 지어낼 값이 아니고, 기존 두 길도 짓지 않는다
 * (createDomesticOrder 는 폼이 보낸 값을 그대로 쓰고 비면 null 이다 · 발행일 저장은
 * 세 칸만 채운다). 지어내면 사람이 매긴 차례 사이에 끼어든다.
 * ============================================================================
 */

/** 판정에 쓰는 것만. 저장 직후의 견적서 행에서 그대로 집어 온다. */
export type QuoteRowForDomesticOrderLine = {
  id: string;
  /** DB 가 내줄 수 있는 종류 전부를 받는다 — 거르는 것은 아래 판정이다. */
  kind: StoredQuoteKind;
  isDeleted: boolean;
  /** 품명(건명). `NOT NULL` 이라 언제나 글자가 있다(schema/quotes.ts 의 subject). */
  subject: string;
  quoteNumber: string;
  /** 발행일자 "YYYY-MM-DD". date 칸이라 드라이버가 글자로 준다. */
  quoteDate: string;
  customerId: string | null;
};

/**
 * 줄을 **안 만드는** 까닭. 전부 오류가 아니라 정상이다 — 부르는 쪽은 이 값을
 * 돌려주기만 하고 저장을 되돌리지 않는다.
 *
 * 🔴 「조용히 건너뛴다」와 「아무도 모른다」는 다르다. 낱말을 돌려주는 까닭이 그것이다 —
 * 시험이 **무엇 때문에 안 만들었는지**를 값으로 잴 수 있어야, 「CABLE 만」이 깨져도
 * 「줄이 안 생겼다」는 같은 모양으로 통과하지 않는다.
 */
export type QuoteDomesticOrderLineSkipReason =
  | "QUOTE_NOT_FOUND"
  | "QUOTE_DELETED"
  | "KIND_NOT_CABLE"
  | "ALREADY_LINKED";

/**
 * 새 내자 줄에 적히는 값. 🔴 **여기 없는 칸은 한 칸도 건드리지 않는다** —
 * 부르는 쪽이 이 묶음을 그대로 INSERT 에 펼치고, 거기에 더하는 것은 기록용
 * (created_by · updated_by)뿐이다.
 */
export type QuoteDomesticOrderLineValues = {
  quoteId: string;
  /** 🔴 기타 건이다 — 수리 건이 없다. 비우는 것이 아니라 **없음을 적는다.** */
  repairCaseId: null;
  /** 🔴 화면의 「형식」. 견적서의 품명이 그대로 온다(위 머리말). */
  modelNameText: string;
  quoteNumber: string;
  quoteIssuedDate: string;
  /** 🔴 null 이 정상이다 — 안 이어도 저장되는 칸이다. */
  customerId: string | null;
};

export type QuoteDomesticOrderLinePlan =
  | { kind: "SKIP"; reason: QuoteDomesticOrderLineSkipReason }
  | { kind: "CREATE"; values: QuoteDomesticOrderLineValues };

/**
 * 이 견적서에 내자 줄을 세울 것인가, 세운다면 무엇을 적을 것인가.
 *
 * 보는 차례가 곧 뜻이다:
 *  ① 견적서가 없거나 휴지통에 있으면 할 일이 없다.
 *  ② 🔴 **종류가 CABLE 이 아니면 여기서 끝난다** — 기존 두 갈래의 흐름을 건드리지
 *     않기 위한 관문이고, 아래 「이미 있는가」보다 **앞**이다(내자 · OH 견적서가
 *     이미 내자 줄에 걸려 있는 것은 정상이라, 그 사실을 `ALREADY_LINKED` 로
 *     적으면 「CABLE 만」이 깨진 날 그 낱말이 사라지지 않아 시험이 눈치채지 못한다).
 *  ③ 살아 있는 줄이 이미 있으면 **만들지 않는다**(위 머리말의 「한 견적서에 줄 하나」).
 */
export function resolveQuoteDomesticOrderLine(input: {
  quote: QuoteRowForDomesticOrderLine | null;
  /** 이 견적서를 가리키는 **살아 있는** 내자 줄이 있는가. 휴지통은 세지 않는다. */
  hasLiveLine: boolean;
}): QuoteDomesticOrderLinePlan {
  const quote = input.quote;
  if (quote === null) return { kind: "SKIP", reason: "QUOTE_NOT_FOUND" };
  if (quote.isDeleted) return { kind: "SKIP", reason: "QUOTE_DELETED" };
  if (quote.kind !== "CABLE") return { kind: "SKIP", reason: "KIND_NOT_CABLE" };
  if (input.hasLiveLine) return { kind: "SKIP", reason: "ALREADY_LINKED" };

  return {
    kind: "CREATE",
    values: {
      quoteId: quote.id,
      repairCaseId: null,
      modelNameText: quote.subject,
      quoteNumber: quote.quoteNumber,
      quoteIssuedDate: quote.quoteDate,
      customerId: quote.customerId,
    },
  };
}
