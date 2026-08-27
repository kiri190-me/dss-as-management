import "server-only";

import { and, eq } from "drizzle-orm";
import { db } from "../connection";
import { attachments, productModels, repairCases } from "../schema";
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
 * ============================================================================
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type AttachmentTrashFailureCode =
  | "INVALID_ID"
  | "NOT_FOUND"
  | "ALREADY_IN_STATE"
  | "CASE_LOCKED";

export type AttachmentTrashResult =
  | { ok: true; id: string }
  | { ok: false; code: AttachmentTrashFailureCode; message: string };

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
 * 모델인지 알 수 없고, 3년 뒤 그 모델 행이 지워졌다면 되짚을 방법도 없다.
 * 이름을 읽어 오지 않는 자리(내려받기 기록)에서는 인자를 생략하고, 그때는 이름
 * 키 자체가 실리지 않는다.
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
  /** 생략하면 이름 키를 싣지 않는다(값이 null 인 것과 다르다). */
  intakeNumber?: string | null;
  /** 생략하면 이름 키를 싣지 않는다(값이 null 인 것과 다르다). */
  modelName?: string | null;
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
  return { ownerType: "NONE" };
}

/** 첨부와 그것이 붙은 접수 건의 잠금 상태를 한 번에 잡는다. */
async function loadForTrash(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  attachmentId: string
) {
  const [row] = await tx
    .select({
      id: attachments.id,
      repairCaseId: attachments.repairCaseId,
      productModelId: attachments.productModelId,
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
    })
    .from(attachments)
    .leftJoin(repairCases, eq(repairCases.id, attachments.repairCaseId))
    .leftJoin(productModels, eq(productModels.id, attachments.productModelId))
    .where(eq(attachments.id, attachmentId))
    .limit(1);

  return row ?? null;
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
          intakeNumber: current.caseIntakeNumber,
          modelName: current.productModelName,
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

/** 휴지통의 첨부를 되살린다. 실물이 남아 있으므로 표시만 되돌리면 된다. */
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
          intakeNumber: current.caseIntakeNumber,
          modelName: current.productModelName,
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
   * 이 첨부의 주인. 두 컬럼을 그대로 받아 ownerAuditFields 가 갈라 적는다 —
   * 부르는 쪽(다운로드 라우트)이 이미 읽어 둔 값이라 조회를 새로 열지 않는다.
   *
   * 사람이 읽는 이름(접수번호 · 모델명)은 싣지 않는다. 그 조회는 파일을
   * 내보내는 데 필요한 값만 읽고(queries/attachment-download.ts), 이름을 위해
   * 조인을 더하면 **모든 내려받기가 조인 둘을 더 치른다.** 무엇을 누가 받아
   * 갔는지는 attachmentId 와 originalFileName 이 이미 답한다.
   */
  owner: { repairCaseId: string | null; productModelId: string | null };
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
