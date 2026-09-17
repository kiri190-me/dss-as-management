import "server-only";

import { and, asc, count, eq, inArray, ne } from "drizzle-orm";
import { db } from "../connection";
import { attachments, productModels, quotes, repairCases } from "../schema";
import { guardQuoteAttachmentChange } from "./attachments";
import { insertAuditLog } from "./audit-logs";

/**
 * ============================================================================
 * 첨부 휴지통 — DB에 표시만 하고, 디스크 파일은 남긴다
 * ============================================================================
 * ⚠️ **이 파일은 storage.delete()를 부르지 않는다.** 그것이 이 파일에서 가장
 * 중요한 사실이다.
 *
 * 보안 정책(SECURITY_POLICY.md 10번)이 파일을 *반영구 보관*으로 정하고 있고,
 * 더 실용적인 이유가 있다 — **복원하려면 실물이 있어야 한다.** 지우면서 파일을
 * 함께 없애면 복원 버튼은 남아 있는데 눌러도 빈 기록만 되살아난다. 그건
 * 되돌릴 수 없는 손실이고, 화면은 그 사실을 사용자에게 알려 줄 방법이 없다.
 *
 * 디스크에서 실제로 지우는 절차(영구 삭제)는 **별도 승인 대상**이며 이 파일의
 * 범위가 아니다. 나중에 만들 때도 이 파일에 끼워 넣지 말고, 승인 게이트를 가진
 * 별도 통로로 둘 것.
 *
 * ── 잠긴 접수 건 ────────────────────────────────────────────────────────
 * 출하 완료로 잠긴 건(`repair_cases.is_locked`)에는 파일을 올릴 수 없다
 * (업로드 라우트가 CASE_LOCKED로 막는다). 지우고 되살리는 것도 같은 기준으로
 * 막는다 — 잠금의 뜻이 "이 건의 자료 구성은 확정됐다"인데 첨부만 뺄 수 있으면
 * 그 뜻이 반만 지켜진다.
 *
 * ── 다운로드 감사도 여기 둔다 ────────────────────────────────────────────
 * recordAttachmentDownload는 상태를 바꾸지 않지만 audit_logs에 **쓴다.** 쓰기는
 * mutations에 모아 두는 것이 이 저장소의 규율이고, insertAuditLog가 트랜잭션을
 * 요구하므로 그 트랜잭션을 열 자리가 필요하다.
 *
 * ── 주인이 갈래가 되었다 — 감사 기록도 그것을 알아야 한다 ────────────────
 * 첨부의 주인은 접수 건 아니면 제품 모델이다(schema/attachments.ts의
 * attachments_owner_not_both). 이 파일의 세 감사 기록(FILE_DELETE · RESTORE ·
 * FILE_DOWNLOAD)이 예전처럼 repairCaseId 하나만 실으면 모델 첨부의 기록에는
 * `repairCaseId: null` 만 남고, 그 줄을 읽는 사람은 무슨 파일이었는지 알 수
 * 없다. **감사 기록은 나중에 소급해서 채울 수 없다.**
 *
 * 그래서 업로드 쪽(attachments.ts의 createAttachmentRecord)이 세운 모양을 그대로
 * 따른다 — 어느 주인인지를 먼저 적고 그 주인의 키**만** 싣는다. 계산은
 * ownerAuditFields 한 곳에서 하고, 세 자리가 모두 그것을 쓴다.
 *
 * ── 셋째 주인 — 견적서의 결재 PDF · 수기 엑셀 (2026-09-15 Q2) ─────────────
 * 견적서가 주인인 첨부는 지우고 되살릴 때 **견적서 행을 잠근다**(attachments.ts 의
 * guardQuoteAttachmentChange — 올리기와 같은 잠금). 두 가지를 본다:
 *  - **휴지통의 견적서**에 딸린 파일은 지우지도 되살리지도 못한다(QUOTE_IN_TRASH).
 *    그 파일들은 견적서와 함께 휴지통에 가 있고, 견적서를 되살리면 함께 돌아온다.
 *  - **되살리기는 칸을 다시 본다** — 칸마다 살아 있는 파일은 하나다
 *    (QUOTE_ATTACHMENT_FILES_PER_SLOT). 교체로 밀려난 옛 파일을 되살리려는데 그 칸에
 *    지금 파일이 있으면 SLOT_OCCUPIED 로 거절한다 — 조용히 지금 파일을 밀어내지
 *    않는다(무엇이 휴지통에 갔는지 사람이 모르게 되는 교체는 올리기 통로에서만 한다).
 *
 * 견적서를 휴지통에 넣고 · 되살리고 · 영구 삭제할 때 그 첨부를 함께 다루는 일도 여기
 * 있다(trashAttachmentsOfDeletedQuote · restoreAttachmentsTrashedWithQuote ·
 * listAttachmentIdsOfQuote). 부르는 쪽은 견적서 휴지통 mutation(quote-trash.ts)이고, 그
 * 트랜잭션 안에서 부른다. 15일 정리 CLI(master-data-purge.ts)는 이 파일("server-only")을
 * 부를 수 없어서 첨부 id 를 읽는 한 줄을 따로 적는다.
 * ============================================================================
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type AttachmentTrashFailureCode =
  | "INVALID_ID"
  | "NOT_FOUND"
  | "ALREADY_IN_STATE"
  | "CASE_LOCKED"
  /** 견적서 첨부 — 그 견적서가 휴지통에 있다(2026-09-15 Q2). */
  | "QUOTE_IN_TRASH"
  /** 견적서 첨부 되살리기 — 그 칸에 이미 살아 있는 파일이 있다(2026-09-15 Q2). */
  | "SLOT_OCCUPIED";

