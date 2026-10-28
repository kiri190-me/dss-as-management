import "server-only";

import { and, eq } from "drizzle-orm";
import { db } from "../connection";
import { attachments, productModels, quotes, repairCases } from "../schema";
import { guardQuoteAttachmentChange } from "./attachments";
import { ownerAuditFields } from "./attachment-trash";
import { insertAuditLog } from "./audit-logs";
import { describeOrientation, type ImageOrientation } from "@/lib/domain/image-orientation";

/**
 * ============================================================================
 * 돌린 사진을 원본에 저장한 것을 기록한다 — 파일은 이미 바뀐 뒤에 불린다
 * ============================================================================
 * **이 함수는 파일을 쓰지 않는다.** 부르는 쪽(rotation 라우트)이 두 덩어리를 다
 * 받아 검사하고, 옛 파일을 치운 뒤 새 파일을 놓고 나서 부른다
 * (storage/attachment-file-swap.ts). 업로드와 같은 차례다 — **파일이 먼저,
 * 기록이 나중.** 다른 것은 하나뿐이다: 여기서 실패하면 부르는 쪽이 파일을
 * **되돌린다**(옛 파일을 지우지 않고 치워 두었기 때문에 되돌릴 수 있다).
 *
 * ── 🔴 그 사이 바뀌었는가 — 체크섬으로 잠근다 ────────────────────────────
 * 사람이 화면에서 사진을 열고, 돌리고, 확인 창을 읽고 누르기까지 시간이 걸린다.
 * 그동안 다른 사람이 같은 파일을 돌렸다면 지금 디스크에 있는 것은 이 사람이 본
 * 그 파일이 아니다. 그래서 갱신을 `checksum_sha256 = 이 사람이 본 값` 으로
 * 좁힌다 — 0행이면 CHANGED 로 거절하고 부르는 쪽이 파일을 되돌린다.
 * 이것을 빠뜨리면 **뒤에 누른 사람이 앞사람의 결과를 소리 없이 지운다.**
 *
 * ── 크기와 체크섬을 반드시 함께 고친다 ───────────────────────────────────
 * 내려받기 응답이 `Content-Length` 를 **DB 의 file_size 로** 붙인다
 * (api/attachments/[id]/download/route.ts). 돌린 파일은 크기가 달라지므로 이 칸을
 * 안 고치면 그다음부터 원본이 잘려 나가거나 브라우저가 그리다 만다.
 *
 * ── 잠긴 건 · 휴지통 — 지우기와 같은 문 ──────────────────────────────────
 * 2026-10-28 전까지 이 자리에 이렇게 적혀 있었고, 코드도 그대로였다:
 *
 *   「출하 완료로 잠긴 접수 건의 파일은 올리지도 지우지도 못한다. 원본을 덮어쓰는
 *    것은 그보다 더한 일이라 같은 기준으로 막는다.」
 *
 * 같은 날 아침에 올리기 · 휴지통행 · 되살리기 셋이 그 잠금에서 풀렸고, 그러자
 * **같은 탭에서 같은 파일을 다루는 조작 가운데 회전 저장 하나만 막히는** 모양이
 * 남았다. 사용자가 그것을 보고 정했다 — 「**같은 탭인데 하나만 막히면 이상하다**」
 * (2026-10-28). 그래서 접수 건 잠금 판정이 여기서도 빠졌다.
 *
 * 🔴 **잃는 것이 앞의 셋보다 크다. 사용자가 그 점을 알고 골랐다.** 회전 저장은
 * **원본을 덮어쓴다**(이 파일 맨 위 · 라우트 머리말의 「되돌릴 수 없다」). 올리기는
 * 파일이 하나 느는 일이고 휴지통행은 되살릴 수 있지만, 이쪽은 **되돌릴 수 없다** —
 * 출하가 끝난 건의 증거 사진이 바뀔 수 있고, 바뀌기 전 바이트는 어디에도 남지
 * 않는다. 남는 것은 감사 한 줄(UPDATE)뿐이고, 그 줄은 **무엇이 어떻게 바뀌었는지**
 * (방향 · 전후 크기 · 전후 체크섬)를 적지만 옛 그림 자체를 돌려주지는 못한다.
 *
 * 🔴 **함께 풀린 것은 없다.** 바로 아래 두 문은 그대로다 — 휴지통에 있는 파일은
 * 여전히 못 바꾸고(DELETED), 견적서 파일은 견적서 행을 잠그고 본다
 * (guardQuoteAttachmentChange — 올리기·지우기와 **같은 함수**다). 그리고 「그 사이
 * 바뀌었는가」(위 🔴 CHANGED)는 이 파일에서 가장 중요한 잠금인데, 잠금이 풀린 뒤로는
 * **출하된 건에서도 그 경합이 일어날 수 있다** — 더 중요해졌지 느슨해지지 않았다.
 *
 * ── 감사는 UPDATE 다 ─────────────────────────────────────────────────────
 * ⚠️ 이 저장소의 감사 종류(vendor/dss-core 의 audit_log_action_type)에는
 * `FILE_CHANGED` 가 **없다.** 새로 만들려면 pgEnum 을 넓히는 마이그레이션이
 * 필요하고, 그것은 이 작업의 범위 밖이다. 기존 종류 중 뜻이 맞는 것은 `UPDATE`
 * 다 — 첨부 행의 내용이 바뀐 일이고, 파일이 새로 들어오거나(FILE_UPLOAD)
 * 없어진(FILE_DELETE) 것이 아니다.
 *
 * 무엇이 바뀌었는지는 값으로 남긴다: **어느 방향으로 돌렸는지**(사람이 읽는 말),
 * 바뀌기 전후의 크기와 체크섬, 그리고 썸네일도 함께 바뀌었다는 사실. 원본
 * 파일명은 FILE_UPLOAD · FILE_DOWNLOAD 와 같은 대접으로 싣는다 — 무슨 파일이
 * 바뀌었는지 알 수 없으면 기록의 뜻이 없다(schema/attachments.ts 의 PII 주석은
 * **밖으로 내보내는 로그·오류 응답**에 싣지 말라는 뜻이다).
 * ============================================================================
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type AttachmentRotationFailureCode =
  | "INVALID_ID"
  | "NOT_FOUND"
  | "DELETED"
  // 🔴 "CASE_LOCKED" 가 여기 없는 것은 빠뜨린 것이 아니다 — 2026-10-28 에 뺐다
  //    (머리말의 「잠긴 건 · 휴지통」). 휴지통 · 견적서 두 코드는 그대로다.
  | "QUOTE_IN_TRASH"
  /** 읽은 뒤 저장하기까지 사이에 파일이 바뀌었다(위 🔴). */
  | "CHANGED";

