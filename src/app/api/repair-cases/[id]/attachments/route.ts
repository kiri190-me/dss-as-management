import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";

import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { hasPermission } from "@/lib/auth/permission-resolver";
import { isTrustedOrigin } from "@/lib/auth/request-guards";
import { readSession } from "@/lib/auth/session";
import {
  MAX_ATTACHMENT_SIZE_BYTES,
  canonicalMimeTypeForExtension,
  isAllowedExtension,
  isContentCompatibleWithExtension,
  isExtensionAllowedForCategory,
  normalizeFileExtension,
} from "@/lib/domain/attachment-allowlist";
import { isAttachmentCategory } from "@/lib/domain/attachment-category";
import { buildAttachmentStoredPath } from "@/lib/domain/attachment-path";
import { createAttachmentRecord } from "@/lib/db/mutations/attachments";
import { getAttachmentUploadTarget } from "@/lib/db/queries/attachments";
import { getAttachmentStorage } from "@/lib/storage/local-fs-adapter";
import { AttachmentTooLargeError } from "@/lib/storage/storage-adapter";

/**
 * ============================================================================
 * POST /api/repair-cases/{id}/attachments — 파일이 실제로 들어오는 통로
 * ============================================================================
 * 서버 액션이 아니라 Route Handler다. 이유는 두 가지다.
 *  1. 서버 액션은 본문을 통째로 메모리에 올린다. 20MB 파일 몇 개가 동시에
 *     올라오는 순간 그대로 프로세스에 부담이 되고, 상한을 올리는 날 사고가 된다.
 *     여기서는 `request.body`를 스트림 그대로 저장소에 흘려보낸다.
 *  2. 3단계의 다운로드도 어차피 이 통로가 필요하다.
 *
 * ── multipart/form-data를 쓰지 않는다 ────────────────────────────────────
 * `request.formData()`는 파일 전체를 메모리에 담고 나서야 돌려준다 — 위 1번을
 * 정면으로 어긴다. 그래서 **본문은 파일 바이트 그 자체**이고, 메타데이터
 * (분류·원본 파일명·설명)는 쿼리 문자열로 받는다. 클라이언트는
 * `fetch(url, { method: "POST", body: file })` 한 줄이면 된다.
 *
 * ── 순서가 이 파일의 핵심이다 ────────────────────────────────────────────
 *  1) 본문을 **받기 전에** 세션·권한·접수 건 존재·잠금을 확인한다. 막히면 한
 *     바이트도 받지 않는다.
 *  2) 임시 파일로 흘려보내며 크기·SHA-256을 동시에 계산한다. 20MB를 넘으면
 *     그 자리에서 끊고 임시 파일을 버린다.
 *  3) 확장자 허용목록 + 실제 앞머리 바이트 대조. 브라우저가 보낸 MIME은 믿지
 *     않는다.
 *  4) 임시 파일을 최종 자리로 **이동(commit)**.
 *  5) **그 다음에** 한 트랜잭션 안에서 attachments 행 + audit_logs(FILE_UPLOAD).
 *
 * ⚠️ **4번과 5번을 뒤집지 않는다.** 파일 이동이 먼저, DB가 나중이다. 반대로
 * 하면 DB에는 있는데 디스크에 없는 파일이 생기고, 그건 화면에서 눌러도 아무것도
 * 나오지 않는 **깨진 기록**이다. 지금 순서에서 최악의 경우는 주인 없는 파일이
 * 하나 남는 것인데, 그건 나중에 훑어서 치울 수 있는 문제다. 되돌릴 수 없는
 * 고장과 치울 수 있는 찌꺼기 중에서 후자를 고른 것이다.
 * ============================================================================
 */

