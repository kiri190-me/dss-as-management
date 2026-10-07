import "server-only";

import { and, count, eq, ne, or } from "drizzle-orm";
import { db } from "../connection";
import { attachments, productModels, quotes, repairCases } from "../schema";
import { ownerAuditFields } from "./attachment-trash";
import { insertAuditLog } from "./audit-logs";
import type { StorageAdapter } from "@/lib/storage/storage-adapter";

/**
 * ============================================================================
 * 첨부 영구 삭제 — 행을 지우고 **디스크의 파일까지** 지운다
 * ============================================================================
 * 휴지통(attachment-trash.ts)은 표시만 바꾸고 실물을 남긴다. 이 파일은 그 반대다 —
 * **되돌릴 수 없다.** 그래서 별도 통로로 두었고(그 파일 머리말이 처음부터 그렇게
 * 적어 두었다), 사용자 승인을 받은 뒤에 생겼다(2026-10-07).
 *
 * ── 🔴 휴지통에 있는 것만 지운다 ─────────────────────────────────────────
 * 트랜잭션 안에서 행을 잠그고 `is_deleted = true` 를 **다시** 본다. 화면이 휴지통
 * 구역에만 단추를 그리지만, 화면이 그린 것을 서버가 믿지 않는다.
 *
 * ── 🔴 차례 — DB 먼저, 파일은 커밋 뒤 ────────────────────────────────────
 * 파일을 먼저 지우면 트랜잭션이 되돌아가도 파일은 안 돌아온다. 커밋 뒤에 지우면
 * 최악이 「DB 에서 사라졌는데 디스크에 파일이 남는 것」이고 그건 나중에 치울 수
 * 있다. **되돌릴 수 없는 쪽을 뒤로 미룬다.**
 *
 * attachment-file-swap.ts 의 물려두기(stash)는 여기 쓰지 않는다 — 그것은 옛 파일이
 * 다시 필요할 수 있는 「바꿔 끼우기」용이고, 여기서는 옛 파일이 다시 필요해지는
 * 길 자체가 없다.
 *
 * ── 🔴 StorageAdapter 를 인자로 받는다 ───────────────────────────────────
 * 이 파일 안에서 getAttachmentStorage() 를 **부르지 않는다.** 부르면 시험이 진짜
 * 업로드 폴더(UPLOADS_DIR)를 지운다. swapStoredFiles(storage, …) 가 같은 이유로
 * 같은 모양이다. 실제 어댑터는 서버 액션이 넘긴다.
 *
 * ── 🔴 파생 파일도 함께 지운다 ───────────────────────────────────────────
 * `preview_path` 가 있으면 그것도 지운다. 썸네일이 남으면 지운 파일의 그림이
 * 목록에 계속 보인다.
 *
 * ── 🔴 같은 자리를 다른 행이 쓰고 있으면 파일을 남긴다 ───────────────────
 * `stored_path` 에는 고유 제약이 없다. 트랜잭션 안에서 **같은 자리를 가리키는 다른
 * 행**(지우려는 것 말고)을 센다. 하나라도 있으면 DB 행만 지우고 디스크 파일은
 * 그대로 둔다. 지금 코드는 같은 파일을 재사용하지 않아 실무상 걸리지 않지만,
 * 걸리는 날 남의 파일을 지우는 것보다 낫다. 그 사실은 감사 로그에 적는다.
 *
 * ── 🔴 감사 로그가 유일한 흔적이다 ───────────────────────────────────────
 * 행이 사라지므로 PURGE 한 줄 말고는 아무것도 남지 않는다. `previousValue` 에
 * **지운 행을 통째로** 싣는다 — 주인 칸(ownerAuditFields 관례) · 경로 · 체크섬 ·
 * 올린 사람 · 휴지통에 넣은 사람과 사유까지. **그 한 줄만 보고 무엇이 사라졌는지
 * 알 수 있어야 한다.**
 *
 * 원본 파일명과 설명에는 고객사명이 섞일 수 있다(schema/attachments.ts 의 PII
 * 항목). 그래도 가리지 않는다 — 내려받기 기록(recordAttachmentDownload)이 같은
 * 판단을 적어 둔 그대로다: **무엇이 사라졌는지 알 수 없으면 기록의 뜻이 없다.**
 * 접수 건 영구 삭제가 연락처를 빼는 것과는 다른 자리다(그쪽은 지우는 것이 목적인
 * PII 였고, 여기 이름은 지워진 파일을 식별하는 유일한 값이다).
 *
 * ── 🔴 파일 삭제가 실패해도 결과는 성공이다 ──────────────────────────────
 * DB 는 이미 커밋됐다. 실패를 거짓으로 되돌릴 방법이 없으므로 **서버 로그로**
 * 남기고 결과에 실어 보낸다(failedPaths). 사람 눈에는 실제로 사라진 것이 맞다.
 * ============================================================================
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type AttachmentPurgeFailureCode =
  | "INVALID_ID"
  | "NOT_FOUND"
  /** 살아 있는(휴지통이 아닌) 첨부 — 영구 삭제는 휴지통을 거친 것만 받는다. */
  | "NOT_IN_TRASH";

