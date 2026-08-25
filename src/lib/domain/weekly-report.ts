import { isLongPendingPo } from "./long-pending-po";
import type { RepairStatus, WorkflowType } from "./types";

/**
 * ============================================================================
 * 주간보고 — 무엇을 어느 칸에 넣을지 정하는 곳
 * ============================================================================
 * 매주 손으로 만들던 엑셀 현황판(`(DSS)주간 보고 현황판`)을 화면으로 옮긴 것이다.
 * **조회 전용**이고, 이 파일에는 DB 도 React 도 들어오지 않는다 —
 * domestic-order-list.ts 와 같은 자리의 파일이고, 같은 이유로 순수 함수만 둔다:
 * "이 건이 왜 점검 중으로 세어졌는가"는 **규칙**이지 그리기가 아니라서, 화면
 * 안에 두면 그 규칙을 시험할 방법이 브라우저를 띄우는 것밖에 남지 않는다.
 *
 * ── 종류는 두 가지로 접는다 ─────────────────────────────────────────────
 * 엑셀에는 왼쪽 RFG · 오른쪽 MB 두 줄뿐이다. 시스템의 워크플로 종류는 셋
 * (Generator · Total Controller · Matcher)이므로 하나를 접어야 하고,
 * **Total Controller 를 RFG 로 접기로 사용자가 정했다**(엑셀에 Total Controller
 * 칸이 아예 없다). 이 판단을 여기 적어 두는 이유는, 나중에 이 화면을 보는 사람이
 * "Total Controller 는 어디 갔나"를 코드에서 바로 답할 수 있어야 하기 때문이다.
 *
 * ── 집계는 6칸이다. PO 발행 완료는 그 위에 겹친다 ───────────────────────
 * 원본 엑셀의 집계는 8칸으로 보이지만, 그중 **서로 겹치지 않는 상태는 여섯**이고
 * 그 여섯의 합이 총 대수다. 원본의 숫자가 그것을 증명한다 — ICD(MB) 는
 * `수리대기 1 + PO대기중 5 + 출하대기 1 = 7` 이 총 대수와 같고, 같은 블록의
 * `PO 발행 완료 1` 은 그 합에 들어 있지 않다. 그 한 대(D260602)는 **현 상태가
 * 출하 대기인데 PO 발행 일시가 찍혀 있는** 건이다. 원본 엑셀의 `RFG 총합` 블록에
 * PO 발행 완료 칸이 아예 없는 것도 같은 이유다 — 그것은 상태 칸이 아니다.
 * (화면은 총합에도 그 칸을 그린다 — 사용자가 넣기로 정했다. 그린다고 셈이 바뀌는
 * 것은 아니라서, 여기서는 여전히 겹쳐 세고 총 대수에 더하지 않는다.)
 *
 * 그래서 상태는 여섯으로만 가르고, **PO 발행 완료는 겹쳐 세는 값**으로 따로 둔다:
 * 어느 칸에 놓인 건이든 그 접수 건에 발주발행일이 있으면 세어진다. **총 대수에는
 * 더하지 않는다.**
 *
 * ── 여섯 칸도 상태 하나로는 갈리지 않는다 ───────────────────────────────
 * 점검 대기 / 점검 중 은 둘 다 WAITING_INTAKE_INSPECTION 이고 **인수점검 기록이
 * 남았는가**로 갈린다. 그래서 이 파일의 입력에는 상태 말고 점검 기록 유무가 함께
 * 온다.
 *
 * WAITING_PO 는 **워크플로 단계와 무관하게 전부 PO 대기 중**이다. 예전에는
 * waiting_po / po_received 두 단계 키로 'PO 대기 중'과 'PO 발행 완료'를 갈랐는데,
 * 그것은 PO 발행 완료를 상태 칸으로 오해한 데서 나온 규칙이라 없앴다.
 *
 * ── 어느 칸에도 안 맞는 건은 조용히 사라지지 않는다 ─────────────────────
 * 분류 함수는 모르는 조합에 기본값을 지어내지 않고 null 을 돌려주며, 집계는 그
 * 건들을 **분류 안 됨**으로 따로 센다. 총 대수는 6칸 + 분류 안 됨이므로, 새
 * 상태가 늘어 어느 칸에도 안 들어가는 건이 생겨도 총 대수와 6칸의 합이 어긋나는
 * 것으로 화면에 드러난다. 조용히 빠지면 "지난주보다 3대가 줄었다"가 사실인지
 * 고장인지 아무도 알 수 없다.
 *
 * ── 출하 완료는 아예 나오지 않는다 ──────────────────────────────────────
 * 이 보고서는 **진행 중인 것**만 본다. 그래서 출하 완료 건은 분류 안 됨으로도
 * 세지 않고 목록에서 통째로 빠진다 — 위의 '조용히 사라지지 않는다'와 모순이
 * 아니다: 저쪽은 "규칙이 모르는 건", 이쪽은 "규칙이 알고 있는, 뺀다고 정한 건"이다.
 *
 * ── 장기 PO 미발행은 여기서 판정하고, 화면은 색만 입힌다 ─────────────────
 * 상세표의 `견적서 발행일` 을 빨간 볼드로 그리는 줄이 그것이다. 규칙을 여기
 * 옮겨 적지 않고 **long-pending-po.ts 의 isLongPendingPo 를 그대로 부른다** —
 * `전체 A/S 현황` 의 `장기 PO 미발행만 보기` 체크박스와 **같은 함수**라야 두
 * 화면이 같은 건을 가리킨다. 따로 적으면 언젠가 어긋나고, 그때 어느 쪽이
 * 맞는지 말할 수 없다.
 *
 * 그 파일이 이 파일을 부르고(pickWeeklyReportOrderDates · isExcludedFrom…) 이
 * 파일이 다시 그 파일을 부르므로 **import 가 순환한다.** 안전한 순환이다:
 * 양쪽 모두 모듈이 평가되는 동안에는 서로를 부르지 않고(둘 다 hoisting 되는
 * function 선언이며, 최상위에서 실행되는 것은 상수뿐이다) 실제 호출은 전부
 * 함수가 불릴 때 일어난다.
 *
 * ── "오늘"은 부르는 쪽이 정한다 ─────────────────────────────────────────
 * buildWeeklyReport 가 `now` 를 **받는다**. 여기서 new Date() 를 부르면 (1) 서버가
 * 그린 화면과 클라이언트가 다시 그린 화면이 어긋나고, (2) 시험 결과가 실제
 * 오늘 날짜에 따라 달라져 두 달 뒤에 아무 고친 것 없이 깨진다. page.tsx 가
 * 머리말의 '갱신 일' 과 **같은 순간**을 넘긴다.
 * ============================================================================
 */

