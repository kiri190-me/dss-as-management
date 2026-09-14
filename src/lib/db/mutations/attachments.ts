import "server-only";

import { and, count, eq } from "drizzle-orm";
import { db } from "../client";
import { attachments, improvementRequests } from "../schema";
import { insertAuditLog } from "./audit-logs";
import {
  DEFAULT_MALWARE_SCAN_STATUS,
  isAttachmentCategoryAllowedForOwner,
  type AttachmentCategory,
} from "@/lib/domain/attachment-category";
import { assertPortableStoredPath } from "@/lib/domain/attachment-path";
import {
  IMPROVEMENT_REQUEST_SCREENSHOT_FORBIDDEN_MESSAGE,
  IMPROVEMENT_REQUEST_SCREENSHOT_LIMIT_MESSAGE,
  canChangeImprovementRequestScreenshots,
  hasImprovementRequestScreenshotRoom,
  type ImprovementRequestStatus,
} from "@/lib/domain/improvement-request";

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
 * DB에는 attachments_owner_not_both · attachments_improvement_owner_alone CHECK가
 * 있다(schema/attachments.ts). "두 주인에 동시에 걸린 파일"은 어느 폴더에 사는지가
 * 정해지지 않는 모순이라 DB가 직접 막는다. 이 함수의 입력도 **같은 규칙을 타입으로**
 * 세워서, 그 모순을 만드는 코드가 애초에 컴파일되지 않게 한다 — DB가 던지는 것은
 * 마지막 방어선이지 첫 번째 방어선이 아니다(AttachmentOwnerInput 주석 참조).
 *
 * ── 셋째 주인(개선 요청)만 트랜잭션 안에서 한 번 더 본다 (2026-09-13) ─────
 * 개선 요청 글에는 스크린샷이 **5장까지**만 붙고, 붙이는 사람은 접수 상태인 자기
 * 글의 글쓴이 또는 관리 권한자다. 둘 다 **글 행을 잠근 같은 트랜잭션에서** 판정한다
 * (guardImprovementRequestAttachmentChange). 잠그지 않고 세면 동시에 올린 두 장이
 * 둘 다 「네 장뿐」을 보고 들어가 여섯 장이 된다. 잠금은 글 행 하나이고, 같은 글에
 * 붙이는 트랜잭션끼리만 줄을 선다.
 *
 * 앞의 두 주인은 이 판정을 거치지 않는다 — 예전 동작 그대로다. 달라진 것은 분류와
 * 주인의 짝(isAttachmentCategoryAllowedForOwner)을 트랜잭션 **전에** 한 번 보는 것
 * 하나다: 「스크린샷」 분류는 개선 요청에만, 개선 요청에는 「스크린샷」만. 두 올리기
 * 통로가 이미 400 으로 거절하므로 이것은 마지막 방어선이다.
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
  | {
      kind: "IMPROVEMENT_REQUEST";
      improvementRequestId: string;
      /**
       * improvementRequests MANAGE — 서버(라우트)가 hasPermission 으로 계산해 넘긴다.
       * 거짓이면 접수 상태인 자기 글에만 붙는다. 역할·관리자 설정은 이 파일이 보지
       * 않는다(mutations/improvement-requests.ts 헤더와 같은 나눔).
       */
      canManage: boolean;
    };

export type CreateAttachmentRecordInput = {
  /** 디스크 경로를 이미 이 값으로 만들었다. 위 'id를 밖에서 받는다' 참조. */
  id: string;
  /** 접수 건 · 제품 모델 · 개선 요청 중 하나 — 둘 이상은 타입이 허용하지 않는다. */
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
};

/** 개선 요청 글에 대한 판정이 막았을 때의 이유. */
export type ImprovementRequestAttachmentRejectionCode =
  /** 글이 없다 — 그 사이 지워졌다. */
  | "NOT_FOUND"
  /** 접수 상태인 자기 글이 아니고 관리 권한도 없다. */
  | "FORBIDDEN"
  /** 이미 5장이 붙어 있다. */
  | "LIMIT_REACHED";

/**
 * createAttachmentRecord 가 개선 요청 글의 판정에 막혔을 때 던진다. 던지므로
 * 트랜잭션은 되돌려지고 행도 감사 로그도 남지 않는다. 라우트는 이것을 잡아 코드별
 * 상태(404 · 403 · 409)와 `message` 를 돌려주고, 방금 놓은 파일을 치운다.
 *
 * 반환값이 아니라 예외인 까닭: 앞의 두 주인은 이 판정이 없고, 반환 타입을 갈래로
 * 바꾸면 그 두 통로까지 고쳐야 한다(기존 동작을 바꾸지 않는다).
 */
export class ImprovementRequestAttachmentRejectedError extends Error {
  readonly code: ImprovementRequestAttachmentRejectionCode;

  constructor(code: ImprovementRequestAttachmentRejectionCode, message: string) {
    super(message);
    this.name = "ImprovementRequestAttachmentRejectedError";
    this.code = code;
  }
}

export type ImprovementRequestAttachmentGuardResult =
  | { ok: true }
  | { ok: false; code: ImprovementRequestAttachmentRejectionCode; message: string };

const IMPROVEMENT_REQUEST_NOT_FOUND_MESSAGE = "해당 개선 요청을 찾을 수 없습니다.";

