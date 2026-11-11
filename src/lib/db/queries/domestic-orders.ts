import "server-only";

import { cache } from "react";
import { and, asc, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "../client";
import {
  customers,
  domesticOrderDueDates,
  domesticOrders,
  products,
  quoteItems,
  quotes,
  repairCases,
  users,
  workflowSteps,
} from "../schema";
import {
  formatQuoteSupplyAmount,
  quoteSupplyAmountOf,
  type QuoteAmountLine,
} from "@/lib/domain/quote-list";
import {
  resolveDomesticOrderCustomerRowColor,
  resolveDomesticOrderValue,
} from "@/lib/domain/domestic-order-list";
import { resolveDomesticOrderDeliveryDisplay } from "@/lib/domain/delivered-date-link";
import type { RepairCaseDomesticOrderIssueDateRow } from "@/lib/domain/domestic-order-issue-date-edit";
import type { RepairStatus } from "@/lib/domain/types";

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
 * ── 🔴 납품일·납품자는 **납기요청일 행에 있다** (2026-11-08) ───────────────
 * 2026-09-11 까지는 「연결된 줄의 납품일은 수리 건의 실제 출하일 하나뿐」이었고
 * 그 줄의 `delivered_date` 는 값이 있어도 안 그렸다. 🔴 **지금은 둘 다 다르다** —
 * 납품일·납품자가 `domestic_order_due_dates` 의 행마다 하나씩 달려 있고(분할
 * 납품), 수리 건의 실제 출하일과는 **양방향으로 맞춰진다**(사용자 결정 2).
 *
 * 그래서 이 조회가 그릴 값으로 내놓는 것은 날짜 하나가 아니라 **행마다 하나씩
 * 늘어놓은 목록 둘**이다(아래 deliveredDateLines · deliveredByLines). 아무 행에도
 * 안 적혀 있으면 연결된 수리 건의 실제 출하일을 빌려 그리고 거기엔 꼬리표가
 * 붙는다 — 고르는 규칙은 여기가 아니라 도메인 함수 하나가 갖는다
 * (domain/delivered-date-link.ts 의 resolveDomesticOrderDeliveryDisplay).
 *
 * ⚠️ 그래도 `delivered_date`·`delivered_by` **칼럼은 늘 골라 온다.** 🔴 **그릴
 * 값이 아니라 되실어 보내야 하는 값**이다 — 이 화면의 저장은 모든 칼럼을 SET
 * 하므로, 목록이 이 값을 안 실어 오면 칸 하나를 고치는 저장 한 번에 그 칼럼이
 * 지워진다(domain/domestic-order-cell-edit.ts 의 파일 헤더). 그 칼럼을 PO
 * 시스템(dss-po)이 같은 DB 에서 쓰므로 지우지 않았다(사용자 결정 11).
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
 * ── 화면에 그리지 않는데도 실어 오는 칸이 셋 있다 ───────────────────────
 * 연결된 수리 건의 **실제 출하일 · 사내 목표 완료일 · 지금 상태**다. 첫째는 위
 * `납품일` 이 되지만, 뒤의 둘은 어느 칸으로도 그려지지 않는다 — 그 둘은
 * `납기요청일` 칸의 **색과 메모**를 정하는 재료다(2026-10-30 「납기 역전」:
 * 사내 목표 완료일이 그 칸에 보이는 날짜보다 늦으면 굵은 붉은색 + 「협의 필요」).
 *
 * 🔴 **셋을 한 묶음으로 본다.** 역전 경보는 이미 나간 건에 뜨지 않고, 「나갔는가」는
 * 상태와 실제 출하일 둘을 함께 봐야 안다(domain/shipment-finished.ts 의
 * isRepairCaseShipmentFinished). 하나라도 빠지면 오류 없이 **지난 건에 붉은 글이
 * 남거나** 살아 있는 건의 경보가 조용히 꺼진다 — 판정 자체는
 * domain/due-date-inversion.ts 하나가 쥐고, 여기는 재료만 싣는다.
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
  /**
   * 🔴 그 회차를 **실제로 보낸 날**(2026-11-08). null 이면 아직 안 보냈다.
   *
   * 위 dueDate 와 뜻이 다른 날짜다 — 저쪽은 「언제까지 달라고 했는가」, 이쪽은
   * 「언제 보냈는가」. 한 행에 나란히 있는 것이 **사용자 결정 1**(1번 줄 ↔ 1번 줄)
   * 그대로이고, 그래서 둘을 잇는 규칙을 코드 어디에도 적을 필요가 없다.
   */
  deliveredDate: string | null;
  /** 그 회차를 보낸 사람. 🔴 PII — 로그·오류 보고에 그대로 싣지 않는다. */
  deliveredBy: string | null;
  /**
   * 🔴 그 회차를 **[완료 처리]한 시각**(ISO 문자열). null 이면 아직 안 끝났다
   * (2026-11-08, 사용자 결정 7).
   *
   * 🔴 **판정은 이 한 칸이 전부다** — 부모 줄의 `completedAt` 과 같은 규칙이다.
   * 화면은 이 값을 **날짜로 그리지 않는다**(클라이언트에서 형식을 맞추면 서버가
   * 그린 것과 달라져 hydration 이 어긋난다). 지금 쓰임은 「완료인가 아닌가」뿐이다.
   */
  completedAt: string | null;
  /** 그 회차를 완료 처리한 사람의 id. 🔴 이름이 아니라 id 다 — 화면이 그리지 않는다. */
  completedBy: string | null;
  /** 사람이 정한 차례. 아래 조회가 이 순서로 내려보낸다. */
  displayOrder: number | null;
};

/**
 * customers 를 두 번 조인한다 — 이 행이 가리키는 고객사와, 연결된 수리 건이
 * 가리키는 고객사. 예전에는 coalesce 한 번으로 한쪽만 데려왔지만, 그러면 그
 * 이름이 어느 쪽에서 왔는지가 사라진다(파일 헤더의 '두 벌을 다 실어 온다').
 * 같은 표를 한 질의에서 두 번 조인하려면 별칭이 있어야 한다.
 */
/**
 * 연결된 견적서. 지워진 견적서는 조인하지 않는다 — 휴지통에 있는 문서의
 * 번호·금액이 내자 표에 계속 보이면, 그 값이 어디서 왔는지 설명할 수 없다.
 */
