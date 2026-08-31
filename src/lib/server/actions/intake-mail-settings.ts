"use server";

import { revalidatePath } from "next/cache";
import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { hasPermission } from "@/lib/auth/permission-resolver";
import { readSession } from "@/lib/auth/session";
import { getAuthSource } from "@/lib/config/auth-source";
import {
  deleteSignatureImage,
  recordTestMailAttempt,
  upsertSignatureImage,
  saveIntakeMailSettings,
} from "@/lib/db/mutations/intake-mail-settings";
import {
  getMyEmailAddress,
  getSignatureImagesByCids,
  listSignatureImages,
} from "@/lib/db/queries/intake-mail-settings";
import {
  composeIntakeMail,
  INTAKE_MAIL_PREVIEW_SAMPLE,
} from "@/lib/domain/intake-mail-body";
import { sendMail } from "@/lib/server/mail/send";
import {
  referencedCids,
  sanitizeSignatureHtml,
} from "@/lib/domain/mail-signature-html";
import {
  SIGNATURE_IMAGE_MAX_BYTES,
  SUBJECT_MAX,
  TEXT_MAX,
  validateIntakeMailSettingsInput,
  validateSignatureImage,
  type IntakeMailSettingsFieldErrors,
} from "@/lib/validation/intake-mail-settings-input";

/**
 * 접수 알림 메일 설정 저장.
 *
 * 다른 서버 액션과 같은 층위의 일만 한다: 모드 확인, 세션, 권한, 입력 검증.
 * 권한을 여기서 한 번, 페이지에서 또 한 번 본다 — 겹치지만 **전사원에게 나갈
 * 글과 수신자**를 바꾸는 조작이라 그 편이 맞다.
 */

const MAIL_SETTINGS_PATH = "/settings/mail";

export type SaveIntakeMailSettingsActionResult =
  | { ok: true; message: string }
  | { ok: false; message: string; fieldErrors?: IntakeMailSettingsFieldErrors };

export async function saveIntakeMailSettingsAction(
  raw: unknown
): Promise<SaveIntakeMailSettingsActionResult> {
  if (getAuthSource() !== "database") {
    return { ok: false, message: "데이터베이스 저장 모드가 아닙니다." };
  }

  const session = await readSession();
  if (!session) return { ok: false, message: "로그인이 필요합니다." };
  const actingUser = await resolveActingUserForSession(session);
  if (!actingUser) return { ok: false, message: "로그인이 필요합니다." };
  if (actingUser.approvalStatus !== "APPROVED") {
    return { ok: false, message: "계정이 아직 승인되지 않았습니다." };
  }
  if (!(await hasPermission(actingUser.role, "mailSettings", "MANAGE"))) {
    return { ok: false, message: "관리자 이상만 메일 설정을 바꿀 수 있습니다." };
  }

  const validation = validateIntakeMailSettingsInput(raw);
  if (!validation.ok) {
    return {
      ok: false,
      message: "입력을 확인해 주세요.",
      fieldErrors: validation.fieldErrors,
    };
  }

  const result = await saveIntakeMailSettings({
    input: validation.data,
    actorUserId: actingUser.id,
  });
  if (!result.ok) return { ok: false, message: result.message };

  revalidatePath(MAIL_SETTINGS_PATH);

  // 켜져 있는데 몇 명이 받는지는 저장할 때마다 확인시켜 준다 — 수신자를
  // 줄여 놓고 여전히 전원에게 간다고 믿는 상태를 만들지 않는다.
  const count = validation.data.recipientUserIds.length;
  return {
    ok: true,
    message: validation.data.isEnabled
      ? `저장했습니다. 자동 발송이 켜져 있고 수신자는 ${count}명입니다.`
      : `저장했습니다. 자동 발송은 꺼져 있습니다(수신자 ${count}명 저장됨).`,
  };
}

/**
 * 「시험 메일 보내기」 — **나에게만 한 통.**
 *
 * ■ 왜 수신자 목록으로 보내지 않는가
 *
 * 이 버튼의 목적은 "문구가 이렇게 보인다"를 실물로 확인하는 것이다. 수신자
 * 목록으로 보내면 그건 시험이 아니라 **전사원에게 나가는 진짜 발송**이고,
 * 문구를 고칠 때마다 스무 통씩 나가게 된다. 그래서 받는 사람은 언제나
 * **누른 사람 자신**이고, 화면이 주소를 정할 수 없다(세션에서 구한다).
 *
 * ■ 저장 전 값으로 보낸다
 *
 * 화면이 지금 편집 중인 문구를 그대로 받아 보낸다. 저장해야만 시험할 수
 * 있으면, 마음에 안 드는 문구를 일단 저장했다가 고치는 일이 반복된다.
 *
 * ■ 자료는 미리보기와 같은 예시값이다
 *
 * 실제 접수 건을 끌어오지 않는다 — 설정 화면은 문구를 고치는 자리이고,
 * 시험 메일에 진짜 고객사·S/N·증상이 실릴 이유가 없다.
 */
