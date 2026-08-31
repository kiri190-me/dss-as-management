import "server-only";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "../client";
import {
  intakeMailRecipients,
  intakeMailSettings,
  intakeMailSignatureImages,
  users,
} from "../schema";
import { INTAKE_MAIL_SETTINGS_FALLBACK } from "@/lib/validation/intake-mail-settings-input";

/**
 * 접수 알림 메일 설정 조회 — 설정 화면과 (2단계의) 발송이 함께 쓴다.
 *
 * 행이 없으면 **코드의 기본값**을 돌려준다(발송 꺼짐 + 기본 문구). 설치
 * 시점에 한 줄 심어 두지 않는 이유는 스키마 주석에 있다.
 */

export type IntakeMailRecipientOption = {
  userId: string;
  name: string;
  email: string;
  role: string;
  /** 지금 수신자로 골라져 있는가. */
  isSelected: boolean;
};

export type IntakeMailSettingsView = {
  /** 저장돼 있는(이미 정화된) 서명 HTML. */
  signatureHtml: string;
  isEnabled: boolean;
  subjectTemplate: string;
  introText: string;
  outroText: string;
  /** 마지막으로 바꾼 사람과 시각. 저장된 적이 없으면 null. */
  updatedByName: string | null;
  updatedAt: Date | null;
  /** 올려 둔 서명 이미지 목록(바이트 제외). */
  signatureImages: SignatureImageInfo[];
  /** 승인된 사용자 전부 + 각자 골라졌는지. 화면이 이 목록에 체크박스를 그린다. */
  recipientOptions: IntakeMailRecipientOption[];
};

export async function getIntakeMailSettings(): Promise<IntakeMailSettingsView> {
  const [row] = await db
    .select({
      isEnabled: intakeMailSettings.isEnabled,
      subjectTemplate: intakeMailSettings.subjectTemplate,
      signatureHtml: intakeMailSettings.signatureHtml,
      introText: intakeMailSettings.introText,
      outroText: intakeMailSettings.outroText,
      updatedAt: intakeMailSettings.updatedAt,
      updatedByName: users.name,
    })
    .from(intakeMailSettings)
    .leftJoin(users, eq(intakeMailSettings.updatedBy, users.id))
    .limit(1);

  const selected = await db
    .select({ userId: intakeMailRecipients.userId })
    .from(intakeMailRecipients);
  const selectedIds = new Set(selected.map((r) => r.userId));

  /*
   * 후보는 **승인된 미삭제 계정**뿐이다.
   *
   * 승인 대기 계정까지 고를 수 있으면, 아직 우리 사람인지 확인되지 않은
   * 주소로 고객사·S/N·증상이 나간다. 가입만 하면 받게 되는 셈이다.
   */
  const signatureImages = await listSignatureImages();

  const candidates = await db
    .select({
      userId: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
    })
    .from(users)
    .where(and(eq(users.approvalStatus, "APPROVED"), eq(users.isDeleted, false)))
    .orderBy(asc(users.name));

  return {
    isEnabled: row?.isEnabled ?? INTAKE_MAIL_SETTINGS_FALLBACK.isEnabled,
    subjectTemplate: row?.subjectTemplate ?? INTAKE_MAIL_SETTINGS_FALLBACK.subjectTemplate,
    signatureHtml: row?.signatureHtml ?? INTAKE_MAIL_SETTINGS_FALLBACK.signatureHtml,
    introText: row?.introText ?? INTAKE_MAIL_SETTINGS_FALLBACK.introText,
    outroText: row?.outroText ?? INTAKE_MAIL_SETTINGS_FALLBACK.outroText,
    updatedByName: row?.updatedByName ?? null,
    updatedAt: row?.updatedAt ?? null,
    signatureImages,
    recipientOptions: candidates.map((c) => ({
      ...c,
      isSelected: selectedIds.has(c.userId),
    })),
  };
}

/**
 * 시험 메일을 받을 주소 — **누른 사람 자신의 것.**
 *
 * 화면에서 주소를 받지 않고 여기서 구하는 것이 요점이다. 화면이 정할 수 있으면
 * "시험"이라는 이름으로 아무 주소에나 보낼 수 있게 된다.
 */
export async function getMyEmailAddress(userId: string): Promise<string | null> {
  const [row] = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row?.email?.trim() || null;
}

export type SignatureImageInfo = {
  id: string;
  cid: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
};

/**
 * 서명 이미지 목록 — **바이트는 빼고** 정보만.
 *
 * 화면은 목록을 그리기만 하면 되고, 실물은 `<img>` 가 따로 불러 간다. 여기에
 * 바이트를 담으면 설정 화면을 여는 것만으로 1MB 넘는 값이 HTML 에 실린다.
 */
