"use server";

import { revalidatePath } from "next/cache";

import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { hasPermission } from "@/lib/auth/permission-resolver";
import { readSession } from "@/lib/auth/session";
import { getAuthSource } from "@/lib/config/auth-source";
import {
  addProductModelShareDoc,
  removeProductModelShareDoc,
  type ProductModelShareDocEntryKind,
  type ProductModelShareDocMutationResult,
} from "@/lib/db/mutations/product-model-share-docs";
import { getShareDocProductModel } from "@/lib/db/queries/product-model-share-docs";
import { checkQuoteFolderRelativePath, type QuoteFolderPathRejection } from "@/lib/domain/quote-folder-link";
import {
  QUOTE_FOLDER_OPENABLE_EXTENSIONS,
  checkQuoteFolderOpenableFilePath,
  type QuoteFolderFileRejection,
} from "@/lib/domain/quote-folder-file-link";
import { resolveRepairDocsArchiveRoot } from "@/lib/storage/repair-docs-archive";
import { findRepairDocsEntry } from "@/lib/storage/repair-docs-entries";
import { isValidUuid } from "@/lib/validation/procedure-validation-resolution-input";

/**
 * ============================================================================
 * 제품 **모델별** 공유폴더 가리킴 — 담기 · 지우기 (서버 액션, 2026-10-07)
 * ============================================================================
 * 「제품 모델 하나하나도 같은 것을 갖게 해 달라」(사용자 요구 2026-10-07)의 **쓰는
 * 쪽**이다. 고르는 창이 읽는 쪽은 통로다(api/product-models/[id]/share-folder/entries).
 * 종류별 액션(server/actions/product-model-kind-share-docs.ts)과 **주인만 다르다** —
 * 아래 규율과 그 까닭은 저쪽에 적힌 그대로이고, 🔴 **저쪽이 바뀌는 날 이 파일도 함께
 * 본다.**
 *
 * ── 🔴 왜 라우트가 아니라 서버 액션인가 ──────────────────────────────────
 * 같은 주소 아래 **올리기는 Route Handler**다(api/product-models/[id]/attachments) —
 * 본문이 파일 바이트라 스트림이 필요했기 때문이다. 🔴 **가리킴에는 바이트가 없다.**
 * 실어 보낼 것은 모델 · 종류구분 · 경로 · 이름 넉 줄이고, 지우기는 id 하나다. 첨부
 * 휴지통이 그은 선과 **같은 선**이다(server/actions/attachments.ts 머리말). 서버 액션을
 * 고르면 따라오는 것이 둘 더 있다: 화면을 다시 그리는 길(`revalidatePath`)이 그 자리에
 * 있고, Next 가 액션 요청의 출처를 스스로 본다.
 *
 * ── 🔴 담기 전에 다섯을 본다 — 차례가 곧 울타리다 ─────────────────────────
 *  ⓪ **주인이 살아 있는가** — 🔴 종류별 액션에 **없던 한 겹**이다. 저쪽 주인은 enum
 *     값이라 사라질 주인이 없었지만, 이쪽 주인은 **휴지통에 들어갈 수 있는 행**이다.
 *     버려진 모델에 자리를 담으면 아무도 보지 않는 줄이 남고, 15일 뒤 자동 정리가
 *     모델을 지울 때 함께 사라진다. 판정은 조회 하나가 쥔다
 *     (queries/product-model-share-docs.ts 의 getShareDocProductModel).
 *  ① **글자 규칙** — checkQuoteFolderRelativePath. 디스크를 보기 **전**이다.
 *  ② **열 수 있는 확장자인가**(파일일 때만) — checkQuoteFolderOpenableFilePath.
 *     🔴 **18종 허용목록이고, 올리기 허용목록과 일부러 다르다**(`.xlsm` 은 열기는 되고
 *     올리기는 막힌다 — domain/quote-folder-file-link.ts 머리말). 베껴 적지 않고 부른다.
 *  ③ **그 자리에 실제로 있는가 · 폴더인가 파일인가** — storage/repair-docs-entries.ts 의
 *     findRepairDocsEntry. 사람이 「파일」이라 적었는데 폴더가 서 있으면 거절한다.
 *  ④ **중복** — 같은 모델에 접어서 같은 경로는 둘이 될 수 없다(mutation 이 본다).
 * 🔴 ①②는 **이미 있는 검사를 그대로 쓴다.** 새 규칙도, 두 벌째 확장자 목록도 없다.
 *
 * ── 🔴 설정이 비어 있으면 **담을 수 없다** ────────────────────────────────
 * `REPAIR_DOCS_ARCHIVE_DIR` 가 비면 ③을 할 수 없다. 그때 그냥 담으면 **아무도 확인하지
 * 않은 경로**가 표에 남고, 나중에 사람이 눌렀을 때야 「없습니다」가 난다. 읽는 쪽이
 * `disabled` 로 조용히 꺼지는 것과 달리 쓰는 쪽은 **멈추고 알린다** — 가리킴은 「확인된
 * 자리」라는 약속이기 때문이다. (지금 개발 PC 가 그 상태다.)
 *
 * ── 🔴 거절 사유에 **경로가 한 글자도 들어가지 않는다** ───────────────────
 * 아래 `deny(...)` 로 나가는 말은 전부 **붙박이 글자**다 — 사람이 적은 경로도, 설정의
 * 루트도, 폴더 이름도 섞이지 않는다. 이 서류함의 폴더 이름에는 고객사명이 섞여 있고,
 * 거절 문구는 화면 · 로그 · 스크린샷으로 가장 쉽게 새어 나간다. 저장소 모듈이 만드는
 * 실패 사유(`found.reason`)도 **경로 없는 짧은 문장**임이 그쪽에서 못 박혀 있다.
 *
 * ── 권한 ────────────────────────────────────────────────────────────────
 * **`productModels.files` WRITE** — 모델 상세의 파일 올리기 통로
 * (api/product-models/[id]/attachments/route.ts)가 묻는 바로 그 문이다(그 잎의 기본
 * 정책은 auth/product-model-authorization.ts 의 `canManageProductModelFiles` —
 * SUPER_ADMIN · ADMIN · AS_ENGINEER). 🔴 **새 권한을 만들지 않았다.** **보는** 것은
 * `productModels.view` 로 이미 갈려 있다.
 *
 * ── 🔴 지우면 되돌릴 수 없다 — 흔적은 감사 로그뿐이다 ────────────────────
 * 이 표에는 휴지통이 없다(스키마 머리말). 지워진 줄은 `audit_logs.previous_value` 에
 * 통째로 들어간다(mutations/product-model-share-docs.ts). 보관은 3년이다.
 * ============================================================================
 */

