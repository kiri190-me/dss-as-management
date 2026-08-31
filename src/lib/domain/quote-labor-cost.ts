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

export type QuoteLaborSuggestion = {
  /** 제안할 작업비 합계(원). 기본 작업비 + 고른 작업의 합. */
  total: number;
  /** 그중 고른 작업의 합만. 화면이 내역을 갈라 보여 줄 때 쓴다. */
  tasksTotal: number;
  /** 합계에 더해진 기본 작업비(원). **null 이면 더하지 않았다.** */
  baseCost: number | null;
  /** 시간당 단가나 공수시간을 숫자로 읽지 못해 합계에서 빠진 작업들의 건명. */
  unknown: string[];
};

/**
 * @param baseCost 이 장비 종류의 기본 작업비.
 *   · `null` — 아직 정하지 않았다. **0 으로 접지 않고** 더하지 않는다.
 *   · `"3500000"` — 더한다. `"0"` 은 실제 0원이라 더해도 합계가 그대로다.
 */
export function sumQuoteLaborCost(
  tasks: readonly SelectedRepairTask[],
  baseCost: string | null
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

  return {
    total: tasksTotal + (addedBase ?? 0),
    tasksTotal,
    baseCost: addedBase,
    unknown,
  };
}
