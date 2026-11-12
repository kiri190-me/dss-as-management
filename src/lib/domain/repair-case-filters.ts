import {
  BILLING_TYPE_CODES,
  PRIORITY_CODES,
  PRODUCT_CATEGORY_OPTIONS,
  REPAIR_STATUS_CODES,
  type BillingType,
  type Customer,
  type Priority,
  type RepairStatus,
} from "./types";
import type { EffectiveRepairCase } from "./local/workflow/effective-repair-case";
import { FINAL_SHIPMENT_APPROVED_FILTER_VALUE } from "./final-shipment-approval-badge";
import { reportedSymptomFromSearchParams } from "./reported-symptom-param";
import { resolveRepairCaseRequestedDueDate } from "./requested-due-date-link";

/**
 * ── 워크플로 유형 대신 제품군 + 유·무상 ─────────────────────────────────
 * 예전에는 workflowType 하나로 걸렀다. 그런데 그 값은 제품군과 유·무상을
 * 붙여 놓은 것이라("유상 Generator"), 제품군만 보고 싶은 사람도 유·무상별로
 * 두 번 골라야 했고 반대도 마찬가지였다. 게다가 유·무상은 migration 0021로
 * workflowType과 무관한 독립 컬럼이 되었으므로(types.ts의 BILLING_TYPE_CODES
 * 주석) 둘을 한 값으로 묶어 두는 것 자체가 더는 맞지 않는다.
 *
 * 그래서 둘로 나눴다. 표현력은 오히려 늘었다 — 예전의 "유상 Generator"는
 * 제품군 Generator + 유상으로 그대로 되고, 예전에는 못 하던 "유상인 것 전부"와
 * "Generator 전부"가 새로 된다. workflowType으로 들어오는 딥링크는 대시보드를
 * 포함해 한 군데도 없어서(2026-08-19 확인) 끊어질 링크도 없다.
 */

/**
 * 유·무상 필터가 고를 수 있는 값 — 실제 코드 넷에 **미지정**이 하나 더 붙는다.
 *
 * 🔴 "NONE" 은 DB 에 저장되는 코드가 아니다. billing_type 이 null 인 건(표에
 *    "-" 로 나오는 그것)을 가리키는 **필터 전용 값**이다. BILLING_TYPE_CODES 에
 *    끼워 넣지 않는 까닭이 그것이다 — 그 배열은 접수·수정 화면이 저장할 값을
 *    뽑아 쓰는 자리라, 거기 섞이면 "미지정"이 실제로 저장될 길이 열린다.
 */
export type BillingTypeFilterValue = BillingType | "NONE";

/**
 * [현재 상태] 필터가 고를 수 있는 값 — 실제 상태 **열둘**에
 * **[최종 출하 승인 완료]** 하나가 더 붙는다(2026-11-12 사용자 요구).
 *
 * 🔴 바로 위 유·무상과 **같은 꼴**이다. 더한 값은 상태 코드가 아니라 **필터 전용
 *    값**이고, REPAIR_STATUS_CODES 에 끼워 넣지 않는 까닭도 같다(그 배열은 저장할
 *    값을 뽑아 쓰는 자리다 — final-shipment-approval-badge.ts 의 그 상수 주석).
 *
 * 🔴 다만 "NONE"(미지정)과 **판정 근거가 다르다.** 미지정은 행의 칸(billingType)이
 *    null 인가로 가려지지만, 최종 출하 승인은 **이 건의 칸이 아니다** — 다른 표의
 *    최신 결재 행과 이 건의 판 번호로 나오는 파생값이라, 서버가 계산해 내려준 접수
 *    건 id 묶음과 대조해야 한다(아래 applyFilters 의 다섯째 인자).
 */
export type RepairStatusFilterValue =
  | RepairStatus
  | typeof FINAL_SHIPMENT_APPROVED_FILTER_VALUE;

