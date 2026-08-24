import { NextResponse, type NextRequest } from "next/server";

import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { hasPermission } from "@/lib/auth/permission-resolver";
import { readSession } from "@/lib/auth/session";
import { decideAttachmentDownload } from "@/lib/domain/attachment-download-policy";
import { AttachmentPathError, resolveAttachmentAbsolutePath } from "@/lib/domain/attachment-path";
import { getAttachmentForDownload } from "@/lib/db/queries/attachment-download";
import { recordAttachmentDownload } from "@/lib/db/mutations/attachment-trash";
import { getAttachmentStorage, resolveUploadsRoot } from "@/lib/storage/local-fs-adapter";

/**
 * ============================================================================
 * GET /api/attachments/{id}/download — 파일이 밖으로 나가는 단 하나의 통로
 * ============================================================================
 * 저장 폴더를 웹에 그대로 열지 않는다. 보안 정책(SECURITY_POLICY.md 10번)이
 * *"파일 접근은 반드시 애플리케이션을 통해서만"*으로 못박고 있고, 이유는
 * 폴더를 열면 **로그인·권한·감사 세 가지가 동시에 사라지기** 때문이다. 링크를
 * 아는 사람은 누구나 받아 가고, 누가 무엇을 받았는지 알 수 없게 된다.
 *
 * ── 순서 ────────────────────────────────────────────────────────────────
 *  1) 세션 → 2) 계정 승인 → 3) 첨부 행 → 4) 접수 건 기준 권한(READ)
 *  → 5) 허용 판정 → 6) 경로 검증 → 7) 스트리밍 → 8) 감사(FILE_DOWNLOAD)
 *
 * 4번이 5번보다 앞인 이유: 권한이 없는 사람에게는 "그 파일이 휴지통에 있다"
 * 같은 사실조차 알려 주지 않는다. 판정 결과 문장은 그 첨부의 상태를 설명하므로,
 * 볼 자격을 먼저 확인한 뒤에 꺼낸다.
 *
 * ── 판정을 여기서 하지 않는다 ────────────────────────────────────────────
 * 허용 여부는 attachment-download-policy.ts의 decideAttachmentDownload 하나가
 * 정한다. 라우트에 if를 흩어 놓으면 검사 엔진이 도입되는 날 고칠 자리가 코드
 * 전체를 훑어야 나오는 질문이 된다. 그 파일에 **NOT_SCANNED가 지금 왜 허용인지**
 * (검사기가 없어서 모든 첨부가 그 상태다)도 함께 적혀 있다.
 *
 * ── DB에 적힌 경로도 믿지 않는다 ─────────────────────────────────────────
 * stored_path를 그대로 이어 붙이지 않고 resolveAttachmentAbsolutePath로
 * 정규화한다. 그 함수가 `..`·역슬래시·절대경로·대문자를 모두 거부하고, 정규화
 * 결과가 저장 루트 밖이면 던진다. DB 값이 어떻게든 오염되는 날(옛 코드, 손으로
 * 넣은 SQL, 이관 실수) 그것이 곧 임의 파일 읽기가 되므로, 마지막 관문을 여기에
 * 둔다.
 *
 * ── 파일에 닿을 때는 StorageAdapter를 통한다 ─────────────────────────────
 * node:fs를 직접 부르지 않는다. NAS로 옮기는 날 갈아 끼울 자리를 한 곳에
 * 모아 두기 위한 것이다(HANDOFF의 NAS 이식 제약).
 * ============================================================================
 */

// 파일을 다루므로 Node 런타임이 필요하다.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type FailureCode =
  | "UNAUTHENTICATED"
  | "ACCOUNT_NOT_APPROVED"
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "DETACHED"
  | "DELETED"
  | "SCAN_BLOCKED"
  | "STORAGE_FAILED";

function fail(status: number, code: FailureCode, message: string): NextResponse {
  // 실패 응답에 저장 루트나 상대 경로를 싣지 않는다 — 오류 메시지가 디스크
  // 구조를 알려 주는 창구가 되면 안 된다.
  return NextResponse.json({ error: message, code }, { status });
}

/**
 * 원본 파일명을 그대로 붙인다 — 디스크의 UUID 이름이 아니라.
 *
 * `filename*=UTF-8''`(RFC 5987)를 쓰는 이유는 한글이다. 옛 `filename=` 하나만
 * 보내면 브라우저가 바이트를 latin-1로 읽어 `ê°ë³´ê³ ì`류로 저장한다.
 * 호환을 위해 둘 다 보내되, 옛 형식에는 ASCII 로 접을 수 없는 글자를 `_`로
 * 바꾼 값을 넣는다(그 값을 읽는 브라우저는 어차피 한글을 못 쓴다).
 */
