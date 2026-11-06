import { normalizeEntityName, rankSimilarNames } from "@/lib/domain/entity-name-match";

/**
 * ============================================================================
 * 견적서의 **공급처 칸** — 고르거나 새로 적는다 (2026-11-06)
 * ============================================================================
 * 전에는 자유 입력 하나였다. 글자는 저장되지만(`quotes.customer_name_text`)
 * **고객사 마스터와 이어지지 않아서**(`quotes.customer_id`), 같은 회사가 화면마다
 * 다른 글자로 남았다 — 개발 DB 의 기타 견적서 한 장이 `아이씨디` 인데 마스터에는
 * `ICD Co.,Ltd.` 로 따로 서 있는 것이 그 꼴이다.
 *
 * 🔴 그때까지 `customer_id` 가 채워지는 길은 **인수번호로 불러오기 하나뿐**이었고,
 *    그 구역은 기타 견적서(CABLE)에 **아예 없다**(QuoteEditForm 의 `{!isCable && (`).
 *    그래서 기타 견적서는 구조적으로 영영 안 이어졌다.
 *
 * ── 🔴 접수 화면과 **같은 규율**이다 ────────────────────────────────────
 * 모양도 규칙도 A/S 접수의 고객사 칸에서 그대로 가져왔다
 * (components/repair-cases/new/IntakeFormInner.tsx 의 385-411행 주석):
 *
 *  ① 제안은 비슷한 이름 여덟 줄(`rankSimilarNames`). 고르개는 `<datalist>` 라
 *     **자유 입력을 막지 않는다** — 목록에 없는 거래처로 한 장 내는 일이 있다.
 *  ② **정확히 일치할 때만** 자동으로 이어 붙인다. 부분 일치로 붙이면 `대성` 을
 *     치는 동안 `대성전기` 에 조용히 붙고, 그 장은 끝까지 틀린 채로 나간다.
 *  ③ 없는 이름이면 **단추를 눌러야** 새 고객사가 된다. 글자를 칠 때마다 만들면
 *     오타 한 번에 마스터가 늘어나고, 지우는 권한은 관리자에게만 있다.
 *  ④ 켠 뒤 **취소할 수 있다**.
 *
 * ── 🔴 「같다」의 자는 **DB 의 고유 제약과 같은 것**이어야 한다 ──────────
 * `customers_normalized_name_unique`(drizzle/0022) 는
 *   `lower(regexp_replace(btrim("name"), '\s+', ' ', 'g')) WHERE is_deleted = false`
 * 이고, 그것을 TypeScript 로 적어 둔 것이 `normalizeEntityName` 이다. 화면이 다른
 * 자로 재면 **대소문자만 다른 이름에 「새로 등록」 단추가 떠서**, 눌러 저장하는 순간
 * 제약에 걸려 터진다. 그래서 여기서는 그 함수를 **부른다** — 접기 규칙을 새로 적지
 * 않는다(그 사실을 quote-customer-pick.test.ts 가 값으로 못 박는다).
 *
 * ── 🔴 **이어지지 않아도 저장은 된다** ──────────────────────────────────
 * 단추를 누르지 않고 그냥 저장하면 지금까지와 똑같다: 글자만 남고 `customer_id` 는
 * 비어 있다. 막지 않는 것은 승인된 결정이다 — validation/quote-input.ts 의
 * 「마스터에 없는 거래처로 한 장 내는 일이 있어서 id 는 비어도 된다」.
 * 이 조각은 **이을 길을 더한 것**이지 자유 입력을 걷어낸 것이 아니다.
 *
 * ── 🔴 **견적서 갈래 셋이 한 칸을 함께 쓴다** ───────────────────────────
 * 내자 · OH · 기타(DOMESTIC · OVERHAUL · CABLE)가 **똑같이** 이 규칙을 탄다.
 * 갈래마다 다르게 굴면 한 칸이 두 얼굴이 되고, 사람은 어느 화면에서 무엇이
 * 일어나는지 외워야 한다. 다만 **인수번호로 불러온 연결은 갈래와 무관하게 이긴다** —
 * 아래 `quoteCustomerIntakePatch` 가 그 자리다.
 *
 * 🔴 **DB 도 서버도 여기서 만지지 않는다.** 실제로 고객사를 만드는 일은 저장
 * 트랜잭션 안(`mutations/quotes.ts` → `resolveOrCreateCustomerByName`)에서 한 번만
 * 일어난다. 이 파일이 정하는 것은 **무엇을 보내는가**까지다.
 * ============================================================================
 */

