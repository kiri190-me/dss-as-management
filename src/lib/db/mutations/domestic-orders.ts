import "server-only";

import { and, eq, sql } from "drizzle-orm";
import { db } from "../client";
import { customers, domesticOrderDueDates, domesticOrders, repairCases } from "../schema";
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

export type DomesticOrderMutationResult =
  | { ok: true; id: string; version: number }
  | {
      ok: false;
      code: DomesticOrderMutationResultCode;
      fieldErrors?: Record<string, string>;
      message: string;
    };

const VERSION_CONFLICT_MESSAGE =
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
async function replaceDueDates(tx: Tx, domesticOrderId: string, fields: DomesticOrderFields) {
  await tx
    .delete(domesticOrderDueDates)
    .where(eq(domesticOrderDueDates.domesticOrderId, domesticOrderId));

  if (fields.dueDates.length === 0) return;

  await tx.insert(domesticOrderDueDates).values(
    fields.dueDates.map((dueDate, index) => ({
      domesticOrderId,
      dueDate: dueDate.dueDate,
      note: dueDate.note,
      displayOrder: index + 1,
    }))
  );
}

/** 새 줄 하나. version 은 스키마 기본값 1로 시작한다. */
export async function createDomesticOrder(params: {
  fields: DomesticOrderFields;
  actorUserId: string;
}): Promise<DomesticOrderMutationResult> {
  return db.transaction(async (tx): Promise<DomesticOrderMutationResult> => {
    const badReference = await checkReferences(tx, params.fields);
    if (badReference) return badReference;

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
    await replaceDueDates(tx, inserted.id, params.fields);

    return { ok: true, id: inserted.id, version: inserted.version };
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
      .select({ id: domesticOrders.id, version: domesticOrders.version })
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
    await replaceDueDates(tx, params.id, params.fields);

    return { ok: true, id: updated.id, version: updated.version };
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
 */
export async function setDomesticOrderCompletion(params: {
  id: string;
  expectedVersion: number;
  /** true 면 완료 처리, false 면 완료 해제. */
  completed: boolean;
  actorUserId: string;
}): Promise<DomesticOrderMutationResult> {
  return db.transaction(async (tx): Promise<DomesticOrderMutationResult> => {
    const [current] = await tx
      .select({ id: domesticOrders.id, version: domesticOrders.version })
      .from(domesticOrders)
      .where(and(eq(domesticOrders.id, params.id), eq(domesticOrders.isDeleted, false)))
      .for("update");

    if (!current) {
      return { ok: false, code: "NOT_FOUND", message: NOT_FOUND_MESSAGE };
    }

    if (current.version !== params.expectedVersion) {
      return { ok: false, code: "CONFLICT", message: VERSION_CONFLICT_MESSAGE };
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

    return { ok: true, id: updated.id, version: updated.version };
  });
}
