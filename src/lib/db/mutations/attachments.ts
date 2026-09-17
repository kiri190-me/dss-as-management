import "server-only";

import { and, eq, inArray } from "drizzle-orm";
import { db } from "../client";
import { attachments, quotes } from "../schema";
import { insertAuditLog } from "./audit-logs";
import {
  DEFAULT_MALWARE_SCAN_STATUS,
  isAttachmentCategoryAllowedForOwner,
  isQuoteAttachmentSlotCategory,
  quoteAttachmentIdsDisplacedBy,
  type AttachmentCategory,
} from "@/lib/domain/attachment-category";
import { assertPortableStoredPath } from "@/lib/domain/attachment-path";

/**
 * ============================================================================
 * 첨부 행 만들기 — 디스크에 파일이 이미 놓인 다음에 불린다
 * ============================================================================
 * **이 함수는 파일을 쓰지 않는다.** 부르는 쪽(업로드 라우트)이 검증을 마치고
 * 임시 파일을 최종 자리로 옮긴 **뒤에** 부른다. 순서가 그 방향인 이유는
 * route.ts의 4·5단계 주석에 적어 두었다 — 요약하면, 주인 없는 파일은 나중에
 * 치울 수 있지만 실물 없는 DB 행은 화면에서 눌러도 아무것도 나오지 않는
 * 고장이기 때문이다.
 *
 * ── id를 밖에서 받는다 ───────────────────────────────────────────────────
 * 컬럼에 defaultRandom()이 있는데도 id를 인자로 받는 이유: **디스크 경로가
 * 첨부 ID로 만들어진다**(attachment-path.ts). 행을 넣어 봐야 id를 알 수
 * 있다면 파일을 어디에 둘지 정할 수 없고, 그러면 "행 먼저, 파일 나중"이 되어
 * 위 순서가 뒤집힌다.
 *
 * ── 한 트랜잭션 안에서 감사 로그까지 ─────────────────────────────────────
 * 첨부 행과 audit_logs(FILE_UPLOAD)는 같은 트랜잭션이다. 따로 쓰면 한쪽만
 * 남는 순간이 생기고, 그때 감사 기록은 "무슨 파일이 언제 들어왔는지"를 답하지
 * 못한다. audit-logs.ts가 이미 열린 트랜잭션을 인자로 받는 것도 같은 이유다.
 *
 * ── 주인은 셋 중 하나다 — 그것을 타입으로도 세운다 ───────────────────────
 * DB에는 attachments_owner_not_both · attachments_quote_owner_alone CHECK가 있다(schema/attachments.ts). "두 주인에
 * 동시에 걸린 파일"은 어느 폴더에 사는지가 정해지지 않는 모순이라 DB가 직접 막는다.
 * 이 함수의 입력도 **같은 규칙을 타입으로** 세워서, 그 모순을 만드는 코드가 애초에
 * 컴파일되지 않게 한다 — DB가 던지는 것은 마지막 방어선이지 첫 번째 방어선이 아니다
 * (AttachmentOwnerInput 주석 참조).
 *
 * ── 분류와 주인의 짝은 트랜잭션 **전에** 한 번 본다 ─────────────────────
 * isAttachmentCategoryAllowedForOwner 하나를 본다 — 견적서 두 칸은 견적서에만,
 * 접수 건 · 모델에는 그 둘이 붙지 않는다. 올리기 통로들이 이미 400 으로 거절하므로
 * 이것은 마지막 방어선이다.
 *
 * ── 셋째 주인(견적서) — 칸마다 한 파일, 새 파일이 옛 파일을 밀어낸다 (2026-09-15 Q2) ──
 * 견적서에는 결재 PDF 칸과 엑셀 칸이 하나씩 있고 칸마다 파일은 하나다
 * (domain/attachment-category.ts 의 QUOTE_ATTACHMENT_FILES_PER_SLOT). 같은 칸에 다시
 * 올리면 **옛 파일은 첨부 휴지통으로** 가고 새 파일이 그 칸을 차지한다(사용자 결정).
 * 그 교체는 행을 넣는 **같은 트랜잭션**에서, 견적서 행을 `FOR UPDATE` 로 잠근 뒤에 한다
 * (guardQuoteAttachmentChange). 잠그지 않으면 같은 칸에 동시에 올린 두 파일이 서로의
 * 존재를 못 본 채 둘 다 살아남아 「칸마다 하나」가 깨진다.
 *
 * 밀려난 파일은 지우지 않는다 — 소프트 삭제 네 칸을 채우고(사유는 고정 문구
 * QUOTE_ATTACHMENT_REPLACED_REASON) FILE_DELETE 감사를 한 줄씩 남긴다. 디스크 실물은
 * 그대로다(attachment-trash.ts 머리말의 ⚠️ — 복원하려면 실물이 있어야 한다). 사유를
 * 고정 문구로 두는 까닭은, 견적서를 휴지통에서 되살릴 때 **견적서와 함께 휴지통에 간
 * 파일만** 돌려보내고 교체로 밀려난 옛 파일은 돌려보내지 않아야 하기 때문이다
 * (attachment-trash.ts 의 restoreAttachmentsTrashedWithQuote).
 *
 * 휴지통에 있는 견적서에는 붙이지 못한다(QUOTE_IN_TRASH) — 휴지통의 견적서는 목록에도
 * 주소에도 없다. 판정은 같은 잠금 안에서 한다.
 * ============================================================================
 */

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * 이 첨부가 누구에게 붙는가. **셋 중 하나만 올 수 있다.**
 *
 * 선택 필드(`repairCaseId?` · `productModelId?` …)로 두지 않은 것이 요점이다.
 * 그렇게 두면 둘 다 채운 값이 타입을 통과하고, 그 모순은 DB의 CHECK가 던질
 * 때까지 — 즉 **파일을 이미 디스크에 놓은 뒤에야** 드러난다. 그 시점의 실패는
 * 주인 없는 파일을 남긴다.
 *
 * 판별자(`kind`)를 둔 것도 같은 이유다. 판별자가 없으면 "모두 비어 있는" 값이
 * 표현 가능해지고, 그때 어느 컬럼을 채울지 정할 수 없다. 여기서는 kind가
 * 정해지는 순간 채울 컬럼과 비울 컬럼이 함께 정해진다.
 */
