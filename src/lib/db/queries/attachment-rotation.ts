import "server-only";

import { eq } from "drizzle-orm";
import { db } from "../connection";
import { attachments, quotes } from "../schema";
import type { MalwareScanStatus } from "@/lib/domain/attachment-category";

/**
 * ============================================================================
 * 돌린 사진을 저장하기 전에 읽는 한 줄 — 되돌릴 수 없으므로 넉넉히 읽는다
 * ============================================================================
 * 내려받기 조회(attachment-download.ts)를 쓰지 않는다. 그쪽은 **모든 내려받기가
 * 치르는 비용**이라 판정에 꼭 필요한 값만 읽도록 좁혀 둔 조회이고, 여기서 필요한
 * 것이 빠져 있다:
 *
 *   · `checksumSha256`  지금 디스크에 있는 것이 정말 이 사람이 화면에서 본 그
 *                     파일인지 가르는 열쇠다. 기록할 때 이 값으로 한 번 더 맞춘다
 *                     (mutations/attachment-rotation.ts 의 「그 사이 바뀌었는가」).
 *
 * ── 🔴 둘째 까닭이 2026-10-28 에 없어졌다 ────────────────────────────────
 * 그날 전까지 위 목록은 **둘**이었고, 첫째가 이것이었다:
 *
 *   「`isLocked` — 출하 완료로 잠긴 접수 건의 파일은 올리지도 지우지도 못한다
 *    (업로드 라우트의 CASE_LOCKED · attachment-trash.ts). 원본을 덮어쓰는 것은
 *    그보다 더한 일이라 같은 문에서 막는다. **본문을 받기 전에** 알아야 20MB 를
 *    받아 놓고 되돌리지 않는다.」
 *
 * 그날 올리기 · 휴지통행 · 되살리기가 풀렸고, 「같은 탭인데 하나만 막히면 이상하다」는
 * 사용자 결정으로 **회전 저장도 함께 풀렸다**(mutations/attachment-rotation.ts 머리말에
 * 까닭과 잃는 것이 적혀 있다 — 되돌릴 수 없는 덮어쓰기다). 그래서 이 조회는
 * `repair_cases` 를 **조인하지 않는다** — 아무도 안 보는 값을 읽어 두면 다음 사람이
 * 「어딘가에서 보고 있다」고 읽는다.
 *
 * 🔴 **까닭이 하나로 줄었다고 이 조회를 내려받기 쪽에 합치지는 않는다.** 체크섬을
 * 그쪽에 더하면 썸네일 한 장을 그릴 때마다 함께 읽게 된다. 드물게 도는 통로가 자기
 * 조회를 갖는다.
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
  // 🔴 `caseLocked` 가 여기 없는 것은 빠뜨린 것이 아니다 — 2026-10-28 에 뺐다(머리말의
  //    「둘째 까닭이 없어졌다」). 견적서 쪽 quoteInTrash 는 그대로다.
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
    // 🔴 접수 건 조인이 없다 — 2026-10-28 에 잠금을 안 보게 되면서 읽을 값이 없어졌다.
    .leftJoin(quotes, eq(quotes.id, attachments.quoteId))
    .where(eq(attachments.id, attachmentId))
    .limit(1);

  if (!row) return null;
  const { quoteIsDeleted, ...rest } = row;
  return { ...rest, quoteInTrash: quoteIsDeleted === true };
}
