/**
 * ============================================================================
 * 원형 그래프의 조각 — 세는 규칙 한 벌
 * ============================================================================
 * 이 서비스에는 원형 그래프가 여럿이다(대시보드의 신고 증상 RFG·MB 두 장, 제품
 * 모델 상세의 고장 증상·고장 부품·End-User·유/무상 네 장). 그리는 모습은 화면이
 * 정하지만 **무엇을 몇 조각으로 나누는가**는 전부 같은 규칙이어야 한다 — 한쪽만
 * 미입력을 버리거나 한쪽만 각도를 반올림하면, 두 화면을 나란히 놓고 본 사람이
 * 어느 쪽을 믿어야 하는지 알 수 없게 된다.
 *
 * 그래서 규칙을 여기 한 곳에만 둔다:
 *
 *   ── 안 적힌 값을 버리지 않는다 ─────────────────────────────────────────
 *   값이 null 이거나 공백뿐인 행은 **미입력 조각**으로 센다(이름은 부르는 쪽이
 *   정한다 — 증상은 `미입력`, End-User 는 `미지정`이다). 버리면 조각 건수의 합이
 *   총 건수와 달라지고, 한 번 어긋난 그래프는 아무도 다시 보지 않는다.
 *   **조각 건수의 합은 언제나 넘겨받은 행 수와 같다** — 시험이 못 박아 둔다.
 *
 *   ── 접되, 몇 가지를 접었는지 말한다 ────────────────────────────────────
 *   종류가 많으면 원이 실오라기로 뒤덮여 읽을 수 없어 상위 N 개만 남기고 나머지를
 *   **기타** 하나로 접는다. 말없이 잘라내면 "이게 전부"로 읽히므로 접힌 종류 수를
 *   함께 돌려주고, 화면은 그것을 `기타(12종)`처럼 적는다(formatPieSliceLabel).
 *
 *   **미입력은 접기 대상이 아니다.** 건수가 아무리 적어도 따로 보여 준다 — "안
 *   적힌 건이 몇 건인가"는 그 자체로 알아야 할 정보이고, 기타에 섞이면 영영
 *   보이지 않는다. 그래서 상위 N 은 미입력을 뺀 나머지 중에서 고른다.
 *
 *   ── 접기를 끌 수 있다 ──────────────────────────────────────────────────
 *   `fold` 를 넘기지 않으면 접지 않는다. 값이 넷뿐인 칸(유/무상)에 기타가 생기면
 *   그것은 요약이 아니라 고장으로 보인다.
 *
 *   ── 차례 ───────────────────────────────────────────────────────────────
 *   기본은 건수 많은 순 → 같으면 이름 오름차순(`localeCompare("ko")`). 기준을
 *   하나만 두면 건수가 같은 두 조각의 차례가 부를 때마다 뒤바뀌어 어제 본 그래프와
 *   나란히 놓고 볼 수 없다.
 *
 *   값이 미리 정해져 있는 칸은 `valueOrder` 로 차례를 **못 박는다**. 유/무상처럼
 *   고를 수 있는 값이 넷뿐인데 조각 차례가 주마다 바뀌면 눈이 매번 다시 읽어야
 *   한다. 미입력과 기타는 그 뒤에 붙는다 — 그 둘은 값이 아니라 "센 방식"에 대한
 *   칸이라, 무채색 조각이 원의 한쪽에 모여 있어야 색 있는 조각끼리 크기를 견줄 수
 *   있다.
 *
 *   ── 각도는 누적 건수에서 직접 뽑는다 ───────────────────────────────────
 *   조각마다 (건수/총) × 360 을 따로 반올림해 이어 붙이면 오차가 쌓여 마지막
 *   조각과 첫 조각 사이에 틈이 벌어진다. 화면에 적는 %는 따로 반올림하므로 그
 *   합이 100.0 이 아닐 수 있고, **억지로 맞추지 않는다** — 맞추려면 어느 한 조각의
 *   숫자를 거짓으로 적어야 한다.
 *
 *   ── 딸린 값도 함께 합쳐진다 — detail ───────────────────────────────────
 *   조각은 건수만 들고 다니지 않는다. 고장 증상 조각은 "그 증상 건들의 인수점검
 *   결과 묶음"을 달고 다니고, 기타로 접히면 그것들도 **함께 합쳐져야** 한다.
 *   무엇을 어떻게 모으고 합칠지는 도메인마다 다르므로 부르는 쪽이 넘긴다
 *   (PieDetailHandlers). 달 것이 없는 그래프는 NO_PIE_DETAIL 을 넘긴다.
 *
 * 이 파일에는 React 도 DB 도 들어오지 않는다 — 순수 함수뿐이다. "왜 이 조각이
 * 이만큼인가"는 규칙이지 그리기가 아니라서, 화면 안에 두면 시험할 방법이
 * 브라우저를 띄우는 것밖에 남지 않는다.
 * ============================================================================
 */