function contentDispositionFor(originalFileName: string): string {
  const asciiFallback = originalFileName.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_");
  const encoded = encodeURIComponent(originalFileName);
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`;
}

export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  // ── 1) 로그인 ──────────────────────────────────────────────────────────
  const session = await readSession();
  if (!session) {
    return fail(401, "UNAUTHENTICATED", "로그인이 필요합니다.");
  }

  const actingUser = await resolveActingUserForSession(session);
  if (!actingUser) {
    return fail(401, "UNAUTHENTICATED", "사용자 정보를 확인할 수 없습니다.");
  }
  if (actingUser.approvalStatus !== "APPROVED") {
    return fail(403, "ACCOUNT_NOT_APPROVED", "승인 대기 중인 계정은 파일을 받을 수 없습니다.");
  }

  // ── 2) 첨부 행 ─────────────────────────────────────────────────────────
  const { id: attachmentId } = await context.params;
  const attachment = await getAttachmentForDownload(attachmentId);
  if (!attachment) {
    return fail(404, "NOT_FOUND", "파일을 찾을 수 없습니다.");
  }

  // ── 3) 권한 — 판정 결과를 꺼내기 전에 확인한다 ─────────────────────────
  if (!(await hasPermission(actingUser.role, "repairCases.files", "READ"))) {
    return fail(403, "FORBIDDEN", "이 파일을 열람할 권한이 없습니다.");
  }

  // ── 4) 허용 판정 ───────────────────────────────────────────────────────
  const decision = decideAttachmentDownload({
    repairCaseId: attachment.repairCaseId,
    isDeleted: attachment.isDeleted,
    malwareScanStatus: attachment.malwareScanStatus,
  });
  if (!decision.allowed) {
    // 판정이 준 문장을 그대로 쓴다. "안 됩니다"만 보여 주면 사용자는 고장으로
    // 여기고, 검사 중이라 잠시 뒤면 되는 경우와 영영 안 되는 경우를 구분하지
    // 못한다. 상태 코드는 사유별로 나눈다 — 휴지통은 사용자가 되돌릴 수 있는
    // 상태(409)이고, 연결이 끊긴 것과 검사 차단은 그렇지 않다(403).
    const status = decision.reason === "DELETED" ? 409 : 403;
    return fail(status, decision.reason, decision.message);
  }

  // ── 5) 경로 검증 — DB 값이라도 그대로 믿지 않는다 ──────────────────────
  const storage = getAttachmentStorage();
  let stream: ReadableStream<Uint8Array>;
  try {
    // 루트 밖을 가리키면 여기서 던진다. 존재 여부는 read가 알려 준다.
    resolveAttachmentAbsolutePath(resolveUploadsRoot(), attachment.storedPath);
    stream = await storage.read(attachment.storedPath);
  } catch (error) {
    if (error instanceof AttachmentPathError) {
      // DB의 경로가 저장 루트를 벗어난다 — 정상 경로로는 생길 수 없는 값이다.
      // 사용자에게 경로를 보여 주지 않고, 서버 로그에만 남긴다.
      console.error("[attachment-download] stored_path가 저장 루트를 벗어난다", {
        attachmentId: attachment.id,
        reason: error.message,
      });
      return fail(500, "STORAGE_FAILED", "파일 경로를 확인할 수 없습니다. 관리자에게 문의해 주세요.");
    }
    // 기록은 있는데 디스크에 파일이 없는 경우가 여기로 온다. 업로드는 파일을
    // 먼저 놓고 행을 나중에 만들기 때문에 정상 경로로는 생기지 않지만,
    // 사람이 디스크를 직접 건드리면 생길 수 있다.
    console.error("[attachment-download] 저장된 파일을 읽지 못했다", {
      attachmentId: attachment.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return fail(404, "NOT_FOUND", "저장된 파일을 찾을 수 없습니다. 관리자에게 문의해 주세요.");
  }

  // ── 6) 감사 기록 — 스트림을 돌려주기 전에 남긴다 ───────────────────────
  // 응답을 먼저 반환하면 스트림이 끝나는 시점을 이 함수가 알 수 없어 기록이
  // 누락될 수 있다. 누가 무엇을 받아 갔는지는 파일 자체보다 오래 남아야 한다
  // (감사 로그 3년 보관).
  await recordAttachmentDownload({
    attachmentId: attachment.id,
    actorUserId: actingUser.id,
    repairCaseId: attachment.repairCaseId,
    originalFileName: attachment.originalFileName,
    fileSize: attachment.fileSize,
  });

  // ── 7) 전송 ────────────────────────────────────────────────────────────
  return new NextResponse(stream, {
    status: 200,
    headers: {
      "Content-Type": attachment.mimeType,
      "Content-Length": String(attachment.fileSize),
      "Content-Disposition": contentDispositionFor(attachment.originalFileName),
      // 브라우저가 내용을 보고 형식을 다시 추측하지 않게 한다. 추측을 허용하면
      // mime_type 검증을 통과한 파일이 다른 형식으로 실행될 수 있다.
      "X-Content-Type-Options": "nosniff",
      // 첨부는 사내 자료다. 중간 캐시나 브라우저 디스크에 남기지 않는다.
      "Cache-Control": "private, no-store",
    },
  });
}
