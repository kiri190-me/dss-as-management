import {
  FAULT_SYMPTOM_OTHER_LABEL,
  FAULT_SYMPTOM_TOP_SLICE_LIMIT,
  FAULT_SYMPTOM_UNSPECIFIED_LABEL,
  intakeInspectionDetail,
  toIntakeInspectionResultGroups,
  type IntakeInspectionResultGroup,
} from "./fault-symptom-breakdown";
import { buildPieSlices, NO_PIE_DETAIL, type PieSlice } from "./pie-slices";
import { BILLING_TYPE_CODES, billingTypeLabels, type BillingType } from "./types";

/**
 * ============================================================================
 * 제품 모델 상세 · A/S 이력 — 원형 그래프 네 장의 숫자
 * ============================================================================
 * `고장 증상` · `고장 부품` · `End-User` · `유/무상`. 사용자가 단추로 골라 켜고,
 * 켠 것이 아래에 쌓인다. 이 파일은 그중 **숫자**만 만든다 — 조각을 나누는 규칙은
 * pie-slices.ts 가 갖고, 대시보드의 신고 증상 그래프도 같은 것을 쓴다.
 *
 * ── 앞의 셋과 `고장 부품` 은 셈의 성질이 다르다 ─────────────────────────
 * 고장 증상 · End-User · 유/무상은 **접수 건 한 줄이 조각 하나**다. 조각 건수의
 * 합은 언제나 접수 건수와 같다.
 *
 * `고장 부품`은 그렇지 않다. 이 시스템에는 "이 건에서 뭐가 고장났나"를 적는 칸이
 * **없다**. 가장 가까운 것이 수리하며 **요청한 부품**이라 그것을 쓰는데, 그래서
 * 세 가지가 다르다:
 *
 *   1. 한 건에서 부품을 여러 개 요청했을 수 있어 **조각의 합이 접수 건수와 맞지
 *      않는다.** 고장이 아니라 이 그래프의 성질이다. 화면은 원 밑에 그 사실을 한
 *      줄로 적는다 — 그 줄이 없으면 "10건인데 왜 부품이 12개지"에서 사람이 그래프
 *      전체를 안 믿게 된다.
 *   2. **부품 요청 기록이 아예 없는 건이 훨씬 많다.** 그런 건은 조각으로 만들지
 *      않는다 — `미입력` 조각을 만들면 그것이 원의 대부분을 먹어 정작 부품이 보이지
 *      않는다. 대신 `요청 기록이 있는 N건`을 숫자로 적는다.
 *   3. 그래서 이 함수만 접수 건이 아니라 **요청 부품 줄**을 받는다.
 *
 * ── 유/무상만 차례를 못 박고 접지 않는다 ────────────────────────────────
 * 고를 수 있는 값이 넷뿐이라 `기타`가 생기면 요약이 아니라 고장으로 보이고, 조각
 * 차례가 주마다 바뀌면 눈이 매번 다시 읽어야 한다. 차례는 types.ts 의
 * BILLING_TYPE_CODES 를 그대로 따른다 — 손으로 옮겨 적으면 값이 하나 늘었을 때
 * 이 그래프에서만 조용히 빠진다.
 * ============================================================================
 */

/** 값이 비어 있는 건이 모이는 조각의 이름 — End-User · 유/무상이 쓴다. */
export const PRODUCT_MODEL_UNASSIGNED_LABEL = "미지정";

/** 고장 증상은 대시보드와 같은 글자(`미입력`)·같은 상한(8)·같은 기타 이름을 쓴다. */
export const PRODUCT_MODEL_OTHER_LABEL = FAULT_SYMPTOM_OTHER_LABEL;
export const PRODUCT_MODEL_TOP_SLICE_LIMIT = FAULT_SYMPTOM_TOP_SLICE_LIMIT;

/** 유/무상 조각의 고정 차례: 유상 → 일부유상 → 무상 → 추후결정. 미지정은 늘 그 뒤다. */
export const BILLING_SLICE_ORDER: readonly string[] = BILLING_TYPE_CODES.map(
  (code) => billingTypeLabels[code]
);

/**
 * 그래프가 읽는 접수 건 한 조각 — ResolvedRepairCase 전체를 끌어오지 않는다.
 * 좁게 잡아 두어야 시험이 진짜 행을 흉내 내지 않고 필요한 값만 손으로 적는다.
 */
export type ProductModelBreakdownCase = {
  id: string;
  reportedSymptom: string | null;
  intakeInspectionResult: string | null;
  endUserName: string | null;
  billingType: BillingType | null;
};

/**
 * 요청 부품 한 줄 — 조회가 돌려주는 모양이다(db/queries/product-models.ts).
 *
 * 도메인에 두는 이유: 조회 파일은 `server-only` 이라 화면이 그 타입을 import 할 수
 * 없다. 서버와 화면이 같은 모양을 말하려면 타입이 둘 다 닿는 자리에 있어야 한다.
 *
 * **요청 줄 하나가 한 개**다(수량이 아니다). 같은 건에서 같은 부품을 두 번 다른
 * 요청으로 올렸으면 두 줄이고, 그래프에서도 2 로 센다 — "몇 번 요청되었나"가 이
 * 그래프가 답하는 질문이라서다.
 */
export type RequestedPartRow = {
  repairCaseId: string;
  partName: string;
};

