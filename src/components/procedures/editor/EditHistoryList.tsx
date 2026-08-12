"use client";

import { useState } from "react";
import type { TemplateHistoryView, HistoryGroupView } from "@/lib/db/queries/procedure-template-history";
import { getHistoryGroupLabel, getOriginBadgeLabel, getActionTypeLabel } from "@/lib/domain/procedure-template-history-labels";

const ORIGIN_BADGE_CLASS: Record<HistoryGroupView["origin"], string> = {
  USER_EDIT: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
  UNDO: "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-400",
  REDO: "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-400",
  RESTORE: "bg-purple-50 text-purple-700 dark:bg-purple-950 dark:text-purple-400",
};

/**
 * Phase 5C-5C UI — pure, presentational rendering of one template's grouped
 * edit history (grouped by change_group_id, ordered by sequence_number —
 * both already done by the caller's historyView; created_at is
 * display-only). Deliberately calls no server action and owns no request
 * state — EditHistoryPanel.tsx (the thin stateful wrapper) owns the
 * restore confirm/call/refresh flow. Kept separate specifically so this
 * piece stays testable under the existing component-test harness, which
 * has no react-server condition and therefore can't load anything that
 * transitively imports a "use server" action file.
 *
 * [이 상태로 복원] only ever renders for a group the SERVER already marked
 * isRestoreEligible (isEligibleRestoreTargetOrigin, the same rule the
 * restore mutation itself enforces) — this is a UI convenience, never the
 * authorization boundary.
 */
export default function EditHistoryList({
  historyView,
  canManage,
  restoringGroupId,
  onRestoreClick,
}: {
  historyView: TemplateHistoryView;
  canManage: boolean;
  restoringGroupId: string | null;
  onRestoreClick: (group: HistoryGroupView) => void;
}) {
  const [expandedGroupId, setExpandedGroupId] = useState<string | null>(null);

  if (historyView.groups.length === 0) {
    return <p className="text-xs text-zinc-400 dark:text-zinc-600">아직 편집 이력이 없습니다.</p>;
  }

  return (
    <ol className="flex flex-col gap-2 text-xs">
      {historyView.groups.map((group) => {
        const label = getHistoryGroupLabel({ origin: group.origin, actionTypes: group.rows.map((r) => r.actionType) });
        const isExpanded = expandedGroupId === group.changeGroupId;
        const isRestoring = restoringGroupId === group.changeGroupId;
        const firstReason = group.rows.find((r) => r.reason)?.reason ?? null;
        return (
          <li key={group.changeGroupId} className="rounded border border-zinc-100 p-2 dark:border-zinc-800">
            <div className="flex flex-wrap items-center justify-between gap-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="font-medium text-zinc-900 dark:text-zinc-50">{label}</span>
                <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${ORIGIN_BADGE_CLASS[group.origin]}`}>{getOriginBadgeLabel(group.origin)}</span>
                {group.isCurrentTop && <span className="rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400">현재</span>}
              </div>
              <span className="text-zinc-400 dark:text-zinc-600">{group.rows[0].actorName}</span>
            </div>
            <p className="mt-0.5 text-zinc-400 dark:text-zinc-600">{new Date(group.createdAt).toLocaleString("ko-KR")}</p>
            {firstReason && <p className="mt-1 whitespace-pre-wrap">사유: {firstReason}</p>}

            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              {group.rows.length > 1 && (
                <button type="button" onClick={() => setExpandedGroupId(isExpanded ? null : group.changeGroupId)} className="text-zinc-500 underline hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200">
                  {isExpanded ? "세부 내역 숨기기" : `세부 내역 보기 (${group.rows.length}건)`}
                </button>
              )}
              {canManage && group.isRestoreEligible && (
                <button
                  type="button"
                  onClick={() => onRestoreClick(group)}
                  disabled={isRestoring}
                  className="rounded-md border border-purple-300 px-2 py-1 text-[11px] font-medium text-purple-700 hover:bg-purple-50 disabled:opacity-50 dark:border-purple-800 dark:text-purple-400 dark:hover:bg-purple-950"
                >
                  {isRestoring ? "복원 중..." : "이 상태로 복원"}
                </button>
              )}
            </div>

            {isExpanded && (
              <ul className="mt-1.5 flex flex-col gap-1 border-t border-zinc-100 pt-1.5 dark:border-zinc-800">
                {group.rows.map((row) => (
                  <li key={row.id} className="text-zinc-500 dark:text-zinc-400">
                    {getActionTypeLabel(row.actionType)}
                    {row.reason && ` — ${row.reason}`}
                  </li>
                ))}
              </ul>
            )}
          </li>
        );
      })}
    </ol>
  );
}
