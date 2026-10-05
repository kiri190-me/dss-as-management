import { NextResponse, type NextRequest } from "next/server";

import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { hasPermission } from "@/lib/auth/permission-resolver";
import { isTrustedOrigin } from "@/lib/auth/request-guards";
import { readSession } from "@/lib/auth/session";
import { MAX_ATTACHMENT_SIZE_BYTES, isContentCompatibleWithExtension } from "@/lib/domain/attachment-allowlist";
import {
  decideAttachmentDownload,
  hasAnyAttachmentOwnerAccess,
  isAttachmentOwnerAccessAllowed,
  resolveAttachmentOwnerAccess,
} from "@/lib/domain/attachment-download-policy";
import { isShrinkLabel, shrunkFileName } from "@/lib/domain/image-shrink";
import { getAttachmentForDownload } from "@/lib/db/queries/attachment-download";
import { getRepairCaseContactFolderKeyById } from "@/lib/db/queries/repair-cases";
import { recordContactFolderFileSaved } from "@/lib/db/mutations/contact-folders";
import {
  copyIntoContactFolderDataFolder,
  resolveContactFolderArchiveRoot,
} from "@/lib/storage/contact-folder-archive";
import { getAttachmentStorage } from "@/lib/storage/local-fs-adapter";

/**
 * ============================================================================
 * POST /api/attachments/{id}/contact-folder — **[DATA에 저장]** (연락서 조각 12)
 * ============================================================================
 * 저장된 파일을 그 건의 연락서 공유폴더 **`DATA` 폴더**에 꽂는다.
 *
 * ── 🔴 왜 내려받기가 아닌가 ─────────────────────────────────────────────
 * 사용자는 「내려받을 때 기본으로 `DATA` 에 저장되게」를 바랐지만 **웹페이지는 브라우저의
 * 저장 위치를 지정할 수 없다**(보안). 그래서 **서버가 직접 꽂는** 방식으로 바꿔
 * 승인받았다(2026-10-05). 「받아서 탐색기로 옮기기」 두 걸음이 한 번 누르기가 된다.
 *
 * ── 🔴 묶지 않는다 ──────────────────────────────────────────────────────
 * 여러 개를 내려받을 때 ZIP 으로 묶는 것은 기능이 아니라 **브라우저가 연속 내려받기를
 * 막기 때문**이다(components/…/zip-store.ts 머리말). 이 길은 내려받기가 아니라 서버가
 * 꽂는 것이라 그 제약이 없다 — 🔴 **한 번 부를 때 첨부 하나**이고, 화면이 **한 건씩
 * 차례로** 부른다(올리기 통로와 같은 규율). 공유폴더에 ZIP 을 두면 탐색기에서 또 풀어야
 * 하고 [열기]로 바로 못 연다.
 *
 * ── 🔴 문턱은 **내려받기와 같다** ───────────────────────────────────────
 * 이 통로로 나가는 것은 「그 파일을 받을 수 있는 사람이 받을 수 있는 바이트」뿐이다.
 * 그래서 묻는 것도 내려받기와 똑같이 두 겹이다(domain/attachment-download-policy.ts):
 *   1) **권한이 조회보다 앞** — 셋 중 어느 파일도 못 보는 사람은 조회 전에 403
 *   2) 주인별 권한이 없으면 **「없음」과 같은 404**(403 으로 갈라 답하면 그 ID 가
 *      실재한다는 사실이 샌다 — HANDOFF W-1-3)
 *   3) 🔴 **휴지통 · 검사 차단은 내려받기와 같은 판정 함수가 가린다**
 *      (decideAttachmentDownload) — 휴지통 첨부는 여기서도 나가지 않는다.
 *
 * ── 🔴 `DATA` 는 만들고, 연락서 폴더는 만들지 않는다 ────────────────────
 * 까닭은 storage/contact-folder-archive.ts 의 copyIntoContactFolderDataFolder 머리말에
 * 있다(요약: `DATA` 는 우리가 이름까지 정해 둔 자리이고 조각 11 전 폴더에는 없다.
 * 연락서 폴더는 사람이 [폴더 만들고 열기]로 만든다 — 없으면 `no-folder`).
 *
 * ── 🔴 줄인 사진은 **브라우저가 만든 바이트**를 받는다 ──────────────────
 * 줄이기는 브라우저가 한다(원본이 안 상한다). `?shrunk=50pct` 가 붙으면 **본문이 그
 * 바이트 자체**다 — 올리기 통로와 같은 모양이고 multipart 를 쓰지 않는다. 다만:
 *  · 🔴 **파일 이름은 서버가 짓는다** — 줄기는 DB 의 원본 파일명, 꼬리는 줄여받기와
 *    **같은 함수**(domain/image-shrink.ts 의 shrunkFileName)다. 클라이언트가 이름을
 *    통째로 보내지 않는다.
 *  · 🔴 이름표는 모양을 좁혀 받는다(isShrinkLabel).
 *  · 🔴 **크기 상한**을 건다(첨부 상한과 같은 20MB). 줄인 사진이라 작겠지만 받는 쪽이
 *    열려 있으면 안 된다 — 상한을 넘으면 그 자리에서 끊는다.
 *  · 🔴 앞머리를 보고 **사진인지 확인한다**(JPEG · PNG). 줄이기는 JPEG 를 내놓지만,
 *    이미 목표보다 작은 사진은 **원본 그대로** 돌아오므로 PNG 일 수 있다(줄여받기도
 *    그때 이름만 `.jpg` 가 된다 — 같은 동작을 그대로 따른다).
 *
 * ── 🔴 원본을 바꾸지 않는다 · 지우지 않는다 ─────────────────────────────
 * 시스템 창고의 파일도, 공유폴더의 파일도 **지우거나 덮어쓰지 않는다.** 이 파일에
 * `unlink` · `rename` 따위가 한 글자도 없다는 사실을 route-source.test.ts 가 본다.
 * 같은 이름이 있으면 ` (2)` 로 비켜 가고, 내용이 같으면 아예 쓰지 않는다.
 *
 * ── 감사 ────────────────────────────────────────────────────────────────
 * 🔴 **남긴다.** 사내 폴더로 가는 것이라 「밖으로 나갔다」는 아니지만, 권한이 걸린
 * 창고의 파일이 **사람이 읽는 이름으로 공유폴더에 한 벌 더 생기는** 일이다. 무엇을 어떤
 * 코드로 남기는지는 db/mutations/contact-folders.ts 의 recordContactFolderFileSaved
 * 머리말에 있다(스키마 변경 0 — 기존 enum 값을 쓴다).
 * ============================================================================
 */

