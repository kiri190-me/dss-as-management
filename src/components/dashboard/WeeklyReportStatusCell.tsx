"use client";

import { useWeeklyReportBlockStatusRow } from "./WeeklyReportBlockStatusEdit";
import {
  WEEKLY_REPORT_ROW_STATUSES,
  weeklyReportRowStatusLabels,
} from "@/lib/domain/weekly-report-row-status";

/**
 * ============================================================================
 * 주간보고 상세표의 `현 상태` 한 칸 — 🔴 **여는 것은 블록 머리줄이다**
 * ============================================================================
 * 이 칸에는 버튼이 없다. 자기 상태도 없다. 그 블록이 편집 중인지, 무엇이 골라져
 * 있는지, 오류가 무엇인지를 전부 **블록 Provider 에서 읽어** 그리기만 한다
 * (WeeklyReportBlockStatusEdit). 그래서 받는 prop 도 자기를 가리키는 id 하나다.
 *
 * ── 🔴 왜 줄마다 있던 `수정` 버튼을 걷어냈는가 (2026-10-05 사용자 요청) ───
 * 같은 날 오전에는 이 칸마다 `수정`·`취소`·`저장` 이 붙어 있었다. 사용자가
 * **「하나하나 눌러야 해서 번거롭다」**고 해서, 그 셋을 **고객사 블록 머리줄의
 * 버튼 하나**로 옮겼다 — `수정` 한 번에 그 블록의 `현 상태` 칸이 전부 열리고,
 * `저장` 한 번에 **바뀐 줄만** 나간다.
 *
 * 바로 몇 시간 전 결정이 또 바뀐 자리라 경위를 남긴다. 되돌리지 **않은** 것도
 * 함께 적어 둔다: 고르는 즉시 보내던 맨 처음 방식은 그대로 폐기다. 250줄짜리
 * 표를 훑어 내려가다 고르개에 손이 닿으면 **확인할 틈 없이 워크플로 단계가
 * 옮겨지고 이력이 남는다.** `저장` 을 한 번 더 누르게 하는 뜻이 거기 있고, 그
 * 한 번이 줄마다에서 블록마다로 옮겨 갔을 뿐이다.
 *
 * 옆 `비고` 칸(WeeklyReportNotesCell)이 버튼 없이 글자를 눌러 여는 것과 **일부러
 * 다르다.** 저쪽이 보내는 것은 그 칸의 글자뿐이지만 이쪽이 보내는 것은 **워크플로
 * 단계 이동**이다 — 되돌리려면 또 한 번 단계를 옮겨야 하고 그만큼 이력이 쌓인다.
 *
 * ── 🔴 못 바꾸는 사람에게는 이 칸을 아예 그리지 않는다 ──────────────────
 * 이 표는 250줄이 넘는다. 줄마다 클라이언트 컴포넌트를 붙이면 접수 건의 id 와
 * version 이 통째로 브라우저로 실려 간다. 그 판정은 부르는 쪽
 * (WeeklyReportScreen 의 StatusCell)이 하고, 거짓이면 지금까지와 **똑같이 글자만**
 * 그린다 — Provider 도 그리지 않는다.
 *
 * 🔴 그 판정은 **화면을 그리기 위한 값일 뿐 관문이 아니다.** 이 칸을 억지로
 * 띄워 요청을 보내도 서버가 세션·역할·보류·잠금·버전을 처음부터 다시 읽어
 * 막는다(server/actions/set-weekly-report-status.ts).
 *
 * ── 보내는 것은 **칸**이지 단계가 아니다 ─────────────────────────────────
 * 이 칸이 보여 주는 7칸은 저장되는 값이 아니라 지금 서 있는 워크플로 단계에서
 * 계산되는 값이다. 그래서 고른 칸을 그대로 보내고, **어느 단계로 갈지는
 * 서버가 정한다**(지금 단계에서 가장 가까운 단계 —
 * domain/weekly-report-status-step.ts). 화면이 단계를 고르게 하면 이 표를 보는
 * 사람이 단계 20개를 알아야 하고, 그것은 이 칸이 7칸으로 접혀 있는 뜻과 정면으로
 * 어긋난다.
 *
 * ── 🔴 고르개의 7칸은 **집계 블록의 6칸이 아니다** ───────────────────────
 * 위 집계는 수리 완료를 '수리 중'에 합쳐 6칸으로 세지만, 이 줄에는 '수리 완료'가
 * 그대로 적힌다(사용자 결정 2026-10-04). 목록도 이름표도
 * domain/weekly-report-row-status.ts 의 7칸짜리를 쓴다 — 6칸짜리
 * WEEKLY_REPORT_STATUSES 를 쓰면 수리 완료인 건에서 **고른 값과 표에 적히는
 * 값이 달라진다**(그 값을 고를 수조차 없다). 바로 그것이 이 칸을 7칸으로 늘린
 * 까닭이다.
 *
 * ── 오류는 **그 줄에서** 말한다 ─────────────────────────────────────────
 * 250줄짜리 표에서 맨 위 알림은 아무도 못 본다. 성공만 저장 팝업으로 알리고
 * (머리줄의 `저장` 이 띄운다), 실패는 그 줄 아래에 남는다 — 보류 중이거나 출하
 * 잠금인 줄은 **줄마다 다른 값**이라 화면이 미리 알 수 없고, 그 사실을 사람에게
 * 말해 주는 자리가 여기뿐이다.
 *
 * 🔴 고르개는 **종이에 지금까지와 같은 글자로** 찍힌다(아래 인쇄 변형 넷). 이
 * 화면은 그대로 인쇄해 쓰는 종이라, 250줄이 고르개 상자로 뒤덮이면 읽을 수 없는
 * 종이가 된다.
 * ============================================================================
 */

