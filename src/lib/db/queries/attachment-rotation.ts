import "server-only";

import { eq } from "drizzle-orm";
import { db } from "../connection";
import { attachments, quotes, repairCases } from "../schema";
import type { MalwareScanStatus } from "@/lib/domain/attachment-category";

/**
 * ============================================================================
 * 돌린 사진을 저장하기 전에 읽는 한 줄 — 되돌릴 수 없으므로 넉넉히 읽는다
 * ============================================================================
 * 내려받기 조회(attachment-download.ts)를 쓰지 않는다. 그쪽은 **모든 내려받기가
 * 치르는 비용**이라 판정에 꼭 필요한 값만 읽도록 좁혀 둔 조회이고, 여기서 필요한
 * 두 가지가 빠져 있다:
 *
 *   · `isLocked`      출하 완료로 잠긴 접수 건의 파일은 올리지도 지우지도 못한다
 *                     (업로드 라우트의 CASE_LOCKED · attachment-trash.ts). 원본을
 *                     덮어쓰는 것은 그보다 더한 일이라 같은 문에서 막는다.
 *                     **본문을 받기 전에** 알아야 20MB 를 받아 놓고 되돌리지 않는다.
 *   · `checksumSha256`  지금 디스크에 있는 것이 정말 이 사람이 화면에서 본 그
 *                     파일인지 가르는 열쇠다. 기록할 때 이 값으로 한 번 더 맞춘다
 *                     (mutations/attachment-rotation.ts 의 「그 사이 바뀌었는가」).
 *
 * 그렇다고 내려받기 조회에 조인을 더하지 않는다 — 그러면 썸네일 한 장을 그릴
 * 때마다 접수 건 표를 함께 읽게 된다. 드물게 도는 통로가 자기 조회를 갖는다.
 *
 * 견적서 표를 붙이는 규율은 내려받기 조회와 같다(주인이 휴지통의 견적서면 막는다).
 * ============================================================================
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type AttachmentForRotation = {
  id: string;
  /** 주인 셋 — 권한을 고르는 근거다(attachment-download-policy.ts 의 판정 함수들). */
  repairCaseId: string | null;
  productModelId: string | null;
  quoteId: string | null;
  /** 주인인 견적서가 휴지통에 있는가. 견적서 주인이 아니면 false. */
  quoteInTrash: boolean;
  /**
   * 주인인 접수 건이 출하 완료로 잠겼는가. 접수 건 주인이 아니면 false —
   * 조인이 비어 NULL 이 오는 것을 false 로 접는다.
   */
  caseLocked: boolean;
  originalFileName: string;
  storedPath: string;
  previewPath: string | null;
  mimeType: string;
  fileSize: number;
  checksumSha256: string;
  malwareScanStatus: MalwareScanStatus;
  isDeleted: boolean;
};

export async function getAttachmentForRotation(
  attachmentId: string
): Promise<AttachmentForRotation | null> {
  if (!UUID_PATTERN.test(attachmentId)) return null;

  const [row] = await db
    .select({
      id: attachments.id,
      repairCaseId: attachments.repairCaseId,
      productModelId: attachments.productModelId,
      quoteId: attachments.quoteId,
      quoteIsDeleted: quotes.isDeleted,
      caseIsLocked: repairCases.isLocked,
      originalFileName: attachments.originalFileName,
      storedPath: attachments.storedPath,
      previewPath: attachments.previewPath,
      mimeType: attachments.mimeType,
      fileSize: attachments.fileSize,
      checksumSha256: attachments.checksumSha256,
      malwareScanStatus: attachments.malwareScanStatus,
      isDeleted: attachments.isDeleted,
    })
    .from(attachments)
    .leftJoin(quotes, eq(quotes.id, attachments.quoteId))
    .leftJoin(repairCases, eq(repairCases.id, attachments.repairCaseId))
    .where(eq(attachments.id, attachmentId))
    .limit(1);

  if (!row) return null;
  const { quoteIsDeleted, caseIsLocked, ...rest } = row;
  return { ...rest, quoteInTrash: quoteIsDeleted === true, caseLocked: caseIsLocked === true };
}
