import "server-only";

import { and, asc, desc, eq, isNull, ne, sql } from "drizzle-orm";
import { db } from "../client";
import {
  customers,
  domesticOrderDueDates,
  domesticOrders,
  repairCaseApprovals,
  repairCases,
} from "../schema";
import {
  DOMESTIC_ORDER_APPROVAL_ROUTE_SCOPE,
  foldDomesticOrderApprovalStates,
  isDomesticOrderApprovalRouteInForce,
  resolveMiscCaseCompletionGate,
} from "@/lib/domain/domestic-order-approval-rules";
import {
  domesticOrderDueDateUnits,
  type DomesticOrderDueDateUnit,
} from "@/lib/domain/domestic-order-due-date-label";
import {
  resolveApprovalState,
  type ShipmentApprovalState,
} from "@/lib/domain/local/workflow/shipment-approval-checklist";
import {
  resolveRepairCaseDueDateWriteThrough,
  type RequestedDueDateLinkOutcome,
} from "@/lib/domain/requested-due-date-link";
import {
  resolveDueDateRowCompletionDeliveredPlan,
  resolveRepairCaseShipmentWriteThrough,
  type DeliveredDateLinkOutcome,
} from "@/lib/domain/delivered-date-link";
import { checkDomesticOrderDueDateRows } from "@/lib/domain/domestic-order-due-date-rows";
import { getCurrentShipmentApprovalRouteChain } from "../queries/shipment-approval-routes";
import type { DomesticOrderFields } from "@/lib/validation/domestic-order-input";

/**
 * ============================================================================
 * 내자 정리 — 행 추가·수정 (2단계)
 * ============================================================================
 * 이 계층은 **기계**다. 누가 고칠 수 있는지는 여기서 묻지 않는다 —
 * 세션·역할·설정은 서버 액션(server/actions/domestic-orders.ts)이 보고, 이
 * 파일은 자료의 규칙만 지킨다(존재하는가 · 지워졌는가 · 그 사이 누가 고쳤는가).
 * 이 저장소가 queries/mutations 를 mechanism, Server Actions/pages 를 policy 로
 * 나눠 온 방식 그대로이고, 통합 테스트가 인가를 흉내 내지 않고도 자료 규칙을
 * 그대로 검증할 수 있는 이유이기도 하다.
 *
 * ── 동시 수정은 version 으로 막는다 ─────────────────────────────────────
 * 가장 가까운 선례는 mutations/customers.ts 지만, **그쪽은 updated_at 문자열을
 * 대조한다** — customers 표에 version 컬럼이 없어서 어쩔 수 없이 고른 방식이다.
 * domestic_orders 에는 version integer 가 처음부터 있으므로(1단계가 이번을 위해
 * 미리 넣어 두었다) repair_cases 와 같은 정수 대조를 쓴다. 타임스탬프 대조는
 * 같은 밀리초 안에 두 번 저장되면 어긋남을 놓칠 수 있지만, 정수는 그 틈이 없다.
 *
 * 순서는 repair_cases 의 되돌리기 어려운 조작들과 같다:
 *  1. 트랜잭션을 열고 대상 행을 `.for("update")` 로 잠근다.
 *  2. 없거나 이미 지워진 행이면 NOT_FOUND.
 *  3. version 이 어긋나면 CONFLICT — 화면은 폼을 얼리고 다시 불러오게 한다.
 *  4. 값과 함께 version + 1, updated_at, updated_by 를 쓴다.
 *
 * 잠금을 먼저 잡는 이유: 읽고 나서 쓰기까지 사이에 남이 끼어들면 "둘 다
 * 성공했는데 한쪽 내용이 사라진" 상태가 만들어진다. 이 표에는 세금계산서
 * 발행일과 입금 사실이 들어 있어서 조용히 덮이면 안 되는 종류의 값이다.
 *
 * ── 납기 요청일은 딸린 표에 있다 ────────────────────────────────────────
 * 한 줄에 날짜가 여럿일 수 있어서 domestic_order_due_dates 로 나갔다
 * (그 스키마 파일 헤더). 저장은 **그 줄의 날짜를 전부 지우고 받은 목록으로
 * 다시 넣는 것**이고(replaceDueDates), 그 일은 위 4단계에서 **version 대조를
 * 통과한 뒤에만** 일어난다 — 같은 트랜잭션 안이므로 CONFLICT 로 끝난 저장은
 * 날짜를 한 건도 건드리지 않는다.
 *
 * domestic_orders.requested_due_date 는 **이제 쓰지 않는다.** 칸은 아직
 * 남아 있지만 toColumnValues 에 없다 — 그 이유는 그 자리의 주석에 있다.
 *
 * ── 🔴 납기 요청일을 고치면 **수리 건의 고객 요청 납기일도 바뀐다** (2026-10-30)
 * 사용자 결정이다 — 「어느 쪽에서 수정하든 같은 날짜를 보고 있을 수 있도록」.
 * 이 파일이 고치는 표가 하나 늘었다는 뜻이라, 아래 applyRepairCaseDueDateLink 의
 * 머리말을 함께 읽어야 한다. 묶지 않는 자리와 그 까닭은 전부
 * domain/requested-due-date-link.ts 머리말에 있고, **판정은 그 파일 하나가**
 * 가진다(거울 방향인 mutations/repair-cases.ts 도 같은 파일을 부른다).
 *
 * ── 🔴 납품일·납품자도 **그 딸린 표에 있다** (2026-11-08) ─────────────────
 * 사용자 결정 1(「납기요청일 1번 줄 ↔ 납품일 1번 줄, 행이 묶인다」)로 납품 둘이
 * domestic_order_due_dates 의 칼럼이 되었다. 그래서 이 파일이 하는 일이 둘 늘었다:
 *
 *  · **울타리 둘**(사용자 결정 5 · 9) — 납품 기록이 달린 행을 지우는 저장과, 수리
 *    건이 붙은 줄의 납기요청일을 둘 이상으로 늘리는 저장을 거절한다. 판정은
 *    domain/domestic-order-due-date-rows.ts 하나가 갖고, 여기서는 **저장돼 있던
 *    모양과 보내온 모양**을 그 판정에 넘긴다(checkDueDateRowGuard).
 *  · **묶기 하나 더** — 납품일을 고치면 수리 건의 실제 출하일도 같은 날짜가 된다
 *    (applyRepairCaseShipmentLink). 바로 위 납기요청일 묶기와 **같은 잠금 차례**다.
 *
 * 🔴 **옛 칼럼 `domestic_orders.delivered_date`·`delivered_by` 는 toColumnValues 에
 * 그대로 있다.** `requested_due_date` 때와 다른 점인데, 까닭이 있다: 그 칸을 PO
 * 시스템(dss-po)이 같은 DB 에서 쓰고 있어(사용자 결정 11) **A/S 가 안 쓴다고 비워도
 * 되는 값이 아니다.** 저장이 하는 일은 읽어 온 값을 한 글자도 안 바꾸고 되돌려
 * 놓는 것뿐이고, A/S 화면은 그 칸을 그리지도 고치지도 않는다.
 *
 * ── 지워진 행은 고칠 수 없다 ────────────────────────────────────────────
 * is_deleted = true 인 행은 조회 목록에 없다(queries/domestic-orders.ts).
 * 화면에 없는 행을 고치려는 요청은 "찾을 수 없다"가 정확한 답이다 — 휴지통에서
 * 되살리는 일은 별도 조작이고, 수정이 그 일을 겸하면 지운 기록이 조용히
 * 되살아난다.
 *
 * ── PII ─────────────────────────────────────────────────────────────────
 * progress_note · history_note · etc_note · delivered_by 는 사람이 자유롭게
 * 적는 값이라 담당자 이름이 섞일 수 있다(schema 헤더). 이 파일은 실패해도 그
 * 값들을 오류 메시지에 담지 않는다.
 * ============================================================================
 */

/** 트랜잭션 핸들. 아래 도우미들이 같은 트랜잭션 안에서 읽도록 못 박는다. */
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type DomesticOrderMutationResultCode = "NOT_FOUND" | "CONFLICT" | "VALIDATION_ERROR";

/**
 * 완료 처리에만 있는 거절. 🔴 **추가·수정에는 없다** — 그래서 위 묶음에 끼워 넣지
 * 않고 따로 잇는다. 끼워 넣으면 「행을 추가했는데 승인이 없다고 거절당했다」가
 * 타입상 말이 되어 버리고, 그 가능성을 부르는 쪽들이 저마다 가려내야 한다.
 */
export type DomesticOrderCompletionMutationResultCode =
  | DomesticOrderMutationResultCode
  /**
   * 🔴 **기타건(수리 건이 붙지 않은 줄)인데 [기타건 최종 출하 승인]이 유효하지 않다**
   * (2026-11-07 사용자 결정). `message` 가 어느 상태라서 막혔는지까지 말한다 —
   * 가르는 것은 **코드**이고(글자를 견주지 않는다), 보여 주는 것은 message 다.
   */
  | "APPROVAL_REQUIRED";

export type DomesticOrderCompletionMutationResult =
  | { ok: true; id: string; version: number }
  | { ok: false; code: DomesticOrderCompletionMutationResultCode; message: string };

