import "server-only";

import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../client";
import {
  customers,
  domesticOrders,
  products,
  repairCases,
  workflowSteps,
  workflowTemplates,
  workflowVersions,
} from "../schema";
import { workflowTypeCodeColumn } from "../workflow-type-column";
import { listQuoteInfoForRepairCases } from "./domestic-orders";
import {
  listArchiveQuoteNumbers,
  repairCaseQuoteNumbers,
} from "./repair-case-quote-numbers";
import {
  pickWeeklyReportOrderDates,
  type WeeklyReportCase,
  type WeeklyReportOrderDates,
} from "@/lib/domain/weekly-report";

/**
 * ============================================================================
 * 주간보고 — 읽는 쪽
 * ============================================================================
 * **SELECT 만 있다.** 상세표의 `비고` 를 화면에서 바로 고칠 수 있게 됐지만, 그
 * 저장은 여기로 오지 않는다 — 수리 건 상세와 **같은 길**(FAULT_SERVICE 구간의
 * updateRepairCaseAction)로 나간다. 주간보고 전용 저장 경로를 이 파일에 만들면
 * 같은 컬럼에 규칙이 둘 생기고, 두 화면이 다른 뜻으로 갈린다.
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
 * 더하지 않는다 — 더하면 화면의 `PO 발행일` 칸과 집계가 서로 다른 값을 보게
 * 되어, 언젠가 어긋났을 때 어느 쪽이 맞는지 말할 수 없다.
 *
 * ── 질의는 세 번, N+1 은 없다 ───────────────────────────────────────────
 * 접수 건 한 번 + 내자 날짜 한 번 + 내자 **견적서번호** 한 번. 건마다 따로 묻는
 * 방식이면 252건짜리 화면에 253번의 왕복이 생긴다.
 *
 * 셋째가 2026-10-07 에 늘었다(아래 '견적서 번호는 날짜와 다른 길로 온다'). 날짜를
 * 읽는 둘째 질의로 번호까지 가져오지 **않는다** — 두 화면이 보는 번호가 같아야 하고,
 * 「완료된 줄은 빼고 견적발행일이 가장 늦은 줄」이라는 그 규칙은 이미
 * queries/domestic-orders.ts 의 listQuoteInfoForRepairCases 하나가 쥐고 있다. 여기서
 * 베껴 적으면 고객 안내 현황과 주간보고가 다른 번호를 보이는 날이 온다.
 *
 * ── 견적서 번호는 날짜와 **다른 길로** 온다 (2026-10-07) ─────────────────
 * 상세표의 `견적서 발행일` 칸에 날짜 옆 역삼각이 생기고, 누르면 그 건의 견적서
 * 번호들이 칸 안에 펼쳐진다(사용자 지시). 그 번호는 **고객 안내 현황에 뜨는 것과
 * 같아야 해서** 규칙을 쥔 함수를 그대로 부른다
 * (queries/repair-case-quote-numbers.ts 의 repairCaseQuoteNumbers — 내자 정리에
 * 번호가 있으면 그것만, 없을 때만 공유폴더의 견적서 폴더 안 파일 이름에서 읽는다).
 *
 * 🔴 **날짜 규칙은 한 글자도 바뀌지 않았다.** 주간보고의 두 날짜는 지금까지와 똑같이
 * pickWeeklyReportOrderDates 가 고른 줄에서 오고, 그것은 고객 안내 현황이 고르는 줄과
 * **일부러 다르다**(domain/repair-case-domestic-order-dates.ts 머리말). 그래서 한 줄에
 * 「다른 줄에서 고른 날짜」와 「또 다른 줄에서 고른 번호」가 함께 실릴 수 있다 — 두 값이
 * 묻는 질문이 서로 다르기 때문이고(언제 견적이 처음 나갔나 / 지금 유효한 견적서가
 * 무엇인가), 번호 쪽을 날짜에 맞추면 이번에는 고객 안내 현황과 갈라진다.
 *
 * 🔴 공유폴더가 꺼져 있거나 못 읽어도 **던지지 않는다** — 그때 번호는 내자 정리 값만
 * 이거나 빈 배열이고, 화면은 지금까지처럼 날짜만 보인다(그 모듈의 머리말).
 *
 * 2026-10-04 까지는 세 번이었다 — 점검 대기와 점검 중을 **인수점검 결과 기록이
 * 있는가**로 갈라서, 그 유무를 읽는 질의가 하나 더 있었다. 이제 두 칸을 상태가
 * 직접 가르므로(도메인의 매핑표) 그 질의를 걷어냈다. 작업 기록 종류
 * INTAKE_INSPECTION_RESULT 자체는 그대로 살아 있다 — 수리 건 상세의 '인수점검
 * 결과'가 쓰는 값이고, 없어진 것은 **주간보고가 그것을 세던 일**뿐이다.
 *
 * 내자를 위 조인에 끼워 넣지 않는 이유는 **줄이 복제되기 때문**이다 — 한 건에
 * 내자 줄이 셋이면 그 건이 세 번 나오고, 집계가 통째로 어긋난다
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
      // 낙관적 잠금 값이다. 상세표의 `비고` 를 이 화면에서 고칠 수 있게 되면서
      // 필요해졌다 — 저장은 updateRepairCaseAction 의 expectedVersion 으로
      // 나가고, 그동안 남이 먼저 고쳤으면 CONFLICT 로 되돌아온다. 줄마다 이
      // 값이 실려 있지 않으면 낡은 화면에서 누른 저장이 방금 바뀐 값을 덮어쓴다.
      version: repairCases.version,
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
  const orderDatesByCaseId = await loadOrderDatesByCaseId(caseIds);

  // 🔴 견적서 **번호**는 고객 안내 현황과 **같은 함수**에서 나온다(파일 헤더의
  //    '견적서 번호는 날짜와 다른 길로 온다'). 날짜는 바로 위 orderDatesByCaseId
  //    그대로이고, 이 두 줄이 그것을 건드리지 않는다.
  const quoteInfo = await listQuoteInfoForRepairCases(caseIds);
  const archiveNumbers = await listArchiveQuoteNumbers(rows, quoteInfo);

  return rows.map((row) => ({
    ...row,
    ...(orderDatesByCaseId.get(row.id) ?? { quoteIssuedDate: null, orderIssuedDate: null }),
    quoteNumbers: repairCaseQuoteNumbers(
      quoteInfo.get(row.id)?.quoteNumber,
      archiveNumbers,
      row.lotNumber,
      row.serialNumber
    ),
  }));
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