/**
 * 제안으로 내미는 줄 수. 접수 폼의 `MAX_SUGGESTIONS` 와 같은 여덟이다 — 숫자를
 * 맞추려는 것이 아니라, `<datalist>` 가 한눈에 읽히는 길이가 그쯤이기 때문이다.
 */
export const MAX_QUOTE_CUSTOMER_SUGGESTIONS = 8;

/**
 * 고를 수 있는 고객사 한 줄.
 *
 * 🔴 **모양만 받는다** — 목록을 만드는 조회는 `queries/domestic-orders.ts` 의
 * `listCustomerOptions` 이고, 그 파일은 `server-only` 라 여기서 형까지 끌어오지
 * 않는다(이 모듈은 브라우저에서 돈다). 두 모양이 어긋나면 넘겨주는 자리(견적서
 * 페이지 둘)에서 tsc 가 막는다.
 */
export type QuoteCustomerOption = { id: string; name: string };

/**
 * 공급처 칸이 들고 있는 값 셋. 폼은 이것을 `useState` 셋으로 나눠 들고 있지만,
 * **바뀌는 규칙은 늘 셋이 한 벌**이라 여기서는 한 묶음으로 다룬다 — 하나만 고치는
 * 길이 생기면 「이름은 바뀌었는데 연결은 옛 회사를 가리키는」 상태가 만들어진다.
 */
export type QuoteCustomerPick = {
  /** 이어 붙은 고객사(`quotes.customer_id`). 안 이어졌으면 null. */
  customerId: string | null;
  /** 종이에 찍히는 글자(`quotes.customer_name_text`). 연결이 있어도 이 값이 나간다. */
  customerNameText: string;
  /** 「새 고객사로 등록」을 **눌렀는가**. 누르기 전에는 아무것도 만들지 않는다. */
  customerCreateNew: boolean;
};

/**
 * 칸 아래에 무엇을 보일지 — 화면이 가르지 않고 이 함수 하나가 답한다.
 *
 *  · `EMPTY`      — 아직 아무것도 안 적었다. 보일 것이 없다.
 *  · `LINKED`     — 등록된 고객사와 이어졌다.
 *  · `CREATE_NEW` — 「새 고객사로 등록」을 눌러 뒀다(취소할 수 있다).
 *  · `UNLINKED`   — 이름은 적혔는데 마스터에 없다. 등록 단추를 내민다.
 */
export type QuoteCustomerPickState = "EMPTY" | "LINKED" | "CREATE_NEW" | "UNLINKED";

/**
 * 칸에 내밀 제안. 빈 글자에는 **전체가 이름순으로** 온다(rankSimilarNames) —
 * 고르개를 처음 열었을 때 훑어볼 것이 있어야 한다.
 */
export function quoteCustomerSuggestions(
  text: string,
  options: readonly QuoteCustomerOption[]
): QuoteCustomerOption[] {
  return rankSimilarNames(text, options).slice(0, MAX_QUOTE_CUSTOMER_SUGGESTIONS);
}

/**
 * 칸에 글자를 쳤다(= [엑셀 값으로 바꾸기]도 같은 길이다 — 견적서 ①b).
 *
 * 🔴 **정확히 일치할 때만** 이어 붙인다(머리말 ②). 일치가 풀리면 연결도 함께
 * 풀린다 — 이름과 id 가 서로 다른 곳을 가리키는 상태를 만들지 않는다(전에 이 칸이
 * 「글자를 고치면 무조건 연결을 끊는다」였던 것과 뜻이 같고, 달라진 것은 **다시
 * 맞으면 다시 붙는다**는 쪽 하나다).
 *
 * 🔴 **눌러 둔 「새로 등록」은 꺼진다.** 그 의사는 그때 적혀 있던 이름에 대한
 * 것이라, 글자가 달라지면 더는 그 이름이 아니다.
 *
 * 🔵 빈 글자는 **아무것과도 맞지 않는다.** 이름이 빈 고객사는 있을 수 없지만
 * (NOT NULL · trim), 접는 자가 `""` 를 내놓는 자리라 여기서 한 번 막아 둔다 —
 * 막지 않으면 칸을 비우는 순간 엉뚱한 줄에 붙을 길이 생긴다.
 */
export function quoteCustomerNameEditPatch(
  text: string,
  options: readonly QuoteCustomerOption[]
): QuoteCustomerPick {
  const normalized = normalizeEntityName(text);
  const match =
    normalized === "" ? undefined : options.find((option) => normalizeEntityName(option.name) === normalized);
  return {
    customerId: match?.id ?? null,
    customerNameText: text,
    customerCreateNew: false,
  };
}

