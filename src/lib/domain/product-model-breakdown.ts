import {
  FAULT_SYMPTOM_OTHER_LABEL,
  FAULT_SYMPTOM_TOP_SLICE_LIMIT,
  FAULT_SYMPTOM_UNSPECIFIED_LABEL,
  intakeInspectionDetail,
  toIntakeInspectionResultGroups,
  type FaultSymptomPeriod,
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
 * **없다**. 가장 가까운 것이 **부품 줄**이라 그것을 쓰는데, 그래서 세 가지가 다르다:
 *
 *   1. 한 건에서 부품이 여러 개일 수 있어 **조각의 합이 접수 건수와 맞지
 *      않는다.** 고장이 아니라 이 그래프의 성질이다. 화면은 원 밑에 그 사실을 한
 *      줄로 적는다 — 그 줄이 없으면 "10건인데 왜 부품이 12개지"에서 사람이 그래프
 *      전체를 안 믿게 된다.
 *   2. **부품 기록이 아예 없는 건이 훨씬 많다.** 그런 건은 조각으로 만들지
 *      않는다 — `미입력` 조각을 만들면 그것이 원의 대부분을 먹어 정작 부품이 보이지
 *      않는다. 대신 `부품 기록이 있는 N건`을 숫자로 적는다.
 *   3. 그래서 이 함수만 접수 건이 아니라 **부품 줄**을 받는다.
 *
 * ── 🔴 부품 줄은 **세 군데**에서 온다 (2026-10-29 사용자 요청) ───────────
 * 2026-10-29 전에는 **부품 요청**(`inventory_part_request_items`)뿐이었다. 사용자 말이
 * 「**리페어 리포트에서 읽어들인 것들과 부품요청 한 부품들을 포함해서**」라 둘이 되었고,
 * 같은 날 **반출 확인된 부품**이 셋째로 들어왔다:
 *   · 부품 요청 줄 — 엔지니어가 그 부품을 지목했다(취소·반려는 뺀다).
 *     🔴 **2026-10-16 부터 멈춘 표다** — 그날 이후 올리는 반출 요청은 재고 관리로 가고
 *     이 표에는 한 줄도 안 쌓인다(운영 코드에 `insert` 하는 길이 없다).
 *   · 사용 부품 줄(`repair_case_used_parts`) — 연락서에 그 부품이 적혀 있었다.
 *     🔴 운영에 **1,222줄**이 들어 있고 2026-10-29 전까지 이 그래프에 **한 줄도** 안
 *     들어왔다.
 *   · 반출 확인된 부품(재고 관리의 반출 신청 줄) — **위 구멍을 메우는 입력**이다.
 *     2026-10-16 뒤에 올린 요청은 여기에만 있다.
 * 🔴 **갈아 끼운 것이 아니라 더한 것이다** — 요청 쪽 조회도 취소·반려를 빼는 규칙도
 *    그대로다.
 *
 * ── 🔴 **한 원 안에 자가 둘이다. 알고 고른 것이다** (2026-10-29 사용자 결정) ──
 * 옛 부품 요청 표는 **「요청한 의도」**를 센다 — 반려·취소만 빼고 **대기·보류까지**
 * 포함한다(`db/queries/product-models.ts` 의 `UNCOUNTED_PART_REQUEST_STATUSES`).
 * 반출 확인된 부품은 **「실제로 나간 것」**만 센다 — 줄의 불출 수량(`issued`)이 1 이상인
 * 줄만이고, **상태는 보지 않는다.**
 * 🔴 다음 사람이 「왜 한쪽만 좁은가」로 되돌리지 않게 적어 둔다: 사용자가 **「반출 확인된
 *    부품」**이라고 말했고, 그 말뜻은 「물건이 실제로 나갔다」이다. 두 자를 한쪽으로
 *    맞추는 일(= 옛 표도 좁히거나 반출도 넓히는 일)은 **하지 않기로 했다** — 옛 표는
 *    이미 멈춰서 넓히든 좁히든 새로 들어오는 줄이 없고, 반출 쪽을 넓히면 「신청만 하고
 *    안 나간 부품」이 고장 부품으로 세어진다.
 * 🔵 **수량은 세 입력 모두 안 본다.** `issued` 도 **거르는 데만** 쓰고 수로는 안 쓴다 —
 *    이 그래프의 셈법이 처음부터 「줄 하나가 한 개」다(아래 세 타입 주석이 같은 말을 한다).
 * 🔴 **합치는 일은 이 파일이 하지 않는다.** 두 입력을 「고객사 품명 (품번)」 한 글자로
 *    만들어 섞는 자리는 `domain/product-model-fault-parts.ts` 이고(서버에서 돈다),
 *    여기는 **이미 글자가 된 줄**을 받아 세기만 한다 — 그 글자를 만드는 규칙이 연락서
 *    판독기를 물고 있어 화면 묶음에 들어오면 안 되기 때문이다(그 파일 머리말).
 *
 * ── 유/무상만 차례를 못 박고 접지 않는다 ────────────────────────────────
 * 고를 수 있는 값이 넷뿐이라 `기타`가 생기면 요약이 아니라 고장으로 보이고, 조각
 * 차례가 주마다 바뀌면 눈이 매번 다시 읽어야 한다. 차례는 types.ts 의
 * BILLING_TYPE_CODES 를 그대로 따른다 — 손으로 옮겨 적으면 값이 하나 늘었을 때
 * 이 그래프에서만 조용히 빠진다.
 *
 * ── 🔴 년/월로 좁히는 일은 **거의 다 남의 함수**다 (2026-10-29 사용자 요청) ──
 * 네 그래프 모두 **인수일** 기준으로 걸린다. 그 거르는 자는 대시보드 [신고 증상별
 * 현황]의 것을 **그대로** 쓴다(`domain/fault-symptom-breakdown.ts` 의
 * `selectFaultSymptomPeriodCases` · `listFaultSymptomYears` · `FaultSymptomPeriod`).
 * 이 파일이 따로 가진 것은 **고장 부품 줄을 id 집합으로 거르는 한 함수**뿐이다 — 그
 * 줄에만 날짜 칸이 없기 때문이고, 까닭은 아래 selectProductModelPeriodFaultParts 에 있다.
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
 * 도메인에 두는 이유: 조회 파일은 `server-only` 이라 그 타입을 아무나 import 할 수
 * 없다. 조회와 합치는 자리가 같은 모양을 말하려면 타입이 둘 다 닿는 자리에 있어야 한다.
 *
 * **요청 줄 하나가 한 개**다(수량이 아니다). 같은 건에서 같은 부품을 두 번 다른
 * 요청으로 올렸으면 두 줄이고, 그래프에서도 2 로 센다 — "몇 번 지목되었나"가 이
 * 그래프가 답하는 질문이라서다.
 *
 * 🔴 **품명 말고 세 칸이 더 있는 까닭** (2026-10-29): 이름표를 「고객사 품명 (품번)」으로
 *    만들려면 그 줄의 **품번**을 알아야 하고, 그것이 어느 칸인지는 재고 관리에서 잰 차례가
 *    정한다(`domain/used-part-display.ts` 의 `partIdentityText` — 도번이 먼저다). 🔴 A/S 의
 *    `parts` 표에 **고객사 품명 칸은 없다** — 이름은 재고 관리에서 가져온다.
 */
export type RequestedPartRow = {
  repairCaseId: string;
  partName: string;
  partSpec: string | null;
  kyosanPartNo: string | null;
  drawingNo: string | null;
};

/**
 * 사용 부품 한 줄 — 조회가 돌려주는 모양이다(db/queries/product-models.ts).
 *
 * 🔴 **적혀 있는 글자는 품번이다**(`repair_case_used_parts.part_name_text`). 2026-10-28 에
 *    연락서 이식이 `型式`·`仕様書番号` 칸을 먼저 읽게 바뀌어서다
 *    (`domain/used-part-display.ts` 머리말). 그래서 칸 이름이 `partNameText` 인데 들어
 *    있는 것은 품명이 아니다 — 그 글자를 보여 줄 때만 이름을 앞에 붙인다.
 *
 * **줄 하나가 한 개**다. 위 요청 줄과 같은 셈법이고, `quantity` 는 보지 않는다 — 이
 * 그래프가 묻는 것은 "어느 부품이 몇 번 나왔나"이지 "몇 개가 나갔나"가 아니다.
 */
export type UsedPartRow = {
  repairCaseId: string;
  partNameText: string;
};

/**
 * **반출 확인된 부품** 한 줄 — 재고 관리의 반출 신청 줄에서 온다 (2026-10-29).
 *
 * ── 🔴 A/S DB 에는 이 줄이 없다 ─────────────────────────────────────────
 * 위 둘은 조회가 돌려주는 모양이지만 이것은 **통로로 받아 온 것**이다
 * (`server/product-model-issued-parts.ts` 가 인수번호마다 물어 모은다). A/S 는 재고에
 * 관한 것을 제 표에 하나도 저장하지 않기 때문이다(`server/inventory-gateway.ts` 머리말).
 *
 * ── 🔴 어느 줄이 오는가 — **실제로 나간 줄만** ─────────────────────────
 * 신청 상태(`PENDING`·`PARTIAL`·`CONFIRMED` …)로 거르지 않는다. 줄의 불출 수량
 * (`InventoryStockRequestLine.issued`)이 **1 이상인 줄만** 온다. `PARTIAL`(일부 나감)
 * 신청 안에서도 나간 줄과 안 나간 줄이 섞여 있어, **줄 단위로 보아야** 정확히 갈린다.
 * 🔵 반려·취소된 신청은 나간 것이 없으므로 저절로 빠진다 — 따로 거르지 않는다.
 * 🔴 그 자가 위 요청 줄의 자와 **다르다**. 까닭은 이 파일 머리말의 「한 원 안에 자가
 *    둘이다」 절에 있다.
 *
 * ── 🔴 칸 이름을 옮겨 적은 것이다 ───────────────────────────────────────
 * 저쪽 줄의 `name2` 가 여기 `partSpec`, `name` 이 `partName` 이다(재고 관리의 품명2 ·
 * 품명). 네 칸 이름을 **A/S 쪽 말로 맞춰 두어야** 품번을 고르는 자
 * (`domain/used-part-display.ts` 의 `partIdentityText`)에 그대로 넘길 수 있다 — 합성
 * 규칙을 이 입력만 따로 적지 않으려는 것이다.
 * 🔵 **없는 칸은 빈 글자**다(`null` 이 아니다). 저쪽 파서가 그렇게 눕혀 준다.
 *
 * **줄 하나가 한 개**다. 위 둘과 같은 셈법이고 `issued` 를 수로 쓰지 않는다.
 */
export type IssuedPartRow = {
  repairCaseId: string;
  partName: string;
  partSpec: string;
  kyosanPartNo: string;
  drawingNo: string;
};

/**
 * 그래프가 실제로 세는 줄 — 🔴 **이름표가 이미 만들어져 있다.**
 *
 * 위 **세** 모양이 여기로 모인다(`domain/product-model-fault-parts.ts`). 세 입력의 글자
 * 체계가 다르므로(요청은 A/S 부품 표의 칸들, 사용은 저장된 품번, 반출은 재고 관리 줄의
 * 칸들) **같은 규칙으로 만든 한 글자**로 바꿔 놓아야 같은 부품이 한 조각이 된다.
 *
 * 🔵 `repairCaseId` 가 남아 있는 까닭은 화면이 **부품 기록이 있는 건 수**를 적기 때문이다
 *    (부품 개수와 다른 것이 정상이고, 화면은 둘을 나란히 적는다).
 */
export type FaultPartRow = {
  repairCaseId: string;
  /** 「고객사 품명 (품번)」. 이름을 못 얻었으면 품번 그대로다(그것도 열쇠가 된다). */
  displayName: string;
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

/**
 * ============================================================================
 * 🔴 **못 센 건이 있으면 화면이 그 사실을 말해야 한다** (2026-10-29 사용자 결정)
 * ============================================================================
 * 반출 확인된 부품은 **수리 건마다 재고 관리에 한 번씩 물어** 모은다(모델 단위로 묻는
 * 통로가 없다 — `server/product-model-issued-parts.ts` 머리말). 그래서 세 입력 가운데
 * 이것만 **일부만 받아 오는 일**이 생긴다.
 *
 * 🔴 **조용히 적은 수를 보여 주면 「이 모델은 이 부품이 적게 고장난다」는 틀린 결론**이
 *    나온다. 「못 받아 왔다」와 「없다」를 가르는 것은 이 저장소의 기존 규칙이고
 *    (`domain/inventory-gateway.ts` 의 `InventoryResult.unreachable`), 여기가 그 규칙이
 *    **그래프에 걸리는** 자리다.
 * 🔵 사용 부품 쪽은 같은 규칙을 **일부러 반대로** 다룬다(재고 관리가 멈춰도 이름만 못
 *    붙이고 줄은 전부 선다 — `domain/used-part-display.ts` 머리말 ㉢). 두 자리가 다른
 *    까닭: 거기서 못 받아 오는 것은 **이름**이고 여기서 못 받아 오는 것은 **줄 자체**다.
 * ============================================================================
 */
export type FaultPartIssuedLookup = {
  /** 🔴 물어봤는데 **못 받아 온** 수리 건 수. 그 건의 반출 부품이 그래프에서 빠져 있다. */
  uncountedCaseCount: number;
  /** 🔴 수리 건이 상한을 넘어 **아예 안 물어본** 건 수. 0 이면 상한에 안 걸렸다. */
  skippedCaseCount: number;
  /** 그때의 상한값. 화면이 「몇 건까지인가」를 사람 말로 적을 수 있게 함께 나른다. */
  caseLimit: number;
};

/**
 * 화면 위에 적을 한 줄. 🔴 **셀 것을 다 셌으면 `null`** 이고, 그때 화면은 아무것도 안
 * 그린다(늘 떠 있는 안내는 아무도 안 읽는다).
 *
 * 🔴 **둘이 동시에 서지 않는다** — 상한에 걸리면 한 건도 안 물어보므로 `uncountedCaseCount`
 *    는 0 이다. 그래도 상한 쪽을 먼저 보는 까닭은, 둘 다 0 이 아닌 값이 들어오는 날
 *    (셈이 틀어진 날) **더 큰 사실**인 「아예 안 셌다」가 가려지면 안 되기 때문이다.
 * 🔵 글자가 숫자 파일에 사는 까닭: 이 파일이 이미 조각 이름(`미지정`·`기타`)을 갖고
 *    있고, 수와 문장이 갈라져 살면 「40건」과 「상한 30건」처럼 **서로 어긋난 말**이 뜬다.
 */
export function faultPartIssuedWarning(lookup: FaultPartIssuedLookup | null): string | null {
  if (!lookup) return null;
  if (lookup.skippedCaseCount > 0) {
    return (
      `반출 확인된 부품은 세지 않았습니다 — 이 모델의 수리 건이 ${lookup.skippedCaseCount}건이라 ` +
      `한 번에 물어보는 상한(${lookup.caseLimit}건)을 넘습니다. 아래 수는 그만큼 적습니다.`
    );
  }
  if (lookup.uncountedCaseCount > 0) {
    return (
      `수리 건 ${lookup.uncountedCaseCount}건의 반출 기록을 재고 관리에서 받아오지 못했습니다 — ` +
      `그 건의 반출 부품이 빠져 있어 아래 수가 실제보다 적습니다.`
    );
  }
  return null;
}

export type FaultPartBreakdown = ProductModelPieBreakdown<null> & {
  /**
   * 부품 줄이 하나라도 붙어 있는 **접수 건 수**(요청 · 사용 · 반출을 가리지 않는다).
   * total(부품 개수)과 다를 수 있고, 다른 것이 정상이다 — 화면이 두 숫자를 나란히
   * 적어 그 차이를 먼저 말한다.
   *
   * 🔴 2026-10-29 전에는 이름이 `caseWithRequestCount` 였다. 사용 부품이 들어오면서
   *    **요청만 세는 수가 아니게 되어** 이름을 바꿨다 — 그대로 두면 다음 사람이 그
   *    이름을 믿고 "요청이 있는 건 수"로 읽는다.
   */
  caseWithPartRecordCount: number;
};

/**
 * ④ 고장 부품 — 부품 줄을 **이름표 글자 그대로** 묶는다.
 *
 * **넘겨받는 것이 접수 건이 아니라 부품 줄**이다(파일 헤더의 셋째 차이). 부품 줄이
 * 없는 건은 이 목록에 아예 오지 않으므로 `미입력` 조각이 생기지 않는다 — 그것이 이
 * 그래프에서 부품이 보이는 유일한 길이다.
 *
 * 🔴 **이름표를 여기서 만들지 않는다**(파일 헤더). 받은 글자로 묶을 뿐이라, 같은
 *    부품이 한 조각이 되는지는 그 글자를 만든 자리가 정한다.
 *
 * 이름표가 공백뿐인 줄만 `미입력`으로 센다. 실무에서 거의 없지만, 버리면 조각 합이
 * 부품 개수와 어긋나므로 버리지 않는다.
 */
export function buildFaultPartBreakdown(partRows: readonly FaultPartRow[]): FaultPartBreakdown {
  return {
    total: partRows.length,
    caseWithPartRecordCount: new Set(partRows.map((row) => row.repairCaseId)).size,
    slices: buildPieSlices(partRows, {
      labelOf: (row) => row.displayName,
      unspecifiedLabel: FAULT_SYMPTOM_UNSPECIFIED_LABEL,
      fold: { topLimit: PRODUCT_MODEL_TOP_SLICE_LIMIT, otherLabel: PRODUCT_MODEL_OTHER_LABEL },
      detail: NO_PIE_DETAIL,
    }),
  };
}

/**
 * ============================================================================
 * 🔴 **년/월로 좁힐 때 고장 부품만 길이 다르다** (2026-10-29 사용자 요청)
 * ============================================================================
 * 사용자 말: 「[제품 모델 상세]에 있는 [A/S 이력]에서 **[대시보드]의 [신고 증상별
 * 현황]처럼** 년/월을 선택해서 확인할 수 있도록 해줘.」 그래서 **거르는 자를 새로 짓지
 * 않는다** — 대시보드가 쓰는 `selectFaultSymptomPeriodCases`
 * (`domain/fault-symptom-breakdown.ts`)를 그대로 가져다 쓴다. 그 함수가 제네릭이라
 * `receivedAt` 칸만 있으면 어떤 배열이든 받는다. 🔴 같은 말을 두 벌로 적으면 한쪽만
 * 고쳐지는 날이 온다 — 이 저장소에서 실제로 겪은 일이다.
 *
 * 그런데 네 그래프 가운데 **고장 부품만 입력 모양이 다르다**:
 *   · 앞의 셋(고장 증상·End-User·유/무상)은 **접수 건 줄**이라 인수일이 그 줄에 있다 →
 *     위 함수에 그대로 넘기면 걸린다.
 *   · 🔴 **고장 부품 줄에는 날짜 칸이 아예 없다**(FaultPartRow — 요청·사용·반출 셋 다).
 *     세 입력이 각기 다른 표에서 오고 그쪽 날짜의 뜻도 서로 다르다(요청일 · 연락서에
 *     적힌 날 · 반출일). 그중 하나를 인수일인 척 쓰면 **네 그래프의 잣대가 갈린다**.
 * 🔵 대신 그 줄에 `repairCaseId` 가 남아 있다(화면이 「부품 기록이 있는 건 수」를 세려고
 *    남겨 둔 칸이다). 그래서 **그 기간에 인수된 건들의 id 집합**으로 거른다 — 네 그래프가
 *    같은 잣대(인수일)로 걸리는 유일한 길이고, 🔴 **새 조회가 한 번도 필요 없다**
 *    (화면이 접수 건 배열과 부품 줄 배열을 이미 둘 다 쥐고 있다).
 * ============================================================================
 */
export function selectProductModelPeriodFaultParts<T extends { repairCaseId: string }>(
  partRows: readonly T[],
  period: FaultSymptomPeriod,
  periodCases: readonly { id: string }[]
): T[] {
  // 🔴 **전체 기간이면 한 줄도 거르지 않는다.** 여기서도 id 집합을 타면, 접수 건 목록에
  // 없는 건의 부품 줄이 **기간을 고르기도 전에** 사라진다. 2026-10-29 실측으로는 그런
  // 줄이 없지만(부품 조회 셋이 전부 접수 건 목록과 같거나 더 좁게 걸러 온다 —
  // `db/queries/product-models.ts` 의 두 조회는 `products.is_deleted = false` 를 하나 더
  // 걸고, 반출 줄은 그 접수 건 목록 자체에서 만든다), 그것은 **조회가 바뀌면 같이 바뀌는
  // 사실**이라 기대어 두지 않는다.
  // 🔵 「전체면 한 건도 걸러지지 않는다」는 selectFaultSymptomPeriodCases 와 같은 규칙이다.
  if (period.year === null) return partRows.slice();

  const caseIds = new Set(periodCases.map((row) => row.id));
  return partRows.filter((row) => caseIds.has(row.repairCaseId));
}
