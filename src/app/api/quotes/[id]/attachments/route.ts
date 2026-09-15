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
import {
  attachmentCategoryLabels,
  isAttachmentCategory,
  isQuoteAttachmentSlotCategory,
  type QuoteAttachmentSlotCategory,
} from "@/lib/domain/attachment-category";
import { ATTACHMENT_OWNER_PERMISSIONS } from "@/lib/domain/attachment-download-policy";
import { buildQuoteAttachmentStoredPath } from "@/lib/domain/attachment-path";
import { QuoteAttachmentRejectedError, createAttachmentRecord } from "@/lib/db/mutations/attachments";
import { getQuoteAttachmentUploadTarget } from "@/lib/db/queries/attachments";
import { getAttachmentStorage } from "@/lib/storage/local-fs-adapter";
import { AttachmentTooLargeError } from "@/lib/storage/storage-adapter";

/**
 * ============================================================================
 * POST /api/quotes/{id}/attachments?fileName=&category= — 견적서에 결재 PDF · 수기 엑셀을 붙이는 통로
 * ============================================================================
 * 개선 요청 통로(api/improvement-requests/[id]/attachments/route.ts)와 **같은 순서 · 같은
 * 방어**다. 서버 액션이 아니라 Route Handler 인 까닭, multipart 를 쓰지 않는 까닭,
 * 단계의 순서는 접수 건 통로(api/repair-cases/[id]/attachments/route.ts) 헤더에 있다.
 * 여기서는 **다른 점만** 적는다. 🔴 통로들의 상한 · 검사 순서 · 실패 응답 규칙은 함께
 * 고친다 — 한쪽만 바꾸면 동작이 갈라진다.
 *
 * ── 개선 요청 통로와 다른 점 ─────────────────────────────────────────────
 *   권한      improvementRequests WRITE  →  **quotes WRITE**(판정 파일의 표
 *             + 글 한 건에 대한 판정          ATTACHMENT_OWNER_PERMISSIONS.CHANGE.QUOTE) —
 *                                           견적서 한 장에 대한 판정은 없다
 *   대상 조회  getImprovementRequest…     →  getQuoteAttachmentUploadTarget
 *   분류      언제나 SCREENSHOT          →  **요청값(category) — 두 칸만**
 *                                           SIGNED_QUOTE_PDF(pdf) · QUOTE_EXCEL(xlsx · xls)
 *   설명      받지 않는다                →  받지 않는다(칸 이름이 곧 설명이다)
 *   상한      한 글에 5장                →  **칸마다 한 파일 — 다시 올리면 바꾼다.** 옛 파일은
 *                                           첨부 휴지통으로(mutations/attachments.ts 의
 *                                           '넷째 주인'). 거절이 아니라 교체라 409 가 없다
 *   경로      improvement-requests/…     →  quotes/{견적서id}/{첨부id}.{확장자}
 *   실패 코드  IMPROVEMENT_REQUEST_…      →  QUOTE_NOT_FOUND(404) · QUOTE_IN_TRASH(409)
 *
 * ── 휴지통의 견적서에는 붙이지 못한다 — 두 번 본다 ───────────────────────
 *  1) 본문을 받기 **전에** — 대상 조회의 isDeleted 로. 빠른 거절일 뿐이다.
 *  2) 행을 넣을 때 — createAttachmentRecord 가 **견적서 행을 잠근 같은 트랜잭션**에서
 *     다시 본다. 20MB 를 받는 동안 누가 견적서를 휴지통에 넣었으면 거기서
 *     QuoteAttachmentRejectedError(QUOTE_IN_TRASH)로 되돌아오고, 이미 놓은 파일은 여기서
 *     치운다. 칸 교체도 그 잠금 안에서 한다 — 같은 칸에 동시에 올려도 살아 남는 파일은
 *     하나다.
 *
 * 휴지통의 견적서를 404 로 숨기지 않고 409 로 갈라 답하는 까닭: 이 통로를 부르는 사람은
 * 문턱(quotes WRITE ⊇ READ)을 넘어 그 견적서를 이미 보던 사람이다 — 숨길 존재가 없고,
 * 404 는 「견적서가 사라졌다」로 잘못 읽힌다(개선 요청 통로의 '404 가 아니라 403' 과 같은
 * 판단).
 *
 * ⚠️ 4번(파일 이동)과 5번(DB)을 뒤집지 않는다 — 다른 통로와 같은 까닭이다.
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
  | "QUOTE_NOT_FOUND"
  | "QUOTE_IN_TRASH"
  | "INVALID_CATEGORY"
  | "CATEGORY_NOT_ALLOWED_FOR_OWNER"
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

const QUOTE_NOT_FOUND_MESSAGE = "해당 견적서를 찾을 수 없습니다.";
const QUOTE_IN_TRASH_MESSAGE = "휴지통에 있는 견적서에는 파일을 붙일 수 없습니다. 견적서를 먼저 되살려 주세요.";

/** 칸마다 받는 형식을 사람이 읽는 말로 — 분류 허용목록(attachment-allowlist.ts)과 같은 내용이다. */
const SLOT_EXTENSION_HINTS: Record<QuoteAttachmentSlotCategory, string> = {
  SIGNED_QUOTE_PDF: "결재 견적서는 PDF 로만 올릴 수 있습니다",
  QUOTE_EXCEL: "수기 견적서는 엑셀(xlsx · xls)로만 올릴 수 있습니다",
};

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  // ── 1) 본문을 받기 전에 끝내야 하는 확인들 ────────────────────────────
  if (!isTrustedOrigin(request)) {
    return fail(403, "UNTRUSTED_ORIGIN", "요청 출처를 확인할 수 없습니다.");
  }

  // 견적서는 데이터베이스 저장 모드에서만 있는 화면이다(서버 액션 · 받기 통로와 같은 관문).
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

  // 권한 — 견적서를 고칠 수 있는 사람만(quotes WRITE). 견적서를 조회하기 전이다.
  // 무엇을 묻는지는 판정 파일의 표 한 곳이 정한다 — 지우기 · 되살리기 액션과 같은 칸이다.
  const permission = ATTACHMENT_OWNER_PERMISSIONS.CHANGE.QUOTE;
  if (!(await hasPermission(actingUser, permission.areaKey, permission.level))) {
    return fail(403, "FORBIDDEN", "견적서에 파일을 붙일 권한이 없습니다.");
  }

  const { id: quoteId } = await context.params;

  const target = await getQuoteAttachmentUploadTarget(quoteId);
  if (!target) {
    return fail(404, "QUOTE_NOT_FOUND", QUOTE_NOT_FOUND_MESSAGE);
  }
  // 휴지통의 견적서 — 빠른 거절(파일 헤더의 '두 번 본다' 1).
  if (target.isDeleted) {
    return fail(409, "QUOTE_IN_TRASH", QUOTE_IN_TRASH_MESSAGE);
  }

  // ── 메타데이터(쿼리 문자열) 검증 — 아직 본문은 건드리지 않았다 ────────
  const searchParams = request.nextUrl.searchParams;

  const rawCategory = (searchParams.get("category") ?? "").trim();
  if (!isAttachmentCategory(rawCategory)) {
    return fail(400, "INVALID_CATEGORY", "첨부 분류가 올바르지 않습니다.");
  }
  // 견적서에는 두 칸만 붙는다(attachment-category.ts 의 isAttachmentCategoryAllowedForOwner).
  if (!isQuoteAttachmentSlotCategory(rawCategory)) {
    return fail(
      400,
      "CATEGORY_NOT_ALLOWED_FOR_OWNER",
      `'${attachmentCategoryLabels[rawCategory]}' 분류는 견적서에 붙일 수 없습니다. 견적서에는 결재 견적서 PDF 와 수기 견적서 엑셀만 붙입니다.`
    );
  }
  const category: QuoteAttachmentSlotCategory = rawCategory;

  const originalFileName = (searchParams.get("fileName") ?? "").trim();
  if (originalFileName.length === 0 || originalFileName.length > MAX_ORIGINAL_FILE_NAME_LENGTH) {
    return fail(400, "INVALID_FILE_NAME", "파일 이름이 비어 있거나 너무 깁니다.");
  }

  const extension = normalizeFileExtension(originalFileName);
  if (!extension || !isAllowedExtension(extension)) {
    return fail(415, "EXTENSION_NOT_ALLOWED", "허용되지 않는 파일 형식입니다.");
  }
  if (!isExtensionAllowedForCategory(extension, category)) {
    return fail(415, "EXTENSION_NOT_ALLOWED_FOR_CATEGORY", `${SLOT_EXTENSION_HINTS[category]}(.${extension}).`);
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
    console.error("견적서 첨부 임시 저장 실패", error);
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
  const storedPath = buildQuoteAttachmentStoredPath({ quoteId: target.id, attachmentId, extension });

  // ── 4) 파일을 최종 자리로 옮긴다 (DB보다 먼저 — 파일 상단 ⚠️ 참조) ────
  try {
    await storage.commit(written.tempPath, storedPath);
  } catch (error) {
    await storage.discard(written.tempPath);
    console.error("견적서 첨부 파일 이동 실패", error);
    return fail(500, "STORAGE_FAILED", "파일을 저장하는 중 문제가 발생했습니다.");
  }

  // ── 5) 그 다음에 DB (견적서 행 잠금 → 판정 · 칸 교체 → 행 + 감사 로그, 한 트랜잭션) ──
  let created;
  try {
    created = await createAttachmentRecord({
      id: attachmentId,
      owner: { kind: "QUOTE", quoteId: target.id },
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

    if (error instanceof QuoteAttachmentRejectedError) {
      // 잠근 트랜잭션의 판정이 막았다 — 파일을 받는 동안 견적서가 휴지통으로 갔거나
      // 영구 삭제됐다.
      switch (error.code) {
        case "NOT_FOUND":
          return fail(404, "QUOTE_NOT_FOUND", error.message);
        case "QUOTE_IN_TRASH":
          return fail(409, "QUOTE_IN_TRASH", QUOTE_IN_TRASH_MESSAGE);
      }
    }
    console.error("견적서 첨부 기록 생성 실패", error);
    return fail(500, "RECORD_FAILED", "파일 기록을 저장하는 중 문제가 발생했습니다.");
  }

  return NextResponse.json(
    {
      id: created.id,
      quoteId: target.id,
      category,
      originalFileName,
      fileSize: written.size,
      checksumSha256: written.sha256,
      uploadedAt: created.uploadedAt,
      // 같은 칸의 옛 파일 — 첨부 휴지통으로 갔다(없으면 빈 배열). 화면이 「바꿨다」고 알릴 근거.
      displacedAttachmentIds: created.displacedAttachmentIds,
    },
    { status: 201 }
  );
}
