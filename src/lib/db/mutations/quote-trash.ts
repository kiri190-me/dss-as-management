import "server-only";

import { and, eq, sql } from "drizzle-orm";
import { db } from "../client";
import { domesticOrders, quoteItems, quoteRepairTasks, quoteWorkScopeLines, quotes } from "../schema";
import { insertAuditLog } from "./audit-logs";
import { sumQuoteSupplyAmount } from "@/lib/domain/quote-list";

/**
 * ============================================================================
 * 견적서 휴지통 — 보내기 · 되살리기 · 완전 삭제
 * ============================================================================
 * mutations/customers-trash.ts 와 같은 자리의 파일이고, 같은 규칙을 따른다.
 * 다른 것은 **대조 토큰**뿐이다 — customers 에는 version 이 없어 updated_at
 * 문자열을 대는데, quotes 에는 version integer 가 있으므로 정수를 댄다
 * (mutations/quotes.ts 의 '동시 수정은 version 으로 막는다').
 *
 * ── 다른 휴지통과 같은 3단계다 (2026-09-11 사용자 결정) ─────────────────
 *
 *     휴지통으로 보냄 → 15일 보관(그동안 되살리기) → 완전 삭제
 *
 * 완전 삭제는 두 길로 온다 — 관리자가 휴지통에서 바로 누르는 것(아래
 * permanentlyDeleteQuote)과, 15일이 지나 정리 스크립트가 지우는 것
 * (master-data-purge.ts 의 purgeExpiredQuote). 그 스크립트는 CLI 에서 돌아 이
 * 파일("server-only")을 부를 수 없어서 같은 순서를 따로 적는다(그 파일 머리말의
 * '넘을 수 없는 경계'). 내자 정리 휴지통(domestic-orders-trash.ts)이 본보기다.
 *
 * 처음에는 **영구 삭제도 자동 정리도 두지 않았다.** 견적서는 고객사에 실제로
 * 나간 문서라 무엇을 얼마에 불렀는지가 남아야 하고, 보관 기간은 회계 자료 보관
 * 정책과 함께 정할 일이라고 봤기 때문이다. 2026-09-11 사용자가 그 판단을 뒤집어
 * 다른 휴지통(접수 건·고객사·제품 모델·부품·내자 정리)과 같은 루틴으로 정했다.
 * 지운 뒤에도 "무엇을 얼마에 불렀는가"는 PURGE 감사 로그의 스냅숏(번호·발행일·
 * 금액)으로 답한다 — 아래 '감사 로그' 항목.
 *
 * ── 활성 견적서를 바로 지우는 길은 없다 ─────────────────────────────────
 * 완전 삭제는 **휴지통에 있는 장만** 받는다. 활성 장을 한 번에 없애는 길을
 * 열어 두면 15일 보관이라는 안전장치를 건너뛰는 문이 된다.
 *
 * ── 동시성 ──────────────────────────────────────────────────────────────
 * 세 조작 모두 대상 행을 `.for("update")` 로 잠그고, 기대한 상태(활성 / 휴지통)가
 * 아니면 NOT_FOUND, version 이 어긋나면 CONFLICT 다. 되살리기와 완전 삭제가 같은
 * 순간에 오면 먼저 잠금을 얻은 쪽이 결과를 정하고, 뒤에 온 쪽은 조건
 * (is_deleted = true)을 다시 평가해 NOT_FOUND 로 끝난다.
 *
 * ── 지운 견적서의 번호는 다시 쓸 수 있다 ───────────────────────────────
 * 발행번호 unique 인덱스가 `is_deleted = false` 로 좁혀져 있어서, 지우는 순간
 * 그 번호가 풀린다(schema/quotes.ts). 그래서 **되살릴 때 번호가 이미 쓰이고
 * 있을 수 있다** — customers 의 '이름이 겹치면 복원할 수 없다'와 같은 상황이고,
 * 같은 방식으로 막고 사람에게 무엇을 해야 하는지 알려 준다.
 *
 * 완전 삭제는 이 규칙을 건드리지 않는다. 휴지통의 장은 애초에 그 인덱스에 들어
 * 있지 않으므로(부분 조건 밖), 행이 사라져도 번호를 풀거나 막는 일이 새로
 * 생기지 않는다 — 번호는 휴지통에 넣는 순간 이미 풀려 있었다.
 *
 * ── 딸린 것 ─────────────────────────────────────────────────────────────
 * quotes 를 가리키는 표는 넷이다(schema/quotes.ts · repair-labor.ts ·
 * domestic-orders.ts):
 *   - quote_items · quote_work_scope_lines · quote_repair_tasks — ON DELETE
 *     CASCADE. 소프트 삭제는 행을 지우지 않으므로 CASCADE 가 돌지 않고, 되살리면
 *     그대로 돌아온다. 완전 삭제 때는 DB 가 함께 지운다.
 *   - domestic_orders.quote_id — ON DELETE SET NULL. 내자 정리 줄은 **남고
 *     연결만 풀린다**(세금계산서·입금 사실이 견적서보다 오래 사는 자료다). 그
 *     줄의 조회는 휴지통의 견적서를 이미 빼고 손으로 적은 번호·금액을 보여 주므로
 *     (queries/domestic-orders.ts 의 linkedQuotes 조인), 목록에 보이는 값은 완전
 *     삭제 전후가 같다. 어느 줄의 연결이 풀렸는지는 감사 로그에 id 로 남긴다.
 * 자식을 여기서 먼저 지우지 않는 것은 일부러다 — 스키마가 이미 약속한 일을 코드가
 * 한 번 더 하면, 둘 중 하나가 바뀌었을 때 어느 쪽이 실제로 지웠는지 말할 수
 * 없게 된다(domestic-orders-trash.ts 와 같은 판단).
 *
 * ── 감사 로그에 자유 입력 칸은 넣지 않는다 ──────────────────────────────
 * subject(품명) · fault_description_text(신고증상) · validity · delivery ·
 * payment 는 사람이 자유롭게 적는 칸이라 고객사 사정이 섞일 수 있다(schema/
 * quotes.ts 의 PII 항목). customer_name_text 도 사람이 적어 넣는 글자라 담지
 * 않고 customer_id 로 가리킨다. 부품 줄·작업 내역·수리 작업의 글자도 담지 않고
 * **몇 줄이었는지와 합계 금액**만 남긴다. 스냅숏은 이 장이 무엇이었는지 알아볼
 * 번호와 금액 사실만 담는다 — 아래 PURGE_SNAPSHOT_COLUMNS.
 * ============================================================================
 */

