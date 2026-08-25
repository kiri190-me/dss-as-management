import WeeklyReportDeliveriesPanel from "./WeeklyReportDeliveriesPanel";
import WeeklyReportGoalsPanel from "./WeeklyReportGoalsPanel";
import type { RepairCaseLinkOption } from "@/lib/db/queries/domestic-orders";
import type { WeeklyReportDeliveryRow } from "@/lib/db/queries/weekly-report-deliveries";
import type { WeeklyReportGoalRow } from "@/lib/db/queries/weekly-report-goals";
import { customerRowColorClass } from "@/lib/domain/customer-row-color";
import {
  WEEKLY_REPORT_PO_ISSUED_LABEL,
  WEEKLY_REPORT_STATUSES,
  WEEKLY_REPORT_TOTAL_LABEL,
  pairWeeklyReportBlocksByCustomer,
  summarizeWeeklyReportPoIssuance,
  sumWeeklyReportStatusCounts,
  weeklyReportKindDescriptions,
  weeklyReportStatusLabels,
  type WeeklyReport,
  type WeeklyReportBlock,
  type WeeklyReportCounts,
  type WeeklyReportKind,
  type WeeklyReportPoIssuance,
  type WeeklyReportRow,
  type WeeklyReportStatus,
} from "@/lib/domain/weekly-report";

