import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../client";
import {
  intakeMailRecipients,
  intakeMailSettings,
  intakeMailSignatureImages,
  users,
} from "../schema";
import { insertAuditLog } from "./audit-logs";
import { sanitizeSignatureHtml } from "@/lib/domain/mail-signature-html";
import type { IntakeMailSettingsInput } from "@/lib/validation/intake-mail-settings-input";

/**
 * 접수 알림 메일 설정 저장.
 *
 * 설정 한 줄과 수신자 목록을 **한 트랜잭션**으로 바꾼다. 나누면 "켜졌는데
 * 수신자는 예전 것" 같은 중간 상태가 잠깐 생기고, 하필 그때 접수가 들어오면
 * 엉뚱한 사람에게 메일이 나간다.
 */

export type SaveIntakeMailSettingsResult =
  | { ok: true }
  | { ok: false; code: "UNKNOWN_RECIPIENT"; message: string };

export async function saveIntakeMailSettings(params: {
  input: IntakeMailSettingsInput;
  actorUserId: string;
}): Promise<SaveIntakeMailSettingsResult> {
  const { input, actorUserId } = params;

  return db.transaction(async (tx) => {
    /*
     * 🔴 수신자를 DB 로 다시 확인한다 — 화면이 준 id 를 믿지 않는다.
     *
     * 승인 대기·삭제된 계정 id 를 실어 보내면 그대로 저장되고, 그 주소로
     * 고객사·S/N·증상이 나가게 된다. 조회가 후보를 걸러 주는 것은 화면
     * 편의일 뿐이고, 판정은 여기서 한 번 더 한다.
     */
    if (input.recipientUserIds.length > 0) {
      const found = await tx
        .select({ id: users.id })
        .from(users)
        .where(
          and(
            inArray(users.id, input.recipientUserIds),
            eq(users.approvalStatus, "APPROVED"),
            eq(users.isDeleted, false)
          )
        );
      if (found.length !== input.recipientUserIds.length) {
        return {
          ok: false as const,
          code: "UNKNOWN_RECIPIENT" as const,
          message:
            "고를 수 없는 계정이 수신자에 들어 있습니다(승인 대기이거나 삭제된 계정). 화면을 새로고침한 뒤 다시 저장해 주세요.",
        };
      }
    }

    const [existing] = await tx
      .select({ id: intakeMailSettings.id })
      .from(intakeMailSettings)
      .limit(1);

    const values = {
      isEnabled: input.isEnabled,
      subjectTemplate: input.subjectTemplate,
      // 🔴 정화는 여기서 한 번. 화면에서 오는 값은 붙여넣은 원문이고, 저장된
      // 값은 언제나 걸러진 것이어야 한다 — 그리는 자리마다 거르게 하면
      // 언젠가 한 곳을 빠뜨린다(domain/mail-signature-html.ts 주석).
      signatureHtml: sanitizeSignatureHtml(input.signatureHtml),
      introText: input.introText,
      outroText: input.outroText,
      updatedBy: actorUserId,
      updatedAt: new Date(),
    };

    let settingsId: string;
    if (existing) {
      await tx.update(intakeMailSettings).set(values).where(eq(intakeMailSettings.id, existing.id));
      settingsId = existing.id;
    } else {
      const [created] = await tx
        .insert(intakeMailSettings)
        .values({ ...values, singleton: true })
        .returning({ id: intakeMailSettings.id });
      settingsId = created.id;
    }

    // 수신자는 통째로 갈아 끼운다. 차이를 계산해 넣고 빼는 것보다 짧고,
    // 결과가 화면에서 고른 그대로임이 한눈에 보인다.
    await tx.delete(intakeMailRecipients);
    if (input.recipientUserIds.length > 0) {
      await tx.insert(intakeMailRecipients).values(
        input.recipientUserIds.map((userId) => ({ userId, addedBy: actorUserId }))
      );
    }

    await insertAuditLog(tx, {
      actorUserId,
      actionType: "UPDATE",
      targetEntity: "intake_mail_settings",
      targetRecordId: settingsId,
      // 문구 전문은 남기지 않는다 — 길고, 감사 로그가 읽기 어려워진다.
      // 되돌릴 때 필요한 것은 "켜졌는지"와 "몇 명이 받게 됐는지"다.
      newValue: {
        isEnabled: input.isEnabled,
        recipientCount: input.recipientUserIds.length,
      },
      previousValue: null,
    });

    return { ok: true as const };
  });
}

