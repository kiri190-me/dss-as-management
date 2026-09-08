"use client";

import { useUiText } from "@/components/providers/UiTextProvider";
import type { Priority, RepairStatus } from "@/lib/domain/types";

/**
 * 🔴 이 파일에 "use client" 를 붙인 이유 — 여기 있는 배지들은 클라이언트 화면
 * 열두 곳에서 쓰이는데, 딱 한 갈래만 서버에서 렌더된다:
 * (app)/repair-cases/[id]/approval/page.tsx → DatabaseApprovalScreen →
 * DatabaseApprovalHeaderSummary. 상태·우선순위 이름표를 저장된 문구로 읽으려면
 * 훅(useUiText)이 필요하고, 훅은 서버 컴포넌트에서 부르면 렌더가 터진다.
 * 그 한 갈래 때문에 배지 모듈 전체를 클라이언트 경계로 명시했다 —
 * 지금 어느 부모가 클라이언트인지에 기대는 것보다, 경계를 파일에 적어 두는
 * 편이 나중에 서버 화면에서 배지를 하나 더 쓰는 날 조용히 깨지지 않는다.
 * 받는 값이 전부 문자열/불리언이라 경계를 건너는 데 드는 비용도 없고,
 * 만들어지는 HTML 은 이전과 같다.
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
