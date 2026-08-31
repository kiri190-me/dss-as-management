import { DEFAULT_INTAKE_MAIL_TEMPLATE } from "@/lib/domain/intake-mail-body";

/**
 * 접수 알림 메일 설정 입력 검증 — 순수 함수. 화면과 서버 액션이 같은 것을 쓴다.
 *
 * 길이를 막는 이유: 이 글은 전사원 메일로 나간다. 제목이 길면 메일함에서
 * 잘리고, 머리말·꼬리말이 길면 정작 봐야 할 자료가 스크롤 아래로 밀린다.
 */

/** 메일 제목 한 줄. 메일 클라이언트가 대개 이 근처에서 자른다. */
export const SUBJECT_MAX = 200;
/** 머리말·꼬리말. 문단 몇 개는 되고 그 이상은 자료를 가린다. */
export const TEXT_MAX = 2000;

export type IntakeMailSettingsInput = {
  isEnabled: boolean;
  subjectTemplate: string;
  introText: string;
  outroText: string;
  /** 고른 수신자의 user id. 빈 배열이면 아무에게도 보내지 않는다. */
  recipientUserIds: string[];
};

export type IntakeMailSettingsFieldErrors = Partial<
  Record<"subjectTemplate" | "introText" | "outroText" | "recipientUserIds", string>
>;

export type ValidateIntakeMailSettingsResult =
  | { ok: true; data: IntakeMailSettingsInput }
  | { ok: false; fieldErrors: IntakeMailSettingsFieldErrors };

export function validateIntakeMailSettingsInput(
  raw: unknown
): ValidateIntakeMailSettingsResult {
  const fieldErrors: IntakeMailSettingsFieldErrors = {};

  if (typeof raw !== "object" || raw === null) {
    return { ok: false, fieldErrors: { subjectTemplate: "입력을 읽을 수 없습니다." } };
  }
  const input = raw as Record<string, unknown>;

  const isEnabled = input.isEnabled === true;

  const subjectTemplate = typeof input.subjectTemplate === "string" ? input.subjectTemplate.trim() : "";
  if (!subjectTemplate) {
    // 제목 없는 메일은 스팸으로 걸리거나 목록에서 아예 못 찾는다.
    fieldErrors.subjectTemplate = "제목 형식을 입력해 주세요.";
  } else if (subjectTemplate.length > SUBJECT_MAX) {
    fieldErrors.subjectTemplate = `제목 형식은 ${SUBJECT_MAX}자까지 입력할 수 있습니다.`;
  }

  // 머리말·꼬리말은 **비워도 된다.** 비우면 그 줄이 아예 빠진다
  // (domain/intake-mail-body.ts) — 빈 줄이 남지 않는다.
  const introText = typeof input.introText === "string" ? input.introText : "";
  if (introText.length > TEXT_MAX) {
    fieldErrors.introText = `머리말은 ${TEXT_MAX}자까지 입력할 수 있습니다.`;
  }
  const outroText = typeof input.outroText === "string" ? input.outroText : "";
  if (outroText.length > TEXT_MAX) {
    fieldErrors.outroText = `꼬리말은 ${TEXT_MAX}자까지 입력할 수 있습니다.`;
  }

  const rawIds = Array.isArray(input.recipientUserIds) ? input.recipientUserIds : null;
  if (!rawIds) {
    fieldErrors.recipientUserIds = "수신자 목록을 읽을 수 없습니다.";
  }
  // 같은 사람이 두 번 들어오면 한 번으로 접는다. 화면이 그럴 일은 없지만
  // 유니크 인덱스에 걸려 저장 전체가 실패하는 것보다 낫다.
  const recipientUserIds = [...new Set((rawIds ?? []).filter((id): id is string => typeof id === "string" && id.length > 0))];

  /*
   * 🔴 "켰는데 수신자가 없다" 는 막는다.
   *
   * 저장은 되지만 한 통도 안 나가는 상태이고, 화면만 보면 켜져 있으므로
   * **아무도 이상하다고 생각하지 않는다.** 접수가 스무 건 쌓인 뒤에야
   * "메일이 안 오는데요" 로 발견된다. 끄거나, 고르거나 둘 중 하나여야 한다.
   */
  if (isEnabled && recipientUserIds.length === 0) {
    fieldErrors.recipientUserIds =
      "자동 발송을 켜려면 수신자를 한 명 이상 골라 주세요. (끈 상태로는 저장할 수 있습니다.)";
  }

  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };

  return {
    ok: true,
    data: { isEnabled, subjectTemplate, introText, outroText, recipientUserIds },
  };
}

/** 저장된 설정이 없을 때 화면과 발송이 함께 쓰는 초기값. */
export const INTAKE_MAIL_SETTINGS_FALLBACK: Omit<IntakeMailSettingsInput, "recipientUserIds"> = {
  isEnabled: false,
  subjectTemplate: DEFAULT_INTAKE_MAIL_TEMPLATE.subject,
  introText: DEFAULT_INTAKE_MAIL_TEMPLATE.intro,
  outroText: DEFAULT_INTAKE_MAIL_TEMPLATE.outro,
};
