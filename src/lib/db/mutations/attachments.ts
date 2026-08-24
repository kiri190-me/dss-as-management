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
 * ============================================================================
 */

export type CreateAttachmentRecordInput = {
  /** 디스크 경로를 이미 이 값으로 만들었다. 위 'id를 밖에서 받는다' 참조. */
  id: string;
  repairCaseId: string;
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

  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(attachments)
      .values({
        id: input.id,
        repairCaseId: input.repairCaseId,
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
        repairCaseId: input.repairCaseId,
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