export type AttachmentOwnerInput =
  | { kind: "REPAIR_CASE"; repairCaseId: string }
  | { kind: "PRODUCT_MODEL"; productModelId: string }
  /**
   * 견적서(2026-09-15 Q2). 권한(quotes WRITE)은 라우트가 이미 봤다 — 견적서 한 장에 대한
   * 판정(글쓴이 · 상태)이 없어 넘길 값이 없다. 이 파일이 보는 것은
   * 자료의 규칙(견적서가 있는가 · 휴지통인가 · 칸마다 하나)뿐이다.
   */
  | { kind: "QUOTE"; quoteId: string };

export type CreateAttachmentRecordInput = {
  /** 디스크 경로를 이미 이 값으로 만들었다. 위 'id를 밖에서 받는다' 참조. */
  id: string;
  /** 접수 건 · 제품 모델 · 견적서 중 하나 — 둘 이상은 타입이 허용하지 않는다. */
  owner: AttachmentOwnerInput;
  category: AttachmentCategory;
  /** 사용자가 올린 그대로의 이름. 표시·다운로드에만 쓰고 경로에는 쓰지 않는다. */
  originalFileName: string;
  /** 저장 루트 기준 상대 경로(`/` 구분자, 소문자). buildAttachmentStoredPath의 결과. */
  storedPath: string;
  /** 확장자에서 서버가 고른 정본 MIME. 브라우저가 보낸 값이 아니다. */
  mimeType: string;
  /** 실제로 받은 바이트 수. Content-Length가 아니라 센 값이다. */
  fileSize: number;
  /** 받은 바이트의 SHA-256(소문자 hex). */
  checksumSha256: string;
  description: string | null;
  uploadedBy: string;
};

export type CreateAttachmentRecordResult = {
  id: string;
  storedPath: string;
  uploadedAt: string;
  /**
   * 견적서 칸 교체로 이 트랜잭션에서 첨부 휴지통에 간 옛 파일의 id(2026-09-15 Q2).
   * 견적서가 아닌 주인과, 빈 칸에 처음 올린 견적서 파일은 늘 빈 배열이다.
   */
  displacedAttachmentIds: string[];
};

// ─────────────────────────────────────────── 셋째 주인 — 견적서 (2026-09-15 Q2)