/** 엑셀의 왼쪽 줄 / 오른쪽 줄. */
export const WEEKLY_REPORT_KINDS = ["RFG", "MB"] as const;
export type WeeklyReportKind = (typeof WEEKLY_REPORT_KINDS)[number];

/** 블록 제목 옆에 그대로 나가는 설명 — 어떤 제품이 이 줄에 묶였는지. */
export const weeklyReportKindDescriptions: Record<WeeklyReportKind, string> = {
  RFG: "Generator · Total Controller",
  MB: "Matcher",
};

/**
 * 워크플로 종류 → 엑셀의 두 줄.
 *
 * Record 로 적은 것은 일부러다 — 새 워크플로 종류가 WORKFLOW_TYPE_CODES 에
 * 늘어나면 이 표가 컴파일되지 않아, 어느 줄로 접을지 정하지 않은 채 화면이
 * 나가는 일이 없다.
 *
 * Total Controller 세 줄이 RFG 인 근거는 파일 헤더에 있다(엑셀에 그 칸이 없어
 * 사용자가 RFG 로 접기로 정했다).
 */
const KIND_BY_WORKFLOW_TYPE: Record<WorkflowType, WeeklyReportKind> = {
  PAID_MATCHER: "MB",
  WARRANTY_MATCHER: "MB",
  PENDING_MATCHER: "MB",
  PAID_GENERATOR: "RFG",
  WARRANTY_GENERATOR: "RFG",
  PENDING_GENERATOR: "RFG",
  PAID_TOTAL_CONTROLLER: "RFG",
  WARRANTY_TOTAL_CONTROLLER: "RFG",
  PENDING_TOTAL_CONTROLLER: "RFG",
};

export function foldWeeklyReportKind(workflowType: WorkflowType): WeeklyReportKind {
  return KIND_BY_WORKFLOW_TYPE[workflowType];
}

