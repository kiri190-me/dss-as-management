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
    /*
      🔴 `break-keep`(word-break: keep-all)을 **껍데기에** 건다. word-break 는 물려받는
      속성이라 여기 한 자리에 걸면 카드 안의 한국어 문장이 모두 어절 경계에서만
      접힌다 — 한글은 기본 규칙으로 어절 중간에서 잘려서, 좁은 칸에서 「…유효한 위임 /
      을 받은…」처럼 끊겼다. 이 껍데기가 그리는 문장들(지정 안내·비상구 안내·서버가
      거절한 이유, 그리고 사람이 쓴 요청 사유·결정 사유)은 전부 string 프롭으로
      들어오므로 **카드 부품 쪽에서는 감쌀 방법이 없다.** 인쇄용 양식도 같은 이유로
      같은 속성을 쓴다(ServiceReportPrintView).

      🔴 두 카드(수리 검수 승인·최종 출하 승인)가 이 껍데기를 함께 쓰므로 함께 바뀐다 —
      그것이 의도다. 같은 결함을 둘 다 갖고 있었다.

      ⚠️ 「어떤 폭에서도 무조건 한 줄」이 목표가 아니다. 창을 좁히면 접혀야 한다 —
      whitespace-nowrap 으로 밀어 넣으면 글자가 상자 밖으로 넘친다. 예외는 호출부가
      extra 로 넣는 결재선 미리보기의 이름 상자뿐이고, 거기는 whitespace-nowrap 이
      word-break 를 이겨(줄바꿈 자체를 막는다) 지금처럼 **그 상자 안에서** 가로로 밀린다.
    */
    <section className="flex flex-col gap-3 break-keep rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
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

      {/*
        「지정 승인자」도 이 격자 **안**에 둔다 — 카드 밖 형제로 내보내면
        부모(2열 격자)의 칸 하나를 먹어 옆 카드가 다음 줄로 밀린다.
        지정이 없으면 Field 가 다른 칸들과 똑같이 `-` 로 그린다. 그것이 정상
        상태다(= 자격 있는 사람 누구나 처리).
      */}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
        <Field label="요청자" value={record?.requestedByName ?? null} />
        <Field label="승인자" value={decidedByLabel(record)} />
        <Field label="지정 승인자" value={record?.assignedApproverName ?? null} />
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