export type AttachmentTrashResult =
  | { ok: true; id: string }
  | { ok: false; code: AttachmentTrashFailureCode; message: string };

/** 되살리려는 견적서 첨부의 칸에 이미 파일이 있을 때. 무엇을 하면 되는지까지 말한다. */
export const QUOTE_ATTACHMENT_SLOT_OCCUPIED_MESSAGE =
  "이 칸에는 이미 다른 파일이 붙어 있습니다. 지금 붙어 있는 파일을 먼저 지운 뒤 되살려 주세요.";

/**
 * 이 첨부의 주인을 감사 기록에 어떻게 적을 것인가.
 *
 * **어느 주인인지를 먼저 적고 그 주인의 키만 싣는다** — 업로드 쪽
 * (createAttachmentRecord)과 같은 모양이다. 두 키를 늘 함께 실으면 모델 첨부의
 * 기록에 `repairCaseId: null` 이 남고, 나중에 그 줄만 읽는 사람은 무슨 파일이
 * 었는지 알 수 없다.
 *
 * ── 사람이 읽는 이름을 함께 싣는다 ───────────────────────────────────────
 * 접수 건 쪽은 예전부터 UUID 옆에 접수번호(intakeNumber)를 함께 남겼다. 모델도
 * 같은 대접을 받아야 한다 — 감사 로그에 UUID 만 있으면 그 줄을 읽는 사람이 무슨
 * 모델인지 알 수 없고, 3년 뒤 그 모델 행이 지워졌다면 되짚을 방법도 없다. 견적서는
 * 발행번호(quoteNumber)를 싣는다. 이름을 읽어 오지 않는 자리(내려받기 기록)에서는
 * 인자를 생략하고, 그때는 이름 키 자체가 실리지 않는다.
 *
 * ── 주인이 아무도 없으면 "NONE" 이다 ─────────────────────────────────────
 * 접수 건이나 모델이 영구 삭제되면 두 FK 가 함께 NULL 이 된다(둘 다 ON DELETE
 * SET NULL). CHECK 가 막는 것은 "둘 다 찬" 행이지 "둘 다 빈" 행이 아니므로 이는
 * **정상 상태**이고, 여기서 던지면 지우지도 되살리지도 못하는 첨부가 생긴다.
 *
 * 키를 빼거나 `null` 로 두지 않고 굳이 값을 적는 이유는 하나다 — 그 줄을 읽는
 * 사람이 **"주인이 없었다"와 "기록이 빠졌다"를 구분**할 수 있어야 한다.
 * `ownerType` 키가 아예 없는 줄은 이 코드가 생기기 전(2-C 이전)의 기록이고,
 * `"NONE"` 은 기록하는 순간 주인이 실제로 없었다는 **사실의 기록**이다.
 */