export type Filters = {
  query: string;
  /**
   * 보고 싶은 상태들. **여러 개를 한꺼번에** 고를 수 있다(2026-11-11 사용자
   * 개선요청 — 그 전에는 한 번에 하나였다).
   *
   * 🔴 **빈 배열이 「전체」다.** "ALL" 같은 값은 두지 않는다 — 두면 "ALL" 이
   *    들어 있는 배열이라는 뜻 없는 상태가 생기고, 거르는 쪽이 그것을 매번
   *    따로 가려내야 한다. 길이가 0 인가만 보면 끝나는 쪽이 틀릴 자리가 적다.
   *
   * 🔴 「입고품 전체」(예전의 "IN_HOUSE")도 **여기 저장되는 값이 아니다.**
   *    화면의 단축 단추와 주소줄 별칭이 그것을 **출하 완료를 뺀 상태들로 펼쳐**
   *    넣는다(아래 IN_HOUSE_STATUSES). 그래서 사람이 거기서 하나를 빼거나 더할
   *    수 있고, 이 배열에는 늘 진짜 상태 코드만 들어 있다 — DB 의 상태 enum 에
   *    없는 값이 저장·전이·표의 상태 칸으로 샐 길이 처음부터 없다.
   *
   * 🔴 **[최종 출하 승인 완료]만은 이 배열에 그대로 담긴다**(2026-11-12). 「입고품
   *    전체」처럼 펼쳐 넣을 상태가 없기 때문이다 — 어느 상태에서도 승인이 나 있을
   *    수 있어서(배지가 붙는 상태가 따로 정해져 있지 않다) 상태들로 바꿔 쓸 수
   *    없다. 유·무상의 "NONE" 과 같은 자리이고, 여럿 고르기의 규칙도 그대로다:
   *    다른 상태와 함께 고르면 **OR** 다(「수리 완료 **이거나** 최종 출하 승인 완료」).
   */
  statuses: readonly RepairStatusFilterValue[];
  /**
   * 보고 싶은 제품군들. **여럿 고를 수 있다**(2026-11-11 사용자 개선요청 — 그
   * 전에는 `"ALL" | string` 하나였다). 위 statuses 와 같은 규칙이다: **빈 배열이
   * 「전체」**고, 고른 것이 있으면 그 제품군들의 합집합만 남는다.
   *
   * 🔴 견주는 대상은 코드가 아니라 **productCategoryLabels가 만든 표시 문구**
   *    ("Generator" 등)다 — 제품군은 아직 DB 칸이 아니라 workflowType 에서
   *    파생시킨 글자이기 때문이다(types.ts 의 PRODUCT_CATEGORY_OPTIONS 주석).
   *    복수 선택이 되었다고 견주는 대상을 코드로 바꾸면, 선택지(그 글자)와
   *    맞을 줄이 하나도 없어 목록이 조용히 빈다.
   */
  productCategories: readonly string[];
  /**
   * 보고 싶은 유·무상들. 빈 배열이 「전체」다.
   *
   * 🔴 **"NONE"(미지정)은 거르는 방식이 아니라 배열의 원소**다. 「입고품 전체」
   *    (statuses 의 IN_HOUSE)와는 다르다 — 그쪽은 상태들로 펼쳐 넣는 단축이라
   *    저장되지 않지만, 미지정은 **표에 "-" 로 나오는 실제로 고를 수 있는 한 줄**
   *    이고 billing_type 이 null 인 건을 가리킨다. 그래서 다른 값과 **함께** 고를
   *    수 있어야 한다("유상과 미지정" 같은 조합이 실제 쓰임이다).
   */
  billingTypes: readonly BillingTypeFilterValue[];
  /**
   * 보고 싶은 고객사 id 들. 빈 배열이 「전체」다.
   *
   * 선택지는 지금 화면에 올라와 있는 접수 건에서 뽑으므로(아래
   * collectCustomerFilterOptions) 주소줄로 들어온 id 가 선택지에 없을 수 있다.
   * 그래도 **버리지 않는다** — 걸린 조건이 화면에서 사라지면 사람이 풀 수 없다
   * (체크박스 칸의 orderSelection 이 모르는 값을 뒤에 그대로 둔다).
   */
  customerIds: readonly string[];
  /** 보고 싶은 우선순위들. 빈 배열이 「전체」다. */
  priorities: readonly Priority[];
  overdueOnly: boolean;
  /** "YYYY-MM" 형식. 유효하지 않으면 null로 취급한다. */
  shipmentMonth: string | null;
  /**
   * 내게 결재 요청이 들어온 건만 보기. 다른 조건과 달리 **행 자체에는 판정
   * 근거가 없다** — "내게 온 결재 요청"은 워크플로 전이의 승인 요건 + 아직
   * 결정되지 않은 결재 요청 기록 + 로그인한 사용자의 결재 권한으로 서버가
   * 계산하는 값이라(queries/repair-case-approvals-pending.ts), 화면은 서버가
   * 내려준 접수 건 id 집합과 대조만 한다. 그 집합이 없으면(mock 모드 등) 이
   * 조건은 아무것도 남기지 않는다 — 근거 없이 전부 통과시키면 "내게 온 결재
   * 요청"이라는 이름이 거짓이 된다.
   */
  myPendingApprovalOnly: boolean;
  /**
   * 장기 PO 미발행 건만 보기 — 견적서를 낸 지 두 달이 지나도록 발주가 나지
   * 않은 건이다(domain/long-pending-po.ts 가 규칙의 유일한 자리).
   *
   * myPendingApprovalOnly 와 같은 종류의 조건이다: **행 자체에는 판정 근거가
   * 없다.** 견적일·발주일은 접수 건이 아니라 그 건에 붙은 내자 줄(여럿일 수
   * 있다)에 있고, "오늘"도 서버가 정하는 한국 날짜라(화면이 new Date() 로
   * 만들면 서버가 그린 것과 어긋난다) 화면은 서버가 내려준 접수 건 id 집합과
   * 대조만 한다. 그 집합이 없으면(mock 모드 등) 이 조건은 아무것도 남기지
   * 않는다 — 근거 없이 전부 통과시키면 필터 이름이 거짓이 된다.
   */
  longPendingPoOnly: boolean;
  /**
   * 신고 증상 하나로 좁히기. null 이면 걸지 않는다.
   *
   * 다른 조건과 달리 **고르는 칸이 없다.** 신고 증상은 자유 입력 칸이라 고를
   * 수 있는 목록이 없고, 이 조건은 대시보드 「신고 증상별 현황」에서 인수점검
   * 결과 줄을 눌러 들어올 때만 걸린다(`/repair-cases?reportedSymptom=...`).
   * 그래서 화면은 <select> 대신 **걸려 있다는 안내 한 줄과 해제 단추**를 둔다 —
   * 거른 채로 아무 표시가 없으면 사람이 "건이 왜 이것밖에 없지" 한다.
   *
   * 값은 앞뒤 공백을 걷어낸 원문이다(reported-symptom-param.ts). 세는 쪽
   * (fault-symptom-breakdown.ts)이 증상을 묶을 때 쓰는 규칙과 같아야 대시보드가
   * 센 건수와 이 목록의 건수가 맞는다.
   */
  reportedSymptom: string | null;
};