export type ProductModelShareDocActionResult =
  | { ok: true; id: string }
  | { ok: false; code: ProductModelShareDocActionFailureCode; message: string };

export type ProductModelShareDocActionFailureCode =
  | "FORBIDDEN"
  | "UNAUTHORIZED"
  /** 주소가 가리키는 모델이 없거나 **휴지통에 있다**. 올리기 통로와 같은 코드 이름이다. */
  | "MODEL_NOT_FOUND"
  | "INVALID_ENTRY_KIND"
  | "INVALID_PATH"
  /** 공유폴더 위치가 설정되지 않았다 — 확인할 수가 없어 담지 않는다. */
  | "SHARE_FOLDER_DISABLED"
  /** 공유폴더를 읽지 못했다(느림 · 연결 끊김 · 권한). */
  | "SHARE_FOLDER_FAILED"
  /** 그 자리에 아무것도 없다. */
  | "ENTRY_NOT_FOUND"
  /** 파일이라 적었는데 폴더가 있다(또는 그 반대다). */
  | "ENTRY_KIND_MISMATCH"
  | "DUPLICATE"
  | "NOT_FOUND";

/** 사람이 적은 이름의 상한 — DB CHECK(btrim 1..200)와 같은 수다. */
const MAX_LABEL_LENGTH = 200;

const MODEL_NOT_FOUND_MESSAGE = "해당 제품 모델을 찾을 수 없습니다.";

/**
 * 경로가 거절된 까닭 → 사람이 읽는 말. 🔴 **판정을 여기서 다시 하지 않는다** — 코드만
 * 받아 글자로 바꾼다(규칙은 domain/quote-folder-link.ts · quote-folder-file-link.ts).
 */