function ownerAuditFields(owner: {
  repairCaseId: string | null;
  productModelId: string | null;
  /** 셋째 주인(2026-09-15 Q2). */
  quoteId: string | null;
  /** 생략하면 이름 키를 싣지 않는다(값이 null 인 것과 다르다). */
  intakeNumber?: string | null;
  /** 생략하면 이름 키를 싣지 않는다(값이 null 인 것과 다르다). */
  modelName?: string | null;
  /** 생략하면 이름 키를 싣지 않는다(값이 null 인 것과 다르다). */
  quoteNumber?: string | null;
}): Record<string, unknown> {
  if (owner.repairCaseId !== null) {
    return {
      ownerType: "REPAIR_CASE",
      repairCaseId: owner.repairCaseId,
      ...(owner.intakeNumber === undefined ? {} : { intakeNumber: owner.intakeNumber }),
    };
  }
  if (owner.productModelId !== null) {
    return {
      ownerType: "PRODUCT_MODEL",
      productModelId: owner.productModelId,
      ...(owner.modelName === undefined ? {} : { modelName: owner.modelName }),
    };
  }
  if (owner.quoteId !== null) {
    return {
      ownerType: "QUOTE",
      quoteId: owner.quoteId,
      ...(owner.quoteNumber === undefined ? {} : { quoteNumber: owner.quoteNumber }),
    };
  }
  return { ownerType: "NONE" };
}

/** 첨부와 그것이 붙은 접수 건의 잠금 상태를 한 번에 잡는다. */
async function loadForTrash(tx: Tx, attachmentId: string) {
  const [row] = await tx
    .select({
      id: attachments.id,
      repairCaseId: attachments.repairCaseId,
      productModelId: attachments.productModelId,
      // 견적서 파일이면 견적서 행을 잠그고 휴지통 · 칸을 본다(파일 헤더의 '셋째 주인').
      quoteId: attachments.quoteId,
      originalFileName: attachments.originalFileName,
      category: attachments.category,
      isDeleted: attachments.isDeleted,
      // 접수 건이 영구 삭제되어 연결이 끊긴 첨부는 잠금을 물을 대상이 없다.
      // LEFT JOIN이라 그 경우 null이 온다.
      caseIsLocked: repairCases.isLocked,
      caseIntakeNumber: repairCases.intakeNumber,
      // 모델 첨부의 감사 기록에 남길 사람이 읽는 이름. 접수 건 쪽 intakeNumber
      // 와 같은 자리다(ownerAuditFields 주석). 접수 건 첨부에서는 이 조인이
      // 언제나 비므로 null 이 온다 — 두 조인이 동시에 맞는 행은 CHECK 가 막는다.
      productModelName: productModels.modelName,
      // 견적서 첨부의 감사 기록에 남길 발행번호. 다른 주인에서는 조인이 비어 null 이다.
      quoteNumber: quotes.quoteNumber,
    })
    .from(attachments)
    .leftJoin(repairCases, eq(repairCases.id, attachments.repairCaseId))
    .leftJoin(productModels, eq(productModels.id, attachments.productModelId))
    .leftJoin(quotes, eq(quotes.id, attachments.quoteId))
    .where(eq(attachments.id, attachmentId))
    .limit(1);

  return row ?? null;
}