export type DomesticOrderMutationResult =
  | {
      ok: true;
      id: string;
      version: number;
      /**
       * 🔴 이번 저장이 **수리 건의 고객 요청 납기일까지 맞췄는가**(2026-10-30).
       * 없으면 맞출 일이 없었다는 뜻이다(날짜가 안 바뀌었거나, 수리 건 쪽이 비어
       * 있어 이 줄의 날짜를 빌려 그리는 중이라 보이는 날짜가 이미 같다).
       *
       * `linked: false` 는 **이 줄은 저장됐는데 수리 건이 안 따라갔다**는 뜻이다.
       * 화면은 그 까닭을 읽어야 닫히는 알림으로 띄운다
       * (domain/requested-due-date-link.ts 머리말 ④).
       */
      requestedDueDateLink?: RequestedDueDateLinkOutcome;
      /**
       * 🔴 이번 저장이 **수리 건의 실제 출하일까지 맞췄는가**(2026-11-08). 없으면
       * 맞출 일이 없었다는 뜻이다(납품일이 안 바뀌었거나, 행에 아무것도 없어 이
       * 줄이 그 건의 출하일을 빌려 그리는 중이라 보이는 날짜가 이미 같다).
       *
       * 🔴 **바로 위 짝과 함께 올 수 있다** — 한 저장이 납기요청일과 납품일을 함께
       * 고칠 수 있기 때문이다. 화면은 둘을 **모아서** 띄운다(하나만 보면 나머지
       * 하나가 조용히 사라진다 — domain/delivered-date-link.ts 머리말).
       */
      deliveredDateLink?: DeliveredDateLinkOutcome;
    }
  | {
      ok: false;
      code: DomesticOrderMutationResultCode;
      fieldErrors?: Record<string, string>;
      message: string;
    };

/**
 * 충돌했을 때 사람에게 보이는 말.
 *
 * `export` 인 이유는 **같은 표를 고치는 다른 경로가 같은 문장을 써야 하기**
 * 때문이다(mutations/domestic-order-issue-dates.ts — 수리 건 상세에서 두 날짜만
 * 고치는 길). 한 글자라도 다르게 적으면 같은 일이 화면마다 다른 말로 설명된다.
 * 🔴 내보내는 것은 이 문장뿐이고, 이 파일의 함수들이 하는 일은 그대로다.
 */
export const VERSION_CONFLICT_MESSAGE =
  "다른 사용자가 이 항목을 먼저 수정했습니다. 최신 정보를 다시 불러온 뒤 시도해 주세요.";

const NOT_FOUND_MESSAGE = "해당 내자 정리 항목을 찾을 수 없습니다.";

const UNKNOWN_REFERENCE_MESSAGE = "입력값을 확인해 주세요.";

/**
 * domestic_orders 에 실제로 쓰는 컬럼 묶음. 추가와 수정이 **같은 표**를 쓰도록
 * 한 함수로 뽑아 둔다 — 두 곳에 나눠 적으면 칸이 하나 늘어날 때 한쪽만 고쳐지고,
 * 그때 생기는 증상은 "추가하면 들어가는데 수정하면 안 들어가는 칸"이다.
 *
 * customer_id 와 형식·L/N·S/N·고장내역도 여기 있다. 폼이 그 다섯을 직접 받기
 * 시작했고(schema/domestic-orders.ts 의 '여기에도 있다'), 빈 값은 null 로
 * 들어와 "연결된 수리 건의 값을 따른다"는 뜻이 된다 — 그러니 이 표에 빠지면
 * 사용자가 고객사를 골라도 저장되지 않는 칸이 된다.
 */
function toColumnValues(fields: DomesticOrderFields) {
  return {
    repairCaseId: fields.repairCaseId,
    intakeNumberText: fields.intakeNumberText,
    customerId: fields.customerId,
    modelNameText: fields.modelNameText,
    lotNumberText: fields.lotNumberText,
    serialNumberText: fields.serialNumberText,
    faultDescriptionText: fields.faultDescriptionText,
    displayOrder: fields.displayOrder,
    purchaseOrderNumber: fields.purchaseOrderNumber,
    projectName: fields.projectName,
    orderIssuedDate: fields.orderIssuedDate,
    // requested_due_date 는 **일부러 여기 없다.** 납기 요청일은 이제
    // domestic_order_due_dates 에 산다(아래 replaceDueDates). 그 칸을 여기 두면
    // 새 폼이 보내지 않는 값이 저장할 때마다 NULL 로 덮여, 아직 남겨 둔 원본이
    // 지워진다 — 칸을 남겨 두기로 한 이유가 바로 그 원본이다
    // (schema/domestic-orders.ts 의 requested_due_date 주석).
    quoteIssuedDate: fields.quoteIssuedDate,
    quoteNumber: fields.quoteNumber,
    // 연결된 견적서. 여기 빠지면 사용자가 골라도 저장되지 않는 칸이 된다.
    quoteId: fields.quoteId,
    progressNote: fields.progressNote,
    deliveredDate: fields.deliveredDate,
    deliveredBy: fields.deliveredBy,
    taxInvoiceDate: fields.taxInvoiceDate,
    amountExcludingVat: fields.amountExcludingVat,
    paymentCompleted: fields.paymentCompleted,
    japanRemittanceNote: fields.japanRemittanceNote,
    historyNote: fields.historyNote,
    etcNote: fields.etcNote,
  };
}

/**
 * 고르려는 수리 건이 실제로 있는가. 없으면 FK 위반(23503)이 나는데, 그 오류는
 * 사용자에게 아무것도 설명하지 못한다 — 어느 칸이 문제인지 말해 주는 편이 낫다.
 *
 * **is_deleted 를 보지 않는 것은 일부러다.** 휴지통에 있는 수리 건이라도 그
 * 건에 대한 정산 기록은 남아야 하고(schema 의 'ON DELETE SET NULL' 항목),
 * 조회 목록도 그런 줄을 그대로 보여 준다. 여기서 막으면 화면에 보이는 연결을
 * 저장할 수 없는 상태가 만들어진다.
 */
async function repairCaseExists(tx: Tx, repairCaseId: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: repairCases.id })
    .from(repairCases)
    .where(eq(repairCases.id, repairCaseId))
    .limit(1);
  return Boolean(row);
}

/**
 * 고르려는 고객사가 실제로 있는가. 수리 건과 같은 이유로 미리 본다 —
 * customer_id 는 customers 를 RESTRICT 로 가리키므로 없는 id 를 넣으면 23503 이
 * 나고, 그 오류는 사용자에게 아무것도 설명하지 못한다.
 *
 * 여기서도 is_deleted 를 보지 않는다. 휴지통에 있는 고객사가 이미 적혀 있는
 * 줄은 목록에 그대로 보이는데, 그 줄의 다른 칸을 고치려 할 때 고객사 때문에
 * 저장이 막히면 화면에 보이는 값을 저장할 수 없는 상태가 된다. 새로 고르는
 * 목록에서 빼는 일은 조회 쪽이 한다(queries 의 listCustomerOptions).
 */
async function customerExists(tx: Tx, customerId: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: customers.id })
    .from(customers)
    .where(eq(customers.id, customerId))
    .limit(1);
  return Boolean(row);
}

/**
 * 이 행이 가리키는 두 곳(수리 건 · 고객사)이 실제로 있는지 한 번에 본다.
 * 문제가 없으면 null 이다.
 *
 * 추가와 수정이 같은 검사를 쓰게 묶어 둔다 — toColumnValues 를 한 곳에 둔 것과
 * 같은 이유다. 나눠 적으면 "추가할 때는 걸러지는데 수정할 때는 FK 오류가 나는"
 * 차이가 생긴다.
 */
async function checkReferences(
  tx: Tx,
  fields: DomesticOrderFields
): Promise<DomesticOrderMutationResult | null> {
  if (fields.repairCaseId && !(await repairCaseExists(tx, fields.repairCaseId))) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      fieldErrors: { repairCaseId: "선택한 수리 건을 찾을 수 없습니다." },
      message: UNKNOWN_REFERENCE_MESSAGE,
    };
  }
  if (fields.customerId && !(await customerExists(tx, fields.customerId))) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      fieldErrors: { customerId: "선택한 고객사를 찾을 수 없습니다." },
      message: UNKNOWN_REFERENCE_MESSAGE,
    };
  }
  return null;
}

/**
 * 이 줄의 납기 요청일을 **받은 목록 그대로** 만든다 — 전부 지우고 다시 넣는다.
 *
 * ── 왜 지우고 다시 넣는가 ───────────────────────────────────────────────
 * 폼은 목록을 통째로 편집한다(줄을 더하고, 빼고, 순서대로 늘어놓는다). 그러니
 * 저장이 받는 것은 "이 줄의 납기일은 지금부터 이것이 전부"라는 말이고, 그
 * 말을 그대로 옮기는 방법이 이것이다. 하나씩 대조해 넣고 빼는 방식은 같은
 * 결과를 훨씬 어렵게 만들 뿐이고, 그 어려움은 "폼에서 지웠는데 남아 있는 날짜"
 * 같은 모양으로 드러난다.
 *
 * ⚠️ **반드시 domestic_order_id 로 좁힌다.** 조건 없는 delete 는 이 표를
 * 통째로 비운다 — 이 줄의 날짜를 고치는 일이 다른 모든 줄의 날짜를 지우는
 * 일이 되어서는 안 된다.
 *
 * ⚠️ **반드시 부르는 쪽의 트랜잭션 안에서만** 부른다(tx 를 받는 이유). 부모
 * 저장이 CONFLICT 로 끝나는 길에서는 아예 불리지 않아야 하고, 그 순서는 부르는
 * 쪽이 지킨다.
 *
 * 차례(display_order)는 배열 index + 1 이다. 폼에 늘어놓은 순서가 곧 차례라서
 * (validation 의 DomesticOrderDueDateInput 주석), 조회가 그 차례로 다시 읽으면
 * 사람이 보던 순서가 그대로 돌아온다.
 */
