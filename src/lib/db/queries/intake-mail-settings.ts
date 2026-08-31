import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { db } from "../client";
import { intakeMailRecipients, intakeMailSettings, users } from "../schema";
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
  isEnabled: boolean;
  subjectTemplate: string;
  introText: string;
  outroText: string;
  /** 마지막으로 바꾼 사람과 시각. 저장된 적이 없으면 null. */
  updatedByName: string | null;
  updatedAt: Date | null;
  /** 승인된 사용자 전부 + 각자 골라졌는지. 화면이 이 목록에 체크박스를 그린다. */
  recipientOptions: IntakeMailRecipientOption[];
};

export async function getIntakeMailSettings(): Promise<IntakeMailSettingsView> {
  const [row] = await db
    .select({
      isEnabled: intakeMailSettings.isEnabled,
      subjectTemplate: intakeMailSettings.subjectTemplate,
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
    introText: row?.introText ?? INTAKE_MAIL_SETTINGS_FALLBACK.introText,
    outroText: row?.outroText ?? INTAKE_MAIL_SETTINGS_FALLBACK.outroText,
    updatedByName: row?.updatedByName ?? null,
    updatedAt: row?.updatedAt ?? null,
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
