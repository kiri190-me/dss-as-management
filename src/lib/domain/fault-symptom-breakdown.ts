import {
  buildPieSlices,
  formatPieSliceLabel,
  type PieDetailHandlers,
  type PieSliceKind,
} from "./pie-slices";
import type { WorkflowType } from "./types";
import {
  WEEKLY_REPORT_KINDS,
  foldWeeklyReportKind,
  type WeeklyReportKind,
} from "./weekly-report";

/**
 * ============================================================================
 * 신고 증상별 현황 — 대시보드 원형 그래프가 쓰는 숫자
 * ============================================================================
 * 대시보드 아래에 RFG · MB 원 하나씩을 그리고, 조각을 누르면 그 증상으로 접수된
 * 건들의 **인수점검 결과**를 펼쳐 보여 준다. 이 파일에는 React 도 DB 도 들어오지
 * 않는다 — dashboard-metrics.ts 와 같은 자리의 순수 함수다. "왜 이 조각이 이만큼
 * 인가"는 규칙이지 그리기가 아니라서, 화면 안에 두면 시험할 방법이 브라우저를
 * 띄우는 것밖에 남지 않는다.
 *
 * ── 조각 나누는 규칙은 pie-slices.ts 가 갖는다 ──────────────────────────
 * 미입력·기타 접기·차례·각도·%·React key 는 이 파일이 정하지 않는다. 원형
 * 그래프가 여럿(제품 모델 상세에 네 장이 더 있다)이라 각자 세면 언젠가 규칙이
 * 갈라지고, 그때 어느 화면이 맞는지 말할 수 없다. **여기는 그 규칙에 무엇을
 * 넣을지만 정한다** — 무엇으로 묶을지(신고 증상), 미입력의 이름, 상위 몇 개까지
 * 남길지, 조각에 무엇을 달고 다닐지(인수점검 결과).
 *
 * ── RFG / MB 를 여기서 새로 정하지 않는다 ───────────────────────────────
 * 종류를 접는 규칙은 주간보고가 이미 정해 두었고(weekly-report.ts), 여기서는
 * foldWeeklyReportKind 를 **부르기만** 한다. 규칙을 옮겨 적으면 언젠가 두 화면의
 * 숫자가 갈라지고, 그때 어느 쪽이 맞는지 말할 수 없다.
 *
 * ── 글자 그대로 묶는다 ───────────────────────────────────────────────────
 * 신고 증상과 인수점검 결과는 **둘 다 자유 입력 칸**이다. 목록에서 고르는 값이
 * 아니라서, 앞뒤 공백을 걷어낸 뒤 똑같은 글자끼리 묶는 것 외에 분류할 방법이
 * 없다. 사용자가 이 사실을 알고 승인했다. 이름표는 원문 표기 그대로 나간다.
 *
 * ── 안 적힌 건을 버리지 않는다 ──────────────────────────────────────────
 * 값이 null 이거나 공백뿐인 건은 **미입력** 조각으로 센다. 버리면 조각의 합이 총
 * 대수와 달라지고, 한 번 어긋난 그래프는 아무도 믿지 않는다. **조각 건수의 합은
 * 언제나 그 종류의 총 대수와 같다** — 시험이 못 박아 둔다.
 *
 * ── 접되, 몇 가지를 접었는지 말한다 ─────────────────────────────────────
 * 종류가 많으면 원이 실오라기 조각으로 뒤덮여 읽을 수 없어 상위 8개만 남기고
 * 나머지를 **기타** 하나로 접는다. 그런데 말없이 잘라내면 "이게 전부"로 읽히므로
 * 접힌 종류 수를 함께 돌려주고, 화면은 그것을 `기타(12종)`처럼 적는다.
 *
 * **미입력은 접기 대상이 아니다.** 건수가 아무리 적어도 따로 보여 준다 — "안 적힌
 * 건이 몇 건인가"는 그 자체로 알아야 할 정보이고, 기타에 섞이면 영영 보이지 않는다.
 * 그래서 상위 8개는 미입력을 뺀 나머지 중에서 고른다.
 *
 * ── 출하 완료 건도 들어 있다 ────────────────────────────────────────────
 * 이 집계는 넘겨받은 목록을 **하나도 거르지 않는다**. 주간보고와 달리 "지금 무엇이
 * 밀려 있는가"가 아니라 "그동안 무슨 증상으로 들어왔는가"를 묻는 그래프라서다.
 * 그래서 총 대수가 대시보드의 `현재 입고 수`보다 크고, 화면은 원 아래에 그 사실을
 * 한 줄로 적는다.
 * ============================================================================
 */

