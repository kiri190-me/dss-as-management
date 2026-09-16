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
 * ── 🔴 기본 작업비 = (조사h + 통전h + 서류h) × 시간당 단가 ───────────────
 * (2026-09-16 사용자 결정 — schema/repair-labor.ts 의 그 머리말.)
 * 사람이 기본 작업비를 손으로 적지 않는다. 세 공수시간을 적으면 금액이 따라
 * 나온다. `repair_labor_settings.base_cost` 칸은 **남아 있지만 이제 계산의 근거가
 * 아니다** — 넘어오기 전의 금액을 되짚을 자리로만 남는다(그 칸의 주석).
 *
 * 🔴 **NULL 인 몫은 합계에 들어가지 않는다.** NULL 은 "그 몫을 아직 정하지
 * 않았다"이고 `0` 은 "그 일이 0시간"이라는 실제 값이다. 정하지 않은 것을 0 으로
 * 접으면 정하지 않았다는 사실이 사라지고 화면이 그것을 알릴 수 없다 — 이 저장소가
 * base_cost · power_test_hours 에서 지켜 온 규칙 그대로다.
 *
 * 🔴 **셋 다 NULL 이면 기본 작업비는 `null`** 이다. `0` 이 아니다. 예전에
 * base_cost 가 NULL 일 때 화면이 "정하지 않았습니다"라고 말하던 그 자리를 그대로
 * 잇는다.
 *
 * ── 세 가지 제외 — 조사 · 통전 · 서류 ───────────────────────────────────
 * 각 몫은 **자기 공수시간 × 시간당 단가**다. 세 셈은 **서로를 보지 않는다.**
 * 제너레이터(조사 21h · 통전 14h · 서류 NULL · 10만원, 기본 350만원)에서:
 *
 *   · 조사작업 제외만 — 조사 몫 210만원을 뺀다 → 고른 작업 + 140만원
 *   · 통전작업 제외만 — 통전 몫 140만원을 뺀다 → 고른 작업 + 210만원
 *   · 둘 다           — 두 몫을 다 뺀다       → 고른 작업만
 *   · 서류작업 제외   — 서류 시간이 NULL 이라 **뺄 금액을 몰라 못 뺀다**
 *
 * 🔴 **뺄 수 없으면 조용히 0 을 빼지 않는다.** 그 갈래의 공수시간을 아직 정하지
 * 않았으면(지금 서류는 세 장비 모두, 통전은 T/C 가 그렇다) 0 을 빼는 대신 **왜 못
 * 뺐는지**를 함께 돌려주고 화면이 그것을 말한다. 조용히 0 을 빼면 합계는 350만원
 * 그대로인데 사람은 210만원이 나온 줄 안다.
 *
 * ── 🔴 사라진 예외들 — 조사 몫이 더 이상 「나머지」가 아니다 ──────────────
 * 2026-09-04 ~ 2026-09-16 에는 조사 몫이 칸이 아니라 **「기본 작업비 − 통전 몫」이라는
 * 나머지**였다. 그래서 다음 세 가지가 이 파일에 있었고, 이제 **전부 없다**:
 *
 *  1. 조사 몫을 셈하려고 통전 몫을 먼저 구하던 얽힘(조사 쪽이 통전 인자를 받았다).
 *     → 이제 셋이 저마다 제 공수시간만 본다. 한 갈래를 고쳐도 다른 갈래가 흔들리지
 *       않고, 서류처럼 몫이 하나 더 생겨도 조사 몫이 그것을 말없이 삼키지 않는다.
 *  2. `NO_BASE_COST`(기본 작업비를 모르면 조사 몫도 모른다).
 *     → 기본 작업비가 **몫들의 합**이므로, 제 공수시간과 단가를 아는 몫은 언제나
 *       뺄 수 있다. 그 둘을 모르면 아래 두 까닭이 이미 말한다.
 *  3. `CLAMPED_TO_ZERO`(뺄 몫이 기본 작업비보다 커서 0 에서 멈췄다).
 *     → 각 몫이 기본 작업비의 **부분**이라 합계를 넘을 수 없다. 공수시간은 DB 가
 *       `> 0`(조사·통전) · `>= 0`(서류)으로 막는다.
 *
 * ── 🔴 뺀 몫은 저장하지 않는다(통전만 빼고) ──────────────────────────────
 * 통전에는 `quotes.labor_power_test_deduction` 스냅숏이 있지만 조사·서류에는 담을
 * 칸이 없다. 나중에 설정(공수시간 · 시간당 단가)이 바뀌면 그 장에서 조사·서류 몫이
 * 얼마였는지 다시 셀 수 없다. 청구 금액은 사람이 적용한 `work_cost` 그대로 남고,
 * 뺀 사실은 `investigation_excluded` · `document_excluded` 가 말한다.
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
 * 기본 작업비를 이루는 **세 몫의 공수시간**과 시간당 단가.
 *
 * 네 값 다 **그때 값**이다 — 화면이 이미 들고 있는 `RepairLaborKindRow` 에서
 * 그대로 온다(queries/repair-labor.ts). 이 함수가 설정 표를 다시 보지 않는다.
 *
 * 🔴 셋 다 **`null` 은 "아직 정하지 않았다"이고 0 이 아니다** — 합계에 들어가지
 * 않고, 그 갈래의 제외도 「뺄 금액을 몰라 못 뺐다」가 된다.
 */