/**
 * 서로 겹치지 않는 상태 6칸. **이 여섯의 합이 총 대수다.**
 *
 * PO 발행 완료는 여기 없다 — 상태가 아니라 그 위에 겹쳐 세는 값이다(파일 헤더).
 * 총 대수도 여기 없다 — 세어서 나오는 값이다.
 */
export const WEEKLY_REPORT_STATUSES = [
  "INSPECTION_WAITING",
  "INSPECTION_IN_PROGRESS",
  "REPAIR_WAITING",
  "IN_REPAIR",
  "PO_WAITING",
  "SHIPMENT_WAITING",
] as const;
export type WeeklyReportStatus = (typeof WEEKLY_REPORT_STATUSES)[number];

/** 엑셀에 적혀 있던 말 그대로. 화면과 시험이 같은 글자를 쓴다. */
export const weeklyReportStatusLabels: Record<WeeklyReportStatus, string> = {
  INSPECTION_WAITING: "점검 대기",
  INSPECTION_IN_PROGRESS: "점검 중",
  REPAIR_WAITING: "수리 대기",
  IN_REPAIR: "수리 중",
  PO_WAITING: "PO 대기 중",
  SHIPMENT_WAITING: "출하 대기",
};

/**
 * 겹쳐 세는 값의 이름. 상태 목록에 없으므로 라벨 표에도 없고, 화면과 시험이
 * 같은 글자를 쓰도록 여기 따로 둔다.
 */
export const WEEKLY_REPORT_PO_ISSUED_LABEL = "PO 발행 완료";

/** 총 대수 칸의 이름. 위와 같은 이유로 여기 둔다. */
export const WEEKLY_REPORT_TOTAL_LABEL = "총 대수";

/** 분류가 받는 접수 건 한 조각 — 전체 행 타입을 끌어오지 않는다. */
export type WeeklyReportClassifiable = {
  /**
   * 평탄화된 상태. **null 을 허용한다** — workflow_steps.repair_status 는 아직
   * nullable 이라(그 스키마 주석) 값이 없는 단계에 놓인 건이 있을 수 있다.
   * 그런 건은 상태를 지어내지 않고 '분류 안 됨'으로 드러낸다.
   */
  status: RepairStatus | null;
  /**
   * 지금 놓인 워크플로 단계의 key.
   *
   * **분류는 이 값을 보지 않는다.** 예전에는 여기서 waiting_po / po_received 를
   * 갈라 'PO 대기 중'과 'PO 발행 완료'를 나눴는데, PO 발행 완료가 상태 칸이
   * 아니라는 것이 드러나 그 갈림길을 없앴다(파일 헤더). 값을 그대로 실어 오는
   * 이유는 둘이다: 분류 안 된 건이 **어느 단계에 앉아 있는지**가 그 건을 찾는
   * 단서이고, 시험이 "두 PO 단계가 모두 한 칸으로 간다"를 이 값으로 못 박는다.
   */
  currentWorkflowStepKey: string;
  /** 이 건에 인수점검 결과 기록(record_kind = INTAKE_INSPECTION_RESULT)이 하나라도 있는가. */
  hasIntakeInspectionRecord: boolean;
};

/**
 * 이 건이 보고서에서 빠지는가. 출하 완료는 **진행 중이 아니므로** 아예 나오지
 * 않는다(파일 헤더).
 *
 * 분류 함수와 따로 둔 이유: 분류가 null 을 돌려주는 것은 "규칙이 모른다"는
 * 뜻이고 화면에 드러나야 하는 반면, 이쪽은 "빼기로 정했다"는 뜻이라 드러날
 * 것이 없다. 한 함수에 섞으면 그 둘이 같은 값으로 합쳐져 구분할 수 없게 된다.
 */
export function isExcludedFromWeeklyReport(row: { status: RepairStatus | null }): boolean {
  return row.status === "SHIPMENT_COMPLETED";
}

/**
 * 접수 건 하나를 6칸 중 하나로 가른다. 어느 칸에도 안 맞으면 null 이다 —
 * 기본값을 지어내지 않는다(파일 헤더).
 *
 * 매핑표(승인된 그대로):
 *   점검 대기      WAITING_INTAKE_INSPECTION 이고 점검 기록 없음
 *   점검 중        WAITING_INTAKE_INSPECTION 이고 점검 기록 있음 + WAITING_KYOSAN_REPLY 전부
 *   수리 대기      WAITING_PARTS_SUPPLY
 *   수리 중        IN_REPAIR
 *   PO 대기 중     WAITING_PO 전부 (단계 키를 보지 않는다)
 *   출하 대기      WAITING_SHIPMENT + WAITING_SHIPMENT_APPROVAL
 *
 * PO 발행 완료는 이 표에 없다 — 상태가 아니라 발주발행일로 갈리는, 겹쳐 세는
 * 값이다(hasWeeklyReportPoIssued).
 */
