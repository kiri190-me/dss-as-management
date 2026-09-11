import type { WeeklyReportDeliveryRow } from "@/lib/db/queries/weekly-report-deliveries";
import type { WeeklyReportGoalRow } from "@/lib/db/queries/weekly-report-goals";
import { buildWeeklyReport, type WeeklyReport, type WeeklyReportCase } from "./weekly-report";

/**
 * ============================================================================
 * 주간보고 미리보기용 **표본(가짜) 자료** — 실제 접수 건이 아니다
 * ============================================================================
 * 개발자 모드 [주간보고] 편집 화면(settings/developer/weekly-report)이 글자·상자
 * 크기를 고르는 동안 옆에 그려 보는 주간보고의 재료다. 고객사·인수번호·형식·
 * S/N 이 전부 **지어낸 값**이고, 어느 것도 DB 에 없다.
 *
 * ── 🔴 실 DB 를 읽지 않는다 ─────────────────────────────────────────────
 * 이 파일에는 조회도 server-only 도 들어오지 않는다(`@/lib/db/...` 는 타입만
 * 가져온다 — 컴파일되면 사라진다). 미리보기에 실제 자료를 쓰면 개발자 모드 화면이
 * 주간보고 권한 없이 고객사 자료를 보여 주는 두 번째 문이 되고, 자료 양에 따라
 * 비교할 모양도 매번 달라진다. 시험(weekly-report.test.ts)이 원본을 읽어 지킨다.
 *
 * ── 🔴 "오늘"도 지어낸 날짜다 ───────────────────────────────────────────
 * 장기 PO 미발행 판정은 오늘을 받아야 한다(buildWeeklyReport 의 now). 여기서
 * new Date() 를 부르면 날이 지날수록 빨간 볼드 줄이 생겼다 없어졌다 하고, 서버가
 * 그린 것과 시험이 보는 것이 달라진다. 그래서 날짜를 못 박는다 — 표본의 견적일은
 * 그 날짜에 맞춰 두 달을 넘기도록 적었다.
 *
 * ── 담는 경우 (짧게 — 한눈에 비교할 만큼) ───────────────────────────────
 *   · 긴 고객사명 — 소제목 줄이 넘치면 그 줄만 좌우로 밀리는지
 *   · RFG/MB 한쪽만 빈 쌍 — 빈 쪽이 「해당 없음」으로 자리를 지키는지(표 최소 높이)
 *   · 분류 안 됨 — 맨 위 빨간 안내 · 빨간 집계 칸 · 빨간 배지
 *   · 장기 PO 미발행 — 견적서 발행일 빨간 볼드
 *   · PO 발행 완료 — PO 발행 일시 칸과 겹쳐 세는 칸
 *   · 여러 줄 비고 — 줄 높이와 표 칸 위아래 여백
 *   · 금주 목표 줄 · 납입 예정 줄 — 목표·납입 상자(한쪽은 비워 최소 높이가 보이게)
 *
 * 값은 실제 조회가 돌려주는 모양 그대로다 — 보고서는 **같은 순수 함수**
 * (buildWeeklyReport)로 만든다. 모양을 손으로 적으면 집계 숫자가 표와 어긋난
 * 미리보기가 나오고, 사람은 그것을 크기 설정의 문제로 읽는다.
 * ============================================================================
 */

/** 표본의 "오늘". 2026-09-10(목) 한국 시간 정오 — 지어낸 날짜다(파일 머리말). */
const SAMPLE_NOW = new Date("2026-09-10T12:00:00+09:00");

/** 표본의 "이번 주" 월요일. 목표 상자가 「이번 주가 아닌 주」 안내를 띄우지 않게 오늘과 같은 주다. */
const SAMPLE_WEEK_START = "2026-09-07";

/** 목표·납입 줄의 만든 시각(정렬의 두 번째 기준). 지어낸 값이다. */
const SAMPLE_CREATED_AT = "2026-09-07T09:00:00+09:00";

