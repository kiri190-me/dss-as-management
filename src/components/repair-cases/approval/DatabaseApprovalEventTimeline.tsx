import type { ApprovalRecordRow } from "@/lib/db/queries/repair-case-approvals";

const APPROVAL_TYPE_LABELS: Record<ApprovalRecordRow["approvalType"], string> = {
  REPAIR_INSPECTION: "수리 검수 승인",
  FINAL_SHIPMENT: "최종 출하 승인",
};

const STATUS_EVENT_LABELS: Record<ApprovalRecordRow["status"], string> = {
  REQUESTED: "승인 요청",
  APPROVED: "승인",
  REJECTED: "반려",
};

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Database-mode counterpart to ApprovalEventTimeline.tsx. Each
 * repair_case_approvals row is itself a permanent request record (no
 * separate events table — see the schema file), so one entry per row
 * already reconstructs the full history; a decided row additionally shows
 * its decision line.
 */
export default function DatabaseApprovalEventTimeline({ records }: { records: ApprovalRecordRow[] }) {
  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">승인 이력</h2>

      {records.length === 0 ? (
        <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">아직 승인 관련 이력이 없습니다.</p>
      ) : (
        <ol className="mt-3 flex flex-col gap-2">
          {records.map((record) => (
            <li key={record.id} className="rounded-md border border-zinc-100 p-3 text-sm dark:border-zinc-800">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium text-zinc-900 dark:text-zinc-50">
                  {APPROVAL_TYPE_LABELS[record.approvalType]} · {STATUS_EVENT_LABELS[record.status]}
                </span>
                <span className="text-xs text-zinc-500 dark:text-zinc-400">
                  {formatTimestamp(record.status === "REQUESTED" ? record.requestedAt : (record.decidedAt ?? record.requestedAt))}
                </span>
              </div>
              <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
                요청자: {record.requestedByName}
                {record.decidedByName && <> · 처리자: {record.decidedByName}</>}
                {record.delegatedFromName && (
                  <span className="ml-2 inline-flex items-center rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700 dark:bg-blue-950 dark:text-blue-400">
                    위임 승인 처리
                  </span>
                )}
              </p>
              {record.requestReason && (
                <p className="mt-1 text-sm text-zinc-900 dark:text-zinc-50">요청 사유: &ldquo;{record.requestReason}&rdquo;</p>
              )}
              {record.decisionReason && (
                <p className="mt-1 text-sm text-zinc-900 dark:text-zinc-50">결정 사유: &ldquo;{record.decisionReason}&rdquo;</p>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