export type AttachmentPurgeResult =
  | {
      ok: true;
      id: string;
      /** 디스크에서 실제로 지운 상대 경로(원본 · 미리보기). */
      removedPaths: string[];
      /** 같은 자리를 다른 행이 쓰고 있어 **남긴** 상대 경로. */
      retainedPaths: string[];
      /** 지우려 했으나 실패한 상대 경로. 결과는 성공이고 서버 로그에 남는다. */
      failedPaths: string[];
    }
  | { ok: false; code: AttachmentPurgeFailureCode; message: string };

/** 살아 있는 첨부에 영구 삭제를 걸었을 때. 무엇을 먼저 해야 하는지까지 말한다. */
export const ATTACHMENT_NOT_IN_TRASH_MESSAGE =
  "휴지통에 있는 파일만 영구 삭제할 수 있습니다. 먼저 휴지통으로 옮겨 주세요.";

/**
 * 커밋 뒤에 할 일 — 어느 자리를 지우고 어느 자리를 남길 것인가.
 * 트랜잭션 **안에서** 정해 둔다(같은 자리를 쓰는 다른 행을 그때 세었다).
 */
type DiskPlan = { remove: string[]; retain: string[] };

/**
 * 이 첨부의 사람이 읽는 이름. 주인 칸은 넷 중 하나만 차 있으므로 조회도 많아야
 * 하나다(ownerAuditFields 주석 — 종류 서류는 코드 자체가 이름이라 조회가 없다).
 *
 * 잠근 행(FOR UPDATE)과 같은 질의에 조인을 섞지 않는 까닭: 바깥 조인의 nullable
 * 쪽에는 FOR UPDATE 를 걸 수 없다(PostgreSQL). 휴지통 쪽 loadForTrash 가 조인을
 * 쓰는 것은 그쪽이 행을 잠그지 않기 때문이다.
 */
async function loadOwnerName(
  tx: Tx,
  owner: { repairCaseId: string | null; productModelId: string | null; quoteId: string | null }
): Promise<{ intakeNumber?: string | null; modelName?: string | null; quoteNumber?: string | null }> {
  if (owner.repairCaseId !== null) {
    const [row] = await tx
      .select({ intakeNumber: repairCases.intakeNumber })
      .from(repairCases)
      .where(eq(repairCases.id, owner.repairCaseId))
      .limit(1);
    return { intakeNumber: row?.intakeNumber ?? null };
  }
  if (owner.productModelId !== null) {
    const [row] = await tx
      .select({ modelName: productModels.modelName })
      .from(productModels)
      .where(eq(productModels.id, owner.productModelId))
      .limit(1);
    return { modelName: row?.modelName ?? null };
  }
  if (owner.quoteId !== null) {
    const [row] = await tx
      .select({ quoteNumber: quotes.quoteNumber })
      .from(quotes)
      .where(eq(quotes.id, owner.quoteId))
      .limit(1);
    return { quoteNumber: row?.quoteNumber ?? null };
  }
  return {};
}