/**
 * 「입고품 전체」가 넣는 상태들 — **출하 완료만 뺀 전부.**
 *
 * 🔴 목록을 손으로 적지 않는다. REPAIR_STATUS_CODES 에서 걸러 내므로 상태가
 *    하나 늘면 저절로 따라온다. 적어 두는 방식이면 상태가 느는 날 그 건들이
 *    아무 소리 없이 「입고품 전체」에서 빠지고, 오류는 한 번도 안 난다.
 *
 * 🔴 이 잣대는 대시보드 [현재 입고 수](domain/dashboard-metrics.ts 의
 *    currentIntakeCount — 그쪽도 effectiveStatus 로 SHIPMENT_COMPLETED 만
 *    뺀다)와 **같아야 한다.** 그 카드를 눌러 들어오는 자리이기 때문이다
 *    (DashboardContent 의 href = `/repair-cases?status=IN_HOUSE`). 둘이
 *    갈라지면 카드에 적힌 수와 목록의 건수가 달라지는데 오류는 안 난다 —
 *    같은 표본에 두 함수를 돌려 맞대어 보는 것이
 *    in-house-filter-matches-dashboard.test.ts 다.
 */
export const IN_HOUSE_STATUSES: readonly RepairStatus[] = REPAIR_STATUS_CODES.filter(
  (status) => status !== "SHIPMENT_COMPLETED"
);

/**
 * 주소줄에서 「입고품 전체」를 가리키는 별칭.
 *
 * 상태 목록에 없는 값이라 거르는 쪽까지 들어가지는 않고, 주소를 읽는 자리에서
 * 바로 IN_HOUSE_STATUSES 로 펼쳐진다. 대시보드 카드의 href 가 이 값을 그대로
 * 쓰고 있어 **계속 받아야 한다** — 카드 쪽 주소를 고치면 즐겨찾기·메일에 남은
 * 옛 링크가 조용히 「전체」로 열린다.
 */
const IN_HOUSE_STATUS_ALIAS = "IN_HOUSE";

/**
 * 주소줄에서 값 여럿을 잇는 글자: `?status=WAITING_PO,IN_REPAIR`
 *
 * 상태뿐 아니라 제품군·유·무상·고객사·우선순위가 **전부 같은 글자**를 쓴다
 * (2026-11-11 복수 선택). 필터마다 다른 글자를 쓰면 주소를 손으로 적는 사람이
 * 매번 확인해야 한다.
 */
const LIST_PARAM_SEPARATOR = ",";

/**
 * `?제품군=A,B` 꼴의 한 줄을 값 배열로. 상태 쪽(parseStatusesParam)과 **같은 결**
 * 이다 — 앞뒤 공백을 걷어내고, 같은 값이 두 번 와도 한 번만 넣고, **모르는 값은
 * 조용히 버린다.** 하나도 안 남으면 빈 배열, 곧 「전체」다.
 *
 * 상태 쪽과 합치지 않은 까닭은 그쪽에만 있는 것이 하나 있어서다: 「입고품 전체」
 * 별칭을 상태 열하나로 **펼치는** 일. 그 특수한 한 줄을 이 일반 함수에 끌어들이면
 * 다른 네 필터가 쓰지도 않는 갈래를 업고 다니게 된다.
 *
 * `isKnown` 은 **아는 값인가**를 판정한다. 고객사처럼 미리 정해진 목록이 없는
 * 필터는 "비어 있지 않으면 안다"가 된다(선택지가 지금 화면의 줄에서 뽑히므로,
 * 목록에 없는 id 라고 버리면 걸린 조건이 화면에서 사라진다).
 */