// 파일을 다루므로 Node 런타임이 필요하다(node:fs, node:crypto).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type FailureCode =
  | "UNTRUSTED_ORIGIN"
  | "UNAUTHENTICATED"
  | "ACCOUNT_NOT_APPROVED"
  | "FORBIDDEN"
  | "CASE_NOT_FOUND"
  | "CASE_LOCKED"
  | "INVALID_CATEGORY"
  | "INVALID_FILE_NAME"
  | "EXTENSION_NOT_ALLOWED"
  | "EXTENSION_NOT_ALLOWED_FOR_CATEGORY"
  | "EMPTY_BODY"
  | "FILE_TOO_LARGE"
  | "CONTENT_MISMATCH"
  | "STORAGE_FAILED"
  | "RECORD_FAILED";

function fail(status: number, code: FailureCode, message: string): NextResponse {
  // 무엇이 왜 막혔는지 사람이 읽을 수 있게 돌려준다. 다만 저장 루트나
  // 내부 경로는 절대 싣지 않는다 — 실패 응답이 디스크 구조를 알려 주는
  // 창구가 되면 안 된다.
  return NextResponse.json({ error: message, code }, { status });
}

const MAX_ORIGINAL_FILE_NAME_LENGTH = 255;
const MAX_DESCRIPTION_LENGTH = 500;

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  // ── 1) 본문을 받기 전에 끝내야 하는 확인들 ────────────────────────────
  if (!isTrustedOrigin(request)) {
    return fail(403, "UNTRUSTED_ORIGIN", "요청 출처를 확인할 수 없습니다.");
  }

  const session = await readSession();
  if (!session) {
    return fail(401, "UNAUTHENTICATED", "로그인이 필요합니다.");
  }

  const actingUser = await resolveActingUserForSession(session);
  if (!actingUser) {
    return fail(401, "UNAUTHENTICATED", "사용자 정보를 확인할 수 없습니다.");
  }
  if (actingUser.approvalStatus !== "APPROVED") {
    return fail(403, "ACCOUNT_NOT_APPROVED", "승인 대기 중인 계정은 파일을 올릴 수 없습니다.");
  }

  if (!(await hasPermission(actingUser, "repairCases.files", "WRITE"))) {
    return fail(403, "FORBIDDEN", "이 접수 건에 파일을 올릴 권한이 없습니다.");
  }

  const { id: repairCaseId } = await context.params;

  const target = await getAttachmentUploadTarget(repairCaseId);
  if (!target) {
    return fail(404, "CASE_NOT_FOUND", "해당 접수 건을 찾을 수 없습니다.");
  }
  if (target.isLocked) {
    return fail(409, "CASE_LOCKED", "출하 완료로 잠긴 접수 건에는 파일을 올릴 수 없습니다.");
  }

  // ── 메타데이터(쿼리 문자열) 검증 — 아직 본문은 건드리지 않았다 ────────
  const searchParams = request.nextUrl.searchParams;

  const category = (searchParams.get("category") ?? "").trim();
  if (!isAttachmentCategory(category)) {
    return fail(400, "INVALID_CATEGORY", "첨부 분류가 올바르지 않습니다.");
  }

  const originalFileName = (searchParams.get("fileName") ?? "").trim();
  if (originalFileName.length === 0 || originalFileName.length > MAX_ORIGINAL_FILE_NAME_LENGTH) {
    return fail(400, "INVALID_FILE_NAME", "파일 이름이 비어 있거나 너무 깁니다.");
  }

  const extension = normalizeFileExtension(originalFileName);
  if (!extension || !isAllowedExtension(extension)) {
    return fail(415, "EXTENSION_NOT_ALLOWED", "허용되지 않는 파일 형식입니다.");
  }
  if (!isExtensionAllowedForCategory(extension, category)) {
    return fail(
      415,
      "EXTENSION_NOT_ALLOWED_FOR_CATEGORY",
      `'${category}' 분류에는 이 확장자(.${extension})를 올릴 수 없습니다.`
    );
  }

  const rawDescription = (searchParams.get("description") ?? "").trim();
  const description = rawDescription.length > 0 ? rawDescription.slice(0, MAX_DESCRIPTION_LENGTH) : null;

  // 브라우저가 알려 준 크기로 미리 자른다. 이 값은 믿을 수 없지만(진짜 판정은
  // 아래 writeTemp가 센 바이트로 한다) 맞을 때는 20MB를 받아 놓고 버리는 일을
  // 통째로 아낀다.
  const declaredLength = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_ATTACHMENT_SIZE_BYTES) {
    return fail(413, "FILE_TOO_LARGE", "파일이 20MB를 넘습니다.");
  }

  const body = request.body;
  if (!body) {
    return fail(400, "EMPTY_BODY", "올릴 파일이 없습니다.");
  }

  const storage = getAttachmentStorage();

  // ── 2) 임시 파일로 흘려보내며 크기·체크섬 계산 ────────────────────────
  let written;
  try {
    written = await storage.writeTemp(body, { maxBytes: MAX_ATTACHMENT_SIZE_BYTES });
  } catch (error) {
    if (error instanceof AttachmentTooLargeError) {
      // 임시 파일은 writeTemp가 던지기 전에 이미 지웠다.
      return fail(413, "FILE_TOO_LARGE", "파일이 20MB를 넘습니다.");
    }
    console.error("첨부 임시 저장 실패", error);
    return fail(500, "STORAGE_FAILED", "파일을 저장하는 중 문제가 발생했습니다.");
  }

  // ── 3) 확장자 ↔ 실제 내용 대조 ────────────────────────────────────────
  if (written.size === 0) {
    await storage.discard(written.tempPath);
    return fail(400, "EMPTY_BODY", "빈 파일은 올릴 수 없습니다.");
  }
  if (!isContentCompatibleWithExtension(extension, written.header)) {
    await storage.discard(written.tempPath);
    return fail(
      415,
      "CONTENT_MISMATCH",
      `파일 내용이 확장자(.${extension})와 맞지 않습니다. 이름만 바꾼 파일은 올릴 수 없습니다.`
    );
  }

  const attachmentId = randomUUID().toLowerCase();
  const storedPath = buildAttachmentStoredPath({ repairCaseId, attachmentId, extension });

  // ── 4) 파일을 최종 자리로 옮긴다 (DB보다 먼저 — 파일 상단 ⚠️ 참조) ────
  try {
    await storage.commit(written.tempPath, storedPath);
  } catch (error) {
    await storage.discard(written.tempPath);
    console.error("첨부 파일 이동 실패", error);
    return fail(500, "STORAGE_FAILED", "파일을 저장하는 중 문제가 발생했습니다.");
  }

  // ── 5) 그 다음에 DB (행 + 감사 로그, 한 트랜잭션) ─────────────────────
  let created;
  try {
    created = await createAttachmentRecord({
      id: attachmentId,
      owner: { kind: "REPAIR_CASE", repairCaseId: target.id },
      category,
      originalFileName,
      storedPath,
      // 브라우저가 보낸 Content-Type이 아니라 확장자에서 서버가 고른 값이다.
      mimeType: canonicalMimeTypeForExtension(extension) ?? "application/octet-stream",
      fileSize: written.size,
      checksumSha256: written.sha256,
      description,
      uploadedBy: actingUser.id,
    });
  } catch (error) {
    // 기록을 만들지 못했으면 방금 놓은 파일은 주인이 없다. 치워 보되,
    // 실패해도 여기서 더 하지 않는다 — 주인 없는 파일은 나중에 훑어 치울 수
    // 있지만, 이 시점에 DB를 억지로 채우면 그게 깨진 기록이 된다.
    await storage.delete(storedPath).catch(() => undefined);
    console.error("첨부 기록 생성 실패", error);
    return fail(500, "RECORD_FAILED", "파일 기록을 저장하는 중 문제가 발생했습니다.");
  }

  return NextResponse.json(
    {
      id: created.id,
      repairCaseId: target.id,
      category,
      originalFileName,
      fileSize: written.size,
      checksumSha256: written.sha256,
      uploadedAt: created.uploadedAt,
    },
    { status: 201 }
  );
}