const PATH_REJECTION_MESSAGES: Record<QuoteFolderPathRejection | QuoteFolderFileRejection, string> = {
  EMPTY: "가리킬 자리를 고르세요.",
  TOO_LONG: "경로가 너무 깁니다.",
  CONTROL_CHARACTER: "경로에 쓸 수 없는 문자가 들어 있습니다.",
  ABSOLUTE: "공유폴더 안에서의 경로만 담을 수 있습니다(전체 경로 · 드라이브 문자는 담지 않습니다).",
  FORBIDDEN_CHARACTER: "경로에 쓸 수 없는 문자가 들어 있습니다(마디 구분은 / 하나입니다).",
  EMPTY_SEGMENT: "경로의 마디가 비어 있습니다.",
  DOT_SEGMENT: "경로에 . 또는 .. 마디를 담을 수 없습니다.",
  TRAILING_DOT_OR_SPACE: "폴더 · 파일 이름이 점이나 공백으로 끝날 수 없습니다.",
  NO_EXTENSION: "확장자가 없는 파일은 열 수 없어 담지 않습니다.",
  EXTENSION_NOT_ALLOWED: `열 수 있는 파일 형식이 아닙니다(${QUOTE_FOLDER_OPENABLE_EXTENSIONS.map((extension) => `.${extension}`).join(" · ")}).`,
};

type Actor =
  | { ok: true; userId: string }
  | { ok: false; result: ProductModelShareDocActionResult & { ok: false } };

function deny(
  code: ProductModelShareDocActionFailureCode,
  message: string
): ProductModelShareDocActionResult & { ok: false } {
  return { ok: false, code, message };
}

/**
 * 「이 사람이 가리킴을 바꿀 수 있는가」까지만 본다. 대상의 상태(있는가 · 중복인가)는
 * 아래 모델 조회와 mutation 이 본다 — 서로 다른 물음이라 한쪽이 다른 쪽을 대신하지
 * 못한다.
 */
async function resolveWriteActor(): Promise<Actor> {
  // 🔴 database 모드에서만 session.userId 가 진짜 users.id 다(config/auth-source.ts).
  //    이 표의 created_by 는 users 를 가리키는 NOT NULL FK 라 그 값이 꼭 필요하다.
  if (getAuthSource() !== "database") {
    return { ok: false, result: deny("FORBIDDEN", "데이터베이스 저장 모드가 아닙니다.") };
  }

  const session = await readSession();
  if (!session) return { ok: false, result: deny("UNAUTHORIZED", "로그인이 필요합니다.") };

  // 세션에 박힌 값이 아니라 살아 있는 계정을 다시 읽는다 — 정지 · 삭제 · 강등됐을 수 있다.
  const actingUser = await resolveActingUserForSession(session);
  if (!actingUser) {
    return { ok: false, result: deny("UNAUTHORIZED", "사용자 정보를 확인할 수 없습니다.") };
  }
  if (actingUser.approvalStatus !== "APPROVED") {
    return { ok: false, result: deny("FORBIDDEN", "계정이 아직 승인되지 않았습니다.") };
  }
  if (!(await hasPermission(actingUser, "productModels.files", "WRITE"))) {
    return { ok: false, result: deny("FORBIDDEN", "제품 모델 서류를 바꿀 권한이 없습니다.") };
  }

  return { ok: true, userId: actingUser.id };
}

/** 성공 뒤 다시 그릴 화면. 그 모델의 상세 한 곳이다(모델 첨부가 다시 그리는 자리와 같다). */
function revalidateModel(productModelId: string): void {
  revalidatePath(`/product-models/${productModelId}`, "layout");
}

/** mutation 의 답을 액션의 답으로 — 코드 이름이 같아 글자만 옮긴다. */
function fromMutation(result: ProductModelShareDocMutationResult): ProductModelShareDocActionResult {
  if (result.ok) return result;
  return deny(result.code, result.message);
}

export type AddProductModelShareDocActionInput = {
  productModelId: string;
  entryKind: string;
  relativePath: string;
  label?: string | null;
};