export function classifyWeeklyReportStatus(
  row: WeeklyReportClassifiable
): WeeklyReportStatus | null {
  switch (row.status) {
    case "WAITING_INTAKE_INSPECTION":
      // 점검 기록이 하나라도 남았으면 점검이 시작된 것이다. 상태는 아직
      // 인수점검 단계에 머물러 있어도, 사람이 보는 사실은 '점검 중'이다.
      return row.hasIntakeInspectionRecord ? "INSPECTION_IN_PROGRESS" : "INSPECTION_WAITING";
    case "WAITING_KYOSAN_REPLY":
      // 교산 회신을 기다리는 동안에도 그 장비는 점검대에 올라가 있다.
      return "INSPECTION_IN_PROGRESS";
    case "WAITING_PARTS_SUPPLY":
      return "REPAIR_WAITING";
    case "IN_REPAIR":
      return "IN_REPAIR";
    case "WAITING_PO":
      // 단계 키를 보지 않는다 — waiting_po 든 po_received 든 아직 PO 를
      // 기다리는 자리이고, PO 가 실제로 났는지는 발주발행일이 답한다.
      return "PO_WAITING";
    case "WAITING_SHIPMENT":
    case "WAITING_SHIPMENT_APPROVAL":
      return "SHIPMENT_WAITING";
    default:
      // SHIPMENT_COMPLETED 는 여기까지 오지 않는다(위 isExcludedFromWeeklyReport
      // 가 먼저 걸러 낸다). null 과 앞으로 늘어날 상태가 이 자리로 온다.
      return null;
  }
}

/** 집계 6칸 + 겹쳐 세는 PO 발행 완료 + 분류 안 됨 + 총 대수. */
export type WeeklyReportCounts = {
  byStatus: Record<WeeklyReportStatus, number>;
  /**
   * **겹쳐 세는 값이다.** 6칸 어디에 놓인 건이든 발주발행일이 있으면 세어지고,
   * 총 대수에는 더하지 않는다(파일 헤더). 원본의 D260602 처럼 '출하 대기이면서
   * PO 발행 완료'인 건이 실제로 있다.
   */
  poIssued: number;
  /**
   * 어느 칸에도 안 맞는 건. 0 이 아니면 화면이 그 사실을 그대로 보여 준다 —
   * 감추면 총 대수만 늘어난 채 이유를 알 수 없는 표가 된다.
   */
  unclassified: number;
  /** 총 대수 = 6칸의 합 + 분류 안 됨. 분류 안 된 건이 없으면 6칸의 합과 같다. */
  total: number;
};

function emptyCounts(): WeeklyReportCounts {
  const byStatus = {} as Record<WeeklyReportStatus, number>;
  for (const status of WEEKLY_REPORT_STATUSES) byStatus[status] = 0;
  return { byStatus, poIssued: 0, unclassified: 0, total: 0 };
}

/** 6칸의 합. 총 대수와 다르면 분류 안 된 건이 있다는 뜻이다. */
export function sumWeeklyReportStatusCounts(counts: WeeklyReportCounts): number {
  return WEEKLY_REPORT_STATUSES.reduce((acc, status) => acc + counts.byStatus[status], 0);
}

/** 그 접수 건에 연결된 내자 줄에서 따라오는 두 날짜. 연결이 없으면 둘 다 null 이다. */
export type WeeklyReportOrderDates = {
  /** domestic_orders.quote_issued_date — 상세표의 `견적서 발행일`. */
  quoteIssuedDate: string | null;
  /** domestic_orders.order_issued_date — 상세표의 `PO 발행 일시`. */
  orderIssuedDate: string | null;
};

