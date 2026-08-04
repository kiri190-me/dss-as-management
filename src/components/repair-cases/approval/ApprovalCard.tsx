import type { ReactNode } from "react";
import ApprovalStatusBadge from "./ApprovalStatusBadge";
import type { DisplayApprovalStatus, LocalApprovalRecord } from "@/lib/domain/local/approval/approval-types";

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

export type ApprovalActionButton = {
  key: string;
  label: string;
  onClick: () => void;
  tone?: "default" | "danger";
};

type ApprovalCardProps = {
  title: string;
  record: LocalApprovalRecord | null;
  displayStatus: DisplayApprovalStatus;
  extra?: ReactNode;
  blockedNotice?: string | null;
  actions: ApprovalActionButton[];
  disabledReason?: string | null;
};

/**
 * 검수 승인 카드와 출하 승인 카드가 공유하는 표시 컴포넌트다. 두 카드의
 * 레이아웃/필드 표시 로직을 이 컴포넌트 하나로 통일한다.
 */
export default function ApprovalCard({
  title,
  record,
  displayStatus,
  extra,
  blockedNotice,
  actions,
  disabledReason,
}: ApprovalCardProps) {
  return (
    <section className="flex flex-col gap-3 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{title}</h2>
        <ApprovalStatusBadge status={displayStatus} />
      </div>

      {extra}

      {blockedNotice && (
        <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
          {blockedNotice}
        </p>
      )}

      <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
        <Field label="요청자" value={record?.requestedByNameSnapshot ?? null} />
        <Field label="승인자" value={record?.decidedByNameSnapshot ?? null} />
        <Field label="요청 시각" value={formatTimestamp(record?.requestedAt ?? null)} />
        <Field label="결정 시각" value={formatTimestamp(record?.decidedAt ?? null)} />
      </dl>
      <Field label="결정 코멘트" value={record?.decisionComment ?? null} />

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
    </section>
  );
}