/** 신고 증상이 비어 있는 건이 모이는 조각의 이름. 화면과 시험이 같은 글자를 쓴다. */
export const FAULT_SYMPTOM_UNSPECIFIED_LABEL = "미입력";

/** 상위 8개 밖의 증상이 접히는 조각의 이름. */
export const FAULT_SYMPTOM_OTHER_LABEL = "기타";

/** 원에 그대로 남는 증상 조각의 최대 개수. 미입력은 이 셈에 들어가지 않는다. */
export const FAULT_SYMPTOM_TOP_SLICE_LIMIT = 8;

/**
 * 조각의 성격. 화면이 색을 고를 때 쓴다 — 미입력·기타는 "실제 증상"이 아니라서
 * 무채색으로 따로 칠한다. 라벨 글자로 갈라내면 `기타`라고 적힌 진짜 증상이
 * 들어왔을 때 엉뚱한 색이 된다.
 */
export type FaultSymptomSliceKind = "SYMPTOM" | "UNSPECIFIED" | "OTHER";

/**
 * 공용 조각의 성격(pie-slices.ts) → 이 화면이 쓰는 이름.
 *
 * 값 조각을 `SYMPTOM` 이라 부르는 이름이 이미 밖으로 나가 있어(FaultSymptomSlice
 * 와 그 React key) 공용 이름 `VALUE` 로 갈아 끼우지 않는다 — 화면이 보고 있는
 * 조각의 key 가 바뀌면 리팩터링이 눈에 보이는 변화를 만든다.
 */
const SLICE_KIND_BY_PIE_KIND: Record<PieSliceKind, FaultSymptomSliceKind> = {
  VALUE: "SYMPTOM",
  UNSPECIFIED: "UNSPECIFIED",
  OTHER: "OTHER",
};

/** 한 조각 안의 인수점검 결과 한 묶음. */
export type IntakeInspectionResultGroup = {
  /** 앞뒤 공백을 걷어낸 원문 그대로. 여러 줄일 수 있어 화면은 줄바꿈을 살려 그린다. */
  result: string;
  count: number;
};

/**
 * 조각이 달고 다니는 인수점검 결과 누적기 — 밖으로 나가기 전에
 * toIntakeInspectionResultGroups 로 편다.
 *
 * 세는 동안 Map 인 이유는 접힐 때 합치기(merge) 때문이다. 정렬한 배열끼리 합치려면
 * 매번 다시 정렬해야 한다.
 */
export type IntakeInspectionAccumulator = {
  /** 인수점검 결과 원문 → 건수. */
  resultCounts: Map<string, number>;
  /**
   * 인수점검 결과가 아직 없는 건수. 묶음에 섞지 않는 이유: "결과가 비어 있다"는
   * 결과의 한 종류가 아니라 **아직 점검 전**이라는 뜻이라서, 섞으면 그 조각에서
   * 가장 흔한 결과가 빈칸이 되는 일이 생긴다.
   */
  pendingCount: number;
};

/**
 * 조각에 인수점검 결과를 달아 주는 처리기.
 *
 * **제품 모델 상세의 고장 증상 그래프가 이것을 그대로 쓴다**(product-model-
 * breakdown.ts). 옮겨 적으면 한쪽만 빈 결과를 묶음에 섞는 식으로 갈라진다.
 */
export const intakeInspectionDetail: PieDetailHandlers<
  { intakeInspectionResult: string | null },
  IntakeInspectionAccumulator