async function replaceDueDates(
  tx: Tx,
  domesticOrderId: string,
  fields: DomesticOrderFields,
  /**
   * 🔴 **지우기 전에 읽어 둔 행들** — 차례대로다(readDueDateRows). 회차별 완료 표시를
   * 되얹는 재료다(아래 '완료 표시를 되얹는다'). 새로 만드는 줄이면 빈 목록이다.
   */
  storedRows: readonly StoredDueDateRow[]
) {
  await tx
    .delete(domesticOrderDueDates)
    .where(eq(domesticOrderDueDates.domesticOrderId, domesticOrderId));

  if (fields.dueDates.length === 0) return;

  await tx.insert(domesticOrderDueDates).values(
    fields.dueDates.map((dueDate, index) => ({
      domesticOrderId,
      dueDate: dueDate.dueDate,
      note: dueDate.note,
      // 🔴 납품 둘도 이 목록이 정한다(2026-11-08). **보내온 목록이 전부**이므로,
      // 부르는 쪽이 이 값을 안 실어 보내면 그 줄의 납품 기록이 함께 사라진다 —
      // 그것을 막는 울타리가 아래 checkDomesticOrderDueDateRows 이고, 보내는
      // 모양을 정하는 자리는 domain/domestic-order-cell-edit.ts 하나다.
      deliveredDate: dueDate.deliveredDate,
      deliveredBy: dueDate.deliveredBy,
      // ── 🔴 **완료 표시를 되얹는다** (2026-11-08) ─────────────────────────
      // 회차별 완료(사용자 결정 7)는 **보내온 목록에 없는 값**이다. 넣게 두면 줄
      // 수정 payload 하나로 승인 없이 완료를 찍을 수 있어서, 폼이 보내는 네 칸에
      // 일부러 넣지 않았다(validation 의 DomesticOrderDueDateInput).
      //
      // 그래서 서버가 제 손으로 다시 적는다 — **같은 차례의 옛 행**에서 가져온다.
      // 🔴 자리로 가져오는 것이 엉뚱한 회차로 밀릴 자리는 울타리가 막는다: 완료된
      // 회차가 있으면 줄 수를 줄이는 저장이 통째로 거절된다
      // (domain/domestic-order-due-date-rows.ts 의 셋째 울타리). 그래서 여기 오는
      // 목록은 **옛 목록보다 짧지 않고**, index 가 그대로 회차 번호를 가리킨다.
      // 🔵 뒤에 새로 더한 회차는 옛 행이 없으므로 `?? null` 로 비워진다 — 새 회차가
      //    완료로 태어나는 길은 없다.
      completedAt: storedRows[index]?.completedAt ?? null,
      completedBy: storedRows[index]?.completedBy ?? null,
      displayOrder: index + 1,
    }))
  );
}

/**
 * 그 줄에 **지금 적혀 있는** 납기요청일 행들 — 날짜와 납품 둘. 비고도 차례도 읽지
 * 않는다(묶기 판정이 보는 것은 날짜뿐이다 — domain/requested-due-date-link.ts 의
 * '차례와 비고는 보지 않는다').
 *
 * 🔴 **replaceDueDates 보다 먼저** 불러야 한다. 그 뒤에 부르면 방금 쓴 값이 나와
 * 「안 바뀌었다」가 되고, 묶기가 영영 일어나지 않는다. 울타리(결정 5)도 같은
 * 까닭으로 이 값을 먼저 쥐고 있어야 한다 — 지운 뒤에는 무엇이 있었는지 알 길이
 * 없다.
 */
type StoredDueDateRow = {
  dueDate: string;
  note: string | null;
  deliveredDate: string | null;
  deliveredBy: string | null;
  /**
   * 🔴 그 회차의 완료 시각(2026-11-08). 셋을 함께 읽는 까닭이 셋이다 — 울타리가
   * 「완료된 회차가 있는가」를 보고, replaceDueDates 가 그 값을 되얹고, 완료 관문이
   * 「어느 회차가 아직인가」를 센다.
   */
  completedAt: Date | null;
  completedBy: string | null;
};

/**
 * 🔴 **차례대로 읽는다**(display_order → due_date). 조회가 화면에 내려보내는 차례와
 * **같아야 한다**(queries/domestic-orders.ts 의 loadDueDates) — 갈리면 사람이 「2차」로
 * 본 회차와 서버가 2번으로 센 회차가 달라진다. 그 번호가 곧 승인이 가리키는 값이다.
 */
async function readDueDateRows(tx: Tx, domesticOrderId: string): Promise<StoredDueDateRow[]> {
  return tx
    .select({
      dueDate: domesticOrderDueDates.dueDate,
      note: domesticOrderDueDates.note,
      deliveredDate: domesticOrderDueDates.deliveredDate,
      deliveredBy: domesticOrderDueDates.deliveredBy,
      completedAt: domesticOrderDueDates.completedAt,
      completedBy: domesticOrderDueDates.completedBy,
    })
    .from(domesticOrderDueDates)
    .where(eq(domesticOrderDueDates.domesticOrderId, domesticOrderId))
    .orderBy(asc(domesticOrderDueDates.displayOrder), asc(domesticOrderDueDates.dueDate));
}

/** 그 행에 **납품 기록이 있는가** — 날짜든 사람이든 하나라도 적혀 있으면 참이다. */
function hasDeliveryRecord(row: {
  deliveredDate: string | null;
  deliveredBy: string | null;
}): boolean {
  return row.deliveredDate !== null || row.deliveredBy !== null;
}

/** 그 줄의 납품일만 차례 없이 — 묶기 판정이 보는 값이다(값만, 빈 것은 뺀다). */
function deliveredDatesOf(rows: readonly { deliveredDate: string | null }[]): string[] {
  return rows
    .map((row) => row.deliveredDate)
    .filter((value): value is string => value !== null);
}

/**
 * 🔴 납기요청일 행을 **더하고 지우는 울타리 둘**(사용자 결정 5 · 9). 막히면 검증
 * 오류를, 통과면 null 을 돌려준다.
 *
 * 🔴 **판정은 여기 적지 않는다** — domain/domestic-order-due-date-rows.ts 하나가
 * 가진다(화면도 같은 함수로 단추를 미리 막는다). 이 함수가 하는 일은 **저장돼
 * 있던 모양과 보내온 모양을 그 판정에 넘기는 것**뿐이다.
 *
 * 🔴 **replaceDueDates 보다 먼저, 그리고 UPDATE 보다 먼저** 불러야 한다. 거절로
 * 끝나는 저장이 줄의 다른 칸을 이미 바꿔 놓으면 「거절됐는데 반은 저장된」 상태가
 * 남는다.
 */
function checkDueDateRowGuard(params: {
  storedRows: readonly StoredDueDateRow[];
  storedRepairCaseId: string | null;
  fields: DomesticOrderFields;
}): DomesticOrderMutationResult | null {
  const guard = checkDomesticOrderDueDateRows({
    storedRows: params.storedRows.map((row) => ({
      hasDelivery: hasDeliveryRecord(row),
      // 🔴 판정은 completed_at 하나로만 한다(그 표의 칸 주석과 같은 규칙).
      isCompleted: row.completedAt !== null,
    })),
    // 🔴 **보내온 목록에는 완료 표시가 없다** — 그래서 전부 거짓으로 넘긴다. 셋째
    //    울타리가 「보내온 쪽」이 아니라 **「저장돼 있던 쪽에 완료가 있는가」**만 보는
    //    것이 그 까닭이다(그 파일의 '완료 표시는 자리로 따라간다').
    nextRows: params.fields.dueDates.map((row) => ({
      hasDelivery: hasDeliveryRecord(row),
      isCompleted: false,
    })),
    storedRepairCaseId: params.storedRepairCaseId,
    nextRepairCaseId: params.fields.repairCaseId,
  });
  if (guard.ok) return null;
  return {
    ok: false,
    code: "VALIDATION_ERROR",
    fieldErrors: { [guard.field]: guard.message },
    message: guard.message,
  };
}

/**
 * ============================================================================
 * 🔴 납기요청일을 고치면 **수리 건의 고객 요청 납기일도 함께** (2026-10-30)
 * ============================================================================
 * 거울 방향(수리 건 → 내자)은 mutations/repair-cases.ts 에 있고, **무엇을 할지
 * 정하는 규칙은 두 방향이 같은 파일 하나를 부른다**
 * (domain/requested-due-date-link.ts 의 resolveRepairCaseDueDateWriteThrough).
 * 이 함수가 하는 일은 재료를 읽어 와 넘기고, WRITE 면 그 한 칸을 고치는 것뿐이다.
 *
 * ── 🔴 잠그는 차례 ──────────────────────────────────────────────────────
 * 부르는 쪽이 **이 줄을 이미 쥐고 있다**(고치기는 `FOR UPDATE` 로 잡아 두었고,
 * 만들기는 방금 INSERT 한 줄이라 그 트랜잭션의 것이다). 그다음에 여기서 수리 건을
 * 잠근다 — 거울 방향도 「내자 줄 먼저, 수리 건 나중」이라 차례가 같다. 반대로 적으면
 * 두 사람이 같은 건을 동시에 고칠 때 교착이 난다.
 *
 * 🔵 **같은 건의 다른 줄들은 잠그지 않는다.** 거기서 읽는 것은 「날짜가 몇 개인가」
 * 하나뿐이고, 그 줄들까지 잡으면 서로 다른 줄을 고치는 두 저장이 반대 차례로 잠그게
 * 되어 교착이 생긴다.
 *
 * ── 🔴 수리 건을 **갈아 끼운 저장**은 묶지 않는다 ───────────────────────
 * `줄 수정` 폼은 이 줄이 가리키는 수리 건 자체를 바꿀 수 있다. 그때 이 줄의 날짜를
 * 새 수리 건에 밀어 넣으면, 사람이 고른 적 없는 날짜가 그 건에 적힌다(그리고 옛
 * 건에서는 아무 일도 일어나지 않아 두 건이 동시에 어긋난다). 연결을 바꾼 저장은
 * 날짜를 건드리지 않고, 다음에 날짜를 고칠 때 비로소 묶인다.
 * ============================================================================
 */