/**
 * ============================================================================
 * 주간보고 — 손으로 만들던 엑셀 현황판을 그대로 옮긴 화면
 * ============================================================================
 * **집계는 조회 전용이다.** 고객사 블록·총합·PO 발행 현황에는 입력칸도, 저장·삭제
 * 버튼도 없다. 누를 것이 있는 자리는 두 구역 — `금주 목표` 와 `납입 예정 건` —
 * 뿐이고, 각각 통째로 WeeklyReportGoalsPanel · WeeklyReportDeliveriesPanel
 * (클라이언트 컴포넌트)에 들어 있다. 이 파일은 그 둘을 **놓을 자리만** 준다.
 *
 * 그 둘이 화면의 어디에 오는지는 이 헤더에 적지 않는다 — 자리는 아래 반환 트리가
 * 정하고 한 번 바뀐 적이 있다(원래는 집계 위였다). 자리를 말이 아니라 코드로만
 * 두면 다음에 옮길 때 고칠 곳이 한 곳이다. 같은 이유로 WeeklyReportGoalsPanel 의
 * 노란 안내문에서도 `아래 집계`의 `아래` 를 뺐다 — 이 둘이 내려가면서 거짓이 된
 * 말이었다(그 파일 헤더).
 *
 * ── 무엇을 어느 칸에 넣을지는 여기서 정하지 않는다 ──────────────────────
 * 6칸으로 가르고, PO 발행 완료를 겹쳐 세고, RFG/MB 로 접고, 고객사별로 묶어
 * 세고, 고객사마다 두 종류를 짝짓는 일은 전부 domain/weekly-report.ts 가 한다.
 * 이 파일은 그 결과를 그릴 뿐이다 — 규칙을 화면 안에 두면 "이 건이 왜 점검
 * 중인가"를 시험할 방법이 브라우저를 띄우는 것밖에 없어진다(내자 정리 화면과
 * 같은 규칙).
 *
 * ── 서버 컴포넌트다 ────────────────────────────────────────────────────
 * 집계 쪽에는 클라이언트로 내려보낼 상태가 없다. 250줄이 넘는 자료를 브라우저까지
 * 실어 나를 이유도 없다.
 *
 * 금주 목표·납입 예정 상자가 생겼다고 이 파일이 클라이언트가 되지는 **않는다** —
 * 그 두 상자만 "use client" 이고, 여기서는 그것을 한 자리씩 놓을 뿐이다. 이 파일에
 * "use client" 를 붙이면 고객사 블록 58개와 상세표 250여 줄이 통째로 브라우저로
 * 실려 간다.
 *
 * ── 갱신 일은 서버가 정한다 ────────────────────────────────────────────
 * 머리말의 날짜를 클라이언트에서 new Date() 로 만들면 서버가 그린 것과 달라져
 * hydration 이 어긋난다. 이 저장소가 이미 겪은 고장이라 내자 정리 화면의
 * SheetHeading 에 그 경위가 적혀 있고, 여기도 같은 방식으로 page.tsx 가 정해
 * 내려보낸다.
 *
 * ── 배치는 엑셀 그대로다: 고객사마다 왼쪽 RFG · 오른쪽 MB ────────────────
 * 원본 엑셀은 A~H 열에 RFG, I~P 열에 MB 를 두고 고객사를 세로로 쌓는다. 같은
 * 고객사의 두 종류를 **한눈에 견주는 것**이 그 양식의 핵심이라, 블록을 세로로
 * 죽 늘어놓으면 그 뜻이 사라진다. 그래서 고객사 한 줄 = 두 칸(같은 너비)이고,
 * 한쪽이 0건이어도 자리를 지운다: 지우면 좌우가 어긋나 옆 고객사의 MB 가 이
 * 고객사의 RFG 자리에 와 앉는다.
 *
 * ── 집계 8칸의 자리도 엑셀 그대로다. 단, 합은 6칸이다 ────────────────────
 * 윗줄 점검 대기 · 수리 대기 · PO 대기 중 · PO 발행 완료,
 * 아랫줄 점검 중 · 수리 중 · 출하 대기 · 총 대수. 매주 같은 종이를 보던
 * 사람이 칸의 위치로 값을 찾으므로 순서를 바꾸지 않는다.
 *
 * **네 번째 칸(PO 발행 완료)만 성질이 다르다** — 나머지 여섯과 나란한 상태가
 * 아니라 그 위에 겹쳐 세는 값이고, 총 대수에 더해지지 않는다(도메인 파일 헤더).
 *
 * 그 성질 때문에 한때 총합 블록에서는 이 칸을 빼고 네 번째 자리를 **빈 칸으로**
 * 남겼었다 — 원본 엑셀의 `RFG 총합` 에 그 칸이 없어서다. 지금은 **총합에도 둔다**:
 * 사용자가 넣기로 정했고, 고객사 블록과 총합이 같은 자리·같은 차례여야 두 곳을
 * 눈으로 견줄 수 있다. 빈 칸 처리는 그래서 없앴다. 칸이 하나 늘었을 뿐 셈은
 * 그대로다 — 총 대수는 여전히 상태 6칸의 합이고, 이 칸은 거기 더해지지 않는다.
 *
 * ── 색: 고객사 색은 팔레트에서, 자리 색은 여기서 ────────────────────────
 * 고객사 블록의 소제목과 집계 칸은 **customers.row_color 에 정해 둔 그 고객사의
 * 색**으로 칠한다(customer-row-color.ts). 원본 엑셀의 네 가지 색을 여기 박지
 * 않는 이유: 시스템에는 고객사가 29곳이고 색은 이미 고객사 관리에서 고르게 돼
 * 있어서, 박아 두면 두 곳이 어긋난다. 내자 정리와 같은 색이라 두 화면이 이어지는
 * 것은 덤이다. 색을 정하지 않은 고객사는 테두리만 남는다.
 *
 * 반면 상세표 머리글(주황) · 총합과 PO 발행 현황의 소제목(자홍) · 총합 블록의
 * 집계 칸(연두)은 **고객사가 아니라 자리에 붙은 색**이라 팔레트에 넣을 것이
 * 없다. 아래 상수 세 개가 그것이고, 팔레트와 같은 짙기(밝은 쪽 -100, 어두운 쪽
 * -950/50)를 쓴다 — 배경만 칠하므로 글자색 토큰이 그대로 통하고, 어두운 화면에서
 * 형광색이 튀지 않는다.
 *
 * ── 보기 전환 토글을 두지 않는다 ────────────────────────────────────────
 * 이전 배치는 표 하나에 블록마다 <tbody> 를 두었다. 그 구조를 고른 이유가
 * "블록마다 표를 따로 두면 ResponsiveList 토글이 블록 수만큼 생긴다" 였는데,
 * 좌우 배치에서는 표를 한 덩어리로 둘 수가 없다 — 한 표의 행은 좌우로 갈리지
 * 않는다.
 *
 * 그래서 ResponsiveList 를 아예 쓰지 않는다(블록이 58개다 — 토글이 58개면
 * 화면을 못 쓴다). 화면 전체에 토글 하나를 두는 길도 있었지만 고르지 않았다:
 * ResponsiveList 의 판단은 **표 하나를 실제로 그려 놓고 넘치는지 재는 것**이라
 * 표가 58개면 무엇을 잰 값인지 말할 수 없고, 무엇보다 이 화면은 훑어보는
 * 목록이 아니라 매주 같은 자리를 눈으로 찾는 **문서**다. 문서의 칸이 사람마다
 * 다른 자리에 있으면 "지난주 종이와 나란히 놓고 본다"가 성립하지 않는다.
 * 대신 CSS 만으로 반응한다 — 좁아지면 좌우가 위아래로 쌓이고, 같은 고객사의
 * 둘은 붙어 있다.
 *
 * ── 어느 폭부터 좌우로 놓는가: @container 의 @6xl(72rem) ────────────────
 * 뷰포트가 아니라 이 화면이 실제로 차지한 폭으로 정한다(responsive-list.tsx 가
 * 같은 판단을 하는 이유 그대로 — 사이드바를 접었다 폈다 해도 알아서 맞는다).
 *
 * 72rem 인 근거는 집계 8칸이다. 한 칸이 라벨(최장 "PO 발행 완료")·숫자·좌우
 * 여백까지 약 120px 이라, 4열이 한 줄에 들어가려면 약 480px 이 필요하다.
 * 72rem(1152px)을 둘로 가르면 한 칸이 약 568px 이므로 4×2 배치가 접히지 않고
 * 살아남는다. 그보다 좁은 폭에서 좌우로 놓으면 집계가 2×4 로 접혀 매주 보던
 * 칸 자리가 무너지므로, 그때는 차라리 위아래로 쌓는 편이 원본에 가깝다.
 *
 * ── 좌우 두 칸의 높이는 격자가 맞춘다. 표 래퍼가 아니다 ────────────────
 * 한쪽만 길면 견주기 어렵다. 그런데 그 일은 **격자가 이미 하고 있다**: 격자 칸은
 * 기본이 stretch 라 좌우 두 <section> 이 큰 쪽에 맞춰 같은 높이로 늘어난다.
 * 표가 짧은 쪽은 **표 아래가 빈 자리로 남고**, 그게 맞는 모양이다 — 원본 엑셀도
 * 그렇다. 원본처럼 빈 줄 스무 개를 채우지는 않는다: 종이에서는 자리를 잡아 두는
 * 장치였지만 화면에서는 그냥 낭비다.
 *
 * **상세표 래퍼에 flex-1 을 주지 말 것.** 늘어난 자리를 표가 받게 하려고 한때
 * 주었는데, 화면에 세로 스크롤바가 둘로 보이는 고장이 났다. 두 가지가 겹친
 * 결과다:
 *   1. `overflow-x: auto` 를 주면 **나머지 축의 `visible` 이 `auto` 로 바뀐다.**
 *      CSS 규칙이다 — 한 축이 visible 이 아니면 다른 축의 visible 은 auto 로
 *      읽힌다. 즉 그 래퍼는 가로만이 아니라 **세로로도 스크롤되는 상자**다.
 *   2. 거기에 flex-1 이 붙으면 flex-col 안에서 남은 높이를 **확정 높이**로 받는다.
 *      표가 그보다 길면 그 상자 안에서 세로 스크롤이 생긴다.
 * 이 앱의 세로 스크롤 자리는 AppShell 의 <main> 하나뿐이고 다른 화면도 그렇다.
 * 고칠 곳은 AppShell 이 아니라 이 화면이다.
 *
 * 최소 높이(min-h-32)는 남긴다 — **최소**일 뿐이라 상자를 확정 높이로 만들지
 * 않고(내용이 그보다 길면 상자가 함께 자란다), 줄이 한둘뿐인 블록이 납작하게
 * 짜부라지는 것만 막는다.
 *
 * ── 가로 스크롤은 표 안에서만 ───────────────────────────────────────────
 * 8칼럼짜리 표 둘이 나란히 서면 반드시 좁다. 그래서 표마다 자기
 * overflow-x-auto 래퍼를 두고, 격자 칸에는 min-w-0 을 준다(격자 칸의 기본
 * min-width 는 auto 라, 이것이 없으면 표가 칸을 밀어 넓혀 화면 전체(body)가
 * 좌우로 밀린다).
 *
 * ── 장기 PO 미발행은 빨간 볼드로 드러난다 ───────────────────────────────
 * 견적서를 낸 지 두 달이 지나도록 발주가 안 난 줄은 `견적서 발행일` 칸이 빨간
 * 볼드다. **판정은 여기서 하지 않는다** — 도메인이 줄마다 실어 준 값
 * (row.isLongPendingPo)을 읽어 색과 굵기만 입힌다. 그 값은 `전체 A/S 현황` 의
 * `장기 PO 미발행만 보기` 체크박스와 **같은 함수**에서 나온다(도메인 파일 헤더).
 *
 * 색은 분류 안 됨 경고와 같은 빨강이다 — 이 화면에서 빨강은 "손이 필요하다"
 * 하나의 뜻이어야 하고, 색을 하나 더 들이면 그 뜻이 흐려진다.
 *
 * **무슨 뜻인지는 맨 위 머리말에 한 번만 적는다.** 블록이 58개라 상자마다 적으면
 * 그 문장이 화면의 절반을 차지하고, 결국 아무도 읽지 않는다. 색만으로 뜻이
 * 전해지지 않는 자리(색을 못 보는 사람·흑백 인쇄)를 위해 그 칸에 title 을 붙인다 —
 * sr-only 를 새로 넣지 않는 이유는 파일 아래 relative 주석에 있다.
 *
 * ── 분류 안 된 건은 감추지 않는다 ──────────────────────────────────────
 * 6칸 어디에도 안 맞는 건이 있으면 맨 위에 몇 건인지 적고, 그 블록의 집계에도
 * 빨간 칸이 하나 더 생기며, 상세표의 `현 상태`에도 그대로 적힌다. 조용히
 * 빼면 총 대수만 안 맞는 표가 되고, 그때 사람은 자료가 준 것인지 화면이 고장
 * 난 것인지 알 수 없다.
 * ============================================================================
 */