> = {
  create: () => ({ resultCounts: new Map(), pendingCount: 0 }),
  add: (acc, row) => {
    const result = row.intakeInspectionResult?.trim() ?? "";
    if (result === "") {
      acc.pendingCount += 1;
      return;
    }
    acc.resultCounts.set(result, (acc.resultCounts.get(result) ?? 0) + 1);
  },
  merge: (accs) => {
    const merged: IntakeInspectionAccumulator = { resultCounts: new Map(), pendingCount: 0 };
    for (const acc of accs) {
      merged.pendingCount += acc.pendingCount;
      for (const [result, count] of acc.resultCounts) {
        merged.resultCounts.set(result, (merged.resultCounts.get(result) ?? 0) + count);
      }
    }
    return merged;
  },
};

/** 건수 많은 순 → 이름 오름차순. 조각과 같은 규칙이다. 접지 않는다. */
export function toIntakeInspectionResultGroups(
  acc: IntakeInspectionAccumulator
): IntakeInspectionResultGroup[] {
  return [...acc.resultCounts.entries()]
    .map(([result, count]) => ({ result, count }))
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return a.result.localeCompare(b.result, "ko");
    });
}

export type FaultSymptomSlice = {
  /**
   * React key. 라벨을 그대로 쓰지 않는 이유: `기타`·`미입력`이라고 **적힌 진짜
   * 증상**이 들어오면 접힌 조각과 라벨이 겹친다. 성격을 앞에 붙여 갈라 둔다.
   */
  key: string;
  /** 범례에 나가는 이름 — 증상 조각은 원문 표기 그대로다. */
  label: string;
  sliceKind: FaultSymptomSliceKind;
  count: number;
  /**
   * 화면에 적는 비율(%). 소수 첫째 자리에서 반올림한 값이라 **조각을 다 더해도
   * 100.0 이 아닐 수 있다.** 억지로 맞추지 않는다 — 맞추려면 어느 한 조각의
   * 숫자를 거짓으로 적어야 한다. 원을 그리는 각도는 이 값이 아니라 건수에서
   * 직접 뽑으므로(아래 두 필드) 반올림이 조각 사이에 틈이나 겹침을 만들지 않는다.
   */
  percentage: number;
  /** 12시 방향을 0 으로 하는 시작 각도(도). 건수에서 직접 나온다. */
  startAngle: number;
  /** 이 조각이 차지하는 각도(도). 조각 전체의 합은 언제나 360 이다. */
  sweepAngle: number;
  /**
   * 이 조각에 뭉쳐진 **증상 종류의 수**. 증상·미입력 조각은 1 이고, 기타 조각만
   * 1 보다 클 수 있다. 화면은 이 값으로 `기타(12종)`를 적는다.
   */
  foldedSymptomCount: number;
  /** 건수 많은 순 → 이름 오름차순. 조각과 같은 규칙이다. 접지 않는다. */
  intakeInspectionResults: IntakeInspectionResultGroup[];
  /**
   * 인수점검 결과가 아직 없는 건수. 묶음에 섞지 않는 이유: "결과가 비어 있다"는
   * 결과의 한 종류가 아니라 **아직 점검 전**이라는 뜻이라서, 섞으면 그 조각에서
   * 가장 흔한 결과가 빈칸이 되는 일이 생긴다.
   */
  intakeInspectionPendingCount: number;
};

export type FaultSymptomKindBreakdown = {
  kind: WeeklyReportKind;
  /** 그 종류의 총 대수. 조각 건수의 합과 언제나 같다. */
  total: number;
  /** 건수 0 인 조각은 들어 있지 않다. 총 대수가 0 이면 빈 배열이다. */
  slices: FaultSymptomSlice[];
  /**
   * 기타로 접힌 증상 종류의 수. 접힌 것이 없으면 0 이다. 기타 조각의
   * foldedSymptomCount 와 같은 값이며, 조각 목록을 뒤지지 않고도 "감춘 것이
   * 있는가"를 물을 수 있도록 종류 단위에도 둔다.
   */
  otherDistinctCount: number;
};

/**
 * 집계가 읽는 접수 건 한 조각 — EffectiveRepairCase 전체를 끌어오지 않는다.
 * 이 세 칸만 있으면 되고, 좁게 잡아 두어야 시험이 진짜 행을 흉내 내지 않고
 * 필요한 값만 손으로 적을 수 있다.
 */
