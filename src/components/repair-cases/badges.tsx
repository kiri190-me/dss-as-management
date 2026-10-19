"use client";

import { useUiText } from "@/components/providers/UiTextProvider";
import { NOTIFICATION_KIND_META } from "@/lib/domain/notification-settings";
import type { Priority, RepairStatus } from "@/lib/domain/types";

/**
 * 🔴 이 파일에 "use client" 를 붙인 이유 — 상태·우선순위 이름표를 저장된 문구로
 * 읽으려면 훅(useUiText)이 필요하고, 훅은 서버 컴포넌트에서 부르면 렌더가 터진다.
 * 이 줄이 생긴 계기는 서버에서 렌더되던 한 갈래였다(검수/승인 탭의 머리말 상자 —
 * 2026-10-06 에 탭 위 머리 카드와 겹쳐 걷어냈다). 그 갈래가 사라진 뒤에도 경계는
 * 파일에 그대로 적어 둔다: 지금 어느 부모가 클라이언트인지에 기대는 것보다,
 * 경계가 파일에 적혀 있어야 나중에 서버 화면에서 배지를 하나 더 쓰는 날 조용히
 * 깨지지 않는다. 받는 값이 전부 문자열/불리언이라 경계를 건너는 데 드는 비용도
 * 없고, 만들어지는 HTML 은 이전과 같다.
 */

const baseBadgeClass =
  "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap";

export function StatusBadge({ status }: { status: RepairStatus }) {
  const uiText = useUiText();
  const tone =
    status === "SHIPMENT_COMPLETED"
      ? "bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-400"
      : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300";
  return <span className={`${baseBadgeClass} ${tone}`}>{uiText.repairStatus[status]}</span>;
}

export function PriorityBadge({ priority }: { priority: Priority }) {
  const uiText = useUiText();
  const tone =
    priority === "URGENT"
      ? "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-400"
      : priority === "HIGH"
        ? "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-400"
        : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300";
  return <span className={`${baseBadgeClass} ${tone}`}>{uiText.priority[priority]}</span>;
}

export function SourceBadge({ source }: { source: "MOCK" | "LOCAL_DEMO" | "DATABASE" }) {
  if (source === "LOCAL_DEMO") {
    return (
      <span
        className={`${baseBadgeClass} bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-400`}
      >
        로컬 데모 데이터
      </span>
    );
  }
  if (source === "DATABASE") {
    return (
      <span
        className={`${baseBadgeClass} bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400`}
      >
        DB
      </span>
    );
  }
  // MOCK stays unbadged, unchanged from before Stage G-2.
  return null;
}

export function OverdueBadge({ isOverdue }: { isOverdue: boolean }) {
  if (!isOverdue) {
    return <span className="text-xs text-zinc-500 dark:text-zinc-400">정상</span>;
  }
  return (
    <span
      className={`${baseBadgeClass} bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-400`}
    >
      납기 지연
    </span>
  );
}

/**
 * 「납기 임박」 — 고객 요청 납기일이 **오늘부터 7일 안**으로 다가온 건 (2026-10-19).
 *
 * ── 🔴 「납기 지연」(OverdueBadge)과 **다른 판정이고 다른 색**이다 ───────────
 * 바로 위의 OverdueBadge 가 재는 것은 **사내 목표 출하일**을 넘겼는가이고
 * (isRepairCaseOverdue), 이 배지가 재는 것은 **고객 요청 납기일**이 다가왔는가다.
 * 둘은 섞이지 않는다 — 한 건에 둘 다 붙을 수도 있다.
 *
 * 🔴 색을 red 가 아니라 rose 로 둔 것은 사용자 결정이다. 진한 빨강으로 하면 바로
 * 옆의 「납기 지연」과 **같은 색**이 되어 「이미 늦음」과 「곧 늦음」이 구별되지
 * 않는다. 그 둘은 하는 일이 다르다 — 지연은 사과할 일이고 임박은 서두를 일이다.
 *
 * ── 🔴 판정은 이 조각이 하지 않는다 ─────────────────────────────────────────
 * 받는 것은 불리언 하나뿐이다. 「오늘」을 화면에서 `new Date()` 로 만들면 서버가
 * 그린 것과 어긋나 hydration 이 깨지고(app/(app)/repair-cases/page.tsx 의
 * longPendingPoCaseIds 주석), 조건을 여기 적으면 종 알림과 두 말이 된다. 판정은
 * 서버가 domain/notifications.ts 의 isRepairCaseDueDateNear 하나로 한다 —
 * 종 알림이 쓰는 바로 그 세 함수를 묶은 것이다.
 *
 * 글자는 종 알림의 종류 이름을 그대로 가져온다(NOTIFICATION_KIND_META) — 같은
 * 사실을 종에서는 「납기 임박」, 표에서는 다른 말로 부르지 않기 위해서다.
 */
export function DueDateNearBadge({ isDueDateNear }: { isDueDateNear: boolean }) {
  if (!isDueDateNear) return null;
  return (
    <span className={`${baseBadgeClass} bg-rose-50 text-rose-700 dark:bg-rose-950 dark:text-rose-400`}>
      {NOTIFICATION_KIND_META.REPAIR_CASE_DUE_DATE_NEAR.label}
    </span>
  );
}

/**
 * Stage E-1: 워크플로 보류(holdState)는 exceptionStatus·isOverdue와 완전히
 * 별개의 축이다 — 이 배지는 절대 다른 배지와 문자열/의미를 합치지 않는다.
 */
export function HoldBadge({ isOnHold }: { isOnHold: boolean }) {
  if (!isOnHold) return null;
  return (
    <span className={`${baseBadgeClass} bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-300`}>
      보류 중
    </span>
  );
}

/** 해당 접수 건에 Stage E-1 로컬 워크플로 재정의가 적용되어 있음을 표시한다. */
export function WorkflowOverrideBadge({ hasOverride }: { hasOverride: boolean }) {
  if (!hasOverride) return null;
  return (
    <span className={`${baseBadgeClass} bg-purple-50 text-purple-700 dark:bg-purple-950 dark:text-purple-400`}>
      로컬 워크플로 재정의
    </span>
  );
}