// 파일을 다루므로 Node 런타임이 필요하다.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type FailureCode =
  | "UNTRUSTED_ORIGIN"
  | "UNAUTHENTICATED"
  | "ACCOUNT_NOT_APPROVED"
  | "FORBIDDEN"
  | "SHARE_FOLDER_DISABLED"
  | "NOT_FOUND"
  | "DETACHED"
  | "QUOTE_IN_TRASH"
  | "DELETED"
  | "SCAN_BLOCKED"
  | "NOT_REPAIR_CASE_FILE"
  | "INVALID_SHRINK_LABEL"
  | "NOT_AN_IMAGE"
  | "EMPTY_BODY"
  | "TOO_LARGE"
  | "STORAGE_FAILED"
  | "AUDIT_FAILED";

function fail(status: number, code: FailureCode, message: string): NextResponse {
  // 🔴 실패 응답에 저장 루트 · 공유폴더 경로를 싣지 않는다 — 오류가 디스크 구조를
  //    알려 주는 창구가 되면 안 된다(내려받기 · 올리기 통로와 같은 규율).
  return NextResponse.json({ error: message, code }, { status });
}

/**
 * 공유폴더에 꽂은 결과 — 🔴 **응답에 절대 경로 · 루트 · 연락서 폴더 이름을 담는 칸이
 * 없다.** 나가는 것은 디스크에 실제로 쓴 **파일 이름**과 경로 없는 짧은 사유뿐이고,
 * 모양은 올리기 통로의 `contactFolderCopy` 와 **같다**(화면이 같은 읽개를 쓴다 —
 * components/repair-cases/files/contact-folder-copy-notice.ts).
 */
type ContactFolderCopyNote =
  | { status: "copied"; fileName: string; categoryFolderBlockedByFile: boolean }
  | { status: "unchanged"; fileName: string; categoryFolderBlockedByFile: boolean }
  /** 🔴 연락서 폴더가 아직 없다 — 만들지 않았다. */
  | { status: "no-folder" }
  /** 맞는 폴더가 여럿이라 어디에 넣을지 앱이 고르지 않았다. */
  | { status: "multiple" }
  | { status: "failed"; reason: string };

const CASE_GONE_REASON = "수리 건 정보를 읽지 못해 연락서 폴더를 찾을 수 없습니다.";
const READ_FAILED_REASON = "저장된 파일을 읽지 못해 공유폴더에 넣지 못했습니다.";

