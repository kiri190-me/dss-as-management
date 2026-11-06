/**
 * ============================================================================
 * 내자 정리의 **보여 주는 말** — 빈 값 표시 · 금액 서식 · 입금 여부 · 안내 두 줄
 * ============================================================================
 * 전부 **DomesticOrderListScreen.tsx 안에 있던 것**을 옮겨 온 것이다(2026-11-06).
 * 한 글자도 바꾸지 않았다 — 옮긴 까닭 하나뿐이다.
 *
 * ── 왜 옮겼나 ───────────────────────────────────────────────────────────
 * 「기타건 상세」(`/domestic-orders/{id}`)가 생기면서 **같은 줄을 그리는 화면이
 * 둘**이 됐다. 그런데 목록 화면은 `"use client"` 라, 거기서 내보낸 함수를 상세의
 * 서버 컴포넌트가 부르면 그 자리에서 터진다("Attempted to call … from the
 * server" — repair-cases/[id]/quotes/page.tsx 머리말의 같은 사정). 그렇다고
 * 상세 쪽에 `dash` 와 금액 서식을 한 벌 더 적으면, 같은 자료가 두 화면에서 다른
 * 글자로 보이는 날이 온다 — 이 저장소가 이미 겪은 고장이다(같은 말이 사이트와
 * 공용 묶음에 나뉘어 정의돼 타입이 같아 tsc 가 침묵했다).
 *
 * 그래서 **순수 함수만 모아 중립 자리로** 내렸다. React 도 DB 도 들어오지 않으므로
 * 서버 컴포넌트도 클라이언트 컴포넌트도 똑같이 부를 수 있다.
 *
 * 🔴 **이름을 바꾸지 않았다.** `formatAmount` · `dash` 그대로다 — 목록 화면의
 * 생김새를 글자로 지키는 시험(domestic-order-inline-cells.test.ts)이 호출부를
 * `{formatAmount(row.displayAmountExcludingVat)}` 처럼 **그대로 맞대어 보기**
 * 때문이고, 이름을 바꾸면 그 시험이 「금액 칸에 편집이 생겼다」는 엉뚱한 말로
 * 깨진다.
 * ============================================================================
 */

/**
 * 발주일이 아직 없는 줄의 발주발행일 칸에 적는 말. "-"(그냥 빈 값)와 구분한다 —
 * 목록에서는 이 줄이 년도와 상관없이 늘 보이는 이유가 바로 이 칸이기 때문이다.
 *
 * 🔵 상세 화면에는 년도 고르개가 없지만 **같은 글자를 쓴다.** 뜻이 "아직 발주가
 * 나지 않았다"로 같은데 화면마다 "-"와 "발주일 미정"으로 갈리면, 같은 줄을 두 곳에서
 * 본 사람이 둘을 다른 상태로 읽는다.
 */
export const NO_ORDER_DATE_LABEL = "발주일 미정";

/**
 * `납품일` 칸이 무엇이고 왜 비어 있을 수 있는지. **한 글자를 여러 곳이 나눠
 * 쓴다** — 목록의 표 위 한 줄, 표 머리말의 title, 카드 이름표의 title, 그리고
 * 기타건 상세의 같은 칸. 따로 적으면 언젠가 한쪽만 고쳐져 같은 칸이 화면마다
 * 다른 규칙으로 설명된다.
 *
 * 말투는 내자 정리 화면의 다른 안내(`발주일 미정 N건은 … 함께 보입니다`)와 맞춘다.
 */
export const DELIVERED_DATE_NOTE =
  "납품일은 연결된 수리 건의 실제 출하일입니다. 연결이 없는 줄은 직접 적은 날짜이고, 아직 출하되지 않은 줄은 비어 있습니다.";

/** 빈 값의 표시. 내자 정리의 모든 화면·모든 칸이 같은 글자를 쓴다. */
export function dash(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "-";
  if (typeof value === "number") return String(value);
  return value.trim() === "" ? "-" : value;
}

/**
 * "1234567.00" → 123456700(전 단위 정수). 형식이 어긋나면 null 이고, 그 행은
 * 합계에서 조용히 빠지는 대신 화면에 원문 그대로 보인다 — 잘못된 값을 0으로
 * 세면 합계가 맞는 것처럼 보이기만 한다.
 *
 * BigInt 를 쓰지 않는 이유는 tsconfig 의 target 이 ES2017 이라 BigInt 리터럴이
 * 컴파일되지 않아서다. 대신 **정수만 다룬다** — 소수점을 없애 놓고 더하므로
 * 0.1 + 0.2 류의 오차가 애초에 생기지 않는다. 자바스크립트의 number 는
 * 2^53-1(약 90조 전 = 9000억 원)까지 정수를 정확히 담으므로 이 표의 금액에는
 * 남는다. 그 위로 넘어가면 정확성을 보장할 수 없으므로 null 로 돌려보내
 * 합계에서 빼고 화면에는 원문을 보여 준다.
 */
export function toMinorUnits(value: string): number | null {
  const matched = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!matched) return null;
  const sign = matched[1] === "-" ? -1 : 1;
  const whole = Number(matched[2]);
  const fraction = Number((matched[3] ?? "0").padEnd(2, "0"));
  const minor = sign * (whole * 100 + fraction);
  return Number.isSafeInteger(minor) ? minor : null;
}

function groupDigits(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** 전 단위 정수를 사람이 읽는 금액으로. 소수점 이하가 0이면 적지 않는다. */
export function formatMinorUnits(minor: number): string {
  const isNegative = minor < 0;
  const absolute = Math.abs(minor);
  const whole = Math.floor(absolute / 100);
  const fraction = absolute % 100;
  const body =
    fraction === 0
      ? groupDigits(String(whole))
      : `${groupDigits(String(whole))}.${String(fraction).padStart(2, "0")}`;
  return isNegative ? `-${body}` : body;
}

export function formatAmount(value: string | null): string {
  if (value === null) return "-";
  const minor = toMinorUnits(value);
  // 파싱에 실패하면 원문을 그대로 보여 준다. 숨기면 이상한 값이 들어와 있다는
  // 사실 자체가 화면에서 사라진다.
  return minor === null ? value : formatMinorUnits(minor);
}

/** 입금완료 여부 — boolean 을 시트의 말로 되돌린다. */
export function paymentLabel(completed: boolean): string {
  return completed ? "완료" : "미완료";
}
