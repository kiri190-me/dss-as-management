import type { WorkRecordRow } from "@/lib/db/queries/repair-case-work-records";
import WorkRecordItem from "./WorkRecordItem";

export default function WorkRecordList({
  records,
  canInvalidate,
  onInvalidate,
  emptyMessage,
  canEditOwnRecords = false,
  currentUserId = null,
  onEdit,
}: {
  records: WorkRecordRow[];
  canInvalidate: boolean;
  onInvalidate?: (workRecordId: string) => void;
  emptyMessage: string;
  /** 역할·권한상 **자기가 쓴** 기록을 고칠 수 있는가. 「자기 것인가」는 아래에서 줄마다 가린다. */
  canEditOwnRecords?: boolean;
  /** 지금 보고 있는 사람. null 이면 어떤 줄도 「내 것」이 될 수 없다. */
  currentUserId?: string | null;
  onEdit?: (workRecordId: string) => void;
}) {
  if (records.length === 0) {
    return <p className="text-sm text-zinc-500 dark:text-zinc-400">{emptyMessage}</p>;
  }

  return (
    <ol className="flex flex-col gap-2">
      {records.map((record) => {
        // 🔴 작성자 본인만 고친다 — 서버(canEditWorkRecord)가 하는 판정과
        //    같은 조건이다. 여기 것은 단추를 보일지만 정한다.
        const canEditThisRecord =
          canEditOwnRecords && currentUserId !== null && record.authorUserId === currentUserId;
        return (
          <WorkRecordItem
            key={record.id}
            record={record}
            canInvalidate={canInvalidate}
            onInvalidateClick={onInvalidate ? () => onInvalidate(record.id) : undefined}
            canEdit={canEditThisRecord}
            onEditClick={canEditThisRecord && onEdit ? () => onEdit(record.id) : undefined}
          />
        );
      })}
    </ol>
  );
}