/** 상세표의 칼럼 수. 건이 없는 블록의 "해당 없음" 한 줄이 표 폭을 덮는 데 쓴다. */
const TABLE_COLUMN_COUNT = 8;

/**
 * 좌우 두 칸으로 갈리는 폭. 근거는 파일 헤더에 있다(집계 4열이 접히지 않는
 * 최소 폭). 고객사 줄과 아래 총합이 **같은 폭에서 같이** 갈려야 하므로 값을
 * 한 곳에 둔다 — 따로 적으면 한쪽만 고쳐져 두 배치가 어긋난다.
 */
const SIDE_BY_SIDE_GRID = "grid grid-cols-1 gap-3 @6xl:grid-cols-2";

/**
 * 자리에 붙은 색 세 가지(파일 헤더). 고객사 색과 달리 고르는 값이 아니라서
 * 팔레트가 아니라 화면 코드에 둔다. 배경만 칠하고 글자색은 건드리지 않는다.
 */
/** 상세표 머리글 줄 — 원본의 주황. */
const HEADER_ROW_TONE = "bg-orange-100 dark:bg-orange-950/50";
/** `RFG 총합` · `MB 총합` · `PO 발행 현황` 소제목 — 원본의 자홍. */
const SECTION_HEADING_TONE = "bg-fuchsia-100 dark:bg-fuchsia-950/50";
/** 총합 블록의 집계 칸 — 원본의 연두. */
const TOTALS_CELL_TONE = "bg-lime-100 dark:bg-lime-950/50";

