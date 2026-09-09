import type { ReactNode } from "react";
import DatabaseApprovalStatusBadge, { type DatabaseDisplayApprovalStatus } from "./DatabaseApprovalStatusBadge";
import type { ApprovalRecordRow } from "@/lib/db/queries/repair-case-approvals";

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-xs text-zinc-500 dark:text-zinc-400">{label}</dt>
      <dd className="text-sm text-zinc-900 dark:text-zinc-50">{value ?? "-"}</dd>
    </div>
  );
}

function formatTimestamp(iso: string | null): string | null {
  if (!iso) return null;
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
 * delegatedFromName is only ever non-null on a FINAL_SHIPMENT row (schema
 * CHECK constraint), so this branch never fires for REPAIR_INSPECTION —
 * safe to compute unconditionally here rather than needing an
 * approvalType prop.
 */
function decidedByLabel(record: ApprovalRecordRow | null): string | null {
  if (!record?.decidedByName) return null;
  if (!record.delegatedFromName) return record.decidedByName;
  return `${record.decidedByName} (${record.delegatedFromName}를 대신하여 승인)`;
}

export type DatabaseApprovalActionButton = {
  key: string;
  label: string;
  onClick: () => void;
  tone?: "default" | "danger";
};

type DatabaseApprovalCardProps = {
  title: string;
  record: ApprovalRecordRow | null;
  displayStatus: DatabaseDisplayApprovalStatus;
  extra?: ReactNode;
  blockedNotice?: string | null;
  actions: DatabaseApprovalActionButton[];
  disabledReason?: string | null;
  /**
   * 조작 결과 한 줄(요청했습니다 / 처리되었습니다, 그리고 서버가 거절한 이유).
   * 카드 **안**에 두는 이유: 부모가 이 카드들을 2열 격자에 놓으므로, 카드 밖
   * 형제로 두면 이 문단이 격자 칸 하나를 먹어 옆 카드가 다음 줄로 밀린다.
   */
  statusMessage?: string | null;
};

/**
 * Database-mode counterpart to ApprovalCard.tsx — same layout/field
 * choices, typed against the DB-backed ApprovalRecordRow instead of
 * LocalApprovalRecord. No decisionComment-required CHANGES_REQUESTED
 * status here (see repair-case-approvals.ts schema comment).
 */
export default function DatabaseApprovalCard({
  title,
  record,
  displayStatus,
  extra,
  blockedNotice,
  actions,
  disabledReason,
  statusMessage,
}: DatabaseApprovalCardProps) {
  return (
    <section className="flex flex-col gap-3 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{title}</h2>
        <DatabaseApprovalStatusBadge status={displayStatus} />
      </div>

      {extra}

      {blockedNotice && (
        <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
          {blockedNotice}
        </p>
      )}

      <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
        <Field label="요청자" value={record?.requestedByName ?? null} />
        <Field label="승인자" value={decidedByLabel(record)} />
        <Field label="요청 시각" value={formatTimestamp(record?.requestedAt ?? null)} />
        <Field label="결정 시각" value={formatTimestamp(record?.decidedAt ?? null)} />
      </dl>
      <Field label="요청 사유" value={record?.requestReason ?? null} />
      <Field label="결정 사유" value={record?.decisionReason ?? null} />

      <div className="flex flex-wrap items-center gap-2 border-t border-zinc-100 pt-3 dark:border-zinc-800">
        {actions.length > 0 ? (
          actions.map((action) => (
            <button
              key={action.key}
              type="button"
              onClick={action.onClick}
              className={
                action.tone === "danger"
                  ? "rounded-md border border-red-300 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950"
                  : "rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
              }
            >
              {action.label}
            </button>
          ))
        ) : disabledReason ? (
          <p className="text-xs text-zinc-500 dark:text-zinc-400">{disabledReason}</p>
        ) : null}
      </div>

      {/*
        읽어 주기(role="status")는 여기 붙이지 않는다 — 호출부가 이미 sr-only
        문단 하나로 알리고 있어서, 여기에 또 붙이면 두 번 읽힌다.
      */}
      {statusMessage && <p className="text-xs text-zinc-500 dark:text-zinc-400">{statusMessage}</p>}
    </section>
  );
}