/** 긴 이름. 좁은 폭에서 소제목 줄이 어떻게 버티는지 보려고 일부러 길게 지었다. */
const LONG_CUSTOMER_NAME = "(표본) 가나다라 반도체 장비 솔루션즈 코리아 주식회사";

/** 짧은 이름. MB 쪽 건이 하나도 없는 고객사다. */
const SHORT_CUSTOMER_NAME = "(표본) 마바전자";

/** 표본 접수 건 다섯. 고객사 둘 × 좌우 한 줄씩, 한 고객사는 MB 가 비어 있다. */
const SAMPLE_CASES: readonly WeeklyReportCase[] = [
  {
    // PO 발행 완료 + 여러 줄 비고.
    id: "sample-case-1",
    version: 1,
    intakeNumber: "D2609-S01",
    customerName: LONG_CUSTOMER_NAME,
    customerRowColor: "amber",
    workflowType: "PAID_GENERATOR",
    modelName: "SAMPLE-RFG-3000",
    serialNumber: "SN-S0001",
    lotNumber: "LN-S01",
    notes: "1차 점검 완료\n교체 부품 입고 대기 (표본)",
    status: "IN_REPAIR",
    currentWorkflowStepKey: "in_repair",
    hasIntakeInspectionRecord: true,
    quoteIssuedDate: "2026-08-20",
    orderIssuedDate: "2026-08-28",
  },
  {
    // 장기 PO 미발행 — 견적일 + 2개월(2026-08-15) ≤ 표본의 오늘(2026-09-10).
    id: "sample-case-2",
    version: 1,
    intakeNumber: "D2609-S02",
    customerName: LONG_CUSTOMER_NAME,
    customerRowColor: "amber",
    workflowType: "WARRANTY_TOTAL_CONTROLLER",
    modelName: "SAMPLE-TC-200",
    serialNumber: "SN-S0002",
    lotNumber: null,
    notes: null,
    status: "WAITING_PO",
    currentWorkflowStepKey: "waiting_po",
    hasIntakeInspectionRecord: true,
    quoteIssuedDate: "2026-06-15",
    orderIssuedDate: null,
  },
  {
    // MB 쪽 — 점검 대기, 날짜 없음.
    id: "sample-case-3",
    version: 1,
    intakeNumber: "D2609-S03",
    customerName: LONG_CUSTOMER_NAME,
    customerRowColor: "amber",
    workflowType: "PAID_MATCHER",
    modelName: "SAMPLE-MB-10",
    serialNumber: "SN-S0003",
    lotNumber: "LN-S03",
    notes: "외관 손상 사진 첨부 (표본)",
    status: "WAITING_INTAKE_INSPECTION",
    currentWorkflowStepKey: "intake_inspection",
    hasIntakeInspectionRecord: false,
    quoteIssuedDate: null,
    orderIssuedDate: null,
  },
  {
    // 분류 안 됨 — 상태가 비어 있는 단계에 놓인 건(workflow_steps.repair_status 는 nullable).
    id: "sample-case-4",
    version: 1,
    intakeNumber: "D2609-S04",
    customerName: SHORT_CUSTOMER_NAME,
    customerRowColor: null,
    workflowType: "PAID_GENERATOR",
    modelName: "SAMPLE-RFG-1000",
    serialNumber: null,
    lotNumber: null,
    notes: null,
    status: null,
    currentWorkflowStepKey: "sample_unmapped_step",
    hasIntakeInspectionRecord: false,
    quoteIssuedDate: null,
    orderIssuedDate: null,
  },
  {
    // 출하 대기 + PO 발행 완료.
    id: "sample-case-5",
    version: 1,
    intakeNumber: "D2609-S05",
    customerName: SHORT_CUSTOMER_NAME,
    customerRowColor: null,
    workflowType: "WARRANTY_GENERATOR",
    modelName: "SAMPLE-RFG-1000",
    serialNumber: "SN-S0005",
    lotNumber: "LN-S05",
    notes: null,
    status: "WAITING_SHIPMENT",
    currentWorkflowStepKey: "waiting_shipment",
    hasIntakeInspectionRecord: true,
    quoteIssuedDate: "2026-07-30",
    orderIssuedDate: "2026-08-05",
  },
];

