import { NextResponse, type NextRequest } from "next/server";

import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { hasPermission } from "@/lib/auth/permission-resolver";
import { isTrustedOrigin } from "@/lib/auth/request-guards";
import { readSession } from "@/lib/auth/session";
import {
  MAX_ATTACHMENT_PREVIEW_BYTES,
  MAX_ATTACHMENT_SIZE_BYTES,
} from "@/lib/domain/attachment-allowlist";
import type { AttachmentOwnerKind } from "@/lib/domain/attachment-category";
import {
  attachmentOwnerKindOf,
  decideAttachmentDownload,
  hasAnyAttachmentOwnerAccess,
  isAttachmentOwnerAccessAllowed,
  resolveAttachmentOwnerAccess,
} from "@/lib/domain/attachment-download-policy";
import {
  buildAttachmentPreviewPath,
  buildProductModelAttachmentPreviewPath,
  buildQuoteAttachmentPreviewPath,
} from "@/lib/domain/attachment-path";
import { recordAttachmentRotation } from "@/lib/db/mutations/attachment-rotation";
import { getAttachmentForRotation } from "@/lib/db/queries/attachment-rotation";
import { swapStoredFiles } from "@/lib/storage/attachment-file-swap";
import { getAttachmentStorage } from "@/lib/storage/local-fs-adapter";
import { splitStreamAt } from "@/lib/storage/split-stream";
import { AttachmentTooLargeError, type TempWriteResult } from "@/lib/storage/storage-adapter";
import { checkRotationPayload, checkRotationTarget, parseRotationRequest } from "./rotation-payload";

/**
 * ============================================================================
 * PUT /api/attachments/{id}/rotation — 화면에서 돌린 사진을 **원본에** 저장한다
 * ============================================================================
 * 🔴 **이 통로는 원본 파일을 덮어쓴다. 되돌릴 수 없다**(사용자 결정 2026-09-29).
 * 그래서 이 파일에서 제일 중요한 것은 기능이 아니라 **순서**다.
 *
 * ── 서버는 픽셀을 한 개도 다루지 않는다 ──────────────────────────────────
 * 미리보기 통로(PUT …/preview)와 같은 판단이다. 서버에서 이미지를 돌리려면
 * 네이티브 라이브러리(sharp 등)가 필요한데, NAS(Linux 컨테이너)로 옮기는 것이
 * 정해져 있어 그 짐을 지지 않기로 했다. **돌리는 일은 브라우저의 캔버스가**
 * 하고, 서버는 받은 바이트를 검사해서 놓기만 한다.
 *
 * ── 🔴 원본과 썸네일이 **함께** 온다 ─────────────────────────────────────
 * 원본만 돌리고 썸네일을 그대로 두면 목록은 옛 방향으로 남고, 사용자는 「저장이
 * 안 됐다」고 여긴다. 그래서 둘을 **한 요청**에 싣는다:
 *
 *     PUT …/rotation?previewBytes=41234&rotate=90&flipX=0&flipY=0
 *     본문 = [썸네일 JPEG 41234바이트][돌린 원본 …]
 *
 * multipart 를 쓰지 않는 까닭(파일 전체가 메모리에 올라온다)과 가르는 방법은
 * storage/split-stream.ts 머리말에 있다. 「둘 다 아니면 둘 다」를 지키는 것은
 * storage/attachment-file-swap.ts 이고, 그 함수가 옛 파일을 **지우지 않고 치워
 * 두었다가** 실패하면 되돌린다.
 *
 * ── 미리보기가 없던 옛 사진 ──────────────────────────────────────────────
 * 그때는 **만들어 붙인다.** 경로는 미리보기 통로와 똑같이 계산하고(주인별 세
 * 함수), 저장 뒤 preview_path 가 채워진다. 「썸네일이 없으니 원본만 바꾼다」로
 * 두면 목록이 원본을 그대로 받아 오던 그 사진들만 저장 뒤에도 느린 채 남는다 —
 * 돌려 저장하는 김에 그 빚도 갚는다.
 *
 * ── 차례 ────────────────────────────────────────────────────────────────
 *  1) 출처 · 세션 · 계정 승인
 *  2) **넓은 문턱** — 어느 주인의 파일도 못 다루는 사람은 조회 전에 403
 *  3) 첨부 행  → 4) 주인별 권한(404 로 감춘다)  → 5) 내보내도 되는 상태인가
 *  6) 잠긴 접수 건인가  → 7) 돌릴 수 있는 형식인가  → 8) 인자
 *  **여기까지 한 바이트도 받지 않는다.**
 *  9) 두 덩어리를 임시 자리로  → 10) 앞머리 대조  → 11) 갈아 끼우기 + 기록
 *
 * ── 권한은 「지금 이 첨부를 지울 수 있는 사람」과 **같은 기준**이다 ───────
 * 새 권한을 만들지 않는다(사용자 결정 2026-09-29). 판정 파일의 표
 * (ATTACHMENT_OWNER_PERMISSIONS.CHANGE) 한 곳이 정하는 그 값을 그대로 부른다 —
 * 지우기 서버 액션 · 미리보기 붙이기와 같은 세 함수다. 베껴 적지 않는다.
 * ============================================================================
 */

