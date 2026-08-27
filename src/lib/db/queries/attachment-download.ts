import "server-only";

import { eq } from "drizzle-orm";
import { db } from "../client";
import { attachments } from "../schema";
import type { MalwareScanStatus } from "@/lib/domain/attachment-category";

/**
 * ============================================================================
 * 내려받기 한 건에 필요한 최소한 — 판정에 쓰이는 값만 읽는다
 * ============================================================================
 * `listAttachmentsForRepairCase`를 쓰지 않는다. 그 조회는
 * `WHERE is_deleted = false`를 박아 두고 있어서 **휴지통에 있는 첨부를 아예
 * 찾지 못한다.** 다운로드는 "없는 것"과 "휴지통에 있는 것"을 구분해야 한다 —
 * 앞은 404이고 뒤는 "복원한 뒤 다시 시도해 주세요"다. 그 둘을 같은 404로
 * 뭉개면 사용자는 파일이 사라진 줄 알고 다시 올린다.
 *
 * 그래서 여기서는 is_deleted를 **조건이 아니라 값으로** 읽어 판정 함수
 * (attachment-download-policy.ts)에 넘긴다. 판정은 이 파일에서 하지 않는다.
 *
 * ── 업로더 이름을 조인하지 않는다 ────────────────────────────────────────
 * 목록 조회는 화면에 이름을 보여야 해서 users를 조인하지만, 다운로드는 파일을
 * 내보내는 것뿐이라 이름이 필요 없다. 감사 로그에 남기는 것은 **받아 가는
 * 사람**이고 그 값은 세션에서 온다.
 * ============================================================================
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type AttachmentForDownload = {
  id: string;
  /**
   * 접수 건 주인. NULL 이면 이 첨부의 주인은 접수 건이 아니다 — 모델 첨부이거나,
   * 접수 건이 영구 삭제되어 연결이 끊긴 첨부다.
   */
  repairCaseId: string | null;
  /**
   * 제품 모델 주인. 위 컬럼과 **동시에 채워지지 않는다**
   * (attachments_owner_not_both CHECK). 둘 다 NULL 이면 주인이 아무도 없는
   * 첨부이고, 그때는 물을 권한 자체가 없으므로 판정 함수가 DETACHED 로 막는다.
   *
   * 라우트가 **물을 권한을 고르는 근거**가 이 값이다 — 모델 첨부는
   * productModels.view(보기) / productModels.files(쓰기)를 묻고, 접수 건 첨부는
   * repairCases.files 를 묻는다. 그래서 조회에서 함께 읽지 않으면 안 된다.
   */
  productModelId: string | null;
  originalFileName: string;
  /** 저장 루트 기준 상대 경로. 라우트가 resolveAttachmentAbsolutePath로 반드시 다시 검증한다. */
  storedPath: string;
  mimeType: string;
  fileSize: number;
  checksumSha256: string;
  malwareScanStatus: MalwareScanStatus;
  /** 미리보기가 있으면 그 상대 경로. 없으면 null이고 원본으로 보여 준다. */
  previewPath: string | null;
  /** 조건이 아니라 값으로 읽는다 — 위 주석 참조. */
  isDeleted: boolean;
};

export async function getAttachmentForDownload(
  attachmentId: string
): Promise<AttachmentForDownload | null> {
  if (!UUID_PATTERN.test(attachmentId)) return null;

  const [row] = await db
    .select({
      id: attachments.id,
      repairCaseId: attachments.repairCaseId,
      productModelId: attachments.productModelId,
      originalFileName: attachments.originalFileName,
      storedPath: attachments.storedPath,
      mimeType: attachments.mimeType,
      fileSize: attachments.fileSize,
      checksumSha256: attachments.checksumSha256,
      malwareScanStatus: attachments.malwareScanStatus,
      previewPath: attachments.previewPath,
      isDeleted: attachments.isDeleted,
    })
    .from(attachments)
    .where(eq(attachments.id, attachmentId))
    .limit(1);

  return row ?? null;
}