function parseListParam<T extends string>(
  raw: string | null,
  isKnown: (token: string) => boolean
): T[] {
  if (!raw) return [];

  const picked: T[] = [];
  for (const piece of raw.split(LIST_PARAM_SEPARATOR)) {
    const token = piece.trim();
    if (!token || !isKnown(token)) continue;
    if (!picked.includes(token as T)) picked.push(token as T);
  }

  return picked;
}

/**
 * `?status=` 한 줄을 상태 배열로.
 *
 * 🔴 **모르는 값은 조용히 버린다.** 주소줄은 사람이 손으로 고칠 수 있으므로
 *    엉뚱한 값에 화면이 깨지거나 목록이 통째로 비면 안 된다. 아는 값만 남기고
 *    하나도 안 남으면 빈 배열 — 곧 「전체」다.
 */
function parseStatusesParam(raw: string | null): RepairStatusFilterValue[] {
  if (!raw) return [];

  // 🔴 [최종 출하 승인 완료]도 **아는 값**이다(2026-11-12). 유·무상의 "NONE" 과
  //    같은 결이다 — 거르개에서 고를 수 있는 한 줄이면 주소줄로도 걸 수 있어야
  //    같은 화면을 링크로 건넬 수 있다. 「입고품 전체」 별칭처럼 펼쳐지지 않고
  //    값 그대로 들어간다(위 statuses 주석).
  const knownCodes = new Set<string>([
    ...REPAIR_STATUS_CODES,
    FINAL_SHIPMENT_APPROVED_FILTER_VALUE,
  ]);
  const picked: RepairStatusFilterValue[] = [];
  const add = (status: RepairStatusFilterValue) => {
    if (!picked.includes(status)) picked.push(status);
  };

  for (const piece of raw.split(LIST_PARAM_SEPARATOR)) {
    const token = piece.trim();
    if (!token) continue;
    if (token === IN_HOUSE_STATUS_ALIAS) {
      for (const status of IN_HOUSE_STATUSES) add(status);
      continue;
    }
    if (knownCodes.has(token)) add(token as RepairStatusFilterValue);
  }

  return picked;
}

export const DEFAULT_FILTERS: Filters = {
  query: "",
  statuses: [],
  productCategories: [],
  billingTypes: [],
  customerIds: [],
  priorities: [],
  overdueOnly: false,
  shipmentMonth: null,
  myPendingApprovalOnly: false,
  longPendingPoOnly: false,
  reportedSymptom: null,
};

const SHIPMENT_MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export function isValidShipmentMonth(value: string | null | undefined): value is string {
  return typeof value === "string" && SHIPMENT_MONTH_PATTERN.test(value);
}

export function formatShipmentMonthLabel(month: string): string {
  const [year, monthPart] = month.split("-");
  return `${year}년 ${Number(monthPart)}월`;
}

/**
 * URLSearchParams로부터 초기 필터 상태를 만든다. 값이 허용된 코드 목록과
 * 일치하지 않으면 안전하게 기본값(빈 배열/false/null)으로 무시한다 —
 * 서명 없는 쿼리스트링을 그대로 신뢰하지 않는다.
 *
 * 읽는 파라미터는 **아홉**이다(2026-11-11 실측):
 *   status · productCategory · billingType · customerId · priority — 복수 선택이
 *   되면서 전부 **쉼표로 여럿** 받는다(`?priority=HIGH,NORMAL`). 이름은 그대로
 *   단수다: 대시보드·사이드바·즐겨찾기·메일에 남은 옛 링크가 전부 이 이름으로
 *   오고, 값이 하나면 길이 1 짜리 배열이 되어 **전과 똑같이** 동작한다.
 *   overdue · shipmentMonth · myApproval · longPendingPo — 전과 같다.
 * 여기에 reportedSymptom 하나가 더 있는데, 그것만은 이 함수가 직접 읽지 않고
 * reported-symptom-param.ts 에 통째로 맡긴다(아래 주석).
 */
