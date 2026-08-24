"use server";

import { revalidatePath } from "next/cache";
import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { hasPermission } from "@/lib/auth/permission-resolver";
import { readSession } from "@/lib/auth/session";
import { getRepairCaseReadSource } from "@/lib/config/read-source";
import { getRepairCaseWriteSource } from "@/lib/config/write-source";
import { restoreAttachment, softDeleteAttachment } from "@/lib/db/mutations/attachment-trash";

/**
 * ============================================================================
 * 첨부 휴지통 서버 액션 — 화면이 부르는 통로
 * ============================================================================
 * 업로드는 Route Handler였다(본문이 파일 바이트라 스트림이 필요했다). 지우고
 * 되살리는 것은 실어 보낼 본문이 id와 사유뿐이라 서버 액션이 맞다.
 *
 * ── 인가를 여기서도, mutation에서도 확인한다 ──────────────────────────────
 * 여기서 보는 것은 "이 사람이 이 종류의 일을 할 수 있는가"(역할 권한)이고,
 * mutation이 보는 것은 "그 대상이 지금 그 일을 받을 수 있는 상태인가"
 * (존재·중복·잠금)다. 둘은 다른 질문이라 한쪽이 다른 쪽을 대신하지 못한다.
 *
 * ── 화면 갱신 ────────────────────────────────────────────────────────────
 * 성공했을 때만 revalidatePath를 부른다. 실패에 걸면 아무것도 안 바뀐 화면을
 * 다시 그리느라 헛일을 한다.
 *
 * 갱신되는 것은 **행위자 본인의 다음 렌더**다. 다른 사람이 열어 둔 브라우저에
 * 밀어 넣지는 못한다 — 그건 폴링/웹소켓이 필요한 별도 작업이다.
 * ============================================================================
 */

export type AttachmentTrashActionResult =
  | { ok: true }
  | { ok: false; code: string; message: string };

async function resolveWriteActor(): Promise<
  { ok: true; userId: string } | { ok: false; result: AttachmentTrashActionResult & { ok: false } }
> {
  if (getRepairCaseWriteSource() !== "database" || getRepairCaseReadSource() !== "database") {
    return {
      ok: false,
      result: { ok: false, code: "FORBIDDEN", message: "데이터베이스 저장 모드가 아닙니다." },
    };
  }

  const session = await readSession();
  if (!session) {
    return { ok: false, result: { ok: false, code: "UNAUTHORIZED", message: "로그인이 필요합니다." } };
  }

  // 세션 토큰의 값이 아니라 살아 있는 계정을 다시 읽는다 — 토큰이 발급된 뒤
  // 계정이 정지·삭제됐을 수 있다.
  const actingUser = await resolveActingUserForSession(session);
  if (!actingUser) {
    return { ok: false, result: { ok: false, code: "UNAUTHORIZED", message: "사용자 정보를 확인할 수 없습니다." } };
  }
  if (actingUser.approvalStatus !== "APPROVED") {
    return {
      ok: false,
      result: { ok: false, code: "FORBIDDEN", message: "계정이 아직 승인되지 않았습니다." },
    };
  }

  if (!(await hasPermission(actingUser.role, "repairCases.files", "WRITE"))) {
    return { ok: false, result: { ok: false, code: "FORBIDDEN", message: "파일을 지울 권한이 없습니다." } };
  }

  return { ok: true, userId: actingUser.id };
}

/** 첨부를 휴지통으로 보낸다. 디스크 파일은 남는다(mutations/attachment-trash.ts 참조). */
export async function softDeleteAttachmentAction(input: {
  attachmentId: string;
  repairCaseId: string;
  reason?: string | null;
}): Promise<AttachmentTrashActionResult> {
  const actor = await resolveWriteActor();
  if (!actor.ok) return actor.result;

  const reason = (input.reason ?? "").trim();
  const result = await softDeleteAttachment({
    attachmentId: input.attachmentId,
    actorUserId: actor.userId,
    reason: reason.length > 0 ? reason.slice(0, 500) : null,
  });

  if (!result.ok) return { ok: false, code: result.code, message: result.message };

  revalidatePath(`/repair-cases/${input.repairCaseId}`, "layout");
  return { ok: true };
}

/** 휴지통의 첨부를 되살린다. */
export async function restoreAttachmentAction(input: {
  attachmentId: string;
  repairCaseId: string;
}): Promise<AttachmentTrashActionResult> {
  const actor = await resolveWriteActor();
  if (!actor.ok) return actor.result;

  const result = await restoreAttachment({
    attachmentId: input.attachmentId,
    actorUserId: actor.userId,
  });

  if (!result.ok) return { ok: false, code: result.code, message: result.message };

  revalidatePath(`/repair-cases/${input.repairCaseId}`, "layout");
  return { ok: true };
}