/** 색을 정하지 않은 자리의 배경. 블록 바탕과 같아서 테두리만 남는다. */
const PLAIN_TONE = "";

/** 빈 값의 표시. 이 화면의 모든 칸이 같은 글자를 쓴다(내자 정리와 같은 규칙). */
function dash(value: string | null | undefined): string {
  if (value === null || value === undefined) return "-";
  return value.trim() === "" ? "-" : value;
}

/** 어느 칸에도 안 맞는 건의 `현 상태`에 적는 말. 화면과 시험이 같은 글자를 쓴다. */
const UNCLASSIFIED_LABEL = "분류 안 됨";

/** 빨간 볼드가 뜻하는 것. 머리말과 그 칸의 title 이 같은 글자를 쓴다. */
const LONG_PENDING_PO_LABEL = "장기 PO 미발행";

/**
 * 장기 PO 미발행인 줄의 `견적서 발행일` 옷. 분류 안 됨 경고와 **같은 빨강**이라
 * 밝은 화면·어두운 화면 양쪽에서 이미 읽히는 것이 확인된 짝이다(파일 헤더).
 */
const LONG_PENDING_PO_TONE = "font-bold text-red-700 dark:text-red-300";

/** 상세표의 `현 상태` 한 칸. 분류 안 된 건은 빨갛게 드러난다. */
function StatusCell({ row }: { row: WeeklyReportRow }) {
  if (row.reportStatus === null) {
    return (
      <span className="rounded bg-red-100 px-1 py-0.5 text-[10px] leading-none font-medium text-red-900 dark:bg-red-950 dark:text-red-200">
        {UNCLASSIFIED_LABEL}
      </span>
    );
  }
  return <>{weeklyReportStatusLabels[row.reportStatus]}</>;
}

/**
 * 집계 한 칸. 엑셀에서는 "점검 대기 0" 처럼 이름과 숫자가 나란히 있었다 —
 * 세로로 훑어 읽는 값이라 숫자는 tabular-nums 로 자릿수를 맞춘다.
 *
 * 배경은 부르는 쪽이 정한다(고객사 색 / 총합의 연두 / 색 없음). 분류 안 됨만
 * 예외로 빨간 옷을 스스로 입는다 — 그 칸은 자리의 색이 아니라 **경고**라서,
 * 고객사 색에 묻히면 안 된다.
 */
function CountCell({
  label,
  value,
  toneClass = PLAIN_TONE,
  alert = false,
}: {
  label: string;
  value: number;
  toneClass?: string;
  alert?: boolean;
}) {
  const boxClass = alert
    ? "border-red-300 bg-red-50 dark:border-red-900 dark:bg-red-950"
    : `border-zinc-200 dark:border-zinc-800 ${toneClass}`;
  const valueClass = alert ? "text-red-700 dark:text-red-300" : "text-zinc-900 dark:text-zinc-50";
  return (
    <div
      className={`flex items-baseline justify-between gap-1.5 rounded border px-1.5 py-0.5 ${boxClass}`}
    >
      <span className="text-[10px] whitespace-nowrap text-zinc-600 dark:text-zinc-400">{label}</span>
      <span className={`text-xs font-semibold tabular-nums ${valueClass}`}>{value}</span>
    </div>
  );
}

/**
 * 집계에서 상태 6칸이 놓이는 자리 — **엑셀 그대로**다(파일 헤더).
 * 네 번째 자리(PO 발행 완료)와 여덟 번째 자리(총 대수)는 상태가 아니라 이 표에
 * 없다.
 *
 * Record 로 적은 것은 일부러다: 상태가 하나 늘면 이 표가 컴파일되지 않아서,
 * 화면에 칸 하나가 조용히 빠진 채로 나가는 일이 없다.
 */
const SUMMARY_CELL_POSITION: Record<WeeklyReportStatus, number> = {
  INSPECTION_WAITING: 1,
  REPAIR_WAITING: 2,
  PO_WAITING: 3,
  INSPECTION_IN_PROGRESS: 5,
  IN_REPAIR: 6,
  SHIPMENT_WAITING: 7,
};

const SUMMARY_CELL_ORDER = [...WEEKLY_REPORT_STATUSES].sort(
  (a, b) => SUMMARY_CELL_POSITION[a] - SUMMARY_CELL_POSITION[b]
);

/** 윗줄에 놓이는 상태 셋(1~3번 자리)과 아랫줄에 놓이는 상태 셋(5~7번 자리). */
const TOP_ROW_STATUSES = SUMMARY_CELL_ORDER.filter((status) => SUMMARY_CELL_POSITION[status] < 4);
const BOTTOM_ROW_STATUSES = SUMMARY_CELL_ORDER.filter((status) => SUMMARY_CELL_POSITION[status] > 4);

/**
 * 집계 8칸 — 윗줄 네 칸, 아랫줄 네 칸(마지막이 총 대수).
 * 분류 안 된 건이 있을 때만 아홉 번째 칸이 붙는다.
 *
 * 자기 자신이 @container 다. 이 덩어리는 고객사 블록 안(좁을 수 있다)에도,
 * 아래 총합 안(넓다)에도 놓이므로, 뷰포트가 아니라 **제가 받은 폭**으로 4열과
 * 2열을 가른다. sm: 같은 뷰포트 기준을 쓰면 넓은 창의 좁은 칸에서 4열이
 * 우겨넣어져 라벨과 숫자가 겹친다.
 *
 * **고객사 블록과 총합 블록이 같은 칸을 쓴다.** 예전에는 총합에서 PO 발행 완료를
 * 빼려고 `showPoIssued` 를 받아 네 번째 자리를 빈 칸으로 남겼는데, 그 칸을 총합에도
 * 두기로 하면서 갈림길이 사라졌다(파일 헤더). 두 곳이 한 함수를 그대로 쓰므로
 * 칸의 차례가 어긋날 자리가 없다.
 */
