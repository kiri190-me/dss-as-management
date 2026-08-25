import "server-only";

import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "../client";
import {
  customers,
  domesticOrderDueDates,
  domesticOrders,
  products,
  repairCases,
  weeklyReportDeliveries,
  workflowTemplates,
  workflowVersions,
} from "../schema";
import { workflowTypeCodeColumn } from "../workflow-type-column";
import { foldWeeklyReportKind, type WeeklyReportKind } from "@/lib/domain/weekly-report";
import { pickEarliestDueDate } from "@/lib/domain/weekly-report-delivery";
import type { WorkflowType } from "@/lib/domain/types";

/**
 * ============================================================================
 * 주간보고 납입 예정 건 — 읽는 쪽
 * ============================================================================
 * **SELECT 만 있다.** 저장·삭제는 트랜잭션과 낙관적 잠금이 필요해
 * mutations/weekly-report-deliveries.ts 가 맡는다(이 저장소의 queries/mutations
 * 구분). 같은 화면의 금주 목표를 읽는 queries/weekly-report-goals.ts 와 나란한
 * 자리이고, 방식도 그쪽에 맞춘다.
 *
 * ── 여덟 칸 중 둘만 저장돼 있다. 나머지는 여기서 걷어 온다 ──────────────
 * 표에 인쇄되는 여덟 칸 중 이 표에 실제로 든 것은 **어느 수리 건인가**와
 * **비고**뿐이다(schema/weekly-report-deliveries.ts 헤더). 나머지는 전부 여기서
 * 읽어 넘긴다:
 *
 *   인수번호·형식·S/N·L/N·고객사  ← repair_cases → products · customers
 *   RFG / MB                        ← 워크플로 종류(foldWeeklyReportKind)
 *   납입 예정                       ← repair_cases.internal_target_shipment_date
 *   입고 요청일                     ← 내자 납기요청일 중 가장 이른 것
 *
 * 이어 붙이거나 접는 일은 여기서 하지 않는다 — `입고 요청일`을 고르는 규칙도
 * SQL 의 min() 이 아니라 domain/weekly-report-delivery.ts 의 pickEarliestDueDate
 * 가 정한다. SQL 로 접으면 "지난 날짜라도 가장 이르면 그것"이라는 승인된 결정을
 * 시험할 자리가 사라지고, 그 규칙이 조용히 달라져도 아무 데서도 드러나지 않는다
 * (queries/weekly-report.ts 가 상태 분류를 CASE 로 접지 않은 것과 같은 판단이다).
 *
 * ── ⚠️ 질의를 나눠 하는 이유 — 조인하면 줄이 복제된다 ──────────────────
 * 한 수리 건에 **내자 줄이 여럿**이고(분할 발주), 내자 줄 하나에 **납기요청일이
 * 또 여럿**이다(분할 납품). 위 목록 조인에 그대로 끼워 넣으면 날짜 수만큼 줄이
 * 복제되어, 날짜가 셋인 건 하나가 표에 세 줄로 나온다. 그래서 목록을 먼저 읽고
 * 날짜는 **따로 한 번** 읽어 건마다 묶는다 — queries/weekly-report.ts 의
 * loadOrderDatesByCaseId, queries/long-pending-po.ts 가 같은 이유로 같은 방식을
 * 쓴다. 질의는 두 번이고, 건마다 따로 묻지 않는다(N+1 없음).
 *
 * `is_deleted = false` 인 내자 줄의 날짜만 센다 — 지운 발주 줄에 붙어 있던
 * 날짜가 `입고 요청일`을 만들어 내면, 화면에 없는 줄이 표의 값을 정하는 셈이
 * 된다.
 *
 * ── 조인은 INNER JOIN 이다 ──────────────────────────────────────────────
 * repair_case_id 가 NOT NULL 이고 repair_cases 는 customers·products 를 필수로
 * 가리키므로 LEFT JOIN 으로 적어도 결과는 같다. 그래도 INNER 로 적는 것은
 * **연결이 끊긴 줄이 조용히 빈칸으로 나오지 않게** 하기 위해서다(금주 목표
 * 조회와 같은 판단).
 *
 * ── 휴지통에 있는 수리 건도 그대로 보여 준다 ────────────────────────────
 * repair_cases.is_deleted 를 보지 않는다. 지난주 목록에 올려 둔 건이 이번 주에
 * 휴지통으로 갔다면, 그 사실은 지난주 표에서 줄이 사라지는 것이 아니라 그대로
 * 남아 있는 것으로 드러나야 한다. 영구 삭제된 건은 CASCADE 로 이 줄까지 함께
 * 사라진다(스키마 헤더).
 *
 * ── PII ────────────────────────────────────────────────────────────────
 * note 는 사람이 자유롭게 적는 값이라 담당자 이름이 섞일 수 있다(스키마 헤더의
 * PII 항목). 부르는 쪽은 이 행을 그대로 로그에 남기지 않는다.
 * ============================================================================
 */