/** 견적서에 대한 판정이 막았을 때의 이유. */
export type QuoteAttachmentRejectionCode =
  /** 견적서가 없다 — 그 사이 영구 삭제됐다. */
  | "NOT_FOUND"
  /** 견적서가 휴지통에 있다. */
  | "QUOTE_IN_TRASH";

export const QUOTE_ATTACHMENT_NOT_FOUND_MESSAGE = "해당 견적서를 찾을 수 없습니다.";
export const QUOTE_ATTACHMENT_IN_TRASH_MESSAGE =
  "휴지통에 있는 견적서의 파일은 붙이거나 지우거나 되살릴 수 없습니다. 견적서를 먼저 되살려 주세요.";

/**
 * 같은 칸에 새 파일이 올라와 밀려난 옛 파일의 삭제 사유 칸 — **고정 문구다.** 사람이
 * 적는 사유와도, 견적서를 지울 때 함께 휴지통에 간 파일의 사유
 * (attachment-trash.ts 의 QUOTE_DELETED_ATTACHMENT_REASON)와도 다르다. 견적서를
 * 되살릴 때 이 사유의 파일은 돌려보내지 않는다(파일 헤더의 '셋째 주인').
 */
export const QUOTE_ATTACHMENT_REPLACED_REASON = "견적서 첨부 교체 — 같은 칸에 새 파일";

/**
 * createAttachmentRecord 가 견적서의 판정에 막혔을 때 던진다. 반환값이 아니라 예외인
 * 까닭은 앞의 두 주인에 이 판정이 없어서다 — 반환 타입을 갈래로 바꾸면 그 두 통로까지
 * 고쳐야 한다.
 * 트랜잭션이 되돌려져 행도 감사도 밀려난 파일의 휴지통 표시도 남지 않는다. 라우트는
 * 코드별 상태(404 · 409)와 `message` 를 돌려주고 방금 놓은 파일을 치운다.
 */
export class QuoteAttachmentRejectedError extends Error {
  readonly code: QuoteAttachmentRejectionCode;

  constructor(code: QuoteAttachmentRejectionCode, message: string) {
    super(message);
    this.name = "QuoteAttachmentRejectedError";
    this.code = code;
  }
}

export type QuoteAttachmentGuardResult =
  | { ok: true; quote: { id: string; quoteNumber: string } }
  | { ok: false; code: QuoteAttachmentRejectionCode; message: string };

/**
 * 견적서의 첨부를 바꿔도 되는가 — **부르는 쪽의 트랜잭션 안에서** 견적서 행을
 * `FOR UPDATE` 로 잠그고 판정한다. 올리기(createAttachmentRecord) · 지우기 · 되살리기
 * (attachment-trash.ts)가 모두 이것 하나를 부른다.
 *
 * 이 잠금이 두 가지를 줄 세운다:
 *  - **칸 교체** — 같은 견적서에 동시에 올린 파일들은 여기서 기다리고, 뒤에 온 쪽은
 *    앞의 것이 넣은 행을 보고 밀어낸다(READ COMMITTED — 문장마다 새 스냅숏). 그래서
 *    칸마다 살아 있는 파일은 늘 하나다.
 *  - **견적서 휴지통** — softDeleteQuote · restoreQuote · permanentlyDeleteQuote 도 같은
 *    행을 먼저 잠근다(quote-trash.ts). 휴지통으로 가는 견적서에 한 장이 끼어들거나,
 *    휴지통의 견적서에 파일이 되살아나는 틈이 없다.
 *
 * ⚠️ 잠금은 `id` 로만 좁힌다. is_deleted 로 좁히면 휴지통의
 * 견적서를 「없음」으로 오판하고, 그 행은 잠그지도 못한다.
 */
export async function guardQuoteAttachmentChange(tx: Tx, quoteId: string): Promise<QuoteAttachmentGuardResult> {
  const [quote] = await tx
    .select({ id: quotes.id, quoteNumber: quotes.quoteNumber, isDeleted: quotes.isDeleted })
    .from(quotes)
    .where(eq(quotes.id, quoteId))
    .for("update");

  if (!quote) return { ok: false, code: "NOT_FOUND", message: QUOTE_ATTACHMENT_NOT_FOUND_MESSAGE };
  if (quote.isDeleted) return { ok: false, code: "QUOTE_IN_TRASH", message: QUOTE_ATTACHMENT_IN_TRASH_MESSAGE };
  return { ok: true, quote: { id: quote.id, quoteNumber: quote.quoteNumber } };
}