export type BaseLaborHours = {
  /** 그 장비의 시간당 작업비(원). numeric 이라 문자열로 오간다. */
  hourlyRate: string;
  /** 조사작업 공수시간. */
  investigationHours: number | null;
  /** 통전작업 공수시간. T/C 는 아직 모른다. */
  powerTestHours: number | null;
  /** 서류작업 공수시간. 지금 세 장비 모두 NULL 이다. */
  documentHours: number | null;
};

/**
 * 사람이 켠 세 가지 제외. **켠 갈래만 빠진다** — 주지 않거나 꺼 두면 그 갈래는
 * 결과에 키조차 만들지 않는다(아래 `QuoteLaborSuggestion` 의 그 항목).
 */
export type LaborExclusions = {
  /** 「조사작업 제외」 — 조사 몫을 뺀다. */
  investigation?: boolean;
  /** 「통전작업 제외」 — 통전 몫을 뺀다. */
  powerTest?: boolean;
  /** 「서류작업 제외」 — 서류 몫을 뺀다. */
  document?: boolean;
};

/**
 * 제외를 켰는데 그 몫을 빼지 못한 까닭. 화면이 이것으로 문구를 고른다 — 이유 없이
 * 금액만 그대로면 사람은 뺀 줄 안다. **세 갈래가 같은 두 까닭을 쓴다** — 셋이 똑같은
 * 모양의 셈(공수시간 × 단가)이라 못 하는 이유도 같다.
 *
 * · `NO_HOURS`            그 갈래의 공수시간을 아직 정하지 않았다. **0 을 빼지 않는다.**
 * · `UNKNOWN_HOURLY_RATE` 시간당 작업비를 숫자로 읽을 수 없다.
 */
export type LaborShareNotice = "NO_HOURS" | "UNKNOWN_HOURLY_RATE";

export type QuoteLaborSuggestion = {
  /** 제안할 작업비 합계(원). 기본 작업비 + 고른 작업의 합 − 켠 제외들의 몫. */
  total: number;
  /** 그중 고른 작업의 합만. 화면이 내역을 갈라 보여 줄 때 쓴다. */
  tasksTotal: number;
  /**
   * 합계에 더해진 기본 작업비(원) = 정해진 몫들의 합. **셋 다 정하지 않았으면
   * `null` 이고 더하지 않았다** — 화면이 "정하지 않았습니다"라고 말하는 자리다.
   */
  baseCost: number | null;
  /** 시간당 단가나 공수시간을 숫자로 읽지 못해 합계에서 빠진 작업들의 건명. */
  unknown: string[];
  /**
   * 「조사작업 제외」로 **실제로 뺀 조사 몫**(원). `null` 이면 빼지 못했다.
   *
   * 🔴 **부탁하지 않았거나 꺼져 있으면 이 키 자체가 없다**(아래 둘도 같다).
   * "제외를 주지 않으면 지금과 완전히 같은 값"이라는 약속을 글자 그대로 지킨다 —
   * 키를 만들어 `null` 을 담기만 해도 결과 객체를 통째로 비교하는 쪽이 깨진다.
   */
  investigationDeduction?: number | null;
  /** 조사 몫을 못 뺀 까닭. 그대로 뺐으면 `null` 이다. */
  investigationNotice?: LaborShareNotice | null;
  /**
   * 「통전작업 제외」로 **실제로 뺀 통전 몫**(원). `null` 이면 빼지 못했다.
   *
   * 이 값이 그대로 `quotes.labor_power_test_deduction` 스냅샷이 된다 — 나중에
   * 다시 셈하지 않기 위해서다(schema/quotes.ts 의 그 항목).
   */
  powerTestDeduction?: number | null;
  /** 통전 몫을 못 뺀 까닭. 그대로 뺐으면 `null` 이다. */
  powerTestNotice?: LaborShareNotice | null;
  /**
   * 「서류작업 제외」로 **실제로 뺀 서류 몫**(원). `null` 이면 빼지 못했다 —
   * 지금 세 장비 모두 서류 공수시간이 NULL 이라 이 자리가 실제로 쓰인다.
   */
  documentDeduction?: number | null;
  /** 서류 몫을 못 뺀 까닭. 그대로 뺐으면 `null` 이다. */
  documentNotice?: LaborShareNotice | null;
};

