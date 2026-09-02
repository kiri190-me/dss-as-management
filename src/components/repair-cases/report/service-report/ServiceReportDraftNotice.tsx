"use client";

import { formatServiceReportDraftSavedAt } from "@/lib/domain/service-report-draft";

/**
 * ============================================================================
 * 임시보관 안내 — 지금 적는 것이 어디에 남는지 한 줄로 알린다
 * ============================================================================
 * ⚠️ 접수 화면의 `new/DraftStatusLine.tsx` 와 **반대되는 말**을 한다(그쪽은 "작성
 * 중인 내용은 저장되지 않습니다"). 그래서 그 파일을 고쳐 쓰지 않고 새로 두었다 —
 * 한 파일이 두 화면에서 서로 다른 말을 하게 만들면 한쪽을 고칠 때 다른 쪽이
 * 조용히 거짓말을 시작한다.
 *
 * 🔴 되살린 뒤에는 **버리는 길이 반드시 함께 있어야 한다.** 되살리기만 있고
 * 버리는 길이 없으면, 지난번에 잘못 적어 둔 것을 물려받은 사람이 칸을 하나하나
 * 지워야 한다.
 *
 * ── 🔴 DB 저장이 생긴 뒤로 말이 둘로 갈린다 ────────────────────────────
 * 임시보관의 뜻이 «아직 저장하지 못한 것» 하나로 좁혀졌기 때문에
 * (`domain/service-report-draft.ts` 의 재판단), 같은 안내라도 어느 쪽을 보고
 * 있느냐에 따라 **버리는 것이 무엇인지가 다르다**:
 *
 *   · 새 장(`NEW`)   — 버리면 자동 채움된 처음 상태로 돌아간다. 「새로 시작」.
 *   · 저장된 장(`SAVED`) — 버리면 **서버에 저장된 내용**이 다시 보인다. 그래서
 *     「새로 시작」이라고 말하면 안 된다 — 저장된 보고서까지 사라지는 것처럼
 *     읽힌다. 「저장된 내용으로」다.
 *
 * 그리고 저장된 장에 임시보관이 남아 있다는 것은 «저장하지 못한 채 나갔다»는
 * 뜻이라, 그 사실을 그대로 적어 준다. 그래야 사람이 지금 보고 있는 것이 저장된
 * 문서가 아니라는 것을 안다.
 * ============================================================================
 */

export default function ServiceReportDraftNotice({
  mode,
  restored,
  savedAt,
  onDiscard,
  disabled,
}: {
  /** 새 장을 적는 중인가, 저장된 장을 고치는 중인가. */
  mode: "NEW" | "SAVED";
  /** 임시보관을 되살렸는가. 서버 렌더와 첫 그림에서는 늘 false 다. */
  restored: boolean;
  /** 그 임시보관을 적어 둔 시각(ISO 8601). 모르면 null. */
  savedAt: string | null;
  /** 임시보관을 지우고 — 새 장이면 처음 상태로, 저장된 장이면 저장된 내용으로. */
  onDiscard: () => void;
  disabled?: boolean;
}) {
  if (!restored) {
    return (
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        적는 내용은 이 브라우저에 임시로 보관됩니다 — 새로고침하거나 나갔다 와도 그대로입니다.
        {mode === "SAVED"
          ? " [저장]을 눌러야 서버의 보고서가 바뀝니다."
          : " [저장하기]를 눌러야 서버에 남습니다."}
      </p>
    );
  }

  const at = formatServiceReportDraftSavedAt(savedAt);

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
      <p>
        {mode === "SAVED"
          ? "저장된 내용 대신, 아직 저장하지 못한 임시보관을 되살렸습니다"
          : "임시로 보관해 둔 내용을 되살렸습니다"}
        {/* 시각을 못 읽었으면 지어내지 않고 말없이 뺀다. */}
        {at !== null && <span className="text-xs"> · {at} 에 보관</span>}
      </p>
      <button
        type="button"
        onClick={onDiscard}
        disabled={disabled}
        className="rounded-md border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-amber-800 dark:bg-transparent dark:text-amber-300 dark:hover:bg-amber-900"
      >
        {mode === "SAVED" ? "저장된 내용으로" : "새로 시작"}
      </button>
    </div>
  );
}
