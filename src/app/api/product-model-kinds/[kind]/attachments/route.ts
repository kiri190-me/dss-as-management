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
  isCategoryOpenToAnyExtension,
  isExtensionAllowedForCategory,
  isUploadContentCompatible,
  normalizeFileExtension,
} from "@/lib/domain/attachment-allowlist";
import {
  attachmentCategoryLabels,
  isAttachmentCategory,
  isAttachmentCategoryAllowedForProductModelKind,
} from "@/lib/domain/attachment-category";
import { originalModifiedAtFromSearchParams } from "@/lib/domain/attachment-original-modified-at";
import { buildProductModelKindAttachmentStoredPath } from "@/lib/domain/attachment-path";
import { isProductModelKind } from "@/lib/domain/product-model-kind";
import { createAttachmentRecord } from "@/lib/db/mutations/attachments";
import { getAttachmentStorage } from "@/lib/storage/local-fs-adapter";
import { AttachmentTooLargeError } from "@/lib/storage/storage-adapter";

/**
 * ============================================================================
 * POST /api/product-model-kinds/{kind}/attachments — 종류 공통 서류가 들어오는 통로
 * ============================================================================
 * 제품 모델 통로(api/product-models/[id]/attachments/route.ts)와 **한 벌**이고,
 * 그 파일은 다시 접수 건 통로와 한 벌이다. 구조를 고른 까닭(서버 액션이 아니라
 * Route Handler · multipart 를 안 쓰는 이유 · 다섯 단계의 순서)은 접수 건 통로의
 * 머리말에 전부 적혀 있다. 여기서는 반복하지 않고 **다른 점만** 적는다.
 *
 * ── 왜 공통 함수로 뽑지 않고 나란히 두는가 ───────────────────────────────
 * 모델 통로의 머리말이 적은 판단 그대로다 — 앞의 통로들은 이미 실기에서 파일을
 * 다루고 있고, 넷을 한 함수로 접으면 그 함수의 다음 수정이 아무도 의도하지 않은
 * 채 실기 경로까지 흔든다. 지금 이 통로가 모델 통로와 실제로 다른 곳은 셋뿐이고
 * (대상 확인 · 분류 판정 · 경로 함수), 그 셋을 인자로 받는 함수는 결국 "무엇이
 * 같아야 하는지"를 읽기 어렵게 만든다.
 *
 * 🔴 **그러므로 이 파일과 모델 통로는 함께 고쳐야 한다.** 상한 · 검사 순서 ·
 * 실패 응답 규칙을 한쪽만 바꾸면 두 통로의 동작이 갈라진다.
 *
 * ── 모델 통로와 다른 점 ──────────────────────────────────────────────────
 *   권한      productModels.files WRITE  →  **그대로**(새 권한을 만들지 않는다)
 *   대상 조회  getProductModelAttachmentUploadTarget → **없다**. 주인이 다른 표의
 *             행이 아니라 enum 값이라 "실재하는가"를 DB 에 물을 것이 없다 —
 *             셋 중 하나인가(isProductModelKind)가 그 자리를 대신하고, 그것은
 *             본문을 받기 전에 끝난다.
 *   실패 코드  MODEL_NOT_FOUND            →  **INVALID_KIND (400)**
 *   분류 판정  …ForOwner(…, "PRODUCT_MODEL") → …ForProductModelKind (같은 집합)
 *   경로      buildProductModelAttachmentStoredPath
 *                                        →  buildProductModelKindAttachmentStoredPath
 *   원본 수정일 **그대로 싣는다** — 모델 통로와 같은 성격의 서류다(아래).
 *
 * ── 🔴 주인은 넷 중 하나다 — 나머지 셋은 NULL 이다 ───────────────────────
 * 첨부 표의 주인 칸은 넷이고 CHECK 셋이 「둘 이상 차는 행」을 막는다. 이번 것은
 * `attachments_kind_owner_alone` — product_model_kind 가 차 있으면
 * repair_case_id · product_model_id · quote_id 는 **반드시 NULL** 이어야 한다.
 * 이 통로는 그 셋을 아예 손에 쥐지 않는다: mutation 에 넘기는 owner 가 판별자
 * 하나짜리 갈래라(mutations/attachments.ts 의 AttachmentOwnerInput), 종류를 고른
 * 순간 나머지 세 칸은 NULL 로 정해진다. 타입이 먼저 막고 DB 가 마지막으로 막는다.
 *
 * ── 원본 수정일을 여기서도 싣는 까닭 ─────────────────────────────────────
 * 지금 이 값을 싣는 통로는 제품 모델 쪽 하나뿐이었다. 종류 서류함은 **같은 성격**
 * 이다 — 「이 양식이 언제 갱신된 것인가」가 서류 자체만큼 중요한 자리라, 모델
 * 기본 자료와 같은 대접을 한다. 판정 규칙은 새로 만들지 않고
 * domain/attachment-original-modified-at.ts 한 벌을 그대로 지난다.
 *
 * 🔴 **이 값 때문에 업로드가 막히는 길은 없다.** 값이 없거나 터무니없으면 거절이
 * 아니라 빈칸(NULL)이고, 그래서 아래 FailureCode 에 그 몫의 코드가 없다.
 *
 * ── 순서는 그대로다 ──────────────────────────────────────────────────────
 *  1) 본문을 **받기 전에** 출처·세션·승인상태·권한·종류 코드를 확인한다.
 *  2) 임시 파일로 흘려보내며 크기·SHA-256을 함께 센다.
 *  3) 확장자 허용목록 + 실제 앞머리 바이트 대조.
 *  4) 임시 파일을 최종 자리로 **이동(commit)**.
 *  5) **그 다음에** 한 트랜잭션 안에서 attachments 행 + audit_logs(FILE_UPLOAD).
 *
 * ⚠️ **4번과 5번을 뒤집지 않는다.** 반대로 하면 DB에는 있는데 디스크에 없는
 * 파일이 생기고, 그건 눌러도 아무것도 나오지 않는 깨진 기록이다.
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
  // 모델 통로의 MODEL_NOT_FOUND 에 해당한다. 404 가 아니라 **400** 인 것은 이것이
  // "있는 줄 알았는데 없더라"가 아니라 **주소의 마디가 애초에 종류가 아니다**이기
  // 때문이다 — 셋 중 하나가 아닌 글자는 실재할 수 있었던 적이 없다.
  | "INVALID_KIND"
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
  // 무엇이 왜 막혔는지 사람이 읽을 수 있게 돌려준다. 다만 저장 루트나
  // 내부 경로는 절대 싣지 않는다 — 실패 응답이 디스크 구조를 알려 주는
  // 창구가 되면 안 된다.
  return NextResponse.json({ error: message, code }, { status });
}

const MAX_ORIGINAL_FILE_NAME_LENGTH = 255;
const MAX_DESCRIPTION_LENGTH = 500;

export async function POST(request: NextRequest, context: { params: Promise<{ kind: string }> }) {
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

  // 🔴 모델 통로와 **같은 권한**이다 — productModels.files WRITE. 새 권한 영역을
  // 만들지도, 기존 영역을 넓히지도 않았다: 종류 서류함은 제품 모델 관리 안의
  // 자리이고, 모델의 사진·도면을 바꿀 수 있는 사람이 그 종류의 공통 서류도
  // 바꾼다. 보는 것은 productModels.view 로 이미 갈려 있다(내려받기 라우트).
  if (!(await hasPermission(actingUser, "productModels.files", "WRITE"))) {
    return fail(403, "FORBIDDEN", "제품 종류 서류를 올릴 권한이 없습니다.");
  }

  const { kind } = await context.params;

  // 주소의 마디가 종류 셋 중 하나인가. 🔴 **DB 를 묻지 않는다** — 이 주인은 행이
  // 아니라 enum 이라 "실재하는가"가 곧 "목록에 있는가"다. 모델 통로가 여기서
  // getProductModelAttachmentUploadTarget 을 부르던 자리이고, 잠금 확인이 없는
  // 것도 그쪽과 같다(종류에는 잠금 개념이 없다).
  if (!isProductModelKind(kind)) {
    return fail(400, "INVALID_KIND", "제품 종류를 확인할 수 없습니다.");
  }

  // ── 메타데이터(쿼리 문자열) 검증 — 아직 본문은 건드리지 않았다 ────────
  const searchParams = request.nextUrl.searchParams;

  const category = (searchParams.get("category") ?? "").trim();
  if (!isAttachmentCategory(category)) {
    return fail(400, "INVALID_CATEGORY", "첨부 분류가 올바르지 않습니다.");
  }
  // 받는 집합은 **제품 모델 첨부와 같다** — 목록을 여기 베껴 적지 않고 domain 의
  // 한 함수를 부른다(attachment-category.ts). 모델 쪽이 넓어지거나 좁아지는 날
  // 이 통로가 저절로 따라온다.
  if (!isAttachmentCategoryAllowedForProductModelKind(category)) {
    return fail(
      400,
      "CATEGORY_NOT_ALLOWED_FOR_OWNER",
      `'${attachmentCategoryLabels[category]}' 분류는 제품 종류 서류에 쓸 수 없습니다.`
    );
  }

  const originalFileName = (searchParams.get("fileName") ?? "").trim();
  if (originalFileName.length === 0 || originalFileName.length > MAX_ORIGINAL_FILE_NAME_LENGTH) {
    return fail(400, "INVALID_FILE_NAME", "파일 이름이 비어 있거나 너무 깁니다.");
  }

  const extension = normalizeFileExtension(originalFileName);
  // 전체 허용목록(14종) 관문. 🔴 **형식을 가리지 않는 분류는 이 관문을 지나지
  // 않는다** — 파라미터 · 통전검사 · 점검표는 실행 파일만 거절하고, 그 판정은
  // 바로 아래 isExtensionAllowedForCategory 하나가 한다. 두 관문을 다 지나야
  // 한다는 순서는 모델 통로와 같다.
  if (!extension || (!isCategoryOpenToAnyExtension(category) && !isAllowedExtension(extension))) {
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

  // 원본 파일이 올린 사람 PC 에서 마지막으로 저장된 시각(파일 머리말).
  //
  // 🔴 **이 줄 뒤에 fail(...) 이 붙는 일은 없다.** 걸러진 결과는 거절이 아니라
  // `null`(빈칸)이고, 판정 규칙은 모델 통로와 **같은 함수** 하나다.
  const originalModifiedAt = originalModifiedAtFromSearchParams(searchParams);

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
    console.error("종류 서류 임시 저장 실패", error);
    return fail(500, "STORAGE_FAILED", "파일을 저장하는 중 문제가 발생했습니다.");
  }

  // ── 3) 확장자 ↔ 실제 내용 대조 ────────────────────────────────────────
  if (written.size === 0) {
    await storage.discard(written.tempPath);
    return fail(400, "EMPTY_BODY", "빈 파일은 올릴 수 없습니다.");
  }
  if (!isUploadContentCompatible(extension, category, written.header)) {
    await storage.discard(written.tempPath);
    return fail(
      415,
      "CONTENT_MISMATCH",
      `파일 내용이 확장자(.${extension})와 맞지 않습니다. 이름만 바꾼 파일은 올릴 수 없습니다.`
    );
  }

  const attachmentId = randomUUID().toLowerCase();
  // 첫 마디는 `product-model-kinds` 이고, 둘째 마디는 종류 코드를 소문자로 눕힌
  // 것이다(한글을 쓰지 않는다 — attachment-path.ts 의 넷째 벌 머리말).
  const storedPath = buildProductModelKindAttachmentStoredPath({
    kind,
    attachmentId,
    extension,
  });

  // ── 4) 파일을 최종 자리로 옮긴다 (DB보다 먼저 — 파일 상단 ⚠️ 참조) ────
  try {
    await storage.commit(written.tempPath, storedPath);
  } catch (error) {
    await storage.discard(written.tempPath);
    console.error("종류 서류 파일 이동 실패", error);
    return fail(500, "STORAGE_FAILED", "파일을 저장하는 중 문제가 발생했습니다.");
  }

  // ── 5) 그 다음에 DB (행 + 감사 로그, 한 트랜잭션) ─────────────────────
  let created;
  try {
    created = await createAttachmentRecord({
      id: attachmentId,
      // 🔴 주인은 제품 **종류**다. 갈래 타입이라 repair_case_id ·
      // product_model_id · quote_id 를 함께 채우는 것은 타입 단계에서 불가능하고
      // (mutations/attachments.ts), 그 셋은 NULL 로 들어간다 —
      // attachments_kind_owner_alone CHECK 가 요구하는 모양이다.
      owner: { kind: "PRODUCT_MODEL_KIND", productModelKind: kind },
      category,
      originalFileName,
      storedPath,
      // 브라우저가 보낸 Content-Type이 아니라 확장자에서 서버가 고른 값이다.
      mimeType: canonicalMimeTypeForExtension(extension) ?? "application/octet-stream",
      fileSize: written.size,
      checksumSha256: written.sha256,
      description,
      // 없거나 터무니없으면 null 이다 — 그때도 행은 그대로 만들어진다.
      originalModifiedAt,
      uploadedBy: actingUser.id,
    });
  } catch (error) {
    // 기록을 만들지 못했으면 방금 놓은 파일은 주인이 없다. 치워 보되,
    // 실패해도 여기서 더 하지 않는다 — 주인 없는 파일은 나중에 훑어 치울 수
    // 있지만, 이 시점에 DB를 억지로 채우면 그게 깨진 기록이 된다.
    await storage.delete(storedPath).catch(() => undefined);
    console.error("종류 서류 기록 생성 실패", error);
    return fail(500, "RECORD_FAILED", "파일 기록을 저장하는 중 문제가 발생했습니다.");
  }

  return NextResponse.json(
    {
      id: created.id,
      productModelKind: kind,
      category,
      originalFileName,
      fileSize: written.size,
      checksumSha256: written.sha256,
      uploadedAt: created.uploadedAt,
    },
    { status: 201 }
  );
}
