import "server-only";

import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../client";
import {
  customers,
  domesticOrders,
  products,
  repairCaseWorkRecords,
  repairCases,
  workflowSteps,
  workflowTemplates,
  workflowVersions,
} from "../schema";
import { workflowTypeCodeColumn } from "../workflow-type-column";
import {
  pickWeeklyReportOrderDates,
  type WeeklyReportCase,
  type WeeklyReportOrderDates,
} from "@/lib/domain/weekly-report";

/**
 * ============================================================================
 * 주간보고 — 읽는 쪽
 * ============================================================================
 * **SELECT 만 있다.** 이 화면은 조회 전용이라 mutation 이 아예 없다.
 *
 * ── 여기서는 판정하지 않는다 ────────────────────────────────────────────
 * 어느 건이 '점검 중'인지, 어느 고객사 블록에 들어가는지는 **읽어서 넘기고**
 * domain/weekly-report.ts 의 순수 함수가 정한다. SQL 의 CASE 로 접으면 그 규칙을
 * 시험할 자리가 사라진다 — 내자 정리 조회가 고객사·형식을 coalesce 하지 않고 두
 * 벌을 다 실어 오는 것과 같은 판단이다(queries/domestic-orders.ts).
 *
 * 이 파일이 하는 유일한 판단은 **내자 줄이 여럿일 때 어느 줄의 날짜를 쓸지**인데,
 * 그것도 여기서 적지 않고 도메인의 pickWeeklyReportOrderDates 를 부른다.
 *
 * ── PO 발행 완료를 위해 조회를 넓히지 않는다 ────────────────────────────
 * 'PO 발행 완료'는 **발주발행일이 있는 내자 줄이 하나라도 있는가**로 갈린다.
 * 그런데 pickWeeklyReportOrderDates 는 발주일이 있는 줄을 먼저 걸러 그 안에서만
 * 고르므로, **고른 줄에 발주일이 있다 ⟺ 그런 줄이 하나라도 있다**가 성립한다
 * (그 함수의 불변식, 시험으로 못 박혀 있다). 그래서 여기서 exists 질의를 하나 더
 * 더하지 않는다 — 더하면 화면의 `PO 발행 일시` 칸과 집계가 서로 다른 값을 보게
 * 되어, 언젠가 어긋났을 때 어느 쪽이 맞는지 말할 수 없다.
 *
 * ── 질의는 세 번, N+1 은 없다 ───────────────────────────────────────────
 * 접수 건 한 번 + 인수점검 기록 유무 한 번 + 내자 날짜 한 번. 건마다 따로 묻는
 * 방식이면 252건짜리 화면에 505번의 왕복이 생긴다.
 *
 * 점검 기록과 내자를 위 조인에 끼워 넣지 않는 이유는 **줄이 복제되기 때문**이다 —
 * 한 건에 점검 기록이 셋이면 그 건이 세 번 나오고, 집계가 통째로 어긋난다
 * (내자 정리의 납기일이 같은 이유로 따로 읽힌다).
 *
 * ── 출하 완료만 SQL 에서 뺀다 ───────────────────────────────────────────
 * 진행 중인 것만 보는 보고서라 출하 완료는 애초에 읽지 않는다. 조건을
 * `<> 'SHIPMENT_COMPLETED'` 가 아니라 **`is distinct from`** 으로 적은 것은
 * 일부러다: workflow_steps.repair_status 는 아직 nullable 이고(그 스키마 주석),
 * `<>` 로 적으면 상태가 비어 있는 단계에 놓인 건이 **조용히 사라진다**. 그런
 * 건은 사라지는 대신 '분류 안 됨'으로 화면에 드러나야 한다.
 *
 * ── PII ────────────────────────────────────────────────────────────────
 * 이 조회는 연락처 스냅샷(contact_*_snapshot)을 고르지 않는다. notes 는 사람이
 * 자유롭게 적는 값이라 담당자 이름이 섞일 수 있으므로, 부르는 쪽은 이 행을
 * 그대로 로그에 남기지 않는다.
 * ============================================================================
 */

/**
 * 주간보고에 나올 접수 건 전부(출하 완료 제외, 휴지통 제외).
 *
 * 정렬은 인수번호 오름차순이다. 최종 차례는 도메인이 다시 정하지만
 * (건수 많은 순 → 인수번호순), 여기서도 정해 두어야 같은 자료에서 늘 같은
 * 결과가 나온다 — 정렬 없는 SELECT 는 순서를 보장하지 않는다.
 */
