import "server-only";

import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "../client";
import {
  customers,
  domesticOrderDueDates,
  domesticOrders,
  products,
  repairCases,
} from "../schema";
import {
  resolveDomesticOrderCustomerRowColor,
  resolveDomesticOrderDeliveredDate,
  resolveDomesticOrderValue,
} from "@/lib/domain/domestic-order-list";

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
 * ── ⚠️ 납품일은 수리 건의 실제 출하일 하나뿐이다 ────────────────────────
 * 위 다섯과 **규칙이 다르다.** 화면의 `납품일` 은 연결된 수리 건의
 * `actual_shipment_date` 이고, 그 줄의 `delivered_date` 는 화면에 나오지 않는다.
 * 실제 출하일은 워크플로가 출하 완료 시점에 자동으로 찍는 값이라
 * (mutations/workflow-transitions.ts) 사람이 손으로 고칠 수 없고, "언제 나갔는가"에
 * 대해 이 시스템이 가진 유일한 사실이다. 고르는 규칙은 여기가 아니라 도메인
 * 함수가 갖는다(resolveDomesticOrderDeliveredDate — 그 함수 주석에 까닭이 있다).
 *
 * ⚠️ 그래도 `delivered_date` 는 **그대로 골라 온다.** 화면에 그리기 위해서가
 * 아니라 **되실어 보내기 위해서**다 — 이 화면의 저장은 모든 칼럼을 SET 하므로,
 * 목록이 이 값을 안 실어 오면 칸 하나를 고치는 저장 한 번에 그 칼럼이 지워진다
 * (domain/domestic-order-cell-edit.ts 의 파일 헤더).
 *
 * ── 납기 요청일만 질의가 하나 더 있다 ───────────────────────────────────
 * 한 줄에 날짜가 여럿일 수 있어 딸린 표에 있다(schema/domestic-order-due-dates.ts).
 * 위 조인에 끼워 넣지 않는 이유는 **줄이 복제되기 때문**이다 — 날짜가 세 개면
 * 그 발주 줄이 세 번 나오고, 목록의 건수도 금액 합계도 전부 어긋난다. 그래서
 * 보이는 줄의 id 를 모아 **한 번 더 읽고**(loadDueDatesByOrderId) 줄마다
 * 묶는다. 줄마다 읽는 N+1 이 아니다.
 *
 * ── 납기 요청일은 수리 건 상세정보에서도 읽는다 ─────────────────────────
 * 이 파일에 조회가 하나 더 있다(listDomesticOrderDueDatesForRepairCase). 내자
 * 정리 화면이 아니라 **수리 건 상세정보**가 부르는 조회인데, 여기 두는 이유는
 * 읽는 표가 내자 정리의 것이기 때문이다 — 그 표를 어떤 조건으로 읽어야 하는지
 * (지운 발주 줄은 세지 않는다)를 이 파일이 한 곳에서 갖는다. 저쪽 화면의
 * 조회 파일에 같은 SQL 을 한 벌 더 적으면, 언젠가 한쪽만 고쳐져 같은 자료가
 * 화면마다 다른 날짜로 보인다.
 *
 * ── PII ────────────────────────────────────────────────────────────────
 * progress_note · history_note · etc_note · delivered_by 는 사람이 자유롭게
 * 적는 값이라 담당자 이름이 섞일 수 있다. 부르는 쪽은 이 행을 그대로 로그에
 * 남기지 않는다(스키마 파일 헤더의 PII 항목).
 * ============================================================================
 */

/**
 * 한 줄에 달린 납기 요청일 하나.
 *
 * `requested_due_date` 칸 하나를 대신하는 값이다 — 분할 납품이면 한 건에
 * 날짜가 여럿이라 칸으로는 담을 수 없었다(schema/domestic-order-due-dates.ts).
 * 화면과 폼이 그대로 쓰는 모양이므로 전부 직렬화 가능한 값이다.
 */