/**
 * 견적서 파일이면 견적서 행을 잠그고 판정한다(파일 헤더의 '셋째 주인'). 다른 주인이면
 * 아무것도 하지 않는다. 되살리기(`adding`)는 그 칸에 살아 있는 다른 파일이 있는지도 본다 —
 * 견적서 행을 잠근 뒤라 올리기(칸 교체)와 줄을 선다.
 */
async function guardQuoteOwner(
  tx: Tx,
  current: { id: string; quoteId: string | null; category: typeof attachments.$inferSelect.category },
  params: { adding: boolean }
): Promise<AttachmentTrashResult | null> {
  if (current.quoteId === null) return null;
  const guard = await guardQuoteAttachmentChange(tx, current.quoteId);
  if (!guard.ok) {
    if (guard.code === "NOT_FOUND") {
      // 읽은 뒤 잠그기 전에 견적서가 영구 삭제됐다 — 다른 첨부의 「없음」과 같은 말.
      return { ok: false, code: "NOT_FOUND", message: "파일을 찾을 수 없습니다." };
    }
    return { ok: false, code: "QUOTE_IN_TRASH", message: guard.message };
  }

  if (params.adding) {
    const [occupied] = await tx
      .select({ value: count() })
      .from(attachments)
      .where(
        and(
          eq(attachments.quoteId, current.quoteId),
          eq(attachments.category, current.category),
          eq(attachments.isDeleted, false),
          ne(attachments.id, current.id)
        )
      );
    if ((occupied?.value ?? 0) > 0) {
      return { ok: false, code: "SLOT_OCCUPIED", message: QUOTE_ATTACHMENT_SLOT_OCCUPIED_MESSAGE };
    }
  }
  return null;
}

/**
 * 첨부를 휴지통으로 보낸다. **디스크 파일은 그대로 둔다**(파일 상단 주석).
 */
export async function softDeleteAttachment(params: {
  attachmentId: string;
  actorUserId: string;
  reason: string | null;
}): Promise<AttachmentTrashResult> {
  if (!UUID_PATTERN.test(params.attachmentId)) {
    return { ok: false, code: "INVALID_ID", message: "파일을 확인할 수 없습니다." };
  }

  return db.transaction(async (tx): Promise<AttachmentTrashResult> => {
    const current = await loadForTrash(tx, params.attachmentId);
    if (!current) {
      return { ok: false, code: "NOT_FOUND", message: "파일을 찾을 수 없습니다." };
    }
    if (current.isDeleted) {
      return { ok: false, code: "ALREADY_IN_STATE", message: "이미 휴지통에 있는 파일입니다." };
    }
    if (current.caseIsLocked === true) {
      return {
        ok: false,
        code: "CASE_LOCKED",
        message: "출하 완료로 잠긴 접수 건의 파일은 지울 수 없습니다.",
      };
    }
    const rejected = await guardQuoteOwner(tx, current, { adding: false });
    if (rejected) return rejected;

    const deletedAt = new Date();
    const updated = await tx
      .update(attachments)
      .set({
        isDeleted: true,
        deletedAt,
        deletedBy: params.actorUserId,
        deleteReason: params.reason,
      })
      .where(and(eq(attachments.id, params.attachmentId), eq(attachments.isDeleted, false)))
      .returning({ id: attachments.id });

    if (updated.length === 0) {
      // 같은 순간에 다른 요청이 먼저 지웠다. 0행 쓰기를 조용히 성공으로
      // 넘기지 않는다 — 이 저장소의 다른 휴지통 mutation과 같은 규율이다.
      return { ok: false, code: "ALREADY_IN_STATE", message: "이미 휴지통에 있는 파일입니다." };
    }

    await insertAuditLog(tx, {
      actorUserId: params.actorUserId,
      actionType: "FILE_DELETE",
      targetEntity: "attachments",
      targetRecordId: params.attachmentId,
      previousValue: { isDeleted: false },
      newValue: {
        isDeleted: true,
        deletedAt: deletedAt.toISOString(),
        deleteReason: params.reason,
        // 접수 건 첨부에서는 예전과 똑같이 repairCaseId · intakeNumber 가
        // 실린다(ownerType 이 앞에 붙는 것만 다르다) — 옛 기록과 새 기록을 한
        // 질의로 읽을 수 있어야 하므로 키를 빼지 않고 더하기만 한다.
        ...ownerAuditFields({
          repairCaseId: current.repairCaseId,
          productModelId: current.productModelId,
          quoteId: current.quoteId,
          intakeNumber: current.caseIntakeNumber,
          modelName: current.productModelName,
          quoteNumber: current.quoteNumber,
        }),
        category: current.category,
        // 디스크 파일을 남긴다는 사실을 기록에도 남긴다 — 나중에 이 로그를 읽는
        // 사람이 "파일도 사라졌나"를 다시 조사하지 않게 한다.
        storedFileRetained: true,
      },
    });

    return { ok: true, id: params.attachmentId };
  });
}