export default function WeeklyReportStatusCell({ repairCaseId }: { repairCaseId: string }) {
  const { isEditing, isSubmitting, rowStatus, selected, error, onChange } =
    useWeeklyReportBlockStatusRow(repairCaseId);

  if (!isEditing) {
    // 못 고치는 사람이 보는 것과 **똑같이 글자만**이다. 분류 안 된 줄
    // (rowStatus === null)에는 **아무 글자도 적지 않는다** — 빨간 딱지를 부르는
    // 쪽이 이미 그리고 있어(WeeklyReportScreen 의 UNCLASSIFIED_BADGE_TONE)
    // 여기서 또 적으면 딱지가 둘이 된다.
    return <>{rowStatus !== null && weeklyReportRowStatusLabels[rowStatus]}</>;
  }

  return (
    // whitespace-normal 은 장식이 아니다 — 이 표의 `<tr>` 이 whitespace-nowrap
    // 이라, 이것이 없으면 오류 문구가 한 줄로 뻗어 표를 옆으로 밀어 버린다
    // (비고 칸이 같은 까닭으로 같은 값을 쓴다).
    <span className="flex flex-col gap-1 whitespace-normal">
      <select
        value={selected}
        disabled={isSubmitting}
        onChange={onChange}
        aria-label="현 상태"
        title="현 상태 변경"
        // 🔴 종이에서는 **지금까지와 같은 글자**로 찍힌다(아래 인쇄 변형들). 이 화면은
        // 그대로 인쇄해 쓰는 종이라, 250줄이 고르개 상자로 뒤덮이면 읽을 수 없는
        // 종이가 된다. appearance-none 이 함께 있어야 화살표까지 사라진다.
        className="max-w-full rounded border border-zinc-300 bg-white px-1 py-0.5 text-wr-body text-zinc-900 disabled:opacity-50 print:appearance-none print:border-0 print:bg-transparent print:px-0 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
      >
        {/* 분류 안 된 줄에만 있는 빈 자리. 7칸 중 어느 것도 지금 값이 아니므로
            고를 것이 없는 상태를 그대로 보여 준다 — 아무 칸이나 골라 둔 것처럼
            그리면 이미 그 칸인 줄로 읽힌다. */}
        {rowStatus === null && <option value="">선택</option>}
        {WEEKLY_REPORT_ROW_STATUSES.map((status) => (
          <option key={status} value={status}>
            {weeklyReportRowStatusLabels[status]}
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
