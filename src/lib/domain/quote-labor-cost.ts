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
 *
 * ── 조사작업을 빼면 기본 작업비 중 조사 몫을 뺀다 ───────────────────────
 * 기본 작업비는 **조사작업 몫 + 통전작업 몫**이다(2026-09-15 사용자: 「[조사작업
 * 제외]를 체크하면 기본 작업비에서 통전작업비를 뺀 금액만 기본 작업비에서 빠져야
 * 해」). 통전 몫이 위의 `통전 공수시간 × 시간당 작업비` 이고, 조사 몫은 그 나머지
 * `기본 작업비 − 통전 몫` 이다. 350만원 · 통전 140만원이면:
 *
 *   · 조사작업 제외만 — 조사 몫 210만원을 뺀다 → 고른 작업 + 140만원
 *   · 통전작업 제외만 — 통전 몫 140만원을 뺀다 → 고른 작업 + 210만원
 *   · 둘 다           — 두 몫을 다 뺀다       → 고른 작업만
 *
 * 두 차감은 **서로를 보지 않는다** — 통전 차감은 조사 제외 여부와 관계없이 예전 그대로
 * 셈하고 싣는다(labor_power_test_deduction 의 뜻도 그대로 「통전 몫」이다).
 * 🔴 **통전 몫은 한 곳에서만 셈한다**(resolvePowerTestShare). 조사 몫이 같은 셈을 따로
 * 적으면 한쪽만 고쳐지는 날 두 몫의 합이 기본 작업비와 어긋난다.
 *
 * 조사 몫도 **못 빼는 쪽이 기본이다** — 기본 작업비 · 통전 공수시간 · 시간당 작업비 중
 * 하나라도 모르면 빼지 않고 까닭을 돌려준다(`investigationNotice`). 통전 몫을 모른다고
 * 기본 작업비를 통째로 빼지 않는다 — 그러면 통전 몫까지 빠진다. 통전 몫이 기본 작업비보다
 * 크면 조사 몫은 0 에서 멈춘다.
 *
 * 🔴 **조사 몫은 저장하지 않는다**(새 칸을 만들지 않았다 — 마이그레이션 없음). 통전 쪽의
 * `labor_power_test_deduction` 같은 스냅숏이 없으므로, 나중에 설정(기본 작업비 · 통전
 * 공수시간 · 시간당 작업비)이 바뀌면 그 장에서 조사 몫이 얼마였는지 다시 셀 수 없다. 청구
 * 금액은 사람이 적용한 `work_cost` 그대로 남고, 뺀 사실은 `investigation_excluded` 가 말한다.
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
 * 통전작업 — 그 장비의 통전 공수시간 · 시간당 작업비와 「통전작업 제외」.
 *
 * 세 값 다 **그때 값**이다 — 화면이 이미 들고 있는 `RepairLaborKindRow` 에서
 * 그대로 온다(queries/repair-labor.ts). 이 함수가 설정 표를 다시 보지 않는다.
 *
 * 🔴 `hours` · `hourlyRate` 는 **`excluded` 가 거짓이어도 넘긴다.** 「조사작업 제외」가
 * 조사 몫(기본 작업비 − 통전 몫)을 셀 때 통전 몫이 필요하기 때문이다. `excluded` 가
 * 거짓이면 통전 차감만 일어나지 않는다.
 */
