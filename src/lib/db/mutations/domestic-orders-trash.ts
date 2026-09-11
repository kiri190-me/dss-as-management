import "server-only";

import { and, eq, sql } from "drizzle-orm";
import { db } from "../client";
import { domesticOrderDueDates, domesticOrders } from "../schema";
import { insertAuditLog } from "./audit-logs";

/**
 * ============================================================================
 * 내자 정리 휴지통 — 보내기 · 되살리기 · 완전 삭제 (2026-09-11 사용자 결정)
 * ============================================================================
 * 이 저장소의 다른 휴지통(접수 건·고객사·제품 모델·부품)과 같은 3단계다:
 *
 *     휴지통으로 보냄 → 15일 보관(그동안 되살리기) → 완전 삭제
 *
 * 완전 삭제는 두 길로 온다 — 관리자가 휴지통에서 바로 누르는 것(아래
 * permanentlyDeleteDomesticOrder)과, 15일이 지나 정리 스크립트가 지우는 것
 * (master-data-purge.ts 의 purgeExpiredDomesticOrder). 그 스크립트는 CLI 에서
 * 돌아 이 파일("server-only")을 부를 수 없어서 같은 순서를 따로 적는다(그 파일
 * 머리말의 '넘을 수 없는 경계').
 *
 * 이 계층은 **기계**다. 누가 지울 수 있는지는 묻지 않는다 — 서버 액션이
 * hasPermission("domesticOrders", "MANAGE") 로 본다(mutations/domestic-orders.ts
 * 머리말의 계층 구분과 같다).
 *
 * ── 동시성은 version 으로 본다 ──────────────────────────────────────────
 * mutations/domestic-orders.ts 의 수정·완료와 같은 정수 대조다. 세 조작 모두
 * 대상 행을 `.for("update")` 로 잠그고, 기대한 상태(활성 / 휴지통)가 아니면
 * NOT_FOUND, version 이 어긋나면 CONFLICT 다. 보내기와 되살리기는 version 을
 * 올린다 — 낡은 화면이 방금 되살아난 줄을 모르고 다시 지우는 일을 막는다.
 *
 * 두 사람이 같은 순간에 되살리기와 완전 삭제를 누르면, 먼저 잠금을 얻은 쪽이
 * 결과를 정한다. 뒤에 온 쪽은 잠금을 기다렸다가 조건(is_deleted = true)을 다시
 * 평가하므로 — 되살려졌으면 휴지통에 없고, 지워졌으면 행이 없다 — NOT_FOUND 로
 * 끝난다. 0행 쓰기를 조용히 성공으로 넘기지 않는다.
 *
 * ── 활성 줄을 바로 지우는 길은 없다 ─────────────────────────────────────
 * 완전 삭제는 **휴지통에 있는 줄만** 받는다. 활성 줄을 한 번에 없애는 길을
 * 열어 두면 15일 보관이라는 안전장치를 건너뛰는 문이 된다.
 *
 * ── 딸린 것 ─────────────────────────────────────────────────────────────
 * domestic_orders 를 가리키는 표는 domestic_order_due_dates 하나뿐이고 ON DELETE
 * CASCADE 다. 소프트 삭제는 행을 지우지 않으므로 날짜는 그대로 남고, 되살리면
 * 함께 돌아온다. 완전 삭제 때 DB 가 함께 지운다 — 몇 건이었는지는 감사 로그에
 * 남긴다(날짜의 메모는 사람이 적은 글자라 남기지 않는다).
 *
 * ── 감사 로그에 자유 입력 칸은 넣지 않는다 ──────────────────────────────
 * progress_note · history_note · etc_note · delivered_by · japan_remittance_note ·
 * fault_description_text 는 사람이 자유롭게 적는 칸이라 담당자 이름이나 고객사
 * 사정이 섞일 수 있다(schema 헤더의 PII 항목). 스냅숏은 **이 줄이 무엇이었는지
 * 알아볼 식별 칸과 정산 사실**만 담는다 — 아래 AUDIT_SNAPSHOT_COLUMNS.
 * ============================================================================
 */

export type DomesticOrderTrashResultCode = "NOT_FOUND" | "CONFLICT";

export type DomesticOrderTrashResult =
  | { ok: true; id: string }
  | { ok: false; code: DomesticOrderTrashResultCode; message: string };

const NOT_FOUND_MESSAGE = "해당 내자 정리 항목을 찾을 수 없습니다.";
const NOT_IN_TRASH_MESSAGE = "휴지통에서 해당 내자 정리 항목을 찾을 수 없습니다. 이미 복원되었거나 삭제되었을 수 있습니다.";
const CONFLICT_MESSAGE =
  "다른 사용자가 이 항목을 먼저 수정했습니다. 최신 정보를 다시 불러온 뒤 시도해 주세요.";

