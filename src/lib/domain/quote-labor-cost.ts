/**
 * ============================================================================
 * 견적서 작업비 — 고른 수리 작업으로 셈한다
 * ============================================================================
 * `작업비 = 기본 작업비 + Σ(고른 작업의 공수시간 × 시간당 작업비)`
 *
 * ── 🔴 작업비는 부품이 아니라 '작업'에 붙는다 ───────────────────────────
 * 이 파일은 원래 **부품마다의 작업비를 합산**했다. 그 전제가 틀렸다는 것이
 * 사용자 정정으로 드러나(2026-08-31) 규칙을 통째로 바꿨다. 같은 부품을 갈아도
 * 어떤 작업으로 처리하느냐에 따라 값이 다르고, 부품을 하나도 안 갈아도 작업비만
 * 나가는 일이 있다. 옛 규칙은 남겨 두지 않는다 — 쓰지 않는 계산식이 옆에 있으면
 * 언젠가 누군가 그것을 부른다.
 *
 * 오버홀도 목록의 한 줄일 뿐이다(제너레이터 `OH` 24시간 = 240만원). 따로 사는
 * 값이 아니라서 O/H 작업비만을 위한 자리를 두지 않는다.
 *
 * ── 시간당 단가를 줄마다 들고 다닌다 ────────────────────────────────────
 * 견적서에 저장된 줄은 **그때의 단가를 베껴 둔 스냅샷**이다(quote_repair_tasks).
 * 지금 카탈로그의 단가로 다시 셈하면, 단가가 오른 뒤 옛 견적서를 열었을 때
 * 화면의 합계가 실제로 보낸 금액과 달라진다.
 *
 * ── 기본 작업비의 null 은 0 이 아니다 ──────────────────────────────────
 * null 은 "그 장비의 기본 작업비를 아직 정하지 않았다"이고 `"0"` 은 "기본
 * 작업비가 없다"는 실제 값이다. null 을 0 으로 접으면 정하지 않았다는 사실이
 * 사라지고 화면이 그것을 알릴 수 없다.
 *
 * ── 통전작업을 빼면 기본 작업비에서 뺀다 ────────────────────────────────
 * 기본 작업비 안에는 **통전작업 몫이 이미 들어 있다**(2026-09-04 사용자:
 * 제너레이터·매쳐 350만원 중 14시간 = 140만원). 통전작업을 하지 않는 장은
 * `기본 작업비 − (통전 공수시간 × 시간당 작업비)` 로 210만원이 되어야 한다.
 *
 * 🔴 **뺄 수 없으면 조용히 0 을 빼지 않는다.** 통전 공수시간을 아직 정하지
 * 않은 장비(T/C)에서 0 을 빼면 합계는 350만원 그대로인데 사람은 210만원이 나온
 * 줄 안다. 그래서 못 뺀 이유를 함께 돌려주고 화면이 그것을 말한다 — 아래
 * `unknown` 이 "무엇이 빠졌는지 이름을 돌려준다"고 한 그 정신과 같다.
 * ============================================================================
 */

/** 견적서가 고른 작업 한 줄. 카탈로그의 줄이 아니라 **그때 값의 사본**이다. */
export type SelectedRepairTask = {
  taskName: string;
  /** 공수시간. */
  hours: number;
  /** 그때의 시간당 작업비(원). numeric 이라 문자열로 오간다. */
  hourlyRate: string;
};

/**
 * 「통전작업 제외」를 켰을 때 얼마를 빼는가를 셈하는 데 필요한 것.
 *
 * 세 값 다 **그때 값**이다 — 화면이 이미 들고 있는 `RepairLaborKindRow` 에서
 * 그대로 온다(queries/repair-labor.ts). 이 함수가 설정 표를 다시 보지 않는다.
 */
export type PowerTestExclusion = {
  /** 사람이 켠 「통전작업 제외」. 꺼져 있으면 아무 일도 일어나지 않는다. */
  excluded: boolean;
  /**
   * 그 장비의 통전작업 공수시간.
   * 🔴 **null 은 "아직 정하지 않았다"이고 0 이 아니다**(T/C 가 그렇다).
   */
  hours: number | null;
  /** 그때의 시간당 작업비(원). numeric 이라 문자열로 오간다. */
  hourlyRate: string;
};

/**
 * 「통전작업 제외」를 켰는데 그대로 빼지 못한 까닭. 화면이 이것으로 문구를
 * 고른다 — 이유 없이 금액만 그대로면 사람은 뺀 줄 안다.
 *
 * · `NO_BASE_COST`      기본 작업비를 아직 정하지 않았다 — 뺄 바탕이 없다.
 * · `NO_POWER_TEST_HOURS` 통전 공수시간을 아직 정하지 않았다(T/C). **0 을 빼지 않는다.**
 * · `UNKNOWN_HOURLY_RATE` 시간당 작업비를 숫자로 읽을 수 없다.
 * · `CLAMPED_TO_ZERO`   뺄 금액이 기본 작업비보다 커서 0 에서 멈췄다. 음수 청구는 없다.
 */
export type PowerTestDeductionNotice =
  | "NO_BASE_COST"
  | "NO_POWER_TEST_HOURS"
  | "UNKNOWN_HOURLY_RATE"
  | "CLAMPED_TO_ZERO";

