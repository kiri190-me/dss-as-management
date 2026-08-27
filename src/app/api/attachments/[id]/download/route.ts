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

/**
 * 화면 안에서 그대로 보여 줘도 되는 형식인가.
 *
 * `inline`은 브라우저에게 "내려받지 말고 열어라"라고 말하는 것이라, 여는
 * 순간 그 내용이 이 사이트의 것으로 실행될 수 있는 형식은 절대 넣으면 안
 * 된다 — 특히 SVG와 HTML이 그렇다(그 안의 스크립트가 우리 도메인에서 돈다).
 * 지금 허용목록에 SVG는 없지만, 나중에 누가 더할 때를 대비해 **여기서도
 * 따로** 좁혀 둔다. 목록에 없는 형식은 전부 첨부로 내려간다.
 *
 * 🔴 **이 집합에 SVG · HTML · XML 계열을 더하지 말 것.**
 *    image/svg+xml · text/html · application/xhtml+xml · application/xml ·
 *    text/xml — 전부 스크립트를 품을 수 있는 형식이고, inline 으로 나가는
 *    순간 그 스크립트가 **우리 도메인에서** 돈다(세션 쿠키가 닿는 자리다).
 *    확장자 허용목록(attachment-allowlist.ts)이 언젠가 넓어져도 이 집합이
 *    **두 번째 방어선**으로 남아 있어야 한다 — 그것이 이 목록을 라우트에
 *    따로 두는 이유다.
 *
 * ── PDF 가 여기 있는 까닭, 그리고 그것이 감수하는 위험 ────────────────────
 * 회로도다. 이 구역이 있는 이유 자체가 회로도를 **보는** 것인데, 볼 때마다
 * 파일로 받아서 여는 것은 번거롭다. 그래서 PDF 는 `?view=full` 에서 열어 준다.
 *
 * 🔴 다만 **PDF 도 스크립트를 담을 수 있는 형식이다.** inline 으로 나가면 그
 *    문서는 **우리 출처(origin)에서** 열리고, 그 안의 스크립트가 우리 도메인의
 *    것으로 도는 길이 원리상 열린다 — 세션 쿠키가 닿는 자리다. 이것은 열어
 *    주기로 **승인된 위험**이고, 지금 그 자리를 받치고 있는 방어선은 넷뿐이다:
 *
 *      1) **올릴 때 확장자와 실제 앞머리 바이트를 대조한다**
 *         (attachment-allowlist.ts 의 isContentCompatibleWithExtension —
 *          .pdf 는 앞 1024바이트 안에서 `%PDF-` 를 찾는다). 이름만 .pdf 로 바꾼
 *          파일은 애초에 들어오지 못한다. 다만 이것은 **형식을 속인 파일**까지만
 *          막는다 — 진짜 PDF 안의 스크립트는 검사하지 않는다(검사 엔진이 없어
 *          malware_scan_status 는 전부 NOT_SCANNED 다).
 *      2) **`X-Content-Type-Options: nosniff`** — 브라우저가 내용을 보고 형식을
 *         다시 추측하지 않는다(아래 응답 헤더의 ⚠️ 도 함께 읽을 것).
 *      3) **사내망 로그인 + 올리기는 WRITE 권한이 있어야 한다**
 *         (repairCases.files · productModels.files WRITE). 바깥 사람이 이 통로에
 *         파일을 밀어 넣을 창구가 없다.
 *      4) **요즘 브라우저는 PDF 를 자기 내장 뷰어 안에서 연다**(PDF.js 계열).
 *         그 뷰어는 문서 안의 스크립트를 기본적으로 돌리지 않는다. 이것은 우리가
 *         건 방어가 아니라 **빌려 쓰는 방어**라 브라우저 설정 하나로 사라질 수
 *         있다 — 그래서 네 번째에 둔다.
 *
 *    이 넷 중 하나라도 무너지는 날(허용목록이 넓어지거나, 바깥에서 올릴 수 있게
 *    되거나, 이 통로가 인증 없이 열리거나) **PDF 를 inline 으로 여는 결정 자체를
 *    다시 저울질해야 한다.**
 *
 * ── 🚨 `Content-Security-Policy: sandbox` 는 이 라우트에서 붙일 수 없다 ────
 * 한 번 넣었다가 **함수째 뺐다.** 이 라우트가 응답에 그 헤더를 실어도
 * **브라우저에는 도달하지 않는다**(개발 서버에 실제로 물어 확인했다). 나가는
 * 응답에는 next.config.ts 가 모든 경로에 건
 * `Content-Security-Policy: frame-ancestors 'none'` **하나만** 남는다. 같은
 * 자리에서 함께 실어 본 시험용 헤더(`X-Temp-Probe`)는 그대로 나왔으므로 라우트
 * 헤더가 통째로 무시되는 것은 아니다 — **이름이 겹칠 때만** 떨어진다.
 *
 * 까닭은 Next 의 응답 조립 순서다(node_modules/next/dist/server/send-response.js):
 * 전역 headers() 가 **먼저** 붙고, 그 뒤 라우트 응답의 헤더는
 *
 *     const isHeaderPresent = typeof res.getHeader(name) !== 'undefined';
 *     if (multipleAllowed.includes(name) || !isHeaderPresent) res.appendHeader(...)
 *
 * 로 **이미 있는 이름이면 그냥 버린다**(여럿 허용은 set-cookie ·
 * www-authenticate · proxy-authenticate · vary 넷뿐이다). 두 값을 한 헤더에
 * 합쳐 적어도(`sandbox; frame-ancestors 'none'`) 결과는 같다 — 이름이 겹치는
 * 순간 버려진다.
 *
 * 돌지 않는 보안 코드는 없는 것보다 나쁘다. 코드에 sandbox 가 보이면 다음에
 * 읽는 사람이 "PDF 는 격리돼 있구나" 하고 믿게 되고, 그 믿음 위에서 다른 결정을
 * 내린다. 그래서 지웠다.
 *
 * ▶ **되살리려면 여기가 아니라 next.config.ts 를 고쳐야 한다.** 그 파일의
 *   headers() 에 전역 규칙보다 **뒤에** 이 경로만의 규칙을 하나 더 두는 식이다:
 *
 *     { source: "/api/attachments/:id/download",
 *       headers: [{ key: "Content-Security-Policy",
 *                   value: "sandbox; frame-ancestors 'none'" }] }
 *
 *   ⚠️ 그때는 **일부 브라우저의 내장 PDF 뷰어가 sandbox 안에서 뜨지 않는다**는
 *      것도 함께 확인할 것(뷰어 자체가 스크립트로 만들어져 있다). 켜자마자
 *      "PDF 가 안 열린다"는 신고가 올 수 있고, 그때 되돌릴 자리도 그 파일이다.
 */