const linkedQuotes = alias(quotes, "linked_quotes");

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
   * 연결된 수리 건의 **실제 출하일**. 연결된 줄의 화면 `납품일` 이 이 값이다.
   *
   * 위 다섯과도, 바로 위 고객 요청 납기일과도 성질이 다르다 — 다섯은 이 행의
   * 값이 먼저이고, 고객 요청 납기일은 폼의 힌트일 뿐이며, 이것은 연결된 줄에서
   * **목록이 그리는 값 그 자체**다. 아래 매퍼가 displayDeliveredDate 로 접는다
   * (연결 없는 줄은 아래 deliveredDate 를 쓴다).
   *
   * 사람이 손으로 찍을 수 없는 값이라 여기 실려 오는 것 말고 다른 출처가 없다
   * (mutations/workflow-transitions.ts 가 출하 완료 때 자동으로 적는다).
   */
  repairCaseActualShipmentDate: string | null;
  /**
   * 연결된 수리 건의 **사내 목표 완료일**. 화면에 그리는 값이 **아니다** — 내자
   * 정리의 표에는 이 칸이 없고, 앞으로도 칼럼을 늘리지 않는다.
   *
   * 실어 오는 까닭은 **`납기요청일` 칸의 색을 정하는 재료**이기 때문이다(2026-10-30).
   * 이 날짜가 그 칸에 보이는 날짜보다 늦으면 「납기 역전」이라 날짜가 굵은 붉은색이
   * 되고 「협의 필요」가 붙는다(domain/due-date-inversion.ts 의
   * isDomesticOrderDueDateInverted). 수리 건 상세가 같은 사실을 같은 함수로 재므로
   * 두 화면이 갈라지지 않는다.
   *
   * ⚠️ **저장에 실리지 않는다.** 이 행의 칼럼이 아니라 수리 건의 칸이고, 내자 저장이
   * 되실어 보내는 목록에 들어 있지 않다(domain/domestic-order-cell-edit.ts 의
   * collectRowFields — 거기 적힌 이름만 나간다).
   */
  repairCaseInternalTargetShipmentDate: string | null;
  /**
   * 연결된 수리 건의 **평탄화된 지금 상태**(workflow_steps.repair_status). 연결이
   * 없거나 단계에 상태가 안 적혀 있으면 null 이고, 그때는 「아직 안 나갔다」로 읽힌다.
   *
   * 바로 위 두 칸과 **한 묶음**이다 — 역전 경보는 이미 나간 건에는 뜨지 않고
   * (2026-10-30 사용자 결정), 「나갔는가」는 상태와 실제 출하일 **둘**을 함께 봐야
   * 안다(domain/shipment-finished.ts 의 isRepairCaseShipmentFinished). 상태 하나만 보면
   * 출하일은 찍혔는데 단계가 못 따라간 건에 경보가 남고, 날짜 하나만 보면 그 반대가
   * 샌다.
   *
   * 단계 key 를 글자로 비교하지 않는 것은 워크플로마다 key 가 다르기 때문이고, 이
   * 저장소가 「지금 출하 완료인가」를 묻는 다른 자리들과 같은 기준이다
   * (아래 getDomesticOrderShipmentLink · queries/weekly-report.ts ·
   * queries/repair-cases-mine.ts).
   */
  repairCaseStatus: RepairStatus | null;
  displayOrder: number | null;
  purchaseOrderNumber: string | null;
  projectName: string | null;
  orderIssuedDate: string | null;
  /**
   * `requested_due_date` 는 **여기 없다.** 납기 요청일은 이제 딸린 표에 있고
   * (아래 DomesticOrderListItem 의 dueDates), 그 칸은 옮긴 값의 원본으로만
   * 남아 있다(schema/domestic-orders.ts 의 그 칸 주석). 함께 실어 내리면
   * 화면이 어느 쪽을 그려야 하는지 두 가지 답을 갖게 된다.
   *
   * 이 줄에 **손으로 적은** 견적발행일 · 견적서번호(원본 칸). 아래
   * amountExcludingVat 과 함께 셋이다.
   *
   * ⚠️ 견적서가 연결된 줄에서는 화면에 그리지 않는다 — 그 줄은 견적서 값을
   * 그리고, 어느 쪽을 그릴지는 매퍼가 display* 셋으로 고른다
   * (DomesticOrderListItem). 그래도 **덮지 않고 원본 그대로** 싣는 이유는
   * deliveredDate 와 같다 — 이 화면의 저장은 모든 칼럼을 SET 하므로, 여기
   * 견적서 값이 실려 있으면 칸 하나 고치는 저장에 손 값이 견적서 값으로 바뀌고
   * 연결을 풀어도 옛 값이 돌아오지 않는다(2026-09-13 까지 실제로 그랬다).
   */
  quoteIssuedDate: string | null;
  quoteNumber: string | null;
  /**
   * 연결된 견적서(2026-08-28). 아래 두 칸은 그 견적서에서 온 값이고, 매퍼가
   * 이것으로 display* 셋을 정한다(mapDomesticOrderRow 의 머리말) — 위 원본
   * 칸은 덮지 않는다. 연결이 없으면 셋 다 null 이고, 그 견적서가 휴지통에
   * 있으면 quoteId 는 남고 아래 두 칸만 null 이다(조인 조건).
   */
  quoteId: string | null;
  linkedQuoteNumber: string | null;
  linkedQuoteDate: string | null;
  progressNote: string | null;
  /**
   * 🔴 **옛 자리의 납품일**(2026-11-08 부터 A/S 는 그리지 않는다).
   *
   * 화면에 보이는 납품일은 이 칸이 아니라 **납기요청일 행에 달린 값**이다
   * (위 deliveredDateLines). 이 칸을 그리는 자리는 A/S 에 **한 곳도 없다.**
   *
   * 그래도 실어 오는 이유 — **저장할 때 그대로 되돌려 보내기 위해서.** 이 화면의
   * 저장은 모든 칼럼을 SET 하므로 payload 에서 빠지면 그 칼럼이 지워진다. 🔴 그
   * 칼럼을 PO 시스템(dss-po)이 같은 DB 에서 쓰므로(사용자 결정 11) 안 보여 주는
   * 것과 버리는 것은 전혀 다른 일이다.
   */
  deliveredDate: string | null;
  /** 옛 자리의 납품자. 위와 **같은 까닭으로** 실려 다닌다(A/S 는 안 그린다 · PO 가 쓴다). */
  deliveredBy: string | null;
  taxInvoiceDate: string | null;
  /**
   * 이 줄에 **손으로 적은** 금액(원본 칸). 위 quoteNumber 와 같은 이유로 견적서
   * 값으로 덮지 않는다 — 화면이 그리는 것은 displayAmountExcludingVat 다.
   *
   * numeric 컬럼 — 문자열로 읽는다(스키마 파일의 '금액은 numeric 이다').
   */
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
   * 화면의 `납품일`·`납품자` 에 그릴 것 — **납기요청일 행마다 하나씩**이다
   * (2026-11-08). 두 목록은 **길이가 같고 자리가 맞는다**: 1번 줄의 납기요청일
   * 옆이 1번 줄의 납품일이고 1번 줄의 납품자다. 안 적은 회차는 null 이고 화면이
   * "-"로 그린다.
   *
   * 아무 행에도 안 적혀 있으면 연결된 수리 건의 실제 출하일 하나를 빌려 그리고,
   * 그때 `deliveredDateBorrowed` 가 참이다 — 화면은 **그때만** 꼬리표를 붙인다
   * (domain/delivered-date-link.ts 의 DELIVERED_DATE_FROM_REPAIR_CASE_LABEL).
   * 양쪽 다 없으면 두 목록이 비고, 화면이 "-" 하나를 그린다.
   *
   * ⚠️ 위 다섯(customerName · modelName …)과 **규칙이 다르다.** 저쪽은 이 행의
   * 값이 먼저이고 비면 수리 건 값으로 메우지만, 이것은 **섞이지 않는다** — 행에
   * 하나라도 적혀 있으면 그것이 전부다.
   *
   * ⚠️ **저장에 실으면 안 되는 계산된 값이다.** 이 이름으로 SET 을 만들 칼럼은
   * 없고, 빌려 온 날짜를 행에 옮겨 담으면 아무도 적지 않은 날짜가 그 줄에
   * 박제된다 — domain/domestic-order-cell-edit.ts 의 DomesticOrderCellEditRow 에
   * 이 셋이 없는 것이 그 장치다(그 파일 헤더의 함정 ②와 같은 이유).
   */
  deliveredDateLines: (string | null)[];
  deliveredByLines: (string | null)[];
  deliveredDateBorrowed: boolean;
  /**
   * 화면의 견적서번호 · 견적발행일 · 금액(VAT별도)에 그릴 값 — **연결된 견적서의
   * 값이 먼저**, 없으면 이 줄에 손으로 적은 값이다(mapDomesticOrderRow 의 머리말).
   * 견적서가 휴지통에 있으면 조인이 null 을 주므로 손 값이 된다. 검색도 이 값을
   * 본다(domain/domestic-order-list.ts 의 DomesticOrderSearchable).
   *
   * ⚠️ **저장에 실으면 안 되는 계산된 값이다** — displayDeliveredDate 와 같은
   * 이유다. 원본 칸(quoteNumber · quoteIssuedDate · amountExcludingVat)에 옮겨
   * 담으면 손으로 적은 값이 견적서 값으로 바뀌어, 연결을 풀어도 돌아오지 않는다.
   * domain/domestic-order-cell-edit.ts 의 DomesticOrderCellEditRow 에 이 셋이
   * 없는 것이 그 장치다.
   */
  displayQuoteNumber: string | null;
  displayQuoteIssuedDate: string | null;
  /** numeric — 문자열이다. 견적서 쪽 값은 소수 두 자리로 고정돼 온다(loadQuoteAmounts). */
  displayAmountExcludingVat: string | null;
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
/**
 * 견적서번호 · 견적발행일 · 금액은 연결된 견적서가 있으면 **그쪽이 이긴다** —
 * 이기는 자리는 display* 셋이고, 원본 칸은 덮지 않는다.
 *
 * 이 표의 다른 칸들은 '이 행의 값이 먼저, 없으면 연결된 쪽'인데 이 셋만
 * 방향이 반대다. 이유는 견적서 쪽이 더 정확하기 때문이다 — 금액은 부품 줄에서
 * 계산되고, 번호·발행일은 실제로 발행된 문서의 값이다. 손으로 적은 값은 그
 * 문서가 없던 시절의 기록이고, **지우지 않으므로 연결을 풀면 다시 보인다**
 * (schema/domestic-orders.ts 의 quote_id 주석).
 *
 * ⚠️ 그 약속은 원본 칸(quoteNumber · quoteIssuedDate · amountExcludingVat)을
 * **덮지 않아야** 지켜진다. 이 화면의 저장은 줄 전체를 되실어 보내 모든 칼럼을
 * SET 하므로, 원본 칸 이름에 견적서 값을 실어 두면 칸 하나 고치는 저장에 손
 * 값이 견적서 값으로 바뀐다. 2026-09-13 까지 이 매퍼가 그렇게 덮었다 — 그동안
 * 저장된 연결된 줄은 되살릴 원본이 없다. 그래서 계산된 값은 이름을 가른다
 * (deliveredDate / displayDeliveredDate 와 같은 모양).
 */
