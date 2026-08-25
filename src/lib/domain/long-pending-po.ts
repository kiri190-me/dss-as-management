import { addCalendarMonths, toKstDateOnly } from "./date-only";
import {
  isExcludedFromWeeklyReport,
  pickWeeklyReportOrderDates,
  type WeeklyReportOrderDates,
} from "./weekly-report";
import type { RepairStatus } from "./types";

/**
 * ============================================================================
 * 장기 PO 미발행 — 견적서를 낸 지 두 달이 지나도록 발주가 안 난 건
 * ============================================================================
 * 청구가 밀리는 자리라서 한눈에 골라 볼 수 있어야 한다. `전체 A/S 현황`의
 * 체크박스가 이 판정을 쓴다.
 *
 * ── 규칙 (사용자가 확정한 그대로) ───────────────────────────────────────
 *   견적서 발행일이 있고
 *   AND PO(발주) 발행일이 없고
 *   AND 견적일 + 2개월 ≤ 오늘(한국 날짜)
 *   AND 출하 완료된 건이 아니다
 *
 * 두 달은 **달력 기준**이다(addCalendarMonths). 딱 두 달이 되는 날 **당일부터**
 * 걸린다 — `<` 가 아니라 `≤` 인 이유는 사람이 "두 달이 지났다"를 그날부터로
 * 세기 때문이고, 하루 늦추면 그 하루가 왜 비어 있는지 아무도 설명할 수 없다.
 *
 * ── 어느 내자 줄을 보는가는 여기서 정하지 않는다 ────────────────────────
 * 한 접수 건에 내자 줄이 여럿 붙는다(분할 발주·추가 발주). 어느 줄을 볼지는
 * **주간보고가 이미 정해 둔 규칙**을 그대로 부른다 — pickWeeklyReportOrderDates
 * ("발주일이 있는 줄 우선, 하나도 없으면 견적일이 가장 이른 줄"). 여기서 새로
 * 만들면 같은 건이 주간보고에서는 PO 발행 완료인데 이 화면에서는 미발행으로
 * 잡히는 일이 생기고, 그때 어느 쪽이 맞는지 말할 수 없다.
 *
 * 그 함수의 불변식("발주일이 있는 줄이 하나라도 있으면 고른 줄에도 발주일이
 * 있다") 덕분에 **"PO 발행일이 없다"를 고른 줄 하나로 판정할 수 있다** —
 * 발주일이 있는 줄이 하나라도 있으면 이 판정은 반드시 false 다. 그래서 여기서
 * "발주일이 있는 줄이 하나라도 있는가"를 따로 묻지 않는다.
 *
 * '출하 완료' 판정도 같은 이유로 isExcludedFromWeeklyReport 를 그대로 쓴다.
 *
 * ── 오늘은 한국 날짜이고, 부르는 쪽이 정한다 ────────────────────────────
 * 서버가 `now` 를 넘긴다. 화면이 new Date() 로 만들면 서버가 그린 것과 달라져
 * hydration 이 어긋난다.
 *
 * ── "YYYY-MM-DD" 는 사전순 비교가 곧 날짜순 비교다 ──────────────────────
 * date 칼럼에서 온 날짜 문자열을 new Date() 로 파싱하면 **UTC 자정**이 되고,
 * 한국시간 오전 9시가 UTC 0시라 하루가 어긋난다(이 저장소가 실제로 겪었다 —
 * repair-case-overdue.test.ts). 그래서 문자열 그대로 비교한다.
 * ============================================================================
 */

/** 견적서 발행일로부터 이만큼 지나면 '장기'다. 사용자가 정한 값이다. */
export const LONG_PENDING_PO_MONTHS = 2;

/** 판정이 받는 접수 건 한 조각 — 전체 행 타입을 끌어오지 않는다. */
export type LongPendingPoCandidate = {
  /**
   * 평탄화된 상태. null 을 허용한다 — workflow_steps.repair_status 는 아직
   * nullable 이다(그 스키마 주석). 출하 완료가 아니면 무엇이든 판정 대상이다.
   */
  status: RepairStatus | null;
  /**
   * 그 접수 건에 붙은 내자 줄 전부(`is_deleted = false` 인 것만). 줄이 하나도
   * 없으면 빈 배열이고, 그런 건은 견적서 자체가 없으므로 걸리지 않는다.
   */
  orderRows: readonly WeeklyReportOrderDates[];
};

/**
 * 이 접수 건이 **장기 PO 미발행**인가 — 판정하는 곳이 여기 하나뿐이다.
 * 조회도 화면도 이 함수를 부르고, 규칙을 따로 옮겨 적지 않는다.
 */
export function isLongPendingPo(
  candidate: LongPendingPoCandidate,
  now: Date = new Date()
): boolean {
  // 출하 완료된 건은 이미 나간 물건이다. 청구가 밀렸는지는 다른 이야기이고,
  // 이 목록이 답하는 질문("아직 PO 를 기다리는 중인가")의 답이 아니다.
  if (isExcludedFromWeeklyReport(candidate)) return false;

  const { quoteIssuedDate, orderIssuedDate } = pickWeeklyReportOrderDates(candidate.orderRows);

  // 견적서를 아직 안 냈으면 기다릴 PO 도 없다.
  if (quoteIssuedDate === null) return false;
  // PO 가 났다. 고른 줄의 불변식상 이것은 "발주일이 있는 줄이 하나라도 있다"와
  // 뜻이 같다(파일 헤더).
  if (orderIssuedDate !== null) return false;

  // 딱 두 달이 되는 날 당일부터 걸린다 — `<` 가 아니라 `<=` 다.
  return addCalendarMonths(quoteIssuedDate, LONG_PENDING_PO_MONTHS) <= toKstDateOnly(now);
}