async function applyRepairCaseDueDateLink(
  tx: Tx,
  params: {
    /** 이 줄이 가리키는 수리 건. 연결이 없으면 null 이고 할 일도 없다. */
    repairCaseId: string | null;
    domesticOrderId: string;
    previousDueDates: readonly string[];
    nextDueDates: readonly string[];
  }
): Promise<RequestedDueDateLinkOutcome | null> {
  if (params.repairCaseId === null) return null;

  // 🔴 수리 건을 잠근 채 읽는다 — 읽고 쓰는 사이에 남이 그 칸을 고치면 낡은 값으로
  // 판정한 저장이 남의 날짜를 덮는다. 휴지통에 든 건은 건드리지 않는다(화면 어디에도
  // 없는 건의 칸을 이 저장이 바꾸면 안 된다).
  const [target] = await tx
    .select({
      id: repairCases.id,
      customerRequestedDueDate: repairCases.customerRequestedDueDate,
      receivedAt: repairCases.receivedAt,
    })
    .from(repairCases)
    .where(and(eq(repairCases.id, params.repairCaseId), eq(repairCases.isDeleted, false)))
    .for("update");
  if (!target) return null;

  // 같은 건에 붙은 **다른** 살아 있는 줄들 — 날짜가 몇 개인지만 센다.
  const otherLines = await tx
    .select({
      id: domesticOrders.id,
      dueDateCount: sql<number>`(
        select count(*) from ${domesticOrderDueDates}
        where ${domesticOrderDueDates.domesticOrderId} = ${domesticOrders.id}
      )`,
    })
    .from(domesticOrders)
    .where(
      and(
        eq(domesticOrders.repairCaseId, params.repairCaseId),
        eq(domesticOrders.isDeleted, false),
        ne(domesticOrders.id, params.domesticOrderId)
      )
    );

  const plan = resolveRepairCaseDueDateWriteThrough({
    editedLine: {
      previousDueDates: params.previousDueDates,
      nextDueDates: params.nextDueDates,
    },
    // count(*) 는 드라이버에 따라 글자로 온다 — 숫자로 못 박아 넘긴다.
    otherLines: otherLines.map((line) => ({ dueDateCount: Number(line.dueDateCount) })),
    customerRequestedDueDate: target.customerRequestedDueDate,
    receivedAt: target.receivedAt,
  });

  if (plan.kind === "NONE") return null;
  if (plan.kind === "NOT_LINKED") return plan.outcome;

  await tx
    .update(repairCases)
    .set({
      customerRequestedDueDate: plan.dueDate,
      // 🔴 version 을 올린다. 안 올리면 **열려 있던 수리 건 상세**가 낡은 version 으로
      // 저장해도 통과하고, 그 저장이 방금 맞춘 날짜를 제 옛 값으로 되돌린다.
      version: sql`${repairCases.version} + 1`,
      updatedAt: sql`now()`,
    })
    .where(eq(repairCases.id, params.repairCaseId));
  return { linked: true };
}

/**
 * ============================================================================
 * 🔴 납품일을 고치면 **수리 건의 실제 출하일도 함께** (2026-11-08)
 * ============================================================================
 * 바로 위 applyRepairCaseDueDateLink 와 **같은 모양의 거울**이고, 규칙은 역시
 * 도메인 파일 하나가 가진다(domain/delivered-date-link.ts 의
 * resolveRepairCaseShipmentWriteThrough). 이 함수가 하는 일은 재료를 읽어 와
 * 넘기고, WRITE 면 그 한 칸을 고치는 것뿐이다.
 *
 * ── 🔴 잠그는 차례는 위와 **똑같다** ────────────────────────────────────
 * 부르는 쪽이 이 줄을 이미 쥐고 있고(고치기는 `FOR UPDATE`, 만들기는 방금 INSERT
 * 한 줄), 그다음에 여기서 수리 건을 잠근다 — **내자 줄 먼저, 수리 건 나중.**
 * 거울 방향(mutations/repair-cases.ts · mutations/workflow-transitions.ts)도 전부
 * 그 차례다. 하나라도 거꾸로 적으면 두 사람이 같은 건을 동시에 고칠 때 교착이
 * 난다.
 *
 * 🔵 같은 저장에서 위 묶기가 이미 같은 수리 건 행을 `FOR UPDATE` 로 잡았을 수
 * 있다. 같은 트랜잭션이 같은 행을 다시 잡는 것은 **그냥 통과한다**(이미 제 것이다)
 * — 그래서 둘을 한 함수로 합치지 않았다: 합치면 「납기요청일 묶기」와 「납품일
 * 묶기」의 멈추는 자리가 한 덩어리가 되어, 한쪽을 고칠 때 다른 쪽이 따라 움직인다.
 *
 * ── 🔴 **같은 건의 다른 줄들은 잠그지 않는다** ──────────────────────────
 * 거기서 읽는 것은 「납품 기록이 몇인가」 하나뿐이고, 그 줄들까지 잡으면 서로 다른
 * 줄을 고치는 두 저장이 반대 차례로 잠그게 되어 교착이 생긴다(위와 같다).
 *
 * ── 🔴 수리 건을 **갈아 끼운 저장**은 묶지 않는다 ───────────────────────
 * 위와 같다 — 부르는 쪽이 연결이 그대로일 때만 이 함수를 부른다.
 * ============================================================================
 */
async function applyRepairCaseShipmentLink(
  tx: Tx,
  params: {
    repairCaseId: string | null;
    domesticOrderId: string;
    previousDeliveredDates: readonly string[];
    nextDeliveredDates: readonly string[];
  }
): Promise<DeliveredDateLinkOutcome | null> {
  if (params.repairCaseId === null) return null;

  // 🔴 수리 건을 잠근 채 읽는다 — 읽고 쓰는 사이에 남이 그 칸을 고치면 낡은 값으로
  // 판정한 저장이 남의 날짜를 덮는다. 휴지통에 든 건은 건드리지 않는다.
  const [target] = await tx
    .select({
      id: repairCases.id,
      actualShipmentDate: repairCases.actualShipmentDate,
      receivedAt: repairCases.receivedAt,
    })
    .from(repairCases)
    .where(and(eq(repairCases.id, params.repairCaseId), eq(repairCases.isDeleted, false)))
    .for("update");
  if (!target) return null;

  // 같은 건에 붙은 **다른** 살아 있는 줄들 — 납품 기록이 몇인지만 센다.
  const otherLines = await tx
    .select({
      id: domesticOrders.id,
      deliveredCount: sql<number>`(
        select count(*) from ${domesticOrderDueDates}
        where ${domesticOrderDueDates.domesticOrderId} = ${domesticOrders.id}
          and ${domesticOrderDueDates.deliveredDate} is not null
      )`,
    })
    .from(domesticOrders)
    .where(
      and(
        eq(domesticOrders.repairCaseId, params.repairCaseId),
        eq(domesticOrders.isDeleted, false),
        ne(domesticOrders.id, params.domesticOrderId)
      )
    );

  const plan = resolveRepairCaseShipmentWriteThrough({
    editedLine: {
      previousDeliveredDates: params.previousDeliveredDates,
      nextDeliveredDates: params.nextDeliveredDates,
    },
    // count(*) 는 드라이버에 따라 글자로 온다 — 숫자로 못 박아 넘긴다.
    otherLines: otherLines.map((line) => ({ deliveredCount: Number(line.deliveredCount) })),
    repairCaseActualShipmentDate: target.actualShipmentDate,
    receivedAt: target.receivedAt,
  });

  if (plan.kind === "NONE") return null;
  if (plan.kind === "NOT_LINKED") return plan.outcome;

  await tx
    .update(repairCases)
    .set({
      actualShipmentDate: plan.date,
      // 🔴 version 을 올린다. 안 올리면 **열려 있던 수리 건 상세**가 낡은 version 으로
      // 저장해도 통과하고, 그 저장이 방금 맞춘 날짜를 제 옛 값으로 되돌린다.
      version: sql`${repairCases.version} + 1`,
      updatedAt: sql`now()`,
    })
    .where(eq(repairCases.id, params.repairCaseId));
  return { linked: true };
}