/**
 * 휴지통의 첨부를 되살린다. 실물이 남아 있으므로 표시만 되돌리면 된다.
 *
 * 견적서 파일이면 견적서가 휴지통이 아니어야 하고 **그 칸이
 * 비어 있어야** 한다(파일 헤더의 '셋째 주인').
 */
export async function restoreAttachment(params: {
  attachmentId: string;
  actorUserId: string;
}): Promise<AttachmentTrashResult> {
  if (!UUID_PATTERN.test(params.attachmentId)) {
    return { ok: false, code: "INVALID_ID", message: "파일을 확인할 수 없습니다." };
  }

  return db.transaction(async (tx): Promise<AttachmentTrashResult> => {
    const current = await loadForTrash(tx, params.attachmentId);
    if (!current) {
      return { ok: false, code: "NOT_FOUND", message: "파일을 찾을 수 없습니다." };
    }
    if (!current.isDeleted) {
      return { ok: false, code: "ALREADY_IN_STATE", message: "휴지통에 있는 파일이 아닙니다." };
    }
    if (current.caseIsLocked === true) {
      return {
        ok: false,
        code: "CASE_LOCKED",
        message: "출하 완료로 잠긴 접수 건의 파일은 되살릴 수 없습니다.",
      };
    }
    const rejected = await guardQuoteOwner(tx, current, { adding: true });
    if (rejected) return rejected;

    const updated = await tx
      .update(attachments)
      .set({ isDeleted: false, deletedAt: null, deletedBy: null, deleteReason: null })
      .where(and(eq(attachments.id, params.attachmentId), eq(attachments.isDeleted, true)))
      .returning({ id: attachments.id });

    if (updated.length === 0) {
      return { ok: false, code: "ALREADY_IN_STATE", message: "휴지통에 있는 파일이 아닙니다." };
    }

    await insertAuditLog(tx, {
      actorUserId: params.actorUserId,
      actionType: "RESTORE",
      targetEntity: "attachments",
      targetRecordId: params.attachmentId,
      previousValue: { isDeleted: true },
      newValue: {
        isDeleted: false,
        ...ownerAuditFields({
          repairCaseId: current.repairCaseId,
          productModelId: current.productModelId,
          quoteId: current.quoteId,
          intakeNumber: current.caseIntakeNumber,
          modelName: current.productModelName,
          quoteNumber: current.quoteNumber,
        }),
        category: current.category,
      },
    });

    return { ok: true, id: params.attachmentId };
  });
}

/**
 * 누가 무엇을 받아 갔는지 남긴다. 상태는 바꾸지 않는다.
 *
 * 파일 자체보다 오래 남아야 하는 기록이다(감사 로그 3년 보관). 그래서
 * 다운로드 라우트는 스트림을 돌려주기 **전에** 이것을 부른다 — 응답을 먼저
 * 반환하면 스트림이 끝나는 시점을 알 수 없어 기록이 누락될 수 있다.
 */