/** 화면이 납입 예정 줄 하나를 그리는 데 필요한 값 전부. 전부 직렬화 가능한 값이다. */
export type WeeklyReportDeliveryRow = {
  id: string;
  /** "YYYY-MM-DD" — 그 주 월요일. date 컬럼이라 문자열로 온다. */
  weekStartDate: string;
  repairCaseId: string;
  /** 사람이 치는 유일한 값. 비어 있을 수 있다. */
  note: string | null;
  displayOrder: number | null;
  /** 낙관적 잠금 토큰. 폼이 그대로 다시 실어 보낸다. */
  version: number;
  /** 정렬의 두 번째 기준. */
  createdAt: Date;
  /** 아래 다섯은 표의 앞 다섯 칸이다 — 저장된 값이 아니다. */
  intakeNumber: string;
  modelName: string;
  serialNumber: string | null;
  lotNumber: string | null;
  customerName: string;
  /** RFG/MB 로 접기 전의 원본 종류. */
  workflowType: WorkflowType;
  /** 어느 표인가 — 수리 건의 종류가 정한다(파일 헤더). */
  kind: WeeklyReportKind;
  /**
   * `납입 예정` 칸 — 수리 건의 **사내 목표 출하일**(상세화면의 그 칸 그대로).
   * 아직 정하지 않은 건이 실제로 있어 null 이 온다. 그때 화면은 빈칸이다.
   */
  internalTargetShipmentDate: string | null;
  /**
   * `입고 요청일` 칸 — 그 건에 붙은 내자 납기요청일 중 **가장 이른 하루**.
   * 날짜가 하나도 없으면 null 이다(도메인의 pickEarliestDueDate).
   */
  earliestRequestedDueDate: string | null;
};

/**
 * 한 주의 납입 예정 줄 전부.
 *
 * 정렬은 `display_order asc, created_at asc` 다 — NULL 은 Postgres 기본대로 뒤로
 * 간다. 금주 목표 조회와 같은 차례라, 한 화면 안의 두 상자가 서로 다른 규칙으로
 * 줄을 세우지 않는다.
 *
 * weekStart 는 **월요일이어야 한다.** 월요일로 접는 일은 부르는 쪽이 이미
 * 끝냈다고 보고(validation/weekly-report-delivery-input.ts) 여기서 다시 접지
 * 않는다 — 두 곳에서 접으면 한쪽만 고쳐지는 날이 온다.
 */
