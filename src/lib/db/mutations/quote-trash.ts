import "server-only";

import { and, eq, sql } from "drizzle-orm";
import { db } from "../client";
import { quotes } from "../schema";
import { insertAuditLog } from "./audit-logs";

/**
 * ============================================================================
 * 견적서 휴지통 — 지우기와 되살리기
 * ============================================================================
 * mutations/customers-trash.ts 와 같은 자리의 파일이고, 같은 규칙을 따른다.
 * 다른 것은 **대조 토큰**뿐이다 — customers 에는 version 이 없어 updated_at
 * 문자열을 대는데, quotes 에는 version integer 가 있으므로 정수를 댄다
 * (mutations/quotes.ts 의 '동시 수정은 version 으로 막는다').
 *
 * ── 영구 삭제는 없다 ────────────────────────────────────────────────────
 * softDelete 와 restore 만 있다. 견적서는 **고객사에 실제로 나간 문서**이고,
 * 무엇을 얼마에 불렀는지는 그 거래가 끝난 뒤에도 남아야 한다 — attachments 의
 * 증빙 사진, domestic_orders 의 세금계산서와 같은 성질이다. 지금 쓰지도 않을
 * 영구 삭제 경로를 미리 만들어 두면 "이미 정해진 정책"처럼 읽혀서, 정말 필요해질
 * 때 판단해야 할 것(보관 기간은 몇 년인가, 누가 지울 수 있는가)을 판단하지 않고
 * 지나가게 된다.
 *
 * 자동 만료 정리(purge)도 붙이지 않는다. repair-case-trash-retention 처럼
 * 기간을 정하는 일은 회계 자료 보관 정책과 함께 정할 것이고, 이 단계의 결정이
 * 아니다.
 *
 * ── 지운 견적서의 번호는 다시 쓸 수 있다 ───────────────────────────────
 * 발행번호 unique 인덱스가 `is_deleted = false` 로 좁혀져 있어서, 지우는 순간
 * 그 번호가 풀린다(schema/quotes.ts). 그래서 **되살릴 때 번호가 이미 쓰이고
 * 있을 수 있다** — customers 의 '이름이 겹치면 복원할 수 없다'와 같은 상황이고,
 * 같은 방식으로 막고 사람에게 무엇을 해야 하는지 알려 준다.
 *
 * ── 부품 줄은 그대로 남는다 ────────────────────────────────────────────
 * quote_items 는 ON DELETE CASCADE 지만, 소프트 삭제는 행을 실제로 지우지
 * 않으므로 CASCADE 가 돌지 않는다. 되살리면 부품도 그대로 돌아온다.
 * ============================================================================
 */

export type QuoteTrashResultCode = "NOT_FOUND" | "CONFLICT" | "NUMBER_TAKEN";

export type QuoteTrashResult =
  | { ok: true; id: string; version: number }
  | { ok: false; code: QuoteTrashResultCode; message: string };

const CONFLICT_MESSAGE =
  "다른 사용자가 이 견적서를 먼저 수정했습니다. 최신 정보를 다시 불러온 뒤 시도해 주세요.";
const NOT_FOUND_MESSAGE = "해당 견적서를 찾을 수 없습니다.";

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