/**
 * 시험 메일을 보냈다는 사실을 남긴다.
 *
 * 표를 새로 만들지 않고 감사 로그에 적는다 — 남길 것이 "누가 언제 눌렀고
 * 됐는가" 한 줄뿐이라 자기 표를 가질 만큼이 아니다. 성공도 실패도 남기는
 * 이유는, 조용히 안 나가는 것이 이 기능에서 가장 위험한 상태이기 때문이다.
 *
 * 기록 자체가 실패해도 삼킨다 — 메일은 이미 나갔고, 로그를 못 남겼다고
 * 사용자에게 "실패"라고 말하면 그게 틀린 말이 된다.
 */
export async function recordTestMailAttempt(params: {
  actorUserId: string;
  ok: boolean;
  detail: string;
}): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      await insertAuditLog(tx, {
        actorUserId: params.actorUserId,
        actionType: "UPDATE",
        targetEntity: "intake_mail_test_send",
        // 이 조작에는 대상 행이 없다. 감사 로그의 target_record_id 는 NOT NULL
        // uuid 라, 누른 사람 자신을 대상으로 적는다 — "그가 자기에게 보냈다"가
        // 실제로 일어난 일이기도 하다.
        targetRecordId: params.actorUserId,
        newValue: { ok: params.ok, detail: params.detail },
        previousValue: null,
      });
    });
  } catch {
    // 무시한다(위 주석).
  }
}

/**
 * 서명 이미지 한 장을 넣는다.
 *
 * 같은 이름(cid)이 이미 있으면 **덮어쓴다.** 로고를 새 파일로 바꾸는 것이
 * 흔한 일인데, 그때마다 서명 HTML 의 `<img src="cid:...">` 를 같이 고치게
 * 하면 십중팔구 한쪽만 고쳐 그림이 깨진다.
 */
export async function upsertSignatureImage(params: {
  cid: string;
  fileName: string;
  mimeType: string;
  content: Buffer;
  actorUserId: string;
}): Promise<{ id: string }> {
  return db.transaction(async (tx) => {
    const values = {
      cid: params.cid,
      fileName: params.fileName,
      mimeType: params.mimeType,
      content: params.content,
      sizeBytes: params.content.length,
      uploadedBy: params.actorUserId,
    };

    const [row] = await tx
      .insert(intakeMailSignatureImages)
      .values(values)
      .onConflictDoUpdate({
        target: intakeMailSignatureImages.cid,
        set: {
          fileName: values.fileName,
          mimeType: values.mimeType,
          content: values.content,
          sizeBytes: values.sizeBytes,
          uploadedBy: values.uploadedBy,
        },
      })
      .returning({ id: intakeMailSignatureImages.id });

    await insertAuditLog(tx, {
      actorUserId: params.actorUserId,
      actionType: "FILE_UPLOAD",
      targetEntity: "intake_mail_signature_images",
      targetRecordId: row.id,
      // 바이트는 남기지 않는다 — 감사 로그가 그림 저장소가 되면 안 된다.
      newValue: { cid: values.cid, fileName: values.fileName, sizeBytes: values.sizeBytes },
      previousValue: null,
    });

    return { id: row.id };
  });
}

/** 서명 이미지를 지운다. 서명 HTML 이 아직 그 cid 를 가리키면 그림만 깨진다 — 화면이 미리 경고한다. */
export async function deleteSignatureImage(params: {
  id: string;
  actorUserId: string;
}): Promise<{ ok: boolean }> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .delete(intakeMailSignatureImages)
      .where(eq(intakeMailSignatureImages.id, params.id))
      .returning({ id: intakeMailSignatureImages.id, cid: intakeMailSignatureImages.cid });

    if (!row) return { ok: false };

    await insertAuditLog(tx, {
      actorUserId: params.actorUserId,
      actionType: "FILE_DELETE",
      targetEntity: "intake_mail_signature_images",
      targetRecordId: row.id,
      newValue: null,
      previousValue: { cid: row.cid },
    });

    return { ok: true };
  });
}