/**
 * 같은 칸의 살아 있는 옛 파일을 첨부 휴지통으로 보낸다 — **부르는 쪽의 트랜잭션 안에서,
 * 견적서 행을 잠근 뒤에.** 소프트 삭제 네 칸 + 파일마다 FILE_DELETE 감사 한 줄. 디스크
 * 실물은 건드리지 않는다. 실제로 휴지통에 간 id 를 돌려준다.
 *
 * 누구를 밀어낼지는 순수 함수(quoteAttachmentIdsDisplacedBy)가 정한다 — 같은 칸이고
 * 휴지통에 없는 것. 다른 칸의 파일과 이미 휴지통에 있는 파일은 그대로다.
 */
async function trashDisplacedQuoteAttachments(
  tx: Tx,
  params: {
    quoteId: string;
    category: AttachmentCategory;
    replacedByAttachmentId: string;
    actorUserId: string;
  }
): Promise<string[]> {
  if (!isQuoteAttachmentSlotCategory(params.category)) return [];

  const existing = await tx
    .select({ id: attachments.id, category: attachments.category, isDeleted: attachments.isDeleted })
    .from(attachments)
    .where(and(eq(attachments.quoteId, params.quoteId), eq(attachments.isDeleted, false)));
  const displacedIds = quoteAttachmentIdsDisplacedBy(existing, params.category);
  if (displacedIds.length === 0) return [];

  const deletedAt = new Date();
  const updated = await tx
    .update(attachments)
    .set({
      isDeleted: true,
      deletedAt,
      deletedBy: params.actorUserId,
      deleteReason: QUOTE_ATTACHMENT_REPLACED_REASON,
    })
    .where(and(inArray(attachments.id, displacedIds), eq(attachments.isDeleted, false)))
    .returning({ id: attachments.id });
  const updatedIds = new Set(updated.map((row) => row.id));
  const trashed = displacedIds.filter((id) => updatedIds.has(id));

  for (const id of trashed) {
    await insertAuditLog(tx, {
      actorUserId: params.actorUserId,
      actionType: "FILE_DELETE",
      targetEntity: "attachments",
      targetRecordId: id,
      previousValue: { isDeleted: false },
      newValue: {
        isDeleted: true,
        deletedAt: deletedAt.toISOString(),
        deleteReason: QUOTE_ATTACHMENT_REPLACED_REASON,
        // attachment-trash.ts 의 ownerAuditFields 와 같은 모양 — 주인을 먼저 적고 그 키만.
        ownerType: "QUOTE",
        quoteId: params.quoteId,
        category: params.category,
        // 무엇이 이 파일을 밀어냈는가 — 같은 트랜잭션의 FILE_UPLOAD 줄과 짝을 이룬다.
        replacedByAttachmentId: params.replacedByAttachmentId,
        storedFileRetained: true,
      },
    });
  }

  return trashed;
}

/** 감사 기록에 싣는 주인 — 어느 주인인지를 먼저 적고 그 주인의 ID **만** 싣는다. */
function ownerAuditValue(owner: AttachmentOwnerInput): Record<string, unknown> {
  switch (owner.kind) {
    case "REPAIR_CASE":
      return { ownerType: owner.kind, repairCaseId: owner.repairCaseId };
    case "PRODUCT_MODEL":
      return { ownerType: owner.kind, productModelId: owner.productModelId };
    case "QUOTE":
      return { ownerType: owner.kind, quoteId: owner.quoteId };
  }
}