// 파일을 다루므로 Node 런타임이 필요하다.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 실패 코드는 네 곳에서 온다 — 이 파일(UNTRUSTED_ORIGIN · UNAUTHENTICATED ·
 * ACCOUNT_NOT_APPROVED · FORBIDDEN · NOT_FOUND · CASE_LOCKED · EMPTY_BODY ·
 * FILE_TOO_LARGE · PREVIEW_TOO_LARGE · STORAGE_FAILED), 내려받기 판정(DETACHED ·
 * QUOTE_IN_TRASH · DELETED · SCAN_BLOCKED), 인자·앞머리 판정(rotation-payload.ts),
 * 그리고 기록(mutations/attachment-rotation.ts 의 CHANGED 등). 한 벌로 세지
 * 않는 까닭은 그 목록들이 저마다 자기 파일에서 정본이기 때문이다.
 */
function fail(status: number, code: string, message: string): NextResponse {
  // 실패 응답에 저장 루트나 상대 경로를 싣지 않는다.
  return NextResponse.json({ error: message, code }, { status });
}

export async function PUT(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  // ── 1) 출처 · 세션 · 승인 ──────────────────────────────────────────────
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

  // ── 2) 넓은 문턱 — 조회보다 앞이다 ─────────────────────────────────────
  //
  // 🔴 「이 파일을 고칠 수 있는 사람」의 기준을 여기서 새로 적지 않는다. 지우기
  // (server/actions/attachments.ts) · 미리보기 붙이기와 **같은 세 함수**를 부르고,
  // 무엇을 묻는지는 판정 파일의 표(ATTACHMENT_OWNER_PERMISSIONS.CHANGE)가 정한다 —
  // 접수 건 repairCases.files WRITE · 모델 productModels.files WRITE · 견적서 quotes WRITE.
  const access = await resolveAttachmentOwnerAccess("CHANGE", (areaKey, level) =>
    hasPermission(actingUser, areaKey, level)
  );
  if (!hasAnyAttachmentOwnerAccess(access)) {
    return fail(403, "FORBIDDEN", "이 파일을 다룰 권한이 없습니다.");
  }

  // ── 3) 첨부 행 ─────────────────────────────────────────────────────────
  const { id: attachmentId } = await context.params;
  const attachment = await getAttachmentForRotation(attachmentId);
  if (!attachment) return fail(404, "NOT_FOUND", "파일을 찾을 수 없습니다.");

  // ── 4) 주인별 권한 — 막힐 때는 「없음」과 같은 응답이다 ─────────────────
  if (!isAttachmentOwnerAccessAllowed(attachment, access)) {
    return fail(404, "NOT_FOUND", "파일을 찾을 수 없습니다.");
  }

  // ── 5) 내보내도 되는 상태인가 ──────────────────────────────────────────
  //
  // 내려받기와 **같은 판정 하나**를 쓴다. 주인 없는 파일 · 휴지통 · 검사에 걸린
  // 파일은 애초에 화면에 뜨지도 내려오지도 않으므로, 그것을 돌려 저장하겠다는
  // 요청은 통로를 직접 두드린 것이다. 감염이 확인된 파일을 다시 써 넣는 일도
  // 여기서 함께 막힌다.
  const decision = decideAttachmentDownload({
    repairCaseId: attachment.repairCaseId,
    productModelId: attachment.productModelId,
    quoteId: attachment.quoteId,
    isDeleted: attachment.isDeleted,
    quoteInTrash: attachment.quoteInTrash,
    malwareScanStatus: attachment.malwareScanStatus,
  });
  if (!decision.allowed) {
    const status = decision.reason === "DELETED" || decision.reason === "QUOTE_IN_TRASH" ? 409 : 403;
    return fail(status, decision.reason, decision.message);
  }

  // ── 6) 잠긴 접수 건 — 올리기 · 지우기와 같은 문 ────────────────────────
  //
  // mutation 도 같은 것을 보지만(트랜잭션 안에서 다시), 여기서 먼저 막는 까닭은
  // 20MB 를 받아 놓고 되돌리지 않기 위해서다.
  if (attachment.caseLocked) {
    return fail(409, "CASE_LOCKED", "출하 완료로 잠긴 접수 건의 파일은 바꿀 수 없습니다.");
  }

  // ── 7) 돌릴 수 있는 형식인가 ───────────────────────────────────────────
  const target = checkRotationTarget(attachment);
  if (!target.ok) {
    return fail(target.rejection.status, target.rejection.code, target.rejection.message);
  }

  // ── 8) 인자 — 방향과 두 덩어리의 경계 ──────────────────────────────────
  const parsed = parseRotationRequest(request.nextUrl.searchParams);
  if (!parsed.ok) {
    return fail(parsed.rejection.status, parsed.rejection.code, parsed.rejection.message);
  }
  const { orientation, previewBytes } = parsed.request;

  // 미리보기를 둘 자리는 **주인의 ID** 로 정해진다(붙이기 통로와 같은 세 함수).
  // 주인이 아무도 없는 첨부는 5) 의 DETACHED 에서 이미 막혔으므로 여기까지 오지
  // 않지만, 갈래를 다 적어 두지 않으면 주인이 하나 더 느는 날 조용히 빠진다.
  const ownerKind = attachmentOwnerKindOf(attachment);
  const previewOwner: { kind: AttachmentOwnerKind; id: string } | null =
    ownerKind === "PRODUCT_MODEL" && attachment.productModelId
      ? { kind: ownerKind, id: attachment.productModelId }
      : ownerKind === "QUOTE" && attachment.quoteId
        ? { kind: ownerKind, id: attachment.quoteId }
        : ownerKind === "REPAIR_CASE" && attachment.repairCaseId
          ? { kind: ownerKind, id: attachment.repairCaseId }
          : null;
  if (!previewOwner) {
    return fail(404, "NOT_FOUND", "접수 건과 연결이 끊긴 파일입니다.");
  }
  // 이미 있던 미리보기는 **그 자리를 그대로** 쓴다 — 계산한 자리와 다른 값이
  // 행에 적혀 있으면(옛 코드·손으로 넣은 SQL) 새 파일만 놓이고 옛것이 남는다.
  const previewPath = attachment.previewPath ?? canonicalPreviewPath(previewOwner, attachment.id);

  // 브라우저가 알려 준 크기로 미리 자른다. 믿을 수 없는 값이지만(진짜 판정은
  // 아래에서 센 바이트로 한다) 맞을 때는 받아 놓고 버리는 일을 통째로 아낀다.
  const declaredLength = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(declaredLength) && declaredLength > previewBytes + MAX_ATTACHMENT_SIZE_BYTES) {
    return fail(413, "FILE_TOO_LARGE", "파일이 20MB를 넘습니다.");
  }

  const body = request.body;
  if (!body) return fail(400, "EMPTY_BODY", "저장할 내용이 비어 있습니다.");

  // ── 9) 두 덩어리를 임시 자리로 ─────────────────────────────────────────
  //
  // 🔴 앞(썸네일)을 **다 읽은 뒤에** 뒤(원본)를 읽는다. 둘은 같은 reader 를
  //    나눠 쓰므로 차례가 바뀌면 바이트가 섞인다(split-stream.ts 머리말).
  const storage = getAttachmentStorage();
  const { head, tail } = splitStreamAt(body, previewBytes);

  let writtenPreview: TempWriteResult;
  try {
    writtenPreview = await storage.writeTemp(head, { maxBytes: MAX_ATTACHMENT_PREVIEW_BYTES });
  } catch (error) {
    // 본문은 splitStreamAt 이 이미 잠갔으므로(getReader) `body.cancel()` 은 던진다.
    // 아직 아무도 읽지 않은 tail 을 물리면 그 안에서 원래 본문이 함께 끊긴다.
    await tail.cancel().catch(() => undefined);
    if (error instanceof AttachmentTooLargeError) {
      return fail(413, "PREVIEW_TOO_LARGE", "미리보기가 너무 큽니다.");
    }
    console.error("[attachment-rotation] 미리보기 임시 저장 실패", error);
    return fail(500, "STORAGE_FAILED", "파일을 저장하는 중 문제가 발생했습니다.");
  }

  let writtenOriginal: TempWriteResult;
  try {
    writtenOriginal = await storage.writeTemp(tail, { maxBytes: MAX_ATTACHMENT_SIZE_BYTES });
  } catch (error) {
    await storage.discard(writtenPreview.tempPath);
    if (error instanceof AttachmentTooLargeError) {
      return fail(413, "FILE_TOO_LARGE", "파일이 20MB를 넘습니다.");
    }
    console.error("[attachment-rotation] 원본 임시 저장 실패", error);
    return fail(500, "STORAGE_FAILED", "파일을 저장하는 중 문제가 발생했습니다.");
  }

  // ── 10) 앞머리 대조 — 확장자가 아니라 내용으로 ─────────────────────────
  const rejection = checkRotationPayload({
    extension: target.extension,
    declaredPreviewBytes: previewBytes,
    preview: { size: writtenPreview.size, header: writtenPreview.header },
    original: { size: writtenOriginal.size, header: writtenOriginal.header },
  });
  if (rejection) {
    await storage.discard(writtenPreview.tempPath);
    await storage.discard(writtenOriginal.tempPath);
    return fail(rejection.status, rejection.code, rejection.message);
  }

  // ── 11) 갈아 끼우기 + 기록 — 둘 다 아니면 둘 다 ────────────────────────
  //
  // 옛 파일 둘을 치우고, 새 파일 둘을 놓고, DB 에 적는다. 어디서 실패하든
  // 치워 둔 옛 파일이 제자리로 돌아간다(attachment-file-swap.ts).
  const swapped = await swapStoredFiles(storage, {
    entries: [
      { relPath: attachment.storedPath, tempPath: writtenOriginal.tempPath },
      { relPath: previewPath, tempPath: writtenPreview.tempPath },
    ],
    record: async () => {
      const result = await recordAttachmentRotation({
        attachmentId: attachment.id,
        actorUserId: actingUser.id,
        orientation,
        previous: {
          fileSize: attachment.fileSize,
          checksumSha256: attachment.checksumSha256,
          previewPath: attachment.previewPath,
        },
        next: {
          fileSize: writtenOriginal.size,
          checksumSha256: writtenOriginal.sha256,
          previewPath,
        },
      });
      return result.ok
        ? { ok: true, value: result.id }
        : { ok: false, code: result.code, message: result.message };
    },
  });

  if (!swapped.ok) {
    if (swapped.failure.rollbackFailed) {
      // 🔴 디스크가 어중간하게 남았다. 조용히 넘어가면 어느 파일이 어긋났는지
      //    나중에 알 길이 없다 — 서버 로그에는 반드시 남긴다(사용자에게는
      //    저장 루트를 보여 주지 않는다).
      console.error("[attachment-rotation] 되돌리기까지 실패했다", {
        attachmentId: attachment.id,
        code: swapped.failure.code,
      });
    }
    const status =
      swapped.failure.code === "CHANGED"
        ? 409
        : swapped.failure.code === "CASE_LOCKED" || swapped.failure.code === "QUOTE_IN_TRASH"
          ? 409
          : swapped.failure.code === "NOT_FOUND" || swapped.failure.code === "DELETED"
            ? 404
            : 500;
    return fail(status, swapped.failure.code, swapped.failure.message);
  }

  return NextResponse.json(
    {
      ok: true,
      id: attachment.id,
      fileSize: writtenOriginal.size,
      checksumSha256: writtenOriginal.sha256,
    },
    { status: 200 }
  );
}

/** 미리보기를 둘 자리 — 붙이기 통로(PUT …/preview)와 **같은 세 함수**다. */
function canonicalPreviewPath(
  owner: { kind: AttachmentOwnerKind; id: string },
  attachmentId: string
): string {
  if (owner.kind === "PRODUCT_MODEL") {
    return buildProductModelAttachmentPreviewPath({ productModelId: owner.id, attachmentId });
  }
  if (owner.kind === "QUOTE") {
    return buildQuoteAttachmentPreviewPath({ quoteId: owner.id, attachmentId });
  }
  return buildAttachmentPreviewPath({ repairCaseId: owner.id, attachmentId });
}