export type AttachmentRotationResult =
  | { ok: true; id: string }
  | { ok: false; code: AttachmentRotationFailureCode; message: string };

export const ATTACHMENT_ROTATION_CHANGED_MESSAGE =
  "그 사이 이 파일이 바뀌었습니다. 화면을 새로 고친 뒤 다시 시도해 주세요.";

export async function recordAttachmentRotation(params: {
  attachmentId: string;
  actorUserId: string;
  /** 화면에서 돌린 그대로. 감사 기록에 사람이 읽는 말로 남는다. */
  orientation: ImageOrientation;
  /** 화면이 열었을 때의 값 — 이 값으로 갱신을 잠근다. */
  previous: { fileSize: number; checksumSha256: string; previewPath: string | null };
  /** 방금 디스크에 놓은 것. */
  next: { fileSize: number; checksumSha256: string; previewPath: string };
}): Promise<AttachmentRotationResult> {
  if (!UUID_PATTERN.test(params.attachmentId)) {
    return { ok: false, code: "INVALID_ID", message: "파일을 확인할 수 없습니다." };
  }

  return db.transaction(async (tx): Promise<AttachmentRotationResult> => {
    const [current] = await tx
      .select({
        id: attachments.id,
        repairCaseId: attachments.repairCaseId,
        productModelId: attachments.productModelId,
        quoteId: attachments.quoteId,
        originalFileName: attachments.originalFileName,
        category: attachments.category,
        isDeleted: attachments.isDeleted,
        checksumSha256: attachments.checksumSha256,
        // 접수 건 조인은 감사에 실을 접수번호 **하나** 때문에 남아 있다. 잠금
        // (is_locked)은 2026-10-28 에 더는 보지 않게 되어 읽지 않는다 — 쓰지 않을
        // 값을 읽어 두면 다음 사람이 「어딘가에서 보고 있다」고 읽는다.
        caseIntakeNumber: repairCases.intakeNumber,
        productModelName: productModels.modelName,
        quoteNumber: quotes.quoteNumber,
      })
      .from(attachments)
      .leftJoin(repairCases, eq(repairCases.id, attachments.repairCaseId))
      .leftJoin(productModels, eq(productModels.id, attachments.productModelId))
      .leftJoin(quotes, eq(quotes.id, attachments.quoteId))
      .where(eq(attachments.id, params.attachmentId))
      .limit(1);

    if (!current) return { ok: false, code: "NOT_FOUND", message: "파일을 찾을 수 없습니다." };
    if (current.isDeleted) {
      return {
        ok: false,
        code: "DELETED",
        message: "휴지통에 있는 파일은 바꿀 수 없습니다. 복원한 뒤 다시 시도해 주세요.",
      };
    }
    // 🔴 출하 완료로 잠긴 건이어도 여기서 막지 않는다(2026-10-28 — 머리말).

    // 견적서 파일이면 견적서 행을 잠그고 본다 — 올리기 · 지우기와 같은 함수다.
    if (current.quoteId !== null) {
      const guard = await guardQuoteAttachmentChange(tx, current.quoteId);
      if (!guard.ok) {
        if (guard.code === "NOT_FOUND") {
          return { ok: false, code: "NOT_FOUND", message: "파일을 찾을 수 없습니다." };
        }
        return { ok: false, code: "QUOTE_IN_TRASH", message: guard.message };
      }
    }

    // 🔴 이 사람이 본 그 파일일 때만 고친다(파일 헤더의 '그 사이 바뀌었는가').
    const updated = await tx
      .update(attachments)
      .set({
        fileSize: params.next.fileSize,
        checksumSha256: params.next.checksumSha256,
        previewPath: params.next.previewPath,
      })
      .where(
        and(
          eq(attachments.id, params.attachmentId),
          eq(attachments.isDeleted, false),
          eq(attachments.checksumSha256, params.previous.checksumSha256)
        )
      )
      .returning({ id: attachments.id });

    if (updated.length === 0) {
      return { ok: false, code: "CHANGED", message: ATTACHMENT_ROTATION_CHANGED_MESSAGE };
    }

    await insertAuditLog(tx, {
      actorUserId: params.actorUserId,
      actionType: "UPDATE",
      targetEntity: "attachments",
      targetRecordId: params.attachmentId,
      previousValue: {
        fileSize: params.previous.fileSize,
        checksumSha256: params.previous.checksumSha256,
        previewPath: params.previous.previewPath,
      },
      newValue: {
        ...ownerAuditFields({
          repairCaseId: current.repairCaseId,
          productModelId: current.productModelId,
          quoteId: current.quoteId,
          intakeNumber: current.caseIntakeNumber,
          modelName: current.productModelName,
          quoteNumber: current.quoteNumber,
        }),
        category: current.category,
        originalFileName: current.originalFileName,
        // 무엇을 한 것인가 — 이 한 줄이 기록의 알맹이다.
        change: "IMAGE_ORIENTATION",
        orientation: describeOrientation(params.orientation),
        rotate: params.orientation.rotate,
        flipX: params.orientation.flipX,
        flipY: params.orientation.flipY,
        fileSize: params.next.fileSize,
        checksumSha256: params.next.checksumSha256,
        previewPath: params.next.previewPath,
        // 🔴 원본만 바뀌는 길이 없다는 사실을 기록에도 남긴다.
        previewReplaced: true,
        // 덮어썼다 — 옛 내용은 남아 있지 않다(사용자 결정 2026-09-29).
        originalOverwritten: true,
      },
    });

    return { ok: true, id: params.attachmentId };
  });
}