export async function sendTestIntakeMailAction(input: {
  subjectTemplate: string;
  introText: string;
  outroText: string;
  /** 편집 중인 서명 HTML. 저장하지 않고도 시험할 수 있게 화면이 그대로 보낸다. */
  signatureHtml?: string;
}): Promise<{ ok: boolean; message: string }> {
  if (getAuthSource() !== "database") {
    return { ok: false, message: "데이터베이스 저장 모드가 아닙니다." };
  }

  const session = await readSession();
  if (!session) return { ok: false, message: "로그인이 필요합니다." };
  const actingUser = await resolveActingUserForSession(session);
  if (!actingUser) return { ok: false, message: "로그인이 필요합니다." };
  if (actingUser.approvalStatus !== "APPROVED") {
    return { ok: false, message: "계정이 아직 승인되지 않았습니다." };
  }
  if (!(await hasPermission(actingUser.role, "mailSettings", "MANAGE"))) {
    return { ok: false, message: "관리자 이상만 시험 메일을 보낼 수 있습니다." };
  }

  const subjectTemplate = typeof input.subjectTemplate === "string" ? input.subjectTemplate.trim() : "";
  if (!subjectTemplate || subjectTemplate.length > SUBJECT_MAX) {
    return { ok: false, message: "제목 형식을 확인해 주세요." };
  }
  const introText = typeof input.introText === "string" ? input.introText.slice(0, TEXT_MAX) : "";
  const outroText = typeof input.outroText === "string" ? input.outroText.slice(0, TEXT_MAX) : "";

  const myEmail = await getMyEmailAddress(actingUser.id);
  if (!myEmail) {
    return { ok: false, message: "내 계정에 메일 주소가 없어 보낼 곳이 없습니다." };
  }

  // 화면이 편집 중인 서명을 그대로 받아 **여기서 정화한다** — 저장하지 않고도
  // 시험할 수 있어야 하므로 저장 경로의 정화를 거치지 않는다.
  const signature = sanitizeSignatureHtml(
    typeof input.signatureHtml === "string" ? input.signatureHtml : ""
  );

  const composed = composeIntakeMail({
    template: { subject: subjectTemplate, intro: introText, outro: outroText },
    signature,
    ...INTAKE_MAIL_PREVIEW_SAMPLE,
  });

  // 서명이 실제로 가리키는 그림만 동봉한다.
  const images = await getSignatureImagesByCids(referencedCids(signature));

  const result = await sendMail({
    to: [myEmail],
    // 받는 사람 메일함에서 진짜 접수 알림과 섞이지 않아야 한다 — 제목만 보고
    // 실제 접수가 들어온 줄 알면 그것부터가 사고다.
    subject: `[시험] ${composed.subject}`,
    text:
      `※ 이 메일은 메일 설정 화면에서 보낸 시험 메일입니다. 아래 내용은 예시값입니다.\n` +
      `※ 실제 접수가 아니며, 받는 사람은 보낸 사람 본인 한 명뿐입니다.\n\n` +
      `${composed.body}`,
    html:
      `<div style="font-family:'맑은 고딕','Malgun Gothic',sans-serif;font-size:13px;color:#a16207;` +
      `background:#fefce8;border:1px solid #fde68a;padding:10px 12px;margin-bottom:16px;">` +
      `※ 이 메일은 메일 설정 화면에서 보낸 <b>시험 메일</b>입니다. 아래 내용은 예시값이며, ` +
      `실제 접수가 아닙니다. 받는 사람은 보낸 사람 본인 한 명뿐입니다.</div>` +
      composed.html,
    attachments: images,
  });

  // 밖으로 나간 메일은 성공이든 실패든 기록을 남긴다 — 나중에 "그때 시험
  // 메일이 나갔었나"를 물을 수 있어야 한다.
  await recordTestMailAttempt({
    actorUserId: actingUser.id,
    ok: result.ok,
    detail: result.ok ? `수신 ${result.accepted}건` : result.message,
  });

  if (!result.ok) {
    return {
      ok: false,
      message:
        result.reason === "NOT_CONFIGURED"
          ? `메일 서버 설정이 아직 없습니다. ${result.message}`
          : `보내지 못했습니다: ${result.message}`,
    };
  }

  return { ok: true, message: `${myEmail} 으로 시험 메일을 보냈습니다. 받은 편지함을 확인해 주세요.` };
}

