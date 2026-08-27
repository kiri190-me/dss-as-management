import "server-only";

import { db } from "../client";
import { attachments } from "../schema";
import { insertAuditLog } from "./audit-logs";
import { DEFAULT_MALWARE_SCAN_STATUS, type AttachmentCategory } from "@/lib/domain/attachment-category";
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
 * ── 주인은 둘 중 하나다 — 그것을 타입으로도 세운다 ───────────────────────
 * DB에는 attachments_owner_not_both CHECK가 있다(schema/attachments.ts).
 * "접수 건과 모델에 동시에 걸린 파일"은 어느 폴더에 사는지가 정해지지 않는
 * 모순이라 DB가 직접 막는다. 이 함수의 입력도 **같은 규칙을 타입으로** 세워서,
 * 그 모순을 만드는 코드가 애초에 컴파일되지 않게 한다 — DB가 던지는 것은
 * 마지막 방어선이지 첫 번째 방어선이 아니다(AttachmentOwnerInput 주석 참조).
 * ============================================================================
 */

/**
 * 이 첨부가 누구에게 붙는가. **둘 중 하나만 올 수 있다.**
 *
 * 선택 필드 둘(`repairCaseId?` · `productModelId?`)로 두지 않은 것이 요점이다.
 * 그렇게 두면 둘 다 채운 값이 타입을 통과하고, 그 모순은 DB의 CHECK가 던질
 * 때까지 — 즉 **파일을 이미 디스크에 놓은 뒤에야** 드러난다. 그 시점의 실패는
 * 주인 없는 파일을 남긴다.
 *
 * 판별자(`kind`)를 둔 것도 같은 이유다. 판별자가 없으면 "둘 다 비어 있는" 값이
 * 표현 가능해지고, 그때 어느 컬럼을 채울지 정할 수 없다. 여기서는 kind가
 * 정해지는 순간 채울 컬럼과 비울 컬럼이 함께 정해진다.
 */
export type AttachmentOwnerInput =
  | { kind: "REPAIR_CASE"; repairCaseId: string }
  | { kind: "PRODUCT_MODEL"; productModelId: string };

export type CreateAttachmentRecordInput = {
  /** 디스크 경로를 이미 이 값으로 만들었다. 위 'id를 밖에서 받는다' 참조. */
  id: string;
  /** 접수 건이거나 제품 모델이거나 — 둘 다는 타입이 허용하지 않는다. */
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

export async function createAttachmentRecord(
  input: CreateAttachmentRecordInput
): Promise<CreateAttachmentRecordResult> {
  // 마지막 방어선. 여기까지 온 값은 buildAttachmentStoredPath가 만든 것이지만,
  // 이 함수만 따로 불려도 옮길 수 없는 경로가 표에 들어가지는 않아야 한다.
  assertPortableStoredPath(input.storedPath);

  const { owner } = input;

  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(attachments)
      .values({
        id: input.id,
        // 주인이 아닌 쪽은 언제나 NULL이다. 두 컬럼을 판별자 하나에서 함께
        // 계산하므로 "둘 다 찬 행"은 이 코드로는 만들어지지 않는다.
        repairCaseId: owner.kind === "REPAIR_CASE" ? owner.repairCaseId : null,
        productModelId: owner.kind === "PRODUCT_MODEL" ? owner.productModelId : null,
        category: input.category,
        originalFileName: input.originalFileName,
        storedPath: input.storedPath,
        // 미리보기 생성기는 아직 없다(4단계). 자리만 있고 값은 늘 NULL이다.
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
        // 어느 주인인지를 먼저 적고, 그 주인의 ID **만** 싣는다. 두 키를 늘
        // 함께 실으면 모델 첨부의 기록에 `repairCaseId: null`이 남고, 나중에
        // 그 줄만 읽는 사람은 무슨 파일이었는지 알 수 없다.
        ownerType: owner.kind,
        ...(owner.kind === "REPAIR_CASE"
          ? { repairCaseId: owner.repairCaseId }
          : { productModelId: owner.productModelId }),
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