/**
 * @param base 그 장비의 세 공수시간과 시간당 단가. **`null` 이면 장비 종류를 아직
 *   고르지 않은 것**이라 기본 작업비가 없고, 어떤 제외도 뺄 금액을 셀 수 없다.
 * @param exclusions 사람이 켠 세 가지 제외. **주지 않으면 기본 작업비를 그대로 더한
 *   결과**가 나오고, 세 쌍의 키는 만들어지지 않는다.
 */
export function sumQuoteLaborCost(
  tasks: readonly SelectedRepairTask[],
  base: BaseLaborHours | null,
  exclusions?: LaborExclusions
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

  // 세 몫을 **저마다 따로** 셈한다. 서로를 보지 않는다 — 이 파일 머리말의 「사라진
  // 예외들」이 그 얽힘을 없앤 자리다.
  // 장비 종류를 안 골랐으면(base 가 null) 시간당 단가도 없다 — 어차피 세 공수시간이
  // 다 null 이라 단가를 보기 전에 답이 난다.
  const hourlyRate = base?.hourlyRate ?? "";
  const investigationShare = resolveShare(base?.investigationHours ?? null, hourlyRate);
  const powerTestShare = resolveShare(base?.powerTestHours ?? null, hourlyRate);
  const documentShare = resolveShare(base?.documentHours ?? null, hourlyRate);

  // 🔴 정해진 몫만 더한다. 하나도 없으면 `null` 이고 0 이 아니다 — 정하지 않았다는
  // 사실이 남아야 화면이 그것을 말한다.
  let addedBase: number | null = null;
  for (const resolved of [investigationShare, powerTestShare, documentShare]) {
    if (resolved.share !== null) addedBase = (addedBase ?? 0) + resolved.share;
  }

  const suggestion: QuoteLaborSuggestion = {
    total: tasksTotal + (addedBase ?? 0),
    tasksTotal,
    baseCost: addedBase,
    unknown,
  };

  // 🔴 부탁하지 않은 차감은 키도 만들지 않는다(위 그 항목). 셋 다 아니면 여기서 끝난다.
  if (!exclusions?.investigation && !exclusions?.powerTest && !exclusions?.document) {
    return suggestion;
  }

  // 기본 작업비 중 남는 몫. 뺀 몫은 **기본 작업비에서만** 나간다 — 고른 작업의 합은 따로
  // 청구하는 일이라 어느 차감에도 걸리지 않는다. 각 몫이 기본 작업비의 부분이므로 셋을
  // 다 빼도 0 이 바닥이다(음수가 될 수 없다 — 머리말의 사라진 `CLAMPED_TO_ZERO`).
  let baseLeft = addedBase;

  if (exclusions.investigation) {
    suggestion.investigationDeduction = investigationShare.share;
    suggestion.investigationNotice = investigationShare.notice;
    if (investigationShare.share !== null && baseLeft !== null) baseLeft -= investigationShare.share;
  }

  if (exclusions.powerTest) {
    suggestion.powerTestDeduction = powerTestShare.share;
    suggestion.powerTestNotice = powerTestShare.notice;
    if (powerTestShare.share !== null && baseLeft !== null) baseLeft -= powerTestShare.share;
  }

  if (exclusions.document) {
    suggestion.documentDeduction = documentShare.share;
    suggestion.documentNotice = documentShare.notice;
    if (documentShare.share !== null && baseLeft !== null) baseLeft -= documentShare.share;
  }

  suggestion.total = tasksTotal + (baseLeft ?? 0);
  return suggestion;
}

/**
 * 한 갈래의 몫 — `그 갈래의 공수시간 × 시간당 작업비`.
 *
 * 🔴 **이 셈은 여기 한 곳이다** — 조사 · 통전 · 서류가 모두 이것을 부른다. 셋이 각자
 * 같은 셈을 적으면 한쪽만 고쳐지는 날 몫들의 합이 기본 작업비와 어긋난다(기본 작업비도
 * 이 함수의 답을 더해 만든다).
 *
 * 둘 중 하나라도 모르면 몫 대신 까닭을 돌려준다 — **0 으로 접지 않는다.**
 */
function resolveShare(
  hours: number | null,
  hourlyRate: string
): { share: number; notice: null } | { share: null; notice: LaborShareNotice } {
  // 🔴 null 은 0 이 아니다. 조용히 0 을 빼면 사람은 210만원이 나온 줄 안다.
  if (hours === null || !Number.isFinite(hours)) return { share: null, notice: "NO_HOURS" };

  // 빈 문자열도 "모른다"이다 — Number("") 는 0 이라 그냥 두면 0원짜리 몫이 된다.
  const rate = hourlyRate.trim() === "" ? Number.NaN : Number(hourlyRate);
  if (!Number.isFinite(rate)) return { share: null, notice: "UNKNOWN_HOURLY_RATE" };

  return { share: hours * rate, notice: null };
}
