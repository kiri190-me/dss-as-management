"use client";

import { useState } from "react";
import type { TemplateHistoryView, HistoryGroupView } from "@/lib/db/queries/procedure-template-history";
import { restoreProcedureTemplateChangeAction } from "@/lib/server/actions/procedure-template-restore";
import EditHistoryList from "./EditHistoryList";

/**
 * Phase 5C-5C UI — thin stateful wrapper around EditHistoryList: owns the
 * restore confirm/call/refresh flow (the one piece that must call the
 * "use server" restore action) so EditHistoryList itself stays a pure,
 * directly-testable presentational component — see EditHistoryList's own
 * doc comment for why they're split.
 */
export default function EditHistoryPanel({
  templateId,
  historyView,
  canManage,
  expectedTemplateUpdatedAt,
  onRestored,
}: {
  templateId: string;
  historyView: TemplateHistoryView;
  canManage: boolean;
  expectedTemplateUpdatedAt: string;
  onRestored: (newUpdatedAt: string) => void;
}) {
  const [restoringGroupId, setRestoringGroupId] = useState<string | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);

  async function handleRestoreClick(group: HistoryGroupView) {
    const confirmed = window.confirm(
      "현재 초안이 선택한 과거 상태로 변경됩니다.\n" +
        "기존 이력은 삭제되지 않으며, 이번 복원 작업 자체도 새 이력으로 기록됩니다.\n" +
        "복원 후에도 [이전] 버튼으로 이번 복원을 되돌릴 수 있습니다.\n\n" +
        "계속하시겠습니까?"
    );
    if (!confirmed) return;
    setRestoringGroupId(group.changeGroupId);
    setRestoreError(null);
    const result = await restoreProcedureTemplateChangeAction({ templateId, targetChangeGroupId: group.changeGroupId, expectedTemplateUpdatedAt });
    setRestoringGroupId(null);
    if (!result.ok) {
      setRestoreError(result.message);
      return;
    }
    onRestored(result.updatedAt);
  }

  return (
    <div className="flex flex-col gap-2 text-xs">
      {restoreError && <p className="text-red-600 dark:text-red-400">{restoreError}</p>}
      <EditHistoryList historyView={historyView} canManage={canManage} restoringGroupId={restoringGroupId} onRestoreClick={(group) => void handleRestoreClick(group)} />
    </div>
  );
}