export function parseInitialFilters(searchParams: URLSearchParams): Filters {
  const status = searchParams.get("status");
  const productCategory = searchParams.get("productCategory");
  const billingType = searchParams.get("billingType");
  const customerId = searchParams.get("customerId");
  const priority = searchParams.get("priority");
  const overdue = searchParams.get("overdue");
  const shipmentMonth = searchParams.get("shipmentMonth");
  // 사이드바 배지가 거는 딥링크(/repair-cases?myApproval=1)가 들어오는 자리다.
  const myApproval = searchParams.get("myApproval");
  const longPendingPo = searchParams.get("longPendingPo");

  return {
    query: "",
    // 쉼표로 여럿 받는다(`?status=WAITING_PO,IN_REPAIR`). 대시보드 [현재 입고 수]
    // 카드가 거는 딥링크(?status=IN_HOUSE)도 이 자리를 지나 상태 열하나로 펼쳐진다
    // — 모르는 값은 조용히 버려지고, 하나도 안 남으면 빈 배열(= 전체)이다.
    statuses: parseStatusesParam(status),
    // 아래 넷도 쉼표로 여럿 받는다(`?priority=HIGH,NORMAL`). 모르는 값은 조용히
    // 버리고 하나도 안 남으면 빈 배열(= 전체)이다 — 주소줄은 사람이 손으로 고칠
    // 수 있어서, 엉뚱한 값에 목록이 통째로 비면 안 된다.
    productCategories: parseListParam(productCategory, (token) =>
      PRODUCT_CATEGORY_OPTIONS.includes(token)
    ),
    // 🔴 "NONE"(미지정)도 그냥 받는다 — 거르는 방식이 아니라 고를 수 있는 한 줄이다.
    billingTypes: parseListParam<BillingTypeFilterValue>(
      billingType,
      (token) => token === "NONE" || (BILLING_TYPE_CODES as readonly string[]).includes(token)
    ),
    // 🔴 고객사만 **아는 값인지 따지지 않는다.** 선택지가 지금 화면에 올라온
    //    줄에서 뽑히므로(collectCustomerFilterOptions) 미리 맞대 볼 목록이 없다.
    //    전에도 `customerId ?? "ALL"` 로 그대로 받았다 — 그 결을 그대로 둔다.
    customerIds: parseListParam(customerId, (token) => token.length > 0),
    priorities: parseListParam<Priority>(priority, (token) =>
      (PRIORITY_CODES as readonly string[]).includes(token)
    ),
    overdueOnly: overdue === "1" || overdue === "true",
    shipmentMonth: isValidShipmentMonth(shipmentMonth) ? shipmentMonth : null,
    myPendingApprovalOnly: myApproval === "1" || myApproval === "true",
    longPendingPoOnly: longPendingPo === "1" || longPendingPo === "true",
    // 대시보드 「신고 증상별 현황」에서 누르고 들어오는 딥링크가 이 자리다.
    // 🔴 판정을 여기 옮겨 적지 않는다 — 링크를 **짓는** 쪽과 같은 문을 지나야
    // "링크는 만들어졌는데 눌러 보면 안 걸리는" 어긋남이 생기지 않는다.
    // 읽을 수 없는 값은 null 이 되어 **아무것도 거르지 않는다**(오류가 아니다).
    reportedSymptom: reportedSymptomFromSearchParams(searchParams),
  };
}

function matchesQuery(row: EffectiveRepairCase, query: string): boolean {
  const haystack = [
    row.intakeNumber,
    row.customerName,
    row.endUserName,
    row.modelName,
    row.serialNumber,
    row.lotNumber,
    row.engineerName,
  ]
    .filter((value): value is string => Boolean(value))
    .join(" ")
    .toLowerCase();
  return haystack.includes(query);
}

function matchesShipmentMonth(row: EffectiveRepairCase, month: string): boolean {
  if (row.effectiveStatus !== "SHIPMENT_COMPLETED" || !row.effectiveActualShipmentDate) {
    return false;
  }
  return row.effectiveActualShipmentDate.slice(0, 7) === month;
}

/**
 * Stage E-1부터는 원본 status/isOverdue/actualShipmentDate가 아니라
 * effectiveStatus/effectiveIsOverdue/effectiveActualShipmentDate로 필터링한다
 * — 워크플로 재정의가 있으면 그 결과가, 없으면 원본과 동일한 값이 반영된다.
 */