export async function recordAttachmentDownload(params: {
  attachmentId: string;
  actorUserId: string;
  /**
   * 이 첨부의 주인. 네 컬럼을 그대로 받아 ownerAuditFields 가 갈라 적는다 —
   * 부르는 쪽(다운로드 라우트)이 이미 읽어 둔 값이라 조회를 새로 열지 않는다.
   *
   * 사람이 읽는 이름(접수번호 · 모델명 · 발행번호)은 싣지 않는다. 그 조회는 파일을
   * 내보내는 데 필요한 값만 읽고(queries/attachment-download.ts), 이름을 위해
   * 조인을 더하면 **모든 내려받기가 조인을 더 치른다.** 무엇을 누가 받아
   * 갔는지는 attachmentId 와 originalFileName 이 이미 답한다.
   */
  owner: {
    repairCaseId: string | null;
    productModelId: string | null;
    quoteId: string | null;
  };
  originalFileName: string;
  fileSize: number;
}): Promise<void> {
  await db.transaction(async (tx) => {
    await insertAuditLog(tx, {
      actorUserId: params.actorUserId,
      actionType: "FILE_DOWNLOAD",
      targetEntity: "attachments",
      targetRecordId: params.attachmentId,
      // 내려받기는 상태를 바꾸지 않으므로 previousValue가 없다.
      newValue: {
        ...ownerAuditFields(params.owner),
        // 원본 파일명은 사람이 자유롭게 적는 값이라 고객사명이 섞일 수 있다.
        // 감사 로그는 그 자체가 보관 대상이므로 이름을 그대로 남긴다 —
        // 무엇을 받아 갔는지 알 수 없으면 기록의 뜻이 없다.
        originalFileName: params.originalFileName,
        fileSize: params.fileSize,
      },
    });
  });
}

// ─────────────────────────── 견적서를 휴지통에 넣고 · 되살리고 · 지울 때 (2026-09-15 Q2)

/**
 * 견적서를 휴지통에 넣으며 함께 첨부 휴지통으로 보낸 파일의 삭제 사유 칸 — **고정
 * 문구다.** 사람이 적은 사유와도, 칸 교체로 밀려난 파일의 사유
 * (attachments.ts 의 QUOTE_ATTACHMENT_REPLACED_REASON)와도 다르다.
 *
 * 견적서를 되살릴 때 **이 사유이면서 삭제 시각이 견적서의 삭제 시각과 같은 파일만**
 * 돌려보낸다(restoreAttachmentsTrashedWithQuote). 둘 다 보는 까닭: 사유만 보면 사람이
 * 파일을 지우며 같은 글자를 사유로 적은 경우를 가를 수 없고, 시각만 보면 같은 순간에
 * 다른 까닭으로 휴지통에 간 파일을 가를 수 없다. 둘은 같은 트랜잭션에서 **같은 Date
 * 값 하나**로 적힌다(quote-trash.ts 의 softDeleteQuote).
 */
export const QUOTE_DELETED_ATTACHMENT_REASON = "견적서 휴지통 — 견적서와 함께";

export type QuoteAttachmentToTrash = {
  id: string;
  category: typeof attachments.$inferSelect.category;
};

/**
 * 견적서의 살아 있는 첨부 — 부르는 쪽(softDeleteQuote)이 견적서 행을 잠근 트랜잭션에서
 * 읽는다. 올리기 · 지우기 · 되살리기도 같은 행을 먼저 잠그므로(guardQuoteAttachmentChange)
 * 읽은 목록과 휴지통으로 보낼 때 사이에 한 장이 끼어들거나 빠지지 않는다. 차례는 올린
 * 차례 — 감사에 싣는 id 목록의 차례가 된다. 부분 인덱스(attachments_quote_id_not_deleted_idx)
 * 를 타는 모양이다.
 */