/**
 * 서명 이미지 올리기.
 *
 * FormData 로 받는 이유: 파일 바이트를 서버 액션 인자로 넘기려면 결국
 * FormData 이거나 base64 문자열인데, base64 는 33% 부풀고 그만큼이 그대로
 * 요청 본문에 실린다.
 */
export async function uploadSignatureImageAction(
  formData: FormData
): Promise<{ ok: boolean; message: string }> {
  if (getAuthSource() !== "database") {
    return { ok: false, message: "데이터베이스 저장 모드가 아닙니다." };
  }
  const session = await readSession();
  if (!session) return { ok: false, message: "로그인이 필요합니다." };
  const actingUser = await resolveActingUserForSession(session);
  if (!actingUser) return { ok: false, message: "로그인이 필요합니다." };
  if (actingUser.approvalStatus !== "APPROVED") {
    return { ok: false, message: "계정이 아직 승인되지 않았습니다." };
  }
  if (!(await hasPermission(actingUser.role, "mailSettings", "MANAGE"))) {
    return { ok: false, message: "관리자 이상만 서명 이미지를 올릴 수 있습니다." };
  }

  const file = formData.get("file");
  const cidRaw = formData.get("cid");
  if (!(file instanceof File) || typeof cidRaw !== "string") {
    return { ok: false, message: "파일과 이름을 확인할 수 없습니다." };
  }

  const existing = await listSignatureImages();
  // 이미 있는 이름을 다시 올리는 것은 **교체**다 — 장수 상한에 걸리면 안 된다.
  const isReplacement = existing.some((image) => image.cid === cidRaw.trim());

  const check = validateSignatureImage({
    cid: cidRaw,
    mimeType: file.type,
    sizeBytes: file.size,
    currentCount: isReplacement ? 0 : existing.length,
  });
  if (!check.ok) return { ok: false, message: check.message };

  const content = Buffer.from(await file.arrayBuffer());
  // 브라우저가 알려 준 크기와 실제 바이트가 다를 수 있다 — 실물로 다시 본다.
  if (content.length === 0 || content.length > SIGNATURE_IMAGE_MAX_BYTES) {
    const kb = Math.round(SIGNATURE_IMAGE_MAX_BYTES / 1024);
    return { ok: false, message: `이미지는 ${kb}KB 까지 올릴 수 있습니다.` };
  }

  await upsertSignatureImage({
    cid: check.cid,
    fileName: file.name || `${check.cid}.img`,
    mimeType: check.mimeType,
    content,
    actorUserId: actingUser.id,
  });

  revalidatePath(MAIL_SETTINGS_PATH);
  return {
    ok: true,
    message: isReplacement
      ? `${check.cid} 을(를) 새 그림으로 바꿨습니다. 서명 HTML 은 고칠 필요 없습니다.`
      : `올렸습니다. 서명에 <img src="cid:${check.cid}"> 처럼 넣으면 됩니다.`,
  };
}

/** 서명 이미지 지우기. 서명 HTML 이 아직 그 이름을 가리키면 그림만 깨진다 — 화면이 미리 경고한다. */
export async function deleteSignatureImageAction(input: {
  id: string;
}): Promise<{ ok: boolean; message: string }> {
  if (getAuthSource() !== "database") {
    return { ok: false, message: "데이터베이스 저장 모드가 아닙니다." };
  }
  const session = await readSession();
  if (!session) return { ok: false, message: "로그인이 필요합니다." };
  const actingUser = await resolveActingUserForSession(session);
  if (!actingUser) return { ok: false, message: "로그인이 필요합니다." };
  if (!(await hasPermission(actingUser.role, "mailSettings", "MANAGE"))) {
    return { ok: false, message: "관리자 이상만 서명 이미지를 지울 수 있습니다." };
  }

  const result = await deleteSignatureImage({ id: input.id, actorUserId: actingUser.id });
  if (!result.ok) return { ok: false, message: "이미 지워진 이미지입니다." };

  revalidatePath(MAIL_SETTINGS_PATH);
  return { ok: true, message: "지웠습니다." };
}