export function applyFilters(
  rows: EffectiveRepairCase[],
  filters: Filters,
  /**
   * 서버가 계산해 내려준 "내게 결재 요청이 들어온" 접수 건 id 집합
   * (queries/repair-case-approvals-pending.ts). 없으면 undefined —
   * myPendingApprovalOnly가 켜져 있어도 아무 행도 남기지 않는다.
   */
  myPendingApprovalCaseIds?: ReadonlySet<string>,
  /**
   * 서버가 계산해 내려준 "장기 PO 미발행" 접수 건 id 집합
   * (queries/long-pending-po.ts). 없으면 undefined —
   * longPendingPoOnly가 켜져 있어도 아무 행도 남기지 않는다.
   */
  longPendingPoCaseIds?: ReadonlySet<string>,
  /**
   * 서버가 계산해 내려준 "최종 출하 승인이 완료된" 접수 건 id 집합
   * (queries/repair-case-approvals.ts + domain/final-shipment-approval-badge.ts 의
   * isFinalShipmentApproved — 목록 표의 [최종 출하 승인 완료] 배지가 쓰는 **바로 그
   * 묶음**이다. 고른 줄과 배지가 붙은 줄은 늘 같아야 한다).
   *
   * 🔴 **없으면(undefined) [최종 출하 승인 완료]는 아무 줄도 더하지 않는다.** 위 두
   *    묶음(내게 온 결재 요청 · 장기 PO 미발행)이 근거 없이 전부 통과시키지 않는
   *    것과 같은 판단이다 — 근거가 없는데 통과시키면 **배지가 하나도 없는 줄들이
   *    「최종 출하 승인 완료」로 걸러져 나온다.** 승인이 끝났다고 읽고 출하로 넘기는
   *    사람이 생기는 쪽이, 목록이 비는 쪽보다 훨씬 위험하다.
   *
   * 🔵 그러면서 **전부 숨기지는 않는다.** 이 값은 여럿 고르기의 한 줄이라, 다른 상태와
   *    함께 골랐으면 그 상태의 줄은 그대로 남는다(OR 중 한쪽이 0건이 될 뿐이다).
   *
   * 🔵 운영에서 undefined 가 되는 길은 없다 — 목록 페이지가 **권한을 묻지 않고 늘**
   *    계산해 내려준다(app/(app)/repair-cases/page.tsx). 빈 묶음이 오는 길(= 승인된
   *    건이 한 건도 없다)과 mock 모드만 남는데, 둘 다 「해당 없음」이 사실이다.
   */
  finalShipmentApprovedCaseIds?: ReadonlySet<string>
): EffectiveRepairCase[] {
  const query = filters.query.trim().toLowerCase();

  // 🔴 고른 상태는 **줄마다** 견주는 값이라 여기서 한 번만 펼쳐 둔다. 목록이 수백
  //    줄이고 고른 값이 열셋까지 가므로, 줄마다 includes() 를 부르면 그 곱만큼 돈다.
  //    (나머지 네 필터는 전과 그대로 두었다 — 이번에 손댄 자리만 고친다.)
  const pickedStatuses = new Set<RepairStatusFilterValue>(filters.statuses);
  const wantsFinalShipmentApproved = pickedStatuses.has(FINAL_SHIPMENT_APPROVED_FILTER_VALUE);
  // 🔴 [최종 출하 승인 완료]는 상태 칸과 맞댈 값이 아니므로 **상태 묶음에서 덜어낸다.**
  //    남겨 두어도 지금은 아무 상태와도 같아지지 않지만, 그것은 「상태 코드와 겹치지
  //    않는다」는 다른 파일의 약속에 기댄 안전이다 — 여기서 갈라 두면 기대지 않는다.
  pickedStatuses.delete(FINAL_SHIPMENT_APPROVED_FILTER_VALUE);

  return rows.filter((row) => {
    if (filters.myPendingApprovalOnly && !myPendingApprovalCaseIds?.has(row.id)) return false;
    if (filters.longPendingPoOnly && !longPendingPoCaseIds?.has(row.id)) return false;
    // 아무것도 안 고르면 전부 지나간다(빈 배열 = 전체). 고른 것이 있으면 그
    // 상태들의 **합집합**만 남는다.
    // 🔴 원본 status 가 아니라 effectiveStatus 다 — 워크플로 재정의가 있으면 두
    //    칸이 갈리고, 표에 보이는 상태도 대시보드가 세는 것도 effective 쪽이다.
    //    여기서 원본 칸을 보면 화면에 「수리 중」이라 적힌 줄이 「수리 중」으로
    //    걸러도 안 나오는데, 오류는 한 번도 안 난다.
    //
    // 🔴 고른 것 가운데 **[최종 출하 승인 완료]만 판정 근거가 행에 없다**(2026-11-12).
    //    그래서 그 한 줄은 상태 칸이 아니라 서버가 내려준 id 묶음과 대조하고, 상태와는
    //    **OR** 로 잇는다 — 「수리 완료 **이거나** 최종 출하 승인 완료」가 사람이
    //    여럿 고를 때 기대하는 뜻이고, 다른 다섯 필터끼리는 전처럼 AND 로 겹친다.
    if (filters.statuses.length > 0) {
      const matchesStatus = pickedStatuses.has(row.effectiveStatus);
      const matchesFinalShipmentApproved =
        wantsFinalShipmentApproved && finalShipmentApprovedCaseIds?.has(row.id) === true;
      if (!matchesStatus && !matchesFinalShipmentApproved) return false;
    }
    // 아래 넷도 상태와 같은 규칙이다(2026-11-11 복수 선택): 빈 배열이면 전부
    // 지나가고, 고른 것이 있으면 그 값들의 **합집합**만 남는다. 조건끼리는 전처럼
    // AND 로 겹친다 — 제품군 둘과 우선순위 하나를 고르면 "그 두 제품군 중 하나
    // **이면서** 그 우선순위인" 줄이다.
    //
    // 🔴 견주는 대상은 전과 한 글자도 다르지 않다. 제품군은 표시 문구
    //    (productCategoryLabels 가 만든 "Generator" 등)와 견주고, 고객사는 id 와
    //    견준다. 복수 선택을 핑계로 여기를 코드/이름으로 바꾸면 선택지와 맞을 줄이
    //    없어 목록이 조용히 빈다.
    if (filters.productCategories.length > 0 && !filters.productCategories.includes(row.productCategory)) {
      return false;
    }
    // 유·무상이 안 정해진 건(billingType === null)은 "미지정"을 고를 때만 남는다.
    // 어느 한쪽으로 추측해 넣지 않는다 — 표에도 "-"로 그대로 적는 값이다.
    // 🔴 null 을 "NONE" 으로 **바꿔 놓고 한 번만 견준다.** 미지정을 따로 떼어
    //    판정하면 "유상과 미지정을 함께" 고른 조합에서 둘 중 하나가 서로를
    //    잡아먹는다(먼저 쓴 줄이 이긴다) — 그 조합이 실제 쓰임이다.
    if (filters.billingTypes.length > 0 && !filters.billingTypes.includes(row.billingType ?? "NONE")) {
      return false;
    }
    if (filters.customerIds.length > 0 && !filters.customerIds.includes(row.customerId)) return false;
    if (filters.priorities.length > 0 && !filters.priorities.includes(row.priority)) return false;
    if (filters.overdueOnly && !row.effectiveIsOverdue) return false;
    // 앞뒤 공백을 걷어내고 글자 그대로 견준다 — 대시보드가 증상을 묶을 때 쓰는
    // 규칙과 같다(fault-symptom-breakdown.ts). 증상이 비어 있는 행은 어떤 값과도
    // 같아지지 않으므로, 이 조건이 걸린 채로는 '미입력' 건이 남지 않는다.
    if (
      filters.reportedSymptom !== null &&
      (row.reportedSymptom?.trim() ?? "") !== filters.reportedSymptom
    ) {
      return false;
    }
    if (filters.shipmentMonth && !matchesShipmentMonth(row, filters.shipmentMonth)) return false;
    if (query && !matchesQuery(row, query)) return false;
    return true;
  });
}