function CountsSummary({
  counts,
  toneClass = PLAIN_TONE,
}: {
  counts: WeeklyReportCounts;
  toneClass?: string;
}) {
  return (
    <div className="@container max-w-3xl">
      <div className="grid grid-cols-2 gap-1 @lg:grid-cols-4">
        {TOP_ROW_STATUSES.map((status) => (
          <CountCell
            key={status}
            label={weeklyReportStatusLabels[status]}
            value={counts.byStatus[status]}
            toneClass={toneClass}
          />
        ))}
        {/* 네 번째 자리 — 겹쳐 세는 값이라 총 대수에 더해지지 않는다(파일 헤더). */}
        <CountCell
          label={WEEKLY_REPORT_PO_ISSUED_LABEL}
          value={counts.poIssued}
          toneClass={toneClass}
        />
        {BOTTOM_ROW_STATUSES.map((status) => (
          <CountCell
            key={status}
            label={weeklyReportStatusLabels[status]}
            value={counts.byStatus[status]}
            toneClass={toneClass}
          />
        ))}
        <CountCell label={WEEKLY_REPORT_TOTAL_LABEL} value={counts.total} toneClass={toneClass} />
        {counts.unclassified > 0 && (
          <CountCell label={UNCLASSIFIED_LABEL} value={counts.unclassified} alert />
        )}
      </div>
    </div>
  );
}

/**
 * 블록 소제목 — 엑셀의 "INVENIA(RFG)". 왼쪽에 이름·종류, 오른쪽에 총 대수다.
 * 고객사 블록과 아래 총합이 같은 줄 모양을 쓰므로, 좌우 두 칸의 첫 줄 높이가
 * 저절로 맞는다.
 */
function BlockHeading({
  name,
  kind,
  total,
  toneClass = PLAIN_TONE,
}: {
  /** 왼쪽에 굵게 적는 이름 — 고객사명, 또는 "총합". */
  name: string;
  kind: WeeklyReportKind;
  /** 오른쪽에 적는 숫자. 없으면 적지 않는다. */
  total?: number;
  toneClass?: string;
}) {
  return (
    <div
      className={`flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 rounded border border-zinc-200 px-2 py-1 dark:border-zinc-800 ${toneClass}`}
    >
      <h3 className="inline-flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm">
        <span className="font-semibold text-zinc-900 dark:text-zinc-50">{name}</span>
        <span className="rounded bg-zinc-800 px-1 py-0.5 text-[10px] leading-none font-medium text-white dark:bg-zinc-200 dark:text-zinc-900">
          {kind}
        </span>
        <span className="text-[11px] font-normal text-zinc-600 dark:text-zinc-400">
          {weeklyReportKindDescriptions[kind]}
        </span>
      </h3>
      {total !== undefined && (
        <p className="text-[11px] whitespace-nowrap text-zinc-600 dark:text-zinc-400">
          {WEEKLY_REPORT_TOTAL_LABEL}{" "}
          <span className="text-xs font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">
            {total}
          </span>
        </p>
      )}
    </div>
  );
}

/**
 * 블록 하나 — 소제목 · 집계 8칸 · 상세표 8칼럼. 엑셀의 한 덩어리 그대로다.
 * 소제목과 집계 칸은 그 고객사의 색으로 칠한다(파일 헤더).
 *
 * min-w-0 은 장식이 아니다: 격자 칸의 기본 min-width 는 auto 라, 이것이 없으면
 * 안쪽 표의 필요 폭이 칸을 밀어 넓혀 화면 전체가 좌우로 밀린다(파일 헤더).
 */
