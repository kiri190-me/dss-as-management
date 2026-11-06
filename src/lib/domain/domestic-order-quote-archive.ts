import { quoteArchiveYearFromDate } from "./quote-archive-naming";

/**
 * ============================================================================
 * 기타건(내자 정리 한 줄)의 **견적서 공유폴더를 무엇으로 찾는가** (순수 — 파일시스템 없음)
 * ============================================================================
 * 기타건 상세의 「견적서」 탭에는 갈래가 둘이다(사용자 결정 2026-11-06):
 *
 *   · 시스템 견적서가 **있는** 줄 → 수리 건 탭과 똑같이 목록 + 그 견적서 id 로 폴더
 *   · 시스템 견적서가 **없는** 줄 → 🔴 **내자 정리에 적힌 견적서번호로 폴더만** 찾는다
 *
 * 이 파일은 둘째 갈래가 쓰는 **재료 두 개**(번호 · 연도 폴더를 정할 날짜)를 한 줄에서
 * 꺼내는 일만 한다. 🔴 **폴더를 찾는 규칙은 여기 없다** — 연도 폴더를 고르는 것도
 * (isQuoteArchiveYearFolder), 견적서 폴더를 고르는 것도(matchesQuoteArchiveFolder) 전부
 * storage/quote-archive.ts 한 벌이다. 여기서 한 글자라도 베끼면 「화면이 찾는 폴더」와
 * 「저장이 쓰는 폴더」가 갈라지는 날이 온다 — 이 저장소가 이미 겪은 고장이다.
 *
 * ── 🔴 왜 날짜가 필요한가 ───────────────────────────────────────────────
 * 공유폴더는 `<연도 폴더>/<견적서 폴더>` 두 단이고, 연도 폴더를 정하는 것은
 * **발행일자**다(quoteArchiveYearFromDate). 시스템 견적서가 있으면 그 장의 발행일자를
 * 쓰지만, 기타건에는 그 장이 없다 — 그래서 아래 두 걸음으로 정한다.
 *
 *   ① 내자 정리에 적힌 **견적발행일**(displayQuoteIssuedDate)이 날짜 모양이면 그것.
 *      🔴 이것이 **먼저**다 — 저장 쪽이 연도 폴더를 고를 때 보는 것이 발행일자이고,
 *      해를 넘겨 발행한 건(번호는 작년 것, 발행은 올해)은 발행일자 쪽 폴더에 있다.
 *   ② 견적발행일이 비었거나 날짜 모양이 아니면 **번호에 박힌 네 자리 연도**로 때운다
 *      (`DSS 2026-089` → 2026). 실측상 사내 번호는 모두 「… YYYY-일련번호」 꼴이고,
 *      그 해의 연도 폴더에 폴더가 서 있다.
 *      🔴 때우는 값은 **연도 폴더를 고르는 데만 쓰는 가짜 날짜**(`YYYY-01-01`)이고,
 *      그것조차 **기존 규칙(quoteArchiveYearFromDate)에 통과시켜** 쓴다 — 연도의 범위
 *      판정을 여기서 다시 적지 않는다. 날짜가 화면에 나가는 일은 없다.
 *
 * 🔴 **틀릴 때의 방향**: 연도를 잘못 짚으면 그 해 폴더에서 번호가 맞는 폴더를 못 찾아
 * 「아직 폴더가 없습니다」가 된다 — 남의 폴더를 여는 일은 일어나지 않는다. 견적서 폴더를
 * 고르는 두 번째 걸음이 **번호**로 한 번 더 거르기 때문이다.
 *
 * ── 🔴 번호를 화면에서 받지 않는다 ─────────────────────────────────────
 * 이 함수가 받는 것은 **내자 줄 그 자체**다. 통로(api/domestic-orders/[id]/
 * quote-archive-folder/entries)는 줄 id 만 받고 번호를 이 함수로 꺼낸다 — 번호를 요청에
 * 실어 보내게 만들면 내자 정리를 볼 수 있는 사람이 **아무 견적서 번호나 넣어 남의 폴더를
 * 들여다볼 수 있다.**
 * ============================================================================
 */

/** 찾는 데 필요한 칸만. 🔴 **화면에 그려지는 값**(display*)이다 — 아래 머리말 참고. */
export type DomesticOrderQuoteArchiveRow = {
  /**
   * 🔴 원본 칸(quoteNumber)이 아니라 **화면에 그려지는 번호**다. 연결된 견적서가 살아
   * 있으면 그 장의 번호이고, 연결이 없거나 그 장이 휴지통에 있으면 이 줄에 손으로 적은
   * 번호다(queries/domestic-orders.ts 의 displayQuoteNumber). 사람이 화면에서 보고 있는
   * 번호와 **같은 폴더**를 열어야 하므로 이쪽을 본다.
   */
  displayQuoteNumber: string | null;
  /** 같은 까닭으로 **화면에 그려지는 발행일**. `"YYYY-MM-DD"` 아니면 null. */
  displayQuoteIssuedDate: string | null;
};