export async function listWeeklyReportCases(): Promise<WeeklyReportCase[]> {
  const rows = await db
    .select({
      id: repairCases.id,
      intakeNumber: repairCases.intakeNumber,
      customerName: customers.name,
      // 고객사 색은 화면이 블록을 칠하는 데 쓴다 — 내자 정리와 **같은 색**이라야
      // 두 화면이 이어진다(customer-row-color.ts). 색 코드가 아니라 팔레트
      // 키가 담겨 있고, 정하지 않은 고객사는 null 이다.
      customerRowColor: customers.rowColor,
      workflowType: workflowTypeCodeColumn(),
      status: workflowSteps.repairStatus,
      // 분류는 이 값을 보지 않는다(도메인의 WeeklyReportClassifiable 주석) —
      // 분류 안 된 건이 어느 단계에 앉아 있는지를 남겨 두려고 함께 읽는다.
      currentWorkflowStepKey: workflowSteps.key,
      modelName: products.modelName,
      serialNumber: products.serialNumber,
      lotNumber: products.lotNumber,
      notes: repairCases.notes,
    })
    .from(repairCases)
    .innerJoin(customers, eq(repairCases.customerId, customers.id))
    .innerJoin(products, eq(repairCases.productId, products.id))
    .innerJoin(workflowVersions, eq(repairCases.workflowVersionId, workflowVersions.id))
    .innerJoin(workflowTemplates, eq(workflowVersions.workflowTemplateId, workflowTemplates.id))
    .innerJoin(workflowSteps, eq(repairCases.currentWorkflowStepId, workflowSteps.id))
    .where(
      and(
        eq(repairCases.isDeleted, false),
        // 파일 헤더의 '출하 완료만 SQL 에서 뺀다' 참조 — NULL 을 함께 떨어뜨리지
        // 않기 위해 is distinct from 이다.
        sql`${workflowSteps.repairStatus} is distinct from 'SHIPMENT_COMPLETED'::repair_status`
      )
    )
    .orderBy(asc(repairCases.intakeNumber));

  const caseIds = rows.map((row) => row.id);
  const [inspectedCaseIds, orderDatesByCaseId] = await Promise.all([
    loadIntakeInspectedCaseIds(caseIds),
    loadOrderDatesByCaseId(caseIds),
  ]);

  return rows.map((row) => ({
    ...row,
    hasIntakeInspectionRecord: inspectedCaseIds.has(row.id),
    ...(orderDatesByCaseId.get(row.id) ?? { quoteIssuedDate: null, orderIssuedDate: null }),
  }));
}

/**
 * 인수점검 결과 기록이 하나라도 있는 접수 건의 id.
 *
 * 무효화된 기록(invalidated_at)도 **있는 것으로 센다.** 승인된 매핑표가
 * "record_kind = 'INTAKE_INSPECTION_RESULT' 인 행이 하나라도 있는지"라고
 * 못 박고 있어서다. 개발 DB 에서는 두 방식의 결과가 같다(2026-08-25 실측:
 * 판정이 달라지는 건 0). 달라지기 시작하면 그때 규칙을 다시 정할 일이지,
 * 여기서 조용히 좁힐 일이 아니다.
 */
async function loadIntakeInspectedCaseIds(caseIds: string[]): Promise<Set<string>> {
  // inArray 에 빈 배열을 넘기면 뜻 없는 SQL 이 만들어진다(내자 조회와 같은 규칙).
  if (caseIds.length === 0) return new Set();

  const rows = await db
    .selectDistinct({ repairCaseId: repairCaseWorkRecords.repairCaseId })
    .from(repairCaseWorkRecords)
    .where(
      and(
        inArray(repairCaseWorkRecords.repairCaseId, caseIds),
        eq(repairCaseWorkRecords.recordKind, "INTAKE_INSPECTION_RESULT")
      )
    );

  const found = new Set<string>();
  for (const row of rows) {
    // repair_case_id 는 nullable 이다(접수 건 영구 삭제 시 SET NULL). inArray 가
    // 이미 걸러 내지만 타입을 좁히기 위해 확인한다.
    if (row.repairCaseId !== null) found.add(row.repairCaseId);
  }
  return found;
}

/**
 * 접수 건별 내자 날짜 한 벌.
 *
 * 한 접수 건에 내자 줄이 **여럿일 수 있어** 그대로 조인하면 그 건이 여러 번
 * 나온다(파일 헤더). 그래서 따로 읽어 건마다 묶고, 그중 하나를 고르는 일은
 * 도메인의 pickWeeklyReportOrderDates 가 한다 — 발주발행일이 가장 이른 줄,
 * 없으면 견적발행일이 가장 이른 줄이다(그 함수의 주석).
 *
 * `is_deleted = false` 인 줄만 본다.
 */
async function loadOrderDatesByCaseId(
  caseIds: string[]
): Promise<Map<string, WeeklyReportOrderDates>> {
  const picked = new Map<string, WeeklyReportOrderDates>();
  if (caseIds.length === 0) return picked;

  const rows = await db
    .select({
      repairCaseId: domesticOrders.repairCaseId,
      quoteIssuedDate: domesticOrders.quoteIssuedDate,
      orderIssuedDate: domesticOrders.orderIssuedDate,
    })
    .from(domesticOrders)
    .where(
      and(eq(domesticOrders.isDeleted, false), inArray(domesticOrders.repairCaseId, caseIds))
    );

  const grouped = new Map<string, WeeklyReportOrderDates[]>();
  for (const row of rows) {
    if (row.repairCaseId === null) continue;
    const bucket = grouped.get(row.repairCaseId);
    const item: WeeklyReportOrderDates = {
      quoteIssuedDate: row.quoteIssuedDate,
      orderIssuedDate: row.orderIssuedDate,
    };
    if (bucket) bucket.push(item);
    else grouped.set(row.repairCaseId, [item]);
  }

  for (const [caseId, orderRows] of grouped) {
    picked.set(caseId, pickWeeklyReportOrderDates(orderRows));
  }
  return picked;
}