/**
 * 개선 요청 글의 첨부를 바꿔도 되는가 — **부르는 쪽의 트랜잭션 안에서** 글 행을
 * 잠그고 판정한다. 붙이기(올리기 · 되살리기)는 `adding: true` 로 5장 상한까지 본다.
 *
 * 올리기(createAttachmentRecord) · 지우기(softDeleteAttachment) · 되살리기
 * (restoreAttachment)가 모두 이것 하나를 부른다. 판정을 세 곳에 따로 적으면 한쪽만
 * 규칙이 바뀌는 날이 온다.
 *
 * ⚠️ 잠금은 `id` 로만 좁힌다 — 다른 조건으로 좁히면 남의 글까지 잠근다(개선 요청
 * mutation 의 lockImprovementRequest 와 같은 규율). 이 잠금이 5장 셈의 줄 세우기다:
 * 같은 글에 붙이는 트랜잭션은 앞의 것이 커밋할 때까지 여기서 기다리고, 그 뒤의 셈
 * (READ COMMITTED — 문장마다 새 스냅숏)은 앞의 것이 넣은 행을 본다. 글 삭제
 * (deleteImprovementRequest)도 같은 행을 먼저 잠그므로, 지워지는 글에 한 장이 끼어
 * 들어가지 않는다.
 *
 * 역할은 보지 않는다 — `canManage` 는 서버가 계산해 넘긴다.
 */
export async function guardImprovementRequestAttachmentChange(
  tx: Tx,
  params: {
    improvementRequestId: string;
    actorUserId: string;
    canManage: boolean;
    adding: boolean;
  }
): Promise<ImprovementRequestAttachmentGuardResult> {
  const [request] = await tx
    .select({
      id: improvementRequests.id,
      status: improvementRequests.status,
      createdBy: improvementRequests.createdBy,
    })
    .from(improvementRequests)
    .where(eq(improvementRequests.id, params.improvementRequestId))
    .for("update");

  if (!request) {
    return { ok: false, code: "NOT_FOUND", message: IMPROVEMENT_REQUEST_NOT_FOUND_MESSAGE };
  }

  const status: ImprovementRequestStatus = request.status;
  if (
    !canChangeImprovementRequestScreenshots({
      status,
      createdBy: request.createdBy,
      actorUserId: params.actorUserId,
      canManage: params.canManage,
    })
  ) {
    return { ok: false, code: "FORBIDDEN", message: IMPROVEMENT_REQUEST_SCREENSHOT_FORBIDDEN_MESSAGE };
  }

  if (params.adding) {
    // 목록 조회 · 올리기 통로의 빠른 거절과 **같은 정의**로 센다 — 그 글이 주인이고
    // 휴지통에 없는 첨부. 분류로 다시 거르지 않는다(queries/improvement-requests.ts 헤더).
    const [counted] = await tx
      .select({ value: count() })
      .from(attachments)
      .where(and(eq(attachments.improvementRequestId, request.id), eq(attachments.isDeleted, false)));
    if (!hasImprovementRequestScreenshotRoom(counted?.value ?? 0)) {
      return { ok: false, code: "LIMIT_REACHED", message: IMPROVEMENT_REQUEST_SCREENSHOT_LIMIT_MESSAGE };
    }
  }

  return { ok: true };
}

/** 감사 기록에 싣는 주인 — 어느 주인인지를 먼저 적고 그 주인의 ID **만** 싣는다. */
function ownerAuditValue(owner: AttachmentOwnerInput): Record<string, unknown> {
  switch (owner.kind) {
    case "REPAIR_CASE":
      return { ownerType: owner.kind, repairCaseId: owner.repairCaseId };
    case "PRODUCT_MODEL":
      return { ownerType: owner.kind, productModelId: owner.productModelId };
    case "IMPROVEMENT_REQUEST":
      return { ownerType: owner.kind, improvementRequestId: owner.improvementRequestId };
  }
}

export async function createAttachmentRecord(
  input: CreateAttachmentRecordInput
): Promise<CreateAttachmentRecordResult> {
  // 마지막 방어선. 여기까지 온 값은 buildAttachmentStoredPath가 만든 것이지만,
  // 이 함수만 따로 불려도 옮길 수 없는 경로가 표에 들어가지는 않아야 한다.
  assertPortableStoredPath(input.storedPath);

  const { owner } = input;

  // 분류와 주인의 짝 — 파일 헤더의 '셋째 주인만 ...' 둘째 문단. 두 올리기 통로가
  // 먼저 400 으로 거절하므로 여기까지 오는 것은 통로를 거치지 않은 호출뿐이다.
  if (!isAttachmentCategoryAllowedForOwner(input.category, owner.kind)) {
    throw new Error(`'${input.category}' 분류는 이 주인(${owner.kind})의 첨부에 쓸 수 없습니다.`);
  }

  return db.transaction(async (tx) => {
    if (owner.kind === "IMPROVEMENT_REQUEST") {
      // 글 행을 잠그고 판정 · 5장 셈 — 행을 넣기 **전에**, 같은 트랜잭션에서.
      const guard = await guardImprovementRequestAttachmentChange(tx, {
        improvementRequestId: owner.improvementRequestId,
        actorUserId: input.uploadedBy,
        canManage: owner.canManage,
        adding: true,
      });
      if (!guard.ok) {
        throw new ImprovementRequestAttachmentRejectedError(guard.code, guard.message);
      }
    }

    const [row] = await tx
      .insert(attachments)
      .values({
        id: input.id,
        // 주인이 아닌 쪽은 언제나 NULL이다. 세 컬럼을 판별자 하나에서 함께
        // 계산하므로 "둘 이상 찬 행"은 이 코드로는 만들어지지 않는다.
        repairCaseId: owner.kind === "REPAIR_CASE" ? owner.repairCaseId : null,
        productModelId: owner.kind === "PRODUCT_MODEL" ? owner.productModelId : null,
        improvementRequestId: owner.kind === "IMPROVEMENT_REQUEST" ? owner.improvementRequestId : null,
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
      },
    });

    return { id: row.id, storedPath: row.storedPath, uploadedAt: row.uploadedAt.toISOString() };
  });
}
