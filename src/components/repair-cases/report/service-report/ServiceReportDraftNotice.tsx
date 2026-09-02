"use client";

import { formatServiceReportDraftSavedAt } from "@/lib/domain/service-report-draft";

/**
 * ============================================================================
 * 임시보관 안내 — 지금 적는 것이 어디에 남는지 한 줄로 알린다
 * ============================================================================
 * 이 화면에는 **아직 DB 에 저장하는 표가 없다.** 그 사실을 사람이 모르면 두 가지가
 * 다 나쁘게 흘러간다 — 남는 줄 알고 안심했다가 잃거나, 안 남는 줄 알고 매번
 * 처음부터 다시 적거나.
 *
 * ⚠️ 접수 화면의 `new/DraftStatusLine.tsx` 와 **반대되는 말**을 한다(그쪽은 "작성
 * 중인 내용은 저장되지 않습니다"). 그래서 그 파일을 고쳐 쓰지 않고 새로 두었다 —
 * 한 파일이 두 화면에서 서로 다른 말을 하게 만들면 한쪽을 고칠 때 다른 쪽이
 * 조용히 거짓말을 시작한다.
 *
 * 🔴 되살린 뒤에는 **「새로 시작」 이 반드시 함께 있어야 한다.** 되살리기만 있고
 * 버리는 길이 없으면, 지난번에 잘못 적어 둔 것을 물려받은 사람이 칸을 하나하나
 * 지워야 한다.
 * ============================================================================
 */

export default function ServiceReportDraftNotice({
  restored,
  savedAt,
  onDiscard,
  disabled,
}: {
  /** 임시보관을 되살렸는가. 서버 렌더와 첫 그림에서는 늘 false 다. */
  restored: boolean;
  /** 그 임시보관을 적어 둔 시각(ISO 8601). 모르면 null. */
  savedAt: string | null;
  /** 「새로 시작」 — 임시보관을 지우고 자동 채움된 처음 상태로 돌아간다. */
  onDiscard: () => void;
  disabled?: boolean;
}) {
  if (!restored) {
    return (
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        적는 내용은 이 브라우저에 임시로 보관됩니다 — 새로고침하거나 나갔다 와도 그대로입니다.
        (아직 서버에는 저장되지 않습니다.)
      </p>
    );
  }

  const at = formatServiceReportDraftSavedAt(savedAt);

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
      <p>
        임시로 보관해 둔 내용을 되살렸습니다
        {/* 시각을 못 읽었으면 지어내지 않고 말없이 뺀다. */}
        {at !== null && <span className="text-xs"> · {at} 에 보관</span>}
      </p>
      <button
        type="button"
        onClick={onDiscard}
        disabled={disabled}
        className="rounded-md border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-amber-800 dark:bg-transparent dark:text-amber-300 dark:hover:bg-amber-900"
      >
        새로 시작
      </button>
    </div>
  );
}
