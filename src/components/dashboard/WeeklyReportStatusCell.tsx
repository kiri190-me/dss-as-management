"use client";

import { useState, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { showSavePopup } from "@/components/common/SavePopup";
import { setWeeklyReportStatusAction } from "@/lib/server/actions/set-weekly-report-status";
import { isWeeklyReportStatus } from "@/lib/domain/weekly-report-status-step";
import {
  WEEKLY_REPORT_STATUSES,
  weeklyReportStatusLabels,
  type WeeklyReportStatus,
} from "@/lib/domain/weekly-report";

/**
 * ============================================================================
 * 주간보고 상세표의 `현 상태` 한 칸 — 화면에서 바로 바꾸는 자리
 * ============================================================================
 * 바로 옆 `비고` 칸(WeeklyReportNotesCell)이 본보기다. 같은 규율 둘을 그대로
 * 따른다:
 *
 *  - 🔴 **못 바꾸는 사람에게는 이 칸을 아예 그리지 않는다.** 이 표는 250줄이
 *    넘는다. 줄마다 클라이언트 컴포넌트를 붙이면 접수 건의 id 와 version 이
 *    통째로 브라우저로 실려 간다. 그 판정은 부르는 쪽(WeeklyReportScreen)이
 *    하고, 거짓이면 지금까지와 **똑같이 글자만** 그린다.
 *  - 🔴 그 판정은 **화면을 그리기 위한 값일 뿐 관문이 아니다.** 이 칸을 억지로
 *    띄워 요청을 보내도 서버가 세션·역할·보류·잠금·버전을 처음부터 다시 읽어
 *    막는다(server/actions/set-weekly-report-status.ts).
 *
 * ── 보내는 것은 **분류**이지 단계가 아니다 ───────────────────────────────
 * 이 칸이 보여 주는 6칸은 저장되는 값이 아니라 지금 서 있는 워크플로 단계에서
 * 계산되는 값이다. 그래서 고른 분류를 그대로 보내고, **어느 단계로 갈지는
 * 서버가 정한다**(지금 단계에서 가장 가까운 단계 —
 * domain/weekly-report-status-step.ts). 화면이 단계를 고르게 하면 이 표를 보는
 * 사람이 단계 20개를 알아야 하고, 그것은 이 칸이 분류 6칸으로 접혀 있는 뜻과
 * 정면으로 어긋난다.
 *
 * ── `수정` 버튼이 없고, 고르면 곧바로 나간다 ─────────────────────────────
 * 비고 칸이 `수정` 을 달지 않은 것과 같은 까닭이다 — 250줄짜리 표의 오른쪽이
 * 단추로 뒤덮이면 정작 읽어야 할 값이 묻힌다. 고르개는 그 자체가 누를 수 있는
 * 것으로 보이고 키보드로도 닿으므로, 비고 칸이 글자를 `<button>` 으로 만들어
 * 메워야 했던 자리가 여기서는 처음부터 없다.
 *
 * ── 지금과 같은 값을 고르면 아무 일도 하지 않는다 ───────────────────────
 * `<select>` 는 같은 값을 다시 고르면 onChange 가 아예 뜨지 않지만, 저장이
 * 실패해 고르개를 되돌린 뒤에는 다시 뜬다. 그때는 **다시 보내는 것이 맞다**(그
 * 사람은 재시도를 누른 것이다). 그래서 비교 상대는 화면 상태가 아니라 서버가
 * 방금 그려 준 값(reportStatus)이다.
 *
 * ── 오류는 **그 줄에서** 말한다 ─────────────────────────────────────────
 * 250줄짜리 표에서 맨 위 알림은 아무도 못 본다. 성공만 저장 팝업으로 알리고
 * (common/SavePopup 은 0.5초 뒤 저절로 닫히는 성공 전용 알림이다), 실패는 이
 * 칸 아래에 남겨 둔다 — 보류 중이거나 출하 잠금인 줄은 **줄마다 다른 값**이라
 * 화면이 미리 알 수 없고, 그 사실을 사람에게 말해 주는 자리가 여기뿐이다.
 * ============================================================================
 */
export default function WeeklyReportStatusCell({
  repairCaseId,
  version,
  reportStatus,
}: {
  repairCaseId: string;
  /** repair_cases.version — 낙관적 잠금 값(조회가 줄마다 실어 온다). */
  version: number;
  /**
   * 서버가 방금 계산해 그려 준 분류. **null 이면 분류 안 됨**이고, 그 줄도
   * 바꿀 수 있어야 한다 — 오히려 바꿔야 할 줄이다. 빨간 딱지는 부르는 쪽이
   * 그대로 그린다(WeeklyReportScreen).
   */
  reportStatus: WeeklyReportStatus | null;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<WeeklyReportStatus | "">(reportStatus ?? "");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleChange(event: ChangeEvent<HTMLSelectElement>) {
    const next = event.target.value;
    // 분류 안 된 줄의 빈 자리(아래 placeholder)를 도로 고른 경우. 보낼 값이 없다.
    if (!isWeeklyReportStatus(next)) return;
    if (next === reportStatus || isSubmitting) return;

    setSelected(next);
    setError(null);
    setIsSubmitting(true);
    try {
      const result = await setWeeklyReportStatusAction({
        repairCaseId,
        expectedVersion: version,
        status: next,
      });
      if (!result.ok) {
        // 서버가 막았으면 고르개도 사실대로 되돌린다 — 바뀌지 않은 값을 골라 둔
        // 채로 두면 다음에 이 화면을 보는 사람이 바뀐 줄로 읽는다.
        setSelected(reportStatus ?? "");
        setError(result.message);
        return;
      }
      router.refresh();
      showSavePopup({ message: "현 상태를 변경했습니다.", redirectTo: null });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    // whitespace-normal 은 장식이 아니다 — 이 표의 `<tr>` 이 whitespace-nowrap
    // 이라, 이것이 없으면 오류 문구가 한 줄로 뻗어 표를 옆으로 밀어 버린다
    // (비고 칸이 같은 까닭으로 같은 값을 쓴다).
    <span className="flex flex-col gap-1 whitespace-normal">
      <select
        value={selected}
        disabled={isSubmitting}
        onChange={handleChange}
        aria-label="현 상태"
        title="현 상태 변경"
        // 🔴 종이에서는 **지금까지와 같은 글자**로 찍힌다(아래 인쇄 변형들). 이 화면은
        // 그대로 인쇄해 쓰는 종이라, 250줄이 고르개 상자로 뒤덮이면 읽을 수 없는
        // 종이가 된다. appearance-none 이 함께 있어야 화살표까지 사라진다.
        className="max-w-full rounded border border-zinc-300 bg-white px-1 py-0.5 text-wr-body text-zinc-900 disabled:opacity-50 print:appearance-none print:border-0 print:bg-transparent print:px-0 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
      >
        {/* 분류 안 된 줄에만 있는 빈 자리. 6칸 중 어느 것도 지금 값이 아니므로
            고를 것이 없는 상태를 그대로 보여 준다 — 아무 칸이나 골라 둔 것처럼
            그리면 이미 그 분류인 줄로 읽힌다. */}
        {reportStatus === null && <option value="">선택</option>}
        {WEEKLY_REPORT_STATUSES.map((status) => (
          <option key={status} value={status}>
            {weeklyReportStatusLabels[status]}
          </option>
        ))}
      </select>
      {error && (
        <span
          role="alert"
          className="rounded border border-red-200 bg-red-50 px-1 py-0.5 text-wr-meta text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
        >
          {error}
        </span>
      )}
    </span>
  );
}