export async function listLiveAttachmentsOfQuote(tx: Tx, quoteId: string): Promise<QuoteAttachmentToTrash[]> {
  return tx
    .select({ id: attachments.id, category: attachments.category })
    .from(attachments)
    .where(and(eq(attachments.quoteId, quoteId), eq(attachments.isDeleted, false)))
    .orderBy(asc(attachments.uploadedAt), asc(attachments.id));
}

/**
 * 휴지통으로 가는 견적서의 첨부를 첨부 휴지통으로 보낸다 — **부르는 쪽의 트랜잭션 안에서.**
 * softDeleteAttachment 와 같은 모양이다: 소프트 삭제
 * 네 칸 + 첨부마다 FILE_DELETE 감사 한 줄. 디스크 실물은 건드리지 않는다.
 *
 * `deletedAt` 은 부르는 쪽이 견적서 행에 적은 **그 값**을 넘긴다 — 되살리기가 「견적서와
 * 함께 간 파일」을 가르는 열쇠 중 하나다(QUOTE_DELETED_ATTACHMENT_REASON 주석).
 *
 * 견적서 행은 지워지지 않고 남으므로(소프트 삭제) 주인 칸도 그대로다. 실제로 휴지통에 간
 * id 를 넘겨받은 차례대로 돌려준다(부르는 쪽이 SOFT_DELETE 감사에 싣는다).
 */
export async function trashAttachmentsOfDeletedQuote(
  tx: Tx,
  params: {
    quoteId: string;
    quoteNumber: string;
    attachments: readonly QuoteAttachmentToTrash[];
    actorUserId: string;
    deletedAt: Date;
  }
): Promise<string[]> {
  if (params.attachments.length === 0) return [];

  const updated = await tx
    .update(attachments)
    .set({
      isDeleted: true,
      deletedAt: params.deletedAt,
      deletedBy: params.actorUserId,
      deleteReason: QUOTE_DELETED_ATTACHMENT_REASON,
    })
    .where(
      and(
        inArray(
          attachments.id,
          params.attachments.map((item) => item.id)
        ),
        eq(attachments.isDeleted, false)
      )
    )
    .returning({ id: attachments.id });

  const updatedIds = new Set(updated.map((row) => row.id));
  const trashed = params.attachments.filter((item) => updatedIds.has(item.id));

  for (const item of trashed) {
    await insertAuditLog(tx, {
      actorUserId: params.actorUserId,
      actionType: "FILE_DELETE",
      targetEntity: "attachments",
      targetRecordId: item.id,
      previousValue: { isDeleted: false },
      newValue: {
        isDeleted: true,
        deletedAt: params.deletedAt.toISOString(),
        deleteReason: QUOTE_DELETED_ATTACHMENT_REASON,
        ...ownerAuditFields({
          repairCaseId: null,
          productModelId: null,
          quoteId: params.quoteId,
          quoteNumber: params.quoteNumber,
        }),
        category: item.category,
        storedFileRetained: true,
      },
    });
  }

  return trashed.map((item) => item.id);
}

/**
 * 휴지통에서 되살아나는 견적서의 첨부 중 **견적서와 함께 휴지통에 간 것만** 되살린다 —
 * 부르는 쪽(restoreQuote)의 트랜잭션 안에서, 견적서 행을 잠근 뒤에.
 *
 * 가르는 열쇠는 둘이다: 사유가 QUOTE_DELETED_ATTACHMENT_REASON 이고, 삭제 시각이 견적서의
 * 삭제 시각(`quoteDeletedAt` — 되살리기 전에 읽은 값)과 같은 것. 칸 교체로 밀려난 옛 파일
 * (사유가 다르다)과 사람이 따로 지운 파일은 그대로 휴지통에 남는다 — 되살리면 칸마다 한
 * 파일이 깨지거나, 사람이 치운 것이 돌아온다.
 *
 * 칸이 겹칠 걱정은 없다 — 함께 간 파일은 휴지통에 들어가던 순간 **칸마다 살아 있던
 * 하나씩**이고, 견적서가 휴지통에 있는 동안에는 그 견적서에 파일을 올리지도 되살리지도
 * 못한다(guardQuoteAttachmentChange 의 QUOTE_IN_TRASH).
 *
 * 되살아난 파일마다 RESTORE 감사 한 줄. 되살린 id 를 올린 차례대로 돌려준다(부르는 쪽이
 * 견적서의 RESTORE 감사에 싣는다).
 */