/** 새 줄 하나. version 은 스키마 기본값 1로 시작한다. */
export async function createDomesticOrder(params: {
  fields: DomesticOrderFields;
  actorUserId: string;
}): Promise<DomesticOrderMutationResult> {
  return db.transaction(async (tx): Promise<DomesticOrderMutationResult> => {
    const badReference = await checkReferences(tx, params.fields);
    if (badReference) return badReference;

    // 🔴 새 줄에는 저장돼 있던 행이 없다(빈 목록). 그래서 결정 5 는 걸릴 일이 없고,
    //    걸리는 것은 결정 9 뿐이다 — **수리 건을 붙이면서 납기요청일을 둘 이상 달고
    //    들어오는 줄**은 여기서 거절된다(그 함수의 「늘리는가」).
    const badRows = checkDueDateRowGuard({
      storedRows: [],
      storedRepairCaseId: null,
      fields: params.fields,
    });
    if (badRows) return badRows;

    const [inserted] = await tx
      .insert(domesticOrders)
      .values({
        ...toColumnValues(params.fields),
        createdBy: params.actorUserId,
        // 만든 사람이 곧 마지막으로 고친 사람이다. 여기를 비워 두면 목록에서
        // "누가 마지막으로 손댔는가"가 첫 수정 전까지 빈칸으로 남는다.
        updatedBy: params.actorUserId,
      })
      .returning({ id: domesticOrders.id, version: domesticOrders.version });

    // 같은 트랜잭션 안이다 — 날짜를 넣다 실패하면 방금 만든 줄도 함께 없던
    // 일이 된다. 날짜만 빠진 줄이 남는 편이 더 나쁘다: 화면에는 정상으로
    // 보이는데 사람이 적은 납기일만 사라진 상태다.
    // 🔴 방금 만든 줄이라 **되얹을 옛 행이 없다**(빈 목록). 새 회차가 완료로 태어나는
    //    길은 그래서 아예 없다.
    await replaceDueDates(tx, inserted.id, params.fields, []);

    // 🔴 새 줄에 적은 납기요청일도 수리 건과 묶는다(2026-10-30). 앞 값은 빈 목록이다
    // — 방금 생긴 줄이라 「고치기 전」이 없다. 수리 건 쪽이 비어 있으면 아무 일도
    // 일어나지 않는다(그 건은 이 줄의 날짜를 빌려 그린다).
    const link = await applyRepairCaseDueDateLink(tx, {
      repairCaseId: params.fields.repairCaseId,
      domesticOrderId: inserted.id,
      previousDueDates: [],
      nextDueDates: params.fields.dueDates.map((entry) => entry.dueDate),
    });

    // 🔴 새 줄에 적은 납품일도 수리 건과 묶는다(2026-11-08). 앞 값은 빈 목록이다.
    // 아직 출하 전인 건이면 **밀어 넣지 않고 말한다**(그 도메인 파일 머리말 ⑤ —
    // 그 칸은 종 알림 넷의 침묵 스위치다).
    const deliveredLink = await applyRepairCaseShipmentLink(tx, {
      repairCaseId: params.fields.repairCaseId,
      domesticOrderId: inserted.id,
      previousDeliveredDates: [],
      nextDeliveredDates: deliveredDatesOf(params.fields.dueDates),
    });

    return {
      ok: true,
      id: inserted.id,
      version: inserted.version,
      ...(link ? { requestedDueDateLink: link } : {}),
      ...(deliveredLink ? { deliveredDateLink: deliveredLink } : {}),
    };
  });
}

/** 한 줄을 통째로 고친다. 칸 하나씩 고치는 경로는 없다(파일 헤더 참조). */
export async function updateDomesticOrder(params: {
  id: string;
  expectedVersion: number;
  fields: DomesticOrderFields;
  actorUserId: string;
}): Promise<DomesticOrderMutationResult> {
  return db.transaction(async (tx): Promise<DomesticOrderMutationResult> => {
    const [current] = await tx
      .select({
        id: domesticOrders.id,
        version: domesticOrders.version,
        // 🔴 묶기가 본다 — 이 저장이 **가리키는 수리 건 자체를 바꾸는 중**이면
        // 날짜를 밀어 넣지 않는다(applyRepairCaseDueDateLink 머리말).
        repairCaseId: domesticOrders.repairCaseId,
      })
      .from(domesticOrders)
      .where(and(eq(domesticOrders.id, params.id), eq(domesticOrders.isDeleted, false)))
      .for("update");

    // 없는 id 와 이미 지워진 행을 같은 답으로 묶는다. 둘을 구분해 알려 주면
    // "그 id 는 존재하지만 지워졌다"는 사실이 새어 나간다.
    if (!current) {
      return { ok: false, code: "NOT_FOUND", message: NOT_FOUND_MESSAGE };
    }

    if (current.version !== params.expectedVersion) {
      return { ok: false, code: "CONFLICT", message: VERSION_CONFLICT_MESSAGE };
    }

    const badReference = await checkReferences(tx, params.fields);
    if (badReference) return badReference;

    // 🔴 **replaceDueDates 보다 먼저** 읽는다 — 묶기는 「이 저장이 날짜를 실제로
    // 바꿨는가」를 전·후로 가른다(그 함수 머리말). 뒤에 읽으면 언제나 「안 바뀜」이다.
    // 🔴 울타리(결정 5)도 이 값을 쥐고 있어야 한다 — 지운 뒤에는 무엇이 있었는지
    // 알 길이 없다.
    const previousRows = await readDueDateRows(tx, params.id);
    const previousDueDates = previousRows.map((row) => row.dueDate);

    // 🔴 **UPDATE 보다 먼저** 막는다 — 거절로 끝나는 저장이 이 줄의 다른 칸을 이미
    // 바꿔 놓으면 「거절됐는데 반은 저장된」 상태가 남는다.
    const badRows = checkDueDateRowGuard({
      storedRows: previousRows,
      storedRepairCaseId: current.repairCaseId,
      fields: params.fields,
    });
    if (badRows) return badRows;

    const [updated] = await tx
      .update(domesticOrders)
      .set({
        ...toColumnValues(params.fields),
        version: sql`${domesticOrders.version} + 1`,
        updatedAt: new Date(),
        updatedBy: params.actorUserId,
      })
      // 잠금을 쥐고 있으므로 version 조건 없이도 안전하지만, 그대로 한 번 더
      // 적는다 — 이 저장소의 다른 mutation 들이 0행 갱신을 마지막 안전망으로
      // 쓰는 방식과 같고, 잠금 방식을 나중에 바꿔도 이 조건은 남는다.
      .where(and(eq(domesticOrders.id, params.id), eq(domesticOrders.version, params.expectedVersion)))
      .returning({ id: domesticOrders.id, version: domesticOrders.version });

    if (!updated) {
      return { ok: false, code: "CONFLICT", message: VERSION_CONFLICT_MESSAGE };
    }

    // **여기까지 와야 날짜를 손댄다.** 위의 NOT_FOUND · CONFLICT ·
    // VALIDATION_ERROR 는 전부 이 줄 앞에서 돌아가므로, 그 길로 끝난 저장은
    // 날짜를 한 건도 바꾸지 않는다. 순서가 곧 그 보장이다 — 먼저 지워 놓고
    // version 을 보면, 충돌한 저장이 남의 날짜를 지운 채로 실패한다.
    // 🔴 **아까 읽어 둔 옛 행들을 그대로 넘긴다** — 회차별 완료 표시는 그 안에만
    //    있고, 지운 뒤에는 무엇이 있었는지 알 길이 없다.
    await replaceDueDates(tx, params.id, params.fields, previousRows);

    // 🔴 수리 건의 고객 요청 납기일도 같은 날짜로 맞춘다(2026-10-30). 같은 트랜잭션
    // 안이라 **한쪽만 써지는 일이 없다** — 수리 건 쪽이 실패하면 이 줄의 날짜도 함께
    // 없던 일이 된다. 연결을 갈아 끼우는 저장이면 건드리지 않는다(아래 current 비교).
    const sameLink = current.repairCaseId === params.fields.repairCaseId;
    const link = sameLink
      ? await applyRepairCaseDueDateLink(tx, {
          repairCaseId: params.fields.repairCaseId,
          domesticOrderId: params.id,
          previousDueDates,
          nextDueDates: params.fields.dueDates.map((entry) => entry.dueDate),
        })
      : null;

    // 🔴 납품일도 같은 트랜잭션 안에서 수리 건의 실제 출하일과 맞춘다(2026-11-08).
    // 연결을 갈아 끼우는 저장이면 건드리지 않는 것도 위와 같다 — 사람이 고른 적 없는
    // 날짜가 새 수리 건에 적히고, 옛 건에서는 아무 일도 안 일어나 두 건이 동시에
    // 어긋난다.
    const deliveredLink = sameLink
      ? await applyRepairCaseShipmentLink(tx, {
          repairCaseId: params.fields.repairCaseId,
          domesticOrderId: params.id,
          previousDeliveredDates: deliveredDatesOf(previousRows),
          nextDeliveredDates: deliveredDatesOf(params.fields.dueDates),
        })
      : null;

    return {
      ok: true,
      id: updated.id,
      version: updated.version,
      ...(link ? { requestedDueDateLink: link } : {}),
      ...(deliveredLink ? { deliveredDateLink: deliveredLink } : {}),
    };
  });
}