/**
 * 감사 로그에 남기는 칸. **여기 없는 칸은 로그에 닿지 않는다** — 고르지 않은
 * 값은 스냅숏에 들어갈 방법이 없으므로, 자유 입력 칸을 막는 장치가 곧 이 목록이다.
 *
 * 형식·L/N·S/N 은 장비를 알아보는 번호라 넣고, 고장내역은 넣지 않는다(견적서
 * 휴지통이 신고증상을 넣지 않는 것과 같은 판단 — mutations/quote-trash.ts).
 */
const AUDIT_SNAPSHOT_COLUMNS = {
  id: domesticOrders.id,
  version: domesticOrders.version,
  repairCaseId: domesticOrders.repairCaseId,
  customerId: domesticOrders.customerId,
  quoteId: domesticOrders.quoteId,
  intakeNumberText: domesticOrders.intakeNumberText,
  displayOrder: domesticOrders.displayOrder,
  purchaseOrderNumber: domesticOrders.purchaseOrderNumber,
  projectName: domesticOrders.projectName,
  modelNameText: domesticOrders.modelNameText,
  lotNumberText: domesticOrders.lotNumberText,
  serialNumberText: domesticOrders.serialNumberText,
  orderIssuedDate: domesticOrders.orderIssuedDate,
  quoteIssuedDate: domesticOrders.quoteIssuedDate,
  quoteNumber: domesticOrders.quoteNumber,
  taxInvoiceDate: domesticOrders.taxInvoiceDate,
  amountExcludingVat: domesticOrders.amountExcludingVat,
  paymentCompleted: domesticOrders.paymentCompleted,
  completedAt: domesticOrders.completedAt,
  createdAt: domesticOrders.createdAt,
  isDeleted: domesticOrders.isDeleted,
  deletedAt: domesticOrders.deletedAt,
  deletedBy: domesticOrders.deletedBy,
  deleteReason: domesticOrders.deleteReason,
};

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** 이 줄이 무엇이었는지 — 휴지통으로 보낼 때와 되살릴 때 로그에 남기는 짧은 판. */
function identitySnapshot(row: {
  purchaseOrderNumber: string | null;
  quoteNumber: string | null;
  intakeNumberText: string | null;
  repairCaseId: string | null;
  customerId: string | null;
  displayOrder: number | null;
}) {
  return {
    purchaseOrderNumber: row.purchaseOrderNumber,
    quoteNumber: row.quoteNumber,
    intakeNumberText: row.intakeNumberText,
    repairCaseId: row.repairCaseId,
    customerId: row.customerId,
    displayOrder: row.displayOrder,
  };
}

async function countDueDates(tx: Tx, id: string): Promise<number> {
  const [row] = await tx
    .select({ total: sql<number>`count(*)::int` })
    .from(domesticOrderDueDates)
    .where(eq(domesticOrderDueDates.domesticOrderId, id));
  return row.total;
}

/**
 * 휴지통으로 보낸다. 목록·주간보고·수리 건 상세·고객 안내 현황이 전부
 * is_deleted = false 만 읽으므로 그 모두에서 빠진다. 되돌릴 수 있는 조작이라
 * 사유는 선택이다.
 */
export async function softDeleteDomesticOrder(params: {
  id: string;
  expectedVersion: number;
  actorUserId: string;
  reason: string | null;
}): Promise<DomesticOrderTrashResult> {
  return db.transaction(async (tx): Promise<DomesticOrderTrashResult> => {
    const [current] = await tx
      .select(AUDIT_SNAPSHOT_COLUMNS)
      .from(domesticOrders)
      .where(and(eq(domesticOrders.id, params.id), eq(domesticOrders.isDeleted, false)))
      .for("update");

    // 없는 id 와 이미 휴지통에 있는 줄을 같은 답으로 묶는다 — 수정(mutations/
    // domestic-orders.ts)과 같은 판단이다.
    if (!current) return { ok: false, code: "NOT_FOUND", message: NOT_FOUND_MESSAGE };
    if (current.version !== params.expectedVersion) {
      return { ok: false, code: "CONFLICT", message: CONFLICT_MESSAGE };
    }

    const now = new Date();
    const [updated] = await tx
      .update(domesticOrders)
      .set({
        isDeleted: true,
        deletedAt: now,
        deletedBy: params.actorUserId,
        deleteReason: params.reason,
        version: sql`${domesticOrders.version} + 1`,
        updatedAt: now,
        updatedBy: params.actorUserId,
      })
      // 잠금을 쥐고 있어 실제로는 늘 한 행이지만, 0행 쓰기를 마지막 안전망으로
      // 두는 이 저장소의 관례를 그대로 따른다.
      .where(
        and(
          eq(domesticOrders.id, params.id),
          eq(domesticOrders.isDeleted, false),
          eq(domesticOrders.version, params.expectedVersion)
        )
      )
      .returning({ id: domesticOrders.id });

    if (!updated) return { ok: false, code: "CONFLICT", message: CONFLICT_MESSAGE };

    await insertAuditLog(tx, {
      actorUserId: params.actorUserId,
      actionType: "SOFT_DELETE",
      targetEntity: "domestic_orders",
      targetRecordId: params.id,
      previousValue: { ...identitySnapshot(current), isDeleted: false },
      newValue: { isDeleted: true, deletedAt: now.toISOString(), deleteReason: params.reason },
    });

    return { ok: true, id: updated.id };
  });
}