export type QuoteTrashResultCode = "NOT_FOUND" | "CONFLICT" | "NUMBER_TAKEN";

export type QuoteTrashResult =
  | { ok: true; id: string; version: number }
  | { ok: false; code: QuoteTrashResultCode; message: string };

/** 완전 삭제의 결과. 지운 뒤에는 version 이 없으므로 id 만 돌려준다. */
export type QuotePurgeResult =
  | { ok: true; id: string }
  | { ok: false; code: "NOT_FOUND" | "CONFLICT"; message: string };

const CONFLICT_MESSAGE =
  "다른 사용자가 이 견적서를 먼저 수정했습니다. 최신 정보를 다시 불러온 뒤 시도해 주세요.";
const NOT_FOUND_MESSAGE = "해당 견적서를 찾을 수 없습니다.";
const NOT_IN_TRASH_MESSAGE =
  "휴지통에서 해당 견적서를 찾을 수 없습니다. 이미 복원되었거나 삭제되었을 수 있습니다.";

/**
 * PURGE 감사 로그에 남기는 칸. **여기 없는 칸은 로그에 닿지 않는다** — 고르지
 * 않은 값은 스냅숏에 들어갈 방법이 없으므로, 자유 입력 칸을 막는 장치가 곧 이
 * 목록이다(위 '감사 로그' 항목).
 *
 * 형식·L/N·S/N·인수번호는 장비를 알아보는 번호라 넣는다(내자 정리 휴지통과 같은
 * 판단). 작업비의 근거(장비 종류·기본 작업비·통전 차감)도 금액 사실이라 넣는다.
 */
const PURGE_SNAPSHOT_COLUMNS = {
  id: quotes.id,
  version: quotes.version,
  quoteNumber: quotes.quoteNumber,
  kind: quotes.kind,
  quoteDate: quotes.quoteDate,
  repairCaseId: quotes.repairCaseId,
  customerId: quotes.customerId,
  intakeNumberText: quotes.intakeNumberText,
  modelNameText: quotes.modelNameText,
  lotNumberText: quotes.lotNumberText,
  serialNumberText: quotes.serialNumberText,
  workCost: quotes.workCost,
  laborEquipmentKind: quotes.laborEquipmentKind,
  laborBaseCost: quotes.laborBaseCost,
  powerTestExcluded: quotes.powerTestExcluded,
  laborPowerTestDeduction: quotes.laborPowerTestDeduction,
  createdAt: quotes.createdAt,
  isDeleted: quotes.isDeleted,
  deletedAt: quotes.deletedAt,
  deletedBy: quotes.deletedBy,
  deleteReason: quotes.deleteReason,
};

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * 지우기 직전에 딸린 것을 센다 — 무엇이 함께 사라지는지(자식 셋)와 어느 내자
 * 정리 줄의 연결이 풀리는지를 감사 로그에 남기기 위해서다.
 *
 * 부르는 쪽이 이미 견적서 행을 FOR UPDATE 로 쥐고 있어서, 여기서 읽은 내자 정리
 * 줄 목록은 지울 때까지 늘지 않는다 — 새로 이 견적서를 가리키려는 쓰기는 FK
 * 검사가 그 행에 거는 KEY SHARE 잠금에서 기다리게 된다.
 */