/**
 * 한 접수 건에 내자 줄이 여럿일 때 어느 줄을 쓸 것인가.
 *
 * **발주발행일이 가장 이른 줄**을 쓰고, 어느 줄에도 발주일이 없으면 **견적발행일이
 * 가장 이른 줄**을 쓴다. 가장 이른 것을 고르는 이유: 이 표가 답하는 질문은 "이
 * 장비 건은 언제 PO 가 났는가"이고, 나중 줄은 추가 발주·분할 발주라 그 질문의
 * 답이 아니다. 늦은 쪽을 고르면 같은 건이 매주 다른 날짜로 보인다.
 *
 * 두 날짜를 각각 다른 줄에서 뽑지 않고 **고른 줄의 두 값을 그대로** 쓴다 —
 * 따로 뽑으면 화면의 견적일과 발주일이 서로 다른 발주 건의 것이 된다.
 *
 * 줄이 하나도 없으면(연결이 없는 접수 건 — 실제로 많다) 둘 다 null 이고, 화면은
 * 빈칸으로 그린다.
 *
 * ── 이 함수가 지키는 불변식 ─────────────────────────────────────────────
 * **발주발행일이 있는 줄이 하나라도 있으면 고른 줄에도 발주발행일이 있다.**
 * 발주일이 있는 줄을 먼저 걸러 그 안에서만 고르기 때문이다. PO 발행 완료를
 * 세는 hasWeeklyReportPoIssued 가 이 불변식 위에 서 있어서, "발주일이 있는 줄이
 * 하나라도 있는가"를 알려고 조회를 따로 하지 않아도 된다. 시험이 이 불변식을
 * 못 박아 둔다.
 */
export function pickWeeklyReportOrderDates(
  rows: readonly WeeklyReportOrderDates[]
): WeeklyReportOrderDates {
  const withOrderDate = rows.filter((row) => row.orderIssuedDate !== null);
  const pool = withOrderDate.length > 0 ? withOrderDate : rows.filter((row) => row.quoteIssuedDate !== null);
  if (pool.length === 0) return { quoteIssuedDate: null, orderIssuedDate: null };

  // "YYYY-MM-DD" 는 사전순 비교가 곧 날짜순 비교다(date-only.ts 와 같은 판단) —
  // new Date() 로 파싱하면 날짜만 있는 문자열이 UTC 자정으로 읽혀 한국에서 하루
  // 밀린다.
  const keyOf = (row: WeeklyReportOrderDates) =>
    withOrderDate.length > 0 ? row.orderIssuedDate! : row.quoteIssuedDate!;

  return pool.reduce((earliest, row) => (keyOf(row) < keyOf(earliest) ? row : earliest));
}

/**
 * 이 건이 **PO 발행 완료**인가 — 세는 곳이 여기 하나뿐이다.
 *
 * 판정 근거는 상태가 아니라 **발주발행일의 유무**다. 어느 칸에 놓여 있든 그
 * 접수 건에 연결된 내자 줄(is_deleted = false) 중 order_issued_date 에 값이 있는
 * 것이 하나라도 있으면 세어진다(파일 헤더).
 *
 * 여기서 보는 orderIssuedDate 는 pickWeeklyReportOrderDates 가 고른 줄의 값이고,
 * 그 함수의 불변식 덕분에 "하나라도 있는가"와 뜻이 같다. 그래서 이 판정은
 * **상세표에 실제로 적히는 `PO 발행 일시`와 언제나 같은 것을 본다** — 칸의 숫자와
 * 표의 날짜가 어긋날 자리가 없다.
 */
export function hasWeeklyReportPoIssued(row: WeeklyReportOrderDates): boolean {
  return row.orderIssuedDate !== null;
}

/** 조회가 읽어 넘기는 접수 건 하나. 화면이 그리는 값이 전부 여기 있다. */
export type WeeklyReportCase = WeeklyReportClassifiable &
  WeeklyReportOrderDates & {
    id: string;
    /** 상세표의 `인수 번호`. */
    intakeNumber: string;
    /** 블록을 묶는 기준. */
    customerName: string;
    /**
     * customers.row_color — 고객사 관리에서 정한 팔레트 키. 없으면 null 이다.
     * 화면은 이 값으로 블록을 칠한다(customer-row-color.ts). 색을 여기까지
     * 실어 오는 이유: 내자 정리와 **같은 색**이라야 두 화면이 이어진다.
     */
    customerRowColor: string | null;
    /** RFG / MB 로 접기 전의 원본 종류. */
    workflowType: WorkflowType;
    /** 상세표의 `형식` · `S/N` · `L/N`. */
    modelName: string;
    serialNumber: string | null;
    lotNumber: string | null;
    /** 상세표의 `비고` — repair_cases.notes. */
    notes: string | null;
  };

