import {
  DUE_DATE_FROM_DOMESTIC_ORDER_SHORT_LABEL,
  DUE_DATE_FROM_DOMESTIC_ORDER_SHORT_NOTE,
  resolveRepairCaseRequestedDueDate,
} from "@/lib/domain/requested-due-date-link";
import { DUE_DATE_NEAR_TEXT_CLASS } from "./due-date-near";

/**
 * ============================================================================
 * 목록에 그리는 「고객 요청 납기일」 한 조각 (2026-10-19)
 * ============================================================================
 * 이 건에 적힌 날짜가 먼저, 비어 있으면 연결된 내자 정리의 납기요청일 중 가장
 * 이른 하루 — 그 규칙은 여기서 정하지 않는다. 상세정보 화면이 쓰는 바로 그
 * 함수를 부른다(domain/requested-due-date-link.ts 의
 * resolveRepairCaseRequestedDueDate). 규칙을 베껴 적으면 언젠가 한쪽만 고쳐져
 * **같은 건이 화면마다 다른 날짜로** 보인다 — 어제 만든 종 알림이 빌려 온
 * 날짜로 뜨는데 표에는 "-"가 나오던 이번 결함이 정확히 그것이었다.
 *
 * 🔴 **네 자리가 한 조각을 쓴다.** 전체 A/S 현황의 표·카드와 내 작업 화면의
 * 표·카드다. 네 곳에 같은 JSX 를 적어 두면 꼬리표 글자·설명·색이 넷으로 갈라진다.
 * 받는 것은 **행 전체가 아니라 이 조각이 보는 두 칸**이다 — 행을 통째로 받게
 * 해 두면 언젠가 다른 날짜 칸이 여기 섞여 들어오고, 그때 이 규칙은 조용히
 * 달라진다(resolveDomesticOrderDueDateDisplay 가 칸만 받는 것과 같은 이유).
 *
 * 🔴 **빌려 온 날짜일 때만** 표시가 붙는다. 표시 없이 그냥 날짜만 그리면
 * "이 줄에 내가 적어 둔 값"으로 읽히고, 나중에 내자 쪽이 바뀌면 아무도 안
 * 건드렸는데 값이 달라진 것으로 보인다(그 파일 머리말).
 *
 * 🔴 **자리가 좁다.** 표에서 이 값이 사는 곳은 출하일 칸 안의 `text-xs` 보조 줄
 * 하나이고 줄바꿈을 하지 않는다. 그래서 상세정보가 쓰는 긴 이름표("내자
 * 납기요청일")가 아니라 짧은 것을 쓰고(DUE_DATE_FROM_DOMESTIC_ORDER_SHORT_LABEL),
 * 긴 설명은 `title` 이 맡는다. 글자 크기를 px 가 아니라 **em 으로** 잡은 것도
 * 같은 이유다 — 표(text-xs)와 카드(text-sm) 양쪽에서 제 바탕보다 한 단계만
 * 작아진다.
 *
 * 🔴 **납기 임박이면 날짜만 굵은 붉은색이 된다**(2026-10-19 사용자 요구). 임박
 * 여부를 **여기서 재지 않고 받는** 까닭은 둘이다: 「오늘」을 화면에서 만들면 서버가
 * 그린 것과 어긋나고(hydration), 조건을 여기 적으면 종 알림과 두 말이 된다. 판정은
 * 서버가 domain/notifications.ts 의 isRepairCaseDueDateNear 으로 한다.
 * 🔴 임박이 아닐 때 나오는 HTML 은 **예전과 글자 하나 다르지 않아야 한다** —
 * 이 조각은 네 화면이 함께 쓰므로, 평소 모양이 바뀌면 네 곳이 한꺼번에 바뀐다.
 * 꼬리표(내자)는 임박이어도 색이 바뀌지 않는다 — 그것은 경보가 아니라 **어디서 온
 * 값인가**를 말하는 표시이고, 함께 붉어지면 날짜와 같은 무게로 읽힌다.
 * ============================================================================
 */
export default function RequestedDueDateValue({
  customerRequestedDueDate,
  domesticOrderDueDates,
  isDueDateNear = false,
}: {
  /** 이 건의 repair_cases.customer_requested_due_date 그대로. */
  customerRequestedDueDate: string | null;
  /** 연결된 내자 정리 줄들의 납기요청일 **전부**. 고르는 일은 도메인이 한다. */
  domesticOrderDueDates: readonly string[];
  /**
   * 서버가 재 둔 「납기 임박」 여부. 기본은 거짓이라, 이 값을 넘기지 않는 화면은
   * 예전과 똑같이 그려진다(전체 A/S 현황·내 작업 넷만 넘긴다).
   */
  isDueDateNear?: boolean;
}) {
  const { dueDate, borrowed } = resolveRepairCaseRequestedDueDate({
    customerRequestedDueDate,
    domesticOrderDueDates,
  });

  // 양쪽 어디에도 없으면 이 목록들이 쓰던 대로 "-" 다 — 「없음」 같은 말을 짓지 않는다.
  // 임박일 때만 날짜가 span 하나를 입는다(임박이 아니면 예전 그대로 맨 글자다).
  const value = isDueDateNear ? (
    <span className={DUE_DATE_NEAR_TEXT_CLASS}>{dueDate}</span>
  ) : (
    dueDate ?? "-"
  );

  if (!borrowed) return <>{value}</>;

  return (
    <>
      {value}{" "}
      <span
        className="text-[0.9em] text-zinc-400 dark:text-zinc-500"
        title={DUE_DATE_FROM_DOMESTIC_ORDER_SHORT_NOTE}
      >
        {DUE_DATE_FROM_DOMESTIC_ORDER_SHORT_LABEL}
      </span>
    </>
  );
}