export type FaultSymptomCase = {
  workflowType: WorkflowType;
  reportedSymptom: string | null;
  intakeInspectionResult: string | null;
};

function buildKindBreakdown(
  kind: WeeklyReportKind,
  rows: readonly FaultSymptomCase[]
): FaultSymptomKindBreakdown {
  const pieSlices = buildPieSlices(rows, {
    labelOf: (row) => row.reportedSymptom,
    unspecifiedLabel: FAULT_SYMPTOM_UNSPECIFIED_LABEL,
    fold: { topLimit: FAULT_SYMPTOM_TOP_SLICE_LIMIT, otherLabel: FAULT_SYMPTOM_OTHER_LABEL },
    detail: intakeInspectionDetail,
  });

  const slices: FaultSymptomSlice[] = pieSlices.map((slice) => {
    const sliceKind = SLICE_KIND_BY_PIE_KIND[slice.sliceKind];
    return {
      key: `${sliceKind}:${slice.label}`,
      label: slice.label,
      sliceKind,
      count: slice.count,
      percentage: slice.percentage,
      startAngle: slice.startAngle,
      sweepAngle: slice.sweepAngle,
      foldedSymptomCount: slice.foldedGroupCount,
      intakeInspectionResults: toIntakeInspectionResultGroups(slice.detail),
      intakeInspectionPendingCount: slice.detail.pendingCount,
    };
  });

  return {
    kind,
    total: rows.length,
    slices,
    otherDistinctCount: slices.find((slice) => slice.sliceKind === "OTHER")?.foldedSymptomCount ?? 0,
  };
}

/**
 * 범례와 펼친 자리의 제목이 함께 쓰는 이름표.
 *
 * 기타 조각만 몇 가지를 접었는지 덧붙인다 — 그냥 `기타`라고만 두면 "이게 전부"로
 * 읽힌다. 규칙 자체는 pie-slices.ts 가 갖고, 이 함수는 이 화면의 필드 이름
 * (foldedSymptomCount)을 거기 맞춰 주는 얇은 껍데기다.
 */
export function formatFaultSymptomSliceLabel(slice: FaultSymptomSlice): string {
  return formatPieSliceLabel({
    sliceKind: slice.sliceKind,
    label: slice.label,
    foldedGroupCount: slice.foldedSymptomCount,
  });
}

/**
 * 접수 건 목록 → RFG · MB 두 종류의 원.
 *
 * **건이 하나도 없는 종류도 자리를 지킨다**(총 0, 조각 없음). 빈 종류를 빼면
 * 화면이 두 원을 그릴지 하나를 그릴지 매번 달라져, 옆에 놓고 견주던 자리가
 * 사라진다. 화면은 총 0 인 종류에 원 대신 `해당 건이 없습니다` 한 줄을 그린다.
 *
 * 목록을 거르지 않는다 — 출하 완료 건도 들어 있다(파일 헤더).
 */
export function buildFaultSymptomBreakdowns(
  cases: readonly FaultSymptomCase[]
): FaultSymptomKindBreakdown[] {
  const rowsByKind = new Map<WeeklyReportKind, FaultSymptomCase[]>(
    WEEKLY_REPORT_KINDS.map((kind) => [kind, []])
  );
  for (const row of cases) {
    rowsByKind.get(foldWeeklyReportKind(row.workflowType))!.push(row);
  }
  return WEEKLY_REPORT_KINDS.map((kind) => buildKindBreakdown(kind, rowsByKind.get(kind)!));
}