/** 가리킴 한 줄을 담는다. 머리말의 ⓪①②③④ 차례 그대로다. */
export async function addProductModelShareDocAction(
  input: AddProductModelShareDocActionInput
): Promise<ProductModelShareDocActionResult> {
  const actor = await resolveWriteActor();
  if (!actor.ok) return actor.result;

  // ── ⓪ 주인이 살아 있는가 — 🔴 휴지통에 있는 모델은 없는 것과 같다 ──────
  const model = await getShareDocProductModel(input.productModelId);
  if (!model) return deny("MODEL_NOT_FOUND", MODEL_NOT_FOUND_MESSAGE);

  const { entryKind } = input;
  if (entryKind !== "FILE" && entryKind !== "FOLDER") {
    return deny("INVALID_ENTRY_KIND", "파일인지 폴더인지를 확인할 수 없습니다.");
  }

  const relativePath = typeof input.relativePath === "string" ? input.relativePath : "";

  // ── ① 글자 규칙 · ② 확장자 — 디스크를 보기 전이다 ──────────────────────
  // 파일이면 경로 규칙 + 허용 확장자를 한 함수가 함께 본다(그쪽이 먼저 경로 규칙을 지난다).
  const rejection =
    entryKind === "FILE"
      ? checkQuoteFolderOpenableFilePath(relativePath)
      : checkQuoteFolderRelativePath(relativePath);
  if (rejection !== null) return deny("INVALID_PATH", PATH_REJECTION_MESSAGES[rejection]);

  // ── ③ 그 자리에 실제로 있는가 ──────────────────────────────────────────
  const archiveRoot = resolveRepairDocsArchiveRoot();
  if (archiveRoot === null) {
    // 🔴 읽기는 조용히 꺼지지만 쓰기는 멈춘다 — 머리말 참조.
    return deny(
      "SHARE_FOLDER_DISABLED",
      "공유폴더 위치가 설정되지 않아 자리를 확인할 수 없습니다(관리자에게 알려 주세요)."
    );
  }
  const found = await findRepairDocsEntry({ root: archiveRoot, relativePath });
  if (found.status === "failed") {
    // 사유는 저장소 모듈이 만든 **경로 없는** 짧은 문장이다.
    return deny("SHARE_FOLDER_FAILED", found.reason);
  }
  if (found.status === "not-found") {
    return deny("ENTRY_NOT_FOUND", "공유폴더에서 그 자리를 찾을 수 없습니다.");
  }
  if (found.isDirectory !== (entryKind === "FOLDER")) {
    return deny(
      "ENTRY_KIND_MISMATCH",
      found.isDirectory
        ? "그 자리에 있는 것은 폴더입니다 — 폴더로 담으세요."
        : "그 자리에 있는 것은 파일입니다 — 파일로 담으세요."
    );
  }

  // 이름은 비면 NULL 이다 — 그때 화면이 경로의 마지막 마디를 쓴다(스키마 label 주석).
  const trimmedLabel = (input.label ?? "").trim();
  const label = trimmedLabel.length > 0 ? trimmedLabel.slice(0, MAX_LABEL_LENGTH) : null;

  // ── ④ 담기(중복은 mutation 이 사람 말로 막는다) ────────────────────────
  const result = await addProductModelShareDoc({
    productModelId: model.id,
    entryKind: entryKind as ProductModelShareDocEntryKind,
    // 🔴 들어온 글자 그대로 담는다 — 다듬은 이름으로 이으면 없는 폴더가 된다.
    relativePath,
    label,
    actorUserId: actor.userId,
  });
  if (result.ok) revalidateModel(model.id);
  return fromMutation(result);
}

export type RemoveProductModelShareDocActionInput = { productModelId: string; id: string };

/**
 * 가리킴 한 줄을 지운다. 🔴 **휴지통이 없다** — 되돌리려면 감사 로그의
 * `previous_value` 를 보고 다시 적어야 한다(머리말).
 *
 * 🔴 담기와 **같은 ⓪ 관문**을 지난다. 휴지통에 든 모델의 상세 화면은 열리지 않으므로,
 * 그런 모델로 들어온 지우기는 「낡은 화면이 보낸 요청」이다 — 그 화면을 믿고 표를 치는
 * 대신 거절하고, 15일 뒤 자동 정리가 감사 한 줄을 남기며 함께 지운다
 * (mutations/master-data-purge.ts).
 */
export async function removeProductModelShareDocAction(
  input: RemoveProductModelShareDocActionInput
): Promise<ProductModelShareDocActionResult> {
  const actor = await resolveWriteActor();
  if (!actor.ok) return actor.result;

  const model = await getShareDocProductModel(input.productModelId);
  if (!model) return deny("MODEL_NOT_FOUND", MODEL_NOT_FOUND_MESSAGE);

  // UUID 모양이 아니면 DB 를 묻지 않는다 — 없는 것과 같은 답이다.
  if (!isValidUuid(input.id)) return deny("NOT_FOUND", "해당 가리킴을 찾을 수 없습니다.");

  const result = await removeProductModelShareDoc({
    id: input.id,
    productModelId: model.id,
    actorUserId: actor.userId,
  });
  if (result.ok) revalidateModel(model.id);
  return fromMutation(result);
}
