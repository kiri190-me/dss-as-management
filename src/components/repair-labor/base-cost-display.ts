import { sumQuoteLaborCost, type BaseLaborHours } from "@/lib/domain/quote-labor-cost";
import {
  REPAIR_LABOR_SCOPES,
  repairLaborScopeLabels,
  type RepairLaborScope,
} from "@/lib/validation/repair-task-input";

/**
 * ============================================================================
 * 기본 작업비를 화면에 뭐라고 쓸 것인가
 * ============================================================================
 * `기본 작업비 = 조사 몫 + 통전 몫 + 서류 몫`, 각 몫은 `그 갈래 공수시간 × 시간당
 * 단가`다(2026-09-16 사용자 결정).
 *
 * ── 🔴 셈을 여기서 새로 짜지 않는다 ─────────────────────────────────────
 * 금액은 전부 `domain/quote-labor-cost.ts` 의 `sumQuoteLaborCost()` 가 낸다. 설정
 * 화면과 견적서가 각자 셈을 적으면 **한쪽만 고쳐지는 날 두 화면이 다른 금액을
 * 말한다** — 사람이 여기서 350만원을 보고 견적서에서 다른 값을 받는 것이 최악이다.
 *
 * 세 몫을 따로 얻으려고 **세 가지 제외를 다 켜서 부른다.** 그 함수는 켠 갈래의 몫을
 * `…Deduction` 에, 못 센 까닭을 `…Notice` 에 담아 주므로, 그것이 곧 「그 갈래의
 * 몫」이다. 제외를 켠 결과의 `total` 은 여기서 쓰지 않는다 — 우리가 알고 싶은 것은
 * 뺀 값이 아니라 **각 몫이 얼마인가**이기 때문이다.
 *
 * ── 🔴 정하지 않은 몫은 합계에 들어가지 않는다 ──────────────────────────
 * `null` 은 "아직 정하지 않았다"이고 `0` 은 "그 일이 0시간"이라는 실제 값이다
 * (서류는 실제로 0 을 받는다 — schema/repair-labor.ts). 셋 다 정하지 않았으면
 * 합계는 `0 원` 이 아니라 **"아직 정하지 않았습니다"** 이고, 하나라도 비어 있으면
 * 화면이 **어느 갈래가 비었는지 이름을 대고 말한다.** 조용히 접으면 사람은 합계가
 * 다 들어간 값인 줄 안다.
 * ============================================================================
 */

const AMOUNT_FORMAT = new Intl.NumberFormat("ko-KR");

/** 금액 한 덩이를 사람이 읽는 모양으로. 화면의 다른 금액과 같은 모양이다. */
function formatWon(amount: number): string {
  return `₩${AMOUNT_FORMAT.format(Math.round(amount))}`;
}

export type LaborShareLine = {
  scope: RepairLaborScope;
  /** 그 갈래의 몫(원). **`null` 이면 셀 수 없었다**(0원이 아니다). */
  amount: number | null;
  /** 화면에 그대로 나가는 한 줄. */
  text: string;
};

export type BaseCostDisplay = {
  /** 세 몫의 합(원). **셋 다 정하지 않았으면 `null`** 이고 `0` 이 아니다. */
  amount: number | null;
  /** 합계 자리에 그대로 나가는 글. */
  amountText: string;
  /** 갈래 셋의 줄. 차례는 조사 → 통전 → 서류다. */
  shares: LaborShareLine[];
  /**
   * 합계에 못 들어간 갈래를 이름 대고 말하는 한 줄. 셋 다 들어갔으면 `null` 이다.
   * 🔴 이 줄이 없으면 사람은 합계가 세 몫을 다 담은 값인 줄 안다.
   */
  unsetNote: string | null;
};

/**
 * @param base 그 장비의 세 공수시간과 시간당 단가. **화면이 지금 들고 있는 값**이다 —
 *   사람이 칸을 고치는 대로 이 셈이 따라 움직인다.
 */
export function describeBaseCost(base: BaseLaborHours): BaseCostDisplay {
  // 세 몫을 한 번에 얻는다(위 머리말). 제외를 켜는 것이 곧 "그 몫을 말해 달라"이다.
  const suggestion = sumQuoteLaborCost([], base, {
    investigation: true,
    powerTest: true,
    document: true,
  });

  const shareOf: Record<RepairLaborScope, { amount: number | null; noRate: boolean }> = {
    INVESTIGATION: {
      amount: suggestion.investigationDeduction ?? null,
      noRate: suggestion.investigationNotice === "UNKNOWN_HOURLY_RATE",
    },
    POWER_TEST: {
      amount: suggestion.powerTestDeduction ?? null,
      noRate: suggestion.powerTestNotice === "UNKNOWN_HOURLY_RATE",
    },
    DOCUMENT: {
      amount: suggestion.documentDeduction ?? null,
      noRate: suggestion.documentNotice === "UNKNOWN_HOURLY_RATE",
    },
  };
  const hoursOf: Record<RepairLaborScope, number | null> = {
    INVESTIGATION: base.investigationHours,
    POWER_TEST: base.powerTestHours,
    DOCUMENT: base.documentHours,
  };

  const shares: LaborShareLine[] = REPAIR_LABOR_SCOPES.map((scope) => {
    const label = repairLaborScopeLabels[scope];
    const { amount, noRate } = shareOf[scope];
    const hours = hoursOf[scope];
    if (amount !== null) return { scope, amount, text: `${label} ${hours}시간 → ${formatWon(amount)}` };
    // 🔴 못 센 까닭을 갈라 말한다. "정하지 않았다"와 "단가를 못 읽는다"는 사람이 할
    // 일이 다르다 — 앞은 이 탭의 칸을, 뒤는 `수리 작업 비용` 탭의 단가를 채워야 한다.
    if (noRate) return { scope, amount: null, text: `${label} ${hours}시간 → 시간당 작업비를 읽을 수 없습니다` };
    return { scope, amount: null, text: `${label} — 공수시간을 정하지 않았습니다` };
  });

  const unset = shares.filter((share) => share.amount === null);
  return {
    amount: suggestion.baseCost,
    amountText:
      suggestion.baseCost === null
        ? // 🔴 `₩0` 이 아니다 — "무상"과 "모른다"는 다른 말이다.
          "아직 정하지 않았습니다"
        : formatWon(suggestion.baseCost),
    shares,
    unsetNote:
      unset.length === 0
        ? null
        : `${unset.map((share) => repairLaborScopeLabels[share.scope]).join(" · ")} 몫은 아직 셀 수 없어 위 금액에 들어 있지 않습니다.`,
  };
}
