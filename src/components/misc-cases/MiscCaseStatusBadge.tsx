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

export default function MiscCaseStatusBadge({ status }: { status: MiscCaseStatus }) {
  return (
    <span className={`${baseBadgeClass} ${toneByStatus[status]}`}>
      {MISC_CASE_STATUS_LABELS[status]}
    </span>
  );
}
