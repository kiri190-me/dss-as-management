import { FINAL_SHIPMENT_APPROVED_LABEL } from "@/lib/domain/final-shipment-approval-badge";

/**
 * ============================================================================
 * 🔴 **[최종 출하 승인 완료]** — 다섯 자리가 나눠 쓰는 배지 하나 (2026-11-08)
 * ============================================================================
 * 사용자 요구 원문: 「수리건과 기타건 모두 최종출하승인이 되면 [최종 출하 승인
 * 완료]라는 베찌가 **현황판과 상세페이지 헤드, 내자정리의 [완료 처리]버튼의
 * 오른쪽**에 베찌가 붙도록 해줘」.
 *
 * 붙는 자리가 다섯이다 — 전체 A/S 현황(표·카드) · 수리 건 상세 머리 카드 ·
 * 기타건 현황(표·카드) · 기타건 상세 머리 카드 · 내자 정리의 [완료 처리] 옆.
 * 🔴 **글자도 판정도 여기 없다** — 말은 domain/final-shipment-approval-badge.ts
 * 한 벌이고, 어느 상태에 붙는지도 그 파일의 isFinalShipmentApproved 가 정한다.
 * 이 파일에는 **색과 치수**만 있다(MiscCaseStatusBadge 가 선 자리와 같다).
 *
 * ── 🔴 **왜 채워진 배지인가** ───────────────────────────────────────────
 * 이 배지는 **내자 정리의 표**에도 선다. 그 표의 줄에는 고객사마다 정해 둔 파스텔
 * 배경이 깔린다(domain/customer-row-color.ts — rose·amber·lime·emerald·teal·sky·
 * indigo·violet·fuchsia 의 100 단계). 🔴 연한 바탕의 배지(bg-*-50)를 쓰면 그중
 * 몇 줄에서 **배지가 줄 배경에 녹아 사라진다.** 오류가 아니라 「아무것도 안 보임」
 * 이라 아무도 신고하지 않는다.
 *
 * 그래서 그 표에서 이미 같은 까닭으로 **채워진** 완료 표(CompletedBadge — 진한
 * 회색에 흰 글자)가 쓰는 길을 그대로 따른다. 채운 배지는 어떤 파스텔 위에서도
 * 제 모양을 지킨다.
 *
 * ── 🔴 **왜 진한 초록인가 — 이웃과 안 겹쳐야 한다** ──────────────────────
 * 이 배지가 나란히 서는 것들의 색을 전부 세어 보고 골랐다:
 *   · 「납기 지연」 red · 「납기 임박」 rose · 「긴급」 red · 「높음」 amber
 *   · 「출하 승인 대기」 blue · 「보류 중」 amber · 「로컬 워크플로 재정의」 purple
 *   · 「DB」 emerald **50** · 「정상」 blue · 「완료」 진한 **회색**(채움)
 *   · 「출하 대기」·「출하 완료」·[승인] 탭의 「승인 완료」 green **50**
 * 🔵 초록 계열을 고른 것은 **이 저장소에서 초록이 「통과했다」의 말**이기 때문이다
 * (승인 완료 · 출하 대기 · 출하 완료가 전부 초록 50). 같은 뜻의 배지가 빨강이나
 * 보라면 사람은 그것을 다른 종류의 사실로 읽는다.
 * 🔴 그러면서 **채워진 진한 초록은 아직 아무 배지도 안 쓴다** — 연한 초록 셋과도,
 * 진한 회색 「완료」와도 한눈에 갈린다. 「완료」(일을 끝냈다)와 「최종 출하 승인
 * 완료」(결재가 끝났다)는 한 줄에 **함께 설 수 있는** 서로 다른 사실이라, 둘이
 * 같은 색이면 안 된다.
 *
 * 🔴 **밝은 화면에서 emerald-700 위의 흰 글자는 명암비 5.48:1** 이다(12px 글자에
 * 요구되는 4.5:1 을 넘는다 — DetailHeader 가 이름표 색을 한 칸 올린 그 계산과 같은
 * 잣대다). 어두운 화면은 CompletedBadge 와 **같은 방식으로 뒤집는다**(연한 바탕에
 * 진한 글자) — 어두운 바탕 위의 진한 초록은 거의 검정으로 보인다.
 *
 * 🔵 **서버 컴포넌트다**(`"use client"` 가 없다). 상태도 훅도 없는 표시 전용이라
 * 기타건 상세의 머리 카드(서버)가 그대로 그리고, 클라이언트 화면(내자 정리의 표 ·
 * 전체 A/S 현황)에서도 그대로 쓰인다 — MiscCaseStatusBadge 와 같은 자리의 같은
 * 판단이다.
 * ============================================================================
 */

/**
 * 치수 두 벌.
 *
 *  · `default` — 현황 목록과 상세 머리 카드. 이웃한 배지들과 **한 글자도 다르지
 *    않은** 알약 모양이다(badges.tsx 의 baseBadgeClass · MiscCaseStatusBadge).
 *  · `compact` — 🔴 내자 정리의 **순번 칸**. 그 칸의 표와 단추는 전부 11px 이고
 *    (CompletedBadge · rowActionButtonClass), 거기에만 12px 배지를 세우면 한 줄
 *    안에서 글자 크기가 들쭉날쭉해진다. 모양은 CompletedBadge 에서 그대로 가져왔다
 *    — 같은 칸에 나란히 서는 두 표가 다른 치수면 다른 종류의 것으로 읽힌다.
 */
const SIZE_CLASS = {
  default: "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap",
  compact: "inline-flex items-center rounded px-1.5 py-0.5 text-[11px] leading-none font-medium whitespace-nowrap",
} as const;

/** 🔴 채운 진한 초록(위 머리말). 어두운 화면은 CompletedBadge 와 같이 뒤집는다. */
const TONE_CLASS = "bg-emerald-700 text-white dark:bg-emerald-300 dark:text-emerald-950";

export default function FinalShipmentApprovedBadge({
  approved,
  size = "default",
  title,
}: {
  /**
   * 🔴 **판정은 여기서 하지 않는다** — 받는 것은 불리언 하나다
   * (domain/final-shipment-approval-badge.ts 의 isFinalShipmentApproved).
   * 「납기 지연」·「납기 임박」 배지가 선 그 선과 같은 선이다: 조건을 화면에 적으면
   * 같은 사실을 서버와 화면이 다른 말로 하게 된다.
   */
  approved: boolean;
  size?: keyof typeof SIZE_CLASS;
  /**
   * 마우스를 올렸을 때의 한 줄. 🔴 **회차가 여럿인 기타건에서만 넘긴다** — 그때는
   * 이 배지가 「그 회차의 승인」을 말하는데, 보이는 글자만으로는 어느 회차인지 알
   * 수 없다(내자 정리의 완료 단추가 긴 회차 이름을 title 에 두는 것과 같은 까닭).
   */
  title?: string;
}) {
  // 🔴 거짓이면 **아무것도 그리지 않는다** — "승인 전" 같은 말을 대신 적지 않는다.
  //    현황 목록의 배지들이 전부 그 규율이고(OverdueBadge 의 "정상" 하나만 예외다),
  //    안 붙는 것이 기본값인 배지에 빈자리 글자를 두면 모든 줄이 한 칸씩 길어진다.
  if (!approved) return null;
  return (
    <span className={`${SIZE_CLASS[size]} ${TONE_CLASS}`} title={title}>
      {FINAL_SHIPMENT_APPROVED_LABEL}
    </span>
  );
}