/**
 * 한 줄을 완료로 표시하거나 그 표시를 거둔다.
 *
 * ── 완료와 해제가 한 함수인 이유 ────────────────────────────────────────
 * 둘로 나누면 잠금·version 대조·updated_by 기록이 두 벌이 되고, 나중에 한쪽만
 * 고쳐지는 날이 온다. 실제로 다른 것은 두 칸에 무엇을 쓰느냐뿐이라
 * 불리언 하나로 가른다.
 *
 * ── 두 칸은 언제나 함께 움직인다 ────────────────────────────────────────
 * 완료면 completed_at 과 completed_by 를 함께 쓰고, 해제면 **둘 다 NULL** 이다.
 * 한쪽만 남기면 "완료 시각은 없는데 완료한 사람은 있는" 행이 생기고, 그때
 * 그 행이 완료인지 아닌지 답할 방법이 없다. 판정은 completed_at 하나로만 한다
 * (schema/domestic-orders.ts 의 completed_at 주석).
 *
 * 그 밖은 updateDomesticOrder 와 같다 — 트랜잭션 + 행 잠금 + version 대조.
 * 완료는 되돌릴 수 있는 조작이지만 그렇다고 남의 저장을 덮어써도 되는 것은
 * 아니다. 낡은 화면에서 누른 '완료'가 그 사이 바뀐 금액·입금 사실과 같은
 * version 을 들고 들어오면, 그 화면은 이미 사실과 다른 것을 보고 있다.
 *
 * ── 🔴 **기타건은 승인이 있어야 완료된다** (2026-11-07) ─────────────────
 * 사용자 결정이다: 「기타건의 경우도 [기타건 최종 출하 승인]이 되야 [내자정리]에서
 * [완료]처리를 할 수 있도록」. 규칙 자체는 여기 적지 않는다 —
 * domain/domestic-order-approval-rules.ts 의 resolveMiscCaseCompletionGate 하나다.
 *
 * ── 🔴 **그 관문이 회차마다 선다** (2026-11-08, 사용자 결정 13) ──────────
 * 「납기 요청일에 대한 최종출하승인이 완료되지 않으면 납기 요청일에 대한 [완료 처리]가
 * 안 되도록」. 이 함수는 **줄 전체를 끝내는 길**이라, 회차 **전부**의 승인을 본다 —
 * 하나라도 아직이면 거절하고 **어느 회차가 막혔는지** 이름을 말한다.
 * 🔵 회차가 0개·1개인 기타건에서는 단위가 하나뿐이라 2026-11-07 과 글자 그대로 같다.
 *
 * 🔴 **통과하면 회차 행에도 완료를 찍는다**(해제면 함께 지운다). 안 찍으면 「줄은
 * 완료인데 회차는 미완료」인 상태가 남아, 회차별 단추가 완료된 줄에서 「아직」이라고
 * 말한다. 🔴 **수리 건이 붙은 줄은 건드리지 않는다** — 그쪽에는 회차 개념이 없고,
 * 찍어 두면 셋째 울타리(완료된 회차가 있으면 줄을 못 지운다)가 수리 건 줄까지
 * 조용히 묶는다. 「수리 건 붙은 줄은 지금과 똑같다」가 이 조각의 완료 기준이다.
 *
 * 🔴 **왜 서버의 울타리가 여기인가.** 완료를 누르는 자리는 화면 둘(표·카드) ·
 * 서버 액션 하나 · PO 가 부르는 통로 하나인데, 그 넷이 전부 이 함수 한 곳으로
 * 모인다(서비스 둘을 거쳐서 온다). 화면이나 서비스에서 막으면 그 층을 거치지 않는
 * 길이 생기는 날 조용히 뚫린다. 접수 건 쪽도 같은 모양이다 — 출하 완료 전이의 승인
 * 관문은 화면이 아니라 mutations/workflow-transitions.ts 안에 있다.
 *
 * 🔴 **잠근 행에서 본다.** 승인의 유효함은 「요청 때의 version == 지금 version」이고,
 * 결재 요청 경로도 같은 행을 `FOR UPDATE` 로 잡는다
 * (mutations/domestic-order-approvals.ts) — 둘이 줄을 서므로 「읽고 나서 쓰기까지」
 * 사이에 승인이 생기거나 낡아지는 틈이 없다.
 *
 * 🔵 **막히는 줄은 셋 중 하나도 아니어야 한다**:
 *  · 완료 **해제**(completed === false)는 막지 않는다 — 잠그는 조작이 아니고,
 *    막으면 승인 없이 완료된 옛 줄을 되돌릴 길이 사라진다.
 *  · **수리 건이 붙은 줄**은 막지 않는다 — 그쪽은 이미 전이가 승인을 요구한다
 *    (services/complete-domestic-order.ts). 여기서 또 보면 **기타건 갈래의 승인**을
 *    접수 건에까지 요구하게 되고, 그 결재선은 애초에 다른 갈래다.
 *  · **이미 완료된 줄**은 막지 않는다 — 운영에 승인 없이 완료된 기타건이 있고
 *    (2026-11-07 개발 DB 실측 1건), 같은 요청이 그 줄들을 오류로 만들면 안 된다.
 *    이 관문은 「지금 완료로 넘어가는 줄」에만 선다.
 */
export async function setDomesticOrderCompletion(params: {
  id: string;
  expectedVersion: number;
  /** true 면 완료 처리, false 면 완료 해제. */
  completed: boolean;
  actorUserId: string;
}): Promise<DomesticOrderCompletionMutationResult> {
  return db.transaction(async (tx): Promise<DomesticOrderCompletionMutationResult> => {
    const [current] = await tx
      .select({
        id: domesticOrders.id,
        version: domesticOrders.version,
        // 🔴 승인 관문이 보는 둘 — 「기타건인가」와 「이미 완료인가」.
        repairCaseId: domesticOrders.repairCaseId,
        completedAt: domesticOrders.completedAt,
      })
      .from(domesticOrders)
      .where(and(eq(domesticOrders.id, params.id), eq(domesticOrders.isDeleted, false)))
      .for("update");

    if (!current) {
      return { ok: false, code: "NOT_FOUND", message: NOT_FOUND_MESSAGE };
    }

    if (current.version !== params.expectedVersion) {
      return { ok: false, code: "CONFLICT", message: VERSION_CONFLICT_MESSAGE };
    }

    // 🔴 기타건인가. 이 한 값이 아래 셋을 함께 가른다 — 승인 관문을 세울지, 회차
    //    행에 완료를 찍을지, 회차별 완료를 아예 쓰는 줄인지.
    const isMiscCase = current.repairCaseId === null;

    // 🔴 **version 대조 뒤**다. 앞에 두면 낡은 화면에서 누른 완료가 CONFLICT 대신
    //    「승인이 없다」로 답한다 — 사람은 승인을 받으러 가지만 진짜 문제는 그 사이
    //    남이 줄을 고친 것이고, 승인을 받아 와도 같은 자리에서 또 막힌다.
    if (params.completed && isMiscCase && current.completedAt === null) {
      // 🔴 **회차 전부**를 본다(2026-11-08, 사용자 결정 13). 이 길은 줄 전체를 끝내는
      //    길이라, 하나라도 승인이 아직이면 거절이다.
      const rows = await readDueDateRows(tx, current.id);
      const blocked = await checkMiscCaseCompletionApproval(
        tx,
        current.id,
        current.version,
        domesticOrderDueDateUnits(rows),
        // 🔴 그 줄에 회차가 여럿일 때만 이름을 댄다(그 함수의 nameTheRow 주석).
        rows.length > 1
      );
      if (blocked) return blocked;
    }

    // 완료 시각과 수정 시각이 같은 한 순간을 가리키게 한다 — 두 번 읽으면
    // 같은 저장인데 두 시각이 미세하게 어긋난다.
    const now = new Date();
    const [updated] = await tx
      .update(domesticOrders)
      .set({
        completedAt: params.completed ? now : null,
        completedBy: params.completed ? params.actorUserId : null,
        version: sql`${domesticOrders.version} + 1`,
        updatedAt: now,
        updatedBy: params.actorUserId,
      })
      .where(
        and(eq(domesticOrders.id, params.id), eq(domesticOrders.version, params.expectedVersion))
      )
      .returning({ id: domesticOrders.id, version: domesticOrders.version });

    if (!updated) {
      return { ok: false, code: "CONFLICT", message: VERSION_CONFLICT_MESSAGE };
    }

    // 🔴 회차 행도 줄과 **같은 방향으로** 움직인다(2026-11-08). 안 맞추면 「줄은
    //    완료인데 회차는 아직」인 상태가 남고, 회차별 단추가 완료된 줄에서 「아직」을
    //    말한다. 🔴 **수리 건이 붙은 줄은 건드리지 않는다** — 그쪽에 회차 개념이 없고,
    //    찍어 두면 셋째 울타리가 수리 건 줄의 납기요청일 편집까지 조용히 묶는다.
    if (isMiscCase) {
      if (params.completed) {
        // 이미 찍힌 회차는 **그 시각과 그 사람을 그대로 둔다** — 누가 언제 그 회차를
        // 끝냈는지가 이 줄의 유일한 기록이고, 줄 전체를 끝내는 조작이 그것을 덮을
        // 까닭이 없다.
        await tx
          .update(domesticOrderDueDates)
          .set({ completedAt: now, completedBy: params.actorUserId, updatedAt: now })
          .where(
            and(
              eq(domesticOrderDueDates.domesticOrderId, params.id),
              isNull(domesticOrderDueDates.completedAt)
            )
          );
      } else {
        await tx
          .update(domesticOrderDueDates)
          .set({ completedAt: null, completedBy: null, updatedAt: now })
          .where(eq(domesticOrderDueDates.domesticOrderId, params.id));
      }
    }

    return { ok: true, id: updated.id, version: updated.version };
  });
}