const INLINE_SAFE_MIME_TYPES = new Set(["image/jpeg", "image/png", "application/pdf"]);

/**
 * 썸네일 자리(`?view=thumb`)에 그대로 실어도 되는 형식 — **그림뿐이다.**
 *
 * 그 주소를 부르는 곳은 목록의 작은 그림칸이다. 미리보기(JPEG)가 있으면
 * 그것이 나가지만 **없으면 원본이 통째로** 나간다. 그런데 미리보기를 만드는
 * 쪽(shrink-image.ts 의 makePreview)은 jpeg·png 가 아니면 아예 만들지 않으므로
 * **PDF 에는 미리보기가 영영 없다.** 그래서 PDF 를 이 목록에까지 넣으면 한 변이
 * 200px 도 안 되는 자리에 몇 MB짜리 회로도 원본이 실려 나가고, 그러고도 그림이
 * 아니라 그려지지도 않는다.
 *
 * 화면(ProductModelFilesSection · StoredAttachmentList)은 사진에만 thumb 을
 * 부르므로 실제로 이 경우가 오지는 않는다. 그래도 **판정은 서버가 한다** —
 * 무엇을 화면에서 열어도 되는지 클라이언트가 정하게 두지 않는 것이 이 라우트의
 * 성질이고, 거기에는 "어느 자리에서" 열어도 되는지도 포함된다.
 */
const THUMBNAIL_INLINE_MIME_TYPES = new Set(["image/jpeg", "image/png"]);

/**
 * inline 으로 내보낼 것인가 — 이 판정은 **오직 서버에만** 있다.
 *
 * 클라이언트가 `?view=full` 이라고 물어도 형식이 목록에 없으면 그냥 첨부로
 * 내려간다. `view` 가 없거나 모르는 값이면 어떤 형식이든 첨부다.
 *
 * 라우트 밖으로 옮기지 않는다 — 이 판정과 바로 위 두 목록(무엇을 왜 열어 주는지,
 * 그리고 PDF 를 여는 대가로 무엇을 감수했는지)은 같이 읽혀야 뜻이 통하고, 파일을
 * 내보내는 통로는 이 하나뿐이다. 테스트가 부를 수 있도록 export 만 한다.
 */
export function shouldServeInline(view: string | null, mimeType: string): boolean {
  if (view === "full") return INLINE_SAFE_MIME_TYPES.has(mimeType);
  if (view === "thumb") return THUMBNAIL_INLINE_MIME_TYPES.has(mimeType);
  return false;
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
