import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";

import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { hasPermission } from "@/lib/auth/permission-resolver";
import { isTrustedOrigin } from "@/lib/auth/request-guards";
import { readSession } from "@/lib/auth/session";
import { getAuthSource } from "@/lib/config/auth-source";
import {
  MAX_ATTACHMENT_SIZE_BYTES,
  canonicalMimeTypeForExtension,
  isAllowedExtension,
  isContentCompatibleWithExtension,
  isExtensionAllowedForCategory,
  normalizeFileExtension,
} from "@/lib/domain/attachment-allowlist";
import { IMPROVEMENT_REQUEST_ATTACHMENT_CATEGORY } from "@/lib/domain/attachment-category";
import { buildImprovementRequestAttachmentStoredPath } from "@/lib/domain/attachment-path";
import {
  IMPROVEMENT_REQUEST_SCREENSHOT_FORBIDDEN_MESSAGE,
  IMPROVEMENT_REQUEST_SCREENSHOT_LIMIT_MESSAGE,
  canChangeImprovementRequestScreenshots,
  hasImprovementRequestScreenshotRoom,
} from "@/lib/domain/improvement-request";
import {
  ImprovementRequestAttachmentRejectedError,
  createAttachmentRecord,
} from "@/lib/db/mutations/attachments";
import { getImprovementRequestAttachmentTarget } from "@/lib/db/queries/attachments";
import { getAttachmentStorage } from "@/lib/storage/local-fs-adapter";
import { AttachmentTooLargeError } from "@/lib/storage/storage-adapter";

/**
 * ============================================================================
 * POST /api/improvement-requests/{id}/attachments — 개선 요청 글에 스크린샷을 붙이는 통로
 * ============================================================================
 * 제품 모델 통로(api/product-models/[id]/attachments/route.ts)와 **같은 순서 · 같은
 * 방어**다. 서버 액션이 아니라 Route Handler 인 까닭, multipart 를 쓰지 않는 까닭,
 * 다섯 단계의 순서는 접수 건 통로(api/repair-cases/[id]/attachments/route.ts) 헤더에
 * 있다. 여기서는 **다른 점만** 적는다. 🔴 세 통로의 상한 · 검사 순서 · 실패 응답
 * 규칙은 함께 고친다 — 한쪽만 바꾸면 동작이 갈라진다.
 *
 * ── 제품 모델 통로와 다른 점 ─────────────────────────────────────────────
 *   DB 모드   없음                   →  AUTH_SOURCE 가 database 가 아니면 403
 *                                        (개선 요청 화면·서버 액션과 같은 관문)
 *   권한      productModels.files    →  **improvementRequests WRITE** + 글 한 건 판정
 *             WRITE                     (접수 상태인 자기 글, 또는 MANAGE)
 *   대상 조회  getProductModel…Target →  getImprovementRequestAttachmentTarget
 *   분류      요청값(category)        →  **언제나 SCREENSHOT** — 요청값을 읽지 않는다
 *   설명      description 을 받는다   →  받지 않는다(스크린샷에 설명 칸이 없다)
 *   상한      없음                    →  **한 글에 5장** — 아래 '5장은 두 번 센다'
 *   경로      product-models/…        →  improvement-requests/{글id}/{첨부id}.{확장자}
 *   실패 코드  MODEL_NOT_FOUND        →  IMPROVEMENT_REQUEST_NOT_FOUND · LIMIT_REACHED
 *
 * ── 글 한 건에 대한 판정에 막히면 404 가 아니라 403 이다 ─────────────────
 * HANDOFF W-1-3 의 원칙은 「넓은 문턱은 넘었지만 **그 종류의 대상을 볼 권한이 없는**
 * 사람에게 403 으로 갈라 답하면 존재가 샌다 → 404」다. 여기서 문턱은 곧
 * improvementRequests WRITE 이고, WRITE 는 READ 를 품는다(meetsPermissionLevel) —
 * 문턱을 넘은 사람은 개선 요청 목록 전체를 이미 본다(목록은 모두가 본다 — schema
 * 헤더). 그 사람에게 「그 글이 있다」는 비밀이 아니다. 그러니 404 로 숨길 것이 없고,
 * 404 는 오히려 「글이 지워졌나」로 잘못 읽힌다. 그래서:
 *   · 문턱(WRITE) 없음        → 403 FORBIDDEN (조회 전)
 *   · 글이 없음               → 404 IMPROVEMENT_REQUEST_NOT_FOUND
 *   · 남의 글 · 진행중인 글    → 403 FORBIDDEN, 사람이 읽는 까닭과 함께
 * 개선 요청 mutation 이 고치기·지우기를 거절할 때 NOT_FOUND 가 아니라 FORBIDDEN 을
 * 돌려주는 것과 같은 판단이다.
 *
 * ── 5장은 두 번 센다 ─────────────────────────────────────────────────────
 *  1) 본문을 받기 **전에** — getImprovementRequestAttachmentTarget 의 살아 있는 첨부
 *     수로. 이미 5장이면 20MB 를 받아 놓고 버리는 일을 아낀다. **빠른 거절일 뿐이다.**
 *  2) 행을 넣을 때 — createAttachmentRecord 가 **글 행을 잠근 같은 트랜잭션**에서 다시
 *     센다(mutations/attachments.ts). 동시에 올린 여러 장은 거기서 줄을 서고, 넘친
 *     것은 ImprovementRequestAttachmentRejectedError(LIMIT_REACHED)로 되돌아온다. 이미
 *     놓은 파일은 여기서 치운다.
 * 글 한 건에 대한 판정도 같은 두 자리에서 본다 — 파일을 받는 동안 관리자가 글을
 * 진행중으로 옮기면 2)가 막는다.
 *
 * ⚠️ 4번(파일 이동)과 5번(DB)을 뒤집지 않는다 — 제품 모델 통로와 같은 까닭이다.
 * ============================================================================
 */