/** 상세표 한 줄 — 위 값에 이 파일이 정한 세 가지(종류·칸·장기 PO 미발행)를 얹은 것이다. */
export type WeeklyReportRow = WeeklyReportCase & {
  kind: WeeklyReportKind;
  /** 6칸 중 어디인가. null 이면 분류 안 됨이고, 화면이 그 사실을 그대로 보여 준다. */
  reportStatus: WeeklyReportStatus | null;
  /**
   * 견적서를 낸 지 두 달이 지나도록 발주가 안 난 건인가(파일 헤더). 화면은 이
   * 값으로 `견적서 발행일` 칸에 **색과 굵기만** 입히고, 판정을 다시 하지 않는다.
   *
   * **세는 값이 아니다** — 집계 6칸에도, PO 발행 완료에도, 총 대수에도 들어가지
   * 않는다. 어느 칸에 놓인 줄에나 붙을 수 있다.
   */
  isLongPendingPo: boolean;
};

/** 고객사 × 종류 블록 하나 — 엑셀의 한 덩어리(집계 칸 + 상세표)에 해당한다. */
export type WeeklyReportBlock = {
  /** React key 용. 고객사 이름과 종류를 이어 붙인 값이다. */
  key: string;
  customerName: string;
  /** 이 블록을 칠할 팔레트 키. 정하지 않은 고객사는 null 이다. */
  customerRowColor: string | null;
  kind: WeeklyReportKind;
  counts: WeeklyReportCounts;
  rows: WeeklyReportRow[];
};

export type WeeklyReport = {
  /** 건수 많은 순. */
  blocks: WeeklyReportBlock[];
  /** RFG 총합 · MB 총합. 건수가 0이어도 두 줄 모두 있다 — 엑셀이 그렇다. */
  totalsByKind: { kind: WeeklyReportKind; counts: WeeklyReportCounts }[];
  /** 보고서 전체 합계. */
  total: WeeklyReportCounts;
};

function addToCounts(
  counts: WeeklyReportCounts,
  reportStatus: WeeklyReportStatus | null,
  poIssued: boolean
): void {
  if (reportStatus === null) counts.unclassified += 1;
  else counts.byStatus[reportStatus] += 1;
  // 겹쳐 세는 값이라 total 에 더하지 않는다 — 위 두 줄과 나란한 자리가 아니다.
  if (poIssued) counts.poIssued += 1;
  counts.total += 1;
}

/**
 * 접수 건 목록 → 보고서 전체.
 *
 * 순서가 이 함수의 규칙 중 하나다:
 *   - 블록은 **건수 많은 순**. 같으면 고객사 이름순, 그다음 RFG 가 MB 보다 앞
 *     (엑셀이 왼쪽 RFG · 오른쪽 MB 다). 기준이 하나뿐이면 건수가 같은 블록의
 *     차례가 매주 뒤바뀌어, 지난주 종이와 나란히 놓고 볼 수 없다.
 *   - 블록 안의 줄은 **인수번호 오름차순**. 인수번호는 D + 연월 + 일련번호라
 *     사전순이 곧 접수순이다.
 *
 * `now` 는 **장기 PO 미발행**을 가르는 "오늘"이다. 기본값을 두지 않는다 —
 * 두면 부르는 쪽이 잊었을 때 조용히 실제 오늘이 섞여 들어와, 서버가 그린 화면과
 * 시험 결과가 부르는 시각에 따라 달라진다(파일 헤더).
 */