/**
 * 조각의 성격. 화면이 색을 고를 때 쓴다 — 미입력·기타는 "실제 값"이 아니라서
 * 무채색으로 따로 칠한다. 이름표 글자로 갈라내면 `기타`라고 **적힌 진짜 값**이
 * 들어왔을 때 엉뚱한 색이 된다.
 */
export type PieSliceKind = "VALUE" | "UNSPECIFIED" | "OTHER";

/**
 * 원 하나를 그리는 데 필요한 최소한.
 *
 * `sliceKind` 를 좁은 union 이 아니라 string 으로 둔 이유: 대시보드의
 * FaultSymptomSlice 는 값 조각을 `SYMPTOM` 이라 부르고(그 이름이 이미 밖으로
 * 나가 있다) 이 파일은 `VALUE` 라 부른다. 그리는 쪽이 알아보아야 하는 것은
 * **무채색으로 칠할 두 글자**뿐이라, 그 둘만 못 박고 나머지는 부르는 쪽이 제
 * 도메인 이름을 그대로 쓰게 둔다.
 */
export type PieChartSlice = {
  /** React key. 이름표를 그대로 쓰지 않는다 — `기타`라고 적힌 진짜 값과 겹친다. */
  key: string;
  label: string;
  /** `UNSPECIFIED` · `OTHER` 만 그리는 쪽이 알아본다(무채색). 그 밖은 전부 값 조각. */
  sliceKind: string;
  count: number;
  /** 소수 첫째 자리에서 반올림한 %. 다 더해도 100.0 이 아닐 수 있다(파일 헤더). */
  percentage: number;
  /** 12시 방향을 0 으로 하는 시작 각도(도). 건수에서 직접 나온다. */
  startAngle: number;
  /** 이 조각이 차지하는 각도(도). 조각 전체의 합은 언제나 360 이다. */
  sweepAngle: number;
};

export type PieSlice<TDetail> = PieChartSlice & {
  sliceKind: PieSliceKind;
  /**
   * 이 조각에 뭉쳐진 **종류의 수**. 값·미입력 조각은 1 이고, 기타 조각만 1 보다
   * 클 수 있다. 화면은 이 값으로 `기타(12종)`를 적는다.
   */
  foldedGroupCount: number;
  /** 조각에 딸린 값. 달 것이 없으면 null(NO_PIE_DETAIL). */
  detail: TDetail;
};

/**
 * 조각에 딸린 값을 모으고 합치는 방법. 접힐 때 merge 가 불린다.
 *
 * add 는 누적기를 **제자리에서** 바꾼다(반환하지 않는다) — 건마다 새 객체를
 * 만들면 큰 목록에서 그것만으로 시간이 간다.
 */
export type PieDetailHandlers<TRow, TDetail> = {
  create: () => TDetail;
  add: (detail: TDetail, row: TRow) => void;
  /** 기타로 접힌 조각들의 딸린 값을 하나로 합친다. */
  merge: (details: readonly TDetail[]) => TDetail;
};

/** 조각에 달 것이 없는 그래프가 쓴다(고장 부품 · End-User · 유/무상). */
export const NO_PIE_DETAIL: PieDetailHandlers<unknown, null> = {
  create: () => null,
  add: () => undefined,
  merge: () => null,
};

export type PieFoldOptions = {
  /** 원에 그대로 남는 **값 조각**의 최대 개수. 미입력은 이 셈에 들어가지 않는다. */
  topLimit: number;
  /** 접힌 값들이 모이는 조각의 이름. 화면은 여기에 `(N종)`을 덧붙인다. */
  otherLabel: string;
};

export type PieSliceOptions<TRow, TDetail> = {
  /** 이 행이 어느 조각인가. null · 빈 문자열 · 공백뿐인 값은 전부 미입력이다. */
  labelOf: (row: TRow) => string | null;
  /** 값이 비어 있는 행이 모이는 조각의 이름(`미입력` · `미지정`). */
  unspecifiedLabel: string;
  /** 없으면 **접지 않는다**. 값이 몇 개뿐인 칸에 기타가 생기면 고장으로 보인다. */
  fold?: PieFoldOptions;
  /**
   * 값 조각의 차례를 못 박는다. 여기 없는 이름표는 그 뒤에 건수 순으로 붙는다.
   * 넘기지 않으면 전부 건수 많은 순 → 이름 오름차순이다.
   */
  valueOrder?: readonly string[];
  detail: PieDetailHandlers<TRow, TDetail>;
};