/**
 * ============================================================================
 * 🔴 **회차 하나를 완료로 표시하거나 그 표시를 거둔다** (2026-11-08)
 * ============================================================================
 * 사용자 결정 7: 「납품일이 여러개라면 **각각에 [완료처리]버튼**을 만들어줘」.
 * 결정 8: 「**마지막 분할분이 찍히면 자동으로**」 내자 줄이 완료된다.
 * 결정 13: 「납기 요청일에 대한 최종출하승인이 완료되지 않으면 납기 요청일에 대한
 * [완료 처리]가 안 되도록」.
 *
 * ── 🔴 **기타건 전용이다** ──────────────────────────────────────────────
 * 수리 건이 붙은 줄은 납기요청일을 하나만 가질 수 있고(결정 9 울타리) 완료가 수리
 * 건의 출하 완료까지 함께 움직이는 다른 흐름이다(services/complete-domestic-order.ts).
 * 그 줄에 이 길을 열면 **수리 건을 건드리지 않고 내자 줄만 완료되는 뒷문**이 생긴다.
 *
 * ── 🔴 **`version` 을 올리지 않는다 — 이 함수에서 가장 중요한 한 줄** ────
 * 올리면 이 기능이 **스스로를 먹는다.** 승인의 유효함은 「요청 때의 version == 지금
 * version」이고(resolveApprovalState), 회차마다 승인이 따로 서 있다. 1차를 완료하며
 * version 을 올리면 **그 순간 2차·3차의 승인이 전부 STALE** 이 되어, 사람은 1차를
 * 끝낼 때마다 남은 회차의 승인을 다시 받아야 한다. 그 어긋남은 오류를 내지 않고
 * 「승인했는데 왜 또 승인하라는가」로만 보인다.
 *
 * 🔵 **낙관적 잠금이 약해지지 않는다.** 들어온 `expectedVersion` 은 여전히 대조하고,
 * 줄의 내용을 바꾸는 저장(updateDomesticOrder)은 그대로 version 을 올린다 — 그
 * 사이에 누가 줄을 고쳤으면 여기서 CONFLICT 다. 올리지 않는 것은 **이 조작이 줄의
 * 내용을 한 글자도 바꾸지 않기 때문**이고(회차 행의 완료 두 칸뿐이다), 그래서
 * 「요청 뒤에 내용이 바뀌었는가」라는 물음의 답을 바꿀 이유가 없다.
 * 🔴 줄 전체를 끝내는 setDomesticOrderCompletion 은 **그대로 올린다** — 그쪽은 줄의
 * 칸(completed_at)을 바꾸는 조작이고, 끝난 뒤에 더 받을 승인도 없다.
 *
 * ── 🔴 **마지막 회차가 찍히면 줄이 자동으로 완료된다** (결정 8) ──────────
 * 「마지막」의 뜻을 **「모든 회차가 완료된 순간」**으로 읽었다. 「모든 회차에 납품일이
 * 찍힌 순간」이 아니다 — 그렇게 읽으면 승인을 받지 않은 회차까지 끌고 줄이 완료되어
 * 결정 13 과 정면으로 부딪힌다. 이 읽기에서는 **모든 회차 완료 = 모든 회차 승인됨**
 * 이므로(각 회차가 이 함수를 통과해야 완료된다) 자동 완료가 관문에 막힐 일이 없고,
 * 그래서 여기서 줄 단위 관문을 **다시 세우지 않는다.**
 *
 * ── 🔵 해제는 위로도 번진다 ─────────────────────────────────────────────
 * 회차 하나를 풀면 「모든 회차 완료」가 깨지므로 줄의 완료도 함께 거둔다. 안 그러면
 * 줄은 완료인데 회차는 아닌 상태가 남고, 그 줄은 **다시 완료할 길이 없다**(이미
 * 완료라 줄 단추가 [완료 해제]로 바뀐다).
 *
 * ── 🔴 **완료를 누르면 그 회차의 납품일에 오늘이 찍힌다** (2026-11-08) ────
 * 사용자 요구: 「**1차완료 2차 완료를 누를 때 그 날짜로 납품일이 찍히도록** 해줘.」
 * 출하 완료 전이가 연결된 내자 줄에 같은 일을 하는 것(사용자 결정 6)의 **기타건
 * 판**이고, 규칙도 그 한 벌을 그대로 쓴다(domain/delivered-date-link.ts).
 *
 *  · 🔴 **이미 적힌 납품일은 덮지 않는다.** 사람이 적은 날짜가 이긴다.
 *  · 🔴 **[완료 해제]는 납품일을 지우지 않는다.** 그래서 「완료는 풀렸는데 납품일은
 *    남은」 회차가 생긴다 — **고장이 아니라 정한 모양**이다. 지우려면 납품 편집칸에서
 *    사람이 지운다.
 *  · 🔵 **건드리는 것은 그 회차 한 줄뿐**이다 — `display_order = dueDateRowOrder`
 *    하나를 집어 쓴다(아래 WHERE). 2차 줄은 1차를 완료해도 그대로다.
 *  · 🔵 **version 은 여기서도 안 올라간다**(위 그 한 줄). 납품일을 함께 찍는다고
 *    「요청 뒤에 내용이 바뀌었는가」의 답이 달라질 이유가 없다 — 올리면 남은 회차의
 *    승인이 전부 STALE 이 되어 기능이 스스로를 먹는다.
 * ============================================================================
 */
export async function setDomesticOrderDueDateRowCompletion(params: {
  id: string;
  expectedVersion: number;
  /** 몇 번째 회차인가(1부터). `display_order` 와 같은 번호다. */
  dueDateRowOrder: number;
  /** true 면 그 회차를 완료 처리, false 면 완료 해제. */
  completed: boolean;
  actorUserId: string;
}): Promise<DomesticOrderCompletionMutationResult> {
  return db.transaction(async (tx): Promise<DomesticOrderCompletionMutationResult> => {
    const [current] = await tx
      .select({
        id: domesticOrders.id,
        version: domesticOrders.version,
        repairCaseId: domesticOrders.repairCaseId,
        completedAt: domesticOrders.completedAt,
      })
      .from(domesticOrders)
      .where(and(eq(domesticOrders.id, params.id), eq(domesticOrders.isDeleted, false)))
      .for("update");

    if (!current) {
      return { ok: false, code: "NOT_FOUND", message: NOT_FOUND_MESSAGE };
    }
    if (current.version !== params.expectedVersion) {
      return { ok: false, code: "CONFLICT", message: VERSION_CONFLICT_MESSAGE };
    }
    if (current.repairCaseId !== null) {
      // 🔴 기타건 전용이다(머리말). 화면은 이 단추를 그리지도 않지만, 막는 자리는
      //    화면이 아니라 여기다.
      return {
        ok: false,
        code: "VALIDATION_ERROR",
        message: "수리 건이 연결된 줄은 회차별 완료 처리를 쓰지 않습니다. 줄의 [완료 처리]를 눌러 주세요.",
      };
    }

    // 🔴 **잠근 줄에서 다시 읽는다.** 화면이 보낸 회차 번호가 지금도 있는 번호인지는
    //    여기서만 알 수 있다 — 그 사이 남이 납기요청일을 줄였을 수 있고, 그랬다면
    //    위 version 대조에서 이미 걸린다(줄을 고치는 저장은 version 을 올린다).
    const rows = await readDueDateRows(tx, current.id);
    if (rows.length === 0) {
      return {
        ok: false,
        code: "VALIDATION_ERROR",
        message: "납기요청일 줄이 없어 회차별 완료 처리를 할 수 없습니다. 먼저 납기요청일을 적어 주세요.",
      };
    }
    const index = params.dueDateRowOrder - 1;
    if (!Number.isInteger(params.dueDateRowOrder) || index < 0 || index >= rows.length) {
      return {
        ok: false,
        code: "VALIDATION_ERROR",
        message: "그 회차를 찾을 수 없습니다. 최신 정보를 다시 불러와 주세요.",
      };
    }

    const units = domesticOrderDueDateUnits(rows);
    const now = new Date();

    if (params.completed) {
      // 🔴 **그 회차의 승인 하나만** 본다(결정 13). 다른 회차가 아직이어도 이 회차는
      //    끝낼 수 있다 — 그것이 회차별 완료의 뜻이다.
      const blocked = await checkMiscCaseCompletionApproval(
        tx,
        current.id,
        current.version,
        [units[index]],
        // 🔴 **단위 하나만 넘기므로 길이로는 가릴 수 없다**(그 함수의 nameTheRow 주석).
        //    묻는 것은 「그 줄에 회차가 여럿인가」다 — 여럿이면 어느 회차가 막혔는지
        //    말해야 단추 셋이 전부 같은 말을 하는 일이 없다.
        rows.length > 1
      );
      if (blocked) return blocked;
    }

    // ── 🔴 **완료를 누르면 그 회차의 납품일에 오늘이 찍힌다** (2026-11-08) ──
    // 사용자 요구: 「1차완료 2차 완료를 누를 때 그 날짜로 납품일이 찍히도록」.
    //
    // 🔴 **규칙을 여기 적지 않는다** — 출하 완료 전이가 연결된 내자 줄에 쓰는 그
    //    규칙과 **한 벌**이다(domain/delivered-date-link.ts). 요점은 하나뿐이다:
    //    **이미 적힌 납품일은 덮지 않는다.** 사람이 적어 둔 날짜는 「실제로 보낸 날」
    //    이고 완료를 누른 날과 며칠 어긋나는 것이 정상이라, 자동 처리가 덮으면 그
    //    사실이 말없이 사라진다.
    //
    // 🔴 **[완료 해제] 때는 묻지도 않는다** — 보낸 사실은 완료를 풀었다고 사라지지
    //    않는다(그 파일의 「지우는 쪽은 안 묶는다」). 그래서 「완료는 풀렸는데 납품일은
    //    남은」 회차가 생기고, **그것이 정한 모양**이다.
    //
    // 🔵 「오늘」은 출하 완료 자동 기록과 **같은 방식으로** 만든다
    //    (mutations/workflow-transitions.ts 의 `shippedOn`). 두 자동 기록이 서로 다른
    //    방식으로 날짜를 만들면 같은 날 찍힌 두 값이 하루 어긋날 수 있다.
    // 🔵 **수리 건 쪽으로 밀지 않는다** — 이 길은 기타건 전용이라(바로 위 울타리)
    //    맞출 수리 건이 애초에 없다.
    const deliveredStamp = params.completed
      ? resolveDueDateRowCompletionDeliveredPlan({
          currentDeliveredDate: rows[index].deliveredDate,
          today: new Date().toISOString().slice(0, 10),
        })
      : { kind: "NONE" as const };

    // 🔴 차례(display_order)로 집는다 — 승인이 회차를 가리키는 값과 **같은 번호**다
    //    (schema/repair-case-approvals.ts 의 due_date_row_order 주석).
    // 🔵 납품일은 **쓸 때만** 목록에 넣는다 — `undefined` 를 섞으면 drizzle 이 그
    //    칸을 SET 에서 빼므로 동작은 같지만, 조건을 눈에 보이게 적어 둔다.
    await tx
      .update(domesticOrderDueDates)
      .set({
        completedAt: params.completed ? now : null,
        completedBy: params.completed ? params.actorUserId : null,
        ...(deliveredStamp.kind === "WRITE" ? { deliveredDate: deliveredStamp.date } : {}),
        updatedAt: now,
      })
      .where(
        and(
          eq(domesticOrderDueDates.domesticOrderId, current.id),
          eq(domesticOrderDueDates.displayOrder, params.dueDateRowOrder)
        )
      );

    // ── 🔴 줄의 완료를 **회차들의 결과에 맞춘다** (결정 8) ──────────────
    // 방금 쓴 값을 포함해 다시 센다 — 손으로 셈을 맞추면 「막 지운 회차」 같은 자리에서
    // 어긋난다.
    const allCompleted = rows.every(
      (row, rowIndex) => (rowIndex === index ? params.completed : row.completedAt !== null)
    );
    const nextLineCompleted = allCompleted;
    const lineIsCompleted = current.completedAt !== null;
    if (nextLineCompleted !== lineIsCompleted) {
      await tx
        .update(domesticOrders)
        .set({
          completedAt: nextLineCompleted ? now : null,
          completedBy: nextLineCompleted ? params.actorUserId : null,
          // 🔴 **version 을 올리지 않는다**(머리말의 그 한 줄). 올리면 남은 회차의
          //    승인이 전부 STALE 이 된다.
          updatedAt: now,
          updatedBy: params.actorUserId,
        })
        .where(eq(domesticOrders.id, current.id));
    }

    return { ok: true, id: current.id, version: current.version };
  });
}