/**
 * 인수번호로 불러왔을 때 공급처 칸에 할 일.
 *
 * 🔴 **이름 칸은 `null` 이면 손대지 않는다**(아래 함수의 그 항목). 그래서 이 모양은
 * `QuoteCustomerPick` 이 아니다 — 「빈 글자로 덮는다」와 「건드리지 않는다」를 한 칸에
 * 담으면 둘을 가를 수 없고, 가르지 못하면 손으로 적어 둔 공급처가 사라진다.
 */
export type QuoteCustomerIntakePatch = {
  customerId: string | null;
  /** 🔴 `null` 이면 **칸의 글자를 그대로 둔다.** */
  customerNameText: string | null;
  customerCreateNew: boolean;
};

/**
 * 🔴 **인수번호로 불러왔다 — 그 연결이 이긴다.**
 *
 * 접수 건이 가리키는 고객사의 id 를 **그대로** 받는다. 🔴 고를 수 있는 목록에서
 * 이름으로 다시 찾지 않는다: 그 목록은 휴지통에 든 고객사를 빼고 오므로, 이름으로
 * 되짚으면 **지워진 고객사에 걸린 옛 접수 건의 연결이 조용히 풀린다.** 그 장을
 * 저장하면 `customer_id` 가 비워진 채로 덮인다 — 오류가 아니라 침묵이다.
 *
 * 이름은 **받아 온 것이 있을 때만** 바꾼다(지금까지 그대로다).
 *
 * 🔴 눌러 둔 「새로 등록」은 끈다. 사람이 불러오기를 눌러 공급처를 **갈아 끼운**
 * 것이고, 그 전에 적어 둔 이름으로 고객사를 만들 까닭이 없다.
 */
export function quoteCustomerIntakePatch(found: {
  customerId: string | null;
  customerName: string | null;
}): QuoteCustomerIntakePatch {
  return {
    customerId: found.customerId,
    customerNameText: found.customerName ? found.customerName : null,
    customerCreateNew: false,
  };
}

/**
 * 「새 고객사로 등록」을 눌렀다 · [취소]를 눌렀다.
 *
 * 🔴 **켤 수 있는 자리를 여기서 한 번 더 좁힌다** — 이미 이어졌거나 이름이 비어
 * 있으면 켜지지 않는다. 화면이 그런 자리에 단추를 그리지 않지만, 켜진 채로 남는 길
 * (이어 붙은 뒤에 단추가 사라지는 순서)이 생기면 **이름이 같은 고객사를 한 번 더
 * 만들려 드는** 요청이 나간다.
 */
export function quoteCustomerCreateNewPatch(
  current: QuoteCustomerPick,
  on: boolean
): QuoteCustomerPick {
  return {
    ...current,
    customerCreateNew: on && current.customerId === null && current.customerNameText.trim() !== "",
  };
}

/** 칸 아래에 무엇을 보일지(위 `QuoteCustomerPickState`). */
export function quoteCustomerPickState(pick: QuoteCustomerPick): QuoteCustomerPickState {
  // 🔵 **빈 칸이 먼저다.** 불러오기가 id 만 주고 이름을 못 준 자리에서 「연결됨」이라
  //    말하면, 사람은 비어 있는 칸을 보며 무엇이 연결됐는지 알 수 없다.
  if (pick.customerNameText.trim() === "") return "EMPTY";
  if (pick.customerId !== null) return "LINKED";
  return pick.customerCreateNew ? "CREATE_NEW" : "UNLINKED";
}

/**
 * 저장에 실어 보낼 공급처 값 셋.
 *
 * 🔴 **`newCustomerName` 은 단추를 누른 장에만 실린다**(머리말 ③). 이 한 줄이
 * 「글자를 칠 때마다 고객사를 만들지 않는다」는 규율의 전부다 — 서버는 이 값이
 * 있을 때만 고객사를 찾거나 만든다(mutations/quotes.ts).
 *
 * 🔴 **`customerNameText` 는 연결이 있어도 그대로 보낸다.** 그 글자가 견적서 엑셀의
 * C14 에 찍히는 값이다(xlsx/cable-quote-template.ts) — id 로 대신할 수 없고,
 * 칸 자체도 NOT NULL 이다.
 */
export function quoteCustomerSaveFields(pick: QuoteCustomerPick): {
  customerId: string | null;
  customerNameText: string;
  newCustomerName: string | null;
} {
  return {
    customerId: pick.customerId,
    customerNameText: pick.customerNameText,
    newCustomerName: quoteCustomerPickState(pick) === "CREATE_NEW" ? pick.customerNameText.trim() : null,
  };
}
