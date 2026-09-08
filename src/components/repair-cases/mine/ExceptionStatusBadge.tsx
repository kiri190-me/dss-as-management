import type { ExceptionStatus } from "@/lib/domain/types";
import { useUiText } from "@/components/providers/UiTextProvider";

/**
 * Phase 5C-3 — 예외 상태 badge for the My Active Work table/card list.
 * Deliberately its own small component (not added to the shared
 * repair-cases/badges.tsx) since exceptionStatus has never been rendered
 * as a badge anywhere else in this codebase yet — this is the first
 * consumer, not a shared convention to retrofit elsewhere.
 *
 * exceptionStatus is independent of RepairStatus/currentWorkflowStepKey
 * (see domain/types.ts's own comment on the field) — this badge never
 * merges with StatusBadge's text/color, and rendering it never affects
 * shipment-completed exclusion.
 */
export function ExceptionStatusBadge({ exceptionStatus }: { exceptionStatus: ExceptionStatus | null }) {
  /*
    문구는 DB 의 exception_statuses.label 에서 온다(domain/ui-text.ts). 코드 표는
    그 코드의 행이 없을 때를 위한 기본값으로 남아 있다.
    MyActiveWorkTable/MyActiveWorkCardList → MyActiveWorkScreen("use client")
    아래에서만 렌더되므로 훅을 쓸 수 있다.
  */
  const uiText = useUiText();

  if (!exceptionStatus) {
    return <span className="text-xs text-zinc-400 dark:text-zinc-600">-</span>;
  }
  return (
    <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium whitespace-nowrap text-amber-800 dark:bg-amber-950 dark:text-amber-300">
      {uiText.exceptionStatus[exceptionStatus]}
    </span>
  );
}
