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
import { buildProductModelAttachmentStoredPath } from "@/lib/domain/attachment-path";
import { createAttachmentRecord } from "@/lib/db/mutations/attachments";
import { getProductModelAttachmentUploadTarget } from "@/lib/db/queries/attachments";
import { getAttachmentStorage } from "@/lib/storage/local-fs-adapter";
import { AttachmentTooLargeError } from "@/lib/storage/storage-adapter";

/**
 * ============================================================================
 * POST /api/product-models/{id}/attachments — 모델 사진·회로도가 들어오는 통로
 * ============================================================================
 * 접수 건 통로(api/repair-cases/[id]/attachments/route.ts)와 **한 벌**이다.
 * 그 파일의 헤더에 이 구조를 고른 까닭이 전부 적혀 있다 — 서버 액션이 아니라
 * Route Handler인 이유, multipart/form-data를 쓰지 않는 이유, 그리고 아래
 * 다섯 단계의 순서. 여기서는 반복하지 않고 **다른 점만** 적는다.
 *
 * ── 왜 공통 함수로 뽑지 않고 나란히 두는가 ───────────────────────────────
 * 접수 건 통로는 이미 실기에서 파일을 다루고 있다. 두 통로를 한 함수로 접으면
 * 그 함수의 다음 수정이 **아무도 의도하지 않은 채** 실기 경로까지 흔든다.
 * 지금 두 통로가 실제로 다른 곳은 네 군데(권한 · 대상 조회 · 잠금 확인 ·
 * 경로 함수)이고, 그 넷을 인자로 받는 함수는 결국 "무엇이 같아야 하는지"를
 * 읽기 어렵게 만든다. 접는 것은 모델 첨부의 실제 쓰임을 본 다음에 판단할 일이다
 * (attachment-path.ts가 경로 함수를 두 벌로 나란히 둔 것과 같은 판단).
 *
 * 🔴 **그러므로 이 파일과 접수 건 통로는 함께 고쳐야 한다.** 상한·검사 순서·
 * 실패 응답 규칙을 한쪽만 바꾸면 두 통로의 동작이 갈라진다.
 *
 * ── 접수 건 통로와 다른 점 ───────────────────────────────────────────────
 *   권한      repairCases.files WRITE   →  **productModels.files WRITE**
 *   대상 조회  getAttachmentUploadTarget →  getProductModelAttachmentUploadTarget
 *   잠금 확인  is_locked 확인            →  **없다** (모델에 잠금 개념이 없다)
 *   경로      buildAttachmentStoredPath →  buildProductModelAttachmentStoredPath
 *   실패 코드  CASE_NOT_FOUND/CASE_LOCKED → **MODEL_NOT_FOUND** (잠금 코드 없음)
 *
 * ── 순서는 그대로다 ──────────────────────────────────────────────────────
 *  1) 본문을 **받기 전에** 출처·세션·승인상태·권한·모델 존재를 확인한다.
 *  2) 임시 파일로 흘려보내며 크기·SHA-256을 함께 센다.
 *  3) 확장자 허용목록 + 실제 앞머리 바이트 대조.
 *  4) 임시 파일을 최종 자리로 **이동(commit)**.
 *  5) **그 다음에** 한 트랜잭션 안에서 attachments 행 + audit_logs(FILE_UPLOAD).
 *
 * ⚠️ **4번과 5번을 뒤집지 않는다.** 반대로 하면 DB에는 있는데 디스크에 없는
 * 파일이 생기고, 그건 눌러도 아무것도 나오지 않는 깨진 기록이다. 지금 순서의
 * 최악은 주인 없는 파일 하나가 남는 것이고 그건 나중에 훑어 치울 수 있다.
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
  // 접수 건 쪽의 CASE_NOT_FOUND에 해당한다. CASE_LOCKED에 해당하는 코드는
  // 두지 않는다 — 제품 모델에는 잠금이 없다.
  | "MODEL_NOT_FOUND"
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

  // 올리는 것은 productModels.files WRITE다 — productModels.view가 아니다.
  // 모델을 **보는** 사람(영업 포함)과 사진·도면을 **바꾸는** 사람은 다르다.
  if (!(await hasPermission(actingUser.role, "productModels.files", "WRITE"))) {
    return fail(403, "FORBIDDEN", "이 제품 모델에 파일을 올릴 권한이 없습니다.");
  }

  const { id: productModelId } = await context.params;

  // 접수 건 쪽과 달리 잠금 확인이 없다. 모델에는 is_locked가 없고, 없는 개념을
  // 흉내 내지 않는다(queries/attachments.ts의 조회 함수 주석 참조).
  const target = await getProductModelAttachmentUploadTarget(productModelId);
  if (!target) {
    return fail(404, "MODEL_NOT_FOUND", "해당 제품 모델을 찾을 수 없습니다.");
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
    console.error("모델 첨부 임시 저장 실패", error);
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
  const storedPath = buildProductModelAttachmentStoredPath({
    productModelId: target.id,
    attachmentId,
    extension,
  });

  // ── 4) 파일을 최종 자리로 옮긴다 (DB보다 먼저 — 파일 상단 ⚠️ 참조) ────
  try {
    await storage.commit(written.tempPath, storedPath);
  } catch (error) {
    await storage.discard(written.tempPath);
    console.error("모델 첨부 파일 이동 실패", error);
    return fail(500, "STORAGE_FAILED", "파일을 저장하는 중 문제가 발생했습니다.");
  }

  // ── 5) 그 다음에 DB (행 + 감사 로그, 한 트랜잭션) ─────────────────────
  let created;
  try {
    created = await createAttachmentRecord({
      id: attachmentId,
      // 주인은 제품 모델이다. 갈래 타입이라 repair_case_id 를 함께 채우는 것은
      // 타입 단계에서 불가능하다(mutations/attachments.ts).
      owner: { kind: "PRODUCT_MODEL", productModelId: target.id },
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
    console.error("모델 첨부 기록 생성 실패", error);
    return fail(500, "RECORD_FAILED", "파일 기록을 저장하는 중 문제가 발생했습니다.");
  }

  return NextResponse.json(
    {
      id: created.id,
      productModelId: target.id,
      category,
      originalFileName,
      fileSize: written.size,
      checksumSha256: written.sha256,
      uploadedAt: created.uploadedAt,
    },
    { status: 201 }
  );
}