async function readPurgeFacts(tx: Tx, quoteId: string, workCost: string) {
  const items = await tx
    .select({ quantity: quoteItems.quantity, unitPrice: quoteItems.unitPrice })
    .from(quoteItems)
    .where(eq(quoteItems.quoteId, quoteId));
  const [scopeLines] = await tx
    .select({ total: sql<number>`count(*)::int` })
    .from(quoteWorkScopeLines)
    .where(eq(quoteWorkScopeLines.quoteId, quoteId));
  const [repairTasks] = await tx
    .select({ total: sql<number>`count(*)::int` })
    .from(quoteRepairTasks)
    .where(eq(quoteRepairTasks.quoteId, quoteId));
  // 휴지통의 내자 줄도 센다 — 그 줄도 연결이 풀리기는 마찬가지다.
  const linkedOrders = await tx
    .select({ id: domesticOrders.id })
    .from(domesticOrders)
    .where(eq(domesticOrders.quoteId, quoteId));

  return {
    // 목록·내자 정리가 쓰는 것과 같은 셈법(domain/quote-list.ts), 같은 모양(소수 둘째 자리).
    supplyAmount: sumQuoteSupplyAmount(items, workCost).toFixed(2),
    purgedItemCount: items.length,
    purgedWorkScopeLineCount: scopeLines.total,
    purgedRepairTaskCount: repairTasks.total,
    unlinkedDomesticOrderIds: linkedOrders.map((order) => order.id),
  };
}

function numberTakenMessage(quoteNumber: string): string {
  return `같은 발행번호(${quoteNumber})의 견적서가 이미 있어 되살릴 수 없습니다. 그 견적서의 번호를 바꾼 뒤 다시 시도해 주세요.`;
}

/**
 * 휴지통으로 보낸다. 목록에서 사라지고, 주소로도 열 수 없고, 견적서 파일도
 * 나오지 않는다(라우트와 조회가 모두 is_deleted 로 좁힌다).
 */
export async function softDeleteQuote(params: {
  quoteId: string;
  expectedVersion: number;
  actorUserId: string;
  reason: string | null;
}): Promise<QuoteTrashResult> {
  return db.transaction(async (tx): Promise<QuoteTrashResult> => {
    const [current] = await tx
      .select({
        id: quotes.id,
        version: quotes.version,
        quoteNumber: quotes.quoteNumber,
        quoteDate: quotes.quoteDate,
        // 품명·신고증상은 일부러 고르지 않는다 — 고객사 사정이 섞이는 값이라
        // audit_logs.previous_value 에 닿으면 안 된다(customers-trash 와 같은 판단).
      })
      .from(quotes)
      .where(and(eq(quotes.id, params.quoteId), eq(quotes.isDeleted, false)))
      .for("update");

    if (!current) return { ok: false, code: "NOT_FOUND", message: NOT_FOUND_MESSAGE };
    if (current.version !== params.expectedVersion) {
      return { ok: false, code: "CONFLICT", message: CONFLICT_MESSAGE };
    }

    const [updated] = await tx
      .update(quotes)
      .set({
        isDeleted: true,
        deletedAt: new Date(),
        deletedBy: params.actorUserId,
        deleteReason: params.reason,
        version: sql`${quotes.version} + 1`,
        updatedAt: new Date(),
        updatedBy: params.actorUserId,
      })
      .where(eq(quotes.id, params.quoteId))
      .returning({ id: quotes.id, version: quotes.version });

    await insertAuditLog(tx, {
      actorUserId: params.actorUserId,
      actionType: "SOFT_DELETE",
      targetEntity: "quotes",
      targetRecordId: current.id,
      previousValue: { quoteNumber: current.quoteNumber, quoteDate: current.quoteDate, isDeleted: false },
      newValue: { isDeleted: true, deleteReason: params.reason },
    });

    return { ok: true, id: updated.id, version: updated.version };
  });
}

/**
 * 휴지통에서 되살린다. 발행번호가 그 사이에 다른 견적서에 쓰였으면 거절한다 —
 * 위 '번호는 다시 쓸 수 있다' 항목 참조.
 */
