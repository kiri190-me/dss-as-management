import "server-only";

import { and, eq, sql } from "drizzle-orm";
import { db } from "../client";
import { domesticOrders, repairCases } from "../schema";
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

const UNKNOWN_REPAIR_CASE_MESSAGE = "입력값을 확인해 주세요.";

/**
 * domestic_orders 에 실제로 쓰는 컬럼 묶음. 추가와 수정이 **같은 표**를 쓰도록
 * 한 함수로 뽑아 둔다 — 두 곳에 나눠 적으면 칸이 하나 늘어날 때 한쪽만 고쳐지고,
 * 그때 생기는 증상은 "추가하면 들어가는데 수정하면 안 들어가는 칸"이다.
 *
 * customer_id 는 여기 없다. 고객사는 이 폼의 편집 대상이 아니고(수리 건에서
 * 조인해 따라온다), 여기 섞으면 수정할 때마다 null 로 덮어써 버린다.
 */
function toColumnValues(fields: DomesticOrderFields) {
  return {
    repairCaseId: fields.repairCaseId,
    intakeNumberText: fields.intakeNumberText,
    displayOrder: fields.displayOrder,
    purchaseOrderNumber: fields.purchaseOrderNumber,
    projectName: fields.projectName,
    orderIssuedDate: fields.orderIssuedDate,
    requestedDueDate: fields.requestedDueDate,
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
async function repairCaseExists(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  repairCaseId: string
): Promise<boolean> {
  const [row] = await tx
    .select({ id: repairCases.id })
    .from(repairCases)
    .where(eq(repairCases.id, repairCaseId))
    .limit(1);
  return Boolean(row);
}

/** 새 줄 하나. version 은 스키마 기본값 1로 시작한다. */
export async function createDomesticOrder(params: {
  fields: DomesticOrderFields;
  actorUserId: string;
}): Promise<DomesticOrderMutationResult> {
  return db.transaction(async (tx): Promise<DomesticOrderMutationResult> => {
    if (params.fields.repairCaseId && !(await repairCaseExists(tx, params.fields.repairCaseId))) {
      return {
        ok: false,
        code: "VALIDATION_ERROR",
        fieldErrors: { repairCaseId: "선택한 수리 건을 찾을 수 없습니다." },
        message: UNKNOWN_REPAIR_CASE_MESSAGE,
      };
    }

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

    if (params.fields.repairCaseId && !(await repairCaseExists(tx, params.fields.repairCaseId))) {
      return {
        ok: false,
        code: "VALIDATION_ERROR",
        fieldErrors: { repairCaseId: "선택한 수리 건을 찾을 수 없습니다." },
        message: UNKNOWN_REPAIR_CASE_MESSAGE,
      };
    }

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