export type DomesticOrderDueDate = {
  id: string;
  /** "YYYY-MM-DD". date 컬럼이라 문자열로 온다. */
  dueDate: string;
  /** "1차분" 같은 짧은 메모. 여러 날짜를 구분하는 유일한 단서다. */
  note: string | null;
  /** 사람이 정한 차례. 아래 조회가 이 순서로 내려보낸다. */
  displayOrder: number | null;
};

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
  /**
   * 이 행의 고객사에 정해 둔 줄 배경색(팔레트 키, customers.row_color).
   * 이름과 **짝을 이뤄** 실려 온다 — 어느 쪽 고객사를 쓸지는 아래 매퍼가
   * 정하고, 색은 그때 정해진 고객사를 그대로 따라가야 한다.
   */
  ownCustomerRowColor: string | null;
  modelNameText: string | null;
  lotNumberText: string | null;
  serialNumberText: string | null;
  faultDescriptionText: string | null;
  /**
   * 연결된 수리 건에서 따라온 값 다섯. 연결이 없으면 전부 null 이다.
   * 화면은 이 값을 그리지 않는다 — 폼이 흐린 글씨로 보여 주고, 아래 매퍼가
   * 이 행의 값이 비었을 때 대신 쓴다.
   */
  repairCaseCustomerName: string | null;
  /** 수리 건의 고객사에 정해 둔 줄 배경색. 위 ownCustomerRowColor 와 같은 짝이다. */
  repairCaseCustomerRowColor: string | null;
  repairCaseModelName: string | null;
  repairCaseLotNumber: string | null;
  repairCaseSerialNumber: string | null;
  repairCaseReportedSymptom: string | null;
  /**
   * 연결된 수리 건의 고객 요청 납기일.
   *
   * ⚠️ **아래 매퍼가 이 값을 접지 않는다.** 위 다섯과 달리 화면용 칸을 따로
   * 만들어 두지 않는다는 뜻이고, 그것이 일부러다 — 목록의 `납기요청일` 칸은
   * **딸린 표(dueDates)와 이 값 둘을 함께 보고** 그릴 때 정해지므로
   * (domain/requested-due-date-link.ts 의 resolveDomesticOrderDueDateDisplay),
   * 여기서 미리 하나로 접으면 화면은 그 날짜가 어느 쪽에서 왔는지 영영 알 수
   * 없고 "빌려 온 값"이라는 표시를 붙일 수 없게 된다.
   *
   * 내자의 납기 요청일(domestic_order_due_dates)은 **발주서에 적힌 날짜**이고
   * 이쪽은 **고객이 접수 때 말한 날짜**다 — 뜻이 다른 두 값이라, 이 줄에 날짜가
   * 하나라도 적혀 있으면 그쪽이 이긴다. 빌려 오는 것은 그 표가 통째로 비어
   * 있을 때뿐이다. 폼이 흐린 글씨 대신 안내 한 줄로 이 값을 보여 주는 것도
   * 같은 이유다(DomesticOrderEditForm).
   */
  repairCaseCustomerRequestedDueDate: string | null;
  /**
   * 연결된 수리 건의 **실제 출하일**. 화면의 `납품일` 이 이 값이다.
   *
   * 위 다섯과도, 바로 위 고객 요청 납기일과도 성질이 다르다 — 다섯은 이 행의
   * 값이 먼저이고, 고객 요청 납기일은 폼의 힌트일 뿐이며, 이것은 **목록이 그리는
   * 값 그 자체**다. 아래 매퍼가 displayDeliveredDate 로 접는다.
   *
   * 사람이 손으로 찍을 수 없는 값이라 여기 실려 오는 것 말고 다른 출처가 없다
   * (mutations/workflow-transitions.ts 가 출하 완료 때 자동으로 적는다).
   */
  repairCaseActualShipmentDate: string | null;
  displayOrder: number | null;
  purchaseOrderNumber: string | null;
  projectName: string | null;
  orderIssuedDate: string | null;
  /**
   * `requested_due_date` 는 **여기 없다.** 납기 요청일은 이제 딸린 표에 있고
   * (아래 DomesticOrderListItem 의 dueDates), 그 칸은 옮긴 값의 원본으로만
   * 남아 있다(schema/domestic-orders.ts 의 그 칸 주석). 함께 실어 내리면
   * 화면이 어느 쪽을 그려야 하는지 두 가지 답을 갖게 된다.
   */
  quoteIssuedDate: string | null;
  quoteNumber: string | null;
  progressNote: string | null;
  /**
   * ⚠️ **화면에 그리지 않는다.** 손으로 적던 시절의 값이고, 지금 `납품일` 로
   * 보이는 것은 위 repairCaseActualShipmentDate 다(파일 헤더).
   *
   * 그런데도 실어 오는 이유는 하나뿐이다 — **저장할 때 그대로 되돌려 보내기
   * 위해서.** 이 화면의 저장은 모든 칼럼을 SET 하므로 payload 에서 빠지면 그
   * 칼럼이 지워진다. 이 값을 지우는 것은 되돌릴 수 없는 일이라, 안 보여 주는
   * 것과 버리는 것은 다르게 다룬다.
   */
  deliveredDate: string | null;
  /** `납품일` 과 이름만 비슷한 다른 칸이다. 이쪽은 그대로 손으로 적는다. */
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
  /**
   * 위 customerName 으로 **정해진 바로 그 고객사**의 줄 배경색(팔레트 키).
   * 색이 없으면 null 이고, 화면은 그때 아무 색도 칠하지 않는다.
   *
   * 색 코드가 아니라 키다 — 클래스로 바꾸는 일은 화면 쪽이
   * domain/customer-row-color.ts 로 한다.
   */
  customerRowColor: string | null;
  /**
   * 화면의 `납품일` 에 그릴 날짜 — **연결된 수리 건의 실제 출하일**이다. 연결이
   * 없거나 아직 출하 기록이 없으면 null 이고, 화면이 "-"로 그린다.
   *
   * ⚠️ 위 다섯(customerName · modelName …)과 **이름은 비슷해도 규칙이 다르다.**
   * 저쪽은 이 행의 값이 먼저지만 이것은 수리 건 하나뿐이라, 원본 칸
   * (deliveredDate)에 값이 적혀 있어도 여기에는 섞이지 않는다
   * (resolveDomesticOrderDeliveredDate).
   *
   * ⚠️ **저장에 실으면 안 되는 계산된 값이다.** 이 이름으로 SET 을 만들 칼럼은
   * 없고, 원본 칸에 옮겨 담으면 자동으로 따라오던 값이 이 줄에 박제된다 —
   * domain/domestic-order-cell-edit.ts 의 DomesticOrderCellEditRow 에 이 칸이
   * 없는 것이 그 장치다(그 파일 헤더의 함정 ②와 같은 이유).
   */
  displayDeliveredDate: string | null;
  /**
   * 이 줄의 납기 요청일 전부. **차례대로**다(display_order → due_date).
   * 비어 있는 것이 정상이다 — 납기일이 아직 없는 줄이 실제로 있다.
   *
   * 화면 글자로 접는 일은 여기서 하지 않는다("첫 날짜 외 N건"은 보여 주는
   * 방식이지 자료가 아니다) — domain/domestic-order-list.ts 의 순수 함수가
   * 하고, 폼은 이 목록을 그대로 편집한다.
   */
  dueDates: DomesticOrderDueDate[];
};