// 파일을 다루므로 Node 런타임이 필요하다(node:fs, node:crypto).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type FailureCode =
  | "UNTRUSTED_ORIGIN"
  | "DATABASE_MODE_REQUIRED"
  | "UNAUTHENTICATED"
  | "ACCOUNT_NOT_APPROVED"
  | "FORBIDDEN"
  | "IMPROVEMENT_REQUEST_NOT_FOUND"
  | "LIMIT_REACHED"
  | "INVALID_FILE_NAME"
  | "EXTENSION_NOT_ALLOWED"
  | "EXTENSION_NOT_ALLOWED_FOR_CATEGORY"
  | "EMPTY_BODY"
  | "FILE_TOO_LARGE"
  | "CONTENT_MISMATCH"
  | "STORAGE_FAILED"
  | "RECORD_FAILED";

function fail(status: number, code: FailureCode, message: string): NextResponse {
  // 무엇이 왜 막혔는지 사람이 읽을 수 있게 돌려준다. 저장 루트나 내부 경로는
  // 싣지 않는다 — 실패 응답이 디스크 구조를 알려 주는 창구가 되면 안 된다.
  return NextResponse.json({ error: message, code }, { status });
}

const MAX_ORIGINAL_FILE_NAME_LENGTH = 255;

const IMPROVEMENT_REQUEST_NOT_FOUND_MESSAGE = "해당 개선 요청을 찾을 수 없습니다.";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  // ── 1) 본문을 받기 전에 끝내야 하는 확인들 ────────────────────────────
  if (!isTrustedOrigin(request)) {
    return fail(403, "UNTRUSTED_ORIGIN", "요청 출처를 확인할 수 없습니다.");
  }

  // 개선 요청은 데이터베이스 저장 모드에서만 있는 화면이다(page.tsx · 서버 액션).
  if (getAuthSource() !== "database") {
    return fail(403, "DATABASE_MODE_REQUIRED", "데이터베이스 저장 모드가 아닙니다.");
  }

  const session = await readSession();
  if (!session) {
    return fail(401, "UNAUTHENTICATED", "로그인이 필요합니다.");
  }

  // 세션에 박힌 값이 아니라 살아 있는 계정을 다시 읽는다 — 토큰이 발급된 뒤 계정이
  // 정지·삭제·강등됐을 수 있다.
  const actingUser = await resolveActingUserForSession(session);
  if (!actingUser) {
    return fail(401, "UNAUTHENTICATED", "사용자 정보를 확인할 수 없습니다.");
  }
  if (actingUser.approvalStatus !== "APPROVED") {
    return fail(403, "ACCOUNT_NOT_APPROVED", "승인 대기 중인 계정은 파일을 올릴 수 없습니다.");
  }

  // 넓은 문턱 — 글을 적을 수 있는 사람만. 글을 조회하기 전이다.
  if (!(await hasPermission(actingUser, "improvementRequests", "WRITE"))) {
    return fail(403, "FORBIDDEN", "개선 요청에 스크린샷을 붙일 권한이 없습니다.");
  }

  const { id: improvementRequestId } = await context.params;

  const target = await getImprovementRequestAttachmentTarget(improvementRequestId);
  if (!target) {
    return fail(404, "IMPROVEMENT_REQUEST_NOT_FOUND", IMPROVEMENT_REQUEST_NOT_FOUND_MESSAGE);
  }

  // 글 한 건에 대한 판정 — 막히면 403(파일 헤더의 '404 가 아니라 403').
  const canManage = await hasPermission(actingUser, "improvementRequests", "MANAGE");
  if (
    !canChangeImprovementRequestScreenshots({
      status: target.status,
      createdBy: target.createdBy,
      actorUserId: actingUser.id,
      canManage,
    })
  ) {
    return fail(403, "FORBIDDEN", IMPROVEMENT_REQUEST_SCREENSHOT_FORBIDDEN_MESSAGE);
  }

  // 5장 — 빠른 거절(파일 헤더의 '5장은 두 번 센다' 1).
  if (!hasImprovementRequestScreenshotRoom(target.liveAttachmentCount)) {
    return fail(409, "LIMIT_REACHED", IMPROVEMENT_REQUEST_SCREENSHOT_LIMIT_MESSAGE);
  }

  // ── 메타데이터(쿼리 문자열) 검증 — 아직 본문은 건드리지 않았다 ────────
  // 분류는 요청값으로 받지 않는다 — 개선 요청 글에는 스크린샷만 붙는다
  // (attachment-category.ts 의 isAttachmentCategoryAllowedForOwner).
  const category = IMPROVEMENT_REQUEST_ATTACHMENT_CATEGORY;
  const searchParams = request.nextUrl.searchParams;

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
      `스크린샷은 png · jpg · jpeg 만 올릴 수 있습니다(.${extension}).`
    );
  }

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
    console.error("개선 요청 스크린샷 임시 저장 실패", error);
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
  const storedPath = buildImprovementRequestAttachmentStoredPath({
    improvementRequestId: target.id,
    attachmentId,
    extension,
  });

  // ── 4) 파일을 최종 자리로 옮긴다 (DB보다 먼저 — 파일 상단 ⚠️ 참조) ────
  try {
    await storage.commit(written.tempPath, storedPath);
  } catch (error) {
    await storage.discard(written.tempPath);
    console.error("개선 요청 스크린샷 파일 이동 실패", error);
    return fail(500, "STORAGE_FAILED", "파일을 저장하는 중 문제가 발생했습니다.");
  }

  // ── 5) 그 다음에 DB (글 행 잠금 → 판정 · 5장 셈 → 행 + 감사 로그, 한 트랜잭션) ──
  let created;
  try {
    created = await createAttachmentRecord({
      id: attachmentId,
      owner: { kind: "IMPROVEMENT_REQUEST", improvementRequestId: target.id, canManage },
      category,
      originalFileName,
      storedPath,
      // 브라우저가 보낸 Content-Type이 아니라 확장자에서 서버가 고른 값이다.
      mimeType: canonicalMimeTypeForExtension(extension) ?? "application/octet-stream",
      fileSize: written.size,
      checksumSha256: written.sha256,
      description: null,
      uploadedBy: actingUser.id,
    });
  } catch (error) {
    // 기록을 만들지 못했으면 방금 놓은 파일은 주인이 없다. 치워 보되, 실패해도
    // 여기서 더 하지 않는다 — 주인 없는 파일은 나중에 훑어 치울 수 있다.
    await storage.delete(storedPath).catch(() => undefined);

    if (error instanceof ImprovementRequestAttachmentRejectedError) {
      // 잠근 트랜잭션의 판정이 막았다 — 파일을 받는 동안 상황이 바뀌었다(다른 장이
      // 먼저 들어왔거나, 글이 진행중으로 옮겨졌거나, 지워졌다).
      switch (error.code) {
        case "NOT_FOUND":
          return fail(404, "IMPROVEMENT_REQUEST_NOT_FOUND", error.message);
        case "FORBIDDEN":
          return fail(403, "FORBIDDEN", error.message);
        case "LIMIT_REACHED":
          return fail(409, "LIMIT_REACHED", error.message);
      }
    }
    console.error("개선 요청 스크린샷 기록 생성 실패", error);
    return fail(500, "RECORD_FAILED", "파일 기록을 저장하는 중 문제가 발생했습니다.");
  }

  return NextResponse.json(
    {
      id: created.id,
      improvementRequestId: target.id,
      category,
      originalFileName,
      fileSize: written.size,
      checksumSha256: written.sha256,
      uploadedAt: created.uploadedAt,
    },
    { status: 201 }
  );
}
