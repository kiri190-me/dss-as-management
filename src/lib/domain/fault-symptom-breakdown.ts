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

/** 한 조각 안의 인수점검 결과 한 묶음. */
export type IntakeInspectionResultGroup = {
  /** 앞뒤 공백을 걷어낸 원문 그대로. 여러 줄일 수 있어 화면은 줄바꿈을 살려 그린다. */
  result: string;
  count: number;
};

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

/** 집계 도중의 한 묶음. 밖으로 나가지 않는다. */
type Bucket = {
  label: string;
  count: number;
  /** 인수점검 결과 원문 → 건수. */
  resultCounts: Map<string, number>;
  pendingCount: number;
};

function newBucket(label: string): Bucket {
  return { label, count: 0, resultCounts: new Map(), pendingCount: 0 };
}

/** null · 빈 문자열 · 공백뿐인 값을 하나로 본다. 두 칸 모두 자유 입력이라 셋이 다 온다. */
function normalizeFreeText(value: string | null): string {
  return value?.trim() ?? "";
}

function addCase(bucket: Bucket, intakeInspectionResult: string | null): void {
  bucket.count += 1;
  const result = normalizeFreeText(intakeInspectionResult);
  if (result === "") {
    bucket.pendingCount += 1;
    return;
  }
  bucket.resultCounts.set(result, (bucket.resultCounts.get(result) ?? 0) + 1);
}

/**
 * 건수 많은 순, 같으면 이름 오름차순.
 *
 * 기준을 하나만 두면 건수가 같은 두 조각의 차례가 부를 때마다 뒤바뀌어, 어제 본
 * 그래프와 나란히 놓고 볼 수 없다.
 */
function compareByCountThenLabel(
  a: { label: string; count: number },
  b: { label: string; count: number }
): number {
  if (b.count !== a.count) return b.count - a.count;
  return a.label.localeCompare(b.label, "ko");
}

function toResultGroups(bucket: Bucket): IntakeInspectionResultGroup[] {
  return [...bucket.resultCounts.entries()]
    .map(([result, count]) => ({ result, count }))
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return a.result.localeCompare(b.result, "ko");
    });
}

/** 접힌 증상들을 기타 한 묶음으로 합친다 — 인수점검 결과도 함께 합쳐진다. */
function mergeBuckets(label: string, buckets: readonly Bucket[]): Bucket {
  const merged = newBucket(label);
  for (const bucket of buckets) {
    merged.count += bucket.count;
    merged.pendingCount += bucket.pendingCount;
    for (const [result, count] of bucket.resultCounts) {
      merged.resultCounts.set(result, (merged.resultCounts.get(result) ?? 0) + count);
    }
  }
  return merged;
}

function buildKindBreakdown(
  kind: WeeklyReportKind,
  rows: readonly FaultSymptomCase[]
): FaultSymptomKindBreakdown {
  const symptomBuckets = new Map<string, Bucket>();
  const unspecified = newBucket(FAULT_SYMPTOM_UNSPECIFIED_LABEL);
  let total = 0;

  for (const row of rows) {
    total += 1;
    const label = normalizeFreeText(row.reportedSymptom);
    if (label === "") {
      addCase(unspecified, row.intakeInspectionResult);
      continue;
    }
    let bucket = symptomBuckets.get(label);
    if (!bucket) {
      bucket = newBucket(label);
      symptomBuckets.set(label, bucket);
    }
    addCase(bucket, row.intakeInspectionResult);
  }

  const sortedSymptoms = [...symptomBuckets.values()].sort(compareByCountThenLabel);
  const top = sortedSymptoms.slice(0, FAULT_SYMPTOM_TOP_SLICE_LIMIT);
  const folded = sortedSymptoms.slice(FAULT_SYMPTOM_TOP_SLICE_LIMIT);

  /**
   * 차례: 상위 증상 → 미입력 → 기타.
   *
   * 미입력과 기타를 건수 순서에 끼워 넣지 않고 뒤로 모으는 이유는, 그 둘이 증상이
   * 아니라 "센 방식"에 대한 칸이기 때문이다. 무채색 두 조각이 원의 한쪽에 붙어
   * 있어야 색이 있는 조각들끼리 크기를 견줄 수 있다.
   */
  const entries: { bucket: Bucket; sliceKind: FaultSymptomSliceKind; foldedSymptomCount: number }[] =
    top.map((bucket) => ({ bucket, sliceKind: "SYMPTOM" as const, foldedSymptomCount: 1 }));
  if (unspecified.count > 0) {
    entries.push({ bucket: unspecified, sliceKind: "UNSPECIFIED", foldedSymptomCount: 1 });
  }
  if (folded.length > 0) {
    entries.push({
      bucket: mergeBuckets(FAULT_SYMPTOM_OTHER_LABEL, folded),
      sliceKind: "OTHER",
      foldedSymptomCount: folded.length,
    });
  }

  // 각도는 누적 건수에서 바로 뽑는다. 조각마다 (건수/총) × 360 을 따로 반올림해
  // 이어 붙이면 오차가 쌓여 마지막 조각과 첫 조각 사이에 틈이 벌어진다.
  let cumulative = 0;
  const slices: FaultSymptomSlice[] = entries.map((entry) => {
    const startAngle = (cumulative / total) * 360;
    cumulative += entry.bucket.count;
    const endAngle = (cumulative / total) * 360;
    return {
      key: `${entry.sliceKind}:${entry.bucket.label}`,
      label: entry.bucket.label,
      sliceKind: entry.sliceKind,
      count: entry.bucket.count,
      percentage: Math.round((entry.bucket.count / total) * 1000) / 10,
      startAngle,
      sweepAngle: endAngle - startAngle,
      foldedSymptomCount: entry.foldedSymptomCount,
      intakeInspectionResults: toResultGroups(entry.bucket),
      intakeInspectionPendingCount: entry.bucket.pendingCount,
    };
  });

  return { kind, total, slices, otherDistinctCount: folded.length };
}

/**
 * 범례와 펼친 자리의 제목이 함께 쓰는 이름표.
 *
 * 기타 조각만 몇 가지를 접었는지 덧붙인다 — 그냥 `기타`라고만 두면 "이게 전부"로
 * 읽힌다. 화면 두 자리가 같은 글자를 쓰도록 여기 한 곳에 둔다(weekly-report.ts 가
 * 라벨 표를 도메인에 두는 것과 같은 이유다).
 */
export function formatFaultSymptomSliceLabel(slice: FaultSymptomSlice): string {
  if (slice.sliceKind === "OTHER") return `${slice.label}(${slice.foldedSymptomCount}종)`;
  return slice.label;
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
