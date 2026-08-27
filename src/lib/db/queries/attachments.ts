import "server-only";

import { and, desc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "../client";
import { attachments, productModels, repairCases, users } from "../schema";
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
 * 휴지통(is_deleted = true) 목록은 **별도 함수**다
 * (listTrashedAttachmentsForRepairCase). 위 조회에 플래그를 받아 조건을
 * 분기시키지 않는 이유는 부분 인덱스다 — `is_deleted = false`를 변수로 바꾸면
 * 그 인덱스를 탈 수 없게 되고, 매번 쓰이는 목록 조회가 휴지통 행까지 훑는
 * 조회로 바뀐다. 자주 쓰이는 길과 드물게 쓰이는 길을 한 함수에 합치면 드문
 * 쪽의 비용이 자주 쓰이는 쪽에 얹힌다.
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
  /** 미리보기(썸네일)의 상대 경로. 없으면 null 이고 목록은 원본으로 보여 준다. */
  previewPath: string | null;
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
      previewPath: attachments.previewPath,
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

export type TrashedAttachmentListItem = RepairCaseAttachmentListItem & {
  /** 휴지통에 넣은 시각. 복원 화면이 "언제 지웠는지"를 보여 주기 위한 것이다. */
  deletedAt: string;
  /** 지운 사람 이름. 지운 계정이 사라지지 않도록 deleted_by는 ON DELETE RESTRICT다. */
  deletedByName: string | null;
  deleteReason: string | null;
};

/**
 * 휴지통에 든 첨부. 위 목록 조회와 **일부러 분리했다**(파일 상단 주석 — 부분
 * 인덱스).
 *
 * `deleted_by`는 nullable이라 LEFT JOIN이다. 정상 경로로는 항상 채워지지만,
 * 옛 데이터나 손으로 넣은 행에 비어 있을 수 있고 그 경우 이름 없이라도
 * 목록에 나와야 한다 — 복원할 수 없는 행이 화면에서 사라지면 되살릴 방법이 없다.
 */
export async function listTrashedAttachmentsForRepairCase(
  repairCaseId: string
): Promise<TrashedAttachmentListItem[]> {
  if (!UUID_PATTERN.test(repairCaseId)) return [];

  const deleter = alias(users, "deleter");

  const rows = await db
    .select({
      id: attachments.id,
      category: attachments.category,
      originalFileName: attachments.originalFileName,
      storedPath: attachments.storedPath,
      previewPath: attachments.previewPath,
      mimeType: attachments.mimeType,
      fileSize: attachments.fileSize,
      checksumSha256: attachments.checksumSha256,
      malwareScanStatus: attachments.malwareScanStatus,
      description: attachments.description,
      uploadedById: attachments.uploadedBy,
      uploadedByName: users.name,
      uploadedAt: attachments.uploadedAt,
      deletedAt: attachments.deletedAt,
      deletedByName: deleter.name,
      deleteReason: attachments.deleteReason,
    })
    .from(attachments)
    .innerJoin(users, eq(users.id, attachments.uploadedBy))
    .leftJoin(deleter, eq(deleter.id, attachments.deletedBy))
    .where(and(eq(attachments.repairCaseId, repairCaseId), eq(attachments.isDeleted, true)))
    .orderBy(desc(attachments.deletedAt));

  return rows.map((row) => ({
    ...row,
    uploadedAt: row.uploadedAt.toISOString(),
    // is_deleted = true 인 행이므로 deleted_at 은 채워져 있다. 만약 비어 있다면
    // 그건 데이터가 어긋난 것이고, 화면이 빈 값으로 깨지지 않게 올린 시각으로
    // 대신한다(복원은 여전히 가능해야 한다).
    deletedAt: (row.deletedAt ?? row.uploadedAt).toISOString(),
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

/**
 * 업로드가 향할 제품 모델. **isLocked에 해당하는 것이 없다.**
 *
 * 접수 건 쪽(getAttachmentUploadTarget)은 출하 완료로 잠긴 건을 막아야 해서
 * is_locked를 함께 읽지만, product_models에는 그런 개념이 없다. 없는 개념을
 * `isLocked: false`로 흉내 내지 않는다 — 그렇게 두면 부르는 쪽이 "언젠가 참이
 * 될 수 있는 값"으로 읽고, 모델에 잠금이 생기지 않는 한 영영 죽어 있는 분기가
 * 남는다. 필드가 없으면 라우트에도 그 확인이 없다는 것이 한눈에 보인다.
 *
 * 휴지통에 있는 모델(is_deleted = true)은 없는 것으로 본다 — 지워진 모델에
 * 새 회로도를 붙일 수는 없다. 접수 건 쪽과 같은 판단이다.
 */
export type ProductModelAttachmentUploadTarget = {
  id: string;
};

export async function getProductModelAttachmentUploadTarget(
  productModelId: string
): Promise<ProductModelAttachmentUploadTarget | null> {
  if (!UUID_PATTERN.test(productModelId)) return null;

  const [row] = await db
    .select({ id: productModels.id })
    .from(productModels)
    .where(and(eq(productModels.id, productModelId), eq(productModels.isDeleted, false)))
    .limit(1);

  return row ?? null;
}