export type QuoteLaborSuggestion = {
  /** 제안할 작업비 합계(원). 기본 작업비 + 고른 작업의 합 − 통전작업 차감. */
  total: number;
  /** 그중 고른 작업의 합만. 화면이 내역을 갈라 보여 줄 때 쓴다. */
  tasksTotal: number;
  /** 합계에 더해진 기본 작업비(원). **null 이면 더하지 않았다.** */
  baseCost: number | null;
  /** 시간당 단가나 공수시간을 숫자로 읽지 못해 합계에서 빠진 작업들의 건명. */
  unknown: string[];
  /**
   * 통전작업 제외로 **실제로 뺀 금액**(원, 0 이상). `null` 이면 빼지 않았다.
   *
   * 이 값이 그대로 `quotes.labor_power_test_deduction` 스냅샷이 된다 — 나중에
   * 다시 셈하지 않기 위해서다(schema/quotes.ts 의 그 항목).
   *
   * 🔴 **차감을 부탁하지 않으면 이 키 자체가 없다**(아래 `powerTestNotice` 도).
   * "차감을 주지 않으면 지금과 완전히 같은 값"이라는 약속을 글자 그대로 지킨다 —
   * 키를 만들어 `null` 을 담기만 해도 결과 객체를 통째로 비교하는 쪽이 깨진다.
   */
  powerTestDeduction?: number | null;
  /** 못 뺐거나 0 에서 멈춘 까닭. 그대로 뺐으면 `null` 이다. */
  powerTestNotice?: PowerTestDeductionNotice | null;
};

/**
 * @param baseCost 이 장비 종류의 기본 작업비.
 *   · `null` — 아직 정하지 않았다. **0 으로 접지 않고** 더하지 않는다.
 *   · `"3500000"` — 더한다. `"0"` 은 실제 0원이라 더해도 합계가 그대로다.
 * @param powerTest 「통전작업 제외」. **주지 않으면 예전과 한 글자도 다르지
 *   않은 결과가 나온다** — 옛 견적서가 달라지지 않는 자리가 여기다.
 */
export function sumQuoteLaborCost(
  tasks: readonly SelectedRepairTask[],
  baseCost: string | null,
  powerTest?: PowerTestExclusion
): QuoteLaborSuggestion {
  let tasksTotal = 0;
  const unknown: string[] = [];

  for (const task of tasks) {
    const rate = Number(task.hourlyRate);
    // 숫자로 읽히지 않는 값은 더하지 않는다 — NaN 하나가 합계 전체를 NaN 으로
    // 만들고, 화면에는 금액 대신 이상한 글자가 뜬다. 대신 **무엇이 빠졌는지
    // 이름을 돌려준다** — 조용히 빼면 사람은 합계가 맞는 줄 안다.
    if (!Number.isFinite(rate) || !Number.isFinite(task.hours)) {
      unknown.push(task.taskName);
      continue;
    }
    tasksTotal += task.hours * rate;
  }

  let addedBase: number | null = null;
  if (baseCost !== null) {
    const parsed = Number(baseCost);
    if (Number.isFinite(parsed)) addedBase = parsed;
  }

  const suggestion: QuoteLaborSuggestion = {
    total: tasksTotal + (addedBase ?? 0),
    tasksTotal,
    baseCost: addedBase,
    unknown,
  };

  // 🔴 부탁하지 않았으면 여기서 끝난다 — 키도 만들지 않는다(위 그 항목).
  if (!powerTest?.excluded) return suggestion;

  const { deduction, notice } = resolvePowerTestDeduction(addedBase, powerTest);
  suggestion.powerTestDeduction = deduction;
  suggestion.powerTestNotice = notice;
  // 뺀 몫은 **기본 작업비에서만** 나간다. 고른 작업의 합은 따로 청구하는 일이라
  // 여기에 걸리지 않는다.
  if (deduction !== null && addedBase !== null) {
    suggestion.total = tasksTotal + (addedBase - deduction);
  }
  return suggestion;
}

/**
 * 얼마를 뺄 수 있는가. **못 빼는 쪽이 기본이다** — 셋 중 하나라도 모르면
 * 0 을 빼는 대신 이유를 돌려준다.
 */
function resolvePowerTestDeduction(
  addedBase: number | null,
  powerTest: PowerTestExclusion
): { deduction: number | null; notice: PowerTestDeductionNotice | null } {
  // 기본 작업비가 없으면 뺄 바탕이 없다. 지금도 합계에 더하지 않는 상태이고,
  // 여기서 차감까지 만들면 고른 작업의 합에서 통전 몫이 빠진다.
  if (addedBase === null) return { deduction: null, notice: "NO_BASE_COST" };

  // 🔴 null 은 0 이 아니다. 조용히 0 을 빼면 사람은 210만원이 나온 줄 안다.
  const hours = powerTest.hours;
  if (hours === null || !Number.isFinite(hours)) {
    return { deduction: null, notice: "NO_POWER_TEST_HOURS" };
  }

  // 빈 문자열도 "모른다"이다 — Number("") 는 0 이라 그냥 두면 0원을 뺀 것이 된다.
  const rate = powerTest.hourlyRate.trim() === "" ? Number.NaN : Number(powerTest.hourlyRate);
  if (!Number.isFinite(rate)) return { deduction: null, notice: "UNKNOWN_HOURLY_RATE" };

  const wanted = hours * rate;
  // 🔴 0 에서 멈춘다. 음수 청구는 없다 — 그리고 멈췄다는 사실을 알린다.
  if (wanted > addedBase) return { deduction: addedBase, notice: "CLAMPED_TO_ZERO" };
  return { deduction: wanted, notice: null };
}