export function mapDomesticOrderRow(
  row: DomesticOrderJoinRow,
  /**
   * 이 줄의 납기 요청일. 조인이 아니라 **따로 한 번 읽어** 넘긴다 — 조인하면
   * 날짜 수만큼 같은 줄이 복제돼 나오고, 그러면 이 매퍼가 접는 일까지
   * 떠맡아야 한다(그리고 금액 합계처럼 줄 수를 세는 쪽이 전부 어긋난다).
   */
  dueDates: DomesticOrderDueDate[],
  /**
   * 연결된 견적서의 공급가(부품 줄 합 + 작업비). 연결이 없거나 그 견적서가
   * 휴지통에 있으면 null 이고, 그때는 이 행에 손으로 적은 금액을 쓴다.
   */
  linkedQuoteAmount: string | null = null
): DomesticOrderListItem {
  // 🔴 납품 둘을 **한 번에** 정한다 — 따로 부르면 「무엇이 적혀 있는가」를 두 번
  // 판정하게 되고, 납품자만 적힌 줄에서 두 칸의 줄 수가 어긋나 표가 세로로
  // 밀린다(그 함수 주석).
  const delivery = resolveDomesticOrderDeliveryDisplay({
    dueDates,
    repairCaseId: row.repairCaseId,
    repairCaseActualShipmentDate: row.repairCaseActualShipmentDate,
  });
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
    // 🔴 납품 둘은 위 다섯과 같은 규칙으로 **접지 않는다** — 행에 하나라도
    // 적혀 있으면 그것이 전부이고, 아무 행에도 없을 때만 연결된 수리 건의 실제
    // 출하일을 빌린다(2026-11-08). 옛 칼럼(row.deliveredDate)은 **넘기지 않는다**:
    // 그 함수가 받는 타입에 그 칸이 아예 없는 것이 「A/S 는 옛 자리를 안 그린다」를
    // 코드로 못 박는 자리다.
    deliveredDateLines: delivery.dates,
    deliveredByLines: delivery.people,
    deliveredDateBorrowed: delivery.borrowed,
    // 색은 위 다섯과 같은 규칙으로 **접지 않는다** — 이름을 고른 쪽의 고객사를
    // 그대로 따라간다(그 함수의 주석). 두 벌을 coalesce 하면 화면의 이름과 줄
    // 색이 서로 다른 고객사를 가리킬 수 있다.
    customerRowColor: resolveDomesticOrderCustomerRowColor(row),
    // 위 '연결된 견적서가 있으면 그쪽이 이긴다'. ...row 로 들어온 원본 칸(손
    // 값)은 **덮지 않는다** — 저장이 그 값을 그대로 되실어 보내야 한다(머리말).
    // 견적서 값이 없으면(연결 없음 · 휴지통) 손 값이 그대로 그려진다.
    displayQuoteNumber: row.linkedQuoteNumber ?? row.quoteNumber,
    displayQuoteIssuedDate: row.linkedQuoteDate ?? row.quoteIssuedDate,
    displayAmountExcludingVat: linkedQuoteAmount ?? row.amountExcludingVat,
  };
}

/**
 * 내자 정리 한 줄을 읽는 **단 하나의 조인**. `where` 도 `orderBy` 도 붙이지
 * 않은 채로 돌려준다 — 거르는 조건은 부르는 쪽이 정한다.
 *
 * 🔴 **떼어 둔 까닭**(2026-11-06): 「기타건 상세」가 같은 줄 **하나**를 읽어야
 * 하는데, 그 자리에 select 목록을 한 벌 더 적으면 칸이 하나 늘 때마다 두 곳을
 * 고쳐야 하고 — 한쪽을 빠뜨려도 tsc 가 아니라 **화면의 빈칸**으로만 드러난다.
 * 목록이 그리는 값과 상세가 그리는 값이 갈라지면 [형식]을 눌러 들어온 사람이
 * 방금 본 줄과 다른 값을 보게 된다. 그래서 조인도 매퍼도 한 벌이다.
 *
 * 떼면서 select 목록은 **한 글자도 바꾸지 않았다.**
 */
function selectDomesticOrderJoinRows() {
  return db
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
      // 연결된 줄의 화면 `납품일` 이 되는 값. 아래 delivered_date 와 **섞이지
      // 않는다** — 연결된 줄은 이것만, 연결 없는 줄은 delivered_date 만 본다
      // (파일 헤더의 '연결된 줄의 납품일은 수리 건의 실제 출하일 하나뿐이다').
      repairCaseActualShipmentDate: repairCases.actualShipmentDate,
      // 「납기 역전」을 재는 재료 둘(2026-10-30). 화면에 그리는 값이 아니라
      // `납기요청일` 칸의 **색과 메모**를 정하는 값이다 — 빠지면 그 칸은 오류 없이
      // 영영 평범한 검은 글자로 남는다(위 타입 주석).
      repairCaseInternalTargetShipmentDate: repairCases.internalTargetShipmentDate,
      repairCaseStatus: workflowSteps.repairStatus,
      displayOrder: domesticOrders.displayOrder,
      purchaseOrderNumber: domesticOrders.purchaseOrderNumber,
      projectName: domesticOrders.projectName,
      orderIssuedDate: domesticOrders.orderIssuedDate,
      // requested_due_date 는 고르지 않는다 — 납기 요청일은 아래에서 딸린
      // 표를 따로 읽어 온다(위 타입 주석).
      quoteIssuedDate: domesticOrders.quoteIssuedDate,
      quoteNumber: domesticOrders.quoteNumber,
      // 연결된 견적서. 있으면 화면은 손으로 적은 값 대신 이 견적서의 값을
      // 그린다 — 매퍼의 display* 셋이고, 위 원본 두 칸은 덮지 않는다
      // (schema/domestic-orders.ts 의 quote_id 주석 — 이 표에서 방향이
      // 반대인 유일한 칸들이다).
      quoteId: domesticOrders.quoteId,
      linkedQuoteNumber: linkedQuotes.quoteNumber,
      linkedQuoteDate: linkedQuotes.quoteDate,
      progressNote: domesticOrders.progressNote,
      // 🔴 **옛 자리다 — 어느 화면도 그리지 않는데 고른다**(2026-11-08). 까닭은
      // 하나, **저장이 되실어 보내야** 해서다: 빼는 순간 칸 하나를 고치는 저장 한
      // 번에 이 칼럼이 지워지고, 그 칼럼을 PO 가 쓴다(위 타입 주석).
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
    // 지금 단계. **LEFT 다** — 연결이 없는 줄도, 단계를 아직 못 찾은 건도 줄이
    // 통째로 사라지면 안 된다(그 줄은 사람이 이어 붙여야 하는 줄이다). 그때
    // repairCaseStatus 는 null 이고 「아직 안 나갔다」로 읽힌다(위 그 칸 주석).
    // ⚠️ 줄이 복제되지 않는다 — workflow_steps.id 는 기본키라 짝이 많아야 하나다
    // (납기요청일을 조인하지 않고 따로 읽는 까닭이 바로 그 복제다 — 파일 헤더).
    .leftJoin(workflowSteps, eq(workflowSteps.id, repairCases.currentWorkflowStepId))
    // 두 고객사를 각각 데려온다. 어느 쪽을 쓸지는 아래 매퍼가 정한다
    // (파일 헤더의 '어느 쪽을 쓸지는 SQL 이 정하지 않는다').
    .leftJoin(orderCustomers, eq(orderCustomers.id, domesticOrders.customerId))
    .leftJoin(repairCaseCustomers, eq(repairCaseCustomers.id, repairCases.customerId))
    .leftJoin(
      linkedQuotes,
      and(eq(linkedQuotes.id, domesticOrders.quoteId), eq(linkedQuotes.isDeleted, false))
    );
}