/**
 * 고객사 필터의 선택지를 **지금 이 화면에 올라와 있는 접수 건에서** 뽑는다.
 *
 * 예전에는 mock-data.ts의 mockCustomers(데모 7곳)를 그대로 넘겼다. 실제 DB에는
 * 고객사가 그보다 훨씬 많아서, 목록에는 멀쩡히 보이는 접수 건의 고객사를 필터에서는
 * 고를 수 없었다. 목록과 별개인 고객사 명단을 들고 있는 한 언젠가는 다시 어긋난다 —
 * 그래서 내 담당 제품 화면(my-active-work-filter.ts의 collectMyWorkFilterOptions)과
 * 같은 결로, 목록 자체에서 뽑아 "목록에 있으면 필터에도 있다"를 구조로 보장한다.
 *
 * 넘길 배열은 **필터를 걸기 전의 전체 목록**이어야 한다. 거른 뒤(또는 페이지를 나눈
 * 뒤)의 배열에서 뽑으면 고객사를 하나 고르는 순간 나머지가 선택지에서 사라져
 * 되돌아갈 수 없고, 검색어를 함께 걸면 지금 골라 둔 고객사마저 사라진다. 전체
 * 목록에서 뽑으면 선택지가 필터 상태와 무관해지므로 그 두 문제가 아예 생기지 않는다.
 *
 * 반환 타입이 Customer인 것은 RepairCaseFilters의 customers prop에 맞춘 것이다.
 * 접수 건 행에는 고객사 연락처가 없으므로(행의 contact*는 그 **접수 건**의 연락
 * 담당자이지 고객사 마스터가 아니다) 연락처 세 칸은 빈 문자열로 둔다 — 필터 칸은
 * id와 name만 읽는다(2026-11-11 복수 선택이 되면서 <select> 가 체크박스 드롭다운이
 * 되었지만 읽는 두 칸은 그대로다). 여기서 나온 객체를 연락처 용도로 쓰면 안 된다.
 *
 * 빈 값 규칙:
 * - customerId가 비어 있는 행은 건너뛴다. 값이 빈 선택지는 "고르지 않음"과
 *   구분되지 않고, applyFilters가 맞출 값도 되지 못한다. 타입상으로는
 *   customerId가 반드시 있는 string이지만, 이 함수는 화면에 실제로 떠 있는 값을
 *   그대로 받으므로 방어한다.
 * - 이름이 비어 있으면 id를 대신 적는다. 그 행을 버리지 않는 이유는, 그 고객사의
 *   접수 건이 목록에는 그대로 보이기 때문이다 — 필터에서만 빠지면 방금 고친 이
 *   고장(목록 ≠ 필터)이 그대로 되풀이된다. 이름 없는 한 줄이라도 있어야 고르고
 *   되돌릴 수 있다.
 */
