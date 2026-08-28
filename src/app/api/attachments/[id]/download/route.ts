import { NextResponse, type NextRequest } from "next/server";

import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { hasPermission } from "@/lib/auth/permission-resolver";
import { readSession } from "@/lib/auth/session";
import { decideAttachmentDownload } from "@/lib/domain/attachment-download-policy";
import { AttachmentPathError, resolveAttachmentAbsolutePath } from "@/lib/domain/attachment-path";
import { getAttachmentForDownload } from "@/lib/db/queries/attachment-download";
import { recordAttachmentDownload } from "@/lib/db/mutations/attachment-trash";
import { getAttachmentStorage, resolveUploadsRoot } from "@/lib/storage/local-fs-adapter";
import { shouldServeInline } from "./inline-view";

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
 *  1) 세션 → 2) 계정 승인 → 3) **넓은 권한 문턱** → 4) 첨부 행
 *  → 5) 주인별 권한(READ) → 6) 허용 판정 → 7) 경로 검증 → 8) 스트리밍
 *  → 9) 감사(FILE_DOWNLOAD)
 *
 * 5번이 6번보다 앞인 이유: 권한이 없는 사람에게는 "그 파일이 휴지통에 있다"
 * 같은 사실조차 알려 주지 않는다. 판정 결과 문장은 그 첨부의 상태를 설명하므로,
 * 볼 자격을 먼저 확인한 뒤에 꺼낸다.
 *
 * ── 권한이 주인에 따라 갈린다 — 그래서 조회가 앞으로 왔다 ────────────────
 * 첨부의 주인은 접수 건 아니면 제품 모델이다(schema/attachments.ts).
 *
 *   접수 건 첨부  →  repairCases.files READ    (예전 그대로)
 *   모델 첨부     →  **productModels.view READ**
 *
 * 모델 파일을 보는 데 productModels.files가 아니라 **view**를 쓰는 까닭:
 * 회로도를 **보는 것**은 모델 상세를 보는 일의 일부다. 영업도 모델을 볼 수
 * 있고, 볼 수 있으면 그 모델의 자료도 볼 수 있어야 한다 — 도면만 따로 잠그면
 * 화면에 목록은 뜨는데 아무것도 열리지 않는 상태가 된다. 좁히는 것은 **올리고
 * 지우는 쪽**뿐이고 그것은 productModels.files가 맡는다.
 *
 * 물을 권한이 주인에 따라 정해지므로 **조회가 권한보다 앞에 와야 한다.** 예전
 * 순서(권한 → 조회)에서는 권한 없는 사람이 "그 ID의 첨부가 있는지"조차 알 수
 * 없었고, 그 성질을 잃지 않으려고 두 겹으로 나눴다.
 *
 *   3번(넓은 문턱)  둘 중 **어느 파일도** 볼 수 없는 사람은 조회 전에 403이다.
 *                   예전에 repairCases.files 하나로 막던 자리와 같은 자리다.
 *   5번(주인별)     문턱은 넘었지만 이 주인의 파일은 못 보는 사람에게는
 *                   **"없음"과 똑같은 응답**(404 NOT_FOUND)을 준다. 403으로
 *                   갈라 답하면 "그 ID는 실재하는 모델 첨부"라는 사실이 새고,
 *                   그건 조회를 앞으로 옮기면서 생긴 새 구멍이 된다.
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
function contentDispositionFor(originalFileName: string, inline: boolean): string {
  const asciiFallback = originalFileName.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_");
  const encoded = encodeURIComponent(originalFileName);
  const kind = inline ? "inline" : "attachment";
  return `${kind}; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`;
}

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
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

  // ── 2) 넓은 권한 문턱 — 조회보다 앞이다 ────────────────────────────────
  //
  // 두 권한을 여기서 한 번에 읽어 둔다. 어느 쪽도 없는 사람은 어떤 첨부도 볼
  // 수 없으므로 **첨부를 조회하기 전에** 막는다 — 예전에 repairCases.files
  // 하나로 막던 그 자리이고, 그때와 마찬가지로 존재 여부가 드러나지 않는다.
  //
  // 두 번 물어도 DB는 한 번만 읽힌다(permission-resolver의 cache()).
  const canReadRepairCaseFiles = await hasPermission(actingUser.role, "repairCases.files", "READ");
  // 모델 파일을 **보는** 권한은 productModels.files가 아니라 view다 — 파일
  // 헤더의 '권한이 주인에 따라 갈린다' 참조.
  const canReadProductModelFiles = await hasPermission(actingUser.role, "productModels.view", "READ");
  if (!canReadRepairCaseFiles && !canReadProductModelFiles) {
    return fail(403, "FORBIDDEN", "이 파일을 열람할 권한이 없습니다.");
  }

  // ── 3) 첨부 행 ─────────────────────────────────────────────────────────
  const { id: attachmentId } = await context.params;
  const attachment = await getAttachmentForDownload(attachmentId);
  if (!attachment) {
    return fail(404, "NOT_FOUND", "파일을 찾을 수 없습니다.");
  }

  // ── 4) 주인별 권한 — 판정 결과를 꺼내기 전에 확인한다 ──────────────────
  //
  // 주인이 아무도 없는 첨부(둘 다 NULL)는 여기서 갈라 봐야 물을 대상이 없다.
  // 아래 허용 판정이 DETACHED로 막으므로 그쪽에 맡긴다.
  const allowedForOwner = attachment.productModelId
    ? canReadProductModelFiles
    : canReadRepairCaseFiles;
  if (!allowedForOwner) {
    // 🔴 403이 아니라 **404다.** 여기까지 온 사람은 문턱을 넘었으므로, 403으로
    // 갈라 답하면 "그 ID는 실재하고 이런 종류의 첨부다"가 새어 나간다. 없는
    // 것과 못 보는 것을 응답에서 구분하지 않는다.
    return fail(404, "NOT_FOUND", "파일을 찾을 수 없습니다.");
  }

  /**
   * 무엇을 어떻게 내줄지 — 세 가지다.
   *
   *  - (없음)      원본을 **첨부로** 내린다. 실제로 가져가는 행위라 감사 기록이 남는다.
   *  - `view=thumb` 미리보기가 있으면 그것을, 없으면 원본을 **화면 안에** 보여 준다.
   *  - `view=full`  원본을 **화면 안에** 보여 준다. 사진 크게 보기와 PDF 미리보기가 쓴다.
   *
   * thumb과 full을 가른 이유가 실제로 겪은 사고다. 처음에는 화면용 주소가
   * 하나뿐이었는데, 미리보기를 도입하자 **크게 보기까지 480px 썸네일을 보여
   * 주게 되었다.** 파형의 눈금을 확인하려고 여는 화면인데 확인할 수 없는
   * 해상도가 된 것이다. 화면에 보여 주는 것과 어떤 크기를 보여 주는 것은
   * 다른 결정이라 주소에서 갈라 둔다.
   *
   * 형식이 안전 목록에 없으면 요청과 무관하게 첨부로 내린다 — 무엇을 화면에서
   * 열어도 되는지는 클라이언트가 정하게 두지 않는다. 자리마다 목록이 다르다는
   * 것도 서버가 정한다(PDF 는 full 에서만 열리고 thumb 에서는 열리지 않는다) —
   * shouldServeInline 참조.
   */
  const view = request.nextUrl.searchParams.get("view");
  const inline = shouldServeInline(view, attachment.mimeType);
  const preferPreview = view === "thumb";

  // ── 5) 허용 판정 ───────────────────────────────────────────────────────
  const decision = decideAttachmentDownload({
    repairCaseId: attachment.repairCaseId,
    productModelId: attachment.productModelId,
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

  // ── 6) 경로 검증 — DB 값이라도 그대로 믿지 않는다 ──────────────────────
  const storage = getAttachmentStorage();

  // 썸네일을 달라고 했고 실제로 있을 때만 미리보기를 준다. 목록의 썸네일
  // 스무 개가 원본 스무 장이 되는 것을 막는 것이 이 한 줄의 목적이다.
  // 미리보기는 없어도 되는 것이라(옛 사진에는 없다) 없으면 원본으로 돌아간다.
  //
  // 크게 보기(view=full)와 내려받기는 언제나 원본이다.
  const servedPath =
    preferPreview && attachment.previewPath ? attachment.previewPath : attachment.storedPath;
  const servingPreview = servedPath !== attachment.storedPath;

  let stream: ReadableStream<Uint8Array>;
  try {
    // 루트 밖을 가리키면 여기서 던진다. 존재 여부는 read가 알려 준다.
    resolveAttachmentAbsolutePath(resolveUploadsRoot(), servedPath);
    stream = await storage.read(servedPath);
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

  // ── 7) 감사 기록 — 스트림을 돌려주기 전에 남긴다 ───────────────────────
  //
  // ⚠️ **미리보기(inline)는 기록하지 않는다.** 목록에 썸네일이 열 개 있으면
  // 화면을 한 번 여는 것만으로 FILE_DOWNLOAD가 열 줄 쌓인다. 감사 로그는 3년
  // 보관 대상이고, 그렇게 쌓인 기록은 "누가 무엇을 가져갔는가"를 찾을 수 없게
  // 만든다 — 남기는 것이 목적이 아니라 **찾을 수 있게 하는 것**이 목적이다.
  //
  // 그래서 기록하는 것은 **파일을 실제로 가져가는 행위**(attachment)뿐이다.
  // 화면 안에서 보는 것은 목록을 여는 일의 일부로 본다. 이 구분을 바꾸려면
  // SECURITY_POLICY.md의 감사 정책과 함께 정해야 한다.
  //
  // 응답을 먼저 반환하지 않는 이유는 따로 있다. 스트림이 끝나는 시점을 이
  // 함수가 알 수 없어 기록이 누락될 수 있다.
  if (!inline) {
    await recordAttachmentDownload({
      attachmentId: attachment.id,
      actorUserId: actingUser.id,
      // 주인을 그대로 넘긴다 — 기록하는 쪽이 어느 주인인지 갈라 적는다. 예전처럼
      // repairCaseId 하나만 넘기면 모델 첨부의 기록에 `repairCaseId: null` 만
      // 남아, 그 줄을 읽는 사람이 무슨 파일이었는지 알 수 없다.
      owner: {
        repairCaseId: attachment.repairCaseId,
        productModelId: attachment.productModelId,
      },
      originalFileName: attachment.originalFileName,
      fileSize: attachment.fileSize,
    });
  }

  // ── 8) 전송 ────────────────────────────────────────────────────────────
  //
  // ==========================================================================
  // 🔴 전역 목록과 **이름이 겹치는 헤더는 여기서 낼 수 없다** — 이 통로만의
  //    이야기가 아니다
  // ==========================================================================
  // **이 저장소의 어떤 라우트도** next.config.ts 의 SECURITY_HEADERS 와 같은
  // 이름의 헤더를 스스로 내보낼 수 없다. 전역 headers() 가 먼저 붙고, 그 뒤
  // 라우트 응답의 헤더는 그 이름이 이미 있으면 **조용히 버려진다**(Next 의
  // send-response.js — 코드는 위 INLINE_SAFE_MIME_TYPES 머리말에 옮겨 두었다).
  // 오류도 경고도 없다. 코드에는 있고 응답에는 없는 상태가 된다.
  //
  // 지금 그 목록이 잡고 있는 이름은 여섯이다:
  //
  //     X-Frame-Options · Content-Security-Policy · X-Content-Type-Options ·
  //     Referrer-Policy · Permissions-Policy · Strict-Transport-Security
  //
  // 어느 라우트에서든 이 여섯 중 하나를 **다른 값으로** 내보내려 하면 그 값은
  // 사라진다. 라우트에서 이름을 겹치지 않는 헤더(예: X-Temp-Probe)는 정상적으로
  // 나가므로, "라우트 헤더가 안 나간다"가 아니라 **"이름이 겹치면 진다"**가
  // 정확한 규칙이다. 정말 그 경로만 다른 값이 필요하면 next.config.ts 의
  // headers() 에 전역 규칙 **뒤에** 그 경로만의 규칙을 하나 더 두는 것이
  // 유일한 길이다.
  // ==========================================================================
  return new NextResponse(stream, {
    status: 200,
    headers: {
      // 미리보기는 언제나 JPEG이고 크기도 원본과 다르다. 원본 값을 그대로
      // 붙이면 브라우저가 파일이 잘렸다고 보고 그리다 만다.
      "Content-Type": servingPreview ? "image/jpeg" : attachment.mimeType,
      ...(servingPreview ? {} : { "Content-Length": String(attachment.fileSize) }),
      "Content-Disposition": contentDispositionFor(attachment.originalFileName, inline),
      // 브라우저가 내용을 보고 형식을 다시 추측하지 않게 한다. 추측을 허용하면
      // mime_type 검증을 통과한 파일이 다른 형식으로 실행될 수 있다.
      //
      // ⚠️ **실제로 나가는 것은 전역 목록의 같은 헤더다**(바로 위 🔴 참조) —
      //    값이 `nosniff` 로 똑같아서 증상이 없을 뿐, 이 줄이 이긴 것이 아니다.
      //    그래도 **지우지 말 것.** 전역 목록이 언젠가 바뀌거나 이 라우트가 다른
      //    앞단(프록시·별도 서버) 뒤로 옮겨지는 날, 이 한 줄이 없으면 파일이
      //    나가는 **유일한 통로**가 아무 표시 없이 무방비가 된다. 여기 남겨 두는
      //    것은 "이 통로는 최소한 이 값을 요구한다"는 선언이고, 지금은 전역과
      //    값이 같아 공짜다.
      "X-Content-Type-Options": "nosniff",
      // 첨부는 사내 자료다. 중간 캐시나 브라우저 디스크에 남기지 않는다.
      "Cache-Control": "private, no-store",
    },
  });
}