/** 편집 화면이 WeeklyReportScreen 에 넘길 재료 한 벌. 권한 값은 담지 않는다 — 부르는 쪽이 전부 끈다. */
export type WeeklyReportPreviewSample = {
  report: WeeklyReport;
  /** 머리말의 `갱신 일`. 표본의 오늘을 실제 화면과 같은 모양으로 적은 것이다. */
  asOfDate: string;
  /** 목표·납입 상자가 보는 주. 이번 주와 같다(SAMPLE_WEEK_START 주석). */
  weekStart: string;
  goals: WeeklyReportGoalRow[];
  deliveries: WeeklyReportDeliveryRow[];
};

/**
 * 표본 한 벌을 **새로** 만든다. 상수 하나를 돌려 쓰지 않는 이유: buildWeeklyReport 가
 * 블록의 줄을 제자리에서 정렬하고, 화면 쪽에서 무엇이 바뀌든 다음 요청의 표본에
 * 번지면 안 된다.
 */
export function buildWeeklyReportPreviewSample(): WeeklyReportPreviewSample {
  const createdAt = new Date(SAMPLE_CREATED_AT);

  const goals: WeeklyReportGoalRow[] = [
    {
      id: "sample-goal-1",
      weekStartDate: SAMPLE_WEEK_START,
      repairCaseId: "sample-case-1",
      goalText: "수리 완료 후 출하 승인 요청",
      displayOrder: 1,
      version: 1,
      createdAt,
      customerName: LONG_CUSTOMER_NAME,
      intakeNumber: "D2609-S01",
      modelName: "SAMPLE-RFG-3000",
      lotNumber: "LN-S01",
      serialNumber: "SN-S0001",
      workflowType: "PAID_GENERATOR",
      kind: "RFG",
    },
    {
      id: "sample-goal-2",
      weekStartDate: SAMPLE_WEEK_START,
      repairCaseId: "sample-case-3",
      goalText: "인수점검 착수",
      displayOrder: 2,
      version: 1,
      createdAt,
      customerName: LONG_CUSTOMER_NAME,
      intakeNumber: "D2609-S03",
      modelName: "SAMPLE-MB-10",
      lotNumber: "LN-S03",
      serialNumber: "SN-S0003",
      workflowType: "PAID_MATCHER",
      kind: "MB",
    },
  ];

  // 납입 예정은 RFG 한 줄뿐이다 — MB 상자가 비어 「해당 없음」과 최소 높이가 보이게.
  const deliveries: WeeklyReportDeliveryRow[] = [
    {
      id: "sample-delivery-1",
      weekStartDate: SAMPLE_WEEK_START,
      repairCaseId: "sample-case-5",
      note: "오전 중 발송 (표본)",
      displayOrder: 1,
      version: 1,
      createdAt,
      intakeNumber: "D2609-S05",
      modelName: "SAMPLE-RFG-1000",
      serialNumber: "SN-S0005",
      lotNumber: "LN-S05",
      customerName: SHORT_CUSTOMER_NAME,
      workflowType: "WARRANTY_GENERATOR",
      kind: "RFG",
      internalTargetShipmentDate: "2026-09-11",
      earliestRequestedDueDate: "2026-09-12",
    },
  ];

  return {
    report: buildWeeklyReport(SAMPLE_CASES, SAMPLE_NOW),
    asOfDate: "2026. 09. 10.",
    weekStart: SAMPLE_WEEK_START,
    goals,
    deliveries,
  };
}
