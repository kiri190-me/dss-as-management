"use server";

import { revalidatePath } from "next/cache";
import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { hasPermission } from "@/lib/auth/permission-resolver";
import { readSession } from "@/lib/auth/session";
import { getRepairCaseReadSource } from "@/lib/config/read-source";
import { getRepairCaseWriteSource } from "@/lib/config/write-source";
import { restoreAttachment, softDeleteAttachment } from "@/lib/db/mutations/attachment-trash";
import { getAttachmentForDownload } from "@/lib/db/queries/attachment-download";

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
 *
 * ── 🔴 권한은 첨부의 **주인**을 보고 고른다 ──────────────────────────────
 * 첨부의 주인은 접수 건 아니면 제품 모델이다(schema/attachments.ts).
 *
 *   접수 건 첨부  →  repairCases.files WRITE     (예전 그대로)
 *   모델 첨부     →  **productModels.files WRITE**
 *
 * 예전에는 repairCases.files WRITE 하나만 물었다. 모델 첨부가 생긴 지금 그대로
 * 두면 **접수 건 파일 권한만 가진 사람이 모델 회로도를 지울 수 있다** — 그리고
 * 그 사실은 아무 화면에도 드러나지 않는다. 그래서 주인을 DB에서 다시 읽어
 * 물을 권한을 고른다. **부르는 쪽이 넘긴 ID는 권한 판단에 쓰지 않는다** —
 * 클라이언트가 정하는 값으로 권한을 고르면 그 값을 바꿔 보내는 것만으로
 * 문턱이 바뀐다. 인자의 ID는 오직 화면 갱신 경로를 정하는 데만 쓴다.
 *
 * 모델 첨부를 **보는** 것은 productModels.view면 되지만(다운로드 라우트 헤더),
 * 지우고 되살리는 것은 files다. 보는 사람과 바꾸는 사람은 다르다.
 *
 * ── 권한 묻는 순서 ───────────────────────────────────────────────────────
 * 주인을 알아야 물을 권한이 정해지므로 조회가 앞으로 왔다. 다운로드 라우트와
 * 같은 두 겹이다 — 어느 쪽 파일도 다룰 수 없는 사람은 조회 전에 FORBIDDEN,
 * 문턱은 넘었지만 이 주인의 파일은 못 다루는 사람에게는 **"없음"과 같은 응답**
 * (NOT_FOUND). 갈라 답하면 그 ID가 실재한다는 사실이 새어 나간다.
 * ============================================================================
 */

export type AttachmentTrashActionResult =
  | { ok: true }
  | { ok: false; code: string; message: string };

/**
 * 화면 갱신 대상. **권한 판단에는 쓰이지 않는다** — 주인은 DB에서 다시 읽는다
 * (파일 헤더의 🔴 항목). 둘 다 비어 있으면 갱신할 화면이 없다는 뜻이고, 그
 * 경우에도 삭제·복원 자체는 정상으로 처리한다.
 */
type AttachmentTrashActionTarget = {
  attachmentId: string;
  repairCaseId?: string;
  productModelId?: string;
};

async function resolveWriteActor(
  attachmentId: string
): Promise<
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

  // ── 넓은 문턱 — 조회보다 앞이다 ────────────────────────────────────────
  // 어느 쪽 파일도 다룰 수 없는 사람은 첨부를 읽기 전에 막는다. 예전에
  // repairCases.files 하나로 막던 그 자리이고, 그때처럼 존재 여부가 드러나지
  // 않는다. 두 번 물어도 DB는 한 번만 읽힌다(permission-resolver의 cache()).
  const canWriteRepairCaseFiles = await hasPermission(actingUser, "repairCases.files", "WRITE");
  const canWriteProductModelFiles = await hasPermission(actingUser, "productModels.files", "WRITE");
  if (!canWriteRepairCaseFiles && !canWriteProductModelFiles) {
    return { ok: false, result: { ok: false, code: "FORBIDDEN", message: "파일을 지울 권한이 없습니다." } };
  }

  // ── 주인을 DB에서 읽어 물을 권한을 고른다 ──────────────────────────────
  const attachment = await getAttachmentForDownload(attachmentId);
  if (!attachment) {
    // mutation이 돌려주던 것과 같은 코드·문장이다.
    return { ok: false, result: { ok: false, code: "NOT_FOUND", message: "파일을 찾을 수 없습니다." } };
  }

  const allowedForOwner = attachment.productModelId
    ? canWriteProductModelFiles
    : canWriteRepairCaseFiles;
  if (!allowedForOwner) {
    // 🔴 FORBIDDEN이 아니라 NOT_FOUND다 — 없는 것과 못 다루는 것을 응답에서
    // 구분하지 않는다(파일 헤더의 '권한 묻는 순서').
    return { ok: false, result: { ok: false, code: "NOT_FOUND", message: "파일을 찾을 수 없습니다." } };
  }

  return { ok: true, userId: actingUser.id };
}

/**
 * 성공 뒤 다시 그릴 화면. 인자로 받은 ID만 쓴다 — 이 값은 권한을 정하지 않으므로
 * 클라이언트가 정해도 안전하다. 넘어온 것이 없으면 아무것도 갱신하지 않는다.
 */
function revalidateAfterTrashChange(target: AttachmentTrashActionTarget): void {
  if (target.repairCaseId) {
    revalidatePath(`/repair-cases/${target.repairCaseId}`, "layout");
  }
  if (target.productModelId) {
    revalidatePath(`/product-models/${target.productModelId}`, "layout");
  }
}

/** 첨부를 휴지통으로 보낸다. 디스크 파일은 남는다(mutations/attachment-trash.ts 참조). */
export async function softDeleteAttachmentAction(
  input: AttachmentTrashActionTarget & { reason?: string | null }
): Promise<AttachmentTrashActionResult> {
  const actor = await resolveWriteActor(input.attachmentId);
  if (!actor.ok) return actor.result;

  const reason = (input.reason ?? "").trim();
  const result = await softDeleteAttachment({
    attachmentId: input.attachmentId,
    actorUserId: actor.userId,
    reason: reason.length > 0 ? reason.slice(0, 500) : null,
  });

  if (!result.ok) return { ok: false, code: result.code, message: result.message };

  revalidateAfterTrashChange(input);
  return { ok: true };
}

/** 휴지통의 첨부를 되살린다. */
export async function restoreAttachmentAction(
  input: AttachmentTrashActionTarget
): Promise<AttachmentTrashActionResult> {
  const actor = await resolveWriteActor(input.attachmentId);
  if (!actor.ok) return actor.result;

  const result = await restoreAttachment({
    attachmentId: input.attachmentId,
    actorUserId: actor.userId,
  });

  if (!result.ok) return { ok: false, code: result.code, message: result.message };

  revalidateAfterTrashChange(input);
  return { ok: true };
}