/**
 * 조인이 내놓은 납작한 줄들에 **딸린 표와 견적서 금액을 붙여** 화면용 줄로 만든다.
 *
 * 질의 둘을 더 돌리는 자리이고, 둘 다 **줄 수와 무관하게 한 번씩**이다 — 줄마다
 * 읽으면 N+1 이다. 목록(수백 줄)과 상세(한 줄)가 같은 길을 쓰므로, 상세에서는
 * 결국 값 하나짜리 `IN (…)` 질의가 된다.
 */
async function attachDomesticOrderExtras(
  rows: DomesticOrderJoinRow[]
): Promise<DomesticOrderListItem[]> {
  const dueDatesByOrderId = await loadDueDatesByOrderId(rows.map((row) => row.id));
  // 연결된 견적서의 금액도 **질의 한 번으로** 걷어 온다 — 줄마다 읽으면 N+1 이다.
  const quoteAmounts = await loadQuoteAmounts(
    rows.map((row) => row.quoteId).filter((id): id is string => id !== null)
  );

  return rows.map((row) =>
    mapDomesticOrderRow(
      row,
      dueDatesByOrderId.get(row.id) ?? [],
      row.quoteId ? quoteAmounts.get(row.quoteId) ?? null : null
    )
  );
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
  const rows = await selectDomesticOrderJoinRows()
    .where(eq(domesticOrders.isDeleted, false))
    .orderBy(asc(domesticOrders.displayOrder), asc(domesticOrders.createdAt));

  return attachDomesticOrderExtras(rows);
}

/**
 * 「기타건 현황」이 읽는 줄 — **수리 건이 붙지 않은, 안 지워진 내자 줄 전부**
 * (2026-11-06).
 *
 * 🔴 **「기타건」의 정의가 이 `where` 한 줄이다.** 수리 건이 붙었는지는
 * `repair_case_id` 로만 가른다 — 인수번호 글자(`intake_number_text`)가 아니다.
 * 그 글자는 **연결을 못 찾은 줄에도 남아 있어서**(schema/domestic-orders.ts 의
 * 그 칸 주석), 그것으로 가르면 수리 건과 이어지지 않은 줄이 조용히 사라진다.
 * 목록의 [형식] 링크를 세우는 규칙도 같은 칸 하나를 본다
 * (domain/domestic-order-detail-link.ts) — 두 곳이 같은 기준이라야 「링크가 선
 * 줄」과 「이 목록에 뜨는 줄」이 같아진다.
 *
 * 🔴 **휴지통에 든 줄은 섞이지 않는다**(`is_deleted = false`). 내자 정리 목록 ·
 * 기타건 상세가 쓰는 것과 같은 조건이고, 지운 줄에 링크를 세우면 전부 404 다
 * (getDomesticOrderDetail 의 같은 주석).
 *
 * ── 🔴 차례는 **발행일자 내림차순**이고, 화면도 같은 차례로 다시 세운다 ──────
 * `coalesce` 로 세우는 까닭: 화면의 `발행일자` 칸은 **연결된 견적서가 이긴 값**
 * (displayQuoteIssuedDate = linked_quotes.quote_date ?? quote_issued_date)이다.
 * 원본 칸(quote_issued_date)만으로 세우면 견적서가 연결된 줄에서 **서버가 그린
 * 차례와 화면이 다시 세운 차례가 달라진다** — 그것은 눈에 띄는 깜빡임이 아니라
 * React 의 hydration 어긋남이다. 매퍼가 접는 그 식을 SQL 에도 같은 모양으로 적어
 * 둔다.
 *
 * 🔵 날짜가 없는 줄은 **뒤로**(`nulls last`). 화면이 "-"로 그리는 줄이 맨 위에
 * 서면 첫 화면이 빈 칸으로 시작한다. 화면 쪽 기본 차례도 같은 규칙이다
 * (domain/misc-case-list.ts 의 MISC_CASE_DEFAULT_SORT · sortMiscCases).
 *
 * 🔵 둘째 기준이 등록순(created_at 내림차순)인 것은 listDomesticOrders 와 같은
 * 까닭이다 — 기준이 하나뿐이면 같은 날짜의 줄들이 새로 고칠 때마다 자리를 바꾼다.
 * 화면의 정렬은 **안정 정렬**이라 같은 값끼리는 이 차례가 그대로 남는다.
 *
 * 🔵 `순번(display_order)` 으로 세우지 않는다. 그 값은 **내자 정리 시트에서 사람이
 * 매긴 표시 순서**이고 이 화면에는 그 칸이 없다 — 보이지 않는 값으로 줄을 세우면
 * 왜 그 차례인지 화면만 봐서는 답할 수 없다. 13건 중 9건만 채워져 있기도 하다
 * (개발 DB 실측 2026-11-06).
 */
export async function listMiscDomesticOrders(): Promise<DomesticOrderListItem[]> {
  const rows = await selectDomesticOrderJoinRows()
    .where(and(eq(domesticOrders.isDeleted, false), isNull(domesticOrders.repairCaseId)))
    .orderBy(
      sql`coalesce(${linkedQuotes.quoteDate}, ${domesticOrders.quoteIssuedDate}) desc nulls last`,
      desc(domesticOrders.createdAt)
    );

  return attachDomesticOrderExtras(rows);
}

/**
 * 잘못된 모양의 id 는 질의로 보내지 않는다 — `uuid` 칸에 아무 글자나 비교시키면
 * Postgres 가 `invalid input syntax for type uuid` 로 **던지고**, 주소를 손으로
 * 친 사람에게 「없는 줄」이 아니라 오류 화면이 나온다. id 를 받는 이 저장소의 다른
 * 조회들과 같은 모양이다(queries/attachments.ts).
 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 「기타건 상세」가 읽는 **한 줄**. 없거나 휴지통에 있으면 null 이고, 그때 화면은
 * notFound() 로 간다.
 *
 * 🔴 **목록과 같은 조인 · 같은 매퍼**다(selectDomesticOrderJoinRows ·
 * attachDomesticOrderExtras). 고객사·형식이 어느 쪽에서 오는지, 견적서번호 ·
 * 견적발행일 · 금액이 연결된 견적서에 지는지 — 그 판단을 여기서 한 줄도 다시 적지
 * 않는다. 한 벌 더 적으면 [형식]을 눌러 들어온 화면이 방금 본 줄과 다른 값을
 * 보여 주는 날이 온다.
 *
 * 🔴 **휴지통에 든 줄은 읽지 않는다**(`is_deleted = false`). 목록이 쓰는 것과 같은
 * 조건이고, 그래서 휴지통 화면에는 이 상세로 가는 링크를 세우지 않는다
 * (domain/domestic-order-detail-link.ts 의 「휴지통은 이 함수를 부르지 않는다」).
 *
 * 🔵 **cache() 로 감싼다** — 한 요청 안에서 레이아웃(머리 카드)과 탭 페이지가 같은
 * id 를 읽으므로, 감싸지 않으면 화면 한 장에 질의가 두 벌 돈다. 요청 하나에만 걸리는
 * 메모라 요청 사이로 새지 않는다(queries/repair-case-references.ts 의 같은 장치).
 */
export const getDomesticOrderDetail = cache(async function getDomesticOrderDetail(
  id: string
): Promise<DomesticOrderListItem | null> {
  if (!UUID_PATTERN.test(id)) return null;

  const rows = await selectDomesticOrderJoinRows()
    .where(and(eq(domesticOrders.id, id), eq(domesticOrders.isDeleted, false)))
    .limit(1);

  const [row] = await attachDomesticOrderExtras(rows);
  return row ?? null;
});