/**
 * ============================================================================
 * 기간 고르기 — 연도·월로 거른 뒤에 센다
 * ============================================================================
 * 대시보드의 이 그래프를 "2026년 3월에 인수된 건"처럼 좁혀 볼 수 있게 하는 순수
 * 함수들이다. **거르기는 세기 앞에 온다** — buildFaultSymptomBreakdowns 는 손대지
 * 않고 이미 걸러진 배열을 넘겨받기만 한다. 그 함수는 제품 모델 상세의 원형 그래프
 * 넷과 규칙(pie-slices.ts)을 공유하고 있어서, 거기에 기간을 끌어들이면 이 화면과
 * 무관한 쪽까지 따라 바뀐다.
 *
 * ── 왜 이 계산이 이 파일에 있나 ─────────────────────────────────────────
 * 새 모듈 파일을 만들면 짝이 되는 새 시험 파일이 생기고, 시험 파일을 등록하는
 * package.json 의 test 스크립트가 **한 줄**이라 같은 저장소에서 병행 중인 다른
 * 작업과 그 줄에서 충돌한다. 그래서 이 계산을 fault-symptom-breakdown.ts 안에
 * 두고 시험도 fault-symptom-breakdown.test.ts 에 이어 붙였다. 취향이 아니라
 * 그 제약 때문이다 — 옮길 이유가 생기면 코드와 시험을 함께 옮기면 된다.
 *
 * ── 인수일(receivedAt)로 묶는다 ─────────────────────────────────────────
 * 신고 증상은 접수될 때 적히는 값이라 인수일로 묶는 것이 뜻이 맞다. 출하일로
 * 묶으면 아직 나가지 않은 건이 통째로 빠진다.
 *
 * ── 문자열을 그대로 읽는다 — new Date(문자열) 을 쓰지 않는다 ────────────
 * receivedAt 은 "YYYY-MM-DD" 꼴의 날짜 문자열이다(resolved-repair-case.ts).
 * new Date("2026-01-01") 은 UTC 자정으로 읽히고, 거기서 getFullYear() 를 부르면
 * 실행 시간대에 따라 2025-12-31 이 되어 **1월 1일 접수 건이 전 해로 잡힌다.**
 * 그래서 시간대가 끼어들 자리가 없도록 문자열 앞머리를 정규식으로 읽는다.
 *
 * date-only.ts 를 쓰지 않은 까닭: 그 파일이 내보내는 것은 Date 인스턴트를 KST
 * 달력 날짜로 바꾸거나(toKstDateOnly · toKstYearMonth) 날짜 문자열에 날·달을
 * 더하는(addCalendarDays · addCalendarMonths) 함수들이고, **날짜 문자열에서
 * 연·월을 읽어 내는 함수는 없다.** 문자열을 잘라 쓴다는 방식 자체는 그 파일과
 * 같다 — 규칙을 옮겨 적은 것이 아니라 가져다 쓸 것이 없었다.
 *
 * ── 인수일을 읽을 수 없는 건 ────────────────────────────────────────────
 * 값이 비었거나 꼴이 어긋난 건(예: "", "2026/03/01", "2026-13-05")은 **전체에는
 * 남고, 특정 연도·월에는 들어가지 않는다.** 어느 달의 건인지 말할 수 없는 것을
 * 어느 달에 끼워 넣으면 그 달의 숫자가 거짓이 된다.
 *
 * 파일 헤더의 `안 적힌 건을 버리지 않는다`와 어긋나지 않는다 — 그 규칙이 지키는
 * 것은 **조각 건수의 합 = 그 종류의 총 대수**이고, 그 등식은 여기서도 그대로
 * 성립한다(거르고 남은 배열을 세기 때문이다). 대신 연도별 건수를 모두 더한 값이
 * 전체보다 작을 수 있고, 그 차이가 곧 "인수일을 읽을 수 없는 건이 있다"는 뜻이다.
 *
 * ── 연도 없이 월만 고를 수는 없다 ───────────────────────────────────────
 * 사용자가 "연도를 먼저 고르고 그 안에서 월"을 골랐다(모든 해의 3월을 한꺼번에
 * 보는 방식은 쓰지 않는다). 그래서 FaultSymptomPeriod 를 유니온으로 두어
 * `{ year: null, month: 3 }` 이 **타입 단계에서 만들어지지 않게** 막았다.
 * selectFaultSymptomPeriodCases 도 year 가 null 이면 month 를 아예 보지 않는다.
 * 화면이 월 칸을 잠그는 것은 그 결과를 사람에게 보여 주는 일일 뿐이다.
 * ============================================================================
 */

/**
 * 월 고르는 칸에 나가는 값 — 자료에 한 건도 없는 달도 보여 준다. 있는 달만
 * 보여 주면 "그 달에 0건"과 "고를 수조차 없음"이 구별되지 않는다.
 */
export const FAULT_SYMPTOM_PERIOD_MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;