function ReportBlock({ block }: { block: WeeklyReportBlock }) {
  const toneClass = customerRowColorClass(block.customerRowColor);
  return (
    <section className="flex min-w-0 flex-col gap-1.5 rounded-lg border border-zinc-200 bg-white p-2 dark:border-zinc-800 dark:bg-zinc-900">
      <BlockHeading
        name={block.customerName}
        kind={block.kind}
        total={block.counts.total}
        toneClass={toneClass}
      />
      <CountsSummary counts={block.counts} toneClass={toneClass} />
      {/* 가로 스크롤은 이 래퍼 안에서만 일어난다. **flex-1 을 되돌려 놓지 말 것** —
          overflow-x 가 세로 축까지 스크롤 상자로 만들기 때문에, 여기에 확정 높이가
          붙으면 이 안에서 세로 스크롤이 생겨 스크롤바가 둘로 보인다. 좌우 두 칸의
          높이는 격자가 맞춘다(파일 헤더). */}
      <div className="min-h-32 overflow-x-auto rounded border border-zinc-200 dark:border-zinc-800">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr
              className={`border-b border-zinc-200 text-left text-[11px] font-semibold whitespace-nowrap text-zinc-700 dark:border-zinc-800 dark:text-zinc-300 ${HEADER_ROW_TONE}`}
            >
              <th className="px-1.5 py-1">인수 번호</th>
              <th className="px-1.5 py-1">형식</th>
              <th className="px-1.5 py-1">S/N</th>
              <th className="px-1.5 py-1">L/N</th>
              <th className="px-1.5 py-1">견적서 발행일</th>
              <th className="px-1.5 py-1">현 상태</th>
              <th className="px-1.5 py-1">PO 발행 일시</th>
              <th className="px-1.5 py-1">비고</th>
            </tr>
          </thead>
          <tbody>
            {/* 건이 없어도 블록은 자리를 지킨다(파일 헤더) — 그 자리에 무엇이
                없는지 한 줄로 적는다. 빈 표만 남기면 자료가 없는 것인지 화면이
                덜 그려진 것인지 알 수 없다. */}
            {block.rows.length === 0 ? (
              <tr>
                <td
                  colSpan={TABLE_COLUMN_COUNT}
                  className="px-1.5 py-3 text-center text-[11px] text-zinc-500 dark:text-zinc-400"
                >
                  해당 없음
                </td>
              </tr>
            ) : (
              block.rows.map((row) => (
                <tr
                  key={row.id}
                  className="border-b border-zinc-100 whitespace-nowrap last:border-0 dark:border-zinc-800"
                >
                  <td className="px-1.5 py-1 font-medium text-zinc-900 dark:text-zinc-50">
                    {row.intakeNumber}
                  </td>
                  <td className="px-1.5 py-1">{dash(row.modelName)}</td>
                  <td className="px-1.5 py-1">{dash(row.serialNumber)}</td>
                  <td className="px-1.5 py-1">{dash(row.lotNumber)}</td>
                  {/* 장기 PO 미발행인 줄만 빨간 볼드다. 판정은 도메인이 이미
                      해서 실어 보냈고(row.isLongPendingPo), 여기서는 옷만 입힌다
                      (파일 헤더). 무슨 뜻인지는 맨 위 머리말에 한 번 적혀 있다. */}
                  <td
                    className={`px-1.5 py-1 tabular-nums ${row.isLongPendingPo ? LONG_PENDING_PO_TONE : ""}`}
                    title={row.isLongPendingPo ? LONG_PENDING_PO_LABEL : undefined}
                  >
                    {dash(row.quoteIssuedDate)}
                  </td>
                  <td className="px-1.5 py-1">
                    <StatusCell row={row} />
                  </td>
                  <td className="px-1.5 py-1 tabular-nums">{dash(row.orderIssuedDate)}</td>
                  <td className="px-1.5 py-1 whitespace-pre-line">{dash(row.notes)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/**
 * PO 발행 현황 한 줄 — 그 종류의 **고객사별 PO 발행 완료 건수**.
 *
 * 숫자는 블록의 `PO 발행 완료` 칸을 그대로 다시 읽은 것이다(도메인의
 * summarizeWeeklyReportPoIssuance). 여기서 접수 건을 다시 세지 않는 이유가
 * 그것이다 — 두 곳이 따로 세면 언젠가 어긋난다.
 *
 * 이름표는 그 고객사의 색으로 칠한다. 0 인 고객사도 자리를 지킨다: 좌우 두
 * 줄의 이름 차례가 같아야 견줄 수 있다(원본도 0을 적어 둔다).
 */
function PoIssuanceBlock({ issuance }: { issuance: WeeklyReportPoIssuance }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <BlockHeading
        name="PO 발행 현황"
        kind={issuance.kind}
        total={issuance.total}
        toneClass={SECTION_HEADING_TONE}
      />
      {issuance.customers.length === 0 ? (
        <p className="px-2 py-1 text-[11px] text-zinc-500 dark:text-zinc-400">해당 없음</p>
      ) : (
        <ul className="flex flex-wrap gap-1">
          {issuance.customers.map((entry) => (
            <li
              key={entry.key}
              className={`inline-flex items-baseline gap-1.5 rounded border border-zinc-200 px-1.5 py-0.5 dark:border-zinc-800 ${customerRowColorClass(entry.customerRowColor)}`}
            >
              <span className="text-[10px] whitespace-nowrap text-zinc-600 dark:text-zinc-400">
                {entry.customerName}
              </span>
              <span className="text-xs font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">
                {entry.count}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * 금주 목표 상자에 그대로 넘어가는 값 묶음. 이 파일은 이 값들을 하나도 읽지
 * 않는다 — 상자를 놓을 자리만 주고, 무엇을 그릴지는 WeeklyReportGoalsPanel 이
 * 정한다(그 파일 헤더).
 */
export type WeeklyReportGoalsPanelData = {
  /** 지금 보고 있는 주의 월요일 — page.tsx 가 `?week=` 을 접어 정한 값. */
  weekStart: string;
  /** 서버가 한국 표준시로 정한 이번 주 월요일. 클라이언트에서 만들지 않는다. */
  currentWeekStart: string;
  rows: WeeklyReportGoalRow[];
  /** 적을 수 있는가. 화면을 그리기 위한 값일 뿐 관문이 아니다(page.tsx 주석). */
  canEdit: boolean;
  /** '줄 추가'의 수리 건 고르개 목록. 못 고치는 사람에게는 빈 배열이다. */
  repairCaseOptions: RepairCaseLinkOption[];
};

export default function WeeklyReportScreen({
  report,
  asOfDate,
  goals,
  deliveries,
}: {
  report: WeeklyReport;
  /** 서버가 한국 표준시로 정한 "오늘". 클라이언트에서 만들지 않는다(파일 헤더). */
  asOfDate: string;
  goals: WeeklyReportGoalsPanelData;
  /**
   * 그 주의 납입 예정 줄 전부. 이 파일은 한 줄도 읽지 않는다 — 무엇을 그릴지는
   * WeeklyReportDeliveriesPanel 이 정한다(그 파일 헤더).
   *
   * **주·권한·수리 건 고르개 목록을 따로 받지 않는 것은 일부러다.** 두 상자가
   * 한 주를 함께 보고(승인된 결정), 한 권한(weeklyReport WRITE)으로 열리며,
   * 고르개 목록도 page.tsx 가 한 번만 읽는다. 값을 두 벌 내려보내면 언젠가 한쪽만
   * 고쳐져, 위 상자가 지난주를 보는데 아래 표는 이번 주를 그리는 날이 온다.
   */
  deliveries: WeeklyReportDeliveryRow[];
}) {
  // 짝짓기도, PO 발행 현황도 도메인이 한다 — 여기서는 그 결과를 좌우로 놓을 뿐이다.
  const customerRows = pairWeeklyReportBlocksByCustomer(report.blocks);
  const poIssuance = summarizeWeeklyReportPoIssuance(report.blocks);

  return (
    // 이 화면이 실제로 차지한 폭이 좌우 배치의 기준이다(파일 헤더).
    <div className="@container flex flex-col gap-4">
      <section className="flex flex-col gap-2 rounded-lg border border-zinc-200 bg-white p-4 text-sm text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">주간보고</h1>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">갱신 일 {asOfDate}</p>
        </div>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          출하 완료된 건은 빠지고, 진행 중인 {report.total.total}대만 고객사·종류별로 묶여 있습니다.
          총 대수는 상태 6칸의 합이며, {WEEKLY_REPORT_PO_ISSUED_LABEL}는 그 위에 겹쳐 세는 값이라
          총 대수에 더해지지 않습니다 — 어느 칸에 있든 PO 발행 일시가 있으면 세어집니다.
        </p>
        {/* 빨간 볼드가 무슨 뜻인지 적는 **한 곳**이다. 블록마다 적지 않는 이유는
            파일 헤더에 있다(블록이 58개다). */}
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          상세표에서 <span className={LONG_PENDING_PO_TONE}>견적서 발행일</span>이 빨간 글씨인 줄은{" "}
          {LONG_PENDING_PO_LABEL}입니다 — 견적서를 낸 지 두 달이 지나도록 발주가 나지 않은 건이며,
          전체 A/S 현황의 `{LONG_PENDING_PO_LABEL}만 보기` 와 같은 판정입니다.
        </p>
      </section>

      {report.total.unclassified > 0 && (
        <p
          role="status"
          className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
        >
          6칸 어느 쪽에도 들어가지 않는 접수 건이 {report.total.unclassified}건 있습니다. 워크플로에
          새 단계가 생겼을 수 있습니다 — 그 건들은 상세표의 `현 상태`에 {UNCLASSIFIED_LABEL}으로
          표시됩니다.
        </p>
      )}

      {customerRows.length === 0 ? (
        <div className="rounded-lg border border-zinc-200 bg-white p-8 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
          진행 중인 접수 건이 없습니다.
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {customerRows.map((row) => (
            // 고객사 한 줄 = 왼쪽 RFG · 오른쪽 MB. 좁아지면 위아래로 쌓이고,
            // 그때도 같은 고객사의 둘은 붙어 있다(한 격자 안이라 갈릴 수 없다).
            //
            // **relative 를 떼지 말 것 — 떼면 세로 스크롤바가 다시 둘로 보인다.**
            // 바로 아래 sr-only h2 는 position:absolute 다(Tailwind 의 sr-only 가
            // 그렇다). 이 <section> 에 relative 가 없으면 그 h2 들의 컨테이닝 블록을
            // 만들어 주는 조상이 하나도 없어 기준이 최상위(문서)가 된다. overflow 는
            // **자기보다 바깥에 컨테이닝 블록을 둔 절대위치 자손을 자르지 못하므로**,
            // 고객사 29줄의 h2 가 AppShell <main> 의 자르기를 그대로 빠져나가 문서
            // 바닥에 자리를 주장한다. 그러면 <main> 스크롤과 별개로 창(문서) 스크롤이
            // 생기고, 그 창 스크롤을 내리면 파란 헤더와 사이드바까지 밀려 올라간다.
            // 실측: relative 없이 html.scrollHeight 16214(뷰포트 911), sr-only 를
            // 숨기면 911 로 떨어졌다. 높이가 1px 이라 눈에도 진단에도 안 걸린다.
            //
            // relative 는 좌표를 주지 않으면 아무것도 옮기지 않고 z-index:auto 라
            // 쌓임 맥락도 만들지 않는다 — 기준점만 준다. SIDE_BY_SIDE_GRID 상수에
            // 넣지 않는 것은 그 값이 "어느 폭에서 좌우로 갈리는가"만 뜻하고 아래
            // 종류별 총합·PO 발행 현황도 같이 쓰기 때문이다(그 둘의 h2 는 눈에
            // 보이는 글자라 이 문제가 없다).
            <section key={row.key} className={`${SIDE_BY_SIDE_GRID} relative`}>
              {/* 눈으로는 두 소제목에 이미 고객사명이 적혀 있어 겹치지만, 화면
                  낭독기에는 29개 고객사를 건너뛸 발판이 필요하다 — 없으면 블록
                  58개를 한 줄씩 지나야 다음 고객사에 닿는다. */}
              <h2 className="sr-only">{row.customerName}</h2>
              <ReportBlock block={row.rfg} />
              <ReportBlock block={row.mb} />
            </section>
          ))}
        </div>
      )}

      {/* RFG 총합 · MB 총합 — 엑셀에도 있는 줄이고, 위와 같은 자리(왼쪽 RFG ·
          오른쪽 MB)에 둔다. 블록을 다 훑지 않고도 두 줄의 규모를 볼 수 있어야 한다.
          집계 칸도 고객사 블록과 **같은 자리·같은 차례**다(PO 발행 완료 포함) —
          두 곳을 눈으로 견주는 것이 이 줄의 쓸모라서다(파일 헤더). */}
      <section className="flex flex-col gap-3 rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">종류별 총합</h2>
        <div className={SIDE_BY_SIDE_GRID}>
          {report.totalsByKind.map(({ kind, counts }) => (
            <div key={kind} className="flex min-w-0 flex-col gap-1">
              <BlockHeading
                name="총합"
                kind={kind}
                total={counts.total}
                toneClass={SECTION_HEADING_TONE}
              />
              {/* PO 발행 완료 칸의 숫자는 여기서 새로 세지 않는다 — 도메인이 이미
                  센 totalsByKind 의 poIssued 다. 그 값은 그 종류 블록들의 PO 발행
                  완료 합이고(도메인 시험이 못 박는다), 아래 PO 발행 현황의 합계와도
                  같은 값이다. */}
              <CountsSummary counts={counts} toneClass={TOTALS_CELL_TONE} />
            </div>
          ))}
        </div>
        {/* 6칸의 합과 총 대수가 다르면 분류 안 된 건이 있다는 뜻이다. 같을 때는
            아무 말도 하지 않는다 — 늘 보이는 확인 문구는 읽히지 않는다. */}
        {sumWeeklyReportStatusCounts(report.total) !== report.total.total && (
          <p className="text-xs text-red-700 dark:text-red-300">
            전체 {report.total.total}대 중 6칸에 들어간 것은{" "}
            {sumWeeklyReportStatusCounts(report.total)}대입니다.
          </p>
        )}
      </section>

      {/* PO 발행 현황 — 원본 아래쪽의 구역. 종류별로 고객사별 발행 완료 건수를
          늘어놓는다. 숫자는 위 블록의 PO 발행 완료 칸과 같은 계산에서 나온다. */}
      <section className="flex flex-col gap-3 rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
        {/* 원본은 좌우 두 칸에 각각 "PO 발행 현황"을 적어 둔다. 바깥 제목이 같은
            글자인 것은 그래서다 — 두 칸의 소제목이 원본의 글자고, 이 h2 는 화면
            낭독기가 이 구역을 하나로 집을 수 있게 하는 발판이다. */}
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">PO 발행 현황</h2>
        <div className={SIDE_BY_SIDE_GRID}>
          {poIssuance.map((issuance) => (
            <PoIssuanceBlock key={issuance.kind} issuance={issuance} />
          ))}
        </div>
      </section>

      {/* 금주 목표 — 화면의 **맨 아래**다. 원본 엑셀은 이 상자를 집계 위에 두었지만
          사용자가 아래로 내리기로 정했다: 매주 넘겨 보는 문서라 위쪽은 "지금 어디까지
          왔는가"(집계)로 시작하고, 손으로 적는 일은 다 보고 난 뒤 아래에서 한다.

          ⚠️ 주 이동 줄(`◀ 지난주 | 다음주 ▶`)이 이 상자 안에 있어 함께 내려와 있다 —
          그게 맞다. 그 줄은 이 두 구역에만 걸리고 집계와는 무관하다(집계는
          언제나 '지금 이 순간'이다). 화면 위쪽으로 따로 빼지 말 것.

          좌우 배치는 이 화면의 다른 줄과 **같은 상수**를 쓴다 — 같은 폭에서 같이
          갈리지 않으면 목표 상자만 위아래로 쌓인 채 위 블록은 좌우로 남는다
          (SIDE_BY_SIDE_GRID 주석). 값을 상자 쪽에 따로 적지 않고 넘기는 것이
          그래서다. */}
      <WeeklyReportGoalsPanel
        weekStart={goals.weekStart}
        currentWeekStart={goals.currentWeekStart}
        goals={goals.rows}
        canEdit={goals.canEdit}
        repairCaseOptions={goals.repairCaseOptions}
        gridClass={SIDE_BY_SIDE_GRID}
      />

      {/* 납입 예정 건 — 금주 목표 바로 아래, 화면의 마지막이다. 두 구역은 **붙어
          있어야 한다**: 한 주의 계획과 그 주에 내보낼 것이 한 덩어리고, 주 고르개도
          위 상자의 그것 하나가 둘의 주를 함께 정한다(그 파일 헤더). 여기 주 이동
          줄을 또 두지 않는 이유가 그것이다. 좌우 배치도 같은 상수를 그대로 넘긴다. */}
      <WeeklyReportDeliveriesPanel
        weekStart={goals.weekStart}
        deliveries={deliveries}
        canEdit={goals.canEdit}
        repairCaseOptions={goals.repairCaseOptions}
        gridClass={SIDE_BY_SIDE_GRID}
      />
    </div>
  );
}
