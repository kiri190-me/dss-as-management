import { dash } from "@/lib/domain/domestic-order-display";
import {
  DELIVERED_DATE_FROM_REPAIR_CASE_LABEL,
  DOMESTIC_ORDER_DELIVERED_DATE_NOTE,
} from "@/lib/domain/delivered-date-link";

/**
 * ============================================================================
 * `납품일` · `납품자` 칸에 그리는 것 — **세 화면이 나눠 쓰는 한 벌** (2026-11-08)
 * ============================================================================
 * 쓰는 곳이 셋이다: 내자 정리의 표와 카드(DomesticOrderListScreen), 기타건 현황의
 * 표와 카드(misc-case-fields.tsx). 🔴 **각자 적으면 한쪽만 고쳐져, 같은 줄이 화면
 * 폭과 메뉴에 따라 다른 글자로 보인다** — 내자 정리가 이미 겪고 적어 둔 함정이다
 * (그 파일의 표/카드 원칙).
 *
 * ── 🔴 두 칸은 **자리가 맞아야 읽힌다** ─────────────────────────────────
 * 날짜도 사람도 **납기요청일 행마다 하나씩**이고, 두 목록은 길이가 같다
 * (domain/delivered-date-link.ts 의 resolveDomesticOrderDeliveryDisplay 가 둘을
 * 함께 내놓는 까닭). 그래서 여기서는 **거르지 않는다** — 안 적은 회차도 "-" 한
 * 줄을 차지해야 1번 줄의 납기요청일 옆이 1번 줄의 납품일로 읽힌다. 비어 있는 줄을
 * 빼면 두 칸의 줄 수가 달라져 **아래로 갈수록 엉뚱한 회차끼리 나란히 선다.**
 *
 * ── 줄바꿈을 CSS 에 맡기지 않는다 ───────────────────────────────────────
 * 줄 전체에 `whitespace-nowrap` 이 걸려 있어 `\n` 으로는 줄이 안 나뉜다. 그래서
 * 납기요청일 칸과 **같은 방식으로** block 짜리 `<span>` 을 쌓는다 — `<div>` 가
 * 아닌 것은 고칠 수 있는 사람에게 이 줄들이 눌러서 여는 `<button>` 안에 들어가기
 * 때문이다(버튼 안에는 구문 요소만 둘 수 있다).
 * ============================================================================
 */

/**
 * 빌려 온 값 옆에 붙는 꼬리표의 모양. 🔴 **납기요청일 꼬리표와 같은 모양이어야
 * 한다** — 한 줄 안에 생김새가 다른 꼬리표가 둘 있으면 다른 뜻으로 읽힌다. 그래서
 * 글자를 두 곳에 적지 않고 이 상수를 양쪽이 가져다 쓴다(DomesticOrderListScreen 의
 * 납기요청일 칸도 이것을 쓴다).
 */
export const borrowedBadgeClass =
  "ml-1.5 rounded border border-zinc-300 px-1 py-0.5 text-[11px] leading-none font-normal text-zinc-500 dark:border-zinc-600 dark:text-zinc-400";

/**
 * 이 두 부품이 **실제로 보는 칸만** 요구한다 — 조회의 전체 행 타입을 끌어오지
 * 않는다(이 저장소의 도메인 파일들이 쓰는 규칙 그대로). 🔴 옛 칼럼
 * (`deliveredDate`·`deliveredBy`)이 이 타입에 **없는 것**이 「A/S 는 옛 자리를
 * 안 그린다」를 코드로 못 박는 자리다.
 */
export type DeliveredCellRow = {
  deliveredDateLines: readonly (string | null)[];
  deliveredByLines: readonly (string | null)[];
  deliveredDateBorrowed: boolean;
};

/**
 * `납품일` 칸. 행마다 한 줄이고, 아무 행에도 안 적혀 있으면 연결된 수리 건의 실제
 * 출하일 **한 줄**에 꼬리표가 붙는다.
 *
 * ⚠️ 꼬리표는 **빌려 왔을 때만** 붙고, 그때 줄은 언제나 하나다(수리 건의 그 칸은
 * 날짜 하나다) — 그래서 꼬리표가 두 번 그려질 일이 없다. 꼬리표에 title 이 붙는 것은
 * 그 표시가 무슨 뜻인지 보이는 글자만으로 다 말할 수 없기 때문이다.
 */
export function DeliveredDateCellContent({ row }: { row: DeliveredCellRow }) {
  if (row.deliveredDateLines.length === 0) return <>{dash(null)}</>;
  return (
    <>
      {row.deliveredDateLines.map((line, index) => (
        // 같은 날짜가 두 회차에 적힐 수 있어(사람이 적는 값이다) 글자를 key 로 쓰지
        // 않는다. 이 목록은 다시 정렬되지 않으므로 차례가 곧 신원이다.
        <span key={index} className="block">
          {dash(line)}
          {row.deliveredDateBorrowed && (
            <span className={borrowedBadgeClass} title={DOMESTIC_ORDER_DELIVERED_DATE_NOTE}>
              {DELIVERED_DATE_FROM_REPAIR_CASE_LABEL}
            </span>
          )}
        </span>
      ))}
    </>
  );
}

/**
 * `납품자` 칸. 위와 **같은 차례·같은 줄 수**다(파일 헤더의 '자리가 맞아야 읽힌다').
 *
 * 🔵 **꼬리표가 없다** — 빌려 오는 값은 날짜뿐이고(수리 건에는 「누가 보냈는가」가
 * 없다), 그때 이 칸은 "-" 한 줄이다. 거기에 「수리 건 출하일」을 붙이면 **없는 값의
 * 출처**를 말하는 셈이 된다.
 */
export function DeliveredByCellContent({ row }: { row: DeliveredCellRow }) {
  if (row.deliveredByLines.length === 0) return <>{dash(null)}</>;
  return (
    <>
      {row.deliveredByLines.map((line, index) => (
        <span key={index} className="block">
          {dash(line)}
        </span>
      ))}
    </>
  );
}