export async function listSignatureImages(): Promise<SignatureImageInfo[]> {
  return db
    .select({
      id: intakeMailSignatureImages.id,
      cid: intakeMailSignatureImages.cid,
      fileName: intakeMailSignatureImages.fileName,
      mimeType: intakeMailSignatureImages.mimeType,
      sizeBytes: intakeMailSignatureImages.sizeBytes,
    })
    .from(intakeMailSignatureImages)
    .orderBy(asc(intakeMailSignatureImages.createdAt));
}

/** 한 장의 실물. 화면의 `<img>` 가 부르는 라우트가 쓴다. */
export async function getSignatureImageContent(
  id: string
): Promise<{ content: Buffer; mimeType: string; fileName: string } | null> {
  const [row] = await db
    .select({
      content: intakeMailSignatureImages.content,
      mimeType: intakeMailSignatureImages.mimeType,
      fileName: intakeMailSignatureImages.fileName,
    })
    .from(intakeMailSignatureImages)
    .where(eq(intakeMailSignatureImages.id, id))
    .limit(1);
  return row ?? null;
}

/**
 * 발송할 때 **서명이 실제로 가리키는 것만** 가져온다.
 *
 * 올려 두고 서명에서 지운 이미지까지 붙이면 메일이 무거워지고, 받는 사람
 * 메일함에 정체 모를 첨부가 달린다.
 */
export async function getSignatureImagesByCids(
  cids: string[]
): Promise<{ cid: string; content: Buffer; mimeType: string; fileName: string }[]> {
  if (cids.length === 0) return [];
  return db
    .select({
      cid: intakeMailSignatureImages.cid,
      content: intakeMailSignatureImages.content,
      mimeType: intakeMailSignatureImages.mimeType,
      fileName: intakeMailSignatureImages.fileName,
    })
    .from(intakeMailSignatureImages)
    .where(inArray(intakeMailSignatureImages.cid, cids));
}

/**
 * 실제로 메일을 받을 주소들.
 *
 * 화면용 목록(recipientOptions)과 갈라 둔 이유: 저기는 "고를 수 있는 사람 전부 +
 * 골라졌는지"이고 여기는 "지금 보낼 곳"이다. 하나로 합치면 발송 경로가 화면용
 * 자료를 통째로 읽게 되고, 승인이 취소된 계정을 걸러 내는 조건이 화면 쪽 사정에
 * 묶인다.
 *
 * 🔴 고른 뒤에 승인이 취소되거나 삭제된 계정은 여기서 빠진다. 수신자 표에는
 * 행이 남아 있어도 보내지 않는다 — 우리 사람이 아닌 주소로 고객사·S/N·증상이
 * 나가는 것을 막는 마지막 문이다.
 */
export async function listActiveRecipientEmails(): Promise<string[]> {
  const rows = await db
    .select({ email: users.email })
    .from(intakeMailRecipients)
    .innerJoin(users, eq(intakeMailRecipients.userId, users.id))
    .where(and(eq(users.approvalStatus, "APPROVED"), eq(users.isDeleted, false)));

  return [...new Set(rows.map((r) => r.email.trim()).filter((email) => email.length > 0))];
}

/** 발송이 켜져 있는가 + 문구. 화면용 전체 조회보다 가볍게 읽는다. */
export async function getIntakeMailDispatchSettings(): Promise<{
  isEnabled: boolean;
  subjectTemplate: string;
  introText: string;
  outroText: string;
  signatureHtml: string;
}> {
  const [row] = await db
    .select({
      isEnabled: intakeMailSettings.isEnabled,
      subjectTemplate: intakeMailSettings.subjectTemplate,
      introText: intakeMailSettings.introText,
      outroText: intakeMailSettings.outroText,
      signatureHtml: intakeMailSettings.signatureHtml,
    })
    .from(intakeMailSettings)
    .limit(1);

  return {
    isEnabled: row?.isEnabled ?? INTAKE_MAIL_SETTINGS_FALLBACK.isEnabled,
    subjectTemplate: row?.subjectTemplate ?? INTAKE_MAIL_SETTINGS_FALLBACK.subjectTemplate,
    introText: row?.introText ?? INTAKE_MAIL_SETTINGS_FALLBACK.introText,
    outroText: row?.outroText ?? INTAKE_MAIL_SETTINGS_FALLBACK.outroText,
    signatureHtml: row?.signatureHtml ?? INTAKE_MAIL_SETTINGS_FALLBACK.signatureHtml,
  };
}
