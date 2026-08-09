import type { WorkRecordRow } from "@/lib/db/queries/repair-case-work-records";
import WorkRecordItem from "./WorkRecordItem";

export default function WorkRecordList({
  records,
  canInvalidate,
  onInvalidate,
  emptyMessage,
}: {
  records: WorkRecordRow[];
  canInvalidate: boolean;
  onInvalidate?: (workRecordId: string) => void;
  emptyMessage: string;
}) {
  if (records.length === 0) {
    return <p className="text-sm text-zinc-500 dark:text-zinc-400">{emptyMessage}</p>;
  }

  return (
    <ol className="flex flex-col gap-2">
      {records.map((record) => (
        <WorkRecordItem
          key={record.id}
          record={record}
          canInvalidate={canInvalidate}
          onInvalidateClick={onInvalidate ? () => onInvalidate(record.id) : undefined}
        />
      ))}
    </ol>
  );
}