/**
 * 기타건의 [완료] 관문 — 막혔으면 거절을, 통과면 `null` 을 돌려준다.
 *
 * 🔴 **판정을 여기 적지 않는다.** 「어느 상태가 통과인가」는 도메인 함수 하나이고
 * (resolveMiscCaseCompletionGate), 「승인이 지금 내용에 유효한가」는 접수 건 승인
 * 카드·결재 대기 조회가 쓰는 그 함수 하나다(resolveApprovalState). 여기서 하는 일은
 * **그 둘이 볼 자료를 트랜잭션 안에서 읽어다 주는 것**뿐이다.
 *
 * 🔴 **회차마다 가장 최근 결재 행 하나씩**(2026-11-08). 다단계 결재선은 단계마다 행을
 * 하나씩 잇는 구조라 **그 회차**의 지금 상태는 언제나 그 회차의 마지막 행이 말한다.
 * 「가장 최근」의 정의(`requested_at` 내림차순)는 상세 [승인] 탭이 쓰는 조회와 **같아야
 * 한다**(queries/domestic-order-approvals.ts) — 갈리면 화면은 「승인 완료」라는데 저장은
 * 거절하는 상태가 된다. 🔴 **회차를 가르는 칸도 같아야 한다**(`due_date_row_order`).
 *
 * 🔴 **보는 회차는 부르는 쪽이 정한다**(`units`). 줄 전체를 끝내는 길은 전부를 넘기고,
 * 회차 하나를 끝내는 길은 그 하나만 넘긴다 — 여기서 「무엇을 봐야 하는가」까지 정하면
 * 두 길이 같은 함수를 부르면서 서로 다른 뜻을 갖게 된다.
 * 🔴 **먼저 막히는 회차를 말한다** — 차례대로 보고 처음 걸린 것에서 멈춘다. 전부
 * 모아서 말하면 문장이 길어지고, 사람이 해야 할 다음 행동은 어차피 하나씩이다.
 *
 * 🔴 **「회차 이름을 말할까」도 부르는 쪽이 정한다**(`nameTheRow`). 넘긴 `units` 의
 * 길이로 가리면 **회차 하나를 끝내는 길에서 영영 이름이 안 나온다** — 그 길은 언제나
 * 단위 하나만 넘기기 때문이다. 묻는 것은 「몇 개를 보고 있나」가 아니라 **「그 줄에
 * 회차가 여럿인가」**이고, 그 답은 줄을 읽은 부르는 쪽만 안다.
 *
 * 🔵 결재선 판은 **막힌 뒤에만** 읽는다. 통과하는 줄에서는 질의가 한 벌 덜 돈다.
 */
async function checkMiscCaseCompletionApproval(
  tx: Tx,
  domesticOrderId: string,
  currentVersion: number,
  units: readonly DomesticOrderDueDateUnit[],
  /**
   * 🔴 막힌 회차의 **이름을 문장에 넣을까.** 그 줄에 회차가 여럿일 때만 참이다 —
   * 하나뿐이면 붙일 말이 없고, 붙이면 2026-11-07 부터 쓰던 문장이 까닭 없이 길어진다
   * (그 문장을 글자로 재는 시험도 그대로 남는다).
   */
  nameTheRow: boolean
): Promise<{ ok: false; code: "APPROVAL_REQUIRED"; message: string } | null> {
  // 🔴 질의 하나로 그 줄의 결재 행을 통째로 걷어 온다 — 회차마다 질의를 던지면 회차가
  //    늘어날수록 질의가 늘고(N+1), 그 사이 트랜잭션이 잡는 시간도 함께 는다.
  const rows = await tx
    .select({
      dueDateRowOrder: repairCaseApprovals.dueDateRowOrder,
      status: repairCaseApprovals.status,
      versionAtRequest: repairCaseApprovals.repairCaseVersionAtRequest,
    })
    .from(repairCaseApprovals)
    .where(eq(repairCaseApprovals.domesticOrderId, domesticOrderId))
    .orderBy(desc(repairCaseApprovals.requestedAt));

  // 🔴 **먼저 온 것이 이긴다** — 위 정렬이 최신을 맨 앞에 둔다(조회 쪽
  //    loadDomesticOrderApprovalStates 와 같은 담기 방식이다).
  const latestByRow = new Map<number, { status: "REQUESTED" | "APPROVED" | "REJECTED"; versionAtRequest: number }>();
  for (const row of rows) {
    // 기타건 행에는 언제나 값이 있다(표의 CHECK). 타입이 그것을 모를 뿐이다.
    if (row.dueDateRowOrder === null) continue;
    if (latestByRow.has(row.dueDateRowOrder)) continue;
    latestByRow.set(row.dueDateRowOrder, {
      status: row.status,
      versionAtRequest: row.versionAtRequest,
    });
  }

  const states: ShipmentApprovalState[] = units.map((unit) => {
    const latest = latestByRow.get(unit.rowOrder) ?? null;
    return resolveApprovalState(
      // 칸 이름이 `repairCase…` 인 까닭은 표의 그 칸 주석에 있다 — 기타건 행에는 내자
      // 줄의 판 번호가 들어 있다.
      latest ? { status: latest.status, repairCaseVersionAtRequest: latest.versionAtRequest } : null,
      currentVersion
    );
  });

  // 🔴 **접는 규칙을 여기 적지 않는다** — 목록 배지·머리 카드 배지가 쓰는 그 함수
  //    하나다(foldDomesticOrderApprovalStates). 두 곳에 적으면 같은 줄이 목록에서는
  //    「출하 대기」인데 눌러 보면 거절되는 상태가 된다.
  if (foldDomesticOrderApprovalStates(states) === "APPROVED") return null;
  const blockedIndex = states.findIndex((state) => state !== "APPROVED");
  const approvalState = states[blockedIndex];
  const blockedLabel = nameTheRow ? units[blockedIndex].label : null;

  // 🔴 **공유 잠금을 잡지 않는다.** 결재 요청 경로는 「판 잠금 → 줄 잠금」 차례로
  //    잡는데(mutations/domestic-order-approvals.ts), 여기는 줄을 이미 잡고 있다 —
  //    같은 잠금을 여기서 또 잡으면 차례가 뒤집혀 두 트랜잭션이 서로를 기다린다.
  //    이 읽기는 **무슨 말을 할지**만 정하므로 그 보증이 필요하지 않다.
  const route = await getCurrentShipmentApprovalRouteChain(tx, DOMESTIC_ORDER_APPROVAL_ROUTE_SCOPE);
  const gate = resolveMiscCaseCompletionGate({
    approvalState,
    routeInForce: isDomesticOrderApprovalRouteInForce(route),
    // 🔴 회차가 하나뿐이면 `null` 이고, 그때 문장은 2026-11-07 의 것과 한 글자도
    //    다르지 않다(위 nameTheRow).
    dueDateRowLabel: blockedLabel,
  });
  // 🔵 APPROVED 는 위에서 이미 돌아갔으므로 여기서 통과가 나오는 길은 없다. 그래도
  //    `allowed` 를 보고 가른다 — 통과 조건이 도메인 한 곳에만 적혀 있어야 한다.
  if (gate.allowed) return null;
  return { ok: false, code: "APPROVAL_REQUIRED", message: gate.message };
}
