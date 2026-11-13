import { BadgeVisibilityGate } from "@/components/providers/BadgeVisibilityProvider";
import type { BadgePlaceKey } from "@/lib/domain/badge-visibility";
import {
  MISC_CASE_STATUS_LABELS,
  type MiscCaseStatus,
} from "@/lib/domain/misc-case-status";

/**
 * 기타건의 상태 배지 — **기타건 현황의 표·카드와 기타건 상세의 머리 카드**가 같이
 * 쓴다(2026-11-06 사용자 요구: 「상태를 베찌 모양으로」 · 「기타건 상세의 헤드와
 * 기타건 현황 목록에」).
 *
 * 🔴 **글자도 판정도 여기 없다.** 말은 domain/misc-case-status.ts 의 한 벌이고, 어느
 * 상태인지는 그 파일의 resolveMiscCaseStatus 가 정한다 — 이 파일에는 **색**만 있다.
 *
 * 생김새는 승인 상태 배지에서 가져왔다(repair-cases/approval/
 * DatabaseApprovalStatusBadge) — 알약 모양·글자 크기·여백이 한 글자도 다르지 않고,
 * 색도 뜻이 겹치는 자리는 같은 색이다: 올려 둔 것은 파랑, 통과한 것은 초록, 반려는
 * 빨강, 다시 받아야 하는 것은 주황. 같은 결재 흐름을 쓰는 두 화면이 같은 사실을 다른
 * 색으로 말하면 안 된다.
 *
 * 🔵 **완료만 색이 진하다.** 내자 정리의 완료 배지가 쓰던 자리(진한 회색 바탕에 흰
 * 글자)를 그대로 가져왔다 — 「진행 중」의 연한 회색과 한눈에 갈려야 하는 짝이고, 그
 * 둘이 비슷한 회색이면 이 표에서 제일 자주 하는 판단이 흐려진다.
 *
 * 🔵 **서버 컴포넌트에서도 그린다**(`"use client"` 가 없다). 상태도 훅도 없는 표시
 * 전용이라, 기타건 상세의 머리 카드(서버 컴포넌트)가 그대로 그린다 — 경계를 새로
 * 그으면 그 줄이 브라우저로 한 번 더 실려 간다.
 *
 * ── 🔴 그래서 배지 표시 설정은 **훅이 아니라 조각으로** 묻는다 (2026-11-13) ──
 * 아래 `placeKey` 를 받으면 그 자리에서 꺼져 있는지 보고 스스로 안 그린다. 그 판정을
 * `useIsBadgeVisible` 로 하면 이 파일이 클라이언트 전용이 되고, 그러면 **기타건
 * 상세의 머리 카드(서버)가 이 배지를 그리는 순간 그 화면이 통째로 죽는다** — 타입
 * 검사도 단위 시험도 못 잡고 `npm run build` 나 실제 화면에서만 드러나는 고장이다.
 * 바로 옆에 나란히 서는 FinalShipmentApprovedBadge 가 같은 까닭으로 같은 길을 쓴다.
 *
 * 🔴 **`placeKey` 를 안 주면 예전 그대로 그린다.** 설정 화면의 보기 배지
 * (settings/badge-samples.tsx)가 자리를 한 글자도 안 넘기는 것이 이 성질에 기대고
 * 있다 — 넘기게 되면 이 배지를 끈 순간 설정 화면의 그 줄이 비고, 끈 사람은 무엇을
 * 껐는지 볼 수도 다시 켤 수도 없다.
 */
const baseBadgeClass =
  "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap";

const toneByStatus: Record<MiscCaseStatus, string> = {
  COMPLETED: "bg-zinc-700 text-white dark:bg-zinc-300 dark:text-zinc-900",
  SHIPMENT_READY: "bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-400",
  SHIPMENT_APPROVAL_PENDING: "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-400",
  SHIPMENT_APPROVAL_REJECTED: "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-400",
  SHIPMENT_APPROVAL_STALE: "bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  IN_PROGRESS: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
};

export default function MiscCaseStatusBadge({
  status,
  placeKey,
}: {
  status: MiscCaseStatus;
  /** 지금 서는 자리. 안 주면 설정과 상관없이 늘 그린다(위 머리말). */
  placeKey?: BadgePlaceKey;
}) {
  // 🔴 관문이 DOM 을 안 만든다 — 보일 때는 아래 <span> 을 그대로 내놓는다. 감싸는
  //    요소를 하나라도 끼우면 이 알약이 선 flex 줄의 간격이 달라진다.
  return (
    <BadgeVisibilityGate badgeKey="miscCaseStatus" placeKey={placeKey}>
      <span className={`${baseBadgeClass} ${toneByStatus[status]}`}>
        {MISC_CASE_STATUS_LABELS[status]}
      </span>
    </BadgeVisibilityGate>
  );
}