export type DomesticOrderQuoteArchiveLookup =
  /** 찾아볼 수 있다 — 이 둘을 그대로 저장소 모듈에 넘긴다. */
  | { status: "ready"; quoteNumber: string; quoteDate: string }
  /** 🔴 번호가 아예 없다 — 찾을 열쇠가 없다. 공유폴더를 보지 않는다. */
  | { status: "no-quote-number" }
  /**
   * 번호는 있는데 **연도 폴더를 정할 수 없다**(견적발행일이 비었고 번호에도 연도가 없다 —
   * `Q-7` 같은 번호가 개발 DB 에 실제로 있다). 공유폴더를 보지 않는다.
   */
  | { status: "no-quote-date"; quoteNumber: string };

/** 적혀 있는 글자인가 — 공백만 있는 칸도 빈 것으로 본다. */
function filled(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * 번호에 박힌 **네 자리 연도**. 「네 자리 숫자 - 숫자」 모양의 앞머리를 본다 —
 * `DSS 2026-089` · `DSS2026-089`(공백을 빠뜨린 실측 번호) · `QT-2024-115` 가 모두 걸린다.
 * 그런 자리가 없으면 null 이고(`Q-7`), 그때는 연도 폴더를 정할 수 없다.
 *
 * 🔴 **가지 번호를 떼지 않는다** — 여기서 보는 것은 연도뿐이고, 본 번호를 뽑는 일은
 * 폴더를 찾는 쪽(quoteArchiveBaseNumber)의 몫이다.
 */
function yearInQuoteNumber(quoteNumber: string): number | null {
  const match = /(?:^|\D)(\d{4})-\d/.exec(quoteNumber);
  return match ? Number(match[1]) : null;
}

/**
 * 이 줄의 견적서 공유폴더를 **무엇으로 찾을지** 정한다. 던지지 않는다.
 *
 * 🔴 돌려주는 `quoteDate` 는 **연도 폴더를 고르는 재료**일 뿐이다 — 화면에 날짜로
 * 그리지 마라(견적발행일이 비었으면 `YYYY-01-01` 이라는 때운 값이 들어 있다).
 */
export function resolveDomesticOrderQuoteArchiveLookup(
  row: DomesticOrderQuoteArchiveRow
): DomesticOrderQuoteArchiveLookup {
  const quoteNumber = filled(row?.displayQuoteNumber);
  if (quoteNumber === "") return { status: "no-quote-number" };

  // ① 내자 정리에 적힌 견적발행일이 먼저다 — 저장 쪽이 연도 폴더를 고를 때 보는 값과 같다.
  const issuedDate = filled(row.displayQuoteIssuedDate);
  if (quoteArchiveYearFromDate(issuedDate) !== null) {
    return { status: "ready", quoteNumber, quoteDate: issuedDate };
  }

  // ② 비었으면 번호의 연도로 때운다. 🔴 때운 날짜도 **같은 규칙에 통과시켜** 쓴다.
  const year = yearInQuoteNumber(quoteNumber);
  const fallback = year === null ? "" : `${String(year).padStart(4, "0")}-01-01`;
  if (quoteArchiveYearFromDate(fallback) !== null) {
    return { status: "ready", quoteNumber, quoteDate: fallback };
  }

  return { status: "no-quote-date", quoteNumber };
}

// ── 문장 ─────────────────────────────────────────────────────────────────
//
// 🔴 **화면 둘이 같은 글자를 쓴다** — 탭 페이지(서버)가 보여 주는 안내와, 통로가 같은
// 판정을 내렸을 때 구역이 내는 한 줄. 두 벌로 적으면 같은 상황에서 다른 말을 하게 된다.

/**
 * 🔴 시스템 견적서가 없어 **번호로 폴더만** 찾은 줄에 다는 설명. 목록이 비어 있는 까닭을
 * 적지 않으면 사람은 「견적서가 사라졌다」로 읽는다 — 여기서는 애초에 만든 적이 없는
 * 줄이고, 공유폴더에는 사람이 넣어 둔 서류가 있다.
 */
export function domesticOrderQuoteArchiveOnlyText(quoteNumber: string): string {
  return `시스템에서 만든 견적서가 없는 줄입니다 — 내자 정리에 적힌 견적서번호 「${quoteNumber}」로 공유폴더만 찾았습니다.`;
}

/**
 * 🔴 번호조차 없는 줄. **조용한 빈 화면으로 두지 않는다**(사용자가 탭이 깨졌다고 읽는다).
 * 무엇이 없어서 못 찾는지와, 어디에 적으면 찾기 시작하는지를 함께 적는다.
 */
export const DOMESTIC_ORDER_QUOTE_ARCHIVE_NO_NUMBER_TEXT =
  "이 줄에는 연결된 견적서도, 내자 정리에 적힌 견적서번호도 없습니다 — 번호가 적히면 그때 공유폴더를 찾습니다.";

/**
 * 번호는 있는데 연도 폴더를 정할 수 없는 줄. 🔴 「없다」가 아니라 **아직 못 찾는다**라고
 * 적는다 — 공유폴더를 보지도 않았으므로 폴더가 있는지 없는지 이쪽은 모른다.
 */
export function domesticOrderQuoteArchiveNoDateText(quoteNumber: string): string {
  return `견적서번호 「${quoteNumber}」만 있고 견적발행일이 비어 있어 공유폴더의 연도 폴더를 정할 수 없습니다 — 내자 정리에 견적발행일이 적히면 그때 찾습니다.`;
}
