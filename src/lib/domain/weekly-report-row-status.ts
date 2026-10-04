import {
  classifyWeeklyReportStatus,
  weeklyReportStatusLabels,
  type WeeklyReportClassifiable,
  type WeeklyReportStatus,
} from "./weekly-report";

/**
 * ============================================================================
 * 상세표 한 칸이 보여 주는 상태 — 집계 6칸과 **일부러 다르다**
 * ============================================================================
 * 주간보고에는 숫자를 세는 자리와 줄마다 글자를 적는 자리가 있고, 2026-10-04
 * 사용자 결정으로 **그 둘이 보는 칸의 수가 다르다.**
 *
 *   집계 블록      6칸 — weekly-report.ts 의 WEEKLY_REPORT_STATUSES
 *   상세표 한 칸    7칸 — 여기. 6칸에 **수리 완료**가 하나 더 붙는다
 *
 * 수리 완료(REPAIR_COMPLETED)인 건은 **집계에서는 '수리 중' 숫자에 들어가고**
 * (classifyWeeklyReportStatus 가 그렇게 보낸다 — 사용자 결정, commit 7cb955b),
 * **상세표에는 '수리 완료'라고 적힌다.** 숫자는 묶어 보고 줄은 사실대로 보는 것이
 * 사용자가 원한 모양이다.
 *
 * ── 왜 이 함수가 따로 있어야 하는가 ─────────────────────────────────────
 * 이 칸은 글자만 적는 자리가 아니라 **고르개**이기도 하다(WeeklyReportStatusCell).
 * 6칸만 보여 주던 동안에는 수리 완료인 건이 '수리 중'으로 적히고, 고르개에는 그
 * 값이 아예 없어서 **고른 값과 표에 적히는 값이 달랐다.** 글자·고르개·갈 단계
 * 고르기 셋이 전부 이 한 함수를 보면 그 어긋남이 생길 자리가 없다.
 *
 * ── 🔴 집계는 건드리지 않는다 ───────────────────────────────────────────
 * classifyWeeklyReportStatus 와 WEEKLY_REPORT_STATUSES(6칸),
 * weeklyReportStatusLabels(6칸 이름표)는 **그대로다.** 여기서는 그것을 읽어 쓰기만
 * 한다 — 6칸짜리 표를 7칸으로 늘리면 집계 블록이 그 표를 돌면서 있지도 않은
 * 일곱 번째 칸을 그리고, 칸의 합과 총 대수가 어긋난다.
 *
 * ── 순수 함수다 ─────────────────────────────────────────────────────────
 * 이웃 weekly-report-status-step.ts 와 같은 이유로 src/lib/db/ 아래에 두지 않는다 —
 * 이 저장소의 단위 시험은 DATABASE_URL 없이 돌도록 막혀 있어
 * (scripts/load-template-env.ts), 거기 둔 함수는 단위 시험이 불러올 수조차 없다.
 * ============================================================================
 */

/**
 * 상세표 한 칸이 보여 주는 값. 집계 6칸 + 수리 완료.
 *
 * 6칸을 베껴 적지 않고 **유니온으로 얹는다** — 집계 칸이 늘거나 줄면 이쪽도
 * 저절로 따라간다.
 */
export type WeeklyReportRowStatus = WeeklyReportStatus | "REPAIR_COMPLETED";

/**
 * 고르개에 늘어놓는 차례. **수리 완료는 수리 중 바로 다음**이다(사용자 결정
 * 2026-10-04) — 그 둘이 집계에서 한 칸으로 합쳐지는 짝이라, 떨어뜨려 놓으면
 * 목록만 보고는 왜 숫자가 둘 다 '수리 중'에 들어가는지 알 수 없다.
 *
 * `satisfies` 로 묶어 둔 것은 오타와 없는 칸을 컴파일에서 막기 위해서다. 6칸이
 * 하나도 빠지지 않았는지는 시험이 값으로 본다(weekly-report-row-status.test.ts) —
 * 타입만으로는 "빠뜨리지 않았다"를 말할 수 없다.
 */
export const WEEKLY_REPORT_ROW_STATUSES = [
  "INSPECTION_WAITING",
  "INSPECTION_IN_PROGRESS",
  "REPAIR_WAITING",
  "IN_REPAIR",
  "REPAIR_COMPLETED",
  "PO_WAITING",
  "SHIPMENT_WAITING",
] as const satisfies readonly WeeklyReportRowStatus[];

/**
 * 7칸의 이름표. 집계가 쓰는 6칸 표를 **감싸 쓴다** — 같은 칸에 두 벌의 글자가
 * 생기면 집계 블록과 상세표가 같은 것을 다르게 부르는 날이 온다.
 *
 * '수리 완료'는 접수 건 상태의 이름표(domain/types.ts 의 repairStatusLabels)와
 * 같은 글자다. 그 표를 끌어다 쓰지 않는 이유는 weeklyReportStatusLabels 가 그렇게
 * 하지 않는 이유와 같다 — 이 표의 글자는 **원본 엑셀의 말**이고, 상태 이름표는
 * 화면 문구 덮어쓰기(ui-text-overrides.ts)로 운영 중에 바뀔 수 있는 값이다.
 */
export const weeklyReportRowStatusLabels: Record<WeeklyReportRowStatus, string> = {
  ...weeklyReportStatusLabels,
  REPAIR_COMPLETED: "수리 완료",
};

/**
 * 이 줄의 `현 상태` 칸에 무엇이 적히는가. 어느 칸에도 안 맞으면 null 이다 —
 * 그 줄은 화면이 **분류 안 됨**으로 빨갛게 드러낸다.
 *
 * 규칙은 한 줄이다: 수리 완료면 수리 완료, 아니면 집계가 센 칸 그대로.
 *
 * null 이 되는 조합은 classifyWeeklyReportStatus 와 **정확히 같다** —
 * REPAIR_COMPLETED 는 저쪽에서도 '수리 중'으로 갈려 null 이 아니었다. 그래서 이
 * 변경으로 분류 안 됨이 늘지도 줄지도 않는다.
 */
export function classifyWeeklyReportRowStatus(
  row: WeeklyReportClassifiable
): WeeklyReportRowStatus | null {
  if (row.status === "REPAIR_COMPLETED") return "REPAIR_COMPLETED";
  return classifyWeeklyReportStatus(row);
}

/**
 * 클라이언트가 보낸 값이 실제로 7칸 중 하나인가. 서버 액션의 입력 형식 검증용이다.
 *
 * 목록을 여기 베껴 적지 않고 WEEKLY_REPORT_ROW_STATUSES 를 그대로 읽는다 — 칸이
 * 늘거나 줄면 이 검사도 함께 따라가야 한다.
 *
 * ⚠️ REPAIR_COMPLETED 는 **접수 건 상태(RepairStatus)의 이름이기도 하다.** 이
 * 검사를 통과한다고 해서 상태 값을 그대로 받는다는 뜻은 아니다 — 나머지 여섯은
 * 여전히 분류 이름뿐이고(WAITING_SHIPMENT 같은 상태 이름은 떨어진다), 받은 값이
 * 어느 단계로 번역되는지는 pickNearestStepForWeeklyReportStatus 가 정한다.
 */
export function isWeeklyReportRowStatus(value: unknown): value is WeeklyReportRowStatus {
  return (
    typeof value === "string" && (WEEKLY_REPORT_ROW_STATUSES as readonly string[]).includes(value)
  );
}
