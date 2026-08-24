import { NextResponse, type NextRequest } from "next/server";

import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { hasPermission } from "@/lib/auth/permission-resolver";
import { isTrustedOrigin } from "@/lib/auth/request-guards";
import { readSession } from "@/lib/auth/session";
import { buildAttachmentPreviewPath } from "@/lib/domain/attachment-path";
import { getAttachmentForDownload } from "@/lib/db/queries/attachment-download";
import { setAttachmentPreviewPath } from "@/lib/db/mutations/attachment-preview";
import { getAttachmentStorage } from "@/lib/storage/local-fs-adapter";
import { AttachmentTooLargeError } from "@/lib/storage/storage-adapter";

/**
 * ============================================================================
 * PUT /api/attachments/{id}/preview — 썸네일을 받아 둔다
 * ============================================================================
 * 목록의 썸네일이 원본 파일이었다. 사진 스무 장짜리 접수 건을 열면 스무 장을
 * 통째로 받았고, 폰에서 사내망으로 60MB를 끌어오는 셈이었다.
 *
 * ── 서버에서 만들지 않는 이유 ────────────────────────────────────────────
 * 서버가 썸네일을 만들려면 이미지 처리 라이브러리(sharp 등)가 필요한데, 그것은
 * 네이티브 바이너리라 Docker 컨테이너로 옮길 때 OS별 빌드를 따라다녀야 한다.
 * 이 시스템은 NAS(Linux 컨테이너)로 옮기는 것이 정해져 있어 그 짐을 지지 않기로
 * 했다(사용자 결정, 5D 4단계).
 *
 * 대신 **올리는 브라우저가 만들어 함께 보낸다.** 원본을 이미 손에 들고 있으므로
 * 다시 받을 필요가 없고, 서버는 CPU를 전혀 쓰지 않는다. 옛 사진은 목록 화면에서
 * "미리보기 만들기"로 채운다 — 그때도 만드는 쪽은 브라우저다.
 *
 * ── 원본과 같은 순서 ─────────────────────────────────────────────────────
 * 파일을 먼저 놓고, 그 다음에 DB에 경로를 적는다. 반대로 하면 DB는 미리보기가
 * 있다고 말하는데 디스크에 없어서 목록의 썸네일이 전부 깨진다.
 *
 * 미리보기는 없어도 되는 것이다(없으면 원본으로 보여 준다). 그래서 실패해도
 * 업로드 전체를 되돌리지 않는다 — 부르는 쪽이 조용히 넘어가면 된다.
 * ============================================================================
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 썸네일 상한. 브라우저가 400px 안팎으로 만들어 보내므로 넉넉하다. 이보다 크면
 * 미리보기가 아니라 원본을 보낸 것이니 거절한다 — 목록을 빠르게 하려고 만든
 * 통로가 원본을 한 벌 더 쌓는 자리가 되면 안 된다.
 */
const MAX_PREVIEW_BYTES = 512 * 1024;

type FailureCode =
  | "UNTRUSTED_ORIGIN"
  | "UNAUTHENTICATED"
  | "ACCOUNT_NOT_APPROVED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "ALREADY_SET"
  | "NOT_AN_IMAGE"
  | "EMPTY_BODY"
  | "TOO_LARGE"
  | "STORAGE_FAILED";

function fail(status: number, code: FailureCode, message: string): NextResponse {
  return NextResponse.json({ error: message, code }, { status });
}

export async function PUT(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  if (!isTrustedOrigin(request)) {
    return fail(403, "UNTRUSTED_ORIGIN", "요청 출처를 확인할 수 없습니다.");
  }

  const session = await readSession();
  if (!session) return fail(401, "UNAUTHENTICATED", "로그인이 필요합니다.");

  const actingUser = await resolveActingUserForSession(session);
  if (!actingUser) return fail(401, "UNAUTHENTICATED", "사용자 정보를 확인할 수 없습니다.");
  if (actingUser.approvalStatus !== "APPROVED") {
    return fail(403, "ACCOUNT_NOT_APPROVED", "승인 대기 중인 계정입니다.");
  }

  // 미리보기를 만드는 것은 파일을 바꾸는 일이므로 올리기와 같은 권한을 본다.
  if (!(await hasPermission(actingUser.role, "repairCases.files", "WRITE"))) {
    return fail(403, "FORBIDDEN", "이 파일을 다룰 권한이 없습니다.");
  }

  const { id: attachmentId } = await context.params;
  const attachment = await getAttachmentForDownload(attachmentId);
  if (!attachment || attachment.isDeleted) {
    return fail(404, "NOT_FOUND", "파일을 찾을 수 없습니다.");
  }
  if (!attachment.repairCaseId) {
    // 접수 건에서 떨어져 나온 첨부는 미리보기를 둘 자리(폴더)를 정할 수 없다.
    return fail(404, "NOT_FOUND", "접수 건과 연결이 끊긴 파일입니다.");
  }
  if (attachment.previewPath) {
    return fail(409, "ALREADY_SET", "미리보기가 이미 있습니다.");
  }
  // 사진이 아닌 것에는 미리보기가 없다. 여기서 막지 않으면 압축 파일에
  // 엉뚱한 그림이 붙는다.
  if (attachment.mimeType !== "image/jpeg" && attachment.mimeType !== "image/png") {
    return fail(400, "NOT_AN_IMAGE", "사진이 아닌 파일에는 미리보기를 만들지 않습니다.");
  }

  const body = request.body;
  if (!body) return fail(400, "EMPTY_BODY", "미리보기 내용이 비어 있습니다.");

  const storage = getAttachmentStorage();
  let written;
  try {
    written = await storage.writeTemp(body, { maxBytes: MAX_PREVIEW_BYTES });
  } catch (error) {
    if (error instanceof AttachmentTooLargeError) {
      return fail(413, "TOO_LARGE", "미리보기가 너무 큽니다.");
    }
    return fail(500, "STORAGE_FAILED", "미리보기를 저장하지 못했습니다.");
  }

  if (written.size === 0) {
    await storage.discard(written.tempPath);
    return fail(400, "EMPTY_BODY", "미리보기 내용이 비어 있습니다.");
  }

  const previewPath = buildAttachmentPreviewPath({
    repairCaseId: attachment.repairCaseId,
    attachmentId: attachment.id,
  });

  // 파일이 먼저, 기록이 나중 — 원본 업로드와 같은 순서다.
  try {
    await storage.commit(written.tempPath, previewPath);
  } catch {
    await storage.discard(written.tempPath);
    return fail(500, "STORAGE_FAILED", "미리보기를 저장하지 못했습니다.");
  }

  const result = await setAttachmentPreviewPath({ attachmentId: attachment.id, previewPath });
  if (!result.ok) {
    // 방금 놓은 파일을 되돌린다. 실패해도 더 밀어붙이지 않는다 — 주인 없는
    // 파일 하나가 남을 뿐이고, 그건 나중에 치울 수 있다.
    await storage.delete(previewPath).catch(() => {});
    return fail(result.code === "NOT_FOUND" ? 404 : 409, result.code, result.message);
  }

  return NextResponse.json({ ok: true }, { status: 201 });
}