/**
 * 연결된 견적서들의 공급가(부품 줄 합 + 작업비)를 **질의 한 번으로** 구한다.
 *
 * 견적서 목록이 쓰는 것과 같은 셈법이라(domain/quote-list.ts 의 quoteSupplyAmountOf)
 * 두 화면의 금액이 갈라지지 않는다. 금액은 numeric 이라 문자열로 다루고, 마지막에
 * 소수 두 자리로 고정해 이 표의 다른 금액과 같은 모양으로 만든다.
 *
 * ── 엑셀 전용 견적서 (2026-09-15 Q2) ─────────────────────────────────────
 * 품목이 없는 장이라 예전 셈법으로는 작업비만(보통 "0.00") 나와 **손으로 적은 금액을
 * 가렸다.** 이제 그 장의 공급가는 사람이 손으로 적은 공급가액이다. 그 값이 비어 있는
 * 옛 행(정상 경로로는 생기지 않는다 — 검증이 필수로 받는다)은 금액을 **싣지 않는다**
 * (지도에 없음) — 그러면 매퍼가 휴지통 견적서와 같이 이 줄에 손으로 적은 금액을
 * 그린다. 모르는 금액으로 손 값을 덮지 않는다.
 */
async function loadQuoteAmounts(quoteIds: string[]): Promise<Map<string, string>> {
  const amounts = new Map<string, string>();
  if (quoteIds.length === 0) return amounts;

  const quoteRows = await db
    .select({
      id: quotes.id,
      workCost: quotes.workCost,
      isExcelOnly: quotes.isExcelOnly,
      manualSupplyAmount: quotes.manualSupplyAmount,
    })
    .from(quotes)
    .where(and(inArray(quotes.id, quoteIds), eq(quotes.isDeleted, false)));
  if (quoteRows.length === 0) return amounts;

  // kind 를 함께 싣는다 — 설명 줄은 합계에 들어가지 않는다(2026-09-16).
  // 거르는 일은 domain/quote-list.ts 한 곳에서 한다(그 파일의 isQuoteAmountItemLine).
  const itemRows = await db
    .select({
      quoteId: quoteItems.quoteId,
      kind: quoteItems.kind,
      quantity: quoteItems.quantity,
      unitPrice: quoteItems.unitPrice,
    })
    .from(quoteItems)
    .where(inArray(quoteItems.quoteId, quoteRows.map((row) => row.id)));

  const itemsByQuoteId = new Map<string, QuoteAmountLine[]>();
  for (const item of itemRows) {
    const bucket = itemsByQuoteId.get(item.quoteId);
    if (bucket) bucket.push(item);
    else itemsByQuoteId.set(item.quoteId, [item]);
  }

  for (const quote of quoteRows) {
    const total = formatQuoteSupplyAmount(
      quoteSupplyAmountOf({
        isExcelOnly: quote.isExcelOnly,
        manualSupplyAmount: quote.manualSupplyAmount,
        items: itemsByQuoteId.get(quote.id) ?? [],
        workCost: quote.workCost,
      })
    );
    // 금액을 알 수 없는 엑셀 전용 장은 싣지 않는다 — 위 머리말의 '엑셀 전용 견적서'.
    if (total !== null) amounts.set(quote.id, total);
  }
  return amounts;
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
      // 🔴 납품 둘. **그릴 값이면서 되실어 보낼 값**이다 — 저장이 이 줄의 행을
      // 통째로 다시 만들므로, 여기서 안 실어 오면 칸 하나 고치는 저장 한 번에
      // 그 줄의 납품 기록이 사라진다(domain/domestic-order-cell-edit.ts 헤더).
      deliveredDate: domesticOrderDueDates.deliveredDate,
      deliveredBy: domesticOrderDueDates.deliveredBy,
      // 🔴 회차별 완료(2026-11-08). **되실어 보낼 값은 아니다** — 저장 통로가 제
      // 손으로 다시 적는다(replaceDueDates). 여기서 읽는 까닭은 화면이 회차별
      // [완료 처리] 단추를 그리고, [삭제] 단추를 미리 막아야 하기 때문이다.
      completedAt: domesticOrderDueDates.completedAt,
      completedBy: domesticOrderDueDates.completedBy,
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
      deliveredDate: row.deliveredDate,
      deliveredBy: row.deliveredBy,
      // 🔴 서버 컴포넌트 경계를 넘어야 하므로 Date 를 그대로 보내지 않는다
      //    (부모 줄의 completedAt 과 같은 처리).
      completedAt: row.completedAt ? row.completedAt.toISOString() : null,
      completedBy: row.completedBy,
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

/**
 * 그 수리 건에 붙어 있는 내자 줄들의 **견적발행일 · 발주발행일**. 없으면 빈 배열이다.
 *
 * 수리 건 상세 「기본 정보」의 내자 발행일 구역이 그릴 재료다. 위
 * listDomesticOrderDueDatesForRepairCase 와 같은 이유로 이 파일에 있다 — 읽는
 * 표가 내자 정리의 것이고, **그 표를 어떤 조건으로 읽어야 하는지를 이 파일이 한
 * 곳에서 갖는다.**
 *
 * ── 고르는 일은 여기서 하지 않는다 ──────────────────────────────────────
 * 한 수리 건에 내자 줄이 여럿일 수 있고(분할 발주 — repair_case_id 에 유일
 * 제약이 없다), 칸은 둘뿐이다. 그 여럿을 하나로 접는 규칙은 도메인이 갖는다
 * (domain/repair-case-domestic-order-dates.ts 가 주간보고와 **같은**
 * pickWeeklyReportOrderDates 를 부른다). SQL 의 min() 으로 접으면 그 규칙이 두
 * 벌이 되고, 주간보고 상세표와 조용히 어긋날 수 있다 — 바로 위 형제 함수와 같은
 * 판단이다.
 *
 * ── 🔴 주간보고와 **같은 두 칼럼**을 읽는다 ─────────────────────────────
 * 목록 조회(mapDomesticOrderRow)는 연결된 견적서가 있으면 그쪽 발행일을 쓰지만
 * (`연결된 견적서가 이긴다`), 주간보고 상세표는 그 해소를 하지 않고
 * `domestic_orders.quote_issued_date` 를 그대로 읽는다
 * (queries/weekly-report.ts 의 loadOrderDatesByCaseId). 맞출 상대가 주간보고이므로
 * 여기서도 칼럼을 그대로 읽는다 — 한쪽만 견적서로 해소하면 같은 건의 같은 칸이
 * 두 화면에서 다른 날짜가 된다.
 *
 * `is_deleted = false` 인 줄만 본다(주간보고·납기일 조회와 같은 규칙) — 화면에서
 * 지운 줄이 다른 화면의 값을 정하면 안 된다.
 *
 * ⚠️ 차례를 정하지 않는 것도 주간보고와 맞춘 것이다. 고르는 함수는 날짜로
 * 고르므로 받은 차례와 상관이 없고, 고를 날짜가 완전히 같은 줄이 둘 이상일
 * 때에만 어느 줄이 잡히는지가 갈린다 — 그 자리를 여기서만 못 박으면 두 조회가
 * 서로 다른 줄을 고르게 된다.
 *
 * ── 🔴 날짜 둘 말고 셋을 더 싣는다 — 고칠 때 쓴다 (2026-09-29) ──────────
 * 그 구역에서 두 날짜를 **고칠 수 있게** 되면서 id · version · quote_id 가
 * 함께 온다(domain/domestic-order-issue-date-edit.ts 의
 * RepairCaseDomesticOrderIssueDateRow). 셋 다 화면에 그리는 값이 아니다:
 *
 *   - `id` — 고칠 줄을 가리킨다.
 *   - `version` — 🔴 **내자 줄의** 낙관적 잠금 토큰이다(수리 건의 것이 아니다).
 *     PO 시스템(dss-po)이 같은 표를 같은 DB 에서 고치므로 형식이 아니다.
 *   - `quote_id` — 견적서가 붙은 줄은 견적발행일이 잠긴다(같은 파일).
 *
 * **그리는 두 칸은 그대로 원본 칼럼이다** — 위 '주간보고와 같은 두 칼럼'을
 * 지킨다. quote_id 를 싣는 것은 잠금 판정에 쓰기 위해서이지, 여기서 견적서
 * 값으로 해소하려는 것이 아니다.
 */
export async function listDomesticOrderIssueDatesForRepairCase(
  repairCaseId: string
): Promise<RepairCaseDomesticOrderIssueDateRow[]> {
  return db
    .select({
      id: domesticOrders.id,
      version: domesticOrders.version,
      quoteId: domesticOrders.quoteId,
      quoteIssuedDate: domesticOrders.quoteIssuedDate,
      orderIssuedDate: domesticOrders.orderIssuedDate,
    })
    .from(domesticOrders)
    .where(and(eq(domesticOrders.isDeleted, false), eq(domesticOrders.repairCaseId, repairCaseId)));
}

/**
 * 휴지통의 한 줄(2026-09-11). 목록 한 줄(DomesticOrderListItem)과 **일부러
 * 다른 모양**이다 — 휴지통은 "무엇을 지웠는가"를 알아보고 되살리는 자리라 22칸이
 * 필요하지 않고, 사람이 줄을 알아보는 칸(인수번호 · 고객사 · 형식 · 발주서번호 ·
 * PJT · 발주발행일)과 지운 기록만 싣는다. 금액·입금·자유 메모는 내려보내지 않는다.
 *
 * 고객사·형식은 목록과 **같은 규칙**으로 정한다 — 이 행에 적힌 값이 먼저, 없으면
 * 연결된 수리 건의 값(resolveDomesticOrderValue). 목록에서 보던 이름과 휴지통의
 * 이름이 다르면 같은 줄인지 알아볼 수 없다.
 */
export type DeletedDomesticOrderRow = {
  id: string;
  /** 되살리기·완전 삭제의 낙관적 잠금 토큰(mutations/domestic-orders-trash.ts). */
  version: number;
  displayIntakeNumber: string | null;
  customerName: string | null;
  modelName: string | null;
  purchaseOrderNumber: string | null;
  projectName: string | null;
  orderIssuedDate: string | null;
  /**
   * ISO 순간. 보관 만료 배지가 이 값 하나로 계산된다(master-data-trash-retention).
   *
   * null 은 정상 경로로는 생기지 않는다(softDeleteDomesticOrder 가 같은 UPDATE 에서
   * is_deleted 와 함께 쓴다). 그래도 단정(!)하지 않는다 — 그런 줄을 목록에서
   * 빼면 되살릴 길이 없어지고, 지어낸 시각을 붙이면 배지가 거짓말을 한다. 화면은
   * 시각 대신 "-" 를 그리고 배지를 그리지 않는다. 정리 스크립트도 이 줄을 건너뛴다
   * (listPurgeEligibleDomesticOrderIds).
   */
  deletedAt: string | null;
  deletedByUserName: string | null;
  deleteReason: string | null;
};

/**
 * 휴지통에 있는 내자 정리 줄 전부 — 지운 시각이 최신인 것부터.
 *
 * 방금 지운 것을 되살리려고 여는 화면이라 최신순이다(견적서·고객사 휴지통과 같다).
 * **지울 권한이 있는 세션에서만 부른다** — 부르는 쪽(page.tsx)이 그 판정을 한다.
 *
 * 조인은 목록과 같은 이유로 전부 LEFT JOIN 이다(파일 헤더). 지운 사람도
 * LEFT JOIN 이다 — deleted_by 가 비어 있는 줄이 휴지통에서 통째로 사라지면
 * 되살릴 방법이 없어진다(queries/customers.ts 의 같은 판단).
 */
export async function listDeletedDomesticOrders(): Promise<DeletedDomesticOrderRow[]> {
  const rows = await db
    .select({
      id: domesticOrders.id,
      version: domesticOrders.version,
      intakeNumber: repairCases.intakeNumber,
      intakeNumberText: domesticOrders.intakeNumberText,
      ownCustomerName: orderCustomers.name,
      repairCaseCustomerName: repairCaseCustomers.name,
      modelNameText: domesticOrders.modelNameText,
      repairCaseModelName: products.modelName,
      purchaseOrderNumber: domesticOrders.purchaseOrderNumber,
      projectName: domesticOrders.projectName,
      orderIssuedDate: domesticOrders.orderIssuedDate,
      deletedAt: domesticOrders.deletedAt,
      deletedByUserName: users.name,
      deleteReason: domesticOrders.deleteReason,
    })
    .from(domesticOrders)
    .leftJoin(repairCases, eq(repairCases.id, domesticOrders.repairCaseId))
    .leftJoin(products, eq(products.id, repairCases.productId))
    .leftJoin(orderCustomers, eq(orderCustomers.id, domesticOrders.customerId))
    .leftJoin(repairCaseCustomers, eq(repairCaseCustomers.id, repairCases.customerId))
    .leftJoin(users, eq(users.id, domesticOrders.deletedBy))
    .where(eq(domesticOrders.isDeleted, true))
    .orderBy(desc(domesticOrders.deletedAt));

  return rows.map((row) => ({
    id: row.id,
    version: row.version,
    displayIntakeNumber: row.intakeNumber ?? row.intakeNumberText,
    customerName: resolveDomesticOrderValue(row.ownCustomerName, row.repairCaseCustomerName),
    modelName: resolveDomesticOrderValue(row.modelNameText, row.repairCaseModelName),
    purchaseOrderNumber: row.purchaseOrderNumber,
    projectName: row.projectName,
    orderIssuedDate: row.orderIssuedDate,
    deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
    deletedByUserName: row.deletedByUserName,
    deleteReason: row.deleteReason,
  }));
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

/**
 * 내자 줄 한 개에 붙어 있는 **수리 건의 지금 상태**. [완료 처리]가 그 건을 함께
 * 출하 완료로 넘길지 말지를 정하는 데에만 쓴다
 * (server/services/complete-domestic-order.ts).
 */
export type DomesticOrderShipmentLink = {
  repairCaseId: string;
  /**
   * 읽은 그 순간의 repair_cases.version. transitionWorkflow 의 낙관적 잠금
   * 인자로 그대로 넘어간다 — **그 검사가 사실상 무의미해지는 이유**는 서비스
   * 쪽 머리말에 적어 두었다.
   */
  repairCaseVersion: number;
  /** 지금 단계가 이미 출하 완료인가. */
  isShipmentCompleted: boolean;
};

/**
 * 그 내자 줄에 **지금 무엇이 붙어 있는지**를 한 번에 읽는다.
 *
 * `null` 이 돌아오는 경우는 셋이고, 부르는 쪽에서는 **전부 같은 뜻**이다 —
 * "함께 출하 완료로 넘길 수리 건이 없다".
 *  1. 그 내자 줄 자체가 없거나 휴지통에 있다(그때 완료 처리는 뒤이어
 *     setDomesticOrderCompletion 이 NOT_FOUND 로 돌려준다 — 여기서 미리
 *     판정하지 않는다).
 *  2. repair_case_id 가 NULL 이다. 수리 없이 납품만 하는 줄과, 인수번호를
 *     글자로만 남긴 줄이 실제로 있다(schema/domestic-orders.ts).
 *  3. 붙어 있던 수리 건이 **휴지통에 있다.** 그 건은 화면 어디에도 없으므로
 *     없는 것으로 친다 — 그러지 않으면 transitionWorkflow 가 NOT_FOUND 를
 *     돌려주고, 그 때문에 내자 줄의 완료 처리까지 영영 막힌다.
 *
 * 출하 완료 여부는 **workflow_steps.repair_status 로** 판정한다. 단계 key 를
 * 글자로 비교하지 않는 이유는 워크플로마다 단계 key 가 다르기 때문이고, 이
 * 저장소가 "지금 출하 완료인가"를 묻는 다른 자리들(queries/weekly-report.ts ·
 * queries/repair-cases-mine.ts)이 쓰는 기준과 같다. 아직 nullable 인 칸이라
 * NULL 은 "출하 완료가 아니다"로 접는다.
 */
export async function getDomesticOrderShipmentLink(
  domesticOrderId: string
): Promise<DomesticOrderShipmentLink | null> {
  const [row] = await db
    .select({
      repairCaseId: repairCases.id,
      repairCaseVersion: repairCases.version,
      repairStatus: workflowSteps.repairStatus,
    })
    .from(domesticOrders)
    .innerJoin(
      repairCases,
      and(eq(repairCases.id, domesticOrders.repairCaseId), eq(repairCases.isDeleted, false))
    )
    // 단계가 비어 있는 건이 생겨도 줄이 통째로 사라지지 않게 LEFT 다 — 그때는
    // "출하 완료가 아니다"로 읽히고, 실제로 넘길 수 있는지는 transitionWorkflow 가 본다.
    .leftJoin(workflowSteps, eq(workflowSteps.id, repairCases.currentWorkflowStepId))
    .where(and(eq(domesticOrders.id, domesticOrderId), eq(domesticOrders.isDeleted, false)));

  if (!row) return null;
  return {
    repairCaseId: row.repairCaseId,
    repairCaseVersion: row.repairCaseVersion,
    isShipmentCompleted: row.repairStatus === "SHIPMENT_COMPLETED",
  };
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

/**
 * 접수 건들의 **견적서번호 · 견적발행일** — 고객 안내 현황판이 쓴다.
 *
 * 이 파일에 두는 이유는 위 listDomesticOrderDueDatesForRepairCase 와 같다:
 * 읽는 표가 내자 정리의 것이고, **그 표를 어떤 조건으로 읽어야 하는지를 이
 * 파일이 한 곳에서 갖는다.** 저쪽 화면의 조회 파일에 같은 SQL 을 한 벌 더
 * 적으면 언젠가 한쪽만 고쳐져 같은 자료가 화면마다 다른 번호로 보인다.
 *
 * ── 연결된 견적서가 이긴다 ──────────────────────────────────────────────
 * 손으로 적은 quote_number · quote_issued_date 와 연결된 견적서의 값이 다르면
 * **견적서 쪽을 쓴다.** 이 표의 다른 칸들이 "이 행의 값이 먼저"인 것과 방향이
 * 반대인데, 이유는 번호와 발행일이 실제로 발행된 문서의 값이기 때문이다
 * (schema/domestic-orders.ts 의 quote_id 주석). 목록 조회가 이미 같은 규칙으로
 * 해소하고 있어(mapDomesticOrderRow) 그 규칙을 여기서 다시 정의하지 않고
 * 같은 모양으로 적는다.
 *
 * ── 한 접수에 내자 줄이 여럿일 수 있다 ──────────────────────────────────
 * 분할 발주가 그렇다. 고객 화면에는 칸이 하나뿐이라 **견적발행일이 가장 늦은
 * 줄**을 고른다 — 재견적이 나갔다면 마지막 것이 지금 유효한 값이다.
 * 발행일이 없는 줄은 후보에서 빠진다(번호만 있고 날짜가 없으면 어느 것이
 * 최신인지 판단할 근거가 없다).
 *
 * ── 완료된 줄은 후보에서 뺀다 (2026-10-07) ──────────────────────────────
 * 내자 정리에서 **완료 처리된 줄은 이미 출하가 끝났다는 뜻**이다(사용자 설명
 * 2026-10-07). 고객 안내 현황이 묻는 것은 "지금 진행 중인 건의 견적서 번호"라
 * 끝난 줄의 번호를 내면 안 된다. 그래서 거르는 자리를 **SQL 의 WHERE** 로
 * 둔다 — 아래 "가장 늦은 줄 고르기"보다 앞이라, 완료된 줄이 견적발행일이 더
 * 늦어도 이기지 못한다.
 *
 * 🔴 완료 판정은 **completed_at 한 곳**이다(schema/domestic-orders.ts 의
 * completed_at 주석: "NULL 이면 아직 진행 중이다. is_completed 불리언을 따로
 * 두지 않는다"). 코드에서 그 판정을 하는 자리는
 * domain/domestic-order-list.ts 의 isDomesticOrderCompleted 이고, 여기서는 그
 * 함수를 SQL 로 옮긴 것이 아니라 **같은 한 칸**을 본다. 판정을 다른 칸으로
 * 옮기는 날에는 두 곳을 함께 고쳐야 한다.
 *
 * 번호만 빼지 않고 **줄 자체를** 빼는 이유는 아래 RepairCaseQuoteInfo 의
 * 전제 때문이다 — 세 값이 같은 줄에서 나와야 한다.
 *
 * 완료 안 된 줄이 하나도 없으면 그 접수는 결과 Map 에 **들어가지 않는다**(줄이
 * 아예 없을 때와 같다).
 *
 * ── 🔴 그때 부르는 쪽은 공유폴더를 보지 **않는다** (2026-11-11 바로잡음) ──
 * 2026-11-11 까지 이 자리에는 「부르는 쪽은 그때 공유폴더에서 번호를 읽는다 —
 * 그것이 맞는 동작이다」라고 적혀 있었다. **거꾸로 적힌 글이었다.** 같은 날 코드를
 * 읽어 확인한 실제 동작은 이렇다(queries/repair-case-quote-numbers.ts):
 *
 *  · 자리가 없는 건은 `info` 가 `undefined` 로 들어간다. 공유폴더를 볼지 가르는
 *    `readsArchive` 는 「번호가 비었고 **+ 발행일이 적혀 있을 때**」만 참이라
 *    **발행일 쪽에서 거짓**이 된다 — 그래서 디스크를 아예 안 본다.
 *  · 🔴 그뿐 아니라 `repairCaseQuoteNumbers` 의 **첫 줄**(적어 둔 번호를 그대로
 *    내는 자리)도 `info` 가 없어 함께 막힌다. 결과는 **빈 배열**이고, 그 건의
 *    번호 칸은 **빈 채로** 남는다.
 *
 * ── 🔴 그래도 괜찮은 까닭 — 그 상태를 설계가 막고 있다 (2026-10-18) ──────
 * 내자 줄 완료와 수리 건 출하 완료는 사용자 결정 2026-10-18 로 **양방향으로
 * 묶였다.** server/services/complete-domestic-order.ts 가 [완료 처리] 한 번으로
 * 붙어 있는 수리 건도 출하 완료로 넘기고, server/services/release-domestic-order.ts
 * 가 그 **거울**로 [완료 해제] 때 출하 완료도 되돌린다. 두 서비스가 **수리 건을
 * 먼저** 손대는 까닭이 바로 이 반쪽이다 — 반대 차례면 「내자 줄은 완료, 수리 건은
 * 아직」이 남는데 완료된 줄에는 [완료 처리] 단추가 없어 **복구할 길이 없다**
 * (complete-domestic-order.ts 머리말). 즉 여기서 번호 칸이 비는 상태는 **일부러
 * 피해 둔** 상태다. 🔵 운영 실측 2026-11-11 — 「내자 줄이 전부 완료됐는데 수리
 * 건은 출하 완료가 아닌」 건은 **0 건**이다.
 *
 * 🔵 게다가 이 조회를 쓰는 두 화면은 출하 완료된 건을 **애초에 목록에서 뺀다** —
 * 고객 안내 현황은 `status !== "SHIPMENT_COMPLETED"`(queries/customer-portal.ts),
 * 주간 보고는 `is distinct from 'SHIPMENT_COMPLETED'`(queries/weekly-report.ts)다.
 * 그래서 줄이 전부 완료된 건은 번호 칸을 물을 자리에 서지도 않는다.
 *
 * ── 🔴 발주서는 **다른 규칙으로 돈다** (2026-11-11) ──────────────────────
 * 수리 건 상세 [발주서] 탭은 **출하 완료된 건에서도 열리기** 때문에 같은 원인으로
 * 실제 피해가 났다(발행일이 분명히 적혀 있는데 화면이 「없습니다」라고 했다). 그래서
 * 그쪽은 이 조회 대신 완료 여부를 **안 보는** 전용 조회를 쓴다(아래
 * listRepairCaseIdsWithOrderIssuedDate). 🔴 **지금 견적번호와 발주서는 서로 다른
 * 규칙으로 돈다 — 한쪽을 고칠 때 다른 쪽을 따라 고치지 마라.**
 *
 * 🔵 여기서 말하는 번호 칸은 **고객 안내 현황 · 주간 보고의 견적번호 칸**이다.
 * 수리 건 상세 [견적서] 탭의 「같은 장비의 지난 견적서」는 이 관문과 **무관**하다 —
 * api/repair-cases/[id]/quote-archive-folders 에는 이 조회도 발행일 관문도 없고,
 * 출하 완료된 뒤에도 공유폴더를 읽는다.
 *
 * 🔵 짝이 되는 글이 queries/repair-case-quote-numbers.ts 의 `readsArchive` 주석에
 * 있다. 한쪽만 읽고 반대로 이해하는 일이 다시 없도록 **서로를 가리켜 둔다.**
 *
 * 접수 하나씩 부르지 않고 목록을 받는 이유: 현황판은 한 고객사의 접수를 한꺼번에
 * 그린다. 건마다 조회를 돌면 줄 수만큼 왕복이 생긴다.
 */
export type RepairCaseQuoteInfo = {
  repairCaseId: string;
  quoteNumber: string | null;
  quoteIssuedDate: string | null;
  /**
   * 발주발행일. 고객사 엑셀의 「ICD PO 발행일」 · 「P.O 발행 일」이 가리키는
   * 값이다(고객사 양식 — domain/customer-portal-forms.ts).
   *
   * 어느 줄을 고르는지는 위 둘과 **같다** — 견적발행일이 가장 늦은 줄. 여기서만
   * 따로 "발주발행일이 가장 늦은 줄"을 고르면 한 줄에 다른 줄의 번호와 다른
   * 줄의 날짜가 섞여 나온다. 같은 줄에서 나온 값이라는 것이 이 칸들의 전제다.
   */
  orderIssuedDate: string | null;
};

export async function listQuoteInfoForRepairCases(
  repairCaseIds: string[]
): Promise<Map<string, RepairCaseQuoteInfo>> {
  const result = new Map<string, RepairCaseQuoteInfo>();
  if (repairCaseIds.length === 0) return result;

  const linkedQuotes = alias(quotes, "customer_portal_linked_quotes");

  const rows = await db
    .select({
      repairCaseId: domesticOrders.repairCaseId,
      quoteNumber: domesticOrders.quoteNumber,
      quoteIssuedDate: domesticOrders.quoteIssuedDate,
      orderIssuedDate: domesticOrders.orderIssuedDate,
      linkedQuoteNumber: linkedQuotes.quoteNumber,
      linkedQuoteDate: linkedQuotes.quoteDate,
    })
    .from(domesticOrders)
    .leftJoin(
      linkedQuotes,
      and(eq(domesticOrders.quoteId, linkedQuotes.id), eq(linkedQuotes.isDeleted, false))
    )
    .where(
      and(
        eq(domesticOrders.isDeleted, false),
        inArray(domesticOrders.repairCaseId, repairCaseIds),
        // 완료 처리된 줄은 이미 출하가 끝난 줄이다(머리말). 완료 판정은
        // completed_at 한 곳 — domain/domestic-order-list.ts 의
        // isDomesticOrderCompleted 와 같은 칸을 본다.
        isNull(domesticOrders.completedAt)
      )
    );

  for (const row of rows) {
    if (!row.repairCaseId) continue;

    // 연결된 견적서가 이긴다. 위 목록 조회(mapDomesticOrderRow)와 같은 규칙이다.
    const quoteNumber = row.linkedQuoteNumber ?? row.quoteNumber;
    const quoteIssuedDate = row.linkedQuoteDate ?? row.quoteIssuedDate;

    const previous = result.get(row.repairCaseId);

    // 발행일이 가장 늦은 줄이 이긴다. 날짜가 없는 줄은 이미 자리를 잡은 것을
    // 밀어내지 못한다 — 최신인지 판단할 근거가 없기 때문이다.
    const isNewer =
      !previous ||
      (quoteIssuedDate !== null &&
        (previous.quoteIssuedDate === null ||
          quoteIssuedDate > previous.quoteIssuedDate));

    if (isNewer) {
      result.set(row.repairCaseId, {
        repairCaseId: row.repairCaseId,
        quoteNumber,
        quoteIssuedDate,
        // 이긴 그 줄의 발주발행일이다 — 위 주석대로 줄을 갈라 고르지 않는다.
        orderIssuedDate: row.orderIssuedDate,
      });
    }
  }

  return result;
}

/**
 * 이 접수 건들에 **발주발행일이 적힌 내자 줄이 하나라도 있는가** (2026-11-11).
 *
 * 수리 건 상세 「발주서」 탭의 통로 하나가 부른다
 * (api/repair-cases/[id]/purchase-order-folder/entries 의 6단계). 그 통로가 묻는 것은
 * **발주가 나갔는가** 하나뿐이고, 나갔으면 공유폴더를 L/N + S/N 으로 뒤진다 — 여기서
 * 내는 값은 디스크를 볼지 말지를 가르는 관문의 열쇠다.
 *
 * ── 🔴 바로 위 listQuoteInfoForRepairCases 를 쓰지 않는 까닭 ────────────────
 * 그 조회는 **완료 처리된 줄을 뺀다**(2026-10-07, 그쪽 머리말). 「지금 진행 중인 건의
 * 견적서 번호」를 묻는 고객 안내 현황에는 그것이 맞지만, 발주서 탭은 **반대**다 —
 * **수리가 끝난 건의 지난 발주서를 찾아보는 것**이 그 탭의 쓰임새다. 그 함수를 그대로
 * 쓰면 줄이 완료되는 순간 발주서가 영영 안 보이고, 발행일이 분명히 적혀 있는데도 화면에
 * 「아직 발주발행일이 적혀 있지 않습니다」가 뜬다(운영 실측 2026-11-11 — 고객사와
 * 무관하게, 수리가 끝난 건이면 모두 그랬다). 사용자 결정 2026-11-11: **완료된 건도
 * 보여 준다.**
 *
 * 🔴 그래서 저쪽 조건을 **고치지 않고** 이 함수를 옆에 둔다. 완료 거르기는 고객 안내
 * 현황(queries/customer-portal.ts)과 주간 보고(queries/weekly-report.ts)가 **함께 쓰는**
 * 규칙이라, 한 화면 때문에 풀면 그 둘이 같이 바뀐다.
 *
 * ── 🔴 어느 줄이 이기는지 가리지 않는다 ───────────────────────────────────
 * 위 조회는 견적발행일이 가장 늦은 줄을 고른 뒤 **그 줄의** 발주발행일을 본다. 번호 ·
 * 견적발행일 · 발주발행일 셋이 같은 줄에서 나와야 하기 때문인데(RepairCaseQuoteInfo),
 * 여기서 내는 것은 날짜가 아니라 **있는가 없는가** 하나다. 그 날짜는 화면에 나가지 않고
 * 폴더도 L/N + S/N 으로 찾는다. 줄을 가리면 분할 발주처럼 줄이 여럿일 때, **이긴 줄에만**
 * 발행일이 비어 있다는 이유로 멀쩡히 나간 발주서가 막힌다.
 *
 * ── 조건 ──────────────────────────────────────────────────────────────────
 * `is_deleted = false` · `repair_case_id` 가 그 건 · `order_issued_date IS NOT NULL`.
 * 🔴 **completed_at 을 보지 않는다**(위 까닭). 발주발행일은 PostgreSQL date 칼럼이라
 * 값이 있으면 "YYYY-MM-DD" 다(domain/domestic-order-list.ts 머리말) — 공백만 적힌 칸이
 * 생길 자리가 없어 NULL 하나로 가른다.
 *
 * 통로는 한 건만 묻지만 **여럿 받아 Set 을 내는** 모양이다 — 이 파일의 이웃
 * (listQuoteInfoForRepairCases)과 같은 결이고, 나중에 목록 화면이 같은 것을 물어도
 * 줄마다 왕복이 생기지 않는다.
 */
export async function listRepairCaseIdsWithOrderIssuedDate(
  repairCaseIds: string[]
): Promise<Set<string>> {
  const result = new Set<string>();
  if (repairCaseIds.length === 0) return result;

  const rows = await db
    .selectDistinct({ repairCaseId: domesticOrders.repairCaseId })
    .from(domesticOrders)
    .where(
      and(
        eq(domesticOrders.isDeleted, false),
        inArray(domesticOrders.repairCaseId, repairCaseIds),
        isNotNull(domesticOrders.orderIssuedDate)
      )
    );

  for (const row of rows) {
    // repair_case_id 는 NULL 허용 칸이라(수리 건이 안 붙은 줄 = 기타건, 그리고 접수 건이
    // 영구 삭제되면 ON DELETE SET NULL — schema/domestic-orders.ts) 타입이 nullable 이다.
    // 위 inArray 가 이미 걸렀지만 컴파일러에게는 그 사실이 보이지 않는다.
    if (row.repairCaseId !== null) result.add(row.repairCaseId);
  }

  return result;
}