export async function restoreQuote(params: {
  quoteId: string;
  expectedVersion: number;
  actorUserId: string;
}): Promise<QuoteTrashResult> {
  return db.transaction(async (tx): Promise<QuoteTrashResult> => {
    const [current] = await tx
      .select({ id: quotes.id, version: quotes.version, quoteNumber: quotes.quoteNumber })
      .from(quotes)
      .where(and(eq(quotes.id, params.quoteId), eq(quotes.isDeleted, true)))
      .for("update");

    if (!current) return { ok: false, code: "NOT_FOUND", message: NOT_FOUND_MESSAGE };
    if (current.version !== params.expectedVersion) {
      return { ok: false, code: "CONFLICT", message: CONFLICT_MESSAGE };
    }

    // 살아 있는 견적서 중 같은 번호가 있는가. 있으면 되살리는 순간 부분 unique
    // 인덱스가 23505 로 거절하는데, 그 오류는 사람에게 아무것도 설명하지 못한다.
    const [clash] = await tx
      .select({ id: quotes.id })
      .from(quotes)
      .where(and(eq(quotes.quoteNumber, current.quoteNumber), eq(quotes.isDeleted, false)))
      .limit(1);
    if (clash) {
      return { ok: false, code: "NUMBER_TAKEN", message: numberTakenMessage(current.quoteNumber) };
    }

    const [updated] = await tx
      .update(quotes)
      .set({
        isDeleted: false,
        deletedAt: null,
        deletedBy: null,
        deleteReason: null,
        version: sql`${quotes.version} + 1`,
        updatedAt: new Date(),
        updatedBy: params.actorUserId,
      })
      .where(eq(quotes.id, params.quoteId))
      .returning({ id: quotes.id, version: quotes.version });

    await insertAuditLog(tx, {
      actorUserId: params.actorUserId,
      actionType: "RESTORE",
      targetEntity: "quotes",
      targetRecordId: current.id,
      previousValue: { isDeleted: true },
      newValue: { quoteNumber: current.quoteNumber, isDeleted: false },
    });

    return { ok: true, id: updated.id, version: updated.version };
  });
}

/**
 * 15일을 기다리지 않고 휴지통의 견적서를 완전히 지운다. 되돌릴 수 없으므로 사유가
 * 필수다(다른 휴지통의 완전 삭제와 같은 규칙 — 서버 액션이 빈 사유를 막는다).
 *
 * 휴지통에 있는 장만 받는다(위 '활성 견적서를 바로 지우는 길은 없다'). 부품 줄 ·
 * 작업 내역 · 고른 수리 작업은 FK CASCADE 로, 내자 정리 줄의 연결은 SET NULL 로
 * DB 가 처리한다(위 '딸린 것').
 */
export async function permanentlyDeleteQuote(params: {
  quoteId: string;
  expectedVersion: number;
  actorUserId: string;
  reason: string;
}): Promise<QuotePurgeResult> {
  return db.transaction(async (tx): Promise<QuotePurgeResult> => {
    const [current] = await tx
      .select(PURGE_SNAPSHOT_COLUMNS)
      .from(quotes)
      .where(and(eq(quotes.id, params.quoteId), eq(quotes.isDeleted, true)))
      .for("update");

    // 없는 id · 활성 장 · 이미 지워진 장을 같은 답으로 묶는다.
    if (!current) return { ok: false, code: "NOT_FOUND", message: NOT_IN_TRASH_MESSAGE };
    if (current.version !== params.expectedVersion) {
      return { ok: false, code: "CONFLICT", message: CONFLICT_MESSAGE };
    }

    const facts = await readPurgeFacts(tx, params.quoteId, current.workCost);

    const deleted = await tx
      .delete(quotes)
      // 잠금을 쥐고 있어 실제로는 늘 한 행이지만, 0행 쓰기를 마지막 안전망으로
      // 두는 이 저장소의 관례를 그대로 따른다.
      .where(
        and(
          eq(quotes.id, params.quoteId),
          eq(quotes.isDeleted, true),
          eq(quotes.version, params.expectedVersion)
        )
      )
      .returning({ id: quotes.id });

    if (deleted.length === 0) return { ok: false, code: "NOT_FOUND", message: NOT_IN_TRASH_MESSAGE };

    await insertAuditLog(tx, {
      actorUserId: params.actorUserId,
      actionType: "PURGE",
      targetEntity: "quotes",
      targetRecordId: params.quoteId,
      previousValue: {
        ...serializeSnapshot(current),
        ...facts,
        purgeReason: params.reason,
      },
      newValue: null,
    });

    return { ok: true, id: params.quoteId };
  });
}

/**
 * 스냅숏의 시각 칸을 ISO 문자열로 바꾼다 — 다른 휴지통의 PURGE 로그와 같은
 * 모양이다(deletedAt 을 문자열로 남긴다).
 */
function serializeSnapshot<T extends { createdAt: Date; deletedAt: Date | null }>(row: T) {
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
  };
}