export function collectCustomerFilterOptions(rows: EffectiveRepairCase[]): Customer[] {
  const nameById = new Map<string, string>();

  for (const row of rows) {
    const id = row.customerId.trim();
    if (!id) continue;
    const name = row.customerName.trim();
    // 같은 고객사가 여러 행에 나오면 이름이 적혀 있는 쪽을 남긴다.
    if (name) nameById.set(id, name);
    else if (!nameById.has(id)) nameById.set(id, id);
  }

  return [...nameById.entries()]
    .map(([id, name]) => ({ id, name, contactName: "", contactEmail: "", contactPhone: "" }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export type SortColumn =
  | "intakeNumber"
  | "receivedAt"
  | "customerName"
  | "status"
  | "priority"
  /**
   * 출하일(2026-10-19 요구). 이름은 **원본 칸 이름**(actualShipmentDate)이고
   * 비교하는 값은 **재정의가 반영된** effectiveActualShipmentDate 다 — 바로 위
   * "status" 와 똑같은 결이다(그쪽도 이름은 status, 비교는 effectiveStatus).
   * 나머지 넷은 effective 짝이 없는 칸이라 이름이 곧 비교 대상이다.
   */
  | "actualShipmentDate"
  | "customerRequestedDueDate";

export type SortDirection = "asc" | "desc";

export type SortState = {
  column: SortColumn;
  direction: SortDirection;
};

function compareNullableString(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return -1;
  if (b === null) return 1;
  return a.localeCompare(b);
}

/**
 * 이 줄의 「고객 요청 납기일」 칸에 **화면이 실제로 그리는 날짜**.
 *
 * 🔴 원본 칸(customerRequestedDueDate)이 아니다. 그 칸이 비면 표는 연결된 내자
 * 정리의 납기요청일 중 가장 이른 하루를 빌려 그리므로(components/repair-cases/
 * RequestedDueDateValue.tsx), 정렬이 원본 칸을 보면 **보이는 날짜와 줄 서는
 * 차례가 다른** 더 나쁜 결함이 된다 — 바로 아래 출하일 정렬이 널을 사내 목표
 * 출하일로 끼워 넣지 않기로 한 것과 같은 결의 판단이다.
 *
 * 규칙은 여기서 새로 적지 않고 화면이 쓰는 그 함수를 그대로 부른다. 넘기는 것도
 * **그 함수가 보는 두 칸뿐**이다 — 행을 통째로 넘기면 언젠가 다른 날짜 칸이
 * 섞여 들어온다(requested-due-date-link.ts 의 같은 경고).
 */
function visibleRequestedDueDate(row: EffectiveRepairCase): string | null {
  return resolveRepairCaseRequestedDueDate({
    customerRequestedDueDate: row.customerRequestedDueDate,
    domesticOrderDueDates: row.domesticOrderDueDates,
  }).dueDate;
}

export function sortRows(rows: EffectiveRepairCase[], sort: SortState): EffectiveRepairCase[] {
  const sorted = [...rows].sort((a, b) => {
    switch (sort.column) {
      case "intakeNumber":
        return a.intakeNumber.localeCompare(b.intakeNumber);
      case "receivedAt":
        return a.receivedAt.localeCompare(b.receivedAt);
      case "customerName":
        return a.customerName.localeCompare(b.customerName);
      case "status":
        return REPAIR_STATUS_CODES.indexOf(a.effectiveStatus) - REPAIR_STATUS_CODES.indexOf(b.effectiveStatus);
      case "priority":
        return PRIORITY_CODES.indexOf(a.priority) - PRIORITY_CODES.indexOf(b.priority);
      case "actualShipmentDate":
        // 🔴 널을 internalTargetShipmentDate(사내 목표 완료일)로 대신 채우지 않는다.
        // 표는 아직 출하 안 된 건을 "-"로 그리는데(RepairCaseTable 의 출하일 셀),
        // 정렬에서만 목표 완료일을 끼워 넣으면 "-"인 줄이 날짜가 있는 줄 사이에
        // 끼어 선다. 널 자리는 바로 아래 고객 요청 납기일과 **같은 함수**가 정한다
        // — 한 머리글 칸에 포개 놓은 두 차례가 서로 다르게 굴면 안 된다.
        return compareNullableString(a.effectiveActualShipmentDate, b.effectiveActualShipmentDate);
      case "customerRequestedDueDate":
        // 🔴 보이는 날짜로 세운다(위 visibleRequestedDueDate) — 자기 칸이 빈 건은
        // 내자에서 빌려 온 날짜 자리에 선다. 널 자리는 위 출하일과 **같은 함수**다.
        return compareNullableString(visibleRequestedDueDate(a), visibleRequestedDueDate(b));
      default:
        return 0;
    }
  });

  return sort.direction === "asc" ? sorted : sorted.reverse();
}

export type PaginationState = {
  page: number;
  pageSize: number;
};

export function paginate<T>(rows: T[], pagination: PaginationState): T[] {
  const start = (pagination.page - 1) * pagination.pageSize;
  return rows.slice(start, start + pagination.pageSize);
}