export async function listWeeklyReportDeliveries(
  weekStart: string
): Promise<WeeklyReportDeliveryRow[]> {
  const rows = await db
    .select({
      id: weeklyReportDeliveries.id,
      weekStartDate: weeklyReportDeliveries.weekStartDate,
      repairCaseId: weeklyReportDeliveries.repairCaseId,
      note: weeklyReportDeliveries.note,
      displayOrder: weeklyReportDeliveries.displayOrder,
      version: weeklyReportDeliveries.version,
      createdAt: weeklyReportDeliveries.createdAt,
      intakeNumber: repairCases.intakeNumber,
      modelName: products.modelName,
      serialNumber: products.serialNumber,
      lotNumber: products.lotNumber,
      customerName: customers.name,
      workflowType: workflowTypeCodeColumn(),
      internalTargetShipmentDate: repairCases.internalTargetShipmentDate,
    })
    .from(weeklyReportDeliveries)
    .innerJoin(repairCases, eq(weeklyReportDeliveries.repairCaseId, repairCases.id))
    .innerJoin(customers, eq(repairCases.customerId, customers.id))
    .innerJoin(products, eq(repairCases.productId, products.id))
    // workflowTypeCodeColumn 은 템플릿·버전을 거쳐 종류 코드를 만든다 —
    // 주간보고의 다른 조회들이 타는 것과 같은 길이라 종류가 어긋날 수 없다.
    .innerJoin(workflowVersions, eq(repairCases.workflowVersionId, workflowVersions.id))
    .innerJoin(workflowTemplates, eq(workflowVersions.workflowTemplateId, workflowTemplates.id))
    .where(eq(weeklyReportDeliveries.weekStartDate, weekStart))
    .orderBy(asc(weeklyReportDeliveries.displayOrder), asc(weeklyReportDeliveries.createdAt));

  const earliestByCaseId = await loadEarliestDueDateByCaseId(rows.map((row) => row.repairCaseId));

  return rows.map((row) => ({
    ...row,
    kind: foldWeeklyReportKind(row.workflowType),
    earliestRequestedDueDate: earliestByCaseId.get(row.repairCaseId) ?? null,
  }));
}

/**
 * 접수 건별 **가장 이른 납기요청일** 한 벌.
 *
 * 내자 줄과 그 줄에 딸린 날짜를 함께 읽는다. 이 조인은 줄을 복제하지만
 * (한 발주 줄에 날짜가 셋이면 세 줄) **여기서는 그래도 된다** — 세는 것이 아니라
 * 날짜를 모으는 질의라, 복제된 줄은 같은 묶음에 들어갈 뿐이다. 복제가 문제가
 * 되는 것은 목록 쪽이고, 그래서 목록은 이 질의와 나눠 둔다(파일 헤더).
 *
 * 고르는 일은 도메인의 pickEarliestDueDate 가 한다 — 지난 날짜라도 그것이 가장
 * 이르면 그것이다(승인된 결정, 그 함수의 주석).
 */
async function loadEarliestDueDateByCaseId(caseIds: string[]): Promise<Map<string, string>> {
  const earliest = new Map<string, string>();
  // inArray 에 빈 배열을 넘기면 뜻 없는 SQL 이 만들어진다(주간보고의 다른
  // 조회들과 같은 규칙).
  if (caseIds.length === 0) return earliest;

  const rows = await db
    .select({
      repairCaseId: domesticOrders.repairCaseId,
      dueDate: domesticOrderDueDates.dueDate,
    })
    .from(domesticOrderDueDates)
    .innerJoin(domesticOrders, eq(domesticOrderDueDates.domesticOrderId, domesticOrders.id))
    .where(
      and(
        // 지운 발주 줄의 날짜는 세지 않는다(파일 헤더).
        eq(domesticOrders.isDeleted, false),
        inArray(domesticOrders.repairCaseId, caseIds)
      )
    );

  const grouped = new Map<string, string[]>();
  for (const row of rows) {
    // repair_case_id 는 nullable 이다(접수 건 영구 삭제 시 SET NULL). inArray 가
    // 이미 걸러 내지만 타입을 좁히기 위해 확인한다.
    if (row.repairCaseId === null) continue;
    const bucket = grouped.get(row.repairCaseId);
    if (bucket) bucket.push(row.dueDate);
    else grouped.set(row.repairCaseId, [row.dueDate]);
  }

  for (const [caseId, dueDates] of grouped) {
    // 여러 내자 줄에 걸친 날짜가 **한 묶음으로** 넘어간다 — 줄마다 접은 뒤 다시
    // 고르지 않는다(도메인 함수의 주석).
    const picked = pickEarliestDueDate(dueDates);
    if (picked !== null) earliest.set(caseId, picked);
  }
  return earliest;
}
