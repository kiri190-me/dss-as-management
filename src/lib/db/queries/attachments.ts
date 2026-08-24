import "server-only";

import { and, desc, eq } from "drizzle-orm";
import { db } from "../client";
import { attachments, repairCases, users } from "../schema";
import type { AttachmentCategory, MalwareScanStatus } from "@/lib/domain/attachment-category";

/**
 * ============================================================================
 * 접수 건의 첨부 목록 — 파일 탭이 매번 쏘는 조회
 * ============================================================================
 * `WHERE repair_case_id = ? AND is_deleted = false` 그대로다. 이 모양이어야
 * 직전 단계가 만든 부분 인덱스
 * (attachments_repair_case_id_not_deleted_idx, `WHERE is_deleted = false`)를
 * 탄다 — 조건에서 is_deleted를 빼거나 다른 식으로 적으면 인덱스가 빠지고,
 * 휴지통 행까지 훑는 조회가 된다.
 *
 * 휴지통(is_deleted = true) 목록은 이번 단계에서 만들지 않는다. 삭제·복원
 * 통로 자체가 아직 없어서(이번 단계는 업로드와 목록까지다), 보여 줄 수는
 * 있지만 되돌릴 수 없는 화면이 된다.
 *
 * ── 업로더 이름은 스냅샷이 아니라 조인이다 ──────────────────────────────
 * attachments 행에는 uploaded_by(UUID)만 있고 이름은 없다. 이름을 행에 복사해
 * 두면 개명·오타 수정이 옛 첨부에 반영되지 않아 같은 사람이 화면마다 다른
 * 이름으로 보인다. uploaded_by는 ON DELETE RESTRICT라 사용자 행이 사라지지
 * 않으므로, 조인은 언제나 이름을 찾아낸다.
 * ============================================================================
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type RepairCaseAttachmentListItem = {
  id: string;
  category: AttachmentCategory;
  originalFileName: string;
  /** 저장 루트 기준 상대 경로. 화면에 그대로 내보이지 않는다(내부 구조가 드러난다). */
  storedPath: string;
  mimeType: string;
  fileSize: number;
  checksumSha256: string;
  malwareScanStatus: MalwareScanStatus;
  description: string | null;
  uploadedById: string;
  uploadedByName: string;
  /** 직렬화해서 클라이언트 컴포넌트로 넘기기 위해 ISO 문자열로 내린다. */
  uploadedAt: string;
};

export async function listAttachmentsForRepairCase(
  repairCaseId: string
): Promise<RepairCaseAttachmentListItem[]> {
  if (!UUID_PATTERN.test(repairCaseId)) return [];

  const rows = await db
    .select({
      id: attachments.id,
      category: attachments.category,
      originalFileName: attachments.originalFileName,
      storedPath: attachments.storedPath,
      mimeType: attachments.mimeType,
      fileSize: attachments.fileSize,
      checksumSha256: attachments.checksumSha256,
      malwareScanStatus: attachments.malwareScanStatus,
      description: attachments.description,
      uploadedById: attachments.uploadedBy,
      uploadedByName: users.name,
      uploadedAt: attachments.uploadedAt,
    })
    .from(attachments)
    .innerJoin(users, eq(users.id, attachments.uploadedBy))
    .where(and(eq(attachments.repairCaseId, repairCaseId), eq(attachments.isDeleted, false)))
    .orderBy(desc(attachments.uploadedAt));

  return rows.map((row) => ({
    ...row,
    uploadedAt: row.uploadedAt.toISOString(),
  }));
}

export type AttachmentUploadTarget = {
  id: string;
  /** 출하 완료로 잠긴 건. 잠긴 건에는 파일을 붙이지 않는다. */
  isLocked: boolean;
};

/**
 * 업로드가 향할 접수 건이 실재하는가 — 휴지통에 있는 건은 없는 것으로 본다.
 *
 * queries/repair-cases.ts의 getRepairCaseEditGuardById와 모양이 같지만 그것을
 * 부르지 않는다. 그 함수는 "접수 건 본문 수정" 정책을 위한 것이라, 그쪽 정책이
 * 넓어지거나 좁아지는 날 첨부 업로드가 **아무도 의도하지 않은 채로** 함께
 * 움직이게 된다. 두 정책이 같은 값을 보는 것과 같은 함수를 쓰는 것은 다르다.
 */
export async function getAttachmentUploadTarget(
  repairCaseId: string
): Promise<AttachmentUploadTarget | null> {
  if (!UUID_PATTERN.test(repairCaseId)) return null;

  const [row] = await db
    .select({ id: repairCases.id, isLocked: repairCases.isLocked })
    .from(repairCases)
    .where(and(eq(repairCases.id, repairCaseId), eq(repairCases.isDeleted, false)))
    .limit(1);

  return row ?? null;
}