/**
 * 본문을 **상한까지만** 읽는다. 넘으면 그 자리에서 끊고 `null`.
 *
 * 🔴 `content-length` 만 믿지 않는다 — 그 값은 클라이언트가 적는 것이라 거짓일 수 있다.
 * 미리 자르는 것은 20MB 를 받아 놓고 버리는 일을 아끼기 위한 것이고(올리기 통로와 같은
 * 판단), **진짜 판정은 여기서 센 바이트**다.
 */
async function readBodyUpTo(
  body: ReadableStream<Uint8Array>,
  maxBytes: number
): Promise<Uint8Array | null> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) return null;
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const whole = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    whole.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return whole;
}

/** 줄인 사진으로 받은 바이트가 **사진인가** — 줄이기는 JPEG 를 내놓지만 PNG 가 그대로 올 수 있다. */
function looksLikeImage(header: Uint8Array): boolean {
  return isContentCompatibleWithExtension("jpg", header) || isContentCompatibleWithExtension("png", header);
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  if (!isTrustedOrigin(request)) {
    return fail(403, "UNTRUSTED_ORIGIN", "요청 출처를 확인할 수 없습니다.");
  }

  const session = await readSession();
  if (!session) return fail(401, "UNAUTHENTICATED", "로그인이 필요합니다.");

  const actingUser = await resolveActingUserForSession(session);
  if (!actingUser) return fail(401, "UNAUTHENTICATED", "사용자 정보를 확인할 수 없습니다.");
  if (actingUser.approvalStatus !== "APPROVED") {
    return fail(403, "ACCOUNT_NOT_APPROVED", "승인 대기 중인 계정은 파일을 다룰 수 없습니다.");
  }

  // ── 🔴 권한이 조회보다 앞이다 — 내려받기와 같은 문턱(VIEW 표) ──────────
  const access = await resolveAttachmentOwnerAccess("VIEW", (areaKey, level) =>
    hasPermission(actingUser, areaKey, level)
  );
  if (!hasAnyAttachmentOwnerAccess(access)) {
    return fail(403, "FORBIDDEN", "이 파일을 열람할 권한이 없습니다.");
  }

  // 🔴 기능이 꺼진 환경에서는 DB 도 디스크도 보지 않는다(화면도 단추를 그리지 않는다).
  if (resolveContactFolderArchiveRoot() === null) {
    return fail(409, "SHARE_FOLDER_DISABLED", "이 환경에는 공유폴더가 설정되어 있지 않습니다.");
  }

  const { id: attachmentId } = await context.params;
  const attachment = await getAttachmentForDownload(attachmentId);
  if (!attachment) return fail(404, "NOT_FOUND", "파일을 찾을 수 없습니다.");

  // 🔴 403 이 아니라 404 다 — 문턱을 넘은 사람에게 갈라 답하면 그 ID 가 실재한다는
  //    사실이 새어 나간다(내려받기 통로와 같은 자리).
  if (!isAttachmentOwnerAccessAllowed(attachment, access)) {
    return fail(404, "NOT_FOUND", "파일을 찾을 수 없습니다.");
  }

  // ── 🔴 휴지통 · 검사 차단 — 내려받기와 **같은 판정 함수** ───────────────
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

  // 연락서 폴더는 **수리 건에만** 있다. 모델 회로도 · 견적서 문서에는 꽂을 자리가 없다.
  const repairCaseId = attachment.repairCaseId;
  if (repairCaseId === null) {
    return fail(400, "NOT_REPAIR_CASE_FILE", "접수 건에 딸린 파일만 공유폴더에 넣을 수 있습니다.");
  }

  // 찾는 열쇠는 인수번호 하나뿐이다(domain/contact-folder-naming.ts 머리말).
  const key = await getRepairCaseContactFolderKeyById(repairCaseId);
  if (!key) return fail(404, "NOT_FOUND", CASE_GONE_REASON);

  // ── 무엇을 꽂는가 — 저장된 원본이거나, 브라우저가 줄인 사진이다 ────────
  const shrunk = request.nextUrl.searchParams.get("shrunk");
  let bytes: Uint8Array;
  let fileName: string;

  if (shrunk === null) {
    // 저장된 원본 그대로. 상한은 올릴 때 이미 걸려 있다(MAX_ATTACHMENT_SIZE_BYTES).
    try {
      bytes = new Uint8Array(
        await new Response(await getAttachmentStorage().read(attachment.storedPath)).arrayBuffer()
      );
    } catch (error) {
      // 🔴 오류 message 를 싣지 않는다 — 전체 경로가 들어 있다.
      console.error("[contact-folder-save] 저장된 파일을 읽지 못했다", {
        attachmentId: attachment.id,
        name: error instanceof Error ? error.name : typeof error,
      });
      return fail(500, "STORAGE_FAILED", READ_FAILED_REASON);
    }
    fileName = attachment.originalFileName;
  } else {
    if (!isShrinkLabel(shrunk)) {
      return fail(400, "INVALID_SHRINK_LABEL", "줄임 표시가 올바르지 않습니다.");
    }
    if (attachment.mimeType !== "image/jpeg" && attachment.mimeType !== "image/png") {
      return fail(400, "NOT_AN_IMAGE", "사진이 아닌 파일은 줄여서 넣을 수 없습니다.");
    }

    const declaredLength = Number(request.headers.get("content-length") ?? "");
    if (Number.isFinite(declaredLength) && declaredLength > MAX_ATTACHMENT_SIZE_BYTES) {
      return fail(413, "TOO_LARGE", "줄인 사진이 20MB를 넘습니다.");
    }
    const body = request.body;
    if (!body) return fail(400, "EMPTY_BODY", "넣을 사진이 없습니다.");

    const received = await readBodyUpTo(body, MAX_ATTACHMENT_SIZE_BYTES);
    if (received === null) return fail(413, "TOO_LARGE", "줄인 사진이 20MB를 넘습니다.");
    if (received.byteLength === 0) return fail(400, "EMPTY_BODY", "넣을 사진이 없습니다.");
    if (!looksLikeImage(received)) {
      return fail(400, "NOT_AN_IMAGE", "사진이 아닌 내용은 넣을 수 없습니다.");
    }

    bytes = received;
    // 🔴 이름은 서버가 짓는다 — 줄기는 DB 의 원본 파일명, 꼬리는 줄여받기와 같은 함수다.
    fileName = shrunkFileName(attachment.originalFileName, shrunk);
  }

  // ── 꽂는다 — 🔴 덮어쓰지 않는다 · 내용이 같으면 안 쓴다 · NFC/NFD ──────
  const result = await copyIntoContactFolderDataFolder({
    intakeNumber: key.intakeNumber,
    originalFileName: fileName,
    bytes,
  });

  if (result.status === "copied") {
    // 🔴 **이번에 새로 꽂았을 때만** 기록한다. 실패하면 사실대로 알린다 — 다시 눌러도
    //    같은 바이트라 `unchanged` 로 끝나므로 파일이 겹쳐 생기지 않는다.
    try {
      await recordContactFolderFileSaved({
        actorUserId: actingUser.id,
        repairCaseId,
        attachmentId: attachment.id,
        fileName: result.fileName,
        fileSize: bytes.byteLength,
        ...(shrunk === null ? {} : { shrunkLabel: shrunk }),
      });
    } catch (error) {
      console.error("[contact-folder-save] 감사 기록을 남기지 못했다", {
        attachmentId: attachment.id,
        name: error instanceof Error ? error.name : typeof error,
      });
      return fail(500, "AUDIT_FAILED", "공유폴더에는 넣었지만 기록을 남기지 못했습니다. 관리자에게 알려 주세요.");
    }
  }

  return NextResponse.json({ contactFolderCopy: toNote(result) }, { status: 200 });
}

/** 저장 모듈의 결과를 **응답에 실어도 되는 모양**으로 줄인다(경로 · 폴더 이름을 뺀다). */
function toNote(result: Awaited<ReturnType<typeof copyIntoContactFolderDataFolder>>): ContactFolderCopyNote {
  if (result.status === "copied" || result.status === "unchanged") {
    return {
      status: result.status,
      fileName: result.fileName,
      // 🔴 `DATA` 자리를 같은 이름의 **파일**이 막아 폴더 바로 아래로 비켜 갔는가.
      categoryFolderBlockedByFile: result.categoryFolderBlockedByFile,
    };
  }
  if (result.status === "no-folder") return { status: "no-folder" };
  if (result.status === "multiple") return { status: "multiple" };
  if (result.status === "disabled") {
    // 위에서 루트를 먼저 보았으므로 닿지 않는다. 상태가 하나 늘면 컴파일러가 짚게 둔다.
    return { status: "failed", reason: "공유폴더가 설정되어 있지 않습니다." };
  }
  return { status: "failed", reason: result.reason };
}