export function buildWeeklyReport(
  cases: readonly WeeklyReportCase[],
  now: Date
): WeeklyReport {
  const blocks = new Map<string, WeeklyReportBlock>();
  const totalsByKind = new Map<WeeklyReportKind, WeeklyReportCounts>(
    WEEKLY_REPORT_KINDS.map((kind) => [kind, emptyCounts()])
  );
  const total = emptyCounts();

  for (const item of cases) {
    // 출하 완료는 어느 집계에도 들어가지 않는다 — 분류 안 됨으로도 세지 않는다.
    if (isExcludedFromWeeklyReport(item)) continue;

    const kind = foldWeeklyReportKind(item.workflowType);
    const reportStatus = classifyWeeklyReportStatus(item);
    const poIssued = hasWeeklyReportPoIssued(item);
    // 규칙은 전부 저 함수 안에 있다(파일 헤더). 여기서 넘기는 orderRows 가 한
    // 줄뿐인 것은, 조회가 이미 pickWeeklyReportOrderDates 로 **고른 줄**을 실어
    // 보내기 때문이다(queries/weekly-report.ts). 고른 줄 하나를 다시 고르면 그
    // 줄이 그대로 나온다 — 그 함수는 발주일 있는 줄을 먼저 걸러 그 안에서
    // 고르므로 한 줄짜리 입력에는 손댈 것이 없다(시험이 못 박는다). 그래서
    // 상세표에 실제로 적히는 두 날짜와 이 판정이 **언제나 같은 것을 본다**.
    const row: WeeklyReportRow = {
      ...item,
      kind,
      reportStatus,
      isLongPendingPo: isLongPendingPo({ status: item.status, orderRows: [item] }, now),
    };

    const key = `${item.customerName} ${kind}`;
    let block = blocks.get(key);
    if (!block) {
      block = {
        key,
        customerName: item.customerName,
        customerRowColor: item.customerRowColor,
        kind,
        counts: emptyCounts(),
        rows: [],
      };
      blocks.set(key, block);
    }
    block.rows.push(row);
    addToCounts(block.counts, reportStatus, poIssued);
    addToCounts(totalsByKind.get(kind)!, reportStatus, poIssued);
    addToCounts(total, reportStatus, poIssued);
  }

  const ordered = [...blocks.values()].sort((a, b) => {
    if (b.counts.total !== a.counts.total) return b.counts.total - a.counts.total;
    const byName = a.customerName.localeCompare(b.customerName, "ko");
    if (byName !== 0) return byName;
    return WEEKLY_REPORT_KINDS.indexOf(a.kind) - WEEKLY_REPORT_KINDS.indexOf(b.kind);
  });

  for (const block of ordered) {
    block.rows.sort((a, b) => a.intakeNumber.localeCompare(b.intakeNumber));
  }

  return {
    blocks: ordered,
    totalsByKind: WEEKLY_REPORT_KINDS.map((kind) => ({ kind, counts: totalsByKind.get(kind)! })),
    total,
  };
}

/**
 * 고객사 한 줄 — 왼쪽 RFG · 오른쪽 MB.
 *
 * 엑셀은 고객사마다 A~H 열에 RFG, I~P 열에 MB 를 **나란히** 둔다. 같은 고객사의
 * 두 종류를 한눈에 견주는 것이 그 양식의 핵심이라, 화면도 그 자리로 그린다.
 * blocks 는 고객사 × 종류가 납작하게 늘어선 목록이라 그대로는 좌우로 놓을 수
 * 없고, 화면이 매번 짝을 찾으면 그리기 안에 규칙이 스며든다 — 그래서 짝짓기는
 * 여기(순수 함수)서 한다.
 *
 * 고객사의 식별자는 **이름**이다. 조회가 customers.name 만으로 묶고 블록의 key 도
 * 이름으로 만들어져 있어 여기서 새로 만들 수 있는 것이 없다. 같은 이름의 고객사
 * 둘은 buildWeeklyReport 에서 이미 한 블록으로 합쳐지므로, 짝짓기가 그 사실을 더
 * 나쁘게 만들지는 않는다.
 */
export type WeeklyReportCustomerPair = {
  /** React key 용. 고객사 이름 그대로다 — 이 목록에서 고객사는 한 줄뿐이다. */
  key: string;
  customerName: string;
  /**
   * 한쪽이 0건이어도 **블록은 있다**. 엑셀의 ETC(RFG)가 전부 0인 채로 자리를
   * 지키는 것과 같다 — 없는 자리를 지워 버리면 좌우가 어긋나 옆 고객사의 MB 가
   * 이 고객사의 RFG 자리에 와 앉는다.
   */
  rfg: WeeklyReportBlock;
  mb: WeeklyReportBlock;
};

/**
 * 건이 하나도 없는 자리를 채우는 블록. key 는 buildWeeklyReport 가 만드는 것과
 * 같은 모양이고, **색도 같은 고객사의 것**이다 — 좌우 두 칸의 색이 다르면 빈
 * 쪽이 남의 블록처럼 보인다.
 */