/**
 * 이 자리를 가리키는 **다른** 행이 있는가. `stored_path` 뿐 아니라 `preview_path`
 * 까지 양쪽으로 본다 — 한 행의 원본 자리가 다른 행의 미리보기 자리일 수도 있고,
 * 그 경우에도 지우면 남의 그림이 사라진다.
 */
async function isPathUsedElsewhere(tx: Tx, params: { attachmentId: string; relPath: string }): Promise<boolean> {
  const [row] = await tx
    .select({ value: count() })
    .from(attachments)
    .where(
      and(
        ne(attachments.id, params.attachmentId),
        or(eq(attachments.storedPath, params.relPath), eq(attachments.previewPath, params.relPath))
      )
    );
  return (row?.value ?? 0) > 0;
}

/**
 * 휴지통의 첨부를 영구 삭제한다 — DB 행을 지우고(플래그가 아니라 DELETE),
 * 커밋한 뒤 디스크 파일을 지운다.
 *
 * `storage` 를 **반드시 인자로** 받는다(파일 머리말의 🔴 항목).
 */
export async function purgeAttachment(
  storage: Pick<StorageAdapter, "delete">,
  params: { attachmentId: string; actorUserId: string }
): Promise<AttachmentPurgeResult> {
  if (!UUID_PATTERN.test(params.attachmentId)) {
    return { ok: false, code: "INVALID_ID", message: "파일을 확인할 수 없습니다." };
  }

  const committed = await db.transaction(
    async (tx): Promise<{ ok: false; result: AttachmentPurgeResult } | { ok: true; plan: DiskPlan }> => {
      // 칸을 하나씩 적는다 — 이 목록이 곧 감사에 남는 스냅숏이고, select() 전체
      // 조회로 두면 칸이 느는 날 무엇이 기록되는지가 조용히 바뀐다.
      const [current] = await tx
        .select({
          id: attachments.id,
          repairCaseId: attachments.repairCaseId,
          productModelId: attachments.productModelId,
          quoteId: attachments.quoteId,
          productModelKind: attachments.productModelKind,
          category: attachments.category,
          originalFileName: attachments.originalFileName,
          storedPath: attachments.storedPath,
          previewPath: attachments.previewPath,
          mimeType: attachments.mimeType,
          fileSize: attachments.fileSize,
          checksumSha256: attachments.checksumSha256,
          malwareScanStatus: attachments.malwareScanStatus,
          description: attachments.description,
          uploadedBy: attachments.uploadedBy,
          uploadedAt: attachments.uploadedAt,
          originalModifiedAt: attachments.originalModifiedAt,
          isDeleted: attachments.isDeleted,
          deletedAt: attachments.deletedAt,
          deletedBy: attachments.deletedBy,
          deleteReason: attachments.deleteReason,
        })
        .from(attachments)
        .where(eq(attachments.id, params.attachmentId))
        .for("update")
        .limit(1);

      if (!current) {
        return { ok: false, result: { ok: false, code: "NOT_FOUND", message: "파일을 찾을 수 없습니다." } };
      }
      // 🔴 화면이 휴지통 구역에만 단추를 그리더라도 서버가 다시 본다.
      if (!current.isDeleted) {
        return {
          ok: false,
          result: { ok: false, code: "NOT_IN_TRASH", message: ATTACHMENT_NOT_IN_TRASH_MESSAGE },
        };
      }

      // 지울 자리 — 원본과 미리보기. 둘이 같은 글자일 리는 없지만, 같다면 한 번만 본다.
      const candidatePaths = Array.from(
        new Set([current.storedPath, ...(current.previewPath ? [current.previewPath] : [])])
      );
      const plan: DiskPlan = { remove: [], retain: [] };
      for (const relPath of candidatePaths) {
        const usedElsewhere = await isPathUsedElsewhere(tx, {
          attachmentId: current.id,
          relPath,
        });
        if (usedElsewhere) plan.retain.push(relPath);
        else plan.remove.push(relPath);
      }

      const ownerName = await loadOwnerName(tx, current);

      const deleted = await tx
        .delete(attachments)
        .where(and(eq(attachments.id, params.attachmentId), eq(attachments.isDeleted, true)))
        .returning({ id: attachments.id });

      if (deleted.length === 0) {
        // 처음 SELECT 부터 행 잠금을 쥐고 있어 실무상 닿지 않는다. 그래도 0행 쓰기를
        // 조용히 성공으로 넘기지 않는 것이 이 저장소의 규율이다
        // (permanentlyDeleteRepairCase 와 같은 모양).
        return { ok: false, result: { ok: false, code: "NOT_FOUND", message: "파일을 찾을 수 없습니다." } };
      }

      await insertAuditLog(tx, {
        actorUserId: params.actorUserId,
        actionType: "PURGE",
        targetEntity: "attachments",
        targetRecordId: params.attachmentId,
        previousValue: {
          ...ownerAuditFields({
            repairCaseId: current.repairCaseId,
            productModelId: current.productModelId,
            quoteId: current.quoteId,
            productModelKind: current.productModelKind,
            ...ownerName,
          }),
          category: current.category,
          originalFileName: current.originalFileName,
          storedPath: current.storedPath,
          previewPath: current.previewPath,
          mimeType: current.mimeType,
          fileSize: current.fileSize,
          checksumSha256: current.checksumSha256,
          malwareScanStatus: current.malwareScanStatus,
          description: current.description,
          uploadedBy: current.uploadedBy,
          uploadedAt: current.uploadedAt.toISOString(),
          originalModifiedAt: current.originalModifiedAt?.toISOString() ?? null,
          // 휴지통에 넣을 때 받은 사유가 여기 함께 실린다 — 그래서 영구 삭제
          // 확인 창은 사유를 다시 받지 않는다.
          isDeleted: current.isDeleted,
          deletedAt: current.deletedAt?.toISOString() ?? null,
          deletedBy: current.deletedBy,
          deleteReason: current.deleteReason,
          // 디스크를 어떻게 했는지도 이 줄에 적는다 — 나중에 읽는 사람이
          // "파일도 사라졌나"를 다시 조사하지 않게 한다.
          purgedFilePaths: plan.remove,
          retainedFilePaths: plan.retain,
          storedFileRetained: plan.retain.length > 0,
        },
        newValue: null,
      });

      return { ok: true, plan };
    }
  );

  if (!committed.ok) return committed.result;

  // ── 커밋 뒤 — 되돌릴 수 없는 쪽 ────────────────────────────────────────
  const removedPaths: string[] = [];
  const failedPaths: string[] = [];
  for (const relPath of committed.plan.remove) {
    try {
      await storage.delete(relPath);
      removedPaths.push(relPath);
    } catch (error) {
      failedPaths.push(relPath);
      // 결과는 성공이다(DB 는 이미 커밋됐다). 조용히 넘기면 어느 파일이 남았는지
      // 나중에 알 길이 없으므로 서버 로그에는 반드시 남긴다. 상대 경로만 적는다 —
      // 저장 루트는 설정값이고 로그로 찍지 않는다(local-fs-adapter.ts 머리말).
      console.error(
        `[attachment-purge] 디스크 파일을 지우지 못했습니다 — attachmentId=${params.attachmentId} relPath=${relPath}`,
        error
      );
    }
  }

  return {
    ok: true,
    id: params.attachmentId,
    removedPaths,
    retainedPaths: committed.plan.retain,
    failedPaths,
  };
}
