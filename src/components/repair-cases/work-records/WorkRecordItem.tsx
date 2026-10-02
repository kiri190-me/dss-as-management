import type { WorkRecordRow } from "@/lib/db/queries/repair-case-work-records";
import { useUiText } from "@/components/providers/UiTextProvider";
import { KyosanMemoText } from "@/components/kyosan/KyosanText";

const badgeClass =
  "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300";

/** Distinct (slightly stronger) styling from the plain step/procedure badges above, so 기록 구분 reads as the record's own classification rather than blending into its context badges. Always shown, including GENERAL. */
const recordKindBadgeClass =
  "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap bg-zinc-200 text-zinc-800 dark:bg-zinc-700 dark:text-zinc-200";

function formatDateTime(iso: string): string {
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

export default function WorkRecordItem({
  record,
  canInvalidate,
  onInvalidateClick,
  canEdit = false,
  onEditClick,
}: {
  record: WorkRecordRow;
  canInvalidate: boolean;
  onInvalidateClick?: () => void;
  /** 이 기록을 **이 사람이** 고칠 수 있는가 — 역할 권한과 「작성자 본인인가」를 부르는 쪽이 이미 합쳐서 넘긴다. 서버가 같은 판정을 다시 한다. */
  canEdit?: boolean;
  onEditClick?: () => void;
}) {
  // WorkRecordList → DatabaseWorkHistoryScreen("use client") 아래에서만 렌더된다.
  const uiText = useUiText();
  const showEditButton = canEdit && !record.isInvalidated && Boolean(onEditClick);

  return (
    <li className="rounded-md border border-zinc-100 p-3 text-sm dark:border-zinc-800">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-zinc-900 dark:text-zinc-50">{record.authorName}</span>
          <span className={recordKindBadgeClass}>{uiText.workRecordKind[record.recordKind]}</span>
          {record.workflowStepLabel && <span className={badgeClass}>{record.workflowStepLabel}</span>}
          {record.procedureNodeTitle && <span className={badgeClass}>{record.procedureNodeTitle}</span>}
          {record.isInvalidated && (
            <span className="inline-flex items-center rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium whitespace-nowrap text-red-700 dark:bg-red-950 dark:text-red-400">
              무효
            </span>
          )}
          {/* 고쳐진 기록이라는 표시 — 「고친 이력이 있는가」는 표의 칸이 아니라 이력 줄 수(editCount)로 안다. */}
          {record.editCount > 0 && (
            <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium whitespace-nowrap text-amber-800 dark:bg-amber-950 dark:text-amber-300">
              수정됨
            </span>
          )}
        </div>
        <span className="text-xs whitespace-nowrap text-zinc-500 dark:text-zinc-400">{formatDateTime(record.createdAt)}</span>
      </div>

      {/*
        🔴 교산 연락서를 넣은 기록은 이 칸에 **일본어 원문**이 그대로 들어 있다
        (저장은 원문 그대로가 계약이다 — `lib/kyosan/report-detail-values.ts`).
        `KyosanMemoText` 가 **보여 주는 층에서만** 한글을 곁들인다. 저장된 글자는
        한 글자도 바뀌지 않고, 사람이 손으로 적은 보통 기록은 그대로 보인다.
        🔴 `whitespace-pre-wrap` 은 여기 있어야 한다 — 줄바꿈과 앞뒤 공백을 그대로
        흘려보낸다. 색·취소선도 이 `<p>` 것이 그대로 물려진다(무효 처리된 기록).
      */}
      <p className={`mt-2 whitespace-pre-wrap text-sm ${record.isInvalidated ? "text-zinc-400 line-through dark:text-zinc-600" : "text-zinc-900 dark:text-zinc-50"}`}>
        <KyosanMemoText value={record.memo} />
      </p>

      {record.isInvalidated && (
        <p className="mt-2 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          무효 처리: {record.invalidatedByName} · {record.invalidatedAt && formatDateTime(record.invalidatedAt)}
          <br />
          사유: {record.invalidationReason}
        </p>
      )}

      {/*
        고친 이력 — 기본은 접혀 있다. 지금 보이는 글이 고쳐진 것이라는 사실은
        위의 「수정됨」 표가 말하고, 무엇이 어떻게 바뀌었는지는 여기서 펼쳐 본다.
        이전 글도 교산 연락서 원문일 수 있으므로 같은 `KyosanMemoText` 로 그린다.
      */}
      {record.editCount > 0 && (
        <details className="mt-2 rounded-md border border-amber-200 bg-amber-50/60 p-2 text-xs dark:border-amber-900 dark:bg-amber-950/40">
          <summary className="cursor-pointer text-amber-900 dark:text-amber-300">
            수정됨 · 최근 수정: {record.lastEditedByName} · {record.lastEditedAt && formatDateTime(record.lastEditedAt)}
            {record.editCount > 1 ? ` (총 ${record.editCount}회)` : ""}
          </summary>
          <ol className="mt-2 flex flex-col gap-2">
            {record.previousVersions.map((version, index) => (
              // 같은 글이 여러 판본에 나올 수 있어 차례가 유일한 열쇠다 —
              // 이 목록은 다시 늘어서지 않는다(한 번 그리고 끝).
              <li key={index} className="rounded-md border border-amber-200 bg-white p-2 dark:border-amber-900 dark:bg-zinc-900">
                <p className="text-zinc-500 dark:text-zinc-400">
                  수정 전 ({uiText.workRecordKind[version.recordKind]}) · {version.editedByName} · {formatDateTime(version.editedAt)}
                </p>
                <p className="mt-1 whitespace-pre-wrap text-zinc-700 dark:text-zinc-300">
                  <KyosanMemoText value={version.memo} />
                </p>
              </li>
            ))}
          </ol>
        </details>
      )}

      {((!record.isInvalidated && canInvalidate && onInvalidateClick) || showEditButton) && (
        <div className="mt-2 flex justify-end gap-2">
          {showEditButton && (
            <button
              type="button"
              onClick={onEditClick}
              className="rounded-md border border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              수정
            </button>
          )}
          {!record.isInvalidated && canInvalidate && onInvalidateClick && (
            <button
              type="button"
              onClick={onInvalidateClick}
              className="rounded-md border border-red-300 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950"
            >
              무효 처리
            </button>
          )}
        </div>
      )}
    </li>
  );
}
