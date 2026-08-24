import "server-only";

import { and, eq, isNull } from "drizzle-orm";
import { db } from "../connection";
import { attachments } from "../schema";

/**
 * ============================================================================
 * 미리보기 경로 기록 — 파일을 놓은 다음에만 부른다
 * ============================================================================
 * 원본 업로드와 같은 순서다: **파일이 먼저, 기록이 나중.** 반대로 하면 DB는
 * 미리보기가 있다고 말하는데 디스크에 없어서, 목록의 썸네일이 전부 깨진다.
 *
 * ── 이미 있으면 덮어쓰지 않는다 ──────────────────────────────────────────
 * `WHERE preview_path IS NULL` 조건을 건다. 같은 첨부에 미리보기가 두 번
 * 올라오면(브라우저를 두 번 눌렀거나, 채우기 작업과 업로드가 겹쳤거나) 나중
 * 것이 앞의 것을 가리키던 경로를 덮어써서, 앞서 놓인 파일이 아무도 가리키지
 * 않는 채 디스크에 남는다. 먼저 온 것을 그대로 두고 나중 것은 거절한다.
 *
 * ── 감사 로그를 남기지 않는다 ────────────────────────────────────────────
 * 미리보기는 원본에서 파생된 화면용 사본이고, 만든 사람도 올린 사람과 같다.
 * 업로드는 이미 FILE_UPLOAD로 남아 있으므로 여기서 한 줄을 더 남기면 같은
 * 행위가 두 번 기록된다 — 감사 로그는 찾을 수 있어야 뜻이 있다.
 * ============================================================================
 */

export type AttachmentPreviewResult =
  | { ok: true }
  | { ok: false; code: "NOT_FOUND" | "ALREADY_SET"; message: string };

export async function setAttachmentPreviewPath(params: {
  attachmentId: string;
  previewPath: string;
}): Promise<AttachmentPreviewResult> {
  const updated = await db
    .update(attachments)
    .set({ previewPath: params.previewPath })
    .where(
      and(
        eq(attachments.id, params.attachmentId),
        eq(attachments.isDeleted, false),
        isNull(attachments.previewPath)
      )
    )
    .returning({ id: attachments.id });

  if (updated.length > 0) return { ok: true };

  // 0행이 바뀌었다. 첨부가 없는 것인지, 이미 미리보기가 있는 것인지 갈라
  // 알려 준다 — 부르는 쪽이 "다시 시도"와 "이미 됐음"을 구분해야 한다.
  const [existing] = await db
    .select({ previewPath: attachments.previewPath })
    .from(attachments)
    .where(and(eq(attachments.id, params.attachmentId), eq(attachments.isDeleted, false)))
    .limit(1);

  if (!existing) {
    return { ok: false, code: "NOT_FOUND", message: "파일을 찾을 수 없습니다." };
  }
  return { ok: false, code: "ALREADY_SET", message: "미리보기가 이미 있습니다." };
}