export async function createAttachmentRecord(
  input: CreateAttachmentRecordInput
): Promise<CreateAttachmentRecordResult> {
  // 마지막 방어선. 여기까지 온 값은 buildAttachmentStoredPath가 만든 것이지만,
  // 이 함수만 따로 불려도 옮길 수 없는 경로가 표에 들어가지는 않아야 한다.
  assertPortableStoredPath(input.storedPath);

  const { owner } = input;

  // 분류와 주인의 짝 — 파일 헤더의 '셋째 주인만 ...' 둘째 문단. 올리기 통로들이
  // 먼저 400 으로 거절하므로 여기까지 오는 것은 통로를 거치지 않은 호출뿐이다.
  // 견적서에는 결재 PDF · 수기 엑셀 두 칸만, 그 두 칸은 견적서에만 붙는다.
  if (!isAttachmentCategoryAllowedForOwner(input.category, owner.kind)) {
    throw new Error(`'${input.category}' 분류는 이 주인(${owner.kind})의 첨부에 쓸 수 없습니다.`);
  }

  return db.transaction(async (tx) => {
    let displacedAttachmentIds: string[] = [];

    if (owner.kind === "QUOTE") {
      // 견적서 행을 잠그고 판정 — 있는가 · 휴지통이 아닌가(파일 헤더의 '셋째 주인').
      const guard = await guardQuoteAttachmentChange(tx, owner.quoteId);
      if (!guard.ok) {
        throw new QuoteAttachmentRejectedError(guard.code, guard.message);
      }
      // 같은 잠금 안에서 같은 칸의 옛 파일을 첨부 휴지통으로 — 새 행을 넣기 **전에**.
      displacedAttachmentIds = await trashDisplacedQuoteAttachments(tx, {
        quoteId: owner.quoteId,
        category: input.category,
        replacedByAttachmentId: input.id,
        actorUserId: input.uploadedBy,
      });
    }

    const [row] = await tx
      .insert(attachments)
      .values({
        id: input.id,
        // 주인이 아닌 쪽은 언제나 NULL이다. 세 컬럼을 판별자 하나에서 함께
        // 계산하므로 "둘 이상 찬 행"은 이 코드로는 만들어지지 않는다.
        repairCaseId: owner.kind === "REPAIR_CASE" ? owner.repairCaseId : null,
        productModelId: owner.kind === "PRODUCT_MODEL" ? owner.productModelId : null,
        quoteId: owner.kind === "QUOTE" ? owner.quoteId : null,
        category: input.category,
        originalFileName: input.originalFileName,
        storedPath: input.storedPath,
        // 미리보기는 브라우저가 따로 만들어 보낸다(api/attachments/[id]/preview).
        // 행이 생기는 순간에는 늘 NULL이다.
        previewPath: null,
        mimeType: input.mimeType,
        fileSize: input.fileSize,
        checksumSha256: input.checksumSha256,
        // 검사 엔진이 없으므로 모든 행이 '미검사'로 시작한다. 그것이
        // "검사하지 않았다"는 사실의 기록이다(attachment-category.ts 주석).
        malwareScanStatus: DEFAULT_MALWARE_SCAN_STATUS,
        description: input.description,
        uploadedBy: input.uploadedBy,
      })
      .returning({ id: attachments.id, storedPath: attachments.storedPath, uploadedAt: attachments.uploadedAt });

    await insertAuditLog(tx, {
      actorUserId: input.uploadedBy,
      actionType: "FILE_UPLOAD",
      targetEntity: "attachments",
      targetRecordId: row.id,
      // previousValue는 없다 — 새로 생긴 파일이라 이전 상태가 존재하지 않는다.
      newValue: {
        // 어느 주인인지를 먼저 적고, 그 주인의 ID **만** 싣는다. 키를 늘 함께
        // 실으면 모델 첨부의 기록에 `repairCaseId: null`이 남고, 나중에 그 줄만
        // 읽는 사람은 무슨 파일이었는지 알 수 없다.
        ...ownerAuditValue(owner),
        category: input.category,
        // 원본 파일명은 사람이 자유롭게 적는 값이라 고객사명이 섞일 수 있다
        // (schema/attachments.ts의 PII 주석). 그래도 여기에는 남긴다 —
        // 감사 기록에서 "무슨 파일이 들어왔는지"를 뺄 수는 없기 때문이다.
        // 밖으로 내보내는 로그·오류 응답에 그대로 싣지 않는 것이 그 주석의 뜻이다.
        originalFileName: input.originalFileName,
        storedPath: input.storedPath,
        mimeType: input.mimeType,
        fileSize: input.fileSize,
        checksumSha256: input.checksumSha256,
        // 견적서 칸 교체로 밀려난 옛 파일(없으면 빈 배열). 다른 주인의 기록 모양은 그대로다.
        ...(owner.kind === "QUOTE" ? { displacedAttachmentIds } : {}),
      },
    });

    return {
      id: row.id,
      storedPath: row.storedPath,
      uploadedAt: row.uploadedAt.toISOString(),
      displacedAttachmentIds,
    };
  });
}