/**
 * 그래프에 걸린 기간.
 *
 * `{ year: null, month: null }` 이 **전체**다. 유니온으로 갈라 둔 덕에 "연도는
 * 전체인데 월만 3월" 이라는 조합은 타입이 거부한다 — 사용자가 고른 방식이
 * "연도 먼저"라서, 그 조합에는 뜻이 없다.
 */
export type FaultSymptomPeriod =
  | { year: null; month: null }
  | { year: number; month: number | null };

/** 처음 상태이자 "거르지 않음". 화면과 시험이 같은 값을 쓴다. */
export const FAULT_SYMPTOM_ALL_PERIOD: FaultSymptomPeriod = { year: null, month: null };

/**
 * 기간 계산이 읽는 접수 건 한 조각 — FaultSymptomCase 와 일부러 따로 둔다.
 * 세는 쪽은 인수일을 보지 않고, 거르는 쪽은 종류·증상을 보지 않는다. 한 타입에
 * 합쳐 두면 어느 쪽 시험이든 쓰지도 않는 칸을 채워야 한다.
 */
export type FaultSymptomPeriodCase = {
  /** "YYYY-MM-DD". 비었거나 꼴이 어긋난 값이 들어올 수 있다(위 헤더 참조). */
  receivedAt: string | null;
};

/** "YYYY-MM-DD" 앞머리만 읽는다. 뒤에 시각이 붙어 있어도 상관없다. */
const RECEIVED_AT_YEAR_MONTH = /^(\d{4})-(\d{2})-\d{2}/;

/** 읽을 수 없으면 null — 부르는 쪽이 "어느 해인지 말할 수 없다"로 다룬다. */
function readReceivedYearMonth(
  receivedAt: string | null | undefined
): { year: number; month: number } | null {
  const matched = RECEIVED_AT_YEAR_MONTH.exec(receivedAt?.trim() ?? "");
  if (!matched) return null;
  const month = Number(matched[2]);
  if (month < 1 || month > 12) return null;
  return { year: Number(matched[1]), month };
}

/**
 * 접수 건이 실제로 있는 연도만, 최근 해가 위로 오게(내림차순) 중복 없이.
 *
 * 연도 목록을 고정하지 않고 자료에서 뽑는 이유: 자료가 없는 해를 고르게 해 봐야
 * 언제나 0건이고, 해가 바뀔 때마다 목록을 손봐야 한다.
 */
export function listFaultSymptomYears(cases: readonly FaultSymptomPeriodCase[]): number[] {
  const years = new Set<number>();
  for (const row of cases) {
    const yearMonth = readReceivedYearMonth(row.receivedAt);
    if (yearMonth) years.add(yearMonth.year);
  }
  return [...years].sort((a, b) => b - a);
}

/**
 * 고른 기간에 인수된 건만 남긴다. **전체(year === null)면 한 건도 걸러지지
 * 않는다** — 기간을 고르기 전 화면이 예전 그대로여야 한다는 뜻이다.
 *
 * 넘겨받은 원소 타입을 그대로 돌려주는 제네릭이라, 화면은 걸러진 배열을
 * buildFaultSymptomBreakdowns 에 그냥 넘길 수 있다(새 조회를 하지 않는다).
 */
export function selectFaultSymptomPeriodCases<T extends FaultSymptomPeriodCase>(
  cases: readonly T[],
  period: FaultSymptomPeriod
): T[] {
  if (period.year === null) return cases.slice();
  return cases.filter((row) => {
    const yearMonth = readReceivedYearMonth(row.receivedAt);
    if (!yearMonth) return false;
    if (yearMonth.year !== period.year) return false;
    return period.month === null || yearMonth.month === period.month;
  });
}

/**
 * 걸린 기간을 사람이 읽는 한 마디로. 그래프만 바뀌고 아무 말이 없으면 무엇을
 * 보고 있는지 알 수 없어서, 화면이 원 위에 이 글자를 적는다.
 */
export function formatFaultSymptomPeriodLabel(period: FaultSymptomPeriod): string {
  if (period.year === null) return "전체 기간";
  if (period.month === null) return `${period.year}년`;
  return `${period.year}년 ${period.month}월`;
}