/** 휴지통에서 되살린다. 휴지통에 있는 줄만 받는다. */
export async function restoreDomesticOrder(params: {
  id: string;
  expectedVersion: number;
  actorUserId: string;
}): Promise<DomesticOrderTrashResult> {
  return db.transaction(async (tx): Promise<DomesticOrderTrashResult> => {
    const [current] = await tx
      .select(AUDIT_SNAPSHOT_COLUMNS)
      .from(domesticOrders)
      .where(and(eq(domesticOrders.id, params.id), eq(domesticOrders.isDeleted, true)))
      .for("update");

    if (!current) return { ok: false, code: "NOT_FOUND", message: NOT_IN_TRASH_MESSAGE };
    if (current.version !== params.expectedVersion) {
      return { ok: false, code: "CONFLICT", message: CONFLICT_MESSAGE };
    }

    const now = new Date();
    const [updated] = await tx
      .update(domesticOrders)
      .set({
        isDeleted: false,
        deletedAt: null,
        deletedBy: null,
        deleteReason: null,
        version: sql`${domesticOrders.version} + 1`,
        updatedAt: now,
        updatedBy: params.actorUserId,
      })
      .where(
        and(
          eq(domesticOrders.id, params.id),
          eq(domesticOrders.isDeleted, true),
          eq(domesticOrders.version, params.expectedVersion)
        )
      )
      .returning({ id: domesticOrders.id });

    if (!updated) return { ok: false, code: "CONFLICT", message: CONFLICT_MESSAGE };

    await insertAuditLog(tx, {
      actorUserId: params.actorUserId,
      actionType: "RESTORE",
      targetEntity: "domestic_orders",
      targetRecordId: params.id,
      previousValue: {
        isDeleted: true,
        deletedAt: current.deletedAt ? current.deletedAt.toISOString() : null,
        deletedBy: current.deletedBy,
        deleteReason: current.deleteReason,
      },
      newValue: { ...identitySnapshot(current), isDeleted: false },
    });

    return { ok: true, id: updated.id };
  });
}

/**
 * 15일을 기다리지 않고 휴지통의 줄을 완전히 지운다. 되돌릴 수 없으므로 사유가
 * 필수다(다른 휴지통의 완전 삭제와 같은 규칙 — 서버 액션이 빈 사유를 막는다).
 *
 * 납기요청일은 FK 의 ON DELETE CASCADE 로 함께 지워진다. 여기서 먼저 지우지
 * 않는 것은 일부러다 — 스키마가 이미 약속한 일을 코드가 한 번 더 하면, 둘 중
 * 하나가 바뀌었을 때 어느 쪽이 실제로 지웠는지 말할 수 없게 된다.
 */
export async function permanentlyDeleteDomesticOrder(params: {
  id: string;
  expectedVersion: number;
  actorUserId: string;
  reason: string;
}): Promise<DomesticOrderTrashResult> {
  return db.transaction(async (tx): Promise<DomesticOrderTrashResult> => {
    const [current] = await tx
      .select(AUDIT_SNAPSHOT_COLUMNS)
      .from(domesticOrders)
      .where(and(eq(domesticOrders.id, params.id), eq(domesticOrders.isDeleted, true)))
      .for("update");

    if (!current) return { ok: false, code: "NOT_FOUND", message: NOT_IN_TRASH_MESSAGE };
    if (current.version !== params.expectedVersion) {
      return { ok: false, code: "CONFLICT", message: CONFLICT_MESSAGE };
    }

    const dueDateCount = await countDueDates(tx, params.id);

    const deleted = await tx
      .delete(domesticOrders)
      .where(
        and(
          eq(domesticOrders.id, params.id),
          eq(domesticOrders.isDeleted, true),
          eq(domesticOrders.version, params.expectedVersion)
        )
      )
      .returning({ id: domesticOrders.id });

    if (deleted.length === 0) return { ok: false, code: "NOT_FOUND", message: NOT_IN_TRASH_MESSAGE };

    await insertAuditLog(tx, {
      actorUserId: params.actorUserId,
      actionType: "PURGE",
      targetEntity: "domestic_orders",
      targetRecordId: params.id,
      previousValue: {
        ...serializeSnapshot(current),
        purgedDueDateCount: dueDateCount,
        purgeReason: params.reason,
      },
      newValue: null,
    });

    return { ok: true, id: params.id };
  });
}

/**
 * 스냅숏의 시각 칸을 ISO 문자열로 바꾼다 — 다른 휴지통의 PURGE 로그와 같은
 * 모양이다(deletedAt 을 문자열로 남긴다). 부품 쪽 PURGE 가 쓰는 purgeReason 도
 * 같은 이름으로 여기 붙는다(부르는 쪽).
 */
function serializeSnapshot<
  T extends { completedAt: Date | null; createdAt: Date; deletedAt: Date | null },
>(row: T) {
  return {
    ...row,
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
  };
}