/** 고장 증상 조각이 달고 다니는 것 — 그 증상 건들의 인수점검 결과. */
export type IntakeInspectionDetail = {
  /** 건수 많은 순 → 이름 오름차순. 접지 않는다. */
  intakeInspectionResults: IntakeInspectionResultGroup[];
  /** 아직 인수점검 전인 건수. 결과 묶음에 섞지 않는다. */
  intakeInspectionPendingCount: number;
};

export type ProductModelPieBreakdown<TDetail> = {
  /** 이 그래프가 센 총 개수. 조각 건수의 합과 같다. */
  total: number;
  /** 총계가 0 이면 빈 배열이다. 화면은 그때 원 대신 한 줄을 그린다. */
  slices: PieSlice<TDetail>[];
};

/**
 * ① 고장 증상 — 신고 증상(자유 입력)을 글자 그대로 묶는다.
 *
 * 조각마다 그 건들의 인수점검 결과를 달아 둔다. 대시보드의 신고 증상 그래프와
 * **같은 처리기**를 쓴다(intakeInspectionDetail) — 옮겨 적으면 한쪽만 빈 결과를
 * 묶음에 섞는 식으로 갈라진다.
 */
export function buildSymptomBreakdown(
  cases: readonly ProductModelBreakdownCase[]
): ProductModelPieBreakdown<IntakeInspectionDetail> {
  const slices = buildPieSlices(cases, {
    labelOf: (row) => row.reportedSymptom,
    unspecifiedLabel: FAULT_SYMPTOM_UNSPECIFIED_LABEL,
    fold: { topLimit: PRODUCT_MODEL_TOP_SLICE_LIMIT, otherLabel: PRODUCT_MODEL_OTHER_LABEL },
    detail: intakeInspectionDetail,
  });

  return {
    total: cases.length,
    slices: slices.map((slice) => ({
      ...slice,
      detail: {
        intakeInspectionResults: toIntakeInspectionResultGroups(slice.detail),
        intakeInspectionPendingCount: slice.detail.pendingCount,
      },
    })),
  };
}

/**
 * ② End-User — 이름을 글자 그대로 묶는다. 비어 있으면 `미지정`.
 *
 * 조각을 눌러도 펼칠 것이 없어 딸린 값이 없다(NO_PIE_DETAIL).
 */
export function buildEndUserBreakdown(
  cases: readonly ProductModelBreakdownCase[]
): ProductModelPieBreakdown<null> {
  return {
    total: cases.length,
    slices: buildPieSlices(cases, {
      labelOf: (row) => row.endUserName,
      unspecifiedLabel: PRODUCT_MODEL_UNASSIGNED_LABEL,
      fold: { topLimit: PRODUCT_MODEL_TOP_SLICE_LIMIT, otherLabel: PRODUCT_MODEL_OTHER_LABEL },
      detail: NO_PIE_DETAIL,
    }),
  };
}

/**
 * ③ 유/무상 — 이름표는 types.ts 의 billingTypeLabels 를 그대로 쓴다.
 *
 * **접지 않는다**(fold 없음) — 값이 넷뿐이라 기타가 생길 일이 없고, 생기면 오히려
 * 이상하다. 차례는 BILLING_SLICE_ORDER 로 못 박는다. 건수 0 인 값은 조각을 만들지
 * 않는다(buildPieSlices 가 애초에 빈 묶음을 만들지 않는다).
 */
export function buildBillingBreakdown(
  cases: readonly ProductModelBreakdownCase[]
): ProductModelPieBreakdown<null> {
  return {
    total: cases.length,
    slices: buildPieSlices(cases, {
      labelOf: (row) => (row.billingType ? billingTypeLabels[row.billingType] : null),
      unspecifiedLabel: PRODUCT_MODEL_UNASSIGNED_LABEL,
      valueOrder: BILLING_SLICE_ORDER,
      detail: NO_PIE_DETAIL,
    }),
  };
}

export type FaultPartBreakdown = ProductModelPieBreakdown<null> & {
  /**
   * 요청 부품이 붙어 있는 **접수 건 수**. total(부품 개수)과 다를 수 있고, 다른
   * 것이 정상이다 — 화면이 두 숫자를 나란히 적어 그 차이를 먼저 말한다.
   */
  caseWithRequestCount: number;
};

/**
 * ④ 고장 부품 — 요청된 부품 줄을 품명으로 묶는다.
 *
 * **넘겨받는 것이 접수 건이 아니라 요청 부품 줄**이다(파일 헤더의 셋째 차이).
 * 부품 요청이 없는 건은 이 목록에 아예 오지 않으므로 `미입력` 조각이 생기지
 * 않는다 — 그것이 이 그래프에서 부품이 보이는 유일한 길이다.
 *
 * 품명이 공백뿐인 줄만 `미입력`으로 센다. 품명은 NOT NULL 이라 실무에서 거의
 * 없지만, 버리면 조각 합이 부품 개수와 어긋나므로 버리지 않는다.
 */
export function buildFaultPartBreakdown(
  partRows: readonly RequestedPartRow[]
): FaultPartBreakdown {
  return {
    total: partRows.length,
    caseWithRequestCount: new Set(partRows.map((row) => row.repairCaseId)).size,
    slices: buildPieSlices(partRows, {
      labelOf: (row) => row.partName,
      unspecifiedLabel: FAULT_SYMPTOM_UNSPECIFIED_LABEL,
      fold: { topLimit: PRODUCT_MODEL_TOP_SLICE_LIMIT, otherLabel: PRODUCT_MODEL_OTHER_LABEL },
      detail: NO_PIE_DETAIL,
    }),
  };
}