function emptyBlock(
  customerName: string,
  customerRowColor: string | null,
  kind: WeeklyReportKind
): WeeklyReportBlock {
  return {
    key: `${customerName} ${kind}`,
    customerName,
    customerRowColor,
    kind,
    counts: emptyCounts(),
    rows: [],
  };
}

/**
 * 납작한 블록 목록 → 고객사마다 RFG·MB 한 쌍.
 *
 * **차례는 blocks 그대로다** — 고객사가 처음 나온 자리가 그 고객사의 자리다.
 * blocks 가 건수 많은 순이므로 결과도 건수 많은 고객사 순이 되고, 여기서 다시
 * 정렬하지 않는다: 기준이 두 곳에 생기면 한쪽만 고쳤을 때 지난주 종이와 차례가
 * 어긋난다.
 */
export function pairWeeklyReportBlocksByCustomer(
  blocks: readonly WeeklyReportBlock[]
): WeeklyReportCustomerPair[] {
  const pairs = new Map<string, WeeklyReportCustomerPair>();

  for (const block of blocks) {
    let pair = pairs.get(block.customerName);
    if (!pair) {
      pair = {
        key: block.customerName,
        customerName: block.customerName,
        rfg: emptyBlock(block.customerName, block.customerRowColor, "RFG"),
        mb: emptyBlock(block.customerName, block.customerRowColor, "MB"),
      };
      pairs.set(block.customerName, pair);
    }
    if (block.kind === "RFG") pair.rfg = block;
    else pair.mb = block;
  }

  // Map 은 넣은 차례를 지킨다 — 위 반복이 blocks 를 그대로 훑으므로 그 차례가 곧 결과의 차례다.
  return [...pairs.values()];
}

/**
 * ── PO 발행 현황 ────────────────────────────────────────────────────────
 * 원본 아래쪽의 구역이다. RFG 와 MB 각각, **고객사별 PO 발행 완료 건수**를
 * 늘어놓는다.
 *
 * **블록의 PO 발행 완료 숫자를 그대로 다시 읽는다.** 접수 건을 다시 세지 않는
 * 이유가 이것이다 — 두 곳이 따로 세면 언젠가 어긋나고, 그때 아무도 어느 쪽을
 * 믿을지 모른다. 여기서 하는 일은 이미 센 값을 종류별로 늘어놓는 것뿐이다.
 */
export type WeeklyReportPoIssuanceCustomer = {
  /** React key 용. 고객사 이름과 종류를 이어 붙인 값이다(블록의 key 와 같은 모양). */
  key: string;
  customerName: string;
  /** 이름표를 칠할 팔레트 키. 정하지 않은 고객사는 null 이다. */
  customerRowColor: string | null;
  /** 그 고객사·그 종류의 PO 발행 완료 건수. 0 이어도 자리를 지킨다. */
  count: number;
};

export type WeeklyReportPoIssuance = {
  kind: WeeklyReportKind;
  /**
   * 보고서에 나오는 **모든 고객사**가 두 종류 양쪽에 같은 차례로 들어 있다.
   * 0 인 고객사를 빼면 좌우 두 줄의 이름 차례가 어긋나 견줄 수 없다.
   */
  customers: WeeklyReportPoIssuanceCustomer[];
  /** 그 종류의 PO 발행 완료 합. totalsByKind 의 poIssued 와 같아야 한다. */
  total: number;
};

export function summarizeWeeklyReportPoIssuance(
  blocks: readonly WeeklyReportBlock[]
): WeeklyReportPoIssuance[] {
  // 고객사의 차례와 색은 blocks 에서 처음 나온 자리를 따른다(짝짓기와 같은 규칙).
  const order: string[] = [];
  const colorByCustomer = new Map<string, string | null>();
  const countByKey = new Map<string, number>();

  for (const block of blocks) {
    if (!colorByCustomer.has(block.customerName)) {
      order.push(block.customerName);
      colorByCustomer.set(block.customerName, block.customerRowColor);
    }
    countByKey.set(block.key, block.counts.poIssued);
  }

  return WEEKLY_REPORT_KINDS.map((kind) => {
    const customers = order.map((customerName) => ({
      key: `${customerName} ${kind}`,
      customerName,
      customerRowColor: colorByCustomer.get(customerName) ?? null,
      count: countByKey.get(`${customerName} ${kind}`) ?? 0,
    }));
    return {
      kind,
      customers,
      total: customers.reduce((acc, entry) => acc + entry.count, 0),
    };
  });
}
