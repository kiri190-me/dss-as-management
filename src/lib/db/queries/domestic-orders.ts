import "server-only";

import { asc, desc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "../client";
import { customers, domesticOrders, products, repairCases } from "../schema";
import { resolveDomesticOrderValue } from "@/lib/domain/domestic-order-list";

/**
 * ============================================================================
 * 내자 정리 목록 — 읽는 쪽
 * ============================================================================
 * 이 파일에는 **쓰기 함수가 없다.** 행을 추가·수정하는 일은 트랜잭션과 낙관적
 * 잠금이 필요해 mutations/domestic-orders.ts 가 맡는다(이 저장소의
 * queries/mutations 구분).
 *
 * ── 조인은 전부 LEFT JOIN 이다 ──────────────────────────────────────────
 * domestic_orders.repair_case_id 는 비어 있을 수 있다(schema/domestic-orders.ts
 * 의 '수리 건 연결은 비어 있어도 된다'). INNER JOIN 으로 적으면 **연결 없는
 * 줄이 목록에서 통째로 사라진다** — 그런 줄은 사람이 이어 붙여야 하는 줄인데,
 * 화면에 나오지 않으면 이어 붙일 수 없다는 사실조차 알 수 없다. 수리 건을
 * 거쳐 가는 products 도 같은 이유로 LEFT JOIN 이다.
 *
 * ── 고객사·형식·L/N·S/N·고장내역은 두 벌을 다 실어 온다 ─────────────────
 * 그 다섯은 두 곳에서 알 수 있다 — 이 행에 적힌 값(customer_id ·
 * model_name_text · lot_number_text · serial_number_text ·
 * fault_description_text), 그리고 연결된 수리 건에서 따라오는 값. 이 행에 적힌
 * 쪽이 먼저다: 수리 건 없는 줄에도 청구 상대와 제품은 있어야 하고, 둘이
 * 다르다면 그건 "이 발주는 이렇게 나갔다"는 이 표의 기록이 더 정확하다는
 * 뜻이다(스키마 파일 헤더의 '여기에도 있다').
 *
 * **어느 쪽을 쓸지는 SQL 이 정하지 않는다.** 예전에는 고객사만 coalesce 로
 * 접어 왔지만, 그렇게 하면 (1) 그 규칙을 시험할 자리가 없고, (2) 공백 한 칸이
 * 적힌 줄이 수리 건의 값을 조용히 가리며, (3) 화면이 그 값의 출처를 알 수
 * 없어 폼이 "연결된 수리 건에는 이렇게 적혀 있습니다"를 보여 줄 수 없다.
 * 그래서 이 질의는 **두 벌을 다 골라 오고**, 고르는 일은 아래 매퍼가
 * domain/domestic-order-list.ts 의 순수 함수로 한다.
 *
 * 수리 건에서 따라오는 값은 원본이 바뀌면 다음 조회에서 바로 따라간다 — 이
 * 행의 칸을 비워 두는 것이 기본인 이유가 그것이다.
 *
 * ── PII ────────────────────────────────────────────────────────────────
 * progress_note · history_note · etc_note · delivered_by 는 사람이 자유롭게
 * 적는 값이라 담당자 이름이 섞일 수 있다. 부르는 쪽은 이 행을 그대로 로그에
 * 남기지 않는다(스키마 파일 헤더의 PII 항목).
 * ============================================================================
 */

/**
 * customers 를 두 번 조인한다 — 이 행이 가리키는 고객사와, 연결된 수리 건이
 * 가리키는 고객사. 예전에는 coalesce 한 번으로 한쪽만 데려왔지만, 그러면 그
 * 이름이 어느 쪽에서 왔는지가 사라진다(파일 헤더의 '두 벌을 다 실어 온다').
 * 같은 표를 한 질의에서 두 번 조인하려면 별칭이 있어야 한다.
 */
const orderCustomers = alias(customers, "order_customers");
const repairCaseCustomers = alias(customers, "repair_case_customers");

/**
 * 아래 단 하나의 조인 질의가 내놓는 납작한 행. mappers/repair-case.ts 의
 * RepairCaseJoinRow 와 같은 규칙이다 — drizzle-orm 타입을 여기 들이지 않아서
 * 매퍼가 DB 의존 없는 순수 함수로 남고, Drizzle 의 행/테이블 타입이 이 파일
 * 밖으로 새어 나가지 않는다.
 */
export type DomesticOrderJoinRow = {
  id: string;
  /**
   * 낙관적 잠금 토큰. 화면이 수정 폼을 열 때 이 값을 들고 있다가 저장할 때
   * 그대로 돌려보내고, mutation 이 그 사이 값이 변했는지 대조한다
   * (mutations/domestic-orders.ts). 화면에 그리는 값은 아니다.
   */
  version: number;
  repairCaseId: string | null;
  /** 연결된 수리 건의 인수번호. 연결이 없으면 null 이다. */
  intakeNumber: string | null;
  /** 연결을 못 찾은 줄에 글자로 남아 있는 인수번호. */
  intakeNumberText: string | null;
  /**
   * 이 행에 적힌 값 다섯. 폼이 입력칸에 그대로 담는 값이고, 비어 있는 것이
   * 기본이다 — 비어 있으면 아래 repairCase* 를 따라간다.
   */
  customerId: string | null;
  /** 이 행의 customer_id 가 가리키는 고객사 이름. customerId 가 없으면 null. */
  ownCustomerName: string | null;
  modelNameText: string | null;
  lotNumberText: string | null;
  serialNumberText: string | null;
  faultDescriptionText: string | null;
  /**
   * 연결된 수리 건에서 따라온 값 다섯. 연결이 없으면 전부 null 이다.
   * 화면은 이 값을 그리지 않는다 — 폼이 회색 힌트로 보여 주고, 아래 매퍼가
   * 이 행의 값이 비었을 때 대신 쓴다.
   */
  repairCaseCustomerName: string | null;
  repairCaseModelName: string | null;
  repairCaseLotNumber: string | null;
  repairCaseSerialNumber: string | null;
  repairCaseReportedSymptom: string | null;
  displayOrder: number | null;
  purchaseOrderNumber: string | null;
  projectName: string | null;
  orderIssuedDate: string | null;
  requestedDueDate: string | null;
  quoteIssuedDate: string | null;
  quoteNumber: string | null;
  progressNote: string | null;
  deliveredDate: string | null;
  deliveredBy: string | null;
  taxInvoiceDate: string | null;
  /** numeric 컬럼 — 문자열로 읽는다(스키마 파일의 '금액은 numeric 이다'). */
  amountExcludingVat: string | null;
  paymentCompleted: boolean;
  japanRemittanceNote: string | null;
  historyNote: string | null;
  etcNote: string | null;
  /**
   * 완료 처리한 시각. 조회 결과에서는 Date 로 오지만 화면으로는 문자열로
   * 넘긴다(아래 DomesticOrderListItem) — repair-cases-mine.ts 의
   * lastActivityAt 이 같은 이유로 같은 모양이다.
   */
  completedAt: Date | string | null;
};

/** 화면이 받는 한 줄. 클라이언트 컴포넌트로 넘어가므로 전부 직렬화 가능한 값이다. */
export type DomesticOrderListItem = Omit<DomesticOrderJoinRow, "completedAt"> & {
  /**
   * 완료 처리한 시각(ISO 문자열). null 이면 진행 중이다 — 완료 여부의 판정은
   * 이 한 칸이 전부이고, 그 규칙은 domain/domestic-order-list.ts 가 갖는다.
   *
   * 화면은 이 값을 **날짜로 그리지 않는다.** 클라이언트에서 형식을 맞추면
   * 서버가 그린 것과 달라져 hydration 이 어긋나므로, 지금은 "완료인가 아닌가"로만
   * 쓴다.
   */
  completedAt: string | null;
  /**
   * 화면에 보여 줄 인수번호 — 연결된 수리 건의 것이 먼저고, 없으면 시트에
   * 적혀 있던 글자다. 둘 다 없으면 null 이고 화면이 "-"로 보여 준다.
   *
   * 두 값을 하나로 접어 두는 이유: 화면마다 "어느 쪽을 먼저 볼지"를 다시
   * 정하면 같은 행이 화면마다 다른 번호로 보인다. 원본 두 컬럼도 그대로
   * 남겨 둔다 — 연결이 있는 줄인지 아닌지는 여전히 구분되어야 한다.
   */
  displayIntakeNumber: string | null;
  /**
   * 정해진 값 다섯 — 이 행에 적힌 것이 먼저고, 없으면 연결된 수리 건의 것이다
   * (resolveDomesticOrderValue). 화면의 표와 카드가 그리는 것은 이 값이고,
   * 원본 두 벌도 위에 그대로 남아 있어 폼이 힌트를 그릴 수 있다.
   */
  customerName: string | null;
  modelName: string | null;
  lotNumber: string | null;
  serialNumber: string | null;
  reportedSymptom: string | null;
};

/**
 * 행 → 화면용 타입. 순수 함수이고, 값을 꾸미지 않는다.
 *
 * 빈 값을 "-"로 바꾸는 일은 **여기서 하지 않는다.** "-"는 보여 주는 방식이지
 * 자료가 아니라서, 여기서 섞어 두면 다음 단계에서 이 함수를 수정 폼의 초기값에
 * 쓰는 순간 "-"라는 글자가 그대로 저장된다. 화면 쪽이 그릴 때만 바꾼다.
 */
export function mapDomesticOrderRow(row: DomesticOrderJoinRow): DomesticOrderListItem {
  return {
    ...row,
    completedAt: row.completedAt ? new Date(row.completedAt).toISOString() : null,
    displayIntakeNumber: row.intakeNumber ?? row.intakeNumberText,
    // 다섯 칸 모두 같은 규칙으로 정한다 — 이 행의 값이 먼저, 없으면 수리 건의
    // 값(파일 헤더). 그 판단은 여기서 다시 적지 않고 도메인 함수를 부른다.
    customerName: resolveDomesticOrderValue(row.ownCustomerName, row.repairCaseCustomerName),
    modelName: resolveDomesticOrderValue(row.modelNameText, row.repairCaseModelName),
    lotNumber: resolveDomesticOrderValue(row.lotNumberText, row.repairCaseLotNumber),
    serialNumber: resolveDomesticOrderValue(row.serialNumberText, row.repairCaseSerialNumber),
    reportedSymptom: resolveDomesticOrderValue(
      row.faultDescriptionText,
      row.repairCaseReportedSymptom
    ),
  };
}

/**
 * 안 지워진 내자 정리 줄 전부.
 *
 * `WHERE is_deleted = false` 를 그대로 적는다 — 이 모양이어야 부분 인덱스
 * (domestic_orders_repair_case_id_not_deleted_idx)와 같은 조건이 되고, 나중에
 * 휴지통이 생겨도 이 조회는 그대로 둘 수 있다.
 *
 * 정렬은 순번(display_order) 오름차순, 그다음 등록순이다. 순번은 사람이 시트에
 * 적던 표시 순서라서 화면도 그 순서를 그대로 따라야 하고, 비어 있는 줄은
 * Postgres 의 ASC 기본값대로 뒤로 밀린다(NULLS LAST). 순번이 겹치거나 비어
 * 있을 때 순서가 매번 달라지지 않도록 created_at 을 두 번째 기준으로 둔다 —
 * 기준이 하나뿐이면 같은 화면을 새로 고칠 때마다 줄 순서가 바뀔 수 있다.
 */
export async function listDomesticOrders(): Promise<DomesticOrderListItem[]> {
  const rows = await db
    .select({
      id: domesticOrders.id,
      // 수정 폼이 저장할 때 되돌려 보낼 값이다. 목록에 그리지는 않지만,
      // 행을 눌러 폼을 여는 화면이라 목록과 같은 조회에 실려 와야 한다 —
      // 폼을 열 때 따로 한 번 더 읽으면 그 사이의 변경을 놓친다.
      version: domesticOrders.version,
      repairCaseId: domesticOrders.repairCaseId,
      intakeNumber: repairCases.intakeNumber,
      intakeNumberText: domesticOrders.intakeNumberText,
      // 이 행에 적힌 다섯. 폼이 입력칸에 담을 값이라 이름까지 함께 골라야
      // 한다 — id 만 내려보내면 화면이 고객사 이름을 그릴 수 없다.
      customerId: domesticOrders.customerId,
      ownCustomerName: orderCustomers.name,
      modelNameText: domesticOrders.modelNameText,
      lotNumberText: domesticOrders.lotNumberText,
      serialNumberText: domesticOrders.serialNumberText,
      faultDescriptionText: domesticOrders.faultDescriptionText,
      // 연결된 수리 건에서 따라오는 다섯.
      repairCaseCustomerName: repairCaseCustomers.name,
      repairCaseModelName: products.modelName,
      repairCaseLotNumber: products.lotNumber,
      repairCaseSerialNumber: products.serialNumber,
      repairCaseReportedSymptom: repairCases.reportedSymptom,
      displayOrder: domesticOrders.displayOrder,
      purchaseOrderNumber: domesticOrders.purchaseOrderNumber,
      projectName: domesticOrders.projectName,
      orderIssuedDate: domesticOrders.orderIssuedDate,
      requestedDueDate: domesticOrders.requestedDueDate,
      quoteIssuedDate: domesticOrders.quoteIssuedDate,
      quoteNumber: domesticOrders.quoteNumber,
      progressNote: domesticOrders.progressNote,
      deliveredDate: domesticOrders.deliveredDate,
      deliveredBy: domesticOrders.deliveredBy,
      taxInvoiceDate: domesticOrders.taxInvoiceDate,
      amountExcludingVat: domesticOrders.amountExcludingVat,
      paymentCompleted: domesticOrders.paymentCompleted,
      japanRemittanceNote: domesticOrders.japanRemittanceNote,
      historyNote: domesticOrders.historyNote,
      etcNote: domesticOrders.etcNote,
      // 완료된 줄을 회색으로 그리기 위한 값이다. completed_by 는 고르지
      // 않는다 — 화면에 그리지 않는 값이고, 사람 이름을 클라이언트로 더
      // 내려보낼 이유가 없다(스키마 헤더의 PII 항목).
      completedAt: domesticOrders.completedAt,
      // created_at 은 **고르지 않는다.** 정렬 기준으로만 쓰이고 화면에는
      // 나가지 않으므로, 골라 두면 클라이언트로 넘어가는 값만 늘어난다.
      // Drizzle 의 orderBy 는 select 목록에 없는 컬럼도 그대로 쓴다.
    })
    .from(domesticOrders)
    // 휴지통에 있는 수리 건이라도 연결은 살려 둔다 — 정산 줄은 그 건이
    // 지워졌다고 사라지지 않고(스키마의 SET NULL 주석), 화면에서도 사라지면
    // 안 된다.
    .leftJoin(repairCases, eq(repairCases.id, domesticOrders.repairCaseId))
    .leftJoin(products, eq(products.id, repairCases.productId))
    // 두 고객사를 각각 데려온다. 어느 쪽을 쓸지는 아래 매퍼가 정한다
    // (파일 헤더의 '어느 쪽을 쓸지는 SQL 이 정하지 않는다').
    .leftJoin(orderCustomers, eq(orderCustomers.id, domesticOrders.customerId))
    .leftJoin(repairCaseCustomers, eq(repairCaseCustomers.id, repairCases.customerId))
    .where(eq(domesticOrders.isDeleted, false))
    .orderBy(asc(domesticOrders.displayOrder), asc(domesticOrders.createdAt));

  return rows.map(mapDomesticOrderRow);
}

/** 수정 폼의 '수리 건 연결' 목록에 들어갈 한 줄. */
export type RepairCaseLinkOption = {
  id: string;
  intakeNumber: string;
  customerName: string | null;
  modelName: string | null;
};

/**
 * 연결할 수 있는 수리 건 목록.
 *
 * 폼에서 UUID 를 손으로 치게 할 수는 없다 — 사람이 아는 것은 인수번호이고,
 * 그 번호와 id 를 이어 주는 곳이 여기다. 고객사·형식을 함께 싣는 이유는 같은
 * 달에 비슷한 번호가 여럿이라 번호만으로는 어느 건인지 고르기 어렵기 때문이다.
 *
 * ── 휴지통에 있는 건은 뺀다 ─────────────────────────────────────────────
 * 이미 연결된 줄은 그 건이 지워져도 연결을 유지하지만(목록 조회의 LEFT JOIN
 * 주석), **새로 고르는** 목록에 지워진 건을 내밀 이유는 없다. 이미 지운 것을
 * 새로 이어 붙이는 일은 실수일 가능성이 훨씬 크다.
 *
 * 최신 인수번호가 위로 온다 — 방금 들어온 건을 연결하는 일이 대부분이다.
 * 인수번호는 D + 연월 + 일련번호라 사전순 내림차순이 곧 최신순이다.
 */
export async function listRepairCaseLinkOptions(): Promise<RepairCaseLinkOption[]> {
  return db
    .select({
      id: repairCases.id,
      intakeNumber: repairCases.intakeNumber,
      customerName: customers.name,
      modelName: products.modelName,
    })
    .from(repairCases)
    .leftJoin(customers, eq(customers.id, repairCases.customerId))
    .leftJoin(products, eq(products.id, repairCases.productId))
    .where(eq(repairCases.isDeleted, false))
    .orderBy(desc(repairCases.intakeNumber));
}

/** 수정 폼의 '고객사' 목록에 들어갈 한 줄. */
export type CustomerOption = {
  id: string;
  name: string;
};

/**
 * 고를 수 있는 고객사 목록.
 *
 * 수리 건 목록(위)과 같은 모양이고 같은 이유로 있다 — 사람이 아는 것은 고객사
 * 이름이지 UUID 가 아니다.
 *
 * ── 휴지통에 있는 고객사는 뺀다 ─────────────────────────────────────────
 * 이미 그 고객사가 적혀 있는 줄은 그대로 두지만(목록 조회는 is_deleted 를 보지
 * 않고 이름을 그대로 데려온다), **새로 고르는** 목록에 지워진 고객사를 내밀
 * 이유는 없다. listRepairCaseLinkOptions 가 지워진 수리 건을 빼는 것과 같은
 * 판단이다.
 *
 * 이름순이다. 수리 건과 달리 "방금 들어온 것"이라는 순서가 없고, 사람은 아는
 * 이름을 목록에서 눈으로 찾는다.
 */
export async function listCustomerOptions(): Promise<CustomerOption[]> {
  return db
    .select({ id: customers.id, name: customers.name })
    .from(customers)
    .where(eq(customers.isDeleted, false))
    .orderBy(asc(customers.name));
}