type Bucket<TDetail> = {
  label: string;
  count: number;
  detail: TDetail;
};

/** 건수 많은 순, 같으면 이름 오름차순. */
function compareByCountThenLabel(
  a: { label: string; count: number },
  b: { label: string; count: number }
): number {
  if (b.count !== a.count) return b.count - a.count;
  return a.label.localeCompare(b.label, "ko");
}

/**
 * 정해진 차례가 있으면 그 차례로. 목록에 없는 이름표는 **뒤로 밀고** 그들끼리는
 * 건수 순으로 둔다 — 목록에 빠진 값이 생겨도 조각이 사라지거나 앞으로 튀어나오지
 * 않는다.
 */
function compareByFixedOrder(
  order: readonly string[],
  a: { label: string; count: number },
  b: { label: string; count: number }
): number {
  const indexA = order.indexOf(a.label);
  const indexB = order.indexOf(b.label);
  if (indexA !== indexB) {
    if (indexA < 0) return 1;
    if (indexB < 0) return -1;
    return indexA - indexB;
  }
  return compareByCountThenLabel(a, b);
}

/** null · 빈 문자열 · 공백뿐인 값을 하나로 본다. 자유 입력 칸은 셋이 다 온다. */
function normalize(value: string | null): string {
  return value?.trim() ?? "";
}

/**
 * 행 목록 → 원의 조각들.
 *
 * 행이 하나도 없으면 **빈 배열**이다(0 으로 나누는 자리가 생기지 않는다). 화면은
 * 그때 원 대신 한 줄짜리 안내를 그린다.
 */
export function buildPieSlices<TRow, TDetail>(
  rows: readonly TRow[],
  options: PieSliceOptions<TRow, TDetail>
): PieSlice<TDetail>[] {
  const { labelOf, unspecifiedLabel, fold, valueOrder, detail } = options;
  const total = rows.length;
  if (total === 0) return [];

  const valueBuckets = new Map<string, Bucket<TDetail>>();
  const unspecified: Bucket<TDetail> = {
    label: unspecifiedLabel,
    count: 0,
    detail: detail.create(),
  };

  for (const row of rows) {
    const label = normalize(labelOf(row));
    let bucket: Bucket<TDetail>;
    if (label === "") {
      bucket = unspecified;
    } else {
      const found = valueBuckets.get(label);
      if (found) {
        bucket = found;
      } else {
        bucket = { label, count: 0, detail: detail.create() };
        valueBuckets.set(label, bucket);
      }
    }
    bucket.count += 1;
    detail.add(bucket.detail, row);
  }

  const sortedValues = [...valueBuckets.values()].sort((a, b) =>
    valueOrder ? compareByFixedOrder(valueOrder, a, b) : compareByCountThenLabel(a, b)
  );
  const top = fold ? sortedValues.slice(0, fold.topLimit) : sortedValues;
  const folded = fold ? sortedValues.slice(fold.topLimit) : [];

  // 차례: 값 → 미입력 → 기타 (파일 헤더의 '차례').
  const entries: { bucket: Bucket<TDetail>; sliceKind: PieSliceKind; foldedGroupCount: number }[] =
    top.map((bucket) => ({ bucket, sliceKind: "VALUE" as const, foldedGroupCount: 1 }));
  if (unspecified.count > 0) {
    entries.push({ bucket: unspecified, sliceKind: "UNSPECIFIED", foldedGroupCount: 1 });
  }
  if (fold && folded.length > 0) {
    entries.push({
      bucket: {
        label: fold.otherLabel,
        count: folded.reduce((sum, bucket) => sum + bucket.count, 0),
        detail: detail.merge(folded.map((bucket) => bucket.detail)),
      },
      sliceKind: "OTHER",
      foldedGroupCount: folded.length,
    });
  }

  // 각도는 누적 건수에서 바로 뽑는다(파일 헤더의 '각도').
  let cumulative = 0;
  return entries.map((entry) => {
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
      foldedGroupCount: entry.foldedGroupCount,
      detail: entry.bucket.detail,
    };
  });
}

/**
 * 범례와 펼친 자리의 제목이 함께 쓰는 이름표.
 *
 * 기타 조각만 몇 가지를 접었는지 덧붙인다 — 그냥 `기타`라고만 두면 "이게 전부"로
 * 읽힌다. 두 자리가 같은 글자를 쓰도록 여기 한 곳에 둔다.
 */
export function formatPieSliceLabel(slice: {
  sliceKind: string;
  label: string;
  foldedGroupCount: number;
}): string {
  if (slice.sliceKind === "OTHER") return `${slice.label}(${slice.foldedGroupCount}종)`;
  return slice.label;
}