export type PowerTestExclusion = {
  /** 사람이 켠 「통전작업 제외」. 꺼져 있으면 통전 차감은 일어나지 않는다. */
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
 * 「조사작업 제외」. 켜면 기본 작업비 중 **조사 몫**(기본 작업비 − 통전 몫)을 뺀다.
 *
 * 통전 몫은 여기서 따로 받지 않고 `powerTest` 인자의 공수시간 · 시간당 작업비로 셈한다 —
 * 셈하는 곳이 한 곳이어야 두 몫의 합이 기본 작업비와 맞는다. `powerTest` 를 주지 않으면
 * 통전 공수시간을 모르는 것과 같다(`NO_POWER_TEST_HOURS`).
 */
export type InvestigationExclusion = {
  /** 사람이 켠 「조사작업 제외」. 꺼져 있으면 아무 일도 일어나지 않는다. */
  excluded: boolean;
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

/**
 * 「조사작업 제외」를 켰는데 조사 몫을 그대로 빼지 못한 까닭 — 통전 쪽과 같은 모양이다.
 *
 * · `NO_BASE_COST`        기본 작업비를 아직 정하지 않았다 — 뺄 바탕이 없다.
 * · `NO_POWER_TEST_HOURS` 통전 공수시간을 모른다(T/C) — 통전 몫을 몰라 조사 몫도 셀 수
 *                         없다. **기본 작업비를 통째로 빼지 않는다.**
 * · `UNKNOWN_HOURLY_RATE` 시간당 작업비를 숫자로 읽을 수 없다 — 위와 같은 까닭이다.
 * · `CLAMPED_TO_ZERO`     통전 몫이 기본 작업비보다 커서 조사 몫이 0 에서 멈췄다.
 */
export type InvestigationDeductionNotice =
  | "NO_BASE_COST"
  | "NO_POWER_TEST_HOURS"
  | "UNKNOWN_HOURLY_RATE"
  | "CLAMPED_TO_ZERO";

export type QuoteLaborSuggestion = {
  /** 제안할 작업비 합계(원). 기본 작업비 + 고른 작업의 합 − 통전작업 차감 − 조사작업 차감. */
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
  /**
   * 「조사작업 제외」로 **실제로 뺀 조사 몫**(원, 0 이상 — 기본 작업비 − 통전 몫). `null`
   * 이면 빼지 않았다. 화면이 「− 조사작업 몫 ○○원(조사작업 제외)」으로 까닭과 함께 보인다.
   *
   * 🔴 저장하지 않는다 — 파일 머리말의 그 항목. 그리고 **부탁하지 않았거나 꺼져 있으면 이
   * 키 자체가 없다**(아래 `investigationNotice` 도 — 위 `powerTestDeduction` 과 같은 약속).
   */
  investigationDeduction?: number | null;
  /** 조사 몫을 못 뺐거나 0 에서 멈춘 까닭. 그대로 뺐으면 `null` 이다. */
  investigationNotice?: InvestigationDeductionNotice | null;
};

/**
 * @param baseCost 이 장비 종류의 기본 작업비.
 *   · `null` — 아직 정하지 않았다. **0 으로 접지 않고** 더하지 않는다.
 *   · `"3500000"` — 더한다. `"0"` 은 실제 0원이라 더해도 합계가 그대로다.
 * @param powerTest 통전작업의 공수시간 · 시간당 작업비와 「통전작업 제외」. **주지 않으면
 *   예전과 한 글자도 다르지 않은 결과가 나온다** — 옛 견적서가 달라지지 않는 자리가 여기다.
 *   「조사작업 제외」가 통전 몫을 셀 때도 이 값을 쓴다.
 * @param investigation 「조사작업 제외」. 켜면 기본 작업비 중 조사 몫을 뺀다(파일 머리말).
 *   **주지 않거나 꺼져 있으면 예전과 한 글자도 다르지 않다.**
 */
export function sumQuoteLaborCost(
  tasks: readonly SelectedRepairTask[],
  baseCost: string | null,
  powerTest?: PowerTestExclusion,
  investigation?: InvestigationExclusion
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

  // 🔴 부탁하지 않은 차감은 키도 만들지 않는다(위 그 항목). 둘 다 아니면 여기서 끝난다.
  if (!powerTest?.excluded && !investigation?.excluded) return suggestion;

  // 기본 작업비 중 남는 몫. 뺀 몫은 **기본 작업비에서만** 나간다 — 고른 작업의 합은 따로
  // 청구하는 일이라 어느 차감에도 걸리지 않는다.
  let baseLeft = addedBase;

  if (powerTest?.excluded) {
    const { deduction, notice } = resolvePowerTestDeduction(addedBase, powerTest);
    suggestion.powerTestDeduction = deduction;
    suggestion.powerTestNotice = notice;
    if (deduction !== null && baseLeft !== null) baseLeft = baseLeft - deduction;
  }

  // 조사 몫은 통전 차감과 **따로** 셈한다 — 기본 작업비에서 통전 몫을 뺀 나머지다. 둘 다
  // 켜면 두 몫이 다 빠져 기본 작업비가 0 이 된다(통전 몫이 기본 작업비보다 크면 통전 쪽이
  // 기본 작업비까지만 빼고 조사 몫은 0 이라 역시 0 — 음수는 없다).
  if (investigation?.excluded) {
    const { deduction, notice } = resolveInvestigationDeduction(addedBase, powerTest);
    suggestion.investigationDeduction = deduction;
    suggestion.investigationNotice = notice;
    if (deduction !== null && baseLeft !== null) baseLeft = baseLeft - deduction;
  }

  suggestion.total = tasksTotal + (baseLeft ?? 0);
  return suggestion;
}

/**
 * 통전 몫 — `통전 공수시간 × 시간당 작업비`. 🔴 **이 셈은 여기 한 곳이다** — 통전 차감과
 * 조사 몫이 함께 부른다. 둘 중 하나라도 모르면 몫 대신 까닭을 돌려준다(0 으로 접지 않는다).
 */
function resolvePowerTestShare(
  powerTest: PowerTestExclusion | undefined
):
  | { share: number; notice: null }
  | { share: null; notice: "NO_POWER_TEST_HOURS" | "UNKNOWN_HOURLY_RATE" } {
  // 통전 인자를 받지 못했으면 공수시간을 모르는 것과 같다.
  if (!powerTest) return { share: null, notice: "NO_POWER_TEST_HOURS" };
  const { hours, hourlyRate } = powerTest;

  // 🔴 null 은 0 이 아니다. 조용히 0 을 빼면 사람은 210만원이 나온 줄 안다.
  if (hours === null || !Number.isFinite(hours)) {
    return { share: null, notice: "NO_POWER_TEST_HOURS" };
  }

  // 빈 문자열도 "모른다"이다 — Number("") 는 0 이라 그냥 두면 0원을 뺀 것이 된다.
  const rate = hourlyRate.trim() === "" ? Number.NaN : Number(hourlyRate);
  if (!Number.isFinite(rate)) return { share: null, notice: "UNKNOWN_HOURLY_RATE" };

  return { share: hours * rate, notice: null };
}

/**
 * 통전 몫을 얼마 뺄 수 있는가. **못 빼는 쪽이 기본이다** — 셋 중 하나라도 모르면
 * 0 을 빼는 대신 이유를 돌려준다.
 */
function resolvePowerTestDeduction(
  addedBase: number | null,
  powerTest: PowerTestExclusion
): { deduction: number | null; notice: PowerTestDeductionNotice | null } {
  // 기본 작업비가 없으면 뺄 바탕이 없다. 지금도 합계에 더하지 않는 상태이고,
  // 여기서 차감까지 만들면 고른 작업의 합에서 통전 몫이 빠진다.
  if (addedBase === null) return { deduction: null, notice: "NO_BASE_COST" };

  const resolved = resolvePowerTestShare(powerTest);
  if (resolved.notice !== null) return { deduction: null, notice: resolved.notice };

  // 🔴 0 에서 멈춘다. 음수 청구는 없다 — 그리고 멈췄다는 사실을 알린다.
  if (resolved.share > addedBase) return { deduction: addedBase, notice: "CLAMPED_TO_ZERO" };
  return { deduction: resolved.share, notice: null };
}

/**
 * 조사 몫을 얼마 뺄 수 있는가 — `기본 작업비 − 통전 몫`. 통전 차감과 같은 원칙으로 **못
 * 빼는 쪽이 기본이다.** 🔴 통전 몫을 모른다고 기본 작업비를 통째로 빼지 않는다 — 그러면
 * 통전 몫까지 빠져 사람이 뜻한 것보다 더 깎인다.
 */
function resolveInvestigationDeduction(
  addedBase: number | null,
  powerTest: PowerTestExclusion | undefined
): { deduction: number | null; notice: InvestigationDeductionNotice | null } {
  if (addedBase === null) return { deduction: null, notice: "NO_BASE_COST" };

  const resolved = resolvePowerTestShare(powerTest);
  if (resolved.notice !== null) return { deduction: null, notice: resolved.notice };

  const wanted = addedBase - resolved.share;
  // 통전 몫이 기본 작업비보다 크면 조사 몫은 없다 — 음수를 빼면(= 더하면) 안 된다. 0 에서
  // 멈추고 알린다.
  if (wanted < 0) return { deduction: 0, notice: "CLAMPED_TO_ZERO" };
  // 기본 작업비보다 많이 빼지 않는다 — 통전 몫이 음수로 적힌 설정이 오더라도 합계가 고른
  // 작업의 합 아래로 내려가지 않게.
  return { deduction: Math.min(wanted, addedBase), notice: null };
}