/**
 * 행 → 화면용 타입. 순수 함수이고, 값을 꾸미지 않는다.
 *
 * 빈 값을 "-"로 바꾸는 일은 **여기서 하지 않는다.** "-"는 보여 주는 방식이지
 * 자료가 아니라서, 여기서 섞어 두면 다음 단계에서 이 함수를 수정 폼의 초기값에
 * 쓰는 순간 "-"라는 글자가 그대로 저장된다. 화면 쪽이 그릴 때만 바꾼다.
 */
export function mapDomesticOrderRow(
  row: DomesticOrderJoinRow,
  /**
   * 이 줄의 납기 요청일. 조인이 아니라 **따로 한 번 읽어** 넘긴다 — 조인하면
   * 날짜 수만큼 같은 줄이 복제돼 나오고, 그러면 이 매퍼가 접는 일까지
   * 떠맡아야 한다(그리고 금액 합계처럼 줄 수를 세는 쪽이 전부 어긋난다).
   */
  dueDates: DomesticOrderDueDate[]
): DomesticOrderListItem {
  return {
    ...row,
    dueDates,
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
    // 납품일도 위 다섯과 같은 규칙으로 **접지 않는다** — 이 행의
    // deliveredDate 는 보지 않고 수리 건의 실제 출하일만 본다(그 함수 주석).
    // row 를 통째로 넘기지 않는 것이 그 규칙을 코드로 못 박는 자리다.
    displayDeliveredDate: resolveDomesticOrderDeliveredDate({
      repairCaseActualShipmentDate: row.repairCaseActualShipmentDate,
    }),
    // 색은 위 다섯과 같은 규칙으로 **접지 않는다** — 이름을 고른 쪽의 고객사를
    // 그대로 따라간다(그 함수의 주석). 두 벌을 coalesce 하면 화면의 이름과 줄
    // 색이 서로 다른 고객사를 가리킬 수 있다.
    customerRowColor: resolveDomesticOrderCustomerRowColor(row),
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
      // 이름과 색은 늘 같은 고객사에서 함께 온다 — 별칭이 다르면 다른 고객사다.
      ownCustomerRowColor: orderCustomers.rowColor,
      modelNameText: domesticOrders.modelNameText,
      lotNumberText: domesticOrders.lotNumberText,
      serialNumberText: domesticOrders.serialNumberText,
      faultDescriptionText: domesticOrders.faultDescriptionText,
      // 연결된 수리 건에서 따라오는 다섯.
      repairCaseCustomerName: repairCaseCustomers.name,
      repairCaseCustomerRowColor: repairCaseCustomers.rowColor,
      repairCaseModelName: products.modelName,
      repairCaseLotNumber: products.lotNumber,
      repairCaseSerialNumber: products.serialNumber,
      repairCaseReportedSymptom: repairCases.reportedSymptom,
      // 접히지 않는 여섯 번째 값 — 목록의 `납기요청일` 칸이 딸린 표와 **함께**
      // 보고 정한다(위 타입 주석). 폼의 안내 한 줄도 이 값을 쓴다.
      repairCaseCustomerRequestedDueDate: repairCases.customerRequestedDueDate,
      // 화면의 `납품일` 이 되는 값. 아래 delivered_date 와 **짝이 아니라
      // 대신**이다(파일 헤더의 '납품일은 수리 건의 실제 출하일 하나뿐이다').
      repairCaseActualShipmentDate: repairCases.actualShipmentDate,
      displayOrder: domesticOrders.displayOrder,
      purchaseOrderNumber: domesticOrders.purchaseOrderNumber,
      projectName: domesticOrders.projectName,
      orderIssuedDate: domesticOrders.orderIssuedDate,
      // requested_due_date 는 고르지 않는다 — 납기 요청일은 아래에서 딸린
      // 표를 따로 읽어 온다(위 타입 주석).
      quoteIssuedDate: domesticOrders.quoteIssuedDate,
      quoteNumber: domesticOrders.quoteNumber,
      progressNote: domesticOrders.progressNote,
      // ⚠️ 화면에 그리지 않는 값인데도 고른다 — **저장이 되실어 보내야** 해서다.
      // 빼는 순간 칸 하나를 고치는 저장 한 번에 이 칼럼이 지워진다(위 타입 주석).
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

  const dueDatesByOrderId = await loadDueDatesByOrderId(rows.map((row) => row.id));

  return rows.map((row) => mapDomesticOrderRow(row, dueDatesByOrderId.get(row.id) ?? []));
}

/**
 * 여러 줄의 납기 요청일을 **질의 한 번으로** 걷어 와 줄마다 묶는다.
 *
 * ⚠️ 줄마다 한 번씩 읽으면(N+1) 열두 줄짜리 표에 열세 번의 왕복이 생기고, 그
 * 값은 줄이 늘어나는 만큼 그대로 늘어난다. 목록은 한 화면에 전부 그리는
 * 조회라 그 비용이 곧바로 보인다.
 *
 * 정렬은 차례(display_order) → 날짜다. 차례가 첫 기준인 것은 1차분·2차분처럼
 * **순서가 곧 뜻**이기 때문이고(schema/domestic-order-due-dates.ts), 비어 있는
 * 차례는 Postgres 의 ASC 기본값대로 뒤로 밀린다(NULLS LAST). 차례가 겹치거나
 * 비어 있을 때 순서가 매번 달라지지 않도록 날짜를 두 번째 기준으로 둔다 —
 * domestic_orders 목록이 created_at 을 두 번째로 두는 것과 같은 이유다.
 */
async function loadDueDatesByOrderId(
  orderIds: string[]
): Promise<Map<string, DomesticOrderDueDate[]>> {
  const grouped = new Map<string, DomesticOrderDueDate[]>();
  // inArray 에 빈 배열을 넘기면 뜻 없는 SQL 이 만들어진다. 읽을 줄이 없으면
  // 질의 자체를 하지 않는 것이 맞다.
  if (orderIds.length === 0) return grouped;

  const rows = await db
    .select({
      id: domesticOrderDueDates.id,
      domesticOrderId: domesticOrderDueDates.domesticOrderId,
      dueDate: domesticOrderDueDates.dueDate,
      note: domesticOrderDueDates.note,
      displayOrder: domesticOrderDueDates.displayOrder,
    })
    .from(domesticOrderDueDates)
    .where(inArray(domesticOrderDueDates.domesticOrderId, orderIds))
    .orderBy(asc(domesticOrderDueDates.displayOrder), asc(domesticOrderDueDates.dueDate));

  for (const row of rows) {
    const bucket = grouped.get(row.domesticOrderId);
    const item: DomesticOrderDueDate = {
      id: row.id,
      dueDate: row.dueDate,
      note: row.note,
      displayOrder: row.displayOrder,
    };
    if (bucket) bucket.push(item);
    else grouped.set(row.domesticOrderId, [item]);
  }
  return grouped;
}

/**
 * 그 수리 건에 붙어 있는 **내자 납기요청일 전부**. 없으면 빈 배열이다.
 *
 * 수리 건 상세정보의 `고객 요청 납기일` 이 비어 있을 때 대신 그릴 날짜를
 * 만드는 재료다. **고르는 일은 여기서 하지 않는다** — 여럿 중 하나를 고르는
 * 규칙은 domain/requested-due-date-link.ts 의
 * resolveRepairCaseRequestedDueDate 가 갖고, 그 함수는 다시 주간보고와 같은
 * pickEarliestDueDate 를 부른다. SQL 의 min() 으로 접으면 "지난 날짜라도 가장
 * 이르면 그것"이라는 승인된 결정을 시험할 자리가 사라지고, 주간보고
 * `입고 요청일` 과 조용히 어긋날 수 있다(queries/weekly-report-deliveries.ts 의
 * 같은 판단).
 *
 * ── 줄이 복제되지만 여기서는 그래도 된다 ────────────────────────────────
 * 한 수리 건에 내자 줄이 여럿이고(분할 발주 — repair_case_id 에 유일 제약이
 * 없다) 줄 하나에 날짜가 또 여럿이다(분할 납품). 이 조인은 그만큼 줄을
 * 복제하지만, **세는 질의가 아니라 날짜를 모으는 질의**라 복제된 줄은 같은
 * 묶음에 들어갈 뿐이다. 복제가 문제가 되는 것은 목록 쪽이고, 그래서 목록은
 * 조인 대신 따로 읽는다(위 loadDueDatesByOrderId).
 *
 * `is_deleted = false` 인 발주 줄의 날짜만 센다 — 화면에서 지운 줄에 붙어
 * 있던 날짜가 수리 건의 납기일을 만들어 내면, 어디에도 안 보이는 줄이 다른
 * 화면의 값을 정하는 셈이 된다(주간보고와 같은 규칙).
 *
 * 차례는 정하지 않는다. 부르는 쪽이 하는 일은 가장 이른 하루를 고르는 것뿐이고,
 * 그 판단은 받은 차례와 상관이 없다(pickEarliestDueDate 는 문자 그대로 min 이다).
 */
export async function listDomesticOrderDueDatesForRepairCase(
  repairCaseId: string
): Promise<string[]> {
  const rows = await db
    .select({ dueDate: domesticOrderDueDates.dueDate })
    .from(domesticOrderDueDates)
    .innerJoin(domesticOrders, eq(domesticOrderDueDates.domesticOrderId, domesticOrders.id))
    .where(
      and(eq(domesticOrders.isDeleted, false), eq(domesticOrders.repairCaseId, repairCaseId))
    );

  return rows.map((row) => row.dueDate);
}

/** 수정 폼의 '수리 건 연결' 목록에 들어갈 한 줄. */
export type RepairCaseLinkOption = {
  id: string;
  intakeNumber: string;
  customerName: string | null;
  modelName: string | null;
  /**
   * L/N · S/N · 고객 요청 납기일. 목록에 글자로 그리는 값이 아니다 —
   * **고르는 순간 폼이 그 건의 값을 흐린 글씨로 보여 주기 위한** 값이다.
   *
   * 목록 조회(listDomesticOrders)가 실어 오는 repairCase* 는 **저장돼 있는**
   * 연결의 값뿐이라, 드롭다운에서 다른 건을 고른 순간 화면에는 그 건에 대해
   * 아무 정보도 없다. 그때 옛 힌트를 그대로 두면 방금 고른 건의 값으로 읽히고,
   * 지우면 아무것도 안 보인다. 여기 함께 실어 오면 고르는 즉시 그 건의 값으로
   * 바뀐다.
   */
  lotNumber: string | null;
  serialNumber: string | null;
  customerRequestedDueDate: string | null;
};

/**
 * 연결할 수 있는 수리 건 목록.
 *
 * 폼에서 UUID 를 손으로 치게 할 수는 없다 — 사람이 아는 것은 인수번호이고,
 * 그 번호와 id 를 이어 주는 곳이 여기다. 고객사·형식을 함께 싣는 이유는 같은
 * 달에 비슷한 번호가 여럿이라 번호만으로는 어느 건인지 고르기 어렵기 때문이고,
 * 그 둘은 폼의 검색 칸이 걸러 내는 대상이기도 하다
 * (domain/repair-case-link-search.ts).
 *
 * L/N · S/N · 고객 요청 납기일은 **고른 뒤에** 쓰인다 — 위 타입 주석 참고.
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
      lotNumber: products.lotNumber,
      serialNumber: products.serialNumber,
      customerRequestedDueDate: repairCases.customerRequestedDueDate,
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