export async function restoreAttachmentsTrashedWithQuote(
  tx: Tx,
  params: { quoteId: string; quoteNumber: string; quoteDeletedAt: Date | null; actorUserId: string }
): Promise<string[]> {
  // 삭제 시각이 비어 있는 휴지통 견적서는 정상 경로로 생기지 않는다(softDeleteQuote 가 늘
  // 적는다). 그런 행에는 함께 간 파일을 가를 열쇠가 없으니 아무것도 되살리지 않는다.
  if (params.quoteDeletedAt === null) return [];

  const candidates = await tx
    .select({ id: attachments.id, category: attachments.category })
    .from(attachments)
    .where(
      and(
        eq(attachments.quoteId, params.quoteId),
        eq(attachments.isDeleted, true),
        eq(attachments.deleteReason, QUOTE_DELETED_ATTACHMENT_REASON),
        eq(attachments.deletedAt, params.quoteDeletedAt)
      )
    )
    .orderBy(asc(attachments.uploadedAt), asc(attachments.id));
  if (candidates.length === 0) return [];

  const updated = await tx
    .update(attachments)
    .set({ isDeleted: false, deletedAt: null, deletedBy: null, deleteReason: null })
    .where(
      and(
        inArray(
          attachments.id,
          candidates.map((item) => item.id)
        ),
        eq(attachments.isDeleted, true)
      )
    )
    .returning({ id: attachments.id });

  const updatedIds = new Set(updated.map((row) => row.id));
  const restored = candidates.filter((item) => updatedIds.has(item.id));

  for (const item of restored) {
    await insertAuditLog(tx, {
      actorUserId: params.actorUserId,
      actionType: "RESTORE",
      targetEntity: "attachments",
      targetRecordId: item.id,
      previousValue: { isDeleted: true, deleteReason: QUOTE_DELETED_ATTACHMENT_REASON },
      newValue: {
        isDeleted: false,
        ...ownerAuditFields({
          repairCaseId: null,
          productModelId: null,
          quoteId: params.quoteId,
          quoteNumber: params.quoteNumber,
        }),
        category: item.category,
        // 사람이 이 파일을 골라 되살린 것이 아니라 견적서와 함께 돌아왔다는 사실.
        restoredWithQuote: true,
      },
    });
  }

  return restored.map((item) => item.id);
}

/**
 * 견적서에 붙었던 첨부 **전부**(휴지통 여부와 무관)의 id — 견적서를 영구 삭제하기 직전,
 * 부르는 쪽(permanentlyDeleteQuote)의 트랜잭션에서 읽는다. 영구 삭제되면 FK(ON DELETE
 * SET NULL)가 quote_id 를 비워 그 뒤로는 어느 견적서의 것이었는지 알 수 없으므로, 어느
 * 파일의 연결이 풀렸는지를 PURGE 감사에 남긴다(내자 정리 줄의 unlinkedDomesticOrderIds
 * 와 같은 자리). 첨부 행과 디스크 실물은 그대로 남는다 — 다른 주인과 같은 기존 동작이다.
 */
export async function listAttachmentIdsOfQuote(tx: Tx, quoteId: string): Promise<string[]> {
  const rows = await tx
    .select({ id: attachments.id })
    .from(attachments)
    .where(eq(attachments.quoteId, quoteId))
    .orderBy(asc(attachments.uploadedAt), asc(attachments.id));
  return rows.map((row) => row.id);
}
